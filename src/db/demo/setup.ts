import { db } from '../db';
import { createClient, createProduct } from '../defaults';
import { saveClient, saveCompany, setupCompany } from '../records';
import { createAccount, saveAccount } from '../accounting';
import { createWarehouse, saveItem, saveWarehouse } from '../inventory';
import {
  createEmployee,
  defaultPeopleSettings,
  newAllowance,
  saveEmployee,
  savePeopleSettings,
} from '../people';
import {
  createLeaveRecord,
  getPayrollSettings,
  saveLeaveRecord,
  savePayrollSettings,
} from '../payroll';
import { createAsset, saveAsset } from '../assets';
import { createComplianceDocument, saveComplianceDocument } from '../renewals';
import type { Client, Employee, ISODate } from '../types';
import { withBankAccount } from '@/features/company/bank';
import { accumulatedAt } from '@/lib/accounting/depreciation';
import { contributions, eosProvisionFor, leaveValue, PAYROLL_RULES } from '@/lib/hr/payroll';
import { insuredWithPifss } from '@/lib/hr/employees';
import { addDaysISO } from '@/lib/dates';
import { shortId } from '@/lib/ids';
import { dec, fromMinor, toMinor } from '@/lib/money';
import { DemoBooks } from './books';
import type { Calendar } from './calendar';
import {
  BANKS,
  both,
  COMPANY,
  COMPANY_ADDRESS,
  CUSTOMERS,
  EMPLOYEES,
  ITEMS,
  OPENING_STOCK,
  REGISTER,
  VENDORS,
  VEHICLE,
  WAREHOUSES,
  WORDING,
  type ContactSeed,
  type CustomerKey,
  type EmployeeKey,
  type ItemKey,
  type ItemSeed,
  type VendorKey,
} from './data';
import { DEMO_IMAGES } from './images';

const P = 3;

/** Employees on the books when they were opened; Sherif joins later in the year. */
const JOINS_LATER: EmployeeKey[] = ['sherif'];

/**
 * Creates the company as it stood the day it started using Maham Books: its
 * profile and bank accounts, contacts, items, warehouses with their opening
 * stock, staff with their leave balances, fixed assets, and one opening
 * entry for everything else (bank balances, provisions, capital, reserves).
 */
export async function setUpCompany(books: DemoBooks, opening: ISODate): Promise<void> {
  const company = await setupCompany({
    name: COMPANY.name,
    legalName: COMPANY.legalName,
    nameAr: COMPANY.nameAr,
    email: COMPANY.email,
    phone: COMPANY.phone,
    website: COMPANY.website,
    taxIdLabel: 'Tax card no.',
    taxId: COMPANY.mofTaxCardNumber,
    registrationLabel: 'CR No.',
    registrationNumber: COMPANY.crNumber,
    address: COMPANY_ADDRESS,
    currency: 'KWD',
    locale: 'en-KW',
    dateFormat: 'dd/MM/yyyy',
    language: 'ar-en',
    taxesEnabled: false,
    kuwait: {
      legalForm: 'wll',
      licenceNumber: COMPANY.licenceNumber,
      activity: 'general',
      foreignOwnershipPercent: 0,
      capital: COMPANY.capital,
      pamFileNumber: COMPANY.pamFileNumber,
      pifssEmployerNumber: COMPANY.pifssEmployerNumber,
      mofTaxCardNumber: COMPANY.mofTaxCardNumber,
      kcciNumber: COMPANY.kcciNumber,
      digitalCommerceNumber: '',
      wamdPhone: COMPANY.wamdPhone,
    },
    branding: {
      accentColor: COMPANY.accent,
      templateId: 'corporate',
      logo: DEMO_IMAGES.logo,
      stamp: DEMO_IMAGES.stamp,
      signature: DEMO_IMAGES.signature,
    },
    defaults: {
      paymentTermsDays: 30,
      quoteValidDays: 15,
      invoiceNotes: WORDING.invoiceNotes,
      invoiceTerms: WORDING.invoiceTerms,
      quoteNotes: WORDING.quoteNotes,
      quoteTerms: WORDING.quoteTerms,
      footer: WORDING.footer,
      showAmountInWords: true,
      showHijriDate: true,
    },
    // The company started using Maham Books on the day its books were opened.
    createdAt: `${opening}T06:00:00.000Z`,
    updatedAt: `${opening}T06:00:00.000Z`,
  });
  books.company = company;

  // The NBK account is printed on documents. (Documents add the WAMD number
  // themselves, in their own language, so it is left out of the bank text.)
  const fresh = await books.refresh();
  await saveCompany(
    withBankAccount(
      {
        ...fresh,
        payment: { ...fresh.payment, instructions: WORDING.paymentInstructions },
      },
      {
        bankCode: 'NBOK',
        bankName: '',
        accountName: COMPANY.legalName,
        iban: BANKS.nbk.iban,
        accountNumber: BANKS.nbk.accountNumber,
        swift: BANKS.nbk.bic,
        extra: '',
      },
      '',
    ),
  );
  await books.refresh();

  await setUpAccounts(books);
  await setUpContacts(books, opening);
  await setUpItems(books, opening);
  await setUpPeople(books, opening);
  await setUpRegister(books);
  const assets = await setUpAssets(books, opening);
  await openingEntry(books, opening, assets);
}

