import { describe, expect, it } from 'vitest';
import type { PayLine, PayRules } from '@/db/types';
import {
  addPeriods,
  balanced,
  calculatePayLine,
  computeSettlement,
  contributions,
  employedDays,
  eosProvisionFor,
  formatPeriod,
  leaveValue,
  noticeMonthsFor,
  payDateFor,
  payLineWarnings,
  payRunPostings,
  payRunTotals,
  periodEnd,
  provisionPostings,
  ratesOn,
  settlementPostings,
  type SettlementInput,
} from './payroll';

const VALID_IBAN = 'KW81CBKU0000000000001234560101';

const RULES: PayRules = {
  dailyDivisor: 26,
  rateBase: 'basic',
  pifss: { from: '2026-01-01', employer: 11.5, employee: 10.5, cap: 2750 },
  gcc: [],
  minimumWage: 75,
};

function line(overrides: Partial<PayLine> = {}): PayLine {
  return {
    id: 'l1',
    employeeId: 'e1',
    number: 'EMP-001',
    name: 'Ravi Kumar',
    nameAr: '',
    jobTitle: '',
    jobTitleAr: '',
    category: 'expat',
    nationality: 'IN',
    civilId: '',
    iban: VALID_IBAN,
    hireDate: '2020-01-01',
    leavingDate: null,
    permitSalary: 0,
    monthlyBasic: 520,
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
  };
}

const calc = (overrides: Partial<PayLine> = {}, rules: PayRules = RULES) =>
  calculatePayLine(line(overrides), rules, 3);

describe('months', () => {
  it('know their days, ends and pay days', () => {
    expect(periodEnd('2026-02')).toBe('2026-02-28');
    expect(periodEnd('2028-02')).toBe('2028-02-29');
    expect(addPeriods('2026-12', 1)).toBe('2027-01');
    expect(addPeriods('2026-01', -1)).toBe('2025-12');
    expect(payDateFor('2026-02', 31)).toBe('2026-02-28');
    expect(payDateFor('2026-09', 25)).toBe('2026-09-25');
    expect(formatPeriod('2026-09', 'en-KW')).toBe('September 2026');
    expect(formatPeriod('2026-09', 'ar-KW-u-nu-latn')).toContain('2026');
  });

  it('count the calendar days a joiner or leaver was employed', () => {
    expect(employedDays('2026-09', '2026-09-16', null)).toBe(15);
    expect(employedDays('2026-09', '2020-01-01', '2026-09-10')).toBe(10);
    expect(employedDays('2026-09', '2026-10-01', null)).toBe(0);
    expect(employedDays('2026-09', null, null)).toBe(30);
  });
});

describe('PIFSS contributions', () => {
  it('stop at the insured salary cap', () => {
    // KD 3,000 is insured up to KD 2,750: 10.5% and 11.5% of 2,750.
    expect(contributions(3000, 1, RULES.pifss!, 3)).toEqual({
      base: 2750,
      employee: 288.75,
      employer: 316.25,
    });
    const kuwaiti = calc({ category: 'kuwaiti', nationality: 'KW', monthlyBasic: 3000 });
    expect(kuwaiti.pifssEmployee).toBe(288.75);
    expect(kuwaiti.pifssEmployer).toBe(316.25);
    expect(kuwaiti.net).toBe(2711.25);
  });

  it('are worked out on basic salary and allowances, pro rata for a part month', () => {
    const result = calc({
      category: 'kuwaiti',
      nationality: 'KW',
      monthlyBasic: 1200,
      allowances: [{ id: 'a', name: 'Social', nameAr: '', monthly: 300, amount: 0 }],
      daysWorked: 10,
    });
    // KD 1,500 for 10 of 30 days: 500 insured.
    expect(result.pifssBase).toBe(500);
    expect(result.pifssEmployee).toBe(52.5);
    expect(result.pifssEmployer).toBe(57.5);
  });

  it('use the rates in force in the month', () => {
    const list = [
      { from: '2026-01-01', employer: 11.5, employee: 10.5, cap: 2750 },
      { from: '2027-01-01', employer: 12, employee: 11, cap: 3000 },
    ];
    expect(ratesOn(list, '2026-12-01')?.employer).toBe(11.5);
    expect(ratesOn(list, '2027-03-01')?.employer).toBe(12);
    expect(ratesOn(list, '2025-01-01')?.employer).toBe(11.5);
    expect(ratesOn([], '2026-01-01')).toBeNull();
  });

  it('do not apply to expatriates; GCC nationals use their home scheme once entered', () => {
    expect(calc({ monthlyBasic: 3000 }).pifssEmployee).toBe(0);
    const saudi = { category: 'gcc' as const, nationality: 'SA', monthlyBasic: 1000 };
    const missing = calc(saudi);
    expect(missing.pifssEmployee).toBe(0);
    expect(payLineWarnings(missing, RULES, 3)).toContainEqual({ code: 'gcc_rates', country: 'SA' });
    const rules = { ...RULES, gcc: [{ country: 'SA', employer: 12, employee: 10, cap: null }] };
    const covered = calc(saudi, rules);
    expect(covered.pifssEmployee).toBe(100);
    expect(covered.pifssEmployer).toBe(120);
    expect(payLineWarnings(covered, rules, 3).map((w) => w.code)).not.toContain('gcc_rates');
  });
});

