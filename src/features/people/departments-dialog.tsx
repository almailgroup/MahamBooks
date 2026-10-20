import { useState } from 'react';
import { Archive, ArchiveRestore, Merge, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useCompany } from '@/app/company';
import {
  addDepartment,
  addDepartmentsInUse,
  mergeDepartment,
  setDepartmentArchived,
  updateDepartment,
} from '@/db/people';
import type { Department, Employee } from '@/db/types';
import {
  departmentChoices,
  departmentHeadcounts,
  departmentKey,
  unlistedDepartments,
} from '@/lib/hr/departments';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge } from '@/components/ui/misc';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  useConfirm,
} from '@/components/ui/overlay';
import { useLanguage } from '@/i18n/provider';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';

const failed = (error: unknown) =>
  toast.error(error instanceof Error ? error.message : t('Could not save the departments.'));

/** English and Arabic names, side by side. */
function NameFields({
  name,
  nameAr,
  onChange,
}: {
  name: string;
  nameAr: string;
  onChange: (patch: { name?: string; nameAr?: string }) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label={t('Name (English)')}>
        {(id) => (
          <Input
            id={id}
            value={name}
            onChange={(e) => onChange({ name: e.target.value })}
            autoComplete="off"
            dir="ltr"
          />
        )}
      </Field>
      <Field label={t('Name (Arabic)')} optional>
        {(id) => (
          <Input
            id={id}
            value={nameAr}
            onChange={(e) => onChange({ nameAr: e.target.value })}
            autoComplete="off"
            dir="rtl"
          />
        )}
      </Field>
    </div>
  );
}

