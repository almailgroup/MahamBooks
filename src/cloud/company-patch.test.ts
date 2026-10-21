import { describe, expect, it } from 'vitest';
import { companyOps, onlyCounters, rebaseCompany } from './company-patch';
import { staffCompanyChangeOk } from './roles';

const rule = (next: number, period = '2026', pattern = 'INV-{counter}') => ({
  pattern,
  next,
  padding: 4,
  reset: 'yearly',
  period,
});

const base = {
  id: 'co-1',
  name: 'Al Mail Trading',
  phone: '',
  address: { line1: 'Block 4', city: 'Salmiya', country: 'KW' },
  accounting: { template: 'kw', lockDate: null },
  holidays: [{ date: '2026-02-25' }],
  numbering: { invoice: rule(5), payment: rule(3) },
};

describe('company changes by field', () => {
  it('are the leaves that changed; a counter goes with its period', () => {
    const local = {
      ...base,
      address: { ...base.address, city: 'Hawalli' },
      accounting: { ...base.accounting, lockDate: '2026-09-30' },
      holidays: [{ date: '2026-02-26' }],
      numbering: { ...base.numbering, invoice: rule(6) },
    };
    expect(companyOps(base, local)).toEqual([
      { path: ['address', 'city'], value: 'Hawalli', base: 'Salmiya' },
      { path: ['accounting', 'lockDate'], value: '2026-09-30', base: null },
      { path: ['holidays'], value: [{ date: '2026-02-26' }], base: [{ date: '2026-02-25' }] },
      { path: ['numbering', 'invoice', 'next'], value: 6, base: 5 },
      { path: ['numbering', 'invoice', 'period'], value: '2026', base: '2026' },
    ]);
    expect(companyOps(base, { ...base })).toEqual([]);
    const { phone: _phone, ...withoutPhone } = base;
    expect(companyOps(base, withoutPhone)).toEqual([{ path: ['phone'], remove: true, base: '' }]);
  });

  it('tell numbering a document from changing settings', () => {
    const counted = { ...base, numbering: { ...base.numbering, invoice: rule(6) } };
    expect(onlyCounters(companyOps(base, counted))).toBe(true);
    const renamed = {
      ...counted,
      numbering: { ...counted.numbering, invoice: rule(6, '2026', 'F-{counter}') },
    };
    expect(onlyCounters(companyOps(base, renamed))).toBe(false);
    expect(onlyCounters([])).toBe(false);
  });

  it('are laid over a newer copy: others’ fields stay, counters never go back, conflicts are named', () => {
    const local = {
      ...base,
      phone: '+965 3333 0000',
      numbering: { ...base.numbering, invoice: rule(6) },
    };
    const newer = {
      ...base,
      phone: '+965 2222 0000',
      accounting: { ...base.accounting, lockDate: '2026-09-30' },
      numbering: { ...base.numbering, invoice: rule(9) },
    };
    const { data, conflicts } = rebaseCompany(newer, companyOps(base, local));
    expect(data).toMatchObject({
      phone: '+965 3333 0000',
      accounting: { lockDate: '2026-09-30' },
      numbering: { invoice: { next: 9, period: '2026' }, payment: { next: 3 } },
    });
    expect(conflicts).toEqual([['phone']]);
    // A counter of last year never moves a counter of this year.
    const lastYear = { ...base, numbering: { ...base.numbering, invoice: rule(41, '2025') } };
    const thisYear = { ...base, numbering: { ...base.numbering, invoice: rule(2, '2026') } };
    const merged = rebaseCompany(
      thisYear,
      companyOps(
        { ...lastYear, numbering: { ...base.numbering, invoice: rule(40, '2025') } },
        lastYear,
      ),
    );
    expect(merged.data.numbering).toMatchObject({ invoice: { next: 2, period: '2026' } });
  });

  it('carry a new company type alone, beside documents numbered elsewhere', () => {
    const security = { id: 'security', name: 'Security services', nameAr: 'الخدمات الأمنية' };
    const typed = { ...base, companyType: security };
    const ops = companyOps(base, typed);
    expect(ops).toEqual([{ path: ['companyType'], value: security }]);
    expect(onlyCounters(ops)).toBe(false);
    // Another device numbered an invoice meanwhile: both stay, and nothing clashes.
    const numbered = { ...base, numbering: { ...base.numbering, invoice: rule(9) } };
    const { data, conflicts } = rebaseCompany(numbered, ops);
    expect(data).toMatchObject({ companyType: security, numbering: { invoice: { next: 9 } } });
    expect(conflicts).toEqual([]);
    // Another type replaces it as a whole; none removes it.
    const guarding = { id: 'type-guarding', name: 'Guarding' };
    const changed = rebaseCompany(typed, companyOps(typed, { ...base, companyType: guarding }));
    expect(changed.data.companyType).toEqual(guarding);
    expect(companyOps(typed, base)).toEqual([
      { path: ['companyType'], remove: true, base: security },
    ]);
    // Staff only number documents: a type change is not theirs to make.
    expect(staffCompanyChangeOk(base, typed)).toBe(false);
    expect(staffCompanyChangeOk(typed, numbered)).toBe(false);
    expect(staffCompanyChangeOk(typed, { ...typed, numbering: numbered.numbering })).toBe(true);
  });

  it('carry a company type as a whole, so two devices’ types never mix', () => {
    const guarding = { id: 'x', name: 'Guarding' };
    const before = { ...base, companyType: guarding };
    const events = { id: 'z', name: 'Events', nameAr: 'فعاليات' };
    const patrol = { id: 'y', name: 'Patrol' };
    const ops = companyOps(before, { ...before, companyType: patrol });
    expect(ops).toEqual([{ path: ['companyType'], value: patrol, base: guarding }]);
    // Another device saved Events meanwhile: this device's type replaces it, names and all.
    const { data, conflicts } = rebaseCompany({ ...before, companyType: events }, ops);
    expect(data.companyType).toEqual(patrol);
    expect(conflicts).toEqual([['companyType']]);
  });

  it('make the objects on the way and remove fields', () => {
    const { data } = rebaseCompany({ id: 'co-1' }, [
      { path: ['bankAccount', 'iban'], value: 'KW00TEST0000000000000000000000' },
      { path: ['website'], remove: true },
    ]);
    expect(data).toEqual({ id: 'co-1', bankAccount: { iban: 'KW00TEST0000000000000000000000' } });
  });
});
