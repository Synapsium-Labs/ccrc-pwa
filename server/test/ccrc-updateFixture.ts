// The shared fixtures of the `ccrc update` suite (D-6767): the throwaway box, the stub tarballs, the
// runners and the recorders. The suite used to be one 14,000-line file; it is now split by describe
// block into `ccrc-update-<part>.test.ts` files, each imports what it uses from here. Importing a
// `.test.ts` module would register its tests in the importer's run, which is why this is a plain
// module. The header below is the former single file's, kept whole.
//
// `ccrc update [--to vX.Y.Z]` — stage 4, Task 6 (spec §4). Per box, explicit,
// never automatic: fetch + verify a published release (outer checksum, then
// the per-file MANIFEST), back up coord.db/dists/ccd/units to
// `~/ccrc-backups/<ts>/` BEFORE anything is installed, re-run the `_inst_*`
// spine from the verified staged tree (role-aware, per the CCRC_ROLE the box
// recorded), and print the from → to report. NO sweep here — that is Task 7.
//
// ── THE HARNESS, AND WHERE EACH PIECE COMES FROM ──────────────────────────
// The box fixture is `ccrc-installFixture.ts`'s `freshBox` idiom — throwaway
// $HOME, `healthyDoctorBox`'s answer-shaped stubs, `ccrcEnv`'s recorders for
// systemctl/loginctl and poisons for journalctl — COPIED here rather than
// imported, for the reason `build-release.test.ts` states at its own top:
// importing a .test.ts module registers its thousands of lines of tests
// inside this file's run. The release fixture is `install-sh.test.ts`'s
// `local://` idiom: `CCRC_RELEASE_BASE_URL` points at a directory laid out
// exactly like GitHub's URL space, and a stub curl serves (and records) it.
// The curl stub here is COMBINED with the doctor suite's health-answering
// curl, because one run of the full verb makes both kinds of call: release
// fetches (local://) and `/api/fleet/health` probes (http://).
//
// TWO TARBALL FLAVOURS, deliberately:
//   - FULL: the real repo's `ccd/`, `shared/`, `deploy/` (minus the live
//     `ccrc-mail.token` — the same file `git archive` keeps out of real
//     releases), dist stubs, and a `build.json` shaped exactly as
//     `build-release.sh` writes it. The staged `ccrc install` really runs —
//     the happy path is the whole machine, not a stub of it.
//   - STUB: `ccd/ccrc` is a recording stub (argv to a file, exit code chosen
//     by the test). Everything that measures update's OWN logic — URL choice,
//     backup ordering, role passthrough, the rollback report — uses this
//     flavour, because the spine's behaviour is `ccrc-install-*.test.ts`'s
//     subject, not this file's.
//
// NEVER against a real $HOME; no live tmux/systemd/journal is ever reachable
// (recorders and poisons only). No secret value is ever printed or asserted.
import { expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { FIXTURE_DF_INODES_LINES } from './fixtureDfInodes.js';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, lstatSync, chmodSync, readdirSync, appendFileSync, renameSync, rmSync, symlinkSync, readlinkSync } from 'node:fs';
import path, { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';
import { python3ProgramArm } from './platformFixtures.js';
import { installVersionedTree, keepDigest, rsyncRecorder } from './installTreeFixture.js';
// Fix round 1 item 3 / review 155 C31: W2's OWN reader (never a hand copy),
// the same import pattern `update-intent-cross-side.test.ts` already uses.
import { } from '../src/update/inventory.js';
// #166 wave 10: the collector's generation journal's ONE name (path-identity spec 2026-10-12 §5.3).
import { COLLECT_LANE_JOURNAL_BASENAME } from '../src/coord/collectLaneJournal.js';
import { adoptPlantedSystemd, assertSpineFrontContained, spineSystemctlArms, spineSystemdRun } from './codexLaneFixture.js';
import { docsProbeProgram } from './docsHelperPy.js';
import { DOCS_INDEX_READY } from './docsIndexFixtures.js';
import { swJs } from './swFixtures.js';
import { wrapRealTool } from './wrapRealTool.js';

/** The two python3 invocations ccd's Docs front makes when the closing
 *  doctor's `docs` check runs the installed ccd (Docs W1a): the floor probe,
 *  read off the shipped ccd/ccd so it is never re-typed, and the ready line
 *  the doctor suite's own stub prints. The `python3` stub below embeds both
 *  in single quotes, so a quote or a newline in either is refused here,
 *  before a stub that parses differently is ever written. */
export const DOCS_PROBE = docsProbeProgram();
export const DOCS_READY_LINE = JSON.stringify(DOCS_INDEX_READY);
if (/['\n]/.test(DOCS_PROBE + DOCS_READY_LINE)) {
  throw new Error('the docs probe or the ready line holds a quote or a newline; the python3 stub cannot embed it');
}

export const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '..', '..');

export function realPath(name: string): string {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (p === '') throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
}
export const BASH = realPath('bash');
export const RSYNC = realPath('rsync');
export const REAL_NODE = realPath('node');
export const REAL_MV = realPath('mv');
/** The real python3, resolved once and without a throw (W6 Task 2): only the
 *  two macOS programs of `DARWIN_PYTHON3_PROGRAMS` reach it, through the
 *  `python3` stub's `-c` arm. */
export const REAL_PYTHON3 = spawnSync('bash', ['-c', 'command -v python3'], { encoding: 'utf8' }).stdout.trim();

/** The box-token doctor check's two JSON readers (`_BT_PY_STATE`, `_BT_PY_FLEET` in `ccd/ccrc-doctor-checks`), read
 *  from the shipped file so the stub's `python3 -I -c` arm is an EXACT-text allow-list: those two programs, and only
 *  those, go to the real interpreter, because a refused `python3` makes them read `state-unreadable` and
 *  `sync-unreadable` (a FAIL once the arms are on). A third program, or an edited one, still reaches the refusal. */
export const BT_PY_ARM = ((): string => {
  const src = readFileSync(join(REPO, 'ccd', 'ccrc-doctor-checks'), 'utf8');
  const progs = ['_BT_PY_STATE', '_BT_PY_FLEET'].map((n) => {
    const m = new RegExp(`^${n}='([^']*)'$`, 'm').exec(src);
    if (!m) throw new Error(`ccd/ccrc-doctor-checks no longer holds ${n}='…' in the shape this stub reads`);
    return `'${m[1]}'`;
  });
  if (REAL_PYTHON3 === '') return '';
  return `if [ "$1" = "-I" ] && [ "$2" = "-c" ]; then case "$3" in ${progs.join('|')}) exec '${REAL_PYTHON3}' "$@" ;; esac; fi`;
})();
// D-3277 (fix round 1, Task 9): the real `flock`, so a shim placed ahead of
// it on PATH can rewrite a file and then `exec` into the genuine binary —
// the locking semantics the shim intercepts stay real, only the write in
// between is fixture-controlled.
export const FLOCK = realPath('flock');

export interface Result { code: number; stdout: string; stderr: string }

/** GNU `timeout -k`, probed the same way `ccrc-doctorFixture.ts`'s own
 *  `DOCTOR_DEADLINE_BIN` is (fix round 1 items 9 and 23-C21): a FIFO block
 *  happens inside a GRANDCHILD (`jq`'s or `flock`'s own open), which a bare
 *  `spawnSync` `timeout` option cannot reach — only `timeout -k`, which puts
 *  the child in its own process group and signals the GROUP, kills it. A
 *  busybox-shaped `timeout` that refuses `-k` is PROBED with a known-124
 *  command first, so a candidate that does not answer 124 is treated as
 *  absent rather than silently bounding nothing. */
export const UPD_DEADLINE_BIN: string | null = (() => {
  for (const candidate of ['timeout', 'gtimeout']) {
    const found = spawnSync('sh', ['-c', `command -v ${candidate}`], { encoding: 'utf8' });
    if (found.status !== 0) continue;
    const bin = (found.stdout ?? '').trim();
    if (!bin) continue;
    const probe = spawnSync(bin, ['-k', '1', '0.1', 'sleep', '5'], { encoding: 'utf8' });
    if (probe.status === 124) return bin;
  }
  return null;
})();

/** Runs `argv` bounded by the process GROUP — a hang becomes a readable
 *  failure, never a hung suite. Shared by every FIFO pin in this file. */
export function runBounded(argv: string[], env: NodeJS.ProcessEnv, ms = 10000): Result {
  if (UPD_DEADLINE_BIN === null) {
    throw new Error('runBounded: no usable `timeout`/`gtimeout` — cannot bound this call safely');
  }
  const r = spawnSync(UPD_DEADLINE_BIN, ['-k', '1', String(ms / 1000), ...argv], { env, encoding: 'utf8' });
  if (r.status === 124) {
    throw new Error(
      `runBounded did not return within ${ms}ms — either a FIFO guard regressed `
      + 'or this box is loaded; re-run in isolation before concluding');
  }
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// ── The box fixture (freshBox's pieces, trimmed to this file's needs) ─────

/** `healthyDoctorBox` (ccrc-installFixture.ts), with ONE substitution: the curl
 *  stub is this file's combined release+health stub (below), planted into the
 *  same `doctor-stubs` replant directory so it survives every run's replant. */
export function healthyBox(home: string): void {
  const d = join(home, 'doctor-stubs');
  mkdirSync(d, { recursive: true });
  const stub = (name: string, body: string): void =>
    writeFileSync(join(d, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });

  // RECORDING, and the record is a Task 7 pin: the supervisor sweep must
  // never reach for tmux (panes are never touched), so a sweep-flavour run
  // asserts this file simply does not exist.
  stub('tmux', [
    'printf \'%s\\n\' "$*" >> "$HOME/tmux-argv"',
    'if [ "$1" = "-V" ]; then echo "tmux 9.9"; exit 0; fi',
    'if [ "$1" = "display-message" ]; then echo "9.9"; exit 0; fi',
    'echo "fixture tmux: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));

  stub('gh', [
    'printf \'%s\\n\' "$*" >> "$HOME/gh-calls"',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then',
    '  echo "github.com" >&2',
    '  echo "  - Logged in to github.com account fixture-bot (keyring)" >&2',
    '  echo "  - Token: gho_************************************" >&2',
    '  echo "  - Token scopes: \'gist\', \'read:org\', \'repo\', \'workflow\'" >&2',
    '  exit 0',
    'fi',
    'echo "fixture gh: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));

  // THE COMBINED CURL. `local://<path>` is a file on disk (a release asset;
  // missing = curl's own 404/exit-22 shape) and every URL is recorded to
  // `$HOME/curl-argv`. Anything else is answered as `/api/fleet/health` —
  // body + trailing status code, the `-w '\n%{http_code}'` shape ccrc reads —
  // from the `fixture-health-{body,code}` files when a test has an opinion.
  // A URL ending /health that is not /api/fleet/health is the update gate's
  // probe (design §11) — see the block inside.
  stub('curl', [
    // Fix round 1 item 12 / review 155 C22/C32: the FULL argv, captured
    // BEFORE the flag-parsing loop below consumes `$@` (so `$*` here still
    // names every flag this call was given), beside the existing url-only
    // recording — every OTHER test in this suite reads `curl-argv`, so that
    // one stays exactly as it was.
    'printf \'%s\\n\' "$*" >> "$HOME/curl-full-argv"',
    'dest=""; url=""; wfmt=""',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -o) dest="$2"; shift 2 ;;',
    '    -w) wfmt="$2"; shift 2 ;;',
    // Fix round 2 F4 (review 167): `--max-filesize` joins this list — a
    // TWO-ARG flag like its siblings. Left in the generic `-*) shift ;;`
    // fallback below, its numeric argument (never starting with `-`) would
    // fall through to the `*) url="$1"` arm on the NEXT loop turn and set
    // `$url` to a byte count. That was never OBSERVABLE (review 173's T4,
    // measured by the reviewer): the URL is the LAST argv word in every
    // `_upd_resolve`/`_upd_fetch` call, so the loop's last turn always
    // overwrote the count with the real URL. The edit is harmless and kept —
    // it stops depending on that argv order.
    '    -H|--max-time|--max-filesize|--connect-timeout|--speed-limit|--speed-time) shift 2 ;;',
    '    -*) shift ;;',
    '    *) url="$1"; shift ;;',
    '  esac',
    'done',
    'printf \'%s\\n\' "$url" >> "$HOME/curl-argv"',
    // THE GATE'S `/health` (design §11), told apart from `/api/fleet/health`
    // — which ALSO ends in `/health` — before the main case reads anything.
    // The version is the test's pin (`fixture-health-pin`; an EMPTY pin is an
    // answer with no `version` key, and `fixture-health-pin-probes` bounds
    // how many probes the pin answers), else the version the STUB shim
    // "installed" (`fixture-health-version`), else the box's own stamp — so a
    // FULL run answers what `_inst_stamp` placed. `build` is the stamp and
    // `-w` gets the status line, because doctor's `_check_build` asks this
    // same URL with `-w '\n%{http_code}'` and parses `build.sha`.
    'case "$url" in local://*|*/api/fleet/health) ;; */health)',
    '  [ -f "$HOME/fixture-health-down" ] && { echo "curl: (7) Failed to connect to ${url#http://}" >&2; exit 7; }',
    // D-3278 (fix round 1, Task 9): a decrementing counter of FAILING probes
    // — the watchdog's own three-sample gate needs a health answer that can
    // fail N times then pass, told apart from `fixture-health-down` (which
    // fails every call forever) and from `fixture-health-pin-probes` (which
    // bounds a PINNED version, not a failure).
    '  if [ -f "$HOME/fixture-health-fail-count" ]; then',
    '    fc=0; IFS= read -r fc < "$HOME/fixture-health-fail-count"',
    '    if [ "$fc" -gt 0 ]; then',
    '      echo $((fc - 1)) > "$HOME/fixture-health-fail-count"',
    '      echo "curl: (7) Failed to connect to ${url#http://}" >&2; exit 7',
    '    fi',
    '  fi',
    '  v=""; pinned=0',
    '  if [ -f "$HOME/fixture-health-pin" ]; then',
    '    left=1; [ -f "$HOME/fixture-health-pin-probes" ] && IFS= read -r left < "$HOME/fixture-health-pin-probes"',
    '    if [ "$left" -gt 0 ]; then',
    '      pinned=1; IFS= read -r v < "$HOME/fixture-health-pin"',
    '      [ -f "$HOME/fixture-health-pin-probes" ] && echo $((left - 1)) > "$HOME/fixture-health-pin-probes"',
    '    fi',
    '  fi',
    '  if [ "$pinned" -eq 0 ]; then',
    '    if [ -f "$HOME/fixture-health-version" ]; then IFS= read -r v < "$HOME/fixture-health-version"',
    '    else v="$(jq -r \'.version // empty\' "$HOME/.ccrc/build.json" 2>/dev/null)"; fi',
    '  fi',
    // W6 Task 4: `fixture-health-deny` (one version per line) is a server that
    // never comes up on THAT build — the probe gets no answer, curl's exit 7 —
    // whenever the version this stub would answer is listed. Unlike a pin it
    // FOLLOWS the box: with no pin it answers what the stamp says, so a flip
    // back that restores the kept stamp is what makes the next probe answer.
    '  if [ -n "$v" ] && [ -f "$HOME/fixture-health-deny" ] && grep -qxF -- "$v" "$HOME/fixture-health-deny"; then echo "curl: (7) Failed to connect to ${url#http://}" >&2; exit 7; fi',
    '  build="$(jq -c . "$HOME/.ccrc/build.json" 2>/dev/null)" || build=null; [ -n "$build" ] || build=null',
    '  if [ -n "$v" ]; then body="$(printf \'{"ok":true,"build":%s,"version":"%s"}\' "$build" "$v")"',
    '  else body="$(printf \'{"ok":true,"build":%s}\' "$build")"; fi',
    '  if [ -n "$wfmt" ]; then printf \'%s\\n200\' "$body"; else printf \'%s\\n\' "$body"; fi',
    '  exit 0 ;;',
    'esac',
    'case "$url" in',
    '  local://*)',
    '    case "$url" in *.sigstore.json)',
    '      if [ -f "$HOME/fixture-curl-exit" ]; then IFS= read -r c < "$HOME/fixture-curl-exit"; echo "curl: ($c) fixture failure for $url" >&2; exit "$c"; fi',
    // D-3284 (final review, B2): a status OTHER than 404 on the bundle fetch
    // alone (not the tarball, not SHA256SUMS) — the measured-`-w` knob
    // `_upd_fetch`'s fixed code now reads.
    '      if [ -f "$HOME/fixture-bundle-http" ]; then IFS= read -r hc < "$HOME/fixture-bundle-http"; [ -n "$wfmt" ] && printf \'%s\' "$hc"; echo "curl: (22) The requested URL returned error: $hc for $url" >&2; exit 22; fi ;;',
    '    esac',
    // Task 6: the release host answering an HTTP error that is NOT a 404 (a
    // 403 rate limit, a 5xx) — a FILE knob naming the status, for every
    // `local://` URL from the moment it exists. curl -f exits 22 for it, as
    // for a 404; only the status `-w` writes tells the two apart.
    '    if [ -f "$HOME/fixture-release-http" ]; then IFS= read -r hc < "$HOME/fixture-release-http"; [ -n "$wfmt" ] && printf \'%s\' "$hc"; echo "curl: (22) The requested URL returned error: $hc for $url" >&2; exit 22; fi',
    '    src="${url#local://}"',
    '    if [ ! -f "$src" ]; then',
    '      [ -n "$wfmt" ] && printf 404',
    '      echo "curl: (22) The requested URL returned error: 404 for $url" >&2',
    '      exit 22',
    '    fi',
    '    cp "$src" "$dest"; if [ -n "$wfmt" ]; then printf 200; fi ;;',
    '  *)',
    '    body=\'{"mode":"local","connected":true,"downSince":null,"build":"agreed","roster":"agreed"}\'',
    '    [ -f "$HOME/fixture-health-body" ] && IFS= read -r body < "$HOME/fixture-health-body"',
    '    code=200',
    '    [ -f "$HOME/fixture-health-code" ] && IFS= read -r code < "$HOME/fixture-health-code"',
    '    printf \'%s\\n%s\' "$body" "$code" ;;',
    'esac',
  ].join('\n'));

  stub('df', [
    'printf \'%s\\n\' "$*" >> "$HOME/df-calls"',
    ...FIXTURE_DF_INODES_LINES,
    '[ "$1" = "-Pk" ] && [ -n "$2" ] || { echo "fixture df: unexpected argv: $*" >&2; exit 90; }',
    'echo "Filesystem     1024-blocks      Used Available Capacity Mounted on"',
    'echo "/dev/fixture0    104857600  20971520 42991616      21% /"',
  ].join('\n'));

  writeFileSync(join(home, '.gitconfig'),
    '[user]\n\tname = ccrc fixture\n\temail = fixture@example.invalid\n');
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(home, '.local', 'bin', 'claude'),
    '\x7fELF\x02\x01\x01\x00not-a-real-binary-just-a-fixture-marker', { mode: 0o755 });
}

/** Composes the source-owned Codex spine front with this target-owned update
 * fixture's detached-run controls. `codexLaneFixture.ts` stays byte-identical
 * to the reviewed source; the shared update suite alone owns this composition. */
export function updateSpineSystemdRun(): string {
  const source = spineSystemdRun();
  const failureGate = [
    'if [ -f "$HOME/fixture-systemd-run-fail" ]; then',
    '  IFS= read -r bad < "$HOME/fixture-systemd-run-fail"',
    '  case " $* " in',
    '    *" --unit=$bad "*) echo "Failed to start transient service unit: fixture refusal for $bad" >&2; exit 1 ;;',
    '  esac',
    'fi',
  ].join('\n');
  const terminalRefusal = [
    'echo "fixture systemd-run: no fake user manager is planted in this HOME — a spine harness never starts a real transient unit" >&2',
    'exit 97',
  ].join('\n');
  if (!source.includes(failureGate) || !source.endsWith(`${terminalRefusal}\n`)) {
    throw new Error('updateSpineSystemdRun: the source spine front changed; recompose its detached-update adapter');
  }
  const detachedControls = [
    'printf \'%s\\n\' "$*" >> "$HOME/systemd-run-argv"',
    'if [ -f "$HOME/fixture-systemd-run-exec" ]; then',
    '  [ "$1 $2 $3" = "--user --collect --quiet" ] || { echo "fixture systemd-run: unexpected argv: $*" >&2; exit 90; }',
    '  shift 3',
    '  setsid "$@" </dev/null >"$HOME/detached.log" 2>&1 &',
    '  echo "$!" > "$HOME/systemd-run-exec-pid"',
    'fi',
    'if [ -f "$HOME/fixture-systemd-run-linger" ]; then',
    '  sleep 20 </dev/null >/dev/null 2>&1 &',
    '  echo "$!" > "$HOME/systemd-run-linger-pid"',
    'fi',
    'if [ -f "$HOME/fixture-systemd-run-exit" ]; then',
    '  IFS= read -r code < "$HOME/fixture-systemd-run-exit"',
    '  exit "$code"',
    'fi',
  ].join('\n');
  const ordinaryDetach = [
    'case " $* " in',
    '  *" --unit=fixture-containment-probe.service "*)',
    `    ${terminalRefusal.replace('\n', '; ')} ;;`,
    'esac',
    'exit 0',
  ].join('\n');
  return source
    .replace(failureGate, `${detachedControls}\n${failureGate}`)
    .replace(`${terminalRefusal}\n`, `${ordinaryDetach}\n`);
}

/** Wave 9 R10d (D-3819): a real-curl case lists the ONE loopback port its own listener holds (M4: its refused port 9)
 *  in `$HOME/curl-allow-ports`, which `updateEnv`'s loopback curl front reads. Nothing else is let through. */
export function allowCurlPort(home: string, port: number): void {
  writeFileSync(join(home, 'curl-allow-ports'), `${port}\n`);
}
/** What the loopback front handed to the REAL curl (one URL per line), '' when it handed none. A real-curl case
 *  asserts this holds its URL, so a case that silently stopped reaching the real curl reds. */
export function curlFrontPassed(home: string): string {
  const p = join(home, 'curl-front-passed');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

/** `ccrcEnv` (ccrc-installFixture.ts), trimmed: it starts from `ccrcContainedEnv` (wave 9 R10d, D-3818) — HOME the
 *  fixture, the user bus pointed at two absent paths under it, and recording poisons for gh (later shadowed by the
 *  doctor stub — the shadow answers, never execs), ssh, scp, tmux and launchctl, create-if-absent. It is a SPINE
 *  builder, so it passes `managers: false`: it fronts its own systemctl/systemd-run below, after
 *  `adoptPlantedSystemd`, which would rename an unmarked poison to a `.codex-*` delegate. Its curl is the LOOPBACK
 *  front (D-3819): it execs the real curl only for `http://127.0.0.1:<port>/…` with the port listed in
 *  `$HOME/curl-allow-ports`, which the real-curl cases write for their own listener; anything else is recorded and
 *  refused. Then journalctl poisoned, systemctl/loginctl as RECORDERS that answer the shapes the install spine
 *  asks, npm a recorder that fabricates node_modules, rsync a recorder that execs the real binary. */
export function updateEnv(home: string): NodeJS.ProcessEnv {
  const env = ccrcContainedEnv(home, process.env, { managers: false, curl: 'loopback' });
  const plant = (name: string, body: string): void =>
    writeFileSync(join(home, '.local', 'bin', name), body, { mode: 0o755 });
  const poison = (name: string, says: string): void =>
    plant(name,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\n`
      + `echo "${says}" >&2\nexit 97\n`);
  poison('journalctl', 'ccrc tests must never read this box\'s real journal');
  // macOS's service manager, contained the same way systemctl is. Without it
  // `_inst_enable`'s Darwin arm reaches the platform layer's guard, which
  // (correctly) refuses to drive the developer's REAL launchd from a sandbox
  // HOME — and the staged install dies for a reason that has nothing to do
  // with updating.
  plant('launchctl', [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/launchctl-calls"',
    'case "$1" in',
    '  bootstrap) [ -f "$3" ] || { echo "fixture launchctl: no job file: $3" >&2; exit 1; };',
    '             printf \'%s\\n\' "${3##*/}" >> "$HOME/launchctl-loaded"; exit 0 ;;',
    '  bootout|enable|disable) exit 0 ;;',
    // Wave 11 (R12): a kickstart zeroes that label's print counter, which
    // `fixture-pid-churn-first.<label>` reads (see the `print` arm).
    '  kickstart) printf \'0\\n\' > "$HOME/fx-kick.${3##*/}"; exit 0 ;;',
    '  print)',
    '    lbl="${2##*/}"',
    '    if [ -f "$HOME/launchctl-loaded" ] && grep -q "^$lbl.plist$" "$HOME/launchctl-loaded"; then',
    // F12: `fixture-launchctl-not-running` — the job is LOADED and the manager
    // answers (rc 0), but it is not running: what launchd prints for a job
    // that is waiting or has exited. `_svc_is_active` reads that as "no
    // answer", never `inactive` (only rc 113 is that).
    '      if [ -f "$HOME/fixture-launchctl-not-running" ]; then echo "	state = waiting"; exit 0; fi',
    '      echo "	state = running"',
    // The sweep's stay-up gate samples `pid = ` twice per kicked job; a
    // stable default is a job that stayed up, `fixture-pid-churn` a crash
    // loop. Same knob as ccrc-install-*.test.ts's stub.
    // Split per job kind (design §11's gate): `fixture-pid-churn` churns the
    // SESSION jobs (the sweep's subject), `fixture-main-pid-churn` the
    // ccrc/ccrc-agent jobs (the gate's), so each case measures one of them.
    '      churn=""',
    // Wave 11 (R12), two per-label knobs, additive: `fixture-pid-churn.<label>`
    // churns that one job; `fixture-pid-churn-first.<label>`, holding K, churns
    // the first K prints of that label AFTER its kickstart and answers 4242
    // from then on (a job whose window failed and whose re-check holds).
    '      case "$lbl" in app.ccrc.session.*) { [ -f "$HOME/fixture-pid-churn" ] || [ -f "$HOME/fixture-pid-churn.$lbl" ]; } && churn=1 ;; *) [ -f "$HOME/fixture-main-pid-churn" ] && churn=1 ;; esac',
    '      if [ -f "$HOME/fixture-pid-churn-first.$lbl" ]; then',
    '        k=0; n=0; IFS= read -r k < "$HOME/fixture-pid-churn-first.$lbl"; [ -f "$HOME/fx-kick.$lbl" ] && IFS= read -r n < "$HOME/fx-kick.$lbl"',
    '        n=$((n + 1)); printf \'%s\\n\' "$n" > "$HOME/fx-kick.$lbl"',
    '        [ "$n" -le "$k" ] && churn=1',
    '      fi',
    '      if [ -n "$churn" ]; then',
    '        echo "	pid = $(($(wc -l < "$HOME/launchctl-calls") + 4000))"',
    '      else',
    '        echo "	pid = 4242"',
    '      fi',
    '      exit 0',
    '    fi',
    '    exit 113 ;;',
    '  *) echo "fixture launchctl: unexpected argv: $*" >&2; exit 90 ;;',
    'esac',
  ].join('\n') + '\n');
  plant('plutil', '#!/bin/sh\nexit 0\n');

  // W4 Task 3: `--detach` re-execs through `_svc_run_detached`, whose Linux
  // arm is `systemd-run --user --collect --quiet "$@"`. The shared adapter
  // retains target detached-update controls around the source-owned Codex front.
  adoptPlantedSystemd(home);
  plant('systemd-run', updateSpineSystemdRun());

  plant('systemctl', [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/systemctl-calls"',
    '[ "$1" = "--user" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    'shift',
    // Plan 2b-2 Task 10: the codex tiers' verbs, before this stub's own arms —
    // its `is-active) echo active; exit 0` answers every unit active, which
    // would read every rostered codex lane as a FOREIGN tier.
    ...spineSystemctlArms(),
    'case "$1" in',
    '  daemon-reload) exit 0 ;;',
    '  enable) [ "$2" = "--now" ] && [ -n "$3" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }; exit 0 ;;',
    // Plan 3a Task 6: the usage converge (`_inst_enable`) may withdraw a ccrc
    // usage timer; recorded and answered here, never a real manager.
    '  disable) [ "$2" = "--now" ] && [ -n "$3" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }; exit 0 ;;',
    '  restart) [ -n "$2" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }; exit 0 ;;',
    '  try-restart) [ -n "$2" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    // Task 2 (§18 "the lock closes before the sweep": "a lingering stub
    // pins the lock"): a restart that leaves a process behind, holding
    // whatever descriptor it was handed.
    '    if [ -f "$HOME/fixture-sweep-linger" ]; then sleep 30 >/dev/null 2>&1 </dev/null & echo $! > "$HOME/sweep-linger-pid"; fi',
    // Wave 8 item B, P7/P12: a sweep whose try-restart itself fails (the
    // spine died mid-sweep) — exit 1 before `_bak_gc` is ever reached.
    '    if [ -f "$HOME/fixture-try-restart-fail" ]; then exit 1; fi',
    // Wave 8 item B, P12: another ccrc holds ~/.ccrc/update.lock by the time
    // `_bak_gc` re-takes it — the lock was released before this sweep runs
    // (design §10), so a holder planted HERE models the race honestly. The
    // probe is a non-blocking `flock -n <file> -c true`: it succeeds (rc 0)
    // while the file is free and fails once the spawned holder has it,
    // bounded so a broken probe fails the case loudly rather than hanging.
    // Fix round 1: `-F` (--no-fork) — without it `flock FILE sleep 30` FORKS
    // and `$!` names the flock PARENT, not the `sleep` CHILD that inherits
    // the lock fd; killing only the parent (afterEach) orphans `sleep`,
    // which keeps holding the lock for its own 30s regardless (a leaked
    // process AND a stuck fixture lock for any later case in the same
    // suite run). `-F` makes flock EXEC into `sleep` in place — one PID,
    // and killing it releases the lock immediately.
    '    if [ -f "$HOME/fixture-sweep-hold-lock" ]; then',
    '      flock -F "$HOME/.ccrc/update.lock" sleep 30 </dev/null >/dev/null 2>&1 &',
    '      echo $! > "$HOME/sweep-lock-holder-pid"',
    '      i=0',
    '      while flock -n "$HOME/.ccrc/update.lock" -c true >/dev/null 2>&1; do',
    '        i=$((i + 1))',
    '        if [ "$i" -ge 50 ]; then',
    '          echo "fixture systemctl: the lock holder never took ~/.ccrc/update.lock" >&2',
    '          exit 1',
    '        fi',
    '        sleep 0.1',
    '      done',
    '    fi',
    // Fix round 1 item 5 / review 155 C2 (your Q5): the interleaving probe —
    // a SECOND `ccrc update` takes the freed lock during this sweep and
    // writes its own in-flight report, foreign pid and all. `mv -f` goes
    // through this file's own recording `mv` stub (destination named
    // exactly as `_upd_phase` writes it), so the write shows up in
    // `update-json-writes` exactly as a real interleaved run\'s would.
    '    if [ -f "$HOME/fixture-sweep-foreign-report" ]; then',
    '      printf \'{"target":"v9.9.9","phase":"resolving","startedAt":1,"updatedAt":1,"detail":null,"from":"cli","pid":999999}\' > "$HOME/.ccrc/update.json.tmp.foreign"',
    '      mv -f "$HOME/.ccrc/update.json.tmp.foreign" "$HOME/.ccrc/update.json"',
    '    fi',
    '    exit 0 ;;',
    // The gate's unit probe (design §11): `fixture-unit-state` is the one
    // answer for every unit (default active). systemd exits 3 for anything
    // else; `_svc_is_active` reads the word, never the status.
    '  is-active)',
    '    st=active; [ -f "$HOME/fixture-unit-state" ] && IFS= read -r st < "$HOME/fixture-unit-state"',
    '    echo "$st"; [ "$st" = active ] && exit 0; exit 3 ;;',
    // The sweep's three list-units queries (Task 7): the unfiltered preflight
    // enumeration and the failed/active follow-ups, answered from per-state
    // fixture files a test plants (absent file = empty listing, exit 0 — a box
    // with no supervisors).
    '  list-units)',
    '    [ "$2" = "claude-session@*" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    '    state=""',
    '    for a in "$@"; do case "$a" in --state=*) state="${a#--state=}" ;; esac; done',
    '    case "$state" in',
    // fix round 1 item 1 (D-3599): flag-gated failure arms for the unfiltered
    // and `--state=active` listings — a distinctive rc plus a bus message on
    // stderr, modelling the transient failure review 196's F1 measured.
    '      "")',
    '        if [ -f "$HOME/fixture-sweep-units-fail" ]; then',
    '          echo "Failed to connect to bus: No such file or directory" >&2',
    '          exit 93',
    '        fi',
    '        [ -f "$HOME/fixture-sweep-units" ] && cat "$HOME/fixture-sweep-units"',
    '        ;;',
    '      failed) [ -f "$HOME/fixture-sweep-failed" ] && cat "$HOME/fixture-sweep-failed" ;;',
    '      active)',
    '        if [ -f "$HOME/fixture-sweep-active-fail" ]; then',
    '          echo "Failed to connect to bus: No such file or directory" >&2',
    '          exit 94',
    '        fi',
    '        [ -f "$HOME/fixture-sweep-active" ] && cat "$HOME/fixture-sweep-active"',
    '        ;;',
    '      *) echo "fixture systemctl: unexpected argv: $*" >&2; exit 90 ;;',
    '    esac',
    '    exit 0 ;;',
    '  show)',
    // `show -p KillMode <unit>` resolves the override chain on a real box; the
    // fixture models it as "the drop-in decides": present in the fixture unit
    // dir -> KillMode=process, absent -> systemd's control-group default.
    '    if [ "$2" = "-p" ] && [ "$3" = "KillMode" ] && [ -n "$4" ]; then',
    '      if [ -f "$HOME/.config/systemd/user/claude-session@.service.d/50-killmode.conf" ]; then',
    '        echo "KillMode=process"',
    '      else',
    '        echo "KillMode=control-group"',
    '      fi',
    '      exit 0',
    '    fi',
    // W6 Task 5 — spec §11's GC reads `show -p ExecStart <unit>`, answered in
    // systemd's REAL struct form (measured on a user unit, 2026-09-23):
    // `path=` is `/usr/bin/env` and the tree path is inside `argv[]`, so a
    // reader of `path=` protects nothing. The argv is the shipped unit's
    // ExecStart with %h expanded (deploy/ccrc.service:19,
    // deploy/ccrc-agent.service:7), `fixture-execstart-<unit>`'s one line
    // when a test plants it; `fixture-execstart-raw` is printed VERBATIM
    // (the unparseable case). Never a bare path.
    '    if [ "$2" = "-p" ] && [ "$3" = "ExecStart" ] && [ -n "$4" ]; then',
    '      if [ -f "$HOME/fixture-execstart-raw" ]; then cat "$HOME/fixture-execstart-raw"; exit 0; fi',
    '      case "$4" in',
    '        ccrc.service) a="/usr/bin/env node $HOME/ccrc/server/dist/server/src/index.js" ;;',
    '        ccrc-agent.service) a="/usr/bin/env node $HOME/ccrc/agent/dist/agent/src/index.js" ;;',
    '        *) echo "fixture systemctl: unexpected argv: $*" >&2; exit 90 ;;',
    '      esac',
    '      if [ -f "$HOME/fixture-execstart-$4" ]; then IFS= read -r a < "$HOME/fixture-execstart-$4"; fi',
    '      echo "ExecStart={ path=/usr/bin/env ; argv[]=$a ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }"',
    '      exit 0',
    '    fi',
    '    [ "$2" = "-p" ] && [ "$3" = "MainPID" ] && [ "$4" = "--value" ] \\',
    '      || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    // `fixture-mainpid-churn`: a unit crash-looping behind `active` — every
    // read a fresh MainPID, which verify-service.sh's two samples catch.
    '    if [ -f "$HOME/fixture-mainpid-churn" ]; then echo $(($(wc -l < "$HOME/systemctl-calls") + 5000)); else echo 4242; fi',
    '    exit 0 ;;',
    '  status) echo "fixture systemctl status: $*"; exit 0 ;;',
    'esac',
    'echo "fixture systemctl: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
  plant('loginctl', [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/loginctl-calls"',
    'case "$1" in',
    '  enable-linger) printf \'yes\\n\' > "$HOME/fixture-linger"; exit 0 ;;',
    '  show-user)',
    '    if [ -f "$HOME/fixture-linger" ]; then',
    '      IFS= read -r v < "$HOME/fixture-linger"; echo "Linger=$v"; exit 0',
    '    fi',
    '    echo "Failed to get user: User ID is not logged in or lingering" >&2; exit 1 ;;',
    'esac',
    'echo "fixture loginctl: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
  // `$HOME/fixture-npm-override`, when a case plants it, REPLACES this recorder (exec'd first, with the same argv). A
  // case that wants a failing or differently-recording npm uses it rather than a PATH prefix: `_node_select`
  // (ccd/ccrc-node) puts the chosen node's directory — `.local/bin` here — ahead of anything a test prefixes.
  plant('npm',
    '#!/bin/sh\n[ -x "$HOME/fixture-npm-override" ] && exec "$HOME/fixture-npm-override" "$@"\n'
    + 'printf \'%s\\n\' "$*" >> "$HOME/npm-argv"\n'
    + 'printf \'%s\\n\' "$PWD" >> "$HOME/npm-cwd"\nmkdir -p node_modules\nexit 0\n');
  plant('rsync', rsyncRecorder(RSYNC));
  // Task 1 (design §10, "update.json is written at every phase … by rename"):
  // a RECORDING mv. When the destination is `~/.ccrc/update.json` it appends
  // the SOURCE file's one line to `$HOME/update-json-writes` before the real
  // rename runs, so every recorded line is a report that arrived BY RENAME —
  // a write that bypassed `mv` (a `cp`, a `>` straight onto the name) is
  // invisible here and the enumeration below reds. Builtins only (`read`,
  // `printf`): `pathWithoutJq` runs this file on a PATH with no `cat`. Every
  // other mv — the FULL flavour's whole install spine — passes straight
  // through to the real binary, resolved at plant time.
  plant('mv', [
    '#!/bin/sh',
    // W4 Task 4: a destination this fixture refuses — the one way to make a
    // write fail AFTER its temp exists without a permission trick root
    // would bypass. `fixture-mv-fail`'s one line is a suffix of the last
    // argument (the destination).
    'if [ -f "$HOME/fixture-mv-fail" ]; then',
    '  IFS= read -r suffix < "$HOME/fixture-mv-fail"',
    '  for last in "$@"; do :; done',
    '  case "$last" in *"$suffix") echo "fixture mv: refusing $last" >&2; exit 1 ;; esac',
    'fi',
    'src=""; dst=""',
    'for a in "$@"; do src="$dst"; dst="$a"; done',
    'case "$dst" in',
    '  */.ccrc/update.json)',
    '    if [ -f "$src" ]; then',
    '      while IFS= read -r l || [ -n "$l" ]; do printf \'%s\\n\' "$l"; done < "$src" >> "$HOME/update-json-writes"',
    '    fi ;;',
    'esac',
    `exec ${REAL_MV} "$@"`,
  ].join('\n') + '\n');
  // graphify Task 2: the FULL-flavour happy-path test re-runs the real
  // `cmd_install` spine (`ccrc update` execs the staged tree's own `ccrc
  // install`), which now includes `_inst_graphify_engine` — a real
  // `python3 -m venv` followed by a real network `pip install` on every role
  // but `server`. Same fix, same reasoning as `ccrc-install-*.test.ts`'s own
  // `python3` stub (see its comment): answer only `-m venv <path>` by
  // building a fake venv locally, refuse anything else loudly.
  plant('python3', [
    '#!/bin/sh',
    // The box-token doctor readers, ahead of the argv log (their program text is not an argv a case asserts on).
    BT_PY_ARM,
    'printf \'%s\\n\' "$*" >> "$HOME/python3-argv"',
    'if [ "$1" = "-m" ] && [ "$2" = "venv" ] && [ -n "$3" ]; then',
    '  bin="$3/bin"; mkdir -p "$bin" || exit 1',
    '  printf \'#!/bin/sh\\necho "$@" >> "$HOME/venv-python-calls"\\nexit 0\\n\' > "$bin/python"',
    '  chmod 755 "$bin/python"',
    '  printf \'#!/bin/sh\\n[ "$1" = --version ] && { echo "graphify 0.9.9"; exit 0; }\\nexit 0\\n\' > "$bin/graphify"',
    '  chmod 755 "$bin/graphify"',
    '  exit 0',
    'fi',
    // W6 Task 2: the staged spine's Darwin flip (`os.replace`) and its
    // preflight probe (`import os`) go to the real interpreter; every other
    // `-c` is refused below, like any other unexpected argv.
    ...python3ProgramArm(REAL_PYTHON3),
    // ccd's Docs front, reached by the closing doctor's `docs` check through the
    // INSTALLED ccd (Docs W1a): the 3.8 floor probe passes, and the helper
    // prints the canned ready answer. Canned rather than forwarded to the real
    // python3, so the install stays hermetic and reads no projects root.
    `[ "$1" = -c ] && [ "$2" = '${DOCS_PROBE}' ] && exit 0`,
    `[ "$1" = /dev/fd/3 ] && [ "$2" = docs-index ] && { printf '%s\\n' '${DOCS_READY_LINE}'; exit 0; }`,
    'echo "fixture python3: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
  // The verifier seam (design §5): `ccrc update` runs the INSTALLED tree's
  // `deploy/verify-provenance.mjs` under `node`. This shim answers THAT
  // invocation from a fixture file (exit code; argv recorded) and execs the
  // real node for everything else, so the path the verb resolved is a
  // MEASURED fact — `$CCRC_HERE/../deploy/…` of the ccrc under test, never
  // the staged tree — and the real verifier (verify-provenance.test.ts's
  // subject) is not re-run here.
  plant('node', [
    '#!/bin/sh',
    'case "$1 $2" in',
    '  *verify-provenance.mjs*)',
    '    printf \'%s\\n\' "$*" >> "$HOME/verify-argv"',
    // D-3141: the plan's mutation row 12 ("move the verifier call below
    // `tar -xzf`") measures GREEN against every OTHER assertion here,
    // because `_upd_resolve`'s EXIT trap removes the whole staging dir on
    // every exit — success or refusal — so nothing left on disk afterward
    // can tell "never extracted" apart from "extracted, then swept". This
    // shim IS the verifier the tests run, so it records what IT observes
    // AT THE MOMENT it is invoked: whether the sibling `tree/` dir beside
    // `--blob` (`UPD_TREE`, which `_upd_fetch` only creates via
    // `mkdir "$UPD_TREE"` right before `tar -xzf`) already exists.
    '    blob=""; prev=""',
    '    for a in "$@"; do',
    '      [ "$prev" = "--blob" ] && blob="$a"',
    '      prev="$a"',
    '    done',
    '    if [ -n "$blob" ] && [ -d "$(dirname "$blob")/tree" ]; then',
    '      printf \'yes\\n\' > "$HOME/staging-at-verify"',
    '    else',
    '      printf \'no\\n\' > "$HOME/staging-at-verify"',
    '    fi',
    '    code=0; [ -f "$HOME/fixture-verify-exit" ] && IFS= read -r code < "$HOME/fixture-verify-exit"',
    '    [ "$code" = 0 ] && echo "verified fixture (sigstore)" || echo "verify-provenance: fixture refusal" >&2',
    '    exit "$code" ;;',
    'esac',
    `exec ${REAL_NODE} "$@"`,
  ].join('\n') + '\n');
  // `ccrc update` chooses its node before anything else (`_ccrc_node_choose`, ccd/ccrc-node) and requires npm and npx
  // beside it — in the directory of THIS shim. npm is the recorder above; npx is the real one, linked.
  wrapRealTool(realPath('npx'), join(home, '.local', 'bin', 'npx'));
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_DOCTOR_GH_TIMEOUT', 'CCRC_DOCTOR_DOCS_TIMEOUT',
    'CCRC_RELEASE_BASE_URL', 'CCRC_BACKUP_KEEP', 'CCRC_BACKUP_DATA_KEEP', 'CCRC_VERSIONS_KEEP', 'CCRC_CODEX_PROBE_S', 'CCRC_CODEX_READY_S',
    'CCRC_UPDATE_DEADLINE_MS', 'CCRC_MODELS_ADVANCE_BUDGET_S']) delete env[k];
  env['CCRC_VERIFY_SETTLE'] = '0';
  env['CCRC_VERIFY_WINDOW'] = '0';
  // The health gate (design §11) probes once and decides at a 0 s deadline;
  // a case that wants the retry loop sets its own window.
  env['CCRC_UPDATE_HEALTH_S'] = '0';
  // graphify Task 3: the same FULL-flavour happy path re-runs the real
  // `cmd_install` spine, which now includes `_inst_graphify_skill` right
  // after `_inst_skills`, unconditional on every role but `server`. The fake
  // venv `bin/python` the `python3` stub above builds answers ANY argv with
  // exit 0 and no stdout, so the installer's
  // `"$VENV/bin/python" -c 'import graphify…'` would read PKG="" and refuse —
  // a fixture reason, not anything this file's update logic is about. Same
  // fix as `ccrc-installFixture.ts`'s own `ccrcEnv`.
  const gfxPkg = join(home, 'fixture-graphify-pkg');
  mkdirSync(join(gfxPkg, 'skills', 'claude', 'references'), { recursive: true });
  writeFileSync(join(gfxPkg, 'skill.md'), '# fixture graphify skill\n');
  writeFileSync(join(gfxPkg, 'skills', 'claude', 'references', 'fixture-ref.md'), 'fixture ref\n');
  env['CCRC_GRAPHIFY_PKG'] = gfxPkg;
  // Fix round 2 (N1): a builder-level layer too — harmless here (nothing
  // after this point in `updateEnv` touches PATH or these two names), and
  // `runUpdate`'s own call on the truly final env is the one that counts.
  assertSpineFrontContained(env, home);
  assertNoRealTool(env, home);
  return env;
}

export function replantDoctorStubs(home: string): void {
  const d = join(home, 'doctor-stubs');
  if (!existsSync(d)) return;
  for (const f of readdirSync(d)) {
    copyFileSync(join(d, f), join(home, '.local', 'bin', f));
    chmodSync(join(home, '.local', 'bin', f), 0o755);
  }
}

/** A box with an OLD install on it: an old `~/ccrc` tree (with a marker file
 *  a real update must delete), an old `~/.local/bin/ccd`, the two units, and
 *  — when `version` is given — an old build stamp. */
export function plantOldBox(home: string, opts: { version?: string } = {}): void {
  mkdirSync(join(home, 'ccrc', 'server', 'dist'), { recursive: true });
  writeFileSync(join(home, 'ccrc', 'server', 'OLD-MARKER'), 'the previous tree\n');
  writeFileSync(join(home, 'ccrc', 'server', 'dist', 'old.js'), '// old dist\n');
  mkdirSync(join(home, 'ccrc', 'agent', 'dist'), { recursive: true });
  writeFileSync(join(home, 'ccrc', 'agent', 'dist', 'old.js'), '// old agent dist\n');
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(home, '.local', 'bin', 'ccd'), '#!/bin/sh\n# the OLD ccd\n', { mode: 0o755 });
  const units = join(home, '.config', 'systemd', 'user');
  mkdirSync(units, { recursive: true });
  writeFileSync(join(units, 'ccrc.service'), '[Unit]\nDescription=old ccrc.service\n');
  writeFileSync(join(units, 'claude-session@.service'), '[Unit]\nDescription=old supervisor unit\n');
  // The same "this box already had one" fixture, in launchd's spelling. A box
  // whose job files are systemd units is not a macOS box, and the backup step
  // reads whichever directory THIS platform installs into — so a fixture that
  // plants only the Linux pair leaves the Darwin arm with nothing to copy and
  // the assertion measuring the fixture rather than the code.
  if (process.platform === 'darwin') {
    const agents = join(home, 'Library', 'LaunchAgents');
    mkdirSync(agents, { recursive: true });
    writeFileSync(join(agents, 'app.ccrc.ccrc.plist'),
      '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>'
      + '<key>Label</key><string>app.ccrc.ccrc</string></dict></plist>\n');
  }
  if (opts.version !== undefined) {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'),
      `{"sha":"oldsha0000000000000000000000000000000000","ref":"main",`
      + `"builtAt":"2026-08-20T00:00:00Z","dirty":false,"version":"${opts.version}"}\n`);
  }
}

/** A REAL sqlite coord.db — `backup-coord.mjs` runs `VACUUM INTO` against it,
 *  so a text placeholder would make the backup step fail for a fixture
 *  reason. One table, one row, enough to prove the snapshot is a database. */
export function plantCoordDb(home: string): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  const db = new DatabaseSync(join(home, '.ccrc', 'coord.db'));
  db.exec('CREATE TABLE fixture (x INTEGER); INSERT INTO fixture VALUES (42);');
  db.close();
}

/** The temp-root collector's generation journal (path-identity spec 2026-10-12 §5.3), planted with one record under
 *  the fixture HOME. Its name is the server adapter's ONE constant, never retyped here. It comes back with what a later
 *  assertion compares: the path, the exact bytes and the inode, so a copy placed back by rename reads as touched even
 *  when its bytes agree. */
export function plantCollectJournal(home: string): { readonly path: string; readonly bytes: Buffer; readonly ino: number } {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  const p = join(home, '.ccrc', COLLECT_LANE_JOURNAL_BASENAME);
  writeFileSync(p, '{"generation":3}\n', { mode: 0o600 });
  return { path: p, bytes: readFileSync(p), ino: statSync(p).ino };
}

/** The journal is still the file planted: present, the same inode, the same bytes. */
export function expectJournalUntouched(j: { readonly path: string; readonly bytes: Buffer; readonly ino: number }, by: string): void {
  expect(existsSync(j.path), `${by} removed the journal`).toBe(true);
  expect(statSync(j.path).ino, `${by} replaced the journal (a copy placed back by rename)`).toBe(j.ino);
  expect(readFileSync(j.path).equals(j.bytes), `${by} rewrote the journal`).toBe(true);
}

/** Every file under a backup directory that carries the journal's name. No backup holds one (§5.3). */
export function journalCopiesUnder(dir: string): string[] {
  expect(existsSync(dir), `no backup directory at ${dir}`).toBe(true);
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((p) => path.basename(p) === COLLECT_LANE_JOURNAL_BASENAME);
}

/** `_upd_report`'s one leave-the-journal line in a downgrade's report, its name read off the constant. */
export const JOURNAL_NAME_RE = COLLECT_LANE_JOURNAL_BASENAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const LEAVE_JOURNAL_LINE = new RegExp(`^update: rollback: {3}\\(leave ~/\\.ccrc/${JOURNAL_NAME_RE} in place: `, 'm');

/** The two files an update clears before its staged spine (`~/.ccrc/installed`,
 *  the completed-install record; `~/.ccrc/ccrc-caps`), planted as a box that
 *  finished an install of `plantOldBox`'s build has them — the record's line 1
 *  is that build's sha, line 2 the provenance word. Returns both bodies. */
export function plantCompletedRecord(home: string): { installed: string; caps: string } {
  const installed = 'oldsha0000000000000000000000000000000000\nunsigned\n';
  const caps = 'os linux\nupdate-gate\nrollback-flip\n';
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'installed'), installed);
  writeFileSync(join(home, '.ccrc', 'ccrc-caps'), caps);
  return { installed, caps };
}

