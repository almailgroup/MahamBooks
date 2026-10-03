import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createAccount, loadLedger } from './accounting';
import { setupCompany } from './records';
import {
  commitImport,
  ImportError,
  loadImportContext,
  planImport,
  type ImportOptions,
} from './import';
import type { Company } from './types';
import { guessColumns, type ImportKind } from '@/features/company/import-columns';
import { parseCsvRows } from '@/lib/banking/statement';
import { trialBalance } from '@/lib/accounting/statements';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const OPTIONS: ImportOptions = {
  contactType: 'customer',
  documentType: 'invoice',
  asOf: '2026-09-30',
  dateFormat: 'dd/MM/yyyy',
  fileName: 'old-books.csv',
};

async function kuwaitCompany(): Promise<Company> {
  return setupCompany({ name: 'Al Mail Trading', nameAr: 'شركة الميل للتجارة' });
}

/** Parses the CSV, guesses the columns and plans the import. */
async function plan(company: Company, kind: ImportKind, csv: string, options = OPTIONS) {
  const rows = parseCsvRows(csv);
  const mapping = guessColumns(kind, rows[0]);
  const result = planImport(kind, rows, mapping, options, await loadImportContext(company.id));
  return { rows, mapping, result };
}

async function run(company: Company, kind: ImportKind, csv: string, options = OPTIONS) {
  const rows = parseCsvRows(csv);
  return commitImport(company.id, kind, rows, guessColumns(kind, rows[0]), options);
}

/** Balance per account code in minor units (fils): debit positive, credit negative. */
async function balances(company: Company) {
  const fresh = (await db.companies.get(company.id))!;
  const { accounts, lines, problems } = await loadLedger(fresh);
  expect(problems).toEqual([]);
  const byCode = new Map<string, number>();
  const codes = new Map(accounts.map((a) => [a.id, a.code]));
  for (const l of lines) {
    const code = codes.get(l.accountId)!;
    byCode.set(code, (byCode.get(code) ?? 0) + l.amount);
  }
  const tb = trialBalance(lines, accounts, '2026-12-31', { month: 12, day: 31 });
  expect(tb.totalDebit).toBe(tb.totalCredit);
  expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
  return byCode;
}

describe('column guesses', () => {
  it('reads English and Arabic column names, with a BOM and any spacing', () => {
    const rows = parseCsvRows(
      '﻿الاسم,الاسم بالعربية,البريد الإلكتروني,رقم الهاتف,المحافظة,المنطقة,الرصيد الافتتاحي\n' +
        'Al Noor,النور,a@b.co,22223333,حولي,السالمية,10.500\n',
    );
    expect(rows[0][0]).toBe('الاسم');
    const mapping = guessColumns('contacts', rows[0]);
    expect(mapping).toMatchObject({
      name: 0,
      nameAr: 1,
      email: 2,
      phone: 3,
      governorate: 4,
      area: 5,
      openingBalance: 6,
    });
  });

  it('prefers exact and longer names', () => {
    const mapping = guessColumns('contacts', [
      'Customer Name',
      'Customer Arabic Name',
      'Contact Person',
      'E-mail',
      'Mobile',
    ]);
    expect(mapping).toMatchObject({ name: 0, nameAr: 1, contactPerson: 2, email: 3, phone: 4 });
    expect(guessColumns('opening', ['Account Code', 'Account', 'Dr', 'Cr'])).toMatchObject({
      code: 0,
      account: 1,
      debit: 2,
      credit: 3,
    });
    expect(
      guessColumns('documents', ['رقم الفاتورة', 'العميل', 'التاريخ', 'تاريخ الاستحقاق', 'المبلغ']),
    ).toMatchObject({ number: 0, contact: 1, date: 2, dueDate: 3, amount: 4 });
  });
});

