import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig, type CcrcConfig } from '../src/config.js';
import { Tmux, UNMEASURED, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccd, ccdRunner, cutShort, listProjects, type CcdResult } from '../src/lifecycle.js';
import { CCD_ARGV } from '../src/ccdargv.js';
import { readLocalCcdCaps } from '../src/localcaps.js';
import { KeyedQueue } from '../src/inject/queue.js';
import type { BuildInfo } from '../../shared/buildinfo.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const ID = 'claude2-MekWarLive';

const seedSession = (home: string, id: string, fields: Record<string, string>) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const seedDefault = (home: string) =>
  seedSession(home, ID, {
    wrapper: 'claude2',
    project: 'MekWarLive',
    workdir: '/data/projects/MekWarLive',
    uuid: '1'.repeat(36),
    started: '1',
  });

/** Server over a seeded one-session registry; every exec succeeds (or fails with stderr 'boom').
 *  `ccdVerbs`, when given, seeds a real `fleetState` (mirroring
 *  `coord-pause-route.test.ts`'s own pattern) — the shape a skew test needs
 *  to prove the server's DECISION, not just its argv. */
async function makeApp(
  opts: { fail?: boolean; projectsRoot?: string; ccdVerbs?: string[] | null } = {},
): Promise<{
  app: FastifyInstance;
  calls: string[][];
  cfg: CcrcConfig;
  home: string;
}> {
  const home = mkTmp('ccrc-');
  seedRoster(home);
  seedDefault(home);
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return opts.fail ? { code: 1, stdout: '', stderr: 'boom' } : { code: 0, stdout: '', stderr: '' };
  };
  const env: NodeJS.ProcessEnv = { CCRC_HOME: home };
  if (opts.projectsRoot) env.CCRC_PROJECTS_ROOT = opts.projectsRoot;
  const cfg = loadConfig(env);
  const app = await buildServer({
    cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(),
    ...(opts.ccdVerbs !== undefined
      ? { fleetState: { connected: true, downSince: null, ccdVerbs: opts.ccdVerbs, rosterFp: null, build: null } }
      : {}),
  });
  return { app, calls, cfg, home };
}

