import { describe, expect, it } from 'vitest';
import { BLUE_INK, inkBounds, inkPixels, isBlueInk, paperThreshold } from './image';

/** RGBA pixels from [r, g, b, a] tuples. */
const pixels = (...list: [number, number, number, number][]) => new Uint8ClampedArray(list.flat());

/** [r, g, b, a] of the pixel at `index`. */
const at = (data: Uint8ClampedArray, index: number) =>
  Array.from(data.slice(index * 4, index * 4 + 4));

const [R, G, B] = BLUE_INK;

describe('inkPixels', () => {
  it('turns black strokes blue and white paper transparent', () => {
    const out = inkPixels(
      pixels([0, 0, 0, 255], [255, 255, 255, 255], [20, 20, 30, 255]),
      'blue',
      0.8,
    );
    expect(at(out, 0)).toEqual([R, G, B, 255]);
    expect(at(out, 1)[3]).toBe(0);
    expect(at(out, 2)).toEqual([R, G, B, 255]);
  });

  it('keeps soft edges partly transparent, lighter ones more so', () => {
    const out = inkPixels(pixels([128, 128, 128, 255], [170, 170, 170, 255]), 'blue', 0.8);
    const [dark, light] = [at(out, 0)[3], at(out, 1)[3]];
    expect(dark).toBeGreaterThan(0);
    expect(dark).toBeLessThan(255);
    expect(light).toBeGreaterThan(0);
    expect(light).toBeLessThan(dark);
    expect(at(out, 0).slice(0, 3)).toEqual([R, G, B]);
  });

  it('keeps what was transparent transparent', () => {
    const out = inkPixels(pixels([0, 0, 0, 0], [0, 0, 0, 128]), 'blue', 0.8);
    expect(at(out, 0)[3]).toBe(0);
    expect(at(out, 1)).toEqual([R, G, B, 128]);
  });

  it('leaves the original ink as it is, in a new array', () => {
    const data = pixels([0, 0, 0, 255], [255, 255, 255, 255]);
    const out = inkPixels(data, 'original');
    expect(out).toEqual(data);
    expect(out).not.toBe(data);
  });

  it('reads the paper of a photo, so a grey sheet goes too', () => {
    // A photographed sheet: mostly grey paper, a few dark strokes.
    const paper: [number, number, number, number] = [180, 180, 175, 255];
    const stroke: [number, number, number, number] = [40, 40, 50, 255];
    const data = pixels(
      ...Array<typeof paper>(30).fill(paper),
      ...Array<typeof stroke>(5).fill(stroke),
    );
    const threshold = paperThreshold(data);
    expect(threshold).toBeLessThan(180 / 255);
    const out = inkPixels(data, 'blue');
    expect(at(out, 0)[3]).toBe(0);
    expect(at(out, 34)).toEqual([R, G, B, 255]);
    // White paper: anything clearly lighter than the strokes goes.
    const white = pixels(...Array<typeof paper>(30).fill([255, 255, 255, 255]), stroke);
    expect(paperThreshold(white)).toBeCloseTo(0.9);
  });

  it('takes a picture with a transparent background as it is', () => {
    const data = pixels(
      ...Array<[number, number, number, number]>(10).fill([0, 0, 0, 0]),
      [10, 10, 10, 255],
    );
    expect(paperThreshold(data)).toBe(0.8);
    expect(at(inkPixels(data, 'blue'), 10)).toEqual([R, G, B, 255]);
  });
});

describe('isBlueInk', () => {
  it('tells a blue signature from one replaced elsewhere', () => {
    const blue = inkPixels(pixels([0, 0, 0, 255], [255, 255, 255, 255]), 'blue', 0.8);
    expect(isBlueInk(blue)).toBe(true);
    expect(isBlueInk(pixels([0, 0, 0, 255], [255, 255, 255, 255]))).toBe(false);
    // Nothing visible is not a blue signature either.
    expect(isBlueInk(pixels([R, G, B, 0]))).toBe(false);
    // Faint edges lose their exact colour in a PNG.
    expect(isBlueInk(pixels([R, G, B, 255], [0, 0, 0, 20]))).toBe(true);
  });
});

describe('inkBounds', () => {
  it('finds what is drawn, with a margin that stays on the canvas', () => {
    // 4 × 3, with ink at (1, 1) and (2, 1).
    const data = new Uint8ClampedArray(4 * 3 * 4);
    data[(1 * 4 + 1) * 4 + 3] = 255;
    data[(1 * 4 + 2) * 4 + 3] = 40;
    expect(inkBounds(data, 4, 3)).toEqual({ x: 1, y: 1, width: 2, height: 1 });
    expect(inkBounds(data, 4, 3, 5)).toEqual({ x: 0, y: 0, width: 4, height: 3 });
    expect(inkBounds(new Uint8ClampedArray(4 * 3 * 4), 4, 3)).toBeNull();
  });
});
