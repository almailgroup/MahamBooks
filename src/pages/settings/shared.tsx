import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { Company } from '@/db/types';
import { saveCompany } from '@/db/records';
import { useCompany } from '@/app/company';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/misc';
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard';
import { ReadOnlyNote, SaveArea } from '@/components/ui/read-only';
import { t } from '@/i18n';
import { registerBottomBar } from '@/features/shell/store';

/** Local editable copy of the company with save/reset and a leave guard. */
export function useCompanyDraft() {
  const company = useCompany();
  const [draft, setDraft] = useState<Company>(company);
  const [base, setBase] = useState(company);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  useUnsavedGuard(dirty && !saving);

  // Pick up changes made elsewhere (another tab, logo upload…) when nothing is
  // pending. Adjusting state during render is React's recommended pattern here.
  if (company !== base && !dirty) {
    setBase(company);
    setDraft(company);
  }

  /** Saves the draft with `patch` applied (also used for one-click changes). */
  const saveWith = async (
    patch: Partial<Company> | ((draft: Company) => Company) = {},
    message = t('Settings saved'),
  ) => {
    const next = typeof patch === 'function' ? patch(draft) : { ...draft, ...patch };
    setDraft(next);
    setSaving(true);
    try {
      const saved = await saveCompany(next);
      setDraft(saved);
      setBase(saved);
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save settings.'));
    } finally {
      setSaving(false);
    }
  };

  return {
    draft,
    setDraft,
    update: (patch: Partial<Company>) => setDraft((d) => ({ ...d, ...patch })),
    dirty,
    saving,
    save: () => saveWith(),
    saveWith,
    reset: () => setDraft(base),
  };
}

export function SettingsSection({
  title,
  description,
  children,
  actions,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  /** Lets other pages link straight to the section (`?section=id`). */
  id?: string;
}) {
  return (
    <Card id={id} className="scroll-mt-20">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-slate-100 px-4 py-4 sm:px-6">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="space-y-5 p-4 sm:p-6">{children}</div>
    </Card>
  );
}

export function SaveBar({
  dirty,
  saving,
  onSave,
  onReset,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  // Floating buttons (Ask AI) move up while it shows.
  useEffect(() => (dirty ? registerBottomBar() : undefined), [dirty]);
  if (!dirty) return null;
  return (
    <div
      role="region"
      aria-label={t('Unsaved changes')}
      className="bg-surface/95 sticky bottom-4 z-10 mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-slate-200 px-4 py-3 shadow-lg backdrop-blur sm:px-5"
    >
      <p className="text-sm text-slate-600">{t('You have unsaved changes.')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <ReadOnlyNote />
        <SaveArea>
          <Button variant="ghost" onClick={onReset} disabled={saving}>
            {t('Discard')}
          </Button>
          <Button onClick={onSave} loading={saving}>
            {t('Save changes')}
          </Button>
        </SaveArea>
      </div>
    </div>
  );
}
