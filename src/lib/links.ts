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

// A parameter's name, word by word: "api_key", "accessToken", "apikey".
const SECRET_WORD =
  /^(?:api|access|auth|client|private|secret|session)?(?:token|key|secret|password|pwd|signature)s?$/;

/**
 * Whether a web address carries what looks like a key in its parameters
 * (?token=…, #access_token=…). Links reach everyone in the company and every
 * backup, so a key in one is no longer a secret.
 */
export function hasSecretParameter(input: string): boolean {
  const href = normalizeLinkUrl(input);
  if (!href) return false;
  const { search, hash } = new URL(href);
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
