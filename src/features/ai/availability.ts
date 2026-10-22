import { useCompany } from '@/app/company';
import { cloudConfigured } from '@/cloud/config';
import { useCloudLink } from '@/cloud/hooks';
import { useCloud } from '@/cloud/store';
import type { Company } from '@/db/types';

/**
 * Whether the AI assistant can be used here. It is for companies kept in
 * the cloud, once the owner or an admin turned it on (Company.ai, D1:
 * missing is off), by whoever is signed in with the account the company is
 * kept with: the AI service knows people by their sign-in.
 *
 *   loading     the company's link to the cloud isn't read yet
 *   device      the company is kept on this device only
 *   removed     no longer shared with this person
 *   signed-out  nobody signed in, or another account
 *   off         the company's switch is off
 *   on          ready
 */
export type AiAvailability = 'loading' | 'device' | 'removed' | 'signed-out' | 'off' | 'on';

/** The company's switch (Settings → AI assistant). */
export function aiSwitchOn(company: Pick<Company, 'ai'> | null | undefined): boolean {
  return company?.ai?.on === true;
}

/**
 * The company with the assistant switched on or off. Off is as before the
 * switch existed (D1: no `ai`), unless a later version keeps more there.
 */
export function withAiSwitch(company: Company, on: boolean): Company {
  const { ai, ...rest } = company;
  const { on: _was, ...others } = ai ?? {};
  if (on) return { ...rest, ai: { ...others, on: true } };
  return Object.keys(others).length ? { ...rest, ai: others } : rest;
}

export function useAiAvailability(): AiAvailability {
  const company = useCompany();
  const link = useCloudLink(company.id);
  const { user } = useCloud();
  if (link === undefined) return 'loading';
  if (link === null || !cloudConfigured || company.demo) return 'device';
  if (link.status === 'removed') return 'removed';
  if (!user || user.id !== link.userId) return 'signed-out';
  return aiSwitchOn(company) ? 'on' : 'off';
}
