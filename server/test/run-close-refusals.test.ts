// D-8077 (spec 2026-11-04 §12.2, A19, A59, A62; the runs rebuild, Task 27): what an ARMED run-close lane does with a close it refused.
// The decider (`refusalRoute`, one case per cell of §12.2's table) and the lane over a real store and the real `closeRun`:
// a living coordinator is told first and the item is the last step; a gone one gets the item at once; a run no act can move is
// information. Neutral names throughout (programme-a, coord-a, s-aaaa).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { abandonRefusal, closeRun, type CloseOutcome } from '../src/coord/close.js';
import { createRunVerdicts } from '../src/coord/runVerdicts.js';
import { createRunCloseMemory, runClosePass, type RunCloseLaneDeps, type RunCloseOutcome } from '../src/coord/runCloseLane.js';
import {
  REFUSAL_DOORS, REFUSAL_REASONS, refusalDoors, refusalRoute, refusedCloseDoors, type BranchFacts, type DoorFacts, type RefusalReason,
} from '../src/coord/runClose.js';
import { untoldPass } from '../src/coord/untold.js';
import { ASK_GRACE_MS } from '../src/askwindow.js';
import { RUNS_EXPIRE_NEVER_STARTED_MARKER } from '../../shared/switches.js';
import { COORDINATOR_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { isCloseRefusedAction, type ItemView as _ItemView } from '../../shared/ledgers.js';
import type { ClaimantVerdict } from '../src/coord/reclaim.js';
import type { ChildMarkRead } from '../../shared/runBelongs.js';
import type { Runner } from '../src/exec.js';
import { NotifyLog } from '../src/notifylog.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);
void (null as unknown as _ItemView);

const H = 3_600_000;
const T0 = 1_800_000_000_000;
const ARMED = [RUNS_EXPIRE_NEVER_STARTED_MARKER];
const ALIVE: ClaimantVerdict = { state: 'alive', why: 'live' };
const DEAD: ClaimantVerdict = { state: 'dead', cause: 'orphan', why: 'gone' };
/** D-8558: a claimant the registry no longer holds (forgotten): the ladder reads its missing row as `absent`. */
const FORGOTTEN: ClaimantVerdict = { state: 'dead', cause: 'absent', why: 'no registry row' };

/** The seven cells of §12.2 that raise an item, as (reason, coordinator). */
const RAISING: readonly [RefusalReason, 'lives' | 'gone'][] = [
  ['open-pr', 'gone'], ['unpushed-commits', 'gone'], ['busy-worker', 'gone'], ['child-marker-unreadable', 'lives'],
  ['child-marker-unreadable', 'gone'], ['absent-claimant', 'gone'], ['warning-undelivered', 'gone'],
];

describe('refusalRoute: one row per line of §12.2', () => {
  it('an open PR under a live coordinator tells it and raises no item; so do unpushed commits', () => {
    expect(refusalRoute('open-pr', 'lives', true)).toEqual({ kind: 'tell' });
    expect(refusalRoute('unpushed-commits', 'lives', true)).toEqual({ kind: 'tell' });
  });

  it('under a gone coordinator each cell raises its item at once, with its doors', () => {
    expect(refusalRoute('open-pr', 'gone', true)).toEqual({ kind: 'item', doors: ['open-pr'] });
    expect(refusalRoute('unpushed-commits', 'gone', true)).toEqual({ kind: 'item', doors: ['hand-to-coordinator', 'abandon-anyway'] });
    expect(refusalRoute('busy-worker', 'gone', true)).toEqual({ kind: 'item', doors: ['open-worker'] });
    expect(refusalRoute('absent-claimant', 'gone', true)).toEqual({ kind: 'item', doors: ['abandon'] });
    expect(refusalRoute('warning-undelivered', 'gone', true)).toEqual({ kind: 'item', doors: ['open-coordinator'] });
    expect(refusalRoute('child-marker-unreadable', 'gone', true)).toEqual({ kind: 'item', doors: ['abandon'] });
  });

  it('an unreadable marker under a live coordinator is told and held ASK_GRACE_MS', () => {
    expect(refusalRoute('child-marker-unreadable', 'lives', true)).toEqual({ kind: 'tell-and-hold', doors: ['abandon'] });
  });

  it('an unknown run is information whoever owns it', () => {
    expect(refusalRoute('unknown-run', 'lives', false)).toEqual({ kind: 'inform' });
    expect(refusalRoute('unknown-run', 'gone', false)).toEqual({ kind: 'inform' });
    expect(refusalRoute('unknown-run', 'gone', true)).toEqual({ kind: 'inform' });
  });

  it('a run the arm refuses for any reason raises no item, under a live or a gone coordinator', () => {
    for (const reason of REFUSAL_REASONS) for (const who of ['lives', 'gone'] as const) {
      expect(refusalRoute(reason, who, false).kind, `${reason} ${who}`).toBe('inform');
    }
  });

  it('the list of cells that raise an item is not empty, and holds the seven cells of §12.2 that raise one', () => {
    const raising: string[] = [];
    for (const reason of REFUSAL_REASONS) for (const who of ['lives', 'gone'] as const) {
      const k = refusalRoute(reason, who, true).kind;
      if (k === 'item' || k === 'tell-and-hold') raising.push(`${reason}/${who}`);
    }
    expect(raising.length).toBeGreaterThan(0);
    expect(raising.sort()).toEqual(RAISING.map(([r, w]) => `${r}/${w}`).sort());
  });

  it('every such cell names at least one door', () => {
    for (const [reason, who] of RAISING) {
      const route = refusalRoute(reason, who, true);
      expect(route.kind === 'item' || route.kind === 'tell-and-hold').toBe(true);
      if (route.kind === 'item' || route.kind === 'tell-and-hold') expect(route.doors.length).toBeGreaterThan(0);
      expect(refusalDoors(reason)?.length).toBeGreaterThan(0);
      expect(REFUSAL_DOORS[reason].length).toBeGreaterThan(0);
    }
  });
});

// D-8558: a refused close's doors from what the lane measured. A claimant the registry no longer holds is never a door.
describe('refusedCloseDoors: no door to a session the registry does not hold', () => {
  const ALL_FACTS: DoorFacts[] = [];
  for (const claimantHeld of [true, false]) for (const programmeLive of [true, false]) for (const lastLiveRun of [true, false]) {
    ALL_FACTS.push({ claimantHeld, programmeLive, lastLiveRun });
  }
  const gone = (f: Partial<DoorFacts> = {}): DoorFacts => ({ claimantHeld: false, programmeLive: true, lastLiveRun: false, ...f });

  it('a claimant the registry holds keeps today\'s doors, whatever else the lane measured', () => {
    for (const reason of REFUSAL_REASONS) {
      const doors = refusalDoors(reason);
      if (doors === null) continue;
      for (const f of ALL_FACTS.filter((x) => x.claimantHeld)) expect(refusedCloseDoors(doors, f), reason).toEqual(doors);
    }
  });

  it('an undelivered warning to a forgotten claimant offers Close this run and, while the programme lives, Hand to a coordinator', () => {
    const doors = refusalDoors('warning-undelivered')!;
    expect(refusedCloseDoors(doors, gone())).toEqual(['close-run', 'hand-to-coordinator']);
    expect(refusedCloseDoors(doors, gone({ programmeLive: false }))).toEqual(['close-run']);
    expect(refusedCloseDoors(doors, gone({ lastLiveRun: true }))).toEqual(['close-run', 'hand-to-coordinator', 'end-programme']);
    expect(refusedCloseDoors(doors, gone({ programmeLive: false, lastLiveRun: true }))).toEqual(['close-run', 'end-programme']);
  });

  it('a programme that cannot take a run drops Hand to a coordinator wherever it stood, and the last live run may end the programme', () => {
    const doors = refusalDoors('unpushed-commits')!;
    expect(refusedCloseDoors(doors, gone())).toEqual(['hand-to-coordinator', 'abandon-anyway']);
    expect(refusedCloseDoors(doors, gone({ programmeLive: false }))).toEqual(['abandon-anyway']);
    expect(refusedCloseDoors(refusalDoors('absent-claimant')!, gone({ lastLiveRun: true }))).toEqual(['abandon', 'end-programme']);
    expect(refusedCloseDoors(refusalDoors('open-pr')!, gone({ lastLiveRun: true })), 'no abandoning door: nothing to end with').toEqual(['open-pr']);
  });

  it('THE PIN: no cell, under any facts, offers Open the coordinator once the registry does not hold it, and none is empty', () => {
    let cells = 0;
    for (const reason of REFUSAL_REASONS) for (const f of ALL_FACTS.filter((x) => !x.claimantHeld)) {
      const route = refusalRoute(reason, 'gone', true, f);
      if (route.kind !== 'item' && route.kind !== 'tell-and-hold') continue;
      cells += 1;
      expect(route.doors, `${reason} ${JSON.stringify(f)}`).not.toContain('open-coordinator');
      expect(route.doors.length).toBeGreaterThan(0);
    }
    expect(cells, 'the pin ran over every raising cell under every gone fact').toBe(6 * 4);
  });

  it('a living coordinator\'s cell ignores the facts: it is held by definition', () => {
    expect(refusalRoute('child-marker-unreadable', 'lives', true, gone({ lastLiveRun: true }))).toEqual({ kind: 'tell-and-hold', doors: ['abandon'] });
  });
});

interface Opts { names?: string[]; verdicts?: Record<string, ClaimantVerdict>; facts?: Partial<BranchFacts>; mark?: ChildMarkRead | null;
  refusal?: (id: number) => Extract<CloseOutcome, { ok: false }> | null }

const rig = async (o: Opts = {}) => {
  const home = mkTmp('ccrc-runclose-refusals-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const run: Runner = async () => ({ ran: true, code: 0, stdout: '', stderr: '' });
  const base = testDeps(home, run);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const state = {
    clock: T0, verdicts: { 'coord-a': ALIVE, ...(o.verdicts ?? {}) } as Record<string, ClaimantVerdict>,
    facts: { openPr: false, unpushed: false, ...(o.facts ?? {}) }, mark: (o.mark === undefined ? { kind: 'none' } : o.mark) as ChildMarkRead | null,
    names: o.names ?? ARMED, busy: null as number | null | 'unread',
  };
  const deps = (): RunCloseLaneDeps => ({
    coord, verdicts: createRunVerdicts(), memory: laneMemory, notifyLog, now: () => state.clock,
    registryNames: async () => state.names, measure: async (id) => state.verdicts[id] ?? DEAD, claimantBusyAt: () => state.busy,
    branchFacts: async () => ({ readAt: state.clock, ...state.facts }), childMark: async () => state.mark,
    abandonRefusal: o.refusal ?? ((id) => abandonRefusal(coord, id)),
    serial: async (c, fn) => fn((runId, claimedBy, stillStuck, extra): Promise<CloseOutcome> =>
      closeRun({ coord: c, io: base.io, cfg: base.cfg, runCcd: base.runCcd }, runId, { intent: 'abandon' }, 'sweep', { claimedBy, stillStuck, ...extra })),
  });
  const laneMemory = createRunCloseMemory();
  const pass = (): Promise<RunCloseOutcome> => runClosePass(deps());
  const open = (program: string, wave: number): number => {
    const r = coord.openRun({ program, title: `T ${wave}`, project: 'demo', wave, waveOf: null, claimedBy: 'coord-a' });
    if (!('id' in r)) throw new Error(`fixture openRun refused: ${JSON.stringify(r)}`);
    coord.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(T0 - 100 * H, r.id);
    return r.id;
  };
  /** A programme warned 30 h ago, quiet 80 h, ready to close (the lane's own fixture). */
  const ready = async (program = 'programme-a'): Promise<number> => {
    const id = open(program, 1);
    coord.setRunCloseAnchor('never-started', program, { firstAt: T0 - 49 * H, lastAt: T0 - 60_000 });
    const sent = await pass();
    if (!sent.warned.includes(program)) throw new Error('fixture: the warning was not sent');
    coord.markDelivered(coord.runCloseWarning(program)!.deliveryId, T0);
    state.clock = T0 + 30 * H;
    coord.setRunCloseAnchor('never-started', program, { firstAt: T0 - 49 * H, lastAt: state.clock - 60_000 });
    return id;
  };
  const withSession = (id: number): void => { coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run('s-aaaa', id); };
  const items = () => coord.openCloseRefusedItems();
  const untold = () => coord.untoldRows();
  const feed = (): string[] => (coord.db.prepare('SELECT title FROM feed_events ORDER BY id').all() as { title: string }[]).map((r) => r.title);
  const stateOf = (id: number): string => (coord.run(id) as { run: { state: string } }).run.state;
  const mail = (): { toId: string; subject: string; wake: string | null }[] =>
    coord.db.prepare('SELECT d.toId, m.subject, d.wake FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ORDER BY d.id').all() as never;
  return { coord, state, pass, open, ready, withSession, items, untold, feed, stateOf, mail, base };
};

describe('the lane: a living coordinator hears first', () => {
  it('an open PR under a live coordinator tells it and raises no item', async () => {
    const r = await rig({ facts: { openPr: true } });
    const id = await r.ready();
    r.withSession(id);
    const out = await r.pass();
    expect(out.closed).toEqual([]);
    expect(r.items()).toEqual([]);
    expect(r.untold().map((u) => [u.runId, u.cause, u.detail])).toEqual([[id, 'refused', 'open-pr']]);
  });

  it('so do unpushed commits', async () => {
    const r = await rig({ facts: { unpushed: true } });
    const id = await r.ready();
    r.withSession(id);
    await r.pass();
    expect(r.items()).toEqual([]);
    expect(r.untold().map((u) => u.detail)).toEqual(['unpushed-commits']);
    expect(r.untold()[0]!.runId).toBe(id);
  });

  it('an asleep coordinator counts as living and is not woken: the notice rides record-only, with wake never', async () => {
    const r = await rig({ facts: { openPr: true } });
    const id = await r.ready();
    r.withSession(id);
    await r.pass();
    const before = r.mail().length;
    // A hibernated claimant reads alive on the ladder, so the drain tells it and asks no wake.
    await untoldPass({ coord: r.coord, measure: async () => ALIVE });
    const sent = r.mail().slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ toId: 'coord-a', wake: 'never' });
    expect(sent[0]!.subject).toMatch(/^runs closed:/);
    expect(r.items()).toEqual([]);
  });

  it('a refusal that lasts tells once, by the lane\'s anchor, and a changed reason tells again', async () => {
    const r = await rig({ facts: { openPr: true } });
    const id = await r.ready();
    r.withSession(id);
    await r.pass();
    await untoldPass({ coord: r.coord, measure: async () => ALIVE });
    for (let i = 0; i < 5; i += 1) { r.state.clock += 60_000; await r.pass(); }
    expect(r.untold(), 'the same refusal, the same reason: nothing more is written').toEqual([]);
    r.state.facts = { openPr: false, unpushed: true };
    r.state.clock += 4 * 60_000;   // past the lane's branch-fact reuse
    await r.pass();
    expect(r.untold().map((u) => u.detail)).toEqual(['unpushed-commits']);
  });

  it('the row reads Nothing closes this on its own with no marker while only told', async () => {
    const r = await rig({ facts: { openPr: true } });
    const id = await r.ready();
    r.withSession(id);
    const verdicts = createRunVerdicts();
    const seen: Map<number, unknown>[] = [];
    const realSet = verdicts.setCloses.bind(verdicts);
    verdicts.setCloses = (c) => { seen.push(new Map(c)); realSet(c); };
    await runClosePass({ coord: r.coord, verdicts, memory: createRunCloseMemory(), now: () => r.state.clock,
      registryNames: async () => ARMED, measure: async (s) => r.state.verdicts[s] ?? DEAD, claimantBusyAt: () => null,
      branchFacts: async () => ({ readAt: r.state.clock, openPr: true, unpushed: false }), childMark: async () => r.state.mark,
      abandonRefusal: (i) => abandonRefusal(r.coord, i), serial: null });
    expect(seen.at(-1)!.has(id), 'closes is null: the run is not in the map').toBe(false);
  });

  it('an unreadable marker under a live coordinator is held ASK_GRACE_MS and is on no list until then', async () => {
    const r = await rig({ mark: { kind: 'unreadable' } });
    const id = await r.ready();
    r.withSession(id);
    await r.pass();
    const [item] = r.items();
    expect(item).toBeDefined();
    expect(item!.heldUntil).toBe(r.state.clock + ASK_GRACE_MS);
    expect(isCloseRefusedAction(item!.action) && item!.action.doors).toEqual(['abandon']);
    expect(item!.raisedBy).toBe('ccrc');
    expect(r.coord.itemsFor(null, r.state.clock).open, 'no list holds it inside the hold').toEqual([]);
    expect(r.coord.itemsFor(null, r.state.clock + ASK_GRACE_MS).open.map((i) => i.id)).toEqual([item!.id]);
    // The held item is on no list the coordinator reads, so the notice names it: the id is what a withdraw needs.
    expect(r.untold(), 'the untold row would name no item').toEqual([]);
    const told = r.mail().filter((m) => m.toId === 'coord-a' && m.subject.startsWith('close refused:'));
    expect(told.map((m) => m.subject), 'the coordinator is told first, naming the item').toEqual([`close refused: item ${item!.id}: run ${id}`]);
    expect(told[0]!.wake, 'a sleeper is not woken').toBe('never');
    const body = (r.coord.db.prepare("SELECT body FROM mail WHERE subject LIKE 'close refused:%'").get() as { body: string }).body;
    expect(body).toContain(`items withdraw ${item!.id}`);
  });

  it('a withdraw inside that hold means the operator sees nothing, and the lane does not raise it again', async () => {
    const r = await rig({ mark: { kind: 'unreadable' } });
    const id = await r.ready();
    r.withSession(id);
    await r.pass();
    const item = r.items()[0]!;
    expect(r.coord.moveItem(item.id, 'withdraw', 'coordinator', {}, r.state.clock, { programmeHasOpenRun: true }).ok).toBe(true);
    for (let i = 0; i < 3; i += 1) { r.state.clock += 60_000; await r.pass(); }
    r.state.clock += ASK_GRACE_MS;
    expect(r.items()).toEqual([]);
    expect(r.coord.itemsFor(null, r.state.clock).open).toEqual([]);
  });

  it('a coordinator that goes gone turns the refusal into its item on the next pass', async () => {
    const r = await rig({ facts: { openPr: true } });
    const id = await r.ready();
    r.withSession(id);
    await r.pass();
    expect(r.items()).toEqual([]);
    r.state.verdicts['coord-a'] = DEAD;
    r.state.clock += 60_000;
    await r.pass();
    const [item] = r.items();
    expect(item?.heldUntil, 'at once').toBeNull();
    expect(isCloseRefusedAction(item!.action) && item!.action.doors).toEqual(['open-pr']);
  });
});

