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
import { BACKENDS, EXIT, SCHEMA_ADDED, UUID_RE, canonicalJson, sha256Hex } from '../ccd/history/lib.mjs';
import { StoreError, openReader, userVersion } from '../ccd/history/store.mjs';
import { ASSIGNMENT_ARMS, COUNTERS_DEF_V1, COUNTERS_DEF_V1_SHA256, K, K_UNIT, assembleReports, buildWindows, changedFamilies, familyKey, turnsOf, windowCopyOf } from './history-gate.mjs';
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
  compliance: PENDING,
  echo_hits: PENDING,
  lag: PENDING,
  card_served: PENDING,
  card_id_mismatch: PENDING,
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
