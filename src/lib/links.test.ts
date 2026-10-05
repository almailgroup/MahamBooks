import { describe, expect, it } from 'vitest';
import { normalizeLinkUrl, sidebarLinks } from './links';

describe('sidebar links', () => {
  it('keep web addresses only, with https added when missing', () => {
    expect(normalizeLinkUrl('https://tasks.example.com/')).toBe('https://tasks.example.com/');
    expect(normalizeLinkUrl('  tasks.example.com/board ')).toBe('https://tasks.example.com/board');
    expect(normalizeLinkUrl('http://192.168.1.20:8080')).toBe('http://192.168.1.20:8080/');
    expect(normalizeLinkUrl('http://localhost:3000')).toBe('http://localhost:3000/');
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('JavaScript:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('data:text/html,<b>hi</b>')).toBeNull();
    expect(normalizeLinkUrl('mailto:someone@example.com')).toBeNull();
    expect(normalizeLinkUrl('tasks')).toBeNull();
    expect(normalizeLinkUrl('tasks example.com')).toBeNull();
    expect(normalizeLinkUrl('')).toBeNull();
  });

  it('show only links with a name and a web address', () => {
    expect(
      sidebarLinks([
        { id: 'a', label: ' Tasks ', url: 'tasks.example.com' },
        { id: 'b', label: '', url: 'https://hr.example.com' },
        { id: 'c', label: 'Bad', url: 'javascript:alert(1)' },
      ]),
    ).toEqual([{ id: 'a', label: 'Tasks', url: 'https://tasks.example.com/' }]);
    expect(sidebarLinks(undefined)).toEqual([]);
  });
});
