import type { Client, Company, DocumentPurpose, Employee, Vehicle } from '@/db/types';
import { documentTypeInfo, OWNER_LABELS, ownerLabel, type RegisterEntry } from '@/lib/compliance';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';

/** "Today", "In 5 days" or "3 days ago". */
export function daysText(daysLeft: number): string {
  if (daysLeft === 0) return t('Today');
  if (daysLeft > 0) return tp(daysLeft, 'In {count} day', 'In {count} days');
  return tp(-daysLeft, '{count} day ago', '{count} days ago');
}

/** A register entry's name: its own title or the document type. */
export function entryTitle(entry: Pick<RegisterEntry, 'title' | 'type'>): string {
  return entry.title.trim() || t(documentTypeInfo(entry.type).label);
}

/** The customers and vehicles register entries may belong to, by id. */
export interface OwnerNames {
  clients?: Map<string, Pick<Client, 'name' | 'nameAr'>>;
  vehicles?: Map<string, Pick<Vehicle, 'plate'>>;
}

/**
 * Who a document belongs to, in the interface language: a customer by their
 * name now when it is given, a vehicle as its paper names it (saving a
 * vehicle renames its papers), else its plate.
 */
export function entryOwner(
  entry: Pick<RegisterEntry, 'ownerType' | 'ownerName' | 'employeeId' | 'clientId' | 'vehicleId'>,
  employees: Map<string, Employee>,
  company: Company,
  names: OwnerNames = {},
): string {
  if (entry.ownerType === 'employee') {
    return localName(employees.get(entry.employeeId ?? '')) || t(OWNER_LABELS.employee);
  }
  if (entry.ownerType === 'company') return localName(company);
  const client = entry.clientId ? names.clients?.get(entry.clientId) : undefined;
  if (client) return localName(client);
  if (entry.ownerName) return entry.ownerName;
  const vehicle = entry.vehicleId ? names.vehicles?.get(entry.vehicleId) : undefined;
  return vehicle?.plate || t(ownerLabel(entry.ownerType));
}

/** "18/62417 · Toyota Hilux 2022": the plate, then what it is. */
export function vehicleLabel(vehicle: Pick<Vehicle, 'plate' | 'make' | 'model' | 'year'>): string {
  const model = [vehicle.make, vehicle.model, vehicle.year ? String(vehicle.year) : '']
    .filter(Boolean)
    .join(' ');
  return [vehicle.plate, model].filter(Boolean).join(' · ');
}

/** A purpose's name in the interface language; empty for none or one this device doesn't know. */
export function purposeName(
  purposes: readonly DocumentPurpose[] | undefined,
  id: string | null | undefined,
): string {
  if (!id) return '';
  return localName(purposes?.find((p) => p.id === id));
}

/** "Expires today" or "Expires in 12 days". */
export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft === 0) return t('Expires today');
  return tp(daysLeft, 'Expires in {count} day', 'Expires in {count} days');
}
