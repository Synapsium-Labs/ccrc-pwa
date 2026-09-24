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
import { DatabaseSync } from 'node:sqlite';
import {
  copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync, existsSync,
  statSync, lstatSync, chmodSync, readdirSync, appendFileSync, renameSync, rmSync,
  symlinkSync,
} from 'node:fs';
import path, { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { itLinux, itDarwin, platformContrast } from './platformFixtures.js';
import { IN_FLIGHT_UPDATE_PHASES, UPDATE_PHASES } from '../../shared/api.js';

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
// D-3277 (fix round 1, Task 9): the real `flock`, so a shim placed ahead of
// it on PATH can rewrite a file and then `exec` into the genuine binary —
// the locking semantics the shim intercepts stay real, only the write in
// between is fixture-controlled.
const FLOCK = realPath('flock');

interface Result { code: number; stdout: string; stderr: string }

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
    'dest=""; url=""; wfmt=""',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -o) dest="$2"; shift 2 ;;',
    '    -w) wfmt="$2"; shift 2 ;;',
    '    -H|--max-time) shift 2 ;;',
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
    'CCRC_RELEASE_BASE_URL', 'CCRC_BACKUP_KEEP']) delete env[k];
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

/** A sorted recursive listing of `<home>` as `<relpath>\t<size>` lines —
 *  the before/after snapshot the `--check` write-nothing case compares.
 *  `<home>/tmp/**` is the staging dir TMPDIR points at (update's own
 *  mktemp -d space, cleaned by its EXIT trap but timing-dependent) and
 *  `<home>/curl-argv` is the fixture's own recording, so both are the
 *  harness writing, not the verb. */
