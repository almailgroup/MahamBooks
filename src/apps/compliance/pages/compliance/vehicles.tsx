import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Car,
  CircleAlert,
  FilePlus2,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { toast } from 'sonner';
import { createComplianceDocument } from '@/db/renewals';
import { createVehicle, linkVehiclePapers, unlinkedVehicles } from '@/db/vehicles';
import type { ComplianceDocument, Vehicle } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { expiryStatus, recordEntry, type RegisterEntry } from '@/lib/compliance';
import { today } from '@/lib/dates';
import { useRoleView } from '@/features/cloud/role-gates';
import { useEmployees, usePeopleSettings } from '@/features/people/hooks';
import { useRegister, useRegisterExtras } from '@/features/renewals/hooks';
import { ComplianceHeader } from '@/features/renewals/compliance-header';
import { entryTitle, ExpiryBadge, vehicleLabel } from '@/features/renewals/display';
import { DocumentDialog } from '@/features/renewals/document-dialog';
import { RenewDialog } from '@/features/renewals/renew-dialog';
import { ComplianceSettingsDialog } from '@/features/renewals/settings-dialog';
import { VehicleDialog } from '@/features/renewals/vehicle-dialog';
import { Button } from '@/components/ui/button';
import { useReadOnly } from '@/components/ui/read-only';
import { Badge, Card, CardBody, EmptyState, Segmented, Spinner } from '@/components/ui/misc';
import { useConfirm } from '@/components/ui/overlay';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';

/**
 * Compliance → Vehicles: each company vehicle with its papers (registration,
 * insurance…), its driver for those who see employees, and the fixed asset
 * it is. Papers that only name a vehicle by its plate can be linked to it.
 */