describe('the lane: a gone coordinator gets the item at once, raised by ccrc', () => {
  it('under a gone coordinator each refusal raises its item at once', async () => {
    const cases: [Opts, string[]][] = [
      [{ facts: { openPr: true } }, ['open-pr']],
      [{ facts: { unpushed: true } }, ['hand-to-coordinator', 'abandon-anyway']],
      [{ mark: { kind: 'unreadable' } }, ['abandon']],
    ];
    for (const [opts, doors] of cases) {
      const r = await rig(opts);
      const id = await r.ready();
      r.withSession(id);
      r.state.verdicts['coord-a'] = DEAD;
      await r.pass();
      const [item] = r.items();
      expect(item, JSON.stringify(opts)).toBeDefined();
      expect(item!.raisedBy).toBe('ccrc');
      expect(item!.heldUntil).toBeNull();
      expect(item!.runId).toBe(id);
      expect(isCloseRefusedAction(item!.action) && item!.action.doors).toEqual(doors);
      expect(r.coord.itemHistory(item!.id)[0]).toMatchObject({ act: 'raise', actor: 'ccrc' });
      expect(r.coord.itemsFor(null, r.state.clock).open.map((i) => i.id), 'on the operator\'s list at once').toEqual([item!.id]);
      expect(r.stateOf(id)).toBe('planned');
    }
  });

  it('a warning 24 h undelivered raises Open the coordinator at once', async () => {
    const r = await rig();
    const id = r.open('programme-a', 1);
    r.coord.setRunCloseAnchor('never-started', 'programme-a', { firstAt: T0 - 49 * H, lastAt: T0 - 60_000 });
    expect((await r.pass()).warned).toEqual(['programme-a']);
    r.state.clock = T0 + 25 * H;
    r.coord.setRunCloseAnchor('never-started', 'programme-a', { firstAt: T0 - 49 * H, lastAt: r.state.clock - 60_000 });
    r.state.verdicts['coord-a'] = DEAD;
    await r.pass();
    const [item] = r.items();
    expect(item).toBeDefined();
    expect(isCloseRefusedAction(item!.action) && item!.action.doors).toEqual(['open-coordinator']);
    expect(item!.heldUntil).toBeNull();
    expect(r.stateOf(id)).toBe('planned');
  });

  // D-8558: the reported case. The claimant was forgotten (no registry row), so Open the coordinator would open nothing.
  const undelivered = async (verdict: ClaimantVerdict, extra?: (r: Awaited<ReturnType<typeof rig>>) => void) => {
    const r = await rig();
    const id = r.open('programme-a', 1);
    extra?.(r);
    r.coord.setRunCloseAnchor('never-started', 'programme-a', { firstAt: T0 - 49 * H, lastAt: T0 - 60_000 });
    expect((await r.pass()).warned).toEqual(['programme-a']);
    r.state.clock = T0 + 25 * H;
    r.coord.setRunCloseAnchor('never-started', 'programme-a', { firstAt: T0 - 49 * H, lastAt: r.state.clock - 60_000 });
    r.state.verdicts['coord-a'] = verdict;
    await r.pass();
    return { r, id };
  };

  it('a warning undelivered to a forgotten coordinator never raises Open the coordinator: Close this run, Hand to a coordinator, and the programme\'s end', async () => {
    const { r, id } = await undelivered(FORGOTTEN);
    const [item] = r.items();
    expect(item?.runId).toBe(id);
    expect(isCloseRefusedAction(item!.action) && item!.action.doors).toEqual(['close-run', 'hand-to-coordinator', 'end-programme']);
    expect(item!.why).toMatch(/Its coordinator is gone, and its session no longer exists$/);
  });

  it('a programme with another open run is not offered its end, and one whose plan closed is not offered a hand-over', async () => {
    const two = await undelivered(FORGOTTEN, (r) => { r.open('programme-a', 2); });
    const doors = two.r.items().filter((i) => isCloseRefusedAction(i.action)).map((i) => (i.action as unknown as { doors: string[] }).doors);
    for (const d of doors) expect(d).not.toContain('end-programme');
    expect(doors.length).toBeGreaterThan(0);
    const closed = await undelivered(FORGOTTEN, (r) => { r.coord.db.prepare("UPDATE programs SET planEnd = 'done' WHERE slug = 'programme-a'").run(); });
    expect(closed.r.items().map((i) => (i.action as unknown as { doors: string[] }).doors)).toEqual([['close-run', 'end-programme']]);
  });

  it('a coordinator forgotten after its item was raised: the item is redrawn without the dead door, once', async () => {
    const { r } = await undelivered(DEAD);
    const [first] = r.items();
    expect(isCloseRefusedAction(first!.action) && first!.action.doors).toEqual(['open-coordinator']);
    r.state.verdicts['coord-a'] = FORGOTTEN;
    r.state.clock += 60_000;
    r.coord.setRunCloseAnchor('never-started', 'programme-a', { firstAt: T0 - 49 * H, lastAt: r.state.clock - 60_000 });
    await r.pass();
    expect(r.coord.itemById(first!.id)!.state, 'the old item settles').toBe('done');
    const now = r.items();
    expect(now.map((i) => (i.action as unknown as { doors: string[] }).doors)).toEqual([['close-run', 'hand-to-coordinator', 'end-programme']]);
    for (let i = 0; i < 3; i += 1) {
      r.state.clock += 60_000;
      r.coord.setRunCloseAnchor('never-started', 'programme-a', { firstAt: T0 - 49 * H, lastAt: r.state.clock - 60_000 });
      await r.pass();
    }
    expect(r.items().map((i) => i.id), 'a refusal that lasts raises nothing more').toEqual(now.map((i) => i.id));
  });

  it('a redrawn item the operator dismissed is not raised again', async () => {
    const { r } = await undelivered(FORGOTTEN);
    const [item] = r.items();
    expect(r.coord.moveItem(item!.id, 'dismiss', 'operator', {}, r.state.clock, { programmeHasOpenRun: false }).ok).toBe(true);
    for (let i = 0; i < 3; i += 1) {
      r.state.clock += 60_000;
      r.coord.setRunCloseAnchor('never-started', 'programme-a', { firstAt: T0 - 49 * H, lastAt: r.state.clock - 60_000 });
      await r.pass();
    }
    expect(r.items()).toEqual([]);
  });

  it('no item is raised for an undelivered warning before the 24 hours are up', async () => {
    const r = await rig();
    r.open('programme-a', 1);
    r.coord.setRunCloseAnchor('never-started', 'programme-a', { firstAt: T0 - 49 * H, lastAt: T0 - 60_000 });
    await r.pass();
    r.state.clock = T0 + 23 * H;
    r.coord.setRunCloseAnchor('never-started', 'programme-a', { firstAt: T0 - 49 * H, lastAt: r.state.clock - 60_000 });
    r.state.verdicts['coord-a'] = DEAD;
    await r.pass();
    expect(r.items()).toEqual([]);
  });

  it('settle closes the item when the reason has gone', async () => {
    const r = await rig({ facts: { openPr: true } });
    const id = await r.ready();
    r.withSession(id);
    r.state.verdicts['coord-a'] = DEAD;
    await r.pass();
    const item = r.items()[0]!;
    // The programme moves: the close is no longer due, so the lane no longer refuses it.
    r.state.clock += 60_000;
    r.coord.db.prepare('UPDATE runs SET lastDispatchAttemptAt = ? WHERE id = ?').run(r.state.clock, id);
    await r.pass();
    expect(r.items()).toEqual([]);
    const settled = r.coord.itemById(item.id)!;
    expect(settled.state).toBe('done');
    expect(r.coord.itemHistory(item.id).at(-1)).toMatchObject({ act: 'settle', actor: 'ccrc', note: 'The reason has gone.' });
  });

  it('a run that closes settles its item through the transition, never a second item', async () => {
    const r = await rig({ facts: { openPr: true } });
    const id = await r.ready();
    r.withSession(id);
    r.state.verdicts['coord-a'] = DEAD;
    await r.pass();
    const item = r.items()[0]!;
    r.state.facts = { openPr: false, unpushed: false };
    r.state.clock += 4 * 60_000;   // past the lane's branch-fact reuse
    expect((await r.pass()).closed).toEqual([id]);
    expect(r.coord.itemById(item.id)!.state).toBe('done');
    expect(r.items()).toEqual([]);
  });
});

