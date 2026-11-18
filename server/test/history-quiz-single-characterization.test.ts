// The replay quiz's single-arm mode, Task 1 (Overlord W1a; plan 2026-11-17-overlord-quiz-record.md, term 1): what the
// new module `deploy/history-quiz-single.mjs` reuses from the W2 driver and the gate, and what it re-spells, pinned
// against `main`'s code BEFORE the module exists. Green on `main` first: every case reads the driver and the gate
// through their public surface only, so the export-only edit (Task 2) and the module (Tasks 3 to 6) cannot move a pin
// here without a red.
//
// ISOLATION: no driver subcommand runs here. The one store is a createStore store under a mkTmp HOME, written through
// store.mjs's own writer and read through the driver's openReplayStore. Nothing reads the live HOME.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import * as drvMod from '../../deploy/history-replay.mjs';
import * as gateMod from '../../deploy/history-gate.mjs';
import * as libMod from '../../ccd/history/lib.mjs';
import * as storeMod from '../../ccd/history/store.mjs';
import * as sweepMod from '../../ccd/history/sweep.mjs';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

type R = Record<string, any>;
const drv = drvMod as unknown as R;
const gate = gateMod as unknown as R;
const lib = libMod as unknown as R;
const store = storeMod as unknown as R;
const sweep = sweepMod as unknown as R;

removeTmpFixturesEachTest();

const SEED = lib.sha256Hex('quiz-single characterization seed') as string;
const ARMS: string[] = [...(lib.RECALL_ARMS as readonly string[])];
const TREATMENT = ARMS[1]!;

/** substream's recipe, written out here (plan §4, "The interval's generator"): the first 16 bytes of
 *  sha256Hex(seed + ':' + label), read as four little-endian u32 words, fed to xoshiro128ss. The single-arm module builds
 *  its interval stream this way under its own label, so this pin is what proves its generator follows the gate's. */
function recipe(seedHex: string, label: string): { nextU32: () => number } {
  const hex = lib.sha256Hex(`${seedHex}:${label}`) as string;
  const byte = (i: number): number => parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const word = (w: number): number => (byte(w * 4) | (byte(w * 4 + 1) << 8) | (byte(w * 4 + 2) << 16) | (byte(w * 4 + 3) << 24)) >>> 0;
  return gate.xoshiro128ss([word(0), word(1), word(2), word(3)]);
}
const draws = (rng: { nextU32: () => number }, n: number): number[] => Array.from({ length: n }, () => rng.nextU32());

describe('the frozen sets the single-arm mode must not move (terms 1 and 2)', () => {
  it('GATE_CODE_FILES is the four files W2\'s code check diffs, in this order', () => {
    expect([...gate.GATE_CODE_FILES]).toEqual(['deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs']);
    expect(gate.GATE_CODE_FILES, 'the module is not a gate code file').not.toContain('deploy/history-quiz-single.mjs');
  });

  it('the driver registers its sixteen subcommands, and no single-arm one', () => {
    expect([...drv.HANDLERS.keys()]).toEqual(['step0a', 'probe', 'pilot-source', 'quiz-source', 'freeze', 'power', 'open', 'verify', 'marker',
      'arms', 'judge', 'step0b', 'fidelity', 'pilot-result', 'handcheck', 'report']);
  });

  it('the arm words come by position: control first, treatment (recall on) second', () => {
    expect(ARMS).toHaveLength(2);
    expect(drv.CONTROL_ARM).toBe(ARMS[0]);
    expect(drv.TREATMENT_ARM).toBe(TREATMENT);
    expect(drv.ARM_ATTEMPTS_MAX).toBe(2);
  });

  it('BOOTSTRAP fixes the interval the report carries: 95, percentile, B 10000', () => {
    expect({ ci: gate.BOOTSTRAP.ci, method: gate.BOOTSTRAP.method, B: gate.BOOTSTRAP.B }).toEqual({ ci: 95, method: 'percentile', B: 10000 });
  });
});

