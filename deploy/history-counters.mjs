#!/usr/bin/env -S node --no-warnings
// deploy/history-counters.mjs: the ccrc history W2 report-only counters (spec 2026-10-05 §10.2, "The live A/B", its
// counters; W2 decisions W2-D86 to W2-D88).
//
// An L4 operator script and a STANDALONE entry (W2-D88). The operator runs it by hand after the window ends: on each named
// node, over that node's store, then over the nodes' reports together. It reports beside the gate's verdict and never
// feeds it: nothing here reaches decideGate, history-replay.mjs never imports this file, and gate_code does not hash it
// (history-replay.test.ts pins all three), so every report names this file's own sha256. It ships in the release part 1
// pins and runs on the tree the build freeze holds still (W2-D6).
//
// What it reports (W2-D86, W2-D87): the five spec counters and re-discovery, each per window of a listed family, by arm
// and by the producer of the window's boundary (W2-D15), as the signed defaults part 1 carries (counters_def). Their
// names and texts are the gate's COUNTERS_DEF_V1, imported and never spelled here. The windows and their turns are the
// gate's (buildWindows, windowCopyOf, turnsOf; W2-D14, D-5770, D-5771) over measure-history.py's raw rows; the arm is the
// record's assignment. A family whose recall-off file changed in the window, or whose verify --section ab state is any
// but ok (W2-D23 as extended by Q15 and W2-D84's never-fold), is dropped from the arm comparison only: kept in the
// per-window rows and tallied apart by arm and by producer. A verify output whose presence record has not seen the newest
// recall-off write is refused. Every figure names its source. A window or a counter that was not measured is unmeasured with its reason,
// never 0, and a gap between two measures is reported, never repaired. The node-wide counters table, and
// measure-history.py's copy of it, is never read: its totals are not per window (W2-D87).
//
// Imports: node: built-ins; ../ccd/history/lib.mjs; ../ccd/history/store.mjs, whose read-only openReader opens every store
// read (W2-D51: this file spells no node:sqlite specifier); ./history-gate.mjs, the pure gate (W2-D11); and
// ./history-replay.mjs's argv grammar, refusal, input loader, part 2 loader, --out rule and verify --section ab words
// (W2-D25, W2-D24, W2-D53), imported so that none is spelled a second time. Importing the driver loads cli.mjs, which sets
// this process's umask to 0o077; main sets it again. history-replay.test.ts pins the exact list and the names each module
// brings in.
// Its words are the driver's DRIVER_REASONS (W2-D12, W2-D59), thrown through its refuse, never a list of this file's own.
// A refusal prints `ccrc history-counters: <word>: <detail>` on stderr and exits EXIT.REFUSED (2); a defect exits
// EXIT.INTERNAL (1). Environment: none. main reads no process environment, and --store names the store.
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BACKENDS, CARD_ATTACHMENT_MAX_BYTES, CARD_MEASURE_ROWS, EXIT, PARSE_STATUS, PROV_VERSION, SCHEMA_ADDED, UUID_RE, canonicalJson, cardIdsIn, cardWindowComplete, decideCardDelivery, eofAfterBoundary, sha256Hex } from '../ccd/history/lib.mjs';
import { StoreError, openReader, userVersion } from '../ccd/history/store.mjs';
import { holdingCopyOf } from '../ccd/history/derive.mjs';
import { expandEntryBody } from '../ccd/history/recall.mjs';
import { ASSIGNMENT_ARMS, COUNTERS_DEF_V1, COUNTERS_DEF_V1_SHA256, K, K_UNIT, assembleReports, buildWindows, changedFamilies, familyKey, turnsOf, windowCopyOf, windowOf } from './history-gate.mjs';
import { AB_STATES, DriverRefusal, VERIFY_AB_KIND, loadFinalRecord, loadInput, parseArgs, prepareOut, refuse } from './history-replay.mjs';

// ── the counters' names, the unmeasured words and the answers (W2-D87) ─────────────────────────────────────────────
/** The counters this file reports, in COUNTERS_DEF_V1's order: derived from the gate's frozen text, never spelled. */
export const COUNTER_NAMES = Object.freeze(COUNTERS_DEF_V1.map((c) => c.name));

/** Why one counter of one window is unmeasured, each word its own condition, never folded into a measured 0. A measure
 *  answering any other word is a defect (unmeasured and answerOf throw), so no reason is invented unseen; each counter's
 *  task appends its own words here, in place. */
export const COUNTER_UNMEASURED = Object.freeze([
  'window-unmeasured',   // the window itself is unmeasured (W2-D14), and the counter needs it
  'pending',             // the stand-in every counter answers until its own measure lands (removed by W2-6 Task 3)
  'boundary-absent',     // the store holds no boundary row with this uuid
  'boundary-moved',      // the store holds the boundary at another line of the window copy's file than the measure printed
  'leaf-absent',         // the boundary has no depth-0 leaf: no status, and no leaf id for a card line to name
  'leaf-ambiguous',      // more than one depth-0 leaf names the boundary
  'boundary-uncopied',   // no copy holds the boundary (holdingCopyOf answered null), which card.mjs reads as none (D-6562)
  'no-measured-tick',    // no ticks row at or before the boundary has a measured lag
  'card-wait',           // the card's delivery window was still open at the read instant
]);

/** @typedef {{ state: 'measured', value: unknown } | { state: 'unmeasured', why: string }} Measure */
/** A measured answer. Its value is never null or undefined: answerOf refuses either, which would read as nothing.
 *  @param {unknown} value  @returns {Measure} */
function measured(value) {
  return { state: 'measured', value };
}
/** An unmeasured answer; a word outside COUNTER_UNMEASURED is a defect that throws here, at its source.
 *  @param {string} why  @returns {Measure} */
function unmeasured(why) {
  if (!COUNTER_UNMEASURED.includes(why)) throw new TypeError(`history-counters: ${JSON.stringify(why)} is not a COUNTER_UNMEASURED word`);
  return { state: 'unmeasured', why };
}
/** A fold's guard: the frame never folds nothing (a stratum with no measured window has a null summary), so a fold handed
 *  an empty list is a defect.  @param {string} name  @param {unknown[]} values  @returns {unknown[]} */
function nonEmpty(name, values) {
  if (!Array.isArray(values) || values.length === 0) throw new TypeError(`${name}: a fold over no measured window is a defect (the frame answers null)`);
  return values;
}