describe('pay lines', () => {
  it('pay a joiner pro rata by calendar days', () => {
    const joiner = calc({
      hireDate: '2026-09-16',
      monthlyBasic: 900,
      allowances: [{ id: 'h', name: 'Housing', nameAr: 'بدل سكن', monthly: 150, amount: 0 }],
      daysWorked: employedDays('2026-09', '2026-09-16', null),
    });
    expect(joiner.basic).toBe(450);
    expect(joiner.allowances[0].amount).toBe(75);
    expect(joiner.gross).toBe(525);
    expect(joiner.net).toBe(525);
  });

  it('pay overtime at 125%, rest days at 150% and holidays at 200% of the hourly rate', () => {
    // KD 520 ÷ 26 = KD 20 a day, KD 2.500 an hour.
    const result = calc({ overtime: { normal: 4, restDay: 2, holiday: 3 } });
    expect(result.overtimePay).toBe(35); // 12.500 + 7.500 + 15.000
    expect(calc({ overtime: { normal: 1, restDay: 0, holiday: 0 } }).overtimePay).toBe(3.125);
    // On the whole wage when the rates use it.
    const wage = calc(
      {
        allowances: [{ id: 'a', name: 'Transport', nameAr: '', monthly: 104, amount: 0 }],
        overtime: { normal: 8, restDay: 0, holiday: 0 },
      },
      { ...RULES, rateBase: 'wage' },
    );
    expect(wage.overtimePay).toBe(30); // 624 ÷ 26 ÷ 8 × 8 × 1.25
  });

  it('deduct leave as a share of the month’s pay and absence at the daily rate', () => {
    const result = calc({
      leaveBasis: 'calendar',
      absentDays: 1,
      unpaidLeaveDays: 3,
      reducedPay: [
        { percent: 75, days: 2 },
        { percent: 50, days: 1 },
      ],
    });
    // Absence: a day at KD 20 (520 ÷ 26). Leave: 3 + 2 × 0.25 + 0.5 = 4 of the
    // month's 30 days, 520 − 520 × 26 ÷ 30 = 69.333.
    expect(result.absenceDeduction).toBe(89.333);
    expect(result.gross).toBe(430.667);
    // A whole month of unpaid leave leaves exactly nothing, allowances included.
    const away = calc(
      {
        leaveBasis: 'calendar',
        monthlyBasic: 333.333,
        allowances: [{ id: 'a', name: 'Food', nameAr: '', monthly: 41.111, amount: 0 }],
        daysWorked: 31,
        daysInMonth: 31,
        unpaidLeaveDays: 31,
      },
      { ...RULES, rateBase: 'wage' },
    );
    expect(away).toMatchObject({ gross: 0, net: 0, absenceDeduction: 374.444 });
  });

  it('keep the daily rate for leave on lines of runs prepared before', () => {
    const result = calc({
      absentDays: 1,
      unpaidLeaveDays: 1,
      reducedPay: [
        { percent: 75, days: 2 },
        { percent: 50, days: 1 },
      ],
    });
    // (1 + 1 + 2 × 0.25 + 0.5) days × KD 20.
    expect(result.absenceDeduction).toBe(60);
    expect(result.gross).toBe(460);
  });

  it('never take more for absence than the month’s pay', () => {
    const result = calc({ absentDays: 30, daysWorked: 10 });
    expect(result.absenceDeduction).toBe(173.333);
    expect(result.gross).toBe(0);
  });

  it('apply additions, loans and other deductions', () => {
    const result = calc({
      adjustments: [
        { id: 'a', type: 'addition', amount: 30, note: 'Bonus' },
        { id: 'b', type: 'deduction', amount: 10.5, note: 'Phone' },
      ],
      loans: [{ loanId: 'loan', amount: 50 }],
    });
    expect(result.additions).toBe(30);
    expect(result.gross).toBe(550);
    expect(result.otherDeductions).toBe(10.5);
    expect(result.loanDeduction).toBe(50);
    expect(result.net).toBe(489.5);
  });
});

