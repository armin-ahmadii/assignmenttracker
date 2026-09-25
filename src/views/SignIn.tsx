import { useState, type FormEvent } from 'react';
import { sendEmailLink, signInWithGoogle, verifyEmailCode } from '../data/auth';

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? '');
  if (/failed to fetch|network|load failed/i.test(message)) return "Couldn't reach the server. Check your connection and try again.";
  if (/provider is not enabled|unsupported provider/i.test(message)) return "Google sign-in isn't set up yet. Use your email instead.";
  if (/token has expired|invalid/i.test(message)) return 'That code is wrong or has expired. Request a new one.';
  if (/rate limit|security purposes/i.test(message)) return 'Too many attempts. Wait a minute and try again.';
  return message || 'Something went wrong. Try again.';
}

export function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const sendLink = (event: FormEvent) => {
    event.preventDefault();
    if (!/\S+@\S+\.\S+/.test(email)) return setError('Enter your email address');
    void run(async () => {
      await sendEmailLink(email.trim());
      setSent(true);
    });
  };

  const verify = (event: FormEvent) => {
    event.preventDefault();
    void run(() => verifyEmailCode(email.trim(), code.trim()));
  };

  return (
    <main className="sign-in">
      <div className="sign-in-card">
        <div className="brand">
          <span className="brand-mark">d</span>
          <span>Due</span>
        </div>
        <h1>What's due, at a glance.</h1>
        <p className="sign-in-lede">Sign in once and stay signed in. Your work syncs between phone and laptop, and works offline.</p>

        {!navigator.onLine && <p className="form-error">You're offline. Connect once to sign in; after that the app works without a connection.</p>}

        <button type="button" className="action save-button wide" disabled={busy} onClick={() => run(signInWithGoogle)}>
          Continue with Google
        </button>

        <div className="divider">
          <span>or</span>
        </div>

        {sent ? (
          <form onSubmit={verify} className="sign-in-form">
            <p className="settings-note">
              We emailed a sign-in link to <strong>{email}</strong>. Open it on this device, or enter the code from the email here.
            </p>
            <label className="field">
              <span>Code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                autoFocus
              />
            </label>
            <button type="submit" className="action save-button wide" disabled={busy || code.length < 6}>
              Sign in
            </button>
            <button type="button" className="action link-button" onClick={() => setSent(false)}>
              Use a different email
            </button>
          </form>
        ) : (
          <form onSubmit={sendLink} className="sign-in-form">
            <label className="field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@school.ca" />
            </label>
            <button type="submit" className="action secondary-button wide" disabled={busy}>
              Email me a sign-in link
            </button>
          </form>
        )}
        {error && <p className="form-error">{error}</p>}
      </div>
    </main>
  );
}
