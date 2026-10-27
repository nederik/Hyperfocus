import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { useVault, vault } from './vault/store';
import { RecoveryKeyScreen } from './vault/VaultPanel';

const SECURITY_KEY = ['security'];

/** Security: two-step sign-in and the encryption password. */
export function SecurityDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dlg-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg sec-dlg" role="dialog" aria-modal="true" aria-label="Security">
        <header className="vt-sync-head">
          <h2 className="dlg-title">Security</h2>
          <div className="nt-spacer" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <TwoStep />
        <LibrarySection />
      </div>
    </div>
  );
}

// ---- Two-step sign-in ----

function downloadCodes(codes: string[]) {
  const text = `Hyperfocus recovery codes\n\nEach code works once, instead of the code from your authenticator app.\n\n${codes.join('\n')}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hyperfocus-recovery-codes.txt';
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function TwoStep() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: SECURITY_KEY, queryFn: () => api.get<{ twoFactor: boolean; recoveryLeft: number }>('/api/security') });
  const [mode, setMode] = useState<'idle' | 'setup' | 'disable' | 'newcodes'>('idle');
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setMode('idle');
    setSetup(null);
    setCode('');
    setPassword('');
    setError('');
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  const start = () =>
    run(async () => {
      const r = await api.post<{ secret: string; uri: string }>('/api/2fa/setup');
      const QR = await import('qrcode');
      const qr = await QR.toDataURL(r.uri, { margin: 1, width: 220, color: { dark: '#2b2118', light: '#ffffff' } });
      setSetup({ ...r, qr });
      setMode('setup');
    });
  const enable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api.post<{ recoveryCodes: string[] }>('/api/2fa/enable', { code });
      setCodes(r.recoveryCodes);
      reset();
      await qc.invalidateQueries({ queryKey: SECURITY_KEY });
      toast('Two-step sign-in is on. Other devices were signed out.');
    });
  };
  const disable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.post('/api/2fa/disable', { password, code });
      reset();
      await qc.invalidateQueries({ queryKey: SECURITY_KEY });
      toast('Two-step sign-in is off');
    });
  };
  const newCodes = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api.post<{ recoveryCodes: string[] }>('/api/2fa/recovery-codes', { code });
      setCodes(r.recoveryCodes);
      reset();
      await qc.invalidateQueries({ queryKey: SECURITY_KEY });
    });
  };

  const on = !!q.data?.twoFactor;
  return (
    <section className="sec-section">
      <h3>Two-step sign-in</h3>
      {codes ? (
        <>
          <p className="dlg-message">
            Save these recovery codes. Each one works <strong>once</strong> if you cannot use your phone. They are shown only now.
          </p>
          <div className="sec-codes">
            {codes.map((c) => (
              <code key={c}>{c}</code>
            ))}
          </div>
          <div className="vt-row-btns">
            <button type="button" className="btn btn-sm" onClick={() => downloadCodes(codes)}>
              Download as .txt
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void navigator.clipboard.writeText(codes.join('\n')).then(() => toast('Codes copied'), () => toast('Could not copy'))}
            >
              Copy
            </button>
            <div className="nt-spacer" />
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setCodes(null)}>
              I saved them
            </button>
          </div>
        </>
      ) : q.isLoading ? (
        <p className="muted">Loading…</p>
      ) : mode === 'setup' && setup ? (
        <form onSubmit={enable}>
          <p className="dlg-message">
            1. Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…).
          </p>
          <div className="sec-qr">
            <img src={setup.qr} alt="QR code for the authenticator app" width={220} height={220} />
            <div>
              <p className="muted small">Can’t scan? Enter this key in the app:</p>
              <code className="sec-secret">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
            </div>
          </div>
          <label className="field">
            <span>2. Enter the 6-digit code the app shows</span>
            <input
              className="input mono"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
              autoFocus
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="dlg-actions">
            <button type="button" className="btn" onClick={reset}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || code.replace(/\s/g, '').length !== 6}>
              Turn on
            </button>
          </div>
        </form>
      ) : mode === 'disable' ? (
        <form onSubmit={disable}>
          <label className="field">
            <span>Sign-in password</span>
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span>Code from the app (or a recovery code)</span>
            <input className="input mono" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="dlg-actions">
            <button type="button" className="btn" onClick={reset}>
              Cancel
            </button>
            <button type="submit" className="btn btn-danger" disabled={busy || !password || !code}>
              Turn off
            </button>
          </div>
        </form>
      ) : mode === 'newcodes' ? (
        <form onSubmit={newCodes}>
          <p className="dlg-message">Your old recovery codes will stop working.</p>
          <label className="field">
            <span>Code from the app</span>
            <input className="input mono" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="dlg-actions">
            <button type="button" className="btn" onClick={reset}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !code}>
              Make new codes
            </button>
          </div>
        </form>
      ) : on ? (
        <>
          <p className="dlg-message">
            <span className="vt-pill ok">On</span> After your password, Hyperfocus asks for the code from your authenticator app.{' '}
            {q.data!.recoveryLeft} recovery {q.data!.recoveryLeft === 1 ? 'code' : 'codes'} left.
          </p>
          <div className="vt-row-btns">
            <button type="button" className="btn btn-sm" onClick={() => setMode('newcodes')}>
              New recovery codes
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMode('disable')}>
              Turn off
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="dlg-message">
            <span className="vt-pill warn">Off</span> Add a second step: after your password, a 6-digit code from an app on your phone. Someone who learns your
            password still cannot get in.
          </p>
          {error && <p className="error-text">{error}</p>}
          <div className="vt-row-btns">
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void start()}>
              Turn on two-step sign-in
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ---- Encryption password ----

function LibrarySection() {
  const s = useVault();
  const [mode, setMode] = useState<'idle' | 'password' | 'recovery'>('idle');
  const [oldPw, setOldPw] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  useEffect(() => {
    void vault.load();
  }, []);
  const reset = () => {
    setMode('idle');
    setOldPw('');
    setPw('');
    setPw2('');
    setError('');
  };

  const change = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 10) return setError('Use at least 10 characters.');
    if (pw !== pw2) return setError('The two new passwords are not the same.');
    setBusy(true);
    setError('');
    try {
      if (await vault.changePassword(oldPw, pw)) {
        toast('Encryption password changed');
        reset();
      } else setError('The current encryption password is wrong.');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };
  const recovery = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const k = await vault.newRecoveryKey(oldPw);
      if (k) {
        setNewKey(k);
        reset();
      } else setError('Wrong encryption password.');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  if (newKey)
    return (
      <section className="sec-section">
        <RecoveryKeyScreen keyText={newKey} onDone={() => setNewKey(null)} />
      </section>
    );

  return (
    <section className="sec-section">
      <h3>Encryption</h3>
      {s.status === 'none' ? (
        <p className="dlg-message">Not set up yet.</p>
      ) : s.status === 'loading' ? (
        <p className="muted">Loading…</p>
      ) : mode === 'password' ? (
        <form onSubmit={change}>
          <label className="field">
            <span>Current encryption password</span>
            <input className="input" type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span>New encryption password</span>
            <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </label>
          <label className="field">
            <span>Repeat it</span>
            <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="dlg-actions">
            <button type="button" className="btn" onClick={reset}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>
      ) : mode === 'recovery' ? (
        <form onSubmit={recovery}>
          <p className="dlg-message">You get a new recovery key; the old one stops working.</p>
          <label className="field">
            <span>Encryption password</span>
            <input className="input" type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoFocus />
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="dlg-actions">
            <button type="button" className="btn" onClick={reset}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !oldPw}>
              {busy ? 'Working…' : 'Make a new recovery key'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="dlg-message">
            <span className="vt-pill ok">On</span> Your books, notes, images, music and Obsidian library are encrypted in this browser. The server only
            stores data it cannot read.
          </p>
          <div className="vt-row-btns">
            <button type="button" className="btn btn-sm" onClick={() => setMode('password')}>
              Change encryption password
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setMode('recovery')}>
              New recovery key
            </button>
          </div>
        </>
      )}
    </section>
  );
}
