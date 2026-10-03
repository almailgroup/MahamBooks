import type { AccountRole, ID, ISODate, VatFormat } from '@/db/types';
import { addDaysISO, parseISODate, toISODate } from '@/lib/dates';
import type { LedgerLine } from './ledger';
import { msg } from '@/i18n';

/**
 * VAT returns, worked out from the ledger: tax boxes from the movements on
 * the output and input tax accounts (so manual corrections count), value
 * boxes from the VAT tags on sale and purchase lines. The entry that closes
 * a return is left out of every return.
 */

export type { VatFormat };

/** Translate labels where they are shown: `t(format.label)`; the same for box labels. */
export const VAT_FORMATS: { value: VatFormat; label: string }[] = [
  { value: 'uk', label: msg('United Kingdom (VAT return, boxes 1–9)') },
  { value: 'ae', label: msg('United Arab Emirates (VAT 201)') },
  { value: 'generic', label: msg('Summary (any country)') },
];

export function vatFormatFor(country: string): VatFormat {
  const code = country.toUpperCase();
  if (code === 'GB' || code === 'IM') return 'uk';
  if (code === 'AE') return 'ae';
  return 'generic';
}

export const EMIRATES = [
  {
    code: 'AZ',
    name: msg('Abu Dhabi'),
    supplies: msg('Standard rated supplies in Abu Dhabi'),
    match: /abu\s*dhabi|al\s*ain/i,
  },
  {
    code: 'DU',
    name: msg('Dubai'),
    supplies: msg('Standard rated supplies in Dubai'),
    match: /dubai/i,
  },
  {
    code: 'SH',
    name: msg('Sharjah'),
    supplies: msg('Standard rated supplies in Sharjah'),
    match: /sharjah/i,
  },
  {
    code: 'AJ',
    name: msg('Ajman'),
    supplies: msg('Standard rated supplies in Ajman'),
    match: /ajman/i,
  },
  {
    code: 'UQ',
    name: msg('Umm Al Quwain'),
    supplies: msg('Standard rated supplies in Umm Al Quwain'),
    match: /umm\s*al\s*quwain/i,
  },
  {
    code: 'RK',
    name: msg('Ras Al Khaimah'),
    supplies: msg('Standard rated supplies in Ras Al Khaimah'),
    match: /ras\s*al\s*khaimah/i,
  },
  {
    code: 'FU',
    name: msg('Fujairah'),
    supplies: msg('Standard rated supplies in Fujairah'),
    match: /fujairah/i,
  },
] as const;

export type EmirateCode = (typeof EMIRATES)[number]['code'];

/** The emirate named in an address, if any. */
export function emirateFromAddress(address: { state?: string; city?: string }): EmirateCode | null {
  const text = `${address.state ?? ''} ${address.city ?? ''}`;
  return EMIRATES.find((e) => e.match.test(text))?.code ?? null;
}

/* -------------------------------------------------------------------------- */
/* Periods                                                                    */
/* -------------------------------------------------------------------------- */

export interface VatPeriod {
  start: ISODate;
  end: ISODate;
}

export interface VatSchedule {
  frequency: 'monthly' | 'quarterly';
  /** Month (1–12) one of the quarters starts in; sets the UK "stagger". */
  startMonth: number;
}

/** The return period a date falls in. */
export function vatPeriodOf(date: ISODate, schedule: VatSchedule): VatPeriod {
  const d = parseISODate(date);
  const length = schedule.frequency === 'monthly' ? 1 : 3;
  const offset = schedule.frequency === 'monthly' ? 0 : (((schedule.startMonth - 1) % 3) + 3) % 3;
  // Months since an aligned period start, kept positive.
  const index = d.getFullYear() * 12 + d.getMonth() - offset;
  const startIndex = index - (((index % length) + length) % length) + offset;
  const start = new Date(Math.floor(startIndex / 12), startIndex % 12, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + length, 0);
  return { start: toISODate(start), end: toISODate(end) };
}

/** Every period from the one containing `from` to the one containing `to`. */
export function vatPeriods(schedule: VatSchedule, from: ISODate, to: ISODate): VatPeriod[] {
  const periods: VatPeriod[] = [];
  let period = vatPeriodOf(from, schedule);
  while (period.start <= to && periods.length < 600) {
    periods.push(period);
    period = vatPeriodOf(addDaysISO(period.end, 1), schedule);
  }
  return periods;
}

