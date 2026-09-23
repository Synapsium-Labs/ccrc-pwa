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
import { itLinux, itDarwin } from './platformFixtures.js';

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
  stub('curl', [
    'dest=""; url=""',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -o) dest="$2"; shift 2 ;;',
    '    -H|-w|--max-time) shift 2 ;;',
    '    -*) shift ;;',
    '    *) url="$1"; shift ;;',
    '  esac',
    'done',
    'printf \'%s\\n\' "$url" >> "$HOME/curl-argv"',
    'case "$url" in',
    '  local://*)',
    '    case "$url" in *.sigstore.json)',
    '      if [ -f "$HOME/fixture-curl-exit" ]; then IFS= read -r c < "$HOME/fixture-curl-exit"; echo "curl: ($c) fixture failure for $url" >&2; exit "$c"; fi ;;',
    '    esac',
    '    src="${url#local://}"',
    '    if [ ! -f "$src" ]; then',
    '      echo "curl: (22) The requested URL returned error: 404 for $url" >&2',
    '      exit 22',
    '    fi',
    '    cp "$src" "$dest" ;;',
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
    '      if [ -f "$HOME/fixture-pid-churn" ]; then',
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
    '    exit 0 ;;',
    '  is-active) echo active; exit 0 ;;',
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
    '    echo 4242; exit 0 ;;',
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
    + `exit ${opts.installExit ?? 0}\n`, { mode: 0o755 });
  writeFileSync(join(tree, 'MARKER'), 'release payload\n');
  writeFileSync(join(tree, 'build.json'),
    shippedStamp(opts.version, 'newsha0000000000000000000000000000000000'));
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

/** The backup directory THIS run announced — parsed from the transcript, not
 *  guessed from `ls`: the hooks installer inside a full run writes its own
 *  timestamped siblings into `~/ccrc-backups/`. */