// ── The release fixture (install-sh.test.ts's local:// URL space) ─────────

export const sha256 = (p: string): string =>
  createHash('sha256').update(readFileSync(p)).digest('hex');

/** The MANIFEST exactly as `build-release.sh` generates it: every file,
 *  per-file sha256, sorted under LC_ALL=C, generated OUTSIDE the tree and
 *  moved in. */
export function writeManifest(tree: string): void {
  const tmp = `${tree}.MANIFEST.tmp`;
  const r = spawnSync('bash', ['-c',
    // PORTABLE ON PURPOSE, and it mirrors `deploy/build-release.sh`'s own
    // line: `xargs -d` and `sha256sum` are both GNU — BSD xargs rejects `-d`
    // outright, which made this fixture fail on macOS with an error naming
    // neither the tree nor the test. `-0` exists in both, `tr` supplies the
    // NUL, and the digest tool is chosen by platform. Both print the same
    // "<digest>  <name>" line, so the MANIFEST is identical either way.
    'sha=sha256sum; [ "$(uname -s)" = Darwin ] && sha="shasum -a 256";'
    + ' cd "$1" && find . -type f | sed \'s|^\\./||\' | LC_ALL=C sort'
    + ' | tr \'\\n\' \'\\0\' | xargs -0 $sha > "$2"',
    '--', tree, tmp], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture MANIFEST failed: ${r.stderr}`);
  renameSync(tmp, join(tree, 'MANIFEST'));
}

/** `build.json` shaped exactly as `build-release.sh` ships it. */
export function shippedStamp(version: string, sha: string): string {
  return `{"sha":"${sha}","ref":"release","builtAt":"2026-08-21T00:00:00Z","dirty":false,"version":"${version}"}\n`;
}

/** The FULL flavour: the repo's own `ccd/`, `shared/`, `deploy/` (minus the
 *  live mail token — the exclusion `git archive` provides for real releases),
 *  `install.sh`, the two package.jsons the doctor reads, dist stubs, and the
 *  shipped stamp. The staged `ccrc install` inside is the real verb. */
export function fullTree(home: string, opts: { version: string; sha: string }): string {
  const tree = join(home, `payload-${opts.version}`);
  const noToken = (src: string): boolean => !src.endsWith('ccrc-mail.token');
  cpSync(join(REPO, 'ccd'), join(tree, 'ccd'), { recursive: true });
  cpSync(join(REPO, 'shared'), join(tree, 'shared'), { recursive: true });
  cpSync(join(REPO, 'deploy'), join(tree, 'deploy'), { recursive: true, filter: noToken });
  copyFileSync(join(REPO, 'install.sh'), join(tree, 'install.sh'));
  for (const rel of ['server/package.json', 'agent/package.json']) {
    mkdirSync(dirname(join(tree, rel)), { recursive: true });
    copyFileSync(join(REPO, rel), join(tree, rel));
  }
  mkdirSync(join(tree, 'server', 'dist', 'server', 'src'), { recursive: true });
  writeFileSync(join(tree, 'server', 'dist', 'server', 'src', 'index.js'),
    '// fixture: stands in for the built server\n');
  mkdirSync(join(tree, 'server', 'dist-pwa'), { recursive: true });
  writeFileSync(join(tree, 'server', 'dist-pwa', 'index.html'),
    '<!doctype html><title>fixture PWA</title>\n');
  // Docs W4: the bundle's service worker, which the closing doctor's `docs-sw` measures (`swFixtures.ts`).
  writeFileSync(join(tree, 'server', 'dist-pwa', 'sw.js'), swJs());
  // D-1159: the shape `ccrc-agent.service` actually runs, and the one
  // `_inst_tree` now preflights — `agent/dist/agent/src/index.js`, tsc's
  // rootDir-preserving output, exactly as `server/dist/server/src/index.js`
  // above. This fixture used to plant a FLAT `agent/dist/index.js`, a release
  // shape the unit could never have started; nothing measured the difference
  // until the preflight refused it. The flat file stays beside it because the
  // backup/replace assertions below name it.
  mkdirSync(join(tree, 'agent', 'dist', 'agent', 'src'), { recursive: true });
  writeFileSync(join(tree, 'agent', 'dist', 'agent', 'src', 'index.js'),
    '// fixture: stands in for the built agent\n');
  writeFileSync(join(tree, 'agent', 'dist', 'index.js'), '// fixture agent build\n');
  writeFileSync(join(tree, 'build.json'), shippedStamp(opts.version, opts.sha));
  writeManifest(tree);
  return tree;
}

/** The STUB flavour: `ccd/ccrc` records its argv and exits as told — update's
 *  own logic (URLs, ordering, role, report) measured without re-running the
 *  spine `ccrc-install-*.test.ts` already owns. */
export function stubTree(home: string, opts: { version: string; installExit?: number }): string {
  const tree = join(home, `payload-${opts.version}`);
  mkdirSync(join(tree, 'ccd'), { recursive: true });
  writeFileSync(join(tree, 'ccd', 'ccrc'),
    '#!/bin/sh\nprintf \'%s\\n\' "$0" "$@" > "$HOME/staged-ccrc-argv"\n'
    + 'printf \'%s\\n\' "${CCRC_UPDATE_VERIFIED:-unset}" > "$HOME/staged-ccrc-env"\n'
    // Task 2: the lock's marker must never reach the spine (it would exempt
    // a grandchild `ccrc update` from the lock), and a spine that leaves a
    // process behind must not leave the lock held with it. The lingerer's
    // own descriptors 0-2 go to /dev/null so the runner's pipes close when
    // the run does; any OTHER descriptor it was handed — a lock fd — it keeps
    // for 30 s.
    + 'printf \'%s\\n\' "${CCRC_UPDATE_LOCK_HELD:-unset}" > "$HOME/staged-ccrc-lockenv"\n'
    // An update never installs node, and the staged spine inherits that (`cmd_update` exports it).
    + 'printf \'%s\\n\' "${NODE_NO_INSTALL:-unset}" > "$HOME/staged-ccrc-nodenoinstall"\n'
    + 'if [ -f "$HOME/fixture-spine-linger" ]; then sleep 30 >/dev/null 2>&1 </dev/null & echo $! > "$HOME/spine-linger-pid"; fi\n'
    // Task 3 (§16's parent-kill fixture): a spine that records its argv and
    // then WAITS, at most 20 s, for the test's go file. The run is parked
    // mid-install while the parent's process group is killed, so whether the
    // detached run survived is not a race against how fast it finishes.
    + 'if [ -f "$HOME/fixture-install-wait" ]; then i=0; while [ ! -f "$HOME/fixture-install-go" ] && [ "$i" -lt 400 ]; do sleep 0.05; i=$((i+1)); done; fi\n'
    // W4 Task 4: what `~/.ccrc/previous` held WHILE the staged spine ran —
    // "written before the install" is read here, never off the file
    // afterwards, which a write moved after the spine would leave the same.
    + 'if [ -f "$HOME/.ccrc/previous" ]; then cp "$HOME/.ccrc/previous" "$HOME/staged-saw-previous"; else : > "$HOME/staged-saw-no-previous"; fi\n'
    // W4 Task 4: the step marker a real spine's `_inst_step` would leave,
    // from a fixture file — the classifier's subject is cmd_update's READING
    // of it; the writing is ccrc-install-*.test.ts's.
    + '[ -f "$HOME/fixture-install-step" ] && cp "$HOME/fixture-install-step" "$HOME/.ccrc/install-step"\n'
    // W4 Task 4 (review fix): a spine older than W4 writes no marker, but its
    // `_inst_stamp` still places the release's own stamp. `$0` is the staged
    // `<tree>/ccd/ccrc`, so the tree's `build.json` is `${0%/ccd/ccrc}/build.json`.
    + '[ -f "$HOME/fixture-restamp" ] && cp "${0%/ccd/ccrc}/build.json" "$HOME/.ccrc/build.json"\n'
    // The gate's three answers for a spine that never ran (design §11): the
    // version `/health` reports is the one this "install" placed; the two
    // main jobs are loaded for launchctl's `print` (what `_inst_enable_darwin`
    // bootstraps — without it every Darwin STUB run fails the gate); and
    // `fixture-stub-installed` writes the completed-install record, so a
    // non-zero exit reads as D-3114's "completed, doctor FAILed".
    + `printf '%s\\n' '${opts.version}' > "$HOME/fixture-health-version"\n`
    + 'printf \'app.ccrc.ccrc.plist\\napp.ccrc.ccrc-agent.plist\\n\' >> "$HOME/launchctl-loaded"\n'
    + '[ -f "$HOME/fixture-stub-installed" ] && mkdir -p "$HOME/.ccrc" && printf \'newsha0000000000000000000000000000000000\\n\' > "$HOME/.ccrc/installed"\n'
    // Task 6: a test's own "what the spine did to the box" — moving the tree,
    // placing the new `ccd/ccrc` arm 2 will run, rewriting a marker — as a
    // FILE the shim reads (knobs are files: `replantDoctorStubs` clobbers a
    // re-planted stub between two runner calls, never a fixture file).
    + '[ "$1" = install ] && [ -f "$HOME/fixture-on-install" ] && { sh "$HOME/fixture-on-install" || exit 91; }\n'
    // W4a Task 9: the update killed mid-install. The shim has recorded its
    // argv (so the test knows the spine is running) and then does not
    // return; the test kills the whole process group.
    + '[ -f "$HOME/fixture-install-hang" ] && sleep 30\n'
    + `exit ${opts.installExit ?? 0}\n`, { mode: 0o755 });
  writeFileSync(join(tree, 'MARKER'), 'release payload\n');
  writeFileSync(join(tree, 'build.json'),
    shippedStamp(opts.version, 'newsha0000000000000000000000000000000000'));
  writeManifest(tree);
  return tree;
}

/** The STUB flavour, but with `build.json`'s sha overwritten to match the
 *  BOX's own running stamp — the shape `_upd_converged` needs (staged sha
 *  == running sha == the completed-install record) to take its EARLY-RETURN
 *  path once a real `cmd_update` reaches it, rather than `stubTree`'s
 *  default `newsha…`, which reads as a genuine upgrade and would drive the
 *  box into a full (never-exercised-here) staged install. `MANIFEST` is
 *  removed before recomputing so the new one does not hash a stale copy of
 *  itself into itself. */
export function selfConvergedTree(home: string, version: string, sha: string): string {
  const tree = stubTree(home, { version });
  rmSync(join(tree, 'MANIFEST'));
  writeFileSync(join(tree, 'build.json'), shippedStamp(version, sha));
  writeManifest(tree);
  return tree;
}

/** Tars a payload tree into the `local://` URL space (`latest/download` or
 *  `download/<tag>`), writes SHA256SUMS beside it. `corruptInner` rewrites a
 *  file INSIDE the tree after the MANIFEST was generated (outer checksum
 *  honest, per-file digest not); `tamper` appends to the tarball after the
 *  sums were written (outer checksum dishonest). */
export function packRelease(home: string, tree: string,
  opts: { tag: string; latest?: boolean; tamper?: boolean; corruptInner?: string; asName?: string; bundle?: boolean } = { tag: 'v9.9.9' }): void {
  if (opts.corruptInner !== undefined) {
    appendFileSync(join(tree, opts.corruptInner), '\n// corrupted after the MANIFEST was written\n');
  }
  const relDir = opts.latest === false
    ? join(home, 'releases', 'download', opts.tag)
    : join(home, 'releases', 'latest', 'download');
  mkdirSync(relDir, { recursive: true });
  // `asName` lets SHA256SUMS under one tag's directory name ANOTHER tag's
  // tarball — the re-served-release shape Task 9's binding refuses.
  const name = opts.asName ?? `ccrc-${opts.tag}.tar.gz`;
  const tarRes = spawnSync('tar', ['-czf', join(relDir, name), '-C', tree, '.'], { encoding: 'utf8' });
  if (tarRes.status !== 0) throw new Error(`fixture tar failed: ${tarRes.stderr}`);
  // PLATFORM-CHOSEN, exactly as writeManifest above chooses (and for the
  // same reason it records): this runs on the HOST's own PATH, and the
  // test-macos leg deliberately carries no coreutils — a bare `sha256sum`
  // here fails every release-packing test on the one runner where the
  // Darwin tests are not skipped, before `ccrc update` is ever spawned
  // (found by this branch's own adversarial review). Both spellings write
  // the identical "<digest>  <name>" line.
  const sumRes = spawnSync('bash', ['-c',
    'sha=sha256sum; [ "$(uname -s)" = Darwin ] && sha="shasum -a 256";'
    + ` $sha '${name}' > SHA256SUMS`],
  { cwd: relDir, encoding: 'utf8' });
  if (sumRes.status !== 0) throw new Error(`fixture digest failed: ${sumRes.stderr}`);
  if (opts.tamper) appendFileSync(join(relDir, name), 'one appended byte-run after the sums were written');
  // The provenance bundle (design §5): present by default — the `node` shim
  // in updateEnv decides whether it "verifies"; `bundle: false` models a
  // release older than provenance, the one shape --allow-unsigned admits.
  if (opts.bundle !== false) writeFileSync(join(relDir, `${name}.sigstore.json`), `{"fixture":"bundle for ${name}"}\n`);
}

/** Runs `ccrc update` — the CHECKOUT's ccrc (the code under test), against
 *  the fixture box. TMPDIR is pointed inside the home so the `mktemp -d`
 *  staging dir stays inside a tree the test can search. */
export function runUpdate(home: string, args: string[] = [],
  extraEnv: NodeJS.ProcessEnv = {}): Result {
  mkdirSync(join(home, 'tmp'), { recursive: true });
  const env = {
    ...updateEnv(home),
    TMPDIR: join(home, 'tmp'),
    CCRC_RELEASE_BASE_URL: `local://${home}/releases`,
    ...extraEnv,
  };
  replantDoctorStubs(home);
  // Fix round 2 (N1/N5): on the FINAL merged env, immediately before the
  // spawn. `updateEnv` plants no PRE-EXISTING fake manager for
  // `adoptPlantedSystemd` to adopt (unlike verbEnv's/ccrcEnv's real-lane
  // cases, where `plantSystemd` runs first) — its own `plant('systemd-run',
  // …)`/`plant('systemctl', …)` calls are the ONLY layer that ever ran here
  // before this round, with no structural fallback if either line were ever
  // lost. This call is that fallback. No case in this file legitimately
  // reaches no manager at all.
  assertSpineFrontContained(env, home);
  // Wave 9 R10d: and no real ssh, scp, tmux, gh, curl, launchctl, nor the real user bus (the final env).
  assertNoRealTool(env, home);
  const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'update', ...args],
    { env, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function freshUpdateBox(prefix: string): string {
  const home = mkTmp(prefix);
  healthyBox(home);
  return home;
}

/** The MANDATORY KillMode=process drop-in (R1). Hoisted to file scope
 *  because two describes need it: the sweep's own cases, and the gate's
 *  `converged()` — a "NO sweep" assertion on a box with no drop-in is
 *  VACUOUS, since the preflight would refuse the sweep with the gate
 *  deleted too. */
export function plantKillModeDropIn(home: string): void {
  const d = join(home, '.config', 'systemd', 'user', 'claude-session@.service.d');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '50-killmode.conf'), '[Service]\nKillMode=process\n');
}

