import { useEffect, useLayoutEffect, useRef, type FormEvent } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  ArrowUp,
  Copy,
  EyeOff,
  RotateCcw,
  Sparkles,
  Square,
  SquarePen,
  WifiOff,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { t, tp } from '@/i18n';
import { useCompany } from '@/app/company';
import { useOnline } from '@/cloud/status';
import { Button } from '@/components/ui/button';
import { MAX_QUESTION_LENGTH } from './config';
import { aiErrorMessage } from './errors';
import { useKnownValues } from './known-values';
import { Markdown } from './markdown';
import { HIDDEN_KINDS, type HiddenCounts, type HiddenKind, type KnownValue } from './scrub';
import {
  closeAssistant,
  isAnswering,
  newChat,
  queueQuestion,
  retryAnswer,
  sendQuestion,
  setDraft,
  stopAnswer,
  takePending,
  useAssistant,
  type ChatTurn,
} from './store';
import { useAiContext } from './use-ai-context';

/**
 * The AI assistant's panel: a sheet at the end side of the screen on
 * desktop (on wide screens the page moves over to stay usable beside it,
 * see AppLayout), the whole screen on phones. The conversation and the
 * question being typed are the tab's (store.ts); each question is sent
 * with where the person is, never a record (use-ai-context.ts), and
 * cleaned of ID numbers, IBANs and the like first, this company's own
 * included (scrub.ts, known-values.ts), with a note on it when anything was.
 * `onClosed` puts the keyboard's focus back once the panel is gone.
 */
export function AssistantPanel({ open, onClosed }: { open: boolean; onClosed?: () => void }) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => (next ? undefined : closeAssistant())}
      modal={false}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // The page beside it stays usable: clicking it doesn't close the panel.
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onClosed?.();
          }}
          className="data-[state=open]:animate-fade-in bg-surface fixed inset-0 z-40 flex flex-col shadow-2xl outline-none sm:inset-y-2.5 sm:start-auto sm:end-2.5 sm:w-[26rem] sm:max-w-[calc(100vw-1.25rem)] sm:rounded-3xl sm:ring-1 sm:ring-slate-900/10 print:hidden"
        >
          {open ? <PanelBody /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PanelBody() {
  const company = useCompany();
  const context = useAiContext();
  const { system, place, starters } = context;
  // The company's never-send values, to hide in what is typed: nothing is
  // asked before they are read.
  const known = useKnownValues(company.id);
  const ready = context.ready && known !== undefined;
  const assistant = useAssistant();
  const online = useOnline();
  const answering = isAnswering(assistant);
  const { draft } = assistant;
  const box = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const { turns } = assistant;

  // A question sent before the person's role was read, once it is (and no answer is being written).
  useEffect(() => {
    if (assistant.pending === null || !ready || answering) return;
    const question = takePending();
    if (question) sendQuestion(question, system, known);
  }, [assistant.pending, system, ready, answering, known]);

  // The cursor in the box, after what is in it (a question from the palette).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [assistant.focus]);

  // Follows the answer as it is written, unless the person scrolled up to read.
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  // The box grows with the question, up to a few lines.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const ask = (text: string) => {
    if (!text.trim() || answering || !online) return;
    stick.current = true;
    // Asked before the person's role is read (just opened): sent as soon as it is.
    if (ready) sendQuestion(text, system, known);
    else queueQuestion(text);
    setDraft('');
    box.current?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    ask(draft);
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-slate-100 py-2.5 ps-4 pe-2 pt-[max(0.625rem,env(safe-area-inset-top))]">
        <span
          className="bg-primary-50 text-primary-700 flex size-8 shrink-0 items-center justify-center rounded-lg"
          aria-hidden
        >
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="text-sm font-semibold text-slate-900">
            {t('AI assistant')}
          </DialogPrimitive.Title>
          <p className="truncate text-xs text-slate-500" dir="auto">
            {place.page}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={newChat} disabled={turns.length === 0}>
          <SquarePen aria-hidden />
          {t('New chat')}
        </Button>
        <DialogPrimitive.Close className="flex size-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-700 pointer-coarse:size-11">
          <X className="size-5" aria-hidden />
          <span className="sr-only">{t('Close')}</span>
        </DialogPrimitive.Close>
      </div>

      <div
        ref={list}
        role="log"
        aria-label={t('Conversation')}
        aria-busy={answering}
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4"
      >
        {turns.length === 0 ? (
          <Welcome starters={starters} onAsk={ask} disabled={!online} />
        ) : (
          turns.map((turn) => (
            <Turn
              key={turn.id}
              turn={turn}
              answering={answering}
              system={system}
              known={known ?? []}
            />
          ))
        )}
      </div>

      <form
        onSubmit={submit}
        className="border-t border-slate-100 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {!online ? (
          <p
            role="status"
            className="mb-2 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            <WifiOff className="size-4 shrink-0" aria-hidden />
            {t('The AI assistant needs an internet connection.')}
          </p>
        ) : null}
        <div className="focus-within:ring-primary-500/40 flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1.5 focus-within:ring-2">
          <textarea
            ref={box}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                ask(draft);
              }
            }}
            rows={1}
            dir="auto"
            maxLength={MAX_QUESTION_LENGTH}
            aria-label={t('Your question')}
            placeholder={t('Ask how to do something in Maham One…')}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 pointer-coarse:text-base"
          />
          {answering ? (
            <Button type="button" variant="outline" size="icon" onClick={stopAnswer}>
              <Square className="fill-current" aria-hidden />
              <span className="sr-only">{t('Stop')}</span>
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!draft.trim() || !online}>
              <ArrowUp aria-hidden />
              <span className="sr-only">{t('Send')}</span>
            </Button>
          )}
        </div>
        <p className="mt-2 text-center text-xs text-slate-500">
          {t('AI can make mistakes. Check important answers.')}
        </p>
      </form>
    </>
  );
}

