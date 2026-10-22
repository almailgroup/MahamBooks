import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, Check, FileSignature, Printer, Send, Trash2, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import {
  addSignedCopy,
  deleteLetterDraft,
  draftFromTemplate,
  issueLetter,
  letterContext,
  letterTexts,
  missingPurpose,
  pendingLetterRequest,
  privateFieldsShown,
  requestLetterIssue,
  saveLetterDraft,
  templateTexts,
  voidLetter,
  type LetterDraftInput,
  type LetterTexts,
} from '@/db/letters';
import { cancelApproval, decideApproval } from '@/db/approvals';
import { removeAttachment } from '@/db/purchases';
import type {
  ApprovalRequest,
  Company,
  Employee,
  EmployeeLetter,
  ID,
  LetterKind,
  LetterLanguage,
  LetterTemplate,
  PeopleSettings,
} from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { useCloud } from '@/cloud/store';
import type { CloudLink } from '@/cloud/types';
import {
  LETTER_LANGUAGES,
  LETTER_LANGUAGE_LABELS,
  letterKindLabel,
  letterLanguage,
  letterStatusLabel,
  letterTriggerNote,
  usesPrivateFields,
} from '@/lib/hr/letters';
import { isCurrent } from '@/lib/hr/employees';
import { approve, carryOut } from '@/features/approvals/decide';
import { statusMeta } from '@/features/approvals/labels';
import { useMemberNames, useMyName } from '@/features/approvals/hooks';
import { ReasonDialog } from '@/features/approvals/reason-dialog';
import { FileList } from './file-list';
import { useEmployees, usePeopleSettings } from './hooks';
import { useLetterTemplates, useLettersView, type LettersView } from './letter-hooks';
import { Button, ButtonLink } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Spinner } from '@/components/ui/misc';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  useConfirm,
} from '@/components/ui/overlay';
import { localName } from '@/i18n/names';
import { msg, t } from '@/i18n';
import type { StatusTone } from '@/lib/status';
import { lookup } from '@/lib/known';

/**
 * A letter to or about an employee (#19): made from a template, checked
 * and changed while it is a draft, then issued (numbered and frozen) by
 * the owner, an admin or an approver, or sent to an approver by an
 * accountant. Printed, never emailed.
 */

const STATUS_TONES: Record<EmployeeLetter['status'], StatusTone> = {
  draft: 'amber',
  issued: 'green',
  void: 'gray',
};

export function letterStatusTone(status: unknown): StatusTone {
  return lookup(STATUS_TONES, status, 'gray');
}

/** What the purpose of each kind of letter is called, and a hint. */
const PURPOSE: Partial<Record<LetterKind, { label: string; hint: string }>> = {
  warning: {
    label: msg('What happened'),
    hint: msg('Printed in the letter: the breach, with its date.'),
  },
  noc: {
    label: msg('What the company has no objection to'),
    hint: msg('For example: their travel abroad, or a driving licence.'),
  },
};

const DEFAULT_PURPOSE = {
  label: msg('Purpose'),
  hint: msg('Printed only where the text has the purpose field.'),
};

/** The person's name for an account, from the team or as the request kept it. */
function nameOf(id: string | null, names: Map<string, string>, kept?: string): string {
  if (!id) return kept || t('A team member');
  return names.get(id) || kept || t('A team member');
}

/** A letter's filled text, in its own direction: Arabic, English, or both. */
export function LetterPreview({
  texts,
  language,
}: {
  texts: LetterTexts;
  language: LetterLanguage;
}) {
  const halves: { lang: 'ar' | 'en'; subject: string; body: string }[] =
    language === 'en'
      ? [{ lang: 'en', subject: texts.subject, body: texts.body }]
      : language === 'ar'
        ? [{ lang: 'ar', subject: texts.subject, body: texts.body }]
        : [
            { lang: 'ar', subject: texts.subject, body: texts.body },
            { lang: 'en', subject: texts.subjectEn ?? '', body: texts.bodyEn ?? '' },
          ];
  return (
    <div
      role="region"
      aria-label={t('Preview')}
      className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm leading-relaxed text-slate-800"
    >
      {halves.map((half) => (
        <div
          key={half.lang}
          dir={half.lang === 'ar' ? 'rtl' : 'ltr'}
          lang={half.lang}
          className="space-y-2 text-start"
        >
          {half.subject ? <p className="font-semibold text-slate-900">{half.subject}</p> : null}
          <p className="whitespace-pre-line">{half.body}</p>
        </div>
      ))}
    </div>
  );
}

