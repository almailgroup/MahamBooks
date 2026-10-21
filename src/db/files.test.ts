import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { setupCompany } from './records';
import { fileFinderOn, setFileFinder } from './files';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('the document finder', () => {
  it('is off until switched on, and logged when it changes', async () => {
    const company = await setupCompany({ name: 'Made-up Trading' });
    expect(fileFinderOn(company)).toBe(false);
    expect(fileFinderOn(null)).toBe(false);
    const logged = () =>
      db.activities
        .where('entityId')
        .equals(company.id)
        .filter((a) => a.message.startsWith('Finding files'))
        .count();

    await setFileFinder(company.id, true);
    expect(fileFinderOn(await db.companies.get(company.id))).toBe(true);
    expect(await logged()).toBe(1);
    // Already on: nothing changes.
    await setFileFinder(company.id, true);
    expect(await logged()).toBe(1);
    await setFileFinder(company.id, false);
    expect((await db.companies.get(company.id))?.fileFinder).toBe(false);
    expect(await logged()).toBe(2);
  });
});
