import { beforeEach, describe, expect, it } from 'vitest';
import {
  activeGroupId,
  isActivePath,
  isGroupOpen,
  loadGroupState,
  NAV,
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
    expect(activeGroupId('/payroll/runs/1')).toBe('people');
    expect(activeGroupId('/products')).toBe('inventory');
    expect(activeGroupId('/cheques')).toBeNull();
  });

  it('has about eight top-level destinations and hides VAT returns without taxes', () => {
    expect(NAV.length).toBeLessThanOrEqual(10);
    const links = (taxes: boolean) =>
      visibleNav(taxes).flatMap((e) => (e.kind === 'group' ? e.children.map((c) => c.to) : [e.to]));
    expect(links(false)).not.toContain('/vat');
    expect(links(true)).toContain('/vat');
  });

  it('remembers open and closed groups', () => {
    expect(isGroupOpen({}, 'sales')).toBe(true);
    expect(isGroupOpen({}, 'accounting')).toBe(false);
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
