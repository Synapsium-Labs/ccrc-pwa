// D-5925 (durability tail spec §5): a held question, and a held permission prompt, survive a server restart.
// The in-memory carriers (`heldAsks`, `heldApprovals`) stay in memory (D-2169); the boot's unprimed tick re-seeds
// them from the rows that already hold their deadline and identity, matched against the pane it measures. A
// "restart" here is a second `FleetWatcher` built over the same `coord.db` and the same fixture home: its first tick
// is unprimed, exactly as a fresh process's is. The clock is `Date.now()` mocked (`asks-sweep.test.ts`'s idiom).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import type { PushPayload } from '../src/push.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { localIO } from '../src/io.js';
import { okAsk, okAsks } from './coordReadHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

const at = (ms: number): void => { vi.spyOn(Date, 'now').mockReturnValue(ms); };

const T0 = 1_785_500_000_000;
// Mirrored, not imported (asks-sweep.test.ts's own reasoning: the literal is the mutation control).
const ASK_GRACE_MS = 180_000;
const ASK_SWEEP_MS = 10_000;
const ASK_ANSWERING_MAX_MS = 60_000;
const APPROVAL_WINDOW_MS = 60_000;

const CHILD = 'cc-a';
const PARENT = 'coord-1';
const PROJECT = 'project-a';

const oneQuestion = { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false,
  options: [{ label: 'Red' }, { label: 'Blue' }] }] };
const MENU_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\n  3. Green\nEnter to select\n';
const OTHER_MENU_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\n  3. Pink\nEnter to select\n';
const BARE_PROMPT = 'ready\n❯ \n';
const RULE = '─'.repeat(60);
const PERMISSION_PANE = ['  ⎿  $ rm -rf build', RULE, ' Bash command', '   rm -rf build', '   Remove the build directory',
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and always allow access to this project', '   3. No',
  ' Esc to cancel · Tab to amend'].join('\n');
const APPROVAL_ASK = { approval: { tool: 'Bash', summary: 'rm -rf build' } };

type Held = { until: number; askId: number; answeringSince: number | null; ev: unknown };
const heldMap = (w: FleetWatcher): Map<string, Held> =>
  (w as unknown as { heldAsks: Map<string, Held> }).heldAsks;
type HeldApproval = { until: number; dialogId: string; rowIds: number[]; ev: unknown };
const heldApprovalMap = (w: FleetWatcher): Map<string, HeldApproval> =>
  (w as unknown as { heldApprovals: Map<string, HeldApproval> }).heldApprovals;

