import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router';
import { t } from '@/i18n';
import { useConfirm } from '@/components/ui/overlay';

/**
 * Forms with changes that have not been saved yet, so that what reloads the
 * whole page from inside the app (switching the language) can ask first.
 */
const unsaved = new Set<object>();

/** Whether a form on the page has changes that have not been saved yet. */
export function hasUnsavedChanges(): boolean {
  return unsaved.size > 0;
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
      dirty && !skip.current && currentLocation.pathname !== nextLocation.pathname,
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
    if (!skip.current) unsaved.add(key);
    const handler = (event: BeforeUnloadEvent) => {
      if (skip.current) return;
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
