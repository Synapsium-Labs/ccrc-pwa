// Overlord W1, renewal readings E, fix round 1 (the coordinator's ruling in call 1020): every path the operator types through
// writes the operator mark, through the prompt route's one writer (`promptHandoffs.ts#markOperatorPrompt`) with its keying
// (`operatorMark.ts#markProgrammesOf`): the programmes a session coordinates or serves, and `@overlord` for the designated
// session. The two paths that wrote none were the terminal drawer's input and the submit route; with the readers measured,
// the soft permit could otherwise open a break while the operator typed there. A real coord.db and fixture HOMEs only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Bus } from '../src/bus.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { PtyLike } from '../src/pty.js';
import { markProgrammesOf } from '../src/continuity/operatorMark.js';
import { markOperatorPrompt, type PromptHandoffsCoord } from '../src/continuity/promptHandoffs.js';
import { generationsPass, type GenerationsDeps, type GenReadings, type RegistryFacts } from '../src/continuity/generationsLane.js';
import { softRenewalMay, type SoftInputs } from '../src/continuity/softRenewal.js';
import { LEAST_AGE_MS } from '../../shared/continuity.js';
import { OVERLORD_OPERATOR_MARK } from '../../shared/operatorMessages.js';
import { seedRoster } from './helpers.js';
import { fakeTime, FAKE_T0, type FakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const ID = 'lane-a-project-a';
const U1 = '11111111-1111-4111-8111-111111111111';
const wait = { timeout: 3000 };

let apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps) await a.close();
  apps = [];
  removeTmpFixtures();
});

const marks = (coord: CoordStore): unknown[] => coord.db.prepare('SELECT programme, at FROM operator_marks ORDER BY programme').all();
const openRun = (coord: CoordStore, program: string): void => {
  coord.db.prepare('INSERT OR IGNORE INTO programs (slug, title, createdAt, state) VALUES (?, ?, 1, ?)').run(program, 'P', 'active');
  coord.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES (?, 1, 2, 'project-a', 'working', ?, 1)").run(program, ID);
};
const designate = (coord: CoordStore, sessionId = ID): void => {
  coord.db.exec(`INSERT INTO overlord_designation (id, sessionId, generation, term, designatedTerm, model, accountPools, actor, updatedAt)
    VALUES (1, '${sessionId}', 'generation-a', 1, 1, 'opus', '{"pools":[],"untagged":true}', 'actor', 1)`);
};

class StubPty implements PtyLike {
  written: string[] = [];
  onData(): { dispose(): void } { return { dispose: () => {} }; }
  write(data: string): void { this.written.push(data); }
  resize(): void {}
  kill(): void {}
}

/** The server over a one-session registry and a real store, its drawer a stub pty; the pane holds `hello` until Enter is
 *  pressed, then is empty (so a submit of `hello` presses Enter and sees it go). */
async function rig(): Promise<{ app: FastifyInstance; coord: CoordStore; time: FakeTime; pty: StubPty; port: number }> {
  const home = mkTmp('ccrc-mark-paths-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({ wrapper: 'claude-a', project: 'project-a', workdir: '/data/projects/project-a', uuid: U1, started: '1' })) {
    writeFileSync(path.join(reg, `${ID}.${k}`), v);
  }
  let entered = false;
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'send-keys' && args.includes('Enter')) entered = true;
    if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: entered ? 'scrollback\n❯ \n' : 'scrollback\n❯ hello\n', stderr: '' };
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: '4242\n', stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const cfg = loadConfig({ CCRC_HOME: home });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const time = fakeTime();
  const pty = new StubPty();
  const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(),
    time: time.ports, coord, spawnPty: () => pty }, new Bus());
  await app.listen({ host: '127.0.0.1', port: 0 });
  apps.push(app);
  const addr = app.server.address();
  return { app, coord, time, pty, port: typeof addr === 'object' && addr !== null ? addr.port : 0 };
}

/** One input frame through the terminal drawer, and the frame seen written to the pty. */
async function drawerInput(r: Awaited<ReturnType<typeof rig>>, data: string): Promise<void> {
  const ws = new WebSocket(`ws://127.0.0.1:${r.port}/ws/pty/${ID}?cols=120&rows=40`);
  await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });
  ws.send(JSON.stringify({ type: 'input', data }));
  await vi.waitFor(() => expect(r.pty.written).toContain(data), wait);
  ws.close();
}
const submit = (app: FastifyInstance) => app.inject({ method: 'POST', url: `/api/sessions/${ID}/submit`, payload: { expect: 'hello' } });

// ── The keying (L1) and the one writer ───────────────────────────────────────────────────────────────────────────────

