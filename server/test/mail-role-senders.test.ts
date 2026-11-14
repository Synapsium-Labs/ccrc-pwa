// The role `timer` (Overlord W1a timers, Task 7; spec §3.3.12, C63). The timer lane's mail comes from the role `timer`,
// never `operator`: it carries a session's own words, as untrusted data, back to that session. A role is not a session
// id, so every reader that treats a `fromId` as one must know it (`MAIL_ROLE_IDS`, `coord/rundefs.ts`):
//  - `FleetWatcher.mailSender`: a parked or held mail from a role resolves to no sender, so no park notice is mailed to
//    `timer` and no push is tagged with it;
//  - the revive select: a run-bound timer mail comes back with its recipient while its run is open (the reminder is
//    still owed: `timer` is not in `REVIVE_SKIPPED_SENDERS`), and a run-less one never does (the select's join);
//  - `CoordStore.runLastMoves`: no role sender is a move, and a timer mail never was (it reads only the run's own
//    sessions);
//  - `POST /api/mail`: no session can send as `timer`, which has no registry row.
// The pins below were first written green against the build before the row (what a rollback lands on), then flipped
// where the row changes the answer. Fixtures use neutral ids (this repository is public).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { buildServer, type Deps } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { MAIL_ROLE_IDS } from '../src/coord/rundefs.js';
import { REVIVE_SKIPPED_SENDERS } from '../src/coord/mailRevive.js';
import { sessionDeadError } from '../src/coord/delivery.js';
import { TIMER_MAIL_SENDER } from '../../shared/continuity-timers.js';
import type { PushPayload } from '../src/push.js';
import { testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_800_000_000_000;
const ID = 'lane-a-project-a';
const UUID = 'a'.repeat(36);
const PID = 4242;
const TOKEN = 'f'.repeat(64);
const MAIL_QUIET_MS = 60_000;
const MAIL_MAX_ATTEMPTS = 6;
const TIMER = 'timer';

const seedRegistry = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'project-a', workdir: '/w/project-a', uuid: UUID, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};
const seedRecipient = (home: string): void => {
  seedRegistry(home, ID);
  const reg = path.join(home, '.cc-sessions');
  writeFileSync(path.join(reg, `${ID}.hookstate.json`), JSON.stringify({
    v: 1, state: 'done', sessionId: UUID, pid: PID, event: null, updatedAt: NOW - 61_000, ask: null, subagents: [],
  }));
  const live = path.join(home, '.claude', 'sessions');
  mkdirSync(live, { recursive: true });
  writeFileSync(path.join(live, `${PID}.json`), JSON.stringify({
    pid: PID, sessionId: UUID, cwd: '/w/project-a', name: null, nameSource: null,
    status: 'idle', statusUpdatedAt: NOW - MAIL_QUIET_MS - 1_000, version: '2.1.220',
  }));
};

const store = (home: string): CoordStore => new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));

/** A tmux runner whose `capture-pane` always shows `pane`, so the mail gate holds or fails in one known way. */
const harness = (pane: string): { home: string; run: Runner } => {
  const home = mkTmp('ccrc-role-senders-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session' || args[0] === 'send-keys') return { ran: true, code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: pane, stderr: '' };
    return { ran: true, code: 1, stdout: '', stderr: '' };
  };
  return { home, run };
};

const primedWatcher = async (h: { home: string; run: Runner }, coord: CoordStore,
                             sent: PushPayload[]): Promise<FleetWatcher> => {
  const deps: Deps = { ...testDeps(h.home, h.run), coord,
    push: { notify: async (p: PushPayload) => { sent.push(p); } } as never };
  const w = new FleetWatcher(withFakeClock(deps), new Bus(), 2000);
  await w.tick();
  return w;
};

const queueFrom = (coord: CoordStore, fromId: string, runId: number | null): { mailId: number; id: number } => {
  const mail = coord.insertMail({ fromId, fromUuid: `u-${fromId}`, toId: ID, runId,
    kind: 'status', subject: 'timer: 1 due (7)', body: 'b', artifacts: [] });
  return { mailId: mail.id, id: coord.queueDelivery(mail.id, ID, 'envelope').id };
};

/** The park notices `tellParkedSender` queued: system mail from `operator` with no run. */
const parkNoticesTo = (coord: CoordStore, toId: string): number =>
  (coord.db.prepare("SELECT COUNT(*) AS n FROM mail WHERE fromId = 'operator' AND toId = ? AND subject LIKE 'mail %'")
    .get(toId) as { n: number }).n;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); });

describe('the role timer is a role (C63)', () => {
  it('is the shared vocabulary word, and a role id', () => {
    expect(TIMER_MAIL_SENDER).toBe(TIMER);
    expect(MAIL_ROLE_IDS.has(TIMER)).toBe(false);
    expect(REVIVE_SKIPPED_SENDERS).not.toContain(TIMER);
  });
});

