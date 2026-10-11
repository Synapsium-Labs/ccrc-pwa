// The temp-root collector's server lane: its PURE half (child reclamation spec 2026-09-22 §5.10; attention, §5.9).
//
// L1. This file imports `shared/api.js` and `./childReclaimSweep.js` only (L1 to L1, one way: `childReclaimSweep.ts`
// never imports this file), ONE import statement each, and every later block merges its names into those two (H2).
// The readers need the first alone. It reaches no file, process, timer or clock: every instant and interval
// a rule here decides with is an argument. The executor (`coord/collectTempRoot.ts`, L3) runs ccd and hands its answers
// here, and the watcher (`watch.ts`, L4) wires the pass and decides nothing.
//
// The two readers below are TOTAL and the collector's own. Neither borrows reclaim's:
// - a `ws-collect` document carries no `crumb`;
// - its refusal words are not reclaim's;
// - its audit is keyed `session`, not `id`.
import { CHILD_RUN_ID, isTmpRootId, type CollectToken } from '../../shared/api.js';
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, childReclaimBackoffMs, childReclaimTierFrom, childReclaimTierPaceMs,
  type ChildReclaimLaneNow, type ChildReclaimTierState,
} from './childReclaimSweep.js';

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
/** A JSON object: never an array, never null. */
const isObject = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// ── the live switch (spec §5.10, R82) ───────────────────────────────────────────────────────────────────────────

/** The lane's live switch: the marker FILE `$REG/collect-lane-live` (R82). The lane composes `ws-collect` only while it
 *  exists. Without it the lane audits under every rule, and records "would collect" where it would spend (shadow).
 *  - Nothing in the tree writes it. It is hand-touched, on the `expire-lane-live` precedent.
 *  - It is spelled ONCE, here, in an L1 file with no `node:` import. Its code holders are this file and the executor
 *    (`coord/collectTempRoot.ts`), which reads it nearest the argv; tests import it from here. */
export const COLLECT_LANE_LIVE_MARKER = 'collect-lane-live';

// ── the probe and refusal tables (spec §5.10) ───────────────────────────────────────────────────────────────────

/** How an `unmeasured` probe word of `ws-audit --collect` is paced and reported (spec §5.10):
 *  - `box-wide`: a fact about the fleet box, not the id. One line for the box, never one per id.
 *  - `per-leaf`: a fact about this temp root that will not change by itself. It is listed at once.
 *  - `load-sensitive`: a probe a busy or slow box can fail, so it is retried.
 *  A word this table does not know is `load-sensitive`. */
export type CollectProbeClass = 'box-wide' | 'per-leaf' | 'load-sensitive';

/** ccd's probe words, each spelled once as a key: the twenty first arguments of `_ws_collect_unmeasured`, and the
 *  four walk words `_ws_collect_eval` admits. `collect-readers.test.ts` holds the keys equal to ccd's text, both ways. */
const COLLECT_PROBE_CLASS_TABLE = {
  platform: 'box-wide', mv: 'box-wide', flock: 'box-wide', witness: 'box-wide', floor: 'box-wide', clock: 'box-wide',
  eval: 'box-wide', quarantine: 'box-wide',
  'idle:cap': 'per-leaf', 'idle:unreadable': 'per-leaf', mode: 'per-leaf', device: 'per-leaf',
  'idle:timeout': 'load-sensitive', 'idle:walk-failed': 'load-sensitive', 'in-use': 'load-sensitive',
  checkouts: 'load-sensitive', rows: 'load-sensitive', registry: 'load-sensitive', identity: 'load-sensitive',
  leaf: 'load-sensitive', slot: 'load-sensitive', records: 'load-sensitive', token: 'load-sensitive',
  lock: 'load-sensitive',
} as const satisfies Readonly<Record<string, CollectProbeClass>>;
export type CollectProbe = keyof typeof COLLECT_PROBE_CLASS_TABLE;
export const COLLECT_PROBE_CLASS: Readonly<Record<CollectProbe, CollectProbeClass>> = COLLECT_PROBE_CLASS_TABLE;
export const COLLECT_PROBES: readonly CollectProbe[] = Object.keys(COLLECT_PROBE_CLASS_TABLE) as CollectProbe[];

/** A probe word's class. An unknown word, a prototype member's name included, is `load-sensitive`. */
export function collectProbeClass(probe: string): CollectProbeClass {
  return hasOwn(COLLECT_PROBE_CLASS, probe) ? COLLECT_PROBE_CLASS[probe as CollectProbe] : 'load-sensitive';
}

/** How a `ws-collect` refusal word, or the same word as an audit verdict, is read (spec §5.10):
 *  - `terminal`: ccd journals it, and the operator owns what stands;
 *  - `retry`: nothing was removed, and a later look may differ.
 *  A word this table does not know is a `retry`, never `terminal`. */
export type CollectRefusalClass = 'terminal' | 'retry';

/** Every word `ws-collect` prints as `refused`: the collector's five journal words, declared in L0's `LcRefusalToken`,
 *  and the five shared tokens `wsaudit.ts` words. The audit's refusal verdicts are the same words, save `state-changed`.
 *  `collect-readers.test.ts` holds the keys equal to ccd's text, both ways. */
const COLLECT_REFUSAL_CLASS_TABLE = {
  'witness-mismatch': 'terminal', 'quarantine-kept': 'terminal', 'containment-unproven': 'terminal',
  'not-witnessed': 'retry', registered: 'retry', 'changed-recently': 'retry',
  'state-changed': 'retry', 'in-use': 'retry', 'in-progress': 'retry', paused: 'retry',
} as const satisfies Readonly<Record<string, CollectRefusalClass>>;
export type CollectRefusalWord = keyof typeof COLLECT_REFUSAL_CLASS_TABLE;
export const COLLECT_REFUSAL_CLASS: Readonly<Record<CollectRefusalWord, CollectRefusalClass>> = COLLECT_REFUSAL_CLASS_TABLE;
export const COLLECT_REFUSAL_WORDS: readonly CollectRefusalWord[] =
  Object.keys(COLLECT_REFUSAL_CLASS_TABLE) as CollectRefusalWord[];

/** A refusal word's class. An unknown word, a prototype member's name included, is a `retry`. */
export function collectRefusalClass(word: string): CollectRefusalClass {
  return hasOwn(COLLECT_REFUSAL_CLASS, word) ? COLLECT_REFUSAL_CLASS[word as CollectRefusalWord] : 'retry';
}

// ── the audit reader (spec §5.10) ───────────────────────────────────────────────────────────────────────────────

/** `ws-audit --collect`'s token grammar: exactly 64 lowercase hex characters, nothing trimmed, and no flag. */
const COLLECT_TOKEN_SHAPE = /^[0-9a-f]{64}$/;
/** A witness's `at`: epoch milliseconds, exactly thirteen digits, as ccd's witness reader requires. */
const WITNESS_AT_SHAPE = /^[0-9]{13}$/;

/** `ws-audit --session <id> --collect`'s answer (spec §5.10). Only `collectable` carries a token, and only at exit 0.
 *  - `collectable`:
 *    - `resume` is the quarantine PHASE, null when the key is absent: a fresh collection;
 *    - `witnessRun` and `witnessAt` are `collect.witness`'s `run` and `at` (epoch ms), null when the witness is null;
 *    - `leaf` is `collect.leaf`, for display only.
 *  - `verdict`: any other exit-0 verdict, a refusal word or one this build does not know, with `collect.idleAt`
 *    (epoch seconds) when it is a non-negative safe integer.
 *  - `unmeasured`: the exit-1 answer, with its probe word verbatim.
 *  - `verdict` and `unmeasured` carry the document's `witnessRun` and `leaf` too: ccd prints `collect.witness` and
 *    `collect.leaf` on every document, and the lane's evidence is the LATEST document's. There an absent `witness`
 *    key reads as none. A witness this reader cannot vouch for makes ANY document `unreadable`.
 *  - `exists` is not carried: nothing gates on it.
 *  - `unreadable`: a document that is not this id's collect audit, or not ccd's shape for its exit status. It is never
 *    spent.
 *  - `no-document`: nothing on stdout (a runner kill, a timeout, a die before the document). */
