import { describe, expect, it } from 'vitest';
import {
  emailInvite,
  inviteUrl,
  isInviteToken,
  parseInviteHint,
  parseInviteLink,
  whatsappInvite,
} from './invite';

const TOKEN = 'ab12'.repeat(16);
const BASE = 'https://almail-books.vercel.app/';

describe('invitation links', () => {
  it('carry the token and a description, Arabic included', () => {
    const url = inviteUrl(
      TOKEN,
      {
        company: 'شركة الميل للتجارة',
        by: 'Fatima Al-Sabah',
        email: 'yousef@example.com',
        role: 'accountant',
      },
      BASE,
    );
    expect(url.startsWith(`${BASE}#/invite/${TOKEN}?i=`)).toBe(true);
    // base64url: nothing a chat app or mail client would break.
    expect(url.split('?i=')[1]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parseInviteLink(url)).toEqual({
      token: TOKEN,
      hint: {
        company: 'شركة الميل للتجارة',
        by: 'Fatima Al-Sabah',
        email: 'yousef@example.com',
        role: 'accountant',
      },
    });
  });

  it('are read from a pasted address or just the #/invite part', () => {
    expect(parseInviteLink(`  #/invite/${TOKEN}  `)).toEqual({ token: TOKEN, hint: {} });
    expect(parseInviteLink(`/invite/${TOKEN}`)?.token).toBe(TOKEN);
    expect(parseInviteLink(`${BASE}#/invite/${TOKEN}?i=`)?.hint).toEqual({});
  });

  it('refuse tokens that could not have come from the server', () => {
    expect(isInviteToken(TOKEN)).toBe(true);
    expect(isInviteToken('ab12')).toBe(false);
    expect(isInviteToken(TOKEN.toUpperCase())).toBe(false);
    expect(isInviteToken(undefined)).toBe(false);
    expect(parseInviteLink('#/invite/1234')).toBeNull();
    expect(parseInviteLink(`#/invite/${TOKEN.toUpperCase()}`)).toBeNull();
    expect(parseInviteLink('https://example.com/')).toBeNull();
  });

  it('ignore a damaged description, and never describe an invitation as owner', () => {
    expect(parseInviteLink(`#/invite/${TOKEN}?i=%%%not-base64`)).toEqual({
      token: TOKEN,
      hint: {},
    });
    const claim = (role: string) =>
      parseInviteHint(`?i=${inviteUrl(TOKEN, { role: role as never }, BASE).split('?i=')[1]}`);
    expect(claim('owner').role).toBeUndefined();
    expect(claim('superuser').role).toBeUndefined();
    expect(claim('viewer').role).toBe('viewer');
    const long = parseInviteLink(inviteUrl(TOKEN, { company: 'x'.repeat(500) }, BASE));
    expect(long?.hint.company).toHaveLength(120);
  });

  it('are shared by WhatsApp or email with the message', () => {
    const url = `${BASE}#/invite/${TOKEN}`;
    const whatsapp = whatsappInvite(url, 'Join Al Mail Trading on Maham Books as Staff:');
    expect(whatsapp.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(whatsapp.split('?text=')[1])).toBe(
      `Join Al Mail Trading on Maham Books as Staff:\n${url}`,
    );
    const email = emailInvite('rajesh@example.com', 'Invitation to Al Mail Trading', 'Join', url);
    expect(email.startsWith('mailto:rajesh%40example.com?subject=Invitation%20to')).toBe(true);
    expect(decodeURIComponent(email.split('body=')[1])).toBe(`Join\r\n\r\n${url}`);
  });
});
