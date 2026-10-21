import { db, getMeta, setMeta } from './db';
import { logActivity } from './activity';
import { nowStamp } from './defaults';
import type { ChequeDetails, ChequeLayout, ChequePrintedText, ID, Payment } from './types';
import {
  isPresetLayoutId,
  layoutProblem,
  presetLayout,
  presetLayoutId,
  sameMeasurements,
} from '@/lib/cheque-layouts';
import {
  onSpoiledLeaf,
  printableAfterLeaf,
  printedLeafNumber,
  printRefusal,
  REFUSAL_TEXT,
  spoilPrintedLeaf,
} from '@/lib/cheque-print';
import { newId } from '@/lib/ids';
import { companyHasFeature } from '@/cloud/features';
import { msg, t } from '@/i18n';

/**
 * Cheque layouts and the record of what was printed on each cheque issued
 * (lib/cheque-print.ts has the rules). Every print and every spoiled leaf is
 * logged: two printed leaves would be two cheques. Printing posts nothing.
 */

export class ChequePrintError extends Error {}

type ChequePayment = Payment & { cheque: ChequeDetails };

/**
 * Layouts change only once the company prints cheques (D1), and are kept
 * with the company's records, which a cloud company's server must know.
 */
async function assertLayoutsAllowed(companyId: ID) {
  if (!(await db.companies.get(companyId))?.chequePrinting) {
    throw new ChequePrintError(t('Cheque printing is off for this company.'));
  }
  if (!(await companyHasFeature(companyId, 'tables_v16'))) {
    throw new ChequePrintError(
      t('Saving cheque layouts needs the latest database script. Ask the owner to run it.'),
    );
  }
}

/**
 * Saves a company's layout of a bank. A built-in layout is saved as the
 * company's own (it then replaces the built-in one); its version goes up
 * when its measurements change, so a print says which version it used, and
 * it is no longer marked as checked against a real leaf.
 */
export async function saveChequeLayout(input: ChequeLayout): Promise<ChequeLayout> {
  await assertLayoutsAllowed(input.companyId);
  const problem = layoutProblem(input);
  if (problem) throw new ChequePrintError(t(problem));
  const fromPreset = isPresetLayoutId(input.id);
  const saved = await db.transaction('rw', [db.chequeLayouts, db.activities], async () => {
    const existing = fromPreset ? undefined : await db.chequeLayouts.get(input.id);
    if (existing && existing.companyId !== input.companyId) {
      throw new ChequePrintError(t('Cheque layout not found.'));
    }
    const base = existing ?? presetLayout(input.bank, input.companyId);
    const stamp = nowStamp();
    const moved = base !== null && !sameMeasurements(base, input);
    const layout: ChequeLayout = {
      ...input,
      // Checked against a real leaf with the old measurements, not the new
      // ones (unless the check is what this change records).
      calibrated: moved ? input.calibrated && !base.calibrated : input.calibrated,
      id: fromPreset ? newId() : input.id,
      bank: input.bank.trim().toUpperCase(),
      name: input.name.trim(),
      ...(input.nameAr?.trim() ? { nameAr: input.nameAr.trim() } : {}),
      version: base ? (existing?.version ?? base.version) + (moved ? 1 : 0) : 1,
      archived: false,
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp,
    };
    if (!input.nameAr?.trim()) delete layout.nameAr;
    await db.chequeLayouts.put(layout);
    await logActivity(
      layout.companyId,
      'cheque',
      layout.id,
      existing ? 'updated' : 'created',
      existing
        ? { text: msg('Cheque layout {name} updated'), vars: { name: layout.name } }
        : { text: msg('Cheque layout {name} saved'), vars: { name: layout.name } },
    );
    return layout;
  });
  // This printer's offset for the built-in layout carries over.
  if (fromPreset) {
    const offset = await getMeta<unknown>(offsetKey(input.id), null);
    if (offset) await setMeta(offsetKey(saved.id), offset);
  }
  return saved;
}

/** Stops using the company's layout of a bank: its built-in layout prints again. */
export async function archiveChequeLayout(id: ID): Promise<void> {
  const layout = await db.chequeLayouts.get(id);
  if (!layout) throw new ChequePrintError(t('Cheque layout not found.'));
  await assertLayoutsAllowed(layout.companyId);
  await db.transaction('rw', [db.chequeLayouts, db.activities], async () => {
    await db.chequeLayouts.put({ ...layout, archived: true, updatedAt: nowStamp() });
    await logActivity(layout.companyId, 'cheque', layout.id, 'archived', {
      text: msg('Cheque layout {name} put away: the built-in layout prints again'),
      vars: { name: layout.name },
    });
  });
}