/** What the recording `systemctl --user list-units claude-session@*` stub
 *  answers with — two live supervisors, so a sweep that RAN has something
 *  to restart and leaves a `try-restart` in the recording. */
export const UNIT_LINES =
  'claude-session@alpha.service loaded active running fixture supervisor\n'
  + 'claude-session@beta.service loaded active running fixture supervisor\n';

/** A sorted recursive listing of `<home>` as `<relpath>\t<sha256>` lines
 *  (a regular file by its CONTENT digest, T2 of the final review: a size
 *  line let a same-length rewrite — every record is `<sha>\n`, 41 bytes —
 *  pass a "writes nothing" case) —
 *  the before/after snapshot the `--check` write-nothing case compares.
 *  A SYMLINK is recorded as `<relpath> -> <its value>` and not descended
 *  (W6 Task 7): on a versioned box `~/ccrc` is a link, and `lstat`'s size of
 *  a link is the length of its target, so a flip between two same-length
 *  names (`v9.9.1` → `v9.9.0`) left the old size-only line
 *  byte-identical — measured. `~/ccrc-versions/` is a real directory under
 *  `<home>` and is walked on its own.
 *  `<home>/tmp/**` is the staging dir TMPDIR points at (update's own
 *  mktemp -d space, cleaned by its EXIT trap but timing-dependent) and
 *  `<home>/curl-argv` and `<home>/curl-full-argv` (fix round 1 item 12) are
 *  the fixture's own recordings, so both are the harness writing, not the
 *  verb. */
