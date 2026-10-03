import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { setupCompany } from '@/db/records';
import { createJournal, loadLedger, newJournalLine, saveJournal } from '@/db/accounting';
import { createAsset, runDepreciation, saveAsset } from '@/db/assets';
import { buildAuditorPack, PACK_FILES } from './pack';
import { buildStatement, modelToCsv } from './model';
import { loadArabicDictionary, reportText } from './report-language';
import { createZip, readZip } from './zip';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function books() {
  const company = await setupCompany({ name: 'Gulf Trading', nameAr: 'الخليج للتجارة' });
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
  const code = (c: string) => accounts.find((a) => a.code === c)!;
  await saveJournal(
    createJournal(company.id, {
      date: '2025-01-01',
      status: 'posted',
      lines: [
        newJournalLine({ accountId: code('1000').id, debit: 5000 }),
        newJournalLine({ accountId: code('3000').id, credit: 5000 }),
      ],
    }),
  );
  await saveAsset(
    createAsset(company.id, {
      name: 'Laptops',
      nameAr: 'أجهزة حاسب محمول',
      assetAccountId: code('1520').id,
      accumulatedAccountId: code('1530').id,
      expenseAccountId: code('6900').id,
      purchaseDate: '2025-01-01',
      depreciationStart: '2025-01-01',
      cost: 1200,
      usefulLifeMonths: 12,
      source: 'purchase',
      paidFromAccountId: code('1000').id,
    }),
  );
  await runDepreciation(company.id, '2025-06');
  const [assets, runs, documents, payments, clients] = await Promise.all([
    db.assets.toArray(),
    db.depreciationRuns.toArray(),
    db.documents.toArray(),
    db.payments.toArray(),
    db.clients.toArray(),
  ]);
  return {
    company,
    ledger: await loadLedger(company),
    assets,
    runs,
    documents,
    payments,
    clients,
  };
}

const YEAR = { from: '2025-01-01', to: '2025-12-31' };

describe('auditor pack', () => {
  it('holds every file, named in English, in the chosen language', async () => {
    const data = await books();
    const arabic = await loadArabicDictionary();
    const files = buildAuditorPack(data, YEAR, 'ar', arabic);
    expect(files.map((f) => f.name)).toEqual(PACK_FILES.map((f) => f.name));
    const file = (name: string) => files.find((f) => f.name === name)!.text;
    expect(file('trial-balance.csv').startsWith('﻿')).toBe(true);
    const position = file('statement-of-financial-position.csv');
    expect(position).toContain('الممتلكات والمعدات');
    expect(position).toContain('المعدات المكتبية والحاسب الآلي');
    // Cost 1,200 less six months of depreciation.
    expect(position).toContain(',600');
    expect(file('fixed-asset-register.csv')).toContain('أجهزة حاسب محمول');
    expect(file('chart-of-accounts.csv')).toContain('مجمع إهلاك المعدات');

    const zip = readZip(createZip(files.map((f) => ({ name: f.name, data: f.text }))));
    expect(zip).toHaveLength(PACK_FILES.length);
  });

  it('puts both languages side by side', async () => {
    const data = await books();
    const arabic = await loadArabicDictionary();
    const model = buildStatement('profit-and-loss', data, {
      range: YEAR,
      asOf: YEAR.to,
      compare: true,
      detail: true,
    });
    const { headers, rows } = modelToCsv(
      model,
      3,
      reportText('en', arabic, data.company),
      reportText('ar', arabic, data.company),
    );
    expect(headers.slice(0, 3)).toEqual(['Code', 'Description', 'الوصف']);
    expect(headers.slice(3)).toEqual(['2025', '2024']);
    const depreciation = rows.find((r) => r[1] === 'Depreciation')!;
    expect(depreciation.slice(2)).toEqual(['الإهلاك', -600, 0]);
    const profit = rows.at(-1)!;
    expect(profit.slice(1, 3)).toEqual(['Loss for the year', 'خسارة السنة']);
  });
});