async function loadIssued(paymentId: ID): Promise<ChequePayment> {
  const payment = await db.payments.get(paymentId);
  if (!payment?.cheque || payment.method !== 'cheque') {
    throw new ChequePrintError(t('Cheque not found.'));
  }
  return payment as ChequePayment;
}

const refs = (payment: Payment) => ({
  clientId: payment.clientId || null,
  documentId: payment.documentIds[0] ?? null,
});

/**
 * Logs that the cheque was sent to the printer, before anyone says whether
 * it printed: a leaf that printed but was never recorded still leaves a trace.
 */
export async function recordChequePrintAttempt(paymentId: ID): Promise<void> {
  const payment = await loadIssued(paymentId);
  await logActivity(
    payment.companyId,
    'payment',
    payment.id,
    'cheque_print_sent',
    {
      text: msg('Cheque {number} on payment {payment} sent to the printer'),
      vars: { number: payment.cheque.number, payment: payment.number },
    },
    refs(payment),
  );
}

/** Records that the cheque printed correctly on its leaf. */
export async function recordChequePrinted(
  paymentId: ID,
  input: { layout: Pick<ChequeLayout, 'id'>; text: ChequePrintedText; crossed: boolean },
): Promise<Payment> {
  return db.transaction('rw', [db.payments, db.companies, db.activities], async () => {
    const payment = await loadIssued(paymentId);
    const company = await db.companies.get(payment.companyId);
    if (!company?.chequePrinting) {
      throw new ChequePrintError(t('Cheque printing is off for this company.'));
    }
    const refusal = printRefusal(payment);
    if (refusal) throw new ChequePrintError(t(REFUSAL_TEXT[refusal]));
    const cheque: ChequeDetails = {
      ...payment.cheque,
      printedAt: nowStamp(),
      printCount: (payment.cheque.printCount ?? 0) + 1,
      printedLayoutId: input.layout.id,
      // With its leaf: a change made where printing isn't known shows (printedLeafChanged).
      printedText: {
        ...input.text,
        number: payment.cheque.number.trim(),
        bank: payment.cheque.bank.trim().toUpperCase(),
        ...(payment.clientId ? { vendorId: payment.clientId } : {}),
      },
    };
    if (input.crossed) cheque.crossed = true;
    else delete cheque.crossed;
    const next: Payment = { ...payment, cheque, updatedAt: nowStamp() };
    await db.payments.put(next);
    await logActivity(
      payment.companyId,
      'payment',
      payment.id,
      'cheque_printed',
      {
        text: msg('Cheque {number} on payment {payment} printed'),
        vars: { number: cheque.number, payment: payment.number },
      },
      refs(payment),
    );
    return next;
  });
}

/**
 * Records a spoiled leaf: one that printed wrongly (`text` is what was just
 * printed), or the printed one, to print the cheque again. The cheque moves
 * to the next leaf, `nextNumber`.
 */
