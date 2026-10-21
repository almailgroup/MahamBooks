import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CloudDownload,
  File as FileIcon,
  FileSearch,
  FileText,
  ImageIcon,
  Info,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCompany } from '@/app/company';
import { fileFinderOn, setFileFinder } from '@/db/files';
import {
  FILE_OWNER_LABELS,
  loadFileIndex,
  type FileFormat,
  type FileOwnerKind,
} from '@/features/files/file-index';
import { openStoredAttachment } from '@/features/purchases/attachments';
import { textMatches } from '@/features/search/normalize';
import { useRoleView } from '@/features/cloud/role-gates';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { Input, Select } from '@/components/ui/form';
import { useLanguage } from '@/i18n/provider';
import { t, tp } from '@/i18n';

const KINDS = Object.keys(FILE_OWNER_LABELS) as FileOwnerKind[];

/**
 * Files (الملفات, /files): every file kept with the company's records, from
 * scanned bills and receipts to register papers and personnel files, found
 * by name, by what they are kept with and its number, in English or Arabic.
 * It works offline; a file kept only in the cloud is downloaded when opened.
 * Staff and viewers don't get employees' files or confidential papers.
 * Shown once the document finder is switched on (Compliance → Settings).
 */
export default function FilesPage() {
  const company = useCompany();
  const view = useRoleView();
  // Nothing until the role is known: people's files must not flash up.
  if (!view.known) return null;
  if (!fileFinderOn(company)) {
    return <FinderOff canSwitch={!view.peopleHidden && !view.readOnly.readOnly} />;
  }
  return <FileFinder people={!view.peopleHidden} />;
}

function FinderOff({ canSwitch }: { canSwitch: boolean }) {
  const company = useCompany();
  const [busy, setBusy] = useState(false);
  const switchOn = async () => {
    setBusy(true);
    try {
      await setFileFinder(company.id, true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the settings.'));
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader title={t('Files')} />
      <Card>
        <EmptyState
          icon={<FileSearch />}
          title={t('Finding files and papers is off')}
          description={
            canSwitch
              ? t(
                  'Switch it on to list every file of the company here, and to find files, papers, expenses, fixed assets and security cheques in search.',
                )
              : t('Ask the owner of the company to switch it on in Compliance → Settings.')
          }
          action={
            canSwitch ? (
              <Button onClick={() => void switchOn()} loading={busy}>
                {t('Switch on')}
              </Button>
            ) : null
          }
        />
      </Card>
    </div>
  );
}

function FormatIcon({ format }: { format: FileFormat }) {
  const Icon = format === 'pdf' ? FileText : format === 'image' ? ImageIcon : FileIcon;
  return (
    <span
      className={
        format === 'pdf'
          ? 'flex size-9 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600'
          : 'flex size-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500'
      }
      aria-hidden
    >
      <Icon className="size-4" />
    </span>
  );
}

function FileFinder({ people }: { people: boolean }) {
  const company = useCompany();
  const { language } = useLanguage();
  const files = useLiveQuery(
    () => loadFileIndex(company, { people }),
    // `language` changes the names of what files are kept with.
    [company, people, language],
  );
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<FileOwnerKind | ''>('');
  const [limit, setLimit] = useState(100);

  const kinds = useMemo(() => KINDS.filter((k) => files?.some((f) => f.kind === k)), [files]);
  const shownKind = kind && kinds.includes(kind) ? kind : '';
  const filtered = useMemo(
    () =>
      (files ?? []).filter(
        (f) =>
          (!shownKind || f.kind === shownKind) &&
          textMatches(query, [f.name, f.owner, f.detail, ...f.terms, ...f.numbers]),
      ),
    [files, shownKind, query],
  );

  if (!files) return <Spinner className="py-24" label={t('Loading…')} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('Files')}
        description={t(
          'Every file kept with the company’s records: scanned bills, receipts, register papers and personnel files.',
        )}
      />
      {people ? null : (
        <p
          role="note"
          className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200"
        >
          <Info className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
          {t('Employees’ files and confidential papers aren’t included in what you see.')}
        </p>
      )}
      {files.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileSearch />}
            title={t('No files yet')}
            description={t(
              'Files attached to bills, expenses, fixed assets, register papers and employees show here.',
            )}
          />
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <Select
              value={shownKind}
              onChange={(e) => {
                setKind(e.target.value as FileOwnerKind | '');
                setLimit(100);
              }}
              aria-label={t('Kept with')}
              className="sm:w-56"
            >
              <option value="">{t('Every file')}</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(FILE_OWNER_LABELS[k])}
                </option>
              ))}
            </Select>
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(100);
                }}
                placeholder={t('Search files…')}
                aria-label={t('Search files')}
                className="ps-9"
              />
            </div>
          </div>
          {filtered.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">{t('No files match.')}</p>
          ) : (
            <ul className="divide-y divide-slate-100" aria-label={t('Files')}>
              {filtered.slice(0, limit).map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <FormatIcon format={f.format} />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => openStoredAttachment(f.id)}
                      className="hover:text-primary-700 block max-w-full truncate text-start text-sm font-medium text-slate-900"
                      aria-label={t('Open {name}', { name: f.name })}
                      dir="auto"
                    >
                      {f.name}
                    </button>
                    <p className="truncate text-xs text-slate-500">
                      {f.to ? (
                        <Link to={f.to} className="hover:text-primary-700">
                          {f.owner}
                        </Link>
                      ) : (
                        f.owner
                      )}
                      {f.detail ? ` · ${f.detail}` : ''}
                    </p>
                  </div>
                  {f.inCloud ? (
                    <Badge tone="slate" className="shrink-0">
                      <CloudDownload className="size-3" aria-hidden />
                      <span title={t('Downloaded from the cloud when opened.')}>
                        {t('In the cloud')}
                      </span>
                    </Badge>
                  ) : null}
                  <span className="hidden shrink-0 text-xs text-slate-500 md:block">
                    {t(FILE_OWNER_LABELS[f.kind])}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {filtered.length > limit ? (
            <div className="border-t border-slate-100 p-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + 100)}>
                {t('Show more ({count} remaining)', { count: filtered.length - limit })}
              </Button>
            </div>
          ) : null}
          <div className="border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
            {tp(filtered.length, '{count} file', '{count} files')}
          </div>
        </Card>
      )}
    </div>
  );
}
