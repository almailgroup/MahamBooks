import { describe, expect, it } from 'vitest';
import type { Department } from '@/db/types';
import {
  departmentChoices,
  departmentHeadcounts,
  departmentLabel,
  findDepartment,
  hasDepartmentList,
  normalizeDepartments,
  unlistedDepartments,
} from './departments';

const LIST: Department[] = [
  { id: 'd1', name: 'Security', nameAr: 'الأمن' },
  { id: 'd2', name: 'Head Office', nameAr: 'الإدارة' },
  { id: 'd3', name: 'Cleaning', nameAr: '', archived: true },
];

describe('departments', () => {
  it('are tidied when saved: no empty names, no repeats', () => {
    expect(
      normalizeDepartments([
        { id: 'a', name: '  Head   Office ', nameAr: ' الإدارة ' },
        { id: 'b', name: 'head office', nameAr: '' },
        { id: 'c', name: '', nameAr: 'المخزن' },
        { id: '', name: 'No id', nameAr: '' },
        { id: 'd', name: 'Drivers', nameAr: '', archived: false },
        null,
        'Security',
      ]),
    ).toEqual([
      { id: 'a', name: 'Head Office', nameAr: 'الإدارة' },
      { id: 'c', name: 'المخزن', nameAr: 'المخزن' },
      { id: 'd', name: 'Drivers', nameAr: '' },
    ]);
    expect(normalizeDepartments(undefined)).toEqual([]);
    expect(hasDepartmentList(undefined)).toBe(false);
    expect(hasDepartmentList([])).toBe(false);
    expect(hasDepartmentList(LIST)).toBe(true);
  });

  it('are found by their English or Arabic name, whatever the case and spaces', () => {
    expect(findDepartment(LIST, ' security ')?.id).toBe('d1');
    expect(findDepartment(LIST, 'الأمن')?.id).toBe('d1');
    expect(findDepartment(LIST, 'Warehouse')).toBeUndefined();
    expect(findDepartment(undefined, 'Security')).toBeUndefined();
  });

  it('show their Arabic name in Arabic and keep any other name as it is', () => {
    expect(departmentLabel(LIST, 'Security', 'ar')).toBe('الأمن');
    expect(departmentLabel(LIST, 'Security', 'en')).toBe('Security');
    expect(departmentLabel(LIST, 'Cleaning', 'ar')).toBe('Cleaning');
    expect(departmentLabel(LIST, ' Warehouse ', 'ar')).toBe('Warehouse');
    expect(departmentLabel(undefined, 'Security', 'ar')).toBe('Security');
  });

  it('offer the departments not archived, by name in the language', () => {
    expect(departmentChoices(LIST, 'en').map((d) => d.id)).toEqual(['d2', 'd1']);
    expect(departmentChoices(LIST, 'ar').map((d) => d.id)).toEqual(['d2', 'd1']);
  });

  it('count the employees in each and find the names that are not in the list', () => {
    const employees = [
      { department: 'Security' },
      { department: 'security ' },
      { department: 'الأمن' },
      { department: 'Securty' },
      { department: 'Securty' },
      { department: 'Cleaning' },
      { department: '' },
    ];
    expect(departmentHeadcounts(LIST, employees)).toEqual(
      new Map([
        ['d1', 2],
        ['d3', 1],
      ]),
    );
    expect(unlistedDepartments(LIST, employees)).toEqual([
      { name: 'Securty', count: 2 },
      { name: 'الأمن', count: 1 },
    ]);
    expect(unlistedDepartments(undefined, employees)).toEqual([
      { name: 'Security', count: 2 },
      { name: 'Securty', count: 2 },
      { name: 'Cleaning', count: 1 },
      { name: 'الأمن', count: 1 },
    ]);
  });
});
