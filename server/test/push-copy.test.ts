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
import { PRESENCE_REFRESH_MS, PRESENCE_TTL_MS } from '../../shared/api.js';

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

  // PR F whole-branch review, Important 6. A claim was released only by the
  // socket's 'close' handler, and a phone that loses signal in a lift sends no
  // FIN — 'close' never fires, the claim never lapses, and `pushOne` returns
  // BEFORE `notifyLog.record`, so every notification for that session is
  // suppressed for every device AND kept out of the catch-up ring, until the
  // OS eventually gives up retransmitting a write that a quiet stream never
  // makes. The claim expires instead, and expiry means notify.
  it('stops believing a claim nobody has re-stated', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    let now = 1_000_000;
    const presence = new Presence(() => now, PRESENCE_TTL_MS);
    presence.setVisible(Symbol('t'), 'cc-a');        // the phone said so, then vanished
    const w = watcher({ push, presence, sessions: ['ccrc-pwa/cc-a'] });
    await w.tick();
    now += PRESENCE_TTL_MS + 1;                      // no heartbeat ever arrived
    w.markIdle('cc-a');
    await w.tick();
    expect(sent).toHaveLength(1);
  });

  it('keeps believing a claim the client keeps re-stating', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    let now = 1_000_000;
    const presence = new Presence(() => now, PRESENCE_TTL_MS);
    const token = Symbol('t');
    presence.setVisible(token, 'cc-a');
    const w = watcher({ push, presence, sessions: ['ccrc-pwa/cc-a'] });
    await w.tick();
    // Heartbeats at the client's own cadence carry the claim past the TTL.
    for (let i = 0; i < 4; i++) { now += PRESENCE_REFRESH_MS; presence.setVisible(token, 'cc-a'); }
    expect(now).toBeGreaterThan(1_000_000 + PRESENCE_TTL_MS);
    w.markIdle('cc-a');
    await w.tick();
    expect(sent).toEqual([]);
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
  /** One session, one watcher, a pane the test drives — so a test can put the
   *  menu up and the envelope down in whichever ORDER it needs, and tick as
   *  many times as it needs. */
  function askFixture(): {
    sent: PushPayload[];
    tick: () => Promise<void>;
    showMenu: () => void;
    clearMenu: () => void;
    writeAsk: (ask: unknown, state?: string) => void;
  } {
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
    return {
      sent,
      tick: () => w.tick(),
      showMenu: () => { pane = MENU_PANE; },
      clearMenu: () => { pane = 'ready\n❯ \n'; },
      writeAsk: (ask: unknown, state?: string) => writeHookState(home, 'cc-a', ask, state),
    };
  }

  /** Raise a genuine ask push: prime on a bare prompt (so `dialogIds` is
   *  empty), then tick with the menu up, which is the appear-edge. */
  async function raiseAsk(ask: unknown, opts: { state?: string } = {}): Promise<PushPayload[]> {
    const f = askFixture();
    await f.tick();                                  // priming: no menu, notify=false
    if (ask !== undefined) f.writeAsk(ask, opts.state);
    f.showMenu();
    await f.tick();                                  // the menu appears → one ask push
    return f.sent;
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

  // PR F whole-branch review, Important 2. This used to ship the readable
  // sibling and drop the blank one, which looks like the careful choice and is
  // the opposite. `answerAsk`'s menu-identity gate matches EVERY option in the
  // envelope against the pane's rows through `pairMatches`, and `pairMatches`
  // refuses whenever either side normalises to '' — so ONE whitespace-only
  // label refuses EVERY index with `menu-mismatch`, permanently. The shipped
  // button was therefore a guaranteed refusal wearing a false sentence ("The
  // terminal is showing something else now" about the very menu on screen),
  // which is exactly what `askActions`' own docstring calls worse than no
  // action. It is provable from the envelope alone, so it is decided here.
  it('attaches NO actions when ANY option label is blank — every index would be refused', async () => {
    const sent = await raiseAsk(oneQuestion([{ label: '   ' }, { label: 'Blue' }]));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actions).toBeUndefined();
  });

  it('looks past the two labels it would ship — a blank at index 2 poisons 0 and 1 too', async () => {
    const sent = await raiseAsk(oneQuestion([{ label: 'Red' }, { label: 'Blue' }, { label: ' ' }]));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actions).toBeUndefined();
  });

  // PR F whole-branch review (triage). A one-index tap on a multi-select
  // question is accepted by the route and COMMITTED with Enter (that route's
  // "gated on the QUESTION's kind" branch), so a question taking several
  // answers is narrowed to one and submitted irrevocably — and no notification
  // button has room to say "this submits". Answer those in the app.
  it('attaches NO actions to a multi-select question — one tap would commit it', async () => {
    const sent = await raiseAsk({
      questions: [{
        question: 'Which tools?', header: 'Tools', multiSelect: true,
        options: [{ label: 'Bash' }, { label: 'Edit' }],
      }],
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actions).toBeUndefined();
  });

  // PR F whole-branch review, Important 3. Sweeping hook states before the
  // pane capture narrows the window; it cannot close it (the sweep reads at s,
  // this session's capture happens at c, and a hook write landing in (s, c) is
  // invisible to the push composed at c). The ask push is edge-triggered on
  // the dialog id, and that id is a hash of the menu's labels and title — it
  // does not change while the cursor moves — so with no latch that question
  // stays un-answerable from the phone for its entire life, silently. Here the
  // envelope arrives one tick late and the notification is amended.
  it('amends an action-less ask push once the envelope turns up', async () => {
    const f = askFixture();
    await f.tick();                       // priming, no menu
    f.showMenu();
    await f.tick();                       // menu with no envelope → action-less push
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]!.actions).toBeUndefined();

    const ask = oneQuestion([{ label: 'Red' }, { label: 'Blue' }]);
    f.writeAsk(ask);
    await f.tick();                       // same dialog id, envelope now readable
    expect(f.sent).toHaveLength(2);
    const key = askKey(ask as never)!;
    expect(f.sent[1]!.actions).toEqual([
      { action: `ask:${key}:0`, title: 'Red' },
      { action: `ask:${key}:1`, title: 'Blue' },
    ]);
    // Same tag, so this REPLACES the un-answerable notification in its slot
    // rather than stacking a second one under it.
    expect(f.sent[1]!.tag).toBe(f.sent[0]!.tag);

    // Exactly once. A third tick with the envelope still there must not
    // re-notify — the operator would be buzzed every 2 s until they answered.
    await f.tick();
    expect(f.sent).toHaveLength(2);
  });

  it('does not re-push while the envelope never arrives, and forgets the question when the menu clears', async () => {
    const f = askFixture();
    await f.tick();
    f.showMenu();
    await f.tick();
    await f.tick();
    await f.tick();
    expect(f.sent).toHaveLength(1);       // one push, still action-less
    // The menu goes; the same question coming back later is a fresh edge, and
    // must not be answered by the stale latch.
    f.clearMenu();
    await f.tick();
    f.writeAsk(oneQuestion([{ label: 'Red' }]));
    await f.tick();                       // no menu, no envelope-triggered push
    expect(f.sent).toHaveLength(1);
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
