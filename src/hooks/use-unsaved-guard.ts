import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router';
import { t } from '@/i18n';
import { useConfirm } from '@/components/ui/overlay';

/**
 * Forms with changes that have not been saved yet, so that what reloads the
 * whole page from inside the app (switching the language) can ask first.
 */
const unsaved = new Set<object>();

/** Forms whose changes the person chose to lose: they no longer ask before leaving. */
const discarded = new WeakSet<object>();

/** Whether a form on the page has changes that have not been saved yet. */
export function hasUnsavedChanges(): boolean {
  return unsaved.size > 0;
}

/**
 * After the person has agreed to lose the changes (opening another
 * company's page): the forms let the next page open without asking again.
 */
export function discardUnsavedChanges(): void {
  for (const key of unsaved) discarded.add(key);
  unsaved.clear();
}

/**
 * Warns before leaving a page with unsaved changes (in-app navigation and
 * closing the tab). Call `allowNavigation()` right before navigating after a save.
 */
export function useUnsavedGuard(dirty: boolean) {
  const confirm = useConfirm();
  const skip = useRef(false);
  const token = useRef({});
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !skip.current &&
      !discarded.has(token.current) &&
      currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void confirm({
      title: t('Discard unsaved changes?'),
      description: t('You have changes that have not been saved yet.'),
      confirmLabel: t('Discard changes'),
      cancelLabel: t('Keep editing'),
      danger: true,
    }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker, confirm]);

  useEffect(() => {
    if (!dirty) return;
    const key = token.current;
    if (!skip.current && !discarded.has(key)) unsaved.add(key);
    const handler = (event: BeforeUnloadEvent) => {
      if (skip.current || discarded.has(key)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      unsaved.delete(key);
      window.removeEventListener('beforeunload', handler);
    };
  }, [dirty]);

  return useCallback(() => {
    skip.current = true;
    unsaved.delete(token.current);
  }, []);
}