/** The texts of a letter as it would print now, for the person on this device. */
export function useLetterTexts(
  letter: EmployeeLetter | LetterDraftInput | null | undefined,
  employee: Employee | undefined,
  template: LetterTemplate | undefined,
  link: CloudLink | null | undefined,
): LetterTexts | null {
  const company = useCompany();
  const settings = usePeopleSettings();
  return useMemo(() => {
    if (!letter) return null;
    const stored = letter as Partial<EmployeeLetter>;
    const record = {
      status: stored.status ?? 'draft',
      number: stored.number ?? '',
      issuedOn: stored.issuedOn ?? null,
      language: letter.language,
      subject: letter.subject,
      body: letter.body,
      subjectEn: letter.subjectEn,
      bodyEn: letter.bodyEn,
      addressee: letter.addressee,
      purpose: letter.purpose,
    } as const;
    const context = employee
      ? letterContext(employee, company, settings, privateFieldsShown(template, link))
      : null;
    return letterTexts(record, context);
  }, [letter, employee, template, link, company, settings]);
}

/** Runs a change with its toasts; the error is shown and thrown again. */
function useAct() {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async <T,>(key: string, work: () => Promise<T>, done?: (result: T) => string) => {
    setBusy(key);
    try {
      const result = await work();
      if (done) toast.success(done(result));
      return result;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
      throw error;
    } finally {
      setBusy(null);
    }
  };
  return { busy, act };
}

/**
 * A request to issue a letter, with what the person may do about it: an
 * approver approves (the letter is issued on their device, so only one who
 * may issue letters there) or rejects it; whoever asked takes it back.
 */
export function LetterRequestActions({
  request,
  view,
}: {
  request: ApprovalRequest;
  view: Pick<LettersView, 'approver' | 'canIssue' | 'link'>;
}) {
  const { manager } = useCloud();
  const { busy, act } = useAct();
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null);
  const mine = Boolean(view.link) && request.requestedBy === view.link?.userId;
  if (request.status !== 'pending' && !(request.status === 'approved' && view.approver)) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {view.approver && !view.canIssue ? (
        <p className="w-full text-xs text-slate-500">
          {t(
            'Your access to Maham People doesn’t let you issue letters, so you can’t approve this request. The owner or another approver can.',
          )}
        </p>
      ) : null}
      {view.approver && view.canIssue && request.status === 'pending' ? (
        <Button size="sm" disabled={busy !== null} onClick={() => setDeciding('approved')}>
          <Check /> {t('Approve and issue')}
        </Button>
      ) : null}
      {view.approver && view.canIssue && request.status === 'approved' ? (
        <Button
          size="sm"
          variant="outline"
          loading={busy === 'apply'}
          disabled={busy !== null}
          onClick={() =>
            void act(
              'apply',
              () => carryOut(request.id, manager),
              () => t('Letter issued'),
            ).catch(() => undefined)
          }
        >
          {t('Carry it out again')}
        </Button>
      ) : null}
      {view.approver ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => setDeciding('rejected')}
        >
          <X /> {t('Reject')}
        </Button>
      ) : null}
      {mine && request.status === 'pending' ? (
        <Button
          size="sm"
          variant="outline"
          loading={busy === 'cancel'}
          disabled={busy !== null}
          onClick={() =>
            void act(
              'cancel',
              () => cancelApproval(request.id),
              () => t('Request taken back'),
            ).catch(() => undefined)
          }
        >
          <Undo2 /> {t('Take back')}
        </Button>
      ) : null}
      {deciding ? (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && setDeciding(null)}
          title={
            deciding === 'approved'
              ? t('Approve and issue this letter?')
              : t('Don’t issue this letter?')
          }
          description={
            deciding === 'approved'
              ? t(
                  'It is issued on this device as it was sent: it gets the next letter number, and its text is frozen.',
                )
              : t('The letter stays a draft. Whoever asked sees why.')
          }
          label={t('Note for whoever asked')}
          required={false}
          confirmLabel={deciding === 'approved' ? t('Approve and issue') : t('Reject')}
          danger={deciding === 'rejected'}
          onConfirm={(note) =>
            act(
              deciding,
              async () => {
                if (deciding === 'rejected') {
                  await decideApproval(request.id, 'rejected', note);
                  return 'done' as const;
                }
                return approve(request.id, manager, note);
              },
              (outcome) =>
                outcome === 'waiting'
                  ? t('Decided. It reaches the cloud once this device syncs.')
                  : deciding === 'approved'
                    ? t('Approved, and the letter is issued')
                    : t('Rejected'),
            ).then(() => undefined)
          }
        />
      ) : null}
    </div>
  );
}

