import { Decimal, dec, round, type Numeric } from './money';

export type DiscountType = 'percent' | 'amount';

/**
 * How a tax is reported. Zero-rated and exempt are both 0% but are reported
 * apart; reverse charge is worked out on the document but paid by the buyer,
 * so it is never part of the total.
 */
export type TaxKind =
  'standard' | 'reduced' | 'zero' | 'exempt' | 'reverse_charge' | 'out_of_scope';

export interface TaxLine {
  name: string;
  rate: number;
  /** Missing on taxes saved before kinds existed; see `taxKind`. */
  kind?: TaxKind;
}

/** The tax's kind, guessed from rate and name for older records. */
export function taxKind(tax: Pick<TaxLine, 'name' | 'rate' | 'kind'>): TaxKind {
  if (tax.kind) return tax.kind;
  if (tax.rate > 0) return 'standard';
  return /exempt/i.test(tax.name) ? 'exempt' : 'zero';
}

export function isReverseCharge(tax: Pick<TaxLine, 'kind'>): boolean {
  return tax.kind === 'reverse_charge';
}

/** The snapshot stored on a document line for a configured rate. */
export function taxLineOf(rate: Pick<TaxLine, 'name' | 'rate' | 'kind'>): TaxLine {
  return rate.kind
    ? { name: rate.name, rate: rate.rate, kind: rate.kind }
    : { name: rate.name, rate: rate.rate };
}

export const TAX_KINDS: { value: TaxKind; label: string; hint: string }[] = [
  { value: 'standard', label: 'Standard', hint: 'The usual rate' },
  { value: 'reduced', label: 'Reduced', hint: 'A lower rate, e.g. 5% on energy' },
  { value: 'zero', label: 'Zero-rated', hint: '0%, still reported as a taxable sale' },
  { value: 'exempt', label: 'Exempt', hint: 'No VAT and reported as exempt' },
  {
    value: 'reverse_charge',
    label: 'Reverse charge',
    hint: 'The buyer accounts for the VAT (e.g. services from abroad)',
  },
  { value: 'out_of_scope', label: 'Outside the scope', hint: 'Not reported on VAT returns' },
];

export interface CalcLineItem {
  /** Headings are display-only rows used to group items; they carry no amounts. */
  kind?: 'item' | 'heading';
  quantity: number;
  unitPrice: number;
  discount?: number;
  discountType?: DiscountType;
  taxes?: TaxLine[];
}

/** Extra charges such as shipping. They are not affected by the document discount. */
export interface CalcCharge {
  amount: number;
  taxes?: TaxLine[];
}

export interface CalcInput {
  items: CalcLineItem[];
  discount?: number;
  discountType?: DiscountType;
  /** Taxes applied to every item (in addition to each item's own taxes). */
  taxes?: TaxLine[];
  charges?: CalcCharge[];
  /** When true, unit prices and charges already include tax. */
  pricesIncludeTax?: boolean;
  /** Number of decimal places of the currency (2 for USD, 0 for JPY, 3 for KWD). */
  precision: number;
  paid?: number;
  /** Deposit / partial amount requested up front. */
  deposit?: number;
  /** Share of the total held back as a retention (e.g. 5 for 5%); not due until released. */
  retentionPercent?: number;
  /** Part of the retention released so far (due again like the rest of the total). */
  retentionReleased?: number;
}

export interface CalcLineResult {
  /** quantity x unit price */
  gross: number;
  discount: number;
  /** gross - discount; this is the amount shown in the line's "Amount" column */
  net: number;
  /** Tax attributable to this line (for display only; totals use the grouped taxes). */
  tax: number;
}

export interface TaxSummary {
  key: string;
  name: string;
  rate: number;
  kind: TaxKind;
  /** Amount the tax was calculated on (always excluding tax). */
  base: number;
  amount: number;
}

