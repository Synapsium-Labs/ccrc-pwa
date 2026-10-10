// server/test/history-derive.test.ts: node derivation through REAL sweep ticks (spec 2026-10-05 §6.1 span rule
// and forks, §6.2 `nodes` and the producer, §7.4 items 1, 2, 6-10; W1-B2 plan Task 8, and Task 9 appends). Each
// describe builds one fixture HOME, plants sessions and transcripts in the measured row shapes
// (historyFixtures.ts's compactionSequence), spools the SessionStart line the hook would, and runs sweep.mjs as
// the shim would; the cases then read the store read-only. Linux only (O24): it spawns the sweep.
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  makeHistoryBox, runSweep, plantSession, plantTranscript, spoolLine, openStoreRO, counters, skipOnDarwin,
  type HistoryBox,
} from './historyHelpers.js';
import { compactionSequence, steeredBlock, userRow, type Row } from './historyFixtures.js';
import {
  leafId, historyPaths, NODE_PARSER_VERSION, GIST_MAX, NATIVE_GIST_MAX, TOPIC_CHARS, beltWidth, makePairIndex, secretPairs,
} from '../../ccd/history/lib.mjs';
import { createStore, openWriter, closeWriter, withTx, getStep, setStep } from '../../ccd/history/store.mjs';

skipOnDarwin();

const SLUG = '-home-u-worktrees-p-quiet-basin';
const GEN = '0189abcd-1234-4678-9abc-0000000000aa';
/** A day before now: every boundary's raw-leaf grace (lib RAW_LEAF_GRACE_MS) is long past whatever day the suite
 *  runs, so a file read to its end is final. */
const T0 = Date.now() - 86_400_000;
type Seq = ReturnType<typeof compactionSequence>;

/** One session: its registry rows, its transcript under `account`'s projects/, and the SessionStart(startup) line
 *  the hook spools. Its `reg` equals its sid, so the drain confirms the epoch on the line's own evidence. */
function plant(box: HistoryBox, id: string, uuid: string, rows: readonly Row[], account = 'claude'): void {
  plantSession(box, id, { uuid, generation: GEN, project: 'demo', workdir: '/home/u/worktrees/p/quiet-basin' });
  plantTranscript(box, account, SLUG, uuid, [...rows]);
  spoolLine(box, id, { v: 1, ev: 'SessionStart', id, sid: uuid, src: 'startup', reg: uuid, gen: GEN });
}

/** Scheduled passes, as the timer runs them. The first creates the store and renames the spool files; the next
 *  drains them (the epochs confirm) and derives; one more lets every boundary meet its readiness. */
function settle(box: HistoryBox, passes = 3): void {
  for (let i = 0; i < passes; i += 1) {
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
  }
}

function q<T>(box: HistoryBox, sql: string, ...args: (string | number)[]): T[] {
  const db = openStoreRO(box);
  try { return db.prepare(sql).all(...args) as T[]; } finally { db.close(); }
}

interface LeafRow {
  node_id: string; kind: string; status: string; gist: string | null; topics: string | null;
  summary_blob_id: number | null; span_start_uuid: string; boundary_uuid: string; ord: number;
}
const leavesOf = (box: HistoryBox, uuid: string): LeafRow[] => q<LeafRow>(box,
  `SELECT n.node_id, n.kind, n.status, n.gist, n.topics, n.summary_blob_id, n.span_start_uuid, e.uuid AS boundary_uuid, b.ord
   FROM nodes n JOIN boundaries b ON b.entry_id = n.boundary_entry_id JOIN entries e ON e.entry_id = b.entry_id
   JOIN transcripts t ON t.transcript_pk = n.transcript_pk
   WHERE t.cc_session_uuid = ? AND n.depth = 0 ORDER BY b.ord`, uuid);
const sourcesOf = (box: HistoryBox, nodeId: string): string[] => q<{ uuid: string }>(box,
  'SELECT e.uuid FROM node_sources ns JOIN entries e ON e.entry_id = ns.entry_id WHERE ns.node_id = ? ORDER BY ns.ord', nodeId)
  .map((r) => r.uuid);
const blobOf = (box: HistoryBox, uuid: string): number | null =>
  q<{ blob_id: number }>(box, 'SELECT blob_id FROM entries WHERE uuid = ?', uuid)[0]?.blob_id ?? null;
/** Leaf k's sources by construction (§6.1; Task 5's DM5). */
const expectedSources = (s: Seq, k: number): string[] => [
  ...(k === 0 ? [] : [...s.keptUuids[k - 1]!, ...s.afterUuids[k - 1]!]),
  ...s.workUuids[k]!, ...s.unkeptUuids[k]!,
];
const firstUuid = (s: Seq): string => String(s.rows[0]!['uuid']);
const withDirection = (s: Seq, direction: 'from' | 'up_to'): Row[] =>
  s.rows.map((r) => (r['uuid'] === s.summaryUuids[0] ? { ...r, summarizeMetadata: { direction } } : r));

const UNCLOSED = (): string => [
  '<analysis>', 'Reviewing the unclosed fixture.', '</analysis>',
  '<summary>', '1. Primary Request and Intent:', '   The unclosed fixture.',
  '8. Current Work:', '   Unclosed current work runs to the end of the row.',
  '9. Optional Next Step:', '   Unclosed next step.',
].join('\n');
/** The GPT shape (§7.4 item 8, RG12): a surviving second <analysis>, then two unclosed <summary> opens, each with
 *  both closing headings. */
const GPT_SHAPED = (): string => [
  '<analysis>', 'A first analysis, closed.', '</analysis>',
  '<analysis>', '8. Current Work:', '   ANALYSIS current work inside the surviving analysis.',
  '<summary>', '8. Current Work:', '   FIRST current work.', '9. Optional Next Step:', '   FIRST next step.',
  '<summary>', '8. Current Work:', '   SECOND current work.', '9. Optional Next Step:', '   SECOND next step.',
].join('\n');
/** Both closing pairs in one summary, so only the direction can choose (§7.4 item 8). */
const BOTH_PAIRS = (): string => [
  '<summary>', '1. Primary Request and Intent:', '   A summary holding both closing pairs.',
  '8. Current Work:', '   CURRENT-PAIR text, which a from summary ends with.',
  '9. Optional Next Step:', '   CURRENT-PAIR next step.',
  '10. Work Completed:', '   COMPLETED-PAIR text, which an up_to summary ends with.',
  '11. Context for Continuing Work:', '   COMPLETED-PAIR context.',
  '</summary>',
].join('\n');
/** A summary QUOTING a block, at a boundary with no steer receipt (§7.4 item 2). */
const QUOTED = (): string => [
  '<summary>', '1. Primary Request and Intent:', '   Testing the block parser on a fixture.',
  '8. Current Work:', '   Quoting a fixture block while testing the parser:',
  '<ccrc-leaf id="L0123456789abcdef0123">',
  'gist: A quoted fixture gist that is long enough to pass the forty character floor of the parser.',
  'Expand for details about: quoted, fixture',
  'refs: server/test/history-parser.test.ts',
  '</ccrc-leaf>',
  '9. Optional Next Step:', '   Keep the quoted block as data.',
  '</summary>',
].join('\n');

