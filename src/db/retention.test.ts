import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import { draftDocument, saveDocument } from './documents';
import { loadLedger, LockedPeriodError } from './accounting';
import { saveClient, setupCompany } from './records';
import { createPayment, savePayment } from './payments';
import {
  heldRetention,
  releaseRetention,
  removeCertificate,
  RetentionError,
  saveCertificate,
  newCertificate,
  undoRetentionRelease,
} from './retention';
import type { Client, Company, InvoiceDocument } from './types';
import { trialBalance } from '@/lib/accounting/statements';
import { buildStatement } from '@/lib/statements';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function kuwait(contact: Partial<Client> = {}) {
  const company = await setupCompany({
    name: 'Al Mail Contracting',
    currency: 'KWD',
    locale: 'en-KW',
    address: { line1: '', line2: '', city: '', state: '', postalCode: '', country: 'KW' },
  });
  const client = await saveClient(
    createClient(company.id, {
      name: 'Ministry of Public Works',
      isVendor: true,
      retentionPercent: 5,
      retentionKind: 'tax',
      ...contact,
    }),
  );
  return { company, client };
}

async function issue(
  company: Company,
  client: Client,
  type: 'invoice' | 'bill',
  unitPrice: number,
  issueDate = '2026-09-01',
): Promise<InvoiceDocument> {
  const draft = await draftDocument(company, type, client);
  draft.issueDate = issueDate;
  draft.dueDate = '2026-09-30';
  draft.items[0] = { ...draft.items[0], name: 'Works', quantity: 1, unitPrice, taxes: [] };
  return saveDocument({ ...draft, status: 'sent' });
}

async function pay(company: Company, doc: InvoiceDocument, amount: number, date = '2026-09-10') {
  return savePayment(
    createPayment(company.id, {
      direction: doc.type === 'bill' ? 'out' : 'in',
      clientId: doc.clientId,
      date,
      amount,
      currency: 'KWD',
      method: 'bank_transfer',
      allocations: [{ documentId: doc.id, amount }],
    }),
  );
}

/** Balances by account code in fils (debit positive), and the trial balance. */
async function books(company: Company) {
  const fresh = (await db.companies.get(company.id))!;
  const { accounts, lines, problems } = await loadLedger(fresh);
  expect(problems).toEqual([]);
  const byCode: Record<string, number> = {};
  for (const l of lines) {
    const code = accounts.find((a) => a.id === l.accountId)!.code;
    byCode[code] = (byCode[code] ?? 0) + l.amount;
  }
  for (const code of Object.keys(byCode)) if (byCode[code] === 0) delete byCode[code];
  const tb = trialBalance(lines, accounts, '2026-12-31', { month: 12, day: 31 });
  expect(tb.totalDebit).toBe(tb.totalCredit);
  return { byCode, total: lines.reduce((s, l) => s + l.amount, 0), lines, accounts };
}

