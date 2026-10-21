import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { setupCompany } from './records';
import { createEmployee, savePeopleSettings, getPeopleSettings, saveEmployee } from './people';
import { createComplianceDocument, loadRegister, saveComplianceDocument } from './renewals';
import {
  createVehicle,
  deleteVehicle,
  linkVehiclePapers,
  plateKey,
  saveVehicle,
  setVehicleArchived,
  unlinkedVehicles,
} from './vehicles';
import type { ID } from './types';

/**
 * Vehicles (#17): a company's vehicles with their papers in the register,
 * their driver and the fixed asset they are; kept in the cloud only once its
 * server has the records of version 16.
 */

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const company = () => setupCompany({ name: 'Made-up Transport' });

/** The company as linked to the cloud, with what its server has. */
async function inTheCloud(companyId: ID, features?: string[]) {
  await db.syncState.put({
    companyId,
    userId: 'user-owner',
    role: 'owner',
    status: 'ready',
    cursor: 0,
    name: 'Made-up Transport',
    linkedAt: '2026-10-01T00:00:00Z',
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
    ...(features ? { features } : {}),
  });
}

const vehiclePaper = (
  companyId: ID,
  ownerName: string,
  type: 'vehicle_registration' | 'vehicle_insurance' = 'vehicle_registration',
) =>
  saveComplianceDocument(
    createComplianceDocument(companyId, { ownerType: 'vehicle', ownerName, type }),
  );

describe('a vehicle', () => {
  it('is saved with its plate, tidied, and logged', async () => {
    const c = await company();
    const vehicle = await saveVehicle(
      createVehicle(c.id, {
        plate: '  18/62417 ',
        make: 'Toyota',
        model: ' Hilux  double cab ',
        year: 2022,
        chassisNumber: 'mr0test0001',
      }),
    );
    expect(vehicle).toMatchObject({
      plate: '18/62417',
      model: 'Hilux double cab',
      year: 2022,
      chassisNumber: 'MR0TEST0001',
      archived: false,
    });
    const logged = await db.activities.where('entityId').equals(vehicle.id).toArray();
    expect(logged.map((a) => a.message)).toEqual(['Vehicle 18/62417 added']);
  });

  it('needs a plate no other vehicle has, a sensible year, and the company’s driver and asset', async () => {
    const c = await company();
    const other = await setupCompany({ name: 'Another Company' });
    await saveVehicle(createVehicle(c.id, { plate: '18/62417' }));
    await expect(saveVehicle(createVehicle(c.id, { plate: '' }))).rejects.toThrow(
      'Enter the vehicle’s plate number.',
    );
    // The same plate written another way.
    await expect(saveVehicle(createVehicle(c.id, { plate: '18 - 62417' }))).rejects.toThrow(
      'Vehicle 18 - 62417 is already on the list.',
    );
    await expect(saveVehicle(createVehicle(c.id, { plate: 'TEST-2', year: 1890 }))).rejects.toThrow(
      'Enter the year it was made, for example 2022.',
    );
    const stranger = await saveEmployee(createEmployee(other.id, { name: 'Someone Else' }));
    await expect(
      saveVehicle(createVehicle(c.id, { plate: 'TEST-2', driverEmployeeId: stranger.id })),
    ).rejects.toThrow('Choose the driver from the company’s employees.');
    await expect(
      saveVehicle(createVehicle(c.id, { plate: 'TEST-2', assetId: 'no-such-asset' })),
    ).rejects.toThrow('Choose one of the company’s fixed assets.');
    // Another company may have the same plate.
    await expect(
      saveVehicle(createVehicle(other.id, { plate: '18/62417' })),
    ).resolves.toBeDefined();
    expect(await db.vehicles.where('companyId').equals(c.id).count()).toBe(1);
  });

  it('gives its papers the new plate, which older versions show', async () => {
    const c = await company();
    const vehicle = await saveVehicle(createVehicle(c.id, { plate: 'TEST-1' }));
    const paper = await saveComplianceDocument(
      createComplianceDocument(c.id, {
        ownerType: 'vehicle',
        vehicleId: vehicle.id,
        type: 'vehicle_insurance',
      }),
    );
    expect(paper.ownerName).toBe('TEST-1');
    await saveVehicle({ ...vehicle, plate: 'TEST-9' });
    expect((await db.complianceDocuments.get(paper.id))!.ownerName).toBe('TEST-9');
  });

  it('with papers is archived, not deleted', async () => {
    const c = await company();
    const vehicle = await saveVehicle(createVehicle(c.id, { plate: 'TEST-1' }));
    await saveComplianceDocument(
      createComplianceDocument(c.id, { ownerType: 'vehicle', vehicleId: vehicle.id }),
    );
    await expect(deleteVehicle(vehicle.id)).rejects.toThrow(
      'This vehicle has papers in the register. Archive it instead.',
    );
    await setVehicleArchived(vehicle.id, true);
    expect((await db.vehicles.get(vehicle.id))!.archived).toBe(true);

    const spare = await saveVehicle(createVehicle(c.id, { plate: 'TEST-2' }));
    await deleteVehicle(spare.id);
    expect(await db.vehicles.get(spare.id)).toBeUndefined();
  });

  it('makes its driver need a driving licence', async () => {
    const c = await company();
    const guard = await saveEmployee(
      createEmployee(c.id, { name: 'Guard Testing', jobTitle: 'Security Guard' }),
    );
    await savePeopleSettings({ ...(await getPeopleSettings(c.id)), drivingLicences: true });
    expect((await loadRegister(c.id)).missing).toEqual([]);
    await saveVehicle(createVehicle(c.id, { plate: 'TEST-1', driverEmployeeId: guard.id }));
    expect((await loadRegister(c.id)).missing.map((m) => m.employeeId)).toEqual([guard.id]);
  });
});

