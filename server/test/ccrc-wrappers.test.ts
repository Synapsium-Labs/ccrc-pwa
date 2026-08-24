// `ccrc wrappers` — Task 6 of the stage-2c wrapper-generation plan: the verb
// that makes `~/.ccrc/accounts.json` the thing that PRODUCES `~/.local/bin/<id>`
// rather than merely the thing that describes it.
//
// ── SAFETY: THIS IS THE ONE SUITE THAT DRIVES A VERB WHICH WRITES EXECUTABLES
//    INTO A DIRECTORY A LIVE FLEET RUNS FROM ─────────────────────────────────
// Every case here runs `bash ccd/ccrc wrappers` with `HOME` pointed at a
// `mkTmp` (an `os.tmpdir()` `mkdtemp`) directory, and the verb derives its one
// mutable path from `$HOME` alone — `WRAPPER_BIN_DIR="$HOME/.local/bin"`
// (`ccd/ccrc-wrapper-shape`), the roster at `$HOME/.ccrc/accounts.json`. So the
// fixture HOME is not a convenience here, it is the containment: nothing in
// this file reads, writes, stats or globs the real `$HOME/.local/bin`,
// `$HOME/.ccrc`, `$HOME/.cc-secrets`, `$HOME/.cc-sessions` or
// `$HOME/.cc-limits`, and `process.env.HOME` is never read except to be
// REPLACED in the child's env (`runWrappers` below).
//
// ── WHY THE POISONS SIT IN THEIR OWN DIRECTORY, NOT IN `.local/bin` ──────────
// `ccrc-cli.test.ts` contains `gh`/`curl`/`systemctl` by planting them in
// `<home>/.local/bin` and prepending that to PATH (`ghContainedEnv`). That is
// exactly the wrong place for THIS file: `<home>/.local/bin` is the subject
// under test — the directory the verb creates, writes into, backs up inside and
// reports orphans from — and three id-shaped executables sitting in it would be
// fixture noise in every "what is in the bin dir now" assertion. So the same
// poisons are planted in `<home>/.poison-bin` instead and PATH is prepended
// with that. The containment is identical (a prepended directory the child
// cannot displace); only the location differs, and the subject directory stays
// the box's, not the harness's.
//
// The rest of PATH is left intact deliberately: the verb genuinely needs `node`
// (it runs `deploy/gen-wrappers.mjs`), `mktemp`, `date`, `cp`, `mv`, `chmod`
// and `mkdir`, and a fixture-only PATH would test a box nobody runs. The one
// case that DOES break PATH is the "node is absent" case, which is the point of
// it.
//
// ── HOW THE EXPECTED TEXT IS COMPUTED ───────────────────────────────────────
// Through the real emitter and the real marker (`generateWrapperBody` +
// `markGenerated`), in-process, exactly as `deploy/gen-wrappers.mjs` composes
// them — so a text-equality assertion here is an assertion of AGREEMENT between
// the verb and the emitter, not a golden literal that has to be re-typed every
// time the template changes.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readdirSync, readFileSync,
  renameSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWrapperBody } from '../../shared/wrapper.mjs';
import { markGenerated } from '../../shared/mark.mjs';
import { mkTmp } from './tmpHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');
const CCD_DIR = path.join(ccrcRoot, 'ccd');
const CCRC = path.join(CCD_DIR, 'ccrc');

interface RosterAccount {
  id: string;
  label: string;
  configDirSuffix: string;
  exec: { kind: string; secretsFile?: string };
  homeAble: boolean;
  hue: string;
  telemetry: string;
}
interface Roster { version: number; accounts: RosterAccount[] }

const FIXTURE: Roster = JSON.parse(JSON.stringify(DEFAULT_TEST_ROSTER)) as Roster;
/** The test roster's three `generated` accounts — the only ids this verb
 *  may ever write. `claude` (upstream) and `gpt` (external) are the two it may
 *  never touch, under any flag. */
const GENERATED_IDS = ['claude-a', 'claude-b', 'claude-d'] as const;
const UPSTREAM_ID = 'claude';
const EXTERNAL_ID = 'gpt';

const clone = (r: Roster): Roster => JSON.parse(JSON.stringify(r)) as Roster;

/** The exact marked text `ccrc wrappers` must install for one account of
 *  `roster`, computed through the same two functions the CLI composes. */
function bodyFor(roster: Roster, id: string): string {
  const a = roster.accounts.find((x) => x.id === id);
  if (!a) throw new Error(`fixture bug: ${id} is not in this roster`);
  const upstream = roster.accounts.find((x) => x.exec.kind === 'upstream');
  if (!upstream) throw new Error('fixture bug: this roster declares no upstream account');
  return markGenerated(generateWrapperBody(
    {
      id: a.id,
      configDirSuffix: a.configDirSuffix,
      execKind: a.exec.kind,
      ...(a.exec.secretsFile === undefined ? {} : { secretsFile: a.exec.secretsFile }),
    },
    upstream.id,
  ));
}

const binOf = (home: string): string => join(home, '.local', 'bin');
const rosterPathOf = (home: string): string => join(home, '.ccrc', 'accounts.json');

/** A fixture HOME with a roster and (unless `bin: false`) an empty
 *  `~/.local/bin`. Nothing outside the returned directory is created. */
function makeHome(prefix: string, opts: { roster?: Roster; bin?: boolean } = {}): string {
  const home = mkTmp(prefix);
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(rosterPathOf(home), `${JSON.stringify(opts.roster ?? FIXTURE, null, 2)}\n`);
  if (opts.bin !== false) mkdirSync(binOf(home), { recursive: true });
  return home;
}

/** Rewrites a fixture HOME's roster in place — for the "the roster changed"
 *  case, which is the whole reason this verb re-runs. */
function putRoster(home: string, roster: Roster): void {
  writeFileSync(rosterPathOf(home), `${JSON.stringify(roster, null, 2)}\n`);
}

/** HOME replaced, and `gh`/`curl`/`systemctl` poisoned in a directory of their
 *  own that is PREPENDED to PATH (see this file's header for why not
 *  `.local/bin`). Every `CCRC_*` input the CLI reads is deleted by name, so the
 *  fixture decides and never the shell the suite was started from. */
