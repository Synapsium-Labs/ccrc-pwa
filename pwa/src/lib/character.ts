// The Overlord's character, the app's half (the Overlord face plan, Task 7) — modelled on `lib/skin.ts`.
//
// The CHOICE is one server row (`GET`/`POST /api/face`), so it follows a person to every device. This file keeps a
// device copy under `CHARACTER_STORAGE_KEY` for two jobs only: the first paint, before the server has answered, and
// offline. The server's answer replaces the copy; the copy never outranks it.
//
// APPLY, THEN WRITE, ONE AT A TIME. `setCharacter` sets the store and the copy at once, so the change shows with no
// reload, then asks the server. One write is in flight at a time (`inFlight`): a choice made meanwhile waits as the newest
// (`queued`, a newer choice replacing an older waiting one), and goes out when the write in flight settles, if it differs
// from what the server last answered. So the server receives writes in the order they were made, and the last one wins
// there as on screen. A refusal puts back the value the server last answered (`confirmed`), never a guess.
// A write whose OUTCOME IS UNKNOWN (no answer: a dropped connection, a truncated body, a 5xx) may or may not have been
// stored, so `confirmed` may be stale: the choice is read once more before anything is sent or put back, and a choice
// waiting is sent when it differs from what that read returned (`reconcile`).
// The choice is read again when sign-in is regained (`onAuthRegained`): a read refused at boot, on an armed box with no
// cookie yet, must not leave this device on its own copy. That read waits while a write is out (`readWanted`), so a read
// answered before the write's effect never wins over the write's answer.
import { useSyncExternalStore } from 'react';
import { DEFAULT_CHARACTER, isCharacter, type Character as CharacterName } from '../../../shared/face';
import { api, type FaceAnswer } from './api';
import { ApiError } from './apiError';
import { onAuthRegained } from './auth';
import { readKey, writeKey } from './storage';

export const CHARACTER_STORAGE_KEY = 'ccrc-character';

/** The device copy: the stored choice, or the default when nothing valid is stored. */
function storedCharacter(): CharacterName {
  const v = readKey(CHARACTER_STORAGE_KEY);
  return isCharacter(v) ? v : DEFAULT_CHARACTER;
}

let current: CharacterName = DEFAULT_CHARACTER;
/** What the server last answered, in REQUEST order: an answer sets it only when its request is newer than the one
 *  that set it (`confirmedSeq`), so a late answer to an older request never overwrites a newer one. */
let confirmed: CharacterName = DEFAULT_CHARACTER;
let confirmedSeq = 0;
/** One counter for every request, the boot read and each write. */
let seq = 0;
/** Whether a write is out, and the newest choice made while it is (`null`: none waiting). */
let inFlight = false;
let queued: CharacterName | null = null;
/** A read was asked for (sign-in regained) while a write was out: made when the write settles. */
let readWanted = false;
/** Bumped by the test reset, so an answer to a request of an earlier test settles nothing. */
let generation = 0;
const listeners = new Set<() => void>();

function show(c: CharacterName): void {
  current = c;
  writeKey(CHARACTER_STORAGE_KEY, c); // refused (private window): the session keeps the choice anyway
  for (const l of listeners) l();
}

/** Fold an answer into `confirmed` when its request is the newest answered so far. */
function fold(id: number, answer: FaceAnswer | null): void {
  if (answer !== null && isCharacter(answer.character) && id > confirmedSeq) {
    confirmed = answer.character;
    confirmedSeq = id;
  }
}

/** The boot read (or the read after sign-in) settled, answered or failed (`null`). Unless a write is out or waiting
 *  (it will settle the display), show what the server last answered. */
function settleRead(gen: number, id: number, answer: FaceAnswer | null): void {
  if (gen !== generation) return;
  fold(id, answer);
  if (!inFlight && queued === null) show(confirmed);
}

/** The write in flight (and any reconciling read) is over. Send the newest choice made meanwhile, if the server does not
 *  already hold it, or else show what the server last answered (a refusal puts the last confirmed value back); then make
 *  a read that was asked for while the write was out. */
function endWrite(): void {
  inFlight = false;
  const next = queued;
  queued = null;
  if (next !== null && next !== confirmed) { send(next); return; }
  show(confirmed);
  if (readWanted) { readWanted = false; readNow(); }
}

/** The write in flight settled: `answered`, `refused` (a 4xx: the server did not store it) or `unknown` (anything else,
 *  which may have been stored). Only an unknown outcome is read again. */
function settleWrite(gen: number, id: number, outcome: FaceAnswer | 'refused' | 'unknown'): void {
  if (gen !== generation) return;
  if (outcome === 'unknown') { reconcile(gen); return; }
  fold(id, outcome === 'refused' ? null : outcome);
  endWrite();
}

/** After a write of unknown outcome: read the row once (the write stays "in flight", so a press meanwhile still queues),
 *  fold the answer, then `endWrite` sends a queued choice that differs from what the server holds. */
function reconcile(gen: number): void {
  readWanted = false; // this read comes after the sign-in that asked for one
  const id = ++seq;
  api.getFace().then((a) => { if (gen === generation) { fold(id, a); endWrite(); } },
    () => { if (gen === generation) endWrite(); });
}

const outcomeOf = (err: unknown): 'refused' | 'unknown' =>
  err instanceof ApiError && err.status < 500 ? 'refused' : 'unknown';

function send(c: CharacterName): void {
  inFlight = true;
  const gen = generation;
  const id = ++seq;
  api.setFace(c).then(
    (a) => settleWrite(gen, id, isCharacter(a?.character) ? a : 'unknown'),
    (err: unknown) => settleWrite(gen, id, outcomeOf(err)),
  );
}

/** Ask the server for the row, once no write is out (sign-in regained, boot). */
function readServer(): void {
  if (inFlight) { readWanted = true; return; }
  readNow();
}

function readNow(): void {
  const gen = generation;
  const id = ++seq;
  api.getFace().then((a) => settleRead(gen, id, a), () => settleRead(gen, id, null));
}

/** Read the device copy, then the server's row, at boot (main.tsx). A failed read keeps the copy. */
export function initCharacter(): void {
  const copy = storedCharacter();
  confirmed = copy;
  confirmedSeq = 0;
  current = copy;
  for (const l of listeners) l();
  readServer();
}

// Sign-in regained: read the row again. It does not touch the device copy or the display, so a choice made since boot
// stays in force until its own answer or this read's, in request order.
onAuthRegained(readServer);

/** Apply a choice now, then write it (at once, or when the write in flight settles). */
export function setCharacter(c: CharacterName): void {
  show(c);
  if (inFlight) queued = c;
  else send(c);
}

/** Back to the module's first state, for tests: the store, the order counters and the write queue. An answer still on
 *  its way from an earlier case settles nothing. */
export function resetCharacterForTests(): void {
  generation += 1;
  current = DEFAULT_CHARACTER;
  confirmed = DEFAULT_CHARACTER;
  confirmedSeq = 0;
  seq = 0;
  inFlight = false;
  queued = null;
  readWanted = false;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

/** The character in force. Re-renders on every `setCharacter`, wherever it is called. */
export function useCharacter(): CharacterName {
  return useSyncExternalStore(subscribe, () => current, () => DEFAULT_CHARACTER);
}