describe('a grace that restarted is a doubt, not a measurement', () => {
  it('a pause raised and cleared keeps the gone coordinator\'s item and its anchor, and raises nothing a second time', async () => {
    const r = await rig({ facts: { openPr: true } });
    const id = await r.ready();
    r.withSession(id);
    r.state.verdicts['coord-a'] = DEAD;
    await r.pass();
    const [item] = r.items();
    expect(item).toBeDefined();
    r.state.names = [...ARMED, COORDINATOR_PAUSE_MARKER];
    r.state.clock += 60_000;
    expect((await r.pass()).held).not.toBeNull();
    r.state.names = ARMED;
    for (let i = 0; i < 3; i += 1) { r.state.clock += 60_000; await r.pass(); }
    expect(r.items().map((x) => x.id), 'the same item, still open').toEqual([item!.id]);
    expect(r.coord.itemHistory(item!.id).some((e) => e.act === 'settle')).toBe(false);
  });

  it('a lane gap over the dead-coordinator gap keeps the item too', async () => {
    const r = await rig({ facts: { openPr: true } });
    const id = await r.ready();
    r.withSession(id);
    r.state.verdicts['coord-a'] = DEAD;
    await r.pass();
    const [item] = r.items();
    r.state.clock += 30 * 60_000;   // a slow deploy
    await r.pass();
    expect(r.items().map((x) => x.id)).toEqual([item!.id]);
  });
});

