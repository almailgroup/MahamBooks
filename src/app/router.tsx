import { lazy, Suspense, type ReactNode } from 'react';
import { createHashRouter, isRouteErrorResponse, Link, Outlet, useRouteError } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { CompanyProvider } from './company';
import { AppLayout } from './layout';
import { Spinner } from '@/components/ui/misc';
import { buttonClass } from '@/components/ui/button';
import SetupPage from '@/pages/setup';
import type { DocumentType, PurchaseDocumentType } from '@/db/types';
import { t } from '@/i18n';

const Dashboard = lazy(() => import('@/pages/dashboard'));
const DocumentList = lazy(() => import('@/pages/documents/list'));
const DocumentEditor = lazy(() => import('@/pages/documents/editor'));
const DocumentView = lazy(() => import('@/pages/documents/view'));
const ClientList = lazy(() => import('@/pages/clients/list'));
const ClientDetail = lazy(() => import('@/pages/clients/detail'));
const ClientFormPage = lazy(() => import('@/pages/clients/form'));
const Products = lazy(() => import('@/pages/products'));
const Inventory = lazy(() => import('@/pages/inventory/index'));
const StockEntryForm = lazy(() => import('@/pages/inventory/entry-form'));
const StockEntryView = lazy(() => import('@/pages/inventory/entry-view'));
const StockCount = lazy(() => import('@/pages/inventory/count'));
const StockCountPrint = lazy(() => import('@/pages/inventory/count-print'));
const LandedCostForm = lazy(() => import('@/pages/inventory/landed-cost-form'));
const LandedCostView = lazy(() => import('@/pages/inventory/landed-cost-view'));
const PaymentList = lazy(() => import('@/pages/payments/list'));
const PaymentDetail = lazy(() => import('@/pages/payments/detail'));
const PaymentForm = lazy(() => import('@/pages/payments/form'));
const PaymentVoucher = lazy(() => import('@/pages/payments/voucher'));
const ChequeRegister = lazy(() => import('@/pages/cheques/index'));
const ChequeRegisterPrint = lazy(() => import('@/pages/cheques/print'));
const RecurringList = lazy(() => import('@/pages/recurring/list'));
const RecurringEditor = lazy(() => import('@/pages/recurring/editor'));
const Reports = lazy(() => import('@/pages/reports/index'));
const Templates = lazy(() => import('@/pages/templates'));
const Settings = lazy(() => import('@/pages/settings/index'));
const ChartOfAccounts = lazy(() => import('@/pages/accounting/chart'));
const Journals = lazy(() => import('@/pages/accounting/journals'));
const JournalEditor = lazy(() => import('@/pages/accounting/journal-editor'));
const BillEditor = lazy(() => import('@/pages/purchases/bill-editor'));
const BillView = lazy(() => import('@/pages/purchases/bill-view'));
const Expenses = lazy(() => import('@/pages/purchases/expenses'));
const Vat = lazy(() => import('@/pages/accounting/vat'));
const Banking = lazy(() => import('@/pages/banking/index'));
const EmployeeList = lazy(() => import('@/pages/people/list'));
const EmployeeDetail = lazy(() => import('@/pages/people/detail'));
const EmployeeForm = lazy(() => import('@/pages/people/form'));
const Compliance = lazy(() => import('@/pages/compliance/index'));
const ComplianceDocuments = lazy(() => import('@/pages/compliance/documents'));
const Assets = lazy(() => import('@/pages/assets/index'));
const AssetForm = lazy(() => import('@/pages/assets/form'));
const AssetDetail = lazy(() => import('@/pages/assets/detail'));
const YearEnd = lazy(() => import('@/pages/accounting/year-end'));
const Payroll = lazy(() => import('@/pages/payroll/index'));
const PayRun = lazy(() => import('@/pages/payroll/run'));
const PayrollLeave = lazy(() => import('@/pages/payroll/leave'));
const PayrollLoans = lazy(() => import('@/pages/payroll/loans'));
const PayrollSettings = lazy(() => import('@/pages/payroll/settings'));
const Payslips = lazy(() => import('@/pages/payroll/payslips'));
const Settlement = lazy(() => import('@/pages/payroll/settlement'));
const SettlementPrint = lazy(() => import('@/pages/payroll/settlement-print'));
const NotFound = lazy(() => import('@/pages/not-found'));