function wrappersEnv(home: string): NodeJS.ProcessEnv {
  const poison = join(home, '.poison-bin');
  mkdirSync(poison, { recursive: true });
  const plant = (name: string, says: string): void =>
    writeFileSync(join(poison, name),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\n`
      + `echo "${says}" >&2\nexit 97\n`, { mode: 0o755 });
  plant('gh', 'ccrc tests must never reach the real gh');
  plant('curl', 'ccrc tests must never reach a real server');
  plant('systemctl', 'ccrc tests must never query this box\'s real systemd');
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PATH: `${poison}:${process.env['PATH'] ?? ''}` };
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_DOCTOR_GH_TIMEOUT']) delete env[k];
  return env;
}

interface Result { code: number; stdout: string; stderr: string }

/** Runs the verb exactly as an operator does. `cli` lets the two manifest cases
 *  below point at a COPY of the tree whose `../deploy/gen-wrappers.mjs` is a
 *  stub; every other case runs the shipped file. */
function runWrappers(home: string, args: string[] = [], cli: string = CCRC): Result {
  const r = spawnSync('bash', [cli, 'wrappers', ...args],
    { env: wrappersEnv(home), encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Everything in the bin dir, sorted — the shape assertions are on the whole
 *  set, never on two names, so a file nobody expected shows up as a diff. */
const binEntries = (home: string): string[] =>
  (existsSync(binOf(home)) ? readdirSync(binOf(home)) : []).sort();

/** Every `<id>.pre-ccrc-*` backup this verb left behind, for `id`. */
const backupsFor = (home: string, id: string): string[] =>
  binEntries(home).filter((n) => n.startsWith(`${id}.pre-ccrc-`));

/** The remedy line that must immediately follow a refusal — doctor's own
 *  contract (`ccd/ccrc:52-61`), which this verb reuses: a verdict line and its
 *  remedy are two halves of ONE result and both go to stdout, adjacent. */
function remedyAfter(stdout: string, verdictMatch: RegExp): string {
  const lines = stdout.split('\n');
  const i = lines.findIndex((l) => verdictMatch.test(l));
  if (i < 0) throw new Error(`no line matched ${verdictMatch} in:\n${stdout}`);
  return lines[i + 1] ?? '';
}

/** A hand-written wrapper — no provenance marker — in the generated SHAPE, so
 *  `_wrap_parse_shape` reads it back as `ok` with exactly this triple. `note`
 *  is what makes it a different FILE from what ccrc would write while staying
 *  the same wrapper. */
function handWritten(
  opts: { suffix: string; secrets?: string; target?: string; note: string },
): string {
  const secretsLine = opts.secrets === undefined
    ? ''
    : `[ -r "$HOME/${opts.secrets}" ] && . "$HOME/${opts.secrets}"\n`;
  return '#!/usr/bin/env bash\n'
    + `# ${opts.note}\n`
    + `export CLAUDE_CONFIG_DIR="$HOME/${opts.suffix}"\n`
    + secretsLine
    + `exec "$HOME/.local/bin/${opts.target ?? UPSTREAM_ID}" "$@"\n`;
}

/** The reference box's `gpt` in miniature: a launcher that sets
 *  CLAUDE_CONFIG_DIR and then does forty lines of somebody else's work. Nothing
 *  about it matches the generated shape, so `_wrap_parse_shape` answers `no`
 *  and it can never be judged "equivalent" to anything. */
function bespokeLauncher(suffix: string): string {
  const body = [
    '#!/usr/bin/env bash',
    '# A launcher a human wrote, years before ccrc existed. Forty lines of it.',
    'set -euo pipefail',
    `export CLAUDE_CONFIG_DIR="$HOME/${suffix}"`,
    'export SOME_VENDOR_TOKEN_FILE="$HOME/.config/somebody-elses-tool/token"',
    'if [ ! -d "$CLAUDE_CONFIG_DIR" ]; then',
    '  mkdir -p "$CLAUDE_CONFIG_DIR"',
    'fi',
    'log() { printf "[%s] %s\\n" "$(date -u +%H:%M:%S)" "$*" >&2; }',
    'log "starting"',
  ];
  while (body.length < 40) body.push(`# padding line ${body.length}`);
  body.push('exec /opt/somebody-elses-tool/bin/run "$@"', '');
  return body.join('\n');
}

describe('ccrc wrappers: a fresh box', () => {
  it('writes every generated account at mode 0755, byte-identical to what the emitter emits', () => {
    const home = makeHome('ccrc-wrappers-fresh-');
    const r = runWrappers(home);
    expect(r.code, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0);

    for (const id of GENERATED_IDS) {
      const p = join(binOf(home), id);
      expect(readFileSync(p, 'utf8')).toBe(bodyFor(FIXTURE, id));
      expect(statSync(p).mode & 0o777).toBe(0o755);
      expect(r.stdout).toMatch(new RegExp(`^WRITE ${id}: `, 'm'));
    }
    // The whole set, so a stray temp file or a backup nobody asked for shows up
    // here rather than being invisible to three by-name assertions.
    expect(binEntries(home)).toEqual([...GENERATED_IDS].sort());
    expect(r.stdout).toMatch(/^summary: /m);
  });

  it('creates ~/.local/bin when the box has none — a missing bin dir is a fresh box, not an error', () => {
    const home = makeHome('ccrc-wrappers-nobin-', { bin: false });
    expect(existsSync(binOf(home))).toBe(false);
    const r = runWrappers(home);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(statSync(binOf(home)).isDirectory()).toBe(true);
    expect(statSync(binOf(home)).mode & 0o777).toBe(0o755);
    expect(binEntries(home)).toEqual([...GENERATED_IDS].sort());
  });

  it('a second run changes nothing on disk — measured on mtime, not on the message', () => {
    // A rewrite would print a perfectly plausible line too, so the message is
    // not the evidence. The inode's mtime is.
    const home = makeHome('ccrc-wrappers-noop-');
    expect(runWrappers(home).code).toBe(0);
    const before = GENERATED_IDS.map((id) => statSync(join(binOf(home), id)).mtimeMs);

    const r = runWrappers(home);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    const after = GENERATED_IDS.map((id) => statSync(join(binOf(home), id)).mtimeMs);
    expect(after).toEqual(before);
    for (const id of GENERATED_IDS) expect(r.stdout).toMatch(new RegExp(`^CONVERGED ${id}: `, 'm'));
    expect(binEntries(home)).toEqual([...GENERATED_IDS].sort());
  });
});

describe('ccrc wrappers: a file ccrc wrote', () => {
  it('rewrites its own wrapper when the roster changes, and keeps the old text as a backup', () => {
    const home = makeHome('ccrc-wrappers-rewrite-');
    expect(runWrappers(home).code).toBe(0);
    const old = readFileSync(join(binOf(home), 'claude-a'), 'utf8');

    const changed = clone(FIXTURE);
    const acct = changed.accounts.find((a) => a.id === 'claude-a');
    if (!acct) throw new Error('fixture bug');
    acct.configDirSuffix = '.claude-a-moved';
    putRoster(home, changed);

    const r = runWrappers(home);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(readFileSync(join(binOf(home), 'claude-a'), 'utf8')).toBe(bodyFor(changed, 'claude-a'));
    const backups = backupsFor(home, 'claude-a');
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(binOf(home), backups[0] ?? ''), 'utf8')).toBe(old);
    // The backup name carries a "." so it can never match WRAPPER_ID_RE —
    // neither `ccrc adopt` nor `ccrc doctor` will ever read it as an account.
    expect(backups[0]).toMatch(/^claude-a\.pre-ccrc-\d{8}T\d{6}Z$/);
  });

  it('refuses a wrapper of its own that has been hand-edited, and leaves it byte for byte', () => {
    const home = makeHome('ccrc-wrappers-edited-');
    expect(runWrappers(home).code).toBe(0);
    const p = join(binOf(home), 'claude-a');
    const edited = `${readFileSync(p, 'utf8')}# an operator added this line\n`;
    writeFileSync(p, edited);

    const r = runWrappers(home);
    expect(r.code).toBe(1);
    expect(readFileSync(p, 'utf8')).toBe(edited);
    expect(r.stdout).toMatch(/^REFUSE claude-a: /m);
    expect(remedyAfter(r.stdout, /^REFUSE claude-a: /)).toMatch(/^ {2}remedy: /);
    expect(backupsFor(home, 'claude-a')).toEqual([]);
  });

  it('--force rewrites a hand-edited wrapper, and the backup holds the edit', () => {
    const home = makeHome('ccrc-wrappers-edited-force-');
    expect(runWrappers(home).code).toBe(0);
    const p = join(binOf(home), 'claude-a');
    const edited = `${readFileSync(p, 'utf8')}# an operator added this line\n`;
    writeFileSync(p, edited);

    const r = runWrappers(home, ['--force']);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(readFileSync(p, 'utf8')).toBe(bodyFor(FIXTURE, 'claude-a'));
    const backups = backupsFor(home, 'claude-a');
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(binOf(home), backups[0] ?? ''), 'utf8')).toBe(edited);
  });

  it.skipIf(process.getuid?.() === 0)(
    'rewrites through a temp file and a rename, so a read-only wrapper is still replaced', () => {
      // The one OBSERVABLE difference between the shipped `cp → chmod → mv -f`
      // and the `> "$WRAPPER_BIN_DIR/$id"` a later reader would reach for.
      // `rename(2)` needs write permission on the DIRECTORY; a redirect needs it
      // on the FILE. An operator who chmod-ed a wrapper 0444 to stop something
      // touching it has a box the redirect version cannot converge — and the
      // atomicity that rename buys (a wrapper is never half-written, i.e. never
      // an account that cannot start a session) has no post-hoc trace at all,
      // so this is the assertion that stands in for it.
      const home = makeHome('ccrc-wrappers-readonly-');
      expect(runWrappers(home).code).toBe(0);
      const changed = clone(FIXTURE);
      const acct = changed.accounts.find((a) => a.id === 'claude-a');
      if (!acct) throw new Error('fixture bug');
      acct.configDirSuffix = '.claude-a-moved';
      putRoster(home, changed);
      const p = join(binOf(home), 'claude-a');
      chmodSync(p, 0o444);

      const r = runWrappers(home);
      expect(r.code, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0);
      expect(readFileSync(p, 'utf8')).toBe(bodyFor(changed, 'claude-a'));
      expect(statSync(p).mode & 0o777).toBe(0o755);
      // And the temp file is gone — a `.claude-a.tmp.<pid>` left on PATH is a
      // stray executable, which is the very thing `install_atomic`'s trailing
      // sweep exists for.
      expect(binEntries(home).filter((n) => n.includes('.tmp.'))).toEqual([]);
    });
});