describe('importing customers and vendors', () => {
  it('normalises Kuwaiti details, skips duplicates and books opening balances', async () => {
    const company = await kuwaitCompany();
    const csv = [
      'Type,Name,Arabic name,Email,Phone,Civil ID,CR No.,Governorate,Area,Block,Opening balance',
      'customer,Al Noor Trading,شركة النور,accounts@alnoor.example,22223333,,4455,حولي,السالمية,10,"1,250.750"',
      'customer,Salmiya Dental,عيادة السالمية,bad-email,12345,123,,,,,-20.250',
      'vendor,Gulf Office Supplies,مستلزمات الخليج,,٦٥٥٥١٢٣٤,,,Capital,Shuwaikh Industrial,,320.500',
      'customer,al noor trading,,,,,,,,,5',
      ',,,,,,,,,,',
      'customer,,,,,,,,,,1',
      'customer,Bad Amount,,,,,,,,,12.3456',
    ].join('\n');
    const { result } = await plan(company, 'contacts', csv);
    expect(result.rows.map((r) => r.status)).toEqual([
      'ready',
      'ready',
      'ready',
      'skipped',
      'error',
      'error',
    ]);
    expect(result).toMatchObject({ ready: 3, skipped: 1, errors: 2 });
    const dental = result.rows[1].issues.map((i) => i.text);
    expect(dental).toContain('The email address looks wrong.');
    expect(dental).toContain('Phone number kept as written.');
    expect(dental).toContain('The Civil ID looks wrong.');
    expect(result.rows[5].issues[0].text).toBe('Amounts in KWD have at most 3 decimals.');

    const done = await run(company, 'contacts', csv);
    expect(done).toMatchObject({ added: 3, skipped: 3, documents: 3 });

    const clients = await db.clients.where('companyId').equals(company.id).sortBy('number');
    expect(clients.map((c) => [c.number, c.name, c.isCustomer, c.isVendor])).toEqual([
      ['C-0001', 'Al Noor Trading', true, false],
      ['C-0002', 'Salmiya Dental', true, false],
      ['C-0003', 'Gulf Office Supplies', false, true],
    ]);
    const [noor, , gulf] = clients;
    expect(noor.nameAr).toBe('شركة النور');
    expect(noor.phone).toBe('+965 2222 3333');
    expect(noor.address).toMatchObject({
      country: 'KW',
      state: 'Hawalli',
      city: 'Salmiya',
      block: '10',
    });
    expect(noor.notes).toBe('CR No.: 4455');
    expect(noor.contacts[0]).toMatchObject({ email: 'accounts@alnoor.example', primary: true });
    expect(gulf.phone).toBe('+965 6555 1234');
    expect(gulf.address).toMatchObject({ state: 'Capital', city: 'Shuwaikh Industrial' });
    const fresh = (await db.companies.get(company.id))!;
    expect(fresh.numbering.client.next).toBe(4);

    // Each balance is an issued document booked against opening balance equity.
    const docs = await db.documents.where('companyId').equals(company.id).sortBy('number');
    expect(docs.map((d) => [d.type, d.number, d.status, d.issueDate, d.totals.balance])).toEqual([
      ['invoice', 'OB-C-0001', 'sent', '2026-09-30', 1250.75],
      ['credit', 'OB-C-0002', 'sent', '2026-09-30', 20.25],
      ['bill', 'OB-C-0003', 'sent', '2026-09-30', 320.5],
    ]);
    const byCode = await balances(company);
    expect(byCode.get('1100')).toBe(1_250_750 - 20_250); // receivable
    expect(byCode.get('2000')).toBe(-320_500); // payable
    expect(byCode.get('3900')).toBe(-1_250_750 + 20_250 + 320_500);
    expect(byCode.get('4000')).toBeUndefined(); // no sales counted twice
  });

  it('uses the type chosen for the file when there is no Type column', async () => {
    const company = await kuwaitCompany();
    await run(company, 'contacts', 'Name,Phone\nBoubyan Couriers,99887766', {
      ...OPTIONS,
      contactType: 'vendor',
    });
    const [client] = await db.clients.where('companyId').equals(company.id).toArray();
    expect(client).toMatchObject({ isCustomer: false, isVendor: true, phone: '+965 9988 7766' });
  });
});

describe('importing products', () => {
  it('adds items with Arabic names and fine prices, skipping known SKUs', async () => {
    const company = await kuwaitCompany();
    const csv = [
      'اسم الصنف,الاسم بالعربية,رمز الصنف,الوحدة,السعر,الوصف',
      'Office cleaning,تنظيف المكتب,SRV-1,month,85.000,Four visits',
      'Screws (each),براغي,SCR-1,pc,0.0375,',
      'Duplicate,,srv-1,,1,',
      'Negative,,,,-1,',
    ].join('\n');
    const result = await run(company, 'products', csv);
    expect(result).toMatchObject({ added: 2, skipped: 2 });
    const products = await db.products.where('companyId').equals(company.id).sortBy('sku');
    expect(products.map((p) => [p.sku, p.name, p.nameAr, p.unit, p.unitPrice])).toEqual([
      ['SCR-1', 'Screws (each)', 'براغي', 'pc', 0.0375],
      ['SRV-1', 'Office cleaning', 'تنظيف المكتب', 'month', 85],
    ]);
  });
});

