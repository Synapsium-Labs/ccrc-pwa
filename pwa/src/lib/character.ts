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
// there as on screen. A refusal or a failed write puts back the value the server last answered (`confirmed`), never a guess.
// The choice is read again when sign-in is regained (`onAuthRegained`): a read refused at boot, on an armed box with no
// cookie yet, must not leave this device on its own copy.
import { useSyncExternalStore } from 'react';
import { DEFAULT_CHARACTER, isCharacter, type Character as CharacterName } from '../../../shared/face';
import { api, type FaceAnswer } from './api';
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

/** The write in flight settled. Fold its answer; then send the newest choice made meanwhile, if the server does not
 *  already hold it, or else show what the server last answered (a refusal puts the last confirmed value back). */
function settleWrite(gen: number, id: number, answer: FaceAnswer | null): void {
  if (gen !== generation) return;
  inFlight = false;
  fold(id, answer);
  const next = queued;
  queued = null;
  if (next !== null && next !== confirmed) { send(next); return; }
  show(confirmed);
}

function send(c: CharacterName): void {
  inFlight = true;
  const gen = generation;
  const id = ++seq;
  api.setFace(c).then((a) => settleWrite(gen, id, a), () => settleWrite(gen, id, null));
}

/** Ask the server for the row. */
function readServer(): void {
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
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

/** The character in force. Re-renders on every `setCharacter`, wherever it is called. */
export function useCharacter(): CharacterName {
  return useSyncExternalStore(subscribe, () => current, () => DEFAULT_CHARACTER);
}
