import type { LucideIcon } from 'lucide-react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Armchair,
  ClipboardList,
  FileClock,
  FileMinus,
  FileText,
  IdCard,
  NotebookPen,
  Package,
  PackageCheck,
  PackagePlus,
  Receipt,
  ReceiptText,
  Repeat,
  ScrollText,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import { msg } from '@/i18n';

/** Something that can be created from the New menu, the phone's + sheet or the palette. */
export interface CreateAction {
  id: string;
  /** Menu label, e.g. "Invoice". */
  label: string;
  /** Palette label, e.g. "New invoice". */
  command: string;
  to: string;
  icon: LucideIcon;
  keywords?: string;
}

export interface CreateGroup {
  label: string;
  actions: CreateAction[];
}

export const CREATE_GROUPS: CreateGroup[] = [
  {
    label: msg('Sales'),
    actions: [
      {
        id: 'invoice',
        label: msg('Invoice'),
        command: msg('New invoice'),
        to: '/invoices/new',
        icon: FileText,
      },
      {
        id: 'quote',
        label: msg('Quote'),
        command: msg('New quote'),
        to: '/quotes/new',
        icon: ScrollText,
        keywords: 'estimate',
      },
      {
        id: 'proforma',
        label: msg('Proforma invoice'),
        command: msg('New proforma invoice'),
        to: '/proformas/new',
        icon: FileClock,
      },
      {
        id: 'sales_order',
        label: msg('Sales order'),
        command: msg('New sales order'),
        to: '/sales-orders/new',
        icon: ClipboardList,
      },
      {
        id: 'delivery_note',
        label: msg('Delivery note'),
        command: msg('New delivery note'),
        to: '/delivery-notes/new',
        icon: PackageCheck,
      },
      {
        id: 'credit',
        label: msg('Credit note'),
        command: msg('New credit note'),
        to: '/credits/new',
        icon: FileMinus,
      },
      {
        id: 'recurring',
        label: msg('Recurring invoice'),
        command: msg('New recurring invoice'),
        to: '/recurring/new',
        icon: Repeat,
      },
      {
        id: 'payment_in',
        label: msg('Payment received'),
        command: msg('Record payment received'),
        to: '/payments/new',
        icon: ArrowDownLeft,
        keywords: 'receipt cheque knet',
      },
    ],
  },
  {
    label: msg('Purchases'),
    actions: [
      {
        id: 'bill',
        label: msg('Bill'),
        command: msg('New bill'),
        to: '/bills/new',
        icon: Receipt,
      },
      {
        id: 'expense',
        label: msg('Expense'),
        command: msg('Record expense'),
        to: '/expenses?new=1',
        icon: Wallet,
      },
      {
        id: 'purchase_order',
        label: msg('Purchase order'),
        command: msg('New purchase order'),
        to: '/purchase-orders/new',
        icon: ShoppingCart,
        keywords: 'lpo',
      },
      {
        id: 'payment_out',
        label: msg('Payment made'),
        command: msg('Record payment made'),
        to: '/payments-made/new',
        icon: ArrowUpRight,
      },
      {
        id: 'vendor_credit',
        label: msg('Vendor credit'),
        command: msg('New vendor credit'),
        to: '/vendor-credits/new',
        icon: ReceiptText,
      },
    ],
  },
  {
    label: msg('Contacts and items'),
    actions: [
      {
        id: 'client',
        label: msg('Client'),
        command: msg('New client'),
        to: '/clients/new',
        icon: Users,
        keywords: 'customer',
      },
      {
        id: 'vendor',
        label: msg('Vendor'),
        command: msg('New vendor'),
        to: '/vendors/new',
        icon: Truck,
        keywords: 'supplier',
      },
      {
        id: 'product',
        label: msg('Product or service'),
        command: msg('New product or service'),
        to: '/products?new=1',
        icon: Package,
        keywords: 'item',
      },
      {
        id: 'employee',
        label: msg('Employee'),
        command: msg('New employee'),
        to: '/employees/new',
        icon: IdCard,
      },
    ],
  },
  {
    label: msg('Accounting'),
    actions: [
      {
        id: 'journal',
        label: msg('Manual journal'),
        command: msg('New manual journal'),
        to: '/journals/new',
        icon: NotebookPen,
      },
      {
        id: 'asset',
        label: msg('Fixed asset'),
        command: msg('New fixed asset'),
        to: '/assets/new',
        icon: Armchair,
      },
      {
        id: 'stock_adjustment',
        label: msg('Stock adjustment'),
        command: msg('New stock adjustment'),
        to: '/inventory/adjustments/new',
        icon: PackagePlus,
      },
    ],
  },
];