export type CollectAudit =
  | { readonly kind: 'collectable'; readonly token: CollectToken; readonly resume: string | null;
      readonly witnessRun: number | null; readonly witnessAt: number | null; readonly leaf: string | null;
      readonly detail: string }
  | { readonly kind: 'verdict'; readonly verdict: string; readonly idleAt: number | null;
      readonly witnessRun: number | null; readonly leaf: string | null; readonly detail: string }
  | { readonly kind: 'unmeasured'; readonly probe: string; readonly witnessRun: number | null;
      readonly leaf: string | null; readonly detail: string }
  | { readonly kind: 'unreadable'; readonly detail: string }
  | { readonly kind: 'no-document'; readonly stderr: string };

/** `collect.witness` as the document prints it: `null`, or ccd's five fields, each a string, with `run` in the one
 *  run-id grammar and `at` thirteen digits. Anything else, an absent key included, is `bad`. A `collectable` hands its
 *  key over as it stands, so an absent one is `bad` there (H7); a `verdict` or `unmeasured` hands an absent key over
 *  as `null`, so it reads as none. */
type WitnessRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'run'; readonly run: number; readonly at: number }
  | { readonly kind: 'bad' };
function readWitness(w: unknown): WitnessRead {
  if (w === null) return { kind: 'none' };
  if (!isObject(w)) return { kind: 'bad' };
  const { dev, ino, btime, run, at } = w;
  if (typeof dev !== 'string' || typeof ino !== 'string' || typeof btime !== 'string'
    || typeof run !== 'string' || !CHILD_RUN_ID.test(run) || typeof at !== 'string' || !WITNESS_AT_SHAPE.test(at)) {
    return { kind: 'bad' };
  }
  return { kind: 'run', run: Number(run), at: Number(at) };
}

/** The witness's run, or null when the document's witness is null. */
const witnessRunOf = (w: WitnessRead): number | null => (w.kind === 'run' ? w.run : null);

const idleAtOf = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);

/** THE ONE READER of `ws-audit --collect` (spec §5.10). `ok` is the runner's exit-0 answer.
 *  - At exit 0, only an EXACT `collectable` with a 64-hex token, a readable witness, and a `resume` that is absent or
 *    a non-empty string is spendable. Its `as CollectToken` is the shipped tree's one cast to the brand.
 *  - At exit 1, only `unmeasured` with a non-empty probe word reads; every other exit-1 shape is unreadable.
 *  - Every document's witness run and leaf are carried; a witness this reader cannot vouch for makes ANY document
 *    unreadable.
 *  - An empty stdout is `no-document`, and never a probe. */
export function parseCollectAudit(sessionId: string, ok: boolean, stdout: string, stderr: string): CollectAudit {
  const out = stdout.trim();
  const err = stderr.trim();
  if (out === '') return { kind: 'no-document', stderr: err };
  const said = err === '' ? '' : `: ${err}`;
  let v: unknown;
  try { v = JSON.parse(out); } catch {
    return { kind: 'unreadable', detail: `ws-audit --collect printed no JSON document${said}` };
  }
  if (!isObject(v) || v.session !== sessionId || v.mode !== 'collect') {
    return { kind: 'unreadable', detail: `ws-audit --collect printed a document that is not ${sessionId}'s collect audit${said}` };
  }
  const collect = isObject(v.collect) ? v.collect : null;
  const detail = typeof v.detail === 'string' ? v.detail : '';
  const leaf = collect !== null && typeof collect.leaf === 'string' ? collect.leaf : null;
  /** The witness as a `verdict` or `unmeasured` document carries it: an absent key reads as none (H3). A `collectable`
   *  reads its own, stricter (H7). */
  const seen = readWitness(collect?.witness ?? null);
  if (!ok) {
    const probe = collect === null ? undefined : collect.unmeasured;
    if (v.verdict !== 'unmeasured' || typeof probe !== 'string' || probe === '') {
      return { kind: 'unreadable', detail: `ws-audit --collect failed with a document that is not its unmeasured answer${said}` };
    }
    if (seen.kind === 'bad') return { kind: 'unreadable', detail: 'ws-audit --collect answered unmeasured with a witness it cannot vouch for' };
    return { kind: 'unmeasured', probe, witnessRun: witnessRunOf(seen), leaf, detail };
  }
  if (v.verdict === 'collectable') {
    if (typeof v.token !== 'string' || !COLLECT_TOKEN_SHAPE.test(v.token)) {
      return { kind: 'unreadable', detail: 'ws-audit --collect said collectable with no token of 64 lowercase hex characters' };
    }
    if (collect === null) return { kind: 'unreadable', detail: 'ws-audit --collect said collectable with no collect block' };
    const wit = readWitness(collect.witness);
    if (wit.kind === 'bad') return { kind: 'unreadable', detail: 'ws-audit --collect said collectable with a witness it cannot vouch for' };
    let resume: string | null = null;
    if (hasOwn(v, 'resume')) {
      if (typeof v.resume !== 'string' || v.resume === '') {
        return { kind: 'unreadable', detail: 'ws-audit --collect said collectable with a resume phase that is not a word' };
      }
      resume = v.resume;
    }
    return {
      kind: 'collectable', token: v.token as CollectToken, resume,
      witnessRun: wit.kind === 'run' ? wit.run : null, witnessAt: wit.kind === 'run' ? wit.at : null,
      leaf, detail,
    };
  }
  if (typeof v.verdict !== 'string' || v.verdict === '' || v.verdict === 'unmeasured') {
    return { kind: 'unreadable', detail: `ws-audit --collect answered a verdict that is not one at exit 0${said}` };
  }
  if (seen.kind === 'bad') {
    return { kind: 'unreadable', detail: `ws-audit --collect answered ${v.verdict} with a witness it cannot vouch for` };
  }
  return {
    kind: 'verdict', verdict: v.verdict, idleAt: idleAtOf(collect === null ? null : collect.idleAt),
    witnessRun: witnessRunOf(seen), leaf, detail,
  };
}

// ── the verb reader (spec §5.10) ────────────────────────────────────────────────────────────────────────────────

const COLLECT_WITNESS_WORD_TABLE = { dropped: true, kept: true, absent: true } as const;
/** What a collection did with the id's witness: dropped it, put a recycled spawn's back (`kept`), or found none. */
export type CollectWitnessWord = keyof typeof COLLECT_WITNESS_WORD_TABLE;

/** The pre-lock dies of `cmd_ws_collect` the reader RECOGNISES (spec §5.10). Each acted nothing. */
export type CollectDieWord =
  | 'flock-unavailable' | 'lock-unopenable' | 'usage' | 'bad-token' | 'bad-session-id' | 'python3-unavailable';

/** ccd's own message for each single-line recognised die, without its `ccd: ` prefix. Matched against the WHOLE trimmed
 *  stderr, never as a substring, so a die ccd extends no longer matches. `collect-readers.test.ts` holds these equal to
 *  `cmd_ws_collect`'s text, both ways. */