describe('vehicles in the cloud', () => {
  it('wait for the server to have the records of version 16', async () => {
    const c = await company();
    await inTheCloud(c.id);
    const message =
      'The cloud needs the latest database script first. Ask the owner of the company to run it.';
    await expect(saveVehicle(createVehicle(c.id, { plate: 'TEST-1' }))).rejects.toThrow(message);
    await vehiclePaper(c.id, 'TEST-1');
    await expect(linkVehiclePapers(c.id)).rejects.toThrow(message);
    expect(await db.vehicles.count()).toBe(0);

    await inTheCloud(c.id, ['tables_v16']);
    const vehicle = await saveVehicle(createVehicle(c.id, { plate: 'TEST-1' }));
    expect(await db.outbox.where('table').equals('vehicles').count()).toBe(1);
    await setVehicleArchived(vehicle.id, true);
  });

  it('are always saved in a company kept on this device', async () => {
    const c = await company();
    await expect(saveVehicle(createVehicle(c.id, { plate: 'TEST-1' }))).resolves.toBeDefined();
  });
});

describe('linking vehicle papers', () => {
  it('groups papers by their plate, with the vehicle of that plate', async () => {
    const c = await company();
    const known = await saveVehicle(createVehicle(c.id, { plate: 'TEST-1' }));
    const docs = [
      await vehiclePaper(c.id, 'test 1'),
      await vehiclePaper(c.id, 'TEST-1', 'vehicle_insurance'),
      await vehiclePaper(c.id, '18/62417'),
      await vehiclePaper(c.id, '١٨/٦٢٤١٧', 'vehicle_insurance'),
      await saveComplianceDocument(createComplianceDocument(c.id, { type: 'commercial_licence' })),
    ];
    const groups = unlinkedVehicles(docs, [known]);
    expect(groups.map((g) => [g.name, g.documents.length, g.vehicle?.id ?? null])).toEqual([
      ['18/62417', 2, null],
      ['test 1', 2, known.id],
    ]);
    expect(plateKey('١٨ / ٦٢٤١٧')).toBe(plateKey('18/62417'));
  });

  it('links each paper and adds the vehicles that are missing, once', async () => {
    const c = await company();
    const known = await saveVehicle(createVehicle(c.id, { plate: 'TEST-1' }));
    const a = await vehiclePaper(c.id, 'TEST-1');
    const b = await vehiclePaper(c.id, '18/62417');
    const d = await vehiclePaper(c.id, '18 62417', 'vehicle_insurance');
    // The vehicle takes the plate as the paper added first writes it.
    await db.complianceDocuments.update(d.id, { createdAt: '2099-01-01T00:00:00.000Z' });
    expect(await linkVehiclePapers(c.id)).toEqual({ vehicles: 1, papers: 3 });
    const added = (await db.vehicles.where('companyId').equals(c.id).toArray()).find(
      (v) => v.id !== known.id,
    )!;
    expect(added.plate).toBe('18/62417');
    expect((await db.complianceDocuments.get(a.id))!.vehicleId).toBe(known.id);
    expect((await db.complianceDocuments.get(b.id))!.vehicleId).toBe(added.id);
    expect((await db.complianceDocuments.get(d.id))!.vehicleId).toBe(added.id);
    // The plate the paper had stays on it.
    expect((await db.complianceDocuments.get(d.id))!.ownerName).toBe('18 62417');
    expect(await linkVehiclePapers(c.id)).toEqual({ vehicles: 0, papers: 0 });
  });
});