describe('ccrc wrappers: a file ccrc did NOT write', () => {
  /** A hand-written wrapper for claude-a saying exactly what ccrc would say. */
  const equivalentText = handWritten({
    suffix: '.claude-a',
    secrets: '.cc-secrets/claude-a-oauth.env',
    note: 'hand-written in 2024, and still correct',
  });
  /** ...and one that says something else. */
  const divergentText = handWritten({
    suffix: '.claude-somewhere-else',
    secrets: '.cc-secrets/claude-a-oauth.env',
    note: 'hand-written, and pointing at a different config dir on purpose',
  });

  it('refuses an equivalent foreign wrapper by default, and says it is adoptable', () => {
    const home = makeHome('ccrc-wrappers-foreign-eq-');
    const p = join(binOf(home), 'claude-a');
    writeFileSync(p, equivalentText, { mode: 0o755 });

    const r = runWrappers(home);
    expect(r.code).toBe(1);
    expect(readFileSync(p, 'utf8')).toBe(equivalentText);
    expect(r.stdout).toMatch(/^REFUSE claude-a: /m);
    expect(remedyAfter(r.stdout, /^REFUSE claude-a: /)).toMatch(/--adopt/);
    expect(backupsFor(home, 'claude-a')).toEqual([]);
  });

  it('--adopt takes over an equivalent foreign wrapper, backing up the hand-written original', () => {
    const home = makeHome('ccrc-wrappers-foreign-adopt-');
    const p = join(binOf(home), 'claude-a');
    writeFileSync(p, equivalentText, { mode: 0o755 });

    const r = runWrappers(home, ['--adopt']);
    expect(r.code, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0);
    expect(readFileSync(p, 'utf8')).toBe(bodyFor(FIXTURE, 'claude-a'));
    const backups = backupsFor(home, 'claude-a');
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(binOf(home), backups[0] ?? ''), 'utf8')).toBe(equivalentText);
  });

  it('refuses a NON-equivalent foreign wrapper with --adopt too — adopt is not a clobber', () => {
    for (const args of [[], ['--adopt']]) {
      const home = makeHome(`ccrc-wrappers-foreign-ne-${args.length}-`);
      const p = join(binOf(home), 'claude-a');
      writeFileSync(p, divergentText, { mode: 0o755 });

      const r = runWrappers(home, args);
      expect(r.code, `args=${JSON.stringify(args)} stderr:\n${r.stderr}`).toBe(1);
      expect(readFileSync(p, 'utf8')).toBe(divergentText);
      expect(backupsFor(home, 'claude-a')).toEqual([]);
    }
  });

  it('THE GUARD: the remedy for a non-equivalent foreign file never mentions --force', () => {
    // D3: "Suggesting a clobber is how a mechanical operator destroys a
    // 142-line hand-written launcher." The remedy is "move it aside, or set
    // exec.kind to external in the roster" — and `--force` must not appear
    // anywhere in the run's output, because an operator scanning a refusal for
    // the next thing to type does not read which line it came from.
    const home = makeHome('ccrc-wrappers-foreign-noforce-');
    writeFileSync(join(binOf(home), 'claude-a'), divergentText, { mode: 0o755 });

    const r = runWrappers(home);
    expect(r.code).toBe(1);
    const remedy = remedyAfter(r.stdout, /^REFUSE claude-a: /);
    expect(remedy).toMatch(/^ {2}remedy: /);
    expect(remedy).not.toMatch(/--force/);
    expect(remedy).toMatch(/external/);
    expect(r.stdout).not.toMatch(/--force/);
    expect(r.stderr).not.toMatch(/--force/);
  });

  it.skipIf(process.getuid?.() === 0)(
    'refuses a wrapper it could not read, plainly', () => {
      // D3's last row. `unreadable` is NOT `foreign` and must never be folded
      // into it, however alike the two feel to write: every other refusal here
      // is a judgement about bytes this process actually read, and this one is
      // the admission that there were none. Skipped as root, which reads
      // anything — same reason as the sibling case in gen-wrappers.test.ts.
      const home = makeHome('ccrc-wrappers-unreadable-');
      const p = join(binOf(home), 'claude-a');
      writeFileSync(p, handWritten({ suffix: '.claude-a', note: 'unreadable' }));
      chmodSync(p, 0o000);

      const r = runWrappers(home);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(/^REFUSE claude-a: /m);
      const remedy = remedyAfter(r.stdout, /^REFUSE claude-a: /);
      expect(remedy).toMatch(/^ {2}remedy: /);
      // Its OWN remedy, not the catch-all's: deleting the `unreadable` arm
      // drops it into the "this verb does not know that classification" branch,
      // which refuses too — so a test that only checked for a refusal would
      // stay green through exactly that deletion.
      expect(remedy).toMatch(/No flag overrides this one/);
      expect(remedy).not.toMatch(/bug in ccrc/);
      expect(backupsFor(home, 'claude-a')).toEqual([]);
      chmodSync(p, 0o600);
      expect(readFileSync(p, 'utf8'))
        .toBe(handWritten({ suffix: '.claude-a', note: 'unreadable' }));
    });

  it.skipIf(process.getuid?.() === 0)(
    'refuses a wrapper it could not read under --force --adopt too — no flag overrides that one', () => {
      // "I could not read it" is not "I know what it is", so there is nothing
      // for a flag to override. This is the case that stops the `unreadable`
      // arm being quietly folded into the non-equivalent `foreign` arm, which
      // DOES honour --force: that fold would destroy a root-owned or mode-000
      // file ccrc had promised never to judge.
      const home = makeHome('ccrc-wrappers-unreadable-force-');
      const p = join(binOf(home), 'claude-a');
      const text = handWritten({ suffix: '.claude-a', note: 'unreadable' });
      writeFileSync(p, text);
      chmodSync(p, 0o000);

      const r = runWrappers(home, ['--force', '--adopt']);
      expect(r.code, `stdout:\n${r.stdout}`).toBe(1);
      expect(r.stdout).toMatch(/^REFUSE claude-a: /m);
      expect(backupsFor(home, 'claude-a')).toEqual([]);
      chmodSync(p, 0o600);
      expect(readFileSync(p, 'utf8')).toBe(text);
    });

  it('never clobbers a bespoke launcher sitting under a generated account\'s id', () => {
    const home = makeHome('ccrc-wrappers-bespoke-');
    const p = join(binOf(home), 'claude-a');
    const text = bespokeLauncher('.claude-a');
    expect(text.split('\n').length).toBeGreaterThanOrEqual(40);
    writeFileSync(p, text, { mode: 0o755 });

    const r = runWrappers(home);
    expect(r.code).toBe(1);
    expect(readFileSync(p, 'utf8')).toBe(text);
    expect(backupsFor(home, 'claude-a')).toEqual([]);
    expect(r.stdout).not.toMatch(/--force/);
  });

  // ── D-156: `foreign` was one classify covering two different sentences ───
  //
  // The reference box's `~/.local/bin/claude` is a 2741-byte LAUNCHER: it picks
  // which installed version to run and injects the upstream account's OAuth
  // token. It is under OVERSIZE_BYTES, so `gen-wrappers` reads it; it carries
  // no ccrc marker, so it classifies `foreign`; and `_wrap_parse_shape` answers
  // `no`. Until D-156 that landed in the same arm as "a wrapper that says
  // something else", which honours `--force` — so one flag under a mis-edited
  // roster overwrote it with a two-line wrapper ending
  // `exec "$HOME/.local/bin/claude" "$@"` — itself — while claude-a,
  // claude-b and claude-d all exec that same path. A fleet-wide exec
  // loop, from one flag.
  //
  // Until 2026-08-20 the only thing preventing that was the file's SIZE: at
  // ~334 MB it classified `oversize`, which no flag overrides. Shrinking the
  // file to 2.7 KB removed a lock nobody had written down.
  const UPSTREAM_LAUNCHER = [
    '#!/usr/bin/env bash',
    '# picks the newest installed version and injects an OAuth token',
    'set -euo pipefail',
    'shopt -s nullglob',
    'vers=("$HOME/.local/share/claude/versions"/*)',
    'newest="${vers[-1]}"',
    'CLAUDE_CODE_OAUTH_TOKEN="$(cat "$HOME/.cc-secrets/upstream-oauth.token")"',
    'export CLAUDE_CODE_OAUTH_TOKEN',
    'exec "$newest" "$@"',
    '',
  ].join('\n');

  // MUTATION MEASURED (2026-08-21): folding the split back — `elif [ "$dok" =
  // ok ]` -> `elif true`, i.e. the pre-D-156 single arm that honours `--force`
  // — reds two of the three cases below and nothing else:
  //   2 failed | 44 passed  (`ccrc-wrappers`)
  // The two are (a) and the explicit MUTATION case; the `--force`-still-works
  // case stays green, which is the point of having it.
  //
  // MUTATION MEASURED (2026-08-21), the OTHER direction: over-correcting —
  // killing `--force` in the `dok = ok` arm as well, i.e. "refuse everything
  // foreign" — reds exactly the opposite one:
  //   1 failed | 45 passed  (`ccrc-wrappers`)
  // So the pair discriminates the narrowing from a blanket ban. Neither
  // measurement is a claim about coverage this suite does not have: before
  // D-156 the `--force`-on-foreign arm (`ccd/ccrc`, the old :1523-1524) was
  // reached by ZERO tests in this file — every `--force` case here was
  // `ccrc-edited`, `unreadable`, `oversize`, or a stub manifest — so the
  // capability was live and unpinned. Both mutants restored afterwards.
  it('refuses a foreign file it cannot parse AS A WRAPPER, under --force --adopt too (D-156)', () => {
    const home = makeHome('ccrc-wrappers-foreign-unparseable-');
    const p = join(binOf(home), 'claude-a');
    writeFileSync(p, UPSTREAM_LAUNCHER, { mode: 0o755 });

    const r = runWrappers(home, ['--force', '--adopt']);
    expect(r.code, `stdout:\n${r.stdout}`).toBe(1);
    expect(readFileSync(p, 'utf8')).toBe(UPSTREAM_LAUNCHER);
    expect(backupsFor(home, 'claude-a')).toEqual([]);
    expect(r.stdout).toMatch(/^REFUSE claude-a: /m);
    // ITS OWN sentence, not the shared foreign one and not the catch-all's:
    // folding this arm back into the `dok = ok` arm restores the defect, and a
    // bare exit-1 assertion would stay green straight through that fold.
    expect(r.stdout).toMatch(/cannot parse it as a wrapper at all/);
    expect(r.stdout).not.toMatch(/which this verb does not know/);
    const remedy = remedyAfter(r.stdout, /^REFUSE claude-a: /);
    expect(remedy).toMatch(/^ {2}remedy: /);
    expect(remedy).toMatch(/No flag overrides this one\./);
    expect(remedy).not.toMatch(/--force/);
    expect(r.stdout).not.toMatch(/--force/);
  });

  it('--force still rewrites a foreign file that IS a wrapper — D-156 narrows the arm, it does not close it', () => {
    // The other side of cut 2, and the reason it is a `dok` test rather than a
    // blanket ban: when ccrc can parse the file it can name every field it
    // would replace, and `--force` answers a question ccrc actually asked.
    // Without this case, "refuse everything foreign" passes the two cases
    // around it and silently removes a capability the README documents.
    const home = makeHome('ccrc-wrappers-foreign-ne-force-');
    const p = join(binOf(home), 'claude-a');
    writeFileSync(p, divergentText, { mode: 0o755 });

    const r = runWrappers(home, ['--force']);
    expect(r.code, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0);
    expect(readFileSync(p, 'utf8')).toBe(bodyFor(FIXTURE, 'claude-a'));
    const backups = backupsFor(home, 'claude-a');
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(binOf(home), backups[0] ?? ''), 'utf8')).toBe(divergentText);
    expect(r.stdout).toMatch(/^REWRITE claude-a: /m);
  });

  it('MUTATION: the parse gate is what stops --force clobbering an unparseable launcher (D-156)', () => {
    // Written as "did it write?" rather than "did it refuse?" so it cannot be
    // satisfied by any refusal that happens to arrive for a different reason.
    const home = makeHome('ccrc-wrappers-foreign-dok-mutation-');
    const p = join(binOf(home), 'claude-a');
    writeFileSync(p, UPSTREAM_LAUNCHER, { mode: 0o755 });

    const r = runWrappers(home, ['--force']);
    expect(r.stdout).not.toMatch(/^REWRITE claude-a: /m);
    expect(readFileSync(p, 'utf8')).toBe(UPSTREAM_LAUNCHER);
    expect(binEntries(home).filter((n) => n.startsWith('claude-a.'))).toEqual([]);
  });
});

