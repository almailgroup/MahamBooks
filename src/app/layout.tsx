import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Building2,
  ChevronsUpDown,
  FileMinus,
  FileText,
  CalendarClock,
  IdCard,
  Landmark,
  LayoutDashboard,
  ListTree,
  Menu as MenuIcon,
  NotebookPen,
  Package,
  Palette,
  Plus,
  Receipt,
  ReceiptText,
  Repeat,
  ScrollText,
  Settings,
  Truck,
  Users,
  Wallet,
  X,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { APP_NAME } from '@/lib/brand';
import { useCompanyContext } from './company';
import { Button } from '@/components/ui/button';
import {
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/overlay';
import { Spinner } from '@/components/ui/misc';
import { toast } from 'sonner';
import { generateDueInvoices } from '@/db/recurring';
import { LanguageSwitch } from '@/i18n/language-switch';
import { msg, t, tp } from '@/i18n';
import { localName } from '@/i18n/names';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

const NAV: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: '/', label: msg('Dashboard'), icon: <LayoutDashboard />, end: true },
      { to: '/products', label: msg('Products & services'), icon: <Package /> },
    ],
  },
  {
    title: msg('Sales'),
    items: [
      { to: '/clients', label: msg('Clients'), icon: <Users /> },
      { to: '/invoices', label: msg('Invoices'), icon: <FileText /> },
      { to: '/quotes', label: msg('Quotes'), icon: <ScrollText /> },
      { to: '/credits', label: msg('Credit notes'), icon: <FileMinus /> },
      { to: '/recurring', label: msg('Recurring'), icon: <Repeat /> },
      { to: '/payments', label: msg('Payments received'), icon: <ArrowDownLeft /> },
    ],
  },
  {
    title: msg('Purchases'),
    items: [
      { to: '/vendors', label: msg('Vendors'), icon: <Truck /> },
      { to: '/bills', label: msg('Bills'), icon: <Receipt /> },
      { to: '/expenses', label: msg('Expenses'), icon: <Wallet /> },
      { to: '/payments-made', label: msg('Payments made'), icon: <ArrowUpRight /> },
      { to: '/vendor-credits', label: msg('Vendor credits'), icon: <ReceiptText /> },
    ],
  },
  {
    title: msg('Accounting'),
    items: [
      { to: '/banking', label: msg('Banking'), icon: <Banknote /> },
      { to: '/reports', label: msg('Reports'), icon: <BarChart3 /> },
      { to: '/vat', label: msg('VAT returns'), icon: <Landmark /> },
      { to: '/accounts', label: msg('Chart of accounts'), icon: <ListTree /> },
      { to: '/journals', label: msg('Manual journals'), icon: <NotebookPen /> },
    ],
  },
  {
    title: msg('Business'),
    items: [
      { to: '/employees', label: msg('Employees'), icon: <IdCard /> },
      { to: '/compliance', label: msg('Compliance'), icon: <CalendarClock /> },
      { to: '/templates', label: msg('Templates'), icon: <Palette /> },
      { to: '/settings', label: msg('Settings'), icon: <Settings /> },
    ],
  },
];

function CompanyLogo({
  name,
  logo,
  className,
}: {
  name: string;
  logo: string | null;
  className?: string;
}) {
  if (logo) {
    return (
      <span
        className={cn(
          'flex size-8 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-slate-200',
          className,
        )}
      >
        <img src={logo} alt="" className="max-h-full max-w-full object-contain" />
      </span>
    );
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <span
      className={cn(
        'bg-primary-600 flex size-8 items-center justify-center rounded-md text-xs font-semibold text-white',
        className,
      )}
    >
      {initials || <Building2 className="size-4" />}
    </span>
  );
}

