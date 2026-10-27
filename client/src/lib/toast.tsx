import { useEffect, useState } from 'react';

type Listener = (msg: { id: number; text: string }) => void;
const listeners = new Set<Listener>();
let nextId = 1;

export function toast(text: string) {
  const msg = { id: nextId++, text };
  listeners.forEach((l) => l(msg));
}

export function Toaster() {
  const [items, setItems] = useState<{ id: number; text: string }[]>([]);
  useEffect(() => {
    const l: Listener = (m) => {
      setItems((xs) => [...xs, m]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== m.id)), 2600);
    };
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return (
    <div className="toast-wrap" aria-live="polite">
      {items.map((m) => (
        <div key={m.id} className="toast">
          {m.text}
        </div>
      ))}
    </div>
  );
}
