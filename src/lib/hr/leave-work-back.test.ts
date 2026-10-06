import { describe, expect, it } from 'vitest';
import type { LeaveRecord } from '@/db/types';
import { annualLeaveBalance } from './leave';

function record(overrides: Partial<LeaveRecord>): LeaveRecord {
  return {
    id: Math.random().toString(36).slice(2),
    companyId: 'c',
    employeeId: 'e',
    type: 'annual',
    kind: 'leave',
    start: '2026-01-01',
    end: '2026-01-01',
    days: 0,
    status: 'approved',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('balance worked back from an opening record', () => {
  it('adds back annual leave taken between the day and the opening', () => {
    const records = [
      // 5 days of annual leave in September, recorded here…
      record({ kind: 'leave', start: '2026-09-13', end: '2026-09-17', days: 5 }),
      // …then the opening balance as of 1 October (after that leave): 10 days.
      record({ kind: 'opening', start: '2026-10-01', end: '2026-10-01', days: 10 }),
    ];
    // On 10 September the employee still had the 5 days they took on the 13th.
    expect(annualLeaveBalance(records, '2021-03-01', '2026-09-10').balance).toBe(15);
    // On 31 August: 15 less September's 2.5.
    expect(annualLeaveBalance(records, '2021-03-01', '2026-08-31').balance).toBe(12.5);
  });
});
