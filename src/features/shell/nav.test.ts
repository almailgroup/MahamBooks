import { beforeEach, describe, expect, it } from 'vitest';
import { BOOKS } from '@/apps/books/manifest';
import { PEOPLE } from '@/apps/people/manifest';
import { COMPLIANCE } from '@/apps/compliance/manifest';
import {
  activeGroupId,
  activeLink,
  INTEGRATIONS_GROUP,
  isActivePath,
  isGroupOpen,
  loadGroupState,
  navLinks,
  openActiveGroup,
  saveGroupState,
  visibleNav,
} from './nav';

describe('navigation', () => {
  beforeEach(() => localStorage.clear());

  it('marks nested pages as active', () => {
    expect(isActivePath('/', '/', true)).toBe(true);
    expect(isActivePath('/invoices', '/', true)).toBe(false);
    expect(isActivePath('/invoices/abc/edit', '/invoices')).toBe(true);
    expect(isActivePath('/payments-made/1', '/payments')).toBe(false);
    // People's sidebar has no groups.
    expect(activeGroupId('/payroll/runs/1', PEOPLE.nav)).toBeNull();
    expect(activeGroupId('/products', BOOKS.nav)).toBe('inventory');
    expect(activeGroupId('/cheques', BOOKS.nav)).toBeNull();
    expect(activeGroupId('/payroll/runs/1', BOOKS.nav)).toBeNull();
  });

  it('marks the closest link as current', () => {
    const links = navLinks(PEOPLE.nav);
    expect(activeLink('/payroll/leave', links)).toBe('/payroll/leave');
    expect(activeLink('/payroll/runs/1', links)).toBe('/payroll');
    expect(activeLink('/people/directory', links)).toBe('/people/directory');
    expect(activeLink('/people', links)).toBe('/people');
    expect(activeLink('/', links)).toBe('/');
    expect(activeLink('/invoices', links)).toBeNull();
  });

  it('has about ten top-level destinations and hides VAT returns without taxes', () => {
    expect(BOOKS.nav.length).toBeLessThanOrEqual(10);
    const links = (taxes: boolean) =>
      visibleNav(BOOKS.nav, taxes).flatMap((e) =>
        e.kind === 'group' ? e.children.map((c) => c.to) : [e.to],
      );
    expect(links(false)).not.toContain('/vat');
    expect(links(true)).toContain('/vat');
  });

  it('shows Compliance’s vehicles only with the register’s extras', () => {
    const links = (extras: boolean) =>
      navLinks(visibleNav(COMPLIANCE.nav, false, extras)).map((l) => l.to);
    expect(links(false)).toEqual(['/', '/compliance', '/compliance/documents']);
    expect(links(true)).toEqual([
      '/',
      '/compliance',
      '/compliance/documents',
      '/compliance/vehicles',
    ]);
  });

  it('shows Files only with the document finder', () => {
    const links = (finder: boolean) =>
      navLinks(visibleNav(COMPLIANCE.nav, false, false, finder)).map((l) => l.to);
    expect(links(false)).not.toContain('/files');
    expect(links(true)).toEqual(['/', '/compliance', '/compliance/documents', '/files']);
  });

  it('shows Manpower costing only where it can be used (on this device, or once the cloud has it)', () => {
    const links = (costing: boolean) =>
      navLinks(visibleNav(PEOPLE.nav, false, false, false, false, false, costing)).map((l) => l.to);
    expect(links(false)).not.toContain('/people/costing');
    expect(links(true)).toContain('/people/costing');
    // Letters are as before.
    expect(links(false)).toContain('/people/letters');
  });

  it('remembers open and closed groups', () => {
    expect(isGroupOpen({}, 'sales')).toBe(true);
    expect(isGroupOpen({}, 'accounting')).toBe(false);
    // The company's integrations show until someone closes them.
    expect(isGroupOpen({}, INTEGRATIONS_GROUP)).toBe(true);
    expect(isGroupOpen({ [INTEGRATIONS_GROUP]: false }, INTEGRATIONS_GROUP)).toBe(false);
    saveGroupState({ sales: false, accounting: true });
    const state = loadGroupState();
    expect(isGroupOpen(state, 'sales')).toBe(false);
    expect(isGroupOpen(state, 'accounting')).toBe(true);
  });

  it('opens the group of the current page', () => {
    const state = { people: false };
    expect(openActiveGroup(state, 'people')).toEqual({ people: true });
    expect(openActiveGroup(state, null)).toBe(state);
    expect(openActiveGroup({ sales: true }, 'sales')).toEqual({ sales: true });
  });

  it('ignores broken saved state', () => {
    localStorage.setItem('almailbooks.nav.groups', '{not json');
    expect(loadGroupState()).toEqual({});
    localStorage.setItem('almailbooks.nav.groups', JSON.stringify({ sales: 'yes', people: true }));
    expect(loadGroupState()).toEqual({ people: true });
  });
});
