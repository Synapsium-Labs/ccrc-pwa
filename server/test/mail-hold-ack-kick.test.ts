// server/test/mail-hold-ack-kick.test.ts
//
// The ack kicks the mailhold projection (mid-turn mail plan `docs/superpowers/plans/2026-11-19-mid-turn-mail.md` Task 4.4;
// spec §3.4). `POST /api/mail/:id/ack` calls the optional `Deps.onMailAcked` after `markAcked` commits, never awaited, and
// only when the ack landed; `index.ts` composes it as the watcher's `kick('mailHold')`. A kick that throws, or one that
// never settles, does not change the ack's answer. With a pass in flight, the kick leaves the row due, so the next beat
// runs one pass.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/deps.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { LaneRunner } from '../src/laneRunner.js';
import { LANE_SCHEDULE } from '../src/laneSchedule.js';
import { MAIL_HOLD_LANE_ROW } from '../src/coord/mailHoldLane.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const UUID = 'a'.repeat(36);
const COORD = 'lane-a-coordinator';
const WORKER = 'lane-a-worker';
const OTHER = 'lane-a-peer';

const seed = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'project-a', workdir: '/w/project-a', uuid: UUID, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const rig = async (onMailAcked?: Deps['onMailAcked']) => {
  const home = mkTmp('ccrc-ack-kick-');
  for (const id of [COORD, WORKER, OTHER]) seed(home, id);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const r = coord.openRun({ program: 'program-a', title: 'program-a', project: 'project-a', wave: 1, waveOf: 3, claimedBy: COORD });
  if (!('id' in r)) throw new Error('openRun refused');
  coord.setSession(r.id, WORKER);
  const mail = (toId: string): number => {
    const m = coord.insertMail({ fromId: COORD, fromUuid: UUID, toId, runId: r.id, kind: 'status', subject: 's', body: 'b',
      artifacts: [], urgentAs: 'coordinator' });
    return coord.queueDelivery(m.id, toId, `<mail>${m.id}</mail>`).id;
  };
  const app = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord,
    ...(onMailAcked === undefined ? {} : { onMailAcked }) });
  return { coord, app, runId: r.id, mail };
};

const ack = (app: FastifyInstance, delivery: number, fromId = WORKER) =>
  app.inject({ method: 'POST', url: `/api/mail/${delivery}/ack`, headers: { 'x-ccrc-mail-token': TOKEN },
    payload: { fromId, fromUuid: UUID } });

describe('POST /api/mail/:id/ack kicks the mailhold projection (Task 4.4)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { vi.restoreAllMocks(); if (app) await app.close(); app = undefined; });

  it('a landed ack kicks once, after the commit: the kick sees the delivery acked', async () => {
    const seen: (string | undefined)[] = [];
    let store: CoordStore | null = null;
    const r = await rig(() => { seen.push(store?.delivery(d)?.state); });
    app = r.app; store = r.coord;
    const d = r.mail(WORKER);
    const res = await ack(r.app, d);
    expect(res.statusCode, res.body).toBe(200);
    expect(seen).toEqual(['acked']);
  });

  it('a refused ack kicks nothing: not addressed to the caller, already acked, or parked', async () => {
    const kick = vi.fn();
    const r = await rig(kick); app = r.app;
    const theirs = r.mail(OTHER);
    expect((await ack(r.app, theirs)).json()).toMatchObject({ ok: false, error: 'unknown-recipient' });
    expect(kick).not.toHaveBeenCalled();
    const mine = r.mail(WORKER);
    expect((await ack(r.app, mine)).json()).toMatchObject({ ok: true, already: false });
    expect(kick).toHaveBeenCalledTimes(1);
    expect((await ack(r.app, mine)).json()).toMatchObject({ ok: true, already: true, parked: false });
    expect(kick).toHaveBeenCalledTimes(1);
    const parked = r.mail(WORKER);
    r.coord.cancelOutstandingDeliveries(r.runId);
    expect((await ack(r.app, parked)).json()).toMatchObject({ ok: true, already: true, parked: true });
    expect(kick).toHaveBeenCalledTimes(1);
  });

  it("the ack's answer is unchanged by the kick, by a kick that throws, and by one that never settles", async () => {
    const answers: unknown[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kicks: (Deps['onMailAcked'] | undefined)[] = [
      undefined,
      () => {},
      () => { throw new Error('the watcher is gone'); },
      (() => new Promise(() => {})) as unknown as Deps['onMailAcked'],
    ];
    for (const kick of kicks) {
      const r = await rig(kick); app = r.app;
      const res = await ack(r.app, r.mail(WORKER));
      answers.push([res.statusCode, res.json()]);
      await r.app.close(); app = undefined;
    }
    expect(answers).toEqual(Array(kicks.length).fill([200, { ok: true, already: false, parked: false, state: 'acked' }]));
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('mailhold kick'))).toHaveLength(1);
  }, 90_000);   // four servers, one after another
});

describe('the kick on a pass in flight (Task 4.4)', () => {
  it('leaves the row due, so the beat after the pass settles runs exactly one pass', async () => {
    const t = { wall: 1_000_000, mono: 5_000 };
    const runner = new LaneRunner({ wall: () => t.wall, mono: () => t.mono }, LANE_SCHEDULE, () => {});
    let passes = 0;
    let settle!: () => void;
    const pass = () => { passes += 1; return new Promise<void>((done) => { settle = done; }); };
    const first = runner.run(MAIL_HOLD_LANE_ROW, pass);
    expect(first).not.toBeNull();
    runner.kick(MAIL_HOLD_LANE_ROW);   // the ack lands while the pass walks its rows
    expect(runner.run(MAIL_HOLD_LANE_ROW, pass)).toBeNull();   // a skip row: no second pass beside the first
    settle();
    await first;
    const next = runner.run(MAIL_HOLD_LANE_ROW, pass);   // no time has passed: only the kick makes it due
    expect(next).not.toBeNull();
    settle();
    await next;
    expect(runner.run(MAIL_HOLD_LANE_ROW, pass)).toBeNull();   // one pass for the kick, not a pass per beat
    expect(passes).toBe(2);
  });
});

describe('the composition root wires the kick (Task 4.4)', () => {
  it("index.ts composes Deps.onMailAcked as the watcher's kick of the mailhold row", () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/index.ts'), 'utf8');
    expect(src).toContain('deps.onMailAcked = () => watcher.kick(MAIL_HOLD_LANE_ROW);');
  });
});
