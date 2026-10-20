import { describe, expect, it } from 'vitest';
import { createEmployee } from '@/db/people';
import type { LeaveRecord } from '@/db/types';
import {
  awayOn,
  comingUp,
  departments,
  directory,
  findContacts,
  newJoiners,
  toContact,
} from './directory';

// Made-up people.
const sara = createEmployee('c1', {
  id: 'e1',
  name: 'Sara Test',
  nameAr: 'سارة اختبار',
  jobTitle: 'Accountant',
  department: 'Finance',
  phone: '+965 5555 0101',
  email: 'sara@example.com',
  civilId: '290010100001',
  iban: 'KW00TEST0000000000000000000001',
  basicSalary: 1200,
  hireDate: '2020-01-01',
});
const omar = createEmployee('c1', {
  id: 'e2',
  name: 'Omar Sample',
  jobTitle: 'Driver',
  department: 'Logistics',
  hireDate: '2026-10-10',
  probationEnd: '2026-11-01',
});
const left = createEmployee('c1', { id: 'e3', name: 'Former Person', status: 'left' });
const fixed = createEmployee('c1', {
  id: 'e4',
  name: 'Ali Example',
  department: 'Finance',
  contractType: 'fixed',
  contractEnd: '2026-10-30',
  hireDate: '2025-01-01',
});

const leave = (over: Partial<LeaveRecord>): LeaveRecord => ({
  id: 'l1',
  companyId: 'c1',
  employeeId: 'e1',
  type: 'annual',
  kind: 'leave',
  start: '2026-10-15',
  end: '2026-10-20',
  days: 4,
  status: 'approved',
  notes: '',
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('the staff directory', () => {
  it('holds names, jobs and how to reach people, nothing of pay or papers', () => {
    const card = toContact(sara, false);
    expect(Object.keys(card).sort()).toEqual(
      [
        'department',
        'email',
        'id',
        'jobTitle',
        'jobTitleAr',
        'name',
        'nameAr',
        'onLeave',
        'phone',
        'photoId',
      ].sort(),
    );
    const text = JSON.stringify(card);
    expect(text).not.toContain('290010100001');
    expect(text).not.toContain('KW00TEST');
    expect(text).not.toContain('1200');
  });

  it('lists the current staff by name, and who is away', () => {
    const away = awayOn(
      [leave({}), leave({ id: 'l2', employeeId: 'e2', status: 'cancelled' })],
      '2026-10-17',
    );
    expect([...away.keys()]).toEqual(['e1']);
    const list = directory([sara, omar, left, fixed], away);
    expect(list.map((c) => c.name)).toEqual(['Ali Example', 'Omar Sample', 'Sara Test']);
    expect(list.find((c) => c.id === 'e1')?.onLeave).toBe(true);
    expect(awayOn([leave({})], '2026-10-21').size).toBe(0);
    expect(awayOn([leave({ kind: 'opening' })], '2026-10-17').size).toBe(0);
  });

  it('counts the departments', () => {
    expect(departments(directory([sara, omar, fixed]))).toEqual([
      { name: 'Finance', count: 2 },
      { name: 'Logistics', count: 1 },
    ]);
  });

  it('gives departments their Arabic names from the company’s list, keeping the English one', () => {
    const list = [{ id: 'd1', name: 'Finance', nameAr: 'المالية' }];
    const contacts = directory([sara, omar, fixed], new Map(), list);
    expect(contacts.find((c) => c.id === 'e1')).toMatchObject({
      department: 'Finance',
      departmentAr: 'المالية',
    });
    expect(contacts.find((c) => c.id === 'e2')).not.toHaveProperty('departmentAr');
    expect(departments(contacts)).toEqual([
      { name: 'Finance', nameAr: 'المالية', count: 2 },
      { name: 'Logistics', count: 1 },
    ]);
    expect(findContacts(contacts, 'المالية').map((c) => c.id)).toEqual(['e4', 'e1']);
  });

  it('finds people by name in either language, job, department or phone', () => {
    const list = directory([sara, omar, fixed]);
    const names = (q: string, d: string | null = null) => findContacts(list, q, d).map((c) => c.id);
    expect(names('sara')).toEqual(['e1']);
    expect(names('ساره')).toEqual(['e1']);
    expect(names('driver')).toEqual(['e2']);
    expect(names('55550101')).toEqual(['e1']);
    expect(names('5555 0101')).toEqual(['e1']);
    expect(names('', 'Finance')).toEqual(['e4', 'e1']);
    // Punctuation alone matches no phone number.
    expect(names('-')).toEqual([]);
    expect(names('nobody')).toEqual([]);
  });

  it('shows what comes up in the next month', () => {
    expect(comingUp([sara, omar, left, fixed], '2026-10-05')).toEqual([
      { employeeId: 'e2', kind: 'joined', date: '2026-10-10' },
      { employeeId: 'e4', kind: 'contract', date: '2026-10-30' },
      { employeeId: 'e2', kind: 'probation', date: '2026-11-01' },
    ]);
    expect(newJoiners([sara, omar, fixed], '2026-10-17').map((e) => e.id)).toEqual(['e2']);
  });
});
