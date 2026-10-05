import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CompanyLink } from '@/db/types';
import { newId } from '@/lib/ids';
import { MAX_LINKS, normalizeLinkUrl } from '@/lib/links';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { SaveBar, SettingsSection, useCompanyDraft } from './shared';

/** What's wrong with a link before it can be saved, or ''. */
function linkProblem(link: CompanyLink): string {
  if (!link.label.trim()) return t('Give the link a name.');
  if (!normalizeLinkUrl(link.url)) return t('Enter a web address, like https://tasks.example.com.');
  return '';
}

/**
 * Settings → Links: the company's other tools (a task manager, an HR
 * portal…), shown in the sidebar for everyone in the company. They open in
 * a new tab.
 */
export default function LinkSettings() {
  const { draft, setDraft, dirty, saving, saveWith, reset } = useCompanyDraft();
  const links = draft.links ?? [];
  const setLinks = (next: CompanyLink[]) => setDraft((d) => ({ ...d, links: next }));
  const change = (id: string, patch: Partial<CompanyLink>) =>
    setLinks(links.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const onSave = () => {
    const problem = links.map(linkProblem).find(Boolean);
    if (problem) {
      toast.error(problem);
      return;
    }
    void saveWith((d) => ({
      ...d,
      links: (d.links ?? []).map((l) => ({
        ...l,
        label: l.label.trim(),
        labelAr: l.labelAr?.trim() ?? '',
        url: normalizeLinkUrl(l.url) ?? l.url,
      })),
    }));
  };

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('Links in the sidebar')}
        description={t(
          'Your other tools, such as a task manager. They show in the sidebar for everyone in this company and open in a new tab.',
        )}
        actions={
          links.length < MAX_LINKS ? (
            <Button
              variant="outline"
              onClick={() => setLinks([...links, { id: newId(), label: '', labelAr: '', url: '' }])}
            >
              <Plus /> {t('Add a link')}
            </Button>
          ) : null
        }
      >
        {links.length === 0 ? (
          <p className="text-sm text-slate-500">{t('No links yet.')}</p>
        ) : (
          <ul className="space-y-4">
            {links.map((link, index) => {
              const problem = dirty ? linkProblem(link) : '';
              const url = normalizeLinkUrl(link.url);
              return (
                <li
                  key={link.id}
                  className="rounded-xl p-4 ring-1 ring-slate-200"
                  aria-label={t('Link {number}', { number: index + 1 })}
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label={t('Name')}>
                      {(id) => (
                        <Input
                          id={id}
                          value={link.label}
                          maxLength={40}
                          onChange={(e) => change(link.id, { label: e.target.value })}
                          placeholder={t('Tasks')}
                          dir="auto"
                        />
                      )}
                    </Field>
                    <Field label={t('Name in Arabic')} optional>
                      {(id) => (
                        <Input
                          id={id}
                          value={link.labelAr ?? ''}
                          maxLength={40}
                          onChange={(e) => change(link.id, { labelAr: e.target.value })}
                          placeholder="المهام"
                          dir="rtl"
                        />
                      )}
                    </Field>
                    <Field label={t('Web address')} className="sm:col-span-2">
                      {(id) => (
                        <Input
                          id={id}
                          value={link.url}
                          inputMode="url"
                          autoComplete="url"
                          onChange={(e) => change(link.id, { url: e.target.value })}
                          placeholder="https://"
                          dir="ltr"
                        />
                      )}
                    </Field>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    {problem ? (
                      <p className="text-sm text-red-700">{problem}</p>
                    ) : url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-700 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
                      >
                        <ExternalLink className="size-4" aria-hidden />
                        {t('Try the link')}
                      </a>
                    ) : (
                      <span />
                    )}
                    <Button
                      variant="ghost"
                      onClick={() => setLinks(links.filter((l) => l.id !== link.id))}
                      aria-label={t('Remove the link {name}', { name: link.label || index + 1 })}
                    >
                      <Trash2 /> {t('Remove')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>
      <SaveBar dirty={dirty} saving={saving} onSave={onSave} onReset={reset} />
    </div>
  );
}
