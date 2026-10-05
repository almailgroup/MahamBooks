import { useCallback } from 'react';
import { db } from '@/db/db';
import type { Client, InvoiceDocument } from '@/db/types';
import { DOCUMENT_LABELS, useCompany, useFormat } from '@/app/company';
import { contactPosition, creditCheck, exposureIncrease } from '@/lib/statements';
import { today } from '@/lib/dates';
import { fromMinor } from '@/lib/money';
import { documentTaxExempt } from '@/lib/document-calc';
import { t } from '@/i18n';
import { useConfirm } from '@/components/ui/overlay';

/**
 * Checks a customer's credit before an invoice or sales order is saved: on
 * credit hold it asks for an explicit override; over the credit limit it
 * warns. Resolves to whether saving may go ahead.
 */
export function useCreditCheck(): (
  doc: InvoiceDocument,
  client: Client | null | undefined,
) => Promise<boolean> {
  const confirm = useConfirm();
  const company = useCompany();
  const fmt = useFormat();
  return useCallback(
    async (doc, client) => {
      if (!client || (doc.type !== 'invoice' && doc.type !== 'sales_order')) return true;
      const limited = client.creditLimit !== null && client.creditLimit !== undefined;
      if (!client.creditHold && !limited) return true;
      const [documents, payments, saved] = await Promise.all([
        db.documents.where('clientId').equals(client.id).toArray(),
        db.payments.where('clientId').equals(client.id).toArray(),
        db.documents.get(doc.id),
      ]);
      const position = contactPosition({
        side: 'customer',
        client,
        documents,
        payments,
        companyCurrency: company.currency,
        todayIso: today(),
      });
      const increase = exposureIncrease(
        doc,
        saved,
        company.currency,
        documentTaxExempt(doc, client),
      );
      const check = creditCheck(client, position, increase, !saved);
      if (check.status === 'ok') return true;
      const money = (minor: number) => fmt.money(fromMinor(minor, position.precision));
      const document = t(DOCUMENT_LABELS[doc.type].singular).toLowerCase();
      if (check.status === 'hold') {
        return confirm({
          title: t('{name} is on credit hold', { name: client.name }),
          description: t(
            'Save this {document} anyway? What they owe, with cheques not yet cleared, would be {amount}.',
            { document, amount: money(check.projected) },
          ),
          confirmLabel: t('Override and save'),
          danger: true,
        });
      }
      return confirm({
        title: t('This takes {name} over their credit limit', { name: client.name }),
        description: t('Credit used would be {projected}: {over} over the limit of {limit}.', {
          projected: money(check.projected),
          over: money(check.over),
          limit: money(check.limit),
        }),
        confirmLabel: t('Save anyway'),
      });
    },
    [confirm, company.currency, fmt],
  );
}
