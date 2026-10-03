import type {
  Account,
  AccountType,
  BusinessActivity,
  ChartTemplateId,
  PaymentMethod,
  PaymentProvider,
} from '@/db/types';
import { msg } from '@/i18n';
import { cashLimit } from './kuwait-rules';
import { dec, toMinor } from './money';

/**
 * How people pay in Kuwait, and where each kind of payment is booked.
 *
 * KNET, card, payment-link and buy-now-pay-later money arrives in settlement
 * batches net of fees, so it is received into a clearing account (1020 KNET
 * and card settlements) and matched to the bank deposit later. Cheques wait
 * in the post-dated cheques accounts (1150 received, 2150 issued) until they
 * clear. Cash and cash on delivery go to cash; transfers and WAMD to the bank.
 */

export type PaymentDirection = 'in' | 'out';

export interface PaymentMethodInfo {
  value: PaymentMethod;
  /** English label (translate with `t`). */
  label: string;
  /** Offered for new payments received. */
  in: boolean;
  /** Offered for new payments made. */
  out: boolean;
  /** Providers that can be named (payment links and buy-now-pay-later). */
  providers?: 'link' | 'bnpl';
  /** The provider may keep a fee (payments received only). */
  fee?: boolean;
  /** Cash in hand, so the cash rules of the business activity apply. */
  cash?: boolean;
}

export const PAYMENT_METHODS: PaymentMethodInfo[] = [
  { value: 'bank_transfer', label: msg('Bank transfer'), in: true, out: true },
  { value: 'knet', label: msg('KNET'), in: true, out: true, fee: true },
  { value: 'cash', label: msg('Cash'), in: true, out: true, cash: true },
  { value: 'wamd', label: msg('WAMD'), in: true, out: true },
  { value: 'cheque', label: msg('Cheque'), in: true, out: true },
  { value: 'link', label: msg('Payment link'), in: true, out: false, providers: 'link', fee: true },
  { value: 'card', label: msg('Credit card'), in: true, out: true, fee: true },
  {
    value: 'bnpl',
    label: msg('Buy now, pay later'),
    in: true,
    out: false,
    providers: 'bnpl',
    fee: true,
  },
  { value: 'cod', label: msg('Cash on delivery'), in: true, out: false, cash: true },
  { value: 'credit_note', label: msg('Credit note'), in: true, out: true },
  { value: 'other', label: msg('Other'), in: true, out: true },
  // Kept for payments recorded before; not offered any more.
  { value: 'paypal', label: 'PayPal', in: false, out: false },
  { value: 'stripe', label: 'Stripe', in: false, out: false },
  { value: 'mobile_money', label: msg('Mobile money'), in: false, out: false },
];

export function methodInfo(method: PaymentMethod): PaymentMethodInfo {
  return (
    PAYMENT_METHODS.find((m) => m.value === method) ?? {
      value: method,
      label: method,
      in: false,
      out: false,
    }
  );
}

/**
 * Methods to offer when recording a payment. The method a payment already
 * has stays available, so older records keep their value.
 */
export function offeredMethods(
  direction: PaymentDirection,
  options: { current?: PaymentMethod; creditNotes?: boolean } = {},
): PaymentMethodInfo[] {
  return PAYMENT_METHODS.filter(
    (m) =>
      m.value === options.current ||
      ((direction === 'in' ? m.in : m.out) &&
        (m.value !== 'credit_note' || options.creditNotes !== false)),
  );
}

export function isCashMethod(method: PaymentMethod): boolean {
  return Boolean(methodInfo(method).cash);
}

/** A fee can be recorded on payments received by KNET, card, link or buy-now-pay-later. */
export function takesFee(method: PaymentMethod, direction: PaymentDirection): boolean {
  return direction === 'in' && Boolean(methodInfo(method).fee);
}

export const PAYMENT_PROVIDERS: {
  value: PaymentProvider;
  label: string;
  kind: 'link' | 'bnpl' | 'any';
}[] = [
  { value: 'myfatoorah', label: 'MyFatoorah', kind: 'link' },
  { value: 'tap', label: 'Tap', kind: 'link' },
  { value: 'upayments', label: 'UPayments', kind: 'link' },
  { value: 'hesabe', label: 'Hesabe', kind: 'link' },
  { value: 'ottu', label: 'Ottu', kind: 'link' },
  { value: 'bank', label: msg('Bank payment link'), kind: 'link' },
  { value: 'taly', label: 'Taly', kind: 'bnpl' },
  { value: 'deema', label: 'Deema', kind: 'bnpl' },
  { value: 'tabby', label: 'Tabby', kind: 'bnpl' },
  { value: 'other', label: msg('Other'), kind: 'any' },
];

/** Providers for a method that has them (none for the others). */
export function providersFor(method: PaymentMethod) {
  const kind = methodInfo(method).providers;
  if (!kind) return [];
  return PAYMENT_PROVIDERS.filter((p) => p.kind === kind || p.kind === 'any');
}

