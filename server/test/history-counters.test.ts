// server/test/history-counters.test.ts
// ccrc history W3 (plan 2026-10-29-ccrc-history-w3-steering.md, Task 1D): the read-only spike report of
// deploy/history-counters.mjs (`spikeReport` and the `spike` arm; spec §7.5, O5, O12, O13, O17 to O23). The W2-6 cases
// stay in history-replay.test.ts's w6c block; this file keeps the spike's cases out of that hot file.
//
// Every store is a createStore store under a mkTmp HOME, planted in one transaction with the stored shapes derive and
// ingest write (a hand-built store, as the w6c block builds its own): one session per `Sess`, one transcript, one live
// copy, and for each span its boundary row, its summary row, an optional echo row, its first reply and its leaf. Every
// span stores its first reply before its leaf is derived, so the producer is the same at derivation and at report time,
// unless a case says otherwise. Accounts are never named: the sessions are `cohort`, `base-1` and the like. Nothing
// spawns a model, reads the live HOME or writes outside its own trees.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as ctrMod from '../../deploy/history-counters.mjs';
import * as gateMod from '../../deploy/history-gate.mjs';
import * as drvMod from '../../deploy/history-replay.mjs';
import * as storeMod from '../../ccd/history/store.mjs';
import { historyPaths } from '../../ccd/history/lib.mjs';
import { mkTmp } from './tmpHelpers.js';

type R = Record<string, any>;
const ctr = ctrMod as unknown as R;
const store = storeMod as unknown as R;
const gate = gateMod as unknown as R;
const drv = drvMod as unknown as R;

const T0 = 1_800_000_000_000;
const SINCE = T0;
const UNTIL = T0 + 1_000_000;
const MODEL_A = 'claude-fixture-4';
const MODEL_O = 'gpt-fixture-1';
/** What Claude Code stores of a summary whose `<summary>` pair closed (G11): no tag survives. */
const CLOSED = 'Summary:\nA closed summary, normalised by Claude Code.';
const UNCLOSED_SUMMARY = '<summary>\nA summary that was never closed.';
const nid = (key: string): string => `L${createHash('sha1').update(key).digest('hex').slice(0, 20)}`;
const blockOf = (key: string, closed = true): string => `<ccrc-leaf id="${nid(key)}" v="1">\ngist: a block for ${key}, long enough to be read as a gist\n${closed ? '</ccrc-leaf>' : ''}`;
const uuidOf = (n: number): string => `0189abcd-1234-4678-9abc-${n.toString(16).padStart(12, '0')}`;

interface Span {
  key: string;
  /** The boundary's `ts_ms`; default: 1 s after the session's previous span (the first at T0 + 1 s). */
  ts?: number | null;
  trigger?: 'manual' | 'auto';
  /** `boundaries.duration_ms`; default 1000. */
  duration?: number | null;
  preTokens?: number | null;
  /** The summary's stored text; default CLOSED. */
  text?: string;
  /** `text`: a readable summary; `tombstone`: its blob pruned; `oversize`: recorded past the decode bound; `missing`: the leaf names no summary blob (a raw leaf). */
  summary?: 'text' | 'tombstone' | 'oversize' | 'missing';
  /** The model of the first assistant row after the summary; null stores no reply. Default MODEL_A. */
  model?: string | null;
  replyTs?: number;
  /** The leaf's stored status; default `not-requested`. */
  status?: string;
  leaf?: 'one' | 'none' | 'two';
  parserVersion?: number;
  createdMs?: number;
  gist?: string;
  refs?: Array<[string, string, string]>;
  /** The whole text length of a `<local-command-stdout>` row stored after the summary. */
  echo?: number;
  /** The echo row's whole text, when a case needs particular characters (it overrides `echo`). */
  echoText?: string;
}
interface Sess {
  id: string;
  spans: Span[];
  /** false stores the session's epoch unconfirmed (derive leaves its boundaries waiting); default true. */
  confirmed?: boolean;
}
interface Receipt { session: string; leaf: string; ts: number; source?: 'line' | 'received' }
interface Plan {
  sessions: Sess[];
  receipts?: Receipt[];
  /** [ts_ms, files_behind] per ticks row; default one row with nothing behind. */
  ticks?: Array<[number, number]>;
  counters?: Record<string, number>;
}
interface Planted {
  home: string; dbFile: string;
  spans: Map<string, { entryId: number; transcriptPk: number; fileId: number; ts: number | null }>;
}

const ccUuidOf = (n: number): string => uuidOf(0x1000 + n);

