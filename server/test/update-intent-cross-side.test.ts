// The update-intent projection, SERVER TO NODE and back, through real code on
// both sides (design 2026-09-20 §9; W4a plan Task 15, D-3235).
//
// W2 shipped the writer — GET /api/updates/intent/:nodeId, rendered by
// `renderProjection` — and pinned its output against an EMBEDDED python
// restatement of the node's grammar, because the node side did not exist yet.
// This wave ships the node side: `ccd/ccd-update-sync` (the fleet node's
// puller, Task 10) and `ccd/ccrc`'s `_upd_intent_state` (every node's one
// reader, Task 8). Each side is green against its OWN fixtures by
// construction; the defect this file exists for — GET /api/pools/epoch's C1,
// milliseconds on one side of a seam and seconds on the other (the route's
// own comment in server.ts, and pool-accounts-route.test.ts's C1 suite) — is
// visible only to a body built by one side and read by the other. So: W2's
// real route over a real coord.db → the real puller (a stub `curl` answers the
// route's own bytes, the `syncInto` shape) → ~/.ccrc/update-intent → the real
// reader, and `ccrc update --check` on top of it; the other direction, a real
// `_upd_phase` report (unix SECONDS, rulings R1/R14) through W2's real
// `reportFrom`, its seventh key `pid` ignored (R2/R15); and the watchdog's
// in-flight set against W2's. THIS REPLACES update-projection.test.ts's
// embedded python validator, deleted in the same commit (that file's header
// says so); its server-role half — a `server`/`both` box reading W2's own file
// — now runs the real reader there, through updateIntentFixtures.ts.
//
// Fixture HOMEs only (mkTmp), one per box. Nothing reads the live $HOME; the
// service managers are poisons (ghContainedEnv) and `curl` is a stub.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type ReleaseListingRow } from '../src/coord/store.js';
import { UpdateIntentLog, defaultUpdateIntentLogPath } from '../src/coord/updateintentlog.js';
import { FLEET_LABEL, reportFrom } from '../src/update/inventory.js';
import { PROJECTION_LEASE_S } from '../src/update/resolve.js';
import { resolveAndProject } from '../src/update/project.js';
import { IN_FLIGHT_UPDATE_PHASES, UPDATE_PHASES, type UpdateChannel } from '../../shared/api.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { describeLinux } from './platformFixtures.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { CCRC, nodeEnv, plantNode, readIntent } from './updateIntentFixtures.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CCD_UPDATE_SYNC = path.join(REPO, 'ccd', 'ccd-update-sync');
const TOKEN = 'f'.repeat(64);
const FLEET_ID = '0123abcd-0000-4000-8000-000000000001';
const failingRunner: Runner = async () => ({ code: 1, stdout: '', stderr: '' });

// W2's own fixture shapes (update-projection.test.ts), so the store is fed
// exactly what W2's tests feed it.
const listed = (tag: string, channel: UpdateChannel, now: number): ReleaseListingRow => ({
  tag, channel, publishedAt: now, commitSha: null, tarballUrl: `https://releases.example/ccrc-${tag}.tar.gz`,
  bundleListed: true, notes: null, draft: false,
});
// W4a Task 15: NodeMeasurement now requires floorRead/previousRead (W2
// D-3213); W2's own update-projection.test.ts fixture carries them
// (`floorRead: 'measured', previousRead: 'absent'`).
const fleetRow = (now: number): NodeMeasurement => ({
  nodeId: FLEET_ID, label: FLEET_LABEL, role: 'fleet',
  currentVersion: 'v0.0.10', currentSha: 'a'.repeat(40), currentRef: 'main', currentBuiltAt: '2026-09-22T00:00:00Z',
  currentDirty: false, stampRead: 'ok', installState: 'complete', provenance: 'verified', caps: ['verify', 'node-id', 'floor'],
  agentOps: [], highestVersion: 'v0.0.10', previousVersion: null, floorRead: 'measured', previousRead: 'absent',
  os: 'linux', measuredAt: now, report: null,
});

let app: FastifyInstance | undefined;
let store: CoordStore | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  if (store) store.db.close();
  store = undefined;
});