function Welcome({
  starters,
  onAsk,
  disabled,
}: {
  starters: string[];
  onAsk: (question: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-slate-900">
          {t('Ask how to do something in Maham One.')}
        </p>
        <p className="text-sm text-slate-500">
          {t(
            'The assistant sees only what you type and the page you are on, not your records. Don’t type Civil IDs, IBANs or salaries.',
          )}
        </p>
      </div>
      <ul className="space-y-2" aria-label={t('Suggested questions')}>
        {starters.map((question) => (
          <li key={question}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAsk(question)}
              dir="auto"
              className="hover:border-primary-300 hover:bg-primary-50 w-full rounded-xl border border-slate-200 px-3 py-2 text-start text-sm text-slate-700 transition-colors disabled:opacity-50 pointer-coarse:min-h-11"
            >
              {question}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "1 ID number was hidden before sending", for each kind hidden in a question. */
function hiddenLine(kind: HiddenKind, count: number): string {
  switch (kind) {
    case 'id':
      return tp(
        count,
        '{count} ID number was hidden before sending',
        '{count} ID numbers were hidden before sending',
      );
    case 'iban':
      return tp(
        count,
        '{count} IBAN was hidden before sending',
        '{count} IBANs were hidden before sending',
      );
    case 'account':
      return tp(
        count,
        '{count} account number was hidden before sending',
        '{count} account numbers were hidden before sending',
      );
    case 'phone':
      return tp(
        count,
        '{count} phone number was hidden before sending',
        '{count} phone numbers were hidden before sending',
      );
    case 'email':
      return tp(
        count,
        '{count} email address was hidden before sending',
        '{count} email addresses were hidden before sending',
      );
    case 'number':
      return tp(
        count,
        '{count} long number was hidden before sending',
        '{count} long numbers were hidden before sending',
      );
  }
}

/** Under a question: what was hidden in it before it was sent. */
function HiddenNote({ hidden }: { hidden: HiddenCounts }) {
  const lines = HIDDEN_KINDS.filter((kind) => (hidden[kind] ?? 0) > 0).map((kind) =>
    hiddenLine(kind, hidden[kind]!),
  );
  if (lines.length === 0) return null;
  return (
    <div className="flex max-w-[85%] items-start gap-1.5 text-xs text-slate-500">
      <EyeOff className="mt-px size-3.5 shrink-0" aria-hidden />
      <p>
        {lines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </p>
    </div>
  );
}

function Turn({
  turn,
  answering,
  system,
  known,
}: {
  turn: ChatTurn;
  answering: boolean;
  system: string;
  known: readonly KnownValue[];
}) {
  if (turn.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1">
        <p
          dir="auto"
          className="bg-primary-solid text-on-primary max-w-[85%] rounded-2xl rounded-ee-md px-3.5 py-2 text-sm whitespace-pre-wrap"
        >
          {turn.text}
        </p>
        {turn.hidden ? <HiddenNote hidden={turn.hidden} /> : null}
      </div>
    );
  }
  const copy = () => {
    navigator.clipboard
      .writeText(turn.text)
      .then(() => toast.success(t('Copied')))
      .catch(() => toast.error(t('Could not copy the answer.')));
  };
  return (
    <div className="space-y-2" data-status={turn.status}>
      {turn.text ? (
        <div className="text-slate-800">
          <Markdown text={turn.text} />
        </div>
      ) : turn.status === 'streaming' ? (
        <p className="flex items-center gap-1.5 text-sm text-slate-500">
          <span className="flex gap-1" aria-hidden>
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="size-1.5 animate-pulse rounded-full bg-slate-400"
                style={{ animationDelay: `${dot * 150}ms` }}
              />
            ))}
          </span>
          {t('Writing the answer…')}
        </p>
      ) : null}
      {turn.status === 'error' ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <span className="min-w-0 flex-1">{aiErrorMessage(turn.error)}</span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => retryAnswer(turn.id, system, known)}
            disabled={answering}
          >
            <RotateCcw aria-hidden />
            {t('Try again')}
          </Button>
        </div>
      ) : null}
      {turn.status === 'stopped' ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>{t('Stopped')}</span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => retryAnswer(turn.id, system, known)}
            disabled={answering}
          >
            <RotateCcw aria-hidden />
            {t('Try again')}
          </Button>
        </div>
      ) : null}
      {turn.text && (turn.status === 'done' || turn.status === 'stopped') ? (
        <Button variant="ghost" size="xs" onClick={copy} className={cn('-ms-2 text-slate-500')}>
          <Copy aria-hidden />
          {t('Copy')}
        </Button>
      ) : null}
    </div>
  );
}
