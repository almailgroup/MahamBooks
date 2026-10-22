import { describe, expect, it } from 'vitest';
import { accessMap, SPLIT_APPS } from '../apps';
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

  it('show Sales, Books and Inventory in the split layout, with their tools', () => {
    const split = accessMap('owner', true, undefined, SPLIT_APPS);
    expect(keys(appTiles(split, 'en', SPLIT_APPS))).toEqual([
      'app:sales',
      'app:books',
      'app:inventory',
      'app:people',
      'app:crm',
      'app:compliance',
    ]);
    const groups = toolGroups(split, 'en', SPLIT_APPS);
    const tools = (id: string) => groups.find((g) => g.app.id === id)!.tiles.map((t) => t.to);
    expect(tools('sales')).toContain('/invoices');
    expect(tools('books')).toContain('/bills');
    expect(tools('inventory')).toContain('/inventory');
    // A tile each, filtered once by where it goes.
    expect(appTiles(split, 'ar', SPLIT_APPS).map((tile) => tile.label)).toEqual([
      'مهام سيلز',
      'مهام بوكس',
      'مهام إنفنتوري',
      'مهام بيبول',
      'مهام CRM',
      'مهام الامتثال',
    ]);
    const staff = accessMap('staff', true, undefined, SPLIT_APPS);
    expect(keys(appTiles(staff, 'en', SPLIT_APPS))).not.toContain('app:people');
    expect(keys(createTiles('sales', split, false, SPLIT_APPS))).toEqual([
      'action:invoice',
      'action:quote',
      'action:expense',
      'action:payment_in',
      'action:bill',
      'action:employee',
    ]);
    expect(
      createTiles('sales', accessMap('viewer', true, undefined, SPLIT_APPS), false, SPLIT_APPS),
    ).toEqual([]);
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

  it('find an integration by its name in either language or by "integrations"', () => {
    const tiles = linkTiles([
      { id: 'tasks', label: 'Tasks', url: 'https://tasks.example.com' },
      {
        id: 'deema',
        label: 'Deema',
        labelAr: 'ديما',
        url: 'https://merchant.example.com',
        section: 'integrations',
        preset: 'deema',
      },
    ]);
    const find = (q: string) => filterTiles(tiles, q).map((tile) => tile.key);
    expect(find('integrations')).toEqual(['link:deema']);
    expect(find('deema')).toEqual(['link:deema']);
    expect(find('ديما')).toEqual(['link:deema']);
    expect(find('tasks')).toEqual(['link:tasks']);
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
