// Task 6 (D-2172, D-2173): the mint point. A live, single-select, single-
// question dialog whose child has a derivable parent gets its operator push
// DEFERRED — recorded, never pushed — and an ask row minted in `held`. Every
// other shape (no parent; an envelope `askActions` refuses) pushes exactly as
// today.
//
// The harness below combines two idioms already proven elsewhere in this
// tree rather than inventing a third: `push-copy.test.ts`'s multi-session
// `seedSessions`/`watcher()` (registry + live-status + a real `CoordStore`)
// and its own `askFixture()`'s mutable pane + `writeHookState` (a menu that
// can appear mid-test, with an envelope written alongside it). No existing
// suite drives BOTH a parent/child `CoordStore` relationship and a dialog
// scrape in the same fixture, because this is the first task that needs to.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { NotifyLog } from '../src/notifylog.js';
import type { PushPayload } from '../src/push.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';

const dir = async () => mkdtemp(path.join(tmpdir(), 'asks-mint-'));

/** Per-session bookkeeping the registry + live-status files need — copied
 *  verbatim from `push-copy.test.ts`'s own `Seeded`/`seedSessions`. */
interface Seeded { pid: number; cfgDir: string }

const liveStatusFile = (s: Seeded): string => path.join(s.cfgDir, 'sessions', `${s.pid}.json`);

const writeLiveStatus = (s: Seeded, id: string, status: 'busy' | 'idle'): void => {
  writeFileSync(liveStatusFile(s), JSON.stringify({
    pid: s.pid, sessionId: `s-${id}`, cwd: '/d', status, statusUpdatedAt: Date.now(),
  }));
};

/** Seeds one registry entry + one live-status file (starting `busy`) per
 *  `"<project>/<id>"` spec, all under the `claude` wrapper so every session
 *  shares one cfgDir — verbatim idiom from `push-copy.test.ts`. */
