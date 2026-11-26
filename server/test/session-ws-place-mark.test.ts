// Overlord W1 home B, Task 7 (question 4, slug place-visible-rides-the-session-socket): the session socket's `visible` frame
// refreshes the `@overlord-place` operator mark when it is the bound session's, at most once a minute. Two layers:
//  1. `placeMarkReporter`, the one function the handler calls, over stubbed ports (the designation reader, the marks read and
//     the mark writer) and a clock the case moves;
//  2. the real handler of `/ws/session/:id` over a real socket, a real coord.db in a fixture HOME and the real wall clock:
//     the frames of one minute write once, a hidden frame or another session's frame writes nothing, and a reader that
//     throws still lets the frame's visibility land.
// The frame vocabulary is unchanged: `asSessionClientMsg` answers null for a frame type it did not know before.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { asSessionClientMsg, buildServer, type Deps } from '../src/server.js';
import { placeMarkReporter, type PlaceMarkPorts } from '../src/continuity/placeMarkReport.js';
import { Viewers } from '../src/viewer.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import { OVERLORD_PLACE_MARK, PLACE_MARK_EVERY_MS } from '../../shared/continuity.js';
import { seedRoster } from './helpers.js';
import { fakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const BOUND = 'lane-a-overlord';
const OTHER = 'lane-b-project-a';
const T0 = 1_800_000_000_000;

type Marks = ReturnType<PlaceMarkPorts['operatorMarks']>;

/** Ports over a mutable fixture: the designation word, the mark's `at` (null: no mark), and every write recorded. */
function ports(over: { designation?: DesignationRead | (() => DesignationRead); marks?: Marks | (() => Marks) } = {}) {
  const state = { at: null as number | null, writes: [] as { programme: string; at: number }[] };
  const designation = over.designation ?? { kind: 'designated', sessionId: BOUND, term: 1, row: {} } as unknown as DesignationRead;
  const p: PlaceMarkPorts = {
    designationRead: () => (typeof designation === 'function' ? designation() : designation),
    operatorMarks: () => {
      if (over.marks !== undefined) return typeof over.marks === 'function' ? over.marks() : over.marks;
      return { ok: true, rows: state.at === null ? [] : [{ programme: OVERLORD_PLACE_MARK, at: state.at, quiet: null }] };
    },
    putOperatorMark: (programme, at) => { state.writes.push({ programme, at }); state.at = at; return { ok: true }; },
  };
  return { p, state };
}

describe('placeMarkReporter: the function the session socket calls after a visible frame', () => {
  it('a visible frame of the bound session writes the mark at the clock; more frames in the minute write nothing', () => {
    const { p, state } = ports();
    let now = T0;
    const report = placeMarkReporter(p, () => now, () => { throw new Error('no warning expected'); });
    report(BOUND, true);
    expect(state.writes).toEqual([{ programme: '@overlord-place', at: T0 }]);
    for (let i = 1; i <= 8; i++) { now = T0 + i * 7_000; report(BOUND, true); }
    expect(state.writes).toHaveLength(1);
  });

  it('at a minute after the last write the next visible frame refreshes the mark, and the mark moves to that frame\'s time', () => {
    const { p, state } = ports();
    let now = T0;
    const report = placeMarkReporter(p, () => now, () => {});
    report(BOUND, true);
    now = T0 + PLACE_MARK_EVERY_MS - 1; report(BOUND, true);
    expect(state.writes).toHaveLength(1);
    now = T0 + PLACE_MARK_EVERY_MS; report(BOUND, true);
    expect(state.writes.map((w) => w.at)).toEqual([T0, T0 + PLACE_MARK_EVERY_MS]);
  });

  it('a hidden frame, or a frame of another session, writes nothing', () => {
    const { p, state } = ports();
    const report = placeMarkReporter(p, () => T0, () => {});
    report(BOUND, false);
    report(OTHER, true);
    report(OTHER, false);
    expect(state.writes).toEqual([]);
  });

  it('no session designated, or a designation that could not be read: nothing is written', () => {
    for (const designation of [{ kind: 'not-designated', row: null }, { kind: 'unmeasured', why: 'fixture' }] as const) {
      const { p, state } = ports({ designation: designation as unknown as DesignationRead });
      placeMarkReporter(p, () => T0, () => {})(BOUND, true);
      expect(state.writes, designation.kind).toEqual([]);
    }
  });

  it('a mark that could not be read writes nothing', () => {
    const { p, state } = ports({ marks: { ok: false, detail: 'fixture' } });
    placeMarkReporter(p, () => T0, () => {})(BOUND, true);
    expect(state.writes).toEqual([]);
  });

  it('a throwing designation reader or marks reader is caught and warned about once, however many frames follow', () => {
    for (const bad of [{ designation: () => { throw new Error('boom'); } }, { marks: () => { throw new Error('boom'); } }]) {
      const { p, state } = ports(bad);
      const warnings: string[] = [];
      const report = placeMarkReporter(p, () => T0, (l) => warnings.push(l));
      expect(() => { report(BOUND, true); report(BOUND, true); report(BOUND, true); }).not.toThrow();
      expect(state.writes).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^ccrc-server: /);
    }
  });

  it('a read that answers unread is warned about once; a write that does not land is warned about once, and a write that lands re-arms', () => {
    const unread = ports({ marks: { ok: false, detail: 'fixture' } });
    const w1: string[] = [];
    const r1 = placeMarkReporter(unread.p, () => T0, (l) => w1.push(l));
    r1(BOUND, true); r1(BOUND, true);
    expect(w1).toHaveLength(1);

    let fail = true;
    const { p } = ports();
    const base = p.putOperatorMark;
    p.putOperatorMark = (programme, at) => (fail ? { ok: false } : base(programme, at));
    let now = T0;
    const warnings: string[] = [];
    const report = placeMarkReporter(p, () => now, (l) => warnings.push(l));
    report(BOUND, true); report(BOUND, true);
    expect(warnings).toHaveLength(1);
    fail = false; report(BOUND, true);            // lands: re-armed
    now += PLACE_MARK_EVERY_MS; fail = true; report(BOUND, true);
    expect(warnings).toHaveLength(2);
  });

  it('no coordination store: nothing happens and nothing throws', () => {
    expect(() => placeMarkReporter(undefined, () => T0, () => { throw new Error('no warning expected'); })(BOUND, true)).not.toThrow();
  });
});

