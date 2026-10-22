import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, ArchiveRestore, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  getTemplate,
  LetterError,
  newTemplate,
  restoreDefaultWording,
  saveTemplate,
  setTemplateArchived,
} from '@/db/letters';
import { defaultNumbering } from '@/db/defaults';
import type { LetterKind, LetterLanguage, LetterTemplate, LetterTrigger } from '@/db/types';
import { useCompany } from '@/app/company';
import { useLettersView } from '@/features/people/letter-hooks';
import { LetterPreview } from '@/features/people/letter-dialog';
import {
  LETTER_FIELD_GROUPS,
  LETTER_FIELDS,
  LETTER_KINDS,
  LETTER_LANGUAGES,
  LETTER_LANGUAGE_LABELS,
  LETTER_TRIGGERS,
  LETTER_TRIGGER_LABELS,
  fillLetter,
  letterKindLabel,
  letterLanguage,
  letterValues,
  unknownFields,
  usesPrivateFields,
  type LetterFieldGroup,
} from '@/lib/hr/letters';
import { DEFAULT_WORDING, defaultTemplateKind, PREVIEW_EMPLOYEE } from '@/lib/hr/letter-templates';
import { previewNumber } from '@/lib/numbering';
import { today } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Segmented,
  Spinner,
} from '@/components/ui/misc';
import { useConfirm } from '@/components/ui/overlay';
import { t } from '@/i18n';
import { templatePath } from './templates';

type TextKey = 'subjectAr' | 'bodyAr' | 'subjectEn' | 'bodyEn';

const GROUPS: LetterFieldGroup[] = [
  'employee',
  'service',
  'salary',
  'letter',
  'company',
  'private',
];

/** Whether a template's text is still a kind's starting wording. */
function untouched(template: LetterTemplate): boolean {
  const wording = DEFAULT_WORDING[template.kind];
  return (
    !!wording &&
    template.bodyAr === wording.bodyAr &&
    template.bodyEn === wording.bodyEn &&
    template.subjectAr === wording.subjectAr &&
    template.subjectEn === wording.subjectEn
  );
}

/**
 * A letter template: its names and kind, the language it is printed in,
 * its wording in Arabic and English with the fields to fill, who signs,
 * whether the stamp and signature print, and the events that make a draft
 * of it by themselves. The preview fills it with an invented employee.
 */
export default function LetterTemplatePage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const company = useCompany();
  const view = useLettersView();
  const creating = id === 'new';
  const stored = useLiveQuery(
    async () => (creating ? null : ((await getTemplate(company.id, id)) ?? null)),
    [company.id, id, creating],
  );
  if (view.loading || stored === undefined) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }
  if (!creating && !stored) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">{t('This template could not be found.')}</p>
        <Link
          to="/people/letters/templates"
          className="text-primary-700 mt-4 inline-block text-sm font-medium"
        >
          {t('Letter templates')}
        </Link>
      </Card>
    );
  }
  const kind = params.get('kind');
  const start =
    stored ??
    newTemplate(
      company.id,
      LETTER_KINDS.includes(kind as LetterKind) ? (kind as LetterKind) : 'custom',
    );
  return <Editor key={start.id + (stored?.updatedAt ?? '')} initial={start} creating={creating} />;
}

