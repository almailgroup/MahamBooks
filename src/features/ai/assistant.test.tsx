import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { saveCompany, setupCompany } from '@/db/records';
import type { Company } from '@/db/types';
import { CompanyProvider } from '@/app/company';
import type { CloudLink } from '@/cloud/types';
import type { CloudUser } from '@/cloud/auth';
import { loadLanguage } from '@/i18n';
import { LanguageProvider } from '@/i18n/provider';
import { resetLastApp } from '@/suite/current-app';
import { CommandPalette } from '@/features/search/command-palette';
import { ConfirmProvider } from '@/components/ui/overlay';
import type { StreamOptions } from './client';
import { AiError } from './errors';
import { AiAssistant } from './assistant';
import { assistantState, openAssistant, resetAssistantForTests } from './store';
import { withAiSwitch } from './availability';

/**
 * The Ask AI button and its panel over a fake AI service: asking, the
 * answer streamed, Stop, errors and Try again, the starter questions, the
 * keyboard, Arabic, and the button hidden unless the company's switch is on
 * and the person is signed in to it in the cloud. Made-up company and person.
 */

const cloud = vi.hoisted(() => ({ user: null as CloudUser | null }));
vi.mock('@/cloud/store', async (original) => ({
  ...(await original<typeof import('@/cloud/store')>()),
  useCloud: () => ({
    user: cloud.user,
    api: null,
    manager: null,
    configured: true,
    ready: true,
    redirectError: null,
  }),
}));

const USER: CloudUser = {
  id: 'user-1',
  email: 'owner@example.com',
  fullName: 'Made-up Owner',
  language: 'en',
} as CloudUser;

/** The questions asked of the fake service, each answered by the test. */
interface Asked {
  options: StreamOptions;
  write: (text: string) => void;
  finish: () => void;
  fail: (error: AiError) => void;
}
let asked: Asked[] = [];

function fakeService(options: StreamOptions): Promise<{ text: string }> {
  return new Promise((resolve, reject) => {
    let text = '';
    options.signal?.addEventListener('abort', () => reject(new AiError('aborted')));
    asked.push({
      options,
      write: (piece) => {
        text += piece;
        options.onText(piece, text);
      },
      finish: () => resolve({ text }),
      fail: reject,
    });
  });
}

let company: Company;

