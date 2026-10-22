import { useEffect, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Printer } from 'lucide-react';
import { db } from '@/db/db';
import { letterContext, letterTexts, markLettersPrinted, privateFieldsShown } from '@/db/letters';
import type { Company, Employee, EmployeeLetter, LetterTemplate, PeopleSettings } from '@/db/types';
import { useCompany } from '@/app/company';
import { useLetterTemplates, useLettersView } from '@/features/people/letter-hooks';
import { usePeopleSettings } from '@/features/people/hooks';
import { letterDate, letterLanguage } from '@/lib/hr/letters';
import type { CloudLink } from '@/cloud/types';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { msg, t, type Dictionary } from '@/i18n';
import payments from '@/i18n/ar/payments';
import letterWords from '@/i18n/ar/req-19';

const L = {
  ref: msg('Ref.'),
  date: msg('Date'),
  draft: msg('Draft'),
  void: msg('This letter is void'),
};

const ARABIC: Dictionary = { ...payments, ...letterWords };

/** The Arabic of a label, whatever the interface language. */
function arabicOf(text: string): string {
  const found = ARABIC[text];
  return typeof found === 'string' ? found : (found?.other ?? text);
}

/** A label in the letter's language, whatever the interface language. */
const label = (text: string, lang: 'ar' | 'en') => (lang === 'ar' ? arabicOf(text) : text);

/** Where the Back link goes: a page of this app, else Letters. */
function backTo(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/people/letters';
}

/**
 * Letters printed on A4 with the company's letterhead (#19), one a page:
 * People → Letters → Print, or a letter's Print. Issued letters print as
 * they were frozen, with the stamp and signature their template asked for;
 * drafts print with a watermark and never with the stamp or signature
 * (D15), and so do void letters. Printing an issued letter takes it off
 * Letters to print.
 */
export default function LetterPrintPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const company = useCompany();
  const view = useLettersView();
  const settings = usePeopleSettings();
  const templates = useLetterTemplates();
  const ids = useMemo(
    () =>
      id
        ? [id]
        : [...new Set((params.get('ids') ?? '').split(',').map((x) => x.trim()))].filter(Boolean),
    [id, params],
  );
  const letters = useLiveQuery(
    async () =>
      (await db.employeeLetters.bulkGet(ids)).filter(
        (l): l is EmployeeLetter => Boolean(l) && l!.companyId === company.id,
      ),
    [ids.join(','), company.id],
  );
  const employees = useLiveQuery(
    async () =>
      new Map(
        (await db.employees.bulkGet((letters ?? []).map((l) => l.employeeId)))
          .filter((e): e is Employee => Boolean(e))
          .map((e) => [e.id, e]),
      ),
    [letters],
  );

  useEffect(() => {
    const before = document.title;
    document.title = t('Letters');
    return () => {
      document.title = before;
    };
  }, []);

  if (!letters || !employees || !settings || !templates || view.loading) {
    return <Spinner className="min-h-dvh" label={t('Loading…')} />;
  }
  const back = backTo(params.get('back'));
  if (letters.length === 0 || !view.on) {
    return (
      <div className="p-10 text-center text-slate-600">
        <p>{t('This letter could not be found.')}</p>
        <Link to={back} className="text-primary-700 mt-4 inline-block text-sm font-medium">
          {t('Back to letters')}
        </Link>
      </div>
    );
  }

  const print = async () => {
    const issued = letters.filter((l) => l.status === 'issued' && !l.printedAt).map((l) => l.id);
    try {
      await markLettersPrinted(issued);
    } catch {
      // Printed all the same; it stays in Letters to print.
    }
    window.print();
  };

  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 print:hidden">
        <Link
          to={back}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" /> {t('Back to letters')}
        </Link>
        <Button onClick={() => void print()}>
          <Printer /> {t('Print')}
        </Button>
        <style>{'@page { size: A4; margin: 16mm; }'}</style>
      </div>
      <div className="space-y-6 print:space-y-0">
        {letters.map((letter) => (
          <LetterSheet
            key={letter.id}
            letter={letter}
            employee={employees.get(letter.employeeId)}
            template={templates.find((tpl) => tpl.id === letter.templateId)}
            company={company}
            settings={settings}
            link={view.link}
          />
        ))}
      </div>
    </div>
  );
}

