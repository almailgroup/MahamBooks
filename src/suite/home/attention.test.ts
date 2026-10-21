import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { setupCompany } from '@/db/records';
import { createEmployee, saveEmployee } from '@/db/people';
import { newId } from '@/lib/ids';
import type { ComplianceDocument } from '@/db/types';
import { accessMap } from '../apps';
import {
  alertPage,
  approvalsWaiting,
  homeAlerts,
  homeTopics,
  loadHomeAlertData,
} from './attention';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('what needs attention on the home', () => {
  it('only covers the apps someone may open', () => {
    expect(homeTopics(accessMap('owner'))).toEqual([
      'documents',
      'deadlines',
      'cheques',
      'bills',
      'invoices',
    ]);
    expect(homeTopics(accessMap('staff'))).toEqual(homeTopics(accessMap('owner')));
  });

  it('leaves out employees and their papers for those who may not see People', async () => {
    const company = await setupCompany({ name: 'Test Home Co' });
    const employee = await saveEmployee(
      createEmployee(company.id, { name: 'Test Worker', civilIdExpiry: '2026-01-01' }),
    );
    const stamp = new Date().toISOString();
    const docs: ComplianceDocument[] = [
      {
        id: newId(),
        companyId: company.id,
        employeeId: employee.id,
        type: 'passport',
        title: '',
        number: 'X1',
        issuer: '',
        issueDate: null,
        expiryDate: '2026-01-02',
        renewalCost: 0,
        reminderDays: [30],
        ownerType: 'employee',
        ownerName: '',
        notes: '',
        archived: false,
        createdAt: stamp,
        updatedAt: stamp,
      },
      {
        id: newId(),
        companyId: company.id,
        employeeId: null,
        type: 'commercial_licence',
        title: '',
        number: 'L1',
        issuer: '',
        issueDate: null,
        expiryDate: '2026-01-03',
        renewalCost: 0,
        reminderDays: [30],
        ownerType: 'company',
        ownerName: '',
        notes: '',
        archived: false,
        createdAt: stamp,
        updatedAt: stamp,
      },
    ];
    // A confidential document stays with People too.
    docs.push({
      ...docs[1],
      id: newId(),
      title: 'Guards cost sheet',
      ownerType: 'other',
      confidential: true,
    });
    await db.complianceDocuments.bulkAdd(docs);
    const all = await loadHomeAlertData(company, true);
    const hidden = await loadHomeAlertData(company, false);
    expect(all.employees).toHaveLength(1);
    expect(all.complianceDocuments).toHaveLength(3);
    expect(hidden.employees).toEqual([]);
    expect(hidden.complianceDocuments.map((d) => d.employeeId)).toEqual([null]);

    const topics = homeTopics(accessMap('owner'));
    const papers = (data: typeof all) =>
      homeAlerts(data, '2026-10-17', topics).filter((a) => a.topic === 'documents');
    expect(papers(all).length).toBeGreaterThanOrEqual(3);
    expect(papers(hidden)).toHaveLength(1);
    const own = papers(all).find((a) => a.topic === 'documents' && a.entry.employeeId);
    expect(own && alertPage(own, true)).toBe(`/employees/${employee.id}`);
    expect(own && alertPage(own, false)).toBe('/compliance/documents');
  });
});

describe('approval requests on the home page', () => {
  const requests = [
    { status: 'pending', requestedBy: 'user-staff' },
    { status: 'pending', requestedBy: 'user-accountant' },
    { status: 'applied', requestedBy: 'user-staff' },
  ] as const;

  it('counts every waiting request for an approver', () => {
    expect(approvalsWaiting(requests, { approver: true, userId: 'user-owner' })).toBe(2);
  });

  it('counts only their own for anyone else', () => {
    expect(approvalsWaiting(requests, { approver: false, userId: 'user-staff' })).toBe(1);
    expect(approvalsWaiting(requests, { approver: false, userId: null })).toBe(0);
  });
});
