import type {
  Branding,
  DocumentDesign,
  DocumentLayout,
  DocumentType,
  InvoiceDocument,
} from '@/db/types';
import { isPrintable } from '@/lib/document-types';

/**
 * The design a document prints with, from the most particular to the most
 * general: the document's own template and colour, then its type's design
 * (Templates > Quotes, Credit notes), then the company's. A company without
 * designs per type prints every document as before.
 */

type Owner = { branding: Branding };

/** The design a type of document has of its own, if any. */
export function typeDesign(company: Owner, type: DocumentType): DocumentDesign | undefined {
  return isPrintable(type) ? company.branding.byType?.[type] : undefined;
}

/** The template a type of document prints with when the document has none of its own. */
export function typeTemplate(company: Owner, type: DocumentType): string {
  return typeDesign(company, type)?.templateId || company.branding.templateId;
}

/** The template a document prints with. */
export function documentTemplate(
  doc: Pick<InvoiceDocument, 'type'> & { templateId?: string | null },
  company: Owner,
): string {
  return doc.templateId || typeTemplate(company, doc.type);
}

/** The colour of a type of document when the document has none of its own. */
export function typeAccent(company: Owner, type: DocumentType): string {
  return typeDesign(company, type)?.accentColor || company.branding.accentColor;
}

/** The brand colour a document prints with. */
export function documentAccent(
  doc: Pick<InvoiceDocument, 'type' | 'accentColor'>,
  company: Owner,
): string {
  return doc.accentColor || typeAccent(company, doc.type);
}

/** The layout a document prints with: its type's, else the company's (empty prints as before). */
export function documentLayout(doc: Pick<InvoiceDocument, 'type'>, company: Owner): DocumentLayout {
  return typeDesign(company, doc.type)?.layout ?? company.branding.layout ?? {};
}

/** The types of document the Templates page designs. */
export type DesignedType = 'invoice' | 'quote' | 'credit';

/**
 * A design of its own for a type, starting as a copy of the company's. The
 * layout is always copied, even an empty one (as before), so later changes
 * to the invoices' layout leave the type's alone.
 */
function companyDesign(branding: Branding): DocumentDesign {
  return {
    templateId: branding.templateId,
    accentColor: branding.accentColor,
    layout: { ...(branding.layout ?? {}) },
  };
}

/**
 * The company with a type's design changed. The invoices' design is the
 * company's own, which proformas, orders and delivery notes (and older
 * versions of the app) print with too; quotes and credit notes get one of
 * their own, starting as a copy of it.
 */
export function withTypeDesign<C extends Owner>(
  company: C,
  type: DesignedType,
  patch: DocumentDesign,
): C {
  const branding = company.branding;
  if (type === 'invoice') {
    const next: Branding = { ...branding };
    if (patch.templateId !== undefined) next.templateId = patch.templateId;
    if (patch.accentColor !== undefined) next.accentColor = patch.accentColor;
    if (patch.layout !== undefined) next.layout = patch.layout;
    return { ...company, branding: next };
  }
  const own = branding.byType?.[type] ?? companyDesign(branding);
  return {
    ...company,
    branding: { ...branding, byType: { ...branding.byType, [type]: { ...own, ...patch } } },
  };
}

/**
 * Quotes or credit notes printed like invoices again (`same`), or with a
 * design of their own, starting as a copy of the invoices'.
 */
export function withSameAsInvoices<C extends Owner>(
  company: C,
  type: Exclude<DesignedType, 'invoice'>,
  same: boolean,
): C {
  const { byType, ...branding } = company.branding;
  if (!same) {
    if (byType?.[type]) return company;
    return withTypeDesign(company, type, {});
  }
  const rest = { ...byType };
  delete rest[type];
  return {
    ...company,
    branding: Object.keys(rest).length ? { ...branding, byType: rest } : branding,
  };
}
