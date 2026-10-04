import { db } from '../db';
import { createRecurring } from '../defaults';
import { setDocumentStatus } from '../documents';
import { setPaymentLink } from '../payments';
import {
  clearCheque,
  createSecurityCheque,
  depositCheque,
  replaceCheque,
  returnCheque,
  saveSecurityCheque,
} from '../cheques';
import { heldRetention, newCertificate, releaseRetention, saveCertificate } from '../retention';
import { setCreditHold } from '../credit';
import { issueNow } from '../recurring';
import { recordStockEntry } from '../inventory';
import { createComplianceDocument, saveComplianceDocument } from '../renewals';
import type { ID, ISODate, InvoiceDocument, LineItem, Payment, PaymentMethod } from '../types';
import { addDaysISO, parseISODate } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { KUWAIT_WEEKEND } from '@/lib/kuwait';
import type { DemoBooks } from './books';
import type { Timeline } from './calendar';
import { both, CUSTOMERS, type ItemKey } from './data';

/** The next working day on or after a date (cheques are deposited on working days). */
export function nextWorkday(date: ISODate): ISODate {
  let d = date;
  while (KUWAIT_WEEKEND.includes(parseISODate(d).getDay())) d = addDaysISO(d, 1);
  return d;
}

const dmy = (date: ISODate) => formatDate(date, 'dd/MM/yyyy', 'en-GB');

/**
 * A received cheque's life: presented on its date (or the next working day)
 * and cleared, as far as today has come. `depositOnly` leaves it at the
 * bank, waiting to clear.
 */
export function chequeClears(
  books: DemoBooks,
  tl: Timeline,
  payment: () => Payment | undefined,
  chequeDate: ISODate,
  options: { into?: 'nbk' | 'kfh'; depositOnly?: boolean } = {},
) {
  const presented = nextWorkday(chequeDate);
  tl.at(presented, 'cheque presented', async () => {
    const p = payment();
    if (!p) return;
    const input = { date: presented, bankAccountId: books.money(options.into ?? 'nbk') };
    if (options.depositOnly) await depositCheque(p.id, input);
    else await clearCheque(p.id, input);
  });
}

/** Quantities of an order's item lines, by the item they carry. */
function quantitiesOf(
  order: InvoiceDocument,
  books: DemoBooks,
  wanted: Partial<Record<ItemKey, number>>,
): Record<ID, number> {
  const out: Record<ID, number> = {};
  for (const line of order.items) {
    if (line.kind !== 'item') continue;
    const key = books.itemKey(line.productId);
    out[line.id] = key ? (wanted[key] ?? 0) : 0;
  }
  return out;
}

export function salesStory(books: DemoBooks, tl: Timeline): void {
  ministry(books, tl);
  bawaba(books, tl);
  naseem(books, tl);
  bayan(books, tl);
  sanabel(books, tl);
  hotel(books, tl);
  sadu(books, tl);
  marina(books, tl);
  oasis(books, tl);
  individuals(books, tl);
  sahel(books, tl);
  showroom(books, tl);
}

/* -------------------------------------------------------------------------- */
/* Ministry of Education: quarterly maintenance with the 5% tax retention     */
/* -------------------------------------------------------------------------- */

