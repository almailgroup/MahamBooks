import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient, createProduct } from './defaults';
import { deleteDocument, draftDocument, saveDocument, setDocumentStatus } from './documents';
import { saveClient, saveCompany, setupCompany } from './records';
import { loadLedger, LockedPeriodError } from './accounting';
import {
  assignItemCodes,
  deleteItem,
  InventoryError,
  recordStockEntry,
  saveItem,
  saveLandedCost,
  saveWarehouse,
  createWarehouse,
  voidLandedCost,
  voidStockEntry,
  rebuildStock,
  suggestItemCode,
} from './inventory';
import type { Client, Company, DocumentType, InvoiceDocument, Product } from './types';
import { stockLevels } from '@/lib/inventory/costing';
import { trialBalance } from '@/lib/accounting/statements';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

interface Books {
  company: Company;
  vendor: Client;
  customer: Client;
  item: Product;
}

async function books(): Promise<Books> {
  const company = await setupCompany({ name: 'Gulf Trading' });
  const vendor = await saveClient(
    createClient(company.id, { name: 'Shuwaikh Imports', isVendor: true, isCustomer: false }),
  );
  const customer = await saveClient(createClient(company.id, { name: 'Al Noor' }));
  const item = await saveItem(
    createProduct(company.id, {
      name: 'Printer paper',
      kind: 'stock',
      unit: 'box',
      unitPrice: 2.5,
    }),
  );
  return { company, vendor, customer, item };
}

type Line = { product?: Product; name?: string; quantity: number; price: number; id?: string };

async function issue(
  b: Books,
  type: DocumentType,
  date: string,
  lines: Line[],
  extra: Partial<InvoiceDocument> = {},
): Promise<InvoiceDocument> {
  const contact = type === 'bill' || type === 'vendor_credit' ? b.vendor : b.customer;
  const draft = await draftDocument(b.company, type, contact);
  return saveDocument({
    ...draft,
    issueDate: date,
    dueDate: null,
    status: 'sent',
    items: lines.map((l, i) => ({
      ...draft.items[0],
      id: l.id ?? `line-${i}`,
      productId: l.product?.id ?? null,
      name: l.product?.name ?? l.name ?? 'Charge',
      quantity: l.quantity,
      unitPrice: l.price,
    })),
    ...extra,
  });
}

/** Ledger balance of an account code, in fils (debit positive). */
async function balances(company: Company) {
  const fresh = (await db.companies.get(company.id))!;
  const { accounts, lines, problems } = await loadLedger(fresh);
  expect(problems).toEqual([]);
  const byCode = (code: string) => {
    const account = accounts.find((a) => a.code === code)!;
    return lines.filter((l) => l.accountId === account.id).reduce((s, l) => s + l.amount, 0);
  };
  const tb = trialBalance(lines, accounts, '2099-12-31', { month: 12, day: 31 });
  expect(tb.totalDebit).toBe(tb.totalCredit);
  expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
  return { byCode, lines, accounts };
}

async function stock(b: Books) {
  const movements = await db.stockMovements.where('companyId').equals(b.company.id).toArray();
  return { movements, level: stockLevels(movements, 3).get(b.item.id) };
}

