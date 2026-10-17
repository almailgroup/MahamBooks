import { lazy, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { Bare } from '@/app/route-shell';
import { AppGate } from '@/suite/app-gate';

/**
 * Maham People's pages: employees, payroll, leave and loans. Only roles that
 * may see salaries open them; the lock card is shown to the others.
 */

const Overview = lazy(() => import('./pages/overview/index'));
const Directory = lazy(() => import('./pages/overview/directory'));
const EmployeeList = lazy(() => import('./pages/people/list'));
const EmployeeDetail = lazy(() => import('./pages/people/detail'));
const EmployeeForm = lazy(() => import('./pages/people/form'));
const Payroll = lazy(() => import('./pages/payroll/index'));
const PayRun = lazy(() => import('./pages/payroll/run'));
const PayrollLeave = lazy(() => import('./pages/payroll/leave'));
const PayrollLoans = lazy(() => import('./pages/payroll/loans'));
const PayrollSettings = lazy(() => import('./pages/payroll/settings'));
const Payslips = lazy(() => import('./pages/payroll/payslips'));
const Settlement = lazy(() => import('./pages/payroll/settlement'));
const SettlementPrint = lazy(() => import('./pages/payroll/settlement-print'));

function People({ children }: { children: ReactNode }) {
  return <AppGate app="people">{children}</AppGate>;
}

const page = (path: string, element: ReactNode): RouteObject => ({
  path,
  element: <People>{element}</People>,
});

/** Payslips and the settlement, printed without the navigation. */
export const peoplePrintRoutes: RouteObject[] = [
  {
    path: 'payroll/runs/:id/payslips',
    element: (
      <Bare>
        <People>
          <Payslips />
        </People>
      </Bare>
    ),
  },
  {
    path: 'payroll/settlements/:id/print',
    element: (
      <Bare>
        <People>
          <SettlementPrint />
        </People>
      </Bare>
    ),
  },
];

/** Pages inside the shell. */
export const peopleRoutes: RouteObject[] = [
  page('people', <Overview />),
  page('people/directory', <Directory />),
  page('employees', <EmployeeList />),
  page('employees/new', <EmployeeForm key="new" />),
  page('employees/:id', <EmployeeDetail />),
  page('employees/:id/edit', <EmployeeForm />),
  page('employees/:id/settlement', <Settlement />),
  page('payroll', <Payroll />),
  page('payroll/runs/:id', <PayRun />),
  page('payroll/leave', <PayrollLeave />),
  page('payroll/loans', <PayrollLoans />),
  page('payroll/settings', <PayrollSettings />),
];
