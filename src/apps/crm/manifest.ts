import {
  ClipboardList,
  Handshake,
  House,
  KanbanSquare,
  ScrollText,
  Settings,
  UserSearch,
  Users,
} from 'lucide-react';
import { CREATE_ACTIONS as A } from '@/features/shell/create';
import { msg } from '@/i18n';
import type { SuiteApp } from '@/suite/types';

/**
 * Maham CRM: the sales pipeline. Quotes by stage and the ones to follow up,
 * prospects (customers quoted but not yet sold to), and the customers and
 * quotes themselves, which are the Books records: a quote won in CRM is the
 * one invoiced in Books. Leads that are not customers yet come with the CRM
 * data release (see docs/maham-one.md).
 */
export const CRM: SuiteApp = {
  id: 'crm',
  name: 'Maham CRM',
  nameAr: 'مهام CRM',
  description: msg('Quotes pipeline, follow-ups and prospects.'),
  icon: Handshake,
  tone: 'sky',
  home: '/crm',
  owns: ['crm'],
  shares: ['clients', 'quotes', 'sales-orders'],
  nav: [
    { kind: 'link', to: '/', label: msg('Home'), icon: House, end: true },
    {
      kind: 'link',
      to: '/crm',
      label: msg('Pipeline'),
      icon: KanbanSquare,
      end: true,
      keywords: 'deals sales follow up',
    },
    {
      kind: 'link',
      to: '/crm/prospects',
      label: msg('Prospects'),
      icon: UserSearch,
      keywords: 'leads potential customers',
    },
    { kind: 'link', to: '/clients', label: msg('Customers'), icon: Users, keywords: 'clients' },
    { kind: 'link', to: '/quotes', label: msg('Quotes'), icon: ScrollText, keywords: 'estimates' },
    {
      kind: 'link',
      to: '/sales-orders',
      label: msg('Sales orders'),
      icon: ClipboardList,
      keywords: 'orders',
    },
  ],
  footer: [{ to: '/settings', label: msg('Settings'), icon: Settings }],
  create: [{ label: msg('Sales'), actions: [A.quote, A.client, A.sales_order] }],
  tools: [
    { to: '/crm', label: msg('Pipeline'), icon: KanbanSquare, keywords: 'deals follow up' },
    { to: '/crm/prospects', label: msg('Prospects'), icon: UserSearch, keywords: 'leads' },
    { to: '/clients', label: msg('Customers'), icon: Users, keywords: 'clients' },
    { to: '/quotes', label: msg('Quotes'), icon: ScrollText, keywords: 'estimates' },
    { to: '/sales-orders', label: msg('Sales orders'), icon: ClipboardList },
  ],
  tabs: [
    { to: '/', label: msg('Home'), icon: House, end: true },
    { to: '/crm', label: msg('Pipeline'), icon: KanbanSquare, end: true },
    { to: '/quotes', label: msg('Quotes'), icon: ScrollText },
  ],
  access: {
    device: 'manage',
    owner: 'manage',
    admin: 'manage',
    accountant: 'edit',
    staff: 'edit',
    viewer: 'view',
  },
  preview: true,
};
