// D-7408, D-7422, D-7423, D-7424, D-7425, D-7426, D-7456, D-7457 (plan docs/superpowers/plans/2026-10-29-test-box.md,
// Task TB6; spec §2.10, §5 row 5). The tool sync: the decider (`tools.ts`), the box's root script
// (`deploy/testbox/bin/tools-sync`) and the service's driver (`toolsync.ts`).
//
// The script runs as the test user with TB_FIXTURE_ROOT and TB_FIXTURE_OWNER_UID=$(id -u) (D-7456), from a fixture
// `<tools>` laid out as TB7's bootstrap leaves it: `<tools>/current` a set holding only `node`, and
// `<tools>/release/installed` naming the bootstrap tag, whose tree is this checkout's ccd/, deploy/ and shared/ built
// into a release the way the update tests build theirs (a payload with a shipped `build.json` and a `MANIFEST`, a
// `SHA256SUMS` beside its tarball, a bundle beside that). Every host is a local fixture server: three release hosts
// (the box file's, the unit environment's and root's home ccrc.env's), the download hosts (served over HTTPS from a
// fixture CA, reached through root's fixture `.curlrc`, whose reach is probed before any row runs), and the registry
// proxy. The OS package manager is a fixture `apt-get`/`apt-cache` on PATH that answers from fixture files. Nothing
// here contacts a box, a release host, a registry, the node or Chrome download host or an OS mirror, and nothing runs
// `systemctl`: the driver's system manager is a fake that runs the script directly.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { readTestboxFrame, type RunSubmit, type RunSummary, type StatusAnswer, type TestboxRepoRow, type ToolsSync, type TestboxToolVersions } from '../../shared/testbox.js';
import { serviceFor, startTestboxServer, timerWork } from '../src/testbox/main.js';
import { FRAME_HANDLERS, type TestboxService } from '../src/testbox/service.js';
import { buildInstallSpec, buildRunSpec, writeInstallSpec, writeSpec, type SpecSettings } from '../src/testbox/spec.js';
import type { TestboxConfig } from '../src/testbox/config.js';
import type { SystemManager, UnitEnd } from '../src/testbox/systemd.js';
import {
  ended, encodeToolsSpec, IDLE_TOOLS, keptSets, parseReport, parseVersions, requested, retryDue, retryStarted, sameAsBox, seenRuns,
  toolsSettings, withSync, type BoxTools, type ToolsSettings,
} from '../src/testbox/tools.js';
import { attachToolSync, HANDOVER_DIR, statusOf, ToolSync, toolSyncOf, type ServedService } from '../src/testbox/toolsync.js';
import { durationMs } from '../src/testbox/config.js';
import { mkTmp } from './tmpHelpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const UID = process.getuid?.() ?? 0;
const REAL_NODE = process.execPath;
const THIRD_BUNDLE = path.join(REPO, 'server', 'test', 'fixtures', 'provenance', 'third-workflow.sigstore.jsonl');

// ---------------------------------------------------------------------------------------------------------------
// The versions: the bootstrap's, and the fleet host's measured set a sync installs.
// ---------------------------------------------------------------------------------------------------------------

