// THREE SMALL THINGS WRITTEN TWICE — a chip, a chip and a disclosure, each
// copied across two files with the same class, the same attributes and the
// same words.
//
// WHY THEY ARE HERE. The markup census could not see any of them: its block
// half starts at three elements and these are leaves, and its literal half
// starts at two words because a one-word hook class at two call sites is the
// stylesheet being USED. Both floors are right for what they measure, and
// both are blind to a LEAF whose class, attributes and copy are all the same
// — which is what these were. The census grew a third half in the same
// commit; this file is what that half found.
//
// The classes stay `sess-*`/`acct-*`: fleet.css grounds them, the contrast
// gate measures them there, and RunRow's own comment already argues the reuse
// ("a second `.run-…` class for one meaning is two vocabularies over one
// field"). The shape moves, the ground stays.
import type { ReactNode } from 'react';
import type { SpawnChip } from './spawnWords';
import './fleet.css';

/** The last spawn's verdict, as the fleet card and the run row both draw it.
 *  TWO SELECTORS, ONE CHIP: `spawnChip` (the session line's, narrow) and
 *  `spawnVerdictChip` (the run row's, which also speaks for a session that
 *  recorded no verdict) each answer the same `{word, data}`, and the caller
 *  picks which question it is asking. `null` renders nothing, which both call
 *  sites used to spell for themselves. */
export function LastSpawnChip({ chip }: { chip: SpawnChip | null }): ReactNode {
  if (chip === null) return null;
  return (
    <span className="sess-spawn" data-spawn={chip.data} title={`last spawn: ${chip.data}`}>
      {chip.word}
    </span>
  );
}

/** The registry ladder's degraded read: this row's identity could not be
 *  fully measured this pass, so some of what is shown may be frozen at a
 *  fallback rather than freshly read.
 *
 *  THE WORD IS GENERIC AND THE REASON IS IN THE TITLE, verbatim and never
 *  parsed — the same small, honest register `.sess-held` keeps next door. It
 *  heals on its own the moment a later sweep measures clean. An empty list
 *  renders nothing: "nothing was unreadable" is not a fact worth a chip. */
export function UnmeasuredChip({ fields }: { fields: readonly string[] }): ReactNode {
  if (fields.length === 0) return null;
  return (
    <span
      className="sess-unmeasured"
      data-unmeasured="true"
      title={`registry ${fields.join('/')} temporarily unreadable — retrying`}
    >
      unreadable
    </span>
  );
}

/** "show other pools (N)" — the toggle both account/project pickers carry for
 *  the rows pool matching pushed below the fold. The two were byte-identical
 *  down to the parenthesised count, which is the kind of copy that drifts
 *  without a type noticing. */
export function OtherPoolsDisclosure({ count, shown, onToggle }: {
  count: number;
  shown: boolean;
  onToggle: () => void;
}): ReactNode {
  return (
    <button type="button" className="acct-disclosure" aria-expanded={shown} onClick={onToggle}>
      show other pools ({count})
    </button>
  );
}
