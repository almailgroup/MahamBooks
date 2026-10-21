import { describe, expect, it } from 'vitest';
import type { ComplianceDocumentType, EmployeeCategory, LeaveType } from '@/db/types';
import { ALERT_TOPICS, topicLabel } from '@/alerts/topics';
import { runStatus, RUN_STATUS } from '@/features/payroll/shared';
import { entryOwner, entryTitle } from '@/features/renewals/text';
import { accessMap } from '@/suite/apps';
import { homeTopics, topicApp, topicPage } from '@/suite/home/attention';
import { documentTypeInfo, DOCUMENT_TYPES, ownerLabel } from './compliance';
import { categoryLabel, employeeStatusLabel, workforceSummary } from './hr/employees';
import { countLeaveDays, LEAVE_TYPES, leaveTypeInfo, leaveWarnings } from './hr/leave';
import { isKnown, lookup } from './known';
import {
  chequeStatusMeta,
  deliveryStatusMeta,
  securityChequeStatusMeta,
  statusMeta,
  STATUS_META,
  UNKNOWN_STATUS,
} from './status';

/**
 * Values a newer version of the app may save (a new kind of leave, a
 * Stateless employee, a contract in the register…): an older version shows
 * a fallback instead of failing, and known values look the same as before.
 */

const never = () => false;

describe('looking up a stored value', () => {
  it('finds known values, and falls back for others and for inherited keys', () => {
    const map = { a: 1, b: 2 } as Record<'a' | 'b', number>;
    expect(lookup(map, 'a', 0)).toBe(1);
    expect(lookup(map, 'c', 0)).toBe(0);
    expect(lookup(map, 'constructor', 0)).toBe(0);
    expect(lookup(map, undefined, 0)).toBe(0);
    expect(isKnown(map, 'b')).toBe(true);
    expect(isKnown(map, 'toString')).toBe(false);
  });
});

describe('leave of a type this version doesn’t know', () => {
  const other = 'compassionate' as LeaveType;

  it('is other leave without a limit, counted in working days', () => {
    expect(leaveTypeInfo(other)).toEqual({ label: 'Other leave', days: null, counting: 'working' });
    expect(leaveTypeInfo('sick')).toBe(LEAVE_TYPES.sick);
    // Thursday to Sunday: Friday and Saturday are off.
    const weekend = (date: string) => ['2026-10-23', '2026-10-24'].includes(date);
    expect(countLeaveDays(other, '2026-10-22', '2026-10-25', weekend)).toBe(2);
    expect(countLeaveDays('unpaid', '2026-10-22', '2026-10-25', weekend)).toBe(4);
  });

  it('gets no limit warning', () => {
    const record = {
      id: 'l1',
      type: other,
      kind: 'leave' as const,
      start: '2026-10-01',
      end: '2026-12-31',
      days: 60,
    };
    expect(leaveWarnings(record, [], null)).toEqual([]);
    expect(countLeaveDays(other, '2026-10-01', '2026-10-01', never)).toBe(1);
  });
});

describe('an employee category or status this version doesn’t know', () => {
  it('is shown as other', () => {
    expect(categoryLabel('stateless')).toBe('Other');
    expect(categoryLabel('kuwaiti')).toBe('Kuwaiti');
    expect(employeeStatusLabel('suspended')).toBe('Other');
    expect(employeeStatusLabel('on_leave')).toBe('On leave');
  });

  it('counts in the headcount and in no category', () => {
    const summary = workforceSummary([
      { status: 'active', category: 'kuwaiti' },
      { status: 'active', category: 'stateless' as EmployeeCategory },
      { status: 'left', category: 'stateless' as EmployeeCategory },
    ]);
    expect(summary.headcount).toBe(2);
    expect(summary.byCategory).toEqual({ kuwaiti: 1, gcc: 0, expat: 0, domestic: 0 });
    expect(summary.labourLawHeadcount).toBe(2);
    expect(summary.kuwaitiShare).toBe(50);
  });
});

describe('a register document of a type this version doesn’t know', () => {
  const type = 'tender_bond' as ComplianceDocumentType;

  it('is an other document, with its fee account', () => {
    expect(documentTypeInfo(type)).toBe(DOCUMENT_TYPES.other);
    expect(documentTypeInfo('passport')).toBe(DOCUMENT_TYPES.passport);
    expect(entryTitle({ title: '', type })).toBe('Other document');
    expect(entryTitle({ title: 'Guarding contract', type })).toBe('Guarding contract');
  });

  it('has an other owner when the owner is of a kind this version doesn’t know', () => {
    expect(ownerLabel('customer')).toBe('Other');
    expect(ownerLabel('vehicle')).toBe('Vehicle');
    const owner = entryOwner(
      { ownerType: 'customer' as 'other', ownerName: '', employeeId: null },
      new Map(),
      { name: 'Test Co' } as never,
    );
    expect(owner).toBe('Other');
  });
});

describe('a status this version doesn’t know', () => {
  it('is an unknown status in grey, and known ones are as before', () => {
    expect(statusMeta('pending_approval')).toBe(UNKNOWN_STATUS);
    expect(UNKNOWN_STATUS).toEqual({ label: 'Unknown status', tone: 'gray' });
    expect(statusMeta('paid')).toBe(STATUS_META.paid);
    expect(deliveryStatusMeta('in_transit')).toBe(UNKNOWN_STATUS);
    expect(deliveryStatusMeta(undefined).label).toBe('Not delivered');
    expect(chequeStatusMeta('pending' as 'held', 'out')).toBe(UNKNOWN_STATUS);
    expect(chequeStatusMeta('held', 'out').label).toBe('Issued');
    expect(chequeStatusMeta('held').label).toBe('In hand');
    expect(securityChequeStatusMeta('lost')).toBe(UNKNOWN_STATUS);
    expect(securityChequeStatusMeta('cashed').label).toBe('Cashed');
  });

  it('of a pay run is an unknown status', () => {
    expect(runStatus('awaiting_approval')).toEqual({ label: 'Unknown status', tone: 'gray' });
    expect(runStatus('approved')).toBe(RUN_STATUS.approved);
  });
});

describe('an alert topic this version doesn’t know', () => {
  it('has a label, no app and the home page as its list', () => {
    expect(topicLabel('approvals')).toBe('Other');
    expect(topicLabel('cheques')).toBe('Cheques');
    expect(topicApp('approvals')).toBeNull();
    expect(topicApp('documents')).toBe('compliance');
    expect(topicPage('approvals')).toBe('/');
    expect(topicPage('invoices')).toBe('/invoices?status=overdue');
    expect(homeTopics(accessMap(null))).toEqual([...ALERT_TOPICS]);
  });
});
