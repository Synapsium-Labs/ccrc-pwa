// The Overlord's face vocabulary (L0, context K): which characters ship and which moods each can wear. Pure
// vocabulary, imports nothing. The art itself lives in `ui/src/characters/` (generated from the brand brief's SVGs);
// the mood a console chooses lives in `pwa/src/face/`; the character a person chooses is one server row.

/** The characters that ship: the Orb and the Dark Lord. */
export const CHARACTERS = ['orb', 'dark-lord'] as const;
export type Character = typeof CHARACTERS[number];
export const DEFAULT_CHARACTER: Character = 'orb';

/** The moods that ship, the brief's table order. The one list: a shorter answer to the brief's question 4 trims it here. */
export const MOODS = ['neutral', 'happy', 'laughing', 'sleeping', 'thinking', 'alert', 'suspicious', 'confused',
  'sad', 'crying', 'afraid', 'angry', 'dizzy', 'offline'] as const;
export type Mood = typeof MOODS[number];

/** The only way to narrow an untrusted value (a stored choice, a wire field) to a `Character`: the CONSTANT is
 *  searched, never the input cast (`isSessionRole`'s rule). */
export function isCharacter(v: unknown): v is Character {
  return typeof v === 'string' && (CHARACTERS as readonly string[]).includes(v);
}

/** The only way to narrow an untrusted value to a `Mood` (`isCharacter`'s rule). */
export function isMood(v: unknown): v is Mood {
  return typeof v === 'string' && (MOODS as readonly string[]).includes(v);
}
