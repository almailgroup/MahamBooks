import {
  CalendarClock,
  Car,
  FileSearch,
  FolderCheck,
  House,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { msg } from '@/i18n';
import type { SuiteApp } from '@/suite/types';

/**
 * Maham Compliance: the office's licences and papers and the statutory
 * calendar (PIFSS, MOCI filings, audited statements, tax), and with the
 * document finder every file the company keeps (Files). Everyone sees the
 * company's own licences and deadlines; employees' papers and files reach
 * only those who see People. Staff and viewers look but don't change.
 */
export const COMPLIANCE: SuiteApp = {
  id: 'compliance',
  name: 'Maham Compliance',
  nameAr: 'مهام الامتثال',
  description: msg('Licences, staff papers and statutory deadlines.'),
  icon: ShieldCheck,
  tone: 'amber',
  home: '/compliance',
  owns: ['compliance', 'files'],
  nav: [
    { kind: 'link', to: '/', label: msg('Home'), icon: House, end: true },
    {
      kind: 'link',
      to: '/compliance',
      label: msg('Calendar'),
      icon: CalendarClock,
      end: true,
      keywords: 'deadlines pifss moci renewals',
    },
    {
      kind: 'link',
      to: '/compliance/documents',
      label: msg('Documents'),
      icon: FolderCheck,
      keywords: 'licence residency passport expiring',
    },
    {
      kind: 'link',
      to: '/compliance/vehicles',
      label: msg('Vehicles'),
      icon: Car,
      keywords: 'cars plates registration insurance drivers',
      registerExtrasOnly: true,
    },
    {
      kind: 'link',
      to: '/files',
      label: msg('Files'),
      icon: FileSearch,
      keywords: 'find attachments receipts scans pdf papers personnel',
      fileFinderOnly: true,
    },
  ],
  footer: [{ to: '/settings', label: msg('Settings'), icon: Settings }],
  create: [],
  tools: [
    { to: '/compliance', label: msg('Calendar'), icon: CalendarClock, keywords: 'deadlines pifss' },
    {
      to: '/compliance/documents',
      label: msg('Documents'),
      icon: FolderCheck,
      keywords: 'licences residency passport',
    },
  ],
  tabs: [
    { to: '/', label: msg('Home'), icon: House, end: true },
    { to: '/compliance', label: msg('Calendar'), icon: CalendarClock, end: true },
    { to: '/compliance/documents', label: msg('Documents'), icon: FolderCheck },
  ],
  access: {
    device: 'manage',
    owner: 'manage',
    admin: 'manage',
    accountant: 'manage',
    staff: 'view',
    viewer: 'view',
  },
};