const BOOT_TAG = 'v0.0.1';
const NEW_TAG = 'v0.0.2';
const BOOT_NODE = '22.0.0';
const NEW: TestboxToolVersions = { node: '22.1.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };
const MADISON: Record<string, string> = {
  python3: 'python3 | 3.12.3-0ubuntu2 | http://mirror.testbox.invalid noble/main amd64 Packages\n',
  git: '       git | 1:2.43.0-1ubuntu7 | http://mirror.testbox.invalid noble/main amd64 Packages\n',
  tmux: '      tmux | 3.4-1ubuntu0.1 | http://mirror.testbox.invalid noble-updates/main amd64 Packages\n      tmux | 3.3a-1 | http://mirror.testbox.invalid noble/main amd64 Packages\n',
};
const MEASURED_AT = '2026-10-29T12:00:00Z';
const SPEC_ROW: TestboxRepoRow = {
  name: 'project-a', fetchUrl: 'https://testbox.invalid/project-a.git', mirrorPath: '/nonexistent/project-a.git',
  packages: [{ name: 'server', installInputs: ['server/package.json'], commands: ['./node_modules/.bin/vitest'] }], buildOutputs: [], systemTools: [],
};
const SPEC_SUBMIT: RunSubmit = {
  t: 'run.submit', runId: 'a'.repeat(32), repository: 'project-a', package: 'server', branch: 'main', refs: ['head'], outputs: [],
  argv: ['./node_modules/.bin/vitest', 'run'], forward: {}, ci: false, workers: 1, session: 'session-a',
};
/** A string as a RegExp source that matches only that string: every metacharacter escaped, the backslash included. */
const reEscape = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
const frameOf = (release: string, versions: TestboxToolVersions = NEW): ToolsSync => ({ t: 'tools.sync', release, versions, measuredAt: MEASURED_AT });

// ---------------------------------------------------------------------------------------------------------------
// The pure decider.
// ---------------------------------------------------------------------------------------------------------------

const SETTINGS_LINES = new Map([
  ['CCRC_TESTBOX_PRISTINE_RETRY', { value: '2m 10m' }], ['CCRC_TESTBOX_REGISTRY_PROXY', { value: '127.0.0.1:4873' }],
  ['CCRC_TESTBOX_OS_MIRROR', { value: '' }],
]);
const TS: ToolsSettings = toolsSettings(SETTINGS_LINES, durationMs);
const [R1, R2] = [TS.retryMs[0]!, TS.retryMs[1]!];
const BOX: BoxTools = { release: NEW_TAG, versions: NEW, set: 's.aaaaaaaa' };
const OK_REPORT = parseReport('result\tok\nrelease\tv0.0.2\nset\ts.bbbbbbbb\ntakeover\t0\nnode-changed\t1\n');

describe('tools.ts: the decider (spec §2.10)', () => {
  it('a tools.sync whose release and six versions are the box\'s starts nothing and changes nothing', async () => {
    const r = requested(IDLE_TOOLS, frameOf(NEW_TAG), BOX, MEASURED_AT);
    expect(r.start).toBeNull();
    expect(r.state.sync).toEqual(IDLE_TOOLS.sync);
    expect(r.state.running).toBe(false);
    expect(sameAsBox(frameOf(NEW_TAG, { ...NEW, tmux: '3.5' }), BOX)).toBe(false);
    expect(sameAsBox(frameOf('v0.0.3'), BOX)).toBe(false);
    expect(sameAsBox(frameOf(NEW_TAG), { ...BOX, versions: null })).toBe(false);
  });

  it('another frame starts a sync; one that comes while it runs waits and runs next, the newest replacing an older', async () => {
    const a = requested(IDLE_TOOLS, frameOf('v0.0.3'), BOX, MEASURED_AT);
    expect(a.start?.release).toBe('v0.0.3');
    expect(a.state.sync).toEqual({ state: 'syncing', detail: null, at: MEASURED_AT });
    const b = requested(a.state, frameOf('v0.0.4'), BOX, MEASURED_AT);
    const c = requested(b.state, frameOf('v0.0.5'), BOX, MEASURED_AT);
    expect(b.start).toBeNull();
    expect(c.state.pending?.release).toBe('v0.0.5');
    const e = ended(c.state, 0, OK_REPORT, 0, TS.retryMs, MEASURED_AT);
    expect(e.next?.release).toBe('v0.0.5');
    expect(e.state.sync.state).toBe('idle');
    expect(e.nodeChanged).toBe(true);
  });

  it('a failure is `failed <tool>: <detail>`, retried on CCRC_TESTBOX_PRISTINE_RETRY\'s delays, the last repeating', async () => {
    const a = requested(IDLE_TOOLS, frameOf('v0.0.3'), BOX, MEASURED_AT).state;
    const rep = parseReport('result\tfailed\ntool\tnode\ndetail\tchecksum mismatch for node-v22.1.0-linux-x64.tar.xz\n');
    const f1 = ended(a, 1, rep, 1000, TS.retryMs, MEASURED_AT).state;
    expect(f1.sync).toEqual({ state: 'failed', detail: 'node: checksum mismatch for node-v22.1.0-linux-x64.tar.xz', at: MEASURED_AT });
    expect(f1.nextAt).toBe(1000 + R1);
    expect(retryDue(f1, 1000 + R1 - 1)).toBeNull();
    expect(retryDue(f1, 1000 + R1)?.release).toBe('v0.0.3');
    const f2 = ended(retryStarted(f1, MEASURED_AT), 1, rep, 5000, TS.retryMs, MEASURED_AT).state;
    expect([f2.attempts, f2.nextAt]).toEqual([2, 5000 + R2]);
    const f3 = ended(retryStarted(f2, MEASURED_AT), 1, rep, 9000, TS.retryMs, MEASURED_AT).state;
    expect(f3.nextAt).toBe(9000 + R2);
    // A unit that left no report is named by its exit.
    expect(ended(a, 255, parseReport(null), 0, TS.retryMs, MEASURED_AT).state.sync.detail).toBe('sync: the tools unit exited 255');
    // A report that says ok with a non-zero exit is still a failure.
    expect(ended(a, 1, OK_REPORT, 0, TS.retryMs, MEASURED_AT).state.sync.state).toBe('failed');
  });

  it('a sync that replaced the release begins the takeover: no frame starts a sync, no retry runs', async () => {
    const a = requested(IDLE_TOOLS, frameOf('v0.0.3'), BOX, MEASURED_AT).state;
    const e = ended(a, 0, parseReport('result\tok\ntakeover\t1\n'), 0, TS.retryMs, MEASURED_AT);
    expect(e.takeover).toBe(true);
    expect(requested(e.state, frameOf('v0.0.4'), BOX, MEASURED_AT).start).toBeNull();
    expect(retryDue({ ...e.state, sync: { state: 'failed', detail: 'x', at: null }, nextAt: 0, last: frameOf('v0.0.4') }, 1)).toBeNull();
  });

  it('a live run keeps the set it was first seen under; a run that ended lets its set go', async () => {
    const m1 = seenRuns(new Map(), ['r1'], 's.aaaaaaaa');
    const m2 = seenRuns(m1, ['r1', 'r2'], 's.bbbbbbbb');
    expect([...m2]).toEqual([['r1', 's.aaaaaaaa'], ['r2', 's.bbbbbbbb']]);
    expect(keptSets(m2)).toEqual(['s.aaaaaaaa', 's.bbbbbbbb']);
    expect(keptSets(seenRuns(m2, ['r2'], 's.bbbbbbbb'))).toEqual(['s.bbbbbbbb']);
  });

  it('the versions file reads to the six versions, else null', async () => {
    expect(parseVersions('node\t22.1.0\nnpm\t10.9.0\nchrome\t131.0.6778.85\npython3\t3.12.3\ngit\t2.43.0\ntmux\t3.4\n')).toEqual(NEW);
    expect(parseVersions('node\t22.1.0\n')).toBeNull();
    expect(parseVersions(null)).toBeNull();
  });

  it('the status answer carries the sync\'s state: ok turns degraded, a down box stays down, a degraded one adds the reason first', async () => {
    const base = { t: 'status', state: 'ok', reason: null, serviceVersion: '0.0.2', proto: 1, release: NEW_TAG, tools: NEW,
      sync: IDLE_TOOLS.sync, runs: { inProgress: 0, limit: 2 }, queueDepth: 0, pristine: [], failedKeys: [], heldRunUsers: [], repositories: [] } as StatusAnswer;
    const failed = { state: 'failed' as const, detail: 'release: provenance verification FAILED', at: MEASURED_AT };
    expect(withSync(base, failed)).toMatchObject({ state: 'degraded', reason: 'tool sync failed (release: provenance verification FAILED)', sync: failed });
    expect(withSync({ ...base, state: 'down', reason: 'missing mirror a' }, failed)).toMatchObject({ state: 'down', reason: 'missing mirror a' });
    expect(withSync({ ...base, state: 'degraded', reason: 'run user held out (ccrc-tb-1)' }, failed).reason)
      .toBe('tool sync failed (release: provenance verification FAILED); run user held out (ccrc-tb-1)');
    expect(withSync(base, { state: 'syncing', detail: 'chrome', at: MEASURED_AT }).reason).toBe('tool sync in progress (chrome)');
    expect(withSync(base, IDLE_TOOLS.sync)).toEqual(base);
  });

  it('specs/tools: the header, the tools directory, the release, six versions, the proxy, the mirror and each kept set', async () => {
    const b = encodeToolsSpec({ toolsDir: '/opt/tools', frame: frameOf(NEW_TAG), settings: TS, keep: ['s.aaaaaaaa'] });
    expect(b.toString('utf8').split('\0')).toEqual([
      'ccrc-testbox-tools-spec', 'T/opt/tools', `R${NEW_TAG}`, 'Vnode=22.1.0', 'Vnpm=10.9.0', 'Vchrome=131.0.6778.85', 'Vpython3=3.12.3',
      'Vgit=2.43.0', 'Vtmux=3.4', 'P127.0.0.1:4873', 'O', 'Ks.aaaaaaaa', '',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Fixture hosts.
// ---------------------------------------------------------------------------------------------------------------

interface Host { readonly port: number; readonly log: string[]; files: Map<string, Buffer>; close(): Promise<void> }

function handler(h: { log: string[]; files: Map<string, Buffer> }) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const p = (req.url ?? '').split('?')[0]!;
    h.log.push(p);
    const body = h.files.get(p);
    if (body === undefined) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-length': String(body.length) });
    res.end(body);
  };
}
async function listen(s: Server, h: { log: string[]; files: Map<string, Buffer> }): Promise<Host> {
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', () => resolve()));
  return {
    port: (s.address() as AddressInfo).port, log: h.log, files: h.files,
    close: () => new Promise<void>((resolve) => { s.closeAllConnections?.(); s.close(() => resolve()); }),
  };
}
async function httpHost(): Promise<Host> {
  const h = { log: [] as string[], files: new Map<string, Buffer>() };
  return listen(createServer(handler(h)), h);
}

// ---------------------------------------------------------------------------------------------------------------
// Fixture artifacts.
// ---------------------------------------------------------------------------------------------------------------

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

function run(cmd: string, args: string[], cwd?: string): string {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** A `MANIFEST` as `deploy/build-release.sh` writes it: every file but itself, `<sha256>  <path>`, in byte order. */
function writeManifest(tree: string): void {
  const files: string[] = [];
  const walk = (d: string, rel: string): void => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      const r = rel === '' ? n : `${rel}/${n}`;
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p, r);
      else if (st.isFile()) files.push(r);
    }
  };
  walk(tree, '');
  files.sort((a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b))));
  writeFileSync(path.join(tree, 'MANIFEST'), files.map((f) => `${sha256(readFileSync(path.join(tree, f)))}  ${f}\n`).join(''));
}

/** The release payload, the update tests' FULL shape: the checkout's ccd/, shared/ and deploy/ (no mail token),
 *  install.sh, server/'s manifests, the shipped stamp and the MANIFEST. */
function releaseTree(dir: string, version: string, sha: string): string {
  const tree = path.join(dir, `payload-${version}-${sha.slice(0, 6)}`);
  cpSync(path.join(REPO, 'ccd'), path.join(tree, 'ccd'), { recursive: true });
  cpSync(path.join(REPO, 'shared'), path.join(tree, 'shared'), { recursive: true });
  cpSync(path.join(REPO, 'deploy'), path.join(tree, 'deploy'), { recursive: true, filter: (s) => !s.endsWith('ccrc-mail.token') });
  copyFileSync(path.join(REPO, 'install.sh'), path.join(tree, 'install.sh'));
  mkdirSync(path.join(tree, 'server'), { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) copyFileSync(path.join(REPO, 'server', f), path.join(tree, 'server', f));
  writeFileSync(path.join(tree, 'build.json'), `{"sha":"${sha}","ref":"release","builtAt":"2026-10-29T00:00:00Z","dirty":false,"version":"${version}"}\n`);
  writeManifest(tree);
  return tree;
}

interface Release { readonly tag: string; readonly tarball: Buffer; readonly sums: Buffer; readonly sha: string }
function packRelease(dir: string, tree: string, tag: string, sha: string): Release {
  const out = path.join(dir, `ccrc-${tag}-${sha.slice(0, 6)}.tar.gz`);
  run('tar', ['-czf', out, '-C', tree, '.']);
  const tarball = readFileSync(out);
  return { tag, tarball, sums: Buffer.from(`${sha256(tarball)}  ccrc-${tag}.tar.gz\n`), sha };
}
/** A release host's files for one release; `bundle`: present (a fixture bundle the fixture verifier reads), absent
 *  (404), or another workflow's real bundle; `tamper`: the tarball's bytes no longer match SHA256SUMS. */
function serveRelease(h: Host, r: Release, o: { bundle?: 'fixture' | 'absent' | 'third'; tamper?: boolean } = {}): void {
  const d = `/releases/download/${r.tag}`;
  h.files.set(`${d}/SHA256SUMS`, r.sums);
  h.files.set(`${d}/ccrc-${r.tag}.tar.gz`, o.tamper === true ? Buffer.concat([r.tarball, Buffer.from('tampered')]) : r.tarball);
  const b = o.bundle ?? 'fixture';
  if (b === 'fixture') h.files.set(`${d}/ccrc-${r.tag}.tar.gz.sigstore.json`, Buffer.from('{"fixture":"bundle"}\n'));
  if (b === 'third') h.files.set(`${d}/ccrc-${r.tag}.tar.gz.sigstore.json`, readFileSync(THIRD_BUNDLE));
}

/** The fixture `node`: the verifier's invocation is answered from `<log>/verify-mode`, its argv and this node's version
 *  recorded; every other argv runs the real node. The mode is an exit code; `third`, the verifier's refusal (exit 1) of
 *  the bundle it was handed, which must be the real third-workflow bundle (verify-provenance.test.ts holds that the real
 *  verifier refuses it); or `real`, the real verifier, whose dependencies this package does not install beside the
 *  fixture tree, so it cannot run (exit 3). */
const nodeShim = (version: string, log: string): string => `#!/bin/sh
case "$*" in
  *verify-provenance.mjs*)
    printf '%s\\t%s\\n' '${version}' "$*" >> '${log}/verify-argv'
    mode=0; [ -f '${log}/verify-mode' ] && IFS= read -r mode < '${log}/verify-mode'
    [ "$mode" = real ] && exec '${REAL_NODE}' "$@"
    if [ "$mode" = third ]; then
      prev=; bundle=; for a in "$@"; do [ "$prev" = --bundle ] && bundle="$a"; prev="$a"; done
      cmp -s "$bundle" '${THIRD_BUNDLE}' || { echo "fixture verifier: not the third-workflow bundle" >&2; exit 97; }
      echo "verify-provenance: no bundle verified against the trusted root for either release workflow (fixture: a third workflow's bundle)" >&2
      exit 1
    fi
    [ "$mode" = 0 ] && echo "verified fixture (sigstore)"
    exit "$mode" ;;
esac
exec '${REAL_NODE}' "$@"
`;

/** node's release tarball, `node-v<version>-linux-x64.tar.xz`: the shim, a bundled npm stand-in and node's headers. */
function nodeTarball(dir: string, version: string, log: string): Buffer {
  const top = path.join(dir, `nodepkg-${version}`, `node-v${version}-linux-x64`);
  mkdirSync(path.join(top, 'bin'), { recursive: true });
  mkdirSync(path.join(top, 'include', 'node'), { recursive: true });
  writeFileSync(path.join(top, 'include', 'node', 'node.h'), '/* fixture */\n');
  writeFileSync(path.join(top, 'bin', 'node'), nodeShim(version, log), { mode: 0o755 });
  const out = path.join(dir, `node-v${version}-linux-x64.tar.xz`);
  run('tar', ['-cJf', out, '-C', path.dirname(top), path.basename(top)]);
  return readFileSync(out);
}

/** npm's registry tarball: `package/bin/npm-cli.js` records its argv and, for `ci`, lays out a `node_modules`. */
function npmTarball(dir: string, version: string, log: string): Buffer {
  const pkg = path.join(dir, `npmpkg-${version}`, 'package');
  mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'npm', version }));
  const cli = `#!/usr/bin/env node
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(path.join(log, 'npm-argv'))}, process.cwd() + '\\t' + process.argv.slice(2).join(' ') + '\\n');
if (process.argv[2] === 'ci') fs.mkdirSync('node_modules/.fixture-ci', { recursive: true });
`;
  writeFileSync(path.join(pkg, 'bin', 'npm-cli.js'), cli, { mode: 0o755 });
  writeFileSync(path.join(pkg, 'bin', 'npx-cli.js'), cli, { mode: 0o755 });
  const out = path.join(dir, `npm-${version}.tgz`);
  run('tar', ['-czf', out, '-C', path.dirname(pkg), 'package']);
  return readFileSync(out);
}

/** A stored (uncompressed) zip with unix modes, the shape `unzip` restores. */
function zipStore(entries: readonly { name: string; data: Buffer; mode: number }[]): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer): number => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const c = crc(e.data);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(0, 6); l.writeUInt16LE(0, 8); l.writeUInt16LE(0, 10);
    l.writeUInt16LE(0x21, 12); l.writeUInt32LE(c, 14); l.writeUInt32LE(e.data.length, 18); l.writeUInt32LE(e.data.length, 22);
    l.writeUInt16LE(name.length, 26); l.writeUInt16LE(0, 28);
    const g = Buffer.alloc(46);
    g.writeUInt32LE(0x02014b50, 0); g.writeUInt16LE((3 << 8) | 20, 4); g.writeUInt16LE(20, 6); g.writeUInt16LE(0, 8); g.writeUInt16LE(0, 10);
    g.writeUInt16LE(0, 12); g.writeUInt16LE(0x21, 14); g.writeUInt32LE(c, 16); g.writeUInt32LE(e.data.length, 20); g.writeUInt32LE(e.data.length, 24);
    g.writeUInt16LE(name.length, 28); g.writeUInt16LE(0, 30); g.writeUInt16LE(0, 32); g.writeUInt16LE(0, 34); g.writeUInt16LE(0, 36);
    g.writeUInt32LE(((0o100000 | e.mode) << 16) >>> 0, 38); g.writeUInt32LE(off, 42);
    locals.push(l, name, e.data);
    centrals.push(g, name);
    off += 30 + name.length + e.data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const chromeZip = (version: string): Buffer => zipStore([
  { name: 'chrome-linux64/chrome', data: Buffer.from(`#!/bin/sh\necho "Google Chrome for Testing ${version}"\n`), mode: 0o755 },
  { name: 'chrome-linux64/deb.deps', data: Buffer.from('libnss3\nlibgbm1\n'), mode: 0o644 },
]);

