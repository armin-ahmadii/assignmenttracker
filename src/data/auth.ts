import { useSyncExternalStore } from 'react';
import { getMeta, setMeta } from './db';
import { store } from './store';
import { sync } from './sync';
import { cloudEnabled, getClient, storedSession, urlHasAuthResponse } from './supabase';

export type AuthStatus = 'local' | 'checking' | 'signed-out' | 'signed-in';

export interface AuthState {
  status: AuthStatus;
  email: string;
  userId: string | null;
}

let state: AuthState = { status: cloudEnabled ? 'checking' : 'local', email: '', userId: null };
const listeners = new Set<() => void>();

function set(next: AuthState) {
  state = next;
  for (const listener of listeners) listener();
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** A device only ever holds one account's data. */
async function adoptUser(userId: string) {
  const db = store.database;
  if (!db) return;
  const previous = await getMeta<string>(db, 'userId');
  if (previous && previous !== userId) await store.reset();
  await setMeta(db, 'userId', userId);
}

async function signedIn(userId: string, email: string) {
  if (state.status === 'signed-in' && state.userId === userId) return;
  await adoptUser(userId);
  set({ status: 'signed-in', email, userId });
  sync.start(userId);
}

/**
 * Decide who's signed in without waiting on the network: a stored session is
 * trusted immediately (so the app opens offline), then confirmed in the background.
 */
export async function bootAuth() {
  if (!cloudEnabled) {
    set({ status: 'local', email: '', userId: null });
    return;
  }
  const stored = storedSession();
  const returning = urlHasAuthResponse();
  if (stored && !returning) await signedIn(stored.userId, stored.email);
  else set({ status: returning ? 'checking' : 'signed-out', email: '', userId: null });

  const client = await getClient();
  client.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      // Leave the auth callback before touching the database (supabase-js holds a lock during it).
      setTimeout(() => void signedIn(session.user.id, session.user.email ?? ''), 0);
    } else if (event === 'SIGNED_OUT') {
      sync.stop();
      set({ status: 'signed-out', email: '', userId: null });
    }
  });
  const { data } = await client.auth.getSession();
  if (returning) window.history.replaceState(null, '', window.location.pathname);
  // A revoked session arrives as SIGNED_OUT above; a failed refresh while offline must not sign anyone out.
  if (!data.session && state.status !== 'signed-in') set({ status: 'signed-out', email: '', userId: null });
}

export async function signInWithGoogle() {
  const client = await getClient();
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/` },
  });
  if (error) throw error;
}

export async function sendEmailLink(email: string) {
  const client = await getClient();
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${window.location.origin}/`, shouldCreateUser: true },
  });
  if (error) throw error;
}

/** Home-screen apps on iOS don't share storage with Safari, so the emailed code is the reliable path there. */
export async function verifyEmailCode(email: string, token: string) {
  const client = await getClient();
  const { error } = await client.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

export async function signOut() {
  sync.stop();
  if (cloudEnabled) {
    const client = await getClient();
    await client.auth.signOut({ scope: 'local' });
  }
  await store.reset();
  set({ status: cloudEnabled ? 'signed-out' : 'local', email: '', userId: null });
}
