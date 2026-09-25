import { buildExport, coursesCsv, itemsCsv, rulesCsv } from '../domain/export';
import { formatDay } from '../domain/time';
import { signOut, useAuth } from '../data/auth';
import { store, useStore } from '../data/store';
import { useSyncState } from '../data/sync';
import { Sheet } from '../ui/Sheet';
import { useClock } from '../ui/clock';
import { confirmAction } from '../ui/confirm';
import { closeAllOverlays } from '../ui/nav';
import { setTheme, useTheme, type ThemeChoice } from '../ui/theme';

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

/** Account, export, theme. Nothing else. */
export function SettingsSheet() {
  const auth = useAuth();
  const syncState = useSyncState();
  const snapshot = useStore();
  const theme = useTheme();
  const { now, tz } = useClock();

  const exportData = () => {
    const raw = store.getSnapshot();
    return buildExport(raw.courses, raw.items, raw.rules, new Date());
  };
  const stamp = formatDay(now, tz, 'yyyy-MM-dd');

  const syncLine =
    auth.status !== 'signed-in'
      ? null
      : syncState.status === 'offline'
        ? `Offline. ${snapshot.pending ? `${snapshot.pending} ${snapshot.pending === 1 ? 'change' : 'changes'} will sync when you're back online.` : 'Everything is saved on this device.'}`
        : syncState.status === 'error'
          ? `Couldn't sync: ${syncState.error ?? 'unknown error'}. Changes are safe on this device and will retry.`
          : snapshot.pending
            ? `Syncing ${snapshot.pending} ${snapshot.pending === 1 ? 'change' : 'changes'}…`
            : 'All changes synced.';

  const leave = async () => {
    if (snapshot.pending) {
      const ok = await confirmAction({
        title: 'Sign out with unsynced changes?',
        body: `${snapshot.pending} ${snapshot.pending === 1 ? 'change hasn’t' : 'changes haven’t'} reached the server yet and will be lost. Export first if you're unsure.`,
        confirmLabel: 'Sign out',
      });
      if (!ok) return;
    }
    closeAllOverlays();
    await signOut();
  };

  return (
    <Sheet title="Settings">
      <section className="settings-group">
        <h3>Account</h3>
        {auth.status === 'signed-in' ? (
          <>
            <p className="settings-row">
              <span>
                <strong>{auth.email || 'Signed in'}</strong>
                <small>{syncLine}</small>
              </span>
              <button type="button" className="action secondary-button" onClick={leave}>
                Sign out
              </button>
            </p>
          </>
        ) : (
          <p className="settings-row">
            <span>
              <strong>This device only</strong>
              <small>No account is set up, so your work is saved in this browser and nowhere else. Export regularly to keep a copy.</small>
            </span>
          </p>
        )}
      </section>

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
