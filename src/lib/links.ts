import type { CompanyLink, LinkPresetId } from '@/db/types';
import { newId } from '@/lib/ids';

/** Most links a company can put in the sidebar. */
export const MAX_LINKS = 8;

/**
 * A web address as kept: "https://" added when it has no scheme. Null unless
 * it is an http or https address with a host name, so nothing but a web
 * page (no "javascript:" or "data:" address) can be opened from the sidebar.
 */
export function normalizeLinkUrl(input: string): string | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
  return url.href;
}

// A parameter's name, word by word: "api_key", "accessToken", "apikey", and
// the names signed links and tokens go by ("sig", "jwt").
const SECRET_WORD =
  /^(?:(?:api|access|auth|client|private|secret|session|refresh|id)?(?:token|key|secret|password|passwd|pwd|signature)s?|sig|sas|auth|jwt|bearer|otp)$/;

/**
 * Whether a web address carries what looks like a key: a name and password
 * in the address itself (https://name:password@…), or in its parameters
 * (?token=…, #access_token=…, ?sig=…). Links reach everyone in the company
 * and every backup, so a key in one is no longer a secret.
 */
export function hasSecretParameter(input: string): boolean {
  const href = normalizeLinkUrl(input);
  if (!href) return false;
  const { search, hash, username, password } = new URL(href);
  if (username || password) return true;
  const names = [search, hash].flatMap((part) => [
    ...new URLSearchParams(part.replace(/^[?#]/, '')).keys(),
  ]);
  return names.some((name) =>
    name
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((word) => SECRET_WORD.test(word)),
  );
}

export interface LinkPreset {
  id: LinkPresetId;
  /** The brand's name. */
  label: string;
  /** Its name in Arabic; empty where the brand keeps its own name. */
  labelAr: string;
}

/**
 * The integrations Settings → Links adds with their names filled in; the
 * owner pastes the address of their portal. Tahseel keeps its brand name in
 * Arabic: تحصيل already means collecting a cheque in the books.
 */
export const LINK_PRESETS: readonly LinkPreset[] = [
  { id: 'deema', label: 'Deema', labelAr: 'ديما' },
  { id: 'taly', label: 'Taly', labelAr: 'تالي' },
  { id: 'tahseel', label: 'Tahseel', labelAr: '' },
];

/** The integration a link was added as; null for none or one this build doesn't know. */
export function linkPreset(id: unknown): LinkPreset | null {
  return LINK_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** Where an integration shows at first: Maham Books (finance) and Maham CRM (sales). */
export const PRESET_APPS: readonly string[] = ['books', 'crm'];

/** A new link for an integration: its names filled in, its address left to paste. */
export function presetLink(preset: LinkPreset): CompanyLink {
  return {
    id: newId(),
    label: preset.label,
    labelAr: preset.labelAr,
    url: '',
    section: 'integrations',
    preset: preset.id,
    apps: [...PRESET_APPS],
  };
}

/**
 * The apps a link shows in, of the apps this build has: every one unless
 * some were chosen. A link chosen only for apps this build doesn't have (a
 * newer build's) shows in every app, as it does in builds before the choice.
 */
export function linkApps(link: Pick<CompanyLink, 'apps'>, apps: readonly string[]): string[] {
  const chosen = Array.isArray(link.apps) ? apps.filter((id) => link.apps!.includes(id)) : [];
  return chosen.length ? chosen : [...apps];
}

/** The apps whose Show in box is ticked: where the link shows, or none while none is chosen. */
const tickedApps = (link: Pick<CompanyLink, 'apps'>, apps: readonly string[]) =>
  // Every box unticked (which the form refuses): none.
  Array.isArray(link.apps) && link.apps.length === 0 ? [] : linkApps(link, apps);

/** Whether an app's sidebar shows the link, as linkApps decides: what its Show in box says. */
export function linkShowsIn(
  link: Pick<CompanyLink, 'apps'>,
  app: string,
  apps: readonly string[],
): boolean {
  return tickedApps(link, apps).includes(app);
}

/** The link was chosen only for apps this build doesn't have (a newer build's): it shows in every app here. */
export function chosenElsewhereOnly(
  link: Pick<CompanyLink, 'apps'>,
  apps: readonly string[],
): boolean {
  return (
    Array.isArray(link.apps) && link.apps.length > 0 && !link.apps.some((id) => apps.includes(id))
  );
}

/**
 * The apps chosen once one of this build's `apps` is ticked or unticked,
 * from where the link shows now. A newer build's apps chosen stay chosen;
 * missing again (every app) when every app here is ticked and no newer
 * build's choice is kept. Unticking every app here leaves none chosen.
 */
export function toggleLinkApp(
  link: Pick<CompanyLink, 'apps'>,
  app: string,
  on: boolean,
  apps: readonly string[],
): string[] | undefined {
  const newer = Array.isArray(link.apps) ? link.apps.filter((id) => !apps.includes(id)) : [];
  const shown = tickedApps(link, apps);
  const next = on ? [...shown, app] : shown.filter((id) => id !== app);
  const here = apps.filter((id) => next.includes(id));
  if (here.length === 0) return [];
  if (here.length === apps.length && newer.length === 0) return undefined;
  // This build's apps in their order, then those of a newer build.
  return [...here, ...newer];
}

/**
 * The link as kept: trimmed names and the full address. A choice set back
 * to today's (the list of links, every app) is left out; what a newer
 * build wrote and this one doesn't show stays.
 */
export function cleanLink({ section, apps, ...link }: CompanyLink): CompanyLink {
  return {
    ...link,
    label: link.label.trim(),
    labelAr: link.labelAr?.trim() ?? '',
    url: normalizeLinkUrl(link.url) ?? link.url,
    ...(section !== undefined ? { section } : {}),
    ...(apps !== undefined ? { apps } : {}),
  };
}

/** Where links show: the sidebar of one app, or the home for the apps someone may open. */
export interface LinkPlace {
  /** The apps of the place. */
  open: readonly string[];
  /** Every app this build has. */
  apps: readonly string[];
}

/**
 * The company's links that can be shown: a name and a web address each, and
 * in a place, those chosen for one of its apps. Checked again here because
 * links also arrive from other devices: a section or an integration this
 * build doesn't know is dropped, so the link shows in the list of links.
 */
export function sidebarLinks(links: CompanyLink[] | undefined, place?: LinkPlace): CompanyLink[] {
  return (links ?? []).flatMap((link) => {
    const url = normalizeLinkUrl(link.url ?? '');
    const label = (link.label ?? '').trim();
    if (!url || !label) return [];
    if (place && !linkApps(link, place.apps).some((id) => place.open.includes(id))) return [];
    const { section, preset, ...rest } = link;
    return [
      {
        ...rest,
        label,
        url,
        ...(section === 'integrations' ? { section } : {}),
        ...(linkPreset(preset) ? { preset } : {}),
      },
    ];
  });
}

/** The sidebar's list of links and those under Integrations, each in its order. */
export function linkSections(links: readonly CompanyLink[]): {
  links: CompanyLink[];
  integrations: CompanyLink[];
} {
  return {
    links: links.filter((link) => link.section !== 'integrations'),
    integrations: links.filter((link) => link.section === 'integrations'),
  };
}
