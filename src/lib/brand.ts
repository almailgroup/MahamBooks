import { currentLanguage } from '@/i18n';

/** The product name, in English: on English screens, in PDF metadata and in backups. */
export const APP_NAME = 'Maham Books';

/** The product name on Arabic screens. */
export const APP_NAME_AR = 'مهام بوكس';

/** The product name in the interface language. */
export function appName(): string {
  return currentLanguage() === 'ar' ? APP_NAME_AR : APP_NAME;
}

/** Start of downloaded file names (no spaces, so they save the same everywhere). */
export const FILE_PREFIX = 'MahamBooks';

/**
 * This device's database keeps the product's first name: renaming it would
 * leave every company saved in the browser behind. Storage keys, lock names
 * and the cloud's schema keep it for the same reason.
 */
export const DATABASE_NAME = 'AlmailBooks';
