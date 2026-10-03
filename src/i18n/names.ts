import { currentLanguage, type Language } from './index';

/**
 * The name to show for a record that has an English and an Arabic name
 * (companies, contacts, items, accounts): Arabic in the Arabic interface
 * when there is one, otherwise the main name.
 */
export function localName(
  record: { name: string; nameAr?: string } | null | undefined,
  language: Language = currentLanguage(),
): string {
  if (!record) return '';
  return language === 'ar' && record.nameAr?.trim() ? record.nameAr.trim() : record.name;
}
