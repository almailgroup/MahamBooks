import { describe, expect, it } from 'vitest';
import type { Company } from '@/db/types';
import { sampleCompany } from './sample';
import {
  documentAccent,
  documentLayout,
  documentTemplate,
  typeTemplate,
  withSameAsInvoices,
  withTypeDesign,
} from './template-resolve';

/** Made-up company: invoices in Modern and indigo. */
function company(branding: Partial<Company['branding']> = {}): Company {
  const c = sampleCompany();
  return {
    ...c,
    branding: { ...c.branding, templateId: 'modern', accentColor: '#4f46e5', ...branding },
  };
}

describe('the design a document prints with', () => {
  it('is the company’s when nothing else is set, as before', () => {
    const c = company();
    for (const type of ['invoice', 'quote', 'credit', 'proforma', 'delivery_note'] as const) {
      expect(documentTemplate({ type, templateId: null }, c)).toBe('modern');
      expect(documentAccent({ type }, c)).toBe('#4f46e5');
      expect(documentLayout({ type }, c)).toEqual({});
    }
  });

  it('takes the document’s own, then its type’s, then the company’s', () => {
    const c = company({
      layout: { showSku: true },
      byType: {
        quote: { templateId: 'classic', accentColor: '#0f766e', layout: { logoSize: 'large' } },
      },
    });
    // The quote's own design.
    expect(documentTemplate({ type: 'quote', templateId: null }, c)).toBe('classic');
    expect(documentAccent({ type: 'quote' }, c)).toBe('#0f766e');
    expect(documentLayout({ type: 'quote' }, c)).toEqual({ logoSize: 'large' });
    // The document's own template and colour come first.
    expect(documentTemplate({ type: 'quote', templateId: 'bold' }, c)).toBe('bold');
    expect(documentAccent({ type: 'quote', accentColor: '#be123c' }, c)).toBe('#be123c');
    // Invoices keep the company's.
    expect(documentTemplate({ type: 'invoice', templateId: null }, c)).toBe('modern');
    expect(documentAccent({ type: 'invoice' }, c)).toBe('#4f46e5');
    expect(documentLayout({ type: 'invoice' }, c)).toEqual({ showSku: true });
  });

  it('fills in what a type’s design leaves out from the company’s', () => {
    const c = company({
      layout: { showSku: true },
      byType: { credit: { accentColor: '#15803d' } },
    });
    expect(typeTemplate(c, 'credit')).toBe('modern');
    expect(documentAccent({ type: 'credit' }, c)).toBe('#15803d');
    expect(documentLayout({ type: 'credit' }, c)).toEqual({ showSku: true });
  });

  it('ignores designs for bills, which are the vendor’s documents', () => {
    const c = company({ byType: { quote: { templateId: 'classic' } } });
    expect(documentTemplate({ type: 'bill', templateId: null }, c)).toBe('modern');
  });
});

describe('changing a design', () => {
  it('changes the company’s own for invoices', () => {
    const c = withTypeDesign(company(), 'invoice', {
      templateId: 'elegant',
      layout: { showAcceptance: true },
    });
    expect(c.branding.templateId).toBe('elegant');
    expect(c.branding.accentColor).toBe('#4f46e5');
    expect(c.branding.layout).toEqual({ showAcceptance: true });
    expect(c.branding.byType).toBeUndefined();
  });

  it('gives quotes their own, starting as a copy of the invoices’', () => {
    const base = company({ layout: { showSku: true } });
    const c = withTypeDesign(base, 'quote', { templateId: 'classic' });
    expect(c.branding.byType?.quote).toEqual({
      templateId: 'classic',
      accentColor: '#4f46e5',
      layout: { showSku: true },
    });
    // The invoices' design is untouched.
    expect(c.branding.templateId).toBe('modern');
    const coloured = withTypeDesign(c, 'quote', { accentColor: '#0f766e' });
    expect(coloured.branding.byType?.quote?.templateId).toBe('classic');
    expect(coloured.branding.byType?.quote?.accentColor).toBe('#0f766e');
  });

  it('keeps a type’s own design when the invoices’ layout changes later', () => {
    // A company that never set a layout gives quotes and credit notes their own.
    let c = withSameAsInvoices(company(), 'quote', false);
    c = withTypeDesign(c, 'quote', { templateId: 'classic' });
    c = withTypeDesign(c, 'credit', { accentColor: '#15803d' });
    // Later, on the Invoices tab: the acceptance box and the logo on top, centred.
    c = withTypeDesign(c, 'invoice', { layout: { showAcceptance: true, logoPosition: 'center' } });
    expect(documentLayout({ type: 'invoice' }, c)).toEqual({
      showAcceptance: true,
      logoPosition: 'center',
    });
    expect(documentLayout({ type: 'quote' }, c)).toEqual({});
    expect(documentLayout({ type: 'credit' }, c)).toEqual({});
    // Proformas follow the invoices, as before.
    expect(documentLayout({ type: 'proforma' }, c)).toEqual({
      showAcceptance: true,
      logoPosition: 'center',
    });
  });

  it('switches “Same as invoices” off with a copy and on by removing the own design', () => {
    const base = company();
    const own = withSameAsInvoices(base, 'quote', false);
    expect(own.branding.byType?.quote).toEqual({
      templateId: 'modern',
      accentColor: '#4f46e5',
      layout: {},
    });
    // Off again keeps what was set.
    const changed = withTypeDesign(own, 'quote', { templateId: 'classic' });
    expect(withSameAsInvoices(changed, 'quote', false)).toBe(changed);
    const credit = withTypeDesign(changed, 'credit', { accentColor: '#15803d' });
    const back = withSameAsInvoices(credit, 'quote', true);
    expect(back.branding.byType).toEqual({ credit: credit.branding.byType?.credit });
    // Nothing left: the setting goes, and the company is as before.
    const none = withSameAsInvoices(back, 'credit', true);
    expect('byType' in none.branding).toBe(false);
    expect(none.branding).toEqual(base.branding);
  });
});