// ── D-156: LOCK 5, THE WITNESS INDEX ──────────────────────────────────────
//
// D-156 (cut 2) closed the `--force` door on a file this reader cannot parse.
// It does NOT close the door ccrc's own remedy opens: "move it aside and
// re-run" makes the path `absent`, and the absent arm writes with NO FLAG AT
// ALL — after which the file is `ccrc-unmodified` and is rewritten on every
// roster change for ever. `ccrc install` reaches that path too.
//
// Lock 5 is the only one of the five whose evidence is OTHER FILES: it refuses
// to write `~/.local/bin/<id>` while anything else already on disk execs that
// id as its upstream binary. That is what survives the subject file being
// moved aside — the witnesses are still there — and it is why locks 2 and 4
// cannot substitute for it: both key on `execKind === 'generated'`, so one bug
// in that predicate defeats them together, and neither looks at the disk.
// MUTATION MEASURED (2026-08-21), four mutants, restored between each, full
// `ccrc-wrappers` run every time (baseline 54/54):
//   1. the witness refusal never fires (`if [ -n "$wit" ]` -> `if false`)
//        2 failed | 52 passed — the move-aside case and the ordering case.
//   2. the blind-index arm falls open (`if [ -n "$wit_blind" ]` -> `if false`)
//        1 failed | 53 passed — the unreadable-candidate case, alone.
//   3. `foreign` skips the pre-table gate (added to the `unreadable|oversize`
//      arm), so the foreign arm speaks instead
//        1 failed | 53 passed — the ordering case, alone. This is what makes
//        "the old `move it aside` remedy is not a lie" a mechanism rather than
//        an argument: the sentence is not reworded, it is made unreachable.
//   4. the strict-parse requirement dropped, so any shebang file is a witness
//        11 failed | 43 passed — and NOT the cases above. An over-broad witness
//        predicate wedges a legitimate box, which is the failure mode the
//        negative half of this lock has no direct assertion for; mutant 4 is
//        the closest thing to a proof that the narrowing is load-bearing.
//
// Stated so the table claims no coverage it does not have: the "under every
// flag" case, the termination case and the roster-flip half of the legitimate
// box case all stay GREEN under mutant 1, because D-156's cut 2 already refuses
// that file on its own. Their value is as guards against BOTH locks regressing,
// not as evidence for this one.
describe('ccrc wrappers: the witness lock (D-156)', () => {
  /** The reference box's `~/.local/bin/claude`: a launcher that picks a version
   *  and injects a token, deliberately never matching
   *  `_wrap_declares_config_dir`'s regex. Padded past 2 KB so it is the size
   *  the real one is — small enough to be READ (so it classifies `foreign`,
   *  not `oversize`), which is the whole shape of the defect. */
  const LAUNCHER = [
    '#!/usr/bin/env bash',
    '# Launcher: picks the newest installed version and injects an OAuth token.',
    ...Array.from({ length: 40 }, (_, i) => `# padding line ${i} — the real launcher is 2741 bytes of exactly this kind of prose.`),
    'set -euo pipefail',
    'shopt -s nullglob',
    'vers=("$HOME/.local/share/claude/versions"/*)',
    'newest="${vers[-1]:-}"',
    '[ -n "$newest" ] || { echo "no installed version" >&2; exit 127; }',
    'exec "$newest" "$@"',
    '',
  ].join('\n');

  /** FIXTURE with the upstream moved off `claude` — the mis-edit. `claude`
   *  becomes a generated account (so it gets a `wrapper` record and is written)
   *  and `claude-a` becomes the upstream. parseRoster still sees exactly one. */
  function misEdited(): Roster {
    const r = clone(FIXTURE);
    for (const a of r.accounts) {
      if (a.id === 'claude') a.exec = { kind: 'generated' };
      if (a.id === 'claude-a') a.exec = { kind: 'upstream' };
    }
    return r;
  }

  /** A converged reference box: the three generated wrappers as ccrc writes
   *  them, then the launcher planted at the upstream path. */
  function seededBox(prefix: string): string {
    const home = makeHome(prefix);
    expect(runWrappers(home).code).toBe(0);
    writeFileSync(join(binOf(home), 'claude'), LAUNCHER, { mode: 0o755 });
    return home;
  }

  it('refuses to write an id that other wrappers on disk already exec — under every flag', () => {
    const home = seededBox('ccrc-wrappers-witness-flags-');
    putRoster(home, misEdited());
    const p = join(binOf(home), 'claude');

    for (const flags of [[], ['--force'], ['--adopt'], ['--force', '--adopt'], ['--dry-run']]) {
      const r = runWrappers(home, flags);
      expect(r.code, `flags=${JSON.stringify(flags)} stdout:\n${r.stdout}`).toBe(1);
      expect(r.stdout, `flags=${JSON.stringify(flags)}`).toMatch(/^REFUSE claude: /m);
      expect(remedyAfter(r.stdout, /^REFUSE claude: /)).toMatch(/No flag overrides this one/);
      expect(readFileSync(p, 'utf8')).toBe(LAUNCHER);
      expect(backupsFor(home, 'claude')).toEqual([]);
    }
  });

  it('closes the move-aside hole: the witnesses refuse the write even once the file is gone', () => {
    // THE POINT OF THE WHOLE LOCK. Before D-156, obeying ccrc's own printed
    // remedy made the path `absent`, and the absent arm writes with no flag.
    const home = seededBox('ccrc-wrappers-witness-moveaside-');
    putRoster(home, misEdited());
    renameSync(join(binOf(home), 'claude'), join(binOf(home), 'claude.saved-x'));

    const r = runWrappers(home);                       // NO FLAGS
    expect(r.code, r.stdout).toBe(1);
    expect(r.stdout).toMatch(/^REFUSE claude: /m);
    expect(existsSync(join(binOf(home), 'claude'))).toBe(false);
    expect(remedyAfter(r.stdout, /^REFUSE claude: /)).toMatch(/Moving the file aside does NOT help/);
  });

  it('speaks BEFORE the foreign arm, so ccrc never prints a remedy that would break the box', () => {
    // The placement guard. `move it aside` is still the right remedy for a
    // foreign file nothing execs, so it is not reworded — instead the witness
    // gate is placed above the decision table, which makes that sentence
    // unreachable for a witnessed id. Moving the gate below the table brings
    // it back, and reds this.
    const home = seededBox('ccrc-wrappers-witness-ordering-');
    putRoster(home, misEdited());

    const r = runWrappers(home);
    expect(r.stdout).toMatch(/^REFUSE claude: /m);
    expect(r.stdout).not.toContain('move it aside');
    expect(r.stdout).not.toContain('it is not the wrapper this roster describes');
  });

  it('leaves a legitimate box entirely alone, and the same box refuses once the roster is wrong', () => {
    // The negative half — "a correct box still converges" — has no mutation of
    // its own: deleting the lock passes it too, because silence and absence
    // look identical from outside. The final flip is the honest proxy: it
    // proves the index built on THIS box could name `claude`, so the silence
    // above was a decision rather than an absence. Under deletion, it reds.
    const home = seededBox('ccrc-wrappers-witness-legit-');
    // A box with the noise a real one carries: a bespoke launcher execing the
    // upstream, its symlink alias, a big marked script, a non-script blob, and
    // a dated backup.
    const bin = binOf(home);
    writeFileSync(join(bin, 'ccgpt'), `${bespokeLauncher('.claude-gpt')}\nexec "$HOME/.local/bin/claude" "$@"\n`, { mode: 0o755 });
    symlinkSync('ccgpt', join(bin, 'gpt'));
    writeFileSync(join(bin, 'ccd'), `#!/usr/bin/env bash\n${'# filler\n'.repeat(90000)}`, { mode: 0o755 });
    writeFileSync(join(bin, 'bigblob'), Buffer.alloc(2 * 1024 * 1024, 0x41), { mode: 0o755 });
    writeFileSync(join(bin, 'claude-a.bak-20260805-181306'), readFileSync(join(bin, 'claude-a')));

    const before = binEntries(home);
    const mt = Object.fromEntries(before.map((n) => [n, statSync(join(bin, n)).mtimeMs]));

    const r = runWrappers(home);
    expect(r.code, r.stdout).toBe(0);
    expect(r.stdout).not.toMatch(/^REFUSE/m);
    for (const id of GENERATED_IDS) expect(r.stdout).toMatch(new RegExp(`^CONVERGED ${id}: `, 'm'));
    expect(binEntries(home)).toEqual(before);
    for (const n of before) expect(statSync(join(bin, n)).mtimeMs, n).toBe(mt[n]);

    putRoster(home, misEdited());
    const r2 = runWrappers(home);
    expect(r2.code, r2.stdout).toBe(1);
    expect(r2.stdout).toMatch(/^REFUSE claude: /m);
  });

  it('MUTATION: without the lock the box stops terminating — so the assertion is that it exits', () => {
    // The measured failure is not a lost file, it is a box that never exits:
    // claude-a/claude-b/claude-d all end `exec "$HOME/.local/bin/claude"`,
    // so a generated wrapper written AT `claude` closes an exec loop across
    // every lane at once. A byte-equality assertion would go green for the
    // wrong reason; this runs the thing.
    const home = seededBox('ccrc-wrappers-witness-terminates-');
    putRoster(home, misEdited());

    const r = runWrappers(home, ['--force']);
    expect(r.code, r.stdout).toBe(1);
    expect(r.stdout).toMatch(/^REFUSE claude: /m);

    const run = spawnSync('bash', ['-c', `exec "${join(binOf(home), 'claude')}" --version`],
      { env: wrappersEnv(home), encoding: 'utf8', timeout: 5000 });
    expect(run.signal, 'the wrapper chain never terminated — an exec loop').toBe(null);
    expect(run.status, 'it must EXIT; the code itself is whatever the launcher does').not.toBe(null);
  });

  it.skipIf(process.getuid?.() === 0)(
    'refuses every write when it cannot read an id-shaped file, rather than guessing what execs what', () => {
      // Fail closed: a file this run could not read might exec anything, so it
      // cannot prove nothing execs the id it is about to write.
      const home = seededBox('ccrc-wrappers-witness-blind-');
      const mystery = join(binOf(home), 'mystery');
      writeFileSync(mystery, '#!/usr/bin/env bash\nexec "$HOME/.local/bin/claude" "$@"\n');
      chmodSync(mystery, 0o000);

      const r = runWrappers(home, ['--force']);
      expect(r.code, r.stdout).toBe(1);
      for (const id of GENERATED_IDS) expect(r.stdout).toMatch(new RegExp(`^REFUSE ${id}: `, 'm'));
      expect(remedyAfter(r.stdout, /^REFUSE claude-a: /)).toMatch(/No flag overrides this one/);

      chmodSync(mystery, 0o644);
      expect(runWrappers(home).code).toBe(0);
    });

  it.skipIf(process.getuid?.() === 0)(
    'lets the unreadable ARM speak for an unreadable write target, not the blind-index one', () => {
      // The regression that caught the first prototype: a mode-000 file AT a
      // write-target path is both an unreadable candidate and a record with its
      // own table verdict, and the table's voice is the right one — its remedy
      // is pinned elsewhere in this file.
      const home = seededBox('ccrc-wrappers-witness-unreadable-target-');
      const p = join(binOf(home), 'claude-a');
      chmodSync(p, 0o000);

      const r = runWrappers(home);
      expect(r.code).toBe(1);
      const remedy = remedyAfter(r.stdout, /^REFUSE claude-a: /);
      expect(remedy).toMatch(/No flag overrides this one/);
      expect(remedy).not.toMatch(/so it cannot tell/);
      chmodSync(p, 0o600);
    });

  it('refuses the whole run when stat is not on PATH, having written nothing', () => {
    // EVERY other tool stays on PATH — a stub holding symlinks to all of them
    // and to nothing named `stat`. The first draft of this test planted only a
    // handful and passed VACUOUSLY: the run died on a missing `mkdir`, and the
    // `/stat/` assertion matched the fixture's own tmp path, which had "nostat"
    // in it. Hence both the exhaustive stub and the distinctive phrase below.
    const home = seededBox('ccrc-wrappers-witness-nogauge-');
    const before = binEntries(home);
    const stub = join(home, 'gauge-less-bin');
    mkdirSync(stub, { recursive: true });
    const seen = new Set<string>();
    for (const dir of (process.env.PATH ?? '').split(':').filter(Boolean)) {
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        if (name === 'stat' || seen.has(name)) continue;
        seen.add(name);
        try { symlinkSync(join(dir, name), join(stub, name)); } catch { /* first wins */ }
      }
    }
    expect(existsSync(join(stub, 'mkdir')), 'the stub must be complete but for stat').toBe(true);
    expect(existsSync(join(stub, 'stat'))).toBe(false);

    const r = spawnSync('bash', [CCRC, 'wrappers'],
      { env: { ...wrappersEnv(home), PATH: stub }, encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    // The verb's OWN sentence about its OWN dependency — not merely the string
    // "stat" appearing somewhere, which a tmp path can supply for free.
    expect(`${r.stdout}${r.stderr}`).toMatch(/stat is required by 'ccrc wrappers'/);
    expect(`${r.stdout}${r.stderr}`).toMatch(/[Nn]othing was written/);
    expect(binEntries(home)).toEqual(before);
  });
});

describe('ccrc wrappers: an oversize candidate (D-81)', () => {
  // Same sparse-file technique `gen-wrappers.test.ts` uses for its own
  // oversize fixture: `openSync` + `ftruncateSync`, so the test costs no
  // real disk. This drives the REAL `deploy/gen-wrappers.mjs` (via the
  // default `cli` in `runWrappers`), which — with the node side of D-81
  // shipped — classifies this candidate `oversize`. What this suite pins is
  // that bash REFUSES it by its own specific arm rather than falling to the
  // decision table's catch-all ("… which this verb does not know", the
  // generic manifest-distrust wording): today, before the `oversize` arm
  // exists, that catch-all is exactly what fires, which is why this is red
  // first.
  function makeOversizeCandidate(home: string, id: string): void {
    const fd = openSync(join(binOf(home), id), 'w');
    try {
      ftruncateSync(fd, 1024 * 1024 + 1); // OVERSIZE_BYTES + 1, sparse
    } finally {
      closeSync(fd);
    }
  }

  for (const args of [[], ['--adopt'], ['--force'], ['--force', '--adopt']]) {
    it(`refuses claude-a with ${args.length === 0 ? 'no flags' : args.join(' ')} — no flag overrides an oversize file`, () => {
      const home = makeHome(`ccrc-wrappers-oversize-${args.join('') || 'none'}-`);
      makeOversizeCandidate(home, 'claude-a');

      const r = runWrappers(home, args);
      expect(r.code, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(1);
      expect(r.stdout).toMatch(/^REFUSE claude-a: /m);
      // ITS OWN sentence, not the catch-all's: deleting the `oversize` arm
      // drops it into "$gen classified it as \"oversize\", which this verb
      // does not know" — which refuses too, so a bare exit-1 assertion would
      // stay green through exactly that deletion.
      expect(r.stdout).toMatch(/over 1 MiB/);
      expect(r.stdout).not.toMatch(/which this verb does not know/);
      const remedy = remedyAfter(r.stdout, /^REFUSE claude-a: /);
      expect(remedy).toMatch(/^ {2}remedy: /);
      expect(remedy).not.toMatch(/bug in ccrc/);
      // Both escape hatches, named: move the big file aside (if claude-a
      // should be generated), or declare it upstream (if it IS the upstream
      // binary this fixture is standing in for).
      expect(remedy).toMatch(/move.*aside/);
      expect(remedy).toMatch(/"upstream"/);
      expect(backupsFor(home, 'claude-a')).toEqual([]);
      // Left byte for byte — still sparse, still over the threshold.
      expect(statSync(join(binOf(home), 'claude-a')).size).toBeGreaterThan(1024 * 1024);
    });
  }

  it('THE GUARD: the remedy for an oversize file never mentions --force either', () => {
    // The same guard `ccrc-wrappers.test.ts` already holds `foreign` to
    // (D3: "Suggesting a clobber is how a mechanical operator destroys a
    // 142-line hand-written launcher"), extended to this arm: an operator
    // scanning refusals for the next thing to type must never find --force
    // beside a file this verb has just said is categorically not a wrapper.
    const home = makeHome('ccrc-wrappers-oversize-noforce-');
    makeOversizeCandidate(home, 'claude-a');

    const r = runWrappers(home, ['--force']);
    expect(r.code).toBe(1);
    const remedy = remedyAfter(r.stdout, /^REFUSE claude-a: /);
    expect(remedy).toMatch(/^ {2}remedy: /);
    expect(remedy).not.toMatch(/--force/);
    expect(r.stdout).not.toMatch(/--force/);
    expect(r.stderr).not.toMatch(/--force/);
  });

  it('does not stop the OTHER generated accounts converging', () => {
    // A refusal is per-account, not per-run: the pre-pass validates the
    // whole manifest before any write, but `oversize` is a fact about the
    // BOX (a disk-state judgement, like `foreign`/`unreadable`), not about
    // the manifest, so it belongs to the action pass and must not abort
    // siblings that are perfectly fine to write.
    const home = makeHome('ccrc-wrappers-oversize-siblings-');
    makeOversizeCandidate(home, 'claude-a');

    const r = runWrappers(home);
    expect(r.code).toBe(1);
    expect(readFileSync(join(binOf(home), 'claude-b'), 'utf8')).toBe(bodyFor(FIXTURE, 'claude-b'));
    expect(readFileSync(join(binOf(home), 'claude-d'), 'utf8')).toBe(bodyFor(FIXTURE, 'claude-d'));
    expect(r.stdout).toMatch(/^WRITE claude-b: /m);
    expect(r.stdout).toMatch(/^WRITE claude-d: /m);
  });
});

describe('ccrc wrappers: upstream and external are never touched, under any flag', () => {
  // The absolute rule (plan D3). `claude` is a ~304 MB ELF and `gpt` is
  // somebody else's 142-line launcher; ccrc writes a wrapper only for an
  // account whose `exec.kind` is `generated`, and there is no flag that widens
  // that. Structurally: `deploy/gen-wrappers.mjs` emits a `wrapper` record only
  // for a generated account, this verb iterates those records and nothing else,
  // and it re-checks that the staged wrapper does not exec its own id (which is
  // what a wrapper written for the upstream account would do).
  const SENTINEL_UPSTREAM = '\x7fELF ccrc-test sentinel — the real one is a 304 MB binary\n';
  const SENTINEL_EXTERNAL = bespokeLauncher('.claude-gpt');

  for (const args of [[], ['--adopt'], ['--force'], ['--force', '--adopt']]) {
    it(`leaves ${UPSTREAM_ID} and ${EXTERNAL_ID} byte for byte with ${args.length === 0 ? 'no flags' : args.join(' ')}`, () => {
      const home = makeHome(`ccrc-wrappers-untouchable-${args.join('') || 'none'}-`);
      writeFileSync(join(binOf(home), UPSTREAM_ID), SENTINEL_UPSTREAM, { mode: 0o755 });
      writeFileSync(join(binOf(home), EXTERNAL_ID), SENTINEL_EXTERNAL, { mode: 0o755 });

      const r = runWrappers(home, args);
      expect(r.code, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0);
      expect(readFileSync(join(binOf(home), UPSTREAM_ID), 'utf8')).toBe(SENTINEL_UPSTREAM);
      expect(readFileSync(join(binOf(home), EXTERNAL_ID), 'utf8')).toBe(SENTINEL_EXTERNAL);
      expect(backupsFor(home, UPSTREAM_ID)).toEqual([]);
      expect(backupsFor(home, EXTERNAL_ID)).toEqual([]);
      // Nothing else appeared or vanished either: the three generated accounts
      // got written, the two untouchables stayed, and there is no sixth file.
      expect(binEntries(home)).toEqual([...GENERATED_IDS, UPSTREAM_ID, EXTERNAL_ID].sort());
    });
  }
});

describe('ccrc wrappers: --dry-run', () => {
  it('writes nothing at all, and describes what it would do', () => {
    const home = makeHome('ccrc-wrappers-dry-');
    const r = runWrappers(home, ['--dry-run']);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(binEntries(home)).toEqual([]);
    for (const id of GENERATED_IDS) expect(r.stdout).toMatch(new RegExp(`^WOULD-WRITE ${id}: `, 'm'));
  });

  it('still refuses — a dry run reports the same verdicts, it does not soften them', () => {
    const home = makeHome('ccrc-wrappers-dry-refuse-');
    expect(runWrappers(home).code).toBe(0);
    const p = join(binOf(home), 'claude-a');
    const edited = `${readFileSync(p, 'utf8')}# an operator added this line\n`;
    writeFileSync(p, edited);

    const r = runWrappers(home, ['--dry-run']);
    expect(r.code).toBe(1);
    expect(readFileSync(p, 'utf8')).toBe(edited);
    expect(backupsFor(home, 'claude-a')).toEqual([]);
  });

  it('creates no directories on a box that has none — not even ~/.local', () => {
    // Measured before this was fixed: a dry run against a fresh box created
    // BOTH `$HOME/.local` and `$HOME/.local/bin` and exited 0, while the README
    // promised it reports without touching anything. It was untested in both
    // directions because every other dry-run case here starts from a `makeHome`
    // that has already made the bin dir. A dry run that creates directories is
    // a dry run an operator cannot use to find out what a real run would do.
    const home = makeHome('ccrc-wrappers-dry-nobin-', { bin: false });
    expect(existsSync(join(home, '.local'))).toBe(false);

    const r = runWrappers(home, ['--dry-run']);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(existsSync(join(home, '.local'))).toBe(false);
    expect(existsSync(binOf(home))).toBe(false);
    // And it still answers the question: every account would be written,
    // because on a box with no bin directory nothing is there.
    for (const id of GENERATED_IDS) expect(r.stdout).toMatch(new RegExp(`^WOULD-WRITE ${id}: `, 'm'));
  });

  it('leaves a stray temp file alone — a dry run removes nothing either', () => {
    const home = makeHome('ccrc-wrappers-dry-stray-');
    const stray = join(binOf(home), '.claude-a.tmp.999');
    writeFileSync(stray, 'half a wrapper', { mode: 0o755 });
    const r = runWrappers(home, ['--dry-run']);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(existsSync(stray)).toBe(true);
    expect(r.stdout).not.toMatch(/^SWEPT /m);
  });

  it('would not write a backup either', () => {
    const home = makeHome('ccrc-wrappers-dry-backup-');
    expect(runWrappers(home).code).toBe(0);
    const changed = clone(FIXTURE);
    const acct = changed.accounts.find((a) => a.id === 'claude-a');
    if (!acct) throw new Error('fixture bug');
    acct.configDirSuffix = '.claude-a-moved';
    putRoster(home, changed);
    const before = readFileSync(join(binOf(home), 'claude-a'), 'utf8');

    const r = runWrappers(home, ['--dry-run']);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/^WOULD-REWRITE claude-a: /m);
    expect(readFileSync(join(binOf(home), 'claude-a'), 'utf8')).toBe(before);
    expect(backupsFor(home, 'claude-a')).toEqual([]);
  });
});

describe('ccrc wrappers: its own litter', () => {
  it('sweeps a stray temp file an interrupted run left on PATH, and says so', () => {
    // `install_atomic` ENDS with `rm -f $dest.incoming-*`, and its comment
    // records that as a reproduced review finding: a run killed between the
    // copy and the rename leaves a mode-0755 file in a directory that is on
    // PATH, and nothing else will ever remove it. The "." in the name keeps it
    // out of the ACCOUNT namespace, which is a different half of the same
    // finding — this is the stray-executable half.
    const home = makeHome('ccrc-wrappers-sweep-');
    expect(runWrappers(home).code).toBe(0);          // converge first
    const stray = join(binOf(home), '.claude-a.tmp.4242');
    writeFileSync(stray, 'half a wrapper, from a run that was killed', { mode: 0o755 });

    // The account is CONVERGED on this run, so a sweep that only ran after a
    // write would never reach it — which is the common case, not the exotic one.
    const r = runWrappers(home);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(existsSync(stray)).toBe(false);
    expect(r.stdout).toMatch(/^SWEPT claude-a: /m);
    expect(binEntries(home)).toEqual([...GENERATED_IDS].sort());
  });

  it('sweeps only names it could have made itself', () => {
    // The glob carries the whole `.<id>.tmp.` shape for an id off the manifest,
    // so nothing else in ~/.local/bin is at risk from it — including a file
    // whose name merely looks temp-ish.
    const home = makeHome('ccrc-wrappers-sweep-scope-');
    const notOurs = join(binOf(home), '.something-else.tmp.1');
    const alsoNotOurs = join(binOf(home), '.claude-a.tmp');   // no pid suffix
    writeFileSync(notOurs, 'somebody else\'s file');
    writeFileSync(alsoNotOurs, 'somebody else\'s file');

    const r = runWrappers(home);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(existsSync(notOurs)).toBe(true);
    expect(existsSync(alsoNotOurs)).toBe(true);
    expect(r.stdout).not.toMatch(/^SWEPT /m);
  });
});

describe('ccrc wrappers: orphans', () => {
  it('reports a leftover ccrc wrapper the roster no longer names, and never removes it', () => {
    const home = makeHome('ccrc-wrappers-orphan-');
    const leftover = markGenerated(generateWrapperBody(
      { id: 'leftover', configDirSuffix: '.claude-leftover', execKind: 'generated' }, UPSTREAM_ID,
    ));
    writeFileSync(join(binOf(home), 'leftover'), leftover, { mode: 0o755 });

    const r = runWrappers(home);
    // An orphan is a WARN-class fact about the box, not a refusal: it does not
    // change the exit code, because nothing about it stopped the convergence.
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(readFileSync(join(binOf(home), 'leftover'), 'utf8')).toBe(leftover);
    expect(r.stdout).toMatch(/^ORPHAN leftover: /m);
    expect(binEntries(home)).toEqual([...GENERATED_IDS, 'leftover'].sort());
  });
});

describe('ccrc wrappers: a manifest it cannot trust', () => {
  /** A copy of the shipped tree whose `deploy/gen-wrappers.mjs` is `stub`.
   *  `ccrc` resolves both its shape library and the generator through
   *  `${BASH_SOURCE[0]}`, so a copied `ccd/` plus a sibling `deploy/` is the
   *  whole install as far as this verb is concerned. */
  function kitWith(stub: string): string {
    const kit = mkTmp('ccrc-wrappers-kit-');
    mkdirSync(join(kit, 'ccd'), { recursive: true });
    mkdirSync(join(kit, 'deploy'), { recursive: true });
    for (const f of ['ccrc', 'ccrc-wrapper-shape']) {
      writeFileSync(join(kit, 'ccd', f), readFileSync(join(CCD_DIR, f), 'utf8'), { mode: 0o755 });
    }
    writeFileSync(join(kit, 'deploy', 'gen-wrappers.mjs'), stub, { mode: 0o755 });
    return join(kit, 'ccd', 'ccrc');
  }

  it('refuses a manifest whose summary and wrapper records disagree, and writes nothing', () => {
    // D6: bash asserts it read exactly `<generated>` wrapper records, so a
    // manifest truncated in transit is LOUD. Without that assertion a
    // half-delivered manifest converges half a box and reports success.
    const cli = kitWith(
      'process.stdout.write("summary\\t5\\t3\\t1\\t1\\nwrapper\\tclaude-a\\tabsent\\tno\\n");\n',
    );
    const home = makeHome('ccrc-wrappers-truncated-');
    const r = runWrappers(home, [], cli);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: /m);
    // Loose `/3/` and `/1/` regexes used to pin this — but with the count
    // assertion (`ccd/ccrc`'s `_ccrc_die "the manifest from $gen is
    // truncated: …"`) deleted, the run still exits 1 via the next check down
    // (staged text absent), whose message embeds `$gen` — a tmpdir path that
    // can satisfy those digits by chance. `/truncated/` is the die message's
    // own distinctive word, so it can only pass through THIS gate.
    expect(r.stderr).toMatch(/truncated/);
    expect(binEntries(home)).toEqual([]);
  });

  it('refuses a manifest record whose id is not an account id, before a path is built from it', () => {
    // The id off the manifest becomes a FILENAME under ~/.local/bin, and the
    // gate is on the ID rather than on the path it would produce — which is
    // what makes it hold for a traversing id as well as for this one. A
    // `claude-a.bak` is the concrete, measured shape: `.bak-<date>` siblings are
    // exactly what a real box accumulates and what WRAPPER_ID_RE exists to keep
    // out of the account namespace (`ccd/ccrc-wrapper-shape:63-67`). The stub
    // STAGES the file, so without the gate this verb really would install it.
    const cli = kitWith(
      'import { writeFileSync } from "node:fs";\nimport { join } from "node:path";\n'
      + 'writeFileSync(join(process.argv[4], "claude-a.bak"), "#!/usr/bin/env bash\\nexport CLAUDE_CONFIG_DIR=\\"$HOME/.x\\"\\nexec \\"$HOME/.local/bin/claude\\" \\"$@\\"\\n");\n'
      + 'process.stdout.write("summary\\t1\\t1\\t0\\t0\\nwrapper\\tclaude-a.bak\\tabsent\\tno\\n");\n',
    );
    const home = makeHome('ccrc-wrappers-badid-');
    const r = runWrappers(home, ['--force'], cli);
    expect(r.code).toBe(1);
    expect(binEntries(home)).toEqual([]);
    expect(r.stderr).toMatch(/claude-a\.bak/);
  });

  it('refuses to install a wrapper that would exec itself — the upstream account\'s own shape', () => {
    // The structural half of "ccrc never writes the upstream account". A
    // wrapper installed at ~/.local/bin/claude that ends
    // `exec "$HOME/.local/bin/claude" "$@"` is a fork bomb, and it is exactly
    // what a generator talked into staging the upstream account would produce.
    const staged = markGenerated(generateWrapperBody(
      { id: 'claude', configDirSuffix: '.claude', execKind: 'generated' }, UPSTREAM_ID,
    ));
    const cli = kitWith(
      'import { writeFileSync } from "node:fs";\nimport { join } from "node:path";\n'
      + `writeFileSync(join(process.argv[4], "claude"), ${JSON.stringify(staged)});\n`
      + 'process.stdout.write("summary\\t1\\t1\\t0\\t0\\nwrapper\\tclaude\\tabsent\\tno\\n");\n',
    );
    const home = makeHome('ccrc-wrappers-selfexec-');
    const r = runWrappers(home, ['--force'], cli);
    expect(r.code).toBe(1);
    expect(binEntries(home)).toEqual([]);
    expect(r.stderr).toMatch(/claude/);
  });

  it('refuses the WHOLE RUN when an id is both a wrapper to write and an account to protect', () => {
    // LOCK 1 (D-80), and the first case in this file that can go red from a
    // change to `cmd_wrappers` ALONE. The four `never touched` cases above
    // cannot: node never hands bash an upstream or external id, so no mutation
    // of the bash can make them fail. This one hands it one on purpose.
    //
    // The measured leak it closes needed no flag at all: a manifest saying
    // `wrapper<TAB>gpt<TAB>ccrc-unmodified<TAB>no` made a plain `ccrc wrappers`
    // rewrite an external account's launcher and exit 0. Only the default
    // `foreign` arm refused such a file — generic foreign protection, not
    // protection of an external ACCOUNT — and here the classify says
    // `ccrc-unmodified`, which walks straight past it.
    const staged = markGenerated(generateWrapperBody(
      { id: 'gpt', configDirSuffix: '.claude-gpt', execKind: 'generated' }, UPSTREAM_ID,
    ));
    const cli = kitWith(
      'import { writeFileSync } from "node:fs";\nimport { join } from "node:path";\n'
      + `writeFileSync(join(process.argv[4], "gpt"), ${JSON.stringify(staged)});\n`
      + 'process.stdout.write("summary\\t2\\t1\\t1\\t0\\nwrapper\\tgpt\\tccrc-unmodified\\tno\\nprotected\\tgpt\\n");\n',
    );
    const home = makeHome('ccrc-wrappers-protected-overlap-');
    const launcher = bespokeLauncher('.claude-gpt');
    writeFileSync(join(binOf(home), EXTERNAL_ID), launcher, { mode: 0o755 });

    const r = runWrappers(home, ['--force', '--adopt'], cli);
    expect(r.code).toBe(1);
    expect(readFileSync(join(binOf(home), EXTERNAL_ID), 'utf8')).toBe(launcher);
    expect(backupsFor(home, EXTERNAL_ID)).toEqual([]);
    expect(binEntries(home)).toEqual([EXTERNAL_ID]);
    expect(r.stderr).toMatch(/gpt/);
  });

  it('refuses a manifest whose protected records are truncated away', () => {
    // Without this count the whole of lock 1 is deletable by a truncation:
    // the protected records are the last thing before the orphans, so a
    // manifest cut a few bytes early arrives with every wrapper record intact
    // and the untouchable list simply absent — and an absent list overlaps
    // nothing. It is the same hole the wrapper-record count already closes,
    // one record type further down.
    const cli = kitWith(
      'process.stdout.write("summary\\t5\\t0\\t1\\t1\\n");\n',
    );
    const home = makeHome('ccrc-wrappers-protected-truncated-');
    const r = runWrappers(home, [], cli);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/protected record/);
    expect(binEntries(home)).toEqual([]);
  });

  it('a bad record aborts before the FIRST write — "nothing was written" is true, not reassuring', () => {
    // Two records: a perfectly good `claude-a` and an illegal `claude-a.bak`.
    // The validation used to live inside the action loop, so this manifest
    // printed `WRITE claude-a …` and then `… and nothing was written` two lines
    // later. Every earlier stub carried one record, which is exactly why the
    // falsity was invisible.
    const good = bodyFor(FIXTURE, 'claude-a');
    const cli = kitWith(
      'import { writeFileSync } from "node:fs";\nimport { join } from "node:path";\n'
      + `writeFileSync(join(process.argv[4], "claude-a"), ${JSON.stringify(good)});\n`
      + `writeFileSync(join(process.argv[4], "claude-a.bak"), ${JSON.stringify(good)});\n`
      + 'process.stdout.write("summary\\t2\\t2\\t0\\t0\\nwrapper\\tclaude-a\\tabsent\\tno\\nwrapper\\tclaude-a.bak\\tabsent\\tno\\n");\n',
    );
    const home = makeHome('ccrc-wrappers-abort-before-write-');
    const r = runWrappers(home, [], cli);
    expect(r.code).toBe(1);
    expect(r.stdout).not.toMatch(/^WRITE /m);
    expect(r.stderr).toMatch(/nothing was written/);
    expect(binEntries(home)).toEqual([]);
  });

  it('passes the generator\'s own refusal through instead of re-wording it', () => {
    // An invalid roster's `remedy:` line is the useful message, and it is
    // node's. Swallowing node's stderr would replace a fix with a shrug.
    const broken = clone(FIXTURE);
    broken.accounts.push({
      ...(broken.accounts[0] as RosterAccount),
      id: 'claude-second', label: 'second·upstream', configDirSuffix: '.claude-second', hue: 'amber',
    });
    const home = makeHome('ccrc-wrappers-badroster-', { roster: broken });
    const r = runWrappers(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/gen-wrappers: /);
    expect(r.stderr).toMatch(/remedy: /);
    expect(binEntries(home)).toEqual([]);
  });
});

