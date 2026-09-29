// Fix round 1 item 4 (review 175 F6, D-3405 amended): when the deadline fails the SERVER-ROLE lease and this box's own
// `update.json` says the WATCHDOG wrote it after the lease began, the failed row's words say the box was reverted (or that
// the revert failed) instead of a bare `deadline`. Two halves:
//   1. the two PURE functions (`parseReportOrigin`, `deadlineDetail` — L1, dispatch.ts) unit-pinned;
//   2. the REAL report sequence: W4's `ccd/ccrc rollback --from watchdog` run for real inside a CONTAINED fixture, every
//      `update.json` write captured, then the server driven over it — the row ends `failed` with the composed words,
//      halts, and its request columns are unchanged.
//
// CONTAINMENT (structural, `updateRealBox.ts`'s rule): the env handed to the real verb is built FROM SCRATCH — HOME is the
// fixture, PATH is `<home>/bin:/usr/local/bin:/usr/bin:/bin`, never the operator's `~/.local/bin` and never a spread of
// `process.env`. `plantRealBox` puts a poisoned RECORDING `systemd-run` first on that PATH and this file asserts it was
// never called (a rollback is not `--detach`); `systemctl` and `curl` are answering RECORDERS whose every argv is checked
// against the shapes the verb is expected to use, so a call outside them reds instead of reaching a unit manager or the
// network. The staged spine is W4's STUB flavour (a recorder), so nothing is installed. `~/ccrc/ccd`, which `plantRealBox`
// links to the checkout for the launcher cases, is REMOVED (the link only) so a verb that writes under `~/ccrc` can never
// write through it into this tree. No secret is read or printed. `watchdogBox` also plants poisoned, recording `tmux` and
// `gh` first on PATH (residue R6): two controls prove they resolve first and that `expectContained`'s lines can red, and a
// mutation that removes either plant is run ONLY against those two controls, by `-t` — never a real-sequence case, whose
// contained PATH would then resolve the real `/usr/bin/tmux` or the real `gh` if a merged `ccd/ccrc` ever called either.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPDATE_OP_DETAIL_MAX } from '../../shared/agent-protocol.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type ReleaseListingRow } from '../src/coord/store.js';
import { localIO, type FleetIO } from '../src/io.js';
import {
  runDispatch, type ConvergeDeps, type DispatchRunResult,
} from '../src/update/converge.js';
import {
  DEADLINE_DETAIL, deadlineDetail, isHalting, parseReportOrigin, type ReportOrigin,
} from '../src/update/dispatch.js';
import { SERVER_LABEL, measureNode, sweepPlanFor, type SweepPlan } from '../src/update/inventory.js';
import { CCRC_SRC, plantRealBox } from './updateRealBox.js';
import { itLinux } from './platformFixtures.js';
import { spawnFromRunner } from './updateSpawnFake.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const BASH = '/bin/bash';

// ── 1. the pure functions ───────────────────────────────────────────────────────────────────────────────────────────

const rep = (o: Record<string, unknown> = {}): string =>
  JSON.stringify({ target: 'v0.0.9', phase: 'done', startedAt: 1_790_000_100, updatedAt: 1_790_000_200, detail: null, from: 'watchdog', pid: 4242, ...o });
const origin = (o: Partial<ReportOrigin> = {}): ReportOrigin => ({
  from: 'watchdog', phase: 'done', target: 'v0.0.9', updatedAt: 1_790_000_200_000, detail: null, ...o,
});
const serverRow = { agentOps: null, updateStartedAt: 1_790_000_000_000 } as const;

describe('parseReportOrigin — the ONE parse of a report\'s writer, phase, target, time and detail (F6)', () => {
  it('reads all five by name from one JSON object; the time is converted from SECONDS to ms once', () => {
    expect(parseReportOrigin(rep({ phase: 'failed', detail: 'rollback to v0.0.9: gate: x' }))).toEqual({
      from: 'watchdog', phase: 'failed', target: 'v0.0.9', updatedAt: 1_790_000_200_000, detail: 'rollback to v0.0.9: gate: x',
    });
  });

  it('a word it cannot name folds to a value that composes to nothing, never a guess: an unknown phase is `unknown`, a non-tag target and a non-string from are null, a 13-digit (ms) time is refused, not divided', () => {
    expect(parseReportOrigin(rep({ phase: 'bogus', target: 'latest', from: 7, updatedAt: 1_790_000_200_000 }))).toEqual({
      from: null, phase: 'unknown', target: null, updatedAt: null, detail: null,
    });
    expect(parseReportOrigin(rep({ updatedAt: -5 }))?.updatedAt).toBeNull();
    expect(parseReportOrigin(rep({ updatedAt: 1.5 }))?.updatedAt).toBeNull();
    expect(parseReportOrigin(rep({ updatedAt: '1790000200' }))?.updatedAt).toBeNull();
  });

  it('anything that is not one JSON object is null: garbage, an array, a scalar', () => {
    for (const t of ['', 'not json', '[]', '7', 'null', '"watchdog"']) expect(parseReportOrigin(t), t).toBeNull();
  });
});

