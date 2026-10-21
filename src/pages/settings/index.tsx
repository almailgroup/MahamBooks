import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import {
  BellRing,
  BookOpen,
  Building2,
  Cloud,
  UserRound,
  UsersRound,
  Database,
  FileCog,
  FileUp,
  Hash,
  Languages,
  Layers,
  Link2,
  Mail,
  Package,
  Palette,
  Percent,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { msg, t } from '@/i18n';
import { PageHeader, Spinner } from '@/components/ui/misc';

const CompanySettings = lazy(() => import('./company'));
const DocumentSettings = lazy(() => import('./documents'));
const NumberingSettings = lazy(() => import('./numbering'));
const ItemSettings = lazy(() => import('./items'));
const TaxSettings = lazy(() => import('./taxes'));
const AccountingSettings = lazy(() => import('./accounting'));
const PaymentSettingsPage = lazy(() => import('./payments'));
const EmailSettings = lazy(() => import('./emails'));
const LabelSettings = lazy(() => import('./labels'));
const ImportSettings = lazy(() => import('./import'));
const DataSettings = lazy(() => import('./data'));
const CompaniesSettings = lazy(() => import('./companies'));
const AppearanceSettings = lazy(() => import('./appearance'));
const AccountSettings = lazy(() => import('./account'));
const TeamSettings = lazy(() => import('./team'));
const CloudSettings = lazy(() => import('./cloud'));
const LinkSettings = lazy(() => import('./links'));
const AlertSettings = lazy(() => import('./alerts'));

const GROUPS: { title: string; items: { path: string; label: string; icon: ReactNode }[] }[] = [
  {
    title: msg('Business'),
    items: [
      { path: 'company', label: msg('Company profile'), icon: <Building2 /> },
      { path: 'companies', label: msg('Companies'), icon: <Layers /> },
      { path: 'links', label: msg('Links'), icon: <Link2 /> },
    ],
  },
  {
    title: msg('Account and team'),
    items: [
      { path: 'account', label: msg('Your account'), icon: <UserRound /> },
      { path: 'alerts', label: msg('Email alerts'), icon: <BellRing /> },
      { path: 'team', label: msg('Team'), icon: <UsersRound /> },
      { path: 'cloud', label: msg('Cloud and sync'), icon: <Cloud /> },
    ],
  },
  {
    title: msg('Documents'),
    items: [
      { path: 'documents', label: msg('Invoice defaults'), icon: <FileCog /> },
      { path: 'numbering', label: msg('Numbering'), icon: <Hash /> },
      { path: 'items', label: msg('Items and units'), icon: <Package /> },
      { path: 'emails', label: msg('Email templates'), icon: <Mail /> },
      { path: 'labels', label: msg('Language & wording'), icon: <Languages /> },
    ],
  },
  {
    title: msg('Money'),
    items: [
      { path: 'payments', label: msg('Payment details'), icon: <Wallet /> },
      { path: 'taxes', label: msg('Taxes'), icon: <Percent /> },
      { path: 'accounting', label: msg('Accounting'), icon: <BookOpen /> },
    ],
  },
  {
    title: msg('Data'),
    items: [
      { path: 'import', label: msg('Import data'), icon: <FileUp /> },
      { path: 'data', label: msg('Backup & data'), icon: <Database /> },
    ],
  },
  {
    title: msg('This device'),
    items: [{ path: 'appearance', label: msg('Appearance'), icon: <Palette /> }],
  },
];

export default function SettingsPage() {
  const { pathname } = useLocation();
  const row = useRef<HTMLDivElement>(null);

  // On phones the sections scroll sideways: keep the open one in view.
  useEffect(() => {
    const el = row.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    el.querySelector('[aria-current="page"]')?.scrollIntoView({
      block: 'nearest',
      inline: 'center',
    });
  }, [pathname]);

  return (
    <div>
      <PageHeader
        title={t('Settings')}
        description={t('Your company details and how your documents are created.')}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav
          aria-label={t('Settings sections')}
          className="min-w-0 lg:sticky lg:top-20 lg:self-start"
        >
          {/* Phones and tablets: one row that scrolls sideways. Desktop: grouped list. */}
          <div
            ref={row}
            className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:flex-col lg:gap-5 lg:overflow-visible lg:pb-0"
          >
            {GROUPS.map((group) => (
              <div key={group.title} className="contents lg:block">
                <p className="hidden px-3 pb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase lg:block">
                  {t(group.title)}
                </p>
                <ul className="contents lg:block lg:space-y-0.5">
                  {group.items.map((s) => (
                    <li key={s.path} className="shrink-0">
                      <NavLink
                        to={`/settings/${s.path}`}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap [&_svg]:size-4',
                            isActive
                              ? 'text-primary-700 [&_svg]:text-primary-600 bg-surface shadow-xs ring-1 ring-slate-200'
                              : 'hover:bg-surface text-slate-600 hover:text-slate-900 [&_svg]:text-slate-400',
                          )
                        }
                      >
                        {s.icon}
                        {t(s.label)}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <div className="min-w-0">
          <Suspense fallback={<Spinner className="py-24" label={t('Loading…')} />}>
            <Routes>
              <Route index element={<Navigate to="company" replace />} />
              <Route path="company" element={<CompanySettings />} />
              <Route path="documents" element={<DocumentSettings />} />
              <Route path="numbering" element={<NumberingSettings />} />
              <Route path="items" element={<ItemSettings />} />
              <Route path="taxes" element={<TaxSettings />} />
              <Route path="accounting" element={<AccountingSettings />} />
              <Route path="payments" element={<PaymentSettingsPage />} />
              <Route path="emails" element={<EmailSettings />} />
              <Route path="labels" element={<LabelSettings />} />
              <Route path="import" element={<ImportSettings />} />
              <Route path="data" element={<DataSettings />} />
              <Route path="companies" element={<CompaniesSettings />} />
              <Route path="appearance" element={<AppearanceSettings />} />
              <Route path="account" element={<AccountSettings />} />
              <Route path="team" element={<TeamSettings />} />
              <Route path="cloud" element={<CloudSettings />} />
              <Route path="links" element={<LinkSettings />} />
              <Route path="alerts" element={<AlertSettings />} />
              <Route path="*" element={<Navigate to="company" replace />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </div>
  );
}