/** @typedef {{ db: object, storeId: string, version: number, schema: object, close: () => void }} CounterStore */
/** What a measure is handed for one boundary, frozen: the store; the family and its arm; the raw boundary report; the
 *  gate's window; for a measured window only, the gate's window copy and its first K turns (both null otherwise); the
 *  family's raw calls; and the run's read instant.
 *  @typedef {{ rs: CounterStore, family: Readonly<{key: string, store_id: string, ccrc_id: string, generation: string, arm: string}>,
 *    boundary: object, window: object, copy: object | null, turns: Array<object> | null, calls: Array<[number, number, string]>,
 *    nowMs: number }} WindowCtx */
/** One counter: the source it reads, named; its measure of one window; its fold of a stratum's measured values, never
 *  called on none.
 *  @typedef {{ source: string, measure: (ctx: WindowCtx) => Measure, fold: (values: unknown[]) => unknown }} CounterSpec */

/** The frame's own sources, named in every report beside each counter's (W2-D87: every source is named). */
export const FRAME_SOURCES = Object.freeze({
  windows: 'measure-history.py w2.families (raw rows) through history-gate buildWindows, windowCopyOf and turnsOf; W2-D14, W2-D15',
  producer: 'history-gate windowOf: lib producerOf over the models of the copy lib pickHoldingCopy chooses (W2-D15)',
  arm: 'the open record part 2 assignment',
  changed: 'measure-history.py w2.recall_off through history-gate changedFamilies (W2-D23)',
  unrealised: `this node's verify --section ab output: a family whose state is any but ${AB_STATES[0]}, each state listed apart: `
    + `${AB_STATES.slice(1).join(', ')} (W2-D23 as extended by Q15 and W2-D84's never-fold)`,
  recall_calls: 'measure-history.py w2.families calls (recall_calls rows with arm IS NULL), counted inside each window by history-gate windowOf',
  excluded: 'history-gate assembleReports over this node\'s assignment: not_found, zero_windows, unmeasured, not_listed (W2-D22)',
  recall_off_gaps: 'measure-history.py w2.recall_off gap rows through history-gate changedFamilies: reported, never dropped (W2-D23)',
  record_nodes: 'the open record part 2 nodes, by store_id: the stores a combine expects one report from (U2)',
});

/** The pooled stratum's key, beside lib's BACKENDS: every producer of one arm. */
export const ALL_PRODUCERS = 'all';
/** The report's kind, and its one file under --out. */
export const COUNTERS_KIND = 'ccrc-history-w2-counters';
export const COUNTERS_FILE = 'counters.json';
/** The most bytes one input report is read to: raw rows over every listed family (the driver's census cap). */
const MEASURE_CAP = 256 * 1024 * 1024;
/** verify --section ab's realised answer: AB_STATES' first word (a parity case holds it to the driver's abStateOf). */
const AB_OK = AB_STATES[0];
const PREFIX = 'ccrc history-counters';

// ── the frame: windows, turns, arms, producers, the drops and the strata (W2-D86, W2-D87, W2-D15, W2-D23) ─────────
/** The measures a report is built with: exactly COUNTER_NAMES, in order, each a CounterSpec. Anything else is a defect. */
function checkMeasures(measures) {
  const names = measures !== null && typeof measures === 'object' ? Object.keys(measures) : [];
  if (names.join('\n') !== COUNTER_NAMES.join('\n')) {
    throw new TypeError(`countersReport: measures are ${JSON.stringify(names)}, and COUNTERS_DEF_V1 names ${JSON.stringify(COUNTER_NAMES)}`);
  }
  for (const n of COUNTER_NAMES) {
    const s = measures[n];
    if (typeof s?.source !== 'string' || s.source === '' || typeof s.measure !== 'function' || typeof s.fold !== 'function') {
      throw new TypeError(`countersReport: measure ${n} needs a source, a measure and a fold`);
    }
  }
}

/** One measure's answer, checked: measured with a value (never null), or unmeasured with a COUNTER_UNMEASURED word.
 *  Anything else is a defect.  @param {string} name  @param {unknown} a  @returns {Measure} */
function answerOf(name, a) {
  const o = /** @type {any} */ (a);
  if (o?.state === 'measured' && o.value !== undefined && o.value !== null) return { state: 'measured', value: o.value };
  if (o?.state === 'unmeasured' && COUNTER_UNMEASURED.includes(o.why)) return { state: 'unmeasured', why: o.why };
  throw new TypeError(`countersReport: ${name} answered ${JSON.stringify(a ?? null)}: a measure answers measured with a value or unmeasured with a COUNTER_UNMEASURED word`);
}

/** assembleReports' refusal as a driver word: its two code words are DRIVER_REASONS words too; every other is about an
 *  input the operator handed in, so input-invalid with the gate's word leading the detail.  @returns {never} */
function gateRefusal(reason, detail) {
  if (reason === 'code-changed' || reason === 'code-unmeasured') refuse(reason, detail);
  refuse('input-invalid', `${reason}: ${detail}`);
}

/** The families of `assignment` whose recall-off file changed in the window, and the gap rows, from the report's raw
 *  presence rows through the gate's changedFamilies (W2-D23). An absent or malformed list is unmeasured and refused, never
 *  "nothing changed"; a row off W2-D30's grammar is the gate's throw, refused as input-invalid. */
function changedOf(report, window, assignment) {
  const rows = report.w2.recall_off;
  if (!Array.isArray(rows) || !rows.every((r) => Array.isArray(r) && r.length === 2 && typeof r[0] === 'string' && typeof r[1] === 'string')) {
    refuse('input-invalid', 'measure w2.recall_off is not a list of [k, v] string pairs: the presence record is unmeasured, never "nothing changed"');
  }
  try {
    return changedFamilies(rows.map(([k, v]) => ({ store_id: report.store_id, k, v })), window, assignment);
  } catch (e) {
    if (e instanceof Error) refuse('input-invalid', `measure w2.recall_off: ${e.message}`);
    throw e;
  }
}

/** What a measure is handed for one boundary (W2-D86, W2-D15, D-5771): a measured window's turns are the gate's turn
 *  rule over the gate's WINDOW copy, its first K, never the producer's copy; an unmeasured window has neither. The one
 *  place this file calls turnsOf.  @returns {WindowCtx} */
