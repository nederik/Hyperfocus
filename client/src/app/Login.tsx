import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { Logo } from '../ui/logo/Logo';

/**
 * Sign-in. On the very first start (no account yet) it creates the owner account instead.
 * A setup code is asked for when the server has SETUP_TOKEN set (always on Cloudflare).
 * With two-step sign-in on, the code from the authenticator app (or a recovery code) is asked for after the password.
 */
export function Login({ setup, tokenRequired }: { setup: boolean; tokenRequired: boolean }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [token, setToken] = useState('');
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (setup && password !== repeat) return setError('The two passwords are not the same.');
    setBusy(true);
    try {
      if (setup) {
        await api.post('/api/setup', { username, password, displayName: displayName || undefined, token: token || undefined });
        await qc.invalidateQueries();
        return;
      }
      const r = await api.post<{ ok?: boolean; twoFactor?: boolean; ticket?: string }>('/api/login', { username, password });
      if (r.twoFactor && r.ticket) {
        setPassword('');
        setTicket(r.ticket);
        setBusy(false);
        return;
      }
      await qc.invalidateQueries();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; recoveryLeft?: number }>('/api/login/2fa', { ticket, code });
      if (r.recoveryLeft !== undefined)
        toast(`You used a recovery code. ${r.recoveryLeft} left${r.recoveryLeft < 3 ? ': make new ones under Security' : ''}.`);
      await qc.invalidateQueries();
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      setCode('');
      // The sign-in expired: start again from the password
      if (/expired/i.test(msg)) setTicket(null);
      setBusy(false);
    }
  };

  if (ticket)
    return (
      <div className="st-login">
        <form className="st-login-card" onSubmit={submitCode}>
          <Logo size={64} simple />
          <h1>Hyperfocus</h1>
          <p className="muted">Enter the 6-digit code from your authenticator app.</p>
          <label className="field">
            <span>Code</span>
            <input
              className="input mono st-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={12}
              required
              autoFocus
            />
          </label>
          <p className="muted small">No phone? Enter one of your recovery codes instead.</p>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy || !code.trim()}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <button type="button" className="vt-link" onClick={() => (setTicket(null), setCode(''), setError(''))}>
            Back
          </button>
        </form>
      </div>
    );

  return (
    <div className="st-login">
      <form className="st-login-card" onSubmit={submit}>
        <Logo size={64} simple />
        <h1>Hyperfocus</h1>
        <p className="muted">
          {setup ? 'Welcome. Create the account you will write with. Only this account can open your books.' : 'Sign in to your books.'}
        </p>
        {setup && tokenRequired && (
          <label className="field">
            <span>Setup code</span>
            <input className="input" value={token} onChange={(e) => setToken(e.target.value)} required autoComplete="off" />
          </label>
        )}
        <label className="field">
          <span>Username</span>
          <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </label>
        {setup && (
          <label className="field">
            <span>Your name (on new books)</span>
            <input className="input" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Optional" />
          </label>
        )}
        <label className="field">
          <span>Password</span>
          <input
            className="input"
            type="password"
            autoComplete={setup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={setup ? 8 : undefined}
            required
          />
        </label>
        {setup && (
          <label className="field">
            <span>Password again</span>
            <input className="input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} minLength={8} required />
          </label>
        )}
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {setup ? (busy ? 'Creating…' : 'Create account') : busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
