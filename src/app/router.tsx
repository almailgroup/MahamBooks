import { lazy } from 'react';
import { createHashRouter, isRouteErrorResponse, Link, Outlet, useRouteError } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { CompanyProvider } from './company';
import { AppLayout } from './layout';
import { Spinner } from '@/components/ui/misc';
import { buttonClass } from '@/components/ui/button';
import SetupPage from '@/pages/setup';

const Dashboard = lazy(() => import('@/pages/dashboard'));
const DocumentList = lazy(() => import('@/pages/documents/list'));
const DocumentEditor = lazy(() => import('@/pages/documents/editor'));
const DocumentView = lazy(() => import('@/pages/documents/view'));
const ClientList = lazy(() => import('@/pages/clients/list'));
const ClientDetail = lazy(() => import('@/pages/clients/detail'));
const ClientFormPage = lazy(() => import('@/pages/clients/form'));
const Products = lazy(() => import('@/pages/products'));
const PaymentList = lazy(() => import('@/pages/payments/list'));
const PaymentDetail = lazy(() => import('@/pages/payments/detail'));
const PaymentForm = lazy(() => import('@/pages/payments/form'));
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
const NotFound = lazy(() => import('@/pages/not-found'));

function Root() {
  return (
    <CompanyProvider
      fallback={<Spinner className="min-h-dvh" label="Loading…" />}
      onboarding={<SetupPage firstRun />}
    >
      <Outlet />
    </CompanyProvider>
  );
}

function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <AlertTriangle className="mx-auto size-10 text-amber-500" />
        <h1 className="mt-4 text-lg font-semibold text-slate-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your data is safe — it is stored in this browser. Try reloading the page.
        </p>
        <pre className="mt-4 max-h-32 overflow-auto rounded-md bg-slate-50 p-3 text-start text-xs text-slate-500">
          {message}
        </pre>
        <div className="mt-6 flex justify-center gap-3">
          <button className={buttonClass('outline')} onClick={() => window.location.reload()}>
            Reload
          </button>
          <Link to="/" className={buttonClass('primary')} reloadDocument>
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

const documentRoutes = (path: string, type: 'invoice' | 'quote' | 'credit') => [
  { path, element: <DocumentList key={type} type={type} /> },
  { path: `${path}/new`, element: <DocumentEditor key={`${type}-new`} type={type} /> },
  { path: `${path}/:id`, element: <DocumentView key={type} type={type} /> },
  { path: `${path}/:id/edit`, element: <DocumentEditor key={type} type={type} /> },
];

// Bills and vendor credits: the same list as sales documents, their own editor and page.
const purchaseRoutes = (path: string, type: 'bill' | 'vendor_credit') => [
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
      {
        element: <AppLayout />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Dashboard /> },
          ...documentRoutes('invoices', 'invoice'),
          ...documentRoutes('quotes', 'quote'),
          ...documentRoutes('credits', 'credit'),
          { path: 'recurring', element: <RecurringList /> },
          { path: 'recurring/new', element: <RecurringEditor /> },
          { path: 'recurring/:id', element: <RecurringEditor /> },
          ...paymentRoutes('payments', 'in'),
          ...contactRoutes('clients', 'customer'),
          ...contactRoutes('vendors', 'vendor'),
          ...purchaseRoutes('bills', 'bill'),
          ...purchaseRoutes('vendor-credits', 'vendor_credit'),
          ...paymentRoutes('payments-made', 'out'),
          { path: 'expenses', element: <Expenses /> },
          { path: 'products', element: <Products /> },
          { path: 'reports', element: <Reports /> },
          { path: 'reports/:report', element: <Reports /> },
          { path: 'accounts', element: <ChartOfAccounts /> },
          { path: 'journals', element: <Journals /> },
          { path: 'journals/new', element: <JournalEditor key="new" /> },
          { path: 'journals/:id', element: <JournalEditor /> },
          { path: 'banking', element: <Banking /> },
          { path: 'banking/:accountId', element: <Banking /> },
          { path: 'vat', element: <Vat /> },
          { path: 'vat/:start', element: <Vat /> },
          { path: 'employees', element: <EmployeeList /> },
          { path: 'employees/new', element: <EmployeeForm key="new" /> },
          { path: 'employees/:id', element: <EmployeeDetail /> },
          { path: 'employees/:id/edit', element: <EmployeeForm /> },
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