/** Where a request to issue a letter stands, in a line. */
function RequestNote({ request, names }: { request: ApprovalRequest; names: Map<string, string> }) {
  const fmt = useFormat();
  return (
    <div className="space-y-1 text-sm">
      <p className="text-slate-700">
        {request.status === 'pending'
          ? t('Waiting for approval to issue it.')
          : request.status === 'approved'
            ? t('Approved, but not issued yet on the approver’s device.')
            : request.status === 'rejected'
              ? t('Not approved. Change it if needed and ask again.')
              : request.status === 'applied'
                ? t('Approved, and the letter is issued')
                : request.expired
                  ? t('The request expired before it was decided.')
                  : t('The request was taken back.')}
      </p>
      <p className="text-xs text-slate-500">
        {t('Asked by {name} · {date}', {
          name: nameOf(request.requestedBy, names, request.requestedByName),
          date: fmt.dateTime(request.requestedAt),
        })}
      </p>
      {request.reason ? (
        <p dir="auto" className="text-sm whitespace-pre-line text-slate-600">
          {request.reason}
        </p>
      ) : null}
      {request.decisionNote && request.status !== 'pending' ? (
        <p dir="auto" className="text-sm whitespace-pre-line text-slate-600">
          {request.decisionNote}
        </p>
      ) : null}
    </div>
  );
}

/** A request to issue a letter on the Approvals page. */
export function LetterRequestCard({
  request,
  names,
  showSubject = false,
}: {
  request: ApprovalRequest;
  names: Map<string, string>;
  showSubject?: boolean;
}) {
  const view = useLettersView();
  const templates = useLetterTemplates();
  const letter = useLiveQuery(() => db.employeeLetters.get(request.subjectId), [request.subjectId]);
  const employee = useLiveQuery(
    async () => (letter ? db.employees.get(letter.employeeId) : undefined),
    [letter?.employeeId],
  );
  const template = templates?.find((tpl) => tpl.id === letter?.templateId);
  const texts = useLetterTexts(letter, employee, template, view.link);
  const status = statusMeta(request.status);
  const kind = (request.after as { kind?: unknown } | null | undefined)?.kind;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-900">{t('Employee letter')}</span>
        {showSubject ? (
          <span className="text-sm text-slate-600">
            {t(letterKindLabel(letter?.kind ?? kind))}
            {employee ? (
              <>
                {' · '}
                <Link
                  to={`/employees/${employee.id}?tab=letters`}
                  className="text-primary-700 font-medium hover:underline"
                >
                  {localName(employee)}
                </Link>
              </>
            ) : null}
          </span>
        ) : null}
        <Badge tone={status.tone}>{t(status.label)}</Badge>
        {request.expired ? <Badge tone="gray">{t('Expired')}</Badge> : null}
      </div>
      <RequestNote request={request} names={names} />
      {letter && texts && request.status === 'pending' ? (
        <LetterPreview texts={texts} language={letterLanguage(letter.language)} />
      ) : null}
      {!letter && request.status === 'pending' ? (
        <p className="text-xs text-amber-700">
          {t('This letter isn’t on this device yet. Let it sync, then decide.')}
        </p>
      ) : null}
      <LetterRequestActions request={request} view={view} />
    </div>
  );
}

/** Sorted employees to choose from: those still working first. */
function employeeOptions(employees: Employee[]) {
  return [...employees]
    .sort(
      (a, b) =>
        Number(!isCurrent(a)) - Number(!isCurrent(b)) || localName(a).localeCompare(localName(b)),
    )
    .map((e) => ({
      value: e.id,
      label: localName(e),
      detail: [e.number, isCurrent(e) ? '' : t('Left')].filter(Boolean).join(' · '),
      keywords: `${e.name} ${e.nameAr ?? ''} ${e.number}`,
    }));
}

