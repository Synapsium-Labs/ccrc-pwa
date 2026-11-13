// The splash screen the installed app opens on (the Overlord face plan, Task 9; L4). It decides nothing: it reads
// `matchMedia` once at boot, keeps the mount time, runs the two timers and holds the latch (state), and `splashShows` answers.
// `aria-hidden`: the app beneath is the content, and nothing here takes a pointer.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Character, Wordmark, usePrefersReducedMotion } from '@ccrc/ui';
import { useCharacter } from '../lib/character';
import { useFleetStore } from '../stores/fleet';
import { SPLASH_MAX_MS, SPLASH_MOTTO, SPLASH_TAGLINE, SPLASH_TYPE_MS, splashShows } from './splash';
import './splash.css';

function installed(): boolean {
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    return false;
  }
}

export function Splash(): ReactNode {
  const character = useCharacter();
  const frameSeen = useFleetStore((s) => s.fleetFrameSeen);
  const reducedMotion = usePrefersReducedMotion();
  const [standalone] = useState(installed);
  const mountedAt = useRef(0);
  // Time since mount, advanced only by the timers below, so no render reads the clock.
  const [sinceMs, setSinceMs] = useState(0);
  // The latch: once closed, stays closed.
  const [open, setOpen] = useState(true);

  const shows = open && splashShows({ standalone, sinceMs, frameSeen, reducedMotion });

  useEffect(() => { mountedAt.current = Date.now(); }, []);
  useEffect(() => { if (!shows) setOpen(false); }, [shows]);
  useEffect(() => {
    if (!open) return;
    const ids = [SPLASH_TYPE_MS, SPLASH_MAX_MS].map((ms) =>
      setTimeout(() => { setSinceMs(Date.now() - mountedAt.current); }, Math.max(0, ms - (Date.now() - mountedAt.current))));
    return () => { ids.forEach(clearTimeout); };
  }, [open, frameSeen]);

  if (!shows) return null;
  return (
    <div className="splash" aria-hidden="true" data-testid="splash">
      <Character character={character} mood="neutral" scale={4} />
      <Wordmark mark="overlord" typed />
      <p className="splash-tagline">{SPLASH_TAGLINE}</p>
      <p className="splash-motto">{SPLASH_MOTTO}</p>
    </div>
  );
}
