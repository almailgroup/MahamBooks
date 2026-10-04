import type { NumberingRule } from '@/db/types';

/**
 * Document counters never go back when two devices number at once: for each
 * kind of document the counter of the later period wins, and in the same
 * period the higher counter. Pattern, padding and reset come from `next` (a
 * change of reset takes `next` as it is). The database applies the same rule
 * to every save of the company record; the app applies it when its own copy
 * has unsent changes, so it doesn't hand out a number already used.
 */
export function mergeNumberingRule(
  old: NumberingRule | undefined,
  next: NumberingRule | undefined,
): NumberingRule | undefined {
  if (!next || typeof next !== 'object') return old;
  if (!old || typeof old !== 'object') return next;
  if ((old.reset ?? '') !== (next.reset ?? '')) return next;
  const oldPeriod = old.period ?? '';
  const newPeriod = next.period ?? '';
  if (newPeriod > oldPeriod) return next;
  if (oldPeriod > newPeriod) return { ...next, period: oldPeriod, next: old.next };
  const oldNext = typeof old.next === 'number' ? old.next : 0;
  const newNext = typeof next.next === 'number' ? next.next : 0;
  return oldNext > newNext ? { ...next, next: old.next } : next;
}

export function mergeNumbering<T extends Record<string, NumberingRule>>(
  old: T | undefined,
  next: T | undefined,
): T | undefined {
  if (!next || typeof next !== 'object') return old;
  if (!old || typeof old !== 'object') return next;
  const merged: Record<string, NumberingRule> = {};
  for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
    const rule = mergeNumberingRule(old[key], next[key]);
    if (rule) merged[key] = rule;
  }
  return merged as T;
}
