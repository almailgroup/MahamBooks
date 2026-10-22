import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Printer } from 'lucide-react';
import type { Company } from '@/db/types';
import type { Dictionary } from '@/i18n';
import { t } from '@/i18n';
import common from '@/i18n/ar/common';
import people from '@/i18n/ar/people';
import payroll from '@/i18n/ar/payroll';
import leaveReasons from '@/i18n/ar/req-15';
import documentsPdf from '@/i18n/ar/documents-pdf';
import suite from '@/i18n/ar/suite';
import salaryApproval from '@/i18n/ar/req-10';
import { formatMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/misc';

const ARABIC: Dictionary = {
  ...common,
  ...people,
  ...payroll,
  ...leaveReasons,
  ...documentsPdf,
  ...suite,
  ...salaryApproval,
};

export const PRINT_EN = 'en-KW';
export const PRINT_AR = 'ar-KW-u-nu-latn';

/** The Arabic of interface text, whatever the interface language. */
export function arabicOf(text: string): string {
  const found = ARABIC[text];
  return typeof found === 'string' ? found : (found?.other ?? text);
}

/** English above Arabic, for labels on bilingual documents. */
export function Both({ text, className }: { text: string; className?: string }) {
  const ar = arabicOf(text);
  return (
    <span className={className}>
      <span className="block">{text}</span>
      {ar !== text ? (
        <span className="block text-slate-500" dir="rtl" lang="ar">
          {ar}
        </span>
      ) : null}
    </span>
  );
}

export type PaperSize = 'A4' | 'A5';

export function paperSize(value: string | null): PaperSize {
  return value?.toUpperCase() === 'A5' ? 'A5' : 'A4';
}

/** Amount in the company currency as printed on documents ("KD 1,234.500"). */
export function printMoney(company: Company, amount: number): string {
  return formatMoney(amount, company.currency, PRINT_EN, company.currencyDisplay ?? 'local');
}

/** Back link, paper size and Print button above a print view; hidden on paper. */
export function PrintToolbar({
  back,
  backLabel,
  size,
  onSize,
}: {
  back: string;
  backLabel: string;
  size: PaperSize;
  onSize: (size: PaperSize) => void;
}) {
  return (
    <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 print:hidden">
      <Link
        to={back}
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" /> {backLabel}
      </Link>
      <div className="flex items-center gap-2">
        <Segmented
          size="sm"
          value={size}
          onChange={onSize}
          options={[
            { value: 'A4', label: 'A4' },
            { value: 'A5', label: 'A5' },
          ]}
        />
        <Button onClick={() => window.print()}>
          <Printer /> {t('Print')}
        </Button>
      </div>
      <style>{`@page { size: ${size}; margin: ${size === 'A5' ? '8mm' : '12mm'}; }`}</style>
    </div>
  );
}

/** Company logo and names in English and Arabic, with the document title. */
export function PrintHeader({
  company,
  title,
  subtitle,
}: {
  company: Company;
  title: string;
  subtitle?: { en: string; ar: string };
}) {
  const nameAr = company.nameAr?.trim() || company.name;
  return (
    <header className="mb-4 border-b-2 border-slate-800 pb-3">
      <div className="flex items-start justify-between gap-4">
        <div dir="ltr" className="min-w-0">
          {company.branding.logo ? (
            <img src={company.branding.logo} alt="" className="mb-2 max-h-12 object-contain" />
          ) : null}
          <p className="text-sm font-semibold text-slate-900">{company.name}</p>
          <p className="text-base font-semibold text-slate-900">{title}</p>
          {subtitle ? <p className="text-slate-600">{subtitle.en}</p> : null}
        </div>
        <div dir="rtl" lang="ar" className="min-w-0 text-start">
          <p className="text-sm font-semibold text-slate-900">{nameAr}</p>
          <p className="text-base font-semibold text-slate-900">{arabicOf(title)}</p>
          {subtitle ? <p className="text-slate-600">{subtitle.ar}</p> : null}
        </div>
      </div>
    </header>
  );
}

/** A row of a bilingual amounts table. */
export function PrintRow({
  label,
  note,
  amount,
  strong,
}: {
  label: ReactNode;
  note?: string;
  amount: string;
  strong?: boolean;
}) {
  return (
    <tr className={strong ? 'bg-slate-50 font-semibold' : undefined}>
      <td className="border border-slate-300 px-2 py-1">
        {label}
        {note ? <span className="block text-slate-500">{note}</span> : null}
      </td>
      <td className="tabular border border-slate-300 px-2 py-1 text-end align-top" dir="ltr">
        {amount}
      </td>
    </tr>
  );
}
