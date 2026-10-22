import { useEffect } from 'react';
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
  const available = useAiAvailability() === 'on';
  const { open } = useAssistant();

  // A conversation is one person's in one company.
  useEffect(() => {
    if (user) claimConversation(`${user.id}:${company.id}`);
  }, [user, company.id]);

  // Switched off, signed out or company changed: the panel goes.
  useEffect(() => {
    if (!available && open) closeAssistant();
  }, [available, open]);

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

  if (!available) return null;
  return (
    <>
      {open ? null : <AskAiButton />}
      <AssistantPanel open={open} />
    </>
  );
}

/**
 * At the bottom corner on the end side, above the phone's tab bar (or an
 * editor's action bar) and above a save bar floating at the bottom of the
 * page. Out of the way while typing on a phone, and never printed.
 */
function AskAiButton() {
  const typing = useTyping();
  const lifted = useHasBottomBar();
  const label = t('Ask AI');
  return (
    <button
      type="button"
      onClick={() => openAssistant()}
      title={`${label} (${assistantShortcutLabel()})`}
      className={cn(
        'bg-surface text-primary-700 hover:bg-primary-50 fixed end-4 z-30 flex h-12 items-center gap-2 rounded-full px-3.5 text-sm font-semibold shadow-[0_10px_30px_-8px_rgb(15_23_42/0.35)] ring-1 ring-slate-900/10 transition-colors sm:px-4 lg:end-6 print:hidden',
        lifted
          ? 'bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+10rem)] lg:bottom-24'
          : 'bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] lg:bottom-6',
        typing && 'max-lg:hidden',
      )}
    >
      <Sparkles className="text-primary-600 size-5" aria-hidden />
      <span className="max-sm:sr-only">{label}</span>
    </button>
  );
}
