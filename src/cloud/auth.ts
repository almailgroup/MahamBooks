import type { AuthError, User } from '@supabase/supabase-js';
import { msg, t, type Language } from '@/i18n';
import { appUrl, getSupabase } from './client';

/** The signed-in person. */
export interface CloudUser {
  id: string;
  email: string;
  fullName: string;
  language: Language;
}

export function toCloudUser(user: User, profile?: Partial<Profile> | null): CloudUser {
  const meta = (user.user_metadata ?? {}) as { full_name?: string; language?: string };
  const language = profile?.language ?? meta.language;
  return {
    id: user.id,
    email: user.email ?? '',
    fullName: profile?.fullName || meta.full_name || '',
    language: language === 'ar' ? 'ar' : 'en',
  };
}

export interface Profile {
  fullName: string;
  language: Language;
  email: string;
}

/** Thrown for what the person can fix: wrong password, unconfirmed email… */
export class AuthProblem extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AuthProblem';
  }
}

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: msg('Wrong email or password.'),
  email_not_confirmed: msg('Confirm your email address first: open the link we sent you.'),
  user_already_exists: msg('There is already an account with this email. Sign in instead.'),
  email_exists: msg('There is already an account with this email. Sign in instead.'),
  weak_password: msg('Choose a stronger password: at least 8 characters.'),
  same_password: msg('Choose a password you have not used here before.'),
  over_email_send_rate_limit: msg('Too many emails were sent. Wait a few minutes and try again.'),
  over_request_rate_limit: msg('Too many attempts. Wait a few minutes and try again.'),
  signup_disabled: msg('New accounts are not open right now.'),
  email_address_invalid: msg('Check the email address.'),
  validation_failed: msg('Check the email address and password.'),
  session_not_found: msg('Your session has ended. Sign in again.'),
  otp_expired: msg('This link has expired. Ask for a new one.'),
  flow_state_expired: msg('This link has expired. Ask for a new one.'),
  bad_code_verifier: msg('Open the link on the device where you asked for it, or sign in here.'),
};

function problem(error: AuthError | Error | null | undefined): AuthProblem {
  const code = (error as AuthError | undefined)?.code ?? '';
  const text = AUTH_MESSAGES[code];
  if (text) return new AuthProblem(t(text), code);
  const message = error?.message ?? '';
  if (/fetch|network/i.test(message) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return new AuthProblem(t('No connection. Check your internet and try again.'), 'offline');
  }
  if (/code verifier/i.test(message)) {
    return new AuthProblem(t(AUTH_MESSAGES.bad_code_verifier), 'bad_code_verifier');
  }
  return new AuthProblem(t('Something went wrong. Try again in a moment.'), code || 'unknown');
}

export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
  language: Language;
  /** Screen to open from the confirmation link. */
  next?: string;
}

/** Creates an account. Returns whether the email has to be confirmed first. */
export async function signUp(input: SignUpInput): Promise<{ confirm: boolean }> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      emailRedirectTo: appUrl(input.next ?? '/auth/callback'),
      data: { full_name: input.fullName.trim(), language: input.language },
    },
  });
  if (error) throw problem(error);
  return { confirm: !data.session };
}

export async function resendConfirmation(email: string, next = '/auth/callback'): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim(),
    options: { emailRedirectTo: appUrl(next) },
  });
  if (error) throw problem(error);
}

export async function signIn(email: string, password: string): Promise<User> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error || !data.user) throw problem(error);
  return data.user;
}

/** Signs out on this device only; other devices stay signed in. */
export async function signOut(): Promise<void> {
  const supabase = await getSupabase();
  await supabase.auth.signOut({ scope: 'local' });
}

export async function sendPasswordReset(email: string): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: appUrl('/reset-password'),
  });
  if (error) throw problem(error);
}

export async function updatePassword(password: string): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw problem(error);
}

export async function loadProfile(userId: string): Promise<Profile | null> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, language, email')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { full_name: string; language: string; email: string };
  return {
    fullName: row.full_name,
    language: row.language === 'en' ? 'en' : 'ar',
    email: row.email,
  };
}

export async function saveProfile(
  userId: string,
  profile: Pick<Profile, 'fullName' | 'language'>,
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: profile.fullName.trim(), language: profile.language })
    .eq('id', userId);
  if (error) throw problem(error);
  // Kept with the account too, so a new device knows the language at sign-in.
  await supabase.auth
    .updateUser({ data: { full_name: profile.fullName.trim(), language: profile.language } })
    .catch(() => undefined);
}

/** Minimum password length the app asks for. */
export const MIN_PASSWORD = 8;