/** A store made by createStore, planted in one transaction (see the header) and closed. */
function plant(plan: Plan): Planted {
  const home = mkTmp('ccrc-counters-spike-');
  store.createStore(home);
  const dbFile = historyPaths(home).dbFile as string;
  const db = store.openWriter(dbFile);
  const spans: Planted['spans'] = new Map();
  try {
    db.exec('BEGIN');
    const blob = db.prepare('INSERT INTO blobs (sha256, codec, z, raw_len, pruned_ms) VALUES (?, ?, ?, ?, ?) RETURNING blob_id');
    const blobOf = (tag: string, body: unknown, o: { tomb?: boolean; rawLen?: number } = {}): number => {
      const bytes = Buffer.from(JSON.stringify(body ?? null));
      const r = blob.get(createHash('sha256').update(tag).digest(), store.CODEC, o.tomb === true ? null : store.brotli(bytes),
        o.rawLen ?? bytes.length, o.tomb === true ? 1 : null) as { blob_id: number | bigint };
      return Number(r.blob_id);
    };
    const ent = db.prepare(`INSERT INTO entries (uuid, transcript_pk, type, model, provenance, prov_version, struct_rank_ns,
      struct_file_id, blob_id, ts_ms, is_compact_summary) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?) RETURNING entry_id`);
    const mem = db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)');
    const bnd = db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord, trigger, anchor_uuid, pre_tokens, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const node = db.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, summary_blob_id,
      boundary_entry_id, parser_version, created_ms) VALUES (?, ?, 1, ?, ?, 0, ?, ?, ?, ?, ?, ?)`);
    const ref = db.prepare('INSERT INTO node_refs (node_id, kind, value, origin) VALUES (?, ?, ?, ?)');
    const PROV = 1;
    plan.sessions.forEach((s, si) => {
      const pk = si + 1;
      const cc = ccUuidOf(pk);
      db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (?, ?, '', 'demo', 1)").run(pk, s.id);
      db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, 1, ?, 'startup', 'hook', ?)").run(pk, cc, s.confirmed === false ? null : 1);
      db.prepare("INSERT INTO transcripts (transcript_pk, cc_session_uuid, agent_id) VALUES (?, ?, '')").run(pk, cc);
      db.prepare("INSERT INTO ingest_files (file_id, dev, ino, source_key, transcript_pk, status, parser_version) VALUES (?, 1, ?, '', ?, 'live', 1)").run(pk, 8000 + pk, pk);
      let line = 0;
      let prevTs = T0;
      s.spans.forEach((sp, k) => {
        const ts = sp.ts === undefined ? prevTs + 1000 : sp.ts;
        if (ts !== null) prevTs = ts;
        const at = ts ?? T0;
        const tag = `${s.id}/${sp.key}`;
        const put = (uuid: string, type: string, model: string | null, prov: string, b: number, t: number | null, summary = 0): number => {
          const id = Number((ent.get(uuid, pk, type, model, prov, PROV, b, t, summary) as { entry_id: number | bigint }).entry_id);
          line += 1;
          mem.run(pk, id, line);
          return id;
        };
        const bId = put(`b-${tag}`, 'system', null, 'harness', blobOf(`b-${tag}`, { subtype: 'compact_boundary' }), ts);
        bnd.run(bId, pk, k + 1, sp.trigger ?? 'auto', `s-${tag}`, sp.preTokens === undefined ? 160_000 : sp.preTokens, sp.duration === undefined ? 1000 : sp.duration);
        const how = sp.summary ?? 'text';
        const sBlob = blobOf(`s-${tag}`, sp.text ?? CLOSED, how === 'tombstone' ? { tomb: true } : how === 'oversize' ? { rawLen: 2 ** 40 } : {});
        put(`s-${tag}`, 'user', null, 'summary', sBlob, ts === null ? null : ts + 1, 1);
        if (sp.echo !== undefined || sp.echoText !== undefined) {
          const open = '<local-command-stdout>';
          const close = '</local-command-stdout>';
          const body = sp.echoText ?? `${open}${'e'.repeat((sp.echo ?? 0) - open.length - close.length)}${close}`;
          put(`e-${tag}`, 'user', null, 'harness', blobOf(`e-${tag}`, body), at + 2);
        }
        if (sp.model !== null) put(`a-${tag}`, 'assistant', sp.model ?? MODEL_A, 'model', blobOf(`a-${tag}`, [{ type: 'text', text: 'ok' }]), sp.replyTs ?? at + 3);
        spans.set(sp.key, { entryId: bId, transcriptPk: pk, fileId: pk, ts });
        const which = sp.leaf ?? 'one';
        if (which !== 'none') {
          const status = sp.status ?? 'not-requested';
          const kind = how === 'missing' ? 'raw_leaf' : status === 'ok' || status === 'degraded' ? 'steered_leaf' : 'native_leaf';
          for (const id of which === 'two' ? [nid(sp.key), nid(`${sp.key}/2`)] : [nid(sp.key)]) {
            node.run(id, pk, pk, kind, status, sp.gist ?? null, how === 'missing' ? null : sBlob, bId, sp.parserVersion ?? 1, sp.createdMs ?? T0 + 50_000_000);
          }
          for (const [rk, rv, ro] of sp.refs ?? []) ref.run(nid(sp.key), rk, rv, ro);
        }
      });
    });
    const sr = db.prepare('INSERT INTO steer_receipts (event_key, ccrc_id, cc_session_uuid, leaf_id, ts_ms) VALUES (?, ?, ?, ?, ?)');
    const sp = db.prepare('INSERT INTO spool_receipts (event_key, payload_sha, received_ms, ts_ms, ts_source) VALUES (?, ?, ?, ?, ?)');
    (plan.receipts ?? []).forEach((r, i) => {
      const si = plan.sessions.findIndex((s) => s.id === r.session);
      const key = `r${i}`;
      sr.run(key, r.session, ccUuidOf(si + 1), r.leaf === '' ? '' : nid(r.leaf), r.ts);
      sp.run(key, createHash('sha256').update(key).digest(), r.ts, r.ts, r.source ?? 'line');
    });
    const tick = db.prepare('INSERT INTO ticks (tick_id, ts_ms, lag_ms, bytes, files_behind, bytes_behind) VALUES (?, ?, 0, 0, ?, 0)');
    (plan.ticks ?? [[T0, 0]]).forEach(([t, behind], i) => { tick.run(i + 1, t, behind); });
    for (const [name, n] of Object.entries(plan.counters ?? {})) db.prepare('INSERT INTO counters (name, n) VALUES (?, ?)').run(name, n);
    db.exec('COMMIT');
  } finally {
    store.closeWriter(db);
  }
  return { home, dbFile, spans };
}

/** One assistant row stored after a span's summary, at the end of the span's copy (the span must be the copy's last). */
function addReply(p: Planted, key: string, model: string, ts: number): void {
  const sp = p.spans.get(key)!;
  const db = store.openWriter(p.dbFile);
  try {
    db.exec('BEGIN');
    const bytes = Buffer.from(JSON.stringify([{ type: 'text', text: 'late' }]));
    const b = db.prepare('INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, ?, ?, ?) RETURNING blob_id')
      .get(createHash('sha256').update(`late-${key}`).digest(), store.CODEC, store.brotli(bytes), bytes.length) as { blob_id: number | bigint };
    const e = db.prepare(`INSERT INTO entries (uuid, transcript_pk, type, model, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms, is_compact_summary)
      VALUES (?, ?, 'assistant', ?, 'model', 1, 0, 0, ?, ?, 0) RETURNING entry_id`).get(`late-${key}`, sp.transcriptPk, model, Number(b.blob_id), ts) as { entry_id: number | bigint };
    const top = db.prepare('SELECT max(line) AS m FROM memberships WHERE file_id = ?').get(sp.fileId) as { m: number };
    db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)').run(sp.fileId, Number(e.entry_id), Number(top.m) + 1);
    db.exec('COMMIT');
  } finally {
    store.closeWriter(db);
  }
}

/** Removes rows from a planted store, as a store that lost them would stand (one statement, then closed). */
function remove(p: Planted, sql: string, ...args: Array<number | string>): void {
  const db = store.openWriter(p.dbFile);
  try {
    db.prepare(sql).run(...args);
  } finally {
    store.closeWriter(db);
  }
}

/** A parent node over planted leaves (a `condensed` row at `depth`, its node_children in the order given), as derive stores one. */
function addParent(p: Planted, parentKey: string, childKeys: string[], depth = 1): void {
  const db = store.openWriter(p.dbFile);
  try {
    db.exec('BEGIN');
    const first = db.prepare('SELECT session_pk, epoch_seq, transcript_pk FROM nodes WHERE node_id = ?').get(nid(childKeys[0])) as R;
    db.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, parser_version, created_ms)
      VALUES (?, ?, ?, ?, 'condensed', ?, 'ok', 'a rollup', 1, ?)`).run(nid(parentKey), Number(first.session_pk), Number(first.epoch_seq), Number(first.transcript_pk), depth, T0 + 50_000_000);
    childKeys.forEach((k, i) => { db.prepare('INSERT INTO node_children (node_id, child_id, ord) VALUES (?, ?, ?)').run(nid(parentKey), nid(k), i + 1); });
    db.exec('COMMIT');
  } finally {
    store.closeWriter(db);
  }
}

