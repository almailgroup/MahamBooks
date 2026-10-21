import { useId, useState } from 'react';
import { toast } from 'sonner';
import { useCompany } from '@/app/company';
import { assignDepartment } from '@/db/people';
import type { Department, ID } from '@/db/types';
import { hasDepartmentList } from '@/lib/hr/departments';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { t, tp } from '@/i18n';
import { DepartmentSelect } from './department-select';

/**
 * "Department" for the employees selected on the employees page: puts them
 * all in one department (from the list, or a name typed when the company
 * keeps no list), or in none, in one transaction.
 */
export function AssignDepartmentDialog({
  employeeIds,
  list,
  inUse,
  onClose,
  onDone,
}: {
  employeeIds: readonly ID[];
  list: readonly Department[] | undefined;
  /** Departments the employees have, suggested without a list. */
  inUse: readonly string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const company = useCompany();
  const suggestions = useId();
  const [department, setDepartment] = useState('');
  // Nothing is saved before a choice: a department, or everyone out of theirs
  // (ticked on its own, since "No department" is where the list starts).
  const [chosen, setChosen] = useState(false);
  const [out, setOut] = useState(false);
  const [saving, setSaving] = useState(false);
  const choose = (name: string) => {
    setDepartment(name);
    setChosen(true);
    setOut(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const changed = await assignDepartment(company.id, employeeIds, out ? '' : department);
      toast.success(
        changed
          ? tp(changed, '{count} employee moved', '{count} employees moved')
          : t('They are all in it already.'),
      );
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the departments.'));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="sm"
        title={t('Department')}
        description={tp(
          employeeIds.length,
          'For the {count} employee selected.',
          'For the {count} employees selected.',
        )}
      >
        <DialogBody>
          <Field label={t('Department')}>
            {(id) =>
              list && hasDepartmentList(list) ? (
                <DepartmentSelect id={id} value={department} list={list} onChange={choose} />
              ) : (
                <>
                  <Input
                    id={id}
                    value={department}
                    onChange={(e) => choose(e.target.value)}
                    list={suggestions}
                    placeholder={t('No department')}
                    dir="auto"
                  />
                  <datalist id={suggestions}>
                    {inUse.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                </>
              )
            }
          </Field>
          <Checkbox
            checked={out}
            onChange={(e) => setOut(e.target.checked)}
            label={t('Take them out of their department')}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!chosen && !out}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