describe('the interval\'s generator follows substream\'s recipe (plan §4, F1)', () => {
  it('the recipe written out here draws exactly substream(seed, quiz-ci)\'s words', () => {
    expect(draws(recipe(SEED, 'quiz-ci'), 64)).toEqual(draws(gate.substream(SEED, 'quiz-ci'), 64));
  });

  it('the module\'s own label is not a substream label: substream refuses it, and its stream is none of theirs', () => {
    expect(() => gate.substream(SEED, 'quiz-single-ci')).toThrow(RangeError);
    const mine = draws(recipe(SEED, 'quiz-single-ci'), 8);
    for (const label of gate.SUBSTREAMS as string[]) expect(draws(gate.substream(SEED, label), 8), label).not.toEqual(mine);
  });

  it('clusterBootstrap in share mode answers a pooled point and a nearest-rank interval, fixed by its stream', () => {
    const clusters = [{ num: 3, den: 4 }, { num: 5, den: 5 }, { num: 0, den: 2 }, { num: 7, den: 9 }, { num: 1, den: 3 }];
    expect(gate.clusterBootstrap({ clusters, rng: gate.substream(SEED, 'quiz-ci'), mode: 'share' })).toEqual({
      point: { num: 16, den: 23 }, lower: { num: 5, den: 14 }, upper: { num: 19, den: 22 } });
    expect(gate.clusterBootstrap({ clusters, B: 200, rng: recipe(SEED, 'quiz-ci'), mode: 'share' }), 'the recipe stream gives substream\'s answer').toEqual({
      point: { num: 16, den: 23 }, lower: { num: 5, den: 14 }, upper: { num: 18, den: 21 } });
    expect(() => gate.clusterBootstrap({ clusters: [{ num: 0, den: 0 }], rng: recipe(SEED, 'quiz-ci'), mode: 'share' }), 'no measured cluster: no statistic').toThrow(RangeError);
  });
});

describe('scoring an answer (W2-D63, W2-D64)', () => {
  it('parseAnswerField reads the last ANSWER line, trims it, and keeps unknown and absent apart', () => {
    expect(gate.parseAnswerField('ANSWER: 9c0ffee1')).toEqual({ state: 'value', value: '9c0ffee1' });
    expect(gate.parseAnswerField('ANSWER: UNKNOWN')).toEqual({ state: 'unknown' });
    expect(gate.parseAnswerField('no answer here')).toEqual({ state: 'absent' });
    expect(gate.parseAnswerField('ANSWER:   npm run x  ')).toEqual({ state: 'value', value: 'npm run x' });
    expect(gate.parseAnswerField('ANSWER: a\nANSWER: b')).toEqual({ state: 'value', value: 'b' });
  });

  it('labelCorrect matches a sha at the prefix floor, a command exactly, and a path under a repo root', () => {
    const o = { repoRoots: ['/home/u/tree'], shaMinPrefix: 7 };
    expect(gate.labelCorrect('sha', '9c0ffee1aa', '9c0ffee', o)).toBe(true);
    expect(gate.labelCorrect('sha', '9c0ffee1aa', '9c0ffe', o), 'below the floor').toBe(false);
    expect(gate.labelCorrect('command', 'npm run x', 'npm run x', { repoRoots: [], shaMinPrefix: 7 })).toBe(true);
    expect(gate.labelCorrect('path', '/home/u/tree/a.ts', 'a.ts', o)).toBe(true);
  });

  it('armAnswerOf keeps absent apart and scores only a value', () => {
    const entry = { kind: 'sha', fact: '9c0ffee1aa', repo_roots: ['/home/u/tree'] };
    const of = (text: string | null): R => drv.armAnswerOf(entry, { result: text === null ? null : { text }, toolPairs: [] }, 7);
    expect(of('ANSWER: 9c0ffee')).toMatchObject({ correct: true, absent: false, answer_field: { state: 'value' } });
    expect(of('ANSWER: UNKNOWN')).toMatchObject({ correct: false, absent: false, answer_field: { state: 'unknown' } });
    expect(of('nothing')).toMatchObject({ correct: false, absent: true, answer_field: { state: 'absent' } });
    expect(of(null)).toMatchObject({ correct: false, absent: true, reply: null });
  });
});

