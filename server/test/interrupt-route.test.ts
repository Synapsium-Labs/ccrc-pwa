// D-5236 (plan docs/superpowers/plans/2026-10-16-working-state-and-interruptions.md, Task 6; spec §5.5): the interrupt
// route answers `409 background-only` and presses NO key when Escape would interrupt nothing — no pane menu pending, and
// either (a) the raw live word is `busy`, the row carries `background` and its hook state is a `done` from a `Stop`
// stamped NEWER than the live file's `statusUpdatedAt` (the main turn ended; delegated work runs on), or (b) the raw live word is `shell`
// (an idle main loop over a background shell or monitor). Everything else keeps today's answers.
//
// The harness follows `dispatch-live-gate.test.ts` (a pane whose pid and live file the fixture writes, the watcher's
// pending dialogs, one runner answering tmux so every key is in one `calls` log). The hookstate copies the key set
// `ccd/session-hook.sh` writes at a main Stop (`v`, `state`, `event`, `sessionId`, `pid`, `updatedAt`, `ask`,
// `subagents`, `graphQueries`, `graphGateDenials`, `ccrcPeerReads`, `ccrcClaims`, and D-5231's `bgDelegated` /
// `bgDelegatedKinds` pair); no hook payload is built here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import type { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { interruptVerdict } from '../src/inject/send.js';
import { NotifyLog } from '../src/notifylog.js';
import type { PushService } from '../src/push.js';
import { guardRunner, seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'lane-a-project-a';
const UUID = '00000000-0000-4000-8000-000000000001';
const WRAPPER = 'lane-a';
const PANE = 40613;
const ROSTER = { version: 1, accounts: [{
  id: WRAPPER, label: WRAPPER, configDirSuffix: `.${WRAPPER}`,
  exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
}] };

/** Three stamps, oldest first: the live word's, the hook's Stop, a live re-stamp after it. */
const NOW = Date.now();
const T0 = NOW - 120_000;
const T1 = NOW - 60_000;
const T2 = NOW - 30_000;

let open: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of open) await a.close();
  open = [];
});

interface Box {
  /** The live file's raw word and stamp; `'unreadable'` writes a directory where the file belongs; absent writes none. */
  live?: { status: string; at: number } | 'unreadable';
  /** The hookstate file's state, event, stamp and D-5231 pair; absent writes none. */
  hook?: { state: string; event: string; at: number; bg?: { count: number; kinds: string } };
  /** The watcher's newest pane dialogs. */
  pending?: string[];
  /** tmux proves the pane gone. */
  gone?: boolean;
  /** The request body (D-5237: the optional `source`); absent sends `{}`. */
  payload?: Record<string, unknown>;
  /** Send NO payload and NO content-type at all — the request an older PWA really makes (D-5237). */
  bare?: boolean;
}

const box = async (b: Box) => {
  const home = mkTmp('ccrc-interrupt-route-');
  seedRoster(home, ROSTER);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: WRAPPER, project: 'project-a', workdir: '/data/projects/project-a', uuid: UUID, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  const sdir = path.join(home, `.${WRAPPER}`, 'sessions');
  mkdirSync(sdir, { recursive: true });
  if (b.live === 'unreadable') mkdirSync(path.join(sdir, `${PANE}.json`));
  else if (b.live !== undefined) {
    writeFileSync(path.join(sdir, `${PANE}.json`), JSON.stringify({
      pid: PANE, sessionId: UUID, cwd: '/data/projects/project-a',
      status: b.live.status, statusUpdatedAt: b.live.at, version: '2.1.300',
    }));
  }
  if (b.hook !== undefined) {
    writeFileSync(path.join(reg, `${ID}.hookstate.json`), JSON.stringify({
      v: 1, state: b.hook.state, event: b.hook.event, sessionId: UUID, pid: PANE, updatedAt: b.hook.at,
      ask: null, subagents: [], graphQueries: 0, graphGateDenials: 0, ccrcPeerReads: 0, ccrcClaims: 0,
      ...(b.hook.bg !== undefined ? { bgDelegated: b.hook.bg.count, bgDelegatedKinds: b.hook.bg.kinds } : {}),
    }));
  }
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const verb = args[0] ?? '';
    if (verb === 'has-session') return { code: b.gone ? 1 : 0, stdout: '', stderr: '' };
    if (verb === 'list-panes') return b.gone ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: `${PANE}\n`, stderr: '' };
    if (verb === 'capture-pane') return b.gone ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: 'scrollback\n❯ \n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const guarded = guardRunner(run);
  const cfg = loadConfig({ CCRC_HOME: home });
  const watcher = { currentPending: () => new Set(b.pending ?? []), currentStatuslines: () => new Map(),
    stop: () => {} } as unknown as FleetWatcher;
  // D-5237: a real feed ring, and a push spy that must never be called — an interrupt is recorded, never pushed.
  const notifyLog = new NotifyLog(path.join(home, 'notify-log.json'));
  await notifyLog.load();
  const notify = vi.fn(async () => {});
  const app = await buildServer(
    { cfg, runCcd: ccdRunner(guarded, cfg), tmux: new Tmux(guarded), io: localIO, queue: new KeyedQueue(),
      notifyLog, push: { notify } as unknown as PushService },
    new Bus(), watcher);
  open.push(app);
  const url = `/api/sessions/${ID}/interrupt`;
  const res = b.bare ? await app.inject({ method: 'POST', url }) : await app.inject({ method: 'POST', url, payload: b.payload ?? {} });
  const recorded = notifyLog.catchUp(notifyLog.epoch, 0).events.map((e) => ({ kind: e.kind, sessionId: e.sessionId, body: e.body }));
  return { res, keys: calls.filter((c) => c[0] === 'send-keys'), recorded, pushes: notify.mock.calls.length };
};

