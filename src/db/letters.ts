import Dexie from 'dexie';
import { db } from './db';
import { defaultNumbering, nowStamp } from './defaults';
import { logActivity } from './activity';
import { getPeopleSettings, normalizePeopleSettings } from './people';
import { addAttachment } from './purchases';
import { ApprovalError, approverOf, logRequest } from './approvals';
import type {
  ApprovalRequest,
  Attachment,
  Company,
  Employee,
  EmployeeLetter,
  ID,
  ISODate,
  LetterKind,
  LetterLanguage,
  LetterTemplate,
  LetterTrigger,
  PeopleSettings,
} from './types';
import { msg, t } from '@/i18n';
import { newId, stableId } from '@/lib/ids';
import { isISODate, today } from '@/lib/dates';
import { allocateFrom, allocateNumber, canReserveCounters, reserveCounter } from '@/lib/numbering';
import {
  DEFAULT_LETTER_KINDS,
  LETTER_KINDS,
  LETTER_TRIGGERS,
  fillLetter,
  letterLanguage,
  letterPay,
  letterValues,
  type LetterContext,
} from '@/lib/hr/letters';
import {
  defaultTemplate,
  defaultTemplateId,
  defaultTemplateKind,
  templateFromWording,
} from '@/lib/hr/letter-templates';
import {
  canWriteRecord,
  isLetterApproval,
  issuesLetters,
  lettersSwitchedOn,
  limitBlocksWrite,
  switchesLetters,
} from '@/cloud/roles';
import { linkHasFeature } from '@/cloud/features';
import type { CloudLink } from '@/cloud/types';

/**
 * Employee letters (#19 of docs/requirements-plan.md): salary, experience
 * and employment certificates, warning letters and no objection
 * certificates, from the company's templates (`letterTemplates`), filled
 * with the employee's record and printed. Both tables are private, like the
 * rest of People.
 *
 * Off until the owner or an admin turns letters on (PeopleSettings.letters;
 * in a company kept in the cloud once its server has employee_letters).
 * Owners, admins and approvers issue letters; accountants draft them and ask
 * an approver through the approvals service (D6, kind `letter`), who issues
 * the letter on their device. A letter is numbered at issue only, with the
 * company's letter rule (HR-{year}-{counter}, from 1 again each year), and
 * its text is frozen then: the number is never used twice (D12), a void
 * letter keeps it, an issued one is never deleted and a draft deleted uses
 * none. "Automatic" means drafts only: a template may make a draft when an
 * employee joins, leaves or has their salary changed; a person checks,
 * issues and prints it. Letters are never emailed (D14).
 */

export class LetterError extends Error {}

/** Drafts one save of an employee makes at most. */
export const MAX_AUTO_DRAFTS = 5;

/* -------------------------------------------------------------------------- */
/* Who and when                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Whether the company may use letters: always when kept on this device
 * (`link` null), in the cloud once its server has employee_letters. Not
 * while the link is read (`undefined`).
 */
export function lettersAvailable(link: CloudLink | null | undefined): boolean {
  return link !== undefined && linkHasFeature(link, 'employee_letters');
}

/** Whether letters are on in the company: available, and switched on. */
export function lettersInEffect(
  settings: Pick<PeopleSettings, 'letters'> | null | undefined,
  link: CloudLink | null | undefined,
): boolean {
  return lettersAvailable(link) && lettersSwitchedOn(settings);
}

/** Whether the person issues letters (the owner, an admin or an approver; anyone on this device). */
export function canIssueLetters(link: CloudLink | null | undefined): boolean {
  if (link === undefined) return false;
  return issuesLetters(link?.role ?? null, link?.approver) && canDraftLetters(link);
}

/** Whether the person may write letters at all (the role, and the owner's limits on People). */
export function canDraftLetters(link: CloudLink | null | undefined): boolean {
  if (link === undefined) return false;
  if (!link) return true;
  return (
    link.status !== 'removed' &&
    canWriteRecord(link.role, 'employeeLetters', {}) &&
    !limitBlocksWrite(link.role, link.permissions, 'employeeLetters', {})
  );
}

/** Whether the person asks an approver to issue (an accountant who isn't one). */
export function asksToIssue(link: CloudLink | null | undefined): boolean {
  return Boolean(link) && canDraftLetters(link) && !canIssueLetters(link);
}

