import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CompanyLink } from '@/db/types';
import { newId } from '@/lib/ids';
import {
  LINK_PRESETS,
  MAX_LINKS,
  hasSecretParameter,
  linkPreset,
  normalizeLinkUrl,
  presetLink,
} from '@/lib/links';
import { APPS, appTitle } from '@/suite/apps';
import { localName } from '@/i18n/names';
import { useLanguage } from '@/i18n/provider';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { SaveBar, SettingsSection, useCompanyDraft } from './shared';

const APP_IDS: readonly string[] = APPS.map((app) => app.id);

/** What's wrong with a link before it can be saved, or ''. */
function linkProblem(link: CompanyLink): string {
  if (!link.label.trim()) return t('Give the link a name.');
  if (!normalizeLinkUrl(link.url)) return t('Enter a web address, like https://tasks.example.com.');
  if (Array.isArray(link.apps) && link.apps.length === 0) {
    return t('Choose at least one app for the link.');
  }
  return '';
}

/** Whether the sidebar of an app shows the link: every app's unless some were chosen. */
const showsIn = (link: CompanyLink, app: string) =>
  !Array.isArray(link.apps) || link.apps.includes(app);

/** The apps chosen once one is ticked or unticked; missing again when every app is. */
function toggleApp(link: CompanyLink, app: string, on: boolean): string[] | undefined {
  const chosen = Array.isArray(link.apps) ? link.apps : APP_IDS;
  const next = on ? [...chosen, app] : chosen.filter((id) => id !== app);
  if (APP_IDS.every((id) => next.includes(id))) return undefined;
  // This build's apps in their order, then those of a newer build, kept.
  return [
    ...APP_IDS.filter((id) => next.includes(id)),
    ...next.filter((id) => !APP_IDS.includes(id)),
  ];
}

/**
 * The link as kept: trimmed names and the full address. A choice set back
 * to today's (the list of links, every app) is left out; what a newer
 * build wrote and this one doesn't show stays.
 */
function cleanLink({ section, apps, ...link }: CompanyLink): CompanyLink {
  return {
    ...link,
    label: link.label.trim(),
    labelAr: link.labelAr?.trim() ?? '',
    url: normalizeLinkUrl(link.url) ?? link.url,
    ...(section !== undefined ? { section } : {}),
    ...(apps !== undefined ? { apps } : {}),
  };
}

/**
 * Settings → Links: the company's other tools (a task manager, an HR
 * portal…) and the portals of its integrations (Deema, Taly, Tahseel),
 * shown in the sidebar for everyone in the company, in every app or in
 * those chosen. They open in a new tab.
 */
export default function LinkSettings() {
  const { draft, setDraft, dirty, saving, saveWith, reset } = useCompanyDraft();
  const { language } = useLanguage();
  const links = draft.links ?? [];
  const setLinks = (next: CompanyLink[]) => setDraft((d) => ({ ...d, links: next }));
  const change = (id: string, patch: Partial<CompanyLink>) =>
    setLinks(links.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const room = links.length < MAX_LINKS;
  // Each integration once.
  const presets = LINK_PRESETS.filter((preset) => !links.some((l) => l.preset === preset.id));

  const onSave = () => {
    const problem = links.map(linkProblem).find(Boolean);
    if (problem) {
      toast.error(problem);
      return;
    }
    void saveWith((d) => ({ ...d, links: (d.links ?? []).map(cleanLink) }));
  };

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('Links in the sidebar')}
        description={t(
          'Your other tools, such as a task manager. They show in the sidebar for everyone in this company and open in a new tab.',
        )}
        actions={
          room ? (
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
              const preset = linkPreset(link.preset);
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
                          placeholder={preset && !preset.labelAr ? preset.label : 'المهام'}
                          dir="rtl"
                        />
                      )}
                    </Field>
                    <Field
                      label={t('Web address')}
                      className="sm:col-span-2"
                      hint={
                        preset
                          ? t('Paste the address of your {name} portal.', {
                              name: localName(
                                { name: preset.label, nameAr: preset.labelAr },
                                language,
                              ),
                            })
                          : undefined
                      }
                    >
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
                    {hasSecretParameter(link.url) ? (
                      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:col-span-2">
                        {t(
                          'This address seems to hold a key or token. Everyone in the company and every backup gets the links, so never put keys in them.',
                        )}
                      </p>
                    ) : null}
                    <Field label={t('Show under')}>
                      {(id) => (
                        <Select
                          id={id}
                          value={link.section === 'integrations' ? 'integrations' : 'links'}
                          onChange={(e) =>
                            change(link.id, {
                              section:
                                e.target.value === 'integrations' ? 'integrations' : undefined,
                            })
                          }
                        >
                          <option value="links">{t('Links')}</option>
                          <option value="integrations">{t('Integrations')}</option>
                        </Select>
                      )}
                    </Field>
                    <fieldset className="space-y-2">
                      <legend className="mb-1.5 text-sm font-medium text-slate-700">
                        {t('Show in')}
                      </legend>
                      <div className="flex flex-wrap gap-x-5 gap-y-2">
                        {APPS.map((app) => (
                          <Checkbox
                            key={app.id}
                            checked={showsIn(link, app.id)}
                            onChange={(e) =>
                              change(link.id, { apps: toggleApp(link, app.id, e.target.checked) })
                            }
                            label={appTitle(app, language)}
                          />
                        ))}
                      </div>
                    </fieldset>
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
        {room && presets.length ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <p className="basis-full text-sm text-slate-600">
              {t(
                'Integrations: the name is filled in and you paste the address of your portal. They show under Integrations in Maham Books and Maham CRM.',
              )}
            </p>
            {presets.map((preset) => (
              <Button
                key={preset.id}
                variant="outline"
                size="sm"
                onClick={() => setLinks([...links, presetLink(preset)])}
              >
                <Plus />
                {t('Add {name}', {
                  name: localName({ name: preset.label, nameAr: preset.labelAr }, language),
                })}
              </Button>
            ))}
          </div>
        ) : null}
      </SettingsSection>
      <SaveBar dirty={dirty} saving={saving} onSave={onSave} onReset={reset} />
    </div>
  );
}