function Root() {
  return (
    <CompanyProvider
      fallback={<Spinner className="min-h-dvh" label={t('Loading…')} />}
      onboarding={<SetupPage firstRun />}
    >
      <Outlet />
    </CompanyProvider>
  );
}

/** Pages without the app's navigation, such as print views. */
function Bare({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Spinner className="min-h-dvh" />}>{children}</Suspense>;
}

function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : t('Unknown error');
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <AlertTriangle className="mx-auto size-10 text-amber-500" />
        <h1 className="mt-4 text-lg font-semibold text-slate-900">{t('Something went wrong')}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {t('Your data is safe — it is stored in this browser. Try reloading the page.')}
        </p>
        <pre className="mt-4 max-h-32 overflow-auto rounded-md bg-slate-50 p-3 text-start text-xs text-slate-500">
          {message}
        </pre>
        <div className="mt-6 flex justify-center gap-3">
          <button className={buttonClass('outline')} onClick={() => window.location.reload()}>
            {t('Reload')}
          </button>
          <Link to="/" className={buttonClass('primary')} reloadDocument>
            {t('Go to dashboard')}
          </Link>
        </div>
      </div>
    </div>
  );
}

// Sales documents: one list, editor and page for invoices, quotes, credit
// notes, proforma invoices, sales orders and delivery notes.
const documentRoutes = (path: string, type: Exclude<DocumentType, PurchaseDocumentType>) => [
  { path, element: <DocumentList key={type} type={type} /> },
  { path: `${path}/new`, element: <DocumentEditor key={`${type}-new`} type={type} /> },
  { path: `${path}/:id`, element: <DocumentView key={type} type={type} /> },
  { path: `${path}/:id/edit`, element: <DocumentEditor key={type} type={type} /> },
];

// Bills, vendor credits and purchase orders: the same list as sales documents,
// their own editor and page.
const purchaseRoutes = (path: string, type: PurchaseDocumentType) => [
  { path, element: <DocumentList key={type} type={type} /> },
  { path: `${path}/new`, element: <BillEditor key={`${type}-new`} type={type} /> },
  { path: `${path}/:id`, element: <BillView key={type} type={type} /> },
  { path: `${path}/:id/edit`, element: <BillEditor key={type} type={type} /> },
];

const contactRoutes = (path: string, kind: 'customer' | 'vendor') => [
  { path, element: <ClientList key={kind} kind={kind} /> },
  { path: `${path}/new`, element: <ClientFormPage key={`${kind}-new`} kind={kind} /> },
  { path: `${path}/:id`, element: <ClientDetail key={kind} kind={kind} /> },
  { path: `${path}/:id/edit`, element: <ClientFormPage key={kind} kind={kind} /> },
];

const paymentRoutes = (path: string, direction: 'in' | 'out') => [
  { path, element: <PaymentList key={direction} direction={direction} /> },
  { path: `${path}/new`, element: <PaymentForm key={`${direction}-new`} direction={direction} /> },
  { path: `${path}/:id`, element: <PaymentDetail key={direction} direction={direction} /> },
  { path: `${path}/:id/edit`, element: <PaymentForm key={direction} direction={direction} /> },
];