/** NBK and KFH current accounts with their IBANs. */
async function setUpAccounts(books: DemoBooks) {
  await books.loadAccounts();
  const nbk = books.account(BANKS.nbk.code);
  const bank = (b: typeof BANKS.nbk) => ({
    institution: b.institution,
    accountNumber: b.accountNumber,
    iban: b.iban,
    bic: b.bic,
  });
  await saveAccount({
    ...nbk,
    name: BANKS.nbk.name,
    nameAr: BANKS.nbk.nameAr,
    bank: bank(BANKS.nbk),
  });
  await saveAccount(
    createAccount(books.id, {
      code: BANKS.kfh.code,
      name: BANKS.kfh.name,
      nameAr: BANKS.kfh.nameAr,
      type: 'asset_cash',
      bank: bank(BANKS.kfh),
    }),
  );
  const card = books.account('2050');
  await saveAccount({
    ...card,
    name: 'NBK business credit card',
    nameAr: 'بطاقة ائتمان الأعمال – بنك الكويت الوطني',
  });
  await books.loadAccounts();
}

function contact(
  books: DemoBooks,
  seed: ContactSeed,
  role: 'customer' | 'vendor',
  opening: ISODate,
) {
  const { person, ...fields } = seed;
  return createClient(books.id, {
    ...fields,
    contacts: person ? [{ id: shortId(), ...person, primary: true }] : [],
    isCustomer: role === 'customer' || fields.isCustomer === true,
    isVendor: role === 'vendor' || fields.isVendor === true,
    createdAt: `${opening}T06:00:00.000Z`,
  } as Partial<Client>);
}

async function setUpContacts(books: DemoBooks, opening: ISODate) {
  for (const key of Object.keys(CUSTOMERS) as CustomerKey[]) {
    books.customers[key] = await saveClient(contact(books, CUSTOMERS[key], 'customer', opening));
  }
  for (const key of Object.keys(VENDORS) as VendorKey[]) {
    books.vendors[key] = await saveClient(contact(books, VENDORS[key], 'vendor', opening));
  }
}

async function setUpItems(books: DemoBooks, opening: ISODate) {
  const store = await saveWarehouse(
    createWarehouse(books.id, { ...WAREHOUSES.store, isDefault: true }),
  );
  const showroom = await saveWarehouse(createWarehouse(books.id, WAREHOUSES.showroom));
  books.warehouses = { store, showroom };

  for (const key of Object.keys(ITEMS) as ItemKey[]) {
    const { income, vendor, ...fields }: ItemSeed = ITEMS[key];
    const quantity = OPENING_STOCK[key] ?? 0;
    books.items[key] = await saveItem(
      createProduct(books.id, {
        ...fields,
        incomeAccountId: income ? books.account(income).id : null,
        preferredVendorId: vendor ? books.vendors[vendor].id : null,
      }),
      quantity > 0
        ? {
            opening: {
              warehouseId: store.id,
              quantity,
              unitCost: fields.costPrice ?? 0,
              date: opening,
            },
          }
        : {},
    );
    if (quantity > 0) books.addStock('store', key, quantity);
  }
}

/** Expiry dates of the staff's papers, relative to today. */
function papers(key: EmployeeKey, calendar: Calendar): Partial<Employee> {
  const years = (n: number) => addDaysISO(calendar.today, Math.round(n * 365));
  const days = (n: number) => calendar.ahead(n);
  switch (key) {
    case 'abdulaziz':
      return { civilIdExpiry: years(2.4), passportExpiry: years(4.1) };
    case 'maryam':
      return { civilIdExpiry: years(3.2), passportExpiry: years(5.6) };
    case 'rajesh':
      // Residency and work permit run out in 20 days: renewal is due.
      return {
        civilIdExpiry: days(20),
        passportExpiry: years(2.7),
        residencyExpiry: days(20),
        workPermitExpiry: days(20),
      };
    case 'mohammed':
      return {
        civilIdExpiry: days(214),
        passportExpiry: years(3.3),
        residencyExpiry: days(214),
        workPermitExpiry: days(214),
      };
    case 'ramon': {
      // Renewed during the year (see the people story); the passport is next.
      const due = calendar.day(-8, 25);
      return {
        civilIdExpiry: due,
        residencyExpiry: due,
        workPermitExpiry: due,
        passportExpiry: days(47),
      };
    }
    case 'sanjay':
      return {
        civilIdExpiry: days(131),
        passportExpiry: years(1.8),
        residencyExpiry: days(131),
        workPermitExpiry: days(131),
      };
    case 'asif':
      // The driver's residency expires in 9 days.
      return {
        civilIdExpiry: days(9),
        passportExpiry: years(2.2),
        residencyExpiry: days(9),
        workPermitExpiry: days(9),
      };
    case 'ahmed':
      return {
        civilIdExpiry: days(60),
        passportExpiry: years(1.5),
        residencyExpiry: days(60),
        workPermitExpiry: days(60),
      };
    default:
      return {};
  }
}

