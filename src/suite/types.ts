import type { LucideIcon } from 'lucide-react';
import type { MemberRole } from '@/cloud/roles';
import type { NavEntry, NavLink } from '@/features/shell/nav';
import type { CreateGroup } from '@/features/shell/create';

/**
 * Maham One is a suite of apps over one company's data: Maham Books
 * (accounting), Maham People (HR and payroll), Maham CRM (sales pipeline)
 * and Maham Compliance (licences and deadlines). Each app describes itself
 * in a manifest; the shell (sidebar, app switcher, phone tabs, New menus,
 * command palette, suite home) is built from the manifests.
 */

export type AppId = 'books' | 'people' | 'crm' | 'compliance';

/**
 * What someone may do in an app: nothing (it is hidden), look, work in it,
 * or also set it up. Derived from their role in the company; the server
 * enforces the same rules on the data itself.
 */
export type AppAccess = 'none' | 'view' | 'edit' | 'manage';

/** The colour of an app's icon tile; one of the palettes every theme defines. */
export type AppTone = 'indigo' | 'emerald' | 'sky' | 'amber';

/** A tab of the phone's bottom bar. */
export interface AppTab {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/** One of an app's main pages, as a round tile on the home. */
export interface AppTool {
  to: string;
  /** An English key (`t()` it). */
  label: string;
  icon: LucideIcon;
  /** Words that find the tool in the home's filter. */
  keywords?: string;
}

/** Who opens the app: a role in a cloud company, or 'device' for a company kept on this device only. */
export type AccessKey = MemberRole | 'device';

export interface SuiteApp {
  id: AppId;
  /** The product name, untranslated: "Maham Books". */
  name: string;
  /** The product name in Arabic: "مهام بوكس". */
  nameAr: string;
  /** One line on what the app is for (an English key, `t()` it). */
  description: string;
  icon: LucideIcon;
  tone: AppTone;
  /** Where the app opens. */
  home: string;
  /** First path segments of the app's pages (`invoices` for /invoices/…). */
  owns: readonly string[];
  /**
   * Pages of other apps this app also lists (CRM's Customers and Quotes are
   * Books pages): opened from this app, they keep its sidebar.
   */
  shares?: readonly string[];
  /** The sidebar. */
  nav: NavEntry[];
  /** Pinned to the bottom of the sidebar. */
  footer: (NavLink & { icon: LucideIcon })[];
  /** What the app's people create (New menu, + sheet, palette). Needs 'edit'. */
  create: (CreateGroup & { column?: 0 | 1 })[];
  /** The pages most used, a tap away on the home: a few, not the whole sidebar. */
  tools: AppTool[];
  /** The phone's three tabs around the + button. */
  tabs: readonly [AppTab, AppTab, AppTab];
  access: Record<AccessKey, AppAccess>;
  /** A first version built on existing data; more is planned. */
  preview?: boolean;
}
