// ARCH-19 (GitHub #539): the characterization of sweepMail's delivery policy, written green against the inline code
// BEFORE the policy moved to `coord/delivery.ts`. Each row drives one real sweep (the real FleetWatcher, a recording
// tmux, a real CoordStore) and pins the whole row the policy left behind: the state, the reject code, the attempts,
// the exact `lastError`, the exact `nextAttemptAt` and the park columns. `mail-sweep.test.ts` holds the behaviour
// stories (what the sender is told, what is typed); this table holds the choices themselves: retry, park, reject, hold.
// The move commit changes nothing here, which is the proof it moved the policy and did not edit it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { renderMailNudge } from '../src/coord/envelope.js';
import type { FleetIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { unreadableField } from './ioDoubles.js';

const ID = 'demo-coordinator';
const UUID = 'a'.repeat(36);
const PID = 4242;
const FROM_ID = 'demo-quiet-mesa';
const FROM_UUID = 'b'.repeat(36);
const NOW = 1_800_000_000_000;

const MAX_ATTEMPTS = 6;
const BASE = 30_000;
const CAP = 900_000;
const ARMED_HOLD = 300_000;
const TURN_HOLD = 60_000;
const PARK_RETRY = 600_000;
const PARK_CEILING = 24 * 60 * 60_000;
const REPLAY_MS = 600_000;
const REPLAY_MAX = 20;
const QUIET = 60_000;

const NUDGE = renderMailNudge(ID);
const emptyBox = '❯ \n';
const echoedBox = (t: string): string => `❯ ${t}\n`;
const HAPPY = [emptyBox, echoedBox(NUDGE), emptyBox];
const DRAFT = '❯ half-typed draft\n';
const ARMED = 'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel\n❯ \n';
const TURN_SHOWN = '✻ Cogitating… (12s · esc to interrupt)\n❯ \n';

const step = (attempts: number): number => Math.min(BASE * 2 ** (attempts - 1), CAP);

interface Row {
  state: string; attempts: number; nextAttemptAt: number; lastError: string | null; rejectCode: string | null;
  parkedAt: number | null; parkReason: string | null; replayCount: number;
}

interface Case {
  /** The recipient's registry and pane, as the sweep finds them. */
  recipient: 'absent' | 'unmeasurable' | 'stopped' | 'tmux-unknown' | 'live';
  panes?: string[];
  live?: Record<string, unknown>;
  attempts?: number;
  /** A row already delivered once (it replays). */
  delivered?: boolean;
  replayCount?: number;
  /** A row already parked this long ago (ms). */
  parkedAgo?: number;
}

async function sweep(c: Case): Promise<Row> {
  const home = mkTmp('ccrc-mail-characterize-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const panes = c.panes ?? [];
  let cap = 0;
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') {
      if (c.recipient === 'stopped') return { ran: true, code: 1, stdout: '', stderr: "can't find session: cc-x\n" };
      if (c.recipient === 'tmux-unknown') return { ran: true, code: 1, stdout: '', stderr: 'protocol version mismatch\n' };
      return { ran: true, code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane') {
      const pane = panes[Math.min(cap, panes.length - 1)] ?? null;
      cap++;
      return pane === null ? { ran: true, code: 1, stdout: '', stderr: '' } : { ran: true, code: 0, stdout: pane, stderr: '' };
    }
    if (args[0] === 'send-keys') return { ran: true, code: 0, stdout: '', stderr: '' };
    return { ran: true, code: 1, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const io: FleetIO | undefined = c.recipient === 'unmeasurable' ? unreadableField(ID, 'wrapper') : undefined;
  const deps: Deps = { ...testDeps(home, run), coord, ...(io ? { io } : {}) };
  const w = new FleetWatcher(deps, new Bus(), 2000);
  await w.tick();

  const seed = (id: string, uuid: string): void => {
    const fields = { wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid, started: '1' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  };
  if (c.recipient !== 'absent') {
    seed(ID, UUID);
    seed(FROM_ID, FROM_UUID);
    if (c.recipient === 'stopped') writeFileSync(path.join(reg, `${ID}.stopped`), `${Math.floor(NOW / 1000)} ccd`);
    writeFileSync(path.join(reg, `${ID}.hookstate.json`), JSON.stringify({
      v: 1, state: 'done', sessionId: UUID, pid: PID, event: null, updatedAt: NOW - 61_000, ask: null, subagents: [] }));
    const lives = path.join(home, '.claude', 'sessions');
    mkdirSync(lives, { recursive: true });
    writeFileSync(path.join(lives, `${PID}.json`), JSON.stringify({
      pid: PID, sessionId: UUID, cwd: '/w/demo', name: null, nameSource: null, status: 'idle',
      statusUpdatedAt: NOW - QUIET - 1_000, version: '2.1.220', ...c.live }));
  }

  const mail = coord.insertMail({ fromId: FROM_ID, fromUuid: FROM_UUID, toId: ID, runId: null, kind: 'finding',
    subject: 'hi', body: 'x', artifacts: [] });
  const id = coord.queueDelivery(mail.id, ID, 'x').id;
  if (c.delivered) coord.markDelivered(id, NOW - REPLAY_MS - 1_000);
  coord.db.prepare('UPDATE mail_deliveries SET attempts = ?, replayCount = ? WHERE id = ?')
    .run(c.attempts ?? 0, c.replayCount ?? 0, id);
  if (c.parkedAgo !== undefined) {
    coord.parkDelivery(id, 'stash-failed', DRAFT, NOW - c.parkedAgo, NOW - 1);
    coord.db.prepare('UPDATE mail_deliveries SET attempts = ? WHERE id = ?').run(c.attempts ?? 0, id);
  }

  await w.sweepMail();
  return coord.db.prepare('SELECT state, attempts, nextAttemptAt, lastError, rejectCode, parkedAt, parkReason, replayCount '
    + 'FROM mail_deliveries WHERE id = ?').get(id) as unknown as Row;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); });

describe('ARCH-19 characterization: the recipient is not in the registry', () => {
  it('a first miss backs off one step and counts an attempt', async () => {
    const r = await sweep({ recipient: 'absent' });
    expect(r).toMatchObject({ state: 'queued', attempts: 1, lastError: 'recipient not in registry', rejectCode: null,
      nextAttemptAt: NOW + step(1), parkedAt: null });
  });
  it('the step doubles with the attempts', async () => {
    const r = await sweep({ recipient: 'absent', attempts: 3 });
    expect(r).toMatchObject({ state: 'queued', attempts: 4, nextAttemptAt: NOW + step(4) });
  });
  it('the sixth miss on a never-delivered row rejects it undeliverable', async () => {
    const r = await sweep({ recipient: 'absent', attempts: MAX_ATTEMPTS - 1 });
    expect(r).toMatchObject({ state: 'rejected', rejectCode: 'undeliverable', attempts: MAX_ATTEMPTS - 1,
      lastError: 'recipient not in registry' });
  });
  it('a delivered row rejects too, and says it was purged after delivery', async () => {
    const r = await sweep({ recipient: 'absent', attempts: MAX_ATTEMPTS - 1, delivered: true });
    expect(r).toMatchObject({ state: 'rejected', rejectCode: 'undeliverable',
      lastError: 'recipient purged after this message was delivered, and never acked' });
  });
  it('a listed but unreadable row never parks and counts no attempt, however many it has', async () => {
    const r = await sweep({ recipient: 'unmeasurable', attempts: MAX_ATTEMPTS - 1 });
    expect(r).toMatchObject({ state: 'queued', attempts: MAX_ATTEMPTS - 1, rejectCode: null,
      lastError: 'registry row listed but unreadable (registry-unmeasurable)', nextAttemptAt: NOW + step(MAX_ATTEMPTS) });
  });
});

describe('ARCH-19 characterization: the recipient session is gone for good', () => {
  it('a stopped session backs off and counts an attempt', async () => {
    const r = await sweep({ recipient: 'stopped' });
    expect(r).toMatchObject({ state: 'queued', attempts: 1, lastError: 'recipient session is stopped',
      nextAttemptAt: NOW + step(1) });
  });
  it('the sixth observation on a never-delivered row rejects it', async () => {
    const r = await sweep({ recipient: 'stopped', attempts: MAX_ATTEMPTS - 1 });
    expect(r).toMatchObject({ state: 'rejected', rejectCode: 'undeliverable', lastError: 'recipient session is stopped' });
  });
  it('a delivered row never rejects here: it keeps counting and backs off to the cap', async () => {
    const r = await sweep({ recipient: 'stopped', attempts: MAX_ATTEMPTS - 1, delivered: true });
    expect(r).toMatchObject({ state: 'delivered', attempts: MAX_ATTEMPTS, rejectCode: null,
      lastError: 'recipient session is stopped', nextAttemptAt: NOW + CAP });
  });
});

describe('ARCH-19 characterization: tmux did not answer', () => {
  it('backs off on the attempts as they stand and counts none', async () => {
    const r = await sweep({ recipient: 'tmux-unknown', attempts: 2 });
    expect(r).toMatchObject({ state: 'queued', attempts: 2, rejectCode: null, nextAttemptAt: NOW + BASE * 2 ** 2 });
    expect(r.lastError).toMatch(/^tmux did not answer \(substrate-unknown\): /);
  });
});

describe('ARCH-19 characterization: the send was refused', () => {
  it('an armed auto-continue holds five minutes and counts no attempt, at any attempts', async () => {
    const r = await sweep({ recipient: 'live', panes: [ARMED], attempts: MAX_ATTEMPTS - 1 });
    expect(r).toMatchObject({ state: 'queued', attempts: MAX_ATTEMPTS - 1, lastError: 'auto-continue-armed',
      nextAttemptAt: NOW + ARMED_HOLD, parkedAt: null, rejectCode: null });
  });
  it('a turn on screen holds one minute and counts no attempt, at any attempts', async () => {
    const r = await sweep({ recipient: 'live', panes: [TURN_SHOWN], live: { status: 'shell' }, attempts: MAX_ATTEMPTS - 1 });
    expect(r).toMatchObject({ state: 'queued', attempts: MAX_ATTEMPTS - 1, lastError: 'turn-running',
      nextAttemptAt: NOW + TURN_HOLD, parkedAt: null });
  });
  it('a first stash failure backs off one step', async () => {
    const r = await sweep({ recipient: 'live', panes: [DRAFT] });
    expect(r).toMatchObject({ state: 'queued', attempts: 1, lastError: 'stash-failed', nextAttemptAt: NOW + step(1), parkedAt: null });
  });
  it('the sixth failure parks the row for the retry timer instead of rejecting it', async () => {
    const r = await sweep({ recipient: 'live', panes: [DRAFT], attempts: MAX_ATTEMPTS - 1 });
    expect(r).toMatchObject({ state: 'queued', attempts: MAX_ATTEMPTS, rejectCode: null, parkedAt: NOW,
      parkReason: 'stash-failed', nextAttemptAt: NOW + PARK_RETRY });
  });
  it('enter-ignored parks at once, at attempts zero', async () => {
    const r = await sweep({ recipient: 'live', panes: [emptyBox, echoedBox(NUDGE)] });
    expect(r).toMatchObject({ state: 'queued', attempts: 1, parkedAt: NOW, parkReason: 'enter-ignored',
      nextAttemptAt: NOW + PARK_RETRY });
  });
  it('a delivered row never parks on a failed replay: it backs off, counting, to the cap', async () => {
    const r = await sweep({ recipient: 'live', panes: [DRAFT], attempts: MAX_ATTEMPTS - 1, delivered: true });
    expect(r).toMatchObject({ state: 'delivered', attempts: MAX_ATTEMPTS, lastError: 'stash-failed', parkedAt: null,
      nextAttemptAt: NOW + CAP });
  });
});

describe('ARCH-19 characterization: the park and replay ceilings', () => {
  it('a row parked 24 h ago is rejected with the expiry text', async () => {
    const r = await sweep({ recipient: 'live', panes: [DRAFT], parkedAgo: PARK_CEILING, attempts: MAX_ATTEMPTS });
    expect(r).toMatchObject({ state: 'rejected', rejectCode: 'undeliverable',
      lastError: 'parked 24 h, never delivered: stash-failed' });
  });
  it('the twentieth unacked replay rejects the row with the replay-ceiling text', async () => {
    const r = await sweep({ recipient: 'live', panes: HAPPY, delivered: true, replayCount: REPLAY_MAX - 1 });
    expect(r).toMatchObject({ state: 'rejected', rejectCode: 'undeliverable', replayCount: REPLAY_MAX,
      lastError: 'replayed without ack past the replay ceiling' });
  });
});
