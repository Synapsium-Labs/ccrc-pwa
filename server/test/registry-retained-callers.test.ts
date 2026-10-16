// Path identity W1a, Task 8 (spec §2.3): the eight callers that keep the
// `readRegistry` wrapper, each pinned on a PLANTED refused row. A refused row is
// a `.uuid` whose basename is not a registry id. `readRegistryMeasured` names it
// in `refused` and never builds it, so `readRegistry` never returns it. Each
// caller keeps the wrapper for its own reason, and each reason is pinned here:
//   - knownId: `/commands` and `/pr` sit behind `knownId`, which refuses a
//     non-registry id before its listing;
//   - omits: `sweepNames`, `sweepPr` and the dialog detector act only on
//     `records`, so a refused row is never renamed, swept or captured;
//   - raw-name: attribution, mail creation and mail acknowledgement keep a raw
//     listing, so a listed-but-omitted row reads as registry-unmeasurable,
//     never as an unknown sender or recipient.
// These cases are green at once, because Tasks 2 and 5 built the behaviour.
// Their proof is the plan's mutation table, each row measured red against this file.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { tmuxTarget } from '../../shared/tmux-target.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { appFor, recorder, seedRow } from './idGateFixture.js';

const TOKEN = 'f'.repeat(64);
const BAD = '--actor';
const VALID = 'demo-quiet-basin';

/** Every field written exactly as given, under the fixture HOME's registry. A
 *  dash-led name is a plain file there (`path.join(reg, '--actor.uuid')`). */
const plantRow = (home: string, id: string, fields: Record<string, string>): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** The row the case is about IS listed, so the refusal under test is the
 *  reader's, never a missing file's. */
const expectPlanted = (home: string, id: string): void => {
  expect(readdirSync(path.join(home, '.cc-sessions'))).toContain(`${id}.uuid`);
};

/** The planted row's own uuid, read back rather than assumed from the fixture. */
const uuidOf = (home: string, id: string): string =>
  readFileSync(path.join(home, '.cc-sessions', `${id}.uuid`), 'utf8').trim();

/** A snapshot path inside the fixture HOME, so no watcher here can name a real one. */
const cachePathIn = (home: string): string => path.join(home, '.ccrc', 'state-cache.json');

/** A workspace row in `pr-sweep.test.ts`'s shape, in a project of the case's choosing. */
const workspaceRow = (id: string, project: string, workspace: string): Record<string, string> => ({
  uuid: `u-${id}`, wrapper: 'claude', workdir: `/w/${id}`, project, workspace,
  branch: `ws/${id}`, base: 'origin/main', started: '1',
});

/** `pr-sweep.test.ts`'s merged line, for the valid row in project demo. */
const mergedLine = (id: string, number = 42): string => JSON.stringify({
  id, project: 'demo', repo: 'o/r', branch: 'ws/' + id, base: 'origin/main', baseShort: 'main',
  tip: 'f'.repeat(40), ahead: 3, dirty: 0, commits: [], template: null,
  rows: [{ number, state: 'MERGED', headRefName: 'ws/' + id, headRefOid: 'deadbee',
    baseRefName: 'main', isCrossRepository: false, mergedAt: '2026-07-20T10:00:00Z',
    mergeCommit: { oid: '7a68ca0' }, url: 'u', title: 't', isDraft: false,
    statusCheckRollup: null, ours: true }],
  phase: 'merged', number, checkedAt: 1785300000000, reason: null,
});