function ministry(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  const quarters = [-12, -9, -6, -3, 0];
  const invoices: InvoiceDocument[] = [];
  let certificateNumber = '';
  quarters.forEach((m, n) => {
    const date = cal.workdayOf(m, 7);
    const from = cal.monthStart(m);
    const to = cal.monthEnd(m + 2);
    tl.at(date, `ministry invoice ${n + 1}`, async () => {
      const invoice = await books.document(
        'invoice',
        books.customers.ministry,
        date,
        [books.line('schoolMaintenance', 1)],
        {
          poNumber: 'MOE/HEZ/MC/114',
          notes:
            `عقد صيانة الأنظمة الكهربائية لمدارس المنطقة – الفترة من ${dmy(from)} إلى ${dmy(to)}\n` +
            `School electrical maintenance contract – period ${dmy(from)} to ${dmy(to)}`,
        },
      );
      invoices[n] = invoice;
    });
    // The Ministry of Finance pays what is due (95% while the retention is held) about 70 days later.
    if (m <= -6) {
      const paid = cal.workday(addDaysISO(date, 70));
      tl.at(paid, `ministry pays invoice ${n + 1}`, async () => {
        await books.receive(invoices[n], {
          date: paid,
          method: 'bank_transfer',
          reference: `MOF TRF ${String(55_821 + n * 137)}`,
        });
      });
    }
  });

  // The clearance certificate arrives; the retentions held so far are released.
  const issued = cal.workdayOf(-3, 9);
  tl.at(issued, 'clearance certificate', async () => {
    certificateNumber = `TC-${issued.slice(0, 4)}-018834`;
    const expiry = addDaysISO(issued, 364);
    await saveCertificate(
      books.customers.ministry.id,
      newCertificate({
        number: certificateNumber,
        issueDate: issued,
        expiryDate: expiry,
        notes:
          'Our Ministry of Finance clearance certificate, given to the Hawalli zone.\n' +
          'شهادة براءة الذمة من وزارة المالية، سُلّمت لمنطقة حولي التعليمية.',
      }),
    );
    await saveComplianceDocument(
      createComplianceDocument(books.id, {
        type: 'tax_clearance',
        number: certificateNumber,
        issuer: both('Ministry of Finance', 'وزارة المالية'),
        issueDate: issued,
        expiryDate: expiry,
        renewalCost: 0,
        ownerType: 'company',
      }),
    );
  });
  const release = cal.workdayOf(-3, 13);
  tl.at(release, 'retentions released', async () => {
    for (const invoice of invoices.filter(Boolean)) {
      const doc = (await db.documents.get(invoice.id))!;
      const held = heldRetention(doc);
      if (held > 0) {
        await releaseRetention(doc.id, {
          date: release,
          amount: held,
          basis: 'certificate',
          reference: certificateNumber,
        });
      }
    }
  });
  // The released retentions of the paid invoices come in one transfer.
  const settled = cal.workdayOf(-2, 17);
  tl.at(settled, 'released retentions paid', async () => {
    await books.receive(invoices.slice(0, 3), {
      date: settled,
      method: 'bank_transfer',
      reference: 'MOF TRF RETENTION RELEASE',
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Al Bawaba Construction: a tower contract billed in stages, 10% retention    */
/* -------------------------------------------------------------------------- */

const BAWABA_STAGES: { month: number; goods: Partial<Record<ItemKey, number>>; works: number }[] = [
  { month: -11, goods: { panel: 300, downlight: 800, cable: 40, switches: 120 }, works: 0.25 },
  {
    month: -8,
    goods: { panel: 300, downlight: 800, flood: 30, cable: 40, switches: 140 },
    works: 0.3,
  },
  {
    month: -5,
    goods: { panel: 200, downlight: 600, flood: 20, cable: 30, switches: 100 },
    works: 0.25,
  },
  {
    month: -2,
    goods: { panel: 100, downlight: 200, flood: 10, cable: 10, switches: 40 },
    works: 0.1,
  },
];

function bawaba(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  const site =
    'برج البوابة، شرق، قطعة 6، شارع أحمد الجابر\nAl Bawaba Tower, Sharq, Block 6, Ahmad Al-Jaber Street';
  let quote: InvoiceDocument;
  let order: InvoiceDocument;
  const quoted = cal.workdayOf(-12, 4);
  tl.at(quoted, 'Al Bawaba quote', async () => {
    quote = await books.document(
      'quote',
      books.customers.bawaba,
      quoted,
      [
        books.heading('Supply of lighting and wiring materials', 'توريد مواد الإنارة والتمديدات'),
        books.line('panel', 900, { unitPrice: 6.25 }),
        books.line('downlight', 2400, { unitPrice: 2.05 }),
        books.line('flood', 60, { unitPrice: 13.9 }),
        books.line('cable', 120, { unitPrice: 18 }),
        books.line('switches', 400, { unitPrice: 4.25 }),
        books.heading('Installation', 'التركيب'),
        books.line('installWorks', 1),
      ],
      { deliveryPlace: site },
    );
  });
  const accepted = cal.workdayOf(-12, 11);
  tl.at(accepted, 'Al Bawaba accepts', async () => {
    await setDocumentStatus(quote.id, 'accepted');
    order = await books.convert(quote, 'sales_order', accepted, {
      poNumber: 'LPO-BWB-2291',
      deliveryPlace: site,
    });
    // A guarantee cheque for the credit facility, kept in the memo register.
    await saveSecurityCheque(
      createSecurityCheque(books.id, {
        direction: 'in',
        clientId: books.customers.bawaba.id,
        number: '100198',
        bank: 'GULB',
        amount: 5000,
        drawer: CUSTOMERS.bawaba.name,
        purpose: both(
          'Guarantee for the credit on the Al Bawaba Tower contract',
          'ضمان للتسهيلات الائتمانية في عقد برج البوابة',
        ),
      }),
    );
  });

  BAWABA_STAGES.forEach((stage, n) => {
    const delivered = cal.workdayOf(stage.month, 20);
    const invoiced = cal.workdayOf(stage.month, 25);
    let invoice: InvoiceDocument;
    let cheque: Payment | undefined;
    tl.at(delivered, `Al Bawaba delivery ${n + 1}`, async () => {
      const note = await books.fromOrder(
        order,
        'delivery_note',
        delivered,
        quantitiesOf(order, books, stage.goods),
      );
      await books.delivered(note, delivered, 'Eng. Tariq Haddad', '279110903114');
    });
    tl.at(invoiced, `Al Bawaba progress invoice ${n + 1}`, async () => {
      invoice = await books.fromOrder(
        order,
        'invoice',
        invoiced,
        quantitiesOf(order, books, { ...stage.goods, installWorks: stage.works }),
        {
          notes: `مستخلص رقم ${n + 1}\nProgress invoice no. ${n + 1}`,
        },
      );
    });
    // Paid by a post-dated cheque for what is due (the retention stays held).
    const received = cal.workdayOf(stage.month + 1, 12);
    const chequeDate = addDaysISO(invoiced, 50);
    tl.at(received, `Al Bawaba cheque ${n + 1}`, async () => {
      cheque = await books.receive(invoice, {
        date: received,
        method: 'cheque',
        reference: `${100_231 + n}`,
        cheque: {
          number: `${100_231 + n}`,
          bank: 'GULB',
          date: chequeDate,
          drawer: CUSTOMERS.bawaba.name,
        },
      });
    });
    chequeClears(books, tl, () => cheque, chequeDate);
  });
}

/* -------------------------------------------------------------------------- */
/* Al Naseem Real Estate: two CCTV projects, one cheque returned and replaced  */
/* -------------------------------------------------------------------------- */

function naseem(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  const client = () => books.customers.naseem;
  const drawer = CUSTOMERS.naseem.name;

  // Maintenance of the company's six buildings, invoiced each quarter and paid by transfer.
  [-10, -7, -4, -1].forEach((m, n) => {
    const date = cal.workdayOf(m, 10);
    let invoice: InvoiceDocument;
    tl.at(date, `Al Naseem maintenance ${n + 1}`, async () => {
      invoice = await books.document(
        'invoice',
        client(),
        date,
        [books.line('buildingMaintenance', 1)],
        {
          poNumber: 'NRE-AMC-2025-06',
        },
      );
    });
    {
      const paid = cal.workday(addDaysISO(date, 34));
      tl.at(paid, `Al Naseem maintenance ${n + 1} paid`, async () => {
        await books.receive(invoice, {
          date: paid,
          method: 'bank_transfer',
          reference: `NRE TRF ${String(8831 + n * 41)}`,
        });
      });
    }
  });

  // A building in Mahboula, early in the year: paid with two cheques that cleared.
  let quote1: InvoiceDocument;
  let order1: InvoiceDocument;
  let invoice1: InvoiceDocument;
  const q1 = cal.workdayOf(-12, 2);
  tl.at(q1, 'Al Naseem quote 1', async () => {
    quote1 = await books.document('quote', client(), q1, [
      books.line('survey', 1, { unitPrice: 150 }),
      books.line('camera', 48, { unitPrice: 29.5 }),
      books.line('nvr', 4, { unitPrice: 92 }),
      books.line('cable', 10, { unitPrice: 18.5 }),
      books.line('cctvInstall', 48, { unitPrice: 12 }),
    ]);
  });
  const o1 = cal.workdayOf(-12, 5);
  tl.at(o1, 'Al Naseem order 1', async () => {
    await setDocumentStatus(quote1.id, 'accepted');
    order1 = await books.convert(quote1, 'sales_order', o1, {
      poNumber: 'NRE-PO-1873',
      deliveryPlace: 'عمارة النسيم، المهبولة، قطعة 2\nAl Naseem Building, Mahboula, Block 2',
    });
  });
  const d1 = cal.workdayOf(-12, 14);
  tl.at(d1, 'Al Naseem delivery 1', async () => {
    const note = await books.fromOrder(
      order1,
      'delivery_note',
      d1,
      quantitiesOf(order1, books, { camera: 48, nvr: 4, cable: 10 }),
    );
    await books.delivered(note, d1, 'Bader Al-Enezi');
  });
  const i1 = cal.workdayOf(-12, 16);
  tl.at(i1, 'Al Naseem invoice 1', async () => {
    invoice1 = await books.fromOrder(order1, 'invoice', i1);
  });
  const r1 = cal.workdayOf(-12, 22);
  const cheques1: (Payment | undefined)[] = [];
  [cal.day(-11, 15), cal.day(-10, 15)].forEach((date, n) => {
    tl.at(r1, `Al Naseem cheque ${n + 1}`, async () => {
      const total = (await db.documents.get(invoice1.id))!.totals.total;
      cheques1[n] = await books.receive(invoice1, {
        date: r1,
        method: 'cheque',
        amount: Math.round((total / 2) * 1000) / 1000,
        reference: `00${4302 + n}`,
        cheque: { number: `00${4302 + n}`, bank: 'NBOK', date, drawer },
      });
    });
    chequeClears(books, tl, () => cheques1[n], date);
  });

  // A building in Salmiya, recently: the first cheque came back unpaid.
  let quote2: InvoiceDocument;
  let order2: InvoiceDocument;
  let invoice2: InvoiceDocument;
  let first: Payment | undefined;
  let second: Payment | undefined;
  tl.at(cal.ago(78), 'Al Naseem quote 2', async () => {
    quote2 = await books.document('quote', client(), cal.workday(cal.ago(78)), [
      books.line('survey', 1, { unitPrice: 150 }),
      books.line('camera', 36, { unitPrice: 30 }),
      books.line('nvr', 2, { unitPrice: 92 }),
      books.line('lock', 6, { unitPrice: 65 }),
      books.line('cable', 6, { unitPrice: 18.5 }),
      books.line('cctvInstall', 36, { unitPrice: 12 }),
      books.line('labour', 12),
    ]);
  });
  const o2 = cal.workday(cal.ago(71));
  tl.at(o2, 'Al Naseem order 2', async () => {
    await setDocumentStatus(quote2.id, 'accepted');
    order2 = await books.convert(quote2, 'sales_order', o2, {
      poNumber: 'NRE-PO-2046',
      deliveryPlace: 'عمارة النسيم 3، السالمية، قطعة 12\nAl Naseem Building 3, Salmiya, Block 12',
    });
  });
  const d2 = cal.workday(cal.ago(62));
  tl.at(d2, 'Al Naseem delivery 2', async () => {
    const note = await books.fromOrder(
      order2,
      'delivery_note',
      d2,
      quantitiesOf(order2, books, { camera: 36, nvr: 2, lock: 6, cable: 6 }),
    );
    await books.delivered(note, d2, 'Bader Al-Enezi');
  });
  const i2 = cal.workday(cal.ago(60));
  tl.at(i2, 'Al Naseem invoice 2', async () => {
    invoice2 = await books.fromOrder(order2, 'invoice', i2);
  });
  const received = cal.workday(cal.ago(52));
  const firstDate = cal.ago(44);
  tl.at(received, 'Al Naseem cheques 2', async () => {
    const total = (await db.documents.get(invoice2.id))!.totals.total;
    const half = Math.round((total / 2) * 1000) / 1000;
    first = await books.receive(invoice2, {
      date: received,
      method: 'cheque',
      amount: half,
      reference: '004417',
      cheque: { number: '004417', bank: 'NBOK', date: firstDate, drawer },
    });
    second = await books.receive(invoice2, {
      date: received,
      method: 'cheque',
      amount: half,
      reference: '004418',
      cheque: { number: '004418', bank: 'NBOK', date: cal.ahead(26), drawer },
    });
  });
  const deposited = nextWorkday(firstDate);
  tl.at(deposited, 'Al Naseem cheque deposited', async () => {
    if (first)
      await depositCheque(first.id, { date: deposited, bankAccountId: books.money('nbk') });
  });
  const returned = nextWorkday(addDaysISO(deposited, 3));
  tl.at(returned, 'Al Naseem cheque returned', async () => {
    if (!first) return;
    await returnCheque(first.id, {
      date: returned,
      reason: 'Insufficient funds',
      charge: 5,
      chargeAccountId: books.money('nbk'),
    });
  });
  const replaced = cal.workday(addDaysISO(returned, 8));
  tl.at(replaced, 'Al Naseem replacement cheque', async () => {
    if (!first) return;
    await replaceCheque(first.id, {
      cheque: { number: '004425', bank: 'NBOK', date: cal.ahead(11), drawer },
      amount: first.amount,
      date: replaced,
    });
  });
  void second;
}

/* -------------------------------------------------------------------------- */
/* Bayan Medical Center: an order delivered and invoiced in part              */
/* -------------------------------------------------------------------------- */

function bayan(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  const client = () => books.customers.bayan;
  let quote: InvoiceDocument;
  let order: InvoiceDocument;
  let invoice: InvoiceDocument;
  let cheque: Payment | undefined;
  const quoted = cal.workday(cal.ago(44));
  tl.at(quoted, 'Bayan quote', async () => {
    quote = await books.document('quote', client(), quoted, [
      books.line('survey', 1),
      books.line('camera', 16, { unitPrice: 31.5 }),
      books.line('nvr', 1),
      books.line('cctvInstall', 16),
    ]);
  });
  const ordered = cal.workday(cal.ago(37));
  tl.at(ordered, 'Bayan order', async () => {
    await setDocumentStatus(quote.id, 'accepted');
    order = await books.convert(quote, 'sales_order', ordered, {
      poNumber: 'BMC-LPO-0419',
      deliveryPlace: 'مركز بيان الطبي، بيان، قطعة 7\nBayan Medical Center, Bayan, Block 7',
    });
  });
  const delivered = cal.workday(cal.ago(30));
  tl.at(delivered, 'Bayan delivery', async () => {
    const note = await books.fromOrder(
      order,
      'delivery_note',
      delivered,
      quantitiesOf(order, books, { camera: 10, nvr: 1 }),
    );
    await books.delivered(note, delivered, 'Dr. Hanan Al-Saleh');
  });
  const invoiced = cal.workday(cal.ago(29));
  tl.at(invoiced, 'Bayan invoice', async () => {
    invoice = await books.fromOrder(
      order,
      'invoice',
      invoiced,
      quantitiesOf(order, books, { survey: 1, camera: 10, nvr: 1, cctvInstall: 10 }),
    );
  });
  const received = cal.workday(cal.ago(9));
  const chequeDate = cal.ago(4);
  tl.at(received, 'Bayan cheque', async () => {
    cheque = await books.receive(invoice, {
      date: received,
      method: 'cheque',
      reference: '558120',
      cheque: { number: '558120', bank: 'BBYN', date: chequeDate, drawer: CUSTOMERS.bayan.name },
    });
  });
  // Deposited, waiting for the bank to clear it.
  chequeClears(books, tl, () => cheque, chequeDate, { depositOnly: true });

  // A proforma for smart locks, waiting for the deposit.
  let lockQuote: InvoiceDocument;
  tl.at(cal.ago(8), 'Bayan lock quote', async () => {
    lockQuote = await books.document('quote', client(), cal.ago(8), [
      books.line('lock', 3),
      books.line('labour', 6),
    ]);
  });
  tl.at(cal.ago(6), 'Bayan proforma', async () => {
    await setDocumentStatus(lockQuote.id, 'accepted');
    const date = cal.ago(6);
    await books.convert(lockQuote, 'proforma', date, {
      deposit: 126,
      depositDueDate: addDaysISO(date, 7),
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Al Sanabel Private School: CCTV for the campus                             */
/* -------------------------------------------------------------------------- */

function sanabel(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  const client = () => books.customers.sanabel;
  let quote: InvoiceDocument;
  let order: InvoiceDocument;
  let invoice: InvoiceDocument;
  let cheque: Payment | undefined;
  const quoted = cal.workdayOf(-7, 10);
  tl.at(quoted, 'Sanabel quote', async () => {
    quote = await books.document('quote', client(), quoted, [
      books.line('survey', 1),
      books.line('camera', 28, { unitPrice: 31 }),
      books.line('nvr', 2, { unitPrice: 93 }),
      books.line('cable', 8, { unitPrice: 18.5 }),
      books.line('cctvInstall', 28, { unitPrice: 12 }),
    ]);
  });
  const ordered = cal.workdayOf(-7, 18);
  tl.at(ordered, 'Sanabel order', async () => {
    await setDocumentStatus(quote.id, 'accepted');
    order = await books.convert(quote, 'sales_order', ordered, {
      poNumber: 'SPS-2025-77',
      deliveryPlace: 'مدرسة السنابل، الجهراء، قطعة 2\nAl Sanabel School, Jahra, Block 2',
    });
  });
  const delivered = cal.workdayOf(-6, 4);
  tl.at(delivered, 'Sanabel delivery', async () => {
    const note = await books.fromOrder(
      order,
      'delivery_note',
      delivered,
      quantitiesOf(order, books, { camera: 28, nvr: 2, cable: 8 }),
    );
    await books.delivered(note, delivered, 'Rania Khoury');
  });
  const invoiced = cal.workdayOf(-6, 5);
  tl.at(invoiced, 'Sanabel invoice', async () => {
    invoice = await books.fromOrder(order, 'invoice', invoiced);
  });
  const part = cal.workdayOf(-5, 3);
  tl.at(part, 'Sanabel transfer', async () => {
    await books.receive(invoice, {
      date: part,
      method: 'bank_transfer',
      amount: 800,
      reference: 'SPS TRF 2291',
    });
  });
  const received = cal.workdayOf(-5, 20);
  const chequeDate = cal.day(-4, 5);
  tl.at(received, 'Sanabel cheque', async () => {
    cheque = await books.receive(invoice, {
      date: received,
      method: 'cheque',
      reference: '730014',
      cheque: { number: '730014', bank: 'KFHO', date: chequeDate, drawer: CUSTOMERS.sanabel.name },
    });
  });
  chequeClears(books, tl, () => cheque, chequeDate, { into: 'kfh' });

  // A second phase was quoted and never answered.
  const later = cal.workdayOf(-4, 2);
  tl.at(later, 'Sanabel phase 2 quote', async () => {
    await books.document('quote', client(), later, [
      books.line('camera', 12, { unitPrice: 31 }),
      books.line('cctvInstall', 12, { unitPrice: 12 }),
    ]);
  });
}

/* -------------------------------------------------------------------------- */
/* Gulf Pearl Hotel: monthly maintenance (recurring) and a lighting upgrade    */
/* -------------------------------------------------------------------------- */

function hotel(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  let profileId: ID;
  const start = cal.monthStart(-12);
  tl.at(start, 'hotel maintenance contract', async () => {
    const product = books.items.hotelMaintenance;
    const profile = createRecurring(books.id, {
      clientId: books.customers.hotel.id,
      name: both('Gulf Pearl Hotel monthly maintenance', 'الصيانة الشهرية لفندق لؤلؤة الخليج'),
      frequency: 'monthly',
      startDate: start,
      nextIssueDate: start,
      dueDays: 30,
      markSent: true,
      template: {
        currency: 'KWD',
        items: [
          {
            ...books.line('hotelMaintenance', 1),
            name: `${product.name} – :MONTHYEAR`,
          },
        ],
        discount: 0,
        discountType: 'percent',
        taxes: [],
        charges: [],
        pricesIncludeTax: false,
        poNumber: 'GPH-AMC-2025',
        notes: books.company.defaults.invoiceNotes,
        terms: books.company.defaults.invoiceTerms,
        footer: books.company.defaults.footer,
        privateNotes: '',
        templateId: null,
      },
    });
    await db.recurring.put(profile);
    profileId = profile.id;
  });
  for (let m = -12; m <= 0; m++) {
    const issued = cal.monthStart(m);
    let invoice: InvoiceDocument | null = null;
    tl.at(issued, `hotel invoice ${m}`, async () => {
      invoice = await issueNow(profileId);
    });
    const paid = cal.workdayOf(m, 19);
    if (m < -1) {
      tl.at(paid, `hotel pays ${m}`, async () => {
        if (invoice) {
          await books.receive(invoice, {
            date: paid,
            method: 'bank_transfer',
            reference: `GPH PAYMENT ${paid.slice(0, 7)}`,
          });
        }
      });
    }
  }

  let upgrade: InvoiceDocument;
  const upgraded = cal.workdayOf(-5, 9);
  tl.at(upgraded, 'hotel lighting upgrade', async () => {
    upgrade = await books.document(
      'invoice',
      books.customers.hotel,
      upgraded,
      [
        books.line('panel', 160, { unitPrice: 6.9 }),
        books.line('flood', 30, { unitPrice: 14.5 }),
        books.line('labour', 120),
      ],
      { poNumber: 'GPH-PO-5512', notes: 'Lobby and car park lighting upgrade.' },
    );
  });
  const paid = cal.workdayOf(-4, 12);
  tl.at(paid, 'hotel pays the upgrade', async () => {
    await books.receive(upgrade, {
      date: paid,
      method: 'bank_transfer',
      reference: 'GPH PO 5512',
    });
  });

  // A visit missed during the hotel's renovation is credited, to use later.
  const credited = cal.workdayOf(-3, 4);
  tl.at(credited, 'hotel credit note', async () => {
    const month = (await db.documents.where('clientId').equals(books.customers.hotel.id).toArray())
      .filter((d) => d.type === 'invoice' && d.recurringId)
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
      .find((d) => d.issueDate < credited);
    await books.document(
      'credit',
      books.customers.hotel,
      credited,
      [
        books.custom(
          'Credit for a maintenance visit not carried out (renovation works)',
          'خصم زيارة صيانة لم تتم (أعمال تجديد)',
          1,
          425,
          '4150',
        ),
      ],
      { sourceId: month?.id ?? null, notes: '' },
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Sadu Interiors: lighting for interior projects, one proforma, one return   */
/* -------------------------------------------------------------------------- */

function sadu(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  const client = () => books.customers.sadu;
  const sale = (
    label: string,
    date: ISODate,
    lines: () => LineItem[],
    payment?: { date: ISODate; method: PaymentMethod; reference: string },
  ) => {
    let invoice: InvoiceDocument;
    tl.at(date, label, async () => {
      invoice = await books.document('invoice', client(), date, lines());
    });
    if (payment) {
      tl.at(payment.date, `${label} paid`, async () => {
        await books.receive(invoice, payment);
      });
    }
  };
  sale(
    'Sadu invoice 1',
    cal.workdayOf(-11, 18),
    () => [
      books.line('panel', 60, { unitPrice: 6.5 }),
      books.line('downlight', 150, { unitPrice: 2.15 }),
      books.line('lock', 2),
    ],
    { date: cal.workdayOf(-10, 14), method: 'bank_transfer', reference: 'SADU TRF 1182' },
  );

  // Lighting and locks for a villa in Khairan, paid in two transfers.
  let villa: InvoiceDocument;
  const villaDate = cal.workdayOf(-10, 6);
  tl.at(villaDate, 'Sadu villa project', async () => {
    villa = await books.document(
      'invoice',
      client(),
      villaDate,
      [
        books.line('panel', 120, { unitPrice: 6.5 }),
        books.line('downlight', 400, { unitPrice: 2.1 }),
        books.line('lock', 6, { unitPrice: 66 }),
        books.line('flood', 10, { unitPrice: 14 }),
        books.line('labour', 60),
      ],
      { poNumber: 'SADU-PRJ-027', deliveryPlace: 'فيلا، الخيران، قطعة 4\nVilla, Khairan, Block 4' },
    );
  });
  [cal.workdayOf(-10, 20), cal.workdayOf(-9, 8)].forEach((date, n) => {
    tl.at(date, `Sadu villa paid ${n + 1}`, async () => {
      const due = (await db.documents.get(villa.id))!.totals.balance;
      await books.receive(villa, {
        date,
        method: 'bank_transfer',
        amount: n === 0 ? Math.round(due / 2) : due,
        reference: `SADU TRF ${1205 + n * 17}`,
      });
    });
  });

  // A quote, a proforma with a 50% deposit, then the invoice.
  let quote: InvoiceDocument;
  let proforma: InvoiceDocument;
  let invoice: InvoiceDocument;
  const quoted = cal.workdayOf(-9, 4);
  tl.at(quoted, 'Sadu quote', async () => {
    quote = await books.document(
      'quote',
      client(),
      quoted,
      [
        books.line('panel', 80, { unitPrice: 6.5 }),
        books.line('downlight', 200, { unitPrice: 2.15 }),
        books.line('switches', 20),
        books.line('lock', 4, { unitPrice: 66 }),
      ],
      { poNumber: 'SADU-PRJ-031' },
    );
  });
  const pro = cal.workdayOf(-9, 7);
  tl.at(pro, 'Sadu proforma', async () => {
    await setDocumentStatus(quote.id, 'accepted');
    proforma = await books.convert(quote, 'proforma', pro, {
      deposit: 652,
      depositDueDate: addDaysISO(pro, 7),
    });
  });
  const invoiced = cal.workdayOf(-9, 16);
  tl.at(invoiced, 'Sadu invoice from proforma', async () => {
    await setDocumentStatus(proforma.id, 'accepted');
    invoice = await books.convert(proforma, 'invoice', invoiced);
  });
  const deposit = cal.workdayOf(-9, 17);
  tl.at(deposit, 'Sadu deposit', async () => {
    await books.receive(invoice, {
      date: deposit,
      method: 'bank_transfer',
      amount: 652,
      reference: 'SADU TRF 1240',
    });
  });
  const rest = cal.workdayOf(-8, 12);
  tl.at(rest, 'Sadu balance', async () => {
    await books.receive(invoice, {
      date: rest,
      method: 'bank_transfer',
      reference: 'SADU TRF 1301',
    });
  });

  // Six panels in the wrong colour came back: a credit note against the invoice.
  let returnedFrom: InvoiceDocument;
  const sold = cal.workdayOf(-6, 11);
  tl.at(sold, 'Sadu invoice 3', async () => {
    returnedFrom = await books.document('invoice', client(), sold, [
      books.line('panel', 40, { unitPrice: 6.5 }),
      books.line('flood', 6, { unitPrice: 14 }),
    ]);
  });
  const back = cal.workdayOf(-6, 18);
  tl.at(back, 'Sadu credit note', async () => {
    const credit = await books.document(
      'credit',
      client(),
      back,
      [books.line('panel', 6, { unitPrice: 6.5 })],
      {
        sourceId: returnedFrom.id,
        notes:
          'إرجاع 6 كشافات بلون إضاءة غير مطلوب\nSix panels returned: wrong colour temperature.',
      },
    );
    await books.applyCredit(credit, returnedFrom, back);
  });
  const paid3 = cal.workdayOf(-5, 8);
  tl.at(paid3, 'Sadu invoice 3 paid', async () => {
    await books.receive(returnedFrom, {
      date: paid3,
      method: 'link',
      provider: 'myfatoorah',
      reference: 'MF-7781402',
    });
  });

  sale(
    'Sadu invoice 4',
    cal.workdayOf(-3, 16),
    () => [
      books.line('downlight', 120, { unitPrice: 2.15 }),
      books.line('panel', 30, { unitPrice: 6.5 }),
      books.line('lock', 2, { unitPrice: 66 }),
    ],
    { date: cal.workdayOf(-2, 10), method: 'bank_transfer', reference: 'SADU TRF 1466' },
  );
  // The latest invoice is paid by a transfer still waiting on the bank statement.
  sale('Sadu invoice 5', cal.workday(cal.ago(12)), () => [
    books.line('panel', 24, { unitPrice: 6.5 }),
    books.line('downlight', 60, { unitPrice: 2.15 }),
    books.line('switches', 12),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Marina Breeze Restaurants: quarterly maintenance paid by cheque            */
/* -------------------------------------------------------------------------- */

function marina(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  const client = () => books.customers.marina;
  const drawer = CUSTOMERS.marina.name;
  [-10, -7, -4, -1].forEach((m, n) => {
    const date = cal.workdayOf(m, 3);
    let invoice: InvoiceDocument;
    let cheque: Payment | undefined;
    tl.at(date, `Marina maintenance ${n + 1}`, async () => {
      invoice = await books.document(
        'invoice',
        client(),
        date,
        [books.line('restaurantMaintenance', 1)],
        { poNumber: 'MBR-AMC-07' },
      );
    });
    const last = m === -1;
    const received = last ? cal.workday(cal.ago(20)) : cal.workdayOf(m, 15);
    const chequeDate = last ? cal.ahead(5) : cal.day(m + 1, 15);
    tl.at(received, `Marina cheque ${n + 1}`, async () => {
      cheque = await books.receive(invoice, {
        date: received,
        method: 'cheque',
        reference: `21${4470 + n}`,
        cheque: { number: `21${4470 + n}`, bank: 'BRGN', date: chequeDate, drawer },
      });
    });
    chequeClears(books, tl, () => cheque, chequeDate);
  });

  // A quote for the branches' CCTV was declined.
  let declined: InvoiceDocument;
  const quoted = cal.workdayOf(-9, 14);
  tl.at(quoted, 'Marina CCTV quote', async () => {
    declined = await books.document('quote', client(), quoted, [
      books.line('camera', 18),
      books.line('nvr', 3),
      books.line('cctvInstall', 18),
    ]);
  });
  tl.at(cal.workdayOf(-9, 24), 'Marina declines', async () => {
    await setDocumentStatus(declined.id, 'declined');
  });

  // A kitchen lighting order, confirmed this week and not delivered yet.
  const ordered = cal.workday(cal.ago(4));
  tl.at(ordered, 'Marina kitchen order', async () => {
    await books.document(
      'sales_order',
      client(),
      ordered,
      [books.line('panel', 24), books.line('flood', 4), books.line('labour', 16)],
      {
        poNumber: 'MBR-PO-3310',
        deliveryPlace: 'مطعم نسيم المارينا، السالمية\nMarina Breeze restaurant, Salmiya',
      },
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Green Oasis Farms: overdue, on credit hold                                 */
/* -------------------------------------------------------------------------- */

function oasis(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  const client = () => books.customers.oasis;
  let first: InvoiceDocument;
  const one = cal.workdayOf(-6, 21);
  tl.at(one, 'Green Oasis invoice 1', async () => {
    first = await books.document(
      'invoice',
      client(),
      one,
      [books.line('flood', 16), books.line('cable', 10), books.line('labour', 40)],
      { deliveryPlace: 'مزارع الوفرة، قسيمة 214\nWafra farms, plot 214' },
    );
  });
  const two = cal.workdayOf(-5, 10);
  tl.at(two, 'Green Oasis invoice 2', async () => {
    await books.document('invoice', client(), two, [
      books.line('flood', 8),
      books.line('panel', 20),
      books.line('labour', 24),
    ]);
  });
  const part = cal.workdayOf(-4, 9);
  tl.at(part, 'Green Oasis part payment', async () => {
    await books.receive(first, {
      date: part,
      method: 'wamd',
      amount: 200,
      reference: 'WAMD 96650218',
    });
  });
  tl.at(cal.workdayOf(-1, 3), 'Green Oasis on hold', async () => {
    await setCreditHold(books.customers.oasis.id, true);
  });
}

/* -------------------------------------------------------------------------- */
/* Individual customers                                                       */
/* -------------------------------------------------------------------------- */

function individuals(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  // Khalid's villa in Jabriya: locks and cameras, paid by WAMD and KNET.
  let villa: InvoiceDocument;
  const sold = cal.workdayOf(-7, 5);
  tl.at(sold, 'Khalid invoice', async () => {
    villa = await books.document('invoice', books.customers.khalid, sold, [
      books.line('lock', 4),
      books.line('camera', 6),
      books.line('nvr', 1),
      books.line('cctvInstall', 6),
      books.line('labour', 8),
    ]);
    await books.receive(villa, {
      date: sold,
      method: 'wamd',
      amount: 300,
      reference: 'WAMD 97813302',
    });
  });
  const rest = cal.workdayOf(-7, 12);
  tl.at(rest, 'Khalid KNET', async () => {
    await books.receive(villa, { date: rest, method: 'knet', reference: 'KNET 418820' });
  });
  // Phase 2 was quoted, and accepted on WhatsApp: the work is booked for next week.
  let phase2: InvoiceDocument;
  const quoted = cal.workday(cal.ago(9));
  tl.at(quoted, 'Khalid phase 2 quote', async () => {
    phase2 = await books.document('quote', books.customers.khalid, quoted, [
      books.line('lock', 2),
      books.line('camera', 4),
      books.line('cctvInstall', 4),
      books.line('labour', 6),
    ]);
  });
  const accepted = cal.workday(cal.ago(2));
  tl.at(accepted, 'Khalid accepts phase 2', async () => {
    await setDocumentStatus(phase2.id, 'accepted');
  });

  // Noura's house in Mishref: paid with a MyFatoorah link, then with Taly.
  let house: InvoiceDocument;
  const one = cal.workdayOf(-4, 14);
  tl.at(one, 'Noura invoice', async () => {
    house = await books.document('invoice', books.customers.noura, one, [
      books.line('lock', 2),
      books.line('panel', 12),
      books.line('downlight', 30),
      books.line('labour', 10),
    ]);
    await setPaymentLink(house.id, {
      provider: 'myfatoorah',
      url: `https://pay.myfatoorah.example/inv/${house.number}`,
      expiresAt: addDaysISO(one, 14),
    });
  });
  const paid = cal.workdayOf(-4, 15);
  tl.at(paid, 'Noura pays by link', async () => {
    await books.receive(house, {
      date: paid,
      method: 'link',
      provider: 'myfatoorah',
      reference: 'MF-7802255',
    });
  });
  let garden: InvoiceDocument;
  const two = cal.workday(cal.ago(20));
  tl.at(two, 'Noura garden lighting', async () => {
    garden = await books.document('invoice', books.customers.noura, two, [
      books.line('flood', 4),
      books.line('labour', 6),
    ]);
  });
  const later = cal.workday(cal.ago(19));
  tl.at(later, 'Noura pays with Taly', async () => {
    await books.receive(garden, {
      date: later,
      method: 'bnpl',
      provider: 'taly',
      reference: 'TALY-55120',
    });
  });
  tl.at(cal.ago(1), 'Noura draft quote', async () => {
    await books.document(
      'quote',
      books.customers.noura,
      cal.ago(1),
      [books.line('flood', 6), books.line('labour', 8)],
      {},
      { draft: true },
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Al Sahel Technical Services: our subcontractor also buys from the store    */
/* -------------------------------------------------------------------------- */

function sahel(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  let invoice: InvoiceDocument;
  const sold = cal.workdayOf(-5, 18);
  tl.at(sold, 'Al Sahel buys cable', async () => {
    invoice = await books.document(
      'invoice',
      books.vendors.sahel,
      sold,
      [books.line('cable', 6), books.line('switches', 24)],
      { poNumber: 'ASTS-PO-0412' },
    );
  });
  const paid = cal.workdayOf(-4, 9);
  tl.at(paid, 'Al Sahel pays', async () => {
    await books.receive(invoice, {
      date: paid,
      method: 'bank_transfer',
      reference: 'TRF ASTS 0412',
    });
  });
}

/* -------------------------------------------------------------------------- */
/* The Al-Rai showroom: stock moved in each month, sales at the counter        */
/* -------------------------------------------------------------------------- */

const SHOWROOM_LEVELS: Partial<Record<ItemKey, number>> = {
  panel: 40,
  downlight: 110,
  flood: 6,
  switches: 36,
  camera: 6,
  lock: 3,
};

/** What the store keeps back for projects when it fills the showroom. */
const STORE_KEEPS: Partial<Record<ItemKey, number>> = {
  panel: 40,
  downlight: 100,
  flood: 4,
  switches: 20,
  camera: 4,
  lock: 2,
};

const COUNTER_SALES: [ItemKey, number][][] = [
  [
    ['panel', 8],
    ['switches', 6],
  ],
  [
    ['downlight', 30],
    ['switches', 8],
  ],
  [
    ['lock', 1],
    ['camera', 2],
  ],
  [
    ['flood', 2],
    ['downlight', 16],
  ],
  [
    ['panel', 12],
    ['downlight', 18],
  ],
  [
    ['switches', 10],
    ['downlight', 12],
  ],
  [
    ['downlight', 40],
    ['panel', 6],
  ],
  [
    ['camera', 2],
    ['panel', 6],
    ['switches', 4],
  ],
];

function showroom(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  let sale = 0;
  for (let m = -12; m <= 0; m++) {
    const refill = cal.workdayOf(m, 2);
    tl.at(refill, `showroom refill ${m}`, async () => {
      const lines: { productId: ID; quantity: number }[] = [];
      for (const [key, level] of Object.entries(SHOWROOM_LEVELS) as [ItemKey, number][]) {
        const wanted = level - books.available('showroom', key);
        const spare = books.available('store', key) - (STORE_KEEPS[key] ?? 0);
        const quantity = Math.min(wanted, Math.max(0, spare));
        if (quantity <= 0) continue;
        lines.push({ productId: books.items[key].id, quantity });
        books.addStock('store', key, -quantity);
        books.addStock('showroom', key, quantity);
      }
      if (lines.length === 0) return;
      await recordStockEntry(books.id, {
        kind: 'transfer',
        date: refill,
        warehouseId: books.warehouses.store.id,
        toWarehouseId: books.warehouses.showroom.id,
        reference: '',
        notes: both('Showroom stock for the month', 'بضاعة المعرض للشهر'),
        lines,
      });
    });
    const date = cal.workdayOf(m, 12);
    const n = sale++;
    tl.at(date, `counter sale ${m}`, () => counterSale(books, date, n));
  }
  // Yesterday's sale is still waiting for the KNET settlement.
  const yesterday = cal.workday(cal.ago(1));
  tl.at(yesterday, 'counter sale yesterday', () => counterSale(books, yesterday, 0));
}

/** A sale at the showroom counter, paid by KNET or in cash, from what the showroom holds. */
async function counterSale(books: DemoBooks, date: ISODate, n: number) {
  const method: PaymentMethod = n % 2 === 1 ? 'cash' : 'knet';
  const lines = COUNTER_SALES[n % COUNTER_SALES.length]
    .map(([key, quantity]) => [key, Math.min(quantity, books.available('showroom', key))] as const)
    .filter(([, quantity]) => quantity > 0)
    .map(([key, quantity]) => books.line(key, quantity, { from: 'showroom' }));
  if (lines.length === 0) return;
  const invoice = await books.document('invoice', books.customers.walkin, date, lines);
  await books.receive(invoice, {
    date,
    method,
    reference: method === 'knet' ? `KNET ${String(418_211 + n * 7919).slice(-6)}` : '',
  });
}
