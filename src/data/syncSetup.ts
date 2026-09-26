import { remoteConfigured, rpc } from './remote';
import { generateSyncKey, loadSyncKey, normalizeSyncKey, saveSyncKey } from './syncKey';
import { sync } from './sync';

/** Resume syncing on launch if this device already has a key. */
export function bootSync() {
  const key = loadSyncKey();
  if (remoteConfigured() && key) sync.start(key);
}

/**
 * First device: make a key and register it. The server accepts only one key,
 * so this returns 'taken' once sync is set up anywhere.
 */
export async function turnOnSync(): Promise<'on' | 'taken'> {
  const key = generateSyncKey();
  const claimed = await rpc<boolean>('due_claim', { key });
  if (!claimed) return 'taken';
  await connect(key);
  return 'on';
}

/** Any other device: paste the key (or the whole link). */
export async function connectWithKey(input: string): Promise<'on' | 'malformed' | 'wrong'> {
  const key = normalizeSyncKey(input);
  if (!key) return 'malformed';
  const valid = await rpc<boolean>('due_check', { key });
  if (!valid) return 'wrong';
  await connect(key);
  return 'on';
}

async function connect(key: string) {
  saveSyncKey(key);
  // Read everything on the server, and send everything this device has.
  await sync.resetCursors();
  sync.start(key);
}

/** Stop syncing on this device. Its data stays here. */
export function disconnect() {
  sync.stop();
  saveSyncKey(null);
}

/** Opening a connect link: connect straight away, or as soon as the device is online. */
export async function connectFromLink(key: string): Promise<string> {
  if (!remoteConfigured()) return 'Sync isn’t available in this build.';
  if (loadSyncKey() === key) return 'This device is already connected.';
  try {
    const result = await connectWithKey(key);
    return result === 'on' ? 'Connected. Your work now syncs on this device.' : 'That sync link isn’t valid.';
  } catch {
    // Offline: trust the link for now; the first sync will confirm it.
    await connect(key);
    return 'Connected. It will sync once you’re online.';
  }
}
