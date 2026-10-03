import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NumberInput } from './form';

function Harness({ onValue }: { onValue: (n: number) => void }) {
  const [value, setValue] = useState(0);
  return (
    <NumberInput
      aria-label="Amount"
      value={value}
      onValueChange={(n) => {
        setValue(n);
        onValue(n);
      }}
    />
  );
}

afterEach(cleanup);

describe('NumberInput', () => {
  const typed = async (text: string) => {
    let last = NaN;
    render(<Harness onValue={(n) => (last = n)} />);
    await userEvent.type(screen.getByLabelText('Amount'), text);
    return last;
  };

  it('reads fils with a decimal comma', async () => {
    expect(await typed('0,250')).toBe(0.25);
  });

  it('reads a comma before three digits as thousands', async () => {
    expect(await typed('12,500')).toBe(12500);
  });

  it('reads Arabic-Indic digits and the Arabic decimal mark', async () => {
    expect(await typed('١٢٫٧٥٠')).toBe(12.75);
  });
});
