// One slot for a command target that a mounted part publishes and the command layer reads (C12, T3e's
// `t3e-target-slot-helper`). The layer is mounted above the frame (D-5467) and the part inside it, so the part
// publishes its target while it is mounted, and the layer (and a door that reads the same target) subscribes. ONE value
// per slot: one part of each kind is mounted at a time, and a part clears the slot on unmount only if its value is
// still the one published, so a part that mounted in its place keeps its own. `SessionFlows`' session target and the
// inspector rail's target (`inspectorShown.ts`) are its two slots.
import { useSyncExternalStore } from 'react';

export interface TargetSlot<T> {
  /** The value published now, or null. */
  current(): T | null;
  /** Replace the published value, with no empty moment between, and tell every reader. */
  publish(next: T | null): void;
  /** Empty the slot, but only while `mine` is still the value published. */
  clear(mine: T | null): void;
  /** The published value, live: re-renders on every publish. Server-side it reads null. */
  useValue(): T | null;
}

export function createTargetSlot<T>(): TargetSlot<T> {
  let value: T | null = null;
  const readers = new Set<() => void>();
  const subscribe = (l: () => void): (() => void) => {
    readers.add(l);
    return () => { readers.delete(l); };
  };
  const current = (): T | null => value;
  const publish = (next: T | null): void => {
    value = next;
    for (const l of [...readers]) l();
  };
  return {
    current,
    publish,
    clear: (mine) => { if (value === mine) publish(null); },
    useValue: () => useSyncExternalStore(subscribe, current, () => null),
  };
}
