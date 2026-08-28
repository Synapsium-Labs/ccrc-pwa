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
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync, existsSync,
  statSync, chmodSync, readdirSync, appendFileSync, renameSync,
} from 'node:fs';
import path, { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

function realPath(name: string): string {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (p === '') throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
}
const BASH = realPath('bash');
const RSYNC = realPath('rsync');

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
  plant('systemctl', [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/systemctl-calls"',
    '[ "$1" = "--user" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    'shift',
    'case "$1" in',
    '  daemon-reload) exit 0 ;;',
    '  enable) [ "$2" = "--now" ] && [ -n "$3" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }; exit 0 ;;',
    '  restart) [ -n "$2" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }; exit 0 ;;',
    '  try-restart) [ -n "$2" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }; exit 0 ;;',
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
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_DOCTOR_GH_TIMEOUT',
    'CCRC_RELEASE_BASE_URL', 'CCRC_BACKUP_KEEP']) delete env[k];
  env['CCRC_VERIFY_SETTLE'] = '0';
  env['CCRC_VERIFY_WINDOW'] = '0';
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
    'cd "$1" && find . -type f | sed \'s|^\\./||\' | LC_ALL=C sort | xargs -r -d \'\\n\' sha256sum > "$2"',
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
  mkdirSync(join(tree, 'agent', 'dist'), { recursive: true });
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
  opts: { tag: string; latest?: boolean; tamper?: boolean; corruptInner?: string } = { tag: 'v9.9.9' }): void {
  if (opts.corruptInner !== undefined) {
    appendFileSync(join(tree, opts.corruptInner), '\n// corrupted after the MANIFEST was written\n');
  }
  const relDir = opts.latest === false
    ? join(home, 'releases', 'download', opts.tag)
    : join(home, 'releases', 'latest', 'download');
  mkdirSync(relDir, { recursive: true });
  const name = `ccrc-${opts.tag}.tar.gz`;
  const tarRes = spawnSync('tar', ['-czf', join(relDir, name), '-C', tree, '.'], { encoding: 'utf8' });
  if (tarRes.status !== 0) throw new Error(`fixture tar failed: ${tarRes.stderr}`);
  const sumRes = spawnSync('bash', ['-c', `sha256sum '${name}' > SHA256SUMS`],
    { cwd: relDir, encoding: 'utf8' });
  if (sumRes.status !== 0) throw new Error(`fixture sha256sum failed: ${sumRes.stderr}`);
  if (opts.tamper) appendFileSync(join(relDir, name), 'one appended byte-run after the sums were written');
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
    // … the units, and the dists.
    expect(existsSync(join(backup, 'ccrc.service'))).toBe(true);
    expect(existsSync(join(backup, 'claude-session@.service'))).toBe(true);
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
    // Both fetches went to the pinned tag's download path, in order.
    expect(localUrls(home)).toEqual([
      `local://${home}/releases/download/v1.0.0/SHA256SUMS`,
      `local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz`,
    ]);
    // The rollback report: the restore is PRINTED, never performed —
    // migrations are forward-only and an older server reads a newer coord.db.
    const backup = announcedBackupDir(r.stdout);
    expect(r.stdout).toMatch(/^update: rollback: /m);
    expect(r.stdout).toContain('NOT restored');
    expect(r.stdout).toContain(`cp ${backup}/coord.db`);
    expect(r.stdout).toContain('systemctl --user stop ccrc.service');
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
  const plantKillModeDropIn = (home: string): void => {
    const d = join(home, '.config', 'systemd', 'user', 'claude-session@.service.d');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, '50-killmode.conf'), '[Service]\nKillMode=process\n');
  };
  const UNIT_LINES =
    'claude-session@alpha.service loaded active running fixture supervisor\n'
    + 'claude-session@beta.service loaded active running fixture supervisor\n';

  it('with KillMode=process resolving per unit, the sweep runs: preflight, try-restart, the failed warn query, the active verify query — in that argv order', () => {
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

  it('with the drop-in ABSENT the sweep is REFUSED — loud, naming the drop-in — and the update still exits 0 with a degraded line', () => {
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
});
