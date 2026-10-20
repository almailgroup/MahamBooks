import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { createEmployee, saveEmployee } from '@/db/people';
import type { Employee } from '@/db/types';
import { useCompany } from '@/app/company';
import { checksDrivingLicences } from '@/lib/compliance';
import { useDraftAttachments } from '@/features/purchases/attachments';
import {
  EmployeeForm,
  validateEmployee,
  type EmployeeErrors,
} from '@/features/people/employee-form';
import { useEmployees, usePeopleSettings } from '@/features/people/hooks';
import { usePayrollSettings } from '@/features/payroll/hooks';
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard';
import { Button } from '@/components/ui/button';
import { Card, PageHeader, Spinner } from '@/components/ui/misc';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';

/**
 * A fresh form for every visit: navigating from a just-saved employee to
 * "New employee" must not keep the previous draft while the route changes.
 */
export default function EmployeeFormRoute() {
  const location = useLocation();
  return <EmployeeFormPage key={location.key} />;
}

function EmployeeFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const company = useCompany();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [original, setOriginal] = useState('');
  const [errors, setErrors] = useState<EmployeeErrors>({});
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);
  const [newId] = useState(() => createEmployee(company.id).id);
  const files = useDraftAttachments(id ?? newId);
  const employees = useEmployees();
  const settings = usePeopleSettings();
  const payroll = usePayrollSettings();

  // The page shown after saving: loaded now, so saving moves straight to it.
  useEffect(() => {
    void import('./detail');
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let loaded: Employee | undefined;
      if (id) {
        loaded = await db.employees.get(id);
        if (!loaded || loaded.companyId !== company.id) {
          if (!cancelled) setMissing(true);
          return;
        }
      } else {
        loaded = createEmployee(company.id, { id: newId });
      }
      if (!cancelled) {
        setEmployee(loaded);
        setOriginal(JSON.stringify(loaded));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, company.id, newId]);

  const departments = useMemo(
    () =>
      [...new Set((employees ?? []).map((e) => e.department.trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [employees],
  );

  const dirty = employee !== null && (JSON.stringify(employee) !== original || files.dirty);
  const allowNavigation = useUnsavedGuard(dirty && !saving);

  if (missing) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">{t('This employee could not be found.')}</p>
        <Link to="/employees" className="text-primary-700 mt-4 inline-block text-sm font-medium">
          {t('Back to employees')}
        </Link>
      </Card>
    );
  }
  // With the settings: the department list decides how the department is chosen,
  // and a leave policy asks for the employee's own days a year.
  if (!employee || !settings || !payroll) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }

  const save = async () => {
    const found = validateEmployee(employee);
    const number = employee.number.trim().toLowerCase();
    if (
      number &&
      (employees ?? []).some((e) => e.id !== employee.id && e.number.toLowerCase() === number)
    ) {
      found.number = t('Employee number {number} is already used.', {
        number: employee.number.trim(),
      });
    }
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error(t('Please fix the highlighted fields.'));
      return;
    }
    setSaving(true);
    try {
      // Refused when the record changed after the form was opened: saving
      // would put back what the form still shows.
      const saved = await saveEmployee(
        employee,
        id ? { expectedUpdatedAt: employee.updatedAt } : {},
      );
      await files.commit(company.id);
      toast.success(t('{name} saved', { name: localName(saved) }));
      allowNavigation();
      navigate(`/employees/${saved.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the employee.'));
      setSaving(false);
    }
  };

  const actions = (
    <>
      <Button variant="ghost" onClick={() => navigate(-1)}>
        {t('Cancel')}
      </Button>
      <Button onClick={() => void save()} loading={saving}>
        {t('Save employee')}
      </Button>
    </>
  );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumb={<Link to="/employees">{t('Employees')}</Link>}
        title={
          id
            ? t('Edit {name}', { name: localName(employee) || employee.number })
            : t('New employee')
        }
        actions={actions}
      />
      <EmployeeForm
        value={employee}
        onChange={setEmployee}
        errors={errors}
        currency={company.currency}
        departments={departments}
        departmentList={settings.departments}
        drivingLicences={checksDrivingLicences(settings)}
        leavePolicy={payroll.leavePolicy}
        files={{
          ...files,
          // The photo is kept with the personnel file but changed on the employee's page.
          files: files.files.filter((f) => !employee.photoId || f.id !== employee.photoId),
        }}
      />
      <div className="mt-6 flex justify-end gap-2">{actions}</div>
    </div>
  );
}
