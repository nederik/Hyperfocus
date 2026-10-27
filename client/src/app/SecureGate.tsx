import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Logo } from '../ui/logo/Logo';
import { LoadingScreen } from './LoadingScreen';
import { toast } from '../lib/toast';
import { encryptEverything, plainState, type PlainState } from './secure';
import { useVault, vault } from './vault/store';
import { RecoveryKeyScreen, VaultSetup, VaultUnlock } from './vault/VaultPanel';

/**
 * The Hyperfocus gate: after signing in, the encryption password is asked for; books and notes only show once unlocked.
 * The first time: encryption is set up and existing (unencrypted) books are encrypted safely.
 */
export function SecureGate({ children }: { children: ReactNode }) {
  const s = useVault();
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  useEffect(() => {
    void vault.load();
  }, []);

  if (recoveryKey)
    return (
      <GatePage>
        <RecoveryKeyScreen keyText={recoveryKey} onDone={() => setRecoveryKey(null)} />
      </GatePage>
    );
  if (s.status === 'loading') return <LoadingScreen show />;
  if (s.status === 'error')
    return (
      <GatePage>
        <p className="error-text">{s.error}</p>
        <button type="button" className="btn btn-sm" onClick={() => void vault.load()}>
          Try again
        </button>
      </GatePage>
    );
  if (s.status === 'none')
    return (
      <GatePage>
        <VaultSetup onCreated={setRecoveryKey} />
      </GatePage>
    );
  if (s.status === 'locked')
    return (
      <GatePage>
        <VaultUnlock />
      </GatePage>
    );
  return <PlainCheck>{children}</PlainCheck>;
}

function GatePage({ children }: { children: ReactNode }) {
  return (
    <div className="st-gate">
      <div className="st-gate-brand">
        <Logo size={34} simple />
        <span>Hyperfocus</span>
      </div>
      {children}
    </div>
  );
}

/** If anything is still unencrypted, it is encrypted first. */
function PlainCheck({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [state, setState] = useState<PlainState | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [backedUp, setBackedUp] = useState(false);

  useEffect(() => {
    let alive = true;
    plainState().then(
      (p) => alive && setState(p),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, []);

  if (error && state === undefined)
    return (
      <GatePage>
        <p className="error-text">{error}</p>
        <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>
          Try again
        </button>
      </GatePage>
    );
  // The same loading screen hands over to the shelf's without a break
  if (state === undefined) return <LoadingScreen show />;
  if (state === null) return <>{children}</>;

  const backup = async () => {
    setBusy('Preparing the backup…');
    try {
      const { exportEverything } = await import('./export/backup');
      await exportEverything((m) => setBusy(m));
      setBackedUp(true);
    } catch (e) {
      toast((e as Error).message);
    }
    setBusy(null);
  };
  const run = async () => {
    setError('');
    setBusy('Starting…');
    try {
      await encryptEverything((m) => setBusy(m));
      await qc.invalidateQueries();
      toast('Everything is encrypted.');
      setState(null);
    } catch (e) {
      setError(`${(e as Error).message} Nothing was lost: the unencrypted copies are kept until everything checks out. You can try again.`);
    }
    setBusy(null);
  };

  return (
    <GatePage>
      <div className="vt-card">
        <h3>Encrypt your books</h3>
        <p className="vt-lead">
          These are still stored unencrypted on the server:{' '}
          {[
            state.books.length ? `${state.books.length} ${state.books.length === 1 ? 'book' : 'books'}` : '',
            state.notebook ? 'your notes' : '',
            state.dictionary ? 'your personal dictionary' : '',
          ]
            .filter(Boolean)
            .join(', ')}
          . They will be encrypted in this browser, checked, and only then the unencrypted copies are deleted.
        </p>
        <p className="vt-lead">
          <strong>First, download a backup</strong> to your computer (every book as PDF, Word and full data, plus your notes).
        </p>
        {busy ? (
          <div className="vt-sync-busy">
            <span className="vt-spinner" aria-hidden /> {busy}
          </div>
        ) : (
          <div className="vt-row-btns">
            <button type="button" className={`btn${backedUp ? '' : ' btn-primary'}`} onClick={() => void backup()}>
              {backedUp ? 'Backup downloaded ✓' : 'Download backup'}
            </button>
            <button type="button" className={`btn${backedUp ? ' btn-primary' : ''}`} onClick={() => void run()}>
              Encrypt now
            </button>
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </GatePage>
  );
}
