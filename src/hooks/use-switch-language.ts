import { useCallback } from 'react';
import { t, type Language } from '@/i18n';
import { useLanguage } from '@/i18n/provider';
import { useConfirm } from '@/components/ui/overlay';
import { hasUnsavedChanges } from './use-unsaved-guard';

/**
 * Switches the interface language. The whole app is rebuilt in the new
 * language, so a form with changes that have not been saved yet (see
 * `useUnsavedGuard`) would lose them: the person is asked first.
 */
export function useSwitchLanguage(): (language: Language) => Promise<void> {
  const { setLanguage } = useLanguage();
  const confirm = useConfirm();
  return useCallback(
    async (language: Language) => {
      if (hasUnsavedChanges()) {
        const ok = await confirm({
          title: t('Discard your changes?'),
          description: t(
            'Switching the language reloads the page, so changes that have not been saved yet are lost.',
          ),
          confirmLabel: t('Discard changes'),
          cancelLabel: t('Keep editing'),
          danger: true,
        });
        if (!ok) return;
      }
      await setLanguage(language);
    },
    [confirm, setLanguage],
  );
}
