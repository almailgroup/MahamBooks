/**
 * Review findings on the employee screens: the reason for leaving is never
 * chosen for the user, the photo isn't offered as a personnel file, and a
 * form opened before a change elsewhere doesn't overwrite it. Made-up data.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { setCurrentCompanyId, setupCompany } from '@/db/records';
import { createEmployee, saveEmployee, setEmployeePhoto } from '@/db/people';
import { addAttachment } from '@/db/purchases';
import type { Employee } from '@/db/types';
import { CompanyProvider } from '@/app/company';
import { ConfirmProvider } from '@/components/ui/overlay';
import EmployeeFormRoute from '@/apps/people/pages/people/form';
import { MarkLeftDialog } from './mark-left-dialog';

const PIXEL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(cleanup);

async function guard(): Promise<Employee> {
  const c = await setupCompany({ name: 'Test Security Co' });
  await setCurrentCompanyId(c.id);
  return saveEmployee(
    createEmployee(c.id, {
      name: 'Test Guard Two',
      category: 'expat',
      nationality: 'IN',
      hireDate: '2024-10-01',
      basicSalary: 300,
    }),
  );
}

function editPage(employee: Employee) {
  const router = createMemoryRouter(
    [
      { path: '/employees/:id/edit', element: <EmployeeFormRoute /> },
      { path: '/employees/:id', element: <p>Employee page</p> },
    ],
    { initialEntries: [`/employees/${employee.id}/edit`] },
  );
  render(
    <CompanyProvider fallback={null} onboarding={null}>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </CompanyProvider>,
  );
}

const saveButton = async () => (await screen.findAllByRole('button', { name: 'Save employee' }))[0];

describe('employee form', () => {
  it('asks for the reason for leaving instead of choosing one', async () => {
    const employee = await guard();
    editPage(employee);
    await userEvent.click(await screen.findByRole('tab', { name: 'Left' }));
    const reason = (await screen.findByLabelText('Reason for leaving')) as HTMLSelectElement;
    expect(reason.value).toBe('');
    expect(reason.options[0].textContent).toBe('Choose a reason');

    await userEvent.click(await saveButton());
    expect(await screen.findByText('Choose the reason for leaving.')).toBeInTheDocument();
    expect((await db.employees.get(employee.id))!.status).toBe('active');

    await userEvent.selectOptions(reason, 'resignation');
    await userEvent.click(await saveButton());
    await screen.findByText('Employee page');
    expect(await db.employees.get(employee.id)).toMatchObject({
      status: 'left',
      leavingReason: 'resignation',
    });
  });

  it('doesn’t offer the photo as a personnel file', async () => {
    const employee = await guard();
    await setEmployeePhoto(employee.id, { name: 'guard.jpg', dataUrl: PIXEL });
    await addAttachment(employee.companyId, employee.id, {
      name: 'contract.pdf',
      type: 'application/pdf',
      dataUrl: 'data:application/pdf;base64,AAAA',
    });
    editPage(employee);
    expect(await screen.findByText('contract.pdf')).toBeInTheDocument();
    expect(screen.queryByText('guard.jpg')).toBeNull();
  });

  it('refuses to save over a change made after it was opened', async () => {
    const employee = await guard();
    editPage(employee);
    const title = await screen.findByLabelText(/^Job title \(English\)/);
    // Changed elsewhere (another tab, another device) while the form is open.
    const changed = await saveEmployee({ ...employee, notes: 'Moved to the night shift' });
    await userEvent.type(title, 'Supervisor');
    await userEvent.click(await saveButton());
    await waitFor(async () =>
      expect(await db.employees.get(employee.id)).toMatchObject({
        notes: 'Moved to the night shift',
        jobTitle: '',
        updatedAt: changed.updatedAt,
      }),
    );
    expect(screen.queryByText('Employee page')).toBeNull();
  });
});

describe('marking someone with payroll records as left', () => {
  it('asks for the reason', async () => {
    const employee = await guard();
    let closed = false;
    render(
      <CompanyProvider fallback={null} onboarding={null}>
        <MarkLeftDialog
          employee={employee}
          onClose={() => {
            closed = true;
          }}
        />
      </CompanyProvider>,
    );
    const mark = await screen.findByRole('button', { name: 'Mark as left' });
    await userEvent.click(mark);
    expect(await screen.findByText('Choose the reason for leaving.')).toBeInTheDocument();
    expect((await db.employees.get(employee.id))!.status).toBe('active');
    await userEvent.selectOptions(screen.getByLabelText('Reason for leaving'), 'termination');
    await userEvent.click(mark);
    await waitFor(() => expect(closed).toBe(true));
    expect(await db.employees.get(employee.id)).toMatchObject({
      status: 'left',
      leavingReason: 'termination',
    });
  });
});
