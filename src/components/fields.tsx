import { useId, useMemo, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Address } from '@/db/types';
import { countryOptions, currencyOptions, LOCALE_OPTIONS } from '@/lib/geo';
import { DATE_FORMATS, formatDate } from '@/lib/format';
import { logoFromFile } from '@/lib/image';
import { isHexColor, normalizeHex } from '@/lib/color';
import { cn } from '@/lib/cn';
import { GOVERNORATES, findGovernorate } from '@/lib/kuwait';
import { currentLanguage, interfaceLocale, t } from '@/i18n';
import { Button } from './ui/button';
import { Field, Input, Select } from './ui/form';
import { Combobox } from './ui/combobox';

export function CountrySelect({
  value,
  onChange,
  id,
  placeholder,
}: {
  value: string;
  onChange: (code: string) => void;
  id?: string;
  placeholder?: string;
}) {
  const options = useMemo(() => {
    const language = currentLanguage();
    // Kuwait first, then the other GCC countries, then the rest.
    const first = ['KW', 'SA', 'AE', 'BH', 'QA', 'OM'];
    const english = new Map(countryOptions('en').map((o) => [o.value, o.label]));
    const all = countryOptions(language).map((o) => ({
      value: o.value,
      label: o.label,
      // Arabic names can be searched in English too.
      keywords: `${o.value} ${english.get(o.value)}`,
    }));
    return [
      ...first.map((code) => all.find((o) => o.value === code)!).filter(Boolean),
      ...all.filter((o) => !first.includes(o.value)),
    ];
  }, []);
  return (
    <Combobox
      id={id}
      value={value || null}
      onChange={onChange}
      options={options}
      placeholder={placeholder ?? t('Select a country')}
      searchPlaceholder={t('Search countries…')}
    />
  );
}

export function CurrencySelect({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (code: string) => void;
  id?: string;
}) {
  const options = useMemo(
    () => currencyOptions(currentLanguage()).map((o) => ({ value: o.value, label: o.label })),
    [],
  );
  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      searchPlaceholder={t('Search currencies…')}
      renderValue={(o) => o.label}
    />
  );
}

export function LocaleSelect({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (locale: string) => void;
  id?: string;
}) {
  const known = LOCALE_OPTIONS.some((o) => o.value === value);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {!known ? <option value={value}>{value}</option> : null}
      {LOCALE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

const SAMPLE_DATE = '2026-12-31';

export function DateFormatSelect({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (format: (typeof DATE_FORMATS)[number]['value']) => void;
  id?: string;
}) {
  const locale = interfaceLocale(undefined);
  return (
    <Select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as (typeof DATE_FORMATS)[number]['value'])}
    >
      {DATE_FORMATS.map((o) => (
        <option key={o.value} value={o.value}>
          {/* A sample date as it will look, with month names in the interface language. */}
          {o.value === 'locale' ? t(o.label) : formatDate(SAMPLE_DATE, o.value, locale)}
        </option>
      ))}
    </Select>
  );
}

export function AddressFields({
  value,
  onChange,
}: {
  value: Address;
  onChange: (address: Address) => void;
}) {
  const set = (patch: Partial<Address>) => onChange({ ...value, ...patch });
  if ((value.country || 'KW').toUpperCase() === 'KW') {
    return <KuwaitAddressFields value={value} set={set} />;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <Field label={t('Address line 1')} className="sm:col-span-6">
        {(id) => (
          <Input
            id={id}
            value={value.line1}
            onChange={(e) => set({ line1: e.target.value })}
            autoComplete="address-line1"
          />
        )}
      </Field>
      <Field label={t('Address line 2')} className="sm:col-span-6" optional>
        {(id) => (
          <Input
            id={id}
            value={value.line2}
            onChange={(e) => set({ line2: e.target.value })}
            autoComplete="address-line2"
          />
        )}
      </Field>
      <Field label={t('City')} className="sm:col-span-3">
        {(id) => (
          <Input
            id={id}
            value={value.city}
            onChange={(e) => set({ city: e.target.value })}
            autoComplete="address-level2"
          />
        )}
      </Field>
      <Field label={t('State / region')} className="sm:col-span-3" optional>
        {(id) => (
          <Input
            id={id}
            value={value.state}
            onChange={(e) => set({ state: e.target.value })}
            autoComplete="address-level1"
          />
        )}
      </Field>
      <Field label={t('Postal code')} className="sm:col-span-2">
        {(id) => (
          <Input
            id={id}
            value={value.postalCode}
            onChange={(e) => set({ postalCode: e.target.value })}
            autoComplete="postal-code"
          />
        )}
      </Field>
      <Field label={t('Country')} className="sm:col-span-4">
        {(id) => (
          <CountrySelect id={id} value={value.country} onChange={(country) => set({ country })} />
        )}
      </Field>
    </div>
  );
}