describe('native leaves through real ticks: summary row, readiness, gist and counters (PX1, PX7, PX25, DM25; spec 7.4)', () => {
  const U = {
    auto: '0189abcd-1234-4678-9abc-0000000000a1', manual: '0189abcd-1234-4678-9abc-0000000000a2',
    from: '0189abcd-1234-4678-9abc-0000000000a3', raw: '0189abcd-1234-4678-9abc-0000000000a4',
    unclosed: '0189abcd-1234-4678-9abc-0000000000a5', gpt: '0189abcd-1234-4678-9abc-0000000000a6',
    upto: '0189abcd-1234-4678-9abc-0000000000a7', fromDir: '0189abcd-1234-4678-9abc-0000000000a8',
    quoted: '0189abcd-1234-4678-9abc-0000000000a9',
  };
  let box: HistoryBox;
  let auto: Seq; let manual: Seq; let from: Seq; let raw: Seq;
  beforeAll(() => {
    box = makeHistoryBox('ccrc-hist-derive-');
    auto = compactionSequence({ n: 2, trigger: 'auto', seed: 0x81, sessionId: U.auto, startMs: T0 });
    manual = compactionSequence({ n: 2, trigger: 'manual', unkeptBeforeBoundary: 3, seed: 0x82, sessionId: U.manual, startMs: T0 });
    from = compactionSequence({ n: 1, trigger: 'manual', anchorIsBoundary: true, seed: 0x83, sessionId: U.from, startMs: T0 });
    raw = compactionSequence({ n: 1, trigger: 'manual', dropSummary: true, seed: 0x84, sessionId: U.raw, startMs: T0 });
    const unclosed = compactionSequence({ n: 1, trigger: 'manual', summaryText: UNCLOSED, seed: 0x85, sessionId: U.unclosed, startMs: T0 });
    const gpt = compactionSequence({ n: 1, trigger: 'auto', model: 'gpt-fixture-5', summaryText: GPT_SHAPED, seed: 0x86, sessionId: U.gpt, startMs: T0 });
    const upto = compactionSequence({ n: 1, trigger: 'manual', summaryText: BOTH_PAIRS, seed: 0x87, sessionId: U.upto, startMs: T0 });
    const fromDir = compactionSequence({ n: 1, trigger: 'manual', summaryText: BOTH_PAIRS, seed: 0x88, sessionId: U.fromDir, startMs: T0 });
    const quoted = compactionSequence({ n: 1, trigger: 'manual', summaryText: QUOTED, seed: 0x89, sessionId: U.quoted, startMs: T0 });
    plant(box, 'claude-auto', U.auto, auto.rows);
    plant(box, 'claude-manual', U.manual, manual.rows);
    plant(box, 'claude-from', U.from, from.rows);
    plant(box, 'claude-raw', U.raw, raw.rows);
    plant(box, 'claude-unclosed', U.unclosed, unclosed.rows);
    plant(box, 'claude-gpt', U.gpt, gpt.rows);
    plant(box, 'claude-upto', U.upto, withDirection(upto, 'up_to'));
    plant(box, 'claude-fromdir', U.fromDir, withDirection(fromDir, 'from'));
    plant(box, 'claude-quoted', U.quoted, quoted.rows);
    settle(box);
  }, 240_000);

  it('PX1 auto: the summary is the anchor row 4 rows after each boundary; each leaf is native, with exact sources and its pre-minted id', () => {
    const leaves = leavesOf(box, U.auto);
    expect(leaves.map((l) => l.boundary_uuid)).toEqual(auto.boundaryUuids);
    leaves.forEach((l, k) => {
      expect({ kind: l.kind, status: l.status }, `leaf ${k}`).toEqual({ kind: 'native_leaf', status: 'not-requested' });
      expect(l.summary_blob_id, `leaf ${k}`).toBe(blobOf(box, auto.summaryUuids[k]!));
      expect(l.gist ?? '', `leaf ${k}`).toContain(`Working on segment ${k} of the fixture.`);
      expect(sourcesOf(box, l.node_id), `leaf ${k}`).toEqual(expectedSources(auto, k));
      expect(l.node_id, `leaf ${k}`).toBe(leafId('claude-auto', U.auto, k === 0 ? firstUuid(auto) : auto.headUuids[k - 1]!));
    });
  });

  it('PX1 manual: the summary is the row right after each boundary; unkept rows stay with their compaction', () => {
    const leaves = leavesOf(box, U.manual);
    expect(leaves).toHaveLength(2);
    leaves.forEach((l, k) => {
      expect(l.summary_blob_id, `leaf ${k}`).toBe(blobOf(box, manual.summaryUuids[k]!));
      expect(sourcesOf(box, l.node_id), `leaf ${k}`).toEqual(expectedSources(manual, k));
    });
  });

  it('PX1 partial from: an anchor naming the boundary itself reads the next isCompactSummary row, counted, never the boundary', () => {
    const [l] = leavesOf(box, U.from);
    expect(l!.kind).toBe('native_leaf');
    expect(l!.summary_blob_id).toBe(blobOf(box, from.summaryUuids[0]!));
    expect(l!.summary_blob_id).not.toBe(blobOf(box, from.boundaryUuids[0]!));
    expect(counters(box)['anchor_is_boundary']).toBe(1);
  });

  it('DM25: a boundary whose anchor names no row is a raw leaf, not-requested, counted summary_missing, its span still navigable', () => {
    const [l] = leavesOf(box, U.raw);
    // §7.4 item 2: with no steer receipt the status is not-requested. `absent` is a block missing from a span that
    // HAD a receipt (item 5), and the compliance counter would read it as a model's miss.
    expect({ kind: l!.kind, status: l!.status, gist: l!.gist, summary: l!.summary_blob_id })
      .toEqual({ kind: 'raw_leaf', status: 'not-requested', gist: null, summary: null });
    expect(sourcesOf(box, l!.node_id)).toEqual(expectedSources(raw, 0));
    expect(counters(box)['summary_missing']).toBe(1);
  });

  it('compliance by status and by reason, by producer (spec 7.4 item 10): every W1 leaf is not-requested, reason no-receipt; none counts absent', () => {
    const c = counters(box);
    expect(c['leaf_status:not-requested:anthropic']).toBe(10);
    expect(c['leaf_status:not-requested:other']).toBe(1);
    expect(c['leaf_reason:no-receipt:anthropic']).toBe(10);
    expect(c['leaf_reason:no-receipt:other']).toBe(1);
    expect(Object.keys(c).filter((k) => k.startsWith('leaf_status:absent'))).toEqual([]);
  });

  it('PX7: a summary with no </summary> is scanned whole and counted summary_unclosed under its producer', () => {
    const [l] = leavesOf(box, U.unclosed);
    expect(l!.gist ?? '').toContain('Unclosed current work runs to the end of the row.');
    expect(counters(box)['summary_unclosed:anthropic']).toBe(1);
  });

  it('PX25: a GPT-shaped summary gives the gist from the last occurrence after the last <summary> open, counted under other', () => {
    const [l] = leavesOf(box, U.gpt);
    expect(l!.gist ?? '').toContain('SECOND current work');
    expect(l!.gist ?? '').not.toContain('FIRST current work');
    expect(l!.gist ?? '').not.toContain('ANALYSIS current work');
    const c = counters(box);
    expect(c['summary_unclosed:other']).toBe(1);
    expect(c['leaf_status:not-requested:other']).toBe(1);
  });

  it("the native pair follows the summary row's summarizeMetadata.direction, read back from its source line", () => {
    const [u] = leavesOf(box, U.upto);
    const [f] = leavesOf(box, U.fromDir);
    expect(u!.gist ?? '').toContain('COMPLETED-PAIR');
    expect(u!.gist ?? '').not.toContain('CURRENT-PAIR');
    expect(f!.gist ?? '').toContain('CURRENT-PAIR');
    expect(f!.gist ?? '').not.toContain('COMPLETED-PAIR');
  });

  it('with no steer receipt a quoted <ccrc-leaf> block is never parsed: the leaf is native and not-requested', () => {
    const [l] = leavesOf(box, U.quoted);
    expect({ kind: l!.kind, status: l!.status }).toEqual({ kind: 'native_leaf', status: 'not-requested' });
    expect(l!.gist ?? '').toContain('Keep the quoted block as data.');
  });

  it('review focus 1: a stored summary in neither section format is a native leaf, not-requested, with no gist; never raw, never a throw', () => {
    const one = makeHistoryBox('ccrc-hist-plain-');
    const PLAIN = 'f1a10000-1111-4111-8111-111111111111';
    const seq = compactionSequence({ n: 1, trigger: 'manual', seed: 0x8a, sessionId: PLAIN, startMs: T0,
      summaryText: () => 'A plain-prose summary of the work so far, with no numbered sections and no summary tags.' });
    plant(one, 'claude-plain', PLAIN, seq.rows);
    settle(one);
    const [l] = leavesOf(one, PLAIN);
    expect({ kind: l!.kind, status: l!.status, gist: l!.gist }).toEqual({ kind: 'native_leaf', status: 'not-requested', gist: null });
    expect(l!.summary_blob_id).toBe(blobOf(one, seq.summaryUuids[0]!));
    expect(counters(one)['parser_crash'] ?? 0).toBe(0);
  }, 120_000);

  it('a summary-less boundary with no time of its own takes the newest stamped row before it, so it still becomes a raw leaf (raw-leaf grace)', () => {
    const one = makeHistoryBox('ccrc-hist-nots-');
    const NOTS = 'f1a10000-2222-4222-8222-222222222222';
    const seq = compactionSequence({ n: 1, trigger: 'manual', dropSummary: true, seed: 0x8b, sessionId: NOTS, startMs: T0 });
    const rows = seq.rows.map((r) => {
      if (r['uuid'] !== seq.boundaryUuids[0]) return r;
      const bare: Row = { ...r };
      delete bare['timestamp'];
      return bare;
    });
    expect(rows.find((r) => r['uuid'] === seq.boundaryUuids[0])!['timestamp'], 'CONTROL: the boundary row carries no time').toBeUndefined();
    plant(one, 'claude-nots', NOTS, rows);
    settle(one);
    const leaves = leavesOf(one, NOTS);
    expect(leaves.map((l) => ({ kind: l.kind, status: l.status }))).toEqual([{ kind: 'raw_leaf', status: 'not-requested' }]);
  }, 120_000);

  it("topics are the list items new since the previous summary's sections 2-3, stored as JSON text", () => {
    const [l0, l1] = leavesOf(box, U.auto);
    const t0 = JSON.parse(l0!.topics ?? 'null') as string[];
    const t1 = JSON.parse(l1!.topics ?? 'null') as string[];
    expect(t0.some((t) => t.includes('fixture-concept-0'))).toBe(true);
    expect(t1.some((t) => t.includes('fixture-concept-1'))).toBe(true);
    expect(t1.some((t) => t.includes('fixture-concept-0'))).toBe(false);
  });

  it("refs are the Read paths mined from the span's tool_use rows, origin tool_use", () => {
    const [l0] = leavesOf(box, U.auto);
    const refs = q<{ kind: string; value: string; origin: string }>(box, 'SELECT kind, value, origin FROM node_refs WHERE node_id = ? ORDER BY value', l0!.node_id);
    expect(refs.map((r) => r.value)).toContain('/home/u/worktrees/p/quiet-basin/src/segment-0-1.ts');
    for (const r of refs) expect(r.origin).toBe('tool_use');
  });

  it('every leaf has its nodes_fts row once FTS is ready, and the leaves cursor stands at the last boundary', () => {
    const n = q<{ n: number }>(box, 'SELECT count(*) AS n FROM nodes')[0]!.n;
    const f = q<{ f: number }>(box, 'SELECT count(*) AS f FROM nodes_fts')[0]!.f;
    expect(n).toBe(11);
    expect(f).toBe(n);
    const e = q<{ e: number }>(box, 'SELECT max(entry_id) AS e FROM boundaries')[0]!.e;
    const [step] = q<{ cursor: string }>(box, "SELECT cursor FROM derivation_state WHERE step = 'leaves' AND version = ?", NODE_PARSER_VERSION);
    expect(Number(step!.cursor)).toBe(e);
  });
});