describe('deadlineDetail — the failed-deadline words for the server-role row (F6)', () => {
  it('a watchdog `done <t>` written after the lease began: the watchdog reverted this box to <t>', () => {
    expect(deadlineDetail(serverRow, origin())).toBe(`${DEADLINE_DETAIL} — the watchdog reverted this box to v0.0.9`);
  });

  it('a watchdog `failed` after the lease began: the rollback to <t> failed, with the node\'s own words passed through the one-line bound', () => {
    expect(deadlineDetail(serverRow, origin({ phase: 'failed', detail: 'rollback to v0.0.9: gate: /health answered v0.0.10' })))
      .toBe(`${DEADLINE_DETAIL} — the watchdog's rollback to v0.0.9 failed: rollback to v0.0.9: gate: /health answered v0.0.10`);
    // Multi-line, control bytes and no words at all are `firstStderrLine`'s to bound, exactly as every other node word.
    expect(deadlineDetail(serverRow, origin({ phase: 'failed', detail: '\n\x1b[31mfirst\nsecond' })))
      .toBe(`${DEADLINE_DETAIL} — the watchdog's rollback to v0.0.9 failed: [31mfirst`);
    expect(deadlineDetail(serverRow, origin({ phase: 'failed', detail: null })))
      .toBe(`${DEADLINE_DETAIL} — the watchdog's rollback to v0.0.9 failed: no message`);
  });

  it('the whole detail stays within UPDATE_OP_DETAIL_MAX — it is the node\'s words that are cut, the head is kept', () => {
    const d = deadlineDetail(serverRow, origin({ phase: 'failed', detail: 'x'.repeat(5000) }));
    expect(d.length).toBe(UPDATE_OP_DETAIL_MAX);
    expect(d.startsWith(`${DEADLINE_DETAIL} — the watchdog's rollback to v0.0.9 failed: xxx`)).toBe(true);
    expect(deadlineDetail(serverRow, origin({ target: `v${'9'.repeat(400)}.0.0` })).length).toBeLessThanOrEqual(UPDATE_OP_DETAIL_MAX);
  });

  it('the clock: `updatedAt` must be LATER than `updateStartedAt` — equal or earlier keeps the plain word, one ms later composes', () => {
    expect(deadlineDetail({ ...serverRow, updateStartedAt: 1_790_000_200_000 }, origin())).toBe(DEADLINE_DETAIL);
    expect(deadlineDetail({ ...serverRow, updateStartedAt: 1_790_000_200_001 }, origin())).toBe(DEADLINE_DETAIL);
    expect(deadlineDetail({ ...serverRow, updateStartedAt: 1_790_000_199_999 }, origin())).toMatch(/the watchdog reverted/);
  });

  it('every other report keeps the plain word: another writer, no writer, another phase, no target, no time, no report, an undated lease, and a FLEET row (agentOps set)', () => {
    for (const o of [
      origin({ from: 'cli' }), origin({ from: 'pwa' }), origin({ from: null }), origin({ from: 'Watchdog' }),
      origin({ phase: 'reverted' }), origin({ phase: 'installing' }), origin({ phase: 'restoring' }), origin({ phase: 'unknown' }),
      origin({ target: null }), origin({ updatedAt: null }),
    ]) expect(deadlineDetail(serverRow, o), JSON.stringify(o)).toBe(DEADLINE_DETAIL);
    expect(deadlineDetail(serverRow, null)).toBe(DEADLINE_DETAIL);
    expect(deadlineDetail({ agentOps: null, updateStartedAt: null }, origin())).toBe(DEADLINE_DETAIL);
    expect(deadlineDetail({ agentOps: ['update'], updateStartedAt: serverRow.updateStartedAt }, origin())).toBe(DEADLINE_DETAIL);
    expect(deadlineDetail({ agentOps: [], updateStartedAt: serverRow.updateStartedAt }, origin())).toBe(DEADLINE_DETAIL);
  });
});

// ── 2. the real report sequence ─────────────────────────────────────────────────────────────────────────────────────