interface Opts { sessions?: string[]; since?: number; until?: number }
/** spikeReport over a planted store, through the counter's own read-only open. */
function spike(p: Planted, o: Opts = {}): R {
  const rs = ctr.openCounterStore(p.dbFile);
  try {
    return ctr.spikeReport({ db: rs.db, sessions: o.sessions ?? ['cohort'], sinceMs: o.since ?? SINCE, untilMs: o.until ?? UNTIL }) as R;
  } finally {
    rs.close();
  }
}
const run = (plan: Plan, o: Opts = {}): R => spike(plant(plan), o);
const one = (spans: Span[], more: Partial<Plan> = {}): Plan => ({ sessions: [{ id: 'cohort', spans }], ...more });
const S = (key: string, over: Partial<Span> = {}): Span => ({ key, ...over });
const A = (r: R): R => r.perBackend.anthropic;

describe('the spike report (spec 7.5; W3 Task 1D)', () => {
  it('spike reports compliance by producer', () => {
    const r = run(one([
      S('a1', { status: 'ok' }), S('a2', { status: 'degraded' }), S('a3', { status: 'invalid' }),
      S('o1', { status: 'ok', model: MODEL_O }), S('o2', { status: 'absent', model: MODEL_O }),
    ]));
    expect(A(r).compliance.receipted).toBe(3);
    expect(A(r).compliance.all.status).toMatchObject({ ok: 1, degraded: 1, invalid: 1, absent: 0 });
    expect(A(r).compliance.all.ok_degraded).toEqual({ num: 2, den: 3 });
    expect(r.perBackend.other.compliance.receipted).toBe(2);
    expect(r.perBackend.other.compliance.all.ok_degraded).toEqual({ num: 1, den: 2 });
    expect(r.perBackend.unknown.population.spans).toBe(0);
  });

  it('spike excludes unreceipted spans from compliance', () => {
    const r = run(one([S('r1', { status: 'ok' }), S('r2', { status: 'absent' }), S('n1'), S('n2'), S('n3')]));
    expect(A(r).population.spans).toBe(5);
    expect(A(r).population.notRequested).toBe(3);
    expect(A(r).compliance.receipted).toBe(2);
    expect(A(r).compliance.all.ok_degraded).toEqual({ num: 1, den: 2 });
  });

  it('spike counts a stale print as multiReceipt, and a generic receipt beside the two exact ones is not counted', () => {
    const r = run(one([S('a', { status: 'ok' }), S('b', { status: 'ok' }), S('c')], {
      receipts: [
        { session: 'cohort', leaf: 'a', ts: T0 + 500 }, { session: 'cohort', leaf: 'a', ts: T0 + 600 },
        { session: 'cohort', leaf: 'b', ts: T0 + 1500 }, { session: 'cohort', leaf: '', ts: T0 + 1600 },
      ],
    }));
    expect(A(r).multiReceipt).toBe(1);
  });

  it('spike counts a late exact receipt, and reports compliance with and without its span', () => {
    const r = run(one([S('fresh', { status: 'ok' }), S('late', { status: 'absent' })], {
      // fresh's boundary is at T0 + 1000 and its receipt before it; late's is at T0 + 2000 and its receipt after it. No later span's window holds it.
      receipts: [{ session: 'cohort', leaf: 'fresh', ts: T0 + 500 }, { session: 'cohort', leaf: 'late', ts: T0 + 2500 }],
    }));
    expect(A(r).lateReceipts.count).toBe(1);
    expect(A(r).lateReceipts.unmeasured.count).toBe(0);
    expect(A(r).compliance.all.status).toMatchObject({ absent: 1, ok: 1 });
    expect(A(r).compliance.all.ok_degraded).toEqual({ num: 1, den: 2 });
    expect(A(r).compliance.withoutLate.status).toMatchObject({ absent: 0, ok: 1 });
    expect(A(r).compliance.withoutLate.ok_degraded).toEqual({ num: 1, den: 1 });
  });

  it('spike reports contamination beside headroom', () => {
    const r = run(one([S('s1', { status: 'ok' }), S('s2', { text: `Summary:\nX\n${blockOf('s2', false)}` })], {
      receipts: [{ session: 'cohort', leaf: 's1', ts: T0 + 500 }, { session: 'cohort', leaf: 's1', ts: T0 + 1500 }],
    }));
    const f = A(r);
    expect(f.stalePrint.count).toBe(1);
    expect(f.multiReceipt).toBe(1);
    expect(f.lateReceipts.count).toBe(0);
    expect(f.run.sweep).toMatchObject({ state: 'caught-up', filesBehind: 0 });
    expect(f.population.notRequested).toBe(1);
    // the span reads not-requested, so its unclosed block is never tested: unmeasured, never "no cut shape"
    expect(f.cutShapes.unmeasured).toEqual({ count: 1, why: { 'stale-print': 1 } });
    expect(f.cutShapes.count).toBe(0);
    expect(f.cutShapes.state).toBe('unmeasured');
    // and it is outside O19's receipted share
    expect(f.summaryUnclosed.unmeasured.count).toBe(0);
    expect(f.summaryUnclosed.of).toBe(1);
  });

  it('spike reports the stored model refs per steered leaf, and the ok leaves with none', () => {
    const m = (v: string): [string, string, string] => ['path', v, 'model'];
    const r = run(one([
      S('x', { status: 'ok', refs: [m('a.ts'), m('b.ts'), ['path', 'c.ts', 'tool_use']] }),
      S('y', { status: 'ok', refs: [m('a.ts'), m('b.ts'), m('c.ts'), m('d.ts')] }),
      S('z', { status: 'ok' }),
      S('native'),
    ]));
    expect(A(r).modelRefs).toEqual({ leaves: 3, p50: 2, okWithNone: 1 });
  });

  it('spike takes no figure from a node-wide counter', () => {
    const r = run(one([S('a', { status: 'ok' }), S('b', { status: 'ok' }), S('c', { status: 'degraded' })], {
      counters: { 'summary_unclosed:anthropic': 5, 'analysis_only:anthropic': 3, 'leaf_reason:no-block:anthropic': 7 },
    }));
    const f = A(r);
    expect([f.summaryUnclosed.state, f.summaryUnclosed.count, f.summaryUnclosed.of]).toEqual(['measured', 0, 3]);
    expect([f.analysisOnly.state, f.analysisOnly.count]).toEqual(['measured', 0]);
    expect(f.reasons['no-block']).toBe(0);
    // O18 lets the node-wide reason counters print beside the reasons; this report prints none (the W2-D87 census in
    // history-replay.test.ts refuses any line of the counter that reads the table), so no counter reaches the output
    expect(JSON.stringify(r)).not.toMatch(/leaf_reason|node-wide/);
  });

  it('spike measures summary_unclosed per leaf from the stored summary', () => {
    const r = run(one([
      S('open', { status: 'ok', text: '<summary>A' }),
      S('closed', { status: 'ok', text: 'Summary:\nA' }),
      S('twice', { status: 'ok', text: 'Summary:\nA<summary>B' }),
    ]));
    expect(A(r).summaryUnclosed).toMatchObject({ count: 2, of: 3, share: { num: 2, den: 3 } });
  });

  it('spike never reads an unreadable summary as closed', () => {
    const r = run(one([
      S('tomb', { status: 'absent', summary: 'tombstone' }),
      S('big', { status: 'ok', summary: 'oversize' }),
      S('raw', { summary: 'missing' }),
    ]));
    const f = A(r);
    expect(f.summaryUnclosed.unmeasured).toEqual({ count: 3, why: { 'summary-absent': 1, 'summary-missing': 1, 'summary-oversize': 1 } });
    expect(f.summaryUnclosed.count).toBe(0);
    expect(f.summaryUnclosed.state).toBe('unmeasured');
    expect(f.population.rawLeaf).toBe(1);
  });

  it('spike places a span by its boundary\'s time', () => {
    const r = run(one([
      S('before', { ts: SINCE - 1 }), S('at-since', { ts: SINCE }), S('inside', { ts: SINCE + 10 }),
      S('at-until', { ts: UNTIL }), S('untimed', { ts: null }),
    ]));
    expect(A(r).population.spans).toBe(2);
    expect(A(r).population.untimed).toBe(1);
    // while an untimed boundary stands, no headroom figure is measured
    expect(A(r).cutShapes.state).toBe('unmeasured');
    expect(A(r).cutShapes.why).toContain('boundary-untimed');
    expect(A(r).summaryUnclosed.why).toContain('boundary-untimed');
  });

  it('spike attributes a span to its producer, not its session', () => {
    const r = run(one([S('first', { model: MODEL_A }), S('second', { model: MODEL_O })]));
    expect(A(r).population.spans).toBe(1);
    expect(r.perBackend.other.population.spans).toBe(1);
  });

  it('spike reports analysis_only apart from compliance and headroom', () => {
    const inside = (key: string): string => `<analysis>\n${blockOf(key)}\n</analysis>`;
    const r = run(one([
      S('only', { status: 'absent', text: `${inside('only')}\nSummary:\nA` }),
      S('okay', { status: 'ok', text: `${inside('okay')}\nSummary:\nA\n${blockOf('okay')}` }),
    ]));
    const f = A(r);
    expect([f.analysisOnly.count, f.analysisOnly.of]).toEqual([1, 1]);
    expect(f.compliance.all.status).toMatchObject({ absent: 1, ok: 1 });
    expect([f.cutShapes.state, f.cutShapes.count]).toEqual(['measured', 0]);
    expect([f.summaryUnclosed.state, f.summaryUnclosed.count]).toEqual(['measured', 0]);
  });

  it('durationMs per cohort', () => {
    const r = run(one([
      S('d1', { status: 'ok', duration: 100 }), S('d2', { status: 'ok', duration: 200 }),
      S('d3', { status: 'ok', duration: 300, trigger: 'manual' }), S('d4', { status: 'ok', duration: 400, trigger: 'manual' }),
      S('n1', { status: 'ok', duration: null }), S('n2', { status: 'ok', duration: null }),
    ]));
    const d = A(r).durationMs;
    expect(d.all).toEqual({ state: 'measured', value: expect.objectContaining({ n: 4, p50: 200, p95: 400, absent: 2 }) });
    expect(d.manual.value).toMatchObject({ n: 2, p50: 300, p95: 400 });
    expect(d.auto.value).toMatchObject({ n: 2, p50: 100, p95: 200, absent: 2 });
    expect(d.addedP50).toEqual({ state: 'unmeasured', why: 'duration-absent' });
  });

  it('echoChars per manual compaction', () => {
    const r = run(one([
      S('m1', { status: 'ok', trigger: 'manual', echo: 1600 }),
      S('a1', { status: 'ok', trigger: 'auto', echo: 1600 }),
      S('m2', { status: 'ok', trigger: 'manual' }),
    ]));
    expect(A(r).echoChars.set).toEqual({ state: 'measured', value: { n: 1, p50: 1600, unmeasured: { count: 1, why: { 'echo-absent': 1 } } } });
  });

  it('spike prints no text', () => {
    const p = plant(one([S('t', { status: 'ok', gist: 'SEEDGISTzq123', text: 'Summary:\nSEEDTEXTzq456 body', echo: 1600 })]));
    const r = spike(p);
    expect(JSON.stringify(r)).not.toMatch(/SEEDGISTzq123|SEEDTEXTzq456|local-command-stdout/);
    const out = path.join(mkTmp('ccrc-counters-spike-out-'), 'spike.json');
    const { code } = inProcess(() => ctr.main(['spike', '--db', p.dbFile, '--session', 'cohort', '--since', String(SINCE), '--until', String(UNTIL), '--out', out]));
    expect(code).toBe(0);
    const text = fs.readFileSync(out, 'utf8');
    expect(text).not.toMatch(/SEEDGISTzq123|SEEDTEXTzq456/);
    expect(JSON.parse(text).perBackend.anthropic.population.spans).toBe(1);
  });

  it('spike opens the store read-only', () => {
    const p = plant(one([S('t', { status: 'ok' }), S('u')]));
    const snap = (): { sha: string; mtime: number; uv: number } => {
      const db = store.openReader(p.dbFile);
      try {
        return {
          sha: createHash('sha256').update(fs.readFileSync(p.dbFile)).digest('hex'), mtime: fs.statSync(p.dbFile).mtimeMs,
          uv: Number((db.prepare('PRAGMA user_version').get() as R)['user_version']),
        };
      } finally {
        db.close();
      }
    };
    const before = snap();
    spike(p);
    const out = path.join(mkTmp('ccrc-counters-spike-out-'), 'spike.json');
    expect(inProcess(() => ctr.main(['spike', '--db', p.dbFile, '--session', 'cohort', '--since', String(SINCE), '--until', String(UNTIL), '--out', out])).code).toBe(0);
    expect(snap()).toEqual(before);
    // and the report's own handle refuses a write
    const rs = ctr.openCounterStore(p.dbFile);
    try {
      expect(() => rs.db.exec('CREATE TABLE spike_probe (x)')).toThrow();
    } finally {
      rs.close();
    }
  });

  it('spike reports add-on spans apart', () => {
    const keys = (p: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);
    const k = keys('k', 8);
    const p = plant({ sessions: [
      { id: 'cohort', spans: [
        ...k.map((x) => S(x, { status: x === 'k8' ? 'degraded' : 'ok' })),
        S('m1', { status: 'ok' }), S('m2', { status: 'ok' }), S('z1'),
        S('d1', { status: 'ok' }), S('d2', { status: 'ok' }),
        S('u1', { status: 'ok' }), S('u2'),
        S('g1', { status: 'ok' }), S('g2', { status: 'ok' }), S('solo', { status: 'ok' }),
        S('e1', { status: 'ok' }), S('e2', { status: 'ok' }), S('f1', { status: 'ok' }), S('f2', { status: 'parse-failed' }),
        S('o1', { status: 'ok', model: MODEL_O }), S('o2', { status: 'ok', model: MODEL_O }),
      ] },
      { id: 'base-1', spans: [S('b1', { status: 'ok' }), S('b2', { status: 'ok' })] },
    ], receipts: [
      // the add-on is printed with an EXACT receipt (the leaf's own id); k8, m2 and o2 carry one, and so does solo, which has no parent yet
      { session: 'cohort', leaf: 'k8', ts: T0 + 500 }, { session: 'cohort', leaf: 'm2', ts: T0 + 500 }, { session: 'cohort', leaf: 'o2', ts: T0 + 500 },
      { session: 'cohort', leaf: 'solo', ts: T0 + 500 },
      // e1 has an exact receipt but is not the last child of its parent; f2 is the last child and has one, but its leaf did not parse
      { session: 'cohort', leaf: 'e1', ts: T0 + 500 }, { session: 'cohort', leaf: 'f2', ts: T0 + 500 },
      // g2 had only the generic receipt (leaf ''), whose text carries no add-on
      { session: 'cohort', leaf: '', ts: T0 + 500 },
    ] });
    addParent(p, 'P1', k);
    addParent(p, 'P2', ['m1', 'm2']);
    // P3 is a depth-2 parent over leaves, which production cannot make. d2 holds no exact receipt, so the receipt keeps it out of
    // addOn, not the depth word: this pins nothing about depth, and `p.depth = 1` in addOnLeaf stays an EQUIVALENT mutant (the coordinator's ruling)
    addParent(p, 'P3', ['d1', 'd2'], 2);
    addParent(p, 'P4', ['o1', 'o2']);
    // an unreceipted last child was never printed, so it carried no add-on: counted in perBackend, kept out of addOn
    addParent(p, 'P6', ['u1', 'u2']);
    // a receipted last child with only a generic receipt: counted in perBackend, kept out of addOn (solo has a receipt but no parent yet)
    addParent(p, 'P7', ['g1', 'g2']);
    // an exact-receipted leaf that is not the last child of its parent was not the span the add-on was written for (Step 6's last-child condition)
    addParent(p, 'P8', ['e1', 'e2']);
    // an exact-receipted last child whose leaf did not parse is not receipted as newSpan reads it (Step 6's receipted condition)
    addParent(p, 'P9', ['f1', 'f2']);
    // a baseline span that is the last child of a depth-1 parent is not an add-on span of the cohort
    addParent(p, 'P5', ['b1', 'b2']);
    const r = spike(p);
    // the add-on spans: k8 (the eighth leaf), m2, and the other backend's o2; each is counted in the cohort's figures too
    expect(Object.keys(r).sort()).toEqual(['addOn', 'baseline', 'perBackend']);
    expect(A(r).population.spans).toBe(8 + 3 + 2 + 2 + 3 + 4);
    expect(A(r).compliance.receipted).toBe(8 + 2 + 2 + 1 + 3 + 3);
    expect(A(r).population.parseFailed, 'CONTROL: f2 is the parse-failed leaf').toBe(1);
    expect(r.addOn.anthropic.population.spans).toBe(2);
    expect(r.addOn.anthropic.population.notRequested).toBe(0);
    expect(A(r).population.notRequested).toBe(2);
    expect(r.addOn.anthropic.compliance.receipted).toBe(2);
    expect(r.addOn.anthropic.compliance.all.status).toMatchObject({ ok: 1, degraded: 1 });
    expect(r.addOn.anthropic.compliance.all.ok_degraded).toEqual({ num: 2, den: 2 });
    expect(r.addOn.other.population.spans).toBe(1);
    expect(r.perBackend.other.population.spans).toBe(2);
    expect(r.addOn.unknown.population.spans).toBe(0);
    // the baseline side has no add-on figure and its span stays a plain baseline span
    expect(r.baseline.anthropic.population.spans).toBe(2);
  });

  describe('the ruled rows (O17 to O22)', () => {
    it('cutShapes under O17 (a)', () => {
      const r = run(one([
        S('block', { status: 'ok', text: `Summary:\nX\n${blockOf('block', false)}` }),
        S('analysis', { text: '<analysis>\nthinking that never closed' }),
        S('summary-only', { status: 'ok', text: UNCLOSED_SUMMARY }),
        S('quoted', { text: `Summary:\nA quoted block follows.\n${blockOf('quoted', false)}` }),
      ]));
      expect(A(r).cutShapes).toMatchObject({ state: 'measured', count: 2, of: 4 });
    });

    it('cutUntestable under O20 (b)', () => {
      const r = run(one([
        S('plain', { status: 'absent', text: CLOSED }),
        S('tomb', { status: 'ok', summary: 'tombstone' }),
      ]));
      const f = A(r);
      expect(f.cutShapes.count).toBe(0);
      expect(f.cutUntestable.count).toBe(1);
      expect(f.cutUntestable.unmeasured).toEqual({ count: 1, why: { 'summary-absent': 1 } });
      expect(f.cutShapes.unmeasured).toEqual({ count: 1, why: { 'summary-absent': 1 } });
      expect(f.cutShapes.state).toBe('unmeasured');
      // an untestable span is no cut shape seen, and the report never words it as no truncation proven
      expect(JSON.stringify(r)).not.toMatch(/proven|no-truncation|truncation-free/i);
    });

    /** `cohortUnclosed` of 10 receipted cohort spans unclosed, against `baseN` baseline spans with `baseUnclosed` unclosed, and an
     *  unreceipted cohort span with an unclosed `<summary>` beside them. */
    const o19 = (cohortUnclosed: number, baseN: number, baseUnclosed: number): R => run({
      sessions: [
        { id: 'cohort', spans: [
          ...Array.from({ length: 10 }, (_, i) => S(`c${i}`, { status: 'ok', text: i < cohortUnclosed ? UNCLOSED_SUMMARY : CLOSED })),
          S('quiet', { text: UNCLOSED_SUMMARY }),
        ] },
        { id: 'base', spans: Array.from({ length: baseN }, (_, i) => S(`b${i}`, { text: i < baseUnclosed ? UNCLOSED_SUMMARY : CLOSED })) },
      ],
    });

    it('summary_unclosed under O19 (b)', () => {
      const a = A(o19(3, 10, 4));
      expect(a.summaryUnclosed).toMatchObject({ count: 3, of: 10, share: { num: 3, den: 10 } });
      expect(o19(3, 10, 4).baseline.anthropic.summaryUnclosed).toMatchObject({ count: 4, of: 10, share: { num: 4, den: 10 } });
      expect(a.summaryUnclosed.comparison).toEqual({ state: 'measured', value: expect.objectContaining({ atMost: true }) });
      const b = A(o19(5, 10, 4));
      expect(b.summaryUnclosed).toMatchObject({ count: 5, of: 10 });
      expect(b.summaryUnclosed.comparison.value.atMost).toBe(false);
      const c = o19(3, 9, 4);
      expect(A(c).summaryUnclosed.comparison).toEqual({ state: 'unmeasured', why: 'sample-short' });
      // both absolute counts print beside it
      expect([A(c).summaryUnclosed.count, A(c).summaryUnclosed.of, c.baseline.anthropic.summaryUnclosed.count, c.baseline.anthropic.summaryUnclosed.of]).toEqual([3, 10, 4, 9]);
    });

    it('spike counts headroom over O21\'s population', () => {
      const r = run({
        sessions: [
          { id: 'cohort', spans: [S('ok', { status: 'ok' }), S('quiet', { text: '<analysis>\nnever closed, and no summary after it' })] },
          { id: 'base', spans: [S('b1', { text: '<analysis>\nnever closed, and no summary after it' }), S('b2')] },
        ],
      });
      expect(A(r).cutShapes).toMatchObject({ count: 1, of: 2 });
      expect(r.baseline.anthropic.cutShapes).toMatchObject({ count: 1, of: 2 });
    });

    it('spike keeps printed-to spans out of the baseline', () => {
      const r = run({
        sessions: [
          { id: 'cohort', spans: [S('c1', { status: 'ok' })] },
          { id: 'printed', spans: [S('p1'), S('p2')] },
          { id: 'plain', spans: [S('q1')] },
          { id: 'old', spans: [S('o1', { ts: T0 + 20 })] },
        ],
        receipts: [{ session: 'printed', leaf: 'p1', ts: T0 + 900 }, { session: 'old', leaf: 'o1', ts: SINCE - 5 }],
      });
      // `plain` and `old` count (a receipt before the range prints nothing in it); `printed` does not
      expect(r.baseline.anthropic.population.spans).toBe(2);
    });

    it('durationMs and echoChars against O21\'s baseline', () => {
      const r = run({
        sessions: [
          { id: 'cohort', spans: [
            S('c1', { status: 'ok', duration: 100 }), S('c2', { status: 'ok', duration: 200 }),
            S('c3', { status: 'ok', duration: 300, trigger: 'manual', echo: 1600 }),
          ] },
          { id: 'base', spans: [
            S('b1', { duration: 100 }), S('b2', { duration: 150, trigger: 'manual', echo: 100 }), S('b3', { duration: 200 }),
            S('g1', { duration: 1000, model: MODEL_O }), S('g2', { duration: 1000, model: MODEL_O }),
          ] },
        ],
      });
      const b = r.baseline.anthropic.durationMs.all.value;
      expect([b.p50, b.p95]).toEqual([150, 200]);
      expect(r.baseline.other.durationMs.all.value.p50).toBe(1000);
      expect(A(r).durationMs.all.value.p50).toBe(200);
      const added = A(r).durationMs.addedP50;
      expect(added.state).toBe('measured');
      expect(added.value.num / added.value.den).toBeCloseTo(1 / 3, 10);
      expect(A(r).echoChars.addedP50).toEqual({ state: 'measured', value: 1500 });
    });

    it('spike attributes at report time a span derived before its first reply', () => {
      const p = plant(one([S('s1'), S('s2', { trigger: 'manual', model: null, createdMs: T0 + 5000 })]));
      const before = spike(p);
      expect(A(before).population.spans).toBe(1);
      expect(before.perBackend.unknown.population.spans).toBe(1);
      expect(A(before).run.producerUnknown).toBe(1);
      expect(A(before).cutShapes.why).toContain('producer-unknown');
      addReply(p, 's2', MODEL_A, T0 + 9000);
      const after = spike(p);
      expect(A(after).population.spans).toBe(2);
      expect(after.perBackend.unknown.population.spans).toBe(0);
      expect(A(after).run.producerUnknown).toBe(0);
    });

    it('reasons under O18 (a)', () => {
      const r = run(one([S('n'), S('ab', { status: 'absent' }), S('ok', { status: 'ok' }), S('inv', { status: 'invalid' }), S('deg', { status: 'degraded' })]));
      expect(A(r).reasons).toMatchObject({ 'no-receipt': 1, 'no-block': 1, none: 1, 'reason-not-stored': 2 });
    });

    it('headroom unmeasured as O22 rules', () => {
      const spans = [S('a1', { status: 'ok' }), S('o1', { status: 'ok', model: MODEL_O })];
      // analysisOnly is no headroom figure (it prints beside compliance), so the run's contamination never reaches it
      const heads = (f: R): string[] => [f.summaryUnclosed.state, f.cutShapes.state, f.cutUntestable.state];
      // the sweep behind: every headroom figure, on every backend
      const behind = run(one(spans, { ticks: [[T0, 0], [T0 + 10, 1]] }));
      for (const b of ['anthropic', 'other']) {
        expect(heads(behind.perBackend[b]), b).toEqual(['unmeasured', 'unmeasured', 'unmeasured']);
        expect(behind.perBackend[b].cutShapes.why, b).toContain('sweep-behind');
      }
      expect(A(behind).run.sweep).toMatchObject({ state: 'behind', filesBehind: 1 });
      expect(A(behind).analysisOnly.state).toBe('measured');
      expect(heads(A(run(one(spans, { ticks: [[T0, 1], [T0 + 10, 0]] }))))).toEqual(['measured', 'measured', 'measured']);
      // a producer still unknown: every backend, until the first reply is stored
      const p = plant(one([...spans, S('late', { model: null })]));
      const unknown = spike(p);
      for (const b of ['anthropic', 'other']) expect(heads(unknown.perBackend[b]), b).toEqual(['unmeasured', 'unmeasured', 'unmeasured']);
      expect(unknown.perBackend.unknown.population.spans).toBe(1);
      addReply(p, 'late', MODEL_A, T0 + 99_000);
      const settled = spike(p);
      for (const b of ['anthropic', 'other']) expect(heads(settled.perBackend[b]), b).toEqual(['measured', 'measured', 'measured']);
      // a late receipt's own span stays measured, counted apart
      const late = run(one([S('s1', { status: 'ok' }), S('s2', { status: 'absent' })], { receipts: [{ session: 'cohort', leaf: 's2', ts: T0 + 2500 }] }));
      expect(A(late).lateReceipts.count).toBe(1);
      expect(heads(A(late))).toEqual(['measured', 'measured', 'measured']);
    });
  });

  describe('the rulings of 2026-11-09 (O23 and review 1696 V1)', () => {
    it('an untimed receipt in the report as O23 rules', () => {
      // g1 and g2: one generic receipt, drain-stamped between their boundaries; u2: an exact receipt stamped before its boundary; u1: one stamped after its.
      const r = run(one([
        S('g1'), S('g2', { status: 'absent' }), S('u2', { status: 'ok' }), S('u1', { status: 'ok' }),
      ], {
        receipts: [
          { session: 'cohort', leaf: '', ts: T0 + 1500, source: 'received' },
          { session: 'cohort', leaf: 'u2', ts: T0 + 2500, source: 'received' },
          { session: 'cohort', leaf: 'u1', ts: T0 + 4500, source: 'received' },
        ],
      }));
      const f = A(r);
      expect(f.untimedReceipts).toBe(2);
      expect(f.lateReceipts.count).toBe(0);
      expect(f.compliance.receipted).toBe(3);
      expect(f.compliance.all.status).toMatchObject({ absent: 1, ok: 2 });
      // the generic receipt reads as today: g2 is receipted though never asked, in O19's share, and no counter shows it
      expect(f.summaryUnclosed.of).toBe(3);
      expect([f.multiReceipt, f.stalePrint.count]).toEqual([0, 0]);
    });

    it('spike compares a leaf\'s earliest exact receipt for lateReceipts', () => {
      // Task 1B's stale-print fixture: both receipts name span 1; the first is timed before its boundary, the second after it
      const r = run(one([S('s1', { status: 'ok' }), S('s2')], {
        receipts: [{ session: 'cohort', leaf: 's1', ts: T0 + 500 }, { session: 'cohort', leaf: 's1', ts: T0 + 1500 }],
      }));
      expect(A(r).lateReceipts.count).toBe(0);
      expect(A(r).multiReceipt).toBe(1);
    });
  });

  describe('never a span dropped, never an empty cohort measured (fix round 1)', () => {
    it('spike keeps a span whose epoch is unconfirmed: it reads leaf-absent and leaves headroom unmeasured', () => {
      const r = run({
        sessions: [
          { id: 'cohort', confirmed: false, spans: [S('u1', { leaf: 'none' }), S('u2', { leaf: 'none' })] },
          { id: 'base', confirmed: false, spans: [S('b1', { leaf: 'none' })] },
        ],
      });
      expect([A(r).population.spans, A(r).population.leafAbsent]).toEqual([2, 2]);
      expect(A(r).cutShapes.state).toBe('unmeasured');
      expect(A(r).cutShapes.unmeasured).toEqual({ count: 2, why: { 'leaf-absent': 2 } });
      expect(r.baseline.anthropic.population.spans).toBe(1);
      expect(r.baseline.anthropic.cutShapes.state).toBe('unmeasured');
      expect(A(r).summaryUnclosed.comparison.state).toBe('unmeasured');
    });

    it('spike counts a span no session can claim, and leaves every backend\'s headroom unmeasured', () => {
      const p = plant({ sessions: [
        { id: 'cohort', spans: [S('a', { status: 'ok' }), S('o', { status: 'ok', model: MODEL_O })] },
        { id: 'ghost', spans: [S('g1'), S('g2', { ts: null })] },
      ] });
      remove(p, 'DELETE FROM epochs WHERE session_pk = ?', 2);
      const r = spike(p);
      expect(A(r).run.unattributed).toBe(2);
      for (const side of [r.perBackend, r.baseline]) {
        for (const b of ['anthropic', 'other']) expect(side[b].cutShapes.why, b).toContain('span-unattributed');
      }
      expect(A(r).summaryUnclosed.state).toBe('unmeasured');
    });

    it('spike counts a span two sessions claim as unattributed, not placed on the lower one', () => {
      const p = plant({ sessions: [
        { id: 'cohort', confirmed: false, spans: [S('a')] },
        { id: 'rival', confirmed: false, spans: [] },
      ] });
      // both unconfirmed epoch rows now name the cohort session's transcript uuid: two roots hold it
      remove(p, 'UPDATE epochs SET cc_session_uuid = ? WHERE session_pk = 2', ccUuidOf(1));
      const r = spike(p);
      expect(A(r).run.unattributed).toBe(1);
      expect(A(r).population.spans).toBe(0);
      expect(A(r).cutShapes.why).toContain('span-unattributed');
    });

    it('spike reads a headroom figure over no spans as unmeasured, never 0 of 0', () => {
      const out = run(one([S('far', { ts: UNTIL + 5 })]));
      for (const f of ['summaryUnclosed', 'cutShapes', 'cutUntestable']) {
        expect([A(out)[f].state, A(out)[f].of], f).toEqual(['unmeasured', 0]);
        expect(A(out)[f].why, f).toContain('no-spans');
      }
      // a session that matches nothing is that report, and says how many of its ids were found
      const none = run(one([S('a', { status: 'ok' })]), { sessions: ['nobody'] });
      expect(A(none).run.sessions).toEqual({ named: 1, found: 0 });
      expect(A(none).cutShapes.why).toContain('no-spans');
    });

    it('the spike arm refuses a --session that matches no session, and an empty one', () => {
      const p = plant(one([S('t', { status: 'ok' })]));
      const dir = mkTmp('ccrc-counters-spike-out-');
      const argv = (out: string, ...ids: string[]): string[] => ['spike', '--db', p.dbFile, ...ids.flatMap((i) => ['--session', i]), '--since', String(SINCE), '--until', String(UNTIL), '--out', out];
      const bad = inProcess(() => ctr.main(argv(path.join(dir, 'a.json'), 'cohort', 'nobody')));
      expect(bad.code).toBe(2);
      expect(bad.stderr).toMatch(/args-invalid.*1 of 2/);
      expect(bad.stderr).not.toMatch(/nobody/);
      expect(fs.existsSync(path.join(dir, 'a.json'))).toBe(false);
      const empty = inProcess(() => ctr.main(argv(path.join(dir, 'b.json'), '')));
      expect(empty.code).toBe(2);
      expect(empty.stderr).toMatch(/args-invalid/);
    });

    it('addedP50 names a zero baseline p50 apart from an absent duration', () => {
      const r = run({ sessions: [
        { id: 'cohort', spans: [S('c', { status: 'ok', duration: 100 })] },
        { id: 'base', spans: [S('b', { duration: 0 })] },
      ] });
      expect(A(r).durationMs.addedP50).toEqual({ state: 'unmeasured', why: 'baseline-zero' });
    });

    it('echoChars counts characters, not UTF-16 units', () => {
      const text = `<local-command-stdout>${'\u{1F600}'.repeat(5)}</local-command-stdout>`;
      const r = run(one([S('m', { status: 'ok', trigger: 'manual', echoText: text })]));
      expect([...text].length).toBe(50);
      expect(text.length).toBe(55);
      expect(A(r).echoChars.set.value.p50).toBe(50);
    });

    it('a boundary no copy holds is labelled boundary-uncopied, not producer-unknown', () => {
      const p = plant(one([S('s1', { status: 'ok' }), S('s2', { status: 'ok' })]));
      remove(p, 'DELETE FROM memberships WHERE entry_id = ?', p.spans.get('s2')!.entryId);
      const r = spike(p);
      expect(r.perBackend.unknown.population.spans).toBe(1);
      expect(A(r).run).toMatchObject({ uncopied: 1, producerUnknown: 0 });
      expect(A(r).cutShapes.why).toContain('boundary-uncopied');
      expect(A(r).cutShapes.why).not.toContain('producer-unknown');
    });
  });

  describe('the spike arm', () => {
    it('refuses a missing flag, a relative --db and an existing --out', () => {
      const p = plant(one([S('t')]));
      const out = path.join(mkTmp('ccrc-counters-spike-out-'), 'spike.json');
      const base = ['spike', '--db', p.dbFile, '--session', 'cohort', '--since', String(SINCE), '--until', String(UNTIL), '--out', out];
      const word = (argv: string[]): string => inProcess(() => ctr.main(argv)).stderr;
      expect(word(base.filter((_, i) => i < 7))).toMatch(/args-invalid/);
      expect(word(['spike', '--db', 'rel.db', ...base.slice(3)])).toMatch(/args-invalid/);
      expect(inProcess(() => ctr.main(base)).code).toBe(0);
      expect(word(base)).toMatch(/out-refused/);
      expect(word(['spike', '--db', p.dbFile, '--session', 'cohort', '--since', String(UNTIL), '--until', String(SINCE), '--out', `${out}.2`])).toMatch(/args-invalid/);
    });
  });
});