describe('retention on invoices', () => {
  it('holds back 5% of 1,234.567 (61.728) in 1110 Retentions receivable', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client, 'invoice', 1234.567);
    expect(invoice).toMatchObject({ retentionPercent: 5, retentionKind: 'tax', status: 'sent' });
    expect(invoice.totals).toMatchObject({ total: 1234.567, retention: 61.728, balance: 1172.839 });

    const ledger = await books(company);
    expect(ledger.byCode).toEqual({ '1100': 1_172_839, '1110': 61_728, '4000': -1_234_567 });
    expect(ledger.total).toBe(0);
    // Both receivable lines carry the customer.
    const lines = ledger.lines.filter((l) => l.sourceId === invoice.id && l.amount > 0);
    expect(lines.every((l) => l.contactId === client.id)).toBe(true);
  });

  it('is paid once the amount due is paid; the retention stays held', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client, 'invoice', 1234.567);
    await pay(company, invoice, 500);
    let doc = (await db.documents.get(invoice.id))!;
    expect(doc.status).toBe('partial');
    expect(doc.totals).toMatchObject({ paid: 500, balance: 672.839, retention: 61.728 });

    await pay(company, doc, 672.839, '2026-09-20');
    doc = (await db.documents.get(invoice.id))!;
    expect(doc.status).toBe('paid');
    expect(doc.totals.balance).toBe(0);
    expect(heldRetention(doc)).toBe(61.728);

    const ledger = await books(company);
    expect(ledger.byCode).toEqual({ '1000': 1_172_839, '1110': 61_728, '4000': -1_234_567 });
  });

  it('is released back to the receivable and paid like any amount', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client, 'invoice', 1234.567);
    await pay(company, invoice, 1172.839);

    const released = await releaseRetention(invoice.id, {
      date: '2026-10-01',
      amount: 61.728,
      basis: 'certificate',
      reference: 'MOF-2026-118',
    });
    expect(released.status).toBe('partial');
    expect(released.totals.balance).toBe(61.728);
    expect(heldRetention(released)).toBe(0);

    const journal = (await db.journals.get(released.retentionReleases![0].journalId))!;
    expect(journal).toMatchObject({
      kind: 'retention_release',
      sourceId: invoice.id,
      date: '2026-10-01',
      status: 'posted',
      notes: 'MOF-2026-118',
    });
    const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
    const code = (id: string) => accounts.find((a) => a.id === id)!.code;
    expect(journal.lines.map((l) => [code(l.accountId), l.debit, l.credit, l.contactId])).toEqual([
      ['1100', 61.728, 0, client.id],
      ['1110', 0, 61.728, client.id],
    ]);

    let ledger = await books(company);
    expect(ledger.byCode).toEqual({ '1000': 1_172_839, '1100': 61_728, '4000': -1_234_567 });

    await pay(company, released, 61.728, '2026-10-05');
    const doc = (await db.documents.get(invoice.id))!;
    expect(doc.status).toBe('paid');
    ledger = await books(company);
    expect(ledger.byCode).toEqual({ '1000': 1_234_567, '4000': -1_234_567 });
  });

  it('can be released in parts, and a release can be undone with a reversing entry', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client, 'invoice', 1234.567);
    await releaseRetention(invoice.id, {
      date: '2026-09-15',
      amount: 30,
      basis: 'handover',
      reference: '',
    });
    const second = await releaseRetention(invoice.id, {
      date: '2026-09-20',
      amount: 31.728,
      basis: 'handover',
      reference: 'Site handed over',
    });
    expect(second.totals.balance).toBe(1234.567);
    expect((await books(company)).byCode).toEqual({ '1100': 1_234_567, '4000': -1_234_567 });

    await expect(
      releaseRetention(invoice.id, {
        date: '2026-09-21',
        amount: 0.001,
        basis: 'handover',
        reference: '',
      }),
    ).rejects.toBeInstanceOf(RetentionError);

    const undone = await undoRetentionRelease(invoice.id, second.retentionReleases![1].id);
    expect(undone.totals.balance).toBe(1202.839);
    expect(heldRetention(undone)).toBe(31.728);
    const release = undone.retentionReleases![1];
    expect(release.reversedOn).toBe('2026-09-20');
    const reversal = (await db.journals.get(release.reversalJournalId!))!;
    expect(reversal).toMatchObject({ kind: 'retention_release', reversalOf: release.journalId });
    expect((await books(company)).byCode).toEqual({
      '1100': 1_202_839,
      '1110': 31_728,
      '4000': -1_234_567,
    });
  });

  it('is not undone once the released amount was paid', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client, 'invoice', 1000);
    await pay(company, invoice, 950);
    const released = await releaseRetention(invoice.id, {
      date: '2026-09-15',
      amount: 50,
      basis: 'handover',
      reference: '',
    });
    await pay(company, released, 50, '2026-09-16');
    await expect(
      undoRetentionRelease(invoice.id, released.retentionReleases![0].id),
    ).rejects.toThrow(/has been paid/);
  });

  it('respects the lock date', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client, 'invoice', 1000);
    await db.companies.put({
      ...company,
      accounting: { ...company.accounting!, lockDate: '2026-09-30' },
    });
    await expect(
      releaseRetention(invoice.id, {
        date: '2026-09-30',
        amount: 50,
        basis: 'handover',
        reference: '',
      }),
    ).rejects.toBeInstanceOf(LockedPeriodError);
    const released = await releaseRetention(invoice.id, {
      date: '2026-10-01',
      amount: 50,
      basis: 'handover',
      reference: '',
    });
    expect(released.totals.balance).toBe(1000);
  });

  it('keeps a document with releases in the books until they are undone', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client, 'invoice', 1000);
    const released = await releaseRetention(invoice.id, {
      date: '2026-09-15',
      amount: 50,
      basis: 'handover',
      reference: '',
    });
    const { deleteDocument, setDocumentStatus } = await import('./documents');
    await expect(setDocumentStatus(invoice.id, 'void')).rejects.toBeInstanceOf(RetentionError);
    await expect(setDocumentStatus(invoice.id, 'draft')).rejects.toBeInstanceOf(RetentionError);
    await expect(deleteDocument(invoice.id)).rejects.toBeInstanceOf(RetentionError);
    await undoRetentionRelease(invoice.id, released.retentionReleases![0].id);
    await setDocumentStatus(invoice.id, 'void');
    expect((await db.documents.get(invoice.id))!.status).toBe('void');
    expect((await books(company)).byCode).toEqual({});
  });

  it('leaves invoices without a retention as they were, negative ones too', async () => {
    const { company, client } = await kuwait({ retentionPercent: null });
    await issue(company, client, 'invoice', 250);
    await issue(company, client, 'invoice', -40);
    const ledger = await books(company);
    expect(ledger.byCode).toEqual({ '1100': 210_000, '4000': -210_000 });
  });

  it('cannot shrink below what was already released', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client, 'invoice', 1000);
    const released = await releaseRetention(invoice.id, {
      date: '2026-09-15',
      amount: 50,
      basis: 'handover',
      reference: '',
    });
    await expect(saveDocument({ ...released, retentionPercent: 2 })).rejects.toBeInstanceOf(
      RetentionError,
    );
    // An editor saving an older copy keeps the releases.
    const saved = await saveDocument({ ...invoice, notes: 'Phase 1' });
    expect(saved.retentionReleases).toHaveLength(1);
    expect(saved.totals.balance).toBe(1000);
  });
});