export const COLLECT_DIE_TEXT: Readonly<Record<Exclude<CollectDieWord, 'lock-unopenable'>, string>> = {
  usage: 'usage: ccd ws-collect --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]',
  'bad-token': 'bad token',
  'bad-session-id': 'bad session id',
  'python3-unavailable': 'python3 unavailable — cannot quote the collection record safely',
  'flock-unavailable': 'flock (util-linux) is unavailable — refusing to run the destructive verb unserialised',
};

/** The fixed prefix of `lock-unopenable`'s die. ccd appends the lock's path. */
export const COLLECT_LOCK_DIE_PREFIX = 'cannot open the reap lock at ';

/** `lock-unopenable`, recognised whole-output and for THIS id's lock only. The last line is exactly ccd's, naming a path
 *  that ends `/.reap-<id>.lock`. Every earlier line, zero or more, is bash's own redirection diagnostic for that same
 *  path. */
function collectLockDie(sessionId: string, err: string): boolean {
  const lines = err.split('\n');
  const last = lines[lines.length - 1] ?? '';
  const head = `ccd: ${COLLECT_LOCK_DIE_PREFIX}`;
  if (!last.startsWith(head)) return false;
  const lockPath = last.slice(head.length);
  if (!lockPath.endsWith(`/.reap-${sessionId}.lock`)) return false;
  const mid = `: ${lockPath}: `;
  return lines.slice(0, -1).every((l) => {
    const at = l.indexOf(mid);
    return at > 0 && /: line [0-9]+$/.test(l.slice(0, at)) && l.length > at + mid.length;
  });
}

function collectDie(sessionId: string, err: string): CollectDieWord | null {
  if (collectLockDie(sessionId, err)) return 'lock-unopenable';
  for (const word of Object.keys(COLLECT_DIE_TEXT) as Exclude<CollectDieWord, 'lock-unopenable'>[]) {
    if (err === `ccd: ${COLLECT_DIE_TEXT[word]}`) return word;
  }
  return null;
}

/** `ccd ws-collect --expect <token> --session <id> …`'s answer (spec §5.10).
 *  - `collected` (exit 0, `collected === id`). `record` is the quarantine record's name, or null for a witness-only drop.
 *  - `refused` (exit 0). ccd's word is kept verbatim and classed by `collectRefusalClass`.
 *  - `failed`. ccd's word, or `''` when this reader made the failure: a `collected` document for another id or one it
 *    cannot read, or a document at an exit status that contradicts it.
 *  - `die`: a RECOGNISED pre-lock die. It acted nothing.
 *  - `no-document`: anything else with no document, which MAY have acted (a runner kill, a timeout, a link failure). */
export type CollectResult =
  | { readonly kind: 'collected'; readonly record: string | null; readonly resumed: boolean; readonly witness: CollectWitnessWord }
  | { readonly kind: 'refused'; readonly word: string; readonly detail: string; readonly paths: readonly string[] }
  | { readonly kind: 'failed'; readonly token: string; readonly detail: string }
  | { readonly kind: 'die'; readonly word: CollectDieWord }
  | { readonly kind: 'no-document'; readonly stderr: string };

function collectedOf(sessionId: string, ok: boolean, v: Readonly<Record<string, unknown>>): CollectResult {
  if (v.collected !== sessionId) {
    return { kind: 'failed', token: '', detail: `ws-collect reported collecting ${String(v.collected)}, not ${sessionId}` };
  }
  if (!ok) return { kind: 'failed', token: '', detail: `ws-collect reported collecting ${sessionId} but exited non-zero` };
  const record = v.record === null ? null : typeof v.record === 'string' && v.record !== '' ? v.record : undefined;
  const witness = typeof v.witness === 'string' && hasOwn(COLLECT_WITNESS_WORD_TABLE, v.witness)
    ? v.witness as CollectWitnessWord : undefined;
  if (record === undefined || typeof v.resumed !== 'boolean' || witness === undefined) {
    return { kind: 'failed', token: '', detail: `ws-collect reported collecting ${sessionId} with a document this build cannot read` };
  }
  return { kind: 'collected', record, resumed: v.resumed, witness };
}

/** THE ONE READER of `ws-collect` (spec §5.10). `ok` is the runner's exit-0 answer. A recognised die needs an empty
 *  stdout and a non-zero exit, so a document, however cut, is never read as one. */
export function parseCollectResult(sessionId: string, ok: boolean, stdout: string, stderr: string): CollectResult {
  const out = stdout.trim();
  const err = stderr.trim();
  let v: unknown = null;
  if (out !== '') { try { v = JSON.parse(out); } catch { v = null; } }
  if (isObject(v)) {
    if (typeof v.collected === 'string') return collectedOf(sessionId, ok, v);
    if (typeof v.refused === 'string') {
      if (!ok) return { kind: 'failed', token: '', detail: `ws-collect refused ${v.refused} but exited non-zero` };
      const paths = Array.isArray(v.paths) && v.paths.every((p) => typeof p === 'string') ? v.paths as string[] : [];
      return { kind: 'refused', word: v.refused, detail: typeof v.detail === 'string' ? v.detail : '', paths };
    }
    if (typeof v.failed === 'string') {
      return { kind: 'failed', token: v.failed, detail: typeof v.detail === 'string' ? v.detail : '' };
    }
  }
  if (out === '' && !ok) {
    const word = collectDie(sessionId, err);
    if (word !== null) return { kind: 'die', word };
  }
  return { kind: 'no-document', stderr: err };
}

// ── the population (spec §5.10, "the population") ───────────────────────────────────────────────────────────────
//
// The lane finds the temp roots it may collect by listing `$REG/tmproots` (one witness per id) and `$REG/tmpquarantine`
// (one record per collection begun and not finished), never `~/.cc-tmp`. This block decides, purely, which names
// become ids, which ids are audited this pass and which are forgotten. The executor's `readCollectPopulation`
// (`coord/collectTempRoot.ts`) makes the two reads; nothing here reads a file.

/** The most names one listing may carry before the lane reads it as unmeasured (spec §5.10, the population). A
 *  session of this uid can write any number of names into either directory; past this many, the lane neither audits
 *  nor forgets from that listing, and says the count alone. Counted over the RAW listing, dot-leading names included,
 *  because they cost the lane's memory as much as any other name. STATED RESIDUAL: the cap bounds what the lane
 *  audits and remembers, not the listing itself: the agent's readdir returns every name in one frame, as the
 *  registry's own $REG listing already does every tick. */
export const COLLECT_POPULATION_MAX = 1024;

/** The two registry subdirectories the lane lists, by the name its box-wide line gives each. */
export type CollectListingName = 'tmproots' | 'tmpquarantine';

/** One listing as the executor measured it (spec §5.10): `listed` (a real directory, read), `absent` (a PROVEN
 *  absence, an empty listing that is MEASURED), or `unmeasured` (a link, a file, a FIFO, a read that failed: the
 *  listing says nothing about any id, and `why` says which). Never folded: an `unmeasured` listing is never empty. */
export type CollectListing =
  | { readonly kind: 'listed'; readonly names: readonly string[] }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unmeasured'; readonly why: string };

/** Why one listing gave the lane no ids this pass: the executor could not measure it, or it carried more than
 *  `COLLECT_POPULATION_MAX` names (`count`, the raw count, the only thing said of them). */
export type CollectListingDoubt =
  | { readonly listing: CollectListingName; readonly kind: 'unmeasured'; readonly why: string }
  | { readonly listing: CollectListingName; readonly kind: 'over-cap'; readonly count: number };