export function windowCtx({ rs, family, boundary, window, calls, nowMs }) {
  if (boundary?.boundary_uuid !== window.boundary_uuid) throw new Error(`windowCtx: window ${window.boundary_uuid} is not boundary ${boundary?.boundary_uuid}'s`);
  const copy = window.state === 'measured' ? windowCopyOf(boundary.copies) : null;
  const turns = copy === null ? null : turnsOf(copy.rows).slice(0, K);
  if (turns !== null && turns.length !== window.turns) throw new Error(`windowCtx: window ${window.boundary_uuid} counts ${window.turns} turns, and its copy gives ${turns.length}`);
  return Object.freeze({ rs, family, boundary, window, copy, turns, calls, nowMs });
}

/** One boundary's row: the gate's window, the drops, and every counter's answer for it (U5: every measure is asked for
 *  every boundary; a measure that needs the window answers window-unmeasured itself). */
export function windowRow({ ctx, changed, abState, measures }) {
  const { family, window: w } = ctx;
  if (!ASSIGNMENT_ARMS.includes(family.arm)) throw new TypeError(`windowRow: family ${family.key} has arm ${JSON.stringify(family.arm)}`);
  if (!BACKENDS.includes(w.producer)) throw new TypeError(`windowRow: window ${w.boundary_uuid} has producer ${JSON.stringify(w.producer)}`);
  if (!AB_STATES.includes(abState)) throw new TypeError(`windowRow: family ${family.key} has verify state ${JSON.stringify(abState)}`);
  const isMeasured = w.state === 'measured';
  return {
    family: family.key, store_id: family.store_id, ccrc_id: family.ccrc_id, generation: family.generation, arm: family.arm,
    changed, unrealised: abState !== AB_OK, ab_state: abState,
    boundary_uuid: w.boundary_uuid, ts_ms: w.ts_ms, producer: w.producer, state: w.state,
    turns: isMeasured ? w.turns : null,
    recall_calls: isMeasured ? w.calls : null,
    measures: Object.fromEntries(COUNTER_NAMES.map((n) => [n, answerOf(n, measures[n].measure(ctx))])),
  };
}

/** This node's verify --section ab output (the driver's VERIFY_AB_KIND), read as W2-D23's realisation record (Q15): of
 *  this run's record and this store, listing exactly this store's assigned families at their arms, each once, each in an
 *  AB_STATES word. Answers each family's state by family key. */
function abStatesOf(ab, recordSha256, storeId, assignment) {
  const bad = (what) => refuse('input-invalid', `verify-ab-${what}`);
  if (ab === null || typeof ab !== 'object' || ab.kind !== VERIFY_AB_KIND || ab.v !== 1 || !Array.isArray(ab.families)) {
    bad(`shape: kind ${JSON.stringify(ab?.kind ?? null)}, v ${JSON.stringify(ab?.v ?? null)}`);
  }
  if (ab.record_sha256 !== recordSha256) bad(`record-mismatch: it names record ${JSON.stringify(ab.record_sha256 ?? null)}, and --record is ${recordSha256}`);
  if (ab.store_id !== storeId) bad(`store-mismatch: it names store ${JSON.stringify(ab.store_id ?? null)}, and --store holds ${storeId}`);
  const states = new Map();
  for (const f of ab.families) {
    if (f === null || typeof f !== 'object' || typeof f.ccrc_id !== 'string' || typeof f.generation !== 'string' || !AB_STATES.includes(f.state)) {
      bad(`shape: family ${JSON.stringify(f ?? null)}`);
    }
    const key = familyKey(storeId, f.ccrc_id, f.generation);
    if (states.has(key)) bad(`shape: family ${key} is listed twice`);
    states.set(key, { arm: f.arm, state: f.state });
  }
  const want = assignment.map((a) => `${familyKey(a.store_id, a.ccrc_id, a.generation)} ${a.arm}`).sort();
  const got = [...states].map(([k, v]) => `${k} ${v.arm}`).sort();
  if (want.join('\n') !== got.join('\n')) bad(`families-mismatch: it lists ${got.length} families of this store, and the record assigns ${want.length} (each at its arm)`);
  return new Map([...states].map(([k, v]) => [k, v.state]));
}

/** W2-D88's run checks, in one order (U7), each refused before any window is built: the run is after window end (the
 *  window is half-open, so a run at end_ms exactly is after it); the record is under the signed v1 definitions; --store is
 *  one of the record's nodes and the measure report is this store's; then this node's verify output (abStatesOf); and,
 *  after its own checks, its presence record has seen the newest recall-off write (V2, W2-D84). Answers this node's
 *  assignment and each family's verify state. */
export function checkCountInputs({ record, recordSha256, report, ab, rs, nowMs }) {
  const end = record.window?.end_ms;
  if (!Number.isSafeInteger(end)) refuse('record-invalid', `window ${JSON.stringify(record.window ?? null)} carries no end_ms`);
  if (!(nowMs >= end)) refuse('input-invalid', `window-open: now ${nowMs} is before window.end_ms ${end}: the counters run after window end (W2-D88)`);
  if (record.counters_def?.id !== 'v1' || record.counters_def?.sha256 !== COUNTERS_DEF_V1_SHA256) {
    refuse('record-invalid', `counters_def ${JSON.stringify(record.counters_def ?? null)} is not v1 ${COUNTERS_DEF_V1_SHA256}`);
  }
  if (!record.nodes.some((n) => n.store_id === rs.storeId)) refuse('input-invalid', `store ${rs.storeId} is not one of the record's nodes`);
  if (report?.store_id !== rs.storeId) {
    refuse('input-invalid', `measure-store-mismatch: the measure names store ${JSON.stringify(report?.store_id ?? null)}, and --store holds ${rs.storeId}`);
  }
  // This node's families only: the store answers for no other node's (U2: one node per run).
  const assignment = record.assignment.filter((a) => a.store_id === rs.storeId);
  const abStates = abStatesOf(ab, recordSha256, rs.storeId, assignment);
  // V2 (W2-D84): verify reports whether status's recall_off.seen_ms is later than the newest write. Until it is, a control
  // file written since the sweep last looked is unconfirmed, so its family's state cannot be read as realised. The driver's
  // verdict is read, never recomputed, and only true passes.
  if (ab.seen_after_write !== true) {
    refuse('input-invalid', `verify-ab-presence-stale: seen_after_write ${JSON.stringify(ab.seen_after_write ?? null)}, seen_ms ${JSON.stringify(ab.seen_ms ?? null)}, `
      + `newest_write ${JSON.stringify(ab.newest_write ?? null)}: the presence record has not been seen after the newest recall-off write, or that write is `
      + 'unmeasured, so a control file written since is unconfirmed; re-run verify --section ab once the newest write measures and status\'s '
      + 'recall_off.seen_ms is later than it (W2-D84)');
  }
  return { assignment, abStates };
}