describe('retention in other charts', () => {
  it('creates the retentions account when a draft is sent', async () => {
    const company = await setupCompany({
      name: 'Gulf Works Ltd',
      currency: 'KWD',
      locale: 'en-GB',
      address: { line1: '', line2: '', city: '', state: '', postalCode: '', country: 'GB' },
    });
    const client = await saveClient(
      createClient(company.id, { name: 'Ministry', retentionPercent: 5, retentionKind: 'tax' }),
    );
    const draft = await draftDocument(company, 'invoice', client);
    draft.items[0] = { ...draft.items[0], name: 'Works', quantity: 1, unitPrice: 1000, taxes: [] };
    const saved = await saveDocument(draft);
    const { markSent } = await import('./documents');
    await markSent(saved.id);
    const { accounts, lines } = await books(company);
    const retention = accounts.find((a) => a.name === 'Retentions receivable')!;
    expect(retention).toMatchObject({ type: 'asset_current', role: null });
    expect(lines.filter((l) => l.accountId === retention.id).map((l) => l.amount)).toEqual([
      50_000,
    ]);
  });
});

describe('retention on bills', () => {
  it('holds back a contract retention in 2010 Retentions payable until handover', async () => {
    const { company, client } = await kuwait({ retentionPercent: 10, retentionKind: 'contract' });
    const bill = await issue(company, client, 'bill', 2000);
    expect(bill.totals).toMatchObject({ total: 2000, retention: 200, balance: 1800 });
    let ledger = await books(company);
    expect(ledger.byCode['2000']).toBe(-1_800_000);
    expect(ledger.byCode['2010']).toBe(-200_000);
    expect(ledger.total).toBe(0);

    await pay(company, bill, 1800);
    expect((await db.documents.get(bill.id))!.status).toBe('paid');
    const released = await releaseRetention(bill.id, {
      date: '2026-12-01',
      amount: 200,
      basis: 'handover',
      reference: 'Handover certificate HC-4',
    });
    expect(released.totals.balance).toBe(200);
    ledger = await books(company);
    expect(ledger.byCode['2000']).toBe(-200_000);
    expect(ledger.byCode['2010']).toBeUndefined();
  });
});

