import { db } from '@/db/db';
import type { CloudLink } from './types';

/**
 * What a company's server has beyond the first migrations, as
 * public.server_features reports it. A feature that keeps records the
 * server must know about stays hidden until the owner has run the
 * migration that adds them: an older server would refuse every one of them.
 * The answer is kept on the link and asked again as the company syncs (see
 * refreshFeatures in sync.ts).
 */
export type ServerFeature =
  /** 20261102000000_tables_v16.sql: cheque layouts, vehicles, approvals and letters. */
  'tables_v16';

/**
 * Whether a company may use a feature: always when it is kept on this
 * device only (`link` null), in the cloud once its server has said it has it.
 */
export function linkHasFeature(link: CloudLink | null, feature: ServerFeature): boolean {
  if (link === null) return true;
  return link.features?.includes(feature) ?? false;
}

/** linkHasFeature for a company, outside React. */
export async function companyHasFeature(
  companyId: string,
  feature: ServerFeature,
): Promise<boolean> {
  return linkHasFeature((await db.syncState.get(companyId)) ?? null, feature);
}
