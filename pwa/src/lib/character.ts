// The Overlord's character, the app's half (the Overlord face plan, Task 7) — modelled on `lib/skin.ts`.
//
// The CHOICE is one server row (`GET`/`POST /api/face`), so it follows a person to every device. This file keeps a
// device copy under `CHARACTER_STORAGE_KEY` for two jobs only: the first paint, before the server has answered, and
// offline. The server's answer replaces the copy; the copy never outranks it.
//
// APPLY, THEN WRITE. `setCharacter` sets the store and the copy at once, so the change shows with no reload, then asks
// the server. A refusal or a failed write puts back the value the server last answered (`confirmed`), never a guess.
import { useSyncExternalStore } from 'react';
import { CHARACTERS, DEFAULT_CHARACTER, isCharacter, type Character as CharacterName } from '../../../shared/face';
import { api, type FaceAnswer } from './api';
import { readKey, writeKey } from './storage';

export const CHARACTER_STORAGE_KEY = 'ccrc-character';

const CHARACTER_LABEL: Record<CharacterName, string> = { orb: 'The Orb', 'dark-lord': 'The Dark Lord' };
/** The choices, in the vocabulary's order: the Settings cards and the Switch character command both read this. */
export const CHARACTER_CHOICES: readonly { id: CharacterName; label: string }[] =
  CHARACTERS.map((id) => ({ id, label: CHARACTER_LABEL[id] }));

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
/** The writes sent and not yet settled. */
const pending = new Set<number>();
const listeners = new Set<() => void>();

function show(c: CharacterName): void {
  current = c;
  writeKey(CHARACTER_STORAGE_KEY, c); // refused (private window): the session keeps the choice anyway
  for (const l of listeners) l();
}

/** A request settled, answered (`answer`) or failed (`null`). Fold an answer into `confirmed` if it is the newest so
 *  far; then, unless a newer write is still out (it will settle the display), show what the server last answered. */
function settle(id: number, answer: FaceAnswer | null): void {
  pending.delete(id);
  if (answer !== null && isCharacter(answer.character) && id > confirmedSeq) {
    confirmed = answer.character;
    confirmedSeq = id;
  }
  if (![...pending].some((w) => w > id)) show(confirmed);
}

/** Read the device copy, then the server's row, at boot (main.tsx). A failed read keeps the copy. */
export function initCharacter(): void {
  const copy = storedCharacter();
  confirmed = copy;
  confirmedSeq = 0;
  current = copy;
  for (const l of listeners) l();
  const id = ++seq;
  api.getFace().then((a) => settle(id, a), () => settle(id, null));
}

/** Apply a choice now, then write it. */
export function setCharacter(c: CharacterName): void {
  const id = ++seq;
  pending.add(id);
  show(c);
  api.setFace(c).then((a) => settle(id, a), () => settle(id, null));
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

/** The character in force. Re-renders on every `setCharacter`, wherever it is called. */
export function useCharacter(): CharacterName {
  return useSyncExternalStore(subscribe, () => current, () => DEFAULT_CHARACTER);
}
