import { describe, expect, it } from 'vitest';
import { addDaysISO } from '@/lib/dates';
import {
  categoryForNationality,
  eosiReasonFor,
  insuredWithPifss,
  isWorkingDay,
  needsResidency,
  needsWorkPermit,
  probationLimit,
  underLabourLaw,
  workforceSummary,
} from './employees';
import type { EmployeeCategory, EmployeeStatus } from '@/db/types';

describe('employee categories', () => {
  it('follow the nationality', () => {
    expect(categoryForNationality('KW')).toBe('kuwaiti');
    expect(categoryForNationality('sa')).toBe('gcc');
    expect(categoryForNationality('OM')).toBe('gcc');
    expect(categoryForNationality('IN')).toBe('expat');
    expect(categoryForNationality('')).toBe('expat');
  });

  it('decide which papers and insurance apply', () => {
    expect(needsResidency('kuwaiti')).toBe(false);
    expect(needsResidency('gcc')).toBe(false);
    expect(needsResidency('expat')).toBe(true);
    expect(needsResidency('domestic')).toBe(true);
    expect(needsWorkPermit('expat')).toBe(true);
    expect(needsWorkPermit('domestic')).toBe(false);
    expect(insuredWithPifss('kuwaiti')).toBe(true);
    expect(insuredWithPifss('gcc')).toBe(true);
    expect(insuredWithPifss('expat')).toBe(false);
    expect(underLabourLaw('domestic')).toBe(false);
    expect(underLabourLaw('expat')).toBe(true);
  });

  it('map leaving reasons to the end-of-service rule', () => {
    expect(eosiReasonFor('resignation')).toBe('resignation');
    expect(eosiReasonFor('dismissal')).toBe('dismissal');
    expect(eosiReasonFor('contract_end')).toBe('termination');
    expect(eosiReasonFor(null)).toBe('termination');
  });
});

describe('probation', () => {
  it('skips Fridays, Saturdays and public holidays', () => {
    expect(isWorkingDay('2026-10-04')).toBe(true); // Sunday
    expect(isWorkingDay('2026-10-09')).toBe(false); // Friday
    expect(isWorkingDay('2026-10-10')).toBe(false); // Saturday
    expect(isWorkingDay('2027-02-25')).toBe(false); // National Day (Thursday)
  });

  it('ends on the 100th working day', () => {
    const hire = '2026-10-04';
    const limit = probationLimit(hire);
    expect(isWorkingDay(limit)).toBe(true);
    let count = 0;
    for (let d = hire; d <= limit; d = addDaysISO(d, 1)) if (isWorkingDay(d)) count += 1;
    expect(count).toBe(100);
    // 20 weeks of 5 days would end on Thursday 18 February 2027; holidays push it later.
    expect(limit >= '2027-02-18').toBe(true);
  });

  it('counts five working days from a Sunday to the Thursday', () => {
    expect(probationLimit('2026-10-04', 5)).toBe('2026-10-08');
    // Starting on a Friday, the first working day is the Sunday.
    expect(probationLimit('2026-10-09', 1)).toBe('2026-10-11');
  });
});

describe('workforce summary', () => {
  it('counts current staff and the Kuwaiti share without domestic workers', () => {
    const staff = (category: EmployeeCategory, count: number, status: EmployeeStatus = 'active') =>
      Array.from({ length: count }, () => ({ category, status }));
    const summary = workforceSummary([
      ...staff('kuwaiti', 2),
      ...staff('kuwaiti', 1, 'on_leave'),
      ...staff('kuwaiti', 1, 'left'),
      ...staff('gcc', 1),
      ...staff('expat', 5),
      ...staff('domestic', 2),
    ]);
    expect(summary.headcount).toBe(11);
    expect(summary.byCategory).toEqual({ kuwaiti: 3, gcc: 1, expat: 5, domestic: 2 });
    expect(summary.labourLawHeadcount).toBe(9);
    expect(summary.kuwaitiShare).toBe(33.3);
  });

  it('has no share without staff', () => {
    expect(workforceSummary([]).kuwaitiShare).toBeNull();
    expect(workforceSummary([{ category: 'domestic', status: 'active' }]).kuwaitiShare).toBeNull();
  });
});
