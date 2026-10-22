import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { AccessGrid } from './access-grid';
import { SPLIT_APPS } from './apps';

afterEach(cleanup);

const row = (role: string) =>
  within(screen.getByRole('rowheader', { name: new RegExp(`^${role}`) }).closest('tr')!)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

describe('the access grid', () => {
  it('shows what each role opens in each app', () => {
    render(<AccessGrid mine="staff" />);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Role',
      'Maham Books',
      'Maham People',
      'Maham CRM',
      'Maham Compliance',
    ]);
    expect(row('Owner')).toEqual(['Full access', 'Full access', 'Full access', 'Full access']);
    expect(row('Accountant')).toEqual(['Full access', 'Full access', 'Works in it', 'Full access']);
    expect(row('Staff')).toEqual(['Works in it', 'No access', 'Works in it', 'View only']);
    expect(row('Viewer')).toEqual(['View only', 'No access', 'View only', 'View only']);
    expect(screen.getByRole('rowheader', { name: /^Staff/ })).toHaveTextContent('You');
  });

  it('shows Sales and Inventory with Books’ access in the split layout', () => {
    render(<AccessGrid mine="owner" apps={SPLIT_APPS} />);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Role',
      'Maham Sales',
      'Maham Books',
      'Maham Inventory',
      'Maham People',
      'Maham CRM',
      'Maham Compliance',
    ]);
    expect(row('Staff')).toEqual([
      'Works in it',
      'Works in it',
      'Works in it',
      'No access',
      'Works in it',
      'View only',
    ]);
    expect(row('Viewer')).toEqual([
      'View only',
      'View only',
      'View only',
      'No access',
      'View only',
      'View only',
    ]);
  });
});
