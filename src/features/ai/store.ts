import { useSyncExternalStore } from 'react';
import { cloudSnapshot, subscribeCloud } from '@/cloud/store';
import { newId } from '@/lib/ids';
import { streamChat as defaultStreamChat, type ChatMessage, type StreamOptions } from './client';
import { AiError, isAiError } from './errors';
import { scrubText, type HiddenCounts, type KnownValue } from './scrub';

/**
 * The AI assistant's conversation and panel, for this browser tab only.
 * Kept in memory, outside React (a change of language remounts the app):
 * never stored, never synced, gone on reload, with New chat, when another
 * person or company takes over the tab, when the person signs out or their
 * role or access changes, and when the assistant is switched off. A
 * question is kept as it was sent: cleaned of ID numbers, IBANs and the
 * like first (scrub.ts); what was typed is not kept.
 */

export type TurnStatus = 'streaming' | 'done' | 'stopped' | 'error';

export interface ChatTurn {
  id: string;
  role: 'user' | 'model';
  /** For the person's questions, as sent: with private details replaced. */
  text: string;
  /** The person's questions only: what was hidden before sending, when anything was. */
  hidden?: HiddenCounts;
  /** The assistant's answers only. */
  status?: TurnStatus;
  error?: AiError;
}

export interface AssistantState {
  open: boolean;
  turns: ChatTurn[];
  /**
   * The question in the box, not sent yet: kept while the panel is closed
   * (and while the app is drawn again in another language).
   */
  draft: string;
  /**
   * A question the person sent before the panel could ask it (the role not
   * read yet, or an answer still being written): asked as soon as it can be.
   */
  pending: string | null;
  /** Bumped to put the cursor in the question box. */
  focus: number;
}

let state: AssistantState = { open: false, turns: [], draft: '', pending: null, focus: 0 };
/** Whose conversation it is: the person and the company ("user:company"). */
let owner: string | null = null;
/** The role and access it was held under, once known (see claimConversation). */
let granted: string | null = null;
/** Bumped each time the conversation is forgotten: an answer of an older one is dropped. */
let epoch = 0;
let running: AbortController | null = null;
let ask: (options: StreamOptions) => Promise<{ text: string }> = defaultStreamChat;
const listeners = new Set<() => void>();

function set(patch: Partial<AssistantState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAssistant(): AssistantState {
  return useSyncExternalStore(subscribe, () => state);
}

export function assistantState(): AssistantState {
  return state;
}

/** Whether the panel is open, for the page beside it (not drawn again with each word). */
export function useAssistantOpen(): boolean {
  return useSyncExternalStore(subscribe, () => state.open);
}

/**
 * Opens the panel. With a question (the palette's "Ask AI…"), it is put in
 * the box for the person to read and send: never sent from here, as what is
 * typed in the search box may be a Civil ID or an IBAN to look up. A
 * question already in the box stays, the new one on the next line.
 */
export function openAssistant(question?: string): void {
  const text = question?.trim();
  const kept = state.draft.trimEnd();
  const draft = !text || kept === text ? state.draft : kept ? `${kept}\n${text}` : text;
  set({ open: true, draft, focus: state.focus + 1 });
}

export function closeAssistant(): void {
  set({ open: false, pending: null });
}

/** The question being typed. */
export function setDraft(draft: string): void {
  if (draft !== state.draft) set({ draft });
}

/** Sends a question as soon as the panel can ask it (see `pending`). */
export function queueQuestion(text: string): void {
  const question = text.trim();
  if (question) set({ open: true, pending: question });
}

export function toggleAssistant(): void {
  if (state.open) closeAssistant();
  else openAssistant();
}

/** Takes the pending question, once. */
export function takePending(): string | null {
  const pending = state.pending;
  if (pending !== null) set({ pending: null });
  return pending;
}

/** Stops the answer being written, keeping what it has so far. */
export function stopAnswer(): void {
  running?.abort();
}

/** Stops the answer being written and forgets it, whatever it was (it gives way to nothing). */
function drop(): void {
  epoch += 1;
  running?.abort();
  running = null;
}

/** Forgets the conversation (New chat). */
export function newChat(): void {
  drop();
  set({ turns: [], draft: '', pending: null, focus: state.focus + 1 });
}

/**
 * The conversation belongs to one person in one company, under one role
 * and access: when another person or company takes over the tab, it starts
 * again and the panel closes; when the person's role or the owner's limits
 * on them change (`access`, null while not known yet), it starts again, so
 * nothing said under the old ones outlives them.
 */
export function claimConversation(key: string, access: string | null = null): void {
  if (owner === key) {
    if (access === null || access === granted) return;
    const before = granted;
    granted = access;
    if (before !== null) forget({ close: false });
    return;
  }
  const first = owner === null;
  owner = key;
  granted = access;
  if (first && state.turns.length === 0 && running === null) return;
  forget();
}

/**
 * Forgets everything and stops the answer being written: the person signed
 * out, or the assistant was switched off or is no longer theirs here.
 */
export function forgetConversation(): void {
  forget();
}

/**
 * Signed out, or another person signed in: forgotten, with the answer being
 * written, wherever the app is. Watched here, outside React, as well as by
 * the panel: a sign-out that removes the companies from this device takes
 * the app shell, and the panel with it, away before the person is signed
 * out, and the panel would never see it.
 */
subscribeCloud(() => {
  const user = cloudSnapshot().user;
  if (!user || (owner !== null && !owner.startsWith(`${user.id}:`))) forgetConversation();
});

function forget({ close = true }: { close?: boolean } = {}): void {
  const empty =
    state.turns.length === 0 && state.draft === '' && state.pending === null && running === null;
  drop();
  if (empty && (!close || !state.open)) return;
  set({ turns: [], draft: '', pending: null, ...(close ? { open: false } : {}) });
}

export function isAnswering(current: AssistantState = state): boolean {
  return current.turns.some((turn) => turn.status === 'streaming');
}

function updateTurn(id: string, patch: Partial<ChatTurn>) {
  set({ turns: state.turns.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)) });
}

