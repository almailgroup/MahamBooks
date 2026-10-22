import { useEffect, useLayoutEffect, useRef, type Ref } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t } from '@/i18n';
import { useCompany } from '@/app/company';
import { useCloud } from '@/cloud/store';
import { useHasBottomBar, useTyping } from '@/features/shell/store';
import { useAiAvailability } from './availability';
import { AssistantPanel } from './assistant-panel';
import {
  claimConversation,
  closeAssistant,
  openAssistant,
  toggleAssistant,
  useAssistant,
} from './store';

/** "Ctrl J" or "⌘J", for the button's tooltip. */
export function assistantShortcutLabel(): string {
  const platform =
    typeof navigator === 'undefined'
      ? ''
      : ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
          ?.platform ?? navigator.platform);
  return /mac|iphone|ipad/i.test(platform) ? '⌘J' : 'Ctrl J';
}

/**
 * The AI assistant on every page of the app shell (not print views): the
 * Ask AI button, Ctrl J or ⌘J, and its panel. Nothing at all unless the
 * company's switch is on and the person is signed in to it in the cloud.
 */
export function AiAssistant() {
  const company = useCompany();
  const { user } = useCloud();
  const availability = useAiAvailability();
  const available = availability === 'on';
  const { open } = useAssistant();
  const button = useRef<HTMLButtonElement>(null);
  // What had the keyboard's focus when the panel opened, to go back to.
  const before = useRef<HTMLElement | null>(null);

  // A conversation is one person's in one company.
  useEffect(() => {
    if (user) claimConversation(`${user.id}:${company.id}`);
  }, [user, company.id]);

  // Switched off, signed out or company changed: the panel goes. Not while
  // the company's link is read again (the app drawn again in another language).
  useEffect(() => {
    if (!available && availability !== 'loading' && open) closeAssistant();
  }, [available, availability, open]);

  // Before the panel's box takes the focus (its effect runs after this one).
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    before.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open]);

  // Closed with the focus in it: back where the person was, or to Ask AI.
  // Focus the person moved to the page meanwhile stays where it is.
  const onClosed = () => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const to = before.current?.isConnected ? before.current : button.current;
    before.current = null;
    to?.focus();
  };

  useEffect(() => {
    if (!available) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'j'
      ) {
        event.preventDefault();
        toggleAssistant();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [available]);

  // While the app is drawn again (another language), an open panel stays open.
  if (!available && !(availability === 'loading' && open)) return null;
  return (
    <>
      {/* Hidden, not removed, while the panel is open: the focus comes back to it. */}
      {available ? <AskAiButton ref={button} hidden={open} /> : null}
      <AssistantPanel open={open} onClosed={onClosed} />
    </>
  );
}

/**
 * At the bottom corner on the end side, above the phone's tab bar (or an
 * editor's action bar) and above a save bar floating at the bottom of the
 * page. Out of the way while typing on a phone, and never printed.
 */
function AskAiButton({ hidden, ref }: { hidden: boolean; ref: Ref<HTMLButtonElement> }) {
  const typing = useTyping();
  const lifted = useHasBottomBar();
  const label = t('Ask AI');
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => openAssistant()}
      title={`${label} (${assistantShortcutLabel()})`}
      className={cn(
        'bg-surface text-primary-700 hover:bg-primary-50 fixed end-4 z-30 flex h-12 items-center gap-2 rounded-full px-3.5 text-sm font-semibold shadow-[0_10px_30px_-8px_rgb(15_23_42/0.35)] ring-1 ring-slate-900/10 transition-colors sm:px-4 lg:end-6 print:hidden',
        lifted
          ? 'bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+10rem)] lg:bottom-24'
          : 'bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] lg:bottom-6',
        typing && 'max-lg:hidden',
        hidden && 'hidden',
      )}
    >
      <Sparkles className="text-primary-600 size-5" aria-hidden />
      <span className="max-sm:sr-only">{label}</span>
    </button>
  );
}
