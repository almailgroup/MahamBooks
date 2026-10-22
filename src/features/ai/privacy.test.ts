import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { saveClient, saveCompany, setupCompany } from '@/db/records';
import { createClient } from '@/db/defaults';
import { createEmployee, saveEmployee } from '@/db/people';
import type { Company } from '@/db/types';
import { createAiClient, type StreamOptions } from './client';
import { AiError } from './errors';
import { knownValues } from './known-values';
import { foldValue, type KnownValue } from './scrub';
import {
  assistantState,
  claimConversation,
  forgetConversation,
  resetAssistantForTests,
  sendQuestion,
} from './store';

/**
 * What reaches the AI service: every request body the client builds for the
 * chat, over a fake Worker, with an employee, a customer and the company's
 * bank account seeded on this device and their numbers typed into the
 * questions in every way a person might. None of them may be in any body,
 * in any digit form, and every request asks for a short answer. And the
 * conversation is forgotten, the answer stopped, when the person or their
 * access changes. Made-up company, people and numbers only.
 */

const BASE = 'https://ai.example.test';

/** Never-send values: made up, the Civil IDs and the IBAN made up to pass their checks. */
const SEEDED = {
  civilId: '287041512345',
  passportNumber: 'X98765',
  residencyNumber: '123456789',
  workPermitNumber: 'WP-55443',
  centralCardNumber: 'CC-778899',
  pifssNumber: '7766554',
  iban: 'KW81CBKU0000000000001234560101',
  accountNumber: '0011223344',
  customerCivilId: '295123100125',
  companyIban: 'GB82WEST12345698765432',
  companyAccount: '55667788990',
};

const arabicDigits = (text: string) =>
  text.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
const grouped = (text: string) => text.replace(/(.{4})(?=.)/g, '$1 ');

/** Every way a value could show in a body: as stored, without separators, in Arabic-Indic digits. */
function forms(value: string): string[] {
  const compact = value.replace(/[\s-]/g, '');
  return [...new Set([value, compact, compact.toLowerCase(), arabicDigits(compact)])];
}

interface Sent {
  body: Record<string, unknown>;
  raw: string;
}

function fakeWorker() {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
    const raw = String(init.body);
    sent.push({ raw, body: JSON.parse(raw) as Record<string, unknown> });
    const event = (text: string) =>
      `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] })}\r\n\r\n`;
    return new Response(event('Open Maham People → Employees.'), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });
  const client = createAiClient({
    fetch: fetch as unknown as typeof globalThis.fetch,
    getToken: async () => 'made.up.token',
    baseUrl: BASE,
    online: () => true,
  });
  return { sent, client };
}

async function answered() {
  await vi.waitFor(() => {
    const last = assistantState().turns.at(-1);
    expect(last?.status).toBe('done');
  });
}

let company: Company;
let known: KnownValue[];

beforeEach(async () => {
  await db.delete();
  await db.open();
  company = await setupCompany({ name: 'Made-up Guarding Co', currency: 'KWD' });
  company = await saveCompany({
    ...company,
    bankAccount: {
      bankCode: '',
      bankName: 'Made-up Bank',
      accountName: 'Made-up Guarding Co',
      iban: SEEDED.companyIban,
      accountNumber: SEEDED.companyAccount,
      swift: '',
      extra: '',
    },
  });
  await saveEmployee(
    createEmployee(company.id, {
      name: 'Imaginary Guard Person',
      civilId: SEEDED.civilId,
      passportNumber: SEEDED.passportNumber,
      residencyNumber: SEEDED.residencyNumber,
      workPermitNumber: SEEDED.workPermitNumber,
      centralCardNumber: SEEDED.centralCardNumber,
      pifssNumber: SEEDED.pifssNumber,
      iban: SEEDED.iban,
      accountNumber: SEEDED.accountNumber,
    }),
  );
  await saveClient(
    createClient(company.id, { name: 'Made-up Customer', civilId: SEEDED.customerCivilId }),
  );
  known = await knownValues(company.id);
});