/** W2's real server over a real coord.db on its own fixture home: the fleet
 *  node's row (floor v0.0.10) and a catalogue of v0.0.10 + v0.0.11 on stable
 *  and v0.0.12 on dev, resolved by W2's own `resolveAndProject` before the
 *  route is read — so the route answers whether it renders on read or from the
 *  stored resolution. */
async function openServer(): Promise<FastifyInstance> {
  const home = mkTmp('ccrc-cross-server-');
  seedRoster(home);
  const cfg = { ...loadConfig({ CCRC_HOME: home }), authEnabled: false };
  const ccrcDir = path.join(home, '.ccrc');
  store = new CoordStore(openCoordDb(path.join(ccrcDir, 'coord.db')));
  const now = Date.now();
  expect(store.upsertNodeMeasurement(fleetRow(now))).toMatchObject({ ok: true });
  expect(store.applyReleaseListing(
    [listed('v0.0.12', 'dev', now), listed('v0.0.11', 'stable', now), listed('v0.0.10', 'stable', now)],
    now, 'complete')).toMatchObject({ ok: true });
  expect((await resolveAndProject({ store, role: 'server', ccrcDir }, now)).resolved).toBe(1);
  const a = await buildServer({
    cfg, runCcd: ccdRunner(failingRunner, cfg), tmux: new Tmux(failingRunner),
    io: localIO, queue: new KeyedQueue(), coord: store, mailToken: TOKEN,
    updateIntentLog: new UpdateIntentLog(defaultUpdateIntentLogPath(ccrcDir)),
  } as Deps);
  await a.ready();
  return a;
}

/** The route's own bytes, fetched the way the puller fetches them (box token). */
async function routeBody(a: FastifyInstance): Promise<string> {
  const r = await a.inject({
    method: 'GET', url: `/api/updates/intent/${FLEET_ID}`, headers: { 'x-ccrc-mail-token': TOKEN },
  });
  expect(r.statusCode, r.body).toBe(200);
  expect(String(r.headers['content-type'])).toBe('text/plain; charset=utf-8');
  return r.body;
}

/** A fleet node's HOME: role + the puller's timer unit file (plantNode), the
 *  three inputs the puller reads (agent.env, the box token, node-id — fixture
 *  values; the token is not a secret), and the fixture curl. */
function fleetNode(): string {
  const home = mkTmp('ccrc-cross-fleet-');
  plantNode(home, 'fleet');
  writeFileSync(path.join(home, '.ccrc', 'agent.env'), 'CCRC_SERVER_URL=wss://example.invalid\n');
  writeFileSync(path.join(home, '.ccrc', 'node-id'), `${FLEET_ID}\n`);
  mkdirSync(path.join(home, '.cc-secrets'), { recursive: true });
  writeFileSync(path.join(home, '.cc-secrets', 'ccrc-mail.token'), '# fixture box token\ntok\n', { mode: 0o600 });
  const bin = path.join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  // `local://<path>` is a release asset on disk (missing = curl's own
  // 404/exit-22 shape, ccrc-update.test.ts's convention). The intent route's
  // body is written to `$dest` (curl's real `-o` semantics; ccd-update-sync's
  // own invocation is `-o "$body_tmp" -w '%{http_code}'`, D-3280 — the body
  // goes to a FILE, never through stdout/a bash variable, so the stub must
  // write it there too and print only the status code) — the same shape this
  // file's `local://` case and ccrc-update.test.ts's own combined stub use
  // whenever `-o` is present. Every URL is recorded.
  writeFileSync(path.join(bin, 'curl'), [
    '#!/bin/sh',
    'dest=""; url=""',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -o) dest="$2"; shift 2 ;;',
    '    -K|-w|-H|--max-time) shift 2 ;;',
    '    -*) shift ;;',
    '    *) url="$1"; shift ;;',
    '  esac',
    'done',
    'printf \'%s\\n\' "$url" >> "$HOME/curl-argv"',
    'case "$url" in',
    '  local://*)',
    '    src="${url#local://}"',
    '    [ -f "$src" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }',
    '    cp "$src" "$dest" ;;',
    '  */api/updates/intent/*)',
    '    cat > /dev/null',
    '    cp "$HOME/fixture-intent-body" "$dest"',
    '    printf \'%s\' 200 ;;',
    '  *) echo "fixture curl: unexpected URL $url" >&2; exit 90 ;;',
    'esac',
    '',
  ].join('\n'), { mode: 0o755 });
  return home;
}

