import { afterEach, describe, expect, it } from 'vitest';
import { loadLanguage } from '@/i18n';
import { alertLookups, collectAlerts, type Alert } from './collect';
import {
  MAX_CHANGES_PER_PERSON,
  MAX_PER_TOPIC,
  renderAlertEmail,
  renderChangesEmail,
  safeAppUrl,
  type ChangesEmailInput,
} from './email';
import type { AlertEmailInput } from './email';
import type { ChangeEvent } from '@/cloud/api';
import { sampleData, TODAY } from './testing';

afterEach(async () => {
  await loadLanguage('en');
});

function input(overrides: Partial<AlertEmailInput> = {}): AlertEmailInput {
  const data = sampleData();
  return {
    kind: 'first',
    company: data.company,
    alerts: collectAlerts(data, TODAY),
    newKeys: null,
    appUrl: 'https://books.example.com/',
    to: 'owner@example.com',
    ...alertLookups(data),
    ...overrides,
  };
}

/** The HTML without tags, to read it like text. */
const visible = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

/** Amounts keep their figure and currency together with a no-break space. */
const plain = (text: string) => text.replace(/\u00a0/g, ' ');

describe('the alerts email', () => {
  it('lists every topic with its lines, amounts and a button to the app', () => {
    const email = renderAlertEmail(input());
    expect(email.subject).toBe('Acme Trading: 12 things need attention');
    const text = visible(email.html);
    for (const part of [
      'Maham One',
      'Email alerts are on for Acme Trading.',
      'Papers and licences (4)',
      'Civil ID · Noura Salem',
      'Expired on 01/10/2026 · 5 days ago',
      'Residency · Ravi Kumar',
      'Expires in 25 days',
      'Commercial licence · Acme Trading',
      'Deadlines (1)',
      'Due 15/10/2026',
      'Cheques (3)',
      'Cheque CHQ-LATE from Gulf Hotel',
      'Not deposited yet',
      'Cheque CHQ-OUT to Paper Supplies',
      'To be cashed',
      'Bills to pay (2)',
      'Bill PS-881 · Paper Supplies',
      '5 days late',
      'Overdue invoices (2)',
      'Invoice INV-LATE · Gulf Hotel',
      '6 days overdue',
      'Total KD 370.500',
      'Sent to owner@example.com.',
    ]) {
      expect(text).toContain(part);
    }
    expect(email.html).toContain('href="https://books.example.com/"');
    expect(email.html).toContain('<html lang="en" dir="ltr">');
    expect(email.text).toContain('Open Maham One: https://books.example.com/');
    expect(plain(email.text)).toContain(
      '- Invoice INV-LATE · Gulf Hotel · 6 days overdue · KD 250.000',
    );
  });

  it('never shows the numbers of employees’ papers', () => {
    const email = renderAlertEmail(input());
    for (const number of ['290010100002', '290010100003', 'R-1']) {
      expect(email.html).not.toContain(number);
      expect(email.text).not.toContain(number);
    }
  });

  it('escapes what comes from the records', () => {
    const data = sampleData();
    data.clients[0] = { ...data.clients[0], name: '<img src=x onerror=alert(1)> & Co' };
    data.company.name = 'Acme "Trading" <b>';
    const email = renderAlertEmail(
      input({ company: data.company, ...alertLookups(data), appUrl: 'javascript:alert(1)' }),
    );
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; Co');
    expect(email.html).toContain('Acme &quot;Trading&quot; &lt;b&gt;');
    expect(email.html).not.toContain('javascript:');
    expect(email.html).not.toContain('Open Maham One');
  });

  it('marks what is new since the last email, first', () => {
    const all = input().alerts;
    const fresh = new Set([
      'invoices:inv-partial:2026-10-05:overdue',
      'documents:doc:licence:2026-12-01:60d',
    ]);
    const email = renderAlertEmail(input({ kind: 'new', newKeys: fresh }));
    expect(email.subject).toBe('Acme Trading: 2 new alerts');
    expect(visible(email.html)).toContain(
      'Good morning. 2 new things need attention in Acme Trading.',
    );
    // The new invoice comes before the older one.
    const html = email.html;
    expect(html.indexOf('INV-PARTIAL')).toBeLessThan(html.indexOf('INV-LATE'));
    expect(email.text).toContain('- [New] Invoice INV-PARTIAL · Gulf Hotel');
    expect(email.text).toContain('- [New] Commercial licence · Acme Trading');
    expect(email.text.match(/\[New\]/g)).toHaveLength(2);
    expect(all).toHaveLength(12);
  });

  it('lists ten lines a topic and counts the rest', () => {
    const base = input();
    const invoice = base.alerts.find((a) => a.topic === 'invoices') as Alert;
    const many: Alert[] = Array.from({ length: MAX_PER_TOPIC + 3 }, (_, i) => ({
      ...invoice,
      key: `invoices:x${i}:2026-09-30:overdue`,
    }));
    const email = renderAlertEmail(input({ alerts: many }));
    expect(email.text.match(/^- Invoice/gm)).toHaveLength(MAX_PER_TOPIC);
    expect(email.text).toContain('And 3 more in Maham One.');
    expect(email.subject).toBe('Acme Trading: 13 things need attention');
  });

  it('says so when nothing needs attention', () => {
    const email = renderAlertEmail(input({ kind: 'now', alerts: [] }));
    expect(email.subject).toBe('Acme Trading: nothing needs attention');
    expect(email.text).toContain('Nothing needs attention in Acme Trading right now.');
  });

  it('shows the Maham One logo from the app’s own address, or its name without one', () => {
    const email = renderAlertEmail(input());
    expect(email.html).toContain(
      '<img src="https://books.example.com/brand/maham-one-logo-email.png" alt="Maham One" width="151" height="40"',
    );
    const unsafe = renderAlertEmail(input({ appUrl: 'javascript:alert(1)' }));
    expect(unsafe.html).not.toContain('<img');
    expect(visible(unsafe.html)).toContain('Maham One');
  });

  it('is written right to left in Arabic', async () => {
    await loadLanguage('ar');
    const email = renderAlertEmail(input({ kind: 'weekly' }));
    expect(email.subject).toBe('أكمي للتجارة: 12 أمراً تحتاج إلى متابعة');
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
    const text = visible(email.html);
    for (const part of [
      'مهام ون',
      'صباح الخير. هذا ملخصك الأسبوعي لما لا يزال يحتاج إلى متابعة في أكمي للتجارة.',
      'الوثائق والتراخيص (4)',
      'نورة سالم',
      'فندق الخليج',
      'فتح مهام ون',
    ]) {
      expect(text).toContain(part);
    }
    // Interface words are all in Arabic.
    for (const english of ['Papers', 'Cheque', 'Invoice', 'Bill ', 'Due ', 'Open ', 'Sent to']) {
      expect(text).not.toContain(english);
    }
  });
});

