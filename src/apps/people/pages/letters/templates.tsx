import { Link } from 'react-router';
import { Files, Plus } from 'lucide-react';
import type { LetterTemplate } from '@/db/types';
import { useLetterTemplates, useLettersView } from '@/features/people/letter-hooks';
import { LETTER_TRIGGER_LABELS, letterKindLabel, letterLanguageLabel } from '@/lib/hr/letters';
import { defaultTemplateKind } from '@/lib/hr/letter-templates';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';

/** The address of a template's page (default templates' ids hold colons). */
export function templatePath(id: string): string {
  return `/people/letters/templates/${encodeURIComponent(id)}`;
}

/**
 * People → Letters → Letter templates: the company's wording of each kind
 * of letter, in Arabic and English. The five first letters are there from
 * the start with the app's wording, until the company changes them.
 */
export default function LetterTemplatesPage() {
  const view = useLettersView();
  const templates = useLetterTemplates();
  if (view.loading || !templates) return <Spinner className="py-24" label={t('Loading…')} />;
  const active = templates.filter((tpl) => !tpl.archived);
  const archived = templates.filter((tpl) => tpl.archived);
  return (
    <div>
      <PageHeader
        breadcrumb={<Link to="/people/letters">{t('Letters')}</Link>}
        title={t('Letter templates')}
        description={t(
          'The wording of each kind of letter. Fields in braces are filled from the employee’s record; the text itself is the company’s, in Arabic and English.',
        )}
        actions={
          view.on && view.canDraft ? (
            <ButtonLink to={templatePath('new')}>
              <Plus /> {t('New template')}
            </ButtonLink>
          ) : null
        }
      />
      {!view.on ? (
        <Card>
          <EmptyState
            icon={<Files />}
            title={t('Employee letters are off')}
            description={t('Turn them on in People → Letters first.')}
            action={
              <ButtonLink to="/people/letters" variant="outline">
                {t('Letters')}
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <TemplateList title={t('Templates')} templates={active} />
          {archived.length > 0 ? <TemplateList title={t('Archived')} templates={archived} /> : null}
        </div>
      )}
    </div>
  );
}

function TemplateList({ title, templates }: { title: string; templates: LetterTemplate[] }) {
  return (
    <Card>
      <CardHeader title={title} />
      <ul className="divide-y divide-slate-100">
        {templates.map((tpl) => (
          <li key={tpl.id}>
            <Link
              to={templatePath(tpl.id)}
              className="flex flex-col gap-1 px-5 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="min-w-0">
                <span dir="auto" className="block font-medium text-slate-900">
                  {localName(tpl) || t(letterKindLabel(tpl.kind))}
                </span>
                <span className="block text-xs text-slate-500">
                  {t(letterKindLabel(tpl.kind))} · {t(letterLanguageLabel(tpl.language))}
                </span>
              </span>
              <span className="flex flex-wrap gap-1">
                {defaultTemplateKind(tpl.id) && !tpl.updatedAt ? (
                  <Badge tone="gray">{t('The app’s wording')}</Badge>
                ) : null}
                {(tpl.autoOn ?? []).map((trigger) => (
                  <Badge key={trigger} tone="blue">
                    {t(LETTER_TRIGGER_LABELS[trigger])}
                  </Badge>
                ))}
                {tpl.privateFields ? <Badge tone="amber">{t('Private details')}</Badge> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