export const router = createHashRouter([
  {
    path: '/',
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      // Print views: vouchers and the cheque register, without the navigation.
      {
        path: 'payments/:id/voucher',
        element: (
          <Bare>
            <PaymentVoucher key="in" direction="in" />
          </Bare>
        ),
      },
      {
        path: 'payments-made/:id/voucher',
        element: (
          <Bare>
            <PaymentVoucher key="out" direction="out" />
          </Bare>
        ),
      },
      {
        path: 'cheques/print',
        element: (
          <Bare>
            <ChequeRegisterPrint />
          </Bare>
        ),
      },
      {
        path: 'payroll/runs/:id/payslips',
        element: (
          <Bare>
            <Payslips />
          </Bare>
        ),
      },
      {
        path: 'payroll/settlements/:id/print',
        element: (
          <Bare>
            <SettlementPrint />
          </Bare>
        ),
      },
      {
        path: 'inventory/count/print',
        element: (
          <Bare>
            <StockCountPrint />
          </Bare>
        ),
      },
      {
        element: <AppLayout />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Dashboard /> },
          ...documentRoutes('invoices', 'invoice'),
          ...documentRoutes('quotes', 'quote'),
          ...documentRoutes('credits', 'credit'),
          ...documentRoutes('proformas', 'proforma'),
          ...documentRoutes('sales-orders', 'sales_order'),
          ...documentRoutes('delivery-notes', 'delivery_note'),
          { path: 'recurring', element: <RecurringList /> },
          { path: 'recurring/new', element: <RecurringEditor /> },
          { path: 'recurring/:id', element: <RecurringEditor /> },
          ...paymentRoutes('payments', 'in'),
          { path: 'cheques', element: <ChequeRegister /> },
          ...contactRoutes('clients', 'customer'),
          ...contactRoutes('vendors', 'vendor'),
          ...purchaseRoutes('bills', 'bill'),
          ...purchaseRoutes('vendor-credits', 'vendor_credit'),
          ...purchaseRoutes('purchase-orders', 'purchase_order'),
          ...paymentRoutes('payments-made', 'out'),
          { path: 'expenses', element: <Expenses /> },
          { path: 'products', element: <Products /> },
          { path: 'inventory', element: <Inventory /> },
          { path: 'inventory/adjustments/new', element: <StockEntryForm /> },
          { path: 'inventory/entries/:id', element: <StockEntryView /> },
          { path: 'inventory/count', element: <StockCount /> },
          { path: 'inventory/landed-costs/new', element: <LandedCostForm /> },
          { path: 'inventory/landed-costs/:id', element: <LandedCostView /> },
          { path: 'reports', element: <Reports /> },
          { path: 'reports/:report', element: <Reports /> },
          { path: 'accounts', element: <ChartOfAccounts /> },
          { path: 'journals', element: <Journals /> },
          { path: 'journals/new', element: <JournalEditor key="new" /> },
          { path: 'journals/:id', element: <JournalEditor /> },
          { path: 'assets', element: <Assets /> },
          { path: 'assets/new', element: <AssetForm key="new" /> },
          { path: 'assets/:id', element: <AssetDetail /> },
          { path: 'assets/:id/edit', element: <AssetForm /> },
          { path: 'year-end', element: <YearEnd /> },
          { path: 'banking', element: <Banking /> },
          { path: 'banking/:accountId', element: <Banking /> },
          { path: 'vat', element: <Vat /> },
          { path: 'vat/:start', element: <Vat /> },
          { path: 'employees', element: <EmployeeList /> },
          { path: 'employees/new', element: <EmployeeForm key="new" /> },
          { path: 'employees/:id', element: <EmployeeDetail /> },
          { path: 'employees/:id/edit', element: <EmployeeForm /> },
          { path: 'employees/:id/settlement', element: <Settlement /> },
          { path: 'payroll', element: <Payroll /> },
          { path: 'payroll/runs/:id', element: <PayRun /> },
          { path: 'payroll/leave', element: <PayrollLeave /> },
          { path: 'payroll/loans', element: <PayrollLoans /> },
          { path: 'payroll/settings', element: <PayrollSettings /> },
          { path: 'compliance', element: <Compliance /> },
          { path: 'compliance/documents', element: <ComplianceDocuments /> },
          { path: 'templates', element: <Templates /> },
          { path: 'settings/*', element: <Settings /> },
          { path: 'setup', element: <SetupPage /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
