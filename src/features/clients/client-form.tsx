import { useState } from 'react';
import { Plus, Star, Trash2 } from 'lucide-react';
import type { Client, ClientContact, Company } from '@/db/types';
import { emptyAddress, isAddressEmpty } from '@/lib/geo';
import { isValidCivilId } from '@/lib/kuwait';
import { shortId } from '@/lib/ids';
import { DOCUMENT_LANGUAGES } from '@/pdf/languages';
import { t, tp } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Field, Input, NumberInput, Select, Switch, Textarea } from '@/components/ui/form';
import { AddressFields, CurrencySelect } from '@/components/fields';
import { isCustomer, isVendor } from '@/db/purchases';
import type { ContactKind } from './contact-kind';

export function newContact(primary = false): ClientContact {
  return { id: shortId(), name: '', email: '', phone: '', primary };
}

/** Client or vendor fields. `compact` hides the less common options (quick create). */
export function ClientForm({
  value,
  onChange,
  company,
  compact = false,
  errors = {},
  kind = 'customer',
}: {
  value: Client;
  onChange: (client: Client) => void;
  company: Company;
  compact?: boolean;
  errors?: Partial<Record<'name', string>>;
  kind?: ContactKind;
}) {
  const [showShipping, setShowShipping] = useState(!isAddressEmpty(value.shippingAddress));
  const set = (patch: Partial<Client>) => onChange({ ...value, ...patch });
  const contacts = value.contacts.length ? value.contacts : [newContact(true)];
  const setContact = (index: number, patch: Partial<ClientContact>) =>
    set({ contacts: contacts.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  const customer = isCustomer(value);
  const vendor = isVendor(value);
  const civilId = value.civilId?.trim() ?? '';
  const civilIdWrong = civilId !== '' && !isValidCivilId(civilId);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={kind === 'vendor' ? t('Vendor name') : t('Client name')}
          error={errors.name}
          hint={
            kind === 'vendor'
              ? t('Company or person you buy from.')
              : t('Company or person you are billing.')
          }
        >
          {(id) => (
            <Input
              id={id}
              value={value.name}
              onChange={(e) => set({ name: e.target.value })}
              autoFocus
              aria-invalid={Boolean(errors.name)}
            />
          )}
        </Field>
        <Field
          label={t('Arabic name')}
          optional
          hint={t('Printed on Arabic and bilingual documents.')}
        >
          {(id) => (
            <Input
              id={id}
              dir="rtl"
              lang="ar"
              value={value.nameAr ?? ''}
              onChange={(e) => set({ nameAr: e.target.value })}
            />
          )}
        </Field>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">{t('Contacts')}</h3>
        {contacts.map((contact, index) => (
          <div
            key={contact.id}
            className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
          >
            <Field label={t('Name')}>
              {(id) => (
                <Input
                  id={id}
                  value={contact.name}
                  onChange={(e) => setContact(index, { name: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('Email')}>
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  dir="ltr"
                  value={contact.email}
                  onChange={(e) => setContact(index, { email: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('Phone')}>
              {(id) => (
                <Input
                  id={id}
                  type="tel"
                  dir="ltr"
                  value={contact.phone}
                  onChange={(e) => setContact(index, { phone: e.target.value })}
                />
              )}
            </Field>
            <div className="flex items-end gap-1 pb-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                title={contact.primary ? t('Primary contact') : t('Make primary')}
                aria-label={contact.primary ? t('Primary contact') : t('Make primary contact')}
                onClick={() =>
                  set({ contacts: contacts.map((c, i) => ({ ...c, primary: i === index })) })
                }
              >
                <Star className={contact.primary ? 'fill-amber-400 text-amber-500' : ''} />
              </Button>
              {contacts.length > 1 ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('Remove contact')}
                  onClick={() => set({ contacts: contacts.filter((_, i) => i !== index) })}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => set({ contacts: [...contacts, newContact(false)] })}
        >
          <Plus /> {t('Add contact')}
        </Button>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">
          {customer ? t('Billing address') : t('Address')}
        </h3>
        <AddressFields value={value.address} onChange={(address) => set({ address })} />
        {customer ? (
          <Switch
            checked={showShipping}
            onChange={(on) => {
              setShowShipping(on);
              set({
                shippingAddress: on
                  ? (value.shippingAddress ?? emptyAddress(value.address.country))
                  : null,
              });
            }}
            label={t('Different shipping address')}
          />
        ) : null}
        {customer && showShipping && value.shippingAddress ? (
          <AddressFields
            value={value.shippingAddress}
            onChange={(shippingAddress) => set({ shippingAddress })}
          />
        ) : null}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field label={company.taxIdLabel || t('Tax ID')} optional>
          {(id) => (
            <Input id={id} value={value.taxId} onChange={(e) => set({ taxId: e.target.value })} />
          )}
        </Field>
        <Field
          label={t('Civil ID')}
          optional
          error={
            civilIdWrong ? t('This Civil ID does not look right. Check the 12 digits.') : undefined
          }
          hint={t('For individual customers and cheque drawers.')}
        >
          {(id) => (
            <Input
              id={id}
              dir="ltr"
              inputMode="numeric"
              maxLength={14}
              value={value.civilId ?? ''}
              onChange={(e) => set({ civilId: e.target.value })}
              aria-invalid={civilIdWrong}
            />
          )}
        </Field>
        <Field label={t('Phone (main)')} optional>
          {(id) => (
            <Input
              id={id}
              type="tel"
              dir="ltr"
              value={value.phone}
              onChange={(e) => set({ phone: e.target.value })}
            />
          )}
        </Field>
        {!compact ? (
          <>
            <Field label={t('Website')} optional>
              {(id) => (
                <Input
                  id={id}
                  dir="ltr"
                  value={value.website}
                  onChange={(e) => set({ website: e.target.value })}
                />
              )}
            </Field>
            <Field
              label={t('Currency')}
              hint={t('Leave as default to use {currency}.', { currency: company.currency })}
            >
              {(id) => (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <CurrencySelect
                      id={id}
                      value={value.currency ?? company.currency}
                      onChange={(currency) =>
                        set({ currency: currency === company.currency ? null : currency })
                      }
                    />
                  </div>
                  {value.currency ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9"
                      onClick={() => set({ currency: null })}
                    >
                      {t('Default')}
                    </Button>
                  ) : null}
                </div>
              )}
            </Field>
            <Field
              label={t('Payment terms (days)')}
              hint={tp(
                company.defaults.paymentTermsDays,
                'Default: {count} day',
                'Default: {count} days',
              )}
            >
              {(id) => (
                <div className="flex gap-2">
                  <NumberInput
                    id={id}
                    value={value.paymentTermsDays ?? company.defaults.paymentTermsDays}
                    onValueChange={(days) =>
                      set({ paymentTermsDays: Math.max(0, Math.round(days)) })
                    }
                    allowNegative={false}
                  />
                  {value.paymentTermsDays !== null ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9"
                      onClick={() => set({ paymentTermsDays: null })}
                    >
                      {t('Default')}
                    </Button>
                  ) : null}
                </div>
              )}
            </Field>
            {customer ? (
              <Field label={t('Document language')}>
                {(id) => (
                  <Select
                    id={id}
                    value={value.language ?? ''}
                    onChange={(e) =>
                      set({ language: (e.target.value || null) as Client['language'] })
                    }
                  >
                    <option value="">{t('Company default')}</option>
                    {DOCUMENT_LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>
                        {t(l.label)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            <div className="sm:col-span-2">
              <Switch
                checked={value.taxExempt}
                onChange={(taxExempt) => set({ taxExempt })}
                label={t('Tax exempt')}
                description={
                  vendor && !customer
                    ? t('Not registered for tax: their bills never include tax.')
                    : t('Taxes are never applied to their documents.')
                }
              />
            </div>
            <div className="space-y-3 rounded-lg border border-slate-200 p-3 sm:col-span-2">
              <Switch
                checked={customer}
                // A contact always keeps at least one role.
                disabled={customer && !vendor}
                onChange={(on) => set({ isCustomer: on })}
                label={t('Client')}
                description={t('You send them quotes and invoices.')}
              />
              <Switch
                checked={vendor}
                disabled={vendor && !customer}
                onChange={(on) => set({ isVendor: on })}
                label={t('Vendor')}
                description={t('You record their bills and pay them.')}
              />
            </div>
            <Field
              label={t('Internal notes')}
              className="sm:col-span-2"
              hint={t('Only visible to you.')}
            >
              {(id) => (
                <Textarea
                  id={id}
                  value={value.notes}
                  onChange={(e) => set({ notes: e.target.value })}
                  rows={3}
                />
              )}
            </Field>
          </>
        ) : null}
      </section>
    </div>
  );
}

export function validateClient(client: Client): Partial<Record<'name', string>> {
  return client.name.trim() ? {} : { name: t('Please enter a name.') };
}
