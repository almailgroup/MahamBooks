import { db } from '../db';
import {
  addDocumentPurpose,
  createComplianceDocument,
  saveComplianceDocument,
  setRegisterExtras,
} from '../renewals';
import { createVehicle, saveVehicle } from '../vehicles';
import type { DemoBooks } from './books';
import { both, VEHICLE } from './data';

/**
 * The register's extras: switched on, with the purposes of the company's
 * documents, the pickup in the asset register as a vehicle (driven by the
 * driver, its papers linked to it), the Ministry's maintenance contract and
 * the hotel's cost sheet, which only owners, admins and accountants see.
 */
export async function registerStory(books: DemoBooks): Promise<void> {
  const cal = books.calendar;
  await setRegisterExtras(books.id, true);
  const maintenance = await addDocumentPurpose(books.id, {
    name: 'Maintenance contracts',
    nameAr: 'عقود الصيانة',
  });
  const tenders = await addDocumentPurpose(books.id, { name: 'Tenders', nameAr: 'المناقصات' });

  const asset = await db.assets
    .where('companyId')
    .equals(books.id)
    .filter((a) => a.description === VEHICLE)
    .first();
  const vehicle = await saveVehicle(
    createVehicle(books.id, {
      plate: '18/62417',
      make: 'Toyota',
      model: 'Hilux double cab',
      year: Number(cal.ago(868).slice(0, 4)),
      chassisNumber: asset?.serialNumber ?? '',
      assetId: asset?.id ?? null,
      driverEmployeeId: books.employees.asif.id,
    }),
  );
  // Its papers name it as they always did; they now belong to it.
  const papers = await db.complianceDocuments
    .where('companyId')
    .equals(books.id)
    .filter((d) => d.ownerType === 'vehicle' && d.ownerName === VEHICLE)
    .toArray();
  await db.complianceDocuments.bulkPut(papers.map((d) => ({ ...d, vehicleId: vehicle.id })));

  const ministry = books.customers.ministry;
  const signed = cal.workday(cal.ago(200));
  await saveComplianceDocument(
    createComplianceDocument(books.id, {
      ownerType: 'other',
      clientId: ministry.id,
      type: 'client_contract',
      title: both(
        'Electrical maintenance contract, Hawalli schools',
        'عقد الصيانة الكهربائية لمدارس حولي',
      ),
      number: 'MOE-HWL-2026-0114',
      issueDate: signed,
      expiryDate: cal.ahead(165),
      purposeId: maintenance.id,
      notes: both('Invoiced quarterly, 5% retention.', 'يُفوتر كل ربع سنة، مع محتجزات 5%.'),
    }),
  );
  await saveComplianceDocument(
    createComplianceDocument(books.id, {
      ownerType: 'other',
      clientId: books.customers.hotel.id,
      type: 'customer_cost',
      title: both('Technicians on site, cost sheet', 'كشف تكاليف الفنيين في الموقع'),
      issueDate: cal.workday(cal.ago(40)),
      expiryDate: cal.ahead(325),
      purposeId: tenders.id,
      confidential: true,
    }),
  );
}