/** A hand-built node report in the shape count writes, with one unmeasured window: what combine reads, field by field. */
const NODE_STORE = '00000000-0000-4000-8000-0000000006c1';
const NODE_SHA = 'cd'.repeat(32);
function nodeReport(over: R = {}, row: R = {}): R {
  const ab = drv.AB_STATES as string[];
  const measures = Object.fromEntries((ctr.COUNTER_NAMES as string[]).map((n) => [n, { state: 'unmeasured', why: 'window-unmeasured' }]));
  return {
    kind: ctr.COUNTERS_KIND, v: 1, counters_def: { id: 'v1', sha256: gate.COUNTERS_DEF_V1_SHA256 }, k: gate.K, k_unit: gate.K_UNIT,
    record_sha256: 'ab'.repeat(32), script_sha256: NODE_SHA, read_ms: T0, code_changed: false, store_id: NODE_STORE, record_nodes: [NODE_STORE],
    user_version: 2, window: { start_ms: T0, end_ms: T0 + 1 }, sources: {},
    excluded: { not_found: [], zero_windows: [], unmeasured: { count: 0, keys: [] }, not_listed: [] },
    dropped: { changed: [], unrealised: Object.fromEntries(ab.slice(1).map((st) => [st, []])) }, recall_off_gaps: [],
    windows: [{ arm: 'treatment', producer: 'anthropic', changed: false, unrealised: false, ab_state: ab[0], state: 'unmeasured', turns: null, recall_calls: null, measures, ...row }],
    ...over,
  };
}
/** combine over one node report; a refusal as {word, detail}, null when it combines. */
function combineRefusal(r: R): { word: string; detail: string } | null {
  try {
    ctr.combineReports([{ sha256: 'ee'.repeat(32), value: r }], { ownSha256: NODE_SHA });
    return null;
  } catch (e) {
    if (e instanceof Error && e.name === 'DriverRefusal') return { word: (e as R)['word'], detail: (e as R)['detail'] };
    throw e;
  }
}

