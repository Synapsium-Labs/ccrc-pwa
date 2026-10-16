// The skin's app half (D-5093) — modelled on `lib/theme.ts`.
//
// This file owns three things: the stored choice, the boot stamp, and the
// `useSkin()` subscription. WHICH skins exist, what they are called and what
// stamping one means are @ccrc/ui's (`styles/skins.ts`); this app picks among
// them, it never enumerates them.
//
// `useSkin()` is what W2's shells branch on (`SKIN_SETS[useSkin()].Shell` in
// `app.tsx`, the one switch point in shared code). Until then nothing calls
// it: a switch changes tokens only, so nothing remounts. The skin changes only
// when a person chooses — never on resize, and (Task 12a) never on a device
// change mid-session, which would remount a shell under the person using it.
import { useSyncExternalStore } from 'react';
import { REFINED, SKIN_STORAGE_KEY, applySkin, resolveSkin, type SkinId } from '@ccrc/ui';

/** The stored choice, or REFINED when there is none or it is unreadable.
 *
 *  Storage throws in a private window, in previews and in thumbnail capture,
 *  and this runs before first render — an exception here is a blank app, so
 *  the read is guarded and a failure is simply "no choice". */
export function storedSkin(): SkinId {
  try {
    return resolveSkin(localStorage.getItem(SKIN_STORAGE_KEY));
  } catch {
    return REFINED;
  }
}

/** Remember a choice. A failed write is not an error the person needs: the
 *  skin still applies for this session, it just will not survive a reload. */
export function rememberSkin(id: SkinId): void {
  try {
    localStorage.setItem(SKIN_STORAGE_KEY, id);
  } catch {
    /* private window, blocked storage — the session keeps the skin anyway */
  }
}

let current: SkinId = REFINED;
const listeners = new Set<() => void>();

function stamp(id: SkinId): void {
  current = id;
  applySkin(id, document.documentElement);
  for (const l of listeners) l();
}

/** Apply a choice now, remember it, and tell every `useSkin()` consumer.
 *  Applied BEFORE it is written, so storage that throws still leaves the
 *  chosen skin on screen. An unknown id resolves to REFINED rather than
 *  stamping an attribute no block answers. */
export function setSkin(id: string): void {
  const skin = resolveSkin(id);
  stamp(skin);
  rememberSkin(skin);
}

/** Stamp the stored choice at boot (main.tsx). index.html stamped the stored
 *  VALUE before first paint, verbatim; this corrects an unknown one to Refined
 *  the moment the bundle runs. */
export function initSkin(): void {
  stamp(storedSkin());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

/** The skin in force: `'refined'` or `'instrument'`. Re-renders on `setSkin`. */
export function useSkin(): SkinId {
  return useSyncExternalStore(subscribe, () => current, () => REFINED);
}