/**
 * One node's counter report (W2-D86, W2-D87, W2-D88), from values already loaded: part 2 and its sha, the input shas,
 * this node's measure-history.py report and verify output, the open store, the measures, the read instant, the part 2
 * loader's stamps and whether --allow-code-change was given (Q23, U6). Refused, in this order: checkCountInputs' run
 * checks; assembleReports' refusals over this node's assignment (gateRefusal); a presence list that is absent or off its
 * grammar. Measures that are not COUNTER_NAMES' specs, or an answer off the Measure shape, are a defect (TypeError).
 * Rows: one per boundary of every found family the report lists, in its order, measured windows and unmeasured ones
 * alike, a dropped family's flagged. Strata: stratify's.
 */
export function countersReport({ record, recordSha256, inputs, report, ab, rs, measures, nowMs, stamps = [], allowCodeChange = false }) {
  checkMeasures(measures);
  const { assignment, abStates } = checkCountInputs({ record, recordSha256, report, ab, rs, nowMs });
  let asm;
  try {
    asm = assembleReports([report], { ...record, assignment }, { allowCodeChange });
  } catch (e) {
    if (e instanceof TypeError) refuse('input-invalid', `measure shape: ${e.message}`);
    throw e;
  }
  if (!asm.ok) gateRefusal(asm.reason, asm.detail);
  const { changed, gaps } = changedOf(report, record.window, assignment);
  const changedKeys = new Set(changed);
  const arms = new Map(assignment.map((a) => [familyKey(a.store_id, a.ccrc_id, a.generation), a.arm]));
  const rows = [];
  for (const f of report.w2.families) {
    if (f.found !== true) continue;   // excluded.not_found: assembleReports reported it, and it has no boundary
    const key = familyKey(rs.storeId, f.ccrc_id, f.generation);
    const family = Object.freeze({ key, store_id: rs.storeId, ccrc_id: f.ccrc_id, generation: f.generation, arm: arms.get(key) });
    buildWindows(f).forEach((w, i) => {
      const ctx = windowCtx({ rs, family, boundary: f.boundaries[i], window: w, calls: f.calls, nowMs });
      rows.push(windowRow({ ctx, changed: changedKeys.has(key), abState: abStates.get(key), measures }));
    });
  }
  const keys = assignment.map((a) => familyKey(a.store_id, a.ccrc_id, a.generation));
  const unrealised = Object.fromEntries(AB_STATES.filter((s) => s !== AB_OK).map((s) => [s, keys.filter((k) => abStates.get(k) === s).sort()]));
  return {
    kind: COUNTERS_KIND, v: 1, counters_def: { id: 'v1', sha256: COUNTERS_DEF_V1_SHA256 }, k: K, k_unit: K_UNIT,
    record_sha256: recordSha256, script_sha256: scriptSha256(), read_ms: nowMs,
    code_changed: stamps.includes('code-changed') || asm.code_changed,
    store_id: rs.storeId, record_nodes: record.nodes.map((n) => n.store_id).sort(), user_version: rs.version, inputs,
    window: { start_ms: record.window.start_ms, end_ms: record.window.end_ms },
    sources: { frame: FRAME_SOURCES, counters: Object.fromEntries(COUNTER_NAMES.map((n) => [n, measures[n].source])) },
    excluded: asm.excluded, dropped: { changed, unrealised }, recall_off_gaps: gaps,
    windows: rows, ...stratify(rows, measures),
  };
}

/** The arm comparison (W2-D86, U8): for each arm a tally per producer and one pooled, over rows neither changed nor
 *  unrealised; and each dropped kind tallied apart in the same shape, by arm and then by producer (V3), so a dropped
 *  family is read under its own arm only. */
export function stratify(rows, measures) {
  const byProducer = (keep) => Object.fromEntries([...BACKENDS, ALL_PRODUCERS].map((p) => [p,
    tallyOf(rows.filter((r) => keep(r) && (p === ALL_PRODUCERS || r.producer === p)), measures)]));
  const perArm = (keep) => Object.fromEntries(ASSIGNMENT_ARMS.map((arm) => [arm, byProducer((r) => keep(r) && r.arm === arm)]));
  return {
    strata: perArm((r) => !r.changed && !r.unrealised),
    dropped_strata: { changed: perArm((r) => r.changed), unrealised: perArm((r) => r.unrealised) },
  };
}

/** One stratum: counts of rows, sums over measured windows only (null when none, never 0), and per counter its measured
 *  and unmeasured counts, the unmeasured by word, and its fold over the measured values (null when none). */
function tallyOf(rows, measures) {
  const measuredRows = rows.filter((r) => r.state === 'measured');
  const sum = (k) => (measuredRows.length === 0 ? null : measuredRows.reduce((s, r) => s + r[k], 0));
  return {
    windows: rows.length, measured_windows: measuredRows.length, unmeasured_windows: rows.length - measuredRows.length,
    turns: sum('turns'), recall_calls: sum('recall_calls'),
    counters: Object.fromEntries(COUNTER_NAMES.map((n) => {
      const answers = rows.map((r) => r.measures[n]);
      const values = answers.filter((a) => a.state === 'measured').map((a) => a.value);
      const by = {};
      for (const a of answers) if (a.state === 'unmeasured') by[a.why] = (by[a.why] ?? 0) + 1;
      return [n, {
        measured: values.length, unmeasured: answers.length - values.length,
        unmeasured_by: Object.fromEntries(Object.keys(by).sort().map((w) => [w, by[w]])),
        summary: values.length === 0 ? null : measures[n].fold(values),
      }];
    })),
  };
}

/** This file's own sha256 (W2-D88): gate_code does not hash the counter, so every report names the bytes that ran. */
export function scriptSha256() {
  return sha256Hex(readFileSync(fileURLToPath(import.meta.url)));
}

