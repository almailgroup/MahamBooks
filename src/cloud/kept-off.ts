import { getMeta, setMeta } from '@/db/db';

/**
 * Cloud companies this account removed from this device on purpose. They
 * don't come back to it by themselves (see auto-download.ts); downloading one
 * by hand lets it come again.
 */

const keptOffKey = (userId: string) => `cloud.keptOff.${userId}`;

/** Cloud companies this account removed from this device. */
export async function keptOffDevice(userId: string): Promise<Set<string>> {
  return new Set(await getMeta<string[]>(keptOffKey(userId), []));
}

/** Remembers that a company was removed from this device on purpose. */
export async function keepOffDevice(userId: string, companyId: string): Promise<void> {
  const ids = await keptOffDevice(userId);
  ids.add(companyId);
  await setMeta(keptOffKey(userId), [...ids]);
}

/** The company may come to this device again (it was downloaded by hand). */
export async function allowOnDevice(userId: string, companyId: string): Promise<void> {
  const ids = await keptOffDevice(userId);
  if (!ids.delete(companyId)) return;
  await setMeta(keptOffKey(userId), [...ids]);
}
