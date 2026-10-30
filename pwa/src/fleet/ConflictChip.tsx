// The predicted-conflict chip (landing order wave 4b; D-7480): ONE fleet-level chip beside the hot-files strip. It is
// READ-ONLY: no button, no route, nothing it can do — the landing radar's reading decides nothing, so a tap would
// be an enforcement surface for a prediction. Its WORD carries the meaning, never its colour alone; the accessible name
// and the title are the same sentence, which lists each conflict and says when the reading was measured.
//
// It renders NOTHING when no session carries a landing in the window: absence is "unknown", never "no conflict"
// (`conflictWords.ts`). Its clock runs only while some session carries a landing, so a fleet with no radar pays no timer.
import type { ReactNode } from 'react';
import type { FleetSession } from '../../../shared/api';
import { Chip, useNow } from '@ccrc/ui';
import { chipTone } from '../session/chipTones';
import { conflictChipSentence, conflictChipState, conflictChipWord, conflictSummaryOf } from './conflictWords';
import './fleet.css';

export function ConflictChip({ sessions }: { sessions: readonly FleetSession[] }): ReactNode {
  // The later of `useNow`'s stored clock and the clock of THIS render: the stored one stands still while no session
  // carries a landing, so the first render after a long gap would age a landing by a clock hours old (review 1225, F3).
  const now = Math.max(useNow(30_000, sessions.some((s) => s.landing !== undefined)), Date.now());
  const summary = conflictSummaryOf(sessions, now);
  if (summary === null) return null;
  const sentence = conflictChipSentence(summary);
  return (
    <Chip dot className={chipTone('conflict')} data-state={conflictChipState(summary)} role="status" aria-label={sentence} title={sentence}>
      {conflictChipWord(summary)}
    </Chip>
  );
}
