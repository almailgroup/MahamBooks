import { currentLanguage } from '@/i18n';

/**
 * Maham One is the suite: the name of the installed app, the sign-in and
 * welcome screens, the home and the email alerts. Its apps have their own
 * names (src/apps/<app>/manifest.ts).
 */
export const SUITE_NAME = 'Maham One';

/** The suite's name on Arabic screens. */
export const SUITE_NAME_AR = 'مهام ون';

/** The suite's name in the interface language. */
export function suiteName(): string {
  return currentLanguage() === 'ar' ? SUITE_NAME_AR : SUITE_NAME;
}

/**
 * Maham Books, the accounting app: in PDF metadata and in backups (which
 * keep this name so earlier versions still open them).
 */
export const APP_NAME = 'Maham Books';

/** Maham Books on Arabic screens. */
export const APP_NAME_AR = 'مهام بوكس';

/** Maham Books in the interface language. */
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