/** One run of the REAL puller against `body`. */
function pull(home: string, body: string): { code: number; stderr: string } {
  writeFileSync(path.join(home, 'fixture-intent-body'), body);
  const r = spawnSync('bash', [CCD_UPDATE_SYNC], { env: nodeEnv(home), encoding: 'utf8' });
  return { code: r.status ?? -1, stderr: r.stderr };
}

const intentFile = (home: string): string => path.join(home, '.ccrc', 'update-intent');

/** This box's real resolution of `name`, or null — for `envWithoutJq` below,
 *  which must remove exactly ONE tool from PATH without losing the others. */
function realTool(name: string): string | null {
  const r = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' });
  const p = r.stdout.trim();
  return p === '' ? null : p;
}

/** A minimal PATH carrying every tool `_upd_lock` and `cmd_update`'s
 *  preflight loop need, EXCEPT `jq` — the ONE place `cmd_update` can die
 *  BEFORE its first explicit `_upd_phase` call (fix round 1, F1a): the lock
 *  is taken, `UPD_REPORTING=1` is set, then the loop (`curl tar gzip node
 *  awk jq`, in that order) runs and dies on the last one — all BEFORE
 *  `_upd_phase resolving`, the first explicit write. */
function envWithoutJq(home: string): NodeJS.ProcessEnv {
  const bin = path.join(home, 'toolbin');
  mkdirSync(bin, { recursive: true });
  for (const t of ['curl', 'tar', 'gzip', 'node', 'awk', 'bash', 'sha256sum',
    'flock', 'date', 'mktemp', 'cat', 'printf', 'chmod', 'mv', 'rm', 'mkdir', 'cp', 'cmp']) {
    const p = realTool(t);
    if (p !== null) symlinkSync(p, path.join(bin, t));
  }
  const tmp = path.join(home, 'tmp');
  mkdirSync(tmp, { recursive: true });
  return ghContainedEnv(home, { HOME: home, TMPDIR: tmp, PATH: bin }, { systemd: true });
}

/** A real `local://` release layout under `root`/`dir`: SHA256SUMS (its REAL
 *  sha256, so `_plat_sha256_check` passes for real) + a real tar.gz, with NO
 *  `.sigstore.json` — the "release ships no provenance bundle" die (curl
 *  exit 22, D-3239) fires for real once `_upd_fetch` asks for it. `dir` is
 *  either `download/<tag>` (a resolved pin) or `latest/download` (the
 *  not-configured fallback) — both URL spaces `_upd_resolve` walks
 *  (`_upd_release_base`, ccd/ccrc). */
function releaseLayout(root: string, dir: string, tag: string): void {
  const relDir = path.join(root, dir);
  mkdirSync(relDir, { recursive: true });
  const tarballSrc = mkTmp('ccrc-cross-tarball-src-');
  writeFileSync(path.join(tarballSrc, 'somefile'), 'dummy content\n');
  const tarName = `ccrc-${tag}.tar.gz`;
  const t = spawnSync('tar', ['-czf', path.join(relDir, tarName), '-C', tarballSrc, '.'], { encoding: 'utf8' });
  if (t.status !== 0) throw new Error(`fixture tar failed: ${t.stderr}`);
  const sum = spawnSync('sha256sum', [tarName], { cwd: relDir, encoding: 'utf8' });
  if (sum.status !== 0) throw new Error(`fixture sha256sum failed: ${sum.stderr}`);
  writeFileSync(path.join(relDir, 'SHA256SUMS'), sum.stdout);
}

