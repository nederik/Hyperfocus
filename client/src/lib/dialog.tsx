import { useEffect, useRef, useState, type FormEvent } from 'react';

/**
 * The app's own confirm window instead of the browser's confirm()/prompt().
 * `confirmDialog` and `promptDialog` can be called from anywhere; <DialogHost /> draws them.
 */

interface BaseOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** An action that cannot be undone: the confirm button is red and the focus starts on "Cancel". */
  danger?: boolean;
}

export interface PromptOptions extends BaseOptions {
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  /** If it returns an error text, confirming is blocked. */
  validate?: (value: string) => string | null;
  /** Exact text that must be typed (e.g. a name before deleting). Confirm stays off until it matches. */
  requireText?: string;
  mono?: boolean;
}

type Request =
  | ({ kind: 'confirm'; id: number; resolve: (ok: boolean) => void } & BaseOptions)
  | ({ kind: 'prompt'; id: number; resolve: (v: string | null) => void } & PromptOptions);

const listeners = new Set<(r: Request) => void>();
let nextId = 1;

function open(req: Omit<Request, 'id'>) {
  const full = { ...req, id: nextId++ } as Request;
  if (!listeners.size) {
    // If the window cannot be drawn (no host), play safe: do not do it.
    if (full.kind === 'confirm') full.resolve(false);
    else full.resolve(null);
    return;
  }
  listeners.forEach((l) => l(full));
}

export function confirmDialog(opts: BaseOptions): Promise<boolean> {
  return new Promise((resolve) => open({ kind: 'confirm', ...opts, resolve }));
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => open({ kind: 'prompt', ...opts, resolve }));
}

export function DialogHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  useEffect(() => {
    const l = (r: Request) => setQueue((q) => [...q, r]);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const current = queue[0];
  if (!current) return null;
  const done = (value: boolean | string | null) => {
    if (current.kind === 'confirm') current.resolve(value === true);
    else current.resolve(typeof value === 'string' ? value : null);
    setQueue((q) => q.slice(1));
  };
  return <DialogView key={current.id} req={current} onDone={done} />;
}

function DialogView({ req, onDone }: { req: Request; onDone: (v: boolean | string | null) => void }) {
  const isPrompt = req.kind === 'prompt';
  const [value, setValue] = useState(isPrompt ? (req.defaultValue ?? '') : '');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<Element | null>(document.activeElement);

  const cancel = () => onDone(isPrompt ? null : false);

  useEffect(() => {
    if (isPrompt) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else (req.danger ? cancelRef : okRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusBack = lastFocus.current;
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      if (focusBack instanceof HTMLElement) focusBack.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blocked = isPrompt && req.requireText !== undefined && value.trim() !== req.requireText;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isPrompt) return onDone(true);
    if (blocked) return;
    const v = value.trim();
    const err = req.validate?.(v) ?? (v ? null : 'This field cannot be empty');
    if (err) return setError(err);
    onDone(v);
  };

  // Keep the focus inside the window (Tab must not escape to the page behind).
  const trap = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Tab') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled)')];
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dlg-backdrop" onPointerDown={(e) => e.target === e.currentTarget && cancel()}>
      <form
        className={`dlg${req.danger ? ' dlg-danger' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`dlg-t-${req.id}`}
        aria-describedby={req.message ? `dlg-m-${req.id}` : undefined}
        onSubmit={submit}
        onKeyDown={trap}
      >
        <h2 id={`dlg-t-${req.id}`} className="dlg-title">
          {req.title}
        </h2>
        {req.message && (
          <p id={`dlg-m-${req.id}`} className="dlg-message">
            {req.message}
          </p>
        )}
        {isPrompt && (
          <label className="field dlg-field">
            {req.label && <span>{req.label}</span>}
            <input
              ref={inputRef}
              className={`input${req.mono ? ' mono' : ''}`}
              value={value}
              placeholder={req.placeholder}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setValue(e.target.value);
                setError('');
              }}
            />
          </label>
        )}
        {error && <p className="error-text dlg-error">{error}</p>}
        <div className="dlg-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={cancel}>
            {req.cancelLabel ?? 'Cancel'}
          </button>
          <button ref={okRef} type="submit" className={`btn ${req.danger ? 'btn-danger-solid' : 'btn-primary'}`} disabled={blocked}>
            {req.confirmLabel ?? 'OK'}
          </button>
        </div>
      </form>
    </div>
  );
}
