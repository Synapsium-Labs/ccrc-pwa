// The "last here" stamp (Overlord W1 home B, Task 6; spec §4.1: "last here is a per-device fact, kept on the device"; plan
// question 8): the time this device last showed the Overlord's place, in epoch milliseconds. L3 (context C5): it names the
// browser's storage, through the PWA's one storage port (`lib/storage.ts`), and it is the ONE reader and writer of its key.
//
// A per-viewer convenience and nothing more: storage can be absent, full, blocked or throw on being named, and then the
// device has no stamp, which the block reads as "the last 24 hours" (`sinceWords.ts`). So a failed read, an absent value
// and a value that is not a stamp all answer `null`, and a failed write changes nothing and answers `false`. The place
// READS the stamp first and WRITES the new one after, so the block it draws is measured from the visit before this one.
//
// The key avoids the letters "auth" (the resume banner's guard refuses any storage key that reads them).
import { readKey, writeKey, type StorageSource } from '../lib/storage';

export const LAST_HERE_KEY = 'ccrc:overlord-last-here:v1';

/** A stamp is a whole number of milliseconds: digits only, and a safe integer. Anything else is not one. */
const STAMP = /^\d{1,16}$/;

/** The stored stamp, or `null` for no storage, a store that throws, nothing stored and a value that is not a stamp. */
export function readLastHere(from?: StorageSource): number | null {
  const raw = readKey(LAST_HERE_KEY, from);
  if (raw === null || !STAMP.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** Keep `nowMs` as the stamp. `true` when the store took it; `false` when it threw or there is none (nothing changed). */
export function writeLastHere(nowMs: number, from?: StorageSource): boolean {
  return writeKey(LAST_HERE_KEY, String(Math.max(0, Math.floor(nowMs))), from);
}
