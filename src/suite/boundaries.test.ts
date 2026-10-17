// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * How the code of Maham One depends on itself. Each app lives in
 * src/apps/<app>; the suite (src/suite, src/app/routes.tsx) puts them
 * together. Shared code (database, libraries, shell, settings) does not
 * reach into an app, and an app does not reach into another one: it links
 * to the other app's pages instead. The few places that still do are listed
 * here; the list may only get shorter.
 */

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

/** Shared code still using an app's code: moved into the apps' shared layer later. */
const SHARED_TO_APP = [
  'src/app/layout.tsx -> src/apps/books/pages/products/item-opener',
  'src/features/purchases/expense-dialog.tsx -> src/apps/books/features/accounting/account-pickers',
  'src/features/purchases/expense-dialog.tsx -> src/apps/books/features/editor/tax-select',
  'src/features/renewals/renew-dialog.tsx -> src/apps/books/features/accounting/account-pickers',
  'src/pages/settings/accounting.tsx -> src/apps/books/features/reports/report-language',
  'src/test/workbook.ts -> src/apps/books/features/reports/zip',
];

/** Apps using another app's code. */
const APP_TO_APP: string[] = [];

/** Tests may open any app's pages. */
const isTest = (path: string) => /\.test\.tsx?$/.test(path);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// `from '…'`, `import '…'`, `import('…')` and `vi.mock('…')`.
const SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\bvi\.mock\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

/** Every import between files of src, as "from -> to" (paths without extensions). */
function imports(): { from: string; to: string }[] {
  return sourceFiles(SRC).flatMap((file) => {
    const from = relative(ROOT, file).replaceAll('\\', '/');
    return [...readFileSync(file, 'utf8').matchAll(SPECIFIER)].flatMap(([, spec]) => {
      let target: string;
      if (spec.startsWith('@/')) target = join(SRC, spec.slice(2));
      else if (spec.startsWith('.')) target = normalize(join(dirname(file), spec));
      else return [];
      const to = relative(ROOT, target)
        .replaceAll('\\', '/')
        .replace(/\.(tsx?|css)$/, '');
      return [{ from, to }];
    });
  });
}

const appOf = (path: string) => /^src\/apps\/([^/]+)(\/|$)/.exec(path)?.[1] ?? null;
const isSuite = (path: string) =>
  path.startsWith('src/suite/') || path === 'src/app/routes.tsx' || path === 'src/app/router.tsx';

describe('the boundaries between the apps', () => {
  const all = imports();

  it('finds the imports it checks', () => {
    // A broken pattern would make every rule pass.
    expect(all.length).toBeGreaterThan(1000);
    expect(all).toContainEqual({ from: 'src/app/routes.tsx', to: 'src/apps/books/routes' });
  });

  it('keeps shared code out of the apps', () => {
    const found = all
      .filter(({ from, to }) => appOf(to) && !appOf(from) && !isSuite(from) && !isTest(from))
      .map(({ from, to }) => `${from} -> ${to}`);
    expect([...new Set(found)].sort()).toEqual(SHARED_TO_APP);
  });

  it('keeps each app out of the others', () => {
    const found = all
      .filter(({ from, to }) => appOf(from) && appOf(to) && appOf(from) !== appOf(to))
      .filter(({ from }) => !isTest(from))
      .map(({ from, to }) => `${from} -> ${to}`);
    expect([...new Set(found)].sort()).toEqual(APP_TO_APP);
  });

  it('builds the apps from their manifests and routes only', () => {
    // The suite reads an app through its manifest, its routes and its pure libraries.
    const found = all
      .filter(({ from, to }) => isSuite(from) && !isTest(from) && appOf(to))
      .map(({ to }) => to)
      .filter((to) => !/^src\/apps\/[^/]+\/(manifest|routes|lib\/[^/]+)$/.test(to));
    expect([...new Set(found)]).toEqual([]);
  });
});
