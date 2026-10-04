import { db } from './db';
import { logActivity } from './activity';
import {
  assertUnlocked,
  createJournal,
  loadLedger,
  newJournalLine,
  roleMap,
  saveJournal,
} from './accounting';
import { accountingSettings, vatSettings } from './chart-setup';
import { nowStamp } from './defaults';
import type { Company, ID, ISODate, JournalLine, VatReturnRecord } from './types';
import {
  vatAccountTotals,
  vatReturn,
  type EmirateCode,
  type VatPeriod,
  type VatReturnResult,
} from '@/lib/accounting/vat';
import { addDaysISO } from '@/lib/dates';
import { formatMoney } from '@/lib/format';
import { newId } from '@/lib/ids';
import { currencyPrecision, fromMinor } from '@/lib/money';
import { msg, t } from '@/i18n';

export class VatError extends Error {}

/** Every table the ledger reads, plus what filing writes. */
const FILING_TABLES = () => [
  db.vatReturns,
  db.journals,
  db.companies,
  db.accounts,
  db.activities,
  db.documents,
  db.payments,
  db.expenses,
  db.products,
  db.clients,
];

/** The return for a period, worked out from the books as they are now. */
export async function computeVatReturn(
  company: Company,
  period: VatPeriod,
): Promise<VatReturnResult> {
  const { accounts, lines } = await loadLedger(company);
  const settings = vatSettings(company);
  return vatReturn(lines, period, settings.format, {
    roles: roleMap(accounts),
    precision: currencyPrecision(company.currency),
    emirate: (settings.emirate ?? undefined) as EmirateCode | undefined,
  });
}

/** The period's first and last day, for messages. */
function periodVars(period: VatPeriod) {
  return { start: period.start, end: period.end };
}

/**
 * Files a return: keeps the boxes as filed, moves the period's output and
 * input VAT to the VAT liability account (the amount owed to, or due from,
 * the tax office) and, when asked, locks the period.
 */
