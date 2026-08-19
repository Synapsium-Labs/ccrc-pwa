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
  statSync, writeFileSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWrapperBody } from '../../shared/wrapper.mjs';
import { markGenerated } from '../../shared/mark.mjs';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');
const CCD_DIR = path.join(ccrcRoot, 'ccd');
const CCRC = path.join(CCD_DIR, 'ccrc');
const MIGRATION_ROSTER = path.join(ccrcRoot, 'deploy', 'accounts.migration.json');

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

const MIGRATION: Roster = JSON.parse(readFileSync(MIGRATION_ROSTER, 'utf8')) as Roster;
/** The migration roster's three `generated` accounts — the only ids this verb
 *  may ever write. `claude` (upstream) and `gpt` (external) are the two it may
 *  never touch, under any flag. */
const GENERATED_IDS = ['claude2', 'claude-corp', 'claude-dev0'] as const;
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
  writeFileSync(rosterPathOf(home), `${JSON.stringify(opts.roster ?? MIGRATION, null, 2)}\n`);
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
      expect(readFileSync(p, 'utf8')).toBe(bodyFor(MIGRATION, id));
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
    const old = readFileSync(join(binOf(home), 'claude2'), 'utf8');

    const changed = clone(MIGRATION);
    const acct = changed.accounts.find((a) => a.id === 'claude2');
    if (!acct) throw new Error('fixture bug');
    acct.configDirSuffix = '.claude-personal-moved';
    putRoster(home, changed);

    const r = runWrappers(home);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(readFileSync(join(binOf(home), 'claude2'), 'utf8')).toBe(bodyFor(changed, 'claude2'));
    const backups = backupsFor(home, 'claude2');
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(binOf(home), backups[0] ?? ''), 'utf8')).toBe(old);
    // The backup name carries a "." so it can never match WRAPPER_ID_RE —
    // neither `ccrc adopt` nor `ccrc doctor` will ever read it as an account.
    expect(backups[0]).toMatch(/^claude2\.pre-ccrc-\d{8}T\d{6}Z$/);
  });

  it('refuses a wrapper of its own that has been hand-edited, and leaves it byte for byte', () => {
    const home = makeHome('ccrc-wrappers-edited-');
    expect(runWrappers(home).code).toBe(0);
    const p = join(binOf(home), 'claude2');
    const edited = `${readFileSync(p, 'utf8')}# an operator added this line\n`;
    writeFileSync(p, edited);

    const r = runWrappers(home);
    expect(r.code).toBe(1);
    expect(readFileSync(p, 'utf8')).toBe(edited);
    expect(r.stdout).toMatch(/^REFUSE claude2: /m);
    expect(remedyAfter(r.stdout, /^REFUSE claude2: /)).toMatch(/^ {2}remedy: /);
    expect(backupsFor(home, 'claude2')).toEqual([]);
  });

  it('--force rewrites a hand-edited wrapper, and the backup holds the edit', () => {
    const home = makeHome('ccrc-wrappers-edited-force-');
    expect(runWrappers(home).code).toBe(0);
    const p = join(binOf(home), 'claude2');
    const edited = `${readFileSync(p, 'utf8')}# an operator added this line\n`;
    writeFileSync(p, edited);

    const r = runWrappers(home, ['--force']);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(readFileSync(p, 'utf8')).toBe(bodyFor(MIGRATION, 'claude2'));
    const backups = backupsFor(home, 'claude2');
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
      const changed = clone(MIGRATION);
      const acct = changed.accounts.find((a) => a.id === 'claude2');
      if (!acct) throw new Error('fixture bug');
      acct.configDirSuffix = '.claude-personal-moved';
      putRoster(home, changed);
      const p = join(binOf(home), 'claude2');
      chmodSync(p, 0o444);

      const r = runWrappers(home);
      expect(r.code, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0);
      expect(readFileSync(p, 'utf8')).toBe(bodyFor(changed, 'claude2'));
      expect(statSync(p).mode & 0o777).toBe(0o755);
      // And the temp file is gone — a `.claude2.tmp.<pid>` left on PATH is a
      // stray executable, which is the very thing `install_atomic`'s trailing
      // sweep exists for.
      expect(binEntries(home).filter((n) => n.includes('.tmp.'))).toEqual([]);
    });
});

