import type { DocumentLanguage } from '@/db/types';
import { msg } from '@/i18n';

/**
 * Languages documents can be printed in, for pickers. Translate the label
 * where it is shown: `t(language.label)`.
 */
export const DOCUMENT_LANGUAGES: { value: DocumentLanguage; label: string }[] = [
  { value: 'ar-en', label: msg('Arabic and English') },
  { value: 'ar', label: msg('Arabic') },
  { value: 'en', label: msg('English') },
  { value: 'fr', label: msg('French') },
  { value: 'es', label: msg('Spanish') },
  { value: 'de', label: msg('German') },
  { value: 'pt', label: msg('Portuguese') },
  { value: 'it', label: msg('Italian') },
  { value: 'nl', label: msg('Dutch') },
];
