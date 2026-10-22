import type { ReactNode } from 'react';
import {
  BellRing,
  BookOpen,
  Building2,
  ClipboardCheck,
  Cloud,
  UserRound,
  UsersRound,
  Database,
  FileCog,
  FileUp,
  Hash,
  Languages,
  Layers,
  Link2,
  Mail,
  Package,
  Palette,
  Percent,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { msg } from '@/i18n';

/**
 * The sections of Settings, in groups, as its menu lists them (each at
 * /settings/<path>). Labels are English keys (`t()` them). The AI
 * assistant's guide to the app names them too.
 */
export const SETTINGS_GROUPS: {
  title: string;
  items: { path: string; label: string; icon: ReactNode }[];
}[] = [
  {
    title: msg('Business'),
    items: [
      { path: 'company', label: msg('Company profile'), icon: <Building2 /> },
      { path: 'companies', label: msg('Companies'), icon: <Layers /> },
      { path: 'links', label: msg('Links'), icon: <Link2 /> },
      { path: 'compliance', label: msg('Compliance and files'), icon: <ShieldCheck /> },
    ],
  },
  {
    title: msg('Account and team'),
    items: [
      { path: 'account', label: msg('Your account'), icon: <UserRound /> },
      { path: 'alerts', label: msg('Email alerts'), icon: <BellRing /> },
      { path: 'team', label: msg('Team'), icon: <UsersRound /> },
      { path: 'approvals', label: msg('Approvals'), icon: <ClipboardCheck /> },
      { path: 'ai', label: msg('AI assistant'), icon: <Sparkles /> },
      { path: 'cloud', label: msg('Cloud and sync'), icon: <Cloud /> },
    ],
  },
  {
    title: msg('Documents'),
    items: [
      { path: 'documents', label: msg('Invoice defaults'), icon: <FileCog /> },
      { path: 'numbering', label: msg('Numbering'), icon: <Hash /> },
      { path: 'items', label: msg('Items and units'), icon: <Package /> },
      { path: 'emails', label: msg('Email templates'), icon: <Mail /> },
      { path: 'labels', label: msg('Language & wording'), icon: <Languages /> },
    ],
  },
  {
    title: msg('Money'),
    items: [
      { path: 'payments', label: msg('Payment details'), icon: <Wallet /> },
      { path: 'taxes', label: msg('Taxes'), icon: <Percent /> },
      { path: 'accounting', label: msg('Accounting'), icon: <BookOpen /> },
    ],
  },
  {
    title: msg('Data'),
    items: [
      { path: 'import', label: msg('Import data'), icon: <FileUp /> },
      { path: 'data', label: msg('Backup & data'), icon: <Database /> },
    ],
  },
  {
    title: msg('This device'),
    items: [{ path: 'appearance', label: msg('Appearance'), icon: <Palette /> }],
  },
];
