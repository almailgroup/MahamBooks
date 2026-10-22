import { describe, expect, it } from 'vitest';
import type { PayLine, PayRules } from '@/db/types';
import { calculatePayLine, payrollBreakdown, payRunTotals, type PayGroupTotals } from './payroll';

/**
 * Totals of a pay run by department and position (#10): they add up to the
 * run's totals, and for the approval email no group is one person. Made-up
 * people and amounts.
 */

const RULES: PayRules = {
  dailyDivisor: 26,
  rateBase: 'basic',
  pifss: { from: '2026-01-01', employer: 11.5, employee: 10.5, cap: 2750 },
  gcc: [],
  minimumWage: 75,
};

let seq = 0;

function line(overrides: Partial<PayLine> = {}): PayLine {
  seq += 1;
  return calculatePayLine(
    {
      id: `l${seq}`,
      employeeId: `e${seq}`,
      number: `EMP-${seq}`,
      name: `Made-up Person ${seq}`,
      nameAr: '',
      jobTitle: '',
      jobTitleAr: '',
      category: 'expat',
      nationality: 'IN',
      civilId: '',
      iban: '',
      hireDate: '2020-01-01',
      leavingDate: null,
      permitSalary: 0,
      monthlyBasic: 400,
      allowances: [],
      daysWorked: 30,
      daysInMonth: 30,
      overtime: { normal: 0, restDay: 0, holiday: 0 },
      absentDays: 0,
      unpaidLeaveDays: 0,
      reducedPay: [],
      adjustments: [],
      loans: [],
      basic: 0,
      allowanceTotal: 0,
      overtimePay: 0,
      absenceDeduction: 0,
      additions: 0,
      gross: 0,
      pifssBase: 0,
      pifssEmployee: 0,
      pifssEmployer: 0,
      loanDeduction: 0,
      otherDeductions: 0,
      net: 0,
      ...overrides,
    },
    RULES,
    3,
  );
}

const guard = (overrides: Partial<PayLine> = {}) =>
  line({ department: 'Operations', jobTitle: 'Guard', jobTitleAr: 'حارس', ...overrides });

/** The sum of groups, in fils. */
function sum(groups: PayGroupTotals[]) {
  const fils = (n: number) => Math.round(n * 1000);
  return groups.reduce(
    (s, g) => ({
      employees: s.employees + g.employees,
      gross: s.gross + fils(g.gross),
      deductions: s.deductions + fils(g.deductions),
      net: s.net + fils(g.net),
      pifssEmployer: s.pifssEmployer + fils(g.pifssEmployer),
    }),
    { employees: 0, gross: 0, deductions: 0, net: 0, pifssEmployer: 0 },
  );
}

function sample(): PayLine[] {
  return [
    guard({
      monthlyBasic: 333.333,
      adjustments: [{ id: 'a', type: 'deduction', amount: 5.005, note: '' }],
    }),
    guard({ monthlyBasic: 287.5, overtime: { normal: 3, restDay: 1, holiday: 0 } }),
    guard({ department: ' operations ', monthlyBasic: 301.111, absentDays: 2 }),
    line({ department: 'Operations', jobTitle: 'Supervisor', monthlyBasic: 650 }),
    line({
      department: 'Head Office',
      jobTitle: 'Accountant',
      category: 'kuwaiti',
      nationality: 'KW',
      monthlyBasic: 1234.567,
      loans: [{ loanId: 'loan', amount: 25 }],
    }),
    line({
      department: 'Head Office',
      jobTitle: 'Accountant',
      category: 'kuwaiti',
      nationality: 'KW',
      monthlyBasic: 2900,
    }),
    line({ department: 'Head Office', jobTitle: 'Driver', monthlyBasic: 260 }),
    line({ department: '', jobTitle: 'Cleaner', monthlyBasic: 120 }),
  ];
}

