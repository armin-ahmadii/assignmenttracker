import type { SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Without Supabase settings the app runs local-only: no sign-in, data stays on the device. */
export const cloudEnabled = Boolean(url && anonKey);

export const AUTH_STORAGE_KEY = 'due-auth';

let clientPromise: Promise<SupabaseClient> | null = null;

/** Loaded lazily so the Supabase bundle never delays the first paint. */
export function getClient(): Promise<SupabaseClient> {
  if (!cloudEnabled) return Promise.reject(new Error('Supabase is not configured'));
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(url!, anonKey!, {
        auth: {
          storageKey: AUTH_STORAGE_KEY,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce',
        },
      }),
    );
  }
  return clientPromise;
}

/** Read the persisted session synchronously so a signed-in user never waits on the network. */
export function storedSession(): { userId: string; email: string } | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const user = parsed?.user ?? parsed?.currentSession?.user;
    return user?.id ? { userId: user.id, email: user.email ?? '' } : null;
  } catch {
    return null;
  }
}

/** True while returning from Google or an email link. */
export function urlHasAuthResponse(): boolean {
  const { searchParams, hash } = new URL(window.location.href);
  return searchParams.has('code') || searchParams.has('error_description') || hash.includes('access_token');
}