describe('ccrc wrappers: a file ccrc did NOT write', () => {
  /** A hand-written wrapper for claude2 saying exactly what ccrc would say. */
  const equivalentText = handWritten({
    suffix: '.claude-personal',
    secrets: '.cc-secrets/claude2-oauth.env',
    note: 'hand-written in 2024, and still correct',
  });
  /** ...and one that says something else. */
  const divergentText = handWritten({
    suffix: '.claude-somewhere-else',
    secrets: '.cc-secrets/claude2-oauth.env',
    note: 'hand-written, and pointing at a different config dir on purpose',
  });

  it('refuses an equivalent foreign wrapper by default, and says it is adoptable', () => {
    const home = makeHome('ccrc-wrappers-foreign-eq-');
    const p = join(binOf(home), 'claude2');
    writeFileSync(p, equivalentText, { mode: 0o755 });

    const r = runWrappers(home);
    expect(r.code).toBe(1);
    expect(readFileSync(p, 'utf8')).toBe(equivalentText);
    expect(r.stdout).toMatch(/^REFUSE claude2: /m);
    expect(remedyAfter(r.stdout, /^REFUSE claude2: /)).toMatch(/--adopt/);
    expect(backupsFor(home, 'claude2')).toEqual([]);
  });

  it('--adopt takes over an equivalent foreign wrapper, backing up the hand-written original', () => {
    const home = makeHome('ccrc-wrappers-foreign-adopt-');
    const p = join(binOf(home), 'claude2');
    writeFileSync(p, equivalentText, { mode: 0o755 });

    const r = runWrappers(home, ['--adopt']);
    expect(r.code, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0);
    expect(readFileSync(p, 'utf8')).toBe(bodyFor(MIGRATION, 'claude2'));
    const backups = backupsFor(home, 'claude2');
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(binOf(home), backups[0] ?? ''), 'utf8')).toBe(equivalentText);
  });

  it('refuses a NON-equivalent foreign wrapper with --adopt too — adopt is not a clobber', () => {
    for (const args of [[], ['--adopt']]) {
      const home = makeHome(`ccrc-wrappers-foreign-ne-${args.length}-`);
      const p = join(binOf(home), 'claude2');
      writeFileSync(p, divergentText, { mode: 0o755 });

      const r = runWrappers(home, args);
      expect(r.code, `args=${JSON.stringify(args)} stderr:\n${r.stderr}`).toBe(1);
      expect(readFileSync(p, 'utf8')).toBe(divergentText);
      expect(backupsFor(home, 'claude2')).toEqual([]);
    }
  });

  it('THE GUARD: the remedy for a non-equivalent foreign file never mentions --force', () => {
    // D3: "Suggesting a clobber is how a mechanical operator destroys a
    // 142-line hand-written launcher." The remedy is "move it aside, or set
    // exec.kind to external in the roster" — and `--force` must not appear
    // anywhere in the run's output, because an operator scanning a refusal for
    // the next thing to type does not read which line it came from.
    const home = makeHome('ccrc-wrappers-foreign-noforce-');
    writeFileSync(join(binOf(home), 'claude2'), divergentText, { mode: 0o755 });

    const r = runWrappers(home);
    expect(r.code).toBe(1);
    const remedy = remedyAfter(r.stdout, /^REFUSE claude2: /);
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
      const p = join(binOf(home), 'claude2');
      writeFileSync(p, handWritten({ suffix: '.claude-personal', note: 'unreadable' }));
      chmodSync(p, 0o000);

      const r = runWrappers(home);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(/^REFUSE claude2: /m);
      const remedy = remedyAfter(r.stdout, /^REFUSE claude2: /);
      expect(remedy).toMatch(/^ {2}remedy: /);
      // Its OWN remedy, not the catch-all's: deleting the `unreadable` arm
      // drops it into the "this verb does not know that classification" branch,
      // which refuses too — so a test that only checked for a refusal would
      // stay green through exactly that deletion.
      expect(remedy).toMatch(/No flag overrides this one/);
      expect(remedy).not.toMatch(/bug in ccrc/);
      expect(backupsFor(home, 'claude2')).toEqual([]);
      chmodSync(p, 0o600);
      expect(readFileSync(p, 'utf8'))
        .toBe(handWritten({ suffix: '.claude-personal', note: 'unreadable' }));
    });

  it.skipIf(process.getuid?.() === 0)(
    'refuses a wrapper it could not read under --force --adopt too — no flag overrides that one', () => {
      // "I could not read it" is not "I know what it is", so there is nothing
      // for a flag to override. This is the case that stops the `unreadable`
      // arm being quietly folded into the non-equivalent `foreign` arm, which
      // DOES honour --force: that fold would destroy a root-owned or mode-000
      // file ccrc had promised never to judge.
      const home = makeHome('ccrc-wrappers-unreadable-force-');
      const p = join(binOf(home), 'claude2');
      const text = handWritten({ suffix: '.claude-personal', note: 'unreadable' });
      writeFileSync(p, text);
      chmodSync(p, 0o000);

      const r = runWrappers(home, ['--force', '--adopt']);
      expect(r.code, `stdout:\n${r.stdout}`).toBe(1);
      expect(r.stdout).toMatch(/^REFUSE claude2: /m);
      expect(backupsFor(home, 'claude2')).toEqual([]);
      chmodSync(p, 0o600);
      expect(readFileSync(p, 'utf8')).toBe(text);
    });

  it('never clobbers a bespoke launcher sitting under a generated account\'s id', () => {
    const home = makeHome('ccrc-wrappers-bespoke-');
    const p = join(binOf(home), 'claude2');
    const text = bespokeLauncher('.claude-personal');
    expect(text.split('\n').length).toBeGreaterThanOrEqual(40);
    writeFileSync(p, text, { mode: 0o755 });

    const r = runWrappers(home);
    expect(r.code).toBe(1);
    expect(readFileSync(p, 'utf8')).toBe(text);
    expect(backupsFor(home, 'claude2')).toEqual([]);
    expect(r.stdout).not.toMatch(/--force/);
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
    it(`refuses claude2 with ${args.length === 0 ? 'no flags' : args.join(' ')} — no flag overrides an oversize file`, () => {
      const home = makeHome(`ccrc-wrappers-oversize-${args.join('') || 'none'}-`);
      makeOversizeCandidate(home, 'claude2');

      const r = runWrappers(home, args);
      expect(r.code, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(1);
      expect(r.stdout).toMatch(/^REFUSE claude2: /m);
      // ITS OWN sentence, not the catch-all's: deleting the `oversize` arm
      // drops it into "$gen classified it as \"oversize\", which this verb
      // does not know" — which refuses too, so a bare exit-1 assertion would
      // stay green through exactly that deletion.
      expect(r.stdout).toMatch(/over 1 MiB/);
      expect(r.stdout).not.toMatch(/which this verb does not know/);
      const remedy = remedyAfter(r.stdout, /^REFUSE claude2: /);
      expect(remedy).toMatch(/^ {2}remedy: /);
      expect(remedy).not.toMatch(/bug in ccrc/);
      // Both escape hatches, named: move the big file aside (if claude2
      // should be generated), or declare it upstream (if it IS the upstream
      // binary this fixture is standing in for).
      expect(remedy).toMatch(/move.*aside/);
      expect(remedy).toMatch(/"upstream"/);
      expect(backupsFor(home, 'claude2')).toEqual([]);
      // Left byte for byte — still sparse, still over the threshold.
      expect(statSync(join(binOf(home), 'claude2')).size).toBeGreaterThan(1024 * 1024);
    });
  }

  it('THE GUARD: the remedy for an oversize file never mentions --force either', () => {
    // The same guard `ccrc-wrappers.test.ts` already holds `foreign` to
    // (D3: "Suggesting a clobber is how a mechanical operator destroys a
    // 142-line hand-written launcher"), extended to this arm: an operator
    // scanning refusals for the next thing to type must never find --force
    // beside a file this verb has just said is categorically not a wrapper.
    const home = makeHome('ccrc-wrappers-oversize-noforce-');
    makeOversizeCandidate(home, 'claude2');

    const r = runWrappers(home, ['--force']);
    expect(r.code).toBe(1);
    const remedy = remedyAfter(r.stdout, /^REFUSE claude2: /);
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
    makeOversizeCandidate(home, 'claude2');

    const r = runWrappers(home);
    expect(r.code).toBe(1);
    expect(readFileSync(join(binOf(home), 'claude-corp'), 'utf8')).toBe(bodyFor(MIGRATION, 'claude-corp'));
    expect(readFileSync(join(binOf(home), 'claude-dev0'), 'utf8')).toBe(bodyFor(MIGRATION, 'claude-dev0'));
    expect(r.stdout).toMatch(/^WRITE claude-corp: /m);
    expect(r.stdout).toMatch(/^WRITE claude-dev0: /m);
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
    const p = join(binOf(home), 'claude2');
    const edited = `${readFileSync(p, 'utf8')}# an operator added this line\n`;
    writeFileSync(p, edited);

    const r = runWrappers(home, ['--dry-run']);
    expect(r.code).toBe(1);
    expect(readFileSync(p, 'utf8')).toBe(edited);
    expect(backupsFor(home, 'claude2')).toEqual([]);
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
    const stray = join(binOf(home), '.claude2.tmp.999');
    writeFileSync(stray, 'half a wrapper', { mode: 0o755 });
    const r = runWrappers(home, ['--dry-run']);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(existsSync(stray)).toBe(true);
    expect(r.stdout).not.toMatch(/^SWEPT /m);
  });

  it('would not write a backup either', () => {
    const home = makeHome('ccrc-wrappers-dry-backup-');
    expect(runWrappers(home).code).toBe(0);
    const changed = clone(MIGRATION);
    const acct = changed.accounts.find((a) => a.id === 'claude2');
    if (!acct) throw new Error('fixture bug');
    acct.configDirSuffix = '.claude-personal-moved';
    putRoster(home, changed);
    const before = readFileSync(join(binOf(home), 'claude2'), 'utf8');

    const r = runWrappers(home, ['--dry-run']);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/^WOULD-REWRITE claude2: /m);
    expect(readFileSync(join(binOf(home), 'claude2'), 'utf8')).toBe(before);
    expect(backupsFor(home, 'claude2')).toEqual([]);
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
    const stray = join(binOf(home), '.claude2.tmp.4242');
    writeFileSync(stray, 'half a wrapper, from a run that was killed', { mode: 0o755 });

    // The account is CONVERGED on this run, so a sweep that only ran after a
    // write would never reach it — which is the common case, not the exotic one.
    const r = runWrappers(home);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(existsSync(stray)).toBe(false);
    expect(r.stdout).toMatch(/^SWEPT claude2: /m);
    expect(binEntries(home)).toEqual([...GENERATED_IDS].sort());
  });

  it('sweeps only names it could have made itself', () => {
    // The glob carries the whole `.<id>.tmp.` shape for an id off the manifest,
    // so nothing else in ~/.local/bin is at risk from it — including a file
    // whose name merely looks temp-ish.
    const home = makeHome('ccrc-wrappers-sweep-scope-');
    const notOurs = join(binOf(home), '.something-else.tmp.1');
    const alsoNotOurs = join(binOf(home), '.claude2.tmp');   // no pid suffix
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
      'process.stdout.write("summary\\t5\\t3\\t1\\t1\\nwrapper\\tclaude2\\tabsent\\tno\\n");\n',
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
    // `claude2.bak` is the concrete, measured shape: `.bak-<date>` siblings are
    // exactly what a real box accumulates and what WRAPPER_ID_RE exists to keep
    // out of the account namespace (`ccd/ccrc-wrapper-shape:63-67`). The stub
    // STAGES the file, so without the gate this verb really would install it.
    const cli = kitWith(
      'import { writeFileSync } from "node:fs";\nimport { join } from "node:path";\n'
      + 'writeFileSync(join(process.argv[4], "claude2.bak"), "#!/usr/bin/env bash\\nexport CLAUDE_CONFIG_DIR=\\"$HOME/.x\\"\\nexec \\"$HOME/.local/bin/claude\\" \\"$@\\"\\n");\n'
      + 'process.stdout.write("summary\\t1\\t1\\t0\\t0\\nwrapper\\tclaude2.bak\\tabsent\\tno\\n");\n',
    );
    const home = makeHome('ccrc-wrappers-badid-');
    const r = runWrappers(home, ['--force'], cli);
    expect(r.code).toBe(1);
    expect(binEntries(home)).toEqual([]);
    expect(r.stderr).toMatch(/claude2\.bak/);
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
    // Two records: a perfectly good `claude2` and an illegal `claude2.bak`.
    // The validation used to live inside the action loop, so this manifest
    // printed `WRITE claude2 …` and then `… and nothing was written` two lines
    // later. Every earlier stub carried one record, which is exactly why the
    // falsity was invisible.
    const good = bodyFor(MIGRATION, 'claude2');
    const cli = kitWith(
      'import { writeFileSync } from "node:fs";\nimport { join } from "node:path";\n'
      + `writeFileSync(join(process.argv[4], "claude2"), ${JSON.stringify(good)});\n`
      + `writeFileSync(join(process.argv[4], "claude2.bak"), ${JSON.stringify(good)});\n`
      + 'process.stdout.write("summary\\t2\\t2\\t0\\t0\\nwrapper\\tclaude2\\tabsent\\tno\\nwrapper\\tclaude2.bak\\tabsent\\tno\\n");\n',
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
    const broken = clone(MIGRATION);
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