export async function fileVatReturn(
  companyId: ID,
  period: VatPeriod,
  options: { filedOn: ISODate; reference: string; lock: boolean },
): Promise<VatReturnRecord> {
  return db.transaction('rw', FILING_TABLES(), async () => {
    const company = await db.companies.get(companyId);
    if (!company) throw new Error(t('Company not found'));
    const filed = await db.vatReturns
      .where('[companyId+periodStart]')
      .equals([company.id, period.start])
      .first();
    if (filed) throw new VatError(t('This period has already been filed.'));

    const { accounts, lines } = await loadLedger(company);
    const roles = roleMap(accounts);
    const settings = vatSettings(company);
    const precision = currencyPrecision(company.currency);
    const result = vatReturn(lines, period, settings.format, {
      roles,
      precision,
      emirate: (settings.emirate ?? undefined) as EmirateCode | undefined,
    });
    const { output, input } = vatAccountTotals(lines, period, roles);
    if (!roles.output_tax || !roles.input_tax || !roles.tax_settlement) {
      throw new VatError(t('The chart of accounts has no VAT accounts set up.'));
    }

    const id = newId();
    const entry = (accountId: ID, minor: number, description: string): JournalLine =>
      newJournalLine({
        accountId,
        description,
        debit: minor > 0 ? fromMinor(minor, precision) : 0,
        credit: minor < 0 ? fromMinor(-minor, precision) : 0,
      });
    const journalLines = [
      entry(roles.output_tax, output, t('VAT on sales')),
      entry(roles.input_tax, -input, t('VAT on purchases')),
      entry(roles.tax_settlement, input - output, t('VAT for the period')),
    ].filter((l) => l.debit !== 0 || l.credit !== 0);

    let journalId: ID | null = null;
    if (journalLines.length >= 2) {
      // Dated at the end of the period, unless that is already locked.
      const lockDate = accountingSettings(company).lockDate;
      const date = lockDate && lockDate >= period.end ? addDaysISO(lockDate, 1) : period.end;
      const journal = await saveJournal(
        createJournal(company.id, {
          date,
          reference: t('VAT return {start} to {end}', periodVars(period)),
          notes: options.reference
            ? t('Reference {reference}', { reference: options.reference })
            : '',
          status: 'posted',
          vatReturnId: id,
          lines: journalLines,
        }),
      );
      journalId = journal.id;
    }

    const stamp = nowStamp();
    const record: VatReturnRecord = {
      id,
      companyId: company.id,
      periodStart: period.start,
      periodEnd: period.end,
      format: settings.format,
      boxes: result.boxes.map(({ id: boxId, label, amount, vat }) => ({
        id: boxId,
        label,
        amount,
        ...(vat !== undefined ? { vat } : {}),
      })),
      net: result.net,
      currency: company.currency,
      filedOn: options.filedOn,
      reference: options.reference.trim(),
      journalId,
      paymentJournalId: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
    await db.vatReturns.add(record);

    if (options.lock) {
      // Read again: saving the journal moved the company's number counter.
      const current = (await db.companies.get(company.id))!;
      const settingsNow = accountingSettings(current);
      if (!settingsNow.lockDate || settingsNow.lockDate < period.end) {
        await db.companies.put({
          ...current,
          accounting: { ...settingsNow, lockDate: period.end },
          updatedAt: stamp,
        });
      }
    }
    await logActivity(company.id, 'vat_return', id, 'filed', {
      text:
        result.net >= 0
          ? msg('VAT return {start} to {end} filed: {amount} to pay')
          : msg('VAT return {start} to {end} filed: {amount} to reclaim'),
      vars: {
        ...periodVars(period),
        amount: formatMoney(
          fromMinor(Math.abs(result.net), precision),
          company.currency,
          company.locale,
        ),
      },
      money: {
        amount: { amount: fromMinor(Math.abs(result.net), precision), currency: company.currency },
      },
    });
    return record;
  });
}

/** Takes a filing back: removes the record and its entries. The period must be unlocked. */
export async function undoVatReturn(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.vatReturns, db.journals, db.companies, db.activities],
    async () => {
      const record = await db.vatReturns.get(id);
      if (!record) return;
      const company = await db.companies.get(record.companyId);
      if (!company) return;
      const journals = (
        await db.journals.bulkGet(
          [record.journalId, record.paymentJournalId].filter((x): x is ID => Boolean(x)),
        )
      ).filter((j) => j !== undefined);
      try {
        assertUnlocked(company, record.periodEnd, ...journals.map((j) => j.date));
      } catch {
        throw new VatError(
          t(
            'This period is locked. Remove or move the lock date (Settings → Accounting) to undo the return.',
          ),
        );
      }
      await db.journals.bulkDelete(journals.map((j) => j.id));
      await db.vatReturns.delete(id);
      await logActivity(record.companyId, 'vat_return', id, 'deleted', {
        text: msg('VAT return {start} to {end} undone'),
        vars: { start: record.periodStart, end: record.periodEnd },
      });
    },
  );
}

/** Records paying the VAT (or receiving the refund), clearing the VAT liability. */
export async function recordVatPayment(
  id: ID,
  options: { date: ISODate; accountId: ID },
): Promise<VatReturnRecord> {
  return db.transaction(
    'rw',
    [db.vatReturns, db.journals, db.companies, db.accounts, db.activities],
    async () => {
      const record = await db.vatReturns.get(id);
      if (!record) throw new VatError(t('Return not found.'));
      if (record.paymentJournalId && (await db.journals.get(record.paymentJournalId))) {
        throw new VatError(t('The payment for this return is already recorded.'));
      }
      const accounts = await db.accounts.where('companyId').equals(record.companyId).toArray();
      const settlement = roleMap(accounts).tax_settlement;
      if (!settlement) {
        throw new VatError(t('The chart of accounts has no VAT liability account.'));
      }
      const precision = currencyPrecision(record.currency);
      const amount = fromMinor(Math.abs(record.net), precision);
      if (amount === 0) throw new VatError(t('There is nothing to pay for this return.'));
      const pay = record.net > 0;
      const vars = { start: record.periodStart, end: record.periodEnd };
      const journal = await saveJournal(
        createJournal(record.companyId, {
          date: options.date,
          reference: pay
            ? t('VAT payment {start} to {end}', vars)
            : t('VAT refund {start} to {end}', vars),
          status: 'posted',
          lines: [
            newJournalLine({
              accountId: settlement,
              debit: pay ? amount : 0,
              credit: pay ? 0 : amount,
            }),
            newJournalLine({
              accountId: options.accountId,
              debit: pay ? 0 : amount,
              credit: pay ? amount : 0,
            }),
          ],
        }),
      );
      const updated = { ...record, paymentJournalId: journal.id, updatedAt: nowStamp() };
      await db.vatReturns.put(updated);
      return updated;
    },
  );
}