export function employeeRecord(
  books: DemoBooks,
  key: EmployeeKey,
  extra: Partial<Employee> = {},
): Employee {
  const {
    allowanceList,
    openingLeave: _leave,
    ...fields
  } = EMPLOYEES[key] as (typeof EMPLOYEES)[EmployeeKey] & {
    allowanceList?: Parameters<typeof newAllowance>[0][];
  };
  return createEmployee(books.id, {
    ...fields,
    allowances: (allowanceList ?? []).map((a) => newAllowance(a)),
    ...papers(key, books.calendar),
    ...extra,
  });
}

async function setUpPeople(books: DemoBooks, opening: ISODate) {
  await savePeopleSettings({ ...defaultPeopleSettings(books.id), kuwaitizationTarget: 30 });
  const settings = await getPayrollSettings(books.id);
  await savePayrollSettings({
    ...settings,
    pamFileNumber: COMPANY.pamFileNumber,
    bankAccountId: books.money('nbk'),
  });
  for (const key of Object.keys(EMPLOYEES) as EmployeeKey[]) {
    if (JOINS_LATER.includes(key)) continue;
    const employee = await saveEmployee(employeeRecord(books, key));
    books.employees[key] = employee;
    await saveLeaveRecord(
      createLeaveRecord(books.id, employee.id, {
        type: 'annual',
        kind: 'opening',
        start: opening,
        end: opening,
        days: EMPLOYEES[key].openingLeave,
        notes: both(
          'Balance brought forward from the previous system',
          'رصيد مُرحّل من النظام السابق',
        ),
      }),
    );
  }
}

async function setUpRegister(books: DemoBooks) {
  const cal = books.calendar;
  for (const doc of REGISTER) {
    const expiry = cal.ahead(doc.expiresIn);
    await saveComplianceDocument(
      createComplianceDocument(books.id, {
        type: doc.type,
        title: doc.title ?? '',
        number: doc.number ?? '',
        issuer: doc.issuer ?? '',
        issueDate: addDaysISO(expiry, -365),
        expiryDate: expiry,
        renewalCost: doc.renewalCost ?? 0,
        ownerType: doc.ownerType ?? 'company',
        ownerName: doc.ownerName ?? '',
        employeeId: doc.employee ? books.employees[doc.employee].id : null,
        notes: doc.notes ?? '',
      }),
    );
  }
}

interface OpeningAssets {
  /** Net book value the asset register put on Opening balance equity. */
  bookValue: number;
}

/** The vehicle and the furniture, bought before the books were opened. */
async function setUpAssets(books: DemoBooks, opening: ISODate): Promise<OpeningAssets> {
  const depreciation = books.account('6900').id;
  const items = [
    {
      name: 'Toyota Hilux double cab',
      nameAr: 'تويوتا هايلوكس غمارتين',
      description: VEHICLE,
      purchased: addDaysISO(opening, -868),
      cost: 7450,
      salvage: 1200,
      life: 60,
      asset: '1540',
      accumulated: '1550',
      location: both('Shuwaikh store', 'مستودع الشويخ'),
      custodian: EMPLOYEES.asif.name,
      serial: 'MR0HA3CD7P0718824',
    },
    {
      name: 'Office and showroom furniture',
      nameAr: 'أثاث المكتب والمعرض',
      description: both(
        'Desks, chairs, meeting table and showroom counters',
        'مكاتب وكراسٍ وطاولة اجتماعات وكاونترات المعرض',
      ),
      purchased: addDaysISO(opening, -1310),
      cost: 4280,
      salvage: 0,
      life: 84,
      asset: '1500',
      accumulated: '1510',
      location: both('Shuwaikh office and Al-Rai showroom', 'مكتب الشويخ ومعرض الري'),
      custodian: EMPLOYEES.abdulaziz.name,
      serial: '',
    },
  ];
  let bookValue = 0;
  for (const a of items) {
    const terms = {
      cost: a.cost,
      salvageValue: a.salvage,
      usefulLifeMonths: a.life,
      method: 'straight_line' as const,
      decliningRate: null,
      depreciationStart: a.purchased,
      openingDepreciation: 0,
      openingDepreciationDate: null,
    };
    const charged = fromMinor(accumulatedAt(terms, opening, P), P);
    await saveAsset(
      createAsset(books.id, {
        name: a.name,
        nameAr: a.nameAr,
        description: a.description,
        assetAccountId: books.account(a.asset).id,
        accumulatedAccountId: books.account(a.accumulated).id,
        expenseAccountId: depreciation,
        purchaseDate: a.purchased,
        depreciationStart: a.purchased,
        cost: a.cost,
        salvageValue: a.salvage,
        usefulLifeMonths: a.life,
        openingDepreciation: charged,
        openingDepreciationDate: opening,
        source: 'opening',
        location: a.location,
        custodian: a.custodian,
        serialNumber: a.serial,
      }),
    );
    bookValue += toMinor(a.cost, P) - toMinor(charged, P);
  }
  return { bookValue };
}

