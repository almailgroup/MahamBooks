import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { db } from '@/db/db';
import { setupCompany } from '@/db/records';
import { CompanyProvider } from '@/app/company';
import type { CloudLink } from '@/cloud/types';
import type { MemberRole } from '@/cloud/roles';
import { PayrollNotIncluded } from './role-gates';

/** Made-up data only. */

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(cleanup);

async function companyAs(role: MemberRole | null) {
  const company = await setupCompany({ name: 'Review Trading' });
  if (role) {
    const link: CloudLink = {
      companyId: company.id,
      userId: 'user-1',
      role,
      status: 'ready',
      cursor: 0,
      name: company.name,
      linkedAt: new Date().toISOString(),
      lastSyncAt: null,
      lastError: null,
      lastErrorAt: null,
    };
    await db.syncState.put(link);
  }
}

function renderNote() {
  render(
    <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
      <PayrollNotIncluded />
      <p>Totals</p>
    </CompanyProvider>,
  );
}

const NOTE = 'Payroll isn’t included in what you see.';

describe('the books staff and viewers see', () => {
  it.each(['staff', 'viewer'] as const)(
    'carry a note that payroll is left out (%s)',
    async (role) => {
      await companyAs(role);
      renderNote();
      expect(await screen.findByRole('note')).toHaveTextContent(NOTE);
    },
  );

  it.each(['owner', 'admin', 'accountant', null] as const)(
    'have no note for those who see payroll (%s)',
    async (role) => {
      await companyAs(role);
      renderNote();
      await screen.findByText('Totals');
      // The link has been read by now; still no note.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByText(NOTE)).toBeNull();
    },
  );
});
