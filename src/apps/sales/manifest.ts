import {
  ArrowDownLeft,
  ClipboardCheck,
  ClipboardList,
  FileClock,
  FileMinus,
  FileText,
  House,
  Package,
  Palette,
  Repeat,
  ScrollText,
  Settings,
  ShoppingBag,
  Truck,
  Users,
} from 'lucide-react';
import { CREATE_ACTIONS as A } from '@/features/shell/create';
import { msg } from '@/i18n';
import type { SuiteApp } from '@/suite/types';

/**
 * Maham Sales (مهام سيلز), in the split layout only (Company.appLayout):
 * customers, quotes, proformas, sales orders, invoices, delivery notes,
 * payments received, credit notes and recurring invoices, taken out of
 * Maham Books. The pages are Books' own, at the addresses they have always
 * had; Maham Books (finance) still lists invoices, payments received and
 * credit notes under Receivables. Who opens it, and the owner's limits on
 * it, are Books' (src/suite/apps.ts).
 */
export const SALES: SuiteApp = {
  id: 'sales',
  name: 'Maham Sales',
  nameAr: 'مهام سيلز',
  description: msg('Quotes, orders, invoices, payments received and customers.'),
  icon: ShoppingBag,
  tone: 'violet',
  home: '/invoices',
  owns: [
    'quotes',
    'proformas',
    'sales-orders',
    'invoices',
    'delivery-notes',
    'credits',
    'recurring',
    'payments',
    'clients',
  ],
  // The items it sells, and the design of its quotes and invoices.
  shares: ['products', 'templates'],
  nav: [
    { kind: 'link', to: '/', label: msg('Home'), icon: House, end: true },
    { kind: 'link', to: '/clients', label: msg('Clients'), icon: Users, keywords: 'customers' },
    { kind: 'link', to: '/quotes', label: msg('Quotes'), icon: ScrollText, keywords: 'estimates' },
    { kind: 'link', to: '/proformas', label: msg('Proforma invoices'), icon: FileClock },
    {
      kind: 'link',
      to: '/sales-orders',
      label: msg('Sales orders'),
      icon: ClipboardList,
      keywords: 'orders',
    },
    { kind: 'link', to: '/invoices', label: msg('Invoices'), icon: FileText },
    { kind: 'link', to: '/delivery-notes', label: msg('Delivery notes'), icon: Truck },
    {
      kind: 'link',
      to: '/payments',
      label: msg('Payments received'),
      icon: ArrowDownLeft,
      keywords: 'receipts',
    },
    { kind: 'link', to: '/credits', label: msg('Credit notes'), icon: FileMinus },
    { kind: 'link', to: '/recurring', label: msg('Recurring invoices'), icon: Repeat },
    {
      kind: 'link',
      to: '/products',
      label: msg('Products & services'),
      icon: Package,
      keywords: 'items prices',
    },
    {
      kind: 'link',
      to: '/approvals',
      label: msg('Approvals'),
      icon: ClipboardCheck,
      keywords: 'approval requests void',
      approvalsOnly: true,
    },
  ],
  footer: [
    { to: '/templates', label: msg('Templates'), icon: Palette },
    { to: '/settings', label: msg('Settings'), icon: Settings },
  ],
  create: [
    {
      label: msg('Sales'),
      column: 0,
      actions: [
        A.invoice,
        A.quote,
        A.proforma,
        A.sales_order,
        A.delivery_note,
        A.credit,
        A.recurring,
        A.payment_in,
        A.client,
      ],
    },
  ],
  tools: [
    { to: '/invoices', label: msg('Invoices'), icon: FileText, keywords: 'sales bill customer' },
    { to: '/quotes', label: msg('Quotes'), icon: ScrollText, keywords: 'estimates' },
    { to: '/clients', label: msg('Clients'), icon: Users, keywords: 'customers' },
    {
      to: '/payments',
      label: msg('Payments received'),
      icon: ArrowDownLeft,
      keywords: 'receipts',
    },
    { to: '/sales-orders', label: msg('Sales orders'), icon: ClipboardList, keywords: 'orders' },
    { to: '/delivery-notes', label: msg('Delivery notes'), icon: Truck },
    { to: '/credits', label: msg('Credit notes'), icon: FileMinus },
  ],
  tabs: [
    { to: '/', label: msg('Home'), icon: House, end: true },
    { to: '/invoices', label: msg('Invoices'), icon: FileText },
    { to: '/quotes', label: msg('Quotes'), icon: ScrollText },
  ],
  // Books' own: these are Books' pages and records.
  access: {
    device: 'manage',
    owner: 'manage',
    admin: 'manage',
    accountant: 'manage',
    staff: 'edit',
    viewer: 'view',
  },
};