export interface CalcResult {
  lines: CalcLineResult[];
  /** Sum of line amounts (after line discounts). */
  subtotal: number;
  /** Sum of all line-level discounts. */
  lineDiscountTotal: number;
  /** Document-level discount amount. */
  discount: number;
  chargesTotal: number;
  /** Every tax, reverse charge included (shown, but not added to the total). */
  taxes: TaxSummary[];
  /** Tax added to the total: reverse charge excluded. */
  taxTotal: number;
  /** Total excluding tax. */
  netTotal: number;
  total: number;
  paid: number;
  /** Retention held back from the total: `retentionPercent` of it, rounded to the currency. */
  retention: number;
  /** Part of the retention still held (not released yet). */
  retentionHeld: number;
  /** Amount due: total less the retention still held and what was paid. */
  balance: number;
  /** Part of the deposit that is still outstanding (0 when no deposit was requested). */
  depositDue: number;
}

/** Retention on a total: `percent` of it, rounded to the currency (5% of 1,234.567 = 61.728). */
export function retentionOf(total: Numeric, percent: number | null | undefined, precision: number) {
  const rate = Number.isFinite(percent) ? Math.min(Math.max(percent ?? 0, 0), 100) : 0;
  if (rate === 0) return 0;
  const amount = round(dec(total).times(dec(rate)).dividedBy(100), precision);
  return amount > 0 ? amount : 0;
}

export function taxKey(tax: TaxLine): string {
  const key = `${tax.name.trim().toLowerCase()}|${dec(tax.rate).toString()}`;
  // A reverse-charge 20% must not merge with an ordinary 20% of the same name.
  return isReverseCharge(tax) ? `${key}|rc` : key;
}

function validTaxes(taxes: TaxLine[] | undefined): TaxLine[] {
  return (taxes ?? []).filter((t) => t && t.name?.trim() !== '' && Number.isFinite(t.rate));
}

interface TaxBucket {
  name: string;
  rate: number;
  kind: TaxKind;
  base: Decimal;
  amount: Decimal;
}

