// D-8903, D-8905, D-8907, D-8913, D-8919 (spec docs/superpowers/specs/2026-11-22-test-box-managed-node-design.md §2.5 to
// §2.8, §9 PR 2; note docs/superpowers/programs/overlord/testbox-box-updater.md). The test box's updater,
// `deploy/testbox/bin/box-update`: the spine on the box, through the installer's TB_SYS seam.
//
// A fixture box is installed by `deploy/testbox/install.sh` into a fixture root, as the box package's tests install
// one, and the updater is then run as the fleet host's driver will run it: from a staged release tree, with one spec
// file. The system manager, the firewall and the test service are `fixtures/testbox-update-sys-driver.sh`: a service
// that starts takes a main pid and, on a release that carries the marker `deploy/testbox/service-ready`, writes the
// ready file; a tag a test lists as unhealthy exits at once. That marker ships with the service's writer (spec §9,
// PR 3), so this checkout's tree has none: the fixture trees here carry it unless a test asks for a tree without
// (`ready: false`), which is what this pull request's own release is. The registry proxy and the node download host
// are local fixture servers. Nothing here contacts a box, a host, a registry or a system manager, and nothing runs
// as root.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOOT_TAG, exec, httpHost, install, makeBox, makeWorld, releaseTree, run, sha256, sysLog, treeOf, writeManifest,
  type Box, type Host, type Ran, type World,
} from './testboxBoxFixture.js';
import { capsFrom, installFrom, stampFrom } from '../src/update/inventory.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DRIVER = path.join(HERE, 'fixtures', 'testbox-update-sys-driver.sh');
const UPDATE_CG = 'system.slice/ccrc-testbox-update.service';
const T2 = 'v0.0.2';
const T3 = 'v0.0.3';
const MARKER = path.join('deploy', 'testbox', 'service-ready');
const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = '5'.repeat(64);
/** The marker of a release whose service writes the ready file, added to a tree (and its MANIFEST) or taken away. */
function mark(tree: string, ready: boolean): void {
  if (ready) writeFileSync(path.join(tree, MARKER), 'The test service of this release writes /run/ccrc-testbox/ready.\n');
  else rmSync(path.join(tree, MARKER), { force: true });
  writeManifest(tree);
}

let W: World;
let PROXY: Host;
beforeAll(async () => {
  W = await makeWorld();
  mark(W.staging, true);
  PROXY = await httpHost();
  PROXY.files.set('/npm', Buffer.from('{}'));
}, 240_000);
afterAll(async () => { await W.close(); await PROXY.close(); });

interface UBox extends Box {
  readonly state: string; readonly token: string; readonly busy: string; readonly unhealthy: string;
  /** TBS_FAIL, TBS_SLOW and TBS_EXITS: calls that fail, calls that are slow, tags whose service exits after its first pid read. */
  readonly failing: string; readonly slow: string; readonly exits: string;
}

/** A fixture box with the release BOOT_TAG installed, its service up, a service token in place, and this test's
 *  process standing in the firewall's tools set. */
async function installedBox(o: { proxy?: string } = {}): Promise<UBox> {
  const pre = makeBox(W, { boxLines: [`CCRC_TESTBOX_REGISTRY_PROXY=${o.proxy ?? `127.0.0.1:${PROXY.port}`}`] });
  const busy = path.join(pre.fx, 'busy');
  const unhealthy = path.join(pre.fx, 'unhealthy');
  const [failing, slow, exits] = ['failing', 'slow', 'exits'].map((n) => path.join(pre.fx, n)) as [string, string, string];
  const env = { ...pre.env, TB_SYS: DRIVER, TBS_BUSY: busy, TBS_UNHEALTHY: unhealthy, TBS_FAIL: failing, TBS_SLOW: slow, TBS_EXITS: exits, CCRC_UPDATE_HEALTH_S: '1' };
  const b: UBox = { ...pre, env, state: path.join(pre.tools, 'node-state'), token: path.join(pre.root, 'var', 'lib', 'ccrc-tb-svc', '.ccrc', 'testbox-service.token'), busy, unhealthy, failing, slow, exits };
  const r = await install(b, { staging: W.staging });
  expect(r.code, r.stderr).toBe(0);
  mkdirSync(path.dirname(b.token), { recursive: true });
  writeFileSync(b.token, `${TOKEN_A}\n`, { mode: 0o600 });
  mkdirSync(path.join(b.root, 'proc', 'self'), { recursive: true });
  writeFileSync(path.join(b.root, 'proc', 'self', 'cgroup'), `0::/${UPDATE_CG}\n`);
  appendFileSync(path.join(b.fx, 'sys.db'), `nft tools_cg ${UPDATE_CG}\n`);
  return b;
}

/** A staged release, as the driver leaves one: `<stage>/staging-<tag>` (the tree), beside it the spec and room for a
 *  token. `ready: false` is a release whose service writes no ready file (this checkout's own, until PR 3). */
function stageOf(b: Box, tag: string, edit?: (tree: string) => void, o: { ready?: boolean } = {}): { stage: string; tree: string } {
  const stage = path.join(b.fx, `stage-${tag}-${readdirSync(b.fx).length}`);
  mkdirSync(stage);
  const tree = releaseTree(stage, tag);
  if (edit !== undefined) edit(tree);
  mark(tree, o.ready !== false);
  return { stage, tree };
}

let act = 0;
interface UpdateOpts {
  lines?: string[]; kind?: string; answer?: boolean; env?: NodeJS.ProcessEnv; dropEnv?: string[];
  /** The spec file: its mode, a directory other than the stage to write it in, or written elsewhere and linked into the stage. */
  specMode?: number; specDir?: string; specLink?: boolean;
}
/** The spec file and the environment of one act (an act id, a kind and a release are given when not named). */
function prepare(b: UBox, tree: string, tag: string, o: UpdateOpts): { id: string; argv: string[]; env: NodeJS.ProcessEnv } {
  const id = `act-${++act}`;
  const stage = path.dirname(tree);
  let spec = path.join(o.specDir ?? stage, 'spec');   // in the stage, beside the tree
  const text = ['ccrc-testbox-update-spec', `act\t${id}`, `kind\t${o.kind ?? 'update'}`, `release\t${tag}`, ...((o.lines ?? []).some((l) => l.startsWith('drain\t')) ? [] : ['drain\t2']), ...(o.lines ?? []), ''].join('\n');
  rmSync(spec, { force: true });
  if (o.specLink === true) {
    writeFileSync(path.join(b.fx, `spec-${id}`), text);
    symlinkSync(path.join(b.fx, `spec-${id}`), spec);
  } else {
    writeFileSync(spec, text);
    if (o.specMode !== undefined) chmodSync(spec, o.specMode);
  }
  // The service's half of the drain (PR 3) is not built: a test that lets the drain pass writes the answer it will give.
  if (o.answer !== false) {
    mkdirSync(path.join(b.root, 'run', 'ccrc-testbox'), { recursive: true });
    writeFileSync(path.join(b.root, 'run', 'ccrc-testbox', 'drain'), `act\t${id}\nstate\tidle\nqueued\t0\n`);
  }
  const env: NodeJS.ProcessEnv = { ...b.env, ...o.env };
  for (const k of o.dropEnv ?? []) delete env[k];
  return { id, argv: [path.join(tree, 'deploy', 'testbox', 'bin', 'box-update'), spec], env };
}
/** The updater, run from `tree` with a spec of these lines. */
async function update(b: UBox, tree: string, tag: string, o: UpdateOpts = {}): Promise<Ran & { act: string }> {
  const p = prepare(b, tree, tag, o);
  const r = await exec('bash', p.argv, p.env);
  return { ...r, act: p.id };
}
/** What a unit killed after its switch leaves: its record of what it replaced, the links on `tag`, the service down,
 *  the report in flight. */
function deadAfterSwitch(b: UBox, tag: string): void {
  const node = path.join(b.tools, 'current', 'node');
  const prev = existsSync(path.join(b.state, 'previous')) ? `previous\t${stateFile(b, 'previous').trim().split('\n').join('\t')}\n` : '';
  writeFileSync(path.join(b.state, 'replaced'), `release\t${installedTag(b)}\nset\t${currentSet(b)}\n${prev}`);
  run(node, ['-e', 'const fs=require("fs");fs.symlinkSync(process.argv[1],process.argv[2]+".n");fs.renameSync(process.argv[2]+".n",process.argv[2])', tag, path.join(b.tools, 'release', 'installed')]);
  inFlight(b, tag);
  spawnSync(DRIVER, ['systemctl', 'stop', 'ccrc-testbox.service'], { env: b.env });
}
const inFlight = (b: UBox, tag: string): void =>
  writeFileSync(path.join(b.state, 'update.json'), `{"target":"${tag}","phase":"restarting","startedAt":1,"updatedAt":1,"detail":null,"from":"cli","pid":1}\n`);
