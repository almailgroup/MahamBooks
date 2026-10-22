import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { setupCompany } from './records';
import {
  createEmployee,
  deleteEmployee,
  employeeDeletion,
  getPeopleSettings,
  newAllowance,
  savePeopleSettings,
  saveEmployee,
} from './people';
import { applyApproval, decideApproval, cancelApproval } from './approvals';
import {
  autoDraftId,
  canIssueLetters,
  deleteLetterDraft,
  draftFromTemplate,
  getTemplate,
  issueLetter,
  letterRequestDetails,
  letterTexts,
  letterContext,
  listTemplates,
  markLettersPrinted,
  requestLetterIssue,
  restoreDefaultWording,
  saveLetterDraft,
  saveTemplate,
  setLettersOn,
  setTemplateArchived,
  voidLetter,
  MAX_AUTO_DRAFTS,
} from './letters';
import { defaultTemplateId } from '@/lib/hr/letter-templates';
import { CloudPermissionError } from '@/cloud/outbox';
import type { MemberRole } from '@/cloud/roles';
import type { Company, Employee, EmployeeLetter } from './types';

/**
 * Employee letters (#19): drafts from the company's templates, numbered
 * HR-{year}-{counter} and frozen when issued, never numbered twice; issued
 * by the owner, an admin or an approver, asked for by accountants; drafts
 * made by themselves when an employee joins, leaves or has a salary change.
 * Made-up people only.
 */

const FEATURES = [
  'tables_v16',
  'super_admin',
  'approvals',
  'cheque_approvals',
  'change_feed',
  'payroll_approvals',
  'document_alerts',
  'employee_letters',
];

beforeEach(async () => {
  await db.delete();
  await db.open();
});

/** This device's person in the company kept in the cloud. */
async function signedInAs(
  company: Company,
  role: MemberRole,
  options: { approver?: boolean; user?: string; features?: string[] } = {},
) {
  await db.syncState.put({
    companyId: company.id,
    userId: options.user ?? `user-${role}`,
    role,
    status: 'ready',
    cursor: 0,
    name: company.name,
    linkedAt: '2026-10-01T08:00:00.000Z',
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
    features: options.features ?? FEATURES,
    ...(options.approver ? { approver: true } : {}),
  });
}

async function seed(options: { letters?: boolean } = {}) {
  const company = await setupCompany({ name: 'Made-up Services Co.', currency: 'KWD' });
  const employee = await saveEmployee(
    createEmployee(company.id, {
      name: 'Made-up Person',
      nameAr: 'شخص تجريبي',
      category: 'expat',
      nationality: 'EG',
      department: 'Operations',
      jobTitle: 'Supervisor',
      jobTitleAr: 'مشرف',
      hireDate: '2024-01-01',
      basicSalary: 600,
      allowances: [newAllowance({ name: 'Transport', amount: 25.5 })],
      civilId: '280010100001',
    }),
  );
  if (options.letters !== false) await setLettersOn(company.id, true);
  return { company: (await db.companies.get(company.id))!, employee };
}

async function draft(company: Company, employee: Employee, kind = 'salary_certificate') {
  const template = (await getTemplate(company.id, defaultTemplateId(company.id, kind as never)))!;
  return saveLetterDraft(draftFromTemplate(template, employee.id));
}

const stored = async (letter: EmployeeLetter) => (await db.employeeLetters.get(letter.id))!;

describe('switched off', () => {
  it('makes no letters while the company’s letters are off', async () => {
    const { company, employee } = await seed({ letters: false });
    expect((await getPeopleSettings(company.id)).letters).toBeUndefined();
    await expect(draft(company, employee)).rejects.toThrow(/letters are off/);
    expect(await db.employeeLetters.count()).toBe(0);
  });

  it('keeps the switch when other People settings are saved from an older form', async () => {
    const { company } = await seed();
    const form = await getPeopleSettings(company.id);
    await savePeopleSettings({ ...form, letters: false, reminderDays: [30] });
    expect((await getPeopleSettings(company.id)).letters).toBe(true);
    await setLettersOn(company.id, false);
    expect((await getPeopleSettings(company.id)).letters).toBeUndefined();
  });
});

