// server/test/mail-hold-lane.test.ts
//
// The mailhold projection's pass (mid-turn mail plan `docs/superpowers/plans/2026-11-19-mid-turn-mail.md` Task 4.3; spec
// §3.4), over a temporary `CoordStore` and a stubbed `runCcd`: it derives the hold from the store (never the mail lane's
// due list), renews on schedule, clears what nothing holds, skips what it cannot read or reach, logs a failed write once
// an episode, takes `until` from the wall clock, and sends one `routeSet` argv per session behind `route-mailhold-v1`. The
// end-to-end case runs the watcher's `tick()` under `mail-disabled` and waits on the lane's flight, as `pr-sweep.test.ts`
// does, so a negative assertion cannot pass while the sweep is still running.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { ACTOR_FLAGS_CAP, MAILHOLD_ROUTE_CAP, ROUTE_CAP, type CcdArgv } from '../src/ccdargv.js';
import type { CcdResult } from '../src/coord/ports.js';
import {
  MAIL_HOLD_LANE_ROW, mailHoldPass, type MailHoldLaneDeps, type MailHoldLaneMemory, type MailHoldRow,
} from '../src/coord/mailHoldLane.js';
import { MAIL_REPLAY_MS, type RouteFields } from '../../shared/api.js';
import { MAILHOLD_LEASE_S } from '../../shared/mailHold.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import type { Runner } from '../src/exec.js';
import type { Deps } from '../src/deps.js';
import { testDeps, withFakeClock } from './helpers.js';
import { quietAtTestEnd } from './laneQuiet.js';   // D-8140: nothing a watcher fires outlives its test
import { mkTmp } from './tmpHelpers.js';

const T0_MS = 1_800_000_000_000;
const T0 = T0_MS / 1000;
const WORKER = 'lane-a-worker';
const OTHER = 'lane-a-other';
const COORD = 'lane-a-coordinator';
const CAPABLE = { ccdVerbs: [ROUTE_CAP, MAILHOLD_ROUTE_CAP, ACTOR_FLAGS_CAP] };

const newStore = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-mail-hold-lane-'), '.ccrc', 'coord.db')));

/** One urgent mail to `to`, delivered at `atMs`: the mail lane leaves it alone for `MAIL_REPLAY_MS`. Answers its delivery id. */
const urgentDelivered = (s: CoordStore, to: string, atMs: number, urgentAs: 'coordinator' | 'overlord' = 'coordinator'): number => {
  const m = s.insertMail({ fromId: COORD, fromUuid: 'u-coordinator', toId: to, runId: null, kind: 'status', subject: 'urgent',
    body: 'x', artifacts: [], urgentAs });
  const d = s.queueDelivery(m.id, to, `<mail>${m.id}</mail>`).id;
  s.markDelivered(d, atMs);
  return d;
};

const row = (id: string, fields: RouteFields | null, unreadable: string[] = []): MailHoldRow => ({
  id, route: fields === null && unreadable.length === 0 ? null
    : { fields: fields ?? {}, degraded: null, inert: [], unreadable: unreadable as never },
});

const ok = { ok: true, stdout: '', stderr: '', killed: false, signal: null, ran: true } as CcdResult;
const refused = { ok: false, stdout: '', stderr: 'ccd: mailhold-far: until is past\n', killed: false, signal: null, ran: true } as CcdResult;
const notRan = { ok: false, stdout: '', stderr: 'link down', killed: 'unmeasured', signal: 'unmeasured', ran: false } as unknown as CcdResult;