/** One pass's population (spec §5.10).
 *  - `ids`: every id a MEASURED listing names, as a witness or as a record's id, sorted. What forgetting reads.
 *  - `candidates`: the ids this pass may audit: `ids` less the pre-filter, sorted.
 *  - `recordIds`: the ids a record in the MEASURED `tmpquarantine` listing names.
 *  - `refusedNames`: how many names, dot-leading ones aside, are no id the lane may take. The names themselves are
 *    never carried: they are untrusted same-uid input, and a sentence says the count alone.
 *  - `unmeasured`: each listing that gave no ids, and why.
 *  - `bothMeasured`: neither listing is in `unmeasured`, so an id neither names is gone from both. */
export interface CollectPopulation {
  readonly ids: readonly string[];
  readonly candidates: readonly string[];
  readonly recordIds: ReadonlySet<string>;
  readonly refusedNames: number;
  readonly unmeasured: readonly CollectListingDoubt[];
  readonly bothMeasured: boolean;
}

/** A quarantine record's name, `<id>.<ns>.<pid>` (spec §5.10, the quarantine record): ccd's own `_ws_collect_rec_id`
 *  grammar, held equal to its text by a test. GREEDY: the id is what the two trailing all-digit dot-fields leave,
 *  never an `<id>.*` prefix, because ids admit dots. No flag: `g` would make `.exec` stateful. */
export const COLLECT_RECORD_NAME_RE = /^(.+)\.([0-9]+)\.([0-9]+)$/;

/** The id a quarantine record's name is for, or null when the name is no record's: it does not match the grammar,
 *  or what it names is not an id the lane may take (`isTmpRootId`, L0's ONE temp-root id predicate). */
export function parseCollectRecordName(name: string): string | null {
  const id = COLLECT_RECORD_NAME_RE.exec(name)?.[1];
  return id !== undefined && isTmpRootId(id) ? id : null;
}

/** The pass's population from its two listings and the tick's registry names (spec §5.10, the population). Pure.
 *  - A proven-absent listing is empty and MEASURED. An unmeasured listing, or one of more than
 *    `COLLECT_POPULATION_MAX` names, gives NO ids, and the other listing is still read: the lane audits the measured
 *    side only, and never reads a name's absence from an unmeasured listing.
 *  - A name that is not a string, or that leads with `.` (a writer's temp file), is dropped uncounted.
 *  - Every other name must be an id (`isTmpRootId`) in `tmproots`, or a record's name for one
 *    (`parseCollectRecordName`) in `tmpquarantine`, or it is counted in `refusedNames` and never becomes an id. This
 *    is the gate before any argv: a name that fails it is never audited and never composed.
 *  - THE PRE-FILTER is economy, never permission: an id is not a candidate while its EXACT `<id>.child` or `<id>.uuid`
 *    is among `registryNames`, unless a record in the measured `tmpquarantine` names it, because a kept record is
 *    never silent. Never a prefix: a row of `a.b` filters nothing of `a`. A row's absence licenses nothing: ccd's own
 *    `registered` rung decides. */
export function collectPopulation(input: {
  readonly tmproots: CollectListing;
  readonly tmpquarantine: CollectListing;
  readonly registryNames: ReadonlySet<string>;
}): CollectPopulation {
  const unmeasured: CollectListingDoubt[] = [];
  let refusedNames = 0;
  /** A listing's readable names, or null when it gives no ids this pass. */
  const namesOf = (listing: CollectListingName, l: CollectListing): readonly string[] | null => {
    switch (l.kind) {
      case 'absent': return [];
      case 'unmeasured': unmeasured.push({ listing, kind: 'unmeasured', why: l.why }); return null;
      case 'listed':
        if (l.names.length > COLLECT_POPULATION_MAX) {
          unmeasured.push({ listing, kind: 'over-cap', count: l.names.length });
          return null;
        }
        return l.names.filter((n) => typeof n === 'string' && !n.startsWith('.'));
    }
  };
  const witnessed = new Set<string>();
  for (const n of namesOf('tmproots', input.tmproots) ?? []) {
    if (isTmpRootId(n)) witnessed.add(n); else refusedNames += 1;
  }
  const recordIds = new Set<string>();
  for (const n of namesOf('tmpquarantine', input.tmpquarantine) ?? []) {
    const id = parseCollectRecordName(n);
    if (id !== null) recordIds.add(id); else refusedNames += 1;
  }
  const ids = [...new Set([...witnessed, ...recordIds])].sort();
  const rowStands = (id: string): boolean =>
    input.registryNames.has(`${id}.child`) || input.registryNames.has(`${id}.uuid`);
  const candidates = ids.filter((id) => recordIds.has(id) || !rowStands(id));
  return { ids, candidates, recordIds, refusedNames, unmeasured, bothMeasured: unmeasured.length === 0 };
}

/** Is `id` forgotten this pass, its pacing and feed episodes dropped without a feed row (spec §5.10)? Only when BOTH
 *  listings were measured and neither names it: an unmeasured listing never says an id is gone. */
export const collectForgets = (pop: CollectPopulation, id: string): boolean => pop.bothMeasured && !pop.ids.includes(id);

// ── the licence and the pacing (spec §5.10, "the lane": two observations, one job, one act) ─────────────────────
//
// The lane's per-id memory, and every rule it decides by. MEMORY ONLY: nothing here is written to coord.db or to any
// file, so a restart starts every id afresh, and a fresh id needs two fresh observations before anything is spent.
// Every instant is the lane's MONOTONIC clock (`ChildReclaimLaneNow.monoMs`), stamped when an answer ARRIVES; the wall
// clock is read once, at a `changed-recently` answer's arrival, against ccd's own `idleAt`. Every interval is an
// ARGUMENT, because this file imports no L4 constant. The pace is wave 8's, IMPORTED, never a second formula:
// `childReclaimTierFrom`, `childReclaimTierPaceMs` and `childReclaimBackoffMs` (`childReclaimSweep.ts`, L1).

/** How far a `changed-recently` answer may push the id's next ask at most, and how long `changed-recently` may answer
 *  without a break before the id is listed (spec §5.10, pacing): 24 hours. One span, both uses. */
export const COLLECT_CHANGED_RECENTLY_SPAN_MS = 24 * 3_600_000;

/** The class word each of the three runs carries as its tier token (spec §5.10, pacing). ccd's own word is never the
 *  token, so a change of probe or of terminal word never restarts a run. */
export type CollectRunToken = 'failing' | 'verb-failed' | 'terminal';

/** One of the id's three runs (spec §5.10, pacing): none, or `run` answers since it was last cleared, the last of
 *  them ARRIVING at `atMono`. `stuck` is set once an answer entered the run on the tier at once (a per-leaf
 *  deterministic probe, or any terminal answer) and stays set until the run clears, so a later answer of another
 *  class never takes the run off the tier. `word` and `detail` are the latest answer's, ccd's own strings: whatever
 *  reaches a sentence or a feed row goes through `childReclaimDetailText` first. */
export type CollectRun =
  | { readonly kind: 'none' }
  | { readonly kind: 'run'; readonly run: number; readonly atMono: number; readonly stuck: boolean;
      readonly word: string; readonly detail: string };

export const COLLECT_RUN_NONE: CollectRun = { kind: 'none' };

/** The run after one more answer of its class, arriving at `atMono`. */
const collectRunAdvance = (r: CollectRun, atMono: number, word: string, detail: string, stuck: boolean): CollectRun => ({
  kind: 'run', run: (r.kind === 'run' ? r.run : 0) + 1, atMono, stuck: stuck || (r.kind === 'run' && r.stuck), word, detail,
});

/** The run's place on wave 8's persistent tier, through that tier's ONE derivation of membership and j
 *  (`childReclaimTierFrom`), with the run's class word as its token. */
export const collectRunTier = (r: CollectRun, token: CollectRunToken): ChildReclaimTierState =>
  (r.kind === 'none' ? childReclaimTierFrom(null, 0, false) : childReclaimTierFrom(token, r.run, r.stuck));