describe('lifecycle routes', () => {
  it('POST /api/sessions defaults to ccd enable', async () => {
    const { app, calls, cfg } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { wrapper: 'claude', project: 'foo' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls).toEqual([[cfg.ccdBin, 'enable', 'claude', 'foo']]);
    await app.close();
  });

  it('POST /api/sessions with enable:false and workdir uses ccd start with the workdir arg', async () => {
    const { app, calls, cfg } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { wrapper: 'claude', project: 'foo', workdir: '/data/projects/foo', enable: false },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'start', 'claude', 'foo', '/data/projects/foo']]);
    await app.close();
  });

  it('POST /api/sessions/:id/ensure passes the id through', async () => {
    const { app, calls, cfg } = await makeApp();
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/ensure`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls).toEqual([[cfg.ccdBin, 'ensure', ID]]);
    await app.close();
  });

  it('POST /api/sessions/:id/stop derives wrapper+project from the registry', async () => {
    // ccdVerbs explicit here (fix round 3): this test is about the
    // wrapper/project derivation, not the capability gate, so it states a
    // capability-granted fleet outright rather than relying on the
    // no-evidence default's polarity, which is what the dedicated
    // asymmetric-default test below exists to pin.
    const { app, calls, cfg } = await makeApp({ ccdVerbs: ['start', 'enable', 'ensure', 'stop', 'swap', 'stop-surface'] });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'MekWarLive', '--surface', 'pwa']]);
    await app.close();
  });

  // Fix round 2 (task 14 follow-up, Important #1): the SKEW CASE the plan
  // owner named directly. Round 1 sent `--surface pwa` unconditionally,
  // measured against `origin/main`'s real pre-flag ccd (which this repo
  // still deploys until BOTH `deploy/deploy.sh` targets have run, since only
  // the agent target installs ccd and neither cross-checks the other's
  // version): `ccd stop <id> --surface pwa` parses on that ccd as a
  // TWO-ARGUMENT stop of a session literally named `<id>---surface`, exit 0,
  // real session untouched. Reproduced directly (not just reasoned about,
  // per DISPATCH-CONTEXT's own rule) against `origin/main:ccd/ccd` under a
  // scratch HOME:
  //   cmd_stop demo-quiet-mesa --surface pwa
  //   -> systemctl --user disable --now claude-session@demo-quiet-mesa---surface
  //   -> tmux kill-session -t cc-demo-quiet-mesa---surface
  //   -> stopped demo-quiet-mesa---surface   rc=0
  // and the SAME old binary given the fallback bare argv instead:
  //   cmd_stop demo-quiet-mesa
  //   -> systemctl --user disable --now claude-session@demo-quiet-mesa
  //   -> tmux kill-session -t cc-demo-quiet-mesa
  //   -> stopped demo-quiet-mesa   rc=0
  // — the REAL session, correctly. `ccdVerbs` without `stop-surface` is
  // exactly the shape the agent reports for that old ccd (it lists `stop`
  // but never prints the new capability token), so this test drives the
  // SAME decision the route makes in that real deployment window.
  it('a fleet ccd that does not advertise stop-surface gets the bare argv old ccd understands (the skew case)', async () => {
    const { app, calls, cfg } = await makeApp({ ccdVerbs: ['start', 'enable', 'ensure', 'stop', 'swap'] });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop`, payload: {} });
    // The genuinely load-bearing assertion: this must be 200 because the
    // bare argv sent is one old ccd ACTUALLY EXECUTES, not a 200 papering
    // over a no-op — the whole point is that the fallback is a real stop,
    // not a degraded failure.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'MekWarLive']]);
    await app.close();
  });

  it('a fleet ccd that DOES advertise stop-surface still gets --surface pwa (the capability check is not a permanent regression)', async () => {
    const { app, calls, cfg } = await makeApp({
      ccdVerbs: ['start', 'enable', 'ensure', 'stop', 'swap', 'stop-surface'],
    });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'MekWarLive', '--surface', 'pwa']]);
    await app.close();
  });

  // Fix round 3 (task 14 follow-up, Important #2): REVERSED from round 2's
  // version of this test. The plan owner's ruling: for every OTHER gated
  // verb, guessing wrong on no evidence costs a LOUD failure (ccd's own
  // usage refusal, a 502) — permitting is the safe default there. For
  // `--surface`, guessing wrong costs a SILENT SUCCESS (old ccd parses
  // `--surface pwa` as a second positional and "stops" a session named
  // `<id>---surface`, exit 0, the real session untouched). Asymmetric
  // costs demand an asymmetric default: `stopSurfaceSupported` answers
  // `false` on no evidence, `verbSupported`'s own null-permits policy is
  // UNCHANGED for everything else (this test's neighbours below still
  // exercise ordinary verb gates the old way).
  it('no evidence at all (ccdVerbs: null) sends the bare argv, never --surface — asymmetric cost, asymmetric default', async () => {
    const { app, calls, cfg } = await makeApp({ ccdVerbs: null });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop`, payload: {} });
    // Still 200 — the bare argv is one every ccd generation understands, so
    // the stop still genuinely happens. Only the DECLARATION is withheld.
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'MekWarLive']]);
    await app.close();
  });

  it('POST /api/sessions/:id/stop uses the id-prefix wrapper, not a swapped registry wrapper', async () => {
    // After `ccd swap`, the registry `wrapper` field flips to the new account but
    // the session id and tmux name keep the ORIGINAL wrapper prefix
    // (claude2-cctest). Stop must target the id's prefix wrapper so ccd recomputes
    // the correct id — using the swapped wrapper would kill a nonexistent session
    // and leave the real one alive.
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude2-cctest', {
      wrapper: 'claude',            // swapped to claude…
      project: 'cctest',
      workdir: '/data/projects/cctest',
      uuid: '2'.repeat(36),
      started: '1',
      lastswap: '1784650000',
    });
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' }; };
    const cfg = loadConfig({ CCRC_HOME: home });
    // ccdVerbs explicit (fix round 3): this test is about wrapper-prefix
    // resolution, not the capability gate.
    const app = await buildServer({
      cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(),
      fleetState: { connected: true, downSince: null, ccdVerbs: ['stop', 'stop-surface'], rosterFp: null, build: null },
    });
    const res = await app.inject({ method: 'POST', url: '/api/sessions/claude2-cctest/stop', payload: {} });
    expect(res.statusCode).toBe(200);
    // …but stop must still target claude2-cctest, not claude-cctest.
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'cctest', '--surface', 'pwa']]);
    await app.close();
  });

  it('POST /api/sessions/:id/stop passes a WORKSPACE id whole, never a reversed one', async () => {
    // A workspace id is `<project>-<slug>`, not `<wrapper>-<project>`. Reversing
    // it cannot work: `rp-llm-quiet-mesa` does not end in `-rp-llm`, so the
    // prefix rule falls through to rec.wrapper and ccd recomputes
    // `claude-rp-llm` — a DIFFERENT, live session. It would then kill tmux
    // cc-claude-rp-llm and disable claude-session@claude-rp-llm, exit 0, and
    // the PWA would report success while the workspace kept running.
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'rp-llm-quiet-mesa', {
      wrapper: 'claude',
      project: 'rp-llm',
      workspace: 'quiet-mesa',
      workdir: '/home/rc/worktrees/rp-llm/quiet-mesa',
      uuid: '3'.repeat(36),
      started: '1',
    });
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' }; };
    const cfg = loadConfig({ CCRC_HOME: home });
    // ccdVerbs explicit (fix round 3): this test is about workspace-id
    // handling, not the capability gate.
    const app = await buildServer({
      cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(),
      fleetState: { connected: true, downSince: null, ccdVerbs: ['stop', 'stop-surface'], rosterFp: null, build: null },
    });
    const res = await app.inject({ method: 'POST', url: '/api/sessions/rp-llm-quiet-mesa/stop', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'rp-llm-quiet-mesa', '--surface', 'pwa']]);
    await app.close();
  });

  it('POST /api/sessions/:id/stop on an unknown id returns 404 without calling ccd', async () => {
    const { app, calls } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/sessions/nope/stop', payload: {} });
    expect(res.statusCode).toBe(404);
    expect(calls).toEqual([]);
    await app.close();
  });

  it('POST /api/sessions/:id/swap sends exact argv', async () => {
    const { app, calls, cfg } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${ID}/swap`,
      payload: { wrapper: 'claude' },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'swap', ID, 'claude']]);
    await app.close();
  });

  it('a failing ccd maps to 502 with stderr', async () => {
    const { app } = await makeApp({ fail: true });
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${ID}/swap`,
      payload: { wrapper: 'claude' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr: 'boom' });
    await app.close();
  });
});

// Fix round 3 (task 14 follow-up, Important #1-#3): the LOCAL-MODE skew
// case, requested end to end by the plan owner — NEW server composition,
// OLD-shaped ccd, `CCRC_FLEET` left UNSET (the documented default,
// `deploy/ccrc.env.example:19`). Before this round, local mode built no
// `fleetState` at all, so `stopSurfaceSupported(undefined)` answered off
// `verbSupported`'s null-permits policy — the SAME hazard fix round 2
// closed for remote mode, unclosed here because local mode had no evidence
// to gate on. This describe block drives the REAL local-caps probe
// (`readLocalCcdCaps`, a genuine bounded `execFile` against a real
// executable file on disk — the exact call `index.ts`'s local branch
// makes) through the exact same route the PWA hits, with `CCRC_HOME` set
// and `CCRC_FLEET` never mentioned, so `loadConfig`'s own default
// (`config.ts:154`) is what selects local mode, not a test-only shortcut.
//
// The mechanism this closes was independently verified for real against
// `origin/main`'s actual pre-flag ccd binary (task-14-report.md, fix round
// 2): `cmd_stop <id> --surface pwa` there parses as a two-argument stop of
// a session literally named `<id>---surface`, exit 0, the real session
// left running with its unit enabled. That is what a `--surface` in the
// argv below would have risked; the assertion is that it is never there.
describe('local mode: the stop route with REAL local-caps evidence (fix round 3, task 14)', () => {
  const writeStubCcd = (dir: string, name: string, body: string): string => {
    mkdirSync(dir, { recursive: true });
    const p = path.join(dir, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
    return p;
  };

  it('an old-shaped local ccd (no stop-surface) omits --surface, and the stop still succeeds honestly', async () => {
    const home = mkTmp('ccrc-local-skew-');
    seedRoster(home);
    seedDefault(home);
    const ccdBin = writeStubCcd(
      path.join(home, 'ccdbin'), 'ccd-old',
      'echo start\necho enable\necho ensure\necho stop\necho swap\nexit 0',
    );
    // The REAL probe, against the REAL file — sanity-checked before it
    // ever reaches the route, so a failure here points at the probe, not
    // the route's use of its result.
    const ccdVerbs = await readLocalCcdCaps(ccdBin);
    expect(ccdVerbs).toEqual(['start', 'enable', 'ensure', 'stop', 'swap']);

    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' }; };
    const cfg = loadConfig({ CCRC_HOME: home }); // CCRC_FLEET genuinely unset
    expect(cfg.fleetMode).toBe('local');
    // The rest of this composition mirrors index.ts's local branch: real
    // evidence carried in `fleetState`, exactly as the fix requires.
    const app = await buildServer({
      cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(),
      fleetState: { connected: true, downSince: null, ccdVerbs, rosterFp: null, build: null },
    });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop`, payload: {} });
    // The load-bearing assertion: 200 BECAUSE the argv sent is the bare
    // shape every ccd generation understands, not a 200 papering over an
    // argv an old ccd would have silently misparsed.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'MekWarLive']]);
    await app.close();
  });

  it('a new-shaped local ccd (advertises stop-surface) sends --surface pwa', async () => {
    const home = mkTmp('ccrc-local-skew-');
    seedRoster(home);
    seedDefault(home);
    const ccdBin = writeStubCcd(
      path.join(home, 'ccdbin'), 'ccd-new',
      'echo start\necho enable\necho ensure\necho stop\necho swap\necho stop-surface\nexit 0',
    );
    const ccdVerbs = await readLocalCcdCaps(ccdBin);
    expect(ccdVerbs).toContain('stop-surface');

    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' }; };
    const cfg = loadConfig({ CCRC_HOME: home });
    expect(cfg.fleetMode).toBe('local');
    const app = await buildServer({
      cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(),
      fleetState: { connected: true, downSince: null, ccdVerbs, rosterFp: null, build: null },
    });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'MekWarLive', '--surface', 'pwa']]);
    await app.close();
  });

  it('a local ccd probe that fails (missing binary) also omits --surface — no evidence, not a lucky guess', async () => {
    const home = mkTmp('ccrc-local-skew-');
    seedRoster(home);
    seedDefault(home);
    const missingCcdBin = path.join(home, 'ccdbin', 'does-not-exist');
    const ccdVerbs = await readLocalCcdCaps(missingCcdBin);
    expect(ccdVerbs).toBeNull();

    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' }; };
    const cfg = loadConfig({ CCRC_HOME: home });
    const app = await buildServer({
      cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(),
      fleetState: { connected: true, downSince: null, ccdVerbs, rosterFp: null, build: null },
    });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'MekWarLive']]);
    await app.close();
  });

  // Fix round 4 (task 14 follow-up, Important #1): boot must not block on
  // the local-caps read at all — mirrors `index.ts`'s exact composition
  // (seed `ccdVerbs: null`, kick off the read WITHOUT awaiting, mutate the
  // same object in place once it resolves) rather than the earlier
  // `await`-before-`deps` shape. A request handled BEFORE the real exec
  // resolves must see "not yet known" as no evidence — the same safe
  // default a genuinely-absent probe gives — and a request handled AFTER
  // must see the real answer.
  it('boot does not block on the local-caps read; a request racing it sees no-evidence, a later one sees the real answer', async () => {
    const home = mkTmp('ccrc-local-skew-');
    seedRoster(home);
    seedDefault(home);
    // Deliberately slow enough that the FIRST request below is certain to
    // land before this resolves, without making the test itself slow.
    const ccdBin = writeStubCcd(
      path.join(home, 'ccdbin'), 'ccd-slow',
      'sleep 0.15\necho start\necho stop\necho stop-surface\nexit 0',
    );
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' }; };
    const cfg = loadConfig({ CCRC_HOME: home });

    // index.ts's exact shape: seed null, fire-and-forget the read, mutate
    // the SAME object in place once it resolves.
    const fleetState = { connected: true, downSince: null, ccdVerbs: null as string[] | null, rosterFp: null as string | null, build: null as BuildInfo | null };
    const capsPromise = readLocalCcdCaps(ccdBin).then((verbs) => {
      if (verbs !== null) fleetState.ccdVerbs = verbs;
    });

    const app = await buildServer({
      cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(),
      fleetState,
    });

    // Racing the still-in-flight read: no evidence yet, so no --surface.
    const early = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop`, payload: {} });
    expect(early.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'MekWarLive']]);

    await capsPromise; // now it has genuinely resolved
    expect(fleetState.ccdVerbs).toContain('stop-surface');

    calls.length = 0;
    const late = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop`, payload: {} });
    expect(late.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'MekWarLive', '--surface', 'pwa']]);

    await app.close();
  });
});

