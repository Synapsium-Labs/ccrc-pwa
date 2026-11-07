// The cleanup row's attention list — the shape three lanes render.
//
// A REPORT, never a tap: no button, no link, no remedy. The doors that act
// already exist (revive, reclaim, abandon) and the server's sentence names
// them. Each line is who, and what the server says about them. The one
// exception is the held-rows list (`HeldByRows`), whose line carries a
// single optional `control`, itself a tap that only opens a confirm.
//
// WHY IT EXISTS. `ExpiryAttention` and `DeadCoordinatorAttention` were
// twenty-two-line files that differed in three expressions — the words
// helper, the key, and the aria-label — and `ChildReclaimBanner` writes the
// same line a third time for its own lane. The markup census named all three;
// none was visible to the stylesheet census, because `.child-reclaim-item` is
// ONE rule, correctly shared, with the markup around it copied.
//
// THE CLASSES STAY `child-reclaim-*`. They are the cleanup row's vocabulary
// and `fleet.css` grounds them there; renaming them to match this component
// would move three rules and rekey the contrast gate for a file that paints
// no ground. The shape moves, the ground stays.
import type { ReactNode } from 'react';
import type { AttentionLane, AttentionRow, AttentionSubject } from '../../../shared/api';
import { expiryKindWord } from './expiryWords';
import { deadCoordinatorKindWord } from './deadCoordinatorWords';

export interface AttentionLine {
  /** React's key. The lanes key differently — a session id, a kind and its
   *  claimants, a word — and each knows which of those is unique in ITS list. */
  key: string;
  /** Who the sentence is about. A list because the circuit-breaker line names
   *  every claimant it holds; one entry is the ordinary case. */
  who: string[];
  sentence: string;
  /** The circuit-breaker line leads with the sentence and lists its members
   *  under it; every other line names who first. Both orders were already
   *  rendered — this is the difference, not a new option. */
  sentenceFirst?: boolean;
  /** The held-rows list's one confirmed control; every other lane leaves it out. */
  control?: ReactNode;
}

export function AttentionList(
  { label, lines }: { label: string; lines: AttentionLine[] },
): ReactNode {
  if (lines.length === 0) return null;
  const sentence = (l: AttentionLine): ReactNode =>
    <span className="child-reclaim-sentence">{l.sentence}</span>;
  return (
    <ul className="child-reclaim-attention" aria-label={label}>
      {lines.map((l) => (
        <li key={l.key} className="child-reclaim-item">
          {l.sentenceFirst === true && sentence(l)}
          {l.who.map((w) => <span key={w} className="child-reclaim-who">{w}</span>)}
          {l.sentenceFirst !== true && sentence(l)}
          {l.control}
        </li>
      ))}
    </ul>
  );
}

/** The word a row's `kind` leads its names with, by lane. Child reclamation's rows carry no kind, so it has none. */
const KIND_WORD: Partial<Record<AttentionLane, (kind: string) => string>> = {
  expiry: expiryKindWord,
  'dead-coordinator': deadCoordinatorKindWord,
};

/** The one mapping from the three readers' `AttentionRow`s to lines: each `who` entry is one name, its subjects
 *  joined by a comma and led by the kind's word. `name` says a subject; the cleanup row passes one that leads a
 *  child's session with its run. */
export function attentionLines(
  rows: readonly AttentionRow[], name: (s: AttentionSubject) => string = (s) => s.sessionId,
): AttentionLine[] {
  return rows.map((r) => {
    const word = r.kind === null ? undefined : KIND_WORD[r.lane]?.(r.kind);
    const lead = word === undefined ? '' : `${word} · `;
    return {
      key: r.key,
      who: r.who.map((subjects) => `${lead}${subjects.map(name).join(', ')}`),
      sentence: r.sentence,
      ...(r.sentenceFirst ? { sentenceFirst: true } : {}),
    };
  });
}
