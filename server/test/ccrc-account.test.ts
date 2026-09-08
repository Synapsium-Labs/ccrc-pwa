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
  existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync,
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