// The two tags the fixture uses: the lease is for X (the update that was being applied and that the watchdog reverted);
// the box's `previous` is P, which `cmd_rollback --from watchdog` returns to. Both are in the coord listing so the row's
// request for X is a real one.
const X = 'v0.0.10';
const P = 'v0.0.9';
const PREV_SHA = 'a'.repeat(40);

const realTool = (name: string): string => {
  const p = spawnSync(BASH, ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (p === '') throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
};
const REAL_MV = realTool('mv');
const REAL_NODE = realTool('node');

const plant = (file: string, body: string): void => { writeFileSync(file, body); chmodSync(file, 0o755); };

/** The combined `curl` (W4's, trimmed to what a rollback asks): `local://<path>` is a release asset, any URL recorded to
 *  `<home>/curl-argv`; `/health` (the gate's probe) answers the version in `fixture-health-pin` while that file exists,
 *  else the one the staged spine "installed" (`fixture-health-version`). Anything else is refused, recorded to
 *  `<home>/curl-unexpected`. */
const CURL = [
  '#!/bin/sh',
  'dest=""; url=""; wfmt=""',
  'while [ $# -gt 0 ]; do',
  '  case "$1" in',
  '    -o) dest="$2"; shift 2 ;;',
  '    -w) wfmt="$2"; shift 2 ;;',
  '    -H|--max-time|--max-filesize|--connect-timeout|--speed-limit|--speed-time) shift 2 ;;',
  '    -*) shift ;;',
  '    *) url="$1"; shift ;;',
  '  esac',
  'done',
  'printf \'%s\\n\' "$url" >> "$HOME/curl-argv"',
  'case "$url" in',
  '  local://*)',
  '    src="${url#local://}"',
  '    if [ ! -f "$src" ]; then',
  '      [ -n "$wfmt" ] && printf 404',
  '      echo "curl: (22) The requested URL returned error: 404 for $url" >&2; exit 22',
  '    fi',
  '    cp "$src" "$dest"; if [ -n "$wfmt" ]; then printf 200; fi ;;',
  '  http://127.0.0.1:*/health)',
  '    v=""',
  '    if [ -f "$HOME/fixture-health-pin" ]; then IFS= read -r v < "$HOME/fixture-health-pin"',
  '    elif [ -f "$HOME/fixture-health-version" ]; then IFS= read -r v < "$HOME/fixture-health-version"; fi',
  '    build="$(jq -c . "$HOME/.ccrc/build.json" 2>/dev/null)" || build=null; [ -n "$build" ] || build=null',
  '    if [ -n "$v" ]; then body="$(printf \'{"ok":true,"build":%s,"version":"%s"}\' "$build" "$v")"',
  '    else body="$(printf \'{"ok":true,"build":%s}\' "$build")"; fi',
  '    if [ -n "$wfmt" ]; then printf \'%s\\n200\' "$body"; else printf \'%s\\n\' "$body"; fi ;;',
  '  *) printf \'%s\\n\' "$url" >> "$HOME/curl-unexpected"; echo "fixture curl: unexpected url: $url" >&2; exit 90 ;;',
  'esac',
].join('\n') + '\n';

/** The answering `systemctl` (W4's, trimmed): every call recorded to `<home>/systemctl-calls`; the shapes a rollback's gate
 *  and sweep use are answered, anything else is recorded to `<home>/systemctl-unexpected` and refused. No unit exists. */
const SYSTEMCTL = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$*" >> "$HOME/systemctl-calls"',
  'no() { printf \'%s\\n\' "$*" >> "$HOME/systemctl-unexpected"; echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
  '[ "$1" = "--user" ] || no "$@"',
  'shift',
  'case "$1" in',
  '  daemon-reload) exit 0 ;;',
  '  is-active) echo active; exit 0 ;;',
  '  list-units) [ "$2" = "claude-session@*" ] || no --user "$@"; exit 0 ;;',
  '  show)',
  '    if [ "$2" = "-p" ] && [ "$3" = "KillMode" ] && [ -n "$4" ]; then echo "KillMode=control-group"; exit 0; fi',
  '    if [ "$2" = "-p" ] && [ "$3" = "MainPID" ] && [ "$4" = "--value" ]; then echo 4242; exit 0; fi',
  '    no --user "$@" ;;',
  'esac',
  'no --user "$@"',
].join('\n') + '\n';

/** A recording `mv`: when the destination is `~/.ccrc/update.json` the SOURCE file\'s one line is appended to
 *  `<home>/update-json-writes` before the real rename, so every recorded line is a report that arrived BY RENAME, in the
 *  order `_upd_phase` placed them. */
