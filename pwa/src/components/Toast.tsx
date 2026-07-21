// Toast — module-level `toast()` plus one <ToastHost/> mounted in the app
// shell. No context: stores and api handlers can fire toasts directly. Info
// toasts announce politely (role=status); errors interrupt (role=alert) and
// wear the dead-red edge. Auto-dismisses; tap dismisses immediately.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import './primitives.css';

export type ToastKind = 'info' | 'error';

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const TOAST_VISIBLE_MS = 4200;

let nextId = 1;
const listeners = new Set<(item: ToastItem) => void>();

/** Fire a toast from anywhere. Rendered by whatever <ToastHost/> is mounted;
 *  dropped silently when none is (e.g. in non-UI unit tests). */
export function toast(message: string, kind: ToastKind = 'info'): void {
  const item: ToastItem = { id: nextId++, message, kind };
  for (const notify of listeners) notify(item);
}

export function ToastHost(): ReactNode {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onToast = (item: ToastItem): void => {
      setItems((cur) => [...cur, item]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        setItems((cur) => cur.filter((i) => i.id !== item.id));
      }, TOAST_VISIBLE_MS);
      timers.add(timer);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="toast-host">
      {items.map((item) => (
        <div
          key={item.id}
          className={item.kind === 'error' ? 'toast toast--error' : 'toast'}
          role={item.kind === 'error' ? 'alert' : 'status'}
          onClick={() => setItems((cur) => cur.filter((i) => i.id !== item.id))}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
