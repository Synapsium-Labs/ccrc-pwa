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
// when a person chooses — never on resize, and never on a device change
// mid-session, which would remount a shell under the person using it.
//
// THE DEVICE IS READ ONCE PER PAGE LOAD (D-5096). `initSkin()` asks
// DEVICE_QUERY at boot and keeps the answer for the page's life; nothing
// subscribes to the query, so a tablet docking a keyboard, or device emulation
// toggled in a desktop browser, changes nothing until the next load (spec §12,
// O2). This DEPARTS from `initTheme`, which follows the colour scheme live: a
// palette swap repaints in place, but under W2 a skin swap is a different
// shell, and a live re-resolve would remount it mid-task.
import { useSyncExternalStore } from 'react';
import {
  AUTO, DEVICE_QUERY, REFINED, SKIN_STORAGE_KEY, applySkin, resolveSkin, skinPreference,
  type SkinId, type SkinPreference,
} from '@ccrc/ui';

/** The stored choice — a skin, or AUTO ("Match this device") — and AUTO when
 *  nothing is stored, the value is unknown, or storage is unreadable.
 *
 *  Storage throws in a private window, in previews and in thumbnail capture,
 *  and this runs before first render — an exception here is a blank app, so
 *  the read is guarded and a failure is simply "no choice", which is AUTO. */
export function storedSkin(): SkinPreference {
  try {
    return skinPreference(localStorage.getItem(SKIN_STORAGE_KEY));
  } catch {
    return AUTO;
  }
}

/** Remember a choice. A failed write is not an error the person needs: the
 *  skin still applies for this session, it just will not survive a reload. */
export function rememberSkin(choice: SkinPreference): void {
  try {
    localStorage.setItem(SKIN_STORAGE_KEY, choice);
  } catch {
    /* private window, blocked storage — the session keeps the skin anyway */
  }
}

/** Is this a desk? DEVICE_QUERY's answer, asked once. A missing or throwing
 *  `matchMedia` (an old engine, a locked-down embed) means not a desk, which
 *  is the touch answer: Refined. */
function readDevice(): boolean {
  try {
    return window.matchMedia(DEVICE_QUERY).matches === true;
  } catch {
    return false;
  }
}

/** The device as `initSkin()` read it, kept for the page's life. Before boot
 *  it is the touch answer, so a choice made before `initSkin()` (none is, in
 *  the app) resolves as a phone's would. */
let deskAtBoot = false;

let current: SkinId = REFINED;
const listeners = new Set<() => void>();

function stamp(id: SkinId): void {
  current = id;
  applySkin(id, document.documentElement);
  for (const l of listeners) l();
}

/** Apply a choice now, remember it, and tell every `useSkin()` consumer.
 *  AUTO ("Match this device") is remembered as AUTO and stamped as what it
 *  resolves to against the BOOT reading of the device — never a fresh one.
 *  Applied BEFORE it is written, so storage that throws still leaves the
 *  chosen skin on screen. An unknown id asks for AUTO, rather than stamping an
 *  attribute no block answers. */
export function setSkin(choice: string): void {
  const asked = skinPreference(choice);
  stamp(resolveSkin(asked, deskAtBoot));
  rememberSkin(asked);
}

/** Read the device, then stamp the stored choice, at boot (main.tsx).
 *  index.html stamped the stored VALUE before first paint, verbatim, or the
 *  device rule's answer when there was none; this resolves it against the
 *  catalogue, so an unknown one takes the device rule the moment the bundle
 *  runs. Called once per page load: the reading is never refreshed after. */
export function initSkin(): void {
  deskAtBoot = readDevice();
  stamp(resolveSkin(storedSkin(), deskAtBoot));
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

/** The skin in force: `'refined'` or `'instrument'`. Re-renders on `setSkin`. */
export function useSkin(): SkinId {
  return useSyncExternalStore(subscribe, () => current, () => REFINED);
}