export async function recordSpoiledLeaf(
  paymentId: ID,
  input: { reason: string; nextNumber: string; text?: ChequePrintedText },
): Promise<Payment> {
  return db.transaction('rw', [db.payments, db.activities], async () => {
    const payment = await loadIssued(paymentId);
    const refusal = printRefusal(payment);
    if (!printableAfterLeaf(refusal)) throw new ChequePrintError(t(REFUSAL_TEXT[refusal!]));
    const old = payment.cheque;
    // The leaf spoiled: the one printed, unless this is a misprint just now.
    const leaf = old.printedAt && !input.text ? printedLeafNumber(old) : old.number.trim();
    const number = input.nextNumber.trim();
    if (!number) throw new ChequePrintError(t('Enter the number of the next leaf.'));
    // A number given to the cheque on another device after printing was never printed: it may be the next.
    const used = new Set([leaf, ...(old.spoiledLeaves ?? []).map((l) => l.number)]);
    if ([...used].some((n) => n.trim() === number)) {
      throw new ChequePrintError(t('Leaf {number} is spoiled: enter the next one.', { number }));
    }
    const bank = old.bank.trim().toUpperCase();
    const others = await db.payments
      .where('companyId')
      .equals(payment.companyId)
      .filter(
        (p) =>
          p.id !== payment.id &&
          p.direction === 'out' &&
          p.cheque?.bank.trim().toUpperCase() === bank,
      )
      .toArray();
    const taken = others.find((p) => !p.voided && p.cheque?.number.trim() === number);
    if (taken) {
      throw new ChequePrintError(
        t('Cheque {number} is already recorded on payment {payment}.', {
          number,
          payment: taken.number,
        }),
      );
    }
    if (others.some((p) => p.cheque?.spoiledLeaves?.some((l) => l.number.trim() === number))) {
      throw new ChequePrintError(t('Leaf {number} is spoiled: enter the next one.', { number }));
    }
    const printed: ChequeDetails = input.text ? { ...old, printedText: input.text } : old;
    // Its leaf was recorded spoiled when the cheque changed after printing:
    // the cheque only moves to the next leaf.
    const moveOnly = !input.text && !old.printedAt && onSpoiledLeaf(old);
    const cheque: ChequeDetails = {
      ...(moveOnly
        ? old
        : spoilPrintedLeaf(printed, old, input.reason || t('Spoiled'), nowStamp())),
      number,
      // A misprint just now is a print too.
      ...(input.text ? { printCount: (old.printCount ?? 0) + 1 } : {}),
    };
    const next: Payment = {
      ...payment,
      // The reference was the cheque's number: it follows it.
      reference: payment.reference.trim() === old.number.trim() ? number : payment.reference,
      cheque,
      updatedAt: nowStamp(),
    };
    await db.payments.put(next);
    await logActivity(
      payment.companyId,
      'payment',
      payment.id,
      moveOnly ? 'cheque_leaf_changed' : 'cheque_leaf_spoiled',
      moveOnly
        ? {
            text: msg('Payment {payment} is now on cheque leaf {next}'),
            vars: { payment: payment.number, next: number },
          }
        : {
            text: msg('Cheque leaf {number} spoiled; payment {payment} is now on leaf {next}'),
            vars: { number: leaf, payment: payment.number, next: number },
          },
      refs(payment),
    );
    return next;
  });
}

/** A payment whose record of cheque leaves a change from another device took away. */
export interface LostChequeLeaves {
  /** The payment as it was here before the change. */
  payment: Payment;
  /** The leaves no longer recorded (lib/cheque-print lostChequeLeaves). */
  numbers: string[];
}

/**
 * Logs cheque leaves whose record a change from another device took away: a
 * device on an older version of the app made a printed cheque another way of
 * paying, or deleted it. A printed leaf is still a cheque, so the log keeps
 * it on record. Logged once per payment and leaves on this device.
 */
export async function logLostChequeLeaves(companyId: ID, lost: LostChequeLeaves[]): Promise<void> {
  for (const { payment, numbers } of lost) {
    if (payment.companyId !== companyId || numbers.length === 0) continue;
    const list = numbers.join(', ');
    const logged = await db.activities
      .where('entityId')
      .equals(payment.id)
      .filter((a) => a.action === 'cheque_leaves_lost' && a.messageVars?.numbers === list)
      .count();
    if (logged) continue;
    await logActivity(
      companyId,
      'payment',
      payment.id,
      'cheque_leaves_lost',
      {
        text: msg(
          'Payment {payment} was changed or deleted on another device, and with it the record of cheque leaves {numbers}. A printed leaf still in hand is a cheque: destroy it.',
        ),
        vars: { payment: payment.number, numbers: list },
      },
      refs(payment),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* This printer                                                               */
/* -------------------------------------------------------------------------- */

export interface ChequeOffset {
  /** Millimetres to the right (negative: to the left). */
  x: number;
  /** Millimetres down (negative: up). */
  y: number;
}

const offsetKey = (layoutId: ID) => `cheque-offset:${layoutId}`;

function readOffset(value: unknown): ChequeOffset | null {
  const raw = value as Partial<ChequeOffset> | null;
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  return raw && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * How far this device's printer is off for a layout (kept on the device
 * only, never synced or backed up). A company layout made on another device
 * starts from this printer's offset for its bank's built-in layout.
 */
export async function deviceChequeOffset(
  layout: Pick<ChequeLayout, 'id' | 'bank'>,
): Promise<ChequeOffset> {
  const own = readOffset(await getMeta<unknown>(offsetKey(layout.id), null));
  if (own) return own;
  const preset = readOffset(await getMeta<unknown>(offsetKey(presetLayoutId(layout.bank)), null));
  return preset ?? { x: 0, y: 0 };
}

export async function setDeviceChequeOffset(layoutId: ID, offset: ChequeOffset): Promise<void> {
  const clamp = (n: number) => Math.max(-15, Math.min(15, Math.round(n * 10) / 10));
  await setMeta(offsetKey(layoutId), { x: clamp(offset.x), y: clamp(offset.y) });
}