describe('a PIFSS share the month’s pay doesn’t cover', () => {
  const kuwaiti: Partial<PayLine> = {
    category: 'kuwaiti',
    nationality: 'KW',
    name: 'Test Clerk',
    nameAr: 'موظف تجريبي',
    monthlyBasic: 900,
    calendarLeave: { unpaidDays: 30, reducedPay: [] },
  };

  it('is owed by the employee: net pay is 0, not below', () => {
    const result = calc(kuwaiti);
    expect(result).toMatchObject({ gross: 0, pifssEmployee: 94.5, pifssOwed: 94.5, net: 0 });
    expect(payLineWarnings(result, RULES, 3)).toContainEqual({
      code: 'pifss_owed',
      amount: 94.5,
      name: 'Test Clerk',
      nameAr: 'موظف تجريبي',
    });
    // Part of the month paid: the pay covers what it can.
    const part = calc({ ...kuwaiti, calendarLeave: { unpaidDays: 29, reducedPay: [] } });
    expect(part).toMatchObject({ gross: 30, pifssOwed: 64.5, net: 0 });
    // Paid enough: nothing owed, and the field goes.
    const paid = calc({ ...kuwaiti, calendarLeave: undefined, pifssOwed: 12 });
    expect(paid.net).toBe(805.5);
    expect('pifssOwed' in paid).toBe(false);
  });

  it('doesn’t let loans or other deductions take pay below zero', () => {
    const result = calc({
      ...kuwaiti,
      loans: [{ loanId: 'loan', amount: 20 }],
      adjustments: [{ id: 'd', type: 'deduction', amount: 5, note: '' }],
    });
    expect(result).toMatchObject({ pifssOwed: 94.5, net: -25 });
    expect(payLineWarnings(result, RULES, 3).map((w) => w.code)).toContain('negative_net');
  });

  it('is posted to staff advances, and the entry balances', () => {
    const lines = [calc(kuwaiti), calc({ id: 'l2', monthlyBasic: 400 })];
    const totals = payRunTotals(lines, 3);
    expect(totals).toMatchObject({ pifssEmployee: 94.5, pifssOwed: 94.5, deductions: 0, net: 400 });
    const postings = payRunPostings(totals, 3);
    expect(balanced(postings)).toBe(true);
    expect(postings).toContainEqual({
      key: 'advances',
      amount: 94_500,
      description: 'PIFSS shares owed by employees',
    });
    expect(postings).toContainEqual({
      key: 'pifssPayable',
      amount: -198_000,
      description: 'PIFSS contributions',
    });
  });
});

describe('pay line checks', () => {
  const codes = (l: PayLine) => payLineWarnings(l, RULES, 3).map((w) => w.code);

  it('flag loan recoveries over 10% and deductions over 25% of the wage (art. 59)', () => {
    const result = calc({
      monthlyBasic: 500,
      loans: [{ loanId: 'loan', amount: 60 }],
      adjustments: [{ id: 'd', type: 'deduction', amount: 70, note: '' }],
    });
    expect(payLineWarnings(result, RULES, 3)).toEqual(
      expect.arrayContaining([
        { code: 'loan_cap', limit: 50 },
        { code: 'deduction_cap', limit: 125 },
      ]),
    );
    const within = calc({ monthlyBasic: 500, loans: [{ loanId: 'loan', amount: 50 }] });
    expect(codes(within)).toEqual([]);
  });

  it('flag pay below the minimum wage, below the work permit salary, a bad IBAN and a negative net', () => {
    expect(codes(calc({ monthlyBasic: 70 }))).toContain('minimum_wage');
    expect(codes(calc({ monthlyBasic: 80, daysWorked: 15 }))).not.toContain('minimum_wage');
    expect(codes(calc({ permitSalary: 600 }))).toContain('permit_salary');
    expect(codes(calc({ iban: '' }))).toContain('iban');
    expect(codes(calc({ iban: 'KW00CBKU0000000000001234560101' }))).toContain('iban');
    expect(
      codes(calc({ adjustments: [{ id: 'd', type: 'deduction', amount: 600, note: '' }] })),
    ).toContain('negative_net');
  });
});

