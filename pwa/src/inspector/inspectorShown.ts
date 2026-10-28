// Whether the right-side inspector is shown (desktop polish T3e, D-6385): one choice per device, one derived fact, and
// the one slot that lets the command layer reach the part that places the rail.
//
// THE CHOICE is `ccrc-inspector` in `localStorage`, and only the exact word `hidden` hides: absent, any other value and
// storage that throws all read as shown, so a first visit, a private window and a value a later build writes all draw
// the rail. It is applied in memory BEFORE it is written (as `setSkin` is), so storage that refuses still toggles for
// the page; it just will not survive a reload. Nothing else reads or writes the key.
//
// THE SHOWN FACT is `useInspectorShown()`: the rail's width AND the choice. The rail, `SessionScreen`'s strips rule and
// the frame's `data-inspector` attribute all read it, so a hidden rail brings the task and mail strips back into the
// column and each is mounted once at any width.
//
// THE TARGET SLOT mirrors `SessionFlows`': the command layer is mounted above the frame and the rail inside it, so the
// rail publishes `{ shown, toggle }` while it is placeable, shown or hidden, and the layer and the header's toggle
// subscribe. One slot: one rail is mounted at a time.
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { InspectorCommandTarget } from '../command/registry';
import { useMediaQuery } from '../lib/useMediaQuery';
import { INSPECTOR_QUERY } from './useInspectorSession';

/** The stored choice's key: the one place it is written. */
export const INSPECTOR_STORAGE_KEY = 'ccrc-inspector';

/** The word stored for a hidden rail; the only value that hides. */
const HIDDEN = 'hidden';

/** Is the stored choice "hidden"? Only the exact word is; absent, unknown and unreadable storage are not. Storage
 *  throws in a private window and in previews, so the read is guarded: a failure is "no choice", which is shown. */
export function storedInspectorHidden(): boolean {
  try {
    return localStorage.getItem(INSPECTOR_STORAGE_KEY) === HIDDEN;
  } catch {
    return false;
  }
}

/** The choice in force for this page: the stored one until a person makes one, then theirs. `null` until first read. */
let memory: boolean | null = null;
const choiceListeners = new Set<() => void>();

/** The choice now: hidden or not. */
export function inspectorHidden(): boolean {
  memory ??= storedInspectorHidden();
  return memory;
}

/** Apply a choice now, tell every subscriber, and remember it. Applied BEFORE it is written, so storage that throws
 *  still leaves the rail hidden or shown for the page. */
export function setInspectorHidden(hidden: boolean): void {
  memory = hidden;
  for (const l of [...choiceListeners]) l();
  try {
    localStorage.setItem(INSPECTOR_STORAGE_KEY, hidden ? HIDDEN : 'shown');
  } catch {
    /* private window, blocked storage: the page keeps the choice anyway */
  }
}

/** Forget this page's copy, as a fresh page load would: the next read asks storage again. For tests only: a reload
 *  keeps storage and loses this. */
export function resetInspectorChoiceForTests(): void {
  memory = null;
  for (const l of [...choiceListeners]) l();
}

function subscribeChoice(l: () => void): () => void {
  choiceListeners.add(l);
  return () => { choiceListeners.delete(l); };
}

/** The stored choice, live: re-renders when it is made. Server-side and before any choice it reads shown. */
export function useInspectorHidden(): boolean {
  return useSyncExternalStore(subscribeChoice, inspectorHidden, () => false);
}

/** THE shown fact: the skin may place the rail at this width (`INSPECTOR_QUERY`) and nobody hid it. Whether the SET
 *  has an inspector part is the caller's own check (`ShellFrame`, `SessionScreen`): a skin that places none is never
 *  "shown". */
export function useInspectorShown(): boolean {
  const wide = useMediaQuery(INSPECTOR_QUERY);
  const hidden = useInspectorHidden();
  return wide && !hidden;
}

// THE TARGET THE COMMAND LAYER AND THE HEADER'S TOGGLE READ.
let target: InspectorCommandTarget | null = null;
const targetListeners = new Set<() => void>();
function publish(next: InspectorCommandTarget | null): void {
  target = next;
  for (const l of [...targetListeners]) l();
}
function subscribeTarget(l: () => void): () => void {
  targetListeners.add(l);
  return () => { targetListeners.delete(l); };
}

/** The placed inspector's command target, or null where none is placed (`CommandLayer`'s `ctx.inspector`, and the
 *  header toggle's mount condition). */
export function useInspectorCommandTarget(): InspectorCommandTarget | null {
  return useSyncExternalStore(subscribeTarget, () => target, () => null);
}

/** Publish `next` while the calling part is mounted (null while it is not placeable). A change replaces the slot in
 *  place, with no empty moment between, and an unmount clears it only if it is still the one published. */
export function usePublishInspectorTarget(next: InspectorCommandTarget | null): void {
  const latest = useRef(next);
  useLayoutEffect(() => {
    latest.current = next;
    publish(next);
  }, [next]);
  useLayoutEffect(() => () => {
    if (target === latest.current) publish(null);
  }, []);
}