function harness(s: CoordStore, o: { wallMs?: number; verbs?: string[] | null; answer?: (argv: string[]) => CcdResult } = {}): {
  deps: MailHoldLaneDeps; sent: string[][]; logs: string[]; queries: () => number;
} {
  const sent: string[][] = [];
  const logs: string[] = [];
  let queries = 0;
  const memory: MailHoldLaneMemory = { failing: new Set(), lastLine: null, storeUnread: false };
  const deps: MailHoldLaneDeps = {
    coord: { urgentHolds: () => { queries += 1; return s.urgentHolds(); } },
    runCcd: async (argv: CcdArgv) => { sent.push([...argv]); return o.answer?.([...argv]) ?? ok; },
    fleetState: o.verbs === null ? undefined : { ccdVerbs: o.verbs ?? CAPABLE.ccdVerbs },
    wallMs: () => o.wallMs ?? T0_MS,
    log: (l) => logs.push(l),
    memory,
  };
  return { deps, sent, logs, queries: () => queries };
}
/** The `--set` values of one argv. */
const sets = (argv: readonly string[]): string[] => argv.flatMap((a, i) => (argv[i - 1] === '--set' ? [a] : []));

describe('the mailhold pass (Task 4.3)', () => {
  it('renews a lease on schedule while the mail lane will not retry its delivery for 600 s (it reads the store, not the due list)', async () => {
    const s = newStore();
    const d = urgentDelivered(s, WORKER, T0_MS);
    const t1Ms = T0_MS + 200_000;   // the lease written at T0 has 100 s left: fewer than 120, so it renews
    expect(s.dueDeliveries(t1Ms, MAIL_REPLAY_MS).map((r) => r.id), 'the mail lane would not touch it now').not.toContain(d);
    const h = harness(s, { wallMs: t1Ms });
    const r = await mailHoldPass(h.deps, [row(WORKER, { mailhold: `${T0 + MAILHOLD_LEASE_S}:coordinator.${d}` })], false);
    expect(r).toMatchObject({ renewed: 1, appeared: 0, differed: 0, cleared: 0 });
    expect(h.sent.map(sets)).toEqual([[`mailhold=${t1Ms / 1000 + MAILHOLD_LEASE_S}:coordinator.${d}`]]);
  });

  it('writes a marker for a new hold, with each delivery\'s role, and leaves a matching one with time left alone', async () => {
    const s = newStore();
    const a = urgentDelivered(s, WORKER, T0_MS);
    const b = urgentDelivered(s, WORKER, T0_MS, 'overlord');
    const h = harness(s);
    expect(await mailHoldPass(h.deps, [row(WORKER, null)], false)).toMatchObject({ appeared: 1 });
    const v = `${T0 + MAILHOLD_LEASE_S}:coordinator.${a},overlord.${b}`;
    expect(h.sent.map(sets)).toEqual([[`mailhold=${v}`]]);
    const again = harness(s, { wallMs: T0_MS + 60_000 });
    expect(await mailHoldPass(again.deps, [row(WORKER, { mailhold: v })], false)).toMatchObject({ appeared: 0, renewed: 0 });
    expect(again.sent).toEqual([]);
  });

  it('clears a marker the derived hold does not hold, a forged one included', async () => {
    const s = newStore();
    const h = harness(s);
    const r = await mailHoldPass(h.deps, [row(WORKER, { mailhold: `${T0 + 200}:coordinator.99` }), row(OTHER, { mailhold: 'forged' })], false);
    expect(r).toMatchObject({ cleared: 2 });
    expect(h.sent.map(sets)).toEqual([['mailhold='], ['mailhold=']]);
    expect(h.sent.every((a) => a.includes('route') && a.includes('--session'))).toBe(true);
  });

  it('acking the urgent mail releases the hold, so the next pass clears the marker', async () => {
    const s = newStore();
    const d = urgentDelivered(s, WORKER, T0_MS);
    const v = `${T0 + MAILHOLD_LEASE_S}:coordinator.${d}`;
    s.markAcked(d, T0_MS + 1000);
    const h = harness(s);
    expect(await mailHoldPass(h.deps, [row(WORKER, { mailhold: v })], false)).toMatchObject({ cleared: 1 });
    expect(h.sent.map(sets)).toEqual([['mailhold=']]);
  });

  it('skips a held recipient the registry does not list, and writes nothing for it', async () => {
    const s = newStore();
    urgentDelivered(s, WORKER, T0_MS);
    const h = harness(s);
    const r = await mailHoldPass(h.deps, [row(OTHER, null)], false);
    expect(r).toMatchObject({ unlisted: 1, appeared: 0 });
    expect(h.sent).toEqual([]);
  });

  it('a pass with no urgent mail outstanding and no marker writes nothing, after one store query', async () => {
    const s = newStore();
    const h = harness(s);
    await mailHoldPass(h.deps, [row(WORKER, null), row(OTHER, { class: 'opus' })], false);
    expect(h.sent).toEqual([]);
    expect(h.queries()).toBe(1);
    expect(h.logs).toEqual([]);
  });

  it('a failed write is logged once an episode and retried every pass; a success ends the episode', async () => {
    const s = newStore();
    urgentDelivered(s, WORKER, T0_MS);
    let answer = refused;
    const h = harness(s, { answer: () => answer });
    for (let i = 0; i < 3; i += 1) expect(await mailHoldPass(h.deps, [row(WORKER, null)], false)).toMatchObject({ failed: 1 });
    expect(h.sent).toHaveLength(3);
    const fails = () => h.logs.filter((l) => l.includes('failed, retried each pass'));
    expect(fails()).toEqual([`ccrc-server: mailhold: the write for ${WORKER} failed, retried each pass: ccd: mailhold-far: until is past`]);
    answer = ok;
    expect(await mailHoldPass(h.deps, [row(WORKER, null)], false)).toMatchObject({ appeared: 1, failed: 0 });
    answer = notRan;
    await mailHoldPass(h.deps, [row(WORKER, null)], false);
    expect(fails()).toHaveLength(2);
    expect(fails()[1]).toBe(`ccrc-server: mailhold: the write for ${WORKER} failed, retried each pass: ccd did not run, so the write is unmeasured`);
  });

  it('takes the lease\'s until from the wall clock it is handed, never another clock', async () => {
    const s = newStore();
    const d = urgentDelivered(s, WORKER, T0_MS);
    const wallMs = T0_MS + 12_345_678;
    const h = harness(s, { wallMs });
    await mailHoldPass(h.deps, [row(WORKER, null)], false);
    expect(h.sent.map(sets)).toEqual([[`mailhold=${Math.floor(wallMs / 1000) + MAILHOLD_LEASE_S}:coordinator.${d}`]]);
  });

  it('sends one routeSet argv per session, only behind route-mailhold-v1 and the route verb', async () => {
    const s = newStore();
    const a = urgentDelivered(s, WORKER, T0_MS);
    const b = urgentDelivered(s, WORKER, T0_MS);
    urgentDelivered(s, OTHER, T0_MS);
    const h = harness(s);
    await mailHoldPass(h.deps, [row(WORKER, null), row(OTHER, null)], false);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[0]!.slice(0, 3)).toEqual(['route', '--session', WORKER]);
    expect(sets(h.sent[0]!)).toEqual([`mailhold=${T0 + MAILHOLD_LEASE_S}:coordinator.${a},coordinator.${b}`]);
    expect(h.sent[0]).toEqual(expect.arrayContaining(['--actor', 'mailhold lane']));
    for (const verbs of [[ROUTE_CAP, ACTOR_FLAGS_CAP], [MAILHOLD_ROUTE_CAP], null]) {
      const n = harness(s, { verbs });
      expect(await mailHoldPass(n.deps, [row(WORKER, null), row(OTHER, { mailhold: 'x' })], false), String(verbs)).toMatchObject({ incapable: 2 });
      expect(n.sent).toEqual([]);
    }
  });

  it('skips a marker the registry could not read, and a row whose id it refuses', async () => {
    const s = newStore();
    urgentDelivered(s, WORKER, T0_MS);
    const h = harness(s);
    const r = await mailHoldPass(h.deps, [row(WORKER, null, ['mailhold']), row('-bad', { mailhold: 'x' })], false);
    expect(r).toMatchObject({ unreadable: 1, unlisted: 1 });
    expect(h.sent).toEqual([]);
  });

  it('a store read that throws writes and clears nothing, is logged once an episode, and never escapes the pass', async () => {
    const s = newStore();
    const h = harness(s);
    let broken = true;
    h.deps = { ...h.deps, coord: { urgentHolds: () => { if (broken) throw new Error('database is locked'); return s.urgentHolds(); } } };
    for (let i = 0; i < 3; i += 1) {
      expect(await mailHoldPass(h.deps, [row(WORKER, { mailhold: `${T0 + 250}:coordinator.5` })], false)).toMatchObject({ storeUnread: true, cleared: 0 });
    }
    expect(h.sent).toEqual([]);
    expect(h.logs.filter((l) => l.includes('could not be read'))).toEqual(['ccrc-server: mailhold: the urgent hold could not be read, so no marker is written or cleared this pass: database is locked']);
    broken = false;
    expect(await mailHoldPass(h.deps, [row(WORKER, { mailhold: `${T0 + 250}:coordinator.5` })], false)).toMatchObject({ storeUnread: false, cleared: 1 });
    broken = true;
    await mailHoldPass(h.deps, [row(WORKER, null)], false);
    expect(h.logs.filter((l) => l.includes('could not be read'))).toHaveLength(2);
  });

  it('under mail-disabled it only clears, and reads no store', async () => {
    const s = newStore();
    const d = urgentDelivered(s, WORKER, T0_MS);
    urgentDelivered(s, OTHER, T0_MS);
    const h = harness(s);
    const r = await mailHoldPass(h.deps, [row(WORKER, { mailhold: `${T0 + 250}:coordinator.${d}` }), row(OTHER, null)], true);
    expect(r).toMatchObject({ cleared: 1, appeared: 0, mailDisabled: true });
    expect(h.sent.map(sets)).toEqual([['mailhold=']]);
    expect(h.queries()).toBe(0);
  });
});