/** What the staff were owed on the opening date, so the first month's provisions are a month's worth. */
function provisionsAt(books: DemoBooks, opening: ISODate) {
  let eos = 0;
  let leave = 0;
  let pifss = 0;
  for (const key of Object.keys(books.employees) as EmployeeKey[]) {
    const e = books.employees[key];
    const wage = e.allowances.reduce((s, a) => s.plus(dec(a.amount)), dec(e.basicSalary));
    if (!insuredWithPifss(e.category)) eos += toMinor(eosProvisionFor(e, opening, 26, P), P);
    leave += toMinor(
      leaveValue(EMPLOYEES[key].openingLeave, wage.toNumber(), PAYROLL_RULES.dailyDivisor, P),
      P,
    );
    if (insuredWithPifss(e.category)) {
      // Last month's contributions, paid to PIFSS by the 15th.
      const share = contributions(wage, 1, PAYROLL_RULES.pifss, P);
      pifss += toMinor(share.employee, P) + toMinor(share.employer, P);
    }
  }
  return { eos, leave, pifss };
}

/** The opening entry; the bank balance is what makes it balance. */
async function openingEntry(books: DemoBooks, opening: ISODate, assets: OpeningAssets) {
  const movements = await db.stockMovements.where('companyId').equals(books.id).toArray();
  const stockValue = movements.reduce((s, m) => s + toMinor(m.value, P), 0);
  const { eos, leave, pifss } = provisionsAt(books, opening);
  const m = (amount: number) => toMinor(amount, P);
  const kfh = m(14_820.4);
  const cash = m(286.75);
  const deposits = m(1_600);
  const capital = m(COMPANY.capital);
  const reserve = m(11_250);
  const retained = m(23_964.615);
  const equityOffset = stockValue + assets.bookValue;
  const credits = eos + leave + pifss + capital + reserve + retained;
  const nbk = credits - kfh - cash - deposits - equityOffset;
  const a = (minor: number) => fromMinor(minor, P);
  books.cash += cash;
  books.openingPifss = a(pifss);
  await books.journal(
    opening,
    both('Opening balances', 'الأرصدة الافتتاحية'),
    [
      ['1000', a(nbk), 0, both('NBK balance on the opening date', 'رصيد الوطني في تاريخ الافتتاح')],
      ['1005', a(kfh), 0, both('KFH balance on the opening date', 'رصيد بيتك في تاريخ الافتتاح')],
      ['1010', a(cash), 0, both('Petty cash counted', 'العهدة النقدية بعد الجرد')],
      [
        '1310',
        a(deposits),
        0,
        both('Lease deposits with the landlord', 'تأمينات الإيجار لدى المالك'),
      ],
      [
        '3900',
        a(equityOffset),
        0,
        both(
          'Opening stock and fixed assets, in their registers',
          'المخزون والأصول الافتتاحية في سجلاتها',
        ),
      ],
      [
        '2310',
        0,
        a(pifss),
        both('PIFSS contributions, last month', 'اشتراكات التأمينات للشهر الأخير'),
      ],
      ['2700', 0, a(eos), both('End-of-service indemnity provision', 'مخصص مكافأة نهاية الخدمة')],
      ['2320', 0, a(leave), both('Leave salary provision', 'مخصص رواتب الإجازات')],
      ['3000', 0, a(capital), both('Paid-up capital', 'رأس المال المدفوع')],
      [
        '3200',
        0,
        a(reserve),
        both('Statutory reserve, earlier years', 'الاحتياطي القانوني للسنوات السابقة'),
      ],
      [
        '3300',
        0,
        a(retained),
        both('Retained earnings, earlier years', 'الأرباح المحتجزة للسنوات السابقة'),
      ],
    ],
    'Balances brought over from the previous accounting system.\n' +
      'أرصدة منقولة من النظام المحاسبي السابق.',
  );
}
