import type { BusinessActivity, Company, KuwaitProfile, LegalForm } from '@/db/types';
import { msg } from '@/i18n';

/** A Kuwait profile with defaults for anything not set yet. */
export function kuwaitProfile(company: Pick<Company, 'kuwait'>): KuwaitProfile {
  return {
    legalForm: 'wll',
    licenceNumber: '',
    activity: 'general',
    foreignOwnershipPercent: 0,
    capital: 0,
    pamFileNumber: '',
    pifssEmployerNumber: '',
    mofTaxCardNumber: '',
    kcciNumber: '',
    digitalCommerceNumber: '',
    wamdPhone: '',
    ...company.kuwait,
  };
}

export const LEGAL_FORMS: { value: LegalForm; label: string; labelAr: string }[] = [
  { value: 'sole_proprietorship', label: 'Sole proprietorship', labelAr: 'مؤسسة فردية' },
  {
    value: 'wll',
    label: 'With limited liability company (W.L.L.)',
    labelAr: 'شركة ذات مسؤولية محدودة (ذ.م.م)',
  },
  { value: 'spc', label: 'Single person company (S.P.C.)', labelAr: 'شركة الشخص الواحد' },
  { value: 'general_partnership', label: 'General partnership', labelAr: 'شركة تضامن' },
  { value: 'limited_partnership', label: 'Limited partnership', labelAr: 'شركة توصية بسيطة' },
  {
    value: 'kscc',
    label: 'Closed shareholding company (K.S.C.C.)',
    labelAr: 'شركة مساهمة مقفلة (ش.م.ك.م)',
  },
  {
    value: 'ksc_listed',
    label: 'Listed shareholding company (K.S.C.P.)',
    labelAr: 'شركة مساهمة عامة مدرجة (ش.م.ك.ع)',
  },
  { value: 'foreign_branch', label: 'Branch of a foreign company', labelAr: 'فرع شركة أجنبية' },
  {
    value: 'freelance',
    label: 'Freelance or home business licence',
    labelAr: 'ترخيص عمل حر أو منزلي',
  },
  { value: 'other', label: 'Other', labelAr: 'أخرى' },
];

/** Shareholding companies pay Zakat (1%) and KFAS (1%); listed ones also NLST (2.5%). */
export function isShareholding(form: LegalForm): boolean {
  return form === 'kscc' || form === 'ksc_listed';
}

/**
 * Cash limits by activity, in Kuwaiti dinars. `null` means no limit; 0 means
 * cash is not accepted at all. Sources: MOCI Decision 32/2026 (KD 10 for
 * health, salons, sports clubs and pest control), the 2024 ban on cash for
 * vehicle sales, Resolution 182/2025 (gold and precious metals) and the 2026
 * real-estate rules. Keep this table up to date as decisions change.
 */
export const CASH_RULES: Record<BusinessActivity, { label: string; maxCash: number | null }> = {
  general: { label: msg('General trading, services or other'), maxCash: null },
  health: { label: msg('Health institute'), maxCash: 10 },
  salon: { label: msg('Salon (men, women or children)'), maxCash: 10 },
  sports_club: { label: msg('Sports club'), maxCash: 10 },
  pest_control: { label: msg('Pest control'), maxCash: 10 },
  vehicles: { label: msg('Vehicle sales'), maxCash: 0 },
  gold_jewellery: { label: msg('Gold, jewellery and precious metals'), maxCash: 0 },
  real_estate: { label: msg('Real estate'), maxCash: 0 },
};

/** The most cash (KWD) the business may take in one payment, or null for no limit. */
export function cashLimit(activity: BusinessActivity): number | null {
  return CASH_RULES[activity]?.maxCash ?? null;
}