describe('totals by department and position', () => {
  it('add up to the pay run’s totals, to the fils', () => {
    const lines = sample();
    const totals = payRunTotals(lines, 3);
    const breakdown = payrollBreakdown(lines, 3);
    expect(breakdown.totals).toEqual({
      employees: totals.employees,
      gross: totals.gross,
      deductions: totals.deductions,
      net: totals.net,
      pifssEmployer: totals.pifssEmployer,
      cost: totals.cost,
    });
    const fils = (n: number) => Math.round(n * 1000);
    const whole = {
      employees: totals.employees,
      gross: fils(totals.gross),
      deductions: fils(totals.deductions),
      net: fils(totals.net),
      pifssEmployer: fils(totals.pifssEmployer),
    };
    expect(sum(breakdown.departments)).toEqual(whole);
    for (const department of breakdown.departments) {
      const { employees, gross, deductions, net, pifssEmployer } = department;
      expect(sum(department.positions)).toEqual({
        employees,
        gross: fils(gross),
        deductions: fils(deductions),
        net: fils(net),
        pifssEmployer: fils(pifssEmployer),
      });
    }
    // Net is gross less deductions, group by group.
    for (const g of breakdown.departments) {
      expect(fils(g.gross) - fils(g.deductions)).toBe(fils(g.net));
    }
  });

  it('group departments without case or extra spaces, named ones first', () => {
    const breakdown = payrollBreakdown(sample(), 3);
    expect(breakdown.departments.map((d) => [d.department, d.employees])).toEqual([
      ['Head Office', 3],
      ['Operations', 4],
      ['', 1],
    ]);
    const operations = breakdown.departments[1];
    expect(operations.positions.map((p) => [p.jobTitle, p.jobTitleAr, p.employees])).toEqual([
      ['Guard', 'حارس', 3],
      ['Supervisor', '', 1],
    ]);
  });

  it('merge groups of one person for the email, so no total is one person’s pay', () => {
    const breakdown = payrollBreakdown(sample(), 3, { minGroup: 2 });
    // The cleaner (no department) is alone: with the smallest department to keep company.
    expect(breakdown.departments.map((d) => [d.department, d.employees])).toEqual([
      ['Operations', 4],
      [null, 4],
    ]);
    const [operations, other] = breakdown.departments;
    // The supervisor is alone: the guards join "Other positions".
    expect(operations.positions.map((p) => [p.jobTitle, p.employees])).toEqual([[null, 4]]);
    expect(other.positions.map((p) => [p.jobTitle, p.employees])).toEqual([
      ['Accountant', 2],
      [null, 2],
    ]);
    const all = [...breakdown.departments, ...breakdown.departments.flatMap((d) => d.positions)];
    expect(all.every((g) => g.employees >= 2)).toBe(true);
    // Still adds up.
    expect(sum(breakdown.departments).net).toBe(Math.round(breakdown.totals.net * 1000));
  });

  it('keep named groups of two or more as they are', () => {
    const lines = [
      guard(),
      guard(),
      line({ department: 'Head Office', jobTitle: 'Clerk' }),
      line({ department: 'Head Office', jobTitle: 'Clerk' }),
    ];
    const breakdown = payrollBreakdown(lines, 3, { minGroup: 2 });
    expect(breakdown.departments.map((d) => [d.department, d.employees])).toEqual([
      ['Head Office', 2],
      ['Operations', 2],
    ]);
  });

  it('leave a run of one person as one group', () => {
    const breakdown = payrollBreakdown([guard()], 3, { minGroup: 2 });
    expect(breakdown.totals.employees).toBe(1);
    expect(breakdown.departments.map((d) => [d.department, d.employees])).toEqual([[null, 1]]);
  });

  it('have nothing to add up without lines', () => {
    expect(payrollBreakdown([], 3)).toEqual({
      totals: { employees: 0, gross: 0, deductions: 0, net: 0, pifssEmployer: 0, cost: 0 },
      departments: [],
    });
  });
});