/** Filing (and payment) deadline. */
export function vatDueDate(period: VatPeriod, format: VatFormat): ISODate {
  const end = parseISODate(period.end);
  if (format === 'ae') return addDaysISO(period.end, 28);
  const nextMonthEnd = toISODate(new Date(end.getFullYear(), end.getMonth() + 2, 0));
  // UK: one month and seven days after the period ends.
  return format === 'uk' ? addDaysISO(nextMonthEnd, 7) : nextMonthEnd;
}

/* -------------------------------------------------------------------------- */
/* Boxes                                                                      */
/* -------------------------------------------------------------------------- */

export interface VatBox {
  id: string;
  label: string;
  /** Minor units of the company currency. */
  amount: number;
  /** VAT column (UAE): minor units. */
  vat?: number;
  /** A total or result row. */
  total?: boolean;
  /** Shown in whole currency units (UK boxes 6–9). */
  whole?: boolean;
}

export interface VatReturnResult {
  format: VatFormat;
  period: VatPeriod;
  boxes: VatBox[];
  /** Positive: to pay; negative: to reclaim. Minor units. */
  net: number;
  /** Sale and purchase lines that had no tax rate (documents to check). */
  untaxed: LedgerLine[];
}

export interface VatContext {
  roles: Partial<Record<AccountRole, ID>>;
  /** Minor-unit digits of the company currency. */
  precision: number;
  /** UAE: the emirate the business is established in. */
  emirate?: EmirateCode;
}

type Pick = (line: LedgerLine) => number;

const sum = (lines: LedgerLine[], pick: Pick) => lines.reduce((acc, l) => acc + pick(l), 0);

/** Lines of the period that count for VAT returns. */
export function vatLines(lines: LedgerLine[], period: VatPeriod): LedgerLine[] {
  return lines.filter((l) => l.date >= period.start && l.date <= period.end && !l.settlement);
}

/** What each box adds up, per line, so a box can list its transactions. */
export function boxPickers(
  format: VatFormat,
  ctx: VatContext,
): Record<string, { pick: Pick; vat?: Pick }> {
  const output: Pick = (l) => (l.accountId === ctx.roles.output_tax ? -l.amount : 0);
  const input: Pick = (l) => (l.accountId === ctx.roles.input_tax ? l.amount : 0);
  const base =
    (flow: 'sale' | 'purchase', kinds: string[]): Pick =>
    (l) =>
      l.vat?.part === 'base' && l.vat.flow === flow && kinds.includes(l.vat.kind)
        ? flow === 'sale'
          ? -l.amount
          : l.amount
        : 0;
  const tax =
    (account: Pick, kinds: string[] | null): Pick =>
    (l) =>
      kinds === null || (l.vat && kinds.includes(l.vat.kind)) ? account(l) : 0;
  const reported = ['standard', 'reduced', 'zero', 'exempt', 'none'];

  if (format === 'uk') {
    return {
      '1': { pick: output },
      '4': { pick: input },
      // Sales under the domestic reverse charge count in full; services bought from
      // abroad under reverse charge count as a sale and a purchase.
      '6': {
        pick: (l) =>
          base('sale', [...reported, 'reverse_charge'])(l) +
          base('purchase', ['reverse_charge'])(l),
      },
      '7': { pick: base('purchase', [...reported, 'reverse_charge']) },
    };
  }
  if (format === 'ae') {
    const standard = ['standard', 'reduced'];
    // Output tax without a tag (manual corrections) is reported with the standard supplies.
    const standardOutput: Pick = (l) =>
      l.vat ? tax(output, standard)(l) : l.accountId === ctx.roles.output_tax ? -l.amount : 0;
    const standardInput: Pick = (l) =>
      l.vat ? tax(input, standard)(l) : l.accountId === ctx.roles.input_tax ? l.amount : 0;
    return {
      '1': { pick: base('sale', standard), vat: standardOutput },
      '3': { pick: base('purchase', ['reverse_charge']), vat: tax(output, ['reverse_charge']) },
      '4': { pick: base('sale', ['zero', 'none']) },
      '5': { pick: base('sale', ['exempt']) },
      '9': { pick: base('purchase', standard), vat: standardInput },
      '10': { pick: base('purchase', ['reverse_charge']), vat: tax(input, ['reverse_charge']) },
    };
  }
  // Reverse charge is shown on its own row, not in the taxable sales and purchases.
  const notReverse =
    (account: Pick): Pick =>
    (l) =>
      l.vat?.kind === 'reverse_charge' ? 0 : account(l);
  return {
    'sales-taxed': { pick: base('sale', ['standard', 'reduced']), vat: notReverse(output) },
    'sales-zero': { pick: base('sale', ['zero']) },
    'sales-exempt': { pick: base('sale', ['exempt']) },
    'sales-none': { pick: base('sale', ['none']) },
    'purchases-taxed': {
      pick: base('purchase', ['standard', 'reduced']),
      vat: notReverse(input),
    },
    'purchases-other': { pick: base('purchase', ['zero', 'exempt', 'none']) },
    reverse: { pick: base('purchase', ['reverse_charge']), vat: tax(input, ['reverse_charge']) },
  };
}