describe('ccrc wrappers: its own prerequisites', () => {
  it('refuses BY NAME when node is not on PATH, rather than dying in a subshell', () => {
    // PATH is broken for a NESTED bash only: `command -v bash` resolves under
    // the outer, working PATH and the absolute path is exec'd directly, so this
    // suite's own process keeps its environment (ccrc-cli.test.ts uses the same
    // shape for its missing-jq case).
    const home = makeHome('ccrc-wrappers-nonode-');
    const script = `real_bash="$(command -v bash)"; PATH=/nonexistent-ccrc-test-path "$real_bash" "${CCRC}" wrappers`;
    const r = spawnSync('bash', ['-c', script], { env: wrappersEnv(home), encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: .*\bnode\b/m);
    expect(r.stderr).not.toMatch(/command not found/);
    expect(r.stderr).not.toMatch(/syntax error/);
    expect(binEntries(home)).toEqual([]);
  });

  it('refuses BY NAME when the wrapper shape contract is not installed beside it', () => {
    const lone = join(mkTmp('ccrc-wrappers-lonely-'), 'ccrc');
    writeFileSync(lone, readFileSync(CCRC, 'utf8'), { mode: 0o755 });
    const home = makeHome('ccrc-wrappers-lonely-home-');
    const r = runWrappers(home, [], lone);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/ccrc-wrapper-shape/);
    expect(r.stderr).toMatch(/is this a complete ccrc install\?/);
  });

  it('an unknown flag is a usage error (exit 2), not a refusal', () => {
    const home = makeHome('ccrc-wrappers-badflag-');
    const r = runWrappers(home, ['--nope']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --nope/m);
    expect(r.stderr).toMatch(/usage: ccrc/);
    expect(binEntries(home)).toEqual([]);
  });

  it('--help prints usage at exit 0 — a verb WITH flags of its own earns one', () => {
    // Deliberately unlike `ccrc version --help`, which is a usage error: that
    // verb has no flags to explain (see cmd_version's header). This one has
    // three, and each changes what it will overwrite.
    const home = makeHome('ccrc-wrappers-help-');
    const r = runWrappers(home, ['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/usage: ccrc/);
    expect(r.stdout).toMatch(/wrappers/);
    expect(binEntries(home)).toEqual([]);
  });
});