export function homeSnapshot(home: string): string[] {
  const out: string[] = [];
  const walk = (d: string, prefix: string): void => {
    for (const e of readdirSync(d).sort()) {
      const rel = prefix === '' ? e : `${prefix}/${e}`;
      if (rel === 'tmp' || rel.startsWith('tmp/') || rel === 'curl-argv' || rel === 'curl-full-argv') continue;
      const p = join(d, e);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) out.push(`${rel} -> ${readlinkSync(p)}`);
      else if (st.isDirectory()) { out.push(`${rel}/`); walk(p, rel); }
      else if (st.isFile()) out.push(`${rel}\t${sha256(p)}`);
      else out.push(`${rel}\t(special file)`);
    }
  };
  walk(home, '');
  return out.sort();
}

/** Every file under `dir` with its digest — the byte-compare the
 *  "changes NOTHING" refusal tests rest on. */
export function treeDigest(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  const walk = (d: string, prefix: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const rel = prefix === '' ? e : `${prefix}/${e}`;
      if (statSync(p).isDirectory()) walk(p, rel);
      else out[rel] = sha256(p);
    }
  };
  walk(dir, '');
  return out;
}

export const localUrls = (home: string): string[] => (existsSync(join(home, 'curl-argv'))
  ? readFileSync(join(home, 'curl-argv'), 'utf8').split('\n')
    .filter((l) => l.startsWith('local://'))
  : []);

