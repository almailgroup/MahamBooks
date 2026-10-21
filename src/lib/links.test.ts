import { describe, expect, it } from 'vitest';
import { APPS as SUITE_APPS } from '@/suite/apps';
import {
  LINK_PRESETS,
  PRESET_APPS,
  chosenElsewhereOnly,
  cleanLink,
  hasSecretParameter,
  linkApps,
  linkShowsIn,
  linkPreset,
  linkSections,
  normalizeLinkUrl,
  presetLink,
  sidebarLinks,
  toggleLinkApp,
} from './links';

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

const APPS = SUITE_APPS.map((app) => app.id as string);
const ids = (links: { id: string }[]) => links.map((link) => link.id);

describe('integrations and where links show', () => {
  it('add Deema, Taly and Tahseel with their names, under Integrations in Books and CRM', () => {
    expect(LINK_PRESETS.map((p) => [p.id, p.label, p.labelAr])).toEqual([
      ['deema', 'Deema', 'ديما'],
      ['taly', 'Taly', 'تالي'],
      // تحصيل already means collecting a cheque: the brand keeps its name.
      ['tahseel', 'Tahseel', ''],
    ]);
    for (const preset of LINK_PRESETS) {
      const link = presetLink(preset);
      expect(link).toMatchObject({
        label: preset.label,
        labelAr: preset.labelAr,
        url: '',
        section: 'integrations',
        preset: preset.id,
        apps: ['books', 'crm'],
      });
      expect(linkPreset(link.preset)).toBe(preset);
      // Nothing shows until the address is pasted.
      expect(sidebarLinks([link])).toEqual([]);
      const pasted = { ...link, url: 'portal.example.com/merchant' };
      expect(sidebarLinks([pasted], { open: ['books'], apps: APPS })).toEqual([
        { ...pasted, url: 'https://portal.example.com/merchant' },
      ]);
      expect(sidebarLinks([pasted], { open: ['people'], apps: APPS })).toEqual([]);
    }
    expect(PRESET_APPS.every((app) => APPS.includes(app))).toBe(true);
    expect(new Set(LINK_PRESETS.map((p) => presetLink(p).id)).size).toBe(3);
  });

  it('show a link in the apps chosen for it, or in every app', () => {
    const url = 'https://tasks.example.com/';
    const links = [
      { id: 'every', label: 'Every', url },
      { id: 'books', label: 'Books', url, apps: ['books'] },
      { id: 'two', label: 'Two', url, apps: ['people', 'compliance'] },
      // Chosen only for an app of a newer build, or for none: as builds before the choice.
      { id: 'newer', label: 'Newer', url, apps: ['inventory'] },
      { id: 'none', label: 'None', url, apps: [] },
    ];
    const inApp = (app: string) => ids(sidebarLinks(links, { open: [app], apps: APPS }));
    expect(inApp('books')).toEqual(['every', 'books', 'newer', 'none']);
    expect(inApp('people')).toEqual(['every', 'two', 'newer', 'none']);
    expect(inApp('crm')).toEqual(['every', 'newer', 'none']);
    // The home: the links of the apps someone may open.
    expect(ids(sidebarLinks(links, { open: ['books', 'crm'], apps: APPS }))).toEqual([
      'every',
      'books',
      'newer',
      'none',
    ]);
    // Without a place, every link (as before).
    expect(ids(sidebarLinks(links))).toEqual(ids(links));
    expect(linkApps({ apps: ['crm', 'inventory', 'books'] }, APPS)).toEqual(['books', 'crm']);
    expect(linkApps({}, APPS)).toEqual(APPS);
  });

  it('keep links without a section, or with one this build does not know, in the list', () => {
    const url = 'https://portal.example.com';
    const shown = sidebarLinks([
      { id: 'tasks', label: 'Tasks', url },
      { id: 'deema', label: 'Deema', url, section: 'integrations', preset: 'deema' },
      { id: 'later', label: 'Later', url, section: 'payments' as 'integrations' },
      { id: 'odd', label: 'Odd', url, section: 'integrations', preset: 'later' as 'deema' },
    ]);
    const { links, integrations } = linkSections(shown);
    expect(ids(links)).toEqual(['tasks', 'later']);
    expect(ids(integrations)).toEqual(['deema', 'odd']);
    expect(shown.find((l) => l.id === 'later')).not.toHaveProperty('section');
    // An integration this build doesn't know is ignored: the link stays a plain one.
    expect(shown.find((l) => l.id === 'odd')).not.toHaveProperty('preset');
    expect(shown.find((l) => l.id === 'deema')).toHaveProperty('preset', 'deema');
    expect(linkPreset('later')).toBeNull();
    expect(linkPreset(undefined)).toBeNull();
  });

  it('warn about keys and tokens in a web address', () => {
    for (const url of [
      'https://pay.example.com/?token=abc',
      'pay.example.com/portal?api_key=abc',
      'https://pay.example.com/?apiKey=abc',
      'https://pay.example.com/?x-api-key=abc',
      'https://pay.example.com/?ClientSecret=abc',
      'https://pay.example.com/#access_token=abc',
      'https://pay.example.com/?user=a&password=b',
      // A name and password in the address, and signed links and tokens.
      'https://admin:Secret123@portal.example.com/',
      'https://admin@portal.example.com/',
      'https://files.example.com/a.pdf?sv=2024&sig=abc',
      'https://pay.example.com/?auth=abc',
      'https://pay.example.com/?jwt=abc',
      'https://pay.example.com/?refreshToken=abc',
      'https://pay.example.com/?refreshtoken=abc',
      'https://pay.example.com/?otp=123456',
    ]) {
      expect(hasSecretParameter(url), url).toBe(true);
    }
    for (const url of [
      'https://pay.example.com/merchant',
      'https://pay.example.com/?keyword=invoices&lang=ar',
      'https://pay.example.com/?monkey=1',
      'https://pay.example.com/?author=me&signup=1&design=a',
      'https://pay.example.com/token/settings',
      'javascript:alert(1)?token=1',
      '',
    ]) {
      expect(hasSecretParameter(url), url).toBe(false);
    }
  });

  it('tick the apps a link really shows in, and keep a newer build’s choice', () => {
    const every = { apps: undefined };
    // Unticked then ticked again: every app, as before.
    const narrowed = toggleLinkApp(every, 'people', false, APPS);
    expect(narrowed).toEqual(APPS.filter((id) => id !== 'people'));
    expect(toggleLinkApp({ apps: narrowed }, 'people', true, APPS)).toBeUndefined();
    // Every app unticked: none chosen, which the form refuses.
    let apps: string[] | undefined = undefined;
    for (const id of APPS) apps = toggleLinkApp({ apps }, id, false, APPS);
    expect(apps).toEqual([]);
    expect(APPS.some((id) => linkShowsIn({ apps }, id, APPS))).toBe(false);
    // Ticked again from there: that app only.
    expect(toggleLinkApp({ apps: [] }, 'books', true, APPS)).toEqual(['books']);
    // Chosen only for a newer build's app: it shows in every app here, and the boxes say so.
    const newer = { apps: ['inventory'] };
    expect(chosenElsewhereOnly(newer, APPS)).toBe(true);
    expect(APPS.every((id) => linkShowsIn(newer, id, APPS))).toBe(true);
    // The first box unticked narrows from every app here, and keeps the newer build's choice.
    expect(toggleLinkApp(newer, 'books', false, APPS)).toEqual([
      ...APPS.filter((id) => id !== 'books'),
      'inventory',
    ]);
    // Every app here ticked with a newer build's app kept: the list stays, so what it left out stays out.
    expect(toggleLinkApp({ apps: ['books', 'inventory'] }, 'crm', true, APPS)).toEqual([
      'books',
      'crm',
      'inventory',
    ]);
    const all = APPS.filter((id) => id !== 'crm');
    expect(toggleLinkApp({ apps: [...all, 'sales'] }, 'crm', true, APPS)).toEqual([
      ...APPS,
      'sales',
    ]);
    expect(chosenElsewhereOnly({ apps: ['books', 'inventory'] }, APPS)).toBe(false);
    expect(chosenElsewhereOnly({}, APPS)).toBe(false);
  });

  it('keep a link’s section and apps, and leave out a choice set back', () => {
    const base = { id: 'l', label: ' Deema ', labelAr: ' ديما ', url: 'pay.example.com' };
    expect(cleanLink({ ...base, preset: 'deema', section: 'payments' as 'integrations' })).toEqual({
      id: 'l',
      label: 'Deema',
      labelAr: 'ديما',
      url: 'https://pay.example.com/',
      preset: 'deema',
      section: 'payments',
    });
    const kept = cleanLink({ ...base, apps: ['books', 'inventory'] });
    expect(kept.apps).toEqual(['books', 'inventory']);
    const reset = cleanLink({ ...base, section: undefined, apps: undefined });
    expect(reset).not.toHaveProperty('section');
    expect(reset).not.toHaveProperty('apps');
  });
});