describe('pay run entry', () => {
  it('balances to the fils and splits pay across the accounts', () => {
    const lines = [
      calc({
        category: 'kuwaiti',
        nationality: 'KW',
        monthlyBasic: 1234.567,
        allowances: [{ id: 'a', name: 'Car', nameAr: '', monthly: 100.001, amount: 0 }],
        overtime: { normal: 3, restDay: 1, holiday: 0 },
        loans: [{ loanId: 'loan', amount: 25 }],
      }),
      calc({
        id: 'l2',
        monthlyBasic: 333.333,
        allowances: [{ id: 'b', name: 'Housing', nameAr: '', monthly: 77.777, amount: 0 }],
        absentDays: 2,
        adjustments: [{ id: 'd', type: 'deduction', amount: 5.005, note: '' }],
        daysWorked: 17,
      }),
    ];
    const totals = payRunTotals(lines, 3);
    const postings = payRunPostings(totals, 3);
    expect(balanced(postings)).toBe(true);
    const by = (key: string) => postings.find((p) => p.key === key)?.amount ?? 0;
    expect(by('salariesPayable')).toBe(-Math.round(totals.net * 1000));
    expect(by('pifssPayable')).toBe(
      -Math.round((totals.pifssEmployee + totals.pifssEmployer) * 1000),
    );
    expect(by('advances')).toBe(-25_000);
    expect(by('otherDeductions')).toBe(-5005);
    expect(by('salaries') + by('allowances')).toBe(Math.round(totals.gross * 1000));
    expect(totals.cost).toBe(Math.round((totals.gross + totals.pifssEmployer) * 1000) / 1000);
  });

  it('takes pay lost to absence from basic salary first', () => {
    const lines = [
      calc(
        {
          monthlyBasic: 100,
          allowances: [{ id: 'a', name: 'x', nameAr: '', monthly: 420, amount: 0 }],
          absentDays: 10,
        },
        { ...RULES, rateBase: 'wage' },
      ),
    ];
    const totals = payRunTotals(lines, 3);
    // KD 520 ÷ 26 × 10 days = KD 200 lost: KD 100 of basic, KD 100 of allowances.
    expect(totals.salaries).toBe(0);
    expect(totals.allowances).toBe(320);
    expect(balanced(payRunPostings(totals, 3))).toBe(true);
  });
});

describe('provisions', () => {
  const employee = {
    category: 'expat' as const,
    hireDate: '2021-10-01',
    basicSalary: 600,
    allowances: [],
    payBasis: 'monthly' as const,
  };

  it('hold the indemnity if the contract ended at the month end', () => {
    // Five years to the end of 30 September: 5 × 15 days × 600 ÷ 26 = 1,730.769.
    expect(eosProvisionFor(employee, '2026-09-30', 26, 3)).toBe(1730.769);
    expect(eosProvisionFor({ ...employee, category: 'domestic' }, '2026-09-30', 26, 3)).toBe(0);
    expect(eosProvisionFor(employee, '2021-01-31', 26, 3)).toBe(0);
  });

  it('post the change in the provisions', () => {
    const list = provisionPostings(120_500, -3_250);
    expect(list).toEqual([
      { key: 'eosExpense', amount: 120_500, description: 'End-of-service indemnity' },
      { key: 'eosProvision', amount: -120_500, description: 'End-of-service indemnity provision' },
      { key: 'leaveExpense', amount: -3_250, description: 'Leave salary' },
      { key: 'leaveProvision', amount: 3_250, description: 'Leave salary provision' },
    ]);
    expect(balanced(list)).toBe(true);
    expect(leaveValue(10, 520, 26, 3)).toBe(200);
  });
});