/** A `local://` curl stub matching `_upd_resolve`/`_upd_fetch`'s PLAIN
 *  `curl -fsSL -o dest [-w '%{http_code}'] url` invocation (no `-K`, unlike
 *  the intent route's) — the same shape `fleetNode`'s own `local://` case
 *  and `ccrc-update.test.ts`'s combined stub use whenever `-o` is present.
 *  D-3284 (final review): `_upd_fetch`'s bundle fetch now measures the
 *  status via `-w`, exactly as `_upd_asset_listed` (D-3261) already did —
 *  this stub answers it the same way the combined stub does, or `-w`'s
 *  VALUE argument (a bare `%{http_code}`, matching no `-*` case) would be
 *  misread as the URL by the positional-argument arm below. */
function plainLocalCurl(home: string): void {
  const bin = path.join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'curl'), [
    '#!/bin/sh',
    'dest=""; url=""; wfmt=""',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -o) dest="$2"; shift 2 ;;',
    '    -w) wfmt="$2"; shift 2 ;;',
    '    -*) shift ;;',
    '    *) url="$1"; shift ;;',
    '  esac',
    'done',
    'printf \'%s\\n\' "$url" >> "$HOME/curl-argv"',
    'src="${url#local://}"',
    '[ -f "$src" ] || { [ -n "$wfmt" ] && printf 404; echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }',
    // `if … fi`, not `[ -n "$wfmt" ] && printf 200`: with no `-w` (every
    // OTHER caller of this stub) that `&&` is FALSE and, being the script's
    // last command, would make a successful `cp` report exit 1 — the exact
    // shape `_upd_resolve`'s SHA256SUMS fetch reads as "download failed".
    'cp "$src" "$dest"',
    'if [ -n "$wfmt" ]; then printf 200; fi',
    '',
  ].join('\n'), { mode: 0o755 });
}

