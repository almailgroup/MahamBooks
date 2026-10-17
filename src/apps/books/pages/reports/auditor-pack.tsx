import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, FileSpreadsheet, FolderDown, Info, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { accountingSettings } from '@/db/chart-setup';
import { useCompany } from '@/app/company';
import { buildStatement, type StatementId } from '@/apps/books/features/reports/model';
import { ReportDocument } from '@/apps/books/features/reports/report-document';
import { useReportLanguage, useReportText } from '@/apps/books/features/reports/report-language';
import {
  PrintButton,
  ReportLanguageToggle,
  usePrint,
} from '@/apps/books/features/reports/report-toolbar';
import {
  auditorPackZip,
  buildAuditorPack,
  downloadBlob,
  fileSlug,
  PACK_FILES,
} from '@/apps/books/features/reports/pack';
import { today } from '@/lib/dates';
import { financialYearLabel, financialYears } from '@/lib/accounting/year-end';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, Spinner } from '@/components/ui/misc';
import { Field, Select } from '@/components/ui/form';
import { useStatementData } from './financial';

const PRINTED: StatementId[] = [
  'balance-sheet',
  'profit-and-loss',
  'changes-in-equity',
  'cash-flow',
  'asset-schedule',
];

/** One click for everything an auditor asks for at the year end. */
export function AuditorPack() {
  const company = useCompany();
  const data = useStatementData();
  const documents = useLiveQuery(
    () => db.documents.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const payments = useLiveQuery(
    () => db.payments.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const closes = useLiveQuery(
    () => db.yearEnds.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const { language, arabic } = useReportLanguage();
  const { ready } = useReportText();
  const { print, portal } = usePrint();
  const settings = accountingSettings(company);
  const firstDate = data?.ledger.lines[0]?.date;
  const { month, day } = settings.fiscalYearEnd;
  const years = useMemo(
    () => financialYears(firstDate, { month, day }, today()),
    [firstDate, month, day],
  );
  // The last year that has ended is what auditors usually ask for.
  const [chosen, setChosen] = useState<string | null>(null);
  const year = years.find((y) => y.to === chosen) ?? years.find((y) => y.to < today()) ?? years[0];
  const [busy, setBusy] = useState(false);

  if (!data || !documents || !payments || !clients || !closes || !ready || !year) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }
  const label = financialYearLabel(year.from, year.to);
  const closed = closes.some((c) => c.status === 'closed' && c.yearEnd === year.to);
  const locked = Boolean(settings.lockDate && settings.lockDate >= year.to);
  const pack = { ...data, documents, payments, clients };

  const download = () => {
    setBusy(true);
    try {
      const zip = auditorPackZip(buildAuditorPack(pack, year, language, arabic));
      downloadBlob(
        `auditor-pack-${fileSlug(company.name) || 'company'}-${year.to.slice(0, 4)}.zip`,
        zip,
      );
      toast.success(t('Auditor pack for {year} downloaded', { year: label }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not make the auditor pack.'));
    } finally {
      setBusy(false);
    }
  };
  const printStatements = () =>
    print(
      <>
        {PRINTED.map((id) => (
          <ReportDocument
            key={id}
            mode="print"
            model={buildStatement(id, data, {
              range: year,
              asOf: year.to,
              compare: id !== 'asset-schedule',
              detail: false,
            })}
          />
        ))}
      </>,
    );

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-3 sm:flex-row sm:items-end sm:justify-between">
        <Field label={t('Financial year')} className="sm:w-56">
          {(id) => (
            <Select id={id} value={year.to} onChange={(e) => setChosen(e.target.value)}>
              {years.map((y) => (
                <option key={y.to} value={y.to}>
                  {financialYearLabel(y.from, y.to)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ReportLanguageToggle />
      </div>
      <div className="space-y-5 p-5">
        <div className="flex items-start gap-3">
          <span className="bg-primary-50 text-primary-600 flex size-10 shrink-0 items-center justify-center rounded-full">
            <FolderDown className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {t('Auditor pack for {year}', { year: label })}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {t(
                'The financial statements with last year’s figures, the trial balance, the general ledger, aging and the fixed asset register, as spreadsheet files in one ZIP.',
              )}
            </p>
          </div>
        </div>

        {closed && locked ? (
          <p className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
            <Lock className="mt-0.5 size-4 shrink-0" />
            {t('This year is closed and locked, so the figures will not change.')}
          </p>
        ) : (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>
              {t('This year is still open, so the figures can change.')}{' '}
              <Link to="/year-end" className="font-medium underline">
                {t('Close the year')}
              </Link>
            </span>
          </p>
        )}

        <ul className="grid gap-2 sm:grid-cols-2">
          {PACK_FILES.map((file) => (
            <li
              key={file.name}
              className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2"
            >
              <FileSpreadsheet className="size-4 shrink-0 text-emerald-600" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-800">
                  {t(file.label)}
                </span>
                <span className="block truncate text-xs text-slate-500" dir="ltr">
                  {file.name}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={download} loading={busy}>
            <FolderDown /> {t('Download auditor pack')}
          </Button>
          <PrintButton onClick={printStatements} label={t('Print financial statements')} />
        </div>
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <CheckCircle2 className="size-3.5" />
          {t('File names stay in English; the contents follow the report language.')}
        </p>
      </div>
      {portal}
    </Card>
  );
}
