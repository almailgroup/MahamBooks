import { mailtoLink } from '@/lib/email';
import { whatsappUrl } from '@/lib/whatsapp';
import { isMemberRole, type MemberRole } from './roles';

/**
 * Invitation links: #/invite/{token}, with a short description (company,
 * who invites, the invited address and role) so the invitee sees what it is
 * before signing in. The description is only shown: joining checks the
 * token, the address and the expiry in the database.
 */

export interface InviteHint {
  company?: string;
  by?: string;
  email?: string;
  role?: MemberRole;
}

const TOKEN = /^[0-9a-f]{48,128}$/;

function encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(text: string): string {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** The app's address without its route (where links point). */
export function appBase(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export function inviteUrl(token: string, hint: InviteHint, base = appBase()): string {
  const clean: InviteHint = {};
  if (hint.company) clean.company = hint.company.slice(0, 120);
  if (hint.by) clean.by = hint.by.slice(0, 120);
  if (hint.email) clean.email = hint.email;
  if (hint.role) clean.role = hint.role;
  return `${base}#/invite/${token}?i=${encode(JSON.stringify(clean))}`;
}

export function isInviteToken(value: string | undefined): value is string {
  return Boolean(value && TOKEN.test(value));
}

/** The description in an invitation link's query (?i=…); empty when missing or damaged. */
export function parseInviteHint(search: string): InviteHint {
  const raw = new URLSearchParams(search).get('i');
  if (!raw) return {};
  try {
    const data = JSON.parse(decode(raw)) as Record<string, unknown>;
    const text = (value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : undefined;
    return {
      company: text(data.company),
      by: text(data.by),
      email: text(data.email),
      role: isMemberRole(data.role) && data.role !== 'owner' ? data.role : undefined,
    };
  } catch {
    return {};
  }
}

/** Token and description from a pasted link (full address or just the #/invite/… part). */
export function parseInviteLink(text: string): { token: string; hint: InviteHint } | null {
  const match = /#?\/invite\/([0-9a-f]+)(\?[^#\s]*)?/.exec(text.trim());
  if (!match || !isInviteToken(match[1])) return null;
  return { token: match[1], hint: parseInviteHint(match[2] ?? '') };
}

/** A WhatsApp message with the link, ready to send. */
export function whatsappInvite(url: string, message: string): string {
  return whatsappUrl(null, `${message}\n${url}`);
}

/** An email with the link, opened in the person's mail app. */
export function emailInvite(to: string, subject: string, message: string, url: string): string {
  return mailtoLink({ to: [to], subject, body: `${message}\n\n${url}` });
}