describe('safeAppUrl', () => {
  it('keeps web addresses only', () => {
    expect(safeAppUrl(' https://books.example.com/ ')).toBe('https://books.example.com/');
    expect(safeAppUrl('http://localhost:5173/')).toBe('http://localhost:5173/');
    expect(safeAppUrl('javascript:alert(1)')).toBe('');
    expect(safeAppUrl('https://x.example.com/"><script>')).toBe('');
    expect(safeAppUrl('')).toBe('');
  });
});

describe('the email of changes by the team', () => {
  let seq = 0;
  const change = (overrides: Partial<ChangeEvent> = {}): ChangeEvent => {
    seq += 1;
    return {
      id: seq,
      at: '2026-10-06T07:05:00.000Z',
      actor: 'user-sara',
      actorName: 'Sara Made-up',
      subjectName: '',
      kind: 'document',
      op: 'update',
      tbl: 'documents',
      recordId: `doc-${seq}`,
      count: 1,
      important: true,
      private: false,
      summary: {
        what: 'voided',
        type: 'invoice',
        number: `INV-${seq}`,
        total: 120,
        currency: 'KWD',
        client: 'Gulf Hotel',
        clientAr: 'فندق الخليج',
      },
      unread: true,
      ...overrides,
    };
  };
  const changesInput = (overrides: Partial<ChangesEmailInput> = {}): ChangesEmailInput => ({
    kind: 'immediate',
    company: sampleData().company,
    events: [
      change(),
      change({ important: false, kind: 'contact', tbl: 'clients', count: 12, op: 'mixed' }),
      change({
        actor: 'user-ali',
        actorName: 'Ali Made-up',
        kind: 'cheque',
        tbl: 'payments',
        summary: { what: 'returned', cheque: '100200', amount: 250, currency: 'KWD' },
      }),
      change({
        actor: 'user-ali',
        actorName: 'Ali Made-up',
        kind: 'people',
        tbl: 'payRuns',
        private: true,
        summary: { what: 'paid', status: 'paid', period: '2026-09' },
      }),
    ],
    appUrl: 'https://books.example.com/',
    to: 'owner@example.com',
    ...overrides,
  });

  it('groups the changes by who made them, important ones each, the rest counted', () => {
    const email = renderChangesEmail(changesInput());
    expect(email.subject).toBe('Acme Trading: 3 important changes by your team');
    const text = plain(visible(email.html));
    for (const part of [
      'Acme Trading',
      'Your team made changes in Acme Trading that you asked to hear about at once.',
      'Sara Made-up (13)',
      'Voided invoice INV-',
      'Gulf Hotel · KD 120.000',
      '12 changes to customers and vendors',
      'Ali Made-up (2)',
      'Marked cheque 100200 as returned',
      'Marked the pay run for 2026-09 as paid',
      'Open Updates',
      'at most one email every 15 minutes and 20 a day',
      'Sent to owner@example.com.',
    ]) {
      expect(text).toContain(part);
    }
    // The button opens Updates in the app; times are Kuwait's.
    expect(email.html).toContain('href="https://books.example.com/#/notifications"');
    expect(text).toContain('10:05');
    expect(email.text).toContain('- Voided invoice INV-');
  });

  it('sums up the morning, and lists at most ten important changes a person', () => {
    const many = Array.from({ length: MAX_CHANGES_PER_PERSON + 3 }, () => change());
    const email = renderChangesEmail(changesInput({ kind: 'daily', events: many }));
    expect(email.subject).toBe('Acme Trading: 13 changes by your team');
    expect(email.text).toContain(
      'Good morning. This is what your team changed in Acme Trading since the last email.',
    );
    expect(email.text.match(/- Voided invoice/g)).toHaveLength(MAX_CHANGES_PER_PERSON);
    expect(email.text).toContain('And 3 more in Maham One.');
  });

  it('escapes what comes from the records, and keeps payroll anonymous', () => {
    const email = renderChangesEmail(
      changesInput({
        events: [
          change({
            actorName: '<b>Someone</b>',
            summary: { what: 'voided', type: 'invoice', number: '<i>1</i>' },
          }),
          change({
            tbl: 'employees',
            kind: 'people',
            private: true,
            summary: { what: 'added', name: 'Made-up Person', amount: 900 },
          }),
        ],
      }),
    );
    expect(email.html).not.toContain('<b>Someone</b>');
    expect(email.html).toContain('&lt;b&gt;Someone&lt;/b&gt;');
    expect(email.html).not.toContain('Made-up Person');
    expect(email.html).not.toContain('900');
  });

  it('is in Arabic for Arabic readers, right to left', async () => {
    await loadLanguage('ar');
    const email = renderChangesEmail(changesInput());
    expect(email.subject).toBe('أكمي للتجارة: 3 تغييرات مهمة من فريقك');
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
    const text = visible(email.html);
    for (const part of ['إبطال فاتورة', 'فندق الخليج', 'فتح المستجدات', 'تغييرات الفريق']) {
      expect(text).toContain(part);
    }
    for (const english of ['Voided', 'Open ', 'Sent to', 'changes to']) {
      expect(text).not.toContain(english);
    }
  });
});