describe('templates', () => {
  it('starts with the five first letters, in Arabic, without storing them', async () => {
    const { company } = await seed();
    const list = await listTemplates(company.id);
    expect(list.map((tpl) => tpl.kind)).toEqual([
      'salary_certificate',
      'experience_certificate',
      'employment_certificate',
      'warning',
      'noc',
    ]);
    expect(list.every((tpl) => tpl.language === 'ar')).toBe(true);
    expect(list.map((tpl) => tpl.id)).toContain(defaultTemplateId(company.id, 'noc'));
    expect(await db.letterTemplates.count()).toBe(0);
  });

  it('stores a default once it is changed, and puts its wording back on request', async () => {
    const { company } = await seed();
    const id = defaultTemplateId(company.id, 'warning');
    const template = (await getTemplate(company.id, id))!;
    await saveTemplate({ ...template, bodyAr: 'نص آخر', signatoryTitle: 'HR Manager' });
    expect((await db.letterTemplates.get(id))?.bodyAr).toBe('نص آخر');
    expect((await listTemplates(company.id)).filter((t) => t.kind === 'warning')).toHaveLength(1);
    const restored = await restoreDefaultWording(company.id, id);
    expect(restored.bodyAr).toBe(template.bodyAr);
    expect(restored.signatoryTitle).toBe('HR Manager');
    await setTemplateArchived(company.id, defaultTemplateId(company.id, 'noc'), true);
    expect((await getTemplate(company.id, defaultTemplateId(company.id, 'noc')))?.archived).toBe(
      true,
    );
  });

  it('needs a name and the text of the language it is printed in', async () => {
    const { company } = await seed();
    const template = (await getTemplate(company.id, defaultTemplateId(company.id, 'noc')))!;
    await expect(saveTemplate({ ...template, name: ' ', nameAr: '' })).rejects.toThrow(/name/);
    await expect(saveTemplate({ ...template, bodyAr: '  ' })).rejects.toThrow(/Arabic text/);
    await expect(saveTemplate({ ...template, language: 'ar-en', bodyEn: '' })).rejects.toThrow(
      /English text/,
    );
    await expect(saveTemplate({ ...template, language: 'en', bodyAr: '' })).resolves.toBeTruthy();
  });

  it('lets only someone who issues letters show private details', async () => {
    const { company } = await seed();
    await signedInAs(company, 'accountant');
    const id = defaultTemplateId(company.id, 'noc');
    const template = (await getTemplate(company.id, id))!;
    const saved = await saveTemplate({ ...template, privateFields: true });
    expect(saved.privateFields).toBeUndefined();
    await signedInAs(company, 'admin');
    expect((await saveTemplate({ ...saved, privateFields: true })).privateFields).toBe(true);
    await signedInAs(company, 'accountant');
    expect((await saveTemplate({ ...saved, bodyAr: 'نص' })).privateFields).toBe(true);
  });
});

