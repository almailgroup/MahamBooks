import { useRef, useState, type ReactNode } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { BusinessActivity, LegalForm } from '@/db/types';
import { CASH_RULES, LEGAL_FORMS } from '@/lib/kuwait-rules';
import { normalizeKuwaitPhone } from '@/lib/kuwait';
import { logoFromFile } from '@/lib/image';
import { normalizeDigits } from '@/lib/money';
import { isValidEmail } from '@/lib/email';
import { cn } from '@/lib/cn';
import { currentLanguage, t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';

const ACTIVITIES = Object.keys(CASH_RULES) as BusinessActivity[];

export function LegalFormSelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: LegalForm;
  onChange: (value: LegalForm) => void;
}) {
  const arabic = currentLanguage() === 'ar';
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value as LegalForm)}>
      {LEGAL_FORMS.map((f) => (
        <option key={f.value} value={f.value}>
          {arabic ? f.labelAr : f.label}
        </option>
      ))}
    </Select>
  );
}

export function ActivitySelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: BusinessActivity;
  onChange: (value: BusinessActivity) => void;
}) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value as BusinessActivity)}>
      {ACTIVITIES.map((a) => (
        <option key={a} value={a}>
          {t(CASH_RULES[a].label)}
        </option>
      ))}
    </Select>
  );
}

/** A note shown softly under a field: the value is kept, but may need a look. */
export function SoftWarning({ children }: { children: ReactNode }) {
  return <span className="text-amber-700">{children}</span>;
}

/**
 * Phone number field. Kuwaiti numbers are written as "+965 2222 3333" when
 * the field is left; anything else is kept as typed with a gentle note.
 */
export function PhoneField({
  label,
  value,
  onChange,
  kuwait = true,
  mobile = false,
  optional,
  hint,
  className,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** Check and format the number as a Kuwaiti one. */
  kuwait?: boolean;
  /** Only mobile numbers make sense (e.g. WAMD). */
  mobile?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  className?: string;
}) {
  const normalized = value.trim() ? normalizeKuwaitPhone(normalizeDigits(value)) : null;
  const notKuwaiti = kuwait && value.trim() !== '' && normalized === null;
  const landline = kuwait && mobile && normalized !== null && normalized.startsWith('+965 2');
  const warning = notKuwaiti
    ? t('Kuwaiti numbers have 8 digits, for example +965 2222 3333.')
    : landline
      ? t('Enter a mobile number.')
      : null;
  return (
    <Field
      label={label}
      optional={optional}
      className={className}
      hint={warning ? <SoftWarning>{warning}</SoftWarning> : hint}
    >
      {(id) => (
        <Input
          id={id}
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          value={value}
          placeholder={mobile ? '+965 5555 1234' : '+965 2222 3333'}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            if (kuwait && normalized && normalized !== value) onChange(normalized);
          }}
          className="rtl:text-end"
        />
      )}
    </Field>
  );
}

export function EmailField({
  label,
  value,
  onChange,
  optional,
  className,
  hint,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
  className?: string;
  hint?: ReactNode;
}) {
  const invalid = value.trim() !== '' && !isValidEmail(value);
  return (
    <Field
      label={label}
      optional={optional}
      className={className}
      hint={hint}
      error={invalid ? t('Enter an email address such as name@company.com.') : undefined}
    >
      {(id) => (
        <Input
          id={id}
          type="email"
          dir="ltr"
          autoComplete="email"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          aria-invalid={invalid}
          className="rtl:text-end"
        />
      )}
    </Field>
  );
}

const CHECKERBOARD = {
  backgroundImage: 'conic-gradient(#f1f5f9 25%, #ffffff 0 50%, #f1f5f9 0 75%, #ffffff 0)',
  backgroundSize: '16px 16px',
};

/**
 * Upload for a stamp or signature image. The image is re-encoded as PNG, so
 * a transparent background stays transparent on the documents. `onChange`
 * may take its time (the signature is recoloured): the field shows it is busy.
 */
export function ImageField({
  label,
  value,
  onChange,
  description,
  uploadLabel,
  actions,
  processing = false,
  className,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void | Promise<void>;
  description: ReactNode;
  uploadLabel: string;
  /** More buttons next to Replace and Remove. */
  actions?: ReactNode;
  /** Busy elsewhere (an ink being applied). */
  processing?: boolean;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const busy = uploading || processing;

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      await onChange(await logoFromFile(file));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not use this image.'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      </div>
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
        aria-label={value ? t('Replace {name}', { name: label }) : uploadLabel}
        className={cn(
          'flex h-28 w-full items-center justify-center overflow-hidden rounded-lg border-2 border-dashed p-2 transition-colors',
          dragging ? 'border-primary-500' : 'border-slate-300 hover:border-slate-400',
        )}
        style={value ? CHECKERBOARD : undefined}
      >
        {value ? (
          <img src={value} alt={label} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-xs text-slate-500">
            <ImagePlus className="size-5 text-slate-400" aria-hidden />
            {busy ? t('Processing…') : uploadLabel}
          </span>
        )}
      </button>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => input.current?.click()} loading={busy}>
          {value ? t('Replace') : t('Choose file')}
        </Button>
        {actions}
        {value ? (
          <Button variant="ghost" size="sm" onClick={() => void onChange(null)} disabled={busy}>
            <Trash2 /> {t('Remove')}
          </Button>
        ) : null}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        className="hidden"
        onChange={(e) => {
          void handle(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