function seedSessions(home: string, specs: string[]): Map<string, Seeded> {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfgDir = path.join(home, '.claude');
  mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
  const info = new Map<string, Seeded>();
  let pid = 51000;
  for (const spec of specs) {
    const [project, id] = spec.split('/');
    pid += 1;
    const fields: Record<string, string> = {
      wrapper: 'claude', project: project!, workdir: `/w/${id!}`, uuid: `u-${id!}`, started: '1',
    };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id!}.${f}`), v);
    const seeded: Seeded = { pid, cfgDir };
    info.set(id!, seeded);
    writeLiveStatus(seeded, id!, 'busy');
  }
  return info;
}

/** `~/.cc-sessions/<id>.hookstate.json`, the way `session-hook.sh` writes
 *  it — verbatim from `push-copy.test.ts`. `sessionId` matches `seedSessions`'
 *  `uuid` field so `readHookState`'s identity gate accepts it. */
function writeHookState(home: string, id: string, ask: unknown, state = 'waiting'): void {
  writeFileSync(path.join(home, '.cc-sessions', `${id}.hookstate.json`), JSON.stringify({
    v: 1, state, sessionId: `u-${id}`, pid: 1, updatedAt: Date.now(), ask, subagents: [],
  }));
}

const oneQuestion = (options: { label: string }[]) => ({
  questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options }],
});

const MENU_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\n  3. Green\nEnter to select\n';
const BARE_PROMPT = 'ready\n❯ \n';

/**
 * A `FleetWatcher` over a throwaway fixture home, wired to a real `CoordStore`
 * (so `parentOfSession`/`insertAsk`/mail all land in a real `coord.db`), with
 * one mutable pane PER SESSION so two children can show different menus in
 * the same tick — `capture-pane`'s target (`args[2]`, same position
 * `list-panes` already parses in `push-copy.test.ts`) routes to the right one.
 */
function fixture(opts: {
  push: { notify: (p: PushPayload) => Promise<void> };
  notifyLog?: NotifyLog;
  sessions: string[];
}): {
  coord: CoordStore; home: string;
  tick: () => Promise<void>;
  showMenu: (id: string, text?: string) => void;
  writeAsk: (id: string, ask: unknown, state?: string) => void;
} {
  const home = mkTmp('ccrc-');
  const info = seedSessions(home, opts.sessions);
  const panes = new Map<string, string>(opts.sessions.map((spec) => [spec.split('/')[1]!, BARE_PROMPT]));
  const runner: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    const target = args[2] ?? '';
    const id = target.startsWith('cc-') ? target.slice('cc-'.length) : '';
    if (args[0] === 'list-panes') {
      const pid = info.get(id)?.pid;
      return { code: 0, stdout: pid ? `${pid}\n` : '', stderr: '' };
    }
    if (args[0] === 'capture-pane') return { code: 0, stdout: panes.get(id) ?? BARE_PROMPT, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps = { ...testDeps(home, runner), push: opts.push as never, notifyLog: opts.notifyLog, coord };
  const w = new FleetWatcher(deps, new Bus(), 10_000);
  return {
    coord, home,
    tick: () => w.tick(),
    showMenu: (id: string, text: string = MENU_PANE) => { panes.set(id, text); },
    writeAsk: (id: string, ask: unknown, state?: string) => writeHookState(home, id, ask, state),
  };
}

/** The tag `pushOne` gives a `kind: 'ask'` push by default — `PushPayload`
 *  itself carries no `kind`, so this is the only way a test can tell an ask
 *  push for THIS session apart from any other push in the same tick. */
const askTag = (id: string): string => `ask-${id}`;

describe('the ask mint point (D-2172, D-2173)', () => {
  it('holds the push and records the event when a child has a parent (D-2172)', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const log = new NotifyLog(path.join(await dir(), 'n.json'));
    await log.load();
    const f = fixture({ push, notifyLog: log, sessions: ['ccrc-pwa/cc-a'] });

    const run = f.coord.openRun({
      program: 'prog', title: 'Prog', project: 'ccrc-pwa',
      wave: 1, waveOf: null, claimedBy: 'coord-1',
    }) as { id: number };
    f.coord.setSession(run.id, 'cc-a');

    await f.tick();                                    // priming: no menu
    f.writeAsk('cc-a', oneQuestion([{ label: 'Red' }, { label: 'Blue' }]));
    f.showMenu('cc-a');
    await f.tick();                                     // the menu appears → eligible, has a parent

    // Deferred: no actual push notification for the ask.
    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toEqual([]);
    // But recorded — the operator's only durable trace of the question.
    const recorded = log.catchUp(log.epoch, 0).events.filter((e) => e.kind === 'ask');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.sessionId).toBe('cc-a');
    // And minted, held, addressed to the derived parent.
    const held = f.coord.asksForParent('coord-1', 'held');
    expect(held).toHaveLength(1);
    expect(held[0]!.childId).toBe('cc-a');
    expect(held[0]!.parentId).toBe('coord-1');
    expect(held[0]!.question).toBe('Which colour?');
    expect(held[0]!.options).toEqual(['Red', 'Blue']);
  });

  it('pushes immediately when no parent is derivable', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const f = fixture({ push, sessions: ['ccrc-pwa/orphan-1'] });
    // orphan-1 is in no run — `parentOfSession` answers null.

    await f.tick();
    f.writeAsk('orphan-1', oneQuestion([{ label: 'Red' }, { label: 'Blue' }]));
    f.showMenu('orphan-1');
    await f.tick();

    expect(sent.filter((p) => p.tag === askTag('orphan-1'))).toHaveLength(1);
    expect(f.coord.asksForParent('coord-1', 'held')).toEqual([]);
  });

  it('pushes immediately for an ask askActions refuses (D-2173)', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const f = fixture({ push, sessions: ['ccrc-pwa/cc-a'] });

    const run = f.coord.openRun({
      program: 'prog', title: 'Prog', project: 'ccrc-pwa',
      wave: 1, waveOf: null, claimedBy: 'coord-1',
    }) as { id: number };
    f.coord.setSession(run.id, 'cc-a');

    await f.tick();
    // Two questions — `askActions` refuses multi-question no matter who would
    // answer, so holding it would be pure latency with no route to resolve it.
    f.writeAsk('cc-a', {
      questions: [
        { question: 'First?', options: [{ label: 'A' }] },
        { question: 'Second?', options: [{ label: 'B' }] },
      ],
    });
    f.showMenu('cc-a');
    await f.tick();

    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toHaveLength(1);
    expect(f.coord.asksForParent('coord-1', 'held')).toEqual([]);
  });

  it('mails the derived parent with a subject unique per ask', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const f = fixture({ push, sessions: ['ccrc-pwa/cc-a', 'ccrc-pwa/cc-b'] });

    const runA = f.coord.openRun({
      program: 'prog-a', title: 'A', project: 'ccrc-pwa',
      wave: 1, waveOf: null, claimedBy: 'coord-1',
    }) as { id: number };
    f.coord.setSession(runA.id, 'cc-a');
    const runB = f.coord.openRun({
      program: 'prog-b', title: 'B', project: 'ccrc-pwa',
      wave: 1, waveOf: null, claimedBy: 'coord-1',
    }) as { id: number };
    f.coord.setSession(runB.id, 'cc-b');

    await f.tick();                                     // priming
    f.writeAsk('cc-a', oneQuestion([{ label: 'Red' }, { label: 'Blue' }]));
    f.showMenu('cc-a');
    f.writeAsk('cc-b', oneQuestion([{ label: 'Yes' }, { label: 'No' }]));
    f.showMenu('cc-b');
    await f.tick();                                      // both mint in the same tick

    const held = f.coord.asksForParent('coord-1', 'held');
    expect(held).toHaveLength(2);

    const rows = f.coord.db.prepare(
      "SELECT toId, subject FROM mail WHERE fromId = 'operator' AND kind = 'question' ORDER BY id",
    ).all() as { toId: string; subject: string }[];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.toId === 'coord-1')).toBe(true);
    const subjects = rows.map((r) => r.subject);
    expect(new Set(subjects).size).toBe(2);              // distinct, one per ask id
    for (const row of held) expect(subjects).toContain(`ask:${row.id}`);
  });
});
