import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { createClient, createDocument, createProduct } from '@/db/defaults';
import { saveItem } from '@/db/inventory';
import { addProductImages } from '@/db/product-images';
import { setupCompany, saveClient } from '@/db/records';
import { addAttachment, createExpense } from '@/db/purchases';
import { createAsset } from '@/db/assets';
import { createEmployee, saveEmployee, setEmployeePhoto } from '@/db/people';
import { createComplianceDocument, saveComplianceDocument } from '@/db/renewals';
import { newCertificate, saveCertificate } from '@/db/retention';
import type { Company } from '@/db/types';
import { fileFormat, loadFileIndex } from './file-index';

const PDF = { type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK' };
const JPEG = { type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/4AAQ' };

beforeEach(async () => {
  await db.delete();
  await db.open();
});

/** Every request that reads the values of the attachments store (its content). */
function watchContentReads(): { reads: string[]; stop: () => void } {
  const reads: string[] = [];
  const undo: (() => void)[] = [];
  const watch = (proto: object, method: string, storeOf: (self: never) => string) => {
    const target = proto as Record<string, (...args: unknown[]) => unknown>;
    const original = target[method];
    target[method] = function (this: never, ...args: unknown[]) {
      if (storeOf(this) === 'attachments') reads.push(method);
      return original.apply(this, args);
    };
    undo.push(() => (target[method] = original));
  };
  for (const method of ['get', 'getAll', 'openCursor']) {
    watch(IDBObjectStore.prototype, method, (s: IDBObjectStore) => s.name);
    watch(IDBIndex.prototype, method, (i: IDBIndex) => i.objectStore.name);
  }
  return { reads, stop: () => undo.forEach((u) => u()) };
}

describe('the files of a company', () => {
  let company: Company;
  let stop = () => {};
  afterEach(() => stop());

  async function seed() {
    company = await setupCompany({ name: 'Made-up Trading' });
    const vendor = await saveClient(createClient(company.id, { name: 'Made-up Supplies' }));
    const bill = createDocument(company.id, 'bill', {
      number: 'BILL-0004',
      clientId: vendor.id,
      issueDate: '2026-09-01',
    });
    await db.documents.put(bill);
    const expense = createExpense(company.id, {
      number: 'EXP-0002',
      description: 'Fuel for the pickup',
      date: '2026-09-05',
    });
    await db.expenses.put(expense);
    const asset = createAsset(company.id, { name: 'Pickup truck', number: 'FA-0001' });
    await db.assets.put(asset);
    const licence = await saveComplianceDocument(
      createComplianceDocument(company.id, {
        type: 'commercial_licence',
        number: 'CL-2026-77',
        expiryDate: '2027-01-31',
      }),
    );
    const guard = await saveEmployee(
      createEmployee(company.id, { name: 'Test Guard', nameAr: 'حارس تجريبي' }),
    );
    const residency = await saveComplianceDocument(
      createComplianceDocument(company.id, {
        ownerType: 'employee',
        employeeId: guard.id,
        type: 'driving_licence',
      }),
    );
    const sheet = await saveComplianceDocument(
      createComplianceDocument(company.id, { title: 'Guards cost sheet', confidential: true }),
    );
    const certificate = newCertificate({ number: 'CC-9' });
    await saveCertificate(vendor.id, certificate, { name: 'Certificate.pdf', ...PDF });

    await addAttachment(company.id, bill.id, { name: 'Bill scan.pdf', ...PDF });
    await addAttachment(company.id, expense.id, { name: 'Receipt.jpg', ...JPEG });
    await addAttachment(company.id, asset.id, { name: 'Invoice of the truck.pdf', ...PDF });
    await addAttachment(company.id, licence.id, { name: 'Licence.pdf', ...PDF });
    await addAttachment(company.id, guard.id, { name: 'Contract.pdf', ...PDF });
    await setEmployeePhoto(guard.id, { name: 'Guard', dataUrl: JPEG.dataUrl });
    await addAttachment(company.id, residency.id, { name: 'Driving licence.jpg', ...JPEG });
    await addAttachment(company.id, sheet.id, { name: 'Cost sheet.pdf', ...PDF });
    // A file whose record isn't on this device.
    await addAttachment(company.id, 'gone', { name: 'Old scan.pdf', ...PDF });
    // Another company's.
    const other = await setupCompany({ name: 'Made-up Other' });
    await addAttachment(other.id, 'x', { name: 'Not ours.pdf', ...PDF });
    return { bill, expense, asset, licence, guard, residency, sheet, vendor };
  }

  it('says what each is kept with and where it opens, without reading any content', async () => {
    const { bill, expense, asset, licence, guard, residency, vendor } = await seed();
    const watcher = watchContentReads();
    stop = watcher.stop;
    const files = await loadFileIndex(company);
    watcher.stop();
    expect(watcher.reads).toEqual([]);

    const byName = new Map(files.map((f) => [f.name, f]));
    expect([...byName.keys()].sort()).toEqual(
      [
        'Bill scan.pdf',
        'Certificate.pdf',
        'Contract.pdf',
        'Cost sheet.pdf',
        'Driving licence.jpg',
        'Invoice of the truck.pdf',
        'Licence.pdf',
        'Old scan.pdf',
        'Receipt.jpg',
      ].sort(),
    );
    expect(byName.get('Bill scan.pdf')).toMatchObject({
      kind: 'document',
      owner: 'Bill BILL-0004',
      detail: 'Made-up Supplies',
      to: `/bills/${bill.id}`,
      format: 'pdf',
      private: false,
    });
    expect(byName.get('Receipt.jpg')).toMatchObject({
      kind: 'expense',
      owner: 'Expense EXP-0002',
      to: `/expenses?open=${expense.id}`,
      format: 'image',
    });
    expect(byName.get('Invoice of the truck.pdf')).toMatchObject({
      kind: 'asset',
      to: `/assets/${asset.id}`,
    });
    expect(byName.get('Licence.pdf')).toMatchObject({
      kind: 'paper',
      owner: 'Commercial licence',
      to: `/compliance/documents?doc=${licence.id}`,
      numbers: ['CL-2026-77'],
    });
    expect(byName.get('Contract.pdf')).toMatchObject({
      kind: 'employee',
      owner: 'Test Guard',
      detail: 'Personnel file',
      to: `/employees/${guard.id}`,
      private: true,
    });
    expect(byName.get('Driving licence.jpg')).toMatchObject({
      kind: 'paper',
      detail: 'Test Guard',
      to: `/employees/${guard.id}`,
      private: true,
    });
    expect(byName.get('Driving licence.jpg')?.terms).toContain('حارس تجريبي');
    expect(byName.get('Driving licence.jpg')?.ownerId).toBe(residency.id);
    expect(byName.get('Cost sheet.pdf')).toMatchObject({ kind: 'paper', private: true });
    expect(byName.get('Certificate.pdf')).toMatchObject({
      kind: 'certificate',
      owner: 'Clearance certificate CC-9',
      to: `/clients/${vendor.id}`,
    });
    expect(byName.get('Old scan.pdf')).toMatchObject({ kind: 'other', to: null });
    // Newest record first.
    expect(files.indexOf(byName.get('Receipt.jpg')!)).toBeLessThan(
      files.indexOf(byName.get('Bill scan.pdf')!),
    );
  });

  it('leaves out people’s files and confidential papers for those who don’t see People', async () => {
    await seed();
    const files = await loadFileIndex(company, { people: false });
    expect(files.map((f) => f.name).sort()).toEqual(
      [
        'Bill scan.pdf',
        'Certificate.pdf',
        'Invoice of the truck.pdf',
        'Licence.pdf',
        'Receipt.jpg',
      ].sort(),
    );
    expect(files.every((f) => !f.private)).toBe(true);
  });

  it('marks files whose content is still in the cloud', async () => {
    const { bill } = await seed();
    const scan = await db.attachments.where('ownerId').equals(bill.id).first();
    await db.attachments.update(scan!.id, { dataUrl: '', contentMissing: 1 });
    const files = await loadFileIndex(company);
    expect(files.find((f) => f.id === scan!.id)?.inCloud).toBe(true);
    expect(files.filter((f) => f.inCloud)).toHaveLength(1);
  });

  it('leaves out items’ pictures, shown with their item, for every role', async () => {
    await seed();
    const item = await saveItem(createProduct(company.id, { name: 'A4 paper box', sku: 'PAP-A4' }));
    await addProductImages(item.id, [
      { name: 'IMG_1234.jpg', dataUrl: JPEG.dataUrl },
      { name: 'IMG_1235.jpg', dataUrl: JPEG.dataUrl },
    ]);
    for (const people of [true, false]) {
      const files = await loadFileIndex(company, { people });
      expect(files.filter((f) => f.ownerId === item.id || /^IMG_/.test(f.name))).toEqual([]);
    }
  });

  it('finds an expense by whom it was paid to when that isn’t a vendor', async () => {
    company = await setupCompany({ name: 'Made-up Trading' });
    const expense = createExpense(company.id, {
      number: 'EXP-0007',
      description: '',
      payee: 'Sahara Fuel Station',
      date: '2026-09-05',
    });
    await db.expenses.put(expense);
    await addAttachment(company.id, expense.id, { name: 'Receipt.jpg', ...JPEG });
    const [file] = await loadFileIndex(company);
    expect(file).toMatchObject({ kind: 'expense', detail: 'Sahara Fuel Station' });
    expect(file.terms).toContain('Sahara Fuel Station');
  });

  it('is empty for a company without files', async () => {
    const empty = await setupCompany({ name: 'Made-up Empty' });
    expect(await loadFileIndex(empty)).toEqual([]);
  });
});

describe('what a file holds', () => {
  it('is told by its name', () => {
    expect(fileFormat('Scan.PDF')).toBe('pdf');
    expect(fileFormat('IMG_0012.HEIC')).toBe('image');
    expect(fileFormat('photo.jpeg')).toBe('image');
    expect(fileFormat('notes')).toBe('other');
    expect(fileFormat('sheet.xlsx')).toBe('other');
  });
});