describe('combine: review 966\'s carries (W3 Task 1D Step 4)', () => {
  const nonOk = (): string => (drv.AB_STATES as string[])[1]!;
  it('the hand-built node report combines (CONTROL for the refusals below)', () => {
    expect(combineRefusal(nodeReport())).toBeNull();
  });

  it('combine checks every node-report field it names as unchecked: excluded.unmeasured.count and the dropped lists', () => {
    const bad = /^counters-shape: combine: /;
    const cases: Array<[string, R]> = [
      ['a string count', nodeReport({ excluded: { not_found: [], zero_windows: [], unmeasured: { count: '3', keys: [] }, not_listed: [] } })],
      ['a negative count', nodeReport({ excluded: { not_found: [], zero_windows: [], unmeasured: { count: -1, keys: [] }, not_listed: [] } })],
      ['a non-string in dropped.changed', nodeReport({ dropped: { changed: [7], unrealised: Object.fromEntries((drv.AB_STATES as string[]).slice(1).map((st) => [st, []])) } })],
      ['a non-string in a dropped.unrealised list', nodeReport({ dropped: { changed: [], unrealised: Object.fromEntries((drv.AB_STATES as string[]).slice(1).map((st) => [st, st === nonOk() ? [{}] : []])) } })],
    ];
    for (const [label, r] of cases) {
      const f = combineRefusal(r);
      expect(f?.word, label).toBe('input-invalid');
      expect(f?.detail, label).toMatch(bad);
    }
  });

  it('an unknown ab_state word with unrealised: true is refused', () => {
    // unrealised true is what any word but the first makes it, so only the AB_STATES check itself can refuse this row
    const f = combineRefusal(nodeReport({}, { ab_state: 'no-such-state', unrealised: true }));
    expect(f?.word).toBe('input-invalid');
    expect(f?.detail).toMatch(/a row's ab_state is "no-such-state", which is none of AB_STATES/);
  });
});

/** An in-process main call with stderr captured. */
function inProcess(fn: () => unknown): { code: unknown; stderr: string } {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((s: string | Uint8Array) => { lines.push(String(s)); return true; }) as typeof process.stderr.write);
  try {
    return { code: fn(), stderr: lines.join('') };
  } finally {
    spy.mockRestore();
  }
}
