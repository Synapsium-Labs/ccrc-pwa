// Characterization of `FleetWatcher.tick()` on main (console speed S1, Step 0).
// Pins what a two-tick run over a six-row fixture fleet EMITS and RECORDS, so the
// later steps that rewrite the tick (one tmux listing, cold rows, frame first,
// state cache on change) are held to unchanged outputs. Green on main before any change.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FleetWatcher } from '../src/watch.js';
import { Bus } from '../src/bus.js';
import { Tmux, type Runner } from '../src/exec.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { usageSidecarPath } from '../src/usage.js';
import type { FleetSession } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { makeHarness } from './tickListingHarness.js';

const LIVE = ['lane-a-project-a', 'lane-a-project-b'];
const STOPPED = ['lane-a-stopped-a', 'lane-a-stopped-b'];
const ARCHIVED = 'lane-a-archived-a';
const CRASHED = 'lane-a-crashed-a';
const STAMP = 1_700_000_000;

const plant = (reg: string, id: string, extra: Record<string, string> = {}): void => {
  const fields: Record<string, string> = {
    wrapper: 'claude', project: id, workdir: `/data/projects/${id}`, uuid: `uuid-${id}`, started: '1', ...extra,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

describe('FleetWatcher.tick characterization (console speed S1, Step 0)', () => {
  it('two ticks over six rows: sessions, pending, statuslines, hook states and the state cache', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    for (const id of LIVE) plant(reg, id);
    STOPPED.forEach((id, i) => plant(reg, id, { stopped: `${STAMP + i} cli`, child: String(100 + i) }));
    plant(reg, ARCHIVED, { archived: String(STAMP) });
    plant(reg, CRASHED);
    // A hook-state file for the first live row (fresh: `updatedAt` is `Date.now()` at plant time).
    const hookUpdatedAt = Date.now();
    writeFileSync(path.join(reg, `${LIVE[0]}.hookstate.json`), JSON.stringify({
      v: 1, state: 'working', event: 'PreToolUse', sessionId: `uuid-${LIVE[0]}`, pid: 4000,
      updatedAt: hookUpdatedAt, ask: null, subagents: [],
    }));
    // A cold-row candidate carries a hook-state file (the first stopped row) and a usage sidecar (the second), so a
    // later step that mishandles a cold row's hook state or usage changes a pinned output. Planted with fixed
    // values: the sidecar's `ts` is old on purpose, so its `stale` flag does not depend on the wall clock.
    // The sidecar has no `cacheExpiresAt` (a hook older than D-8267), so the pinned row reads it null: the field
    // rides the same sidecar read, and the tick's read count is unchanged.
    const stoppedHookAt = Date.now();
    writeFileSync(path.join(reg, `${STOPPED[0]}.hookstate.json`), JSON.stringify({
      v: 1, state: 'idle', event: 'Stop', sessionId: `uuid-${STOPPED[0]}`, pid: 4100,
      updatedAt: stoppedHookAt, ask: null, subagents: [],
    }));
    const usageFile = usageSidecarPath(reg, STOPPED[1]!);
    mkdirSync(path.dirname(usageFile), { recursive: true });
    writeFileSync(usageFile, JSON.stringify({ ts: STAMP, model: 'claude-opus-5', effort: 'high', ctxPct: 12, cost: 1.25 }));

    const run: Runner = async (cmd, args) => {
      const target = args[args.indexOf('-t') + 1] ?? '';
      const live = LIVE.some((id) => target.includes(`cc-${id}`));
      if (cmd === 'tmux' && args[0] === 'has-session') {
        return live ? { ran: true, code: 0, stdout: '', stderr: '' }
          : { ran: true, code: 1, stdout: '', stderr: `can't find session: ${target}` };
      }
      if (cmd === 'tmux' && args[0] === 'list-panes') {
        return live ? { ran: true, code: 0, stdout: `${4000 + LIVE.findIndex((id) => target.includes(id))}\n`, stderr: '' }
          : { ran: true, code: 1, stdout: '', stderr: `can't find session: ${target}` };
      }
      if (cmd === 'tmux' && args[0] === 'capture-pane') {
        // The second live row's pane carries a statusline (model, effort, branch); the first is a bare prompt.
        const rule = '─'.repeat(40);
        const pane = target.includes(LIVE[1]!)
          ? ['done', rule, '❯\u00a0', rule, '  👤 acct-a │ 🤖 Opus 5.5 · xhigh │ ⎇ ws/demo'].join('\n')
          : 'done\n❯ \n';
        return live ? { ran: true, code: 0, stdout: pane, stderr: '' }
          : { ran: true, code: 1, stdout: '', stderr: `can't find session: ${target}` };
      }
      return { ran: true, code: 0, stdout: '', stderr: '' };
    };

    const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
    const cachePath = path.join(home, '.ccrc', 'state-cache.json');
    const deps = {
      cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(),
      fleetState: { connected: true, downSince: null, ccdVerbs: [], rosterFp: null, build: null },
    };
    const bus = new Bus();
    const frames: FleetSession[][] = [];
    bus.on('fleet', (s: FleetSession[]) => frames.push(s));
    const watcher = new FleetWatcher(deps as never, bus, 2000, cachePath);

    await watcher.tick();
    await watcher.tick();
    // Nothing here depends on the wall clock: every timestamp in a row comes from a planted stamp. The one
    // clock-derived value, the hook state's `updatedAt`, is the `Date.now()` the test planted it with (the
    // reader keeps it verbatim), so it is compared to that variable, not to a literal. No fake timers.
    // The runner's call counts are deliberately NOT pinned: they are what later S1 steps change.

    // Tick 2 changed nothing, so the watcher emitted its one 'fleet' frame on tick 1 only.
    expect(frames).toHaveLength(1);
    const sessions = frames[0]!;
    expect(sessions.map((x) => x.id)).toEqual([ARCHIVED, CRASHED, ...LIVE, ...STOPPED]);
    expect(sessions).toMatchInlineSnapshot(`
      [
        {
          "archivedAt": 1700000000,
          "archivedBytes": null,
          "ask": null,
          "askSummary": null,
          "background": null,
          "boardProject": "lane-a-archived-a",
          "branch": null,
          "browserMcp": null,
          "bucket": "archived",
          "bucketSince": 1700000000000,
          "child": {
            "kind": "none",
          },
          "ctxPct": null,
          "deadSince": null,
          "dialogPending": false,
          "effort": null,
          "graphGateDenials": null,
          "graphQueries": null,
          "held": null,
          "hibernatedAt": null,
          "home": "claude",
          "hookState": null,
          "id": "lane-a-archived-a",
          "lastEnd": null,
          "lifecycle": "orphan",
          "limitWait": null,
          "limits": null,
          "model": null,
          "name": null,
          "openRun": null,
          "paneCols": null,
          "pr": null,
          "presence": "dead",
          "project": "lane-a-archived-a",
          "releasedFrom": null,
          "role": "coordinator",
          "route": null,
          "run": null,
          "spawnState": null,
          "started": true,
          "status": "dead",
          "statusUnmeasured": false,
          "statusUpdatedAt": null,
          "stoppedBy": null,
          "stranded": null,
          "subagents": null,
          "substrate": null,
          "swapBlocked": null,
          "tasks": null,
          "title": null,
          "ultracode": false,
          "unmeasured": [],
          "usage": null,
          "version": null,
          "withCoordinator": null,
          "workdir": "/data/projects/lane-a-archived-a",
          "workspace": null,
          "wrapper": "claude",
        },
        {
          "archivedAt": null,
          "archivedBytes": null,
          "ask": null,
          "askSummary": null,
          "background": null,
          "boardProject": "lane-a-crashed-a",
          "branch": null,
          "browserMcp": null,
          "bucket": "dead",
          "bucketSince": null,
          "child": {
            "kind": "none",
          },
          "ctxPct": null,
          "deadSince": null,
          "dialogPending": false,
          "effort": null,
          "graphGateDenials": null,
          "graphQueries": null,
          "held": null,
          "hibernatedAt": null,
          "home": "claude",
          "hookState": null,
          "id": "lane-a-crashed-a",
          "lastEnd": null,
          "lifecycle": "orphan",
          "limitWait": null,
          "limits": null,
          "model": null,
          "name": null,
          "openRun": null,
          "paneCols": null,
          "pr": null,
          "presence": "dead",
          "project": "lane-a-crashed-a",
          "releasedFrom": null,
          "role": "coordinator",
          "route": null,
          "run": null,
          "spawnState": null,
          "started": true,
          "status": "dead",
          "statusUnmeasured": false,
          "statusUpdatedAt": null,
          "stoppedBy": null,
          "stranded": null,
          "subagents": null,
          "substrate": null,
          "swapBlocked": null,
          "tasks": null,
          "title": null,
          "ultracode": false,
          "unmeasured": [],
          "usage": null,
          "version": null,
          "withCoordinator": null,
          "workdir": "/data/projects/lane-a-crashed-a",
          "workspace": null,
          "wrapper": "claude",
        },
        {
          "archivedAt": null,
          "archivedBytes": null,
          "ask": null,
          "askSummary": null,
          "background": null,
          "boardProject": "lane-a-project-a",
          "branch": null,
          "browserMcp": null,
          "bucket": "working",
          "bucketSince": null,
          "child": {
            "kind": "none",
          },
          "ctxPct": null,
          "deadSince": null,
          "dialogPending": false,
          "effort": null,
          "graphGateDenials": null,
          "graphQueries": null,
          "held": null,
          "hibernatedAt": null,
          "home": "claude",
          "hookState": "working",
          "id": "lane-a-project-a",
          "lastEnd": null,
          "lifecycle": "unsupervised",
          "limitWait": null,
          "limits": null,
          "model": null,
          "name": null,
          "openRun": null,
          "paneCols": null,
          "pr": null,
          "presence": "alive",
          "project": "lane-a-project-a",
          "releasedFrom": null,
          "role": "coordinator",
          "route": null,
          "run": null,
          "spawnState": null,
          "started": true,
          "status": "idle",
          "statusUnmeasured": false,
          "statusUpdatedAt": null,
          "stoppedBy": null,
          "stranded": null,
          "subagents": [],
          "substrate": null,
          "swapBlocked": null,
          "tasks": null,
          "title": null,
          "ultracode": false,
          "unmeasured": [],
          "usage": null,
          "version": null,
          "withCoordinator": null,
          "workdir": "/data/projects/lane-a-project-a",
          "workspace": null,
          "wrapper": "claude",
        },
        {
          "archivedAt": null,
          "archivedBytes": null,
          "ask": null,
          "askSummary": null,
          "background": null,
          "boardProject": "lane-a-project-b",
          "branch": "ws/demo",
          "browserMcp": null,
          "bucket": "idle",
          "bucketSince": null,
          "child": {
            "kind": "none",
          },
          "ctxPct": null,
          "deadSince": null,
          "dialogPending": false,
          "effort": "xhigh",
          "graphGateDenials": null,
          "graphQueries": null,
          "held": null,
          "hibernatedAt": null,
          "home": "claude",
          "hookState": null,
          "id": "lane-a-project-b",
          "lastEnd": null,
          "lifecycle": "unsupervised",
          "limitWait": null,
          "limits": null,
          "model": "Opus 5.5",
          "name": null,
          "openRun": null,
          "paneCols": 40,
          "pr": null,
          "presence": "alive",
          "project": "lane-a-project-b",
          "releasedFrom": null,
          "role": "coordinator",
          "route": null,
          "run": null,
          "spawnState": null,
          "started": true,
          "status": "idle",
          "statusUnmeasured": false,
          "statusUpdatedAt": null,
          "stoppedBy": null,
          "stranded": null,
          "subagents": null,
          "substrate": null,
          "swapBlocked": null,
          "tasks": null,
          "title": null,
          "ultracode": false,
          "unmeasured": [],
          "usage": null,
          "version": null,
          "withCoordinator": null,
          "workdir": "/data/projects/lane-a-project-b",
          "workspace": null,
          "wrapper": "claude",
        },
        {
          "archivedAt": null,
          "archivedBytes": null,
          "ask": null,
          "askSummary": null,
          "background": null,
          "boardProject": "lane-a-stopped-a",
          "branch": null,
          "browserMcp": null,
          "bucket": "dead",
          "bucketSince": null,
          "child": {
            "kind": "child",
            "runId": 100,
          },
          "ctxPct": null,
          "deadSince": 1700000000000,
          "dialogPending": false,
          "effort": null,
          "graphGateDenials": null,
          "graphQueries": null,
          "held": null,
          "hibernatedAt": null,
          "home": "claude",
          "hookState": null,
          "id": "lane-a-stopped-a",
          "lastEnd": null,
          "lifecycle": "stopped",
          "limitWait": null,
          "limits": null,
          "model": null,
          "name": null,
          "openRun": null,
          "paneCols": null,
          "pr": null,
          "presence": "dead",
          "project": "lane-a-stopped-a",
          "releasedFrom": null,
          "role": "child",
          "route": null,
          "run": null,
          "spawnState": null,
          "started": true,
          "status": "dead",
          "statusUnmeasured": false,
          "statusUpdatedAt": null,
          "stoppedBy": {
            "at": 1700000000000,
            "surface": "cli",
          },
          "stranded": null,
          "subagents": null,
          "substrate": null,
          "swapBlocked": null,
          "tasks": null,
          "title": null,
          "ultracode": false,
          "unmeasured": [],
          "usage": null,
          "version": null,
          "withCoordinator": null,
          "workdir": "/data/projects/lane-a-stopped-a",
          "workspace": null,
          "wrapper": "claude",
        },
        {
          "archivedAt": null,
          "archivedBytes": null,
          "ask": null,
          "askSummary": null,
          "background": null,
          "boardProject": "lane-a-stopped-b",
          "branch": null,
          "browserMcp": null,
          "bucket": "dead",
          "bucketSince": null,
          "child": {
            "kind": "child",
            "runId": 101,
          },
          "ctxPct": null,
          "deadSince": 1700000001000,
          "dialogPending": false,
          "effort": null,
          "graphGateDenials": null,
          "graphQueries": null,
          "held": null,
          "hibernatedAt": null,
          "home": "claude",
          "hookState": null,
          "id": "lane-a-stopped-b",
          "lastEnd": null,
          "lifecycle": "stopped",
          "limitWait": null,
          "limits": null,
          "model": null,
          "name": null,
          "openRun": null,
          "paneCols": null,
          "pr": null,
          "presence": "dead",
          "project": "lane-a-stopped-b",
          "releasedFrom": null,
          "role": "child",
          "route": null,
          "run": null,
          "spawnState": null,
          "started": true,
          "status": "dead",
          "statusUnmeasured": false,
          "statusUpdatedAt": null,
          "stoppedBy": {
            "at": 1700000001000,
            "surface": "cli",
          },
          "stranded": null,
          "subagents": null,
          "substrate": null,
          "swapBlocked": null,
          "tasks": null,
          "title": null,
          "ultracode": false,
          "unmeasured": [],
          "usage": {
            "cacheExpiresAt": null,
            "class": "opus",
            "cost": 1.25,
            "ctxPct": 12,
            "effort": "high",
            "model": "claude-opus-5",
            "stale": true,
            "ts": 1700000000,
          },
          "version": null,
          "withCoordinator": null,
          "workdir": "/data/projects/lane-a-stopped-b",
          "workspace": null,
          "wrapper": "claude",
        },
      ]
    `);

    expect([...watcher.currentPending()]).toEqual([]);
    expect([...watcher.currentStatuslines()]).toEqual([[LIVE[1], {
      model: 'Opus 5.5', effort: 'xhigh', ultracode: false, branch: 'ws/demo', workflowActive: false, boxCols: 40,
    }]]);
    expect([...watcher.currentHookStates()]).toEqual([[LIVE[0], {
      state: 'working', updatedAt: hookUpdatedAt, event: 'PreToolUse', ask: null, subagents: [],
      graphQueries: null, graphGateDenials: null, interrupted: false,
    }]]);

    // The state cache: written by tick 1 (remote mode, connected, no unmeasured row); its sessions are the frame.
    const cache = JSON.parse(readFileSync(cachePath, 'utf8')) as { sessions: unknown; savedAt: unknown };
    expect(Object.keys(cache).sort()).toEqual(['savedAt', 'sessions']);
    expect(typeof cache.savedAt).toBe('number');   // wall-clock: excluded from the comparison
    expect(cache.sessions).toEqual(JSON.parse(JSON.stringify(sessions)));
  });

  // The first case runs the per-row FALLBACK (its runner fails `list-panes -a`). This one runs the SAME fixture with
  // the runner answering the one listing, and holds the same pins: the literal statusline and hook-state map, the
  // state cache, and a frame equal to the fallback run's (which the inline snapshot above pins).
  it('the same fixture through the one tmux listing holds the same pins', async () => {
    const rule = '─'.repeat(40);
    const paneOf = (id: string): string => id === LIVE[1]
      ? ['done', rule, '❯\u00a0', rule, '  👤 acct-a │ 🤖 Opus 5.5 · xhigh │ ⎇ ws/demo'].join('\n') : 'done\n❯ \n';
    const run = async (listing: 'ok' | 'fail') => {
      const h = makeHarness({ listing, paneOf });
      const hookUpdatedAt = Date.now();
      writeFileSync(path.join(h.reg, `${LIVE[0]}.hookstate.json`), JSON.stringify({
        v: 1, state: 'working', event: 'PreToolUse', sessionId: `uuid-${LIVE[0]}`, pid: 4000,
        updatedAt: hookUpdatedAt, ask: null, subagents: [],
      }));
      mkdirSync(path.dirname(usageSidecarPath(h.reg, STOPPED[1]!)), { recursive: true });
      writeFileSync(usageSidecarPath(h.reg, STOPPED[1]!), JSON.stringify({ ts: STAMP, model: 'claude-opus-5', effort: 'high', ctxPct: 12, cost: 1.25 }));
      await h.watcher.tick();
      await h.watcher.tick();
      return { h, hookUpdatedAt };
    };
    const base = await run('fail');
    const { h, hookUpdatedAt } = await run('ok');
    expect(h.calls.listPanesAll).toBe(2);
    expect(h.frames).toHaveLength(1);
    expect(h.frames[0]!.map((x) => x.id)).toEqual([ARCHIVED, CRASHED, ...LIVE, ...STOPPED]);
    expect(h.frames[0]).toEqual(base.h.frames[0]);
    expect([...h.watcher.currentPending()]).toEqual([]);
    expect([...h.watcher.currentStatuslines()]).toEqual([[LIVE[1], {
      model: 'Opus 5.5', effort: 'xhigh', ultracode: false, branch: 'ws/demo', workflowActive: false, boxCols: 40,
    }]]);
    expect([...h.watcher.currentHookStates()]).toEqual([[LIVE[0], {
      state: 'working', updatedAt: hookUpdatedAt, event: 'PreToolUse', ask: null, subagents: [],
      graphQueries: null, graphGateDenials: null, interrupted: false,
    }]]);
    const cache = JSON.parse(readFileSync(h.cachePath, 'utf8')) as { sessions: unknown; savedAt: unknown };
    expect(Object.keys(cache).sort()).toEqual(['savedAt', 'sessions']);
    expect(cache.sessions).toEqual(JSON.parse(JSON.stringify(h.frames[0])));
  });
});
