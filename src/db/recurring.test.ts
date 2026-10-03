import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient, createRecurring } from './defaults';
import { generateDueInvoices } from './recurring';
import { saveClient, setupCompany } from './records';
import {
  datePlaceholderExamples,
  placeholderLocale,
  replaceDatePlaceholders,
} from '@/lib/placeholders';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('date placeholders', () => {
  it('replaces month, quarter and year with offsets', () => {
    expect(replaceDatePlaceholders('Services for :MONTH :YEAR', '2026-03-15')).toBe(
      'Services for March 2026',
    );
    expect(replaceDatePlaceholders('Retainer :MONTH+1', '2026-12-01')).toBe('Retainer January');
    expect(replaceDatePlaceholders(':QUARTER :YEAR-1', '2026-08-01')).toBe('Q3 2025');
    expect(replaceDatePlaceholders(':MONTHYEAR', '2026-10-02', 'en-GB')).toBe('October 2026');
    expect(replaceDatePlaceholders('Time: 10:30', '2026-10-02')).toBe('Time: 10:30');
  });

  it('writes month names in the document language', () => {
    const arabic = placeholderLocale('ar', 'en-KW');
    expect(replaceDatePlaceholders(':MONTHYEAR · :QUARTER', '2026-10-02', arabic)).toBe(
      'أكتوبر 2026 · الربع 4',
    );
    expect(placeholderLocale('ar-en', 'en-GB')).toBe('en-GB');
    expect(placeholderLocale('en', 'fr-FR')).toBe('en');
    expect(placeholderLocale('fr', 'en-KW')).toBe('fr');
    expect(datePlaceholderExamples('2026-10-02', 'en-GB')).toContainEqual({
      token: ':MONTH+1',
      example: 'November',
    });
  });
});

describe('recurring invoices', () => {
  it('issues all missed periods and stops after the last cycle', async () => {
    const company = await setupCompany({ name: 'Acme', currency: 'USD', locale: 'en-US' });
    const client = await saveClient(createClient(company.id, { name: 'Client' }));
    await db.recurring.put(
      createRecurring(company.id, {
        id: 'r1',
        clientId: client.id,
        name: 'Retainer',
        frequency: 'monthly',
        startDate: '2026-01-31',
        nextIssueDate: '2026-01-31',
        remainingCycles: 3,
        dueDays: 14,
        markSent: true,
        template: {
          ...createRecurring(company.id).template,
          items: [
            {
              id: 'i1',
              kind: 'item',
              productId: null,
              name: 'Support — :MONTH :YEAR',
              description: '',
              quantity: 1,
              unit: '',
              unitPrice: 500,
              discount: 0,
              discountType: 'percent',
              taxes: [],
            },
          ],
        },
      }),
    );

    const created = await generateDueInvoices(company.id, '2026-04-15');
    expect(created).toHaveLength(3);
    expect(created.map((d) => d.issueDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(created[1].items[0].name).toBe('Support — February 2026');
    expect(created[1].dueDate).toBe('2026-03-14');
    const stored = await db.documents.get(created[0].id);
    expect(stored?.status).toBe('sent');
    expect(stored?.recurringId).toBe('r1');

    const profile = await db.recurring.get('r1');
    expect(profile).toMatchObject({
      status: 'completed',
      remainingCycles: 0,
      issuedCount: 3,
      nextIssueDate: null,
    });
    expect(await generateDueInvoices(company.id, '2026-12-31')).toHaveLength(0);
  });

  it('fills in Arabic month names for a client who gets Arabic documents', async () => {
    const company = await setupCompany({ name: 'Acme', currency: 'KWD', locale: 'en-KW' });
    const client = await saveClient(createClient(company.id, { name: 'Client', language: 'ar' }));
    const base = createRecurring(company.id);
    await db.recurring.put(
      createRecurring(company.id, {
        clientId: client.id,
        startDate: '2026-02-01',
        nextIssueDate: '2026-02-01',
        remainingCycles: 1,
        template: {
          ...base.template,
          items: [
            {
              id: 'i1',
              kind: 'item',
              productId: null,
              name: 'دعم فني — :MONTH :YEAR',
              description: '',
              quantity: 1,
              unit: '',
              unitPrice: 50,
              discount: 0,
              discountType: 'percent',
              taxes: [],
            },
          ],
        },
      }),
    );
    const [invoice] = await generateDueInvoices(company.id, '2026-02-10');
    expect(invoice.items[0].name).toBe('دعم فني — فبراير 2026');
  });

  it('skips paused profiles and future dates', async () => {
    const company = await setupCompany({ name: 'Acme', currency: 'USD', locale: 'en-US' });
    const client = await saveClient(createClient(company.id, { name: 'Client' }));
    await db.recurring.bulkPut([
      createRecurring(company.id, {
        clientId: client.id,
        status: 'paused',
        startDate: '2026-01-01',
        nextIssueDate: '2026-01-01',
      }),
      createRecurring(company.id, {
        clientId: client.id,
        startDate: '2026-09-01',
        nextIssueDate: '2026-09-01',
      }),
    ]);
    expect(await generateDueInvoices(company.id, '2026-05-01')).toHaveLength(0);
  });
});
