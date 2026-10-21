import { db } from './db';
import { logActivity } from './activity';
import { nowStamp } from './defaults';
import type { ComplianceDocument, ID, Vehicle } from './types';
import { linkHasFeature } from '@/cloud/features';
import { normalizeSearch } from '@/features/search/normalize';
import { newId } from '@/lib/ids';
import { msg, t } from '@/i18n';

/**
 * The company's vehicles, which their papers in the register belong to
 * (ComplianceDocument.vehicleId; the paper keeps the plate in `ownerName`
 * for older versions). A vehicle may name its usual driver and the fixed
 * asset it is in the books as. In a company kept in the cloud they are
 * saved once its server has the records of version 16.
 */

export class VehicleError extends Error {}

export function createVehicle(companyId: ID, overrides: Partial<Vehicle> = {}): Vehicle {
  const stamp = nowStamp();
  return {
    id: newId(),
    companyId,
    plate: '',
    make: '',
    model: '',
    year: null,
    chassisNumber: '',
    assetId: null,
    driverEmployeeId: null,
    notes: '',
    archived: false,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

/** A plate as it is compared: Latin digits, one case, no spaces or separators. */
export function plateKey(plate: string): string {
  return normalizeSearch(plate).replace(/[\s.@+-]/g, '');
}

const tidy = (text: string | undefined) => (text ?? '').trim().replace(/\s+/g, ' ');

/** Refused in a company kept in the cloud until its server has the records of version 16. */
async function assertCloudHasVehicles(companyId: ID): Promise<void> {
  const link = await db.syncState.get(companyId);
  if (link && !linkHasFeature(link, 'tables_v16')) {
    throw new VehicleError(
      t(
        'The cloud needs the latest database script first. Ask the owner of the company to run it.',
      ),
    );
  }
}

const TABLES = () => [
  db.vehicles,
  db.companies,
  db.employees,
  db.assets,
  db.complianceDocuments,
  db.activities,
  db.syncState,
];

/**
 * Saves a vehicle: a plate no other vehicle of the company has, and a driver
 * and fixed asset of the company. Its papers get the new plate when it
 * changes.
 */
export async function saveVehicle(input: Vehicle): Promise<Vehicle> {
  return db.transaction('rw', TABLES(), async () => {
    const company = await db.companies.get(input.companyId);
    if (!company) throw new VehicleError(t('Company not found'));
    await assertCloudHasVehicles(company.id);
    const plate = tidy(input.plate);
    if (!plate) throw new VehicleError(t('Enter the vehicle’s plate number.'));
    const others = await db.vehicles.where('companyId').equals(company.id).toArray();
    const twin = others.find((v) => v.id !== input.id && plateKey(v.plate) === plateKey(plate));
    if (twin) throw new VehicleError(t('Vehicle {plate} is already on the list.', { plate }));
    const year = input.year ? Math.trunc(input.year) : null;
    if (year !== null && (year < 1950 || year > new Date().getFullYear() + 1)) {
      throw new VehicleError(t('Enter the year it was made, for example 2022.'));
    }
    if (input.driverEmployeeId) {
      const driver = await db.employees.get(input.driverEmployeeId);
      if (!driver || driver.companyId !== company.id) {
        throw new VehicleError(t('Choose the driver from the company’s employees.'));
      }
    }
    if (input.assetId) {
      const asset = await db.assets.get(input.assetId);
      if (!asset || asset.companyId !== company.id) {
        throw new VehicleError(t('Choose one of the company’s fixed assets.'));
      }
    }
    const existing = await db.vehicles.get(input.id);
    const vehicle: Vehicle = {
      ...input,
      plate,
      make: tidy(input.make),
      model: tidy(input.model),
      year,
      chassisNumber: tidy(input.chassisNumber).toUpperCase(),
      assetId: input.assetId || null,
      driverEmployeeId: input.driverEmployeeId || null,
      notes: input.notes.trim(),
      updatedAt: nowStamp(),
    };
    if (!existing) vehicle.createdAt = vehicle.updatedAt;
    await db.vehicles.put(vehicle);
    if (existing && existing.plate !== plate) {
      // Older versions show the plate kept on each paper.
      const papers = await db.complianceDocuments.where('vehicleId').equals(vehicle.id).toArray();
      await db.complianceDocuments.bulkPut(
        papers.map((doc) => ({ ...doc, ownerName: plate, updatedAt: vehicle.updatedAt })),
      );
    }
    await logActivity(company.id, 'compliance', vehicle.id, existing ? 'updated' : 'created', {
      text: existing ? msg('Vehicle {plate} updated') : msg('Vehicle {plate} added'),
      vars: { plate },
    });
    return vehicle;
  });
}

/** Stops (or resumes) listing a vehicle (sold, written off); its papers stay. */
export async function setVehicleArchived(id: ID, archived: boolean): Promise<void> {
  await db.transaction('rw', TABLES(), async () => {
    const vehicle = await db.vehicles.get(id);
    if (!vehicle) return;
    await assertCloudHasVehicles(vehicle.companyId);
    await db.vehicles.put({ ...vehicle, archived, updatedAt: nowStamp() });
    await logActivity(vehicle.companyId, 'compliance', id, archived ? 'archived' : 'restored', {
      text: archived ? msg('Vehicle {plate} archived') : msg('Vehicle {plate} restored'),
      vars: { plate: vehicle.plate },
    });
  });
}

/** Deletes a vehicle added by mistake. One with papers in the register is archived instead. */
export async function deleteVehicle(id: ID): Promise<void> {
  await db.transaction('rw', TABLES(), async () => {
    const vehicle = await db.vehicles.get(id);
    if (!vehicle) return;
    await assertCloudHasVehicles(vehicle.companyId);
    if ((await db.complianceDocuments.where('vehicleId').equals(id).count()) > 0) {
      throw new VehicleError(t('This vehicle has papers in the register. Archive it instead.'));
    }
    await db.vehicles.delete(id);
    await logActivity(vehicle.companyId, 'compliance', id, 'deleted', {
      text: msg('Vehicle {plate} deleted'),
      vars: { plate: vehicle.plate },
    });
  });
}

/** Vehicle papers of the register with the same plate or name, not linked to a vehicle yet. */
export interface UnlinkedVehicle {
  /** The plate or name as the papers have it. */
  name: string;
  documents: ComplianceDocument[];
  /** The vehicle with that plate, when there is one; null adds one. */
  vehicle: Vehicle | null;
}

/**
 * The register's vehicle papers that name a vehicle only by its plate or
 * name, grouped by it (spaces, separators and the case of letters aside),
 * as the paper added first writes it: with the vehicle of that plate, or
 * none yet.
 */
export function unlinkedVehicles(
  documents: readonly ComplianceDocument[],
  vehicles: readonly Vehicle[],
): UnlinkedVehicle[] {
  const byPlate = new Map(vehicles.map((v) => [plateKey(v.plate), v]));
  const groups = new Map<string, UnlinkedVehicle>();
  const oldestFirst = [...documents].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const doc of oldestFirst) {
    if (doc.ownerType !== 'vehicle' || doc.vehicleId || !doc.ownerName.trim()) continue;
    const key = plateKey(doc.ownerName);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = { name: tidy(doc.ownerName), documents: [], vehicle: byPlate.get(key) ?? null };
      groups.set(key, group);
    }
    group.documents.push(doc);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Links each vehicle paper of the register to its vehicle by the plate or
 * name it has, adding a vehicle for each plate that isn't on the list yet.
 */
export async function linkVehiclePapers(
  companyId: ID,
): Promise<{ vehicles: number; papers: number }> {
  return db.transaction('rw', TABLES(), async () => {
    await assertCloudHasVehicles(companyId);
    const [documents, vehicles] = await Promise.all([
      db.complianceDocuments.where('companyId').equals(companyId).toArray(),
      db.vehicles.where('companyId').equals(companyId).toArray(),
    ]);
    let added = 0;
    let papers = 0;
    const stamp = nowStamp();
    for (const group of unlinkedVehicles(documents, vehicles)) {
      let vehicle = group.vehicle;
      if (!vehicle) {
        vehicle = createVehicle(companyId, {
          plate: group.name,
          createdAt: stamp,
          updatedAt: stamp,
        });
        await db.vehicles.add(vehicle);
        await logActivity(companyId, 'compliance', vehicle.id, 'created', {
          text: msg('Vehicle {plate} added'),
          vars: { plate: vehicle.plate },
        });
        added += 1;
      }
      const vehicleId = vehicle.id;
      await db.complianceDocuments.bulkPut(
        group.documents.map((doc) => ({ ...doc, vehicleId, updatedAt: stamp })),
      );
      papers += group.documents.length;
    }
    return { vehicles: added, papers };
  });
}