describe('the mailhold sweep in the watcher\'s tick, under mail-disabled, end to end (Task 4.3)', () => {
  const watchers: FleetWatcher[] = [];
  afterEach(() => { watchers.length = 0; });

  function seedHome(): string {
    const home = mkTmp('ccrc-mail-hold-e2e-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    for (const [f, v] of [['uuid', 'u-worker'], ['wrapper', 'claude'], ['workdir', '/w/a'], ['project', 'project-a'],
      ['workspace', 'a'], ['branch', 'ws/a'], ['base', 'origin/main']]) writeFileSync(path.join(reg, `${WORKER}.${f}`), v!);
    return home;
  }

  it('with $REG/mail-disabled present and a marker standing, the tick still runs the sweep, which sends one clearing argv', async () => {
    const home = seedHome();
    const reg = path.join(home, '.cc-sessions');
    const s = newStore();
    const d = urgentDelivered(s, WORKER, Date.now());
    writeFileSync(path.join(reg, `${WORKER}.mailhold`), `${Math.floor(Date.now() / 1000) + 200}:coordinator.${d}`);
    const calls: string[][] = [];
    const run: Runner = async (_cmd, args) => {
      calls.push([...args]);
      if (args[0] === 'route') return { ran: true, code: 0, stdout: '', stderr: '' };
      return { ran: true, code: 1, stdout: '', stderr: '' };
    };
    const deps: Deps = { ...testDeps(home, run), coord: s,
      fleetState: { connected: true, downSince: null, ccdVerbs: CAPABLE.ccdVerbs, rosterFp: null, build: null } } as Deps;
    const w = quietAtTestEnd(new FleetWatcher(withFakeClock(deps), new Bus(), 2000, path.join(home, 'state-cache.json')));
    watchers.push(w);
    await w.tick();   // primes
    writeFileSync(path.join(reg, 'mail-disabled'), '');
    // An urgent delivery queued meanwhile adds no marker.
    urgentDelivered(s, WORKER, Date.now());
    calls.length = 0;
    w.kick(MAIL_HOLD_LANE_ROW);
    await w.tick();
    await w.inFlight(MAIL_HOLD_LANE_ROW);
    const routes = calls.filter((a) => a[0] === 'route');
    expect(routes, JSON.stringify(calls)).toHaveLength(1);
    expect(sets(routes[0]!)).toEqual(['mailhold=']);
    expect(routes[0]!.slice(0, 3)).toEqual(['route', '--session', WORKER]);
  });
});
