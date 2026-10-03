import { Truck, Users } from 'lucide-react';
import type { Client } from '@/db/types';
import { msg } from '@/i18n';

/** Clients buy from you; vendors sell to you. One contact can be both. */
export type ContactKind = 'customer' | 'vendor';

/**
 * Wording and routes for the two kinds of contact. Text is kept as English
 * keys (`msg`): show it with `t(copy.title)`.
 */
export const CONTACT_COPY = {
  customer: {
    title: msg('Clients'),
    description: msg('The people and companies you bill.'),
    base: '/clients',
    column: msg('Client'),
    docType: 'invoice' as const,
    creditType: 'credit' as const,
    amountLabel: msg('Invoiced'),
    owedLabel: msg('Outstanding'),
    empty: msg('Add the people and companies you work with to invoice them in seconds.'),
    emptyTitle: msg('No clients yet'),
    newLabel: msg('New client'),
    saveLabel: msg('Save client'),
    editTitle: msg('Edit {name}'),
    notFound: msg('This client could not be found.'),
    back: msg('Back to clients'),
    search: msg('Search clients…'),
    noMatch: msg('No clients match.'),
    restored: msg('Client restored'),
    archived: msg('Client archived'),
    deleted: msg('Client deleted'),
    added: msg('Client {name} added'),
    saveError: msg('Could not save the client.'),
    deleteError: msg('Could not delete the client.'),
    quickHint: msg('You can add more details later from the Clients page.'),
    alsoOther: msg('Also a vendor'),
    fileName: 'clients',
    icon: <Users />,
  },
  vendor: {
    title: msg('Vendors'),
    description: msg('The suppliers you buy from.'),
    base: '/vendors',
    column: msg('Vendor'),
    docType: 'bill' as const,
    creditType: 'vendor_credit' as const,
    amountLabel: msg('Billed'),
    owedLabel: msg('You owe'),
    empty: msg('Add the suppliers you buy from to record their bills and what you pay them.'),
    emptyTitle: msg('No vendors yet'),
    newLabel: msg('New vendor'),
    saveLabel: msg('Save vendor'),
    editTitle: msg('Edit {name}'),
    notFound: msg('This vendor could not be found.'),
    back: msg('Back to vendors'),
    search: msg('Search vendors…'),
    noMatch: msg('No vendors match.'),
    restored: msg('Vendor restored'),
    archived: msg('Vendor archived'),
    deleted: msg('Vendor deleted'),
    added: msg('Vendor {name} added'),
    saveError: msg('Could not save the vendor.'),
    deleteError: msg('Could not delete the vendor.'),
    quickHint: msg('You can add more details later from the Vendors page.'),
    alsoOther: msg('Also a client'),
    fileName: 'vendors',
    icon: <Truck />,
  },
};

/** Role flags for a new contact of this kind. */
export function contactRoles(kind: ContactKind): Pick<Client, 'isCustomer' | 'isVendor'> {
  return kind === 'vendor' ? { isCustomer: false, isVendor: true } : { isCustomer: true };
}
