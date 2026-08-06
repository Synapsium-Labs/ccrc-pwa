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
function runnerFor(info: Map<string, Seeded>): Runner {
  return async (_cmd, args) => {
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') {
      const target = args[2] ?? '';
      const id = target.startsWith('cc-') ? target.slice('cc-'.length) : '';
      const pid = info.get(id)?.pid;
      return { code: 0, stdout: pid ? `${pid}\n` : '', stderr: '' };
    }
    if (args[0] === 'capture-pane') return { code: 0, stdout: 'ready\n❯ \n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
}

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
}): { tick: () => Promise<void>; markIdle: (id: string) => void } {
  const home = mkTmp('ccrc-');
  const info = seedSessions(home, opts.sessions);
  const deps = {
    ...testDeps(home, runnerFor(info)),
    push: opts.push as never,
    presence: opts.presence,
    notifyLog: opts.notifyLog,
  };
  const w = new FleetWatcher(deps, new Bus(), 10_000);
  return {
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
