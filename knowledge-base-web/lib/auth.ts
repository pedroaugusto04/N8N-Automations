import crypto from 'node:crypto';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const SESSION_COOKIE_NAME = 'kb_notes_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

type SessionPayload = {
  sub: 'kb-notes';
  exp: number;
};

function getSessionSecret(): string {
  const secret = String(process.env.APP_SESSION_SECRET || '').trim();
  if (!secret) {
    throw new Error('missing_app_session_secret');
  }
  return secret;
}

function getConfiguredPassword(): string {
  const password = String(process.env.APP_PASSWORD || '').trim();
  if (!password) {
    throw new Error('missing_app_password');
  }
  return password;
}

function sign(value: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

function encodeSession(payload: SessionPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function decodeSession(token: string | undefined): SessionPayload | null {
  if (!token) {
    return null;
  }
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }
  const expectedSignature = sign(encodedPayload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as SessionPayload;
    if (parsed.sub !== 'kb-notes' || !Number.isFinite(parsed.exp) || parsed.exp <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function useSecureCookies(): boolean {
  const baseUrl = String(process.env.APP_BASE_URL || '').trim();
  if (!baseUrl) {
    return process.env.NODE_ENV === 'production';
  }
  try {
    return new URL(baseUrl).protocol === 'https:';
  } catch {
    return process.env.NODE_ENV === 'production';
  }
}

export async function comparePassword(input: string): Promise<boolean> {
  try {
    const configuredPassword = getConfiguredPassword();
    const inputHash = crypto.createHash('sha256').update(String(input || ''), 'utf8').digest();
    const configuredHash = crypto.createHash('sha256').update(configuredPassword, 'utf8').digest();
    return crypto.timingSafeEqual(inputHash, configuredHash);
  } catch {
    return false;
  }
}

export async function setSession(): Promise<void> {
  const cookieStore = await cookies();
  const payload: SessionPayload = {
    sub: 'kb-notes',
    exp: Date.now() + SESSION_TTL_SECONDS * 1000,
  };

  cookieStore.set(SESSION_COOKIE_NAME, encodeSession(payload), {
    httpOnly: true,
    sameSite: 'lax',
    secure: useSecureCookies(),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: useSecureCookies(),
    path: '/',
    expires: new Date(0),
  });
}

export async function hasValidSession(): Promise<boolean> {
  try {
    getSessionSecret();
  } catch {
    return false;
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return decodeSession(session) !== null;
}

export async function requireAuth(): Promise<void> {
  if (!(await hasValidSession())) {
    redirect('/login');
  }
}
