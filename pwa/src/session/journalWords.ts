// The journal's rendering vocabulary — the PWA word for each LifecycleAct
// and LifecycleOutcome, plus the one sanctioned door into `corroboration()`
// for a row that arrived over JSON. Same shape as lifecycleWords.ts's
// QUALIFIER and coordWords.ts's MARKER_WORD: each table is TOTAL over its
// union (a member added in shared/api.ts is a TS2739 here before it is a
// blank cell anywhere — `npm run build` runs tsc; journal-words.test.ts
// carries the runtime twin), and every door tolerates a token this build was
// never compiled to know.
//
// `LIFECYCLE_ACT_MAP` itself is module-private in shared/api.ts on purpose
// (its docstring: only the derived list and the guard are exported). These
// tables CONSUME that map through the type it derives — `Record<LifecycleAct,
// string>` is checked against the same union, so the two cannot drift without
// a compile error — and narrow raw strings only through `isLifecycleAct` /
// `isLifecycleOutcome`, never by indexing.
import type {
  Corroboration, LifecycleAct, LifecycleOutcome, MirroredLifecycleEvent,
} from '../../../shared/api';
import {
  LC_ACT_UNKNOWN, corroboration, isActorClass, isDecSurface, isLifecycleAct,
  isLifecycleOutcome,
} from '../../../shared/api';

/** The operator's word for each act. `unknown`'s cell is the no-token
 *  fallback only — `actWord` below prefers the preserved `badact` — but the
 *  key must exist or the record stops being total, which is the guard. */
export const ACT_WORD: Record<LifecycleAct, string> = {
  create: 'created', claim: 'claimed', purge: 'registry row purged',
  supervise: 'supervised', unsupervise: 'unsupervised', destroy: 'destroyed',
  rename: 'branch renamed', hold: 'held', release: 'released',
  archive: 'archived', restore: 'restored', 'attic-drop': 'attic refs dropped',
  reap: 'reaped', gc: 'gc pass', spawn: 'respawned', start: 'started',
  ensure: 'ensured', swap: 'account swapped', enable: 'enabled',
  stop: 'stopped', forget: 'forgotten',
  unknown: 'unmodelled act',
};

export const OUTCOME_WORD: Record<LifecycleOutcome, string> = {
  intent: 'intent', done: 'done', refused: 'refused', failed: 'failed',
  unknown: 'unmodelled outcome',
};

/** Two cues, word and glyph — RUN_WORD/RUN_GLYPH's discipline (runWords.ts):
 *  no outcome is read out of colour alone. */
export const OUTCOME_GLYPH: Record<LifecycleOutcome, string> = {
  intent: '→', done: '✓', refused: '⊘', failed: '✗', unknown: '?',
};

export const CORROBORATION_WORD: Record<Corroboration, string> = {
  agrees: 'agrees', disagrees: 'disagrees',
  'not-comparable': 'not comparable', unmeasured: 'unmeasured',
};

/** The act's word, with the degrade rendered honestly: an `unknown` act
 *  keeps its preserved token (`badact`), and a token a NEWER server sends
 *  that this build's union has never heard of takes the same path — "a byte
 *  we saw and could not model is a different fact from a byte that was never
 *  there" (D6). */
export function actWord(act: string, badact: string | null): string {
  if (isLifecycleAct(act) && act !== LC_ACT_UNKNOWN) return ACT_WORD[act];
  const token = badact ?? (isLifecycleAct(act) ? null : act);
  return token === null || token === ''
    ? ACT_WORD[LC_ACT_UNKNOWN]
    : `unmodelled act: ${token}`;
}

export function outcomeWord(outcome: string): string {
  return isLifecycleOutcome(outcome) ? OUTCOME_WORD[outcome] : OUTCOME_WORD.unknown;
}

export function outcomeGlyph(outcome: string): string {
  return isLifecycleOutcome(outcome) ? OUTCOME_GLYPH[outcome] : OUTCOME_GLYPH.unknown;
}

/** The one door into `corroboration()` for a row off the wire. The response
 *  is `getJson`-cast, not revived, so both fields reach this as raw strings
 *  wearing their types — `corroboration()`'s own contract is that arguments
 *  are NARROWED through `isActorClass`/`isDecSurface`, never cast, and a
 *  value that passes neither guard is a value this build cannot model, which
 *  degrades to the unmeasured rung rather than being reported as a lie. */
export function eventCorroboration(
  ev: Pick<MirroredLifecycleEvent, 'obs' | 'dec'>,
): Corroboration {
  const cgRaw: unknown = ev.obs?.cg ?? null;
  const surfaceRaw: unknown = ev.dec?.surface ?? 'none';
  return corroboration(
    isActorClass(cgRaw) ? cgRaw : null,
    isDecSurface(surfaceRaw) ? surfaceRaw : 'none',
  );
}
