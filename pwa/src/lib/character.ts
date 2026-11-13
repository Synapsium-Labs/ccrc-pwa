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
import { api } from './api';
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
/** What the server last answered; what a refused write puts back. */
let confirmed: CharacterName = DEFAULT_CHARACTER;
/** Bumped by every choice, so a read that answers after a choice does not overwrite it. */
let choices = 0;
const listeners = new Set<() => void>();

function show(c: CharacterName): void {
  current = c;
  writeKey(CHARACTER_STORAGE_KEY, c); // refused (private window): the session keeps the choice anyway
  for (const l of listeners) l();
}

/** Read the device copy, then the server's row, at boot (main.tsx). A failed read keeps the copy. */
export function initCharacter(): void {
  const copy = storedCharacter();
  confirmed = copy;
  current = copy;
  for (const l of listeners) l();
  const asked = choices;
  api.getFace().then((a) => {
    if (!isCharacter(a.character)) return;
    confirmed = a.character;
    if (choices === asked) show(a.character);
  }).catch(() => { /* offline or an older server: the copy stands */ });
}

/** Apply a choice now, then write it. */
export function setCharacter(c: CharacterName): void {
  const mine = ++choices;
  show(c);
  api.setFace(c).then((a) => {
    if (isCharacter(a.character)) confirmed = a.character;
  }).catch(() => {
    if (choices === mine) show(confirmed);
  });
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

/** The character in force. Re-renders on every `setCharacter`, wherever it is called. */
export function useCharacter(): CharacterName {
  return useSyncExternalStore(subscribe, () => current, () => DEFAULT_CHARACTER);
}
