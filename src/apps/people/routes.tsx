import { lazy, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { Bare } from '@/app/route-shell';
import { AppGate } from '@/suite/app-gate';
import { AnyCompanyPeopleGate } from '@/features/cloud/role-gates';
import { CompanyOfLink } from '@/app/company-link';

/**
 * Maham People's pages: employees, payroll, leave and loans. Only roles that
 * may see salaries open them; the lock card is shown to the others.
 */

const Overview = lazy(() => import('./pages/overview/index'));
const Directory = lazy(() => import('./pages/overview/directory'));
const AllCompanies = lazy(() => import('./pages/overview/all-companies'));
const EmployeeList = lazy(() => import('./pages/people/list'));
const EmployeeDetail = lazy(() => import('./pages/people/detail'));
const EmployeeForm = lazy(() => import('./pages/people/form'));
const Payroll = lazy(() => import('./pages/payroll/index'));
const PayRun = lazy(() => import('./pages/payroll/run'));
const PayrollLeave = lazy(() => import('./pages/payroll/leave'));
const LeaveReasons = lazy(() => import('./pages/payroll/leave-reasons'));
const PayrollLoans = lazy(() => import('./pages/payroll/loans'));
const PayrollSettings = lazy(() => import('./pages/payroll/settings'));
const Payslips = lazy(() => import('./pages/payroll/payslips'));
const PayrollSummary = lazy(() => import('./pages/payroll/summary'));
const Settlement = lazy(() => import('./pages/payroll/settlement'));
const SettlementPrint = lazy(() => import('./pages/payroll/settlement-print'));
const Letters = lazy(() => import('./pages/letters/index'));
const LetterTemplates = lazy(() => import('./pages/letters/templates'));
const LetterTemplate = lazy(() => import('./pages/letters/template-editor'));
const LetterPrint = lazy(() => import('./pages/letters/print'));
const CostingList = lazy(() => import('./pages/costing/list'));
const CostingEditor = lazy(() => import('./pages/costing/editor'));

function People({ children }: { children: ReactNode }) {
  return <AppGate app="people">{children}</AppGate>;
}

const page = (path: string, element: ReactNode): RouteObject => ({
  path,
  element: <People>{element}</People>,
});

/**
 * Payslips, the register by department, the settlement and employee
 * letters (#19), printed without the navigation.
 */
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
    path: 'payroll/runs/:id/summary',
    element: (
      <Bare>
        <People>
          <PayrollSummary />
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
  {
    path: 'people/letters/:id/print',
    element: (
      <Bare>
        <People>
          <LetterPrint />
        </People>
      </Bare>
    ),
  },
  {
    path: 'people/letters/print',
    element: (
      <Bare>
        <People>
          <LetterPrint />
        </People>
      </Bare>
    ),
  },
];

/** Pages inside the shell. */
export const peopleRoutes: RouteObject[] = [
  page('people', <Overview />),
  page('people/directory', <Directory />),
  // Employees of several companies: each company's own role decides, not the open one's.
  {
    path: 'people/all',
    element: (
      <AnyCompanyPeopleGate>
        <AllCompanies />
      </AnyCompanyPeopleGate>
    ),
  },
  page('employees', <EmployeeList />),
  page('employees/new', <EmployeeForm key="new" />),
  page('employees/:id', <EmployeeDetail />),
  page('employees/:id/edit', <EmployeeForm />),
  page('employees/:id/settlement', <Settlement />),
  page('payroll', <Payroll />),
  // Opened from an approval email in its own company, before People's gate looks.
  {
    path: 'payroll/runs/:id',
    element: (
      <CompanyOfLink>
        <People>
          <PayRun />
        </People>
      </CompanyOfLink>
    ),
  },
  page('payroll/leave', <PayrollLeave />),
  page('payroll/leave-reasons', <LeaveReasons />),
  page('payroll/loans', <PayrollLoans />),
  page('payroll/settings', <PayrollSettings />),
  // Employee letters (#19).
  page('people/letters', <Letters />),
  page('people/letters/templates', <LetterTemplates />),
  page('people/letters/templates/:id', <LetterTemplate />),
  // Manpower costing (#3): private, like payroll.
  page('people/costing', <CostingList />),
  page('people/costing/:id', <CostingEditor />),
];