async function linkCompany(userId = USER.id) {
  const link: CloudLink = {
    companyId: company.id,
    userId,
    role: 'owner',
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

function show(path = '/people') {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <LanguageProvider>
            <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
              <p>Page</p>
              <AiAssistant />
            </CompanyProvider>
          </LanguageProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** The command palette, open, beside the assistant. */
function Palette() {
  const [open, setOpen] = useState(true);
  return <CommandPalette open={open} onOpenChange={setOpen} onOpenItem={() => undefined} />;
}

function showWithPalette(path = '/people') {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <LanguageProvider>
            <ConfirmProvider>
              <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
                <p>Page</p>
                <Palette />
                <AiAssistant />
              </CompanyProvider>
            </ConfirmProvider>
          </LanguageProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const askButton = () => screen.findByRole('button', { name: 'Ask AI' });
const panel = () => screen.getByRole('dialog', { name: 'AI assistant' });
const box = () => screen.getByRole('textbox', { name: 'Your question' });

function type(text: string) {
  fireEvent.change(box(), { target: { value: text } });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  resetLastApp();
  asked = [];
  resetAssistantForTests(fakeService);
  cloud.user = USER;
  company = await setupCompany({ name: 'Made-up Trading', currency: 'KWD' });
  company = await saveCompany(withAiSwitch(company, true));
  await linkCompany();
});
afterEach(async () => {
  cleanup();
  await loadLanguage('en');
});

describe('the Ask AI button', () => {
  it('shows once the switch is on and the person is signed in to the company', async () => {
    show();
    expect(await askButton()).toBeInTheDocument();
  });

  it('is hidden with the switch off', async () => {
    await saveCompany(withAiSwitch(company, false));
    show();
    await screen.findByText('Page');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: 'Ask AI' })).toBeNull();
  });

  it('is hidden for a company kept on this device only, and when signed out', async () => {
    await db.syncState.clear();
    show();
    await screen.findByText('Page');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: 'Ask AI' })).toBeNull();
    cleanup();
    await linkCompany();
    cloud.user = null;
    show();
    await screen.findByText('Page');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: 'Ask AI' })).toBeNull();
  });

  it('opens with Ctrl J too', async () => {
    show();
    await askButton();
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'AI assistant' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Ask AI in the command palette', () => {
  /** A made-up IBAN: the kind of thing typed in the search box, never found there. */
  const IBAN = 'KW00TEST0000000000000000000000';

  beforeEach(() => {
    // The palette keeps the highlighted result in view; jsdom has no layout.
    Element.prototype.scrollIntoView ??= () => undefined;
  });

  it('is never what Enter opens on a search with no result, and sends nothing itself', async () => {
    showWithPalette();
    // Behind the palette (a modal), so hidden from the accessibility tree.
    await screen.findByRole('button', { name: 'Ask AI', hidden: true });
    const search = screen.getByRole('combobox', { name: 'Search' });
    fireEvent.change(search, { target: { value: IBAN } });
    expect(await screen.findByText(`Nothing found for “${IBAN}”`)).toBeInTheDocument();
    const option = screen.getByRole('option', { name: new RegExp('Ask AI…') });
    expect(option).toHaveAttribute('aria-selected', 'false');
    expect(search).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(search, { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Nothing opened, nothing sent, nothing kept for the assistant.
    expect(screen.getByRole('combobox', { name: 'Search' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'AI assistant' })).toBeNull();
    expect(assistantState()).toMatchObject({ open: false, draft: '', pending: null });
    expect(asked).toHaveLength(0);

    // Chosen on purpose (arrow down, Enter): the panel opens with it in the box, unsent.
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(option).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(search, { key: 'Enter' });
    const question = await screen.findByRole('textbox', { name: 'Your question' });
    expect(question).toHaveValue(IBAN);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(asked).toHaveLength(0);
    expect(assistantState().turns).toEqual([]);
  });

  it('comes after the results, and Enter opens the first result', async () => {
    const router = showWithPalette();
    await screen.findByRole('button', { name: 'Ask AI', hidden: true });
    const search = screen.getByRole('combobox', { name: 'Search' });
    fireEvent.change(search, { target: { value: 'Employees' } });
    const options = await screen.findAllByRole('option');
    await waitFor(() => expect(options[0]).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getAllByRole('option').at(-1)).toHaveTextContent('Ask AI…');
    expect(screen.queryByText(/Nothing found/)).toBeNull();
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Search' })).toBeNull());
    expect(router.state.location.pathname).toBe('/employees');
    expect(assistantState().open).toBe(false);
    expect(asked).toHaveLength(0);
  });
});

describe('the panel', () => {
  it('asks, shows the answer while it is written, and offers to copy it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    show('/payroll/leave');
    fireEvent.click(await askButton());
    expect(await within(panel()).findByText('Leave')).toBeInTheDocument();
    // Starters for People.
    expect(
      within(panel()).getByRole('button', { name: 'How do I record annual leave?' }),
    ).toBeVisible();

    type('How do I record sick leave?');
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(box()).toHaveValue('');
    expect(within(panel()).getByText('How do I record sick leave?')).toBeInTheDocument();
    expect(within(panel()).getByText('Writing the answer…')).toBeInTheDocument();
    expect(asked[0].options.messages).toEqual([
      { role: 'user', text: 'How do I record sick leave?' },
    ]);
    expect(asked[0].options.system).toContain('Page: Leave');

    act(() => asked[0].write('Open **Payroll** → '));
    expect(await within(panel()).findByText('Payroll')).toHaveProperty('tagName', 'STRONG');
    expect(within(panel()).getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    act(() => asked[0].write('Leave, then *New leave*.'));
    act(() => asked[0].finish());
    expect(await within(panel()).findByText('New leave')).toHaveProperty('tagName', 'EM');
    expect(within(panel()).queryByRole('button', { name: 'Stop' })).toBeNull();

    fireEvent.click(within(panel()).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('Open **Payroll** → Leave, then *New leave*.');

    // The next question carries the conversation.
    type('And for half a day?');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1].options.messages.map((m) => m.role)).toEqual(['user', 'model', 'user']);
  });

  it('takes a new line with Shift+Enter, and doesn’t send an empty question', async () => {
    show();
    fireEvent.click(await askButton());
    type('First line');
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true });
    expect(asked).toHaveLength(0);
    type('   ');
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(asked).toHaveLength(0);
    expect(within(panel()).getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('stops the answer, keeping what was written, and can ask again', async () => {
    // The home: questions about Maham One as a whole.
    show('/');
    fireEvent.click(await askButton());
    fireEvent.click(
      within(panel()).getByRole('button', { name: 'What can Maham One do for my company?' }),
    );
    await waitFor(() => expect(asked).toHaveLength(1));
    act(() => asked[0].write('It keeps your books'));
    await within(panel()).findByText('It keeps your books');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Stop' }));
    expect(await within(panel()).findByText('Stopped')).toBeInTheDocument();
    expect(asked[0].options.signal?.aborted).toBe(true);
    expect(within(panel()).getByText('It keeps your books')).toBeInTheDocument();

    fireEvent.click(within(panel()).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(asked).toHaveLength(2));
    act(() => asked[1].write('Accounting, payroll and more.'));
    act(() => asked[1].finish());
    expect(await within(panel()).findByText('Accounting, payroll and more.')).toBeInTheDocument();
    expect(within(panel()).queryByText('It keeps your books')).toBeNull();
  });

  it('says what went wrong, with the wait for a limit, and tries again', async () => {
    show();
    fireEvent.click(await askButton());
    type('Where are cheques?');
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(asked).toHaveLength(1));
    act(() => asked[0].fail(new AiError('rate_limited', { status: 429, retryAfter: 30 })));
    const alert = await within(panel()).findByRole('alert');
    expect(alert).toHaveTextContent('Too many questions in a short time. Try again in 30 seconds.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(asked).toHaveLength(2));
    // The failed answer isn't sent back.
    expect(asked[1].options.messages).toEqual([{ role: 'user', text: 'Where are cheques?' }]);
    act(() => asked[1].write('In Maham Books → Cheques.'));
    act(() => asked[1].finish());
    expect(await within(panel()).findByText('In Maham Books → Cheques.')).toBeInTheDocument();
    expect(within(panel()).queryByRole('alert')).toBeNull();
  });

  it('starts again with New chat, and puts what the palette typed in the box, unsent', async () => {
    show();
    fireEvent.click(await askButton());
    type('Hello');
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(asked).toHaveLength(1));
    act(() => asked[0].write('Hi.'));
    act(() => asked[0].finish());
    await within(panel()).findByText('Hi.');
    fireEvent.click(within(panel()).getByRole('button', { name: 'New chat' }));
    expect(within(panel()).queryByText('Hi.')).toBeNull();
    expect(assistantState().turns).toEqual([]);

    // From the palette, with the panel closed: it opens with the question in the box.
    fireEvent.click(within(panel()).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    act(() => openAssistant('How do I add a vendor?'));
    expect(await screen.findByRole('textbox', { name: 'Your question' })).toHaveValue(
      'How do I add a vendor?',
    );
    await waitFor(() => expect(box()).toHaveFocus());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(asked).toHaveLength(1);
    // Sent by the person, once their role is known, so the guide holds their apps.
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1].options.messages).toEqual([{ role: 'user', text: 'How do I add a vendor?' }]);
    expect(asked[1].options.system).toContain('Role: owner');
    expect(asked[1].options.system).toContain('- Maham People');
  });

  it('keeps a question from the palette while an answer is written, under one being typed', async () => {
    show();
    fireEvent.click(await askButton());
    type('First question');
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(asked).toHaveLength(1));
    type('Half typed');
    act(() => openAssistant('Second question from the palette'));
    expect(box()).toHaveValue('Half typed\nSecond question from the palette');
    // Enter while the answer is written sends nothing and keeps the box.
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(asked).toHaveLength(1);
    act(() => asked[0].write('One.'));
    act(() => asked[0].finish());
    await within(panel()).findByText('One.');
    expect(asked).toHaveLength(1);
    type('Second question from the palette');
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1].options.messages.at(-1)).toEqual({
      role: 'user',
      text: 'Second question from the palette',
    });
  });

  it('keeps the unsent question when closed, and stays open while the app is drawn again', async () => {
    show('/people');
    fireEvent.click(await askButton());
    type('An unsent question');
    fireEvent.keyDown(box(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(await askButton());
    expect(box()).toHaveValue('An unsent question');
    // Another language draws the app again, its cloud link read anew.
    cleanup();
    await loadLanguage('ar');
    show('/people');
    expect(await screen.findByRole('dialog', { name: 'المساعد الذكي' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'سؤالك' })).toHaveValue('An unsent question');
    await screen.findByRole('button', { name: 'اسأل المساعد', hidden: true });
    expect(assistantState().open).toBe(true);
    expect(asked).toHaveLength(0);
  });

  it('puts the focus back where it was when the panel closes', async () => {
    show();
    const button = await askButton();
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(box()).toHaveFocus());
    fireEvent.keyDown(box(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(button).toHaveFocus());

    // Opened with Ctrl J from a field of the page: back to that field.
    cleanup();
    render(<input aria-label="A page field" />);
    show();
    await askButton();
    const field = screen.getByRole('textbox', { name: 'A page field' });
    field.focus();
    fireEvent.keyDown(field, { key: 'j', ctrlKey: true });
    await waitFor(() => expect(box()).toHaveFocus());
    fireEvent.click(within(panel()).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(field).toHaveFocus());
  });

  it('leaves a failed question out of what the next question sends', async () => {
    show();
    fireEvent.click(await askButton());
    type('First');
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(asked).toHaveLength(1));
    act(() => asked[0].write('Answer one.'));
    act(() => asked[0].finish());
    await within(panel()).findByText('Answer one.');
    type('Too many');
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(asked).toHaveLength(2));
    act(() => asked[1].fail(new AiError('rate_limited', { status: 429, retryAfter: 5 })));
    await within(panel()).findByRole('alert');
    type('A new question');
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(asked).toHaveLength(3));
    expect(asked[2].options.messages).toEqual([
      { role: 'user', text: 'First' },
      { role: 'model', text: 'Answer one.' },
      { role: 'user', text: 'A new question' },
    ]);
  });

  it('says it needs the internet when offline', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      show();
      fireEvent.click(await askButton());
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      expect(
        within(panel()).getByText('The AI assistant needs an internet connection.'),
      ).toBeInTheDocument();
      type('Anything');
      expect(within(panel()).getByRole('button', { name: 'Send' })).toBeDisabled();
      fireEvent.keyDown(box(), { key: 'Enter' });
      expect(asked).toHaveLength(0);
    } finally {
      online.mockRestore();
    }
  });

  it('works in Arabic, right to left, with each message finding its direction', async () => {
    await loadLanguage('ar');
    show('/employees');
    const button = await screen.findByRole('button', { name: 'اسأل المساعد' });
    expect(document.documentElement.dir).toBe('rtl');
    fireEvent.click(button);
    const sheet = screen.getByRole('dialog', { name: 'المساعد الذكي' });
    const question = within(sheet).getByRole('textbox', { name: 'سؤالك' });
    expect(question).toHaveAttribute('dir', 'auto');
    fireEvent.change(question, { target: { value: 'كيف أسجّل إجازة سنوية؟' } });
    fireEvent.keyDown(question, { key: 'Enter' });
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0].options.system).toContain('App language: Arabic');
    act(() => asked[0].write('افتح **الرواتب** ثم الإجازات.'));
    act(() => asked[0].finish());
    const bold = await within(sheet).findByText('الرواتب');
    expect(bold.closest('p')).toHaveAttribute('dir', 'auto');
    expect(within(sheet).getByText('كيف أسجّل إجازة سنوية؟')).toHaveAttribute('dir', 'auto');
    expect(
      within(sheet).getByText('قد يخطئ الذكاء الاصطناعي. تحقّق من الإجابات المهمة.'),
    ).toBeInTheDocument();
  });

  it('forgets the conversation when another person takes over the tab', async () => {
    show();
    fireEvent.click(await askButton());
    type('Hello');
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(asked).toHaveLength(1));
    act(() => asked[0].finish());
    cleanup();
    cloud.user = { ...USER, id: 'user-2' };
    await linkCompany('user-2');
    show();
    await askButton();
    expect(assistantState().turns).toEqual([]);
    expect(assistantState().open).toBe(false);
  });
});