describeLinux('the real route → the real ccd-update-sync → the real _upd_intent_state (§9)', () => {
  it('fresh: the node reads what the server resolved, byte for byte, and in SECONDS', async () => {
    app = await openServer();
    const body = await routeBody(app);
    const home = fleetNode();
    const p = pull(home, body);
    expect(p.code, p.stderr).toBe(0);
    expect(p.stderr).toBe('');
    expect(readFileSync(path.join(home, 'curl-argv'), 'utf8'))
      .toBe(`https://example.invalid/api/updates/intent/${FLEET_ID}\n`);
    expect(readFileSync(intentFile(home), 'utf8')).toBe(body);
    expect(statSync(intentFile(home)).mode & 0o777).toBe(0o600);
    const got = readIntent(home);
    expect(got).toMatchObject({
      state: 'ok', role: 'fleet', channel: 'stable',
      desired: 'v0.0.11', desiredStable: 'v0.0.11', desiredDev: 'v0.0.12', auto: 'off',
    });
    expect(Number(got.epoch)).toBe(store!.updateEpoch().epoch);
    // SECONDS STAY SECONDS, measured on what the NODE read, against this
    // test's own clock — not on the route's JSON, which a ms bug on both
    // server-side ends would keep self-consistent.
    expect(PROJECTION_LEASE_S).toBe(900);
    expect(Number(got.lease) - Number(got.issued)).toBe(PROJECTION_LEASE_S);
    expect(Math.abs(Number(got.issued) - Date.now() / 1000)).toBeLessThanOrEqual(5);
  });

  it('the route\'s own document with its lease moved into the past reads STALE — C1, on this seam', async () => {
    app = await openServer();
    const body = await routeBody(app);
    // THE WRITER'S OWN OUTPUT, TWO FIELDS SHIFTED TOGETHER (pool-accounts-route.test.ts's
    // C1 technique): waiting out a real 15-minute lease is not a test. `issued`
    // and `lease` move back by the same 1000 s, so the route's own 900-s window
    // is kept and the lease ended ~100 s ago; moving the lease ALONE would put
    // it below its own `issued`, which the puller's value pass refuses (Task 10,
    // `issued <= lease <= issued + 86400`) before the reader could answer.
    // Every other byte, and the UNIT every number is in, is what the route
    // emitted: a route emitting ms leaves 13-digit numbers here, which the
    // puller refuses by their digit count — so this case reds (exit 1, not 0)
    // on exactly the regression it exists for.
    const back = (key: 'issued' | 'lease') => (doc: string): string =>
      doc.replace(new RegExp(`^${key} (\\d+)$`, 'm'), (_m, n: string) => `${key} ${Number(n) - 1000}`);
    const stale = back('lease')(back('issued')(body));
    expect(stale).not.toBe(body);
    const home = fleetNode();
    const p = pull(home, stale);
    expect(p.code, p.stderr).toBe(0);
    const got = readIntent(home);
    expect(got.state).toBe('stale');
    expect(got.why).toMatch(/^its lease ended \d+s ago$/);
  });

  it('whole or nothing: the route\'s document torn, over the cap, in ms, or disagreeing with its channel installs NOTHING', async () => {
    app = await openServer();
    const body = await routeBody(app);
    const home = fleetNode();
    expect(pull(home, body).code).toBe(0);
    const good = readFileSync(intentFile(home));
    const times1000 = (doc: string): string => doc.replace(/^(issued|lease) (\d+)$/gm,
      (_m, k: string, n: string) => `${k} ${Number(n) * 1000}`);
    // One control per python refusal update-projection.test.ts deleted, each
    // refused by the layer that owns it and asserted by THAT layer's own
    // diagnostic (ccd/ccd-update-sync's validator, Task 10): pass 2 for the
    // torn-write shape fault, pass 3 for the two value faults. The cap check
    // itself is PASS 0 since D-3280 (ahead of decoding, not pass 2). With the
    // REAL curl this fixture's stub stands in for, `--max-filesize 65536`
    // refuses an over-cap transfer before python ever sees the bytes; this
    // stub does not enforce that flag, so the over-cap case (a 70 000-digit
    // epoch, kept GRAMMATICAL so it clears pass 1/2 and actually reaches
    // PASS 0's own check) exercises the validator's BACKSTOP, not curl's
    // primary defense — a padding `x` line would be refused earlier still,
    // by pass 1's off-grammar check, and would not reach either.
    const cases: ReadonlyArray<readonly [string, string, RegExp]> = [
      ['torn — no `end` line', body.replace(/end\n$/, ''), /the document is not exactly nine lines/],
      // fix round 1 review, m2: the over-cap message says "more than", never
      // a specific byte count the bounded read cannot back up.
      ['over the cap', body.replace(/^epoch \d+$/m, `epoch 1${'0'.repeat(70_000)}`),
        /the document is more than 65536 bytes, at or over the 65536-byte cap/],
      ['milliseconds in issued and lease', times1000(body), /issued carries 13 digits/],
      ['desired disagrees with desired-stable', body.replace('\ndesired v0.0.11\n', '\ndesired v0.0.12\n'),
        /desired v0\.0\.12 disagrees with desired-stable v0\.0\.11/],
    ];
    for (const [label, doc, why] of cases) {
      expect(doc, label).not.toBe(body);
      const p = pull(home, doc);
      expect(p.code, label).toBe(1);
      expect(p.stderr, label).toMatch(why);
      expect(p.stderr, label).toMatch(/unmeasured — the control plane answered a document this reader does not recognise/);
      expect(readFileSync(intentFile(home)).equals(good), `${label}: the good projection was replaced`).toBe(true);
    }
    expect(readIntent(home).state).toBe('ok');
  });

  it('ccrc update --check with no --to resolves the ROUTE\'s desired — never latest/download', async () => {
    app = await openServer();
    const body = await routeBody(app);
    const home = fleetNode();
    expect(pull(home, body).code).toBe(0);
    const releases = path.join(home, 'releases');
    mkdirSync(path.join(releases, 'download', 'v0.0.11'), { recursive: true });
    writeFileSync(path.join(releases, 'download', 'v0.0.11', 'SHA256SUMS'), `${'0'.repeat(64)}  ccrc-v0.0.11.tar.gz\n`);
    writeFileSync(path.join(home, 'curl-argv'), '');
    const r = spawnSync('bash', [CCRC, 'update', '--check'],
      { env: { ...nodeEnv(home), CCRC_RELEASE_BASE_URL: `local://${releases}` }, encoding: 'utf8' });
    // Unstamped fixture box: `unversioned`, exit 1 (cmd_update's --check arm).
    // `caps=`/`floor=` sit between `target=` and `state=` (Task 12); the
    // pattern does not care whether they are there.
    expect(r.stdout, r.stderr).toMatch(/^check: box=unversioned sha=none target=v0\.0\.11 .*state=unversioned$/m);
    // Task 8's `_upd_target` sentence, printed on the line AFTER the machine line.
    expect(r.stdout).toMatch(/^update: following the control plane — channel stable, desired v0\.0\.11$/m);
    expect(r.status).toBe(1);
    expect(readFileSync(path.join(home, 'curl-argv'), 'utf8').split('\n').filter((l) => l !== ''))
      .toEqual([`local://${releases}/download/v0.0.11/SHA256SUMS`]);
  });
});

