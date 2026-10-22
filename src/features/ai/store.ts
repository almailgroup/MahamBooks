import { useSyncExternalStore } from 'react';
import { newId } from '@/lib/ids';
import { streamChat as defaultStreamChat, type ChatMessage, type StreamOptions } from './client';
import { AiError, isAiError } from './errors';

/**
 * The AI assistant's conversation and panel, for this browser tab only.
 * Kept in memory, outside React (a change of language remounts the app):
 * never stored, never synced, gone on reload, with New chat, or when
 * another person or company takes over the tab.
 */

export type TurnStatus = 'streaming' | 'done' | 'stopped' | 'error';

export interface ChatTurn {
  id: string;
  role: 'user' | 'model';
  text: string;
  /** The assistant's answers only. */
  status?: TurnStatus;
  error?: AiError;
}

export interface AssistantState {
  open: boolean;
  turns: ChatTurn[];
  /** A question to send as soon as the panel is open (from the command palette). */
  pending: string | null;
  /** Bumped to put the cursor in the question box. */
  focus: number;
}

let state: AssistantState = { open: false, turns: [], pending: null, focus: 0 };
/** Whose conversation it is: the person and the company ("user:company"). */
let owner: string | null = null;
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

/** Opens the panel; with a question, asks it (the palette's "Ask AI…"). */
export function openAssistant(question?: string): void {
  const text = question?.trim();
  set({ open: true, pending: text ? text : state.pending, focus: state.focus + 1 });
}

export function closeAssistant(): void {
  set({ open: false, pending: null });
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

/** Forgets the conversation (New chat). */
export function newChat(): void {
  stopAnswer();
  running = null;
  set({ turns: [], pending: null, focus: state.focus + 1 });
}

/**
 * The conversation belongs to one person in one company: when another one
 * takes over the tab, it starts again and the panel closes.
 */
export function claimConversation(key: string): void {
  if (owner === key) return;
  const first = owner === null;
  owner = key;
  if (first && state.turns.length === 0) return;
  stopAnswer();
  running = null;
  set({ turns: [], pending: null, open: false });
}

export function isAnswering(current: AssistantState = state): boolean {
  return current.turns.some((turn) => turn.status === 'streaming');
}

function updateTurn(id: string, patch: Partial<ChatTurn>) {
  set({ turns: state.turns.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)) });
}

/** The conversation before an answer, as sent: answers that failed are left out. */
function historyBefore(id: string): ChatMessage[] {
  const at = state.turns.findIndex((turn) => turn.id === id);
  return state.turns
    .slice(0, at === -1 ? state.turns.length : at)
    .filter((turn) => turn.status !== 'error')
    .map((turn) => ({ role: turn.role, text: turn.text }));
}

async function answer(id: string, system: string) {
  const controller = new AbortController();
  running = controller;
  const forOwner = owner;
  try {
    const result = await ask({
      messages: historyBefore(id),
      system,
      signal: controller.signal,
      onText: (_delta, text) => {
        if (owner === forOwner && !controller.signal.aborted) updateTurn(id, { text });
      },
    });
    if (owner === forOwner) updateTurn(id, { text: result.text, status: 'done' });
  } catch (error) {
    if (owner !== forOwner) return;
    const failure = isAiError(error) ? error : new AiError('internal');
    updateTurn(
      id,
      failure.code === 'aborted' ? { status: 'stopped' } : { status: 'error', error: failure },
    );
  } finally {
    if (running === controller) running = null;
  }
}

/** Sends a question with the page's system instruction; the answer streams into the conversation. */
export function sendQuestion(text: string, system: string): void {
  const question = text.trim();
  if (!question || isAnswering()) return;
  const reply: ChatTurn = { id: newId(), role: 'model', text: '', status: 'streaming' };
  set({ turns: [...state.turns, { id: newId(), role: 'user', text: question }, reply] });
  void answer(reply.id, system);
}

/** Asks again for an answer that failed or was stopped. */
export function retryAnswer(id: string, system: string): void {
  if (isAnswering()) return;
  updateTurn(id, { text: '', status: 'streaming', error: undefined });
  void answer(id, system);
}

/** For tests: forget everything and answer with `fake` instead of the service. */
export function resetAssistantForTests(
  fake: (options: StreamOptions) => Promise<{ text: string }> = defaultStreamChat,
): void {
  running?.abort();
  running = null;
  owner = null;
  ask = fake;
  set({ open: false, turns: [], pending: null, focus: 0 });
}
