// FaceMark — the console's character in the bar, straight after the wordmark, in the mood the fleet is in (the Overlord
// face plan, Task 8; L4). It plays for `MOOD_PLAY_MS` after each change of mood, then holds the still frame (`play`
// false: the generated `.chr[data-still]` rules stop it; reduced motion is `Character`'s own). Its name is the art's
// label, a colon, then the cause: "The Orb asleep: …: nothing needs anyone".
import { useEffect, useState, type ReactNode } from 'react';
import { ART, Character } from '@ccrc/ui';
import type { Mood } from '../../../shared/face';
import { useCharacter } from '../lib/character';
import { useMood } from './useMood';

export const MOOD_PLAY_MS = 5000;

export function FaceMark(): ReactNode {
  const character = useCharacter();
  const { mood, cause } = useMood();
  // The mood whose play window has run out. A mood that is not it is new, so it plays at once, in the render that
  // shows it, with no frame of stillness between (and the first mood plays too).
  const [settled, setSettled] = useState<Mood | null>(null);
  useEffect(() => {
    const t = setTimeout(() => { setSettled(mood); }, MOOD_PLAY_MS);
    return () => { clearTimeout(t); };
  }, [mood]);
  return (
    <Character
      character={character}
      mood={mood}
      scale={1}
      play={settled !== mood}
      label={`${ART[character][mood].label}: ${cause}`}
      className="face-mark"
    />
  );
}