async function linkOf(companyId: ID): Promise<CloudLink | null> {
  return (await db.syncState.get(companyId)) ?? null;
}

/**
 * Turns the company's letters on or off (the owner or an admin). Templates
 * and letters already made stay as they are.
 */
export async function setLettersOn(companyId: ID, on: boolean): Promise<PeopleSettings> {
  return db.transaction('rw', [db.peopleSettings, db.activities, db.syncState], async () => {
    const link = await linkOf(companyId);
    if (link && !switchesLetters(link.role)) {
      throw new LetterError(t('Only the owner or an admin turns employee letters on or off.'));
    }
    if (!lettersAvailable(link)) {
      throw new LetterError(
        t(
          'The cloud needs the latest database script first. Ask the owner of the company to run it.',
        ),
      );
    }
    const before = await getPeopleSettings(companyId);
    if ((before.letters === true) === on) return before;
    const settings = {
      ...normalizePeopleSettings({ ...before, letters: on }),
      updatedAt: nowStamp(),
    };
    await db.peopleSettings.put(settings);
    // Private, like the rest of payroll and people.
    await logActivity(companyId, 'payroll', settings.id, 'settings', {
      text: on ? msg('Employee letters turned on') : msg('Employee letters turned off'),
    });
    return settings;
  });
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

const MAX_TEXT = 20_000;
const MAX_NAME = 200;

const kindOrder = (kind: LetterKind) => {
  const at = LETTER_KINDS.indexOf(kind);
  return at < 0 ? LETTER_KINDS.length : at;
};

/** Templates in the order they are offered: by kind, then by name. */
export function sortTemplates(list: LetterTemplate[]): LetterTemplate[] {
  return [...list].sort(
    (a, b) => kindOrder(a.kind) - kindOrder(b.kind) || a.name.localeCompare(b.name),
  );
}

/**
 * The company's templates: those it saved, and the default ones (the
 * first letters) as written in the app until someone changes them.
 */
export async function listTemplates(companyId: ID): Promise<LetterTemplate[]> {
  const stored = await db.letterTemplates.where('companyId').equals(companyId).toArray();
  const ids = new Set(stored.map((tpl) => tpl.id));
  const defaults = DEFAULT_LETTER_KINDS.map((kind) => defaultTemplate(companyId, kind)).filter(
    (tpl) => !ids.has(tpl.id),
  );
  return sortTemplates([...stored, ...defaults]);
}

/** A template of the company, stored or default; undefined when there is none. */
export async function getTemplate(companyId: ID, id: ID): Promise<LetterTemplate | undefined> {
  const stored = await db.letterTemplates.get(id);
  if (stored) return stored.companyId === companyId ? stored : undefined;
  const kind = defaultTemplateKind(id);
  if (!kind || id !== defaultTemplateId(companyId, kind)) return undefined;
  return defaultTemplate(companyId, kind);
}

/** A new template of a kind, with that kind's starting wording (not saved yet). */
export function newTemplate(companyId: ID, kind: LetterKind): LetterTemplate {
  return templateFromWording(companyId, kind, newId(), nowStamp());
}

const tidyLine = (text: string | undefined, max = MAX_NAME) =>
  (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const tidyText = (text: string | undefined) =>
  (text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_TEXT);

/** A template as it is stored: tidy, with only the kinds, languages and events this version knows. */
export function normalizeTemplate(input: LetterTemplate): LetterTemplate {
  const autoOn = [...new Set((input.autoOn ?? []).filter((x) => LETTER_TRIGGERS.includes(x)))];
  const out: LetterTemplate = {
    ...input,
    kind: LETTER_KINDS.includes(input.kind) ? input.kind : 'custom',
    name: tidyLine(input.name),
    nameAr: tidyLine(input.nameAr),
    language: letterLanguage(input.language),
    subjectEn: tidyLine(input.subjectEn, 300),
    subjectAr: tidyLine(input.subjectAr, 300),
    bodyEn: tidyText(input.bodyEn),
    bodyAr: tidyText(input.bodyAr),
    showStamp: input.showStamp === true,
    showSignature: input.showSignature === true,
    signatoryName: tidyLine(input.signatoryName),
    signatoryTitle: tidyLine(input.signatoryTitle),
    archived: input.archived === true,
  };
  delete out.autoOn;
  delete out.privateFields;
  if (autoOn.length) out.autoOn = autoOn;
  if (input.privateFields === true) out.privateFields = true;
  return out;
}

/** What a template must have before it is saved, for the language it is printed in. */
function checkTemplate(template: LetterTemplate): void {
  if (!template.name && !template.nameAr) throw new LetterError(t('Give the template a name.'));
  const arabic = template.language !== 'en';
  const english = template.language !== 'ar';
  if (arabic && !template.bodyAr) throw new LetterError(t('Write the letter’s Arabic text.'));
  if (english && !template.bodyEn) throw new LetterError(t('Write the letter’s English text.'));
}

/**
 * Saves a template. Only someone who issues letters lets it show the Civil
 * ID, passport number and bank account (privateFields); anyone else keeps
 * what was saved.
 */
export async function saveTemplate(input: LetterTemplate): Promise<LetterTemplate> {
  return db.transaction(
    'rw',
    [db.letterTemplates, db.activities, db.syncState, db.peopleSettings],
    async () => {
      const link = await linkOf(input.companyId);
      if (!canDraftLetters(link)) {
        throw new LetterError(t('Your role can’t change letter templates.'));
      }
      const stored =
        (await db.letterTemplates.get(input.id)) ?? (await getTemplate(input.companyId, input.id));
      if (stored && stored.companyId !== input.companyId) {
        throw new LetterError(t('This template could not be found.'));
      }
      const template = normalizeTemplate({
        ...input,
        createdAt: stored?.createdAt || input.createdAt || nowStamp(),
        updatedAt: nowStamp(),
      });
      if (!canIssueLetters(link)) {
        delete template.privateFields;
        if (stored?.privateFields === true) template.privateFields = true;
      }
      checkTemplate(template);
      await db.letterTemplates.put(template);
      await logActivity(template.companyId, 'payroll', template.id, 'letter_template', {
        text: msg('Letter template {name} saved'),
        vars: { name: template.name || template.nameAr || '' },
        arabic: { name: template.nameAr },
      });
      return template;
    },
  );
}

/** Archives a template (no new letters from it) or brings it back. Letters made from it stay. */
export async function setTemplateArchived(
  companyId: ID,
  id: ID,
  archived: boolean,
): Promise<LetterTemplate> {
  const template = await getTemplate(companyId, id);
  if (!template) throw new LetterError(t('This template could not be found.'));
  return saveTemplate({ ...template, archived });
}

/** Puts a default template back to the app's wording (its other settings stay). */
export async function restoreDefaultWording(companyId: ID, id: ID): Promise<LetterTemplate> {
  const template = await getTemplate(companyId, id);
  const kind = defaultTemplateKind(id);
  if (!template || !kind) throw new LetterError(t('This template has no default wording.'));
  const wording = defaultTemplate(companyId, kind);
  return saveTemplate({
    ...template,
    name: wording.name,
    nameAr: wording.nameAr,
    subjectEn: wording.subjectEn,
    subjectAr: wording.subjectAr,
    bodyEn: wording.bodyEn,
    bodyAr: wording.bodyAr,
  });
}

/* -------------------------------------------------------------------------- */
/* The text of a letter                                                       */
/* -------------------------------------------------------------------------- */

/** The texts a letter takes from a template, in a language. */
export function templateTexts(
  template: Pick<LetterTemplate, 'subjectEn' | 'subjectAr' | 'bodyEn' | 'bodyAr'>,
  language: LetterLanguage,
): Pick<EmployeeLetter, 'subject' | 'body' | 'subjectEn' | 'bodyEn'> {
  if (language === 'en') return { subject: template.subjectEn, body: template.bodyEn };
  if (language === 'ar') return { subject: template.subjectAr, body: template.bodyAr };
  return {
    subject: template.subjectAr,
    body: template.bodyAr,
    subjectEn: template.subjectEn,
    bodyEn: template.bodyEn,
  };
}

/** The filled texts of a letter, as it would be printed now. */
export interface LetterTexts {
  subject: string;
  body: string;
  /** The English half of a letter in Arabic and English. */
  subjectEn?: string;
  bodyEn?: string;
}

/**
 * A letter's texts: an issued (or void) letter's as frozen at issue; a
 * draft's filled with the employee's record as it is now, its number left
 * empty until it is issued.
 */
export function letterTexts(
  letter: Pick<
    EmployeeLetter,
    | 'status'
    | 'language'
    | 'subject'
    | 'body'
    | 'subjectEn'
    | 'bodyEn'
    | 'number'
    | 'issuedOn'
    | 'addressee'
    | 'purpose'
  >,
  context: Omit<LetterContext, 'letter'> | null,
  on: ISODate = today(),
): LetterTexts {
  const language = letterLanguage(letter.language);
  const bilingual = language === 'ar-en';
  if (letter.status !== 'draft' || !context) {
    return {
      subject: letter.subject,
      body: letter.body,
      ...(bilingual ? { subjectEn: letter.subjectEn ?? '', bodyEn: letter.bodyEn ?? '' } : {}),
    };
  }
  const ctx: LetterContext = {
    ...context,
    letter: {
      number: letter.number,
      date: letter.issuedOn ?? on,
      addressee: letter.addressee,
      purpose: letter.purpose,
    },
  };
  const main = letterValues(ctx, language === 'en' ? 'en' : 'ar');
  const texts: LetterTexts = {
    subject: fillLetter(letter.subject, main),
    body: fillLetter(letter.body, main),
  };
  if (bilingual) {
    const english = letterValues(ctx, 'en');
    texts.subjectEn = fillLetter(letter.subjectEn ?? '', english);
    texts.bodyEn = fillLetter(letter.bodyEn ?? '', english);
  }
  return texts;
}

/* -------------------------------------------------------------------------- */
/* Drafts                                                                     */
/* -------------------------------------------------------------------------- */

/** What a draft is made of. */
export interface LetterDraftInput {
  /** Given for a draft already saved. */
  id?: ID;
  companyId: ID;
  employeeId: ID;
  templateId: ID | null;
  kind: LetterKind;
  language: LetterLanguage;
  addressee: string;
  purpose: string;
  subject: string;
  body: string;
  subjectEn?: string;
  bodyEn?: string;
  trigger?: LetterTrigger | null;
}

/** A new draft from a template, for an employee (not saved yet). */
export function draftFromTemplate(
  template: LetterTemplate,
  employeeId: ID,
  language: LetterLanguage = template.language,
): LetterDraftInput {
  return {
    companyId: template.companyId,
    employeeId,
    templateId: template.id,
    kind: template.kind,
    language: letterLanguage(language),
    addressee: '',
    purpose: '',
    ...templateTexts(template, letterLanguage(language)),
  };
}

/** The request waiting to issue a letter, if any. */
export async function pendingLetterRequest(letterId: ID): Promise<ApprovalRequest | undefined> {
  return db.approvals
    .where('subjectId')
    .equals(letterId)
    .filter((r) => r.status === 'pending' && isLetterApproval(r))
    .first();
}

function draftRecord(
  input: LetterDraftInput,
  existing: EmployeeLetter | undefined,
  id: ID,
): EmployeeLetter {
  const language = letterLanguage(input.language);
  const stamp = nowStamp();
  const letter: EmployeeLetter = {
    ...(existing ?? {}),
    id,
    companyId: input.companyId,
    employeeId: input.employeeId,
    templateId: input.templateId,
    kind: LETTER_KINDS.includes(input.kind) ? input.kind : 'custom',
    number: '',
    language,
    addressee: tidyLine(input.addressee, 300),
    purpose: tidyText(input.purpose).slice(0, 2000),
    subject: tidyLine(input.subject, 300),
    body: tidyText(input.body),
    issuedOn: null,
    status: 'draft',
    trigger: existing ? existing.trigger : (input.trigger ?? null),
    createdAt: existing?.createdAt ?? stamp,
    updatedAt: stamp,
  };
  delete letter.subjectEn;
  delete letter.bodyEn;
  if (language === 'ar-en') {
    letter.subjectEn = tidyLine(input.subjectEn, 300);
    letter.bodyEn = tidyText(input.bodyEn);
  }
  return letter;
}

/**
 * Saves a draft letter, new or changed. Issued and void letters don't
 * change; nor does a draft waiting for approval (take the request back
 * first).
 */
export async function saveLetterDraft(input: LetterDraftInput): Promise<EmployeeLetter> {
  return db.transaction(
    'rw',
    [
      db.employeeLetters,
      db.employees,
      db.peopleSettings,
      db.syncState,
      db.approvals,
      db.activities,
    ],
    async () => {
      const link = await linkOf(input.companyId);
      const settings = await getPeopleSettings(input.companyId);
      if (!lettersInEffect(settings, link)) {
        throw new LetterError(t('Employee letters are off for this company.'));
      }
      if (!canDraftLetters(link)) throw new LetterError(t('Your role can’t make letters.'));
      const employee = await db.employees.get(input.employeeId);
      if (!employee || employee.companyId !== input.companyId) {
        throw new LetterError(t('Choose the employee the letter is for.'));
      }
      const existing = input.id ? await db.employeeLetters.get(input.id) : undefined;
      if (existing && existing.companyId !== input.companyId) {
        throw new LetterError(t('This letter could not be found.'));
      }
      if (existing && existing.status !== 'draft') {
        throw new LetterError(t('This letter is issued, so it can’t be changed.'));
      }
      if (existing && (await pendingLetterRequest(existing.id))) {
        throw new LetterError(
          t('This letter is waiting for approval. Take the request back to change it.'),
        );
      }
      const letter = draftRecord(input, existing, existing?.id ?? input.id ?? newId());
      if (!letter.body) throw new LetterError(t('Write the letter’s text.'));
      if (letter.language === 'ar-en' && !letter.bodyEn) {
        throw new LetterError(t('Write the letter’s English text.'));
      }
      await db.employeeLetters.put(letter);
      if (!existing) {
        await logActivity(
          input.companyId,
          'employee',
          employee.id,
          'letter_draft',
          {
            text: msg('Letter draft made for {name}'),
            vars: { name: employee.name },
            arabic: { name: employee.nameAr },
          },
          { employeeId: employee.id },
        );
      }
      return letter;
    },
  );
}

/** Deletes a draft. Issued and void letters stay, so their numbers stay used. */
export async function deleteLetterDraft(id: ID): Promise<void> {
  await db.transaction('rw', [db.employeeLetters, db.approvals, db.attachments], async () => {
    const letter = await db.employeeLetters.get(id);
    if (!letter) return;
    if (letter.status !== 'draft') {
      throw new LetterError(
        t('Issued letters are kept, so their numbers stay used. Void it instead.'),
      );
    }
    if (await pendingLetterRequest(id)) {
      throw new LetterError(
        t('This letter is waiting for approval. Take the request back to delete it.'),
      );
    }
    await db.employeeLetters.delete(id);
  });
}

/* -------------------------------------------------------------------------- */
/* Issuing                                                                    */
/* -------------------------------------------------------------------------- */

/** The context a letter of this employee is filled with. */
export function letterContext(
  employee: Employee,
  company: Company,
  settings: Pick<PeopleSettings, 'departments'> | null | undefined,
  privateFields: boolean,
): Omit<LetterContext, 'letter'> {
  return { employee, company, departments: settings?.departments ?? null, privateFields };
}

/** Whether the private fields of a letter are filled in for this person. */
export function privateFieldsShown(
  template: Pick<LetterTemplate, 'privateFields'> | null | undefined,
  link: CloudLink | null | undefined,
): boolean {
  return template?.privateFields === true && canIssueLetters(link);
}

async function takenLetterNumbers(companyId: ID, exceptId: ID): Promise<Set<string>> {
  const letters = await db.employeeLetters.where('companyId').equals(companyId).toArray();
  return new Set(
    letters.filter((l) => l.id !== exceptId && l.number).map((l) => l.number.toLowerCase()),
  );
}

/**
 * Issues a draft: gives it the next letter number of its year, fills its
 * text with the employee's record as it is now and freezes it, with who
 * signs and whether the stamp and signature print. In a company kept in
 * the cloud the number comes from the company's counter there when it can
 * be reached, so two devices never give the same one. Only the owner, an
 * admin or an approver issues; accountants ask (requestLetterIssue).
 */
export async function issueLetter(id: ID, on: ISODate = today()): Promise<EmployeeLetter> {
  if (!isISODate(on)) throw new LetterError(t('Choose the letter’s date.'));
  const first = await db.employeeLetters.get(id);
  if (!first) throw new LetterError(t('This letter could not be found.'));
  if (first.status !== 'draft') throw new LetterError(t('This letter is already issued.'));
  const company = await db.companies.get(first.companyId);
  if (!company) throw new LetterError(t('Company not found'));
  // The cloud's counter, asked before the transaction (it can't wait on the network).
  let reserved = null;
  if (canReserveCounters() && !Dexie.currentTransaction) {
    const rule = company.numbering.letter ?? defaultNumbering().letter;
    const taken = await takenLetterNumbers(company.id, id);
    const local = allocateNumber(rule, on, (n) => taken.has(n.toLowerCase()));
    reserved = await reserveCounter({
      companyId: company.id,
      kind: 'letter',
      date: on,
      min: local.rule.next - 1,
    });
  }
  return db.transaction(
    'rw',
    [
      db.employeeLetters,
      db.letterTemplates,
      db.employees,
      db.companies,
      db.peopleSettings,
      db.syncState,
      db.activities,
    ],
    async () => {
      const letter = await db.employeeLetters.get(id);
      if (!letter) throw new LetterError(t('This letter could not be found.'));
      if (letter.status !== 'draft') throw new LetterError(t('This letter is already issued.'));
      const [link, settings, employee, current] = await Promise.all([
        linkOf(letter.companyId),
        getPeopleSettings(letter.companyId),
        db.employees.get(letter.employeeId),
        db.companies.get(letter.companyId),
      ]);
      if (!current) throw new LetterError(t('Company not found'));
      if (!lettersInEffect(settings, link)) {
        throw new LetterError(t('Employee letters are off for this company.'));
      }
      if (!canIssueLetters(link)) {
        throw new LetterError(
          t('Only the owner, an admin or an approver issues letters. Ask for approval instead.'),
        );
      }
      if (!employee) throw new LetterError(t('The employee of this letter no longer exists.'));
      const template = letter.templateId
        ? await getTemplate(letter.companyId, letter.templateId)
        : undefined;
      const rule = current.numbering.letter ?? defaultNumbering().letter;
      const taken = await takenLetterNumbers(current.id, letter.id);
      const allocated = allocateFrom(rule, on, (n) => taken.has(n.toLowerCase()), '', reserved);
      await db.companies.put({
        ...current,
        numbering: { ...current.numbering, letter: allocated.rule },
      });
      const texts = letterTexts(
        { ...letter, number: allocated.number, issuedOn: on },
        letterContext(employee, current, settings, privateFieldsShown(template, link)),
        on,
      );
      const issued: EmployeeLetter = {
        ...letter,
        ...texts,
        number: allocated.number,
        issuedOn: on,
        status: 'issued',
        signatoryName: template?.signatoryName ?? '',
        signatoryTitle: template?.signatoryTitle ?? '',
        showStamp: template ? template.showStamp : true,
        showSignature: template ? template.showSignature : true,
        updatedAt: nowStamp(),
      };
      if (letterLanguage(letter.language) !== 'ar-en') {
        delete issued.subjectEn;
        delete issued.bodyEn;
      }
      await db.employeeLetters.put(issued);
      await logActivity(
        letter.companyId,
        'employee',
        employee.id,
        'letter_issued',
        { text: msg('Letter {number} issued'), vars: { number: issued.number } },
        { employeeId: employee.id },
      );
      return issued;
    },
  );
}

/** Voids an issued letter, with why. It keeps its number, which is never given again. */
export async function voidLetter(id: ID, reason: string): Promise<EmployeeLetter> {
  const why = reason.trim();
  if (!why) throw new LetterError(t('Say why the letter is void.'));
  return db.transaction(
    'rw',
    [db.employeeLetters, db.syncState, db.peopleSettings, db.activities],
    async () => {
      const letter = await db.employeeLetters.get(id);
      if (!letter) throw new LetterError(t('This letter could not be found.'));
      if (letter.status !== 'issued') throw new LetterError(t('Only an issued letter is voided.'));
      const link = await linkOf(letter.companyId);
      if (!canIssueLetters(link)) {
        throw new LetterError(t('Only the owner, an admin or an approver voids letters.'));
      }
      const voided: EmployeeLetter = {
        ...letter,
        status: 'void',
        voidReason: why.slice(0, 1000),
        voidedOn: today(),
        updatedAt: nowStamp(),
      };
      await db.employeeLetters.put(voided);
      await logActivity(
        letter.companyId,
        'employee',
        letter.employeeId,
        'letter_void',
        { text: msg('Letter {number} voided'), vars: { number: letter.number } },
        { employeeId: letter.employeeId },
      );
      return voided;
    },
  );
}

/** Notes that issued letters were printed (they leave Letters to print). */
export async function markLettersPrinted(ids: ID[]): Promise<void> {
  if (ids.length === 0) return;
  await db.transaction('rw', [db.employeeLetters], async () => {
    const stamp = nowStamp();
    for (const letter of await db.employeeLetters.bulkGet(ids)) {
      if (!letter || letter.status !== 'issued') continue;
      await db.employeeLetters.put({ ...letter, printedAt: stamp, updatedAt: stamp });
    }
  });
}

/** Keeps the signed copy of an issued letter in the employee's personnel file. */
export async function addSignedCopy(
  letter: Pick<EmployeeLetter, 'id' | 'companyId' | 'employeeId' | 'status'>,
  file: { name: string; type: string; dataUrl: string },
): Promise<Attachment> {
  if (letter.status === 'draft') throw new LetterError(t('Issue the letter first.'));
  return addAttachment(letter.companyId, letter.employeeId, file, {
    docKey: `letter:${letter.id}`,
    validUntil: null,
  });
}

/* -------------------------------------------------------------------------- */
/* Asking an approver                                                         */
/* -------------------------------------------------------------------------- */

/** What a request to issue a letter carries (ApprovalRequest.after). */
export interface LetterRequestDetails {
  /** The draft's updatedAt when it was sent: issued only as it was then. */
  letterUpdatedAt: string;
  kind: LetterKind;
  employeeId: ID;
}

export function letterRequestDetails(request: ApprovalRequest): LetterRequestDetails | null {
  const after = request.after as Partial<LetterRequestDetails> | null | undefined;
  if (!after || typeof after.letterUpdatedAt !== 'string') return null;
  return {
    letterUpdatedAt: after.letterUpdatedAt,
    kind: (after.kind as LetterKind) ?? 'custom',
    employeeId: typeof after.employeeId === 'string' ? after.employeeId : '',
  };
}

/**
 * Asks an approver to issue a draft (an accountant who doesn't issue
 * letters), with an optional note. One request waits on a letter at a time.
 */
export async function requestLetterIssue(
  id: ID,
  input: { note?: string; byName?: string } = {},
): Promise<ApprovalRequest> {
  return db.transaction(
    'rw',
    [
      db.approvals,
      db.employeeLetters,
      db.employees,
      db.peopleSettings,
      db.syncState,
      db.activities,
    ],
    async () => {
      const letter = await db.employeeLetters.get(id);
      if (!letter) throw new ApprovalError(t('This letter could not be found.'));
      if (letter.status !== 'draft') {
        throw new ApprovalError(t('This letter is already issued.'));
      }
      const [link, settings, employee] = await Promise.all([
        linkOf(letter.companyId),
        getPeopleSettings(letter.companyId),
        db.employees.get(letter.employeeId),
      ]);
      if (!link || !lettersInEffect(settings, link)) {
        throw new ApprovalError(t('Employee letters are off for this company.'));
      }
      if (!canDraftLetters(link)) throw new ApprovalError(t('Your role can’t make letters.'));
      if (await pendingLetterRequest(letter.id)) {
        throw new ApprovalError(t('This letter is already waiting for approval.'));
      }
      const now = nowStamp();
      const details: LetterRequestDetails = {
        letterUpdatedAt: letter.updatedAt,
        kind: letter.kind,
        employeeId: letter.employeeId,
      };
      const request: ApprovalRequest = {
        id: newId(),
        companyId: letter.companyId,
        kind: 'letter',
        subjectTbl: 'employeeLetters',
        subjectId: letter.id,
        subjectNumber: employee?.number ?? '',
        before: null,
        after: details as unknown as Record<string, unknown>,
        reason: (input.note ?? '').trim().slice(0, 1000),
        status: 'pending',
        // The cloud stamps both with its own.
        requestedBy: link.userId,
        ...(input.byName?.trim() ? { requestedByName: input.byName.trim().slice(0, 200) } : {}),
        requestedAt: now,
        decidedBy: null,
        decidedAt: null,
        decisionNote: '',
        createdAt: now,
        updatedAt: now,
      };
      await db.approvals.add(request);
      await logRequest(request, 'asked');
      return request;
    },
  );
}

/**
 * Before an approver approves a request to issue a letter: the letter is
 * on this device, still a draft, as it was sent.
 */
export async function assertLetterRequest(request: ApprovalRequest): Promise<void> {
  const letter = await db.employeeLetters.get(request.subjectId);
  if (!letter) {
    throw new ApprovalError(t('This letter isn’t on this device yet. Let it sync, then decide.'));
  }
  if (letter.status !== 'draft') return;
  if (letter.updatedAt !== letterRequestDetails(request)?.letterUpdatedAt) {
    throw new ApprovalError(
      t(
        'This letter changed after it was sent for approval. Reject this request; it can be sent again.',
      ),
    );
  }
}

/**
 * Carries out an approved request to issue a letter, on the approver's
 * device: the letter is issued as it was sent. One issued meanwhile (by an
 * admin) is left as it is.
 */
export async function applyLetterRequest(request: ApprovalRequest): Promise<void> {
  const letter = await db.employeeLetters.get(request.subjectId);
  if (!letter) throw new ApprovalError(t('The letter of this request no longer exists.'));
  if (letter.status === 'issued') return;
  if (letter.status !== 'draft') throw new ApprovalError(t('This letter is void.'));
  await assertLetterRequest(request);
  await issueLetter(letter.id);
}

/** Whether this person may take back or decide the request (whoever asked, or an approver). */
export function decidesLetterRequest(
  request: ApprovalRequest,
  link: CloudLink | null | undefined,
): boolean {
  return approverOf(link) || request.requestedBy === link?.userId;
}

/* -------------------------------------------------------------------------- */
/* Automatic drafts                                                           */
/* -------------------------------------------------------------------------- */

/** The events a save of an employee is: joining, leaving, a salary changed. */
export function employeeEvents(
  before: Employee | undefined,
  after: Employee,
  currency: string,
): { trigger: LetterTrigger; date: ISODate }[] {
  if (!before) return [{ trigger: 'joining', date: after.hireDate ?? today() }];
  const events: { trigger: LetterTrigger; date: ISODate }[] = [];
  if (before.status !== 'left' && after.status === 'left') {
    events.push({ trigger: 'leaving', date: after.leavingDate ?? today() });
  }
  if (
    before.status !== 'left' &&
    after.status !== 'left' &&
    letterPay(before, currency).total !== letterPay(after, currency).total
  ) {
    events.push({ trigger: 'salary_change', date: today() });
  }
  return events;
}

/** The id of the draft an event makes from a template: the same on every device. */
export function autoDraftId(templateId: ID, employeeId: ID, trigger: LetterTrigger, date: ISODate) {
  return `auto:${stableId(`${templateId}:${employeeId}:${trigger}:${date}`)}`;
}

/**
 * Makes the drafts the company's templates ask for when an employee joins,
 * leaves or has their salary changed (LetterTemplate.autoOn), at most
 * MAX_AUTO_DRAFTS a save. Never sent or issued: a person checks them in
 * People → Letters. Nothing inside another transaction (an import), nor
 * while letters are off. Returns how many were made; never throws.
 */
export async function autoDrafts(before: Employee | undefined, after: Employee): Promise<number> {
  if (Dexie.currentTransaction) return 0;
  try {
    const [settings, link, company] = await Promise.all([
      getPeopleSettings(after.companyId),
      linkOf(after.companyId),
      db.companies.get(after.companyId),
    ]);
    if (!company || !lettersInEffect(settings, link) || !canDraftLetters(link)) return 0;
    const events = employeeEvents(before, after, company.currency);
    if (events.length === 0) return 0;
    const templates = (
      await db.letterTemplates.where('companyId').equals(after.companyId).toArray()
    )
      .filter((tpl) => !tpl.archived && tpl.autoOn?.length)
      .map(normalizeTemplate);
    const wanted = sortTemplates(templates).flatMap((template) =>
      events
        .filter((event) => template.autoOn?.includes(event.trigger))
        .map((event) => ({ template, ...event })),
    );
    if (wanted.length === 0) return 0;
    let made = 0;
    await db.transaction('rw', [db.employeeLetters], async () => {
      for (const { template, trigger, date } of wanted.slice(0, MAX_AUTO_DRAFTS)) {
        const id = autoDraftId(template.id, after.id, trigger, date);
        if (await db.employeeLetters.get(id)) continue;
        const draft = draftRecord(
          { ...draftFromTemplate(template, after.id), trigger },
          undefined,
          id,
        );
        if (!draft.body) continue;
        await db.employeeLetters.add(draft);
        made += 1;
      }
    });
    return made;
  } catch {
    // The employee is saved; drafts can be made by hand.
    return 0;
  }
}
