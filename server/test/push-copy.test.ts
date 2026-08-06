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
import { Presence } from '../src/presence.js';
import { askKey } from '../src/askkey.js';
import type { PushPayload } from '../src/push.js';

const dir = async () => mkdtemp(path.join(tmpdir(), 'push-copy-'));

/** Per-session bookkeeping `markIdle` and the tmux runner both need: the pid
 *  the live-status file is keyed by, and the wrapper config dir it lives
 *  under. */
interface Seeded { pid: number; cfgDir: string }

const liveStatusFile = (s: Seeded): string => path.join(s.cfgDir, 'sessions', `${s.pid}.json`);

const writeLiveStatus = (s: Seeded, id: string, status: 'busy' | 'idle'): void => {
  writeFileSync(liveStatusFile(s), JSON.stringify({
    pid: s.pid, sessionId: `s-${id}`, cwd: '/d', status, statusUpdatedAt: Date.now(),
  }));
};

/** Seeds one registry entry + one live-status file (starting `busy`) per
 *  `"<project>/<id>"` spec, all under the `claude` wrapper so every session
 *  shares one cfgDir. */
function seedSessions(home: string, specs: string[]): Map<string, Seeded> {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfgDir = path.join(home, '.claude');
  mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
  const info = new Map<string, Seeded>();
  let pid = 41000;
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

/** `has-session` always alive, `list-panes` answers with the right session's
 *  pid (parsed off the `cc-<id>` target tmux itself builds), `capture-pane`
 *  a plain prompt — never a menu, so dialog detection stays inert and only
 *  the busy→idle edge under test can fire a push. */
function runnerFor(info: Map<string, Seeded>, pane = 'ready\n❯ \n'): Runner {
  return async (_cmd, args) => {
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') {
      const target = args[2] ?? '';
      const id = target.startsWith('cc-') ? target.slice('cc-'.length) : '';
      const pid = info.get(id)?.pid;
      return { code: 0, stdout: pid ? `${pid}\n` : '', stderr: '' };
    }
    if (args[0] === 'capture-pane') return { code: 0, stdout: pane, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
}

/** A pane `paneState` reads as a live menu, so `detectDialogs` raises an ask
 *  push. The default above is a bare prompt precisely so the busy→idle tests
 *  can't have an ask fire underneath them. */
const MENU_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\n  3. Green\nEnter to select\n';

/**
 * Write one `<id>.hookstate.json` the way `session-hook.sh` does, with the
 * `sessionId` `seedSessions` gave the registry entry — `readHookState`'s
 * identity gate compares the two, so a mismatch here reads as "a different
 * session wrote this" and the envelope is correctly ignored.
 */
function writeHookState(home: string, id: string, ask: unknown, state = 'waiting'): void {
  writeFileSync(path.join(home, '.cc-sessions', `${id}.hookstate.json`), JSON.stringify({
    v: 1, state, sessionId: `u-${id}`, pid: 1, updatedAt: Date.now(), ask, subagents: [],
  }));
}

const oneQuestion = (options: { label: string }[]) => ({
  questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options }],
});

/**
 * A `FleetWatcher` over a throwaway fixture home carrying one session per
 * `"<project>/<id>"` spec, all starting `busy` — so the first (priming)
 * `tick()` records `prevStatus: busy` for every one of them and `markIdle`
 * can then drive a genuine busy→idle edge on the next `tick()`.
 */
function watcher(opts: {
  push: { notify: (p: PushPayload) => Promise<void> };
  presence?: Presence;
  notifyLog?: NotifyLog;
  sessions: string[];
  pane?: string;
}): { tick: () => Promise<void>; markIdle: (id: string) => void; home: string } {
  const home = mkTmp('ccrc-');
  const info = seedSessions(home, opts.sessions);
  const deps = {
    ...testDeps(home, runnerFor(info, opts.pane)),
    push: opts.push as never,
    presence: opts.presence,
    notifyLog: opts.notifyLog,
  };
  const w = new FleetWatcher(deps, new Bus(), 10_000);
  return {
    home,
    tick: () => w.tick(),
    markIdle: (id: string) => {
      const s = info.get(id);
      if (!s) throw new Error(`push-copy.test.ts: no seeded session "${id}"`);
      writeLiveStatus(s, id, 'idle');
    },
  };
}