/** `pr-sweep.test.ts`'s idle live-state file, so a tick reads the pane as idle. */
const liveIdle = (home: string, pid = '4242'): void => {
  const dir = path.join(home, '.claude', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${pid}.json`),
    JSON.stringify({ pid: Number(pid), sessionId: '1'.repeat(36), cwd: '/d', status: 'idle', statusUpdatedAt: 1 }));
};

const post = (a: FastifyInstance, url: string, payload: Record<string, unknown>) =>
  a.inject({ method: 'POST', url, headers: { 'x-ccrc-mail-token': TOKEN }, payload });

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  vi.restoreAllMocks();
});

describe('the knownId callers never read a refused id (spec §2.3)', () => {
  it('GET /api/sessions/--actor/commands and GET /pr answer 404 unknown-session', async () => {
    const home = mkTmp('ccrc-retained-');
    seedRow(home, BAD);
    seedRow(home, VALID);
    expectPlanted(home, BAD);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rec = recorder();
    const w = await appFor(home, rec.run);
    app = w.app;

    const commands = await app.inject({ method: 'GET', url: `/api/sessions/${BAD}/commands` });
    expect(commands.statusCode).toBe(404);
    expect(commands.json()).toEqual({ ok: false, error: 'unknown-session' });
    const pr = await app.inject({ method: 'GET', url: `/api/sessions/${BAD}/pr` });
    expect(pr.statusCode).toBe(404);
    expect(pr.json()).toEqual({ ok: false, error: 'unknown-session' });
    expect(rec.calls.filter((a) => a.includes(BAD))).toEqual([]);

    // Control: the same route answers a valid planted row, so the 404 above is the id gate's.
    const ok = await app.inject({ method: 'GET', url: `/api/sessions/${VALID}/commands` });
    expect(ok.statusCode).toBe(200);
  });
});

describe('the watch sweeps omit a refused row (spec §2.3)', () => {
  // `name-sweep.test.ts`'s fixture: a workspace still on its born branch, and the
  // transcript whose ai-title names it. The refused row carries the SAME fields,
  // so a build that let it into `records` would find the same title and rename it too.
  const NAME_ID = 'demo-quiet-mesa';
  const NAME_UUID = 'a'.repeat(36);
  const NAME_WORKDIR = '/w/demo/quiet-mesa';
  const NAME_MUNGED = '-w-demo-quiet-mesa';   // mungePath turns / . _ into -, as name-sweep.test.ts states

  it('sweepNames composes no ws-rename naming --actor', async () => {
    const home = mkTmp('ccrc-retained-');
    const fields = {
      wrapper: 'claude', project: 'demo', workdir: NAME_WORKDIR, uuid: NAME_UUID,
      started: '1', workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
    };
    plantRow(home, NAME_ID, fields);
    plantRow(home, BAD, fields);
    expectPlanted(home, BAD);
    const dir = path.join(home, '.claude', 'projects', NAME_MUNGED);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${NAME_UUID}.jsonl`),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Brainstorm Helix and slide notes integration' }) + '\n');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const renames: string[][] = [];
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'ws-rename') {
        renames.push([...args]);
        return { code: 0, stdout: JSON.stringify({ renamed: args[2], old: 'ws/quiet-mesa', new: args[4] }), stderr: '' };
      }
      return { code: 1, stdout: '', stderr: '' };
    };
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 2000, cachePathIn(home));

    await w.sweepNames();
    expect(renames.filter((a) => a.includes(BAD))).toEqual([]);
    // Control: the sweep ran and renamed the valid row, so the absence above is the omission's.
    expect(renames.map((a) => a[2])).toEqual([NAME_ID]);
  });

  it('sweepPr keeps no pr state for --actor and composes no pr-state naming it', async () => {
    // `sweepPr` composes `pr-state --project <p>`, never an id, so the refused row
    // gets a project of its own (`solo`). Ids are listed in sorted order, and
    // `--actor` sorts first, so a build that swept it would ask `solo` (and fail,
    // backing `--actor` off into `prStates`) BEFORE the valid row's project answers.
    const home = mkTmp('ccrc-retained-');
    plantRow(home, VALID, workspaceRow(VALID, 'demo', 'quiet-basin'));
    plantRow(home, BAD, workspaceRow(BAD, 'solo', 'actor-ws'));
    expectPlanted(home, BAD);
    liveIdle(home);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prCalls: string[][] = [];
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'pr-state') {
        prCalls.push([...args]);
        return args[2] === 'demo'
          ? { code: 0, stdout: mergedLine(VALID), stderr: '' }
          : { code: 1, stdout: '', stderr: 'gh unreachable' };
      }
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
      if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 10_000, cachePathIn(home));
    try {
      await w.tick();
      await vi.waitFor(() => expect(w.currentPrStates().get(VALID)?.phase).toBe('merged'), { timeout: 3000 });
      expect(prCalls.filter((a) => a.includes('solo') || a.includes(BAD))).toEqual([]);
      expect(w.currentPrStates().has(BAD)).toBe(false);
      expect(prCalls).toContainEqual(['pr-state', '--project', 'demo']);
    } finally {
      w.stop();
    }
  });

  it("one tick never captures --actor's pane", async () => {
    // The dialog detector reads `tick`'s own `records` (the census pins the
    // hand-off), so this is the production path, not `detectDialogs`' fallback.
    const home = mkTmp('ccrc-retained-');
    plantRow(home, VALID, workspaceRow(VALID, 'demo', 'quiet-basin'));
    plantRow(home, BAD, workspaceRow(BAD, 'demo', 'actor-ws'));
    expectPlanted(home, BAD);
    liveIdle(home);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const captures: string[][] = [];
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'capture-pane') { captures.push([...args]); return { code: 0, stdout: '', stderr: '' }; }
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 10_000, cachePathIn(home));
    try {
      await w.tick();
      const targets = captures.map((a) => a[a.indexOf('-t') + 1]);
      expect(targets).not.toContain(tmuxTarget(BAD));
      // Control: the detector ran over the valid row.
      expect(targets).toContain(tmuxTarget(VALID));
    } finally {
      w.stop();
    }
  });
});