function CompanySwitcher() {
  const { company, companies, switchCompany } = useCompanyContext();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg p-2 text-start hover:bg-slate-100"
          aria-label={t('Switch company')}
        >
          <CompanyLogo name={company.name} logo={company.branding.logo} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-900">
              {localName(company)}
            </span>
            <span className="block truncate text-xs text-slate-500">
              {company.currency} · {APP_NAME}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
        </button>
      </DropdownTrigger>
      <DropdownContent align="start" className="w-64">
        <DropdownLabel>{t('Companies')}</DropdownLabel>
        {companies.map((c) => (
          <DropdownItem
            key={c.id}
            onSelect={() => {
              void switchCompany(c.id);
              navigate('/');
            }}
            icon={c.id === company.id ? <Check /> : <span className="inline-block size-4" />}
          >
            <span className="truncate">{localName(c)}</span>
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem icon={<Plus />} onSelect={() => navigate('/setup')}>
          {t('Add company')}
        </DropdownItem>
      </DropdownContent>
    </DropdownMenu>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <CompanySwitcher />
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label={t('Main')}>
        {NAV.map((group, gi) => (
          <div key={gi}>
            {group.title ? (
              <p className="px-2 pb-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                {t(group.title)}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors [&_svg]:size-4.5',
                        isActive
                          ? 'bg-primary-50 text-primary-700 [&_svg]:text-primary-600'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 [&_svg]:text-slate-400',
                      )
                    }
                  >
                    {item.icon}
                    {t(item.label)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-400">
        {t('Data is stored in this browser.')}{' '}
        <Link
          to="/settings/data"
          onClick={onNavigate}
          className="font-medium text-slate-500 underline-offset-2 hover:underline"
        >
          {t('Back up')}
        </Link>
      </div>
    </div>
  );
}

function NewMenu() {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownTrigger asChild>
        <Button size="sm">
          <Plus /> {t('New')}
        </Button>
      </DropdownTrigger>
      <DropdownContent className="w-56">
        <DropdownLabel>{t('Sales')}</DropdownLabel>
        <DropdownItem icon={<FileText />} onSelect={() => navigate('/invoices/new')}>
          {t('Invoice')}
        </DropdownItem>
        <DropdownItem icon={<ScrollText />} onSelect={() => navigate('/quotes/new')}>
          {t('Quote')}
        </DropdownItem>
        <DropdownItem icon={<FileMinus />} onSelect={() => navigate('/credits/new')}>
          {t('Credit note')}
        </DropdownItem>
        <DropdownItem icon={<Repeat />} onSelect={() => navigate('/recurring/new')}>
          {t('Recurring invoice')}
        </DropdownItem>
        <DropdownItem icon={<ArrowDownLeft />} onSelect={() => navigate('/payments/new')}>
          {t('Payment received')}
        </DropdownItem>
        <DropdownSeparator />
        <DropdownLabel>{t('Purchases')}</DropdownLabel>
        <DropdownItem icon={<Receipt />} onSelect={() => navigate('/bills/new')}>
          {t('Bill')}
        </DropdownItem>
        <DropdownItem icon={<Wallet />} onSelect={() => navigate('/expenses?new=1')}>
          {t('Expense')}
        </DropdownItem>
        <DropdownItem icon={<ArrowUpRight />} onSelect={() => navigate('/payments-made/new')}>
          {t('Payment made')}
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem icon={<Users />} onSelect={() => navigate('/clients/new')}>
          {t('Client')}
        </DropdownItem>
        <DropdownItem icon={<Truck />} onSelect={() => navigate('/vendors/new')}>
          {t('Vendor')}
        </DropdownItem>
        <DropdownItem icon={<Package />} onSelect={() => navigate('/products?new=1')}>
          {t('Product or service')}
        </DropdownItem>
      </DropdownContent>
    </DropdownMenu>
  );
}

// Recurring invoices are generated client-side, once per company per visit.
const recurringChecked = new Set<string>();

function useRecurringGeneration() {
  const { company } = useCompanyContext();
  const navigate = useNavigate();
  useEffect(() => {
    if (recurringChecked.has(company.id)) return;
    recurringChecked.add(company.id);
    void generateDueInvoices(company.id)
      .then((created) => {
        if (created.length === 0) return;
        toast.success(
          tp(
            created.length,
            '{count} recurring invoice created',
            '{count} recurring invoices created',
          ),
          { action: { label: t('View'), onClick: () => navigate('/invoices') } },
        );
      })
      .catch(() => {
        recurringChecked.delete(company.id);
      });
  }, [company.id, navigate]);
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  useRecurringGeneration();
  const location = useLocation();
  // Full-width pages (the document editor) manage their own layout.
  const wide =
    /\/(new|edit)$/.test(location.pathname) ||
    /^\/(invoices|quotes|credits)\/[^/]+$/.test(location.pathname);

  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 border-e border-slate-200 bg-white lg:block">
        <SidebarContent />
      </aside>

      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 start-0 z-50 w-72 bg-white shadow-xl lg:hidden">
            <DialogPrimitive.Title className="sr-only">{t('Navigation')}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              {t('Main navigation')}
            </DialogPrimitive.Description>
            <DialogPrimitive.Close className="absolute -end-11 top-3 rounded-md bg-white p-1.5 text-slate-500">
              <X className="size-5" />
              <span className="sr-only">{t('Close menu')}</span>
            </DialogPrimitive.Close>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="lg:ps-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label={t('Open menu')}
          >
            <MenuIcon />
          </Button>
          <div className="flex-1" />
          <LanguageSwitch />
          <NewMenu />
        </header>
        <main
          className={cn('mx-auto px-4 py-6 sm:px-6 lg:py-8', wide ? 'max-w-[1600px]' : 'max-w-7xl')}
        >
          <Suspense fallback={<Spinner className="py-24" label={t('Loading…')} />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export { CompanyLogo };
