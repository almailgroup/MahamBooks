import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { setDictionaryForTests } from '@/i18n';
import { LineChart, niceRange } from './line-chart';
import { BarList } from './bar-list';
import { MemoryRouter } from 'react-router';

// jsdom has no layout: every chart is 600px wide.
class FixedWidth {
  constructor(private callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [{ contentRect: { width: 600 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

const original = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = FixedWidth as unknown as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = original;
});
afterEach(() => {
  cleanup();
  setDictionaryForTests('en', {});
});

const money = (v: number) => `KD ${v.toFixed(3)}`;

function balance(values = [1200, 300, -450, 800]) {
  return (
    <LineChart
      title="Cash at the end of each month"
      labels={['Jul', 'Aug', 'Sep', 'Oct'].slice(0, values.length)}
      series={[{ key: 'cash', label: 'Cash', color: 'var(--color-chart-1)', values }]}
      formatValue={money}
      formatTick={(v) => String(v)}
    />
  );
}

describe('LineChart', () => {
  it('switches to a table of every month and back', () => {
    render(balance());
    expect(screen.getByRole('img', { name: 'Cash at the end of each month' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show table' }));
    const rows = screen.getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual([
      'MonthCash',
      'JulKD 1200.000',
      'AugKD 300.000',
      'SepKD -450.000',
      'OctKD 800.000',
    ]);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show chart' }));
    expect(screen.getByRole('img', { name: 'Cash at the end of each month' })).toBeInTheDocument();
  });

  it('draws values below zero under the zero line', () => {
    const { container } = render(balance([300, -450]));
    const zero = container.querySelector('line[data-zero]')!;
    const point = container.querySelector('circle[data-point="1"]')!;
    expect(Number(point.getAttribute('cy'))).toBeGreaterThan(Number(zero.getAttribute('y1')));
    // The axis reaches below the lowest value, and ticks show the sign.
    expect(screen.getByText('-600')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
  });

  it('shows the month in focus with every value', () => {
    const { container } = render(balance());
    fireEvent.focus(screen.getByRole('button', { name: 'Sep: Cash KD -450.000' }));
    expect(container.querySelector('[data-tooltip]')).toHaveTextContent('SepCashKD -450.000');
    expect(container.querySelectorAll('circle[data-point="2"]')).toHaveLength(1);
  });

  it('reads right to left in Arabic, with time still running left to right', () => {
    setDictionaryForTests('ar', {
      'Show table': 'عرض الجدول',
      Month: 'الشهر',
      '{label}: {values}': '{label}: {values}',
    });
    const { container } = render(
      <div dir="rtl">
        <LineChart
          title="النقد"
          labels={['يوليو', 'أغسطس']}
          series={[
            { key: 'in', label: 'الوارد', color: 'var(--color-chart-1)', values: [10, -5] },
            { key: 'out', label: 'الصادر', color: 'var(--color-chart-2)', values: [4, 6] },
          ]}
          formatValue={(v) => String(v)}
          formatTick={(v) => String(v)}
        />
      </div>,
    );
    // The plot keeps the order of the months; the tooltip and the list read in Arabic.
    expect(container.querySelector('svg[role="img"]')!.closest('[dir]')).toHaveAttribute(
      'dir',
      'ltr',
    );
    const target = screen.getByRole('button', { name: 'أغسطس: الوارد -5، الصادر 6' });
    fireEvent.focus(target);
    expect(container.querySelector('[data-tooltip]')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('list', { name: 'Legend' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'عرض الجدول' }));
    expect(screen.getByRole('columnheader', { name: 'الشهر' })).toBeInTheDocument();
  });
});

describe('niceRange', () => {
  it('always includes zero and rounds outwards', () => {
    expect(niceRange(120, 980)).toEqual({ bottom: 0, top: 1000, step: 250 });
    expect(niceRange(-450, 1200)).toEqual({ bottom: -500, top: 1500, step: 500 });
    expect(niceRange(-90, -10)).toEqual({ bottom: -100, top: 0, step: 25 });
    expect(niceRange(0, 0)).toEqual({ bottom: 0, top: 1, step: 0.25 });
  });
});

describe('BarList', () => {
  it('ranks bars by size with their values, and a table with each share', () => {
    render(
      <MemoryRouter>
        <BarList
          title="Top expenses"
          nameLabel="Account"
          rows={[
            { key: 'rent', label: 'Rent', value: 600, to: '/reports/general-ledger?account=rent' },
            { key: 'fuel', label: 'Fuel', value: 200 },
          ]}
          formatValue={money}
          formatShare={(s) => `${Math.round(s * 100)}%`}
        />
      </MemoryRouter>,
    );
    const list = screen.getByRole('list', { name: 'Top expenses' });
    expect(list).toHaveTextContent('RentKD 600.000FuelKD 200.000');
    expect(screen.getByRole('link', { name: /Rent/ })).toHaveAttribute(
      'href',
      '/reports/general-ledger?account=rent',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getAllByRole('row').map((r) => r.textContent)).toEqual([
      'AccountAmountShare',
      'RentKD 600.00075%',
      'FuelKD 200.00025%',
    ]);
  });
});