describe('push copy discipline — project context, presence suppression, log fidelity', () => {
  it('omits the project from the title when only one project is active', async () => {
    // Two sessions, ONE project, both transitioning busy→idle.
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const w = watcher({ push, sessions: ['ccrc-pwa/cc-a', 'ccrc-pwa/cc-b'] });
    await w.tick();                    // priming tick — notifies nothing
    w.markIdle('cc-a');
    await w.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe('✓ Finished');       // no ' · ccrc-pwa'
  });

  it('names the project when more than one is active', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const w = watcher({ push, sessions: ['ccrc-pwa/cc-a', 'rp-llm/cc-b'] });
    await w.tick();
    w.markIdle('cc-a');
    await w.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe('✓ Finished · ccrc-pwa');
  });

  it('fires nothing for a session a client reports visible', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const presence = new Presence();
    const token = Symbol('t');
    presence.setVisible(token, 'cc-a');
    const w = watcher({ push, presence, sessions: ['ccrc-pwa/cc-a'] });
    await w.tick();
    w.markIdle('cc-a');
    await w.tick();
    expect(sent).toEqual([]);
  });

  it('fires again once every client has disconnected', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const presence = new Presence();
    const token = Symbol('t');
    presence.setVisible(token, 'cc-a');
    const w = watcher({ push, presence, sessions: ['ccrc-pwa/cc-a'] });
    await w.tick();
    presence.drop(token);
    w.markIdle('cc-a');
    await w.tick();
    expect(sent).toHaveLength(1);
  });

  it('records into the log only what was actually sent', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    const presence = new Presence();
    const token = Symbol('t');
    presence.setVisible(token, 'cc-a');
    const log = new NotifyLog(path.join(await dir(), 'n.json'));
    await log.load();
    const w = watcher({ push, presence, notifyLog: log, sessions: ['ccrc-pwa/cc-a'] });
    await w.tick();
    w.markIdle('cc-a');
    await w.tick();
    // Suppressed by presence, so the catch-up must not claim it happened.
    expect(sent).toEqual([]);
    expect(log.seq).toBe(0);
  });
});

describe('ask notifications carry actions only where the route would accept them', () => {
  /** Raise a genuine ask push: prime on a bare prompt (so `dialogIds` is
   *  empty), then tick with the menu up, which is the appear-edge. */
  async function raiseAsk(ask: unknown, opts: { state?: string } = {}): Promise<PushPayload[]> {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    let pane = 'ready\n❯ \n';
    const home = mkTmp('ccrc-');
    const info = seedSessions(home, ['ccrc-pwa/cc-a']);
    const runner: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: `${info.get('cc-a')!.pid}\n`, stderr: '' };
      if (args[0] === 'capture-pane') return { code: 0, stdout: pane, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const w = new FleetWatcher({ ...testDeps(home, runner), push: push as never }, new Bus(), 10_000);
    await w.tick();                                  // priming: no menu, notify=false
    if (ask !== undefined) writeHookState(home, 'cc-a', ask, opts.state);
    pane = MENU_PANE;
    await w.tick();                                  // the menu appears → one ask push
    return sent;
  }

  it('attaches the first two option labels as actions, each carrying the key', async () => {
    const ask = oneQuestion([{ label: 'Red' }, { label: 'Blue' }, { label: 'Green' }]);
    const sent = await raiseAsk(ask);
    expect(sent).toHaveLength(1);
    const key = askKey(ask as never)!;
    expect(sent[0]!.actions).toEqual([
      { action: `ask:${key}:0`, title: 'Red' },
      { action: `ask:${key}:1`, title: 'Blue' },   // exactly two — the Android ceiling
    ]);
  });

  it('attaches NO actions to a multi-question envelope — the route refuses those', async () => {
    const sent = await raiseAsk({
      questions: [
        { question: 'First?', options: [{ label: 'A' }] },
        { question: 'Second?', options: [{ label: 'B' }] },
      ],
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actions).toBeUndefined();
  });

  it('attaches NO actions to an approval envelope — it has no key at all', async () => {
    const sent = await raiseAsk({ approval: { tool: 'Bash', summary: 'rm -rf /tmp/x' } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actions).toBeUndefined();
  });

  it('attaches NO actions when the ask came from the pane alone, with no hook envelope', async () => {
    const sent = await raiseAsk(undefined);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actions).toBeUndefined();
  });

  it('attaches NO actions when the hook is not waiting', async () => {
    const sent = await raiseAsk(oneQuestion([{ label: 'Red' }]), { state: 'working' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actions).toBeUndefined();
  });

  it('attaches NO actions to a free-text ask — there is no index to send', async () => {
    const sent = await raiseAsk(oneQuestion([]));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actions).toBeUndefined();
  });

  it('drops a blank label rather than shipping an unreadable button', async () => {
    const ask = oneQuestion([{ label: '   ' }, { label: 'Blue' }]);
    const sent = await raiseAsk(ask);
    const key = askKey(ask as never)!;
    // Index 1 keeps its own index — positions never renumber, because the index
    // travels inside the action id.
    expect(sent[0]!.actions).toEqual([{ action: `ask:${key}:1`, title: 'Blue' }]);
  });

  it('reads THIS tick\'s hook state, not last tick\'s', async () => {
    // The ordering pin. `sweepHookStates` runs before `detectDialogs` in
    // `tick()`; reverse them and the envelope written in the same tick as the
    // menu is invisible, so this push would arrive with no actions and whether
    // a question was answerable from the phone would depend on how the 2-second
    // poll happened to straddle the hook's write.
    const ask = oneQuestion([{ label: 'Red' }, { label: 'Blue' }]);
    const sent = await raiseAsk(ask);
    expect(sent[0]!.actions).toHaveLength(2);
  });
});