/** Choosing the department of the list to merge into. */
function MergeInto({
  from,
  listed,
  count,
  targets,
  onCancel,
  onMerged,
}: {
  from: string;
  /** A department of the list, which leaves it once merged. */
  listed: boolean;
  count: number;
  targets: Department[];
  onCancel: () => void;
  onMerged: () => void;
}) {
  const company = useCompany();
  const confirm = useConfirm();
  const { language } = useLanguage();
  const [into, setInto] = useState('');
  const [busy, setBusy] = useState(false);
  const target = targets.find((d) => d.id === into);

  const merge = async () => {
    if (!target) return;
    const ok = await confirm({
      title: t('Merge {from} into {to}?', { from, to: localName(target, language) }),
      description: [
        tp(
          count,
          '{count} employee moves to {department}.',
          '{count} employees move to {department}.',
          {
            department: localName(target, language),
          },
        ),
        listed ? t('{name} leaves the list.', { name: from }) : '',
      ]
        .filter(Boolean)
        .join(' '),
      confirmLabel: t('Merge'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await mergeDepartment(company.id, from, target.id);
      toast.success(t('Departments merged'));
      onMerged();
    } catch (error) {
      failed(error);
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="sm:w-60">
        <Select aria-label={t('Merge into')} value={into} onChange={(e) => setInto(e.target.value)}>
          <option value="">{t('Merge into…')}</option>
          {targets.map((d) => (
            <option key={d.id} value={d.id}>
              {localName(d, language)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void merge()} disabled={!target} loading={busy}>
          {t('Merge')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('Cancel')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Employees → Departments: the company's list of departments with their
 * Arabic names. Add, rename (the employees in it get the new name in the
 * same transaction), merge another spelling into one, and archive. The
 * names employees have that aren't in the list are shown to add or merge.
 */
export function DepartmentsDialog({
  list,
  employees,
  onClose,
}: {
  list: readonly Department[];
  employees: readonly Employee[];
  onClose: () => void;
}) {
  const company = useCompany();
  const confirm = useConfirm();
  const { language } = useLanguage();
  const [draft, setDraft] = useState({ name: '', nameAr: '' });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string; nameAr: string } | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const counts = departmentHeadcounts(list, employees);
  const unlisted = unlistedDepartments(list, employees);
  const active = departmentChoices(list, language);
  const archived = list.filter((d) => d.archived);

  const add = async () => {
    setAdding(true);
    try {
      await addDepartment(company.id, draft);
      setDraft({ name: '', nameAr: '' });
      toast.success(t('Department added'));
    } catch (error) {
      failed(error);
    } finally {
      setAdding(false);
    }
  };

  const addInUse = async () => {
    setBusy(true);
    try {
      const added = await addDepartmentsInUse(company.id);
      toast.success(tp(added, '{count} department added', '{count} departments added'));
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const before = list.find((d) => d.id === editing.id);
    const moving = before ? (counts.get(before.id) ?? 0) : 0;
    if (before && moving > 0 && editing.name.trim() !== before.name) {
      const ok = await confirm({
        title: t('Rename {from} to {to}?', { from: before.name, to: editing.name.trim() }),
        description: tp(
          moving,
          '{count} employee in it gets the new name. Someone changing them on another device at the same time may keep the old one.',
          '{count} employees in it get the new name. Someone changing them on another device at the same time may keep the old one.',
        ),
        confirmLabel: t('Rename'),
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await updateDepartment(company.id, editing.id, editing);
      setEditing(null);
      toast.success(t('Department saved'));
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  };

  const archive = async (d: Department, on: boolean) => {
    try {
      await setDepartmentArchived(company.id, d.id, on);
    } catch (error) {
      failed(error);
    }
  };

  const row = (d: Department) => {
    const count = counts.get(d.id) ?? 0;
    if (editing?.id === d.id) {
      return (
        <li key={d.id} className="space-y-3 py-3">
          <NameFields
            name={editing.name}
            nameAr={editing.nameAr}
            onChange={(patch) => setEditing({ ...editing, ...patch })}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              {t('Cancel')}
            </Button>
            <Button size="sm" onClick={() => void saveEdit()} loading={busy}>
              {t('Save')}
            </Button>
          </div>
        </li>
      );
    }
    return (
      <li key={d.id} className="py-3" aria-label={d.name}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
              <span dir="ltr">{d.name}</span>
              {d.archived ? <Badge tone="slate">{t('Archived')}</Badge> : null}
            </p>
            <p className="text-sm text-slate-500" dir={d.nameAr ? 'rtl' : undefined}>
              {d.nameAr || t('No Arabic name')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="tabular text-xs text-slate-500">
              {tp(count, '{count} employee', '{count} employees')}
            </span>
            <DropdownMenu>
              <DropdownTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('Actions for {name}', { name: d.name })}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownTrigger>
              <DropdownContent>
                <DropdownItem
                  icon={<Pencil />}
                  onSelect={() => setEditing({ id: d.id, name: d.name, nameAr: d.nameAr })}
                >
                  {t('Rename')}
                </DropdownItem>
                {active.some((x) => x.id !== d.id) ? (
                  <DropdownItem icon={<Merge />} onSelect={() => setMerging(d.name)}>
                    {t('Merge into…')}
                  </DropdownItem>
                ) : null}
                {d.archived ? (
                  <DropdownItem icon={<ArchiveRestore />} onSelect={() => void archive(d, false)}>
                    {t('Restore')}
                  </DropdownItem>
                ) : (
                  <DropdownItem icon={<Archive />} onSelect={() => void archive(d, true)}>
                    {t('Archive')}
                  </DropdownItem>
                )}
              </DropdownContent>
            </DropdownMenu>
          </div>
        </div>
        {merging === d.name ? (
          <MergeInto
            from={d.name}
            listed
            count={count}
            targets={active.filter((x) => x.id !== d.id)}
            onCancel={() => setMerging(null)}
            onMerged={() => setMerging(null)}
          />
        ) : null}
      </li>
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="lg"
        title={t('Departments')}
        description={t(
          'The company’s departments in English and Arabic. Employees keep the English name; the Arabic one shows in Arabic.',
        )}
      >
        <DialogBody>
          <form
            className="space-y-3 rounded-lg border border-slate-200 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <NameFields
              name={draft.name}
              nameAr={draft.nameAr}
              onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                loading={adding}
                disabled={!draft.name.trim() && !draft.nameAr.trim()}
              >
                <Plus /> {t('Add department')}
              </Button>
            </div>
          </form>

          {list.length === 0 && unlisted.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-slate-600">
                {tp(
                  unlisted.length,
                  'Your employees already have {count} department. Start the list with it?',
                  'Your employees already have {count} departments. Start the list with them?',
                )}
              </p>
              <Button size="sm" variant="outline" onClick={() => void addInUse()} loading={busy}>
                {t('Add the departments in use')}
              </Button>
            </div>
          ) : null}

          {active.length + archived.length > 0 ? (
            <ul className="divide-y divide-slate-100" aria-label={t('Departments')}>
              {active.map(row)}
              {archived.map(row)}
            </ul>
          ) : null}

          {list.length > 0 && unlisted.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">{t('Not in the list')}</h3>
              <p className="text-xs text-slate-500">
                {t(
                  'Departments your employees have under another name or spelling. Add them, or merge them into one of the list.',
                )}
              </p>
              <ul className="divide-y divide-slate-100" aria-label={t('Not in the list')}>
                {unlisted.map((u) => (
                  <li key={departmentKey(u.name)} className="py-3" aria-label={u.name}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900" dir="auto">
                          {u.name}
                        </p>
                        <p className="tabular text-xs text-slate-500">
                          {tp(u.count, '{count} employee', '{count} employees')}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void addDepartment(company.id, { name: u.name }).then(
                              () => toast.success(t('Department added')),
                              failed,
                            )
                          }
                        >
                          {t('Add')}
                        </Button>
                        {active.length > 0 ? (
                          <Button size="sm" variant="outline" onClick={() => setMerging(u.name)}>
                            {t('Merge into…')}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {merging === u.name ? (
                      <MergeInto
                        from={u.name}
                        listed={false}
                        count={u.count}
                        targets={active}
                        onCancel={() => setMerging(null)}
                        onMerged={() => setMerging(null)}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
