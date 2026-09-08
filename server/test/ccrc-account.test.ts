// `ccrc account` — the account-connection verb (spec §5). This file owns what
// the verb DOES; `server/test/ccrc-cli.test.ts` owns its DISCOVERABILITY (the
// usage line), exactly the split that file states verb by verb.
//
// ── HOW THE FIXTURE CONTAINS IT (ccrc-expose.test.ts's harness) ───────────
//  1. HOME is a throwaway `mkTmp` directory — the isolation boundary the whole
//     ccd/ccrc suite relies on (CLAUDE.md). This verb WRITES ~/.ccrc,
//     ~/.cc-secrets, ~/.local/bin and ~/.cc-sessions, all of which hold live
//     state on the box this suite runs on.
//  2. `ccrc` is invoked through `<home>/ccrc/ccd/ccrc` — the shape of a
//     deployed box, and the shape `CCRC_HERE` (ccd/ccrc:842-844) resolves
//     `../deploy/account-op.mjs` against.
//  3. `ghContainedEnv` plants the poisoned `gh`; curl/systemctl/launchctl are
//     poisoned beside it (ccrc-cli.test.ts's `ccrcEnv` idiom). This verb shells
//     out to none of them, which is itself asserted below.
//  4. This file is NOT in the name-triggered containment scan
//     (`ccd-workspaces.test.ts:1177` selects /^ccd.*\.ts$/), so the poisons are
//     here because they are right, not because a scanner demands them.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as pty from 'node-pty';
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { PROVIDERS, PROVIDER_IDS } from '../../shared/providers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC_SRC = join(REPO, 'ccd', 'ccrc');

/** bash's absolute path, resolved once under this process's real PATH. */
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

const ccrcIn = (home: string): string => join(home, 'ccrc', 'ccd', 'ccrc');

/** A box carrying the tree `ccrc account` resolves against. `deploy` and
 *  `shared` are symlinked WHOLE because `deploy/account-op.mjs` imports
 *  `../shared/roster-json.mjs` (and, from Task 23's `check-add` on,
 *  `../shared/base-url.mjs` too — `account-op.mjs`'s own header states the
 *  same fact), and node resolves both through the link's realpath — the
 *  fixture never needs a copy of either directory, which is also why a new
 *  sibling import costs this fixture nothing. (`ccrc-doctor.test.ts` COPIES
 *  instead, and there the closure has to be listed file by file — Task 33.)
 *
 *  IT ALSO MATERIALISES THE CONTAINMENT BINS, and that last line is not
 *  housekeeping. `ghContainedEnv` → `harnessBin` (ccdWsHelpers.ts:123-127) does
 *  `mkdirSync(<home>/.local/bin)` and then writes the `gh` poison
 *  (:177-179), and `env()` below writes three more beside it — so
 *  `~/.local/bin` goes from ABSENT to four entries the first time anything
 *  calls `run()`. A test that brackets a run with a directory snapshot — the
 *  shape "leaves the box alone" (below) checks with `existsSync`, not a
 *  listing — would be measuring the HARNESS arriving rather than the verb
 *  writing, and would red on every refusal row for a reason that has
 *  nothing to do with the refusal under test. Building the env once here, at
 *  box-construction time, moves that arrival before the baseline. `env()` is
 *  idempotent — it rewrites the same four files with the same bytes — so the
 *  `run()` calls that follow change nothing about the listing. */
function box(prefix: string): string {
  const home = mkTmp(prefix);
  const ccd = join(home, 'ccrc', 'ccd');
  mkdirSync(ccd, { recursive: true });
  for (const f of ['ccrc', 'ccrc-wrapper-shape', 'ccrc-doctor-checks']) {
    symlinkSync(join(REPO, 'ccd', f), join(ccd, f));
  }
  symlinkSync(join(REPO, 'deploy'), join(home, 'ccrc', 'deploy'));
  symlinkSync(join(REPO, 'shared'), join(home, 'ccrc', 'shared'));
  env(home);   // for its side effects only — see the paragraph above
  return home;
}

