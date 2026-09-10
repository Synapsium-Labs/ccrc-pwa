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
  chmodSync, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { CCD, ghContainedEnv } from './ccdWsHelpers.js';
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
  return boxAt(mkTmp(prefix));
}

/** A fixture HOME `chars` characters long or a little more, carrying the same
 *  tree `box` builds. It exists for ONE claim (D-2330): `_acct_note_cap`
 *  truncates from the RIGHT at 1024 characters and every note this verb writes
 *  interpolates `$HOME` twice, so which HALF of a note an operator keeps is a
 *  function of how deep their home is. A tmpdir-shallow fixture can never see
 *  that — it is the input on which every ordering of the sentence looks alike.
 *  Real fleet paths reach here: this box's own worktree homes run past 60
 *  characters before a project name, and a `~/.ccrc/probe` under a nested
 *  workspace tree is what the deep case stands in for. */
function deepBox(prefix: string, chars: number): string {
  let home = mkTmp(prefix);
  while (home.length < chars) {
    home = join(home, 'd'.repeat(Math.min(100, Math.max(1, chars - home.length - 1))));
  }
  mkdirSync(home, { recursive: true });
  return boxAt(home);
}

function boxAt(home: string): string {
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
  const poison = (name: string, says: string, ifAbsent = false): void => {
    const p = join(home, '.local', 'bin', name);
    if (ifAbsent && existsSync(p)) return;
    writeFileSync(p,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\n`
      + `echo "${says}" >&2\nexit 97\n`, { mode: 0o755 });
  };
  poison('curl', 'ccrc tests must never reach a real server');
  poison('systemctl', 'ccrc tests must never query this box\'s real systemd');
  poison('launchctl', 'ccrc tests must never query this box\'s real launchd');
  // THE FOURTH POISON, AND IT IS CREATE-IF-ABSENT while the three above are
  // not. `env()` runs on EVERY `run()`, so an unconditional write would
  // re-plant itself between two calls and displace a test's own tmux stub;
  // curl/systemctl/launchctl want the unconditional write because nothing in
  // this file ever wants those to answer. `ghContainedEnv` draws exactly this
  // line for exactly this reason (ccdWsHelpers.ts:192-200, the guard at :233).
  // Without it `_acct_live` (Task 28) reaches the DEVELOPER's tmux server: this
  // runner keeps the real PATH, and a box that happens to have a server running
  // would answer `measured` where a box that does not would answer `null`.
  //
  // IT IS THIS FILE'S OWN POISON RATHER THAN `ghContainedEnv(…, {tmux:true})`,
  // and the difference is the LOG NAME. That one records into `$HOME/tmux-calls`
  // (ccdWsHelpers.ts:229), which is also where `plantTmux` below records — so
  // "the poison answered" and "the fixture's own tmux answered" would be the
  // same file, and the case that asserts tmux was never asked could not tell a
  // silent poison from an absent stub. `$HOME/tmux-poison` keeps the two
  // conditions apart, which is the whole claim of the no-rows case.
  poison('tmux', 'ccrc account tests must never reach this box\'s real tmux', true);
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_DOCTOR_GH_TIMEOUT',
    'CCRC_ACCOUNT_AUTH_TIMEOUT',
    'CCRC_ACCOUNT_PROBE_TIMEOUT']) delete e[k];
  return e;
}

interface Result { code: number; stdout: string; stderr: string }

/** `ccrc <args>` with stdin closed unless a test supplies it.
 *
 *  `extraEnv` IS APPLIED AFTER `env()`, and the order is the whole of its
 *  purpose: `env()` DELETES every `CCRC_*` this CLI reads so the answer never
 *  depends on the developer's exported shell, so a knob a test wants to set is
 *  a knob that has just been deleted. `runDoctor`'s shape
 *  (`ccrc-doctor.test.ts:874`). */
function run(home: string, args: string[], stdin = '',
  extraEnv: NodeJS.ProcessEnv = {}): Result {
  const r = spawnSync(BASH, [ccrcIn(home), ...args],
    { env: { ...env(home), ...extraEnv }, encoding: 'utf8', input: stdin });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** The contract: stdout is EXACTLY one JSON object and nothing else. Parsing
 *  through this helper rather than `JSON.parse(r.stdout)` at each call site is
 *  what makes "one object" an assertion instead of an assumption — a verb that
 *  printed a progress line before its answer would still parse at a call site
 *  that used `.split('\n')[0]`. It is also what catches the failure this
 *  cluster is most exposed to: `add` calls two of `ccrc install`'s own
 *  convergers, and BOTH of them print human lines on stdout (ccd/ccrc:5569,
 *  :5575, :2904). Every `add` case below runs through here. */
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
    // `_ccrc_die` prints NOTHING on stdout (ccd/ccrc:1198); `cmd_expose`'s own
    // missing-subcommand arm (:3190-3193) prints its sentence on STDERR and
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
    // (ccd/ccrc:5559-5561): re-wording a fix into a shrug helps nobody.
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
    // :3983-3986) matters: a projection that redefined `_ccrc_die` on its way
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
    // and — since Task 28 — tmux beside it. All FIVE are id-shaped `#!`
    // scripts, so they pass two of the
    // predicates and are dropped by `_wrap_declares_config_dir` — which is
    // exactly the "anything looser would report every tool in ~/.local/bin as
    // an account" case doctor's comment names (ccrc-doctor-checks:2382-2386),
    // arriving here for free.
    //
    // THE COUNT IS AN ASSERTION AND IT CAUGHT ONE (Task 28): this listing is a
    // CENSUS, so the fourth poison reddened it the moment it landed and had to
    // be admitted here on purpose rather than absorbed. A poison that started
    // declaring a config dir would leave this list unchanged and turn the
    // `candidates` answer below non-empty, which is the half the census cannot
    // see and the `toEqual([])` can.
    const home = box('ccrc-account-cands-empty-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const r = run(home, ['account', 'candidates']);
    expect(r.code).toBe(0);
    expect(readdirSync(join(home, '.local', 'bin')).sort())
      .toEqual(['curl', 'gh', 'launchctl', 'systemctl', 'tmux']);
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
function skewedBox(prefix: string, unknownOpExit = 2, knows: string[] = []): string {
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
    // `knows` LETS THE SKEW BE PLACED AT A CHOSEN OP RATHER THAN AT THE FIRST
    // ONE (review round 2). `declare` now forks node TWICE before it writes —
    // `check-declare`, then `declare-entry` — and the two seams they stand for
    // are different claims: the first refuses with nothing on disk, the second
    // with the kill-switch marker on it. A fixture that only ever failed the
    // first op could not reach the second, and the D-2138 case that names the
    // marker in its clause is a case about the second.
    + `} else if (${JSON.stringify(knows)}.includes(a[2])) {\n`
    + '  process.stdout.write(\'{"ok":true}\\n\');\n'
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
 *  ccd/ccrc:8120 exists for exactly this, and `ccd-clip.test.ts:32` /
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
    // (:5640) all REQUIRE a terminal, because under `curl … | bash` stdin is
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

  it('names an OAUTH lane\'s file from the ENV VAR, at this function\'s own address', () => {
    // THE SECOND BRANCH OF THE LIFTED `_acct_secret_tag`, and until this round
    // nothing drove it HERE. Every other direct call in this describe passes
    // `compatible ANTHROPIC_AUTH_TOKEN` and lands on the provider branch; the
    // `oauth` branch was covered only end-to-end, through `credential`, so the
    // Task-28 lift out of `_acct_write_secret` was safe by coincidence rather
    // than by measurement (D-2145: not "is this tested" but which line, on
    // which input). The third argument is what decides — a lane exporting
    // `CLAUDE_CODE_OAUTH_TOKEN` holds an OAuth token whatever its provider is
    // called — so the provider passed here is `anthropic` and the file is NOT
    // `lab-dev0-anthropic.env`.
    const home = box('ccrc-account-cred-oauthtag-');
    const r = sourceCall(home,
      '_acct_read_credential -\n_acct_write_secret lab-dev0 anthropic CLAUDE_CODE_OAUTH_TOKEN',
      `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    // The listing, not one `existsSync`: a tag rule that answered the provider
    // would write a second name, and only a listing sees which one landed.
    expect(readdirSync(join(home, '.cc-secrets'))).toEqual(['lab-dev0-oauth.env']);
    expect(readFileSync(join(home, '.cc-secrets', 'lab-dev0-oauth.env'), 'utf8'))
      .toBe(`export CLAUDE_CODE_OAUTH_TOKEN=${CANARY}\n`);
    expect(r.stdout + r.stderr).not.toContain(CANARY);
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

/** `node deploy/account-op.mjs add-entry --plan …` — THE WRITER, driven with no
 *  pre-pass in front of it. That is not an artificial shape: it is the arm's own
 *  documented one (`--plan` is `check-add`'s answer, passed through by a caller
 *  that may equally have written it by hand), and it is the only way to reach
 *  the writer's own `rosterFromJson` now that `check-add` runs the same gate
 *  first (D-2152). */
function addEntry(home: string, plan: unknown): Result {
  const r = spawnSync('node', [join(REPO, 'deploy', 'account-op.mjs'), 'add-entry',
    '--file', join(home, '.ccrc', 'accounts.json'), '--plan', JSON.stringify(plan)],
  { encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** THE TWO LANE SHAPES EVERY EMPTY-VALUE TABLE IN THIS FILE DRIVES (D-2151),
 *  as overrides onto `checkAdd`'s own base — which IS the compatible/token lane
 *  (it carries `--base-url`, and its method defaults to `paste`).
 *
 *  A TABLE ON ONE SHAPE MEASURES THE FIXTURE AS MUCH AS THE GUARD. Two of the
 *  nine flags answer with a DIFFERENT code on each lane — measured:
 *  `--base-url ''` is `base-url-unparseable` on `compatible` and
 *  `base-url-not-supported` on `anthropic`; `--models ''` is `models-invalid`
 *  and `models-not-supported` — because the login lane refuses both flags as
 *  flags before anything judges their value. So on that lane the value gates are
 *  covered by a refusal firing for an unrelated reason, which reads exactly like
 *  coverage and is not. Every table below runs on both. */
const CHECK_ADD_LANES: [string, Record<string, string | null>][] = [
  ['compatible/token', {}],
  ['anthropic/login', { '--provider': 'anthropic', '--base-url': null }],
];

/** The same pair for the bash verb, as overrides onto `addArgs`' base. The login
 *  lane drops `--credential` as well: `add --provider anthropic` takes no
 *  credential at all, and that is the lane on which `--credential ''` used to
 *  create the account. */
const ADD_LANES: [string, Record<string, string | null>][] = [
  ['compatible/token', {}],
  ['anthropic/login', { '--provider': 'anthropic', '--base-url': null, '--credential': null }],
];

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

describe('ccrc account add: every identity refusal, before the first byte', () => {
  // D-2004 IS CLOSED FOR THE TWO FIELDS IT NAMED, AND ONE CONDITION IS LEFT —
  // named here rather than gestured at. Task 23 shipped a pre-pass that checked
  // `--hue` and `--label` were GIVEN and nothing about what they SAID, so an
  // unknown hue or a control-character label was refused only by `add-entry`'s
  // `rosterFromJson(next)` — after `_acct_write_secret` had already written the
  // 0600 file. That contradicted the arm's own contract, "EVERY REFUSAL IN THIS
  // ARM FIRES BEFORE ANY CALLER HAS WRITTEN A BYTE"
  // (deploy/account-op.mjs:347-350 — written at :323-326, which is where that
  // sentence sat BEFORE the same commit inserted fourteen lines above it; the
  // sweep that re-measured this commit's ccd/ccrc citations modelled one file's
  // insertion and not the other's). Task 24 closes it: `unknown-hue` and
  // `bad-label` are gates in `check-add`, beside the other identity gates and
  // above the line that derives a path, and the two rows below drive them
  // through the whole verb — so the file the old ordering would have left
  // behind is measured absent by `untouched`.
  //
  // AND `--models` IS CLOSED TOO, in review round 1 (D-2021). The paragraph
  // this replaces named three requests that still reached `roster-invalid` at
  // exit 1 with the secret already on disk, and all three were re-measured
  // before the gates were written rather than taken from the note:
  // `--models '{"opus":"x"}'` (`rosterFromJson` requires ALL FOUR aliases,
  // shared/roster-json.mjs:305-312), a model id carrying a space (`MODEL_ID_RE`,
  // :150 — this block only ever asked for a non-empty string), and a model map
  // on an `anthropic` lane (`exec.models` is refused outside
  // `API_KEY_PROVIDERS`, :296-300). Each now has its own code in `check-add`,
  // its own row below, and its own mutation entry measuring that deleting the
  // gate puts the 0600 file back on disk.
  //
  // THE TITLE IS NOW A CLAIM ABOUT COMPLETENESS AS WELL AS ORDERING, which it
  // was deliberately not before. What keeps it honest is that the gates are
  // derived from the validator's own constants rather than re-spelled beside it
  // (D-2022): `check-add` imports `MODEL_ALIASES`, `MODEL_ID_RE` and
  // `API_KEY_PROVIDERS` from `shared/roster-json.mjs`, so a fifth alias or a
  // sixth api-key provider cannot make the pre-pass and the writer disagree.
  // The one place they still differ is `models.selectable`, and that difference
  // is deliberate, argued at the row for it and in `check-add` itself.
  const cases: [string, Record<string, string | null>, string, number][] = [
    ['bad-id', { '--id': 'Lab_Dev0' }, 'bad-id', 2],
    ['reserved-id', { '--id': 'auth' }, 'reserved-id', 2],
    // THE TWO D-2004 CLOSES, and they sit here because they are identity gates:
    // `check-add` decides them from argv alone, above the line that derives the
    // config directory, so they fire in the same breath as the three above.
    ['a hue nothing knows', { '--hue': 'puce' }, 'unknown-hue', 2],
    // A TAB, which is `\u0009` and therefore inside `LABEL_UNSAFE_RE`'s
    // `[\u0000-\u001f\u007f]`. It is the benign end of that class to print in a
    // test report; the class that motivates the gate is the escape byte, which
    // recolours everything the status bar prints after it (shared/roster.ts:610-627).
    ['a label carrying a control character', { '--label': 'lab\tdev0' }, 'bad-label', 2],
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
    // ── THE FOUR `--models` GATES D-2021 ADDED ──────────────────────────────
    // The first three were MEASURED, at c87819e4 and before the gates existed,
    // answering `roster-invalid` at exit 1 with the 0600 secrets file already
    // written. So on these three rows the `existsSync` in the shared body is
    // not a formality: it is the assertion that goes red when the gate is
    // deleted, which is what makes each of them a D-2004 row rather than a
    // spelling test.
    ['a model map missing three of the four aliases',
      { '--models': '{"opus":"orchard/opus-1"}' }, 'models-incomplete', 2],
    // A SPACE IN THE VALUE, which is also the only assertion in this file that
    // `_acct_add`'s `${ACCT_MODELS:+--models "$ACCT_MODELS"}` keeps a
    // space-carrying value in ONE argv word: a version that word-split would
    // reach `readPairs` as `--models {"opus":"orchard` plus a stray `opus"…}`
    // and refuse as `bad-argv`, not as this row's code.
    ['a model id with a space in it',
      { '--models': '{"opus":"orchard opus","sonnet":"o/s","haiku":"o/h","subagent":"o/g"}' },
      'bad-model-id', 2],
    // THE SECRET THIS ROW WOULD HAVE LEFT IS `lab-dev0-oauth.env`, NOT the
    // `-compatible` one the shared body names by hand: an anthropic lane on a
    // token method derives the `-oauth` spelling (`check-add`'s `secretTag`).
    // `untouched` is what actually catches it, because it lists the whole of
    // `~/.cc-secrets` rather than one name — which is the reason that helper
    // reports a listing and not a boolean.
    ['a model map on a lane that carries none',
      { '--provider': 'anthropic', '--method': 'paste', '--base-url': null,
        '--models': '{"opus":"o/o","sonnet":"o/s","haiku":"o/h","subagent":"o/g"}' },
      'models-not-supported', 2],
    // NOT AN ORDERING FIX, AND THE ROW SAYS SO. This key was already refused
    // before the secret write, as `models-invalid` saying it "is not a routing
    // alias" — a sentence about a key the roster format does not have, said
    // about one it does: `rosterFromJson` ACCEPTS `models.selectable` and
    // validates it (shared/roster-json.mjs:313-339). What this gate changes is
    // the code and the sentence, not the moment, so deleting it leaves the
    // secret absent either way and moves the row to `models-invalid`. It is
    // here because a refusal that misnames the operator's key sends them to fix
    // the wrong thing.
    ['a selectable list, which the roster has and this verb does not write',
      { '--models': '{"opus":"o/o","sonnet":"o/s","haiku":"o/h","subagent":"o/g",'
        + '"selectable":[{"id":"o/o"}]}' },
      'selectable-not-supported', 2],
  ];

  for (const [name, over, code, exit] of cases) {
    it(`refuses ${name} with "${code}" at exit ${exit}, having written nothing`, () => {
      const home = box(`ccrc-account-add-${code}-`);
      seedBoxRoster(home, FIXTURE_ROSTER);
      const before = untouched(home);
      // THE FIXTURE ON STDIN IS SHELL SYNTAX, NOT THE CANARY, and this commit is
      // the first at which that is measurable: it is the first at which `add`
      // reaches the secret write at all. A canary matching `[A-Za-z0-9-]` is
      // exactly the input for which `printf %q` and `printf %s` agree, which is
      // why a green suite carried D-1984 for a wave. Every row here refuses
      // BEFORE `_acct_read_credential`, so what these three assertions measure
      // is that nothing consumed it, nothing wrote it and nothing SOURCED it.
      const r = run(home, addArgs(over), `${SHELL_SYNTAX}\n`);
      expect(r.code).toBe(exit);
      const j = oneObject(r);
      expect(j['ok']).toBe(false);
      expect(j['error']).toBe(code);
      expect(untouched(home)).toEqual(before);
      // THE PROPERTY THE DIFFERENCE STANDS FOR, said directly. `untouched`
      // compares a listing against a baseline; this compares against the thing
      // that must not exist, and it holds no matter when the baseline was taken.
      expect(existsSync(join(home, '.local', 'bin', 'lab-dev0'))).toBe(false);
      expect(r.stdout + r.stderr).not.toContain(SHELL_SYNTAX);
      expect(existsSync(join(home, '.cc-secrets', 'lab-dev0-compatible.env'))).toBe(false);
      // AND NOT ONE BYTE OF IT RAN. The fixture's own command substitution
      // writes this file, so "executed nothing" is an `existsSync` rather than
      // an argument — the shape Task 22's unit case established.
      expect(existsSync(join(home, 'EXECUTED')), 'the credential was sourced').toBe(false);
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

  it('a method the provider does not have is exit 2, and names the ones it does', () => {
    const home = box('ccrc-account-add-method-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const r = run(home, addArgs({ '--method': 'login' }), `${SHELL_SYNTAX}\n`);
    expect(r.code).toBe(2);
    const j = oneObject(r);
    expect(j['error']).toBe('method-not-supported');
    expect(String(j['detail'])).toContain('paste');
    expect(existsSync(join(home, 'EXECUTED')), 'the credential was sourced').toBe(false);
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

  it('… and an EMPTY --suffix is refused rather than defaulted (D-2148)', () => {
    // THE ROW THE TEST ABOVE COULD NOT REACH, and the pair is the point: absent
    // DEFAULTS, empty REFUSES. `??` catches only `undefined`, so before this
    // gate `check-add --suffix ''` answered `ok: true` with
    // `"configDirSuffix": ""` in the plan, and `add-entry` then refused that
    // plan with `roster-invalid` at exit 1 — measured:
    //
    //     {"ok":false,"error":"roster-invalid","detail":"the entry for
    //      \"lab-dev0\" would make …/accounts.json unparseable: account
    //      \"lab-dev0\" has an invalid configDirSuffix \"\". …"}
    //
    // — i.e. AFTER the caller following this file's own documented sequence had
    // written the 0600 secret and the kill-switch marker. That is D-2004's
    // class at the address D-2004 did not sweep, on the hand-caller path
    // `check-add`'s own `--suffix` comment names as the only way in.
    //
    // TWO SIBLINGS, MEASURED THE SAME WAY AND CLOSED BY THE SAME LINE. `--id ''`
    // and `--label ''` also reached `ok: true` and were also refused one step
    // later by `rosterFromJson` ("has an invalid id \"\"", "has no label"). They
    // are rows here because the gate is one loop over three keys: delete it and
    // all three go green at exit 0, and a gate that closed only the flag its
    // deviation named would be this wave's own neighbour defect (D-2145).
    //
    // BASH CANNOT REACH ANY OF THE THREE — `_acct_add_parse`'s `[ -n "$v" ]`
    // refuses first — which is why every row here drives `account-op.mjs`
    // directly. The path is not dead: it is the one the arm is documented to
    // serve.
    const home = box('ccrc-account-checkadd-empty-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    // AND THEY ARE STILL THREE HAND GATES AFTER D-2152 GAVE THIS ARM A CLOSING
    // `rosterFromJson`, which is a DECISION and was measured before it was made:
    // with the loop deleted the pre-pass answers all three, so the question was
    // whether these rows now pin an unreachable gate. They do not. Measured with
    // the loop removed, identical on both lanes:
    //
    //   --id ''      roster-invalid, 1  accounts[3] has an invalid id "". Rename it…
    //   --label ''   roster-invalid, 1  account "lab-dev0" has no label. Add a non-empty…
    //   --suffix ''  roster-invalid, 1  …has an invalid configDirSuffix "". Set it to…
    //
    // Each names a ROSTER FIELD (`configDirSuffix` is not a flag anyone typed)
    // and an entry INDEX, and each prescribes editing an account that does not
    // exist — when the fix is one flag. And each is class 1, "legal on its face
    // and the box said no", for a request that is not legal on its face. So the
    // hand gates keep their place and the pre-pass keeps to what no gate names.
    for (const [lane, over] of CHECK_ADD_LANES) {
      for (const flag of ['--id', '--label', '--suffix']) {
        const r = checkAdd(home, { ...over, [flag]: '' });
        expect(r.code, `${lane} ${flag} '': ${r.stderr}`).toBe(2);
        const j = JSON.parse(r.stdout.split('\n')[0]!) as Record<string, unknown>;
        expect(j['ok'], `${lane} ${flag}`).toBe(false);
        expect(j['error'], `${lane} ${flag}`).toBe('bad-argv');
        expect(String(j['detail']), `${lane} ${flag}`).toContain(flag);
      }
    }
  });

  it('the six keys the empty gate deliberately leaves alone keep their own codes', () => {
    // THE OTHER HALF OF THE SAME LINE, and the reason the gate names three keys
    // instead of nine. Every key `check-add` reads was driven empty and only
    // the three above reached `ok: true`; these six already refuse an empty
    // value with the code that names their OWN condition. Widening the loop to
    // cover them would replace six specific answers with one generic sentence —
    // an adapter narrowing a distinction it received — so this row is what goes
    // red if a later reader "finishes the job" by adding them.
    // IT IS ALSO THE HALF THAT PINS D-2152'S ORDER, and that is why the exit
    // code travels with the code here: the pre-pass this arm now closes with
    // answers `roster-invalid` at 1 and would answer for every one of these six
    // if it ran first or if a helper were deleted. Each row therefore reds in
    // both directions — a helper's specific code replaced by the validator's
    // generic one, and the validator's class replacing the helper's — which is
    // the mechanism standing over "the new pre-pass does not supersede the
    // helpers". The explicit `not.toBe('roster-invalid')` below says the same
    // thing in the words the ruling used, for a reader who changes a code.
    //
    // TWO OF THE SIX ANSWER DIFFERENTLY ON THE TWO LANES, and that is the whole
    // reason this table is per-lane rather than one list (D-2151): on a login
    // lane `--base-url` and `--models` are refused as FLAGS THAT CANNOT MEAN
    // ANYTHING THERE, before any line judges their value — so a table on that
    // lane alone would report both as covered while the value gates beside them
    // went unmeasured.
    const home = box('ccrc-account-checkadd-emptyrest-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const perLane: [string, Record<string, string | null>, [string, string, number][]][] = [
      ['compatible/token', {}, [
        ['--file', 'roster-absent', 1],
        ['--provider', 'unknown-provider', 2],
        ['--hue', 'unknown-hue', 2],
        ['--method', 'method-not-supported', 2],
        ['--models', 'models-invalid', 2],
        ['--base-url', 'base-url-unparseable', 2],
      ]],
      ['anthropic/login', { '--provider': 'anthropic', '--base-url': null }, [
        ['--file', 'roster-absent', 1],
        ['--provider', 'unknown-provider', 2],
        ['--hue', 'unknown-hue', 2],
        ['--method', 'method-not-supported', 2],
        ['--models', 'models-not-supported', 2],
        ['--base-url', 'base-url-not-supported', 2],
      ]],
    ];
    // ONE VERDICT PER ROW, MEASURED FIRST AND ASSERTED ONCE, so a regression
    // names every row it broke rather than throwing at the first.
    const got: Record<string, string> = {};
    const want: Record<string, string> = {};
    for (const [lane, lanes, rows] of perLane) {
      for (const [flag, code, exit] of rows) {
        const r = checkAdd(home, { ...lanes, [flag]: '' });
        const j = JSON.parse(r.stdout.split('\n')[0]!) as Record<string, unknown>;
        expect(String(j['error']), `${lane} ${flag} answered the validator's generic code`)
          .not.toBe('roster-invalid');
        got[`${lane} ${flag}`] = `${String(j['error'])} at ${r.code}`;
        want[`${lane} ${flag}`] = `${code} at ${exit}`;
      }
    }
    expect(got).toEqual(want);
  });

  it('check-add validates the ENTRY it proposes, before any byte (D-2152)', () => {
    // THE STRUCTURAL FIX, AND THE FOUR REQUESTS THAT MEASURE IT. Until D-2152
    // this was the only pre-pass in `account-op.mjs` that returned a plan it
    // never validated: `check-declare` runs `rosterFromJson` on the entry it
    // assembles, `check-add` returned nine resolved fields unjudged. So every
    // field fault no HELPER names travelled into the plan and was refused by
    // `add-entry`'s own validator — one step AFTER a caller following this op's
    // documented sequence had written the 0600 credential and the kill-switch
    // marker. MEASURED at 6d1c75df, each answering `ok: true` here:
    //
    //     check-add --id 'lab dev0'     → ok, plan carries id "lab dev0"
    //     check-add --id 'Lab.Dev'      → ok
    //     check-add --suffix claude-x   → ok, plan carries "configDirSuffix":"claude-x"
    //     check-add --suffix ../evil    → ok, plan carries "configDirSuffix":"../evil"
    //
    // …and each refused one step later with `roster-invalid` at exit 1, e.g.
    // `accounts[3] has an invalid id "lab dev0". Rename it to match
    // ^[a-z][a-z0-9-]{0,31}$ …`.
    //
    // NEITHER FIELD HAS A SHAPE GATE IN THAT ARM AT ALL — bash gates both
    // (`_acct_id_or_refuse`, `_acct_suffix_or_refuse`), and this op was leaning
    // on a caller it does not have. That is why the rows below are these two
    // fields: they are the class the pre-pass exists for, live today, rather
    // than a hypothetical about the fields three later tasks will add.
    //
    // BOTH LANES, for D-2151's reason: the fault is in a field neither lane
    // treats differently, so a difference between the two columns here would
    // itself be the finding.
    const rows: [string, Record<string, string | null>][] = [
      ['an id with a space in it', { '--id': 'lab dev0' }],
      ['an id the wrapper regex refuses', { '--id': 'Lab.Dev' }],
      ['a configDirSuffix that is not dot-prefixed', { '--suffix': 'claude-x' }],
      ['a configDirSuffix carrying a traversal', { '--suffix': '../evil' }],
    ];
    const got: Record<string, string> = {};
    for (const [lane, over] of CHECK_ADD_LANES) {
      const home = box('ccrc-account-checkadd-prepass-');
      seedBoxRoster(home, FIXTURE_ROSTER);
      const before = JSON.stringify(untouched(home));
      for (const [what, fault] of rows) {
        const r = checkAdd(home, { ...over, ...fault });
        const j = JSON.parse(r.stdout.split('\n')[0]!) as Record<string, unknown>;
        let v = `${String(j['error'])} at ${r.code}`;
        // THE VALIDATOR'S OWN REMEDY REACHES THE OPERATOR VERBATIM, which is
        // the whole reason this gate borrows `rosterFromJson`'s sentence rather
        // than inventing a code per field: the fix is the same words whichever
        // of the two gates catches it.
        if (!String(j['detail']).includes('would make') || !String(j['detail']).includes(': ')) {
          v = `${v} + THE SENTENCE LOST THE VALIDATOR'S WORDS`;
        }
        if (JSON.stringify(untouched(home)) !== before) v = `${v} + THE BOX CHANGED`;
        got[`${lane} ${what}`] = v;
      }
      // THE ACCEPTANCE ROW PER LANE. Without it every row above would stay green
      // on a pre-pass that refused everything — the failure mode a validator
      // added at the end of an arm actually has.
      const ok = checkAdd(home, over);
      got[`${lane} a legal request`] = `ok:${JSON.parse(ok.stdout)['ok']} at ${ok.code}`;
    }
    expect(got).toEqual(Object.fromEntries(CHECK_ADD_LANES.flatMap(([lane]) => [
      ...rows.map(([what]) => [`${lane} ${what}`, 'roster-invalid at 1']),
      [`${lane} a legal request`, 'ok:true at 0'],
    ])));
  });

  it('the pre-pass and the writer judge ONE entry and say ONE sentence (D-2152)', () => {
    // ONE BUILDER, TWO CALLERS, ONE VALIDATOR — the shape `declaredEntry`
    // already had and this task gave `addedEntry`. The claim is not "both call
    // rosterFromJson"; it is that they call it on THE SAME OBJECT, which is the
    // only version of this that catches a second spelling. A pre-pass judging an
    // entry built its own way would still validate, still look right, and still
    // disagree with what lands — so it is measured as an equality of ANSWERS on
    // one fault: `check-add`'s refusal must be byte-identical to `add-entry`'s
    // for the plan carrying that same fault.
    //
    // THE ROW IS THE SUFFIX, deliberately. `--id` travels into two DERIVED
    // fields of the plan (`configDirSuffix` and `secretsFile`), so a hand plan
    // that changed the id alone would differ from `check-add`'s in three places
    // and the equality would be measuring the fixture; `--suffix` reaches
    // exactly one field, so the two objects differ in exactly the value under
    // test.
    for (const [lane, over] of CHECK_ADD_LANES) {
      const home = box('ccrc-account-checkadd-agree-');
      seedBoxRoster(home, FIXTURE_ROSTER);
      const before = readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8');
      const legal = JSON.parse(checkAdd(home, over).stdout) as
        { plan: Record<string, unknown> };
      for (const bad of ['claude-x', '../evil']) {
        const pre = checkAdd(home, { ...over, '--suffix': bad });
        const writer = addEntry(home, { plan: { ...legal.plan, configDirSuffix: bad } });
        const pj = JSON.parse(pre.stdout.split('\n')[0]!) as Record<string, unknown>;
        const wj = JSON.parse(writer.stdout.split('\n')[0]!) as Record<string, unknown>;
        expect(`${String(pj['error'])} at ${pre.code}`, `${lane} ${bad}`)
          .toBe(`${String(wj['error'])} at ${writer.code}`);
        expect(String(pj['detail']),
          `${lane} ${bad}: the pre-pass and the writer describe one request two ways`)
          .toBe(String(wj['detail']));
      }
      // AND THE WRITER'S REFUSALS TOUCHED NOTHING EITHER — the property that
      // makes the second gate free to exist rather than a second chance to
      // half-write the file.
      expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).toBe(before);
    }
  });

  it('`add-entry` is still its own last gate, for a plan no pre-pass saw (D-2152)', () => {
    // THE HALF OF THE RULING THAT IS EASY TO LOSE. Now that `check-add` runs the
    // same validator, `add-entry`'s own `rosterFromJson` is unreachable through
    // the documented sequence — which is exactly the condition under which a
    // guard gets deleted as redundant by a later reader. It is not redundant:
    // this arm takes a `--plan` that may have been HAND-WRITTEN (its own header
    // says so, and `_acct_add` passes bytes through unchanged), so it is the
    // last thing between an invented plan and the roster.
    //
    // MEASURED, not asserted: with that try/catch deleted this case writes the
    // bad entry into the roster and answers `ok: true`, and it is the only case
    // in the file that does — no other test reaches this arm with a fault the
    // pre-pass would have caught first.
    const home = box('ccrc-account-addentry-lastgate-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const before = readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8');
    const legal = JSON.parse(checkAdd(home).stdout) as { plan: Record<string, unknown> };
    const r = addEntry(home, { plan: { ...legal.plan, configDirSuffix: 'claude-x' } });
    expect(r.code, r.stderr).toBe(1);
    const j = JSON.parse(r.stdout.split('\n')[0]!) as Record<string, unknown>;
    expect(j['error']).toBe('roster-invalid');
    expect(String(j['detail'])).toContain('configDirSuffix');
    // THE FILE IS UNTOUCHED — the refusal came before the tmp+rename, not after.
    expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).toBe(before);
    // AND THE SAME PLAN WITHOUT THE FAULT LANDS, so the row above is measuring
    // the gate rather than a writer that refuses everything.
    const ok = addEntry(home, legal);
    expect(ok.code, ok.stderr).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).not.toBe(before);
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
    // `readPairs`' M6 guard (deploy/account-op.mjs:302-308) refuses as a
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
    //
    // EACH ROW NAMES THE FLAG ITS ANSWER MUST MENTION, and that third column is
    // review round 3's correction rather than decoration (D-2145). With only
    // `toMatch(/--[a-z]/)` here, deleting the `[ -n "$ACCT_LABEL" ]` gate
    // outright left this file GREEN — measured — because the `--label absent`
    // row's argv is missing `--hue` as well, so the gate BESIDE it answered
    // with the same code and a detail that also matched. The hue and provider
    // gates were measured; the label gate was the neighbour that was not, and
    // one column closes it: the three downstream gates now differ in what they
    // SAY, so only the right one can satisfy its own row.
    const partial: [string, string, string][] = [
      ['the loop, a flag with nothing after it', '--id', '--id'],
      ['no argv at all', '', '--id'],
      ['--label absent', "--id lab-dev0 --provider compatible", '--label'],
      ['--hue absent', "--id lab-dev0 --provider compatible --label 'lab·dev0'", '--hue'],
      ['--provider absent', "--id lab-dev0 --label 'lab·dev0' --hue amber", '--provider'],
    ];
    for (const [what, argv, flag] of partial) {
      const r = sourceCall(home, `_acct_add_parse ${argv}`);
      expect(r.code, `${what}: ${r.stderr}`).toBe(2);
      const j = oneObject(r);
      expect(j['error'], what).toBe('missing-value');
      // AND THE FLAG NAME SURVIVES THE REWORDING. Opening with prose is only
      // half the rule: a sentence that dropped the flag entirely would print
      // fine and leave the operator a code with no fix. It is now mid-sentence,
      // which is exactly where `_acct_refuse`'s header says to put it — and it
      // is the SPECIFIC flag, for the reason the paragraph above gives.
      expect(String(j['detail']), what).toContain(flag);
    }
  });

  it('both flag spellings work, and a flag with no value is exit 2', () => {
    // `cmd_install`'s rule (:5303-5313): BOTH `--flag VALUE` and `--flag=VALUE`
    // for every value-taking flag, a missing value with its own message, and a
    // wrong VALUE for a right flag getting its own sentence (:5314-5317).
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

  it('every flag the loop takes refuses a present-but-EMPTY value (D-2148)', () => {
    // D-2144 read the empty-flag defect as `declare`'s and recorded that `add`
    // "refuses the same input with `missing-value` at exit 2". Measured on the
    // shipped tree at 6ae21f2a that was true of `--provider` and of nothing
    // else. FIVE of these nine reached EXIT 0 and created the lane:
    //
    //     add … --base-url ''    exit 0, lane created   (dropped by ${x:+…})
    //     add … --suffix ''      exit 0, lane created   (silently defaulted)
    //     add … --models ''      exit 0, lane created   (dropped by ${x:+…})
    //     add … --method ''      exit 0, lane created   (dropped by ${x:+…})
    //     add … --credential ''  exit 0, lane created   (login lane: `-z` is true)
    //
    // TWO OF THEM CARRIED ACCIDENTAL COVER, which is why the defect survived
    // two review rounds and why this table drives BOTH LANES rather than one:
    // `--base-url ''` answers `base-url-required` under `compatible` and
    // creates the lane under `anthropic`, and `--credential ''` answers
    // `credential-required` on a token lane and creates the lane on a login
    // one. A table written against `addArgs()`'s compatible base alone would
    // have gone green on both rows without the gate — the exact shape D-2145
    // calls a measured neighbour hiding an unmeasured line. Round 3 answered
    // that by moving the table to the login lane; round 4 drives the pair,
    // because a table on the OTHER single shape has the same defect mirrored
    // (there, `--base-url ''` is covered by `base-url-required` instead), and a
    // review that swaps one accidental cover for another has measured nothing.
    //
    // ALL NINE ROWS MEASURE ONE LINE, the `[ -n "$v" ]` in `_acct_add_parse`.
    // Delete it and the four already-covered rows fall back to their downstream
    // "a value is required" checks and stay green, while these five go to
    // exit 0 — so only the whole set measures the whole gate, and only the
    // whole set distinguishes the gate from the four gates beside it.
    const flags = ['--id', '--provider', '--label', '--hue', '--suffix',
      '--base-url', '--models', '--method', '--credential'];
    // ONE VERDICT PER ROW, MEASURED FIRST AND ASSERTED ONCE, so a regression
    // NAMES every row it broke instead of the first one. A `for` loop of
    // `expect`s throws at row 1 — under the mutation that deletes the gate it
    // reported `--suffix` and said nothing at all about the four rows after it,
    // and those four are exactly the ones D-2148 measured at exit 0. The verdict
    // folds in the side effects as well as the envelope, so "missing-value" here
    // means all six of: exit 2, `ok:false`, that code, the flag NAMED in the
    // sentence, a box byte-identical to its baseline, and no credential sourced.
    //
    // A FRESH BOX PER ROW, for the same reason: on the pre-fix tree row 5
    // CREATED the lane, which would have left every later row running against a
    // dirty roster and answering `duplicate-id` — a table whose rows depend on
    // each other cannot say which line it is measuring.
    const got: Record<string, string> = {};
    for (const [lane, over] of ADD_LANES) {
      for (const flag of flags) {
        const home = box('ccrc-account-add-emptyflag-');
        seedBoxRoster(home, FIXTURE_ROSTER);
        plantUpstream(home);
        plantInstallers(home);
        const before = JSON.stringify(untouched(home));
        // `addArgs` FOLDS THE EMPTY FLAG ONTO A COMPLETE REQUEST, which is what
        // makes the two lanes comparable: the row differs from a request that
        // WOULD have succeeded in exactly one empty flag, on either lane. The
        // login lane also writes NO secret when it succeeds, so on that lane
        // "nothing was written" is a claim about the roster, the marker and the
        // wrapper rather than about a file that was never coming.
        const r = run(home, addArgs({ ...over, [flag]: '' }), `${SHELL_SYNTAX}\n`);
        let v = `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(0, 70))}`;
        try {
          const j = JSON.parse(r.stdout.split('\n')[0]!) as Record<string, unknown>;
          // THE FLAG NAME IS IN THE SENTENCE, which is what makes one shared gate
          // usable: nine flags reach one message, so the message must say which.
          if (r.code === 2 && j['ok'] === false && String(j['detail']).includes(flag)) {
            v = String(j['error']);
          }
        } catch { /* not an envelope — `v` already says what it was instead */ }
        if (JSON.stringify(untouched(home)) !== before) v = `${v} + THE BOX CHANGED`;
        if (existsSync(join(home, '.local', 'bin', 'lab-dev0'))) v = `${v} + A WRAPPER WAS WRITTEN`;
        if (existsSync(join(home, 'EXECUTED'))) v = `${v} + THE CREDENTIAL WAS SOURCED`;
        got[`${lane} ${flag}`] = v;
      }
    }
    expect(got).toEqual(Object.fromEntries(ADD_LANES.flatMap(
      ([lane]) => flags.map((f) => [`${lane} ${f}`, 'missing-value']))));
    // THE ACCEPTANCE ROW, ONE PER LANE, and it is not decoration: the eighteen
    // rows above differ from these requests in exactly one empty flag, so
    // without them the table could be green on a fixture that could never have
    // succeeded — which is precisely how the pre-fix `--suffix ''` row would
    // have LOOKED correct. It is also the row that keeps the login-lane column
    // honest about `--credential`: that lane takes none, so a request missing it
    // must still reach exit 0.
    for (const [lane, over] of ADD_LANES) {
      const okHome = box('ccrc-account-add-emptyflag-ok-');
      seedBoxRoster(okHome, FIXTURE_ROSTER);
      plantUpstream(okHome);
      plantInstallers(okHome);
      const ok = run(okHome, addArgs(over), `${SHELL_SYNTAX}\n`);
      expect(ok.code, `${lane}: ${ok.stderr}`).toBe(0);
    }
  });

  it('the `=` spelling reaches the same empty-value gate', () => {
    // `--suffix=` is one argv word, so it never passes through the `[ $# -ge 2 ]`
    // arm at all — it lands in `$v` through `${1#*=}` instead. The gate is on
    // `$v` for exactly that reason (both spellings converge there once), and
    // this row is what makes "once" a measurement: move the gate up into the
    // space-form arm and it goes red while the table above stays green.
    const home = box('ccrc-account-add-emptyflag-eq-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const r = run(home, ['account', 'add', '--id', 'lab-dev0', '--provider', 'anthropic',
      '--label', 'lab·dev0', '--hue', 'amber', '--suffix=']);
    expect(r.code, r.stderr).toBe(2);
    expect(oneObject(r)['error']).toBe('missing-value');
  });
});

/** The upstream account's own executable — a BINARY, not a wrapper. Doctor says
 *  so out loud about this exact id (ccrc-doctor-checks:2386: "it is a binary,
 *  not a wrapper, and it is checked on its own below"), and `cmd_wrappers`'
 *  witness index reads every id-shaped file in the directory — so planting a
 *  CLAUDE_CONFIG_DIR-setting SCRIPT under the upstream id would plant a shape
 *  this fixture does not mean. */
function plantUpstream(home: string): void {
  const bin = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'claude'), 'PKnot-a-script\n', { mode: 0o755 });
}

/** The four standalone installers, as ARGV RECORDERS at the installed path
 *  `_acct_provision` must reach them by. Recorders rather than the real
 *  scripts because three of the four need a box this fixture is not
 *  (`install-graphify-skill.sh` assembles from a pinned venv, :12-20) — and
 *  because the property under test is that each is invoked once, in order,
 *  scoped to the one new home. The settings.json merge gets the REAL script in
 *  its own case below.
 *
 *  IT IS PART OF EVERY SUCCESSFUL `add` FIXTURE FROM TASK 25 ON, and that is a
 *  statement about the verb rather than about this helper: `_acct_provision`
 *  REFUSES when `$HOME/.cc-sessions/<installer>` is missing, so a box that
 *  never ran `ccrc install` cannot complete an `add`. Every case above that
 *  expects exit 0 therefore plants these beside `plantUpstream`'s binary —
 *  the fixture models an installed box because that is the only box this
 *  verb runs on. The plan's Task 25 did not say so; measured here instead. */
function plantInstallers(home: string): void {
  const d = join(home, '.cc-sessions');
  mkdirSync(d, { recursive: true });
  for (const n of ['install-session-hooks.sh', 'install-coordinator-skill.sh',
    'install-worker-skill.sh', 'install-graphify-skill.sh']) {
    writeFileSync(join(d, n),
      `#!/bin/sh\nprintf '%s %s\\n' "${n}" "$*" >> "$HOME/installer-calls"\nexit 0\n`,
      { mode: 0o755 });
  }
}

describe('ccrc account add: the ordered write', () => {
  it('writes the secret, then the roster entry, then both projections', () => {
    const home = box('ccrc-account-add-ok-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    const r = run(home, addArgs(), `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    const j = oneObject(r);
    expect(j['ok']).toBe(true);

    // 1. THE SECRET, 0600, holding exactly one line.
    //
    // THE CANARY AND NOT `SHELL_SYNTAX` HERE, deliberately: this is the one
    // assertion in the cluster that is BYTE-EXACT about the file's contents, and
    // `printf %q` is the identity on an ordinary token — so the equality below
    // stays true and stays readable. The shell-syntax round trip is the case at
    // the end of this describe, which measures a LENGTH and a file's absence
    // rather than a literal.
    const secret = join(home, '.cc-secrets', 'lab-dev0-compatible.env');
    expect(readFileSync(secret, 'utf8')).toBe(`export ANTHROPIC_AUTH_TOKEN=${CANARY}\n`);
    expect(lstatSync(secret).mode & 0o777).toBe(0o600);

    // 2. THE ROSTER ENTRY, carrying the RESOLVED endpoint — §4.1's "the
    //    endpoint is shown, never hidden", made true on disk.
    const roster = JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8'));
    const added = roster.accounts.find((x: { id: string }) => x.id === 'lab-dev0');
    expect(added).toEqual({
      id: 'lab-dev0', label: 'lab·dev0', configDirSuffix: '.claude-lab-dev0',
      exec: {
        kind: 'generated', provider: 'compatible', baseUrl: 'https://orchard-api/v1',
        secretsFile: '.cc-secrets/lab-dev0-compatible.env',
      },
      homeAble: true, hue: 'amber', telemetry: 'anthropic',
    });
    // APPENDED, never re-ordered: every other account is byte-identical and in
    // its original position, because the roster is USER-OWNED and this verb is
    // its first writer.
    expect(roster.accounts.slice(0, 3)).toEqual(FIXTURE_ROSTER.accounts);
    expect(roster.version).toBe(1);

    // 3. THE PROJECTION, regenerated from the file that was just written.
    const sh = readFileSync(join(home, '.ccrc', 'accounts.sh'), 'utf8');
    expect(sh).toContain('lab-dev0');

    // 4. THE WRAPPER, written by the whole-roster converge (D-1862). Its two
    //    lines are `shared/wrapper.mjs:146` and `:141-143`.
    const wrapper = readFileSync(join(home, '.local', 'bin', 'lab-dev0'), 'utf8');
    expect(wrapper).toContain('export CLAUDE_CONFIG_DIR="$HOME/.claude-lab-dev0"');
    expect(wrapper).toContain(
      '[ -r "$HOME/.cc-secrets/lab-dev0-compatible.env" ] && . "$HOME/.cc-secrets/lab-dev0-compatible.env"');

    // AND THE CANARY IS STILL IN EXACTLY ONE PLACE — the end-to-end form of
    // Task 22's unit case: this is the first run with anything after the secret
    // write, so it measures the whole tail rather than one helper.
    expect(r.stdout + r.stderr).not.toContain(CANARY);
    const leaked = filesUnder(home).filter((p) => p !== secret)
      .filter((p) => { try { return readFileSync(p, 'utf8').includes(CANARY); } catch { return false; } });
    expect(leaked, 'the credential appears outside ~/.cc-secrets').toEqual([]);
  });

  it('the convergers\' transcript goes to stderr, so stdout stays one object', () => {
    // The half `oneObject` alone cannot prove: that the two convergers' lines
    // were REDIRECTED and not discarded. `_inst_accounts_sh` (ccd/ccrc:5575)
    // and `cmd_wrappers` (:2904) both write these on stdout for `ccrc install`.
    // Only the second is pinned there (ccrc-install.test.ts:2818-2819, the
    // `summary:` regex; :2820 is `_inst_wrappers`' own line, ccd/ccrc:7148, and
    // nothing in server/test/ mentions `install: accounts.sh` at all) — so this
    // assertion is also the first one in the tree to measure the accounts.sh
    // line, from the stream this verb moves it to. Here they are the remedy,
    // so they must be present — on the other stream.
    const home = box('ccrc-account-add-streams-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    const r = run(home, addArgs(), `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    oneObject(r);
    expect(r.stderr).toMatch(/^install: accounts\.sh: generated from /m);
    expect(r.stderr).toMatch(/^summary: \d+ account\(s\) in /m);
  });

  it('a failure at the roster write leaves the 0600 file and NO roster entry', () => {
    // THE SPEC'S OWN PROPERTY (§5). Injected at the one seam that can fail
    // between the two writes: `~/.ccrc` unwritable, so the atomic rename of
    // accounts.json cannot land. The file itself stays readable at 0644, so
    // `check-add` and `add-entry` both READ it fine — it is the write that goes.
    const home = box('ccrc-account-add-rosterfail-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const before = readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8');
    chmodSync(join(home, '.ccrc'), 0o500);
    const r = run(home, addArgs(), `${CANARY}\n`);
    chmodSync(join(home, '.ccrc'), 0o700);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('roster-write');

    const secret = join(home, '.cc-secrets', 'lab-dev0-compatible.env');
    expect(existsSync(secret), 'the secret is gone, so a retry has nothing to overwrite').toBe(true);
    expect(lstatSync(secret).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).toBe(before);
    expect(existsSync(join(home, '.local', 'bin', 'lab-dev0'))).toBe(false);
  });

  it('and the retry overwrites that file and completes', () => {
    const home = box('ccrc-account-add-retry-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    chmodSync(join(home, '.ccrc'), 0o500);
    expect(run(home, addArgs(), 'first-token-value\n').code).toBe(1);
    chmodSync(join(home, '.ccrc'), 0o700);
    const r = run(home, addArgs(), `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, '.cc-secrets', 'lab-dev0-compatible.env'), 'utf8'))
      .toBe(`export ANTHROPIC_AUTH_TOKEN=${CANARY}\n`);
  });

  it('an anthropic login lane writes no secrets file and names none in the roster', () => {
    const home = box('ccrc-account-add-loginlane-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    const r = run(home, ['account', 'add', '--id', 'lab-dev0', '--provider', 'anthropic',
      '--label', 'lab·dev0', '--hue', 'amber']);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.cc-secrets'))).toBe(false);
    const roster = JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8'));
    const added = roster.accounts.find((x: { id: string }) => x.id === 'lab-dev0');
    expect(added.exec).toEqual({ kind: 'generated', provider: 'anthropic' });
  });

  it('the roster entry is written LAST of the two, measured by ordering the failures', () => {
    // The ordering is a claim about which of the two survives a failure, and
    // this is the other half of it: make the SECRET write fail and the roster
    // must be untouched too — i.e. neither write happened, not "the roster went
    // first and the secret failed". The directory is 0500 and `mkdir -p -m 0700`
    // does NOT re-mode an existing one (POSIX), so the redirection is what
    // fails — which is exactly why `_acct_write_secret` carries no chmod.
    const home = box('ccrc-account-add-secretfail-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    mkdirSync(join(home, '.cc-secrets'), { recursive: true });
    chmodSync(join(home, '.cc-secrets'), 0o500);
    const before = readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8');
    const r = run(home, addArgs(), `${CANARY}\n`);
    chmodSync(join(home, '.cc-secrets'), 0o700);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('secret-write');
    expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).toBe(before);
  });

  it('a credential whose bytes are SHELL SYNTAX survives the WHOLE verb, and executes nothing', () => {
    // D-1984, AT THE OTHER ALTITUDE. Task 22's case drives `_acct_read_credential`
    // and `_acct_write_secret` directly through `sourceCall`; this one is the
    // first that drives the whole `ccrc account add` chain, which is the level
    // the defect actually shipped at — a unit-shaped test of the writer missed
    // it because the fixture agreed with the bug. Everything between the read
    // and the file now runs too: the plan reader's `node -e` fork, the roster
    // write, the projection and the wrapper converge.
    //
    // NOTHING HERE PRINTS THE VALUE. `SOURCED_LEN` is what a generated wrapper
    // would get back, compared against a length; `EXECUTED` is how "executed
    // nothing" is measured rather than argued. The comparison is done on a
    // LENGTH rather than on the bytes because a byte-exact assertion would have
    // to carry the value into a failure message.
    const home = box('ccrc-account-add-shell-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    const r = run(home, addArgs(), `${SHELL_SYNTAX}\n`);
    expect(r.code, r.stderr).toBe(0);
    oneObject(r);

    // Sourced the way `shared/wrapper.mjs:141-143` generates it, byte for byte —
    // and this is the act that would run an embedded command substitution, so
    // the `EXECUTED` check below has to come after it, not after the add alone.
    const back = sourceCall(home,
      '[ -r "$HOME/.cc-secrets/lab-dev0-compatible.env" ] '
      + '&& . "$HOME/.cc-secrets/lab-dev0-compatible.env"\n'
      + 'printf "SOURCED_LEN=%s\\n" "${#ANTHROPIC_AUTH_TOKEN}"\n');
    expect(back.code, back.stderr).toBe(0);
    expect(back.stdout).toContain(`SOURCED_LEN=${SHELL_SYNTAX.length}`);

    // ANYWHERE under the fixture home, not just at its root: the substitution
    // targets `$HOME/EXECUTED`, but a run that executed it with a different cwd
    // or a different HOME would still be a run that executed it.
    expect(filesUnder(home).filter((f) => f.endsWith('/EXECUTED')),
      'a byte of the credential ran as code').toEqual([]);
    // AND IT DID NOT LEAK ON THE WAY THROUGH. The roster, the projection and the
    // wrapper are all written after the secret, and all three are read here.
    const secret = join(home, '.cc-secrets', 'lab-dev0-compatible.env');
    expect(r.stdout + r.stderr).not.toContain(SHELL_SYNTAX);
    expect(filesUnder(home).filter((f) => f !== secret)
      .filter((f) => { try { return readFileSync(f, 'utf8').includes(SHELL_SYNTAX); } catch { return false; } }),
    'the credential appears outside ~/.cc-secrets').toEqual([]);
  });

  it('a complete model map reaches the entry, in one argv word', () => {
    // THE POSITIVE HALF OF D-2021'S FOUR GATES, and the row that keeps them
    // honest: four refusals prove a gate refuses, and only this proves it is
    // not refusing everything. `missing.length >= 0` in place of `> 0` passes
    // all four rows above and makes no legal model map addable ever again.
    //
    // IT IS ALSO THE ONLY PLACE `exec.models` IS MEASURED ON A WRITTEN ENTRY.
    // `check-add` hands `add-entry` the PARSED object and `add-entry` copies it
    // onto `exec` — two steps, neither of which any other case in this file
    // drives with a map that survives them.
    const home = box('ccrc-account-add-models-ok-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    const models = {
      opus: 'orchard/opus-1', sonnet: 'orchard/sonnet-1',
      haiku: 'orchard/haiku-1', subagent: 'orchard/haiku-1',
    };
    const r = run(home, addArgs({ '--models': JSON.stringify(models) }), `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    const roster = JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8'));
    const added = roster.accounts.find((x: { id: string }) => x.id === 'lab-dev0');
    expect(added.exec.models).toEqual(models);
  });

  it('the plan reader lands the two Task-25 fields in their own slots (D-2025)', () => {
    // D-2025 RECORDED THIS AS UNVERIFIABLE UNTIL TASK 25, AND IT IS NOT.
    // `ACCT_BASE_URL_RESOLVED` and `ACCT_MODELS_RESOLVED` are read by nothing
    // in the shipped verb, so a NUL reader that assigned field 2 to field 3
    // would be green at this commit and wrong two commits later — the
    // deviation's own words. But the two are FILE-SCOPE globals, and
    // `_acct_add` RETURNS on success rather than exiting, so `sourceCall` can
    // run the whole ordered write and then read them out of the same shell.
    // That is the cheap assertion the deviation asked for and did not find.
    //
    // FIELDS 0 AND 1 NEED NO ROW HERE: `envvar` gates the secret write and
    // `_acct_write_secret` names the file from it, so a 0-for-1 swap already
    // reds "writes the secret, then the roster entry" on the file's contents.
    // These two are the only pair with no consumer, which is exactly why they
    // are the pair a swap survives.
    const home = box('ccrc-account-add-fields-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    const models = '{"opus":"o/o","sonnet":"o/s","haiku":"o/h","subagent":"o/g"}';
    const r = sourceCall(home,
      "_acct_add --id lab-dev0 --provider compatible --label 'lab\u00b7dev0' --hue amber "
      + `--base-url https://orchard-api/v1 --credential - --models '${models}' >/dev/null\n`
      + 'printf "BASE=[%s]\\nMODELS=[%s]\\n" "$ACCT_BASE_URL_RESOLVED" "$ACCT_MODELS_RESOLVED"\n',
      `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    // THE ENDPOINT IS THE NORMALISED ONE, which is also what the roster entry
    // carries — so this pins that field 2 is the endpoint and not the models
    // map, and that Task 25 will be handed the value `check-add` resolved
    // rather than the operator's bytes.
    expect(r.stdout).toContain('BASE=[https://orchard-api/v1]');
    expect(r.stdout).toContain(`MODELS=[${models}]`);
  });

  it('the wrapper converge is the whole roster, with no flags (D-1862)', () => {
    // The ruling, pinned in the source rather than asserted in prose: `add`
    // reaches `cmd_wrappers` the way `_inst_wrappers` does — as a function, with
    // no flags — so no `--force`/`--adopt` can destroy a hand-written launcher
    // without an operator typing the flag that authorises it (ccd/ccrc:7130-7133).
    // Comment lines are stripped first: this asserts about CODE, and the
    // paragraph above the code names the flags it does not pass.
    const src = readFileSync(CCRC_SRC, 'utf8');
    const body = /_acct_converge\(\) \{([\s\S]*?)\n\}/.exec(src);
    expect(body, 'ccd/ccrc has no _acct_converge').toBeTruthy();
    const code = body![1]!.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).toMatch(/^\s*\( cmd_wrappers \) >&2 \\$/m);
    expect(code, 'add passes a flag to the converger').not.toMatch(/cmd_wrappers.*--/);
  });
});

/** A box whose `ccrc/deploy/account-op.mjs` is TODAY's file with exactly one op
 *  cut out of it: the named op answers the way an older `main` answers an op it
 *  does not have — a `usage:` line on STDERR, NOTHING on stdout, exit 2 — and
 *  every other op is delegated to the real file, unchanged.
 *
 *  `skewedBox` above cannot express this. That fixture stands in for a file that
 *  has only `refuse`, which reaches `_acct_add`'s FIRST re-emit site and can
 *  never reach the second: `check-add` has to SUCCEED before `add-entry` is
 *  called at all, and the 0600 secret has to be on disk before that. This is the
 *  box D-2051 was measured on — `deploy/account-op.mjs` at 5fb8b24d has
 *  `check-add` and not `add-entry` — written as a shadow of ONE op rather than a
 *  copy of an old file, so it goes on measuring this seam as the real file grows
 *  ops rather than pinning one commit's op list.
 *
 *  Delegation is `await import` of the real module by absolute path, which works
 *  because that file's own last line is `process.exitCode = main(process.argv)`:
 *  importing it RUNS it, argv and all. */
function staleAtBox(prefix: string, missingOp: string): string {
  const home = box(prefix);
  rmSync(join(home, 'ccrc', 'deploy'));   // the symlink into the real tree
  mkdirSync(join(home, 'ccrc', 'deploy'), { recursive: true });
  // AND THE REST OF `deploy/` IS STILL THERE. A box with one stale file is what
  // this fixture stands in for; a box MISSING `gen-accounts.mjs` is a different
  // one, and it refuses at `accounts-sh` long before the op under test — which
  // is what the third case below measured the first time it ran. The two cases
  // above never reach `_acct_converge`, so this changes nothing for them.
  for (const f of readdirSync(join(REPO, 'deploy'))) {
    if (f === 'account-op.mjs') continue;
    symlinkSync(join(REPO, 'deploy', f), join(home, 'ccrc', 'deploy', f));
  }
  const real = JSON.stringify(join(REPO, 'deploy', 'account-op.mjs'));
  writeFileSync(join(home, 'ccrc', 'deploy', 'account-op.mjs'), [
    `if (process.argv[2] === ${JSON.stringify(missingOp)}) {`,
    '  process.stderr.write("usage: node deploy/account-op.mjs <refuse|providers|roster'
      + '|candidates|check-add> [--<key> <value>]\\u2026\\n");',
    '  process.exitCode = 2;',
    '} else {',
    `  await import(${real});`,
    '}',
    '',
  ].join('\n'));
  return home;
}

// ── THE SEAM ON `add`'s THREE RE-EMIT PATHS (D-2051) ──────────────────────
// `_acct_add` captures the callee's stdout three times — `check-add`,
// `add-entry`, and, from Task 26, the `added` op that composes the whole answer
// — and, on a non-zero status, re-emits it. When that capture is EMPTY the two sites used to print a blank
// line and exit with the callee's code — `JSON.parse('')` for the server, at an
// exit class that says the request was illegal when it was not. Measured on the
// half-updated box below, before the fix, on both paths: exit 2, stdout one byte
// (a newline), a `usage:` line on stderr.
//
// THE CASES DIFFER IN THE ONE THING A SHARED HELPER MUST NOT FLATTEN. The
// triage and the `no-answer` wording are identical on all three; the clause that
// says what was written is not, because on the second path the 0600 credential
// file IS on disk and the retry that overwrites it is this verb's headline
// ordering property — and on the THIRD the whole verb has already succeeded. So
// the first case asserts the sentence ENDS "Nothing was written.", and the other
// two assert it does not.
describe('ccrc account add: an empty body is a refusal, never a blank line (D-2051)', () => {
  it('the check-add call answers at exit 1 with a body, and nothing was written', () => {
    const home = staleAtBox('ccrc-account-add-stale-check-', 'check-add');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const before = readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8');
    const r = run(home, addArgs(), `${CANARY}\n`);
    // THE CLASS IS THIS FILE'S, NOT THE CALLEE'S. `ccd/ccrc:24-33` makes 2 "not
    // legal on its face, decidable from argv alone"; `_acct_add_parse` had
    // already accepted this request, so 2 would name the operator for a fault
    // that is the box's.
    expect(r.code, 'the callee\'s exit 2 was propagated').toBe(1);
    const j = oneObject(r);
    expect(j['ok']).toBe(false);
    expect(j['error']).toBe('no-answer');
    expect(String(j['detail'])).toContain('answer to \'check-add\'');
    expect(String(j['detail'])).toContain('exited 2');
    expect(String(j['detail'])).toMatch(/half-updated box/);
    expect(String(j['detail'])).toMatch(/Nothing was written\.$/);
    // AND THAT LAST SENTENCE IS TRUE HERE: the credential is read AFTER
    // `check-add` returns, so this path really has touched nothing.
    expect(existsSync(join(home, '.cc-secrets')), 'a secret was written').toBe(false);
    expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).toBe(before);
  });

  it('the add-entry call answers at exit 1 with a body, and names the TWO files it DID write',
    () => {
      const home = staleAtBox('ccrc-account-add-stale-entry-', 'add-entry');
      seedBoxRoster(home, FIXTURE_ROSTER);
      const before = readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8');
      const r = run(home, addArgs(), `${CANARY}\n`);
      expect(r.code, r.stderr).toBe(1);
      const j = oneObject(r);
      expect(j['error']).toBe('no-answer');
      expect(String(j['detail'])).toContain('answer to \'add-entry\'');
      expect(String(j['detail'])).toContain('exited 2');

      // TWO, NOT ONE, SINCE D-2134 — and that is this case's whole load now. The
      // marker moved in FRONT of `add-entry`, so at this refusal there are two
      // files on disk that were not there before the run, and a clause naming
      // only the credential is the same silence D-2051 closed for the roster
      // entry. Both are inert by the same argument (no roster entry names this
      // id) and both are rewritten by the retry — which is exactly why the
      // operator has to be told they exist rather than left to find them.
      const secret = join(home, '.cc-secrets', 'lab-dev0-compatible.env');
      const marker = join(home, '.cc-sessions', 'lab-dev0-disabled');
      expect(String(j['detail']),
        'the shared sentence flattened this path\'s truth: two files ARE on disk')
        .not.toContain('Nothing was written');
      for (const claim of [secret, marker]) {
        expect(String(j['detail']), 'the operator is not told which file to expect')
          .toContain(claim);
        expect(existsSync(claim), `the sentence names ${claim}, which is not there`).toBe(true);
      }
      expect(String(j['detail'])).toContain('overwrites it');
      expect(String(j['detail'])).toContain('rewrites it');
      // A PATH, NEVER CONTENTS (CLAUDE.md): existence facts only.
      expect(String(j['detail'])).not.toContain(CANARY);
      expect(lstatSync(secret).mode & 0o777).toBe(0o600);
      expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).toBe(before);
    });

  it('the added call answers at exit 1 with a body, and says the lane is fully written', () => {
    // THE PATH `_acct_answer` COULD NOT SERVE. That helper hard-codes
    // "Nothing was written." as its no-answer clause, and this call sits after
    // every write the verb makes: the shipped `_acct_answer roster` on this line
    // told a completed run that nothing had been written, which is this
    // describe's own defect on the one path D-2051 did not reach.
    const home = staleAtBox('ccrc-account-add-stale-added-', 'added');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    const r = run(home, addArgs(), `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(1);
    const j = oneObject(r);
    expect(j['error']).toBe('no-answer');
    const detail = String(j['detail']);
    expect(detail).toContain("answer to 'added'");
    expect(detail).toContain('exited 2');
    expect(detail, 'the shared sentence flattened a run that wrote everything')
      .not.toContain('Nothing was written');
    // AND EVERY NOUN IN THAT SENTENCE IS ON DISK — the half no wording
    // assertion carries, and the half that makes the clause a measurement.
    for (const claim of [join(home, '.cc-secrets', 'lab-dev0-compatible.env'),
      join(home, '.cc-sessions', 'lab-dev0-disabled'), join(home, '.claude-lab-dev0')]) {
      expect(detail, 'the clause does not name it').toContain(claim);
      expect(existsSync(claim), `the clause names ${claim}, which is not there`).toBe(true);
    }
    expect(detail).not.toContain(CANARY);
    expect(JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8'))
      .accounts.map((x: { id: string }) => x.id)).toContain('lab-dev0');
  });
});

// ── THE ROSTER'S MODE IS THE OPERATOR'S (D-2052) ──────────────────────────
// `add-entry` writes a tmp and renames it over `~/.ccrc/accounts.json`, so the
// mode the tmp carries BECOMES the roster's mode. A hard-coded literal there
// discards whatever the operator chose, on the one file this CLI otherwise
// treats as theirs — the same premise the atomic write is argued from. Measured
// before the fix: 600 in, 644 out.
describe('ccrc account add: the roster keeps the mode it had (D-2052)', () => {
  it('a 0600 roster is still 0600 after the entry lands', () => {
    const home = box('ccrc-account-add-rostermode-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    const roster = join(home, '.ccrc', 'accounts.json');
    chmodSync(roster, 0o600);
    const r = run(home, addArgs(), `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    expect(lstatSync(roster).mode & 0o777,
      'a write that only added an entry widened the operator\'s roster').toBe(0o600);
    // AND THE ENTRY LANDED. Without this half, an `add` that refused outright
    // would pass the assertion above for the wrong reason.
    const ids = (JSON.parse(readFileSync(roster, 'utf8')) as { accounts: { id: string }[] })
      .accounts.map((a) => a.id);
    expect(ids, 'the mode survived because nothing was written').toContain('lab-dev0');
  });
});

// ── THE SCAN THAT MAKES A CONVENTION A MECHANISM (D-2006) ─────────────────
// `_acct_refuse`'s third argument reaches `deploy/account-op.mjs` as the VALUE
// of `--detail`, and `readPairs`' M6 guard (:302-308) refuses a value that
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
// (ccd/ccrc:3810-3812) names the second shape exactly — "a future site spelled
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

// ── THE SCAN THAT KEEPS D-2022 CLOSED ─────────────────────────────────────
// `deploy/account-op.mjs` used to declare `const ALIASES = ['opus','sonnet',
// 'haiku','subagent']` — character for character `MODEL_ALIASES`, in the one
// file that already imports that module. Review round 1 deleted it and derived
// from the import instead, and THAT ALONE IS A CONVENTION: a future author who
// re-types the list gets identical behaviour and a green suite, which is
// exactly how the first copy survived. `single-definition.test.ts` cannot see
// it — that file scans for provider ROWS and named holders, not for an
// arbitrary list re-typed — so the mechanism lives here, beside the verb whose
// pre-pass decides with these constants.
//
// IT SCANS CODE, NOT PROSE. Comment lines are stripped first, for the same
// reason the `_acct_converge` case above strips them: the paragraph that
// records what the copy LOOKED like has to be allowed to spell it. The cost is
// stated rather than hidden — a copy re-typed on a trailing comment on a code
// line would not be seen; a copy that anything DECIDES with would be.
describe('deploy/account-op.mjs: the validator\'s constants are imported, never re-typed (D-2022)', () => {
  const OP_SRC = join(REPO, 'deploy', 'account-op.mjs');

  it('derives the aliases, the model-id regex and the api-key providers from the mirror', () => {
    const src = readFileSync(OP_SRC, 'utf8');
    const imp = /import \{([^}]*)\} from '\.\.\/shared\/roster-json\.mjs';/.exec(src);
    expect(imp, 'account-op.mjs no longer imports from shared/roster-json.mjs at all — if the '
      + 'module moved, point this scan at its new home; do not delete the scan').toBeTruthy();
    const named = imp![1]!.split(',').map((x) => x.trim()).filter((x) => x !== '');
    // BOTH DIRECTIONS. Named on the import AND read by the code, because an
    // import nothing uses is what the next tidy-up deletes — and deleting it is
    // the first half of re-typing the list.
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const n of ['API_KEY_PROVIDERS', 'HUES', 'LABEL_UNSAFE_RE', 'MODEL_ALIASES', 'MODEL_ID_RE']) {
      expect(named, `${n} is not imported from the validator`).toContain(n);
      expect(code.split(n).length - 1,
        `${n} is imported and never read — an unread import is one deletion away from a copy`)
        .toBeGreaterThan(1);
    }
  });

  it('carries no second spelling of any of them', () => {
    const src = readFileSync(OP_SRC, 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    // THE ALIAS LIST, as the array or Set literal it was. Scoped to a bracketed
    // literal on purpose: the `models-invalid` sentence shows the operator
    // `{"opus":"<id>","sonnet":"<id>",…}` as an EXAMPLE of what to type, which
    // is prose in a string and not a list this file decides with.
    expect(code, 'the four routing aliases are re-listed in a literal — import MODEL_ALIASES')
      .not.toMatch(/\[[^\]]*['"]opus['"][^\]]*['"]subagent['"][^\]]*\]/);
    // THE REGEX, by its own source text, which is how `gen-accounts.test.ts`
    // compares this pair across the .ts/.mjs wall: a behavioural comparison
    // passed the incident `source-bytes.test.ts` is named after.
    expect(code, 'MODEL_ID_RE is re-spelled here — import it')
      .not.toContain('A-Za-z0-9._:');
    // AND THE OTHER TWO THIS FILE DECIDES WITH. `HUES` by a member no other
    // list in this file has; `LABEL_UNSAFE_RE` by its character class. Neither
    // collides with `PROVIDER_GENERATABLE`, which is a DIFFERENT set that
    // legitimately names two of the same providers.
    expect(code, 'HUES is re-spelled here — import it').not.toContain('cyan');
    expect(code, 'LABEL_UNSAFE_RE is re-spelled here — import it')
      .not.toContain('\\u0000-\\u001f');
  });
});

const installerCalls = (home: string): string[] => {
  const p = join(home, 'installer-calls');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
const settingsAt = (home: string, suffix: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(home, suffix, 'settings.json'), 'utf8')) as Record<string, unknown>;

/** The "what still stands" clause `_acct_settings_env` takes as $3 (D-2126).
 *  These rows call the function DIRECTLY, so they are its caller and supply it —
 *  a marked string rather than a plausible sentence, so an assertion can tell
 *  the caller's clause apart from anything the function said on its own. The
 *  real one `_acct_provision` passes is measured end to end further down. */
const STANDS = 'STANDS-MARKER-4a91c2 the caller says this much.';

describe('ccrc account add: the new home, provisioned', () => {
  it('creates the config dir, writes the managed env block, and runs the four installers', () => {
    const home = box('ccrc-account-prov-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    const r = run(home, addArgs({
      '--models': JSON.stringify({
        opus: 'orchard/opus-1', sonnet: 'orchard/sonnet-1',
        haiku: 'orchard/haiku-1', subagent: 'orchard/haiku-1',
      }),
    }), `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);

    expect(settingsAt(home, '.claude-lab-dev0')).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'https://orchard-api/v1',
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'orchard/opus-1',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'orchard/sonnet-1',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'orchard/haiku-1',
        CLAUDE_CODE_SUBAGENT_MODEL: 'orchard/haiku-1',
      },
    });
    // THE KEY IS NOT HERE. It is in the 0600 file the wrapper sources; this
    // file sits beside the transcripts where doctor reads it (§4.3).
    expect(readFileSync(join(home, '.claude-lab-dev0', 'settings.json'), 'utf8'))
      .not.toContain(CANARY);

    // FOUR CALLS, EACH SCOPED TO THE ONE NEW HOME, coordinator before worker.
    // This is also the step list Task 26 turns into an answer key: at THIS
    // commit `ACCT_PROVISIONED` is written and not yet read, and the recorder
    // is what measures it.
    expect(installerCalls(home)).toEqual([
      `install-session-hooks.sh --homes ${join(home, '.claude-lab-dev0')}`,
      `install-coordinator-skill.sh --homes ${join(home, '.claude-lab-dev0')}`,
      `install-worker-skill.sh --homes ${join(home, '.claude-lab-dev0')}`,
      `install-graphify-skill.sh --homes ${join(home, '.claude-lab-dev0')}`,
    ]);
  });

  it('an anthropic login lane gets a config dir and NO env block at all', () => {
    // No endpoint and no models means no managed key has a value, and the merge
    // yields `{}` (measured against real jq). A settings.json a home never had,
    // created to hold `{}`, would be a file that decides nothing — the empty
    // distinction `_exp_env_write` refuses one level down (ccd/ccrc:3501-3505),
    // and install-session-hooks.sh:112-114's rule from the other side.
    const home = box('ccrc-account-prov-login-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    const r = run(home, ['account', 'add', '--id', 'lab-dev0', '--provider', 'anthropic',
      '--label', 'lab·dev0', '--hue', 'amber']);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.claude-lab-dev0'))).toBe(true);
    expect(existsSync(join(home, '.claude-lab-dev0', 'settings.json'))).toBe(false);
    // The step still RAN — it decided to write nothing, which is a different
    // thing from being skipped, and the installers still got their home.
    expect(installerCalls(home).length).toBe(4);
  });

  it('an operator\'s own settings.json survives byte-identically outside the managed keys', () => {
    const home = box('ccrc-account-prov-keep-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    mkdirSync(join(home, '.claude-lab-dev0'), { recursive: true });
    writeFileSync(join(home, '.claude-lab-dev0', 'settings.json'), JSON.stringify({
      statusLine: { type: 'command', command: 'bash "$HOME/mine.sh"' },
      env: { MY_OWN_KEY: 'kept', ANTHROPIC_BASE_URL: 'https://stale-endpoint/v1' },
      permissions: { allow: ['Bash(ls:*)'] },
    }, null, 2));
    const r = run(home, addArgs(), `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    const s = settingsAt(home, '.claude-lab-dev0');
    expect(s['statusLine']).toEqual({ type: 'command', command: 'bash "$HOME/mine.sh"' });
    expect(s['permissions']).toEqual({ allow: ['Bash(ls:*)'] });
    // The unmanaged env key survives; the managed one is REPLACED, not merged
    // onto — a stale endpoint that survived would be a lane whose settings and
    // roster disagree, which is doctor's `settings-env-drift` by construction.
    expect(s['env']).toEqual({
      MY_OWN_KEY: 'kept',
      ANTHROPIC_BASE_URL: 'https://orchard-api/v1',
      ANTHROPIC_API_KEY: '',
    });
    // BACKED UP BEFORE THE REWRITE (install-session-hooks.sh:129), under
    // BOX_BACKUP_ROOT (ccd/ccrc:1042) and named for the config dir, which is
    // that installer's own naming (`$(basename "$dir").settings.json`).
    const backups = readdirSync(join(home, 'ccrc-backups'));
    expect(backups.length).toBe(1);
    // AND UNDER THE NAME THE PRUNER CAN RECLAIM — `BOX_BACKUP_ROOT`'s own note
    // (ccd/ccrc:1034-1042) makes the timestamp shape part of the contract, and
    // `prune_backups`' glob is `[0-9]{8}-[0-9]{6}`. A backup outside that shape
    // is one nothing ever collects.
    expect(backups[0]).toMatch(/^\d{8}-\d{6}$/);
    expect(JSON.parse(readFileSync(
      join(home, 'ccrc-backups', backups[0]!, '.claude-lab-dev0.settings.json'), 'utf8'))['env'])
      .toEqual({ MY_OWN_KEY: 'kept', ANTHROPIC_BASE_URL: 'https://stale-endpoint/v1' });
  });

  it('a converged home is not rewritten — idempotence is byte-level', () => {
    const home = box('ccrc-account-prov-converge-');
    const dir = join(home, '.claude-lab-dev0');
    mkdirSync(dir, { recursive: true });
    // FOUR-SPACE INDENT, WHICH IS NOT WHAT `jq .` EMITS, and that is the whole
    // point of the fixture. The converge compares `jq -S .` of both sides, so
    // this file IS converged — same JSON, different bytes — and the guard must
    // therefore leave it alone. With jq's own two-space serialisation here the
    // assertion below could not fail at all: a rewrite would reproduce the file
    // byte for byte, and only the backup would show it. Measured: that is
    // exactly what the plan's own mutation 3 did, and this is the fixture that
    // makes "not re-serialised, not re-indented" a claim a test can lose.
    const already = '{\n    "env": {\n        "ANTHROPIC_BASE_URL": "https://orchard-api/v1",\n'
      + '        "ANTHROPIC_API_KEY": ""\n    }\n}\n';
    writeFileSync(join(dir, 'settings.json'), already);
    const r = sourceCall(home,
      `_acct_settings_env "${dir}" set "${STANDS}" "https://orchard-api/v1" '{}'`);
    expect(r.code, r.stderr).toBe(0);
    // The bytes are EXACTLY what they were — not re-serialised, not re-indented.
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe(already);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  it('clear removes exactly the managed keys, and deletes an env block it emptied', () => {
    // Task 32's half, landed and pinned HERE so `remove` and `add` can never
    // hold two definitions of "which env keys are ccrc's" —
    // `install-session-hooks.sh`'s JQ_UNMANAGED argument (:83-86), applied.
    const home = box('ccrc-account-prov-clear-');
    const dir = join(home, '.claude-lab-dev0');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      env: { MY_OWN_KEY: 'kept', ANTHROPIC_BASE_URL: 'https://orchard-api/v1',
        ANTHROPIC_API_KEY: '', CLAUDE_CODE_SUBAGENT_MODEL: 'orchard/haiku-1' },
    }));
    expect(sourceCall(home, `_acct_settings_env "${dir}" clear "${STANDS}"`).code).toBe(0);
    expect(settingsAt(home, '.claude-lab-dev0')).toEqual({ env: { MY_OWN_KEY: 'kept' } });

    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      env: { ANTHROPIC_BASE_URL: 'https://orchard-api/v1' }, model: 'sonnet',
    }));
    expect(sourceCall(home, `_acct_settings_env "${dir}" clear "${STANDS}"`).code).toBe(0);
    expect(settingsAt(home, '.claude-lab-dev0')).toEqual({ model: 'sonnet' });
  });

  it('refuses a settings.json that is not valid JSON, and changes nothing', () => {
    const home = box('ccrc-account-prov-badjson-');
    const dir = join(home, '.claude-lab-dev0');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'), '{ this is not json');
    const r = sourceCall(home,
      `_acct_settings_env "${dir}" set "${STANDS}" "https://orchard-api/v1" '{}'`);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('settings-invalid');
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe('{ this is not json');
  });

  it('the REAL session-hooks installer converges the same file, in the same run', () => {
    // The one case that runs the shipped script rather than a recorder: the two
    // merges touch ONE file, and a jq program that dropped the other's keys
    // would only show up here.
    const home = box('ccrc-account-prov-real-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    symlinkSync(join(REPO, 'ccd', 'install-session-hooks.sh'),
      join(home, '.cc-sessions', 'install-session-hooks.sh'));
    for (const n of ['install-coordinator-skill.sh', 'install-worker-skill.sh',
      'install-graphify-skill.sh']) {
      writeFileSync(join(home, '.cc-sessions', n), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
    const r = run(home, addArgs(), `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    const s = settingsAt(home, '.claude-lab-dev0');
    expect((s['env'] as Record<string, string>)['ANTHROPIC_BASE_URL'])
      .toBe('https://orchard-api/v1');
    expect(JSON.stringify(s['hooks'])).toContain('/session-hook.sh');
    expect(JSON.stringify(s['statusLine'])).toContain('/statusline-command.sh');
  });
});

// ── REVIEW ROUND 1: the two clauses the copied installer does not have ────
// Task 25's warrant is `install-session-hooks.sh:104-132` "clause for clause",
// and a clause-for-clause copy inherits that installer's own gaps. Two were
// measured here, and both are about the same fact: a lane's `settings.json` is
// the OPERATOR's file, not a ccrc-OWNED or REGENERATE-class one.
describe('ccrc account: _acct_settings_env keeps what it did not come to change', () => {
  const modeOf = (p: string): string => (lstatSync(p).mode & 0o777).toString(8);

  it('the operator\'s file keeps its own mode across the swap', () => {
    // D-1244's ruling (ccd/ccrc:7004-7010, "forcing 644 would widen a CLAUDE.md
    // an operator had restricted") and D-2052's, one commit earlier, at the
    // roster. `mv -f` replaces the INODE, so without `_plat_mode` + `chmod` the
    // new file carries this process's umask and the operator's decision is
    // gone: measured at 664 from a 0600 file before the fix.
    //
    // TWO MODES, NOT ONE, and that is what makes this an assertion rather than
    // a coincidence: a fixture that only ever restricts cannot tell "preserved"
    // from "hardcoded 600", and one that only widens cannot tell it from the
    // umask. 0640 is neither this box's umask default nor a plausible constant.
    const home = box('ccrc-account-prov-mode-');
    const dir = join(home, '.claude-lab-dev0');
    mkdirSync(dir, { recursive: true });
    for (const m of [0o600, 0o640]) {
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ env: { MY_OWN_KEY: 'kept' } }));
      chmodSync(join(dir, 'settings.json'), m);
      const r = sourceCall(home,
        `_acct_settings_env "${dir}" set "${STANDS}" "https://orchard-api/v1" '{}'`);
      expect(r.code, r.stderr).toBe(0);
      // It really did rewrite — otherwise the mode survived by not being touched.
      expect(settingsAt(home, '.claude-lab-dev0')['env'])
        .toEqual({ MY_OWN_KEY: 'kept', ANTHROPIC_BASE_URL: 'https://orchard-api/v1',
          ANTHROPIC_API_KEY: '' });
      expect(modeOf(join(dir, 'settings.json')), `mode lost for 0${m.toString(8)}`)
        .toBe(m.toString(8));
    }
  });

  it('a settings.json this merge cannot use is settings-INVALID, not settings-merge', () => {
    // D-2123 face 2 says the pre-validation buys the distinction "your file is
    // bad, here it is" (`settings-invalid`) versus "this is a bug in ccrc"
    // (`settings-merge`). Measured under `jq empty`, that distinction was false
    // in both directions:
    //
    //  - `{"env":["a"]}` PARSES, so it went to the merge, jq died on it, and the
    //    operator's own bad file came back wearing `settings-merge` — the class
    //    whose sentence reads "this is a bug in ccrc, not a fact about your box".
    //  - an EMPTY settings.json passed `jq empty` too; `next` was then empty as
    //    well, the byte-level converge check compared the two empties EQUAL, and
    //    the verb answered exit 0 having written no env block at all. A lane
    //    silently pointed at the wrong endpoint is the worst of the three.
    //
    // The probe is now the SHAPE the merge needs, so both are one refusal with
    // one remedy, and the file is untouched in every row.
    const home = box('ccrc-account-prov-shape-');
    const dir = join(home, '.claude-lab-dev0');
    mkdirSync(dir, { recursive: true });
    for (const body of ['{ this is not json', '', '{"env":["a"]}', '{"env":"x"}', '[1,2]', 'null']) {
      writeFileSync(join(dir, 'settings.json'), body);
      const r = sourceCall(home,
        `_acct_settings_env "${dir}" set "${STANDS}" "https://orchard-api/v1" '{}'`);
      expect(r.code, `body ${JSON.stringify(body)}: ${r.stderr}`).toBe(1);
      expect(oneObject(r)['error'], `body ${JSON.stringify(body)}`).toBe('settings-invalid');
      expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe(body);
    }
  });

  it('and settings-merge is still its own class, reachable and separate', () => {
    // The other half of the same guard, and the one nothing measured: with only
    // the row above, every `settings-merge` label in the function could be
    // rewritten to `settings-invalid` and the suite stayed 96/96 green
    // (measured). A distinction one test can only lose in ONE direction is half
    // a mechanism. This row reaches the merge arm — the caller handed it a
    // `--argjson` value that is not JSON, which is ccrc's bug and not the
    // operator's file — and pins that it answers by a different door.
    const home = box('ccrc-account-prov-mergeclass-');
    const dir = join(home, '.claude-lab-dev0');
    mkdirSync(dir, { recursive: true });
    const before = '{"env":{"MY_OWN_KEY":"kept"}}';
    writeFileSync(join(dir, 'settings.json'), before);
    const r = sourceCall(home,
      `_acct_settings_env "${dir}" set "${STANDS}" "https://orchard-api/v1" 'not-json'`);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('settings-merge');
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe(before);
  });
});

// ── D-2126: WHAT A MERGE REFUSAL SAYS ABOUT THE REST OF THE RUN ───────────
// `_acct_settings_env` runs LAST — after the secret, the roster entry,
// accounts.sh and the wrapper. Its refusals said only "that file is exactly as
// it was": true about that file, silent about all four, and read as "nothing
// was written" it sent the operator back into `ccrc account add`, which refuses
// `duplicate-id`. A dead end built out of a locally true sentence.
//
// DRIVEN THROUGH THE REAL VERB, not through `sourceCall`: a unit call on the
// function alone can never leave a roster entry standing, so it could not fail
// the way the operator did. The clause is the CALLER's ($3), so what the first
// two cases pin is `_acct_provision`'s own sentence; the third pins the shared
// function's half, that whatever a caller passes is what comes back.
describe('ccrc account add: a merge refusal names what still stands (D-2126)', () => {
  /** The one condition that refuses AFTER every other write has landed: a new
   *  home whose settings.json is a shape the merge cannot use. */
  const plantBadSettings = (home: string): void => {
    mkdirSync(join(home, '.claude-lab-dev0'), { recursive: true });
    writeFileSync(join(home, '.claude-lab-dev0', 'settings.json'), '{"env":["a"]}');
  };

  it('names the roster entry, the credential file and the converge that fixes it', () => {
    const home = box('ccrc-account-stands-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    plantBadSettings(home);
    const r = run(home, addArgs(), `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(1);
    const j = oneObject(r);
    expect(j['error']).toBe('settings-invalid');
    const detail = j['detail'] as string;

    // 1. THE SENTENCE, still locally true and now globally true as well.
    expect(detail).toContain('that file is exactly as it was');
    expect(detail).toContain('The roster entry was written and nothing rolls back');
    expect(detail).toContain("run 'ccrc install'");
    expect(detail).toContain("'ccrc account add' refuses this id as a duplicate now");
    // The credential half is MEASURED and not merely passed: `ACCT_SECRET_WRITTEN`
    // holds this path only because the `mv` that landed the file set it.
    expect(detail).toContain(join(home, '.cc-secrets', 'lab-dev0-compatible.env'));

    // 2. AND ALL FOUR REALLY DO STAND — the half no wording assertion carries.
    //    A sentence naming four things that were not there would be the same
    //    defect pointing the other way, and this is what tells them apart.
    const roster = JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8'));
    expect(roster.accounts.map((a: { id: string }) => a.id)).toContain('lab-dev0');
    expect(readFileSync(join(home, '.ccrc', 'accounts.sh'), 'utf8')).toContain('lab-dev0');
    expect(existsSync(join(home, '.local', 'bin', 'lab-dev0'))).toBe(true);
    expect(lstatSync(join(home, '.cc-secrets', 'lab-dev0-compatible.env')).mode & 0o777)
      .toBe(0o600);

    // 3. THE DEAD END ITSELF, RUN rather than described. `ccrc account add` is
    //    still a refusal — the fix is a signpost, not a new door — and that is
    //    precisely why the sentence has to name `ccrc install` instead.
    const again = run(home, addArgs(), `${CANARY}\n`);
    expect(again.code).toBe(1);
    expect(oneObject(again)['error']).toBe('duplicate-id');
  });

  it('a login lane, which writes no credential file, claims none', () => {
    // What makes the credential half a MEASUREMENT rather than a constant: this
    // arm's sentence differs from the one above by a fact about the run.
    const home = box('ccrc-account-stands-login-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    plantBadSettings(home);
    const r = run(home, ['account', 'add', '--id', 'lab-dev0', '--provider', 'anthropic',
      '--label', 'lab·dev0', '--hue', 'amber']);
    expect(r.code, r.stderr).toBe(1);
    const detail = oneObject(r)['detail'] as string;
    expect(detail).toContain('The roster entry was written and nothing rolls back');
    expect(detail).toContain("run 'ccrc install'");
    // NOT the path and NOT the words: measured at review round 2, an assertion
    // on the path alone stayed green when the `${ACCT_SECRET_WRITTEN:+…}` guard
    // was deleted, because an EMPTY variable takes the path out of the sentence
    // and leaves the claim — "and so was the 0600 credential file  that it
    // names" — standing about a lane that has none. The phrase is what the
    // login lane must not say.
    expect(detail).not.toContain('credential file');
    expect(detail).not.toContain('.cc-secrets');
    expect(existsSync(join(home, '.cc-secrets'))).toBe(false);
  });

  it('every refusal the function can reach ends in the clause its caller passed', () => {
    // The shared function's half: $3 arrives verbatim at the END of both refusal
    // classes, so a site that dropped `$stands` reds here instead of shipping one
    // sentence that is silent again. Two classes, two doors, one rule —
    // `settings-invalid` is the operator's file, `settings-merge` is ccrc's bug.
    const home = box('ccrc-account-stands-verbatim-');
    const dir = join(home, '.claude-lab-dev0');
    mkdirSync(dir, { recursive: true });
    const rows: [string, string, string][] = [
      ['{"env":["a"]}', "'{}'", 'settings-invalid'],
      ['{"env":{"MY_OWN_KEY":"kept"}}', "'not-json'", 'settings-merge'],
    ];
    for (const [body, models, err] of rows) {
      writeFileSync(join(dir, 'settings.json'), body);
      const r = sourceCall(home,
        `_acct_settings_env "${dir}" set "${STANDS}" "https://orchard-api/v1" ${models}`);
      expect(r.code, r.stderr).toBe(1);
      const j = oneObject(r);
      expect(j['error']).toBe(err);
      expect((j['detail'] as string).endsWith(STANDS),
        `${err} did not end in the caller's clause:\n    ${j['detail'] as string}`).toBe(true);
    }
  });
});

/** The clause `_acct_provision` hands down and, from Task 26 on, ends its own
 *  three refusals with (D-2128). Spelled here in FULL rather than probed by
 *  fragments: the property is that FOUR refusal sites in one function say the
 *  same bytes, and a `toContain` on a phrase would stay green while three of
 *  them said their own version of it. `lab-dev0-compatible.env` is the 0600
 *  file `ACCT_SECRET_WRITTEN` measured, so the clause is a measurement and not
 *  a constant — the login row below is the same function saying less. */
const provisionStands = (home: string): string =>
  'The roster entry was written and nothing rolls back, and so was the 0600 credential file '
  + `${join(home, '.cc-secrets', 'lab-dev0-compatible.env')} that it names, so 'ccrc account add' `
  + "refuses this id as a duplicate now: fix the cause and run 'ccrc install', which converges "
  + 'this home.';

describe('ccrc account add: the lane is off, and the verb says what it did not do', () => {
  it('writes the marker _lane_enabled reads, at the path ccd reads it from', () => {
    const home = box('ccrc-account-off-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    const r = run(home, addArgs(), `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.cc-sessions', 'lab-dev0-disabled'))).toBe(true);
    expect(oneObject(r)['disabled']).toBe(true);

    // BOTH SIDES OF THE NAME, pinned together. ccd is the reader and this verb
    // is the writer; a rename on either side is a lane that silently takes
    // placement the moment it is rostered, and nothing else in the tree
    // compares the two spellings.
    // `CCD`, NOT a second `join(REPO, …)` of that script's path. The plan's
    // snippet spelled the path here and `single-definition.test.ts` refuses it:
    // "is spelled in exactly one file, and that file is ccdWsHelpers.ts" went
    // red on this file. Measured, not remembered — and apt, given this case is
    // itself about two spellings of one name drifting apart.
    const ccd = readFileSync(CCD, 'utf8');
    expect(ccd).toContain('_lane_enabled() { [[ ! -f "$REG/$1-disabled" ]]; }');
    expect(ccd).toContain('_account_ok() { [[ -x "$WRAPPER_DIR/$1" ]] && _lane_enabled "$1"; }');
  });

  it('leaves homeAble TRUE — the switch is a file, not a roster edit', () => {
    // Two different questions: `homeAble` says what kind of account this is,
    // the marker says whether the operator has turned it on. Collapsing them
    // would make a measured, working lane permanently unplaceable, and would
    // make the UI's Enable control a roster write.
    const home = box('ccrc-account-off-homeable-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    run(home, addArgs(), `${CANARY}\n`);
    const roster = JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8'));
    expect(roster.accounts.find((x: { id: string }) => x.id === 'lab-dev0').homeAble).toBe(true);
    // AND THE MARKER IS STILL THERE. Without this line the case above is the
    // only thing standing between `homeAble: false` and the marker, and it
    // passes for a build that wrote neither — measured, mutation 4.
    expect(existsSync(join(home, '.cc-sessions', 'lab-dev0-disabled'))).toBe(true);
  });

  it('names the out-of-tree plumbing it did not do', () => {
    const home = box('ccrc-account-off-steps-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    const steps = oneObject(run(home, addArgs(), `${CANARY}\n`))['operator-steps'] as string[];
    expect(steps.length).toBe(2);
    expect(steps.join('\n')).toContain('claude-usage.timer');
    expect(steps.join('\n')).toContain('claude-prune-versions');
    // Each step names the LANE it is about, so a list rendered on a phone is
    // actionable without the reader remembering which add it belongs to. And
    // each is ONE element: a step split on a space would arrive as five.
    for (const s of steps) expect(s).toContain('lab-dev0');
    for (const s of steps) expect(s.length).toBeGreaterThan(40);
  });

  it('the answer is one object carrying everything a caller needs to draw the done step', () => {
    const home = box('ccrc-account-off-answer-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    const j = oneObject(run(home, addArgs(), `${CANARY}\n`));
    expect(Object.keys(j).sort()).toEqual(
      ['disabled', 'id', 'ok', 'operator-steps', 'provisioned', 'roster'].sort());
    expect(j['id']).toBe('lab-dev0');
    expect((j['roster'] as { accounts: unknown[] }).accounts.length).toBe(4);
    // Task 25's step list, now an answer key — the four installers plus the env
    // merge, in the order `_acct_provision` ran them. `settings-env` is the
    // WROTE token: this lane has an endpoint, so the merge produced a file.
    expect(j['provisioned']).toEqual([
      'settings-env', 'session-hooks', 'coordinator-skill', 'worker-skill', 'graphify-skill',
    ]);
  });

  it('the marker is written before the home is provisioned — a failure there leaves the lane off', () => {
    // The ordering that matters for this one: a lane that got rostered and then
    // failed to provision must still be unpickable. Injected by leaving the
    // installers out so `_acct_provision` refuses.
    const home = box('ccrc-account-off-provfail-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    const r = run(home, addArgs(), `${CANARY}\n`);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('provision-failed');
    expect(existsSync(join(home, '.cc-sessions', 'lab-dev0-disabled')),
      'a rostered lane that failed to provision is pickable').toBe(true);
  });

  it('the key says the env step RAN and wrote nothing, which is not the same as writing (D-2127)', () => {
    // A login lane has no endpoint and no model map, so the merge correctly
    // writes no file. Reporting `settings-env` there would publish "the env
    // block was written" about a home that has no settings.json — and moving
    // the append inside the wrote-something branch would hide a step that ran
    // and correctly did nothing, which is a real outcome an operator reads.
    // So the KEY carries both words and the array length never changes.
    const home = box('ccrc-account-off-ran-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    const r = run(home, ['account', 'add', '--id', 'lab-dev0', '--provider', 'anthropic',
      '--label', 'lab·dev0', '--hue', 'amber']);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.claude-lab-dev0', 'settings.json'))).toBe(false);
    expect(oneObject(r)['provisioned']).toEqual([
      'settings-env-none', 'session-hooks', 'coordinator-skill', 'worker-skill', 'graphify-skill',
    ]);
  });

  it('two runs in one shell do not double the key (D-2127)', () => {
    // Latent at this commit — `add` runs once per process — and API from this
    // commit on, which is why it is closed before the array is published. Both
    // accumulating arrays reset at their function's entry, so a caller that
    // loops gets one run's answer rather than every run's concatenated.
    const home = box('ccrc-account-off-reset-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    const r = sourceCall(home,
      '_acct_provision "$HOME/.claude-lab-dev0" "" "{}" >/dev/null\n'
      + '_acct_provision "$HOME/.claude-lab-dev0" "" "{}" >/dev/null\n'
      + '_acct_operator_steps lab-dev0\n_acct_operator_steps lab-dev0\n'
      + 'printf \'%s %s\\n\' "${#ACCT_PROVISIONED[@]}" "${#ACCT_OPERATOR_STEPS[@]}"');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('5 2');
  });

  it('all four of the provisioning refusals end in the one clause the caller built (D-2128)', () => {
    // One run, one account of what stands. Three of these are
    // `_acct_provision`'s own and the fourth is the one it hands to
    // `_acct_settings_env` — same function, same state on disk, and before
    // this commit two different stories about it: the first three said only
    // "the roster entry was written", which reads as "no credential was", and
    // that is the inference an operator makes when the sentence beside it
    // names one. The clause is the CALLER's (D-2126's ruling), and this
    // function is the caller for all four sites.
    const rows: [string, string, (h: string) => void][] = [
      ['no installer to run', 'provision-failed', () => { /* plantInstallers omitted */ }],
      ['an installer that refuses', 'provision-failed', (h) => {
        plantInstallers(h);
        writeFileSync(join(h, '.cc-sessions', 'install-session-hooks.sh'),
          '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      }],
      ['a config dir that cannot be created', 'provision-failed', (h) => {
        plantInstallers(h);
        writeFileSync(join(h, '.claude-lab-dev0'), 'not a directory\n');
      }],
      ['a settings.json the merge cannot take', 'settings-invalid', (h) => {
        plantInstallers(h);
        mkdirSync(join(h, '.claude-lab-dev0'), { recursive: true });
        writeFileSync(join(h, '.claude-lab-dev0', 'settings.json'), '{"env":["a"]}');
      }],
    ];
    for (const [what, err, plant] of rows) {
      const home = box('ccrc-account-off-stands-');
      seedBoxRoster(home, FIXTURE_ROSTER);
      plantUpstream(home);
      plant(home);
      const r = run(home, addArgs(), `${CANARY}\n`);
      expect(r.code, `${what}: ${r.stderr}`).toBe(1);
      const j = oneObject(r);
      expect(j['error'], what).toBe(err);
      expect((j['detail'] as string).endsWith(provisionStands(home)),
        `${what} did not end in the caller's clause:\n    ${j['detail'] as string}`).toBe(true);
    }
  });

  it('a converge that refuses AFTER the roster entry still leaves the lane off', () => {
    // WHERE THE MARKER GOES, MEASURED. `_account_ok` is `[[ -x
    // "$WRAPPER_DIR/$1" ]] && _lane_enabled "$1"` — both halves — so the moment
    // a lane becomes pickable is the moment `cmd_wrappers` writes its wrapper,
    // inside `_acct_converge`. A marker written after that converge (which is
    // where the plan's snippet put it) leaves a window, and a converge that
    // refuses leaves that window open for good — and the remedy those refusals
    // print ("re-run `ccrc wrappers`") is what then WRITES the wrapper, so an
    // unmarked lane becomes pickable by following the instructions. Injected
    // with an unreadable id-shaped file, which makes `cmd_wrappers` refuse every
    // generated write because it cannot tell what execs what.
    const home = box('ccrc-account-off-converge-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantUpstream(home);
    plantInstallers(home);
    chmodSync(plantLauncher(home, 'zz-blind', '#!/bin/sh\nexit 0\n'), 0o000);
    const r = run(home, addArgs(), `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(1);
    expect(oneObject(r)['error']).toBe('wrapper-converge');
    expect(existsSync(join(home, '.cc-sessions', 'lab-dev0-disabled')),
      'the converge refused and left a rostered lane with no marker').toBe(true);
    // AND THE WINDOW IS REAL: no wrapper was written, so the lane is not
    // pickable yet — it becomes pickable when the operator follows the remedy.
    expect(existsSync(join(home, '.local', 'bin', 'lab-dev0'))).toBe(false);
  });

  it('the `added` op refuses a --disabled that is not a boolean, rather than reading it as off', () => {
    // The wire field is a BOOLEAN because `"false"` is truthy in every language
    // that will read this — and a total conversion is the whole of that
    // argument: `a['disabled'] === 'true'` alone maps a typo to `false`, which
    // publishes "this lane is ON" about a lane that is off. One caller, and it
    // always passes one of the two words, so the shape is refusable.
    const call = (v: string | null): Result => {
      const args = ['added', '--file', join(REPO, 'deploy', 'accounts.default.json'),
        '--id', 'lab-dev0'];
      if (v !== null) args.push('--disabled', v);
      const p = spawnSync('node', [join(REPO, 'deploy', 'account-op.mjs'), ...args],
        { encoding: 'utf8' });
      return { code: p.status ?? -1, stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
    };
    for (const bad of ['tru', 'True', '1', '']) {
      const r = call(bad);
      expect(r.code, `--disabled ${JSON.stringify(bad)} was accepted`).toBe(2);
      expect(oneObject(r)['error']).toBe('bad-argv');
    }
    expect(oneObject(call(null))['error']).toBe('bad-argv');
    expect(oneObject(call('false'))['disabled']).toBe(false);
    expect(oneObject(call('true'))['disabled']).toBe(true);
  });

  it('a marker it could not write is a refusal, never an ok:true about a switch it did not throw',
    () => {
      // THE ONE SEAM IN THIS TASK NOTHING MEASURED (review round 1). Every other
      // case here runs on a box where the marker write SUCCEEDS, so all of them
      // stay green when `_acct_disable_new`'s two `||` arms are deleted — and
      // deleted, the verb answers `{"ok":true,"disabled":true,…}` for a lane with
      // no file on disk. Measured on row 2 before this case existed: exit 0,
      // `disabled:true`, `existsSync(marker) === false`. A verb that publishes a
      // kill-switch it did not write is worse than one that never claimed to, and
      // this is the mechanism rather than the paragraph.
      //
      // THREE ROWS, BECAUSE THE TWO ARMS FAIL ON DIFFERENT ERRORS. `mkdir -p` is a
      // no-op on an existing directory, so an UNWRITABLE `$REG` reaches the
      // second arm, not the first — a table with only "the directory is a file"
      // in it would leave the `: >` arm unmeasured, which is the arm that runs on
      // every successful add.
      const rows: [string, string, (h: string) => void, (h: string) => void][] = [
        ['$REG is a regular file', 'cannot create', (h) => {
          rmSync(join(h, '.cc-sessions'), { recursive: true });
          writeFileSync(join(h, '.cc-sessions'), 'not a directory\n');
        }, () => { /* nothing to undo */ }],
        ['$REG is unwritable', 'cannot write',
          (h) => chmodSync(join(h, '.cc-sessions'), 0o500),
          // RESTORED BEFORE `afterAll`: `tmpHelpers`' `rmSync` cannot unlink a
          // child of a 0500 directory, so a case that leaves one there fails the
          // file's cleanup rather than its own assertion.
          (h) => chmodSync(join(h, '.cc-sessions'), 0o700)],
        ['the marker name is a directory', 'cannot write',
          (h) => mkdirSync(join(h, '.cc-sessions', 'lab-dev0-disabled')),
          () => { /* nothing to undo */ }],
      ];
      for (const [what, opening, breakIt, undo] of rows) {
        const home = box('ccrc-account-off-nomarker-');
        seedBoxRoster(home, FIXTURE_ROSTER);
        plantUpstream(home);
        plantInstallers(home);
        try {
          breakIt(home);
          const r = run(home, addArgs(), `${CANARY}\n`);
          expect(r.code, `${what}: ${r.stderr}`).toBe(1);
          const j = oneObject(r);
          expect(j['ok'], `${what}: answered ok about a lane it did not switch off`).toBe(false);
          expect(j['error'], what).toBe('disable-marker');
          expect(String(j['detail']), what).toContain(opening);
          // AND THE LANE IS NOT PICKABLE ANYWAY, which is the property the
          // refusal exists to preserve: `_account_ok` reads the WRAPPER too, and
          // this refusal lands before `_acct_converge` writes one. So the box a
          // failed marker write leaves behind is wrapperless and off — not
          // wrappered and unmeasured.
          expect(existsSync(join(home, '.local', 'bin', 'lab-dev0')),
            `${what}: a lane with no marker got a wrapper`).toBe(false);
          // AND THE ROSTER ENTRY IS NOT THERE, which is what changed under
          // D-2134 and the reason these two refusals could not keep saying "The
          // roster entry was written": the marker now goes in FRONT of
          // `add-entry`, so at this refusal nothing has been rostered. The old
          // sentence would have sent the operator to `ccrc install` to converge
          // a lane that does not exist; the clause below sends them back into
          // `add`, which is the act that now completes.
          expect(JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8'))
            .accounts.map((x: { id: string }) => x.id), what).not.toContain('lab-dev0');
          // THE CLAUSE IS THE CALLER'S AND IT ENDS THE SENTENCE (D-2135) — the
          // same `endsWith` property `_acct_settings_env`'s rows measure. What
          // `add` passes here is what IS on disk at that line: the 0600 file and
          // nothing else, which this row's fixture wrote because `addArgs()` is a
          // token lane.
          const secret = join(home, '.cc-secrets', 'lab-dev0-compatible.env');
          expect(String(j['detail']).endsWith(
            `The 0600 credential file ${secret} WAS written before this step and nothing `
            + 'rolls it back: no roster entry names it yet, so nothing on this box can run '
            + 'it, and re-running this same command overwrites it.'),
          `${what} did not end in the caller's clause:\n    ${String(j['detail'])}`).toBe(true);
          expect(existsSync(secret), `${what}: the clause names a file that is not there`)
            .toBe(true);
          // AND THE REMEDY IS ONE THE OPERATOR CAN TYPE TODAY (D-2135). Wave 1
          // ships no `ccrc account disable` — measured below — and this switch is
          // a file ccd itself documents as `touch/rm $REG/<w>-disabled`, so the
          // remedy is that `touch`, naming the exact path. A remedy that answers
          // `unknown-subcommand` teaches the operator the tool is broken.
          expect(String(j['detail']), what)
            .toContain(`touch ${join(home, '.cc-sessions', 'lab-dev0-disabled')}`);
          expect(String(j['detail']), `${what}: names a verb wave 1 does not ship`)
            .not.toContain('ccrc account disable');
        } finally {
          undo(home);
        }
      }
    });

  it('the marker is on disk BEFORE the roster entry — a refusing add-entry leaves an inert file',
    () => {
      // THE ORDER D-2134 RULED ON, MEASURED IN THE ONE DIRECTION THAT CAN SEE IT.
      // Every green `add` writes both files, so no successful case can tell the
      // two orders apart; only a run that refuses BETWEEN them can, and this is
      // that run. `add-entry` is made to refuse by taking write permission off
      // `~/.ccrc` — its tmp+rename lands in that directory — so the verb stops
      // with the marker written and the roster untouched. Under the order this
      // review replaced the marker did not exist here at all — put the call back
      // between `add-entry` and `_acct_converge` and this row reds on exactly the
      // assertion below, which is what makes it a measurement of the ORDER and
      // not just of the marker.
      //
      // WHY THE ORDER IS THE SAFE ONE, measured rather than asserted. `ccd` never
      // consults `_lane_enabled` for an id the roster does not have: every
      // `_account_ok` caller iterates `CCRC_HOME_ABLE` or `_pool_for`, and
      // `CCRC_HOME_ABLE` is emitted FROM the roster (`shared/generate.mjs:209`)
      // into `accounts.sh`. And the one place in the whole tree that ENUMERATES
      // `<name>-disabled` markers rather than testing one by name —
      // `server/src/limits.ts:120` — filters every id it finds through `inRoster`
      // (:183) before it can become an accounts row. So a marker for an
      // unrostered id is read by nothing.
      const home = box('ccrc-account-off-order-');
      seedBoxRoster(home, FIXTURE_ROSTER);
      plantUpstream(home);
      plantInstallers(home);
      const marker = join(home, '.cc-sessions', 'lab-dev0-disabled');
      try {
        chmodSync(join(home, '.ccrc'), 0o500);
        const r = run(home, addArgs(), `${CANARY}\n`);
        expect(r.code, r.stderr).toBe(1);
        expect(oneObject(r)['error']).toBe('roster-write');
        expect(existsSync(marker),
          'add-entry refused and the marker was not written — the old order').toBe(true);
        expect(JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8'))
          .accounts.map((x: { id: string }) => x.id),
        'the roster took the entry after all').not.toContain('lab-dev0');
      } finally {
        // RESTORED BEFORE `afterAll`, the reason the row above this one states:
        // `tmpHelpers`' `rmSync` cannot unlink a child of a 0500 directory.
        chmodSync(join(home, '.ccrc'), 0o700);
      }
      // AND THE RETRY REWRITES IT, so the leftover costs one inert file and not a
      // second state to reason about. `: >` truncates an existing file, which is
      // why re-running is the whole remedy — measured by doing it.
      writeFileSync(marker, 'stale bytes from the refused run\n');
      const r2 = run(home, addArgs(), `${CANARY}\n`);
      expect(r2.code, r2.stderr).toBe(0);
      expect(readFileSync(marker, 'utf8'), 'the retry did not rewrite the marker').toBe('');
      expect(oneObject(r2)['disabled']).toBe(true);
    });

  it('duplicate-id refuses before any write, so a failed add cannot switch an EXISTING lane off',
    () => {
      // THE ONE RISK MOVING THE MARKER EARLIER COULD HAVE CREATED, refused
      // structurally rather than by ordering luck: if `add` reached the marker
      // write for an id the roster already has, it would switch off a working
      // lane in order to say no. It cannot, because `check-add` is the FIRST
      // thing `_acct_add` calls, it is side-effect-free, and `duplicate-id` is
      // among its refusals — so the run exits before the credential read, before
      // the marker and before `add-entry`. `claude-a` is a live lane in the
      // fixture roster, and `.cc-sessions` exists (plantInstallers), so an absent
      // marker here is the verb declining to write one, not a missing directory.
      const home = box('ccrc-account-off-dup-');
      seedBoxRoster(home, FIXTURE_ROSTER);
      plantUpstream(home);
      plantInstallers(home);
      const r = run(home, addArgs({ '--id': 'claude-a' }), `${CANARY}\n`);
      // THE HAZARD FIRST, THE ERROR CODE SECOND, and the order is the point:
      // asserting the code first makes this row red on the WRONG sentence when
      // the guard goes (measured — with `duplicate-id` mutated out, `add-entry`
      // still refuses, as `roster-invalid`, but only AFTER the marker has landed
      // on a live lane). The property this row exists for is the file, so the
      // file is what it asks about first.
      expect(existsSync(join(home, '.cc-sessions', 'claude-a-disabled')),
        'a failed add switched an existing lane off').toBe(false);
      expect(existsSync(join(home, '.cc-secrets')), 'a credential was written').toBe(false);
      expect(r.code, r.stderr).toBe(1);
      expect(oneObject(r)['error']).toBe('duplicate-id');
    });

  it('_acct_disable_new takes the clause as $2, and reds without one even when the write works',
    () => {
      // D-2135, and D-2133's check applied to it: the mechanism is the ONE LINE
      // `local id="$1" stands="$2"`. Binding there rather than expanding `$2`
      // only inside the two refusal strings is what makes `set -u` reach a caller
      // that forgot the clause on the path where the marker write SUCCEEDS —
      // which is every path but the three where it does not. Soften that binding
      // to `${2:-}`, the shape `_acct_settings_env`'s header forbids in the same
      // words, and this is the ONLY row in the file that reds: measured, because
      // no other case calls this function with the wrong arity.
      const home = box('ccrc-account-off-clause-');
      seedBoxRoster(home, FIXTURE_ROSTER);
      const bad = sourceCall(home, '_acct_disable_new lab-dev0');
      expect(bad.code, 'a caller with no clause was served').not.toBe(0);
      expect(bad.stderr).toMatch(/\$2: unbound variable/);
      expect(existsSync(join(home, '.cc-sessions', 'lab-dev0-disabled')),
        'the marker was written for a caller that named no clause').toBe(false);

      // AND $2 ARRIVES VERBATIM AT THE END OF BOTH REFUSAL CLASSES — the same
      // property `_acct_settings_env`'s `endsWith` rows measure, at the second
      // address the ruling now has. Two rows because the two arms fail on
      // different errors: `mkdir -p` is a no-op on an existing directory, so an
      // unwritable `$REG` reaches the `: >` arm and never the first.
      const rows: [string, string, (h: string) => void][] = [
        ['$REG is a regular file', 'cannot create',
          (h) => writeFileSync(join(h, '.cc-sessions'), 'not a directory\n')],
        ['the marker name is a directory', 'cannot write',
          (h) => mkdirSync(join(h, '.cc-sessions', 'lab-dev0-disabled'), { recursive: true })],
      ];
      for (const [what, opening, breakIt] of rows) {
        const h = box('ccrc-account-off-clause-row-');
        seedBoxRoster(h, FIXTURE_ROSTER);
        breakIt(h);
        const r = sourceCall(h, `_acct_disable_new lab-dev0 "${STANDS}"`);
        expect(r.code, `${what}: ${r.stderr}`).toBe(1);
        const j = oneObject(r);
        expect(j['error'], what).toBe('disable-marker');
        expect(String(j['detail']), what).toContain(opening);
        expect(String(j['detail']).endsWith(STANDS),
          `${what} did not end in the caller's clause:\n    ${String(j['detail'])}`).toBe(true);
      }
    });

  it('a second provision in one shell does not inherit the first\'s settings measurement (D-2127)',
    () => {
      // THE THIRD RESET, AND THE ONLY ONE WHOSE STALENESS CHANGES A TOKEN rather
      // than an array's length. `ACCT_SETTINGS_WRITTEN=""` at `_acct_settings_env`'s
      // head is what the case above cannot see: both of ITS runs are the same kind
      // of home, so deleting that line leaves it green — measured — while a token
      // lane followed by a login lane reports `settings-env` for a home that has
      // no settings.json. That is D-2127 face 1 exactly, re-opened by deleting the
      // variable that closes it.
      const home = box('ccrc-account-off-carry-');
      seedBoxRoster(home, FIXTURE_ROSTER);
      plantUpstream(home);
      plantInstallers(home);
      const r = sourceCall(home,
        'mkdir -p "$HOME/.claude-tok" "$HOME/.claude-login"\n'
        + '_acct_provision "$HOME/.claude-tok" "https://orchard-api/v1" "{}" >/dev/null\n'
        + 'first="${ACCT_PROVISIONED[0]}"\n'
        + '_acct_provision "$HOME/.claude-login" "" "{}" >/dev/null\n'
        + 'printf \'%s %s\\n\' "$first" "${ACCT_PROVISIONED[0]}"');
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout.trim()).toBe('settings-env settings-env-none');
      expect(existsSync(join(home, '.claude-tok', 'settings.json'))).toBe(true);
      expect(existsSync(join(home, '.claude-login', 'settings.json'))).toBe(false);
    });

  it('says settings-env-none for a home whose block is ALREADY there — the token is a measurement',
    () => {
      // THE SECOND STATE THE `none` TOKEN COVERS, and the one its source comment
      // did not name until review round 1. A config directory may pre-date the
      // roster entry that names it — `check-add` measures `duplicate-id` and
      // `suffix-collision` against the ROSTER, not against the filesystem — so an
      // `add` into a home that already carries exactly this env block converges,
      // writes no bytes, and must not claim it wrote. Measured: this row answers
      // `settings-env-none` while the block IS on disk, which is why the token
      // reads "this verb wrote no bytes" and not "this home has no env block".
      //
      // It is also what keeps `ACCT_SETTINGS_WRITTEN` a MEASUREMENT: a build that
      // inferred the token from `[ -f "$f" ]` after the merge would answer
      // `settings-env` here and stay green on the login case above.
      const home = box('ccrc-account-off-converged-');
      seedBoxRoster(home, FIXTURE_ROSTER);
      plantUpstream(home);
      plantInstallers(home);
      const cfg = join(home, '.claude-lab-dev0');
      mkdirSync(cfg, { recursive: true });
      const already = `${JSON.stringify({
        env: { ANTHROPIC_BASE_URL: 'https://orchard-api/v1', ANTHROPIC_API_KEY: '' },
      }, null, 2)}\n`;
      writeFileSync(join(cfg, 'settings.json'), already);
      const r = run(home, addArgs(), `${CANARY}\n`);
      expect(r.code, r.stderr).toBe(0);
      expect(oneObject(r)['provisioned']).toEqual([
        'settings-env-none', 'session-hooks', 'coordinator-skill', 'worker-skill', 'graphify-skill',
      ]);
      // The bytes are untouched — the converge arm returns before the backup, so
      // this is also the idempotence claim `_acct_settings_env` makes for itself.
      expect(readFileSync(join(cfg, 'settings.json'), 'utf8')).toBe(already);
    });
});

/** An ACCOUNT LIST, seeded as a roster — the shape every case in Tasks 27-33
 *  writes, since they build their accounts inline rather than editing a shared
 *  constant.
 *
 *  It is one line over `seedBoxRoster(home, roster)` and not a second seeder:
 *  that function already writes `~/.ccrc/accounts.json` AND the projection
 *  `~/.ccrc/accounts.sh` through the SHIPPED generator rather than a
 *  re-spelling of it (`_acct_roster_ids` reads `CCRC_ACCOUNTS` out of that
 *  file, shared/generate.mjs, so a fixture that hand-wrote it would be testing
 *  the fixture). Two functions spawning `deploy/gen-accounts.mjs` in one suite
 *  would be two places to fix when the projection changes; this is a wrapper
 *  that supplies the envelope. */
const seedRosterJson = (home: string, accounts: unknown[]): void =>
  seedBoxRoster(home, { version: 1, accounts });

/** ONE DRIVER FOR THE TWO DECLARE OPS, which take the SAME keys by
 *  construction: `OPS`' two rows are identical and deliberately so — one argv
 *  is built by `_acct_declare` and passed to both, because "a key the judge
 *  cannot see is a key nobody judged". Two wrappers, one body, for the reason
 *  the file they drive extracted `rosterAdmits` (D-2154).
 *
 *  IT IS THE ONLY WAY TO REACH EITHER OP'S OWN REFUSALS: bash always passes
 *  `--file`, `--id`, `--label` and `--hue`, and refuses an empty value before
 *  node is spawned at all. The path is not dead — it is the hand-caller one
 *  both arms document. */
function declareOp(op: string, file: string, over: Record<string, string | null> = {}): Result {
  const merged: Record<string, string | null> = {
    '--file': file, '--id': 'lab-dev0', '--label': 'lab·dev0', '--hue': 'violet', ...over,
  };
  const args = [op];
  for (const [k, v] of Object.entries(merged)) {
    if (v === null) continue;
    args.push(k, v);
  }
  const p = spawnSync('node', [join(REPO, 'deploy', 'account-op.mjs'), ...args],
    { encoding: 'utf8' });
  return { code: p.status ?? -1, stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
}

/** THE PRE-PASS — `checkAdd`'s driver at the declare address. */
const checkDeclare = (file: string, over: Record<string, string | null> = {}): Result =>
  declareOp('check-declare', file, over);

/** THE WRITER, with no pre-pass in front of it — `addEntry`'s shape at this
 *  verb's address and its own documented one (`_acct_declare` runs
 *  `check-declare` first; a hand caller need not). It is the only way to reach
 *  this arm's own `rosterFromJson`, which its source calls the writer's last
 *  gate and which MEASURED at eb86b830 had nothing standing over it (D-2154). */
const declareEntry = (file: string, over: Record<string, string | null> = {}): Result =>
  declareOp('declare-entry', file, over);

/** THE TWO SHAPES A DECLARED REQUEST COMES IN, `CHECK_ADD_LANES` at this op's
 *  address — and the measurement that says where the rule bites (D-2151,
 *  D-2153). On `check-add` two of nine flags answer a DIFFERENT code per lane,
 *  because a login lane refuses `--base-url` and `--models` as flags that
 *  cannot mean anything there. This arm has no such branch: it reads
 *  `--provider` only through `providerKnownClass` and copies `--base-url`
 *  straight onto the entry. Measured at 1dc39a6f, all seven keys driven empty
 *  on both shapes: every answer identical. The pair is kept — and asserted
 *  equal below — because that sameness is a CLAIM, and D-2150's eventual
 *  `baseUrlRequired` export is exactly the change that would break it. */
const CHECK_DECLARE_LANES: [string, Record<string, string | null>][] = [
  ['undeclared', {}],
  ['declared', { '--provider': 'compatible', '--base-url': 'https://orchard-api/v1' }],
];

const UPSTREAM = {
  id: 'claude', label: 'team·max', hue: 'cyan', configDirSuffix: '.claude',
  homeAble: true, telemetry: 'anthropic', exec: { kind: 'upstream' },
};

/** The marker `_lane_enabled` reads (ccd/ccd:1024), at the path ccd reads it
 *  from — spelled once here because six cases below assert on its presence or
 *  its absence, and the two are the same claim in opposite directions. */
const offMarker = (home: string, id: string): string =>
  join(home, '.cc-sessions', `${id}-disabled`);

describe('ccrc account declare: somebody else\'s launcher, and what it refuses', () => {
  it('declares a launcher that is NOT a ccrc-shaped wrapper — compiled, no config-dir line', () => {
    // THE CASE THE DOCTOR'S OWN RULE WOULD REFUSE. `_wrap_is_script` reads two
    // bytes and wants `#!`; `_wrap_declares_config_dir` wants an `export
    // CLAUDE_CONFIG_DIR=` line. `ccrc-doctor-checks:2427-2432` records that
    // demanding both of an EXTERNAL account failed a box that was fine. This is
    // the regression pin for not copying those two predicates.
    const home = box('ccrc-account-declare-external-');
    seedRosterJson(home, [UPSTREAM]);
    plantLauncher(home, 'lab-dev0', '\x7fELF not really, but no shebang and no export\n');
    const r = run(home, ['account', 'declare', '--id', 'lab-dev0',
      '--provider', 'openai', '--label', 'lab·dev0', '--hue', 'violet']);
    expect(r.code, r.stderr).toBe(0);
    const j = oneObject(r);
    expect(j['ok']).toBe(true);
    expect(j['id']).toBe('lab-dev0');
    expect(j['kind']).toBe('external');
    expect(j['disabled']).toBe(true);
    // The roster came back whole, and it went to disk through the validator.
    const roster = j['roster'] as { accounts: { id: string; exec: unknown }[] };
    expect(roster.accounts.map((a) => a.id)).toEqual(['claude', 'lab-dev0']);
    const onDisk = JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8'));
    expect(onDisk.accounts[1].exec).toEqual({ kind: 'external', provider: 'openai' });
    // THE THREE FIELDS THE VERB DECIDES RATHER THAN TAKES, each measured, and
    // `telemetry` because review round 1 flipped it to `'anthropic'` and the
    // file stayed green: `telemetry: 'none'` is what keeps a declared lane out
    // of `CCRC_MEASURED`, so a flip puts an external launcher into the metered
    // pool `_limit_score` reads. `homeAble: false` is what keeps
    // `_ws_least_loaded` (ccd/ccd:3641) from ever enumerating it.
    expect(onDisk.accounts[1].homeAble).toBe(false);
    expect(onDisk.accounts[1].telemetry).toBe('none');
    // AND THE SUFFIX DEFAULT IS `.<id>`, NOT `add`'s `.claude-<id>` (D-2142).
    // Ungated on purpose: a declared launcher's config dir is somebody else's
    // and may hold no transcripts at all, so demanding it inside the agent's
    // `$HOME/.claude*` read root would refuse legitimate lanes.
    expect(onDisk.accounts[1].configDirSuffix).toBe('.lab-dev0');
    // …and accounts.sh was regenerated from it, or ccd would still not know the id.
    expect(readFileSync(join(home, '.ccrc', 'accounts.sh'), 'utf8')).toContain('lab-dev0');
    // THE LAUNCHER IS UNTOUCHED, which is the whole reason this verb is not
    // `adopt`: decision 22(c) rules an external launcher DECLARED, never
    // adopted, because the wrapper converge would rewrite it into the
    // four-line generated shape and that is data loss.
    expect(readFileSync(join(home, '.local', 'bin', 'lab-dev0'), 'utf8'))
      .toBe('\x7fELF not really, but no shebang and no export\n');
  });

  it('takes --suffix, which is how a declared lane becomes readable (D-2142)', () => {
    // THE FLAG THE SPEC'S ROW DOES NOT LIST, and the reason it is kept: the
    // agent's `underClaudeGlob` admits only `$HOME/.claude*`, so without this
    // flag an operator declaring an external launcher has no way to put that
    // lane's config dir where the server can read its transcripts — a lane ccrc
    // could roster and never show. Measured at review round 1: with the flag
    // ignored and the default hard-coded, the whole file stayed green, so the
    // ruling had no mechanism under it.
    const home = box('ccrc-account-declare-suffix-');
    seedRosterJson(home, [UPSTREAM]);
    plantLauncher(home, 'lab-dev0');
    const r = run(home, ['account', 'declare', '--id', 'lab-dev0', '--suffix', '.claude-lab-dev0',
      '--label', 'lab·dev0', '--hue', 'violet']);
    expect(r.code, r.stderr).toBe(0);
    const onDisk = JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8'));
    expect(onDisk.accounts[1].configDirSuffix).toBe('.claude-lab-dev0');
  });

  it('leaves the new lane switched OFF (decision 20)', () => {
    const home = box('ccrc-account-declare-off-');
    seedRosterJson(home, [UPSTREAM]);
    plantLauncher(home, 'lab-dev0');
    expect(run(home, ['account', 'declare', '--id', 'lab-dev0',
      '--label', 'lab·dev0', '--hue', 'violet']).code).toBe(0);
    expect(existsSync(offMarker(home, 'lab-dev0'))).toBe(true);
    const listed = oneObject(run(home, ['account', 'roster']))['roster'] as { accounts: unknown[] };
    expect(listed.accounts.length).toBe(2);
  });

  it('refuses an absent launcher, and writes NOTHING', () => {
    const home = box('ccrc-account-declare-absent-');
    seedRosterJson(home, [UPSTREAM]);
    const before = readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8');
    const r = run(home, ['account', 'declare', '--id', 'lab-dev0',
      '--label', 'lab·dev0', '--hue', 'violet']);
    expect(r.code).toBe(1);
    expect(oneObject(r)).toMatchObject({ ok: false, error: 'launcher-absent' });
    expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).toBe(before);
    expect(existsSync(offMarker(home, 'lab-dev0'))).toBe(false);
  });

  it('tells "not a regular file" and "not executable" apart', () => {
    const home = box('ccrc-account-declare-shapes-');
    seedRosterJson(home, [UPSTREAM]);
    mkdirSync(join(home, '.local', 'bin', 'lab-dev0'), { recursive: true });
    expect(oneObject(run(home, ['account', 'declare', '--id', 'lab-dev0',
      '--label', 'lab·dev0', '--hue', 'violet']))['error']).toBe('launcher-not-a-file');
    rmSync(join(home, '.local', 'bin', 'lab-dev0'), { recursive: true });
    plantLauncher(home, 'lab-dev0');
    chmodSync(join(home, '.local', 'bin', 'lab-dev0'), 0o644);
    expect(oneObject(run(home, ['account', 'declare', '--id', 'lab-dev0',
      '--label', 'lab·dev0', '--hue', 'violet']))['error']).toBe('launcher-not-executable');
  });

  it('a dangling symlink is its OWN code, because "put a launcher there" is the wrong remedy',
    () => {
      // D-2144's SECOND SHAPE. `[ -e ]` FOLLOWS the link, so before this commit
      // a link whose target was gone read as `launcher-absent` and the operator
      // was told "there is no <path> on this box … put the launcher there
      // first" — and `ln -s` then fails EEXIST, because something IS at that
      // path. The act they need is `ls -ld`, which only `launcher-not-a-file`
      // offered. Two conditions with different remedies behind one code is the
      // overloaded seam the four-code set was written to avoid.
      //
      // THE ROW BESIDE IT IS THE HEALTHY LINK, and it is here rather than
      // implied: `-L` alone would refuse the alias case above, which is a live
      // symlink and must still reach `launcher-alias`. The gate is `-L` AND NOT
      // `-e`, and a mutation that drops either half has to red on one of these
      // two lines.
      const home = box('ccrc-account-declare-dangling-');
      seedRosterJson(home, [UPSTREAM]);
      symlinkSync(join(home, '.local', 'bin', 'nothing-here'),
        join(home, '.local', 'bin', 'lab-dev0'));
      expect(lstatSync(join(home, '.local', 'bin', 'lab-dev0')).isSymbolicLink()).toBe(true);
      expect(existsSync(join(home, '.local', 'bin', 'lab-dev0')),
        'the fixture link is not dangling').toBe(false);
      const r = run(home, ['account', 'declare', '--id', 'lab-dev0',
        '--label', 'lab·dev0', '--hue', 'violet']);
      expect(r.code).toBe(1);
      const j = oneObject(r);
      expect(j['error']).toBe('launcher-dangling');
      // THE REMEDY IS THE POINT, so it is asserted rather than the code alone:
      // the sentence must send the operator to LOOK at the link, and must not
      // tell them to put a file at a path where `ln -s` would fail.
      expect(String(j['detail'])).toContain(`ls -ld ${join(home, '.local', 'bin', 'lab-dev0')}`);
      expect(String(j['detail']),
        'the dangling-link remedy still tells the operator to put a launcher there')
        .not.toContain('put the launcher there first');
      expect(existsSync(offMarker(home, 'lab-dev0'))).toBe(false);
      expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).not.toContain('lab-dev0');
    });

  it('an EMPTY 0755 file is refused, not declared — zero bytes is no launcher at all', () => {
    // D-2144's FIRST SHAPE, and it was an exit 0. Measured before this commit:
    // a zero-byte 0755 file at `~/.local/bin/<id>` passed all four codes, the
    // marker was written, the entry landed and `ccd` would have exec'd it.
    // Decision 22(c)'s "its shape is nobody's business" defends a COMPILED
    // launcher that spells its config dir in a way no `export` matches — the
    // case the row above this one pins — and it does not describe zero bytes,
    // which cannot be any launcher. `[ -s ]` reintroduces neither predicate the
    // doctor's rule excludes: it asks nothing about what the bytes say, only
    // whether there are any.
    const home = box('ccrc-account-declare-empty-');
    seedRosterJson(home, [UPSTREAM]);
    plantLauncher(home, 'lab-dev0', '');
    expect(lstatSync(join(home, '.local', 'bin', 'lab-dev0')).size).toBe(0);
    const r = run(home, ['account', 'declare', '--id', 'lab-dev0',
      '--label', 'lab·dev0', '--hue', 'violet']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('launcher-empty');
    expect(existsSync(offMarker(home, 'lab-dev0'))).toBe(false);
    expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).not.toContain('lab-dev0');
    // AND IT IS ANSWERED BEFORE THE MODE (`-s` above `-x`): a zero-byte file
    // that is ALSO not executable is both faults at once, and `chmod +x` is the
    // wrong next act — the file has no content to run either way. Without this
    // row the order of the two gates is unmeasured, and it is the order that
    // decides which remedy the operator reads.
    chmodSync(join(home, '.local', 'bin', 'lab-dev0'), 0o644);
    expect(oneObject(run(home, ['account', 'declare', '--id', 'lab-dev0',
      '--label', 'lab·dev0', '--hue', 'violet']))['error']).toBe('launcher-empty');
  });

  it('_acct_declarable sources its own contract, so a caller that skipped the gate gets JSON', () => {
    // REVIEW ROUND 1'S SECOND FINDING. This function reads `$WRAPPER_BIN_DIR`,
    // which `ccrc-wrapper-shape` declares, and it did NOT call `_acct_shape` —
    // unlike `_acct_id_or_refuse`, its sibling one screen up, which always has.
    // Under `set -uo pipefail` that is `unbound variable` on stderr and an EMPTY
    // stdout: the one thing this verb's contract forbids on every reachable
    // path. Unreachable through the shipped verb (`_acct_declare` sources the
    // contract first) and reachable by every future caller, which is what makes
    // it worth a row rather than a comment.
    const home = box('ccrc-account-declarable-selfsufficient-');
    seedRosterJson(home, [UPSTREAM]);
    const r = sourceCall(home, '_acct_declarable lab-dev0');
    expect(r.code, `no JSON and no refusal: ${r.stderr}`).toBe(1);
    expect(r.stderr).not.toMatch(/unbound variable/);
    expect(oneObject(r)['error']).toBe('launcher-absent');
    // AND WITH NO ARGUMENT AT ALL it refuses rather than crashing — `${1:-}`,
    // the same rule at the same address.
    const bare = sourceCall(home, '_acct_declarable');
    expect(bare.stderr).not.toMatch(/unbound variable/);
    expect(oneObject(bare)['ok']).toBe(false);
  });

  it('collapses an alias: one file under two names is one account', () => {
    // The measured case is `gpt -> ccgpt`, both in ~/.local/bin, ONE file
    // (`ccrc-doctor-checks:2403-2408`). Two accounts over one CLAUDE_CONFIG_DIR
    // is what the collapse exists to stop.
    const home = box('ccrc-account-declare-alias-');
    seedRosterJson(home, [UPSTREAM,
      { id: 'gpt', label: 'lab·dev0', hue: 'amber', configDirSuffix: '.claude-gpt',
        homeAble: false, telemetry: 'none', exec: { kind: 'external' } }]);
    plantLauncher(home, 'gpt');
    symlinkSync(join(home, '.local', 'bin', 'gpt'), join(home, '.local', 'bin', 'orchard-api'));
    const r = run(home, ['account', 'declare', '--id', 'orchard-api',
      '--label', 'team·shared', '--hue', 'blue']);
    expect(r.code).toBe(1);
    const j = oneObject(r);
    expect(j['error']).toBe('launcher-alias');
    expect(String(j['detail'])).toContain('gpt');
    expect(existsSync(offMarker(home, 'orchard-api'))).toBe(false);
  });

  it('collapses a HARD link too, which is the half `-ef` is chosen for', () => {
    // THE SECOND HALF OF THE SAME LINE, AND IT NEEDS ITS OWN ROW. Doctor states
    // the reason `-ef` and not `readlink` (`ccrc-doctor-checks:2403-2408`): it
    // compares device+inode, "and it catches a hard link, which `readlink` would
    // not." Measured at review round 1: with the symlink row alone, replacing
    // `-ef` by a `readlink -f` comparison leaves the whole file GREEN — so the
    // sentence in `_acct_declarable`'s header was a claim with nothing behind
    // it. A hard link is the shape an operator reaches for when `~/.local/bin`
    // and the real binary are on one filesystem, and it puts two accounts on one
    // CLAUDE_CONFIG_DIR exactly as a symlink does.
    const home = box('ccrc-account-declare-hardlink-');
    seedRosterJson(home, [UPSTREAM,
      { id: 'gpt', label: 'lab·dev0', hue: 'amber', configDirSuffix: '.claude-gpt',
        homeAble: false, telemetry: 'none', exec: { kind: 'external' } }]);
    plantLauncher(home, 'gpt');
    linkSync(join(home, '.local', 'bin', 'gpt'), join(home, '.local', 'bin', 'orchard-api'));
    // Not a symlink: the two names are one inode with no link to follow.
    expect(lstatSync(join(home, '.local', 'bin', 'orchard-api')).isSymbolicLink()).toBe(false);
    const r = run(home, ['account', 'declare', '--id', 'orchard-api',
      '--label', 'team·shared', '--hue', 'blue']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('launcher-alias');
    expect(existsSync(offMarker(home, 'orchard-api'))).toBe(false);
  });

  it('refuses a duplicate id before it looks at disk at all', () => {
    const home = box('ccrc-account-declare-dup-');
    seedRosterJson(home, [UPSTREAM]);
    // No launcher planted: if the id check ran second, this would answer
    // `launcher-absent` and the operator would go looking for the wrong thing.
    const r = run(home, ['account', 'declare', '--id', 'claude',
      '--label', 'team·max', '--hue', 'cyan']);
    // THE FILE FIRST, THE CODE SECOND (D-2137, D-2019). Under D-2134's order the
    // marker is written before the roster entry, so a `duplicate-id` that did
    // not fire would switch an EXISTING lane off — and asserting the code first
    // would red on the wrong sentence. Measured for this verb, and it is not
    // `add`'s answer: `_acct_declarable` refuses every rostered id a second time
    // (a launcher is always `-ef` itself, and an absent one is `launcher-absent`),
    // so with this guard mutated out the marker is still not reached and it is
    // the CODE that moves. The assertion order is kept anyway — it is free, and
    // the day `_acct_declarable` gains a self-skip the way `_acct_candidates`
    // has one, this line is the only thing standing over the kill switch.
    expect(existsSync(offMarker(home, 'claude')),
      'a duplicate id switched an existing lane off').toBe(false);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('duplicate-id');
  });

  it('refuses a bad id and the reserved one, at exit 2, through the ONE gate', () => {
    // The same two refusals Task 23 measured on `add`, now reached through
    // `_acct_id_or_refuse`. Their presence HERE is what makes the lift in
    // `_acct_add_parse` a shared gate rather than a third copy.
    const home = box('ccrc-account-declare-id-');
    seedRosterJson(home, [UPSTREAM]);
    for (const [id, code] of [['Lab_Dev0', 'bad-id'], ['auth', 'reserved-id']] as const) {
      const r = run(home, ['account', 'declare', '--id', id, '--label', 'lab·dev0', '--hue', 'violet']);
      expect(r.code, id).toBe(2);
      expect(oneObject(r)['error'], id).toBe(code);
    }
    // The third refusal the same gate carries, and the one this task's own
    // prose forgot: a `--id` nobody passed.
    const r = run(home, ['account', 'declare', '--label', 'lab·dev0', '--hue', 'violet']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('missing-value');
  });

  it('passes a refused base URL back with the ROSTER VALIDATOR’s own words', () => {
    const home = box('ccrc-account-declare-badurl-');
    seedRosterJson(home, [UPSTREAM]);
    plantLauncher(home, 'lab-dev0');
    const r = run(home, ['account', 'declare', '--id', 'lab-dev0', '--provider', 'compatible',
      '--base-url', 'http://orchard-api/v1', '--label', 'lab·dev0', '--hue', 'violet']);
    expect(r.code).toBe(1);
    const j = oneObject(r);
    expect(j['error']).toBe('roster-invalid');
    // ONE MESSAGE, TWO STREAMS, NOT RE-WORDED. `refuse()` prints
    // `<SELF>: <detail> (<code>)` on stderr and the same `detail` on stdout —
    // so asserting the two are the same bytes is the passthrough property
    // itself, not a proxy.
    expect(r.stderr).toBe(`account-op: ${String(j['detail'])} (roster-invalid)\n`);
    expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).not.toContain('lab-dev0');
    // AND NOW THE MARKER IS NOT THERE EITHER — THIS ASSERTION WAS INVERTED BY
    // D-2143, and the inversion is the whole point of that entry. Until review
    // round 2 this row measured D-2134's ordering by the file a refused write
    // left behind: the marker stood, inert, because `declare` wrote it before
    // the roster entry and only the roster write refused. What D-2143 ruled is
    // that a FIELD fault should never get that far — `check-declare` judges
    // this endpoint while nothing at all is on disk — so the row that once
    // proved the ordering now proves the pre-pass instead. The ordering keeps
    // its own two pins, on the two paths that still reach the marker: the
    // `roster-write` case below, and the `no-answer` case whose clause names
    // the marker.
    expect(existsSync(offMarker(home, 'lab-dev0')),
      'a field fault the pre-pass owns still left a file behind').toBe(false);
  });

  it('the marker is on disk BEFORE the roster entry — a refusing declare-entry leaves an inert file',
    () => {
      // D-2134's ORDERING, AT THE ONE PATH THAT STILL SEES IT (D-2143), and it
      // is `add`'s own case at this verb's address (`ccrc account add: the lane
      // is off …`, the `add-entry` row). Every green declare writes both files,
      // so no successful run can tell the two orders apart; only a run that
      // refuses BETWEEN them can. `check-declare` passes — the request is
      // perfectly legal — and `declare-entry` then cannot write, because
      // `~/.ccrc` is read-only. The marker is on disk and the entry is not,
      // which is what "marker first" means; swap the two calls and this reds.
      const home = box('ccrc-account-declare-order-');
      seedRosterJson(home, [UPSTREAM]);
      plantLauncher(home, 'lab-dev0');
      const dir = join(home, '.ccrc');
      chmodSync(dir, 0o500);
      try {
        const r = run(home, ['account', 'declare', '--id', 'lab-dev0',
          '--label', 'lab·dev0', '--hue', 'violet']);
        expect(r.code, r.stderr).toBe(1);
        expect(oneObject(r)['error']).toBe('roster-write');
        expect(existsSync(offMarker(home, 'lab-dev0')),
          'the marker was written AFTER the roster entry, not before it').toBe(true);
        expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8'))
          .not.toContain('lab-dev0');
      } finally {
        // RESTORED BEFORE `afterAll`, `add`'s marker-row rule: `tmpHelpers`'
        // `rmSync` cannot unlink a child of a 0500 directory.
        chmodSync(dir, 0o700);
      }
    });

  it('keeps the mode the roster had (D-2052, at this verb\'s own writer)', () => {
    // `declare-entry` writes a tmp and RENAMES it, which replaces the inode — so
    // a `0o644` literal on the create would silently widen a roster its operator
    // had restricted. The mode is taken off the file this run just read, exactly
    // as `add-entry` takes it, and this case is what keeps the two writers from
    // drifting apart: the plan for this task prescribed the literal.
    const home = box('ccrc-account-declare-rostermode-');
    seedRosterJson(home, [UPSTREAM]);
    plantLauncher(home, 'lab-dev0');
    const roster = join(home, '.ccrc', 'accounts.json');
    chmodSync(roster, 0o600);
    const r = run(home, ['account', 'declare', '--id', 'lab-dev0',
      '--label', 'lab·dev0', '--hue', 'violet']);
    expect(r.code, r.stderr).toBe(0);
    expect(lstatSync(roster).mode & 0o777,
      'a write that only added an entry widened the operator\'s roster').toBe(0o600);
    // AND THE ENTRY LANDED, or the mode survived for the wrong reason.
    expect(readFileSync(roster, 'utf8')).toContain('lab-dev0');
  });

  it('a write op that answers nothing is `no-answer`, and the clause names the marker that stands',
    () => {
      // THE EMPTY-BODY SEAM, ON THE PATH THIS TASK ADDS. A half-updated box —
      // a new `ccrc` beside an `account-op.mjs` with no `declare-entry` — exits
      // 2 with NOTHING on stdout, and propagating that hands the caller an exit
      // code and an empty body. `_acct_run_op` refuses it with the code that
      // already owns this condition (`no-answer`, at class 1) rather than a
      // second one of its own, and the CLAUSE is `_acct_declare`'s: by that line
      // the kill-switch marker is on disk, so a shared "Nothing was written."
      // would state the opposite of what happened (D-2138).
      // THE SKEW IS PLACED AT `declare-entry`, NOT AT THE FIRST OP (D-2143).
      // `check-declare` now runs BEFORE the marker, so a stub that refuses
      // every op reaches `no-answer` one step earlier, with nothing written —
      // which is the row below this one, and a different claim. Letting the
      // pre-pass through is what keeps THIS case about the seam it was written
      // for: the write op, with the marker already on disk.
      const home = skewedBox('ccrc-account-declare-skew-', 2, ['check-declare']);
      seedBoxRoster(home, FIXTURE_ROSTER);
      plantLauncher(home, 'lab-dev0');
      const r = run(home, ['account', 'declare', '--id', 'lab-dev0',
        '--label', 'lab·dev0', '--hue', 'violet']);
      expect(r.code).toBe(1);
      const j = oneObject(r);
      expect(j['error']).toBe('no-answer');
      expect(String(j['detail'])).toContain('exited 2');
      expect(String(j['detail'])).toContain(join(home, '.cc-sessions', 'lab-dev0-disabled'));
      expect(existsSync(offMarker(home, 'lab-dev0'))).toBe(true);
    });

  it('the pre-pass answers the same seam ONE STEP EARLIER, with nothing on disk (D-2143)',
    () => {
      // THE SAME HALF-UPDATED BOX, MEASURED AT THE OP THAT NOW GOES FIRST. A
      // `ccrc` that knows `check-declare` beside an `account-op.mjs` that does
      // not is exactly the skew `install_atomic` + rsync can leave, and the
      // property this row exists for is the CLAUSE: at this line the verb has
      // written nothing, so "Nothing was written." is the true sentence and the
      // marker path must not appear in it. Delete the `_acct_read_op` call and
      // this row goes green for the wrong reason — the run reaches
      // `declare-entry` instead — which is why the marker assertion is negative
      // and the clause assertion is exact.
      const home = skewedBox('ccrc-account-declare-skew-check-');
      seedBoxRoster(home, FIXTURE_ROSTER);
      plantLauncher(home, 'lab-dev0');
      const r = run(home, ['account', 'declare', '--id', 'lab-dev0',
        '--label', 'lab·dev0', '--hue', 'violet']);
      expect(r.code).toBe(1);
      const j = oneObject(r);
      expect(j['error']).toBe('no-answer');
      expect(String(j['detail'])).toContain("'check-declare'");
      expect(String(j['detail']).endsWith('Nothing was written.'),
        `the pre-pass seam did not end in its own clause:\n    ${String(j['detail'])}`).toBe(true);
      expect(String(j['detail'])).not.toContain('lab-dev0-disabled');
      expect(existsSync(offMarker(home, 'lab-dev0'))).toBe(false);
    });

  /** A box whose `account-op.mjs` is a STUB with a working `refuse` arm and
   *  `body` for every other op — the only way to reach the two seams below,
   *  since no shipped build can. `deploy/gen-accounts.mjs` is COPIED in beside
   *  it rather than lost with the symlink, so `_acct_projection` still runs and
   *  the run reaches the answer rather than stopping one step short. */
  const stubOpBox = (prefix: string, body: string, gen = true): string => {
    const home = box(prefix);
    rmSync(join(home, 'ccrc', 'deploy'));
    mkdirSync(join(home, 'ccrc', 'deploy'), { recursive: true });
    if (gen) {
      copyFileSync(join(REPO, 'deploy', 'gen-accounts.mjs'),
        join(home, 'ccrc', 'deploy', 'gen-accounts.mjs'));
    }
    writeFileSync(join(home, 'ccrc', 'deploy', 'account-op.mjs'),
      'const a = process.argv;\n'
      + 'if (a[2] === "refuse") {\n'
      + '  const g = (k) => a[a.indexOf(`--${k}`) + 1];\n'
      + '  process.stdout.write(`${JSON.stringify(\n'
      + '    { ok: false, error: g("code"), detail: g("detail") })}\\n`);\n'
      + '} else {\n'
      + body
      + '}\n'
      + 'process.exitCode = 0;\n');
    return home;
  };

  /** The stub body the two `no-answer` cases below share. `check-declare` is a
   *  READ op and runs FIRST (D-2143), so a stub that answered nothing at all
   *  would refuse there — one step before the seam either case is about, with a
   *  different clause. Letting the pre-pass answer is what keeps each case
   *  measuring its own op. */
  const PASSES_CHECK = '  if (a[2] === "check-declare") process.stdout.write(\'{"ok":true}\\n\');\n';

  it('refuses `projection-absent`, not `roster-absent`, when accounts.sh is the missing file (D-1923)',
    () => {
      // TWO FILES, TWO REMEDIES, AND THIS VERB READS BOTH. `~/.ccrc/accounts.sh`
      // is `ccrc install`'s GENERATED projection and its fix is to regenerate;
      // `readRoster`'s three `roster-*` codes are about the JSON an operator
      // wrote and their fix is to edit it. `declare` can answer either in one
      // subcommand, so (subcommand, code) does not disambiguate and the CODE has
      // to. This is the site D-1923 names.
      const home = box('ccrc-account-declare-noproj-');
      seedRosterJson(home, [UPSTREAM]);
      plantLauncher(home, 'lab-dev0');
      rmSync(join(home, '.ccrc', 'accounts.sh'));
      const r = run(home, ['account', 'declare', '--id', 'lab-dev0',
        '--label', 'lab·dev0', '--hue', 'violet']);
      expect(r.code).toBe(1);
      const j = oneObject(r);
      expect(j['error']).toBe('projection-absent');
      expect(String(j['detail'])).toContain('accounts.sh');
      expect(existsSync(offMarker(home, 'lab-dev0'))).toBe(false);
    });

  it('refuses `projection-invalid` when accounts.sh is there and will not source', () => {
    // The second condition of the same reader, and a different fix: the file is
    // present, so `[ -f ]` passes. `_acct_roster_ids` is a SEPARATE copy of the
    // guard `_acct_candidates` carries — the two read the same file for
    // different verbs — so it needs its own row or the copy is unmeasured.
    const home = box('ccrc-account-declare-badproj-');
    seedRosterJson(home, [UPSTREAM]);
    plantLauncher(home, 'lab-dev0');
    writeFileSync(join(home, '.ccrc', 'accounts.sh'), 'CCRC_ACCOUNTS=(\n');
    const r = run(home, ['account', 'declare', '--id', 'lab-dev0',
      '--label', 'lab·dev0', '--hue', 'violet']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('projection-invalid');
    expect(existsSync(offMarker(home, 'lab-dev0'))).toBe(false);
  });

  it('says what still stands when the projection cannot be regenerated', () => {
    // `_acct_projection` TAKES its "what still stands" clause rather than baking
    // one (D-2135's standing rule: a helper whose sentence mentions what else
    // happened is taking a parameter, whether or not it has one yet). Six
    // subcommands will call it and they do not agree on what stands — after
    // `declare` a roster entry and a marker do, after `remove` an entry has just
    // gone — so a shared sentence would be false for one of them. This is the
    // measurement that keeps the parameter load-bearing.
    const home = stubOpBox('ccrc-account-declare-noproj2-', PASSES_CHECK, false);
    seedBoxRoster(home, FIXTURE_ROSTER);
    plantLauncher(home, 'lab-dev0');
    const r = run(home, ['account', 'declare', '--id', 'lab-dev0',
      '--label', 'lab·dev0', '--hue', 'violet']);
    expect(r.code).toBe(1);
    const j = oneObject(r);
    expect(j['error']).toBe('projection-failed');
    expect(String(j['detail'])).toContain('roster entry for "lab-dev0" WAS written');
    expect(String(j['detail'])).toContain(join(home, '.cc-sessions', 'lab-dev0-disabled'));
  });

  it('a READ op that exits 0 and prints nothing is `no-answer` too, at the exit code it gave',
    () => {
      // THE THIRD FACE OF THE SAME SEAM, and the one no exit code marks. A
      // non-zero exit with an empty body is a half-updated box; a ZERO exit with
      // an empty body is a callee that answered nothing while claiming success,
      // and `_acct_no_answer`'s own third branch says exactly that rather than
      // inventing a cause. Without this guard the verb prints a blank line and
      // exits 0, which is `JSON.parse('')` for the server.
      const home = stubOpBox('ccrc-account-declare-silent-', PASSES_CHECK);
      seedBoxRoster(home, FIXTURE_ROSTER);
      plantLauncher(home, 'lab-dev0');
      const r = run(home, ['account', 'declare', '--id', 'lab-dev0',
        '--label', 'lab·dev0', '--hue', 'violet']);
      expect(r.code).toBe(1);
      const j = oneObject(r);
      expect(j['error']).toBe('no-answer');
      expect(String(j['detail'])).toContain('exited 0');
      // The clause is this site's, and by this line everything stands.
      expect(String(j['detail'])).toContain('fully declared');
    });

  it('a write op that answers ANYTHING is `helper-noisy`, which is the same measurement inverted',
    () => {
      // THE OTHER DIRECTION, AND IT IS A DIFFERENT CODE ON PURPOSE. `no-answer`
      // is an empty body where one was owed; this is a body where none was. The
      // operator's next move differs — re-install the box, versus this is a bug
      // in ccrc — so collapsing them would be the overloaded seam. Reached the
      // only way it can be: a callee that returns 0 AND prints on the silent
      // path, which no shipped build does.
      const home = stubOpBox('ccrc-account-declare-noisy-',
        '  process.stdout.write(\'{"ok":true,"chatty":true}\\n\');\n');
      seedBoxRoster(home, FIXTURE_ROSTER);
      plantLauncher(home, 'lab-dev0');
      const r = run(home, ['account', 'declare', '--id', 'lab-dev0',
        '--label', 'lab·dev0', '--hue', 'violet']);
      expect(r.code).toBe(1);
      expect(oneObject(r)['error']).toBe('helper-noisy');
    });

  it('the `declared` op reads the kind off the roster it just read, and refuses an id that is not there',
    () => {
      // NOT A CONSTANT IN THE ANSWER. `kind` describes the entry `declare-entry`
      // wrote, and the same answer carries the whole roster — so spelling
      // `external` as a literal beside it would be two spellings of one value,
      // free to disagree. It is measured off the entry instead, which leaves one
      // condition to name rather than guess: an id the roster does not carry.
      const home = box('ccrc-account-declare-op-');
      seedRosterJson(home, [UPSTREAM]);
      const call = (id: string): Result => {
        const p = spawnSync('node', [join(REPO, 'deploy', 'account-op.mjs'), 'declared',
          '--file', join(home, '.ccrc', 'accounts.json'), '--id', id, '--disabled', 'true'],
        { encoding: 'utf8' });
        return { code: p.status ?? -1, stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
      };
      const ok = call('claude');
      expect(ok.code, ok.stderr).toBe(0);
      expect(oneObject(ok)['kind']).toBe('upstream');
      const bad = call('lab-dev0');
      expect(bad.code).toBe(1);
      expect(oneObject(bad)['error']).toBe('internal-no-entry');
    });

  it('the `declared` op refuses a --disabled that is not a boolean, exactly as `added` does',
    () => {
      // D-2131 AT ITS SECOND ADDRESS, AND IT WAS UNMEASURED HERE. `added` has
      // carried this row since Task 26; `declared` copied the guard and no case
      // drove it, so deleting the whole `if` left the file GREEN — measured at
      // review round 1. `=== 'true'` alone maps a typo, `'True'` and `''` to
      // `false`, which publishes "this lane is ON" about a lane that is off, and
      // `declare`'s single caller always passes one of the two words, so the
      // shape is refusable rather than guessable.
      const home = box('ccrc-account-declared-bool-');
      seedRosterJson(home, [UPSTREAM]);
      const call = (v: string | null): Result => {
        const args = ['declared', '--file', join(home, '.ccrc', 'accounts.json'), '--id', 'claude'];
        if (v !== null) args.push('--disabled', v);
        const p = spawnSync('node', [join(REPO, 'deploy', 'account-op.mjs'), ...args],
          { encoding: 'utf8' });
        return { code: p.status ?? -1, stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
      };
      for (const bad of ['tru', 'True', '1', '']) {
        const r = call(bad);
        expect(r.code, `--disabled ${JSON.stringify(bad)} was accepted`).toBe(2);
        expect(oneObject(r)['error']).toBe('bad-argv');
      }
      expect(oneObject(call(null))['error']).toBe('bad-argv');
      expect(oneObject(call('false'))['disabled']).toBe(false);
      expect(oneObject(call('true'))['disabled']).toBe(true);
    });
});

/** `ccrc account declare …` with the override shape `addArgs` takes, so the two
 *  verbs' refusal tables read as one comparison rather than two lists. A `null`
 *  override DROPS the flag; an EMPTY STRING passes it with nothing in it, which
 *  is a distinct request and one of the three D-2144 closes. */
function declareArgs(over: Record<string, string | null> = {}): string[] {
  const base: Record<string, string | null> = {
    '--id': 'lab-dev0', '--label': 'lab·dev0', '--hue': 'violet',
  };
  const out: string[] = ['account', 'declare'];
  for (const [k, v] of Object.entries({ ...base, ...over })) {
    if (v === null) continue;
    out.push(k, v);
  }
  return out;
}

describe('ccrc account declare: the pre-pass, and the class a field fault answers (D-2143)', () => {
  // WHAT THIS TABLE IS, AND WHY IT IS A TABLE. `deploy/account-op.mjs` argued
  // that `declare` needed no `check-*` op because "its only writer can also be
  // its only judge" — sound when written, false for the code shipped beside it:
  // D-2134's ordering, applied to this verb at D-2140, puts the kill-switch
  // marker on disk BEFORE the roster entry, so the writer judges with a file
  // already written. MEASURED at 6ae21f2a, on the three rows D-2143 names,
  // against `add`'s answer for the identical operator mistake:
  //
  //   operator types      add                        declare (before)
  //   --hue puce          unknown-hue, exit 2        roster-invalid, 1, marker on disk
  //   --provider orchard  unknown-provider, exit 2   roster-invalid, 1, marker on disk
  //   a colliding suffix  suffix-collision, exit 1   roster-invalid, 1, marker on disk
  //
  // Every row below asserts the CODE, the CLASS and the absence of BOTH files,
  // and the last of those is the assertion that reds if `check-declare` is
  // moved behind the marker or deleted.
  //
  // NO LAUNCHER IS PLANTED, DELIBERATELY. `_acct_declarable` would refuse each
  // of these requests with `launcher-absent` at exit 1 if it ran first, so a
  // fixture that planted one would pass whichever order shipped. Identity
  // first, disk second is this file's own rule (`_acct_declare`'s duplicate-id
  // gate says it in those words), and this is where it is measured for the
  // pre-pass.
  const cases: [string, Record<string, string | null>, string, number][] = [
    // ── THE THREE ROWS OF D-2143'S TABLE ────────────────────────────────────
    ['a hue nothing knows', { '--hue': 'puce' }, 'unknown-hue', 2],
    ['a provider nothing knows', { '--provider': 'orchard' }, 'unknown-provider', 2],
    // `.claude` is UPSTREAM's own config directory in this fixture, so this is
    // the collision `add` answers `suffix-collision` at exit 1 for. Class 1 and
    // not 2 on BOTH verbs: the request was legal on its face and the box said
    // no (ccd/ccrc:24-33).
    ['a suffix another account already holds', { '--suffix': '.claude' }, 'suffix-collision', 1],
    // ── AND THE TWO GATES THE SAME LIFT SHARES ──────────────────────────────
    // A TAB (U+0009), inside `LABEL_UNSAFE_RE`'s control-character class — the
    // benign end of that class to print in a test report, and the same row
    // `add` carries. Its presence HERE is what makes `hueAndLabelClass` a
    // shared gate rather than a second copy: both verbs drive the same two
    // lines, so a mutation of either has to red twice.
    ['a label carrying a control character', { '--label': 'lab\tdev0' }, 'bad-label', 2],
    // `_acct_suffix_or_refuse`, lifted out of `_acct_add_parse` for this
    // caller. `add`'s row for the identical value is `bad-suffix` at exit 2.
    // The OTHER suffix gate is deliberately not shared and has no row here:
    // `suffix-outside-read-root` stays `add`'s, because a declared launcher's
    // config dir is somebody else's and may hold no transcripts at all (D-2142).
    ['a suffix that is not a safe one-segment name', { '--suffix': '.claude/../x' },
      'bad-suffix', 2],
    // ── D-2144's THIRD SHAPE: PRESENT-BUT-EMPTY IS NOT ABSENT ───────────────
    // All three used to be dropped by `${x:+…}` and answered EXIT 0 — a lane
    // with no provider, no endpoint, or a config dir the operator did not
    // choose, and no message about any of it. `add` refuses `--provider ''`
    // with `missing-value` at exit 2, which is the answer all three now give.
    ['a --provider present with nothing in it', { '--provider': '' }, 'missing-value', 2],
    ['a --base-url present with nothing in it', { '--base-url': '' }, 'missing-value', 2],
    ['a --suffix present with nothing in it', { '--suffix': '' }, 'missing-value', 2],
    // The three the same gate also covers on its way past, each of which HAD an
    // answer at the right class and a different sentence. They are rows because
    // the gate is one line for six flags: delete it and these three fall back
    // to the downstream checks while the three above go green at exit 0, so
    // only the whole set measures the whole line.
    ['a --label present with nothing in it', { '--label': '' }, 'missing-value', 2],
    ['a --hue present with nothing in it', { '--hue': '' }, 'missing-value', 2],
    ['an --id present with nothing in it', { '--id': '' }, 'missing-value', 2],
  ];

  for (const [name, over, code, exit] of cases) {
    it(`refuses ${name} with "${code}" at exit ${exit}, having written nothing`, () => {
      const home = box('ccrc-account-declare-pre-');
      seedRosterJson(home, [UPSTREAM]);
      const before = readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8');
      const r = run(home, declareArgs(over));
      expect(r.code, `${name}: ${r.stderr}`).toBe(exit);
      const j = oneObject(r);
      expect(j['ok']).toBe(false);
      expect(j['error'], name).toBe(code);
      expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8'), name).toBe(before);
      expect(existsSync(offMarker(home, 'lab-dev0')),
        `${name}: a refused declare left the kill-switch marker behind`).toBe(false);
      // AND THE PROJECTION WAS NOT REGENERATED EITHER — the third write this
      // verb makes, and the one a refusal at any of these gates never reaches.
      expect(readFileSync(join(home, '.ccrc', 'accounts.sh'), 'utf8')).not.toContain('lab-dev0');
    });
  }

  it('and the SAME request with everything right is accepted, so the table is not vacuous', () => {
    // THE ACCEPTANCE ROW EVERY REFUSAL TABLE NEEDS. `declareArgs()` with no
    // override is the request each row above breaks in exactly one place, so
    // this proves the rows fail for their own reason rather than for a fixture
    // that could never have succeeded.
    const home = box('ccrc-account-declare-pre-ok-');
    seedRosterJson(home, [UPSTREAM]);
    plantLauncher(home, 'lab-dev0');
    const r = run(home, declareArgs());
    expect(r.code, r.stderr).toBe(0);
    expect(oneObject(r)['id']).toBe('lab-dev0');
  });

  it('the marker it could not write is a refusal, and the clause is THIS site\'s (D-2135)', () => {
    // THE `declare` SITE'S `_acct_disable_new` CLAUSE, WHICH MEASURED NOTHING
    // (review round 1). Every other declare case runs on a box where the marker
    // write succeeds, so replacing this call's clause with "Nothing was
    // written." — a sentence that is true at `add`'s first write and at the
    // pre-pass, and false here — left the whole file green. A clause has to be
    // REACHED to be measured, and the only way to reach it is a box where the
    // write fails.
    //
    // TWO ROWS, BECAUSE THE TWO `||` ARMS FAIL ON DIFFERENT ERRORS — `add`'s
    // own table's reason: `mkdir -p` is a no-op on an existing directory, so a
    // marker NAME that is a directory reaches the second arm and never the
    // first, while `$REG` being a regular file reaches only the first.
    const clause = (h: string): string =>
      'Nothing else was written: no roster entry names "lab-dev0" yet, so this box does not '
      + `have that account, and the launcher ${join(h, '.local', 'bin', 'lab-dev0')} is `
      + "somebody else's file that ccrc never writes. Re-run this same command once the cause "
      + 'is fixed.';
    const rows: [string, string, (h: string) => void][] = [
      ['$REG is a regular file', 'cannot create',
        (h) => writeFileSync(join(h, '.cc-sessions'), 'not a directory\n')],
      ['the marker name is a directory', 'cannot write',
        (h) => mkdirSync(join(h, '.cc-sessions', 'lab-dev0-disabled'), { recursive: true })],
    ];
    for (const [what, opening, breakIt] of rows) {
      const home = box('ccrc-account-declare-nomarker-');
      seedRosterJson(home, [UPSTREAM]);
      plantLauncher(home, 'lab-dev0');
      breakIt(home);
      const r = run(home, declareArgs());
      expect(r.code, `${what}: ${r.stderr}`).toBe(1);
      const j = oneObject(r);
      expect(j['ok'], `${what}: answered ok about a switch it did not throw`).toBe(false);
      expect(j['error'], what).toBe('disable-marker');
      expect(String(j['detail']), what).toContain(opening);
      // THE CLAUSE ENDS THE SENTENCE, and it says what is true at THIS line and
      // nowhere else in the verb: nothing written, and — unlike `add` — nothing
      // ever writes the launcher, because it is not ccrc's file.
      expect(String(j['detail']).endsWith(clause(home)),
        `${what} did not end in the declare site's own clause:\n    ${String(j['detail'])}`)
        .toBe(true);
      // AND THE TWO FILES A LATER STEP WOULD HAVE WRITTEN ARE NOT THERE.
      expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).not.toContain('lab-dev0');
      expect(readFileSync(join(home, '.local', 'bin', 'lab-dev0'), 'utf8')).toBe('exit 0\n');
    }
  });

  it('check-declare reaches its own refusals with no caller, and writes nothing on any of them',
    () => {
      // THE OP DIRECTLY, `check-add`'s own no-caller row at this arm's address.
      // It is not a duplicate of the table above: that one drives the whole
      // verb and can only reach the codes bash lets through, while this one
      // reaches the four `bad-argv` refusals no bash path can produce (bash
      // always passes `--file`, `--id`, `--label` and `--hue`) and pins the
      // SUCCESS shape, which the verb swallows.
      const home = box('ccrc-account-check-declare-');
      seedRosterJson(home, [UPSTREAM]);
      const file = join(home, '.ccrc', 'accounts.json');
      const before = readFileSync(file, 'utf8');
      const call = (over: Record<string, string | null> = {}): Result =>
        checkDeclare(file, over);
      // THE FOUR REQUIRED KEYS, each named by the refusal rather than folded
      // into one "bad request".
      for (const k of ['--file', '--id', '--label', '--hue']) {
        const r = call({ [k]: null });
        expect(r.code, k).toBe(2);
        expect(oneObject(r)['error'], k).toBe('bad-argv');
        expect(String(oneObject(r)['detail']), k).toContain(k.slice(2));
      }
      // THE ANSWER, AND IT IS THE ENTRY `declare-entry` WILL WRITE. Asserted
      // field for field because this object is the whole reason the two ops can
      // share one assembly: a pre-pass judging a different shape from the one
      // that lands is a pre-pass that judged nothing.
      const ok = call();
      expect(ok.code, ok.stderr).toBe(0);
      expect(oneObject(ok)['entry']).toEqual({
        id: 'lab-dev0', label: 'lab·dev0', hue: 'violet', configDirSuffix: '.lab-dev0',
        homeAble: false, telemetry: 'none', exec: { kind: 'external' },
      });
      // …and with the two declarative fields, which reach `exec` and nowhere else.
      expect((oneObject(call({ '--provider': 'openai', '--base-url': 'https://orchard-api/v1' }))
        ['entry'] as { exec: unknown }).exec)
        .toEqual({ kind: 'external', provider: 'openai', baseUrl: 'https://orchard-api/v1' });
      // THE VALIDATOR'S OWN WORDS, VERBATIM, at class 1 (D-2142): for a
      // declared lane the endpoint belongs to somebody else's launcher and
      // `declare` defaults nothing, so `rosterFromJson` stays the one owner of
      // that field rather than this file growing a second vocabulary for it.
      const bad = call({ '--provider': 'compatible', '--base-url': 'http://orchard-api/v1' });
      expect(bad.code).toBe(1);
      expect(oneObject(bad)['error']).toBe('roster-invalid');
      expect(bad.stderr).toBe(`account-op: ${String(oneObject(bad)['detail'])} (roster-invalid)\n`);
      // NOTHING THIS OP DID TOUCHED THE FILE, on any of the paths above — the
      // property the whole ruling rests on, measured rather than argued.
      expect(readFileSync(file, 'utf8')).toBe(before);
    });

  it('… and an EMPTY --id, --label or --suffix is an argv fault here too (D-2154)', () => {
    // THE MIRROR OF `check-add`'s ROW, at the address that still had the hole.
    // MEASURED at 1dc39a6f, each answering `roster-invalid` at exit 1 with the
    // validator's own sentence:
    //
    //   --id ''      1  accounts[3] has an invalid id "". Rename it to match …
    //   --label ''   1  account "lab-dev0" has no label. Add a non-empty "label" …
    //   --suffix ''  1  account "lab-dev0" has an invalid configDirSuffix "". Set it …
    //
    // Every one names a ROSTER FIELD (`configDirSuffix` is not a flag anybody
    // typed) and an entry INDEX, and prescribes editing an account that does
    // not exist — at class 1, "legal on its face and the box said no", for a
    // request that is not legal on its face. They are the identical three
    // sentences round 4 rejected for `check-add`.
    //
    // WHAT THIS ROW DOES *NOT* SAY, because a later reader will be tempted to
    // widen it: D-2142 and D-2150 rule that `declare`'s FIELD vocabulary is
    // `rosterFromJson`'s and reaches the operator verbatim — that is about
    // `baseUrl` and the roster's own shape rules, and it stands. An empty flag
    // is an ARGV question, which no roster validator can name because by the
    // time it reads the entry the flag is gone. The row below and the row after
    // it are the two halves of that boundary.
    const home = box('ccrc-account-checkdeclare-empty-');
    seedRosterJson(home, [UPSTREAM]);
    const file = join(home, '.ccrc', 'accounts.json');
    const before = readFileSync(file, 'utf8');
    for (const flag of ['--id', '--label', '--suffix']) {
      const r = checkDeclare(file, { [flag]: '' });
      expect(r.code, `${flag} '': ${r.stderr}`).toBe(2);
      const j = oneObject(r);
      expect(j['ok'], flag).toBe(false);
      expect(j['error'], flag).toBe('bad-argv');
      expect(String(j['detail']), flag).toContain(flag);
    }
    // ONE SHAPE AND NOT TWO FOR THESE THREE (D-2153's own correction applied):
    // the gate sits above every line that reads `--provider` or `--base-url`,
    // so no lane can reach it differently — and the row below MEASURES that
    // sameness across both shapes rather than leaving it to this sentence.
    expect(readFileSync(file, 'utf8'), 'a pre-pass wrote to the roster').toBe(before);
  });

  it('the four keys check-declare\'s empty gate leaves alone keep their own codes', () => {
    // THE OTHER HALF OF THE SAME LINE, and the reason the loop names three of
    // this op's seven keys rather than seven. Each of these four already
    // refuses an empty value with the code that names its OWN condition, and
    // widening the loop would replace four specific answers with one generic
    // sentence — an adapter narrowing a distinction it received. This row is
    // what goes red if a later reader "finishes the job".
    //
    // `--base-url` IS THE ONE TO READ TWICE. Its answer is `roster-invalid` at
    // exit 1 — the same class the three above used to give — and it stays out
    // of the loop deliberately: that is the base-url residual D-2150 ACCEPTED
    // for wave 1, whose sentence names `exec.baseUrl`, the very field the flag
    // sets, and carries the validator's own `base-url-unparseable` tag. The fix
    // wave 2 will make is an export from `shared/roster-json.mjs`, not a fourth
    // key in the loop; this row is what will red when that export lands, which
    // is the reminder D-2150 asked for.
    const home = box('ccrc-account-checkdeclare-emptyrest-');
    seedRosterJson(home, [UPSTREAM]);
    const file = join(home, '.ccrc', 'accounts.json');
    const rows: [string, string, number][] = [
      ['--file', 'roster-absent', 1],
      ['--hue', 'unknown-hue', 2],
      ['--provider', 'unknown-provider', 2],
      ['--base-url', 'roster-invalid', 1],
    ];
    // ONE VERDICT PER ROW, MEASURED FIRST AND ASSERTED ONCE, so a regression
    // names every row it broke rather than throwing at the first.
    const got: Record<string, string> = {};
    const want: Record<string, string> = {};
    for (const [lane, over] of CHECK_DECLARE_LANES) {
      for (const [flag, code, exit] of rows) {
        const r = checkDeclare(file, { ...over, [flag]: '' });
        const j = JSON.parse(r.stdout.split('\n')[0]!) as Record<string, unknown>;
        expect(String(j['error']), `${lane} ${flag} answered the generic argv sentence`)
          .not.toBe('bad-argv');
        got[`${lane} ${flag}`] = `${String(j['error'])} at ${r.code}`;
        want[`${lane} ${flag}`] = `${code} at ${exit}`;
      }
    }
    expect(got).toEqual(want);
    // AND THE TWO SHAPES AGREE, which is the claim `CHECK_DECLARE_LANES` is
    // kept for: this arm has no flag it refuses as a flag that cannot mean
    // anything on this lane, so accidental cover — the shape that hid the
    // `check-add` defect for two rounds — cannot be what these four rows are
    // measuring.
    expect(rows.map(([flag]) => got[`undeclared ${flag}`]))
      .toEqual(rows.map(([flag]) => got[`declared ${flag}`]));
  });

  it('one loop, two callers: check-add and check-declare refuse an empty flag in the same words',
    () => {
      // THE MECHANISM UNDER "REUSE, DO NOT RE-SPELL" (D-2154). Both arms call
      // `emptyFlagClass`, so one request must not describe itself two ways
      // depending on which verb the operator typed. Re-spell the loop in either
      // arm — the drift `single-definition.test.ts` cannot see, because it
      // filters `/\.tsx?$/` and this rule lives in a `.mjs` (D-1860) — and the
      // two sentences part company here.
      const home = box('ccrc-account-emptyflag-shared-');
      seedBoxRoster(home, FIXTURE_ROSTER);
      const file = join(home, '.ccrc', 'accounts.json');
      for (const flag of ['--id', '--label', '--suffix']) {
        const fromAdd = oneObject(checkAdd(home, { [flag]: '' }));
        const fromDeclare = oneObject(checkDeclare(file, { [flag]: '' }));
        expect(fromDeclare['error'], flag).toBe(fromAdd['error']);
        expect(String(fromDeclare['detail']), `${flag}: the two arms disagree`)
          .toBe(String(fromAdd['detail']));
      }
      // AND THE SENTENCE NAMES NEITHER VERB'S OWN VOCABULARY: `check-add`
      // answers with a `plan` and `check-declare` with an `entry`, so the noun
      // is "the entry it proposes" — true of both, since both propose one
      // (`addedEntry(plan)`, `declaredEntry(a)`). A sentence naming "the plan"
      // would be `check-add`'s alone (D-2154).
      const d = String(oneObject(checkDeclare(file, { '--suffix': '' }))['detail']);
      expect(d).toContain('carried into the entry it proposes');
      expect(d).not.toContain('the plan');
    });

  it('one formatter, five verbs: each roster-invalid keeps its OWN opening (D-2154)', () => {
    // THE MECHANISM UNDER THE EXTRACTION. `rosterAdmits` replaced five hand
    // copies of one `instanceof RosterInvalid` block — `readRoster`,
    // `check-add`, `add-entry`, `check-declare`, `declare-entry` — and the one
    // thing that extraction could have narrowed is the SENTENCE each verb
    // opens with, because that is the only part that differed. Three openings
    // for five sites, and each says a different next move:
    //
    //   readRoster    "<file>: …"                         fix the file you have
    //   the add pair  "the entry for \"x\" would make …"    change a flag
    //   the declare   "declaring \"x\" would make …"        change a flag
    //
    // MEASURED BEFORE THIS ROW EXISTED: mutating `readRoster`'s opening to the
    // declare sentence, and BOTH declare openings to the add sentence, left
    // this file green at 167/167 — three unmeasured mechanisms sitting beside
    // one measured neighbour (the add pair, pinned by D-2152's "one sentence"
    // row). That is D-2145's pattern for the third time in this wave, so the
    // gap is closed rather than noted.
    const home = box('ccrc-account-openings-');
    seedBoxRoster(home, FIXTURE_ROSTER);
    const file = join(home, '.ccrc', 'accounts.json');
    const detail = (r: Result): string => String(oneObject(r)['detail']);

    // 1. `readRoster` — the roster the box ALREADY has does not validate, and
    // the operator's next move is that file. No candidate entry exists at this
    // address, so no sentence about one may appear.
    const badRoster = box('ccrc-account-openings-bad-');
    mkdirSync(join(badRoster, '.ccrc'), { recursive: true });
    const badFile = join(badRoster, '.ccrc', 'accounts.json');
    writeFileSync(badFile, `${JSON.stringify({ version: 1, accounts: [{ ...UPSTREAM, hue: 'puce' }] }, null, 2)}\n`);
    const read = spawnSync('node', [join(REPO, 'deploy', 'account-op.mjs'), 'roster', '--file', badFile],
      { encoding: 'utf8' });
    const readDetail = String((JSON.parse(read.stdout.split('\n')[0]!) as Record<string, unknown>)['detail']);
    expect(read.status).toBe(1);
    expect(readDetail.startsWith(`${badFile}: `), `readRoster's opening moved:\n    ${readDetail}`)
      .toBe(true);
    expect(readDetail).not.toContain('would make');

    // 2/3. THE ADD PAIR, word for word alike — the property D-2152 argued and
    // this row re-measures through the extracted formatter.
    const addOpening = `the entry for "lab dev0" would make ${file} unparseable: `;
    const fromCheckAdd = detail(checkAdd(home, { '--id': 'lab dev0' }));
    expect(fromCheckAdd.startsWith(addOpening), `check-add's opening moved:\n    ${fromCheckAdd}`)
      .toBe(true);
    const fromAddEntry = detail(addEntry(home, {
      plan: {
        id: 'lab dev0', label: 'lab·dev0', hue: 'amber', configDirSuffix: '.claude-lab-dev0',
        provider: 'compatible', baseUrl: 'https://orchard-api/v1',
        secretsFile: '.cc-secrets/lab-dev0-token.env', models: null,
      },
    }));
    expect(fromAddEntry.startsWith(addOpening), `add-entry's opening moved:\n    ${fromAddEntry}`)
      .toBe(true);

    // 4/5. THE DECLARE PAIR, the same claim at the other address. `declare`
    // says "declaring", not "the entry for": this verb records somebody else's
    // launcher and never writes one, and the two verbs are typed
    // interchangeably by an operator who must be able to tell which answered.
    const decOpening = `declaring "lab-dev0" would make ${file} unparseable: `;
    const insecure = { '--provider': 'compatible', '--base-url': 'http://orchard-api/v1' };
    const pre = detail(checkDeclare(file, insecure));
    expect(pre.startsWith(decOpening), `check-declare's opening moved:\n    ${pre}`).toBe(true);
    const before = readFileSync(file, 'utf8');
    const wrote = declareEntry(file, insecure);
    // AND THE WRITER'S OWN GATE IS WHAT THIS LAST ROW MEASURES. `declare-entry`
    // is callable by hand with no `check-declare` in front of it — its source
    // says so and calls itself "the writer's own last gate" — and MEASURED at
    // eb86b830 that gate could be deleted with this file green at 167/167,
    // exactly the shape D-2153 found in `add-entry` one round earlier: a ruling
    // naming a mechanism load-bearing while the mechanism measured nothing.
    // Without it this request answers exit 0 and appends an entry the roster's
    // own validator refuses — a box poisoned by the verb that was asked to
    // record one launcher.
    expect(wrote.code, `declare-entry accepted an entry rosterFromJson refuses: ${wrote.stdout}`)
      .toBe(1);
    expect(readFileSync(file, 'utf8'), 'declare-entry wrote a roster it had refused').toBe(before);
    expect(detail(wrote).startsWith(decOpening), `declare-entry's opening moved:\n    ${detail(wrote)}`)
      .toBe(true);
  });
});

/** A registry row: the `.uuid` that makes it a row, plus the two fields this
 *  cluster reads. Written as ccd writes them — one file per field, no trailing
 *  newline (`_reg_set`, ccd/ccd:1285-1291). */
function plantRow(home: string, sid: string, o: { wrapper: string; home?: string }): void {
  const reg = join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  writeFileSync(join(reg, `${sid}.uuid`), 'u-1234');
  writeFileSync(join(reg, `${sid}.wrapper`), o.wrapper);
  if (o.home !== undefined) writeFileSync(join(reg, `${sid}.home`), o.home);
}

/** A tmux on the fixture's PATH that names exactly these sessions, ANSWERING at
 *  exit 0 — the measured case. It displaces the create-if-absent poison
 *  `env()` plants, which is why that one is conditional. Any argv other than
 *  `list-sessions` is a loud failure: a verb that started DRIVING tmux rather
 *  than asking it could not pass unnoticed (stubTmux's rule,
 *  ccrc-doctor.test.ts:191-199). */
function plantTmux(home: string, sessions: string[]): void {
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(home, '.local', 'bin', 'tmux'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/tmux-calls"',
    'if [ "$1" = list-sessions ]; then',
    ...sessions.map((s) => `  printf '${s}\\n'`),
    '  exit 0',
    'fi',
    'echo "fixture tmux: unexpected argv: $*" >&2; exit 90',
  ].join('\n') + '\n', { mode: 0o755 });
}

const TOKEN_LANE = {
  id: 'alt-max', label: 'alt·max', hue: 'violet', configDirSuffix: '.claude-alt-max',
  homeAble: true, telemetry: 'anthropic',
  exec: { kind: 'generated', provider: 'anthropic',
    // THE PATH ccrc ITSELF WRITES: `_acct_write_secret` derives `<id>-<tag>.env`
    // from its own arguments (Task 22), where the tag is `oauth` for a lane
    // exporting CLAUDE_CODE_OAUTH_TOKEN and the provider id for an api-key lane,
    // and `add` records exactly that (Task 23's `secretTag`, account-op.mjs:1075).
    // It is also the name `ccd-account-auth` writes when a `setup-token` re-auth
    // mints a new one (Task 54), which is why the three derivations are one rule.
    // A fixture naming anything else would be about `secrets-path-unmanaged`,
    // which is its own case below.
    secretsFile: '.cc-secrets/alt-max-oauth.env' },
};

describe('deploy/account-op.mjs: lane and rotated, driven by hand', () => {
  const OP = join(REPO, 'deploy', 'account-op.mjs');
  const node = (args: string[]): Result => {
    const r = spawnSync('node', [OP, ...args], { encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const rosterFile = (home: string): string => join(home, '.ccrc', 'accounts.json');

  it('lane answers EIGHT lines with every empty field still in its own slot', () => {
    // THE WHOLE REASON THIS OP IS NOT JSON, measured at the op rather than
    // argued: `upstream` carries no secretsFile and an anthropic lane no
    // baseUrl, so two of the seven fields are empty and one of them is not the
    // last. TSV would collapse them (CLAUDE.md's measured hazard) and a bare
    // list would lose a trailing one to `$( )`; the sentinel makes both loud.
    const home = box('ccrc-account-op-lane-');
    seedRosterJson(home, [UPSTREAM, TOKEN_LANE]);
    const r = node(['lane', '--file', rosterFile(home), '--id', 'claude']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')).toEqual([
      'upstream',                    // kind
      'anthropic',                   // provider — ABSENCE-PERMITS (§4.1)
      '',                            // secretsFile — absent, and NOT the last field
      'CLAUDE_CODE_OAUTH_TOKEN',     // secretEnv, off PROVIDER_DEPLOY
      '.claude',                     // configDirSuffix
      '',                            // baseUrl — absent, and the last real field
      '1',                           // homeAble
      'END',
      '',
    ]);
  });

  it('lane leaves BOTH the provider and the env var empty for an external lane', () => {
    // The two nulls `not-managed` is decidable from, and they are separate
    // fields: an `external` entry's provider is genuinely undeclared (so the
    // anthropic default must NOT apply), and a provider the table knows with no
    // env var of its own answers '' rather than a guessed variable name.
    const home = box('ccrc-account-op-lane-ext-');
    seedRosterJson(home, [UPSTREAM,
      { id: 'gpt', label: 'gpt', hue: 'amber', configDirSuffix: '.claude-gpt',
        homeAble: false, telemetry: 'none', exec: { kind: 'external' } },
      { id: 'gpt2', label: 'gpt2', hue: 'amber', configDirSuffix: '.claude-gpt2',
        homeAble: false, telemetry: 'none', exec: { kind: 'external', provider: 'openai' } }]);
    expect(node(['lane', '--file', rosterFile(home), '--id', 'gpt']).stdout.split('\n').slice(0, 4))
      .toEqual(['external', '', '', '']);
    expect(node(['lane', '--file', rosterFile(home), '--id', 'gpt2']).stdout.split('\n').slice(0, 4))
      .toEqual(['external', 'openai', '', '']);
  });

  it('lane refuses a missing key at exit 2, and an unknown id at exit 1', () => {
    const home = box('ccrc-account-op-lane-argv-');
    seedRosterJson(home, [UPSTREAM]);
    const noId = node(['lane', '--file', rosterFile(home)]);
    expect(noId.code).toBe(2);
    expect(JSON.parse(noId.stdout)['error']).toBe('bad-argv');
    const noFile = node(['lane', '--id', 'claude']);
    expect(noFile.code).toBe(2);
    expect(JSON.parse(noFile.stdout)['error']).toBe('bad-argv');
    const bad = node(['lane', '--file', rosterFile(home), '--id', 'nope']);
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stdout)['error']).toBe('unknown-id');
  });

  it('rotated refuses a --measured this file would have to guess at (D-2131)', () => {
    // THE TOTAL CONVERSION, at a third address. `=== "true"` alone maps every
    // other value — a typo, an empty string, a shell that dropped the flag — to
    // `false`, which publishes "nobody could tell" about a box that answered.
    for (const bad of ['yes', 'True', '1', '']) {
      const r = node(['rotated', '--id', 'x', '--measured', bad]);
      expect(r.code, `--measured ${JSON.stringify(bad)}`).toBe(2);
      expect(JSON.parse(r.stdout)['error']).toBe('bad-argv');
    }
    expect(node(['rotated', '--id', 'x']).code).toBe(2);
  });

  it('rotated refuses live ids handed in beside --measured false', () => {
    // The one shape neither side may send: a session named on a lane nothing
    // could be measured on. Dropping the list silently would let the caller
    // believe it had been carried.
    const r = node(['rotated', '--id', 'x', '--measured', 'false', '--live', 'orchard-api']);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout)['error']).toBe('bad-argv');
  });

  it('rotated tells an EMPTY list from an unmeasured one, and neither is the other', () => {
    expect(JSON.parse(node(['rotated', '--id', 'x', '--measured', 'true']).stdout))
      .toEqual({ ok: true, id: 'x', live: [] });
    expect(JSON.parse(node(['rotated', '--id', 'x', '--measured', 'false']).stdout))
      .toEqual({ ok: true, id: 'x', live: null });
    expect(JSON.parse(node(['rotated', '--id', 'x', '--measured', 'true',
      '--live', 'a', '--live', 'b']).stdout))
      .toEqual({ ok: true, id: 'x', live: ['a', 'b'] });
  });
});

/** A box whose `account-op.mjs` answers `lane` with EXACTLY these lines and
 *  nothing else. It is the ONLY way to reach `_acct_lane`'s sentinel check
 *  (D-2184): node builds slot 7 from a literal `'END'` inside the `.join`, so
 *  every field a roster can influence is one of the seven above it and no
 *  roster on earth produces an eighth line that is not the sentinel. Measured
 *  before this round, that is exactly what it cost: deleting the sentinel test
 *  alone left the whole file green, and the guard was being credited to its
 *  neighbour's count.
 *
 *  `refuse` is kept REAL — every refusal on either side goes through it, and a
 *  stub that could not refuse would answer this file's assertions with an empty
 *  stdout rather than with the envelope under test. Nothing else is
 *  implemented: an op this stub does not know exits 2 with an empty body, which
 *  is `no-answer`'s own shape, so a mutation that lets the run past `lane`
 *  cannot be mistaken for a pass. */
function laneStubBox(prefix: string, lines: string[]): string {
  const home = box(prefix);
  rmSync(join(home, 'ccrc', 'deploy'));   // the symlink into the real tree
  mkdirSync(join(home, 'ccrc', 'deploy'), { recursive: true });
  writeFileSync(join(home, 'ccrc', 'deploy', 'account-op.mjs'),
    'const a = process.argv;\n'
    + 'if (a[2] === "refuse") {\n'
    + '  const g = (k) => a[a.indexOf(`--${k}`) + 1];\n'
    + '  process.stdout.write(`${JSON.stringify(\n'
    + '    { ok: false, error: g("code"), detail: g("detail") })}\\n`);\n'
    + '} else if (a[2] === "lane") {\n'
    + `  process.stdout.write(${JSON.stringify(lines.join('\n') + '\n')});\n`
    + '} else {\n'
    + '  process.stderr.write("lane stub: no such op\\n");\n'
    + '  process.exitCode = 2;\n'
    + '}\n');
  return home;
}

/** The seven fields a legal `lane` answer carries, in their own slots — the
 *  body `laneStubBox`'s callers mutate one line of. */
const LANE_LINES = ['generated', 'anthropic', '.cc-secrets/alt-max-oauth.env',
  'CLAUDE_CODE_OAUTH_TOKEN', '.claude-alt-max', '', '1'];

describe('ccrc account credential', () => {
  it('writes the secret 0600 into a 0700 directory, and prints nothing of it', () => {
    const home = box('ccrc-account-cred-write-');
    seedRosterJson(home, [UPSTREAM, TOKEN_LANE]);
    plantTmux(home, []);
    const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', '-'],
      `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    const f = join(home, '.cc-secrets', 'alt-max-oauth.env');
    expect((lstatSync(f).mode & 0o777).toString(8)).toBe('600');
    expect((lstatSync(path.dirname(f)).mode & 0o777).toString(8)).toBe('700');
    expect(readFileSync(f, 'utf8')).toBe(`export CLAUDE_CODE_OAUTH_TOKEN=${CANARY}\n`);
    // THE CANARY (spec:411-413). Both streams AND every file the fixture holds
    // outside ~/.cc-secrets. `filesUnder` skips symlinks, so the whole-directory
    // links `box()` plants for `deploy` and `shared` are not walked.
    expect(r.stdout + r.stderr).not.toContain(CANARY);
    const leaked = filesUnder(home)
      .filter((p) => p !== f)
      .filter((p) => { try { return readFileSync(p, 'utf8').includes(CANARY); } catch { return false; } });
    expect(leaked, 'the credential appears outside ~/.cc-secrets').toEqual([]);
    // THE ROSTER IS NOT TOUCHED (spec:419, "no roster change") — this verb
    // rotates a file the entry already names.
    expect(JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8'))['accounts'])
      .toEqual([UPSTREAM, TOKEN_LANE]);
  });

  it('rotates a SHELL-SYNTAX credential byte-exactly, and nothing of it runs (D-1984)', () => {
    // THE CANARY ABOVE CANNOT SEE THE CLASS THAT SHIPPED. `CANARY-3d7f52-…`
    // matches `[A-Za-z0-9-]`, which is exactly the input for which `printf %q`
    // and `printf %s` AGREE — a green canary carried D-1984 for a whole wave.
    // This case drives the verb end to end with a value whose bytes are shell
    // syntax, and asserts the three things the canary case cannot: the file
    // round-trips through a `source` byte for byte (the wrapper SOURCES it,
    // `shared/wrapper.mjs:141-143`), nothing of it EXECUTED, and no truncation.
    //
    // Measured beside this, at the syscall level rather than asserted: `strace
    // -f -e trace=execve,write,openat` over one such run forks node twice,
    // `timeout`, the tmux stub, `mkdir`, `chmod` and `mv` — and NOT ONE of those
    // execve argv carries a byte of the value. Exactly one `write()` in the
    // whole run does, to the fd the temp file was opened on (117 bytes, the
    // file's own size), and `/dev/tty` is opened once and answers ENXIO, so
    // nothing is written there either.
    const home = box('ccrc-account-cred-shellsyntax-');
    seedRosterJson(home, [UPSTREAM, TOKEN_LANE]);
    plantTmux(home, []);
    const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', '-'],
      `${SHELL_SYNTAX}\n`);
    expect(r.code, r.stderr).toBe(0);
    const f = join(home, '.cc-secrets', 'alt-max-oauth.env');
    // NOT A `.toBe(`export …=${SHELL_SYNTAX}`)`: `%q` is not identity here, and
    // asserting the quoted FORM would pin bash's quoter rather than the
    // property. The property is that a `source` gives the bytes back.
    const back = spawnSync(BASH, ['-c', `set -u; . ${JSON.stringify(f)}; `
      + 'printf %s "$CLAUDE_CODE_OAUTH_TOKEN"'], { env: env(home), encoding: 'utf8' });
    expect(back.status, back.stderr).toBe(0);
    expect(back.stdout).toBe(SHELL_SYNTAX);
    // AND NOT ONE BYTE OF IT RAN — the fixture's own command substitution writes
    // `$HOME/EXECUTED`, in the `source` above as well as in the write itself.
    expect(existsSync(join(home, 'EXECUTED')), 'the credential was executed').toBe(false);
    expect(r.stdout + r.stderr).not.toContain(SHELL_SYNTAX);
    // NO TEMP OUTLIVES THE RUN, and the destination is the one file that has it.
    const leaked = filesUnder(home)
      .filter((p) => p !== f)
      .filter((p) => { try { return readFileSync(p, 'utf8').includes('EXECUTED'); } catch { return false; } });
    expect(leaked, 'the credential appears outside ~/.cc-secrets').toEqual([]);
    expect(readdirSync(join(home, '.cc-secrets'))).toEqual(['alt-max-oauth.env']);
  });

  it('lists the LIVE sessions on the lane, and only those', () => {
    const home = box('ccrc-account-cred-live-');
    seedRosterJson(home, [UPSTREAM, TOKEN_LANE]);
    plantRow(home, 'orchard-api', { wrapper: 'alt-max' });   // live
    plantRow(home, 'lab-dev0', { wrapper: 'alt-max' });      // registered, pane gone
    plantRow(home, 'team-shared', { wrapper: 'claude' });    // another lane
    plantTmux(home, ['cc-orchard-api', 'cc-team-shared']);
    const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', '-'],
      `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    expect(oneObject(r)['live']).toEqual(['orchard-api']);
  });

  it('answers live:[] from the REGISTRY when no row names the lane, without asking tmux', () => {
    // Two measurements, and only the second one can fail. A box with no rows on
    // this lane has nothing that could be live, so a tmux that cannot answer is
    // not a gap — and rotating a credential must not need a tmux server.
    const home = box('ccrc-account-cred-norows-');
    seedRosterJson(home, [UPSTREAM, TOKEN_LANE]);
    // A REGISTRY WITH ROWS ON ANOTHER LANE, not an absent one: without this the
    // case would also pass on a verb that never read the registry at all.
    plantRow(home, 'team-shared', { wrapper: 'claude' });
    // no plantTmux: env()'s poison records argv and exits 97
    const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', '-'],
      `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    expect(oneObject(r)['live']).toEqual([]);
    // THE POISON IS ARMED, AND IT NEVER FIRED — two assertions, because the
    // second alone passes in the very world it is meant to exclude (D-2166's
    // own note, which the pristine case below acted on and this one had not).
    // Measured: with `env()`'s tmux poison deleted, `existsSync(tmux-poison) ===
    // false` stays GREEN here while the null case below reds, so "tmux was
    // never asked" was resting on a file that was not there to be written.
    expect(existsSync(join(home, '.local', 'bin', 'tmux')),
      'the tmux poison is not on PATH, so "it never fired" measures nothing').toBe(true);
    expect(existsSync(join(home, 'tmux-poison')), 'tmux was asked with nothing to ask about')
      .toBe(false);
  });

  it('answers live:null — never [] — when a row exists and tmux cannot be measured', () => {
    const home = box('ccrc-account-cred-notmux-');
    seedRosterJson(home, [UPSTREAM, TOKEN_LANE]);
    plantRow(home, 'orchard-api', { wrapper: 'alt-max' });
    const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', '-'],
      `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    const j = oneObject(r);
    expect(j['live']).toBeNull();
    expect(j['live']).not.toEqual([]);
    // The write still happened: the report of a gap is not a refusal.
    expect(existsSync(join(home, '.cc-secrets', 'alt-max-oauth.env'))).toBe(true);
    // AND THE POISON IS WHAT ANSWERED, which is the whole containment claim:
    // the argv it recorded is this verb's one tmux call and nothing else.
    expect(readFileSync(join(home, 'tmux-poison'), 'utf8'))
      .toBe('list-sessions -F #{session_name}\n');
  });

  it('answers live:null when the REGISTRY ITSELF cannot be read (D-2185)', () => {
    // THE FIRST OF THE THREE REGISTRY CONDITIONS, and until this round it was
    // folded into the second. Measured before the fix: `~/.cc-sessions` at mode
    // 000 with a row for this lane inside answered `{"ok":true,…,"live":[]}` —
    // "no session is running on this lane" — because `[ -d ]` succeeds on a
    // directory nothing can list and `nullglob` turns the unreadable glob into
    // no rows at all. An operator who has just rotated a credential reads that
    // as "nothing to restart", which is the one thing it does not say.
    const home = box('ccrc-account-cred-regmode-');
    seedRosterJson(home, [UPSTREAM, TOKEN_LANE]);
    plantRow(home, 'orchard-api', { wrapper: 'alt-max' });
    const reg = join(home, '.cc-sessions');
    chmodSync(reg, 0o000);
    try {
      const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', '-'],
        `${CANARY}\n`);
      expect(r.code, r.stderr).toBe(0);
      const j = oneObject(r);
      expect(j['live'], 'an unreadable registry was reported as "nobody is running"').toBeNull();
      expect(j['live']).not.toEqual([]);
      // The write still happened: an unmeasurable registry is a REPORT gap, not
      // a refusal — the same polarity the tmux arm takes one branch below.
      expect(existsSync(join(home, '.cc-secrets', 'alt-max-oauth.env'))).toBe(true);
      // AND TMUX WAS NEVER ASKED, with the poison armed to prove the claim is
      // not resting on an absent file (the no-rows case's own lesson).
      expect(existsSync(join(home, '.local', 'bin', 'tmux')),
        'the tmux poison is not on PATH, so "it never fired" measures nothing').toBe(true);
      expect(existsSync(join(home, 'tmux-poison')),
        'tmux was asked about a registry nothing could read').toBe(false);
    } finally {
      // The harness's recursive rm cannot enter a 0o000 directory.
      chmodSync(reg, 0o700);
    }
  });

  it('answers live:null when a ROW exists and its .wrapper cannot be read (D-2185)', () => {
    // THE SECOND CONDITION, AND THE SHARPER ONE: the unreadable row sits beside
    // a readable row that IS live on this lane, so before the fix this box
    // answered `live:["orchard-api"]` — a PARTIAL list presented as a complete
    // one, which is worse than the empty one above because it reads as an
    // authoritative "restart exactly this pane". The file that could not be
    // read may name this same lane, so the whole answer is unmeasured; the wire
    // has no third state to say it in (`--measured false` carries no ids by
    // contract, `account-op.mjs`'s `rotated`).
    const home = box('ccrc-account-cred-rowmode-');
    seedRosterJson(home, [UPSTREAM, TOKEN_LANE]);
    plantRow(home, 'orchard-api', { wrapper: 'alt-max' });
    plantRow(home, 'lab-dev0', { wrapper: 'alt-max' });
    plantTmux(home, ['cc-orchard-api', 'cc-lab-dev0']);
    const wrapper = join(home, '.cc-sessions', 'lab-dev0.wrapper');
    chmodSync(wrapper, 0o000);
    try {
      const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', '-'],
        `${CANARY}\n`);
      expect(r.code, r.stderr).toBe(0);
      const j = oneObject(r);
      expect(j['live'], 'a row nothing could read was dropped from a list called complete')
        .toBeNull();
      expect(j['live']).not.toEqual(['orchard-api']);
      expect(existsSync(join(home, '.cc-secrets', 'alt-max-oauth.env'))).toBe(true);
      // The fixture's own tmux is on PATH and answering, and it was still never
      // asked: nothing measurable is left to ask it about.
      expect(existsSync(join(home, 'tmux-calls')),
        'tmux was asked although the registry read had already failed').toBe(false);
    } finally {
      chmodSync(wrapper, 0o600);
    }
  });

  it('a row that records NO lane is skipped, and the measurement still stands (D-2185)', () => {
    // THE THIRD CONDITION, and it is the one that keeps the fix from being "any
    // doubt means unmeasured". An ABSENT `.wrapper` is a positive fact — the
    // registry records no lane for that row — while an unreadable one is the
    // absence of a fact, which is the same distinction `statMeasured` and the
    // agent wire's `absent` marker draw on the server side (D-1396). So this
    // box still answers a MEASURED list, and the live pane is named in it.
    const home = box('ccrc-account-cred-rowbare-');
    seedRosterJson(home, [UPSTREAM, TOKEN_LANE]);
    plantRow(home, 'orchard-api', { wrapper: 'alt-max' });
    // A row with a `.uuid` and no `.wrapper` beside it at all.
    writeFileSync(join(home, '.cc-sessions', 'no-lane.uuid'), 'u-5678');
    plantTmux(home, ['cc-orchard-api', 'cc-no-lane']);
    const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', '-'],
      `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    expect(oneObject(r)['live']).toEqual(['orchard-api']);
  });

  it('refuses a login lane with not-managed, and writes nothing', () => {
    const home = box('ccrc-account-cred-login-');
    seedRosterJson(home, [UPSTREAM,
      { id: 'lab-dev0', label: 'lab·dev0', hue: 'blue', configDirSuffix: '.claude-lab-dev0',
        homeAble: true, telemetry: 'anthropic', exec: { kind: 'generated', provider: 'anthropic' } }]);
    const r = run(home, ['account', 'credential', '--id', 'lab-dev0', '--credential', '-'],
      `${CANARY}\n`);
    expect(r.code).toBe(1);
    const j = oneObject(r);
    expect(j['error']).toBe('not-managed');
    // THE REMEDY IS A COMMAND THE OPERATOR CAN TYPE, so it carries `--id`
    // between the verb and the method — `_acct_add`'s own
    // `credential-not-managed` sentence has the identical shape. This task's
    // plan asserted the contiguous string `auth-start --method login`, which
    // its OWN refusal sentence two steps later cannot contain; the two halves
    // are asserted separately rather than the sentence bent to the assertion.
    expect(String(j['detail'])).toContain('auth-start --id lab-dev0');
    expect(String(j['detail'])).toContain('--method login');
    expect(existsSync(join(home, '.cc-secrets'))).toBe(false);
  });

  it('refuses an external lane on its KIND, before it asks any other question (D-2167)', () => {
    // THE KIND GATE, on the lane shape that has no secretsFile — the answer is
    // `external-lane` and NOT `not-managed`, because an external lane is an
    // external lane whether or not it names a file. One fact, one code: routing
    // it to two codes on a field that has nothing to do with the fact would be
    // the same overloaded seam wearing the other hat.
    const home = box('ccrc-account-cred-external-');
    seedRosterJson(home, [UPSTREAM,
      { id: 'gpt', label: 'lab·dev0', hue: 'amber', configDirSuffix: '.claude-gpt',
        homeAble: false, telemetry: 'none', exec: { kind: 'external', provider: 'openai' } }]);
    const r = run(home, ['account', 'credential', '--id', 'gpt', '--credential', '-'], `${CANARY}\n`);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('external-lane');
    expect(existsSync(join(home, '.cc-secrets'))).toBe(false);
  });

  it('refuses an external lane that DOES name a matching secretsFile, and writes no file (D-2167)', () => {
    // THE SHAPE THAT SHIPPED ACCEPTED, measured before the gate existed: a
    // hand-written `external` entry naming provider `openrouter` and exactly
    // the path `_acct_write_secret` derives passed all three of the gates that
    // were there — `secretsFile` non-empty, `ANTHROPIC_AUTH_TOKEN` non-empty,
    // and the derived path equal to the declared one — and answered
    // `{"ok":true,"id":"handrolled","live":[]}` at exit 0 with a live token in
    // a 0600 file. Nothing branched on `exec.kind` at all.
    //
    // IT IS THE OTHER FIXTURE SHAPE OF THE SAME LINE (D-2145, D-2165): the case
    // above reaches the kind gate on a lane the OLD code would have refused
    // anyway, so it would stay green with the gate deleted. Only this one goes
    // red, and it goes red on the FILE first — a wrong exit code is not what
    // this gate exists to prevent.
    const home = box('ccrc-account-cred-external-secrets-');
    seedRosterJson(home, [UPSTREAM,
      { id: 'handrolled', label: 'hand·rolled', hue: 'amber',
        configDirSuffix: '.claude-handrolled', homeAble: false, telemetry: 'none',
        exec: { kind: 'external', provider: 'openrouter',
          secretsFile: '.cc-secrets/handrolled-openrouter.env' } }]);
    const r = run(home, ['account', 'credential', '--id', 'handrolled', '--credential', '-'],
      `${CANARY}\n`);
    const dir = join(home, '.cc-secrets');
    expect(existsSync(dir) ? filesUnder(dir) : [],
      'ccrc wrote a credential file for a launcher it promised never to touch')
      .toEqual([]);
    expect(r.code).toBe(1);
    const j = oneObject(r);
    expect(j['error']).toBe('external-lane');
    // The sentence says WHOSE the launcher is, which is the whole warrant:
    // decision 22(c)'s "ccrc records it and never touches it".
    expect(String(j['detail'])).toContain('external lane');
    expect(String(j['detail'])).toContain('never writes');
    expect(r.stdout + r.stderr).not.toContain(CANARY);
  });

  it('refuses a lane whose provider keeps no env var, even when it names a secretsFile', () => {
    // THE SECOND `not-managed` GATE, WHICH THE TWO CASES ABOVE NEVER REACH
    // (D-2145's rule: not "is this tested" but which line, on which input).
    // THE FIXTURE IS `generated`, NOT `external`, SINCE D-2167: this gate is
    // downstream of the kind gate, so an external fixture would be measuring
    // that one instead — which is exactly what it was doing before the gate
    // landed. `rosterFromJson` puts no kind predicate on `exec.provider`
    // either, so a `generated` entry may legally name `openai` (measured: the
    // `lane` op answers `generated / openai / .cc-secrets/gpt-openai.env / ''`)
    // — and `PROVIDER_DEPLOY['openai'].envVar` is null, so there is no variable
    // to write into it. Deleting the first `not-managed` gate leaves this case
    // green and deleting the second leaves the login case above green; only the
    // pair pins both, and their DETAILS are what tell them apart.
    const home = box('ccrc-account-cred-noenv-');
    seedRosterJson(home, [UPSTREAM,
      { id: 'gpt', label: 'lab·dev0', hue: 'amber', configDirSuffix: '.claude-gpt',
        homeAble: false, telemetry: 'none',
        exec: { kind: 'generated', provider: 'openai', secretsFile: '.cc-secrets/gpt-openai.env' } }]);
    const r = run(home, ['account', 'credential', '--id', 'gpt', '--credential', '-'], `${CANARY}\n`);
    expect(r.code).toBe(1);
    const j = oneObject(r);
    expect(j['error']).toBe('not-managed');
    expect(String(j['detail'])).toContain('keeps its credential outside ccrc');
    expect(existsSync(join(home, '.cc-secrets'))).toBe(false);
  });

  it('rotates an UPSTREAM lane that declares a secretsFile — spec:419\'s second admitted kind', () => {
    // THE KIND GATE ADMITS TWO KINDS, NOT ONE, and nothing else in this file
    // drives the second: every other rotating case is `generated`. A gate
    // written `[ "$ACCT_KIND" = generated ]` would pass every other case in
    // this describe and refuse the one lane every fleet has.
    const home = box('ccrc-account-cred-upstream-');
    seedRosterJson(home, [
      { ...UPSTREAM, exec: { kind: 'upstream', secretsFile: '.cc-secrets/claude-oauth.env' } }]);
    plantTmux(home, []);
    const r = run(home, ['account', 'credential', '--id', 'claude', '--credential', '-'],
      `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, '.cc-secrets', 'claude-oauth.env'), 'utf8'))
      .toBe(`export CLAUDE_CODE_OAUTH_TOKEN=${CANARY}\n`);
    expect(r.stdout + r.stderr).not.toContain(CANARY);
  });

  it('refuses a secretsFile ccrc did not write, rather than filling a file nothing sources', () => {
    const home = box('ccrc-account-cred-unmanaged-');
    // A HAND-WRITTEN path: legal in the roster (`SECRETS_SAFE_RE` admits it) and
    // not what `_acct_write_secret` derives for this lane, which is the whole
    // condition. The lane's own file would be `.cc-secrets/alt-max-oauth.env`
    // — `oauth` because the lane exports CLAUDE_CODE_OAUTH_TOKEN (Task 22's
    // `tag`) — so this roster points its wrapper somewhere ccrc cannot claim.
    seedRosterJson(home, [UPSTREAM,
      { ...TOKEN_LANE, exec: { ...TOKEN_LANE.exec, secretsFile: '.cc-secrets/alt-max.env' } }]);
    const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', '-'],
      `${CANARY}\n`);
    // THE FILE FIRST, THE EXIT CODE SECOND, and the order is the assertion.
    // What this gate exists to prevent is not a wrong exit code: it is a live
    // credential landing in `<id>-oauth.env` while the wrapper sources
    // `alt-max.env` and the operator reads a success line. Deleting the gate
    // must red on the FILE, so the file is what is measured first — and
    // `filesUnder` is used rather than one `existsSync` so a writer that picked
    // any other name is caught too.
    const dir = join(home, '.cc-secrets');
    expect(existsSync(dir) ? filesUnder(dir) : [],
      'a credential file was written for a lane ccrc cannot prove it owns')
      .toEqual([]);
    expect(r.code).toBe(1);
    const j = oneObject(r);
    expect(j['error']).toBe('secrets-path-unmanaged');
    // BOTH paths, because the operator has to see which one their wrapper reads.
    expect(String(j['detail'])).toContain('.cc-secrets/alt-max.env');
    expect(String(j['detail'])).toContain('.cc-secrets/alt-max-oauth.env');
    expect(existsSync(join(home, '.cc-secrets'))).toBe(false);
  });

  it('derives the api-key lane\'s file from the PROVIDER, not the literal "oauth"', () => {
    // THE OTHER HALF OF THE TAG RULE, and it is the same line measured on a
    // second fixture shape (D-2145's two-fixtures finding). An `openrouter`
    // lane exports ANTHROPIC_AUTH_TOKEN, so its file is `<id>-openrouter.env`
    // — a `want` that hard-coded `oauth` would refuse this lane, and a `want`
    // built from the provider alone (the plan's own snippet) would refuse the
    // anthropic lane above. Only the shared derivation admits both.
    const home = box('ccrc-account-cred-apikey-');
    seedRosterJson(home, [UPSTREAM,
      { id: 'orchard-api', label: 'orchard·api', hue: 'green',
        configDirSuffix: '.claude-orchard-api', homeAble: true, telemetry: 'none',
        exec: { kind: 'generated', provider: 'openrouter',
          secretsFile: '.cc-secrets/orchard-api-openrouter.env' } }]);
    plantTmux(home, []);
    const r = run(home, ['account', 'credential', '--id', 'orchard-api', '--credential', '-'],
      `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    const f = join(home, '.cc-secrets', 'orchard-api-openrouter.env');
    expect(readFileSync(f, 'utf8')).toBe(`export ANTHROPIC_AUTH_TOKEN=${CANARY}\n`);
    expect(r.stdout + r.stderr).not.toContain(CANARY);
  });

  it('refuses an id no roster carries, and reads the roster through the validator', () => {
    // `unknown-id` is the `lane` op's own refusal and it arrives through
    // `_acct_run_op`'s verbatim re-emit — so this also pins that the eight-line
    // reader never sees a refusal envelope (the wrapper exits on node's class
    // first, which is why `_acct_lane`'s own guard only ever judges rc 0).
    const home = box('ccrc-account-cred-unknown-');
    seedRosterJson(home, [UPSTREAM]);
    const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', '-'],
      `${CANARY}\n`);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('unknown-id');
    expect(existsSync(join(home, '.cc-secrets'))).toBe(false);
  });

  it('binds all SEVEN lane fields to their own slots, including the two nothing reads', () => {
    // `ACCT_BASEURL` AND `ACCT_HOMEABLE` HAVE NO READER IN BASH, and until this
    // round nothing measured where they came from either: swapping their two
    // slots in `_acct_lane`'s reader was 190 green. Task 32 is written against
    // all seven globals, so it would have inherited a positional binding to an
    // eight-line format that nothing pins — and a slot swap is the one defect
    // this format's whole design (one field per line, an `END` sentinel) exists
    // to make impossible.
    //
    // Driven through `sourceCall` because the verb has no path that prints
    // them: the function IS the interface here, and the values are chosen so no
    // two slots hold the same bytes — a swap of any pair changes this listing.
    const home = box('ccrc-account-lane-slots-');
    seedRosterJson(home, [UPSTREAM,
      { id: 'alt-max', label: 'alt·max', hue: 'violet', configDirSuffix: '.claude-alt-max',
        homeAble: true, telemetry: 'none',
        exec: { kind: 'generated', provider: 'compatible', baseUrl: 'https://x.example/v1',
          secretsFile: '.cc-secrets/alt-max-compatible.env' } }]);
    const r = sourceCall(home, '_acct_lane alt-max\n'
      + 'printf \'%s\\n\' "$ACCT_KIND" "$ACCT_PROVIDER" "$ACCT_SECRETS" "$ACCT_SECRET_ENV" '
      + '"$ACCT_SUFFIX" "$ACCT_BASEURL" "$ACCT_HOMEABLE"');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')).toEqual([
      'generated',                              // f[0] kind
      'compatible',                             // f[1] provider
      '.cc-secrets/alt-max-compatible.env',     // f[2] secretsFile
      'ANTHROPIC_AUTH_TOKEN',                   // f[3] secretEnv, off PROVIDER_DEPLOY
      '.claude-alt-max',                        // f[4] configDirSuffix
      'https://x.example/v1',                   // f[5] baseUrl
      '1',                                      // f[6] homeAble
      '',
    ]);
  });

  it('refuses a roster field carrying a control byte — the loop D-2166 called unreachable', () => {
    // THE PREMISE WAS FALSE AND THE MEASUREMENT SAYS SO. `_acct_lane`'s
    // control-character loop was measured as "deletes green, therefore
    // unreachable by construction", the argument being that `rosterFromJson`
    // refuses a control byte in `configDirSuffix`, `secretsFile`, `kind` and
    // `provider` "while `new URL()` strips them from `baseUrl`". That last
    // clause does not hold for the value the READER receives: `rosterFromJson`
    // parses `exec.baseUrl` with `new URL()` to VALIDATE it and the roster keeps
    // the ORIGINAL string, which the `lane` op emits verbatim. Measured on this
    // fixture — the whole roster validates, `lane` exits 0, and its sixth line
    // is `https://x.example/<CR>tail` with the byte intact.
    //
    // FIVE BYTES, ONE PER FAILURE MODE, and only some of them are caught by the
    // COUNT guard: a raw LF splits the field and answers "in 9 lines instead of
    // 8", while CR, TAB, VT, SOH and DEL do not split anything — eight lines
    // arrive with `END` in slot 7 and this loop is the only thing between them
    // and a refusal sentence an operator reads on a terminal.
    //
    // `add` CANNOT WRITE ONE, which is why this is the hand-written-roster path
    // and not a regression: `check-add` normalises through `new URL()` on the
    // way OUT, which deletes tab/CR/LF outright and percent-encodes the rest
    // (measured: `--base-url` carrying \x01 comes back `%01`). That is the
    // fifth hand-written entry this cluster has had to close.
    for (const [name, byte] of [['CR', '\r'], ['TAB', '\t'], ['VT', '\v'],
      ['SOH', '\x01'], ['DEL', '\x7f'], ['LF', '\n']] as const) {
      const home = box(`ccrc-account-cred-cntrl-${name}-`);
      seedRosterJson(home, [UPSTREAM,
        { id: 'alt-max', label: 'alt·max', hue: 'violet',
          configDirSuffix: '.claude-alt-max', homeAble: true, telemetry: 'none',
          exec: { kind: 'generated', provider: 'compatible',
            baseUrl: `https://x.example/${byte}tail`,
            secretsFile: '.cc-secrets/alt-max-compatible.env' } }]);
      const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', '-'],
        `${CANARY}\n`);
      expect(r.code, `${name}: ${r.stderr}`).toBe(1);
      expect(oneObject(r)['error'], name).toBe('lane-unreadable');
      // NOTHING WAS WRITTEN, which is the half an exit code does not say.
      expect(existsSync(join(home, '.cc-secrets')), name).toBe(false);
    }
  });

  it('refuses a GROWN field on the count, in a sentence that names the number (D-2184)', () => {
    // ONE OF TWO PREDICATES, MEASURED ALONE. The helper answers nine lines with
    // `END` still last — the shape the count exists for, and the shape the
    // sentinel cannot see. Delete the count and this box refuses through the
    // sentinel instead (slot 7 is now `ninth`), which is a different sentence:
    // the assertion is on the SENTENCE, not on the code, because both
    // predicates answer `lane-unreadable` by design.
    const home = laneStubBox('ccrc-account-lane-count-', [...LANE_LINES, 'ninth', 'END']);
    seedRosterJson(home, [UPSTREAM, TOKEN_LANE]);
    const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', '-'],
      `${CANARY}\n`);
    const j = oneObject(r);
    expect(r.code, r.stderr).toBe(1);
    expect(j['error']).toBe('lane-unreadable');
    expect(String(j['detail'])).toContain('described account "alt-max" in 9 lines instead of 8');
    expect(String(j['detail'])).not.toContain('END sentinel');
    expect(existsSync(join(home, '.cc-secrets')), 'a credential was written').toBe(false);
  });

  it('refuses an eighth line that is NOT the sentinel, and no longer says 8 instead of 8 (D-2184)', () => {
    // THE OTHER PREDICATE, ON THE ONE SHAPE ONLY IT CATCHES — eight lines with
    // a data field where `END` belongs. This needs a STUBBED helper and there
    // is no way around that: `deploy/account-op.mjs` writes slot 7 from a
    // literal inside its `.join`, so no roster, however hand-written, can move
    // it. That is why deleting this guard was green in a file of 191 tests, and
    // it is what D-2184 means by a prescribed mutation that cannot demonstrate
    // its stated property.
    //
    // AND THE SENTENCE IS THE OTHER HALF. Under the shared guard this exact
    // box answered "described account \"alt-max\" in 8 lines instead of 8" — a
    // number equal to itself, which fails closed and lies to the next
    // maintainer. Two predicates, two sentences.
    const home = laneStubBox('ccrc-account-lane-sentinel-', [...LANE_LINES, 'ninth']);
    seedRosterJson(home, [UPSTREAM, TOKEN_LANE]);
    const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', '-'],
      `${CANARY}\n`);
    // THE FILE FIRST: what this guard prevents is seven values read out of the
    // wrong slots and a credential written from them, not a wrong exit code.
    expect(existsSync(join(home, '.cc-secrets')), 'a credential was written').toBe(false);
    expect(r.code, r.stderr).toBe(1);
    const j = oneObject(r);
    expect(j['error']).toBe('lane-unreadable');
    expect(String(j['detail']))
      .toContain('ended account "alt-max" with "ninth" where the END sentinel belongs');
    expect(String(j['detail'])).not.toContain('in 8 lines instead of 8');
    expect(r.stdout + r.stderr).not.toContain(CANARY);
  });

  it('scrubs the field before the SENTINEL names it, which is why the loop runs first', () => {
    // THE ORDER IS A DECISION AND THIS IS ITS MEASUREMENT. The sentinel is the
    // one guard in `_acct_lane` that interpolates a FIELD, and the shape it
    // exists for — a helper that grew a field where `END` was — is a field a
    // roster would fill. So the control-character loop runs BEFORE it, and a
    // slot-7 value carrying a TAB comes back as the control-character refusal
    // with no raw byte in the sentence. Reverse the two and this box answers
    // the sentinel's sentence with the TAB inside it, on an operator's
    // terminal, which is the hazard that loop's own header states.
    const home = laneStubBox('ccrc-account-lane-order-', [...LANE_LINES, 'nin\tth']);
    seedRosterJson(home, [UPSTREAM, TOKEN_LANE]);
    const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', '-'],
      `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(1);
    const j = oneObject(r);
    expect(j['error']).toBe('lane-unreadable');
    expect(String(j['detail'])).toContain('carries a control character');
    expect(String(j['detail']), 'the raw byte reached the refusal sentence').not.toContain('\t');
    expect(existsSync(join(home, '.cc-secrets')), 'a credential was written').toBe(false);
  });

  it('refuses an rc-0 EMPTY body rather than reading one blank field as a lane (D-2184)', () => {
    // The fourth protocol shape, and the count is what answers it: `$( )`
    // strips the trailing newline, `mapfile` still yields one empty element,
    // and 1 is not 8. Named here because "the helper printed nothing" and "the
    // helper printed a lane" are the two conditions `_acct_read_op` exists to
    // keep apart, and an empty body reaches the count guard through it.
    const home = laneStubBox('ccrc-account-lane-empty-', []);
    seedRosterJson(home, [UPSTREAM, TOKEN_LANE]);
    const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', '-'],
      `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(1);
    // `no-answer`, not `lane-unreadable`: an empty stdout at rc 0 never reaches
    // the reader — `_acct_read_op` refuses it first, which is the seam this
    // cluster closed and the reason the count guard only ever judges a body.
    expect(oneObject(r)['error']).toBe('no-answer');
    expect(existsSync(join(home, '.cc-secrets')), 'a credential was written').toBe(false);
  });

  it('dies on empty stdin at exit 2, before it opens the destination', () => {
    // `credential-empty`, class 2 — `_acct_read_credential`'s own code and its
    // own class (Task 22's `[ -n "${v//[[:space:]]/}" ] || _acct_refuse 2
    // credential-empty …`), not a second spelling here.
    const home = box('ccrc-account-cred-empty-');
    seedRosterJson(home, [UPSTREAM, TOKEN_LANE]);
    const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', '-'], '');
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('credential-empty');
    expect(existsSync(join(home, '.cc-secrets', 'alt-max-oauth.env'))).toBe(false);
  });

  it('refuses --credential with anything but "-"', () => {
    const home = box('ccrc-account-cred-rot-argv-');
    seedRosterJson(home, [UPSTREAM, TOKEN_LANE]);
    const r = run(home, ['account', 'credential', '--id', 'alt-max', '--credential', CANARY]);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('credential-not-stdin');
    expect(r.stdout + r.stderr).not.toContain(CANARY);
  });

  it('refuses a flag present with nothing in it, rather than dropping it (D-2148)', () => {
    // The empty-flag loop `add` and `declare` both carry, at this verb's
    // address. `--id ''` would otherwise fall through to `missing-value` from
    // `_acct_id_or_refuse` and `--credential ''` would reach
    // `credential-not-stdin`; both are the right class and the wrong sentence,
    // and neither is what the operator did.
    const home = box('ccrc-account-cred-emptyflag-');
    seedRosterJson(home, [UPSTREAM, TOKEN_LANE]);
    for (const argv of [['--id', '', '--credential', '-'], ['--id', 'alt-max', '--credential', '']]) {
      const r = run(home, ['account', 'credential', ...argv], `${CANARY}\n`);
      expect(r.code, `${argv.join(' ')}: ${r.stderr}`).toBe(2);
      const j = oneObject(r);
      expect(j['error']).toBe('missing-value');
      expect(String(j['detail'])).toContain('was given an empty value');
    }
    expect(existsSync(join(home, '.cc-secrets'))).toBe(false);
  });
});

// ── `check`: THE CHEAP QUESTION FIRST, AND ITS EXIT CODE IS NOT THE ANSWER ─
// §8 splits health into two questions and only one of them costs money:
// `claude auth status --json` is a local credential read, the `-p` probe bills
// a real request. So `check` asks the cheap one first and short-circuits — but
// ONE-SIDEDLY. `loggedIn: false` is a verdict (`auth-dead`, no inference
// spent); `loggedIn: true` is only the PRECONDITION for asking the expensive
// one, because §8's `ok` means exit 0 from a real `-p` and a live token says
// nothing about whether the lane's base URL answers, whether its model map
// names a model the endpoint serves, or whether the subscription has quota.

/** A `claude`-shaped launcher that answers `auth status` from fixture files and
 *  logs its argv. `<home>/fixture-auth-out` is stdout, `<home>/fixture-auth-rc`
 *  the exit code — two files because the whole point of this task is that they
 *  disagree. Any other argv is a loud failure (exit 90), so a `check` that
 *  started running something else could not pass unnoticed. */
function plantClaude(home: string, id: string): void {
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(home, '.local', 'bin', id), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/claude-argv"',
    'if [ "$1" = auth ] && [ "$2" = status ]; then',
    '  [ -f "$HOME/fixture-auth-out" ] && cat "$HOME/fixture-auth-out"',
    '  if [ -f "$HOME/fixture-auth-rc" ]; then IFS= read -r rc < "$HOME/fixture-auth-rc"; exit "$rc"; fi',
    '  exit 0',
    'fi',
    'echo "fixture claude: unexpected argv: $*" >&2; exit 90',
  ].join('\n') + '\n', { mode: 0o755 });
}

const authFixture = (home: string, out: string, rc: number): void => {
  writeFileSync(join(home, 'fixture-auth-out'), out);
  writeFileSync(join(home, 'fixture-auth-rc'), `${rc}\n`);
};

const claudeArgv = (home: string): string[] => {
  const p = join(home, 'claude-argv');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

/** The shape MEASURED 2026-09-07 on an unauthenticated scratch config dir
 *  (spec:667-669), verbatim. */
const SIGNED_OUT = JSON.stringify({
  loggedIn: false, authMethod: 'none', apiProvider: 'firstParty',
  analyticsDisabled: false, projectsDirectory: '/home/fixture/.claude/projects',
}) + '\n';

/** The same object with `loggedIn` flipped and an `authMethod` beside it. ONLY
 *  the signed-out shape is measured (spec:667-669) and this suite does not
 *  pretend otherwise — what IS measured about this one is narrower and enough:
 *  the classifier touches exactly two fields, `loggedIn` and `authMethod`, so a
 *  sibling this fixture guesses wrong about cannot change the answer. The
 *  `authMethod` value is the FIXTURE's, echoed by the assertion below rather
 *  than pinned as a vendor string. */
const SIGNED_IN = JSON.stringify({
  loggedIn: true, authMethod: 'claudeai', apiProvider: 'firstParty',
  analyticsDisabled: false, projectsDirectory: '/home/fixture/.claude/projects',
}) + '\n';

/** The one non-anthropic lane this describe needs, and it carries NO
 *  `exec.baseUrl`: openrouter is the provider whose `baseUrlRequired` is false
 *  (`shared/providers.ts:135`), so the entry validates without one and nothing
 *  in this describe ever dials an endpoint — Task 29's probe is a stub that
 *  runs no subprocess at all. Its id is a bare label for the reason
 *  `CHECK_DECLARE_LANES` uses `orchard-api`: `topology-clean.test.ts` admits
 *  only RFC1918, loopback and RFC5737 as IPv4 literals, so a fixture endpoint
 *  is never anything that could be a real box. */
const OPENROUTER_LANE = {
  id: 'orchard-api', label: 'team·shared', hue: 'green',
  configDirSuffix: '.claude-orchard-api', homeAble: true, telemetry: 'none',
  exec: { kind: 'generated', provider: 'openrouter',
    secretsFile: '.cc-secrets/orchard-api-openrouter.env' },
};

/** A `generated` lane that names NO provider — §4.1's absence-permitting rule,
 *  which `_acct_lane` resolves to `anthropic` in node (`account-op.mjs`'s `lane`
 *  arm) and which the openrouter fixture above cannot reach. `check`'s own
 *  comment claims this resolution; this is what measures it. */
const NO_PROVIDER_LANE = {
  id: 'alt-max', label: 'alt·max', hue: 'violet', configDirSuffix: '.claude-alt-max',
  homeAble: true, telemetry: 'anthropic',
  exec: { kind: 'generated', secretsFile: '.cc-secrets/alt-max-oauth.env' },
};

/** The OTHER non-anthropic shape, and it is a different LINE of the roster
 *  reader than the openrouter one: `lane` answers a null provider for an
 *  `external` account specifically (`e['kind'] === 'external'`), where
 *  openrouter answers a provider that simply is not `anthropic`. One guard in
 *  bash, two ways to arrive at it — D-2145's "the same line measured on one
 *  fixture shape and unmeasured on another". */
const EXTERNAL_LANE = {
  id: 'gpt', label: 'gpt', hue: 'magenta', configDirSuffix: '.claude-gpt',
  homeAble: false, telemetry: 'none', exec: { kind: 'external' },
};

/** THE TWO NEW OPS, DRIVEN BY HAND — `declareOp`'s shape at this address, and
 *  the only way to reach the argv refusals and the exit-2 corner of `classify`'s
 *  four-code contract. `_acct_auth_status` builds a fixed argv, so bash can
 *  never spell these wrong; a hand caller can, and a future one will. */
function opRun(args: string[], stdin = ''): Result {
  const r = spawnSync('node', [join(REPO, 'deploy', 'account-op.mjs'), ...args],
    { encoding: 'utf8', input: stdin });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('deploy/account-op.mjs classify: four exit codes, and only two of them print JSON', () => {
  it('a verdict is exit 0 and one JSON row', () => {
    const r = opRun(['classify', '--source', 'auth-status', '--exit', '1'], SIGNED_OUT);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject(
      { verdict: 'auth-dead', source: 'auth-status' });
  });

  it('no parseable answer is exit 3 with stdout EMPTY — not a row, not a refusal', () => {
    // A row would be a VERDICT and the caller's `[ -n "$ACCT_HEALTH" ]` would
    // short-circuit on it; a refusal would say something is wrong with the box.
    // Neither is true, so the code carries the whole message.
    const r = opRun(['classify', '--source', 'auth-status', '--exit', '1'],
      'error: unknown command "auth"\n');
    expect(r.code).toBe(3);
    expect(r.stdout, 'exit 3 printed something for the caller to mistake for a row').toBe('');
  });

  it('a signed-in lane is exit 4 and ONE LINE OF PLAIN TEXT — the only non-JSON stdout here', () => {
    const r = opRun(['classify', '--source', 'auth-status', '--exit', '0'], SIGNED_IN);
    expect(r.code).toBe(4);
    expect(r.stdout.split('\n').length, 'exit 4 printed more than one line').toBe(2);
    expect(() => JSON.parse(r.stdout)).toThrow();
    expect(r.stdout).toContain('claudeai');
  });

  it('bad argv is exit 2 with the envelope, on both fields', () => {
    for (const args of [['classify', '--source', 'sideways', '--exit', '0'],
      ['classify', '--source', 'probe', '--exit', 'soon'],
      ['classify', '--source', 'probe']]) {
      const r = opRun(args, '{}');
      expect(r.code, args.join(' ')).toBe(2);
      expect(JSON.parse(r.stdout)['error']).toBe('bad-argv');
    }
  });

  it('health refuses a row it cannot parse rather than half-building the answer', () => {
    // THE VERB'S OWN STDOUT CANNOT BE HALF-BUILT: an empty `--row` spliced into
    // a bash string printed `…,"health":`, invalid JSON reaching the caller that
    // parses it. Here the writer that owns every byte of stdout re-serialises.
    for (const row of ['', 'not json', '[]', '{"measuredAt":"x"}']) {
      const r = opRun(['health', '--id', 'claude', '--row', row]);
      expect(r.code, JSON.stringify(row)).toBe(1);
      const j = JSON.parse(r.stdout) as Record<string, unknown>;
      expect(j['error']).toBe('classify-failed');
      expect(String(j['detail'])).toContain('claude');
    }
    expect(opRun(['health', '--row', '{"verdict":"ok"}']).code).toBe(2);
  });
});

describe('ccrc account check: auth status', () => {
  it('reads exit 1 with parseable JSON as an ANSWER, not as a failure', () => {
    // THE MEASUREMENT THIS TASK IS FOR: all three spellings exit 1 when
    // loggedIn is false (spec:674-678). A reader that believed the exit code
    // would turn every signed-out lane into `unknown` — the one verdict §8
    // says is never reported as ok, and which the UI renders as *nobody could
    // tell*.
    const home = box('ccrc-account-check-signedout-');
    seedRosterJson(home, [UPSTREAM]);
    plantClaude(home, 'claude');
    authFixture(home, SIGNED_OUT, 1);
    const r = run(home, ['account', 'check', '--id', 'claude']);
    expect(r.code, r.stderr).toBe(0);
    const h = oneObject(r)['health'] as Record<string, unknown>;
    expect(h['verdict']).toBe('auth-dead');
    expect(h['source']).toBe('auth-status');
    expect(h['verdict']).not.toBe('unknown');
    expect(h['measuredAt']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    // …and it spent NO inference to learn it: one local read, nothing else.
    expect(claudeArgv(home)).toEqual(['auth status --json']);
  });

  it('does not spend the probe on a lane that is already known dead', () => {
    // TWO ASSERTIONS, AND ONLY THE FIRST BITES IN THIS COMMIT. `auth-dead` is a
    // verdict, so the short-circuit fires and `source` stays `auth-status`;
    // delete the short-circuit and the stub probe overwrites the row, which is
    // observable here and now. The argv half cannot be red until Task 30 gives
    // `_acct_probe` a body — this task's stub runs no subprocess at all — so it
    // is written now, states that it is dormant, and becomes the real cost
    // assertion the moment the probe is real.
    const home = box('ccrc-account-check-noprobe-');
    seedRosterJson(home, [UPSTREAM]);
    plantClaude(home, 'claude');
    authFixture(home, SIGNED_OUT, 1);
    const h = oneObject(run(home, ['account', 'check', '--id', 'claude']))['health'] as
      Record<string, unknown>;
    expect(h['source'], 'the probe overwrote a verdict auth status had already given').toBe('auth-status');
    expect(claudeArgv(home).some((a) => a.includes('-p ')), 'the probe ran anyway').toBe(false);
  });

  it('a lane that CLAIMS to be signed in still goes on to the probe', () => {
    // spec:684-686, the half a short-circuit is easiest to get wrong: "Only a
    // lane that claims to be logged in goes on to the probe." `loggedIn: true`
    // is the reason to ask the expensive question, not the answer to it. So the
    // classifier answers exit 4 (a fact, no verdict), `ACCT_HEALTH` stays empty,
    // and the probe runs.
    const home = box('ccrc-account-check-signedin-');
    seedRosterJson(home, [UPSTREAM]);
    plantClaude(home, 'claude');
    authFixture(home, SIGNED_IN, 0);
    const r = run(home, ['account', 'check', '--id', 'claude']);
    expect(r.code, r.stderr).toBe(0);
    const j = oneObject(r);
    const h = j['health'] as Record<string, unknown>;
    expect(h['source'], 'a signed-in lane short-circuited on auth status').toBe('probe');
    // Task 29's probe is a stub, so the verdict itself is `unknown` here; what
    // this case pins is WHICH SOURCE answered. Task 30's table pins the rest.
    expect(h['verdict']).not.toBe('ok');
    const notes = (j['notes'] as string[]).join(' ');
    expect(notes).toContain('signed in');
    expect(notes).toContain('claudeai');
    // …and NOT the other fall-through's sentence: an older binary that cannot
    // answer `auth` at all is a different fact from a lane that answered.
    expect(notes).not.toContain('no parseable answer');
  });

  it('falls THROUGH to the probe when auth status gives no parseable answer', () => {
    // An older Claude Code has no `auth` subcommand at all. That is not
    // evidence about the credential, so the cheap check costs only itself —
    // and the answer SAYS the cheap question was asked and gave nothing.
    const home = box('ccrc-account-check-noauthsub-');
    seedRosterJson(home, [UPSTREAM]);
    plantClaude(home, 'claude');
    authFixture(home, 'error: unknown command "auth"\n', 1);
    const r = run(home, ['account', 'check', '--id', 'claude']);
    // THE EXIT CODE FIRST, so a fall-through that became a REFUSAL names itself
    // rather than arriving as a TypeError on an absent `health` key.
    expect(r.code, r.stderr).toBe(0);
    const j = oneObject(r);
    expect((j['health'] as Record<string, unknown>)['source']).toBe('probe');
    expect((j['notes'] as string[]).join(' ')).toContain('no parseable answer');
  });

  it('goes straight to the probe on a non-anthropic lane, and says nothing about auth status', () => {
    // `auth status` reads Claude Code's own credential store; an OpenRouter
    // lane authenticates through the settings env block (spec:687-689).
    const home = box('ccrc-account-check-openrouter-');
    seedRosterJson(home, [UPSTREAM, OPENROUTER_LANE]);
    plantClaude(home, 'orchard-api');
    authFixture(home, SIGNED_OUT, 1);
    const j = oneObject(run(home, ['account', 'check', '--id', 'orchard-api']));
    expect((j['health'] as Record<string, unknown>)['source']).toBe('probe');
    expect(j['notes']).toEqual([]);
    expect(claudeArgv(home).some((a) => a.startsWith('auth status')),
      'auth status ran on a lane whose credential it cannot see').toBe(false);
  });

  it('reports a timed-out auth status as timeout, not as unknown', () => {
    // No `linkReal` is needed and none exists in this file: unlike
    // `ccrc-doctor.test.ts`, this suite's `env()` KEEPS the real PATH
    // (`ghContainedEnv` PREPENDS the fixture bin rather than replacing PATH,
    // ccdWsHelpers.ts:185), so `_plat_timeout` finds the box's own `timeout`
    // and the stub finds `sleep`. `ccrc-cli.test.ts:80-86` says the same thing
    // about the same runner, from the other side.
    const home = box('ccrc-account-check-authslow-');
    seedRosterJson(home, [UPSTREAM]);
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    writeFileSync(join(home, '.local', 'bin', 'claude'), '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
    const j = oneObject(run(home, ['account', 'check', '--id', 'claude'], '',
      { CCRC_ACCOUNT_AUTH_TIMEOUT: '1' }));
    const h = j['health'] as Record<string, unknown>;
    expect(h['verdict']).toBe('timeout');
    expect(h['source']).toBe('auth-status');
    expect(String(h['detail'])).toContain('1s');
  });

  it('refuses an id the roster does not carry', () => {
    const home = box('ccrc-account-check-unknown-');
    seedRosterJson(home, [UPSTREAM]);
    const r = run(home, ['account', 'check', '--id', 'lab-dev0']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('unknown-id');
  });

  it('refuses --id present with nothing in it, rather than dropping it (D-2148)', () => {
    // A DEVIATION FROM THIS TASK'S PLAN SNIPPET, which carried no empty-flag
    // guard at all. `add`, `declare` and `credential` all carry one, and the
    // sentence downstream is the wrong one for what the operator did: without
    // this guard `--id ''` reaches `_acct_id_or_refuse`'s "an account id is
    // required: pass --id", telling somebody who typed an empty value that they
    // typed no flag. Same class, same exit code, a different mistake.
    const home = box('ccrc-account-check-emptyflag-');
    seedRosterJson(home, [UPSTREAM]);
    const r = run(home, ['account', 'check', '--id', '']);
    expect(r.code, r.stderr).toBe(2);
    const j = oneObject(r);
    expect(j['error']).toBe('missing-value');
    expect(String(j['detail'])).toContain('was given an empty value');
    // AND THE OTHER GUARD ON THE SAME FLAG, which is a different sentence for a
    // different mistake: nothing followed `--id` at all. Under `set -u` its
    // deletion is not a wrong answer but an `unbound variable` on stderr with
    // NO JSON on stdout — the one thing this verb's contract forbids.
    const none = run(home, ['account', 'check', '--id']);
    expect(none.code, none.stderr).toBe(2);
    const nj = oneObject(none);
    expect(nj['error']).toBe('missing-value');
    expect(String(nj['detail'])).toContain('nothing followed it');
  });

  it('an account-op.mjs with no `health` op is a refusal WITH a body (D-2051)', () => {
    // THE SECOND DEVIATION FROM THE PLAN SNIPPET, which spelled this call as
    // `_acct_node health … || exit $?`. `_acct_add`'s own tail already argues
    // the general case (ccd/ccrc:4917-4919): "Bare `_acct_node` will not do
    // either — a half-updated box … answers exit 2 with an EMPTY body, and that
    // is the seam this whole cluster exists to close." Measured with the bare
    // call: exit 2 and stdout empty, so `oneObject` fails on a verb whose whole
    // contract is one JSON object. `_acct_answer` is the right re-emit here and
    // not at `added`'s address, because its hard-coded "Nothing was written."
    // clause is TRUE of `check`: this verb reads and never writes.
    const home = staleAtBox('ccrc-account-check-stale-health-', 'health');
    seedRosterJson(home, [UPSTREAM]);
    plantClaude(home, 'claude');
    authFixture(home, SIGNED_OUT, 1);
    const r = run(home, ['account', 'check', '--id', 'claude']);
    expect(r.code, r.stderr).toBe(1);
    const j = oneObject(r);
    expect(j['error']).toBe('no-answer');
    expect(String(j['detail'])).toContain('answer to \'health\'');
    expect(String(j['detail'])).toContain('exited 2');
    expect(String(j['detail'])).toMatch(/Nothing was written\.$/);
  });

  it('a generated lane that names no provider is an anthropic lane (§4.1)', () => {
    // THE ABSENCE-PERMITTING RULE, MEASURED. `_acct_check`'s guard is on the
    // PROVIDER, and the provider for this entry is decided by `lane`'s
    // `e['provider'] ?? (kind === 'external' ? null : 'anthropic')`. The
    // openrouter case above proves the guard refuses a non-anthropic lane; this
    // proves what an ABSENT provider resolves to, which is the half the comment
    // asserts and no fixture reached.
    const home = box('ccrc-account-check-noprov-');
    seedRosterJson(home, [UPSTREAM, NO_PROVIDER_LANE]);
    plantClaude(home, 'alt-max');
    authFixture(home, SIGNED_OUT, 1);
    const j = oneObject(run(home, ['account', 'check', '--id', 'alt-max']));
    const h = j['health'] as Record<string, unknown>;
    expect(h['source'], 'a lane with no provider was treated as non-anthropic').toBe('auth-status');
    expect(h['verdict']).toBe('auth-dead');
    expect(claudeArgv(home)).toEqual(['auth status --json']);
  });

  it('an external lane is never asked either, and it arrives by the other route', () => {
    const home = box('ccrc-account-check-external-');
    seedRosterJson(home, [UPSTREAM, EXTERNAL_LANE]);
    plantClaude(home, 'gpt');
    authFixture(home, SIGNED_OUT, 1);
    const j = oneObject(run(home, ['account', 'check', '--id', 'gpt']));
    expect((j['health'] as Record<string, unknown>)['source']).toBe('probe');
    expect(j['notes']).toEqual([]);
    // THIS ASSERTION CHANGED AT TASK 30, AND THE OLD ONE WAS TRUE ONLY BECAUSE
    // THE PROBE WAS A STUB. It read `toEqual([])` under the label "somebody
    // else's launcher was run", which is a claim §8 contradicts outright: the
    // probe is *one probe for every provider*, the lane's own wrapper answering
    // `-p`, and the spec says so about this exact lane kind — "the `openai`
    // lane's credential is the launcher's … goes straight to the probe", and
    // "for `openai` the probe goes through the launcher exactly the same way
    // (it lazily starts the stack)" (spec:420, :687-689). So an external
    // launcher IS run here, deliberately and by ruling; what the fixture keeps
    // proving is the half this case is named for — `auth status` was never
    // asked of a lane whose credential Claude Code's own store cannot see.
    expect(claudeArgv(home)).toEqual(
      ['-p Reply with the single word ok. --output-format json --max-turns 1']);
    expect(claudeArgv(home).some((a) => a.startsWith('auth status')),
      'auth status ran on a lane whose credential store ccrc cannot read').toBe(false);
  });

  it('parseable JSON that names no loggedIn field IS a verdict, and stops there', () => {
    // THE THIRD ARM OF THE CLASSIFIER, and the one the exit-3 design turns on:
    // something ANSWERED and had no opinion, which is not the same as nothing
    // answering. So it is a row (`unknown`, source `auth-status`) rather than a
    // deferral — and because a row is a verdict, the short-circuit fires and the
    // probe is not spent. Told apart from the probe stub's own `unknown` by
    // `source` alone, which is why that field is on the row at all.
    const home = box('ccrc-account-check-noloop-');
    seedRosterJson(home, [UPSTREAM]);
    plantClaude(home, 'claude');
    authFixture(home, '{"apiProvider":"firstParty"}\n', 0);
    const j = oneObject(run(home, ['account', 'check', '--id', 'claude']));
    const h = j['health'] as Record<string, unknown>;
    expect(h['verdict']).toBe('unknown');
    expect(h['source'], 'a verdict from auth status fell through to the probe').toBe('auth-status');
    expect(String(h['detail'])).toContain('no loggedIn field');
    expect(j['notes']).toEqual([]);
  });

  it('a classifier that cannot run is classify-failed, on BOTH halves of the verb', () => {
    // D-2163: two shipped guards — `_acct_auth_status`'s `[ -n "$row" ]` and
    // `_acct_probe`'s `||` — and nothing reached either. The input that does is
    // an `account-op.mjs` with no `classify` op: it exits 2 with an EMPTY
    // stdout, which is neither 3 nor 4 and carries no envelope to re-emit. Both
    // lanes are driven on ONE box because the two halves are reached by
    // different roads: the anthropic lane refuses inside the cheap question,
    // the openrouter lane inside the probe it fell straight through to.
    const home = staleAtBox('ccrc-account-check-stale-classify-', 'classify');
    seedRosterJson(home, [UPSTREAM, OPENROUTER_LANE]);
    plantClaude(home, 'claude');
    authFixture(home, SIGNED_OUT, 1);
    // THE TWO SENTENCES CONVERGED AT TASK 30, and that is the fix rather than a
    // regression: the probe's arm used to fold every non-zero into "the health
    // classifier could not run" (D-2223 F9), so it said the same thing about a
    // classifier that exited 2 and one that exited 126. Both halves now name the
    // code, and they are still told apart — by the account id each carries, and
    // by the clause about what the run left behind, which only the probe's has.
    for (const [id, half] of [['claude', 'exited 2 without printing anything'],
      ['orchard-api', 'exited 2 without printing anything']] as const) {
      const r = run(home, ['account', 'check', '--id', id]);
      expect(r.code, `${id}: ${r.stderr}`).toBe(1);
      const j = oneObject(r);
      expect(j['error']).toBe('classify-failed');
      expect(String(j['detail'])).toContain(half);
      expect(String(j['detail'])).toContain(id);
    }
  });

  it('the knob is deleted by BOTH runners, so the answer never depends on the shell', () => {
    // `ccrc doctor` takes no arguments (ccd/ccrc:2000), so a verb's knob is an
    // env var — and an env var this suite does not delete is one an operator's
    // exported shell can set. Two files carry the list; this reads both.
    //
    // IT SCANS FOR THE DELETION LOOP, NOT FOR THE NAME — a deviation from this
    // task's plan snippet, which asserted `src.toContain('CCRC_ACCOUNT_AUTH_
    // TIMEOUT')` over BOTH files. That is vacuous for the second one: this very
    // assertion spells the knob, so `ccrc-account.test.ts` contains it whether
    // or not anything deletes it, and the half of the claim that matters here
    // went unmeasured. Measured with the name removed from `env()`'s array
    // only: the snippet's form stayed GREEN.
    //
    // BOTH KNOBS, ONE SCAN. Task 30 adds `CCRC_ACCOUNT_PROBE_TIMEOUT`, whose
    // default is a SIXTY-SECOND bound on a billed request: an exported copy of
    // it in a developer's shell would not merely change an answer here, it
    // would decide how long this suite waits for one.
    const deletes = (k: string) =>
      new RegExp(`for \\(const k of \\[[^\\]]*'${k}'[^\\]]*\\]\\)\\s*delete`);
    const cli = readFileSync(join(REPO, 'server', 'test', 'ccrc-cli.test.ts'), 'utf8');
    const self = readFileSync(join(REPO, 'server', 'test', 'ccrc-account.test.ts'), 'utf8');
    for (const [name, src] of [['ccrc-cli.test.ts', cli], ['ccrc-account.test.ts', self]] as const) {
      for (const k of ['CCRC_ACCOUNT_AUTH_TIMEOUT', 'CCRC_ACCOUNT_PROBE_TIMEOUT']) {
        expect(deletes(k).test(src), `${name} has no deletion array carrying `
          + `${k}, so this suite's answer depends on the `
          + 'developer\'s exported shell').toBe(true);
      }
    }
  });
});

// ── REVIEW ROUND 2: the four seams the round-1 measurements left open ──────
// D-2220 (the discarded exit code), D-2221 (the knob that disables its own
// deadline), D-2222 (the unbounded note on argv) and D-2223 F5-F8. Every case
// below drives the SHIPPED verb end to end; the two that cannot be reached
// through argv say so and name the road they take instead.

/** A recursive listing of the fixture HOME: relative path, kind, and for a file
 *  its exact bytes. It does NOT descend through a symlink, which is not a
 *  detail — `box()` symlinks `<home>/ccrc/deploy` and `<home>/ccrc/shared` at
 *  the real repository, so a walker that followed them would hash this whole
 *  tree and time out. Symlinks are recorded by TARGET, so a run that retargeted
 *  one is still caught. */
function snapshotHome(home: string): string[] {
  const rows: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const d of readdirSync(dir, { withFileTypes: true }).sort(
      (a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(dir, d.name);
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isSymbolicLink()) { rows.push(`L ${r} -> ${lstatSync(p).size}`); continue; }
      if (d.isDirectory()) { rows.push(`D ${r}`); walk(p, r); continue; }
      rows.push(`F ${r} ${readFileSync(p).toString('base64')}`);
    }
  };
  walk(home, '');
  return rows;
}

/** `ccd/ccrc` SOURCED rather than run, so a helper can be called twice in one
 *  process. Its last block is guarded by
 *  `[[ "${BASH_SOURCE[0]}" == "${0}" ]]` (ccd/ccrc:8991), so sourcing defines
 *  every function and parses no argv — the only way to reach a defect whose
 *  whole shape is "the second call sees the first call's variable", which one
 *  process per invocation can never show. */
function sourceRun(home: string, script: string,
  extraEnv: NodeJS.ProcessEnv = {}): Result {
  const r = spawnSync(BASH, ['-c', `. ${JSON.stringify(ccrcIn(home))}\n${script}\n`],
    { env: { ...env(home), ...extraEnv }, encoding: 'utf8', input: '' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('ccrc account check: why there was no verdict, and what bounds the answer', () => {
  it('names each reason auth status produced no verdict, and never blames a launcher that never ran (D-2220)', () => {
    // FIVE CONDITIONS SHARED ONE SENTENCE and four of them were false. `--exit
    // "$rc"` was already on the classifier's argv and read by nothing; the
    // triage is `_acct_no_answer`'s (ccd/ccrc:3916-3927), one `cause` per
    // branch, because these codes are the ones timeout(1) and bash hand back.
    //
    // EVERY ROW STILL ENDS AT THE PROBE — the routing did not change, the
    // sentence did — so each asserts `source: 'probe'` as well as its own words.
    const cases: Array<[string, (home: string) => void, string, string]> = [
      ['absent', () => { /* no launcher at all: timeout(1) exits 127 */ },
        'there is no launcher at', 'ccrc wrappers'],
      ['not-executable', (home) => {
        mkdirSync(join(home, '.local', 'bin'), { recursive: true });
        writeFileSync(join(home, '.local', 'bin', 'claude'),
          '#!/bin/sh\necho \'{"loggedIn":false}\'\n', { mode: 0o644 });
      }, 'could not be executed', 'mode bits'],
      ['killed', (home) => {
        mkdirSync(join(home, '.local', 'bin'), { recursive: true });
        writeFileSync(join(home, '.local', 'bin', 'claude'),
          '#!/bin/sh\nkill -9 $$\n', { mode: 0o755 });
      }, 'was KILLED rather than', 'signal 9'],
      ['timeout-refused', (home) => {
        plantClaude(home, 'claude');
        authFixture(home, SIGNED_OUT, 1);
        // The knob can no longer produce this: D-2221's validator refuses a
        // value timeout(1) would reject, BEFORE the call. What is left is
        // timeout(1) failing for one of its OWN reasons, which is the condition
        // GNU documents 125 for — stood in for by a shim on the fixture PATH,
        // which `ghContainedEnv` PREPENDS (ccdWsHelpers.ts:185) so it wins over
        // the box's real coreutils. Without this the branch would ship
        // unmeasured, which is the thing this wave is counting.
        writeFileSync(join(home, '.local', 'bin', 'timeout'),
          '#!/bin/sh\nexit 125\n', { mode: 0o755 });
      }, 'timeout(1) refused to run', 'command -v timeout gtimeout'],
    ];
    for (const [name, plant, says, alsoSays] of cases) {
      const home = box(`ccrc-account-check-why-${name}-`);
      seedRosterJson(home, [UPSTREAM]);
      plant(home);
      const r = run(home, ['account', 'check', '--id', 'claude']);
      expect(r.code, `${name}: ${r.stderr}`).toBe(0);
      const j = oneObject(r);
      expect((j['health'] as Record<string, unknown>)['source'], name).toBe('probe');
      const notes = (j['notes'] as string[]).join(' ');
      expect(notes, name).toContain(says);
      expect(notes, name).toContain(alsoSays);
      // THE FALSE SENTENCE, ABSENT. This is the half that bites: a lane nobody
      // could ask reported as a lane that answered badly sends an operator to
      // read a launcher that is not there.
      expect(notes, `${name} still says the launcher answered badly`)
        .not.toContain('no parseable answer');
    }
    // …and the ONE condition the old sentence was true about keeps it: a
    // launcher that ran, answered, and said something unparseable.
    const ok = box('ccrc-account-check-why-usage-');
    seedRosterJson(ok, [UPSTREAM]);
    plantClaude(ok, 'claude');
    authFixture(ok, 'error: unknown command "auth"\n', 1);
    expect((oneObject(run(ok, ['account', 'check', '--id', 'claude']))['notes'] as string[])
      .join(' ')).toContain('no parseable answer');
  });

  it('refuses a deadline it cannot honour, rather than reporting the consequence as a fact about the launcher (D-2221)', () => {
    // MEASURED ON THIS BOX (GNU coreutils 9.4): `timeout 0 sleep 2` waits the
    // full two seconds and exits 0 — the single value an operator types to mean
    // "do not wait" means "wait forever" — while `_plat_timeout`'s bash
    // fallback runs `sleep 0`, stamps and kills, i.e. 124 instantly. `abc`,
    // `-1`, `5x` and `''` exit 125 without ever exec'ing the launcher, and
    // `99999999999999999999` is ACCEPTED and clamped (`timeout 1e20 sleep 1`
    // took 1005ms), which is zero's defect wearing more digits.
    const home = box('ccrc-account-check-knob-');
    seedRosterJson(home, [UPSTREAM]);
    plantClaude(home, 'claude');
    authFixture(home, SIGNED_OUT, 1);
    const REFUSED: Array<[string, string]> = [
      ['0', 'zero is refused rather than given a meaning'],
      ['00', 'zero is refused rather than given a meaning'],
      ['-1', 'not a whole number of seconds'],
      ['abc', 'not a whole number of seconds'],
      ['5x', 'not a whole number of seconds'],
      ['5s', 'not a whole number of seconds'],
      ['0.5', 'not a whole number of seconds'],
      ['1e9', 'not a whole number of seconds'],
      ['3601', 'above the 3600-second ceiling'],
      // THE VALUE THAT MAKES THE LENGTH GATE LOAD-BEARING. `[
      // 99999999999999999999 -gt 3600 ]` is not false — it is `integer
      // expression expected` and a non-zero `[`, so a cap written as the
      // comparison alone fails OPEN on exactly the input it exists to catch.
      ['99999999999999999999', 'above the 3600-second ceiling'],
    ];
    for (const [v, says] of REFUSED) {
      const r = run(home, ['account', 'check', '--id', 'claude'], '',
        { CCRC_ACCOUNT_AUTH_TIMEOUT: v });
      expect(r.code, `${JSON.stringify(v)}: ${r.stderr}`).toBe(2);
      const j = oneObject(r);
      expect(j['error'], JSON.stringify(v)).toBe('bad-timeout');
      expect(String(j['detail']), JSON.stringify(v)).toContain(says);
      expect(String(j['detail']), JSON.stringify(v)).toMatch(/Nothing was written\.$/);
      // AND IT REFUSED BEFORE ASKING. The whole point is that no fact about the
      // launcher is invented from a knob the operator typed wrong.
      expect(claudeArgv(home), `${v} ran the launcher anyway`).toEqual([]);
    }
    // …and every honourable spelling still answers, leading zeros included:
    // `${v#"${v%%[!0]*}"}` normalises them rather than `$(( 10#$v ))`, which
    // overflows silently on a 20-digit value.
    for (const v of ['1', '15', '0015', '3600']) {
      const r = run(home, ['account', 'check', '--id', 'claude'], '',
        { CCRC_ACCOUNT_AUTH_TIMEOUT: v });
      expect(r.code, `${v}: ${r.stderr}`).toBe(0);
      expect((oneObject(r)['health'] as Record<string, unknown>)['verdict'], v)
        .toBe('auth-dead');
    }
    // THE EMPTY KNOB IS THE DEFAULT, NOT A REFUSAL — and this corrects D-2221,
    // which listed `''` beside `abc` as a value that makes timeout(1) exit 125.
    // It does, but the knob never arrives empty: `: "${CCRC_ACCOUNT_AUTH_
    // TIMEOUT:=15}"` (ccd/ccrc:1074) is the `:=` form, which substitutes when
    // the variable is unset OR NULL, so `CCRC_ACCOUNT_AUTH_TIMEOUT=` in the
    // environment is already 15 by the time the validator can look at it.
    // Measured through the sourced file because that is the only way to read
    // the resolved deadline without waiting one out.
    const empty = sourceRun(home,
      '_acct_auth_deadline\nprintf %s "$ACCT_DEADLINE"',
      { CCRC_ACCOUNT_AUTH_TIMEOUT: '' });
    expect(empty.code, empty.stderr).toBe(0);
    expect(empty.stdout, 'an empty knob did not fall back to the default').toBe('15');

    // …and the normalised value is what the operator is shown on expiry, so
    // `0015` never reaches a sentence as "within 0015s".
    const slow = box('ccrc-account-check-knob-slow-');
    seedRosterJson(slow, [UPSTREAM]);
    mkdirSync(join(slow, '.local', 'bin'), { recursive: true });
    writeFileSync(join(slow, '.local', 'bin', 'claude'), '#!/bin/sh\nsleep 30\n',
      { mode: 0o755 });
    const h = oneObject(run(slow, ['account', 'check', '--id', 'claude'], '',
      { CCRC_ACCOUNT_AUTH_TIMEOUT: '01' }))['health'] as Record<string, unknown>;
    expect(h['verdict']).toBe('timeout');
    expect(String(h['detail'])).toContain('within 1s');
  });

  it('bounds a launcher-controlled note before it reaches argv (D-2222)', () => {
    // `classify` reads the auth-status BODY from stdin on purpose. The NOTE
    // derived from it went out as `--note "$n"` with no bound but the kernel's:
    // 100 000 bytes of `authMethod` rode through, 200 000 hit `Argument list
    // too long` (MAX_ARG_STRLEN = 131 072 for ONE argument), node exited 126,
    // and the verb answered `no-answer` with "Nothing in this tree is known to
    // exit 126 with an empty body" — a shrug about a lane it had measured.
    //
    // BOTH SIDES OF THE BOUNDARY ARE MEASURED, because a cap asserted only on
    // the huge input is a cap that could be `${n:0:0}`.
    const home = box('ccrc-account-check-notecap-');
    seedRosterJson(home, [UPSTREAM]);
    plantClaude(home, 'claude');
    authFixture(home, `${JSON.stringify({ loggedIn: true, authMethod: 'x'.repeat(200000) })}\n`, 0);
    const r = run(home, ['account', 'check', '--id', 'claude']);
    expect(r.code, r.stderr).toBe(0);
    const j = oneObject(r);
    const notes = j['notes'] as string[];
    expect(notes.length).toBe(1);
    const note = notes[0]!;
    expect(note, 'the note was not truncated at all').toContain(
      'this note was truncated by ccrc at 1024 characters');
    // 1024 kept + the marker, and nothing between. The exact length is the
    // assertion because "shorter than 200000" would pass for any cap at all.
    expect(note.length).toBe(1024 + '… (this note was truncated by ccrc at 1024 characters)'.length);
    expect(note.startsWith('the lane reports itself signed in (')).toBe(true);
    // The routing is untouched: a signed-in claim is still only the
    // precondition for the probe.
    expect((j['health'] as Record<string, unknown>)['source']).toBe('probe');

    // THE OTHER SIDE: a note that fits is carried byte for byte, marker absent.
    const small = box('ccrc-account-check-notefits-');
    seedRosterJson(small, [UPSTREAM]);
    plantClaude(small, 'claude');
    authFixture(small, `${JSON.stringify({ loggedIn: true, authMethod: 'y'.repeat(500) })}\n`, 0);
    const kept = (oneObject(run(small, ['account', 'check', '--id', 'claude']))['notes'] as string[])[0]!;
    expect(kept).toContain('y'.repeat(500));
    expect(kept).not.toContain('truncated by ccrc');
    expect(kept.length).toBeLessThanOrEqual(1024);
  });

  it('a loggedIn field in a shape it cannot read is NOT a verdict, and says which shape arrived (D-2223 F5)', () => {
    // TWO DEFECTS IN ONE LINE. `{"loggedIn":"true"}` answered `auth status
    // named no loggedIn field` — the field IS named — and, worse, it answered
    // it as a ROW. A row is a verdict, so a launcher CLAIMING to be signed in
    // in a shape the classifier does not accept short-circuited and never
    // reached the probe, which is the exact opposite of the one-sided design
    // (spec:684-686). The sentence and the routing are one fix.
    //
    // THE SHAPE, NEVER THE VALUE: `shapeOf` returns one of six fixed words, so
    // this note's length does not depend on anything the launcher wrote.
    const SHAPES: Array<[string, string]> = [
      ['"true"', 'a string'], ['1', 'a number'], ['null', 'null'],
      ['[]', 'an array'], ['{}', 'an object'],
    ];
    for (const [lit, shape] of SHAPES) {
      const home = box(`ccrc-account-check-f5-${shape.replace(/\W/g, '')}-`);
      seedRosterJson(home, [UPSTREAM]);
      plantClaude(home, 'claude');
      authFixture(home, `{"loggedIn":${lit}}\n`, 0);
      const r = run(home, ['account', 'check', '--id', 'claude']);
      expect(r.code, `${lit}: ${r.stderr}`).toBe(0);
      const j = oneObject(r);
      expect((j['health'] as Record<string, unknown>)['source'],
        `${lit} short-circuited the probe`).toBe('probe');
      const notes = (j['notes'] as string[]).join(' ');
      expect(notes, lit).toContain(`named loggedIn as ${shape} rather than as true or false`);
      expect(notes, `${lit} still claims the field was not named`)
        .not.toContain('no loggedIn field');
    }
    // …and the ABSENT field keeps the sentence that is true of it, and keeps
    // being a verdict: something answered and had no opinion.
    const gone = box('ccrc-account-check-f5-absent-');
    seedRosterJson(gone, [UPSTREAM]);
    plantClaude(gone, 'claude');
    authFixture(gone, '{"apiProvider":"firstParty"}\n', 0);
    const g = oneObject(run(gone, ['account', 'check', '--id', 'claude']));
    expect((g['health'] as Record<string, unknown>)['detail']).toBe(
      'auth status named no loggedIn field');
    expect((g['health'] as Record<string, unknown>)['source']).toBe('auth-status');
    expect(g['notes']).toEqual([]);
  });

  it('writes nothing at all: the whole box, byte for byte, across a check (D-2223 F6)', () => {
    // `_acct_answer`'s hard-coded "Nothing was written." is the reason it is the
    // right re-emit for THIS verb and the wrong one for `added` — a claim the
    // shipped comment makes and no test measured. D-2163 applies to a claim you
    // keep, and the claim covers the SUBPROCESS too: on a real box `claude auth
    // status` writing into its own config dir would falsify it here, at Task 29.
    //
    // A SILENT LAUNCHER, NOT `plantClaude`. That one appends every argv to
    // `$HOME/claude-argv`, so the fixture's own instrumentation would be the
    // whole diff and the bracket would have to whitelist it — a whitelist that
    // would also hide the thing being looked for. This launcher writes nothing,
    // so the assertion is EQUALITY and not a subset.
    const home = box('ccrc-account-check-inert-');
    seedRosterJson(home, [UPSTREAM]);
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    writeFileSync(join(home, '.local', 'bin', 'claude'),
      `#!/bin/sh\nprintf '%s' ${JSON.stringify(SIGNED_OUT.trim())}\nexit 1\n`, { mode: 0o755 });
    // NO WARM-UP RUN, AND THAT IS THE WHOLE MECHANISM. The first draft took the
    // baseline AFTER a throwaway `check`, reasoning that `env()`'s poison files
    // had to arrive before it. They already have: `box()` calls `env(home)` at
    // construction for exactly this, and its own header says so. The warm-up
    // bought nothing and cost everything — MEASURED, because a mutation that
    // made `_acct_check` write `~/.ccrc/leaked`, and a second that made the
    // LAUNCHER write into its config dir, both SURVIVED it: the throwaway run
    // created the same file, so it was in the baseline and the diff was empty.
    // A bracket whose warm-up performs the write it is looking for measures
    // nothing at all.
    const before = snapshotHome(home);
    const r = run(home, ['account', 'check', '--id', 'claude']);
    expect(r.code, r.stderr).toBe(0);
    expect((oneObject(r)['health'] as Record<string, unknown>)['verdict']).toBe('auth-dead');
    expect(snapshotHome(home), 'ccrc account check wrote to the box').toEqual(before);
    // …and the listing is not vacuously empty: it saw the roster it read.
    expect(before.some((l) => l.startsWith('F .ccrc/accounts.json '))).toBe(true);
    expect(before.length).toBeGreaterThan(8);
  });

  it('carries limitsTouched on BOTH arms, and the wire says which (D-2223 F7)', () => {
    // Nothing in `server/test` named `limitsTouched` or `--limits-touched`
    // before this case: neither the shipped `false` nor the `true` arm was
    // asserted anywhere, and Task 30 makes it a wire field carrying a real fact.
    // The `true` arm has no bash caller yet — `_acct_probe` is a stub that only
    // ever sets `false` — so it is driven at the op, which is where the arm
    // lives (`a['limits-touched'] === 'true'`).
    const ROW = '{"verdict":"unknown","source":"probe"}';
    for (const [flag, want] of [['true', true], ['false', false]] as const) {
      const r = opRun(['health', '--id', 'claude', '--row', ROW, '--limits-touched', flag]);
      expect(r.code, `${flag}: ${r.stderr}`).toBe(0);
      expect(JSON.parse(r.stdout)['limitsTouched'], flag).toBe(want);
    }
    // ABSENT IS `false`, not undefined: the field is always on the wire, which
    // is what makes a reader's `=== true` safe in Task 30.
    const bare = opRun(['health', '--id', 'claude', '--row', ROW]);
    expect(bare.code, bare.stderr).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(JSON.parse(bare.stdout), 'limitsTouched'))
      .toBe(true);
    expect(JSON.parse(bare.stdout)['limitsTouched']).toBe(false);
    // …and the whole verb ships the `false` arm today, on the path that never
    // runs the probe at all.
    const home = box('ccrc-account-check-limits-');
    seedRosterJson(home, [UPSTREAM]);
    plantClaude(home, 'claude');
    authFixture(home, SIGNED_OUT, 1);
    expect(oneObject(run(home, ['account', 'check', '--id', 'claude']))['limitsTouched'])
      .toBe(false);
  });

  it('measures ~/.cc-limits on BOTH questions, and never attributes the change (D-2273, D-2274, D-2275, D-2276)', () => {
    // D-2273: `_acct_auth_status` runs the LANE'S OWN launcher with the lane's
    // own config dir — the identical mechanism the probe brackets, and
    // therefore the identical exposure to a statusline render — and nothing
    // stamped around it. The `false` on the wire was a MEASUREMENT on one path
    // and a bare ASSERTION on the other, and no reader could tell which it was
    // holding. Driven on the SHORT-CIRCUIT path deliberately: `auth status`
    // answers, the probe never runs, so anything measured here is the cheap
    // question's own.
    const home = box('ccrc-account-check-limits-auth-');
    seedRosterJson(home, [UPSTREAM]);
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    writeFileSync(join(home, '.local', 'bin', 'claude'), [
      '#!/bin/sh',
      'if [ -f "$HOME/fixture-auth-writes-limits" ]; then',
      '  mkdir -p "$HOME/.cc-limits"',
      '  printf \'{"five":7,"seven":0,"ts":1}\' > "$HOME/.cc-limits/claude.json"',
      'fi',
      `printf '%s' ${JSON.stringify(SIGNED_OUT.trim())}`,
      'exit 1',
    ].join('\n') + '\n', { mode: 0o755 });

    const quiet = oneObject(run(home, ['account', 'check', '--id', 'claude']));
    expect((quiet['health'] as Record<string, unknown>)['source'],
      'this case is not on the short-circuit path').toBe('auth-status');
    expect(quiet['limitsTouched'], 'a launcher that moved nothing was reported as moving it')
      .toBe(false);
    writeFileSync(join(home, 'fixture-auth-writes-limits'), '');
    const moved = oneObject(run(home, ['account', 'check', '--id', 'claude']));
    expect((moved['health'] as Record<string, unknown>)['source']).toBe('auth-status');
    expect(moved['limitsTouched'],
      'the cheap question ASSERTS false rather than measuring it').toBe(true);

    // D-2275: the refusal clause tells an operator the launcher's writes are
    // confined to the lane's config dir, while the flag — set before that
    // clause is composed and readable from inside it — may already say
    // otherwise. One conditional, three refusal sites, and both directions
    // measured because a clause that always says it is not a clause.
    const stands = (flag: string): string => {
      const r = sourceRun(home, `ACCT_LIMITS_TOUCHED=${flag}\n_acct_probe_stands`);
      expect(r.code, `${flag}: ${r.stderr}`).toBe(0);
      return r.stdout;
    };
    for (const flag of ['true', 'false']) {
      expect(stands(flag), flag).toContain('No account state was written');
    }
    expect(stands('false'), 'the clause claims a change nothing measured')
      .not.toContain('did change');
    const said = stands('true');
    expect(said, 'the clause still claims every write was confined to the config dir')
      .toContain('did change');
    expect(said).toContain('.cc-limits');
    // D-2274, at the one place this reaches an operator: `~/.cc-limits` is
    // SHARED account-scoped state and any of the box's live sessions can move
    // it inside the window, so the honest claim is CO-OCCURRENCE and never
    // authorship. No measuring harder can strengthen it.
    expect(said, 'the clause attributes a shared file\'s change to this run')
      .toContain('without claiming to be what caused it');
    expect(said).not.toMatch(/the probe wrote|this verb wrote|the launcher wrote to/);

    // D-2335: AND THE LEADING HALF IS CONDITIONED, NOT MERELY FOLLOWED BY A
    // RETRACTION. The first landing appended the qualifier to a confinement
    // claim that stayed ABSOLUTE, so the `true` case asserted that everything
    // the launcher wrote is still under the lane's config dir and then named
    // something outside it that moved — a sentence that asserts and retracts in
    // one breath. The `false` case keeps the flat claim, which is what makes
    // this a condition rather than a rename.
    const CONFINED = 'is still under that lane\'s config dir';
    expect(stands('false'), 'the flat claim is gone from the case that supports it')
      .toContain(CONFINED);
    expect(said, 'the true case still asserts confinement and then retracts it')
      .not.toContain(CONFINED);
    expect(said, 'the true case narrows nothing before naming the exception')
      .toContain('as far as this run could see');

    // D-2276, the banner that explains the stamp's own blind spot. It used to
    // argue the spot away with a field the stamp does not read: `ts` carries
    // the same whole-second resolution as the mtime and never enters the stamp
    // at all. The real bound is the write cadence, and it is stated instead.
    const src = readFileSync(CCRC_SRC, 'utf8');
    expect(src, 'the stamp banner still explains its blind spot with a fresher `ts`')
      .not.toContain('the statusline writes a fresh `ts`');
    expect(src, 'the stamp banner no longer states the bound it actually has')
      .toContain('SAME WHOLE SECOND');
  });

  it('says what a run that never reached the probe left behind, on BOTH its refusal paths (D-2333, D-2334)', () => {
    // D-2273 BRACKETED THE CHEAP QUESTION AND OPENED D-2275's OWN CLASS AT THE
    // TWIN ADDRESS. `auth status` runs the LANE'S OWN launcher with the lane's
    // own config dir — that is the whole argument for stamping around it — so a
    // run whose probe NEVER RAN can have moved the shared telemetry directory.
    // Both refusal paths on that arm still hard-coded "Nothing was written.":
    // `_acct_auth_status`'s classify-failed refusal, ~28 lines below the new
    // bracket, and `_acct_check`'s short-circuit clause. Their probe twin had
    // been given the situational helper in the same commit — two identical
    // sentences, one fixed.
    //
    // THE CONTRADICTION IS CONSTRUCTED, not argued: the same fixture answers
    // `limitsTouched: true` on the wire while the prose beside it says nothing
    // was written, with the file on disk. It takes two boxes because the clause
    // only ever reaches an operator through a REFUSAL, and the refusal is what
    // a stale `health` op stands in for — same roster, same launcher, one op
    // removed.
    const movingClaude = (home: string): void => {
      mkdirSync(join(home, '.local', 'bin'), { recursive: true });
      writeFileSync(join(home, '.local', 'bin', 'claude'), [
        '#!/bin/sh',
        'if [ "$1" = auth ] && [ "$2" = status ]; then',
        '  mkdir -p "$HOME/.cc-limits"',
        '  printf \'{"five":7,"seven":0,"ts":1}\' > "$HOME/.cc-limits/claude.json"',
        '  cat "$HOME/fixture-auth-out"',
        '  IFS= read -r rc < "$HOME/fixture-auth-rc"; exit "$rc"',
        'fi',
        'echo "fixture claude: unexpected argv: $*" >&2; exit 90',
      ].join('\n') + '\n', { mode: 0o755 });
    };
    const MOVED = 'One thing did change while the question was being asked';

    // THE HELPER ITSELF, BOTH DIRECTIONS — a clause that always says it is not
    // a clause. The `false` case is also what pins the sentence the rest of the
    // suite still expects verbatim on this path.
    const quiet = box('ccrc-account-quick-stands-');
    for (const [flag, want] of [['false', false], ['true', true]] as const) {
      const r = sourceRun(quiet, `ACCT_LIMITS_TOUCHED=${flag}\n_acct_quick_stands`);
      expect(r.code, `${flag}: ${r.stderr}`).toBe(0);
      expect(r.stdout.startsWith('Nothing was written.'), flag).toBe(true);
      expect(r.stdout.includes(MOVED), flag).toBe(want);
      expect(r.stdout.includes('.cc-limits'), flag).toBe(want);
    }

    // ── THE SHORT-CIRCUIT PATH ────────────────────────────────────────────
    // An anthropic lane whose `auth status` answers a VERDICT never reaches the
    // probe at all, and the launcher that answered it moved the stamp.
    const wire = box('ccrc-account-quick-wire-');
    seedRosterJson(wire, [UPSTREAM]);
    movingClaude(wire);
    authFixture(wire, SIGNED_OUT, 1);
    const w = oneObject(run(wire, ['account', 'check', '--id', 'claude']));
    expect((w['health'] as Record<string, unknown>)['verdict'],
      'the fixture did not take the short-circuit path').toBe('auth-dead');
    expect(w['limitsTouched'], 'the cheap question measured nothing').toBe(true);
    expect(existsSync(join(wire, '.cc-limits', 'claude.json')),
      'the fixture launcher wrote no telemetry').toBe(true);

    const prose = staleAtBox('ccrc-account-quick-prose-', 'health');
    seedRosterJson(prose, [UPSTREAM]);
    movingClaude(prose);
    authFixture(prose, SIGNED_OUT, 1);
    const said = String(oneObject(run(prose, ['account', 'check', '--id', 'claude']))['detail']);
    expect(said, 'the short-circuit prose still says nothing was written').toContain(MOVED);
    expect(said).toContain('.cc-limits');
    expect(said, 'the clause attributes a shared file\'s change to this run')
      .toContain('without claiming to be what caused it');

    // THE CONTROL, on the identical box with a launcher that moves nothing: the
    // simple true sentence, and nothing appended. Without this the case would
    // be green about a clause that says the same thing always.
    const still = staleAtBox('ccrc-account-quick-still-', 'health');
    seedRosterJson(still, [UPSTREAM]);
    plantClaude(still, 'claude');
    authFixture(still, SIGNED_OUT, 1);
    expect(String(oneObject(run(still, ['account', 'check', '--id', 'claude']))['detail']))
      .toMatch(/Nothing was written\.$/);

    // ── THE CLASSIFY-FAILED PATH, the twin ~28 lines below the bracket ─────
    // Driven through a planted `account-op.mjs` whose auth-status arm exits
    // without writing, because bash builds that argv itself and cannot spell it
    // wrong — the build skew this file stands in for everywhere else.
    const wedged = classifierBox('ccrc-account-quick-classify-',
      '  process.exitCode = 7;', 'auth-status');
    seedRosterJson(wedged, [UPSTREAM]);
    movingClaude(wedged);
    authFixture(wedged, SIGNED_OUT, 1);
    const c = run(wedged, ['account', 'check', '--id', 'claude']);
    expect(c.code, c.stderr).toBe(1);
    const cj = oneObject(c);
    expect(cj['error']).toBe('classify-failed');
    expect(String(cj['detail']), 'the classify-failed twin still hard-codes its clause')
      .toContain(MOVED);

    // …and the same arm with a launcher that moved nothing says the flat thing.
    const wedgedQuiet = classifierBox('ccrc-account-quick-classify-quiet-',
      '  process.exitCode = 7;', 'auth-status');
    seedRosterJson(wedgedQuiet, [UPSTREAM]);
    plantClaude(wedgedQuiet, 'claude');
    authFixture(wedgedQuiet, SIGNED_OUT, 1);
    expect(String(oneObject(run(wedgedQuiet, ['account', 'check', '--id', 'claude']))['detail']))
      .toMatch(/Nothing was written\.$/);

    // ── D-2334, THE COMMENT THAT TOLD A READER NOT TO MAKE THIS REPAIR ─────
    // `_acct_check`'s own banner said a verdict from the cheap question means
    // the run "wrote nothing at all", which D-2273 falsified in the commit that
    // wrote the bracket. It is the justification a reader of the hard-coded
    // clause would find, so it is load-bearing rather than decorative. Same
    // shape as this file's D-2276 banner check: the false sentence gone, and
    // the correction recorded where that reader is standing.
    const src = readFileSync(CCRC_SRC, 'utf8');
    expect(src, 'the short-circuit banner still claims the run wrote nothing at all')
      .not.toContain('wrote nothing at all');
    expect(src, 'the correction is not recorded beside the sentence it corrects')
      .toContain('D-2334');
  });

  it('resets ACCT_LIMITS_TOUCHED before every check, not only inside the probe (D-2223 F8)', () => {
    // THE ONE DEFECT IN THIS ROUND THAT ONE PROCESS PER INVOCATION CANNOT SHOW.
    // `_acct_check` reset `ACCT_HEALTH` and `ACCT_NOTES` and not this, so on the
    // SHORT-CIRCUIT path — a verdict from `auth status`, no probe, and
    // `_acct_probe` is the only other resetter — the value on the wire came from
    // whatever the variable held before. A fresh process always holds the file
    // scope's `false`, which is why no `run()` can red it; sourcing can, and
    // that is the shape the moment anything loops `check` over a roster.
    const home = box('ccrc-account-check-reset-');
    seedRosterJson(home, [UPSTREAM]);
    plantClaude(home, 'claude');
    authFixture(home, SIGNED_OUT, 1);
    const r = sourceRun(home, 'ACCT_LIMITS_TOUCHED=true\n_acct_check --id claude');
    expect(r.code, r.stderr).toBe(0);
    const j = oneObject(r);
    expect((j['health'] as Record<string, unknown>)['verdict'],
      'the sourced call did not reach the short-circuit path').toBe('auth-dead');
    expect(j['limitsTouched'],
      'a stale ACCT_LIMITS_TOUCHED reached the wire').toBe(false);
    // AND THE HARNESS IS NOT VACUOUS: the assignment the case makes really does
    // reach the code under test. It is proved in the OPPOSITE direction now,
    // and the reason is D-2273. `_acct_probe` used to carry a second reset of
    // its own, and this half drove the variable through it; once
    // `_acct_auth_status` began bracketing its launcher too, that second reset
    // became a CLOBBER — an anthropic lane whose cheap question moved the stamp
    // and then deferred to the probe would have the fact erased on the way
    // past. So the reset is `_acct_check`'s alone and both brackets only raise,
    // which makes `_acct_probe` the right place to show the harness working: a
    // pre-set `true`, a launcher that moves nothing, and the value SURVIVES.
    const p = sourceRun(home, 'ACCT_LIMITS_TOUCHED=true\n_acct_probe claude\n'
      + 'printf %s "$ACCT_LIMITS_TOUCHED"');
    expect(p.stdout.endsWith('true'),
      `_acct_probe cleared a flag its sibling had raised — stdout ${JSON.stringify(p.stdout)}`
      + `, stderr ${JSON.stringify(p.stderr)}`).toBe(true);
  });
});

// ── `check`, HALF TWO: THE QUESTION THAT COSTS A REQUEST ───────────────────
// NOTHING IN THIS TREE HAD EVER RUN `claude -p` BEFORE THIS COMMIT, so every
// case below states its shape rather than inheriting one. Four properties are
// measured here and nowhere else: the retry knob is off, the deadline goes
// through `_plat_timeout` (never the bare GNU spelling, which is not in the BSD
// userland and which `macos-platform.test.ts` refuses outright), the cwd is a
// dedicated scratch directory so `-p`'s transcript never lands in a real
// project's history, and `~/.cc-limits` is STAMPED across the call because the
// lane's own statusline can write into the placer's input while the probe runs.

/** A `claude` that answers `-p` from fixture files: stdout from
 *  `<home>/fixture-probe-out`, exit code from `<home>/fixture-probe-rc`, and —
 *  when `<home>/fixture-probe-writes-limits` exists — the statusline's own side
 *  effect, so the stamp measurement has something to see.
 *
 *  `auth` IS ANSWERED `loggedIn:true`, AND ON EVERY CALL SITE HERE THAT ARM IS
 *  BELT AND BRACES (D-2211): all of them plant this on `orchard-api`, an
 *  openrouter lane, where `_acct_check`'s provider gate means `auth status` is
 *  never asked at all. It is kept because the arm is what would let this helper
 *  be planted on an ANTHROPIC lane, and a launcher that answered `-p` to an
 *  `auth status` argv would make that lane's fixture silently wrong — but note
 *  that such a call site also gains a NOTE, so any `expect(notes).toEqual([])`
 *  beside it is already false.
 *
 *  `exec sleep`, NOT `sleep`, in the slow arm — a DEVIATION from this task's
 *  plan snippet, and measured rather than stylistic. `timeout` signals the
 *  child it started and nothing else, so a `sleep` running as a GRANDCHILD
 *  survives the kill still holding the pipe that `$( )` reads: the shell blocks
 *  for the full 30s waiting for EOF and the deadline test measures 30 seconds
 *  instead of one. `exec` makes the sleeper the process the deadline kills. */
function plantProbe(home: string, id: string): void {
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(home, '.local', 'bin', id), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/claude-argv"',
    'printf \'%s\\n\' "retries=${CLAUDE_CODE_MAX_RETRIES-unset} cwd=$PWD" >> "$HOME/claude-env"',
    'if [ "$1" = auth ]; then echo \'{"loggedIn":true,"authMethod":"claudeai"}\'; exit 0; fi',
    'if [ -f "$HOME/fixture-probe-writes-limits" ]; then',
    '  mkdir -p "$HOME/.cc-limits"',
    `  printf '{"five":7,"seven":0,"ts":1}' > "$HOME/.cc-limits/${id}.json"`,
    'fi',
    // THE SECOND LIMITS ARM EXISTS FOR THE STAMP'S *SIZE* HALF. It rewrites the
    // file to a different LENGTH and then copies the mtime back off the gate
    // file, which the caller has already set to the file's own original mtime —
    // so the whole-second mtime is byte-identical across the probe and the only
    // thing that moved is the byte count. That is the one shape `_plat_mtime`
    // alone cannot decide, and it is the shape a same-second rewrite really has.
    'if [ -f "$HOME/fixture-probe-limits-samesecond" ]; then',
    '  mkdir -p "$HOME/.cc-limits"',
    `  printf '{"five":7,"seven":0,"ts":1,"pad":"0123456789"}' > "$HOME/.cc-limits/${id}.json"`,
    `  touch -r "$HOME/fixture-probe-limits-samesecond" "$HOME/.cc-limits/${id}.json"`,
    'fi',
    'if [ -f "$HOME/fixture-probe-sleep" ]; then exec sleep 30; fi',
    '[ -f "$HOME/fixture-probe-out" ] && cat "$HOME/fixture-probe-out"',
    'if [ -f "$HOME/fixture-probe-rc" ]; then IFS= read -r rc < "$HOME/fixture-probe-rc"; exit "$rc"; fi',
    'exit 0',
  ].join('\n') + '\n', { mode: 0o755 });
}

const probeFixture = (home: string, body: unknown, rc: number): void => {
  writeFileSync(join(home, 'fixture-probe-out'),
    typeof body === 'string' ? body : `${JSON.stringify(body)}\n`);
  writeFileSync(join(home, 'fixture-probe-rc'), `${rc}\n`);
};

/** The four recorded shapes of §8's table (measured on 2.1.261, spec:654-660).
 *  `subtype` is `'success'` on every failure and is deliberately present in
 *  each fixture: a classifier that read it would agree with the wrong one. */
const PROBE_OK = { type: 'result', subtype: 'success', is_error: false,
  result: 'ok', total_cost_usd: 0.0004 };
const PROBE_401 = { type: 'result', subtype: 'success', is_error: true,
  terminal_reason: 'api_error', api_error_status: 401,
  result: 'Not logged in · Please run /login', total_cost_usd: 0 };
const PROBE_REFUSED = { type: 'result', subtype: 'success', is_error: true,
  terminal_reason: 'api_error', api_error_status: null,
  result: 'API Error: Connection refused', total_cost_usd: 0 };
const PROBE_WEIRD = { type: 'result', subtype: 'success', is_error: true,
  terminal_reason: 'max_turns', api_error_status: null, result: 'gave up', total_cost_usd: 0 };

/** A box whose `account-op.mjs` answers `classify --source probe` however a case
 *  needs and delegates every other op to the real file — `staleAtBox`'s shape
 *  (:2377) for a different skew. It exists because `_acct_probe`'s classifier
 *  arms branch on codes bash itself can never produce: it builds a fixed argv,
 *  so `classify` cannot be spelled wrong from there, and the SHIPPED classifier
 *  never defers on `--source probe` (pinned below). The condition these stand
 *  for is the one this file guards everywhere else — an `account-op.mjs` that is
 *  not the same build as the `ccrc` calling it. */
function classifierBox(prefix: string, arm: string, source = 'probe'): string {
  const home = box(prefix);
  rmSync(join(home, 'ccrc', 'deploy'));   // the symlink into the real tree
  mkdirSync(join(home, 'ccrc', 'deploy'), { recursive: true });
  for (const f of readdirSync(join(REPO, 'deploy'))) {
    if (f === 'account-op.mjs') continue;
    symlinkSync(join(REPO, 'deploy', f), join(home, 'ccrc', 'deploy', f));
  }
  const real = JSON.stringify(join(REPO, 'deploy', 'account-op.mjs'));
  writeFileSync(join(home, 'ccrc', 'deploy', 'account-op.mjs'), [
    'const a = process.argv;',
    `if (a[2] === "classify" && a.includes(${JSON.stringify(source)})) {`,
    arm,
    '} else {',
    `  await import(${real});`,
    '}',
    '',
  ].join('\n'));
  return home;
}

describe('ccrc account check: the probe', () => {
  const probe = (home: string, extraEnv: NodeJS.ProcessEnv = {}) =>
    oneObject(run(home, ['account', 'check', '--id', 'orchard-api'], '', extraEnv));

  it.each([
    ['ok', PROBE_OK, 0],
    ['auth-dead', PROBE_401, 1],
    ['unreachable', PROBE_REFUSED, 1],
    ['unknown', PROBE_WEIRD, 1],
  ] as const)('classifies %s', (verdict, body, rc) => {
    const home = box(`ccrc-account-probe-${verdict}-`);
    seedRosterJson(home, [UPSTREAM, OPENROUTER_LANE]);
    plantProbe(home, 'orchard-api');
    probeFixture(home, body, rc);
    const h = probe(home)['health'] as Record<string, unknown>;
    expect(h['verdict']).toBe(verdict);
    expect(h['source']).toBe('probe');
  });

  it('triages the launcher\'s own exit code on the probe path too, for every lane (D-2268)', () => {
    // D-2220's defect, reopened at the expensive question. 127, 126, 125 and a
    // signal death are facts about THIS BOX; each arrived as
    // `the probe printed no JSON object (exit N)` with an EMPTY notes array — a
    // verdict about the lane for four conditions in which nothing about the lane
    // was measured. The sentence and its remedy already existed and already
    // reached anthropic lanes through `_acct_auth_status`; the provider gate is
    // what kept them from every other lane, so the lanes that got the triage
    // were precisely the ones that also had a second question to inherit it
    // from. Driven on an OPENROUTER lane for that reason: `auth status` is never
    // asked there at all, so every note below is the probe's own.
    const cases: Array<[string, (home: string) => void, string, string]> = [
      ['absent', () => { /* no launcher at all: the deadline shim reports 127 */ },
        'there is no launcher at', 'ccrc wrappers'],
      ['not-executable', (home) => {
        writeFileSync(join(home, '.local', 'bin', 'orchard-api'),
          '#!/bin/sh\necho \'{}\'\n', { mode: 0o644 });
      }, 'could not be executed', 'mode bits'],
      ['killed', (home) => {
        writeFileSync(join(home, '.local', 'bin', 'orchard-api'),
          '#!/bin/sh\nkill -9 $$\n', { mode: 0o755 });
      }, 'was KILLED rather than', 'signal 9'],
      ['deadline-refused', (home) => {
        plantProbe(home, 'orchard-api');
        probeFixture(home, PROBE_OK, 0);
        // The knob cannot produce a 125 any more — D-2221's validator refuses
        // a value the deadline shim would reject, before the launcher runs — so
        // what is left is the shim failing for one of its OWN reasons, stood in
        // for by a stub on the fixture PATH, which `ghContainedEnv` PREPENDS.
        writeFileSync(join(home, '.local', 'bin', 'timeout'),
          '#!/bin/sh\nexit 125\n', { mode: 0o755 });
      }, 'refused to run', 'command -v timeout gtimeout'],
    ];
    for (const [name, plant, says, alsoSays] of cases) {
      const home = box(`ccrc-account-probe-why-${name}-`);
      seedRosterJson(home, [UPSTREAM, OPENROUTER_LANE]);
      plant(home);
      const r = run(home, ['account', 'check', '--id', 'orchard-api']);
      expect(r.code, `${name}: ${r.stderr}`).toBe(0);
      const j = oneObject(r);
      expect((j['health'] as Record<string, unknown>)['source'], name).toBe('probe');
      const notes = (j['notes'] as string[]).join(' ');
      expect(notes, `${name}: no note at all`).not.toBe('');
      expect(notes, name).toContain(says);
      // THE REMEDY, which is the half an operator acts on: a verdict with no
      // next step is the shrug this deviation is about.
      //
      // AND `alsoSays` NAMES AN ACTION IN EVERY ROW NOW (D-2331). The 125 row
      // used to expect a slice of its own CAUSE sentence — "its own arguments
      // are wrong" — under a message reading *names no remedy*, which is an
      // expectation that cannot fail on the condition it is named for
      // (D-2209's family). It could not fail because there WAS no remedy in
      // that branch: exit 125 said what the deadline shim's argument error is
      // and stopped, while its three siblings each ended in something to do.
      // The branch now ends in a measurement of the box, and this row expects
      // that instead.
      expect(notes, `${name} names no remedy`).toContain(alsoSays);
      expect(notes, name).toContain('the probe');
      // AND THE CLOSING CLAUSE IS THE PROBE'S, NOT THE CHEAP QUESTION'S. The
      // probe has nothing below it, so `auth status`'s "the verdict below is
      // the probe's" would promise an answer that is never coming — which is
      // why the clause is a parameter and not a substitution.
      expect(notes, `${name} promises a verdict from below the last question`)
        .toContain('the LAST question about this account');
      expect(notes, `${name} carried the auth-status caller's clause`)
        .not.toContain('The verdict below is the probe\'s.');
      // THE ORDER, WHICH IS WHAT SURVIVES THE CAP (D-2330). `_acct_note_cap`
      // truncates from the RIGHT, so whatever a branch writes last is the first
      // thing a deep-HOME operator loses. The editorial clause — 221 characters
      // of "what the verdict beside this note is" — must therefore come AFTER
      // the action, in every branch that has one. Asserted on a shallow box,
      // where the whole note survives and the two can be compared; the deep
      // case below asserts the consequence.
      expect(notes.indexOf(alsoSays),
        `${name}: the editorial clause was written before the next step`)
        .toBeLessThan(notes.indexOf('the LAST question about this account'));
    }

    // THE CONTRAST, AND IT HOLDS BOTH CALL SITES IN ONE RUN. An ANTHROPIC lane
    // with no launcher fails the cheap question and the expensive one for the
    // same reason, so the answer carries TWO notes — and each names its own
    // question and its own closing clause. A triage written twice, or one whose
    // caller-specific halves were baked in, cannot produce this pair.
    const both = box('ccrc-account-probe-why-both-');
    seedRosterJson(both, [UPSTREAM]);
    const r = run(both, ['account', 'check', '--id', 'claude']);
    expect(r.code, r.stderr).toBe(0);
    const notes = oneObject(r)['notes'] as string[];
    expect(notes.length, notes.join(' | ')).toBe(2);
    expect(notes[0]!.startsWith('auth status was never asked:'), notes[0]).toBe(true);
    expect(notes[0]!).toContain('The verdict below is the probe\'s.');
    expect(notes[1]!.startsWith('the probe was never asked:'), notes[1]).toBe(true);
    expect(notes[1]!).toContain('the LAST question about this account');
  });

  it('keeps the REMEDY when the note cap bites, and loses the editorial clause instead (D-2330)', () => {
    // THE FIX FOR D-2268 CUT THE HEADROOM ON THE PATH THAT HAD NONE. Giving the
    // probe its own closing clause put 221 characters between the diagnosis and
    // the next step, and `_acct_note_cap` truncates from the RIGHT at 1024 — so
    // on a deep HOME the sentence an operator can ACT on was the first thing
    // dropped, and what survived was the half explaining what the verdict
    // beside it is. Before the reorder, MEASURED on a fixture HOME 772
    // characters deep: a 1078-character note, the marker present, and
    // "Run 'ccrc wrappers' to write the missing launcher." gone.
    //
    // A NOTE HERE IS HOME PLUS A CONSTANT, which is why the fixture has to be
    // deep and why the shallow control below is not enough on its own: at
    // tmpdir depth every ordering of this sentence looks identical, and that is
    // the input the first landing was written against. Real fleet paths are in
    // this range — the account id, the launcher directory and the home all ride
    // in the same sentence.
    const REMEDY = 'Run \'ccrc wrappers\' to write the missing launcher.';
    const CLAUSE = 'the LAST question about this account';
    const MARKER = '… (this note was truncated by ccrc at 1024 characters)';

    const deep = deepBox('ccrc-account-note-cap-deep-', 700);
    seedRosterJson(deep, [UPSTREAM, OPENROUTER_LANE]);   // no launcher: the probe sees 127
    const r = run(deep, ['account', 'check', '--id', 'orchard-api']);
    expect(r.code, r.stderr).toBe(0);
    const note = ((oneObject(r)['notes'] as string[]) ?? [])[0] ?? '';
    // THE CAP REALLY BIT, so what follows is a statement about truncation and
    // not about a note that happened to fit. Without this the case would be
    // green on any HOME at all.
    expect(note, `the cap never fired: ${note.length} characters`).toContain(MARKER);
    expect(note.length).toBe(1024 + MARKER.length);
    // …AND THE OPERATOR KEPT THE HALF THEY CAN ACT ON. This is the assertion
    // that reds if anyone puts the editorial clause back in front of the
    // remedy: at this depth the old order loses the whole 50-character remedy
    // and 31 characters of the clause besides.
    expect(note, 'the truncation ate the next step').toContain(REMEDY);
    // AND WHAT WAS DROPPED IS THE EDITORIAL TAIL, which is the other half of
    // the same claim — there is no depth at which the clause vanishes and the
    // remedy survives WHOLE, because the two are adjacent: the honest form is
    // that the cut lands inside the clause rather than inside the next step.
    expect(note, 'nothing was actually cut from the editorial clause')
      .not.toContain('rather than anything measured about the lane');

    // THE SHALLOW CONTROL, which is what makes the pair a discrimination rather
    // than a claim about one depth: the same lane on an ordinary HOME loses
    // nothing at all, so the deep case above is measuring the CAP and not a
    // sentence this branch simply never writes.
    const shallow = box('ccrc-account-note-cap-shallow-');
    seedRosterJson(shallow, [UPSTREAM, OPENROUTER_LANE]);
    const whole = ((oneObject(run(shallow, ['account', 'check', '--id', 'orchard-api']))[
      'notes'] as string[]) ?? [])[0] ?? '';
    expect(whole).not.toContain(MARKER);
    expect(whole).toContain(REMEDY);
    expect(whole).toContain(CLAUSE);
    expect(whole.indexOf(REMEDY), 'the remedy is written after the editorial clause')
      .toBeLessThan(whole.indexOf(CLAUSE));
  });

  it('bounds a launcher-controlled row detail AT THE SOURCE, in EVERY slot the factory covers (D-2266, D-2267, D-2328)', () => {
    // D-2222's class at a second address, and five slots wide: the 401 arm, the
    // `unreachable` arm, the `api_error` arm's interpolated status, the same
    // arm's text on a status that is neither 401 nor null, and the residual —
    // which needs no `api_error` block at all, so any non-zero exit carrying any
    // JSON object reaches it. MEASURED before the fix: a 200 000-character
    // `result` produced a 200 089-byte row, `--row` hit
    // `Argument list too long`, node exited 126, and the verb answered
    // `no-answer` about a lane whose billed request had already been spent and
    // ANSWERED. The whole point of the cap living in the row factory rather than
    // beside the note cap in bash is D-2267: a row is JSON the `health` op
    // parses, so a row clipped on its way to argv would fall to that parse's
    // catch and hand the op a NULL row — a silent wrong answer replacing a loud
    // E2BIG. Every case therefore asserts the VERDICT survived, not merely that
    // something short arrived.
    //
    // FIVE BODIES, BECAUSE ONE BODY MEASURED THE INSTANCE AND NOT THE RULE
    // (D-2328). The first landing pinned the 401 slot alone under a header
    // claiming one edit closes all five — and MEASURED, moving `capDetail` out
    // of the `row` factory into the 401 arm left the file at 248/248 green while
    // three of the other slots went straight back to `exit 1`, `no-answer` and
    // node refusing the argument list. That green mutation is disambiguated
    // rather than shrugged at: the same mutant reproduces the defect end to end
    // on the uncovered slots, so the guard was UNPINNED — not unreachable, and
    // not a mutation that failed to apply. A factory chosen for its generality
    // has to have its generality measured, which is one row per slot.
    const HUGE = 'x'.repeat(200000);
    const marker = '… (this detail was truncated by account-op at 1024 characters)';
    const SLOTS: Array<[string, unknown, string]> = [
      ['401', { ...PROBE_401, result: HUGE }, 'auth-dead'],
      ['unreachable', { ...PROBE_REFUSED, result: `API Error: Connection refused ${HUGE}` },
        'unreachable'],
      // The status itself, which is ANY JSON value: `=== 401` and `=== null`
      // both fall through, so a launcher can put a 200 000-character string
      // where a number belongs and it lands in the sentence.
      ['api_error_status', {
        type: 'result', subtype: 'success', is_error: true,
        terminal_reason: 'api_error', api_error_status: HUGE, result: 'nope',
        total_cost_usd: 0,
      }, 'unknown'],
      ['api_error text', { ...PROBE_401, api_error_status: 503, result: HUGE }, 'unknown'],
      // The widest slot of the five, and the one with no `api_error` block at
      // all: `is_error` need not even be true — any non-zero exit carrying any
      // JSON object arrives at the residual.
      ['residual', {
        type: 'result', subtype: 'success', is_error: true, terminal_reason: HUGE,
        total_cost_usd: 0,
      }, 'unknown'],
    ];
    for (const [name, body, verdict] of SLOTS) {
      const home = box(`ccrc-account-probe-rowcap-${name.replace(/[^a-z]+/g, '-')}-`);
      seedRosterJson(home, [UPSTREAM, OPENROUTER_LANE]);
      plantProbe(home, 'orchard-api');
      probeFixture(home, body, 1);
      const r = run(home, ['account', 'check', '--id', 'orchard-api']);
      expect(r.code, `${name}: ${r.stderr}`).toBe(0);
      const j = oneObject(r);
      expect(j['error'], `${name}: the verb shrugged instead of carrying the measurement it had`)
        .toBeUndefined();
      const h = j['health'] as Record<string, unknown>;
      expect(h['verdict'], `${name}: a real verdict was thrown away`).toBe(verdict);
      expect(h['source'], name).toBe('probe');
      const d = String(h['detail']);
      expect(d, `${name}: the detail was not truncated at all`).toContain(marker);
      // The EXACT length, because "shorter than 200000" would pass for any cap.
      expect(d.length, name).toBe(1024 + marker.length);
    }

    // THE OTHER SIDE OF THE BOUNDARY: a detail that fits is carried byte for
    // byte and carries no marker — a cap asserted only on the huge input is a
    // cap that could be `slice(0, 0)`.
    const small = box('ccrc-account-probe-rowfits-');
    seedRosterJson(small, [UPSTREAM, OPENROUTER_LANE]);
    plantProbe(small, 'orchard-api');
    probeFixture(small, { ...PROBE_401, result: 'z'.repeat(500) }, 1);
    const kept = String(((oneObject(run(small, ['account', 'check', '--id', 'orchard-api']))[
      'health'] as Record<string, unknown>)['detail']));
    expect(kept).toBe('z'.repeat(500));
  });

  it('never reads a subtype property', () => {
    // Every fixture above carries `subtype: 'success'`, including the failures,
    // so the four cases are the BEHAVIOURAL half of this claim. This is the
    // structural half, and it scans for a property ACCESS rather than for the
    // word — the word appears in this file's own prose, which is exactly why a
    // word scan would have to be argued away with a lookahead nobody maintains.
    const src = readFileSync(join(REPO, 'deploy', 'account-op.mjs'), 'utf8');
    expect(src, 'deploy/account-op.mjs reads a subtype property')
      .not.toMatch(/(?:\.|\[['"])subtype/);
  });

  it('runs bounded, with retries off, from ~/.ccrc/probe', () => {
    const home = box('ccrc-account-probe-argv-');
    seedRosterJson(home, [UPSTREAM, OPENROUTER_LANE]);
    plantProbe(home, 'orchard-api');
    probeFixture(home, PROBE_OK, 0);
    probe(home);
    expect(claudeArgv(home)).toContain(
      '-p Reply with the single word ok. --output-format json --max-turns 1');
    const env = readFileSync(join(home, 'claude-env'), 'utf8');
    expect(env).toContain('retries=0');
    // `realpathSync` IS A DEFENSIVE NO-OP, and the comment says so because a
    // false reason is a fact the next reader builds on. `mkTmp`
    // (tmpHelpers.ts:38-52) already resolves the HOME when it hands it out, and
    // bash sets `PWD` LOGICALLY — after `cd "$dir"` it is the spelling that was
    // passed, symlinks and all. So both sides are already resolved; this keeps
    // the assertion true if `mkTmp` ever stops resolving.
    expect(env).toContain(`cwd=${realpathSync(join(home, '.ccrc', 'probe'))}`);
    // --bare and CLAUDE_CODE_SIMPLE are never passed: bare mode reads neither
    // the settings env block nor the OAuth token (spec:662-664).
    expect(claudeArgv(home).join(' ')).not.toContain('--bare');
  });

  it('answers timeout on the bound, through _plat_timeout rather than bare timeout', () => {
    const home = box('ccrc-account-probe-timeout-');
    seedRosterJson(home, [UPSTREAM, OPENROUTER_LANE]);
    plantProbe(home, 'orchard-api');
    writeFileSync(join(home, 'fixture-probe-sleep'), '');
    const h = probe(home, { CCRC_ACCOUNT_PROBE_TIMEOUT: '1' })['health'] as Record<string, unknown>;
    expect(h['verdict']).toBe('timeout');
    expect(String(h['detail'])).toContain('1s');
  });

  it('refuses when the scratch cwd cannot be created, BEFORE spending the request (D-2277)', () => {
    // ZERO COVERAGE UNTIL NOW, beside a bracket that measures what the probe
    // leaves on the box. This guard is what turns a box failure into a refusal
    // instead of a false verdict about a lane: without a directory of its own
    // the probe would either run in whatever cwd `ccrc` was invoked from — the
    // transcript landing in a real project's history, which is the consequence
    // the refusal names — or answer `unknown` about an account nobody asked.
    const home = box('ccrc-account-probe-cwd-');
    seedRosterJson(home, [UPSTREAM, OPENROUTER_LANE]);
    plantProbe(home, 'orchard-api');
    probeFixture(home, PROBE_OK, 0);
    // `~/.ccrc` is already a directory (the roster lives there), so the one
    // thing that can fail is the leaf — planted as a regular FILE.
    writeFileSync(join(home, '.ccrc', 'probe'), 'not a directory\n');
    const r = run(home, ['account', 'check', '--id', 'orchard-api']);
    expect(r.code, r.stderr).toBe(1);
    const j = oneObject(r);
    expect(j['error']).toBe('probe-cwd');
    expect(String(j['detail'])).toContain('.ccrc/probe');
    expect(String(j['detail'])).toMatch(/Nothing was written\.$/);
    // AND THIS IS WHAT MAKES IT A DISCRIMINATION RATHER THAN A STATUS CHECK:
    // the launcher never ran at all, so no request was billed for an answer the
    // verb was about to refuse anyway.
    expect(claudeArgv(home), 'the probe spent a request it then refused to report')
      .toEqual([]);
  });

  it('sees a same-second rewrite that changed LENGTH — the stamp is mtime AND size (D-2277)', () => {
    // THE SIZE HALF WAS UNMEASURED because no fixture had the limits file
    // present before a probe: every existing case goes from ABSENT to present,
    // which the mtime alone already decides. `_plat_mtime` is whole seconds on
    // both platforms, so the shape that needs the second field is a rewrite
    // inside one second — planted here by giving the file a fixed mtime, having
    // the launcher rewrite it to a DIFFERENT LENGTH, and copying the mtime
    // straight back off a reference file.
    const home = box('ccrc-account-probe-limits-size-');
    seedRosterJson(home, [UPSTREAM, OPENROUTER_LANE]);
    plantProbe(home, 'orchard-api');
    probeFixture(home, PROBE_OK, 0);
    const limits = join(home, '.cc-limits', 'orchard-api.json');
    mkdirSync(join(home, '.cc-limits'), { recursive: true });
    writeFileSync(limits, '{"five":7,"seven":0,"ts":1}');
    const gate = join(home, 'fixture-probe-limits-samesecond');
    writeFileSync(gate, '');
    const FIXED = 1600000000;
    utimesSync(limits, FIXED, FIXED);
    utimesSync(gate, FIXED, FIXED);
    const wasSize = statSync(limits).size;

    expect(oneObject(run(home, ['account', 'check', '--id', 'orchard-api']))['limitsTouched'],
      'a rewrite that only changed the byte count went unseen').toBe(true);
    // …and the fixture really did produce the shape the claim is about: same
    // whole second, different length. A case that quietly moved the mtime would
    // be measuring the half that was already covered.
    expect(Math.floor(statSync(limits).mtimeMs / 1000),
      'the fixture moved the mtime, so this measures nothing new').toBe(FIXED);
    expect(statSync(limits).size, 'the fixture rewrote the same bytes')
      .not.toBe(wasSize);
  });

  it('reports that the probe moved ~/.cc-limits, instead of moving it silently', () => {
    const home = box('ccrc-account-probe-limits-');
    seedRosterJson(home, [UPSTREAM, OPENROUTER_LANE]);
    plantProbe(home, 'orchard-api');
    probeFixture(home, PROBE_OK, 0);
    expect(probe(home)['limitsTouched']).toBe(false);
    writeFileSync(join(home, 'fixture-probe-writes-limits'), '');
    expect(probe(home)['limitsTouched']).toBe(true);
  });

  it('names ~/.cc-limits the way ccd does — one directory, two files', () => {
    // THROUGH THE SHARED CONSTANT, not a second spelling of the path.
    // `single-definition.test.ts:296`'s NAMES_CCD scan pins that path to
    // `ccdWsHelpers.ts` alone; building it here from REPO and two segments reds
    // it — measured, D-2132's defect in the task that cites it. And the scan
    // reads comments too, so this sentence must not spell the shape either.
    const ccd = readFileSync(CCD, 'utf8');
    const ccrc = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const a = /^LIMITS_DIR="([^"]+)"/m.exec(ccd)?.[1];
    const b = /^CCRC_LIMITS_DIR="([^"]+)"/m.exec(ccrc)?.[1];
    expect(a, 'ccd no longer declares LIMITS_DIR').toBeTruthy();
    expect(b, 'ccrc no longer declares CCRC_LIMITS_DIR').toBeTruthy();
    expect(b).toBe(a);
  });

  it('refuses a probe deadline it cannot honour, at the SECOND knob of the family (D-2221)', () => {
    // A DEVIATION FROM THIS TASK'S PLAN SNIPPET, which passed
    // `$CCRC_ACCOUNT_PROBE_TIMEOUT` straight to the deadline shim. D-2221 ruled
    // on exactly this for the cheap question one task ago, and every word of it
    // is truer here: `0` reads as NO deadline on a box with coreutils, so the
    // one value an operator types to mean "do not wait" would run an UNBOUNDED
    // BILLED request; `abc` makes GNU exit 125 without running the launcher at
    // all, which this file would then report as `unknown` — a fact about the
    // lane invented from a typo in the operator's shell.
    const home = box('ccrc-account-probe-knob-');
    seedRosterJson(home, [UPSTREAM, OPENROUTER_LANE]);
    plantProbe(home, 'orchard-api');
    probeFixture(home, PROBE_OK, 0);
    //
    // AND THE OTHER THREE ARGUMENTS OF THE FIVE (D-2277, D-2278). Only the knob
    // NAME and the value were measured at this call site; `_acct_deadline` takes
    // five, and the two caller-specific SENTENCES are the whole reason the
    // shape has five rather than three — they are what stops the cheap
    // question's wording being handed to the expensive one. The DEFAULT is the
    // third: `60` is spelled once at the knob's `:=` and a second time as this
    // caller's `$def`, with nothing keeping the two in agreement (D-2278). Both
    // copies are held here — the resolved value by the empty-knob assertion at
    // the bottom of this case, the argument by `default of 60` in the sentence
    // — so the two agree transitively through one literal in this file.
    const REFUSED: Array<[string, string, string]> = [
      ['0', 'zero is refused rather than given a meaning',
        'There is no spelling that means \'do not probe\''],
      ['00', 'zero is refused rather than given a meaning',
        'the cheap credential read in front of it'],
      ['-1', 'not a whole number of seconds', 'the default of 60'],
      ['abc', 'not a whole number of seconds', 'the default of 60'],
      ['0.5', 'not a whole number of seconds', 'the default of 60'],
      ['3601', 'above the 3600-second ceiling', 'one BILLED request'],
      ['99999999999999999999', 'above the 3600-second ceiling',
        'an answer a human is waiting on'],
    ];
    for (const [v, says, callerSays] of REFUSED) {
      const r = run(home, ['account', 'check', '--id', 'orchard-api'], '',
        { CCRC_ACCOUNT_PROBE_TIMEOUT: v });
      expect(r.code, `${JSON.stringify(v)}: ${r.stderr}`).toBe(2);
      const j = oneObject(r);
      expect(j['error'], JSON.stringify(v)).toBe('bad-timeout');
      expect(String(j['detail']), JSON.stringify(v)).toContain(says);
      expect(String(j['detail']), JSON.stringify(v)).toContain('CCRC_ACCOUNT_PROBE_TIMEOUT');
      // THE CALLER'S OWN HALF, which is what the five-argument shape exists to
      // force: a sentence true of the BILLED question and false of the local
      // credential read one function up.
      expect(String(j['detail']), `${JSON.stringify(v)}: the cheap question's wording reached the probe`)
        .toContain(callerSays);
      // AND IT REFUSED BEFORE SPENDING THE REQUEST. That is the whole point at
      // this knob: the launcher is what bills, so a value that cannot be
      // honoured must stop the run before the launcher is reached.
      expect(claudeArgv(home), `${v} ran the launcher anyway`).toEqual([]);
    }
    // …and every honourable spelling still answers, leading zeros included.
    for (const v of ['1', '60', '0060', '3600']) {
      const r = run(home, ['account', 'check', '--id', 'orchard-api'], '',
        { CCRC_ACCOUNT_PROBE_TIMEOUT: v });
      expect(r.code, `${v}: ${r.stderr}`).toBe(0);
      expect((oneObject(r)['health'] as Record<string, unknown>)['verdict'], v).toBe('ok');
    }
    // THE EMPTY KNOB IS THE DEFAULT, NOT A REFUSAL — `: "${…:=60}"` substitutes
    // when the variable is unset OR NULL, so an exported empty string is 60 by
    // the time the validator can look at it. Read through the sourced file,
    // which is the only way to see the resolved value without waiting one out.
    const empty = sourceRun(home, '_acct_probe_deadline\nprintf %s "$ACCT_DEADLINE"',
      { CCRC_ACCOUNT_PROBE_TIMEOUT: '' });
    expect(empty.code, empty.stderr).toBe(0);
    expect(empty.stdout, 'an empty knob did not fall back to the default').toBe('60');
    // …and the NORMALISED value is what the operator is shown on expiry, so
    // `0001` never reaches a sentence as "within 0001s".
    writeFileSync(join(home, 'fixture-probe-sleep'), '');
    const h = probe(home, { CCRC_ACCOUNT_PROBE_TIMEOUT: '0001' })['health'] as
      Record<string, unknown>;
    expect(h['verdict']).toBe('timeout');
    expect(String(h['detail'])).toContain('within 1s');
  });

  it('the SHIPPED classifier never defers on the probe, which is why there is nowhere to fall through to', () => {
    // `_acct_probe` has no probe to fall through to — it IS the last question —
    // so `classify` must answer every `--source probe` call with a ROW. That is
    // a property of the classifier, and it is pinned at the classifier rather
    // than asserted in a bash comment: the bodies below are every shape this
    // reader can be handed, including the ones that are not objects at all.
    for (const body of ['', 'not json at all\n', '[]', 'null', '{}', '{"is_error":true}',
      `${JSON.stringify(PROBE_OK)}\n`, `${JSON.stringify(PROBE_401)}\n`,
      `${JSON.stringify(PROBE_REFUSED)}\n`, `${JSON.stringify(PROBE_WEIRD)}\n`]) {
      const r = opRun(['classify', '--source', 'probe', '--exit', '1'], body);
      expect(r.code, `${JSON.stringify(body)}: ${r.stderr}`).toBe(0);
      const row = JSON.parse(r.stdout) as Record<string, unknown>;
      expect(typeof row['verdict'], JSON.stringify(body)).toBe('string');
      expect(row['verdict'], JSON.stringify(body)).not.toBe('ok');
    }
    // …and `ok` is reachable, so the line above is a discrimination and not a
    // constant: the same body at exit 0 IS the one verdict §8 guards.
    const ok = opRun(['classify', '--source', 'probe', '--exit', '0'],
      `${JSON.stringify(PROBE_OK)}\n`);
    expect(JSON.parse(ok.stdout)['verdict']).toBe('ok');
  });

  it('holds every `unreachable` alternative, and the conjunct that keeps them apart from a status (D-2277)', () => {
    // TWO OF THE THREE ALTERNATIVES WERE HELD BY NOTHING. Only `Connection
    // refused` had a fixture; `getaddrinfo` appeared in no test in the tree, and
    // deleting BOTH the getaddrinfo and 5xx alternatives left 240/240 green. A
    // row per alternative is the floor, and the third row is the one that earns
    // its place: the arm is `api_error_status === null` AND the text, so a body
    // that names a numeric status is `unknown` however its prose reads. That
    // control goes red the moment someone "fixes" the arm by dropping the
    // conjunct, which is exactly the change a reader of the regex alone makes.
    const err = (status: number | null, result: string): unknown => ({
      type: 'result', subtype: 'success', is_error: true,
      terminal_reason: 'api_error', api_error_status: status, result, total_cost_usd: 0,
    });
    const verdictOf = (body: unknown): Record<string, unknown> => {
      const r = opRun(['classify', '--source', 'probe', '--exit', '1'],
        `${JSON.stringify(body)}\n`);
      expect(r.code, `${JSON.stringify(body)}: ${r.stderr}`).toBe(0);
      return JSON.parse(r.stdout) as Record<string, unknown>;
    };
    const UNREACHABLE: Array<[string, string]> = [
      ['connection refused', 'API Error: Connection refused'],
      ['dns', 'API Error: getaddrinfo ENOTFOUND api.example.invalid'],
      ['5xx', 'API Error: 503 Service Unavailable'],
    ];
    for (const [name, text] of UNREACHABLE) {
      const row = verdictOf(err(null, text));
      expect(row['verdict'], name).toBe('unreachable');
      // …and the operator gets the endpoint's own words, not a paraphrase.
      expect(row['detail'], name).toBe(text);
    }

    // THE NEGATIVE CONTROL. Same 5xx prose, but the endpoint named a status —
    // which means something answered, so this is not a lane that could not be
    // reached. `unknown`, and the sentence says what it saw.
    const named = verdictOf(err(503, 'API Error: 503 Service Unavailable'));
    expect(named['verdict'],
      'a body carrying a numeric status read as unreachable').toBe('unknown');
    expect(String(named['detail'])).toContain('503');

    // …and the anchor is real: the alternatives are matched at the START of the
    // text, so a lane that merely mentions one of them mid-sentence is not
    // reported as unreachable either.
    expect(verdictOf(err(null, 'the model said getaddrinfo is a C function'))['verdict'])
      .toBe('unknown');
  });

  it('never reads SILENCE as health: the ok arm is `is_error === false` (D-2269, D-2270)', () => {
    // THE ONE CONJUNCT BETWEEN A DEAD LANE AND A FALSE `ok`, AND IT WAS
    // UNMEASURED. Deleting `&& j.is_error !== true` left 240/240 green, because
    // the fixture table above pairs EVERY failure body with rc 1 — so no case
    // ever presented a failure envelope at exit 0, which is the one input the
    // conjunct exists to judge. It is driven HERE, at the classifier, and not
    // through the launcher, because the pair is a property of `classifyProbe`
    // alone: a fixture launcher that exits 0 while printing a failure envelope
    // is a shape no launcher has to produce for this arm to be wrong.
    const at0 = (body: unknown): Record<string, unknown> => {
      const r = opRun(['classify', '--source', 'probe', '--exit', '0'],
        `${JSON.stringify(body)}\n`);
      expect(r.code, `${JSON.stringify(body)}: ${r.stderr}`).toBe(0);
      return JSON.parse(r.stdout) as Record<string, unknown>;
    };
    // A 401 AT EXIT 0 IS A DEAD LANE, not a healthy one. This is D-2269's own
    // reproduction, moved from the review into the suite.
    expect(at0(PROBE_401)['verdict'], 'a 401 envelope at exit 0 read as healthy')
      .toBe('auth-dead');

    // …and the two OTHER conditions `!== true` folded into `ok`, which is
    // D-2270: a body that says NOTHING about is_error, and a body that names it
    // in a shape this build cannot read. Neither is evidence of health.
    //
    // AND THE ARM THEY LAND IN NAMES THEM APART (D-2329). The tightening was
    // argued from this repo's overloaded-null rule, and its justification was
    // that the residual "already names the shape it saw" — which was FALSE at
    // the line below it: the residual named `terminal_reason`, the one field
    // that is not the reason, so all four bodies here answered the identical
    // `exit 0, terminal_reason absent`. The assertion this replaces could not
    // see that: `toContain('exit 0')` is satisfied by that constant string for
    // every body, which is a match and not a discrimination. So the claim is
    // now DISTINGUISHABILITY, measured over the whole set — four bodies, four
    // details — and each token is checked besides, so a build that made them
    // differ by accident (a timestamp, a serial) could not pass either.
    const RESIDUAL: Array<[unknown, string]> = [
      [{ type: 'result', subtype: 'success', result: 'ok' }, 'is_error absent'],
      [{ type: 'result', is_error: 'false', result: 'ok' }, 'is_error a string'],
      [{ type: 'result', is_error: null, result: 'ok' }, 'is_error null'],
      [{ type: 'result', is_error: 0, result: 'ok' }, 'is_error a number'],
    ];
    const said: string[] = [];
    for (const [body, names] of RESIDUAL) {
      const row = at0(body);
      expect(row['verdict'], `${JSON.stringify(body)} read as healthy`).not.toBe('ok');
      const detail = String(row['detail']);
      expect(detail, JSON.stringify(body)).toContain('exit 0');
      expect(detail, `${JSON.stringify(body)}: the residual does not name what it saw`)
        .toContain(names);
      said.push(detail);
    }
    expect(new Set(said).size, `four conditions, one sentence: ${said.join(' | ')}`)
      .toBe(RESIDUAL.length);

    // THE SHAPE AND NEVER THE VALUE, which is why `shapeOf` is what the arm
    // reaches for rather than the field itself: a launcher can put 300
    // characters where a boolean belongs, and this note goes out on argv.
    // D-2222's class, closed at the source the way it was closed for
    // `loggedIn` (D-2223 F5) rather than only at the cap downstream.
    const shouty = String(at0({ type: 'result', is_error: 'y'.repeat(300), result: 'ok' })['detail']);
    expect(shouty, 'launcher text reached the sentence').not.toContain('yyy');
    expect(shouty).toContain('is_error a string');

    // …AND A BOOLEAN IS NAMED BY VALUE, because both booleans reach the
    // residual — `true` beside a `terminal_reason` with no arm, `false` at a
    // non-zero exit — and one shared word for the two would put the pair this
    // whole case is about back into one sentence.
    const t = opRun(['classify', '--source', 'probe', '--exit', '1'],
      `${JSON.stringify(PROBE_WEIRD)}\n`);
    expect(String(JSON.parse(t.stdout)['detail'])).toContain('is_error true');
    const f = opRun(['classify', '--source', 'probe', '--exit', '1'],
      `${JSON.stringify(PROBE_OK)}\n`);
    expect(String(JSON.parse(f.stdout)['detail'])).toContain('is_error false');

    // THE POSITIVE HALF, so the assertion above is a discrimination and not a
    // constant: `is_error: false` at exit 0 is still the one `ok` §8 guards.
    expect(at0(PROBE_OK)['verdict']).toBe('ok');
    expect(at0(PROBE_OK)['detail']).toBe('the lane answered one turn');
    // …and the exit code still carries its half of the pair: the same healthy
    // body at a non-zero exit is not `ok` either.
    const nonZero = opRun(['classify', '--source', 'probe', '--exit', '1'],
      `${JSON.stringify(PROBE_OK)}\n`);
    expect(JSON.parse(nonZero.stdout)['verdict']).not.toBe('ok');
  });

  it('names the classifier\'s own exit code, and carries a deferred line instead of swallowing it', () => {
    // D-2223 F9: the stub's `||` folded every non-zero into "the health
    // classifier could not run", which is D-2220's defect at the sibling
    // address. Three codes, three sentences, driven through a planted
    // `account-op.mjs` because bash builds this argv itself and cannot spell it
    // wrong — the skew this file guards everywhere else.
    for (const [arm, code, says] of [
      ['  process.exitCode = 3;', 3, 'deferred (exit 3)'],
      ['  process.stdout.write("the lane said something\\n"); process.exitCode = 4;',
        4, 'the lane said something'],
    ] as const) {
      const home = classifierBox(`ccrc-account-probe-defer-${code}-`, arm);
      seedRosterJson(home, [UPSTREAM, OPENROUTER_LANE]);
      plantProbe(home, 'orchard-api');
      probeFixture(home, PROBE_OK, 0);
      const r = run(home, ['account', 'check', '--id', 'orchard-api']);
      expect(r.code, `${code}: ${r.stderr}`).toBe(1);
      const j = oneObject(r);
      expect(j['error'], String(code)).toBe('classify-failed');
      expect(String(j['detail']), String(code)).toContain(says);
      expect(String(j['detail']), String(code)).toContain('orchard-api');
    }
    // THE OTHER HALF, AND THE ONE THE STUB LOST OUTRIGHT: node refused with a
    // BODY. `_acct_auth_status` re-emits that envelope verbatim and leaves with
    // node's own class; the probe threw it away and printed its own sentence,
    // so "the box said no, here is why" arrived as "this build cannot answer".
    const wedged = classifierBox('ccrc-account-probe-envelope-',
      '  process.stdout.write(JSON.stringify({ ok: false, error: "wedged", '
      + 'detail: "the classifier wedged" }) + "\\n"); process.exitCode = 7;');
    seedRosterJson(wedged, [UPSTREAM, OPENROUTER_LANE]);
    plantProbe(wedged, 'orchard-api');
    probeFixture(wedged, PROBE_OK, 0);
    const r = run(wedged, ['account', 'check', '--id', 'orchard-api']);
    expect(r.code, r.stderr).toBe(7);
    expect(oneObject(r)['error']).toBe('wedged');
  });

  it('says what the probe left behind, instead of the short-circuit\'s "Nothing was written."', () => {
    // D-2210, RE-RULED. `_acct_answer` hard-codes that clause and `_acct_check`
    // used it, which was true while `check` only ever read a credential store
    // and a roster. This commit gives the verb a cwd it CREATES and a launcher
    // that writes a transcript into the lane's config dir, so on the probe path
    // the clause is false — and the file's own doctrine (`_acct_run_op`'s "$1 IS
    // THE CALLER'S CLAUSE … one helper ending every path with one sentence would
    // flatten two true statements into one false one") is what it is replaced
    // with, rather than a new helper.
    const home = staleAtBox('ccrc-account-probe-stale-health-', 'health');
    seedRosterJson(home, [UPSTREAM, OPENROUTER_LANE]);
    plantProbe(home, 'orchard-api');
    probeFixture(home, PROBE_OK, 0);
    const r = run(home, ['account', 'check', '--id', 'orchard-api']);
    expect(r.code, r.stderr).toBe(1);
    const d = String(oneObject(r)['detail']);
    expect(d).toContain('answer to \'health\'');
    expect(d, 'the probe path still claims nothing was written').not.toMatch(/Nothing was written\./);
    expect(d).toContain('.ccrc/probe');
    // …and the SHORT-CIRCUIT path still says the simple true thing, from the
    // same call site — which is what makes this a distinction and not a rename.
    const quick = staleAtBox('ccrc-account-probe-stale-quick-', 'health');
    seedRosterJson(quick, [UPSTREAM]);
    plantClaude(quick, 'claude');
    authFixture(quick, SIGNED_OUT, 1);
    expect(String(oneObject(run(quick, ['account', 'check', '--id', 'claude']))['detail']))
      .toMatch(/Nothing was written\.$/);
  });

  it('the deadline shim\'s bash fallback does not hold its caller\'s pipe for the whole deadline (D-2272)', () => {
    // CALLED INSIDE A COMMAND SUBSTITUTION, the watcher is a backgrounded
    // subshell that inherits the substitution's write end; the shim then
    // signals the SUBSHELL, which dies and orphans the sleeper it was waiting
    // on — and the orphan keeps that write end open, so the substitution cannot
    // see EOF until the whole duration has run out, long after the command
    // answered. MEASURED with a 10-second bound and a command that answers
    // instantly: 10 006 ms before the redirection, 9 ms after.
    //
    // THIS CASE USED TO OPEN BY CALLING THE ACCOUNT PROBE THE TREE'S FIRST SUCH
    // CALLER, AND THAT WAS FALSE (D-2332, correcting D-2272). It is the
    // eleventh of eleven, and eight of the other ten predate this branch
    // entirely — so the floor has been under `ccd`'s tmux liveness probe, its
    // two `gh pr` queries and the doctor's own `gh auth status` check for as
    // long as the shim has existed, on every box without coreutils. The
    // correction makes the defect BIGGER, not smaller, which is why the
    // population is measured below rather than described: a sentence about one
    // call site is exactly what rotted, and a count cannot.
    //
    // THE EXISTING NO-COREUTILS CASE CANNOT MAKE THIS ASSERTION, and being
    // reassured by it is the mistake to avoid: `ccrc-doctor.test.ts` replaces
    // PATH with a stub bin that has no `sleep` at all, so the `|| exit 0` guard
    // fires, the watcher exits immediately and no orphan is ever created. It
    // passes in seconds and proves nothing about this arm. The sleep-PRESENT
    // shape is the only shape a real BSD or macOS box has — `sleep` is base
    // system there and the GNU deadline binary is not — so this case builds
    // that PATH itself: the two real programs the fallback needs, and nothing
    // else.
    const home = box('ccrc-account-plat-deadline-orphan-');
    const bin = join(home, 'no-coreutils-bin');
    mkdirSync(bin, { recursive: true });
    for (const name of ['sleep', 'rm', 'echo']) {
      const real = spawnSync(BASH, ['-c', `command -v ${name}`], { encoding: 'utf8' })
        .stdout.trim();
      expect(real, `this box has no ${name} to link`).toBeTruthy();
      symlinkSync(real, join(bin, name));
    }
    // THE GUARDS ARE THE HALF THAT KEEPS THIS FROM PASSING VACUOUSLY: with a
    // coreutils deadline binary still reachable the shim never reaches its
    // fallback at all, and with no `sleep` the watcher exits before it can
    // orphan anything. Either way the case would be green about nothing.
    const guards = [
      `export PATH=${JSON.stringify(bin)}`,
      'if command -v timeout >/dev/null 2>&1 || command -v gtimeout >/dev/null 2>&1; then',
      '  echo "a coreutils deadline binary is still reachable: the fallback never ran" >&2; exit 90',
      'fi',
      'command -v sleep >/dev/null 2>&1 || { echo "no sleep: the arm under test never runs" >&2; exit 91; }',
    ];
    const t0 = Date.now();
    const r = sourceRun(home, [...guards,
      'out="$(_plat_timeout 10 echo hi)"; rc=$?',
      'printf \'%s|%s\' "$out" "$rc"'].join('\n'));
    const ms = Date.now() - t0;
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout, 'the command\'s own answer did not survive the redirection').toBe('hi|0');
    expect(ms, `the substitution blocked for ${ms}ms after the command had answered`)
      .toBeLessThan(5000);

    // …AND THE DEADLINE STILL BITES. Closing the watcher's streams must not
    // close the watcher: the same arm, on a command that never answers, still
    // stamps, still signals, and still reports the code every call site here
    // branches on.
    const slow = sourceRun(home, [...guards,
      'out="$(_plat_timeout 1 sleep 30)"; rc=$?',
      'printf \'%s|%s\' "$out" "$rc"'].join('\n'));
    expect(slow.code, slow.stderr).toBe(0);
    expect(slow.stdout, 'the bounded call no longer reports expiry').toBe('|124');

    // ── THE POPULATION, MEASURED (D-2332) ──────────────────────────────────
    // A FLOOR AND NOT AN EXACT COUNT, deliberately: a new bounded call inside
    // `$( )` is an ordinary thing to add and must not red this case, while the
    // claim that needs holding is the one that was got WRONG — that this shape
    // has one caller, or that the account probe introduced it. The scan reads
    // the shebang'd files of `ccd/` the way `macos-platform.test.ts` derives its
    // corpus, so a new shell file added there is counted rather than missed.
    const ccdDir = join(REPO, 'ccd');
    const CALLS = /\$\([^()]{0,400}?_plat_timeout\b/gs;
    const sites = new Map<string, number>();
    for (const f of readdirSync(ccdDir, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      const src = readFileSync(join(ccdDir, f.name), 'utf8');
      if (!src.startsWith('#!')) continue;
      const n = [...src.matchAll(CALLS)].length;
      if (n > 0) sites.set(f.name, n);
    }
    const census = [...sites].map(([f, n]) => `${f}=${n}`).join(' ');
    const total = [...sites.values()].reduce((a, b) => a + b, 0);
    expect(total, `command-substitution callers of the shim: ${census}`)
      .toBeGreaterThanOrEqual(10);
    // …AND THEY ARE NOT ALL THE ACCOUNT VERB'S. Three files at least, and the
    // majority outside the file this wave edited — which is the half of the
    // corrected sentence that a bare count could not carry.
    expect(sites.size, census).toBeGreaterThanOrEqual(3);
    expect(total - (sites.get('ccrc') ?? 0), census).toBeGreaterThanOrEqual(8);

    // AND BOTH SHIPPED COPIES CARRY THE CORRECTION, in the one place a reader
    // of the shim will look. The platform block is pinned byte-identical across
    // the two files by `macos-platform.test.ts`, so naming the ledger entry in
    // it is what stops the primacy claim being written back into either copy
    // without a second look. Same shape as this file's D-2276 banner check.
    for (const f of ['ccd', 'ccrc']) {
      expect(readFileSync(join(ccdDir, f), 'utf8'),
        `${f}'s deadline shim does not carry D-2272's correction`).toContain('D-2332');
    }
  });

  it('creates the scratch cwd and nothing else on the box (D-2223 F6, at the probe)', () => {
    // The bracket that case runs on the SHORT-CIRCUIT path, where no probe runs
    // at all; this is the other path, and equality is impossible here by
    // construction — the whole point of the probe is that it runs a launcher.
    // So the claim is the DIFF: everything this path adds to the box is the one
    // directory `ccrc` creates plus the two logs the FIXTURE launcher keeps. A
    // real `-p` also writes a transcript under the lane's own config dir, which
    // this fixture cannot show and which the refusal clause therefore names in
    // words rather than pretending to have measured.
    const home = box('ccrc-account-probe-writes-');
    seedRosterJson(home, [UPSTREAM, OPENROUTER_LANE]);
    plantProbe(home, 'orchard-api');
    probeFixture(home, PROBE_OK, 0);
    const before = new Set(snapshotHome(home));
    const r = run(home, ['account', 'check', '--id', 'orchard-api']);
    expect(r.code, r.stderr).toBe(0);
    const added = snapshotHome(home).filter((l) => !before.has(l))
      .map((l) => l.split(' ').slice(0, 2).join(' ')).sort();
    expect(added).toEqual(['D .ccrc/probe', 'F claude-argv', 'F claude-env']);
  });
});