const MV = [
  '#!/bin/sh',
  'src=""; dst=""',
  'for a in "$@"; do src="$dst"; dst="$a"; done',
  'case "$dst" in',
  '  */.ccrc/update.json)',
  '    if [ -f "$src" ]; then',
  '      while IFS= read -r l || [ -n "$l" ]; do printf \'%s\\n\' "$l"; done < "$src" >> "$HOME/update-json-writes"',
  '    fi ;;',
  'esac',
  `exec ${REAL_MV} "$@"`,
].join('\n') + '\n';

/** The verifier seam: `ccrc update` runs `deploy/verify-provenance.mjs` under `node`; this shim answers THAT invocation
 *  as verified and execs the real node for anything else. */
const NODE = [
  '#!/bin/sh',
  'case "$1 $2" in',
  '  *verify-provenance.mjs*) echo "verified fixture (sigstore)"; exit 0 ;;',
  'esac',
  `exec ${REAL_NODE} "$@"`,
].join('\n') + '\n';

const sha256 = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
const stamp = (version: string, sha: string): string =>
  `{"sha":"${sha}","ref":"release","builtAt":"2026-08-21T00:00:00Z","dirty":false,"version":"${version}"}\n`;

/** The STUB release payload for `tag`: `ccd/ccrc` is a recorder that records the argv it was staged with and writes the
 *  `/health` version this "install" placed. The MANIFEST is generated as `build-release.sh` does. */
function packStub(home: string, tag: string): void {
  const tree = join(home, `payload-${tag}`);
  mkdirSync(join(tree, 'ccd'), { recursive: true });
  plant(join(tree, 'ccd', 'ccrc'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$0" "$@" > "$HOME/staged-ccrc-argv"',
    `printf '%s\\n' '${tag}' > "$HOME/fixture-health-version"`,
    'exit 0',
  ].join('\n') + '\n');
  writeFileSync(join(tree, 'MARKER'), 'release payload\n');
  writeFileSync(join(tree, 'build.json'), stamp(tag, 'b'.repeat(40)));
  const tmp = `${tree}.MANIFEST.tmp`;
  const m = spawnSync(BASH, ['-c',
    'cd "$1" && find . -type f | sed \'s|^\\./||\' | LC_ALL=C sort | tr \'\\n\' \'\\0\' | xargs -0 sha256sum > "$2"', '--', tree, tmp],
  { encoding: 'utf8' });
  if (m.status !== 0) throw new Error(`fixture MANIFEST failed: ${m.stderr}`);
  renameSync(tmp, join(tree, 'MANIFEST'));
  const rel = join(home, 'releases', 'download', tag);
  mkdirSync(rel, { recursive: true });
  const name = `ccrc-${tag}.tar.gz`;
  const t = spawnSync('tar', ['-czf', join(rel, name), '-C', tree, '.'], { encoding: 'utf8' });
  if (t.status !== 0) throw new Error(`fixture tar failed: ${t.stderr}`);
  writeFileSync(join(rel, 'SHA256SUMS'), `${sha256(join(rel, name))}  ${name}\n`);
  writeFileSync(join(rel, `${name}.sigstore.json`), `{"fixture":"bundle for ${name}"}\n`);
}

interface WatchdogBox { home: string; env: NodeJS.ProcessEnv }

/** A box that is on X after an update that did not gate, whose `previous` names P, contained as above. `gateFails` pins
 *  `/health` to X for the whole run, so the rollback's own gate fails (`_upd_rollback_no_restore`). */
