import { useDeferredValue, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  Building2,
  Clock,
  CornerDownLeft,
  FileText,
  FolderCheck,
  IdCard,
  Languages,
  Moon,
  Package,
  Palette,
  Paperclip,
  Search,
  Sun,
  Truck,
  Users,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useCompany, useFormat, useOpenInCompany } from '@/app/company';
import { useTaxesEnabled } from '@/features/company/taxes';
import { registerExtrasOn } from '@/lib/compliance';
import { fileFinderOn } from '@/db/files';
import { approvalsOn, payrollApprovalsShown } from '@/db/approvals';
import { openStoredAttachment } from '@/features/purchases/attachments';
import { CREATE_ACTIONS } from '@/features/shell/create';
import { useAppAccess, useApps, useCurrentApp } from '@/suite/current-app';
import type { SuiteApp } from '@/suite/types';
import { useLanguage } from '@/i18n/provider';
import { useSwitchLanguage } from '@/hooks/use-switch-language';
import { msg, t, tp } from '@/i18n';
import { useTheme } from '@/features/theme/provider';
import { chooseTheme } from '@/lib/themes';
import { makeEntry, searchEntries, type SearchEntry, type SearchKind } from './rank';
import { otherCompanyEmployeeEntries, recordEntries, staticEntries } from './sources';
import { isPeopleItem, loadRecent, rememberRecent, type RecentItem } from './recent';
import { toast } from 'sonner';
import { useCloud } from '@/cloud/store';
import { useCloudStatus } from '@/cloud/hooks';
import { useRoleView } from '@/features/cloud/role-gates';
import { syncLabel } from '@/features/cloud/sync-status';
import { useEmployeesEverywhere } from '@/features/people/hooks';

const SECTION_LABELS: Record<SearchKind, string> = {
  recent: msg('Recent'),
  action: msg('Actions'),
  page: msg('Pages'),
  client: msg('Clients'),
  vendor: msg('Vendors'),
  item: msg('Products & services'),
  employee: msg('Employees'),
  elsewhere: msg('Employees in other companies'),
  document: msg('Documents'),
  paper: msg('Papers'),
  file: msg('Files'),
};

const KIND_ICONS: Record<SearchKind, LucideIcon> = {
  recent: Clock,
  action: Zap,
  page: ArrowRight,
  client: Users,
  vendor: Truck,
  item: Package,
  employee: IdCard,
  elsewhere: Building2,
  document: FileText,
  paper: FolderCheck,
  file: Paperclip,
};

/** Each page's and action's own icon, in a layout of apps. */
function buildIcons(apps: readonly SuiteApp[]): Map<string, LucideIcon> {
  return new Map<string, LucideIcon>([
    // Later apps first, so a page two apps list keeps the icon of the app that owns it.
    ...[...apps]
      .reverse()
      .flatMap((app): [string, LucideIcon][] => [
        [`app:${app.id}`, app.icon],
        ...app.nav.flatMap((entry): [string, LucideIcon][] =>
          entry.kind === 'link'
            ? [[`page:${entry.to}`, entry.icon]]
            : entry.children.map((c): [string, LucideIcon] => [`page:${c.to}`, entry.icon]),
        ),
        ...app.footer.map((l): [string, LucideIcon] => [`page:${l.to}`, l.icon]),
      ]),
    ...Object.values(CREATE_ACTIONS).map((a): [string, LucideIcon] => [`action:${a.id}`, a.icon]),
  ]);
}

const ICONS = new WeakMap<readonly SuiteApp[], Map<string, LucideIcon>>();

function iconsFor(apps: readonly SuiteApp[]): Map<string, LucideIcon> {
  let icons = ICONS.get(apps);
  if (!icons) {
    icons = buildIcons(apps);
    ICONS.set(apps, icons);
  }
  return icons;
}

/** Shown before anything is typed. */
const QUICK_ACTIONS = [
  'action:invoice',
  'action:payment_in',
  'action:expense',
  'action:bill',
  'action:cheques-week',
  'action:overdue-invoices',
];

const LANGUAGE_KEY = 'action:language';
const THEME_KEY = 'action:theme';
const THEME_SWITCH_KEY = 'action:theme-switch';
const SYNC_KEY = 'action:sync-now';

interface Section {
  kind: SearchKind;
  label: string;
  entries: SearchEntry[];
}

