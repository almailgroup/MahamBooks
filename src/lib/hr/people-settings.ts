import type { ID, PeopleSettings } from '@/db/types';
import { DEFAULT_REMINDER_DAYS } from '@/lib/compliance';
import { EOSI_RULES } from './eosi';

export function defaultPeopleSettings(companyId: ID): PeopleSettings {
  return {
    id: companyId,
    companyId,
    kuwaitizationTarget: null,
    eosDailyDivisor: EOSI_RULES.defaultDailyDivisor,
    reminderDays: [...DEFAULT_REMINDER_DAYS],
    auditFilingMonths: 3,
    pifssDueDay: 15,
    updatedAt: new Date().toISOString(),
  };
}

/** A company's saved people and compliance settings, with defaults for anything not set. */
export function withPeopleDefaults(
  companyId: ID,
  saved: Partial<PeopleSettings> | null | undefined,
): PeopleSettings {
  return { ...defaultPeopleSettings(companyId), ...saved };
}
