import {
  CalendarDays,
  ClipboardCheck,
  Coins,
  Contact,
  HandCoins,
  House,
  IdCard,
  LayoutDashboard,
  Mails,
  PiggyBank,
  Settings,
  SlidersHorizontal,
  Tags,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { CREATE_ACTIONS as A } from '@/features/shell/create';
import { msg } from '@/i18n';
import type { SuiteApp } from '@/suite/types';

/**
 * Maham People: HR. Employees and their papers, payroll and PIFSS, leave,
 * staff loans and end-of-service settlements, letters, and a directory. Payroll and
 * people data are private: only owners, admins and accountants open the app,
 * and the server never sends that data to anyone else.
 */
export const PEOPLE: SuiteApp = {
  id: 'people',
  name: 'Maham People',
  nameAr: 'مهام بيبول',
  description: msg('Employees, payroll, leave and staff loans.'),
  icon: UsersRound,
  tone: 'emerald',
  home: '/people',
  owns: ['people', 'employees', 'payroll'],
  nav: [
    { kind: 'link', to: '/', label: msg('Home'), icon: House, end: true },
    {
      kind: 'link',
      to: '/people',
      label: msg('Overview'),
      icon: LayoutDashboard,
      end: true,
      keywords: 'hr team today',
    },
    {
      kind: 'link',
      to: '/people/directory',
      label: msg('Directory'),
      icon: Contact,
      keywords: 'phone email contacts staff',
    },
    { kind: 'link', to: '/employees', label: msg('Employees'), icon: IdCard, keywords: 'staff' },
    {
      kind: 'link',
      to: '/payroll',
      label: msg('Payroll'),
      icon: WalletCards,
      keywords: 'pay runs salaries pifss',
    },
    {
      kind: 'link',
      to: '/payroll/leave',
      label: msg('Leave'),
      icon: CalendarDays,
      keywords: 'vacation annual sick',
    },
    {
      kind: 'link',
      to: '/payroll/leave-reasons',
      label: msg('Leave reasons'),
      icon: Tags,
      keywords: 'emergency compensatory unpaid half pay',
    },
    {
      kind: 'link',
      to: '/payroll/loans',
      label: msg('Staff loans'),
      icon: HandCoins,
      keywords: 'advance',
    },
    {
      kind: 'link',
      to: '/people/letters',
      label: msg('Letters'),
      icon: Mails,
      keywords: 'salary certificate experience employment warning noc letter templates',
    },
    {
      kind: 'link',
      to: '/payroll/settings',
      label: msg('Payroll settings'),
      icon: SlidersHorizontal,
    },
    {
      kind: 'link',
      to: '/approvals',
      label: msg('Approvals'),
      icon: ClipboardCheck,
      keywords: 'salary approval pay run requests',
      payrollApprovalsOnly: true,
    },
  ],
  footer: [{ to: '/settings', label: msg('Settings'), icon: Settings }],
  create: [{ label: msg('People'), actions: [A.employee, A.letter] }],
  tools: [
    { to: '/people/directory', label: msg('Directory'), icon: Contact, keywords: 'phone email' },
    { to: '/employees', label: msg('Employees'), icon: IdCard, keywords: 'staff' },
    { to: '/payroll', label: msg('Payroll'), icon: Coins, keywords: 'salaries pifss' },
    { to: '/payroll/leave', label: msg('Leave'), icon: CalendarDays, keywords: 'vacation' },
    { to: '/payroll/loans', label: msg('Staff loans'), icon: PiggyBank, keywords: 'advance' },
  ],
  tabs: [
    { to: '/', label: msg('Home'), icon: House, end: true },
    { to: '/employees', label: msg('Employees'), icon: IdCard },
    { to: '/payroll', label: msg('Payroll'), icon: WalletCards },
  ],
  access: {
    device: 'manage',
    owner: 'manage',
    admin: 'manage',
    accountant: 'manage',
    staff: 'none',
    viewer: 'none',
  },
};