export default function VehiclesPage() {
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const { readOnly } = useReadOnly();
  const { peopleHidden } = useRoleView();
  const { on: extras, cloudReady, checking } = useRegisterExtras();
  const register = useRegister();
  const employees = useEmployees();
  const settings = usePeopleSettings();
  const [list, setList] = useState<'current' | 'archived'>('current');
  const [editing, setEditing] = useState<{ vehicle: Vehicle; isNew: boolean } | null>(null);
  const [paper, setPaper] = useState<{ doc: ComplianceDocument; isNew: boolean } | null>(null);
  const [renewing, setRenewing] = useState<{ entry: RegisterEntry; owner: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [linking, setLinking] = useState(false);

  const byEmployee = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);
  const papers = useMemo(() => {
    const map = new Map<string, ComplianceDocument[]>();
    for (const doc of register?.documents ?? []) {
      if (!doc.vehicleId || doc.archived || (peopleHidden && doc.confidential)) continue;
      map.set(doc.vehicleId, [...(map.get(doc.vehicleId) ?? []), doc]);
    }
    for (const docs of map.values()) {
      docs.sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999'));
    }
    return map;
  }, [register, peopleHidden]);

  if (!register || !employees) return <Spinner className="py-24" label={t('Loading…')} />;

  const settingsDialog =
    settingsOpen && settings ? (
      <ComplianceSettingsDialog settings={settings} onClose={() => setSettingsOpen(false)} />
    ) : null;

  if (!extras) {
    return (
      <div className="space-y-6">
        <ComplianceHeader />
        <Card>
          <EmptyState
            icon={<Car />}
            title={t('Vehicles are switched off')}
            description={t(
              'Switch on contracts, customers and vehicles in the compliance settings to keep each vehicle with its papers and its driver.',
            )}
            action={
              readOnly ? null : (
                <Button variant="outline" onClick={() => setSettingsOpen(true)}>
                  <Settings2 /> {t('Compliance settings')}
                </Button>
              )
            }
          />
        </Card>
        {settingsDialog}
      </div>
    );
  }

  const on = today();
  const canChange = !readOnly && cloudReady;
  const archivedCount = register.vehicles.filter((v) => v.archived).length;
  const shown = list === 'archived' && archivedCount ? 'archived' : 'current';
  const vehicles = register.vehicles
    .filter((v) => v.archived === (shown === 'archived'))
    .sort((a, b) => a.plate.localeCompare(b.plate));
  const unlinked = unlinkedVehicles(register.documents, register.vehicles);
  const unlinkedPapers = unlinked.reduce((n, group) => n + group.documents.length, 0);

  const add = () => setEditing({ vehicle: createVehicle(company.id), isNew: true });
  const addPaper = (vehicle: Vehicle) =>
    setPaper({
      doc: createComplianceDocument(company.id, {
        ownerType: 'vehicle',
        vehicleId: vehicle.id,
        ownerName: vehicle.plate,
        type: 'vehicle_registration',
      }),
      isNew: true,
    });

  const link = async () => {
    const ok = await confirm({
      title: tp(
        unlinked.length,
        'Link the papers of {count} vehicle?',
        'Link the papers of {count} vehicles?',
      ),
      description: (
        <div className="space-y-2">
          <ul className="list-disc space-y-0.5 ps-5">
            {unlinked.map((group) => (
              <li key={group.name}>
                <bdi>{group.name}</bdi>
                {': '}
                {tp(group.documents.length, '{count} paper', '{count} papers')}
                {group.vehicle ? null : ` (${t('new vehicle')})`}
              </li>
            ))}
          </ul>
          <p>
            {t(
              'Papers that name the same plate go with one vehicle. A vehicle is added for each plate that isn’t on the list yet.',
            )}
          </p>
        </div>
      ),
      confirmLabel: t('Link vehicles'),
    });
    if (!ok) return;
    setLinking(true);
    try {
      const done = await linkVehiclePapers(company.id);
      toast.success(tp(done.papers, '{count} paper linked', '{count} papers linked'), {
        description: done.vehicles
          ? tp(done.vehicles, '{count} vehicle added', '{count} vehicles added')
          : undefined,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the vehicle.'));
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="space-y-6">
      <ComplianceHeader
        actions={
          canChange ? (
            <>
              {unlinked.length ? (
                <Button variant="outline" onClick={() => void link()} loading={linking}>
                  <Link2 /> {t('Link vehicles')}
                </Button>
              ) : null}
              <Button onClick={add}>
                <Plus /> {t('Add vehicle')}
              </Button>
            </>
          ) : null
        }
      />

      {cloudReady || checking ? null : (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardBody className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <p className="text-sm text-slate-700">
              {t(
                'The cloud keeps vehicles once the owner of the company runs the latest database script. Until then they can’t be added or changed.',
              )}
            </p>
          </CardBody>
        </Card>
      )}

      {register.vehicles.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Car />}
            title={t('No vehicles yet')}
            description={t(
              'Add the company’s vehicles to keep their registration, insurance and other papers together.',
            )}
            action={
              canChange ? (
                <Button onClick={add}>
                  <Plus /> {t('Add vehicle')}
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <Card>
          {archivedCount ? (
            <div className="border-b border-slate-100 p-4">
              <Segmented
                value={shown}
                onChange={setList}
                options={[
                  {
                    value: 'current',
                    label: t('Current vehicles'),
                    count: register.vehicles.length - archivedCount,
                  },
                  { value: 'archived', label: t('Archived'), count: archivedCount },
                ]}
              />
            </div>
          ) : null}
          {vehicles.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">
              {t('Every vehicle is archived.')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {vehicles.map((vehicle) => {
                const driver = vehicle.driverEmployeeId
                  ? byEmployee.get(vehicle.driverEmployeeId)
                  : undefined;
                const own = papers.get(vehicle.id) ?? [];
                const about = vehicleLabel({ ...vehicle, plate: '' });
                return (
                  <li key={vehicle.id} className="px-5 py-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900">
                          <bdi>{vehicle.plate}</bdi>
                          {vehicle.archived ? (
                            <Badge tone="gray" className="ms-2 align-middle">
                              {t('Archived')}
                            </Badge>
                          ) : null}
                        </p>
                        <p className="text-xs text-slate-500">
                          {[
                            about,
                            !peopleHidden && driver
                              ? t('Driver: {name}', { name: localName(driver) })
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        {readOnly ? null : (
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => addPaper(vehicle)}
                            aria-label={t('Add a paper for {plate}', { plate: vehicle.plate })}
                          >
                            <FilePlus2 /> {t('Add paper')}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setEditing({ vehicle, isNew: false })}
                          aria-label={t('Edit {plate}', { plate: vehicle.plate })}
                        >
                          <Pencil />
                        </Button>
                      </div>
                    </div>
                    {own.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">{t('No papers yet.')}</p>
                    ) : (
                      <ul className="mt-3 space-y-2 border-s-2 border-slate-100 ps-4">
                        {own.map((doc) => {
                          const entry = recordEntry(doc, register.reminderDays);
                          const info = expiryStatus(entry.expiryDate, entry.reminderDays, on);
                          const title = entryTitle(entry);
                          return (
                            <li
                              key={doc.id}
                              className="flex flex-col gap-2 sm:flex-row sm:items-center"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-slate-800">{title}</p>
                                <p className="text-xs text-slate-500">
                                  {[doc.number, entry.expiryDate ? fmt.date(entry.expiryDate) : '']
                                    .filter(Boolean)
                                    .join(' · ')}
                                </p>
                              </div>
                              <div className="flex items-center gap-1">
                                <ExpiryBadge info={info} />
                                {readOnly ? null : (
                                  <Button
                                    variant="outline"
                                    size="xs"
                                    onClick={() => setRenewing({ entry, owner: vehicle.plate })}
                                    aria-label={t('Renew {document}', { document: title })}
                                  >
                                    <RefreshCw />
                                    <span className="hidden sm:inline">{t('Renew')}</span>
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => setPaper({ doc, isNew: false })}
                                  aria-label={t('Edit {document}', { document: title })}
                                >
                                  <Pencil />
                                </Button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {unlinked.length && !canChange ? (
        <p className="text-xs text-slate-500">
          {tp(
            unlinkedPapers,
            '{count} vehicle paper in the register isn’t linked to a vehicle.',
            '{count} vehicle papers in the register aren’t linked to a vehicle.',
          )}{' '}
          <Link to="/compliance/documents" className="text-primary-700 hover:underline">
            {t('Open the register')}
          </Link>
        </p>
      ) : null}

      {editing ? (
        <VehicleDialog
          vehicle={editing.vehicle}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {paper ? (
        <DocumentDialog
          document={paper.doc}
          isNew={paper.isNew}
          employees={employees}
          defaultReminderDays={register.reminderDays}
          onClose={() => setPaper(null)}
        />
      ) : null}
      {renewing ? (
        <RenewDialog
          entry={renewing.entry}
          owner={renewing.owner}
          onClose={() => setRenewing(null)}
        />
      ) : null}
      {settingsDialog}
    </div>
  );
}