/** Fix round 1 item 12: every FULL curl invocation this run made, one line
 *  per call (the stub's own `$*`), for pinning FLAGS rather than only the
 *  URL — `curl-argv` (above) cannot see them. */
export const curlFullArgv = (home: string): string[] => (existsSync(join(home, 'curl-full-argv'))
  ? readFileSync(join(home, 'curl-full-argv'), 'utf8').split('\n').filter((l) => l !== '')
  : []);

/** `update --check`'s machine line, found by its prefix rather than assumed
 *  to be line 1 — the same rule rollout's parser applies (`grep -m1
 *  '^check: '`), so a sentence printed before it can never shift what a
 *  test reads. */
export const checkLine = (s: string): string => s.split('\n').find((l) => l.startsWith('check: ')) ?? '';

/** The words THIS ccrc can do (`_ccrc_cap_words`), as `--check` joins them:
 *  W1's three, W4's four, W6's `versions` and the box-token lifecycle's
 *  `token-sync`, `detach` on Linux only
 *  (decision 17). A literal, not a read of ccd/ccrc — a pin derived from the
 *  list it pins cannot red. */
export const CAPS_NOW = process.platform === 'darwin'
  ? 'verify,node-id,floor,update-json,update-gate,rollback,versions,token-sync'
  : 'verify,node-id,floor,update-json,update-gate,rollback,versions,token-sync,detach';
