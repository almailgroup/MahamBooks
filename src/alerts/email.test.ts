import { afterEach, describe, expect, it } from 'vitest';
import { loadLanguage } from '@/i18n';
import { alertLookups, collectAlerts, type Alert } from './collect';
import { MAX_PER_TOPIC, renderAlertEmail, safeAppUrl, type AlertEmailInput } from './email';
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
      'Maham Books',
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
    expect(email.text).toContain('Open Maham Books: https://books.example.com/');
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
    expect(email.html).not.toContain('Open Maham Books');
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
    expect(email.text).toContain('And 3 more in Maham Books.');
    expect(email.subject).toBe('Acme Trading: 13 things need attention');
  });

  it('says so when nothing needs attention', () => {
    const email = renderAlertEmail(input({ kind: 'now', alerts: [] }));
    expect(email.subject).toBe('Acme Trading: nothing needs attention');
    expect(email.text).toContain('Nothing needs attention in Acme Trading right now.');
  });

  it('is written right to left in Arabic', async () => {
    await loadLanguage('ar');
    const email = renderAlertEmail(input({ kind: 'weekly' }));
    expect(email.subject).toBe('أكمي للتجارة: 12 أمراً تحتاج إلى متابعة');
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
    const text = visible(email.html);
    for (const part of [
      'مهام بوكس',
      'صباح الخير. هذا ملخصك الأسبوعي لما لا يزال يحتاج إلى متابعة في أكمي للتجارة.',
      'الوثائق والتراخيص (4)',
      'نورة سالم',
      'فندق الخليج',
      'فتح مهام بوكس',
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