/**
 * The conversation before an answer, as sent. An answer that failed is
 * left out with the question it was for, so the model isn't asked that one
 * again with the next (the answer being asked again keeps its question).
 */
function historyBefore(turns: readonly ChatTurn[], id: string): ChatMessage[] {
  const at = turns.findIndex((turn) => turn.id === id);
  const before = turns.slice(0, at === -1 ? turns.length : at);
  return before
    .filter(
      (turn, i) =>
        turn.status !== 'error' && !(turn.role === 'user' && before[i + 1]?.status === 'error'),
    )
    .map((turn) => ({ role: turn.role, text: turn.text }));
}

async function answer(id: string, system: string, known: readonly KnownValue[]) {
  const controller = new AbortController();
  running = controller;
  const forEpoch = epoch;
  try {
    const result = await ask({
      messages: historyBefore(state.turns, id),
      system,
      known,
      signal: controller.signal,
      onText: (_delta, text) => {
        if (epoch === forEpoch && !controller.signal.aborted) updateTurn(id, { text });
      },
    });
    if (epoch === forEpoch) updateTurn(id, { text: result.text, status: 'done' });
  } catch (error) {
    if (epoch !== forEpoch) return;
    const failure = isAiError(error) ? error : new AiError('internal');
    updateTurn(
      id,
      failure.code === 'aborted' ? { status: 'stopped' } : { status: 'error', error: failure },
    );
  } finally {
    if (running === controller) running = null;
  }
}

/**
 * Sends a question with the page's system instruction; the answer streams
 * into the conversation. The question is cleaned first (scrubText), with
 * `known`, this company's never-send values on this device: only the
 * cleaned text is kept and sent.
 */
export function sendQuestion(
  text: string,
  system: string,
  known: readonly KnownValue[] = [],
): void {
  const question = text.trim();
  if (!question || isAnswering()) return;
  const sent = scrubText(question, known);
  const asked: ChatTurn = { id: newId(), role: 'user', text: sent.text };
  if (sent.count > 0) asked.hidden = sent.hidden;
  const reply: ChatTurn = { id: newId(), role: 'model', text: '', status: 'streaming' };
  set({ turns: [...state.turns, asked, reply] });
  void answer(reply.id, system, known);
}

/** Asks again for an answer that failed or was stopped (`known` as for sendQuestion). */
export function retryAnswer(id: string, system: string, known: readonly KnownValue[] = []): void {
  if (isAnswering()) return;
  updateTurn(id, { text: '', status: 'streaming', error: undefined });
  void answer(id, system, known);
}

/** For tests: forget everything and answer with `fake` instead of the service. */
export function resetAssistantForTests(
  fake: (options: StreamOptions) => Promise<{ text: string }> = defaultStreamChat,
): void {
  drop();
  owner = null;
  granted = null;
  ask = fake;
  set({ open: false, turns: [], draft: '', pending: null, focus: 0 });
}
