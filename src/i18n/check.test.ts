import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Dictionary } from './index';

const SRC = join(__dirname, '..');

const parts = import.meta.glob<{ default: Dictionary }>('./ar/*.ts', { eager: true });
const arabic: Dictionary = Object.assign({}, ...Object.values(parts).map((p) => p.default));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'ar' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const STRING = String.raw`'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"`;
const SINGLE = new RegExp(String.raw`(?<![\w.])(?:t|msg|tr)\(\s*(?:${STRING})`, 'g');
const PLURAL = new RegExp(
  String.raw`(?<![\w.])tp\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*(?:${STRING})\s*,\s*(?:${STRING})`,
  'g',
);
const TEMPLATE = /(?<![\w.])(?:t|tp|msg|tr)\(\s*`/g;

const unescape = (s: string) => s.replace(/\\(['"\\])/g, '$1');

interface Key {
  text: string;
  plural: boolean;
  file: string;
}

function collectKeys(): { keys: Key[]; templateCalls: string[] } {
  const keys: Key[] = [];
  const templateCalls: string[] = [];
  for (const path of sourceFiles(SRC)) {
    // Examples in comments are not interface text.
    const source = readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const file = relative(SRC, path);
    for (const m of source.matchAll(SINGLE)) {
      keys.push({ text: unescape(m[1] ?? m[2]), plural: false, file });
    }
    for (const m of source.matchAll(PLURAL)) {
      keys.push({ text: unescape(m[3] ?? m[4]), plural: true, file });
    }
    if (TEMPLATE.test(source)) templateCalls.push(file);
    TEMPLATE.lastIndex = 0;
  }
  return { keys, templateCalls };
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('Arabic translations', () => {
  const { keys, templateCalls } = collectKeys();

  it('only translate plain string literals', () => {
    expect(templateCalls).toEqual([]);
  });

  it('cover every interface string', () => {
    const missing = [
      ...new Set(keys.filter((k) => !(k.text in arabic)).map((k) => `${k.file}: ${k.text}`)),
    ];
    expect(missing).toEqual([]);
  });

  it('keep the placeholders of the English text', () => {
    const wrong: string[] = [];
    for (const key of keys) {
      const entry = arabic[key.text];
      if (entry === undefined) continue;
      const expected = placeholders(key.text);
      const forms = typeof entry === 'string' ? [entry] : Object.values(entry);
      for (const form of forms) {
        if (!form) continue;
        const got = placeholders(form);
        // Plural forms may spell the number out ("فاتورتان") instead of {count}.
        const ok = key.plural
          ? got.every((p) => expected.includes(p)) &&
            expected.filter((p) => p !== 'count').every((p) => got.includes(p))
          : JSON.stringify([...new Set(got)]) === JSON.stringify([...new Set(expected)]);
        if (!ok) wrong.push(`${key.text} → ${form}`);
      }
    }
    expect([...new Set(wrong)]).toEqual([]);
  });

  it('translate the same text the same way in every file', () => {
    const seen = new Map<string, string>();
    const conflicts: string[] = [];
    for (const [file, part] of Object.entries(parts)) {
      for (const [key, value] of Object.entries(part.default)) {
        const text = JSON.stringify(value);
        const before = seen.get(key);
        if (before !== undefined && before !== text) conflicts.push(`${file}: ${key}`);
        seen.set(key, text);
      }
    }
    expect(conflicts).toEqual([]);
  });

  it('have no empty translations', () => {
    const empty = Object.entries(arabic)
      .filter(([, v]) => (typeof v === 'string' ? !v.trim() : !v.other?.trim()))
      .map(([k]) => k);
    expect(empty).toEqual([]);
  });
});
