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
import {
  chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
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
 *  convergers, and BOTH of them print human lines on stdout (ccd/ccrc:4093,
 *  :4099, :2891). Every `add` case below runs through here. */
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
    // (ccd/ccrc:4299-4302): re-wording a fix into a shrug helps nobody.
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
    // THE GUARD AT ccd/ccrc:3972-3973, WHICH NOTHING PINNED UNTIL REVIEW
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
    // (ccd/ccrc:3926-3927 and :3933-3937). Review round 1 pinned the
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
});