/** Every file under `dir` that group or other may write. */
function loose(dir: string): string[] {
  return treeOf(dir).filter((l) => { const m = / [df] ([0-7]+)/.exec(l); return m !== null && (parseInt(m[1]!, 8) & 0o022) !== 0; });
}

const installedTag = (b: Box): string => path.basename(readlinkSync(path.join(b.tools, 'release', 'installed')));
const currentSet = (b: Box): string => path.basename(readlinkSync(path.join(b.tools, 'current')));
const report = (b: UBox): { target: string | null; phase: string; detail: string | null; from: string; act?: string } =>
  JSON.parse(readFileSync(path.join(b.state, 'update.json'), 'utf8'));
const stateFile = (b: UBox, n: string): string => readFileSync(path.join(b.state, n), 'utf8');
const active = (b: Box, unit: string): boolean => readFileSync(path.join(b.fx, 'sys.db'), 'utf8').split('\n').includes(`active ${unit}`);
const ready = (b: Box): string => readFileSync(path.join(b.root, 'run', 'ccrc-testbox', 'ready'), 'utf8');
const calls = (b: Box, from = 0): string[] => sysLog(b).slice(from).map((l) => l.join(' '));
/** Every call that changes the system: all but the reads. */
const writes = (b: Box, from = 0): string[] => calls(b, from).filter((c) => !/^(getent|findmnt|xfs_info|systemctl (is-active|show|list-units)|nft list) /.test(c));
/** The box, less the files that hold a time (the report and the measured tools). */
const boxTree = (b: Box): string[] => treeOf(b.root).filter((l) => !/node-state\/(update|tools)\.json /.test(l));
const systemFiles = (b: Box): string[] => treeOf(path.join(b.root, 'etc')).concat(treeOf(path.join(b.root, 'usr')), treeOf(path.join(b.root, 'var')));
const npmArgv = (): string[] => (existsSync(path.join(W.log, 'npm-argv')) ? readFileSync(path.join(W.log, 'npm-argv'), 'utf8').split('\n').filter((l) => l !== '') : []);