/** The period's movement on the VAT accounts: what the closing entry moves. */
export function vatAccountTotals(
  allLines: LedgerLine[],
  period: VatPeriod,
  roles: VatContext['roles'],
): { output: number; input: number } {
  const lines = vatLines(allLines, period);
  return {
    output: sum(lines, (l) => (l.accountId === roles.output_tax ? -l.amount : 0)),
    input: sum(lines, (l) => (l.accountId === roles.input_tax ? l.amount : 0)),
  };
}

/** Rounds down to whole units, as HMRC asks for boxes 6–9. */
function whole(minor: number, precision: number): number {
  const unit = 10 ** precision;
  return Math.trunc(minor / unit) * unit;
}

export function vatReturn(
  allLines: LedgerLine[],
  period: VatPeriod,
  format: VatFormat,
  ctx: VatContext,
): VatReturnResult {
  const lines = vatLines(allLines, period);
  const pickers = boxPickers(format, ctx);
  const amount = (id: string) => sum(lines, pickers[id].pick);
  const vat = (id: string) => sum(lines, pickers[id].vat ?? (() => 0));
  const untaxed = lines.filter((l) => l.vat?.part === 'base' && l.vat.kind === 'none');
  let boxes: VatBox[];
  let net: number;

  if (format === 'uk') {
    const box1 = amount('1');
    const box4 = amount('4');
    net = box1 - box4;
    boxes = [
      { id: '1', label: msg('VAT due on sales and other outputs'), amount: box1 },
      {
        id: '2',
        label: msg(
          'VAT due on acquisitions of goods made in Northern Ireland from EU member states',
        ),
        amount: 0,
      },
      { id: '3', label: msg('Total VAT due (box 1 + box 2)'), amount: box1, total: true },
      {
        id: '4',
        label: msg(
          'VAT reclaimed on purchases and other inputs (including acquisitions in Northern Ireland from EU member states)',
        ),
        amount: box4,
      },
      {
        id: '5',
        label: msg('Net VAT to pay to HMRC or reclaim (difference between box 3 and box 4)'),
        amount: Math.abs(net),
        total: true,
      },
      {
        id: '6',
        label: msg('Total value of sales and all other outputs excluding any VAT'),
        amount: whole(amount('6'), ctx.precision),
        whole: true,
      },
      {
        id: '7',
        label: msg('Total value of purchases and all other inputs excluding any VAT'),
        amount: whole(amount('7'), ctx.precision),
        whole: true,
      },
      {
        id: '8',
        label: msg(
          'Total value of dispatches of goods and related costs (excluding VAT) from Northern Ireland to EU member states',
        ),
        amount: 0,
        whole: true,
      },
      {
        id: '9',
        label: msg(
          'Total value of acquisitions of goods and related costs (excluding VAT) made in Northern Ireland from EU member states',
        ),
        amount: 0,
        whole: true,
      },
    ];
  } else if (format === 'ae') {
    const home = ctx.emirate ?? 'DU';
    const rows = EMIRATES.map((e, i) => ({
      id: `1${'abcdefg'[i]}`,
      label: e.supplies,
      amount: e.code === home ? amount('1') : 0,
      vat: e.code === home ? vat('1') : 0,
    }));
    const outputs: VatBox[] = [
      ...rows,
      {
        id: '2',
        label: msg('Tax refunds provided to tourists under the tax refunds for tourists scheme'),
        amount: 0,
        vat: 0,
      },
      {
        id: '3',
        label: msg('Supplies subject to the reverse charge provisions'),
        amount: amount('3'),
        vat: vat('3'),
      },
      { id: '4', label: msg('Zero rated supplies'), amount: amount('4') },
      { id: '5', label: msg('Exempt supplies'), amount: amount('5') },
      { id: '6', label: msg('Goods imported into the UAE'), amount: 0, vat: 0 },
      { id: '7', label: msg('Adjustments to goods imported into the UAE'), amount: 0, vat: 0 },
    ];
    const box8 = {
      amount: outputs.reduce((s, b) => s + b.amount, 0),
      vat: outputs.reduce((s, b) => s + (b.vat ?? 0), 0),
    };
    const inputs: VatBox[] = [
      {
        id: '9',
        label: msg('Standard rated expenses'),
        amount: amount('9'),
        vat: vat('9'),
      },
      {
        id: '10',
        label: msg('Supplies subject to the reverse charge provisions'),
        amount: amount('10'),
        vat: vat('10'),
      },
    ];
    const box11 = {
      amount: inputs.reduce((s, b) => s + b.amount, 0),
      vat: inputs.reduce((s, b) => s + (b.vat ?? 0), 0),
    };
    net = box8.vat - box11.vat;
    boxes = [
      ...outputs,
      { id: '8', label: msg('Totals'), ...box8, total: true },
      ...inputs,
      { id: '11', label: msg('Totals'), ...box11, total: true },
      {
        id: '12',
        label: msg('Total value of due tax for the period'),
        amount: box8.vat,
        total: true,
      },
      {
        id: '13',
        label: msg('Total value of recoverable tax for the period'),
        amount: box11.vat,
        total: true,
      },
      { id: '14', label: msg('Payable tax for the period'), amount: net, total: true },
    ];
  } else {
    const output = sum(lines, (l) => (l.accountId === ctx.roles.output_tax ? -l.amount : 0));
    const input = sum(lines, (l) => (l.accountId === ctx.roles.input_tax ? l.amount : 0));
    net = output - input;
    boxes = [
      {
        id: 'sales-taxed',
        label: msg('Taxable sales'),
        amount: amount('sales-taxed'),
        vat: vat('sales-taxed'),
      },
      { id: 'sales-zero', label: msg('Zero-rated sales'), amount: amount('sales-zero') },
      { id: 'sales-exempt', label: msg('Exempt sales'), amount: amount('sales-exempt') },
      { id: 'sales-none', label: msg('Sales without a tax rate'), amount: amount('sales-none') },
      {
        id: 'purchases-taxed',
        label: msg('Taxable purchases'),
        amount: amount('purchases-taxed'),
        vat: vat('purchases-taxed'),
      },
      {
        id: 'purchases-other',
        label: msg('Purchases without tax'),
        amount: amount('purchases-other'),
      },
      {
        id: 'reverse',
        label: msg('Purchases under reverse charge (tax due and reclaimed)'),
        amount: amount('reverse'),
        vat: vat('reverse'),
      },
      { id: 'output', label: msg('Tax on sales (output tax)'), amount: output, total: true },
      { id: 'input', label: msg('Tax on purchases (input tax)'), amount: input, total: true },
      { id: 'net', label: msg('Net tax to pay'), amount: net, total: true },
    ];
  }
  return { format, period, boxes, net, untaxed };
}

/** The ledger lines behind one box, for drill-down. */
export function vatBoxLines(
  allLines: LedgerLine[],
  period: VatPeriod,
  format: VatFormat,
  ctx: VatContext,
  boxId: string,
): { line: LedgerLine; amount: number; vat: number }[] {
  let key = boxId;
  if (format === 'ae' && /^1[a-g]$/.test(boxId)) {
    // Supplies are reported in the emirate the business is established in.
    const index = 'abcdefg'.indexOf(boxId[1]);
    if (EMIRATES[index].code !== (ctx.emirate ?? 'DU')) return [];
    key = '1';
  }
  const picker = boxPickers(format, ctx)[key];
  if (!picker) return [];
  return vatLines(allLines, period)
    .map((line) => ({ line, amount: picker.pick(line), vat: picker.vat?.(line) ?? 0 }))
    .filter((x) => x.amount !== 0 || x.vat !== 0);
}
