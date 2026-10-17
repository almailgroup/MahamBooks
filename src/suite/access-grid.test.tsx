import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { AccessGrid } from './access-grid';

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
});
