// The characters' display copy (the Overlord face plan, Task 7; L1: words only). The Settings cards and the Switch
// character command both read `CHARACTER_CHOICES`, so a name is written once.
import { CHARACTERS, type Character } from '../../../shared/face';

export const CHARACTER_LABEL: Record<Character, string> = { orb: 'The Orb', 'dark-lord': 'The Dark Lord' };

/** The choices, in the vocabulary's order. */
export const CHARACTER_CHOICES: readonly { id: Character; label: string }[] =
  CHARACTERS.map((id) => ({ id, label: CHARACTER_LABEL[id] }));