/** The run's wait after its last answer: the tier's pace once on the tier, else the ordinary ramp over its count;
 *  `0` with no run. Both are wave 8's, imported. */
export const collectRunWaitMs = (r: CollectRun, token: CollectRunToken, passIntervalMs: number): number => {
  if (r.kind === 'none') return 0;
  const t = collectRunTier(r, token);
  return t.tier ? childReclaimTierPaceMs(t.tierJ) : childReclaimBackoffMs(r.run, passIntervalMs);
};

/** OBSERVATION 1 (spec §5.10, the licence): an audit of the id answered `collectable` with `token`, ARRIVING at
 *  `arrivedMono`. Keyed (id, token): the entry is the id's, and the token is held only to be COMPARED. */
export interface CollectObservation { readonly token: CollectToken; readonly arrivedMono: number }

/** Why the open-run hold stands (spec §5.10, the gates), as the executor judges it on observation 2's document: the
 *  witness's run is open, absent from coord.db, or opened after the witness; coord.db names the id in an open run;
 *  a fresh collectable document names no witness run; or a store read failed. Spelled once, as a total table's keys. */
const COLLECT_HOLD_WHY_TABLE = {
  'run-open': true, 'run-absent': true, 'run-after-witness': true, 'id-in-open-run': true, 'no-witness-run': true,
  'store-unreadable': true,
} as const satisfies Readonly<Record<string, true>>;
export type CollectHoldWhy = keyof typeof COLLECT_HOLD_WHY_TABLE;
export const COLLECT_HOLD_WHYS: readonly CollectHoldWhy[] = Object.keys(COLLECT_HOLD_WHY_TABLE) as CollectHoldWhy[];

/** The pacing row of each word the collector's audit answers with besides `collectable` and `unmeasured` (spec
 *  §5.10, pacing): ccd's `_ws_collect_refuse` words, held set-equal to them in both directions by a test.
 *  - `defer`: a deferral, neutral to every run; `listedAfterMs` is how long it must answer without a break before the
 *    id is listed (`0`: at once), or null for never by its own continuity.
 *  - `schedule`: `changed-recently`, re-asked from ccd's `idleAt`, and listed after `listedAfterMs` without a break.
 *  - `silent`: `not-witnessed`, which clears the three runs, advances the deferral count, and raises nothing (R87).
 *  - `terminal`: the terminal run.
 *  A verdict word NOT in this table is read as a failure (the failing run): never spent, and listed at the tier. */
export type CollectVerdictRow =
  | { readonly pace: 'defer'; readonly listedAfterMs: number | null }
  | { readonly pace: 'schedule'; readonly listedAfterMs: number }
  | { readonly pace: 'silent' }
  | { readonly pace: 'terminal' };
export const COLLECT_VERDICT_TABLE = {
  'changed-recently': { pace: 'schedule', listedAfterMs: COLLECT_CHANGED_RECENTLY_SPAN_MS },
  'not-witnessed': { pace: 'silent' },
  registered: { pace: 'defer', listedAfterMs: CHILD_RECLAIM_DEFER_CEILING_MS },
  'in-use': { pace: 'defer', listedAfterMs: 0 },
  paused: { pace: 'defer', listedAfterMs: null },
  'in-progress': { pace: 'defer', listedAfterMs: CHILD_RECLAIM_DEFER_CEILING_MS },
  'witness-mismatch': { pace: 'terminal' },
  'quarantine-kept': { pace: 'terminal' },
  'containment-unproven': { pace: 'terminal' },
} as const satisfies Readonly<Record<string, CollectVerdictRow>>;
export type CollectVerdictWord = keyof typeof COLLECT_VERDICT_TABLE;
export const COLLECT_VERDICT_WORDS: readonly CollectVerdictWord[] = Object.keys(COLLECT_VERDICT_TABLE) as CollectVerdictWord[];
const isCollectVerdictWord = (w: string): w is CollectVerdictWord => Object.hasOwn(COLLECT_VERDICT_TABLE, w);

/** A run of one deferral or schedule word, answered without a break (spec §5.10, attention): from the first such
 *  answer's arrival to the latest's, with the latest's detail (ccd's holder, for `in-use`). */
export interface CollectStreak {
  readonly word: CollectVerdictWord; readonly sinceMono: number; readonly lastMono: number; readonly detail: string;
}
/** The open-run hold's continuity: first at `sinceMono`, last at `atMono`, latest for `why`. It keeps NO count: the
 *  hold's next ask waits `CHILD_RECLAIM_DEFER_CEILING_MS` flat (R87). Task 6's `CollectHeld` is the hold's RESULT. */
export interface CollectHoldClock {
  readonly why: CollectHoldWhy; readonly sinceMono: number; readonly atMono: number;
}
/** A recognised pre-lock die other than `flock-unavailable`, recurring with ONE word (R87): from the first such die's
 *  arrival to the latest's. `collectable` observations, the hold and presence continue it; any other answer, act
 *  outcome or would-collect ends it. */
export interface CollectDieStreak {
  readonly word: CollectDieWord; readonly sinceMono: number; readonly lastMono: number;
}
/** The presence defer's continuity and count: deferred `count` times, first at `sinceMono`, last at `atMono`. */
export interface CollectPresence { readonly count: number; readonly sinceMono: number; readonly atMono: number }
/** The LATEST document's own evidence (R88, H3): its witness's run and its leaf (ccd's path, display only). A
 *  collectable, verdict or unmeasured document brings its own; no document and an unreadable one bring none. */
export interface CollectEvidence { readonly runId: number | null; readonly leaf: string | null }

/** THE LANE'S MEMORY OF ONE ID (spec §5.10). Memory only.
 *  - `idGen`: the id's clear generation. Every reset of the pair stamps a generation the lane never used before, so a
 *    request composed before it is stale when it answers (`collectFresh`).
 *  - `obs`: observation 1, or none.
 *  - `deferrals`, `deferredAtMono`: the DEFERRAL count and its last arrival; it never enters a tier.
 *  - `failing`, `verbFailed`, `terminal`: the three runs.
 *  - `scheduleMono`: a `changed-recently` answer's next ask, or none.
 *  - `refusedAtMono`, `wouldCollectAtMono`, `dieAtMono`: the last verb refusal's, the last would-collect's and the last
 *    pre-lock die's (`flock-unavailable` aside) arrival, each the origin of a floor of `CHILD_RECLAIM_DEFER_CEILING_MS`
 *    under the next ask.
 *  - `streak`, `die`, `held`, `presence`: the four continuity clocks attention reads.
 *  - `evidence`: the latest document's.
 *  - `feedEpisode`: the key of the feed episode whose row was written, or none (`collectFeedStep`). */
export interface CollectEntry {
  readonly idGen: number;
  readonly obs: CollectObservation | null;
  readonly deferrals: number;
  readonly deferredAtMono: number | null;
  readonly failing: CollectRun;
  readonly verbFailed: CollectRun;
  readonly terminal: CollectRun;
  readonly scheduleMono: number | null;
  readonly refusedAtMono: number | null;
  readonly wouldCollectAtMono: number | null;
  readonly dieAtMono: number | null;
  readonly streak: CollectStreak | null;
  readonly die: CollectDieStreak | null;
  readonly held: CollectHoldClock | null;
  readonly presence: CollectPresence | null;
  readonly evidence: CollectEvidence;
  readonly feedEpisode: string | null;
}

/** A first sighting, and every id after a restart: nothing observed, nothing counted, due at once. `gen` is a clear
 *  generation the lane never used before. */
