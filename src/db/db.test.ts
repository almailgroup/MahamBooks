import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import {
  checkMarkSent,
  convertQuoteToInvoice,
  deleteDocument,
  draftDocument,
  DuplicateNumberError,
  markSent,
  saveDocument,
  setDocumentStatus,
} from './documents';
import { createPayment, deletePayment, savePayment, AllocationError } from './payments';
import {
  clientHasRecords,
  deleteClient,
  deleteCompany,
  getCurrentCompanyId,
  saveClient,
  setupCompany,
} from './records';
import { LockedPeriodError } from './accounting';
import type { Company, InvoiceDocument } from './types';

async function freshCompany(): Promise<Company> {
  return setupCompany({ name: 'Acme Mail', currency: 'USD', locale: 'en-US' }, [
    { name: 'VAT', rate: 20 },
  ]);
}

async function invoiceFor(
  company: Company,
  clientId: string,
  unitPrice = 100,
): Promise<InvoiceDocument> {
  const client = (await db.clients.get(clientId))!;
  const draft = await draftDocument(company, 'invoice', client);
  draft.items[0] = { ...draft.items[0], name: 'Service', quantity: 1, unitPrice };
  return saveDocument(draft);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('companies', () => {
  it('creates a company with default tax and makes it current', async () => {
    const company = await freshCompany();
    expect(await getCurrentCompanyId()).toBe(company.id);
    const rates = await db.taxRates.where('companyId').equals(company.id).toArray();
    expect(rates).toHaveLength(1);
    expect(company.defaults.defaultTaxRateIds).toEqual([rates[0].id]);
  });

  it('deletes a company with all its records', async () => {
    const company = await freshCompany();
    const client = await saveClient(createClient(company.id, { name: 'Client' }));
    await invoiceFor(company, client.id);
    await deleteCompany(company.id);
    expect(await db.companies.count()).toBe(0);
    expect(await db.clients.count()).toBe(0);
    expect(await db.documents.count()).toBe(0);
    expect(await getCurrentCompanyId()).toBeNull();
  });
});

describe('clients', () => {
  it('assigns client numbers', async () => {
    const company = await freshCompany();
    const a = await saveClient(createClient(company.id, { name: 'A' }));
    const b = await saveClient(createClient(company.id, { name: 'B' }));
    expect(a.number).toBe('C-0001');
    expect(b.number).toBe('C-0002');
  });

  it('refuses to delete clients with records', async () => {
    const company = await freshCompany();
    const client = await saveClient(createClient(company.id, { name: 'A' }));
    await invoiceFor(company, client.id);
    expect(await clientHasRecords(client.id)).toBe(true);
    await expect(deleteClient(client.id)).rejects.toThrow(/Archive/);
  });
});

describe('documents', () => {
  it('numbers documents sequentially and applies default taxes', async () => {
    const company = await freshCompany();
    const client = await saveClient(createClient(company.id, { name: 'A' }));
    const first = await invoiceFor(company, client.id);
    const second = await invoiceFor(company, client.id);
    const year = first.issueDate.slice(0, 4);
    expect(first.number).toBe(`INV-${year}-0001`);
    expect(second.number).toBe(`INV-${year}-0002`);
    expect(first.items[0].taxes).toEqual([{ name: 'VAT', rate: 20, kind: 'standard' }]);
    expect(first.totals).toMatchObject({ subtotal: 100, taxTotal: 20, total: 120, balance: 120 });
    const stored = await db.companies.get(company.id);
    expect(stored!.numbering.invoice.next).toBe(3);
  });

  it('rejects duplicate numbers', async () => {
    const company = await freshCompany();
    const client = await saveClient(createClient(company.id, { name: 'A' }));
    const first = await invoiceFor(company, client.id);
    const draft = await draftDocument(company, 'invoice', client);
    await expect(saveDocument({ ...draft, number: first.number })).rejects.toBeInstanceOf(
      DuplicateNumberError,
    );
  });

  it('tries marking a draft as sent without changing anything, with the error it would give', async () => {
    const company = await freshCompany();
    const client = await saveClient(createClient(company.id, { name: 'A' }));
    const invoice = await invoiceFor(company, client.id);
    const logged = await db.activities.count();
    await checkMarkSent(invoice.id);
    expect(await db.documents.get(invoice.id)).toEqual(invoice);
    expect(await db.activities.count()).toBe(logged);
    // Issuing it would post it into a locked period.
    await db.companies.update(company.id, {
      accounting: { ...company.accounting!, lockDate: invoice.issueDate },
    });
    await expect(checkMarkSent(invoice.id)).rejects.toThrow(LockedPeriodError);
    await expect(markSent(invoice.id)).rejects.toThrow(LockedPeriodError);
    expect((await db.documents.get(invoice.id))?.status).toBe('draft');
  });

  it('tracks payments through partial and paid', async () => {
    const company = await freshCompany();
    const client = await saveClient(createClient(company.id, { name: 'A' }));
    const invoice = await invoiceFor(company, client.id);
    await markSent(invoice.id);
    expect((await db.documents.get(invoice.id))!.status).toBe('sent');

    const p1 = await savePayment(
      createPayment(company.id, {
        clientId: client.id,
        amount: 50,
        allocations: [{ documentId: invoice.id, amount: 50 }],
      }),
    );
    expect(p1.number).toBe('PAY-0001');
    let stored = (await db.documents.get(invoice.id))!;
    expect(stored.status).toBe('partial');
    expect(stored.totals).toMatchObject({ paid: 50, balance: 70 });

    await savePayment(
      createPayment(company.id, {
        clientId: client.id,
        amount: 70,
        allocations: [{ documentId: invoice.id, amount: 70 }],
      }),
    );
    stored = (await db.documents.get(invoice.id))!;
    expect(stored.status).toBe('paid');
    expect(stored.paidAt).toBeTruthy();

    await deletePayment(p1.id);
    stored = (await db.documents.get(invoice.id))!;
    expect(stored.status).toBe('partial');
    expect(stored.totals.balance).toBe(50);
  });

  it('refuses allocations larger than the payment', async () => {
    const company = await freshCompany();
    const client = await saveClient(createClient(company.id, { name: 'A' }));
    const invoice = await invoiceFor(company, client.id);
    await expect(
      savePayment(
        createPayment(company.id, {
          clientId: client.id,
          amount: 10,
          allocations: [{ documentId: invoice.id, amount: 20 }],
        }),
      ),
    ).rejects.toBeInstanceOf(AllocationError);
  });

  it('applies credit notes like payments', async () => {
    const company = await freshCompany();
    const client = await saveClient(createClient(company.id, { name: 'A' }));
    const invoice = await invoiceFor(company, client.id);
    // Credits and payments are applied to issued invoices only.
    await markSent(invoice.id);
    const creditDraft = await draftDocument(company, 'credit', client);
    creditDraft.items[0] = { ...creditDraft.items[0], name: 'Refund', unitPrice: 50 };
    const credit = await saveDocument(creditDraft);
    await markSent(credit.id);
    expect(credit.totals.total).toBe(60);

    await savePayment(
      createPayment(company.id, {
        clientId: client.id,
        amount: 60,
        method: 'credit_note',
        creditId: credit.id,
        allocations: [{ documentId: invoice.id, amount: 60 }],
      }),
    );
    expect((await db.documents.get(credit.id))!.status).toBe('applied');
    expect((await db.documents.get(invoice.id))!.totals.balance).toBe(60);
  });

  it('converts quotes to invoices', async () => {
    const company = await freshCompany();
    const client = await saveClient(createClient(company.id, { name: 'A' }));
    const quoteDraft = await draftDocument(company, 'quote', client);
    quoteDraft.items[0] = { ...quoteDraft.items[0], name: 'Design', unitPrice: 200 };
    const quote = await saveDocument(quoteDraft);
    await setDocumentStatus(quote.id, 'accepted');
    const invoice = await convertQuoteToInvoice(quote.id);
    expect(invoice.type).toBe('invoice');
    expect(invoice.sourceId).toBe(quote.id);
    expect(invoice.totals.total).toBe(240);
    const storedQuote = (await db.documents.get(quote.id))!;
    expect(storedQuote.status).toBe('invoiced');
    expect(storedQuote.convertedToId).toBe(invoice.id);
  });

  it('keeps payments as unapplied credit when an invoice is deleted', async () => {
    const company = await freshCompany();
    const client = await saveClient(createClient(company.id, { name: 'A' }));
    const invoice = await invoiceFor(company, client.id);
    await markSent(invoice.id);
    const payment = await savePayment(
      createPayment(company.id, {
        clientId: client.id,
        amount: 120,
        allocations: [{ documentId: invoice.id, amount: 120 }],
      }),
    );
    await deleteDocument(invoice.id);
    const stored = (await db.payments.get(payment.id))!;
    expect(stored.allocations).toEqual([]);
    expect(stored.amount).toBe(120);
  });

  it('voids invoices without changing totals', async () => {
    const company = await freshCompany();
    const client = await saveClient(createClient(company.id, { name: 'A' }));
    const invoice = await invoiceFor(company, client.id);
    await setDocumentStatus(invoice.id, 'void');
    const stored = (await db.documents.get(invoice.id))!;
    expect(stored.status).toBe('void');
    expect(stored.totals.total).toBe(120);
  });
});