describe('issuing', () => {
  it('numbers HR-2026-0001 at issue and freezes the filled text', async () => {
    const { company, employee } = await seed();
    const letter = await draft(company, employee);
    expect(letter).toMatchObject({ status: 'draft', number: '', issuedOn: null, language: 'ar' });
    // The draft keeps the template's fields until it is issued.
    expect(letter.body).toContain('{employee.name}');
    const issued = await issueLetter(letter.id, '2026-10-05');
    expect(issued).toMatchObject({
      status: 'issued',
      number: 'HR-2026-0001',
      issuedOn: '2026-10-05',
      showStamp: true,
      showSignature: true,
    });
    expect(issued.body).toContain('الاسم: شخص تجريبي');
    expect(issued.body).toContain('625.500');
    expect(issued.body).not.toContain('{');
    expect((await db.companies.get(company.id))?.numbering.letter).toMatchObject({
      next: 2,
      period: '2026',
      reset: 'yearly',
    });
    // Later changes to the employee don't change what was issued.
    await saveEmployee({ ...employee, nameAr: 'اسم آخر', basicSalary: 900 });
    expect((await stored(issued)).body).toBe(issued.body);
    const filled = letterTexts(await stored(issued), null);
    expect(filled.body).toBe(issued.body);
    await expect(issueLetter(letter.id, '2026-10-06')).rejects.toThrow(/already issued/);
  });

  it('never gives a number twice: voided letters keep theirs, deleted drafts use none', async () => {
    const { company, employee } = await seed();
    const first = await issueLetter((await draft(company, employee)).id, '2026-10-05');
    const voided = await voidLetter(first.id, 'Typing mistake');
    expect(voided).toMatchObject({ status: 'void', number: 'HR-2026-0001' });
    const thrown = await draft(company, employee);
    await deleteLetterDraft(thrown.id);
    const second = await issueLetter((await draft(company, employee)).id, '2026-10-06');
    expect(second.number).toBe('HR-2026-0002');
    await expect(deleteLetterDraft(second.id)).rejects.toThrow(/numbers stay used/);
    await expect(deleteLetterDraft(first.id)).rejects.toThrow(/numbers stay used/);
    // From 1 again in a new year.
    const next = await issueLetter((await draft(company, employee)).id, '2027-01-02');
    expect(next.number).toBe('HR-2027-0001');
    await expect(voidLetter(next.id, ' ')).rejects.toThrow(/why/);
  });

  it('skips a number already given on another device', async () => {
    const { company, employee } = await seed();
    const other = await draft(company, employee);
    await db.employeeLetters.put({
      ...(await stored(other)),
      status: 'issued',
      number: 'HR-2026-0001',
      issuedOn: '2026-10-01',
    });
    const issued = await issueLetter((await draft(company, employee)).id, '2026-10-05');
    expect(issued.number).toBe('HR-2026-0002');
  });

  it('prints in Arabic and English with both halves frozen', async () => {
    const { company, employee } = await seed();
    const template = (await getTemplate(
      company.id,
      defaultTemplateId(company.id, 'employment_certificate'),
    ))!;
    const letter = await saveLetterDraft(draftFromTemplate(template, employee.id, 'ar-en'));
    const issued = await issueLetter(letter.id, '2026-10-05');
    expect(issued.bodyEn).toContain('Name: Made-up Person');
    expect(issued.body).toContain('الاسم: شخص تجريبي');
    expect(issued.subjectEn).toBe('Employment certificate');
  });

  it('fills private details only when the template allows them and the person issues letters', async () => {
    const { company, employee } = await seed();
    const template = (await getTemplate(company.id, defaultTemplateId(company.id, 'noc')))!;
    await saveTemplate({
      ...template,
      bodyAr: `${template.bodyAr}\nالرقم المدني: {employee.civilId}`,
      privateFields: true,
    });
    const letter = await saveLetterDraft(
      draftFromTemplate((await getTemplate(company.id, template.id))!, employee.id),
    );
    const masked = letterTexts(letter, letterContext(employee, company, null, false));
    expect(masked.body).toContain('•••• 0001');
    const issued = await issueLetter(letter.id, '2026-10-05');
    expect(issued.body).toContain('280010100001');
  });

  it('marks issued letters printed, and keeps their text', async () => {
    const { company, employee } = await seed();
    const issued = await issueLetter((await draft(company, employee)).id, '2026-10-05');
    await markLettersPrinted([issued.id]);
    const printed = await stored(issued);
    expect(printed.printedAt).toBeTruthy();
    expect(printed.body).toBe(issued.body);
  });
});

