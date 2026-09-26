/**
 * The app's only way to the database: four Postgres functions exposed by
 * Supabase's REST API (see supabase/migrations). Plain fetch, no SDK.
 */

interface RemoteConfig {
  url: string;
  apiKey: string;
}

let config: RemoteConfig | null = (() => {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
  const apiKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && apiKey ? { url, apiKey } : null;
})();

/** Builds without Supabase settings (e.g. `npm run dev`) are local-only. */
export function remoteConfigured(): boolean {
  return config != null;
}

/** For tests. */
export function setRemoteConfig(next: RemoteConfig | null) {
  config = next;
}

export class RemoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** The server said this device's sync key isn't (or is no longer) valid. */
export function isKeyRejected(err: unknown): boolean {
  return err instanceof RemoteError && err.code === '28000';
}

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!config) throw new Error('Sync is not configured in this build.');
  const headers: Record<string, string> = { apikey: config.apiKey, 'Content-Type': 'application/json' };
  // Legacy anon keys are JWTs and also go in Authorization; publishable keys must not.
  if (config.apiKey.startsWith('eyJ')) headers.Authorization = `Bearer ${config.apiKey}`;
  const response = await fetch(`${config.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined,
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail = body as { message?: string; code?: string } | null;
    throw new RemoteError(detail?.message ?? `Sync request failed (${response.status})`, response.status, detail?.code);
  }
  return body as T;
}