describe('the lane: a case no act can resolve raises no item (A62, n2, n4)', () => {
  const unknownRun = async (who: 'lives' | 'gone') => {
    const r = await rig({ names: ARMED, verdicts: { 'coord-a': who === 'lives' ? ALIVE : DEAD } });
    const id = r.open('programme-a', 1);
    r.coord.db.prepare("UPDATE runs SET state = 'a-state-from-a-newer-build' WHERE id = ?").run(id);
    return { r, id };
  };

  it('an unknown run raises no item, and shows once in the feed, under a live or a gone coordinator', async () => {
    for (const who of ['lives', 'gone'] as const) {
      const { r, id } = await unknownRun(who);
      for (let i = 0; i < 4; i += 1) { r.state.clock += 60_000; await r.pass(); }
      expect(r.items(), who).toEqual([]);
      expect(r.feed().filter((t) => t.includes(`run ${id} is in a state this server cannot read`))).toHaveLength(1);
    }
  });

  it('under a live coordinator it is also told, and the notice asks nothing', async () => {
    const { r, id } = await unknownRun('lives');
    await r.pass();
    expect(r.untold().map((u) => [u.runId, u.detail])).toEqual([[id, 'unknown-run']]);
    await untoldPass({ coord: r.coord, measure: async () => ALIVE });
    const sent = r.coord.db.prepare('SELECT m.body AS body, d.wake AS wake FROM mail m JOIN mail_deliveries d ON d.mailId = m.id ORDER BY m.id DESC LIMIT 1').get() as { body: string; wake: string };
    expect(sent.body).toContain('cannot read');
    expect(sent.body).toContain('It asks nothing of you.');
    expect(sent.wake).toBe('never');
  });

  it('under a gone coordinator it is not told: nobody can hear', async () => {
    const { r } = await unknownRun('gone');
    await r.pass();
    expect(r.untold()).toEqual([]);
  });

  it('a run abandonRefusal refuses for any reason raises no item, under a live or a gone coordinator', async () => {
    for (const who of ['lives', 'gone'] as const) {
      const r = await rig({ facts: { openPr: true }, refusal: () => ({ ok: false, kind: 'bad-transition', from: 'closing', to: 'failed' }) as never });
      const id = await r.ready();
      r.withSession(id);
      r.state.verdicts['coord-a'] = who === 'lives' ? ALIVE : DEAD;
      await r.pass();
      expect(r.items(), who).toEqual([]);
    }
  });

  it('a closing run\'s line says it is already closing', async () => {
    const r = await rig({ facts: { openPr: true }, refusal: () => ({ ok: false, kind: 'bad-transition', from: 'closing', to: 'failed' }) as never });
    const id = await r.ready();
    r.withSession(id);
    r.state.verdicts['coord-a'] = DEAD;
    await r.pass();
    expect(r.feed()).toContain(`run ${id} is already closing`);
    expect(r.items()).toEqual([]);
  });

  it('a hold that could not be read says so', async () => {
    const r = await rig({ facts: { openPr: true }, refusal: () => ({ ok: false, kind: 'hold-invalid', detail: 'x' }) as never });
    const id = await r.ready();
    r.withSession(id);
    r.state.verdicts['coord-a'] = DEAD;
    await r.pass();
    expect(r.feed()).toContain(`run ${id} could not be read`);
  });

  it('an absent claimant with no history shows at once, with Abandon, once the programme has been quiet its grace under an armed group', async () => {
    const r = await rig();
    const id = r.open('programme-a', 1);
    r.coord.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(id);
    r.coord.setRunCloseAnchor('never-started', 'programme-a', { firstAt: T0 - 90 * H, lastAt: T0 - 60_000 });
    await r.pass();
    const items = r.items();
    expect(items).toHaveLength(1);
    expect(items[0]!.runId).toBe(id);
    // D-8558: nobody to hand it to is held, and it is the programme's last live run, so the item may end the programme too.
    expect(items[0]!.action).toMatchObject({ doors: ['abandon', 'end-programme'] });
    await r.pass();
    expect(r.items(), 'raised once').toHaveLength(1);
  });

  it('an absent claimant inside its quiet grace raises nothing', async () => {
    const r = await rig();
    const id = r.open('programme-a', 1);
    r.coord.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(id);
    r.coord.setRunCloseAnchor('never-started', 'programme-a', { firstAt: T0 - H, lastAt: T0 - 60_000 });
    await r.pass();
    expect(r.items()).toEqual([]);
  });

  it('a doubt on the programme\'s claimant (unmeasurable, or an unread busy turn) never settles its open item or drops its anchor', async () => {
    for (const doubt of ['unmeasurable', 'unread'] as const) {
      const r = await rig({ facts: { openPr: true } });
      const id = await r.ready();
      r.withSession(id);
      r.state.verdicts['coord-a'] = DEAD;
      await r.pass();
      const [item] = r.items();
      expect(item, doubt).toBeDefined();
      const anchors = (): number => (r.coord.db.prepare("SELECT COUNT(*) AS n FROM run_close_anchors WHERE laneRow LIKE 'refused:%'").get() as { n: number }).n;
      expect(anchors(), doubt).toBeGreaterThan(0);
      if (doubt === 'unmeasurable') r.state.verdicts['coord-a'] = { state: 'unmeasurable', why: 'listing failed' };
      else r.state.busy = 'unread';
      for (let i = 0; i < 3; i += 1) { r.state.clock += 60_000; await r.pass(); }
      expect(r.items().map((x) => x.id), `${doubt}: the same item, still open`).toEqual([item!.id]);
      expect(anchors(), `${doubt}: the anchor stays`).toBeGreaterThan(0);
      // A definite measurement again: still one item, no second raise.
      r.state.verdicts['coord-a'] = DEAD;
      r.state.busy = null;
      r.state.clock += 60_000;
      await r.pass();
      expect(r.items().map((x) => x.id), `${doubt}: raised once`).toEqual([item!.id]);
    }
  });
});