describe('clearance certificates', () => {
  it('stop the tax retention on documents dated while they are valid', async () => {
    const { company, client } = await kuwait();
    const withCertificate = await saveCertificate(
      client.id,
      newCertificate({ number: 'TC-2026-0042', issueDate: '2026-04-01', expiryDate: '2027-03-31' }),
      {
        name: 'certificate.pdf',
        type: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,JVBERi0=',
      },
    );
    const certificate = withCertificate.clearanceCertificates![0];
    expect(await db.attachments.where('ownerId').equals(certificate.id).count()).toBe(1);

    const covered = await draftDocument(company, 'invoice', withCertificate);
    covered.issueDate = '2026-10-01';
    const { retentionDefaults } = await import('@/lib/retention');
    expect(retentionDefaults(withCertificate, 'invoice', '2026-10-01').retentionPercent).toBe(0);
    expect(retentionDefaults(withCertificate, 'invoice', '2027-04-01').retentionPercent).toBe(5);
    expect(retentionDefaults(withCertificate, 'credit', '2027-04-01').retentionPercent).toBe(0);
    const contract = { ...withCertificate, retentionKind: 'contract' as const };
    expect(retentionDefaults(contract, 'bill', '2026-10-01').retentionPercent).toBe(5);

    await removeCertificate(client.id, certificate.id);
    expect((await db.clients.get(client.id))!.clearanceCertificates).toEqual([]);
    expect(await db.attachments.where('ownerId').equals(certificate.id).count()).toBe(0);
    await expect(
      saveCertificate(client.id, newCertificate({ number: ' ' })),
    ).rejects.toBeInstanceOf(RetentionError);
  });
});

describe('statement and ledger', () => {
  it('agree on what the customer owes', async () => {
    const { company, client } = await kuwait();
    const first = await issue(company, client, 'invoice', 1234.567, '2026-08-01');
    await issue(company, client, 'invoice', 800, '2026-09-05');
    await pay(company, first, 600, '2026-08-20');
    await releaseRetention(first.id, {
      date: '2026-09-25',
      amount: 61.728,
      basis: 'certificate',
      reference: 'TC-1',
    });
    const [documents, payments] = await Promise.all([
      db.documents.where('clientId').equals(client.id).toArray(),
      db.payments.where('clientId').equals(client.id).toArray(),
    ]);
    const statement = buildStatement({
      side: 'customer',
      documents,
      payments,
      from: '2026-09-01',
      to: '2026-09-30',
      currency: 'KWD',
    });
    const ledger = await books(company);
    const receivable = ledger.accounts.find((a) => a.role === 'receivable')!.id;
    const owed = ledger.lines
      .filter((l) => l.accountId === receivable && l.contactId === client.id)
      .reduce((s, l) => s + l.amount, 0);
    expect(statement.closing).toBe(owed);
    // The auditor pack's aging leaves out the retention still held, as the ledger does.
    const { agingAt } = await import('@/lib/reports');
    expect(agingAt(documents, payments, [client], '2026-09-30', 'invoice', 'KWD').total).toBe(owed);
    // 1,234.567 − 61.728 − 600 brought forward; 800 − 40 and the release in September.
    expect(statement.opening).toBe(572_839);
    expect(statement.closing).toBe(572_839 + 760_000 + 61_728);
    expect(statement.retentionHeld).toBe(40_000);
    expect(ledger.byCode['1110']).toBe(40_000);
  });
});