// ── the store (W2-D51) ──────────────────────────────────────────────────────────────────────────────────────────────
/** A failed open or first read as the driver's word, word for word with its openReplayStore (a parity case holds the two
 *  equal): a StoreError by its word alone, SQLite's own error as store-read-failed; anything else is a defect.
 *  @returns {never} */
function refuseStore(e) {
  if (e instanceof DriverRefusal) throw e;
  if (e instanceof StoreError) refuse('store-unreadable', e.word);
  if (e !== null && typeof e === 'object' && /** @type {{ code?: unknown }} */ (e).code === 'ERR_SQLITE_ERROR') {
    refuse('store-unreadable', `store-read-failed: ${/** @type {Error} */ (e).message}`);
  }
  throw e;
}

/** --store, opened read-only through store.mjs's openReader (W2-D51), with its own store id, its user_version and
 *  SCHEMA_ADDED, so {db, version, schema} is the rc recall.mjs's expandEntryBody reads.
 *  @param {string} dbPath  @returns {CounterStore} */
export function openCounterStore(dbPath) {
  if (typeof dbPath !== 'string' || !path.isAbsolute(dbPath)) refuse('args-invalid', '--store names no absolute path');
  let db;
  try {
    db = openReader(dbPath);
  } catch (e) {
    refuseStore(e);
  }
  try {
    const row = db.prepare("SELECT v FROM meta WHERE k = 'store_id'").get();
    if (row === undefined) refuse('store-unreadable', 'store-id-absent');
    if (!UUID_RE.test(String(row.v))) refuse('store-unreadable', 'store-id-unreadable');
    return { db, storeId: String(row.v), version: userVersion(db), schema: SCHEMA_ADDED, close: () => db.close() };
  } catch (e) {
    try { db.close(); } catch { /* the first throw is the signal */ }
    refuseStore(e);
  }
}

// ── the commands (W2-D53, W2-D24, W2-D88; Q23) ──────────────────────────────────────────────────────────────────────
/** Every flag the counter knows and its kind: the driver's parseArgs reads them with these specs, never its own. */
export const COUNTER_FLAG_SPECS = Object.freeze({
  record: 'string', 'record-sha256': 'string', part1: 'string', 'part1-sha256': 'string', frozen: 'string', 'frozen-sha256': 'string',
  supersedes: 'string', 'supersedes-sha256': 'string', measure: 'string', 'measure-sha256': 'string',
  'verify-ab': 'string', 'verify-ab-sha256': 'string', store: 'string', out: 'string', 'allow-code-change': 'bool',
});
/** Each subcommand's flags, required and optional, and its entry. A flag outside both lists is args-invalid. */
export const COUNTER_FORMS = Object.freeze({
  count: Object.freeze({
    required: Object.freeze(['record', 'record-sha256', 'part1', 'part1-sha256', 'frozen', 'frozen-sha256', 'measure', 'measure-sha256',
      'verify-ab', 'verify-ab-sha256', 'store', 'out']),
    optional: Object.freeze(['supersedes', 'supersedes-sha256', 'allow-code-change']),
    run: (flags, deps) => countCommand(flags, deps),
  }),
});
export const COUNTER_SUBCOMMANDS = Object.freeze(Object.keys(COUNTER_FORMS));

function checkFormFlags(sub, flags) {
  const form = COUNTER_FORMS[sub];
  for (const k of form.required) if (flags[k] === undefined) refuse('args-invalid', `${k}-required`);
  for (const k of Object.keys(flags)) if (!form.required.includes(k) && !form.optional.includes(k)) refuse('args-invalid', `--${k} is not a ${sub} flag`);
}

/** A report goes under a FRESH --out, one that does not exist yet: nothing here resumes. An existing path, or one that
 *  cannot be measured, is refused before any input is read; writeReport's prepareOut makes it, 0700 with the driver's
 *  marker (W2-D53). */
function refuseUnlessFresh(out) {
  if (typeof out !== 'string' || !path.isAbsolute(out)) refuse('out-refused', 'relative');
  try {
    lstatSync(path.resolve(out));
  } catch (e) {
    if (/** @type {{ code?: unknown }} */ (e)?.code === 'ENOENT') return;
    refuse('out-refused', `unmeasured ${String(/** @type {{ code?: unknown }} */ (e)?.code ?? 'unknown')}`);
  }
  refuse('out-refused', 'exists: a counter report goes under a fresh --out');
}

/** --out made (prepareOut), `file` written once, 0600, as the report's canonical JSON and one newline; stderr carries
 *  `sha256 <hex>` of the bytes written, stdout stays empty. Called after every refusal a run can make. */
function writeReport(out, file, report) {
  const dir = prepareOut(out);
  const text = `${canonicalJson(report)}\n`;
  try {
    writeFileSync(path.join(dir, file), text, { mode: 0o600, flag: 'wx' });
  } catch (e) {
    refuse('out-refused', `${file} unwritable ${String(/** @type {{ code?: unknown }} */ (e)?.code ?? 'unknown')}`);
  }
  process.stderr.write(`sha256 ${sha256Hex(text)}\n`);
  return EXIT.OK;
}

/** count's part 2 loader and clock: the driver's loadFinalRecord (W2-D25, W2-D24, Q23), the one part 2 loader. Tests
 *  pass their own. */
const COUNT_DEPS = Object.freeze({ loadFinal: loadFinalRecord, now: () => Date.now() });

/** count: the flags; a fresh --out; part 2 through the part 2 loader at the read instant (its chain, W2-D24's re-check
 *  first, --allow-code-change taken after window start only and answered as a stamp); this node's measure and verify
 *  outputs, each sha-checked before it is parsed; the store, read-only; the report built in memory; and only then --out,
 *  with counters.json written once. Every refusal comes before --out exists. */
export function countCommand(flags, deps = COUNT_DEPS) {
  checkFormFlags('count', flags);
  if ((flags.supersedes === undefined) !== (flags['supersedes-sha256'] === undefined)) refuse('args-invalid', '--supersedes and --supersedes-sha256 go together');
  refuseUnlessFresh(flags.out);
  const nowMs = deps.now();
  const final = deps.loadFinal(flags, { nowMs });
  const measure = loadInput('measure', flags.measure, flags['measure-sha256'], undefined, MEASURE_CAP);
  const ab = loadInput('verify-ab', flags['verify-ab'], flags['verify-ab-sha256']);
  const rs = openCounterStore(flags.store);
  let report;
  try {
    report = countersReport({
      record: final.record, recordSha256: final.sha256, report: measure.value, ab: ab.value, rs, measures: COUNTER_MEASURES, nowMs,
      stamps: final.stamps, allowCodeChange: flags['allow-code-change'] === true,
      inputs: { part1_sha256: flags['part1-sha256'], frozen_sha256: final.frozen.sha256, supersedes_sha256: flags['supersedes-sha256'] ?? null,
        measure_sha256: measure.sha256, verify_ab_sha256: ab.sha256 },
    });
  } finally {
    rs.close();
  }
  return writeReport(flags.out, COUNTERS_FILE, report);
}