describe('final settlement', () => {
  const base: SettlementInput = {
    employee: {
      payBasis: 'monthly',
      basicSalary: 600,
      allowances: [{ id: 'h', name: 'Housing', amount: 150, countsForEos: false }],
      hireDate: '2020-01-01',
      category: 'expat',
      nationality: 'IN',
    },
    leavingDate: '2026-09-15',
    reason: 'termination',
    rules: RULES,
    eosDivisor: 26,
    pifssOffset: 0,
    indemnityOverride: null,
    noticeMonths: 3,
    leaveDays: 13,
    lastSalaryDays: 15,
    loans: [{ loanId: 'loan', amount: 200 }],
    otherDeductions: 0,
    eosProvision: 2500,
    leaveProvision: 300,
    precision: 3,
  };

  it('pays the indemnity, notice, leave and the last salary less loans', () => {
    const result = computeSettlement(base);
    expect(result.years).toBeCloseTo(6.7, 1);
    expect(result.eosi?.payable).toBe(result.indemnity);
    expect(result.noticePay).toBe(2250); // 3 × (600 + 150)
    expect(result.leavePay).toBe(375); // 750 ÷ 26 × 13
    expect(result.lastSalary).toMatchObject({ days: 15, basic: 300, allowances: 75, gross: 375 });
    expect(result.loanRecovery).toBe(200);
    expect(result.net).toBe(Math.round((result.indemnity + 2250 + 375 + 375 - 200) * 1000) / 1000);
    expect(noticeMonthsFor('termination', 'monthly')).toBe(3);
    expect(noticeMonthsFor('termination', 'daily')).toBe(1);
    expect(noticeMonthsFor('resignation', 'monthly')).toBe(0);
  });

  it('pays nothing before three years on resignation and halves it from three', () => {
    const early = computeSettlement({ ...base, reason: 'resignation', leavingDate: '2022-06-30' });
    expect(early.indemnity).toBe(0);
    const later = computeSettlement({ ...base, reason: 'resignation', leavingDate: '2023-06-30' });
    expect(later.eosi?.share).toEqual({ numerator: 1, denominator: 2 });
  });

  it('posts a balanced entry that clears the provisions and expenses the difference', () => {
    const result = computeSettlement(base);
    const list = settlementPostings(result, { eos: 2500, leave: 300 }, 3);
    expect(balanced(list)).toBe(true);
    const sum = (key: string) =>
      list.filter((p) => p.key === key).reduce((s, p) => s + p.amount, 0);
    expect(sum('eosProvision')).toBe(2_500_000);
    expect(sum('eosExpense')).toBe(Math.round(result.indemnity * 1000) - 2_500_000);
    expect(sum('leaveProvision')).toBe(300_000);
    expect(sum('leaveExpense')).toBe(75_000);
    expect(sum('salaries')).toBe(2_250_000 + 300_000);
    expect(sum('allowances')).toBe(75_000);
    expect(sum('advances')).toBe(-200_000);
    expect(sum('salariesPayable')).toBe(-Math.round(result.net * 1000));
  });

  it('includes PIFSS on a Kuwaiti’s last salary and uses one month a year for domestic workers', () => {
    const kuwaiti = computeSettlement({
      ...base,
      employee: { ...base.employee, category: 'kuwaiti', nationality: 'KW' },
      loans: [],
    });
    // 750 for 15 of 30 days = 375 insured.
    expect(kuwaiti.lastSalary?.pifssEmployee).toBe(39.375);
    expect(kuwaiti.lastSalary?.pifssEmployer).toBe(43.125);
    expect(balanced(settlementPostings(kuwaiti, { eos: 0, leave: 0 }, 3))).toBe(true);

    const domestic = computeSettlement({
      ...base,
      employee: { ...base.employee, category: 'domestic', hireDate: '2024-09-16' },
    });
    expect(domestic.eosi).toBeNull();
    expect(domestic.indemnity).toBe(1200); // two years × KD 600
    expect(computeSettlement({ ...base, indemnityOverride: 999.9995 }).indemnity).toBe(1000);
  });
});
