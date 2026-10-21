import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router';
import { routes } from '@/app/routes';
import { canEdit as roleCanEdit, canSeePeople, MEMBER_ROLES } from '@/cloud/roles';
import { navLinks } from '@/features/shell/nav';
import {
  accessMap,
  appAccess,
  appForPath,
  APPS,
  canEdit,
  canOpen,
  createColumns,
  createGroups,
  firstSegment,
  visibleApps,
} from './apps';

const ROLES = [...MEMBER_ROLES, null] as const;

describe('the apps of Maham One', () => {
  it('are Books, People, CRM and Compliance', () => {
    expect(APPS.map((a) => a.id)).toEqual(['books', 'people', 'crm', 'compliance']);
    expect(new Set(APPS.map((a) => a.tone)).size).toBe(APPS.length);
  });

  it('each own their own first path segments', () => {
    const owners = APPS.flatMap((a) => a.owns);
    expect(owners.filter((s, i) => owners.indexOf(s) !== i)).toEqual([]);
    for (const app of APPS) expect(app.owns).toContain(firstSegment(app.home));
  });

  it('only share pages another app owns', () => {
    for (const app of APPS) {
      for (const segment of app.shares ?? []) {
        expect(APPS.some((other) => other.id !== app.id && other.owns.includes(segment))).toBe(
          true,
        );
      }
    }
  });

  it('find the app of a page from its address', () => {
    expect(firstSegment('/invoices/x/edit?status=overdue')).toBe('invoices');
    expect(firstSegment('/')).toBe('');
    expect(appForPath('/invoices/1')).toBe('books');
    expect(appForPath('/books')).toBe('books');
    expect(appForPath('/employees/1/edit')).toBe('people');
    expect(appForPath('/payroll/leave')).toBe('people');
    expect(appForPath('/people/directory')).toBe('people');
    expect(appForPath('/compliance/documents')).toBe('compliance');
    expect(appForPath('/crm/prospects')).toBe('crm');
    // Every app's files, listed in Compliance.
    expect(appForPath('/files')).toBe('compliance');
    // The suite's own pages belong to no app.
    expect(appForPath('/')).toBeNull();
    expect(appForPath('/settings/team')).toBeNull();
    expect(appForPath('/setup')).toBeNull();
  });

  it('keep CRM around the Books pages it lists when CRM was open', () => {
    expect(appForPath('/clients/1', 'crm')).toBe('crm');
    expect(appForPath('/quotes', 'crm')).toBe('crm');
    expect(appForPath('/clients/1', 'books')).toBe('books');
    expect(appForPath('/clients/1', null)).toBe('books');
    // Not a page CRM lists.
    expect(appForPath('/invoices', 'crm')).toBe('books');
  });

  it('have three phone tabs, sidebar links, tools and New groups that open real pages', () => {
    for (const app of APPS) {
      expect(app.tabs).toHaveLength(3);
      // A few tools for the home, each once, never the home itself.
      const tools = app.tools.map((tool) => tool.to);
      expect(tools.length, app.id).toBeGreaterThan(0);
      expect(tools.length, app.id).toBeLessThanOrEqual(12);
      expect(new Set(tools).size, app.id).toBe(tools.length);
      expect(tools, app.id).not.toContain('/');
      const targets = [
        app.home,
        ...tools,
        ...app.tabs.map((tab) => tab.to),
        ...navLinks(app.nav).map((l) => l.to),
        ...app.footer.map((l) => l.to),
        ...app.create.flatMap((g) => g.actions.map((a) => a.to)),
      ];
      for (const to of targets) {
        const match = matchRoutes(routes, to.split('?')[0]);
        expect(match?.[match.length - 1].route.path, `${app.id}: ${to}`).not.toBe('*');
      }
    }
  });

  it('give each sidebar group its own id', () => {
    const ids = APPS.flatMap((a) => a.nav.flatMap((e) => (e.kind === 'group' ? [e.id] : [])));
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
});

describe('who opens which app', () => {
  it('shows People exactly to the roles that may see salaries', () => {
    for (const role of ROLES) {
      expect(canOpen(appAccess('people', role)), String(role)).toBe(canSeePeople(role));
    }
  });

  it('never lets someone work in an app their role may not change', () => {
    for (const role of ROLES) {
      for (const app of APPS) {
        if (canEdit(appAccess(app.id, role))) expect(roleCanEdit(role)).toBe(true);
      }
    }
  });

  it('follows the access matrix', () => {
    expect(accessMap('owner')).toEqual({
      books: 'manage',
      people: 'manage',
      crm: 'manage',
      compliance: 'manage',
    });
    expect(accessMap(null)).toEqual(accessMap('owner'));
    expect(accessMap('accountant')).toEqual({
      books: 'manage',
      people: 'manage',
      crm: 'edit',
      compliance: 'manage',
    });
    expect(accessMap('staff')).toEqual({
      books: 'edit',
      people: 'none',
      crm: 'edit',
      compliance: 'view',
    });
    expect(accessMap('viewer')).toEqual({
      books: 'view',
      people: 'none',
      crm: 'view',
      compliance: 'view',
    });
  });

  it('shows nothing of People and changes nothing until the role is known', () => {
    expect(accessMap('owner', false)).toEqual({
      books: 'view',
      people: 'none',
      crm: 'view',
      compliance: 'view',
    });
    expect(visibleApps(accessMap('owner', false)).map((a) => a.id)).not.toContain('people');
  });
});

describe('the New menus', () => {
  const ids = (role: Parameters<typeof accessMap>[0]) =>
    createGroups('books', accessMap(role)).flatMap((g) => g.actions.map((a) => a.id));

  it('offer each action once, the open app’s first', () => {
    const all = ids('owner');
    expect(all.filter((id, i) => all.indexOf(id) !== i)).toEqual([]);
    for (const app of APPS) {
      const labels = createGroups(app.id, accessMap('owner')).map((g) => g.label);
      expect(
        labels.filter((l, i) => labels.indexOf(l) !== i),
        app.id,
      ).toEqual([]);
    }
    expect(all[0]).toBe('invoice');
    expect(createGroups('people', accessMap('owner'))[0].actions[0].id).toBe('employee');
    // CRM's Sales first, then the rest of Books' sales in the same group.
    expect(createGroups('crm', accessMap('owner'))[0].actions.map((a) => a.id)).toEqual([
      'quote',
      'client',
      'sales_order',
      'invoice',
      'proforma',
      'delivery_note',
      'credit',
      'recurring',
      'payment_in',
    ]);
  });

  it('never offer an employee to staff, nor anything to viewers', () => {
    expect(ids('staff')).not.toContain('employee');
    expect(ids('staff')).toContain('invoice');
    expect(ids('viewer')).toEqual([]);
  });

  it('lay groups out in two columns', () => {
    const [left, right] = createColumns(createGroups('books', accessMap('owner')));
    expect(left.map((g) => g.label)).toContain('Sales');
    expect(right.map((g) => g.label)).toContain('Purchases');
    expect(left.length + right.length).toBe(createGroups('books', accessMap('owner')).length);
  });
});