// ── W2-6 Task 2: the five spec counters (W2-D87, W2-D86, W2-D15; spec §10.2's live A/B counters, §6.2) ─────────────
// Report-only: nothing here feeds decideGate. Each spec is Task 1's shape: a measure of one window (Task 1's WindowCtx)
// and a fold of one stratum's measured values, never handed none. Each reads its own named source through the run's one
// read handle (ctx.rs, store.mjs openReader); the node-wide `counters` table is never read. No blob is decoded here: an
// entry's body is recall.mjs's expandEntryBody, W2-1's export (W2-D86). A value that could not be measured is
// unmeasured with a COUNTER_UNMEASURED word, never a 0.
//   compliance        `nodes`: the status of the depth-0 leaf whose boundary opens the window, as stored, folded over lib's
//                     PARSE_STATUS with the ok plus degraded share. Expected: not-requested throughout (W3's baseline, and
//                     a check that nothing was steered).
//   echo_hits         `entries` of the window copy (ctx.copy, the gate's windowCopyOf), after the boundary and before the
//                     next main boundary, whose stored provenance is recall-echo (lib provenanceOf's structural rule, as
//                     ingest applied it under PROV_VERSION) and whose first tool_result is not an error, inside the window
//                     by the gate's own rule (windowOf). Beside the window's recall_calls count; the gap between the two is
//                     reported, never repaired.
//   lag               `ticks`: the lag_ms of the newest row at or before the boundary's ts_ms with a measured lag.
//   card_served,      per boundary, one verdict projected twice: lib's decideCardDelivery over cardIdsIn of the
//   card_id_mismatch  attachments in the first CARD_MEASURE_ROWS rows after the boundary in its holding copy (derive.mjs
//                     holdingCopyOf, lib's pickHoldingCopy), with cardWindowComplete: the functions card.mjs's measure
//                     calls. The glue around them (the rows read, `live`, the attachment size bound, the wait) is card.mjs's
//                     deliveryOf, module-private, spelled a second time here (D-6562).

const COUNTER_STMTS = new WeakMap();

/** The counters' statements on one read handle, prepared once per handle. Every one is a SELECT. */
function counterStmts(db) {
  let s = COUNTER_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    boundary: db.prepare(`SELECT b.entry_id AS entry_id, b.transcript_pk AS transcript_pk
      FROM entries e JOIN boundaries b ON b.entry_id = e.entry_id WHERE e.uuid = ?`),
    leaves: db.prepare('SELECT node_id, status, created_ms FROM nodes WHERE boundary_entry_id = ? AND depth = 0 ORDER BY node_id'),
    tick: db.prepare(`SELECT tick_id, ts_ms, lag_ms FROM ticks WHERE ts_ms <= ? AND lag_ms IS NOT NULL
      ORDER BY ts_ms DESC, tick_id DESC LIMIT 1`),
    echoRows: db.prepare(`SELECT m.line AS line, e.entry_id AS entry_id, e.blob_id AS blob_id, e.ts_ms AS ts_ms,
        e.prov_version AS prov_version
      FROM memberships m JOIN entries e ON e.entry_id = m.entry_id
      WHERE m.file_id = ? AND m.line > ? AND (? IS NULL OR m.line < ?)
        AND (e.provenance = 'recall-echo' OR (e.provenance = 'tool' AND e.prov_version <> ?))
      ORDER BY m.line`),
    lineOf: db.prepare('SELECT line FROM memberships WHERE file_id = ? AND entry_id = ?'),
    fileStatus: db.prepare('SELECT status FROM ingest_files WHERE file_id = ?'),
    cardRows: db.prepare(`SELECT e.entry_id AS entry_id, e.type AS type, e.blob_id AS blob_id, bl.raw_len AS raw_len,
        CASE WHEN b.entry_id IS NULL THEN 0 ELSE 1 END AS is_boundary
      FROM memberships m JOIN entries e ON e.entry_id = m.entry_id LEFT JOIN boundaries b ON b.entry_id = e.entry_id
      LEFT JOIN blobs bl ON bl.blob_id = e.blob_id
      WHERE m.file_id = ? AND m.line > ? ORDER BY m.line LIMIT ?`),
  };
  COUNTER_STMTS.set(db, s);
  return s;
}

/** The boundary with this uuid and the one depth-0 leaf that names it (the leaf derivation minted for it, the row
 *  card.mjs's measure reads). Unmeasured when the store holds no such boundary, when no leaf names it, or when two do.
 *  Task 3's re-discovery reads it too.  @param {CounterStore} rs  @param {string} boundaryUuid */
export function boundaryLeafOf(rs, boundaryUuid) {
  const s = counterStmts(rs.db);
  const b = s.boundary.get(boundaryUuid);
  if (b === undefined) return unmeasured('boundary-absent');
  const leaves = s.leaves.all(b.entry_id);
  if (leaves.length === 0) return unmeasured('leaf-absent');
  if (leaves.length > 1) return unmeasured('leaf-ambiguous');
  const [l] = leaves;
  return {
    state: 'leaf', entry_id: Number(b.entry_id), transcript_pk: Number(b.transcript_pk), node_id: String(l.node_id),
    status: String(l.status), created_ms: Number(l.created_ms),
  };
}

/** Compliance for one window: the status of the leaf whose boundary opens it, as stored, so a word outside
 *  PARSE_STATUS is reported, never folded into another (W2-D87).  @param {WindowCtx} ctx */
export function complianceAt(ctx) {
  const leaf = boundaryLeafOf(ctx.rs, ctx.boundary.boundary_uuid);
  return leaf.state === 'leaf' ? measured(leaf.status) : leaf;
}

/** Compliance over one stratum's measured statuses: lib's whole PARSE_STATUS distribution, a status outside it counted
 *  apart, and the ok plus degraded share as {num, den}. Nothing is divided out. */
