import { describe, expect, it } from 'vitest';
import { createClient } from '@/db/defaults';
import { customerChoices } from './costing-hooks';

/**
 * The customers a manpower costing (#3) may be for: as the other editors
 * offer them, with the costing's own customer kept whatever happened to it.
 * Invented names only.
 */

const contact = (name: string, extra: Parameters<typeof createClient>[1] = {}) =>
  createClient('co-1', { name, ...extra });

describe('the customers of a costing', () => {
  const buyer = contact('Made-up Towers Co.');
  const both = contact('Made-up Two-Way Trading', { isCustomer: true, isVendor: true });
  const vendor = contact('Made-up Supplies', { isCustomer: false, isVendor: true });
  const archived = contact('Made-up Old Mall', { archived: true });
  const all = [buyer, both, vendor, archived];

  it('are those who buy from the company, a contact that also sells to it included', () => {
    expect(customerChoices(all, null).map((c) => c.name)).toEqual([
      'Made-up Towers Co.',
      'Made-up Two-Way Trading',
    ]);
  });

  it('keep the costing’s own customer once archived or ticked as a vendor only', () => {
    expect(customerChoices(all, archived.id).map((c) => c.name)).toContain('Made-up Old Mall');
    expect(customerChoices(all, vendor.id).map((c) => c.name)).toContain('Made-up Supplies');
  });
});