function Editor({ initial, creating }: { initial: LetterTemplate; creating: boolean }) {
  const company = useCompany();
  const view = useLettersView();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<LetterTemplate>(initial);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [chosenPreview, setPreviewIn] = useState<'ar' | 'en'>('ar');
  const last = useRef<{ key: TextKey; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);
  const editable = view.on && view.canDraft;
  const defaultKind = defaultTemplateKind(draft.id);

  // The language the preview shows: the template's, or the one chosen for both.
  const previewIn: 'ar' | 'en' = draft.language === 'ar-en' ? chosenPreview : draft.language;

  const set = (patch: Partial<LetterTemplate>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const chooseKind = (kind: LetterKind) => {
    const wording = DEFAULT_WORDING[kind];
    // A new template still in its kind's wording takes the new kind's.
    if (creating && untouched(draft) && wording) {
      set({ kind, ...wording });
    } else {
      set({ kind });
    }
  };

  const insert = (key: string) => {
    const target = last.current;
    const token = `{${key}}`;
    const field: TextKey = target?.key ?? (previewIn === 'en' ? 'bodyEn' : 'bodyAr');
    const value = draft[field];
    const el = target?.el;
    const from = el?.selectionStart ?? value.length;
    const to = el?.selectionEnd ?? value.length;
    set({ [field]: value.slice(0, from) + token + value.slice(to) } as Partial<LetterTemplate>);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(from + token.length, from + token.length);
    });
  };

  // Where a field chip goes: the text last focused.
  const remember = (key: TextKey, el: HTMLInputElement | HTMLTextAreaElement) => {
    last.current = { key, el };
  };

  const run = async (key: string, work: () => Promise<LetterTemplate>, done: string) => {
    setBusy(key);
    try {
      const saved = await work();
      setDirty(false);
      toast.success(done);
      if (creating || saved.id !== initial.id) {
        navigate(templatePath(saved.id), { replace: true });
      }
    } catch (e) {
      toast.error(
        e instanceof LetterError || e instanceof Error ? e.message : t('Something went wrong.'),
      );
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    const ok = await confirm({
      title: t('Put back the app’s wording?'),
      description: t(
        'The Arabic and English text of this template go back to the app’s wording. Letters already made keep theirs.',
      ),
      confirmLabel: t('Restore default'),
    });
    if (!ok) return;
    await run(
      'restore',
      () => restoreDefaultWording(company.id, draft.id),
      t('The app’s wording is back'),
    );
  };

  const preview = useMemo(() => {
    const rule = company.numbering.letter ?? defaultNumbering().letter;
    const ctx = {
      employee: PREVIEW_EMPLOYEE,
      company,
      departments: null,
      privateFields: draft.privateFields === true && view.canIssue,
      letter: { number: previewNumber(rule, today()), date: today(), addressee: '', purpose: '…' },
    };
    const values = letterValues(ctx, previewIn);
    return {
      subject: fillLetter(previewIn === 'en' ? draft.subjectEn : draft.subjectAr, values),
      body: fillLetter(previewIn === 'en' ? draft.bodyEn : draft.bodyAr, values),
    };
  }, [company, draft, previewIn, view.canIssue]);

  const all = `${draft.subjectAr}\n${draft.bodyAr}\n${draft.subjectEn}\n${draft.bodyEn}`;
  const unknown = unknownFields(all);
  const asksPrivate = usesPrivateFields(all);
  const groups = GROUPS.filter((g) => g !== 'private' || view.canIssue);
  const autoOn = draft.autoOn ?? [];
  const toggleTrigger = (trigger: LetterTrigger, on: boolean) =>
    set({
      autoOn: on ? [...new Set([...autoOn, trigger])] : autoOn.filter((x) => x !== trigger),
    });

  return (
    <div>
      <PageHeader
        breadcrumb={<Link to="/people/letters/templates">{t('Letter templates')}</Link>}
        title={
          creating
            ? t('New template')
            : draft.name || draft.nameAr || t(letterKindLabel(draft.kind))
        }
        description={t(letterKindLabel(draft.kind))}
        actions={
          editable ? (
            <>
              {!creating ? (
                <Button
                  variant="outline"
                  loading={busy === 'archive'}
                  disabled={busy !== null || dirty}
                  onClick={() =>
                    void run(
                      'archive',
                      () => setTemplateArchived(company.id, draft.id, !draft.archived),
                      draft.archived ? t('Template restored') : t('Template archived'),
                    )
                  }
                >
                  {draft.archived ? <ArchiveRestore /> : <Archive />}
                  {draft.archived ? t('Restore') : t('Archive')}
                </Button>
              ) : null}
              {defaultKind ? (
                <Button
                  variant="outline"
                  loading={busy === 'restore'}
                  disabled={busy !== null}
                  onClick={() => void restore()}
                >
                  <RotateCcw /> {t('Restore default')}
                </Button>
              ) : null}
              <Button
                loading={busy === 'save'}
                disabled={busy !== null || (!dirty && !creating)}
                onClick={() => void run('save', () => saveTemplate(draft), t('Template saved'))}
              >
                {t('Save template')}
              </Button>
            </>
          ) : null
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-3">
          {draft.archived ? (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
              {t('This template is archived: no new letters are made from it.')}
            </p>
          ) : null}
          <Card>
            <CardHeader title={t('Template')} />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('Name (English)')}>
                {(field) => (
                  <Input
                    id={field}
                    value={draft.name}
                    onChange={(e) => set({ name: e.target.value })}
                    dir="ltr"
                    disabled={!editable}
                  />
                )}
              </Field>
              <Field label={t('Name (Arabic)')}>
                {(field) => (
                  <Input
                    id={field}
                    value={draft.nameAr ?? ''}
                    onChange={(e) => set({ nameAr: e.target.value })}
                    dir="rtl"
                    disabled={!editable}
                  />
                )}
              </Field>
              <Field label={t('Kind of letter')}>
                {(field) => (
                  <Select
                    id={field}
                    value={draft.kind}
                    onChange={(e) => chooseKind(e.target.value as LetterKind)}
                    disabled={!editable || Boolean(defaultKind)}
                  >
                    {LETTER_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(letterKindLabel(kind))}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label={t('Printed in')}
                hint={t('Arabic unless you choose otherwise. Each letter can still be changed.')}
              >
                {(field) => (
                  <Select
                    id={field}
                    value={draft.language}
                    onChange={(e) => set({ language: letterLanguage(e.target.value) })}
                    disabled={!editable}
                  >
                    {LETTER_LANGUAGES.map((value: LetterLanguage) => (
                      <option key={value} value={value}>
                        {t(LETTER_LANGUAGE_LABELS[value])}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={t('Wording')}
              description={t(
                'Click a field to put it where the cursor is. Fields are filled from the employee’s record when the letter is issued.',
              )}
            />
            <CardBody className="space-y-5">
              <div className="space-y-2">
                {groups.map((group) => (
                  <div key={group} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-24 shrink-0 text-xs font-medium text-slate-500">
                      {t(LETTER_FIELD_GROUPS[group])}
                    </span>
                    {LETTER_FIELDS.filter((f) => f.group === group).map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        disabled={!editable}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insert(f.key)}
                        title={`{${f.key}}`}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700 hover:border-slate-300 hover:bg-slate-100 disabled:opacity-50"
                      >
                        {t(f.label)}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              <fieldset className="space-y-2" disabled={!editable}>
                <legend className="text-sm font-medium text-slate-800">{t('Arabic')}</legend>
                <Input
                  value={draft.subjectAr}
                  onChange={(e) => set({ subjectAr: e.target.value })}
                  dir="rtl"
                  placeholder={t('Subject')}
                  aria-label={t('Subject ({language})', { language: t('Arabic') })}
                  onFocus={(e) => remember('subjectAr', e.currentTarget)}
                />
                <Textarea
                  value={draft.bodyAr}
                  onChange={(e) => set({ bodyAr: e.target.value })}
                  dir="rtl"
                  rows={14}
                  aria-label={t('Text ({language})', { language: t('Arabic') })}
                  onFocus={(e) => remember('bodyAr', e.currentTarget)}
                />
              </fieldset>
              <fieldset className="space-y-2" disabled={!editable}>
                <legend className="text-sm font-medium text-slate-800">{t('English')}</legend>
                <Input
                  value={draft.subjectEn}
                  onChange={(e) => set({ subjectEn: e.target.value })}
                  dir="ltr"
                  placeholder={t('Subject')}
                  aria-label={t('Subject ({language})', { language: t('English') })}
                  onFocus={(e) => remember('subjectEn', e.currentTarget)}
                />
                <Textarea
                  value={draft.bodyEn}
                  onChange={(e) => set({ bodyEn: e.target.value })}
                  dir="ltr"
                  rows={14}
                  aria-label={t('Text ({language})', { language: t('English') })}
                  onFocus={(e) => remember('bodyEn', e.currentTarget)}
                />
              </fieldset>
              {unknown.length > 0 ? (
                <p className="text-xs text-amber-700">
                  {t('These fields aren’t known and print as written: {fields}', {
                    fields: unknown.map((key) => `{${key}}`).join(' '),
                  })}
                </p>
              ) : null}
              {asksPrivate && !draft.privateFields ? (
                <p className="text-xs text-amber-700">
                  {t(
                    'The text asks for private details, which print masked until the template is allowed to show them (below).',
                  )}
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('Signature and stamp')} />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('Signed by')} optional>
                  {(field) => (
                    <Input
                      id={field}
                      value={draft.signatoryName}
                      onChange={(e) => set({ signatoryName: e.target.value })}
                      dir="auto"
                      disabled={!editable}
                    />
                  )}
                </Field>
                <Field label={t('Their title')} optional>
                  {(field) => (
                    <Input
                      id={field}
                      value={draft.signatoryTitle}
                      onChange={(e) => set({ signatoryTitle: e.target.value })}
                      dir="auto"
                      disabled={!editable}
                    />
                  )}
                </Field>
              </div>
              <Switch
                checked={draft.showSignature}
                onChange={(showSignature) => set({ showSignature })}
                disabled={!editable}
                label={t('Print the signature')}
                description={t(
                  'The signature of Settings → Company, on issued letters only. Drafts never show it.',
                )}
              />
              <Switch
                checked={draft.showStamp}
                onChange={(showStamp) => set({ showStamp })}
                disabled={!editable}
                label={t('Print the company stamp')}
                description={t('On issued letters only. Drafts never show it.')}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={t('Automatic drafts')}
              description={t(
                'A draft of this letter is made by itself when one of these happens. It is never issued or printed without a person: it waits in People → Letters → Drafts.',
              )}
            />
            <CardBody className="space-y-3">
              {LETTER_TRIGGERS.map((trigger) => (
                <Checkbox
                  key={trigger}
                  checked={autoOn.includes(trigger)}
                  disabled={!editable}
                  onChange={(e) => toggleTrigger(trigger, e.target.checked)}
                  label={t(LETTER_TRIGGER_LABELS[trigger])}
                />
              ))}
              <p className="text-xs text-slate-500">
                {t('Employees imported from a file make no drafts.')}
              </p>
            </CardBody>
          </Card>

          {view.canIssue || draft.privateFields ? (
            <Card>
              <CardHeader title={t('Private details')} />
              <CardBody>
                <Switch
                  checked={draft.privateFields === true}
                  onChange={(privateFields) => set({ privateFields })}
                  disabled={!editable || !view.canIssue}
                  label={t('This letter may show the Civil ID, passport number and bank account')}
                  description={t(
                    'Only where its text asks for them, and only when the owner, an admin or an approver issues it. Otherwise they print masked. A salary transfer letter to a bank may need them.',
                  )}
                />
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="xl:col-span-2">
          <Card className="xl:sticky xl:top-4">
            <CardHeader
              title={t('Preview')}
              description={t('With an invented employee.')}
              actions={
                draft.language === 'ar-en' ? (
                  <Segmented
                    size="sm"
                    value={previewIn}
                    onChange={setPreviewIn}
                    options={[
                      { value: 'ar', label: t('Arabic') },
                      { value: 'en', label: t('English') },
                    ]}
                  />
                ) : (
                  <Badge tone="gray">{t(LETTER_LANGUAGE_LABELS[draft.language])}</Badge>
                )
              }
            />
            <CardBody>
              <LetterPreview texts={preview} language={previewIn} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