export const collectFirstSighting = (gen: number): CollectEntry => ({
  idGen: gen, obs: null, deferrals: 0, deferredAtMono: null,
  failing: COLLECT_RUN_NONE, verbFailed: COLLECT_RUN_NONE, terminal: COLLECT_RUN_NONE,
  scheduleMono: null, refusedAtMono: null, wouldCollectAtMono: null, dieAtMono: null,
  streak: null, die: null, held: null, presence: null, evidence: { runId: null, leaf: null }, feedEpisode: null,
});

/** One step's context: `now` is the answer's ARRIVAL (or the executor's decision), read in its own callback; `gen`
 *  is a clear generation the lane never used before, drawn from the ONE counter both kinds of generation come from,
 *  stamped only by a transition that resets the pair; `passIntervalMs` is the lane's pass interval. */
export interface CollectStep {
  readonly now: ChildReclaimLaneNow;
  readonly gen: number;
  readonly passIntervalMs: number;
}

/** What a request was composed under (spec §5.10, stale answers): the lane-wide clear generation and the id's. */
export interface CollectCapture { readonly lane: number; readonly id: number }

export const collectCapture = (laneGen: number, e: CollectEntry): CollectCapture => ({ lane: laneGen, id: e.idGen });

/** Is an answer to a request composed under `cap` an OBSERVATION? Only when neither generation has moved since, and
 *  the id is still remembered: a lane-wide clear, any reset of the id's pair, and forgetting the id each make every
 *  earlier request stale. A stale answer paces the id like any other, and is never an observation. A plain boolean,
 *  never a type predicate: false means the id is forgotten OR the answer is stale, and a stale answer's entry is still
 *  the id's, to be paced, so a caller checks `undefined` itself. */
export const collectFresh = (cap: CollectCapture, laneGen: number, e: CollectEntry | undefined): boolean =>
  e !== undefined && cap.lane === laneGen && cap.id === e.idGen;

/** A lane-wide clear (a raised pause, an unlistable registry, a missing capability, a pass that failed shut, a flip
 *  of the live marker): the OBSERVATION PAIR only. The pacing, every run, the continuity clocks and the feed episode
 *  stand (spec §5.10). The caller moves the lane-wide generation in the same act. */
export const collectClearPair = (e: CollectEntry): CollectEntry => (e.obs === null ? e : { ...e, obs: null });

/** A `changed-recently` answer's next ask (spec §5.10, pacing): `arrival.monoMs + clamp(idleAt·1000 − arrival.wallMs,
 *  passIntervalMs, 24 h)`. The wall clock is compared once, here, with ccd's own stamp; what is stored is monotonic.
 *  An `idleAt` that is not a finite non-negative integer, or a wall clock that makes the difference no number, has
 *  no schedule: the answer takes the deferral wait. idleAt never gates a spend; ccd decides the floor in its lock. */
export type CollectIdleSchedule = { readonly kind: 'at'; readonly monoMs: number } | { readonly kind: 'no-idle-at' };
export function collectIdleSchedule(idleAt: number | null, arrival: ChildReclaimLaneNow, passIntervalMs: number): CollectIdleSchedule {
  if (idleAt === null || !Number.isInteger(idleAt) || idleAt < 0) return { kind: 'no-idle-at' };
  const ahead = idleAt * 1000 - arrival.wallMs;
  if (Number.isNaN(ahead)) return { kind: 'no-idle-at' };
  return { kind: 'at', monoMs: arrival.monoMs + Math.min(Math.max(ahead, passIntervalMs), COLLECT_CHANGED_RECENTLY_SPAN_MS) };
}

/** The memory after one AUDIT answer (spec §5.10, pacing). `observes` is `collectFresh` of the request's capture:
 *  a stale answer paces the id as any answer does, and never seeds or continues an observation.
 *  - `collectable`: passed every rung, so the deferral count and the failing run clear; the verb-failed and terminal
 *    runs NEVER do. A fresh one with the token observation 1 holds continues the pair, observation 1 keeping its first
 *    arrival; with another token, or none held, it is observation 1 afresh.
 *  - Every other answer resets the pair.
 *  - A `defer` word, and an `unmeasured` box-wide probe: a deferral.
 *  - `changed-recently`: clears the deferral count and the failing run, and schedules from `idleAt`; without one it is
 *    a deferral.
 *  - `not-witnessed`: clears the three runs and ADVANCES the deferral count, so it is asked no sooner than the ramp (R87).
 *  - A terminal word: the terminal run, on the tier at once.
 *  - An `unmeasured` per-leaf or load-sensitive probe (an unknown probe word is load-sensitive), `no-document`,
 *    `unreadable` and a verdict word the table does not know: the failing run, a per-leaf probe on the tier at once.
 *  The hold's, presence's and the die's continuity end at every answer but a `collectable` one; a deferral or schedule
 *  word continues its own streak and every other answer ends it. Only `changed-recently` keeps a schedule. A
 *  collectable, verdict or unmeasured document brings its own evidence; no document and an unreadable one keep the last. */
export function collectAfterAudit(e: CollectEntry, a: CollectAudit, s: CollectStep, observes: boolean): CollectEntry {
  const t = s.now.monoMs;
  // the LATEST document's evidence (R88, H3): every document that carries one brings it; the rest keep the last
  const d: CollectEntry = a.kind === 'no-document' || a.kind === 'unreadable'
    ? e : { ...e, evidence: { runId: a.witnessRun, leaf: a.leaf } };
  // EVERY answer but a fresh observation of the token held resets the pair, under a new generation (spec §5.10)
  const reset = { obs: null, idGen: s.gen } as const;
  const ended = { held: null, presence: null, streak: null, scheduleMono: null, die: null } as const;
  const deferral = { deferrals: e.deferrals + 1, deferredAtMono: t } as const;
  const undeferred = { deferrals: 0, deferredAtMono: null } as const;
  const failure = (word: string, detail: string, stuck: boolean): CollectEntry =>
    ({ ...d, ...reset, ...ended, ...undeferred, failing: collectRunAdvance(e.failing, t, word, detail, stuck) });
  const streak = (word: CollectVerdictWord, detail: string): CollectStreak =>
    (e.streak !== null && e.streak.word === word
      ? { ...e.streak, lastMono: t, detail }
      : { word, sinceMono: t, lastMono: t, detail });
  switch (a.kind) {
    case 'collectable': {
      const passed: CollectEntry = { ...d, ...undeferred, failing: COLLECT_RUN_NONE, streak: null, scheduleMono: null };
      if (!observes) return { ...passed, ...reset };
      if (e.obs !== null && e.obs.token === a.token) return passed;
      return { ...passed, obs: { token: a.token, arrivedMono: t }, idGen: s.gen };
    }
    case 'verdict': {
      if (!isCollectVerdictWord(a.verdict)) return failure(a.verdict, a.detail, false);
      const word = a.verdict;
      const row: CollectVerdictRow = COLLECT_VERDICT_TABLE[word];
      if (row.pace === 'terminal') {
        return { ...d, ...reset, ...ended, ...undeferred, terminal: collectRunAdvance(e.terminal, t, word, a.detail, true) };
      }
      if (row.pace === 'silent') {
        return { ...d, ...reset, ...ended, ...deferral,
          failing: COLLECT_RUN_NONE, verbFailed: COLLECT_RUN_NONE, terminal: COLLECT_RUN_NONE };
      }
      if (row.pace === 'defer') return { ...d, ...reset, ...ended, ...deferral, streak: streak(word, a.detail) };
      const at = collectIdleSchedule(a.idleAt, s.now, s.passIntervalMs);
      const base: CollectEntry = { ...d, ...reset, ...ended, failing: COLLECT_RUN_NONE, streak: streak(word, a.detail) };
      return at.kind === 'at' ? { ...base, ...undeferred, scheduleMono: at.monoMs } : { ...base, ...deferral };
    }
    case 'unmeasured': {
      const cls = collectProbeClass(a.probe);
      if (cls === 'box-wide') return { ...d, ...reset, ...ended, ...deferral };
      return failure(a.probe, a.detail, cls === 'per-leaf');
    }
    case 'no-document': return failure('no-document', a.stderr, false);
    case 'unreadable': return failure('unreadable', a.detail, false);
  }
}