/** A draft from a template, for an employee and in a language. */
function fromTemplate(
  template: LetterTemplate,
  employeeId: ID,
  language: LetterLanguage,
  keep?: Pick<LetterDraftInput, 'addressee' | 'purpose' | 'id'>,
): LetterDraftInput {
  return {
    ...draftFromTemplate(template, employeeId, language),
    ...(keep ? { addressee: keep.addressee, purpose: keep.purpose } : {}),
    ...(keep?.id ? { id: keep.id } : {}),
  };
}

function draftOf(letter: EmployeeLetter): LetterDraftInput {
  return {
    id: letter.id,
    companyId: letter.companyId,
    employeeId: letter.employeeId,
    templateId: letter.templateId,
    kind: letter.kind,
    language: letterLanguage(letter.language),
    addressee: letter.addressee,
    purpose: letter.purpose,
    subject: letter.subject,
    body: letter.body,
    subjectEn: letter.subjectEn,
    bodyEn: letter.bodyEn,
    trigger: letter.trigger,
  };
}

/**
 * Makes, changes, issues or prints a letter. `letter` null makes a new one,
 * for `employeeId` when given, from the first template of `kind`.
 */
export function LetterDialog({
  letter,
  employeeId,
  kind,
  onClose,
}: {
  letter: EmployeeLetter | null;
  employeeId?: ID;
  kind?: LetterKind;
  onClose: () => void;
}) {
  const view = useLettersView();
  const templates = useLetterTemplates();
  const employees = useEmployees();
  const settings = usePeopleSettings();
  const company = useCompany();
  if (!templates || !employees || !settings || view.loading) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent title={t('Letter')} size="lg">
          <Spinner className="py-16" label={t('Loading…')} />
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <LetterDialogBody
      initial={letter}
      employeeId={employeeId}
      kind={kind}
      templates={templates}
      employees={employees}
      settings={settings}
      company={company}
      view={view}
      onClose={onClose}
    />
  );
}

