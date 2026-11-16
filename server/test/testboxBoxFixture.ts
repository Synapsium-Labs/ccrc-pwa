// D-7409, D-7424, D-7451, D-7456, D-7568 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB7). The fixture
// world the box package's two tests share: a release tree built from this checkout the way the release tests build
// theirs (the checkout's ccd/, shared/, deploy/ and install.sh, server/'s manifests, a shipped build.json and a
// MANIFEST), a fixture nodejs.org over HTTPS under a fixture CA (reached through the fixture home's `.curlrc`, as TB6's
// rows reach it), a fixture box under a TB_FIXTURE_ROOT, and the installer run as the test user with
// TB_FIXTURE_OWNER_UID=$(id -u) (D-7456) and the TB_SYS seam pointed at server/test/fixtures/testbox-sys-driver.sh.
// Nothing here contacts a box, a host, a registry or a system manager, and no shell string is built from a path.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SYS_DRIVER = path.join(REPO, 'server', 'test', 'fixtures', 'testbox-sys-driver.sh');
export const UID = process.getuid?.() ?? 0;
export const BOOT_TAG = 'v0.0.1';
export const BOOT_NODE = '22.0.0';
export const DISTRO = 'ubuntu-24.04';
export const PUSH_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureFixtureFixtureFixtureFixtureFixture0000 fixture-comment';
export const XFS_OK = 'meta-data=/dev/fixture isize=512 agcount=4, agsize=1 blks\n         =                       crc=1        finobt=1, sparse=1, rmapbt=1\n         =                       reflink=1    bigtime=1 inobtcount=1\n';

export const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

export function run(cmd: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv): string {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

// ── hosts ─────────────────────────────────────────────────────────────────
export interface Host { readonly port: number; readonly log: string[]; readonly files: Map<string, Buffer>; close(): Promise<void> }
function handler(h: { log: string[]; files: Map<string, Buffer> }) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const p = (req.url ?? '/').split('?')[0]!;
    h.log.push(p);
    const body = h.files.get(p);
    if (body === undefined) { res.statusCode = 404; res.end('not found'); return; }
    res.statusCode = 200;
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
export async function httpHost(): Promise<Host> {
  const h = { log: [] as string[], files: new Map<string, Buffer>() };
  return listen(createServer(handler(h)), h);
}

// ── artifacts ─────────────────────────────────────────────────────────────
/** A `MANIFEST` as `deploy/build-release.sh` writes it: every file but itself, `<sha256>  <path>`, in byte order. */
export function writeManifest(tree: string): void {
  const files: string[] = [];
  const walk = (d: string, rel: string): void => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      const r = rel === '' ? n : `${rel}/${n}`;
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p, r);
      else if (st.isFile() && r !== 'MANIFEST') files.push(r);
    }
  };
  walk(tree, '');
  files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  writeFileSync(path.join(tree, 'MANIFEST'), files.map((f) => `${sha256(readFileSync(path.join(tree, f)))}  ${f}\n`).join(''));
}

/** The release payload: the checkout's ccd/, shared/ and deploy/ (no mail token), install.sh, server/'s and agent/'s
 *  manifests (deploy/build-release.sh ships both), the shipped stamp and the MANIFEST. */