/** The memory after the ACT (spec §5.10, pacing). Every outcome resets the pair and ends every continuity clock but
 *  a recurring die's.
 *  - `collected`: every run, count and floor clears, as at a first sighting.
 *  - `refused`, of any word, retryable included: a deferral, and the refusal floor. A terminal word (the verb's
 *    refusal table, `collectRefusalClass`) also advances the terminal run, ahead of the refusal row (R87). A
 *    `not-witnessed` reads as the audit's (H7): the three runs clear, beside the deferral and the floor.
 *  - `failed` whose word is terminal (`failed quarantine-kept`): the terminal run, ahead of the verb-failed row (R87).
 *  - Any other `failed`, a reader-made `''` included, and `no-document` (an act that MAY have acted): the verb-failed run.
 *  - `die` (a recognised pre-lock die, which acted nothing): a deferral, neutral to every run. Every word but
 *    `flock-unavailable`, which latches box-wide instead (Task 7), also takes the refusal floor (`dieAtMono`) and
 *    continues a die streak of its own word, which attention reads past the ceiling (R87). */
export function collectAfterAct(e: CollectEntry, r: CollectResult, s: CollectStep): CollectEntry {
  const t = s.now.monoMs;
  const after: CollectEntry = {
    ...e, obs: null, idGen: s.gen, held: null, presence: null, streak: null, scheduleMono: null, die: null,
  };
  switch (r.kind) {
    case 'collected':
      return { ...collectFirstSighting(s.gen), evidence: e.evidence, feedEpisode: e.feedEpisode };
    case 'refused': {
      const silent = isCollectVerdictWord(r.word) && COLLECT_VERDICT_TABLE[r.word].pace === 'silent';
      const runs: Partial<CollectEntry> = silent
        ? { failing: COLLECT_RUN_NONE, verbFailed: COLLECT_RUN_NONE, terminal: COLLECT_RUN_NONE }
        : collectRefusalClass(r.word) === 'terminal'
          ? { terminal: collectRunAdvance(e.terminal, t, r.word, r.detail, true) } : {};
      return { ...after, ...runs, deferrals: e.deferrals + 1, deferredAtMono: t, refusedAtMono: t };
    }
    case 'failed':
      return collectRefusalClass(r.token) === 'terminal'
        ? { ...after, deferrals: 0, deferredAtMono: null, terminal: collectRunAdvance(e.terminal, t, r.token, r.detail, true) }
        : { ...after, deferrals: 0, deferredAtMono: null,
          verbFailed: collectRunAdvance(e.verbFailed, t, r.token, r.detail, false) };
    case 'no-document':
      return { ...after, deferrals: 0, deferredAtMono: null,
        verbFailed: collectRunAdvance(e.verbFailed, t, 'no-document', r.stderr, false) };
    case 'die': {
      if (r.word === 'flock-unavailable') return { ...after, deferrals: e.deferrals + 1, deferredAtMono: t };
      return { ...after, deferrals: e.deferrals + 1, deferredAtMono: t, dieAtMono: t,
        die: e.die !== null && e.die.word === r.word ? { ...e.die, lastMono: t } : { word: r.word, sinceMono: t, lastMono: t } };
    }
  }
}

/** The memory after the open-run hold stood (spec §5.10, the gates): the pair resets, and the hold's continuity runs
 *  on. It counts nothing: no run, not the deferral count, and no count of its own. Its next ask waits
 *  `CHILD_RECLAIM_DEFER_CEILING_MS` flat (R87). */
export function collectAfterHold(e: CollectEntry, why: CollectHoldWhy, s: CollectStep): CollectEntry {
  const t = s.now.monoMs;
  return { ...e, obs: null, idGen: s.gen, presence: null, held: { why, sinceMono: e.held?.sinceMono ?? t, atMono: t } };
}

/** The memory after the presence defer (spec §5.10, the gates): the pair resets, and presence's own count and
 *  continuity run on. No ceiling licenses past it: it is only ever listed. */
export function collectAfterPresence(e: CollectEntry, s: CollectStep): CollectEntry {
  const t = s.now.monoMs;
  return { ...e, obs: null, idGen: s.gen, held: null,
    presence: { count: (e.presence?.count ?? 0) + 1, sinceMono: e.presence?.sinceMono ?? t, atMono: t } };
}

/** The memory after a shadowed job recorded "would collect" (spec §5.10, shadow): the pair resets, no run moves, and
 *  the next learning audit waits the shadow floor, so shadow never audits a collectable id every pass. */
export function collectAfterWouldCollect(e: CollectEntry, s: CollectStep): CollectEntry {
  return { ...e, obs: null, idGen: s.gen, held: null, presence: null, die: null, wouldCollectAtMono: s.now.monoMs };
}

/** THE NEXT ASK (spec §5.10, pacing): the LATEST of every wait that applies, each counted from its own last arrival.
 *  - the deferral wait, `childReclaimBackoffMs` over the deferral count;
 *  - each run's wait (`collectRunWaitMs`);
 *  - the `changed-recently` schedule;
 *  - the hold's wait: the ceiling, flat (R87: no count of its own);
 *  - presence's wait: the ramp over its own count;
 *  - the refusal, die and shadow floors, the ceiling after each;
 *  - while observation 1 stands, the observation interval after its arrival, so a holder is not offered again
 *    before its partner may be composed.
 *  null when no wait applies: the id is due at once. */
export function collectNextAskMono(e: CollectEntry, passIntervalMs: number, observeIntervalMs: number): number | null {
  const waits: number[] = [];
  if (e.deferredAtMono !== null) waits.push(e.deferredAtMono + childReclaimBackoffMs(e.deferrals, passIntervalMs));
  for (const [r, token] of [[e.failing, 'failing'], [e.verbFailed, 'verb-failed'], [e.terminal, 'terminal']] as const) {
    if (r.kind === 'run') waits.push(r.atMono + collectRunWaitMs(r, token, passIntervalMs));
  }
  if (e.scheduleMono !== null) waits.push(e.scheduleMono);
  if (e.held !== null) waits.push(e.held.atMono + CHILD_RECLAIM_DEFER_CEILING_MS);
  if (e.presence !== null) waits.push(e.presence.atMono + childReclaimBackoffMs(e.presence.count, passIntervalMs));
  if (e.refusedAtMono !== null) waits.push(e.refusedAtMono + CHILD_RECLAIM_DEFER_CEILING_MS);
  if (e.dieAtMono !== null) waits.push(e.dieAtMono + CHILD_RECLAIM_DEFER_CEILING_MS);
  if (e.wouldCollectAtMono !== null) waits.push(e.wouldCollectAtMono + CHILD_RECLAIM_DEFER_CEILING_MS);
  if (e.obs !== null) waits.push(e.obs.arrivedMono + observeIntervalMs);
  return waits.length === 0 ? null : Math.max(...waits);
}

/** May the lane ask about this id now? At or after its next ask, or at once with none. A clock that is no number is
 *  never due. */
export const collectDue = (e: CollectEntry, nowMono: number, passIntervalMs: number, observeIntervalMs: number): boolean => {
  const next = collectNextAskMono(e, passIntervalMs, observeIntervalMs);
  return next === null ? Number.isFinite(nowMono) : nowMono >= next;
};

