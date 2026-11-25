// The Overlord's timer mail and its fixed line in the mail lane (Overlord W1, C61/C62): a fired timer's mail row is from `timer` to
// the ROLE (`overlord`), its one delivery queued to the designated session. `sweepMail` types `renderTimerFiredLine(subject)` only
// once the live generation's card reads current (`timerLineHold`), acks it on its first delivery, and never types it twice. A
// coordinator's session-keyed timer mail keeps the generic nudge; an unmeasured designation delivers nothing. Driven through the
// real sweep over a fixture coord.db, the way `overlord-prompt-record.test.ts` drives its fixed lines; real generation, start,
// snapshot and card-read writers; the designation and (for the unmeasured read) the card read are spied. Fixture HOMEs only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Deps } from '../src/server.js';
import type { Runner } from '../src/exec.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { FleetWatcher } from '../src/watch.js';
import { renderMailNudge, renderTimerFiredLine } from '../src/coord/envelope.js';
import { genExpectOf } from '../src/continuity/continuityStore.js';
import { GEN_ACTIVE } from '../src/continuity/generationMachine.js';
import { TIMER_MAIL_SENDER } from '../../shared/continuity-timers.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import { testDeps, withFakeClock } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { quietAtTestEnd } from './laneQuiet.js';

const ID = 'lane-a-project-a';
const UUID = 'a'.repeat(36);
const PID = 4242;
const NOW = 1_800_000_000_000;
const MAIL_QUIET_MS = 60_000;
const MAIL_REPLAY_MS = 600_000;
const MAIL_SWEEP_MS = 10_000;   // the mail lane's cadence (`laneSchedule.ts`): a second sweep inside it does not run
const SUBJECT = 'timer: 2 due';
const emptyBox = '❯ \n';
const echoedBox = (text: string): string => `❯ ${text}\n`;
const TIMER_LINE = renderTimerFiredLine(SUBJECT);

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); removeTmpFixtures(); });
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });

const seedRegistry = (home: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid: UUID, started: '1' })) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  writeFileSync(path.join(reg, `${ID}.hookstate.json`), JSON.stringify({ v: 1, state: 'done', sessionId: UUID, pid: PID, event: null, updatedAt: NOW - 61_000, ask: null, subagents: [] }));
  const dir = path.join(home, '.claude', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${PID}.json`), JSON.stringify({ pid: PID, sessionId: UUID, cwd: '/w/demo', name: null, nameSource: null, status: 'idle', statusUpdatedAt: NOW - MAIL_QUIET_MS - 1_000, version: '2.1.220' }));
};

/** A tmux double: every call recorded, the pane answers the scripted boxes in order (the last one repeats). */
const lane = (panes: string[]) => {
  const home = mkTmp('ccrc-timer-line-lane-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const calls: string[][] = [];
  let capIdx = 0;
  const run: Runner = async (_cmd, args) => {
    calls.push([...args]);
    if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane') { const pane = panes[Math.min(capIdx, panes.length - 1)] ?? ''; capIdx++; return { ran: true, code: 0, stdout: pane, stderr: '' }; }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  return { home, calls, run };
};
const literalSends = (calls: string[][]): string[] => calls.filter((a) => a[0] === 'send-keys' && a[3] === '-l').map((a) => a[5]!);
const keyPresses = (calls: string[][]): string[] => calls.filter((a) => a[0] === 'send-keys' && a[3] !== '-l').map((a) => a[3]!);

/** The next sweep, one cadence later: the lane's schedule skips a sweep that comes sooner. */
const sweepAgain = async (w: FleetWatcher): Promise<void> => { vi.setSystemTime(Date.now() + MAIL_SWEEP_MS + 1); await w.sweepMail(); };

const primed = async (panes: string[]) => {
  const h = lane(panes);
  const coord = new CoordStore(openCoordDb(path.join(h.home, '.ccrc', 'coord.db')));
  const deps = { ...testDeps(h.home, h.run), coord } as Deps;
  const w = quietAtTestEnd(new FleetWatcher(withFakeClock(deps), new Bus(), 2000));
  await w.tick();
  seedRegistry(h.home);
  return { h, coord, w };
};

const designate = (coord: CoordStore, id: string): void => {
  coord.designationRead = () => ({ kind: 'designated', sessionId: id, term: 1,
    row: { bound: { sessionId: id, generation: 'inc-1' }, pending: null, term: 1, designatedTerm: 1 } }) as unknown as DesignationRead;
};

/** The live Overlord generation, through the real writers: a start by the registry's conversation, then the minted generation. */
const mintOverlord = (coord: CoordStore): number => {
  const s = coord.insertStart({ sessionId: ID, reportId: 'ro-1', uuid: UUID, source: 'startup', model: null, rowIncarnation: null, reportedAt: NOW - 5_000, receivedAt: NOW - 5_000 });
  if (!s.ok) throw new Error('start');
  const m = coord.mintGeneration({ identity: 'overlord', sessionId: ID, role: 'overlord', term: 1, rowIncarnation: null, startId: s.id, startReportedAt: NOW - 5_000,
    resumed: false, model: null, lane: 'lane-a', host: null, outcome: 'renewed', mono: 1, proc: 'p', now: NOW - 5_000 }, null, true);
  if (!m.ok) throw new Error(m.kind);
  // A freshly minted generation is `carded`, a renewing state that holds every mail (`renewing`): step it to `active`, so only
  // the card hold is under test.
  const live = coord.liveGenerations();
  const row = live.ok ? live.rows.find((g) => g.identity === 'overlord') : undefined;
  if (row === undefined || !coord.stepGeneration(row.id, genExpectOf(row), GEN_ACTIVE, true, NOW - 4_500).changed) throw new Error('step to active');
  return s.id;
};
const serveCard = (coord: CoordStore, snapshotId: string, hash: string, at: number): void => {
  if (!coord.insertSnapshot({ id: snapshotId, sessionId: ID, at, facts: '{}', hash }).ok) throw new Error('snapshot');
};
const readCard = (coord: CoordStore, snapshotId: string, hash: string): void => {
  if (!coord.insertCardRead({ sessionId: ID, uuid: UUID, snapshotId, hash, pages: 1, at: NOW - 1_000 }).ok) throw new Error('card read');
};

/** The role's timer mail, as the timer lane writes it: from `timer`, to the role, one delivery queued to the designated session. */
const queueTimer = (coord: CoordStore, toId = 'overlord', session = ID, fromId: string = TIMER_MAIL_SENDER): number => {
  const mail = coord.insertMail({ fromId, fromUuid: fromId, toId, runId: null, kind: 'status', subject: SUBJECT, body: 'b', artifacts: [] });
  return coord.queueDelivery(mail.id, session, 'ccrc-mail test payload').id;
};
const rowOf = (coord: CoordStore, id: number): { state: string; attempts: number } =>
  coord.db.prepare('SELECT state, attempts FROM mail_deliveries WHERE id = ?').get(id) as never;
/** The mail lane's own gate word, written by every `gated(...)` hold; the card hold `continue`s before it, so it stays null. */
const gateOf = (coord: CoordStore, id: number): string | null =>
  (coord.db.prepare('SELECT lastGate FROM mail_deliveries WHERE id = ?').get(id) as { lastGate: string | null }).lastGate;

describe('the Overlord\'s timer line waits for its card', () => {
  const heldCases: [string, (coord: CoordStore) => void][] = [
    ['no card read at all (fact none)', (c) => { mintOverlord(c); serveCard(c, 's1', 'h1', NOW - 4_000); }],
    ['a card read that is not the current card (read-stale)', (c) => {
      mintOverlord(c); serveCard(c, 's1', 'h1', NOW - 4_000); readCard(c, 's1', 'h1'); serveCard(c, 's2', 'h2', NOW - 500);
    }],
    ['no live generation at all', () => { /* nothing minted */ }],
    ['a card read that answers not ok (unmeasured)', (c) => {
      mintOverlord(c); serveCard(c, 's1', 'h1', NOW - 4_000); readCard(c, 's1', 'h1');
      vi.spyOn(c, 'cardReadOfStart').mockReturnValue({ ok: false, detail: 'fixture: unreadable' });
    }],
    ['a card read that throws (unmeasured)', (c) => {
      mintOverlord(c); serveCard(c, 's1', 'h1', NOW - 4_000); readCard(c, 's1', 'h1');
      vi.spyOn(c, 'cardReadOfStart').mockImplementation(() => { throw new Error('fixture: boom'); });
    }],
  ];
  for (const [name, arrange] of heldCases) {
    it(`is held with ${name}: nothing typed, no key, the delivery stays queued with its attempts unchanged`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { h, coord, w } = await primed([emptyBox, emptyBox, echoedBox(TIMER_LINE), emptyBox]);
      designate(coord, ID);
      arrange(coord);
      const id = queueTimer(coord);
      const before = rowOf(coord, id);
      expect(before.state).toBe('queued');
      await w.sweepMail();
      await sweepAgain(w);
      expect(literalSends(h.calls)).toEqual([]);
      expect(keyPresses(h.calls)).toEqual([]);
      expect(rowOf(coord, id)).toEqual(before);
      expect(gateOf(coord, id)).toBeNull();                        // held by the card hold, not by an earlier gate (`renewing`, `not-idle`)
    });
  }

  it('once the card reads current the next sweep types exactly the timer line, acks on the first delivery, and never types it again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // the held sweep still reads the box once (the fixed line's own pre-read), then the delivering sweep's three reads
    const { h, coord, w } = await primed([emptyBox, emptyBox, emptyBox, echoedBox(TIMER_LINE), emptyBox]);
    designate(coord, ID);
    mintOverlord(coord);
    serveCard(coord, 's1', 'h1', NOW - 4_000);
    const id = queueTimer(coord);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([]);
    expect(rowOf(coord, id)).toEqual({ state: 'queued', attempts: 0 });
    expect(gateOf(coord, id)).toBeNull();
    readCard(coord, 's1', 'h1');                                   // the conversation reads the current card
    await sweepAgain(w);
    expect(literalSends(h.calls)).toEqual([TIMER_LINE]);
    expect(TIMER_LINE).toContain('2 of your timers came due');
    expect(TIMER_LINE).not.toContain('ccrc-api');
    expect(rowOf(coord, id).state).toBe('acked');
    vi.setSystemTime(NOW + MAIL_REPLAY_MS * 3);                    // far past the replay window: an acked delivery is never due again
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([TIMER_LINE]);
    expect(rowOf(coord, id).state).toBe('acked');
  });
});

describe('a timer mail that is not the role\'s', () => {
  it('a coordinator\'s own session-keyed timer mail keeps the generic nudge and its normal ack path, with no card hold', async () => {
    const nudge = renderMailNudge(ID);
    const { h, coord, w } = await primed([emptyBox, echoedBox(nudge), emptyBox]);
    designate(coord, 'lane-z-overlord');                           // some other session is the Overlord; nothing minted, no card read
    const id = queueTimer(coord, ID, ID);                          // the mail row's recipient is the coordinator's own session id
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([nudge]);
    expect(rowOf(coord, id).state).toBe('delivered');              // the recipient's own ack, never the lane's first-delivery ack
  });

  it('the same session-keyed mail to the designated session itself is still the generic nudge: the row matches the mail\'s recipient, not the delivery\'s', async () => {
    const nudge = renderMailNudge(ID);
    const { h, coord, w } = await primed([emptyBox, echoedBox(nudge), emptyBox]);
    designate(coord, ID);                                          // no generation, no card: a role mail would hold
    const id = queueTimer(coord, ID, ID);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([nudge]);
    expect(rowOf(coord, id).state).toBe('delivered');
  });
});

describe('an unmeasured designation', () => {
  it('delivers nothing to the designated session: neither the generic nudge nor the timer line', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { h, coord, w } = await primed([emptyBox, emptyBox, echoedBox(TIMER_LINE), emptyBox]);
    mintOverlord(coord);
    serveCard(coord, 's1', 'h1', NOW - 4_000);
    readCard(coord, 's1', 'h1');                                   // the card is current: only the designation holds the row
    coord.designationRead = () => ({ kind: 'unmeasured', why: 'fixture: unreadable' }) as DesignationRead;
    const role = queueTimer(coord);
    const generic = queueTimer(coord, ID, ID);
    const plain = coord.queueDelivery(coord.insertMail({ fromId: 'lane-b-project-a', fromUuid: 'lane-b-project-a', toId: ID, runId: null, kind: 'status', subject: 'hi', body: 'b', artifacts: [] }).id, ID, 'ccrc-mail test payload').id;
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([]);
    expect(keyPresses(h.calls)).toEqual([]);
    for (const id of [role, generic, plain]) expect(rowOf(coord, id)).toEqual({ state: 'queued', attempts: 0 });
  });
});