describe('stock and cost of sales', () => {
  it('costs a sale at the weighted average and posts cost of sales', async () => {
    const b = await books();
    await issue(b, 'bill', '2026-10-01', [{ product: b.item, quantity: 10, price: 1.25 }]);
    await issue(b, 'bill', '2026-10-02', [{ product: b.item, quantity: 10, price: 1.5 }]);
    const invoice = await issue(b, 'invoice', '2026-10-03', [
      { product: b.item, quantity: 5, price: 2.5 },
    ]);

    const { level, movements } = await stock(b);
    expect(level?.quantity).toBe(15);
    expect(level?.value).toBe(20.625);
    expect(movements.find((m) => m.documentId === invoice.id)?.value).toBe(-6.875);

    const { byCode, lines } = await balances(b.company);
    expect(byCode('1200')).toBe(20625);
    expect(byCode('5000')).toBe(6875);
    expect(byCode('4000')).toBe(-12500);
    const cogs = lines.filter((l) => l.sourceId === invoice.id && l.amount === 6875);
    expect(cogs).toHaveLength(1);
    expect(cogs[0].description).toBe(`Cost of sales ${invoice.number}`);
  });

  it('re-costs a sale when a bill is entered back-dated', async () => {
    const b = await books();
    await issue(b, 'bill', '2026-10-01', [{ product: b.item, quantity: 10, price: 1 }]);
    const invoice = await issue(b, 'invoice', '2026-10-10', [
      { product: b.item, quantity: 5, price: 3 },
    ]);
    expect((await balances(b.company)).byCode('5000')).toBe(5000);
    await issue(b, 'bill', '2026-10-05', [{ product: b.item, quantity: 10, price: 2 }]);
    const sale = (await stock(b)).movements.find((m) => m.documentId === invoice.id);
    expect(sale?.value).toBe(-7.5);
    const { byCode } = await balances(b.company);
    expect(byCode('5000')).toBe(7500);
    expect(byCode('1200')).toBe(22500);
  });

  it('brings goods back on a credit note at the cost they left with', async () => {
    const b = await books();
    await issue(b, 'bill', '2026-10-01', [{ product: b.item, quantity: 10, price: 1 }]);
    const invoice = await issue(b, 'invoice', '2026-10-02', [
      { product: b.item, quantity: 4, price: 3 },
    ]);
    await issue(b, 'bill', '2026-10-03', [{ product: b.item, quantity: 10, price: 2 }]);
    await issue(b, 'credit', '2026-10-04', [{ product: b.item, quantity: 1, price: 3 }], {
      sourceId: invoice.id,
    });
    const { level } = await stock(b);
    expect(level?.quantity).toBe(17);
    // 6 × 1.000 + 10 × 2.000 + 1 back at 1.000
    expect(level?.value).toBe(27);
    const { byCode } = await balances(b.company);
    expect(byCode('5000')).toBe(3000);
    expect(byCode('1200')).toBe(27000);
  });

  it('keeps stock in step when a bill is edited, voided or deleted', async () => {
    const b = await books();
    const bill = await issue(b, 'bill', '2026-10-01', [
      { product: b.item, quantity: 10, price: 1.25 },
    ]);
    await issue(b, 'invoice', '2026-10-05', [{ product: b.item, quantity: 4, price: 3 }]);
    expect((await stock(b)).level?.quantity).toBe(6);

    await saveDocument({ ...bill, items: [{ ...bill.items[0], quantity: 8, unitPrice: 1.5 }] });
    let level = (await stock(b)).level;
    expect(level?.quantity).toBe(4);
    expect(level?.value).toBe(6);
    expect((await balances(b.company)).byCode('5000')).toBe(6000);

    await setDocumentStatus(bill.id, 'void');
    level = (await stock(b)).level;
    expect(level?.quantity).toBe(-4);
    let books2 = await balances(b.company);
    // Nothing was received and the item has no cost price: no cost yet.
    expect(books2.byCode('1200')).toBe(0);
    expect(books2.byCode('5000')).toBe(0);

    await setDocumentStatus(bill.id, 'sent');
    expect((await stock(b)).level).toMatchObject({ quantity: 4, value: 6 });
    expect((await balances(b.company)).byCode('5000')).toBe(6000);
    await deleteDocument(bill.id);
    expect(await db.stockMovements.where('sourceId').equals(bill.id).count()).toBe(0);
    books2 = await balances(b.company);
    expect(books2.byCode('1200') + books2.byCode('5000')).toBe(0);
  });

  it('posts stock lines of a bill to inventory, other lines as usual', async () => {
    const b = await books();
    const bill = await issue(b, 'bill', '2026-10-01', [
      { product: b.item, quantity: 3, price: 1.111 },
      { name: 'Delivery', quantity: 1, price: 0.5 },
    ]);
    const { byCode, lines } = await balances(b.company);
    expect(byCode('1200')).toBe(3333);
    expect(byCode('6000')).toBe(500);
    expect(byCode('2000')).toBe(-3833);
    expect(lines.filter((l) => l.sourceId === bill.id).length).toBe(3);
  });

  it('values a foreign-currency bill in dinars at its exchange rate', async () => {
    const b = await books();
    await issue(b, 'bill', '2026-10-01', [{ product: b.item, quantity: 4, price: 25 }], {
      currency: 'USD',
      exchangeRate: 0.3075,
    });
    const { level } = await stock(b);
    expect(level?.value).toBe(30.75);
    expect(level?.unitCost).toBe(7.6875);
    expect((await balances(b.company)).byCode('1200')).toBe(30750);
  });

  it('returns goods to a vendor at the value credited', async () => {
    const b = await books();
    await issue(b, 'bill', '2026-10-01', [{ product: b.item, quantity: 10, price: 1 }]);
    await issue(b, 'bill', '2026-10-02', [{ product: b.item, quantity: 10, price: 2 }]);
    await issue(b, 'vendor_credit', '2026-10-03', [{ product: b.item, quantity: 5, price: 2 }]);
    const { level } = await stock(b);
    expect(level?.quantity).toBe(15);
    expect(level?.value).toBe(20);
    const { byCode } = await balances(b.company);
    expect(byCode('1200')).toBe(20000);
    expect(byCode('5000')).toBe(0);
  });
});

