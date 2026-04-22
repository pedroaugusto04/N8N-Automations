'use server';

import { redirect } from 'next/navigation';

import { clearSession, comparePassword, hasValidSession, setSession } from '../lib/auth';

export async function loginAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') || '');
  const isValid = await comparePassword(password);

  if (!isValid) {
    redirect('/login?error=invalid-password');
  }

  await setSession();
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect('/login');
}

export async function redirectIfAuthenticated(): Promise<void> {
  if (await hasValidSession()) {
    redirect('/');
  }
}