function fixture() {
  const home = mkTmp('ccrc-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfgDir = path.join(home, '.claude');
  mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
  const pids = new Map<string, number>();
  let pid = 72000;
  const addSession = (id: string): void => {
    pid += 1;
    pids.set(id, pid);
    const fields: Record<string, string> = { wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
    writeFileSync(path.join(cfgDir, 'sessions', `${pid}.json`), JSON.stringify({
      pid, sessionId: `s-${id}`, cwd: '/d', status: 'busy', statusUpdatedAt: Date.now(),
    }));
  };
  addSession(CHILD);
  addSession(PARENT);
  const panes = new Map<string, string>();
  const unmeasured = new Set<string>();
  const runner: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    const id = /^=cc-(.*):$/.exec(args[2] ?? '')?.[1] ?? '';
    if (args[0] === 'list-panes') {
      const p = pids.get(id);
      return { code: 0, stdout: p ? `${p}\n` : '', stderr: '' };
    }
    if (args[0] === 'capture-pane') {
      if (unmeasured.has(id)) return { code: 1, stdout: '', stderr: 'capture failed' };
      return { code: 0, stdout: panes.get(id) ?? BARE_PROMPT, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const sent: PushPayload[] = [];
  const push = { notify: async (p: PushPayload) => { sent.push(p); } };
  const deps = { ...testDeps(home, runner), push: push as never, coord, io: localIO };
  const watcher = (withCoord = true): FleetWatcher =>
    new FleetWatcher(withCoord ? deps : { ...deps, coord: undefined }, new Bus(), 10_000);
  const writeHook = (ask: unknown, state = 'waiting'): void => {
    writeFileSync(path.join(reg, `${CHILD}.hookstate.json`), JSON.stringify({
      v: 1, state, sessionId: `u-${CHILD}`, pid: 1, updatedAt: Date.now(), ask, subagents: [],
    }));
  };
  const askPushes = (): PushPayload[] => sent.filter((p) => p.tag === `ask-${CHILD}`);
  const parentMail = (): number =>
    (coord.db.prepare('SELECT COUNT(*) AS n FROM mail WHERE toId = ?').get(PARENT) as { n: number }).n;
  const askCount = (): number =>
    (coord.db.prepare('SELECT COUNT(*) AS n FROM asks WHERE childId = ?').get(CHILD) as { n: number }).n;
  return { home, reg, coord, sent, panes, unmeasured, watcher, writeHook, askPushes, parentMail, askCount };
}
type Fx = ReturnType<typeof fixture>;

/** The pre-restart life: a run claimed by the parent, the child marked, the first watcher primed, the question
 *  painted and held (minted `held`, the parent mailed). Returns the first watcher and the row's id. */
async function holdBeforeRestart(f: Fx): Promise<{ w1: FleetWatcher; askId: number }> {
  const run = f.coord.openRun({
    program: 'prog', title: 'Prog', project: PROJECT, wave: 1, waveOf: null, claimedBy: PARENT, coordProject: PROJECT,
  }) as { id: number };
  f.coord.setSession(run.id, CHILD);
  writeFileSync(path.join(f.reg, `${CHILD}.child`), String(run.id));
  const w1 = f.watcher();
  await w1.tick();                                          // priming
  f.writeHook(oneQuestion);
  f.panes.set(CHILD, MENU_PANE);
  await w1.tick();                                          // mints, holds, mails the parent
  const held = okAsks(f.coord.asksForParent(PARENT, 'held'));
  expect(held).toHaveLength(1);
  expect(f.parentMail()).toBe(1);
  expect(f.askPushes()).toEqual([]);
  return { w1, askId: held[0]!.id };
}

/** The pre-restart life of a permission prompt: a main-thread row held for the parent, painted and deferred. */
async function holdApprovalBeforeRestart(f: Fx): Promise<{ w1: FleetWatcher; rowId: number }> {
  const w1 = f.watcher();
  await w1.tick();                                          // priming
  const rowId = f.coord.insertApproval({
    childId: CHILD, parentId: PARENT, runId: null, digest: 'd'.repeat(64), nonce: 'n'.repeat(32), agentId: '', tool: 'Bash',
    inputRedacted: 'rm -rf build', truncated: false, class: 'write', askAt: Date.now(),
    notifyAt: Date.now() + APPROVAL_WINDOW_MS,
  });
  f.writeHook(APPROVAL_ASK);
  f.panes.set(CHILD, PERMISSION_PANE);
  await w1.tick();
  expect(heldApprovalMap(w1).has(CHILD)).toBe(true);
  expect(f.askPushes()).toEqual([]);
  return { w1, rowId };
}

describe('held questions survive a restart (D-5925)', () => {
  it('a held row whose dialog is still painted re-seeds and pushes once at askNotifyAt(at)', async () => {
    at(T0);
    const f = fixture();
    const { askId } = await holdBeforeRestart(f);
    at(T0 + 20_000);
    const w2 = f.watcher();
    await w2.tick();                                        // the boot tick: unprimed
    expect(heldMap(w2).get(CHILD)?.askId).toBe(askId);
    expect(heldMap(w2).get(CHILD)?.until).toBe(T0 + ASK_GRACE_MS);
    at(T0 + 30_000);
    await w2.tick();
    at(T0 + ASK_GRACE_MS - 1_000);
    await w2.sweepAsks();
    expect(f.askPushes()).toEqual([]);
    at(T0 + ASK_GRACE_MS + ASK_SWEEP_MS);
    await w2.sweepAsks();
    expect(f.askPushes()).toHaveLength(1);
    expect(okAsk(f.coord.askById(askId))!.state).toBe('released');
    at(T0 + ASK_GRACE_MS + 3 * ASK_SWEEP_MS);
    await w2.tick();
    await w2.sweepAsks();
    expect(f.askPushes()).toHaveLength(1);
    expect(f.askCount()).toBe(1);
    expect(f.parentMail()).toBe(1);
  });

  it('a bumped askAt with the same dialog and askKey still re-seeds and is re-stamped', async () => {
    at(T0);
    const f = fixture();
    const { askId } = await holdBeforeRestart(f);
    at(T0 + 40_000);
    f.writeHook(oneQuestion);                               // the same question under a fresh updatedAt (D-2403)
    const w2 = f.watcher();
    await w2.tick();
    const row = okAsk(f.coord.askById(askId))!;
    expect(row.state).toBe('held');
    expect(row.askAt).toBe(T0 + 40_000);
    expect(heldMap(w2).get(CHILD)?.askId).toBe(askId);
  });

  it('a held row past its deadline at boot pushes on the first primed sweep', async () => {
    at(T0);
    const f = fixture();
    const { askId } = await holdBeforeRestart(f);
    at(T0 + ASK_GRACE_MS + 60_000);
    const w2 = f.watcher();
    await w2.tick();
    expect(f.askPushes()).toEqual([]);                      // the boot tick raises nothing
    await w2.sweepAsks();
    expect(f.askPushes()).toHaveLength(1);
    expect(okAsk(f.coord.askById(askId))!.state).toBe('released');
  });

  it('a measured pane with another dialog settles stale and pushes nothing', async () => {
    at(T0);
    const f = fixture();
    const { askId } = await holdBeforeRestart(f);
    at(T0 + 20_000);
    f.panes.set(CHILD, OTHER_MENU_PANE);                    // same envelope, another menu painted
    const w2 = f.watcher();
    await w2.tick();
    expect(okAsk(f.coord.askById(askId))!.state).toBe('stale');
    expect(heldMap(w2).has(CHILD)).toBe(false);
    at(T0 + ASK_GRACE_MS + ASK_SWEEP_MS);
    await w2.tick();
    await w2.sweepAsks();
    expect(f.askPushes()).toEqual([]);
  });

  it('a measured pane with no dialog settles stale and pushes nothing', async () => {
    at(T0);
    const f = fixture();
    const { askId } = await holdBeforeRestart(f);
    at(T0 + 20_000);
    f.panes.set(CHILD, BARE_PROMPT);
    const w2 = f.watcher();
    await w2.tick();
    expect(okAsk(f.coord.askById(askId))!.state).toBe('stale');
    at(T0 + ASK_GRACE_MS + ASK_SWEEP_MS);
    await w2.sweepAsks();
    expect(f.askPushes()).toEqual([]);
  });

  it('an unmeasured pane leaves the row held', async () => {
    at(T0);
    const f = fixture();
    const { askId } = await holdBeforeRestart(f);
    at(T0 + 20_000);
    f.unmeasured.add(CHILD);
    const w2 = f.watcher();
    await w2.tick();
    at(T0 + 22_000);
    await w2.tick();
    expect(okAsk(f.coord.askById(askId))!.state).toBe('held');
    expect(f.askPushes()).toEqual([]);
  });

  it('a pane unmeasured at boot and measured later re-seeds with no second insertAsk and no second parent mail', async () => {
    at(T0);
    const f = fixture();
    const { askId } = await holdBeforeRestart(f);
    at(T0 + 20_000);
    f.unmeasured.add(CHILD);
    const w2 = f.watcher();
    await w2.tick();                                        // boot: the pane cannot be measured
    f.unmeasured.delete(CHILD);
    at(T0 + 22_000);
    await w2.tick();                                        // primed: measured now
    await w2.tick();
    expect(f.askCount()).toBe(1);
    expect(f.parentMail()).toBe(1);
    expect(heldMap(w2).get(CHILD)?.askId).toBe(askId);
    expect(f.askPushes()).toEqual([]);
    at(T0 + ASK_GRACE_MS + ASK_SWEEP_MS);
    await w2.sweepAsks();
    expect(f.askPushes()).toHaveLength(1);
  });

  it('a child measured absent from the registry listing settles its row stale', async () => {
    at(T0);
    const f = fixture();
    const { askId } = await holdBeforeRestart(f);
    at(T0 + 20_000);
    for (const k of ['wrapper', 'project', 'workdir', 'uuid', 'started', 'child', 'hookstate.json']) {
      rmSync(path.join(f.reg, `${CHILD}.${k}`), { force: true });
    }
    const w2 = f.watcher();
    await w2.tick();
    expect(okAsk(f.coord.askById(askId))!.state).toBe('stale');
  });

  it('no coord.db: nothing re-seeded, today\'s behaviour', async () => {
    at(T0);
    const f = fixture();
    await holdBeforeRestart(f);
    at(T0 + 20_000);
    const w2 = f.watcher(false);
    await w2.tick();
    await w2.tick();
    expect(heldMap(w2).size).toBe(0);
    expect(heldApprovalMap(w2).size).toBe(0);
    expect(f.askPushes()).toEqual([]);
  });

  it('an answering row re-seeds with answeringSince null', async () => {
    at(T0);
    const f = fixture();
    const { askId } = await holdBeforeRestart(f);
    f.coord.db.prepare("UPDATE asks SET state = 'answering' WHERE id = ?").run(askId);
    at(T0 + ASK_GRACE_MS + ASK_ANSWERING_MAX_MS);
    const w2 = f.watcher();
    await w2.tick();
    expect(heldMap(w2).get(CHILD)?.answeringSince).toBeNull();
    at(T0 + ASK_GRACE_MS + ASK_ANSWERING_MAX_MS + ASK_SWEEP_MS);
    await w2.sweepAsks();                                   // first observation of `answering`: the bound starts now
    expect(f.askPushes()).toEqual([]);
    at(T0 + ASK_GRACE_MS + 2 * ASK_ANSWERING_MAX_MS + ASK_SWEEP_MS);
    await w2.sweepAsks();
    expect(f.askPushes()).toHaveLength(1);
  });

  it('a parent\'s answer after the re-seed wins as before (late answer wins, D-5289)', async () => {
    at(T0);
    const f = fixture();
    const { askId } = await holdBeforeRestart(f);
    at(T0 + 20_000);
    const w2 = f.watcher();
    await w2.tick();
    at(T0 + ASK_GRACE_MS + ASK_SWEEP_MS);
    await w2.sweepAsks();
    expect(f.askPushes()).toHaveLength(1);
    w2.answeredLate(CHILD, askId, PARENT);
    const pushes = f.askPushes();
    expect(pushes).toHaveLength(2);
    expect(pushes[1]!.body).toContain(PARENT);
    expect(pushes[1]!.actions ?? []).toEqual([]);
  });

  it('hold() and the re-seed build the same payload', async () => {
    at(T0);
    const f = fixture();
    const { w1 } = await holdBeforeRestart(f);
    const minted = heldMap(w1).get(CHILD)!.ev;
    at(T0 + 20_000);
    const w2 = f.watcher();
    await w2.tick();
    expect(heldMap(w2).get(CHILD)!.ev).toEqual(minted);
  });
});

describe('held permission prompts survive a restart (D-5925, spec §5.3)', () => {
  it('a permission prompt painted across a restart is pushed once its rows are no longer held', async () => {
    // Restarted inside the window: the lapse after boot pushes.
    at(T0);
    const f = fixture();
    await holdApprovalBeforeRestart(f);
    at(T0 + 20_000);
    const w2 = f.watcher();
    await w2.tick();
    expect(heldApprovalMap(w2).has(CHILD)).toBe(true);
    at(T0 + APPROVAL_WINDOW_MS - 1_000);
    await w2.tick();
    expect(f.askPushes()).toEqual([]);
    at(T0 + APPROVAL_WINDOW_MS + 1_000);
    await w2.tick();
    expect(f.askPushes()).toHaveLength(1);
    at(T0 + APPROVAL_WINDOW_MS + 5_000);
    await w2.tick();
    expect(f.askPushes()).toHaveLength(1);

    // Restarted past the window: the row lapses on the boot tick itself, after the snapshot was taken.
    at(T0);
    const g = fixture();
    await holdApprovalBeforeRestart(g);
    at(T0 + APPROVAL_WINDOW_MS + 30_000);
    const v2 = g.watcher();
    await v2.tick();
    at(T0 + APPROVAL_WINDOW_MS + 32_000);
    await v2.tick();
    expect(g.askPushes()).toHaveLength(1);
  });

  it('a row released and pushed before the restart is not pushed again', async () => {
    at(T0);
    const f = fixture();
    const { w1, rowId } = await holdApprovalBeforeRestart(f);
    at(T0 + APPROVAL_WINDOW_MS + 1_000);
    await w1.tick();                                        // lapses and pushes, before the restart
    expect(f.askPushes()).toHaveLength(1);
    const read = f.coord.approvalById(rowId);
    expect(read.ok && read.row?.state).toBe('released');
    at(T0 + APPROVAL_WINDOW_MS + 20_000);
    const w2 = f.watcher();
    await w2.tick();
    at(T0 + APPROVAL_WINDOW_MS + 22_000);
    await w2.tick();
    expect(f.askPushes()).toHaveLength(1);
  });
});
