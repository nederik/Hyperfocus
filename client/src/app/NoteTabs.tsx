import { useEffect, useRef, useState } from 'react';
import type { NoteTab } from '@hyperfocus/shared';
import { confirmDialog } from '../lib/dialog';

/** The mouse wheel scrolls the tab strip sideways; the selected tab stays visible. */
export function useTabStrip(el: HTMLElement | null, active: unknown, count: number) {
  useEffect(() => {
    el?.querySelector<HTMLElement>('.nt-tabitem.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [el, active, count]);
  useEffect(() => {
    if (!el) return;
    // Wheel steps during smooth scrolling are not lost: the target position adds up
    let target: number | null = null;
    let timer = 0;
    const onWheel = (e: WheelEvent) => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const step = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * el.clientWidth : e.deltaY;
      target = Math.max(0, Math.min(max, (target ?? el.scrollLeft) + step));
      el.scrollTo({ left: target, behavior: 'smooth' });
      clearTimeout(timer);
      timer = window.setTimeout(() => (target = null), 400);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      clearTimeout(timer);
      el.removeEventListener('wheel', onWheel);
    };
  }, [el]);
}

/**
 * Note tabs: right of the title. Click: go to that page; double-click: rename; ×: delete; +: new page.
 * The last remaining tab cannot be deleted.
 */
export function NoteTabs({
  tabs,
  active,
  counts,
  onSelect,
  onChange,
  onAdd,
}: {
  tabs: NoteTab[];
  active: string;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
  /** The tab list changed (renamed or deleted; `removedId` is the deleted tab). */
  onChange: (tabs: NoteTab[], removedId?: string) => void;
  onAdd: (tab: NoteTab) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  useTabStrip(scroller, active, tabs.length);

  const add = () => {
    let n = tabs.length + 1;
    while (tabs.some((t) => t.name === `Page ${n}`)) n++;
    onAdd({ id: crypto.randomUUID().slice(0, 13), name: `Page ${n}` });
  };

  const remove = async (t: NoteTab) => {
    if (tabs.length <= 1) return;
    const count = counts[t.id] ?? 0;
    if (count > 0) {
      const ok = await confirmDialog({
        title: `Delete “${t.name}”?`,
        message: `This page and its ${count} ${count === 1 ? 'note' : 'notes'} will be deleted. This cannot be undone.`,
        confirmLabel: 'Delete page',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;
    }
    onChange(
      tabs.filter((x) => x.id !== t.id),
      t.id,
    );
  };

  return (
    <div className="nt-tabs">
      <div className="nt-tabscroll" ref={setScroller} role="tablist" aria-label="Note pages">
      {tabs.map((t) =>
        renaming === t.id ? (
          <RenameInput
            key={t.id}
            value={t.name}
            onDone={(name) => {
              setRenaming(null);
              if (name && name !== t.name) onChange(tabs.map((x) => (x.id === t.id ? { ...x, name } : x)));
            }}
          />
        ) : (
          <div key={t.id} className={`nt-tabitem${t.id === active ? ' on' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={t.id === active}
              className="nt-tabbtn"
              onClick={() => onSelect(t.id)}
              onDoubleClick={() => setRenaming(t.id)}
              title="Double-click to rename"
            >
              {t.name}
            </button>
            {tabs.length > 1 && (
              <button type="button" className="nt-tabx" onClick={() => void remove(t)} title={`Delete “${t.name}”`} aria-label={`Delete ${t.name}`}>
                ×
              </button>
            )}
          </div>
        ),
      )}
      </div>
      <button type="button" className="nt-tabadd" onClick={add} title="New page" aria-label="New page">
        +
      </button>
    </div>
  );
}

function RenameInput({ value, onDone }: { value: string; onDone: (name: string) => void }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="nt-tabinput"
      value={v}
      maxLength={60}
      size={Math.max(6, v.length + 1)}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(v.trim());
        if (e.key === 'Escape') onDone(value);
        e.stopPropagation();
      }}
    />
  );
}
