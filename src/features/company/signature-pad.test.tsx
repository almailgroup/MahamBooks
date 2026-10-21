import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { SignaturePad } from './signature-pad';

/** The signature pad. jsdom draws nothing: a canvas that takes strokes and keeps no ink. */

beforeEach(() => {
  const ctx = {
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    clearRect: () => undefined,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
    }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  // jsdom has no pointer capture.
  Object.assign(HTMLCanvasElement.prototype, { setPointerCapture: () => undefined });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Pad() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Draw signature
      </button>
      <SignaturePad open={open} onOpenChange={setOpen} onDone={() => undefined} />
    </>
  );
}

describe('the signature pad', () => {
  it('opens empty again after a drawing was cancelled', async () => {
    render(<Pad />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Draw signature' }));
    expect(screen.getByRole('button', { name: 'Use this signature' })).toBeDisabled();
    fireEvent.pointerDown(screen.getByLabelText('Signature pad'), { pointerId: 1 });
    expect(screen.getByRole('button', { name: 'Use this signature' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Signature pad')).toBeNull();
    // Opened again: a new, empty pad.
    await user.click(screen.getByRole('button', { name: 'Draw signature' }));
    expect(screen.getByRole('button', { name: 'Use this signature' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    // The same after Escape.
    fireEvent.pointerDown(screen.getByLabelText('Signature pad'), { pointerId: 1 });
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Draw signature' }));
    expect(screen.getByRole('button', { name: 'Use this signature' })).toBeDisabled();
  });
});