describe('stock entries', () => {
  it('posts opening stock against opening balances and adjustments to 5300', async () => {
    const b = await books();
    const main = (await db.warehouses.where('companyId').equals(b.company.id).first())!;
    expect(main.name).toBe('Main store');
    expect(main.nameAr).toBe('المستودع الرئيسي');
    await recordStockEntry(b.company.id, {
      kind: 'opening',
      date: '2026-09-30',
      warehouseId: main.id,
      reference: '',
      notes: '',
      lines: [{ productId: b.item.id, quantity: 20, unitCost: 1.375 }],
    });
    const damaged = await recordStockEntry(b.company.id, {
      kind: 'adjustment',
      date: '2026-10-02',
      warehouseId: main.id,
      reason: 'damaged',
      reference: '',
      notes: '',
      lines: [{ productId: b.item.id, quantity: -3 }],
    });
    expect(damaged.number).toBe('ADJ-0001');
    let { byCode } = await balances(b.company);
    expect(byCode('1200')).toBe(23375);
    expect(byCode('3900')).toBe(-27500);
    expect(byCode('5300')).toBe(4125);

    await voidStockEntry(damaged.id);
    expect((await db.stockEntries.get(damaged.id))?.status).toBe('void');
    ({ byCode } = await balances(b.company));
    expect(byCode('1200')).toBe(27500);
    expect(byCode('5300')).toBe(0);
  });

  it('transfers between warehouses without posting', async () => {
    const b = await books();
    const main = (await db.warehouses.where('companyId').equals(b.company.id).first())!;
    const showroom = await saveWarehouse(
      createWarehouse(b.company.id, { name: 'Salmiya showroom', nameAr: 'معرض السالمية' }),
    );
    await issue(b, 'bill', '2026-10-01', [{ product: b.item, quantity: 10, price: 1.5 }]);
    await recordStockEntry(b.company.id, {
      kind: 'transfer',
      date: '2026-10-02',
      warehouseId: main.id,
      toWarehouseId: showroom.id,
      reference: '',
      notes: '',
      lines: [{ productId: b.item.id, quantity: 4 }],
    });
    const { level } = await stock(b);
    expect(level?.byWarehouse.get(main.id)).toBe(6);
    expect(level?.byWarehouse.get(showroom.id)).toBe(4);
    expect(level?.value).toBe(15);
    const { byCode } = await balances(b.company);
    expect(byCode('1200')).toBe(15000);
    await expect(
      recordStockEntry(b.company.id, {
        kind: 'transfer',
        date: '2026-10-02',
        warehouseId: main.id,
        toWarehouseId: main.id,
        reference: '',
        notes: '',
        lines: [{ productId: b.item.id, quantity: 1 }],
      }),
    ).rejects.toThrow(InventoryError);
  });
});

