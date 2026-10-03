import type { JournalKind, ManualJournal } from '@/db/types';
import type { StatusTone } from '@/lib/status';
import { msg } from '@/i18n';

/**
 * Journals the app makes itself. Those owned by another part of the app
 * (depreciation, fixed assets, year-end, cheques, payroll) can only be changed
 * there, so the journal editor shows them read only.
 */
export interface JournalKindInfo {
  label: string;
  tone: StatusTone;
  /** Where the entry is managed; the journal editor links there. */
  owner: string | null;
}

export const JOURNAL_KINDS: Record<JournalKind, JournalKindInfo> = {
  transfer: { label: msg('Transfer'), tone: 'violet', owner: null },
  cheque_clearing: { label: msg('Cheque clearing'), tone: 'blue', owner: msg('Payments') },
  cheque_return: { label: msg('Returned cheque'), tone: 'red', owner: msg('Payments') },
  payroll: { label: msg('Payroll'), tone: 'blue', owner: msg('Payroll') },
  depreciation: { label: msg('Depreciation'), tone: 'amber', owner: msg('Fixed assets') },
  asset_purchase: { label: msg('Asset purchase'), tone: 'amber', owner: msg('Fixed assets') },
  asset_opening: { label: msg('Asset opening balance'), tone: 'amber', owner: msg('Fixed assets') },
  asset_disposal: { label: msg('Asset disposal'), tone: 'amber', owner: msg('Fixed assets') },
  year_end: { label: msg('Year-end close'), tone: 'green', owner: msg('Year-end close') },
};

/**
 * Kinds written by the accounting and payroll modules; the database refuses
 * other changes to them.
 */
export const ACCOUNTING_OWNED_KINDS: JournalKind[] = [
  'payroll',
  'depreciation',
  'asset_purchase',
  'asset_opening',
  'asset_disposal',
  'year_end',
];

/** Information for a journal's kind, or null for an ordinary manual journal. */
export function journalKind(journal: Pick<ManualJournal, 'kind'>): JournalKindInfo | null {
  return journal.kind ? (JOURNAL_KINDS[journal.kind] ?? null) : null;
}

/** Whether the journal belongs to another part of the app and can't be edited by hand. */
export function isOwnedJournal(journal: Pick<ManualJournal, 'kind'>): boolean {
  return Boolean(journalKind(journal)?.owner);
}

/** Page where an owned journal is managed. */
export function journalOwnerLink(
  journal: Pick<ManualJournal, 'kind' | 'sourceId'> & { paymentId?: string | null },
): string | null {
  switch (journal.kind) {
    case 'depreciation':
      return '/assets?tab=runs';
    case 'asset_purchase':
    case 'asset_opening':
    case 'asset_disposal':
      return journal.sourceId ? `/assets/${journal.sourceId}` : '/assets';
    case 'year_end':
      return '/year-end';
    case 'cheque_clearing':
    case 'cheque_return': {
      const payment = journal.paymentId ?? journal.sourceId;
      return payment ? `/payments/${payment}` : '/payments';
    }
    case 'payroll':
      return '/payroll';
    default:
      return null;
  }
}