function LetterDialogBody({
  initial,
  employeeId,
  kind,
  templates,
  employees,
  company,
  view,
  onClose,
}: {
  initial: EmployeeLetter | null;
  employeeId?: ID;
  kind?: LetterKind;
  templates: LetterTemplate[];
  employees: Employee[];
  settings: PeopleSettings;
  company: Company;
  view: LettersView;
  onClose: () => void;
}) {
  const fmt = useFormat();
  const confirm = useConfirm();
  const myName = useMyName();
  const { busy, act } = useAct();
  const usable = templates.filter((tpl) => !tpl.archived);
  const [id, setId] = useState<ID | null>(initial?.id ?? null);
  const stored = useLiveQuery(
    async () => (id ? ((await db.employeeLetters.get(id)) ?? null) : null),
    [id],
  );
  const request = useLiveQuery(
    async () => (id ? ((await pendingLetterRequest(id)) ?? null) : null),
    [id],
  );
  const [draft, setDraft] = useState<LetterDraftInput | null>(() => {
    if (initial) return initial.status === 'draft' ? draftOf(initial) : null;
    const first = usable.find((tpl) => tpl.kind === kind) ?? usable[0];
    if (!first) return null;
    return fromTemplate(first, employeeId ?? '', first.language);
  });
  const [changed, setChanged] = useState(false);
  const [purposeChecked, setPurposeChecked] = useState(false);
  const [asking, setAsking] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const names = useMemberNames(company.id, view.link, Boolean(request));
  const files = useLiveQuery(
    async () =>
      id && stored
        ? (await db.attachments.where('ownerId').equals(stored.employeeId).toArray()).filter(
            (f) => f.docKey === `letter:${id}`,
          )
        : [],
    [id, stored?.employeeId],
  );

  const letter = stored ?? initial;
  const isDraft = !letter || letter.status === 'draft';
  const record: EmployeeLetter | LetterDraftInput | null = isDraft ? draft : letter;
  const employee = employees.find((e) => e.id === record?.employeeId);
  const template = templates.find((tpl) => tpl.id === record?.templateId);
  const texts = useLetterTexts(record, employee, template, view.link);
  const language = letterLanguage(record?.language);
  const purpose = PURPOSE[record?.kind ?? 'custom'] ?? DEFAULT_PURPOSE;
  const purposeMissing = isDraft && draft ? missingPurpose(draft) : null;
  const pending = request ?? null;

  /** Whether the draft says what it must before it is issued or sent; shows why not. */
  const readyToIssue = () => {
    setPurposeChecked(true);
    if (!purposeMissing) return true;
    toast.error(purposeMissing);
    return false;
  };

  const set = (patch: Partial<LetterDraftInput>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setChanged(true);
  };

  const chooseTemplate = (templateId: ID) => {
    const next = templates.find((tpl) => tpl.id === templateId);
    if (!next || !draft) return;
    setDraft(fromTemplate(next, draft.employeeId, next.language, draft));
    setChanged(true);
  };

  const chooseLanguage = (value: LetterLanguage) => {
    if (!draft) return;
    const source = templates.find((tpl) => tpl.id === draft.templateId);
    setDraft({
      ...draft,
      language: value,
      ...(source ? templateTexts(source, value) : {}),
      ...(value !== 'ar-en' ? { subjectEn: undefined, bodyEn: undefined } : {}),
    });
    setChanged(true);
  };

  /** Saves the draft when it is new or changed; returns the stored letter. */
  const saveDraft = async (): Promise<EmployeeLetter> => {
    if (!draft) throw new Error(t('Something went wrong.'));
    if (!draft.employeeId) throw new Error(t('Choose the employee the letter is for.'));
    if (id && !changed && stored && stored.status === 'draft') return stored;
    const saved = await saveLetterDraft({ ...draft, ...(id ? { id } : {}) });
    setId(saved.id);
    setDraft(draftOf(saved));
    setChanged(false);
    return saved;
  };

  const save = () =>
    act('save', saveDraft, () => t('Draft saved'))
      .then(() => onClose())
      .catch(() => undefined);

  const issue = async () => {
    if (!readyToIssue()) return;
    const ok = await confirm({
      title: t('Issue this letter?'),
      description: t(
        'It gets the next letter number, and its text is frozen as it is now. An issued letter can be voided, never deleted, so its number stays used.',
      ),
      confirmLabel: t('Issue letter'),
    });
    if (!ok) return;
    await act(
      'issue',
      async () => {
        const saved = await saveDraft();
        return issueLetter(saved.id);
      },
      (issued) => t('Letter {number} issued', { number: issued.number }),
    ).catch(() => undefined);
  };

  const remove = async () => {
    if (!id) return onClose();
    const ok = await confirm({
      title: t('Delete this draft?'),
      description: t('It has no number yet, so none is used.'),
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    await act(
      'delete',
      () => deleteLetterDraft(id),
      () => t('Draft deleted'),
    )
      .then(() => onClose())
      .catch(() => undefined);
  };

  const title = letter?.number
    ? t('{kind} {number}', { kind: t(letterKindLabel(letter.kind)), number: letter.number })
    : record
      ? t(letterKindLabel(record.kind))
      : t('New letter');

  if (!record) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent title={t('New letter')}>
          <DialogBody>
            <p className="text-sm text-slate-600">
              {t('There is no letter template to make it from. Add one in Letter templates.')}
            </p>
          </DialogBody>
          <DialogFooter>
            <ButtonLink to="/people/letters/templates" variant="outline">
              {t('Letter templates')}
            </ButtonLink>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const options = employeeOptions(employees);
  const templateChoices = usable.some((tpl) => tpl.id === draft?.templateId)
    ? usable
    : [...usable, ...(template ? [template] : [])];
  const privateMasked =
    isDraft &&
    !view.canIssue &&
    template?.privateFields === true &&
    usesPrivateFields(`${record.body}\n${record.bodyEn ?? ''}`);
  const back = employeeId ? `/employees/${employeeId}?tab=letters` : '/people/letters';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={title}
        description={
          employee
            ? `${localName(employee)} · ${employee.number}`
            : t('Made from a template, with the employee’s record.')
        }
        size="xl"
      >
        <DialogBody>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={letterStatusTone(letter?.status ?? 'draft')}>
              {t(letterStatusLabel(letter?.status ?? 'draft'))}
            </Badge>
            {letter?.issuedOn ? (
              <span className="text-sm text-slate-600">
                {t('Issued on {date}', { date: fmt.date(letter.issuedOn) })}
              </span>
            ) : null}
            {letter?.trigger ? (
              <Badge tone="blue">{t(letterTriggerNote(letter.trigger))}</Badge>
            ) : null}
            {letter?.status === 'issued' && !letter.printedAt ? (
              <Badge tone="violet">{t('Not printed yet')}</Badge>
            ) : null}
          </div>

          {letter?.status === 'void' ? (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
              {t('Void on {date}: {reason}', {
                date: fmt.date(letter.voidedOn ?? null),
                reason: letter.voidReason ?? '',
              })}
            </p>
          ) : null}

          {pending ? (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3">
              <RequestNote request={pending} names={names} />
              <LetterRequestActions request={pending} view={view} />
            </div>
          ) : null}

          {isDraft && draft && !pending ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('Employee')}>
                {(field) => (
                  <Combobox
                    id={field}
                    value={draft.employeeId || null}
                    onChange={(value) => set({ employeeId: value })}
                    options={options}
                    disabled={Boolean(employeeId) || Boolean(id)}
                    placeholder={t('Choose an employee')}
                    searchPlaceholder={t('Search employees…')}
                    emptyText={t('No employees found')}
                  />
                )}
              </Field>
              <Field label={t('Template')}>
                {(field) => (
                  <Select
                    id={field}
                    value={draft.templateId ?? ''}
                    onChange={(e) => chooseTemplate(e.target.value)}
                  >
                    {templateChoices.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {localName(tpl) || t(letterKindLabel(tpl.kind))}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('Printed in')}>
                {(field) => (
                  <Select
                    id={field}
                    value={draft.language}
                    onChange={(e) => chooseLanguage(letterLanguage(e.target.value))}
                  >
                    {LETTER_LANGUAGES.map((value) => (
                      <option key={value} value={value}>
                        {t(LETTER_LANGUAGE_LABELS[value])}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('Addressed to')} optional>
                {(field) => (
                  <Input
                    id={field}
                    value={draft.addressee}
                    onChange={(e) => set({ addressee: e.target.value })}
                    placeholder={t('To whom it may concern')}
                    dir="auto"
                  />
                )}
              </Field>
              <Field
                label={t(purpose.label)}
                hint={t(purpose.hint)}
                optional={record.kind !== 'warning' && record.kind !== 'noc'}
                error={purposeChecked && purposeMissing ? purposeMissing : undefined}
                className="sm:col-span-2"
              >
                {(field) => (
                  <Textarea
                    id={field}
                    value={draft.purpose}
                    onChange={(e) => set({ purpose: e.target.value })}
                    rows={2}
                    dir="auto"
                  />
                )}
              </Field>
              <details className="sm:col-span-2">
                <summary className="text-primary-700 cursor-pointer text-sm font-medium">
                  {t('Change the wording of this letter')}
                </summary>
                <div className="mt-3 space-y-3">
                  <p className="text-xs text-slate-500">
                    {t(
                      'Fields in braces, such as {employee.name}, are filled from the employee’s record when the letter is issued. Only this letter changes, not the template.',
                    )}
                  </p>
                  <Wording
                    label={language === 'en' ? t('English') : t('Arabic')}
                    dir={language === 'en' ? 'ltr' : 'rtl'}
                    subject={draft.subject}
                    body={draft.body}
                    onChange={(patch) => set(patch)}
                  />
                  {language === 'ar-en' ? (
                    <Wording
                      label={t('English')}
                      dir="ltr"
                      subject={draft.subjectEn ?? ''}
                      body={draft.bodyEn ?? ''}
                      onChange={(patch) =>
                        set({
                          ...(patch.subject !== undefined ? { subjectEn: patch.subject } : {}),
                          ...(patch.body !== undefined ? { bodyEn: patch.body } : {}),
                        })
                      }
                    />
                  ) : null}
                </div>
              </details>
            </div>
          ) : null}

          {privateMasked ? (
            <p className="text-xs text-slate-500">
              {t(
                'The Civil ID, passport number and bank account show masked to you. They are filled in when the owner, an admin or an approver issues the letter.',
              )}
            </p>
          ) : null}

          {texts ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-slate-500">
                {isDraft ? t('Preview') : t('As issued')}
              </p>
              <LetterPreview texts={texts} language={language} />
            </div>
          ) : null}

          {letter?.status === 'issued' && files ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-800">{t('Signed copy')}</p>
              <FileList
                files={files}
                emptyText={t(
                  'Once it is signed, keep a scan in the employee’s personnel file here.',
                )}
                addLabel={t('Attach the signed copy')}
                onAdd={async (file) => {
                  await addSignedCopy(letter, file);
                  toast.success(t('File added'));
                }}
                onRemove={async (file) => {
                  const ok = await confirm({
                    title: t('Remove {name}?', { name: file.name }),
                    confirmLabel: t('Remove'),
                    danger: true,
                  });
                  if (ok) await removeAttachment(file.id);
                }}
              />
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {isDraft && id && !pending && view.canDraft ? (
            <Button
              variant="ghost"
              className="sm:me-auto"
              onClick={() => void remove()}
              disabled={busy !== null}
            >
              <Trash2 /> {t('Delete draft')}
            </Button>
          ) : null}
          {letter && letter.status === 'issued' && view.canIssue ? (
            <Button
              variant="ghost"
              className="sm:me-auto"
              onClick={() => setVoiding(true)}
              disabled={busy !== null}
            >
              <Ban /> {t('Void letter')}
            </Button>
          ) : null}
          {id ? (
            <ButtonLink
              to={`/people/letters/${encodeURIComponent(id)}/print?back=${encodeURIComponent(back)}`}
              variant="outline"
            >
              <Printer /> {t('Print')}
            </ButtonLink>
          ) : null}
          {isDraft && !pending && view.canDraft ? (
            <>
              <Button
                variant="outline"
                onClick={() => void save()}
                loading={busy === 'save'}
                disabled={busy !== null}
              >
                {t('Save draft')}
              </Button>
              {view.canIssue ? (
                <Button
                  onClick={() => void issue()}
                  loading={busy === 'issue'}
                  disabled={busy !== null}
                >
                  <FileSignature /> {t('Issue letter')}
                </Button>
              ) : view.asks ? (
                <Button
                  onClick={() => readyToIssue() && setAsking(true)}
                  loading={busy === 'ask'}
                  disabled={busy !== null}
                >
                  <Send /> {t('Send for approval')}
                </Button>
              ) : null}
            </>
          ) : null}
        </DialogFooter>
        {asking ? (
          <ReasonDialog
            open
            onOpenChange={setAsking}
            title={t('Ask for approval to issue this letter?')}
            description={t(
              'The owner, or a member the owner allowed to approve, checks it and issues it. Until then it stays a draft, and can’t be changed unless the request is taken back.',
            )}
            label={t('Note for the approver')}
            required={false}
            confirmLabel={t('Send for approval')}
            onConfirm={(note) =>
              act(
                'ask',
                async () => {
                  const saved = await saveDraft();
                  return requestLetterIssue(saved.id, { note, byName: myName });
                },
                () => t('Sent for approval'),
              ).then(() => undefined)
            }
          />
        ) : null}
        {voiding && letter ? (
          <ReasonDialog
            open
            onOpenChange={setVoiding}
            title={t('Void letter {number}?', { number: letter.number })}
            description={t(
              'It keeps its number, which is never given again, and prints as void. Make a new letter in its place if one is needed.',
            )}
            label={t('Why is it void?')}
            missing={t('Say why the letter is void.')}
            confirmLabel={t('Void letter')}
            danger
            onConfirm={(reason) =>
              act(
                'void',
                () => voidLetter(letter.id, reason),
                () => t('Letter voided'),
              ).then(() => undefined)
            }
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** The subject and text of a letter in one language, as they will be filled. */
function Wording({
  label,
  dir,
  subject,
  body,
  onChange,
}: {
  label: string;
  dir: 'ltr' | 'rtl';
  subject: string;
  body: string;
  onChange: (patch: { subject?: string; body?: string }) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-700">{label}</legend>
      <Input
        value={subject}
        onChange={(e) => onChange({ subject: e.target.value })}
        dir={dir}
        aria-label={t('Subject ({language})', { language: label })}
      />
      <Textarea
        value={body}
        onChange={(e) => onChange({ body: e.target.value })}
        dir={dir}
        rows={10}
        aria-label={t('Text ({language})', { language: label })}
      />
    </fieldset>
  );
}
