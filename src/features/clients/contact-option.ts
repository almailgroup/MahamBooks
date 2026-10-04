import type { Client } from '@/db/types';
import type { ComboOption } from '@/components/ui/combobox';
import { localName } from '@/i18n/names';

/**
 * A client or vendor in a picker: named in the interface language (the
 * Arabic name in Arabic), with the other name, the email and the city under
 * it. Either name finds it.
 */
export function contactOption(contact: Client): ComboOption {
  const name = localName(contact);
  const other = name === contact.name ? contact.nameAr : contact.name;
  const email = contact.contacts.find((x) => x.primary)?.email || contact.email;
  return {
    value: contact.id,
    label: name,
    detail: [other, email, contact.address.city].filter(Boolean).join(' · '),
    keywords: [contact.number, contact.name, contact.nameAr].filter(Boolean).join(' '),
  };
}

/** Contacts as picker options, in alphabetical order of the names shown. */
export function contactOptions(contacts: Client[]): ComboOption[] {
  return contacts.map(contactOption).sort((a, b) => a.label.localeCompare(b.label));
}