const ESCAPE = [['send-keys', '-t', `=cc-${ID}:`, 'Escape']];
/** A main Stop's `done` with two delegated workflow tasks still running, stamped after the live word. */
const STOP_BG = { state: 'done', event: 'Stop', at: T1, bg: { count: 2, kinds: 'workflow' } };

describe('POST /api/sessions/:id/interrupt over background-only work (D-5236)', () => {
  it('live busy, then a main Stop newer than it with delegated work running: 409 background-only, no key', async () => {
    const { res, keys } = await box({ live: { status: 'busy', at: T0 }, hook: STOP_BG });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'background-only', count: 2, kinds: ['workflow'] });
    expect(keys).toEqual([]);
  });

  it('the live file re-stamped busy AFTER that Stop (a turn begun with no hook event): Escape', async () => {
    const { res, keys } = await box({ live: { status: 'busy', at: T2 }, hook: STOP_BG });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(keys).toEqual(ESCAPE);
  });

  // The hook re-stamps `updatedAt` when a SubagentStop carries the `done` (D-5272), so the carried stamp is newer than a
  // turn begun after the Stop: only a Stop's stamp proves the main turn ended, and Escape must reach this one.
  it('a SubagentStop re-stamps the done after a live re-stamp (a turn running): Escape', async () => {
    const hook = { state: 'done', event: 'SubagentStop', at: NOW - 1000, bg: { count: 1, kinds: 'workflow' } };
    const { res, keys } = await box({ live: { status: 'busy', at: T2 }, hook });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(keys).toEqual(ESCAPE);
  });

  it('live shell, no menu: 409 background-only with no count, no key', async () => {
    const { res, keys } = await box({ live: { status: 'shell', at: T0 } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'background-only', count: null, kinds: [] });
    expect(keys).toEqual([]);
  });

  it('live busy, hook working: Escape', async () => {
    const { res, keys } = await box({ live: { status: 'busy', at: T0 }, hook: { state: 'working', event: 'PostToolUse', at: T1 } });
    expect(res.statusCode).toBe(200);
    expect(keys).toEqual(ESCAPE);
  });

  it('a pane menu pending with background set (a Deny): Escape', async () => {
    const { res, keys } = await box({ live: { status: 'busy', at: T0 }, hook: STOP_BG, pending: [ID] });
    expect(res.statusCode).toBe(200);
    expect(keys).toEqual(ESCAPE);
  });

  it('a pane menu pending under shell: Escape', async () => {
    const { res, keys } = await box({ live: { status: 'shell', at: T0 }, pending: [ID] });
    expect(res.statusCode).toBe(200);
    expect(keys).toEqual(ESCAPE);
  });

  it('live waiting: Escape', async () => {
    const { res, keys } = await box({ live: { status: 'waiting', at: T0 }, hook: STOP_BG });
    expect(res.statusCode).toBe(200);
    expect(keys).toEqual(ESCAPE);
  });

  it('live idle: 409 not-busy, no key', async () => {
    const { res, keys } = await box({ live: { status: 'idle', at: T0 } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'not-busy' });
    expect(keys).toEqual([]);
  });

  it('an unreadable live file: 409 not-busy, unchanged (D-115), no key', async () => {
    const { res, keys } = await box({ live: 'unreadable', hook: STOP_BG });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'not-busy' });
    expect(keys).toEqual([]);
  });

  it('no pane: 409 not-alive, no key', async () => {
    const { res, keys } = await box({ live: { status: 'busy', at: T0 }, gone: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'not-alive' });
    expect(keys).toEqual([]);
  });
});