describe('warehouses', () => {
  it('keeps where a document moved stock when the default warehouse changes', async () => {
    const b = await books();
    const main = (await db.warehouses.where('companyId').equals(b.company.id).first())!;
    const bill = await issue(b, 'bill', '2026-10-01', [{ product: b.item, quantity: 5, price: 1 }]);
    const showroom = await saveWarehouse(
      createWarehouse(b.company.id, { name: 'Salmiya showroom', isDefault: true }),
    );
    expect((await db.warehouses.get(main.id))?.isDefault).toBe(false);
    // Saved again with a new price: the stock stays where it was received.
    await saveDocument({ ...bill, items: [{ ...bill.items[0], unitPrice: 1.2 }] });
    let level = (await stock(b)).level;
    expect(level?.byWarehouse.get(main.id)).toBe(5);
    expect(level?.value).toBe(6);
    // A new invoice uses the new default, unless its line says otherwise.
    await issue(b, 'invoice', '2026-10-02', [{ product: b.item, quantity: 2, price: 3 }]);
    level = (await stock(b)).level;
    expect(level?.byWarehouse.get(showroom.id)).toBe(-2);
    expect(level?.quantity).toBe(3);
  });
});

describe('landed costs', () => {
  it('adds customs and freight to the cost of the goods received', async () => {
    const b = await books();
    const toner = await saveItem(createProduct(b.company.id, { name: 'Toner', kind: 'stock' }));
    const goods = await issue(b, 'bill', '2026-10-01', [
      { product: b.item, quantity: 10, price: 3, id: 'paper' },
      { product: toner, quantity: 2, price: 10, id: 'toner' },
    ]);
    const customs = await issue(b, 'bill', '2026-10-04', [
      { name: 'Customs duty 5%', quantity: 1, price: 2.5, id: 'duty' },
      { name: 'Freight', quantity: 1, price: 1.5, id: 'freight' },
    ]);
    const cost = await saveLandedCost(b.company.id, {
      billId: customs.id,
      sourceLineIds: ['duty', 'freight'],
      targetBillId: goods.id,
      targetLineIds: [],
      method: 'value',
      notes: '',
    });
    expect(cost.number).toBe('LC-0001');
    const levels = stockLevels(await db.stockMovements.toArray(), 3);
    // 4.000 split 30 : 20 by value.
    expect(levels.get(b.item.id)?.value).toBe(32.4);
    expect(levels.get(b.item.id)?.unitCost).toBe(3.24);
    expect(levels.get(toner.id)?.value).toBe(21.6);
    let { byCode } = await balances(b.company);
    expect(byCode('1200')).toBe(54000);
    expect(byCode('6000')).toBe(0);

    await voidLandedCost(cost.id);
    ({ byCode } = await balances(b.company));
    expect(byCode('1200')).toBe(50000);
    expect(byCode('6000')).toBe(4000);
  });

  it('allocates by quantity and sends the share of goods already sold to cost of sales', async () => {
    const b = await books();
    const goods = await issue(b, 'bill', '2026-10-01', [
      { product: b.item, quantity: 10, price: 1, id: 'paper' },
    ]);
    await issue(b, 'invoice', '2026-10-02', [{ product: b.item, quantity: 4, price: 3 }]);
    const freight = await issue(b, 'bill', '2026-10-03', [
      { name: 'Freight', quantity: 1, price: 2, id: 'freight' },
    ]);
    await saveLandedCost(b.company.id, {
      billId: freight.id,
      sourceLineIds: ['freight'],
      targetBillId: goods.id,
      targetLineIds: [],
      method: 'quantity',
      notes: '',
    });
    const { level } = await stock(b);
    expect(level?.value).toBe(7.2);
    const { byCode } = await balances(b.company);
    expect(byCode('1200')).toBe(7200);
    // 4.000 of goods sold plus 40% of the freight.
    expect(byCode('5000')).toBe(4800);
  });

  it('refuses charges dated before the goods', async () => {
    const b = await books();
    const freight = await issue(b, 'bill', '2026-09-30', [
      { name: 'Freight', quantity: 1, price: 2, id: 'freight' },
    ]);
    const goods = await issue(b, 'bill', '2026-10-01', [
      { product: b.item, quantity: 1, price: 1 },
    ]);
    await expect(
      saveLandedCost(b.company.id, {
        billId: freight.id,
        sourceLineIds: ['freight'],
        targetBillId: goods.id,
        targetLineIds: [],
        method: 'value',
        notes: '',
      }),
    ).rejects.toThrow(InventoryError);
  });
});