export function releaseTree(dir: string, version: string): string {
  const tree = path.join(dir, `staging-${version}`);
  cpSync(path.join(REPO, 'ccd'), path.join(tree, 'ccd'), { recursive: true });
  cpSync(path.join(REPO, 'shared'), path.join(tree, 'shared'), { recursive: true });
  cpSync(path.join(REPO, 'deploy'), path.join(tree, 'deploy'), { recursive: true, filter: (s) => !s.endsWith('ccrc-mail.token') });
  copyFileSync(path.join(REPO, 'install.sh'), path.join(tree, 'install.sh'));
  mkdirSync(path.join(tree, 'server'), { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) copyFileSync(path.join(REPO, 'server', f), path.join(tree, 'server', f));
  mkdirSync(path.join(tree, 'agent'), { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) copyFileSync(path.join(REPO, 'agent', f), path.join(tree, 'agent', f));
  writeFileSync(path.join(tree, 'build.json'), `{"sha":"${'b'.repeat(40)}","ref":"release","builtAt":"2026-10-30T00:00:00Z","dirty":false,"version":"${version}"}\n`);
  writeManifest(tree);
  return tree;
}

/** node's release tarball: `bin/node` runs this process's node, `bin/npm` records its cwd and argv and lays out a
 *  `node_modules` holding a stub package for each of package.json's `dependencies`, and node's headers. */
export function nodeTarball(dir: string, version: string, log: string): Buffer {
  const top = path.join(dir, `nodepkg-${version}`, `node-v${version}-linux-x64`);
  mkdirSync(path.join(top, 'bin'), { recursive: true });
  mkdirSync(path.join(top, 'include', 'node'), { recursive: true });
  writeFileSync(path.join(top, 'include', 'node', 'node.h'), '/* fixture */\n');
  writeFileSync(path.join(top, 'bin', 'node'), `#!/bin/sh\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
  const layout = 'const fs = require("fs"); const d = JSON.parse(fs.readFileSync("package.json", "utf8")).dependencies || {};'
    + ' for (const n of Object.keys(d)) { fs.mkdirSync("node_modules/" + n, { recursive: true }); fs.writeFileSync("node_modules/" + n + "/package.json", JSON.stringify({ name: n }) + "\\n"); }';
  writeFileSync(path.join(top, 'bin', 'npm'), `#!/bin/sh\nprintf '%s\\t%s\\n' "$(pwd)" "$*" >> '${path.join(log, 'npm-argv')}'\n[ "$1" = ci ] || exit 0\nmkdir -p node_modules/.fixture-ci\nexec '${process.execPath}' -e '${layout}'\n`, { mode: 0o755 });
  const out = path.join(dir, `node-v${version}-linux-x64.tar.xz`);
  run('tar', ['-cJf', out, '-C', path.dirname(top), path.basename(top)]);
  return readFileSync(out);
}

/** A fixture CA-signed certificate for nodejs.org. */
function fixtureCert(dir: string): { key: Buffer; cert: Buffer; certFile: string } {
  const cfg = path.join(dir, 'openssl.cnf');
  writeFileSync(cfg, [
    '[req]', 'distinguished_name = dn', 'x509_extensions = v3', 'prompt = no', '[dn]', 'CN = fixture download host',
    '[v3]', 'subjectAltName = DNS:nodejs.org', 'basicConstraints = critical, CA:TRUE',
    'keyUsage = critical, digitalSignature, keyCertSign', 'extendedKeyUsage = serverAuth', '',
  ].join('\n'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-config', cfg]);
  return { key: readFileSync(key), cert: readFileSync(cert), certFile: cert };
}

export interface World {
  readonly dir: string;
  readonly log: string;
  readonly staging: string;
  readonly dl: Host;
  readonly certFile: string;
  /** Serve node `<version>` on the fixture nodejs.org; `badSum`, a SHASUMS256.txt naming another digest. */
  serveNode(version: string, badSum?: boolean): void;
  close(): Promise<void>;
}

export async function makeWorld(): Promise<World> {
  const dir = mkTmp('ccrc-tb-box-world-');
  const log = path.join(dir, 'log');
  mkdirSync(log);
  const art = path.join(dir, 'art');
  mkdirSync(art);
  const staging = releaseTree(art, BOOT_TAG);
  const { key, cert, certFile } = fixtureCert(art);
  const st = { log: [] as string[], files: new Map<string, Buffer>() };
  const dl = await listen(createHttpsServer({ key, cert }, handler(st)), st);
  const serveNode = (version: string, badSum = false): void => {
    const tb = nodeTarball(art, version, log);
    dl.files.set(`/dist/v${version}/node-v${version}-linux-x64.tar.xz`, tb);
    dl.files.set(`/dist/v${version}/SHASUMS256.txt`, Buffer.from(`${'0'.repeat(64)}  node-v${version}-darwin-arm64.tar.gz\n${badSum ? 'f'.repeat(64) : sha256(tb)}  node-v${version}-linux-x64.tar.xz\n`));
  };
  serveNode(BOOT_NODE);
  dl.files.set('/dist/probe', Buffer.from('reached the fixture\n'));
  return { dir, log, staging, dl, certFile, serveNode, close: () => dl.close() };
}

// ── one fixture box ───────────────────────────────────────────────────────
export interface Box {
  readonly fx: string;
  /** TB_FIXTURE_ROOT: the box file is <root>/etc/ccrc-testbox/ccrc.env. */
  readonly root: string;
  readonly boxFile: string;
  readonly tbRoot: string;
  readonly repos: string;
  readonly tools: string;
  readonly home: string;
  readonly rowFile: string;
  readonly mirror: string;
  readonly pushKey: string;
  readonly sysLog: string;
  readonly env: NodeJS.ProcessEnv;
}

/** The box's own network units, running on a fixture box before the installer starts. */
export const INFRA_UNITS = ['tailscaled.service', 'systemd-resolved.service', 'systemd-timesyncd.service'];

/** The fixture firewall's state (testbox-sys-driver.sh's `nft` lines): `table` when loaded, then `<set> <cgroup>`
 *  for each cgroup its sets hold, sorted. */
export function nftState(b: Box): string[] {
  return existsSync(path.join(b.fx, 'sys.db'))
    ? readFileSync(path.join(b.fx, 'sys.db'), 'utf8').split('\n').filter((l) => l.startsWith('nft ')).map((l) => l.slice(4)).sort()
    : [];
}

/** The fixture system manager called as a unit of the box would call it (no installer around it). */
export function sysCall(b: Box, args: string[]): Ran {
  const r = spawnSync(SYS_DRIVER, args, { env: b.env, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

/** The fixture box's own paths, which the box file names. */
export function boxPaths(root: string): { tbRoot: string; repos: string; tools: string } {
  return { tbRoot: path.join(root, 'srv', 'testbox'), repos: path.join(root, 'srv', 'testbox-repos.d'), tools: path.join(root, 'opt', 'ccrc-testbox', 'tools') };
}

/** A fixture box: `boxLines` are the box file's lines beyond the three paths and the listen address (when `paths` is
 *  not false). */
export function makeBox(w: World, o: { boxLines?: string[]; paths?: boolean; findmnt?: string; xfs?: string; env?: NodeJS.ProcessEnv } = {}): Box {
  const fx = mkTmp('ccrc-tb-box-');
  const root = path.join(fx, 'root');
  const home = path.join(fx, 'home');
  const { tbRoot, repos, tools } = boxPaths(root);
  for (const d of [path.join(root, 'etc', 'ccrc-testbox'), path.join(root, 'etc', 'apt'), path.join(root, 'srv'), home, path.join(fx, 'hosts')]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(root, 'etc', 'os-release'), 'NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="24.04"\nVERSION_CODENAME=noble\n');
  writeFileSync(path.join(root, 'etc', 'apt', 'sources.list'), 'deb http://mirror.testbox.invalid/ubuntu noble main universe\n');
  const boxFile = path.join(root, 'etc', 'ccrc-testbox', 'ccrc.env');
  const lines = o.paths === false ? [] : [
    `CCRC_TESTBOX_ROOT=${tbRoot}`, `CCRC_TESTBOX_REPOS=${repos}`, `CCRC_TESTBOX_TOOLS_DIR=${tools}`, 'CCRC_TESTBOX_LISTEN=127.0.0.9:7443',
  ];
  // A line of `boxLines` replaces the default line of its key.
  const keyOf = (l: string): string => l.slice(0, l.indexOf('='));
  const extra = o.boxLines ?? [];
  const merged = [...lines.filter((l) => !extra.some((e) => keyOf(e) === keyOf(l))), ...extra];
  writeFileSync(boxFile, [...merged, ''].join('\n'), { mode: 0o600 });
  const mirror = path.join(root, 'srv', 'mirrors', 'project-a.git');
  const rowFile = path.join(fx, 'project-a.json');
  writeFileSync(rowFile, `${JSON.stringify({
    name: 'project-a', fetchUrl: 'https://testbox.invalid/project-a.git', mirrorPath: mirror,
    packages: [{ name: 'server', installInputs: ['server/package.json', 'server/package-lock.json'], commands: ['./node_modules/.bin/vitest'] }],
    buildOutputs: [], systemTools: [],
  })}\n`);
  const pushKey = path.join(fx, 'push.pub');
  writeFileSync(pushKey, `${PUSH_KEY}\n`);
  writeFileSync(path.join(home, '.curlrc'), [`connect-to = nodejs.org:443:127.0.0.1:${w.dl.port}`, `cacert = ${w.certFile}`, ''].join('\n'));
  writeFileSync(path.join(fx, 'findmnt'), o.findmnt ?? 'xfs /srv\n');
  writeFileSync(path.join(fx, 'xfs_info'), o.xfs ?? XFS_OK);
  const sysLog = path.join(fx, 'sys.log');
  // The fixture system manager's state: the box's own tailnet client, resolver and time client run already.
  writeFileSync(path.join(fx, 'sys.db'), INFRA_UNITS.map((u) => `active ${u}\n`).join(''));
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, LANG: 'C', TMPDIR: process.env.TMPDIR ?? '/tmp',
    TB_FIXTURE_ROOT: root, TB_FIXTURE_OWNER_UID: String(UID), TB_SYS: SYS_DRIVER,
    TBS_LOG: sysLog, TBS_DB: path.join(fx, 'sys.db'), TBS_FINDMNT: path.join(fx, 'findmnt'), TBS_XFS: path.join(fx, 'xfs_info'),
    TBS_HOSTS: path.join(fx, 'hosts'),
    ...o.env,
  };
  return { fx, root, boxFile, tbRoot, repos, tools, home, rowFile, mirror, pushKey, sysLog, env };
}

export interface Ran { code: number; stdout: string; stderr: string }
/** A child run without blocking this process, whose fixture servers must answer it. */
export function exec(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const c = spawn(file, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    c.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => c.kill('SIGKILL'), 240_000);
    c.on('error', reject);
    c.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

/** The installer, as the operator runs it from the extracted tree. */
export function install(b: Box, o: { staging?: string; release?: string; node?: string; env?: NodeJS.ProcessEnv; script?: string } = {}): Promise<Ran> {
  const staging = o.staging ?? '';
  const script = o.script ?? path.join(staging, 'deploy', 'testbox', 'install.sh');
  return exec('bash', [script, '--release', o.release ?? BOOT_TAG, '--node', o.node ?? BOOT_NODE, '--repos', b.rowFile,
    '--distro', DISTRO, '--push-key', b.pushKey], { ...b.env, ...o.env });
}

/** The fixture TB_SYS log, one argv per line. */
export function sysLog(b: Box): string[][] {
  return existsSync(b.sysLog) ? readFileSync(b.sysLog, 'utf8').split('\n').filter((l) => l !== '').map((l) => l.split('\t')) : [];
}

/** Every path under `dir`: its type, mode and link target or content digest (no times), in path order. */
export function treeOf(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = path.join(d, n);
      const r = rel === '' ? n : `${rel}/${n}`;
      const st = lstatSync(p);
      const mode = (st.mode & 0o7777).toString(8);
      if (st.isSymbolicLink()) out.push(`${r} l ${readlinkSync(p)}`);
      else if (st.isDirectory()) { out.push(`${r} d ${mode}`); walk(p, r); }
      else out.push(`${r} f ${mode} ${sha256(readFileSync(p))}`);
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return out;
}

/** A unit file's properties, `[Section] Key=Value` in file order, comments and blank lines left out. */
export function unitProps(text: string): string[] {
  const out: string[] = [];
  let section = '';
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (l === '' || l.startsWith('#') || l.startsWith(';')) continue;
    const s = /^\[([A-Za-z]+)\]$/.exec(l);
    if (s !== null) { section = s[1]!; continue; }
    out.push(`[${section}] ${l}`);
  }
  return out;
}