/** The machine line as key → value. Values never contain a space or `=`
 *  (caps= joins its words with commas), so one split per field is exact. */
export const parseCheck = (s: string): Record<string, string> =>
  Object.fromEntries(checkLine(s).replace(/^check: /, '').split(' ').map((kv) => kv.split('=') as [string, string]));

/** The backup directory THIS run announced — parsed from the transcript, not
 *  guessed from `ls`: the hooks installer inside a full run writes its own
 *  timestamped siblings into `~/ccrc-backups/`. Fix round 1 item 11 / review
 *  155 C17: the announcement itself now redacts the fixture's absolute HOME
 *  to a literal `~` (`_upd_redact`, same as every die sentence), so this
 *  expands it back to `home` — the caller's real fs calls need a real path,
 *  never the literal tilde a shell alone would expand. */
export function announcedBackupDir(stdout: string, home: string): string {
  const m = /^update: backup: (\S+)/m.exec(stdout);
  if (m === null) throw new Error(`no "update: backup:" line in:\n${stdout}`);
  const p = m[1]!;
  return p === '~' || p.startsWith('~/') ? join(home, p.slice(1)) : p;
}

/** ONE ccrc function, run in a shell that SOURCED the checkout's ccd/ccrc (its
 *  dispatch is guarded by `BASH_SOURCE[0] == $0`, so sourcing defines and
 *  runs nothing), against the fixture box's environment. For the functions
 *  whose arms the verb cannot reach on this platform — `CCD_OS` is computed
 *  from `$OSTYPE` at source time, so an assignment AFTER the `.` is the one
 *  way a Linux run measures a Darwin arm. */
