import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { createClient, createRecurring } from './defaults';
import { generateDueInvoices, issueNow, lockedOutBy, RecurringError } from './recurring';
import { saveClient, setupCompany } from './records';
import type { Company, RecurringProfile } from './types';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 5, 15));
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.useRealTimers();
});

function profile(company: Company, clientId: string, overrides: Partial<RecurringProfile>) {
  return createRecurring(company.id, {
    clientId,
    name: 'Retainer',
    frequency: 'monthly',
    remainingCycles: null,
    dueDays: 14,
    markSent: true,
    template: {
      ...createRecurring(company.id).template,
      currency: 'KWD',
      items: [
        {
          id: 'i1',
          kind: 'item',
          productId: null,
          name: 'Support :MONTH',
          description: '',
          quantity: 1,
          unit: '',
          unitPrice: 250,
          discount: 0,
          discountType: 'percent',
          taxes: [],
        },
      ],
    },
    ...overrides,
  });
}

async function setup() {
  const company = await setupCompany({ name: 'Review Co' });
  const client = await saveClient(createClient(company.id, { name: 'Sample Client' }));
  return { company, client };
}

async function lock(company: Company, date: string) {
  await db.companies.update(company.id, {
    accounting: { ...company.accounting!, lockDate: date },
  });
  return (await db.companies.get(company.id))!;
}

describe('recurring invoices due in a locked period', () => {
  it('create nothing and leave the profile as it is, however often the app opens', async () => {
    const { company, client } = await setup();
    const may = profile(company, client.id, {
      id: 'r1',
      startDate: '2026-05-01',
      nextIssueDate: '2026-05-01',
    });
    await db.recurring.put(may);
    // May was closed before anyone opened the app again.
    const locked = await lock(company, '2026-05-31');
    expect(lockedOutBy(may, locked)).toBe('2026-05-31');
    for (let open = 0; open < 3; open++) {
      expect(await generateDueInvoices(company.id, '2026-06-15')).toEqual([]);
    }
    expect(await db.documents.where('companyId').equals(company.id).count()).toBe(0);
    expect(await db.recurring.get('r1')).toEqual(may);
    // Asked for by hand, it says why.
    await expect(issueNow('r1')).rejects.toThrow(RecurringError);
    await expect(issueNow('r1')).rejects.toThrow(/locked up to/);
    expect(await db.documents.where('companyId').equals(company.id).count()).toBe(0);
  });

  it('don’t stop the other profiles', async () => {
    const { company, client } = await setup();
    await db.recurring.bulkPut([
      profile(company, client.id, {
        id: 'r1',
        startDate: '2026-05-01',
        nextIssueDate: '2026-05-01',
      }),
      profile(company, client.id, {
        id: 'r2',
        startDate: '2026-06-01',
        nextIssueDate: '2026-06-01',
      }),
    ]);
    await lock(company, '2026-05-31');
    const created = await generateDueInvoices(company.id, '2026-06-15');
    expect(created.map((d) => d.issueDate)).toEqual(['2026-06-01']);
    expect(created[0].status).toBe('sent');
    expect((await db.recurring.get('r2'))?.nextIssueDate).toBe('2026-07-01');
  });
});

describe('issuing a recurring invoice', () => {
  it('saves, sends and moves the profile on together, or not at all', async () => {
    const { company, client } = await setup();
    await db.recurring.bulkPut([
      profile(company, client.id, {
        id: 'r1',
        startDate: '2026-06-01',
        nextIssueDate: '2026-06-01',
      }),
      profile(company, client.id, {
        id: 'r2',
        startDate: '2026-06-02',
        nextIssueDate: '2026-06-02',
      }),
    ]);
    const counter = (await db.companies.get(company.id))!.numbering.invoice;
    // Moving profile r1 on fails (after its invoice was saved and sent).
    const failing = (_changes: unknown, key: unknown) => {
      if (key === 'r1') throw new Error('Disk full');
    };
    db.recurring.hook('updating', failing);
    try {
      const created = await generateDueInvoices(company.id, '2026-06-15');
      // r1 left nothing behind; r2 was not held up by it.
      expect(created.map((d) => d.issueDate)).toEqual(['2026-06-02']);
    } finally {
      db.recurring.hook('updating').unsubscribe(failing);
    }
    const invoices = await db.documents.where('companyId').equals(company.id).toArray();
    expect(invoices.map((d) => d.issueDate)).toEqual(['2026-06-02']);
    expect((await db.recurring.get('r1'))?.issuedCount).toBe(0);
    // The number r1's invoice took was given back.
    expect(invoices[0].number).toBe(
      `INV-2026-${String(counter.next).padStart(counter.padding, '0')}`,
    );
  });
});