function homeSnapshot(home: string): string[] {
  const out: string[] = [];
  const walk = (d: string, prefix: string): void => {
    for (const e of readdirSync(d).sort()) {
      const rel = prefix === '' ? e : `${prefix}/${e}`;
      if (rel === 'tmp' || rel.startsWith('tmp/') || rel === 'curl-argv') continue;
      const p = join(d, e);
      const st = lstatSync(p);
      if (st.isDirectory()) { out.push(`${rel}/`); walk(p, rel); } else out.push(`${rel}\t${st.size}`);
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

/** `update --check`'s machine line, found by its prefix rather than assumed
 *  to be line 1 — the same rule rollout's parser applies (`grep -m1
 *  '^check: '`), so a sentence printed before it can never shift what a
 *  test reads. */
const checkLine = (s: string): string => s.split('\n').find((l) => l.startsWith('check: ')) ?? '';

/** The words THIS ccrc can do (`_ccrc_cap_words`), as `--check` joins them:
 *  W1's three and W4's four, `detach` on Linux only (decision 17). A literal,
 *  not a read of ccd/ccrc — a pin derived from the list it pins cannot red. */
const CAPS_NOW = process.platform === 'darwin'
  ? 'verify,node-id,floor,update-json,update-gate,rollback'
  : 'verify,node-id,floor,update-json,update-gate,rollback,detach';
/** The machine line as key → value. Values never contain a space or `=`
 *  (caps= joins its words with commas), so one split per field is exact. */
const parseCheck = (s: string): Record<string, string> =>
  Object.fromEntries(checkLine(s).replace(/^check: /, '').split(' ').map((kv) => kv.split('=') as [string, string]));

/** The backup directory THIS run announced — parsed from the transcript, not
 *  guessed from `ls`: the hooks installer inside a full run writes its own
 *  timestamped siblings into `~/ccrc-backups/`. */
function announcedBackupDir(stdout: string): string {
  const m = /^update: backup: (\S+)/m.exec(stdout);
  if (m === null) throw new Error(`no "update: backup:" line in:\n${stdout}`);
  return m[1]!;
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
  // the D-3140 case below measures the wrong refusal.
  for (const b of ['tar', 'gzip', 'awk', 'flock', 'mkdir']) symlinkSync(realPath(b), join(d, b));
  return `${join(home, '.local', 'bin')}:${d}`;
}

/** F5 (fix round 1, Task 9): the watchdog's own `flock` preflight, the twin
 *  of `pathWithoutJq` above — everything the watchdog calls before its
 *  `command -v flock` check (jq, and `date` for its `now="$(date +%s)"`)
 *  stays real, only `flock` itself is missing. */
function pathWithoutFlock(home: string): string {
  const d = join(home, 'no-flock-bin');
  mkdirSync(d, { recursive: true });
  for (const b of ['jq', 'tar', 'gzip', 'awk', 'mkdir', 'date']) symlinkSync(realPath(b), join(d, b));
  return `${join(home, '.local', 'bin')}:${d}`;
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
    const backup = announcedBackupDir(r.stdout);
    expect(existsSync(join(backup, 'coord.db'))).toBe(true);
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

  it('a spine that DIED inside _inst_tree (after the tree moved) is gated, fails the gate on the OLD build, and exits 4 with the backup named — and leaves NO completed-install record (D-3114, design §11)', () => {
    // `npm ci` failing after the tree is placed — v0.0.2's own death shape
    // (D-3105) — kills `_inst_tree` before the stamp and long before the
    // record. The record was cleared before the staged install ran, so the
    // box reads `incomplete` afterwards rather than the OLD build's record.
    const home = freshUpdateBox('ccrc-update-died-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    writeFileSync(join(home, '.ccrc', 'installed'), 'oldsha0000000000000000000000000000000000\n');
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000' }), { tag: 'v2.0.0' });
    // Ahead of the recorder npm that `runUpdate` re-plants on every call.
    mkdirSync(join(home, 'fail-bin'), { recursive: true });
    writeFileSync(join(home, 'fail-bin', 'npm'), '#!/bin/sh\necho "fixture npm: refusing" >&2\nexit 1\n', { mode: 0o755 });
    const r = runUpdate(home, [], { PATH: `${join(home, 'fail-bin')}:${updateEnv(home)['PATH'] ?? ''}` });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — /m);
    // Task 6: its v1.0.0 is unpublished, so arm 2 refuses and arm 3 runs —
    // and arm 3 removes ~/.ccrc/installed rather than restoring it, so the
    // no-record line holds.
    expect(r.stdout).toMatch(/^update: arm2-refused: v1\.0\.0 ships no bundle — /m);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
    expect(r.stderr).toMatch(/update: v2\.0\.0 was installed, but the box did not come back healthy on it \(.*\) — exit 4\. The backup taken BEFORE the install is complete at/);
    expect(readFileSync(join(home, '.ccrc', 'install-step'), 'utf8')).toBe('_inst_tree\n');
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
    const backup = announcedBackupDir(r.stdout);
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
    const backup = announcedBackupDir(r.stdout);
    expect(r.stdout).toMatch(/^update: rollback: /m);
    expect(r.stdout).toContain('NOT restored');
    expect(r.stdout).toContain(`cp ${backup}/coord.db`);
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
  it.each([['rollback'], ['watchdog']])('a --from %s run does NOT rewrite previous — it returns to a known tag, not a new baseline (§18 "…and not by a restore")', (from) => {
    const home = stubBox(`ccrc-update-prev-keep-${from}-`);
    writeFileSync(join(home, '.ccrc', 'previous'), 'v0.9.0\nbaselinesha\n');
    const r = runUpdate(home, ['--from', from]);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(previous(home)).toBe('v0.9.0\nbaselinesha\n');
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

  it('a --force reinstall of the tag the box already runs, with NO previous to keep, writes its stamp as today regardless of the record (D-3254)', () => {
    const first = freshUpdateBox('ccrc-update-prev-reinstall-none-');
    plantOldBox(first, { version: 'v2.0.0' });
    writeFileSync(join(first, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    packRelease(first, stubTree(first, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r2 = runUpdate(first, ['--force']);
    expect(r2.code, `stderr: ${r2.stderr}\nstdout: ${r2.stdout}`).toBe(0);
    expect(previous(first)).toBe(`v2.0.0\n${OLD_SHA}\n`);
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
    expect(r.stderr).toMatch(/^ccrc: the staged install \(which ends with doctor\) exited 1 — spine died at _inst_node_id, before _inst_tree: nothing was replaced; read its lines above\. The backup taken BEFORE it ran is complete at \S+\/ccrc-backups\/\S+$/m);
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

  // Fix round 1 item 5 / review 155 C2 (your Q5): the lock is released
  // BEFORE the sweep (§10 requires it), so a SECOND `ccrc update` can take
  // it mid-sweep and write its own in-flight report. This run's final
  // writes — `_upd_report`'s announcement and the closing `_upd_phase done`
  // — must not clobber that newer run's report: they run only while
  // update.json still names THIS run's own pid, and skip with one line
  // otherwise. The reviewer's own probe shape: the systemctl stub's
  // try-restart arm writes a foreign report (a different pid) mid-sweep.
  itLinux('a foreign report written mid-sweep survives this run\'s own final writes, which skip with one line (fix round 1 item 5 / review 155 C2, your Q5)', () => {
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
      /^update: report: skipped — ~\/\.ccrc\/update\.json no longer names this run's pid \(\d+\); a newer update took the lock this run released before the sweep, and this run's final report would have overwritten its in-flight one$/m);
    // The foreign report SURVIVES — this run never overwrote it with its own
    // `build: … -> …` announcement or a closing `done`.
    const rep = JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
    expect(rep).toEqual({
      target: 'v9.9.9', phase: 'resolving', startedAt: 1, updatedAt: 1, detail: null, from: 'cli', pid: 999999,
    });
    expect(r.stdout).not.toMatch(/^update: build: /m);
    // The sweep itself still ran — the skip is only the trailing writes.
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
    // Fix round 1 item 17 / review 155 C28: the converged no-op now precedes
    // the floor check, and the ONLY converged proof (`_upd_converged`) needs
    // the STAGED tree's own sha — so the full fetch (tarball, then the
    // bundle) runs before the floor can die, not only the resolve-time
    // SHA256SUMS read. Never installed: the floor still refuses before any
    // backup or the staged spine.
    expect(localUrls(home)).toEqual([
      `local://${home}/releases/latest/download/SHA256SUMS`,
      `local://${home}/releases/latest/download/ccrc-v2.0.0.tar.gz`,
      `local://${home}/releases/latest/download/ccrc-v2.0.0.tar.gz.sigstore.json`,
    ]);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
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
    expect(r.stderr).toMatch(/floor is malformed \(got: 'three'\)/);
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
    expect(r.stderr).toMatch(/\.ccrc\/floor is unreadable — fix its permissions by hand/);
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
    // SHA256SUMS, nothing backed up, the floor untouched.
    expect(r.stderr).not.toMatch(/is below this box's floor|floor is malformed|floor is unreadable/);
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

  it('--from rollback|watchdog go below the floor with a WARN naming the caller, and the floor stays; --from pwa is refused by W1\'s sentence (spec §9; --from restore\'s WARN is measured by Task 6\'s FULL restore case)', () => {
    // `restore` is not typed here: bare, it is refused at exit 2 (Task 6,
    // D-3257); its WARN is read off a real
    // restore child in Task 6's FULL case.
    for (const from of ['rollback', 'watchdog']) {
      const home = freshUpdateBox(`ccrc-update-json-floor-${from}-`);
      plantOldBox(home, { version: 'v3.0.0' });
      plantFloor(home, 'v3.0.0');
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
      const r = runUpdate(home, ['--to', 'v2.0.0', '--from', from]);
      expect(r.code, `${from} — stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toMatch(new RegExp(`^update: WARN: v2\\.0\\.0 is below this box's floor v3\\.0\\.0 \\(resolved by --to v2\\.0\\.0\\) — proceeding because this run is --from ${from}; the floor stays v3\\.0\\.0$`, 'm'));
      expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v3.0.0\n');
      expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
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

  it('_ccrc_die reports `failed` only once the run is reporting, only from the run\'s own shell, with the prefix in front (the one hook)', () => {
    // `ccrc-install.test.ts:4133`'s idiom: the ONE-LINE definition extracted
    // from the shipped file and run alone, `_upd_phase` shadowed by a recorder.
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const progLine = /^PROG=.*$/m.exec(src);
    const dieLine = /^_ccrc_die\(\) \{.*\}$/m.exec(src);
    expect(progLine, 'ccd/ccrc has no PROG=').not.toBeNull();
    expect(dieLine, 'ccd/ccrc has no one-line _ccrc_die').not.toBeNull();
    const home = mkTmp('ccrc-update-die-hook-');
    const rec = join(home, 'phase-calls');
    const run = (body: string): Result => {
      const p = spawnSync(BASH, ['-c', [
        'set -uo pipefail', progLine![0], dieLine![0],
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

  itLinux('the re-exec goes through _svc_run_detached with the ABSOLUTE launcher and the spec argv, writes queued, and returns 0 having done none of the work (§18 "--detach escapes the cgroup")', () => {
    const home = detachedBox('ccrc-update-detach-');
    const t0 = Date.now();
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
    const elapsed = Date.now() - t0;
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(elapsed, 'the parent waited on the run it detached').toBeLessThan(10_000);
    expect(detachArgv(home)).toEqual([
      `--user --collect --quiet ${join(home, '.local', 'bin', 'ccrc')} update --to v2.0.0 --from cli`,
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
      `--user --collect --quiet ${join(home, '.local', 'bin', 'ccrc')} update --to v2.0.0 --from pwa --force --downgrade --allow-unsigned`,
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

  itLinux('--detach carries a typed --no-gate into the detached argv, after the other typed flags (the D-3139 trap: a flag the caller typed is never dropped)', () => {
    const home = gateBox('ccrc-update-gate-detach-', 'server');
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0', '--no-gate']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(lines(home, 'systemd-run-argv')).toEqual([
      `--user --collect --quiet ${join(home, '.local', 'bin', 'ccrc')} update --to v2.0.0 --from cli --no-gate`,
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
  it('a same-tag --force reinstall whose gate fails skips arm 2 and falls straight to arm 3; previous still names the release before this run (fix round 1 item 2 / review 155 C1)', () => {
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
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
    expect(String(lastReport(home)['detail'])).toMatch(/^arm3: /);
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe('v1.0.0\nbaselinesha\n');
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
    expect(r.stdout).toMatch(/^update: arm 2: could not ask the release host whether v1\.0\.0 ships a bundle \(curl failed, or the host answered neither 200 nor 404\) — the restore child's own fetch decides$/m);
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
    // never a corrupted copy.
    expect(r.stderr).toMatch(new RegExp(
      `^ccrc: ${esc(backupDir)} already exists \\(another backup started in the same second\\) — refusing to reuse a backup directory; nothing on this box was changed by this step$`, 'm'));
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
    expect(r.stderr).toMatch(/^ccrc: rollback: could not ask the release host whether v1\.0\.0 exists \(curl failed, or the host answered neither 200 nor 404\) — nothing on this box was changed$/m);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('a release host answering 503 (or a 403 rate limit) is exit 1 too — curl -f\'s exit 22 is not a 404 until the status says so (Task 6, D-3261)', () => {
    const home = rollbackBox('ccrc-rollback-host-5xx-', { previous: PREV });
    writeFileSync(join(home, 'fixture-release-http'), '503\n');   // Task 6's knob on the combined curl
    const r = runRollback(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rollback: could not ask the release host whether v1\.0\.0 exists \(curl failed, or the host answered neither 200 nor 404\) — nothing on this box was changed$/m);
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
    expect(readFileSync(join(home, 'systemd-run-argv'), 'utf8').split('\n').filter((l) => l !== ''))
      .toEqual([`--user --collect --quiet ${home}/.local/bin/ccrc rollback --to v1.0.0 --from pwa`]);
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
      .toBe(`--user --collect --quiet ${pinned}/.local/bin/ccrc rollback --to v1.0.0 --from cli`);
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
        `^update: ~/\\.ccrc/update-intent is unreadable \\(absent\\) — ${esc(SERVER_REMEDY)}; --check reports this box's own version instead of a target it cannot resolve — 'ccrc update' itself still refuses$`, 'm'));
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
        `^update: the control plane's projection \\(~/\\.ccrc/update-intent\\) is stale — its lease ended 300s ago; ${esc(remedy)}; --check reports this box's own version instead of a target it cannot resolve — 'ccrc update' itself still refuses$`, 'm'));
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
    // Fix round 1 item 17 / review 155 C28: the converged no-op (which needs
    // the staged tree's own sha) now precedes the floor check, so the full
    // fetch runs before the floor can die — see the sibling `latest/download`
    // case's own comment.
    expect(localUrls(home)).toEqual([
      `local://${home}/releases/download/v2.0.0/SHA256SUMS`,
      `local://${home}/releases/download/v2.0.0/ccrc-v2.0.0.tar.gz`,
      `local://${home}/releases/download/v2.0.0/ccrc-v2.0.0.tar.gz.sigstore.json`,
    ]);
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
    const malformed: Array<[string, string | Buffer]> = [
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
    ];
    for (const [name, text] of malformed) {
      const home = managedFleetBox('ccrc-channel-grammar-');
      plantIntent(home, text);
      const r = runChannel(home);
      expect(r.stdout.split('\n')[0], name).toMatch(/^channel: state=malformed channel=- /);
      expect(r.stdout, name).toMatch(/is malformed \(.+\) — refusing to follow a projection this reader does not recognise; systemctl --user start ccd-update-sync\.service$/m);
      expect(r.code, name).toBe(1);
    }
    for (const [name, text] of [['no final newline', doc.slice(0, -1)], ['a 13-digit (ms-shaped) lease is grammatical', intentDoc({ lease: '2000000000000' })]] as const) {
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
  // this describe uses the STUB `LAUNCHER` at `.local/bin/ccrc`, which never
  // runs real ccrc code — so it cannot see the bug the re-review found:
  // `cmd_rollback --from watchdog` on a box whose PREVIOUS tag is its own
  // RUNNING tag (already converged) used to hit the converged pre-check's
  // early `return 0`, which writes NO report at all. `cmd_watchdog` records
  // only when the rollback it ran answers non-zero, so update.json stayed
  // stuck `checking` forever, and the NEXT tick would see the same stale
  // report and roll back again — looping every tick. This test installs a
  // REAL `ccrc` as the launcher so the real `cmd_rollback`/`cmd_update`
  // convergence path actually runs, then measures TWO ticks.
  itLinux('a real, converged `ccrc rollback --from watchdog` closes its report — done, not stuck — and a second tick does not run it again (re-review fix)', () => {
    const home = watchBox('ccrc-watchdog-revert-converged-');
    // The REAL binary, not the stub LAUNCHER: this is the one case in this
    // describe that must exercise `cmd_rollback`'s own convergence logic.
    cpSync(join(REPO, 'ccd', 'ccrc'), join(home, '.local', 'bin', 'ccrc'));
    chmodSync(join(home, '.local', 'bin', 'ccrc'), 0o755);
    // previous == the box's own running tag (v2.0.0, watchBox's default) —
    // the scenario the regression needs: a bare `rollback --from watchdog`
    // (no --to) resolves `to` from here.
    writeFileSync(join(home, '.ccrc', 'previous'), 'v2.0.0\noldsha0000000000000000000000000000000000\n');
    // Published, its build.json sha matching the box's own stamp — the
    // shape `_upd_converged` (reached for real now) needs to answer yes.
    // `packRelease` derives `<home>/releases/…` itself — the same
    // `CCRC_RELEASE_BASE_URL` shape `runUpdate`'s own default uses.
    packRelease(home, selfConvergedTree(home, 'v2.0.0', 'oldsha0000000000000000000000000000000000'),
      { tag: 'v2.0.0', latest: false });
    report(home, { phase: 'checking', ageS: 90 });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    const releaseUrl = `local://${home}/releases`;
    const r = runWatchdog(home, [], { CCRC_RELEASE_BASE_URL: releaseUrl });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^watchdog: stale report \(checking, 9\ds\) and the box fails its health probe \(.+\) — rolling back$/m);
    const rep1 = readReport(home);
    expect(rep1['phase'], `stdout: ${r.stdout}`).toBe('done');
    expect(rep1['detail']).toBe('already converged at v2.0.0');
    expect(lockFree(home)).toBe(true);
    // Second tick: the report is now TERMINAL (`done`), so the watchdog
    // takes the NOT_IN_FLIGHT "nothing to do" branch — it must not probe,
    // must not touch the lock, must not run rollback again.
    const before = readFileSync(jsonPath(home), 'utf8');
    const r2 = runWatchdog(home, [], { CCRC_RELEASE_BASE_URL: releaseUrl });
    expect(r2.code, `stderr: ${r2.stderr}`).toBe(0);
    expect(r2.stdout).toBe('watchdog: last update done — nothing to do\n');
    expect(readFileSync(jsonPath(home), 'utf8')).toBe(before);
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