describe('lock date', () => {
  it('keeps locked periods as posted and refuses changes to them', async () => {
    const b = await books();
    await issue(b, 'bill', '2026-09-01', [{ product: b.item, quantity: 10, price: 1 }]);
    const sale = await issue(b, 'invoice', '2026-09-20', [
      { product: b.item, quantity: 5, price: 3 },
    ]);
    const company = (await db.companies.get(b.company.id))!;
    await saveCompany({
      ...company,
      accounting: { ...company.accounting!, lockDate: '2026-09-30' },
    });
    const locked = { ...b, company: (await db.companies.get(b.company.id))! };
    await expect(
      issue(locked, 'bill', '2026-09-10', [{ product: b.item, quantity: 10, price: 5 }]),
    ).rejects.toThrow(LockedPeriodError);
    const main = (await db.warehouses.where('companyId').equals(b.company.id).first())!;
    await expect(
      recordStockEntry(b.company.id, {
        kind: 'adjustment',
        date: '2026-09-15',
        warehouseId: main.id,
        reference: '',
        notes: '',
        lines: [{ productId: b.item.id, quantity: -1 }],
      }),
    ).rejects.toThrow(LockedPeriodError);
    // A service sold in the locked period can't start moving stock.
    const service = await saveItem(createProduct(b.company.id, { name: 'Courier' }));
    await issue(b, 'invoice', '2026-10-02', [{ product: service, quantity: 1, price: 1 }]);
    const pastService = { ...service };
    await db.documents.put({
      ...sale,
      id: 'old-service-sale',
      number: 'INV-OLD',
      items: [{ ...sale.items[0], productId: service.id }],
    });
    await expect(saveItem({ ...pastService, kind: 'stock' })).rejects.toThrow(InventoryError);

    // October is costed from the locked September figures.
    await issue(locked, 'bill', '2026-10-01', [{ product: b.item, quantity: 5, price: 2 }]);
    await rebuildStock(b.company.id);
    const saleMovement = (await stock(b)).movements.find((m) => m.documentId === sale.id);
    expect(saleMovement?.value).toBe(-5);
    expect((await stock(b)).level?.value).toBe(15);
  });
});

describe('items', () => {
  it('starts moving stock when a service becomes a stock item', async () => {
    const b = await books();
    const toner = await saveItem(createProduct(b.company.id, { name: 'Toner' }));
    await issue(b, 'bill', '2026-10-01', [{ product: toner, quantity: 2, price: 10 }]);
    expect((await balances(b.company)).byCode('1200')).toBe(0);
    await saveItem({ ...toner, kind: 'stock' });
    expect((await balances(b.company)).byCode('1200')).toBe(20000);
    // With stock history it stays a stock item and can't be deleted.
    await expect(saveItem({ ...toner, kind: 'service' })).rejects.toThrow(InventoryError);
    await expect(deleteItem(toner.id)).rejects.toThrow(InventoryError);
  });

  it('records opening stock with a new item', async () => {
    const company = await setupCompany({ name: 'Gulf Trading' });
    const main = (await db.warehouses.where('companyId').equals(company.id).first()) ?? null;
    expect(main).toBeNull();
    const item = createProduct(company.id, { name: 'Cable', kind: 'stock', costPrice: 0.75 });
    // No warehouse given: the default one, created with the first stock item.
    await saveItem(item, {
      opening: { warehouseId: '', quantity: 8, unitCost: 0.75, date: '2026-10-01' },
    });
    const store = (await db.warehouses.where('companyId').equals(company.id).first())!;
    expect(store.isDefault).toBe(true);
    const level = stockLevels(await db.stockMovements.toArray(), 3).get(item.id);
    expect(level?.quantity).toBe(8);
    expect(level?.value).toBe(6);
    expect(level?.byWarehouse.get(store.id)).toBe(8);
    const { byCode } = await balances(company);
    expect(byCode('1200')).toBe(6000);
    expect(byCode('3900')).toBe(-6000);
  });
});

