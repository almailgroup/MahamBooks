import type { Payment } from '@/db/types';
import { msg } from '@/i18n';

/** Money received from clients, or paid to vendors. */
export type PaymentDirection = 'in' | 'out';

export function paymentDirection(payment: Pick<Payment, 'direction'>): PaymentDirection {
  return payment.direction === 'out' ? 'out' : 'in';
}

/**
 * Wording of the payment pages for each direction, marked for translation
 * (show with `t(copy.title)`).
 */
export const PAYMENT_COPY = {
  in: {
    title: msg('Payments received'),
    description: msg('Money received and credit notes applied.'),
    base: '/payments',
    contactBase: '/clients',
    docBase: '/invoices',
    creditBase: '/credits',
    party: msg('Client'),
    docType: 'invoice' as const,
    creditType: 'credit' as const,
    doc: msg('Invoice'),
    credit: msg('Credit note'),
    amount: msg('Amount received'),
    account: msg('Deposit to'),
    accountHint: msg('The bank, cash or KNET account the money went into.'),
    who: msg('Who paid?'),
    searchParties: msg('Search clients…'),
    chooseParty: msg('Choose a client.'),
    enterAmount: msg('Enter the amount received.'),
    overApplied: msg('More is applied to invoices than the payment amount.'),
    chooseCredit: msg('Choose the credit note to apply.'),
    chooseCreditOption: msg('Choose a credit note…'),
    noCredits: msg('This client has no open credit notes'),
    creditAvailable: msg('The credit note only has {amount} available.'),
    applyTitle: msg('Apply to invoices'),
    applyDescription: msg('Split the payment across the client’s open invoices.'),
    pickPartyFirst: msg('Choose a client to see their open invoices.'),
    noOpenDocs: msg('No open invoices in {currency}. The payment will be kept as client credit.'),
    unapplied: msg('Unapplied (client credit)'),
    recordTitle: msg('Record a payment'),
    total: msg('Total received'),
    empty: msg('Record payments as they arrive to keep invoice balances up to date.'),
    deleteDescription: msg('Invoices it was applied to will show the amount as unpaid again.'),
    notApplied: msg('Not applied to any invoice.'),
    deletedDoc: msg('Deleted invoice'),
    from: msg('{amount} from {name}'),
    unknownParty: msg('{amount} from an unknown client'),
    voucher: msg('Receipt voucher'),
  },
  out: {
    title: msg('Payments made'),
    description: msg('Money paid to vendors and vendor credits applied.'),
    base: '/payments-made',
    contactBase: '/vendors',
    docBase: '/bills',
    creditBase: '/vendor-credits',
    party: msg('Vendor'),
    docType: 'bill' as const,
    creditType: 'vendor_credit' as const,
    doc: msg('Bill'),
    credit: msg('Vendor credit'),
    amount: msg('Amount paid'),
    account: msg('Paid from'),
    accountHint: msg('The bank, cash or card account the money came from.'),
    who: msg('Who did you pay?'),
    searchParties: msg('Search vendors…'),
    chooseParty: msg('Choose a vendor.'),
    enterAmount: msg('Enter the amount paid.'),
    overApplied: msg('More is applied to bills than the payment amount.'),
    chooseCredit: msg('Choose the vendor credit to apply.'),
    chooseCreditOption: msg('Choose a vendor credit…'),
    noCredits: msg('This vendor has no open vendor credits'),
    creditAvailable: msg('The vendor credit only has {amount} available.'),
    applyTitle: msg('Apply to bills'),
    applyDescription: msg('Split the payment across the vendor’s open bills.'),
    pickPartyFirst: msg('Choose a vendor to see their open bills.'),
    noOpenDocs: msg(
      'No open bills in {currency}. The payment will be kept as an advance to the vendor.',
    ),
    unapplied: msg('Unapplied (advance to the vendor)'),
    recordTitle: msg('Record a payment made'),
    total: msg('Total paid'),
    empty: msg('Record what you pay vendors to keep bill balances up to date.'),
    deleteDescription: msg('Bills it was applied to will show the amount as unpaid again.'),
    notApplied: msg('Not applied to any bill.'),
    deletedDoc: msg('Deleted bill'),
    from: msg('{amount} to {name}'),
    unknownParty: msg('{amount} to an unknown vendor'),
    voucher: msg('Payment voucher'),
  },
};