describe('importing opening balances', () => {
  it('posts one balanced journal with the difference on opening balance equity', async () => {
    const company = await kuwaitCompany();
    const csv = [
      'Account code,Account,Debit,Credit',
      '1000,Bank,"15,250.500",',
      '1010,Petty cash,150.125,',
      '1500,Furniture,4200,',
      '2200,Accrued expenses,,310.375',
      '3000,Capital,,10000.000',
    ].join('\n');
    const { result } = await plan(company, 'opening', csv);
    expect(result.totals).toEqual({
      debit: 19_600_625,
      credit: 10_310_375,
      difference: 9_290_250,
    });
    const done = await run(company, 'opening', csv);
    expect(done.journalNumber).toMatch(/^JE-2026-0001$/);
    const [journal] = await db.journals.where('companyId').equals(company.id).toArray();
    expect(journal).toMatchObject({ date: '2026-09-30', status: 'posted' });
    expect(journal.lines).toHaveLength(6);
    const fresh = (await db.companies.get(company.id))!;
    expect(fresh.openingBalances).toEqual({ date: '2026-09-30', journalIds: [journal.id] });

    const byCode = await balances(company);
    expect(Object.fromEntries(byCode)).toEqual({
      '1000': 15_250_500,
      '1010': 150_125,
      '1500': 4_200_000,
      '2200': -310_375,
      '3000': -10_000_000,
      '3900': -9_290_250,
    });
  });

  it('reads a signed balance column and account names in Arabic', async () => {
    const company = await kuwaitCompany();
    await run(company, 'opening', 'اسم الحساب,الرصيد\nالعهدة النقدية,75.500\nرأس المال,-75.500');
    const byCode = await balances(company);
    expect(Object.fromEntries(byCode)).toEqual({ '1010': 75_500, '3000': -75_500 });
  });

  it('refuses the whole file when a row is wrong, and receivables or payables', async () => {
    const company = await kuwaitCompany();
    const csv = [
      'Code,Debit,Credit',
      '1000,100,',
      '9999,,5',
      '1100,50,',
      '2000,,50',
      '1010,1,1',
      '1020,,',
    ].join('\n');
    const { result } = await plan(company, 'opening', csv);
    expect(result.rows.map((r) => [r.status, r.issues[0]?.text])).toEqual([
      ['ready', undefined],
      ['error', 'No account has the code 9999.'],
      ['error', 'Receivables come from open invoices. Import them as open invoices instead.'],
      ['error', 'Payables come from open bills. Import them as open bills instead.'],
      ['error', 'Give a debit or a credit on each row, not both.'],
      ['skipped', 'No amount.'],
    ]);
    await expect(run(company, 'opening', csv)).rejects.toBeInstanceOf(ImportError);
    expect(await db.journals.count()).toBe(0);
  });

  it('respects the lock date', async () => {
    const company = await kuwaitCompany();
    await db.companies.update(company.id, {
      accounting: { ...company.accounting!, lockDate: '2026-09-30' },
    });
    const { result } = await plan(company, 'opening', 'Code,Debit\n1000,10');
    expect(result.errors).toBe(1);
    expect(result.rows[0].issues[0].text).toMatch(/lock date/);
  });

  it('adds an opening balance equity account when the chart has none', async () => {
    const company = await kuwaitCompany();
    const equity = (await db.accounts.where('companyId').equals(company.id).toArray()).find(
      (a) => a.role === 'opening_balance',
    )!;
    await db.accounts.delete(equity.id);
    await db.accounts.add(
      createAccount(company.id, { code: '3900', name: 'Taken', type: 'equity' }),
    );
    await run(company, 'opening', 'Code,Debit\n1000,10');
    const added = (await db.accounts.where('companyId').equals(company.id).toArray()).find(
      (a) => a.role === 'opening_balance',
    )!;
    expect(added).toMatchObject({ code: '3901', nameAr: 'أرصدة افتتاحية', type: 'equity' });
    const byCode = await balances(company);
    expect(byCode.get('3901')).toBe(-10_000);
  });
});