function env(home: string): NodeJS.ProcessEnv {
  const e = ghContainedEnv(home, { ...process.env, HOME: home });
  const poison = (name: string, says: string): void =>
    writeFileSync(join(home, '.local', 'bin', name),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\n`
      + `echo "${says}" >&2\nexit 97\n`, { mode: 0o755 });
  poison('curl', 'ccrc tests must never reach a real server');
  poison('systemctl', 'ccrc tests must never query this box\'s real systemd');
  poison('launchctl', 'ccrc tests must never query this box\'s real launchd');
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_DOCTOR_GH_TIMEOUT']) delete e[k];
  return e;
}

interface Result { code: number; stdout: string; stderr: string }

/** `ccrc <args>` with stdin closed unless a test supplies it. */
function run(home: string, args: string[], stdin = ''): Result {
  const r = spawnSync(BASH, [ccrcIn(home), ...args],
    { env: env(home), encoding: 'utf8', input: stdin });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** The contract: stdout is EXACTLY one JSON object and nothing else. Parsing
 *  through this helper rather than `JSON.parse(r.stdout)` at each call site is
 *  what makes "one object" an assertion instead of an assumption — a verb that
 *  printed a progress line before its answer would still parse at a call site
 *  that used `.split('\n')[0]`. It is also what catches the failure this
 *  cluster is most exposed to: `add` calls two of `ccrc install`'s own
 *  convergers, and BOTH of them print human lines on stdout (ccd/ccrc:4741,
 *  :4747, :2891). Every `add` case below runs through here. */
function oneObject(r: Result): Record<string, unknown> {
  const lines = r.stdout.split('\n');
  expect(lines[lines.length - 1], 'stdout is not newline-terminated').toBe('');
  expect(lines.length, `stdout carried ${lines.length - 1} lines, not one`).toBe(2);
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

/** The subcommands the shipped dispatcher accepts, read out of the one place
 *  they are spelled. */
function shippedSubs(): string[] {
  const m = /^ACCT_SUBS="([^"]*)"$/m.exec(readFileSync(CCRC_SRC, 'utf8'));
  expect(m, 'ccd/ccrc has no file-scope ACCT_SUBS').toBeTruthy();
  return m![1]!.split(' ').filter(Boolean);
}

describe('ccrc account: the dispatcher', () => {
  it('with no subcommand answers a JSON refusal at exit 2, never an empty body', () => {
    // `_ccrc_die` prints NOTHING on stdout (ccd/ccrc:1191); `cmd_expose`'s own
    // missing-subcommand arm (:3177-3181) prints its sentence on STDERR and
    // exits 2 with an empty stdout. That is right for a verb an operator types
    // and wrong for one the server parses, which is why this verb's refusals
    // leave by a different door.
    const home = box('ccrc-account-nosub-');
    const r = run(home, ['account']);
    expect(r.code).toBe(2);
    const j = oneObject(r);
    expect(j['ok']).toBe(false);
    expect(j['error']).toBe('missing-subcommand');
    // The human sentence is on stderr, in ccrc-api's `refuse` shape.
    expect(r.stderr).toMatch(/missing-subcommand/);
  });

  it('an unknown subcommand is exit 2, and names what this build has', () => {
    const home = box('ccrc-account-unknownsub-');
    const r = run(home, ['account', 'nope']);
    expect(r.code).toBe(2);
    const j = oneObject(r);
    expect(j['error']).toBe('unknown-subcommand');
    expect(String(j['detail'])).toContain('"nope"');
  });

  it('-h prints usage on stdout at exit 0 — the one non-JSON stdout, and a human typed it', () => {
    const home = box('ccrc-account-help-');
    const r = run(home, ['account', '-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/usage: ccrc/);
  });

  it('the dispatcher and the printed list are the same list, in both directions', () => {
    // The mechanism, not a comment: `ACCT_SUBS` is matched by the dispatcher AND
    // printed by both refusals, so a name that dispatches without being listed —
    // or listed without dispatching — cannot happen. Vacuous in the forward
    // direction at this commit (the list is empty) and it stops being vacuous at
    // Task 21; the reverse direction fires today.
    const home = box('ccrc-account-subs-');
    for (const sub of shippedSubs()) {
      const j = oneObject(run(home, ['account', sub]));
      // Both refusal codes a listed-but-undispatched name can hide behind:
      // `unknown-subcommand` (the loop didn't match it — can't happen if it's
      // really in ACCT_SUBS) and `internal-no-arm` (the loop matched it but the
      // `case` below has no arm for it — the half this assertion used to miss).
      expect(['unknown-subcommand', 'internal-no-arm'],
        `${sub} is in ACCT_SUBS but the dispatcher refuses it`)
        .not.toContain(j['error']);
    }
    const j = oneObject(run(home, ['account', 'definitely-not-a-sub']));
    expect(j['error']).toBe('unknown-subcommand');
  });

  it('leaves the box alone: nothing written, nothing shelled out to', () => {
    const home = box('ccrc-account-inert-');
    run(home, ['account']);
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
    expect(existsSync(join(home, '.cc-secrets'))).toBe(false);
    for (const p of ['curl', 'systemctl', 'launchctl', 'gh']) {
      expect(existsSync(join(home, `${p}-poison`)), `${p} was reached`).toBe(false);
    }
  });
});

describe('deploy/account-op.mjs: the one writer of this verb\'s stdout', () => {
  const OP = join(REPO, 'deploy', 'account-op.mjs');
  const node = (args: string[]): Result => {
    const r = spawnSync('node', [OP, ...args], { encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };

  it('refuse prints the ccrc-api envelope and exits 0 — the CLASS is the caller\'s', () => {
    const r = node(['refuse', '--code', 'duplicate-id', '--detail', 'the id "x" is taken']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      ok: false, error: 'duplicate-id', detail: 'the id "x" is taken',
    });
    expect(r.stderr).toBe('account-op: the id "x" is taken (duplicate-id)\n');
  });

  it('a quote in the detail survives — the reason this is not a bash printf', () => {
    // ccd/ccrc-api:122-126's envelope is a bash `printf '{"…":"%s"…}'`, safe
    // there because both values are literals that file controls. Here `detail`
    // carries the operator's own bytes.
    const nasty = 'the suffix "\\x" is not under $HOME\'s .claude* glob';
    const r = node(['refuse', '--code', 'bad-suffix', '--detail', nasty]);
    expect(JSON.parse(r.stdout)).toEqual({ ok: false, error: 'bad-suffix', detail: nasty });
  });

  it('an unknown op is a usage error at exit 2, with nothing on stdout', () => {
    const r = node(['wat']);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^usage: node deploy\/account-op\.mjs /);
  });

  it('an unknown --key is refused rather than ignored', () => {
    const r = node(['refuse', '--code', 'x', '--detail', 'y', '--nope', 'z']);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout)['error']).toBe('bad-argv');
  });

  it('a value beginning with -- is refused, not silently consumed', () => {
    // Reproduces the review-round-1 finding (M6): without the guard,
    // `--detail` here (meant as `--code`'s VALUE) is swallowed as that value,
    // and `z` is misread as `--detail`'s own key — `{"ok":false,"error":"--detail","detail":"z"}`
    // at exit 0. Task 21's `repeat`-keyed `candidates` is the first place an
    // operator-controlled value could ever shadow a flag this way.
    const r = node(['refuse', '--code', '--detail', '--detail', 'z']);
    expect(r.code).toBe(2);
    const j = JSON.parse(r.stdout);
    expect(j['ok']).toBe(false);
    expect(j['error']).toBe('bad-argv');
    expect(String(j['detail'])).toMatch(/starts with "--"/);
  });

  it('the deploy mirror agrees with shared/providers.ts, column by column', () => {
    // NO IMPORT and NO TEXT SCRAPE: the CLI answers a question about itself
    // through the same code path everything else uses, and this compares that
    // answer to the table's own projection. Red on a new provider, a dropped
    // one, a changed env var, a changed default endpoint or a changed method
    // list — in either direction.
    //
    // `defaultBaseUrl` is the mirror's name for `PROVIDERS[p].baseUrl`, and the
    // one-line mapping below is the whole of the translation between the two
    // vocabularies: the deploy side says DEFAULT because `add` materialises it
    // (Task 24) while the table's column is the default itself. Every other key
    // is spelled identically on both sides — `connect` above all, because it is
    // also the flag value an operator types.
    const r = node(['providers']);
    expect(r.code).toBe(0);
    const got = JSON.parse(r.stdout)['providers'] as Record<string, unknown>;
    const want = Object.fromEntries(PROVIDER_IDS.map((p) => [p, {
      generatable: PROVIDERS[p].generatable,
      envVar: PROVIDERS[p].envVar ?? null,
      defaultBaseUrl: PROVIDERS[p].baseUrl ?? null,
      connect: [...PROVIDERS[p].connect],
    }]));
    expect(got).toEqual(want);
    // The composition is what the op prints, so the columns are measured
    // through it rather than beside it — but the ORDER of a connect list is
    // offer order (§4.2: anthropic's `login` is "(default)", and `check-add`
    // takes `P.connect[0]` when `--method` is absent), so it is compared as a
    // sequence and never as a set.
    expect((got['anthropic'] as { connect: string[] }).connect[0]).toBe('login');
  });
});

/** A roster on the fixture box, plus the accounts.sh projection ccd and the
 *  four installers read. Written through the real generator so the fixture can
 *  never disagree with what a deployed box would have. */
function seedBoxRoster(home: string, roster: unknown): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'accounts.json'), `${JSON.stringify(roster, null, 2)}\n`);
  const g = spawnSync('node',
    [join(REPO, 'deploy', 'gen-accounts.mjs'), join(home, '.ccrc', 'accounts.json')],
    { encoding: 'utf8' });
  expect(g.status, `gen-accounts refused the fixture roster: ${g.stderr}`).toBe(0);
  writeFileSync(join(home, '.ccrc', 'accounts.sh'), g.stdout);
}

/** The roster this cluster's fixtures use: one upstream, one generated token
 *  lane, one external launcher. Labels are the blessed fixture vocabulary. */
const FIXTURE_ROSTER = {
  version: 1,
  accounts: [
    {
      id: 'claude', label: 'team·max', configDirSuffix: '.claude',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
    },
    {
      id: 'claude-a', label: 'alt·max', configDirSuffix: '.claude-a',
      // `-oauth`, not `-anthropic`: this is the name `add` derives for an OAuth
      // lane and the one every anthropic lane on the fleet carries
      // (`server/test/helpers.ts:69` is the same string for the same id).
      exec: { kind: 'generated', secretsFile: '.cc-secrets/claude-a-oauth.env' },
      homeAble: true, hue: 'violet', telemetry: 'anthropic',
    },
    {
      id: 'gpt', label: 'gpt', configDirSuffix: '.claude-gpt',
      exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none',
    },
  ],
};

/** An id-shaped executable in `~/.local/bin`, with whatever body the case is
 *  about. THE ONE LAUNCHER-PLANTER IN THIS FILE, and it takes a BODY rather than
 *  a config-dir suffix on purpose: the cases divide on what the file CONTAINS —
 *  a ccrc-shaped wrapper here, a compiled blob with no shebang for `declare`
 *  (Task 27), somebody else's `#!/bin/sh` for `remove` (Task 32) — and a helper
 *  that could only write one of those shapes would be re-declared under the same
 *  name by the first task that needed another, which is a `SyntaxError` in a
 *  single-file suite rather than a difference of opinion.
 *
 *  Returns the path, so a case can `chmod`, `symlink` or stat it without
 *  rebuilding the join. Tasks 27-32 all call this one. */
function plantLauncher(home: string, name: string, body = 'exit 0\n'): string {
  const p = join(home, '.local', 'bin', name);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, body, { mode: 0o755 });
  return p;
}

/** The body of a ccrc-SHAPED launcher: a script (`#!`) that exports
 *  CLAUDE_CONFIG_DIR, which is what doctor's candidate rule
 *  (`_wrap_is_script` + `_wrap_declares_config_dir`) recognises and what
 *  `candidates` must therefore offer. */
const wrapperBody = (suffix: string): string =>
  `#!/usr/bin/env bash\nexport CLAUDE_CONFIG_DIR="$HOME/${suffix}"\n`
  + 'exec "$HOME/.local/bin/claude" "$@"\n';

describe('ccrc account roster: the file, gated by the validator', () => {
  it('answers the roster verbatim in content — including fields the validator drops', () => {
    // `rosterFromJson`'s return literal (shared/roster-json.mjs:387-390) carries
    // eight fields and drops the rest. An answer built from IT would lose
    // `hidden`, `provider`, `baseUrl` and `models` — all four VALIDATED by
    // Task 4 and none of them returned — the adapter-narrowing rule's exact
    // shape. This case is the pin: `hidden` is a field the validator does not
    // return, so it can only be in the answer if the answer came from the FILE.
    const home = box('ccrc-account-roster-');
    const roster = {
      version: 1,
      accounts: [
        { ...FIXTURE_ROSTER.accounts[0]!, hidden: true },
        FIXTURE_ROSTER.accounts[1]!,
        FIXTURE_ROSTER.accounts[2]!,
      ],
    };
    seedBoxRoster(home, roster);
    const r = run(home, ['account', 'roster']);
    expect(r.code).toBe(0);
    const j = oneObject(r);
    expect(j['ok']).toBe(true);
    expect(j['roster']).toEqual(roster);
  });

  it('a roster that does not validate is exit 1, and carries the validator\'s own remedy', () => {
    const home = box('ccrc-account-roster-bad-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'accounts.json'),
      JSON.stringify({ version: 1, accounts: [{ ...FIXTURE_ROSTER.accounts[0]!, hue: 'puce' }] }));
    const r = run(home, ['account', 'roster']);
    expect(r.code).toBe(1);
    const j = oneObject(r);
    expect(j['error']).toBe('roster-invalid');
    // `shared/roster-json.mjs:374` phrases the message and `:375` the remedy.
    expect(String(j['detail'])).toContain('unknown hue');
    // The remedy reaches the operator VERBATIM — `_inst_accounts_sh`'s rule
    // (ccd/ccrc:4731-4733): re-wording a fix into a shrug helps nobody.
    expect(String(j['detail'])).toContain('cyan, violet, blue, magenta, amber, green');
  });

  it('an absent roster and an unreadable one are two codes, not one', () => {
    // CLAUDE.md's D-114 rule, and `ccd/ccd:958-965`'s own two refusals over this
    // very file's projection: "the remedy for the other is chmod/chown, and
    // nothing else". A caller that gets one code for both cannot tell an
    // uninstalled box from a broken permission.
    const absent = box('ccrc-account-roster-absent-');
    const a = run(absent, ['account', 'roster']);
    expect(a.code).toBe(1);
    expect(oneObject(a)['error']).toBe('roster-absent');

    const unreadable = box('ccrc-account-roster-unreadable-');
    seedBoxRoster(unreadable, FIXTURE_ROSTER);
    chmodSync(join(unreadable, '.ccrc', 'accounts.json'), 0o000);
    const u = run(unreadable, ['account', 'roster']);
    chmodSync(join(unreadable, '.ccrc', 'accounts.json'), 0o644);
    expect(u.code).toBe(1);
    expect(oneObject(u)['error']).toBe('roster-unreadable');
  });

  it('writes nothing — this is a read', () => {
    const home = box('ccrc-account-roster-inert-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const before = readdirSync(join(home, '.ccrc')).sort();
    const r = run(home, ['account', 'roster']);
    // THE READ HAS TO HAVE SUCCEEDED, or this case measures nothing. A verb
    // that refused before it opened anything also writes nothing, so without
    // these two lines the assertion below is green for the wrong reason —
    // measured at review round 1 by setting `ACCT_SUBS=""`, which disables the
    // subcommand entirely and makes every call refuse at exit 2: the case still
    // passed. The claim is "a SUCCESSFUL read writes nothing", and success is
    // half of it.
    expect(r.code).toBe(0);
    expect(oneObject(r)['ok']).toBe(true);
    expect(readdirSync(join(home, '.ccrc')).sort()).toEqual(before);
    expect(existsSync(join(home, '.cc-secrets'))).toBe(false);
  });
});

describe('ccrc account candidates: doctor\'s own rule, and sizes only', () => {
  it('lists an undeclared id-shaped launcher with its size', () => {
    const home = box('ccrc-account-cands-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantLauncher(home, 'lab-dev0', wrapperBody('.claude-lab-dev0'));
    const r = run(home, ['account', 'candidates']);
    expect(r.code).toBe(0);
    const cands = oneObject(r)['candidates'] as { name: string; bytes: number }[];
    expect(cands.map((c) => c.name)).toEqual(['lab-dev0']);
    expect(cands[0]!.bytes).toBeGreaterThan(0);
  });

  it('never lists a declared account, and never lists a declared account\'s alias', () => {
    // The measured `gpt -> ccgpt` case, generalised: one file, two names,
    // `-ef` comparing device+inode THROUGH the symlink
    // (ccrc-doctor-checks:2404-2408, the test itself at :2416). An un-collapsed
    // alias would offer the operator a "new account" that is a rostered one
    // under a second name.
    const home = box('ccrc-account-cands-alias-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantLauncher(home, 'gpt', wrapperBody('.claude-gpt'));
    symlinkSync(join(home, '.local', 'bin', 'gpt'), join(home, '.local', 'bin', 'ccgpt'));
    plantLauncher(home, 'lab-dev0', wrapperBody('.claude-lab-dev0'));
    const cands = oneObject(run(home, ['account', 'candidates']))['candidates'] as
      { name: string }[];
    expect(cands.map((c) => c.name)).toEqual(['lab-dev0']);
  });

  it('never lists a file that is not a script or does not set CLAUDE_CONFIG_DIR', () => {
    const home = box('ccrc-account-cands-shape-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'notascript'), 'PKbinary', { mode: 0o755 });
    writeFileSync(join(bin, 'noconfigdir'), '#!/bin/sh\nexec claude "$@"\n', { mode: 0o755 });
    writeFileSync(join(bin, 'claude-a.bak-20260101'),
      '#!/bin/sh\nexport CLAUDE_CONFIG_DIR="$HOME/.claude-a"\n', { mode: 0o755 });
    const cands = oneObject(run(home, ['account', 'candidates']))['candidates'] as unknown[];
    expect(cands).toEqual([]);
  });

  it('skips an id-shaped file too big to judge, rather than reading it whole', () => {
    // `_wrap_declares_config_dir` reads to the LAST LINE, and
    // `ccrc-wrapper-shape:146-154` states the caller's second obligation: size
    // it first, against WRAPPER_OVERSIZE_BYTES (`:94`, 1048576). Doctor's
    // candidate loop (ccrc-doctor-checks:2388-2401) does not, and this verb
    // deliberately does not copy that.
    const home = box('ccrc-account-cands-big-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'lab-dev0'),
      '#!/usr/bin/env bash\nexport CLAUDE_CONFIG_DIR="$HOME/.claude-lab-dev0"\n'
      + `# ${'x'.repeat(1024 * 1024)}\n`, { mode: 0o755 });
    expect(oneObject(run(home, ['account', 'candidates']))['candidates']).toEqual([]);
  });

  it('sizes THROUGH a symlink, so the gate measures the file it is about to read', () => {
    // NOT in the plan, and it is the one place this loop diverges from the
    // snippet it was written from. `ccrc-wrapper-shape:128-132` states the fact
    // that decides it: `_wrap_is_script` (and `_wrap_declares_config_dir` after
    // it) OPEN the file, so a symlink is followed transparently, while a bare
    // `stat` of the link answers "the length of that path string". A size taken
    // without `-L` therefore gates on a number that is not about the bytes that
    // are about to be read — an oversize target reached through a 30-byte link
    // would sail past `WRAPPER_OVERSIZE_BYTES` and be read to its last line,
    // which is the obligation this verb exists to honour. Both sizing callers
    // already in the tree pass `-L` (ccd/ccrc:2601, ccrc-doctor-checks:2542).
    //
    // The pick list's own number is the second half: an operator choosing from
    // a list would be shown the link's length rather than the launcher's size.
    const home = box('ccrc-account-cands-symlink-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const target = join(home, 'lab-dev0-real');
    writeFileSync(target,
      '#!/usr/bin/env bash\nexport CLAUDE_CONFIG_DIR="$HOME/.claude-lab-dev0"\n'
      + `# ${'x'.repeat(1024 * 1024)}\n`, { mode: 0o755 });
    symlinkSync(target, join(home, '.local', 'bin', 'lab-dev0'));
    // The link's own `stat` size is `target.length` — comfortably under the
    // cap — while the file it names is over it. Sized through the link, this
    // is an oversize skip; sized on the link, it is a megabyte read.
    expect(target.length).toBeLessThan(1024 * 1024);
    expect(oneObject(run(home, ['account', 'candidates']))['candidates']).toEqual([]);
  });

  it('refuses when it cannot size an id-shaped file, instead of listing one without a size', () => {
    // THE GUARD AT ccd/ccrc:4027-4028, WHICH NOTHING PINNED UNTIL REVIEW
    // ROUND 1 (deleting both lines left this file at 25 passed). The verb's own
    // comment states the direction and it is not the obvious one: an id-shaped,
    // undeclared file this run cannot SIZE is a REFUSAL and not a skip, because
    // it might be a candidate and this run cannot tell — `ccrc-adopt`'s
    // direction for the same unmeasurable (ccrc-wrapper-shape:153-154 names
    // both directions and why they differ). A pick list is a list of things to
    // CHOOSE, so "here is one, no idea how big" invites a choice on no evidence.
    //
    // POISONING `stat` IS THE WAY IN. `_plat_size` shells out to it
    // (ccd/ccrc:150), and `ghContainedEnv` puts `<home>/.local/bin` FIRST on
    // PATH (ccdWsHelpers.ts:185), so a shim there outranks the real one — the
    // same mechanism as this file's `env()` poisons for curl/systemctl/launchctl.
    // It is planted per-CASE rather than in `env()` because a box with no
    // working `stat` is this one case's subject and every other case's broken
    // fixture.
    //
    // `stat` IS ITSELF ID-SHAPED — it matches WRAPPER_ID_RE, so the scan sees
    // the poison — and it is dropped by `_wrap_declares_config_dir` exactly as
    // the four harness poisons are (the empty-list case below names that
    // mechanism). Measured separately at review round 1 with a FUNCTIONAL
    // `#!/bin/sh` shim of the same name and the same shape: candidates came
    // back `['lab-dev0']`, so the poison contributes nothing to the very list
    // it is here to prevent.
    //
    // WITHOUT THE GUARD this is not a refusal at all: `sz` stays empty, the
    // size comparison one line down errors on a non-integer and `continue`s, and
    // every file — including the launcher planted here — is silently skipped.
    // The verb answers `{"candidates":[]}` at exit 0: "nothing to connect" and
    // "I cannot see" arriving as one value.
    const home = box('ccrc-account-cands-unmeasurable-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantLauncher(home, 'lab-dev0', wrapperBody('.claude-lab-dev0'));
    writeFileSync(join(home, '.local', 'bin', 'stat'),
      '#!/bin/sh\necho "ccrc tests must never size with this box\'s stat" >&2\nexit 97\n',
      { mode: 0o755 });
    const r = run(home, ['account', 'candidates']);
    expect(r.code).toBe(1);
    const j = oneObject(r);
    expect(j['ok']).toBe(false);
    expect(j['error']).toBe('unmeasurable');
  });

  it('tells a missing projection from an unsourceable one, in the projection\'s own vocabulary', () => {
    // THE OTHER TWO GUARDS IN THIS FUNCTION, WHICH NOTHING PINNED EITHER
    // (ccd/ccrc:3981-3982 and :3988-3992). Review round 1 pinned the
    // `unmeasurable` guard above and left its two siblings in the same function
    // unpinned — which is the "correcting the instance is not correcting the
    // claim" failure, so they are closed here in the same breath.
    //
    // THE FIXTURE IS WHY THEY WERE INVISIBLE: `seedBoxRoster` always writes
    // accounts.sh (it runs the real generator, which is the point of it), so no
    // case had ever reached `_acct_candidates` without a readable projection.
    // A fixture that is always correct cannot exercise a guard about being
    // wrong.
    //
    // THE TWO CODES ARE THE SUBJECT, NOT INCIDENTAL (D-1923). They were
    // `roster-absent`/`roster-invalid` until review round 1, borrowed from
    // `readRoster`, which reads a DIFFERENT FILE with a different remedy —
    // regenerate the projection with `ccrc install`, versus edit the JSON you
    // wrote by hand. Tasks 24 and 27 read both files from one subcommand, so
    // the pair (subcommand, code) cannot disambiguate them. This case is the
    // mechanism behind that ruling: rename either code back and it reds.
    const gone = box('ccrc-account-projection-absent-');
    seedBoxRoster(gone, FIXTURE_ROSTER);
    rmSync(join(gone, '.ccrc', 'accounts.sh'));
    const a = run(gone, ['account', 'candidates']);
    expect(a.code).toBe(1);
    const aj = oneObject(a);
    expect(aj['ok']).toBe(false);
    expect(aj['error']).toBe('projection-absent');
    // The remedy names the verb that fixes it, not merely the fault.
    expect(String(aj['detail'])).toContain('ccrc install');

    // PRESENT AND UNSOURCEABLE IS A SECOND CONDITION, NOT THE SAME ONE: the
    // file is there, so `[ -f ]` passes and the operator's fix is different.
    // An unterminated array is a PARSE error, so `.` fails before any line of
    // it runs — which is also why the subshell (`_inst_dirs`' rule, cited at
    // :3928-3931) matters: a projection that redefined `_ccrc_die` on its way
    // to failing must not be able to take the refusal helper with it.
    const bad = box('ccrc-account-projection-invalid-');
    seedBoxRoster(bad, FIXTURE_ROSTER);
    writeFileSync(join(bad, '.ccrc', 'accounts.sh'), 'CCRC_ACCOUNTS=(\n');
    const b = run(bad, ['account', 'candidates']);
    expect(b.code).toBe(1);
    const bj = oneObject(b);
    expect(bj['ok']).toBe(false);
    expect(bj['error']).toBe('projection-invalid');
    // Two files, two vocabularies: neither answer may borrow `roster-*`, which
    // belongs to accounts.json.
    expect(String(aj['error']) + String(bj['error'])).not.toContain('roster-');
  });

  it('prints no byte of any candidate\'s contents', () => {
    // `_check_wrappers`' PATHS-ONLY rule. A launcher on a real box can carry an
    // API key on its `export` line; a pick list that echoed it would be the
    // disclosure this whole verb is shaped to avoid.
    const home = box('ccrc-account-cands-quiet-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'lab-dev0'),
      '#!/usr/bin/env bash\nexport CLAUDE_CONFIG_DIR="$HOME/.claude-lab-dev0"\n'
      + 'export ANTHROPIC_AUTH_TOKEN=CANARY-8b41d2-not-a-real-token\nexec claude "$@"\n',
      { mode: 0o755 });
    const r = run(home, ['account', 'candidates']);
    // THE PICK LIST HAS TO EXIST FIRST, and `lab-dev0` has to be IN it. A
    // refusal prints no candidate's bytes either, so on its own the canary
    // assertion is green with the subcommand disabled — measured at review
    // round 1 with `ACCT_SUBS=""`. Naming the candidate is the stronger half:
    // `_wrap_declares_config_dir` only lists a file it OPENED and read to the
    // last line, so a launcher that appears here is a launcher whose canary
    // line was genuinely read and genuinely not echoed.
    expect(r.code).toBe(0);
    const cands = oneObject(r)['candidates'] as { name: string }[];
    expect(cands.map((c) => c.name)).toContain('lab-dev0');
    expect(r.stdout + r.stderr).not.toContain('CANARY-8b41d2');
  });

  it('a bin directory with nothing account-shaped in it answers an empty list, not a refusal', () => {
    // NOT an empty directory, and the name says so: `ghContainedEnv` +
    // `harnessBin` (ccdWsHelpers.ts:123-127) create `<home>/.local/bin` and
    // plant `gh`, and this file's own `env()` plants curl/systemctl/launchctl
    // beside it. All four are id-shaped `#!` scripts, so they pass two of the
    // predicates and are dropped by `_wrap_declares_config_dir` — which is
    // exactly the "anything looser would report every tool in ~/.local/bin as
    // an account" case doctor's comment names (ccrc-doctor-checks:2382-2386),
    // arriving here for free.
    const home = box('ccrc-account-cands-empty-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const r = run(home, ['account', 'candidates']);
    expect(r.code).toBe(0);
    expect(readdirSync(join(home, '.local', 'bin')).sort())
      .toEqual(['curl', 'gh', 'launchctl', 'systemctl']);
    expect(oneObject(r)['candidates']).toEqual([]);
  });
});

/** A box whose `ccrc/deploy` is a REAL directory holding a stand-in
 *  `account-op.mjs` that behaves exactly as an OLDER build of that file does:
 *  it has `refuse` — the op this file was born with, and the one every refusal
 *  on either side goes through — and answers an op it does not know the way
 *  `main` does today, with a usage line on STDERR, NOTHING on stdout and
 *  exit 2 — or, for a case that needs a shape that is NOT skew, whatever
 *  `unknownOpExit` says instead.
 *
 *  That is not a hypothetical shape: it is the shape of the box this very
 *  commit creates while it is half-deployed. `ccd/ccrc` lands by
 *  `install_atomic` and `deploy/` by rsync, so a run can find a ccrc that
 *  knows `roster` beside an `account-op.mjs` that does not. */
function skewedBox(prefix: string, unknownOpExit = 2): string {
  const home = box(prefix);
  rmSync(join(home, 'ccrc', 'deploy'));   // the symlink into the real tree
  mkdirSync(join(home, 'ccrc', 'deploy'), { recursive: true });
  writeFileSync(join(home, 'ccrc', 'deploy', 'account-op.mjs'),
    'const a = process.argv;\n'
    + 'if (a[2] === "refuse") {\n'
    + '  const g = (k) => a[a.indexOf(`--${k}`) + 1];\n'
    + '  process.stdout.write(`${JSON.stringify(\n'
    + '    { ok: false, error: g("code"), detail: g("detail") })}\\n`);\n'
    + '  process.exitCode = 0;\n'
    + '} else {\n'
    + '  process.stderr.write("usage: node deploy/account-op.mjs <refuse> [--<key> <value>]…\\n");\n'
    + `  process.exitCode = ${unknownOpExit};\n`
    + '}\n');
  return home;
}

describe('ccrc account: the seam with deploy/account-op.mjs', () => {
  it('propagates the node side\'s own exit code when there IS an answer', () => {
    // The first measurement of this in the tree: until this task nothing in
    // bash called a non-`refuse` op, so "node exits with its own class and
    // cmd_account propagates it" was asserted by `_acct_node`'s header and
    // executed by nothing. Both classes, one box each — 0 for an answer and 1
    // for a box-said-no — through the same `|| exit $?`.
    const ok = box('ccrc-account-seam-ok-');
    seedBoxRoster(ok, FIXTURE_ROSTER);
    expect(run(ok, ['account', 'roster']).code).toBe(0);
    expect(run(box('ccrc-account-seam-one-'), ['account', 'roster']).code).toBe(1);
  });

  it('an op the deploy side does not have is a refusal WITH a body, never a bare exit 2', () => {
    // THE EMPTY-BODY SEAM. `deploy/account-op.mjs`'s `main` answers an unknown
    // op with exit 2 and an EMPTY stdout — right for a human who mistyped an
    // op (the usage line is on stderr where a human is looking) and wrong for
    // this verb, whose entire contract is one JSON object on stdout. Propagated
    // blindly it hands the PWA an exit code with no body: two conditions, one
    // value, which is the overloaded seam CLAUDE.md forbids.
    //
    // Bash closes it rather than node, and the direction is the reason: the
    // skew that exists TODAY is a NEW ccrc beside an OLD account-op.mjs, and no
    // change to the file shipping today can teach yesterday's copy to print an
    // envelope. Only the caller can.
    const home = skewedBox('ccrc-account-skew-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const r = run(home, ['account', 'roster']);
    expect(r.code).toBe(1);
    const j = oneObject(r);
    expect(j['ok']).toBe(false);
    expect(j['error']).toBe('no-answer');
    // The measured fact, not a guess about the cause: the exit code it gave.
    expect(String(j['detail'])).toContain('exited 2');
    expect(String(j['detail'])).toMatch(/re-run the install|redeploy/);
  });

  it('names the cause from the exit code, and does not blame a stale build for a kill', () => {
    // REVIEW ROUND 1. `_acct_answer` measures ONE thing — "stdout was empty" —
    // and its own comment says it does not guess WHY; the remedy sentence then
    // guessed anyway, naming version skew as "the known cause" for all four
    // conditions. Two of them provably are not skew, and `skewedBox` above is
    // the proof: an OLD build answers an op it does not have with exit **2**,
    // so an exit of 137 is a process that was KILLED and nothing about the
    // build will change it. Handing that operator "re-run the install" is a
    // remedy for a fault they do not have.
    const home = skewedBox('ccrc-account-skew-killed-', 137);
    seedBoxRoster(home, FIXTURE_ROSTER);
    const r = run(home, ['account', 'roster']);
    expect(r.code).toBe(1);
    const j = oneObject(r);
    expect(j['error']).toBe('no-answer');
    // The measured fact is still carried verbatim, exactly as the rc=2 case
    // above asserts it — what changes is only the sentence that follows.
    expect(String(j['detail'])).toContain('exited 137');
    expect(String(j['detail'])).toContain('signal 9');
    expect(String(j['detail'])).not.toContain('half-updated box');
  });

  it('closes the same seam for candidates, not just for roster', () => {
    const home = skewedBox('ccrc-account-skew-cands-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantLauncher(home, 'lab-dev0', wrapperBody('.claude-lab-dev0'));
    const r = run(home, ['account', 'candidates']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('no-answer');
  });

  it('a malformed refusal call is ONE signal on ONE stream, never a body about another error', () => {
    // D-1983. `deploy/account-op.mjs`'s `refuse` op can exit non-zero (2,
    // bad-argv) HAVING ALREADY written an envelope to stdout — for the wrong
    // error — and `_acct_refuse` used to fire `_ccrc_die` on top of it. A
    // detail that BEGINS with `--` is the reachable shape (M6 reads it as a
    // mis-spelled key), and Task 22's own three refusal sentences were the
    // first callers in the file to open with a flag name. Measured before the
    // fix, verbatim: exit 1, a `{"ok":false,"error":"bad-argv",…}` object on
    // stdout AND a `ccrc:` sentence on stderr — a caller parsing stdout gets a
    // well-formed answer about an error that did not happen.
    //
    // The close is caller-side ON PURPOSE and this test cannot see why, so it
    // is said here: `ccd/ccrc` lands by `install_atomic` and `deploy/` by
    // rsync, so a fixed `ccrc` can meet an OLD `account-op.mjs`. A capture
    // works against every version of the callee; a parser change in node works
    // only against the new one.
    const home = box('ccrc-account-refuse-malformed-');
    const r = sourceCall(home, '_acct_refuse 2 some-code "--leading dashes in the detail"');
    // NODE'S EXIT CODE IS CARRIED, NOT PROPAGATED: 1, this file's "the tool ran
    // and the answer was bad", because once the intended envelope never printed
    // the class is unknowable — not 2, and not the caller's "$1".
    expect(r.code).toBe(1);
    expect(r.stdout, 'a body about the wrong error reached stdout').toBe('');
    expect(r.stderr).toContain('deploy/account-op.mjs exited 2');
    expect(r.stderr).toContain('bug in ccrc');
    // Node's own diagnosis still reaches the operator: stderr is never captured.
    expect(r.stderr).toContain('bad-argv');
  });

  it('and an ORDINARY refusal is unchanged — one object on stdout, the caller\'s class', () => {
    // The other direction of the same close: the capture must not turn every
    // refusal into a die. `_acct_answer`'s discriminator is the BODY
    // (`[ -z "$body" ]`) and this one's is the EXIT CODE, and that difference
    // is deliberate — every op except `refuse` decides its own class and exits
    // with it, so harmonising the two would break `_acct_answer`.
    const home = box('ccrc-account-refuse-ordinary-');
    const r = sourceCall(home, '_acct_refuse 2 some-code "an ordinary sentence"');
    expect(r.code).toBe(2);
    const j = oneObject(r);
    expect(j['error']).toBe('some-code');
    expect(j['detail']).toBe('an ordinary sentence');
  });
});

/** A marked, obviously-fake token. It appears in exactly one place on a healthy
 *  box and this suite proves it. */
const CANARY = 'CANARY-3d7f52-not-a-real-token';

/** A second marked non-secret, whose BYTES ARE SHELL SYNTAX — a space, a `#`,
 *  a `$( )` and a balanced pair of single quotes. It is what the canary above
 *  cannot be: `[A-Za-z0-9-]` is precisely the input for which `printf %q` and
 *  `printf %s` produce the same file, which is why nothing in this suite
 *  noticed D-1984 until a fixture stopped agreeing with them. Its command
 *  substitution targets a file INSIDE the fixture HOME, so "did a byte of this
 *  run" is a `existsSync` rather than an argument. */
const SHELL_SYNTAX = `NOT-A-SECRET-a b$(touch "$HOME/EXECUTED")c#d'e'f`;

/** Every regular file under `home`, EXCLUDING symlinks — the fixture symlinks
 *  `~/ccrc/deploy` and `~/ccrc/shared` at the repository, and following those
 *  would walk the whole checkout. */
function filesUnder(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) filesUnder(p, out);
    else if (st.isFile()) out.push(p);
  }
  return out;
}

/** Sources `ccd/ccrc` and calls one function — the `BASH_SOURCE` guard at
 *  ccd/ccrc:7292 exists for exactly this, and `ccd-clip.test.ts:32` /
 *  `ccd-workspaces.test.ts:487` already do it to `ccd`. Task 24 gives these two
 *  helpers a caller; proving them before that caller exists is what stops a
 *  defect in either from hiding inside `add`'s longer transcript. */
function sourceCall(home: string, script: string, stdin = ''): Result {
  const r = spawnSync(BASH, ['-c', `. "${ccrcIn(home)}"\n${script}`],
    { env: env(home), encoding: 'utf8', input: stdin });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** The same one sourced call, but on a REAL TERMINAL.
 *
 *  `ccrc`'s other three `[ -t 0 ]` gates are each pinned with a pty for the
 *  reason `ccrc-passwd.test.ts:100` states — without a terminal the refusing
 *  branch is the ONLY one a test can reach — and each pins the deletion of its
 *  guard as a mutation (`ccrc-passwd.test.ts:484`, `ccrc-expose.test.ts:262`,
 *  `ccrc-install.test.ts:3352`). This gate INVERTS: it refuses the terminal. It
 *  is pinned the same way anyway, because the inversion does not change the
 *  fact that a pipe-only test can never reach the branch, and a guard no test
 *  can reach is a guard nothing measures. Task 22's plan carried no test for
 *  this code at all; without this one, deleting the `[ -t 0 ]` line leaves the
 *  whole file green.
 *
 *  A pty merges the two streams and terminates lines with CR, so this asserts
 *  on the STREAM rather than through `oneObject` — the claim is about which
 *  branch ran, and the one-object stdout contract is already pinned by the
 *  piped cases above. */
function sourceCallTty(home: string, script: string): Promise<Result> {
  return new Promise((resolve) => {
    const p = pty.spawn(BASH, ['-c', `. "${ccrcIn(home)}"\n${script}`], {
      name: 'xterm-color', cols: 200, rows: 40, cwd: home,
      env: env(home) as Record<string, string>,
    });
    let out = '';
    let done = false;
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout: out, stderr: '' });   // a pty merges the two streams
    };
    // 19s, NOT 20s — `ccrc-install.test.ts:3377`'s number and its reason.
    // `server/vitest.config.ts:87` sets `testTimeout: 20_000` on linux, so a
    // 20s timer here TIES with the runner and loses: measured at review round
    // 1, vitest won at 20012ms, `p.kill()` never ran and the pty `bash` was
    // left for worker teardown to reap. A second under it makes this helper's
    // own cleanup the thing that fires, and turns the M5 mutation from a
    // 20s runner timeout into `expected -1 to be 2` with the child reaped.
    const timer = setTimeout(() => { p.kill(); finish(-1); }, 19_000);
    p.onData((d) => { out += d; });
    p.onExit(({ exitCode }) => finish(exitCode));
  });
}

describe('ccrc account: the credential reads from stdin or not at all', () => {
  it('refuses a literal value — argv is world-readable', () => {
    // cmd_passwd's header (ccd/ccrc:2960-2968): nothing on argv, and no
    // here-string either (bash implements `<<<` with a temp file on disk).
    const home = box('ccrc-account-cred-argv-');
    const r = sourceCall(home, `_acct_read_credential '${CANARY}'`);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('credential-not-stdin');
    // The refusal must not echo back what it refused.
    expect(r.stdout + r.stderr).not.toContain(CANARY);
  });

  it('refuses a TERMINAL — the one place in this file the tty gate inverts', async () => {
    // `cmd_passwd` (ccd/ccrc:3026), `cmd_expose` (:3221) and `_inst_agent_env`
    // (:4812) all REQUIRE a terminal, because under `curl … | bash` stdin is
    // the installer script. This flag is driven by the server and requires a
    // pipe, so it refuses the terminal instead — three conditions, three codes,
    // and this is the third.
    const home = box('ccrc-account-cred-tty-');
    const r = await sourceCallTty(home, '_acct_read_credential -');
    expect(r.code).toBe(2);
    expect(r.stdout).toContain('"error":"credential-needs-a-pipe"');
    // A refusal, not a prompt: nothing was read, so nothing can have been kept.
    expect(r.stdout).not.toContain('READ-OK');
  });

  it('refuses empty stdin — fail closed against a caller that forgot the body', () => {
    const home = box('ccrc-account-cred-empty-');
    const r = sourceCall(home, '_acct_read_credential -', '');
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('credential-empty');
  });

  it('refuses whitespace-only stdin for the same reason', () => {
    const home = box('ccrc-account-cred-blank-');
    const r = sourceCall(home, '_acct_read_credential -', '   \n');
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('credential-empty');
  });

  it('reads a piped token and never prints it', () => {
    const home = box('ccrc-account-cred-ok-');
    const r = sourceCall(home,
      '_acct_read_credential -\n[ -n "$ACCT_CREDENTIAL" ] && echo READ-OK', `${CANARY}\n`);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('READ-OK');
    expect(r.stdout + r.stderr).not.toContain(CANARY);
  });

  it('the canary lands in one 0600 file under a 0700 dir, and in no other file or stream', () => {
    const home = box('ccrc-account-cred-canary-');
    const r = sourceCall(home,
      '_acct_read_credential -\n_acct_write_secret lab-dev0 compatible ANTHROPIC_AUTH_TOKEN',
      `${CANARY}\n`);
    expect(r.code).toBe(0);

    const secret = join(home, '.cc-secrets', 'lab-dev0-compatible.env');
    expect(readFileSync(secret, 'utf8'))
      .toBe(`export ANTHROPIC_AUTH_TOKEN=${CANARY}\n`);
    expect(lstatSync(secret).mode & 0o777).toBe(0o600);
    // 0700 because `mkdir -p -m 0700` CREATED it — this fixture had no
    // ~/.cc-secrets. An existing one keeps the operator's mode; see the header.
    expect(lstatSync(join(home, '.cc-secrets')).mode & 0o777).toBe(0o700);

    // NEITHER STREAM.
    expect(r.stdout, 'the credential reached stdout').not.toContain(CANARY);
    expect(r.stderr, 'the credential reached stderr').not.toContain(CANARY);

    // NO OTHER FILE. The whole fixture HOME, minus the one file that is
    // supposed to hold it — which is the assertion, not a courtesy: a temp file
    // left behind, a shell history, a log line, all land here.
    const leaked = filesUnder(home)
      .filter((p) => p !== secret)
      .filter((p) => { try { return readFileSync(p, 'utf8').includes(CANARY); } catch { return false; } });
    expect(leaked, 'the credential appears outside ~/.cc-secrets').toEqual([]);

    // AND NO TEMP FILE SURVIVES A SUCCESSFUL WRITE, under either naming rule.
    expect(readdirSync(join(home, '.cc-secrets')).sort()).toEqual(['lab-dev0-compatible.env']);
  });

  it('forgets the credential the moment the file has it', () => {
    // `cmd_passwd`'s `unset p1 p2` (:3123), pinned rather than asserted in a
    // comment: everything after this point in a run can be traced, logged and
    // echoed without a containment argument, and that is a property of the
    // VARIABLE, which only a read of the variable can measure.
    const home = box('ccrc-account-cred-forget-');
    const r = sourceCall(home,
      '_acct_read_credential -\n'
      + '_acct_write_secret lab-dev0 compatible ANTHROPIC_AUTH_TOKEN\n'
      + 'printf "AFTER=[%s]\\n" "$ACCT_CREDENTIAL"', `${CANARY}\n`);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('AFTER=[]');
  });

  it('a write that cannot land is secret-write, and nothing is left where the key goes', () => {
    // The one injection that reaches the WRITE rather than a cheaper guard: the
    // directory exists and is not writable, so `mkdir -p -m 0700` is a no-op on
    // it (POSIX: the mode applies only to a directory it creates) and the
    // redirection into the temp is what fails.
    const home = box('ccrc-account-cred-nowrite-');
    mkdirSync(join(home, '.cc-secrets'), { recursive: true });
    chmodSync(join(home, '.cc-secrets'), 0o500);
    const r = sourceCall(home,
      '_acct_read_credential -\n_acct_write_secret lab-dev0 compatible ANTHROPIC_AUTH_TOKEN',
      `${CANARY}\n`);
    chmodSync(join(home, '.cc-secrets'), 0o700);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('secret-write');
    expect(readdirSync(join(home, '.cc-secrets'))).toEqual([]);
    expect(r.stdout + r.stderr).not.toContain(CANARY);
  });

  it('a token whose bytes are SHELL SYNTAX survives the round trip, and executes nothing', () => {
    // D-1984. This file is SOURCED, not read: `shared/wrapper.mjs:141-143`
    // generates `[ -r "$HOME/<secretsFile>" ] && . "$HOME/<secretsFile>"` into
    // every wrapper, so an unquoted write turns credential bytes into code
    // running as the fleet user at every launch. Measured before the `%q` fix
    // with THIS fixture: the sourced variable came back 14 bytes of 48 and the
    // embedded command substitution EXECUTED.
    //
    // Nothing here prints the value. `READ_LEN` is what the reader kept,
    // `SOURCED_LEN` what a wrapper would get back, `BYTES=exact` compares the
    // two INSIDE the shell (so the value never reaches argv or a message), and
    // the side-effect file is how "executed nothing" is measured rather than
    // argued. The old canary could not have caught this: it is `[A-Za-z0-9-]`,
    // which is exactly the input for which `%q` and `%s` agree.
    const home = box('ccrc-account-cred-shell-');
    const r = sourceCall(home,
      '_acct_read_credential -\n'
      + 'exp="$ACCT_CREDENTIAL"\n'      // before the write forgets it
      + '_acct_write_secret lab-dev0 compatible ANTHROPIC_AUTH_TOKEN\n'
      // Sourced the way a generated wrapper sources it, byte for byte.
      + '[ -r "$HOME/.cc-secrets/lab-dev0-compatible.env" ] '
      + '&& . "$HOME/.cc-secrets/lab-dev0-compatible.env"\n'
      + 'printf "READ_LEN=%s SOURCED_LEN=%s\\n" '
      + '"${#exp}" "${#ANTHROPIC_AUTH_TOKEN}"\n'
      + '[ "$ANTHROPIC_AUTH_TOKEN" = "$exp" ] && echo BYTES=exact || echo BYTES=differ\n',
      `${SHELL_SYNTAX}\n`);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`READ_LEN=${SHELL_SYNTAX.length} SOURCED_LEN=${SHELL_SYNTAX.length}`);
    expect(r.stdout).toContain('BYTES=exact');
    // EXECUTED NOTHING: the fixture's own command substitution would have
    // created this file, and did, before the fix.
    expect(existsSync(join(home, 'EXECUTED')),
      'a byte of the credential ran as code').toBe(false);
  });

  it('the temp is 0600 AT THE MOMENT chmod is called, not merely afterwards', () => {
    // The end state is OVER-DETERMINED and so pins neither line: measured at
    // review round 1, deleting `chmod 600` alone is GREEN and deleting `umask
    // 077` alone is GREEN — either one on its own delivers 0600 to the
    // destination — and only deleting BOTH reds (436 where 384 was expected).
    // What the umask uniquely buys is the WINDOW `_exp_env_write`'s header
    // states (ccd/ccrc:3489-3491): the temp is 0600 from its first byte and is
    // never world-readable between create and chmod. A window is invisible in
    // an end state, so this plants a `chmod` RECORDER first on PATH which stats
    // the temp BEFORE delegating to the real one. Pristine records 600; with
    // `umask 077` deleted it records 644 while every other assertion in this
    // file stays green — which is the mutation this test exists to red.
    const home = box('ccrc-account-cred-window-');
    writeFileSync(join(home, '.local', 'bin', 'chmod'),
      '#!/bin/sh\n'
      + '[ -e "$2" ] && printf \'mode-when-chmod-was-called=%s\\n\' '
      + '"$(stat -c %a "$2")" >> "$HOME/chmod-record"\n'
      + 'for c in /usr/bin/chmod /bin/chmod; do [ -x "$c" ] && exec "$c" "$@"; done\n'
      + 'exit 127\n', { mode: 0o755 });
    const r = sourceCall(home,
      '_acct_read_credential -\n_acct_write_secret lab-dev0 compatible ANTHROPIC_AUTH_TOKEN',
      `${CANARY}\n`);
    expect(r.code).toBe(0);
    // Named, because "chmod was never called" and "it was called on a
    // world-readable temp" are two different defects and an ENOENT names
    // neither. Deleting `chmod 600` reds here; deleting `umask 077` reds below.
    expect(existsSync(join(home, 'chmod-record')),
      'chmod was never called on the temp at all').toBe(true);
    expect(readFileSync(join(home, 'chmod-record'), 'utf8').trim())
      .toBe('mode-when-chmod-was-called=600');
    // The recorder must not have become a second copy of the secret.
    expect(readFileSync(join(home, 'chmod-record'), 'utf8')).not.toContain(CANARY);
  });

  it('a second write overwrites the file in place, at 0600', () => {
    // The property Task 24's ordering relies on: "a failure after the secret
    // write leaves a 0600 file a retry overwrites and nothing else" (spec §5).
    const home = box('ccrc-account-cred-retry-');
    const call = '_acct_read_credential -\n'
      + '_acct_write_secret lab-dev0 compatible ANTHROPIC_AUTH_TOKEN';
    expect(sourceCall(home, call, 'first-token-value\n').code).toBe(0);
    expect(sourceCall(home, call, `${CANARY}\n`).code).toBe(0);
    const secret = join(home, '.cc-secrets', 'lab-dev0-compatible.env');
    expect(readFileSync(secret, 'utf8')).toBe(`export ANTHROPIC_AUTH_TOKEN=${CANARY}\n`);
    expect(lstatSync(secret).mode & 0o777).toBe(0o600);
  });
});

/** `ccrc account add` with the given overrides folded onto a legal request. A
 *  table of refusals is only readable if every row differs in exactly the thing
 *  it is about. */
function addArgs(over: Record<string, string | null> = {}): string[] {
  const base: Record<string, string | null> = {
    '--id': 'lab-dev0', '--provider': 'compatible', '--label': 'lab·dev0', '--hue': 'amber',
    '--base-url': 'https://orchard-api/v1', '--credential': '-',
  };
  const merged = { ...base, ...over };
  const out: string[] = ['account', 'add'];
  for (const [k, v] of Object.entries(merged)) {
    if (v === null) continue;
    out.push(k, v);          // THE SPACE-SEPARATED SPELLING, deliberately: it is
  }                          // the one a caller building argv from typed fields
  return out;                // produces, and the one a naive flag loop drops.
}

/** `node deploy/account-op.mjs check-add …` against a fixture roster — the
 *  half of this task that has no bash caller yet. */
function checkAdd(home: string, over: Record<string, string | null> = {}): Result {
  const base: Record<string, string | null> = {
    '--file': join(home, '.ccrc', 'accounts.json'),
    '--id': 'lab-dev0', '--provider': 'compatible', '--label': 'lab·dev0', '--hue': 'amber',
    '--suffix': '.claude-lab-dev0', '--base-url': 'https://orchard-api/v1',
  };
  const args = ['check-add'];
  for (const [k, v] of Object.entries({ ...base, ...over })) {
    if (v === null) continue;
    args.push(k, v);
  }
  const r = spawnSync('node', [join(REPO, 'deploy', 'account-op.mjs'), ...args],
    { encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Everything a refusal must not have touched.
 *
 *  `bins` is a DIFFERENCE, not an absolute: the four containment poisons
 *  (`gh` from `ghContainedEnv`, plus curl/systemctl/launchctl from `env()`)
 *  live in that directory too, and `box()` plants them before any baseline is
 *  taken precisely so this comparison measures the verb. The property each row
 *  actually means — "no wrapper was written for the id it refused" — is
 *  asserted by name beside this, because a difference over a directory listing
 *  is only as good as the moment the baseline was taken, and this cluster has
 *  already been bitten once by that. */
function untouched(home: string): { roster: string; secrets: string[]; bins: string[] } {
  return {
    roster: readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8'),
    secrets: existsSync(join(home, '.cc-secrets'))
      ? readdirSync(join(home, '.cc-secrets')).sort() : [],
    bins: existsSync(join(home, '.local', 'bin'))
      ? readdirSync(join(home, '.local', 'bin')).sort() : [],
  };
}

/** D-2002. Eighteen of the twenty-six cases below cannot pass until Task 24
 *  puts `add` into `ACCT_SUBS`; at THIS commit every one of them answers
 *  `unknown-subcommand`. They are DEFERRED rather than committed red — the
 *  tree's own idiom (`ccd-session-lifecycle.test.ts:99`) — so that every commit
 *  in this cluster stays green, vitest reports the deferral in its own output,
 *  and a REAL regression at this commit stays visible instead of hiding among
 *  eighteen expected reds.
 *
 *  THE COMPLETION CHECK IS `grep -n 'UNTIL_24' server/test/ccrc-account.test.ts`,
 *  and it must return NOTHING once Task 24 lands. D-2002 named a grep for the
 *  SKIP FORM instead, and that check could never come back clean while it was
 *  written: a docstring explaining a deferral has to name the form it defers
 *  with, so the grep matched this very comment and reported a site that was not
 *  a skip. The form is therefore spelled nowhere above — the paragraph says
 *  "deferred" and lets the constant carry the name. `UNTIL_24` is safe to grep
 *  for BECAUSE this docstring belongs to it: deleting the constant deletes the
 *  sentence that mentions it, which is the property the other check lacked.
 *
 *  IT IS SEVEN DELETIONS, NOT ONE, across four lines — this constant, the three
 *  places its suffix is interpolated into a title, and the three `.skip`s beside
 *  them (two of those titles are literal; the sixteen table rows share one). */
const UNTIL_24 = ' — SKIPPED UNTIL TASK 24 puts `add` in ACCT_SUBS (D-2002)';

describe('ccrc account add: every identity refusal, before the first byte', () => {
  // "EVERY" IS THE SET THIS TASK SHIPS, NOT THE SET THAT EXISTS (D-2004). The
  // pre-pass checks that `--hue` and `--label` were GIVEN and nothing about
  // what they say, so an unknown hue or an unsafe label is still refused by
  // Task 24's roster writer — after `_acct_write_secret` has run. Read the
  // title as a claim about ordering, never about completeness; the arm's own
  // "EVERY REFUSAL IN THIS ARM" (deploy/account-op.mjs:323) is the exact one.
  const cases: [string, Record<string, string | null>, string, number][] = [
    ['bad-id', { '--id': 'Lab_Dev0' }, 'bad-id', 2],
    ['reserved-id', { '--id': 'auth' }, 'reserved-id', 2],
    ['a suffix outside the read root', { '--suffix': '.lab-dev0' },
      'suffix-outside-read-root', 2],
    ['a suffix that is not a safe one-segment name', { '--suffix': '.claude/../x' },
      'bad-suffix', 2],
    ['an id already in the roster', { '--id': 'claude-a' }, 'duplicate-id', 1],
    ['a suffix another account already holds', { '--suffix': '.claude-a' },
      'suffix-collision', 1],
    ['a provider nothing knows', { '--provider': 'orchard' }, 'unknown-provider', 2],
    ['a provider whose lane is somebody else\'s launcher',
      { '--provider': 'openai', '--base-url': null }, 'external-provider-use-declare', 2],
    ['a compatible lane with no endpoint', { '--base-url': null }, 'base-url-required', 2],
    // THE OTHER SIDE OF THE SAME GATE, and the row that keeps `base-url-required`
    // from being read as "every provider without a default". An `anthropic` lane
    // has no endpoint of its own — Claude Code's own default IS the endpoint
    // (§4.2, spec:281-284) — so the flag is not merely optional there, it is
    // meaningless, and a value silently dropped would be a routing decision
    // nobody made. See the acceptance case below, which proves the same provider
    // with NO --base-url is a legal request.
    ['an endpoint on a lane that has none',
      { '--provider': 'anthropic', '--base-url': 'https://orchard-api/v1' },
      'base-url-not-supported', 2],
    ['an endpoint that would carry the key in clear',
      { '--base-url': 'http://orchard-api/v1' }, 'base-url-insecure', 2],
    ['an endpoint with the key in it',
      { '--base-url': 'https://u:p@orchard-api/v1' }, 'base-url-credentials', 2],
    // The three verdicts the first draft of this task folded together. Each
    // `BASE_URL_OK` verdict is its own code, one to one, because each is its own
    // sentence on the sheet (§12.5) and a caller that rendered "unusable" for
    // all three would be the overloaded seam the gate exists to avoid.
    ['an endpoint carrying a query string',
      { '--base-url': 'https://orchard-api/v1?key=x' }, 'base-url-query', 2],
    ['an endpoint carrying a fragment',
      { '--base-url': 'https://orchard-api/v1#frag' }, 'base-url-fragment', 2],
    ['an endpoint that is not a URL at all',
      { '--base-url': 'orchard-api/v1' }, 'base-url-unparseable', 2],
    ['a model map that is not an alias map',
      { '--models': '["orchard/opus-1"]' }, 'models-invalid', 2],
  ];

  for (const [name, over, code, exit] of cases) {
    it.skip(`refuses ${name} with "${code}" at exit ${exit}, having written nothing${UNTIL_24}`,
      () => {
        const home = box(`ccrc-account-add-${code}-`);
        seedBoxRoster(home, FIXTURE_ROSTER);
        const before = untouched(home);
        const r = run(home, addArgs(over), `${CANARY}\n`);
        expect(r.code).toBe(exit);
        const j = oneObject(r);
        expect(j['ok']).toBe(false);
        expect(j['error']).toBe(code);
        expect(untouched(home)).toEqual(before);
        // THE PROPERTY THE DIFFERENCE STANDS FOR, said directly. `untouched`
        // compares a listing against a baseline; this compares against the thing
        // that must not exist, and it holds no matter when the baseline was taken.
        expect(existsSync(join(home, '.local', 'bin', 'lab-dev0'))).toBe(false);
        // THE REFUSAL CAME BEFORE THE READ, TOO: nothing consumed the canary, so
        // nothing could have written it.
        expect(r.stdout + r.stderr).not.toContain(CANARY);
        expect(existsSync(join(home, '.cc-secrets', 'lab-dev0-compatible.env'))).toBe(false);
      });
  }

  it('the loopback exception is real — an api-key lane on 127.0.0.1 is accepted', () => {
    // §4.3: this fleet's existing api-key lanes already run against a loopback
    // proxy, and `http:` there carries nothing across a network. The gate's
    // whole shape depends on this arm existing, so it is pinned beside the
    // refusals rather than left to the base-url suite.
    const home = box('ccrc-account-add-loopback-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const r = checkAdd(home, { '--base-url': 'http://127.0.0.1:8642' });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)['plan']).toMatchObject({
      // THE NORMALISED VALUE, with the root path `URL` supplies — the plan
      // stores `BASE_URL_OK`'s `url`, not the operator's bytes, so that the
      // roster, the card and `settings.json` all carry the endpoint the lane
      // actually resolves (measured: `new URL('http://127.0.0.1:8642').href` is
      // `'http://127.0.0.1:8642/'`). `baseUrlCases` carries the same row.
      baseUrl: 'http://127.0.0.1:8642/',
      secretsFile: '.cc-secrets/lab-dev0-compatible.env',
      envVar: 'ANTHROPIC_AUTH_TOKEN',
    });
  });

  it('an openrouter lane with no --base-url is given the provider default, not left silent', () => {
    // §4.1 lets the field be absent and READERS default it. `add` materialises
    // it instead (Task 24's argument): the endpoint is roster data, the card
    // shows its host, and doctor's `settings-env-drift` compares the lane's
    // settings.json against the ROSTER — which cannot be done against a field
    // that is not there.
    const home = box('ccrc-account-add-orDefault-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const r = checkAdd(home, { '--provider': 'openrouter', '--base-url': null });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)['plan']['baseUrl']).toBe('https://openrouter.ai/api/v1');
  });

  it('an anthropic login lane gets no secretsFile and no baseUrl at all', () => {
    // §5: `--method login` writes NO secrets file and NO secretsFile roster
    // field — the credential is the config dir's own `.credentials.json`.
    //
    // THIS CASE IS ALSO THE ONE THAT PROVES `base-url-required` IS SCOPED.
    // `anthropic`'s `defaultBaseUrl` is null and this request names none, so a
    // gate keyed on "no default and no flag" would refuse a request spec:417
    // spells out as legal. It resolves to a plan, and `baseUrl` is null in it.
    const home = box('ccrc-account-add-login-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const r = checkAdd(home, { '--provider': 'anthropic', '--base-url': null });
    expect(r.code, r.stderr).toBe(0);
    const plan = JSON.parse(r.stdout)['plan'] as Record<string, unknown>;
    expect(plan['method']).toBe('login');
    expect(plan['secretsFile']).toBe(null);
    expect(plan['baseUrl']).toBe(null);
    expect(plan['envVar']).toBe(null);

    // AND THE DOCUMENTED FLAG VALUE THE TABLE MUST ACCEPT. spec:417 says
    // `--method login|paste|setup-token`; §4.2's cell spells the third one
    // `pane:setup-token`, which is prose about where it runs (§6:511, :547).
    // The vocabulary is the bare one, and this is the assertion that keeps the
    // CLI from refusing a value the spec documents — measured here rather than
    // left to Task 54, because it is `check-add` that decides it.
    const st = checkAdd(home,
      { '--provider': 'anthropic', '--base-url': null, '--method': 'setup-token' });
    expect(st.code, st.stderr).toBe(0);
    const stPlan = JSON.parse(st.stdout)['plan'] as Record<string, unknown>;
    expect(stPlan['method']).toBe('setup-token');
    expect(stPlan['baseUrl']).toBe(null);
    // A setup-token lane IS a token lane: it mints a long-lived OAuth token and
    // the wrapper sources it. THIS ROW IS THE THREE-WRITER AGREEMENT, and it is
    // the one an executor should read twice: the roster's `secretsFile`, the
    // generated wrapper's `source` line, Task 28's `credential` rewrite and
    // `ccd-account-auth`'s `setup-token` capture (Task 54) must all name ONE
    // file. The name is `<id>-oauth.env` because the credential is an OAuth
    // token — §6:511, §7:476, §11 and §12.5 spell it that way, every anthropic
    // lane on this fleet already carries it (`server/test/helpers.ts:69`), and
    // §5:417's `X-P.env` is the general shape rather than a fifth spelling. An
    // api-key lane keeps `<id>-<provider>.env`, which is §4.3:322's own name
    // for it, and the `compatible` cases above assert that half.
    expect(stPlan['secretsFile']).toBe('.cc-secrets/lab-dev0-oauth.env');
    expect(stPlan['envVar']).toBe('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('check-add reaches its own refusals with no caller — the three this task can mutate today', () => {
    // The sixteen table rows above go green in Task 24, when `add` joins
    // ACCT_SUBS. These three drive node DIRECTLY, so this task ships with
    // executable mutation evidence of its own rather than borrowing the next
    // commit's.
    const home = box('ccrc-account-checkadd-refuse-');
    seedBoxRoster(home, FIXTURE_ROSTER);

    const dup = checkAdd(home, { '--id': 'claude-a' });
    expect(dup.code).toBe(1);
    expect(JSON.parse(dup.stdout)['error']).toBe('duplicate-id');

    const insecure = checkAdd(home, { '--base-url': 'http://orchard-api/v1' });
    expect(insecure.code).toBe(2);
    expect(JSON.parse(insecure.stdout)['error']).toBe('base-url-insecure');

    // The endpoint gate's OTHER direction, runnable at this commit: a provider
    // whose lane carries no endpoint refuses the flag rather than dropping it.
    const notSupported = checkAdd(home,
      { '--provider': 'anthropic', '--base-url': 'https://orchard-api/v1' });
    expect(notSupported.code).toBe(2);
    expect(JSON.parse(notSupported.stdout)['error']).toBe('base-url-not-supported');
  });

  it('a BASE_URL_OK verdict this build has no sentence for is refused, not fallen through', () => {
    // THE FAIL-CLOSED DEFENCE, MEASURED. `BASE_URL_OK` lives in
    // `shared/base-url.mjs` and its five reasons ARE this arm's refusal codes;
    // the day that file grows a sixth, `check-add` has no sentence for it. It
    // must then SAY SO — `base-url-unknown-verdict`, exit 1, "a bug in ccrc,
    // not a fact about your endpoint" — rather than fall through and admit an
    // endpoint no gate approved. That is "an adapter may not narrow a
    // distinction it received", applied to a value that can drift underneath
    // this file: the two ship together, and this is the line that says which
    // one moved.
    //
    // WHY THE FIXTURE TREE. Deleting that guard is GREEN against every other
    // case in this suite (measured), because the shipped gate never answers a
    // sixth reason — so the only way to reach the branch is to hand this file a
    // DIFFERENT gate. `account-op.mjs`'s own header counts its closure at
    // exactly three files — itself, `shared/roster-json.mjs` and
    // `shared/base-url.mjs`, the last of which the second imports too — so a
    // tree carrying copies of the first two beside a STUB third is both the
    // only way to reach this branch and a pin on that count: a fourth import
    // would die here with ERR_MODULE_NOT_FOUND rather than answer.
    const home = box('ccrc-account-add-unknownverdict-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const tree = mkTmp('ccrc-account-futuregate-');
    mkdirSync(join(tree, 'deploy'), { recursive: true });
    mkdirSync(join(tree, 'shared'), { recursive: true });
    copyFileSync(join(REPO, 'deploy', 'account-op.mjs'), join(tree, 'deploy', 'account-op.mjs'));
    copyFileSync(join(REPO, 'shared', 'roster-json.mjs'), join(tree, 'shared', 'roster-json.mjs'));
    // A gate from a build newer than this one: a reason spelled in the family's
    // own vocabulary that this build has never heard of. `roster-json.mjs`
    // imports this too and is unbothered — it consults the gate only for an
    // account that CARRIES a baseUrl, and no fixture account does.
    writeFileSync(join(tree, 'shared', 'base-url.mjs'),
      'export const LOOPBACK_HOSTS = [];\n'
      + "export const BASE_URL_OK = () => ({ ok: false, reason: 'base-url-from-a-newer-build' });\n");
    const r = spawnSync('node', [join(tree, 'deploy', 'account-op.mjs'), 'check-add',
      '--file', join(home, '.ccrc', 'accounts.json'), '--id', 'lab-dev0',
      '--provider', 'compatible', '--label', 'lab·dev0', '--hue', 'amber',
      '--base-url', 'https://orchard-api/v1'], { encoding: 'utf8' });
    // EXIT 1, NOT 2: the five per-verdict codes are exit 2 because each is
    // decidable from the operator's own flag value — `cmd_install`'s "the
    // operator typed the right flag and the wrong value". This one is not about
    // the flag at all, and there is nothing the operator can do with it, so it
    // takes the house table's 1: the tool ran and the answer was bad.
    expect(r.status, r.stderr).toBe(1);
    // BEFORE THE PARSE, AND THIS ORDER IS THE POINT (review round 1). The
    // failure this test is most exposed to is its own fixture: a fourth import
    // appearing in `account-op.mjs` makes this tree incomplete, and node answers
    // ERR_MODULE_NOT_FOUND at exit 1 with an empty stdout — which is the exact
    // status this test already expects, so the red arrived at `JSON.parse` as
    // `SyntaxError: Unexpected end of JSON input` and said nothing about the
    // cause. This line puts node's own diagnosis in the failure message.
    expect(r.stdout, r.stderr).not.toBe('');
    const j = JSON.parse(r.stdout ?? '') as Record<string, unknown>;
    expect(j['error']).toBe('base-url-unknown-verdict');
    // IT NAMES WHAT IT HEARD, so the next reader learns WHICH of the two files
    // moved rather than only that they disagree.
    expect(String(j['detail'])).toContain('base-url-from-a-newer-build');
  });

  it.skip(`a method the provider does not have is exit 2, and names the ones it does${UNTIL_24}`,
    () => {
      const home = box('ccrc-account-add-method-');
      seedBoxRoster(home, FIXTURE_ROSTER);
      const r = run(home, addArgs({ '--method': 'login' }), `${CANARY}\n`);
      expect(r.code).toBe(2);
      const j = oneObject(r);
      expect(j['error']).toBe('method-not-supported');
      expect(String(j['detail'])).toContain('paste');
    });

  it('--suffix defaults to .claude-<id>, which is inside the read root by construction', () => {
    const home = box('ccrc-account-add-suffixdefault-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    // `'--suffix': null` OMITS the flag — `checkAdd`'s own base supplies
    // `.claude-lab-dev0`, so calling it bare would assert only that node echoes
    // back what it was handed, which is not a statement about the default at
    // all. The `null` sentinel is `checkAdd`'s documented "drop this flag"
    // spelling (the `if (v === null) continue;` at its loop), and it is what
    // makes this the only test in the file that reaches the default branch.
    const r = checkAdd(home, { '--suffix': null });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)['plan']['configDirSuffix']).toBe('.claude-lab-dev0');

    // And the default is derived from the id, not a constant: a different id
    // must move it, or a hard-coded `.claude-lab-dev0` would pass the line above.
    const r2 = checkAdd(home, { '--suffix': null, '--id': 'orchard-api' });
    expect(JSON.parse(r2.stdout)['plan']['configDirSuffix']).toBe('.claude-orchard-api');
  });

  it('`_acct_add_parse` and `check-add` default the config dir to the same string', () => {
    // THE MECHANISM FOR A RULE THIS TASK ENDED UP SPELLING TWICE, and the
    // reason it is a test rather than a paragraph in either file. §4.4's
    // default lives in both halves because each needs it for something the
    // other cannot do: `_acct_add_parse` must MATERIALISE it before its own two
    // suffix gates can measure it (a gate cannot judge a value that does not
    // exist yet), and `check-add` must RESOLVE a complete plan for a caller
    // that reached it by hand — the plan's own Step 3 required `--suffix` while
    // its Step 1 test asserted the arm defaults it, and only one of those could
    // be true. Two spellings of one rule is what this repository forbids, so
    // the agreement is measured; a change to either default reds here.
    //
    // IT IS MEASURABLE AT THIS COMMIT, before `add` joins ACCT_SUBS, the same
    // way the credential cases above reach `_acct_read_credential` with no
    // caller — which is the whole argument for `sourceCall` existing.
    const home = box('ccrc-account-add-suffixagree-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    // TWO IDS, NOT ONE: a pair of hard-coded `.claude-lab-dev0` constants would
    // agree with each other perfectly and mean nothing.
    for (const id of ['lab-dev0', 'orchard-api']) {
      const bash = sourceCall(home,
        `_acct_add_parse --id ${id} --provider compatible --label 'lab·dev0' --hue amber\n`
        + 'printf "SUFFIX=[%s]\\n" "$ACCT_SUFFIX"');
      expect(bash.code, bash.stderr).toBe(0);
      const node = checkAdd(home, { '--suffix': null, '--id': id });
      expect(node.code, node.stderr).toBe(0);
      const resolved = JSON.parse(node.stdout)['plan']['configDirSuffix'] as string;
      expect(resolved).toBe(`.claude-${id}`);
      expect(bash.stdout, `_acct_add_parse and check-add disagree about the default for "${id}"`)
        .toContain(`SUFFIX=[${resolved}]`);
    }
  });

  it('every missing-flag refusal PRINTS — measured on argv, with no caller', () => {
    // D-2006, AND THE TEST WHOSE ABSENCE HID IT. Every case in the table above
    // supplies a COMPLETE argv and varies one value, so not one of them reaches
    // the five paths that refuse an argv for what is NOT on it. Those five are
    // reachable at this commit exactly as the credential cases are — through
    // `sourceCall`, with no `add` arm in `ACCT_SUBS` — and they were broken:
    // each phrased its detail beginning with the flag name, which
    // `readPairs`' M6 guard (deploy/account-op.mjs:278-285) refuses as a
    // mis-spelled key, so `_acct_refuse` could not print its own envelope.
    // Measured before the fix, on all five:
    //
    //     rc=1 (documented: 2), stdout 0 bytes
    //
    // — the verb's central contract broken on every missing-flag path, with
    // the two-disagreeing-signals shape `_acct_refuse`'s header (:3757-3809)
    // calls a documented trap on stderr instead.
    //
    // BOTH ASSERTIONS EARN THEIR PLACE, and neither subsumes the other. The
    // exit code is what reds against THIS defect (1 instead of 2, measured);
    // `oneObject` is what reds against its other half — a refusal that exits 2
    // and prints nothing, or prints a line before its answer. A caller parsing
    // stdout needs both to be true, so both are asserted.
    const home = box('ccrc-account-add-missingflag-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const partial: [string, string][] = [
      ['the loop, a flag with nothing after it', '--id'],
      ['no argv at all', ''],
      ['--label absent', "--id lab-dev0 --provider compatible"],
      ['--hue absent', "--id lab-dev0 --provider compatible --label 'lab·dev0'"],
      ['--provider absent', "--id lab-dev0 --label 'lab·dev0' --hue amber"],
    ];
    for (const [what, argv] of partial) {
      const r = sourceCall(home, `_acct_add_parse ${argv}`);
      expect(r.code, `${what}: ${r.stderr}`).toBe(2);
      const j = oneObject(r);
      expect(j['error'], what).toBe('missing-value');
      // AND THE FLAG NAME SURVIVES THE REWORDING. Opening with prose is only
      // half the rule: a sentence that dropped the flag entirely would print
      // fine and leave the operator a code with no fix. It is now mid-sentence,
      // which is exactly where `_acct_refuse`'s header says to put it.
      expect(String(j['detail']), what).toMatch(/--[a-z]/);
    }
  });

  it.skip(`both flag spellings work, and a flag with no value is exit 2${UNTIL_24}`, () => {
    // `cmd_install`'s rule (:4475-4485): BOTH `--flag VALUE` and `--flag=VALUE`
    // for every value-taking flag, a missing value with its own message, and a
    // wrong VALUE for a right flag getting its own sentence (:4486-4489).
    //
    // THE SPACE FORM IS THE ONE THAT BREAKS SILENTLY. A loop that shifts inside
    // its first `case` and then switches on `$1` again is switching on the
    // VALUE, so every `--flag VALUE` assignment is dropped and every refusal
    // below arrives as `missing-value`. Both spellings are asserted here, and
    // every row of the table above drives the space form.
    const home = box('ccrc-account-add-flags-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const eq = run(home, ['account', 'add', '--id=auth', '--provider=compatible',
      '--label=lab·dev0', '--hue=amber', '--base-url=https://orchard-api/v1']);
    expect(oneObject(eq)['error']).toBe('reserved-id');
    const spaced = run(home, ['account', 'add', '--id', 'auth', '--provider', 'compatible',
      '--label', 'lab·dev0', '--hue', 'amber', '--base-url', 'https://orchard-api/v1']);
    expect(oneObject(spaced)['error'], 'the space-separated spelling dropped its values')
      .toBe('reserved-id');
    const mixed = run(home, ['account', 'add', '--id', 'auth', '--provider=compatible',
      '--label', 'lab·dev0', '--hue=amber', '--base-url', 'https://orchard-api/v1']);
    expect(oneObject(mixed)['error']).toBe('reserved-id');
    const missing = run(home, ['account', 'add', '--id']);
    expect(missing.code).toBe(2);
    expect(oneObject(missing)['error']).toBe('missing-value');
    const unknown = run(home, ['account', 'add', '--nope', 'x']);
    expect(unknown.code).toBe(2);
    expect(oneObject(unknown)['error']).toBe('unknown-argument');
  });
});

// ── THE SCAN THAT MAKES A CONVENTION A MECHANISM (D-2006) ─────────────────
// `_acct_refuse`'s third argument reaches `deploy/account-op.mjs` as the VALUE
// of `--detail`, and `readPairs`' M6 guard (:278-285) refuses a value that
// begins with `--` — it looks like the next `--key`, and consuming it would
// shift every pair that follows. So a refusal sentence that opens with a flag
// name cannot be printed AT ALL: the refusal exits 1 with an empty stdout and
// a `could not print a refusal envelope` line on stderr, which is the exact
// shape `_acct_refuse`'s own header calls a documented trap.
//
// Task 22 met this, reworded its three sentences and wrote the rule in capitals
// at ccd/ccrc:4090-4093. Task 23 reintroduced it two hundred lines below that
// sentence, in five places, by transcribing a plan that prescribes the shape
// eleven times. A CAPITALISED PARAGRAPH IS A REQUEST; this is the mechanism.
// It covers the whole file, so every future `_acct_refuse` call inherits the
// guard without anyone having to remember it — the same idiom as
// `server/test/single-definition.test.ts`'s source scans.
//
// AND THE RULE WAS ALREADY WRITTEN DOWN TWICE. `_acct_refuse`'s own header
// (ccd/ccrc:3805-3809) names the second shape exactly — "a future site spelled
// `_acct_refuse 2 bad-value \"$sub\"` — the operator's bytes FIRST — would lose
// it, and is the shape to refuse" — and it was written before either draft that
// shipped the shape anyway. Two paragraphs stating a rule and no mechanism
// enforcing it is the whole of D-2006; this is the enforcement.
describe('ccd/ccrc: no refusal sentence may begin with a flag', () => {
  it('every `_acct_refuse` call passes a detail its own printer can carry', () => {
    const lines = readFileSync(CCRC_SRC, 'utf8').split('\n');
    const calls: { line: number; detail: string }[] = [];
    let mentions = 0;
    for (const [i, raw] of lines.entries()) {
      if (!raw.includes('_acct_refuse')) continue;
      if (/^\s*#/.test(raw)) continue;            // prose about the function
      if (/^_acct_refuse\(\)/.test(raw)) continue; // its definition
      mentions++;
      // THE DETAIL MUST BE ONE DOUBLE-QUOTED WORD, and that is half the check:
      // an unquoted detail would word-split into `$4`, `$5`… and arrive at
      // `account-op.mjs` as a mis-spelled key for the same reason.
      const m = /_acct_refuse\s+[0-9]+\s+[a-z][a-z0-9-]*\s+"(.*)$/.exec(raw);
      expect(m, `ccd/ccrc:${i + 1} calls _acct_refuse in a shape this scan cannot `
        + 'read, so the rule below went unmeasured on it. Either put the call on '
        + 'one line as `_acct_refuse <exit> <code> "<detail>"`, or teach this scan '
        + `the new shape — but do not leave it unread.\n    ${raw.trim()}`).toBeTruthy();
      calls.push({ line: i + 1, detail: m![1]! });
    }
    // A SCAN OVER NOTHING IS GREEN. Both halves: every mention this file found
    // was parsed, and the count is in the band the shipped verb actually has.
    expect(calls.length, 'a mention went unparsed').toBe(mentions);
    expect(calls.length, 'this scan found almost no calls — has _acct_refuse been '
      + 'renamed, or the section moved out of ccd/ccrc?').toBeGreaterThan(20);

    for (const c of calls) {
      expect(c.detail.startsWith('--'),
        `ccd/ccrc:${c.line}: this refusal's detail BEGINS with "--", so `
        + '`readPairs`\'s M6 guard refuses it as a mis-spelled --key and the '
        + 'refusal cannot print its own envelope: exit 1 and an empty stdout '
        + 'instead of the documented code and one JSON object. Open the sentence '
        + 'with prose and put the flag name mid-sentence — ccd/ccrc:4090-4093 '
        + `states the rule.\n    ${c.detail}`).toBe(false);
      // AND THE SHAPE THAT IS NOT LITERALLY `--` BUT BECOMES IT. A detail
      // opening with a POSITIONAL parameter opens with an argv token, and
      // inside a flag loop that token IS a flag: `"$1 needs a value"` printed
      // nothing for exactly the same reason `"--id is required"` did. Named
      // variables are not caught and must not be — `$sh`, `$shape`, `$dest` and
      // `$ACCT_ID` are strings this script built, not bytes the operator typed.
      expect(/^\$(\{?[0-9@*])/.test(c.detail),
        `ccd/ccrc:${c.line}: this refusal's detail BEGINS with a positional `
        + 'parameter, which in a flag loop is the flag itself — so at runtime it '
        + 'begins with "--" and cannot print, exactly as a literal "--" cannot. '
        + `Name the flag mid-sentence instead.\n    ${c.detail}`).toBe(false);
    }
  });
});
