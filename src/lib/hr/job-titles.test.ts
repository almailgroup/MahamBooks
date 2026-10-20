import { describe, expect, it } from 'vitest';
import { arabicJobTitle, englishJobTitle, isDriverTitle } from './job-titles';

const titles = (jobTitle: string, jobTitleAr = '', pamJobTitle = '') => ({
  jobTitle,
  jobTitleAr,
  pamJobTitle,
});

describe('job titles', () => {
  it('fills in the other language of a common title', () => {
    expect(arabicJobTitle('heavy  driver')).toBe('سائق مركبة ثقيلة');
    expect(englishJobTitle('سائق حافلة')).toBe('Bus Driver');
    expect(arabicJobTitle('Astronaut')).toBe('');
  });
});

describe('driver titles', () => {
  it('reads Driver, HEAVY DRIVER and سائق حافلة as drivers', () => {
    expect(isDriverTitle(titles('Driver'))).toBe(true);
    expect(isDriverTitle(titles('HEAVY DRIVER'))).toBe(true);
    expect(isDriverTitle(titles('', 'سائق حافلة'))).toBe(true);
    expect(isDriverTitle(titles('Light Driver'))).toBe(true);
    expect(isDriverTitle(titles('Truck Driver'))).toBe(true);
  });

  it('counts valet drivers and any Arabic title with سائق, with or without the article', () => {
    expect(isDriverTitle(titles('Valet Driver'))).toBe(true);
    expect(isDriverTitle(titles('', 'السائق الخاص'))).toBe(true);
    expect(isDriverTitle(titles('', 'سايق'))).toBe(true);
    expect(isDriverTitle(titles('Delivery Driver / Messenger'))).toBe(true);
  });

  it('reads the title on the work permit too', () => {
    expect(isDriverTitle(titles('Messenger', 'مراسل', 'سائق خفيف'))).toBe(true);
  });

  it('leaves out guards, valets who park cars and words that only contain "driver"', () => {
    expect(isDriverTitle(titles('Security Guard', 'حارس أمن'))).toBe(false);
    expect(isDriverTitle(titles('Valet', 'عامل صف سيارات'))).toBe(false);
    expect(isDriverTitle(titles('Valet Parking'))).toBe(false);
    expect(isDriverTitle(titles('Screwdriver Operator'))).toBe(false);
    expect(isDriverTitle(titles(''))).toBe(false);
  });
});