describe('item codes (SKU)', () => {
  async function coding(on = true): Promise<Company> {
    const company = await setupCompany({ name: 'Gulf Trading' });
    return saveCompany({ ...company, items: on ? { autoSku: true } : undefined });
  }
  const item = (company: Company, name: string, extra: Partial<Product> = {}) =>
    saveItem(createProduct(company.id, { name, ...extra }));

  it('gives new items without one the next code, and keeps one typed by hand', async () => {
    const company = await coding();
    expect(await suggestItemCode(company)).toBe('SKU-00001');
    expect((await item(company, 'Gloves')).sku).toBe('SKU-00001');
    expect((await item(company, 'Helmet')).sku).toBe('SKU-00002');
    expect((await item(company, 'Boots', { sku: ' BT-44 ' })).sku).toBe('BT-44');
    expect((await db.companies.get(company.id))?.numbering.product).toMatchObject({ next: 3 });
  });

  it('skips codes typed by hand', async () => {
    const company = await coding();
    await item(company, 'Vest', { sku: 'sku-00001' });
    expect((await item(company, 'Gloves')).sku).toBe('SKU-00002');
  });

  it('works for companies made before item codes (no rule yet)', async () => {
    const company = await coding();
    const { product: _none, ...numbering } = company.numbering;
    await db.companies.put({ ...company, numbering: numbering as Company['numbering'] });
    expect((await item(company, 'Gloves')).sku).toBe('SKU-00001');
    expect((await db.companies.get(company.id))?.numbering.product).toMatchObject({
      pattern: 'SKU-{counter}',
      padding: 5,
      next: 2,
    });
  });

  it('gives no code while codes are off, and none to items saved again', async () => {
    const off = await coding(false);
    expect((await item(off, 'Gloves')).sku).toBe('');
    const company = await coding();
    const old = await item(company, 'Helmet', { sku: '' });
    expect(old.sku).toBe('SKU-00001');
    // An older item without a code keeps having none when archived or edited.
    const before = createProduct(company.id, { name: 'Rope' });
    await db.products.put(before);
    expect((await saveItem({ ...before, archived: true })).sku).toBe('');
  });

  it('refuses an SKU another item has, new or changed, but not one kept', async () => {
    const company = await coding(false);
    const gloves = await item(company, 'Gloves', { sku: 'GL-01' });
    await expect(item(company, 'Gloves XL', { sku: ' gl-01' })).rejects.toThrow(InventoryError);
    const helmet = await item(company, 'Helmet', { sku: 'HM-01' });
    await expect(saveItem({ ...helmet, sku: 'GL-01' })).rejects.toThrow(/GL-01/);
    // Two items that already share an SKU (another device gave it) still save.
    await db.products.put({ ...helmet, sku: 'GL-01' });
    await expect(saveItem({ ...gloves, unitPrice: 2 })).resolves.toMatchObject({ sku: 'GL-01' });
    await expect(saveItem({ ...helmet, sku: 'GL-01', name: 'Hard hat' })).resolves.toMatchObject({
      sku: 'GL-01',
    });
  });

  it('gives codes to the items without one, oldest first, archived ones left', async () => {
    const company = await coding();
    const first = createProduct(company.id, { name: 'Rope', createdAt: '2026-01-01T00:00:00Z' });
    const second = createProduct(company.id, { name: 'Bag', createdAt: '2026-02-01T00:00:00Z' });
    const archived = createProduct(company.id, { name: 'Old', archived: true });
    await db.products.bulkPut([second, first, archived]);
    await item(company, 'Gloves', { sku: 'SKU-00002' });
    expect(await assignItemCodes(company.id)).toBe(2);
    expect((await db.products.get(first.id))?.sku).toBe('SKU-00001');
    expect((await db.products.get(second.id))?.sku).toBe('SKU-00003');
    expect((await db.products.get(archived.id))?.sku).toBe('');
    expect((await item(company, 'Helmet')).sku).toBe('SKU-00004');
    expect(await assignItemCodes(company.id)).toBe(0);
  });

  it('keeps the unit picked from the list, and drops an empty one', async () => {
    const company = await coding(false);
    const box = await item(company, 'Paper', { unit: 'box', unitId: 'box' });
    expect((await db.products.get(box.id))?.unitId).toBe('box');
    const typed = await item(company, 'Rope', { unit: 'roll', unitId: '' });
    expect('unitId' in (await db.products.get(typed.id))!).toBe(false);
  });
});