function announcedBackupDir(stdout: string): string {
  const m = /^update: backup: (\S+)/m.exec(stdout);
  if (m === null) throw new Error(`no "update: backup:" line in:\n${stdout}`);
  return m[1]!;
}

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
    // A verified bundle (packRelease's default) makes this a ONE-line marker
    // — provenance verified, no `unsigned` line 2 (D-3117, Task 12).
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8'))
      .toBe('newsha0000000000000000000000000000000000\n');
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
    expect(r.stdout).toMatch(/^FAIL git_email: /m);
    expect(r.stdout).toMatch(/^update: the staged install completed \(the record is written\) but its trailing doctor exited 1 — this box IS on v2\.0\.0; the FAIL lines above are the box's health, not the update's/m);
    // Line 2 (design 2026-09-20 §5, D-3117): a verified bundle (packRelease's
    // default) makes `cmd_update` assert CCRC_UPDATE_VERIFIED=1 for this
    // spine, so the marker is ONE line — verified, not `unsigned` (Task 12).
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe('newsha0000000000000000000000000000000000\n');
    expect(r.stdout).toMatch(/^update: build: v1\.0\.0 \(oldsha[0-9a-f]*\) -> v2\.0\.0 \(newsha[0-9a-f]*\)$/m);
    expect(r.stderr).not.toMatch(/the staged install \(which ends with doctor\) exited/);
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

  it('a spine that DIED mid-way still exits 1 with the backup named — and leaves NO completed-install record (D-3114)', () => {
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
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the staged install \(which ends with doctor\) exited 1 — read its lines above\. The backup taken BEFORE it ran is complete at/);
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
    let r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    let argv = readFileSync(join(home, 'staged-ccrc-argv'), 'utf8').split('\n').filter((l) => l !== '');
    expect(argv[0]).toMatch(/\/ccd\/ccrc$/);
    expect(argv.slice(1)).toEqual(['install', '--role', 'fleet']);
    // Without a recorded role the staged install is invoked bare — its own
    // default (both) decides, exactly as a fresh `ccrc install` would.
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), '# no role recorded\n');
    r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    argv = readFileSync(join(home, 'staged-ccrc-argv'), 'utf8').split('\n').filter((l) => l !== '');
    expect(argv.slice(1)).toEqual(['install']);
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
    // D-3143: curl -f's exit 22 means ANY HTTP status >= 400, not
    // specifically 404 — say what was actually measured.
    expect(r.stdout).toMatch(/^update: WARN: .*sigstore\.json is absent \(the release host answered an HTTP error — curl exit 22\) — proceeding on the transport checksum alone because --allow-unsigned was typed; this install will be recorded as unsigned$/m);
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
    expect(r.stderr).toMatch(/download failed: .*sigstore\.json \(curl exit 7, not a 404/);
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
    // The ONLY systemctl traffic in a stub-flavour run is the sweep's, so the
    // whole recording is the order pin: enumerate, preflight EVERY unit plus
    // the uninstantiated template probe, try-restart, then the two state
    // queries — warn about failed, verify active.
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8')
      .split('\n').filter((l) => l !== '');
    expect(calls).toEqual([
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
  const firstLine = (s: string): string => s.split('\n')[0] ?? '';
  const parse = (s: string): Record<string, string> =>
    Object.fromEntries(firstLine(s).replace(/^check: /, '').split(' ').map((kv) => kv.split('=') as [string, string]));

  it('behind: an older version on the box, exit 1, SHA256SUMS fetched and nothing else, nothing written', () => {
    const home = freshUpdateBox('ccrc-update-check-behind-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const before = treeDigest(join(home, 'ccrc'));
    const r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    expect(parse(r.stdout)).toEqual({ box: 'v1.0.0', sha: 'oldsha0000000000000000000000000000000000', target: 'v2.0.0', state: 'behind' });
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
    expect(parse(r.stdout)).toEqual({ box: 'unversioned', sha: 'deploysha0000000000000000000000000000000', target: 'v1.0.0', state: 'unversioned' });
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
    expect(localUrls(home)).toEqual([`local://${home}/releases/latest/download/SHA256SUMS`]);
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

  it('--check is a measurement and never consults the floor', () => {
    const home = freshUpdateBox('ccrc-update-floor-check-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, ['--check']);
    expect(r.stdout).toMatch(/^check: box=v3\.0\.0 sha=\S+ target=v2\.0\.0 state=behind$/m);
    expect(r.stderr).not.toMatch(/floor/);
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
 *  nulling anything above `REPORT_TIME_MAX_S` (a 13-digit ms stamp). Ten
 *  digits until the year 2286. */
const REPORT_TIME = /^\d{10}$/;

describe('ccrc update: update.json at every phase, and --from (design §10)', () => {
  // Spec §6's UpdatePhase minus `unknown` — which is the READER's word for a
  // token outside the vocabulary and which no writer ever writes. Task 15
  // swaps this literal for W2's `UPDATE_PHASES` once W2 has merged.
  const WRITTEN_PHASES = ['queued', 'resolving', 'fetching', 'verifying', 'backing-up', 'installing',
    'restarting', 'checking', 'restoring', 'done', 'reverted', 'failed'];
  // Phases a LATER task wires. Each task deletes its own member in the commit
  // that writes it; Task 6 deletes the literal, and the union assertion below
  // becomes total.
  const PENDING = new Set<string>([
    'queued',     // Task 3 — `--detach` writes it before the spawn
    'checking',   // Task 5 — the health gate
    'restoring',  // Task 6 — `_upd_restore`
    'reverted',   // Task 6 — `_upd_restore`'s last word
  ]);
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
    expect(phases(moved)).toEqual(['resolving', 'fetching', 'verifying', 'backing-up', 'installing', 'restarting', 'done']);

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

    const written = new Set([...phases(moved), ...phases(same), ...phases(refused)]);
    expect(written.has('unknown'), 'a writer wrote the reader\'s word').toBe(false);
    for (const p of PENDING) expect(written.has(p), `${p} is written but still listed PENDING`).toBe(false);
    expect([...new Set([...written, ...PENDING])].sort()).toEqual([...WRITTEN_PHASES].sort());

    for (const home of [moved, same, refused]) {
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
    expect(w.length).toBe(7);
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

  it('--from restore|rollback|watchdog go below the floor with a WARN naming the caller, and the floor stays; --from pwa is refused by W1\'s sentence (spec §9)', () => {
    for (const from of ['restore', 'rollback', 'watchdog']) {
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