export function sourcedCcrc(home: string, script: string): Result {
  const r = spawnSync(BASH, ['-c', `. "$1"; ${script}`, 'ccrc-under-test', join(REPO, 'ccd', 'ccrc')],
    { env: updateEnv(home), encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// ── Task 6: the automatic restore's fixtures ──────────────────────────────
// The arm-2 child is `bash "$BOX_TREE_DIR/ccd/ccrc" update --to <previous>
// --no-gate --from restore` — the NEW tree's ccrc, because `~/ccrc` is what
// the staged spine just placed (spec §10's argv). A STUB-flavour install
// places no tree, so the new tree's `install` places the child itself,
// through `fixture-on-install`: either this recorder, or a broken one.
export const OLD_SHA = 'oldsha0000000000000000000000000000000000';
/** Records its argv, the lock marker it was handed, its own $PPID and
 *  whether ~/.ccrc/update.lock was HELD while it ran — a fresh `flock -n`
 *  that FAILS is the measurement (spec §10's own), and it can only fail
 *  because the parent holds its descriptor. Exits `fixture-restore-exit`.
 *  D-3275: when that exit is 3 — a real child's spine completed and only its
 *  trailing doctor FAILed (D-3114) — it writes the completed-install record
 *  ITS OWN spine would have, so a test can measure that arm 2's rc-3 arm
 *  leaves it alone (only arm 3 would have deleted it). */
export const RESTORE_RECORDER = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$0" "$@" > "$HOME/restore-child-argv"',
  'locked=no',
  'if command -v flock >/dev/null 2>&1 && ! flock -n "$HOME/.ccrc/update.lock" true; then locked=yes; fi',
  'printf \'held=%s ppid=%s locked=%s\\n\' "${CCRC_UPDATE_LOCK_HELD:-unset}" "$PPID" "$locked" > "$HOME/restore-child-env"',
  'code=0; [ -f "$HOME/fixture-restore-exit" ] && IFS= read -r code < "$HOME/fixture-restore-exit"',
  '[ "$code" = 3 ] && { mkdir -p "$HOME/.ccrc"; printf \'childsha0000000000000000000000000000000\\n\' > "$HOME/.ccrc/installed"; }',
  'exit "$code"',
].join('\n') + '\n';
/** The hazard spec §11's arm 2 carries: a new tree whose own ccrc is broken. */
export const RESTORE_BROKEN = '#!/bin/sh\necho "fixture: the new tree\'s ccd/ccrc is broken" >&2\nexit 1\n';

export interface RestoreBoxOpts {
  /** The running stamp's version; `null` = an unversioned box. Default `v1.0.0`. */
  oldVersion?: string | null;
  /** `~/.ccrc/installed` BEFORE the update; `null` = absent. Default the verified one-line marker. */
  marker?: string | null;
  /** The previous release ships a provenance bundle. Default true. */
  prevBundle?: boolean;
  /** What the new tree places at `~/ccrc/ccd/ccrc`. Default `recorder`. */
  child?: 'recorder' | 'broken' | 'none';
  /** More sh lines the new tree's `install` runs, before it places the child. */
  onInstall?: string[];
  /** The new tree's staged install exit code. Default 0. */
  installExit?: number;
}

/** A box whose update to the STUB release v2.0.0 FAILS its health gate:
 *  `/health` answers the OLD build (Task 5's `fixture-health-pin`), which is
 *  spec §11's "wrong `/health` version" — exit 4, and `_upd_restore` runs.
 *  The previous release is published under `download/<old>/` so arm 2 has
 *  something to ask about. */
export function plantRestoreBox(home: string, opts: RestoreBoxOpts = {}): void {
  const oldVersion = opts.oldVersion === undefined ? 'v1.0.0' : opts.oldVersion;
  if (oldVersion === null) plantOldBox(home); else plantOldBox(home, { version: oldVersion });
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  const marker = opts.marker === undefined ? `${OLD_SHA}\n` : opts.marker;
  if (marker !== null) writeFileSync(join(home, '.ccrc', 'installed'), marker);
  if (oldVersion !== null) {
    packRelease(home, stubTree(home, { version: oldVersion }),
      { tag: oldVersion, latest: false, bundle: opts.prevBundle !== false });
  }
  packRelease(home, stubTree(home, { version: 'v2.0.0', installExit: opts.installExit }), { tag: 'v2.0.0' });
  const lines = [...(opts.onInstall ?? [])];
  const child = opts.child ?? 'recorder';
  if (child !== 'none') {
    writeFileSync(join(home, 'fixture-restore-child'), child === 'recorder' ? RESTORE_RECORDER : RESTORE_BROKEN);
    lines.push('mkdir -p "$HOME/ccrc/ccd" && cp "$HOME/fixture-restore-child" "$HOME/ccrc/ccd/ccrc"');
  }
  writeFileSync(join(home, 'fixture-on-install'), `${lines.join('\n')}\n`);
  writeFileSync(join(home, 'fixture-health-pin'), `${oldVersion ?? 'v0.0.1'}\n`);
}

// The reports this run placed are read through Task 1's file-scope
// `reportWrites` (every `update.json` the `mv` recorder saw, in order) and
// `lastReport` (the file on disk) — never a second copy of either.
export const restoreChildArgv = (home: string): string[] | null => (existsSync(join(home, 'restore-child-argv'))
  ? readFileSync(join(home, 'restore-child-argv'), 'utf8').split('\n').filter((l) => l !== '') : null);

// D-3140: `jq` joins the preflight's own tool list (`for t in curl tar gzip
// node awk jq`) so a jq-less box is refused BY NAME, up front — never as
// `_box_build_fields`'s own internal jq probe surfacing partway through a run
// as a stamp that "does not parse".
export function pathWithoutJq(home: string): string {
  const d = join(home, 'no-jq-bin');
  mkdirSync(d, { recursive: true });
  // `curl` and `node` are the fixture's OWN stubs — `updateEnv`/
  // `replantDoctorStubs` plant them into `$HOME/.local/bin` regardless of
  // what PATH this run ends up using (both run before `spawnSync`, inside
  // `runUpdate`). Putting that directory FIRST means PATH resolution finds
  // the fixture's curl (never reaches `local://`'s real-curl edge, let
  // alone a live network address the health probe might otherwise dial)
  // and the fixture's node (which only forwards to the real interpreter for
  // calls the verify-provenance shim does not intercept) before any real
  // binary — containment that does not depend on the jq guard firing first
  // (`ccrc-installFixture.ts`'s `pathWithout` idiom: fixture plants win, real
  // tools are the fallback for what nothing here stubs). `tar`/`gzip`/`awk`
  // have no fixture stub in this suite — those three alone are real-tool
  // symlinks in the fallback directory.
  // Task 2: `flock` and `mkdir` join because the lock (`_upd_lock`) is taken
  // BEFORE the tool preflight — without them this PATH dies at the lock's
  // own flock sentence (or at "cannot create ~/.ccrc"), never at jq's, and
  // the D-3140 case below measures the wrong refusal. `stat` joins (fix
  // round 1 item 9 / review 155 C15) because `cmd_watchdog` now runs
  // `_upd_report_readable` (its own portable `_plat_size`, i.e. `stat`)
  // before its `command -v jq` preflight — without it this PATH would die
  // at "unreadable or malformed" (rc 2, `stat` missing), never at jq's.
  for (const b of ['tar', 'gzip', 'awk', 'flock', 'mkdir', 'stat']) wrapRealTool(realPath(b), join(d, b));
  return `${join(home, '.local', 'bin')}:${d}`;
}

/** F5 (fix round 1, Task 9): the watchdog's own `flock` preflight, the twin
 *  of `pathWithoutJq` above — everything the watchdog calls before its
 *  `command -v flock` check (jq, `stat` — fix round 1 item 9's
 *  `_upd_report_readable` — and `date` for its `now="$(date +%s)"`) stays
 *  real, only `flock` itself is missing. */
export function pathWithoutFlock(home: string): string {
  const d = join(home, 'no-flock-bin');
  mkdirSync(d, { recursive: true });
  // `mv`/`chmod` join (review fix round 1 M5): `cmd_rollback`'s own
  // reporting window (fix round 1 item 3, restructured by review fix round
  // 1 I1) now OPENS before `_upd_lock` runs for a non-`cli` rollback, so a
  // flock-missing die there — unlike `ccrc update --detach`'s own, which
  // dies before any window opens — DOES write a `failed` report, and
  // `_upd_phase`'s own write needs both to place it.
  for (const b of ['jq', 'tar', 'gzip', 'awk', 'mkdir', 'date', 'stat', 'mv', 'chmod'])
    wrapRealTool(realPath(b), join(d, b));
  return `${join(home, '.local', 'bin')}:${d}`;
}

/** Review fix round 1, M4: `cmd_rollback`'s own tool preflight ("curl is
 *  required by 'ccrc rollback'") — the twin of `pathWithoutJq`/
 *  `pathWithoutFlock`, everything real EXCEPT `curl`. No `.local/bin`
 *  prefix: this must NOT include the fixture curl stub (which would answer
 *  every non-local:// URL with a fake 200), so `cmd_rollback`'s real tool
 *  preflight is what refuses. `mv`/`chmod` join for the same reason
 *  `pathWithoutFlock` above needs them: the reporting window is already
 *  open by the time this die fires, so `_upd_phase` actually writes. */
export function pathWithoutCurl(home: string): string {
  const d = join(home, 'no-curl-bin');
  mkdirSync(d, { recursive: true });
  for (const b of ['flock', 'jq', 'tar', 'gzip', 'awk', 'mkdir', 'date', 'stat', 'bash', 'sh', 'mv', 'chmod'])
    wrapRealTool(realPath(b), join(d, b));
  return d;
}

// ── update.json (design 2026-09-20 §10) — the node's report ───────────────
/** Every report `_upd_phase` placed, in order: the recording `mv` in
 *  `updateEnv` appends the staged file's line each time its destination is
 *  `~/.ccrc/update.json`, so each entry here arrived by rename. */
export const reportWrites = (home: string): Array<Record<string, unknown>> =>
  (existsSync(join(home, 'update-json-writes'))
    ? readFileSync(join(home, 'update-json-writes'), 'utf8').split('\n').filter((l) => l !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    : []);
export const lastReport = (home: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
/** The seven keys, in the writer's order (D-3237 adds `pid`), and an eighth, `sweep`, after a sweep (wave 17, D-5314). */
export const REPORT_KEYS = ['target', 'phase', 'startedAt', 'updatedAt', 'detail', 'from', 'pid'];
/** The report's clock: unix SECONDS (`date +%s` on `_upd_phase`'s `now=`
 *  line) — the unit W2's `reportFrom` reads, converting once to ms and
 *  nulling anything above `UNIX_SECONDS_MAX` (a 13-digit ms stamp). Ten
 *  digits until the year 2286. */
export const REPORT_TIME = /^\d{10}$/;

// ── The control plane's projection (design 2026-09-20 §9; W4a Task 8) ────
// Fixtures for the two describes below. The reader's ONE clock is
// `date +%s` — the document is unix SECONDS — so every case that plants a
// projection freezes it: a lease compared against a moving second is a
// flake, and "a lease EQUAL to now is still in force" is unmeasurable
// without it.
export const REAL_DATE = realPath('date');
export const INTENT_NOW = 2_000_000_000;

export interface IntentFields {
  epoch?: string; issued?: string; lease?: string; channel?: string;
  desired?: string; desiredStable?: string; desiredDev?: string; auto?: string;
}

/** Spec §9's nine-line document in its own order, SECONDS, ending `end\n` —
 *  the grammar W2's route and server-role writer render and `ccd-update-sync`
 *  installs. Defaults: in force at INTENT_NOW (issued a minute before, lease
 *  issued + 900, `pool_epoch`'s lease), channel stable, desired v2.0.0 on
 *  stable and v2.1.0 on dev. */
export function intentDoc(f: IntentFields = {}): string {
  const issued = f.issued ?? String(INTENT_NOW - 60);
  return [
    `epoch ${f.epoch ?? '7'}`,
    `issued ${issued}`,
    `lease ${f.lease ?? String(Number(issued) + 900)}`,
    `channel ${f.channel ?? 'stable'}`,
    `desired ${f.desired ?? 'v2.0.0'}`,
    `desired-stable ${f.desiredStable ?? 'v2.0.0'}`,
    `desired-dev ${f.desiredDev ?? 'v2.1.0'}`,
    `auto ${f.auto ?? 'off'}`,
    'end',
  ].join('\n') + '\n';
}

export const intentPath = (home: string): string => join(home, '.ccrc', 'update-intent');

/** The projection at its one path, mode 0600 — the mode W2's writer and the
 *  puller both place it with. */
export function plantIntent(home: string, text: string | Buffer): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(intentPath(home), text, { mode: 0o600 });
}

/** The role where `cmd_install` records it: `~/.ccrc/ccrc.env`'s `CCRC_ROLE=`. */
export function plantRole(home: string, role: 'fleet' | 'server' | 'both'): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'ccrc.env'), `CCRC_ROLE=${role}\n`);
}