/** Is the id RIPE, offered the act job (spec §5.10)? Due, with observation 1 standing. A due id without one is
 *  offered a learning audit instead. */
export const collectRipe = (e: CollectEntry, nowMono: number, passIntervalMs: number, observeIntervalMs: number): boolean =>
  e.obs !== null && collectDue(e, nowMono, passIntervalMs, observeIntervalMs);

/** THE LICENCE, the ONE rule (spec §5.10, two observations, one job, one act). `ws-collect` may be spent only when:
 *  - observation 2, the executor's own audit in the act's job, is an observation (`observes`, its capture fresh);
 *  - it answered `collectable`;
 *  - observation 1, read from memory before observation 2 was applied, stands;
 *  - both carry ONE token;
 *  - observation 2 ARRIVED at least `observeIntervalMs` after observation 1 did, on the monotonic clock.
 *  Every answer between the two was `collectable` with that token, because any other answer resets the pair. All
 *  three token modes take this rule. A difference that is no finite number, or an interval that is not positive,
 *  never licenses. The licence carries NO token: the argv's token is observation 2's own, read off its parsed
 *  document where the argv is built. `first` is kept for step 6's re-read (`collectLicenceStands`). */
export type CollectLicence =
  | { readonly kind: 'licensed'; readonly first: CollectObservation }
  | { readonly kind: 'stale' | 'not-collectable' | 'no-first' | 'token-changed' | 'too-soon' };
export function collectLicence(
  first: CollectObservation | null, second: CollectAudit, secondArrivedMono: number, observeIntervalMs: number,
  observes: boolean,
): CollectLicence {
  if (!observes) return { kind: 'stale' };
  if (second.kind !== 'collectable') return { kind: 'not-collectable' };
  if (first === null) return { kind: 'no-first' };
  if (second.token !== first.token) return { kind: 'token-changed' };
  const span = secondArrivedMono - first.arrivedMono;
  if (!(Number.isFinite(span) && observeIntervalMs > 0 && span >= observeIntervalMs)) return { kind: 'too-soon' };
  return { kind: 'licensed', first };
}

/** Step 6's re-read (spec §5.10): after the job's last await, the licence still stands only while neither generation
 *  captured when observation 2 was composed (`composed`) has moved by `now`, and memory still holds the very
 *  observation 1 the licence was judged on (`obs`). The executor calls it through its port (H3): `now` is
 *  `lane.generations(id)`, whose `id` is -1 for a forgotten id (a generation no entry carries), and `obs` is
 *  `lane.observation(id)`. */
export const collectLicenceStands = (
  first: CollectObservation, composed: CollectCapture, now: CollectCapture, obs: CollectObservation | null,
): boolean =>
  composed.lane === now.lane && composed.id === now.id
  && obs !== null && obs.token === first.token && obs.arrivedMono === first.arrivedMono;

/** One reason the id stands on the attention list (spec §5.10, attention), in a fixed order, the most severe first.
 *  `collectAttentionItems` writes the item; this says only that it stands.
 *  - `terminal`: the terminal run stands, at once.
 *  - `failing`, `verb-failed`: that run is on the tier.
 *  - `in-use`: at once. `registered`, `in-progress`: answered without a break for the ceiling. `changed-recently`: for
 *    24 hours. Each measured from the streak's first answer to its latest.
 *  - `held`, `presence`: deferred so for the ceiling, first to latest.
 *  - `die`: one pre-lock die word recurring for the ceiling, first to latest (R87). */
export type CollectAttentionCause =
  | { readonly kind: 'terminal' | 'failing' | 'verb-failed'; readonly word: string; readonly detail: string }
  | { readonly kind: CollectVerdictWord; readonly detail: string; readonly sinceMono: number }
  | { readonly kind: 'held'; readonly why: CollectHoldWhy; readonly sinceMono: number }
  | { readonly kind: 'presence'; readonly sinceMono: number }
  | { readonly kind: 'die'; readonly word: CollectDieWord; readonly sinceMono: number };
export function collectAttentionCauses(e: CollectEntry): CollectAttentionCause[] {
  const out: CollectAttentionCause[] = [];
  const runs = [['terminal', e.terminal], ['failing', e.failing], ['verb-failed', e.verbFailed]] as const;
  for (const [token, r] of runs) {
    if (r.kind === 'run' && collectRunTier(r, token).tier) out.push({ kind: token, word: r.word, detail: r.detail });
  }
  const s = e.streak;
  if (s !== null) {
    const row: CollectVerdictRow = COLLECT_VERDICT_TABLE[s.word];
    const after = row.pace === 'defer' || row.pace === 'schedule' ? row.listedAfterMs : null;
    if (after !== null && s.lastMono - s.sinceMono >= after) out.push({ kind: s.word, detail: s.detail, sinceMono: s.sinceMono });
  }
  if (e.held !== null && e.held.atMono - e.held.sinceMono >= CHILD_RECLAIM_DEFER_CEILING_MS) {
    out.push({ kind: 'held', why: e.held.why, sinceMono: e.held.sinceMono });
  }
  if (e.presence !== null && e.presence.atMono - e.presence.sinceMono >= CHILD_RECLAIM_DEFER_CEILING_MS) {
    out.push({ kind: 'presence', sinceMono: e.presence.sinceMono });
  }
  if (e.die !== null && e.die.lastMono - e.die.sinceMono >= CHILD_RECLAIM_DEFER_CEILING_MS) {
    out.push({ kind: 'die', word: e.die.word, sinceMono: e.die.sinceMono });
  }
  return out;
}

/** What one step means for the feed (spec §5.9's quiet-on-repeat, as the collector reads it). Task 5's
 *  `collectFeedCueOfAudit` and `collectFeedCueOfAct` say which cue each answer carries.
 *  - `row`: one row per episode of `key`; a repeat is quiet, and any other key ends the episode.
 *  - `observe`: an observation of `token`: no row; a would-collect episode of that token stands, any other ends.
 *  - `quiet`: no row, and the standing episode stands. */
export type CollectFeedCue =
  | { readonly kind: 'row'; readonly key: string }
  | { readonly kind: 'observe'; readonly token: CollectToken }
  | { readonly kind: 'quiet' };

/** The would-collect episode's key: one per (id, token), so a later would-collect of the same token is quiet. In
 *  memory only, for comparison: never a sentence. */
const COLLECT_WOULD_COLLECT_PREFIX = 'would-collect ';
export const collectWouldCollectKey = (token: CollectToken): string => `${COLLECT_WOULD_COLLECT_PREFIX}${token}`;

/** Does a would-collect episode stand for this id? Task 5's projection reads it (R82's shadow item), so no token is
 *  carried or cast to answer it: true while the feed episode is a would-collect key. */
export const collectWouldCollectStands = (e: CollectEntry): boolean =>
  e.feedEpisode !== null && e.feedEpisode.startsWith(COLLECT_WOULD_COLLECT_PREFIX);

/** The feed episode after one step: the entry, and the key of the episode it opened (a row is due), or null. */
export function collectFeedStep(e: CollectEntry, cue: CollectFeedCue): { readonly entry: CollectEntry; readonly opened: string | null } {
  switch (cue.kind) {
    case 'quiet': return { entry: e, opened: null };
    case 'observe':
      return e.feedEpisode === null || e.feedEpisode === collectWouldCollectKey(cue.token)
        ? { entry: e, opened: null }
        : { entry: { ...e, feedEpisode: null }, opened: null };
    case 'row':
      return e.feedEpisode === cue.key
        ? { entry: e, opened: null }
        : { entry: { ...e, feedEpisode: cue.key }, opened: cue.key };
  }
}