afterEach(() => resetAssistantForTests());

describe('the request body', () => {
  it('never holds a seeded never-send value, however it was typed, and asks for 2048 tokens', async () => {
    const { sent, client } = fakeWorker();
    resetAssistantForTests((options: StreamOptions) => client.streamChat(options));
    const questions = [
      `His Civil ID is ${SEEDED.civilId}, passport ${SEEDED.passportNumber.toLowerCase()} and residency ${grouped(SEEDED.residencyNumber)}.`,
      `رقم البطاقة المدنية ${arabicDigits(SEEDED.civilId)} والإقامة ${arabicDigits(SEEDED.residencyNumber)}، ما العمل؟`,
      `Permit ${SEEDED.workPermitNumber.replace('-', ' ')}, card ${SEEDED.centralCardNumber}, PIFSS ${SEEDED.pifssNumber}`,
      `Pay to ${grouped(SEEDED.iban)} or account ${grouped(SEEDED.accountNumber)}`,
      `حوّل إلى ${arabicDigits(grouped(SEEDED.iban))}`,
      `Customer ${SEEDED.customerCivilId}; our IBAN ${grouped(SEEDED.companyIban)}, account ${SEEDED.companyAccount}`,
    ];
    for (const question of questions) {
      sendQuestion(question, 'You are the Maham One assistant.', known);
      await answered();
    }
    expect(sent).toHaveLength(questions.length);
    for (const [i, { raw, body }] of sent.entries()) {
      for (const value of Object.values(SEEDED)) {
        for (const form of forms(value)) expect(raw, `body ${i}: ${form}`).not.toContain(form);
      }
      expect(body.generationConfig).toEqual({
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: 'low' },
      });
    }
    // Each body carries the conversation so far, hidden the same way.
    expect((sent.at(-1)!.body.contents as unknown[]).length).toBe(questions.length * 2 - 1);
    expect(sent[0].raw).toContain('[ID number hidden]');
    expect(sent[1].raw).toContain('[رقم هوية مخفي]');
    // The person sees what was sent, and a note of what was hidden.
    const asked = assistantState().turns.filter((turn) => turn.role === 'user');
    expect(asked.map((turn) => turn.hidden)).toEqual([
      { id: 3 },
      { id: 2 },
      { id: 3 },
      { iban: 1, account: 1 },
      { iban: 1 },
      { id: 1, iban: 1, account: 1 },
    ]);
    expect(asked[0].text).toBe(
      'His Civil ID is [ID number hidden], passport [ID number hidden] and residency [ID number hidden].',
    );
  });

  it('never holds one written with odd spaces, dots or line breaks, nor the other records’ numbers', async () => {
    const more = {
      receiverCivilId: '286022012341',
      drawerCivilId: '279121512340',
      holderCivilId: '300010112349',
      paperNumber: 'Q4455667',
    };
    await db.documents.put({
      id: 'note-1',
      companyId: company.id,
      type: 'delivery_note',
      receiverCivilId: more.receiverCivilId,
    } as never);
    await db.payments.put({
      id: 'payment-1',
      companyId: company.id,
      cheque: { drawerCivilId: more.drawerCivilId },
    } as never);
    await db.securityCheques.put({
      id: 'security-1',
      companyId: company.id,
      drawerCivilId: more.holderCivilId,
    } as never);
    await db.complianceDocuments.put({
      id: 'paper-1',
      companyId: company.id,
      type: 'passport',
      number: more.paperNumber,
    } as never);
    const all = await knownValues(company.id);
    const { sent, client } = fakeWorker();
    resetAssistantForTests((options: StreamOptions) => client.streamChat(options));
    const nbsp = (text: string) => text.replace(/(.{4})(?=.)/g, '$1\u00a0');
    const questions = [
      `dots ${SEEDED.civilId.replace(/(.{4})(?=.)/g, '$1.')} and ${SEEDED.residencyNumber.replace(/(.{3})(?=.)/g, '$1,')}`,
      `split ${SEEDED.civilId.slice(0, 6)}\n${SEEDED.civilId.slice(6)} end`,
      `no-break ${nbsp(SEEDED.iban)} and ${nbsp(SEEDED.companyIban)}`,
      `marks ${SEEDED.accountNumber.split('').join('\u200f')} end`,
      `receiver ${more.receiverCivilId.slice(0, 6)}\n${more.receiverCivilId.slice(6)}`,
      `cheque by ${more.drawerCivilId.replace(/(.{4})(?=.)/g, '$1/')}, held by ${arabicDigits(more.holderCivilId)}`,
      `the paper q 4455 667`,
    ];
    for (const question of questions) {
      sendQuestion(question, 'You are the Maham One assistant.', all);
      await answered();
    }
    expect(sent).toHaveLength(questions.length);
    for (const [i, { body }] of sent.entries()) {
      const typed = (body.contents as { role: string; parts: { text: string }[] }[])
        .filter((content) => content.role === 'user')
        .map((content) => foldValue(content.parts[0].text));
      for (const value of [...Object.values(SEEDED), ...Object.values(more)]) {
        for (const text of typed)
          expect(text, `body ${i}: ${value}`).not.toContain(foldValue(value));
      }
    }
    expect(
      assistantState()
        .turns.filter((turn) => turn.role === 'user')
        .every((turn) => turn.hidden !== undefined),
    ).toBe(true);
  });

  it('is sent as typed when nothing in it is private', async () => {
    const { sent, client } = fakeWorker();
    resetAssistantForTests((options: StreamOptions) => client.streamChat(options));
    sendQuestion('How do I record annual leave for 12 days?', 'System.', known);
    await answered();
    expect(sent[0].body.contents).toEqual([
      { role: 'user', parts: [{ text: 'How do I record annual leave for 12 days?' }] },
    ]);
    expect(assistantState().turns[0].hidden).toBeUndefined();
  });
});