/** A fixture CA-signed certificate for the two download hosts. */
function fixtureCert(dir: string): { key: Buffer; cert: Buffer; certFile: string } {
  const cfg = path.join(dir, 'openssl.cnf');
  writeFileSync(cfg, [
    '[req]', 'distinguished_name = dn', 'x509_extensions = v3', 'prompt = no', '[dn]', 'CN = fixture download hosts',
    '[v3]', 'subjectAltName = DNS:nodejs.org, DNS:storage.googleapis.com', 'basicConstraints = critical, CA:TRUE',
    'keyUsage = critical, digitalSignature, keyCertSign', 'extendedKeyUsage = serverAuth', '',
  ].join('\n'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-config', cfg]);
  return { key: readFileSync(key), cert: readFileSync(cert), certFile: cert };
}

// ---------------------------------------------------------------------------------------------------------------
// The shared fixture world (built once): artifacts, hosts, the bootstrap tree.
// ---------------------------------------------------------------------------------------------------------------

interface World {
  readonly dir: string;
  readonly log: string;
  readonly hostA: Host; readonly hostB: Host; readonly hostC: Host; readonly dl: Host; readonly registry: Host;
  readonly newRel: Release; readonly otherRel: Release;
  readonly bootTree: string;
  readonly certFile: string;
  readonly nodeNew: Buffer; readonly chrome: Buffer;
}
let W: World;

beforeAll(async () => {
  const dir = mkTmp('ccrc-tb-tools-world-');
  const log = path.join(dir, 'log');
  mkdirSync(log);
  const art = path.join(dir, 'art');
  mkdirSync(art);
  const bootPayload = releaseTree(art, BOOT_TAG, 'b'.repeat(40));
  const newRel = packRelease(art, releaseTree(art, NEW_TAG, 'a'.repeat(40)), NEW_TAG, 'a'.repeat(40));
  const otherRel = packRelease(art, releaseTree(art, NEW_TAG, 'c'.repeat(40)), NEW_TAG, 'c'.repeat(40));
  // The bootstrap's installed tree (D-7424): a release tree. Its server/ production dependencies are not installed
  // here (the agent package's CI leg installs only agent/), so the real verifier under it cannot run.
  const bootTree = path.join(dir, 'boot-tree');
  cpSync(bootPayload, bootTree, { recursive: true });
  const nodeNew = nodeTarball(art, NEW.node, log);
  const chrome = chromeZip(NEW.chrome);
  const { key, cert, certFile } = fixtureCert(art);
  const dlState = { log: [] as string[], files: new Map<string, Buffer>() };
  const dl = await listen(createHttpsServer({ key, cert }, handler(dlState)), dlState);
  dl.files.set(`/dist/v${NEW.node}/node-v${NEW.node}-linux-x64.tar.xz`, nodeNew);
  dl.files.set(`/dist/v${NEW.node}/SHASUMS256.txt`, Buffer.from(`${'0'.repeat(64)}  node-v${NEW.node}-darwin-arm64.tar.gz\n${sha256(nodeNew)}  node-v${NEW.node}-linux-x64.tar.xz\n`));
  dl.files.set(`/chrome-for-testing-public/${NEW.chrome}/linux64/chrome-linux64.zip`, chrome);
  dl.files.set('/dist/probe', Buffer.from('reached the fixture\n'));
  const registry = await httpHost();
  const npmTgz = npmTarball(art, NEW.npm, log);
  registry.files.set(`/npm/-/npm-${NEW.npm}.tgz`, npmTgz);
  registry.files.set('/npm', Buffer.from(JSON.stringify({
    name: 'npm', versions: { [NEW.npm]: { dist: {
      integrity: `sha512-${createHash('sha512').update(npmTgz).digest('base64')}`, tarball: `http://127.0.0.1:${registry.port}/npm/-/npm-${NEW.npm}.tgz`,
    } } },
  })));
  W = { dir, log, hostA: await httpHost(), hostB: await httpHost(), hostC: await httpHost(), dl, registry, newRel, otherRel, bootTree, certFile, nodeNew, chrome };
  serveRelease(W.hostA, newRel);
  serveRelease(W.hostB, otherRel);
  serveRelease(W.hostC, otherRel);
}, 120_000);

afterAll(async () => {
  for (const h of [W?.hostA, W?.hostB, W?.hostC, W?.dl, W?.registry]) await h?.close();
});

// ---------------------------------------------------------------------------------------------------------------
// One fixture box: <tools> as the bootstrap leaves it, the box file, root's home and the unit's environment.
// ---------------------------------------------------------------------------------------------------------------

interface Box {
  readonly root: string; readonly tools: string; readonly home: string; readonly bin: string; readonly spec: string;
  readonly boxFile: string; readonly env: NodeJS.ProcessEnv; readonly script: string;
}

const stub = (file: string, body: string): void => writeFileSync(file, body, { mode: 0o755 });

function makeBox(o: { ownTree?: boolean } = {}): Box {
  const fx = mkTmp('ccrc-tb-tools-');
  const root = path.join(fx, 'root');
  const tools = path.join(fx, 'tools');
  const home = path.join(fx, 'home');
  const bin = path.join(fx, 'bin');
  for (const d of [path.join(root, 'etc', 'ccrc-testbox'), path.join(tools, 'release'), path.join(tools, 'sets', 's.bootstrap'), home, bin, path.join(fx, 'specs')]) mkdirSync(d, { recursive: true });
  // The bootstrap (D-7424): node at <tools>/node/<v>, a set holding only node, current naming it, the installed tree.
  const nodeDir = path.join(tools, 'node', BOOT_NODE);
  mkdirSync(path.join(nodeDir, 'bin'), { recursive: true });
  writeFileSync(path.join(nodeDir, 'bin', 'node'), nodeShim(BOOT_NODE, W.log), { mode: 0o755 });
  symlinkSync(`../../node/${BOOT_NODE}/bin/node`, path.join(tools, 'sets', 's.bootstrap', 'node'));
  symlinkSync('sets/s.bootstrap', path.join(tools, 'current'));
  if (o.ownTree === true) cpSync(W.bootTree, path.join(tools, 'release', BOOT_TAG), { recursive: true, verbatimSymlinks: true });
  else symlinkSync(W.bootTree, path.join(tools, 'release', BOOT_TAG));
  symlinkSync(BOOT_TAG, path.join(tools, 'release', 'installed'));
  // The box's one config file names release host A (D-7451); root's home ccrc.env names host B; the unit's
  // environment names host C. B and C serve another build of the same tag.
  const boxFile = path.join(root, 'etc', 'ccrc-testbox', 'ccrc.env');
  writeFileSync(boxFile, `CCRC_RELEASE_BASE_URL=http://127.0.0.1:${W.hostA.port}/releases\n`, { mode: 0o640 });
  chmodSync(boxFile, 0o640);
  mkdirSync(path.join(home, '.ccrc'));
  writeFileSync(path.join(home, '.ccrc', 'ccrc.env'), `CCRC_RELEASE_BASE_URL=http://127.0.0.1:${W.hostB.port}/releases\n`);
  // Root's .curlrc: the two download hosts are the fixture's HTTPS server, under the fixture CA.
  writeFileSync(path.join(home, '.curlrc'), [
    `connect-to = nodejs.org:443:127.0.0.1:${W.dl.port}`, `connect-to = storage.googleapis.com:443:127.0.0.1:${W.dl.port}`,
    `cacert = ${W.certFile}`, '',
  ].join('\n'));
  // The OS package manager: answers from fixture files, records its argv.
  stub(path.join(bin, 'apt-get'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${path.join(fx, 'apt-argv')}'\n[ -f '${path.join(fx, 'apt-fail')}' ] && [ "$1" != update ] && case "$*" in *install*) exit 100 ;; esac\nexit 0\n`);
  mkdirSync(path.join(fx, 'madison'));
  for (const [p, l] of Object.entries(MADISON)) writeFileSync(path.join(fx, 'madison', p), l);
  stub(path.join(bin, 'apt-cache'), `#!/bin/sh\nfor a in "$@"; do last="$a"; done\n[ -f '${path.join(fx, 'madison')}/'"$last" ] && cat '${path.join(fx, 'madison')}/'"$last"\nexit 0\n`);
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: home, LANG: 'C', TMPDIR: process.env.TMPDIR ?? '/tmp',
    TB_FIXTURE_ROOT: root, TB_FIXTURE_OWNER_UID: String(UID),
    CCRC_RELEASE_BASE_URL: `http://127.0.0.1:${W.hostC.port}/releases`,
  };
  return { root, tools, home, bin, spec: path.join(fx, 'specs', 'tools'), boxFile, env, script: path.join(tools, 'release', 'installed', 'deploy', 'testbox', 'bin', 'tools-sync') };
}

function writeToolsSpec(b: Box, f: ToolsSync, keep: string[] = []): void {
  writeFileSync(b.spec, encodeToolsSpec({ toolsDir: b.tools, frame: f, settings: { ...TS, proxy: `127.0.0.1:${W.registry.port}` }, keep }));
}
interface Ran { code: number; stdout: string; stderr: string }
/** A child run without blocking this process, whose fixture servers must answer it. */
function exec(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const c = spawn(file, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    c.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => c.kill('SIGKILL'), 120_000);
    c.on('error', reject);
    c.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}
function sync(b: Box, f: ToolsSync = frameOf(NEW_TAG), keep: string[] = []): Promise<Ran> {
  writeToolsSpec(b, f, keep);
  return exec(b.script, [b.spec], b.env);
}
const linkOf = (p: string): string => readlinkSync(p);
const report = (b: Box): ReturnType<typeof parseReport> => parseReport(existsSync(path.join(b.tools, 'sync-report')) ? readFileSync(path.join(b.tools, 'sync-report'), 'utf8') : null);
const resetLogs = (): void => {
  for (const h of [W.hostA, W.hostB, W.hostC, W.dl, W.registry]) h.log.length = 0;
  for (const f of ['verify-argv', 'verify-mode', 'npm-argv']) rmSync(path.join(W.log, f), { force: true });
};
const verifyMode = (m: string): void => writeFileSync(path.join(W.log, 'verify-mode'), `${m}\n`);
const builtSha = (b: Box): string => (JSON.parse(readFileSync(path.join(b.tools, 'release', 'installed', 'build.json'), 'utf8')) as { sha: string }).sha;

/** `current` and the installed release are the bootstrap's, and nothing was installed for the new versions. */
function expectUnchanged(b: Box): void {
  expect(linkOf(path.join(b.tools, 'current'))).toBe('sets/s.bootstrap');
  expect(linkOf(path.join(b.tools, 'release', 'installed'))).toBe(BOOT_TAG);
  expect(readdirSync(path.join(b.tools, 'sets'))).toEqual(['s.bootstrap']);
  expect(existsSync(path.join(b.tools, 'release', NEW_TAG))).toBe(false);
  expect(existsSync(path.join(b.tools, 'takeover'))).toBe(false);
}

describe('fixture containment', () => {
  it('root\'s fixture .curlrc takes the download hosts to the fixture server, under the fixture CA (else no row may run)', async () => {
    const b = makeBox();
    resetLogs();
    const r = await exec('curl', ['-fsS', '--max-time', '20', '--proto', '=https', 'https://nodejs.org/dist/probe'], b.env);
    expect(r.stdout, r.stderr).toBe('reached the fixture\n');
    expect(W.dl.log).toEqual(['/dist/probe']);
  });
});

describe('tools-sync on a fixture box laid out as TB7\'s bootstrap leaves it (D-7424)', () => {
  it('verifies the release under the bootstrap node, installs the versions, fills current and switches it and the installed release', async () => {
    const b = makeBox();
    resetLogs();
    const r = await sync(b);
    expect(r.code, r.stderr).toBe(0);
    // 1. The release, from the box file's host, verified by the INSTALLED tree's verifier under <tools>/current/node.
    expect(W.hostA.log).toEqual([`/releases/download/${NEW_TAG}/SHA256SUMS`, `/releases/download/${NEW_TAG}/ccrc-${NEW_TAG}.tar.gz`, `/releases/download/${NEW_TAG}/ccrc-${NEW_TAG}.tar.gz.sigstore.json`]);
    const v = readFileSync(path.join(W.log, 'verify-argv'), 'utf8').trim().split('\n');
    expect(v).toHaveLength(1);
    const [ranUnder, argv] = v[0]!.split('\t');
    expect(ranUnder).toBe(BOOT_NODE);
    expect(argv).toContain(`${path.join(b.tools, 'release', 'installed', 'ccd')}/../deploy/verify-provenance.mjs`);
    expect(argv).toMatch(new RegExp(`--blob \\S+/ccrc-${reEscape(NEW_TAG)}\\.tar\\.gz --bundle \\S+\\.sigstore\\.json --tag ${reEscape(NEW_TAG)} --owner \\S+ --repo \\S+$`));
    expect(argv).not.toContain('allow-unsigned');
    expect(builtSha(b)).toBe('a'.repeat(40));
    // 2. node, with the root-owned npmrc's three lines (spec §2.2).
    const nodeDir = path.join(b.tools, 'node', NEW.node);
    expect(readFileSync(path.join(nodeDir, 'etc', 'npmrc'), 'utf8')).toBe(`registry=http://127.0.0.1:${W.registry.port}/\ncache=\${HOME}/.npm\nnodedir=${nodeDir}\n`);
    expect(existsSync(path.join(nodeDir, 'include', 'node', 'node.h'))).toBe(true);
    // 3. npm through the proxy.
    expect(W.registry.log).toEqual(['/npm', `/npm/-/npm-${NEW.npm}.tgz`]);
    expect((JSON.parse(readFileSync(path.join(nodeDir, 'lib', 'node_modules', 'npm', 'package.json'), 'utf8')) as { version: string }).version).toBe(NEW.npm);
    // 4. Chrome, with its libraries from the OS mirror; the download's sha256 in the report (D-7422).
    expect(W.dl.log).toEqual([`/dist/v${NEW.node}/SHASUMS256.txt`, `/dist/v${NEW.node}/node-v${NEW.node}-linux-x64.tar.xz`, `/chrome-for-testing-public/${NEW.chrome}/linux64/chrome-linux64.zip`]);
    expect(report(b).chromeSha256).toBe(sha256(W.chrome));
    // 5. The OS packages at the measured versions, through the package manager.
    const apt = readFileSync(path.join(path.dirname(b.root), 'apt-argv'), 'utf8').trim().split('\n');
    expect(apt).toEqual(['-q update', '-q install -y --no-install-recommends libnss3 libgbm1',
      '-q install -y --no-install-recommends --allow-downgrades python3=3.12.3-0ubuntu2 git=1:2.43.0-1ubuntu7 tmux=3.4-1ubuntu0.1 strace jq']);
    // 6. The set, the release's server/ production dependencies, the two switches and the takeover file.
    const set = linkOf(path.join(b.tools, 'current'));
    expect(set).toMatch(/^sets\/s\.[A-Za-z0-9]{8}$/);
    expect(realpathSync(path.join(b.tools, 'current', 'node'))).toBe(realpathSync(path.join(nodeDir, 'bin', 'node')));
    expect(realpathSync(path.join(b.tools, 'current', 'chrome'))).toBe(realpathSync(path.join(b.tools, 'chrome', NEW.chrome, 'chrome-linux64', 'chrome')));
    expect(parseVersions(readFileSync(path.join(b.tools, 'current', 'versions'), 'utf8'))).toEqual(NEW);
    expect(linkOf(path.join(b.tools, 'release', 'installed'))).toBe(NEW_TAG);
    expect(readFileSync(path.join(W.log, 'npm-argv'), 'utf8').trim().split('\n').at(-1)).toMatch(/\/release\/\.stage\.[^/]+\/tree\/server\tci --omit=dev --ignore-scripts --no-audit --no-fund$/);
    expect(existsSync(path.join(b.tools, 'release', NEW_TAG, 'server', 'node_modules', '.fixture-ci'))).toBe(true);
    expect((lstatSync(path.join(b.tools, 'release', NEW_TAG, 'ccd', 'ccrc')).mode & 0o022)).toBe(0);
    expect(readFileSync(path.join(b.tools, 'takeover'), 'utf8')).toBe(`previous\t${BOOT_TAG}\nrelease\t${NEW_TAG}\n`);
    expect(report(b)).toMatchObject({ result: 'ok', release: NEW_TAG, takeover: true, nodeChanged: true });
    // The release the takeover replaced stays until the takeover has ended, then goes; the bootstrap set is kept.
    expect(existsSync(path.join(b.tools, 'release', BOOT_TAG))).toBe(true);
    expect(readdirSync(path.join(b.tools, 'sets')).sort()).toEqual(['s.bootstrap', set.slice('sets/'.length)].sort());
    const done = await exec(b.script, ['--takeover-ended'], b.env);
    expect(done.code, done.stderr).toBe(0);
    expect(existsSync(path.join(b.tools, 'release', BOOT_TAG))).toBe(false);
    expect(existsSync(path.join(b.tools, 'takeover'))).toBe(false);
  });

  it('a second sync of the same release and versions changes nothing and contacts no host', async () => {
    const b = makeBox();
    resetLogs();
    expect((await sync(b)).code).toBe(0);
    const before = { current: linkOf(path.join(b.tools, 'current')), sets: readdirSync(path.join(b.tools, 'sets')).sort() };
    const aptBefore = readFileSync(path.join(path.dirname(b.root), 'apt-argv'), 'utf8');
    resetLogs();
    const r = await sync(b);
    expect(r.code, r.stderr).toBe(0);
    expect(report(b).result).toBe('noop');
    expect(linkOf(path.join(b.tools, 'current'))).toBe(before.current);
    expect(readdirSync(path.join(b.tools, 'sets')).sort()).toEqual(before.sets);
    expect([W.hostA.log, W.hostB.log, W.hostC.log, W.dl.log, W.registry.log]).toEqual([[], [], [], [], []]);
    expect(readFileSync(path.join(path.dirname(b.root), 'apt-argv'), 'utf8')).toBe(aptBefore);
  });

  it('a sync of the installed release with other versions fetches no release, switches current and starts no takeover', async () => {
    const b = makeBox();
    resetLogs();
    const r = await sync(b, frameOf(BOOT_TAG));
    expect(r.code, r.stderr).toBe(0);
    expect([W.hostA.log, W.hostB.log, W.hostC.log]).toEqual([[], [], []]);
    expect(linkOf(path.join(b.tools, 'release', 'installed'))).toBe(BOOT_TAG);
    expect(linkOf(path.join(b.tools, 'current'))).not.toBe('sets/s.bootstrap');
    expect(existsSync(path.join(b.tools, 'takeover'))).toBe(false);
    expect(report(b)).toMatchObject({ result: 'ok', takeover: false, nodeChanged: true });
  });

  it('a run\'s and a pristine install\'s PATH start at a directory holding the synced node, npm and npx (spec.ts reads <tools>/current/bin)', async () => {
    const b = makeBox();
    resetLogs();
    const r = await sync(b, frameOf(BOOT_TAG));
    expect(r.code, r.stderr).toBe(0);
    const s: SpecSettings = {
      root: path.join(path.dirname(b.root), 'svc'), workers: 1, runTmpdir: '/tmp', toolsDir: b.tools, envForward: [],
      runUserPrefix: 'ccrc-tb-', reportMaxBytes: 1024, serviceUser: 'ccrc-tb-svc',
    };
    const built = buildRunSpec(SPEC_SUBMIT, SPEC_ROW, 1, s, path.join(b.tools, 'current', 'chrome'));
    expect(built.ok).toBe(true);
    const pre = path.join(b.tools, 'node', NEW.node);
    for (const env of [built.ok ? built.spec.env : [], buildInstallSpec('k1', 'server', [], [], s).env]) {
      const first = (env.find(([k]) => k === 'PATH')?.[1] ?? '').split(':')[0]!;
      expect(realpathSync(path.join(first, 'node'))).toBe(realpathSync(path.join(pre, 'bin', 'node')));
      expect(realpathSync(path.join(first, 'npm'))).toBe(realpathSync(path.join(pre, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')));
      expect(realpathSync(path.join(first, 'npx'))).toBe(realpathSync(path.join(pre, 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js')));
    }
    // D-7424's verifier PATH and the set's Chrome stay where they were: `<tools>/current/node` and `<tools>/current/chrome`.
    expect(realpathSync(path.join(b.tools, 'current', 'node'))).toBe(realpathSync(path.join(pre, 'bin', 'node')));
  });
});

describe('a release that fails its verification leaves current and the installed release unchanged (§Review focus 8)', () => {
  const failsWith = async (b: Box, re: RegExp): Promise<Ran> => {
    const r = await sync(b);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/tool sync failed \(release: /);
    expect(r.stderr).toMatch(re);
    expectUnchanged(b);
    expect(report(b)).toMatchObject({ result: 'failed', tool: 'release' });
    expect(W.dl.log, 'nothing was downloaded after the release failed').toEqual([]);
    return r;
  };
  const withRelease = (o: Parameters<typeof serveRelease>[2]): void => { serveRelease(W.hostA, W.newRel, o); };
  const restore = (): void => {
    W.hostA.files.clear();
    serveRelease(W.hostA, W.newRel);
  };

  it('a bundle naming another workflow is refused by the installed tree\'s verifier (exit 1, a refusal)', async () => {
    const b = makeBox();
    resetLogs();
    W.hostA.files.clear(); withRelease({ bundle: 'third' });
    verifyMode('third');
    try { await failsWith(b, /provenance verification FAILED for ccrc-v0\.0\.2\.tar\.gz/); } finally { restore(); }
    expect(readFileSync(path.join(W.log, 'verify-argv'), 'utf8').split('\t')[0]).toBe(BOOT_NODE);
  });

  it('an absent bundle (404) is refused: the box never passes --allow-unsigned', async () => {
    const b = makeBox();
    resetLogs();
    W.hostA.files.clear(); withRelease({ bundle: 'absent' });
    try { await failsWith(b, /the release ships no provenance bundle .*answered 404/); } finally { restore(); }
    expect(existsSync(path.join(W.log, 'verify-argv'))).toBe(false);
  });

  it('a tarball not matching SHA256SUMS is refused before anything is extracted or verified', async () => {
    const b = makeBox();
    resetLogs();
    W.hostA.files.clear(); withRelease({ tamper: true });
    try { await failsWith(b, /checksum verification FAILED for ccrc-v0\.0\.2\.tar\.gz/); } finally { restore(); }
    expect(existsSync(path.join(W.log, 'verify-argv'))).toBe(false);
  });

  it('a verifier that cannot run (its dependencies missing beside the installed tree) is could-not-run, not a refusal', async () => {
    const b = makeBox();
    expect(existsSync(path.join(b.tools, 'release', 'installed', 'server', 'node_modules'))).toBe(false);
    resetLogs();
    verifyMode('real');
    const r = await failsWith(b, /could not RUN the installed verifier \(.*exited 3\) - this is not a verdict on the bundle/);
    expect(r.stderr).not.toMatch(/provenance verification FAILED/);
  });
});

describe('a tool that fails leaves current and the installed release unchanged', () => {
  it('a node tarball not matching SHASUMS256.txt fails the sync (node: checksum mismatch)', async () => {
    const b = makeBox();
    resetLogs();
    const key = `/dist/v${NEW.node}/SHASUMS256.txt`;
    const good = W.dl.files.get(key)!;
    W.dl.files.set(key, Buffer.from(`${'1'.repeat(64)}  node-v${NEW.node}-linux-x64.tar.xz\n`));
    let r: Ran;
    try { r = await sync(b); } finally { W.dl.files.set(key, good); }
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/tool sync failed \(node: checksum mismatch for node-v22\.1\.0-linux-x64\.tar\.xz/);
    expectUnchanged(b);
    expect(existsSync(path.join(b.tools, 'node', NEW.node))).toBe(false);
    expect(report(b)).toMatchObject({ result: 'failed', tool: 'node' });
  });

  it('an OS mirror without the measured version fails the sync (tmux: the OS mirror has no tmux 3.4)', async () => {
    const b = makeBox();
    writeFileSync(path.join(path.dirname(b.root), 'madison', 'tmux'), 'tmux | 3.3a-1 | http://mirror.testbox.invalid noble/main amd64 Packages\n');
    resetLogs();
    const r = await sync(b);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/tool sync failed \(tmux: the OS mirror has no tmux 3\.4\)/);
    expectUnchanged(b);
    expect(readFileSync(path.join(path.dirname(b.root), 'apt-argv'), 'utf8')).not.toMatch(/python3=/);
  });

  it('a spec naming another tools directory, or a value not its format, is refused before anything is fetched', async () => {
    const b = makeBox();
    resetLogs();
    writeFileSync(b.spec, encodeToolsSpec({ toolsDir: '/opt/elsewhere', frame: frameOf(NEW_TAG), settings: TS, keep: [] }));
    const r1 = await exec(b.script, [b.spec], b.env);
    expect(r1.code).toBe(1);
    expect(r1.stderr).toMatch(/tool sync failed \(spec: the spec names the tools directory \/opt\/elsewhere/);
    const r2 = await sync(b, frameOf(NEW_TAG, { ...NEW, node: '22.1.0; rm' }));
    expect(r2.stderr).toMatch(/tool sync failed \(spec: not a node version/);
    expectUnchanged(b);
    expect([W.hostA.log, W.dl.log, W.registry.log]).toEqual([[], [], []]);
  });
});

describe('the release base is the box file\'s (D-7457)', () => {
  it('with the unit environment and root\'s home ccrc.env naming two other hosts, the sync resolves and fetches from the box file\'s host only', async () => {
    const b = makeBox();
    resetLogs();
    const r = await sync(b);
    expect(r.code, r.stderr).toBe(0);
    expect(W.hostA.log.length).toBe(3);
    expect(W.hostB.log, 'root\'s home ccrc.env was read').toEqual([]);
    expect(W.hostC.log, 'the unit\'s environment was read').toEqual([]);
    expect(builtSha(b)).toBe('a'.repeat(40));
  });

  it.each([
    ['writable by group or other', (b: Box): void => chmodSync(b.boxFile, 0o666), /is writable by group or other/],
    ['owned by another user', (b: Box): void => { b.env['TB_FIXTURE_OWNER_UID'] = String(UID + 1); }, new RegExp(`is owned by uid ${UID}, not uid ${UID + 1}`)],
    ['not there', (b: Box): void => rmSync(b.boxFile), /is not there/],
  ])('a box file %s fails the sync with current unchanged and no request to any host', async (_n, spoil, why) => {
    const b = makeBox();
    spoil(b);
    resetLogs();
    const r = await sync(b);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/tool sync failed \(release: /);
    expect(r.stderr).toMatch(why);
    expectUnchanged(b);
    expect([W.hostA.log, W.hostB.log, W.hostC.log, W.dl.log, W.registry.log]).toEqual([[], [], [], [], []]);
  });

  // Mutations of the installed tree's ccd/testbox-knobs: each reds the box-file row above.
  it.each([
    ['the value is not assigned to the script\'s CCRC_RELEASE_BASE_URL', '  CCRC_RELEASE_BASE_URL="$KNOB"\n}', '  :\n}'],
    ['the box file is read in environment mode', '_upd_release_base file >/dev/null', '_upd_release_base >/dev/null'],
  ])('mutation: %s, and the unit environment\'s host is read', async (_n, from, to) => {
    const b = makeBox({ ownTree: true });
    const knobs = path.join(b.tools, 'release', BOOT_TAG, 'ccd', 'testbox-knobs');
    const text = readFileSync(knobs, 'utf8');
    expect(text.split(from).length, 'the mutation applies once').toBe(2);
    writeFileSync(knobs, text.replace(from, to));
    resetLogs();
    await sync(b);
    expect(W.hostC.log.length, 'the environment\'s host was contacted').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The driver, against the script.
// ---------------------------------------------------------------------------------------------------------------

/** The system manager's seam: `ccrc-testbox-tools.service` is the script run with the service's spec. */
function fakeSys(b: Box, specFile: string, seen: string[], beforeUnit?: (n: number) => void | Promise<void>): SystemManager {
  return {
    async run(unit: string): Promise<UnitEnd> {
      seen.push(unit);
      await beforeUnit?.(seen.length);
      const r = await exec(b.script, [specFile], b.env);
      return { exit: r.code < 0 ? 255 : r.code, result: r.code === 0 ? 'success' : 'exit-code' };
    },
    async stop() { /* no unit to stop */ },
    async active() { return false; },
  };
}
const okStatus = (): StatusAnswer => ({ t: 'status', state: 'ok', reason: null, serviceVersion: '0.0.1', proto: 1, release: BOOT_TAG, tools: NEW,
  sync: IDLE_TOOLS.sync, runs: { inProgress: 1, limit: 2 }, queueDepth: 0, pristine: [], failedKeys: [], heldRunUsers: [], repositories: [] });

const [Q1, Q2, Q3] = ['1'.repeat(32), '2'.repeat(32), '3'.repeat(32)];
const submitOf = (runId: string): RunSubmit => ({ ...SPEC_SUBMIT, runId });
const [CHROME_2, CHROME_3] = ['131.0.6778.86', '131.0.6778.87'];
/** The entry point's settings for a service on a fixture box (no repository rows, nothing it would start). */
const cfgFor = (b: Box): TestboxConfig => ({
  runs: 1, sessionRuns: 1, workers: 1, runTmpdir: '/tmp', root: path.join(path.dirname(b.root), 'svc'), repos: path.join(path.dirname(b.root), 'no-repos'),
  fetchEveryMs: 60_000, retentionMs: 3_600_000, reportMaxBytes: 1024, toolsDir: b.tools, envForward: [], runUserPrefix: 'ccrc-tb-', logTail: 5,
  serviceUser: 'ccrc-tb-svc', listen: { host: '127.0.0.1', port: 0 }, tokenFile: path.join(b.root, 'no-token'), unitMaxMs: 60_000,
  lines: new Map([...SETTINGS_LINES, ['CCRC_TESTBOX_PRISTINE_KEEP', { value: '7d' }]]) as unknown as TestboxConfig['lines'],
});

function driver(b: Box, o: { live?: string[]; now?: () => number; beforeUnit?: (n: number) => void | Promise<void> } = {}) {
  const svcRoot = path.join(path.dirname(b.root), 'svc');
  const units: string[] = [];
  const exits: number[] = [];
  let ticks = 0;
  let release: () => void = () => undefined;
  const idle = new Promise<void>((r) => { release = r; });
  const live = o.live ?? [];
  const waiting: string[] = [];
  const submitted: { f: RunSubmit; conn: { send(f: unknown): void; refuse(r: string): void } }[] = [];
  const served: ServedService = {
    status: okStatus, idle: () => idle, tick: async () => { ticks++; }, liveRuns: () => live, waiting: () => waiting,
    submit: (f, conn) => { submitted.push({ f, conn }); },
  };
  const t = new ToolSync({
    sys: fakeSys(b, path.join(svcRoot, 'specs', 'tools'), units, o.beforeUnit), root: svcRoot, toolsDir: b.tools,
    settings: { ...TS, proxy: `127.0.0.1:${W.registry.port}` }, now: o.now ?? (() => 1_000), exit: (c) => { exits.push(c); },
  });
  t.serve(served);
  return { t, units, exits, ticks: () => ticks, release: () => release(), live, waiting, submitted, svcRoot };
}

describe('toolsync.ts: the driver (D-7408, D-7426)', () => {
  it('a run started before the sync keeps its old paths; current is switched before the new service takes over, which waits for the run', async () => {
    const b = makeBox();
    const d = driver(b, { live: ['r1'] });
    // One run waits in the queue when the sync starts (D-7426: queued runs wait for the new service); its log
    // directory is the empty one a submission makes.
    d.t.noteSubmit(submitOf(Q1));
    d.waiting.push(Q1);
    mkdirSync(path.join(d.svcRoot, 'logs', Q1), { recursive: true });
    // The run resolved the tool set when its prepare started.
    await d.t.tick();
    const oldNode = realpathSync(path.join(b.tools, 'current', 'node'));
    resetLogs();
    const p = d.t.request(frameOf(NEW_TAG));
    await new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < 600 && d.units.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    // Until the run ends, the takeover waits: current already names the new set, the old node is still there.
    for (let i = 0; i < 1200 && !existsSync(path.join(b.tools, 'takeover')); i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 50));
    expect(d.exits).toEqual([]);
    expect(d.t.runLimit(2), 'the takeover admits no run').toBe(0);
    expect(linkOf(path.join(b.tools, 'release', 'installed'))).toBe(NEW_TAG);
    expect(realpathSync(path.join(b.tools, 'current', 'node'))).not.toBe(oldNode);
    expect(existsSync(oldNode), 'the run\'s node is kept while it runs').toBe(true);
    expect(readFileSync(path.join(d.svcRoot, 'specs', 'tools'), 'utf8').split('\0')).toContain('Ks.bootstrap');
    // A submission during the takeover queues behind the first, since the run limit is 0.
    d.t.noteSubmit(submitOf(Q2));
    d.waiting.push(Q2);
    expect(existsSync(path.join(d.svcRoot, HANDOVER_DIR)), 'nothing is handed over while a run is in progress').toBe(false);
    d.release();
    await p;
    expect(d.exits).toEqual([0]);
    expect(d.units).toEqual(['ccrc-testbox-tools.service']);
    // The queued runs are handed to the next service in their queue order, and their empty log directories go, so the
    // next service takes each id afresh.
    const handed = readdirSync(path.join(d.svcRoot, HANDOVER_DIR)).sort();
    expect(handed.map((n) => n.replace(/^[0-9]+-[0-9]+-/, ''))).toEqual([`${Q1}.json`, `${Q2}.json`]);
    expect(existsSync(path.join(d.svcRoot, 'logs', Q1))).toBe(false);
    // The next service (another driver on the same root) queues them at its start, in that order, and removes them.
    const next = driver(b);
    expect(next.t.resume()).toBe(2);
    expect(next.submitted.map((x) => x.f)).toEqual([submitOf(Q1), submitOf(Q2)]);
    expect(readdirSync(path.join(d.svcRoot, HANDOVER_DIR))).toEqual([]);
    expect(next.t.resume(), 'a second start queues nothing again').toBe(0);
  }, 180_000);

  it('a handed-over file that does not read as a run.submit is dropped, never queued', async () => {
    const b = makeBox();
    const d = driver(b);
    const dir = path.join(d.svcRoot, HANDOVER_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `000000000000001-000001-${Q1}.json`), '{"t":"run.cancel","runId":"' + Q1 + '"}\n');
    writeFileSync(path.join(dir, `000000000000001-000002-${Q2}.json`), 'not json\n');
    writeFileSync(path.join(dir, `000000000000001-000003-${Q3}.json`), `${JSON.stringify(submitOf(Q3))}\n`);
    expect(d.t.resume()).toBe(1);
    expect(d.submitted.map((x) => x.f.runId)).toEqual([Q3]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('the WebSocket door notes each run.submit for the driver attached to the service, before the service takes it', async () => {
    const b = makeBox();
    const d = driver(b);
    const svc = { status: okStatus, submit: (f: RunSubmit) => { d.waiting.push(f.runId); } } as unknown as TestboxService;
    attachToolSync(svc, d.t);
    const srv = await startTestboxServer({ host: '127.0.0.1', port: 0, token: 'tok', service: svc });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`);
      const frames: string[] = [];
      ws.on('message', (m) => frames.push(m.toString()));
      await new Promise<void>((r, j) => { ws.once('open', () => r()); ws.once('error', j); });
      ws.send(JSON.stringify({ t: 'hello', token: 'tok' }));
      await expect.poll(() => frames.length).toBe(1);
      ws.send(JSON.stringify(submitOf(Q1)));
      await expect.poll(() => d.waiting.length).toBe(1);
      expect(d.t.queuedFrames()).toEqual([submitOf(Q1)]);
      ws.close();
    } finally {
      await srv.close();
    }
  });

  it('a run\'s Chrome is the current set\'s when its prepare starts: after two Chrome-only syncs it names the newest, which exists', async () => {
    const b = makeBox();
    for (const v of [CHROME_2, CHROME_3]) W.dl.files.set(`/chrome-for-testing-public/${v}/linux64/chrome-linux64.zip`, chromeZip(v));
    const d = driver(b);
    // The entry point's service, built before any sync: its Chrome is read for each prepare, not once at its start.
    const svc = serviceFor(cfgFor(b), path.join(b.tools, 'release', 'installed'), () => undefined);
    const chromeOf = (): string => (svc as unknown as { d: { chrome: string } }).d.chrome;
    const chromeAt = (v: string): string => realpathSync(path.join(b.tools, 'chrome', v, 'chrome-linux64', 'chrome'));
    await d.t.request(frameOf(BOOT_TAG));
    expect(chromeOf()).toBe(chromeAt(NEW.chrome));
    await d.t.request(frameOf(BOOT_TAG, { ...NEW, chrome: CHROME_2 }));
    await d.t.request(frameOf(BOOT_TAG, { ...NEW, chrome: CHROME_3 }));
    expect(d.units).toHaveLength(3);
    expect(d.exits, 'a Chrome-only sync starts no takeover').toEqual([]);
    expect(chromeOf()).toBe(chromeAt(CHROME_3));
    expect(d.t.chrome()).toBe(chromeOf());
    expect(existsSync(chromeOf())).toBe(true);
    expect(existsSync(path.join(b.tools, 'chrome', NEW.chrome)), 'the first sync\'s Chrome is pruned, so a Chrome read once at start would be gone').toBe(false);
  }, 180_000);

  it('a run\'s and an install\'s PATH are the set current when the spec is built: a node change after it leaves the spec\'s node, npm and npx the old ones', async () => {
    const b = makeBox();
    const node2 = '22.2.0';
    const tar = nodeTarball(mkTmp('ccrc-tb-tools-node2-'), node2, W.log);
    W.dl.files.set(`/dist/v${node2}/node-v${node2}-linux-x64.tar.xz`, tar);
    W.dl.files.set(`/dist/v${node2}/SHASUMS256.txt`, Buffer.from(`${sha256(tar)}  node-v${node2}-linux-x64.tar.xz\n`));
    const d = driver(b);
    // The entry point's service and the settings it hands buildRunSpec and buildInstallSpec.
    const svc = serviceFor(cfgFor(b), path.join(b.tools, 'release', 'installed'), () => undefined);
    const settingsOf = (): SpecSettings => (svc as unknown as { d: { settings: SpecSettings } }).d.settings;
    const firstOf = (env: readonly (readonly [string, string])[]): string => (env.find(([k]) => k === 'PATH')?.[1] ?? '').split(':')[0]!;
    const runPath = (): string => { const r = buildRunSpec(SPEC_SUBMIT, SPEC_ROW, 1, settingsOf(), '/c'); if (!r.ok) throw new Error(r.reason); return firstOf(r.spec.env); };
    const installPath = (): string => firstOf(buildInstallSpec('k1', 'server', [], [], settingsOf()).env);
    await d.t.request(frameOf(BOOT_TAG));
    expect(report(b).result).toBe('ok');
    const nodeAt = (v: string): string => realpathSync(path.join(b.tools, 'node', v, 'bin', 'node'));
    // The prepare and the install start now, under the first sync's set.
    const [run1, install1] = [runPath(), installPath()];
    expect(realpathSync(path.join(run1, 'node'))).toBe(nodeAt(NEW.node));
    await d.t.request(frameOf(BOOT_TAG, { ...NEW, node: node2 }));
    expect(report(b)).toMatchObject({ result: 'ok', nodeChanged: true });
    expect(realpathSync(path.join(b.tools, 'current', 'node')), 'current names the new node').toBe(nodeAt(node2));
    // The specs built before the sync still name the old set's node, npm and npx: their PATH entry is no link the
    // sync switched.
    for (const first of [run1, install1]) {
      expect(realpathSync(path.join(first, 'node'))).toBe(nodeAt(NEW.node));
      expect(path.isAbsolute(first) && !first.split(path.sep).includes('current'), first).toBe(true);
      for (const t of ['npm', 'npx']) expect(existsSync(path.join(first, t)), `${first}/${t}`).toBe(true);
    }
    // A prepare that starts after the sync gets the new set.
    expect(realpathSync(path.join(runPath(), 'node'))).toBe(nodeAt(node2));
    expect(realpathSync(path.join(installPath(), 'node'))).toBe(nodeAt(node2));
  }, 180_000);

  it('a node change queues the pristine rebuilds at once (one tick of the service\'s timer work); a sync with the same node does not', async () => {
    const b = makeBox();
    const d = driver(b);
    await d.t.request(frameOf(BOOT_TAG));
    expect(d.ticks()).toBe(1);
    expect(d.t.node()).toBe(NEW.node);
    expect(d.t.versions()).toEqual(NEW);
    await d.t.request(frameOf(BOOT_TAG, { ...NEW, tmux: '3.3a' }));
    expect(d.units).toEqual(['ccrc-testbox-tools.service', 'ccrc-testbox-tools.service']);
    expect(d.t.versions()?.tmux).toBe('3.3a');
    expect(d.ticks(), 'the same node queues nothing').toBe(1);
    await d.t.request(frameOf(BOOT_TAG, { ...NEW, tmux: '3.3a' }));
    expect(d.units, 'a no-op sync starts nothing').toHaveLength(2);
  }, 180_000);

  it('a failed sync marks the box degraded with tool sync failed (<tool>: <detail>) and is retried on the backoff', async () => {
    const b = makeBox();
    writeFileSync(path.join(path.dirname(b.root), 'madison', 'git'), '');
    let now = 1_000;
    const d = driver(b, { now: () => now });
    const svc = { status: okStatus };
    attachToolSync(svc, d.t);
    await d.t.request(frameOf(BOOT_TAG));
    expect(statusOf(svc)).toMatchObject({ state: 'degraded', reason: 'tool sync failed (git: the OS mirror has no git 2.43.0)' });
    expect(d.t.stateNow().nextAt).toBe(1_000 + R1);
    await d.t.tick();
    expect(d.units, 'no retry before its delay').toHaveLength(1);
    writeFileSync(path.join(path.dirname(b.root), 'madison', 'git'), MADISON['git']!);
    now = 1_000 + R1;
    await d.t.tick();
    expect(d.units).toHaveLength(2);
    expect(d.t.sync().state).toBe('idle');
    expect(d.t.versions()).toEqual(NEW);
  }, 180_000);

  it('FRAME_HANDLERS takes tools.sync to the driver attached to the service, and refuses it for a service with none', async () => {
    const b = makeBox();
    const d = driver(b);
    const svc = {} as TestboxService;
    const refused: string[] = [];
    const conn = { send: () => undefined, refuse: (r: string) => { refused.push(r); } };
    await FRAME_HANDLERS['tools.sync']!(svc, frameOf(NEW_TAG), conn);
    expect(refused).toEqual(['this service does not sync tools']);
    attachToolSync(svc, d.t);
    // A frame for what the box has: the driver decides, and nothing runs.
    writeFileSync(path.join(b.tools, 'sets', 's.bootstrap', 'versions'), Object.entries({ node: NEW.node, npm: NEW.npm, chrome: NEW.chrome, python3: NEW.python3, git: NEW.git, tmux: NEW.tmux }).map(([k, v]) => `${k}\t${v}\n`).join(''));
    await FRAME_HANDLERS['tools.sync']!(svc, frameOf(BOOT_TAG), conn);
    expect(refused).toHaveLength(1);
    expect(d.units).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The timer: the service's work and the tool sync's retry, against a scripted tools unit.
// ---------------------------------------------------------------------------------------------------------------

/** A tools unit whose every start does the next scripted thing: fail, wait until released, or pass with a node change. */
function scriptedUnits(toolsDir: string, script: ('fail' | 'block' | 'node')[]) {
  const seen: string[] = [];
  const gates: (() => void)[] = [];
  const sys: SystemManager = {
    async run(unit: string): Promise<UnitEnd> {
      seen.push(unit);
      const step = script.shift() ?? 'fail';
      if (step === 'block') await new Promise<void>((r) => gates.push(r));
      if (step === 'node') {
        writeFileSync(path.join(toolsDir, 'sync-report'), 'result\tok\nrelease\tv0.0.1\nset\ts.cccccccc\ntakeover\t0\nnode-changed\t1\n');
        return { exit: 0, result: 'success' };
      }
      return step === 'block' ? { exit: 0, result: 'success' } : { exit: 1, result: 'exit-code' };
    },
    async stop() { /* no unit to stop */ },
    async active() { return false; },
  };
  return { sys, seen, release: () => { for (const g of gates.splice(0)) g(); } };
}

/** A served service whose tick waits until released, counting how many run at once. */
function slowService() {
  const gates: (() => void)[] = [];
  const c = { started: 0, inFlight: 0, most: 0 };
  const served: ServedService = {
    status: okStatus, idle: async () => undefined, liveRuns: () => [], waiting: () => [], submit: () => undefined,
    tick: async () => {
      c.started++; c.inFlight++; c.most = Math.max(c.most, c.inFlight);
      await new Promise<void>((r) => gates.push(r));
      c.inFlight--;
    },
  };
  return { served, c, release: () => { for (const g of gates.splice(0)) g(); } };
}

describe('the sets in use are the ones the specs name (D-7559; spec §2.10: a run resolves current once, at its prepare; the previous version of each tool is kept until no run uses it)', () => {
  const [RUN_A, RUN_B] = ['4'.repeat(32), '5'.repeat(32)];
  const chromeBuilds = (): void => { for (const v of [CHROME_2, CHROME_3]) W.dl.files.set(`/chrome-for-testing-public/${v}/linux64/chrome-linux64.zip`, chromeZip(v)); };
  const svcOf = (b: Box): TestboxService => serviceFor(cfgFor(b), path.join(b.tools, 'release', 'installed'), () => undefined);
  const depsOf = (svc: TestboxService): { settings: SpecSettings; chrome: string } => (svc as unknown as { d: { settings: SpecSettings; chrome: string } }).d;
  /** A prepare starting now: the run's spec built with the entry point's settings and written where the service writes
   *  it; returns the spec's first PATH entry, `<tools>/sets/<set>/bin`. */
  const prepareNow = (svc: TestboxService, root: string, runId: string, k: number): string => {
    const d = depsOf(svc);
    const r = buildRunSpec({ ...SPEC_SUBMIT, runId }, SPEC_ROW, k, d.settings, d.chrome);
    if (!r.ok) throw new Error(r.reason);
    writeSpec(root, r.spec);
    return (r.spec.env.find(([n]) => n === 'PATH')?.[1] ?? '').split(':')[0]!;
  };
  const setOf = (bin: string): string => path.basename(path.dirname(bin));
  const currentSet = (b: Box): string => path.basename(realpathSync(path.join(b.tools, 'current')));
  const keptIn = (root: string): string[] => readFileSync(path.join(root, 'specs', 'tools'), 'utf8').split('\0').filter((r) => r.startsWith('K'));

  it('a run whose prepare starts while a sync runs keeps its set through the next sync, though that set is no longer the previous one', async () => {
    const b = makeBox();
    chromeBuilds();
    const live: string[] = [];
    let svc: TestboxService | null = null;
    let first = '';
    const d = driver(b, { live, beforeUnit: (n) => {
      // The second sync's unit is about to switch current: a prepare starts first, under the set current now.
      if (n === 2) { first = prepareNow(svc!, path.join(path.dirname(b.root), 'svc'), RUN_A, 1); live.push(RUN_A); }
    } });
    svc = svcOf(b);
    await d.t.request(frameOf(BOOT_TAG));
    const s1 = currentSet(b);
    await d.t.request(frameOf(BOOT_TAG, { ...NEW, chrome: CHROME_2 }));
    expect(setOf(first)).toBe(s1);
    expect(currentSet(b)).not.toBe(s1);
    await d.t.request(frameOf(BOOT_TAG, { ...NEW, chrome: CHROME_3 }));
    expect(d.units).toHaveLength(3);
    expect(keptIn(d.svcRoot), 'the third sync keeps the set the live run\'s spec names').toContain(`K${s1}`);
    expect(existsSync(path.join(first, 'node')), 'the run\'s node is still there').toBe(true);
    expect(existsSync(path.join(b.tools, 'chrome', NEW.chrome)), 'and its Chrome').toBe(true);
  }, 180_000);

  it('a frame that waited for a sync runs with the sets of the runs that started meanwhile', async () => {
    const b = makeBox();
    chromeBuilds();
    const live: string[] = [];
    let svc: TestboxService | null = null;
    let first = '';
    const d = driver(b, { live, beforeUnit: (n) => {
      if (n !== 2) return;
      // A third frame comes while the second sync runs, and waits for it; then a prepare starts under the set current now.
      void d.t.request(frameOf(BOOT_TAG, { ...NEW, chrome: CHROME_3 }));
      first = prepareNow(svc!, path.join(path.dirname(b.root), 'svc'), RUN_A, 1);
      live.push(RUN_A);
    } });
    svc = svcOf(b);
    await d.t.request(frameOf(BOOT_TAG));
    const s1 = currentSet(b);
    await d.t.request(frameOf(BOOT_TAG, { ...NEW, chrome: CHROME_2 }));
    await d.t.settled();
    expect(d.units, 'the waiting frame ran after the second sync').toHaveLength(3);
    expect(setOf(first)).toBe(s1);
    expect(keptIn(d.svcRoot)).toContain(`K${s1}`);
    expect(existsSync(path.join(first, 'node'))).toBe(true);
  }, 180_000);

  it('a pristine install\'s set is kept while its spec names it; a slot\'s spec whose run has ended keeps nothing', async () => {
    const b = makeBox();
    chromeBuilds();
    const d = driver(b);
    const svc = svcOf(b);
    await d.t.request(frameOf(BOOT_TAG));
    const s1 = currentSet(b);
    const install = buildInstallSpec('k1', 'server', [], [], depsOf(svc).settings);
    writeInstallSpec(d.svcRoot, install);
    await d.t.request(frameOf(BOOT_TAG, { ...NEW, chrome: CHROME_2 }));
    const s2 = currentSet(b);
    // A run that prepared under the second set and has ended (it is not live) left its spec on slot 2.
    expect(setOf(prepareNow(svc, d.svcRoot, RUN_B, 2))).toBe(s2);
    await d.t.request(frameOf(BOOT_TAG, { ...NEW, chrome: CHROME_3 }));
    expect(keptIn(d.svcRoot), 'the install\'s set, and not the ended run\'s').toEqual([`K${s1}`]);
    expect(existsSync(path.join((install.env.find(([n]) => n === 'PATH')?.[1] ?? '').split(':')[0]!, 'node'))).toBe(true);
  }, 180_000);

  it('a prepare\'s Chrome and PATH come from one reading of current, whichever is read first', async () => {
    const b = makeBox();
    const d = driver(b);
    await d.t.request(frameOf(BOOT_TAG));
    const s1 = currentSet(b);
    // Another set, switched in by one rename between the two reads of the same prepare.
    const other = path.join(b.tools, 'sets', 's.otherset');
    mkdirSync(path.join(other, 'bin'), { recursive: true });
    writeFileSync(path.join(other, 'chrome'), '');
    const swap = (to: string): void => { const tmp = path.join(b.tools, 'current.swap'); symlinkSync(to, tmp); renameSync(tmp, path.join(b.tools, 'current')); };
    const chrome = d.t.chrome();
    swap(path.join('sets', 's.otherset'));
    const bin = d.t.bin();
    expect(setOf(bin), 'the PATH read after the switch, in the same prepare').toBe(s1);
    expect(realpathSync(chrome)).toBe(realpathSync(path.join(b.tools, 'sets', s1, 'chrome')));
    await Promise.resolve();
    // The next prepare reads current afresh.
    expect(setOf(d.t.bin())).toBe('s.otherset');
    const bin2 = d.t.bin();
    swap(path.join('sets', s1));
    expect(d.t.chrome(), 'the Chrome read after the switch, in the same prepare').toBe(realpathSync(path.join(other, 'chrome')));
    expect(setOf(bin2)).toBe('s.otherset');
  }, 180_000);

  it('a run handed over at a takeover is handed over again at the next one, while it still waits', async () => {
    const b = makeBox();
    const d = driver(b);
    const dir = path.join(d.svcRoot, HANDOVER_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `000000000000001-000001-${Q1}.json`), `${JSON.stringify(submitOf(Q1))}\n`);
    expect(d.t.resume()).toBe(1);
    d.waiting.push(Q1);
    expect(d.t.queuedFrames().map((f) => f.runId)).toEqual([Q1]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The takeover on the entry point's own service (D-7426, D-7559): `serviceFor`, the WebSocket door, the real queue,
// the hand-over and the next service on the same root. Only the system manager is a fixture.
// ---------------------------------------------------------------------------------------------------------------

describe('the takeover on the entry point\'s service: what it answers, what it queues and what it hands over (D-7426, D-7559)', () => {
  const [RUN_R, NEW_N] = ['6'.repeat(32), '7'.repeat(32)];
  const IDS = [RUN_R, NEW_N, Q1, Q2, Q3];
  const TAKEOVER_REPORT = `result\tok\nrelease\t${NEW_TAG}\nset\ts.bbbbbbbb\ntakeover\t1\nnode-changed\t0\n`;

  /** A fixture root with one repository row and no tool set yet, and the entry point's settings for it (one run at a time). */
  function fixture(): TestboxConfig {
    const fx = mkTmp('ccrc-tb-takeover-');
    const tools = path.join(fx, 'tools');
    const repos = path.join(fx, 'repos');
    for (const d of [tools, repos]) mkdirSync(d, { recursive: true });
    writeFileSync(path.join(repos, 'project-a.json'), `${JSON.stringify({ ...SPEC_ROW, mirrorPath: path.join(fx, 'mirrors', 'project-a.git') })}\n`);
    return { ...cfgFor({ root: path.join(fx, 'box'), tools } as unknown as Box), repos };
  }

  /** The system manager: the tools unit reports a replaced release; a run unit records whose run it is (from its spec)
   *  and, for RUN_R, waits until released; every other unit ends at once with 0. */
  function units(cfg: TestboxConfig) {
    const ran: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => { release = r; });
    const sys: SystemManager = {
      async run(unit: string): Promise<UnitEnd> {
        if (unit === 'ccrc-testbox-tools.service') writeFileSync(path.join(cfg.toolsDir, 'sync-report'), TAKEOVER_REPORT);
        const m = /^ccrc-testbox-run@([0-9]+)\.service$/.exec(unit);
        if (m !== null) {
          const spec = readFileSync(path.join(cfg.root, 'specs', m[1]!), 'utf8');
          const id = IDS.find((x) => spec.includes(x)) ?? '?';
          ran.push(id);
          if (id === RUN_R) await held;
        }
        return { exit: 0, result: 'success' };
      },
      async stop() { /* nothing to stop */ },
      async active() { return false; },
    };
    return { sys, ran, release: () => release() };
  }

  /** A connection through the WebSocket door, past its hello: the frames it was sent and how it closed. */
  async function door(port: number) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const frames: string[] = [];
    let closed: string | null = null;
    ws.on('message', (m) => frames.push(m.toString()));
    ws.on('close', (_code, reason) => { closed = reason.toString(); });
    await new Promise<void>((r, j) => { ws.once('open', () => r()); ws.once('error', j); });
    ws.send(JSON.stringify({ t: 'hello', token: 'tok' }));
    await expect.poll(() => frames.length).toBe(1);
    return { ws, frames, closed: (): string | null => closed, send: (f: unknown) => ws.send(JSON.stringify(f)) };
  }

  /** The entry point's start order: the service, the hand-over resumed, then the door. */
  async function boot(cfg: TestboxConfig, sys: SystemManager, exits: number[]) {
    const svc = serviceFor(cfg, path.join(cfg.toolsDir, 'release', 'installed'), (c) => { exits.push(c); }, { sys });
    await svc.start();
    const resumed = toolSyncOf(svc)!.resume();
    const srv = await startTestboxServer({ host: '127.0.0.1', port: 0, token: 'tok', service: svc });
    return { svc, srv, resumed };
  }

  const summaryOf = (cfg: TestboxConfig, id: string): string => path.join(cfg.root, 'results', id, 'summary.json');

  it('while a takeover waits for a run, every status answer and every hello reads as the frame family\'s, with the configured run limit', async () => {
    const cfg = fixture();
    const a = units(cfg);
    const exits: number[] = [];
    const { svc, srv } = await boot(cfg, a.sys, exits);
    try {
      const c = await door(srv.port);
      c.send(submitOf(RUN_R));
      await expect.poll(() => a.ran).toEqual([RUN_R]);
      c.send(frameOf(NEW_TAG));
      await expect.poll(() => toolSyncOf(svc)!.stateNow().takeover).toBe(true);
      const now = readTestboxFrame(JSON.stringify(statusOf(svc)));
      expect(now.ok ? now.value : now.reason).toMatchObject({ t: 'status', runs: { inProgress: 1, limit: cfg.runs } });
      const late = await door(srv.port);
      const hello = readTestboxFrame(late.frames[0]!);
      expect(hello.ok ? hello.value : hello.reason, 'a hello during the takeover').toMatchObject({ t: 'status', runs: { limit: cfg.runs } });
      expect(exits).toEqual([]);
      a.release();
      await expect.poll(() => exits).toEqual([0]);
      for (const x of [c, late]) x.ws.close();
    } finally {
      a.release();
      await srv.close();
    }
  });

  it('a queued run and one submitted through the door during the takeover are handed over, run by the next service in order ahead of a new submission, and leave their summaries', async () => {
    const cfg = fixture();
    const a = units(cfg);
    const exits: number[] = [];
    const first = await boot(cfg, a.sys, exits);
    try {
      const c = await door(first.srv.port);
      c.send(submitOf(RUN_R));
      await expect.poll(() => a.ran).toEqual([RUN_R]);
      c.send(submitOf(Q1));
      await expect.poll(() => [...first.svc.positions().keys()]).toEqual([Q1]);
      c.send(frameOf(NEW_TAG));
      await expect.poll(() => toolSyncOf(first.svc)!.stateNow().takeover).toBe(true);
      // Submitted during the takeover: accepted and queued behind Q1, never refused.
      c.send(submitOf(Q2));
      await expect.poll(() => [...first.svc.positions().keys()]).toEqual([Q1, Q2]);
      expect(c.closed(), 'the submission is not refused').toBeNull();
      a.release();
      await expect.poll(() => exits).toEqual([0]);
      expect(existsSync(summaryOf(cfg, RUN_R)), 'the run in progress ended and was summarised').toBe(true);
      expect(a.ran, 'the old service starts nothing once the takeover began').toEqual([RUN_R]);
      c.ws.close();
    } finally {
      a.release();
      await first.srv.close();
    }
    // The next service, on the new tree, at the same root.
    const b = units(cfg);
    const next = await boot(cfg, b.sys, []);
    try {
      expect(next.resumed).toBe(2);
      const late = await door(next.srv.port);
      late.send(submitOf(NEW_N));
      await expect.poll(() => [Q1, Q2, NEW_N].every((id) => existsSync(summaryOf(cfg, id)))).toBe(true);
      expect(b.ran, 'the handed-over runs first, in their order, then the new one').toEqual([Q1, Q2, NEW_N]);
      for (const id of [Q1, Q2]) {
        const s = JSON.parse(readFileSync(summaryOf(cfg, id), 'utf8')) as RunSummary;
        expect(s).toMatchObject({ t: 'run.summary', runId: id, exit: 0, ranOn: 'test-box' });
      }
      expect(readdirSync(path.join(cfg.root, HANDOVER_DIR))).toEqual([]);
      late.ws.close();
    } finally {
      await next.srv.close();
    }
  });

  it('a refused duplicate run.submit never replaces the queued run\'s frame: the hand-over is the submission the service queued', async () => {
    const cfg = fixture();
    const a = units(cfg);
    const exits: number[] = [];
    const { svc, srv } = await boot(cfg, a.sys, exits);
    try {
      const c = await door(srv.port);
      c.send(submitOf(RUN_R));
      await expect.poll(() => a.ran).toEqual([RUN_R]);
      c.send(submitOf(Q1));
      await expect.poll(() => [...svc.positions().keys()]).toEqual([Q1]);
      // A retry of Q1 with another argv: the service refuses it, and the connection closes with the reason.
      const dup = await door(srv.port);
      dup.send({ ...submitOf(Q1), argv: ['./node_modules/.bin/vitest', 'run', 'test/other.test.ts'] });
      await expect.poll(() => dup.closed()).toBe(`run id ${Q1} already used`);
      c.send(frameOf(NEW_TAG));
      await expect.poll(() => toolSyncOf(svc)!.stateNow().takeover).toBe(true);
      a.release();
      await expect.poll(() => exits).toEqual([0]);
      const dir = path.join(cfg.root, HANDOVER_DIR);
      const handed = readdirSync(dir);
      expect(handed).toHaveLength(1);
      expect(JSON.parse(readFileSync(path.join(dir, handed[0]!), 'utf8'))).toEqual(submitOf(Q1));
      c.ws.close();
    } finally {
      a.release();
      await srv.close();
    }
  });
});

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

describe('the timer (main.ts#timerWork): a sync never holds up the service\'s work, and that work never runs twice at once', () => {
  it('a retried sync\'s unit, however long, does not hold up the service\'s timer work', async () => {
    const fx = mkTmp('ccrc-tb-timer-');
    const tools = path.join(fx, 'tools');
    mkdirSync(tools);
    const u = scriptedUnits(tools, ['fail', 'block']);
    let now = 1_000;
    let ticks = 0;
    const t = new ToolSync({ sys: u.sys, root: path.join(fx, 'svc'), toolsDir: tools, settings: TS, now: () => now, exit: () => undefined });
    const served: ServedService = {
      status: okStatus, idle: async () => undefined, liveRuns: () => [], waiting: () => [], submit: () => undefined, tick: async () => { ticks++; },
    };
    t.serve(served);
    const svc = { tick: served.tick } as unknown as TestboxService;
    attachToolSync(svc, t);
    await t.request(frameOf(NEW_TAG));
    expect(t.sync().state).toBe('failed');
    now = 1_000 + R1;
    const stuck = (p: Promise<void>): Promise<string> => Promise.race([p.then(() => 'done'), new Promise<string>((r) => setTimeout(() => r('stuck'), 2_000))]);
    expect(await stuck(timerWork(svc))).toBe('done');
    expect(u.seen, 'the retry is running').toHaveLength(2);
    expect(await stuck(timerWork(svc)), 'the next tick runs while the retry still does').toBe('done');
    expect(ticks).toBe(2);
    u.release();
    await t.settled();
    expect(t.sync().state).toBe('failed');
  });

  it('a node change\'s rebuild tick waits for the timer\'s tick in progress, then runs', async () => {
    const fx = mkTmp('ccrc-tb-timer-');
    const tools = path.join(fx, 'tools');
    mkdirSync(tools);
    const u = scriptedUnits(tools, ['node']);
    const s = slowService();
    const t = new ToolSync({ sys: u.sys, root: path.join(fx, 'svc'), toolsDir: tools, settings: TS, now: () => 1_000, exit: () => undefined });
    t.serve(s.served);
    const svc = { tick: s.served.tick } as unknown as TestboxService;
    attachToolSync(svc, t);
    const timer = timerWork(svc);
    await settle();
    expect(s.c.started).toBe(1);
    const synced = t.request(frameOf(NEW_TAG));
    await settle();
    expect(u.seen).toHaveLength(1);
    expect(s.c.started, 'the rebuild tick waits for the one in progress').toBe(1);
    s.release();
    await timer;
    await settle();
    expect(s.c.started, 'then it runs').toBe(2);
    s.release();
    await synced;
    expect(s.c.most, 'never two at once').toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Counted exits, each with a mutation that reds it.
// ---------------------------------------------------------------------------------------------------------------

const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');
const codeLines = (text: string, comment: RegExp): string[] => text.split('\n').filter((l) => !comment.test(l));
const shellCode = (t: string): string[] => codeLines(t, /^\s*#/);
const tsCode = (t: string): string[] => codeLines(t, /^\s*(\/\/|\*|\/\*)/);
const filesUnder = (rel: string): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(path.join(REPO, d))) {
      const r = `${d}/${n}`;
      if (lstatSync(path.join(REPO, r)).isDirectory()) walk(r); else out.push(r);
    }
  };
  walk(rel);
  return out.sort();
};

/** A line that does provenance verification's work itself: names the bundle, the sums or the manifest, runs the verifier
 *  or admits an unsigned release. */
const PROVENANCE = /sigstore|SHA256SUMS|MANIFEST|verify-provenance|allow-unsigned|sha256sum -c|--blob\b/;
const provenanceCopies = (files: Record<string, string>): string[] =>
  Object.entries(files).flatMap(([f, t]) => (f.endsWith('.ts') ? tsCode(t) : shellCode(t)).filter((l) => PROVENANCE.test(l)).map((l) => `${f}: ${l.trim()}`));
const boxFiles = (): Record<string, string> =>
  Object.fromEntries([...filesUnder('deploy/testbox'), ...filesUnder('agent/src/testbox'), 'ccd/testbox-knobs'].map((f) => [f, read(f)]));

/** A read of CCRC_RELEASE_BASE_URL that an inherited value could win: `_upd_release_base` or `_ccrc_knob` for it with
 *  no `file`, or the variable expanded. */
const envModeReads = (t: string): string[] =>
  shellCode(t).filter((l) => (/\b_upd_release_base\b(?!\(\))/.test(l) && !/_upd_release_base file\b/.test(l))
    || (/_ccrc_knob CCRC_RELEASE_BASE_URL\b/.test(l) && !/ file\b/.test(l)) || /\$\{?CCRC_RELEASE_BASE_URL\b/.test(l));
const boxEnvAssignments = (t: string): string[] => shellCode(t).filter((l) => /\bBOX_ENV_FILE=/.test(l));

describe('counted exits (D-7408, D-7457)', () => {
  it('copies of the provenance verification logic outside ccd/ccrc and deploy/verify-provenance.mjs: 0', async () => {
    expect(provenanceCopies(boxFiles())).toEqual([]);
  });
  it('mutation: a sums check of its own in the tools script is counted', async () => {
    const t = read('deploy/testbox/bin/tools-sync').replace('_upd_fetch 0 >/dev/null', '( cd "$stage" && sha256sum -c SHA256SUMS )');
    expect(provenanceCopies({ 'deploy/testbox/bin/tools-sync': t })).toHaveLength(1);
  });
  it('reads of CCRC_RELEASE_BASE_URL on the box in environment mode: 0', async () => {
    for (const f of [...filesUnder('deploy/testbox').filter((f) => !f.endsWith('.example')), 'ccd/testbox-knobs']) expect(envModeReads(read(f)), f).toEqual([]);
    expect(read('ccd/testbox-knobs')).toMatch(/BOX_ENV_FILE="\$TB_BOX_ENV_FILE" _upd_release_base file\b/);
  });
  it('mutation: the release base read in environment mode is counted', async () => {
    const t = read('ccd/testbox-knobs').replace('_upd_release_base file >/dev/null', '_upd_release_base >/dev/null');
    expect(envModeReads(t)).toHaveLength(1);
    expect(envModeReads('x="$CCRC_RELEASE_BASE_URL"\n')).toHaveLength(1);
  });
  it('BOX_ENV_FILE assignments in deploy/testbox/bin/tools-sync: 0', async () => {
    expect(boxEnvAssignments(read('deploy/testbox/bin/tools-sync'))).toEqual([]);
  });
  it('mutation: a BOX_ENV_FILE binding in the tools script is counted', async () => {
    const t = read('deploy/testbox/bin/tools-sync').replace('  _tb_release_base ||', '  BOX_ENV_FILE=/etc/ccrc-testbox/ccrc.env _tb_release_base ||');
    expect(boxEnvAssignments(t)).toHaveLength(1);
  });
  it('the script calls the update lane\'s own two functions, never with --allow-unsigned, and switches each name once', async () => {
    const code = shellCode(read('deploy/testbox/bin/tools-sync'));
    expect(code.filter((l) => /\b_upd_resolve\b/.test(l)).map((l) => l.trim())).toEqual(['_upd_resolve "$tag"']);
    expect(code.filter((l) => /\b_upd_fetch\b/.test(l)).map((l) => l.trim())).toEqual(['_upd_fetch 0 >/dev/null']);
    expect(code.filter((l) => /_tbt_link "/.test(l)).map((l) => l.trim().split(' ||')[0])).toEqual([
      '_tbt_link "sets/$TBT_NEW_SET" "$TBT_TOOLS/current"', '_tbt_link "$TBT_REL" "$TBT_TOOLS/release/installed"',
    ]);
  });
});