describe('importing open invoices and bills', () => {
  it('creates issued invoices that keep receivables right per customer', async () => {
    const company = await kuwaitCompany();
    await run(company, 'contacts', 'Name,Arabic name\nAl Noor Trading,شركة النور');
    const csv = [
      'Invoice number,Customer,Date,Due date,Amount due,Reference',
      'INV-1001,Al Noor Trading,15/08/2026,14/09/2026,1250.750,PO-77',
      'INV-1002,شركة النور,02/09/2026,,480,',
      'INV-1003,Salmiya Dental,٠٣/٠٩/٢٠٢٦,,99.999,',
      'INV-1004,Salmiya Dental,04/09/2026,,12.5,',
      'INV-1001,Someone,01/09/2026,,1,',
      'INV-1005,Someone,31/02/2026,,1,',
      'INV-1006,Someone,01/09/2026,01/08/2026,1,',
      'INV-1007,Someone,01/09/2026,,0,',
    ].join('\n');
    const { result } = await plan(company, 'documents', csv);
    expect(result.rows.map((r) => r.status)).toEqual([
      'ready',
      'ready',
      'ready',
      'ready',
      'skipped',
      'error',
      'error',
      'error',
    ]);
    expect(result.newContacts).toBe(1);
    expect(result.rows[2].issues[0]).toEqual({
      level: 'info',
      text: 'New customer Salmiya Dental will be added.',
    });

    const done = await run(company, 'documents', csv);
    expect(done).toMatchObject({ added: 4, newContacts: 1, documents: 4 });
    const docs = await db.documents.where('companyId').equals(company.id).sortBy('number');
    expect(
      docs.map((d) => [d.number, d.status, d.issueDate, d.dueDate, d.totals.balance, d.poNumber]),
    ).toEqual([
      ['INV-1001', 'sent', '2026-08-15', '2026-09-14', 1250.75, 'PO-77'],
      ['INV-1002', 'sent', '2026-09-02', '2026-10-02', 480, ''],
      ['INV-1003', 'sent', '2026-09-03', '2026-10-03', 99.999, ''],
      ['INV-1004', 'sent', '2026-09-04', '2026-10-04', 12.5, ''],
    ]);
    const clients = await db.clients.where('companyId').equals(company.id).sortBy('number');
    expect(clients.map((c) => c.name)).toEqual(['Al Noor Trading', 'Salmiya Dental']);
    expect(docs[0].clientId).toBe(clients[0].id);
    expect(docs[1].clientId).toBe(clients[0].id);
    expect(docs[2].clientId).toBe(clients[1].id);
    expect(docs[3].clientId).toBe(clients[1].id);
    expect(docs[0].items[0]).toMatchObject({ name: 'Opening balance', nameAr: 'رصيد افتتاحي' });

    const byCode = await balances(company);
    expect(byCode.get('1100')).toBe(1_843_249);
    expect(byCode.get('3900')).toBe(-1_843_249);
    expect(byCode.get('4000')).toBeUndefined();
  });

  it('creates open bills against payables and marks known contacts as vendors', async () => {
    const company = await kuwaitCompany();
    await run(company, 'contacts', 'Name\nAl Noor Trading');
    const csv = 'Bill number,Vendor,Date,Amount\nB-77,Al Noor Trading,2026-09-01,75.250';
    const options = {
      ...OPTIONS,
      documentType: 'bill' as const,
      dateFormat: 'yyyy-MM-dd' as const,
    };
    await run(company, 'documents', csv, options);
    const [bill] = await db.documents.where('companyId').equals(company.id).toArray();
    expect(bill).toMatchObject({ type: 'bill', number: 'B-77', status: 'sent' });
    expect(bill.totals.balance).toBe(75.25);
    const [contact] = await db.clients.where('companyId').equals(company.id).toArray();
    expect(contact).toMatchObject({ isVendor: true });
    const byCode = await balances(company);
    expect(byCode.get('2000')).toBe(-75_250);
    expect(byCode.get('3900')).toBe(75_250);
  });

  it('writes nothing when there is nothing ready', async () => {
    const company = await kuwaitCompany();
    await expect(
      run(company, 'documents', 'Number,Customer,Date,Amount\n,,,'),
    ).rejects.toBeInstanceOf(ImportError);
    expect(await db.documents.count()).toBe(0);
  });
});