describe('forgetting the conversation', () => {
  /** A service that never answers until stopped. */
  function hanging() {
    const signals: AbortSignal[] = [];
    const ask = (options: StreamOptions) =>
      new Promise<{ text: string }>((_resolve, reject) => {
        signals.push(options.signal!);
        options.signal?.addEventListener('abort', () => reject(new AiError('aborted')));
      });
    return { signals, ask };
  }

  it('stops the answer and forgets everything when the person signs out or it is switched off', async () => {
    const { signals, ask } = hanging();
    resetAssistantForTests(ask);
    claimConversation('user-1:company-1', '["owner",null]');
    sendQuestion('A question', 'System.', known);
    expect(assistantState().turns).toHaveLength(2);
    forgetConversation();
    expect(signals[0].aborted).toBe(true);
    await Promise.resolve();
    expect(assistantState()).toMatchObject({ turns: [], draft: '', pending: null, open: false });
  });

  it('starts again when the person’s role or access changes, but not while it is being read', () => {
    const { signals, ask } = hanging();
    resetAssistantForTests(ask);
    claimConversation('user-1:company-1', '["admin",null]');
    sendQuestion('A question', 'System.', known);
    // Read again (the app drawn in another language): nothing changes.
    claimConversation('user-1:company-1', null);
    claimConversation('user-1:company-1', '["admin",null]');
    expect(assistantState().turns).toHaveLength(2);
    expect(signals[0].aborted).toBe(false);
    // The owner limits this admin to viewing Maham People.
    claimConversation('user-1:company-1', '["admin",{"apps":{"people":"view"}}]');
    expect(signals[0].aborted).toBe(true);
    expect(assistantState().turns).toEqual([]);
  });

  it('starts again in another company', () => {
    const { signals, ask } = hanging();
    resetAssistantForTests(ask);
    claimConversation('user-1:company-1', '["owner",null]');
    sendQuestion('A question', 'System.', known);
    claimConversation('user-1:company-2', null);
    expect(signals[0].aborted).toBe(true);
    expect(assistantState().turns).toEqual([]);
  });
});