describe('in a company kept in the cloud', () => {
  it('lets the owner, admins and approvers issue; accountants ask', async () => {
    const { company } = await seed();
    await signedInAs(company, 'owner');
    expect(canIssueLetters(await db.syncState.get(company.id))).toBe(true);
    await signedInAs(company, 'admin');
    expect(canIssueLetters(await db.syncState.get(company.id))).toBe(true);
    await signedInAs(company, 'accountant', { approver: true });
    expect(canIssueLetters(await db.syncState.get(company.id))).toBe(true);
    await signedInAs(company, 'accountant');
    expect(canIssueLetters(await db.syncState.get(company.id))).toBe(false);
  });

  it('refuses an accountant’s issue, on the device as the cloud would', async () => {
    const { company, employee } = await seed();
    await signedInAs(company, 'accountant');
    const letter = await draft(company, employee);
    await expect(issueLetter(letter.id, '2026-10-05')).rejects.toThrow(/Ask for approval/);
    // Written straight to the table, the change capture refuses it too.
    await expect(
      db.employeeLetters.put({ ...letter, status: 'issued', number: 'HR-2026-0009' }),
    ).rejects.toBeInstanceOf(CloudPermissionError);
    expect((await stored(letter)).status).toBe('draft');
  });

  it('goes through an approver: asked, approved and issued on the approver’s device', async () => {
    const { company, employee } = await seed();
    await signedInAs(company, 'accountant');
    const letter = await draft(company, employee, 'employment_certificate');
    const request = await requestLetterIssue(letter.id, { note: 'For the embassy' });
    expect(request).toMatchObject({
      kind: 'letter',
      subjectTbl: 'employeeLetters',
      subjectId: letter.id,
      status: 'pending',
      reason: 'For the embassy',
    });
    expect(letterRequestDetails(request)).toEqual({
      letterUpdatedAt: letter.updatedAt,
      kind: 'employment_certificate',
      employeeId: employee.id,
    });
    await expect(requestLetterIssue(letter.id)).rejects.toThrow(/already waiting/);
    // Waiting, the draft doesn't change and isn't deleted.
    await expect(
      saveLetterDraft({
        ...draftFromTemplate((await getTemplate(company.id, letter.templateId!))!, employee.id),
        id: letter.id,
      }),
    ).rejects.toThrow(/waiting for approval/);
    await expect(deleteLetterDraft(letter.id)).rejects.toThrow(/waiting for approval/);
    await expect(decideApproval(request.id, 'approved')).rejects.toThrow(/Only an approver/);

    await signedInAs(company, 'owner');
    await expect(decideApproval(request.id, 'approved')).resolves.toBe(false);
    // The sync that sends the decision carries it out (carryOutDecided).
    await applyApproval(request.id);
    expect(await db.approvals.get(request.id)).toMatchObject({ status: 'applied' });
    expect(await stored(letter)).toMatchObject({ status: 'issued', number: 'HR-2026-0001' });
    const log = await db.activities.where('entityId').equals(employee.id).toArray();
    expect(log.map((a) => a.messageKey)).toEqual(
      expect.arrayContaining([
        'Letter sent for approval',
        'Approval given to issue a letter',
        'Letter {number} issued',
      ]),
    );
    expect(log.every((a) => a.entity === 'employee')).toBe(true);
    expect(JSON.stringify(log)).not.toMatch(/625/);
  });

  it('refuses to approve a letter changed after it was asked for', async () => {
    const { company, employee } = await seed();
    await signedInAs(company, 'accountant');
    const letter = await draft(company, employee);
    const request = await requestLetterIssue(letter.id);
    await cancelApproval(request.id);
    const changed = await saveLetterDraft({
      ...draftFromTemplate((await getTemplate(company.id, letter.templateId!))!, employee.id),
      id: letter.id,
      purpose: 'a visa',
    });
    const again = await requestLetterIssue(changed.id);
    // Changed meanwhile on another device (written as the sync would).
    await db.transaction('rw', db.employeeLetters, async () => {
      const { markRemote } = await import('@/cloud/outbox');
      markRemote();
      await db.employeeLetters.put({ ...changed, purpose: 'other', updatedAt: 'later' });
    });
    await signedInAs(company, 'owner');
    await expect(decideApproval(again.id, 'approved')).rejects.toThrow(/changed after it was sent/);
  });

  it('lets an accountant mark issued letters printed, not change them', async () => {
    const { company, employee } = await seed();
    await signedInAs(company, 'owner');
    const issued = await issueLetter((await draft(company, employee)).id, '2026-10-05');
    await signedInAs(company, 'accountant');
    await expect(markLettersPrinted([issued.id])).resolves.toBeUndefined();
    await expect(voidLetter(issued.id, 'Mistake')).rejects.toThrow(/voids letters/);
    await expect(
      db.employeeLetters.put({ ...(await stored(issued)), body: 'Another text' }),
    ).rejects.toBeInstanceOf(CloudPermissionError);
    await expect(
      db.employeeLetters.put({ ...(await stored(issued)), status: 'draft' }),
    ).rejects.toThrow(/stays issued/);
    await expect(db.employeeLetters.delete(issued.id)).rejects.toThrow(/numbers stay used/);
  });

  it('lets only the owner or an admin turn letters on or off', async () => {
    const { company } = await seed({ letters: false });
    await signedInAs(company, 'accountant');
    await expect(setLettersOn(company.id, true)).rejects.toThrow(/owner or an admin/);
    const settings = await getPeopleSettings(company.id);
    await expect(db.peopleSettings.put({ ...settings, letters: true })).rejects.toThrow(
      /owner or an admin/,
    );
    await signedInAs(company, 'admin');
    await expect(setLettersOn(company.id, true)).resolves.toMatchObject({ letters: true });
  });

  it('waits for the server to have employee letters', async () => {
    const { company } = await seed({ letters: false });
    await signedInAs(company, 'owner', { features: ['tables_v16', 'approvals'] });
    await expect(setLettersOn(company.id, true)).rejects.toThrow(/latest database script/);
  });
});

