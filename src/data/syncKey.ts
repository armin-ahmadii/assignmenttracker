import { useSyncExternalStore } from 'react';

/**
 * The private sync key: 25 characters (125 random bits) in Crockford base32,
 * shown in groups of five. It is the only credential; the server keeps just its hash.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 25;
const STORAGE_KEY = 'due:syncKey';
const LINK_PARAM = 'connect';

export function generateSyncKey(): string {
  const bytes = new Uint8Array(LENGTH);
  crypto.getRandomValues(bytes);
  // 256 is a multiple of 32, so masking the low 5 bits is unbiased.
  return group(Array.from(bytes, (b) => ALPHABET[b & 31]).join(''));
}

function group(raw: string): string {
  return raw.match(/.{1,5}/g)!.join('-');
}

/**
 * Accepts a key typed or pasted any old way, or a whole connect link.
 * Returns the canonical form, or null if it can't be a key.
 */
export function normalizeSyncKey(input: string): string | null {
  const fromLink = input.match(new RegExp(`[#?&]${LINK_PARAM}=([^&#\\s]+)`));
  const text = decodeURIComponent(fromLink ? fromLink[1] : input)
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(new RegExp(`[^${ALPHABET}]`, 'g'), '');
  return text.length === LENGTH ? group(text) : null;
}

export function connectLink(key: string, origin = window.location.origin): string {
  return `${origin}/#${LINK_PARAM}=${key}`;
}

/** A key arriving in the page URL (`/#connect=…`), removed from the address bar right away. */
export function takeKeyFromUrl(): string | null {
  const { hash } = window.location;
  if (!hash.includes(`${LINK_PARAM}=`)) return null;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/now`);
  return normalizeSyncKey(hash);
}

let current: string | null = read();
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function loadSyncKey(): string | null {
  return current;
}

export function saveSyncKey(key: string | null) {
  current = key;
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: the key lasts for this session only.
  }
  for (const listener of listeners) listener();
}

export function useSyncKey(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
