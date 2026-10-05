import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import { saveClient, setupCompany } from './records';
import {
  DocumentChangeError,
  deleteDocument,
  draftDocument,
  saveDocument,
  setDocumentStatus,
} from './documents';
import { LockedPeriodError } from './accounting';
import { billAssetLines, createAsset, saveAsset, voidAsset } from './assets';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 11, 15));
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const company = await setupCompany({ name: 'Review Co' });
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
  const code = (c: string) => accounts.find((a) => a.code === c)!;
  return { company, accounts, code };
}

describe('a fixed asset made from a bill line', () => {
  async function serverBill() {
    const s = await setup();
    const vendor = await saveClient(
      createClient(s.company.id, { name: 'Sample Vendor', isCustomer: false, isVendor: true }),
    );
    const draft = await draftDocument(s.company, 'bill', vendor);
    const bill = await saveDocument({
      ...draft,
      status: 'sent',
      issueDate: '2026-03-10',
      items: [
        {
          ...draft.items[0],
          id: 'server',
          name: 'Server',
          quantity: 1,
          unitPrice: 900,
          taxes: [],
          accountId: s.code('1520').id,
        },
        { ...draft.items[0], id: 'delivery', name: 'Delivery', quantity: 1, unitPrice: 10 },
      ],
    });
    const [line] = billAssetLines(s.company, [bill], s.accounts, []);
    const asset = await saveAsset(
      createAsset(s.company.id, {
        name: 'Server',
        assetAccountId: s.code('1520').id,
        accumulatedAccountId: s.code('1530').id,
        expenseAccountId: s.code('6900').id,
        purchaseDate: '2026-03-10',
        depreciationStart: '2026-03-10',
        cost: line.cost,
        usefulLifeMonths: 36,
        source: 'bill',
        billId: bill.id,
        billLineId: 'server',
      }),
    );
    return { ...s, bill, asset };
  }

  it('keeps the bill in the books while the asset is in the register', async () => {
    const { bill, asset } = await serverBill();
    await expect(setDocumentStatus(bill.id, 'void')).rejects.toThrow(DocumentChangeError);
    await expect(setDocumentStatus(bill.id, 'void')).rejects.toThrow(
      `Asset ${asset.number} Server was made from this bill. Void the asset first.`,
    );
    await expect(deleteDocument(bill.id)).rejects.toThrow(DocumentChangeError);
    expect((await db.documents.get(bill.id))?.status).toBe('sent');

    await voidAsset(asset.id);
    await setDocumentStatus(bill.id, 'void');
    expect((await db.documents.get(bill.id))?.status).toBe('void');
  });

  it('keeps the line the asset was made from; the rest of the bill can change', async () => {
    const { bill, asset } = await serverBill();
    const [server, delivery] = bill.items;
    await expect(
      saveDocument({ ...bill, items: [{ ...server, unitPrice: 950 }, delivery] }),
    ).rejects.toThrow(`Asset ${asset.number} Server was made from line “Server” of this bill`);
    await expect(saveDocument({ ...bill, items: [delivery] })).rejects.toThrow(DocumentChangeError);
    await expect(saveDocument({ ...bill, discount: 5 })).rejects.toThrow(DocumentChangeError);
    // Other lines and details are free.
    const saved = await saveDocument({
      ...bill,
      notes: 'Delivered to the server room',
      items: [server, { ...delivery, unitPrice: 12 }],
    });
    expect(saved.totals.total).toBe(912);
  });
});

describe('fixed assets in a locked period', () => {
  it('can still have their location, custodian or notes changed, but not their figures', async () => {
    const { company, code } = await setup();
    const asset = await saveAsset(
      createAsset(company.id, {
        name: 'Delivery van',
        assetAccountId: code('1520').id,
        accumulatedAccountId: code('1530').id,
        expenseAccountId: code('6900').id,
        purchaseDate: '2026-01-10',
        depreciationStart: '2026-01-10',
        cost: 6000,
        usefulLifeMonths: 60,
        source: 'purchase',
        paidFromAccountId: code('1000').id,
      }),
    );
    const journal = (await db.journals.get(asset.journalId!))!;
    await db.companies.update(company.id, {
      accounting: { ...company.accounting!, lockDate: '2026-06-30' },
    });
    const saved = await saveAsset({ ...asset, location: 'Shuwaikh yard', custodian: 'Driver A' });
    expect(saved).toMatchObject({ location: 'Shuwaikh yard', journalId: asset.journalId });
    expect(await db.journals.get(asset.journalId!)).toEqual(journal);
    await expect(saveAsset({ ...saved, cost: 6500 })).rejects.toThrow(LockedPeriodError);
    await expect(saveAsset({ ...saved, purchaseDate: '2026-01-05' })).rejects.toThrow(
      LockedPeriodError,
    );
  });
});