describe('the other direction: a real _upd_phase report through W2\'s real reportFrom (§8, §10)', () => {
  it('both instants survive the seam in coord.db\'s ms, and the seventh key (pid) is ignored', () => {
    const home = mkTmp('ccrc-cross-report-');
    const t0 = Date.now();
    const r = spawnSync('bash', ['-c', [
      'source "$1" >/dev/null || exit 90',
      'UPD_REPORT_TARGET=v0.0.11; UPD_FROM=rollout',
      "_upd_phase installing 'fixture detail'",
      'cat "$HOME/.ccrc/update.json"',
      '_upd_phase done',
      'cat "$HOME/.ccrc/update.json"',
    ].join('\n'), '_', CCRC], { env: nodeEnv(home), encoding: 'utf8' });
    const t1 = Date.now();
    expect(r.status, r.stderr).toBe(0);
    const [first, second] = r.stdout.split('\n').filter((l) => l !== '');
    // The report W2 reads is the seven-key one (D-3237), so
    // "ignored" below means ignored, not absent.
    const rawA = JSON.parse(first!) as Record<string, unknown>;
    const rawB = JSON.parse(second!) as Record<string, unknown>;
    expect(Object.keys(rawA)).toEqual(['target', 'phase', 'startedAt', 'updatedAt', 'detail', 'from', 'pid']);
    const a = reportFrom({ ok: true, content: `${first}\n` });
    const b = reportFrom({ ok: true, content: `${second}\n` });
    expect(a).toMatchObject({ phase: 'installing', target: 'v0.0.11', detail: 'fixture detail' });
    expect(b).toMatchObject({ phase: 'done', target: 'v0.0.11', detail: null });
    expect(Object.keys(a!).sort()).toEqual(['detail', 'phase', 'startedAt', 'target', 'updatedAt']);
    // THE `pid` KEY IS IGNORED (rulings R2, R15): the same report without it
    // reads identically — W2 Task 11's "an extra key is ignored", from this side.
    const { pid: _pid, ...withoutPid } = rawA;
    expect(reportFrom({ ok: true, content: `${JSON.stringify(withoutPid)}\n` })).toEqual(a);
    // THE SAME REAL WRITE, WITH ITS OWN startedAt SHIFTED TO MS: the server
    // refuses the ms shape of what a genuine `_upd_phase` wrote, not a
    // synthetic fixture — `reportFrom` nulls it (UNIX_SECONDS_MAX).
    const msShifted = { ...rawA, startedAt: (rawA['startedAt'] as number) * 1000 };
    expect(reportFrom({ ok: true, content: `${JSON.stringify(msShifted)}\n` })!.startedAt).toBeNull();
    // THE UNIT IS SETTLED — unix SECONDS (rulings R1, R14): the file carries
    // 10-digit seconds, and W2's value is EXACTLY that instant ×1000, inside
    // this test's own clock. A writer that drifted to ms reds on the digits
    // (and, past Task 1's seconds guard, is NULLED by UNIX_SECONDS_MAX); a
    // reader that stopped converting reds on the equality (a 1970 instant).
    const lo = Math.floor(t0 / 1000) * 1000;
    const instants: ReadonlyArray<readonly [string, unknown, number | null]> = [
      ['startedAt', rawA['startedAt'], a!.startedAt], ['updatedAt', rawA['updatedAt'], a!.updatedAt],
      ['done updatedAt', rawB['updatedAt'], b!.updatedAt],
    ];
    for (const [label, raw, v] of instants) {
      expect(String(raw), `${label}: update.json is not unix seconds`).toMatch(/^\d{10}$/);
      expect(v, `${label} was nulled — W2's reportFrom refused what _upd_phase wrote`).not.toBeNull();
      expect(v, label).toBe((raw as number) * 1000);
      expect(v!, label).toBeGreaterThanOrEqual(lo);
      expect(v!, label).toBeLessThanOrEqual(t1);
    }
    expect(b!.startedAt, 'one process, one start').toBe(a!.startedAt);
    expect(b!.updatedAt!).toBeGreaterThanOrEqual(a!.updatedAt!);
  });

  // FIX ROUND 1, F1a (controller-mandated pin, committed — a throwaway
  // measurement is not a pin). `reportFrom` nulls a `startedAt` that is
  // absent/0/non-integer/over UNIX_SECONDS_MAX (W2 D-3214's report
  // precedence), and such a report can never move a lease. `_ccrc_die`'s
  // report hook is the one place a `failed` report can be the FIRST write
  // this run ever makes — before `_upd_phase resolving`, the run's first
  // EXPLICIT phase — so this pins that even that write carries a real,
  // non-null `startedAt`.
  it('(a) a die BEFORE any explicit _upd_phase (UPD_REPORTING=1, the jq preflight) still carries a real, non-null startedAt', () => {
    const home = mkTmp('ccrc-cross-die-preflight-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    const t0 = Date.now();
    const r = spawnSync('bash', [CCRC, 'update'], { env: envWithoutJq(home), encoding: 'utf8' });
    const t1 = Date.now();
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: jq is required by 'ccrc update' but is not on PATH/m);
    const content = readFileSync(path.join(home, '.ccrc', 'update.json'), 'utf8');
    const raw = JSON.parse(content) as Record<string, unknown>;
    expect(raw['phase']).toBe('failed');
    expect(String(raw['startedAt']), 'update.json is not unix seconds').toMatch(/^\d{10}$/);
    const rep = reportFrom({ ok: true, content });
    expect(rep, 'W2\'s reportFrom could not read the real writer\'s own output').not.toBeNull();
    expect(rep!.startedAt, 'W2\'s reportFrom nulled a startedAt _upd_phase actually wrote').not.toBeNull();
    expect(rep!.startedAt).toBe((raw['startedAt'] as number) * 1000);
    expect(rep!.startedAt!).toBeGreaterThanOrEqual(Math.floor(t0 / 1000) * 1000);
    expect(rep!.startedAt!).toBeLessThanOrEqual(t1);
  });
});

