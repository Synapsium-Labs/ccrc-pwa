// The readiness word, one line (Overlord W1 home B, Task 4; plan question 5): L4, the form the Fleet's health row and Waiting on you's
// head draw. Drawn only while the console reads `overlord-v1` (question 9) and the word is not `absent` (neither the read state nor
// the word itself); it decides nothing: `readinessViewOf` and `readinessOneLine` (L1) say what, if anything, the line reads. A
// failed read says "unmeasured", a stale one when it was read.
//
// Class hooks: `ovl-line` (the line) with `ovl-status--ok|quiet|attention|dead` through the `data-tone` it carries.
import type { ReactNode } from 'react';
import { useNow } from '@ccrc/ui';
import { useOverlordShown, useReadiness } from '../stores/overlord';
import { readinessOneLine, readinessViewOf } from './readinessWords';

const NOW_TICK_MS = 30_000;

export function ReadinessLine(): ReactNode {
  const shown = useOverlordShown();
  const read = useReadiness();
  const now = useNow(NOW_TICK_MS);
  if (!shown) return null;
  const view = readinessViewOf(read, now);
  const text = readinessOneLine(view);
  if (text === null) return null;
  const tone = view.kind === 'answered' ? view.lines.tone : 'attention';
  return (
    <p
      className={`ovl-line ovl-status--${tone}`}
      role="status"
      data-readiness-line
      data-tone={tone}
      data-readiness-word={view.kind === 'answered' ? view.lines.word : 'unmeasured'}
    >
      {text}
    </p>
  );
}