export function foldCompliance(values) {
  const status = Object.fromEntries(PARSE_STATUS.map((w) => [w, 0]));
  let outOfVocabulary = 0;
  for (const v of nonEmpty('foldCompliance', values)) {
    if (Object.hasOwn(status, v)) status[v] += 1;
    else outOfVocabulary += 1;
  }
  return { status, out_of_vocabulary: outOfVocabulary, ok_degraded: { num: status.ok + status.degraded, den: values.length } };
}

/** Lag for one window: the newest ticks row at or before the boundary's ts_ms whose lag was measured (W2-D87). Two
 *  windows on one node near one instant share a reading (decisions §7).  @param {WindowCtx} ctx */
export function lagAt(ctx) {
  const t = counterStmts(ctx.rs.db).tick.get(ctx.boundary.ts_ms);
  return t === undefined ? unmeasured('no-measured-tick') : measured({ lag_ms: Number(t.lag_ms), tick_ts_ms: Number(t.ts_ms) });
}

/** Lag over one stratum: the measured lags, ascending. No statistic COUNTERS_DEF_V1 does not define is added here. */
export function foldLag(values) {
  return { lag_ms: nonEmpty('foldLag', values).map((v) => v.lag_ms).sort((a, b) => a - b) };
}

/** Is `ts` inside the window? The gate's windowOf, over one synthetic call at `ts`, counts it or not, so the rule
 *  (inclusive start, exclusive or inclusive end, W2-D14) is spelled once, in the gate.
 *  @param {WindowCtx} ctx  @param {number} ts */
function insideWindow(ctx, ts) {
  return windowOf(ctx.boundary, [[ts, 0, 'echo']]).calls === 1;
}

/** The first tool_result block of a stored user body: the block provenanceOf paired (lib toolResultIdsOf reads the
 *  blocks in this order). Null when the body holds none. */
function firstToolResult(body) {
  if (!Array.isArray(body)) return null;
  return body.find((b) => b !== null && typeof b === 'object' && b.type === 'tool_result') ?? null;
}

/** Echo hits for one window (W2-D87, U9, U10): the window copy's rows between the boundary and the next main boundary,
 *  each timed one placed in the window by the gate's rule. The store must hold the boundary at the line the report
 *  printed (boundary-moved otherwise). A row classified under another PROV_VERSION, stored as recall-echo or as tool, is
 *  `prov_stale`; of the current recall-echo rows, one with no ts is `untimed`; a body expandEntryBody cannot give, or one
 *  with no tool_result, is counted under its own word in `unreadable`; of the rest, an `is_error: true` first tool_result
 *  is an error and any other a hit. `gap` is the window's recall_calls minus its hits, reported, never repaired.
 *  @param {WindowCtx} ctx */
export function echoAt(ctx) {
  if (ctx.copy === null) return unmeasured('window-unmeasured');
  const s = counterStmts(ctx.rs.db);
  const b = s.boundary.get(ctx.boundary.boundary_uuid);
  if (b === undefined) return unmeasured('boundary-absent');
  // The rows are read by the lines measure-history.py printed: a moved line or a renumbered file would read another
  // window's rows, so the boundary must sit at its reported line of its reported file.
  const at = s.lineOf.get(ctx.copy.file_id, b.entry_id);
  if (at === undefined || Number(at.line) !== ctx.copy.boundary_line) return unmeasured('boundary-moved');
  const v = { hits: 0, errors: 0, untimed: 0, unreadable: {}, prov_stale: 0, recall_calls: ctx.window.calls, gap: 0 };
  const next = ctx.copy.next_boundary_line;
  for (const r of s.echoRows.all(ctx.copy.file_id, ctx.copy.boundary_line, next, next, PROV_VERSION)) {
    if (r.ts_ms !== null && !insideWindow(ctx, Number(r.ts_ms))) continue;
    // Stale whatever it was stored as: under another PROV_VERSION a stored tool row may be an echo (U9).
    if (Number(r.prov_version) !== PROV_VERSION) {
      v.prov_stale += 1;
      continue;
    }
    if (r.ts_ms === null) {
      v.untimed += 1;
      continue;
    }
    const k = expandEntryBody(ctx.rs, { entry_id: Number(r.entry_id), blob_id: Number(r.blob_id) });
    const block = k.state === 'body' ? firstToolResult(k.body) : null;
    const word = k.state !== 'body' ? k.state : block === null ? 'no-tool-result' : null;
    if (word !== null) {
      v.unreadable[word] = (v.unreadable[word] ?? 0) + 1;
      continue;
    }
    if (block.is_error === true) v.errors += 1;
    else v.hits += 1;
  }
  v.gap = v.recall_calls - v.hits;
  return measured(v);
}

/** Echo hits over one stratum: the measured windows' counts summed, `unreadable` merged word by word, and the gap of the
 *  sums (recall_calls - hits). */
export function foldEcho(values) {
  const t = { hits: 0, errors: 0, untimed: 0, unreadable: {}, prov_stale: 0, recall_calls: 0, gap: 0 };
  for (const v of nonEmpty('foldEcho', values)) {
    t.hits += v.hits;
    t.errors += v.errors;
    t.untimed += v.untimed;
    t.prov_stale += v.prov_stale;
    t.recall_calls += v.recall_calls;
    for (const [w, n] of Object.entries(v.unreadable)) t.unreadable[w] = (t.unreadable[w] ?? 0) + n;
  }
  t.gap = t.recall_calls - t.hits;
  return t;
}

/** Each row's card verdict, computed once: Task 1 hands every measure of one row the same frozen ctx. */
const CARD_VERDICTS = new WeakMap();

/** The card verdict for one boundary (W2-D87), projected by both card counters.  @param {WindowCtx} ctx */
export function cardAt(ctx) {
  let v = CARD_VERDICTS.get(ctx);
  if (v === undefined) {
    v = cardVerdictOf(ctx);
    CARD_VERDICTS.set(ctx, v);
  }
  return v;
}

/** lib's decideCardDelivery over cardIdsIn of the attachments in the first CARD_MEASURE_ROWS rows after the boundary in
 *  its holding copy, stopping at the next boundary, with lib's cardWindowComplete. An attachment whose stored raw_len
 *  passes CARD_ATTACHMENT_MAX_BYTES is skipped unread, as card.mjs skips it, and so is one expandEntryBody cannot give;
 *  each is counted in `attachments_unread`. A window still open at the read instant is card-wait; a boundary no copy
 *  holds is boundary-uncopied. The glue is card.mjs's deliveryOf, spelled a second time (D-6562).
 *  @param {WindowCtx} ctx */