// FIX ROUND 1, F1b (controller-mandated pin, committed). W2 refuses a
// release on a `failed` report whose detail starts `provenance: ` ONLY when
// `target` is a release tag (W2 D-3239's own gate, `inventory.ts:420`
// `isReleaseTag(r.target)`) — so a die that writes an empty/non-tag target
// on a provenance failure would refuse NOTHING on the server. `ccd/ccrc`
// sets `UPD_REPORT_TARGET="$UPD_VERSION"` right after `_upd_resolve`
// returns (line ~11872), unconditionally, before `_upd_fetch` (where every
// provenance die lives) ever runs — true whichever of `_upd_target`'s two
// arms resolved it: the PROJECTION (`ok`/`none`, this box's `desired`) or
// the not-configured `latest/download` fallback, where the tag is not known
// until SHA256SUMS answers. Both are measured here, for real: a real
// tar.gz, a real sha256sum, curl exit 22 for the absent bundle, the real
// D-3239 die.
describeLinux('the D-3239 no-bundle provenance die, no --to (§8, §10)', () => {
  it('(b) resolved from the PROJECTION: target is the resolved tag, not null', () => {
    const home = mkTmp('ccrc-cross-provenance-projection-');
    plantNode(home, 'fleet');
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(path.join(home, '.ccrc', 'update-intent'), [
      'epoch 1', `issued ${now}`, `lease ${now + 900}`, 'channel stable',
      'desired v0.0.11', 'desired-stable v0.0.11', 'desired-dev v0.0.12', 'auto off', 'end', '',
    ].join('\n'), { mode: 0o600 });
    const releases = path.join(home, 'releases');
    releaseLayout(releases, 'download/v0.0.11', 'v0.0.11');
    plainLocalCurl(home);
    const r = spawnSync('bash', [CCRC, 'update'],
      { env: { ...nodeEnv(home), CCRC_RELEASE_BASE_URL: `local://${releases}` }, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: the release ships no provenance bundle .* installs only with --allow-unsigned/m);
    const content = readFileSync(path.join(home, '.ccrc', 'update.json'), 'utf8');
    const raw = JSON.parse(content) as Record<string, unknown>;
    expect(raw['phase']).toBe('failed');
    expect(raw['target'], 'the real writer\'s own target').toBe('v0.0.11');
    const rep = reportFrom({ ok: true, content });
    expect(rep!.target, 'W2\'s reportFrom read the target as null — its provenance gate would refuse nothing').toBe('v0.0.11');
    expect(rep!.detail).toMatch(/^provenance: /);
  });

  it('(b2) resolved on a NOT-CONFIGURED box following latest/download: target is the tag SHA256SUMS named, not null', () => {
    const home = mkTmp('ccrc-cross-provenance-latest-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    // Deliberately NO ccrc.env role, NO update-intent file, NO timer unit —
    // `_upd_intent_state` answers `not-configured`, and `_upd_target`
    // follows `latest/download`: the tag is unknown until SHA256SUMS names it.
    const releases = path.join(home, 'releases');
    releaseLayout(releases, 'latest/download', 'v0.0.13');
    plainLocalCurl(home);
    const r = spawnSync('bash', [CCRC, 'update'],
      { env: { ...nodeEnv(home), CCRC_RELEASE_BASE_URL: `local://${releases}` }, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: the release ships no provenance bundle .* installs only with --allow-unsigned/m);
    const content = readFileSync(path.join(home, '.ccrc', 'update.json'), 'utf8');
    const raw = JSON.parse(content) as Record<string, unknown>;
    expect(raw['phase']).toBe('failed');
    expect(raw['target'], 'the real writer\'s own target').toBe('v0.0.13');
    const rep = reportFrom({ ok: true, content });
    expect(rep!.target, 'W2\'s reportFrom read the target as null — its provenance gate would refuse nothing').toBe('v0.0.13');
    expect(rep!.detail).toMatch(/^provenance: /);
  });
});

describeLinux('ccrc watchdog classifies EXACTLY W2\'s IN_FLIGHT_UPDATE_PHASES as in flight (§11)', () => {
  it('every UPDATE_PHASES word: in flight → "update in progress", anything else → "nothing to do"', () => {
    const home = mkTmp('ccrc-cross-watchdog-');
    plantNode(home, 'server');
    // A REAL report as the template, so its times are in the writer's own unit
    // — the one the watchdog's age arithmetic reads (Task 9) — and fresh.
    const w = spawnSync('bash', ['-c', [
      'source "$1" >/dev/null || exit 90',
      'UPD_REPORT_TARGET=v0.0.11',
      '_upd_phase installing',
      'cat "$HOME/.ccrc/update.json"',
    ].join('\n'), '_', CCRC], { env: nodeEnv(home), encoding: 'utf8' });
    expect(w.status, w.stderr).toBe(0);
    const template = JSON.parse(w.stdout.trim()) as Record<string, unknown>;
    const inFlight: readonly string[] = IN_FLIGHT_UPDATE_PHASES;
    expect(UPDATE_PHASES.length).toBe(13);
    for (const phase of UPDATE_PHASES) {
      writeFileSync(path.join(home, '.ccrc', 'update.json'), `${JSON.stringify({ ...template, phase })}\n`);
      const r = spawnSync('bash', [CCRC, 'watchdog'], { env: nodeEnv(home), encoding: 'utf8' });
      expect(r.status, `${phase}: ${r.stderr}`).toBe(0);
      if (inFlight.includes(phase)) {
        expect(r.stdout, phase).toMatch(new RegExp(`^watchdog: update in progress \\(${phase}, \\d+s old\\)$`, 'm'));
      } else {
        expect(r.stdout, phase).toMatch(new RegExp(`^watchdog: last update ${phase} — nothing to do$`, 'm'));
      }
    }
  });
});