describe('forked copies: positions come from the copy that holds each boundary (DM36; spec 6.1)', () => {
  const ID = 'claude-fork';
  const U = '0189abcd-1234-4678-9abc-0000000000f1';
  let box: HistoryBox;
  let pre: Seq; let sufA: Seq; let sufB: Seq;
  beforeAll(() => {
    box = makeHistoryBox('ccrc-hist-dm36-');
    pre = compactionSequence({ n: 1, trigger: 'manual', unkeptBeforeBoundary: 2, seed: 0x91, sessionId: U, startMs: T0 });
    sufA = compactionSequence({ n: 1, trigger: 'auto', seed: 0x92, sessionId: U, startMs: T0 + 600_000 });
    sufB = compactionSequence({ n: 0, trigger: 'manual', tailRows: 20, seed: 0x93, sessionId: U, startMs: T0 + 600_000 });
    plantSession(box, ID, { uuid: U, generation: GEN, project: 'demo', workdir: '/home/u/worktrees/p/quiet-basin' });
    plantTranscript(box, 'claude', SLUG, U, [...pre.rows, ...sufA.rows]);      // copy A: compacts again
    plantTranscript(box, 'claude-a', SLUG, U, [...pre.rows, ...sufB.rows]);    // copy B: larger, never compacts again
    spoolLine(box, ID, { v: 1, ev: 'SessionStart', id: ID, sid: U, src: 'startup', reg: U, gen: GEN });
    settle(box);
  }, 240_000);

  it('DM36 CONTROL: copy A, under the first rostered home, was bound first; copy B is the larger', () => {
    const files = q<{ file_id: number; path: string; n: number }>(box,
      `SELECT f.file_id, p.path, (SELECT count(*) FROM memberships m WHERE m.file_id = f.file_id) AS n
       FROM ingest_files f JOIN file_paths p ON p.file_id = f.file_id ORDER BY f.file_id`);
    expect(files).toHaveLength(2);
    expect(files[0]!.path.startsWith(`${box.accountHome['claude']!}${path.sep}`)).toBe(true);
    expect(files[1]!.n).toBeGreaterThan(files[0]!.n);
  });

  it('DM36: each leaf reads the copy that holds its boundary: exact sources, unchanged ids', () => {
    const leaves = leavesOf(box, U);
    expect(leaves.map((l) => l.boundary_uuid)).toEqual([pre.boundaryUuids[0], sufA.boundaryUuids[0]]);
    expect(sourcesOf(box, leaves[0]!.node_id)).toEqual(expectedSources(pre, 0));
    expect(sourcesOf(box, leaves[1]!.node_id)).toEqual([
      ...pre.keptUuids[0]!, ...pre.afterUuids[0]!, ...pre.liveUuids, ...sufA.workUuids[0]!, ...sufA.unkeptUuids[0]!,
    ]);
    expect(leaves.map((l) => l.node_id)).toEqual([leafId(ID, U, firstUuid(pre)), leafId(ID, U, pre.headUuids[0]!)]);
  });

  it("DM36: rows only in the other copy's suffix are stored and in no leaf; rows_unspanned and transcript_forked are counted", () => {
    const stored = new Set(q<{ uuid: string }>(box, 'SELECT uuid FROM entries').map((r) => r.uuid));
    const inLeaves = new Set(q<{ uuid: string }>(box, 'SELECT e.uuid FROM node_sources ns JOIN entries e ON e.entry_id = ns.entry_id').map((r) => r.uuid));
    for (const u of sufB.liveUuids) {
      expect(stored.has(u), u).toBe(true);
      expect(inLeaves.has(u), u).toBe(false);
    }
    const c = counters(box);
    expect(c['rows_unspanned']).toBe(sufB.liveUuids.length);
    expect(c['transcript_forked']).toBe(1);
  });

  it('DM36: rows appended later to the copy that holds no new boundary are counted too, with no leaf derived in that tick', () => {
    const entriesBefore = q<{ n: number }>(box, 'SELECT count(*) AS n FROM entries')[0]!.n;
    const nodesBefore = q<{ n: number }>(box, 'SELECT count(*) AS n FROM nodes')[0]!.n;
    const p = path.join(box.accountHome['claude-a']!, 'projects', SLUG, `${U}.jsonl`);
    for (let i = 1; i <= 3; i += 1) {
      const row = userRow({ uuid: `000000b4-0000-4000-8000-00000000000${i}`, ts: new Date(T0 + 9_000_000 + i * 1000).toISOString(), sessionId: U, text: `a later turn in copy B ${i}` });
      fs.appendFileSync(p, `${JSON.stringify(row)}\n`);
    }
    spoolLine(box, ID, { v: 1, ev: 'Stop', id: ID, sid: U });   // the hint that re-reads both copies
    settle(box);
    expect(q<{ n: number }>(box, 'SELECT count(*) AS n FROM entries')[0]!.n, 'CONTROL: copy B was read again').toBe(entriesBefore + 3);
    expect(q<{ n: number }>(box, 'SELECT count(*) AS n FROM nodes')[0]!.n, 'CONTROL: no leaf was derived').toBe(nodesBefore);
    const c = counters(box);
    expect(c['rows_unspanned']).toBe(sufB.liveUuids.length + 3);
    expect(c['transcript_forked'], 'counted once').toBe(1);
  });
});

describe('two forks after one head: the first bound keeps the plain id, the later is boundary-qualified (DM37; spec 6.1)', () => {
  const ID = 'claude-twofork';
  const U = '0189abcd-1234-4678-9abc-0000000000f2';
  let box: HistoryBox;
  let pre: Seq; let sufA: Seq; let sufB: Seq;
  beforeAll(() => {
    box = makeHistoryBox('ccrc-hist-dm37-');
    pre = compactionSequence({ n: 1, trigger: 'manual', seed: 0xa1, sessionId: U, startMs: T0 });
    sufA = compactionSequence({ n: 1, trigger: 'manual', seed: 0xa2, sessionId: U, startMs: T0 + 600_000 });
    sufB = compactionSequence({ n: 1, trigger: 'auto', seed: 0xa3, sessionId: U, startMs: T0 + 600_000 });
    plantSession(box, ID, { uuid: U, generation: GEN, project: 'demo', workdir: '/home/u/worktrees/p/quiet-basin' });
    plantTranscript(box, 'claude', SLUG, U, [...pre.rows, ...sufA.rows]);
    plantTranscript(box, 'claude-a', SLUG, U, [...pre.rows, ...sufB.rows]);
    spoolLine(box, ID, { v: 1, ev: 'SessionStart', id: ID, sid: U, src: 'startup', reg: U, gen: GEN });
    settle(box);
  }, 240_000);

  it('DM37: all three boundary rows exist, with distinct ord', () => {
    const rows = q<{ uuid: string; ord: number }>(box, 'SELECT e.uuid, b.ord FROM boundaries b JOIN entries e ON e.entry_id = b.entry_id ORDER BY b.ord');
    expect(rows.map((r) => r.uuid)).toEqual([pre.boundaryUuids[0], sufA.boundaryUuids[0], sufB.boundaryUuids[0]]);
    expect(new Set(rows.map((r) => r.ord)).size).toBe(3);
  });

  it('DM37: the first bound keeps the plain id, the second takes the boundary-qualified id; leaf_id_forked +1', () => {
    const byBoundary = new Map(leavesOf(box, U).map((l) => [l.boundary_uuid, l]));
    const head = pre.headUuids[0]!;
    const a = byBoundary.get(sufA.boundaryUuids[0]!)!;
    const b = byBoundary.get(sufB.boundaryUuids[0]!)!;
    expect(a.node_id).toBe(leafId(ID, U, head));
    expect(b.node_id).toBe(leafId(ID, U, head, sufB.boundaryUuids[0]!));
    expect(b.span_start_uuid).toBe(head);
    expect(sourcesOf(box, b.node_id)).toEqual([
      ...pre.keptUuids[0]!, ...pre.afterUuids[0]!, ...pre.liveUuids, ...sufB.workUuids[0]!, ...sufB.unkeptUuids[0]!,
    ]);
    const c = counters(box);
    expect(c['leaf_id_forked']).toBe(1);
    expect(c['transcript_forked']).toBe(1);
    expect(c['rows_unspanned'] ?? 0, 'each copy holds a boundary, so every row is in a holding copy').toBe(0);
  });

  it('DM37: a re-ingest mints neither id again', () => {
    const before = q<{ node_id: string }>(box, 'SELECT node_id FROM nodes ORDER BY node_id').map((r) => r.node_id);
    const entriesBefore = q<{ n: number }>(box, 'SELECT count(*) AS n FROM entries')[0]!.n;
    ['claude', 'claude-a'].forEach((acct, i) => {
      const p = path.join(box.accountHome[acct]!, 'projects', SLUG, `${U}.jsonl`);
      const row = userRow({ uuid: `000000a4-0000-4000-8000-00000000000${i + 1}`, ts: new Date(T0 + 9_000_000).toISOString(), sessionId: U, text: `a later turn in copy ${i}` });
      fs.appendFileSync(p, `${JSON.stringify(row)}\n`);
    });
    spoolLine(box, ID, { v: 1, ev: 'Stop', id: ID, sid: U });   // the hint that re-reads both copies
    settle(box);
    const entriesAfter = q<{ n: number }>(box, 'SELECT count(*) AS n FROM entries')[0]!.n;
    expect(entriesAfter, 'CONTROL: both copies were read again').toBe(entriesBefore + 2);
    expect(q<{ node_id: string }>(box, 'SELECT node_id FROM nodes ORDER BY node_id').map((r) => r.node_id)).toEqual(before);
    expect(counters(box)['leaf_id_forked']).toBe(1);
  });
});

describe('a queued receipt holds only its session leaf until the next drain (two-phase spool; spec 7.4 item 2)', () => {
  const CARRIER_ID = 'claude-pending-receipt';
  const CARRIER_U = '0189abcd-1234-4678-9abc-0000000000e1';
  const NATIVE_ID = 'claude-unrelated-native';
  const NATIVE_U = '0189abcd-1234-4678-9abc-0000000000e2';
  const steered = (): string => [
    '<summary>', '1. Primary Request and Intent:', '   A receipt-race fixture.', '</summary>',
    steeredBlock({ gist: 'The queued receipt must be applied before this leaf is finalised.', expand: 'receipt, race', refs: 'server/test/history-derive.test.ts' }),
  ].join('\n');
  let box: HistoryBox;
  let carrier: Seq;
  beforeAll(() => {
    box = makeHistoryBox('ccrc-hist-pending-receipt-');
    carrier = compactionSequence({ n: 1, trigger: 'manual', summaryText: steered, seed: 0xa4, sessionId: CARRIER_U, startMs: T0 });
    const native = compactionSequence({ n: 1, trigger: 'manual', seed: 0xa3, sessionId: NATIVE_U, startMs: T0 });
    plant(box, CARRIER_ID, CARRIER_U, carrier.rows);
    plant(box, NATIVE_ID, NATIVE_U, native.rows);
    // Tick N renames the SessionStart files. Tick N+1 drains them, while this receipt is only renamed.
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    const at = Date.parse(String(carrier.rows.find((row) => row['uuid'] === carrier.boundaryUuids[0])!['timestamp']));
    // This goes into a new spool file after tick N. Tick N+1 drains SessionStart but only renames this receipt.
    spoolLine(box, CARRIER_ID, { v: 1, ev: 'steer', id: CARRIER_ID, sid: CARRIER_U, leaf: '', ts: at - 500 });
  }, 120_000);

  it('holds the queued session without delaying an unrelated native leaf, then derives the receipt-bearing leaf after the next drain', () => {
    const race = runSweep(box);
    expect(race.code, race.stderr).toBe(0);
    expect(leavesOf(box, CARRIER_U), 'the receipt was renamed this tick and is not yet durable').toEqual([]);
    expect(leavesOf(box, NATIVE_U).map((leaf) => ({ kind: leaf.kind, status: leaf.status })), 'no receipt belongs to this session')
      .toEqual([{ kind: 'native_leaf', status: 'not-requested' }]);

    const drained = runSweep(box);
    expect(drained.code, drained.stderr).toBe(0);
    expect(leavesOf(box, CARRIER_U).map((leaf) => ({ kind: leaf.kind, status: leaf.status })))
      .toEqual([{ kind: 'steered_leaf', status: 'ok' }]);
  }, 120_000);
});

