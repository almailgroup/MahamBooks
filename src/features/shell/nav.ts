import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  BookOpen,
  Boxes,
  CalendarClock,
  ChartColumn,
  House,
  Palette,
  Settings,
  ShoppingBag,
  ShoppingCart,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { msg } from '@/i18n';

/**
 * The app's navigation: a few top-level destinations, some of them groups
 * that open to show their pages. Labels are English keys (`t()` them).
 */

export interface NavLink {
  to: string;
  label: string;
  /** Words that find the page in the command palette. */
  keywords?: string;
  /** Shown only when taxes are on (VAT returns). */
  taxesOnly?: boolean;
}

export interface NavTopLink extends NavLink {
  kind: 'link';
  icon: LucideIcon;
  /** Only this exact path is active (Home). */
  end?: boolean;
}

export interface NavGroup {
  kind: 'group';
  id: string;
  label: string;
  icon: LucideIcon;
  children: NavLink[];
}

export type NavEntry = NavTopLink | NavGroup;

export const NAV: NavEntry[] = [
  { kind: 'link', to: '/', label: msg('Home'), icon: House, end: true, keywords: 'dashboard' },
  {
    kind: 'group',
    id: 'sales',
    label: msg('Sales'),
    icon: ShoppingBag,
    children: [
      { to: '/clients', label: msg('Clients'), keywords: 'customers' },
      { to: '/quotes', label: msg('Quotes'), keywords: 'estimates' },
      { to: '/proformas', label: msg('Proforma invoices') },
      { to: '/sales-orders', label: msg('Sales orders') },
      { to: '/invoices', label: msg('Invoices') },
      { to: '/delivery-notes', label: msg('Delivery notes') },
      { to: '/payments', label: msg('Payments received'), keywords: 'receipts' },
      { to: '/credits', label: msg('Credit notes') },
      { to: '/recurring', label: msg('Recurring invoices') },
    ],
  },
  {
    kind: 'group',
    id: 'purchases',
    label: msg('Purchases'),
    icon: ShoppingCart,
    children: [
      { to: '/vendors', label: msg('Vendors'), keywords: 'suppliers' },
      { to: '/purchase-orders', label: msg('Purchase orders'), keywords: 'lpo' },
      { to: '/bills', label: msg('Bills') },
      { to: '/expenses', label: msg('Expenses') },
      { to: '/payments-made', label: msg('Payments made') },
      { to: '/vendor-credits', label: msg('Vendor credits') },
    ],
  },
  { kind: 'link', to: '/cheques', label: msg('Cheques'), icon: WalletCards, keywords: 'pdc' },
  {
    kind: 'group',
    id: 'inventory',
    label: msg('Inventory'),
    icon: Boxes,
    children: [
      { to: '/products', label: msg('Products & services'), keywords: 'items' },
      { to: '/inventory', label: msg('Stock and warehouses'), keywords: 'stock' },
    ],
  },
  {
    kind: 'group',
    id: 'people',
    label: msg('People'),
    icon: UsersRound,
    children: [
      { to: '/employees', label: msg('Employees'), keywords: 'staff' },
      { to: '/payroll', label: msg('Payroll'), keywords: 'salaries pifss' },
    ],
  },
  { kind: 'link', to: '/banking', label: msg('Banking'), icon: Banknote },
  {
    kind: 'group',
    id: 'accounting',
    label: msg('Accounting'),
    icon: BookOpen,
    children: [
      { to: '/accounts', label: msg('Chart of accounts') },
      { to: '/journals', label: msg('Manual journals') },
      { to: '/assets', label: msg('Fixed assets'), keywords: 'depreciation' },
      { to: '/year-end', label: msg('Year-end close') },
      { to: '/vat', label: msg('VAT returns'), taxesOnly: true },
    ],
  },
  { kind: 'link', to: '/reports', label: msg('Reports'), icon: ChartColumn },
  {
    kind: 'link',
    to: '/compliance',
    label: msg('Compliance'),
    icon: CalendarClock,
    keywords: 'licence residency deadlines',
  },
];

/** Pinned to the bottom of the sidebar. */
export const NAV_FOOTER: (NavLink & { icon: LucideIcon })[] = [
  { to: '/templates', label: msg('Templates'), icon: Palette },
  { to: '/settings', label: msg('Settings'), icon: Settings },
];

/**
 * The entries shown for this company: VAT returns only when taxes are on,
 * and People only for roles that see payroll (see src/cloud/roles.ts).
 */
export function visibleNav(
  taxesOn: boolean,
  { people = true }: { people?: boolean } = {},
): NavEntry[] {
  return NAV.filter((entry) => people || entry.kind !== 'group' || entry.id !== 'people').map(
    (entry) =>
      entry.kind === 'group'
        ? { ...entry, children: entry.children.filter((c) => taxesOn || !c.taxesOnly) }
        : entry,
  );
}

/** Whether a link is the current page or one of its sub-pages. */
export function isActivePath(pathname: string, to: string, end = false): boolean {
  if (to === '/' || end) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** The group holding the current page, if any. */
export function activeGroupId(pathname: string, nav: NavEntry[] = NAV): string | null {
  for (const entry of nav) {
    if (entry.kind === 'group' && entry.children.some((c) => isActivePath(pathname, c.to))) {
      return entry.id;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Open and closed groups                                                     */
/* -------------------------------------------------------------------------- */

export type GroupState = Record<string, boolean>;

const GROUPS_KEY = 'almailbooks.nav.groups';

/** Groups open until someone closes them: the everyday sales pages. */
export const DEFAULT_OPEN = new Set(['sales']);

export function loadGroupState(): GroupState {
  try {
    const saved = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '{}') as unknown;
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return Object.fromEntries(
      Object.entries(saved).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'),
    );
  } catch {
    return {};
  }
}

export function saveGroupState(state: GroupState): void {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked (private window): groups reset on the next visit.
  }
}

/** Whether a group shows its pages: as left by the person, else open by default. */
export function isGroupOpen(state: GroupState, id: string): boolean {
  return state[id] ?? DEFAULT_OPEN.has(id);
}

/** Opens the group of the page being visited, so its link is never hidden. */
export function openActiveGroup(state: GroupState, active: string | null): GroupState {
  if (!active || isGroupOpen(state, active)) return state;
  return { ...state, [active]: true };
}