describe('FleetWatcher.mailSender: a timer mail resolves to no sender', () => {
  it('a held timer mail pushes nothing: no push is tagged with the role', async () => {
    const h = harness('Usage limit reached · continuing automatically at 11:50am · esc or type to cancel\n❯ \n');
    const coord = store(h.home);
    const sent: PushPayload[] = [];
    const w = await primedWatcher(h, coord, sent);
    seedRecipient(h.home);
    queueFrom(coord, TIMER, null);

    await w.sweepMail();
    expect(sent.map((p) => p.sessionId)).toEqual([TIMER]);
  });

  it('a parked timer mail mails no park notice to the role, and its one push names the recipient', async () => {
    const h = harness('❯ half-typed draft\n');
    const coord = store(h.home);
    const sent: PushPayload[] = [];
    const w = await primedWatcher(h, coord, sent);
    seedRecipient(h.home);
    const { id } = queueFrom(coord, TIMER, null);
    coord.db.prepare('UPDATE mail_deliveries SET attempts = ? WHERE id = ?').run(MAIL_MAX_ATTEMPTS - 1, id);

    await w.sweepMail();
    expect((coord.db.prepare('SELECT state, lastError FROM mail_deliveries WHERE id = ?').get(id) as
      { state: string }).state).toBe('queued');
    expect(parkNoticesTo(coord, TIMER)).toBe(1);
    expect(sent.map((p) => p.sessionId)).toEqual([TIMER]);
  });

  it('a session sender is still told and pushed (the control)', async () => {
    const h = harness('❯ half-typed draft\n');
    const coord = store(h.home);
    const sent: PushPayload[] = [];
    const w = await primedWatcher(h, coord, sent);
    seedRecipient(h.home);
    seedRegistry(h.home, 'lane-b-project-a');
    const { id } = queueFrom(coord, 'lane-b-project-a', null);
    coord.db.prepare('UPDATE mail_deliveries SET attempts = ? WHERE id = ?').run(MAIL_MAX_ATTEMPTS - 1, id);

    await w.sweepMail();
    expect(parkNoticesTo(coord, 'lane-b-project-a')).toBe(1);
    expect(sent.map((p) => p.sessionId)).toEqual(['lane-b-project-a']);
  });
});

describe('the revive select: a run-bound timer mail is owed, a run-less one never comes back', () => {
  const openRun = (coord: CoordStore): number => {
    const opened = coord.openRun({ program: 'prog-a', title: 'T', project: 'project-a', wave: 1, waveOf: 3,
      claimedBy: 'lane-b-project-a' });
    if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
    coord.markDispatched(opened.id, ID, null, null, false, NOW - 60_000);
    return opened.id;
  };
  const parked = (coord: CoordStore, runId: number | null): number => {
    const { id } = queueFrom(coord, TIMER, runId);
    expect(coord.rejectDelivery(id, 'undeliverable', sessionDeadError('orphan')).changed).toBe(true);
    return id;
  };

  it('comes back with its recipient while its run is open', () => {
    const coord = store(mkTmp('ccrc-role-senders-'));
    const runId = openRun(coord);
    const d = parked(coord, runId);
    expect(coord.reviveParkedDeliveries([ID]).revived.map((r) => r.from)).toEqual([d]);
  });

  it('a run-less one never comes back', () => {
    const coord = store(mkTmp('ccrc-role-senders-'));
    openRun(coord);
    parked(coord, null);
    expect(coord.reviveParkedDeliveries([ID]).revived).toEqual([]);
  });
});

describe('CoordStore.runLastMoves: a timer mail never moves a run', () => {
  it('reads the run worker\'s own mail and never the role\'s, before and after the row', () => {
    const coord = store(mkTmp('ccrc-role-senders-'));
    const opened = coord.openRun({ program: 'prog-a', title: 'T', project: 'project-a', wave: 1, waveOf: 3,
      claimedBy: 'lane-b-project-a' });
    if (!('id' in opened)) throw new Error('fixture openRun refused');
    coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(ID, opened.id);
    const mailAt = (at: number, fromId: string): void => {
      coord.db.prepare("INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body) VALUES (?, ?, 'u', ?, ?, 'status', 's', 'b')")
        .run(at, fromId, ID, opened.id);
    };
    mailAt(NOW - 3_600_000, ID);
    mailAt(NOW - 60_000, TIMER);
    const read = coord.runLastMoves([opened.id]);
    if (!read.ok) throw new Error(read.detail);
    expect(read.moves.get(opened.id)).toBe(NOW - 3_600_000);
  });
});

describe('POST /api/mail: no session sends as the role', () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => { await app?.close(); app = null; });

  it('refuses fromId timer as unknown-sender: it has no registry row', async () => {
    const home = mkTmp('ccrc-role-senders-');
    seedRegistry(home, ID);
    const coord = store(home);
    app = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord });
    const res = await app.inject({ method: 'POST', url: '/api/mail', headers: { 'x-ccrc-mail-token': TOKEN },
      payload: { fromId: TIMER, fromUuid: UUID, toId: ID, kind: 'status', subject: 's', body: 'b', artifacts: [] } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'unknown-sender' });
  });
});