describe('an unmeasured spool holds every leaf until receipt candidates are measured (two-phase spool; review fix round 1)', () => {
  const CARRIER_ID = 'claude-unmeasured-carrier';
  const CARRIER_U = '0189abcd-1234-4678-9abc-0000000000e3';
  const NATIVE_ID = 'claude-unmeasured-native';
  const NATIVE_U = '0189abcd-1234-4678-9abc-0000000000e4';
  const steered = (): string => [
    '<summary>', '1. Primary Request and Intent:', '   An unmeasured-spool receipt race fixture.', '</summary>',
    steeredBlock({ gist: 'The delayed receipt must steer this leaf after spool measurement resumes.', expand: 'receipt, unmeasured', refs: 'server/test/history-derive.test.ts' }),
  ].join('\n');

  it('holds all leaves for an unusable-spool tick, then drains the receipt and derives its steered leaf while measured-empty permits unrelated leaves', () => {
    const box = makeHistoryBox('ccrc-hist-unmeasured-spool-');
    const carrier = compactionSequence({ n: 1, trigger: 'manual', summaryText: steered, seed: 0xa6, sessionId: CARRIER_U, startMs: T0 });
    const native = compactionSequence({ n: 1, trigger: 'manual', seed: 0xa7, sessionId: NATIVE_U, startMs: T0 });
    plant(box, CARRIER_ID, CARRIER_U, carrier.rows);
    plant(box, NATIVE_ID, NATIVE_U, native.rows);

    const first = runSweep(box);
    expect(first.code, first.stderr).toBe(0);
    const at = Date.parse(String(carrier.rows.find((row) => row['uuid'] === carrier.boundaryUuids[0])!['timestamp']));
    spoolLine(box, CARRIER_ID, { v: 1, ev: 'steer', id: CARRIER_ID, sid: CARRIER_U, leaf: '', ts: at - 500 });

    const spool = path.join(box.root, 'spool');
    const heldSpool = path.join(box.root, 'spool-held');
    fs.renameSync(spool, heldSpool);
    fs.writeFileSync(spool, 'refused spool');
    try {
      const unavailable = runSweep(box);
      expect(unavailable.code, unavailable.stderr).toBe(0);
    } finally {
      fs.rmSync(spool);
      fs.renameSync(heldSpool, spool);
    }
    expect(leavesOf(box, CARRIER_U), 'a refused spool leaves receipt candidates unmeasured').toEqual([]);
    expect(leavesOf(box, NATIVE_U), 'unmeasured is a global leaf hold, not measured-empty').toEqual([]);

    const renamed = runSweep(box);
    expect(renamed.code, renamed.stderr).toBe(0);
    expect(leavesOf(box, CARRIER_U), 'the receipt is newly renamed and still pending').toEqual([]);
    expect(leavesOf(box, NATIVE_U).map((leaf) => ({ kind: leaf.kind, status: leaf.status })), 'a measured candidate set excludes unrelated sessions')
      .toEqual([{ kind: 'native_leaf', status: 'not-requested' }]);

    const drained = runSweep(box);
    expect(drained.code, drained.stderr).toBe(0);
    expect(leavesOf(box, CARRIER_U).map((leaf) => ({ kind: leaf.kind, status: leaf.status })))
      .toEqual([{ kind: 'steered_leaf', status: 'ok' }]);
  }, 180_000);
});

describe('field-first miner redaction (review fix round 1)', () => {
  const ID = 'claude-miner-field-redaction';
  const U = '0189abcd-1234-4678-9abc-0000000000e5';
  const SECRET = 'fieldfirstminersecret-0123456789';

  it('redacts raw tool input fields before passing their JSON to mineTokens', async () => {
    const box = makeHistoryBox('ccrc-hist-miner-field-redaction-');
    const seq = compactionSequence({ n: 1, trigger: 'manual', workRows: 4, seed: 0xa8, sessionId: U, startMs: T0 });
    const rows = seq.rows.map((row) => JSON.parse(JSON.stringify(row)) as Row);
    const source = rows.find((row) => {
      const content = (row['message'] as { content?: Array<{ type?: string; name?: string }> } | undefined)?.content ?? [];
      return content.some((item) => item.type === 'tool_use' && item.name === 'Read');
    });
    expect(source, 'CONTROL: the fixture supplies a Read tool-use row').toBeDefined();
    const content = (source!['message'] as { content?: Array<{ type?: string; input?: Record<string, unknown> }> }).content ?? [];
    const part = content.find((item) => item.type === 'tool_use');
    expect(part?.input, 'CONTROL: the Read row carries tool input').toBeDefined();
    part!.input!['file_path'] = `/home/u/${SECRET}/source.ts`;
    part!.input!['notebook_path'] = `/home/u/${SECRET}/source.ipynb`;
    part!.input!['command'] = `cat /home/u/${SECRET}/source.ts`;
    plant(box, ID, U, rows);
    settle(box);

    const S = (await import('../../ccd/history/sweep.mjs')) as unknown as {
      makeIngestCtx(home: string, homes: string[], nowMs: number, ids: unknown): Record<string, unknown>;
      newBudget(): unknown;
    };
    const D = (await import('../../ccd/history/derive.mjs')) as unknown as {
      nodeToolkit(): { HEADING_RE: RegExp; fencedRanges(t: string): { ranges: Array<[number, number]>; closed: number }; mineTokens(w: string, re: RegExp | null): Array<{ token: string; tag: string }> };
      deriveLeaves(db: ReturnType<typeof openWriter>, ictx: Record<string, unknown>, budget: unknown): unknown;
    };
    const db = openWriter(historyPaths(box.home).dbFile);
    let seen = '';
    try {
      withTx(db, 'NORMAL', () => {
        db.prepare('DELETE FROM node_refs').run();
        db.prepare('DELETE FROM nodes_fts').run();
        db.prepare('DELETE FROM nodes').run();
        db.prepare("DELETE FROM derivation_state WHERE step = 'leaves'").run();
      });
      const real = D.nodeToolkit();
      const ictx = S.makeIngestCtx(box.home, box.homes, Date.now(), null);
      ictx['pairIdx'] = makePairIndex(secretPairs([SECRET]).pairs);
      ictx['fts'] = true;
      ictx['nodeKit'] = {
        ...real,
        mineTokens: (input: string, re: RegExp | null) => {
          seen = input;
          return real.mineTokens(input, re);
        },
      };
      D.deriveLeaves(db, ictx, S.newBudget());
    } finally {
      closeWriter(db);
    }
    expect(seen).toContain('[redacted]');
    expect(seen).not.toContain(SECRET);
  }, 180_000);
});

describe('a carried copy of an earlier gist is invalid even past the cap (spec 7.4 items 2, 5, 6, 10; IN-6)', () => {
  const ID = 'claude-carried';
  const U = '0189abcd-1234-4678-9abc-0000000000f4';
  /** One gist longer than GIST_MAX, which the next summary's block carries word for word. */
  const LONG = `Carried fixture gist that runs past the cap. ${'carried words '.repeat(110)}`.trim();
  const steered = (): string => [
    '<summary>', '1. Primary Request and Intent:', '   A steered fixture summary.', '</summary>',
    steeredBlock({ gist: LONG, expand: 'carried, fixture', refs: 'server/test/history-derive.test.ts' }),
  ].join('\n');
  let box: HistoryBox;
  beforeAll(() => {
    box = makeHistoryBox('ccrc-hist-carried-');
    const seq = compactionSequence({ n: 2, trigger: 'manual', summaryText: steered, seed: 0xa5, sessionId: U, startMs: T0 });
    plant(box, ID, U, seq.rows);
    // Two generic steer receipts, one inside each leaf's window (the previous boundary, this boundary].
    const at = (u: string): number => Date.parse(String(seq.rows.find((r) => r['uuid'] === u)!['timestamp']));
    for (const b of seq.boundaryUuids) spoolLine(box, ID, { v: 1, ev: 'steer', id: ID, sid: U, leaf: '', ts: at(b) - 500 });
    settle(box);
  }, 240_000);

  it('leaf 0 is steered and cut at GIST_MAX; leaf 1 carries that gist and is invalid, counted carried_copies and by its reason', () => {
    expect(LONG.length, 'CONTROL: the carried gist is longer than the cap').toBeGreaterThan(GIST_MAX);
    const [l0, l1] = leavesOf(box, U);
    expect({ kind: l0!.kind, status: l0!.status, gist: l0!.gist }).toEqual({ kind: 'steered_leaf', status: 'ok', gist: LONG.slice(0, GIST_MAX) });
    expect({ kind: l1!.kind, status: l1!.status }).toEqual({ kind: 'native_leaf', status: 'invalid' });
    const c = counters(box);
    expect(c['carried_copies']).toBe(1);
    expect(c['leaf_reason:carried-copy:anthropic']).toBe(1);
    expect(c['leaf_status:ok:anthropic']).toBe(1);
    expect(Object.keys(c).filter((k) => k.startsWith('leaf_reason:')), 'an ok leaf has no reason; both spans had a receipt')
      .toEqual(['leaf_reason:carried-copy:anthropic']);
  });
});