describe('the updater moves an installed box to a new release (spec §2.5, D-8903)', () => {
  let b: UBox;
  let first: Ran & { act: string };
  let before: string[];
  let stage: { stage: string; tree: string };
  let n0: number;
  beforeAll(async () => {
    b = await installedBox();
    before = systemFiles(b);
    stage = stageOf(b, T2);
    writeFileSync(path.join(stage.stage, 'token'), `${TOKEN_B}\n`, { mode: 0o600 });
    n0 = sysLog(b).length;
    first = await update(b, stage.tree, T2, { lines: ['verified\t1'] });
  }, 240_000);

  it('ends done on the new release, with the service up on it and its ready file naming it', () => {
    expect(first.code, first.stderr).toBe(0);
    expect(installedTag(b)).toBe(T2);
    expect(active(b, 'ccrc-testbox.service')).toBe(true);
    expect(ready(b)).toContain(`release\t${T2}\n`);
    expect(report(b)).toMatchObject({ target: T2, phase: 'done', from: 'cli', act: first.act });
  });

  it('stops the service before the switch and starts it after the render; no user manager and no `ccrc install` (D-7424)', () => {
    const c = calls(b, n0);
    const stop = c.indexOf('systemctl stop ccrc-testbox.service');
    const start = c.indexOf('systemctl restart ccrc-testbox.service');
    expect(stop).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(stop);
    expect(c.filter((x) => /--user|ccrc install/.test(x))).toEqual([]);
  });

  it('renders byte for byte what the installer rendered: the same units, drop-ins, rule, firewall file and egress names', () => {
    // The installer and the updater call the same steps (deploy/testbox/box-steps), so the files the installer left
    // are the files the updater would write: it wrote none of them, and reloaded neither the manager nor the firewall.
    expect(systemFiles(b).filter((l) => !/authorized_keys|testbox-service\.token/.test(l))).toEqual(before.filter((l) => !/authorized_keys|testbox-service\.token/.test(l)));
    expect(stateFile(b, 'rendered')).toBe('\n');
    expect(calls(b, n0).filter((x) => /daemon-reload|^nft -f/.test(x))).toEqual([]);
    // The release row's names are the installer's, whatever hosts that row holds.
    expect(readFileSync(path.join(b.root, 'etc', 'ccrc-testbox', 'egress'), 'utf8').split('\n').filter((l) => l.startsWith('release\t')).length).toBeGreaterThan(0);
  });

  it('writes the node files: the stamp, the completed-install record, caps of its own, the floor, the previous release and a node id', () => {
    expect(JSON.parse(stateFile(b, 'build.json')).version).toBe(T2);
    // The other nodes' format: one line, the sha, for a tree the driver verified (`verified\t1`), beside a `verify` cap.
    expect(stateFile(b, 'installed')).toBe(`${'b'.repeat(40)}\n`);
    const caps = stateFile(b, 'ccrc-caps').trim().split('\n');
    expect(caps[0]).toBe('os linux');
    expect(caps).toContain('verify');
    // D-8901: words of the box's own, never a core word a server could read as "this row can be moved by a local spawn".
    expect(caps.filter((w) => ['detach', 'update-gate', 'rollback'].includes(w))).toEqual([]);
    expect(stateFile(b, 'floor')).toBe(`${T2}\n`);
    expect(stateFile(b, 'previous')).toBe(`${BOOT_TAG}\n${'b'.repeat(40)}\n`);
    expect(stateFile(b, 'node-id')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n$/);
    expect(stateFile(b, 'kept')).toBe(`${BOOT_TAG}\ts.bootstrap\n${T2}\ts.bootstrap\n`);
    const tools = JSON.parse(stateFile(b, 'tools.json')) as Record<string, unknown>;
    expect(Object.keys(tools)).toEqual(['node', 'npm', 'chrome', 'python3', 'git', 'tmux', 'measuredAt']);
    expect(tools.node).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('its node files read through the one reader the other nodes\' files have: a complete, verified install (spec §2.2)', () => {
    const rd = (n: string): { ok: true; content: string } => ({ ok: true, content: stateFile(b, n) });
    const stamp = stampFrom(rd('build.json'));
    const caps = capsFrom(rd('ccrc-caps'));
    expect([stamp.stampRead, caps.os]).toEqual(['ok', 'linux']);
    expect(installFrom(rd('installed'), stamp, caps.caps)).toEqual({ installState: 'complete', provenance: 'verified' });
  });

  it('the lock\'s directory is made for root alone: a lock any user could open could be held by any user', () => {
    expect(calls(b, n0)).toContain(`install -d -m 0700 -o root -g root ${path.join(b.root, 'run', 'ccrc-testbox-update')}`);
  });

  it('keeps the previous release, and installs the new one\'s dependencies through the registry proxy with --ignore-scripts', () => {
    expect(existsSync(path.join(b.tools, 'release', BOOT_TAG, 'build.json'))).toBe(true);
    const mine = npmArgv().filter((l) => l.startsWith(path.join(b.tools, 'release', `.stage.${T2}`)));
    expect(mine.map((l) => l.split('\t')[1])).toEqual([0, 1].map(() => `ci --omit=dev --ignore-scripts --no-audit --no-fund --registry=http://127.0.0.1:${PROXY.port}/`));
  });

  it('the token: the staged one replaces the one in place by a rename, before the service starts, and leaves the stage (D-8919, #3130)', () => {
    expect(readFileSync(b.token, 'utf8')).toBe(`${TOKEN_B}\n`);
    expect(existsSync(path.join(stage.stage, 'token'))).toBe(false);
    expect(readdirSync(path.dirname(b.token))).toEqual(['testbox-service.token']);
    const c = calls(b, n0);
    // The temp file has a random name of its own (never a fixed one in the service user's directory), is given to the
    // service user, and is renamed into place before the service starts.
    const given = c.findIndex((x) => /^chown ccrc-tb-svc:ccrc-tb-svc .*testbox-service\.token\.[A-Za-z0-9]{8}$/.test(x));
    expect(given).toBeGreaterThan(-1);
    expect(given).toBeLessThan(c.indexOf('systemctl restart ccrc-testbox.service'));
  });

  it('the spine run twice: the second run changes nothing, fetches nothing and asks no registry (#3130)', async () => {
    const tree = boxTree(b);
    const n = sysLog(b).length;
    const npm = npmArgv().length;
    const [proxy, dl] = [PROXY.log.length, W.dl.log.length];
    const r = await update(b, stage.tree, T2, { answer: false });
    expect(r.code, r.stderr).toBe(0);
    expect(boxTree(b)).toEqual(tree);
    expect(writes(b, n)).toEqual([]);
    expect([npmArgv().length, PROXY.log.length, W.dl.log.length]).toEqual([npm, proxy, dl]);
    expect(report(b)).toMatchObject({ phase: 'done', act: r.act });
    expect(report(b).detail).toContain('nothing to change');
  });

  it('a second run over a mirror that is now the service user\'s completes: its config is written by file (#3130)', async () => {
    const bin = path.join(b.fx, 'stranger-bin');
    mkdirSync(bin, { recursive: true });
    const real = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(bin, 'git'), ['#!/usr/bin/env bash', 'for a in "$@"; do [ "$a" = -C ] && { echo "fatal: detected dubious ownership in repository" >&2; exit 128; }; done',
      `case "$PWD/" in '${b.mirror}'/*) echo "fatal: detected dubious ownership in repository" >&2; exit 128 ;; esac`, `exec '${real}' "$@"`, ''].join('\n'), { mode: 0o755 });
    // A damaged unit makes the run render for real, mirrors included.
    writeFileSync(path.join(b.root, 'etc', 'systemd', 'system', 'ccrc-testbox.slice'), '# damaged\n');
    const r = await update(b, stage.tree, T2, { env: { PATH: `${bin}:${b.env.PATH}` } });
    expect(r.code, r.stderr).toBe(0);
    expect(stateFile(b, 'rendered')).toBe(`${path.join(b.root, 'etc', 'systemd', 'system', 'ccrc-testbox.slice')}\n`);
    expect(systemFiles(b).filter((l) => !/authorized_keys|testbox-service\.token/.test(l))).toEqual(before.filter((l) => !/authorized_keys|testbox-service\.token/.test(l)));
  }, 240_000);

  it('a release that fails its gate is flipped back by the updater itself: reverted, the previous release serving (restore arm 1)', async () => {
    writeFileSync(b.unhealthy, `${T3}\n`);
    const s3 = stageOf(b, T3);
    const r = await update(b, s3.tree, T3);
    expect(r.code, r.stderr).toBe(4);
    expect(installedTag(b)).toBe(T2);
    expect(active(b, 'ccrc-testbox.service')).toBe(true);
    expect(ready(b)).toContain(`release\t${T2}\n`);
    expect(report(b)).toMatchObject({ target: T3, phase: 'reverted', act: r.act });
    expect(report(b).detail).toContain(`${T3} failed its health gate`);
    expect(JSON.parse(stateFile(b, 'build.json')).version).toBe(T2);
    expect(stateFile(b, 'floor')).toBe(`${T2}\n`);
    // What serves again was not verified by this act: the second line says so, in the other nodes' word.
    expect(stateFile(b, 'installed')).toBe(`${'b'.repeat(40)}\nunsigned\n`);
    // `previous` is what it was before the act: the box is where it was.
    expect(stateFile(b, 'previous')).toBe(`${BOOT_TAG}\n${'b'.repeat(40)}\n`);
    const stamp = stampFrom({ ok: true, content: stateFile(b, 'build.json') });
    expect(installFrom({ ok: true, content: stateFile(b, 'installed') }, stamp, capsFrom({ ok: true, content: stateFile(b, 'ccrc-caps') }).caps))
      .toEqual({ installState: 'complete', provenance: 'unverified' });
  }, 240_000);

  it('a dead updater is settled by the next act: a report left in flight over a release that does not start ends on the previous one', async () => {
    // What a unit killed after its switch leaves: the links on the new release, the service down, the report in flight.
    deadAfterSwitch(b, T3);
    const s2 = stageOf(b, T2);
    const r = await update(b, s2.tree, T2);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toContain('settling');
    expect(installedTag(b)).toBe(T2);
    expect(active(b, 'ccrc-testbox.service')).toBe(true);
    expect(report(b)).toMatchObject({ target: T2, phase: 'done', act: r.act });
  }, 240_000);

  it('kept releases: the fourth release prunes the oldest, never the previous one, and a release that never passed is removed', async () => {
    writeFileSync(b.unhealthy, '');
    for (const tag of [T3, 'v0.0.4']) {
      const s = stageOf(b, tag);
      const r = await update(b, s.tree, tag);
      expect(r.code, r.stderr).toBe(0);
    }
    expect(readdirSync(path.join(b.tools, 'release')).filter((n) => n.startsWith('v')).sort()).toEqual([T2, T3, 'v0.0.4']);
    expect(stateFile(b, 'kept')).toBe(`${T2}\ts.bootstrap\n${T3}\ts.bootstrap\nv0.0.4\ts.bootstrap\n`);
    expect(stateFile(b, 'previous').split('\n')[0]).toBe(T3);
  }, 240_000);

  it('the floor: an update below it is refused before any write, and the same move as a rollback runs', async () => {
    const s = stageOf(b, T2);
    const n = sysLog(b).length;
    const up = await update(b, s.tree, T2);
    expect([up.code, up.stderr.trim().split('\n').pop()]).toEqual([3, `ccrc-testbox-update: refused: ${T2} is below this box's floor v0.0.4 (a move down is a rollback); nothing was written`]);
    expect(writes(b, n)).toEqual([]);
    const down = await update(b, s.tree, T2, { kind: 'rollback' });
    expect(down.code, down.stderr).toBe(0);
    expect(installedTag(b)).toBe(T2);
    expect(stateFile(b, 'floor')).toBe('v0.0.4\n');
  }, 240_000);

  it('an act that settles and is then refused: settling wrote the node files of the release that serves, and the refusal says settling came first', async () => {
    // The box is on v0.0.2 (the rollback above). A dead act had switched it to v0.0.3 and never wrote what it became.
    deadAfterSwitch(b, T3);
    const s = stageOf(b, BOOT_TAG);
    const r = await update(b, s.tree, BOOT_TAG);
    expect(r.code, r.stderr).toBe(3);
    expect(r.stderr).toContain(`refused: ${BOOT_TAG} is below this box's floor v0.0.4 (a move down is a rollback); this act wrote nothing (settling the last act, above, came first)`);
    expect(r.stderr).not.toContain('nothing was written');
    expect(report(b)).toMatchObject({ target: T3, phase: 'done' });
    expect([installedTag(b), JSON.parse(stateFile(b, 'build.json')).version]).toEqual([T3, T3]);
    expect(stateFile(b, 'previous').split('\n')[0]).toBe(T2);
    expect(stateFile(b, 'kept').trim().split('\n').pop()).toBe(`${T3}\ts.bootstrap`);
  }, 240_000);
});

describe('the updater\'s refusals, each before any write (spec §2.5 step 2)', () => {
  let b: UBox;
  let s: { stage: string; tree: string };
  beforeAll(async () => { b = await installedBox(); s = stageOf(b, T2); }, 240_000);

  async function refused(why: RegExp, o: Parameters<typeof update>[3] = {}, tree = s.tree, tag = T2): Promise<void> {
    const before = boxTree(b);
    const n = sysLog(b).length;
    const r = await update(b, tree, tag, o);
    expect([r.code, why.test(r.stderr)], r.stderr).toEqual([3, true]);
    expect(r.stderr).toContain('nothing was written');
    expect(writes(b, n).filter((c) => !c.includes('ccrc-testbox-update'))).toEqual([]);   // the lock's own directory is the one thing made
    expect(boxTree(b).filter((l) => !l.startsWith('run/ccrc-testbox'))).toEqual(before.filter((l) => !l.startsWith('run/ccrc-testbox')));
    expect(installedTag(b)).toBe(BOOT_TAG);
  }

  it('a spec whose release is not this tree\'s', async () => { await refused(/build\.json version is not the spec's release v0\.0\.9/, {}, s.tree, 'v0.0.9'); }, 240_000);
  it('a tool version off its shape, and a tool beyond the six', async () => {
    await refused(/the spec's node version is not a version/, { lines: ['tool\tnode\t22;rm'] });
    await refused(/names a tool beyond the six/, { lines: ['tool\tcurl\t8.0.0'] });
  }, 240_000);
  it('a kind that is neither update nor rollback, and a from that is no word of the update lane', async () => {
    await refused(/kind is neither update nor rollback/, { kind: 'repair' });
    await refused(/the spec's from is none of/, { lines: ['from\toperator'] });
  }, 240_000);
  it('a tree that does not match its MANIFEST, and a stage that is not root\'s alone', async () => {
    const bad = stageOf(b, T2);
    appendFileSync(path.join(bad.tree, 'deploy', 'testbox', 'bin', 'firewall'), '# changed after the MANIFEST\n');
    await refused(/does not match its MANIFEST/, {}, bad.tree);
    const loose = stageOf(b, T2);
    chmodSync(path.join(loose.tree, 'build.json'), 0o664);
    await refused(/the stage is not root's alone/, {}, loose.tree);
  }, 240_000);
  it('a tarball whose digest is not the one the spec names', async () => {
    writeFileSync(path.join(s.stage, 'release.tar.gz'), 'not the release\n');
    await refused(/staged tarball's sha256 is not the one the spec names/, { lines: [`sha256\t${'0'.repeat(64)}`] });
    const ok = sha256(readFileSync(path.join(s.stage, 'release.tar.gz')));
    rmSync(path.join(s.stage, 'release.tar.gz'));
    expect(ok).toMatch(/^[0-9a-f]{64}$/);
  }, 240_000);
  it('a box with no service token, in place or in the stage (D-8919)', async () => {
    rmSync(b.token);
    await refused(/the service has no token, in place or in the stage/);
    writeFileSync(b.token, `${TOKEN_A}\n`, { mode: 0o600 });
  }, 240_000);
  it('an updater that does not run in the firewall\'s tools set: none of its fetches would leave the box', async () => {
    writeFileSync(path.join(b.root, 'proc', 'self', 'cgroup'), '0::/user.slice/session-1.scope\n');
    await refused(/does not run in the firewall's tools set/);
    writeFileSync(path.join(b.root, 'proc', 'self', 'cgroup'), `0::/${UPDATE_CG}\n`);
  }, 240_000);
  it('an updater that does run in the tools set is not refused when the set is read in more than one part: all of nft\'s answer is read', async () => {
    // Past a pipe's 64 KiB after the updater's own cgroup: a reader that stops at its match leaves nft writing into a
    // closed pipe, killed by SIGPIPE (exit 141), and under pipefail that is a refusal of an updater that is in the set.
    const db = path.join(b.fx, 'sys.db');
    const pad = (l: string): boolean => l.startsWith('nft tools_cg system.slice/pad-');
    appendFileSync(db, Array.from({ length: 3000 }, (_, i) => `nft tools_cg system.slice/pad-${i}.service\n`).join(''));
    const r = await update(b, s.tree, T2, { answer: false });
    writeFileSync(db, readFileSync(db, 'utf8').split('\n').filter((l) => !pad(l)).join('\n'));
    expect(r.stderr).not.toContain('tools set');
    expect(r.code, r.stderr).toBe(3);
    expect(r.stderr).toContain('the drain ran out of time after 2s');
    expect(installedTag(b)).toBe(BOOT_TAG);
  }, 240_000);
  it('a stage that is not root\'s alone: its directory, its spec, a spec outside it, and a spec that is a link (spec §2.5 steps 2 and 5)', async () => {
    const open = stageOf(b, T2);
    chmodSync(open.stage, 0o777);
    await refused(/the stage is not root's alone/, {}, open.tree);
    chmodSync(open.stage, 0o755);
    await refused(/the stage is not root's alone: .*\/spec/, { specMode: 0o666 }, open.tree);
    await refused(/the spec file is not in the stage/, { specDir: b.fx }, open.tree);
    await refused(/the stage is not root's alone: .*\/spec/, { specLink: true }, open.tree);
  }, 240_000);
  it('a staged token that is not a root-only file holding one token: readable by others, another shape, a link', async () => {
    const t = stageOf(b, T2);
    const tok = path.join(t.stage, 'token');
    writeFileSync(tok, `${TOKEN_B}\n`, { mode: 0o644 });
    await refused(/the staged token is not a root-only file/, {}, t.tree);
    rmSync(tok);
    writeFileSync(tok, 'planted-token\n', { mode: 0o600 });
    await refused(/the staged token is not a root-only file/, {}, t.tree);
    rmSync(tok);
    writeFileSync(path.join(b.fx, 'a-token'), `${TOKEN_B}\n`, { mode: 0o600 });
    symlinkSync(path.join(b.fx, 'a-token'), tok);
    await refused(/the staged token is not a root-only file/, {}, t.tree);
    expect(readFileSync(b.token, 'utf8')).toBe(`${TOKEN_A}\n`);
  }, 240_000);
  it('a digest the spec names is compared, never skipped: no tarball in the stage, and a link in its place', async () => {
    const t = stageOf(b, T2);
    await refused(/names a sha256 and the stage holds no tarball/, { lines: [`sha256\t${'0'.repeat(64)}`] }, t.tree);
    writeFileSync(path.join(b.fx, 'a-tarball'), 'the release\n');
    symlinkSync(path.join(b.fx, 'a-tarball'), path.join(t.stage, 'release.tar.gz'));
    await refused(/names a sha256 and the stage holds no tarball/, { lines: [`sha256\t${sha256('the release\n')}`] }, t.tree);
  }, 240_000);
  it('a drain bound beyond 900 seconds', async () => {
    await refused(/drain bound is not a number of seconds up to 900/, { lines: ['drain\t901'] });
  }, 240_000);
  it('a second updater while one holds the box\'s update lock is deferred (exit 3), never failed (exit 1): nothing changed', async () => {
    const lockDir = path.join(b.root, 'run', 'ccrc-testbox-update');
    mkdirSync(lockDir, { recursive: true });
    const held = exec('flock', [path.join(lockDir, 'lock'), 'sleep', '4'], b.env);
    await new Promise((r) => setTimeout(r, 500));
    const n = sysLog(b).length;
    const r = await update(b, s.tree, T2);
    expect(r.code, r.stderr).toBe(3);
    expect(r.stderr).toContain('deferred: another update holds the box\'s update lock');
    expect(r.stderr).toContain('nothing on the box changed');
    expect(writes(b, n)).toEqual([]);
    expect(installedTag(b)).toBe(BOOT_TAG);
    await held;
  }, 240_000);
});

describe('the drain (spec §2.5, D-8907)', () => {
  let b: UBox;
  let s: { stage: string; tree: string };
  beforeAll(async () => { b = await installedBox(); s = stageOf(b, T2); }, 240_000);
  const request = (): string => path.join(b.root, 'run', 'ccrc-testbox-drain', 'request');

  it('a service that never answers: deferred at the bound with nothing changed, and the request withdrawn', async () => {
    const r = await update(b, s.tree, T2, { answer: false });
    expect(r.code, r.stderr).toBe(3);
    expect(r.stderr).toContain('the drain ran out of time after 2s');
    expect(installedTag(b)).toBe(BOOT_TAG);
    expect(active(b, 'ccrc-testbox.service')).toBe(true);
    expect(existsSync(request())).toBe(false);
    expect(report(b)).toMatchObject({ target: T2, phase: 'failed', act: r.act });
    expect(report(b).detail).toMatch(/^deferred: the drain ran out of time/);
    expect(calls(b).filter((c) => c === 'systemctl stop ccrc-testbox.service')).toEqual([]);
  }, 240_000);

  it('an answer for another act is not this act\'s: deferred', async () => {
    mkdirSync(path.join(b.root, 'run', 'ccrc-testbox'), { recursive: true });
    writeFileSync(path.join(b.root, 'run', 'ccrc-testbox', 'drain'), 'act\tsomeone-else\nstate\tidle\n');
    const r = await update(b, s.tree, T2, { answer: false });
    expect(r.code, r.stderr).toBe(3);
    expect(installedTag(b)).toBe(BOOT_TAG);
  }, 240_000);

  it('the answer says idle but a run unit is still active: the updater goes on only on its own measurement', async () => {
    writeFileSync(b.busy, 'ccrc-testbox-run@2.service loaded active running a run\n');
    const r = await update(b, s.tree, T2);
    expect(r.code, r.stderr).toBe(3);
    expect(r.stderr).toContain('(1 units active)');
    expect(installedTag(b)).toBe(BOOT_TAG);
    writeFileSync(b.busy, '');
  }, 240_000);

  it('a system manager that does not answer the measurement: unmeasured is never idle, so the service is not stopped', async () => {
    writeFileSync(b.failing, 'systemctl list-units\n');
    const r = await update(b, s.tree, T2);
    writeFileSync(b.failing, '');
    expect(r.code, r.stderr).toBe(3);
    expect(r.stderr).toContain('the drain ran out of time after 2s (the active units could not be measured)');
    expect(installedTag(b)).toBe(BOOT_TAG);
    expect(calls(b).filter((c) => c === 'systemctl stop ccrc-testbox.service')).toEqual([]);
  }, 240_000);

  it('the answer is read as data: a link to an answer and an answer over 4096 bytes are not taken', async () => {
    const answer = path.join(b.root, 'run', 'ccrc-testbox', 'drain');
    mkdirSync(path.dirname(answer), { recursive: true });
    rmSync(answer, { force: true });
    writeFileSync(path.join(b.fx, 'an-answer'), `act\tact-${act + 1}\nstate\tidle\nqueued\t0\n`);
    symlinkSync(path.join(b.fx, 'an-answer'), answer);
    const linked = await update(b, s.tree, T2, { answer: false });
    expect(linked.code, linked.stderr).toBe(3);
    rmSync(answer);
    writeFileSync(answer, `act\tact-${act + 1}\nstate\tidle\nqueued\t0\n${'#'.repeat(4200)}\n`);
    const big = await update(b, s.tree, T2, { answer: false });
    expect(big.code, big.stderr).toBe(3);
    expect(installedTag(b)).toBe(BOOT_TAG);
  }, 240_000);

  it('an updater ended in mid-drain leaves no request: the request is a lease, withdrawn however the updater ends', async () => {
    const p = prepare(b, s.tree, T2, { answer: false, lines: ['drain\t60'] });
    const child = spawn('bash', p.argv, { env: p.env, stdio: 'ignore' });
    const ended = new Promise<void>((r) => child.on('close', () => r()));
    for (let i = 0; i < 200 && !existsSync(request()); i++) await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(request())).toBe(true);
    child.kill('SIGTERM');
    await ended;
    expect(existsSync(request())).toBe(false);
    // And nothing it started keeps the box's update lock: the lock is free the moment the updater is gone.
    expect(spawnSync('flock', ['-n', path.join(b.root, 'run', 'ccrc-testbox-update', 'lock'), 'true']).status).toBe(0);
    expect(installedTag(b)).toBe(BOOT_TAG);
    expect(active(b, 'ccrc-testbox.service')).toBe(true);
  }, 240_000);

  it('the answer in place and no unit active: the request named this act and its deadline, and the act goes on', async () => {
    const n = sysLog(b).length;
    const r = await update(b, s.tree, T2);
    expect(r.code, r.stderr).toBe(0);
    expect(installedTag(b)).toBe(T2);
    expect(existsSync(request())).toBe(false);
    const put = calls(b, n).filter((c) => c.includes('ccrc-testbox-drain/request'));
    expect(put.length).toBe(1);
    expect(put[0]).toMatch(/^install -m 0644 -o root -g root /);
  }, 240_000);
});

describe('a box from before the managed node is adopted (spec §2.7, §2.8)', () => {
  let b: UBox;
  let legacyLog: string;
  beforeAll(async () => {
    b = await installedBox();
    // A release from before this design: it carries no updater, its service writes no ready file, and its own
    // installer is what applies its units (a stand-in here, which records its call and restarts the service).
    const old = path.join(b.tools, 'release', BOOT_TAG, 'deploy', 'testbox');
    legacyLog = path.join(b.fx, 'legacy-install.log');
    for (const f of [path.join('bin', 'box-update'), 'box-steps', 'service-ready']) rmSync(path.join(old, f));
    writeFileSync(path.join(old, 'install.sh'), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> '${legacyLog}'\n"$TB_SYS" systemctl restart ccrc-testbox.service\n`);
    rmSync(path.join(b.root, 'run', 'ccrc-testbox', 'ready'));
    writeFileSync(path.join(b.tools, 'takeover'), `previous\t${BOOT_TAG}\nrelease\t${T2}\n`);
  }, 240_000);

  it('its first move fails its gate: the old release is put back by its own installer, gated by the legacy arm, and serves', async () => {
    writeFileSync(b.unhealthy, `${T2}\n`);
    const s = stageOf(b, T2);
    const r = await update(b, s.tree, T2, { answer: false });
    expect(r.code, r.stderr).toBe(4);
    expect(installedTag(b)).toBe(BOOT_TAG);
    expect(active(b, 'ccrc-testbox.service')).toBe(true);
    expect(readFileSync(legacyLog, 'utf8')).toBe('--reapply --force\n');
    expect(report(b)).toMatchObject({ target: T2, phase: 'reverted' });
    // The old mover's takeover file would make the old service's start remove a kept release: it is gone.
    expect(existsSync(path.join(b.tools, 'takeover'))).toBe(false);
    expect(existsSync(path.join(b.state, 'node-id'))).toBe(false);
  }, 240_000);

  it('its next move passes: the old service is not asked to drain, the old release is recorded as previous, and a node id is minted once', async () => {
    writeFileSync(b.unhealthy, '');
    // The old mover's file again: the new service's start must not find it, or it would remove the release it names.
    writeFileSync(path.join(b.tools, 'takeover'), `previous\t${BOOT_TAG}\nrelease\t${T2}\n`);
    const s = stageOf(b, T2);
    const n = sysLog(b).length;
    const r = await update(b, s.tree, T2, { answer: false });
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(path.join(b.tools, 'takeover'))).toBe(false);
    expect(existsSync(path.join(b.tools, 'release', BOOT_TAG, 'build.json'))).toBe(true);
    expect(calls(b, n).filter((c) => c.includes('ccrc-testbox-drain'))).toEqual([]);
    expect(installedTag(b)).toBe(T2);
    expect(stateFile(b, 'previous').split('\n')[0]).toBe(BOOT_TAG);
    const id = stateFile(b, 'node-id');
    const again = await update(b, s.tree, T2, { answer: false });
    expect(again.code, again.stderr).toBe(0);
    expect(stateFile(b, 'node-id')).toBe(id);
  }, 240_000);
});

describe('bounds, the environment and the registry (spec §2.5, §2.8, §2.9)', () => {
  let hang: Server;
  let hangPort = 0;
  beforeAll(async () => {
    hang = createServer(() => { /* accepts and never answers */ });
    await new Promise<void>((r) => hang.listen(0, '127.0.0.1', () => r()));
    hangPort = (hang.address() as { port: number }).port;
  });
  afterAll(() => { hang.close(); });

  it('a stage that runs past its bound is ended there, with nothing changed and the lock free for the next act', async () => {
    const b = await installedBox({ proxy: `127.0.0.1:${hangPort}` });
    const s = stageOf(b, T2);
    const t0 = Date.now();
    const r = await update(b, s.tree, T2, { lines: ['bound\tstage\t1'] });
    expect(r.code, r.stderr).toBe(3);
    expect(r.stderr).toContain('the stage step ran past its bound of 1s');
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(installedTag(b)).toBe(BOOT_TAG);
    expect(report(b).detail).toMatch(/^deferred: the stage step ran past its bound/);
    // The watcher kept no copy of the lock: the next act takes it.
    const again = await update(b, s.tree, T2, { lines: ['bound\tstage\t1'] });
    expect(again.code, again.stderr).toBe(3);
    expect(again.stderr).not.toContain('another update holds');
  }, 240_000);

  it('a stage whose npm hangs is ended with everything it started: no grandchild keeps the lock, and the next act is not refused by it', async () => {
    const b = await installedBox();
    // An npm that starts a child of its own and waits for it: a grandchild of the step, which a signal to the step's
    // direct children alone would leave running with the lock's descriptor.
    writeFileSync(path.join(b.tools, 'node', '22.0.0', 'bin', 'npm'), '#!/bin/sh\nsleep 30 &\nwait\n', { mode: 0o755 });
    const s = stageOf(b, T2);
    const t0 = Date.now();
    const r = await update(b, s.tree, T2, { lines: ['bound\tstage\t1'] });
    expect(r.code, r.stderr).toBe(3);
    expect(r.stderr).toContain('the stage step ran past its bound of 1s');
    // The run is over when everything it started is gone: a grandchild left alive keeps its output open for 30 s.
    expect(Date.now() - t0).toBeLessThan(20_000);
    const again = await update(b, s.tree, T2, { lines: ['bound\tstage\t1'] });
    expect(again.code, again.stderr).toBe(3);
    expect(again.stderr).not.toContain('another update holds');
    expect(again.stderr).toContain('the stage step ran past its bound of 1s');
  }, 240_000);

  it('a switch that runs past its bound is ended there, and the box is flipped back', async () => {
    const b = await installedBox();
    writeFileSync(b.slow, '4 systemctl restart ccrc-testbox.service\n');
    const r = await update(b, stageOf(b, T2).tree, T2, { lines: ['bound\tswitch\t1'] });
    expect(r.code, r.stderr).toBe(4);
    expect(report(b)).toMatchObject({ target: T2, phase: 'reverted' });
    expect(report(b).detail).toContain('the switch step ran past its bound of 1s');
    expect([installedTag(b), active(b, 'ccrc-testbox.service')]).toEqual([BOOT_TAG, true]);
  }, 240_000);

  it('a restore that runs past its bound is ended there: failed, said so', async () => {
    const b = await installedBox();
    writeFileSync(b.slow, '4 systemctl restart ccrc-testbox.service\n');
    writeFileSync(b.unhealthy, `${T2}\n`);
    const r = await update(b, stageOf(b, T2).tree, T2, { lines: ['bound\trestore\t1'] });
    expect(r.code, r.stderr).toBe(1);
    expect(report(b)).toMatchObject({ target: T2, phase: 'failed' });
    expect(report(b).detail).toContain('the restore step ran past its bound of 1s');
  }, 240_000);

  it('the gate runs node under a bound of its own: a node that hangs fails the gate, and never holds the act', async () => {
    const b = await installedBox();
    writeFileSync(path.join(b.tools, 'node', '22.0.0', 'bin', 'node'), `#!/bin/sh\n[ "$1" = --version ] && exec sleep 60\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
    const t0 = Date.now();
    const r = await update(b, stageOf(b, T2).tree, T2);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toContain('current/node does not run');
    expect(Date.now() - t0).toBeLessThan(55_000);
  }, 240_000);

  it('a proxy that does not answer: deferred, never the upstream registry, with the firewall loaded or not (O4 is not ruled)', async () => {
    const b = await installedBox({ proxy: '127.0.0.1:1' });
    const s = stageOf(b, T2);
    const npm = npmArgv().length;
    const r = await update(b, s.tree, T2);
    expect(r.code, r.stderr).toBe(3);
    expect(r.stderr).toContain('the registry proxy at 127.0.0.1:1 does not answer');
    // The same on a box whose firewall table is not loaded: no allowlist is in force there, and the answer is the same.
    const db = path.join(b.fx, 'sys.db');
    writeFileSync(db, readFileSync(db, 'utf8').split('\n').filter((l) => !l.startsWith('nft ')).join('\n'));
    const open = await update(b, s.tree, T2);
    expect(open.code, open.stderr).toBe(3);
    expect(open.stderr).toContain('the registry proxy at 127.0.0.1:1 does not answer');
    expect(npmArgv().length).toBe(npm);
    expect(installedTag(b)).toBe(BOOT_TAG);
  }, 240_000);

  it('it runs with no HOME in its environment, as a root unit starts it (testbox-sync-home)', async () => {
    const b = await installedBox();
    const bin = path.join(b.fx, 'getent-bin');
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'getent'), `#!/bin/sh\nprintf 'root:x:0:0:root:%s:/bin/sh\\n' '${b.home}'\n`, { mode: 0o755 });
    const s = stageOf(b, T2);
    const r = await update(b, s.tree, T2, { env: { PATH: `${bin}:${b.env.PATH}` }, dropEnv: ['HOME', 'LANG'] });
    expect(r.code, r.stderr).toBe(0);
    expect(installedTag(b)).toBe(T2);
  }, 240_000);
});

describe('the switch, the restore and settling leave the box on a release that serves (spec §2.5, §2.7, §2.8)', () => {
  let b: UBox;
  const T4 = 'v0.0.4';
  beforeAll(async () => {
    b = await installedBox();
    for (const tag of [T2, T3]) { const s = stageOf(b, tag); const r = await update(b, s.tree, tag); expect(r.code, r.stderr).toBe(0); }
  }, 240_000);

  it('a stop that fails with the service still up: deferred, nothing flipped, and the box stays on its installed release', async () => {
    writeFileSync(b.failing, 'systemctl stop ccrc-testbox.service\n');
    const s = stageOf(b, T4);
    const r = await update(b, s.tree, T4);
    writeFileSync(b.failing, '');
    expect(r.code, r.stderr).toBe(3);
    expect(r.stderr).toContain('deferred: cannot stop the test service');
    expect([installedTag(b), active(b, 'ccrc-testbox.service')]).toEqual([T3, true]);
    expect(JSON.parse(stateFile(b, 'build.json')).version).toBe(T3);
    expect(stateFile(b, 'previous').split('\n')[0]).toBe(T2);
    expect(report(b)).toMatchObject({ target: T4, phase: 'failed' });
    expect(report(b).detail).toMatch(/^deferred: cannot stop the test service/);
  }, 240_000);

  it('a dead updater that had switched: settling writes the node files of the release that serves, and names what it replaced as previous', async () => {
    deadAfterSwitch(b, T4);   // the tree is there: the deferred act above staged it
    const s = stageOf(b, T4);
    const r = await update(b, s.tree, T4, { answer: false });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toContain('settling');
    expect(JSON.parse(stateFile(b, 'build.json')).version).toBe(T4);
    expect(stateFile(b, 'kept')).toBe(`${BOOT_TAG}\ts.bootstrap\n${T2}\ts.bootstrap\n${T3}\ts.bootstrap\n${T4}\ts.bootstrap\n`);
    expect(stateFile(b, 'previous').split('\n')[0]).toBe(T3);
    expect(stateFile(b, 'floor')).toBe(`${T4}\n`);
    expect(report(b)).toMatchObject({ target: T4, phase: 'done', act: r.act });
  }, 240_000);

  it('the next move keeps the tree its previous names', async () => {
    const s = stageOf(b, 'v0.0.5');
    const r = await update(b, s.tree, 'v0.0.5');
    expect(r.code, r.stderr).toBe(0);
    expect(stateFile(b, 'previous').split('\n')[0]).toBe(T4);
    expect(readdirSync(path.join(b.tools, 'release')).filter((n) => n.startsWith('v')).sort()).toEqual([T3, T4, 'v0.0.5']);
  }, 240_000);

  it('node files that are not the installed tree\'s are written again by an act that changes nothing else', async () => {
    writeFileSync(path.join(b.state, 'build.json'), readFileSync(path.join(b.tools, 'release', T3, 'build.json')));
    const r = await update(b, stageOf(b, 'v0.0.5').tree, 'v0.0.5', { answer: false });
    expect(r.code, r.stderr).toBe(0);
    expect(report(b).detail).toContain('nothing to change');
    expect(JSON.parse(stateFile(b, 'build.json')).version).toBe('v0.0.5');
  }, 240_000);

  it('a service that binds, writes its ready file and is gone a moment later has not stayed up: the gate fails and the box is flipped back', async () => {
    writeFileSync(b.exits, 'v0.0.6\n');
    const s = stageOf(b, 'v0.0.6');
    const r = await update(b, s.tree, 'v0.0.6');
    expect(r.code, r.stderr).toBe(4);
    expect(r.stderr).toContain('did not stay up (its main pid changed)');
    expect([installedTag(b), active(b, 'ccrc-testbox.service')]).toEqual(['v0.0.5', true]);
  }, 240_000);

  it('settling has a bound too: a settle that runs past it is ended there, and the box is put back on what the dead act replaced', async () => {
    writeFileSync(b.exits, '');
    deadAfterSwitch(b, 'v0.0.6');   // its tree is there: the act above staged it and was flipped back
    writeFileSync(b.slow, '4 systemctl restart ccrc-testbox.service\n');
    const r = await update(b, stageOf(b, 'v0.0.6').tree, 'v0.0.6', { lines: ['bound\tswitch\t1'] });
    writeFileSync(b.slow, '');
    expect(r.code, r.stderr).toBe(4);
    expect(report(b).detail).toContain('the switch step ran past its bound of 1s');
    expect([installedTag(b), active(b, 'ccrc-testbox.service')]).toEqual(['v0.0.5', true]);
  }, 240_000);
});

describe('a release whose service writes no ready file: this pull request\'s own, until the writer ships (spec §2.7, §9)', () => {
  let b: UBox;
  beforeAll(async () => {
    b = await installedBox();
    rmSync(path.join(b.tools, 'release', BOOT_TAG, MARKER));
    rmSync(path.join(b.root, 'run', 'ccrc-testbox', 'ready'));
  }, 240_000);

  it('is moved to without a drain request and gated by the legacy arm: it carries the updater and no marker', async () => {
    const s = stageOf(b, T2, undefined, { ready: false });
    expect(existsSync(path.join(s.tree, 'deploy', 'testbox', 'bin', 'box-update'))).toBe(true);
    const n = sysLog(b).length;
    const r = await update(b, s.tree, T2, { answer: false });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toContain('gate: testbox-legacy answers on v0.0.2');
    expect(calls(b, n).filter((c) => c.includes('ccrc-testbox-drain'))).toEqual([]);
    expect(existsSync(path.join(b.root, 'run', 'ccrc-testbox', 'ready'))).toBe(false);
  }, 240_000);

  it('as the replaced release it is rendered by the updater and restored through the legacy arm, and serves', async () => {
    writeFileSync(b.unhealthy, `${T3}\n`);
    const s = stageOf(b, T3);
    const r = await update(b, s.tree, T3, { answer: false });
    expect(r.code, r.stderr).toBe(4);
    expect([installedTag(b), active(b, 'ccrc-testbox.service')]).toEqual([T2, true]);
    expect(report(b)).toMatchObject({ target: T3, phase: 'reverted' });
  }, 240_000);
});

describe('what the updater reads and writes as root (spec §2.5, §2.12)', () => {
  it('the ready file is read as data: a link, and a file over 4096 bytes, are not the service\'s word, so the service is not asked to drain', async () => {
    const b = await installedBox();
    const ready = path.join(b.root, 'run', 'ccrc-testbox', 'ready');
    writeFileSync(path.join(b.fx, 'a-ready'), readFileSync(ready));
    rmSync(ready);
    symlinkSync(path.join(b.fx, 'a-ready'), ready);
    let n = sysLog(b).length;
    const linked = await update(b, stageOf(b, T2).tree, T2, { answer: false });
    expect(linked.code, linked.stderr).toBe(0);
    expect(calls(b, n).filter((c) => c.includes('ccrc-testbox-drain'))).toEqual([]);
    appendFileSync(ready, `${'#'.repeat(4200)}\n`);
    n = sysLog(b).length;
    const big = await update(b, stageOf(b, T3).tree, T3, { answer: false });
    expect(big.code, big.stderr).toBe(0);
    expect(calls(b, n).filter((c) => c.includes('ccrc-testbox-drain'))).toEqual([]);
  }, 240_000);

  it('the token: a link planted at a temp name in the service user\'s directory, or at the token\'s own path, sends nothing of root\'s elsewhere', async () => {
    const b = await installedBox();
    const [v1, v2] = ['victim-1', 'victim-2'].map((d) => { mkdirSync(path.join(b.fx, d)); return path.join(b.fx, d); }) as [string, string];
    symlinkSync(v1, `${b.token}.tbu-new`);
    const s2 = stageOf(b, T2);
    writeFileSync(path.join(s2.stage, 'token'), `${TOKEN_B}\n`, { mode: 0o600 });
    const first = await update(b, s2.tree, T2);
    expect(first.code, first.stderr).toBe(0);
    expect([readdirSync(v1), readFileSync(b.token, 'utf8')]).toEqual([[], `${TOKEN_B}\n`]);
    // The token's own path as a link to a directory: one rename replaces the link, and never follows it.
    rmSync(b.token);
    symlinkSync(v2, b.token);
    const s3 = stageOf(b, T3);
    writeFileSync(path.join(s3.stage, 'token'), `${TOKEN_A}\n`, { mode: 0o600 });
    const second = await update(b, s3.tree, T3);
    expect(second.code, second.stderr).toBe(0);
    expect([readdirSync(v2), lstatSync(b.token).isFile(), readFileSync(b.token, 'utf8')]).toEqual([[], true, `${TOKEN_A}\n`]);
  }, 240_000);

  it('a link where a rendered file belongs is replaced by the file, even when the link\'s target holds the same bytes', async () => {
    const b = await installedBox();
    const unit = path.join(b.root, 'etc', 'systemd', 'system', 'ccrc-testbox.slice');
    writeFileSync(path.join(b.fx, 'a-slice'), readFileSync(unit));
    rmSync(unit);
    symlinkSync(path.join(b.fx, 'a-slice'), unit);
    const r = await update(b, stageOf(b, BOOT_TAG).tree, BOOT_TAG);
    expect(r.code, r.stderr).toBe(0);
    expect(lstatSync(unit).isFile()).toBe(true);
    expect(stateFile(b, 'rendered')).toBe(`${unit}\n`);
  }, 240_000);

  it('a kept release tree that group or other may write is not taken: deferred with nothing changed', async () => {
    const b = await installedBox();
    chmodSync(path.join(b.tools, 'release', BOOT_TAG, 'build.json'), 0o664);
    const n = sysLog(b).length;
    const r = await update(b, stageOf(b, BOOT_TAG).tree, BOOT_TAG);
    expect(r.code, r.stderr).toBe(3);
    expect(r.stderr).toContain('build.json is writable by someone other than root');
    expect(calls(b, n).filter((c) => /^systemctl (stop|restart)/.test(c))).toEqual([]);
  }, 240_000);

  it('what npm leaves writable by group or other is closed before the tree is placed', async () => {
    const b = await installedBox();
    writeFileSync(path.join(b.tools, 'node', '22.0.0', 'bin', 'npm'), '#!/bin/sh\numask 0\nmkdir -p node_modules\n: > node_modules/loose\nchmod 666 node_modules/loose\n', { mode: 0o755 });
    const r = await update(b, stageOf(b, T2).tree, T2);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(path.join(b.tools, 'release', T2, 'server', 'node_modules', 'loose'))).toBe(true);
    expect(loose(path.join(b.tools, 'release', T2))).toEqual([]);
  }, 240_000);

  it('Chrome is never run by the updater: its version is the directory the tool set\'s link names (D-7422)', async () => {
    const b = await installedBox();
    const dir = path.join(b.tools, 'chrome', '131.0.6778.85', 'chrome-linux64');
    mkdirSync(dir, { recursive: true });
    const ran = path.join(b.fx, 'chrome-ran');
    writeFileSync(path.join(dir, 'chrome'), `#!/bin/sh\n: > '${ran}'\necho 'Google Chrome for Testing 999'\n`, { mode: 0o755 });
    symlinkSync('../../chrome/131.0.6778.85/chrome-linux64/chrome', path.join(b.tools, 'sets', 's.bootstrap', 'chrome'));
    const r = await update(b, stageOf(b, T2).tree, T2);
    expect(r.code, r.stderr).toBe(0);
    expect((JSON.parse(stateFile(b, 'tools.json')) as { chrome: string }).chrome).toBe('131.0.6778.85');
    expect(existsSync(ran)).toBe(false);
  }, 240_000);
});

describe('the updater\'s functions, called alone', () => {
  /** box-update sourced beside the files it sources, in a fixture box's environment. */
  const fn = (b: UBox, script: string): { code: number; out: string; err: string } => {
    const pre = ['set -uo pipefail', `R='${REPO}'`, '. "$R/deploy/testbox/bin/tools-sync"', '. "$R/deploy/testbox/box-steps"', '. "$R/deploy/testbox/bin/box-update"',
      'UPD_LOCK_FD=""', 'fail() { printf "FAIL %s\\n" "$*" >&2; exit 9; }'].join('\n');
    const r = spawnSync('bash', ['--norc', '--noprofile', '-c', `${pre}\n${script}`], { encoding: 'utf8', env: b.env });
    return { code: r.status ?? -1, out: r.stdout.trim(), err: r.stderr };
  };
  let b: UBox;
  beforeAll(async () => { b = await installedBox(); }, 240_000);

  it('the prune never removes the installed release, the previous one or the replaced one and its tool set, in the window of kept lines or not', () => {
    const rel = (t: string): string => path.join(b.tools, 'release', t);
    for (const t of ['v0.1.0', 'v0.1.1', 'v0.1.2', 'v0.1.3', 'v0.1.4', 'v0.1.5']) mkdirSync(rel(t));
    for (const set of ['s.replaced1', 's.strayset1']) mkdirSync(path.join(b.tools, 'sets', set));
    mkdirSync(b.state, { recursive: true });
    writeFileSync(path.join(b.state, 'kept'), ['v0.1.1', 'v0.1.2', 'v0.1.3', 'v0.1.4', 'v0.1.5'].map((t) => `${t}\ts.bootstrap\n`).join(''));
    writeFileSync(path.join(b.state, 'previous'), `v0.1.1\n${'b'.repeat(40)}\n`);
    writeFileSync(path.join(b.state, 'replaced'), 'release\tv0.1.0\nset\ts.replaced1\n');
    const r = fn(b, `TOOLS='${b.tools}'; TBT_TOOLS=$TOOLS; STATE=$TOOLS/node-state; WORK=$(mktemp -d); _tbu_prune; rm -rf "$WORK"`);
    expect(r.code, r.err).toBe(0);
    // v0.0.1 serves and is in no kept line; v0.1.0 is the replaced one and is in none; v0.1.1 is the previous one,
    // outside the last three lines; v0.1.2 is none of these and goes.
    expect(readdirSync(path.join(b.tools, 'release')).filter((n) => n.startsWith('v')).sort()).toEqual([BOOT_TAG, 'v0.1.0', 'v0.1.1', 'v0.1.3', 'v0.1.4', 'v0.1.5']);
    expect(readdirSync(path.join(b.tools, 'sets')).sort()).toEqual(['s.bootstrap', 's.replaced1']);
    expect(stateFile(b, 'kept')).toBe(['v0.1.1', 'v0.1.3', 'v0.1.4', 'v0.1.5'].map((t) => `${t}\ts.bootstrap\n`).join(''));
  });

  it('a bound the spec names only makes a step shorter', () => {
    const r = fn(b, 'declare -A TBU_BOUND=([stage]=9999); _tbu_bound stage 720; echo "$TBU_BOUND_SECS"; TBU_BOUND[stage]=5; _tbu_bound stage 720; echo "$TBU_BOUND_SECS"; _tbu_unbound');
    expect([r.code, r.out], r.err).toEqual([0, '720\n5']);
  });
});

describe('node and npm at the versions the fleet host measured (spec §2.6: the hard tools)', () => {
  const NODE = '22.5.0';
  const NPM = '10.9.9';
  let b: UBox;
  beforeAll(async () => {
    b = await installedBox();
    // node: a tarball whose `node --version` answers its own version, and runs this process's node for the rest.
    const art = path.join(b.fx, 'art');
    const top = path.join(art, `node-v${NODE}-linux-x64`);
    mkdirSync(path.join(top, 'bin'), { recursive: true });
    writeFileSync(path.join(top, 'bin', 'node'), `#!/bin/sh\n[ "$1" = --version ] && { echo v${NODE}; exit 0; }\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
    writeFileSync(path.join(top, 'bin', 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const txz = path.join(art, 'node.tar.xz');
    run('tar', ['-cJf', txz, '-C', art, path.basename(top)]);
    const tb = readFileSync(txz);
    W.dl.files.set(`/dist/v${NODE}/node-v${NODE}-linux-x64.tar.xz`, tb);
    W.dl.files.set(`/dist/v${NODE}/SHASUMS256.txt`, Buffer.from(`${sha256(tb)}  node-v${NODE}-linux-x64.tar.xz\n`));
    // npm: a package whose cli answers its version, served by the fixture proxy with its sha512 integrity.
    const pkg = path.join(art, 'package');
    mkdirSync(path.join(pkg, 'bin'), { recursive: true });
    writeFileSync(path.join(pkg, 'package.json'), `${JSON.stringify({ name: 'npm', version: NPM })}\n`);
    for (const f of ['npm-cli.js', 'npx-cli.js']) writeFileSync(path.join(pkg, 'bin', f), `#!/usr/bin/env node\nconsole.log('${NPM}');\n`, { mode: 0o755 });
    const tgz = path.join(art, 'npm.tgz');
    run('tar', ['-czf', tgz, '-C', art, 'package']);
    const body = readFileSync(tgz);
    const tarball = `http://127.0.0.1:${PROXY.port}/npm/-/npm-${NPM}.tgz`;
    PROXY.files.set(`/npm/-/npm-${NPM}.tgz`, body);
    PROXY.files.set('/npm', Buffer.from(JSON.stringify({ versions: { [NPM]: { dist: { integrity: `sha512-${createHash('sha512').update(body).digest('base64')}`, tarball } } } })));
  }, 240_000);
  afterAll(() => { PROXY.files.set('/npm', Buffer.from('{}')); });

  it('a spec that names them stages both, switches to a new tool set that keeps the old set\'s other links, and the gate runs them', async () => {
    const s = stageOf(b, T2);
    const r = await update(b, s.tree, T2, { lines: [`tool\tnode\t${NODE}`, `tool\tnpm\t${NPM}`] });
    expect(r.code, r.stderr).toBe(0);
    const set = currentSet(b);
    expect(set).toMatch(/^s\.[A-Za-z0-9]{8}$/);
    expect(readlinkSync(path.join(b.tools, 'sets', set, 'node'))).toBe(`../../node/${NODE}/bin/node`);
    expect(readlinkSync(path.join(b.tools, 'sets', set, 'bin', 'npm'))).toBe(`../../../npm/${NPM}/bin/npm-cli.js`);
    expect(readFileSync(path.join(b.tools, 'sets', set, 'versions'), 'utf8')).toBe(`node\t${NODE}\nnpm\t${NPM}\n`);
    // Measured, not copied: tools.json is what the box's own node and npm answered.
    expect(JSON.parse(stateFile(b, 'tools.json'))).toMatchObject({ node: NODE, npm: NPM });
    expect(stateFile(b, 'kept')).toBe(`${BOOT_TAG}\ts.bootstrap\n${T2}\t${set}\n`);
    // The previous release's set and its node are kept with it.
    expect(existsSync(path.join(b.tools, 'sets', 's.bootstrap', 'node'))).toBe(true);
  }, 240_000);

  it('the same spec again fetches neither, and a gate that finds another node than the set names fails', async () => {
    const s = stageOf(b, T2);
    const dl = W.dl.log.length;
    const r = await update(b, s.tree, T2, { lines: [`tool\tnode\t${NODE}`, `tool\tnpm\t${NPM}`], answer: false });
    expect(r.code, r.stderr).toBe(0);
    expect(W.dl.log.length).toBe(dl);
    // The gate's tool arm: a set that says another node than the one that answers fails the gate, and the box is
    // flipped back to the previous release and its own set.
    const versions = path.join(b.tools, 'current', 'versions');
    writeFileSync(versions, readFileSync(versions, 'utf8').replace(NODE, '22.5.1'));
    const bad = await update(b, s.tree, T2);
    expect(bad.code, bad.stderr).toBe(4);
    expect(bad.stderr).toMatch(/node answers v22\.5\.0, not v22\.5\.1/);
    expect([installedTag(b), currentSet(b)]).toEqual([BOOT_TAG, 's.bootstrap']);
  }, 240_000);

  it('a tools-only act whose gate fails is flipped back to the same release and its old tool set (spec §2.6 "Tools-only drift")', async () => {
    // A node whose tarball is 22.6.0 and which answers another version: the gate's tool arm fails on the new set.
    const fresh = await installedBox();
    const art = path.join(fresh.fx, 'art');
    const top = path.join(art, 'node-v22.6.0-linux-x64');
    mkdirSync(path.join(top, 'bin'), { recursive: true });
    writeFileSync(path.join(top, 'bin', 'node'), `#!/bin/sh\n[ "$1" = --version ] && { echo v22.6.9; exit 0; }\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
    run('tar', ['-cJf', path.join(art, 'node.tar.xz'), '-C', art, path.basename(top)]);
    const tb = readFileSync(path.join(art, 'node.tar.xz'));
    W.dl.files.set('/dist/v22.6.0/node-v22.6.0-linux-x64.tar.xz', tb);
    W.dl.files.set('/dist/v22.6.0/SHASUMS256.txt', Buffer.from(`${sha256(tb)}  node-v22.6.0-linux-x64.tar.xz\n`));
    const r = await update(fresh, stageOf(fresh, BOOT_TAG).tree, BOOT_TAG, { lines: ['tool\tnode\t22.6.0', `tool\tnpm\t${NPM}`] });
    expect(r.code, r.stderr).toBe(4);
    expect(r.stderr).toMatch(/node answers v22\.6\.9, not v22\.6\.0/);
    expect([installedTag(fresh), currentSet(fresh), active(fresh, 'ccrc-testbox.service')]).toEqual([BOOT_TAG, 's.bootstrap', true]);
    expect(report(fresh)).toMatchObject({ target: BOOT_TAG, phase: 'reverted' });
  }, 240_000);
});

describe('the update lane\'s gate and report, shared (ccd/ccrc)', () => {
  const sh = (script: string, env: NodeJS.ProcessEnv = {}): { code: number; out: string } => {
    const home = path.join(REPO, 'server', 'test', 'fixtures');
    const r = spawnSync('bash', ['--norc', '--noprofile', '-c', `set -uo pipefail; . "$1" >/dev/null 2>&1\n${script}`, 'bash', path.join(REPO, 'ccd', 'ccrc')],
      { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: path.join(home, 'no-such-home'), TMPDIR: process.env.TMPDIR ?? '/tmp', ...env } });
    return { code: r.status ?? -1, out: r.stdout.trim() };
  };

  it('the gate probe has no testbox arm of its own: without the box\'s function it refuses the role, as it refuses any role it does not know', () => {
    for (const role of ['testbox', 'testbox-legacy', 'nonesuch']) {
      expect(sh(`_upd_gate_probe ${role} v0.0.2; echo "$? $UPD_GATE_WHY"`).out).toBe(`1 no health gate is defined for role '${role}'`);
    }
  });

  it('with the box\'s function declared, both roles are its to answer, and no other role reaches it', () => {
    const fn = '_tb_gate_probe() { UPD_GATE_WHY="asked $1 $2"; return 0; }';
    expect(sh(`${fn}; _upd_gate_probe testbox v0.0.2; echo "$? $UPD_GATE_WHY"`).out).toBe('0 asked testbox v0.0.2');
    expect(sh(`${fn}; _upd_gate_probe testbox-legacy v0.0.1; echo "$? $UPD_GATE_WHY"`).out).toBe('0 asked testbox-legacy v0.0.1');
    expect(sh(`${fn}; _upd_gate_probe nonesuch v0.0.2; echo "$? $UPD_GATE_WHY"`).out).toBe("1 no health gate is defined for role 'nonesuch'");
  });

  it('the report\'s act key is the updater\'s to set: a value in the environment never reaches a report, and a set one is redacted', () => {
    const dir = path.join(W.dir, 'act-key');
    mkdirSync(dir);
    const none = sh('BOX_UPDATE_JSON="$T/a.json"; _upd_phase queued >/dev/null; cat "$T/a.json"', { T: dir, UPD_ACT_ID: 'from-the-environment' });
    expect(none.out).toMatch(/^\{"target":null,"phase":"queued",/);
    expect(none.out).not.toContain('act');
    const set = sh('BOX_UPDATE_JSON="$T/b.json"; UPD_ACT_ID=act-7; _upd_phase queued >/dev/null; cat "$T/b.json"', { T: dir });
    expect((JSON.parse(set.out) as { act: string }).act).toBe('act-7');
    const secret = sh('BOX_UPDATE_JSON="$T/c.json"; UPD_ACT_ID="https://user:hunter2@host.invalid/x"; _upd_phase queued >/dev/null; cat "$T/c.json"', { T: dir });
    expect(secret.out).toContain('"act":');
    expect(secret.out).not.toContain('hunter2');
  });
});