describe('markProgrammesOf and markOperatorPrompt: the designated session marks @overlord', () => {
  it('the designated session adds @overlord after its programmes; an unread designation is unmeasured', () => {
    const none = { ok: true as const, siblings: [] };
    expect(markProgrammesOf({ ok: true, siblings: [{ program: 'a' }] }, none, true)).toEqual(['a', OVERLORD_OPERATOR_MARK]);
    expect(markProgrammesOf(none, none, true)).toEqual([OVERLORD_OPERATOR_MARK]);
    expect(markProgrammesOf(none, none, false)).toEqual([]);
    expect(markProgrammesOf(none, none)).toEqual([]);
    expect(markProgrammesOf(none, none, 'unmeasured')).toBe('unmeasured');
  });

  it('the writer reads the designation: @overlord for the bound session only, none and a log line when it cannot be read', () => {
    const wrote: string[] = [];
    const logs: string[] = [];
    const fake = (d: ReturnType<PromptHandoffsCoord['designationRead']>): PromptHandoffsCoord => ({
      liveGenerations: () => { throw new Error('unused'); },
      bindingsOf: () => ({ claimant: () => ({ ok: true, siblings: [] }), worker: () => ({ ok: true, siblings: [] }) }) as never,
      putOperatorMark: (p) => { wrote.push(p); return { ok: true }; },
      designationRead: () => d,
    });
    const bound = { kind: 'designated', sessionId: ID, term: 1, row: {} } as never;
    expect(markOperatorPrompt(fake(bound), ID, 5, (l) => logs.push(l))).toBe(1);
    expect(markOperatorPrompt(fake(bound), 'lane-b-project-a', 5, (l) => logs.push(l))).toBe(0);
    expect(markOperatorPrompt(fake({ kind: 'unmeasured', why: 'x' }), ID, 5, (l) => logs.push(l))).toBe(0);
    expect(wrote).toEqual([OVERLORD_OPERATOR_MARK]);
    expect(logs).toEqual([`ccrc-server: prompt ${ID}: its runs or the designation could not be read, so no operator-at-programme mark was written`]);
  });
});

// ── The two paths that wrote none ────────────────────────────────────────────────────────────────────────────────────

describe('the terminal drawer\'s input writes the mark', () => {
  it('for the designated session: @overlord, at the wall time it was typed', async () => {
    const r = await rig();
    designate(r.coord);
    await drawerInput(r, 'h');
    await vi.waitFor(() => expect(marks(r.coord)).toEqual([{ programme: OVERLORD_OPERATOR_MARK, at: r.time.ports.clock.wall() }]), wait);
  });

  it('for a coordinator: its programme', async () => {
    const r = await rig();
    openRun(r.coord, 'prog-a');
    await drawerInput(r, 'h');
    await vi.waitFor(() => expect(marks(r.coord)).toEqual([{ programme: 'prog-a', at: r.time.ports.clock.wall() }]), wait);
  });
});

describe('the submit route writes the mark', () => {
  it('for the designated session: @overlord', async () => {
    const r = await rig();
    designate(r.coord);
    expect((await submit(r.app)).statusCode).toBe(200);
    expect(marks(r.coord)).toEqual([{ programme: OVERLORD_OPERATOR_MARK, at: r.time.ports.clock.wall() }]);
  });

  it('for a coordinator: its programme; a submit refused marks nothing', async () => {
    const r = await rig();
    openRun(r.coord, 'prog-a');
    expect((await r.app.inject({ method: 'POST', url: `/api/sessions/${ID}/submit`, payload: { expect: 'other' } })).statusCode).toBe(409);
    expect(marks(r.coord)).toEqual([]);
    expect((await submit(r.app)).statusCode).toBe(200);
    expect(marks(r.coord)).toEqual([{ programme: 'prog-a', at: r.time.ports.clock.wall() }]);
  });
});

// ── Through the real pass: the operator who typed there keeps the permit waiting ───────────────────────────────────────

/** The session's generation (a coordinator of prog-a, or the Overlord with no reader running), at rest in shadow past its least
 *  age, a soft due every pass and a free hold table, the permit the real `softRenewalMay`; on the store the server wrote the
 *  mark into. */