describe('a registered value is redacted before any derived field is cut: gist, topic and ref, steered and native (review R30; spec 8.3, 7.4 items 6-8)', () => {
  // Leaf 0 is steered (one generic receipt in its window): its block's gist holds V across GIST_MAX, one of its
  // topics holds V across TOPIC_CHARS, and its refs line names a path holding V. One of its span's Read rows
  // reads a path holding V, so a mined ref holds V too. Leaf 1 is native: V across NATIVE_GIST_MAX in its Current
  // Work, and across TOPIC_CHARS in a section-2 item. V is PAIR-ONLY when the leaves are derived. The first ticks
  // record its pair from a secret file, which is then rewritten without it, so redact_hashes keeps the pair and no
  // belt unit holds V (Task 7A's belt holds the values loaded now). That is the rotated-value shape, and a
  // sessions.json hash behaves the same. Only the pair, matched on the WHOLE run before any cut, can mask V. A cut
  // first leaves a prefix that no pair matches, which no later layer (nodeIndexTexts included) can mask.
  const ID = 'claude-redact';
  const U = '0189abcd-1234-4678-9abc-0000000000f5';
  const V = crypto.randomBytes(32).toString('hex');   // one [A-Za-z0-9_-] run: one pair; beltWidth 18
  /** `n` characters of one filler run, no whitespace, so every position below is exact. */
  const fill = (n: number): string => 'zqfill-'.repeat(Math.ceil(n / 7)).slice(0, n);
  const LEAD = 30;   // V characters a cut-first derivation would keep: at least beltWidth(V)
  const GIST = `${fill(GIST_MAX - LEAD - 1)} ${V} zqsteer tail words`;
  const TOPIC = `${fill(TOPIC_CHARS - LEAD - 1)} ${V} more`;
  const CURRENT_LABEL = 'Current Work: ';
  const steered = (): string => [
    '<summary>', '1. Primary Request and Intent:', '   A steered fixture summary for the redaction order.', '</summary>',
    steeredBlock({ gist: GIST, expand: `zqtopic plain, ${TOPIC}`, refs: `src/${V}/model.ts server/test/history-derive.test.ts` }),
  ].join('\n');
  const native = (): string => [
    '<summary>', '1. Primary Request and Intent:', '   A native fixture summary for the redaction order.',
    '2. Key Technical Concepts:', `   - ${TOPIC}`,
    '8. Current Work:', `   ${fill(NATIVE_GIST_MAX - CURRENT_LABEL.length - LEAD - 1)} ${V} zqnative tail`,
    '9. Optional Next Step:', '   zqnative next step.', '</summary>',
  ].join('\n');
  let box: HistoryBox;
  /** Every text derivation stored for one node: its gist and topics, every node_refs value, its nodes_fts columns. */
  const storedTexts = (nodeId: string): string[] => [
    ...q<{ gist: string | null; topics: string | null }>(box, 'SELECT gist, topics FROM nodes WHERE node_id = ?', nodeId)
      .flatMap((r) => [r.gist ?? '', r.topics ?? '']),
    ...q<{ value: string }>(box, 'SELECT value FROM node_refs WHERE node_id = ?', nodeId).map((r) => r.value),
    ...q<{ gist: string | null; topics: string | null; refs: string | null }>(box,
      'SELECT f.gist, f.topics, f.refs FROM nodes_fts f JOIN nodes n ON n.rowid = f.rowid WHERE n.node_id = ?', nodeId)
      .flatMap((r) => [r.gist ?? '', r.topics ?? '', r.refs ?? '']),
  ];
  /** Each text holding beltWidth(v) consecutive characters of `v`, ASCII case folded as the belt folds. Its answer
   *  is a short list, so a red prints no long diff. */
  const stretches = (texts: readonly string[], v: string): string[] => {
    const w = beltWidth(v);
    const low = v.toLowerCase();
    const out: string[] = [];
    texts.forEach((t, i) => {
      const lt = t.toLowerCase();
      for (let k = 0; k + w <= low.length; k += 1) {
        if (lt.includes(low.slice(k, k + w))) { out.push(`#${i}: ${low.slice(k, k + w)}`); break; }
      }
    });
    return out;
  };
  const refsOf = (nodeId: string): { value: string; origin: string }[] =>
    q<{ value: string; origin: string }>(box, 'SELECT value, origin FROM node_refs WHERE node_id = ? ORDER BY value', nodeId);
  const ftsRowsOf = (nodeId: string): number => q<{ c: number }>(box,
    'SELECT count(*) AS c FROM nodes_fts f JOIN nodes n ON n.rowid = f.rowid WHERE n.node_id = ?', nodeId)[0]!.c;

  beforeAll(() => {
    box = makeHistoryBox('ccrc-hist-derive-redact-');
    const dir = path.join(box.home, '.cc-secrets');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'x8derive.env');
    fs.writeFileSync(file, `ZQ_DERIVE_V=${V}\n`, { mode: 0o600 });
    for (let i = 0; i < 2; i += 1) expect(runSweep(box).code).toBe(0);
    const db = openStoreRO(box);
    try {
      const pair = db.prepare('SELECT count(*) AS c FROM redact_hashes WHERE len = ? AND sha256 = ?')
        .get(V.length, crypto.createHash('sha256').update(V).digest()) as { c: number };
      expect(pair.c, 'CONTROL: the first ticks recorded the pair').toBe(1);
    } finally { db.close(); }
    fs.writeFileSync(file, `ZQ_DERIVE_OTHER=${crypto.randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
    const seq = compactionSequence({
      n: 2, trigger: 'manual', workRows: 8, seed: 0xc8, sessionId: U, startMs: T0, summaryText: (k) => (k === 0 ? steered() : native()),
    });
    // Leaf 0's first Read (segment-0-1.ts) reads a path holding V; its second (segment-0-5.ts) is the mined CONTROL.
    const rows = seq.rows.map((r) => JSON.parse(JSON.stringify(r).replace('quiet-basin/src/segment-0-1.ts', `quiet-basin/src/${V}/mined.ts`)) as Row);
    expect(rows.filter((r) => JSON.stringify(r).includes(`/${V}/mined.ts`)), 'CONTROL: one Read row holds V').toHaveLength(1);
    plant(box, ID, U, rows);
    const at = (u: string): number => Date.parse(String(rows.find((r) => r['uuid'] === u)!['timestamp']));
    // One generic receipt, inside leaf 0's window only (leaf 1's window opens after boundary 0).
    spoolLine(box, ID, { v: 1, ev: 'steer', id: ID, sid: U, leaf: '', ts: at(seq.boundaryUuids[0]!) - 500 });
    settle(box);
  }, 240_000);

  it('the steered leaf: the gist and the topic hold the mark where V sat across the cut; no stored field holds a belt-width stretch of V', () => {
    const [l0] = leavesOf(box, U);
    expect({ kind: l0!.kind, status: l0!.status }, 'CONTROL: leaf 0 is steered').toEqual({ kind: 'steered_leaf', status: 'ok' });
    expect(GIST.indexOf(V), 'CONTROL: V straddles GIST_MAX').toBe(GIST_MAX - LEAD);
    expect(l0!.gist!.slice(GIST_MAX - LEAD, GIST_MAX - LEAD + 10), 'redacted, then cut').toBe('[redacted]');
    expect(JSON.parse(l0!.topics!) as string[], 'redacted, then cut').toContain(`${fill(TOPIC_CHARS - LEAD - 1)} [redacted] more`);
    const refs = refsOf(l0!.node_id);
    expect(refs, 'CONTROL: the model refs were read').toContainEqual({ value: 'server/test/history-derive.test.ts', origin: 'model' });
    expect(refs, 'CONTROL: the span was mined').toContainEqual({ value: '/home/u/worktrees/p/quiet-basin/src/segment-0-5.ts', origin: 'tool_use' });
    expect(ftsRowsOf(l0!.node_id), 'CONTROL: the node has its nodes_fts row').toBe(1);
    expect(stretches(storedTexts(l0!.node_id), V)).toEqual([]);
  });

  it('the native leaf: its gist and topic hold the mark where V sat across the cut; no stored field holds a belt-width stretch of V', () => {
    const [, l1] = leavesOf(box, U);
    expect({ kind: l1!.kind, status: l1!.status }, 'CONTROL: leaf 1 is native').toEqual({ kind: 'native_leaf', status: 'not-requested' });
    // The native gist is `Current Work: ` and the section's text, so V starts at NATIVE_GIST_MAX - LEAD.
    const at = NATIVE_GIST_MAX - LEAD;
    expect(l1!.gist!.slice(0, CURRENT_LABEL.length), 'CONTROL: the Current Work pair').toBe(CURRENT_LABEL);
    expect(l1!.gist!.slice(at, at + 10), 'redacted, then cut').toBe('[redacted]');
    expect(JSON.parse(l1!.topics!) as string[], 'redacted, then cut').toContain(`${fill(TOPIC_CHARS - LEAD - 1)} [redacted] more`);
    expect(ftsRowsOf(l1!.node_id), 'CONTROL: the node has its nodes_fts row').toBe(1);
    expect(stretches(storedTexts(l1!.node_id), V)).toEqual([]);
  });
});

describe('a parser throw is recorded, counted once and never parsed again by a tick (RB5; NEW history-parser-crash-recorded)', () => {
  const ID = 'claude-crash';
  const U = '0189abcd-1234-4678-9abc-0000000000f3';
  type Kit = { HEADING_RE: RegExp; fencedRanges(t: string): unknown; mineTokens(w: string, re: RegExp | null): unknown };
  type Derived = { derived: number; waiting: number; failed: number };
  let box: HistoryBox;
  let seq: Seq;
  beforeAll(() => {
    box = makeHistoryBox('ccrc-hist-crash-');
    seq = compactionSequence({ n: 3, trigger: 'manual', seed: 0xb1, sessionId: U, startMs: T0 });
    plant(box, ID, U, seq.rows);
    settle(box);
  }, 240_000);

  type Writer = ReturnType<typeof openWriter>;
  const write = (fn: (db: Writer) => void): void => {
    const db = openWriter(historyPaths(box.home).dbFile);
    try { withTx(db, 'NORMAL', () => { fn(db); }); } finally { closeWriter(db); }
  };
  /** Delete one node and what references it, as a test only does: its nodes_fts row, its refs; node_sources cascade. */
  const dropNode = (db: Writer, id: string): void => {
    if (db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'nodes_fts'").get() !== undefined) {
      db.prepare('DELETE FROM nodes_fts WHERE rowid = (SELECT rowid FROM nodes WHERE node_id = ?)').run(id);
    }
    db.prepare('DELETE FROM node_refs WHERE node_id = ?').run(id);
    db.prepare('DELETE FROM nodes WHERE node_id = ?').run(id);
  };
  const entryOf = (uuid: string): number => q<{ entry_id: number }>(box, 'SELECT entry_id FROM entries WHERE uuid = ?', uuid)[0]!.entry_id;
  const crashes = (): number => counters(box)['parser_crash'] ?? 0;
  const atBoundary = (entryId: number) => q<{ node_id: string; kind: string; status: string; gist: string | null; topics: string | null; summary_blob_id: number | null }>(box,
    'SELECT node_id, kind, status, gist, topics, summary_blob_id FROM nodes WHERE boundary_entry_id = ? ORDER BY node_id', entryId);
  /** One in-process derivation pass, as the tick runs it, with `kit` as the node toolkit (an in-process seam: the
   *  sweep never sets ictx.nodeKit). */
  async function derive(kit: (real: Kit) => Kit): Promise<Derived> {
    const S = (await import('../../ccd/history/sweep.mjs')) as unknown as {
      makeIngestCtx(home: string, homes: string[], nowMs: number, ids: unknown): Record<string, unknown>;
      newBudget(): unknown;
    };
    const D = (await import('../../ccd/history/derive.mjs')) as unknown as {
      nodeToolkit(): Kit;
      deriveLeaves(db: Writer, ictx: Record<string, unknown>, budget: unknown): Derived;
    };
    const db = openWriter(historyPaths(box.home).dbFile);
    try {
      const ictx = S.makeIngestCtx(box.home, box.homes, Date.now(), null);
      ictx['nodeKit'] = kit(D.nodeToolkit());
      return D.deriveLeaves(db, ictx, S.newBudget());
    } finally {
      closeWriter(db);
    }
  }

  it('a throw inside the parser writes the leaf parse-failed under its own id and sources; a throw before the leaf leaves a marker; the next pass parses neither', async () => {
    const [l0, l1, l2] = leavesOf(box, U);
    expect([l0, l1, l2].every((l) => l !== undefined && l.kind === 'native_leaf'), 'CONTROL: three native leaves').toBe(true);
    expect(crashes(), 'CONTROL: the ticks crashed nothing').toBe(0);
    const src1 = sourcesOf(box, l1!.node_id);
    const [b0, b1, b2] = seq.boundaryUuids.map(entryOf);
    const forkedId = leafId(ID, U, seq.headUuids[1]!, seq.boundaryUuids[2]!);
    write((db) => {
      dropNode(db, l1!.node_id);
      dropNode(db, l2!.node_id);
      // Boundary 2's plain id now names boundary 0 and its fork-qualified id is taken: its insert can only fail.
      const plantNode = db.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status,
          boundary_entry_id, parser_version, created_ms)
        SELECT ?, session_pk, epoch_seq, transcript_pk, 'raw_leaf', 0, 'not-requested', ?, parser_version, created_ms FROM nodes WHERE node_id = ?`);
      plantNode.run(l2!.node_id, b0!, l0!.node_id);
      plantNode.run(forkedId, null, l0!.node_id);
      db.prepare("DELETE FROM derivation_state WHERE step = 'leaves'").run();
    });
    const throwing = (real: Kit): Kit => ({ ...real, fencedRanges: () => { throw new Error('a planted parser bug'); } });
    expect(await derive(throwing)).toEqual({ derived: 1, waiting: 0, failed: 1 });
    expect(await derive(throwing), 'the next pass parses neither boundary again').toEqual({ derived: 0, waiting: 0, failed: 0 });
    expect(crashes(), 'each throw counted once').toBe(2);
    expect(atBoundary(b1!)).toEqual([{
      node_id: l1!.node_id, kind: 'raw_leaf', status: 'parse-failed', gist: null, topics: null,
      summary_blob_id: blobOf(box, seq.summaryUuids[1]!),
    }]);
    expect(sourcesOf(box, l1!.node_id), 'its own sources, as derived before').toEqual(src1);
    expect(q<{ n: number }>(box, 'SELECT count(*) AS n FROM node_refs WHERE node_id = ?', l1!.node_id)[0]!.n).toBe(0);
    expect(atBoundary(b2!), 'no leaf at the boundary whose insert failed').toEqual([]);
    expect(q<{ cursor: string }>(box, "SELECT cursor FROM derivation_state WHERE step = 'leaf-crashed' AND version = ?", b2!))
      .toEqual([{ cursor: String(NODE_PARSER_VERSION) }]);
    const [leaves] = q<{ cursor: string }>(box, "SELECT cursor FROM derivation_state WHERE step = 'leaves' AND version = ?", NODE_PARSER_VERSION);
    expect(Number(leaves!.cursor), 'the cursor moved past both').toBe(b2);
    expect(Object.keys(counters(box)).filter((k) => k.includes('parse-failed')), 'a crash is no compliance outcome').toEqual([]);
  });

  it('a summary row stored but unreadable (a tombstoned blob) makes a raw leaf that still names its summary, counted summary_unreadable (spec 6.1)', async () => {
    const id0 = leafId(ID, U, firstUuid(seq));
    const b0 = entryOf(seq.boundaryUuids[0]!);
    const blob0 = blobOf(box, seq.summaryUuids[0]!)!;
    const doomed = atBoundary(b0).map((n) => n.node_id);   // leaf 0, and the node the case above planted there
    write((db) => {
      for (const n of doomed) dropNode(db, n);
      db.prepare('UPDATE blobs SET z = NULL, pruned_ms = ? WHERE blob_id = ?').run(Date.now(), blob0);
      db.prepare("DELETE FROM derivation_state WHERE step = 'leaves'").run();
    });
    expect(await derive((k) => k)).toEqual({ derived: 1, waiting: 0, failed: 0 });
    expect(atBoundary(b0)).toEqual([{ node_id: id0, kind: 'raw_leaf', status: 'not-requested', gist: null, topics: null, summary_blob_id: blob0 }]);
    expect(counters(box)['summary_unreadable']).toBe(1);
  });
});

