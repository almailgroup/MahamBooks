import { describe, expect, it } from 'vitest';
import { accessMap } from '../apps';
import {
  appTiles,
  createTiles,
  filterTiles,
  initialsOf,
  linkTiles,
  MAX_CREATE,
  toolGroups,
  type Tile,
} from './tiles';

const owner = accessMap('owner');
const keys = (tiles: Tile[]) => tiles.map((tile) => tile.key);

describe('the home’s round tiles', () => {
  it('show the apps and their tools for the role', () => {
    expect(keys(appTiles(owner))).toEqual(['app:books', 'app:people', 'app:crm', 'app:compliance']);
    expect(toolGroups(owner).map((g) => g.app.id)).toEqual([
      'books',
      'people',
      'crm',
      'compliance',
    ]);
    for (const role of ['staff', 'viewer'] as const) {
      const access = accessMap(role);
      expect(keys(appTiles(access))).not.toContain('app:people');
      const tools = toolGroups(access).flatMap((g) => g.tiles.map((tile) => tile.to));
      expect(tools.filter((to) => /^\/(people|employees|payroll)/.test(to ?? ''))).toEqual([]);
      expect(tools).toContain('/invoices');
    }
    // Before the role is known: nothing of People.
    expect(keys(appTiles(accessMap('owner', false)))).not.toContain('app:people');
  });

  it('offer the things most often created, only to those who may', () => {
    const owners = createTiles('books', owner, false);
    expect(owners).toHaveLength(MAX_CREATE);
    // Every app they work in has one, People included, then the most used.
    expect(keys(owners)).toEqual([
      'action:invoice',
      'action:quote',
      'action:expense',
      'action:payment_in',
      'action:bill',
      'action:employee',
    ]);
    expect(owners[0]).toMatchObject({ label: 'Invoice', name: 'New invoice', to: '/invoices/new' });
    expect(keys(createTiles('books', accessMap('accountant'), false))).toContain('action:employee');
    expect(keys(createTiles('crm', owner, false))).toEqual(keys(owners));
    // Staff work in Books and CRM, never People.
    expect(keys(createTiles('books', accessMap('staff'), false))).toEqual([
      'action:invoice',
      'action:quote',
      'action:expense',
      'action:payment_in',
      'action:bill',
      'action:client',
    ]);
    // Before the role is known nothing is created at all.
    expect(createTiles('books', accessMap('owner', false), false)).toEqual([]);
    expect(createTiles('books', accessMap('viewer'), false)).toEqual([]);
    // No longer shared, or view only: nothing to create.
    expect(createTiles('books', owner, true)).toEqual([]);
  });

  it('show the company’s links with their initials', () => {
    const [tile] = linkTiles([
      { id: 'l1', label: 'Task portal', labelAr: 'بوابة المهام', url: 'https://tasks.example.com' },
    ]);
    expect(tile).toMatchObject({
      key: 'link:l1',
      label: 'Task portal',
      initials: 'TP',
      href: 'https://tasks.example.com',
      icon: null,
    });
    expect(initialsOf('Leave requests portal')).toBe('LP');
    expect(initialsOf('بوابة المهام')).toBe('ب‌ا');
    expect(initialsOf('  ')).toBe('?');
  });

  it('are found by name, keyword or app, in English or Arabic, each place once', () => {
    const all = [
      ...appTiles(owner),
      ...createTiles('books', owner, false),
      ...toolGroups(owner).flatMap((g) => g.tiles),
      ...linkTiles([{ id: 'l1', label: 'Task portal', url: 'https://tasks.example.com' }]),
    ];
    const find = (q: string) => filterTiles(all, q).map((tile) => tile.to ?? tile.href);
    expect(find('')).toEqual([]);
    expect(find('payroll')).toContain('/payroll');
    expect(find('salaries')).toEqual(['/payroll']);
    expect(find('maham crm')[0]).toBe('/crm');
    expect(find('portal')).toEqual(['https://tasks.example.com']);
    expect(find('new invoice')).toEqual(['/invoices/new']);
    // Books and CRM both list Customers: once.
    expect(find('customers').filter((to) => to === '/clients')).toHaveLength(1);
    expect(find('مهام بيبول')).toEqual(['/people']);
    expect(find('nothing like this')).toEqual([]);
  });
});
