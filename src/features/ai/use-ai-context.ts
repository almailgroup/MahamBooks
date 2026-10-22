import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { useCompany } from '@/app/company';
import { approvalsOn, payrollApprovalsShown } from '@/db/approvals';
import { fileFinderOn } from '@/db/files';
import { useTaxesEnabled } from '@/features/company/taxes';
import { useRoleView } from '@/features/cloud/role-gates';
import { useCostingShown } from '@/features/people/costing-hooks';
import { visibleNav, type NavEntry } from '@/features/shell/nav';
import { SETTINGS_GROUPS } from '@/features/shell/settings-sections';
import { registerExtrasOn } from '@/lib/compliance';
import { msg, t } from '@/i18n';
import { useLanguage } from '@/i18n/provider';
import { visibleApps } from '@/suite/apps';
import { useAppAccess, useApps, useCurrentApp } from '@/suite/current-app';
import type { AppId } from '@/suite/types';
import {
  appName,
  guideLines,
  pageLabel,
  placePath,
  systemInstruction,
  type AiPlace,
} from './context';

/** Questions to start with, by the app open (English keys, `t()` them). */
const STARTERS: Record<AppId | 'suite', string[]> = {
  people: [
    msg('How do I record annual leave?'),
    msg('How do I run this month’s payroll?'),
    msg('How is end-of-service indemnity worked out in Kuwait?'),
    msg('How do I issue a salary certificate?'),
  ],
  books: [
    msg('How do I record a post-dated cheque?'),
    msg('How do I turn a quote into an invoice?'),
    msg('How do I send a customer a statement of account?'),
    msg('How do I record an expense with its receipt?'),
  ],
  sales: [
    msg('How do I turn a quote into an invoice?'),
    msg('How do I record a payment received by KNET?'),
    msg('How do I send a customer a statement of account?'),
  ],
  inventory: [
    msg('How do I count the stock in a warehouse?'),
    msg('How do I print labels for my items?'),
    msg('How do I add the shipping costs to the items bought?'),
  ],
  crm: [
    msg('How do I follow up on a quote?'),
    msg('How do I add a prospect?'),
    msg('How do I turn a won quote into a sales order?'),
  ],
  compliance: [
    msg('How do I add a licence with its expiry date?'),
    msg('How do I get reminders before papers expire?'),
    msg('Which deadlines does the calendar show?'),
  ],
  suite: [
    msg('What can Maham One do for my company?'),
    msg('How do I add someone to my team?'),
    msg('How do I switch the app to Arabic?'),
  ],
};

export interface AiContext {
  /** The system instruction sent with each question. */
  system: string;
  place: AiPlace;
  /** Questions to start with on this page (translated). */
  starters: string[];
  /**
   * The person's role is known, so the guide holds the apps they open: until
   * then nothing is asked (the panel's first render comes before it).
   */
  ready: boolean;
}

/**
 * Where the person is, for the AI assistant: the system instruction with
 * the page and the guide to the apps they can open, and starter questions.
 * Reads the company's switches (which pages the sidebars show) and the
 * person's role, never a record.
 */
export function useAiContext(): AiContext {
  const company = useCompany();
  const { pathname } = useLocation();
  const { language } = useLanguage();
  const app = useCurrentApp();
  const apps = useApps();
  const access = useAppAccess();
  const { role, known } = useRoleView();
  const taxesOn = useTaxesEnabled();
  const costing = useCostingShown();
  const extras = registerExtrasOn(company);
  const finder = fileFinderOn(company);
  const approvals = approvalsOn(company);
  const payrollApprovals = payrollApprovalsShown(company);

  return useMemo(() => {
    const nav = (entries: NavEntry[]) =>
      visibleNav(entries, taxesOn, extras, finder, approvals, payrollApprovals, costing.available);
    const translate = (key: string) => t(key);
    const sections = SETTINGS_GROUPS.flatMap((group) => group.items);
    const current = { app, nav: nav(app.nav) };
    const open = visibleApps(access, apps);
    const place: AiPlace = {
      app: appName(app, language),
      page: pageLabel(pathname, current, open, sections, translate),
      path: placePath(pathname),
      language,
      role,
    };
    const system = systemInstruction({
      place,
      // The open app first: a page two apps list is named under it.
      guide: guideLines(
        [app, ...open.filter((a) => a.id !== app.id)].map((a) => ({ app: a, nav: nav(a.nav) })),
        translate,
        language,
      ),
      settings: sections.map((section) => t(section.label)),
      wording: pageLabel('/settings/labels', current, open, sections, translate),
    });
    const onSuitePage = pathname === '/' || pathname.startsWith('/settings');
    const starters = (onSuitePage ? STARTERS.suite : STARTERS[app.id]).map((key) => t(key));
    return { system, place, starters, ready: known };
  }, [
    access,
    app,
    apps,
    approvals,
    costing.available,
    extras,
    finder,
    language,
    pathname,
    payrollApprovals,
    role,
    known,
    taxesOn,
  ]);
}
