import type { CompanyLink } from '@/db/types';

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

/**
 * The company's links that can be shown: a name and a web address each.
 * Checked again here because links also arrive from other devices.
 */
export function sidebarLinks(links: CompanyLink[] | undefined): CompanyLink[] {
  return (links ?? []).flatMap((link) => {
    const url = normalizeLinkUrl(link.url ?? '');
    const label = (link.label ?? '').trim();
    return url && label ? [{ ...link, label, url }] : [];
  });
}