describe('automatic drafts', () => {
  async function autoTemplate(company: Company, kind: string, autoOn: string[]) {
    const template = (await getTemplate(company.id, defaultTemplateId(company.id, kind as never)))!;
    return saveTemplate({ ...template, autoOn: autoOn as never });
  }

  it('drafts on joining, leaving and a salary change, once each', async () => {
    const { company, employee } = await seed();
    const employment = await autoTemplate(company, 'employment_certificate', ['joining']);
    const experience = await autoTemplate(company, 'experience_certificate', ['leaving']);
    const salary = await autoTemplate(company, 'salary_certificate', ['salary_change']);

    const joined = await saveEmployee(
      createEmployee(company.id, { name: 'Made-up Joiner', hireDate: '2026-10-01' }),
    );
    const joining = await db.employeeLetters.get(
      autoDraftId(employment.id, joined.id, 'joining', '2026-10-01'),
    );
    expect(joining).toMatchObject({ status: 'draft', trigger: 'joining', number: '' });
    // Saved again: no second draft.
    const again = await saveEmployee({ ...joined, phone: '' });
    expect(await db.employeeLetters.where('employeeId').equals(joined.id).count()).toBe(1);

    await saveEmployee({ ...again, basicSalary: again.basicSalary + 50 });
    const raised = await db.employeeLetters
      .where('employeeId')
      .equals(joined.id)
      .filter((l) => l.trigger === 'salary_change')
      .toArray();
    expect(raised.map((l) => l.templateId)).toEqual([salary.id]);

    const current = (await db.employees.get(employee.id))!;
    await saveEmployee({
      ...current,
      status: 'left',
      leavingDate: '2026-10-20',
      leavingReason: 'resignation',
    });
    expect(
      await db.employeeLetters.get(
        autoDraftId(experience.id, employee.id, 'leaving', '2026-10-20'),
      ),
    ).toMatchObject({ trigger: 'leaving', status: 'draft' });
  });

  it('makes none from an import, with letters off, or from an archived template', async () => {
    const { company } = await seed();
    const template = await autoTemplate(company, 'employment_certificate', ['joining']);
    await saveEmployee(createEmployee(company.id, { name: 'Made-up Imported' }), { log: false });
    expect(await db.employeeLetters.count()).toBe(0);
    await setTemplateArchived(company.id, template.id, true);
    await saveEmployee(createEmployee(company.id, { name: 'Made-up Two' }));
    expect(await db.employeeLetters.count()).toBe(0);
    await setTemplateArchived(company.id, template.id, false);
    await setLettersOn(company.id, false);
    await saveEmployee(createEmployee(company.id, { name: 'Made-up Three' }));
    expect(await db.employeeLetters.count()).toBe(0);
  });

  it('makes at most a few drafts a save', async () => {
    const { company } = await seed();
    const base = (await getTemplate(company.id, defaultTemplateId(company.id, 'noc')))!;
    for (let i = 0; i < MAX_AUTO_DRAFTS + 2; i++) {
      await saveTemplate({ ...base, id: `tpl-${i}`, name: `Made-up ${i}`, autoOn: ['joining'] });
    }
    const joined = await saveEmployee(createEmployee(company.id, { name: 'Made-up Many' }));
    expect(await db.employeeLetters.where('employeeId').equals(joined.id).count()).toBe(
      MAX_AUTO_DRAFTS,
    );
  });
});

describe('deleting an employee', () => {
  it('keeps one with issued letters, and deletes the drafts of one without', async () => {
    const { company, employee } = await seed();
    await draft(company, employee);
    expect((await employeeDeletion(employee)).letters).toBe(0);
    const issued = await issueLetter((await draft(company, employee)).id, '2026-10-05');
    expect((await employeeDeletion(employee)).letters).toBe(1);
    await expect(deleteEmployee(employee.id)).rejects.toThrow(/letters issued to them/);
    await voidLetter(issued.id, 'Mistake');
    await expect(deleteEmployee(employee.id)).rejects.toThrow(/letters issued to them/);

    const other = await saveEmployee(createEmployee(company.id, { name: 'Made-up Other' }));
    await draft(company, other);
    await deleteEmployee(other.id);
    expect(await db.employeeLetters.where('employeeId').equals(other.id).count()).toBe(0);
  });
});
