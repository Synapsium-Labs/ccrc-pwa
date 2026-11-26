// The sequence's two read doors, decided (Overlord spec §10.4 "One sequence", "No stream of its own", "One invariant monitor";
// Table 11.1e; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md` Task 7, questions 7, 13 and 18).
// Ring L1, context C5: pure deciders over what the routes read, importing L0 and L1 values and L3 and L4 types only. The routes
// read and act; every word they answer, every status and every read-ledger line's scope, count and outcome is decided here.
//
//   - `readSequenceQuery`: the cursor read's query, closed: `after` and `limit`, each a canonical decimal integer, beside the
//     caller's pair. Anything else is a refusal the route answers 400 `bad-request` with no ledger line.
//   - `restoreGenerationOf`: the restore counter's one reader's answer (`OverlordRestoreState.restoreGeneration`, the reader the
//     timers read at each set) as the wire's word: a number, or `unmeasured`, never zero (slug `restore-generation-read-live`).
//   - `sequenceDoorAnswer`: the read's answer and its ledger line: a page is served rows; `gap` and `ahead` are answers that
//     serve no line; an unreadable sequence is 503 `unavailable` with an `unmeasured` line. Never an empty page for a gap.
//   - `invariantsReadAnswer`: the operator's read of the monitor: `no-pass-yet` before the first pass, `unmeasured` when a
//     findings read fails, else the last pass, the findings of both modes and M24's counts. Never an empty list for either.
import { SEQUENCE_PAGE_MAX, type RestoreGeneration, type SequencePageWire, type SequenceWireLine } from '../../../shared/overlord-sequence.js';
import { sequencePage, type SequenceFacts } from './overlordSequence.js';
import { INVARIANT_NAMES, type InvariantName, type InvariantVerdict } from './invariants.js';
import type { FindingMode, FindingRow, FindingTally } from './invariantFindingsStore.js';
import type { SequenceRead } from './overlordSequenceStore.js';

// ------------------------------------------------------------------------------------------------------------ the cursor read

/** The query keys the cursor read takes: the caller's pair (checked by the route before the gate) and the cursor's two. */
const SEQUENCE_QUERY_KEYS: readonly string[] = ['byId', 'byUuid', 'after', 'limit'];
/** A canonical decimal integer: no sign, no leading zero, at most sixteen digits (a safe integer is checked after). */
const DECIMAL = /^(0|[1-9][0-9]{0,15})$/;

export type SequenceQuery = { readonly ok: true; readonly after: number; readonly limit: number } | { readonly ok: false; readonly detail: string };

const integerOf = (v: unknown): number | null => {
  if (typeof v !== 'string' || !DECIMAL.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
};

/** The cursor read's query. `after` defaults to 0 (the start) and is any non-negative integer; `limit` defaults to
 *  `SEQUENCE_PAGE_MAX` and is 1 to `SEQUENCE_PAGE_MAX` (slug `sequence-limit-is-positive`: a limit of 0 would read no line and
 *  answer a page that never moves the cursor). A key the door does not take, a repeated key or a value that is not one
 *  canonical decimal integer is refused, naming the key and never quoting the value. */
export function readSequenceQuery(raw: unknown): SequenceQuery {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, detail: 'the query is not a set of keys' };
  const q = raw as Record<string, unknown>;
  const other = Object.keys(q).find((k) => !SEQUENCE_QUERY_KEYS.includes(k));
  if (other !== undefined) return { ok: false, detail: 'the query takes after and limit only' };
  const after = q['after'] === undefined ? 0 : integerOf(q['after']);
  if (after === null) return { ok: false, detail: 'after: a non-negative integer' };
  const limit = q['limit'] === undefined ? SEQUENCE_PAGE_MAX : integerOf(q['limit']);
  if (limit === null || limit < 1 || limit > SEQUENCE_PAGE_MAX) return { ok: false, detail: `limit: an integer from 1 to ${SEQUENCE_PAGE_MAX}` };
  return { ok: true, after, limit };
}

/** The restore counter's reader's answer, as the wire carries it: a measured non-negative integer, else `unmeasured`. */
export function restoreGenerationOf(r: { readonly kind: 'measured'; readonly n: number } | { readonly kind: 'unmeasured' }): RestoreGeneration {
  return r.kind === 'measured' && Number.isSafeInteger(r.n) && r.n >= 0 ? r.n : 'unmeasured';
}

type Served<K extends SequencePageWire['kind']> = { readonly ok: true } & Extract<SequencePageWire, { kind: K }>;

/** What the route sends and the ledger line it writes first. The scope is `after=<n>`; a page's count is its lines. */
export type SequenceDoorAnswer =
  | { readonly kind: 'rows'; readonly body: Served<'page'>; readonly scope: string; readonly count: number }
  | { readonly kind: 'answer'; readonly body: Served<'gap'> | Served<'ahead'>; readonly scope: string; readonly outcome: 'gap' | 'ahead' }
  | { readonly kind: 'refuse'; readonly word: 'unavailable'; readonly detail: typeof SEQUENCE_UNREADABLE; readonly scope: string; readonly outcome: 'unmeasured' };

/** The 503's one detail: a fixed phrase, never the store's caught error text, as the inbox, messages and history doors answer
 *  (review 3978 F4; the door is exempt from the answer mask, so nothing it sends may carry a producer's words). */
export const SEQUENCE_UNREADABLE = 'the sequence could not be read';

