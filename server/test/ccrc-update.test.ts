// `ccrc update [--to vX.Y.Z]` — stage 4, Task 6 (spec §4). Per box, explicit,
// never automatic: fetch + verify a published release (outer checksum, then
// the per-file MANIFEST), back up coord.db/dists/ccd/units to
// `~/ccrc-backups/<ts>/` BEFORE anything is installed, re-run the `_inst_*`
// spine from the verified staged tree (role-aware, per the CCRC_ROLE the box
// recorded), and print the from → to report. NO sweep here — that is Task 7.
//
// ── THE HARNESS, AND WHERE EACH PIECE COMES FROM ──────────────────────────
// The box fixture is `ccrc-install.test.ts`'s `freshBox` idiom — throwaway
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
//     flavour, because the spine's behaviour is `ccrc-install.test.ts`'s
//     subject, not this file's.
//
// NEVER against a real $HOME; no live tmux/systemd/journal is ever reachable
// (recorders and poisons only). No secret value is ever printed or asserted.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import {
  copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync, existsSync,
  statSync, lstatSync, chmodSync, readdirSync, appendFileSync, renameSync, rmSync,
  symlinkSync, readlinkSync, utimesSync,
} from 'node:fs';
import path, { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { itLinux, itDarwin, platformContrast, python3ProgramArm } from './platformFixtures.js';
import { installVersionedTree } from './installTreeFixture.js';
import { IN_FLIGHT_UPDATE_PHASES, UPDATE_PHASES } from '../../shared/api.js';
// Fix round 1 item 3 / review 155 C31: W2's OWN reader (never a hand copy),
// the same import pattern `update-intent-cross-side.test.ts` already uses.
import { reportFrom, type NodeFileRead } from '../src/update/inventory.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

function realPath(name: string): string {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (p === '') throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
}
const BASH = realPath('bash');
const RSYNC = realPath('rsync');
const REAL_NODE = realPath('node');
const REAL_MV = realPath('mv');
/** The real python3, resolved once and without a throw (W6 Task 2): only the
 *  two macOS programs of `DARWIN_PYTHON3_PROGRAMS` reach it, through the
 *  `python3` stub's `-c` arm. */
const REAL_PYTHON3 = spawnSync('bash', ['-c', 'command -v python3'], { encoding: 'utf8' }).stdout.trim();
// D-3277 (fix round 1, Task 9): the real `flock`, so a shim placed ahead of
// it on PATH can rewrite a file and then `exec` into the genuine binary —
// the locking semantics the shim intercepts stay real, only the write in
// between is fixture-controlled.
const FLOCK = realPath('flock');

interface Result { code: number; stdout: string; stderr: string }

/** GNU `timeout -k`, probed the same way `ccrc-doctor.test.ts`'s own
 *  `DOCTOR_DEADLINE_BIN` is (fix round 1 items 9 and 23-C21): a FIFO block
 *  happens inside a GRANDCHILD (`jq`'s or `flock`'s own open), which a bare
 *  `spawnSync` `timeout` option cannot reach — only `timeout -k`, which puts
 *  the child in its own process group and signals the GROUP, kills it. A
 *  busybox-shaped `timeout` that refuses `-k` is PROBED with a known-124
 *  command first, so a candidate that does not answer 124 is treated as
 *  absent rather than silently bounding nothing. */
const UPD_DEADLINE_BIN: string | null = (() => {
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
function runBounded(argv: string[], env: NodeJS.ProcessEnv, ms = 10000): Result {
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

/** `healthyDoctorBox` (ccrc-install.test.ts), with ONE substitution: the curl
 *  stub is this file's combined release+health stub (below), planted into the
 *  same `doctor-stubs` replant directory so it survives every run's replant. */
function healthyBox(home: string): void {
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

/** `ccrcEnv` (ccrc-install.test.ts), trimmed: the poisoned gh from
 *  `ghContainedEnv` (later shadowed by the doctor stub — the shadow answers,
 *  never execs), journalctl poisoned, systemctl/loginctl as RECORDERS that
 *  answer the shapes the install spine asks, npm a recorder that fabricates
 *  node_modules, rsync a recorder that execs the real binary. */
function updateEnv(home: string): NodeJS.ProcessEnv {
  const env = ghContainedEnv(home, { ...process.env, HOME: home });
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
    '  bootout|enable|disable|kickstart) exit 0 ;;',
    '  print)',
    '    lbl="${2##*/}"',
    '    if [ -f "$HOME/launchctl-loaded" ] && grep -q "^$lbl.plist$" "$HOME/launchctl-loaded"; then',
    '      echo "	state = running"',
    // The sweep's stay-up gate samples `pid = ` twice per kicked job; a
    // stable default is a job that stayed up, `fixture-pid-churn` a crash
    // loop. Same knob as ccrc-install.test.ts's stub.
    // Split per job kind (design §11's gate): `fixture-pid-churn` churns the
    // SESSION jobs (the sweep's subject), `fixture-main-pid-churn` the
    // ccrc/ccrc-agent jobs (the gate's), so each case measures one of them.
    '      churn=""',
    '      case "$lbl" in app.ccrc.session.*) [ -f "$HOME/fixture-pid-churn" ] && churn=1 ;; *) [ -f "$HOME/fixture-main-pid-churn" ] && churn=1 ;; esac',
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
  // arm is `systemd-run --user --collect --quiet "$@"`. RECORDED, never real:
  // `ghContainedEnv` above is called WITHOUT `{ systemd: true }`, so before
  // this line a detached run would have reached this box's own user manager.
  // Knobs are FILES, this harness's rule: `fixture-systemd-run-exit` is the
  // job-creation answer, and `fixture-systemd-run-linger` makes the recorder
  // leave a `sleep` behind — stdio closed so `spawnSync` does not wait on it,
  // every OTHER descriptor inherited — which is how the "no lock fd at the
  // spawn" pin observes a descriptor the parent must not have held.
  // `fixture-systemd-run-exec` RUNS the handed argv, minus the three manager
  // flags, in a session of its own (`setsid`, stdio to `detached.log`). That
  // is what the transient unit gives the real run: a kill aimed at the
  // parent's process group cannot reach it (§16's parent-kill fixture). It
  // runs in the CALLER's environment, which the real unit does not, so it
  // measures the process chain and not the environment contract.
  plant('systemd-run', [
    '#!/bin/sh',
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
    'code=0; [ -f "$HOME/fixture-systemd-run-exit" ] && IFS= read -r code < "$HOME/fixture-systemd-run-exit"',
    'exit "$code"',
  ].join('\n') + '\n');

  plant('systemctl', [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/systemctl-calls"',
    '[ "$1" = "--user" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    'shift',
    'case "$1" in',
    '  daemon-reload) exit 0 ;;',
    '  enable) [ "$2" = "--now" ] && [ -n "$3" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }; exit 0 ;;',
    '  restart) [ -n "$2" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }; exit 0 ;;',
    '  try-restart) [ -n "$2" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    // Task 2 (§18 "the lock closes before the sweep": "a lingering stub
    // pins the lock"): a restart that leaves a process behind, holding
    // whatever descriptor it was handed.
    '    if [ -f "$HOME/fixture-sweep-linger" ]; then sleep 30 >/dev/null 2>&1 </dev/null & echo $! > "$HOME/sweep-linger-pid"; fi',
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
    '      "") [ -f "$HOME/fixture-sweep-units" ] && cat "$HOME/fixture-sweep-units" ;;',
    '      failed) [ -f "$HOME/fixture-sweep-failed" ] && cat "$HOME/fixture-sweep-failed" ;;',
    '      active) [ -f "$HOME/fixture-sweep-active" ] && cat "$HOME/fixture-sweep-active" ;;',
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
  plant('npm',
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/npm-argv"\n'
    + 'printf \'%s\\n\' "$PWD" >> "$HOME/npm-cwd"\nmkdir -p node_modules\nexit 0\n');
  plant('rsync',
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/rsync-argv"\nexec ${RSYNC} "$@"\n`);
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
  // but `server`. Same fix, same reasoning as `ccrc-install.test.ts`'s own
  // `python3` stub (see its comment): answer only `-m venv <path>` by
  // building a fake venv locally, refuse anything else loudly.
  plant('python3', [
    '#!/bin/sh',
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
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_DOCTOR_GH_TIMEOUT',
    'CCRC_RELEASE_BASE_URL', 'CCRC_BACKUP_KEEP', 'CCRC_VERSIONS_KEEP']) delete env[k];
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
  // fix as `ccrc-install.test.ts`'s own `ccrcEnv`.
  const gfxPkg = join(home, 'fixture-graphify-pkg');
  mkdirSync(join(gfxPkg, 'skills', 'claude', 'references'), { recursive: true });
  writeFileSync(join(gfxPkg, 'skill.md'), '# fixture graphify skill\n');
  writeFileSync(join(gfxPkg, 'skills', 'claude', 'references', 'fixture-ref.md'), 'fixture ref\n');
  env['CCRC_GRAPHIFY_PKG'] = gfxPkg;
  return env;
}

function replantDoctorStubs(home: string): void {
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
function plantOldBox(home: string, opts: { version?: string } = {}): void {
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
function plantCoordDb(home: string): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  const db = new DatabaseSync(join(home, '.ccrc', 'coord.db'));
  db.exec('CREATE TABLE fixture (x INTEGER); INSERT INTO fixture VALUES (42);');
  db.close();
}

/** The two files an update clears before its staged spine (`~/.ccrc/installed`,
 *  the completed-install record; `~/.ccrc/ccrc-caps`), planted as a box that
 *  finished an install of `plantOldBox`'s build has them — the record's line 1
 *  is that build's sha, line 2 the provenance word. Returns both bodies. */
function plantCompletedRecord(home: string): { installed: string; caps: string } {
  const installed = 'oldsha0000000000000000000000000000000000\nunsigned\n';
  const caps = 'os linux\nupdate-gate\nrollback-flip\n';
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'installed'), installed);
  writeFileSync(join(home, '.ccrc', 'ccrc-caps'), caps);
  return { installed, caps };
}

// ── The release fixture (install-sh.test.ts's local:// URL space) ─────────

const sha256 = (p: string): string =>
  createHash('sha256').update(readFileSync(p)).digest('hex');

/** The MANIFEST exactly as `build-release.sh` generates it: every file,
 *  per-file sha256, sorted under LC_ALL=C, generated OUTSIDE the tree and
 *  moved in. */
function writeManifest(tree: string): void {
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
function shippedStamp(version: string, sha: string): string {
  return `{"sha":"${sha}","ref":"release","builtAt":"2026-08-21T00:00:00Z","dirty":false,"version":"${version}"}\n`;
}

/** The FULL flavour: the repo's own `ccd/`, `shared/`, `deploy/` (minus the
 *  live mail token — the exclusion `git archive` provides for real releases),
 *  `install.sh`, the two package.jsons the doctor reads, dist stubs, and the
 *  shipped stamp. The staged `ccrc install` inside is the real verb. */
function fullTree(home: string, opts: { version: string; sha: string }): string {
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
 *  spine `ccrc-install.test.ts` already owns. */
function stubTree(home: string, opts: { version: string; installExit?: number }): string {
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
    // of it; the writing is ccrc-install.test.ts's.
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
function selfConvergedTree(home: string, version: string, sha: string): string {
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
function packRelease(home: string, tree: string,
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
function runUpdate(home: string, args: string[] = [],
  extraEnv: NodeJS.ProcessEnv = {}): Result {
  mkdirSync(join(home, 'tmp'), { recursive: true });
  const env = {
    ...updateEnv(home),
    TMPDIR: join(home, 'tmp'),
    CCRC_RELEASE_BASE_URL: `local://${home}/releases`,
    ...extraEnv,
  };
  replantDoctorStubs(home);
  const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'update', ...args],
    { env, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function freshUpdateBox(prefix: string): string {
  const home = mkTmp(prefix);
  healthyBox(home);
  return home;
}

/** The MANDATORY KillMode=process drop-in (R1). Hoisted to file scope
 *  because two describes need it: the sweep's own cases, and the gate's
 *  `converged()` — a "NO sweep" assertion on a box with no drop-in is
 *  VACUOUS, since the preflight would refuse the sweep with the gate
 *  deleted too. */
function plantKillModeDropIn(home: string): void {
  const d = join(home, '.config', 'systemd', 'user', 'claude-session@.service.d');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '50-killmode.conf'), '[Service]\nKillMode=process\n');
}

/** What the recording `systemctl --user list-units claude-session@*` stub
 *  answers with — two live supervisors, so a sweep that RAN has something
 *  to restart and leaves a `try-restart` in the recording. */
const UNIT_LINES =
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
function homeSnapshot(home: string): string[] {
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
function treeDigest(dir: string): Record<string, string> {
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

const localUrls = (home: string): string[] => (existsSync(join(home, 'curl-argv'))
  ? readFileSync(join(home, 'curl-argv'), 'utf8').split('\n')
    .filter((l) => l.startsWith('local://'))
  : []);

/** Fix round 1 item 12: every FULL curl invocation this run made, one line
 *  per call (the stub's own `$*`), for pinning FLAGS rather than only the
 *  URL — `curl-argv` (above) cannot see them. */
const curlFullArgv = (home: string): string[] => (existsSync(join(home, 'curl-full-argv'))
  ? readFileSync(join(home, 'curl-full-argv'), 'utf8').split('\n').filter((l) => l !== '')
  : []);

/** `update --check`'s machine line, found by its prefix rather than assumed
 *  to be line 1 — the same rule rollout's parser applies (`grep -m1
 *  '^check: '`), so a sentence printed before it can never shift what a
 *  test reads. */
const checkLine = (s: string): string => s.split('\n').find((l) => l.startsWith('check: ')) ?? '';

/** The words THIS ccrc can do (`_ccrc_cap_words`), as `--check` joins them:
 *  W1's three, W4's four and W6's `versions`, `detach` on Linux only
 *  (decision 17). A literal, not a read of ccd/ccrc — a pin derived from the
 *  list it pins cannot red. */
const CAPS_NOW = process.platform === 'darwin'
  ? 'verify,node-id,floor,update-json,update-gate,rollback,versions'
  : 'verify,node-id,floor,update-json,update-gate,rollback,versions,detach';
/** The machine line as key → value. Values never contain a space or `=`
 *  (caps= joins its words with commas), so one split per field is exact. */
const parseCheck = (s: string): Record<string, string> =>
  Object.fromEntries(checkLine(s).replace(/^check: /, '').split(' ').map((kv) => kv.split('=') as [string, string]));

/** The backup directory THIS run announced — parsed from the transcript, not
 *  guessed from `ls`: the hooks installer inside a full run writes its own
 *  timestamped siblings into `~/ccrc-backups/`. Fix round 1 item 11 / review
 *  155 C17: the announcement itself now redacts the fixture's absolute HOME
 *  to a literal `~` (`_upd_redact`, same as every die sentence), so this
 *  expands it back to `home` — the caller's real fs calls need a real path,
 *  never the literal tilde a shell alone would expand. */
function announcedBackupDir(stdout: string, home: string): string {
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
function sourcedCcrc(home: string, script: string): Result {
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
const OLD_SHA = 'oldsha0000000000000000000000000000000000';
/** Records its argv, the lock marker it was handed, its own $PPID and
 *  whether ~/.ccrc/update.lock was HELD while it ran — a fresh `flock -n`
 *  that FAILS is the measurement (spec §10's own), and it can only fail
 *  because the parent holds its descriptor. Exits `fixture-restore-exit`.
 *  D-3275: when that exit is 3 — a real child's spine completed and only its
 *  trailing doctor FAILed (D-3114) — it writes the completed-install record
 *  ITS OWN spine would have, so a test can measure that arm 2's rc-3 arm
 *  leaves it alone (only arm 3 would have deleted it). */
const RESTORE_RECORDER = [
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
const RESTORE_BROKEN = '#!/bin/sh\necho "fixture: the new tree\'s ccd/ccrc is broken" >&2\nexit 1\n';

interface RestoreBoxOpts {
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
function plantRestoreBox(home: string, opts: RestoreBoxOpts = {}): void {
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
const restoreChildArgv = (home: string): string[] | null => (existsSync(join(home, 'restore-child-argv'))
  ? readFileSync(join(home, 'restore-child-argv'), 'utf8').split('\n').filter((l) => l !== '') : null);

describe('ccrc update: the argument surface', () => {
  it('update -h prints usage on STDOUT at exit 0 — a verb with flags explains them', () => {
    const home = freshUpdateBox('ccrc-update-help-');
    const r = runUpdate(home, ['-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/usage: ccrc \{/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  it('an unknown argument is a usage error, exit 2, before anything is fetched', () => {
    const home = freshUpdateBox('ccrc-update-badarg-');
    const r = runUpdate(home, ['--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --bogus/m);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
  });

  it('--to refuses a value that is not vX.Y.Z-shaped, exit 2', () => {
    const home = freshUpdateBox('ccrc-update-badto-');
    const r = runUpdate(home, ['--to', 'latest']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--to expects a release tag shaped vX\.Y\.Z/);
    expect(existsSync(join(home, 'curl-argv'))).toBe(false);
  });
});

// D-3140: `jq` joins the preflight's own tool list (`for t in curl tar gzip
// node awk jq`) so a jq-less box is refused BY NAME, up front — never as
// `_box_build_fields`'s own internal jq probe surfacing partway through a run
// as a stamp that "does not parse".
function pathWithoutJq(home: string): string {
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
  // (`ccrc-install.test.ts`'s `pathWithout` idiom: fixture plants win, real
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
  for (const b of ['tar', 'gzip', 'awk', 'flock', 'mkdir', 'stat']) symlinkSync(realPath(b), join(d, b));
  return `${join(home, '.local', 'bin')}:${d}`;
}

/** F5 (fix round 1, Task 9): the watchdog's own `flock` preflight, the twin
 *  of `pathWithoutJq` above — everything the watchdog calls before its
 *  `command -v flock` check (jq, `stat` — fix round 1 item 9's
 *  `_upd_report_readable` — and `date` for its `now="$(date +%s)"`) stays
 *  real, only `flock` itself is missing. */
function pathWithoutFlock(home: string): string {
  const d = join(home, 'no-flock-bin');
  mkdirSync(d, { recursive: true });
  // `mv`/`chmod` join (review fix round 1 M5): `cmd_rollback`'s own
  // reporting window (fix round 1 item 3, restructured by review fix round
  // 1 I1) now OPENS before `_upd_lock` runs for a non-`cli` rollback, so a
  // flock-missing die there — unlike `ccrc update --detach`'s own, which
  // dies before any window opens — DOES write a `failed` report, and
  // `_upd_phase`'s own write needs both to place it.
  for (const b of ['jq', 'tar', 'gzip', 'awk', 'mkdir', 'date', 'stat', 'mv', 'chmod'])
    symlinkSync(realPath(b), join(d, b));
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
function pathWithoutCurl(home: string): string {
  const d = join(home, 'no-curl-bin');
  mkdirSync(d, { recursive: true });
  for (const b of ['flock', 'jq', 'tar', 'gzip', 'awk', 'mkdir', 'date', 'stat', 'bash', 'sh', 'mv', 'chmod'])
    symlinkSync(realPath(b), join(d, b));
  return d;
}

describe('ccrc update: preflight (D-3140 — jq joins the tool list)', () => {
  it('a jq-less box is refused by name, before anything is fetched', () => {
    const home = freshUpdateBox('ccrc-update-nojq-');
    const r = runUpdate(home, [], { PATH: pathWithoutJq(home) });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: jq is required by 'ccrc update' but is not on PATH — nothing on this box was changed/m);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
  });
});

describe('ccrc update: fetch + verify, then back up, then install, then report', () => {
  it('happy path: replaces ~/ccrc from the verified tree and reports both build.json versions', () => {
    const home = freshUpdateBox('ccrc-update-happy-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // The health gate ran on the REAL spine's result (design §11): the
    // staged `_inst_env` wrote ccrc.env's address, `_inst_stamp` the version.
    expect(r.stdout).toMatch(/^update: gate: both answers on v2\.0\.0 \(ccrc\.service up, \/health at 127\.0\.0\.1:7788 answers v2\.0\.0\)$/m);
    // A verified bundle (packRelease's default) makes this a ONE-line marker
    // — provenance verified, no `unsigned` line 2 (D-3117, Task 12).
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8'))
      .toBe('newsha0000000000000000000000000000000000\n');
    expect(existsSync(join(home, '.ccrc', 'install-step')), 'a completed spine left its step marker').toBe(false);
    // The old tree is GONE and the staged one is in its place: the marker the
    // previous install left does not survive the rsync --delete, and the
    // shipped executables do arrive.
    expect(existsSync(join(home, 'ccrc', 'server', 'OLD-MARKER')),
      'the old tree survived under the new one').toBe(false);
    expect(existsSync(join(home, 'ccrc', 'ccd', 'ccrc-doctor-checks'))).toBe(true);
    // The box's stamp is now the SHIPPED one — the release artifact's own
    // identity, installed because an extracted tarball is not a repository
    // git could measure (build-release.sh writes it; _inst_stamp installs it).
    const stamp = JSON.parse(readFileSync(join(home, '.ccrc', 'build.json'), 'utf8')) as Record<string, unknown>;
    expect(stamp['version']).toBe('v2.0.0');
    expect(stamp['sha']).toBe('newsha0000000000000000000000000000000000');
    // The report names both versions, from → to.
    expect(r.stdout).toMatch(/^update: build: v1\.0\.0 \(oldsha[0-9a-f]*\) -> v2\.0\.0 \(newsha[0-9a-f]*\)$/m);
    // The backup was taken (its completeness is the ordering test's subject).
    const backup = announcedBackupDir(r.stdout, home);
    expect(existsSync(join(backup, 'coord.db'))).toBe(true);
  });

  // Fix round 1 item 12 / review 155 C22, AMENDED by fix round 2 F4 (review
  // 167): every release-host curl call this run makes, pinned by FLAG SET
  // through the stub's full-argv recorder (`curlFullArgv`, never the
  // url-only `curl-argv`). The tarball keeps its round-1 shape (connect
  // timeout AND a stall bound — `--speed-limit`/`--speed-time` — NEVER a
  // total `--max-time`: a slow but LIVE download must be let finish); the
  // bundle — a SMALL probe — keeps its connect timeout AND total bound.
  // SHA256SUMS, round 1's OTHER small-file fetch, no longer matches the
  // tarball's class: it is SMALL BY DESIGN (`_upd_resolve`'s own derivation
  // comment), so it now ALSO carries a total `--max-time` and a
  // `--max-filesize`, on top of the connect+stall pair it always had.
  it('SHA256SUMS gets connect+stall+total+filesize bounds; the tarball keeps connect+stall only; the bundle keeps connect+total (fix round 1 item 12 / review 155 C22; fix round 2 F4, review 167)', () => {
    const home = freshUpdateBox('ccrc-update-timeouts-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const argvUrl = (line: string): string => line.trim().split(/\s+/).pop() ?? '';
    const argv = curlFullArgv(home);
    const sums = argv.find((l) => argvUrl(l).endsWith('/SHA256SUMS'));
    const tarball = argv.find((l) => argvUrl(l).endsWith('.tar.gz'));
    const bundle = argv.find((l) => argvUrl(l).endsWith('.sigstore.json'));
    expect(sums, argv.join('\n')).toBeDefined();
    expect(tarball, argv.join('\n')).toBeDefined();
    expect(bundle, argv.join('\n')).toBeDefined();
    expect(sums!).toMatch(/--connect-timeout \d+/);
    expect(sums!).toMatch(/--speed-limit \d+/);
    expect(sums!).toMatch(/--speed-time \d+/);
    expect(sums!).toMatch(/--max-time \d+/);
    expect(sums!).toMatch(/--max-filesize \d+/);
    expect(tarball!).toMatch(/--connect-timeout \d+/);
    expect(tarball!).toMatch(/--speed-limit \d+/);
    expect(tarball!).toMatch(/--speed-time \d+/);
    expect(tarball!).not.toMatch(/--max-time/);
    expect(tarball!).not.toMatch(/--max-filesize/);
    expect(bundle!).toMatch(/--connect-timeout \d+/);
    expect(bundle!).toMatch(/--max-time \d+/);
    expect(bundle!).not.toMatch(/--speed-limit|--speed-time/);
    expect(bundle!).not.toMatch(/--max-filesize/);
  });

  // Fix round 2, F4 (review 167), CORRECTED by W6 Task 8A (review 173's F4b):
  // a release host that ACCEPTS the TCP connection and then TRICKLES bytes
  // forever. The first version of this pin trickled at 10 B/s — BELOW the
  // 1024 B/s stall floor — so the stall bound (or the test's own kill) could
  // end it and F4's real input, a host that never stops but never stalls, was
  // never exercised. This one sends 256 bytes every 100 ms (2560 B/s, above the
  // floor, so no stall can end it), with the size bound lifted to the
  // validator's ceiling (2 s of 2560 B/s is ~5 KB, well under it) and the stall
  // window shortened to 1 s (so a trickle below the floor WOULD have ended
  // early): only SHA256SUMS's total `--max-time` is left to end the transfer,
  // and the assertions below measure that it did, at its own bound and not
  // before. A real `net.createServer`, NEVER a stubbed curl (modelled on the
  // never-answering-socket pin for `_upd_asset_listed`, fix round 1 item 12 /
  // review 155 C32, below) — `updateEnv` alone, like that pin, NEVER
  // `runUpdate`/`freshUpdateBox`'s own `replantDoctorStubs`, which would shadow
  // the real curl with the LOCAL-URL-only fixture shim (it never writes `-o`'s
  // destination file for a bare `http://` URL, so a run through it "fails" for
  // a fixture reason having nothing to do with the bound this pins).
  // THE HOST IS A SEPARATE PROCESS, and that is not incidental: these pins run
  // the real `ccrc` through `spawnSync`, which BLOCKS this process's event
  // loop for as long as the child lives — an in-process `net.createServer`
  // would accept the connection in the kernel and never get to write a byte.
  // That is what the first version of the F4 trickle pin actually was: an
  // accept-and-never-answer host, whatever its handler said (measured under
  // W6 Task 8A: the handler never ran, and curl ended on its stall bound).
  // The host child answers HTTP/1.0 with NO Content-Length and writes
  // `bytes` every `everyMs` until it is told to stop, then prints how much it
  // sent, so a test can assert the rate the host really held.
  const HOST_JS = [
    "const { createServer } = require('node:net');",
    "const [bytes, everyMs] = [Number(process.argv[1]), Number(process.argv[2])];",
    "let sent = 0; const chunk = 'a'.repeat(bytes);",
    "const s = createServer((sock) => {",
    "  sock.write('HTTP/1.0 200 OK\\r\\nContent-Type: text/plain\\r\\n\\r\\n');",
    "  const iv = setInterval(() => { try { sock.write(chunk); sent += bytes; } catch (e) {} }, everyMs);",
    "  sock.on('close', () => clearInterval(iv)); sock.on('error', () => clearInterval(iv));",
    "});",
    "s.listen(0, '127.0.0.1', () => process.stdout.write(String(s.address().port) + '\\n'));",
    "process.on('SIGTERM', () => { process.stdout.write('sent ' + sent + '\\n'); process.exit(0); });",
  ].join('\n');
  const startHost = async (bytes: number, everyMs: number): Promise<{ port: number; stop: () => Promise<number> }> => {
    const child = spawn(process.execPath, ['-e', HOST_JS, String(bytes), String(everyMs)], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout!.on('data', (d: Buffer) => { out += d.toString(); });
    const port = await new Promise<number>((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const m = /^(\d+)\n/.exec(out);
        if (m) { clearInterval(iv); resolve(Number(m[1])); }
        else if (Date.now() - t0 > 10_000) { clearInterval(iv); reject(new Error('the fixture host never listened')); }
      }, 20);
    });
    const stop = async (): Promise<number> => {
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.kill('SIGTERM'); });
      }
      const m = /sent (\d+)/.exec(out);
      return m ? Number(m[1]) : 0;
    };
    return { port, stop };
  };

  itLinux('SHA256SUMS from a release host that trickles above the stall floor forever is ended by its total bound alone, named in the sentence (F4, review 167; F4b, review 173)', async () => {
    // 256 bytes every 100 ms = 2560 B/s: above the 1024 B/s floor, so no
    // stall can end it; the size bound is lifted to the validator's ceiling
    // (2 s of 2560 B/s is ~5 KB, far under it); the stall WINDOW is shortened
    // to 1 s so a trickle below the floor would have ended early. Only the
    // total `--max-time` is left, and the assertions measure that it fired,
    // at its own bound and not before.
    const host = await startHost(256, 100);
    let sent = 0;
    try {
      const home = mkTmp('ccrc-update-sums-trickle-');
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      const env = {
        ...updateEnv(home),
        CCRC_RELEASE_BASE_URL: `http://127.0.0.1:${host.port}/rel`,
        CCRC_RELEASE_SUMS_MAX_TIME: '2',
        CCRC_RELEASE_SUMS_MAX_FILESIZE: '1048576',
        CCRC_RELEASE_SPEED_TIME: '1',
        CCRC_RELEASE_CONNECT_TIMEOUT: '2',
      };
      const t0 = Date.now();
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'update'],
        { env, encoding: 'utf8', timeout: 20_000 });
      const elapsedMs = Date.now() - t0;
      sent = await host.stop();
      expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      // Ended by the OVERRIDDEN total bound (2 s): not before it (a stall or a
      // size bound would have ended it sooner), and not left trickling to
      // curl's own defaults or to this test's own kill.
      expect(elapsedMs, `took ${elapsedMs}ms; stderr: ${r.stderr}`).toBeGreaterThanOrEqual(1800);
      expect(elapsedMs, `took ${elapsedMs}ms`).toBeLessThan(10_000);
      // The host really was above the floor the whole time.
      expect(sent / (elapsedMs / 1000), `sent ${sent} bytes in ${elapsedMs}ms`).toBeGreaterThan(1500);
      expect(r.stderr).toMatch(/curl: \(28\) Operation timed out after 2\d{3} milliseconds/);
      expect(r.stderr).toMatch(/download failed: .*\/SHA256SUMS \(is there a release, or did the connection stall.*or did it time out after 2s \/ exceed 1048576 bytes\)/);
    } finally {
      await host.stop();
    }
  }, 30_000);

  // W6 Task 8A (review 173's F4b): the SIZE bound, measured. Until now it had
  // only the argv regex in the flag-set pin above, so a default raised to
  // 1048576 would have stayed green. A host that answers a close-delimited
  // body (HTTP/1.0, NO Content-Length — the case curl cannot judge from the
  // headers) and keeps sending fast is ended by `--max-filesize` alone, well
  // inside the total bound, which is set high here so it cannot be what fires:
  // the fetch must refuse in a couple of seconds, naming the SHIPPED size bound.
  // FLOOR: curl 8.4.0. Below it curl ignores `--max-filesize` for a body of
  // unknown length (its manual says so), and only the time bound holds — so
  // this case is skipped there, not weakened.
  const curlV = /curl (\d+)\.(\d+)\.(\d+)/.exec(spawnSync('curl', ['--version'], { encoding: 'utf8' }).stdout ?? '');
  const curlHasUnknownLengthMaxFilesize = curlV !== null
    && (Number(curlV[1]) > 8 || (Number(curlV[1]) === 8 && Number(curlV[2]) >= 4));
  it.skipIf(process.platform === 'darwin' || !curlHasUnknownLengthMaxFilesize)('SHA256SUMS whose body has no Content-Length and never stops is refused at --max-filesize, the shipped 4096 bytes named in the sentence (F4b, review 173)', async () => {
    // 1 KiB every 10 ms = ~100 KB/s: the shipped 4096 bytes arrive in well
    // under a second, while a bound raised to a megabyte would run for ~10 s.
    const host = await startHost(1024, 10);
    try {
      const home = mkTmp('ccrc-update-sums-oversize-');
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      const env: NodeJS.ProcessEnv = {
        ...updateEnv(home),
        CCRC_RELEASE_BASE_URL: `http://127.0.0.1:${host.port}/rel`,
        CCRC_RELEASE_SUMS_MAX_TIME: '30',
        CCRC_RELEASE_CONNECT_TIMEOUT: '2',
      };
      delete env['CCRC_RELEASE_SUMS_MAX_FILESIZE'];
      const t0 = Date.now();
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'update'],
        { env, encoding: 'utf8', timeout: 25_000 });
      const elapsedMs = Date.now() - t0;
      expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      // Ended by the size bound: curl 63, quickly — and the 30 s total bound
      // (set high on purpose) is nowhere near.
      expect(r.stderr).toMatch(/curl: \(63\)/);
      expect(elapsedMs, `took ${elapsedMs}ms`).toBeLessThan(5_000);
      expect(r.stderr).toMatch(/download failed: .*\/SHA256SUMS \(.*or did it time out after 30s \/ exceed 4096 bytes\)/);
    } finally {
      await host.stop();
    }
  }, 40_000);

  it('happy path on a VERSIONED box (W6 Task 2): v2.0.0 is placed in ~/ccrc-versions/v2.0.0, ~/ccrc flips to it, and v1.0.0\'s directory is byte-unchanged', () => {
    // The staged spine is the real one (FULL flavour), so this is the
    // install path `ccrc update` really takes on a box that is already on the
    // W6 layout: the staged tree names itself from its shipped build.json
    // (`_inst_version_name` rule 3), is placed beside the running version,
    // and the link is renamed only after its deps are in place.
    const home = freshUpdateBox('ccrc-update-versioned-');
    plantOldBox(home, { version: 'v1.0.0' });
    rmSync(join(home, 'ccrc'), { recursive: true, force: true });
    installVersionedTree(home, 'v1.0.0', { stamp: { sha: '1'.repeat(40), version: 'v1.0.0' } });
    plantCoordDb(home);
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    const before = treeDigest(join(home, 'ccrc-versions', 'v1.0.0'));
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
    expect(treeDigest(join(home, 'ccrc-versions', 'v1.0.0')),
      'the update wrote into the version it was replacing').toEqual(before);
    expect(r.stdout).toMatch(/^install: tree: placed v2\.0\.0 at \$HOME\/ccrc-versions\/v2\.0\.0$/m);
    expect(r.stdout).toMatch(/^install: tree: \$HOME\/ccrc -> \$HOME\/ccrc-versions\/v2\.0\.0 \(was \$HOME\/ccrc-versions\/v1\.0\.0\) — one rename$/m);
    expect(readFileSync(join(home, 'npm-cwd'), 'utf8').trim().split('\n')[0])
      .toBe(join(home, 'ccrc-versions', 'v2.0.0', 'server'));
    // The new version keeps the stamp and record this update left on the box.
    expect(readFileSync(join(home, 'ccrc-versions', 'v2.0.0', '.ccrc-installed'), 'utf8'))
      .toBe(readFileSync(join(home, '.ccrc', 'installed'), 'utf8'));
    expect(readFileSync(join(home, 'ccrc-versions', 'v2.0.0', '.ccrc-stamp.json'), 'utf8'))
      .toBe(readFileSync(join(home, '.ccrc', 'build.json'), 'utf8'));
  });

  it('a VERSIONED box whose staged npm ci fails replaced nothing: exit 1 BEFORE the gate, no restore, and v1.0.0 — the running version — byte-unchanged (D-3457)', () => {
    // The commonest failure — the registry is down — kills the W6 spine
    // inside `_inst_tree` (marker `_inst_tree`), after the rsync into
    // ~/ccrc-versions/v2.0.0 and BEFORE the flip. Wave 4 alone reads that
    // marker as "the tree WAS replaced", gates a unit still on v1.0.0, fails,
    // and its arm-2 child re-installs v1.0.0 IN PLACE: rsync --delete and
    // npm ci inside the running version.
    const home = freshUpdateBox('ccrc-update-versioned-npmfail-');
    plantOldBox(home, { version: 'v1.0.0' });
    rmSync(join(home, 'ccrc'), { recursive: true, force: true });
    installVersionedTree(home, 'v1.0.0', { stamp: { sha: '1'.repeat(40), version: 'v1.0.0' } });
    plantCoordDb(home);
    const planted = plantCompletedRecord(home);
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    const before = treeDigest(join(home, 'ccrc-versions', 'v1.0.0'));
    // Ahead of the recorder npm that `runUpdate` re-plants on every call
    // (the `a spine that DIED …` case's idiom).
    mkdirSync(join(home, 'fail-bin'), { recursive: true });
    writeFileSync(join(home, 'fail-bin', 'npm'),
      '#!/bin/sh\necho "npm ERR! code ENOTFOUND registry.npmjs.org" >&2\nexit 1\n', { mode: 0o755 });
    const r = runUpdate(home, [], { PATH: `${join(home, 'fail-bin')}:${updateEnv(home)['PATH'] ?? ''}` });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: the staged install \(which ends with doctor\) exited 1 — spine died at _inst_tree, before its flip: nothing was replaced \(\$HOME\/ccrc still points at \$HOME\/ccrc-versions\/v1\.0\.0\); put back as they were: completed-install record, caps; read its lines above\. The backup taken BEFORE it ran is complete at \S+\/ccrc-backups\/\S+$/m);
    expect(readFileSync(join(home, '.ccrc', 'install-step'), 'utf8')).toBe('_inst_tree\n');
    expect(r.stdout, 'a death that replaced nothing was gated').not.toMatch(/^update: gate/m);
    expect(r.stdout, 'a death that replaced nothing was restored').not.toMatch(/^update: (arm|REVERTED)/m);
    const phases = reportWrites(home).map((w) => w['phase']);
    expect(phases, 'the report went through the gate').not.toContain('checking');
    expect(phases, 'the report went through a restore').not.toContain('restoring');
    expect(lastReport(home)).toMatchObject({ phase: 'failed', detail: 'spine died at _inst_tree', target: 'v2.0.0' });
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
    expect(treeDigest(join(home, 'ccrc-versions', 'v1.0.0')),
      'the running version was written into').toEqual(before);
    // D-3462: the run cleared the record and the caps before its spine, and a
    // death that replaced nothing puts both back as they were.
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8'), 'the completed-install record was left removed')
      .toBe(planted.installed);
    expect(readFileSync(join(home, '.ccrc', 'ccrc-caps'), 'utf8'), 'the caps were left removed').toBe(planted.caps);
  });

  it('an update to a version name that is a SYMLINK is refused by the spine before any write: exit 1 as nothing replaced, the link target and the running version byte-unchanged (D-3464)', () => {
    const home = freshUpdateBox('ccrc-update-linked-name-');
    plantOldBox(home, { version: 'v1.0.0' });
    rmSync(join(home, 'ccrc'), { recursive: true, force: true });
    installVersionedTree(home, 'v1.0.0', { stamp: { sha: '1'.repeat(40), version: 'v1.0.0' } });
    plantCoordDb(home);
    const elsewhere = join(home, 'elsewhere-4');
    mkdirSync(join(elsewhere, 'server'), { recursive: true });
    writeFileSync(join(elsewhere, 'server', 'MINE'), 'not ccrc\n');
    writeFileSync(join(elsewhere, '.ccrc-installed'), 'b'.repeat(40) + '\n');
    symlinkSync(elsewhere, join(home, 'ccrc-versions', 'v2.0.0'));
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    const target = treeDigest(elsewhere);
    const running = treeDigest(join(home, 'ccrc-versions', 'v1.0.0'));
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain('$HOME/ccrc-versions/v2.0.0 is not a directory ccrc placed — nothing was written');
    expect(r.stderr).toContain('spine died at _inst_tree, before its flip: nothing was replaced');
    expect(treeDigest(elsewhere), 'the link target was written through').toEqual(target);
    expect(treeDigest(join(home, 'ccrc-versions', 'v1.0.0'))).toEqual(running);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
  });

  it('a REAL-DIRECTORY (pre-W6) box whose staged npm ci fails replaced nothing either: exit 1 BEFORE the gate, no restore, and the directory byte-unchanged (D-3458)', () => {
    // The controller's ruling on the pre-flight scan: Task 2 left
    // `_upd_tree_untouched`'s `directory` row "Task 3's to revisit" and
    // Task 3 never did. Since W6, a `directory` layout is placed exactly
    // like `absent` — the new version is placed FULLY at
    // ~/ccrc-versions/<name> before `_inst_migrate` ever moves the real
    // directory — so an `npm ci` failure here dies before a single byte of
    // ~/ccrc has moved, exactly like the VERSIONED case above.
    const home = freshUpdateBox('ccrc-update-directory-npmfail-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    const planted = plantCompletedRecord(home);
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    const before = treeDigest(join(home, 'ccrc'));
    mkdirSync(join(home, 'fail-bin'), { recursive: true });
    writeFileSync(join(home, 'fail-bin', 'npm'),
      '#!/bin/sh\necho "npm ERR! code ENOTFOUND registry.npmjs.org" >&2\nexit 1\n', { mode: 0o755 });
    const r = runUpdate(home, [], { PATH: `${join(home, 'fail-bin')}:${updateEnv(home)['PATH'] ?? ''}` });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain('spine died at _inst_tree, before its flip: nothing was replaced '
      + '($HOME/ccrc is still the pre-versioned directory; the migration did not leave it moved); '
      + 'put back as they were: completed-install record, caps; read its lines above.');
    // D-3462: the record and the caps the run cleared before its spine are back, byte for byte.
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe(planted.installed);
    expect(readFileSync(join(home, '.ccrc', 'ccrc-caps'), 'utf8')).toBe(planted.caps);
    expect(readFileSync(join(home, '.ccrc', 'install-step'), 'utf8')).toBe('_inst_tree\n');
    expect(r.stdout, 'a death that replaced nothing was gated').not.toMatch(/^update: gate/m);
    expect(r.stdout, 'a death that replaced nothing was restored').not.toMatch(/^update: (arm|REVERTED)/m);
    const phases = reportWrites(home).map((w) => w['phase']);
    expect(phases, 'the report went through the gate').not.toContain('checking');
    expect(phases, 'the report went through a restore').not.toContain('restoring');
    expect(lastReport(home)).toMatchObject({ phase: 'failed', detail: 'spine died at _inst_tree', target: 'v2.0.0' });
    const st = lstatSync(join(home, 'ccrc'));
    expect(!st.isSymbolicLink() && st.isDirectory(), '~/ccrc was migrated away').toBe(true);
    expect(treeDigest(join(home, 'ccrc')), 'the real directory was written into').toEqual(before);
    expect(existsSync(join(home, 'ccrc.migrating')), 'a migration was started').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'migrating-to'))).toBe(false);
  });

  it('_upd_tree_untouched (VERSIONED layouts): nothing replaced only for a W6 spine, a new name, and a layout that still reads what it read before', () => {
    const home = freshUpdateBox('ccrc-update-untouched-');
    installVersionedTree(home, 'v1.0.0');
    // Two staged trees: one whose ccrc declares the versions root (a W6
    // spine) and one whose ccrc does not (a spine older than W6).
    mkdirSync(join(home, 'stage-w6', 'ccd'), { recursive: true });
    writeFileSync(join(home, 'stage-w6', 'ccd', 'ccrc'), 'BOX_VERSIONS_ROOT="$HOME/ccrc-versions"\n');
    mkdirSync(join(home, 'stage-old', 'ccd'), { recursive: true });
    writeFileSync(join(home, 'stage-old', 'ccd', 'ccrc'), 'BOX_TREE_DIR="$HOME/ccrc"\n');
    const ask = (h: string, tree: string, version: string, pl: string, pc: string): string =>
      sourcedCcrc(h, `UPD_TREE='${join(home, tree)}'; UPD_VERSION='${version}'; `
        + `_upd_tree_untouched '${pl}' '${pc}'; echo "rc=$?"`).stdout.trim();
    // A W6 spine, a new name, the link where it was: nothing replaced.
    expect(ask(home, 'stage-w6', 'v2.0.0', 'linked', 'v1.0.0'))
      .toBe('$HOME/ccrc still points at $HOME/ccrc-versions/v1.0.0\nrc=0');
    // The same name: the in-place reinstall wrote INTO the running version (M17).
    expect(ask(home, 'stage-w6', 'v1.0.0', 'linked', 'v1.0.0')).toBe('rc=1');
    // A spine older than W6 writes THROUGH ~/ccrc (M16).
    expect(ask(home, 'stage-old', 'v2.0.0', 'linked', 'v1.0.0')).toBe('rc=1');
    // The link points somewhere else than it did before the spine (M18).
    expect(ask(home, 'stage-w6', 'v2.0.0', 'linked', 'v0.9.0')).toBe('rc=1');
    // Was foreign, reads linked now: not the same word.
    expect(ask(home, 'stage-w6', 'v2.0.0', 'foreign', '')).toBe('rc=1');

    // A FOREIGN ~/ccrc still foreign: `_inst_tree` refused it before a byte.
    const alien = freshUpdateBox('ccrc-update-untouched-foreign-');
    mkdirSync(join(alien, 'elsewhere'));
    symlinkSync(join(alien, 'elsewhere'), join(alien, 'ccrc'));
    expect(ask(alien, 'stage-w6', 'v2.0.0', 'foreign', ''))
      .toBe('$HOME/ccrc is still a link whose target is not a version directory under $HOME/ccrc-versions, which the spine refused to place over\nrc=0');
    expect(ask(alien, 'stage-old', 'v2.0.0', 'foreign', '')).toBe('rc=1');

    // W6 Task 3 (D-3458): a `directory` layout that still reads `directory`
    // — no `~/ccrc.migrating`, no link — proves the real directory was
    // never touched: every write before `_inst_migrate`'s move lands in
    // `~/ccrc-versions/<name>`, never in `~/ccrc` itself. `_ver_layout`
    // never reads `~/.ccrc/migrating-to`, so a marker left over from a
    // failed aside-move would not change this reading either.
    const dir = freshUpdateBox('ccrc-update-untouched-dir-');
    mkdirSync(join(dir, 'ccrc', 'server'), { recursive: true });
    expect(ask(dir, 'stage-w6', 'v2.0.0', 'directory', ''))
      .toBe('$HOME/ccrc is still the pre-versioned directory; the migration did not leave it moved\nrc=0');
    // A spine older than W6 still writes THROUGH ~/ccrc even on a directory
    // layout (no BOX_VERSIONS_ROOT line at all).
    expect(ask(dir, 'stage-old', 'v2.0.0', 'directory', '')).toBe('rc=1');
    // The layout moved on since the pre-measurement: a migration completed
    // (a real link beside a real ~/ccrc.migrating is `migrated`), so the
    // real directory was NOT left untouched.
    const migrated = freshUpdateBox('ccrc-update-untouched-dir-migrated-');
    installVersionedTree(migrated, 'v9.9.9');
    mkdirSync(join(migrated, 'ccrc.migrating'), { recursive: true });
    expect(ask(migrated, 'stage-w6', 'v2.0.0', 'directory', '')).toBe('rc=1');
  });

  it('a spine that COMPLETED under a failing doctor exits 3, not 1: the record is written, the report prints, and the line says the box IS on the new build (D-3114)', () => {
    // Measured 2026-09-20 on the live server box: record written, box on the
    // new build, four pre-existing doctor FAILs, `ccrc update` exit 1 — and
    // rollout read that 1 as "did not move". The record is written LAST by
    // the spine, so its presence after a non-zero staged install means the
    // spine ran to its end and the trailing doctor is what said 1.
    const home = freshUpdateBox('ccrc-update-doctor-failed-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    rmSync(join(home, '.gitconfig'));   // the box's own health: git_email FAILs, the spine does not
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(3);
    // The health gate ran on the REAL spine's result (design §11): the
    // staged `_inst_env` wrote ccrc.env's address, `_inst_stamp` the version.
    expect(r.stdout).toMatch(/^update: gate: both answers on v2\.0\.0 \(ccrc\.service up, \/health at 127\.0\.0\.1:7788 answers v2\.0\.0\)$/m);
    expect(r.stdout).toMatch(/^FAIL git_email: /m);
    expect(r.stdout).toMatch(/^update: the staged install completed \(the record is written\) but its trailing doctor exited 1 — this box IS on v2\.0\.0; the FAIL lines above are the box's health, not the update's/m);
    // Line 2 (design 2026-09-20 §5, D-3117): a verified bundle (packRelease's
    // default) makes `cmd_update` assert CCRC_UPDATE_VERIFIED=1 for this
    // spine, so the marker is ONE line — verified, not `unsigned` (Task 12).
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe('newsha0000000000000000000000000000000000\n');
    expect(existsSync(join(home, '.ccrc', 'install-step')), 'a completed spine left its step marker').toBe(false);
    expect(r.stdout).toMatch(/^update: build: v1\.0\.0 \(oldsha[0-9a-f]*\) -> v2\.0\.0 \(newsha[0-9a-f]*\)$/m);
    expect(r.stderr).not.toMatch(/the staged install \(which ends with doctor\) exited/);
    expect(r.stdout).not.toMatch(/died inside _inst_installed/);
    // Task 1 (design §10): the report's last word is `done` — the box MOVED
    // — and its detail says whose the FAIL lines are. Exit 3 is unchanged.
    // The em dash in the shipped sentence reaches the report as `-`
    // (`_upd_json_str` spells the file's three non-ASCII characters in ASCII
    // before its printable-ASCII filter).
    const rep = JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
    expect(rep['phase']).toBe('done');
    expect(rep['target']).toBe('v2.0.0');
    expect(rep['detail']).toBe('doctor exited 1 - the box moved; its health is ccrc doctor\'s');
  });

  it('a floor write that fails inside _inst_installed is named as that, not as doctor: the box IS on the new build, its floor not raised, exit 3 (M1)', () => {
    // W1 minor M1. `_inst_installed` places the completed-install record and
    // THEN raises the floor; a floor write that fails dies there — after the
    // record, before the trailing doctor ever ran — and the record's
    // presence alone read that death as "its trailing doctor exited 1".
    // Task 4's step marker tells the two apart: `_inst_installed` removes it
    // only on its completed returns, so a death inside its floor block
    // leaves it naming `_inst_installed`.
    const home = freshUpdateBox('ccrc-update-floor-write-dies-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    // Task 4's knob in the harness's recording `mv`: it refuses exactly the
    // one move that places ~/.ccrc/floor (`_inst_floor`'s `mv -f -- "$ftmp"
    // "$BOX_FLOOR_FILE"`) and execs the real mv for every other — the record,
    // the step marker, update.json — so the spine runs to that line and no
    // further.
    writeFileSync(join(home, 'fixture-mv-fail'), '/.ccrc/floor\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(3);
    expect(r.stderr).toMatch(/writing \S+\/\.ccrc\/floor failed/);
    // Task 5's gate ran on the new build and passed — exit 3, not 4, is
    // that pass (a failed gate here would be Task 6's restore).
    expect(r.stdout).toMatch(/^update: gate: both answers on v2\.0\.0 /m);
    expect(r.stdout).toMatch(/^update: the staged install placed its completed-install record, then died inside _inst_installed \(writing ~\/\.ccrc\/floor — read its line above\); this box IS on v2\.0\.0 and its floor was not raised$/m);
    expect(r.stdout).not.toMatch(/trailing doctor exited/);
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe('newsha0000000000000000000000000000000000\n');
    expect(existsSync(join(home, '.ccrc', 'floor'))).toBe(false);
    expect(readFileSync(join(home, '.ccrc', 'install-step'), 'utf8')).toBe('_inst_installed\n');
    // Task 1's report: the console reads the same cause, not doctor's.
    const rep = JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
    expect(rep['phase']).toBe('done');
    expect(rep['detail']).toBe('the floor write died inside _inst_installed - the box moved; its floor was not raised');
  });

  it('a spine that DIED after _inst_tree moved the tree (at _inst_bins) is gated, fails the gate on the OLD build, and exits 4 with the backup named — and leaves NO completed-install record (D-3114, design §11)', () => {
    // W6 Task 3 (D-3458): `plantOldBox` is a real-directory box, and since W6
    // that layout is placed exactly like `absent` — the version is placed
    // FULLY, deps included, before `_inst_migrate` ever moves the real
    // directory. An `npm ci` failure (this case's original lever) therefore
    // dies BEFORE the migration and leaves `~/ccrc` untouched — the shape
    // `_upd_tree_untouched`'s `directory` row now reads as "nothing was
    // replaced" (its own describe, below), not this case's "after the tree
    // moved". So the death is moved one step later, to `_inst_bins` — the
    // step right after `_inst_tree`, reached only once the migration has
    // already linked `~/ccrc` — with the harness's recording `mv` refusing
    // the one destination `_inst_atomic` renames onto: `~/.local/bin/ccd`.
    const home = freshUpdateBox('ccrc-update-died-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    writeFileSync(join(home, '.ccrc', 'installed'), 'oldsha0000000000000000000000000000000000\n');
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-mv-fail'), '/.local/bin/ccd\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — /m);
    // Task 6: its v1.0.0 is unpublished, so arm 2 refuses and arm 3 runs —
    // and arm 3 removes ~/.ccrc/installed rather than restoring it, so the
    // no-record line holds.
    expect(r.stdout).toMatch(/^update: arm2-refused: v1\.0\.0 ships no bundle — /m);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
    expect(r.stderr).toMatch(/update: v2\.0\.0 was installed, but the box did not come back healthy on it \(.*\) — exit 4\. The backup taken BEFORE the install is complete at/);
    // The tree DID move this time — the migration linked ~/ccrc before the
    // death at the very next step.
    expect(readFileSync(join(home, '.ccrc', 'install-step'), 'utf8')).toBe('_inst_bins\n');
    expect(existsSync(join(home, '.ccrc', 'installed')), 'a died spine must leave no record — not even the old build\'s').toBe(false);
    expect(r.stdout).not.toMatch(/^update: build: /m);
  });

  // D-3147: `~/.ccrc/ccrc-caps` is written only by `_inst_caps` and removed
  // only by uninstall; `cmd_update` clears `~/.ccrc/installed` before the
  // staged spine but must clear caps too — otherwise a staged spine that
  // never reaches `_inst_caps` (a pre-W1 rollback spine, or one that dies
  // before that step) leaves a stale `verify` cap sitting beside a fresh
  // one-line marker, which spec §6 reads as `provenance: verified` for an
  // install nobody verified. `stubTree`'s staged `ccd/ccrc` is exactly such
  // a spine — it exits 0 without ever writing caps.
  it('caps are cleared beside the marker before the staged spine runs, so a staged tree that never writes caps leaves none stale (D-3147)', () => {
    const home = freshUpdateBox('ccrc-update-caps-cleared-');
    plantOldBox(home, { version: 'v1.0.0' });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'ccrc-caps'), 'os linux\nverify\nnode-id\nfloor\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(join(home, '.ccrc', 'ccrc-caps')),
      'a caps file the staged spine never wrote must not survive the update').toBe(false);
  });

  it('checksum mismatch: refuses loudly and changes NOTHING — no backup, no install, ~/ccrc byte-identical', () => {
    const home = freshUpdateBox('ccrc-update-tamper-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', tamper: true });
    const before = treeDigest(join(home, 'ccrc'));
    const stampBefore = readFileSync(join(home, '.ccrc', 'build.json'), 'utf8');
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/checksum verification FAILED/);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(readFileSync(join(home, '.ccrc', 'build.json'), 'utf8')).toBe(stampBefore);
    expect(existsSync(join(home, 'ccrc-backups')), 'a backup ran for a refused artifact').toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the staged install ran despite a bad checksum').toBe(false);
  });

  it('MANIFEST mismatch after an honest outer checksum: refuses, changes nothing', () => {
    // The outer checksum guards TRANSPORT; the MANIFEST guards the SET. A file
    // corrupted after the MANIFEST was generated ships in a tarball whose
    // SHA256SUMS is perfectly honest — only the per-file verify can catch it.
    const home = freshUpdateBox('ccrc-update-manifest-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }),
      { tag: 'v2.0.0', corruptInner: 'MARKER' });
    const before = treeDigest(join(home, 'ccrc'));
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/MANIFEST verification FAILED/);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });

  it('the backup is COMPLETE before the install step runs — a fault between the two leaves it whole', () => {
    // The ordering pin. The staged install dies at its first instruction (the
    // stub exits 1) — everything the backup promises must already be on disk:
    // reordering backup after install (the mutation this test exists to
    // redden) leaves an operator whose failed update destroyed the only copy.
    const home = freshUpdateBox('ccrc-update-ordering-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0', installExit: 1 }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/ccrc-backups/);
    const backup = announcedBackupDir(r.stdout, home);
    // coord.db: a real snapshot (VACUUM INTO writes a database, not a copy of
    // uncertain bytes) …
    const snap = readFileSync(join(backup, 'coord.db'));
    expect(snap.subarray(0, 15).toString('utf8')).toBe('SQLite format 3');
    // … the old ccd, byte for byte …
    expect(readFileSync(join(backup, 'ccd'), 'utf8'))
      .toBe(readFileSync(join(home, '.local', 'bin', 'ccd'), 'utf8'));
    // … the job files this box actually has, and the dists. The NAMES are
    // per-platform (systemd units vs launchd plists) and so is the set:
    // launchd has no template unit, because there is nothing to instantiate —
    // `ccd` writes one plist per session at enable time.
    if (process.platform === 'darwin') {
      expect(existsSync(join(backup, 'app.ccrc.ccrc.plist'))).toBe(true);
    } else {
      expect(existsSync(join(backup, 'ccrc.service'))).toBe(true);
      expect(existsSync(join(backup, 'claude-session@.service'))).toBe(true);
    }
    expect(existsSync(join(backup, 'server-dist', 'old.js'))).toBe(true);
    expect(existsSync(join(backup, 'agent-dist', 'old.js'))).toBe(true);
  });

  it('--to vX.Y.Z fetches the named tag\'s URL space, and a downgrade prints the coord.db restore lines without copying the db', () => {
    const home = freshUpdateBox('ccrc-update-rollback-');
    plantOldBox(home, { version: 'v2.0.0' });
    plantCoordDb(home);
    const dbBytes = readFileSync(join(home, '.ccrc', 'coord.db'));
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v1.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // All three fetches went to the pinned tag's download path, in order —
    // the bundle joins the set (design §5, Task 12).
    expect(localUrls(home)).toEqual([
      `local://${home}/releases/download/v1.0.0/SHA256SUMS`,
      `local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz`,
      `local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz.sigstore.json`,
    ]);
    // The rollback report: the restore is PRINTED, never performed —
    // migrations are forward-only and an older server reads a newer coord.db.
    // Fix round 1 item 11 / review 155 C17: this hint line is redacted like
    // every other announcement now, so it reads `~/ccrc-backups/…`, never
    // the fixture's own absolute HOME (`announcedBackupDir`'s own real path
    // is still what the filesystem checks elsewhere in this file use).
    expect(r.stdout).toMatch(/^update: rollback: /m);
    expect(r.stdout).toContain('NOT restored');
    expect(r.stdout).toMatch(/cp ~\/ccrc-backups\/\d{8}-\d{6}\/coord\.db/);
    // The rollback lines name this platform's own stop verb.
    expect(r.stdout).toContain(process.platform === 'darwin'
      ? 'launchctl bootout' : 'systemctl --user stop ccrc.service');
    // The live db was read (VACUUM INTO) and never written.
    expect(readFileSync(join(home, '.ccrc', 'coord.db')).equals(dbBytes),
      'update wrote the live coord.db').toBe(true);
    // No skew was reported and none was asked about (no server address).
    expect(r.stdout).not.toMatch(/WARN/);
  });

  it('the recorded role reaches the staged install — CCRC_ROLE=fleet becomes --role fleet, absence becomes none', () => {
    const home = freshUpdateBox('ccrc-update-role-');
    plantOldBox(home, { version: 'v1.0.0' });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=fleet\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    const argv = readFileSync(join(home, 'staged-ccrc-argv'), 'utf8').split('\n').filter((l) => l !== '');
    expect(argv[0]).toMatch(/\/ccd\/ccrc$/);
    expect(argv.slice(1)).toEqual(['install', '--role', 'fleet']);
    // Without a recorded role the staged install is invoked bare — its own
    // default (both) decides, exactly as a fresh `ccrc install` would. A
    // SEPARATE box (fix round 1 item 16 / review 155 C25): the stub install
    // never places a completed-install record, so a second run on the SAME
    // box would be a genuine (non-converged) reinstall reaching its own
    // `_upd_backup` — and a real-clock second shared with the first run's
    // backup is exactly the collision item 16 now refuses; a fresh box
    // avoids the race rather than freezing the clock for a case that was
    // never about backups at all.
    const bare = freshUpdateBox('ccrc-update-role-bare-');
    plantOldBox(bare, { version: 'v1.0.0' });
    mkdirSync(join(bare, '.ccrc'), { recursive: true });
    writeFileSync(join(bare, '.ccrc', 'ccrc.env'), '# no role recorded\n');
    packRelease(bare, stubTree(bare, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r2 = runUpdate(bare);
    expect(r2.code, r2.stderr).toBe(0);
    const argv2 = readFileSync(join(bare, 'staged-ccrc-argv'), 'utf8').split('\n').filter((l) => l !== '');
    expect(argv2.slice(1)).toEqual(['install']);
  });
});

describe('ccrc update: previous, and a spine that dies (design §10–§11; W4 Task 4)', () => {
  const OLD_SHA = 'oldsha0000000000000000000000000000000000';
  const report = (home: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
  const previous = (home: string): string => readFileSync(join(home, '.ccrc', 'previous'), 'utf8');
  const stubBox = (prefix: string, installExit = 0): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v1.0.0' });
    // A COMPLETED install on v1.0.0 — the record names the stamp's sha — so
    // the stamp is a baseline and `previous` is written from it
    // (D-3254 keeps it otherwise).
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    packRelease(home, stubTree(home, { version: 'v2.0.0', installExit }), { tag: 'v2.0.0' });
    return home;
  };

  it('previous is written BEFORE the staged install: two lines, the running tag and sha, mode 0644 (§18 "previous is written before the install")', () => {
    const home = stubBox('ccrc-update-prev-');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, 'staged-saw-previous'), 'utf8')).toBe(`v1.0.0\n${OLD_SHA}\n`);
    expect(previous(home)).toBe(`v1.0.0\n${OLD_SHA}\n`);
    expect(statSync(join(home, '.ccrc', 'previous')).mode & 0o777).toBe(0o644);
    expect(r.stdout).toMatch(new RegExp(`^update: previous: v1\\.0\\.0 \\(${OLD_SHA}\\) — the tag a restore or a bare 'ccrc rollback' returns to$`, 'm'));
  });

  it('an unversioned box writes `untagged` — its stamp sha when it has one, `unstamped` when it has none (D-3231)', () => {
    const home = freshUpdateBox('ccrc-update-prev-untagged-');
    plantOldBox(home);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'),
      `{"sha":"${OLD_SHA}","ref":"main","builtAt":"2026-08-20T00:00:00Z","dirty":false}\n`);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    let r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, 'staged-saw-previous'), 'utf8')).toBe(`untagged\n${OLD_SHA}\n`);
    expect(r.stdout).toMatch(/^update: previous: untagged \(oldsha0+\) — this build carries no release tag, so an automatic restore of it is arm 3 and a bare 'ccrc rollback' refuses \(name one with --to\)$/m);
    const bare = freshUpdateBox('ccrc-update-prev-unstamped-');
    plantOldBox(bare);
    packRelease(bare, stubTree(bare, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    r = runUpdate(bare);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(bare, 'staged-saw-previous'), 'utf8')).toBe('untagged\nunstamped\n');
  });

  // `restore` is not typed here: bare, it is refused at exit 2 (Task 6); its `previous: kept` is read off the real child in Task 6's FULL case.
  // `rollback`/`watchdog` are refused on the CLI door too, since fix round 1
  // item 10 / review 155 C16 (both are now CALLER words, like `restore`) —
  // their real "kept, below the floor" behaviour is measured end-to-end on
  // the real caller elsewhere ("bare `ccrc rollback` returns to previous…",
  // "`ccrc rollback --from watchdog` — the REAL in-process path…"). THIS
  // test's own subject is `_upd_write_previous`'s own branch on `$UPD_FROM`
  // in isolation, so it calls the function directly (`sourcedCcrc`, Task
  // 3's idiom), the same way item 10's caller-marker guard never reaches —
  // that guard lives in `cmd_update`'s argument-refusal block, one layer
  // above the function this test targets.
  it.each([['rollback'], ['watchdog']])('a --from %s run does NOT rewrite previous — it returns to a known tag, not a new baseline (§18 "…and not by a restore")', (from) => {
    const home = freshUpdateBox(`ccrc-update-prev-keep-${from}-`);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'previous'), 'v0.9.0\nbaselinesha\n');
    const r = sourcedCcrc(home, `UPD_FROM=${from} _upd_write_previous v2.0.0 ${OLD_SHA}`);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe('v0.9.0\nbaselinesha\n');
    expect(r.stdout).toMatch(new RegExp(`^update: previous: kept \\(v0\\.9\\.0\\) — a --from ${from} run returns to a known tag; it is not a new baseline$`, 'm'));
  });

  // D-3254, amended in place by fix round 1 item 2 / review 155 C1 (D-3283's
  // OWN pre-amendment text, which this test used to pin, argued the
  // opposite — see the ruling quoted in ccd/ccrc's own D-3283 comment).
  // `previous` names the LAST DIFFERENT release that ran before the current
  // one: a same-tag `--force` reinstall (`ccrc update --to <running tag>
  // --force`, and every `rollout --force` on a converged box) is not a MOVE,
  // so it leaves `previous` UNTOUCHED — whether or not THIS box's own
  // install of that tag ever completed. Writing the running build there (as
  // this test used to require) would make a later bare `ccrc rollback` roll
  // the box FORWARD onto the tag whose reinstall just failed. The restore
  // target this argument used to worry about is answered structurally
  // instead: `_upd_restore_arm2` now skips itself outright on a same-tag
  // run (its own test, in the "automatic restore" describe).
  it('a --force reinstall of the tag the box already runs, even a COMPLETED baseline, keeps previous — a same-tag run is not a move (fix round 1 item 2 / review 155 C1, amends D-3283)', () => {
    const home = freshUpdateBox('ccrc-update-prev-reinstall-');
    plantOldBox(home, { version: 'v2.0.0' });
    // The record names the RUNNING stamp's OWN sha: this box completed
    // installing v2.0.0 before this rerun. That no longer matters — a
    // same-tag reinstall keeps `previous` regardless.
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    writeFileSync(join(home, '.ccrc', 'previous'), 'v1.0.0\nbaselinesha\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the reinstall never ran — the keep below would be vacuous').toBe(true);
    expect(readFileSync(join(home, 'staged-saw-previous'), 'utf8')).toBe('v1.0.0\nbaselinesha\n');
    expect(previous(home)).toBe('v1.0.0\nbaselinesha\n');
    expect(r.stdout).toMatch(/^update: previous: kept \(v1\.0\.0\) — this box's stamp already reads v2\.0\.0, the tag this run installs; a reinstall is not a new baseline$/m);
  });

  // The keep D-3254 (a) actually protects: the record is present but names a
  // DIFFERENT sha than the running stamp — the running build's OWN install
  // never completed (this record is a stale leftover from an earlier build
  // that happened to carry the same tag), so it is not yet a baseline.
  it('a --force reinstall of the tag the box already runs, with a record naming a DIFFERENT sha, keeps previous — the running build has not itself completed (D-3254 (a))', () => {
    const home = freshUpdateBox('ccrc-update-prev-reinstall-stale-record-');
    plantOldBox(home, { version: 'v2.0.0' });
    // Present, but NOT the running stamp's own sha.
    writeFileSync(join(home, '.ccrc', 'installed'), 'differentsha00000000000000000000000000\n');
    writeFileSync(join(home, '.ccrc', 'previous'), 'v1.0.0\nbaselinesha\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the reinstall never ran — the keep below would be vacuous').toBe(true);
    expect(readFileSync(join(home, 'staged-saw-previous'), 'utf8')).toBe('v1.0.0\nbaselinesha\n');
    expect(previous(home)).toBe('v1.0.0\nbaselinesha\n');
    expect(r.stdout).toMatch(/^update: previous: kept \(v1\.0\.0\) — this box's stamp already reads v2\.0\.0, the tag this run installs; a reinstall is not a new baseline$/m);
  });

  // Review fix round 1 I2: the same-tag keep is UNCONDITIONAL — it does
  // NOT need a well-formed `previous` to have something worth keeping
  // (unlike the absent-record keep D-3254 protects for a DIFFERENT tag,
  // below), because a same-tag run writes nothing in the first place. This
  // test used to pin the opposite (writing the running tag as `previous`
  // when none existed to keep) — that write is exactly what let a `rollout
  // --force` on a converged, never-rolled-back box invent a `previous`
  // pointing at itself.
  it('a --force reinstall of the tag the box already runs, with NO previous file at all, keeps (none) and writes nothing (review fix round 1 I2)', () => {
    const first = freshUpdateBox('ccrc-update-prev-reinstall-none-');
    plantOldBox(first, { version: 'v2.0.0' });
    writeFileSync(join(first, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    packRelease(first, stubTree(first, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r2 = runUpdate(first, ['--force']);
    expect(r2.code, `stderr: ${r2.stderr}\nstdout: ${r2.stdout}`).toBe(0);
    expect(r2.stdout).toMatch(/^update: previous: kept \(none\) — this box's stamp already reads v2\.0\.0, the tag this run installs; a reinstall is not a new baseline$/m);
    expect(existsSync(join(first, '.ccrc', 'previous')), 'a same-tag run must never INVENT a previous').toBe(false);
  });

  // Review fix round 1 I2's second pin: a MALFORMED `previous` (not the
  // two-line grammar) is likewise left exactly as it was — never
  // overwritten with the running tag, and never "repaired".
  it('a --force reinstall of the tag the box already runs, with a MALFORMED previous file, keeps (unreadable) and writes nothing (review fix round 1 I2)', () => {
    const home = freshUpdateBox('ccrc-update-prev-reinstall-malformed-');
    plantOldBox(home, { version: 'v2.0.0' });
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    writeFileSync(join(home, '.ccrc', 'previous'), 'not the right shape at all\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: previous: kept \(unreadable\) — this box's stamp already reads v2\.0\.0, the tag this run installs; a reinstall is not a new baseline$/m);
    expect(previous(home)).toBe('not the right shape at all\n');
  });

  it('a box whose last install never completed (stamp v2.0.0, no record) keeps previous on an update to ANOTHER tag (D-3254)', () => {
    const home = freshUpdateBox('ccrc-update-prev-incomplete-');
    plantOldBox(home, { version: 'v2.0.0' });   // no `installed`: the spine that stamped v2.0.0 died before its record
    writeFileSync(join(home, '.ccrc', 'previous'), 'v1.0.0\nbaselinesha\n');
    // v3.0.0, not v2.0.0: the same-tag arm cannot be what keeps it.
    packRelease(home, stubTree(home, { version: 'v3.0.0' }), { tag: 'v3.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, 'staged-saw-previous'), 'utf8')).toBe('v1.0.0\nbaselinesha\n');
    expect(previous(home)).toBe('v1.0.0\nbaselinesha\n');
    expect(r.stdout).toMatch(/^update: previous: kept \(v1\.0\.0\) — this box's stamp has no completed-install record, so an earlier update's spine never finished and the stamp is not a new baseline$/m);
    // …and with NO previous to keep, the same box writes its stamp as today:
    // the arm keeps a baseline, it never invents an absence.
    const fresh = freshUpdateBox('ccrc-update-prev-incomplete-none-');
    plantOldBox(fresh, { version: 'v2.0.0' });
    packRelease(fresh, stubTree(fresh, { version: 'v3.0.0' }), { tag: 'v3.0.0' });
    const r2 = runUpdate(fresh);
    expect(r2.code, `stderr: ${r2.stderr}\nstdout: ${r2.stdout}`).toBe(0);
    expect(previous(fresh)).toBe(`v2.0.0\n${OLD_SHA}\n`);
  });

  it('a previous that cannot be written is REMOVED, never left stale — and the update proceeds saying so', () => {
    const home = stubBox('ccrc-update-prev-mvfail-');
    writeFileSync(join(home, '.ccrc', 'previous'), 'v0.5.0\nstalesha\n');
    writeFileSync(join(home, 'fixture-mv-fail'), '/.ccrc/previous\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: WARN: could not write ~\/\.ccrc\/previous — removed the stale one so no restore can target the wrong tag; this update proceeds without an automatic arm-2 restore$/m);
    expect(existsSync(join(home, '.ccrc', 'previous')), 'the stale previous survived').toBe(false);
    expect(existsSync(join(home, 'staged-saw-no-previous'))).toBe(true);
    expect(readdirSync(join(home, '.ccrc')).filter((f) => f.startsWith('previous.tmp.'))).toEqual([]);
  });

  it('a previous that can be neither written nor removed stops the update BEFORE the staged install', () => {
    const home = stubBox('ccrc-update-prev-stuck-');
    mkdirSync(join(home, '.ccrc', 'previous', 'in-the-way'), { recursive: true });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/could not write ~\/\.ccrc\/previous, and could not remove the stale one either/);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the staged install ran').toBe(false);
    expect(report(home)).toMatchObject({ phase: 'failed' });
  });

  it('a spine that dies BEFORE _inst_tree: exit 1, "nothing was replaced", update.json failed: spine died at <step> (§11)', () => {
    const home = stubBox('ccrc-update-spine-before-', 1);
    writeFileSync(join(home, 'fixture-install-step'), '_inst_node_id\n');
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: the staged install \(which ends with doctor\) exited 1 — spine died at _inst_node_id, before _inst_tree: nothing was replaced; put back as they were: completed-install record; read its lines above\. The backup taken BEFORE it ran is complete at \S+\/ccrc-backups\/\S+$/m);
    // D-3462: the record this box carried is back — this death replaced nothing.
    expect(existsSync(join(home, '.ccrc', 'installed')), 'the cleared record was left removed').toBe(true);
    expect(report(home)).toMatchObject({ phase: 'failed', detail: 'spine died at _inst_node_id', target: 'v2.0.0' });
  });

  it.each([['_inst_tree'], ['_inst_bins'], ['_inst_skills'], ['_inst_from_a_newer_spine']])('a spine that dies at %s reads AT OR AFTER _inst_tree — an unknown step is the safe direction (§18 "a spine death after the tree moved reverts", Task 4 half)', (step) => {
    const home = stubBox(`ccrc-update-spine-after-${step.replace(/^_/, '')}-`, 1);
    writeFileSync(join(home, 'fixture-install-step'), `${step}\n`);
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    // W4 Task 5: the moved arm is GATED now; the gate passes, so the run
    // exits 1 naming --force (D-3240).
    expect(r.stderr).toContain(`update: the box moved and answers on v2.0.0, but its install never completed (spine died at ${step}) — rerun: ccrc update --to v2.0.0 --force`);
    expect(report(home)).toMatchObject({ phase: 'failed', detail: `spine died at ${step}` });
  });

  it('no step marker and an unmoved stamp (a spine older than W4) exits 1 WITHOUT claiming nothing was replaced — and a STALE marker from an earlier failed install never classifies this run (D-3252)', () => {
    const home = stubBox('ccrc-update-spine-none-', 1);
    writeFileSync(join(home, '.ccrc', 'install-step'), '_inst_skills\n');   // left by an earlier failed `ccrc install`
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('spine died at an unrecorded step (no step marker; a spine older than W4 writes none), and whether the tree was replaced is not known (the stamp, written only after _inst_tree, did not move); read its lines above.');
    expect(r.stderr, 'an unmarked death claimed a measurement nobody made').not.toMatch(/nothing was replaced/);
    expect(report(home)).toMatchObject({
      phase: 'failed', detail: 'spine died at an unrecorded step (no step marker; a spine older than W4 writes none)',
    });
    expect(existsSync(join(home, '.ccrc', 'install-step'))).toBe(false);
  });

  it('no step marker but a MOVED stamp (a pre-W4 spine that reached _inst_stamp) reads AT OR AFTER _inst_tree — the stamp is written only after the tree (D-3252)', () => {
    const home = stubBox('ccrc-update-spine-none-restamped-', 1);
    writeFileSync(join(home, 'fixture-restamp'), '');
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(existsSync(join(home, '.ccrc', 'install-step')), 'the fixture wrote a marker — this case is about a spine that writes none').toBe(false);
    expect(r.stdout).toMatch(/^update: the staged spine recorded no step \(a spine older than W4 writes none\), but ~\/\.ccrc\/build\.json no longer names the build this run replaced — _inst_stamp ran after _inst_tree, so the tree WAS placed$/m);
    // W4 Task 5: an unmarked spine whose stamp moved is gated like any other
    // moved death; the gate passes, so the run exits 1 naming --force.
    expect(r.stderr).toContain('update: the box moved and answers on v2.0.0, but its install never completed (spine died at an unrecorded step) — rerun: ccrc update --to v2.0.0 --force');
    expect(report(home)).toMatchObject({ phase: 'failed', detail: 'spine died at an unrecorded step' });
  });

  it('FULL flavour: the REAL staged spine records _inst_skills as it enters it, and a death there reads at-or-after the tree (§11 Pins, "spine death")', () => {
    const home = freshUpdateBox('ccrc-update-spine-skills-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    const tree = fullTree(home, { version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000' });
    writeFileSync(join(tree, 'ccd', 'install-coordinator-skill.sh'),
      '#!/bin/bash\necho "fixture: the coordinator skill installer refuses" >&2\nexit 1\n', { mode: 0o755 });
    rmSync(join(tree, 'MANIFEST'));   // writeManifest lists every file — the old MANIFEST would list itself
    writeManifest(tree);
    packRelease(home, tree, { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/fixture: the coordinator skill installer refuses/);
    expect(readFileSync(join(home, '.ccrc', 'install-step'), 'utf8')).toBe('_inst_skills\n');
    expect(r.stderr).toContain('update: the box moved and answers on v2.0.0, but its install never completed (spine died at _inst_skills) — rerun: ccrc update --to v2.0.0 --force');
    expect(existsSync(join(home, '.ccrc', 'installed'))).toBe(false);
    expect(report(home)).toMatchObject({ phase: 'failed', detail: 'spine died at _inst_skills' });
  });

  it('_upd_step_moved classifies by the RUNNING tree\'s CCRC_INST_SPINE; _upd_spine_step answers none, the step, or unreadable', () => {
    const home = freshUpdateBox('ccrc-update-step-moved-');
    const cases: Array<[string, number]> = [
      ['none', 1], ['_inst_banner', 1], ['_inst_node_id', 1],
      ['_inst_tree', 0], ['_inst_bins', 0], ['_inst_skills', 0], ['_inst_installed', 0],
      ['_inst_from_a_newer_spine', 0], ['unreadable', 0],
    ];
    const r = sourcedCcrc(home, [
      ...cases.map(([s]) => `_upd_step_moved ${s}; echo "${s}=$?"`),
      'f="$HOME/.ccrc/install-step"; mkdir -p "$HOME/.ccrc"; rm -f "$f"',
      'echo "step:$(_upd_spine_step)"',
      'printf \'%s\\n\' _inst_hooks > "$f"; echo "step:$(_upd_spine_step)"',
      'printf \'%s\\n\' \'_inst_hooks; echo injected\' > "$f"; echo "step:$(_upd_spine_step)"',
      ': > "$f"; echo "step:$(_upd_spine_step)"',
    ].join('\n'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([
      ...cases.map(([s, rc]) => `${s}=${rc}`),
      'step:none', 'step:_inst_hooks', 'step:unreadable', 'step:unreadable',
    ]);
  });

  it('_upd_stamp_moved: rc 0 only for a stamp that parses to ANOTHER sha — absent, the same sha or a malformed stamp is rc 1, and BOX_BUILD is restored', () => {
    const home = freshUpdateBox('ccrc-update-stamp-moved-');
    const stamp = (sha: string): string =>
      `printf '%s\\n' '{"sha":"${sha}","ref":"main","builtAt":"2026-08-20T00:00:00Z","dirty":false}' > "$HOME/.ccrc/build.json"`;
    const r = sourcedCcrc(home, [
      'mkdir -p "$HOME/.ccrc"; rm -f "$HOME/.ccrc/build.json"',
      '_upd_stamp_moved oldsha; echo "absent=$?"',
      stamp('oldsha'), '_upd_stamp_moved oldsha; echo "same=$?"',
      stamp('newsha'), '_upd_stamp_moved oldsha; echo "moved=$?"',
      '_upd_stamp_moved ""; echo "from-unstamped=$?"',
      'printf \'not json\\n\' > "$HOME/.ccrc/build.json"; _upd_stamp_moved oldsha; echo "malformed=$?"',
      'BOX_BUILD=(keep me); _upd_stamp_moved oldsha; echo "restored=${BOX_BUILD[*]}"',
    ].join('\n'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([
      'absent=1', 'same=1', 'moved=0', 'from-unstamped=0', 'malformed=1', 'restored=keep me',
    ]);
  });

  it('_upd_read_previous answers five ways and never dies: tag, absent, untagged, malformed, not-a-file', () => {
    const home = freshUpdateBox('ccrc-update-read-prev-');
    const r = sourcedCcrc(home, [
      'p="$HOME/.ccrc/previous"; mkdir -p "$HOME/.ccrc"',
      'show() { _upd_read_previous; echo "$1=$? [$UPD_PREV_TAG] [$UPD_PREV_SHA]"; }',
      'show absent',
      'printf \'%s\\n\' v1.2.3 abc123 > "$p"; show tag',
      'printf \'%s\\n\' untagged abc123 > "$p"; show untagged',
      'printf \'%s\\n\' untagged unstamped > "$p"; show unstamped',
      'printf \'%s\\n\' latest abc123 > "$p"; show not-a-tag',
      'printf \'%s\\n\' v1.2.3 > "$p"; show one-line',
      'printf \'%s\\n\' v1.2.3 abc123 extra > "$p"; show three-lines',
      'printf \'v1.2.3\\n\\n\' > "$p"; show empty-sha',
      'rm -f "$p"; mkdir "$p"; show directory',
    ].join('\n'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([
      'absent=1 [] []',
      'tag=0 [v1.2.3] [abc123]',
      'untagged=2 [untagged] [abc123]',
      'unstamped=2 [untagged] [unstamped]',
      'not-a-tag=3 [] []',
      'one-line=3 [] []',
      'three-lines=3 [] []',
      'empty-sha=3 [] []',
      'directory=3 [] []',
    ]);
  });
});

describe('ccrc update: provenance (design §5; the verifier is the INSTALLED one, decision 12)', () => {
  const OWNER = ((): string => {
    const m = /^CCRC_RELEASE_OWNER="([^"]+)"$/m.exec(readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8'));
    return m![1]!;
  })();
  const REPO_NAME = ((): string => {
    const m = /^CCRC_RELEASE_REPO="([^"]+)"$/m.exec(readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8'));
    return m![1]!;
  })();
  const verifyArgv = (home: string): string[] => (existsSync(join(home, 'verify-argv'))
    ? readFileSync(join(home, 'verify-argv'), 'utf8').split('\n').filter((l) => l !== '') : []);

  it('the bundle is fetched after the tarball and verified by the INSTALLED tree\'s verifier, with --tag, before extraction; the spine is told (§18 "the INSTALLED verifier is used")', () => {
    const home = freshUpdateBox('ccrc-update-prov-ok-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(localUrls(home)).toEqual([
      `local://${home}/releases/latest/download/SHA256SUMS`,
      `local://${home}/releases/latest/download/ccrc-v2.0.0.tar.gz`,
      `local://${home}/releases/latest/download/ccrc-v2.0.0.tar.gz.sigstore.json`,
    ]);
    const argv = verifyArgv(home);
    expect(argv.length).toBe(1);
    const a = argv[0]!.split(' ');
    // `node --no-warnings <verifier> …`: the verifier is resolved beside the
    // ccrc under test (`$CCRC_HERE/../deploy/`), never under the staging dir.
    expect(a[0]).toBe('--no-warnings');
    expect(a[1]).toBe(`${join(REPO, 'ccd')}/../deploy/verify-provenance.mjs`);
    expect(a[1]!.startsWith(join(home, 'tmp'))).toBe(false);
    const flag = (f: string): string => a[a.indexOf(f) + 1]!;
    expect(flag('--blob')).toMatch(/\/ccrc-v2\.0\.0\.tar\.gz$/);
    expect(flag('--bundle')).toMatch(/\/ccrc-v2\.0\.0\.tar\.gz\.sigstore\.json$/);
    expect(flag('--tag')).toBe('v2.0.0');
    expect(flag('--owner')).toBe(OWNER);
    expect(flag('--repo')).toBe(REPO_NAME);
    expect(r.stdout).toMatch(/^update: verified ccrc-v2\.0\.0\.tar\.gz \(transport checksum, provenance, then the per-file MANIFEST\)$/m);
    expect(readFileSync(join(home, 'staged-ccrc-env'), 'utf8')).toBe('1\n');
  });

  it('D-3141: nothing is extracted before provenance is settled — the verifier itself observes no staging tree yet', () => {
    // The plan's mutation row 12 ("move the verifier call below `tar -xzf`")
    // measured GREEN against every assertion above: `_upd_resolve`'s EXIT
    // trap sweeps the whole staging dir on every exit, so nothing left on
    // disk after the fact can tell "never extracted" apart from "extracted,
    // then swept". This pin reads what the shim itself saw AT THE MOMENT it
    // was invoked, before any exit/sweep could happen.
    const home = freshUpdateBox('ccrc-update-prov-staging-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, 'staging-at-verify'), 'utf8')).toBe('no\n');
  });

  it('a FAILING bundle refuses: nothing extracted, no backup, ~/ccrc byte-identical — and --allow-unsigned does not apply (§18 "--allow-unsigned permits absence only")', () => {
    const home = freshUpdateBox('ccrc-update-prov-fail-');
    plantOldBox(home, { version: 'v1.0.0' });
    const before = treeDigest(join(home, 'ccrc'));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-verify-exit'), '1\n');
    let r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/provenance verification FAILED for ccrc-v2\.0\.0\.tar\.gz .* refusing to extract or install/);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    r = runUpdate(home, ['--allow-unsigned']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/--allow-unsigned does not apply to a bundle that FAILS/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  // D-3142: a verifier that cannot RUN at all (a usage error, or node/the
  // script itself missing) is a DIFFERENT fact from a verifier that ran and
  // refused the bundle — folding both into "FAILED" tells the operator the
  // RELEASE is bad when the box could not even perform the check, and closes
  // --allow-unsigned's escape hatch for the wrong reason.
  it('a verifier that exits 2 (usage error) is reported as unable to RUN, not as a bundle that FAILED (D-3142)', () => {
    const home = freshUpdateBox('ccrc-update-prov-vrc2-');
    plantOldBox(home, { version: 'v1.0.0' });
    const before = treeDigest(join(home, 'ccrc'));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-verify-exit'), '2\n');
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/could not RUN the installed verifier \(.*verify-provenance\.mjs exited 2\) — this is not a verdict on the bundle; nothing on this box was changed/);
    expect(r.stderr).not.toMatch(/provenance verification FAILED/);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  it('a verifier that exits 127 (node/the script itself missing) gets the same "could not RUN" sentence (D-3142)', () => {
    const home = freshUpdateBox('ccrc-update-prov-vrc127-');
    plantOldBox(home, { version: 'v1.0.0' });
    const before = treeDigest(join(home, 'ccrc'));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-verify-exit'), '127\n');
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/could not RUN the installed verifier \(.*verify-provenance\.mjs exited 127\) — this is not a verdict on the bundle; nothing on this box was changed/);
    expect(r.stderr).not.toMatch(/provenance verification FAILED/);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  // D-3144: the verifier itself now speaks exit 3 for its own
  // dependency-load failure (a partial `npm ci` under server/node_modules)
  // — this is the ccrc-side half of that pin: exit 3 is just one more
  // member of the SAME non-{0,1} vocabulary 2 and 127 above already
  // exercise, so it must fall into this `elif` arm exactly as they do,
  // never into the `vrc -eq 1` "FAILED" arm.
  //
  // NOT A REGRESSION PIN FOR D-3144's OWN FIX, and it must not be relied on
  // as one (whole-branch fix-round re-review): it drives the recording stub
  // through `fixture-verify-exit`, never the real verify-provenance.mjs, so
  // it exercises this `elif` arm — which D-3144 did not touch — and would
  // stay GREEN if the verifier's dependency-load catch were reverted to
  // exiting 1. What reds on that revert is the verifier-side case in
  // `verify-provenance.test.ts` ('cannot load its own dependencies').
  // This case's job is the shell-side contract: that the arm treats an
  // unfamiliar non-{0,1} code the same way it treats the two it knows.
  it('a verifier that exits 3 (a dependency it could not load) gets the same "could not RUN" sentence, never "FAILED" (D-3144)', () => {
    const home = freshUpdateBox('ccrc-update-prov-vrc3-');
    plantOldBox(home, { version: 'v1.0.0' });
    const before = treeDigest(join(home, 'ccrc'));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-verify-exit'), '3\n');
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/could not RUN the installed verifier \(.*verify-provenance\.mjs exited 3\) — this is not a verdict on the bundle; nothing on this box was changed/);
    expect(r.stderr).not.toMatch(/provenance verification FAILED/);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  it('an ABSENT bundle refuses without --allow-unsigned, and proceeds with it — recorded as unsigned (§18 "--allow-unsigned is recorded")', () => {
    const home = freshUpdateBox('ccrc-update-prov-absent-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', bundle: false });
    let r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the release ships no provenance bundle .* installs only with --allow-unsigned \(recorded on the box as unsigned\)/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(verifyArgv(home)).toEqual([]);
    r = runUpdate(home, ['--allow-unsigned']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // D-3143 then D-3284: curl -f's exit 22 means ANY HTTP status >= 400, not
    // specifically 404 — so only a MEASURED 404 (via -w) reaches this WARN.
    expect(r.stdout).toMatch(/^update: WARN: .*sigstore\.json is absent \(the release host answered 404\) — proceeding on the transport checksum alone because --allow-unsigned was typed; this install will be recorded as unsigned$/m);
    // m9 (Ruling 32): the closing transcript line for this success path was
    // previously unasserted — pin it distinct from the verified-bundle case's
    // own closing line (the OK-flavour test above).
    expect(r.stdout).toMatch(/^update: verified ccrc-v2\.0\.0\.tar\.gz \(transport checksum, then the per-file MANIFEST — provenance NOT verified, --allow-unsigned\)$/m);
    expect(readFileSync(join(home, 'staged-ccrc-env'), 'utf8')).toBe('unset\n');
  });

  it('env -u actually strips an AMBIENT CCRC_UPDATE_VERIFIED=1 on the unsigned path — the "marker records unsigned" case, deliberately polluted (the env-u pin)', () => {
    // Without this, `env -u CCRC_UPDATE_VERIFIED` could be deleted from
    // `cmd_update`'s staged-install invocation and every existing test would
    // stay green, because nothing ever POLLUTES the ambient environment
    // before calling `runUpdate`. Here it is deliberately polluted, and the
    // FULL-flavour marker (`.ccrc/installed`, the real spine) is what proves
    // `env -u` actually strips it rather than relying on it never being set.
    const home = freshUpdateBox('ccrc-update-prov-envu-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    const sha = 'newsha0000000000000000000000000000000002';
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha }), { tag: 'v2.0.0', bundle: false });
    const r = runUpdate(home, ['--allow-unsigned'], { CCRC_UPDATE_VERIFIED: '1' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe(`${sha}\nunsigned\n`);
  });

  it('FULL flavour: a verified update writes a one-line marker; an --allow-unsigned one writes `unsigned` on line 2', () => {
    const home = freshUpdateBox('ccrc-update-prov-marker-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    const sha = 'newsha0000000000000000000000000000000001';
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha }), { tag: 'v2.0.0' });
    let r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe(`${sha}\n`);
    const home2 = freshUpdateBox('ccrc-update-prov-marker-unsigned-');
    plantOldBox(home2, { version: 'v1.0.0' });
    plantCoordDb(home2);
    packRelease(home2, fullTree(home2, { version: 'v2.0.0', sha }), { tag: 'v2.0.0', bundle: false });
    r = runUpdate(home2, ['--allow-unsigned']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home2, '.ccrc', 'installed'), 'utf8')).toBe(`${sha}\nunsigned\n`);
  });

  it('verification runs AFTER sha256sum -c (a tampered tarball never reaches the verifier) and BEFORE tar -x (§18 "verification precedes extraction")', () => {
    const home = freshUpdateBox('ccrc-update-prov-order-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', tamper: true });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/checksum verification FAILED/);
    expect(verifyArgv(home)).toEqual([]);
    // The failing-verifier case above proves the other side: refused before
    // extraction, so no staged tree, no backup, no spine.
  });

  it('a bundle download that fails for a reason other than 404 is not "absent" — refused even with --allow-unsigned', () => {
    const home = freshUpdateBox('ccrc-update-prov-net-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    // The stub curl exits 22 for a missing file (curl's own 404 shape); the
    // fixture exit models every other failure — here curl's 7, "could not
    // connect" — which is NOT absence and which --allow-unsigned never admits.
    writeFileSync(join(home, 'fixture-curl-exit'), '7\n');
    const r = runUpdate(home, ['--allow-unsigned']);
    expect(r.code).toBe(1);
    // D-3284: verdict-first now — "not a verdict on this release" survives
    // the 200-char cut even when the URL is long; the URL itself follows.
    expect(r.stderr).toMatch(/a transient fetch failure \(curl exit 7, not a 404\) fetching the provenance bundle — not a verdict on this release: .*sigstore\.json/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  it('D-3140: build.json unreadable/malformed at the staged tree ("{"), refuses with the rc-N sentence and installs nothing', () => {
    const home = freshUpdateBox('ccrc-update-prov-buildjson-');
    plantOldBox(home, { version: 'v1.0.0' });
    // Built by hand rather than via stubTree: the MANIFEST must be generated
    // exactly ONCE, over the tree's final bytes (build-release.sh's own
    // shape) — a malformed build.json that is still MANIFEST-honest, so the
    // run reaches `_box_build_fields`'s parse and no earlier guard.
    const tree = join(home, 'payload-v2.0.0-badjson');
    mkdirSync(join(tree, 'ccd'), { recursive: true });
    writeFileSync(join(tree, 'ccd', 'ccrc'),
      '#!/bin/sh\nprintf \'%s\\n\' "$0" "$@" > "$HOME/staged-ccrc-argv"\n'
      + 'printf \'%s\\n\' "${CCRC_UPDATE_VERIFIED:-unset}" > "$HOME/staged-ccrc-env"\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(tree, 'MARKER'), 'release payload\n');
    writeFileSync(join(tree, 'build.json'), '{');
    writeManifest(tree);
    packRelease(home, tree, { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the extracted tree's build\.json is unreadable or malformed \(rc \d+\) — refusing to install/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });
});

describe('ccrc update: --check refuses --downgrade and --allow-unsigned like --force (D-3139)', () => {
  it.each([
    ['--downgrade'],
    ['--allow-unsigned'],
  ])('--check and %s are exclusive — same refusal shape as --check/--force, exit 2, nothing fetched', (flag) => {
    const home = freshUpdateBox(`ccrc-update-check-excl-${flag.replace(/^--/, '')}-`);
    const r = runUpdate(home, ['--check', flag]);
    expect(r.code).toBe(2);
    // m4 (Ruling 32): the flag name is interpolated per case — the old
    // three-way alternation let a `--downgrade` case pass even if the code
    // emitted "--allow-unsigned" (or vice versa), since either alternative
    // satisfies it.
    expect(r.stderr).toMatch(new RegExp(`update: --check and ${flag} are exclusive`));
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
  });
});

describe('ccrc update: the fleet-behind warning (D-150 aware)', () => {
  it('a server whose /api/fleet/health says skewed earns a WARN naming fleet-box-first', () => {
    const home = freshUpdateBox('ccrc-update-skew-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, 'fixture-health-body'),
      '{"mode":"remote","connected":true,"downSince":null,"build":"skewed","roster":"agreed"}\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, [], { CCRC_ADDR: '127.0.0.1:7788' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^update: WARN: .*skewed.*fleet box first/im);
  });

  it('a 401 from the session gate skips the comparison SILENTLY — the gate answered, not the build (D-150)', () => {
    const home = freshUpdateBox('ccrc-update-401-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, 'fixture-health-body'),
      '{"error":"unauthenticated","verdict":"no session cookie"}\n');
    writeFileSync(join(home, 'fixture-health-code'), '401\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, [], { CCRC_ADDR: '127.0.0.1:7788' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/WARN/);
    // The update itself proceeded: the staged install ran.
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });
});

describe('ccrc update: the supervisor sweep (Task 7 — R1, granted 2026-08-21)', () => {
  // The one scoped exception to CLAUDE.md's never-touch rule: update's step-4
  // sweep may try-restart `claude-session@*` units, but ONLY behind the
  // mandatory KillMode=process preflight — without KillMode=process a
  // try-restart is a fleet kill (every session is a child of ONE tmux server
  // sitting in whichever claude-session@ cgroup created it), so an absent
  // drop-in refuses the SWEEP, never fails the UPDATE. All against the
  // RECORDING systemctl stub above — no real systemd, no real sweep, ever.
  // `plantKillModeDropIn` and `UNIT_LINES` are at FILE scope — the gate's
  // `converged()` needs both, so that its "NO sweep" assertion has a sweep
  // to be the absence of.

  itLinux('with KillMode=process resolving per unit, the sweep runs: preflight, try-restart, the failed warn query, the active verify query — in that argv order', () => {
    const home = freshUpdateBox('ccrc-update-sweep-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // The ONLY systemctl traffic in a stub-flavour run is the health gate's
    // unit probe (design §11 — it runs BEFORE the sweep) and the sweep's, so
    // the whole recording is the order pin: the gate, then enumerate,
    // preflight EVERY unit plus
    // the uninstantiated template probe, try-restart, then the two state
    // queries — warn about failed, verify active.
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8')
      .split('\n').filter((l) => l !== '');
    expect(calls).toEqual([
      '--user is-active ccrc.service',
      '--user list-units claude-session@* --plain --no-legend',
      '--user show -p KillMode claude-session@alpha.service',
      '--user show -p KillMode claude-session@beta.service',
      '--user show -p KillMode claude-session@ccrc-update-preflight.service',
      '--user try-restart claude-session@*',
      '--user list-units claude-session@* --state=failed --plain --no-legend',
      '--user list-units claude-session@* --state=active --plain --no-legend',
    ]);
    // Panes are NEVER touched: no tmux invocation happened at all (the tmux
    // stub records every call), and no recorded argv so much as names it.
    expect(existsSync(join(home, 'tmux-argv')), 'the sweep reached for tmux').toBe(false);
    expect(calls.join('\n')).not.toMatch(/tmux/);
    expect(r.stdout).toMatch(/^update: sweep: /m);
    expect(r.stdout).not.toMatch(/DEGRADED/);
  });

  // Fix round 1 item 5 / review 155 C2 (your Q5), narrowed by review fix
  // round 1 m2: the lock is released BEFORE the sweep (§10 requires it), so
  // a SECOND `ccrc update` can take it mid-sweep and write its own
  // in-flight report. Only the WRITE this run makes after that point — the
  // closing `_upd_phase done` — must not clobber that newer run's report:
  // it runs only while update.json still names THIS run's own pid, and
  // skips with one line otherwise. `_upd_report`'s own announcement writes
  // NOTHING to disk (operator output only) and always runs regardless. The
  // reviewer's own probe shape: the systemctl stub's try-restart arm writes
  // a foreign report (a different pid) mid-sweep.
  itLinux('a foreign report written mid-sweep survives this run\'s closing phase write, which skips with one line — but the build line still prints (review fix round 1 m2, narrowing item 5 / review 155 C2, your Q5)', () => {
    const home = freshUpdateBox('ccrc-update-sweep-foreign-report-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-foreign-report'), 'yes\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    // The run's OWN exit code is unaffected by the skip — it still reports
    // success to ITS OWN caller; only the JSON write is skipped.
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(
      /^update: report: skipped — ~\/\.ccrc\/update\.json no longer names this run's pid \(\d+\); a newer update took the lock this run released before the sweep, and this run's final phase write would have overwritten its in-flight one$/m);
    // The foreign report SURVIVES — this run never overwrote it with a
    // closing `done`.
    const rep = JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
    expect(rep).toEqual({
      target: 'v9.9.9', phase: 'resolving', startedAt: 1, updatedAt: 1, detail: null, from: 'cli', pid: 999999,
    });
    // `_upd_report` writes NOTHING to disk, so it always runs — the build
    // line prints even though the JSON write it precedes was skipped.
    expect(r.stdout).toMatch(/^update: build: v1\.0\.0 \(oldsha0+\) -> v1\.0\.0 \(oldsha0+\)$/m);
    // The sweep itself still ran — the skip is only the closing phase write.
    expect(r.stdout).toMatch(/^update: sweep: /m);
  });

  itLinux('with the drop-in ABSENT the sweep is REFUSED — loud, naming the drop-in — and the update still exits 0 with a degraded line', () => {
    const home = freshUpdateBox('ccrc-update-sweep-refused-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    // The sweep is refused, not the update: the run completes, reports, exits 0.
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: build: /m);
    // Loud, and it names both the resolved value and the drop-in that fixes it.
    expect(r.stderr).toMatch(/sweep REFUSED/);
    expect(r.stderr).toContain('KillMode=process');
    expect(r.stderr).toContain('claude-session@.service.d');
    expect(r.stdout).toMatch(/^update: DEGRADED: the supervisor sweep/m);
    // Refused means NOTHING was restarted: the preflight stopped at the first
    // bad unit and no try-restart ever hit the recording.
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8');
    expect(calls).not.toMatch(/try-restart/);
    expect(existsSync(join(home, 'tmux-argv'))).toBe(false);
  });

  // ── The Darwin siblings: the same outcomes, launchd's vocabulary ─────────
  // The macOS counterpart of the R1 preflight is `AbandonProcessGroup`, read
  // from the plist on disk; the restart is `launchctl kickstart -k`, which
  // without that key kills the job's whole process group — the shared tmux
  // server included. These four run against the recording launchctl stub in
  // `updateEnv`, never a real launchd.
  const plantSessionPlist = (home: string, id: string,
    opts: { abandons?: boolean; loaded?: boolean } = {}): void => {
    const { abandons = true, loaded = true } = opts;
    const agents = join(home, 'Library', 'LaunchAgents');
    mkdirSync(agents, { recursive: true });
    const key = abandons ? '<key>AbandonProcessGroup</key><true/>' : '';
    writeFileSync(join(agents, `app.ccrc.session.${id}.plist`),
      '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>'
      + `<key>Label</key><string>app.ccrc.session.${id}</string>${key}</dict></plist>\n`);
    if (loaded) appendFileSync(join(home, 'launchctl-loaded'), `app.ccrc.session.${id}.plist\n`);
  };

  itDarwin('with AbandonProcessGroup in every job file, the sweep kickstarts each loaded session and re-measures it still up', () => {
    const home = freshUpdateBox('ccrc-update-sweep-darwin-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantSessionPlist(home, 'alpha');
    plantSessionPlist(home, 'beta');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const calls = readFileSync(join(home, 'launchctl-calls'), 'utf8');
    expect(calls).toMatch(/^kickstart -k gui\/\d+\/app\.ccrc\.session\.alpha$/m);
    expect(calls).toMatch(/^kickstart -k gui\/\d+\/app\.ccrc\.session\.beta$/m);
    // Panes are NEVER touched, on this platform exactly as on the other.
    expect(existsSync(join(home, 'tmux-argv')), 'the sweep reached for tmux').toBe(false);
    expect(r.stdout).toMatch(/^update: sweep: /m);
    expect(r.stdout).toContain('2 restarted and re-measured still up');
    expect(r.stdout).not.toMatch(/DEGRADED/);
  });

  itDarwin('a job file missing AbandonProcessGroup REFUSES the sweep — loud on stderr, DEGRADED on stdout, and NO kickstart for ANY session', () => {
    const home = freshUpdateBox('ccrc-update-sweep-darwin-refused-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantSessionPlist(home, 'alpha');
    plantSessionPlist(home, 'beta', { abandons: false });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    // The sweep is refused, not the update: the run completes, reports, exits 0.
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: build: /m);
    expect(r.stderr).toMatch(/sweep REFUSED/);
    expect(r.stderr).toContain('AbandonProcessGroup');
    // The remedy names the BARE id `ccd start` actually takes.
    expect(r.stderr).toContain('ccd start beta');
    expect(r.stderr).not.toContain('ccd start beta.service');
    // The transcript line rides STDOUT, as the Linux arm's does — the stream
    // divergence was measured (>&2 on the Darwin line only) and fixed; a
    // stdout-only capture must not read as a clean update.
    expect(r.stdout).toMatch(/^update: DEGRADED: the supervisor sweep/m);
    expect(r.stderr).not.toMatch(/^update: DEGRADED/m);
    const calls = existsSync(join(home, 'launchctl-calls'))
      ? readFileSync(join(home, 'launchctl-calls'), 'utf8') : '';
    expect(calls).not.toMatch(/kickstart/);
    expect(existsSync(join(home, 'tmux-argv'))).toBe(false);
  });

  itDarwin('a kicked supervisor whose pid did not hold across the window FAILS the update, naming the pre-update backup', () => {
    const home = freshUpdateBox('ccrc-update-sweep-darwin-loop-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantSessionPlist(home, 'alpha');
    // Every `launchctl print` answers a fresh pid: a crash loop as launchd
    // shows one. kickstart itself still exits 0 — the gap under test.
    writeFileSync(join(home, 'fixture-pid-churn'), 'yes\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, 'a supervisor that did not stay up must FAIL the update').not.toBe(0);
    expect(r.stderr).toMatch(/did not stay up/);
    // The one line in the whole update path that points at the rollback.
    expect(r.stderr).toMatch(/pre-update backup is complete at \S*ccrc-backups/);
  });

  itDarwin('a session carrying the start-limit stamp is warned about and skipped — not kicked, not fatal', () => {
    const home = freshUpdateBox('ccrc-update-sweep-darwin-failed-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantSessionPlist(home, 'alpha');
    // gamma was booted out by the start-limit emulation: stamp on disk, job
    // no longer loaded — `_svc_list_sessions` still enumerates its plist.
    plantSessionPlist(home, 'gamma', { loaded: false });
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'gamma.svcfailed'), '1\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stderr).toMatch(/^update: warning: claude-session@gamma\.service is FAILED/m);
    expect(r.stderr).toContain('ccd start gamma');
    const calls = readFileSync(join(home, 'launchctl-calls'), 'utf8');
    expect(calls).toMatch(/^kickstart -k gui\/\d+\/app\.ccrc\.session\.alpha$/m);
    expect(calls).not.toMatch(/kickstart -k gui\/\d+\/app\.ccrc\.session\.gamma/);
    expect(r.stdout).toContain('1 restarted and re-measured still up');
  });
});

describe('ccrc update: source pins', () => {
  // ── ONE release identity, two entry points, held equal (the D-92 idiom) ──
  // `install.sh --release` runs before any ccrc exists on the box, so it
  // cannot read ccrc's pair, and ccrc runs on boxes install.sh has left —
  // the cross-file second spelling is structural, so it is PINNED equal
  // rather than promised equal.
  it('the release owner/repo pair is spelled in install.sh and ccd/ccrc, and the two agree', () => {
    const pick = (src: string, file: string, name: string): string => {
      const m = new RegExp(`^${name}="([^"]+)"$`, 'm').exec(src);
      expect(m, `${file} does not spell ${name}`).not.toBeNull();
      return m![1]!;
    };
    const inst = readFileSync(join(REPO, 'install.sh'), 'utf8');
    const ccrc = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    expect(pick(ccrc, 'ccd/ccrc', 'CCRC_RELEASE_OWNER'))
      .toBe(pick(inst, 'install.sh', 'CCRC_RELEASE_OWNER'));
    expect(pick(ccrc, 'ccd/ccrc', 'CCRC_RELEASE_REPO'))
      .toBe(pick(inst, 'install.sh', 'CCRC_RELEASE_REPO'));
  });

  // ── The bash floor — three spellings, held to one value (same idiom) ────
  // install.sh's macOS preflight, `ccrc install`'s Darwin gate and the
  // README each state the floor, in three different logical forms, and
  // nothing held them equal (PR #11 review): a floor bump applied to one
  // site goes green in CI and admits a box the other site then refuses —
  // after paying for npm ci and a vite build. The two predicates are
  // extracted BY THEIR OWN SPELLINGS and reduced to (major, minor); a
  // rewritten predicate that no longer matches is a red here, not a silent
  // second spelling.
  it('the bash floor is the SAME major.minor in install.sh, ccd/ccrc and the README', () => {
    const inst = readFileSync(join(REPO, 'install.sh'), 'utf8');
    const ccrc = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const readme = readFileSync(join(REPO, 'README.md'), 'utf8');

    // install.sh: [ maj -lt X ] || { [ maj -eq X ] && [ min -lt Y ] }
    const i = /\[ "\$bmaj" -lt (\d+) \] \|\| \{ \[ "\$bmaj" -eq (\d+) \] && \[ "\$bmin" -lt (\d+) \]; \}/.exec(inst);
    expect(i, 'install.sh lost its bash-floor predicate (or respelled it — update this pin WITH the spelling)').not.toBeNull();
    expect(i![1], 'install.sh compares two different majors').toBe(i![2]);
    const instFloor = `${i![1]}.${i![3]}`;

    // ccd/ccrc: [ maj -lt X+1 ] && { [ maj -lt X ] || [ min -lt Y ] }
    const c = /\[ "\$\{BASH_VERSINFO\[0\]:-0\}" -lt (\d+) \] \\\n\s*&& \{ \[ "\$\{BASH_VERSINFO\[0\]:-0\}" -lt (\d+) \] \|\| \[ "\$\{BASH_VERSINFO\[1\]:-0\}" -lt (\d+) \]; \}/.exec(ccrc);
    expect(c, 'ccd/ccrc lost its bash-floor predicate (or respelled it — update this pin WITH the spelling)').not.toBeNull();
    expect(Number(c![1]), 'ccrc\'s outer cap must be floor-major + 1 or the predicate means a different floor')
      .toBe(Number(c![2]) + 1);
    const ccrcFloor = `${c![2]}.${c![3]}`;

    expect(ccrcFloor, 'install.sh and ccd/ccrc refuse below DIFFERENT floors').toBe(instFloor);
    expect(readme, `README.md no longer states the bash ≥ ${instFloor} floor`)
      .toContain(`bash ≥ ${instFloor}`);
    // Both refusal messages must keep NAMING the floor they enforce.
    expect(inst).toContain(`ccd needs ${instFloor} or newer`);
    expect(ccrc).toContain(`ccd needs ${instFloor} or newer`);
  });
});

describe('ccrc update --check: what runs here vs what is published (spec §6)', () => {
  const parse = parseCheck;

  it('behind: an older version on the box, exit 1, SHA256SUMS fetched and nothing else, nothing written', () => {
    const home = freshUpdateBox('ccrc-update-check-behind-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const before = treeDigest(join(home, 'ccrc'));
    const r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    expect(parse(r.stdout)).toEqual({ box: 'v1.0.0', sha: 'oldsha0000000000000000000000000000000000', target: 'v2.0.0', caps: CAPS_NOW, floor: 'none', projection: 'not-configured', state: 'behind' });
    expect(r.stdout).toMatch(/^this box: v1\.0\.0 \(oldsha[0-9a-f]*\) · latest: v2\.0\.0 — behind$/m);
    expect(localUrls(home)).toEqual([`local://${home}/releases/latest/download/SHA256SUMS`]);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });

  it('writes NOTHING under HOME (spec §11) — the whole home is byte-identical, not just the three places we thought to look', () => {
    // The three assertions above name places a write WE EXPECTED would land
    // (`~/ccrc`, `~/ccrc-backups`, the staged install's argv record). Spec
    // §11's claim is larger and nothing observed it: `--check` writes
    // nothing AT ALL. A recursive before/after listing is the observation —
    // it catches the write nobody predicted, which is the only kind that
    // matters here.
    //
    // Two exclusions, both the HARNESS writing rather than the verb: the
    // staging dir under `$TMPDIR` (which `updateEnv` puts at `<home>/tmp`,
    // update's own mktemp -d space, removed by its EXIT trap) and
    // `<home>/curl-argv`, the fixture curl's recording of the one fetch the
    // case above already pins.
    const home = freshUpdateBox('ccrc-update-check-writes-nothing-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    // `runUpdate` builds its environment on EVERY call, and building it
    // plants fixtures under HOME (`updateEnv`'s `fixture-graphify-pkg` and
    // its `ghContainedEnv` poison, then `replantDoctorStubs`' copies over
    // the top of it). Doing that once BEFORE the snapshot, IN RUNUPDATE'S
    // OWN ORDER, is what keeps this case measuring the VERB: both are
    // idempotent and byte-identical on the second call, so anything that
    // moves between the two listings below was written by `ccrc update
    // --check` itself. (The order matters — `replantDoctorStubs` is what
    // leaves `.local/bin/gh` as the doctor stub rather than the poison.)
    updateEnv(home);
    replantDoctorStubs(home);
    const before = homeSnapshot(home);
    const r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    expect(homeSnapshot(home)).toEqual(before);
  });

  it('writes NOTHING on a versioned box either — the ~/ccrc link, both kept versions and the stamp are unchanged (W6 Task 7)', () => {
    // The case above, on the layout W6 leaves a box in: `~/ccrc` a LINK into
    // `~/ccrc-versions/v9.9.1`, a second kept version beside it. `--to`, so
    // the target is named rather than resolved: this case measures what
    // `--check` WRITES, and `--to` never resolves the target from the projection (it is read only for `projection=`). The W6 guard
    // is an lstat, not a snapshot line, so the listing itself stays the only
    // thing under test.
    const home = freshUpdateBox('ccrc-update-check-writes-nothing-w6-');
    installVersionedTree(home, 'v9.9.1', { stamp: { sha: 'oldsha0000000000000000000000000000000000', version: 'v9.9.1' } });
    installVersionedTree(home, 'v9.9.0', { link: false, stamp: { sha: 'b'.repeat(40), version: 'v9.9.0' } });
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink(), 'the fixture is not a W6 box').toBe(true);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp('v9.9.1', 'oldsha0000000000000000000000000000000000'));
    writeFileSync(join(home, '.ccrc', 'installed'), 'oldsha0000000000000000000000000000000000\n');
    packRelease(home, stubTree(home, { version: 'v9.9.2' }), { tag: 'v9.9.2', latest: false });
    // `runUpdate`'s own environment plants, once, in its own order — the
    // reason is the case above's.
    updateEnv(home);
    replantDoctorStubs(home);
    const before = homeSnapshot(home);
    const r = runUpdate(home, ['--check', '--to', 'v9.9.2']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stdout.split('\n')[0]).toMatch(/^check: box=v9\.9\.1 sha=\S+ target=v9\.9\.2 (.* )?state=behind$/);
    expect(homeSnapshot(home)).toEqual(before);
  });

  it('homeSnapshot records a regular file by its content digest: a rewrite to the same length is a difference (T2, final review)', () => {
    // The size-only line was the link's twin: a record rewritten to another
    // sha of the same length (`<sha>\n` is always 41 bytes) left the listing
    // byte-identical, so a "writes nothing" case passed over a rewritten file.
    const home = mkTmp('ccrc-update-snapshot-content-');
    mkdirSync(join(home, '.ccrc'));
    writeFileSync(join(home, '.ccrc', 'installed'), `${'a'.repeat(40)}\n`);
    const before = homeSnapshot(home);
    writeFileSync(join(home, '.ccrc', 'installed'), `${'b'.repeat(40)}\n`);
    expect(homeSnapshot(home)).not.toEqual(before);
    writeFileSync(join(home, '.ccrc', 'installed'), `${'a'.repeat(40)}\n`);
    expect(homeSnapshot(home), 'unchanged bytes read as unchanged').toEqual(before);
  });

  it('homeSnapshot records a link by its target: a flip between two same-length version names is a difference (W6 Task 7)', () => {
    // The harness's own pin. A symlink used to be a leaf recorded as
    // `<rel>\t<lstat size>`, and a link's lstat size is the LENGTH of its
    // target: `~/ccrc -> …/v9.9.1` and `~/ccrc -> …/v9.9.0` recorded the
    // SAME line, so a `--check` that flipped the box passed the case above.
    const home = mkTmp('ccrc-update-snapshot-link-');
    installVersionedTree(home, 'v9.9.1');
    installVersionedTree(home, 'v9.9.0', { link: false });
    const before = homeSnapshot(home);
    // The flip as `_plat_ln_swap` performs it: a staged link renamed over the old one.
    symlinkSync(join(home, 'ccrc-versions', 'v9.9.0'), join(home, 'ccrc.new'));
    renameSync(join(home, 'ccrc.new'), join(home, 'ccrc'));
    const after = homeSnapshot(home);
    expect(after).not.toEqual(before);
    expect(after).toContain(`ccrc -> ${join(home, 'ccrc-versions', 'v9.9.0')}`);
    expect(after.filter((l) => l.startsWith('ccrc-versions/v9.9.1/')).length,
      'the versions root was not walked on its own').toBeGreaterThan(0);
  });

  it('--check and --force are exclusive — one refusal, exit 2, nothing fetched', () => {
    // `--check` MEASURES; `--force` reinstalls a converged box. The check arm
    // returns before `--force` is ever read, so the pair used to mean "drop
    // the flag you also typed" in silence.
    const home = freshUpdateBox('ccrc-update-check-force-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, ['--check', '--force']);
    expect(r.code, `stdout: ${r.stdout}`).toBe(2);
    expect(r.stderr).toMatch(/--check and --force are exclusive/);
    // Before anything is fetched: the refusal is an argument-surface one.
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
  });

  it('current: same version AND the completed-install record names the stamped sha, exit 0', () => {
    const home = freshUpdateBox('ccrc-update-check-current-');
    plantOldBox(home, { version: 'v2.0.0' });
    writeFileSync(join(home, '.ccrc', 'installed'), 'oldsha0000000000000000000000000000000000\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, ['--check']);
    expect(r.code, r.stderr).toBe(0);
    expect(parse(r.stdout).state).toBe('current');
    expect(r.stdout).toMatch(/— current$/m);
  });

  it('incomplete: same version but no (or a stale) completed-install record, exit 1 — rollout must not skip it', () => {
    const home = freshUpdateBox('ccrc-update-check-incomplete-');
    plantOldBox(home, { version: 'v2.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    let r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    expect(parse(r.stdout).state).toBe('incomplete');
    writeFileSync(join(home, '.ccrc', 'installed'), 'stalesha00000000000000000000000000000000\n');
    r = runUpdate(home, ['--check']);
    expect(parse(r.stdout).state).toBe('incomplete');
  });

  it('unversioned: a deploy.sh stamp (no version), exit 1, and --to labels the target', () => {
    const home = freshUpdateBox('ccrc-update-check-unversioned-');
    plantOldBox(home);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'),
      '{"sha":"deploysha0000000000000000000000000000000","ref":"HEAD","builtAt":"2026-09-17T17:16:09Z","dirty":false}\n');
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    const r = runUpdate(home, ['--check', '--to', 'v1.0.0']);
    expect(r.code).toBe(1);
    expect(parse(r.stdout)).toEqual({ box: 'unversioned', sha: 'deploysha0000000000000000000000000000000', target: 'v1.0.0', caps: CAPS_NOW, floor: 'none', projection: 'not-configured', state: 'unversioned' });
    expect(r.stdout).toMatch(/^this box: unversioned \(deploysha[0-9a-f]*\) · target: v1\.0\.0 — a release install would be the first on this box$/m);
    expect(localUrls(home)).toEqual([`local://${home}/releases/download/v1.0.0/SHA256SUMS`]);
  });

  it('unstamped: no build.json at all reads as unversioned with sha=none', () => {
    const home = freshUpdateBox('ccrc-update-check-unstamped-');
    plantOldBox(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    expect(parse(r.stdout)).toMatchObject({ box: 'unversioned', sha: 'none', state: 'unversioned' });
  });

  // W4 Task 12 (plan D-3232), plus `projection=` (fix round 1 item 22 /
  // review 155, your Q8): every field rollout reads sits BEFORE state=,
  // because rollout takes state as everything after the LAST `state=`.
  it('the machine line is box, sha, target, caps, floor, projection, state — in that order, state last', () => {
    const home = freshUpdateBox('ccrc-update-check-fields-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check', '--to', 'v2.0.0']);
    expect(r.code, r.stderr).toBe(1);
    // No role/timer/intent planted: this box's projection reads
    // not-configured, same word `ccrc channel` would print for it.
    expect(checkLine(r.stdout)).toBe(
      `check: box=v1.0.0 sha=oldsha0000000000000000000000000000000000 target=v2.0.0 caps=${CAPS_NOW} floor=none projection=not-configured state=behind`);
  });

  // Plan D-3248: `--check` is answered by the
  // running ccrc, so it prints `_ccrc_cap_words`, never the file.
  it('caps= is what the RUNNING ccrc can do, never the file — a stale ~/.ccrc/ccrc-caps does not narrow it, and --check leaves it alone', () => {
    const home = freshUpdateBox('ccrc-update-check-caps-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, '.ccrc', 'ccrc-caps'), 'os plan9\nverify\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check', '--to', 'v2.0.0']);
    expect(parse(r.stdout).caps).toBe(CAPS_NOW);
    expect(readFileSync(join(home, '.ccrc', 'ccrc-caps'), 'utf8')).toBe('os plan9\nverify\n');
  });

  it('floor= answers what the install path would read — none, the tag, malformed — and --check never refuses on it', () => {
    const cases: Array<[string | null, string]> = [[null, 'none'], ['v1.0.0', 'v1.0.0'], ['three', 'malformed']];
    for (const [content, word] of cases) {
      const home = freshUpdateBox(`ccrc-update-check-floorword-${word}-`);
      plantOldBox(home, { version: 'v1.0.0' });
      if (content !== null) writeFileSync(join(home, '.ccrc', 'floor'), `${content}\n`);
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
      const r = runUpdate(home, ['--check', '--to', 'v2.0.0']);
      expect(r.code, `${word}: ${r.stderr}`).toBe(1);
      expect(parse(r.stdout)).toMatchObject({ floor: word, state: 'behind' });
      expect(r.stderr, word).toBe('');
      expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    }
  });

  // F2 (fix round 1): the malformed note itself was asserted by no case
  // (only unreadable's, which skips as root) — and the brief's own `read …
  // || floor=""` clause says a floor line with no trailing newline is
  // malformed too, on both paths.
  it('a malformed floor (garbage, or a tag with no trailing newline) prints its own note, never the unreadable one', () => {
    const cases: Array<[string, string]> = [['three\n', 'garbage'], ['v3.0.0', 'no trailing newline']];
    for (const [content, why] of cases) {
      const home = freshUpdateBox(`ccrc-update-check-floorword-malformed-${why.replace(/\s+/g, '-')}-`);
      plantOldBox(home, { version: 'v1.0.0' });
      writeFileSync(join(home, '.ccrc', 'floor'), content);
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
      const r = runUpdate(home, ['--check', '--to', 'v2.0.0']);
      expect(r.code, why).toBe(1);
      expect(parse(r.stdout), why).toMatchObject({ floor: 'malformed', state: 'behind' });
      expect(r.stdout, why).toMatch(/^this box's floor \(~\/\.ccrc\/floor\) is malformed — 'ccrc update' refuses until it is fixed by hand$/m);
      expect(r.stdout, why).not.toMatch(/floor.*is unreadable/);
    }
  });

  it.skipIf(process.getuid?.() === 0)('an unreadable floor reads floor=unreadable — its own word, never folded into none or malformed', () => {
    const home = freshUpdateBox('ccrc-update-check-floorword-unreadable-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, '.ccrc', 'floor'), 'v3.0.0\n');
    chmodSync(join(home, '.ccrc', 'floor'), 0o000);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check', '--to', 'v2.0.0']);
    expect(r.code).toBe(1);
    expect(parse(r.stdout)).toMatchObject({ floor: 'unreadable', state: 'behind' });
    expect(r.stdout).toMatch(/^this box's floor \(~\/\.ccrc\/floor\) is unreadable — 'ccrc update' refuses until it is fixed by hand$/m);
  });
});

describe('ccrc update: the "already there" gate (spec §5)', () => {
  const converged = (prefix: string): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v2.0.0' });
    plantCoordDb(home);
    // The stub release's stamp sha is what stubTree writes: newsha…; the box
    // must carry the SAME sha for the gate's second comparison to hold.
    writeFileSync(join(home, '.ccrc', 'build.json'),
      '{"sha":"newsha0000000000000000000000000000000000","ref":"release","builtAt":"2026-08-21T00:00:00Z","dirty":false,"version":"v2.0.0"}\n');
    writeFileSync(join(home, '.ccrc', 'installed'), 'newsha0000000000000000000000000000000000\n');
    // EVERYTHING A SWEEP NEEDS, so that "NO sweep" below is a statement
    // about the GATE. Without the KillMode=process drop-in the preflight
    // refuses the sweep on its own, so deleting the gate would leave the
    // recording just as free of `try-restart` — the assertion would be
    // green for a reason that has nothing to do with what it claims to
    // pin. With the drop-in planted and two live units enumerated, an
    // un-gated run DOES record `--user try-restart claude-session@*`
    // (measured: see the plan's mutation table).
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    return home;
  };

  it('three matching shas → nothing to do: exit 0, tarball verified, NO backup, NO install, NO sweep', () => {
    const home = converged('ccrc-update-gate-skip-');
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^update: this box already runs v2\.0\.0 \(newsha[0-9a-f]*\) and that install completed — nothing to do \(pass --force to reinstall\)$/m);
    // All three fetches happened (the gate's exact stage reads the staged
    // stamp, so fetch + verify runs before the gate returns)…
    expect(localUrls(home)).toEqual([
      `local://${home}/releases/latest/download/SHA256SUMS`,
      `local://${home}/releases/latest/download/ccrc-v2.0.0.tar.gz`,
      `local://${home}/releases/latest/download/ccrc-v2.0.0.tar.gz.sigstore.json`,
    ]);
    // …and nothing after them.
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    const calls = existsSync(join(home, 'systemctl-calls')) ? readFileSync(join(home, 'systemctl-calls'), 'utf8') : '';
    expect(calls).not.toMatch(/try-restart|restart/);
  });

  it('--force skips the gate: the same box installs and sweeps', () => {
    const home = converged('ccrc-update-gate-force-');
    const r = runUpdate(home, ['--force']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/nothing to do/);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });

  // THE CONTROL FOR THE "NO SWEEP" ASSERTION ABOVE. An absence proves nothing
  // unless the same fixture can produce the presence: the skip case's
  // `expect(calls).not.toMatch(/try-restart/)` was vacuous while `converged()`
  // planted no KillMode=process drop-in, because the preflight would have
  // refused the sweep with the gate deleted too. This case runs the IDENTICAL
  // fixture, differing only by `--force`, and measures the try-restart the
  // skip case says is absent. Linux-only because it names systemd's argv;
  // the launchd siblings live in the sweep describe above.
  itLinux('…and on that same fixture the sweep really does try-restart — so the skip case\'s "no sweep" is a real absence', () => {
    const home = converged('ccrc-update-gate-force-sweeps-');
    const r = runUpdate(home, ['--force']);
    expect(r.code, r.stderr).toBe(0);
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8');
    expect(calls).toMatch(/--user try-restart claude-session@\*/);
  });

  it('same version, record absent → proceeds', () => {
    const home = converged('ccrc-update-gate-norecord-');
    rmSync(join(home, '.ccrc', 'installed'));
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });

  it('same version, record names an older sha → proceeds', () => {
    const home = converged('ccrc-update-gate-stale-');
    writeFileSync(join(home, '.ccrc', 'installed'), 'oldsha0000000000000000000000000000000000\n');
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });

  it('same version, the RELEASE carries a different sha (a moved tag) → proceeds', () => {
    const home = converged('ccrc-update-gate-moved-');
    writeFileSync(join(home, '.ccrc', 'build.json'),
      '{"sha":"boxsha00000000000000000000000000000000000","ref":"release","builtAt":"2026-08-21T00:00:00Z","dirty":false,"version":"v2.0.0"}\n');
    writeFileSync(join(home, '.ccrc', 'installed'), 'boxsha00000000000000000000000000000000000\n');
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });

  it('a different version never consults the record', () => {
    const home = converged('ccrc-update-gate-differs-');
    writeFileSync(join(home, '.ccrc', 'build.json'),
      '{"sha":"newsha0000000000000000000000000000000000","ref":"release","builtAt":"2026-08-21T00:00:00Z","dirty":false,"version":"v1.0.0"}\n');
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });
});

describe('ccrc update: the tag is bound (design §5, decision 4)', () => {
  it('--to v0.0.9 against a SHA256SUMS naming ccrc-v0.0.3.tar.gz refuses BEFORE any backup, tag to tag (§18 "the tag is bound before backup")', () => {
    const home = freshUpdateBox('ccrc-update-bind-sums-');
    plantOldBox(home, { version: 'v0.0.1' });
    packRelease(home, stubTree(home, { version: 'v0.0.3' }), { tag: 'v0.0.9', latest: false, asName: 'ccrc-v0.0.3.tar.gz' });
    const r = runUpdate(home, ['--to', 'v0.0.9']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the release at v0\.0\.9 names a ccrc-v0\.0\.3\.tar\.gz \(version v0\.0\.3, not v0\.0\.9\) — refusing/);
    expect(localUrls(home)).toEqual([`local://${home}/releases/download/v0.0.9/SHA256SUMS`]);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });

  it('--to v0.0.9 against a SHA256SUMS naming ccrc-v0.0.9.tar.gz proceeds — the comparison never strips a side', () => {
    const home = freshUpdateBox('ccrc-update-bind-ok-');
    plantOldBox(home, { version: 'v0.0.1' });
    packRelease(home, stubTree(home, { version: 'v0.0.9' }), { tag: 'v0.0.9', latest: false });
    const r = runUpdate(home, ['--to', 'v0.0.9']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
  });

  it('an extracted build.json whose version is not the resolved one refuses; nothing installed (§18 "the extracted version is bound")', () => {
    const home = freshUpdateBox('ccrc-update-bind-stamp-');
    plantOldBox(home, { version: 'v0.0.1' });
    const before = treeDigest(join(home, 'ccrc'));
    packRelease(home, stubTree(home, { version: 'v2.0.1' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the extracted tree's build\.json says version 'v2\.0\.1' but the release was resolved as v2\.0\.0 — refusing/);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });
});

// D-3148 (pre-existing, stage 4; fixed here as a revertable scope
// expansion, its own commit): `_upd_resolve`'s shape check on the tarball
// name SHA256SUMS carries is a glob (`ccrc-*.tar.gz`), which a traversing
// name like `ccrc-x/../../../../evil.tar.gz` satisfies — and
// `curl -o "$UPD_STAGE/$UPD_TARNAME"` would create or clobber that path
// BEFORE any checksum or provenance check. Hand-crafted, not via
// `packRelease`/`asName`, because that helper's `tar -czf`/`sha256sum`
// pipeline would itself try to create a file at the traversing path on the
// HOST filesystem — a fixture hazard, not the subject under test.
describe('ccrc update: the tarball name is bounded — no path separator (D-3148)', () => {
  it('a SHA256SUMS naming a traversing tarball path refuses before any tarball fetch, and creates nothing outside the staging dir', () => {
    const home = freshUpdateBox('ccrc-update-tarname-traversal-');
    plantOldBox(home, { version: 'v1.0.0' });
    const relDir = join(home, 'releases', 'latest', 'download');
    mkdirSync(relDir, { recursive: true });
    const traversalName = 'ccrc-x/../../../../evil.tar.gz';
    writeFileSync(join(relDir, 'SHA256SUMS'), `${'a'.repeat(64)}  ${traversalName}\n`);
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/SHA256SUMS names a tarball with a path separator \(got: ccrc-x\/\.\.\/\.\.\/\.\.\/\.\.\/evil\.tar\.gz\) — refusing/);
    // Only the SHA256SUMS fetch happened — never a fetch of the tarball itself.
    expect(localUrls(home)).toEqual([`local://${home}/releases/latest/download/SHA256SUMS`]);
    expect(existsSync(join(home, 'evil.tar.gz'))).toBe(false);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });
});

describe('ccrc update: the floor, on every path (design §9, decision 8)', () => {
  const plantFloor = (home: string, v: string): void => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'floor'), `${v}\n`);
  };

  it('latest/download naming a version below the floor is refused before any backup, with NO --to on the argv (§18 "the floor is checked on every path")', () => {
    const home = freshUpdateBox('ccrc-update-floor-latest-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/v2\.0\.0 \(resolved by latest\/download\) is below this box's floor v3\.0\.0/);
    expect(r.stderr).toMatch(/ccrc update --to v2\.0\.0 --downgrade/);
    // Review fix round 1 I5 (narrowing item 17 / review 155 C28): the
    // target's VERSION (v2.0.0) differs from the running stamp's (v3.0.0),
    // so `_upd_converged`'s first comparison already answers "not
    // converged" without ever needing the staged sha — the floor is
    // checked BEFORE the fetch here, exactly as before item 17, and the
    // refusal costs only the resolve-time SHA256SUMS read.
    expect(localUrls(home)).toEqual([`local://${home}/releases/latest/download/SHA256SUMS`]);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    // The measured phases: resolving, then straight to failed — never
    // fetching/verifying, which a full fetch would have added.
    expect(reportWrites(home).map((w) => w['phase'])).toEqual(['resolving', 'failed']);
  });

  // W6 Task 8A (the floor's refusal after a restore; C28's root). The floor
  // is raised inside the staged spine, before the health gate, and a restore
  // never lowers it (spec §9 stands) — so a failed update that restored
  // leaves the floor above the running release. The refusal a later move
  // meets names the last update (to the floor's tag, its gate failed and it was restored), read from the last run's report,
  // and names the floor alone when that report does not say so.
  const REVERTED_REPORT = (target: string): string =>
    `{"target":"${target}","phase":"reverted","startedAt":1,"updatedAt":2,"detail":"arm1: flipped back to v1.0.0; gate: fixture","from":"cli","pid":1}\n`;
  const RAISED_BY = (floor: string): string =>
    ` — the last update, to ${floor}, failed its health gate and was restored`;

  // The shape a tail about the running release gets wrong: the update to the
  // floor's OWN tag failed its gate and was restored onto that same tag (a
  // `--force` reinstall of the floor's tag, arm 3 or arm 1 back to it), so
  // the box runs the floor's tag — not a release below it. The clause is the
  // ruled sentence exactly, and nothing more.
  it('a same-tag restore (the box runs the floor\'s own tag): the clause names the restored update and claims nothing about where the box runs', () => {
    const home = freshUpdateBox('ccrc-update-floor-same-tag-restore-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    writeFileSync(join(home, '.ccrc', 'update.json'),
      REVERTED_REPORT('v3.0.0').replace('arm1: flipped back to v1.0.0', 'arm3: restored v3.0.0 (same build, not mixed)'));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(`${RAISED_BY('v3.0.0')} — moving down is a typed act: ccrc update --to v2.0.0 --downgrade`);
    expect(r.stderr).toContain('the last update, to v3.0.0, failed its health gate and was restored — moving down');
    expect(r.stderr).not.toContain('the floor stands above');
    expect(r.stderr).not.toContain('above the release this box runs');
  });

  it('END TO END: a real update whose gate failed and restored leaves the floor above the running release, and the next move below it is refused naming the last update, restored after its gate failed (C28\'s root)', () => {
    const home = onKeptV1('ccrc-update-floor-restored-');
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-deny'), 'v2.0.0\n');
    const up = runUpdate(home);
    expect(up.code, `stderr: ${up.stderr}\nstdout: ${up.stdout}`).toBe(4);
    expect(fileText(join(home, '.ccrc', 'floor'))).toBe('v2.0.0\n');
    expect(lastReport(home)).toMatchObject({ phase: 'reverted', target: 'v2.0.0' });
    // v1.0.0 is what runs, and it is below the floor: a forced reinstall
    // is a move down, and the refusal says why the floor stands where it does.
    const r = runUpdate(home, ['--to', 'v1.0.0', '--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain(`v1.0.0 (resolved by --to v1.0.0) is below this box's floor v2.0.0 (`);
    expect(r.stderr).toContain(`${RAISED_BY('v2.0.0')} — moving down is a typed act: ccrc update --to v1.0.0 --downgrade. Nothing on this box was changed`);
  }, 60_000);

  it.each([
    ['a report that says the update to the floor tag was restored', REVERTED_REPORT('v3.0.0'), true],
    ['a restored update to some OTHER tag', REVERTED_REPORT('v2.5.0'), false],
    ['a report of a COMPLETED update to the floor tag', REVERTED_REPORT('v3.0.0').replace('"reverted"', '"done"'), false],
    ['an absent report', null, false],
    ['a report that is not JSON', 'reverted v3.0.0\n', false],
    ['a report whose target is not a tag', REVERTED_REPORT('v3.0.0').replace('"v3.0.0"', '"v3.0.0; rm -rf"'), false],
  ] as const)('the floor\'s refusal names the restored update only when the last report says so — %s (floor-only otherwise, exactly as before)', (_what, report, named) => {
    const home = freshUpdateBox('ccrc-update-floor-named-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    if (report !== null) writeFileSync(join(home, '.ccrc', 'update.json'), report);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/v2\.0\.0 \(resolved by --to v2\.0\.0\) is below this box's floor v3\.0\.0 \(\S+: the highest version this box completed an install of\)/);
    if (named) {
      expect(r.stderr).toContain(`${RAISED_BY('v3.0.0')} — moving down is a typed act: ccrc update --to v2.0.0 --downgrade`);
      expect(r.stderr, 'the clause claims nothing about where the box runs').not.toContain('the floor stands above');
    } else {
      expect(r.stderr).not.toContain('failed its health gate and was restored');
      expect(r.stderr).toMatch(/the highest version this box completed an install of\) — moving down is a typed act: ccrc update --to v2\.0\.0 --downgrade\. Nothing on this box was changed/);
    }
  });

  it('a report reached through a SYMLINK is unsafe to read and names nothing: the refusal is the floor alone (the one shared guard)', () => {
    const home = freshUpdateBox('ccrc-update-floor-named-link-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    writeFileSync(join(home, 'elsewhere.json'), REVERTED_REPORT('v3.0.0'));
    symlinkSync(join(home, 'elsewhere.json'), join(home, '.ccrc', 'update.json'));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v2.0.0']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('is below this box\'s floor v3.0.0');
    expect(r.stderr).not.toContain('failed its health gate and was restored');
  });

  it('--to below the floor is refused the same way, naming --to', () => {
    const home = freshUpdateBox('ccrc-update-floor-to-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v2.0.0']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/v2\.0\.0 \(resolved by --to v2\.0\.0\) is below this box's floor v3\.0\.0/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  // W1 minor M7: `--force` is never a way below the floor
  // (§18 "the floor is checked on every path"). Fix round 1 item 17 /
  // review 155 C28 REORDERED the converged no-op ahead of the floor check
  // (a converged no-op moves nothing, so the floor has nothing to guard) —
  // but `--force` disables the converged no-op itself (`[ "$force" -eq 0 ]
  // && _upd_converged`), so a forced install always reaches the floor check
  // regardless of the reorder, and still refuses before any backup or
  // staged spine.
  it('--force cannot take a box below its floor, by --to or by latest/download: W1\'s refusal, no backup, nothing staged (M7)', () => {
    const home = freshUpdateBox('ccrc-update-floor-force-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    let r = runUpdate(home, ['--to', 'v2.0.0', '--force']);
    expect(r.code, `stdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/v2\.0\.0 \(resolved by --to v2\.0\.0\) is below this box's floor v3\.0\.0 .* moving down is a typed act: ccrc update --to v2\.0\.0 --downgrade/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    const latest = freshUpdateBox('ccrc-update-floor-force-latest-');
    plantOldBox(latest, { version: 'v3.0.0' });
    plantFloor(latest, 'v3.0.0');
    packRelease(latest, stubTree(latest, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    r = runUpdate(latest, ['--force']);
    expect(r.code, `stdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/v2\.0\.0 \(resolved by latest\/download\) is below this box's floor v3\.0\.0/);
    expect(existsSync(join(latest, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(latest, 'staged-ccrc-argv'))).toBe(false);
    expect(readFileSync(join(latest, '.ccrc', 'floor'), 'utf8')).toBe('v3.0.0\n');
  });

  it('--downgrade proceeds, warns, and the floor is NOT lowered (§18 "--downgrade is the only way below the floor")', () => {
    const home = freshUpdateBox('ccrc-update-floor-downgrade-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v2.0.0', '--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: WARN: v2\.0\.0 is below this box's floor v3\.0\.0 .* --downgrade was typed; the floor stays v3\.0\.0/m);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v3.0.0\n');
  });

  it('at or above the floor proceeds without a word; no floor file is unconstrained', () => {
    const home = freshUpdateBox('ccrc-update-floor-ok-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantFloor(home, 'v1.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    let r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    // Not a bare /floor/ scan: the fixture HOME's own path is
    // `.../ccrc-update-floor-ok-<rand>/...` and appears in the ordinary
    // "update: fetching …" lines, so that substring is always present and
    // proves nothing. What must be ABSENT is the floor check's own voice —
    // the WARN or refusal phrasing `_upd_floor_check` uses when it has
    // something to say.
    expect(r.stdout).not.toMatch(/is below this box's floor|floor is malformed/);
    const bare = freshUpdateBox('ccrc-update-floor-none-');
    plantOldBox(bare, { version: 'v3.0.0' });
    packRelease(bare, stubTree(bare, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    r = runUpdate(bare);
    expect(r.code, r.stderr).toBe(0);
  });

  it('a malformed floor file refuses and names the file — never read as "no floor"', () => {
    const home = freshUpdateBox('ccrc-update-floor-bad-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantFloor(home, 'three');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    // Fix round 1 item 11 / review 155 C17: the verdict now leads the
    // sentence (D-3249), the path follows.
    expect(r.stderr).toMatch(/malformed floor \(got: 'three'\)/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  // Task 11 Important (no D): the converged-box steady state — a box AT its
  // own floor, updating to that SAME version — rests entirely on
  // `_ver_newer`'s strict `>` and nothing pinned it. floor == target must
  // proceed silently, not warn as though it were below.
  it('the floor equal to the target proceeds without a word — not "below" (Task 11 Important)', () => {
    const home = freshUpdateBox('ccrc-update-floor-equal-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantFloor(home, 'v2.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/is below this box's floor/);
  });

  // Task 11 minor (no D): an UNREADABLE floor (the `read` itself fails) is a
  // different condition from a malformed one and must not collapse into it
  // (the overloaded-null-at-a-seam ban this file's own conventions apply
  // elsewhere). Root bypasses permission bits, so this is not measurable
  // running as root — skipped there, and said so.
  it.skipIf(process.getuid?.() === 0)('an unreadable floor file (permissions) dies with its own sentence, distinct from "malformed"', () => {
    const home = freshUpdateBox('ccrc-update-floor-unreadable-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantFloor(home, 'v3.0.0');
    chmodSync(join(home, '.ccrc', 'floor'), 0o000);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    // Fix round 1 item 11 / review 155 C17: the verdict now leads the
    // sentence (D-3249), the path follows.
    expect(r.stderr).toMatch(/unreadable: .*\.ccrc\/floor — fix its permissions by hand/);
    expect(r.stderr).not.toMatch(/malformed/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  // M3 (W1 minor; plan D-3233). This case used to pin that
  // --check never READ the floor — which is exactly why rollout's preflight
  // could not see one. It reads it now, and still never refuses on it.
  it('--check reads the floor and never refuses on it: a target below it answers state=below-floor, exit 1, nothing written (M3)', () => {
    const home = freshUpdateBox('ccrc-update-floor-check-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check', '--to', 'v2.0.0']);
    expect(r.code).toBe(1);
    expect(checkLine(r.stdout)).toBe(
      `check: box=v3.0.0 sha=oldsha0000000000000000000000000000000000 target=v2.0.0 caps=${CAPS_NOW} floor=v3.0.0 projection=not-configured state=below-floor`);
    expect(r.stdout).toMatch(/^this box: v3\.0\.0 \(oldsha[0-9a-f]*\) · target: v2\.0\.0 — below this box's floor v3\.0\.0; update refuses it without --downgrade$/m);
    // A measurement: the refusal's own voice is absent, nothing fetched past
    // SHA256SUMS, nothing backed up, the floor untouched. Fix round 1 item
    // 11 reordered the two die sentences (verdict leads); the negative
    // check follows the new wording.
    expect(r.stderr).not.toMatch(/is below this box's floor|malformed floor|unreadable: .*floor/);
    expect(localUrls(home)).toEqual([`local://${home}/releases/download/v2.0.0/SHA256SUMS`]);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v3.0.0\n');
  });

  it('below-floor is strict and covers every non-current state: floor == target reads behind; an unversioned box below the floor reads below-floor; a box already current stays current (M3)', () => {
    const equal = freshUpdateBox('ccrc-update-floor-check-equal-');
    plantOldBox(equal, { version: 'v1.0.0' });
    plantFloor(equal, 'v2.0.0');
    packRelease(equal, stubTree(equal, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    expect(parseCheck(runUpdate(equal, ['--check', '--to', 'v2.0.0']).stdout).state).toBe('behind');

    const unversioned = freshUpdateBox('ccrc-update-floor-check-unversioned-');
    plantOldBox(unversioned);
    plantFloor(unversioned, 'v3.0.0');
    packRelease(unversioned, stubTree(unversioned, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    expect(parseCheck(runUpdate(unversioned, ['--check', '--to', 'v2.0.0']).stdout)).toMatchObject({ box: 'unversioned', state: 'below-floor' });

    const current = freshUpdateBox('ccrc-update-floor-check-current-');
    plantOldBox(current, { version: 'v2.0.0' });
    writeFileSync(join(current, '.ccrc', 'installed'), 'oldsha0000000000000000000000000000000000\n');
    plantFloor(current, 'v3.0.0');
    packRelease(current, stubTree(current, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(current, ['--check', '--to', 'v2.0.0']);
    expect(r.code, r.stderr).toBe(0);
    expect(parseCheck(r.stdout)).toMatchObject({ floor: 'v3.0.0', state: 'current' });
  });

  // Fix round 1 item 17 / review 155 C28 (your Q2): a converged no-op moves
  // nothing, so the floor has nothing to guard — `cmd_update`'s converged
  // no-op check now precedes its floor check. The review's own fixture: a
  // box on v1.0.0 with a completed record (an automatic arm-2 restore's
  // aftermath, say — the failed v2.0.0 install had already raised the floor
  // before it was backed out), floor v2.0.0, target resolving to v1.0.0. A
  // plain `ccrc update` must read this as "nothing to do", not `failed`; the
  // floor itself is never lowered by a no-op (D-3136's own principle: the
  // floor only rises).
  it('a converged box below its own raised floor is still a no-op, exit 0, never `failed` (fix round 1 item 17 / review 155 C28, your Q2)', () => {
    const home = freshUpdateBox('ccrc-update-floor-converged-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    plantFloor(home, 'v2.0.0');
    // selfConvergedTree: the staged tree's OWN sha is made to match the
    // box's running stamp — `_upd_converged`'s real (three-way) comparison,
    // which this run must actually satisfy now that it runs BEFORE the
    // floor, not a shortcut that skips the fetch.
    packRelease(home, selfConvergedTree(home, 'v1.0.0', OLD_SHA), { tag: 'v1.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: this box already runs v1\.0\.0 \(\S+\) and that install completed — nothing to do \(pass --force to reinstall\)$/m);
    expect(r.stdout).not.toMatch(/is below this box's floor/);
    expect(r.stderr).toBe('');
    const rep = JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
    expect(rep['phase']).toBe('done');
    expect(rep['detail']).toBe('already converged at v1.0.0');
    // The floor is never lowered by a no-op — D-3136's own principle,
    // restated by this task's ruling ("do not change when the floor is
    // raised").
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v2.0.0\n');
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });
});

// ── update.json (design 2026-09-20 §10) — the node's report ───────────────
/** Every report `_upd_phase` placed, in order: the recording `mv` in
 *  `updateEnv` appends the staged file's line each time its destination is
 *  `~/.ccrc/update.json`, so each entry here arrived by rename. */
const reportWrites = (home: string): Array<Record<string, unknown>> =>
  (existsSync(join(home, 'update-json-writes'))
    ? readFileSync(join(home, 'update-json-writes'), 'utf8').split('\n').filter((l) => l !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    : []);
const lastReport = (home: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
/** The seven keys, in the writer's order (D-3237 adds `pid`). */
const REPORT_KEYS = ['target', 'phase', 'startedAt', 'updatedAt', 'detail', 'from', 'pid'];
/** The report's clock: unix SECONDS (`date +%s` on `_upd_phase`'s `now=`
 *  line) — the unit W2's `reportFrom` reads, converting once to ms and
 *  nulling anything above `UNIX_SECONDS_MAX` (a 13-digit ms stamp). Ten
 *  digits until the year 2286. */
const REPORT_TIME = /^\d{10}$/;

describe('ccrc update: update.json at every phase, and --from (design §10)', () => {
  // W2's L0 array, not a hand copy of spec §6 (W4a Task 15): the phases this
  // writer must produce are the ones the console's reader knows, by
  // construction. `unknown` is the READER's word for a report it cannot
  // parse; no writer ever writes it.
  const WRITTEN_PHASES = UPDATE_PHASES.filter((p) => p !== 'unknown');
  // `queued` is written only by `--detach`, which macOS refuses (decision 17),
  // so on Darwin it can never be written. Kept apart from PENDING because Task 6
  // deletes PENDING, and this set must outlive it.
  const DARWIN_UNREACHABLE = new Set<string>(process.platform === 'darwin' ? ['queued'] : []);
  const phases = (home: string): string[] => reportWrites(home).map((w) => String(w['phase']));
  const plantFloor = (home: string, v: string): void => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'floor'), `${v}\n`);
  };

  it('a moving run, a converged no-op and a refusal together write every wired phase, each by rename, seven keys in order (§18 "update.json at every phase")', () => {
    // 1. A run that moves the box (STUB flavour: update's own logic).
    const moved = freshUpdateBox('ccrc-update-json-moved-');
    plantOldBox(moved, { version: 'v1.0.0' });
    packRelease(moved, stubTree(moved, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    let r = runUpdate(moved);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // W4 Task 5: the gate writes `checking` BEFORE the sweep's `restarting`
    // (design §11 — the gate precedes the sweep; nothing reads the order).
    expect(phases(moved)).toEqual(['resolving', 'fetching', 'verifying', 'backing-up', 'installing', 'checking', 'restarting', 'done']);

    // 2. The converged no-op (the "already there" gate's three shas agree).
    const same = freshUpdateBox('ccrc-update-json-same-');
    plantOldBox(same, { version: 'v2.0.0' });
    writeFileSync(join(same, '.ccrc', 'build.json'),
      shippedStamp('v2.0.0', 'newsha0000000000000000000000000000000000'));
    writeFileSync(join(same, '.ccrc', 'installed'), 'newsha0000000000000000000000000000000000\n');
    packRelease(same, stubTree(same, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    r = runUpdate(same);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(phases(same)).toEqual(['resolving', 'fetching', 'verifying', 'done']);
    expect(lastReport(same)['detail']).toBe('already converged at v2.0.0');

    // 3. A refusal after the lock: a die is a `failed` report.
    const refused = freshUpdateBox('ccrc-update-json-refused-');
    plantOldBox(refused, { version: 'v1.0.0' });
    packRelease(refused, stubTree(refused, { version: 'v2.0.0' }), { tag: 'v2.0.0', bundle: false });
    r = runUpdate(refused);
    expect(r.code).toBe(1);
    expect(phases(refused)).toEqual(['resolving', 'fetching', 'verifying', 'failed']);

    // 4. A detached parent (W4 Task 3): `queued`, written before the spawn and
    //    nothing after it. The recorder stands in for systemd-run.
    const detached = freshUpdateBox('ccrc-update-json-detached-');
    plantOldBox(detached, { version: 'v1.0.0' });
    r = runUpdate(detached, ['--detach', '--to', 'v2.0.0']);
    if (process.platform === 'darwin') {
      expect(r.code).toBe(1);
      expect(phases(detached)).toEqual([]);
    } else {
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(phases(detached)).toEqual(['queued']);
    }

    // Task 6: the automatic restore writes the last two phases, `restoring`
    // and `reverted` (a gate that fails on the OLD /health version, arm 2).
    const restoreHome = freshUpdateBox('ccrc-update-json-restore-');
    plantRestoreBox(restoreHome);
    r = runUpdate(restoreHome);
    expect(r.code, `the restore fixture must reach _upd_restore — stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);

    const written = new Set([...phases(moved), ...phases(same), ...phases(refused), ...phases(detached), ...phases(restoreHome)]);
    expect(written.has('unknown'), 'a writer wrote the reader\'s word').toBe(false);
    expect([...new Set([...written, ...DARWIN_UNREACHABLE])].sort()).toEqual([...WRITTEN_PHASES].sort());

    for (const home of [moved, same, refused, restoreHome, ...(process.platform === 'darwin' ? [] : [detached])]) {
      const raw = readFileSync(join(home, 'update-json-writes'), 'utf8').split('\n').filter((l) => l !== '');
      for (const l of raw) expect(Object.keys(JSON.parse(l) as object)).toEqual(REPORT_KEYS);
      // The file on disk IS the last rename, and no staged copy is left beside it.
      expect(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')).toBe(`${raw[raw.length - 1]}\n`);
      expect(readdirSync(join(home, '.ccrc')).filter((f) => f.startsWith('update.json.'))).toEqual([]);
    }
  });

  it('the report names the target once resolved, carries ONE startedAt and a non-decreasing updatedAt in unix seconds, `from` cli by default, and the run\'s pid', () => {
    const home = freshUpdateBox('ccrc-update-json-fields-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    // The test's own clock around the spawn, in seconds: the report's times
    // are THIS instant in THIS unit, not merely ten digits.
    const t0 = Math.floor(Date.now() / 1000);
    const r = runUpdate(home);
    const t1 = Math.ceil(Date.now() / 1000);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const w = reportWrites(home);
    // W4 Task 5: the gate's `checking` is the eighth report; the order and
    // the count are pinned together, so neither can drift alone.
    expect(w.map((x) => x['phase'])).toEqual(['resolving', 'fetching', 'verifying', 'backing-up', 'installing', 'checking', 'restarting', 'done']);
    // latest/download: nothing names a tag until SHA256SUMS has been read.
    expect(w[0]!['phase']).toBe('resolving');
    expect(w[0]!['target']).toBeNull();
    for (const x of w.slice(1)) expect(x['target']).toBe('v2.0.0');
    expect(new Set(w.map((x) => x['startedAt'])).size).toBe(1);
    expect(new Set(w.map((x) => x['pid'])).size).toBe(1);
    let prev = 0;
    for (const x of w) {
      expect(String(x['startedAt'])).toMatch(REPORT_TIME);
      expect(String(x['updatedAt'])).toMatch(REPORT_TIME);
      expect(Number(x['startedAt'])).toBeGreaterThanOrEqual(t0);
      expect(Number(x['updatedAt'])).toBeLessThanOrEqual(t1);
      expect(Number(x['updatedAt'])).toBeGreaterThanOrEqual(Math.max(prev, Number(x['startedAt'])));
      prev = Number(x['updatedAt']);
      expect(x['from']).toBe('cli');
      expect(Number.isInteger(x['pid'])).toBe(true);
      expect(x['detail']).toBeNull();   // no phase of a clean run carries one
    }
  });

  it('--from <word> and --from=<word> reach `from`; --to names the target from the first phase on', () => {
    const home = freshUpdateBox('ccrc-update-json-from-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    let r = runUpdate(home, ['--to', 'v2.0.0', '--from', 'pwa']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    let w = reportWrites(home);
    expect(w.length).toBeGreaterThan(0);
    for (const x of w) { expect(x['from']).toBe('pwa'); expect(x['target']).toBe('v2.0.0'); }
    const eq = freshUpdateBox('ccrc-update-json-from-eq-');
    plantOldBox(eq, { version: 'v1.0.0' });
    packRelease(eq, stubTree(eq, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    r = runUpdate(eq, ['--from=rollout']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    w = reportWrites(eq);
    for (const x of w) expect(x['from']).toBe('rollout');
  });

  const BAD_FROM: Array<[string[], RegExp]> = [
    [['--from', 'operator'], /^ccrc: --from expects one of cli pwa restore rollback watchdog rollout \(got: operator\)$/m],
    [['--from=CLI'], /^ccrc: --from expects one of cli pwa restore rollback watchdog rollout \(got: CLI\)$/m],
    [['--from'], /^ccrc: --from needs a value: one of cli pwa restore rollback watchdog rollout$/m],
  ];
  it.each(BAD_FROM)('%s is a usage error: exit 2, usage printed, nothing fetched, nothing reported (D-3228)', (args, msg) => {
    const home = freshUpdateBox('ccrc-update-json-badfrom-');
    const r = runUpdate(home, args);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(msg);
    expect(r.stderr).toMatch(/usage: ccrc \{/);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('--check and --from are exclusive — D-3139\'s shape: exit 2, nothing fetched, nothing reported', () => {
    const home = freshUpdateBox('ccrc-update-json-check-from-');
    const r = runUpdate(home, ['--check', '--from', 'pwa']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: update: --check and --from are exclusive — --check measures and writes nothing, --from attributes a run that moves this box; pick one$/m);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('a verdict on the RELEASE is reported `provenance: …` — the absent bundle and the failing one; a verifier that could not RUN is not (spec §8, D-3239)', () => {
    const detailOf = (home: string): string => {
      const rep = lastReport(home);
      expect(rep['phase']).toBe('failed');
      const d = String(rep['detail']);
      expect(d.length).toBeLessThanOrEqual(200);
      expect(d).toMatch(/^[ -~]*$/);
      return d;
    };
    const absent = freshUpdateBox('ccrc-update-json-prov-absent-');
    plantOldBox(absent, { version: 'v1.0.0' });
    packRelease(absent, stubTree(absent, { version: 'v2.0.0' }), { tag: 'v2.0.0', bundle: false });
    expect(runUpdate(absent).code).toBe(1);
    expect(detailOf(absent)).toMatch(/^provenance: the release ships no provenance bundle /);

    const failing = freshUpdateBox('ccrc-update-json-prov-fail-');
    plantOldBox(failing, { version: 'v1.0.0' });
    packRelease(failing, stubTree(failing, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(failing, 'fixture-verify-exit'), '1\n');
    expect(runUpdate(failing).code).toBe(1);
    expect(detailOf(failing)).toMatch(/^provenance: provenance verification FAILED for ccrc-v2\.0\.0\.tar\.gz /);

    // A node fault, not a verdict: W2's sweep must NOT turn it into this
    // node's refusal of a good release.
    const norun = freshUpdateBox('ccrc-update-json-prov-norun-');
    plantOldBox(norun, { version: 'v1.0.0' });
    packRelease(norun, stubTree(norun, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(norun, 'fixture-verify-exit'), '127\n');
    expect(runUpdate(norun).code).toBe(1);
    const d = detailOf(norun);
    expect(d).toMatch(/^could not RUN the installed verifier /);
    expect(d).not.toMatch(/^provenance:/);
  });

  // D-3284 (final review, B2, I-2): a MEASURED non-404 status on the bundle
  // fetch (a 503, a 403 rate limit) is a transient node fault, not "this
  // release ships no bundle" — it must NOT carry `UPD_FAIL_PREFIX`, or W2's
  // sweep (`startsWith('provenance:')`) turns a passing release, from a
  // release host that merely blipped, into a lasting per-node refusal
  // (D-3239). Only a MEASURED 404 keeps the prefix — pinned unchanged below.
  it.each([['503'], ['403']])('a bundle fetch answering a measured %s is a transient fetch failure, never "provenance: " — exit 1, the status is named (D-3284)', (status) => {
    const detailOf = (home: string): string => {
      const rep = lastReport(home);
      expect(rep['phase']).toBe('failed');
      return String(rep['detail']);
    };
    const home = freshUpdateBox(`ccrc-update-json-prov-http${status}-`);
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-bundle-http'), `${status}\n`);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    const d = detailOf(home);
    expect(d).not.toMatch(/^provenance:/);
    // Verdict-first (D-3284): "not a verdict on this release" leads, so it
    // survives the 200-character cut even with a long release URL.
    expect(d).toMatch(/^a transient fetch failure \(curl exit 22, HTTP \d+, not a 404\) fetching the provenance bundle - not a verdict on this release:/);
    expect(r.stderr).toMatch(new RegExp(`a transient fetch failure \\(curl exit 22, HTTP ${status}, not a 404\\) fetching the provenance bundle — not a verdict on this release: .*sigstore\\.json`));
    // --allow-unsigned does not turn a transient fault into "absence" either.
    const withFlag = freshUpdateBox(`ccrc-update-json-prov-http${status}-flag-`);
    plantOldBox(withFlag, { version: 'v1.0.0' });
    packRelease(withFlag, stubTree(withFlag, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(withFlag, 'fixture-bundle-http'), `${status}\n`);
    const r2 = runUpdate(withFlag, ['--allow-unsigned']);
    expect(r2.code, `stderr: ${r2.stderr}`).toBe(1);
    expect(detailOf(withFlag)).not.toMatch(/^provenance:/);
  });

  // 404 keeps its ORIGINAL behaviour: unchanged, still `provenance: `-prefixed,
  // still admitted under --allow-unsigned — the D-3284 fix narrows what
  // COUNTS as absence, it does not touch the 404 arm itself.
  it('a bundle fetch answering a measured 404 is unchanged: `provenance: `-prefixed, admitted only with --allow-unsigned (D-3284)', () => {
    const refused = freshUpdateBox('ccrc-update-json-prov-http404-refused-');
    plantOldBox(refused, { version: 'v1.0.0' });
    packRelease(refused, stubTree(refused, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(refused, 'fixture-bundle-http'), '404\n');
    const r = runUpdate(refused);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(String(lastReport(refused)['detail'])).toMatch(/^provenance: the release ships no provenance bundle /);
    expect(r.stderr).toMatch(/the release ships no provenance bundle .*answered 404.*installs only with --allow-unsigned/);

    const admitted = freshUpdateBox('ccrc-update-json-prov-http404-admitted-');
    plantOldBox(admitted, { version: 'v1.0.0' });
    packRelease(admitted, stubTree(admitted, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(admitted, 'fixture-bundle-http'), '404\n');
    const r2 = runUpdate(admitted, ['--allow-unsigned']);
    expect(r2.code, `stderr: ${r2.stderr}`).toBe(0);
    expect(r2.stdout).toMatch(/WARN: .*sigstore\.json is absent \(the release host answered 404\)/);
  });

  it('a detail is printable ASCII, at most 200 characters, cut BEFORE it is escaped: a die naming a hostile URL arrives exactly', () => {
    // CCRC_RELEASE_BASE_URL is the one knob that puts arbitrary bytes into a
    // die sentence: `_upd_resolve`'s "download failed: <url>/SHA256SUMS …".
    // Position by position: "download failed: " (17) + "local://" (8) +
    // `é` — two UTF-8 bytes, two `?` — + `"` + `q` + `\` = 30, then 170 of
    // the 300 x's reach the 200-character cut, which runs before the two
    // escapes, so no escape is ever split.
    const home = freshUpdateBox('ccrc-update-json-detail-');
    const r = runUpdate(home, [], { CCRC_RELEASE_BASE_URL: `local://é"q\\${'x'.repeat(300)}` });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/download failed: local:\/\//);
    const rep = lastReport(home);
    expect(rep['phase']).toBe('failed');
    expect(rep['detail']).toBe(`download failed: local://??"q\\${'x'.repeat(170)}`);
  });

  it('a report that cannot be written is a WARN line per phase and the update still completes — a directory squatting on the name is refused, never moved INTO', () => {
    const home = freshUpdateBox('ccrc-update-json-unwritable-');
    plantOldBox(home, { version: 'v1.0.0' });
    mkdirSync(join(home, '.ccrc', 'update.json'), { recursive: true });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: WARN: could not write ~\/\.ccrc\/update\.json \(phase resolving\) — the console will not see this phase; the update continues$/m);
    expect(r.stdout).toMatch(/^update: WARN: could not write ~\/\.ccrc\/update\.json \(phase done\) — /m);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the update stopped for its report').toBe(true);
    expect(readdirSync(join(home, '.ccrc', 'update.json'))).toEqual([]);
    expect(readdirSync(join(home, '.ccrc')).filter((f) => f.startsWith('update.json.'))).toEqual([]);
  });

  it('--from restore|rollback|watchdog typed BY HAND on the update verb are all refused, exit 2, before anything is fetched — naming the verb to use (fix round 1 item 10 / review 155 C16, amends D-3257); --from pwa is refused by W1\'s sentence (spec §9)', () => {
    // The three CALLER words: `restore` (D-3257, unchanged), and now
    // `rollback`/`watchdog` too — each is spoken only by its one real
    // caller (`_upd_restore_arm2`'s child; `cmd_rollback`'s own in-process
    // call), never by an operator's hand-typed `ccrc update --from …`. Their
    // real WARN-below-the-floor behaviour is measured on the REAL caller,
    // not here: `restore`'s in Task 6's FULL restore case, `rollback`'s in
    // "bare `ccrc rollback` returns to previous…", `watchdog`'s in
    // "`ccrc rollback --from watchdog` — the REAL in-process path…".
    for (const from of ['restore', 'rollback', 'watchdog']) {
      const home = freshUpdateBox(`ccrc-update-json-floor-${from}-`);
      plantOldBox(home, { version: 'v3.0.0' });
      plantFloor(home, 'v3.0.0');
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
      const r = runUpdate(home, ['--to', 'v2.0.0', '--from', from]);
      expect(r.code, `${from} — stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
      if (from === 'restore') {
        expect(r.stderr).toMatch(/--from restore is the automatic restore's own word .* ccrc update --to <tag> --downgrade/);
      } else {
        expect(r.stderr).toMatch(new RegExp(`--from ${from} is ccrc rollback's own word .* ccrc rollback --to <tag>`));
      }
      expect(existsSync(join(home, 'curl-argv')), `${from}: a fetch ran before the refusal`).toBe(false);
      expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v3.0.0\n');
      expect(existsSync(join(home, 'staged-ccrc-argv')), `${from}: something was staged before the refusal`).toBe(false);
    }
    const pwa = freshUpdateBox('ccrc-update-json-floor-pwa-');
    plantOldBox(pwa, { version: 'v3.0.0' });
    plantFloor(pwa, 'v3.0.0');
    packRelease(pwa, stubTree(pwa, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(pwa, ['--to', 'v2.0.0', '--from', 'pwa']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/v2\.0\.0 \(resolved by --to v2\.0\.0\) is below this box's floor v3\.0\.0 .* ccrc update --to v2\.0\.0 --downgrade/);
    expect(existsSync(join(pwa, 'ccrc-backups'))).toBe(false);
    expect(lastReport(pwa)['phase']).toBe('failed');
  });

  // Fix round 1 item 10 / review 155 C16 — spoofing: neither door opens for
  // an EXPORTED marker of the same name (the value it would have to guess
  // is a pid that does not exist yet), and `_upd_lock`'s own $PPID-matching
  // for `restore` needs the SAME kind of externally-unknowable value.
  it('the process-local caller markers cannot be spoofed by exporting a variable of the same name (fix round 1 item 10 / review 155 C16)', () => {
    const home = freshUpdateBox('ccrc-update-json-floor-spoof-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    for (const [from, marker, value] of [
      ['rollback', 'UPD_FROM_CALLER_PID', '1'] as const,
      ['watchdog', 'UPD_FROM_CALLER_PID', '1'] as const,
      ['restore', 'CCRC_UPDATE_LOCK_HELD', '1'] as const,
    ]) {
      const r = runUpdate(home, ['--to', 'v2.0.0', '--from', from], { [marker]: value });
      expect(r.code, `${from}/${marker} — stderr: ${r.stderr}`).toBe(2);
      expect(existsSync(join(home, 'curl-argv')), `${from}: a fetch ran before the refusal`).toBe(false);
    }
  });

  // Review fix round 1, I2: the value `1` alone is not the real attack —
  // `exec` KEEPS THE PID, so a forger who controls the exec chain can
  // compute the RIGHT value (their own `$$`, which becomes the eventual
  // `ccrc update` process's own `$$` too) and export it in ahead of time.
  // The measured repro: `sh -c 'UPD_FROM_CALLER_PID=$$ exec bash "$0"
  // update … --from rollback' <ccrc>`. The file-scope `unset
  // UPD_FROM_CALLER_PID` (I2's fix, in the globals block) must still
  // refuse it — nothing on this box changed.
  it('the exec-preserved-pid forgery is still refused: `sh -c \'UPD_FROM_CALLER_PID=$$ exec bash "$0" update … --from rollback\'` (review fix round 1 I2)', () => {
    const home = freshUpdateBox('ccrc-update-json-floor-exec-forge-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const env = updateEnv(home);
    replantDoctorStubs(home);
    const ccrc = join(REPO, 'ccd', 'ccrc');
    const script = 'UPD_FROM_CALLER_PID=$$ exec bash "$0" update --to v2.0.0 --from rollback';
    const r = spawnSync(BASH, ['-c', script, ccrc], { env, encoding: 'utf8' });
    expect(r.status, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toMatch(/--from rollback is ccrc rollback's own word/);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
  });

  it('_ccrc_die reports `failed` only once the run is reporting, only from the run\'s own shell, with the prefix in front (the one hook)', () => {
    // `ccrc-install.test.ts:4133`'s idiom: the ONE-LINE definition extracted
    // from the shipped file and run alone, `_upd_phase` shadowed by a recorder.
    // Fix round 1 item 11 / review 155 C17: `_ccrc_die` now calls
    // `_upd_redact` (a multi-line function, extracted by its own block regex,
    // never a one-liner), so this harness must pick that definition up too —
    // without it, `_ccrc_die`'s body hits "_upd_redact: command not found"
    // rather than the sentence this test means to measure.
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const progLine = /^PROG=.*$/m.exec(src);
    const redactBlock = /^_upd_redact\(\) \{[\s\S]*?\n\}$/m.exec(src);
    const dieLine = /^_ccrc_die\(\) \{.*\}$/m.exec(src);
    expect(progLine, 'ccd/ccrc has no PROG=').not.toBeNull();
    expect(redactBlock, 'ccd/ccrc has no _upd_redact block').not.toBeNull();
    expect(dieLine, 'ccd/ccrc has no one-line _ccrc_die').not.toBeNull();
    const home = mkTmp('ccrc-update-die-hook-');
    const rec = join(home, 'phase-calls');
    const run = (body: string): Result => {
      const p = spawnSync(BASH, ['-c', [
        'set -uo pipefail', progLine![0], redactBlock![0], dieLine![0],
        `_upd_phase() { printf '%s|%s\\n' "$1" "$2" >> '${rec}'; }`,
        'UPD_FAIL_PREFIX=""', body,
      ].join('\n')], { encoding: 'utf8' });
      return { code: p.status ?? -1, stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
    };
    let r = run('UPD_REPORTING=0; _ccrc_die before the lock');
    expect(r.code).toBe(1);
    expect(existsSync(rec), 'a die before the run reports wrote a report').toBe(false);
    r = run('UPD_REPORTING=1; x="$(_ccrc_die inside a command substitution)"; echo "survived:$?"');
    expect(r.stdout).toMatch(/^survived:1$/m);
    expect(existsSync(rec), 'a subshell\'s die reported the RUN as failed').toBe(false);
    r = run('UPD_REPORTING=1; UPD_FAIL_PREFIX="provenance: "; _ccrc_die the release failed');
    expect(r.code).toBe(1);
    expect(r.stderr).toBe('ccrc: the release failed\n');
    expect(readFileSync(rec, 'utf8')).toBe('failed|provenance: the release failed\n');
  });

  // Fix round 1 item 11 / review 155 C17: `_upd_redact` itself, extracted
  // and called directly — a normal URL (no userinfo) and an unrelated '@'
  // past the authority (a query string) pass through BYTE FOR BYTE, never
  // mangled by a redaction that is too eager; a credentialed one loses only
  // the userinfo; the home directory becomes `~`, literally (not the
  // process's real $HOME re-expanded through the replacement side of a
  // bash substitution — the exact bug this fix's own first draft shipped,
  // measured: `${s//"$HOME"/~}` is a silent no-op, because a bare `~` on
  // the REPLACEMENT side of `${..//pattern/string}` undergoes tilde
  // expansion to the CURRENT $HOME before it is ever used as a literal).
  it('_upd_redact: a normal URL passes through unchanged, a credentialed one loses only the userinfo, and HOME becomes a literal ~ (fix round 1 item 11 / review 155 C17)', () => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const redactBlock = /^_upd_redact\(\) \{[\s\S]*?\n\}$/m.exec(src);
    expect(redactBlock, 'ccd/ccrc has no _upd_redact block').not.toBeNull();
    const home = mkTmp('ccrc-update-redact-unit-');
    const call = (text: string): string => {
      const p = spawnSync('bash', ['-c', [redactBlock![0], '_upd_redact "$1"'].join('\n'), '_', text],
        { env: { HOME: home }, encoding: 'utf8' });
      expect(p.status, p.stderr).toBe(0);
      return p.stdout;
    };
    // No userinfo: byte for byte, including a query-string '@' past the
    // authority (the comment above `_upd_redact`'s own strip states this).
    const plain = 'https://github.com/Synapsium-Labs/ccrc-pwa/releases/download/v1.0.0/SHA256SUMS';
    expect(call(plain)).toBe(plain);
    const withQueryAt = 'https://example.com/path?email=a@example.com&x=1';
    expect(call(withQueryAt)).toBe(withQueryAt);
    // Userinfo stripped, host and path untouched.
    expect(call('http://user:s3cretTOKEN@127.0.0.1:1/rel/download/v0.0.1/SHA256SUMS'))
      .toBe('http://127.0.0.1:1/rel/download/v0.0.1/SHA256SUMS');
    // HOME becomes a LITERAL tilde character, not the redaction's own
    // process $HOME re-expanded back in.
    expect(call(`${home}/.ccrc/floor`)).toBe('~/.ccrc/floor');
  });

  // Review fix round 1, M6: the OLD blind substring replace was not
  // anchored to a path boundary — HOME=/home/u turned /home/user2/f into
  // ~ser2/f (a bare PREFIX match), and a trailing-slash HOME turned
  // /home/u/.ccrc into ~.ccrc (the separating '/' consumed along with
  // HOME). Fixed: a trailing slash is stripped from HOME first; HOME of
  // '/' (or empty) is then skipped entirely; what remains is replaced only
  // where it is followed by '/' or ends a token. And N2: the userinfo
  // class excludes '?' and '#' too, so an authority with no '/' at all is
  // never collapsed.
  it('_upd_redact: HOME is anchored to a path boundary — HOME=/, a trailing-slash HOME, and a prefix that is not a real match (review fix round 1 M6, N2)', () => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const redactBlock = /^_upd_redact\(\) \{[\s\S]*?\n\}$/m.exec(src);
    expect(redactBlock, 'ccd/ccrc has no _upd_redact block').not.toBeNull();
    const callWithHome = (text: string, home: string): string => {
      const p = spawnSync('bash', ['-c', [redactBlock![0], '_upd_redact "$1"'].join('\n'), '_', text],
        { env: { HOME: home }, encoding: 'utf8' });
      expect(p.status, p.stderr).toBe(0);
      return p.stdout;
    };
    // HOME=/ replaces NOTHING — the old code turned every '/' in the
    // sentence into '~', garbling a plain URL.
    expect(callWithHome('cmd http://h/p', '/')).toBe('cmd http://h/p');
    // A trailing-slash HOME behaves exactly like the same HOME without one.
    expect(callWithHome('/home/u/.ccrc/floor', '/home/u/')).toBe('~/.ccrc/floor');
    expect(callWithHome('/home/u/.ccrc/floor', '/home/u')).toBe('~/.ccrc/floor');
    // /home/u is a PREFIX of /home/user2, never a path-boundary match.
    expect(callWithHome('/home/user2/f', '/home/u')).toBe('/home/user2/f');
    // The true path IS still replaced, followed by '/', a quote, ':', ')',
    // or the end of the string.
    expect(callWithHome('/home/u/f', '/home/u')).toBe('~/f');
    expect(callWithHome('path "/home/u" here', '/home/u')).toBe('path "~" here');
    expect(callWithHome('PATH=/home/u:/usr/bin', '/home/u')).toBe('PATH=~:/usr/bin');
    expect(callWithHome('(cd /home/u)', '/home/u')).toBe('(cd ~)');
    expect(callWithHome('/home/u', '/home/u')).toBe('~');
    // N2: an authority with no '/' before the credential — a query string
    // ('?') or a fragment ('#') ending it instead — is left unchanged,
    // never collapsed into `scheme://host`.
    expect(callWithHome('https://h?a@b', '')).toBe('https://h?a@b');
    expect(callWithHome('https://h#a@b', '')).toBe('https://h#a@b');
  });

  // W6 Task 8A, review 167's F5 (cosmetic): the boundary BEFORE HOME. The
  // review's record of its three shapes is not in the tree, so these are the
  // three ways a HOME that is a SUFFIX of a longer path is met, one per
  // boundary AFTER it that already worked (`/`, `:`, end of string) — each
  // used to become `/srv~…`. The controls are the boundaries BEFORE it that
  // must keep redacting (start, a space, `=`, `:`, a quote, a `file://`).
  it('_upd_redact: HOME is anchored to a path boundary BEFORE it too — `/srv/home/u/x` stays whole, and every real start-of-path still redacts (review 167 F5)', () => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const redactBlock = /^_upd_redact\(\) \{[\s\S]*?\n\}$/m.exec(src);
    expect(redactBlock, 'ccd/ccrc has no _upd_redact block').not.toBeNull();
    const call = (text: string): string => {
      const p = spawnSync('bash', ['-c', [redactBlock![0], '_upd_redact "$1"'].join('\n'), '_', text],
        { env: { HOME: '/home/u' }, encoding: 'utf8' });
      expect(p.status, p.stderr).toBe(0);
      return p.stdout;
    };
    // The three shapes: followed by '/', by ':', and by the end of the string.
    expect(call('/srv/home/u/x')).toBe('/srv/home/u/x');
    expect(call('/srv/home/u:/usr/bin')).toBe('/srv/home/u:/usr/bin');
    expect(call('/srv/home/u')).toBe('/srv/home/u');
    // And one HOME inside a longer path amid a real one: only the real one goes.
    expect(call('/srv/home/u/x and /home/u/y')).toBe('/srv/home/u/x and ~/y');
    // The boundaries before HOME that stay.
    expect(call('/home/u/x')).toBe('~/x');
    expect(call('cd /home/u/x')).toBe('cd ~/x');
    expect(call('K=/home/u/x')).toBe('K=~/x');
    expect(call('/usr/bin:/home/u/bin')).toBe('/usr/bin:~/bin');
    expect(call('"/home/u/x"')).toBe('"~/x"');
    expect(call('file:///home/u/x')).toBe('file://~/x');
  });

  // Fix round 1 item 11 / review 155 C17: a CCRC_RELEASE_BASE_URL carrying
  // userinfo must not reach stdout, stderr or update.json — for `update`
  // AND for `rollback` (two different die sites: `_upd_resolve`'s
  // "download failed: …" and `_upd_asset_listed`'s pre-detach check). A
  // poisoned `curl` (always exit 99, never a real network call, no local://
  // stub in the way) makes every release-host fetch fail immediately and
  // deterministically, so this measures the REAL `_ccrc_die` -> `_upd_redact`
  // path end to end, not a fixture's own text.
  //
  // Review fix round 1, M3: the ROLLBACK half was vacuous with an always-
  // fail curl — `cmd_rollback` dies in `_upd_asset_listed`'s pre-check FIRST
  // (`_upd_asset_listed "$to" SHA256SUMS`, the very first curl call), whose
  // sentence ("could not ask the release host whether … exists") never
  // carries the URL at all, so that half never exercised the credentialed
  // URL reaching a die. Fixed: rollback's curl stub answers the FIRST call
  // (the pre-check) 200 and fails every call after it, so `cmd_rollback`'s
  // in-process `cmd_update` reaches `_upd_resolve`'s OWN SHA256SUMS fetch —
  // a die that DOES carry `$UPD_URL_DIR` — on the second call.
  it('a credentialed CCRC_RELEASE_BASE_URL never reaches stdout, stderr or update.json — update and rollback (fix round 1 item 11 / review 155 C17)', () => {
    const secret = 's3cretTOKEN';
    for (const verb of ['update', 'rollback'] as const) {
      const home = mkTmp(`ccrc-redact-secret-${verb}-`);
      mkdirSync(join(home, '.local', 'bin'), { recursive: true });
      if (verb === 'update') {
        writeFileSync(join(home, '.local', 'bin', 'curl'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
      } else {
        // Succeeds ONCE (the pre-check's -o /dev/null -w '%{http_code}'
        // probe, answered 200), fails every call after — so the second
        // call, `_upd_resolve`'s real SHA256SUMS fetch inside the in-
        // process `cmd_update`, is the one that dies, URL and all.
        writeFileSync(join(home, '.local', 'bin', 'curl'), [
          '#!/bin/sh',
          'n=0; [ -f "$HOME/curl-n" ] && n="$(cat "$HOME/curl-n")"',
          'n=$((n + 1)); echo "$n" > "$HOME/curl-n"',
          '[ "$n" -eq 1 ] || exit 99',
          'dest=""; wfmt=""; prev=""',
          'for a in "$@"; do',
          '  case "$prev" in -o) dest="$a" ;; -w) wfmt="$a" ;; esac',
          '  prev="$a"',
          'done',
          '[ -n "$dest" ] && [ "$dest" != "/dev/null" ] && : > "$dest"',
          '[ -n "$wfmt" ] && printf \'200\'',
          'exit 0',
        ].join('\n'), { mode: 0o755 });
      }
      const env = {
        ...process.env, HOME: home,
        PATH: `${join(home, '.local', 'bin')}:${process.env['PATH'] ?? ''}`,
        CCRC_RELEASE_BASE_URL: `http://user:${secret}@127.0.0.1:1/rel`,
      };
      const args = verb === 'update' ? ['update', '--to', 'v0.0.1'] : ['rollback', '--to', 'v0.0.1', '--from', 'pwa'];
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), ...args], { env, encoding: 'utf8' });
      expect(r.stdout, `${verb} stdout`).not.toContain(secret);
      expect(r.stderr, `${verb} stderr`).not.toContain(secret);
      // A URL-bearing die must actually have fired (M3): "download failed"
      // is `_upd_resolve`'s own sentence, never `_upd_asset_listed`'s.
      expect(r.stderr, `${verb} stderr`).toMatch(/download failed:/);
      const jsonPath = join(home, '.ccrc', 'update.json');
      expect(existsSync(jsonPath), `${verb} wrote no update.json`).toBe(true);
      expect(readFileSync(jsonPath, 'utf8'), `${verb} update.json`).not.toContain(secret);
      // A measurement, not just an absence: something DID fail (the point
      // of this run), so a passing test is not vacuously green.
      expect(r.status, `${verb} must actually have refused`).not.toBe(0);
    }
  });

  // Fix round 1 item 11 / review 155 C17: the floor death's update.json
  // DETAIL keeps its VERDICT (D-3249) even with a HOME long enough that the
  // RAW path alone would have exceeded `_upd_json_str`'s 200-character cut
  // — this is what the review originally measured broken ("<absolute
  // fixture home>/.ccrc/floor is unreada", the verdict word cut off, only
  // the path surviving). Harness-extracted (`_upd_redact`, `_ccrc_die`,
  // `_ver_newer`, `_upd_floor_check`, and `_upd_json_str` itself — the
  // function that actually performs the 200-character cut, never stubbed —
  // so this measures the REAL cut applied to the REAL redacted detail, the
  // same idiom the die-hook test above uses for `_ccrc_die` alone.
  it('a floor death\'s report detail keeps its verdict at the front even with a very long HOME (fix round 1 item 11 / review 155 C17)', () => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const pick = (re: RegExp, what: string): string => {
      const m = re.exec(src);
      expect(m, `ccd/ccrc has no ${what}`).not.toBeNull();
      return m![0];
    };
    const detailOut = join(mkTmp('ccrc-update-floor-longhome-out-'), 'detail.json');
    const harness = [
      'set -uo pipefail',
      pick(/^PROG=.*$/m, 'PROG='),
      pick(/^_upd_redact\(\) \{[\s\S]*?\n\}$/m, '_upd_redact'),
      pick(/^_ccrc_die\(\) \{.*\}$/m, '_ccrc_die'),
      pick(/^_ver_newer\(\) \{[\s\S]*?\n\}$/m, '_ver_newer'),
      pick(/^_upd_floor_check\(\) \{[\s\S]*?\n\}$/m, '_upd_floor_check'),
      // `_upd_json_str` is `_upd_json_str() ( … )`, a subshell, not a `{…}`
      // block — a different close character to extract by.
      pick(/^_upd_json_str\(\) \([\s\S]*?\n\)$/m, '_upd_json_str'),
      // The REAL `_upd_phase` writes several other fields this harness has
      // no use for; only its DETAIL argument, run through the REAL
      // `_upd_json_str`, is what this pin measures.
      `_upd_phase() { _upd_json_str "\$2" > ${JSON.stringify(detailOut)}; }`,
      'UPD_FAIL_PREFIX=""',
      'UPD_REPORTING=1',
      // Batch E review fix round 1, X1: `_ccrc_die` redacts only while
      // `UPD_REDACT_ACTIVE=1`, set at the top of `cmd_update` (and its
      // update-family siblings) in the shipped file — this harness calls
      // `_upd_floor_check` directly, standing in for code that runs INSIDE
      // `cmd_update`, so it sets the same flag `cmd_update`'s own preamble
      // would have set by the time this helper runs.
      'UPD_REDACT_ACTIVE=1',
      'BOX_FLOOR_FILE="$HOME/.ccrc/floor"',
      '_upd_floor_check --to 0 cli',
    ].join('\n');
    // 180 'x's: "unreadable: " (12) + this path + "/.ccrc/floor" (12) would
    // be well over 200 raw; redacted to `~/.ccrc/floor` it is nowhere close.
    const longHome = join(mkTmp('ccrc-update-floor-longhome-'), 'x'.repeat(180));
    mkdirSync(join(longHome, '.ccrc'), { recursive: true });
    writeFileSync(join(longHome, '.ccrc', 'floor'), 'v9.9.9\n');
    chmodSync(join(longHome, '.ccrc', 'floor'), 0o000);
    let r: Result;
    try {
      const p = spawnSync('bash', ['-c', harness],
        { env: { HOME: longHome, UPD_VERSION: 'v2.0.0' }, encoding: 'utf8' });
      r = { code: p.status ?? -1, stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
    } finally {
      chmodSync(join(longHome, '.ccrc', 'floor'), 0o644);
    }
    expect(r.code, r.stderr).toBe(1);
    const detailJson = readFileSync(detailOut, 'utf8');
    expect(detailJson.length, detailJson).toBeLessThanOrEqual(202); // 200 chars + the two quotes
    const detail = JSON.parse(detailJson) as string;
    expect(detail).toMatch(/^unreadable: ~\/\.ccrc\/floor/);
    expect(detail).not.toContain(longHome);
  });

  // Review fix round 1, M1: `_upd_phase` ITSELF, called directly (never
  // through `_ccrc_die`, and with a detail this harness builds RAW — no
  // hand-redaction at any construction site, unlike every existing gate-
  // failure caller). Every current caller already redacts before calling
  // `_upd_phase` (at `$why`/`$gate_fail`'s own construction), so THIS is
  // the pin that isolates `_upd_phase`'s OWN choke point: deleting its
  // `detail="$(_upd_redact "$detail")"` line does not red any existing
  // integration pin (measured on a scratch tree), because every existing
  // caller's detail already arrives clean. This one proves the choke point
  // itself, independent of any caller's own hand-redaction.
  it('_upd_phase redacts its OWN detail argument, independent of any caller (review fix round 1 M1)', () => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const pick = (re: RegExp, what: string): string => {
      const m = re.exec(src);
      expect(m, `ccd/ccrc has no ${what}`).not.toBeNull();
      return m![0];
    };
    const home = mkTmp('ccrc-update-phase-choke-');
    const jsonPath = join(home, '.ccrc', 'update.json');
    const harness = [
      'set -uo pipefail',
      pick(/^_upd_redact\(\) \{[\s\S]*?\n\}$/m, '_upd_redact'),
      pick(/^_upd_json_str\(\) \([\s\S]*?\n\)$/m, '_upd_json_str'),
      // W6 Task 8A: `_upd_phase` guards its temp file on the shared EXIT chain.
      pick(/^_EXIT_CHAIN=\(\)$/m, '_EXIT_CHAIN'),
      pick(/^_exit_run\(\) \{[\s\S]*?\n\}$/m, '_exit_run'),
      pick(/^_exit_add\(\) \{[\s\S]*?\n\}$/m, '_exit_add'),
      pick(/^_tmp_guard\(\) \{.*\}$/m, '_tmp_guard'),
      pick(/^_upd_phase\(\) \{[\s\S]*?\n\}$/m, '_upd_phase'),
      `BOX_UPDATE_JSON=${JSON.stringify(jsonPath)}`,
      'UPD_REPORT_TARGET=""', 'UPD_REPORT_STARTED=""', 'UPD_FROM=cli',
      // The raw detail: never wrapped in _upd_redact by this harness — if
      // `_upd_phase` did not redact it either, the home would land as-is.
      `_upd_phase failed "unreadable: $HOME/.ccrc/ccrc.env is not a regular file"`,
    ].join('\n');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const r = spawnSync('bash', ['-c', harness], { env: { HOME: home }, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const rep = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
    expect(String(rep['detail']), JSON.stringify(rep)).not.toContain(home);
    expect(rep['detail']).toBe('unreadable: ~/.ccrc/ccrc.env is not a regular file');
  });
});

describe('ccrc update: one update at a time (the lock)', () => {
  const holders: ChildProcess[] = [];
  const lingerers: string[] = [];   // pid files a lingering fixture process wrote
  afterEach(() => {
    for (const h of holders.splice(0)) h.kill('SIGKILL');
    for (const f of lingerers.splice(0)) {
      if (!existsSync(f)) continue;
      // Guarded: `process.kill(0, …)` signals this whole process GROUP — the
      // test runner included — so an empty or garbled pid file kills nothing.
      const pid = Number(readFileSync(f, 'utf8').trim());
      if (!Number.isInteger(pid) || pid <= 1) continue;
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  });
  const lockPath = (home: string): string => join(home, '.ccrc', 'update.lock');
  /** A FRESH open and a non-blocking flock — the probe's own measurement. */
  const lockFree = (home: string): boolean =>
    spawnSync(BASH, ['-c', 'exec 9>>"$1" && flock -n 9', '_', lockPath(home)]).status === 0;
  const waitUntil = (cond: () => boolean, what: string): void => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > 10_000) throw new Error(`timed out waiting for ${what}`);
      spawnSync('sleep', ['0.05']);
    }
  };
  /** A real holder: ONE process takes flock on the lock file and then
   *  becomes `sleep` (exec keeps the pid and the descriptor), so the pid
   *  killed is the pid holding it. Returns once a fresh probe fails. */
  const holdLock = (home: string): ChildProcess => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const h = spawn(BASH, ['-c', 'exec 9>>"$1" && flock 9 && exec sleep 30', '_', lockPath(home)], { stdio: 'ignore' });
    holders.push(h);
    waitUntil(() => !lockFree(home), 'the fixture holder to take the lock');
    return h;
  };
  // A holder's report in the writer's own shape: unix SECONDS (rulings R1,
  // R14 — Task 1's `REPORT_TIME`), the seven keys in order.
  const HELD_REPORT = '{"target":"v9.9.9","phase":"installing","startedAt":1758585600,'
    + '"updatedAt":1758585601,"detail":null,"from":"pwa","pid":4242}\n';
  const stubBox = (prefix: string): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    return home;
  };

  it('a second run while the lock is held exits 1 naming the holder from update.json and touches NOTHING — update.json included; with the holder gone the identical run proceeds (§18 "one update at a time")', () => {
    const home = stubBox('ccrc-update-lock-held-');
    writeFileSync(join(home, '.ccrc', 'update.json'), HELD_REPORT);
    const h = holdLock(home);
    let r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: another update holds ~\/\.ccrc\/update\.lock \(pid 4242, target v9\.9\.9\)$/m);
    // A refused run reports nothing: the holder's report is the holder's.
    expect(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')).toBe(HELD_REPORT);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran under someone else\'s lock').toBe(false);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    // THE CONTROL: the same box, the same argv, the holder gone.
    h.kill('SIGKILL');
    waitUntil(() => lockFree(home), 'the killed holder to let go');
    r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(lastReport(home)['phase']).toBe('done');
  });

  it('the holder reads "unknown" for each field that is absent, not JSON, or of the wrong type or shape — each field judged on its own, nothing raw from the file printed', () => {
    const cases: Array<[string, string | null, string]> = [
      ['absent', null, 'pid unknown, target unknown'],
      ['not-json', 'garbage {\n', 'pid unknown, target unknown'],
      ['bad-fields', '{"pid":"4242; echo pwned","target":"latest; pwned"}\n', 'pid unknown, target unknown'],
      // The field-alignment pins: a split that ran BEFORE the fields were
      // typed let one field's value land in the other's slot.
      ['pid-null', '{"pid":null,"target":"v9.9.9"}\n', 'pid unknown, target v9.9.9'],
      ['pid-string', '{"pid":"4242 v1.2.3","target":"x"}\n', 'pid unknown, target unknown'],
      ['target-newline', '{"pid":4242,"target":"v1.0.0\\nv2"}\n', 'pid 4242, target unknown'],
    ];
    for (const [name, body, holder] of cases) {
      const home = freshUpdateBox(`ccrc-update-lock-holder-${name}-`);
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      if (body !== null) writeFileSync(join(home, '.ccrc', 'update.json'), body);
      holdLock(home);
      const r = runUpdate(home);
      expect(r.code, name).toBe(1);
      expect(r.stderr.split('\n'), name)
        .toContain(`ccrc: update: another update holds ~/.ccrc/update.lock (${holder})`);
      expect(r.stderr, name).not.toMatch(/pwned/);
    }
  });

  // Fix round 1 item 23-C21: `_upd_lock_holder`'s FIFO guard (now
  // `_upd_report_readable`, shared with item 9) ships with no test that
  // goes red when it is deleted — with the guard gone, a busy-lock refusal
  // would hang reading a FIFO instead of printing "pid unknown, target
  // unknown" promptly. Bounded by `runBounded` (GNU `timeout -k`) because
  // the hang would be inside jq, a grandchild of the update process.
  it.skipIf(UPD_DEADLINE_BIN === null)(
    'a FIFO at update.json with the lock held: exit 1 promptly with "pid unknown, target unknown", never blocked reading it (fix round 1 item 23-C21 / review 155 C21)', () => {
      const home = freshUpdateBox('ccrc-update-lock-holder-fifo-');
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      expect(spawnSync('mkfifo', [join(home, '.ccrc', 'update.json')]).status, 'mkfifo').toBe(0);
      holdLock(home);
      const env = { ...updateEnv(home), CCRC_RELEASE_BASE_URL: `local://${home}/releases` };
      replantDoctorStubs(home);
      const r = runBounded([BASH, join(REPO, 'ccd', 'ccrc'), 'update'], env, 5000);
      expect(r.code, r.stderr).toBe(1);
      expect(r.stderr).toMatch(/^ccrc: update: another update holds ~\/\.ccrc\/update\.lock \(pid unknown, target unknown\)$/m);
    }, 15000);

  it.skipIf(process.getuid?.() === 0)('a lock that cannot be MEASURED — the file there, not openable — is neither held nor free: the restore child refuses naming probe rc 3, and a plain run refuses to open it (ruling R16)', () => {
    // Plan D-3250: rc 3 folded into "held" would exempt
    // the child on no evidence. Skipped as root, the suite's idiom for a
    // mode-000 fixture: root opens it.
    const home = stubBox('ccrc-update-lock-unmeasured-');
    writeFileSync(lockPath(home), '');
    chmodSync(lockPath(home), 0o000);
    let r = runUpdate(home, [], { CCRC_UPDATE_LOCK_HELD: String(process.pid) });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr.split('\n')).toContain(`ccrc: update: CCRC_UPDATE_LOCK_HELD names this run's parent (pid ${process.pid}) but ~/.ccrc/update.lock could not be measured (probe rc 3) — refusing; a restore child runs only under a lock it can see`);
    expect(existsSync(join(home, 'curl-argv')), 'an unmeasured lock exempted the run').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
    // THE CONTROL: no marker, the same file — acquisition's own open fails,
    // by its own sentence, and nothing is fetched either.
    r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: cannot open ~\/\.ccrc\/update\.lock — nothing on this box was changed$/m);
    expect(existsSync(join(home, 'curl-argv'))).toBe(false);
  });

  it('a restore child — CCRC_UPDATE_LOCK_HELD naming its parent, the lock measured HELD — runs with no second acquire, and the marker reaches no grandchild', () => {
    const home = stubBox('ccrc-update-lock-child-');
    holdLock(home);   // the parent's descriptor, as the probe sees it: somebody holds the lock
    // spawnSync runs bash directly (no shell between), so the run's $PPID IS this process.
    const r = runUpdate(home, [], { CCRC_UPDATE_LOCK_HELD: String(process.pid) });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stderr).not.toMatch(/another update holds|CCRC_UPDATE_LOCK_HELD/);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
    expect(readFileSync(join(home, 'staged-ccrc-lockenv'), 'utf8')).toBe('unset\n');
  });

  it('the same marker with NOBODY holding the lock is REFUSED — the env alone never exempts a run (§18 "the lock exemption is measured")', () => {
    for (const planted of [false, true]) {   // no lock file at all; a lock file nobody holds
      const home = stubBox(`ccrc-update-lock-forged-${planted ? 'file' : 'nofile'}-`);
      if (planted) writeFileSync(lockPath(home), '');
      const r = runUpdate(home, [], { CCRC_UPDATE_LOCK_HELD: String(process.pid) });
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(new RegExp(`^ccrc: update: CCRC_UPDATE_LOCK_HELD names this run's parent \\(pid ${process.pid}\\) but nobody holds ~/\\.ccrc/update\\.lock — refusing; a restore child runs only under its parent's lock$`, 'm'));
      expect(existsSync(join(home, 'curl-argv')), 'a forged marker reached the fetch').toBe(false);
      expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
      expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    }
  });

  it('a marker naming ANOTHER pid is no exemption: with no holder the run acquires normally, with one it is refused like any third party', () => {
    const free = stubBox('ccrc-update-lock-otherpid-free-');
    let r = runUpdate(free, [], { CCRC_UPDATE_LOCK_HELD: '1' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(free, 'staged-ccrc-lockenv'), 'utf8')).toBe('unset\n');
    const busy = stubBox('ccrc-update-lock-otherpid-busy-');
    writeFileSync(join(busy, '.ccrc', 'update.json'), HELD_REPORT);
    holdLock(busy);
    r = runUpdate(busy, [], { CCRC_UPDATE_LOCK_HELD: '1' });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: another update holds ~\/\.ccrc\/update\.lock \(pid 4242, target v9\.9\.9\)$/m);
  });

  it('no flock on PATH is refused by name before anything else runs — macOS\'s sentence names brew', () => {
    const home = freshUpdateBox('ccrc-update-lock-noflock-');
    const empty = join(home, 'empty-bin');
    mkdirSync(empty, { recursive: true });
    const r = runUpdate(home, [], { PATH: empty });
    expect(r.code).toBe(1);
    if (process.platform === 'darwin') {
      expect(r.stderr).toMatch(/^ccrc: flock is required by 'ccrc update' — it serialises updates and refuses rather than racing — and macOS does not ship it\. Install it: brew install flock\. Nothing on this box was changed$/m);
    } else {
      expect(r.stderr).toMatch(/^ccrc: flock \(util-linux\) is required by 'ccrc update' — it serialises updates and refuses rather than racing; nothing on this box was changed$/m);
    }
    expect(r.stderr).not.toMatch(/curl is required/);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('a flock that could not RUN at all (e.g. rc 65, "Bad file descriptor") is refused as unlockable, never reported as a holder (fix round 1, D-3274)', () => {
    const home = freshUpdateBox('ccrc-update-lock-flockfail-');
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    // First on PATH (ahead of the real flock `updateEnv`'s harness leaves
    // reachable): a flock that always fails for a reason that is not
    // contention — rc 1 is reserved for "someone else holds it".
    writeFileSync(join(bin, 'flock'), '#!/bin/sh\nexit 65\n', { mode: 0o755 });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: cannot lock ~\/\.ccrc\/update\.lock \(flock rc 65\) — this is not another update holding it; nothing on this box was changed$/m);
    expect(r.stderr).not.toMatch(/another update holds/);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('the staged spine inherits no lock descriptor: a process it leaves behind does not pin the lock once the run has exited', () => {
    const home = stubBox('ccrc-update-lock-spine-linger-');
    writeFileSync(join(home, 'fixture-spine-linger'), '');
    lingerers.push(join(home, 'spine-linger-pid'));
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(join(home, 'spine-linger-pid')), 'the spine never lingered — the absence below would be vacuous').toBe(true);
    // THE DISCRIMINATOR: a run that takes the lock and then dies at the
    // preflight. Lock free → its own jq sentence; lock pinned → the lock's.
    const second = runUpdate(home, [], { PATH: pathWithoutJq(home) });
    expect(second.code).toBe(1);
    expect(second.stderr).not.toMatch(/another update holds/);
    expect(second.stderr).toMatch(/^ccrc: jq is required by 'ccrc update' but is not on PATH/m);
  });

  itLinux('the lock closes BEFORE the sweep: a restart that leaves a process behind does not pin it (§18 "the lock closes before the sweep")', () => {
    const home = stubBox('ccrc-update-lock-sweep-linger-');
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-linger'), '');
    lingerers.push(join(home, 'sweep-linger-pid'));
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, 'systemctl-calls'), 'utf8')).toMatch(/^--user try-restart claude-session@\*$/m);
    expect(existsSync(join(home, 'sweep-linger-pid')), 'the sweep never lingered — the absence below would be vacuous').toBe(true);
    const second = runUpdate(home, [], { PATH: pathWithoutJq(home) });
    expect(second.code).toBe(1);
    expect(second.stderr).not.toMatch(/another update holds/);
    expect(second.stderr).toMatch(/^ccrc: jq is required by 'ccrc update' but is not on PATH/m);
  });
});

describe('ccrc update --detach (design §10; W4 Task 3)', () => {
  const lockPath = (home: string): string => join(home, '.ccrc', 'update.lock');
  const report = (home: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
  const detachArgv = (home: string): string[] => (existsSync(join(home, 'systemd-run-argv'))
    ? readFileSync(join(home, 'systemd-run-argv'), 'utf8').split('\n').filter((l) => l !== '')
    : []);
  /** A REAL holder of ~/.ccrc/update.lock — `flock <lock> sleep 30` in a
   *  process group of its own — returned only once a fresh `flock -n` from
   *  here FAILS, so "held" is measured, never assumed from the spawn. */
  const holdLock = (home: string): ChildProcess => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const p = spawn('flock', [lockPath(home), 'sleep', '30'], { stdio: 'ignore', detached: true });
    for (let i = 0; i < 100; i++) {
      if (spawnSync('flock', ['-n', lockPath(home), 'true']).status === 1) return p;
      spawnSync('sleep', ['0.05']);
    }
    try { process.kill(-p.pid!, 'SIGKILL'); } catch { /* already gone */ }
    throw new Error('the fixture holder never took ~/.ccrc/update.lock');
  };
  const release = (p: ChildProcess): void => {
    try { process.kill(-p.pid!, 'SIGKILL'); } catch { /* already gone */ }
  };
  const detachedBox = (prefix: string): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v1.0.0' });
    // A release the parent COULD fetch — so "nothing was fetched" below is a
    // measurement of the parent's restraint, not of an empty URL space.
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    return home;
  };

  itLinux('the re-exec goes through _svc_run_detached with the ABSOLUTE launcher and the spec argv, through the D-3282 PATH-prepend wrapper, writes queued, and returns 0 having done none of the work (§18 "--detach escapes the cgroup"; fix round 1 item 19 / review 155 C30)', () => {
    const home = detachedBox('ccrc-update-detach-');
    const t0 = Date.now();
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
    const elapsed = Date.now() - t0;
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(elapsed, 'the parent waited on the run it detached').toBeLessThan(10_000);
    expect(detachArgv(home)).toEqual([
      '--user --collect --quiet /bin/sh -c PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@" '
      + 'ccrc-detach update --to v2.0.0 --from cli',
    ]);
    expect(r.stdout).toMatch(/^update: detached — 'update --to v2\.0\.0' runs as a transient systemd --user unit; its progress is ~\/\.ccrc\/update\.json$/m);
    const rep = report(home);
    expect(rep).toMatchObject({ target: 'v2.0.0', phase: 'queued', detail: null, from: 'cli' });
    // Unix SECONDS (ruling R14), read through Task 1's file-scope REPORT_TIME,
    // never a second hand-written unit here.
    expect(String(rep['startedAt'])).toMatch(REPORT_TIME);
    expect(String(rep['updatedAt'])).toMatch(REPORT_TIME);
    expect(typeof rep['pid']).toBe('number');
    // The parent did NONE of the update's work — no fetch, no backup, no spine.
    expect(existsSync(join(home, 'curl-argv')), 'the parent fetched').toBe(false);
    expect(existsSync(join(home, 'ccrc-backups')), 'the parent backed up').toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the parent installed').toBe(false);
  });

  // §16's first W4 fixture: "kills the parent after `queued` and asserts the
  // grandchild finishes". The parent is a process-group leader. Once the
  // detached run is parked mid-install, the WHOLE group is killed, which is
  // what a unit restart does to every process left in the unit's cgroup. A
  // run that escaped (setsid here, a transient unit on a real box) finishes.
  // A run that stayed in the group (`nohup … &`, the mutation) dies parked
  // and never writes `done`.
  itLinux('a parent whose whole process group is killed after queued leaves the detached run to finish — done, from another pid, the lock free after it (§16 the parent-kill fixture; §18 "--detach escapes the cgroup")', async () => {
    const home = detachedBox('ccrc-update-detach-parentkill-');
    writeFileSync(join(home, 'fixture-systemd-run-exec'), '');
    writeFileSync(join(home, 'fixture-install-wait'), '');
    // The absolute launcher in the argv is the checkout's ccrc, the code under test.
    writeFileSync(join(home, '.local', 'bin', 'ccrc'),
      `#!/bin/sh\nexec '${BASH}' '${join(REPO, 'ccd', 'ccrc')}' "$@"\n`, { mode: 0o755 });
    const pause = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));
    mkdirSync(join(home, 'tmp'), { recursive: true });
    const env = {
      ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_RELEASE_BASE_URL: `local://${home}/releases`,
    };
    replantDoctorStubs(home);
    const parent = spawn(BASH, [join(REPO, 'ccd', 'ccrc'), 'update', '--detach', '--to', 'v2.0.0'],
      { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    parent.stdout!.on('data', (b: Buffer) => { out += b.toString(); });
    parent.stderr!.on('data', (b: Buffer) => { err += b.toString(); });
    const parentCode = new Promise<number>((res) => parent.on('close', (c) => res(c ?? -1)));
    const detachedLog = (): string => (existsSync(join(home, 'detached.log'))
      ? readFileSync(join(home, 'detached.log'), 'utf8') : '(no detached.log)');
    let final: Record<string, unknown> = {};
    try {
      const code = await Promise.race([parentCode, pause(15_000).then(() => -2)]);
      expect(code, `the parent did not return on its own\nstderr: ${err}\nstdout: ${out}`).toBe(0);
      expect(out).toMatch(/^update: detached — 'update --to v2\.0\.0' runs as a transient systemd --user unit; its progress is ~\/\.ccrc\/update\.json$/m);
      // Parked: the staged spine has recorded its argv and is waiting for the go file.
      for (let until = Date.now() + 15_000; Date.now() < until && !existsSync(join(home, 'staged-ccrc-argv'));) await pause(50);
      expect(existsSync(join(home, 'staged-ccrc-argv')), `the detached run never reached its install\n${detachedLog()}`).toBe(true);
      const parked = report(home);
      expect(parked['phase']).toBe('installing');
      // CONTROL: the run is alive at the kill. A `done` below then means it
      // survived, not that it had already finished before the kill.
      expect(() => process.kill(Number(parked['pid']), 0), 'the run was gone before the kill — the pin below would be vacuous').not.toThrow();
      // THE KILL: every process still in the parent's group, the parent's own
      // pid as pgid. ESRCH is the escaped case, an empty group.
      try { process.kill(-parent.pid!, 'SIGKILL'); } catch { /* an empty group: nothing stayed behind */ }
      await pause(200);
      writeFileSync(join(home, 'fixture-install-go'), '');
      for (let until = Date.now() + 20_000; Date.now() < until;) {
        try { final = report(home); } catch { final = {}; }
        if (final['phase'] === 'done' || final['phase'] === 'failed') break;
        await pause(50);
      }
    } finally {
      writeFileSync(join(home, 'fixture-install-go'), '');
      try { process.kill(-parent.pid!, 'SIGKILL'); } catch { /* already gone */ }
    }
    expect(final, `the detached run did not finish after its parent's group was killed\n${detachedLog()}`)
      .toMatchObject({ phase: 'done', target: 'v2.0.0', detail: null, from: 'cli' });
    const seq = reportWrites(home);
    expect(seq.slice(0, 2).map((w) => w['phase'])).toEqual(['queued', 'resolving']);
    expect(seq.map((w) => w['phase'])).toContain('installing');
    expect(seq[0]!['pid'], 'queued is the parent\'s write').toBe(parent.pid);
    const runPids = new Set(seq.slice(1).map((w) => w['pid']));
    expect(runPids.size, 'the detached run wrote from more than one process').toBe(1);
    expect(runPids.has(parent.pid), 'the parent did the run itself').toBe(false);
    expect(readFileSync(join(home, 'staged-ccrc-argv'), 'utf8').split('\n')[1]).toBe('install');
    // The run's own lock goes with the run: free once it has exited.
    for (let until = Date.now() + 10_000; Date.now() < until
      && spawnSync('flock', ['-n', lockPath(home), 'true']).status !== 0;) await pause(50);
    expect(spawnSync('flock', ['-n', lockPath(home), 'true']).status, 'the finished run left the lock held').toBe(0);
  }, 60_000);

  itLinux('--from and every typed flag ride the detached argv in ONE fixed order, whatever order they were typed in (D-3238)', () => {
    const home = detachedBox('ccrc-update-detach-flags-');
    const r = runUpdate(home,
      ['--allow-unsigned', '--detach', '--from', 'pwa', '--downgrade', '--to', 'v2.0.0', '--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(detachArgv(home)).toEqual([
      '--user --collect --quiet /bin/sh -c PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@" '
      + 'ccrc-detach update --to v2.0.0 --from pwa --force --downgrade --allow-unsigned',
    ]);
    expect(report(home)).toMatchObject({ phase: 'queued', from: 'pwa', target: 'v2.0.0' });
  });

  itLinux('with a LIVE holder the parent is refused by the lock sentence and update.json is byte-identical — a queued write would overwrite a live run\'s report', () => {
    const home = detachedBox('ccrc-update-detach-busy-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const live = '{"target":"v1.9.0","phase":"installing","startedAt":1,"updatedAt":2,"detail":null,"from":"cli","pid":4321}\n';
    writeFileSync(join(home, '.ccrc', 'update.json'), live);
    const holder = holdLock(home);
    let r: Result;
    try {
      r = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
    } finally {
      release(holder);
    }
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: another update holds ~\/\.ccrc\/update\.lock \(pid 4321, target v1\.9\.0\)$/m);
    expect(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')).toBe(live);
    expect(detachArgv(home), 'a refused parent spawned anyway').toEqual([]);
  });

  itLinux('a lock the parent cannot MEASURE refuses the detach with its own sentence — neither the holder sentence nor a spawn, and no report (ruling R16)', () => {
    const home = detachedBox('ccrc-update-detach-unmeasured-');
    // A DIRECTORY where the lock file goes: it exists, and `exec {p}>>` on it
    // fails, so `_upd_lock_probe` answers 3. This holds at every uid, unlike a
    // `chmod 000` file, which root opens anyway.
    mkdirSync(lockPath(home), { recursive: true });
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: ~\/\.ccrc\/update\.lock could not be measured \(probe rc 3\) — refusing to detach a run past a lock this box cannot see; nothing on this box was changed$/m);
    expect(r.stderr, 'rc 3 was folded into "held"').not.toMatch(/another update holds/);
    expect(existsSync(join(home, '.ccrc', 'update.json')), 'a queued report was written past an unmeasured lock').toBe(false);
    expect(detachArgv(home), 'rc 3 was folded into "free"').toEqual([]);
  });

  itLinux('a box with no flock on PATH refuses the detach with the flock sentence, not the busy or unmeasured one — no spawn, no report (rc-2 arm, mutation `2) ;;` must go RED)', () => {
    const home = detachedBox('ccrc-update-detach-noflock-');
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0'], { PATH: pathWithoutFlock(home) });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: flock \(util-linux\) is required by 'ccrc update' — it serialises updates and refuses rather than racing; nothing on this box was changed$/m);
    expect(existsSync(join(home, '.ccrc', 'update.json')), 'queued was written past a lock this box cannot probe').toBe(false);
    expect(detachArgv(home), 'the rc-2 arm spawned anyway').toEqual([]);
  });

  itLinux('the parent holds NO lock descriptor at the spawn: a child that lingers after the parent exits pins nothing (§18 "--detach precedes the lock")', () => {
    const home = detachedBox('ccrc-update-detach-nofd-');
    writeFileSync(join(home, 'fixture-systemd-run-linger'), '');
    let lingerPid = 0;
    try {
      const r1 = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
      expect(r1.code, `stderr: ${r1.stderr}\nstdout: ${r1.stdout}`).toBe(0);
      lingerPid = Number(readFileSync(join(home, 'systemd-run-linger-pid'), 'utf8').trim());
      rmSync(join(home, 'fixture-systemd-run-linger'));
      // CONTROL: the inheritor is alive, so a free lock below is a finding
      // about the parent, not about a child that already exited.
      expect(() => process.kill(lingerPid, 0), 'the lingering child is gone — the pin below would be vacuous').not.toThrow();
      expect(spawnSync('flock', ['-n', lockPath(home), 'true']).status,
        'the detached child inherited a lock descriptor from its parent').toBe(0);
      const r2 = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
      expect(r2.code, `stderr: ${r2.stderr}`).toBe(0);
    } finally {
      if (lingerPid > 0) { try { process.kill(lingerPid, 'SIGKILL'); } catch { /* already gone */ } }
    }
  });

  itLinux('a user manager that refuses to create the job is a failed report and exit 1 — nothing on the box changed', () => {
    const home = detachedBox('ccrc-update-detach-rc-');
    writeFileSync(join(home, 'fixture-systemd-run-exit'), '1\n');
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: could not start the detached run \(systemd-run exited 1\) — nothing on this box was changed$/m);
    expect(report(home)).toMatchObject({ phase: 'failed', detail: 'detach: systemd-run exited 1', target: 'v2.0.0' });
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  it('--detach without --to is a usage error at exit 2 — nothing written, nothing spawned (D-3229)', () => {
    const home = detachedBox('ccrc-update-detach-noto-');
    const r = runUpdate(home, ['--detach']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: update: --detach needs --to <tag> — a detached run never resolves a channel; it has nobody to print its sentence to$/m);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
    expect(detachArgv(home)).toEqual([]);
    expect(existsSync(join(home, 'curl-argv'))).toBe(false);
  });

  it('--check and --detach are exclusive — the D-3139 shape, exit 2, nothing fetched', () => {
    const home = detachedBox('ccrc-update-detach-check-');
    const r = runUpdate(home, ['--check', '--detach', '--to', 'v2.0.0']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/update: --check and --detach are exclusive/);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
    expect(detachArgv(home)).toEqual([]);
  });

  it('the Darwin arm refuses BEFORE it probes, writes or spawns — measured on any platform through the sourced function (§18 "--detach refuses on Darwin")', () => {
    const home = detachedBox('ccrc-update-detach-darwin-src-');
    const r = sourcedCcrc(home, 'CCD_OS=darwin; _upd_detach update v2.0.0 cli');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: --detach is Linux-only \(decision 17\)$/m);
    expect(existsSync(join(home, '.ccrc', 'update.json')), 'the Darwin arm wrote a report').toBe(false);
    expect(detachArgv(home)).toEqual([]);
  });

  itDarwin('on macOS the full verb refuses at exit 1 with the decision-17 sentence, nothing written', () => {
    const home = detachedBox('ccrc-update-detach-darwin-');
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: --detach is Linux-only \(decision 17\)$/m);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
    expect(existsSync(join(home, 'curl-argv'))).toBe(false);
  });
});

describe('ccrc update: the health gate (per OS, exit 3 vs 4 — design §11)', () => {
  // After the staged install returns and BEFORE the sweep, the run waits up
  // to CCRC_UPDATE_HEALTH_S for the role's signal: server/both — the unit up
  // and `/health` answering the STAGED version; fleet — the agent's unit up
  // and staying up. A doctor FAIL with the gate passing is D-3114's exit 3
  // ("moved, unhealthy"); a failed gate is exit 4 (Task 6 adds the restore
  // that exit 4 means). All against the recording stubs — updateEnv's
  // systemctl/launchctl and healthyBox's curl — never a real manager or port.
  const gateBox = (prefix: string, role?: 'server' | 'fleet' | 'both', installExit = 0): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v1.0.0' });
    if (role !== undefined) {
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      // What `_inst_env` seeds (a fleet box's env file names no server).
      writeFileSync(join(home, '.ccrc', 'ccrc.env'), role === 'fleet'
        ? 'CCRC_ROLE=fleet\n'
        : `CCRC_ROLE=${role}\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n`);
    }
    const tree = stubTree(home, { version: 'v2.0.0', installExit });
    packRelease(home, tree, { tag: 'v2.0.0' });
    // W4a Task 8: a server or `both` box's `ccrc update` with no --to follows
    // the control plane's projection, which the server process writes — so an
    // ABSENT one is `unreadable (absent)` and refused before the gate is ever
    // reached. Give the box what a real server box has: the frozen clock and
    // an in-force projection naming the v2.0.0 it publishes, packed at
    // download/v2.0.0 too. latest/download stays for the Darwin leg, whose
    // reader answers `not-configured` whatever is planted. A fleet box has no
    // ccd-update-sync.timer here, reads `not-configured`, and needs neither.
    if (role === 'server' || role === 'both') {
      plantClock(home);
      plantIntent(home, intentDoc({ desired: 'v2.0.0', desiredStable: 'v2.0.0' }));
      packRelease(home, tree, { tag: 'v2.0.0', latest: false });
    }
    return home;
  };
  /** Everything a sweep needs, so a "no sweep" assertion is about the gate —
   *  the gate describe's own copy of the converged() discipline above. */
  const withSweep = (home: string): void => {
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
  };
  const lines = (home: string, f: string): string[] => (existsSync(join(home, f))
    ? readFileSync(join(home, f), 'utf8').split('\n').filter((l) => l !== '') : []);
  /** The gate's probes only — `/api/fleet/health` (the fleet-first warning)
   *  also ends in `/health` and is not one. */
  const healthProbes = (home: string): string[] => lines(home, 'curl-argv')
    .filter((l) => /^http:\/\/[^/]+\/health$/.test(l));
  const reportOf = (home: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;

  itLinux('server: ccrc.service active and /health answering the staged version passes — and the gate runs BEFORE the sweep', () => {
    const home = gateBox('ccrc-update-gate-pass-', 'server');
    withSweep(home);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: gate: server answers on v2\.0\.0 \(ccrc\.service up, \/health at 127\.0\.0\.1:7788 answers v2\.0\.0\)$/m);
    const calls = lines(home, 'systemctl-calls');
    const gate = calls.indexOf('--user is-active ccrc.service');
    expect(gate, calls.join('\n')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('--user try-restart claude-session@*')).toBeGreaterThan(gate);
    expect(healthProbes(home)).toEqual(['http://127.0.0.1:7788/health']);
    expect(reportOf(home)['phase']).toBe('done');
  });

  it('/health answering the OLD version past the deadline fails the gate: exit 4, a failed report naming it, no sweep and no from→to report (§11 Pins; §18 "the gate restores" — Task 6 adds the restore)', () => {
    const home = gateBox('ccrc-update-gate-old-', 'server');
    withSweep(home);
    writeFileSync(join(home, 'fixture-health-pin'), 'v1.0.0\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — \/health at 127\.0\.0\.1:7788 answers v1\.0\.0, not v2\.0\.0$/m);
    expect(r.stderr).toMatch(/update: v2\.0\.0 was installed, but the box did not come back healthy on it \(\/health at 127\.0\.0\.1:7788 answers v1\.0\.0, not v2\.0\.0\) — exit 4\. The backup taken BEFORE the install is complete at \S*ccrc-backups/);
    const rep = reportOf(home);
    // Task 6: a failed gate restores. This box's v1.0.0 is unpublished, so
    // arm 2 refuses (no bundle to re-install from) and arm 3 copies back.
    expect(rep['phase']).toBe('reverted');
    expect(rep['detail']).toBe('arm3: tree MIXED, deploy.sh is the remedy; gate: /health at 127.0.0.1:7788 answers v1.0.0, not v2.0.0');
    // withSweep planted everything a sweep needs, so this absence is the gate's.
    expect(lines(home, 'systemctl-calls').join('\n')).not.toMatch(/try-restart/);
    expect(lines(home, 'launchctl-calls').join('\n')).not.toMatch(/kickstart -k \S+\/app\.ccrc\.session\./);   // arm 3 re-bootstraps and kickstarts the main job; the sweep never ran
    expect(r.stdout).not.toMatch(/^update: build: /m);
  });

  // Review fix round 1, M1: `_box_server_addr`'s rc-2 sentences embed the
  // absolute `$BOX_ENV_FILE` path ("… is not a regular file"), which
  // `_upd_health_version` copies straight into UPD_GATE_WHY — and from
  // there into every `_upd_phase` detail (`_upd_rollback_no_restore`,
  // `_upd_restore` and its two arms, `cmd_watchdog`) and several stdout/
  // stderr echoes (`_upd_gate`'s own two, `cmd_update`'s exit-4 line) that
  // never pass through `_ccrc_die`. A `.ccrc/ccrc.env` that is a directory
  // (never written by ccrc itself, but the same 0644-file-the-console-reads
  // class as C17's `$BOX_FLOOR_FILE`) reaches exactly this arm.
  it('a gate failure whose reason carries the fixture HOME is redacted everywhere — update.json detail, stdout and stderr (review fix round 1 M1)', () => {
    const home = gateBox('ccrc-update-gate-redact-', 'server');
    withSweep(home);
    // Corrupt ccrc.env into a directory AFTER gateBox writes it as a file.
    rmSync(join(home, '.ccrc', 'ccrc.env'));
    mkdirSync(join(home, '.ccrc', 'ccrc.env'));
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout, r.stdout).not.toContain(home);
    expect(r.stderr, r.stderr).not.toContain(home);
    const rep = reportOf(home);
    expect(String(rep['detail']), JSON.stringify(rep)).not.toContain(home);
    // A measurement, not just an absence: the verdict itself is still there,
    // with the redacted path standing in for the fixture HOME.
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — ~\/\.ccrc\/ccrc\.env is not a regular file$/m);
    expect(r.stderr).toMatch(/did not come back healthy on it \(~\/\.ccrc\/ccrc\.env is not a regular file\)/);
    expect(String(rep['detail'])).toContain('~/.ccrc/ccrc.env is not a regular file');
  });

  itLinux('a unit that is not active fails the gate before /health is asked: exit 4, naming the unit and its state', () => {
    const home = gateBox('ccrc-update-gate-dead-', 'server');
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    const r = runUpdate(home);
    expect(r.code, r.stdout).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — ccrc\.service is failed \(systemctl --user is-active\), not active$/m);
    expect(healthProbes(home)).toEqual([]);
    expect(reportOf(home)['detail']).toBe('arm3: tree MIXED, deploy.sh is the remedy; gate: ccrc.service is failed (systemctl --user is-active), not active');
  });

  it('/health that does not answer fails the gate, naming curl\'s exit', () => {
    const home = gateBox('ccrc-update-gate-down-', 'server');
    writeFileSync(join(home, 'fixture-health-down'), 'yes\n');
    const r = runUpdate(home);
    expect(r.code, r.stdout).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — GET http:\/\/127\.0\.0\.1:7788\/health got no answer \(curl exited 7\)$/m);
  });

  it('/health answering with no version fails the gate — an unversioned answer is not the staged version', () => {
    const home = gateBox('ccrc-update-gate-nover-', 'server');
    writeFileSync(join(home, 'fixture-health-pin'), '');
    const r = runUpdate(home);
    expect(r.code, r.stdout).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — GET http:\/\/127\.0\.0\.1:7788\/health answered without a release version$/m);
  });

  it('the gate probes again until CCRC_UPDATE_HEALTH_S elapses: the old version first, the staged one two seconds later — passes', () => {
    const home = gateBox('ccrc-update-gate-retry-', 'server');
    writeFileSync(join(home, 'fixture-health-pin'), 'v1.0.0\n');
    writeFileSync(join(home, 'fixture-health-pin-probes'), '1\n');
    const r = runUpdate(home, [], { CCRC_UPDATE_HEALTH_S: '5' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(healthProbes(home)).toHaveLength(2);
    expect(r.stdout).toMatch(/^update: gate: server answers on v2\.0\.0 /m);
  });

  it('a doctor FAIL with the gate passing is exit 3 and a done report; the same with the gate failing is exit 4 — two failures, two exit codes (§18 "doctor FAIL does not restore")', () => {
    const home = gateBox('ccrc-update-gate-doctor-', 'server', 1);
    writeFileSync(join(home, 'fixture-stub-installed'), 'yes\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(3);
    expect(r.stdout).toMatch(/^update: the staged install completed \(the record is written\) but its trailing doctor exited 1/m);
    expect(r.stdout).toMatch(/^update: gate: server answers on v2\.0\.0 /m);
    expect(reportOf(home)['phase']).toBe('done');
    const both = gateBox('ccrc-update-gate-doctor-and-gate-', 'server', 1);
    writeFileSync(join(both, 'fixture-stub-installed'), 'yes\n');
    writeFileSync(join(both, 'fixture-health-pin'), 'v1.0.0\n');
    const r2 = runUpdate(both);
    expect(r2.code, r2.stdout).toBe(4);
    expect(reportOf(both)['phase']).toBe('reverted');
  });

  itLinux('fleet: ccrc-agent.service active AND staying up (verify-service.sh\'s two samples) passes with no /health asked; a MainPID that churns behind `active` fails', () => {
    const home = gateBox('ccrc-update-gate-fleet-', 'fleet');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: gate: fleet answers on v2\.0\.0 \(ccrc-agent\.service up and staying up\)$/m);
    const calls = lines(home, 'systemctl-calls');
    expect(calls).toContain('--user is-active ccrc-agent.service');
    expect(calls).toContain('--user show -p MainPID --value ccrc-agent.service');
    expect(calls).not.toContain('--user is-active ccrc.service');
    expect(healthProbes(home)).toEqual([]);
    const churn = gateBox('ccrc-update-gate-fleet-churn-', 'fleet');
    writeFileSync(join(churn, 'fixture-mainpid-churn'), 'yes\n');
    const r2 = runUpdate(churn);
    expect(r2.code, r2.stdout).toBe(4);
    expect(r2.stdout).toMatch(/^update: gate FAILED after \d+s — ccrc-agent\.service did not stay up \(deploy\/verify-service\.sh exited 1; systemctl --user status ccrc-agent\.service says why\)$/m);
  });

  itDarwin('Darwin server: the job\'s pid must hold across the window (_ccrc_job_stayed_up) — a churning ccrc job fails the gate, and systemctl is never called (§11 Pins)', () => {
    const home = gateBox('ccrc-update-gate-darwin-', 'server');
    writeFileSync(join(home, 'fixture-main-pid-churn'), 'yes\n');
    const r = runUpdate(home);
    expect(r.code, r.stdout).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — ccrc\.service did not stay up \(pid \d+ -> \d+ across 0s\+0s\)$/m);
    expect(existsSync(join(home, 'systemctl-calls')), 'the Darwin gate reached systemctl').toBe(false);
    expect(healthProbes(home)).toEqual([]);
  });

  it('a spine that died AFTER the tree moved runs the gate: passing → exit 1 naming --force, no sweep, the report stays "spine died"; failing → exit 4; a death BEFORE the tree runs no gate (§11 Pins; D-3240)', () => {
    const home = gateBox('ccrc-update-gate-spine-', 'server', 1);
    withSweep(home);
    writeFileSync(join(home, 'fixture-install-step'), '_inst_skills\n');
    let r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toMatch(/^update: gate: server answers on v2\.0\.0 /m);
    expect(r.stderr).toMatch(/update: the box moved and answers on v2\.0\.0, but its install never completed \(spine died at _inst_skills\) — rerun: ccrc update --to v2\.0\.0 --force/);
    // Re-asserted after the gate's own `checking` write.
    expect(reportOf(home)).toMatchObject({ phase: 'failed', detail: 'spine died at _inst_skills' });
    expect(lines(home, 'systemctl-calls').join('\n')).not.toMatch(/try-restart/);
    // …and failing the gate as well: exit 4, both causes in the report.
    const failing = gateBox('ccrc-update-gate-spine-fail-', 'server', 1);
    writeFileSync(join(failing, 'fixture-install-step'), '_inst_skills\n');
    writeFileSync(join(failing, 'fixture-health-pin'), 'v1.0.0\n');
    r = runUpdate(failing);
    expect(r.code, r.stdout).toBe(4);
    expect(reportOf(failing)['detail'])
      .toBe('arm3: tree MIXED, deploy.sh is the remedy; spine died at _inst_skills; gate: /health at 127.0.0.1:7788 answers v1.0.0, not v2.0.0');
    // …and BEFORE the tree: nothing was replaced, so nothing is measured.
    const early = gateBox('ccrc-update-gate-spine-early-', 'server', 1);
    writeFileSync(join(early, 'fixture-install-step'), '_inst_env\n');
    r = runUpdate(early);
    expect(r.code, r.stdout).toBe(1);
    expect(r.stdout).not.toMatch(/^update: gate/m);
    expect(lines(early, 'systemctl-calls')).not.toContain('--user is-active ccrc.service');
    expect(healthProbes(early)).toEqual([]);
  });

  // Task 5 review carry: no earlier case measured D-3240's --no-gate sentence
  // ("was not measured (--no-gate)") — arm 2's own child types exactly this
  // flag, so this arm must stay reachable and unrestored under it.
  it('a spine that died AFTER the tree moved, run with --no-gate: exit 1, "was not measured (--no-gate)", no restore (D-3240)', () => {
    const home = gateBox('ccrc-update-gate-spine-nogate-', 'server', 1);
    withSweep(home);
    writeFileSync(join(home, 'fixture-install-step'), '_inst_skills\n');
    const r = runUpdate(home, ['--no-gate']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toMatch(/^update: gate: skipped \(--no-gate\) — nothing measured whether v2\.0\.0 came back up on this box$/m);
    expect(r.stderr).toMatch(/update: the box moved and was not measured \(--no-gate\), but its install never completed \(spine died at _inst_skills\) — rerun: ccrc update --to v2\.0\.0 --force/);
    expect(reportOf(home)).toMatchObject({ phase: 'failed', detail: 'spine died at _inst_skills' });
    expect(lines(home, 'systemctl-calls').join('\n')).not.toMatch(/try-restart/);
    expect(restoreChildArgv(home), 'a --no-gate death is not restored').toBeNull();
  });

  it('--no-gate skips the gate: one line says so, nothing is probed, and the run completes (only the restore child passes it automatically)', () => {
    const home = gateBox('ccrc-update-gate-nogate-', 'server');
    writeFileSync(join(home, 'fixture-health-pin'), 'v1.0.0\n');
    const r = runUpdate(home, ['--no-gate']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: gate: skipped \(--no-gate\) — nothing measured whether v2\.0\.0 came back up on this box$/m);
    expect(healthProbes(home)).toEqual([]);
    expect(lines(home, 'systemctl-calls')).not.toContain('--user is-active ccrc.service');
    expect(reportOf(home)['phase']).toBe('done');
  });

  itLinux('--detach carries a typed --no-gate into the detached argv, after the other typed flags (the D-3139 trap: a flag the caller typed is never dropped), through the D-3282 PATH-prepend wrapper (fix round 1 item 19 / review 155 C30)', () => {
    const home = gateBox('ccrc-update-gate-detach-', 'server');
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0', '--no-gate']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // The SAME `/bin/sh -c 'PATH="$HOME/.local/bin:$PATH" exec …'` shape
    // `ccrc-update-watchdog.service`'s own `ExecStart` uses (D-3282, fixed
    // by class) — never `--setenv=PATH=…`, which would bake in the CALLING
    // process's own PATH rather than reading the manager's fresh.
    expect(lines(home, 'systemd-run-argv')).toEqual([
      '--user --collect --quiet /bin/sh -c PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@" '
      + 'ccrc-detach update --to v2.0.0 --from cli --no-gate',
    ]);
  });

  it('--check and --no-gate are exclusive — the D-3139 refusal shape, exit 2, nothing fetched', () => {
    const home = freshUpdateBox('ccrc-update-gate-check-');
    const r = runUpdate(home, ['--check', '--no-gate']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: update: --check and --no-gate are exclusive — --check measures and writes nothing, --no-gate skips the health gate of a run that moves this box; pick one$/m);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
  });

  it('a CCRC_UPDATE_HEALTH_S that is not a number of seconds is named and replaced by 90', () => {
    const home = gateBox('ccrc-update-gate-knob-', 'server');
    const r = runUpdate(home, [], { CCRC_UPDATE_HEALTH_S: 'soon' });
    expect(r.code, r.stdout).toBe(0);
    expect(r.stdout).toMatch(/^update: WARN: CCRC_UPDATE_HEALTH_S='soon' is not a number of seconds — using 90$/m);
  });

  // THE ARMS, SOURCED. `ccrc` recomputes CCD_OS from $OSTYPE at source time
  // (ccd/ccrc:109-114), so the Darwin arms of a whole `ccrc update` run only
  // on the macOS leg — which is non-required and measured unable to finish.
  // Sourced (the `_check_routing` idiom in ccrc-doctor.test.ts), CCD_OS is
  // set AFTER the file computed it, and `_ccrc_job_stayed_up` is shadowed to
  // record its argument, so every leg measures which arm ran: the arm's
  // CHOICE is the subject here, the two-sample check is the itDarwin case's.
  const probe = (home: string, os: 'linux' | 'darwin', role: string): { rc: number; why: string } => {
    replantDoctorStubs(home);
    writeFileSync(join(home, 'fixture-health-pin'), 'v2.0.0\n');
    const script = [
      'set -uo pipefail',
      '. "$1"',
      'CCD_OS="$2"',
      '_ccrc_job_stayed_up() { printf \'%s\\n\' "$1" >> "$HOME/stayed-up-calls"; CCRC_STAYED_DETAIL="pid 4242 -> 4242 across 0s+0s"; [ ! -f "$HOME/fixture-shadow-churn" ]; }',
      'rc=0; _upd_gate_probe "$3" v2.0.0 || rc=$?',
      'printf \'rc=%s\\nwhy=%s\\n\' "$rc" "$UPD_GATE_WHY"',
    ].join('\n');
    const r = spawnSync(BASH, ['-c', script, 'gate-probe', join(REPO, 'ccd', 'ccrc'), os, role],
      { env: { ...updateEnv(home), CCRC_ADDR: '127.0.0.1:7788' }, encoding: 'utf8' });
    const rc = /^rc=(\d+)$/m.exec(r.stdout ?? '');
    const why = /^why=(.*)$/m.exec(r.stdout ?? '');
    if (rc === null || why === null) throw new Error(`the probe printed no verdict:\n${r.stdout}\n${r.stderr}`);
    return { rc: Number(rc[1]), why: why[1]! };
  };

  it('the arms, sourced: Darwin takes _ccrc_job_stayed_up and never reaches systemctl; Linux takes is-active (fleet: plus verify-service.sh); only server/both ask /health (§18 "the gate has per-OS arms")', () => {
    const ds = freshUpdateBox('ccrc-update-gate-arm-ds-');
    expect(probe(ds, 'darwin', 'server')).toEqual({ rc: 0, why: 'ccrc.service up, /health at 127.0.0.1:7788 answers v2.0.0' });
    expect(lines(ds, 'stayed-up-calls')).toEqual(['ccrc.service']);
    expect(existsSync(join(ds, 'systemctl-calls')), 'the Darwin arm reached systemctl').toBe(false);
    expect(healthProbes(ds)).toEqual(['http://127.0.0.1:7788/health']);

    const df = freshUpdateBox('ccrc-update-gate-arm-df-');
    expect(probe(df, 'darwin', 'fleet')).toEqual({ rc: 0, why: 'ccrc-agent.service up and staying up' });
    expect(lines(df, 'stayed-up-calls')).toEqual(['ccrc-agent.service']);
    expect(existsSync(join(df, 'systemctl-calls'))).toBe(false);
    expect(healthProbes(df)).toEqual([]);

    const dc = freshUpdateBox('ccrc-update-gate-arm-dc-');
    writeFileSync(join(dc, 'fixture-shadow-churn'), 'yes\n');
    expect(probe(dc, 'darwin', 'both')).toEqual({ rc: 1, why: 'ccrc.service did not stay up (pid 4242 -> 4242 across 0s+0s)' });
    expect(healthProbes(dc), 'the unit is measured before /health').toEqual([]);

    const ls = freshUpdateBox('ccrc-update-gate-arm-ls-');
    expect(probe(ls, 'linux', 'server')).toEqual({ rc: 0, why: 'ccrc.service up, /health at 127.0.0.1:7788 answers v2.0.0' });
    expect(lines(ls, 'systemctl-calls')).toEqual(['--user is-active ccrc.service']);
    expect(existsSync(join(ls, 'stayed-up-calls'))).toBe(false);

    const lf = freshUpdateBox('ccrc-update-gate-arm-lf-');
    expect(probe(lf, 'linux', 'fleet')).toEqual({ rc: 0, why: 'ccrc-agent.service up and staying up' });
    // Ours, then verify-service.sh's two samples (is-active + MainPID, twice).
    expect(lines(lf, 'systemctl-calls')).toEqual([
      '--user is-active ccrc-agent.service',
      '--user is-active ccrc-agent.service',
      '--user show -p MainPID --value ccrc-agent.service',
      '--user is-active ccrc-agent.service',
      '--user show -p MainPID --value ccrc-agent.service',
    ]);
    expect(existsSync(join(lf, 'stayed-up-calls'))).toBe(false);
    expect(healthProbes(lf)).toEqual([]);
  });
});

describe('ccrc update: the automatic restore (arms 2 and 3)', () => {
  it('a failed gate restores by arm 2: ONE synchronous child re-installs the previous tag with --no-gate --from restore, under the parent\'s lock, and the run exits 4 (§18 "the gate restores", "arm 2 re-installs the previous tag", "the automatic restore does not sweep")', () => {
    const home = freshUpdateBox('ccrc-update-restore-arm2-');
    plantRestoreBox(home);
    // A sweep that RAN would leave a try-restart in the recording: the drop-in
    // passes its preflight and two supervisors are live. Without both, a
    // "no try-restart" assertion is vacuous (plantKillModeDropIn's own note).
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(restoreChildArgv(home)).toEqual([
      join(home, 'ccrc', 'ccd', 'ccrc'), 'update', '--to', 'v1.0.0', '--no-gate', '--from', 'restore',
    ]);
    const last = lastReport(home);
    // The marker names the PARENT (its own $$ is the report's pid), the child
    // saw it as its $PPID, and the lock was held while the child ran.
    const env = /^held=(\d+) ppid=(\d+) locked=(yes|no)$/.exec(
      readFileSync(join(home, 'restore-child-env'), 'utf8').trim());
    expect(env, 'the child recorded no environment line').not.toBeNull();
    expect(env![1]).toBe(env![2]);
    expect(env![1]).toBe(String(last['pid']));
    expect(env![3], 'the parent released the lock before its restore child ran').toBe('yes');
    expect(last['phase']).toBe('reverted');
    expect(String(last['detail'])).toMatch(/^arm2: restored v1\.0\.0; gate: /);
    expect(last['target']).toBe('v2.0.0');
    expect(last['from']).toBe('cli');
    const phases = reportWrites(home).map((w) => w['phase']);
    expect(phases.slice(-3)).toEqual(['checking', 'restoring', 'reverted']);
    expect(phases).not.toContain('restarting');
    expect(phases).not.toContain('done');
    expect(phases).not.toContain('failed');
    expect(String(reportWrites(home).at(-2)!['detail'])).toMatch(/^gate: /);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 2\): this box runs v1\.0\.0 again, re-installed from its release — gate: /m);
    expect(r.stdout).not.toMatch(/REVERTED \(arm 3\)/);
    // Arm 2 asked whether the previous release ships a bundle (the node was
    // verified), and fetched nothing else of it — the child does the install.
    expect(localUrls(home)).toContain(`local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz.sigstore.json`);
    expect(localUrls(home)).not.toContain(`local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz`);
    if (process.platform !== 'darwin') {
      const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8');
      expect(calls, 'the automatic restore swept the supervisors').not.toMatch(/try-restart/);
    }
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe(`v1.0.0\n${OLD_SHA}\n`);
  });

  // D-3275 (fix round 1): the child is a real `ccrc update` — exit 3 means
  // ITS spine completed and wrote its own record, and only its trailing
  // doctor FAILed (D-3114). That is a restore, not a failure: arm 3 over it
  // would delete the record the child just wrote and report a MIXED tree
  // that is not mixed, and on any box with a standing doctor FAIL no restore
  // could ever take arm 2.
  it('a restore child whose OWN doctor FAILs (exit 3) is still a restore: arm 2 accepts it, never falls to arm 3, and the child\'s own record survives (D-3275)', () => {
    const home = freshUpdateBox('ccrc-update-restore-doctor3-');
    plantRestoreBox(home);
    writeFileSync(join(home, 'fixture-restore-exit'), '3\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 2\): this box runs v1\.0\.0 again, re-installed from its release, but its doctor reports FAIL lines \('ccrc doctor' re-reads them\) — gate: /m);
    expect(r.stdout).not.toMatch(/arm 2 failed/);
    expect(r.stdout).not.toMatch(/arm 3/);
    expect(r.stdout).not.toMatch(/REVERTED \(arm 3\)/);
    const last = lastReport(home);
    expect(last['phase']).toBe('reverted');
    expect(String(last['detail'])).toMatch(/^arm2: restored v1\.0\.0 \(its doctor exited 3\); gate: /);
    // The child's own record (D-3275's fixture extension) is untouched — only
    // arm 3 removes `~/.ccrc/installed`, and arm 3 never ran.
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe('childsha0000000000000000000000000000000\n');
  });

  it('arm 2 passes --allow-unsigned only when the marker read `unsigned` BEFORE the install rewrote it (§18 "arm 2 never silently unsigns")', () => {
    const home = freshUpdateBox('ccrc-update-restore-unsigned-');
    plantRestoreBox(home, {
      marker: `${OLD_SHA}\nunsigned\n`,
      prevBundle: false,
      // The new spine writes a VERIFIED marker: reading it at restore time
      // instead of before the install would drop the flag.
      onInstall: ['printf \'newsha0000000000000000000000000000000000\\n\' > "$HOME/.ccrc/installed"'],
    });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(restoreChildArgv(home)).toEqual([
      join(home, 'ccrc', 'ccd', 'ccrc'), 'update', '--to', 'v1.0.0', '--no-gate', '--from', 'restore', '--allow-unsigned',
    ]);
    // Already unverified: nothing to ask the release host.
    expect(localUrls(home)).not.toContain(`local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz.sigstore.json`);
    expect(r.stdout).not.toMatch(/arm2-refused/);
    expect(String(lastReport(home)['detail'])).toMatch(/^arm2: restored v1\.0\.0; /);
  });

  it('a previously VERIFIED node whose previous release ships no bundle: arm 2 refuses with the by-hand sentence and falls to arm 3 — the child never runs', () => {
    const home = freshUpdateBox('ccrc-update-restore-refused-');
    plantRestoreBox(home, {
      prevBundle: false,
      // The new spine writes an UNSIGNED marker: reading it at restore time
      // would pass --allow-unsigned to a node that was verified.
      onInstall: ['printf \'newsha0000000000000000000000000000000000\\nunsigned\\n\' > "$HOME/.ccrc/installed"'],
    });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    // D-3285 (final review, B3(iii)): the spine already completed and
    // raised the floor to the new tag, so the by-hand command needs
    // --downgrade or the floor refuses it — `cmd_rollback`'s own D-3263
    // header already prints the same shape.
    expect(r.stdout).toMatch(/^update: arm2-refused: v1\.0\.0 ships no bundle — run ccrc update --to v1\.0\.0 --downgrade --allow-unsigned by hand$/m);
    expect(restoreChildArgv(home), 'arm 2 ran a child for a release it had just refused').toBeNull();
    const details = reportWrites(home).map((w) => String(w['detail']));
    expect(details).toContain('arm2-refused: v1.0.0 ships no bundle; run ccrc update --to v1.0.0 --downgrade --allow-unsigned by hand');
    const last = lastReport(home);
    expect(last['phase']).toBe('reverted');
    expect(String(last['detail'])).toMatch(/^arm3: tree MIXED, deploy\.sh is the remedy; gate: /);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
  });

  it('the hazard: arm 2 runs the NEW tree\'s ccd/ccrc — a broken one fails arm 2, and arm 3 copies the tree back by rename, never coord.db or memory, restarts the unit, and says MIXED', () => {
    const home = freshUpdateBox('ccrc-update-restore-arm3-');
    const darwin = process.platform === 'darwin';
    const unitRel = darwin ? 'Library/LaunchAgents/app.ccrc.ccrc.plist' : '.config/systemd/user/ccrc.service';
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'session-hook.sh'), 'OLD hook\n', { mode: 0o755 });
    mkdirSync(join(home, '.ccrc', 'memory', 'fixture-proj'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'memory', 'fixture-proj', 'MEMORY.md'), 'before the update\n');
    plantRestoreBox(home, {
      child: 'broken',
      onInstall: [
        // What a spine that moved the tree leaves: a new dist, a new ccd
        // placed by rename (with a second name kept on its inode, so an
        // in-place restore would show through it), a new unit, a new hook —
        // and a session writing memory while the update ran.
        'rm -rf "$HOME/ccrc/server/dist" && mkdir -p "$HOME/ccrc/server/dist" && printf \'// NEW dist\\n\' > "$HOME/ccrc/server/dist/new.js"',
        'printf \'#!/bin/sh\\n# the NEW ccd\\n\' > "$HOME/.local/bin/ccd.new" && chmod 755 "$HOME/.local/bin/ccd.new" && mv -f "$HOME/.local/bin/ccd.new" "$HOME/.local/bin/ccd"',
        'ln -f "$HOME/.local/bin/ccd" "$HOME/new-ccd-link"',
        `printf 'NEW job file\\n' > "$HOME/${unitRel}"`,
        'printf \'NEW hook\\n\' > "$HOME/.cc-sessions/session-hook.sh"',
        'printf \'written while the update ran\\n\' > "$HOME/.ccrc/memory/fixture-proj/MEMORY.md"',
      ],
    });
    plantCoordDb(home);
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    const unitBefore = readFileSync(join(home, unitRel), 'utf8');
    const db = join(home, '.ccrc', 'coord.db');
    const dbBytes = readFileSync(db);
    const dbIno = statSync(db).ino;
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stderr).toMatch(/fixture: the new tree's ccd\/ccrc is broken/);
    expect(r.stdout).toMatch(/^update: arm 2 failed \(the restore child exited 1\) — falling to arm 3$/m);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): copied the pre-update backup back — the tree is MIXED \(new shared\/, ccd\/ and node_modules under the old dists\); the remedy is deploy\.sh\. Best effort\.$/m);
    // The tree rows came back …
    expect(existsSync(join(home, 'ccrc', 'server', 'dist', 'old.js'))).toBe(true);
    expect(existsSync(join(home, 'ccrc', 'server', 'dist', 'new.js'))).toBe(false);
    expect(readFileSync(join(home, '.local', 'bin', 'ccd'), 'utf8')).toBe('#!/bin/sh\n# the OLD ccd\n');
    expect(statSync(join(home, '.local', 'bin', 'ccd')).mode & 0o111).not.toBe(0);
    // … by RENAME: the new ccd's inode still holds the new bytes, so no live
    // supervisor executing it had its script rewritten underneath it.
    expect(readFileSync(join(home, 'new-ccd-link'), 'utf8')).toBe('#!/bin/sh\n# the NEW ccd\n');
    expect(readFileSync(join(home, '.cc-sessions', 'session-hook.sh'), 'utf8')).toBe('OLD hook\n');
    expect(readFileSync(join(home, unitRel), 'utf8')).toBe(unitBefore);
    // … and the live data did not: memory keeps the write made during the
    // update, coord.db is the same file with the same bytes.
    expect(readFileSync(join(home, '.ccrc', 'memory', 'fixture-proj', 'MEMORY.md'), 'utf8'))
      .toBe('written while the update ran\n');
    expect(statSync(db).ino).toBe(dbIno);
    expect(readFileSync(db).equals(dbBytes), 'arm 3 restored coord.db').toBe(true);
    if (darwin) {
      // launchd's daemon-reload + restart: bootout the job it holds (the NEW
      // definition — this fixture wrote `NEW job file` over the plist), then
      // bootstrap the restored plist. A bare `kickstart -k` would restart the
      // cached new definition.
      const lc = readFileSync(join(home, 'launchctl-calls'), 'utf8').split('\n');
      const out = lc.findIndex((l) => /^bootout \S+\/app\.ccrc\.ccrc$/.test(l));
      const back = lc.findIndex((l, i) => i > out && /^bootstrap \S+ \S+\/app\.ccrc\.ccrc\.plist$/.test(l));
      expect(out, `arm 3 never booted out the job launchd held:\n${lc.join('\n')}`).toBeGreaterThan(-1);
      expect(back, 'arm 3 never bootstrapped the restored plist after the bootout').toBeGreaterThan(out);
      expect(lc.some((l) => /^kickstart -k \S+\/app\.ccrc\.ccrc$/.test(l)), 'arm 3 kickstarted the cached definition').toBe(false);
      expect(existsSync(join(home, 'systemctl-calls')), 'a Darwin restore reached systemctl').toBe(false);
    } else {
      const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8').split('\n');
      const reload = calls.indexOf('--user daemon-reload');
      const restart = calls.indexOf('--user restart ccrc.service');
      expect(reload, 'arm 3 restored unit files without daemon-reload').toBeGreaterThan(-1);
      expect(restart).toBeGreaterThan(reload);
      expect(calls.join('\n')).not.toMatch(/try-restart/);
    }
    const last = lastReport(home);
    expect(last['phase']).toBe('reverted');
    expect(String(last['detail'])).toMatch(/^arm3: tree MIXED, deploy\.sh is the remedy; gate: /);
  });

  it('an unversioned box has no tag to re-install: arm 2 says so and arm 3 runs', () => {
    const home = freshUpdateBox('ccrc-update-restore-untagged-');
    plantRestoreBox(home, { oldVersion: null });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8').split('\n')[0]).toBe('untagged');
    expect(r.stdout).toMatch(/^update: arm 2: previous build carried no tag — arm 3$/m);
    expect(restoreChildArgv(home)).toBeNull();
    expect(String(lastReport(home)['detail'])).toMatch(/^arm3: /);
  });

  // Fix round 1 item 2 / review 155 C1: arm 2 never "restores" to the tag
  // whose install just failed its gate. A same-tag `--force` reinstall
  // (this run's target IS the release that was already running) skips arm
  // 2 outright — re-installing that tag is exactly what just failed — and
  // falls straight to arm 3, the pre-update backup (which for a same-tag
  // run IS that same release). The reviewer's own probe: `update --to
  // v2.0.0 --force` on a v2.0.0 box whose gate fails ends with arm 3, NEVER
  // `REVERTED (arm 2)`, and `previous` still names v1.0.0.
  it('a same-tag --force reinstall whose gate fails skips arm 2 and falls straight to arm 3; previous still names the release before this run — a DIFFERENT staged sha keeps MIXED (fix round 1 item 2 / review 155 C1; review fix round 1 I3)', () => {
    const home = freshUpdateBox('ccrc-update-restore-sametag-');
    // NOT `plantRestoreBox({ oldVersion: 'v2.0.0' })`: that fixture's own
    // "old" and (unconditional) "target" packRelease calls both build a
    // `payload-v2.0.0` tree, and a same-tag run needs only ONE — a second
    // `stubTree` over the same path leaves a stale MANIFEST entry for
    // MANIFEST's own (about-to-be-overwritten) content, which then fails
    // its own digest check. Built directly instead, same tag, once.
    plantOldBox(home, { version: 'v2.0.0' });
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    writeFileSync(join(home, '.ccrc', 'previous'), 'v1.0.0\nbaselinesha\n');
    // `stubTree`'s own sha (`newsha…`) DIFFERS from the box's OLD_SHA — a
    // same tag, but a REBUILD, not a repeat: arm 3 must still say MIXED.
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    // The gate fails regardless of version match — /health simply never
    // answers — so the same-tag skip is exercised on its own, not masked by
    // a version-mismatch gate failure that a same-tag run could never hit.
    writeFileSync(join(home, 'fixture-health-down'), 'yes\n');
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: arm 2: this run's target is v2\.0\.0, the release that was already running — re-installing it is what just failed its gate; arm 3$/m);
    expect(restoreChildArgv(home)).toBeNull();
    expect(r.stdout).not.toMatch(/REVERTED \(arm 2\)/);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): copied the pre-update backup back — the tree is MIXED \(new shared\/, ccd\/ and node_modules under the old dists\); the remedy is deploy\.sh\. Best effort\.$/m);
    expect(String(lastReport(home)['detail'])).toBe('arm3: tree MIXED, deploy.sh is the remedy; gate: GET http://127.0.0.1:7788/health got no answer (curl exited 7)');
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe('v1.0.0\nbaselinesha\n');
  });

  // Review fix round 1 I3's other half: the SAME sha under the same tag —
  // a genuine repeat, not a rebuild — so arm 3 must say the tree is NOT
  // mixed and name the honest remedy (the gate's own failure is this box's
  // health, not its code).
  it('a same-tag --force reinstall whose STAGED sha equals the running build\'s: arm 3 says not mixed, names ccrc doctor / a plain reinstall (review fix round 1 I3, D-3288)', () => {
    const home = freshUpdateBox('ccrc-update-restore-samebuild-');
    plantOldBox(home, { version: 'v2.0.0' });
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    writeFileSync(join(home, '.ccrc', 'previous'), 'v1.0.0\nbaselinesha\n');
    // selfConvergedTree: the staged tree's OWN sha is made to match the
    // box's running stamp (OLD_SHA) — a genuine REPEAT of the release
    // already running, not a rebuild under the same tag.
    packRelease(home, selfConvergedTree(home, 'v2.0.0', OLD_SHA), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-down'), 'yes\n');
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: arm 2: this run's target is v2\.0\.0, the release that was already running — re-installing it is what just failed its gate; arm 3$/m);
    expect(r.stdout).not.toMatch(/REVERTED \(arm 2\)/);
    expect(r.stdout).not.toMatch(/MIXED/);
    expect(r.stdout).not.toMatch(/deploy\.sh is the remedy/);
    expect(r.stdout).toMatch(
      /^update: REVERTED \(arm 3\): copied the pre-update backup back — this box's tree is v2\.0\.0 again, the SAME release that was running before this update; nothing is mixed\. Read 'ccrc doctor' for why the gate failed, or once fixed: ccrc update --to v2\.0\.0 --force\. Best effort\.$/m);
    expect(String(lastReport(home)['detail'])).toBe(
      'arm3: restored v2.0.0 (same build, not mixed); gate: GET http://127.0.0.1:7788/health got no answer (curl exited 7)');
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe('v1.0.0\nbaselinesha\n');
  });

  // Fix round 2, F1 (review 167): the reviewer's own half-installed
  // same-tag probe — plantOldBox v2.0.0, NO `.ccrc/installed` (a prior
  // spine died after `_inst_stamp`, before the completed-install record —
  // `old_completed=0`), NO `.ccrc/previous` (so arm 2 falls to arm 3 via its
  // existing "absent" case, UNCHANGED by this round), the v2.0.0 release
  // packed so its STAGED sha equals the running stamp's own (`OLD_SHA`),
  // health down. Built directly (one `stubTree`/`selfConvergedTree` call for
  // the one tag), never `plantRestoreBox({ oldVersion: 'v2.0.0' })`, which
  // publishes a SECOND `payload-v2.0.0` tree and corrupts its own MANIFEST.
  // D-3288 (amended): `old_completed` must be 1, not just a staged-sha
  // match, before arm 3 may say "not mixed" — this box's backup is a
  // snapshot of a tree that was never proven whole, so arm 3 says only that
  // the PRE-UPDATE tree came back.
  it('a same-tag rerun over a half-installed tree (no completed-install record) never says "not mixed", even when the staged sha matches the running stamp (F1, D-3288 amended)', () => {
    const home = freshUpdateBox('ccrc-update-restore-halfinstalled-samebuild-');
    plantOldBox(home, { version: 'v2.0.0' });
    packRelease(home, selfConvergedTree(home, 'v2.0.0', OLD_SHA), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-down'), 'yes\n');
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(existsSync(join(home, '.ccrc', 'previous'))).toBe(false);
    expect(restoreChildArgv(home)).toBeNull();
    expect(r.stdout).not.toMatch(/REVERTED \(arm 2\)/);
    expect(r.stdout).toMatch(/^update: arm 2: no ~\/\.ccrc\/previous — the build this box ran before is not recorded — arm 3$/m);
    // T1 (review 173): the old `not.toMatch(/not mixed/)` guarded nothing —
    // the sentence it meant to keep out says "nothing is mixed", which that
    // pattern never matched. Both spellings are the claim this case forbids.
    expect(r.stdout).not.toMatch(/nothing is mixed|not mixed/);
    expect(r.stdout).not.toMatch(/deploy\.sh is the remedy/);
    expect(r.stdout).toMatch(
      /^update: REVERTED \(arm 3\): copied the pre-update backup back — this box's tree is v2\.0\.0 again, the PRE-UPDATE tree, which may itself be MIXED\. Read 'ccrc doctor' for its state, or once healthy: ccrc update --to v2\.0\.0 --force\. Best effort\.$/m);
    expect(String(lastReport(home)['detail'])).toBe(
      'arm3: restored v2.0.0 (pre-update tree, may be mixed); gate: GET http://127.0.0.1:7788/health got no answer (curl exited 7)');
  });

  // Review 173's F1r (W6 Task 8A; the coordinator's ruling: THE STAGED SHA
  // DECIDES MIXED, whatever the record says). The reviewer's input: the stamp
  // names v2.0.0 at sha A, there is no completed-install record, `previous`
  // is absent or names v2.0.0, the v2.0.0 release stages sha B, and `update
  // --to v2.0.0 --force` fails its gate. The staged install's wholesale
  // copies (shared/, the tree's ccd/, node_modules, build.json) are sha B's
  // while arm 3 copies back only the backup's `tree` rows — the tree IS mixed,
  // and the verdict must say MIXED, never "may itself be MIXED".
  it.each([
    ['previous absent', null],
    ['previous naming the target', 'v2.0.0\nbaselinesha\n'],
  ] as const)('F1r: a same-tag rerun with NO completed record whose STAGED sha differs from the running stamp\'s is MIXED, never "may be mixed" — %s (review 173, D-3288 amended)', (_what, previous) => {
    const home = freshUpdateBox('ccrc-update-restore-f1r-');
    plantOldBox(home, { version: 'v2.0.0' });                   // stamp sha OLD_SHA, no record
    if (previous !== null) writeFileSync(join(home, '.ccrc', 'previous'), previous);
    // `stubTree`'s own sha (`newsha…`) is not OLD_SHA: sha B.
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-down'), 'yes\n');
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(existsSync(join(home, '.ccrc', 'installed')), 'the fixture has a completed record — the input is wrong').toBe(false);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): copied the pre-update backup back — the tree is MIXED \(new shared\/, ccd\/ and node_modules under the old dists\); the remedy is deploy\.sh\. Best effort\.$/m);
    expect(r.stdout).not.toMatch(/may itself be MIXED|may be mixed|nothing is mixed|not mixed/i);
    expect(String(lastReport(home)['detail'])).toBe('arm3: tree MIXED, deploy.sh is the remedy; gate: GET http://127.0.0.1:7788/health got no answer (curl exited 7)');
    expect(lastReport(home)['phase']).toBe('reverted');
    // `previous` is written by no branch of arm 3, and this run kept it as it was.
    if (previous === null) expect(existsSync(join(home, '.ccrc', 'previous'))).toBe(false);
    else expect(fileText(join(home, '.ccrc', 'previous'))).toBe(previous);
  });

  // Fix round 2, F2 input (a) (review 167; rulings item 1): a same-tag rerun
  // with NO completed record still finds `previous` naming the EXACT tag
  // that just failed — the reviewer's own scenario: an earlier `update --to
  // v3.0.0` wrote `previous: v2.0.0` as ITS baseline, then its spine died
  // before the tree moved, so the box never actually left v2.0.0; a LATER
  // update resolving v2.0.0 again fails its gate too. `old_completed=0` (no
  // `.ccrc/installed`) means the FIRST arm-2 check (keyed on it) never
  // fires; only the SECOND check — `$UPD_PREV_TAG` against `$UPD_VERSION`,
  // read straight off `.ccrc/previous` — catches this. Built directly: the
  // fixture plants `previous` at the state the earlier (died) run would have
  // left it in, rather than actually running `ccrc update` twice.
  it('F2 (a): a same-tag rerun with no completed record still skips arm 2 when `previous` already names the tag that just failed (review 167)', () => {
    const home = freshUpdateBox('ccrc-update-restore-f2a-');
    plantOldBox(home, { version: 'v2.0.0' });
    // NO .ccrc/installed. `previous` already names v2.0.0 — written by an
    // earlier `update --to v3.0.0` whose spine died before the tree moved.
    writeFileSync(join(home, '.ccrc', 'previous'), `v2.0.0\n${OLD_SHA}\n`);
    // A RUNNABLE restore child (review 167 N1): without one, `~/ccrc/ccd/ccrc`
    // never exists and arm 2 falls to arm 3 for THAT reason on every tree,
    // fixed or not — the pin would then be red on 7a20ff8f for the wrong
    // cause. With the child placed, the check this pin is FOR is what decides
    // whether arm 2 ever reaches it: unfixed code has no second check, runs
    // the child (which always exits 0), and prints the false `REVERTED
    // (arm 2)` F2 describes; the check2 fix here skips arm 2 before ever
    // looking at the child.
    writeFileSync(join(home, 'fixture-restore-child'), RESTORE_RECORDER);
    writeFileSync(join(home, 'fixture-on-install'),
      'mkdir -p "$HOME/ccrc/ccd" && cp "$HOME/fixture-restore-child" "$HOME/ccrc/ccd/ccrc"\n');
    // Published TWICE: `latest/download` (this run's own no-`--to` fetch)
    // AND `download/v2.0.0` (arm 2's own bundle probe, `_upd_asset_listed
    // v2.0.0 …`, which is tag-scoped and never reads `latest`). Same tree,
    // no rebuild — `packRelease` only tars what `stubTree` already built.
    // The STAGED sha equals the running stamp's (`selfConvergedTree`): a
    // different one is MIXED since review 173's F1r (the staged sha decides),
    // and this case pins the F1/F2 interaction on the same-sha, no-record
    // verdict.
    const f2aTree = selfConvergedTree(home, 'v2.0.0', OLD_SHA);
    packRelease(home, f2aTree, { tag: 'v2.0.0' });
    packRelease(home, f2aTree, { tag: 'v2.0.0', latest: false });
    writeFileSync(join(home, 'fixture-health-down'), 'yes\n');
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(restoreChildArgv(home)).toBeNull();
    expect(r.stdout).not.toMatch(/REVERTED \(arm 2\)/);
    expect(r.stdout).toMatch(
      /^update: arm 2: previous \(v2\.0\.0\) also names v2\.0\.0, the release that just failed its gate — re-installing it would not restore anything; arm 3$/m);
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe(`v2.0.0\n${OLD_SHA}\n`);
    // The F1/F2 interaction the reviewer flagged: this same-tag, same-sha,
    // no-record run also falls into arm 3's `same_tag` branch, so it lands on
    // F1's own "may be mixed" line, never "not mixed" and never `deploy.sh`.
    expect(r.stdout).toMatch(
      /^update: REVERTED \(arm 3\): copied the pre-update backup back — this box's tree is v2\.0\.0 again, the PRE-UPDATE tree, which may itself be MIXED\. Read 'ccrc doctor' for its state, or once healthy: ccrc update --to v2\.0\.0 --force\. Best effort\.$/m);
    expect(String(lastReport(home)['detail'])).toMatch(/^arm3: restored v2\.0\.0 \(pre-update tree, may be mixed\); gate: /);
  });

  // Fix round 2, F2 input (b) (review 167; rulings item 1): the reviewer's
  // OTHER input — the stamp is v2.0.0 with NO completed record, `previous`
  // names v1.0.0, then `update --to v1.0.0 --downgrade`. `_upd_write_previous`
  // KEEPS v1.0.0 (D-3254 (b): no completed record, but a well-formed
  // `previous` to keep), so by the time the gate fails, `previous` names
  // EXACTLY the tag this run just failed to install — arm 2's second check
  // must catch it even though `old_version` (v2.0.0) and `UPD_VERSION`
  // (v1.0.0) plainly differ, so the FIRST check never even looks.
  it('F2 (b): a downgrade with no completed record skips arm 2 when `previous` already names the target that just failed (review 167)', () => {
    const home = freshUpdateBox('ccrc-update-restore-f2b-');
    plantOldBox(home, { version: 'v2.0.0' });
    // NO .ccrc/installed. `previous` already names v1.0.0.
    writeFileSync(join(home, '.ccrc', 'previous'), 'v1.0.0\nbaselinesha\n');
    // A RUNNABLE restore child (review 167 N1) — see F2 (a)'s comment for why
    // one is needed: without it, arm 2 falls to arm 3 on EVERY tree because
    // `~/ccrc/ccd/ccrc` is absent, not because of the check this pin is for.
    writeFileSync(join(home, 'fixture-restore-child'), RESTORE_RECORDER);
    writeFileSync(join(home, 'fixture-on-install'),
      'mkdir -p "$HOME/ccrc/ccd" && cp "$HOME/fixture-restore-child" "$HOME/ccrc/ccd/ccrc"\n');
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    writeFileSync(join(home, 'fixture-health-down'), 'yes\n');
    const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(restoreChildArgv(home)).toBeNull();
    expect(r.stdout).not.toMatch(/REVERTED \(arm 2\)/);
    expect(r.stdout).toMatch(
      /^update: arm 2: previous \(v1\.0\.0\) also names v1\.0\.0, the release that just failed its gate — re-installing it would not restore anything; arm 3$/m);
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe('v1.0.0\nbaselinesha\n');
  });

  // Review fix round 1 I4: item 2's same-tag skip narrows to a COMPLETED
  // install of the running tag. D-3240's own scenario — a spine that died
  // after `_inst_stamp` (the stamp reads the new tag, no completed-install
  // record) — reruns `ccrc update --to <v> --force`, which is a SAME-TAG
  // run by the stamp, but the box was never WHOLE on that tag: arm 2 must
  // still restore `previous` (v1.0.0, the last DIFFERENT, COMPLETED
  // release), never fall straight to arm 3 over the half-installed tree
  // this very rerun started from.
  it('a same-tag rerun over a HALF-installed tree (record absent) still lets arm 2 restore previous, a DIFFERENT release (review fix round 1 I4)', () => {
    const home = freshUpdateBox('ccrc-update-restore-halfinstalled-sametag-');
    plantOldBox(home, { version: 'v2.0.0' });   // stamp already reads v2.0.0 (the dead spine moved it)
    // NO .ccrc/installed at all: that spine died before its own record.
    writeFileSync(join(home, '.ccrc', 'previous'), 'v1.0.0\nbaselinesha\n');
    // v1.0.0: arm 2's own fetch target — a separate tree, no MANIFEST clash.
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    // v2.0.0 (this rerun's target, same tag as the stamp): swaps in the
    // RESTORE_RECORDER after its own "install" step, exactly as
    // `plantRestoreBox` does, so arm 2's child (which also runs
    // `$BOX_TREE_DIR/ccd/ccrc`, the SAME tree) hits the recorder rather
    // than a bare stub.
    writeFileSync(join(home, 'fixture-restore-child'), RESTORE_RECORDER);
    writeFileSync(join(home, 'fixture-on-install'),
      'mkdir -p "$HOME/ccrc/ccd" && cp "$HOME/fixture-restore-child" "$HOME/ccrc/ccd/ccrc"\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-pin'), 'v1.0.0\n');   // the gate never sees v2.0.0: FAILS
    // No --to: v2.0.0 is published as latest/download (packRelease's own
    // default), matching D-3240's prescribed rerun resolving the same way
    // the original (now half-installed) run did.
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    // Arm 2 restores v1.0.0 — a REAL restore child ran, never the same-tag
    // skip line.
    expect(r.stdout).not.toMatch(/this run's target is v2\.0\.0, the release that was already running/);
    expect(restoreChildArgv(home)).toEqual([
      join(home, 'ccrc', 'ccd', 'ccrc'), 'update', '--to', 'v1.0.0', '--no-gate', '--from', 'restore',
    ]);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 2\): this box runs v1\.0\.0 again, re-installed from its release — gate: /m);
    expect(r.stdout).not.toMatch(/REVERTED \(arm 3\)/);
    const last = lastReport(home);
    expect(last['phase']).toBe('reverted');
    expect(String(last['detail'])).toMatch(/^arm2: restored v1\.0\.0; gate: /);
  });

  it('a `previous` that went missing or unreadable after it was written falls to arm 3 by name — never a guessed tag', () => {
    const cases: Array<[string, string, RegExp]> = [
      ['absent', 'rm -f "$HOME/.ccrc/previous"', /^update: arm 2: no ~\/\.ccrc\/previous — the build this box ran before is not recorded — arm 3$/m],
      ['malformed', 'printf \'three\\n\' > "$HOME/.ccrc/previous"', /^update: arm 2: ~\/\.ccrc\/previous is unreadable or malformed — arm 3$/m],
    ];
    for (const [name, line, says] of cases) {
      const home = freshUpdateBox(`ccrc-update-restore-prev-${name}-`);
      plantRestoreBox(home, { onInstall: [line] });
      const r = runUpdate(home);
      expect(r.code, `${name}: stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
      expect(r.stdout, name).toMatch(says);
      expect(restoreChildArgv(home), name).toBeNull();
      expect(String(lastReport(home)['detail']), name).toMatch(/^arm3: /);
    }
  });

  it('a spine that died after the tree moved, then failed the gate, restores and exits 4 — the reason names the step (completes §18 "a spine death after the tree moved reverts")', () => {
    const home = freshUpdateBox('ccrc-update-restore-spine-');
    plantRestoreBox(home, { installExit: 1 });
    writeFileSync(join(home, 'fixture-install-step'), '_inst_skills\n');   // Task 4's knob
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    const details = reportWrites(home).map((w) => `${String(w['phase'])} ${String(w['detail'])}`);
    expect(details).toContain('failed spine died at _inst_skills');
    expect(restoreChildArgv(home)).toEqual([
      join(home, 'ccrc', 'ccd', 'ccrc'), 'update', '--to', 'v1.0.0', '--no-gate', '--from', 'restore',
    ]);
    expect(String(lastReport(home)['detail'])).toMatch(/^arm2: restored v1\.0\.0; spine died at _inst_skills; gate: /);
  });

  it('a fleet box\'s arm 3 restarts ccrc-agent.service — the unit that box has — and never ccrc.service', () => {
    const home = freshUpdateBox('ccrc-update-restore-fleet-');
    plantRestoreBox(home, { child: 'broken' });
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=fleet\n');
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');   // Task 5's knob: the fleet gate fails (Linux)…
    writeFileSync(join(home, 'fixture-main-pid-churn'), 'yes\n'); // …and its Darwin twin (launchd has no is-active)
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
    if (process.platform === 'darwin') {
      const calls = readFileSync(join(home, 'launchctl-calls'), 'utf8');
      expect(calls).toMatch(/^bootout \S+\/app\.ccrc\.ccrc-agent$/m);
      expect(calls).toMatch(/^bootstrap \S+ \S+\/app\.ccrc\.ccrc-agent\.plist$/m);
      expect(calls).not.toMatch(/^bootout \S+\/app\.ccrc\.ccrc$/m);
      expect(calls).not.toMatch(/^bootstrap \S+ \S+\/app\.ccrc\.ccrc\.plist$/m);
    } else {
      const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8');
      expect(calls).toMatch(/^--user restart ccrc-agent\.service$/m);
      expect(calls).not.toMatch(/^--user restart ccrc\.service$/m);
    }
  });

  it('a release host that answers 503 to the bundle question is not "ships no bundle": arm 2 runs the child without --allow-unsigned and lets its own fetch decide', () => {
    const home = freshUpdateBox('ccrc-update-restore-host-5xx-');
    // Planted by the new tree's install, i.e. AFTER the parent fetched its own
    // release: only arm 2's question meets the 503.
    plantRestoreBox(home, { onInstall: ['printf \'503\\n\' > "$HOME/fixture-release-http"'] });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    // Fix round 1 item 12: the message now names the probe's own timeout bound.
    expect(r.stdout).toMatch(/^update: arm 2: could not ask the release host whether v1\.0\.0 ships a bundle within \d+s \(curl failed, timed out, or the host answered neither 200 nor 404\) — the restore child's own fetch decides$/m);
    expect(r.stdout).not.toMatch(/arm2-refused/);
    expect(restoreChildArgv(home)).toEqual([
      join(home, 'ccrc', 'ccd', 'ccrc'), 'update', '--to', 'v1.0.0', '--no-gate', '--from', 'restore',
    ]);
    expect(String(lastReport(home)['detail'])).toMatch(/^arm2: restored v1\.0\.0; gate: /);
  });

  it('a spine that COMPLETED and then failed its gate, restored by arm 3: the completed-install record goes, so the box reads incomplete — never converged on the release it backed out of', () => {
    const home = freshUpdateBox('ccrc-update-restore-unrecord-');
    // What a completed v2.0.0 spine leaves before the gate runs: its stamp and
    // its completed-install record, agreeing. That pair is what
    // `_upd_converged` and `update --check` read as "current at v2.0.0".
    const newSha = 'newsha0000000000000000000000000000000000';
    plantRestoreBox(home, {
      child: 'broken',
      onInstall: [
        `printf '%s\\n' '${shippedStamp('v2.0.0', newSha).trim()}' > "$HOME/.ccrc/build.json"`,
        `printf '%s\\n' '${newSha}' > "$HOME/.ccrc/installed"`,
      ],
    });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
    expect(r.stdout).toMatch(/^update: arm 3: the completed-install record is gone — this box reads install: incomplete until deploy\.sh or a completed update records it again$/m);
    expect(existsSync(join(home, '.ccrc', 'installed')), 'arm 3 left the reverted build\'s record').toBe(false);
    // The stamp still names v2.0.0 (arm 3 copies no stamp back; the tree is
    // MIXED), so the honest word is `incomplete` — never `current`.
    const c = runUpdate(home, ['--check']);
    // RULING C1: `cmd_update --check`'s `incomplete` arm returns 1 (D-3266
    // keeps incomplete/exit 1) — not the 0 an earlier draft of this case typed.
    expect(c.code, `stderr: ${c.stderr}\nstdout: ${c.stdout}`).toBe(1);
    expect(c.stdout).toMatch(new RegExp(`^check: box=v2\\.0\\.0 sha=${newSha} target=v2\\.0\\.0 (.* )?state=incomplete$`, 'm'));   // Task 12 adds fields before `state=`
  });

  it('--from restore is refused unless this run is the child of an update holding the lock — it is not a typed way past the floor or the sweep', () => {
    const home = freshUpdateBox('ccrc-update-from-restore-bare-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    // No marker at all, and a marker naming a pid that is not this run's parent.
    for (const extra of [{}, { CCRC_UPDATE_LOCK_HELD: '1' }]) {
      const r = runUpdate(home, ['--to', 'v2.0.0', '--from', 'restore'], extra);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
      expect(r.stderr).toMatch(/^ccrc: update: --from restore is the automatic restore's own word — it runs only as the child of an update holding ~\/\.ccrc\/update\.lock \(it skips the floor, previous and the sweep\); to move this box to a tag by hand: ccrc update --to <tag> --downgrade$/m);
      expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
      expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
      expect(localUrls(home)).toEqual([]);
    }
  });

  it('FULL flavour: the arm-2 child is a REAL `ccrc update` that completes under the parent\'s lock — no lock sentence, no sweep, the previous tag re-installed (§18 "arm 2 runs under the parent\'s lock"; Review Focus 4)', () => {
    // The parent installs the FULL v2.0.0 tree (the real spine places the
    // real `ccd/ccrc` at ~/ccrc/ccd/ccrc), fails its gate, and arm 2 runs that
    // placed ccrc as a child against the STUB v1.0.0 release. The child's own
    // lock (Task 2) must INHERIT — marker = its $PPID, and a fresh flock -n
    // fails because the parent holds the lock — or it refuses with "another
    // update holds …" and every restore silently becomes arm 3.
    const home = freshUpdateBox('ccrc-update-restore-full-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-pin'), 'v1.0.0\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(`${r.stdout}\n${r.stderr}`).not.toMatch(/another update holds/);
    expect(`${r.stdout}\n${r.stderr}`).not.toMatch(/ambiguous redirect/);
    expect(r.stderr).not.toMatch(/--from restore is the automatic restore's own word/);
    // The child's own transcript: it kept `previous`, skipped the sweep, and
    // its staged install (the STUB v1.0.0 shim) actually ran.
    expect(r.stdout).toMatch(/^update: previous: kept \(v1\.0\.0\)/m);
    // The two exemptions a bare --from restore can no longer be typed to
    // reach (Step 1 (c)), measured here on the real child: the parent's
    // completed spine raised the floor to v2.0.0, and the restore goes below
    // it saying so, without lowering it (spec §9, Task 1's `--from` arm).
    expect(r.stdout).toMatch(/^update: WARN: v1\.0\.0 is below this box's floor v2\.0\.0 \(resolved by --to v1\.0\.0\) — proceeding because this run is --from restore; the floor stays v2\.0\.0$/m);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v2.0.0\n');
    expect(r.stdout).toMatch(/^update: sweep: skipped — a --from restore run returns the supervisors' own build; they never moved$/m);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the restore child\'s staged install never ran').toBe(true);
    expect(localUrls(home)).toContain(`local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz`);
    const writes = reportWrites(home);
    expect(writes.some((w) => w['from'] === 'restore' && w['phase'] === 'installing'),
      'the child reported no install of its own').toBe(true);
    const last = lastReport(home);
    expect(last['phase']).toBe('reverted');
    expect(last['from']).toBe('cli');
    expect(String(last['detail'])).toMatch(/^arm2: restored v1\.0\.0; gate: /);
    expect(r.stdout).not.toMatch(/REVERTED \(arm 3\)/);
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8').split('\n')[0]).toBe('v1.0.0');
  });

  // Fix round 1 item 16 / review 155 C25: the backup directory has ONE-
  // SECOND resolution and `mkdir -p` used to accept one that already
  // exists — so arm 2's child, starting its own backup in the SAME SECOND
  // as the parent's (both real `ccrc update` runs, `date` frozen here so
  // the review's probe is deterministic rather than a real-clock race),
  // would `cp -a` its files INTO the parent's own backup directory,
  // corrupting it (overwriting `ccd`, nesting dists inside dists). Now the
  // child's OWN `_upd_backup` refuses outright — arm 2 falls to arm 3
  // reporting "arm 2 failed", and arm 3 restores the PARENT's backup,
  // which the child's refused mkdir never touched.
  it('the same-second parent and child: the child\'s backup refuses rather than corrupting the parent\'s, and arm 3 restores the UNCORRUPTED one (fix round 1 item 16 / review 155 C25)', () => {
    const home = freshUpdateBox('ccrc-update-restore-samesecond-backup-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-pin'), 'v1.0.0\n');
    // ONE frozen backup timestamp for every `date +%Y%m%d-%H%M%S` this run's
    // processes make — the parent's own backup AND arm 2's child's, so the
    // collision is deterministic rather than a real-clock race. Everything
    // else (`+%s`, doctor's own date reads) passes through to the real
    // binary, untouched.
    writeFileSync(join(home, 'doctor-stubs', 'date'),
      '#!/bin/sh\n'
      + 'if [ "$#" -eq 1 ] && [ "$1" = "+%Y%m%d-%H%M%S" ]; then echo "20260101-000000"; exit 0; fi\n'
      + `exec ${REAL_DATE} "$@"\n`, { mode: 0o755 });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    const backupDir = join(home, 'ccrc-backups', '20260101-000000');
    // The child's own refusal, on ITS stderr (inherited straight through) —
    // never a corrupted copy. Fix round 1 item 11 / review 155 C17: the
    // absolute HOME is redacted to `~` by `_ccrc_die`'s own hook now, so
    // this reads `~/ccrc-backups/…`, never the fixture's own tmp path (the
    // FILESYSTEM checks below still use the real `backupDir`, unredacted).
    // Review fix round 1, N3: the verdict now leads (D-3249), matching the
    // reordered floor sentences.
    expect(r.stderr).toMatch(
      /^ccrc: already exists: ~\/ccrc-backups\/20260101-000000 \(another backup started in the same second\) — refusing to reuse a backup directory; nothing on this box was changed by this step$/m);
    expect(r.stdout).toMatch(/^update: arm 2 failed \(the restore child exited 1\) — falling to arm 3$/m);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
    expect(r.stdout).not.toMatch(/REVERTED \(arm 2\)/);
    // The PARENT's own backup — the only one that ever wrote a single file —
    // still holds the OLD (v1.0.0) tree it snapshotted before installing
    // v2.0.0, never overwritten by the child's refused attempt.
    expect(existsSync(join(backupDir, 'ccd'))).toBe(true);
    expect(readFileSync(join(backupDir, 'ccd'), 'utf8')).toContain('the OLD ccd');
    const last = lastReport(home);
    expect(last['phase']).toBe('reverted');
    expect(String(last['detail'])).toMatch(/^arm3: /);
  });
});

// Final review, B4 — D-3259's own promise, unnumbered (no new deviation):
// arm 3's per-row placement, sourced directly with `_plat_mv_notdir`
// shadowed so a specific call can be made to fail without a real filesystem
// race. Every case needs `live` to already be a REAL directory (not a
// symlink) — the branch `_upd_restore_copy` takes the aside/stage path for
// at all.
describe('_upd_restore_copy (arm 3\'s per-row placement): the move-back is checked (B4, was unchecked)', () => {
  const setup = (prefix: string): { home: string; back: string; live: string } => {
    // freshUpdateBox, not bare mkTmp: `sourcedCcrc` runs under `updateEnv`,
    // which plants its stubs into `~/.local/bin` and expects it to exist.
    const home = freshUpdateBox(prefix);
    const back = join(home, 'back');
    const live = join(home, 'live');
    mkdirSync(back, { recursive: true });
    writeFileSync(join(back, 'NEW-CONTENT'), 'the backup copy\n');
    mkdirSync(live, { recursive: true });
    writeFileSync(join(live, 'CURRENT-CONTENT'), 'what the new install placed\n');
    return { home, back, live };
  };
  /** `n=2` fails the stage→live rename; `n=3` (if reached) fails the
   *  move-back. Every other call is the REAL `mv -fT`, so the fixture
   *  measures the function's own recovery, not a mocked filesystem. */
  const shadow = (failCalls: number[]): string => [
    'n=0',
    '_plat_mv_notdir() {',
    '  n=$((n + 1))',
    `  case " ${failCalls.join(' ')} " in *" \${n} "*) return 1 ;; esac`,
    '  mv -fT -- "$1" "$2"',
    '}',
  ].join('\n');

  itLinux('both the stage→live rename AND the move-back fail: rc 2, live is GONE, the new install\'s copy survives at aside', () => {
    const { home, back, live } = setup('ccrc-restore-copy-rc2-');
    const r = sourcedCcrc(home, [
      shadow([2, 3]),
      `_upd_restore_copy '${back}' '${live}'; echo "rc=$?"`,
    ].join('\n'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('rc=2');
    expect(existsSync(live), 'arm 3 must never claim the row was "left as placed" when live does not exist').toBe(false);
    const leftover = readdirSync(home).find((n) => n.startsWith('live.ccrc-replaced.'));
    expect(leftover, 'the new install\'s own copy must survive somewhere findable').toBeDefined();
    expect(readFileSync(join(home, leftover!, 'CURRENT-CONTENT'), 'utf8')).toBe('what the new install placed\n');
    // The staging copy of the backup is cleaned up either way.
    expect(readdirSync(home).some((n) => n.startsWith('live.ccrc-restore.'))).toBe(false);
  });

  itLinux('the stage→live rename fails but the move-back SUCCEEDS: rc 1, live is unchanged — the ordinary "left as placed" arm', () => {
    const { home, back, live } = setup('ccrc-restore-copy-rc1-');
    const r = sourcedCcrc(home, [
      shadow([2]),
      `_upd_restore_copy '${back}' '${live}'; echo "rc=$?"`,
    ].join('\n'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('rc=1');
    expect(existsSync(live)).toBe(true);
    expect(readFileSync(join(live, 'CURRENT-CONTENT'), 'utf8')).toBe('what the new install placed\n');
    expect(existsSync(join(live, 'NEW-CONTENT'))).toBe(false);
    // No aside or stage copy left behind — this is the ordinary failure arm.
    expect(readdirSync(home).some((n) => n.startsWith('live.ccrc-replaced.'))).toBe(false);
    expect(readdirSync(home).some((n) => n.startsWith('live.ccrc-restore.'))).toBe(false);
  });

  itLinux('every rename succeeds: rc 0, live now holds the backup, and a failed `rm -rf` on the pre-restore copy is a WARN, not a failure', () => {
    const { home, back, live } = setup('ccrc-restore-copy-rc0-');
    const r = sourcedCcrc(home, `_upd_restore_copy '${back}' '${live}'; echo "rc=$?"`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('rc=0');
    expect(readFileSync(join(live, 'NEW-CONTENT'), 'utf8')).toBe('the backup copy\n');
    expect(existsSync(join(live, 'CURRENT-CONTENT'))).toBe(false);
    expect(readdirSync(home).some((n) => n.startsWith('live.ccrc-replaced.'))).toBe(false);

    // B4 (no new deviation): a `rm -rf` failure on the pre-restore copy is
    // disk debris, not a wrong claim about where the tree is — checked, but
    // only for a WARN.
    const { home: home2, back: back2, live: live2 } = setup('ccrc-restore-copy-rm-warn-');
    const r2 = sourcedCcrc(home2, [
      // Only the ONE call arm 3's fix added — removing the pre-restore
      // copy on the SUCCESS path — fails; every other `rm` (the stage
      // dir's own setup/teardown) is the real command, or the function
      // could never reach the row it is meant to test.
      'rm() {',
      '  case "$*" in',
      '    "-rf -- "*.ccrc-replaced.*) return 1 ;;',
      '  esac',
      '  command rm "$@"',
      '}',
      `_upd_restore_copy '${back2}' '${live2}'; echo "rc=$?"`,
    ].join('\n'));
    expect(r2.code, r2.stderr).toBe(0);
    expect(r2.stdout).toContain('rc=0');
    expect(r2.stderr).toMatch(/WARN: could not remove .*\.ccrc-replaced\..* \(the pre-restore copy of/);
    expect(readFileSync(join(live2, 'NEW-CONTENT'), 'utf8')).toBe('the backup copy\n');
  });

  // Final review, B4 (no new deviation): `_upd_restore_arm3`'s own wiring of
  // a `_upd_restore_copy` rc-2 row — shadowed directly here rather than
  // through a full spine, so this measures arm 3's MESSAGE, not the
  // filesystem race the tests above already cover.
  itLinux('arm 3 never says "left as the new install placed it" for a row `_upd_restore_copy` reports MISSING (B4)', () => {
    const home = freshUpdateBox('ccrc-restore-arm3-missing-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'installed'), 'somesha0000000000000000000000000000000\n');
    mkdirSync(join(home, 'backups'), { recursive: true });
    const r = sourcedCcrc(home, [
      // One row, forced to the rc-2 (move-back also failed) arm — the exact
      // naming convention `_upd_restore_copy` itself uses.
      `_upd_backup_pairs() { printf 'tree\\t%s/live-row\\t%s\\n' "$HOME" 'live-row'; }`,
      'mkdir -p "$HOME/backups/live-row"',
      '_upd_restore_copy() { return 2; }',
      'UPD_BACKUP_DIR="$HOME/backups"',
      '_upd_restore_arm3 server "gate: fixture reason"',
    ].join('\n'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`arm 3: ${home}/live-row is now MISSING — the new install's copy could not be moved back and sits at ${home}/live-row\\.ccrc-replaced\\.\\d+ — move it back by hand`));
    expect(r.stdout).not.toMatch(/left as the new install placed it/);
    expect(r.stdout).toMatch(/tree is MIXED AND 1 path\(s\) are MISSING/);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
  });

  // Review 173's T3: arm 3's three verdicts each have a MISSING-rows form, and
  // only the MIXED one was pinned. One row forced to `_upd_restore_copy`'s
  // rc 2, the arm called directly with each verdict's inputs — the same
  // shadowing the B4 case above uses — and the sentence AND the report detail
  // asserted for each.
  const ARM3_SHA_A = 'a'.repeat(40);
  const ARM3_SHA_B = 'b'.repeat(40);
  it.each([
    // [verdict, old_sha, staged sha, old_completed, stdout, detail]
    ['same_tag (same sha, no record)', ARM3_SHA_A, ARM3_SHA_A, 0,
      /^update: REVERTED \(arm 3\): copied the pre-update backup back — this box's tree is v2\.0\.0 again, the PRE-UPDATE tree, which may itself be MIXED, AND 1 path\(s\) are MISSING \(read the arm 3 lines above for where\)\. Read 'ccrc doctor' for its state, or once healthy: ccrc update --to v2\.0\.0 --force\. Best effort\.$/m,
      /^arm3: restored v2\.0\.0 \(pre-update tree, may be mixed\) with 1 path\(s\) MISSING \(1 of 1 rows could not be copied back\); gate: fixture reason$/],
    ['same_build (same sha, completed record)', ARM3_SHA_A, ARM3_SHA_A, 1,
      /^update: REVERTED \(arm 3\): copied the pre-update backup back — this box's tree is v2\.0\.0 again \(the SAME release that was running before this update; nothing is mixed\) AND 1 path\(s\) are MISSING \(read the arm 3 lines above for where\)\. Read 'ccrc doctor' for why the gate failed, or once fixed: ccrc update --to v2\.0\.0 --force\. Best effort\.$/m,
      /^arm3: restored v2\.0\.0 \(same build, not mixed\) with 1 path\(s\) MISSING \(1 of 1 rows could not be copied back\); gate: fixture reason$/],
    ['MIXED (a staged sha that differs, a completed record)', ARM3_SHA_A, ARM3_SHA_B, 1,
      /^update: REVERTED \(arm 3\): copied the pre-update backup back — the tree is MIXED AND 1 path\(s\) are MISSING \(read the arm 3 lines above for where\); the remedy is deploy\.sh\. Best effort\.$/m,
      /^arm3: tree MIXED with 1 path\(s\) MISSING, deploy\.sh is the remedy \(1 of 1 rows could not be copied back\); gate: fixture reason$/],
    ['MIXED (a staged sha that differs, no record)', ARM3_SHA_A, ARM3_SHA_B, 0,
      /^update: REVERTED \(arm 3\): copied the pre-update backup back — the tree is MIXED AND 1 path\(s\) are MISSING \(read the arm 3 lines above for where\); the remedy is deploy\.sh\. Best effort\.$/m,
      /^arm3: tree MIXED with 1 path\(s\) MISSING, deploy\.sh is the remedy \(1 of 1 rows could not be copied back\); gate: fixture reason$/],
  ] as const)('arm 3\'s MISSING-rows form of each verdict says what is true, in its sentence and in update.json: %s (review 173 T3, F1r)', (_verdict, oldSha, stagedSha, oldCompleted, line, detail) => {
    const home = freshUpdateBox('ccrc-restore-arm3-missing-forms-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    mkdirSync(join(home, 'backups', 'live-row'), { recursive: true });
    const r = sourcedCcrc(home, [
      `_upd_backup_pairs() { printf 'tree\\t%s/live-row\\t%s\\n' "$HOME" 'live-row'; }`,
      '_upd_restore_copy() { return 2; }',
      'UPD_BACKUP_DIR="$HOME/backups"',
      'UPD_VERSION=v2.0.0',
      `UPD_STAGED_SHA=${stagedSha}`,
      `_upd_restore_arm3 server "gate: fixture reason" v2.0.0 ${oldSha} ${oldCompleted}`,
    ].join('\n'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(line);
    expect(String(lastReport(home)['detail'])).toMatch(detail);
    expect(lastReport(home)['phase']).toBe('reverted');
  });
});

describe('ccrc rollback (design §11 — a verb, not a recipe)', () => {
  // A rollback IS update's own path, run in-process under update's lock as
  // `cmd_update --to <tag> --downgrade --from rollback|watchdog`
  // (D-3236, D-3262), so
  // every harness piece is this file's: the STUB flavour, the local://
  // release space (a rollback target is a PINNED tag, so it lives under
  // download/<tag>/, never latest/), the systemctl recorder, Task 1's
  // update-json-writes recorder, Task 3's systemd-run recorder, Task 4's
  // install-step knob and Task 5's /health knobs. The sweep cases are
  // `itLinux` because KillMode is systemd's word; the Darwin siblings at the
  // end assert the same outcomes in launchd's.
  const PREV_SHA = 'a'.repeat(40);
  const PREV = `v1.0.0\n${PREV_SHA}\n`;
  const report = (home: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
  const writtenPhases = (home: string): string[] => (existsSync(join(home, 'update-json-writes'))
    ? readFileSync(join(home, 'update-json-writes'), 'utf8').split('\n').filter((l) => l !== '')
      .map((l) => String((JSON.parse(l) as { phase: unknown }).phase))
    : []);
  const systemctlCalls = (home: string): string => (existsSync(join(home, 'systemctl-calls'))
    ? readFileSync(join(home, 'systemctl-calls'), 'utf8') : '');
  const sums = (home: string, tag: string): string =>
    `local://${home}/releases/download/${tag}/SHA256SUMS`;
  const pause = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

  /** The shape every real rollback starts from: a box on v2.0.0 whose install
   *  completed (the record equals `plantOldBox`'s stamp sha), whose floor the
   *  last update raised to v2.0.0, and a published v1.0.0 under
   *  download/v1.0.0/. `previous` is planted only when a case names one. */
  const rollbackBox = (prefix: string, opts: {
    previous?: string; marker?: string; bundle?: boolean; installExit?: number;
  } = {}): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v2.0.0' });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'floor'), 'v2.0.0\n');
    writeFileSync(join(home, '.ccrc', 'installed'),
      opts.marker ?? 'oldsha0000000000000000000000000000000000\n');
    if (opts.previous !== undefined) writeFileSync(join(home, '.ccrc', 'previous'), opts.previous);
    packRelease(home, stubTree(home, { version: 'v1.0.0', installExit: opts.installExit }),
      { tag: 'v1.0.0', latest: false, bundle: opts.bundle });
    return home;
  };

  /** `runUpdate` with the verb swapped — the CHECKOUT's ccrc against the
   *  fixture box. No address is set: `updateEnv` deletes CCRC_ADDR exactly as
   *  for `runUpdate`, and the gate then probes `127.0.0.1:7788`, the one the
   *  curl stub answers (Task 5, D-3255), so
   *  `_upd_fleet_warn` stays as silent here as in every update case. The
   *  zero-second gate window is Task 5's `updateEnv` default, restated so a
   *  case here never waits 90 s if that default moves. No lock marker leaks
   *  in from the runner. */
  function runRollback(home: string, args: string[] = [],
    extraEnv: NodeJS.ProcessEnv = {}): Result {
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
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', ...args],
      { env, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  it('the argument surface: -h is usage at exit 0; an unknown argument, a mis-shaped --to and a --from outside the vocabulary are exit 2 — before anything is fetched', () => {
    const home = rollbackBox('ccrc-rollback-args-', { previous: PREV });
    let r = runRollback(home, ['-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^ {2}rollback {2}return this box to an earlier published release/m);
    r = runRollback(home, ['--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --bogus/m);
    r = runRollback(home, ['--to', 'latest']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: rollback: --to expects a release tag shaped vX\.Y\.Z \(got: latest\)$/m);
    r = runRollback(home, ['--from', 'bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: rollback: --from expects one of cli pwa restore rollback watchdog rollout \(got: bogus\)$/m);
    r = runRollback(home, ['--from']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: rollback: --from needs a value: one of cli pwa restore rollback watchdog rollout$/m);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before a usage refusal').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('no ~/.ccrc/previous: exit 1, "nothing to roll back to", naming --to — nothing fetched, no lock opened, no report written', () => {
    const home = rollbackBox('ccrc-rollback-noprev-');
    const r = runRollback(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rollback: nothing to roll back to — ~\/\.ccrc\/previous is absent .*; name one: ccrc rollback --to vX\.Y\.Z$/m);
    expect(existsSync(join(home, 'curl-argv')), 'a missing previous fell back to a fetch').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.lock'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('a previous that carries no tag, or cannot be read as one, refuses by name (exit 1) — never falls back to latest', () => {
    const untagged = rollbackBox('ccrc-rollback-untagged-', { previous: `untagged\n${PREV_SHA}\n` });
    let r = runRollback(untagged);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      `ccrc: rollback: the build before the last update carried no release tag (previous: untagged ${PREV_SHA}) — name one: ccrc rollback --to vX.Y.Z`);
    expect(existsSync(join(untagged, 'curl-argv'))).toBe(false);
    const bad = rollbackBox('ccrc-rollback-badprev-', { previous: 'three\n' });
    r = runRollback(bad);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rollback: ~\/\.ccrc\/previous is unreadable or malformed \(line 1 must be a release tag vX\.Y\.Z or 'untagged'\)/m);
    expect(existsSync(join(bad, 'curl-argv'))).toBe(false);
  });

  // D-3285 (final review, B3(i)): a box already running `to`, with a
  // COMPLETED install of it, used to fall into `cmd_update`'s own converged
  // no-op — "pass --force to reinstall", a command `rollback` has no
  // `--force` for, and `update --force` is refused by the floor (M7).
  // Caught in `cmd_rollback` itself now, before any network call or lock.
  it('rolling back to the release already running, whose install completed, prints a runnable remedy and exits 0 — nothing fetched, no lock, no report (D-3285)', () => {
    const home = rollbackBox('ccrc-rollback-converged-');
    const r = runRollback(home, ['--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toBe(
      'rollback: this box already runs v2.0.0 (oldsha0000000000000000000000000000000000)'
      + ' and that install completed — nothing to do'
      + ' (to reinstall it: ccrc update --to v2.0.0 --downgrade --force)\n');
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the converged check').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.lock'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  // Bare `ccrc rollback` twice: the first run does not rewrite `previous`
  // (`--from rollback` is one of `_upd_write_previous`'s D-3254 keeps), so a
  // second bare run resolves the SAME tag from ~/.ccrc/previous — this is
  // the scenario the MUST-FIX text names directly.
  it('a bare rollback run twice: the second run is the converged case above, resolved from ~/.ccrc/previous (D-3285)', () => {
    const home = rollbackBox('ccrc-rollback-converged-twice-', { previous: 'v2.0.0\noldsha0000000000000000000000000000000000\n' });
    const r = runRollback(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^rollback: this box already runs v2\.0\.0 \(oldsha0+\) and that install completed — nothing to do \(to reinstall it: ccrc update --to v2\.0\.0 --downgrade --force\)$/m);
    expect(existsSync(join(home, 'curl-argv'))).toBe(false);
  });

  // The converged check reads the RUNNING stamp's own sha against the
  // record — a box whose completed-install record names a DIFFERENT sha (a
  // stale record from before the running build) is not converged and must
  // still roll back normally.
  it('a record naming a DIFFERENT sha than the running stamp is NOT converged — the rollback proceeds (D-3285)', () => {
    const home = rollbackBox('ccrc-rollback-not-converged-', {
      previous: PREV,
      marker: 'differentsha00000000000000000000000000\n',
    });
    // Publish v2.0.0 too, beside rollbackBox's default v1.0.0, so a genuine
    // (non-converged) rollback to the box's own running tag has somewhere
    // to fetch from.
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runRollback(home, ['--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/nothing to do/);
    expect(existsSync(join(home, 'curl-argv')), 'the ordinary rollback path must still run').toBe(true);
  });

  // RE-REVIEW (same D-3285, one clause added): the converged pre-check's
  // early `return 0` writes no report at all. `cmd_watchdog` only records
  // when the rollback IT runs answers non-zero, so a `--from watchdog` (or
  // any non-`cli`) run landing on this early return would leave
  // `update.json` stuck `checking`/`restarting` forever — the next tick
  // sees the same stale report and rolls back again, looping. Fixed: the
  // pre-check now applies ONLY to `--from cli` (the default, a hand-typed
  // run); every other `--from` falls through to `cmd_update`'s own
  // converged no-op, which DOES write a terminal `done`.
  it('`ccrc rollback --from pwa` on a converged box reaches cmd_update\'s own converged path and ends update.json `done`, not untouched (re-review fix)', () => {
    const home = rollbackBox('ccrc-rollback-converged-pwa-');
    // Publish v2.0.0 (the box's own running tag), its build.json sha made to
    // match the box's own stamp — `_upd_converged`'s real comparison, which
    // the non-shortcut path this run now takes must actually satisfy.
    packRelease(home, selfConvergedTree(home, 'v2.0.0', 'oldsha0000000000000000000000000000000000'),
      { tag: 'v2.0.0', latest: false });
    const r = runRollback(home, ['--to', 'v2.0.0', '--from', 'pwa']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // NOT cmd_rollback's own shortcut sentence (the pre-check is skipped for
    // this `--from`) — it reaches cmd_update's OWN converged message instead,
    // a DIFFERENT sentence that also happens to say "nothing to do".
    expect(r.stdout).not.toMatch(/this box already runs v2\.0\.0 .* and that install completed — nothing to do \(to reinstall it:/);
    expect(r.stdout).toMatch(/^update: this box already runs v2\.0\.0 \(oldsha0+\) and that install completed — nothing to do \(pass --force to reinstall\)$/m);
    expect(existsSync(join(home, 'curl-argv')), 'the ordinary (non-shortcut) path ran').toBe(true);
    expect(existsSync(join(home, '.ccrc', 'update.json')), 'update.json was left untouched').toBe(true);
    const rep = report(home);
    expect(rep['phase']).toBe('done');
    expect(rep['detail']).toBe('already converged at v2.0.0');
    // cmd_rollback always calls cmd_update with --from rollback|watchdog,
    // never its own --from verbatim (`run_from`, ccd/ccrc:12238-12239).
    expect(rep['from']).toBe('rollback');
  });

  // Mutation control for the fix above: WITHOUT the `--from cli` gate, this
  // case would take the shortcut, print "nothing to do" and leave
  // update.json untouched — the assertions above would both fail.
  it('a hand-typed (--from cli, the default) converged rollback still takes the shortcut: no report written (control for the pwa case above)', () => {
    const home = rollbackBox('ccrc-rollback-converged-cli-control-');
    const r = runRollback(home, ['--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/nothing to do/);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  // The guarded read (D-3283's own shape, `_upd_write_previous`): an ABSENT
  // completed-install record must never leak a bash "No such file or
  // directory" onto this run's stderr — the pre-check's `[ -f … ] &&`
  // guard, not the trailing `2>/dev/null` alone, is what prevents it (a
  // redirection that fails to OPEN prints before a later `2>` in the same
  // simple command can catch it — measured: `2>/dev/null` positioned AFTER
  // a failing `<` does NOT suppress bash's own diagnostic).
  it('an ABSENT completed-install record leaks no "No such file or directory" from the hand-typed converged pre-check (re-review fix)', () => {
    const home = rollbackBox('ccrc-rollback-no-record-');
    rmSync(join(home, '.ccrc', 'installed'));
    const r = runRollback(home, ['--to', 'v2.0.0']);
    expect(r.stderr).not.toMatch(/No such file or directory/);
  });

  it('an unpublished tag is refused at exit 2 before the lock and before any backup — its SHA256SUMS is the ONE request (§18 "`rollback` refuses an unknown tag")', () => {
    const home = rollbackBox('ccrc-rollback-unknown-', { previous: PREV });
    const r = runRollback(home, ['--to', 'v7.7.7']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: rollback: v7\.7\.7 is not a published release \(its SHA256SUMS answered 404\) — nothing on this box was changed$/m);
    expect(localUrls(home)).toEqual([sums(home, 'v7.7.7')]);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.lock'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('a release host that cannot be asked is exit 1 — unmeasured, never read as "not published"', () => {
    const home = rollbackBox('ccrc-rollback-unreachable-', { previous: PREV });
    // Ahead of the combined curl stub `runRollback` re-plants on every call:
    // curl's own "could not connect", which is not a 404.
    mkdirSync(join(home, 'fail-bin'), { recursive: true });
    writeFileSync(join(home, 'fail-bin', 'curl'),
      '#!/bin/sh\necho "curl: (7) Failed to connect: fixture" >&2\nexit 7\n', { mode: 0o755 });
    const r = runRollback(home, [], { PATH: `${join(home, 'fail-bin')}:${updateEnv(home)['PATH'] ?? ''}` });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rollback: could not ask the release host whether v1\.0\.0 exists within \d+s \(curl failed, timed out, or the host answered neither 200 nor 404\) — nothing on this box was changed$/m);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('a release host answering 503 (or a 403 rate limit) is exit 1 too — curl -f\'s exit 22 is not a 404 until the status says so (Task 6, D-3261)', () => {
    const home = rollbackBox('ccrc-rollback-host-5xx-', { previous: PREV });
    writeFileSync(join(home, 'fixture-release-http'), '503\n');   // Task 6's knob on the combined curl
    const r = runRollback(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rollback: could not ask the release host whether v1\.0\.0 exists within \d+s \(curl failed, timed out, or the host answered neither 200 nor 404\) — nothing on this box was changed$/m);
    expect(r.stderr).not.toMatch(/is not a published release/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  itLinux('bare `ccrc rollback` returns to previous: update\'s own path below the floor, previous kept, the floor kept, the gate, THEN the sweep behind its KillMode preflight (§18 "a standalone rollback sweeps behind the preflight")', () => {
    const home = rollbackBox('ccrc-rollback-happy-', { previous: PREV });
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    const r = runRollback(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^rollback: returning this box to v1\.0\.0 \(named by ~\/\.ccrc\/previous; asked by --from cli\) — update's own path, as --from rollback --downgrade/m);
    // Existence first, then update's own resolve → tarball → bundle.
    expect(localUrls(home)).toEqual([
      sums(home, 'v1.0.0'),
      sums(home, 'v1.0.0'),
      `local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz`,
      `local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz.sigstore.json`,
    ]);
    // Fix round 1 item 12 / review 155 C32: the FIRST SHA256SUMS ask is
    // `_upd_asset_listed`'s pre-detach check (cmd_rollback's own, BEFORE
    // update's spine) — a SMALL probe, connect+total bound. The SECOND is
    // `_upd_resolve`'s own SHA256SUMS fetch, inside cmd_update — connect
    // bound plus a STALL bound (by class with the tarball fetch beside it in
    // the same recording), AND, since fix round 2 F4 (review 167), its OWN
    // total `--max-time`/`--max-filesize` pair too. The two asks do NOT
    // carry the same flag classes (review 173's T2): both carry the connect
    // and total bounds, each from its own call site and knobs, but only
    // `_upd_resolve`'s carries the stall pair and `--max-filesize` — the
    // probe is a status question with no body to bound (`-o /dev/null`), the
    // fetch reads SHA256SUMS' bytes. The assertions below pin exactly that.
    const sumsArgv = curlFullArgv(home).filter((l) => l.includes('/SHA256SUMS'));
    expect(sumsArgv.length, curlFullArgv(home).join('\n')).toBe(2);
    expect(sumsArgv[0]).toMatch(/--connect-timeout \d+/);
    expect(sumsArgv[0]).toMatch(/--max-time \d+/);
    expect(sumsArgv[0]).not.toMatch(/--speed-limit|--speed-time/);
    expect(sumsArgv[0]).not.toMatch(/--max-filesize/);
    expect(sumsArgv[1]).toMatch(/--connect-timeout \d+/);
    expect(sumsArgv[1]).toMatch(/--speed-limit \d+/);
    expect(sumsArgv[1]).toMatch(/--speed-time \d+/);
    expect(sumsArgv[1]).toMatch(/--max-time \d+/);
    expect(sumsArgv[1]).toMatch(/--max-filesize \d+/);
    // Below the floor on purpose, and the floor is never lowered. Fix round
    // 1 item 25 / your Q6 (first bullet): `cmd_rollback` passes BOTH
    // `--downgrade` and `--from rollback` to `cmd_update`, so the caller
    // word must win — a bare `ccrc rollback` never typed `--downgrade`, and
    // the WARN must not claim it did.
    expect(r.stdout).toMatch(/^update: WARN: v1\.0\.0 is below this box's floor v2\.0\.0 \(resolved by --to v1\.0\.0\) — proceeding because this run is --from rollback; the floor stays v2\.0\.0$/m);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v2.0.0\n');
    // A rollback is a return to a known tag, not a new baseline (Task 4).
    expect(r.stdout).toMatch(/^update: previous: kept \(v1\.0\.0\)/m);
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe(PREV);
    expect(readFileSync(join(home, 'staged-ccrc-argv'), 'utf8').split('\n')[1]).toBe('install');
    expect(r.stdout).toMatch(/^update: rollback: v2\.0\.0 -> v1\.0\.0 is a DOWNGRADE/m);
    // The gate, then the sweep, then done — and no restore phase at all.
    const phases = writtenPhases(home);
    expect(phases).not.toContain('restoring');
    expect(phases.indexOf('checking')).toBeGreaterThan(phases.indexOf('installing'));
    expect(phases.indexOf('restarting')).toBeGreaterThan(phases.indexOf('checking'));
    expect(phases[phases.length - 1]).toBe('done');
    const rep = report(home);
    expect(rep['target']).toBe('v1.0.0');
    expect(rep['from']).toBe('rollback');
    // The sweep ran, and ran BEHIND its preflight: every unit's KillMode read
    // back before the one try-restart.
    const calls = systemctlCalls(home).split('\n').filter((l) => l !== '');
    const restartAt = calls.indexOf('--user try-restart claude-session@*');
    expect(restartAt, 'a standalone rollback must end in the supervisor sweep').toBeGreaterThan(-1);
    for (const u of ['alpha', 'beta', 'ccrc-update-preflight']) {
      const at = calls.indexOf(`--user show -p KillMode claude-session@${u}.service`);
      expect(at, `no KillMode preflight for ${u}`).toBeGreaterThan(-1);
      expect(at).toBeLessThan(restartAt);
    }
    expect(r.stdout).toMatch(/^update: sweep: /m);
    expect(r.stdout).not.toMatch(/DEGRADED/);
    expect(existsSync(join(home, 'tmux-argv')), 'the sweep reached for tmux').toBe(false);
  });

  itLinux('`ccrc rollback --from watchdog` — the REAL in-process path, not the watchdog\'s own stub launcher — still goes below the floor with its WARN: the process-local caller marker item 10 adds does not block the caller it is FOR (fix round 1 item 10 / review 155 C16)', () => {
    const home = rollbackBox('ccrc-rollback-watchdog-caller-', { previous: PREV });
    const r = runRollback(home, ['--from', 'watchdog']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^rollback: returning this box to v1\.0\.0 \(named by ~\/\.ccrc\/previous; asked by --from watchdog\) — update's own path, as --from watchdog --downgrade/m);
    expect(r.stdout).toMatch(/^update: WARN: v1\.0\.0 is below this box's floor v2\.0\.0 \(resolved by --to v1\.0\.0\) — proceeding because this run is --from watchdog; the floor stays v2\.0\.0$/m);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v2.0.0\n');
    const rep = report(home);
    expect(rep['from']).toBe('watchdog');
  });

  itLinux('with KillMode not process, the rollback\'s sweep is REFUSED — DEGRADED verbatim, no try-restart — and the rollback still exits 0 (R1 inherited, never re-argued)', () => {
    const home = rollbackBox('ccrc-rollback-degraded-', { previous: PREV });
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    const r = runRollback(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stderr).toMatch(/sweep REFUSED — claude-session@alpha\.service resolves to KillMode=control-group/);
    expect(r.stdout).toMatch(/^update: DEGRADED: the supervisor sweep did not run — every live claude-session@ supervisor keeps executing the PREVIOUS ccd until restarted/m);
    expect(systemctlCalls(home)).not.toMatch(/try-restart/);
    expect(report(home)['phase']).toBe('done');
  });

  itLinux('--allow-unsigned rides along ONLY when this box\'s own record says unsigned: an unverified box returns to a bundle-less release; a verified one refuses, with the provenance prefix (D-3263)', () => {
    const unsigned = rollbackBox('ccrc-rollback-unsigned-', {
      previous: PREV, bundle: false, marker: 'oldsha0000000000000000000000000000000000\nunsigned\n',
    });
    let r = runRollback(unsigned);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: WARN: .*ccrc-v1\.0\.0\.tar\.gz\.sigstore\.json is absent \(the release host answered 404\) — proceeding on the transport checksum alone because --allow-unsigned was typed/m);
    expect(readFileSync(join(unsigned, 'staged-ccrc-env'), 'utf8')).toBe('unset\n');
    const verified = rollbackBox('ccrc-rollback-verified-', { previous: PREV, bundle: false });
    r = runRollback(verified);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the release ships no provenance bundle .* installs only with --allow-unsigned/);
    expect(existsSync(join(verified, 'staged-ccrc-argv'))).toBe(false);
    expect(existsSync(join(verified, 'ccrc-backups'))).toBe(false);
    const rep = report(verified);
    expect(rep['phase']).toBe('failed');
    expect(String(rep['detail'])).toMatch(/^provenance: the release ships no provenance bundle/);
  });

  itLinux('a rollback while an update holds the lock is refused with update\'s own sentence — the live report is byte-identical, nothing backed up', () => {
    const home = rollbackBox('ccrc-rollback-locked-', { previous: PREV });
    const lock = join(home, '.ccrc', 'update.lock');
    writeFileSync(lock, '');
    const live = '{"target":"v2.0.0","phase":"installing","startedAt":1,"updatedAt":1,'
      + '"detail":null,"from":"cli","pid":4321}\n';
    writeFileSync(join(home, '.ccrc', 'update.json'), live);
    // Task 2's holder shape: ONE process takes the lock and becomes `sleep`,
    // so the pid killed is the pid holding it (a plain `flock <file> sleep`
    // hands the descriptor to a child that outlives a kill of `flock`).
    const holder = spawn(BASH, ['-c', 'exec 9>>"$1" && flock 9 && exec sleep 30', '_', lock], { stdio: 'ignore' });
    const lockFree = (): boolean =>
      spawnSync(BASH, ['-c', 'exec 9>>"$1" && flock -n 9', '_', lock]).status === 0;
    try {
      for (let i = 0; i < 400 && lockFree(); i++) pause(25);
      expect(lockFree(), 'the holder never took the lock').toBe(false);
      const r = runRollback(home);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/another update holds ~\/\.ccrc\/update\.lock \(pid 4321, target v2\.0\.0\)/);
      expect(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')).toBe(live);
      // The existence question ran (it precedes the lock); nothing after it did.
      expect(localUrls(home)).toEqual([sums(home, 'v1.0.0')]);
      expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
      expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    } finally { holder.kill('SIGKILL'); }
  });

  for (const from of ['cli', 'watchdog'] as const) {
    itLinux(`a --from ${from} rollback whose gate fails is NOT restored: failed 'rollback to <tag>: gate: …', exit 1, no restore phase, no sweep (D-3243)`, () => {
      const home = rollbackBox(`ccrc-rollback-gate-${from}-`, { previous: PREV });
      // A sweep that ran would leave a try-restart: make it possible, so its
      // absence below is a measurement and not the preflight refusing.
      plantKillModeDropIn(home);
      writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
      // /health keeps answering the version rolled away from.
      writeFileSync(join(home, 'fixture-health-pin'), 'v2.0.0\n');
      const r = runRollback(home, ['--from', from]);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — /m);
      expect(r.stderr).toMatch(new RegExp(
        `^ccrc: rollback: v1\\.0\\.0 was installed but failed its health gate \\(gate: .*\\) — no automatic restore runs for a --from ${from === 'watchdog' ? 'watchdog' : 'rollback'} run`, 'm'));
      const rep = report(home);
      expect(rep['phase']).toBe('failed');
      expect(String(rep['detail'])).toMatch(/^rollback to v1\.0\.0: gate: /);
      expect(rep['from']).toBe(from === 'watchdog' ? 'watchdog' : 'rollback');
      const phases = writtenPhases(home);
      expect(phases).not.toContain('restoring');
      expect(phases).not.toContain('reverted');
      expect(r.stdout).not.toMatch(/REVERTED|arm 2/);
      expect(systemctlCalls(home)).not.toMatch(/try-restart/);
      expect(systemctlCalls(home)).not.toMatch(/^--user restart /m);
    });
  }

  itLinux('a rollback whose spine died after the tree, but whose gate passes, names `ccrc rollback --to` as the rerun — `update --force` would be refused by the floor (D-3264)', () => {
    const home = rollbackBox('ccrc-rollback-spine-', { previous: PREV, installExit: 1 });
    writeFileSync(join(home, 'fixture-install-step'), '_inst_skills\n');
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    const r = runRollback(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    const out = `${r.stdout}\n${r.stderr}`;
    expect(out).toMatch(/spine died at _inst_skills\) — rerun: ccrc rollback --to v1\.0\.0\b/);
    expect(out).not.toMatch(/rerun: ccrc update --to v1\.0\.0 --force/);
    expect(systemctlCalls(home)).not.toMatch(/try-restart/);
    expect(report(home)['phase']).toBe('failed');
  });

  // D-3285 (final review, B3(ii)): `_upd_rerun_hint`, sourced directly for
  // its full `UPD_FROM` vocabulary — `restore` is arm 2's own child, and its
  // dead-mid-install rerun is refused by the floor the PARENT's completed
  // spine already raised, exactly like `rollback` and `watchdog`.
  it('_upd_rerun_hint groups restore with rollback|watchdog — the floor refuses `--force` for all three (D-3285)', () => {
    const home = freshUpdateBox('ccrc-update-rerun-hint-');
    for (const from of ['rollback', 'watchdog', 'restore']) {
      const r = sourcedCcrc(home, `UPD_FROM=${from} UPD_VERSION=v1.0.0 _upd_rerun_hint`);
      expect(r.code, `${from}: ${r.stderr}`).toBe(0);
      expect(r.stdout, from).toBe('ccrc rollback --to v1.0.0');
    }
    for (const from of ['cli', 'pwa', 'rollout']) {
      const r = sourcedCcrc(home, `UPD_FROM=${from} UPD_VERSION=v1.0.0 _upd_rerun_hint`);
      expect(r.code, `${from}: ${r.stderr}`).toBe(0);
      expect(r.stdout, from).toBe('ccrc update --to v1.0.0 --force');
    }
  });

  // PLATFORM-ONLY: --detach is Linux-only (decision 17) — a transient
  // systemd --user unit has no launchd counterpart this wave ships; the
  // macOS answer is the refusal case directly below.
  itLinux('--detach resolves the target FIRST, asks its existence, then re-execs `rollback --to <tag> --from <who>` through systemd-run and returns — the default target reaches the detached argv (§11 pin)', () => {
    const home = rollbackBox('ccrc-rollback-detach-', { previous: PREV });
    const r = runRollback(home, ['--detach', '--from', 'pwa']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // The D-3282 PATH-prepend wrapper (fix round 1 item 19 / review 155
    // C30), the SAME shape the watchdog unit's own `ExecStart` uses.
    expect(readFileSync(join(home, 'systemd-run-argv'), 'utf8').split('\n').filter((l) => l !== ''))
      .toEqual(['--user --collect --quiet /bin/sh -c PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@" '
        + 'ccrc-detach rollback --to v1.0.0 --from pwa']);
    expect(r.stdout).toMatch(/^update: detached — 'rollback --to v1\.0\.0' runs as a transient systemd --user unit; its progress is ~\/\.ccrc\/update\.json$/m);
    const rep = report(home);
    expect(rep['phase']).toBe('queued');
    expect(rep['target']).toBe('v1.0.0');
    expect(rep['from']).toBe('pwa');
    expect(localUrls(home)).toEqual([sums(home, 'v1.0.0')]);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    // An explicit --to reaches it the same way, whatever previous says.
    const pinned = rollbackBox('ccrc-rollback-detach-to-', { previous: `v0.9.0\n${PREV_SHA}\n` });
    const p = runRollback(pinned, ['--to=v1.0.0', '--detach']);
    expect(p.code, `stderr: ${p.stderr}\nstdout: ${p.stdout}`).toBe(0);
    expect(readFileSync(join(pinned, 'systemd-run-argv'), 'utf8').trim())
      .toBe('--user --collect --quiet /bin/sh -c PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@" '
        + 'ccrc-detach rollback --to v1.0.0 --from cli');
  });

  // Fix round 1 item 3 / review 155 C31: a `queued` report with nothing
  // past it wedges W5's `busy` handling and W2's lease sweep forever — no
  // fleet-box watchdog covers the rollback verb. Review 155's own recipe:
  // write `queued` EXACTLY as `_upd_detach` does, then run the detached
  // CHILD's own argv (`cmd_rollback --to <tag> --from pwa`, no `--detach`)
  // against a release that does not exist, so its own SECOND
  // `_upd_asset_listed` check (the parent's first check is not this test's
  // subject) answers 404. The queued report must not survive: W2's REAL
  // `reportFrom` must read a TERMINAL phase off what is left.
  itLinux('a detached rollback child whose second release-host check 404s ends the `queued` report in a TERMINAL `failed` phase — W2\'s real reportFrom never sees it stuck (fix round 1 item 3 / review 155 C31)', () => {
    const home = freshUpdateBox('ccrc-rollback-c31-queued-');
    replantDoctorStubs(home);
    const script = [
      `CCRC_RELEASE_BASE_URL="local://${home}/releases"`,
      'UPD_REPORT_TARGET=v0.0.9',
      'UPD_FROM=pwa',
      '_upd_phase queued',
      '( cmd_rollback --to v0.0.9 --from pwa )',
    ].join('\n');
    const r = sourcedCcrc(home, script);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: rollback: v0\.0\.9 is not a published release \(its SHA256SUMS answered 404\) — nothing on this box was changed$/m);
    const raw = readFileSync(join(home, '.ccrc', 'update.json'), 'utf8');
    const doc = JSON.parse(raw) as Record<string, unknown>;
    expect(doc.phase, `update.json: ${raw}`).toBe('failed');
    expect(doc.target).toBe('v0.0.9');
    expect(doc.from).toBe('pwa');
    expect(String(doc.detail)).toMatch(/^rollback: v0\.0\.9 is not a published release/);
    // W2's own reader — never IN_FLIGHT_UPDATE_PHASES (which `queued` is a
    // member of): a fleet node's `busy` handling and W2's lease sweep both
    // key on this, not on the raw JSON.
    const read: NodeFileRead = { ok: true, content: raw };
    const rep = reportFrom(read);
    expect(rep, `reportFrom(${raw})`).not.toBeNull();
    expect(rep!.phase).toBe('failed');
    expect(IN_FLIGHT_UPDATE_PHASES as readonly string[]).not.toContain(rep!.phase);
  });

  /** A REAL, live holder of ~/.ccrc/update.lock — `flock <file> sleep 30` in
   *  its own process group, returned once a fresh probe confirms contention.
   *  Review fix round 1 I1's own pins: the reporting window must never open
   *  before the lock, so a CONTENDED run must leave a live foreign report
   *  untouched. */
  const holdRollbackLock = (home: string): ChildProcess => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const h = spawn('flock', [join(home, '.ccrc', 'update.lock'), 'sleep', '30'], { stdio: 'ignore', detached: true });
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      if (spawnSync('flock', ['-n', join(home, '.ccrc', 'update.lock'), 'true']).status !== 0) return h;
      spawnSync('sleep', ['0.02']);
    }
    try { process.kill(-h.pid!, 'SIGKILL'); } catch { /* already gone */ }
    throw new Error('the fixture holder never took ~/.ccrc/update.lock');
  };
  const releaseRollbackLock = (h: ChildProcess): void => {
    try { process.kill(-h.pid!, 'SIGKILL'); } catch { /* already gone */ }
  };

  // Review fix round 1, I1: the ORIGINAL item 3 shape opened its reporting
  // window BEFORE taking the lock, so a non-`cli` rollback whose
  // release-host check failed CLOBBERED a live run's own in-flight report.
  // Fixed by taking `~/.ccrc/update.lock` FIRST (this exact scope, a fresh
  // acquisition — `cmd_update`, called in-process later, inherits it rather
  // than re-acquiring). On CONTENTION, `_upd_busy_die` now forces
  // `UPD_REPORTING=0` before it dies, so this run writes NOTHING and the
  // live holder's own report survives byte-identical.
  itLinux('a LIVE foreign in-flight report, with the lock genuinely held, survives a --from pwa rollback child untouched (review fix round 1 I1)', () => {
    const home = freshUpdateBox('ccrc-rollback-i1-live-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const nowSecs = Math.floor(Date.now() / 1000);
    const foreign = `${JSON.stringify({ target: 'v9.9.9', phase: 'installing', startedAt: nowSecs - 10,
      updatedAt: nowSecs - 5, detail: null, from: 'cli', pid: 424242 })}\n`;
    writeFileSync(join(home, '.ccrc', 'update.json'), foreign);
    const holder = holdRollbackLock(home);
    try {
      // A release host that would answer 404 if ever reached — it must
      // not be: the lock refusal happens first, before any network call.
      const env = { ...updateEnv(home), CCRC_RELEASE_BASE_URL: `local://${home}/releases` };
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', '--to', 'v0.0.9', '--from', 'pwa'],
        { env, encoding: 'utf8' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/another update holds ~\/\.ccrc\/update\.lock \(pid 424242, target v9\.9\.9\)/);
      expect(existsSync(join(home, 'curl-argv')), 'a fetch ran under someone else\'s lock').toBe(false);
      expect(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')).toBe(foreign);
    } finally { releaseRollbackLock(holder); }
  });

  // Review fix round 1, M4: item 3's own pin ran `cmd_rollback` inside a `( )`
  // subshell, where `$BASHPID != $$` disables `_ccrc_die`'s reporting hook —
  // so it covered the 404 arm (an EXPLICIT `_upd_phase` write) but not the
  // curl-failure or curl-absent arms, which route through `_ccrc_die`. These
  // two run the REAL script as a REAL top-level process. No
  // `replantDoctorStubs`: the fixture curl stub answers every non-local://
  // URL with a fake 200, so it must not be on PATH for a genuine curl
  // failure to occur.
  itLinux('M4: a real curl failure (refused port) writes a terminal `failed` report, read by W2\'s real reportFrom (review fix round 1 M4)', () => {
    const home = freshUpdateBox('ccrc-rollback-m4-curlfail-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const q = sourcedCcrc(home, 'UPD_REPORT_TARGET=v0.0.9\nUPD_FROM=pwa\n_upd_phase queued');
    expect(q.code, `stderr: ${q.stderr}`).toBe(0);
    const env = { ...updateEnv(home), CCRC_RELEASE_BASE_URL: 'http://127.0.0.1:9' };
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', '--to', 'v0.0.9', '--from', 'pwa'],
      { env, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/could not ask the release host whether v0\.0\.9 exists/);
    const raw = readFileSync(join(home, '.ccrc', 'update.json'), 'utf8');
    const rep = reportFrom({ ok: true, content: raw });
    expect(rep, `reportFrom(${raw})`).not.toBeNull();
    expect(rep!.phase).toBe('failed');
  });

  itLinux('M4: curl ABSENT from PATH also writes a terminal `failed` report, read by W2\'s real reportFrom (review fix round 1 M4)', () => {
    const home = freshUpdateBox('ccrc-rollback-m4-curlabsent-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const q = sourcedCcrc(home, 'UPD_REPORT_TARGET=v0.0.9\nUPD_FROM=pwa\n_upd_phase queued');
    expect(q.code, `stderr: ${q.stderr}`).toBe(0);
    const env = { ...updateEnv(home), PATH: pathWithoutCurl(home) };
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', '--to', 'v0.0.9', '--from', 'pwa'],
      { env, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/curl is required by 'ccrc rollback' but is not on PATH/);
    const raw = readFileSync(join(home, '.ccrc', 'update.json'), 'utf8');
    const rep = reportFrom({ ok: true, content: raw });
    expect(rep, `reportFrom(${raw})`).not.toBeNull();
    expect(rep!.phase).toBe('failed');
  });

  // Fix round 1 item 12 / review 155 C32: the pre-detach check
  // (`_upd_asset_listed`, via cmd_rollback's SHA256SUMS ask) against a
  // release host that ACCEPTS the TCP connection and never answers — a real
  // `net.createServer` that never writes, NEVER a stubbed curl, so the REAL
  // curl's own `--max-time` bound is what is measured. `CCRC_RELEASE_PROBE_
  // MAX_TIME` is overridden small so this pin finishes in a few seconds
  // rather than the production default (15s, itself well under W5's 20s
  // spawn deadline — the exact bound this item exists to keep a slow host
  // under).
  itLinux('a release host that accepts the connection and never answers is refused within its own bound, named in the sentence (fix round 1 item 12 / review 155 C32)', async () => {
    const server = createNetServer((socket) => { socket.on('error', () => {}); /* accept; never write; never close */ });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const home = freshUpdateBox('ccrc-rollback-neverending-host-');
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      const env = {
        ...updateEnv(home),
        CCRC_RELEASE_BASE_URL: `http://127.0.0.1:${port}/rel`,
        CCRC_RELEASE_PROBE_MAX_TIME: '2',
        CCRC_RELEASE_CONNECT_TIMEOUT: '2',
      };
      const t0 = Date.now();
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', '--to', 'v0.0.9', '--from', 'pwa'],
        { env, encoding: 'utf8', timeout: 20_000 });
      const elapsedMs = Date.now() - t0;
      expect(r.status, r.stderr).toBe(1);
      // Bounded by the OVERRIDDEN probe bound (2s), not left hanging to
      // curl's own (much longer) defaults or to this test's 20s kill.
      expect(elapsedMs, `took ${elapsedMs}ms`).toBeLessThan(10_000);
      expect(r.stderr).toMatch(
        /could not ask the release host whether v0\.0\.9 exists within 2s \(curl failed, timed out, or the host answered neither 200 nor 404\)/);
    } finally {
      server.close();
    }
  }, 20_000);

  // Review fix round 1 (review 155's own M5, distinct from this file's
  // earlier "fix round 1, M5" label below): the four CCRC_RELEASE_* knobs
  // are now validated by `_upd_validate_timeout`, a positive integer within
  // a sane max or the default plus one WARN naming the variable. `0` is
  // refused like any other bad value (curl reads `--max-time 0` as NO
  // LIMIT, which would silently reopen C32), and a non-numeric value falls
  // back rather than corrupting every fetch's own sentence with "abcs".
  it('a bad CCRC_RELEASE_* timeout override WARNs and falls back to the default — 0 and a non-numeric value (review fix round 1 M5)', () => {
    for (const [envVar, badValue, defaultVal] of [
      ['CCRC_RELEASE_PROBE_MAX_TIME', '0', '15'],
      ['CCRC_RELEASE_CONNECT_TIMEOUT', 'abc', '10'],
    ] as const) {
      const home = mkTmp(`ccrc-timeout-validate-${envVar}-`);
      mkdirSync(join(home, '.local', 'bin'), { recursive: true });
      writeFileSync(join(home, '.local', 'bin', 'curl'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
      const env = {
        ...process.env, HOME: home,
        PATH: `${join(home, '.local', 'bin')}:${process.env['PATH'] ?? ''}`,
        [envVar]: badValue,
      };
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', '--to', 'v0.0.1', '--from', 'pwa'],
        { env, encoding: 'utf8' });
      // The probe's own ceiling is the pre-detach one (W6 Task 8A); the
      // connect knob keeps the generic 1..3600 sentence.
      const what = envVar === 'CCRC_RELEASE_PROBE_MAX_TIME'
        ? 'a whole number of seconds from 1 to 18 \\(the pre-detach check must answer inside W5\'s 20-second spawn deadline\\)'
        : 'a whole number of seconds from 1 to 3600';
      expect(r.stdout, `${envVar}=${badValue} stdout`).toMatch(
        new RegExp(`^update: WARN: ${envVar}='${badValue}' is not ${what} — using ${defaultVal}$`, 'm'));
      // A measurement, not just an absence: the run still went on to ask
      // the release host — `_upd_asset_listed`'s own die, which always
      // names PROBE_MAX_TIME's (corrected) value in "within Ns", whichever
      // of the two variables was the bad one.
      expect(r.stderr, `${envVar}=${badValue} stderr`).toMatch(/within 15s/);
    }
  });

  // W6 Task 8A: the pre-detach probe's own ceiling. `cmd_rollback --detach`
  // asks the release host BEFORE it detaches, under W5's 20-second spawn
  // deadline, so an override of the total bound above 18 s must not pass
  // silently — it WARNs and falls back to 15. Measured through `rollback`,
  // which reaches only `_upd_asset_listed`'s validation. 18 itself, and the
  // generic knobs' own ceiling (a connect bound of 3600), still pass.
  it('CCRC_RELEASE_PROBE_MAX_TIME above 18 s WARNs and falls back to 15 at the pre-detach probe; 18 passes (W6 Task 8A)', () => {
    const run = (value: string): { stdout: string; stderr: string } => {
      const home = mkTmp('ccrc-probe-cap-');
      mkdirSync(join(home, '.local', 'bin'), { recursive: true });
      writeFileSync(join(home, '.local', 'bin', 'curl'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
      const env = {
        ...process.env, HOME: home,
        PATH: `${join(home, '.local', 'bin')}:${process.env['PATH'] ?? ''}`,
        CCRC_RELEASE_PROBE_MAX_TIME: value,
      };
      return spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', '--to', 'v0.0.1', '--from', 'pwa'],
        { env, encoding: 'utf8' });
    };
    const warn = (v: string): RegExp => new RegExp(
      `^update: WARN: CCRC_RELEASE_PROBE_MAX_TIME='${v}' is not a whole number of seconds from 1 to 18 \\(the pre-detach check must answer inside W5's 20-second spawn deadline\\) — using 15$`, 'm');
    for (const v of ['19', '25', '3600']) {
      const r = run(v);
      expect(r.stdout, `${v} stdout`).toMatch(warn(v));
      expect(r.stderr, `${v} stderr`).toMatch(/within 15s/);
    }
    const ok = run('18');
    expect(ok.stdout).not.toContain('WARN');
    expect(ok.stderr).toMatch(/within 18s/);
  });

  // Review fix round 1, M5, closing a coverage gap the mutation table found:
  // `rollback` reaches ONLY `_upd_asset_listed`'s own validation calls
  // (`cmd_rollback`'s pre-check runs before `_upd_resolve` ever does), so
  // the pin above does not red when `_upd_resolve`'s OWN validation calls
  // are deleted — measured on a scratch tree. `CCRC_RELEASE_SPEED_LIMIT`
  // and `CCRC_RELEASE_SPEED_TIME` are validated ONLY inside `_upd_resolve`
  // (SHA256SUMS's stall bound; `_upd_asset_listed` never reads them), so
  // testing them through `update` isolates that call site.
  it('CCRC_RELEASE_SPEED_LIMIT/_SPEED_TIME are validated in _upd_resolve, reached only by `update` (review fix round 1 M5)', () => {
    for (const [envVar, badValue, defaultVal] of [
      ['CCRC_RELEASE_SPEED_LIMIT', '-5', '1024'],
      ['CCRC_RELEASE_SPEED_TIME', '99999', '30'],
    ] as const) {
      const home = mkTmp(`ccrc-timeout-validate-${envVar}-`);
      mkdirSync(join(home, '.local', 'bin'), { recursive: true });
      writeFileSync(join(home, '.local', 'bin', 'curl'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
      const env = {
        ...process.env, HOME: home,
        PATH: `${join(home, '.local', 'bin')}:${process.env['PATH'] ?? ''}`,
        [envVar]: badValue,
      };
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'update', '--to', 'v0.0.1'],
        { env, encoding: 'utf8' });
      const what = envVar === 'CCRC_RELEASE_SPEED_LIMIT'
        ? 'a whole number of bytes/second from 1 to 100000000' : 'a whole number of seconds from 1 to 3600';
      expect(r.stdout, `${envVar}=${badValue} stdout`).toMatch(
        new RegExp(`^update: WARN: ${envVar}='${badValue}' is not ${what} — using ${defaultVal}$`, 'm'));
      // A measurement: the run still went on to fetch, with the CORRECTED
      // value in the die's own sentence.
      expect(r.stderr, `${envVar}=${badValue} stderr`)
        .toContain(envVar === 'CCRC_RELEASE_SPEED_LIMIT' ? 'under 1024B/s' : 'for 30s');
    }
  });

  // Review fix round 1, M5: covered by I1 — once the lock is taken BEFORE
  // the window opens, a NON-contention `_upd_lock` failure (flock missing
  // from PATH, here) happens AFTER the window is already open and DOES
  // report — there is no live holder to clobber in that arm.
  itLinux('M5: flock missing from PATH, for a --from pwa rollback (no --detach), is a terminal `failed` report too (review fix round 1 M5)', () => {
    const home = freshUpdateBox('ccrc-rollback-m5-noflock-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const q = sourcedCcrc(home, 'UPD_REPORT_TARGET=v0.0.9\nUPD_FROM=pwa\n_upd_phase queued');
    expect(q.code, `stderr: ${q.stderr}`).toBe(0);
    const env = { ...updateEnv(home), PATH: pathWithoutFlock(home) };
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', '--to', 'v0.0.9', '--from', 'pwa'],
      { env, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/flock \(util-linux\) is required by 'ccrc update'/);
    const raw = readFileSync(join(home, '.ccrc', 'update.json'), 'utf8');
    const rep = reportFrom({ ok: true, content: raw });
    expect(rep, `reportFrom(${raw})`).not.toBeNull();
    expect(rep!.phase).toBe('failed');
  });

  itDarwin('--detach refuses on macOS by name before anything runs (decision 17)', () => {
    const home = rollbackBox('ccrc-rollback-detach-darwin-', { previous: PREV });
    const r = runRollback(home, ['--detach']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: --detach is Linux-only \(decision 17\)$/m);
    expect(existsSync(join(home, 'curl-argv'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  itDarwin('on macOS the same rollback runs by hand: below the floor, previous kept, the launchd gate arm, then the Darwin sweep — and systemctl is never called', () => {
    const home = rollbackBox('ccrc-rollback-darwin-', { previous: PREV });
    // The gate's Darwin arm samples ccrc.service's job pid through `launchctl
    // print`; the recording stub answers a stable pid only for a loaded job.
    appendFileSync(join(home, 'launchctl-loaded'), 'app.ccrc.ccrc.plist\n');
    const r = runRollback(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v2.0.0\n');
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe(PREV);
    expect(report(home)['from']).toBe('rollback');
    expect(report(home)['phase']).toBe('done');
    expect(r.stdout).toMatch(/^update: sweep: /m);
    expect(existsSync(join(home, 'systemctl-calls'))).toBe(false);
  });

  // CARRY (Task 2 review): `cmd_update`'s converged no-op path calls
  // `_upd_unlock` before its own `return 0` (`ccd/ccrc`, just above the
  // "already runs … nothing to do" line) — nothing in this file's OWN
  // describe exercised it, because every earlier `runUpdate` case either
  // never converges or reaches convergence with `UPD_FROM=cli`, never
  // in-process under a caller that took the lock itself and expects it
  // back. `cmd_rollback` is that caller (D-3236: it runs `cmd_update`
  // IN-PROCESS, under the lock it took), so a rollback that lands on an
  // already-current tag is the one path that can prove the converged arm
  // still frees the lock it never re-acquires.
  //
  // A BLACK-BOX (separate-process) probe cannot pin this: `cmd_rollback`'s
  // call to `cmd_update` is its own last statement, and the dispatch case
  // is the script's last statement too, so the whole `ccrc` PROCESS exits
  // (and the kernel drops the flock with it) within a few instructions of
  // `_upd_unlock` either running or not — a second `runRollback` right
  // behind the first stays green either way. This case instead runs
  // `cmd_rollback` SOURCED, in the SAME shell that then probes the lock
  // immediately after it returns — no process boundary between the
  // (possibly-skipped) unlock and the probe, so a fresh `flock -n` on a
  // NEW open file description (`_upd_lock_probe`'s own, per its "per open
  // file description" comment) still contends with `UPD_LOCK_FD` if it
  // was left open in THIS process. Mutation: delete the `_upd_unlock` call
  // — this reds on `probe-inline=1` (held) instead of `probe-inline=0`.
  itLinux('the converged no-op path frees the lock before it returns — probed in-process, in the same shell cmd_rollback ran in, with no process exit between (CARRY: Task 2 review)', () => {
    const home = freshUpdateBox('ccrc-rollback-converged-');
    plantOldBox(home, { version: 'v2.0.0' });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'floor'), 'v2.0.0\n');
    // The staged release's stamp sha is what stubTree writes: newsha…; the
    // box's OWN running stamp and completed record must carry the SAME sha
    // for `_upd_converged`'s three-way comparison to hold (the exact shape
    // `ccrc update`'s own "already there" gate describe uses), reached here
    // in-process through `cmd_rollback --to v2.0.0` — a rollback TO the tag
    // already running, the one shape that can hit the no-op branch.
    writeFileSync(join(home, '.ccrc', 'build.json'),
      '{"sha":"newsha0000000000000000000000000000000000","ref":"release","builtAt":"2026-08-21T00:00:00Z","dirty":false,"version":"v2.0.0"}\n');
    writeFileSync(join(home, '.ccrc', 'installed'), 'newsha0000000000000000000000000000000000\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    mkdirSync(join(home, 'tmp'), { recursive: true });
    replantDoctorStubs(home);
    const script = [
      `export CCRC_RELEASE_BASE_URL="local://${home}/releases"`,
      `export TMPDIR="${home}/tmp"`,
      'export CCRC_UPDATE_HEALTH_S=0',
      'cmd_rollback --to v2.0.0',
      'echo "rc-inline=$?"',
      '_upd_lock_probe; echo "probe-inline=$?"',
    ].join('\n');
    const r = sourcedCcrc(home, script);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/rc-inline=0/);
    expect(r.stdout).toMatch(/already runs v2\.0\.0/);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    expect(r.stdout).toMatch(/probe-inline=0/);
  });
});

// ── The control plane's projection (design 2026-09-20 §9; W4a Task 8) ────
// Fixtures for the two describes below. The reader's ONE clock is
// `date +%s` — the document is unix SECONDS — so every case that plants a
// projection freezes it: a lease compared against a moving second is a
// flake, and "a lease EQUAL to now is still in force" is unmeasurable
// without it.
const REAL_DATE = realPath('date');
const INTENT_NOW = 2_000_000_000;

interface IntentFields {
  epoch?: string; issued?: string; lease?: string; channel?: string;
  desired?: string; desiredStable?: string; desiredDev?: string; auto?: string;
}

/** Spec §9's nine-line document in its own order, SECONDS, ending `end\n` —
 *  the grammar W2's route and server-role writer render and `ccd-update-sync`
 *  installs. Defaults: in force at INTENT_NOW (issued a minute before, lease
 *  issued + 900, `pool_epoch`'s lease), channel stable, desired v2.0.0 on
 *  stable and v2.1.0 on dev. */
function intentDoc(f: IntentFields = {}): string {
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

const intentPath = (home: string): string => join(home, '.ccrc', 'update-intent');

/** The projection at its one path, mode 0600 — the mode W2's writer and the
 *  puller both place it with. */
function plantIntent(home: string, text: string | Buffer): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(intentPath(home), text, { mode: 0o600 });
}

/** The role where `cmd_install` records it: `~/.ccrc/ccrc.env`'s `CCRC_ROLE=`. */
function plantRole(home: string, role: 'fleet' | 'server' | 'both'): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'ccrc.env'), `CCRC_ROLE=${role}\n`);
}

/** "Configured" on a fleet node: the puller's timer unit FILE is installed —
 *  `_pool_sync_installed`'s rule, and `plantPoolSyncTimer`'s zero-byte idiom
 *  (`ccdWsHelpers.ts:136-139`): nothing reads the unit's content. */
function plantSyncTimer(home: string): void {
  const units = join(home, '.config', 'systemd', 'user');
  mkdirSync(units, { recursive: true });
  writeFileSync(join(units, 'ccd-update-sync.timer'), '');
}

/** Freezes `date +%s` at `s` (every other `date` argv execs the real one).
 *  Planted in `doctor-stubs`, so every run's `replantDoctorStubs` re-plants
 *  it ahead of the real binary on PATH. */
function plantClock(home: string, s: number = INTENT_NOW): void {
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
function runChannel(home: string, args: string[] = []): Result {
  const env = updateEnv(home);
  replantDoctorStubs(home);
  const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'channel', ...args], { env, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** A fleet node the control plane manages: role recorded, timer unit file
 *  installed, the clock frozen, an OLD v1.0.0 build on it. */
function managedFleetBox(prefix: string): string {
  const home = freshUpdateBox(prefix);
  plantOldBox(home, { version: 'v1.0.0' });
  plantRole(home, 'fleet');
  plantSyncTimer(home);
  plantClock(home);
  return home;
}

const PULLER_REMEDY = 'systemctl --user start ccd-update-sync.service';
const SERVER_REMEDY = 'restart ccrc.service (it writes ~/.ccrc/update-intent on every sweep)';
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('ccrc update: the projection (role-aware reader, --channel)', () => {
  // THE FALLBACK, AND ONLY WHERE IT IS HONEST (spec §9's table; §18 "absent
  // + no timer says so"): a node nothing manages follows stable — and says
  // so, rather than reading an absent projection as `stable` in silence.
  platformContrast('no control plane on this box: update follows latest/download and says which kind of box it is', {
    darwin: ['never centrally managed (decision 17), whatever the box records', () => {
      const home = freshUpdateBox('ccrc-update-intent-fallback-mac-');
      plantOldBox(home, { version: 'v1.0.0' });
      plantRole(home, 'server');
      plantClock(home);
      plantIntent(home, intentDoc());
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
      const r = runUpdate(home, ['--check']);
      expect(checkLine(r.stdout)).toMatch(/^check: box=v1\.0\.0 sha=\S+ target=v2\.0\.0 (.* )?state=behind$/);
      expect(r.stdout).toMatch(/^update: no control plane on this box \(macOS: not centrally managed\) — following stable$/m);
      expect(localUrls(home)).toEqual([`local://${home}/releases/latest/download/SHA256SUMS`]);
    }],
    linux: ['a fleet node with no ccd-update-sync.timer, and a node recording no role', () => {
      for (const role of ['fleet', null] as const) {
        const home = freshUpdateBox('ccrc-update-intent-fallback-');
        plantOldBox(home, { version: 'v1.0.0' });
        if (role !== null) plantRole(home, role);
        packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
        const r = runUpdate(home);
        expect(r.code, `role ${role}: ${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/^update: no control plane on this box — following stable$/m);
        expect(localUrls(home)[0]).toBe(`local://${home}/releases/latest/download/SHA256SUMS`);
        expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
      }
    }],
  });

  // Review Focus 2: the silent fallback is the failure. A fleet node whose
  // timer IS installed and whose projection is absent has never synced —
  // `unreadable`, refused, never the stable sentence.
  itLinux('fleet + the timer unit file installed + projection ABSENT → unreadable (never synced), the puller\'s remedy, nothing fetched', () => {
    const home = managedFleetBox('ccrc-update-intent-never-synced-');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`^ccrc: update: ~/\\.ccrc/update-intent is unreadable \\(never synced\\) — ${esc(PULLER_REMEDY)}$`, 'm'));
    expect(r.stdout).not.toMatch(/following stable/);
    expect(localUrls(home)).toEqual([]);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  // §18 "the reader is role-aware": on server/both the server process is the
  // writer, so an absent projection is unreadable with NO timer consulted.
  // A latest release IS published, so a reader that fell back would visibly
  // fetch it.
  itLinux('server or both + projection absent → unreadable (absent) and the server-restart remedy, never stable', () => {
    for (const role of ['server', 'both'] as const) {
      const home = freshUpdateBox(`ccrc-update-intent-absent-${role}-`);
      plantOldBox(home, { version: 'v1.0.0' });
      plantRole(home, role);
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
      const r = runUpdate(home);
      expect(r.code, role).toBe(1);
      expect(r.stderr).toMatch(new RegExp(`^ccrc: update: ~/\\.ccrc/update-intent is unreadable \\(absent\\) — ${esc(SERVER_REMEDY)}$`, 'm'));
      expect(r.stdout, role).not.toMatch(/following stable/);
      expect(localUrls(home), role).toEqual([]);
    }
  });

  // Fix round 1 item 22 / review 155 (your Q8): the same absent projection,
  // on the same server/both box, but `--check` — the state Q8 names by
  // example ("an absent or stale projection"). It must not die either:
  // `check:` prints, `projection=unreadable` says why, and the box is
  // compared against itself with nothing fetched.
  itLinux('server or both + projection absent, on --check: `check:` still prints, `projection=unreadable`, never a death (fix round 1 item 22 / review 155, your Q8)', () => {
    for (const role of ['server', 'both'] as const) {
      const home = freshUpdateBox(`ccrc-update-intent-absent-check-${role}-`);
      plantOldBox(home, { version: 'v1.0.0' });
      plantRole(home, role);
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
      const r = runUpdate(home, ['--check']);
      expect(r.code, `${role}: ${r.stderr}`).toBe(1);
      expect(r.stderr, role).toBe('');
      expect(checkLine(r.stdout), role).toBe(
        `check: box=v1.0.0 sha=${OLD_SHA} target=v1.0.0 caps=${CAPS_NOW} floor=none projection=unreadable state=incomplete`);
      expect(r.stdout, role).toMatch(new RegExp(
        `^update: ~/\\.ccrc/update-intent is unreadable \\(absent\\) — ${esc(SERVER_REMEDY)}; --check compares this box against itself instead of a target it cannot resolve — 'ccrc update' itself still refuses$`, 'm'));
      expect(localUrls(home), role).toEqual([]);
    }
  });

  // m5 (review fix round 1): the sibling item 22 missed — an UNVERSIONED
  // server/both box has nothing to self-compare against either, but that
  // is not a reason to die: Q8's own rule ("--check always prints its
  // line") carves out no exception for it. `state=unversioned` is this
  // box's own DEFAULT state (never flipped to `behind`, since `box` never
  // gets a real version) — nothing new to compute, just not dying on the
  // way there.
  itLinux('server or both + projection absent + an UNVERSIONED box, on --check: `check:` still prints, state=unversioned, never a death (review fix round 1 m5)', () => {
    for (const role of ['server', 'both'] as const) {
      const home = freshUpdateBox(`ccrc-update-intent-absent-unversioned-check-${role}-`);
      plantOldBox(home);   // no version: no build.json at all
      plantRole(home, role);
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
      const r = runUpdate(home, ['--check']);
      expect(r.code, `${role}: ${r.stderr}`).toBe(1);
      expect(r.stderr, role).toBe('');
      expect(checkLine(r.stdout), role).toBe(
        `check: box=unversioned sha=none target=none caps=${CAPS_NOW} floor=none projection=unreadable state=unversioned`);
      // Review fix round 1, M10: the GENERIC broken-projection sentence
      // ("--check compares this box against itself") is untrue here — an
      // unversioned box has nothing to compare — overridden with the SAME
      // words the UPD_TARGET_NONE die uses, which also names --to.
      expect(r.stdout, role).toMatch(new RegExp(
        `^update: ~/\\.ccrc/update-intent is unreadable \\(absent\\) — ${esc(SERVER_REMEDY)}; this box records no release version to compare against — name one with --to <tag>$`, 'm'));
      expect(r.stdout, role).toMatch(/^this box: unversioned \(none\) · latest: none — a release install would be the first on this box$/m);
      expect(localUrls(home), role).toEqual([]);
    }
  });

  itLinux('an in-force projection names the target: download/<desired>, said on stdout, never latest/download', () => {
    const home = managedFleetBox('ccrc-update-intent-ok-');
    plantIntent(home, intentDoc());
    packRelease(home, stubTree(home, { version: 'v9.9.9' }), { tag: 'v9.9.9' });   // a DIFFERENT latest: never fetched
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: following the control plane — channel stable, desired v2\.0\.0$/m);
    expect(localUrls(home)[0]).toBe(`local://${home}/releases/download/v2.0.0/SHA256SUMS`);
    expect(localUrls(home).some((u) => u.includes('/latest/'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });

  itLinux('--channel dev selects desired-dev for one run; --channel=stable selects desired-stable (spec §9)', () => {
    const home = managedFleetBox('ccrc-update-intent-channel-');
    plantIntent(home, intentDoc({ desired: 'v2.0.0', desiredStable: 'v2.0.0', desiredDev: 'v2.1.0' }));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    packRelease(home, stubTree(home, { version: 'v2.1.0' }), { tag: 'v2.1.0', latest: false });
    let r = runUpdate(home, ['--channel', 'dev']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: following the control plane — channel dev, desired v2\.1\.0$/m);
    expect(localUrls(home)[0]).toBe(`local://${home}/releases/download/v2.1.0/SHA256SUMS`);
    rmSync(join(home, 'curl-argv'));
    r = runUpdate(home, ['--check', '--channel=stable']);
    expect(checkLine(r.stdout)).toMatch(/ target=v2\.0\.0 /);
    expect(r.stdout).toMatch(/^this box: \S+ \(\S+\) · channel stable: v2\.0\.0 — /m);
  });

  // §18 "`--channel` refuses off the control plane": the fetch layer has no
  // URL that means "newest prerelease", so dev must never reach latest/.
  itLinux('--channel with no projection to resolve it refuses naming --to, and never reaches latest/download', () => {
    const home = freshUpdateBox('ccrc-update-intent-channel-off-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantRole(home, 'fleet');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    for (const args of [['--channel', 'dev'], ['--check', '--channel', 'dev']]) {
      const r = runUpdate(home, args);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.stderr).toMatch(/^ccrc: update: --channel needs the control plane \(no projection resolves on this box\); use --to <tag>$/m);
      expect(localUrls(home), args.join(' ')).toEqual([]);
    }
  });

  itLinux('a lease in the past is stale: a bare update is refused naming its age and the role\'s remedy', () => {
    const cases = [['fleet', PULLER_REMEDY], ['both', SERVER_REMEDY]] as const;
    for (const [role, remedy] of cases) {
      const home = freshUpdateBox(`ccrc-update-intent-stale-${role}-`);
      plantOldBox(home, { version: 'v1.0.0' });
      plantRole(home, role);
      if (role === 'fleet') plantSyncTimer(home);
      plantClock(home);
      plantIntent(home, intentDoc({ issued: String(INTENT_NOW - 1200), lease: String(INTENT_NOW - 300) }));
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
      const r = runUpdate(home);
      expect(r.code, `${role}: ${r.stderr}`).toBe(1);
      expect(r.stderr).toMatch(new RegExp(
        `^ccrc: update: the control plane's projection \\(~/\\.ccrc/update-intent\\) is stale — its lease ended 300s ago; ${esc(remedy)}$`, 'm'));
      expect(localUrls(home)).toEqual([]);
    }
  });

  // Fix round 1 item 22 / review 155 (your Q8): `--check` on the SAME stale
  // projection must not die — it always prints its `check:` line, with the
  // projection's own state reported in `projection=`, and compares the box
  // against itself (no target to fetch toward) exactly as a `none`
  // projection does. This is the SPLIT of the case above: the bare-update
  // arm above still refuses; only `--check` changes.
  itLinux('a lease in the past is stale: --check reports it in `projection=`, prints its check line and never dies (fix round 1 item 22 / review 155, your Q8)', () => {
    const cases = [['fleet', PULLER_REMEDY], ['both', SERVER_REMEDY]] as const;
    for (const [role, remedy] of cases) {
      const home = freshUpdateBox(`ccrc-update-intent-stale-check-${role}-`);
      plantOldBox(home, { version: 'v1.0.0' });
      plantRole(home, role);
      if (role === 'fleet') plantSyncTimer(home);
      plantClock(home);
      plantIntent(home, intentDoc({ issued: String(INTENT_NOW - 1200), lease: String(INTENT_NOW - 300) }));
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
      const r = runUpdate(home, ['--check']);
      // No completed-install record planted: same version, install never
      // completed — `incomplete`, exit 1 — but the check line still printed.
      expect(r.code, `${role}: ${r.stderr}`).toBe(1);
      expect(r.stderr, role).toBe('');
      expect(checkLine(r.stdout), role).toBe(
        `check: box=v1.0.0 sha=${OLD_SHA} target=v1.0.0 caps=${CAPS_NOW} floor=none projection=stale state=incomplete`);
      expect(r.stdout, role).toMatch(new RegExp(
        `^update: the control plane's projection \\(~/\\.ccrc/update-intent\\) is stale — its lease ended 300s ago; ${esc(remedy)}; --check compares this box against itself instead of a target it cannot resolve — 'ccrc update' itself still refuses$`, 'm'));
      expect(r.stdout, role).toMatch(
        /^this box: v1\.0\.0 \(\S+\) · latest: v1\.0\.0 — same version, but the install never completed \(ccrc version explains\); 'ccrc update --to v1\.0\.0' will reinstall \(with no --to, update refuses: its control plane projection is stale\)$/m);
      // Nothing fetched: the self-compare skips `_upd_resolve` entirely,
      // exactly as a `none` projection's self-compare does.
      expect(localUrls(home), role).toEqual([]);
    }
  });

  itLinux('a lease EQUAL to now is still in force — the comparison is strict', () => {
    const home = managedFleetBox('ccrc-update-intent-lease-now-');
    plantIntent(home, intentDoc({ issued: String(INTENT_NOW - 900), lease: String(INTENT_NOW) }));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check']);
    expect(r.stderr).not.toMatch(/stale/);
    expect(checkLine(r.stdout)).toMatch(/ target=v2\.0\.0 /);
    expect(r.stdout).toMatch(/^update: following the control plane — channel stable, desired v2\.0\.0$/m);
  });

  itLinux('a malformed projection is refused — never followed, never read as "no control plane"', () => {
    const home = managedFleetBox('ccrc-update-intent-malformed-');
    plantIntent(home, intentDoc().replace('end\n', ''));   // torn before its terminator
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(new RegExp(
      `^ccrc: update: ~/\\.ccrc/update-intent is malformed \\(its last line is not end\\) — refusing to follow a projection this reader does not recognise; ${esc(PULLER_REMEDY)}$`, 'm'));
    expect(r.stdout).not.toMatch(/following stable/);
    expect(localUrls(home)).toEqual([]);
  });

  // C23 (review 155, fix round 1 item 15): the same class of refusal, pinned
  // through `update --check` as well as `channel` (the grammar table
  // above), because a server/both box's own writer has no puller in front
  // of it — this reader is the only place these two checks run for it.
  // `--check` never dies on a malformed projection (item 22's own rule,
  // above): `check:` still prints, `projection=malformed`, and the box is
  // compared against itself — the same shape the stale/absent cases pin.
  itLinux('a `desired` that disagrees with its own channel is refused by `update --check` too (C23, fix round 1)', () => {
    const home = managedFleetBox('ccrc-update-intent-desired-mismatch-');
    plantIntent(home, intentDoc({ desired: 'v2.1.0' }));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toBe('');
    expect(checkLine(r.stdout)).toMatch(/ projection=malformed state=\S+$/);
    expect(r.stdout).toMatch(new RegExp(
      `^update: ~/\\.ccrc/update-intent is malformed \\(desired v2\\.1\\.0 disagrees with desired-stable v2\\.0\\.0\\) — refusing to follow a projection this reader does not recognise; ${esc(PULLER_REMEDY)}; --check compares this box against itself instead of a target it cannot resolve — 'ccrc update' itself still refuses$`, 'm'));
    expect(localUrls(home)).toEqual([]);
  });

  itLinux('a lease outside the day after its own issued is refused by `update --check` too (C23, fix round 1)', () => {
    const home = managedFleetBox('ccrc-update-intent-lease-window-');
    plantIntent(home, intentDoc({ issued: String(INTENT_NOW - 60), lease: String(INTENT_NOW - 61) }));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toBe('');
    expect(checkLine(r.stdout)).toMatch(/ projection=malformed state=\S+$/);
    expect(r.stdout).toMatch(new RegExp(
      `^update: ~/\\.ccrc/update-intent is malformed \\(lease ${INTENT_NOW - 61} does not fall in the day after issued ${INTENT_NOW - 60}\\) — refusing to follow a projection this reader does not recognise; ${esc(PULLER_REMEDY)}; --check compares this box against itself instead of a target it cannot resolve — 'ccrc update' itself still refuses$`, 'm'));
    expect(localUrls(home)).toEqual([]);
  });

  // m4: the AHEAD direction of the lease window had no `--check` pin either
  // (only the desired mismatch and the BELOW direction did).
  itLinux('a lease more than a day after its own issued is refused by `update --check` too (fix round 1 review m4)', () => {
    const home = managedFleetBox('ccrc-update-intent-lease-ahead-');
    const issued = INTENT_NOW - 60;
    const lease = issued + 86_400 + 1;
    plantIntent(home, intentDoc({ issued: String(issued), lease: String(lease) }));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toBe('');
    expect(checkLine(r.stdout)).toMatch(/ projection=malformed state=\S+$/);
    expect(r.stdout).toMatch(new RegExp(
      `^update: ~/\\.ccrc/update-intent is malformed \\(lease ${lease} does not fall in the day after issued ${issued}\\) — refusing to follow a projection this reader does not recognise; ${esc(PULLER_REMEDY)}; --check compares this box against itself instead of a target it cannot resolve — 'ccrc update' itself still refuses$`, 'm'));
    expect(localUrls(home)).toEqual([]);
  });

  // I2 (review 155 fix round 1 review): "pin both through ccrc channel, and
  // one through update --check" — the issued-ahead-of-clock direction,
  // through --check.
  itLinux('an issued more than a day ahead of this node\'s clock is refused by `update --check` too (I2, fix round 1 review)', () => {
    const home = managedFleetBox('ccrc-update-intent-issued-ahead-');
    const issued = INTENT_NOW + 315_360_000;
    plantIntent(home, intentDoc({ issued: String(issued), lease: String(issued + 900) }));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toBe('');
    expect(checkLine(r.stdout)).toMatch(/ projection=malformed state=\S+$/);
    expect(r.stdout).toMatch(new RegExp(
      `^update: ~/\\.ccrc/update-intent is malformed \\(issued ${issued} is more than a day ahead of this node clock \\(${INTENT_NOW}\\)\\) — refusing to follow a projection this reader does not recognise; ${esc(PULLER_REMEDY)}; --check compares this box against itself instead of a target it cannot resolve — 'ccrc update' itself still refuses$`, 'm'));
    expect(localUrls(home)).toEqual([]);
  });

  itLinux('`desired none` refuses and says where the reason is; --channel takes the other line when it names a tag', () => {
    const home = managedFleetBox('ccrc-update-intent-none-');
    plantIntent(home, intentDoc({ desired: 'none', desiredStable: 'none', desiredDev: 'v2.1.0' }));
    packRelease(home, stubTree(home, { version: 'v2.1.0' }), { tag: 'v2.1.0', latest: false });
    for (const [args, key] of [[[], 'desired'], [['--channel', 'stable'], 'desired-stable']] as const) {
      const r = runUpdate(home, [...args]);
      expect(r.code, key).toBe(1);
      expect(r.stderr).toMatch(new RegExp(
        `^ccrc: update: the control plane resolves no target for this box \\(${key} none\\) — nothing newer than this box's floor is eligible, or the server declined one; its reason is on the console's update screen \\(GET /api/updates, resolveDetail\\); name one with --to <tag>$`, 'm'));
      expect(localUrls(home), key).toEqual([]);
    }
    const r = runUpdate(home, ['--channel', 'dev']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(localUrls(home)[0]).toBe(`local://${home}/releases/download/v2.1.0/SHA256SUMS`);
  });

  // A CONVERGED managed node's projection IS `desired none`: W2 names a tag
  // only when one is strictly newer than the floor (`notNewerThanFloor`), and
  // a completed install raises the floor to the running tag. So --check reads
  // `none` as "nothing newer" and compares the box against ITSELF (plan
  // D-3266) — a refusing --check would answer
  // exit 1, with no machine line, on every healthy managed box. `update`
  // itself still refuses (spec §9).
  itLinux('--check on a converged box whose projection says `none` answers state=current, exit 0, fetching nothing; update itself still refuses', () => {
    const home = managedFleetBox('ccrc-update-intent-none-current-');
    writeFileSync(join(home, '.ccrc', 'installed'), 'oldsha0000000000000000000000000000000000\n');   // plantOldBox's stamp sha
    plantIntent(home, intentDoc({ desired: 'none', desiredStable: 'none' }));
    const sentence = (key: string): string => `update: the control plane resolves no target for this box (${key} none) — nothing newer than this box's floor is eligible, or the server declined one; its reason is on the console's update screen (GET /api/updates, resolveDetail)`;
    for (const [args, key] of [[['--check'], 'desired'], [['--check', '--channel', 'stable'], 'desired-stable']] as const) {
      const r = runUpdate(home, [...args]);
      expect(r.code, `${key}: ${r.stderr}`).toBe(0);
      expect(r.stdout.split('\n')[0], key).toMatch(/^check: box=v1\.0\.0 sha=oldsha0+ target=v1\.0\.0 (.* )?state=current$/);
      expect(r.stdout.split('\n'), key).toContain(sentence(key));
      expect(r.stdout).toMatch(new RegExp(`^this box: v1\\.0\\.0 \\(oldsha0+\\) · channel stable \\(${key} none\\): v1\\.0\\.0 — current$`, 'm'));
      expect(localUrls(home), key).toEqual([]);
    }
    // No completed-install record: incomplete, exit 1 — and the reinstall it
    // names carries --to, because a bare update refuses on this projection.
    rmSync(join(home, '.ccrc', 'installed'));
    let r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    expect(checkLine(r.stdout)).toMatch(/ target=v1\.0\.0 (.* )?state=incomplete$/);
    expect(r.stdout).toMatch(/— same version, but the install never completed \(ccrc version explains\); 'ccrc update --to v1\.0\.0' will reinstall \(with no --to, update refuses: the control plane names no target\)$/m);
    // The install path keeps spec §9's refusal, nothing fetched.
    r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: the control plane resolves no target for this box \(desired none\) — nothing newer than this box's floor is eligible/m);
    expect(localUrls(home)).toEqual([]);
    // A box with no stamped version has nothing to compare against: refused.
    const bare = freshUpdateBox('ccrc-update-intent-none-unversioned-');
    plantOldBox(bare);
    plantRole(bare, 'fleet');
    plantSyncTimer(bare);
    plantClock(bare);
    plantIntent(bare, intentDoc({ desired: 'none', desiredStable: 'none' }));
    r = runUpdate(bare, ['--check']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: the control plane resolves no target for this box \(desired none\) — .*; this box records no release version to compare against — name one with --to <tag>$/m);
    expect(checkLine(r.stdout)).toBe('');
    expect(localUrls(bare)).toEqual([]);
  });

  itLinux('--check with no --to reports what update WOULD install — the projection\'s desired, on a server box too — and writes nothing', () => {
    const home = freshUpdateBox('ccrc-update-intent-check-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantRole(home, 'server');
    plantClock(home);
    plantIntent(home, intentDoc());
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    updateEnv(home);
    replantDoctorStubs(home);
    const before = homeSnapshot(home);
    const r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    expect(r.stdout.split('\n')[0]).toMatch(/^check: box=v1\.0\.0 sha=\S+ target=v2\.0\.0 (.* )?state=behind$/);
    expect(r.stdout).toMatch(/^update: following the control plane — channel stable, desired v2\.0\.0$/m);
    expect(r.stdout).toMatch(/^this box: v1\.0\.0 \(\S+\) · channel stable: v2\.0\.0 — behind$/m);
    expect(localUrls(home)).toEqual([`local://${home}/releases/download/v2.0.0/SHA256SUMS`]);
    expect(homeSnapshot(home)).toEqual(before);
  });

  // §18 "the floor is checked on every path": the W1 check keys on the
  // RESOLVED version, and the projection is a third way to resolve it.
  itLinux('a projection-resolved target below the floor is refused before any backup, naming the control plane', () => {
    const home = freshUpdateBox('ccrc-update-intent-floor-');
    plantOldBox(home, { version: 'v3.0.0' });
    writeFileSync(join(home, '.ccrc', 'floor'), 'v3.0.0\n');
    plantRole(home, 'fleet');
    plantSyncTimer(home);
    plantClock(home);
    plantIntent(home, intentDoc());
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/v2\.0\.0 \(resolved by the control plane \(channel stable\)\) is below this box's floor v3\.0\.0/);
    // Review fix round 1 I5 (narrowing item 17 / review 155 C28): the
    // target's VERSION (v2.0.0) differs from the running stamp's (v3.0.0),
    // so the floor is checked BEFORE the fetch here — see the sibling
    // `latest/download` case's own comment.
    expect(localUrls(home)).toEqual([`local://${home}/releases/download/v2.0.0/SHA256SUMS`]);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });

  it('--channel is a usage error beside --to, with no value, or with any word but stable|dev — exit 2, nothing fetched', () => {
    const home = freshUpdateBox('ccrc-update-intent-argv-');
    const cases: Array<[string[], RegExp]> = [
      [['--channel', 'dev', '--to', 'v1.0.0'], /^ccrc: update: --channel and --to are exclusive — --to names the tag, --channel asks the control plane which one; pick one$/m],
      [['--to=v1.0.0', '--channel=stable'], /^ccrc: update: --channel and --to are exclusive/m],
      [['--channel', 'beta'], /^ccrc: --channel expects stable or dev \(got: beta\)$/m],
      [['--channel='], /^ccrc: --channel expects stable or dev \(got: nothing\)$/m],
      [['--channel'], /^ccrc: --channel needs a value: stable or dev$/m],
    ];
    for (const [args, says] of cases) {
      const r = runUpdate(home, args);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.stderr, args.join(' ')).toMatch(says);
      expect(existsSync(join(home, 'curl-argv')), `${args.join(' ')}: a fetch ran`).toBe(false);
    }
  });

  // The Darwin arm, measured on EVERY platform: `CCD_OS` is computed at
  // source time, so an assignment after the `.` is how a Linux run reaches
  // it (Task 3's `sourcedCcrc`). A projection, a role and a timer are all
  // present — the reader must answer before it looks at any of them.
  it('the reader answers not-configured on CCD_OS=darwin before it reads a byte, and --channel is refused there', () => {
    const home = freshUpdateBox('ccrc-update-intent-darwin-arm-');
    plantRole(home, 'fleet');
    plantSyncTimer(home);
    plantIntent(home, intentDoc());
    let r = sourcedCcrc(home, 'CCD_OS=darwin; _upd_intent_state; printf "%s|%s|%s\\n" "$UPD_INTENT_STATE" "$UPD_INTENT_WHY" "$UPD_INTENT_DESIRED"; _upd_target "" ""; printf "via=%s target=[%s]\\n" "$UPD_TARGET_VIA" "$UPD_TARGET"');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')).toEqual([
      'not-configured|macos|',
      'update: no control plane on this box (macOS: not centrally managed) — following stable',
      'via=latest/download target=[]',
      '',
    ]);
    r = sourcedCcrc(home, 'CCD_OS=darwin; _upd_target "" dev; echo unreachable');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: --channel needs the control plane \(no projection resolves on this box\); use --to <tag>$/m);
    expect(r.stdout).not.toMatch(/unreachable/);
  });

  // The clock-failure guard (`ccd/ccrc:12934-12938`): without it, an empty
  // `now="$(date +%s)"` reads as 0 in `(( now > 10#${vals[2]} ))`, so a lease
  // that cannot be measured reads as PERMANENTLY in force rather than
  // refusing — mutation `date() { :; }` must go RED here.
  itLinux('an unmeasurable clock (date +%s answers nothing) reads unreadable, never "0 — every lease in force"', () => {
    const home = managedFleetBox('ccrc-update-intent-clock-fail-');
    plantIntent(home, intentDoc());
    let r = sourcedCcrc(home,
      'date() { :; }; _upd_intent_state; printf "%s|%s\\n" "$UPD_INTENT_STATE" "$UPD_INTENT_WHY"');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('unreadable|the clock did not answer: date +%s\n');
    r = sourcedCcrc(home, 'date() { :; }; _upd_target "" ""; echo unreachable');
    expect(r.code).toBe(1);
    expect(r.stdout).not.toMatch(/unreachable/);
    expect(r.stderr).toMatch(new RegExp(
      `^ccrc: update: ~/\\.ccrc/update-intent is unreadable \\(the clock did not answer: date \\+%s\\) — ${esc(PULLER_REMEDY)}$`, 'm'));
  });
});

describe('ccrc channel (design 2026-09-20 §14 — read-only)', () => {
  itLinux('an in-force projection: the machine line carries the document, then one sentence; exit 0; nothing written', () => {
    const home = managedFleetBox('ccrc-channel-ok-');
    plantIntent(home, intentDoc({ channel: 'dev', desired: 'v2.1.0', auto: 'channel' }));
    updateEnv(home);
    replantDoctorStubs(home);
    const before = homeSnapshot(home);
    const r = runChannel(home);
    expect(r.code, r.stderr).toBe(0);
    const out = r.stdout.split('\n');
    expect(out[0]).toBe('channel: state=ok channel=dev desired=v2.1.0 desired-stable=v2.0.0 desired-dev=v2.1.0 auto=channel');
    expect(out[1]).toBe("this box follows channel dev: the control plane resolves v2.1.0 (stable v2.0.0, dev v2.1.0; auto channel) — 'ccrc update' with no --to installs v2.1.0; the channel is set from the console");
    expect(out.slice(2)).toEqual(['']);
    expect(homeSnapshot(home)).toEqual(before);
  });

  itLinux('every other state: its word, `-` for each field no document carries, and its exit code', () => {
    type Case = { name: string; plant: (h: string) => void; line: string; says: RegExp; code: number };
    const dash = 'channel=- desired=- desired-stable=- desired-dev=- auto=-';
    const cases: Case[] = [
      { name: 'none', plant: (h) => { plantRole(h, 'fleet'); plantSyncTimer(h); plantIntent(h, intentDoc({ desired: 'none', desiredStable: 'none' })); },
        line: 'channel: state=none channel=stable desired=none desired-stable=none desired-dev=v2.1.0 auto=off',
        says: /^this box follows channel stable: the control plane resolves no target for it \(desired none\) — its reason is on the console's update screen/m, code: 0 },
      { name: 'not-configured', plant: (h) => plantRole(h, 'fleet'),
        line: `channel: state=not-configured ${dash}`, says: /^no control plane on this box — 'ccrc update' follows stable$/m, code: 1 },
      { name: 'unreadable (never synced)', plant: (h) => { plantRole(h, 'fleet'); plantSyncTimer(h); },
        line: `channel: state=unreadable ${dash}`, says: new RegExp(`^~/\\.ccrc/update-intent is unreadable \\(never synced\\) — ${esc(PULLER_REMEDY)}$`, 'm'), code: 1 },
      { name: 'unreadable (absent, server)', plant: (h) => plantRole(h, 'server'),
        line: `channel: state=unreadable ${dash}`, says: new RegExp(`^~/\\.ccrc/update-intent is unreadable \\(absent\\) — ${esc(SERVER_REMEDY)}$`, 'm'), code: 1 },
      { name: 'stale', plant: (h) => { plantRole(h, 'server'); plantIntent(h, intentDoc({ issued: String(INTENT_NOW - 2000), lease: String(INTENT_NOW - 1100) })); },
        line: `channel: state=stale ${dash}`, says: /is stale — its lease ended 1100s ago; restart ccrc\.service/m, code: 1 },
      // No role recorded and no puller installed: the only writer of a
      // present copy is a server that DERIVED its role (W2's D-3174), so the
      // remedy is the server's — never a unit this box does not have.
      { name: 'stale, no role, no timer', plant: (h) => plantIntent(h, intentDoc({ issued: String(INTENT_NOW - 2000), lease: String(INTENT_NOW - 1100) })),
        line: `channel: state=stale ${dash}`, says: new RegExp(`is stale — its lease ended 1100s ago; ${esc(SERVER_REMEDY)}$`, 'm'), code: 1 },
      // …and with the timer unit file installed, the puller's.
      { name: 'stale, no role, timer', plant: (h) => { plantSyncTimer(h); plantIntent(h, intentDoc({ issued: String(INTENT_NOW - 2000), lease: String(INTENT_NOW - 1100) })); },
        line: `channel: state=stale ${dash}`, says: new RegExp(`is stale — its lease ended 1100s ago; ${esc(PULLER_REMEDY)}$`, 'm'), code: 1 },
    ];
    for (const c of cases) {
      const home = freshUpdateBox('ccrc-channel-state-');
      plantClock(home);
      c.plant(home);
      const r = runChannel(home);
      expect(r.stdout.split('\n')[0], c.name).toBe(c.line);
      expect(r.stdout, c.name).toMatch(c.says);
      expect(r.code, c.name).toBe(c.code);
    }
  });

  // The whole-document grammar (spec §9), case by case, through the verb.
  // Every row must answer `malformed` — except the two the grammar admits.
  itLinux('the grammar: every torn, reordered, widened or foreign document is malformed; a missing final newline is not', () => {
    const doc = intentDoc();
    const malformed: Array<[string, string | Buffer] | [string, string | Buffer, RegExp]> = [
      ['empty', ''],
      ['torn before end', doc.replace('end\n', '')],
      ['torn mid-line', doc.slice(0, doc.indexOf('desired-dev') + 9)],
      ['a blank line after end', `${doc}\n`],
      ['a tenth line', doc.replace('auto off\n', 'auto off\nauto off\n')],
      ['a blank line inside', doc.replace('channel stable\n', 'channel stable\n\n')],
      ['reordered', doc.replace(/^epoch 7\nissued (\d+)\n/, 'issued $1\nepoch 7\n')],
      ['CRLF', doc.replace(/\n/g, '\r\n')],
      ['a leading zero', doc.replace('epoch 7', 'epoch 07')],
      ['a negative number', doc.replace('epoch 7', 'epoch -7')],
      ['twenty digits (wraps positive in bash)', intentDoc({ lease: '99999999999999999999' })],
      ['two spaces', doc.replace('epoch 7', 'epoch  7')],
      ['a tag without its v', intentDoc({ desired: '2.0.0' })],
      ['a word for a tag', intentDoc({ desiredDev: 'latest' })],
      ['an unknown channel', intentDoc({ channel: 'beta' })],
      ['an unknown auto', intentDoc({ auto: 'on' })],
      ['a NUL byte', Buffer.concat([Buffer.from('epoch 7\0'), Buffer.from(doc.slice('epoch 7'.length))])],
      ['over the 65536-byte cap', doc.replace('epoch 7', `epoch 7${'0'.repeat(70_000)}`)],
      // C23 (review 155, fix round 1 item 15) and I2 (review 155 fix round 1
      // review): the puller's own value checks (ccd/ccd-update-sync's PASS
      // 3), re-checked here by the READER too — the puller is not in front
      // of a server/both box's own writer, so nothing else re-verifies
      // these on the node before this reader would otherwise trust them.
      // `why` (fix round 1 review m4) pins WHICH check fired, not merely
      // that some check did.
      ['desired disagrees with its own channel\'s resolution', intentDoc({ desired: 'v2.1.0' }),
        /desired v2\.1\.0 disagrees with desired-stable v2\.0\.0/],
      ['a lease before its own issued', intentDoc({ issued: String(INTENT_NOW - 60), lease: String(INTENT_NOW - 61) }),
        /lease \d+ does not fall in the day after issued \d+/],
      ['a lease more than a day after its own issued',
        intentDoc({ issued: String(INTENT_NOW - 60), lease: String(INTENT_NOW - 60 + 86_400 + 1) }),
        /lease \d+ does not fall in the day after issued \d+/],
      // I2: the reader also refuses an `issued` more than a day AHEAD of
      // this node's clock (the FUTURE half only — a past `issued` stays
      // `stale` via the lease, never `malformed`), and a timestamp wider
      // than the puller's own width bound (`SECONDS_DIGITS=11`,
      // ccd/ccd-update-sync's own PASS 3 `seconds()`).
      ['an issued more than a day ahead of this node\'s clock',
        intentDoc({ issued: String(INTENT_NOW + 315_360_000), lease: String(INTENT_NOW + 315_360_000 + 900) }),
        /issued \d+ is more than a day ahead of this node clock/],
      ['an issued wider than 11 digits', intentDoc({ issued: '2000000000000', lease: '2000000000900' }),
        /issued 2000000000000 carries 13 digits: unix seconds carry at most 11/],
      // Corrected (fix round 1 review m1): the earlier comment here claimed
      // this reader "still has no SECONDS-vs-MILLISECONDS check of its
      // own" — false as of I2, above. The WIDTH check now runs first and is
      // the one that actually fires on this document; the lease-window
      // check (which also happened to catch it, incidentally, before I2)
      // never gets a chance to.
      ['a 13-digit (ms-shaped) lease is grammatical, but is refused on its width', intentDoc({ lease: '2000000000000' }),
        /lease 2000000000000 carries 13 digits: unix seconds carry at most 11/],
    ];
    for (const [name, text, why] of malformed) {
      const home = managedFleetBox('ccrc-channel-grammar-');
      plantIntent(home, text);
      const r = runChannel(home);
      expect(r.stdout.split('\n')[0], name).toMatch(/^channel: state=malformed channel=- /);
      expect(r.stdout, name).toMatch(/is malformed \(.+\) — refusing to follow a projection this reader does not recognise; systemctl --user start ccd-update-sync\.service$/m);
      if (why) expect(r.stdout, name).toMatch(why);
      expect(r.code, name).toBe(1);
    }
    for (const [name, text] of [
      ['no final newline', doc.slice(0, -1)],
      // m3: the lease window's own edges are pinned, not just its interior —
      // both are INCLUSIVE (`_upd_intent_state` uses strict `<`/`>`, never
      // `<=`/`>=`), matching the puller's own `issued <= lease <= issued +
      // DAY`. `issued` is INTENT_NOW itself (not the usual `-60`) so `now`
      // never runs strictly past `lease` and flips these into `stale`.
      ['lease == issued (m3, the inclusive lower edge)', intentDoc({ issued: String(INTENT_NOW), lease: String(INTENT_NOW) })],
      ['lease == issued + 86400 (m3, the inclusive upper edge)',
        intentDoc({ issued: String(INTENT_NOW), lease: String(INTENT_NOW + 86_400) })],
    ] as const) {
      const home = managedFleetBox('ccrc-channel-grammar-ok-');
      plantIntent(home, text);
      const r = runChannel(home);
      expect(r.stdout.split('\n')[0], name).toMatch(/^channel: state=ok /);
    }
    const home = managedFleetBox('ccrc-channel-grammar-dir-');
    mkdirSync(intentPath(home), { recursive: true });
    const r = runChannel(home);
    expect(r.stdout).toMatch(/^channel: state=unreadable /);
    expect(r.stdout).toMatch(/is unreadable \(not a readable regular file\)/);
  }, 60_000);

  it('every argument is refused — the channel is set from the console (decision 15); -h prints usage', () => {
    const home = freshUpdateBox('ccrc-channel-argv-');
    plantIntent(home, intentDoc());
    const doc = readFileSync(intentPath(home));
    for (const args of [['dev'], ['stable'], ['--set', 'dev'], ['--channel=dev']]) {
      const r = runChannel(home, args);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.stderr).toMatch(/^ccrc: channel: set the channel from the console — a node never writes intent \(decision 15\)$/m);
      expect(r.stdout, args.join(' ')).toBe('');
    }
    expect(readFileSync(intentPath(home)).equals(doc)).toBe(true);
    const h = runChannel(home, ['-h']);
    expect(h.code).toBe(0);
    expect(h.stdout).toMatch(/usage: ccrc \{/);
  });
});

describe('ccrc watchdog: a re-measurement, never a timestamp alone (design §11)', () => {
  // THE REPORT'S OWN UNIT: unix SECONDS (rulings R1, R14). Task 1's
  // `_upd_phase` stamps `startedAt` and `updatedAt` with `date +%s`, and
  // `cmd_watchdog` reads its clock with the same call; the deadline alone is
  // milliseconds (`CCRC_UPDATE_DEADLINE_MS`, W2's `updateDeadlineMs`), divided
  // by 1000 at the one place it is compared. The real-writer case at the end
  // of this block is the one that goes red if the two sides ever disagree.
  const nowS = (): number => Math.floor(Date.now() / 1000);
  /** One minute: a 90 s report is stale, a 200 s one is past twice it. */
  const DEADLINE_MS = '60000';
  /** W2's own `IN_FLIGHT_UPDATE_PHASES` (shared/api.ts), not a hand copy of
   *  spec §6 (W4a Task 15): the order check below (`toEqual(IN_FLIGHT)`)
   *  measures `ccd/ccrc`'s bash array against W2's REAL array — exact set
   *  AND order — by construction. */
  const IN_FLIGHT: readonly string[] = IN_FLIGHT_UPDATE_PHASES;
  const NOT_IN_FLIGHT = UPDATE_PHASES.filter((p) => !IN_FLIGHT.includes(p));

  /** `$HOME/.local/bin/ccrc` — the launcher the watchdog's rollback runs
   *  through — as a RECORDER: its argv; whether ~/.ccrc/update.lock was FREE
   *  when it ran (the rollback takes that lock itself, so the watchdog must
   *  have let go of it); whether a lock marker reached it; an optional report
   *  it writes as its own; its exit code. What `ccrc rollback` DOES is Task
   *  7's subject — this block owns who calls it, when, and what is recorded
   *  around it. */
  const LAUNCHER = [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/launcher-argv"',
    'if flock -n "$HOME/.ccrc/update.lock" true; then echo free; else echo held; fi >> "$HOME/launcher-lock"',
    'printf \'%s\\n\' "${CCRC_UPDATE_LOCK_HELD:-unset}" >> "$HOME/launcher-marker"',
    '[ -f "$HOME/fixture-rollback-report" ] && cp "$HOME/fixture-rollback-report" "$HOME/.ccrc/update.json"',
    // F4 (fix round 1, Task 9): a launcher that leaves ~/.ccrc/update.lock
    // HELD when it exits — the refused-rollback re-lock guard's own
    // `&& flock -n "$UPD_LOCK_FD"` half, unpinned until now. Backgrounded so
    // it survives the launcher's own exit, and polled-for so the watchdog's
    // re-lock attempt is guaranteed to see it CONTENDED, never a race.
    'if [ -f "$HOME/fixture-rollback-leaves-holder" ]; then',
    '  flock "$HOME/.ccrc/update.lock" sleep 3 &',
    '  until ! flock -n "$HOME/.ccrc/update.lock" true 2>/dev/null; do sleep 0.02; done',
    'fi',
    // Review fix round 1, M1's own pin: swap update.json for a FIFO right
    // before this launcher exits, so the watchdog's re-lock-and-re-read
    // (the THIRD read, guarded by M1) meets a FIFO, never the report this
    // launcher was handed.
    '[ -f "$HOME/fixture-rollback-fifo-swap" ] && { rm -f "$HOME/.ccrc/update.json"; mkfifo "$HOME/.ccrc/update.json"; }',
    'code=0',
    '[ -f "$HOME/fixture-rollback-exit" ] && IFS= read -r code < "$HOME/fixture-rollback-exit"',
    'exit "$code"',
  ].join('\n') + '\n';

  const stampSha = (home: string): string =>
    (JSON.parse(readFileSync(join(home, '.ccrc', 'build.json'), 'utf8')) as { sha: string }).sha;
  /** A server box on stamp `version`, carrying the three facts "converged"
   *  is made of when a report names that version: the recorded role, the
   *  loopback address `_upd_gate_probe`'s `/health` read resolves through
   *  `_box_server_addr`, and a completed-install record naming the stamp's
   *  sha — read off the stamp, never retyped. `role: null` records none. */
  const watchBox = (prefix: string, opts: { version?: string; role?: string | null } = {}): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: opts.version ?? 'v2.0.0' });
    const role = opts.role === undefined ? 'server' : opts.role;
    writeFileSync(join(home, '.ccrc', 'ccrc.env'),
      `${role === null ? '' : `CCRC_ROLE=${role}\n`}CCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n`);
    writeFileSync(join(home, '.ccrc', 'installed'), `${stampSha(home)}\n`);
    writeFileSync(join(home, '.local', 'bin', 'ccrc'), LAUNCHER, { mode: 0o755 });
    return home;
  };

  type WatchReport = { target: string | null; phase: string; startedAt: number; updatedAt: number;
    detail: null; from: string; pid: number };
  const jsonPath = (home: string): string => join(home, '.ccrc', 'update.json');
  /** A report in Task 1's exact shape — seven keys, in order — last written
   *  `ageS` seconds ago. */
  const report = (home: string,
    r: { phase: string; ageS: number; target?: string | null; pid?: number; from?: string }): WatchReport => {
    const updatedAt = nowS() - r.ageS;
    const doc: WatchReport = {
      target: r.target === undefined ? 'v2.0.0' : r.target,
      phase: r.phase,
      startedAt: updatedAt - 45,
      updatedAt,
      detail: null,
      from: r.from ?? 'pwa',
      pid: r.pid ?? 4321,
    };
    writeFileSync(jsonPath(home), `${JSON.stringify(doc)}\n`);
    return doc;
  };
  const readReport = (home: string): Record<string, unknown> =>
    JSON.parse(readFileSync(jsonPath(home), 'utf8')) as Record<string, unknown>;
  const lines = (home: string, name: string): string[] => (existsSync(join(home, name))
    ? readFileSync(join(home, name), 'utf8').split('\n').filter((l) => l !== '') : []);
  /** The gate's own `/health` read ran: the watchdog MEASURED a healthy unit. */
  const healthProbed = (home: string): boolean =>
    lines(home, 'curl-argv').some((u) => u === 'http://127.0.0.1:7788/health');
  /** The probe STARTED at all. `_upd_gate_probe` measures the unit before it
   *  spends a `/health` request (Task 5), so on a box whose `fixture-unit-state`
   *  reads `failed` `healthProbed` is false whether or not a probe ran — the
   *  "nothing probed" negatives read the unit question instead. */
  const probed = (home: string): boolean =>
    lines(home, 'systemctl-calls').some((c) => c === '--user is-active ccrc.service');
  const lockFree = (home: string): boolean =>
    spawnSync('flock', ['-n', join(home, '.ccrc', 'update.lock'), 'true']).status === 0;

  const runWatchdog = (home: string, args: string[] = [],
    extraEnv: Record<string, string | undefined> = {}): Result => {
    mkdirSync(join(home, 'tmp'), { recursive: true });
    const env: NodeJS.ProcessEnv = {
      // D-3278 (fix round 1): three failing samples, `CCRC_WATCHDOG_PROBE_GAP_S`
      // apart, decide a rollback — defaulted to 0 here so a suite does not pay
      // real sleep time per failing-probe case; the gap test overrides it.
      ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_UPDATE_DEADLINE_MS: DEADLINE_MS,
      CCRC_WATCHDOG_PROBE_GAP_S: '0',
    };
    for (const [k, v] of Object.entries(extraEnv)) {
      if (v === undefined) delete env[k]; else env[k] = v;
    }
    replantDoctorStubs(home);
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'watchdog', ...args], { env, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };

  const release = (pgid: number): void => {
    try { process.kill(-pgid, 'SIGKILL'); } catch { /* already gone */ }
  };
  /** A LIVE holder: a real `flock` on the real lock file, in its own process
   *  group, returned once the lock measurably IS held. `flock <file> sleep 30`
   *  hands its descriptor to the `sleep` child, which a kill of `flock` alone
   *  would leave holding the lock (Task 2's reason for its one-process
   *  `bash -c 'exec 9>>…'` holder); `release` kills the whole GROUP, so both go. */
  const holdLock = async (home: string): Promise<number> => {
    const holder = spawn('flock', [join(home, '.ccrc', 'update.lock'), 'sleep', '30'],
      { stdio: 'ignore', detached: true });
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      if (!lockFree(home)) return holder.pid!;
      await new Promise((res) => setTimeout(res, 20));
    }
    release(holder.pid!);
    throw new Error('the fixture holder never took ~/.ccrc/update.lock');
  };

  itLinux('leaves an absent, a settled, an unreadable and a fresh report alone — one line each, exit 0, nothing probed, nothing rolled back', () => {
    const home = watchBox('ccrc-watchdog-quiet-');
    // A box that WOULD be rolled back if any of these acted.
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    let r = runWatchdog(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('watchdog: no update report\n');
    for (const phase of NOT_IN_FLIGHT) {
      report(home, { phase, ageS: 3600 });
      const before = readFileSync(jsonPath(home), 'utf8');
      r = runWatchdog(home);
      expect(r.code, `${phase}: ${r.stderr}`).toBe(0);
      expect(r.stdout).toBe(`watchdog: last update ${phase} — nothing to do\n`);
      expect(readFileSync(jsonPath(home), 'utf8')).toBe(before);
    }
    for (const bad of ['not json\n', '[1,2]\n', '{"phase":"installing"}\n',
      '{"phase":"installing","updatedAt":"yesterday"}\n', '{"phase":"installing","updatedAt":1.5}\n',
      // A MILLISECOND stamp (13 digits): not this file's unit (rulings R1,
      // R14), and past W2's UNIX_SECONDS_MAX — unreadable, never "fresh".
      `{"phase":"installing","updatedAt":${Date.now()}}\n`,
      '{"phase":"install\\u001bing","updatedAt":1}\n']) {
      writeFileSync(jsonPath(home), bad);
      r = runWatchdog(home);
      expect(r.code, `${bad}: ${r.stderr}`).toBe(0);
      expect(r.stdout).toBe('watchdog: ~/.ccrc/update.json is unreadable or malformed — not acting on what cannot be read\n');
      expect(readFileSync(jsonPath(home), 'utf8')).toBe(bad);
    }
    report(home, { phase: 'installing', ageS: 30 });
    r = runWatchdog(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^watchdog: update in progress \(installing, 3\ds old\)\n$/);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
    expect(probed(home)).toBe(false);
  });

  // Fix round 1 item 9 / review 155 C15: a FIFO at ~/.ccrc/update.json must
  // not block the watchdog's tick — `_upd_report_readable` refuses it
  // UNOPENED, before the first `jq`, so the run returns within its own
  // deadline rather than sitting wedged for the unit's whole
  // TimeoutStartSec. Bounded by `runBounded` (GNU `timeout -k`, the process
  // GROUP) because a plain spawnSync timeout cannot reach a hang inside
  // jq, a grandchild of the watchdog process.
  it.skipIf(process.platform !== 'linux' || UPD_DEADLINE_BIN === null)(
    'a FIFO at ~/.ccrc/update.json is refused UNOPENED, promptly, never blocking the tick (fix round 1 item 9 / review 155 C15)', () => {
      const home = watchBox('ccrc-watchdog-fifo-');
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      rmSync(jsonPath(home), { force: true });
      expect(spawnSync('mkfifo', [jsonPath(home)]).status, 'mkfifo').toBe(0);
      mkdirSync(join(home, 'tmp'), { recursive: true });
      const env: NodeJS.ProcessEnv = {
        ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_UPDATE_DEADLINE_MS: DEADLINE_MS,
        CCRC_WATCHDOG_PROBE_GAP_S: '0',
      };
      replantDoctorStubs(home);
      const r = runBounded([BASH, join(REPO, 'ccd', 'ccrc'), 'watchdog'], env, 5000);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe('watchdog: ~/.ccrc/update.json is unreadable or malformed — not acting on what cannot be read\n');
    }, 15000);

  itLinux('acts on exactly the nine in-flight phases — W2\'s IN_FLIGHT_UPDATE_PHASES — declared once in ccd/ccrc', () => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const m = /^UPD_IN_FLIGHT_PHASES=\(([^)]*)\)$/m.exec(src);
    expect(m, 'ccd/ccrc declares no UPD_IN_FLIGHT_PHASES').toBeTruthy();
    expect(m![1]!.split(' ')).toEqual(IN_FLIGHT);
    expect(src.split('\n').filter((l) => l.startsWith('UPD_IN_FLIGHT_PHASES=')).length).toBe(1);
    const home = watchBox('ccrc-watchdog-inflight-');
    for (const phase of IN_FLIGHT) {
      report(home, { phase, ageS: 90 });
      const r = runWatchdog(home);
      expect(r.code, `${phase}: ${r.stderr}`).toBe(0);
      expect(readReport(home).phase, phase).toBe('failed');
      expect(readReport(home).detail, phase).toBe('abandoned by its updater; box measures converged at v2.0.0');
    }
  });

  // Fix round 1 item 23-C6 / review 155 C6, RE-PINNED per review fix round
  // 1 I4: an unknown/corrupted `from` is NOT item 18's retry signal (that
  // keys on the RAW word being literally `watchdog`, captured before this
  // coercion) — it is C6's own fallback, for JSON-injection safety on a
  // REWRITE only. So a genuinely stale report whose `from` is merely
  // unknown, on an UNHEALTHY box, is reverted exactly as any other stale
  // report would be — ONE revert attempt — and when that attempt is
  // refused, `cmd_watchdog`'s own rewrite (`_upd_phase`, using the COERCED
  // `UPD_FROM`) must still parse as JSON with `from: watchdog`.
  itLinux('an unknown/corrupted `from` on an unhealthy box is reverted as any other stale report — ONE revert attempt, and the rewrite is still valid JSON with from=watchdog (review fix round 1 I4 / fix round 1 item 23-C6 / review 155 C6)', () => {
    const home = watchBox('ccrc-watchdog-from-quote-');
    const doc = { target: 'v2.0.0', phase: 'installing', startedAt: nowS() - 135, updatedAt: nowS() - 90,
      detail: null, from: 'a"b', pid: 4242 };
    writeFileSync(jsonPath(home), `${JSON.stringify(doc)}\n`);
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    writeFileSync(join(home, 'fixture-rollback-exit'), '1\n');
    const r = runWatchdog(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toMatch(/— rolling back$/m);
    expect(lines(home, 'launcher-argv')).toEqual(['rollback --from watchdog']);
    const raw = readFileSync(jsonPath(home), 'utf8');
    let parsed: Record<string, unknown> = {};
    expect(() => { parsed = JSON.parse(raw) as Record<string, unknown>; }, `not valid JSON:\n${raw}`).not.toThrow();
    expect(parsed.from, raw).toBe('watchdog');
    expect(parsed.phase, raw).toBe('failed');
    expect(String(parsed.detail)).toMatch(/^watchdog: rollback refused \(exit 1\); box unhealthy: /);
  });

  itLinux('stale, no holder, and the box measures CONVERGED at the target: rewritten failed: abandoned…converged, the updater\'s attribution kept, NO rollback (§18 "the watchdog re-measures before it reverts")', () => {
    const home = watchBox('ccrc-watchdog-converged-');
    const was = report(home, { phase: 'installing', ageS: 90, from: 'pwa', pid: 4321 });
    const r = runWatchdog(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const now = readReport(home);
    expect(Object.keys(now)).toEqual(['target', 'phase', 'startedAt', 'updatedAt', 'detail', 'from', 'pid']);
    expect(now.phase).toBe('failed');
    expect(now.detail).toBe('abandoned by its updater; box measures converged at v2.0.0');
    expect(now.target).toBe('v2.0.0');
    expect(now.from).toBe('pwa');
    expect(now.pid).toBe(4321);
    expect(now.startedAt).toBe(was.startedAt);
    expect(now.updatedAt as number).toBeGreaterThan(was.updatedAt);
    expect(r.stdout).toMatch(/^watchdog: stale report \(installing, 9\ds\) on a box that measures converged at v2\.0\.0 and answers healthy — recorded as abandoned; nothing was reverted$/m);
    // It MEASURED — the gate's own /health read ran — and it did not revert.
    expect(healthProbed(home)).toBe(true);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
    // …and it let go: a later update is never refused by a watchdog that ended.
    expect(lockFree(home)).toBe(true);
  });

  itLinux('stale, no holder, healthy but NOT converged: rewritten with what the box IS, never a rollback (D-3246, D-3268)', () => {
    // The updater died before the tree moved: healthy on the OLD build.
    const home = watchBox('ccrc-watchdog-healthy-old-', { version: 'v1.0.0' });
    report(home, { phase: 'fetching', ageS: 90, target: 'v2.0.0' });
    let r = runWatchdog(home);
    expect(r.code, r.stderr).toBe(0);
    expect(readReport(home).detail).toBe('abandoned by its updater; box measures healthy at v1.0.0, not at v2.0.0');
    expect(r.stdout).toMatch(/\(only a failing probe reverts\)$/m);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
    // On the target and healthy, but the spine never reached `_inst_installed`:
    // a box to FINISH, not to revert — and the sentence says how.
    const home2 = watchBox('ccrc-watchdog-healthy-incomplete-');
    writeFileSync(join(home2, '.ccrc', 'installed'), 'a-record-for-some-other-build\n');
    report(home2, { phase: 'installing', ageS: 90 });
    r = runWatchdog(home2);
    expect(r.code, r.stderr).toBe(0);
    expect(readReport(home2).detail).toBe('abandoned by its updater; box answers healthy on v2.0.0 but its install never completed (the completed-install record does not name its stamp); rerun: ccrc update --to v2.0.0 --force');
    expect(existsSync(join(home2, 'launcher-argv'))).toBe(false);
    // …and when the run that died was a ROLLBACK, `update --force` would be
    // refused below the floor (M7): the remedy is Task 7's `_upd_rerun_hint`.
    report(home2, { phase: 'installing', ageS: 90, from: 'rollback' });
    r = runWatchdog(home2);
    expect(r.code, r.stderr).toBe(0);
    expect(readReport(home2).detail).toBe('abandoned by its updater; box answers healthy on v2.0.0 but its install never completed (the completed-install record does not name its stamp); rerun: ccrc rollback --to v2.0.0');
    // D-3285 (final review, B3(ii)): `restore` — arm 2's own child — is the
    // SAME shape: the PARENT's completed spine already raised the floor to
    // the tag that just failed, so `update --to <prev> --force` is refused
    // there too; `_upd_rerun_hint` now groups `restore` with `rollback`.
    report(home2, { phase: 'installing', ageS: 90, from: 'restore' });
    r = runWatchdog(home2);
    expect(r.code, r.stderr).toBe(0);
    expect(readReport(home2).detail).toBe('abandoned by its updater; box answers healthy on v2.0.0 but its install never completed (the completed-install record does not name its stamp); rerun: ccrc rollback --to v2.0.0');
    // A report with no target (null) is never "converged", and stays null.
    const home3 = watchBox('ccrc-watchdog-healthy-notarget-');
    report(home3, { phase: 'resolving', ageS: 90, target: null });
    r = runWatchdog(home3);
    expect(r.code, r.stderr).toBe(0);
    expect(readReport(home3).detail).toBe('abandoned by its updater; box measures healthy at v2.0.0, not at its target');
    expect(readReport(home3).target).toBe(null);
  });

  itLinux('stale, no holder, healthy but NOT at the target, in a phase that may have moved the tree: left non-terminal and re-measured every tick, so a later failing probe still reverts it (D-3246, design §11)', () => {
    // The updater was killed INSIDE `_inst_tree`, `_inst_bins` or `_inst_files`,
    // which run before `_inst_stamp` and `_inst_enable`. The stamp still names
    // v1.0.0 and ccrc.service is still the old in-memory process, so the probe
    // passes on v1.0.0, over a tree that is partly v2.0.0 on disk. A terminal
    // `failed` here would answer "nothing to do" on the tick after ccrc.service
    // restarts onto that tree, which is design §11's own scenario.
    for (const phase of ['installing', 'restarting', 'checking', 'restoring']) {
      const home = watchBox(`ccrc-watchdog-healthy-moving-${phase}-`, { version: 'v1.0.0' });
      report(home, { phase, ageS: 90, target: 'v2.0.0' });
      const before = readFileSync(jsonPath(home), 'utf8');
      let r = runWatchdog(home);
      expect(r.code, `${phase}: ${r.stderr}`).toBe(0);
      expect(r.stdout).toMatch(new RegExp(`^watchdog: stale report \\(${phase}, 9\\ds\\) on a box that answers healthy at v1\\.0\\.0, not at v2\\.0\\.0 — its tree may be partly replaced; not acting, re-measuring every tick$`, 'm'));
      expect(readFileSync(jsonPath(home), 'utf8'), phase).toBe(before);
      // It MEASURED, and it let go of the lock.
      expect(healthProbed(home), phase).toBe(true);
      expect(existsSync(join(home, 'launcher-argv')), phase).toBe(false);
      expect(lockFree(home), phase).toBe(true);
      // ccrc.service restarts onto the half-placed tree and fails: the NEXT
      // tick still reverts, because nothing above closed the report.
      writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
      r = runWatchdog(home);
      expect(r.code, `${phase}: ${r.stderr}`).toBe(0);
      expect(lines(home, 'launcher-argv'), phase).toEqual(['rollback --from watchdog']);
    }
  });

  itLinux('stale, no holder, and the box FAILS its health probe: ccrc rollback --from watchdog, with the lock FREE and no marker; the rollback owns update.json after (§18 "the watchdog reverts a dead updater")', () => {
    const home = watchBox('ccrc-watchdog-revert-');
    report(home, { phase: 'installing', ageS: 90 });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    // An ambient marker must never reach the rollback: it takes the lock itself.
    const r = runWatchdog(home, [], { CCRC_UPDATE_LOCK_HELD: String(process.pid) });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^watchdog: stale report \(installing, 9\ds\) and the box fails its health probe \(.+\) — rolling back$/m);
    expect(lines(home, 'launcher-argv')).toEqual(['rollback --from watchdog']);
    expect(lines(home, 'launcher-lock')).toEqual(['free']);
    expect(lines(home, 'launcher-marker')).toEqual(['unset']);
    expect(readReport(home).phase).toBe('installing');
    expect(lockFree(home)).toBe(true);
    // /health answering the OLD version on a box whose stamp moved — the
    // half-replaced tree restart-looping on the previous server — fails the
    // same probe.
    const home2 = watchBox('ccrc-watchdog-revert-oldhealth-');
    report(home2, { phase: 'restarting', ageS: 90 });
    writeFileSync(join(home2, 'fixture-health-pin'), 'v1.0.0\n');
    expect(runWatchdog(home2).code).toBe(0);
    expect(lines(home2, 'launcher-argv')).toEqual(['rollback --from watchdog']);
  });

  // RE-REVIEW regression (D-3285, one clause added): every OTHER test in
  // Fix round 1 item 8 / review 155 C14, REPLACING the re-review's own
  // outcome: a watchdog that MEASURED FAILURE never writes a success word.
  // The scenario is unchanged (previous names the box's own RUNNING,
  // COMPLETED tag — a bare `rollback --from watchdog` would converge on
  // nothing), but the re-review's fix — closing the report as `done` once
  // `cmd_rollback`'s own convergence path ran — is now ITSELF the C14
  // defect: it claims success on a box this run just measured UNHEALTHY.
  // `cmd_watchdog`'s own read-only pre-check (the same shape D-3285's
  // `cmd_rollback` pre-check and this function's own passing-probe arm
  // both use) now catches this BEFORE ever invoking `ccrc rollback` — so
  // the REAL binary substitution the re-review's test needed is no longer
  // reached, kept anyway as a control: were the pre-check ever bypassed,
  // this box's real `cmd_rollback` would converge exactly as before,
  // proving the pre-check's read matches what the real path would do.
  itLinux('a stale report on a box whose `previous` already names its own RUNNING, COMPLETED tag: `failed`, nothing to revert to — not `done` (fix round 1 item 8 / review 155 C14)', () => {
    const home = watchBox('ccrc-watchdog-revert-converged-');
    // The REAL binary, not the stub LAUNCHER — the control described above.
    cpSync(join(REPO, 'ccd', 'ccrc'), join(home, '.local', 'bin', 'ccrc'));
    chmodSync(join(home, '.local', 'bin', 'ccrc'), 0o755);
    // previous == the box's own running tag (v2.0.0, watchBox's default) —
    // the scenario needs: a bare `rollback --from watchdog` (no --to)
    // resolves `to` from here, and it names what this box is ALREADY on.
    writeFileSync(join(home, '.ccrc', 'previous'), 'v2.0.0\noldsha0000000000000000000000000000000000\n');
    // Published, its build.json sha matching the box's own stamp — the
    // shape `_upd_converged` needs to answer yes, were it reached for real.
    // `packRelease` derives `<home>/releases/…` itself — the same
    // `CCRC_RELEASE_BASE_URL` shape `runUpdate`'s own default uses.
    packRelease(home, selfConvergedTree(home, 'v2.0.0', 'oldsha0000000000000000000000000000000000'),
      { tag: 'v2.0.0', latest: false });
    report(home, { phase: 'checking', ageS: 90 });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    const releaseUrl = `local://${home}/releases`;
    const r = runWatchdog(home, [], { CCRC_RELEASE_BASE_URL: releaseUrl });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // Never reaches "— rolling back": the pre-check returns first.
    expect(r.stdout).not.toMatch(/rolling back/);
    expect(r.stdout).toMatch(/^watchdog: stale report \(checking, 9\ds\) fails its health probe \(.+\), but ~\/\.ccrc\/previous already names v2\.0\.0, the release this box is already converged on — recorded as abandoned; nothing was reverted$/m);
    const rep1 = readReport(home);
    expect(rep1['phase'], `stdout: ${r.stdout}`).toBe('failed');
    expect(rep1['detail']).toMatch(/^abandoned by its updater; nothing to revert to; box unhealthy: .+$/);
    expect(lockFree(home)).toBe(true);
    // Second tick: the report is now TERMINAL (`failed`), so the watchdog
    // takes the NOT_IN_FLIGHT "nothing to do" branch — it must not probe,
    // must not touch the lock, must not run rollback again.
    const before = readFileSync(jsonPath(home), 'utf8');
    const r2 = runWatchdog(home, [], { CCRC_RELEASE_BASE_URL: releaseUrl });
    expect(r2.code, `stderr: ${r2.stderr}`).toBe(0);
    expect(r2.stdout).toBe('watchdog: last update failed — nothing to do\n');
    expect(readFileSync(jsonPath(home), 'utf8')).toBe(before);
  });

  // Review fix round 1, M6 considered and NOT applied as literally worded
  // (see `ccd/ccrc`'s own comment at item 8's check, and the report's
  // Concerns): widening to "target is the running tag" ALONE, dropping the
  // completed-record requirement, was measured to make item 8 wrongly
  // intercept a box whose tree is mid-spine-kill (the record cleared by the
  // dying run itself, stamp not yet moved) — exactly the shape this file's
  // own REAL-kill test (design §16, Review Focus 5) needs reverted, not
  // abandoned. This is the CONTROL for that decision: `previous` names the
  // running tag, but the completed-install record is ABSENT (an incomplete
  // install, indistinguishable here from "a run just like the real-kill
  // test died leaving this exact shape") — item 8 must NOT intercept, and
  // a real revert attempt must still run.
  itLinux('previous names the running tag with an INCOMPLETE record: NOT "nothing to revert to" — a real revert attempt still runs (review fix round 1 M6, considered and not applied)', () => {
    const home = watchBox('ccrc-watchdog-revert-incomplete-');
    rmSync(join(home, '.ccrc', 'installed'), { force: true });
    writeFileSync(join(home, '.ccrc', 'previous'), 'v2.0.0\noldsha0000000000000000000000000000000000\n');
    report(home, { phase: 'checking', ageS: 90 });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    const r = runWatchdog(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/— rolling back$/m);
    expect(lines(home, 'launcher-argv')).toEqual(['rollback --from watchdog']);
  });

  itLinux('a refused rollback is relayed; when it wrote nothing it is recorded, verdict first — when it wrote its own report, that report stands', () => {
    const home = watchBox('ccrc-watchdog-refused-');
    const was = report(home, { phase: 'installing', ageS: 90 });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    writeFileSync(join(home, 'fixture-rollback-exit'), '1\n');
    let r = runWatchdog(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^watchdog: ccrc rollback --from watchdog exited 1$/m);
    const now = readReport(home);
    expect(now.phase).toBe('failed');
    expect(String(now.detail)).toMatch(/^watchdog: rollback refused \(exit 1\); box unhealthy: ./);
    expect(now.startedAt).toBe(was.startedAt);
    expect(now.pid).toBe(was.pid);
    const home2 = watchBox('ccrc-watchdog-refused-own-');
    report(home2, { phase: 'installing', ageS: 90 });
    writeFileSync(join(home2, 'fixture-unit-state'), 'failed\n');
    writeFileSync(join(home2, 'fixture-rollback-exit'), '1\n');
    const own = `${JSON.stringify({ target: 'v1.0.0', phase: 'failed', startedAt: nowS(), updatedAt: nowS(),
      detail: 'rollback: nothing to roll back to', from: 'watchdog', pid: 777 })}\n`;
    writeFileSync(join(home2, 'fixture-rollback-report'), own);
    r = runWatchdog(home2);
    expect(r.code).toBe(1);
    expect(readFileSync(jsonPath(home2), 'utf8')).toBe(own);
  });

  // Review fix round 1, M1: the THIRD read (the refused-rollback re-lock's
  // own `after="$(jq …)"`) had no guard — a FIFO there would block this
  // tick for the unit's whole TimeoutStartSec. The launcher swaps
  // update.json for a FIFO right before it exits refused, so the watchdog's
  // re-lock-and-re-read meets it. Bounded (`runBounded`, GNU `timeout -k`):
  // a regression here is a hang, not an assertion failure.
  it.skipIf(process.platform !== 'linux' || UPD_DEADLINE_BIN === null)(
    'M1: a FIFO at update.json during the refused-rollback re-lock (the THIRD read) is refused too, never blocking the tick (review fix round 1 M1)', () => {
      const home = watchBox('ccrc-watchdog-m1-third-read-fifo-');
      report(home, { phase: 'installing', ageS: 90 });
      writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
      writeFileSync(join(home, 'fixture-rollback-exit'), '1\n');
      writeFileSync(join(home, 'fixture-rollback-fifo-swap'), '');
      mkdirSync(join(home, 'tmp'), { recursive: true });
      const env: NodeJS.ProcessEnv = {
        ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_UPDATE_DEADLINE_MS: DEADLINE_MS,
        CCRC_WATCHDOG_PROBE_GAP_S: '0',
      };
      replantDoctorStubs(home);
      const r = runBounded([BASH, join(REPO, 'ccd', 'ccrc'), 'watchdog'], env, 5000);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stdout).toMatch(/^watchdog: ccrc rollback --from watchdog exited 1$/m);
      // A FIFO now sits at the path — no readable regular report to assert.
    }, 15000);

  // Fix round 1 item 18 / review 155 C29: a killed watchdog rollback must
  // not be retried with no bound. Two ticks, one launcher that RECORDS ITS
  // OWN ARGV AND DIES (review C29's own measured shape): tick 0's report is
  // NOT yet `from: watchdog`, so the watchdog invokes `ccrc rollback --from
  // watchdog` for the first (and only allowed) time; the launcher simulates
  // being killed mid-flight — it leaves its OWN stale, in-flight report,
  // `from: watchdog`, and exits non-zero. Tick 1 must see that report, MUST
  // NOT invoke the launcher again (one line in launcher-argv, not two), and
  // must record `failed` — not retry.
  itLinux('a stale in-flight report whose `from` is already `watchdog` is never rolled back again — exactly one revert attempt across two ticks (fix round 1 item 18 / review 155 C29)', () => {
    const home = watchBox('ccrc-watchdog-killed-retry-');
    // ageS DIFFERS from the died report's own `updatedAt` below (120s vs
    // 90s) so the post-refusal "did the report move?" guard
    // (`$after != $upd`) reads a real change and never overwrites what the
    // launcher itself wrote.
    report(home, { phase: 'installing', ageS: 120, from: 'pwa' });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    writeFileSync(join(home, 'fixture-rollback-exit'), '137\n');
    // The DYING launcher's own report: in-flight, `from: watchdog`, and
    // already STALE (updatedAt 90s in the past) — no real sleep needed, the
    // fixture controls the clock directly, exactly as `report()` does.
    const died = `${JSON.stringify({ target: 'v1.0.0', phase: 'installing', startedAt: nowS() - 135,
      updatedAt: nowS() - 90, detail: null, from: 'watchdog', pid: 5150 })}\n`;
    writeFileSync(join(home, 'fixture-rollback-report'), died);

    let r = runWatchdog(home);
    expect(r.code, `tick 0 — stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(137);
    expect(r.stdout).toMatch(/^watchdog: stale report \(installing, 1[12]\ds\) and the box fails its health probe \(.+\) — rolling back$/m);
    expect(r.stdout).toMatch(/^watchdog: ccrc rollback --from watchdog exited 137$/m);
    expect(readFileSync(jsonPath(home), 'utf8')).toBe(died);
    expect(lines(home, 'launcher-argv')).toEqual(['rollback --from watchdog']);

    r = runWatchdog(home);
    expect(r.code, `tick 1 — stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/rolling back/);
    // Review fix round 1 I4: this check now runs AFTER the re-measurement,
    // so the stdout line names the probe's own failure too. The age is
    // real elapsed wall-clock time since the "died" fixture's fixed
    // `updatedAt` (nowS() - 90), so a wildcard, not an exact 90s, tolerates
    // however long tick 0 itself took to run.
    expect(r.stdout).toMatch(
      /^watchdog: stale report \(installing, \d+s\), from watchdog, fails its health probe \(.+\) — a PRIOR watchdog rollback died mid-flight; not retrying, recorded as failed\n$/);
    // NOT invoked a second time.
    expect(lines(home, 'launcher-argv')).toEqual(['rollback --from watchdog']);
    const rep = readReport(home);
    expect(rep.phase).toBe('failed');
    expect(String(rep.detail)).toMatch(/^the watchdog's own rollback died; not retrying; box unhealthy: .+$/);
  });

  itLinux('a LIVE holder of ~/.ccrc/update.lock is never acted on — exit 0 and the sentence, nothing probed, the report byte-identical (§18 "the watchdog reverts a dead updater": the lock check)', async () => {
    const home = watchBox('ccrc-watchdog-live-');
    report(home, { phase: 'installing', ageS: 90, pid: 4321 });
    // The probe WOULD fail: only the lock stands between this box and a rollback.
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    const before = readFileSync(jsonPath(home), 'utf8');
    const holder = await holdLock(home);
    try {
      const r = runWatchdog(home);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/^watchdog: updater pid 4321 holds ~\/\.ccrc\/update\.lock — its report is 9\ds old; not acting while it lives$/m);
      expect(readFileSync(jsonPath(home), 'utf8')).toBe(before);
      expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
      expect(probed(home)).toBe(false);
    } finally { release(holder); }
  });

  itLinux('a holder whose report has not advanced in twice the deadline is recorded WEDGED — its pid, the instant it last reported — and nothing is reverted (§18 "the watchdog bounds a wedged holder")', async () => {
    const home = watchBox('ccrc-watchdog-wedged-');
    const was = report(home, { phase: 'installing', ageS: 200, pid: 4321, from: 'cli' });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    const holder = await holdLock(home);
    try {
      const r = runWatchdog(home);
      expect(r.code, r.stderr).toBe(0);
      const now = readReport(home);
      expect(now.phase).toBe('failed');
      expect(now.detail).toBe(`watchdog: updater pid 4321 wedged holding ~/.ccrc/update.lock since ${String(was.updatedAt)}`);
      expect(now.pid).toBe(4321);
      expect(now.from).toBe('cli');
      expect(now.target).toBe('v2.0.0');
      expect(r.stdout).toMatch(/recorded as wedged; nothing was reverted$/m);
      expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
      // The verdict is terminal: the next tick leaves it alone.
      expect(runWatchdog(home).stdout).toBe('watchdog: last update failed — nothing to do\n');
    } finally { release(holder); }
  });

  // Fix round 1 item 23-C7 / review 155 C7: nothing tested WHERE the wedged
  // threshold sits — the shipped cases use only a 90s report (well under
  // 2x the 60s deadline) and a 200s one (well past it), so any multiplier
  // between them (e.g. 3x instead of spec §11's 2x) would still pass. This
  // one sits strictly between 2x (120s) and 3x (180s) — 150s — and must be
  // WEDGED; a `2 * lim` -> `3 * lim` mutation reds this case alone.
  itLinux('a holder whose report is 150s old (strictly between 2x and 3x a 60s deadline) is ALSO recorded WEDGED — the multiplier is 2, not 3 (fix round 1 item 23-C7 / review 155 C7)', async () => {
    const home = watchBox('ccrc-watchdog-wedged-150-');
    const was = report(home, { phase: 'installing', ageS: 150, pid: 4321, from: 'cli' });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    const holder = await holdLock(home);
    try {
      const r = runWatchdog(home);
      expect(r.code, r.stderr).toBe(0);
      const now = readReport(home);
      expect(now.phase).toBe('failed');
      expect(now.detail).toBe(`watchdog: updater pid 4321 wedged holding ~/.ccrc/update.lock since ${String(was.updatedAt)}`);
      expect(r.stdout).toMatch(/recorded as wedged; nothing was reverted$/m);
    } finally { release(holder); }
  });

  // Review fix round 1, M7 then M4: the 119s/121s pair bound the threshold
  // EXACTLY at 2x a 60s deadline, but item 0(b) asked for margins that
  // "survive a slow spawn" and a 1-second tolerance (`1(19|20)s`) does not —
  // `cmd_watchdog` reads its own `date +%s` only after `holdLock` (async,
  // polling) and this script's own bash startup, so a couple of seconds of
  // real spawn stall (measured: a 2s injected lag turns a 119s report into
  // 121s, crossing the 120s line) still reds the not-wedged half. Widened to
  // the brief's own example margins — 105s (well under 120) and 135s (well
  // over) — with the VERDICT and an AGE RANGE asserted, never an exact
  // second: the not-wedged range (100-119s) stays under the true 120s
  // threshold even with several seconds of stall, and the wedged range
  // (130-149s) stays over it the same way. Both mutation directions still
  // red on these two cases alone: `2 * lim` -> `3 * lim` (180s) would read
  // 135s as NOT wedged (135 < 180); `2 * lim` -> `1.5 * lim` (90s, as
  // `(lim * 3) / 2`, integer bash arithmetic) would read 105s as WEDGED
  // (105 > 90) — each flips exactly one of these two cases' verdict.
  itLinux('a holder\'s report well under 2x a 60s deadline (105s) is NOT wedged; well past it (135s) IS — margins survive a slow spawn (review fix round 1 M7, then M4)', async () => {
    const notWedgedHome = watchBox('ccrc-watchdog-wedged-105-');
    report(notWedgedHome, { phase: 'installing', ageS: 105, pid: 4321, from: 'cli' });
    writeFileSync(join(notWedgedHome, 'fixture-unit-state'), 'failed\n');
    const holder1 = await holdLock(notWedgedHome);
    try {
      const r = runWatchdog(notWedgedHome);
      expect(r.code, r.stderr).toBe(0);
      const m = /^watchdog: updater pid 4321 holds ~\/\.ccrc\/update\.lock — its report is (\d+)s old; not acting while it lives$/m
        .exec(r.stdout);
      expect(m, r.stdout).not.toBeNull();
      const age = Number(m![1]);
      expect(age, r.stdout).toBeGreaterThanOrEqual(100);
      expect(age, r.stdout).toBeLessThan(120);
    } finally { release(holder1); }

    const wedgedHome = watchBox('ccrc-watchdog-wedged-135-');
    const was = report(wedgedHome, { phase: 'installing', ageS: 135, pid: 4321, from: 'cli' });
    writeFileSync(join(wedgedHome, 'fixture-unit-state'), 'failed\n');
    const holder2 = await holdLock(wedgedHome);
    try {
      const r = runWatchdog(wedgedHome);
      expect(r.code, r.stderr).toBe(0);
      const now = readReport(wedgedHome);
      expect(now.phase).toBe('failed');
      expect(now.detail).toBe(`watchdog: updater pid 4321 wedged holding ~/.ccrc/update.lock since ${String(was.updatedAt)}`);
      const wm = /^watchdog: updater pid 4321 has held ~\/\.ccrc\/update\.lock with no report for (\d+)s, past twice the deadline — recorded as wedged; nothing was reverted$/m
        .exec(r.stdout);
      expect(wm, r.stdout).not.toBeNull();
      const age = Number(wm![1]);
      expect(age, r.stdout).toBeGreaterThanOrEqual(130);
      expect(age, r.stdout).toBeLessThan(150);
    } finally { release(holder2); }
  });

  itLinux('a lock that cannot be MEASURED is neither a live holder nor a free lock — exit 0 and the one sentence, nothing probed, nothing rewritten (ruling R16, D-3250)', () => {
    // Both of `_upd_lock_probe`'s rc-3 conditions (Task 2), on a report that
    // is past TWICE the deadline and a box whose probe would fail — so folding
    // rc 3 into "held" rewrites it as wedged, and folding it into "taken"
    // probes and rolls back. Only the rc-3 arm leaves both alone.
    const quiet = 'watchdog: the update lock could not be measured — not acting\n';
    // (1) The OPEN fails: a directory where the lock file belongs.
    const home = watchBox('ccrc-watchdog-lock-unopenable-');
    report(home, { phase: 'installing', ageS: 200 });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    mkdirSync(join(home, '.ccrc', 'update.lock'));
    const before = readFileSync(jsonPath(home), 'utf8');
    let r = runWatchdog(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(quiet);
    expect(readFileSync(jsonPath(home), 'utf8')).toBe(before);
    expect(probed(home)).toBe(false);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
    // (2) `flock -n` answers neither 0 (taken) nor contention's 1: a `flock`
    // on the fixture's PATH (its `~/.local/bin`, first) that fails the way a
    // bad descriptor does. `lockFree` uses the host's own flock, not this one.
    const home2 = watchBox('ccrc-watchdog-flock-unmeasured-');
    report(home2, { phase: 'installing', ageS: 200 });
    writeFileSync(join(home2, 'fixture-unit-state'), 'failed\n');
    writeFileSync(join(home2, '.local', 'bin', 'flock'),
      '#!/bin/sh\necho "flock: fixture: Bad file descriptor" >&2\nexit 64\n', { mode: 0o755 });
    const before2 = readFileSync(jsonPath(home2), 'utf8');
    r = runWatchdog(home2);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(quiet);
    expect(readFileSync(jsonPath(home2), 'utf8')).toBe(before2);
    expect(probed(home2)).toBe(false);
    expect(existsSync(join(home2, 'launcher-argv'))).toBe(false);
  });

  itLinux('the deadline is CCRC_UPDATE_DEADLINE_MS, else ccrc.env\'s, else fifteen minutes — a positive integer of ms, or it is not read', () => {
    const home = watchBox('ccrc-watchdog-deadline-');
    const inProgress = /^watchdog: update in progress \(installing, 9\ds old\)$/m;
    report(home, { phase: 'installing', ageS: 90 });
    // No environment, no key: fifteen minutes, so 90 s is in progress.
    let r = runWatchdog(home, [], { CCRC_UPDATE_DEADLINE_MS: undefined });
    expect(r.stdout).toMatch(inProgress);
    // Not a positive integer: read as absent — never as zero, which would make
    // every live update stale the instant it wrote.
    for (const bad of ['0', 'soon', '-5', '']) {
      r = runWatchdog(home, [], { CCRC_UPDATE_DEADLINE_MS: bad });
      expect(r.stdout, `CCRC_UPDATE_DEADLINE_MS='${bad}'`).toMatch(inProgress);
    }
    // The environment wins over the file…
    appendFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_UPDATE_DEADLINE_MS=60000\n');
    r = runWatchdog(home, [], { CCRC_UPDATE_DEADLINE_MS: '600000' });
    expect(r.stdout).toMatch(inProgress);
    // …and the file — the key W2's server reads — is read when it has none.
    r = runWatchdog(home, [], { CCRC_UPDATE_DEADLINE_MS: undefined });
    expect(r.code, r.stderr).toBe(0);
    expect(readReport(home).detail).toBe('abandoned by its updater; box measures converged at v2.0.0');
    // Past fifteen minutes is stale on the default.
    const home2 = watchBox('ccrc-watchdog-deadline-default-');
    report(home2, { phase: 'installing', ageS: 16 * 60 });
    expect(runWatchdog(home2, [], { CCRC_UPDATE_DEADLINE_MS: undefined }).code).toBe(0);
    expect(readReport(home2).phase).toBe('failed');
  });

  itLinux('a fleet node has nothing to watch; an unrecorded role is the spine\'s default, both; any argument is a usage error', () => {
    const fleet = watchBox('ccrc-watchdog-fleet-', { role: 'fleet' });
    report(fleet, { phase: 'installing', ageS: 3600 });
    writeFileSync(join(fleet, 'fixture-unit-state'), 'failed\n');
    let r = runWatchdog(fleet);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('watchdog: a fleet node is covered by the server\'s own deadline — nothing to watch here\n');
    expect(existsSync(join(fleet, 'launcher-argv'))).toBe(false);
    const bare = watchBox('ccrc-watchdog-norole-', { role: null });
    report(bare, { phase: 'installing', ageS: 90 });
    r = runWatchdog(bare);
    expect(r.code, r.stderr).toBe(0);
    expect(readReport(bare).detail).toBe('abandoned by its updater; box measures converged at v2.0.0');
    r = runWatchdog(bare, ['--now']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --now$/m);
  });

  itDarwin('macOS is not centrally managed: exit 0 and the sentence, whatever the report says (decision 17)', () => {
    const home = watchBox('ccrc-watchdog-darwin-');
    report(home, { phase: 'installing', ageS: 3600 });
    const r = runWatchdog(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('watchdog: macOS is not centrally managed (decision 17) — nothing to watch\n');
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
  });

  itLinux('D-3276: a stale report in a pre-install phase with a failing probe is never rolled back — its tree cannot have moved', () => {
    for (const phase of ['fetching', 'backing-up']) {
      const home = watchBox(`ccrc-watchdog-preinstall-fail-${phase}-`);
      report(home, { phase, ageS: 90 });
      writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
      const r = runWatchdog(home);
      expect(r.code, `${phase}: ${r.stderr}`).toBe(0);
      const now = readReport(home);
      expect(now.phase, phase).toBe('failed');
      expect(String(now.detail), phase)
        .toMatch(/^abandoned by its updater; tree never moved, nothing reverted; box unhealthy: .+$/);
      expect(r.stdout, phase)
        .toMatch(/^watchdog: stale report \([a-z-]+, 9\ds\) fails its health probe \(.+\), but its tree never moved — recorded as abandoned; nothing was reverted$/m);
      expect(existsSync(join(home, 'launcher-argv')), phase).toBe(false);
      expect(lockFree(home), phase).toBe(true);
    }
  });

  // W6 Task 8A, review 167's F8: a watchdog rollback killed in any of the five
  // pre-install phases leaves a pre-install report whose raw `from` is
  // `watchdog`. D-3276's sentence ("tree never moved, nothing reverted") is
  // true of an update that never began and FALSE here: the update the
  // rollback was correcting did move the box, and the box is unhealthy on it.
  // Its own sentence says that, is terminal like C29's, and never retries.
  itLinux('F8: a watchdog rollback killed in a pre-install phase (a report from watchdog) with a failing probe is recorded with its own true sentence — never "tree never moved" — and is not retried', () => {
    for (const phase of ['queued', 'resolving', 'fetching', 'verifying', 'backing-up']) {
      const home = watchBox(`ccrc-watchdog-killed-rollback-${phase}-`);
      report(home, { phase, ageS: 90, from: 'watchdog', target: 'v1.0.0' });
      writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
      const r = runWatchdog(home);
      expect(r.code, `${phase}: ${r.stderr}`).toBe(0);
      const now = readReport(home);
      expect(now.phase, phase).toBe('failed');
      expect(String(now.detail), phase).toMatch(new RegExp(
        `^the watchdog's own rollback died at ${phase} before it moved anything; the box still runs the build the failed update left; not retrying; box unhealthy: .+$`));
      expect(String(now.detail), phase).not.toContain('tree never moved');
      expect(r.stdout, phase).toMatch(new RegExp(
        `^watchdog: stale report \\(${phase}, \\d+s\\), from watchdog, fails its health probe \\(.+\\) — a PRIOR watchdog rollback died at ${phase} before it moved anything; the box still runs the build the update it was correcting left; not retrying, recorded as failed$`, 'm'));
      expect(r.stdout, phase).not.toContain('tree never moved');
      expect(existsSync(join(home, 'launcher-argv')), `${phase}: it rolled back again`).toBe(false);
      expect(lockFree(home), phase).toBe(true);
    }
  });

  itLinux('D-3276: a stale report on an UNVERSIONED running tree with a failing probe is never rolled back', () => {
    // A deploy.sh-placed (or never-stamped) box: no ~/.ccrc/build.json at
    // all, so `_box_build_fields` answers non-zero and `cur_v` stays "".
    const home = freshUpdateBox('ccrc-watchdog-unversioned-');
    plantOldBox(home);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n');
    writeFileSync(join(home, '.local', 'bin', 'ccrc'), LAUNCHER, { mode: 0o755 });
    report(home, { phase: 'installing', ageS: 90 });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    const r = runWatchdog(home);
    expect(r.code, r.stderr).toBe(0);
    const now = readReport(home);
    expect(now.phase).toBe('failed');
    expect(String(now.detail))
      .toMatch(/^abandoned by its updater; unversioned tree, not reverting; box unhealthy: .+$/);
    expect(r.stdout)
      .toMatch(/^watchdog: stale report \(installing, 9\ds\) fails its health probe \(.+\) on an unversioned tree — recorded as abandoned; not reverting$/m);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
    expect(lockFree(home)).toBe(true);
  });

  itLinux('D-3277: the report moving between the first read and the lock stands the watchdog down — nothing rewritten, nothing rolled back', () => {
    const home = watchBox('ccrc-watchdog-moved-');
    report(home, { phase: 'installing', ageS: 90 });
    // A box that WOULD be rolled back if the stand-down did not fire.
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    // A fresh, TERMINAL report — modelling an updater that finished and
    // exited in the exact window between the watchdog's first (pre-lock)
    // read and its own `flock -n`.
    const movedDoc = {
      target: 'v2.0.0', phase: 'done', startedAt: 1, updatedAt: 999999999,
      detail: null, from: 'cli', pid: 4321,
    };
    const movedStr = `${JSON.stringify(movedDoc)}\n`;
    writeFileSync(join(home, 'fixture-flock-moved-report'), movedStr);
    // A `flock` shim ahead of the real one on PATH (this fixture's own
    // `.local/bin`, first): it rewrites update.json, then defers to the
    // REAL binary so the watchdog's own lock-take still succeeds (lrc=0) —
    // the locking semantics stay real, only the write in between is fixture.
    writeFileSync(join(home, '.local', 'bin', 'flock'),
      `#!/bin/sh\ncp "$HOME/fixture-flock-moved-report" "$HOME/.ccrc/update.json"\nexec ${FLOCK} "$@"\n`,
      { mode: 0o755 });
    const r = runWatchdog(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('watchdog: the report moved while measuring — next tick\n');
    // The report is exactly what the SHIM wrote — the watchdog touched nothing.
    expect(readFileSync(jsonPath(home), 'utf8')).toBe(movedStr);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
    expect(healthProbed(home)).toBe(false);
    expect(probed(home)).toBe(false);
    expect(lockFree(home)).toBe(true);
  });

  // Review fix round 1, M2: the guard before D-3277's own re-read
  // (`_upd_report_readable || rrc2=$?`) shipped with no pin that reds when
  // it is deleted (measured: 27/27 green with it gone). Reusing THIS file's
  // own idiom immediately above — a `flock` shim ahead of the real one on
  // PATH, which mutates update.json then defers to the real binary, so the
  // watchdog's own lock-take still succeeds (lrc=0) and reaches the SECOND
  // read — except this shim swaps in a FIFO instead of a moved report.
  // Bounded (`runBounded`): a regression here is a hang, not merely a wrong
  // verdict.
  it.skipIf(process.platform !== 'linux' || UPD_DEADLINE_BIN === null)(
    'M2: a FIFO swapped in between the first read and D-3277\'s own second read is refused too, never blocking the tick (review fix round 1 M2)', () => {
      const home = watchBox('ccrc-watchdog-m2-second-read-fifo-');
      report(home, { phase: 'installing', ageS: 90 });
      writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
      writeFileSync(join(home, '.local', 'bin', 'flock'),
        `#!/bin/sh\nrm -f "$HOME/.ccrc/update.json"\nmkfifo "$HOME/.ccrc/update.json"\nexec ${FLOCK} "$@"\n`,
        { mode: 0o755 });
      mkdirSync(join(home, 'tmp'), { recursive: true });
      const env: NodeJS.ProcessEnv = {
        ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_UPDATE_DEADLINE_MS: DEADLINE_MS,
        CCRC_WATCHDOG_PROBE_GAP_S: '0',
      };
      replantDoctorStubs(home);
      // `replantDoctorStubs` copies from `doctor-stubs/`, which plants no
      // `flock` — the shim written above survives it. Re-planted here
      // anyway, AFTER, so this test never depends on that ordering fact
      // staying true.
      writeFileSync(join(home, '.local', 'bin', 'flock'),
        `#!/bin/sh\nrm -f "$HOME/.ccrc/update.json"\nmkfifo "$HOME/.ccrc/update.json"\nexec ${FLOCK} "$@"\n`,
        { mode: 0o755 });
      const r = runBounded([BASH, join(REPO, 'ccd', 'ccrc'), 'watchdog'], env, 5000);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toBe('watchdog: the report moved while measuring — next tick\n');
    }, 15000);

  itLinux('D-3278: the failing verdict needs three failing probe samples — one passing sample is a pass; all three failing rolls back with exactly 3 probes', () => {
    const healthCount = (home: string): number =>
      lines(home, 'curl-argv').filter((u) => u === 'http://127.0.0.1:7788/health').length;
    // Fails once, then passes: overall a PASS — no rollback, and the loop
    // stopped at 2 samples (it never spent a 3rd).
    const flip = watchBox('ccrc-watchdog-probe-flip-');
    report(flip, { phase: 'installing', ageS: 90 });
    writeFileSync(join(flip, 'fixture-health-fail-count'), '1\n');
    let r = runWatchdog(flip);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(flip, 'launcher-argv'))).toBe(false);
    expect(healthCount(flip)).toBe(2);
    // All three fail: rollback, and exactly 3 probes ran — never a 4th.
    const allFail = watchBox('ccrc-watchdog-probe-allfail-');
    report(allFail, { phase: 'installing', ageS: 90 });
    writeFileSync(join(allFail, 'fixture-health-fail-count'), '3\n');
    r = runWatchdog(allFail);
    expect(r.code, r.stderr).toBe(0);
    expect(lines(allFail, 'launcher-argv')).toEqual(['rollback --from watchdog']);
    expect(healthCount(allFail)).toBe(3);
  });

  itLinux('D-3278: the sampling gap is CCRC_WATCHDOG_PROBE_GAP_S — malformed reads as the five-second default (no die, no crash)', () => {
    const home = watchBox('ccrc-watchdog-probe-gap-malformed-');
    report(home, { phase: 'installing', ageS: 90 });
    writeFileSync(join(home, 'fixture-health-fail-count'), '1\n');
    const r = runWatchdog(home, [], { CCRC_WATCHDOG_PROBE_GAP_S: 'soon' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/^watchdog: CCRC_WATCHDOG_PROBE_GAP_S='soon' is not digits-only — using 5$/m);
    // The malformed value did not stop the sample from running — a flip
    // still reads as a pass.
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
  });

  itLinux('Minor F4: a refused rollback whose launcher leaves ~/.ccrc/update.lock HELD records nothing — the re-lock guard\'s "&&" half', () => {
    const home = watchBox('ccrc-watchdog-refused-heldlock-');
    const was = report(home, { phase: 'installing', ageS: 90 });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    writeFileSync(join(home, 'fixture-rollback-exit'), '1\n');
    writeFileSync(join(home, 'fixture-rollback-leaves-holder'), '');
    const r = runWatchdog(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^watchdog: ccrc rollback --from watchdog exited 1$/m);
    // The re-lock is CONTENDED (the launcher's own holder), so nothing is
    // recorded: the stale report the rollback was called on stands untouched.
    expect(readReport(home)).toEqual(was);
  }, 10_000);

  itLinux('Minor F5: jq missing is refused by name, exit 1, nothing measured', () => {
    const home = watchBox('ccrc-watchdog-nojq-');
    report(home, { phase: 'installing', ageS: 90 });
    const r = runWatchdog(home, [], { PATH: pathWithoutJq(home) });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: watchdog: jq is not on PATH, so ~\/\.ccrc\/update\.json cannot be read — nothing was re-measured or reverted$/m);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
  });

  itLinux('Minor F5: flock missing is refused by name, exit 1, nothing measured', () => {
    const home = watchBox('ccrc-watchdog-noflock-');
    report(home, { phase: 'installing', ageS: 90 });
    const r = runWatchdog(home, [], { PATH: pathWithoutFlock(home) });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: watchdog: flock \(util-linux\) is not on PATH, so a live updater cannot be told from a dead one — nothing was re-measured or reverted$/m);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
  });

  itLinux('Minor F5: date not answering unix seconds is refused by name, exit 1, nothing measured', () => {
    const home = watchBox('ccrc-watchdog-baddate-');
    report(home, { phase: 'installing', ageS: 90 });
    writeFileSync(join(home, '.local', 'bin', 'date'), '#!/bin/sh\necho not-a-number\n', { mode: 0o755 });
    const r = runWatchdog(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: watchdog: date \+%s did not answer with unix seconds — nothing was re-measured or reverted$/m);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
  });

  itLinux('a REAL update killed mid-install: the watchdog reads the real writer\'s report in its own unit, leaves it while fresh, and reverts it once stale on a box that fails its probe (design §16, Review Focus 5)', async () => {
    const home = watchBox('ccrc-watchdog-killed-', { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    writeFileSync(join(home, 'fixture-install-hang'), '');
    mkdirSync(join(home, 'tmp'), { recursive: true });
    const env = {
      ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_RELEASE_BASE_URL: `local://${home}/releases`,
    };
    replantDoctorStubs(home);
    // Its own process group, so one kill takes the update AND its hung spine —
    // the OOM that ends a detached run mid-install.
    const child = spawn(BASH, [join(REPO, 'ccd', 'ccrc'), 'update', '--to', 'v2.0.0'],
      { env, detached: true, stdio: 'ignore' });
    let phase = '';
    try {
      const until = Date.now() + 15_000;
      while (Date.now() < until) {
        try { phase = String(readReport(home).phase); } catch { phase = ''; }
        if (phase === 'installing' && existsSync(join(home, 'staged-ccrc-argv'))) break;
        await new Promise((res) => setTimeout(res, 50));
      }
    } finally {
      release(child.pid!);
    }
    expect(phase, 'the update never reached its staged install').toBe('installing');
    const until = Date.now() + 5000;
    while (!lockFree(home) && Date.now() < until) await new Promise((res) => setTimeout(res, 20));
    expect(lockFree(home), 'the lock outlived the killed updater').toBe(true);
    const left = readReport(home);
    expect(left.phase).toBe('installing');
    expect(left.pid).toBe(child.pid);
    // FRESH on the default deadline. The writer's instant and the watchdog's
    // clock are one unit — seconds — or this reads as decades stale (a
    // seconds writer against a ms clock) or as from the future (the reverse).
    let r = runWatchdog(home, [], { CCRC_UPDATE_DEADLINE_MS: undefined });
    expect(r.stdout).toMatch(/^watchdog: update in progress \(installing, [0-9]{1,2}s old\)$/m);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
    // STALE (a 1 ms deadline — 0 s once divided, so the report must be at
    // least one whole second old), no holder, and the half-replaced server
    // will not stay up: the one case the watchdog reverts.
    while (nowS() <= (left.updatedAt as number)) await new Promise((res) => setTimeout(res, 50));
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    r = runWatchdog(home, [], { CCRC_UPDATE_DEADLINE_MS: '1' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(lines(home, 'launcher-argv')).toEqual(['rollback --from watchdog']);
    expect(lines(home, 'launcher-lock')).toEqual(['free']);
  }, 60_000);
});

describe('ccrc update: the migration keeps the old tree until the gate (W6 Task 3)', () => {
  // On a pre-W6 box the W6 staged spine migrates `~/ccrc` (Task 3's install
  // half), but it runs under THIS run's `~/.ccrc/update.lock`, so its doctor
  // is not the gate and it keeps `~/ccrc.migrating`; `cmd_update` removes it
  // only once `_upd_gate` has passed. A crash pair left by an earlier run is
  // completed before anything else this verb does.
  const OLD_SHA = 'oldsha0000000000000000000000000000000000';
  const NEW_SHA = 'newsha0000000000000000000000000000000000';
  const REAL_LN = realPath('ln');
  const migrating = (home: string): string => join(home, 'ccrc.migrating');
  const resumed = (name: string): string =>
    `update: tree: completed a crashed migration — $HOME/ccrc was absent beside $HOME/ccrc.migrating; linked to $HOME/ccrc-versions/${name} (named by ~/.ccrc/migrating-to)`;
  const REMOVED = 'update: migration: $HOME/ccrc.migrating removed — the health gate passed';
  /** The FULL flavour over plantOldBox's REAL ~/ccrc — the migration fixture
   *  as it stands. */
  const fullBox = (prefix: string): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: NEW_SHA }), { tag: 'v2.0.0' });
    return home;
  };
  /** A crash pair an earlier run left: the pre-versioned tree aside, a
   *  complete v1.0.0 placed, the marker naming it, and no ~/ccrc at all. */
  const crashedPair = (home: string): void => {
    mkdirSync(join(migrating(home), 'server'), { recursive: true });
    writeFileSync(join(migrating(home), 'server', 'OLD-MARKER'), 'the pre-versioned tree\n');
    installVersionedTree(home, 'v1.0.0', { link: false, stamp: { sha: OLD_SHA, version: 'v1.0.0' } });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'migrating-to'), 'v1.0.0\n');
    writeFileSync(join(home, '.ccrc', 'build.json'),
      `{"sha":"${OLD_SHA}","ref":"main","builtAt":"2026-08-20T00:00:00Z","dirty":false,"version":"v1.0.0"}\n`);
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
  };
  const at = (stdout: string, pred: (l: string) => boolean): number => stdout.split('\n').findIndex(pred);

  it('a pre-W6 box migrates inside the staged spine, which KEEPS ~/ccrc.migrating (this run holds the lock); cmd_update removes it only after _upd_gate passes (§18 "the migration keeps the old tree until the gate")', () => {
    const home = fullBox('ccrc-update-migrate-');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
    const linked = at(r.stdout, (l) => l === 'install: tree: $HOME/ccrc -> $HOME/ccrc-versions/v2.0.0 (the pre-versioned tree is kept at $HOME/ccrc.migrating until a health gate passes)');
    const kept = at(r.stdout, (l) => l === 'install: migration: $HOME/ccrc.migrating kept — an update holds ~/.ccrc/update.lock, and its health gate decides');
    const gate = at(r.stdout, (l) => l.startsWith('update: gate: both answers on v2.0.0 '));
    const removed = at(r.stdout, (l) => l === REMOVED);
    expect(linked, r.stdout).toBeGreaterThan(-1);
    expect(kept, 'the staged spine took its own doctor as the gate').toBeGreaterThan(linked);
    expect(gate).toBeGreaterThan(kept);
    expect(removed, 'the old tree went before the gate, or never').toBeGreaterThan(gate);
    expect(existsSync(migrating(home))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'migrating-to'))).toBe(false);
  });

  it('a FAILED gate never removes ~/ccrc.migrating: the run exits 4, and the pre-versioned tree and its marker are still there, byte for byte', () => {
    const home = fullBox('ccrc-update-migrate-gate-fail-');
    const before = treeDigest(join(home, 'ccrc'));
    writeFileSync(join(home, 'fixture-health-pin'), 'v1.0.0\n');   // /health keeps answering the OLD build
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink()).toBe(true);
    expect(treeDigest(migrating(home))).toEqual(before);
    expect(readFileSync(join(home, '.ccrc', 'migrating-to'), 'utf8')).toBe('v2.0.0\n');
    expect(r.stdout.split('\n')).not.toContain(REMOVED);
  });

  it('--no-gate measured nothing, so ~/ccrc.migrating is kept and the run says why', () => {
    const home = fullBox('ccrc-update-migrate-nogate-');
    const r = runUpdate(home, ['--no-gate']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const skipped = at(r.stdout, (l) => l.startsWith('update: gate: skipped (--no-gate)'));
    const kept = at(r.stdout, (l) => l === 'update: migration: $HOME/ccrc.migrating kept — --no-gate measured nothing');
    expect(skipped, r.stdout).toBeGreaterThan(-1);
    expect(kept).toBeGreaterThan(skipped);
    expect(lstatSync(migrating(home)).isDirectory()).toBe(true);
  });

  it('a crash pair is completed FIRST by ccrc update — before its backup, its install and its gate — and its old tree goes only after the gate passes (§18 "a crashed migration is completed first")', () => {
    const home = freshUpdateBox('ccrc-update-migrate-resume-');
    crashedPair(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const resume = at(r.stdout, (l) => l === resumed('v1.0.0'));
    const backup = at(r.stdout, (l) => l.startsWith('update: backup: '));
    const installing = at(r.stdout, (l) => l.startsWith('update: installing v2.0.0'));
    const gate = at(r.stdout, (l) => l.startsWith('update: gate: '));
    const removed = at(r.stdout, (l) => l === REMOVED);
    expect(resume, r.stdout).toBeGreaterThan(-1);
    expect(backup, 'something ran before the link was completed').toBeGreaterThan(resume);
    expect(installing).toBeGreaterThan(backup);
    expect(gate).toBeGreaterThan(installing);
    expect(removed).toBeGreaterThan(gate);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink()).toBe(true);
    expect(existsSync(migrating(home))).toBe(false);
  });

  it('--check on a crashed box says so after its machine line and repairs NOTHING — no link, no marker change', () => {
    const home = freshUpdateBox('ccrc-update-migrate-check-');
    crashedPair(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    // runUpdate's own environment build, once, before the snapshot — the
    // `--check writes nothing` case's idiom, for the same reason.
    updateEnv(home);
    replantDoctorStubs(home);
    const before = homeSnapshot(home);
    const r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    const lines = r.stdout.split('\n');
    expect(lines[0]).toMatch(/^check: box=v1\.0\.0 /);
    // The remedy names a command that can run: the ccrc on PATH is the shim,
    // which execs the missing $HOME/ccrc/ccd/ccrc (crashedPair's marker names
    // the placed v1.0.0).
    expect(lines).toContain('this box\'s migration crashed ($HOME/ccrc is absent beside $HOME/ccrc.migrating) — '
      + 'run bash $HOME/ccrc-versions/v1.0.0/ccd/ccrc install (or bash install.sh from a ccrc checkout) to complete it '
      + '— the ccrc on PATH cannot run until then, and deploy.sh would place a second tree beside it');
    expect(homeSnapshot(home)).toEqual(before);
  });

  /** ONE `ln` ahead of the harness's PATH with two knobs, each disarmed on
   *  first use and each biting only an `ln` whose last argument is ~/ccrc —
   *  the staged spine's migration link. `fail` refuses it (exit 1); `kill`
   *  SIGKILLs the shell that ran it, i.e. the staged spine itself, so the
   *  parent's `inst_rc` reads 137 with the crash pair left behind. */
  const armLn = (home: string, knob: 'fixture-ln-fail-once' | 'fixture-ln-kill-once'): NodeJS.ProcessEnv => {
    mkdirSync(join(home, 'fail-bin'), { recursive: true });
    writeFileSync(join(home, 'fail-bin', 'ln'), '#!/bin/sh\n'
      + 'for last in "$@"; do :; done\n'
      + 'if [ "$last" = "$HOME/ccrc" ] && [ -f "$HOME/fixture-ln-fail-once" ]; then\n'
      + '  rm -f "$HOME/fixture-ln-fail-once"; echo "ln: fixture refusal" >&2; exit 1\n'
      + 'fi\n'
      + 'if [ "$last" = "$HOME/ccrc" ] && [ -f "$HOME/fixture-ln-kill-once" ]; then\n'
      + '  rm -f "$HOME/fixture-ln-kill-once"; kill -KILL "$PPID"; exit 1\n'
      + 'fi\n'
      + `exec ${REAL_LN} "$@"\n`, { mode: 0o755 });
    writeFileSync(join(home, knob), 'yes\n');
    return { PATH: `${join(home, 'fail-bin')}:${updateEnv(home)['PATH'] ?? ''}` };
  };

  it('a staged spine whose link cannot be placed moves ~/ccrc BACK before it dies, whichever updater is the parent — a W6 parent reads that as untouched and exits 1 with no gate or restore (D-3458); a wave-4 parent would gate and restore it instead (D-3436)', () => {
    const home = fullBox('ccrc-update-migrate-spine-ln-fail-');
    const r = runUpdate(home, [], armLn(home, 'fixture-ln-fail-once'));
    expect(existsSync(join(home, 'fixture-ln-fail-once')), 'the refusal never fired').toBe(false);
    expect(r.stderr).toContain('ccrc: $HOME/ccrc could not be linked to $HOME/ccrc-versions/v2.0.0, so it was moved back — nothing moved');
    // The move-back (D-3436) itself runs in the staged spine — W6's own
    // code — whichever updater drives this run, so no resume line is ever
    // printed either way: the layout reads `directory`, never `crashed`.
    expect(at(r.stdout, (l) => l === resumed('v2.0.0'))).toBe(-1);
    // What DOES depend on the parent is what happens next. This harness's
    // parent is always the CURRENT tree's own ccrc — a W6 parent — whose
    // `_upd_tree_untouched` carries the `directory` row (D-3458): the move
    // back left ~/ccrc exactly as it was, the same real directory byte for
    // byte, so THIS run reads NOTHING REPLACED — exit 1, never gated, never
    // restored. A wave-4 parent has no such row: it would read the death as
    // moved (its `_upd_step_moved` default) and gate, then restore, this
    // exact on-disk shape — the defect D-3436 describes. This harness
    // cannot drive that parent to prove it (`runUpdate` always runs the
    // current tree's ccrc as the outer process); D-3458's plan entry
    // records the distinction instead.
    expect(r.stderr).toContain('nothing was replaced ($HOME/ccrc is still the pre-versioned directory; '
      + 'the migration did not leave it moved)');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout, 'a death that replaced nothing was gated').not.toMatch(/^update: gate/m);
    expect(r.stdout, 'a death that replaced nothing was restored').not.toMatch(/^update: (arm|REVERTED)/m);
    const st = lstatSync(join(home, 'ccrc'));
    expect(!st.isSymbolicLink() && st.isDirectory(), 'the tree was not moved back to a real ~/ccrc').toBe(true);
    expect(existsSync(migrating(home))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'migrating-to'))).toBe(false);
    expect(existsSync(join(home, 'ccrc-versions', 'v2.0.0', 'ccd', 'ccrc'))).toBe(true);
  });

  it('a staged spine KILLED inside the window is completed by cmd_update itself, before its gate and its restore arms — so arm 3 writes through the link and never recreates a real ~/ccrc beside ~/ccrc.migrating (D-3433)', () => {
    const home = fullBox('ccrc-update-migrate-spine-window-');
    const r = runUpdate(home, [], armLn(home, 'fixture-ln-kill-once'));
    expect(existsSync(join(home, 'fixture-ln-kill-once')), 'the kill never fired').toBe(false);
    const resume = at(r.stdout, (l) => l === resumed('v2.0.0'));
    const gate = at(r.stdout, (l) => l.startsWith('update: gate'));
    expect(resume, r.stdout).toBeGreaterThan(-1);
    expect(gate, 'the gate ran before the link was completed').toBeGreaterThan(resume);
    // The tree died at or after _inst_tree and its stamp never moved, so the
    // gate fails honestly and the box restores (exit 4) — through the LINK.
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink(), 'a restore arm recreated a real ~/ccrc').toBe(true);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
    expect(lstatSync(migrating(home)).isDirectory()).toBe(true);
  });

  itLinux('--detach on a crash pair completes the link BEFORE it queues, because the run it hands off execs the launcher shim, which cannot start with no ~/ccrc (D-3437)', () => {
    const home = freshUpdateBox('ccrc-update-migrate-detach-');
    crashedPair(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const resume = at(r.stdout, (l) => l === resumed('v1.0.0'));
    const detached = at(r.stdout, (l) => l.startsWith('update: detached — \'update --to v2.0.0\''));
    expect(resume, r.stdout).toBeGreaterThan(-1);
    expect(detached, 'the run was handed off before the link was completed').toBeGreaterThan(resume);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
    // wave 4 Task 3's recorder: exactly the spec argv, handed to a box whose
    // launcher can now run.
    expect(readFileSync(join(home, 'systemd-run-argv'), 'utf8').split('\n').filter((l) => l !== '')).toEqual([
      '--user --collect --quiet /bin/sh -c PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@" '
      + 'ccrc-detach update --to v2.0.0 --from cli',
    ]);
  });
});

// ── W6 Task 4: kept versions, the flip back, and an older spine's directory ─
// Arm 1 and a rollback by flip act on a VERSIONED box: `~/ccrc` a link into
// `~/ccrc-versions/<tag>`, with the tag it returns to kept complete beside it.
// Two ways to plant one, deliberately. FULL (`onKeptV1`): a real first
// `ccrc update` onto v1.0.0, so the kept version is one THIS code placed and
// kept, and the spine a flip back runs is the real one. STUB: Task 2's
// `installVersionedTree`, with the kept version's own `ccd/ccrc` swapped for
// `KEPT_SPINE` — the flip's mechanics (argv, the verified flag, the lock
// descriptor) measured without re-running the spine `ccrc-install.test.ts`
// owns.
const V1_SHA = '1'.repeat(40);
const V2_SHA = '2'.repeat(40);
/** A line no release ships, appended to the KEPT v1.0.0's `ccd/ccd`: a
 *  `~/.local/bin/ccd` carrying it can only have come from that version's own
 *  spine — v2.0.0's spine and both restore arms place a release's ccd. */
const CCD_SENTINEL = "# fixture: v1.0.0's own ccd, as this box kept it\n";

/** A kept version's own `ccd/ccrc`, standing in for its spine. Records its
 *  argv; whether it was told the version is verified; whether it was handed
 *  the lock marker; and whether it holds a descriptor on
 *  `~/.ccrc/update.lock` — read off `/proc` on Linux, `unmeasured` elsewhere.
 *  Exits `fixture-kept-spine-exit` (default 0). On 0 it writes the
 *  completed-install record as `_inst_installed` would (the kept record, byte
 *  for byte) and loads the two main launchd jobs as `_inst_enable_darwin`
 *  would, so a Darwin gate has a job to sample. It stamps NOTHING — the shape
 *  of a spine older than W6, which cannot stamp from the kept copy. */
const KEPT_SPINE = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$0" "$@" > "$HOME/kept-spine-argv"',
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

const fileText = (p: string): string => readFileSync(p, 'utf8');
/** `~/ccrc`'s link value, or null when it is no link (or absent). */
const linkOf = (home: string): string | null => {
  try { return readlinkSync(join(home, 'ccrc')); } catch { return null; }
};

/** A W6 box on <name>: `~/ccrc -> ~/ccrc-versions/<name>` (Task 2's
 *  `installVersionedTree`, complete), the box's own stamp and record byte-equal
 *  to that version's kept copies, its floor at <name>, and — when a role is
 *  given — the `ccrc.env` `_inst_env` would have seeded. Returns the version. */
function plantW6Box(home: string, name: string, sha: string, role?: 'server' | 'fleet' | 'both'): string {
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
function keptVersion(home: string, name: string, sha: string, opts: { unsigned?: boolean } = {}): string {
  const root = installVersionedTree(home, name, { link: false, stamp: { sha, version: name } });
  if (opts.unsigned === true) writeFileSync(join(root, '.ccrc-installed'), `${sha}\nunsigned\n`);
  writeFileSync(join(root, 'ccd', 'ccrc'), KEPT_SPINE, { mode: 0o755 });
  return root;
}

/** `ccrc rollback` from the CHECKOUT against the fixture box — wave 4's
 *  describe-local `runRollback`, at file scope because two of this task's
 *  describes need it. */
function rollbackRun(home: string, args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): Result {
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
function onKeptV1(prefix: string): string {
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
  for (const f of ['curl-argv', 'update-json-writes', 'systemctl-calls']) rmSync(join(home, f), { force: true });
  return home;
}

describe('ccrc update: restore arm 1 — a flip back to the kept previous version (W6 Task 4)', () => {
  const GATE_DENIED = 'gate: GET http://127.0.0.1:7788/health got no answer (curl exited 7)';
  const phasesOf = (home: string): string[] => reportWrites(home).map((w) => String(w['phase']));

  it('a FULL gate failure on a box whose previous version is kept restores by arm 1: ~/ccrc flipped back, that version\'s own spine re-run, the gate once more — no release URL of the previous tag, and the stamp, the record and ~/.local/bin/ccd are the kept version\'s (spec §11 arm 1; §18 "the gate restores", "the automatic restore does not sweep"; Review Focus 1)', () => {
    const home = onKeptV1('ccrc-update-arm1-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    // The kept copies, measured BEFORE this case's run. The spine a flip
    // back runs is this checkout's own, and its `_inst_installed` ends in
    // `_ver_keep_state install`, which copies the box's stamp and record
    // over these two files: a box-vs-kept-copy comparison AFTER the run is
    // equal by construction, whatever the bytes (a verified version
    // re-recorded `unsigned` would pass it). The snapshot is the subject.
    const keptStamp = fileText(join(v1, '.ccrc-stamp.json'));
    const keptRec = fileText(join(v1, '.ccrc-installed'));
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    // v2.0.0's server never comes up; v1.0.0's does, once its stamp is back.
    writeFileSync(join(home, 'fixture-health-deny'), 'v2.0.0\n');
    // A sweep that RAN would leave a try-restart: make one possible, so its
    // absence below is the restore's, not the preflight's.
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — GET http:\/\/127\.0\.0\.1:7788\/health got no answer \(curl exited 7\)$/m);
    expect(r.stdout).toContain('update: arm 1: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — flipping back to it (no download)');
    expect(r.stdout).toContain('update: flip: $HOME/ccrc -> $HOME/ccrc-versions/v1.0.0; its stamp and install record restored; its own spine re-placed the executables, hooks and units (no release download)');
    expect(r.stdout).toMatch(/^update: gate: both answers on v1\.0\.0 /m);
    expect(r.stdout).toContain(`update: REVERTED (arm 1): this box runs v1.0.0 again — $HOME/ccrc flipped back to $HOME/ccrc-versions/v1.0.0, no download — ${GATE_DENIED}`);
    expect(r.stdout).not.toMatch(/^update: arm2|^update: arm 2|REVERTED \(arm [23]\)/m);
    const last = lastReport(home);
    expect(last['phase']).toBe('reverted');
    expect(last['detail']).toBe(`arm1: flipped back to v1.0.0; ${GATE_DENIED}`);
    expect(last['target']).toBe('v2.0.0');
    // `_upd_gate` is the one writer of `checking`: "the gate once more" is a second one.
    expect(phasesOf(home).slice(-4)).toEqual(['checking', 'restoring', 'checking', 'reverted']);
    // No download of the tag it returned to: the run fetched v2.0.0 and nothing else.
    const urls = localUrls(home);
    expect(urls.length, 'the update fetched nothing at all — the control is broken').toBeGreaterThan(0);
    expect(urls.filter((u) => !u.startsWith(`local://${home}/releases/latest/download/`))).toEqual([]);
    // The flip, and the box's identity with it: the KEPT version's stamp
    // and record as they were before the run, and the kept copies unmoved.
    expect(linkOf(home)).toBe(v1);
    expect(fileText(join(home, '.ccrc', 'build.json'))).toBe(keptStamp);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(keptRec);
    expect(fileText(join(v1, '.ccrc-stamp.json')), 'the kept stamp was rewritten').toBe(keptStamp);
    expect(fileText(join(v1, '.ccrc-installed')), 'the kept record was rewritten').toBe(keptRec);
    expect(fileText(join(home, '.local', 'bin', 'ccd'))).toBe(fileText(join(v1, 'ccd/ccd')));
    expect(fileText(join(home, '.local', 'bin', 'ccd'))).toContain(CCD_SENTINEL);
    // A return is not a new baseline, and the floor never lowers.
    expect(fileText(join(home, '.ccrc', 'previous'))).toBe(`v1.0.0\n${V1_SHA}\n`);
    expect(fileText(join(home, '.ccrc', 'floor'))).toBe('v2.0.0\n');
    if (process.platform !== 'darwin') {
      expect(fileText(join(home, 'systemctl-calls')), 'the automatic restore swept the supervisors').not.toMatch(/try-restart/);
    }
    // The exit-4 sentence names the FIRST gate's failure, not arm 1's passing
    // re-gate (D-3444).
    expect(r.stderr).toContain(`update: v2.0.0 was installed, but the box did not come back healthy on it (${GATE_DENIED.slice('gate: '.length)}) — exit 4.`);
  }, 60_000);

  // C26 (review 155; W6 Task 8A). Arm 2 runs its restore child from the tree
  // just installed. After `ccrc update --to <a release older than wave 4>
  // --downgrade` whose gate fails, that tree's `ccrc` does not know
  // `--no-gate` or `--from`, so the child exits 2 and arm 3 used to leave a
  // MIXED tree. The pre-update version directory is kept, so arm 1 — the flip
  // back — answers before arm 2 is reached.
  it('C26: a gate-failed downgrade onto a release older than wave 4 ends on ARM 1 — ~/ccrc flipped back to the previous version directory, byte-unchanged, and no mixed tree: the old tree\'s ccrc, which refuses --no-gate and --from, is never asked to be the restore child (review 155 C26; spec §11 arm 1)', () => {
    const home = freshUpdateBox('ccrc-update-arm1-preW4-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    // v2.0.0's own spine is the recorder, and it clears the stub shim's
    // `fixture-health-version` so that, once the kept stamp is back, /health
    // answers the box's stamp (v2.0.0) and not the release just "installed".
    writeFileSync(join(cur, 'ccd', 'ccrc'), KEPT_SPINE.replace('#!/bin/sh\n', '#!/bin/sh\nrm -f "$HOME/fixture-health-version"\n'), { mode: 0o755 });
    // The release older than wave 4: its spine writes THROUGH ~/ccrc (it
    // predates versioned installs, so `_upd_legacy_target` hands it a
    // directory of its own) and places a `ccd/ccrc` that knows neither flag
    // arm 2's child needs. It stamps the box as its own release.
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    // v2.0.0 is published too (with its bundle), so that WITHOUT arm 1 arm 2
    // would go on to run its child — the hazard this pin is for — rather than
    // refusing at the bundle question.
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    writeFileSync(join(home, 'fixture-old-stamp.json'), shippedStamp('v1.0.0', V1_SHA));
    writeFileSync(join(home, 'fixture-on-install'), [
      'mkdir -p "$HOME/ccrc/ccd" && cat > "$HOME/ccrc/ccd/ccrc" <<\'PREW4\'',
      '#!/bin/sh',
      'printf \'%s\\n\' "$0" "$@" > "$HOME/pre-w4-ccrc-argv"',
      'case " $* " in *" --no-gate "*|*" --from "*) echo "ccrc: unknown option: $*" >&2; exit 2 ;; esac',
      'exit 0',
      'PREW4',
      'chmod 755 "$HOME/ccrc/ccd/ccrc"',
      'cp "$HOME/fixture-old-stamp.json" "$HOME/.ccrc/build.json"',
    ].join('\n') + '\n');
    writeFileSync(join(home, 'fixture-stub-installed'), 'yes\n');
    // Its release never comes up; v2.0.0's does, once its stamp is back.
    writeFileSync(join(home, 'fixture-health-deny'), 'v1.0.0\n');
    const curBefore = treeDigest(cur);
    const keptStamp = fileText(join(cur, '.ccrc-stamp.json'));
    const keptRec = fileText(join(cur, '.ccrc-installed'));
    const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — /m);
    expect(r.stdout).toContain('update: arm 1: v2.0.0 is kept at $HOME/ccrc-versions/v2.0.0 — flipping back to it (no download)');
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 1\): this box runs v2\.0\.0 again — \$HOME\/ccrc flipped back to \$HOME\/ccrc-versions\/v2\.0\.0, no download — /m);
    // Arm 2 and arm 3 never ran: the old tree's ccrc was never the child,
    // and nothing says MIXED.
    expect(existsSync(join(home, 'pre-w4-ccrc-argv')), 'the old release\'s ccrc was run as arm 2\'s child').toBe(false);
    expect(r.stdout).not.toMatch(/arm 2|arm 3|MIXED|deploy\.sh/);
    expect(String(lastReport(home)['detail'])).toMatch(/^arm1: flipped back to v2\.0\.0; /);
    expect(lastReport(home)['phase']).toBe('reverted');
    // The previous version directory is what is active, byte for byte, with
    // its stamp and record the box's again; the floor is where it was.
    expect(linkOf(home)).toBe(cur);
    expect(treeDigest(cur), 'the version the update replaced was written').toEqual(curBefore);
    expect(fileText(join(home, '.ccrc', 'build.json'))).toBe(keptStamp);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(keptRec);
    expect(fileText(join(home, '.ccrc', 'floor'))).toBe('v2.0.0\n');
    // The directory the old spine wrote into is not the active one. (It stays
    // kept: `_ver_keep_state update` marks a completed spine before the gate,
    // as it does for a W6 spine whose gate then fails — that is not this
    // item's, and no restore path reads it as `current`.)
    expect(linkOf(home)).not.toBe(join(home, 'ccrc-versions', 'v1.0.0'));
  }, 60_000);

  // The marker the dying spine leaves, as the stub npm writes it. Since D-3457
  // an `_inst_tree`-marked death before the flip is "nothing replaced" (exit 1,
  // no gate), so these are the two shapes `_upd_step_moved` still reads as
  // moved with `_upd_tree_untouched` never consulted: a newer spine's step
  // this ccrc's CCRC_INST_SPINE does not list, and an unreadable marker.
  it.each([
    ['a newer spine\'s step', '_inst_zz_newer_step', '_inst_zz_newer_step'],
    ['an unreadable marker', 'not a step name; rm -rf', 'unreadable'],
  ] as const)('a staged spine that dies before its flip with %s that reads as MOVED leaves ~/ccrc on the previous version: arm 1 restores it IN PLACE — its kept stamp, its own spine, the gate once more — with no download, no npm ci in the running version, and that version byte-unchanged (D-3445, D-3457)', (_what, marker, named) => {
    const home = onKeptV1('ccrc-update-arm1-in-place-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    // A dependency the running version already holds. Arm 2's same-name
    // `npm ci` in v1.0.0 is what would empty this directory; the recorder npm
    // does not, so `npm-cwd` below is what measures that it never ran there.
    mkdirSync(join(v1, 'server', 'node_modules'), { recursive: true });
    writeFileSync(join(v1, 'server', 'node_modules', '.fixture-dep'), 'installed\n');
    const ccdBefore = treeDigest(join(v1, 'ccd'));
    const distBefore = treeDigest(join(v1, 'server', 'dist'));
    rmSync(join(home, 'npm-cwd'), { force: true });
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    // `npm ci` refuses in v2.0.0's new directory only (a registry hiccup,
    // the placement's likeliest failure); every other npm call records and
    // succeeds. Ahead of the recorder npm that `runUpdate` re-plants.
    mkdirSync(join(home, 'fail-bin'), { recursive: true });
    writeFileSync(join(home, 'fail-bin', 'npm'), [
      '#!/bin/sh',
      'printf \'%s\\n\' "$PWD" >> "$HOME/npm-cwd"',
      `case "$PWD" in */ccrc-versions/v2.0.0/*) echo "fixture npm: registry unreachable" >&2; printf '%s\\n' '${marker}' > "$HOME/.ccrc/install-step"; exit 1 ;; esac`,
      'mkdir -p node_modules',
      'exit 0',
    ].join('\n') + '\n', { mode: 0o755 });
    const r = runUpdate(home, [], { PATH: `${join(home, 'fail-bin')}:${updateEnv(home)['PATH'] ?? ''}` });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    // The spine died in `_inst_tree`'s npm ci, before its flip: `~/ccrc` never moved.
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — \/health at 127\.0\.0\.1:7788 answers v1\.0\.0, not v2\.0\.0$/m);
    expect(r.stdout).not.toMatch(/^install: tree: \$HOME\/ccrc -> /m);
    expect(r.stdout).toContain('update: arm 1: $HOME/ccrc still points at v1.0.0, which is kept complete — re-running its own spine in place (no download)');
    // The kept spine ran FROM the running version: Task 2's `running` answer,
    // with its kept record present, so nothing was copied and no npm ci ran.
    expect(r.stdout).toMatch(/^install: tree: already running from \$HOME\/ccrc$/m);
    expect(r.stdout).toMatch(/^install: tree: v1\.0\.0 is complete \(its kept install record is present\) — no npm ci$/m);
    expect(r.stdout).toMatch(/^update: gate: both answers on v1\.0\.0 /m);
    expect(r.stdout).toMatch(new RegExp(`^update: REVERTED \\(arm 1\\): this box runs v1\\.0\\.0 again — \\$HOME/ccrc never left \\$HOME/ccrc-versions/v1\\.0\\.0; its own spine re-ran, no download — spine died at ${named}; gate: `, 'm'));
    expect(r.stdout).not.toMatch(/^update: arm 2|REVERTED \(arm [23]\)/m);
    expect(String(lastReport(home)['detail'])).toMatch(new RegExp(`^arm1: restored v1\\.0\\.0 in place; spine died at ${named}; gate: `));
    // No download of the tag it restored: the run fetched v2.0.0 and nothing else.
    const urls = localUrls(home);
    expect(urls.length, 'the update fetched nothing at all — the control is broken').toBeGreaterThan(0);
    expect(urls.filter((u) => !u.startsWith(`local://${home}/releases/latest/download/`))).toEqual([]);
    const npmDirs = fileText(join(home, 'npm-cwd')).split('\n').filter((l) => l !== '');
    expect(npmDirs.some((d) => d.includes('/ccrc-versions/v2.0.0/')), 'npm never ran in v2.0.0 — the control is broken').toBe(true);
    expect(npmDirs.filter((d) => d.includes('/ccrc-versions/v1.0.0')), 'npm ran in the running version').toEqual([]);
    // The running version is the one it was: its tree, its deps, its kept record.
    expect(linkOf(home)).toBe(v1);
    expect(treeDigest(join(v1, 'ccd')), 'an in-place rsync rewrote the running version').toEqual(ccdBefore);
    expect(treeDigest(join(v1, 'server', 'dist'))).toEqual(distBefore);
    expect(fileText(join(v1, 'server', 'node_modules', '.fixture-dep'))).toBe('installed\n');
    expect(existsSync(join(v1, '.ccrc-installed')), 'the running version stopped claiming completeness').toBe(true);
    expect(fileText(join(home, '.local', 'bin', 'ccd'))).toContain(CCD_SENTINEL);
  }, 60_000);

  it('arm 1 with ~/ccrc already ON the previous version restores it IN PLACE — unit pin, the arm called directly on a FULL box: its kept stamp, its own spine, the gate once more, no download, no npm ci in the running version, that version byte-unchanged (D-3445; the end-to-end case above reaches it through cmd_update; an `_inst_tree`-marked death never gets here, D-3457)', () => {
    const home = onKeptV1('ccrc-update-arm1-in-place-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    // A dependency the running version already holds. Arm 2's same-name
    // `npm ci` in v1.0.0 is what would empty this directory; the recorder npm
    // below does not, so `npm-cwd` is what measures that none ran there.
    mkdirSync(join(v1, 'server', 'node_modules'), { recursive: true });
    writeFileSync(join(v1, 'server', 'node_modules', '.fixture-dep'), 'installed\n');
    const ccdBefore = treeDigest(join(v1, 'ccd'));
    const distBefore = treeDigest(join(v1, 'server', 'dist'));
    rmSync(join(home, 'npm-cwd'), { force: true });
    mkdirSync(join(home, 'fail-bin'), { recursive: true });
    writeFileSync(join(home, 'fail-bin', 'npm'), [
      '#!/bin/sh', 'printf \'%s\\n\' "$PWD" >> "$HOME/npm-cwd"', 'mkdir -p node_modules', 'exit 0',
    ].join('\n') + '\n', { mode: 0o755 });
    // What a run to v2.0.0 leaves when its gate failed with `~/ccrc` never
    // having left v1.0.0: `previous` names v1.0.0, and the record was cleared
    // before the staged spine.
    writeFileSync(join(home, '.ccrc', 'previous'), `v1.0.0\n${V1_SHA}\n`);
    rmSync(join(home, '.ccrc', 'installed'));
    // `sourcedCcrc` re-plants the poisoned `gh` (`updateEnv`), and a real kept
    // spine ends with doctor: on the poison it FAILs, which is now (F9) part of
    // what arm 1's line says. This case is about a CLEAN restore, so the doctor
    // stubs `runUpdate` re-plants before every run are re-planted by the script.
    const r = sourcedCcrc(home, [
      'cp "$HOME"/doctor-stubs/* "$HOME/.local/bin/"',
      'export PATH="$HOME/fail-bin:$PATH" CCRC_UPDATE_HEALTH_S=0',
      'UPD_VERSION=v2.0.0; UPD_REPORT_TARGET=v2.0.0; UPD_GATE_WHY="the first gate"',
      'rc=0; _upd_restore_arm1 "" "spine died at _inst_tree" v1.0.0 1 || rc=$?',
      'echo "rc=$rc first=$UPD_GATE_WHY"',
    ].join('\n'));
    expect(r.stdout, `stderr: ${r.stderr}`).toContain('update: arm 1: $HOME/ccrc still points at v1.0.0, which is kept complete — re-running its own spine in place (no download)');
    // The kept spine ran FROM the running version: Task 2's `running` answer,
    // with its kept record present, so nothing was copied and no npm ci ran.
    expect(r.stdout).toMatch(/^install: tree: already running from \$HOME\/ccrc$/m);
    expect(r.stdout).toMatch(/^install: tree: v1\.0\.0 is complete \(its kept install record is present\) — no npm ci$/m);
    expect(r.stdout).toMatch(/^update: gate: both answers on v1\.0\.0 /m);
    expect(r.stdout).toContain('update: REVERTED (arm 1): this box runs v1.0.0 again — $HOME/ccrc never left $HOME/ccrc-versions/v1.0.0; its own spine re-ran, no download — spine died at _inst_tree');
    expect(r.stdout).not.toMatch(/^update: arm 2|REVERTED \(arm [23]\)/m);
    expect(r.stdout).toMatch(/^rc=0 first=the first gate$/m);
    expect(lastReport(home)).toMatchObject({ phase: 'reverted', detail: 'arm1: restored v1.0.0 in place; spine died at _inst_tree' });
    expect(localUrls(home), 'arm 1 fetched something').toEqual([]);
    const npmDirs = existsSync(join(home, 'npm-cwd')) ? fileText(join(home, 'npm-cwd')).split('\n').filter((l) => l !== '') : [];
    expect(npmDirs.filter((d) => d.includes('/ccrc-versions/v1.0.0')), 'npm ran in the running version').toEqual([]);
    // The running version is the one it was: its tree, its deps, its kept record.
    expect(linkOf(home)).toBe(v1);
    expect(treeDigest(join(v1, 'ccd')), 'an in-place rsync rewrote the running version').toEqual(ccdBefore);
    expect(treeDigest(join(v1, 'server', 'dist'))).toEqual(distBefore);
    expect(fileText(join(v1, 'server', 'node_modules', '.fixture-dep'))).toBe('installed\n');
    expect(existsSync(join(v1, '.ccrc-installed')), 'the running version stopped claiming completeness').toBe(true);
    expect(fileText(join(home, '.local', 'bin', 'ccd'))).toContain(CCD_SENTINEL);
  }, 60_000);

  it('arm 1 whose kept spine COMPLETED under a failing doctor still reverts, and the report and the line say the doctor exited N — as arm 2\'s rc-3 arm does (F9; the flip stubbed to VER_SPINE_RC=3, the arm called directly)', () => {
    const home = freshUpdateBox('ccrc-update-arm1-doctor-');
    plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    keptVersion(home, 'v1.0.0', V1_SHA);
    writeFileSync(join(home, '.ccrc', 'previous'), `v1.0.0\n${V1_SHA}\n`);
    const r = sourcedCcrc(home, [
      '_ver_flip_back() { VER_SPINE_RC=3; return 0; }; _upd_gate() { return 0; }',
      'UPD_VERSION=v3.0.0; UPD_REPORT_TARGET=v3.0.0; UPD_GATE_WHY="the first gate"',
      'rc=0; _upd_restore_arm1 server "gate: fixture" v2.0.0 1 || rc=$?',
      'echo "rc=$rc"',
    ].join('\n'));
    expect(r.stdout, `stderr: ${r.stderr}`).toContain('update: REVERTED (arm 1): this box runs v1.0.0 again — $HOME/ccrc flipped back to $HOME/ccrc-versions/v1.0.0, no download, but its doctor exited 3 (\'ccrc doctor\' re-reads the FAIL lines) — gate: fixture');
    expect(r.stdout).toMatch(/^rc=0$/m);
    expect(lastReport(home)).toMatchObject({ phase: 'reverted', detail: 'arm1: flipped back to v1.0.0 (its doctor exited 3); gate: fixture' });
    // The clean spine reads as before (the control): no doctor clause.
    const clean = sourcedCcrc(home, [
      '_ver_flip_back() { VER_SPINE_RC=0; return 0; }; _upd_gate() { return 0; }',
      'UPD_VERSION=v3.0.0; UPD_REPORT_TARGET=v3.0.0; UPD_GATE_WHY="the first gate"',
      '_upd_restore_arm1 server "gate: fixture" v2.0.0 1; echo "rc=$?"',
    ].join('\n'));
    expect(clean.stdout, `stderr: ${clean.stderr}`).toContain('update: REVERTED (arm 1): this box runs v1.0.0 again');
    expect(clean.stdout).not.toContain('its doctor exited');
  });

  it('arm 1 whose own gate fails points ~/ccrc back at the new version and clears the record; arm 3 then voids THAT version\'s kept record, so no later flip returns to its MIXED tree (D-3443, D-3441)', () => {
    const home = onKeptV1('ccrc-update-arm1-fails-arm3-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    const v2 = join(home, 'ccrc-versions', 'v2.0.0');
    // v1.0.0 is no longer published, so arm 2 refuses and arm 3 runs.
    rmSync(join(home, 'releases', 'download', 'v1.0.0'), { recursive: true, force: true });
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-deny'), 'v2.0.0\nv1.0.0\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toContain('update: flip: $HOME/ccrc -> $HOME/ccrc-versions/v1.0.0; its stamp and install record restored');
    expect(r.stdout).toContain(`update: arm 1 failed (${GATE_DENIED}) — $HOME/ccrc points at v2.0.0 again; falling to arm 2`);
    expect(r.stdout).toMatch(/^update: arm2-refused: v1\.0\.0 ships no bundle — /m);
    expect(r.stdout).toContain('update: arm 3: $HOME/ccrc-versions/v2.0.0 is where the copy lands, so it will hold a MIXED tree — its kept install record is removed first, so no flip returns to it');
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
    expect(String(lastReport(home)['detail'])).toMatch(/^arm3: tree MIXED, deploy\.sh is the remedy; gate: /);
    expect(linkOf(home)).toBe(v2);
    expect(existsSync(join(v2, '.ccrc-installed')), 'the MIXED version still claims completeness').toBe(false);
    expect(existsSync(join(v1, '.ccrc-installed')), 'the void landed on the kept version').toBe(true);
    expect(existsSync(join(home, '.ccrc', 'installed'))).toBe(false);
    // …and no flip returns to it: v2.0.0 is no kept version now, so a rollback
    // to it asks the release host — which never published download/v2.0.0/ —
    // and refuses at exit 2, before anything moves.
    const rb = rollbackRun(home, ['--to', 'v2.0.0']);
    expect(rb.code, `stderr: ${rb.stderr}\nstdout: ${rb.stdout}`).toBe(2);
    expect(rb.stderr).toMatch(/^ccrc: rollback: v2\.0\.0 is not a published release \(its SHA256SUMS answered 404\)/m);
    expect(rb.stdout).not.toMatch(/is kept at/);
    expect(linkOf(home)).toBe(v2);
  }, 60_000);

  // W6 Task 8A (review 173's F1r: every write on an arm-3 path is true). On a
  // versioned box arm 3 says, BEFORE its copy, what it will leave in the
  // version `~/ccrc` points at — and that line must agree with the verdict it
  // prints after. A same-tag rerun whose staged sha equals the stamp's used to
  // print "it will hold a MIXED tree" and then "nothing is mixed".
  it.each([
    ['a completed record and the same sha: the same build', true,
      'and nothing is mixed there (the same build), but arm 3\'s copy is best effort',
      /nothing is mixed\. Read 'ccrc doctor' for why the gate failed/],
    ['no record and the same sha: the pre-update tree, which may itself be mixed', false,
      'so it may hold a MIXED tree',
      /the PRE-UPDATE tree, which may itself be MIXED\. Read 'ccrc doctor' for its state/],
  ] as const)('on a versioned box a same-tag arm 3 says what it leaves in the pointed-at version in the words of its own verdict — %s (F1r)', (_what, completed, lands, verdict) => {
    const home = freshUpdateBox('ccrc-update-arm3-void-line-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    if (!completed) rmSync(join(home, '.ccrc', 'installed'));
    // `previous` names the target, so arm 1 and arm 2 both skip and arm 3 runs.
    writeFileSync(join(home, '.ccrc', 'previous'), `v2.0.0\n${V2_SHA}\n`);
    packRelease(home, selfConvergedTree(home, 'v2.0.0', V2_SHA), { tag: 'v2.0.0', latest: false });
    writeFileSync(join(home, 'fixture-health-down'), 'yes\n');
    const r = runUpdate(home, ['--to', 'v2.0.0', '--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toContain(`update: arm 3: $HOME/ccrc-versions/v2.0.0 is where the copy lands, ${lands} — its kept install record is removed first, so no flip returns to it`);
    expect(r.stdout).toMatch(verdict);
    expect(existsSync(join(cur, '.ccrc-installed')), 'the pointed-at version still claims completeness').toBe(false);
    // The two never contradict: a MIXED promise beside a "nothing is mixed" verdict.
    if (completed) expect(r.stdout).not.toMatch(/will hold a MIXED tree|may hold a MIXED tree/);
    else expect(r.stdout).not.toMatch(/will hold a MIXED tree|nothing is mixed/);
  });

  it('arm 1 whose own gate fails hands arm 2 the NEW tree and a box that reads incomplete: the restore child re-installs v1.0.0 and its spine flips ~/ccrc off v2.0.0 — it cannot no-op on the stamp and record arm 1 restored (D-3443)', () => {
    const home = onKeptV1('ccrc-update-arm1-fails-arm2-');
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-deny'), 'v2.0.0\nv1.0.0\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toContain(`update: arm 1 failed (${GATE_DENIED}) — $HOME/ccrc points at v2.0.0 again; falling to arm 2`);
    expect(r.stdout).toMatch(/^update: arm 2: re-installing v1\.0\.0 \(the build this box ran before\)/m);
    // The child's staged spine found ~/ccrc on v2.0.0 and a v1.0.0 to place.
    expect(r.stdout).toContain('install: tree: $HOME/ccrc -> $HOME/ccrc-versions/v1.0.0 (was $HOME/ccrc-versions/v2.0.0) — one rename');
    expect(r.stdout).not.toMatch(/^update: this box already runs v1\.0\.0/m);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 2\): this box runs v1\.0\.0 again, re-installed from its release — gate: /m);
    expect(lastReport(home)['phase']).toBe('reverted');
    expect(String(lastReport(home)['detail'])).toMatch(/^arm2: restored v1\.0\.0; gate: /);
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
  }, 60_000);

  it('arm 1 refuses BEFORE any flip, naming why, and falls to arm 2: no previous, an untagged or malformed one, a box not versioned, one already on a previous tag that is not kept complete (on one that is, arm 1 restores in place — the FULL case above), a previous with no kept or an incomplete kept version (the arm, sourced)', () => {
    const prev = (h: string, body: string): void => writeFileSync(join(h, '.ccrc', 'previous'), body);
    const rows: Array<{ what: string; plant: (h: string) => void; says: string }> = [
      { what: 'no previous',
        plant: (h) => { plantW6Box(h, 'v2.0.0', V2_SHA); keptVersion(h, 'v1.0.0', V1_SHA); },
        says: 'update: arm 1: no ~/.ccrc/previous — arm 2' },
      { what: 'untagged previous',
        plant: (h) => { plantW6Box(h, 'v2.0.0', V2_SHA); keptVersion(h, 'v1.0.0', V1_SHA); prev(h, `untagged\n${V1_SHA}\n`); },
        says: 'update: arm 1: the previous build carried no tag — arm 2' },
      { what: 'malformed previous',
        plant: (h) => { plantW6Box(h, 'v2.0.0', V2_SHA); keptVersion(h, 'v1.0.0', V1_SHA); prev(h, 'three\n'); },
        says: 'update: arm 1: ~/.ccrc/previous is unreadable or malformed — arm 2' },
      { what: 'a real-directory box',
        plant: (h) => { plantOldBox(h, { version: 'v2.0.0' }); prev(h, `v1.0.0\n${V1_SHA}\n`); },
        says: 'update: arm 1: $HOME/ccrc is not versioned (directory) — arm 2' },
      { what: 'already on a previous tag that is not kept complete',
        plant: (h) => {
          rmSync(join(plantW6Box(h, 'v1.0.0', V1_SHA), '.ccrc-installed'));
          prev(h, `v1.0.0\n${V1_SHA}\n`);
        },
        says: 'update: arm 1: $HOME/ccrc-versions/v1.0.0 is incomplete (no kept install record) — arm 2' },
      { what: 'no kept version',
        plant: (h) => { plantW6Box(h, 'v2.0.0', V2_SHA); prev(h, `v1.0.0\n${V1_SHA}\n`); },
        says: 'update: arm 1: no kept version v1.0.0 under $HOME/ccrc-versions — arm 2' },
      { what: 'an incomplete kept version',
        plant: (h) => {
          plantW6Box(h, 'v2.0.0', V2_SHA);
          rmSync(join(keptVersion(h, 'v1.0.0', V1_SHA), '.ccrc-installed'));
          prev(h, `v1.0.0\n${V1_SHA}\n`);
        },
        says: 'update: arm 1: $HOME/ccrc-versions/v1.0.0 is incomplete (no kept install record) — arm 2' },
    ];
    for (const row of rows) {
      const home = freshUpdateBox('ccrc-update-arm1-refuse-');
      row.plant(home);
      const link = linkOf(home);
      // Wave 4 Task 3's file-scope `sourcedCcrc(home, script)`: one script string.
      const r = sourcedCcrc(home, 'rc=0; _upd_restore_arm1 both "gate: fixture" || rc=$?; echo "rc=$rc"');
      const said = r.stdout.split('\n').filter((l) => /^(update: |rc=)/.test(l));
      expect(said, `${row.what}: ${r.stderr}`).toEqual([row.says, 'rc=1']);
      expect(linkOf(home), `${row.what}: a refusal moved ~/ccrc`).toBe(link);
      expect(existsSync(join(home, 'kept-spine-argv')), `${row.what}: a refusal ran a spine`).toBe(false);
    }
  });

  it('_ver_kept: complete, absent, or incomplete with the first missing piece named — the role decides which build counts, and a tag-shaped name must be what its kept stamp says (the arms, sourced)', () => {
    const stampOf = (version: string | null): string => (version === null
      ? `{"sha":"${V1_SHA}","ref":"main","builtAt":"2026-09-23T00:00:00Z","dirty":false}\n`
      : `{"sha":"${V1_SHA}","ref":"main","builtAt":"2026-09-23T00:00:00Z","dirty":false,"version":"${version}"}\n`);
    const rows: Array<{ what: string; ask?: string; role: string; tree?: string;
      plant?: (root: string, home: string) => void; says: string }> = [
      { what: 'complete (both)', role: 'both', says: 'rc=0 why=' },
      { what: 'complete (an empty role reads both)', role: '', says: 'rc=0 why=' },
      { what: 'absent', ask: 'v0.9.0', role: 'both', says: 'rc=1 why=no kept version v0.9.0 under $HOME/ccrc-versions' },
      { what: 'a symlink is not a kept version', ask: 'v0.9.1', role: 'both',
        plant: (root, home) => symlinkSync(root, join(home, 'ccrc-versions', 'v0.9.1')),
        says: 'rc=1 why=no kept version v0.9.1 under $HOME/ccrc-versions' },
      { what: 'no ccd/ccrc', role: 'both', plant: (root) => rmSync(join(root, 'ccd', 'ccrc')), says: 'rc=2 why=no ccd/ccrc' },
      { what: 'no server build', role: 'server',
        plant: (root) => rmSync(join(root, 'server', 'dist', 'server', 'src', 'index.js')), says: 'rc=2 why=no server build' },
      { what: 'a fleet box needs no server build', role: 'fleet',
        plant: (root) => rmSync(join(root, 'server', 'dist', 'server', 'src', 'index.js')), says: 'rc=0 why=' },
      { what: 'no agent build', role: 'fleet',
        plant: (root) => rmSync(join(root, 'agent', 'dist', 'agent', 'src', 'index.js')), says: 'rc=2 why=no agent build' },
      { what: 'no kept stamp', role: 'both', plant: (root) => rmSync(join(root, '.ccrc-stamp.json')), says: 'rc=2 why=no kept stamp' },
      { what: 'no kept install record', role: 'both',
        plant: (root) => rmSync(join(root, '.ccrc-installed')), says: 'rc=2 why=no kept install record' },
      { what: 'a stamp that does not parse', role: 'both',
        plant: (root) => writeFileSync(join(root, '.ccrc-stamp.json'), '{not json\n'), says: 'rc=2 why=its kept stamp does not parse' },
      { what: 'a stamp naming another tag', role: 'both',
        plant: (root) => writeFileSync(join(root, '.ccrc-stamp.json'), stampOf('v1.0.1')),
        says: 'rc=2 why=its kept stamp reads v1.0.1, not v1.0.0' },
      { what: 'an unversioned stamp under a tag name', role: 'both',
        plant: (root) => writeFileSync(join(root, '.ccrc-stamp.json'), stampOf(null)),
        says: 'rc=2 why=its kept stamp reads an unversioned build, not v1.0.0' },
      { what: 'an untagged name is not held to a version', ask: 'untagged-0123456789ab', tree: 'untagged-0123456789ab',
        role: 'both', says: 'rc=0 why=' },
    ];
    for (const row of rows) {
      const home = freshUpdateBox('ccrc-update-ver-kept-');
      const tree = row.tree ?? 'v1.0.0';
      const root = installVersionedTree(home, tree, {
        link: false, stamp: tree.startsWith('v') ? { sha: V1_SHA, version: tree } : { sha: V1_SHA },
      });
      row.plant?.(root, home);
      // The name and the role are plain tokens (a tag, `untagged-<hex>`, a
      // role word or ''), so single quotes carry them into the script intact.
      const r = sourcedCcrc(home,
        `rc=0; _ver_kept '${row.ask ?? tree}' '${row.role}' || rc=$?; printf 'rc=%s why=%s\\n' "$rc" "$VER_WHY"`);
      const said = r.stdout.split('\n').filter((l) => l.startsWith('rc='));
      expect(said, `${row.what}: ${r.stderr}`).toEqual([row.says]);
    }
  });
});

describe('ccrc rollback: by flip when the version is kept (W6 Task 4)', () => {
  const phasesOf = (home: string): string[] => reportWrites(home).map((w) => String(w['phase']));
  const calls = (home: string): string[] => (existsSync(join(home, 'systemctl-calls'))
    ? fileText(join(home, 'systemctl-calls')).split('\n').filter((l) => l !== '') : []);
  const withSweep = (home: string): void => {
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
  };
  /** A W6 server box on v2.0.0 with v1.0.0 kept beside it (its spine the
   *  recorder), and `previous` naming v1.0.0 — what the move onto v2.0.0 left. */
  const flipBox = (prefix: string, opts: { unsigned?: boolean } = {}): { home: string; kept: string } => {
    const home = freshUpdateBox(prefix);
    plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    const kept = keptVersion(home, 'v1.0.0', V1_SHA, { unsigned: opts.unsigned });
    writeFileSync(join(home, '.ccrc', 'previous'), `v1.0.0\n${V1_SHA}\n`);
    return { home, kept };
  };

  it('bare `ccrc rollback` to a kept version is a flip: no release-host question, no download; that version\'s own spine runs from the flipped tree — verified, no lock marker, no lock descriptor — then the gate, then the sweep behind its preflight (spec §11 "rollback after W5 is arm 1"; §18 "a standalone rollback sweeps behind the preflight"; D-3442)', () => {
    const { home, kept } = flipBox('ccrc-rollback-flip-');
    // Every release-host question would answer 404, so a rollback that asked
    // one would refuse at exit 2 (wave 4 Task 6's knob).
    writeFileSync(join(home, 'fixture-release-http'), '404\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain('rollback: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — no release-host question and no download');
    expect(localUrls(home)).toEqual([]);
    expect(linkOf(home)).toBe(kept);
    expect(fileText(join(home, 'kept-spine-argv')).split('\n').filter((l) => l !== ''))
      .toEqual([join(home, 'ccrc', 'ccd', 'ccrc'), 'install', '--role', 'server']);
    expect(fileText(join(home, 'kept-spine-env')).trim())
      .toBe(`verified=1 held=unset lockfd=${process.platform === 'linux' ? 'closed' : 'unmeasured'}`);
    // The kept spine stamps nothing (a pre-W6 spine's shape): the stamp is the
    // flip's own restore, the record the spine's.
    expect(fileText(join(home, '.ccrc', 'build.json'))).toBe(fileText(join(kept, '.ccrc-stamp.json')));
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(fileText(join(kept, '.ccrc-installed')));
    expect(fileText(join(home, '.ccrc', 'previous'))).toBe(`v1.0.0\n${V1_SHA}\n`);
    expect(fileText(join(home, '.ccrc', 'floor'))).toBe('v2.0.0\n');
    expect(r.stdout).toMatch(/^update: gate: server answers on v1\.0\.0 /m);
    expect(r.stdout).toContain('rollback: this box runs v1.0.0 again — flipped back to $HOME/ccrc-versions/v1.0.0, no download');
    // No resolving, fetching, verifying or backing-up: nothing was downloaded.
    expect(phasesOf(home)).toEqual(['installing', 'checking', 'restarting', 'done']);
    expect(lastReport(home)).toMatchObject({
      phase: 'done', detail: 'rolled back by flip to v1.0.0', target: 'v1.0.0', from: 'rollback',
    });
    if (process.platform === 'linux') {
      const c = calls(home);
      const gate = c.indexOf('--user is-active ccrc.service');
      const restartAt = c.indexOf('--user try-restart claude-session@*');
      expect(gate, c.join('\n')).toBeGreaterThan(-1);
      expect(restartAt, 'a rollback by flip must end in the supervisor sweep').toBeGreaterThan(gate);
      for (const u of ['alpha', 'beta']) {
        const at = c.indexOf(`--user show -p KillMode claude-session@${u}.service`);
        expect(at, `no KillMode preflight for ${u}`).toBeGreaterThan(-1);
        expect(at).toBeLessThan(restartAt);
      }
      expect(r.stdout).not.toMatch(/DEGRADED/);
    }
  });

  it('an unverified kept version stays unverified: its own spine runs WITHOUT CCRC_UPDATE_VERIFIED when its kept record says unsigned — a flip never promotes it (§18 "arm 2 never silently unsigns", applied to the flip; D-3439)', () => {
    const { home } = flipBox('ccrc-rollback-flip-unsigned-', { unsigned: true });
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(fileText(join(home, 'kept-spine-env'))).toMatch(/^verified=unset held=unset /);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(`${V1_SHA}\nunsigned\n`);
  });

  // D-3461 (controller ruling, found reviewing Task 8's rehearsal R6): a
  // rollback by flip returned 0 after its gate passed even when the kept
  // spine's trailing doctor exited non-zero, while an update exits 3 on the
  // same FAILs and the Global Constraints' exit table reads `ccrc rollback`
  // the same way (D-3114). The table governs.
  it('a rollback by flip whose kept spine COMPLETED under a failing doctor exits 3, not 0: the gate passed, the box IS on the kept version, the terminal `done` report and the sweep still happen — and the same rollback under a passing doctor exits 0 (D-3461)', () => {
    const { home, kept } = flipBox('ccrc-rollback-flip-doctor3-');
    writeFileSync(join(home, 'fixture-kept-spine-exit'), '1\n');
    writeFileSync(join(home, 'fixture-kept-spine-completes'), 'yes\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(3);
    expect(r.stdout).toContain("update: gate: server answers on v1.0.0");
    expect(r.stdout).toContain("rollback: flip: v1.0.0's spine completed (its record is written) but its trailing doctor exited 1 — the FAIL lines above are the box's health; the gate decides");
    expect(r.stdout).toContain('rollback: this box runs v1.0.0 again — flipped back to $HOME/ccrc-versions/v1.0.0, no download');
    expect(r.stdout).toContain("rollback: the kept spine completed (its record is written) but its trailing doctor exited 1 — this box IS on v1.0.0; the FAIL lines above are the box's health, not the rollback's");
    expect(linkOf(home)).toBe(kept);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(fileText(join(kept, '.ccrc-installed')));
    // The terminal report is written either way, as wave 4's update writes it for 3.
    expect(lastReport(home)).toMatchObject({
      phase: 'done', detail: "doctor exited 1 - the box moved; its health is ccrc doctor's", target: 'v1.0.0', from: 'rollback',
    });
    expect(phasesOf(home)).toEqual(['installing', 'checking', 'restarting', 'done']);
    if (process.platform === 'linux') {
      expect(calls(home), 'a moved box is swept, exit 3 or not').toContain('--user try-restart claude-session@*');
    }
    // The control: the same box under a passing doctor.
    const ok = flipBox('ccrc-rollback-flip-doctor0-');
    withSweep(ok.home);
    const r0 = rollbackRun(ok.home);
    expect(r0.code, `stderr: ${r0.stderr}\nstdout: ${r0.stdout}`).toBe(0);
    expect(r0.stdout).not.toMatch(/trailing doctor exited/);
    expect(lastReport(ok.home)).toMatchObject({ phase: 'done', detail: 'rolled back by flip to v1.0.0' });
  });

  // C27 (review 155; W6 Task 8A, the controller's ruling). The stale-`previous`
  // detour: a box rolls back to a release older than wave 4 (which never
  // rewrites `previous`), then that release's OWN updater moves it forward.
  // That updater predates W6, so it writes neither `previous` nor the layout:
  // `~/ccrc` still names the version directory it wrote through, and the
  // stamp names where it went. A bare rollback must not trust `previous`.
  const staleBox = (prefix: string, stamped: string): string => {
    const home = freshUpdateBox(prefix);
    // `~/ccrc -> ~/ccrc-versions/v1.0.0`, kept complete; its OWN updater moved
    // the box on to `stamped` by rewriting the box stamp only.
    plantW6Box(home, 'v1.0.0', V1_SHA, 'server');
    writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp(stamped, 'c'.repeat(40)));
    writeFileSync(join(home, '.ccrc', 'previous'), `v2.0.0\n${V2_SHA}\n`);
    // Every release-host question answers 404: a run that gets past the
    // check ends at exit 2 "not a published release", and one that is
    // refused by it ends at exit 1 having asked nothing.
    writeFileSync(join(home, 'fixture-release-http'), '404\n');
    return home;
  };

  it('a bare rollback REFUSES when previous disagrees with what the layout records: ~/ccrc points at v1.0.0, the stamp says v1.1.0, previous says v2.0.0 — the refusal names all three, asks for --to, and changes and asks nothing (C27)', () => {
    const home = staleBox('ccrc-rollback-stale-previous-', 'v1.1.0');
    // What the box's own state holds: the harness re-plants its stubs under
    // `.local/bin` on every run, which is not the verb writing.
    const own = (): string[] => homeSnapshot(home).filter((l) => /^(\.ccrc\/|ccrc)/.test(l));
    const before = own();
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rollback: ~\/\.ccrc\/previous names v2\.0\.0, but it cannot be trusted here — \$HOME\/ccrc points at \$HOME\/ccrc-versions\/v1\.0\.0 while this box's stamp reads v1\.1\.0, /m);
    expect(r.stderr).toContain('name the target: ccrc rollback --to vX.Y.Z');
    // What the check measures is only that the link and the stamp disagree,
    // so the sentence claims no history: it names two possible movers and
    // says previous MAY not be the build before the last update.
    expect(r.stderr).toContain("so the last move was made by something that does not keep the layout (for example a pre-W6 release's updater after a rollback, or deploy.sh), and previous may not be the build before the last update. Nothing on this box was changed");
    expect(r.stderr).not.toContain('older than versioned installs moved it forward');
    expect(localUrls(home), 'the refusal asked the release host').toEqual([]);
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
    expect(existsSync(join(home, '.ccrc', 'update.json')), 'a refusal before the lock wrote a report').toBe(false);
    expect(own()).toEqual(before);
    // The same words for a --to-less rollback typed by the watchdog: no `to`, no trust.
    const w = rollbackRun(home, ['--from', 'watchdog']);
    expect(w.code).toBe(1);
    expect(w.stderr).toContain('it cannot be trusted here');
  });

  it('the refusal is only for a DISAGREEMENT, and only for a bare rollback: an agreeing layout proceeds (the control — the same box with the stamp on v1.0.0 asks the release host about the never-kept v2.0.0, the common first rollback after the move onto W6), `--to` names its own target, and an unversioned layout keeps wave 4\'s behaviour (C27)', () => {
    // The control: stamp v1.0.0 agrees with the pointed-at v1.0.0.
    const agree = staleBox('ccrc-rollback-stale-previous-agree-', 'v1.0.0');
    let r = rollbackRun(agree);
    expect(r.stderr).not.toContain('it cannot be trusted here');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: rollback: v2\.0\.0 is not a published release \(its SHA256SUMS answered 404\)/m);
    // The disagreeing box, told its target: the check is never consulted.
    const stale = staleBox('ccrc-rollback-stale-previous-to-', 'v1.1.0');
    r = rollbackRun(stale, ['--to', 'v2.0.0']);
    expect(r.stderr).not.toContain('it cannot be trusted here');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    // An `untagged-<sha12>` name is compared with the stamp's sha12; an
    // `unstamped-*` name and an unreadable stamp have no verdict.
    const sha = 'd'.repeat(40);
    const untagged = staleBox('ccrc-rollback-stale-previous-untagged-', 'v1.1.0');
    renameSync(join(untagged, 'ccrc-versions', 'v1.0.0'), join(untagged, 'ccrc-versions', `untagged-${sha.slice(0, 12)}`));
    rmSync(join(untagged, 'ccrc'));
    symlinkSync(join(untagged, 'ccrc-versions', `untagged-${sha.slice(0, 12)}`), join(untagged, 'ccrc'));
    writeFileSync(join(untagged, '.ccrc', 'build.json'), `{"sha":"${sha}","ref":"main","builtAt":"2026-08-21T00:00:00Z","dirty":false}\n`);
    r = rollbackRun(untagged);
    expect(r.stderr, 'an untagged name whose sha12 the stamp agrees with is not a disagreement').not.toContain('it cannot be trusted here');
    writeFileSync(join(untagged, '.ccrc', 'build.json'), shippedStamp('v1.1.0', 'e'.repeat(40)));
    r = rollbackRun(untagged);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain('while this box\'s stamp reads v1.1.0');
    const unreadable = staleBox('ccrc-rollback-stale-previous-unreadable-', 'v1.1.0');
    writeFileSync(join(unreadable, '.ccrc', 'build.json'), 'not json\n');
    r = rollbackRun(unreadable);
    expect(r.stderr, 'an unreadable stamp is no verdict').not.toContain('it cannot be trusted here');
    // The commonest case, end to end (a FULL first move onto v1.0.0, whose
    // migration leaves `previous` naming the pre-migration tag — never a kept
    // version): its rollback must still proceed.
    const full = onKeptV1('ccrc-rollback-stale-previous-full-');
    expect(fileText(join(full, '.ccrc', 'previous')).split('\n')[0]).toBe('v0.9.0');
    writeFileSync(join(full, 'fixture-release-http'), '404\n');
    r = rollbackRun(full);
    expect(r.stderr, 'the first rollback after the move onto W6 was refused').not.toContain('it cannot be trusted here');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    // A real-directory (unversioned) box: wave 4's behaviour, previous trusted.
    const dirBox = freshUpdateBox('ccrc-rollback-stale-previous-directory-');
    plantOldBox(dirBox, { version: 'v1.1.0' });
    writeFileSync(join(dirBox, '.ccrc', 'previous'), `v2.0.0\n${V2_SHA}\n`);
    writeFileSync(join(dirBox, 'fixture-release-http'), '404\n');
    r = rollbackRun(dirBox);
    expect(r.stderr).not.toContain('it cannot be trusted here');
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
  });

  it('a box already on the kept tag with its install completed has nothing to do — exit 0, nothing written; one whose install did NOT complete re-runs the kept spine, so D-3264\'s rerun (`ccrc rollback --to <v>`) works on a versioned box', () => {
    const home = freshUpdateBox('ccrc-rollback-flip-already-');
    const root = plantW6Box(home, 'v1.0.0', V1_SHA, 'server');
    writeFileSync(join(root, 'ccd', 'ccrc'), KEPT_SPINE, { mode: 0o755 });
    let r = rollbackRun(home, ['--to', 'v1.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain(`rollback: this box already runs v1.0.0 (${V1_SHA}) and that install completed — nothing to do (to reinstall it: ccrc update --to v1.0.0 --downgrade --force)`);
    expect(existsSync(join(home, 'kept-spine-argv'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
    expect(localUrls(home)).toEqual([]);
    // The same box after a kept spine died past `_inst_stamp`: the stamp
    // already on v1.0.0, and no completed-install record.
    rmSync(join(home, '.ccrc', 'installed'));
    r = rollbackRun(home, ['--to', 'v1.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/nothing to do/);
    expect(fileText(join(home, 'kept-spine-argv')).split('\n')[1]).toBe('install');
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(fileText(join(root, '.ccrc-installed')));
    expect(lastReport(home)['phase']).toBe('done');
  });

  it('a kept directory whose install never completed is NOT kept: the release host is asked as before, and an unpublished tag is refused at exit 2 (the control on the skip; passes before this task too)', () => {
    const { home, kept } = flipBox('ccrc-rollback-flip-incomplete-');
    rmSync(join(kept, '.ccrc-installed'));
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    expect(r.stdout).not.toMatch(/is kept at/);
    expect(r.stderr).toMatch(/^ccrc: rollback: v1\.0\.0 is not a published release \(its SHA256SUMS answered 404\)/m);
    expect(localUrls(home)).toEqual([`local://${home}/releases/download/v1.0.0/SHA256SUMS`]);
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
  });

  it('a kept spine that does not complete: ~/ccrc stays on the kept version, the box reads incomplete, the report says why — exit 1, no gate, no sweep', () => {
    const { home, kept } = flipBox('ccrc-rollback-flip-spine-dies-');
    writeFileSync(join(home, 'fixture-kept-spine-exit'), '1\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain("ccrc: rollback: $HOME/ccrc points at $HOME/ccrc-versions/v1.0.0, but its own spine did not complete (its own spine exited 1 without writing its completed-install record) — read its lines above; 'ccrc update --check' says where this box stands");
    expect(linkOf(home)).toBe(kept);
    expect(existsSync(join(home, '.ccrc', 'installed'))).toBe(false);
    expect(lastReport(home)).toMatchObject({
      phase: 'failed',
      detail: 'rollback to v1.0.0: the kept spine did not complete; its own spine exited 1 without writing its completed-install record',
    });
    expect(phasesOf(home)).not.toContain('checking');
    expect(calls(home).join('\n')).not.toMatch(/try-restart/);
  });

  it('a rollback by flip whose gate fails is not restored (D-3243): failed \'rollback to <tag>: gate: …\', exit 1, no restore phase, no sweep', () => {
    const { home } = flipBox('ccrc-rollback-flip-gate-');
    // /health keeps answering the version rolled away from.
    writeFileSync(join(home, 'fixture-health-pin'), 'v2.0.0\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — \/health at 127\.0\.0\.1:7788 answers v2\.0\.0, not v1\.0\.0$/m);
    expect(r.stderr).toMatch(/^ccrc: rollback: v1\.0\.0 was installed but failed its health gate \(gate: \/health at 127\.0\.0\.1:7788 answers v2\.0\.0, not v1\.0\.0\) — no automatic restore runs for a --from rollback run/m);
    expect(lastReport(home)).toMatchObject({
      phase: 'failed', detail: 'rollback to v1.0.0: gate: /health at 127.0.0.1:7788 answers v2.0.0, not v1.0.0', from: 'rollback',
    });
    expect(phasesOf(home)).not.toContain('restoring');
    expect(calls(home).join('\n')).not.toMatch(/try-restart/);
  });

  it('a rollback by flip whose gate reason carries a home path is REDACTED on stderr as cmd_update redacts it (F10)', () => {
    const { home } = flipBox('ccrc-rollback-flip-gate-redact-');
    // An env file that declares a host and no port: the gate's reason names
    // the file's ABSOLUTE path (`_box_server_addr`), on the box that wrote it.
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\nCCRC_HOST=127.0.0.1\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rollback: v1\.0\.0 was installed but failed its health gate \(gate: ~\/\.ccrc\/ccrc\.env declares CCRC_HOST but no CCRC_PORT\) — no automatic restore/m);
    expect(r.stderr, 'the box\'s absolute home reached stderr').not.toContain(home);
  });

  it('a kept version the flip cannot reach (the one rename refused) falls back to update\'s own re-install; that release\'s older spine gets no directory either, so it dies BEFORE anything is installed — the record as it was, no spine run', () => {
    const { home } = flipBox('ccrc-rollback-flip-rename-');
    // `_plat_ln_swap` refuses to clear a real directory at <link>.new (Task 1).
    mkdirSync(join(home, 'ccrc.new'));
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    const recBefore = fileText(join(home, '.ccrc', 'installed'));
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toContain('rollback: v1.0.0 could not be flipped to (the one rename that points $HOME/ccrc at $HOME/ccrc-versions/v1.0.0 failed) — rolling back by re-install instead');
    expect(r.stderr).toContain("could not give v1.0.0's older spine a directory of its own under $HOME/ccrc-versions — nothing was installed; $HOME/ccrc still points at v2.0.0");
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(recBefore);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    expect(existsSync(join(home, 'kept-spine-argv'))).toBe(false);
  });

  // R-B pins the OBSERVABLE: the report ends terminal. It cannot pin the
  // `UPD_REPORTING=1` the fall-through keeps — `cmd_update` opens its own
  // window again right after its own `_upd_lock`, so a reset to 0 in
  // `cmd_rollback` measures identically (mutation B1 in the task report).
  it('a flip that cannot be made falls through to update\'s own re-install, whose refusal closes update.json with a terminal `failed` — never the `installing` the flip path wrote (R-B)', () => {
    const { home } = flipBox('ccrc-rollback-flip-rename-report-');
    mkdirSync(join(home, 'ccrc.new'));   // `_plat_ln_swap` refuses to clear it: the flip cannot be made
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toContain('— rolling back by re-install instead');
    expect(phasesOf(home)[0]).toBe('installing');
    expect(lastReport(home)['phase'], 'the report was left non-terminal: a watchdog would read an updater that died').toBe('failed');
  });

  it('a FULL rollback by flip: the kept version\'s REAL spine re-places ~/.local/bin/ccd, the stamp and the record are the kept version\'s, then the sweep — and not one release URL is asked (Review Focus 1)', () => {
    const home = onKeptV1('ccrc-rollback-flip-full-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    // The kept copies, measured BEFORE this case's run. The spine a flip
    // back runs is this checkout's own, and its `_inst_installed` ends in
    // `_ver_keep_state install`, which copies the box's stamp and record
    // over these two files: a box-vs-kept-copy comparison AFTER the run is
    // equal by construction, whatever the bytes (a verified version
    // re-recorded `unsigned` would pass it). The snapshot is the subject.
    const keptStamp = fileText(join(v1, '.ccrc-stamp.json'));
    const keptRec = fileText(join(v1, '.ccrc-installed'));
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    const up = runUpdate(home);
    expect(up.code, `the move onto v2.0.0 must complete — stderr: ${up.stderr}\nstdout: ${up.stdout}`).toBe(0);
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
    expect(fileText(join(home, '.local', 'bin', 'ccd')), 'v2.0.0 carries the kept sentinel — the control is broken').not.toContain(CCD_SENTINEL);
    for (const f of ['curl-argv', 'update-json-writes', 'systemctl-calls']) rmSync(join(home, f), { force: true });
    writeFileSync(join(home, 'fixture-release-http'), '404\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain('rollback: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — no release-host question and no download');
    expect(localUrls(home)).toEqual([]);
    expect(linkOf(home)).toBe(v1);
    expect(fileText(join(home, '.local', 'bin', 'ccd'))).toBe(fileText(join(v1, 'ccd/ccd')));
    expect(fileText(join(home, '.local', 'bin', 'ccd'))).toContain(CCD_SENTINEL);
    expect(fileText(join(home, '.ccrc', 'build.json'))).toBe(keptStamp);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(keptRec);
    expect(fileText(join(v1, '.ccrc-stamp.json')), 'the kept stamp was rewritten').toBe(keptStamp);
    expect(fileText(join(v1, '.ccrc-installed')), 'the kept record was rewritten').toBe(keptRec);
    expect(fileText(join(home, '.ccrc', 'previous'))).toBe(`v1.0.0\n${V1_SHA}\n`);
    expect(fileText(join(home, '.ccrc', 'floor'))).toBe('v2.0.0\n');
    expect(lastReport(home)).toMatchObject({ phase: 'done', detail: 'rolled back by flip to v1.0.0', from: 'rollback' });
    if (process.platform === 'linux') {
      const c = calls(home);
      const restartAt = c.indexOf('--user try-restart claude-session@*');
      expect(restartAt, 'a rollback by flip must end in the supervisor sweep').toBeGreaterThan(c.indexOf('--user is-active ccrc.service'));
    }
  }, 60_000);

  it('a crashed migration is completed BEFORE the kept check, so a kept tag still reads kept — no release-host question, no download — and the flip\'s passed gate then removes ~/ccrc.migrating (W6 Task 3, D-3437)', () => {
    const { home, kept } = flipBox('ccrc-rollback-crashed-');
    // flipBox's v2.0.0 link turned into the crash pair a killed migration
    // leaves: the pre-versioned tree aside, the marker naming v2.0.0, no ~/ccrc.
    rmSync(join(home, 'ccrc'));
    mkdirSync(join(home, 'ccrc.migrating', 'server'), { recursive: true });
    writeFileSync(join(home, 'ccrc.migrating', 'server', 'OLD-MARKER'), 'the pre-versioned tree\n');
    writeFileSync(join(home, '.ccrc', 'migrating-to'), 'v2.0.0\n');
    // A rollback that asked the release host would refuse at exit 2.
    writeFileSync(join(home, 'fixture-release-http'), '404\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const lines = r.stdout.split('\n');
    const resumed = lines.indexOf('rollback: tree: completed a crashed migration — $HOME/ccrc was absent beside $HOME/ccrc.migrating; linked to $HOME/ccrc-versions/v2.0.0 (named by ~/.ccrc/migrating-to)');
    const keptAt = lines.indexOf('rollback: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — no release-host question and no download');
    expect(resumed, r.stdout).toBeGreaterThan(-1);
    expect(keptAt, 'the kept check read the crashed layout').toBeGreaterThan(resumed);
    expect(localUrls(home)).toEqual([]);
    expect(linkOf(home)).toBe(kept);
    expect(existsSync(join(home, 'ccrc.migrating')), 'the passed gate did not remove the old tree').toBe(false);
  }, 60_000);
});

describe('ccrc update: a spine older than W6 gets a directory named for its own tag (W6 Task 4)', () => {
  const NEW_SHA = 'newsha0000000000000000000000000000000000';
  /** An older release's spine, as the STUB shim runs it (`fixture-on-install`,
   *  wave 4 Task 6): it records whether the directory it was handed still
   *  claimed completeness; writes THROUGH $HOME/ccrc, as its `_inst_tree`'s
   *  rsync does; stamps the box with its release's stamp (its `_inst_stamp`);
   *  and — `fixture-stub-installed`, wave 4 Task 5 — writes the record. */
  const oldSpine = (home: string): void => {
    writeFileSync(join(home, 'fixture-old-stamp.json'), shippedStamp('v1.0.0', NEW_SHA));
    writeFileSync(join(home, 'fixture-on-install'), [
      'if [ -f "$HOME/ccrc/.ccrc-installed" ]; then echo present; else echo absent; fi > "$HOME/old-spine-saw-record"',
      'mkdir -p "$HOME/ccrc/server" && printf \'written by the older spine\\n\' > "$HOME/ccrc/server/WROTE-BY-OLD-SPINE"',
      'cp "$HOME/fixture-old-stamp.json" "$HOME/.ccrc/build.json"',
    ].join('\n') + '\n');
    writeFileSync(join(home, 'fixture-stub-installed'), 'yes\n');
  };
  const dotEntries = (home: string): string[] =>
    readdirSync(join(home, 'ccrc-versions')).filter((n) => n.startsWith('.'));

  it('with no directory for the older tag, ~/ccrc is pointed at a COPY of the running version (its kept state removed) before that spine runs — every write lands there, the version it replaces is byte-unchanged, and the copy is kept complete once the spine completes (Review Focus 5; D-3440, D-3428)', () => {
    const home = freshUpdateBox('ccrc-update-legacy-copy-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
    const before = treeDigest(cur);
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    oldSpine(home);
    const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    expect(r.stdout).toContain("update: tree: v1.0.0's spine predates versioned installs and writes through $HOME/ccrc — $HOME/ccrc now points at $HOME/ccrc-versions/v1.0.0 (a copy of v2.0.0) for it to write into");
    expect(linkOf(home)).toBe(v1);
    expect(treeDigest(cur), 'the older spine wrote into the version it replaced').toEqual(before);
    expect(existsSync(join(v1, 'server', 'WROTE-BY-OLD-SPINE'))).toBe(true);
    expect(fileText(join(home, 'old-spine-saw-record'))).toBe('absent\n');
    // The copy began as v2.0.0's tree…
    expect(fileText(join(v1, 'ccd/ccd'))).toBe(fileText(join(cur, 'ccd/ccd')));
    // …and is now v1.0.0's, kept complete by cmd_update after that spine.
    expect(fileText(join(v1, '.ccrc-stamp.json'))).toBe(fileText(join(home, '.ccrc', 'build.json')));
    expect(fileText(join(v1, '.ccrc-installed'))).toBe(`${NEW_SHA}\n`);
    expect(r.stdout).toMatch(/^update: versions: kept v1\.0\.0's stamp and install record in \$HOME\/ccrc-versions\/v1\.0\.0/m);
    expect(dotEntries(home)).toEqual([]);
    expect(lastReport(home)['phase']).toBe('done');
  });

  it('with a kept directory for the older tag, ~/ccrc is pointed at IT — which stops claiming completeness before that spine writes into it, and regains it only when the spine completes', () => {
    const home = freshUpdateBox('ccrc-update-legacy-kept-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
    const v1 = installVersionedTree(home, 'v1.0.0', { link: false, stamp: { sha: V1_SHA, version: 'v1.0.0' } });
    const before = treeDigest(cur);
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    oldSpine(home);
    const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain("update: tree: v1.0.0's spine predates versioned installs and writes through $HOME/ccrc — $HOME/ccrc now points at $HOME/ccrc-versions/v1.0.0 (kept) for it to write into");
    expect(linkOf(home)).toBe(v1);
    expect(fileText(join(home, 'old-spine-saw-record')), 'the older spine was handed a directory that still claimed completeness').toBe('absent\n');
    expect(existsSync(join(v1, 'server', 'WROTE-BY-OLD-SPINE'))).toBe(true);
    expect(treeDigest(cur)).toEqual(before);
    expect(fileText(join(v1, '.ccrc-installed'))).toBe(`${NEW_SHA}\n`);
    expect(dotEntries(home)).toEqual([]);
  });

  it('no directory is handed over when the staged ccrc IS versioned (it names BOX_VERSIONS_ROOT), nor for a same-tag reinstall, which writes in place (the controls; D-3426)', () => {
    const home = freshUpdateBox('ccrc-update-legacy-w6-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
    const tree = stubTree(home, { version: 'v1.0.0' });
    // A W6-shaped staged ccrc: the one line the check reads. The MANIFEST is
    // re-made after the edit, or the per-file verification refuses the tree.
    rmSync(join(tree, 'MANIFEST'));
    writeFileSync(join(tree, 'ccd', 'ccrc'),
      fileText(join(tree, 'ccd', 'ccrc')).replace('#!/bin/sh\n', '#!/bin/sh\nBOX_VERSIONS_ROOT="$HOME/ccrc-versions"\n'),
      { mode: 0o755 });
    writeManifest(tree);
    packRelease(home, tree, { tag: 'v1.0.0', latest: false });
    let r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/predates versioned installs/);
    expect(linkOf(home)).toBe(cur);
    // The same tag, an older spine: in place, no directory handed over.
    const same = freshUpdateBox('ccrc-update-legacy-same-');
    const sameCur = plantW6Box(same, 'v2.0.0', V2_SHA);
    packRelease(same, stubTree(same, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    r = runUpdate(same, ['--to', 'v2.0.0', '--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/predates versioned installs/);
    expect(linkOf(same)).toBe(sameCur);
  });

  it('when that directory cannot be made the update dies BEFORE anything is installed — ~/ccrc, the record and the caps as they were, the staged spine never run, no staging directory left', () => {
    const home = freshUpdateBox('ccrc-update-legacy-refused-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
    writeFileSync(join(home, '.ccrc', 'ccrc-caps'), 'os linux\nverify\n');
    const rec = fileText(join(home, '.ccrc', 'installed'));
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    const root = join(home, 'ccrc-versions');
    chmodSync(root, 0o555);   // `cp -a` cannot create `.v1.0.0.incoming.<pid>` (the suite never runs as root)
    const r = ((): Result => {
      try { return runUpdate(home, ['--to', 'v1.0.0', '--downgrade']); } finally { chmodSync(root, 0o755); }
    })();
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain("ccrc: could not give v1.0.0's older spine a directory of its own under $HOME/ccrc-versions — nothing was installed; $HOME/ccrc still points at v2.0.0");
    expect(linkOf(home)).toBe(cur);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(rec);
    expect(fileText(join(home, '.ccrc', 'ccrc-caps'))).toBe('os linux\nverify\n');
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    expect(dotEntries(home)).toEqual([]);
    expect(lastReport(home)['phase']).toBe('failed');
    expect(String(lastReport(home)['detail'])).toMatch(/^could not give v1\.0\.0's older spine a directory of its own/);
  });

  it('a symlink or a regular file at ~/ccrc-versions/<older tag> is not a directory ccrc placed: the update dies BEFORE anything is installed, and nothing is written through the link (the refusal the copy and kept cases never reach)', () => {
    for (const shape of ['symlink', 'file'] as const) {
      const home = freshUpdateBox(`ccrc-update-legacy-not-a-dir-${shape}-`);
      const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
      const rec = fileText(join(home, '.ccrc', 'installed'));
      const other = join(home, 'somewhere-else');
      mkdirSync(join(other, 'server'), { recursive: true });
      writeFileSync(join(other, 'server', 'THEIRS'), 'not a version\n');
      const otherBefore = treeDigest(other);
      if (shape === 'symlink') symlinkSync(other, join(home, 'ccrc-versions', 'v1.0.0'));
      else writeFileSync(join(home, 'ccrc-versions', 'v1.0.0'), 'a file\n');
      packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
      oldSpine(home);
      const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
      expect(r.code, `${shape}: stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stderr).toContain("ccrc: could not give v1.0.0's older spine a directory of its own under $HOME/ccrc-versions — nothing was installed; $HOME/ccrc still points at v2.0.0 ($HOME/ccrc-versions/v1.0.0 is not a directory ccrc placed)");
      expect(linkOf(home), shape).toBe(cur);
      expect(fileText(join(home, '.ccrc', 'installed')), shape).toBe(rec);
      expect(existsSync(join(home, 'staged-ccrc-argv')), `${shape}: the staged spine ran`).toBe(false);
      expect(treeDigest(other), `${shape}: something was written through the link`).toEqual(otherBefore);
      expect(dotEntries(home), shape).toEqual([]);
    }
  });

  // D-3459 (controller ruling R-A): `_upd_legacy_target` points ~/ccrc at the
  // older spine's own directory BEFORE that spine runs. A spine that then dies
  // WITHOUT replacing anything (cmd_update's moved=0 arm) must not leave the
  // link there: exit 1 says "nothing was replaced", and the next restart would
  // run the voided older version, or the copy, under the unchanged stamp.
  describe('an older spine that dies before replacing anything gives ~/ccrc back (D-3459)', () => {
    const DIED = /^ccrc: the staged install \(which ends with doctor\) exited 1 — spine died at /m;
    /** A linked v2.0.0 box asked to move to an older v1.0.0 whose spine (the
     *  STUB shim, exit 1, no directory of its own) dies; `kept` also plants a
     *  kept, complete v1.0.0 beside it. Returns the box, v2.0.0's root, and
     *  v2.0.0's digest before the run. */
    const dyingBox = (prefix: string, kept: boolean): { home: string; cur: string; before: Record<string, string> } => {
      const home = freshUpdateBox(prefix);
      const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
      if (kept) installVersionedTree(home, 'v1.0.0', { link: false, stamp: { sha: V1_SHA, version: 'v1.0.0' } });
      packRelease(home, stubTree(home, { version: 'v1.0.0', installExit: 1 }), { tag: 'v1.0.0', latest: false });
      return { home, cur, before: treeDigest(cur) };
    };

    it.each([['a copy of the running version', false], ['a kept directory', true]] as const)('a MARKED death before _inst_tree (%s): exit 1, ~/ccrc pointed back at the version it named before, that version byte-unchanged, and the sentence says so', (_what, kept) => {
      const { home, cur, before } = dyingBox('ccrc-update-legacy-back-marked-', kept);
      writeFileSync(join(home, 'fixture-install-step'), '_inst_node_id\n');
      const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stdout).toContain("update: tree: v1.0.0's spine predates versioned installs and writes through $HOME/ccrc");
      expect(r.stderr).toMatch(DIED);
      expect(r.stderr).toContain('spine died at _inst_node_id, before _inst_tree: nothing was replaced;');
      expect(r.stderr).toContain('$HOME/ccrc points back at $HOME/ccrc-versions/v2.0.0');
      expect(linkOf(home), 'the legacy flip was left in place').toBe(cur);
      expect(treeDigest(cur), 'the version this run replaces was written').toEqual(before);
      // The directory named for the older tag stays where it was put.
      expect(existsSync(join(home, 'ccrc-versions', 'v1.0.0'))).toBe(true);
      expect(existsSync(join(home, 'ccrc-versions', 'v1.0.0', '.ccrc-installed')), 'the older directory claims completeness').toBe(false);
      expect(lastReport(home)['phase']).toBe('failed');
    });

    it.each([['a copy of the running version', false], ['a kept directory', true]] as const)('an UNMARKED death (a spine older than W4 writes no step; its stamp did not move) reads the same (%s)', (_what, kept) => {
      const { home, cur, before } = dyingBox('ccrc-update-legacy-back-unmarked-', kept);
      const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(existsSync(join(home, '.ccrc', 'install-step')), 'the fixture wrote a marker — this case is about a spine that writes none').toBe(false);
      expect(r.stderr).toMatch(DIED);
      expect(r.stderr).toContain('spine died at an unrecorded step (no step marker; a spine older than W4 writes none)');
      expect(r.stderr).toContain('$HOME/ccrc points back at $HOME/ccrc-versions/v2.0.0');
      expect(linkOf(home), 'the legacy flip was left in place').toBe(cur);
      expect(treeDigest(cur)).toEqual(before);
      expect(lastReport(home)['phase']).toBe('failed');
    });

    it('a flip back that fails is named, never silent: ~/ccrc still points at the older tag\'s directory, and the sentence says flipping it back to v2.0.0 failed', () => {
      const { home } = dyingBox('ccrc-update-legacy-back-fails-', false);
      // A caps file to be cleared and (before the fix wave) put back, so its
      // absence below is a measurement and not a vacuous zero.
      writeFileSync(join(home, '.ccrc', 'ccrc-caps'), 'os linux\nverify\n');
      writeFileSync(join(home, 'fixture-install-step'), '_inst_node_id\n');
      // The spine leaves a real directory at <link>.new, which `_plat_ln_swap`
      // refuses to clear (Task 1): the legacy flip itself (before the spine)
      // succeeded, the flip back cannot.
      writeFileSync(join(home, 'fixture-on-install'), 'mkdir "$HOME/ccrc.new"\n');
      const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stderr).toMatch(DIED);
      expect(r.stderr).toContain('$HOME/ccrc still points at $HOME/ccrc-versions/v1.0.0, and flipping it back to v2.0.0 failed');
      expect(r.stderr).not.toContain('points back at');
      expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
      // Controller ruling (final-review fix wave, Step 0a): `~/ccrc` names the
      // OLDER tree, so a completed-install record (or caps) put back would vouch
      // for a build the box is not on, and a retry could be skipped as
      // converged. Neither file goes back, and the sentence says why.
      expect(existsSync(join(home, '.ccrc', 'installed')), 'the record was put back over a tree ~/ccrc no longer names').toBe(false);
      expect(existsSync(join(home, '.ccrc', 'ccrc-caps')), 'the caps were put back over a tree ~/ccrc no longer names').toBe(false);
      expect(r.stderr).toContain('; not put back — $HOME/ccrc names another tree: completed-install record, caps');
      expect(r.stderr).not.toContain('put back as they were');
    });

    it('a die BETWEEN the legacy flip and the staged spine flips back too (D-3459 amended): a directory squatting on ~/.ccrc/install-step refuses the marker clear, nothing is installed, and ~/ccrc is on the version it named before', () => {
      const { home, cur, before } = dyingBox('ccrc-update-legacy-back-clear-', false);
      mkdirSync(join(home, '.ccrc', 'install-step'), { recursive: true });
      const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      // The flip really happened first (the spine's directory was made) ...
      expect(r.stdout).toContain("update: tree: v1.0.0's spine predates versioned installs and writes through $HOME/ccrc");
      expect(r.stderr).toContain('cannot clear ~/.ccrc/install-step before the staged install');
      // ... and the die put it back, and said so.
      expect(r.stderr).toContain('Nothing was installed; $HOME/ccrc points back at $HOME/ccrc-versions/v2.0.0; put back as they were: completed-install record; remove it by hand and re-run');
      expect(existsSync(join(home, '.ccrc', 'installed')), 'the cleared record was not put back').toBe(true);
      expect(linkOf(home), 'the legacy flip was left in place').toBe(cur);
      expect(existsSync(join(home, 'staged-ccrc-argv')), 'a spine ran').toBe(false);
      expect(treeDigest(cur)).toEqual(before);
    });

    it('_upd_legacy_target never removes the directory ~/ccrc names: a swap that returned 1 with the link already on it (D-3424\'s concurrent plain install) dies and keeps that directory (F5)', () => {
      const home = freshUpdateBox('ccrc-update-legacy-swap-linked-');
      plantW6Box(home, 'v2.0.0', V2_SHA);
      const dir = join(home, 'ccrc-versions', 'v1.0.0');
      // A swap that links, THEN reports failure: the shape `_plat_ln_swap`
      // has when a concurrent install flips first.
      const r = sourcedCcrc(home,
        '_ver_layout; _plat_ln_swap() { ln -sfn "$1" "$2"; return 1; }; _upd_legacy_target v1.0.0; echo survived');
      expect(r.code, r.stderr).toBe(1);
      expect(r.stdout).not.toContain('survived');
      expect(r.stderr).toContain('could not give v1.0.0\'s older spine a directory of its own');
      expect(linkOf(home), 'the link names the directory').toBe(dir);
      expect(existsSync(join(dir, 'server')), 'the directory the link names was removed').toBe(true);
    });

    it('_upd_legacy_target\'s copy is moved onto an ABSENT name: a directory that appeared meanwhile makes the move fail, never nest the copy inside it (F5)', () => {
      const home = freshUpdateBox('ccrc-update-legacy-appeared-');
      const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
      const r = sourcedCcrc(home,
        '_ver_layout; cp() { command cp "$@"; mkdir -p "$HOME/ccrc-versions/v1.0.0/appeared"; }; _upd_legacy_target v1.0.0; echo survived');
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stdout).not.toContain('survived');
      expect(readdirSync(join(home, 'ccrc-versions', 'v1.0.0')), 'the copy was nested inside the directory that appeared').toEqual(['appeared']);
      expect(readdirSync(join(home, 'ccrc-versions')).sort(), 'the incoming copy was left behind').toEqual(['v1.0.0', 'v2.0.0']);
      expect(linkOf(home)).toBe(cur);
    });

    it('the moved=1 path is unchanged: a spine that dies AT or AFTER _inst_tree is gated, not flipped back (the control)', () => {
      const { home } = dyingBox('ccrc-update-legacy-back-moved-', false);
      writeFileSync(join(home, 'fixture-install-step'), '_inst_skills\n');
      const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stderr).not.toContain('points back at');
      expect(r.stderr).toContain('spine died at _inst_skills');
      expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
    });
  });
});

describe('ccrc update and rollback: refused before anything moves — a ~/ccrc this ccrc did not make, and a flip macOS cannot make (W6 Task 4)', () => {
  it('a foreign ~/ccrc (a link into a directory ccrc did not place) is refused by update BEFORE the backup, any download or any spine, and by rollback before the release-host question — the link and what it names byte-unchanged (D-3429, amended by Task 4)', () => {
    const home = freshUpdateBox('ccrc-update-foreign-');
    const other = join(home, 'operators-tree');
    mkdirSync(join(other, 'server'), { recursive: true });
    writeFileSync(join(other, 'server', 'MINE'), "the operator's own tree\n");
    symlinkSync(other, join(home, 'ccrc'));
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const before = treeDigest(other);
    // A published release whose spine writes THROUGH $HOME/ccrc — an older
    // spine, as the restore arms would have run it over the link.
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-on-install'),
      'mkdir -p "$HOME/ccrc/server" && printf \'written through the link\\n\' > "$HOME/ccrc/server/WROTE-THROUGH"\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain('ccrc: update: $HOME/ccrc is a link whose target is not a version directory under $HOME/ccrc-versions — refusing to place or flip a tree over something this ccrc did not make; nothing was downloaded or installed, and $HOME/ccrc and $HOME/ccrc-versions were not touched');
    expect(localUrls(home), 'the refused update reached the release host').toEqual([]);
    expect(r.stdout).not.toMatch(/^update: backup: /m);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'a spine ran over the foreign link').toBe(false);
    expect(lastReport(home)['phase']).toBe('failed');
    const writes = reportWrites(home).length;
    // The same box, asked to roll back: refused before the release host is
    // asked (so no exit 2), and before the lock (so no report is written).
    const rb = rollbackRun(home, ['--to', 'v1.0.0']);
    expect(rb.code, `stderr: ${rb.stderr}\nstdout: ${rb.stdout}`).toBe(1);
    expect(rb.stderr).toContain('ccrc: rollback: $HOME/ccrc is a link whose target is not a version directory under $HOME/ccrc-versions — refusing to place or flip a tree over something this ccrc did not make; nothing on this box was changed');
    expect(localUrls(home), 'the refused rollback asked the release host').toEqual([]);
    expect(reportWrites(home).length, 'the refused rollback wrote a report').toBe(writes);
    // Neither run touched the link, what it names, or the versions root.
    expect(readlinkSync(join(home, 'ccrc'))).toBe(other);
    expect(treeDigest(other)).toEqual(before);
    expect(existsSync(join(home, 'ccrc-versions'))).toBe(false);
  });

  it('_ver_flip_back with a stamp that cannot be put back returns 2 with the completed-install record already CLEARED: the box reads incomplete, never current on the old build (F6)', () => {
    const home = freshUpdateBox('ccrc-update-flip-stamp-fails-');
    plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    keptVersion(home, 'v1.0.0', V1_SHA);
    // A directory at the stamp's own name: `_plat_mv_notdir` refuses to put
    // the kept stamp over it, after the flip has already happened.
    rmSync(join(home, '.ccrc', 'build.json'));
    mkdirSync(join(home, '.ccrc', 'build.json'));
    const r = sourcedCcrc(home,
      `rc=0; _ver_flip_back v1.0.0 server rollback || rc=$?; printf 'rc=%s why=%s\\n' "$rc" "$VER_WHY"`);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('rc=')), r.stderr)
      .toEqual(['rc=2 why=its kept stamp could not be put back as this box\'s stamp']);
    expect(linkOf(home), 'the flip happened').toBe(join(home, 'ccrc-versions', 'v1.0.0'));
    expect(existsSync(join(home, '.ccrc', 'installed')), 'the box still reads current on the old build').toBe(false);
    expect(existsSync(join(home, 'kept-spine-argv')), 'the kept spine ran despite the failed stamp').toBe(false);
  });

  it('on macOS a python3 that is on PATH but does not RUN (the /usr/bin/python3 stub) is refused by _ver_can_flip too, with its own sentence — command -v is true there (F7; CCD_OS forced, sourced)', () => {
    const home = freshUpdateBox('ccrc-update-stubpy-probe-');
    const bin = join(home, 'stub-py-bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'python3'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const r = sourcedCcrc(home,
      `for os in darwin linux; do ( CCD_OS=$os; PATH='${bin}':"$PATH"; rc=0; _ver_can_flip || rc=$?; printf '%s rc=%s why=%s\\n' "$os" "$rc" "$VER_WHY" ); done`);
    expect(r.stdout.split('\n').filter((l) => / rc=/.test(l)), r.stderr).toEqual([
      'darwin rc=1 why=python3 is on PATH but does not run (on macOS /usr/bin/python3 is only a stub until the Xcode Command Line Tools are installed) — the $HOME/ccrc flip is one rename(2) through os.replace; install them: xcode-select --install',
      'linux rc=0 why=',
    ]);
  });

  it('on macOS without python3 the two flips this ccrc makes OUTSIDE a spine refuse before anything moves, naming python3 — never "the one rename failed" (_ver_can_flip, _ver_flip_back, _upd_legacy_target; CCD_OS forced, sourced; D-3419, amended by Task 4)', () => {
    // From this assignment on the sourced shell has builtins only.
    const NOPY = 'PATH="$HOME/no-such-bin"';
    const PY_WHY = 'python3 is not on PATH — on macOS the $HOME/ccrc flip is one rename(2) through os.replace; install the Xcode Command Line Tools: xcode-select --install';
    // The probe: Darwin only.
    let home = freshUpdateBox('ccrc-update-nopy-probe-');
    let r = sourcedCcrc(home,
      `for os in darwin linux; do ( CCD_OS=$os; ${NOPY}; rc=0; _ver_can_flip || rc=$?; printf '%s rc=%s why=%s\\n' "$os" "$rc" "$VER_WHY" ); done`);
    expect(r.stdout.split('\n').filter((l) => / rc=/.test(l)), r.stderr).toEqual([`darwin rc=1 why=${PY_WHY}`, 'linux rc=0 why=']);
    // `_ver_flip_back`: rc 1, nothing changed — which arm 1 reports as
    // `could not flip to <prev> (<why>)` and a rollback as `could not be
    // flipped to (<why>)`, python3 named in both.
    home = freshUpdateBox('ccrc-update-nopy-flip-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    keptVersion(home, 'v1.0.0', V1_SHA);
    const rec = fileText(join(home, '.ccrc', 'installed'));
    r = sourcedCcrc(home,
      `CCD_OS=darwin; ${NOPY}; rc=0; _ver_flip_back v1.0.0 server rollback || rc=$?; printf 'rc=%s why=%s\\n' "$rc" "$VER_WHY"`);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('rc=')), r.stderr).toEqual([`rc=1 why=${PY_WHY}`]);
    expect(linkOf(home)).toBe(cur);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(rec);
    expect(existsSync(join(home, 'kept-spine-argv'))).toBe(false);
    // `_upd_legacy_target`: dies with the refusal, python3 named, before any copy.
    home = freshUpdateBox('ccrc-update-nopy-legacy-');
    const cur2 = plantW6Box(home, 'v2.0.0', V2_SHA);
    r = sourcedCcrc(home, `_ver_layout; CCD_OS=darwin; ${NOPY}; _upd_legacy_target v1.0.0; echo survived`);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toContain(`ccrc: could not give v1.0.0's older spine a directory of its own under $HOME/ccrc-versions — nothing was installed; $HOME/ccrc still points at v2.0.0 (${PY_WHY})`);
    expect(r.stdout).not.toContain('survived');
    expect(linkOf(home)).toBe(cur2);
    expect(readdirSync(join(home, 'ccrc-versions')).sort()).toEqual(['v2.0.0']);
  });
});

// ── ccrc versions, and the GC (design 2026-09-20 §11 "GC"; W6 Task 5) ────
// Spec §18 "GC never removes a needed version", one case per guard, each with
// its CONTROL in the same run: CCRC_VERSIONS_KEEP=0 makes every complete,
// unprotected version prunable, so a planted version the guard does not
// cover is removed beside the one it does. The two units read STOPPED
// (`fixture-unit-state`, wave 4 Task 5's knob; on macOS the launchctl stub
// answers "no such job" for a job nobody bootstrapped) in every case but the
// running guard's, so no case is held green by a second guard.
describe('ccrc versions, and the GC that never removes a needed version (W6 Task 5)', () => {
  const REAL_READLINK = realPath('readlink');
  const REAL_STAT = realPath('stat');
  const REAL_RM = realPath('rm');
  const lit = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionDirs = (home: string): string[] => readdirSync(join(home, 'ccrc-versions')).sort();
  const stopUnits = (home: string): void => writeFileSync(join(home, 'fixture-unit-state'), 'inactive\n');
  const plantPrevious = (home: string, text: string): void => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'previous'), text);
  };

  /** A W6 box: each of `names` placed COMPLETE under ~/ccrc-versions, the
   *  FIRST linked from ~/ccrc; each kept install record's mtime set so the
   *  order given IS the age order (`names[1]` the newest of the rest) —
   *  `_ver_list` orders by that mtime, never by name. `incomplete` adds
   *  directories with no kept record. The box stamp names the pointed-at
   *  version, as a completed install leaves it. */
  function versionedBox(prefix: string, names: string[], incomplete: string[] = []): string {
    const home = freshUpdateBox(prefix);
    names.forEach((n, i) => {
      const stamp = /^v\d/.test(n) ? { sha: 'b'.repeat(40), version: n } : { sha: 'b'.repeat(40) };
      const root = installVersionedTree(home, n, { link: i === 0, stamp });
      const t = 1_800_000_000 - i * 100;
      utimesSync(join(root, '.ccrc-installed'), t, t);
    });
    for (const n of incomplete) installVersionedTree(home, n, { link: false, complete: false });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp(names[0]!, 'b'.repeat(40)));
    return home;
  }

  /** `ccrc versions` against the fixture box, in `runUpdate`'s environment and
   *  order (env built, then the doctor stubs re-planted). */
  function runVersions(home: string, args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): Result {
    const env = { ...updateEnv(home), ...extraEnv };
    replantDoctorStubs(home);
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'versions', ...args], { env, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  /** `readlink -f` answering EMPTY, rc 0 — what BSD's readlink before macOS
   *  12.3 (no -f) leaves a caller holding. Planted in the replant directory;
   *  every other readlink argv is the real binary. */
  function plantReadlinkFEmpty(home: string): void {
    writeFileSync(join(home, 'doctor-stubs', 'readlink'),
      '#!/bin/sh\n'
      + 'if [ "$1" = "-f" ] && [ -f "$HOME/fixture-readlink-f-empty" ]; then exit 0; fi\n'
      + `exec ${REAL_READLINK} "$@"\n`, { mode: 0o755 });
    writeFileSync(join(home, 'fixture-readlink-f-empty'), 'yes\n');
  }

  const LISTED = ['v1.0.4', 'v1.0.3', 'untagged-0123456789ab', 'v1.0.2', 'v1.0.1', 'v1.0.0'];
  const LAST_LINE = 'versions: 7 kept tree(s) under $HOME/ccrc-versions; CCRC_VERSIONS_KEEP=2 plus the protected set '
    + "(pointed-at, previous, the projection's desired tags, running units) — 'ccrc versions --prune' removes the prunable ones";

  it('lists every kept tree newest first, marks the pointed-at one, says why each is kept — and takes no lock', () => {
    // untagged-… sits BETWEEN v1.0.3 and v1.0.2 by age: neither name order puts it there.
    const home = versionedBox('ccrc-versions-list-', LISTED, ['unstamped-fedcba987654']);
    stopUnits(home);
    plantPrevious(home, `v1.0.1\n${'c'.repeat(40)}\n`);
    const before = versionDirs(home);
    const r = runVersions(home, [], { CCRC_VERSIONS_KEEP: '2' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout.split('\n')).toEqual([
      'versions: $HOME/ccrc -> $HOME/ccrc-versions/v1.0.4',
      '  * v1.0.4  complete  kept: pointed-at',
      '    v1.0.3  complete  kept: newest 2',
      '    untagged-0123456789ab  complete  kept: newest 2',
      '    v1.0.2  complete  prunable',
      '    v1.0.1  complete  kept: previous',
      '    v1.0.0  complete  prunable',
      '    unstamped-fedcba987654  incomplete  prunable by --prune only',
      LAST_LINE,
      '',
    ]);
    expect(versionDirs(home)).toEqual(before);
    expect(existsSync(join(home, '.ccrc', 'update.lock'))).toBe(false);
    // A stamp that disagrees with the pointed-at name is said, not hidden:
    // something (deploy.sh, a pre-W6 spine) wrote through the link.
    writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp('v1.0.3', 'b'.repeat(40)));
    const s = runVersions(home, [], { CCRC_VERSIONS_KEEP: '2' });
    expect(s.stdout.split('\n')[0]).toBe(
      'versions: $HOME/ccrc -> $HOME/ccrc-versions/v1.0.4 (its stamp reads v1.0.3 — something wrote through $HOME/ccrc)');
  });

  it('--prune removes only what nothing needs — complete ones past the newest N, and the incomplete — then lists what is left', () => {
    const home = versionedBox('ccrc-versions-prune-', LISTED, ['unstamped-fedcba987654']);
    stopUnits(home);
    plantPrevious(home, `v1.0.1\n${'c'.repeat(40)}\n`);
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '2' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.2 \(complete, not among the newest 2\)$/m);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 2\)$/m);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/unstamped-fedcba987654 \(incomplete\)$/m);
    expect(versionDirs(home)).toEqual(['untagged-0123456789ab', 'v1.0.1', 'v1.0.3', 'v1.0.4']);
    expect(r.stdout).toMatch(/^versions: 4 kept tree\(s\) under \$HOME\/ccrc-versions;/m);
    // Nothing left to remove: the second prune says so and removes nothing.
    const again = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '2' });
    expect(again.code).toBe(0);
    expect(again.stdout).toMatch(/^versions: nothing to prune — every kept tree is protected or among the newest 2$/m);
    expect(versionDirs(home)).toEqual(['untagged-0123456789ab', 'v1.0.1', 'v1.0.3', 'v1.0.4']);
  });

  it('the argument surface: -h is usage at exit 0; anything else is exit 2; a non-numeric CCRC_VERSIONS_KEEP refuses at exit 1 before the lock', () => {
    const home = versionedBox('ccrc-versions-args-', ['v1.0.1', 'v1.0.0']);
    let r = runVersions(home, ['-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^ {2}versions {2}list the kept release trees under ~\/ccrc-versions \(\* marks the one ~\/ccrc points at\);$/m);
    r = runVersions(home, ['--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --bogus/m);
    r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: 'three' });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: versions: CCRC_VERSIONS_KEEP must be a number \(got a non-numeric value\) — nothing was pruned$/m);
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
    expect(existsSync(join(home, '.ccrc', 'update.lock'))).toBe(false);
    // F8: listing is exit 0 by the exit table — a bad knob WARNs and lists, verdicts unmeasured.
    r = runVersions(home, [], { CCRC_VERSIONS_KEEP: 'three' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^versions: WARN: CCRC_VERSIONS_KEEP is not a number — listing only; nothing would be pruned$/m);
    expect(r.stdout).toMatch(/^ {2}\* v1\.0\.1 {2}complete {2}kept: CCRC_VERSIONS_KEEP is not a number$/m);
    expect(r.stdout).toMatch(/^ {2}  v1\.0\.0 {2}complete {2}kept: CCRC_VERSIONS_KEEP is not a number$/m);
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
  });

  it('a box whose ~/ccrc is still a directory: nothing is versioned, and --prune removes nothing', () => {
    const home = freshUpdateBox('ccrc-versions-dir-');
    plantOldBox(home, { version: 'v1.0.0' });
    let r = runVersions(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^versions: \$HOME\/ccrc is a directory — not versioned yet; the next ccrc install or update migrates it$/m);
    expect(r.stdout).toMatch(/^versions: 0 kept tree\(s\) under \$HOME\/ccrc-versions;/m);
    r = runVersions(home, ['--prune']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^versions: nothing to prune — \$HOME\/ccrc is not versioned \(directory\)$/m);
    expect(existsSync(join(home, 'ccrc', 'server', 'OLD-MARKER'))).toBe(true);
  });

  it('a crashed migration is said with a command that can complete it — the placed version\'s own ccrc by its path, never the shim on PATH, never deploy.sh', () => {
    const home = freshUpdateBox('ccrc-versions-crashed-');
    mkdirSync(join(home, 'ccrc.migrating', 'server'), { recursive: true });
    installVersionedTree(home, 'v1.0.0', { link: false, stamp: { sha: 'b'.repeat(40), version: 'v1.0.0' } });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'migrating-to'), 'v1.0.0\n');
    let r = runVersions(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')[0]).toBe('versions: a migration crashed — $HOME/ccrc is absent beside $HOME/ccrc.migrating; '
      + 'run bash $HOME/ccrc-versions/v1.0.0/ccd/ccrc install (or bash install.sh from a ccrc checkout) to complete it '
      + '— the ccrc on PATH cannot run until then, and deploy.sh would place a second tree beside it');
    expect(r.stdout).toMatch(/^ {4}v1\.0\.0 {2}complete {2}kept: nothing is pruned while \$HOME\/ccrc reads crashed$/m);
    // A marker that names no placed version: no install can complete it, and
    // the line says the by-hand remedies instead of a command that would die.
    writeFileSync(join(home, '.ccrc', 'migrating-to'), 'v9.9.9\n');
    r = runVersions(home);
    expect(r.stdout.split('\n')[0]).toBe('versions: a migration crashed — $HOME/ccrc is absent beside $HOME/ccrc.migrating; '
      + '~/.ccrc/migrating-to names no placed version, so no install can complete it — link it by hand '
      + '(ln -s $HOME/ccrc-versions/<name> $HOME/ccrc) or move it back (mv $HOME/ccrc.migrating $HOME/ccrc); '
      + 'not deploy.sh, which would place a second tree beside it');
    // The listing reads; it repairs nothing.
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
  });

  it('guard — the pointed-at version is never pruned (spec §18)', () => {
    const home = versionedBox('ccrc-versions-g-current-', ['v1.0.1', 'v1.0.0']);
    stopUnits(home);
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // the control: a complete version nothing protects IS removed
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 0\)$/m);
    expect(r.stdout).toMatch(/^ {2}\* v1\.0\.1 {2}complete {2}kept: pointed-at$/m);
    expect(versionDirs(home)).toEqual(['v1.0.1']);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(home, 'ccrc', 'ccd', 'ccrc'))).toBe(true);
  });

  it('guard — the previous version (~/.ccrc/previous) is never pruned (spec §18)', () => {
    const home = versionedBox('ccrc-versions-g-prev-', ['v1.0.2', 'v1.0.1', 'v1.0.0']);
    stopUnits(home);
    plantPrevious(home, `v1.0.0\n${'c'.repeat(40)}\n`);
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.1 \(complete, not among the newest 0\)$/m);
    expect(r.stdout).toMatch(/^ {4}v1\.0\.0 {2}complete {2}kept: previous$/m);
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.2']);
    // An UNTAGGED previous (wave 4's D-3231: line 1 `untagged`, line 2 the old
    // stamp's sha) names the directory `_inst_version_name` gave that build,
    // `untagged-<sha12>` (Task 8's R4 writes exactly this). It is kept too,
    // beside the same control.
    const u = versionedBox('ccrc-versions-g-prev-untagged-', ['v1.0.2', 'untagged-0123456789ab', 'v1.0.0']);
    stopUnits(u);
    plantPrevious(u, `untagged\n0123456789ab${'c'.repeat(28)}\n`);
    const s = runVersions(u, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(s.code, `stderr: ${s.stderr}\nstdout: ${s.stdout}`).toBe(0);
    expect(s.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 0\)$/m);
    expect(s.stdout).toMatch(/^ {4}untagged-0123456789ab {2}complete {2}kept: previous$/m);
    expect(versionDirs(u)).toEqual(['untagged-0123456789ab', 'v1.0.2']);
  });

  // PLATFORM-ONLY: a macOS box is never centrally managed (decision 17) —
  // `_upd_intent_state` answers not-configured there whatever the file says,
  // so its projection names no tag to protect. What macOS keeps is pinned by
  // the pointed-at and previous cases above, which run on both.
  itLinux('guard — every tag the control plane projection names is never pruned (spec §18)', () => {
    const home = versionedBox('ccrc-versions-g-desired-', ['v1.0.4', 'v1.0.3', 'v1.0.2', 'v1.0.1', 'v1.0.0']);
    stopUnits(home);
    plantRole(home, 'fleet');
    plantSyncTimer(home);
    plantClock(home);
    plantIntent(home, intentDoc({ desired: 'v1.0.2', desiredStable: 'v1.0.2', desiredDev: 'v1.0.1' }));
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 0\)$/m);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.3 \(complete, not among the newest 0\)$/m);
    expect(r.stdout).toMatch(/^ {4}v1\.0\.2 {2}complete {2}kept: desired desired-stable$/m);
    expect(r.stdout).toMatch(/^ {4}v1\.0\.1 {2}complete {2}kept: desired-dev$/m);
    expect(versionDirs(home)).toEqual(['v1.0.1', 'v1.0.2', 'v1.0.4']);
  });

  // PLATFORM-ONLY: this is systemd's `show -p ExecStart` struct. The macOS
  // arm reads the job's plist instead; the case after this one measures that
  // arm on either platform by forcing CCD_OS in a sourced shell.
  itLinux('guard — a version a running unit argv[] names directly is never pruned, and path= is never what is read (spec §18)', () => {
    const home = versionedBox('ccrc-versions-g-running-', ['v1.0.2', 'v1.0.1', 'v1.0.0']);
    // Both units RUN (the stub's default answer). The agent's command names
    // v1.0.1's own path — a unit hand-edited to run from a physical path.
    writeFileSync(join(home, 'fixture-execstart-ccrc-agent.service'),
      `/usr/bin/env node ${home}/ccrc-versions/v1.0.1/agent/dist/agent/src/index.js\n`);
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 0\)$/m);
    expect(r.stdout).toMatch(/^ {4}v1\.0\.1 {2}complete {2}kept: running$/m);
    // ccrc.service's command names $HOME/ccrc/…, which resolves through the link
    expect(r.stdout).toMatch(/^ {2}\* v1\.0\.2 {2}complete {2}kept: pointed-at running$/m);
    expect(versionDirs(home)).toEqual(['v1.0.1', 'v1.0.2']);
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8').split('\n');
    expect(calls).toContain('--user show -p ExecStart ccrc.service');
    expect(calls).toContain('--user show -p ExecStart ccrc-agent.service');
  });

  it('the Darwin arm reads the job ProgramArguments through plutil, the quotes round the entry path stripped — and an empty answer is unmeasured', () => {
    const home = versionedBox('ccrc-versions-darwin-arm-', ['v1.0.2', 'v1.0.1']);
    const entry = `${home}/ccrc-versions/v1.0.1/server/dist/server/src/index.js`;
    // What `plutil -convert json` prints for `_inst_plist_server`'s job (its
    // `&amp;&amp;` is `&&` once parsed; the entry path single-quoted).
    writeFileSync(join(home, 'fixture-plist.json'), `${JSON.stringify({
      Label: 'app.ccrc.ccrc',
      ProgramArguments: ['/bin/bash', '-c',
        `set -a; [ -f '${home}/.ccrc/ccrc.env' ] && . '${home}/.ccrc/ccrc.env'; `
        + `[ -f '${home}/.ccrc/exposure.env' ] && . '${home}/.ccrc/exposure.env'; set +a; `
        + `exec /usr/bin/env node '${entry}'`],
    })}\n`);
    const probe = (plutil: string): Result => sourcedCcrc(home, [
      'CCD_OS=darwin',
      plutil,
      '_svc_is_active() { case "$1" in ccrc.service) printf active ;; *) printf inactive ;; esac; }',
      '_ver_running_names; rc=$?',
      'printf "rc=%s running=[%s] why=[%s]\\n" "$rc" "${VER_RUNNING[*]}" "$VER_WHY"',
    ].join('\n'));
    let r = probe('plutil() { [ "$1 $2 $3 $4" = "-convert json -o -" ] && cat "$HOME/fixture-plist.json"; }');
    expect(r.stdout, r.stderr).toBe('rc=0 running=[v1.0.1] why=[]\n');
    r = probe('plutil() { return 0; }');
    expect(r.stdout, r.stderr).toBe(
      "rc=1 running=[] why=[ccrc.service is running and its job file's ProgramArguments could not be read (plutil -convert json)]\n");
  });

  // PLATFORM-ONLY: every input here is one only a Linux box's reader asks —
  // systemd's is-active and ExecStart, `readlink -f` on the tokens those
  // yield, and a projection (macOS is never centrally managed, decision 17).
  // The input both platforms read, ~/.ccrc/previous, is the next case.
  itLinux('an input that cannot be measured prunes nothing, and the prune says which (unit state, ExecStart, readlink -f, the projection)', () => {
    const fixtures: Array<[string, (h: string) => void, (h: string) => string]> = [
      ['unit-state', (h) => writeFileSync(join(h, 'fixture-unit-state'), ''),
        () => 'the service manager did not say whether ccrc.service is running (no answer)'],
      ['execstart', (h) => writeFileSync(join(h, 'fixture-execstart-raw'),
        `ExecStart=/usr/bin/env node ${h}/ccrc/server/dist/server/src/index.js\n`),
      () => "ccrc.service's ExecStart did not parse as systemd's struct form"],
      ['readlink', (h) => plantReadlinkFEmpty(h),
        (h) => `ccrc.service's command names ${h}/ccrc/server/dist/server/src/index.js, which readlink -f could not resolve`],
      ['projection', (h) => {
        stopUnits(h); plantRole(h, 'fleet'); plantSyncTimer(h); plantClock(h);
        plantIntent(h, intentDoc({ issued: String(INTENT_NOW - 2000), lease: String(INTENT_NOW - 1000) }));
      }, () => "the control plane's projection is stale (its lease ended 1000s ago) — its desired tags cannot be read"],
    ];
    for (const [label, plant, why] of fixtures) {
      const home = versionedBox(`ccrc-versions-unmeasured-${label}-`, ['v1.0.1', 'v1.0.0']);
      plant(home);
      const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
      expect(r.code, `${label}: ${r.stdout}${r.stderr}`).toBe(1);
      expect(r.stdout, label).toMatch(new RegExp(`^versions: prune skipped — ${lit(why(home))}; nothing was removed$`, 'm'));
      expect(r.stdout, label).toMatch(/^ {4}v1\.0\.0 {2}complete {2}kept: unmeasured$/m);
      expect(versionDirs(home), label).toEqual(['v1.0.0', 'v1.0.1']);
    }
  });

  // Both platforms: `_plat_mtime` is `stat -c %Y` or `stat -f %m`, and the
  // shim below fails either spelling the same way. It is not a fifth row of
  // the itLinux table above, so the macOS leg measures it too.
  it('a kept install record whose mtime cannot be read prunes nothing — the keep-N order would be a guess', () => {
    const home = versionedBox('ccrc-versions-unmeasured-mtime-', ['v1.0.1', 'v1.0.0']);
    stopUnits(home);
    // `stat` that fails for a kept install record, and only for one; every
    // other argv is the real binary (plantReadlinkFEmpty's idiom).
    writeFileSync(join(home, 'doctor-stubs', 'stat'),
      '#!/bin/sh\n'
      + 'for a in "$@"; do last="$a"; done\n'
      + 'if [ -f "$HOME/fixture-stat-record-fails" ]; then\n'
      + '  case "$last" in */.ccrc-installed) echo "stat: cannot statx \'$last\': Permission denied" >&2; exit 1 ;; esac\n'
      + 'fi\n'
      + `exec ${REAL_STAT} "$@"\n`, { mode: 0o755 });
    writeFileSync(join(home, 'fixture-stat-record-fails'), 'yes\n');
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `${r.stdout}${r.stderr}`).toBe(1);
    // The glob runs in name order and VER_WHY keeps the LAST record that failed.
    expect(r.stdout).toMatch(/^versions: prune skipped — the kept install record of v1\.0\.1 has no readable mtime; nothing was removed$/m);
    expect(r.stdout).toMatch(/^ {4}v1\.0\.0 {2}complete {2}kept: unmeasured$/m);
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
  });

  it('a malformed ~/.ccrc/previous prunes nothing — by hand or automatically', () => {
    const home = versionedBox('ccrc-versions-prev-bad-', ['v1.0.1', 'v1.0.0']);
    stopUnits(home);
    plantPrevious(home, 'garbage\n');
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, r.stdout).toBe(1);
    expect(r.stdout).toMatch(/^versions: prune skipped — ~\/\.ccrc\/previous is unreadable or malformed; nothing was removed$/m);
    const a = sourcedCcrc(home, 'CCRC_VERSIONS_KEEP=0; _ver_gc update auto; echo "rc=$?"');
    expect(a.stdout, a.stderr).toBe('update: versions: WARN: nothing pruned — ~/.ccrc/previous is unreadable or malformed\nrc=1\n');
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
  });

  it('the automatic GC is silent, and measures nothing, when nothing is prunable whatever is protected', () => {
    const home = versionedBox('ccrc-versions-silent-', ['v1.0.1', 'v1.0.0']);
    // an input that WOULD stop a prune that measured it
    plantPrevious(home, 'garbage\n');
    const quiet = sourcedCcrc(home, '_ver_gc install auto; echo "rc=$?"');
    expect(quiet.stdout, quiet.stderr).toBe('rc=0\n');
    // the control: with one complete version more than CCRC_VERSIONS_KEEP, the
    // same box measures — and says why it stops
    const loud = sourcedCcrc(home, 'CCRC_VERSIONS_KEEP=0; _ver_gc install auto; echo "rc=$?"');
    expect(loud.stdout, loud.stderr).toBe('install: versions: WARN: nothing pruned — ~/.ccrc/previous is unreadable or malformed\nrc=1\n');
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
  });

  it('the automatic GC never removes an incomplete version — a plain install may be placing it; --prune does', () => {
    const home = versionedBox('ccrc-versions-incomplete-', ['v1.0.2', 'v1.0.1'], ['untagged-0123456789ab']);
    stopUnits(home);
    const a = sourcedCcrc(home, 'CCRC_VERSIONS_KEEP=0; _ver_gc install auto; echo "rc=$?"');
    expect(a.stdout, a.stderr).toBe('install: versions: pruned $HOME/ccrc-versions/v1.0.1 (complete, not among the newest 0)\nrc=0\n');
    expect(versionDirs(home)).toEqual(['untagged-0123456789ab', 'v1.0.2']);
    const p = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(p.code, p.stdout).toBe(0);
    expect(p.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/untagged-0123456789ab \(incomplete\)$/m);
    expect(versionDirs(home)).toEqual(['v1.0.2']);
  });

  // D-3460: the prune renames the version out of every reader's view in ONE
  // rename, THEN deletes. The `rm` stub is planted in the replant directory
  // (the seam `plantReadlinkFEmpty` and the `stat` shim use): for a path under
  // ccrc-versions/ it deletes `server/node_modules` and exits 1 — a removal
  // that dies part-way, in readdir order, with the kept record still standing.
  it('a prune whose rm dies part-way leaves NO half-deleted version under a version name — it was renamed out of view first (D-3460)', () => {
    const home = versionedBox('ccrc-versions-rm-dies-', ['v1.0.1', 'v1.0.0']);
    stopUnits(home);
    mkdirSync(join(home, 'ccrc-versions', 'v1.0.0', 'server', 'node_modules'), { recursive: true });
    writeFileSync(join(home, 'ccrc-versions', 'v1.0.0', 'server', 'node_modules', 'x'), 'x\n');
    writeFileSync(join(home, 'doctor-stubs', 'rm'),
      '#!/bin/sh\n'
      + 'for a in "$@"; do last="$a"; done\n'
      + 'case "$last" in */ccrc-versions/*)\n'
      + `  ${REAL_RM} -rf -- "$last/server/node_modules"; echo "rm: cannot remove '$last': fixture" >&2; exit 1 ;;\n`
      + 'esac\n'
      + `exec ${REAL_RM} "$@"\n`, { mode: 0o755 });
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toMatch(/^versions: could not finish pruning \$HOME\/ccrc-versions\/v1\.0\.0 — it is already out of the version list; its remains are at \$HOME\/ccrc-versions\/\.pruning-v1\.0\.0\.[0-9]+, which the next prune removes$/m);
    // not listed, and no directory under the version's own name
    expect(r.stdout).not.toMatch(/^ {4}v1\.0\.0 /m);
    const dirs = versionDirs(home);
    expect(dirs.filter((d) => d === 'v1.0.0')).toEqual([]);
    const husk = dirs.filter((d) => /^\.pruning-v1\.0\.0\.[0-9]+$/.test(d));
    expect(husk, dirs.join(' ')).toHaveLength(1);
    // the husk is what the stub left: node_modules gone, the kept record still there
    expect(existsSync(join(home, 'ccrc-versions', husk[0]!, 'server', 'node_modules'))).toBe(false);
    expect(existsSync(join(home, 'ccrc-versions', husk[0]!, '.ccrc-installed'))).toBe(true);
    expect(dirs).toContain('v1.0.1');
  });

  it('the next prune finishes a leftover whose process is dead, and never touches one whose process is alive (D-3460)', () => {
    const home = versionedBox('ccrc-versions-leftover-', ['v1.0.1', 'v1.0.0']);
    stopUnits(home);
    const DEAD = 999999;
    expect(() => process.kill(DEAD, 0), 'the dead-pid fixture needs a pid nothing holds').toThrow();
    const dead = `.pruning-v0.0.1.${DEAD}`;
    const live = `.pruning-v0.0.1.${process.pid}`;
    for (const d of [dead, live]) {
      mkdirSync(join(home, 'ccrc-versions', d, 'server'), { recursive: true });
      writeFileSync(join(home, 'ccrc-versions', d, '.ccrc-installed'), 'x\n');
    }
    // a list-only run never sweeps
    const l = runVersions(home, [], { CCRC_VERSIONS_KEEP: '0' });
    expect(l.code, l.stderr).toBe(0);
    expect(versionDirs(home)).toContain(dead);
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`^versions: removed \\$HOME/ccrc-versions/${lit(dead)} \\(`, 'm'));
    expect(r.stdout).not.toContain(live);
    expect(versionDirs(home)).toEqual([live, 'v1.0.1']);
    // and neither one was ever listed as a version
    expect(r.stdout).not.toMatch(/^ {4}\.pruning/m);
  });

  it('--prune takes the update lock: a real holder refuses it at exit 1 and nothing is removed', () => {
    const home = versionedBox('ccrc-versions-lock-', ['v1.0.1', 'v1.0.0']);
    stopUnits(home);
    const lock = join(home, '.ccrc', 'update.lock');
    const holder = spawn('flock', [lock, 'sleep', '30'], { stdio: 'ignore', detached: true });
    try {
      // HELD is measured, never assumed from the spawn: a fresh flock -n fails.
      let held = false;
      for (let i = 0; i < 100 && !held; i++) {
        held = existsSync(lock) && spawnSync('flock', ['-n', lock, 'true']).status === 1;
        if (!held) spawnSync('sleep', ['0.05']);
      }
      expect(held).toBe(true);
      const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
      expect(r.code, r.stdout).toBe(1);
      expect(r.stderr).toMatch(/^ccrc: update: another update holds ~\/\.ccrc\/update\.lock \(/m);
      expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
    } finally {
      if (holder.pid !== undefined) {
        try { process.kill(-holder.pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }
  });

  it('_ver_list restores the caller nullglob, whichever way it was set', () => {
    const home = versionedBox('ccrc-versions-nullglob-', ['v1.0.1', 'v1.0.0']);
    const r = sourcedCcrc(home, [
      'shopt -u nullglob; _ver_list; shopt -q nullglob && echo on || echo off',
      'shopt -s nullglob; _ver_list; shopt -q nullglob && echo on || echo off',
      'printf "%s\\n" "${VER_NAMES[*]}"',
    ].join('\n'));
    expect(r.stdout, r.stderr).toBe('off\non\nv1.0.1 v1.0.0\n');
  });

  // PLATFORM-ONLY: on macOS the running read is plutil over the job's plist,
  // which this harness's plutil stub answers with nothing — an unmeasured
  // read, so the automatic GC WARNs and prunes nothing there (the safe
  // direction). The Darwin read itself is measured by the sourced case above.
  itLinux('an update whose health gate passed prunes behind it and keeps the previous', () => {
    const home = versionedBox('ccrc-versions-update-gc-', ['v1.0.4', 'v1.0.3', 'v1.0.2', 'v1.0.1', 'v1.0.0']);
    plantKillModeDropIn(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // The STUB spine's ccd/ccrc carries no BOX_VERSIONS_ROOT= line, so Task 4's
    // `_upd_legacy_target` gave it v2.0.0 (a copy of v1.0.4, its kept record
    // removed): five complete versions stand beside the pointed-at one. v1.0.4
    // is this run's `previous` (the stamp it replaced) and is protected, so it
    // takes no keep slot: the newest three of the REST stay (v1.0.3, v1.0.2,
    // v1.0.1) and only v1.0.0 goes. v1.0.1 staying is what measures the
    // previous guard here — without it v1.0.4 would fill a slot and v1.0.1
    // would be pruned too.
    expect(r.stdout).toMatch(/^update: versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 3\)$/m);
    expect(r.stdout).not.toMatch(/^update: versions: pruned \$HOME\/ccrc-versions\/v1\.0\.1 /m);
    expect(versionDirs(home)).toEqual(['v1.0.1', 'v1.0.2', 'v1.0.3', 'v1.0.4', 'v2.0.0']);
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8').split('\n')[0]).toBe('v1.0.4');
  });
});

// W6 Task 8A (W4's worker's carry: the `*.tmp.$$` EXIT-trap class). A writer's
// `<dest>.tmp.$$` survives a SIGTERM, Ctrl-C or die caught between its
// creation and its rename unless something removes it at exit — and a shell
// has ONE EXIT trap, which every `trap '…' EXIT` REPLACES, so a per-function
// trap at each writer would have clobbered `_upd_resolve`'s staging trap (and
// `cmd_wrappers'`, and `cmd_rollout`'s). One chain (`_exit_add`, `_exit_run`,
// `_tmp_guard`) carries them all. The harness SOURCES the real `ccd/ccrc`
// under a fixture HOME and calls the real writers, with the step between the
// tmp's creation and its rename replaced by a `kill -TERM $$` on the shell
// itself; a CONTROL runs the same harness with `_tmp_guard` made a no-op, so
// a harness that could not see a leak would say so.
describe('ccrc: one EXIT chain — a killed writer leaves no <dest>.tmp.$$, and no per-function trap clobbers another (W6 Task 8A)', () => {
  const chainEnv = (home: string): NodeJS.ProcessEnv => {
    const env = ghContainedEnv(home, { ...process.env, HOME: home });
    for (const k of Object.keys(env)) if (k.startsWith('CCRC_')) delete env[k];
    return env;
  };
  const run = (home: string, body: string): { code: number; stdout: string; stderr: string } => {
    const r = spawnSync(BASH, ['-c', `set --; source "${join(REPO, 'ccd', 'ccrc')}"; mkdir -p "$HOME/.ccrc"; ${body}`],
      { env: chainEnv(home), encoding: 'utf8', timeout: 30_000 });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const leftovers = (home: string): string[] =>
    readdirSync(join(home, '.ccrc')).filter((n) => /\.tmp\.\d+$/.test(n));

  itLinux('the chain runs EVERY arm on a SIGTERM (a staging tree and a temp file, neither clobbering the other), runs an entry once however often it is added, and never lets a subshell run its parent\'s arms', () => {
    const home = mkTmp('ccrc-exit-chain-');
    const r = run(home, [
      'stage="$HOME/stage-dir"; mkdir -p "$stage"; : > "$HOME/.ccrc/x.tmp.$$"',
      '_exit_add "rm -rf -- $(printf \'%q\' "$stage")"',
      '_tmp_guard "$HOME/.ccrc/x.tmp.$$"',
      '_exit_add "echo second >> \\"$HOME/ran-second\\""',
      '_exit_add "echo second >> \\"$HOME/ran-second\\""',
      // A subshell adds an arm of its own, and ends: it runs that arm and
      // NOT the parent's, so the parent's staging tree is still here after it.
      '( _exit_add "echo sub >> \\"$HOME/ran-sub\\"" )',
      '[ -d "$stage" ] && echo PARENT-STAGE-SURVIVED-THE-SUBSHELL',
      'kill -TERM $$',
      'echo NOT-REACHED',
    ].join('\n'));
    expect(r.stdout).toContain('PARENT-STAGE-SURVIVED-THE-SUBSHELL');
    expect(r.stdout).not.toContain('NOT-REACHED');
    expect(existsSync(join(home, 'stage-dir')), 'the staging arm did not run').toBe(false);
    expect(leftovers(home), 'the tmp guard did not run').toEqual([]);
    expect(readFileSync(join(home, 'ran-second'), 'utf8'), 'an entry added twice must run once').toBe('second\n');
    expect(readFileSync(join(home, 'ran-sub'), 'utf8')).toBe('sub\n');
  });

  it('`trap - EXIT` (the install prompt\'s stty restore ends with one) does not leave arms added AFTER it unarmed — the next add re-arms the chain', () => {
    const home = mkTmp('ccrc-exit-chain-rearm-');
    const r = run(home, [
      '_exit_add "echo one >> \\"$HOME/ran\\""',
      'trap - EXIT',
      '_exit_add "echo two >> \\"$HOME/ran\\""',
      'exit 0',
    ].join('\n'));
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, 'ran'), 'utf8')).toBe('one\ntwo\n');
  });

  // The clobber this chain exists to prevent, run through the REAL
  // `_upd_resolve`: a temp file guarded FIRST, then `_upd_resolve` makes its
  // staging tree and arms its own cleanup, then its download fails and it dies.
  // Both must be gone. Were `_upd_resolve`'s arm a plain `trap … EXIT` again,
  // it would REPLACE the chain and the guarded temp file would survive.
  itLinux('`_upd_resolve`\'s staging trap does not clobber a temp-file guard armed before it — both are removed when its download fails and it dies', () => {
    const home = mkTmp('ccrc-exit-chain-resolve-');
    mkdirSync(join(home, 'tmpdir'), { recursive: true });
    const r = run(home, [
      'export TMPDIR="$HOME/tmpdir"',
      'curl() { return 22; }',
      ': > "$HOME/.ccrc/guarded.tmp.$$"',
      '_tmp_guard "$HOME/.ccrc/guarded.tmp.$$"',
      '_upd_resolve v1.0.0',
      'echo NOT-REACHED',
    ].join('\n'));
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/download failed: /);
    expect(r.stdout).not.toContain('NOT-REACHED');
    expect(readdirSync(join(home, 'tmpdir')), 'the staging tree survived the die').toEqual([]);
    expect(leftovers(home), 'the guard armed before _upd_resolve was clobbered').toEqual([]);
  });

  // The four W4 writers, by name. Each step between the creation of the tmp
  // and its rename is replaced by the signal.
  const WRITERS: Array<[string, string, string]> = [
    ['_upd_phase (update.json)', 'chmod() { kill -TERM $$; }; UPD_FROM=cli; UPD_REPORT_STARTED=""; UPD_REPORT_TARGET=""',
      '_upd_phase fetching "the writer under test"'],
    ['_inst_floor (floor)', 'chmod() { kill -TERM $$; }; BOX_BUILD=(a b c d v1.0.0)',
      '_inst_floor'],
    ['_inst_step (install-step)', '_plat_mv_notdir() { kill -TERM $$; }',
      '_inst_step true'],
    ['_upd_write_previous (previous)', '_plat_mv_notdir() { kill -TERM $$; }; UPD_FROM=cli; UPD_VERSION=v2.0.0',
      '_upd_write_previous v1.0.0 aaaaaaaaaaaa'],
  ];
  for (const [name, prelude, call] of WRITERS) {
    itLinux(`${name}: killed between its temp file and its rename, it leaves no <dest>.tmp.$$ (and the same harness with the guard disabled DOES leave one — the control)`, () => {
      const guarded = mkTmp('ccrc-exit-chain-writer-');
      run(guarded, `${prelude}; ${call}`);
      expect(leftovers(guarded), `${name} left its temp file`).toEqual([]);
      const control = mkTmp('ccrc-exit-chain-control-');
      run(control, `_tmp_guard() { :; }; ${prelude}; ${call}`);
      expect(leftovers(control).length, `${name}: the harness could not see a leak`).toBe(1);
    });
  }
});
