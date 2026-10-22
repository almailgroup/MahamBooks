import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { setupCompany } from '@/db/records';
import { createEmployee, saveEmployee } from '@/db/people';
import { autoDraftId, getTemplate, issueLetter, saveTemplate, setLettersOn } from '@/db/letters';
import { defaultTemplateId } from '@/lib/hr/letter-templates';
import { today } from '@/lib/dates';
import { FakeCloud } from './testing/fake-cloud';
import { startUpload, syncCompany, type SyncContext } from './sync';

/**
 * Employee letters (#19) and the sync: an automatic draft has the same id
 * on every device, so two devices that make it for the same change end up
 * with one; and a letter issued here reaches the cloud as issued. Made-up
 * people only.
 */

const OWNER = 'user-owner';

let server: FakeCloud;
let ctx: SyncContext;

beforeEach(async () => {
  await db.delete();
  await db.open();
  server = new FakeCloud();
  server.features = [
    'tables_v16',
    'super_admin',
    'approvals',
    'cheque_approvals',
    'change_feed',
    'payroll_approvals',
    'document_alerts',
    'employee_letters',
  ];
  ctx = { api: server.client(OWNER), userId: OWNER };
});

async function uploaded() {
  const company = await setupCompany({ name: 'Made-up Trading' });
  await startUpload(company.id, ctx);
  await syncCompany(company.id, ctx);
  await setLettersOn(company.id, true);
  const template = (await getTemplate(
    company.id,
    defaultTemplateId(company.id, 'salary_certificate'),
  ))!;
  const saved = await saveTemplate({ ...template, autoOn: ['salary_change'] });
  const employee = await saveEmployee(
    createEmployee(company.id, { name: 'Made-up Person', basicSalary: 500 }),
  );
  await syncCompany(company.id, ctx);
  return { company, template: saved, employee };
}

describe('employee letters in the cloud', () => {
  it('ends with one automatic draft when two devices make it', async () => {
    const { company, template, employee } = await uploaded();
    const id = autoDraftId(template.id, employee.id, 'salary_change', today());
    // Another device saved the same raise first and sent its draft.
    await server.client(OWNER).pushRecords(company.id, [
      {
        tbl: 'employeeLetters',
        id,
        data: {
          id,
          companyId: company.id,
          employeeId: employee.id,
          templateId: template.id,
          kind: 'salary_certificate',
          number: '',
          language: 'ar',
          addressee: '',
          purpose: '',
          subject: template.subjectAr,
          body: template.bodyAr,
          issuedOn: null,
          status: 'draft',
          trigger: 'salary_change',
          createdAt: '2026-10-20T08:00:00.000Z',
          updatedAt: '2026-10-20T08:00:00.000Z',
        },
      },
    ]);
    // This device, not synced yet, saves it too.
    await saveEmployee({ ...employee, basicSalary: 600 });
    expect(await db.employeeLetters.get(id)).toMatchObject({ trigger: 'salary_change' });
    await syncCompany(company.id, ctx);
    await syncCompany(company.id, ctx);
    expect(server.rows(company.id, 'employeeLetters').map((r) => r.id)).toEqual([id]);
    expect(await db.employeeLetters.where('employeeId').equals(employee.id).count()).toBe(1);
    expect(await db.outbox.where('table').equals('employeeLetters').count()).toBe(0);
  });

  it('sends a letter issued here as issued, with its number on the company', async () => {
    const { company, template, employee } = await uploaded();
    await saveEmployee({ ...employee, basicSalary: 650 });
    const id = autoDraftId(template.id, employee.id, 'salary_change', today());
    const issued = await issueLetter(id, '2026-10-21');
    await syncCompany(company.id, ctx);
    expect(server.record(company.id, 'employeeLetters', id)).toMatchObject({
      status: 'issued',
      number: issued.number,
    });
    expect(server.record(company.id, 'companies', company.id)?.numbering).toMatchObject({
      letter: { next: 2, period: '2026' },
    });
  });
});
