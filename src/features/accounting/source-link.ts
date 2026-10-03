import type { LedgerLine, LedgerSource } from '@/lib/accounting/ledger';
import { msg } from '@/i18n';

const SOURCE_ROUTES: Record<LedgerSource, string> = {
  invoice: '/invoices',
  credit: '/credits',
  bill: '/bills',
  vendor_credit: '/vendor-credits',
  payment: '/payments',
  expense: '/expenses',
  journal: '/journals',
};

/** Translate where shown: `t(SOURCE_LABELS[source])`. */
export const SOURCE_LABELS: Record<LedgerSource, string> = {
  invoice: msg('Invoice'),
  credit: msg('Credit note'),
  bill: msg('Bill'),
  vendor_credit: msg('Vendor credit'),
  payment: msg('Payment'),
  expense: msg('Expense'),
  journal: msg('Journal'),
};

/** Where the document behind a ledger line is shown. */
export function sourceLink(line: Pick<LedgerLine, 'source' | 'sourceId'>): string {
  // Expenses open in a dialog on their list; payments made redirect from /payments.
  if (line.source === 'expense') return `/expenses?open=${line.sourceId}`;
  return `${SOURCE_ROUTES[line.source]}/${line.sourceId}`;
}