describe('the raw-name ladders read a refused row as unmeasurable, never as absent (spec §2.3)', () => {
  it('POST /api/claims by --actor answers 502 registry-unmeasurable', async () => {
    const home = mkTmp('ccrc-retained-');
    seedRow(home, BAD);
    expectPlanted(home, BAD);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rec = recorder();
    const w = await appFor(home, rec.run, { mailToken: TOKEN });
    app = w.app;

    const res = await post(app, '/api/claims', {
      byId: BAD, byUuid: uuidOf(home, BAD), project: 'demo',
      intent: 'pin a refused claimant', paths: ['server/src/watch.ts'],
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    expect(rec.calls).toEqual([]);
  });

  it('POST /api/mail from --actor answers 502 and records a registry-unmeasurable rejection', async () => {
    const home = mkTmp('ccrc-retained-');
    seedRow(home, BAD);
    expectPlanted(home, BAD);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = await appFor(home, recorder().run, { mailToken: TOKEN });
    app = w.app;

    const res = await post(app, '/api/mail', {
      fromId: BAD, fromUuid: uuidOf(home, BAD), toId: 'coordinator',
      kind: 'finding', subject: 'a finding', body: 'the body', artifacts: [],
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    expect(w.coord.rejections().map((r) => r.code)).toEqual(['registry-unmeasurable']);
  });

  it('POST /api/mail to --actor answers 502', async () => {
    const home = mkTmp('ccrc-retained-');
    seedRow(home, BAD);
    seedRow(home, VALID);
    expectPlanted(home, BAD);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = await appFor(home, recorder().run, { mailToken: TOKEN });
    app = w.app;

    const res = await post(app, '/api/mail', {
      fromId: VALID, fromUuid: uuidOf(home, VALID), toId: BAD,
      kind: 'finding', subject: 'a finding', body: 'the body', artifacts: [],
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    expect(w.coord.rejections().map((r) => r.code)).toEqual(['registry-unmeasurable']);
    expect(w.coord.dueDeliveries(Date.now(), 60_000)).toEqual([]);
  });

  it('POST /api/mail/:id/ack by --actor answers 502', async () => {
    const home = mkTmp('ccrc-retained-');
    seedRow(home, BAD);
    expectPlanted(home, BAD);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = await appFor(home, recorder().run, { mailToken: TOKEN });
    app = w.app;

    const res = await post(app, '/api/mail/1/ack', { fromId: BAD, fromUuid: uuidOf(home, BAD) });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    expect(w.coord.rejections().map((r) => r.code)).toEqual(['registry-unmeasurable']);
  });
});