// The rule itself, on reads the route cannot assemble: `fleet.ts` ships `background` only on a `done`, so a `working`
// row that still carries it is reachable only here — the hook-state check must hold on its own, not lean on that
// (D-5343: this case, not the route's `working` one, is what the plan's "ignores the hook state" mutant turns red).
describe('interruptVerdict (D-5236)', () => {
  const BG = { count: 2, kinds: ['workflow'] };
  const busy = { ok: true as const, word: 'busy', since: T0 };
  it('a working hook state over a background pair is a turn', () => {
    expect(interruptVerdict({ word: busy, row: { dialogPending: false, hookState: 'working', background: BG }, hookUpdatedAt: T1,
      hookEvent: 'Stop' }))
      .toEqual({ kind: 'turn' });
  });
  it('a done newer than the live stamp over the pair is background-only', () => {
    expect(interruptVerdict({ word: busy, row: { dialogPending: false, hookState: 'done', background: BG }, hookUpdatedAt: T1,
      hookEvent: 'Stop' }))
      .toEqual({ kind: 'background-only', count: 2, kinds: ['workflow'] });
  });
  it('a done an agent event carried, newer than the live stamp, is a turn', () => {
    for (const hookEvent of ['SubagentStart', 'SubagentStop', null]) {
      expect(interruptVerdict({ word: busy, row: { dialogPending: false, hookState: 'done', background: BG },
        hookUpdatedAt: T1, hookEvent }))
        .toEqual({ kind: 'turn' });
    }
  });
  it('a row that could not be assembled is a turn, under shell too', () => {
    expect(interruptVerdict({ word: { ok: true, word: 'shell', since: T0 }, row: null, hookUpdatedAt: null, hookEvent: null }))
      .toEqual({ kind: 'turn' });
  });
});

// D-5237 (plan Task 7; spec §5.5): every interrupt the route answers is recorded as a feed event of kind `interrupt`,
// with the source the client named (or `unknown`) and the outcome, and never pushed.
describe('POST /api/sessions/:id/interrupt records its source and outcome (D-5237)', () => {
  const rec = (body: string) => [{ kind: 'interrupt', sessionId: ID, body }];

  it('a keycap Escape that is sent is recorded `source=keycap outcome=sent`, and nothing is pushed', async () => {
    const { res, keys, recorded, pushes } = await box({ live: { status: 'busy', at: T0 }, payload: { source: 'keycap' } });
    expect(res.statusCode).toBe(200);
    expect(keys).toEqual(ESCAPE);
    expect(recorded).toEqual(rec('source=keycap outcome=sent'));
    expect(pushes).toBe(0);
  });

  it('each route source the PWA sends is kept', async () => {
    for (const source of ['keycap', 'escape-key', 'deny']) {
      const { recorded } = await box({ live: { status: 'busy', at: T0 }, payload: { source } });
      expect(recorded, source).toEqual(rec(`source=${source} outcome=sent`));
    }
  });

  it('no source is `unknown`', async () => {
    const { recorded } = await box({ live: { status: 'busy', at: T0 } });
    expect(recorded).toEqual(rec('source=unknown outcome=sent'));
  });

  it('an older PWA\'s bare POST (no payload, no content-type) is answered 200 and recorded `unknown`', async () => {
    const { res, keys, recorded } = await box({ live: { status: 'busy', at: T0 }, bare: true });
    expect(res.statusCode).toBe(200);
    expect(keys).toEqual(ESCAPE);
    expect(recorded).toEqual(rec('source=unknown outcome=sent'));
  });

  it('a source it does not know is `unknown`, never a 400; a drawer source is not the route\'s to claim', async () => {
    for (const source of ['x', 'drawer-escape', 'drawer-ctrl-c', 7, null]) {
      const { res, recorded } = await box({ live: { status: 'busy', at: T0 }, payload: { source } });
      expect(res.statusCode, String(source)).toBe(200);
      expect(recorded, String(source)).toEqual(rec('source=unknown outcome=sent'));
    }
  });

  it('the background-only refusal is recorded too, with no key and no push', async () => {
    const { res, keys, recorded, pushes } = await box({ live: { status: 'busy', at: T0 }, hook: STOP_BG, payload: { source: 'escape-key' } });
    expect(res.statusCode).toBe(409);
    expect(keys).toEqual([]);
    expect(recorded).toEqual(rec('source=escape-key outcome=background-only'));
    expect(pushes).toBe(0);
  });

  it('not-busy and not-alive are recorded with their outcome', async () => {
    const idle = await box({ live: { status: 'idle', at: T0 }, payload: { source: 'deny' } });
    expect(idle.recorded).toEqual(rec('source=deny outcome=not-busy'));
    const gone = await box({ live: { status: 'busy', at: T0 }, gone: true, payload: { source: 'keycap' } });
    expect(gone.recorded).toEqual(rec('source=keycap outcome=not-alive'));
    expect(idle.pushes + gone.pushes).toBe(0);
  });
});