describe('the session socket frame vocabulary is unchanged', () => {
  it('asSessionClientMsg knows visible, older-page and helper-report, and answers null for a type it did not know', () => {
    expect(asSessionClientMsg({ type: 'visible', visible: true })).toEqual({ type: 'visible', visible: true });
    expect(asSessionClientMsg({ type: 'older-page', continuation: 'c' })).toEqual({ type: 'older-page', continuation: 'c' });
    expect(asSessionClientMsg({ type: 'place-visible', visible: true })).toBeNull();
    expect(asSessionClientMsg({ type: 'overlord-place', visible: true })).toBeNull();
    expect(asSessionClientMsg({ type: 'visible' })).toBeNull();
  });
});

// ── The real handler ────────────────────────────────────────────────────────────────────────────────────────────────

describe('/ws/session/:id: a visible frame of the bound session refreshes @overlord-place', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app !== undefined) await app.close();
    app = undefined;
    vi.restoreAllMocks();
    removeTmpFixtures();
  });

  async function rig(): Promise<{ coord: CoordStore; viewers: Viewers; port: number; writes: () => number; time: ReturnType<typeof fakeTime> }> {
    const home = mkTmp('ccrc-place-mark-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const run: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });
    const cfg = loadConfig({ CCRC_HOME: home });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    coord.db.exec(`INSERT INTO overlord_designation (id, sessionId, generation, term, designatedTerm, model, accountPools, actor, updatedAt)
      VALUES (1, '${BOUND}', 'generation-a', 1, 1, 'opus', '{"pools":[],"untagged":true}', 'actor', 1)`);
    const put = vi.spyOn(coord, 'putOperatorMark');
    const viewers = new Viewers();
    const time = fakeTime();
    const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), time: time.ports, coord, viewers };
    app = await buildServer(deps, new Bus());
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    return { coord, viewers, time, port: typeof addr === 'object' && addr !== null ? addr.port : 0, writes: () => put.mock.calls.length };
  }
  const open = async (port: number, id: string): Promise<WebSocket> => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${id}`);
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    return ws;
  };
  const marks = (coord: CoordStore): { programme: string; at: number }[] =>
    coord.db.prepare('SELECT programme, at FROM operator_marks ORDER BY programme').all() as { programme: string; at: number }[];
  const wait = { timeout: 3000 };

  it('the bound session\'s visible frames write the mark once in a minute, however many come', async () => {
    const r = await rig();
    const ws = await open(r.port, BOUND);
    try {
      for (let i = 0; i < 5; i++) ws.send(JSON.stringify({ type: 'visible', visible: true }));
      await vi.waitFor(() => expect(r.viewers.isVisible(BOUND)).toBe(true), wait);
      await vi.waitFor(() => expect(marks(r.coord)).toHaveLength(1), wait);
      await new Promise((res) => setTimeout(res, 150));
      expect(r.writes()).toBe(1);
      expect(marks(r.coord)[0]!.programme).toBe(OVERLORD_PLACE_MARK);
      expect(marks(r.coord)[0]!.at).toBe(r.time.ports.clock.wall());   // the server's own clock, not an ambient one
    } finally { ws.close(); }
  });

  it('a minute later on that clock, the next visible frame refreshes the mark again', async () => {
    const r = await rig();
    const ws = await open(r.port, BOUND);
    try {
      const frame = (): void => ws.send(JSON.stringify({ type: 'visible', visible: true }));
      frame();
      await vi.waitFor(() => expect(r.writes()).toBe(1), wait);
      const first = marks(r.coord)[0]!.at;
      r.time.advance(PLACE_MARK_EVERY_MS - 1);
      frame();
      await new Promise((res) => setTimeout(res, 150));
      expect(r.writes()).toBe(1);
      r.time.advance(1);
      frame();
      await vi.waitFor(() => expect(r.writes()).toBe(2), wait);
      expect(marks(r.coord)[0]!.at).toBe(first + PLACE_MARK_EVERY_MS);
    } finally { ws.close(); }
  });

  it('a hidden frame of the bound session writes nothing', async () => {
    const r = await rig();
    const ws = await open(r.port, BOUND);
    try {
      ws.send(JSON.stringify({ type: 'visible', visible: false }));
      await new Promise((res) => setTimeout(res, 200));
      expect(r.writes()).toBe(0);
      expect(marks(r.coord)).toEqual([]);
    } finally { ws.close(); }
  });

  it('a visible frame of another session writes nothing, yet its visibility lands', async () => {
    const r = await rig();
    const ws = await open(r.port, OTHER);
    try {
      ws.send(JSON.stringify({ type: 'visible', visible: true }));
      await vi.waitFor(() => expect(r.viewers.isVisible(OTHER)).toBe(true), wait);
      expect(r.writes()).toBe(0);
      expect(marks(r.coord)).toEqual([]);
    } finally { ws.close(); }
  });

  it('a designation reader that throws still records the frame\'s visibility, and the socket stays open', async () => {
    const r = await rig();
    vi.spyOn(r.coord, 'designationRead').mockImplementation(() => { throw new Error('fixture: the designation reader failed'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = await open(r.port, BOUND);
    try {
      ws.send(JSON.stringify({ type: 'visible', visible: true }));
      ws.send(JSON.stringify({ type: 'visible', visible: true }));
      await vi.waitFor(() => expect(r.viewers.isVisible(BOUND)).toBe(true), wait);
      await vi.waitFor(() => expect(warn.mock.calls.filter((c) => String(c[0]).startsWith('ccrc-server: ')).length).toBeGreaterThan(0), wait);
      expect(r.writes()).toBe(0);
      expect(ws.readyState).toBe(WebSocket.OPEN);
    } finally { ws.close(); }
  });

  it('a server with no coordination store records the visibility and writes nothing', async () => {
    const home = mkTmp('ccrc-place-mark-nocoord-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const run: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });
    const cfg = loadConfig({ CCRC_HOME: home });
    const viewers = new Viewers();
    app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), time: fakeTime().ports, viewers }, new Bus());
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const ws = await open(typeof addr === 'object' && addr !== null ? addr.port : 0, BOUND);
    try {
      ws.send(JSON.stringify({ type: 'visible', visible: true }));
      await vi.waitFor(() => expect(viewers.isVisible(BOUND)).toBe(true), wait);
    } finally { ws.close(); }
  });
});
