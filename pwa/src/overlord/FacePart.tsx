// The face on the Overlord's place (Overlord W1 home B, Task 6; plan question 11, slug `mood-plays-five-seconds`). L4
// (context C5, the `overlord/**` row; the mood it reads is C6's): the console's character at scale 4, in the mood `useMood()` answers, with the mood's cause in its accessible name. It
// plays for `MOOD_PLAY_MS` after each change of mood and then holds the still frame, exactly as the bar's mark does, so it
// needs no pause control (WCAG 2.2.2); reduced motion is `Character`'s own.
//
// ONE FACT, ONE READER: the mood is `useMood()`'s and its name is `FaceMark`'s (the art's label, a colon, the cause), so the
// place and the bar never say two things about one face. The play window below is `FaceMark`'s mechanism, restated here because
// it lives inside that component (a hook shared by both is the follow-up).
//
// CLASS NAME for the place's one stylesheet: `ov-face` (the face's box: 128 px square, centred or beside the heading).
import { useEffect, useState, type ReactNode } from 'react';
import { ART, Character } from '@ccrc/ui';
import type { Mood } from '../../../shared/face';
import { MOOD_PLAY_MS } from '../face/FaceMark';
import { useMood } from '../face/useMood';
import { useCharacter } from '../lib/character';

export function FacePart(): ReactNode {
  const character = useCharacter();
  const { mood, cause } = useMood();
  // The play window of the mood now shown, as `FaceMark` keeps it: a change of mood to ANY mood opens a new window in the
  // render that shows it (state set during render, so no frame of stillness between), and a window is shut by its own timer.
  const [win, setWin] = useState<{ mood: Mood | null; done: boolean }>({ mood: null, done: false });
  if (win.mood !== mood) setWin({ mood, done: false });
  useEffect(() => {
    const t = setTimeout(() => { setWin({ mood, done: true }); }, MOOD_PLAY_MS);
    return () => { clearTimeout(t); };
  }, [mood]);
  return (
    <Character
      character={character}
      mood={mood}
      scale={4}
      play={win.mood !== mood || !win.done}
      label={`${ART[character][mood].label}: ${cause}`}
      className="ov-face"
    />
  );
}
