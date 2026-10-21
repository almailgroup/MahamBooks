import { describe, expect, it } from 'vitest';
import { createCompany } from '@/db/defaults';
import type { CompanyType } from '@/db/types';
import { kuwaitProfile } from '@/lib/kuwait-rules';
import {
  COMPANY_TYPES,
  companyTypeName,
  companyTypeOptions,
  newCompanyType,
  normalizeCompanyType,
  resolveCompanyType,
  withTidyProfile,
} from './company-types';

const guarding: CompanyType = { id: 'type-guarding', name: 'Guarding', nameAr: 'الحراسة' };

describe('company types', () => {
  it('offer the built-in types first, then the others once each, trimmed, by name', () => {
    const options = companyTypeOptions([
      { companyType: { id: 'type-events', name: '  Events  ' } },
      { companyType: { id: 'type-guarding', name: 'Guarding' } },
      { companyType: guarding },
      { companyType: { id: 'security', name: 'Old spelling' } },
      { companyType: { id: 'type-blank', name: '   ' } },
      {},
    ]);
    expect(options.map((o) => o.id)).toEqual([
      ...COMPANY_TYPES.map((t) => t.id),
      'type-events',
      'type-guarding',
    ]);
    // The Arabic name another company gave the type is kept; built-in names stay their own.
    expect(options.find((o) => o.id === 'type-guarding')).toEqual(guarding);
    expect(options.find((o) => o.id === 'type-events')).toEqual({
      id: 'type-events',
      name: 'Events',
    });
    expect(options.find((o) => o.id === 'security')?.name).toBe('Security services');
  });

  it('sort the other types in the language of the interface', () => {
    const companies = [
      { companyType: { id: 'b', name: 'Zoos', nameAr: 'الحدائق' } },
      { companyType: { id: 'a', name: 'Bakeries', nameAr: 'المخابز' } },
    ];
    const order = (language: 'en' | 'ar') =>
      companyTypeOptions(companies, language)
        .slice(COMPANY_TYPES.length)
        .map((o) => o.id);
    expect(order('ar')).toEqual(['b', 'a']);
    expect(order('en')).toEqual(['a', 'b']);
  });

  it('are named in Arabic when they have an Arabic name', () => {
    expect(companyTypeName(guarding, 'ar')).toBe('الحراسة');
    expect(companyTypeName(guarding, 'en')).toBe('Guarding');
    expect(companyTypeName({ id: 'type-events', name: 'Events' }, 'ar')).toBe('Events');
    expect(companyTypeName({ id: 'manpower', name: 'Typed differently' }, 'ar')).toBe(
      'توريد العمالة',
    );
    expect(companyTypeName(undefined)).toBe('');
  });

  it('are saved without a name as no type at all', () => {
    expect(normalizeCompanyType({ id: 'x', name: '  ', nameAr: '' })).toBeUndefined();
    expect(normalizeCompanyType(undefined)).toBeUndefined();
    // Arabic only: the Arabic name is the name too.
    expect(normalizeCompanyType({ id: 'x', name: '', nameAr: ' الحراسة ' })).toEqual({
      id: 'x',
      name: 'الحراسة',
      nameAr: 'الحراسة',
    });
  });

  it('typed the same on two devices, have the same id', () => {
    const one = newCompanyType('Facility  management', 'إدارة المرافق');
    const two = newCompanyType(' facility management ');
    expect(one.id).toBe(two.id);
    expect(one.id).not.toBe(newCompanyType('Facilities').id);
  });

  it('reuse a known type named the same in either language', () => {
    const known = companyTypeOptions([{ companyType: guarding }]);
    expect(resolveCompanyType(newCompanyType(' guarding '), known)).toEqual(guarding);
    expect(resolveCompanyType(newCompanyType('', 'الحراسة'), known)).toEqual(guarding);
    // A built-in type is saved with its own names.
    expect(resolveCompanyType(newCompanyType('Security Services'), known)).toEqual(
      COMPANY_TYPES[0],
    );
    expect(resolveCompanyType({ id: 'trading', name: 'x' }, [])).toEqual(
      COMPANY_TYPES.find((t) => t.id === 'trading'),
    );
    // A type the company already has stays as it is, even named like another one.
    const own = { id: 'type-own', name: 'Guarding' };
    expect(resolveCompanyType(own, [...known, own])).toEqual(own);
    const fresh = newCompanyType('Events ', 'الفعاليات');
    expect(resolveCompanyType(fresh, known)).toEqual({ ...fresh, name: 'Events' });
    expect(resolveCompanyType(newCompanyType(''), known)).toBeUndefined();
  });

  it('keep a type that shares only one name, and correct the Arabic name of a known one', () => {
    const known = companyTypeOptions([{ companyType: guarding }]);
    // Another English name with the same Arabic: another type, as typed.
    const events = newCompanyType('Event security', 'الحراسة');
    expect(resolveCompanyType(events, known)).toEqual(events);
    // The same English name with another Arabic: the known type, its Arabic corrected.
    expect(resolveCompanyType(newCompanyType('Guarding', 'الحراسة الأمنية'), known)).toEqual({
      id: 'type-guarding',
      name: 'Guarding',
      nameAr: 'الحراسة الأمنية',
    });
    // A built-in type keeps its own names.
    expect(resolveCompanyType(newCompanyType('General trading', 'تجارة'), known)).toEqual(
      COMPANY_TYPES.find((t) => t.id === 'trading'),
    );
  });

  it('are tidied with the legal form when a form saves the company', () => {
    const company = createCompany({
      name: 'Made-up Services',
      companyType: newCompanyType('  '),
      kuwait: { ...kuwaitProfile({}), legalForm: 'other', legalFormOther: '  Professional ' },
    });
    const saved = withTidyProfile(company, []);
    expect('companyType' in saved).toBe(false);
    expect(saved.kuwait?.legalFormOther).toBe('Professional');
    // The description belongs to Other only.
    const wll = withTidyProfile({ ...saved, kuwait: { ...saved.kuwait!, legalForm: 'wll' } }, []);
    expect(wll.kuwait && 'legalFormOther' in wll.kuwait).toBe(false);
    expect(wll.kuwait?.legalForm).toBe('wll');
    // A company without a Kuwait profile gets none.
    expect(withTidyProfile(createCompany({ name: 'X' }), []).kuwait).toBeUndefined();
  });
});
