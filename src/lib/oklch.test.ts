import { describe, expect, it } from 'vitest';
import colors from 'tailwindcss/colors';
import { adjust, contrast, formatOklch, luminance, mix, over, parseColor, toHex } from './oklch';

describe('parseColor', () => {
  it('reads Tailwind OKLCH, including greys with no hue', () => {
    const slate = parseColor('oklch(55.4% 0.046 257.417)');
    expect(slate.l).toBeCloseTo(0.554, 6);
    expect(slate.c).toBe(0.046);
    expect(slate.h).toBe(257.417);
    expect(parseColor('oklch(98.5% 0 none)')).toEqual({ l: 0.985, c: 0, h: 0 });
    expect(parseColor('oklch(0.5 0.1 120)')).toEqual({ l: 0.5, c: 0.1, h: 120 });
  });

  it('reads hex colours', () => {
    const white = parseColor('#fff');
    expect(white.l).toBeCloseTo(1, 4);
    expect(white.c).toBeCloseTo(0, 4);
  });

  it('refuses anything else', () => {
    expect(() => parseColor('red')).toThrow();
    expect(() => parseColor('var(--color-slate-50)')).toThrow();
  });
});

describe('toHex', () => {
  it('matches the hex Tailwind writes for its palette', () => {
    expect(toHex(colors.slate[50])).toBe('#f8fafc');
    expect(toHex(colors.slate[500])).toBe('#62748e');
    expect(toHex(colors.slate[900])).toBe('#0f172b');
    expect(toHex(colors.indigo[600])).toBe('#4f39f6');
  });

  it('clips colours outside sRGB, close to what a browser shows', () => {
    // Tailwind's own fallback for red-700 is #bf000f.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(toHex(colors.red[700]).slice(i, i + 2), 16));
    expect(Math.abs(r - 0xbf)).toBeLessThanOrEqual(3);
    expect(g).toBeLessThanOrEqual(3);
    expect(Math.abs(b - 0x0f)).toBeLessThanOrEqual(10);
  });

  it('round-trips through OKLCH', () => {
    for (const hex of ['#eff1f6', '#0f172b', '#2a78d6', '#eb6834']) {
      expect(toHex(formatOklch(parseColor(hex)))).toBe(hex);
    }
  });
});

describe('contrast', () => {
  it('follows WCAG', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
    // Classic's muted text on white.
    expect(contrast(colors.slate[500], '#ffffff')).toBeCloseTo(4.77, 1);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('mix, adjust and over', () => {
  it('mixes in OKLab from one end to the other', () => {
    expect(toHex(mix('#000000', '#ffffff', 0))).toBe('#000000');
    expect(toHex(mix('#000000', '#ffffff', 1))).toBe('#ffffff');
    expect(parseColor(mix('#000000', '#ffffff', 0.5)).l).toBeCloseTo(0.5, 3);
  });

  it('changes one part of a colour', () => {
    expect(parseColor(adjust(colors.indigo[600], { l: 0.3 })).l).toBeCloseTo(0.3, 4);
  });

  it('composites a translucent colour as the browser does', () => {
    expect(over('#000000', 0.5, '#ffffff')).toBe('#808080');
    expect(over('#ffffff', 0, '#123456')).toBe('#123456');
  });
});