/** Kuwait: governorate, area, block, street, avenue, building, floor, unit, PACI. */
function KuwaitAddressFields({
  value,
  set,
}: {
  value: Address;
  set: (patch: Partial<Address>) => void;
}) {
  const language = currentLanguage();
  const governorate = findGovernorate(value.state);
  const areas = governorate ? governorate.areas : GOVERNORATES.flatMap((g) => g.areas);
  const listId = useId();
  const short = (
    key: 'block' | 'street' | 'avenue' | 'building' | 'floor' | 'unit',
    label: string,
    optional = false,
  ) => (
    <Field label={label} className="sm:col-span-2" optional={optional}>
      {(id) => (
        <Input id={id} value={value[key] ?? ''} onChange={(e) => set({ [key]: e.target.value })} />
      )}
    </Field>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <Field label={t('Governorate')} className="sm:col-span-3">
        {(id) => (
          <Select
            id={id}
            value={governorate?.name.en ?? value.state}
            onChange={(e) => set({ state: e.target.value })}
          >
            <option value="">{t('Select…')}</option>
            {!governorate && value.state ? (
              <option value={value.state}>{value.state}</option>
            ) : null}
            {GOVERNORATES.map((g) => (
              <option key={g.code} value={g.name.en}>
                {g.name[language]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('Area')} className="sm:col-span-3">
        {(id) => (
          <>
            <Input
              id={id}
              value={value.city}
              onChange={(e) => {
                const typed = e.target.value;
                const known = areas.find((a) => a.ar === typed || a.en === typed);
                set({ city: known ? known.en : typed });
              }}
              list={listId}
              autoComplete="address-level2"
            />
            <datalist id={listId}>
              {areas.map((a) => (
                <option key={a.en} value={a[language]} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      {short('block', t('Block'))}
      {short('street', t('Street'))}
      {short('avenue', t('Avenue'), true)}
      {short('building', t('Building'))}
      {short('floor', t('Floor'), true)}
      {short('unit', t('Office / flat'), true)}
      <Field label={t('Building name or landmark')} className="sm:col-span-4" optional>
        {(id) => (
          <Input id={id} value={value.line1} onChange={(e) => set({ line1: e.target.value })} />
        )}
      </Field>
      <Field
        label={t('PACI number')}
        className="sm:col-span-2"
        optional
        hint={t('On the Civil ID address sticker')}
      >
        {(id) => (
          <Input
            id={id}
            value={value.paci ?? ''}
            inputMode="numeric"
            onChange={(e) => set({ paci: e.target.value })}
          />
        )}
      </Field>
      <Field label={t('P.O. Box')} className="sm:col-span-2" optional>
        {(id) => (
          <Input id={id} value={value.line2} onChange={(e) => set({ line2: e.target.value })} />
        )}
      </Field>
      <Field label={t('Postal code')} className="sm:col-span-2" optional>
        {(id) => (
          <Input
            id={id}
            value={value.postalCode}
            inputMode="numeric"
            onChange={(e) => set({ postalCode: e.target.value })}
            autoComplete="postal-code"
          />
        )}
      </Field>
      <Field label={t('Country')} className="sm:col-span-2">
        {(id) => (
          <CountrySelect
            id={id}
            value={value.country || 'KW'}
            onChange={(country) => set({ country })}
          />
        )}
      </Field>
    </div>
  );
}

export function LogoUpload({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (logo: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await logoFromFile(file));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not use this image.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handle(e.dataTransfer.files[0]);
        }}
        className={cn(
          'flex h-20 w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed p-2 transition-colors',
          dragging ? 'border-primary-500 bg-primary-50' : 'border-slate-300 hover:border-slate-400',
          // A logo shows on white, as on the documents.
          !dragging && (value ? 'bg-white' : 'bg-surface'),
        )}
        aria-label={value ? t('Replace logo') : t('Upload logo')}
      >
        {value ? (
          <img src={value} alt={t('Logo')} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-xs text-slate-500">
            <ImagePlus className="size-5 text-slate-400" />
            {busy ? t('Processing…') : t('Upload logo')}
          </span>
        )}
      </button>
      <div className="space-y-2 text-sm text-slate-500">
        <p>{t('PNG, JPG, SVG or WebP. A wide logo on a transparent background looks best.')}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => input.current?.click()} loading={busy}>
            {value ? t('Replace') : t('Choose file')}
          </Button>
          {value ? (
            <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
              <Trash2 /> {t('Remove')}
            </Button>
          ) : null}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          void handle(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export const ACCENT_PRESETS = [
  '#4f46e5',
  '#2563eb',
  '#0e7490',
  '#0f766e',
  '#15803d',
  '#a16207',
  '#c2410c',
  '#dc2626',
  '#db2777',
  '#7c3aed',
  '#334155',
  '#111827',
];

export function ColorField({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (color: string) => void;
  id?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label
          className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-slate-300 shadow-xs"
          style={{ backgroundColor: value }}
        >
          <input
            type="color"
            value={normalizeHex(value)}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label={t('Pick a colour')}
          />
        </label>
        <Input
          id={id}
          value={text ?? value}
          onChange={(e) => {
            setText(e.target.value);
            if (isHexColor(e.target.value)) onChange(normalizeHex(e.target.value));
          }}
          onBlur={() => setText(null)}
          className="w-32 font-mono uppercase"
          maxLength={7}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {ACCENT_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={cn(
              'ring-offset-surface size-7 rounded-full ring-offset-2 transition-shadow',
              normalizeHex(value) === c
                ? 'ring-2 ring-slate-900'
                : // A swatch as dark as the page keeps an edge in dark themes.
                  'hover:ring-2 hover:ring-slate-300 dark:inset-ring dark:inset-ring-white/20',
            )}
            style={{ backgroundColor: c }}
            aria-label={t('Use colour {color}', { color: c })}
          />
        ))}
      </div>
    </div>
  );
}