/** "Configured" on a fleet node: the puller's timer unit FILE is installed —
 *  `_pool_sync_installed`'s rule, and `plantPoolSyncTimer`'s zero-byte idiom
 *  (in `ccdWsHelpers.ts`): nothing reads the unit's content. */
export function plantSyncTimer(home: string): void {
  const units = join(home, '.config', 'systemd', 'user');
  mkdirSync(units, { recursive: true });
  writeFileSync(join(units, 'ccd-update-sync.timer'), '');
}

/** Freezes `date +%s` at `s` (every other `date` argv execs the real one).
 *  Planted in `doctor-stubs`, so every run's `replantDoctorStubs` re-plants
 *  it ahead of the real binary on PATH. */
export function plantClock(home: string, s: number = INTENT_NOW): void {
  writeFileSync(join(home, 'fixture-now'), `${s}\n`);
  writeFileSync(join(home, 'doctor-stubs', 'date'),
    '#!/bin/sh\n'
    + 'if [ "$#" -eq 1 ] && [ "$1" = "+%s" ] && [ -f "$HOME/fixture-now" ]; then\n'
    + '  IFS= read -r n < "$HOME/fixture-now"; echo "$n"; exit 0\n'
    + 'fi\n'
    + `exec ${REAL_DATE} "$@"\n`, { mode: 0o755 });
}

/** `ccrc channel` against the fixture box, in `runUpdate`'s environment and
 *  order (env built, then the doctor stubs re-planted). */
export function runChannel(home: string, args: string[] = []): Result {
  const env = updateEnv(home);
  replantDoctorStubs(home);
  const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'channel', ...args], { env, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** A fleet node the control plane manages: role recorded, timer unit file
 *  installed, the clock frozen, an OLD v1.0.0 build on it. */
export function managedFleetBox(prefix: string): string {
  const home = freshUpdateBox(prefix);
  plantOldBox(home, { version: 'v1.0.0' });
  plantRole(home, 'fleet');
  plantSyncTimer(home);
  plantClock(home);
  return home;
}

export const PULLER_REMEDY = 'systemctl --user start ccd-update-sync.service';
export const SERVER_REMEDY = 'restart ccrc.service (it writes ~/.ccrc/update-intent on every sweep)';
export const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── W6 Task 4: kept versions, the flip back, and an older spine's directory ─
// Arm 1 and a rollback by flip act on a VERSIONED box: `~/ccrc` a link into
// `~/ccrc-versions/<tag>`, with the tag it returns to kept complete beside it.
// Two ways to plant one, deliberately. FULL (`onKeptV1`): a real first
// `ccrc update` onto v1.0.0, so the kept version is one THIS code placed and
// kept, and the spine a flip back runs is the real one. STUB: Task 2's
// `installVersionedTree`, with the kept version's own `ccd/ccrc` swapped for
// `KEPT_SPINE` — the flip's mechanics (argv, the verified flag, the lock
// descriptor) measured without re-running the spine `ccrc-install-*.test.ts`
// owns.
export const V1_SHA = '1'.repeat(40);
export const V2_SHA = '2'.repeat(40);
/** A line no release ships, appended to the KEPT v1.0.0's `ccd/ccd`: a
 *  `~/.local/bin/ccd` carrying it can only have come from that version's own
 *  spine — v2.0.0's spine and both restore arms place a release's ccd. */
export const CCD_SENTINEL = "# fixture: v1.0.0's own ccd, as this box kept it\n";

/** A kept version's own `ccd/ccrc`, standing in for its spine. Records its
 *  argv; whether it was told the version is verified; whether it was handed
 *  the lock marker; and whether it holds a descriptor on
 *  `~/.ccrc/update.lock` — read off `/proc` on Linux, `unmeasured` elsewhere.
 *  Exits `fixture-kept-spine-exit` (default 0). On 0 it writes the
 *  completed-install record as `_inst_installed` would (the kept record, byte
 *  for byte) and loads the two main launchd jobs as `_inst_enable_darwin`
 *  would, so a Darwin gate has a job to sample. It stamps NOTHING — the shape
 *  of a spine older than W6, which cannot stamp from the kept copy. */
export const KEPT_SPINE = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$0" "$@" > "$HOME/kept-spine-argv"',
  // a rollback never installs node: `_ver_flip_back` hands its spine NODE_NO_INSTALL=1
  'printf \'%s\\n\' "${NODE_NO_INSTALL:-unset}" > "$HOME/kept-spine-nodenoinstall"',
  'fd=unmeasured',
  'if [ -d "/proc/$$/fd" ]; then',
  '  fd=closed; lock="$(cd "$HOME/.ccrc" && pwd -P)/update.lock"',
  '  for f in /proc/$$/fd/*; do [ "$(readlink "$f" 2>/dev/null)" = "$lock" ] && fd=inherited; done',
  'fi',
  'printf \'verified=%s held=%s lockfd=%s\\n\' "${CCRC_UPDATE_VERIFIED:-unset}" "${CCRC_UPDATE_LOCK_HELD:-unset}" "$fd" > "$HOME/kept-spine-env"',
  'printf \'app.ccrc.ccrc.plist\\napp.ccrc.ccrc-agent.plist\\n\' >> "$HOME/launchctl-loaded"',
  'code=0; [ -f "$HOME/fixture-kept-spine-exit" ] && IFS= read -r code < "$HOME/fixture-kept-spine-exit"',
  // D-3461: `fixture-kept-spine-completes` is D-3114's shape — the spine
  // COMPLETED (its record is written) and its trailing doctor is what exits
  // non-zero. Without the file, a non-zero exit is a spine that died.
  'if [ "$code" = 0 ] || [ -f "$HOME/fixture-kept-spine-completes" ]; then cp "$HOME/ccrc/.ccrc-installed" "$HOME/.ccrc/installed" || exit 1; fi',
  'exit "$code"',
].join('\n') + '\n';

export const fileText = (p: string): string => readFileSync(p, 'utf8');
/** `~/ccrc`'s link value, or null when it is no link (or absent). */
export const linkOf = (home: string): string | null => {
  try { return readlinkSync(join(home, 'ccrc')); } catch { return null; }
};

/** A W6 box on <name>: `~/ccrc -> ~/ccrc-versions/<name>` (Task 2's
 *  `installVersionedTree`, complete), the box's own stamp and record byte-equal
 *  to that version's kept copies, its floor at <name>, and — when a role is
 *  given — the `ccrc.env` `_inst_env` would have seeded. Returns the version. */
export function plantW6Box(home: string, name: string, sha: string, role?: 'server' | 'fleet' | 'both'): string {
  const root = installVersionedTree(home, name, { stamp: { sha, version: name } });
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  copyFileSync(join(root, '.ccrc-stamp.json'), join(home, '.ccrc', 'build.json'));
  copyFileSync(join(root, '.ccrc-installed'), join(home, '.ccrc', 'installed'));
  writeFileSync(join(home, '.ccrc', 'floor'), `${name}\n`);
  if (role !== undefined) {
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), role === 'fleet'
      ? 'CCRC_ROLE=fleet\n'
      : `CCRC_ROLE=${role}\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n`);
  }
  return root;
}

/** A kept, complete, NOT linked version <name> whose own spine is
 *  `KEPT_SPINE`; `unsigned` makes its kept record the unverified two-line
 *  form. Returns the version root. */
export function keptVersion(home: string, name: string, sha: string, opts: { unsigned?: boolean } = {}): string {
  const root = installVersionedTree(home, name, { link: false, stamp: { sha, version: name } });
  if (opts.unsigned === true) writeFileSync(join(root, '.ccrc-installed'), `${sha}\nunsigned\n`);
  writeFileSync(join(root, 'ccd', 'ccrc'), KEPT_SPINE, { mode: 0o755 });
  // The spine is part of the version's bytes: the digest is taken AFTER it is
  // planted, through the shipped helper, so this version reads kept (D-3465).
  keepDigest(root, home);
  return root;
}

/** `ccrc rollback` from the CHECKOUT against the fixture box — wave 4's
 *  describe-local `runRollback`, at file scope because two of this task's
 *  describes need it. */
export function rollbackRun(home: string, args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): Result {
  mkdirSync(join(home, 'tmp'), { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...updateEnv(home),
    TMPDIR: join(home, 'tmp'),
    CCRC_RELEASE_BASE_URL: `local://${home}/releases`,
    CCRC_UPDATE_HEALTH_S: '0',
    ...extraEnv,
  };
  delete env['CCRC_UPDATE_LOCK_HELD'];
  replantDoctorStubs(home);
  const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', ...args], { env, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** One real (FULL) `ccrc update --to v1.0.0` on an old real-directory box —
 *  the migration (Task 3), the placement and the kept copies (Task 2) all
 *  THIS code's — then the sentinel appended to the kept `ccd/ccd`, and the
 *  recordings cleared so the case's own run is the only one they hold. */
export function onKeptV1(prefix: string): string {
  const home = freshUpdateBox(prefix);
  plantOldBox(home, { version: 'v0.9.0' });
  packRelease(home, fullTree(home, { version: 'v1.0.0', sha: V1_SHA }), { tag: 'v1.0.0', latest: false });
  const r = runUpdate(home, ['--to', 'v1.0.0']);
  expect(r.code, `the first move onto v1.0.0 must complete — stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
  const v1 = join(home, 'ccrc-versions', 'v1.0.0');
  expect(linkOf(home), 'the first move did not leave ~/ccrc pointing at v1.0.0').toBe(v1);
  expect(existsSync(join(v1, '.ccrc-installed')), 'v1.0.0 was placed but not kept complete').toBe(true);
  // The first spine seeded `CCRC_ROLE` into ccrc.env, and a BARE `ccrc update`
  // on a box that records a server role asks for `~/.ccrc/update-intent`
  // (`_upd_target`), which no fixture writes — the case's own update would
  // refuse at exit 1. An env file with no role is the shape of a box whose
  // env predates the key (cmd_update runs the spine bare and follows stable).
  const envFile = join(home, '.ccrc', 'ccrc.env');
  writeFileSync(envFile, fileText(envFile).split('\n').filter((l) => !l.startsWith('CCRC_ROLE=')).join('\n'));
  appendFileSync(join(v1, 'ccd/ccd'), CCD_SENTINEL);
  // The sentinel is a byte the keep never saw: re-record the digest through the
  // shipped helper, so v1.0.0 still reads kept (D-3465) and the sentinel is
  // what "kept" now describes.
  keepDigest(v1, home);
  for (const f of ['curl-argv', 'update-json-writes', 'systemctl-calls']) rmSync(join(home, f), { force: true });
  return home;
}

/** `_ver_kept <name> <role>` on the fixture box, sourced: `rc=<n> why=<VER_WHY>`
 *  (D-3465: 0 kept, 1 absent, 2 incomplete or unmeasured, 3 written through). */
export function verKeptAnswer(home: string, name = 'v1.0.0', role = 'both', env: NodeJS.ProcessEnv = {}): string {
  const r = spawnSync(BASH, ['-c',
    '. "$1"; rc=0; _ver_kept "$2" "$3" || rc=$?; printf \'rc=%s why=%s\\n\' "$rc" "$VER_WHY"',
    'ccrc-under-test', join(REPO, 'ccd', 'ccrc'), name, role],
  { env: { ...updateEnv(home), ...env }, encoding: 'utf8' });
  return r.stdout.split('\n').find((l) => l.startsWith('rc=')) ?? `no answer: ${r.stderr}`;
}