/** English label of a provider (translate with `t`). */
export function providerLabel(provider: PaymentProvider): string {
  return PAYMENT_PROVIDERS.find((p) => p.value === provider)?.label ?? provider;
}

/* -------------------------------------------------------------------------- */
/* Accounts                                                                   */
/* -------------------------------------------------------------------------- */

/** Where a payment's money is booked when no account is chosen. */
export type MoneyDestination = 'cash' | 'bank' | 'clearing' | 'cheques';

export function defaultDestination(
  method: PaymentMethod,
  direction: PaymentDirection,
  hasCheque = true,
): MoneyDestination {
  if (method === 'cheque' && hasCheque) return 'cheques';
  if (isCashMethod(method)) return 'cash';
  if (
    direction === 'in' &&
    (method === 'knet' || method === 'card' || method === 'link' || method === 'bnpl')
  ) {
    return 'clearing';
  }
  return 'bank';
}

export interface SystemAccountSpec {
  code: string;
  name: string;
  nameAr: string;
  type: AccountType;
}

/** Accounts of the Kuwait chart that payments post to; created when a company lacks them. */
export const PAYMENT_ACCOUNTS = {
  clearing: {
    code: '1020',
    name: 'KNET and card settlements',
    nameAr: 'تسويات كي نت والبطاقات',
    type: 'asset_current',
  },
  chequesReceived: {
    code: '1150',
    name: 'Post-dated cheques received',
    nameAr: 'شيكات آجلة مستلمة',
    type: 'asset_current',
  },
  chequesIssued: {
    code: '2150',
    name: 'Post-dated cheques issued',
    nameAr: 'شيكات آجلة صادرة',
    type: 'liability_current',
  },
  cardFees: {
    code: '6180',
    name: 'KNET and card fees',
    nameAr: 'عمولات كي نت والبطاقات',
    type: 'expense',
  },
} satisfies Record<string, SystemAccountSpec>;

export type PaymentAccountKey = keyof typeof PAYMENT_ACCOUNTS;

/**
 * Finds one of the payment accounts. In the Kuwait chart the code decides
 * (the account may have been renamed); other charts use the same codes for
 * other things (6180 is "Training" in the standard chart), so there the name
 * must match too.
 */
export function findPaymentAccount(
  accounts: Account[],
  key: PaymentAccountKey,
  template: ChartTemplateId,
): Account | undefined {
  const spec = PAYMENT_ACCOUNTS[key];
  const named = (a: Account) =>
    a.name.trim().toLowerCase() === spec.name.toLowerCase() || a.nameAr?.trim() === spec.nameAr;
  const usable = accounts.filter((a) => !a.archived && a.type === spec.type);
  return (
    usable.find((a) => a.code === spec.code && (template === 'kw' || named(a))) ??
    usable.find(named)
  );
}

/** The wanted code, or the next free number after it ("6180" → "6181"). */
export function freeAccountCode(accounts: Pick<Account, 'code'>[], wanted: string): string {
  const taken = new Set(accounts.map((a) => a.code));
  if (!taken.has(wanted)) return wanted;
  const width = wanted.length;
  for (let n = Number(wanted) + 1; ; n++) {
    const code = String(n).padStart(width, '0');
    if (!taken.has(code)) return code;
  }
}

/* -------------------------------------------------------------------------- */
/* Cash rules                                                                 */
/* -------------------------------------------------------------------------- */

/** Value of an amount in Kuwaiti dinars, when it can be worked out. */
export function kwdValue(
  amount: number,
  currency: string,
  companyCurrency: string,
  exchangeRate?: number,
): number | null {
  if (currency === 'KWD') return amount;
  if (companyCurrency === 'KWD' && exchangeRate && exchangeRate > 0) {
    return dec(amount).times(dec(exchangeRate)).toNumber();
  }
  return null;
}

export type CashCheck =
  /** No rule applies. */
  | { status: 'ok' }
  /** The activity may not take cash at all (MOCI decisions). */
  | { status: 'banned' }
  /** More cash than the activity may take in one payment. */
  | { status: 'over_limit'; limit: number }
  /** There is a limit but the amount in dinars is not known. */
  | { status: 'limited'; limit: number };

/**
 * The cash rules for a payment received (MOCI Decision 32/2026 and the bans on
 * cash for vehicles, gold and real estate). Payments made are not covered.
 */
export function checkCash(
  activity: BusinessActivity,
  method: PaymentMethod,
  direction: PaymentDirection,
  amountKwd: number | null,
): CashCheck {
  if (direction !== 'in' || !isCashMethod(method)) return { status: 'ok' };
  const limit = cashLimit(activity);
  if (limit === null) return { status: 'ok' };
  if (limit === 0) return { status: 'banned' };
  if (amountKwd === null) return { status: 'limited', limit };
  return toMinor(amountKwd, 3) > toMinor(limit, 3)
    ? { status: 'over_limit', limit }
    : { status: 'ok' };
}

/** Cash is offered for a new payment received unless the activity may not take any. */
export function cashAllowed(activity: BusinessActivity): boolean {
  return cashLimit(activity) !== 0;
}
