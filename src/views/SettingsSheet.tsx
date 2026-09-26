import { useEffect, useState, type FormEvent } from 'react';
import { buildExport, coursesCsv, itemsCsv, rulesCsv } from '../domain/export';
import { formatDay, formatTime } from '../domain/time';
import { remoteConfigured } from '../data/remote';
import { store, useStore } from '../data/store';
import { sync, useSyncState } from '../data/sync';
import { connectLink, useSyncKey } from '../data/syncKey';
import { connectWithKey, disconnect, turnOnSync } from '../data/syncSetup';
import { Sheet } from '../ui/Sheet';
import { useClock } from '../ui/clock';
import { confirmAction } from '../ui/confirm';
import { setTheme, useTheme, type ThemeChoice } from '../ui/theme';
import { showToast } from '../ui/toast';

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Sync, export, theme. Nothing else. */
export function SettingsSheet() {
  const snapshot = useStore();
  const theme = useTheme();
  const { now, tz } = useClock();

  const exportData = () => {
    const raw = store.getSnapshot();
    return buildExport(raw.courses, raw.items, raw.rules, new Date());
  };
  const stamp = formatDay(now, tz, 'yyyy-MM-dd');

  return (
    <Sheet title="Settings">
      <SyncSection />

      <section className="settings-group">
        <h3>Export all data</h3>
        <div className="settings-actions">
          <button
            type="button"
            className="action secondary-button"
            onClick={() => download(`due-export-${stamp}.json`, JSON.stringify(exportData(), null, 2), 'application/json')}
          >
            Download JSON
          </button>
          <button
            type="button"
            className="action secondary-button"
            onClick={() => {
              const data = exportData();
              download(`due-items-${stamp}.csv`, itemsCsv(data), 'text/csv');
              download(`due-courses-${stamp}.csv`, coursesCsv(data), 'text/csv');
              if (data.rules.length) download(`due-recurring-${stamp}.csv`, rulesCsv(data), 'text/csv');
            }}
          >
            Download CSV
          </button>
        </div>
        <small className="settings-note">
          {snapshot.items.length} items · {snapshot.courses.length} courses · {snapshot.rules.length} recurring rules
        </small>
      </section>

      <section className="settings-group">
        <h3>Theme</h3>
        <div className="segmented wide" role="radiogroup" aria-label="Theme">
          {(['system', 'light', 'dark'] as ThemeChoice[]).map((choice) => (
            <button key={choice} type="button" role="radio" aria-checked={theme === choice} onClick={() => setTheme(choice)}>
              {choice === 'system' ? 'System' : choice === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </section>
    </Sheet>
  );
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** No accounts: each device gets the private sync key once, by link or by pasting it. */
function SyncSection() {
  const key = useSyncKey();
  if (!remoteConfigured()) {
    return (
      <section className="settings-group">
        <h3>Sync</h3>
        <p className="settings-row">
          <span>
            <strong>This device only</strong>
            <small>This build has no database configured, so your work is saved in this browser and nowhere else.</small>
          </span>
        </p>
      </section>
    );
  }
  return key ? <Connected syncKey={key} /> : <NotConnected />;
}

function friendly(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (!navigator.onLine || /fetch|network|load failed|timed? ?out|abort/i.test(message)) {
    return "Couldn't reach the database. Try again when you're online.";
  }
  return message || 'Something went wrong. Try again.';
}

function NotConnected() {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const run = async (task: () => Promise<string | null>) => {
    setBusy(true);
    setMessage('');
    try {
      const result = await task();
      if (result) setMessage(result);
    } catch (err) {
      setMessage(friendly(err));
    } finally {
      setBusy(false);
    }
  };

  const turnOn = () =>
    run(async () => {
      const result = await turnOnSync();
      if (result === 'taken') return 'Sync is already on for another device. Paste its key or link below.';
      showToast({ message: 'Sync is on' });
      return null;
    });

  const connect = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await connectWithKey(input);
      if (result === 'malformed') return "That doesn't look like a sync key. It's 25 letters and numbers, like 7K2QX-….";
      if (result === 'wrong') return "That key doesn't match. Check it on your other device, under Settings → Sync.";
      showToast({ message: 'Connected. Your work now syncs on this device.' });
      return null;
    });
  };

  return (
    <section className="settings-group">
      <h3>Sync</h3>
      <p className="settings-row">
        <span>
          <strong>This device only</strong>
          <small>
            Turn on sync to have the same work on your phone and laptop. There's no account: each device gets a private sync key
            once.
          </small>
        </span>
      </p>
      <div className="settings-actions sync-first">
        <button type="button" className="action save-button" disabled={busy} onClick={turnOn}>
          Turn on sync
        </button>
      </div>
      <form className="sync-connect" onSubmit={connect}>
        <label className="field">
          <span>Already on another device? Paste its sync key or link</span>
          <span className="field-combo">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
          </span>
        </label>
        <button type="submit" className="action secondary-button" disabled={busy || !input.trim()}>
          Connect
        </button>
      </form>
      {message && <p className="form-error">{message}</p>}
    </section>
  );
}

function Connected({ syncKey }: { syncKey: string }) {
  const state = useSyncState();
  const { pending } = useStore();
  const { tz } = useClock();
  const [sharing, setSharing] = useState(false);

  const status =
    state.status === 'rejected'
      ? "The database doesn't accept this device's key anymore. Disconnect, then connect again with the current key."
      : state.status === 'offline'
        ? pending
          ? `Offline. ${plural(pending, 'change', 'changes')} will sync when you're back online.`
          : 'Offline. Everything is saved on this device.'
        : state.status === 'error'
          ? `Couldn't sync (${state.error ?? 'unknown error'}). Changes are safe here and it will retry.`
          : pending || state.status === 'syncing'
            ? pending
              ? `Syncing ${plural(pending, 'change', 'changes')}…`
              : 'Syncing…'
            : state.lastSyncedAt
              ? `All changes synced · ${formatTime(state.lastSyncedAt, tz)}`
              : 'All changes synced.';

  const leave = async () => {
    const ok = await confirmAction({
      title: 'Disconnect this device?',
      body: pending
        ? `${plural(pending, 'change hasn’t', 'changes haven’t')} reached the database yet. They stay on this device but won't sync.`
        : 'Your work stays on this device, but it will stop syncing. You can connect again with the key.',
      confirmLabel: 'Disconnect',
    });
    if (ok) disconnect();
  };

  return (
    <section className="settings-group">
      <h3>Sync</h3>
      <p className="settings-row">
        <span>
          <strong>Syncing with your database</strong>
          <small data-status={state.status}>{status}</small>
        </span>
        <button type="button" className="action secondary-button" onClick={() => void sync.run()}>
          Sync now
        </button>
      </p>
      {sharing ? (
        <ShareKey syncKey={syncKey} />
      ) : (
        <div className="settings-actions">
          <button type="button" className="action secondary-button" onClick={() => setSharing(true)}>
            Add another device
          </button>
          <button type="button" className="action danger-link" onClick={leave}>
            Disconnect
          </button>
        </div>
      )}
    </section>
  );
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast({ message: `${what} copied` });
  } catch {
    showToast({ message: `Couldn't copy. Select the ${what.toLowerCase()} and copy it instead.` });
  }
}

function ShareKey({ syncKey }: { syncKey: string }) {
  const link = connectLink(syncKey);
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let live = true;
    // The QR encoder only loads when someone actually wants a code.
    void import('uqr').then(({ renderSVG }) => {
      if (live) setSvg(renderSVG(link, { border: 2, whiteColor: '#ffffff', blackColor: '#171717' }));
    });
    return () => {
      live = false;
    };
  }, [link]);

  return (
    <div className="share-key">
      <div className="qr" role="img" aria-label="QR code of the connect link" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="share-copy">
        <p>
          Scan with your phone's camera, or open the link on the other device. It connects that device for good.
        </p>
        <code className="sync-key">{syncKey}</code>
        <div className="settings-actions">
          <button type="button" className="action secondary-button" onClick={() => copy(link, 'Link')}>
            Copy link
          </button>
          <button type="button" className="action secondary-button" onClick={() => copy(syncKey, 'Key')}>
            Copy key
          </button>
        </div>
        <small className="settings-note">
          iPhone: the Home Screen app keeps its own storage, so open Due from the Home Screen, go to Settings → Sync and paste the key or link there.
          Anyone with this key can see and change your work, so keep it to your own devices.
        </small>
      </div>
    </div>
  );
}
