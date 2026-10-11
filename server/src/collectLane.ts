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
import { CHILD_RUN_ID, type CollectToken } from '../../shared/api.js';

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
