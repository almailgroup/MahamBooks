import { describe, expect, it } from 'vitest';
import { fontStack, mirrorStyle } from './primitives';

describe('mirrorStyle', () => {
  it('swaps sides, rows and alignment for right-to-left documents', () => {
    expect(
      mirrorStyle({
        flexDirection: 'row',
        marginLeft: 4,
        paddingRight: 12,
        borderLeftWidth: 1,
        borderLeftColor: '#000',
        borderTopLeftRadius: 6,
        left: 40,
        textAlign: 'right',
      }),
    ).toEqual({
      flexDirection: 'row-reverse',
      marginRight: 4,
      paddingLeft: 12,
      borderRightWidth: 1,
      borderRightColor: '#000',
      borderTopRightRadius: 6,
      right: 40,
      textAlign: 'left',
    });
  });

  it('flips cross-axis alignment in columns only', () => {
    expect(mirrorStyle({ alignItems: 'flex-end' }).alignItems).toBe('flex-start');
    expect(mirrorStyle({ flexDirection: 'row', alignItems: 'flex-end' }).alignItems).toBe(
      'flex-end',
    );
    expect(mirrorStyle({ alignSelf: 'flex-start' }).alignSelf).toBe('flex-end');
    expect(mirrorStyle({ alignSelf: 'flex-start' }, true).alignSelf).toBe('flex-start');
  });

  it('turns rotations and image positions the other way', () => {
    expect(mirrorStyle({ transform: 'rotate(-10deg)' }).transform).toBe('rotate(10deg)');
    expect(mirrorStyle({ objectPositionX: 0 }).objectPositionX).toBe('100%');
  });
});

describe('fontStack', () => {
  it('puts the Arabic font first for Arabic text', () => {
    expect(fontStack(['Inter', 'IBM Plex Sans Arabic'], true)).toEqual([
      'IBM Plex Sans Arabic',
      'Inter',
    ]);
    expect(fontStack('Inter', false)).toEqual(['Inter', 'IBM Plex Sans Arabic']);
  });
});
