import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { LanguageProvider } from './provider';
import { LanguageSwitch } from './language-switch';
import { loadLanguage } from './index';
import { ConfirmProvider } from '@/components/ui/overlay';
import { hasUnsavedChanges, useUnsavedGuard } from '@/hooks/use-unsaved-guard';

/**
 * The header's language switch on a page with unsaved changes (the invoice,
 * bill and journal editors use `useUnsavedGuard`). Same nesting as App.tsx:
 * LanguageProvider > ConfirmProvider > RouterProvider.
 */

function Editor() {
  const [notes, setNotes] = useState('');
  useUnsavedGuard(notes !== '');
  return (
    <div>
      <LanguageSwitch />
      <label>
        Notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
    </div>
  );
}

function renderEditor() {
  const router = createMemoryRouter([{ path: '/invoices/new', element: <Editor /> }], {
    initialEntries: ['/invoices/new'],
  });
  return render(
    <LanguageProvider>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </LanguageProvider>,
  );
}

afterEach(async () => {
  cleanup();
  await loadLanguage('en');
});

describe('switching language', () => {
  it('asks first when a form has unsaved changes, and keeps them on "Keep editing"', async () => {
    const user = userEvent.setup();
    renderEditor();
    expect(hasUnsavedChanges()).toBe(false);
    await user.type(screen.getByLabelText('Notes'), 'Delivery to Shuwaikh port');
    expect(hasUnsavedChanges()).toBe(true);

    await user.click(screen.getByRole('button', { name: 'العربية' }));
    const dialog = await screen.findByRole('dialog', { name: 'Discard your changes?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Notes')).toHaveValue('Delivery to Shuwaikh port');
    expect(document.documentElement.dir).not.toBe('rtl');

    // Asked again, the person lets the changes go: the app is now in Arabic.
    await user.click(screen.getByRole('button', { name: 'العربية' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Discard your changes?' })).getByRole(
        'button',
        { name: 'Discard changes' },
      ),
    );
    await screen.findByRole('button', { name: 'English' }, { timeout: 5000 });
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByLabelText('Notes')).toHaveValue('');
    // The old form's effects are cleaned up just after the new one shows.
    await waitFor(() => expect(hasUnsavedChanges()).toBe(false));
  });

  it('switches at once when nothing is waiting to be saved', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'العربية' }));
    await screen.findByRole('button', { name: 'English' }, { timeout: 5000 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