export function calculate(input: CalcInput): CalcResult {
  const p = Math.max(0, Math.min(6, Math.trunc(input.precision)));
  const inclusive = Boolean(input.pricesIncludeTax);
  const docTaxes = validTaxes(input.taxes);
  const buckets = new Map<string, TaxBucket>();

  const addTax = (tax: TaxLine, base: Decimal, amount: Decimal) => {
    const key = taxKey(tax);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.base = bucket.base.plus(base);
      bucket.amount = bucket.amount.plus(amount);
    } else {
      buckets.set(key, { name: tax.name.trim(), rate: tax.rate, kind: taxKind(tax), base, amount });
    }
  };

  /**
   * Splits an amount into per-tax amounts. For inclusive pricing the amount
   * already contains every charged tax, so the net base is backed out first.
   * Reverse-charge taxes are worked out on the same base but never charged.
   * Returns the raw (unrounded) tax charged on the amount.
   */
  const applyTaxes = (amount: Decimal, taxes: TaxLine[]): Decimal => {
    if (taxes.length === 0) return new Decimal(0);
    const charged = taxes.filter((t) => !isReverseCharge(t));
    const rateSum = charged.reduce((acc, t) => acc.plus(dec(t.rate)), new Decimal(0));
    const base = inclusive ? amount.dividedBy(rateSum.dividedBy(100).plus(1)) : amount;
    let total = new Decimal(0);
    for (const tax of taxes) {
      const taxAmount = base.times(dec(tax.rate)).dividedBy(100);
      addTax(tax, base, taxAmount);
      if (!isReverseCharge(tax)) total = total.plus(taxAmount);
    }
    return total;
  };

  // 1. Line amounts.
  const lineNet: Decimal[] = [];
  let lineDiscountTotal = new Decimal(0);
  const lines: CalcLineResult[] = input.items.map((item) => {
    if (item.kind === 'heading') {
      lineNet.push(new Decimal(0));
      return { gross: 0, discount: 0, net: 0, tax: 0 };
    }
    const grossRaw = dec(item.quantity).times(dec(item.unitPrice));
    const discountValue = dec(item.discount ?? 0);
    const discountRaw =
      (item.discountType ?? 'percent') === 'percent'
        ? grossRaw.times(discountValue).dividedBy(100)
        : discountValue;
    const net = round(grossRaw.minus(discountRaw), p);
    const gross = round(grossRaw, p);
    const discount = round(dec(gross).minus(net), p);
    lineDiscountTotal = lineDiscountTotal.plus(discount);
    lineNet.push(dec(net));
    return { gross, discount, net, tax: 0 };
  });

  const subtotal = lineNet.reduce((acc, v) => acc.plus(v), new Decimal(0));

  // 2. Document discount.
  const docDiscountValue = dec(input.discount ?? 0);
  const discount = dec(
    round(
      (input.discountType ?? 'percent') === 'percent'
        ? subtotal.times(docDiscountValue).dividedBy(100)
        : docDiscountValue,
      p,
    ),
  );
  // Each line carries its share of the document discount into its tax base.
  const ratio = subtotal.isZero() ? new Decimal(1) : subtotal.minus(discount).dividedBy(subtotal);

  // 3. Taxes on lines (line taxes plus document taxes).
  input.items.forEach((item, index) => {
    if (item.kind === 'heading') return;
    const taxes = [...validTaxes(item.taxes), ...docTaxes];
    const base = lineNet[index].times(ratio);
    const lineTax = applyTaxes(base, taxes);
    lines[index].tax = round(lineTax, p);
  });

  // 4. Charges.
  let chargesTotal = new Decimal(0);
  for (const charge of input.charges ?? []) {
    const amount = dec(round(charge.amount, p));
    chargesTotal = chargesTotal.plus(amount);
    applyTaxes(amount, validTaxes(charge.taxes));
  }

  // 5. Round once per tax group, then total.
  const taxes: TaxSummary[] = [...buckets.entries()].map(([key, b]) => ({
    key,
    name: b.name,
    rate: b.rate,
    kind: b.kind,
    base: round(b.base, p),
    amount: round(b.amount, p),
  }));
  const taxTotal = taxes
    .filter((t) => t.kind !== 'reverse_charge')
    .reduce((acc, t) => acc.plus(dec(t.amount)), new Decimal(0));

  const afterDiscount = subtotal.minus(discount).plus(chargesTotal);
  const total = inclusive ? afterDiscount : afterDiscount.plus(taxTotal);
  const netTotal = total.minus(taxTotal);

  const paid = dec(round(input.paid ?? 0, p));
  const retention = dec(retentionOf(round(total, p), input.retentionPercent, p));
  let released = dec(round(input.retentionReleased ?? 0, p));
  if (released.isNegative()) released = new Decimal(0);
  if (released.gt(retention)) released = retention;
  const retentionHeld = retention.minus(released);
  const balance = total.minus(retentionHeld).minus(paid);

  const deposit = dec(input.deposit ?? 0);
  let depositDue = new Decimal(0);
  if (deposit.gt(0)) {
    // The retention is never part of the amount asked for up front.
    const payable = total.minus(retention);
    const capped = deposit.gt(payable) ? payable : deposit;
    depositDue = capped.minus(paid);
    if (depositDue.isNegative()) depositDue = new Decimal(0);
  }

  return {
    lines,
    subtotal: round(subtotal, p),
    lineDiscountTotal: round(lineDiscountTotal, p),
    discount: round(discount, p),
    chargesTotal: round(chargesTotal, p),
    taxes,
    taxTotal: round(taxTotal, p),
    netTotal: round(netTotal, p),
    total: round(total, p),
    paid: round(paid, p),
    retention: round(retention, p),
    retentionHeld: round(retentionHeld, p),
    balance: round(balance, p),
    depositDue: round(depositDue, p),
  };
}
