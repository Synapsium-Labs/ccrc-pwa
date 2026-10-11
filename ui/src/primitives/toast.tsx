// Toast — module-level `toast()` plus one <ToastHost/> mounted in the app
// shell. No context: stores and api handlers can fire toasts directly. Info
// toasts announce politely (role=status); errors interrupt (role=alert) and
// wear the dead-red edge. Auto-dismisses; tap dismisses immediately. A toast
// carrying an action (e.g. a failed upload's Retry) sticks until answered — an
// offer that vanishes mid-reach is worse than none.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';

export type ToastKind = 'info' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
}

const TOAST_VISIBLE_MS = 4200;

let nextId = 1;
const listeners = new Set<(item: ToastItem) => void>();

let suppress: () => boolean = () => false;

/** Install a predicate that swallows toasts wholesale.
 *
 *  The app uses this for auth loss: a 401 is ONE event however many calls it
 *  breaks. The login screen is the answer to all of them; a stack of
 *  "unauthenticated" toasts behind it is noise about a fact already on screen,
 *  and an action toast would be an offer nothing can accept until the operator
 *  is back in. Dropped at this single funnel rather than at ~40 catch blocks.
 *
 *  It lives as an injected predicate rather than an import because this package
 *  must not know what an ccrc session is — a design system that imports the
 *  app's auth module is not a design system. */
export function setToastSuppressor(predicate: () => boolean): void {
  suppress = predicate;
}

/** Fire a toast from anywhere. Rendered by whatever <ToastHost/> is mounted;
 *  dropped silently when none is (e.g. in non-UI unit tests). */
export function toast(message: string, kind: ToastKind = 'info', action?: ToastAction): void {
  if (suppress()) return;
  const item: ToastItem = { id: nextId++, message, kind, action };
  for (const notify of listeners) notify(item);
}

export function ToastHost(): ReactNode {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onToast = (item: ToastItem): void => {
      setItems((cur) => [...cur, item]);
      if (item.action) return; // action toasts wait for an answer
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
    // Sits above the home bar AND above the composer when one is mounted —
    // --composer-h is published by SessionScreen and defaults to 0px.
    <div className="toast-host pointer-events-none fixed inset-x-0 bottom-[calc(var(--sp-6)+var(--safe-bottom)+var(--composer-h,0px))] z-toast grid justify-items-center gap-2 px-4">
      {items.map((item) => {
        const dismiss = (): void => setItems((cur) => cur.filter((i) => i.id !== item.id));
        const action = item.action;
        const error = item.kind === 'error';
        return (
          <div
            key={item.id}
            role={error ? 'alert' : 'status'}
            onClick={dismiss}
            className={cn(
              'toast pointer-events-auto flex min-h-tap max-w-[min(390px,100%)] cursor-pointer items-center gap-2 rounded-md border bg-raised px-4 py-3 font-ui text-sm font-regular leading-normal text-ink-primary shadow-card animate-toast-in motion-reduce:animate-none',
              error
                ? "toast--error border-[color-mix(in_srgb,var(--status-dead)_45%,var(--edge-strong))] before:font-mono before:text-sm before:font-semibold before:leading-none before:text-status-dead-text before:content-['!']"
                : 'border-edge-strong',
            )}
          >
            {item.message}
            {action && (
              // The 44px hit area overlaps the slip's padding, so the toast
              // stays slim while the target stays legal.
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss();
                  action.onClick();
                }}
                className={`toast-action -my-3 -mr-2 ml-1 min-h-tap flex-none cursor-pointer rounded-sm border-0 bg-none px-2 font-ui text-sm font-semibold leading-none text-phosphor transition-transform duration-press ease-swift active:scale-[0.94] motion-reduce:transition-none ${FOCUS_RING}`}
              >
                {action.label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
