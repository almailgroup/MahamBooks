import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Branding } from '@/db/types';
import { SignatureField } from './signature-field';

// A recolouring that takes a while (a large phone photo).
const slow = vi.hoisted(() => ({ gate: null as Promise<void> | null }));

// jsdom draws no pictures: the ink is applied by name, and read from a mark.
vi.mock('@/lib/image', async (original) => ({
  ...(await original<typeof import('@/lib/image')>()),
  inkImage: async (src: string, ink: string) => {
    if (slow.gate) await slow.gate;
    return `${src}#${ink}`;
  },
  normalizeImage: async (src: string, size = 800) => `${src}@${size}`,
  imageInk: async (src: string) => (src.endsWith('#blue') ? 'blue' : 'original'),
  logoFromFile: async () => 'data:image/png;base64,TkVX',
}));

afterEach(cleanup);

const SIGNED = 'data:image/png;base64,U0lH';

function renderField(branding: Partial<Branding>) {
  const onChange = vi.fn();
  render(
    <SignatureField
      branding={{
        accentColor: '#4f46e5',
        templateId: 'modern',
        logo: null,
        fontId: null,
        showStatusStamp: true,
        ...branding,
      }}
      onChange={onChange}
    />,
  );
  return onChange;
}

const selected = (name: string) =>
  screen.getByRole('tab', { name }).getAttribute('aria-selected') === 'true';

describe('the signature field', () => {
  it('makes a blue copy once and keeps the upload beside it', async () => {
    const onChange = renderField({ signature: SIGNED });
    expect(selected('Original')).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Blue ink' }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        signature: `${SIGNED}#blue`,
        signatureOriginal: `${SIGNED}@600`,
        signatureInk: 'blue',
      }),
    );
  });

  it('goes back to the upload it kept', () => {
    const onChange = renderField({
      signature: `${SIGNED}#blue`,
      signatureOriginal: SIGNED,
      signatureInk: 'blue',
    });
    expect(selected('Blue ink')).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Original' }));
    expect(onChange).toHaveBeenCalledWith({
      signature: SIGNED,
      signatureOriginal: null,
      signatureInk: 'original',
    });
  });

  it('shows a signature replaced by an older version in its own colours', async () => {
    // Blue was chosen, then another device put a new picture in its place.
    const onChange = renderField({
      signature: 'data:image/png;base64,TkVX',
      signatureOriginal: SIGNED,
      signatureInk: 'blue',
    });
    await waitFor(() => expect(selected('Original')).toBe(true));
    // Blue again is made from the new picture, not the old upload.
    fireEvent.click(screen.getByRole('tab', { name: 'Blue ink' }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        signature: 'data:image/png;base64,TkVX#blue',
        signatureOriginal: 'data:image/png;base64,TkVX@600',
        signatureInk: 'blue',
      }),
    );
  });

  it('keeps the ink as it is while an upload is put in it', async () => {
    const onChange = renderField({
      signature: `${SIGNED}#blue`,
      signatureOriginal: SIGNED,
      signatureInk: 'blue',
    });
    let done!: () => void;
    slow.gate = new Promise((resolve) => (done = resolve));
    const photo = new File(['photo'], 'signature.png', { type: 'image/png' });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [photo] },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Draw signature' })).toBeDisabled(),
    );
    // Original, tapped while the blue copy is being made, changes nothing.
    fireEvent.click(screen.getByRole('tab', { name: 'Original' }));
    expect(onChange).not.toHaveBeenCalled();
    done();
    slow.gate = null;
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          signatureInk: 'blue',
          signature: expect.stringMatching(/#blue$/),
        }),
      ),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Draw signature' })).toBeEnabled();
  });

  it('remembers the ink before there is a signature', () => {
    const onChange = renderField({});
    fireEvent.click(screen.getByRole('tab', { name: 'Blue ink' }));
    expect(onChange).toHaveBeenCalledWith({ signatureInk: 'blue' });
    expect(screen.getByRole('button', { name: 'Draw signature' })).toBeTruthy();
  });
});