describe('the derivation toolkit and the derivation_state helpers (in-process)', () => {
  it("nodeToolkit hands lib the card's own heading rule, fence scanner and token miner", async () => {
    const D = (await import('../../ccd/history/derive.mjs')) as unknown as {
      nodeToolkit(): {
        HEADING_RE: RegExp;
        fencedRanges(t: string): { ranges: Array<[number, number]>; closed: number };
        mineTokens(w: string, re: RegExp | null): Array<{ token: string; tag: string }>;
      };
    };
    const kit = D.nodeToolkit();
    expect(kit.HEADING_RE.flags).toBe('gm');
    expect([...'8. Current Work:\n'.matchAll(new RegExp(kit.HEADING_RE.source, kit.HEADING_RE.flags))].map((m) => m[1])).toEqual(['Current Work']);
    expect(kit.fencedRanges('a\n```\n1. x\n```\nb')).toEqual({ ranges: [[2, 15]], closed: 1 });
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/home/u/a.ts' } }] } });
    expect(kit.mineTokens(line, null)).toEqual([{ token: '/home/u/a.ts', tag: 'touched' }]);
  });

  it('getStep and setStep: one derivation_state row per (step, version), the cursor kept apart from completed_ms', () => {
    const box = makeHistoryBox('ccrc-hist-step-');
    createStore(box.home);
    const db = openWriter(historyPaths(box.home).dbFile);
    try {
      expect(getStep(db, 'leaves', 1)).toBeNull();
      withTx(db, 'NORMAL', () => { setStep(db, 'leaves', 1, '41'); });
      expect(getStep(db, 'leaves', 1)).toEqual({ cursor: '41', completedMs: null });
      withTx(db, 'NORMAL', () => { setStep(db, 'leaves', 1, '42', 1_700_000_000_000); });
      expect(getStep(db, 'leaves', 1)).toEqual({ cursor: '42', completedMs: 1_700_000_000_000 });
      withTx(db, 'NORMAL', () => { setStep(db, 'leaves', 1, '43'); });
      expect(getStep(db, 'leaves', 1), 'an omitted completedMs leaves it').toEqual({ cursor: '43', completedMs: 1_700_000_000_000 });
      withTx(db, 'NORMAL', () => { setStep(db, 'leaves', 1, null, null); });
      expect(getStep(db, 'leaves', 1)).toEqual({ cursor: null, completedMs: null });
      expect(getStep(db, 'leaves', 2), 'another version is another row').toBeNull();
    } finally {
      closeWriter(db);
    }
  });
});

// ── W1-B2 Task 9: parents (fan-in per epoch, final leaves only), the nodes_fts backfill, a re-key moves nodes ──
// DM26 (spec 2026-10-05 §6.3, §6.7):
//   - through real ticks: 8 leaves in one epoch make one depth-1 parent; 8 leaves spanning a /clear make none,
//     and the /clear epoch, confirmed only at a later tick, has no node before it is confirmed (review focus 4);
//   - in-process: a boundary whose leaf is not derived yet stops the group; fan-in is 4 per level above;
//   - in-process: fan-in is per holding copy, so two forks of one transcript never share a parent (ruling RB4).
// Plus (not pins): the nodes_fts backfill indexes redacted text once, and mergeFamily re-points nodes.
import * as v9 from 'vitest';
import * as tmp9 from './tmpHelpers.js';
import * as lib9 from '../../ccd/history/lib.mjs';
import * as store9 from '../../ccd/history/store.mjs';
import * as h9 from './historyHelpers.js';
import * as fx9 from './historyFixtures.js';
import type { DatabaseSync as Db9 } from 'node:sqlite';

interface Derive9 {
  deriveParents(db: Db9, ictx: object, budget: object): number;
  indexNodesFts(db: Db9, ictx: object, budget: object): number;
  rerollParents(db: Db9, ictx: object, nodeIds: readonly string[]): number;
}
interface Sweep9 {
  newBudget(): object;
  mergeFamily(db: Db9, fromPk: number, toPk: number): void;
}
const derive9 = async (): Promise<Derive9> => (await import('../../ccd/history/derive.mjs')) as unknown as Derive9;
const sweep9 = async (): Promise<Sweep9> => (await import('../../ccd/history/sweep.mjs')) as unknown as Sweep9;

