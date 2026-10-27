import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { ME_KEY, useMe } from './App';

/** Account: the name put on new books, and the password (changing it signs out every other device). */
export function AccountDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const me = useMe();
  const [name, setName] = useState(me.data?.displayName ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const changingPassword = !!(current || next || repeat);
    if (changingPassword && next !== repeat) return setError('The two new passwords are not the same.');
    setBusy(true);
    try {
      if (name.trim() && name.trim() !== me.data?.displayName) await api.patch('/api/account', { displayName: name.trim() });
      if (changingPassword) await api.post('/api/account/password', { current, next });
      await qc.invalidateQueries({ queryKey: ME_KEY });
      toast(changingPassword ? 'Password changed. Other devices are signed out.' : 'Saved.');
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="dlg-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dlg" role="dialog" aria-modal="true" aria-labelledby="acc-title" onSubmit={submit}>
        <h2 id="acc-title" className="dlg-title">
          Account
        </h2>
        <p className="dlg-message">
          Signed in as <strong>{me.data?.username}</strong>.
        </p>
        <label className="field dlg-field">
          <span>Your name (put on new books as the author)</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
        </label>
        <p className="dlg-message" style={{ marginTop: 18 }}>
          Change password <span className="muted">(leave empty to keep it)</span>
        </p>
        <label className="field dlg-field">
          <span>Current password</span>
          <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </label>
        <label className="field dlg-field">
          <span>New password</span>
          <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} autoComplete="new-password" />
        </label>
        <label className="field dlg-field">
          <span>New password again</span>
          <input className="input" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} minLength={8} autoComplete="new-password" />
        </label>
        {error && <p className="error-text dlg-error">{error}</p>}
        <div className="dlg-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