describe('listProjects', () => {
  it('merges projects-root directories with registry workdirs, deduped by workdir', async () => {
    const root = mkTmp('ccrc-projects-');
    mkdirSync(path.join(root, 'alpha'));
    mkdirSync(path.join(root, 'mekwar'));
    mkdirSync(path.join(root, '.hidden'));               // dotfile — skipped
    writeFileSync(path.join(root, 'stray.txt'), 'x');    // plain file — skipped

    const { app, cfg, home } = await makeApp({ projectsRoot: root });
    // Duplicate of a projects-root dir (same workdir) + one workdir outside the root.
    seedSession(home, 'claude-mekwar', {
      wrapper: 'claude', project: 'mekwar', workdir: path.join(root, 'mekwar'),
      uuid: '2'.repeat(36), started: '1',
    });
    seedSession(home, 'claude-otherproj', {
      wrapper: 'claude', project: 'otherproj', workdir: '/data/projects/other-place',
      uuid: '3'.repeat(36), started: '1',
    });

    const direct = await listProjects(localIO, cfg);
    expect(direct.roots).toEqual([root]);
    expect(direct.projects).toEqual([
      { name: 'MekWarLive', workdir: '/data/projects/MekWarLive' },   // default seeded registry session
      { name: 'alpha', workdir: path.join(root, 'alpha') },
      { name: 'mekwar', workdir: path.join(root, 'mekwar') },         // present once despite registry duplicate
      { name: 'otherproj', workdir: '/data/projects/other-place' },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(direct);
    await app.close();
  });

  it('returns registry-only projects when the projects root is missing', async () => {
    const { app, cfg } = await makeApp({ projectsRoot: '/nope/does-not-exist' });
    const out = await listProjects(localIO, cfg);
    expect(out.roots).toEqual(['/nope/does-not-exist']);
    expect(out.projects).toEqual([{ name: 'MekWarLive', workdir: '/data/projects/MekWarLive' }]);
    await app.close();
  });

  it('a linked worktree cannot masquerade as a project — either door', async () => {
    const root = mkTmp('ccrc-projects-');
    // (a) a dir under the root whose `.git` is a FILE, not a directory — a
    // linked worktree (or submodule) pointer. Must be skipped.
    const linkedInRoot = path.join(root, 'linked');
    mkdirSync(linkedInRoot);
    writeFileSync(path.join(linkedInRoot, '.git'), 'gitdir: /elsewhere/.git/worktrees/linked\n');
    // (b) a plain dir with NO .git at all — a legitimate non-git project.
    // Must stay listed, not be swept up by the new probe.
    mkdirSync(path.join(root, 'plain'));

    // (c) a registry record whose workdir readdir-probes as a linked
    // worktree. Must be skipped by the union loop too.
    const linkedRegistryWorkdir = mkTmp('ccrc-linked-');
    writeFileSync(path.join(linkedRegistryWorkdir, '.git'), 'gitdir: /elsewhere/.git/worktrees/other\n');

    const { app, cfg, home } = await makeApp({ projectsRoot: root });
    // `makeApp` -> `seedDefault` seeds `ID` at the box's REAL
    // `/data/projects/MekWarLive`, which every other test can ignore because it
    // never readdirs that path. This test's whole point is that the union loop
    // NOW readdirs every registry workdir, so a real path outside the sandbox
    // would make the result depend on whatever this box's disk happens to hold
    // at that path rather than on the fixture — repointed at a plain fixture
    // directory (ordinary, `.git`-less, like case (b)) under the test's own
    // tmp root instead, via the same `seedSession` shape `seedDefault` uses,
    // so the expectation holds identically on every box and in CI.
    const defaultWorkdir = mkTmp('ccrc-mekwarlive-');
    seedSession(home, ID, { workdir: defaultWorkdir });
    seedSession(home, 'claude-linked', {
      wrapper: 'claude', project: 'linked-registry', workdir: linkedRegistryWorkdir,
      uuid: '4'.repeat(36), started: '1',
    });
    // (d) a registry record whose workdir does not exist at all. readdir-null
    // is fail-open — it stays listed, same as before this probe existed.
    seedSession(home, 'claude-gone', {
      wrapper: 'claude', project: 'gone', workdir: path.join(root, 'does-not-exist'),
      uuid: '5'.repeat(36), started: '1',
    });

    const out = await listProjects(localIO, cfg);
    expect(out.projects).toEqual([
      { name: 'MekWarLive', workdir: defaultWorkdir },                // default seeded registry session — fixture, not the box's real path
      { name: 'gone', workdir: path.join(root, 'does-not-exist') },  // missing workdir — stays listed
      { name: 'plain', workdir: path.join(root, 'plain') },
    ]);

    await app.close();
  });
});

// The composition-root factory task 13S introduced: it is the ONLY thing that
// turns a raw `Runner` into the single `Deps.runCcd` capability, so every route
// above reaches ccd through it. Covered directly because nothing else can see
// its three decisions apart — which binary it names, how it maps an exit code,
// and whether a failure still carries the output the 502 body quotes.
describe('ccdRunner — the one ccd capability Deps carries', () => {
  const spy = (result: { code: number; stdout: string; stderr: string }) => {
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => { calls.push([cmd, ...args]); return result; };
    return { run, calls };
  };
  const ccdRunnerHome = mkTmp('ccrc-');
  seedRoster(ccdRunnerHome);
  const cfg = loadConfig({ CCRC_HOME: ccdRunnerHome });

  it('names cfg.ccdBin and passes the argv tokens through verbatim', async () => {
    const { run, calls } = spy({ code: 0, stdout: '', stderr: '' });
    await ccdRunner(run, cfg)(CCD_ARGV.wsReap('a'.repeat(64), ID));
    expect(calls).toEqual([[cfg.ccdBin, 'ws-reap', '--expect', 'a'.repeat(64), '--session', ID]]);
  });

  it('ok is exit code 0 and nothing else', async () => {
    const zero = spy({ code: 0, stdout: '', stderr: '' });
    const one = spy({ code: 1, stdout: '', stderr: '' });
    const other = spy({ code: 127, stdout: '', stderr: '' });
    expect((await ccdRunner(zero.run, cfg)(CCD_ARGV.ensure(ID))).ok).toBe(true);
    expect((await ccdRunner(one.run, cfg)(CCD_ARGV.ensure(ID))).ok).toBe(false);
    expect((await ccdRunner(other.run, cfg)(CCD_ARGV.ensure(ID))).ok).toBe(false);
  });

  it('passes stdout and stderr through untouched on success', async () => {
    const { run } = spy({ code: 0, stdout: 'out\n', stderr: 'warn\n' });
    expect(await ccdRunner(run, cfg)(CCD_ARGV.wsAudit(ID)))
      // The kill fields are not decoration: both are REQUIRED on `CcdResult`
      // (§1.4/§1.7), and this runner reported NEITHER — so both read as the
      // token, never as `false`/`null`, which would claim a measurement.
      .toEqual({ ok: true, stdout: 'out\n', stderr: 'warn\n',
                 killed: UNMEASURED, signal: UNMEASURED });
  });

  it('a FAILURE still carries stdout and stderr — the 502 body quotes stderr', async () => {
    const { run } = spy({ code: 1, stdout: 'partial\n', stderr: 'boom\n' });
    expect(await ccdRunner(run, cfg)(CCD_ARGV.wsArchive(ID)))
      .toEqual({ ok: false, stdout: 'partial\n', stderr: 'boom\n',
                 killed: UNMEASURED, signal: UNMEASURED });
  });
});

describe('§1.4/§1.7 — CcdResult stops dropping the kill one hop later', () => {
  const cfg = { ccdBin: '/home/u/.local/bin/ccd' } as unknown as CcrcConfig;

  it('threads `killed` off the runner', async () => {
    const killedRun: Runner = async () => ({ code: 1, stdout: '', stderr: '', killed: true, signal: 'SIGTERM' });
    expect(await ccd(killedRun, cfg, CCD_ARGV.wsAdd('demo'))).toEqual({
      ok: false, stdout: '', stderr: '', killed: true, signal: 'SIGTERM',
    });
  });

  it('reads an absent half as UNMEASURED — NOT as false, which is a different fact', async () => {
    // §1.7 corrected the direction this hop used to be wrong in. It collapsed an
    // absent optional to `false`, telling every downstream caller "this child was
    // not killed" when the truth was "nobody measured whether it was". The
    // adoption gate treats those two differently on purpose.
    const plainRun: Runner = async () => ({ code: 1, stdout: '', stderr: 'refused' });
    expect(await ccd(plainRun, cfg, CCD_ARGV.wsAdd('demo'))).toEqual({
      ok: false, stdout: '', stderr: 'refused', killed: UNMEASURED, signal: UNMEASURED,
    });
  });

  it('keeps a MEASURED false and a MEASURED null — only absence becomes the token', async () => {
    const measured: Runner = async () => ({ code: 1, stdout: '', stderr: 'die', killed: false, signal: null });
    expect(await ccd(measured, cfg, CCD_ARGV.wsAdd('demo'))).toEqual({
      ok: false, stdout: '', stderr: 'die', killed: false, signal: null,
    });
  });
});

describe('§1.7 — cutShort: one reader for both halves, three answers, one adopts', () => {
  const r = (killed: CcdResult['killed'], signal: CcdResult['signal']): CcdResult =>
    ({ ok: false, stdout: '', stderr: '', killed, signal });

  it('true when the runner killed the child at its own deadline', () => {
    expect(cutShort(r(true, 'SIGTERM'))).toBe(true);
    // Even with the signal half missing — one half saying yes is enough.
    expect(cutShort(r(true, UNMEASURED))).toBe(true);
  });

  it('true on an EXTERNAL kill, where `killed` is false and the SIGNAL is the only evidence', () => {
    // node sets `killed` only for a kill IT issued. An operator `kill`, an OOM
    // reaper or systemd stopping the unit mid-`ws-add` lands exactly here, and
    // reading `killed` alone filed it under "ccd refused".
    expect(cutShort(r(false, 'SIGKILL'))).toBe(true);
  });

  it('false only when the half that can see an EXTERNAL kill was measured and said no', () => {
    expect(cutShort(r(false, null))).toBe(false);
    // The mirror shape, and it is sound on its own: the runner's own deadline
    // kill sends SIGTERM, so a MEASURED `signal: null` rules out both kinds of
    // kill whatever `killed` says.
    expect(cutShort(r(UNMEASURED, null))).toBe(false);
  });

  it('UNMEASURED when the SIGNAL half was not measured — `killed: false` cannot answer for it', () => {
    expect(cutShort(r(UNMEASURED, UNMEASURED))).toBe(UNMEASURED);
    // `killed: false` proves only that node did not kill this child at its own
    // deadline. The external kill — operator, OOM reaper, systemd stopping the
    // unit mid-`ws-add` — is visible ONLY in `signal`, which is the half §1.7
    // exists to add, so answering `false` here claimed a measurement nobody
    // made for precisely that half. Latent, not live: every producer in the
    // tree sends both halves or neither, but `asExecResult` spreads them
    // independently, so a peer frame carrying one alone lands right here.
    expect(cutShort(r(false, UNMEASURED))).toBe(UNMEASURED);
  });

  it('never mistakes the TOKEN for a signal name — it is a string, and that is the trap', () => {
    // The regression this pins: `typeof signal === 'string'` is TRUE for
    // `UNMEASURED`, so the value that exists to mean "nobody looked" read as the
    // strongest evidence there is and adopted a workspace on a dropped socket.
    expect(cutShort(r(UNMEASURED, UNMEASURED))).not.toBe(true);
    expect(cutShort(r(false, UNMEASURED))).not.toBe(true);
    expect(cutShort(r(true, UNMEASURED))).not.toBe(UNMEASURED);
  });
});
