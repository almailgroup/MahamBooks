import { describe, expect, it } from 'vitest';
import {
  issuesLetters,
  keepIssuedLetter,
  keepLettersSwitch,
  letterContent,
  letterKept,
  letterWriteRefusal,
  lettersSwitchedOn,
  peopleSettingsKept,
  switchesLetters,
} from './roles';

/**
 * Employee letters (#19), as records_guard and can_delete_record of
 * 20261130000000_people_alerts.sql decide them on the device: who issues,
 * what an issued letter allows, and the letters switch.
 */

const draft = { id: 'let-1', status: 'draft', number: '', body: 'Text' };
const issued = { ...draft, status: 'issued', number: 'HR-2026-0001', body: 'Done' };

describe('letters on the device', () => {
  it('issue for the owner, admins and approvers; everyone on a company kept here', () => {
    expect(issuesLetters('owner', false)).toBe(true);
    expect(issuesLetters('admin', false)).toBe(true);
    expect(issuesLetters('accountant', true)).toBe(true);
    expect(issuesLetters('accountant', false)).toBe(false);
    expect(issuesLetters('staff', true)).toBe(false);
    expect(issuesLetters(null, undefined)).toBe(true);
    expect(switchesLetters('admin')).toBe(true);
    expect(switchesLetters('accountant')).toBe(false);
    expect(lettersSwitchedOn({ letters: true })).toBe(true);
    expect(lettersSwitchedOn({ letters: 'true' })).toBe(false);
    expect(lettersSwitchedOn(null)).toBe(false);
  });

  it('refuse what records_guard refuses', () => {
    // Anyone who may write letters drafts.
    expect(letterWriteRefusal(undefined, draft, false)).toBeNull();
    expect(letterWriteRefusal(draft, { ...draft, body: 'Other' }, false)).toBeNull();
    // Only issuers issue, change or void.
    expect(letterWriteRefusal(draft, issued, false)).toBe('issuer');
    expect(letterWriteRefusal(undefined, issued, false)).toBe('issuer');
    expect(letterWriteRefusal(issued, { ...issued, body: 'Other' }, false)).toBe('issuer');
    expect(letterWriteRefusal(issued, { ...issued, status: 'void' }, false)).toBe('issuer');
    expect(letterWriteRefusal(draft, issued, true)).toBeNull();
    // Marking it printed, or sending it again as it is, is anyone's.
    expect(
      letterWriteRefusal(issued, { ...issued, printedAt: 'now', updatedAt: 'x' }, false),
    ).toBeNull();
    expect(letterWriteRefusal(issued, { ...issued }, false)).toBeNull();
    // Never back to a draft, not even for the owner.
    expect(letterWriteRefusal(issued, draft, true)).toBe('issued');
    expect(letterWriteRefusal({ ...issued, status: 'void' }, draft, true)).toBe('issued');
    expect(letterWriteRefusal(issued, undefined, false)).toBeNull();
  });

  it('keep issued and void letters, and drop nulls and print marks from what they say', () => {
    expect(letterKept(draft)).toBe(false);
    expect(letterKept(issued)).toBe(true);
    expect(letterKept({ ...issued, status: 'void' })).toBe(true);
    expect(letterKept({})).toBe(false);
    expect(letterContent({ ...issued, printedAt: 'x', updatedAt: 'y', voidReason: null })).toEqual(
      issued,
    );
  });

  it('keep the switch for anyone but the owner and admins', () => {
    expect(keepLettersSwitch('accountant', { letters: true }, { reminderDays: [] })).toEqual({
      reminderDays: [],
      letters: true,
    });
    expect(keepLettersSwitch('accountant', {}, { letters: true })).toEqual({});
    expect(keepLettersSwitch('accountant', undefined, { letters: true })).toEqual({});
    expect(keepLettersSwitch('admin', { letters: true }, {})).toEqual({});
  });

  it('keep an issued letter as issued and a void one void, as records_guard stores them', () => {
    const voided = { ...issued, status: 'void', voidReason: 'Wrong', voidedOn: '2026-10-21' };
    // A copy that hasn't heard of the void, printed: still void, the print noted.
    expect(
      keepIssuedLetter(voided, {
        ...issued,
        printedAt: '2026-10-22T08:00:00.000Z',
        updatedAt: 'u',
      }),
    ).toEqual({ ...voided, printedAt: '2026-10-22T08:00:00.000Z', updatedAt: 'u' });
    // The later of two prints is kept.
    expect(
      keepIssuedLetter(
        { ...issued, printedAt: '2026-10-22T09:00:00.000Z' },
        { ...issued, printedAt: '2026-10-22T08:00:00.000Z' },
      ),
    ).toEqual({ ...issued, printedAt: '2026-10-22T09:00:00.000Z' });
    // Issued again elsewhere with another number: the first stays.
    expect(keepIssuedLetter(issued, { ...issued, number: 'HR-2026-0002', body: 'Other' })).toEqual(
      issued,
    );
    // Voided, with why and when; voided again, the first void stays.
    expect(
      keepIssuedLetter(issued, {
        ...issued,
        number: 'HR-2026-0002',
        status: 'void',
        voidReason: 'Wrong',
        voidedOn: '2026-10-21',
      }),
    ).toEqual(voided);
    expect(keepIssuedLetter(voided, { ...voided, voidReason: 'Other' })).toEqual(voided);
    // Drafts and new letters pass as they are.
    expect(keepIssuedLetter(draft, issued)).toEqual(issued);
    expect(keepIssuedLetter(undefined, issued)).toEqual(issued);
  });

  it('keep the People settings with the letters on from anyone but the owner and admins', () => {
    expect(peopleSettingsKept('accountant', { letters: true })).toBe(true);
    expect(peopleSettingsKept('accountant', { reminderDays: [] })).toBe(false);
    expect(peopleSettingsKept('admin', { letters: true })).toBe(false);
    expect(peopleSettingsKept('owner', { letters: true })).toBe(false);
    expect(peopleSettingsKept(null, { letters: true })).toBe(false);
  });
});
