import { db } from './db';
import { logActivity } from './activity';
import { assertUnlocked } from './accounting';
import { defaultNumbering, nowStamp } from './defaults';
import { withoutImage } from './product-images';
import type { Attachment, Client, Expense, ID } from './types';
import { allocateNumber } from '@/lib/numbering';
import { newId } from '@/lib/ids';
import { today } from '@/lib/dates';
import { currencyPrecision, round } from '@/lib/money';
import { formatMoney } from '@/lib/format';
import { msg, t } from '@/i18n';

/** Older records have no role flags: they are clients. */
export function isCustomer(contact: Pick<Client, 'isCustomer'>): boolean {
  return contact.isCustomer !== false;
}

export function isVendor(contact: Pick<Client, 'isVendor'>): boolean {
  return contact.isVendor === true;
}

/* -------------------------------------------------------------------------- */
/* Expenses                                                                   */
/* -------------------------------------------------------------------------- */

export function createExpense(companyId: ID, overrides: Partial<Expense> = {}): Expense {
  const stamp = nowStamp();
  return {
    id: newId(),
    companyId,
    number: '',
    date: today(),
    vendorId: null,
    accountId: '',
    description: '',
    amount: 0,
    taxes: [],
    currency: '',
    paidFromAccountId: null,
    reference: '',
    notes: '',
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

export class ExpenseError extends Error {}

export async function saveExpense(input: Expense): Promise<Expense> {
  return db.transaction('rw', [db.expenses, db.companies, db.accounts, db.activities], async () => {
    const company = await db.companies.get(input.companyId);
    if (!company) throw new Error(t('Company not found'));
    const existing = await db.expenses.get(input.id);
    assertUnlocked(company, input.date, existing?.date);
    const currency = input.currency || company.currency;
    const amount = round(input.amount, currencyPrecision(currency));
    if (!(amount > 0)) throw new ExpenseError(t('Enter the amount paid.'));
    const account = input.accountId ? await db.accounts.get(input.accountId) : undefined;
    if (!account || account.companyId !== company.id) {
      throw new ExpenseError(t('Choose a category.'));
    }

    let expense: Expense = {
      ...input,
      currency,
      amount,
      number: input.number.trim(),
      updatedAt: nowStamp(),
    };
    // Who was paid, when it isn't a vendor: kept only when there is a name,
    // and never beside a vendor (the field is hidden then).
    const payee = input.payee?.trim();
    if (payee && !input.vendorId) expense.payee = payee;
    else delete expense.payee;
    if (!expense.number) {
      const rule = company.numbering.expense ?? defaultNumbering().expense;
      const taken = new Set(
        (await db.expenses.where('companyId').equals(company.id).toArray())
          .filter((e) => e.id !== expense.id)
          .map((e) => e.number.toLowerCase()),
      );
      const allocated = allocateNumber(rule, expense.date, (n) => taken.has(n.toLowerCase()));
      expense = { ...expense, number: allocated.number };
      await db.companies.put({
        ...company,
        numbering: { ...company.numbering, expense: allocated.rule },
      });
    }
    if (!existing) expense.createdAt = expense.updatedAt;
    await db.expenses.put(expense);
    await logActivity(company.id, 'expense', expense.id, existing ? 'updated' : 'created', {
      text: existing
        ? msg('Expense {number} of {amount} updated')
        : msg('Expense {number} of {amount} recorded'),
      vars: { number: expense.number, amount: formatMoney(amount, currency, company.locale) },
      money: { amount: { amount, currency } },
    });
    return expense;
  });
}

export async function deleteExpense(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.expenses, db.companies, db.attachments, db.activities],
    async () => {
      const expense = await db.expenses.get(id);
      if (!expense) return;
      const company = await db.companies.get(expense.companyId);
      if (company) assertUnlocked(company, expense.date);
      await db.attachments.where('ownerId').equals(id).delete();
      await db.expenses.delete(id);
      await logActivity(expense.companyId, 'expense', id, 'deleted', {
        text: msg('Expense {number} deleted'),
        vars: { number: expense.number },
      });
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Attachments                                                                */
/* -------------------------------------------------------------------------- */

export async function addAttachment(
  companyId: ID,
  ownerId: ID,
  file: { name: string; type: string; dataUrl: string },
): Promise<Attachment> {
  const attachment: Attachment = {
    id: newId(),
    companyId,
    ownerId,
    name: file.name,
    type: file.type,
    // Data URL length is a good-enough size estimate for display.
    size: Math.round((file.dataUrl.length * 3) / 4),
    dataUrl: file.dataUrl,
    createdAt: nowStamp(),
  };
  await db.attachments.add(attachment);
  return attachment;
}

/**
 * Removes a file. An employee's photo and an item's pictures are their
 * files: removing one removes the photo or picture too, so the employee or
 * item never points at a file that's gone.
 */
export async function removeAttachment(id: ID): Promise<void> {
  await db.transaction('rw', [db.attachments, db.employees, db.products], async () => {
    const attachment = await db.attachments.get(id);
    await db.attachments.delete(id);
    if (!attachment) return;
    const employee = await db.employees.get(attachment.ownerId);
    if (employee?.photoId === id) {
      await db.employees.put({ ...employee, photoId: null, updatedAt: nowStamp() });
    }
    const product = await db.products.get(attachment.ownerId);
    if (product?.imageIds?.includes(id)) await db.products.put(withoutImage(product, id));
  });
}