function cardVerdictOf(ctx) {
  const leaf = boundaryLeafOf(ctx.rs, ctx.boundary.boundary_uuid);
  if (leaf.state !== 'leaf') return leaf;
  const holding = holdingCopyOf(ctx.rs.db, { entry_id: leaf.entry_id, transcript_pk: leaf.transcript_pk });
  if (holding === null) return unmeasured('boundary-uncopied');
  const s = counterStmts(ctx.rs.db);
  const fileId = Number(holding.file_id);
  const line = Number(s.lineOf.get(fileId, leaf.entry_id).line);
  const live = holding.source_key === '' && s.fileStatus.get(fileId)?.status === 'live';
  /** @type {string[]} */
  const ids = [];
  let rowsSeen = 0;
  let nextBoundary = false;
  let unread = 0;
  for (const r of s.cardRows.all(fileId, line, CARD_MEASURE_ROWS)) {
    if (r.is_boundary === 1) {
      nextBoundary = true;
      break;
    }
    rowsSeen += 1;
    if (r.type !== 'attachment') continue;
    if (r.raw_len === null || Number(r.raw_len) > CARD_ATTACHMENT_MAX_BYTES) {
      unread += 1;
      continue;
    }
    const k = expandEntryBody(ctx.rs, { entry_id: Number(r.entry_id), blob_id: Number(r.blob_id) });
    if (k.state !== 'body') {
      unread += 1;
      continue;
    }
    ids.push(...cardIdsIn(k.primary));
  }
  const eofAfter = eofAfterBoundary({ eofMs: holding.eof_ms === null ? null : Number(holding.eof_ms), boundaryTsMs: ctx.boundary.ts_ms });
  const windowComplete = cardWindowComplete({ live, rowsSeen, nextBoundary, eofAfter, waitedMs: ctx.nowMs - leaf.created_ms });
  const verdict = decideCardDelivery({ ids, leafId: leaf.node_id, windowComplete });
  if (verdict === 'wait') return unmeasured('card-wait');
  return measured({ verdict, attachments_unread: unread });
}

/** One card counter's fold: `n` counts its own verdict (card_served counts served, card_id_mismatch counts mismatch)
 *  over the verdict distribution both share.  @param {'served'|'mismatch'} verdict */
export function foldCardFor(verdict) {
  if (verdict !== 'served' && verdict !== 'mismatch') throw new TypeError(`history-counters: a card counter counts served or mismatch, not ${verdict}`);
  return (values) => {
    const verdicts = { served: 0, mismatch: 0, none: 0 };
    let unread = 0;
    for (const v of nonEmpty(`foldCardFor(${verdict})`, values)) {
      if (!Object.hasOwn(verdicts, v.verdict)) throw new TypeError(`history-counters: not a card verdict: ${v.verdict}`);
      verdicts[v.verdict] += 1;
      unread += v.attachments_unread;
    }
    return { n: verdicts[verdict], verdicts, attachments_unread: unread };
  };
}

/** The five spec counters, each Task 1's CounterSpec with its source named (W2-D87). */
export const COMPLIANCE = Object.freeze({
  source: 'nodes.status of the depth-0 leaf whose boundary opens the window (lib PARSE_STATUS), with the ok plus degraded share',
  measure: complianceAt, fold: foldCompliance,
});
export const ECHO_HITS = Object.freeze({
  source: 'entries.provenance recall-echo (lib provenanceOf, stored under PROV_VERSION) in the window copy, the first tool_result through recall.mjs expandEntryBody, beside the window\'s recall_calls',
  measure: echoAt, fold: foldEcho,
});
export const LAG = Object.freeze({
  source: 'ticks.lag_ms of the newest tick at or before the boundary with a measured lag',
  measure: lagAt, fold: foldLag,
});
const CARD_SOURCE = 'lib decideCardDelivery over cardIdsIn of the attachments in the first CARD_MEASURE_ROWS rows after the boundary in its holding copy (derive.mjs holdingCopyOf), with cardWindowComplete; the glue spelled again from card.mjs (D-6562)';
export const CARD_SERVED = Object.freeze({ source: CARD_SOURCE, measure: cardAt, fold: foldCardFor('served') });
export const CARD_ID_MISMATCH = Object.freeze({ source: CARD_SOURCE, measure: cardAt, fold: foldCardFor('mismatch') });

// ── the measures, composed (W2-D87): every counter's spec, in COUNTER_NAMES' order ──────────────────────────────────
/** The stand-in every counter is until its own task lands. @type {CounterSpec} */
const PENDING = Object.freeze({
  source: 'none yet: this counter\'s measure has not landed',
  measure: () => unmeasured('pending'),
  fold: () => { throw new Error('PENDING.fold: a pending counter measures nothing, so nothing is folded'); },
});

/** One CounterSpec per counter, keyed and ordered as COUNTER_NAMES (countersReport throws on anything else). Each
 *  counter's task replaces its own line and declares its spec above this block. */
export const COUNTER_MEASURES = Object.freeze({
  compliance: COMPLIANCE,
  echo_hits: ECHO_HITS,
  lag: LAG,
  card_served: CARD_SERVED,
  card_id_mismatch: CARD_ID_MISMATCH,
  rediscovery: PENDING,
});

/** The entry: the umask first (W2-D53), then the driver's grammar with this file's specs and subcommands. */
export function main(argv, deps = COUNT_DEPS) {
  try {
    process.umask(0o077);
    const { sub, flags } = parseArgs(argv, { specs: COUNTER_FLAG_SPECS, subs: COUNTER_SUBCOMMANDS });
    return COUNTER_FORMS[sub].run(flags, deps);
  } catch (e) {
    if (e instanceof DriverRefusal) {
      process.stderr.write(`${PREFIX}: ${e.word}: ${e.detail}\n`);
      return EXIT.REFUSED;
    }
    process.stderr.write(`${PREFIX}: internal error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    return EXIT.INTERNAL;
  }
}

// The entry guard stays the LAST block of this file. Importing the module (the tests do) runs nothing; the exit code is
// set, never forced, so stderr drains. main reads no environment.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