const ID9 = 'claude-a-demo';
const E9 = 'd9e00000-1111-4111-8111-111111111111';
const T0_9 = Date.UTC(2026, 9, 1, 10, 0, 0);
const CWD9 = '/home/u/worktrees/p/quiet-basin';
const uid9 = (p: string, n: number): string => `${p}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const NO_PAIRS9 = lib9.makePairIndex([]);

/** A fresh store: one family, one confirmed epoch, one transcript with `n` boundaries, and a native leaf at
 *  every boundary except those in `missing` (a leaf the derivation has not reached yet). The transcript has
 *  `copies` live files (file_id 1, 2, …), and boundary k is a member of the files `holders(k)` names, so fan-in,
 *  which groups per holding copy, finds each boundary's copy the way Task 8's holdingCopy does. By default one
 *  copy holds every boundary. */
function epochFixture9(prefix: string, n: number, missing: ReadonlySet<number>,
  copies = 1, holders: (k: number) => readonly number[] = () => [1]): { db: Db9; leafIds: string[] } {
  const home = tmp9.mkTmp(prefix);
  store9.createStore(home);
  const db = store9.openWriter(lib9.historyPaths(home).dbFile);
  const leafIds: string[] = [];
  db.exec('BEGIN');
  db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, ?, '', 'demo', 1)").run(ID9);
  db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (1, 1, ?, 'startup', 'hook', 1)").run(E9);
  db.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?)').run(E9);
  const file = db.prepare("INSERT INTO ingest_files (file_id, dev, ino, transcript_pk, status, parser_version) VALUES (?, 1, ?, 1, 'live', 1)");
  for (let f = 1; f <= copies; f += 1) file.run(f, 9000 + f);
  db.prepare("INSERT INTO blobs (blob_id, sha256, codec, z, raw_len) VALUES (1, ?, 'br5', ?, 1)").run(Buffer.alloc(32, 9), Buffer.from([0]));
  const ent = db.prepare("INSERT INTO entries (entry_id, uuid, transcript_pk, type, subtype, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, 1, 'system', 'compact_boundary', 'harness', 1, 0, 0, 1, ?)");
  const bnd = db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord) VALUES (?, 1, ?)');
  const member = db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)');
  for (let k = 1; k <= n; k += 1) {
    ent.run(k, uid9('d9e00000', k), 1000 * k);
    bnd.run(k, k);
    for (const f of holders(k)) member.run(f, k, k);
    const id = lib9.leafId(ID9, E9, `span-${k}`);
    leafIds.push(id);
    if (!missing.has(k)) addLeaf9(db, k, id);
  }
  db.exec('COMMIT');
  return { db, leafIds };
}
function addLeaf9(db: Db9, k: number, id: string): void {
  db.prepare("INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, topics, boundary_entry_id, earliest_ms, latest_ms, src_chars, desc_count, desc_chars, parser_version, created_ms) VALUES (?, 1, 1, 1, 'native_leaf', 0, 'not-requested', ?, ?, ?, ?, ?, 100, 0, 0, 1, 1)")
    .run(id, `Leaf ${k} did part ${k}. It also did more.`, JSON.stringify([`topic ${k}`]), k, 1000 * k, 1000 * k + 500);
}
interface Parent9 { node_id: string; kind: string; status: string; gist: string | null; topics: string | null; earliest_ms: number; latest_ms: number; desc_count: number }
const parents9 = (db: Db9, depth: number): Parent9[] =>
  (db.prepare('SELECT node_id, kind, status, gist, topics, earliest_ms, latest_ms, desc_count FROM nodes WHERE depth = ? ORDER BY earliest_ms').all(depth) as unknown as Parent9[]).map((r) => ({ ...r }));
const children9 = (db: Db9, id: string): string[] =>
  (db.prepare('SELECT child_id FROM node_children WHERE node_id = ? ORDER BY ord').all(id) as { child_id: string }[]).map((r) => r.child_id);

/** `n` manual compactions in one transcript. Each cycle is a user turn, an answer, a kept follow-up, the
 *  boundary (head = the follow-up, kept = [the follow-up]) and the summary row right after it (§6.1's manual
 *  shape: the anchor is the summary, one row past the boundary). Row uuids carry the 8-hex prefix `p`, so two
 *  transcripts never share one. */
function cycles9(p: string, sid: string, n: number, t0: number): fx9.Row[] {
  const rows: fx9.Row[] = [];
  let k = 0;
  let t = t0;
  const ts = (): string => new Date((t += 1000)).toISOString();
  for (let c = 1; c <= n; c += 1) {
    const u = uid9(p, ++k); const a = uid9(p, ++k); const x = uid9(p, ++k); const b = uid9(p, ++k); const s = uid9(p, ++k);
    rows.push(fx9.userRow({ uuid: u, ts: ts(), sessionId: sid, cwd: CWD9, text: `fixture request ${c}` }));
    rows.push(fx9.assistantRow({ uuid: a, ts: ts(), sessionId: sid, cwd: CWD9, text: `Fixture answer ${c}. More detail follows.`, requestId: `req_${p}_${c}`, msgId: `msg_${p}_${c}` }));
    rows.push(fx9.userRow({ uuid: x, ts: ts(), sessionId: sid, cwd: CWD9, text: `fixture follow-up ${c}` }));
    rows.push(fx9.boundaryRow({ uuid: b, ts: ts(), sessionId: sid, cwd: CWD9, trigger: 'manual', headUuid: x, anchorUuid: s, tailUuid: x, allUuids: [x] }));
    rows.push(fx9.summaryRow({ uuid: s, ts: ts(), sessionId: sid, cwd: CWD9, text: [
      'This session is being continued from a previous conversation. The summary below covers the earlier portion.',
      '<summary>', '1. Primary Request and Intent:', `   Fixture request ${c}.`,
      '8. Current Work:', `   Wrote part ${c} of the fixture.`,
      '9. Optional Next Step:', `   Continue with part ${c + 1}.`, '</summary>',
    ].join('\n') }));
  }
  return rows;
}

v9.describe('DM26: parents by fan-in, never across an epoch, only over final leaves (W1-B2 Task 9)', () => {
  v9.it('a boundary whose leaf is not derived yet stops the group: 9 boundaries, leaf 4 missing, no parent; leaf 4 derived, one parent over leaves 1-8', async () => {
    const d = await derive9();
    const s = await sweep9();
    const fx = epochFixture9('ccrc-hist-dm26-nf-', 9, new Set([4]));
    const ictx = { nowMs: 5_000, fts: false, pairIdx: NO_PAIRS9 };
    try {
      d.deriveParents(fx.db, ictx, s.newBudget());
      v9.expect(parents9(fx.db, 1), 'slot 4 is not final: slots 1-3 and 5-9 are never one group').toEqual([]);
      addLeaf9(fx.db, 4, fx.leafIds[3]!);
      d.deriveParents(fx.db, ictx, s.newBudget());
      const p = parents9(fx.db, 1);
      v9.expect(p).toHaveLength(1);
      v9.expect(p[0]!.node_id, 'parentId over the children in boundary order').toBe(lib9.parentId(fx.leafIds.slice(0, 8)));
      v9.expect(children9(fx.db, p[0]!.node_id)).toEqual(fx.leafIds.slice(0, 8));
      v9.expect([p[0]!.kind, p[0]!.status]).toEqual(['condensed', 'ok']);
      v9.expect(p[0]!.gist).toContain('Leaf 1 did part 1');
      v9.expect(p[0]!.gist).toContain('Leaf 8 did part 8');
      v9.expect([p[0]!.earliest_ms, p[0]!.latest_ms]).toEqual([1000, 8500]);
      v9.expect(p[0]!.desc_count).toBe(8);
      v9.expect(JSON.parse(p[0]!.topics ?? '[]')).toEqual(v9.expect.arrayContaining(['topic 1', 'topic 8']));
      d.deriveParents(fx.db, ictx, s.newBudget());
      v9.expect(parents9(fx.db, 1), 'a rerun mints nothing again').toHaveLength(1);
    } finally {
      fx.db.close();
    }
  });

  v9.it('fan-in is 4 per level above the leaves: 32 leaves give four depth-1 parents and one depth-2 parent over them, in order', async () => {
    const d = await derive9();
    const s = await sweep9();
    const fx = epochFixture9('ccrc-hist-dm26-d2-', 32, new Set());
    try {
      d.deriveParents(fx.db, { nowMs: 5_000, fts: false, pairIdx: NO_PAIRS9 }, s.newBudget());
      const level1 = [0, 8, 16, 24].map((i) => lib9.parentId(fx.leafIds.slice(i, i + 8)));
      v9.expect(parents9(fx.db, 1).map((r) => r.node_id)).toEqual(level1);
      const top = parents9(fx.db, 2);
      v9.expect(top.map((r) => r.node_id)).toEqual([lib9.parentId(level1)]);
      v9.expect(children9(fx.db, top[0]!.node_id)).toEqual(level1);
      v9.expect(parents9(fx.db, 3)).toEqual([]);
    } finally {
      fx.db.close();
    }
  });

  v9.it('a parent never mixes forks: two copies share a head, fork, and interleave in ord; each copy gets its own parent, and a leaf not derived in one stops only that copy (RB4)', async () => {
    const d = await derive9();
    const s = await sweep9();
    // Boundaries 1-2: the shared head, in both copies, so held by file 1 (both are live: the smaller file_id).
    // Then the forks arrive interleaved: odd k from 3 to 17 is copy A's (file 1 only), even k from 4 to 18 copy
    // B's (file 2 only). boundaries.ord is per transcript, so the two forks' ords interleave as they do on a box.
    const holders = (k: number): number[] => (k <= 2 ? [1, 2] : k % 2 === 1 ? [1] : [2]);
    const fx = epochFixture9('ccrc-hist-dm26-fork-', 18, new Set([7]), 2, holders);
    const ictx = { nowMs: 5_000, fts: false, pairIdx: NO_PAIRS9 };
    const leaf = (k: number): string => fx.leafIds[k - 1]!;
    const copyA = [1, 2, 3, 5, 7, 9, 11, 13].map(leaf);
    const copyB = [4, 6, 8, 10, 12, 14, 16, 18].map(leaf);
    try {
      d.deriveParents(fx.db, ictx, s.newBudget());
      v9.expect(parents9(fx.db, 1).map((p) => p.node_id), 'leaf 7 (copy A) is not derived yet: copy B still gets its parent')
        .toEqual([lib9.parentId(copyB)]);
      addLeaf9(fx.db, 7, leaf(7));
      d.deriveParents(fx.db, ictx, s.newBudget());
      const made = parents9(fx.db, 1).map((p) => p.node_id).sort();
      v9.expect(made).toEqual([lib9.parentId(copyA), lib9.parentId(copyB)].sort());
      v9.expect(children9(fx.db, lib9.parentId(copyA)), 'the head and copy A\'s first six, in ord').toEqual(copyA);
      // Every parent's children sit in one holding copy: the smallest live file_id with the boundary as a member.
      const holderOf = (id: string): number => {
        const b = (fx.db.prepare('SELECT boundary_entry_id AS e FROM nodes WHERE node_id = ?').get(id) as { e: number }).e;
        return Number((fx.db.prepare('SELECT min(file_id) AS f FROM memberships WHERE entry_id = ?').get(b) as { f: number }).f);
      };
      for (const p of made) v9.expect(new Set(children9(fx.db, p).map(holderOf)).size, `${p}: one holding copy`).toBe(1);
    } finally {
      fx.db.close();
    }
  });

  v9.it('rerollParents re-rolls every parent above a changed leaf from its children as stored now, ids kept (Tasks 21 and 29 call it)', async () => {
    const d = await derive9();
    const s = await sweep9();
    const fx = epochFixture9('ccrc-hist-reroll-', 32, new Set());
    const ictx = { nowMs: 5_000, fts: false, pairIdx: NO_PAIRS9 };
    try {
      d.deriveParents(fx.db, ictx, s.newBudget());
      const ids = (): string[] => [...parents9(fx.db, 1), ...parents9(fx.db, 2)].map((p) => p.node_id);
      const before = ids();
      fx.db.prepare('UPDATE nodes SET gist = ? WHERE node_id = ?').run('Leaf 3 was re-derived. Its tail is dropped.', fx.leafIds[2]!);
      v9.expect(d.rerollParents(fx.db, ictx, [fx.leafIds[2]!]), 'its depth-1 parent, then the depth-2 parent above that').toBe(2);
      const p1 = parents9(fx.db, 1);
      v9.expect(p1[0]!.gist).toContain('Leaf 3 was re-derived.');
      v9.expect(p1[0]!.gist).not.toContain('Leaf 3 did part 3');
      v9.expect(p1[1]!.gist, 'a parent above no changed leaf is untouched').toContain('Leaf 9 did part 9.');
      v9.expect(ids(), 'no parent id changes').toEqual(before);
      v9.expect(children9(fx.db, p1[0]!.node_id)).toEqual(fx.leafIds.slice(0, 8));
    } finally {
      fx.db.close();
    }
  });

  v9.it('through real ticks: 8 leaves in one epoch make one parent; 8 leaves spanning a /clear make none, and the late-confirmed /clear epoch has no node before it is confirmed', () => {
    const one = h9.makeHistoryBox('ccrc-hist-dm26-one-');
    const acct = Object.keys(one.accountHome)[0]!;
    const T = 'd26a0000-1111-4111-8111-111111111111';
    h9.plantSession(one, ID9, { uuid: T, project: 'demo' });
    h9.plantTranscript(one, acct, '-home-u-tree-demo', T, cycles9('d26a1a00', T, 8, T0_9));
    h9.spoolLine(one, ID9, { v: 1, ev: 'SessionStart', id: ID9, sid: T, src: 'startup', reg: T });
    for (let i = 0; i < 3; i += 1) v9.expect(h9.runSweep(one).code).toBe(0);
    const db1 = h9.openStoreRO(one);
    try {
      const leaves = (db1.prepare('SELECT n.node_id AS id FROM nodes n JOIN boundaries b ON b.entry_id = n.boundary_entry_id WHERE n.depth = 0 ORDER BY b.ord').all() as { id: string }[]).map((r) => r.id);
      v9.expect(leaves).toHaveLength(8);
      v9.expect(parents9(db1, 1).map((r) => r.node_id)).toEqual([lib9.parentId(leaves)]);
    } finally {
      db1.close();
    }

    const two = h9.makeHistoryBox('ccrc-hist-dm26-clear-');
    const acct2 = Object.keys(two.accountHome)[0]!;
    const T1 = 'd26c1000-1111-4111-8111-111111111111';
    const T2 = 'd26c2000-2222-4222-8222-222222222222';
    // B1 renames a spool line at the END of a tick and drains it at the NEXT (sweep.mjs's listDraining loop, then
    // renameAndObserve), and the first tick also runs the registry scan, which books a planted .uuid as an 'import'
    // epoch. So the box is primed first: that tick spends the scan, and epoch 1 is the hook's 'startup'.
    v9.expect(h9.runSweep(two).code).toBe(0);   // prime: spends the first tick's registry scan, so epoch 1 is the hook's 'startup'
    h9.plantSession(two, ID9, { uuid: T1, project: 'demo' });
    h9.plantTranscript(two, acct2, '-home-u-tree-demo', T1, cycles9('d26c1a00', T1, 4, T0_9));
    h9.spoolLine(two, ID9, { v: 1, ev: 'SessionStart', id: ID9, sid: T1, src: 'startup', reg: T1 });
    for (let i = 0; i < 2; i += 1) v9.expect(h9.runSweep(two).code).toBe(0);
    // The /clear line drains while .uuid still names T1 and no .workdir is set: B1 chains its epoch UNCONFIRMED
    // (SE5; decideEpochLine, then confirmClear waits), out of every scope. .uuid names T2 only after that tick, so
    // a LATER tick confirms it ('later-tick'), and only then do its leaves appear, in that epoch (review focus 4).
    h9.plantTranscript(two, acct2, '-home-u-tree-demo', T2, cycles9('d26c2a00', T2, 4, T0_9 + 3_600_000));
    h9.spoolLine(two, ID9, { v: 1, ev: 'SessionStart', id: ID9, sid: T2, src: 'clear' });
    for (let i = 0; i < 2; i += 1) v9.expect(h9.runSweep(two).code).toBe(0);   // tick N renames the /clear line, tick N+1 drains it and chains the unconfirmed epoch
    const early = h9.openStoreRO(two);
    try {
      const ep = early.prepare('SELECT seq, confirmed_ms FROM epochs ORDER BY seq').all() as { seq: number; confirmed_ms: number | null }[];
      v9.expect(ep.map((e) => [e.seq, e.confirmed_ms !== null]), 'the /clear epoch waits unconfirmed').toEqual([[1, true], [2, false]]);
      v9.expect((early.prepare('SELECT count(*) AS n FROM nodes WHERE epoch_seq = 2').get() as { n: number }).n, 'no node in an unconfirmed epoch').toBe(0);
    } finally {
      early.close();
    }
    h9.plantSession(two, ID9, { uuid: T2 });
    h9.spoolLine(two, ID9, { v: 1, ev: 'Stop', id: ID9 });   // a renamed line for the id hints its confirmed epochs and .uuid at ingest; without one, T2 waits for the 30-minute scan
    for (let i = 0; i < 3; i += 1) v9.expect(h9.runSweep(two).code).toBe(0);
    const db2 = h9.openStoreRO(two);
    try {
      const epochs = (db2.prepare('SELECT seq, cause, confirmed_ms FROM epochs ORDER BY seq').all() as { seq: number; cause: string; confirmed_ms: number | null }[]);
      v9.expect(epochs.map((e) => [e.seq, e.cause, e.confirmed_ms !== null])).toEqual([[1, 'startup', true], [2, 'clear', true]]);
      v9.expect((db2.prepare('SELECT count(*) AS n FROM nodes WHERE depth = 0').get() as { n: number }).n).toBe(8);
      v9.expect((db2.prepare('SELECT epoch_seq AS e, count(*) AS n FROM nodes WHERE depth = 0 GROUP BY epoch_seq ORDER BY epoch_seq').all() as { e: number; n: number }[])
        .map((r) => [r.e, r.n]), 'the late-confirmed epoch\'s leaves sit in it').toEqual([[1, 4], [2, 4]]);
      v9.expect(parents9(db2, 1), 'four leaves in each epoch: never one group across the /clear').toEqual([]);
    } finally {
      db2.close();
    }
  }, 120_000);
});

v9.describe('the nodes_fts backfill and a re-key that moves nodes (W1-B2 Task 9)', () => {
  v9.it('indexNodesFts indexes each node once, on redacted text, and a rerun adds nothing', async (ctx) => {
    const d = await derive9();
    const s = await sweep9();
    const fx = epochFixture9('ccrc-hist-nfts-', 2, new Set());
    try {
      if (store9.probeFts5(fx.db) !== 'present') ctx.skip();
      store9.createFtsTables(fx.db);
      const secret = 'fixturesecretvalue0123456789abc';
      // A one-case value: no belt gram seeds on it (§8.3 layer 4's seed rule), so only an escape reading separates it.
      const plain = 'fixtureonlylowercasevalueqwrt';
      // Leaf 2: the value whole, and the one-case value glued to a literal backslash-n, as a gist quoting JSON holds it
      // (B1's escape readings, through nodeIndexTexts; spec §6.2 `nodes_fts`, rev 3.5).
      fx.db.prepare('UPDATE nodes SET gist = ? WHERE node_id = ?').run(`Leaf 2 did part 2 with ${secret} and {"t":"a\\n${plain}"}.`, fx.leafIds[1]!);
      // Leaf 1: the value glued to letters (§8.3 layer 4, Task 7A): one run no pair matches, which the belt masks.
      fx.db.prepare('UPDATE nodes SET gist = ? WHERE node_id = ?').run(`Leaf 1 did part 1 with zq${secret}x.`, fx.leafIds[0]!);
      const ictx = { nowMs: 5_000, fts: true, pairIdx: lib9.makePairIndex(lib9.secretPairs([secret, plain]).pairs,
        lib9.makeBelt(lib9.beltUnits([secret, plain]))) };
      v9.expect(d.indexNodesFts(fx.db, ictx, s.newBudget())).toBe(2);
      const hits = (q: string): number => (fx.db.prepare('SELECT count(*) AS n FROM nodes_fts WHERE nodes_fts MATCH ?').get(q) as { n: number }).n;
      v9.expect(hits('"part"')).toBe(2);
      v9.expect(hits(`"${secret}"`), 'the value was redacted before indexing').toBe(0);
      v9.expect(hits(`"zq${secret}x"`), 'the glued value was masked by the belt before indexing (§8.3 layer 4)').toBe(0);
      v9.expect(hits(`"n${plain}"`), 'the escape-glued value was redacted on its decoded reading before indexing').toBe(0);
      v9.expect(hits(`"${plain}"`)).toBe(0);
      const nodeBytes = (fx.db.prepare('SELECT block FROM nodes_fts_data').all() as { block: Uint8Array }[])
        .map((r) => Buffer.from(r.block).toString('latin1')).join('');
      v9.expect(nodeBytes.includes(secret.slice(4, 18)), 'no 14 characters of the value are an index byte').toBe(false);
      v9.expect(d.indexNodesFts(fx.db, ictx, s.newBudget()), 'a rerun inserts no duplicate rowid').toBe(0);
      v9.expect((fx.db.prepare('SELECT count(*) AS n FROM nodes_fts').get() as { n: number }).n).toBe(2);
    } finally {
      fx.db.close();
    }
  });

  v9.it('mergeFamily moves every node with its epoch: same ids, the merged seqs; a node with no epoch stays and is counted', async () => {
    const s = await sweep9();
    const home = tmp9.mkTmp('ccrc-hist-merge-nodes-');
    store9.createStore(home);
    const db = store9.openWriter(lib9.historyPaths(home).dbFile);
    const U = ['e1000000-1111-4111-8111-111111111111', 'e2000000-2222-4222-8222-222222222222',
      'e3000000-3333-4333-8333-333333333333', 'e4000000-4444-4444-8444-444444444444'];
    const G = '0189abcd-1234-4678-9abc-0123456789ab';
    try {
      db.exec('BEGIN');
      db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, ?, '', 'demo', 1)").run(ID9);
      db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (2, ?, ?, 'demo', 2)").run(ID9, G);
      U.forEach((u, i) => { db.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (?, ?)').run(i + 1, u); });
      const ep = db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, ?, ?, 'startup', 'hook', 1)");
      ep.run(1, 1, U[0]!); ep.run(1, 2, U[1]!); ep.run(2, 1, U[2]!);
      const node = db.prepare("INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, parser_version, created_ms) VALUES (?, ?, ?, ?, ?, ?, 'ok', 1, 1)");
      node.run('L1aaaaaaaaaaaaaaaaaaaa', 1, 1, 1, 'native_leaf', 0);
      node.run('N1aaaaaaaaaaaaaaaaaaaa', 1, 1, 1, 'condensed', 1);
      node.run('L2aaaaaaaaaaaaaaaaaaaa', 1, 2, 2, 'native_leaf', 0);
      node.run('L3aaaaaaaaaaaaaaaaaaaa', 2, 1, 3, 'native_leaf', 0);
      node.run('L4aaaaaaaaaaaaaaaaaaaa', 1, 1, 4, 'native_leaf', 0);
      db.prepare('INSERT INTO node_children (node_id, child_id, ord) VALUES (?, ?, 0)').run('N1aaaaaaaaaaaaaaaaaaaa', 'L1aaaaaaaaaaaaaaaaaaaa');
      s.mergeFamily(db, 1, 2);
      db.exec('COMMIT');
      const where = (id: string): number[] => {
        const r = db.prepare('SELECT session_pk, epoch_seq FROM nodes WHERE node_id = ?').get(id) as { session_pk: number; epoch_seq: number };
        return [r.session_pk, r.epoch_seq];
      };
      v9.expect((db.prepare('SELECT seq, cc_session_uuid FROM epochs WHERE session_pk = 2 ORDER BY seq').all() as { seq: number; cc_session_uuid: string }[])
        .map((e) => [e.seq, e.cc_session_uuid])).toEqual([[1, U[0]], [2, U[1]], [3, U[2]]]);
      v9.expect(where('L1aaaaaaaaaaaaaaaaaaaa'), 'a leaf moves with its epoch').toEqual([2, 1]);
      v9.expect(where('N1aaaaaaaaaaaaaaaaaaaa'), 'a parent moves with its epoch').toEqual([2, 1]);
      v9.expect(where('L2aaaaaaaaaaaaaaaaaaaa')).toEqual([2, 2]);
      v9.expect(where('L3aaaaaaaaaaaaaaaaaaaa'), "(id, G)'s own epoch is renumbered after the merged ones").toEqual([2, 3]);
      v9.expect(where('L4aaaaaaaaaaaaaaaaaaaa'), 'no epoch holds its transcript: it stays').toEqual([1, 1]);
      v9.expect((db.prepare("SELECT n FROM counters WHERE name = 'nodes_unrepointed'").get() as { n: number }).n).toBe(1);
    } finally {
      db.close();
    }
  });
});
