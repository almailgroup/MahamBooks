import { runDepreciation } from '../assets';
import type { ISODate } from '../types';
import { DemoBooks } from './books';
import type { Timeline } from './calendar';
import { both } from './data';

/**
 * Money that moves every month: rent and utilities from NBK, small costs
 * from petty cash, subscriptions on the company card, KNET settlements into
 * the bank, petty cash top-ups and cash deposits, and depreciation.
 */
export function moneyStory(books: DemoBooks, tl: Timeline): void {
  const cal = books.calendar;
  for (let m = -12; m <= 0; m++) {
    const on = (day: number) => cal.workdayOf(m, day);
    const month = cal.monthStart(m);
    const n = m + 12;
    const summer = [6, 7, 8, 9].includes(Number(month.slice(5, 7)));

    tl.at(month, 'rent', async () => {
      await books.expense({
        date: month,
        code: '6060',
        description: both('Shuwaikh office and store rent', 'إيجار مكتب ومستودع الشويخ'),
        amount: 950,
        from: 'nbk',
        vendor: 'tilal',
        reference: 'NBK STO 4471',
      });
      await books.expense({
        date: month,
        code: '6060',
        description: both('Al-Rai showroom rent', 'إيجار معرض الري'),
        amount: 650,
        from: 'nbk',
        vendor: 'tilal',
        reference: 'NBK STO 4472',
      });
    });
    tl.at(on(3), 'software', async () => {
      await books.expense({
        date: on(3),
        code: '6190',
        description: both(
          'Email and cloud storage, 6 users',
          'البريد الإلكتروني والتخزين السحابي، 6 مستخدمين',
        ),
        amount: 31.5,
        from: 'card',
      });
    });
    tl.at(on(5), 'fuel', async () => {
      await books.expense({
        date: on(5),
        code: '6200',
        description: both('Pickup truck fuel', 'وقود سيارة البيك أب'),
        amount: [28.5, 27.75, 30.25, 26.9][n % 4],
        from: 'cash',
      });
    });
    tl.at(on(7), 'phones and internet', async () => {
      await books.expense({
        date: on(7),
        code: '6080',
        description: both('Office internet and mobile lines', 'إنترنت المكتب وخطوط الهاتف'),
        amount: 42.5,
        from: 'nbk',
        reference: 'KNET',
      });
    });
    if (n % 2 === 0) {
      tl.at(on(9), 'hospitality', async () => {
        await books.expense({
          date: on(9),
          code: '6220',
          description: both('Tea, coffee and water for the office', 'شاي وقهوة ومياه للمكتب'),
          amount: [36.75, 41.5, 33.25][n % 3],
          from: 'cash',
        });
      });
    }
    if (n % 2 === 0) {
      tl.at(on(12), 'electricity and water', async () => {
        await books.expense({
          date: on(12),
          code: '6070',
          description: both('Electricity and water bill', 'فاتورة الكهرباء والماء'),
          amount: summer ? 186.4 : 78.25,
          from: 'nbk',
          reference: 'KNET',
        });
      });
    }
    if (n % 2 === 1) {
      tl.at(on(16), 'stationery', async () => {
        await books.expense({
          date: on(16),
          code: '6140',
          description: both('Stationery and printer paper', 'قرطاسية وورق طباعة'),
          amount: [23.4, 17.85, 26.1][n % 3],
          from: 'cash',
          vendor: 'stationery',
        });
      });
    }
    tl.at(on(20), 'online ads', async () => {
      await books.expense({
        date: on(20),
        code: '6110',
        description: both('Instagram and Google ads', 'إعلانات إنستغرام وجوجل'),
        amount: 75,
        from: 'card',
      });
    });
    if (n % 3 === 1) {
      tl.at(on(22), 'vehicle service', async () => {
        await books.expense({
          date: on(22),
          code: '6200',
          description: both('Pickup truck service and tyres', 'صيانة وإطارات سيارة البيك أب'),
          amount: [64, 118.5, 72.25, 86][n % 4],
          from: 'nbk',
          vendor: 'garage',
          reference: 'KNET',
        });
      });
    }
    tl.at(on(25), 'card repayment', async () => {
      if (books.card <= 0) return;
      await books.transfer(
        'nbk',
        'card',
        on(25),
        DemoBooks.amount(books.card),
        both('NBK card repayment', 'سداد بطاقة الوطني الائتمانية'),
      );
    });
    const end = cal.monthEnd(m);
    if (n % 3 === 2) {
      tl.at(end, 'bank charges', async () => {
        await books.expense({
          date: end,
          code: '6170',
          description: both('NBK account charges for the quarter', 'رسوم حساب الوطني للربع'),
          amount: 7.5,
          from: 'nbk',
        });
      });
    }

    // What KNET and the payment providers collected is settled into NBK each month.
    for (const day of [1]) {
      const date = on(day);
      tl.at(date, 'KNET settlement', () => books.settleClearing(date));
    }
    // Petty cash: topped up from NBK when low, extra cash from sales banked.
    const counted = on(16);
    tl.at(counted, 'petty cash', () => pettyCash(books, counted));
    // Depreciation for the month, on its last day.
    if (m < 0) {
      tl.at(end, 'depreciation', async () => {
        await runDepreciation(books.id, cal.period(m));
      });
    }
  }
}

async function pettyCash(books: DemoBooks, date: ISODate) {
  const amount = DemoBooks.amount(books.cash);
  if (amount < 80) {
    await books.transfer(
      'nbk',
      'cash',
      date,
      250,
      both('Petty cash top-up', 'تعزيز العهدة النقدية'),
    );
  } else if (amount > 450) {
    const deposit = Math.floor((amount - 150) / 50) * 50;
    await books.transfer('cash', 'nbk', date, deposit, both('Cash deposit', 'إيداع نقدي'));
  }
}