function watchdogBox(prefix: string, o: { gateFails?: true } = {}): WatchdogBox {
  const home = mkTmp(prefix);
  const { env: base } = plantRealBox(home);
  // The launcher case's link to the live checkout is not this file's: remove the LINK, never what it points at.
  const link = join(home, 'ccrc', 'ccd');
  if (lstatSync(link).isSymbolicLink()) rmSync(link);
  plant(join(home, 'bin', 'systemctl'), SYSTEMCTL);
  plant(join(home, 'bin', 'curl'), CURL);
  plant(join(home, 'bin', 'mv'), MV);
  plant(join(home, 'bin', 'node'), NODE);
  plant(join(home, 'bin', 'df'), [
    '#!/bin/sh',
    '[ "$1" = "-Pk" ] && [ -n "$2" ] || { echo "fixture df: unexpected argv: $*" >&2; exit 90; }',
    'echo "Filesystem     1024-blocks      Used Available Capacity Mounted on"',
    'echo "/dev/fixture0    104857600  20971520 42991616      21% /"',
  ].join('\n') + '\n');
  // Poisoned, recording — residue R6: nothing in this fixture may reach the real tmux (the live fleet server) or
  // the real gh (a repo-WRITE token). Two controls below prove they resolve first and that `expectContained`'s
  // lines can red.
  plant(join(home, 'bin', 'tmux'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/tmux-argv"\nexit 97\n');
  plant(join(home, 'bin', 'gh'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/gh-argv"\nexit 97\n');
  // The box: an old tree, the build stamp of X, the completed-install record, the floor, and `previous` = P.
  mkdirSync(join(home, 'ccrc', 'server', 'dist'), { recursive: true });
  writeFileSync(join(home, 'ccrc', 'server', 'OLD-MARKER'), 'the previous tree\n');
  const ccrc = join(home, '.ccrc');
  writeFileSync(join(ccrc, 'build.json'), stamp(X, 'c'.repeat(40)));
  writeFileSync(join(ccrc, 'installed'), `${'c'.repeat(40)}\n`);
  writeFileSync(join(ccrc, 'floor'), `${X}\n`);
  writeFileSync(join(ccrc, 'previous'), `${P}\n${PREV_SHA}\n`);
  packStub(home, P);
  if (o.gateFails === true) writeFileSync(join(home, 'fixture-health-pin'), `${X}\n`);
  mkdirSync(join(home, 'tmp'), { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...base,
    TMPDIR: join(home, 'tmp'),
    CCRC_RELEASE_BASE_URL: `local://${home}/releases`,
    CCRC_UPDATE_HEALTH_S: '0', CCRC_VERIFY_SETTLE: '0', CCRC_VERIFY_WINDOW: '0',
  };
  return { home, env };
}

/** The real verb, from the CHECKOUT's own `ccd/ccrc`, against the fixture. `update.json` is emptied first: the box is
 *  in the state the watchdog finds it in, its last report a stale `installing` of the failed update, so every write the
 *  revert makes is recorded from the first. */
function runWatchdogRollback(box: WatchdogBox): { code: number; stdout: string; stderr: string; writes: Array<Record<string, unknown>> } {
  writeFileSync(join(box.home, '.ccrc', 'update.json'),
    `{"target":"${X}","phase":"installing","startedAt":1,"updatedAt":1,"detail":null,"from":"pwa","pid":999999}\n`);
  const r = spawnSync(BASH, [CCRC_SRC, 'rollback', '--from', 'watchdog'], { env: box.env, encoding: 'utf8' });
  const wf = join(box.home, 'update-json-writes');
  const writes = existsSync(wf)
    ? readFileSync(wf, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', writes };
}

/** Everything the fixture must NOT have reached: no transient unit, no unmodelled systemctl or curl shape. */
function expectContained(home: string): void {
  expect(existsSync(join(home, 'systemd-run-argv')), 'a rollback reached systemd-run (poisoned, recording)').toBe(false);
  expect(existsSync(join(home, 'systemctl-unexpected')), 'an unmodelled systemctl call').toBe(false);
  expect(existsSync(join(home, 'curl-unexpected')), 'an unmodelled curl call').toBe(false);
  expect(existsSync(join(home, 'tmux-argv')), 'a rollback reached tmux (poisoned, recording)').toBe(false);
  expect(existsSync(join(home, 'gh-argv')), 'a rollback reached gh (poisoned, recording)').toBe(false);
}

// ── the server side, over a real CoordStore ────────────────────────────────────────────────────────────────────────

const SERVER_ID = '05050505-0505-4505-8505-050505050505';
const FLEET_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
const DEADLINE = 900_000;
const rel = (tag: string, publishedAt: number): ReleaseListingRow => ({
  tag, channel: 'stable', publishedAt, commitSha: null, tarballUrl: `https://example.invalid/download/${tag}/ccrc-${tag}.tar.gz`,
  bundleListed: true, notes: null, draft: false,
});
const meas = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: SERVER_ID, role: 'server', label: SERVER_LABEL,
  currentVersion: P, currentSha: 'a'.repeat(40), currentRef: 'main', currentBuiltAt: '2026-09-20T00:00:00Z',
  currentDirty: false, stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor', 'update-json', 'detach', 'rollback'], agentOps: null,
  highestVersion: P, previousVersion: 'v0.0.8', floorRead: 'measured', previousRead: 'measured', os: 'linux', measuredAt: 0, report: null,
  ...over,
});

interface Server {
  store: CoordStore; deps: ConvergeDeps; ioReads: string[]; spawnedArgvs: string[][];
}

/** A store with a server row (and optionally a fleet row) and a `runDispatch` deps over it whose `localIo` reads the
 *  fixture HOME's real files, recording every path it was asked to lstat. The server-role spawn is the recording double
 *  (`spawnFromRunner`): the spawn is not this file's subject. */
function server(home: string, o: { fleet?: boolean } = {}): Server {
  const store = new CoordStore(openCoordDb(join(home, 'coord.db')));
  const t = Date.now();
  expect(store.applyReleaseListing([rel('v0.0.8', t - 3000), rel(P, t - 2000), rel(X, t - 1000)], t - 500, 'complete').ok).toBe(true);
  expect(store.upsertNodeMeasurement(meas({ currentVersion: P, highestVersion: P, measuredAt: t })).ok).toBe(true);
  expect(store.requestNode(SERVER_ID, X, 'update', t).ok).toBe(true);
  if (o.fleet === true) {
    expect(store.upsertNodeMeasurement(meas({ nodeId: FLEET_ID, role: 'fleet', label: 'fleet', agentOps: ['update'], measuredAt: t })).ok).toBe(true);
  }
  const ioReads: string[] = [];
  const io: FleetIO = { ...localIO, lstatMeasured: (p) => { ioReads.push(p); return localIO.lstatMeasured(p); } };
  const spawnedArgvs: string[][] = [];
  const deps: ConvergeDeps = {
    store, role: 'server', ccrcDir: join(home, '.ccrc'), localIo: io, deadlineMs: DEADLINE, fleet: null,
    runLocal: spawnFromRunner(async (_cmd, args) => { spawnedArgvs.push(args); return { code: 0, stdout: '', stderr: '' }; }, home),
    onAccepted: () => undefined,
  };
  return { store, deps, ioReads, spawnedArgvs };
}

const ran = (r: DispatchRunResult): Extract<DispatchRunResult, { ran: true }> => {
  if (!r.ran) throw new Error(`the dispatch run did not run: ${r.why}`);
  return r;
};

/** The inventory sweep's step over the REAL box: `measureNode` reads the seven files off the fixture HOME (the same reader
 *  the production sweep uses), then W2's `sweepPlanFor` plans against the row and its writers apply the plan — in the
 *  sweep's own order. Returns the plan, so the case can name WHY the lease did not move. */
async function sweepReal(store: CoordStore, home: string, now: number): Promise<SweepPlan> {
  const m = await measureNode(localIO, join(home, '.ccrc'), 10_000, { role: 'server', label: SERVER_LABEL, agentOps: null }, now);
  const measured: NodeMeasurement = { ...m, nodeId: SERVER_ID };
  const plan = sweepPlanFor(store.node(SERVER_ID), measured);
  expect(store.upsertNodeMeasurement(measured).ok).toBe(true);
  if (plan.lease.kind === 'settle') store.settleNode(SERVER_ID, plan.lease.detail, null);
  if (plan.lease.kind === 'release') store.releaseLease(SERVER_ID, plan.lease.to, plan.lease.detail, null);
  return plan;
}

/** Acquire the server row's lease for X at `t0` through the real dispatcher, then hold it (the spawn double answers 0, so
 *  the lease is `pending`, exactly as after an accepted `--detach` parent). */
async function leaseAt(s: Server, t0: number): Promise<void> {
  const r = ran(await runDispatch(s.deps, t0));
  expect(r.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
  expect(s.store.node(SERVER_ID)).toMatchObject({ updateState: 'pending', updateTarget: X, updateStartedAt: t0 });
}

/** The columns a request lives in: the deadline's failure must leave them exactly as they were. */
const requestColumns = (store: CoordStore): unknown => {
  const n = store.node(SERVER_ID)!;
  return { requestedTag: n.requestedTag, requestedKind: n.requestedKind, requestedAt: n.requestedAt };
};

/** A deadline run's `now`: past the later-of rule for a report dated ~now, so the lease expires on the deadline alone. */
const pastDeadline = (): number => Date.now() + DEADLINE + 60_000;

describe('the watchdog\'s REAL revert sequence, then the server\'s deadline (F6, real `ccd/ccrc rollback --from watchdog`)', () => {
  itLinux('a successful revert: every report names P, none is a `reverted`, the last is `done P` from the watchdog — the identity clause holds the lease as stale-report, and the deadline fails the row saying the watchdog reverted the box', async () => {
    const box = watchdogBox('update-watchdog-revert-ok-');
    const s = server(box.home);
    const t0 = Date.now() - 60_000;
    await leaseAt(s, t0);
    const before = requestColumns(s.store);

    // The server is DOWN while the revert runs: no sweep reads any intermediate report. Then the real verb runs.
    const r = runWatchdogRollback(box);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expectContained(box.home);
    const phases = r.writes.map((w) => String(w['phase']));
    expect(phases.length).toBeGreaterThan(2);
    expect(phases).not.toContain('reverted');
    expect(phases[phases.length - 1]).toBe('done');
    // The real sequence, whole: every write is the watchdog's and names the PREVIOUS tag, never the lease's.
    for (const w of r.writes) {
      expect(w['from'], JSON.stringify(w)).toBe('watchdog');
      expect(w['target'], JSON.stringify(w)).toBe(P);
    }
    expect(r.writes[r.writes.length - 1]!['detail']).toBeNull();

    // The box's report on disk is the last write; the server comes back up and sweeps.
    const plan = await sweepReal(s.store, box.home, Date.now());
    expect(plan.lease).toEqual({ kind: 'none', why: 'stale-report' });
    expect(s.store.node(SERVER_ID)).toMatchObject({ updateState: 'pending', updateTarget: X });

    // The deadline passes.
    const run = ran(await runDispatch(s.deps, pastDeadline()));
    expect(run.expired).toEqual([SERVER_ID]);
    const row = s.store.node(SERVER_ID)!;
    expect(row.updateState).toBe('failed');
    expect(row.updateDetail).toBe(`${DEADLINE_DETAIL} — the watchdog reverted this box to ${P}`);
    expect(isHalting(row)).toBe(true);
    expect(requestColumns(s.store)).toEqual(before);
    expect(row.requestedTag).toBe(X);
    expect(s.spawnedArgvs.length, 'the halted row must not be re-dispatched').toBe(1);
  });

  itLinux('a FAILED revert (its own gate fails, `_upd_rollback_no_restore`): the last report is a watchdog `failed` naming P, and the deadline fails the row saying the watchdog\'s rollback failed, with the node\'s own words', async () => {
    const box = watchdogBox('update-watchdog-revert-failed-', { gateFails: true });
    const s = server(box.home);
    const t0 = Date.now() - 60_000;
    await leaseAt(s, t0);
    const before = requestColumns(s.store);

    const r = runWatchdogRollback(box);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expectContained(box.home);
    const last = r.writes[r.writes.length - 1]!;
    expect(last['phase']).toBe('failed');
    expect(last['from']).toBe('watchdog');
    expect(last['target']).toBe(P);
    expect(String(last['detail'])).toMatch(new RegExp(`^rollback to ${P.replace(/\./g, '\\.')}: gate: `));
    for (const w of r.writes) {
      expect(w['from'], JSON.stringify(w)).toBe('watchdog');
      expect(w['target'], JSON.stringify(w)).toBe(P);
    }

    const plan = await sweepReal(s.store, box.home, Date.now());
    expect(plan.lease).toEqual({ kind: 'none', why: 'stale-report' });

    const run = ran(await runDispatch(s.deps, pastDeadline()));
    expect(run.expired).toEqual([SERVER_ID]);
    const row = s.store.node(SERVER_ID)!;
    expect(row.updateState).toBe('failed');
    expect(row.updateDetail).toBe(`${DEADLINE_DETAIL} — the watchdog's rollback to ${P} failed: ${String(last['detail'])}`);
    expect(row.updateDetail!.length).toBeLessThanOrEqual(UPDATE_OP_DETAIL_MAX);
    expect(isHalting(row)).toBe(true);
    expect(requestColumns(s.store)).toEqual(before);
  });

  itLinux('the negatives, over the same real final report: a watchdog report that is NOT later than the lease (a lease taken after the revert) keeps the plain word', async () => {
    const box = watchdogBox('update-watchdog-revert-old-');
    const r = runWatchdogRollback(box);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expectContained(box.home);
    const s = server(box.home);
    // The lease begins AFTER the revert's last report: that report is an earlier run's.
    const t0 = Date.now() + 5_000;
    await leaseAt(s, t0);
    const run = ran(await runDispatch(s.deps, t0 + 4 * DEADLINE + 1));
    expect(run.expired).toEqual([SERVER_ID]);
    expect(s.store.node(SERVER_ID)).toMatchObject({ updateState: 'failed', updateDetail: DEADLINE_DETAIL });
  });

  itLinux('the negatives: the same real report re-attributed to another writer (from cli) keeps the plain word', async () => {
    const box = watchdogBox('update-watchdog-revert-cli-');
    const r = runWatchdogRollback(box);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expectContained(box.home);
    const file = join(box.home, '.ccrc', 'update.json');
    const doc = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(doc['from']).toBe('watchdog');
    writeFileSync(file, `${JSON.stringify({ ...doc, from: 'cli' })}\n`);
    const s = server(box.home);
    await leaseAt(s, Date.now() - 60_000);
    const run = ran(await runDispatch(s.deps, pastDeadline()));
    expect(run.expired).toEqual([SERVER_ID]);
    expect(s.store.node(SERVER_ID)).toMatchObject({ updateState: 'failed', updateDetail: DEADLINE_DETAIL });
  });

  itLinux('the negatives: a FLEET-role row (agentOps set) that fails the deadline reads NO file and keeps the plain word, whatever this box\'s report says', async () => {
    const box = watchdogBox('update-watchdog-revert-fleet-');
    const r = runWatchdogRollback(box);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expectContained(box.home);
    const s = server(box.home, { fleet: true });
    // The fleet row holds the lease, taken well before the box's real revert report.
    const t = Date.now();
    expect(s.store.dispatchNode(FLEET_ID, X, 'update', t - 60_000, 'requested update').ok).toBe(true);
    s.ioReads.length = 0;
    const run = ran(await runDispatch(s.deps, pastDeadline()));
    expect(run.expired).toEqual([FLEET_ID]);
    expect(s.store.node(FLEET_ID)).toMatchObject({ updateState: 'failed', updateDetail: DEADLINE_DETAIL });
    expect(s.ioReads, 'a fleet-role expiry read this box\'s own report').toEqual([]);
  });

  itLinux('a server-role expiry reads this box\'s report ONCE, through the bounded reader, and only when that row is expiring (no expiry, no read)', async () => {
    const box = watchdogBox('update-watchdog-revert-reads-');
    const s = server(box.home);
    await leaseAt(s, Date.now() - 60_000);
    s.ioReads.length = 0;
    // Not yet expired: the run reads nothing on account of the deadline.
    const early = ran(await runDispatch(s.deps, Date.now()));
    expect(early.expired).toEqual([]);
    expect(s.ioReads).toEqual([]);
    const late = ran(await runDispatch(s.deps, pastDeadline()));
    expect(late.expired).toEqual([SERVER_ID]);
    expect(s.ioReads).toEqual([join(box.home, '.ccrc', 'update.json')]);
  });

  // Controls for the poisoned, recording tmux/gh above (residue R6): they resolve the recorders with `command -v`
  // (which executes neither binary) and run each recorder only by its ABSOLUTE planted path, never through PATH —
  // so no mutation here can make either control run a real binary.
  itLinux('the watchdog box resolves tmux and gh to its own poisoned recorders first (the containment lines above can red)', () => {
    const box = watchdogBox('update-watchdog-revert-tmuxgh-resolve-');
    const r = spawnSync('/bin/sh', ['-c', 'command -v tmux; command -v gh'], { env: box.env, encoding: 'utf8' });
    expect(r.stdout).toBe(`${join(box.home, 'bin', 'tmux')}\n${join(box.home, 'bin', 'gh')}\n`);
  });

  itLinux('a call that reaches a recorder is what expectContained reds on', () => {
    const box = watchdogBox('update-watchdog-revert-tmuxgh-reach-');
    // gh first, ALONE: at this point only `gh-argv` exists, so a throw here can only be `expectContained`'s OWN
    // gh-argv line — nothing else in the function could be catching it (tmux-argv does not exist yet).
    spawnSync(join(box.home, 'bin', 'gh'), ['probe'], { env: box.env });
    expect(existsSync(join(box.home, 'gh-argv'))).toBe(true);
    expect(existsSync(join(box.home, 'tmux-argv'))).toBe(false);
    expect(() => expectContained(box.home)).toThrow(/gh \(poisoned, recording\)/);
    // Now tmux too — both argv files exist. The tmux-argv line runs BEFORE the gh-argv line in `expectContained`,
    // so with both present it throws FIRST, on tmux's own message — a generic `/poisoned, recording/` match here
    // would pass even with the tmux-argv line deleted (gh's message still matches it), so the regex names tmux
    // specifically to pin that line's own guard, not just "the function throws".
    spawnSync(join(box.home, 'bin', 'tmux'), ['probe'], { env: box.env });
    expect(existsSync(join(box.home, 'tmux-argv'))).toBe(true);
    expect(() => expectContained(box.home)).toThrow(/tmux \(poisoned, recording\)/);
  });
});