function passOver(s: CoordStore, t: FakeTime, role: 'coordinator' | 'overlord' = 'coordinator'): { pass(): ReturnType<typeof generationsPass>; soft: SoftInputs[] } {
  const st = s.insertStart({ sessionId: ID, reportId: 'r-1', uuid: U1, source: 'startup', model: 'claude-opus-5-5', rowIncarnation: 'inc',
    reportedAt: t.ports.clock.wall(), receivedAt: t.ports.clock.wall() });
  if (!st.ok) throw new Error('start');
  const w = s.mintGeneration({ identity: role === 'overlord' ? 'overlord' : ID, sessionId: ID, role, term: 1, rowIncarnation: 'inc', startId: st.id,
    startReportedAt: t.ports.clock.wall(), resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'woken',
    mono: 1_000, proc: 'p1', now: t.ports.clock.wall() }, null, false);
  if (!w.ok) throw new Error('mint');
  s.db.prepare('UPDATE continuity_generations SET shadowState = NULL, walk = NULL, shadowDeadlineAt = NULL, mintedObservedMs = ? WHERE id = ?')
    .run(-LEAST_AGE_MS, w.id);
  s.advanceCursor({ lane: 'generations', from: 0, to: st.id });
  const registry: RegistryFacts[] = [{ id: ID, uuid: U1, lane: 'lane-a', child: { kind: 'none' } }];
  const free: GenReadings = { usage: { kind: 'absent' }, compactions: { kind: 'absent' }, turn: { ok: false, reason: 'absent' } as never,
    behind: { kind: 'measured', value: false }, drain: { held: false },
    ...(role === 'overlord' ? { soft: { readersRunning: { kind: 'measured' as const, value: 0 } } } : {}) };
  const soft: SoftInputs[] = [];
  const pass = () => {
    const deps: GenerationsDeps = { coord: s, clock: t.ports.clock, entropy: t.ports.entropy, proc: 'p1', log: () => {}, retried: new Set(),
      emptyTries: new Map(), gate: () => null, decide: {
        renewalDue: () => ({ due: true, cls: 'soft', why: 'two-compactions', blind: [] }),
        softRenewalMay: (i) => { soft.push(i); return softRenewalMay(i); },
      } };
    return generationsPass(deps, { registry, readings: new Map([[w.id, free]]), listedAt: t.ports.clock.wall() + 1, canRenew: true });
  };
  return { pass, soft };
}

describe('the real pass: input through either path within the break window keeps the permit waiting', () => {
  for (const [name, act] of [
    ['the drawer', async (r: Awaited<ReturnType<typeof rig>>) => drawerInput(r, 'h')],
    ['the submit route', async (r: Awaited<ReturnType<typeof rig>>) => { expect((await submit(r.app)).statusCode).toBe(200); }],
  ] as const) {
    it(`a coordinator the operator typed to through ${name} waits for a break`, async () => {
      const r = await rig();
      openRun(r.coord, 'prog-a');
      await act(r);
      await vi.waitFor(() => expect(marks(r.coord)).toHaveLength(1), wait);
      const t = fakeTime({ wallMs: r.time.ports.clock.wall(), monoMs: 1_000 });
      const f = passOver(r.coord, t);
      expect(f.pass().waits).toMatchObject({ 'no-break': 1 });
      expect(f.soft.at(-1)?.operatorQuietObservedMs).toEqual({ kind: 'measured', value: 0 });
    });
  }

  for (const [name, act] of [
    ['the drawer', async (r: Awaited<ReturnType<typeof rig>>) => drawerInput(r, 'h')],
    ['the submit route', async (r: Awaited<ReturnType<typeof rig>>) => { expect((await submit(r.app)).statusCode).toBe(200); }],
  ] as const) {
    it(`the Overlord the operator typed to through ${name}, no reader running, keeps the permit waiting`, async () => {
      const r = await rig();
      designate(r.coord);
      await act(r);
      await vi.waitFor(() => expect(marks(r.coord)).toEqual([{ programme: OVERLORD_OPERATOR_MARK, at: r.time.ports.clock.wall() }]), wait);
      const f = passOver(r.coord, fakeTime({ wallMs: r.time.ports.clock.wall(), monoMs: 1_000 }), 'overlord');
      const res = f.pass();
      expect(f.soft.at(-1)?.operatorQuietObservedMs).toEqual({ kind: 'measured', value: 0 });
      expect(f.soft.at(-1)?.readersRunning).toEqual({ kind: 'measured', value: 0 });
      // Not a break: the quiet is measured 0, and the place-hidden input is still the lane's W1, so the permit waits `unmeasured`.
      expect(res.waits).toEqual({ unmeasured: 1 });
    });
  }

  it('control: with no input the Overlord\'s permit, no reader running, starts (the break the mark keeps shut)', () => {
    const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-mark-paths-ovl-'), '.ccrc', 'coord.db')));
    designate(s);
    const f = passOver(s, fakeTime({ wallMs: FAKE_T0, monoMs: 1_000 }), 'overlord');
    expect(f.pass().waits).toEqual({});
    expect(f.soft.at(-1)?.operatorQuietObservedMs).toEqual({ kind: 'measured', value: 30 * 60_000 });
  });

  it('control: with no input the same coordinator\'s permit starts', () => {
    const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-mark-paths-ctl-'), '.ccrc', 'coord.db')));
    openRun(s, 'prog-a');
    const f = passOver(s, fakeTime({ wallMs: FAKE_T0, monoMs: 1_000 }));
    expect(f.pass().waits).toEqual({});
  });
});