// ── the treatment payload on a fixture store (the arms reuse armPayloads unchanged) ─────────────────────────────────
const T_N = 1_760_000_000_000;
const UUID = (n: number): string => `c1a20000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const CC = UUID(0xcc1);
const GEN = UUID(0x6e1);
const LEAF = 'La1b2c3d4e5f6a7b8c9d0';
const PARENT = 'N0f1e2d3c4b5a69788796';
const QUESTION = 'Which npm command built the fixture card?';
const CMD = 'npm run fixture-card --workspace pkg-a';
type RowSpec = { key: string; type: string; provenance: string; ts: number; body: unknown; model?: string; summary?: boolean };
const text = (t: string): unknown[] => [{ type: 'text', text: t }];
const ROWS: RowSpec[] = [
  { key: 'u1', type: 'user', provenance: 'operator', ts: T_N - 50_000, body: text('build the fixture card') },
  { key: 'a1', type: 'assistant', provenance: 'model', model: 'claude-fixture-4', ts: T_N - 40_000,
    body: [{ type: 'tool_use', id: 'toolu_qs1', name: 'Bash', input: { command: CMD } }] },
  { key: 'r1', type: 'user', provenance: 'tool', ts: T_N - 30_000, body: [{ type: 'tool_result', tool_use_id: 'toolu_qs1', content: 'card build ok' }] },
  { key: 'bn', type: 'system', provenance: 'harness', ts: T_N, body: text('compact boundary one') },
  { key: 'sn', type: 'user', provenance: 'summary', summary: true, ts: T_N + 10, body: text('Summary: the fixture card build ran.') },
];

/** One family, one transcript, one boundary N with its summary, kept list [r1] and a depth-0 leaf with no parent: the
 *  smallest store armPayloads builds both payloads from. */
async function plantStore(): Promise<{ home: string; entry: Record<string, number>; uuid: Record<string, string> }> {
  const home = mkTmp('ccrc-quiz-single-char-');
  store.createStore(home);
  const w = store.openWriter(lib.historyPaths(home).dbFile) as DatabaseSync;
  store.createFtsTables(w);
  const idx0 = lib.makePairIndex([]);
  w.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, 'fam-a', ?, 'demo', 1)").run(GEN);
  w.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, cwd, confirmed_ms) VALUES (1, 1, ?, 'startup', 'hook', '/home/u/tree', 1)").run(CC);
  w.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?)').run(CC);
  w.prepare("INSERT INTO ingest_files (file_id, dev, ino, source_key, transcript_pk, status, parser_version) VALUES (1, 1, 7301, '', 1, 'live', 1)").run();
  const blobOf = (bytes: Buffer): number => Number((w.prepare('INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, ?, ?, ?) RETURNING blob_id')
    .get(createHash('sha256').update(bytes).digest(), store.CODEC, store.brotli(bytes), bytes.length) as { blob_id: number | bigint }).blob_id);
  const ent = w.prepare(`INSERT INTO entries (uuid, transcript_pk, type, model, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms,
      is_compact_summary) VALUES (?, 1, ?, ?, ?, 1, ?, 1, ?, ?, ?) RETURNING entry_id`);
  const member = w.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (1, ?, ?)');
  const entry: Record<string, number> = {};
  const uuid: Record<string, string> = {};
  const blob: Record<string, number> = {};
  for (const [i, r] of ROWS.entries()) {
    const bytes = Buffer.from(lib.canonicalJson(r.body) as string);
    const blobId = blobOf(bytes);
    const u = UUID(i + 1);
    const id = Number((ent.get(u, r.type, r.model ?? null, r.provenance, i, blobId, r.ts, r.summary === true ? 1 : 0) as { entry_id: number | bigint }).entry_id);
    member.run(id, i + 1);
    entry[r.key] = id;
    uuid[r.key] = u;
    blob[r.key] = blobId;
    if ((lib.INDEXED_PROVENANCE as string[]).includes(r.provenance)) {
      const z = (w.prepare('SELECT z FROM blobs WHERE blob_id = ?').get(blobId) as { z: Uint8Array }).z;
      const t = await sweep.ftsTextOfBlob(z, false, idx0, bytes.length);
      sweep.indexBlob(w, blobId, t.text ?? '', idx0, t.overCap === true);
    }
  }
  const keptId = blobOf(Buffer.from(JSON.stringify([uuid.r1])));
  w.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord, anchor_uuid, kept_blob_id) VALUES (?, 1, 1, ?, ?)').run(entry.bn!, uuid.sn!, keptId);
  w.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, summary_blob_id, boundary_entry_id,
      parser_version, created_ms) VALUES (?, 1, 1, 1, 'native_leaf', 0, 'final', ?, ?, 1, ?)`).run(LEAF, blob.sn!, entry.bn!, T_N + 100);
  w.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, summary_blob_id, boundary_entry_id,
      parser_version, created_ms) VALUES (?, 1, 1, 1, 'condensed', 1, 'final', NULL, NULL, 1, ?)`).run(PARENT, T_N + 200);
  w.prepare('INSERT INTO node_children (node_id, child_id, ord) VALUES (?, ?, 0)').run(PARENT, LEAF);
  w.prepare('INSERT INTO node_sources (node_id, entry_id, ord) VALUES (?, ?, 0)').run(LEAF, entry.a1!);
  w.prepare('INSERT INTO node_sources (node_id, entry_id, ord) VALUES (?, ?, 1)').run(LEAF, entry.r1!);
  store.closeWriter(w);
  return { home, entry, uuid };
}

describe('the treatment arm\'s payload (W2-D50, Q20): armPayloads, reused unchanged', () => {
  it('the carded payload is the card line, one blank line, then the plain payload, which is W2-5a\'s composer output', async () => {
    const fx = await plantStore();
    const rs = drv.openReplayStore(fx.home);
    try {
      const c = drv.armCut(rs, fx.uuid.bn);
      if (!c.ok) throw new Error(`fixture: no cut at N: ${String(c.reason)}`);
      const p = drv.armPayloads(rs, fx.entry.bn, QUESTION, c.cut);
      if (p.state !== 'payloads') throw new Error(`fixture: payloads discarded ${String(p.why)}`);
      const plain = drv.composePayload({ summary: 'Summary: the fixture card build ran.', kept: ['[tool_result] card build ok'] }, QUESTION);
      expect(p.plain).toBe(plain);
      expect(p.carded).toBe(`${p.card.line as string}\n\n${plain}`);
      const ell = String.fromCharCode(0x2026);
      const dot = String.fromCharCode(0xb7);
      expect(p.card.line, 'spec 8.6\'s grammar, written out').toBe(`History: node La1b2c3${ell} (this compaction) ${dot} parent N0f1e2d${ell} ${dot} ~/.local/bin/ccrc history describe La1b2c3`);
      expect(p.carded).toBe(drv.prependCard(p.card.line, plain));
    } finally {
      rs.close();
    }
  });
});

// ── the frozen list, written and read by the driver's own code ──────────────────────────────────────────────────────
const OPUS = 'claude-opus-9-1';
function entryOf(n: number): R {
  const fact = (0xbd40000 + n).toString(16);
  const e = { store_id: '00000000-0000-4000-8000-0000000004a1', ccrc_id: 'quiz-a', generation: UUID(0x410), boundary_uuid: UUID(0x8400 + n),
    kind: 'sha', fact, fact_raw: fact, question: `Which commit did fixture step ${n} record?`, source_entry_uuid: UUID(0x9400 + n), repo_roots: ['/home/u/tree'] };
  return { ...e, qid: drv.qidOf(e) as string };
}

describe('the frozen list (W2-D73): frozenListText and loadFrozenList round-trip, kind ccrc-history-w2-quiz', () => {
  it('the text loadFrozenList reads back is the list the text gave, sha checked first', () => {
    const head = { writer_model: OPUS, labeller: { ...gate.LABELLER, sha_min_prefix: 7 } };
    const textOf = drv.frozenListText('quiz', head, [entryOf(2), entryOf(1)]) as string;
    const dir = mkTmp('ccrc-quiz-single-char-frozen-');
    const p = join(dir, 'frozen.json');
    writeFileSync(p, textOf, { mode: 0o600 });
    const doc = drv.loadFrozenList(p, lib.sha256Hex(textOf), 'quiz');
    expect(doc.kind).toBe('ccrc-history-w2-quiz');
    expect(doc.entries.map((e: R) => e.qid)).toEqual([entryOf(1), entryOf(2)].map((e) => e.qid).sort());
    expect(() => drv.loadFrozenList(p, lib.sha256Hex(`${textOf} `), 'quiz')).toThrow(/quiz-sha-mismatch/);
    expect(drv.familiesOf(doc.entries)).toEqual([{ store_id: '00000000-0000-4000-8000-0000000004a1', ccrc_id: 'quiz-a', generation: UUID(0x410) }]);
  });
});

// ── the shapes the single-arm module re-spells (plan §4, "What it still re-spells") ─────────────────────────────────
describe('the shapes the module re-spells for one arm, as the driver\'s builders write them for the quiz section', () => {
  it('armsSummaryOf: its keys, a per-arm block for BOTH arms, and question counts over every state', () => {
    const answer = (correct: boolean, state: string): R => ({ answer_field: { state }, correct, uptake: { calls: 1, via_agent: 0, errored: 0 } });
    const s = drv.armsSummaryOf({ section: 'quiz', recordSha256: 'r'.repeat(64), storeId: 'store-a', budget: { in_force: 10 }, spend: 3, batches: 1,
      stop: null, stamps: [], questions: [
        { qid: 'q1', state: 'answered', arms: ARMS.map((arm) => ({ arm, answer: answer(true, 'value') })) },
        { qid: 'q2', state: 'run-failed', arms: ARMS.map((arm) => ({ arm, answer: null })) },
      ] });
    expect(Object.keys(s).sort()).toEqual(['absent_rate', 'arms', 'batches', 'budget', 'counts', 'kind', 'questions', 'record_sha256', 'section', 'spend', 'stamps', 'stop', 'store_id', 'v']);
    expect(s.kind).toBe('ccrc-history-w2-arms-summary');
    expect(Object.keys(s.arms).sort(), 'both arms, always: the module writes its own one-arm summary').toEqual([...ARMS].sort());
    expect(Object.keys(s.arms[TREATMENT]).sort()).toEqual(['absent', 'answered', 'correct', 'errored', 'unknown', 'uptake_calls', 'uptake_questions', 'value', 'via_agent']);
    expect(s.counts).toEqual({ questions: 2, answered: 1, run_failed: 1, rerun_owed: 0, not_run: 0 });
    expect(drv.armsSummaryRel('quiz')).toBe('quiz/arms/summary.json');
  });

  it('judgeTallyOf: per arm, both arms, and none of the counts the single-arm report needs', () => {
    const t = drv.judgeTallyOf([{ id: 'j0001', arm: TREATMENT, key: 'k', judgeFailed: false, label: 'uncertain' }], [], new Set(), new Set());
    expect(Object.keys(t).sort()).toEqual([...ARMS].sort());
    expect(Object.keys(t[TREATMENT]).sort()).toEqual(['fabricated', 'judge_failed', 'judge_failed_unlabelled', 'judged', 'sampled', 'uncertain']);
    expect(t[TREATMENT]).not.toHaveProperty('answered');
    expect(t[TREATMENT]).not.toHaveProperty('run_failed');
  });

  it('the W2 kinds the reused writers stamp, and the judged file\'s kind the module does not reuse', () => {
    expect([drv.ANSWER_KIND, drv.ARMS_SUMMARY_KIND, drv.ARM_BATCH_KIND, drv.JUDGED_KIND, drv.JUDGE_MAP_KIND])
      .toEqual(['ccrc-history-w2-answer', 'ccrc-history-w2-arms-summary', 'ccrc-history-w2-arm-batch', 'ccrc-history-w2-judged', 'ccrc-history-w2-judge-map']);
    expect(drv.answerRel('quiz', 'q1', TREATMENT)).toBe(`quiz/answers/q1.${TREATMENT}.json`);
    expect(drv.armRunName('quiz', 'q1', TREATMENT, 1)).toBe(`quiz/arms/q1/${TREATMENT}.a1`);
  });

  it('judgeMapOf over one arm names one id per question, j and four digits, on the judge-order stream', () => {
    const map = drv.judgeMapOf(SEED, [{ qid: 'q2' }, { qid: 'q1' }], [TREATMENT]);
    expect(map.map((m: R) => m.arm)).toEqual([TREATMENT, TREATMENT]);
    expect(map.map((m: R) => m.qid).sort()).toEqual(['q1', 'q2']);
    expect(map.map((m: R) => m.id)).toEqual(['j0001', 'j0002']);
  });
});