function LetterSheet({
  letter,
  employee,
  template,
  company,
  settings,
  link,
}: {
  letter: EmployeeLetter;
  employee: Employee | undefined;
  template: LetterTemplate | undefined;
  company: Company;
  settings: PeopleSettings;
  link: CloudLink | null | undefined;
}) {
  const language = letterLanguage(letter.language);
  const issued = letter.status === 'issued';
  const texts = letterTexts(
    letter,
    employee
      ? letterContext(employee, company, settings, privateFieldsShown(template, link))
      : null,
  );
  const halves: { lang: 'ar' | 'en'; subject: string; body: string }[] =
    language === 'en'
      ? [{ lang: 'en', subject: texts.subject, body: texts.body }]
      : language === 'ar'
        ? [{ lang: 'ar', subject: texts.subject, body: texts.body }]
        : [
            { lang: 'ar', subject: texts.subject, body: texts.body },
            { lang: 'en', subject: texts.subjectEn ?? '', body: texts.bodyEn ?? '' },
          ];
  const main = halves[0].lang;
  // Drafts and void letters never carry the stamp or signature (D15).
  const signature = issued && (letter.showSignature ?? true) ? company.branding.signature : null;
  const stamp = issued && (letter.showStamp ?? true) ? company.branding.stamp : null;
  const signatory =
    letter.status !== 'draft'
      ? { name: letter.signatoryName ?? '', title: letter.signatoryTitle ?? '' }
      : { name: template?.signatoryName ?? '', title: template?.signatoryTitle ?? '' };
  const watermark =
    letter.status === 'draft'
      ? `${arabicOf(L.draft)} · ${L.draft.toUpperCase()}`
      : letter.status === 'void'
        ? `${arabicOf(L.void)} · ${L.void}`
        : null;
  const date = letter.issuedOn ?? letter.createdAt.slice(0, 10);
  const nameAr = company.nameAr?.trim() || company.name;

  return (
    <article
      dir={main === 'ar' ? 'rtl' : 'ltr'}
      lang={main}
      className="paper relative mx-auto flex min-h-[297mm] max-w-3xl break-after-page flex-col overflow-hidden bg-white p-10 text-[13px] leading-relaxed text-slate-800 shadow-sm ring-1 ring-slate-200 print:min-h-0 print:max-w-none print:p-0 print:shadow-none print:ring-0"
    >
      {watermark ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span className="-rotate-30 text-5xl font-bold whitespace-nowrap text-slate-300/70 select-none">
            {watermark}
          </span>
        </div>
      ) : null}
      <header className="mb-6 border-b-2 border-slate-800 pb-3">
        <div className="flex items-start justify-between gap-4" dir="ltr">
          <div className="min-w-0">
            {company.branding.logo ? (
              <img src={company.branding.logo} alt="" className="mb-2 max-h-14 object-contain" />
            ) : null}
            <p className="text-sm font-semibold text-slate-900">{company.name}</p>
          </div>
          <div dir="rtl" lang="ar" className="min-w-0 text-start">
            <p className="text-sm font-semibold text-slate-900">{nameAr}</p>
          </div>
        </div>
      </header>

      <div className="mb-6 flex flex-wrap justify-between gap-x-8 gap-y-1 text-sm">
        {halves.map((half) => (
          <div key={half.lang} dir={half.lang === 'ar' ? 'rtl' : 'ltr'} lang={half.lang}>
            <p>
              {label(L.ref, half.lang)}:{' '}
              <span dir="ltr" className="font-medium">
                {letter.number || '—'}
              </span>
            </p>
            <p>
              {label(L.date, half.lang)}: {letterDate(date, company.dateFormat, half.lang)}
            </p>
          </div>
        ))}
      </div>

      <div className="relative flex-1 space-y-8">
        {halves.map((half) => (
          <section
            key={half.lang}
            dir={half.lang === 'ar' ? 'rtl' : 'ltr'}
            lang={half.lang}
            className="space-y-4 text-start"
          >
            {half.subject ? (
              <h1 className="text-center text-base font-bold text-slate-900 underline underline-offset-4">
                {half.subject}
              </h1>
            ) : null}
            <p className="whitespace-pre-line">{half.body}</p>
          </section>
        ))}
      </div>

      <footer className="relative mt-10 flex justify-end">
        <div className="min-w-48 space-y-1 text-center">
          <div className="flex h-24 items-end justify-center gap-2">
            {stamp ? <img src={stamp} alt="" className="max-h-24 object-contain" /> : null}
            {signature ? <img src={signature} alt="" className="max-h-20 object-contain" /> : null}
          </div>
          {signatory.name ? (
            <p dir="auto" className="font-semibold text-slate-900">
              {signatory.name}
            </p>
          ) : null}
          {signatory.title ? (
            <p dir="auto" className="text-slate-600">
              {signatory.title}
            </p>
          ) : null}
          <p dir="auto" className="text-slate-600">
            {main === 'ar' ? nameAr : company.name}
          </p>
        </div>
      </footer>
    </article>
  );
}