/** The cursor read's answer over one read of the facts and the lines (`sequenceAfter`), first match: unreadable, then
 *  `sequencePage`'s own order (`ahead`, `gap`, a page). Total over every arm. */
export function sequenceDoorAnswer(
  read: SequenceRead<{ readonly facts: SequenceFacts; readonly lines: readonly SequenceWireLine[] }>,
  q: { readonly after: number; readonly limit: number }, restoreGeneration: RestoreGeneration,
): SequenceDoorAnswer {
  const scope = `after=${q.after}`;
  if (read.kind === 'unmeasured') return { kind: 'refuse', word: 'unavailable', detail: SEQUENCE_UNREADABLE, scope, outcome: 'unmeasured' };
  const page = sequencePage(q.after, q.limit, read.value.facts, read.value.lines, restoreGeneration);
  switch (page.kind) {
    case 'page': return { kind: 'rows', body: { ok: true, ...page }, scope, count: page.lines.length };
    case 'gap': return { kind: 'answer', body: { ok: true, ...page }, scope, outcome: 'gap' };
    case 'ahead': return { kind: 'answer', body: { ok: true, ...page }, scope, outcome: 'ahead' };
    default: return { kind: 'refuse', word: 'unavailable', detail: SEQUENCE_UNREADABLE, scope, outcome: 'unmeasured' };
  }
}

// ------------------------------------------------------------------------------------------------- the operator's invariants read

/** The operator's read's own answer words, enumerated once: what `kind` names besides the verdict words (`invariants.ts`). */
const INVARIANTS_READ_KIND_MAP = {
  'no-pass-yet': 'the monitor has run no pass since this server started, so no verdict is claimed',
  pass: 'the last pass, its findings and the counts',
} as const;
/** The sequence doors' own words, for the coordination kebab census: each rides a 200's `kind`, never a refusal. */
export const isSequenceDoorKebab = (word: string): boolean => Object.hasOwn(INVARIANTS_READ_KIND_MAP, word);

/** The most findings rows of each list (open, resolved) the read serves, newest first; M24's counts carry the totals. */
export const INVARIANTS_READ_ROWS_MAX = 200;

/** The runner's last pass as the route reads it (`InvariantMonitor.last`). */
export interface InvariantPassFact {
  readonly at: number; readonly mode: FindingMode;
  readonly verdicts: ReadonlyMap<InvariantName, InvariantVerdict>;
}
/** One findings list as read: at most `INVARIANTS_READ_ROWS_MAX + 1` rows, newest first, so a cut can be told. */
export type FindingsRead = SequenceRead<readonly FindingRow[]>;

export type InvariantsReadAnswer =
  | { readonly ok: true; readonly kind: 'no-pass-yet'; readonly mode: FindingMode }
  | { readonly kind: 'unmeasured'; readonly why: string }
  | {
      readonly ok: true; readonly kind: 'pass'; readonly mode: FindingMode;
      readonly lastPass: { readonly at: number; readonly mode: FindingMode;
        readonly verdicts: readonly { readonly invariant: InvariantName; readonly verdict: InvariantVerdict }[] };
      readonly findings: {
        readonly open: readonly FindingRow[]; readonly openCut: boolean;
        readonly resolved: readonly FindingRow[]; readonly resolvedCut: boolean;
      };
      readonly counts: { readonly live: FindingTally; readonly shadow: FindingTally };
    };

/** The operator's read, first match: no pass yet (the monitor has run none since this server started, so no verdict is
 *  claimed); a findings or count read that failed is `unmeasured`, naming it; else the pass, each invariant in the table's
 *  order (a name the pass did not answer reads `unmeasured`, never a pass), both lists cut at `INVARIANTS_READ_ROWS_MAX`, and the
 *  counts. `mode` is the arming now; the pass carries the mode it ran in. */
export function invariantsReadAnswer(i: {
  readonly mode: FindingMode; readonly last: InvariantPassFact | null;
  readonly open: FindingsRead; readonly resolved: FindingsRead;
  readonly counts: SequenceRead<{ readonly live: FindingTally; readonly shadow: FindingTally }>;
}): InvariantsReadAnswer {
  if (i.last === null) return { ok: true, kind: 'no-pass-yet', mode: i.mode };
  if (i.open.kind === 'unmeasured') return { kind: 'unmeasured', why: `the open findings could not be read: ${i.open.why}` };
  if (i.resolved.kind === 'unmeasured') return { kind: 'unmeasured', why: `the resolved findings could not be read: ${i.resolved.why}` };
  if (i.counts.kind === 'unmeasured') return { kind: 'unmeasured', why: `the findings could not be counted: ${i.counts.why}` };
  const last = i.last;
  const verdicts = INVARIANT_NAMES.map((invariant) => ({
    invariant, verdict: last.verdicts.get(invariant) ?? { kind: 'unmeasured' as const, why: 'the pass did not answer it' },
  }));
  const cut = (rows: readonly FindingRow[]) => ({ rows: rows.slice(0, INVARIANTS_READ_ROWS_MAX), cut: rows.length > INVARIANTS_READ_ROWS_MAX });
  const open = cut(i.open.value);
  const resolved = cut(i.resolved.value);
  return {
    ok: true, kind: 'pass', mode: i.mode,
    lastPass: { at: last.at, mode: last.mode, verdicts },
    findings: { open: open.rows, openCut: open.cut, resolved: resolved.rows, resolvedCut: resolved.cut },
    counts: i.counts.value,
  };
}