/** "Ctrl K" or "⌘K", for the search button and help. */
export function shortcutLabel(): string {
  const platform =
    typeof navigator === 'undefined'
      ? ''
      : ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
          ?.platform ?? navigator.platform);
  return /mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K';
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenItem,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Items have no page of their own; the shell opens their dialog. */
  onOpenItem: (id: string) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-fade-in bg-overlay/40 fixed inset-0 z-50 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className="data-[state=open]:animate-fade-in bg-surface fixed inset-0 z-50 flex flex-col shadow-2xl outline-none sm:inset-x-4 sm:top-[12vh] sm:bottom-auto sm:mx-auto sm:max-h-[min(36rem,76vh)] sm:max-w-xl sm:rounded-xl sm:ring-1 sm:ring-slate-900/10"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">{t('Search')}</DialogPrimitive.Title>
          {open ? (
            <PaletteBody onClose={() => onOpenChange(false)} onOpenItem={onOpenItem} />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PaletteBody({
  onClose,
  onOpenItem,
}: {
  onClose: () => void;
  onOpenItem: (id: string) => void;
}) {
  const company = useCompany();
  const extras = registerExtrasOn(company);
  const finder = fileFinderOn(company);
  const approvals = approvalsOn(company);
  const payrollApprovals = payrollApprovalsShown(company);
  const fmt = useFormat();
  const navigate = useNavigate();
  const taxesOn = useTaxesEnabled();
  const { language } = useLanguage();
  const switchLanguage = useSwitchLanguage();
  const { preference, theme, setPreference } = useTheme();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [saved] = useState<RecentItem[]>(() => loadRecent(company.id));
  const deferred = useDeferredValue(query);
  const listId = useId();

  const dark = theme.scheme === 'dark';
  const access = useAppAccess();
  const app = useCurrentApp();
  const apps = useApps();
  const icons = iconsFor(apps);
  // Nothing to create for those who only look (the same rule as the New menus).
  const { readOnly } = useRoleView().readOnly;
  // Until the role is known, nothing of payroll and people is offered.
  const hidePeople = access.people === 'none';
  // Items opened before a role change (or by someone else here) stay out too.
  const recent = useMemo(
    () => (hidePeople ? saved.filter((item) => !isPeopleItem(item)) : saved),
    [saved, hidePeople],
  );
  const sync = useCloudStatus(company.id);
  const { manager } = useCloud();
  const syncText = syncLabel(sync);
  const syncing = sync.kind !== 'local' && sync.kind !== 'removed' && manager !== null;
  const fixed = useMemo(() => {
    const switchTo = language === 'ar' ? 'English' : 'العربية';
    return [
      ...staticEntries(taxesOn, {
        apps,
        access,
        current: app.id,
        create: !readOnly,
        registerExtras: extras,
        fileFinder: finder,
        chequePrinting: Boolean(company.chequePrinting),
        approvals,
        payrollApprovals,
      }),
      makeEntry({
        key: 'action:sync-status',
        kind: 'action',
        title: t('Sync status'),
        subtitle: syncText,
        to: '/settings/cloud',
        names: [t('Sync status'), 'Sync status'],
        terms: ['cloud sync offline online status مزامنة سحابة'],
        boost: 6,
      }),
      ...(syncing
        ? [
            makeEntry({
              key: SYNC_KEY,
              kind: 'action',
              title: t('Sync now'),
              to: '',
              names: [t('Sync now'), 'Sync now'],
              terms: ['cloud sync refresh مزامنة'],
              boost: 6,
            }),
          ]
        : []),
      makeEntry({
        key: LANGUAGE_KEY,
        kind: 'action',
        title: t('Switch to {language}', { language: switchTo }),
        to: '',
        names: [t('Switch to {language}', { language: switchTo }), switchTo],
        terms: ['language arabic english لغة عربي'],
        boost: 5,
      }),
      makeEntry({
        key: THEME_KEY,
        kind: 'action',
        title: t('Change theme'),
        subtitle: t('Appearance'),
        to: '/settings/appearance',
        names: [t('Change theme'), 'Change theme', t('Appearance')],
        terms: ['theme appearance colour color dark light mode سمة مظهر ألوان داكن فاتح'],
        boost: 4,
      }),
      makeEntry({
        key: THEME_SWITCH_KEY,
        kind: 'action',
        title: dark ? t('Switch to light theme') : t('Switch to dark theme'),
        to: '',
        names: [
          dark ? t('Switch to light theme') : t('Switch to dark theme'),
          dark ? 'Switch to light theme' : 'Switch to dark theme',
        ],
        terms: ['theme dark light mode night سمة داكن فاتح ليلي'],
        boost: 4,
      }),
    ];
    // The language is a dependency: titles are translated when built.
  }, [
    taxesOn,
    extras,
    finder,
    approvals,
    payrollApprovals,
    company.chequePrinting,
    language,
    dark,
    access,
    app.id,
    apps,
    readOnly,
    syncText,
    syncing,
  ]);
  const found = useLiveQuery(
    // Files of people data aren't even listed for those who don't see them.
    () => recordEntries(company, fmt, { people: !hidePeople }),
    // `language` changes the names and words shown.
    [company, fmt, language, hidePeople],
  );
  // Employees of the other companies switched on for the search across
  // companies: each judged by its own role, whatever the open company's is.
  const everywhere = useEmployeesEverywhere();
  const openInCompany = useOpenInCompany();
  const records = useMemo(() => {
    const own = hidePeople ? found?.filter((entry) => !isPeopleItem(entry)) : found;
    if (!own || !everywhere) return own;
    return [
      ...own,
      ...otherCompanyEmployeeEntries(everywhere.employees, everywhere.companies, company.id),
    ];
  }, [found, hidePeople, everywhere, company.id]);

  const sections = useMemo<Section[]>(() => {
    const all = records ? [...fixed, ...records] : fixed;
    if (!deferred.trim()) {
      const byKey = new Map(all.map((e) => [e.key, e]));
      const recentEntries = recent.map(
        (r): SearchEntry =>
          // Fresh title and route when the record still exists.
          byKey.get(r.key) ?? {
            ...r,
            names: [],
            terms: [],
            compact: [],
            amounts: [],
            boost: 0,
          },
      );
      const quick = QUICK_ACTIONS.map((k) => byKey.get(k)).filter(
        (e): e is SearchEntry => e !== undefined && !recent.some((r) => r.key === e.key),
      );
      return [
        { kind: 'recent' as const, label: t(SECTION_LABELS.recent), entries: recentEntries },
        { kind: 'action' as const, label: t('Quick actions'), entries: quick },
      ].filter((s) => s.entries.length > 0);
    }
    // Sections in the order of their best result.
    const found = searchEntries(all, deferred, 50);
    const map = new Map<SearchKind, SearchEntry[]>();
    for (const entry of found) {
      const list = map.get(entry.kind) ?? [];
      list.push(entry);
      map.set(entry.kind, list);
    }
    return [...map.entries()].map(([kind, entries]) => ({
      kind,
      label: t(SECTION_LABELS[kind]),
      entries,
    }));
  }, [fixed, records, deferred, recent]);

  const flat = useMemo(() => sections.flatMap((s) => s.entries), [sections]);
  const current = Math.min(active, Math.max(0, flat.length - 1));
  const optionId = (i: number) => `${listId}-option-${i}`;

  useEffect(() => {
    document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' });
    // optionId only depends on listId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, listId]);

  const choose = (entry: SearchEntry | undefined) => {
    if (!entry) return;
    onClose();
    if (entry.key === LANGUAGE_KEY) {
      // Asks first when a form has unsaved changes.
      void switchLanguage(language === 'ar' ? 'en' : 'ar');
      return;
    }
    if (entry.key === THEME_SWITCH_KEY) {
      setPreference(chooseTheme(preference, dark ? preference.light : preference.dark));
      return;
    }
    if (entry.key === SYNC_KEY) {
      void manager?.syncNow(company.id).then(() => toast.success(t('Sync finished')));
      return;
    }
    if (entry.companyId && entry.companyId !== company.id) {
      // Recent in the company it belongs to, where it is one of its employees.
      rememberRecent(entry.companyId, {
        key: `employee:${entry.key.slice('elsewhere:'.length)}`,
        kind: 'employee',
        title: entry.title,
        subtitle: t('Employee'),
        to: entry.to,
      });
      void openInCompany(entry.companyId, entry.to);
      return;
    }
    rememberRecent(company.id, {
      key: entry.key,
      kind: entry.kind,
      title: entry.title,
      subtitle: entry.subtitle,
      to: entry.to,
    });
    if (entry.kind === 'item') {
      navigate('/products');
      onOpenItem(entry.key.slice('item:'.length));
      return;
    }
    if (entry.kind === 'file') {
      openStoredAttachment(entry.key.slice('file:'.length));
      return;
    }
    navigate(entry.to);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const move = (to: number) => {
      e.preventDefault();
      if (flat.length) setActive((to + flat.length) % flat.length);
    };
    if (e.key === 'ArrowDown') move(current + 1);
    else if (e.key === 'ArrowUp') move(current - 1);
    else if (e.key === 'PageDown') move(Math.min(flat.length - 1, current + 5));
    else if (e.key === 'PageUp') move(Math.max(0, current - 5));
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      choose(flat[current]);
    }
  };

  let index = -1;
  const searching = deferred.trim().length > 0;

  return (
    <>
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 sm:px-5">
        <Search className="size-5 shrink-0 text-slate-400" aria-hidden />
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={flat.length ? optionId(current) : undefined}
          aria-label={t('Search')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t('Search clients, documents, items or pages…')}
          className="h-14 min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        <button
          type="button"
          onClick={onClose}
          className="text-primary-700 -me-2 rounded-md px-2 py-1.5 text-sm font-medium sm:hidden"
        >
          {t('Cancel')}
        </button>
        <kbd className="hidden rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-xs text-slate-500 sm:block">
          Esc
        </kbd>
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label={t('Results')}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
      >
        {sections.length === 0 ? (
          <Empty searching={searching} query={deferred} loading={!records && searching} />
        ) : (
          sections.map((section) => (
            <div key={section.kind} role="group" aria-labelledby={`${listId}-${section.kind}`}>
              <p
                id={`${listId}-${section.kind}`}
                className="px-3 pt-3 pb-1.5 text-xs font-semibold text-slate-500"
              >
                {section.label}
              </p>
              {section.entries.map((entry) => {
                index += 1;
                const i = index;
                const Icon =
                  icons.get(entry.key) ??
                  (entry.key === LANGUAGE_KEY
                    ? Languages
                    : entry.key === THEME_KEY
                      ? Palette
                      : entry.key === THEME_SWITCH_KEY
                        ? dark
                          ? Sun
                          : Moon
                        : KIND_ICONS[entry.kind]);
                return (
                  <div
                    key={entry.key}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === current}
                    onPointerMove={() => i !== current && setActive(i)}
                    onClick={() => choose(entry)}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2',
                      i === current ? 'bg-primary-50' : 'hover:bg-slate-50',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4',
                        i === current
                          ? 'text-primary-700 bg-surface shadow-xs ring-1 ring-slate-200'
                          : 'bg-slate-100 text-slate-500',
                      )}
                      aria-hidden
                    >
                      <Icon />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        dir="auto"
                        className="block truncate text-start text-sm font-medium text-slate-900"
                      >
                        {entry.title}
                      </span>
                      {entry.subtitle ? (
                        <span className="block truncate text-xs text-slate-500">
                          {entry.subtitle}
                        </span>
                      ) : null}
                    </span>
                    {entry.amount ? (
                      <span
                        dir="ltr"
                        className="tabular shrink-0 text-sm text-slate-600 [unicode-bidi:isolate]"
                      >
                        {entry.amount}
                      </span>
                    ) : null}
                    {i === current ? (
                      <CornerDownLeft
                        className="hidden size-4 shrink-0 text-slate-400 sm:block rtl:-scale-x-100"
                        aria-hidden
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="hidden items-center gap-4 border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500 sm:flex">
        <Hint keys={['↑', '↓']}>{t('to move')}</Hint>
        <Hint keys={['↵']}>{t('to open')}</Hint>
        <Hint keys={['Esc']}>{t('to close')}</Hint>
        {searching && flat.length ? (
          <span className="ms-auto">{tp(flat.length, '{count} result', '{count} results')}</span>
        ) : null}
      </div>
    </>
  );
}

function Hint({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {keys.map((k) => (
        <kbd
          key={k}
          className="min-w-5 rounded border border-slate-200 bg-slate-50 px-1 py-px text-center font-sans text-[0.6875rem] text-slate-600"
        >
          {k}
        </kbd>
      ))}
      {children}
    </span>
  );
}

function Empty({
  searching,
  query,
  loading,
}: {
  searching: boolean;
  query: string;
  loading: boolean;
}) {
  if (loading)
    return <p className="px-3 py-10 text-center text-sm text-slate-500">{t('Loading…')}</p>;
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-800">
        {searching ? t('Nothing found for “{query}”', { query: query.trim() }) : t('Start typing')}
      </p>
      <p className="mt-1 text-sm text-slate-500">
        {t('Try a client name, a document number such as INV-0001, or an amount.')}
      </p>
    </div>
  );
}
