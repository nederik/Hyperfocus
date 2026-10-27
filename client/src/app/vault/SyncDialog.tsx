import { useEffect, useMemo, useRef, useState } from 'react';
import { confirmDialog } from '../../lib/dialog';
import { toast } from '../../lib/toast';
import { lineDiff } from './diff';
import { vault } from './store';
import { ACTION_LABEL, applyRows, canPickFolder, compare, folderFromFiles, pickFolder, type SyncAction, type SyncRow, type VaultFolder } from './sync';

/**
 * Compare with Obsidian: pick the folder, see each file's state on both sides.
 * The suggested action can be changed row by row; a summary is shown before anything is applied.
 */
export function SyncDialog({ onClose }: { onClose: () => void }) {
  const [folder, setFolder] = useState<VaultFolder | null>(null);
  const [rows, setRows] = useState<SyncRow[] | null>(null);
  const [choice, setChoice] = useState<Record<string, SyncAction>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showSame, setShowSame] = useState(false);
  const [diffRow, setDiffRow] = useState<SyncRow | null>(null);
  const [result, setResult] = useState<{ done: number; failed: { path: string; error: string }[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        if (diffRow) setDiffRow(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, diffRow, onClose]);

  const suggestedFor = (r: SyncRow, f: VaultFolder): SyncAction =>
    f.canWrite || (r.suggested !== 'export' && r.suggested !== 'deleteThere') ? r.suggested : 'skip';

  const scan = async (f: VaultFolder) => {
    setFolder(f);
    setResult(null);
    setRows(null);
    setBusy('Reading the folder…');
    try {
      await vault.flush();
      const r = await compare(f, vault.getState().items, setBusy);
      setRows(r);
      setChoice(Object.fromEntries(r.map((x) => [x.path, suggestedFor(x, f)])));
    } catch (e) {
      toast((e as Error).message);
    }
    setBusy(null);
  };

  const choose = async () => {
    if (!canPickFolder()) return inputRef.current?.click();
    try {
      const f = await pickFolder();
      if (f) await scan(f);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const allowed = (r: SyncRow): SyncAction[] =>
    folder?.canWrite ? r.options : r.options.filter((o) => o !== 'export' && o !== 'deleteThere');

  /** Makes one side the same as the other. */
  const mirror = (to: 'hyperfocus' | 'obsidian' | 'suggested') => {
    if (!rows || !folder) return;
    const next: Record<string, SyncAction> = {};
    for (const r of rows) {
      const opts = allowed(r);
      let a: SyncAction = suggestedFor(r, folder);
      if (!r.same && to === 'hyperfocus') a = r.local ? 'import' : 'deleteHere';
      if (!r.same && to === 'obsidian') a = r.item && !r.item.meta.deleted ? 'export' : 'deleteThere';
      next[r.path] = opts.includes(a) ? a : 'skip';
    }
    setChoice(next);
  };

  const visible = useMemo(() => {
    if (!rows) return [];
    const order = (r: SyncRow) => (r.conflict ? 0 : r.same ? 2 : 1);
    return rows.filter((r) => showSame || !r.same).sort((a, b) => order(a) - order(b) || a.path.localeCompare(b.path));
  }, [rows, showSame]);

  const counts = useMemo(() => {
    const c: Record<SyncAction, number> = { import: 0, export: 0, deleteHere: 0, deleteThere: 0, skip: 0 };
    for (const r of rows ?? []) if (!r.same) c[choice[r.path] ?? 'skip']++;
    return c;
  }, [rows, choice]);
  const sameCount = rows?.filter((r) => r.same).length ?? 0;
  const changes = counts.import + counts.export + counts.deleteHere + counts.deleteThere;

  const apply = async () => {
    if (!rows || !folder) return;
    const overwriteObs = rows.filter((r) => choice[r.path] === 'export' && r.local).length;
    const lines = [
      counts.import && `${counts.import} copied into Hyperfocus`,
      counts.export && `${counts.export} copied into Obsidian${overwriteObs ? ` (${overwriteObs} replace an existing file)` : ''}`,
      counts.deleteHere && `${counts.deleteHere} deleted in Hyperfocus`,
      counts.deleteThere && `${counts.deleteThere} moved to the Obsidian trash`,
    ].filter(Boolean);
    const ok = await confirmDialog({
      title: `Apply ${changes} ${changes === 1 ? 'change' : 'changes'}?`,
      message: `${lines.join('\n')}${counts.export || counts.deleteThere ? '\n\nFiles replaced or removed in Obsidian are kept in the vault’s .trash/hyperfocus folder.' : ''}`,
      confirmLabel: 'Apply',
      cancelLabel: 'Cancel',
      danger: counts.deleteHere + counts.deleteThere > 0,
    });
    if (!ok) return;
    setBusy('Applying…');
    const work = rows.map((row) => ({ row, action: row.same ? (row.options.includes('deleteHere') ? 'deleteHere' : 'skip') : (choice[row.path] ?? 'skip') }) as { row: SyncRow; action: SyncAction });
    const res = await applyRows(work, folder, (d, t, p) => setBusy(t ? `Applying… ${d} / ${t}${p ? ` · ${p}` : ''}` : 'Finishing…'));
    setBusy(null);
    setResult(res);
    setRows(null);
  };

  return (
    <div className="dlg-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dlg vt-sync" role="dialog" aria-modal="true" aria-label="Compare with Obsidian">
        <header className="vt-sync-head">
          <h2 className="dlg-title">Compare with Obsidian</h2>
          {folder && <span className="vt-sync-folder">{folder.name}</span>}
          <div className="nt-spacer" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} disabled={!!busy}>
            Close
          </button>
        </header>

        {busy ? (
          <div className="vt-sync-busy">
            <span className="vt-spinner" aria-hidden /> {busy}
          </div>
        ) : result ? (
          <div className="vt-sync-intro">
            <p className="dlg-message">
              Done: {result.done} {result.done === 1 ? 'change' : 'changes'} applied.
              {result.failed.length ? ` ${result.failed.length} could not be applied:` : ''}
            </p>
            {result.failed.length > 0 && (
              <ul className="vt-sync-failed">
                {result.failed.map((f) => (
                  <li key={f.path}>
                    <strong>{f.path}</strong>: {f.error}
                  </li>
                ))}
              </ul>
            )}
            <div className="dlg-actions">
              <button type="button" className="btn" onClick={() => folder && void scan(folder)}>
                Compare again
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        ) : !rows ? (
          <div className="vt-sync-intro">
            <p className="dlg-message">
              Choose your Obsidian vault folder (the one that contains <code>.obsidian</code>). The files are read in this browser and compared with your
              library; nothing leaves this computer unencrypted.
            </p>
            <p className="dlg-message muted small">
              {canPickFolder()
                ? 'The browser will ask for permission to edit the folder, so changes from Hyperfocus can be copied back into Obsidian.'
                : 'This browser can only read the folder: you can bring notes into Hyperfocus. To copy changes back into Obsidian, use Chrome or Edge.'}
            </p>
            <div className="dlg-actions">
              <button type="button" className="btn btn-primary" onClick={() => void choose()}>
                Choose Obsidian folder…
              </button>
            </div>
            <input
              ref={inputRef}
              type="file"
              hidden
              multiple
              {...({ webkitdirectory: '' } as Record<string, string>)}
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                if (files.length) void scan(folderFromFiles(files));
              }}
            />
          </div>
        ) : (
          <>
            <div className="vt-sync-bar">
              <span className="vt-sync-sum">
                {rows.length - sameCount === 0 ? 'Everything is the same on both sides.' : `${rows.length - sameCount} different · ${sameCount} the same`}
              </span>
              <div className="nt-spacer" />
              <span className="muted small">Make:</span>
              <button type="button" className="btn btn-sm" onClick={() => mirror('suggested')} title="The suggested action for every file">
                Suggested
              </button>
              <button type="button" className="btn btn-sm" onClick={() => mirror('hyperfocus')} title="Hyperfocus becomes the same as the Obsidian folder">
                Hyperfocus = Obsidian
              </button>
              {folder?.canWrite && (
                <button type="button" className="btn btn-sm" onClick={() => mirror('obsidian')} title="The Obsidian folder becomes the same as Hyperfocus">
                  Obsidian = Hyperfocus
                </button>
              )}
            </div>
            {!folder?.canWrite && <p className="vt-sync-note">Read-only: this browser cannot write into the Obsidian folder.</p>}
            <div className="vt-sync-list">
              {visible.map((r) => {
                const action = r.same ? 'skip' : (choice[r.path] ?? 'skip');
                const canDiff = r.kind === 'note' && !r.same && r.local && r.item && !r.item.meta.deleted;
                const dir = r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/') + 1) : '';
                return (
                  <div key={r.path} className={`vt-sync-row${r.conflict ? ' conflict' : ''}${r.same ? ' same' : ''}`}>
                    <div className="vt-sync-path" title={r.path}>
                      <span className="muted">{dir}</span>
                      {r.path.slice(dir.length)}
                    </div>
                    <span className={`vt-pill ${r.conflict ? 'warn' : r.same ? 'ok' : 'info'}`}>{r.status}</span>
                    {canDiff ? (
                      <button type="button" className="vt-link" onClick={() => setDiffRow(r)}>
                        Differences
                      </button>
                    ) : (
                      <span />
                    )}
                    {r.same ? (
                      <span className="muted small">—</span>
                    ) : (
                      <select className="vt-select" value={action} onChange={(e) => setChoice((c) => ({ ...c, [r.path]: e.target.value as SyncAction }))}>
                        {allowed(r).map((o) => (
                          <option key={o} value={o}>
                            {ACTION_LABEL[o]}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
            <footer className="vt-sync-foot">
              <label className="vt-check small">
                <input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} />
                <span>Show unchanged files</span>
              </label>
              <div className="nt-spacer" />
              <button type="button" className="btn" onClick={() => folder && void scan(folder)}>
                Compare again
              </button>
              <button type="button" className="btn btn-primary" disabled={!changes} onClick={() => void apply()}>
                {changes ? `Apply ${changes} ${changes === 1 ? 'change' : 'changes'}` : 'Nothing to apply'}
              </button>
            </footer>
          </>
        )}
        {diffRow && <DiffView row={diffRow} onClose={() => setDiffRow(null)} />}
      </div>
    </div>
  );
}

function DiffView({ row, onClose }: { row: SyncRow; onClose: () => void }) {
  const [lines, setLines] = useState<ReturnType<typeof lineDiff> | null>(null);
  useEffect(() => {
    let alive = true;
    void row.local
      ?.read()
      .then((b) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(b))
      .then((obs) => alive && setLines(lineDiff(obs, row.item?.text ?? '')));
    return () => {
      alive = false;
    };
  }, [row]);
  return (
    <div className="vt-diff">
      <header className="vt-sync-head">
        <h3>{row.path}</h3>
        <div className="nt-spacer" />
        <span className="vt-diff-legend">
          <span className="del">− only in Obsidian</span> <span className="add">+ only in Hyperfocus</span>
        </span>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          Back
        </button>
      </header>
      <div className="vt-diff-body">
        {lines ? (
          collapse(lines).map((l, i) =>
            l.type === 'gap' ? (
              <div key={i} className="vt-diff-gap">
                ⋯ {l.n} unchanged {l.n === 1 ? 'line' : 'lines'}
              </div>
            ) : (
              <div key={i} className={`vt-diff-line ${l.type}`}>
                <span className="vt-diff-mark">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
                {l.text || ' '}
              </div>
            ),
          )
        ) : (
          <p className="muted">Comparing…</p>
        )}
      </div>
    </div>
  );
}

/** Long unchanged stretches are shortened (2 lines stay around each difference). */
function collapse(lines: ReturnType<typeof lineDiff>) {
  type Out = (typeof lines)[number] | { type: 'gap'; n: number };
  const keep = lines.map((l, i) => l.type !== 'same' || lines.slice(Math.max(0, i - 2), i + 3).some((x) => x.type !== 'same'));
  const out: Out[] = [];
  let gap = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (gap) out.push({ type: 'gap', n: gap });
      gap = 0;
      out.push(l);
    } else gap++;
  });
  if (gap) out.push({ type: 'gap', n: gap });
  return out;
}
