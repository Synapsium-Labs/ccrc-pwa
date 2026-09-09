// `ccrc models …` (§10) — what the verb group DOES.
// `server/test/ccrc-cli.test.ts` owns its DISCOVERABILITY (the usage line),
// which is the split that file states verb by verb.
//
// A TOP-LEVEL verb, not a subverb of `ccrc account`: round-2 ruling 5, because
// `cmd_account` is the account-connections branch's and is not on `main`.
//
// The fixture is `ccrc-doctor-graphify.test.ts`'s box, for its reasons: HOME is
// a throwaway `mkTmp`; `ccrc` is invoked through `<home>/ccrc/ccd/ccrc`, the
// shape a deployed box has (deploy.sh rsyncs `ccd` whole) and the shape
// `CCRC_HERE` resolves `../deploy/models-op.mjs` against; `gh`, `curl`,
// `systemctl` and `launchctl` are poisoned beside it. This verb shells out to
// node and to the probe and to nothing else, which the cases below assert.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { CODEX } from './fixtures/modelCases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC_SRC = join(REPO, 'ccd', 'ccrc');
const CODEX_RAW = join(here, 'fixtures', 'catalogues', 'codex-raw-2026-09-08.json');
const COMPAT_RAW = join(here, 'fixtures', 'catalogues', 'compatible-raw.json');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

const ROSTER = {
  version: 1,
  accounts: [
    { id: 'claude', label: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'claude-a', label: 'claude-a', configDirSuffix: '.claude-a',
      exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    { id: 'gpt', label: 'gpt', configDirSuffix: '.claude-gpt',
      exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none' },
    // `secretsFile` is Task 8's: the model probe is a box-level executable
    // with no lane context, so `_models_endpoints` sources this file in a
    // subshell around the probe call, mirroring `shared/wrapper.mjs`'s own
    // generated line. Relative to $HOME, per `shared/roster.ts`'s SECRETS_SAFE_RE.
    { id: 'router', label: 'router', configDirSuffix: '.claude-router',
      exec: { kind: 'generated', secretsFile: '.secrets/router.env' }, homeAble: false, hue: 'blue',
      telemetry: 'none' },
    // Fix round 1, Finding 2: a SECOND openrouter-shaped lane, deliberately
    // with no `exec.secretsFile` at all — `router`'s own "no secrets file"
    // case only ever deleted the FILE while the roster row still declared
    // one, which stops at `_models_endpoints`'s `[ -r ]` guard inside the
    // secretsFile branch and never reaches the `else` (ambient-environment)
    // branch. This lane is what actually reaches it.
    { id: 'router2', label: 'router2', configDirSuffix: '.claude-router2',
      exec: { kind: 'external' }, homeAble: false, hue: 'green', telemetry: 'none' },
  ],
};

let home: string;

/** A box carrying the tree `ccrc` resolves against — `ccrc-doctor-graphify.
 *  test.ts`'s `installCcrc`, with `ccrc-models-probe` added to the symlinked
 *  `ccd/` set because `ccrc models refresh` execs it out of `$CCRC_HERE`.
 *  `deploy` and `shared` are symlinked WHOLE: `deploy/models-op.mjs` imports
 *  three `../shared/*.mjs` modules and node resolves them through the link's
 *  realpath. */
function box(roster: unknown = ROSTER): string {
  const h = mkTmp('ccrc-models-verb-');
  const ccd = join(h, 'ccrc', 'ccd');
  fs.mkdirSync(ccd, { recursive: true });
  for (const f of ['ccrc', 'ccrc-wrapper-shape', 'ccrc-doctor-checks', 'ccrc-models-probe']) {
    fs.symlinkSync(join(REPO, 'ccd', f), join(ccd, f));
  }
  fs.symlinkSync(join(REPO, 'deploy'), join(h, 'ccrc', 'deploy'));
  fs.symlinkSync(join(REPO, 'shared'), join(h, 'ccrc', 'shared'));
  fs.mkdirSync(join(h, '.ccrc'), { recursive: true });
  fs.writeFileSync(join(h, '.ccrc', 'accounts.json'), `${JSON.stringify(roster, null, 2)}\n`);
  env(h);
  return h;
}

/** Round 1 review, Important 2: the `no-answer` seam (`_models_answer`) had
 *  no test. Same box as `box()`, except `deploy/` is a REAL directory holding
 *  one symlink per file the repo's `deploy/` has, rather than one symlink to
 *  the whole directory — so a test can drop its OWN `models-op.mjs` in
 *  without touching the real one. `shared/` stays symlinked whole: a stub
 *  script never imports it, and the box still needs to look like a complete
 *  install for `ccrc-wrapper-shape` and the other symlinked `ccd/` files. */
function boxWithStubOp(stubSource: string, roster: unknown = ROSTER): string {
  const h = mkTmp('ccrc-models-verb-stubop-');
  const ccd = join(h, 'ccrc', 'ccd');
  fs.mkdirSync(ccd, { recursive: true });
  for (const f of ['ccrc', 'ccrc-wrapper-shape', 'ccrc-doctor-checks', 'ccrc-models-probe']) {
    fs.symlinkSync(join(REPO, 'ccd', f), join(ccd, f));
  }
  const deploy = join(h, 'ccrc', 'deploy');
  fs.mkdirSync(deploy, { recursive: true });
  for (const f of fs.readdirSync(join(REPO, 'deploy'))) {
    if (f === 'models-op.mjs') continue;
    fs.symlinkSync(join(REPO, 'deploy', f), join(deploy, f));
  }
  fs.writeFileSync(join(deploy, 'models-op.mjs'), stubSource, { mode: 0o755 });
  fs.symlinkSync(join(REPO, 'shared'), join(h, 'ccrc', 'shared'));
  fs.mkdirSync(join(h, '.ccrc'), { recursive: true });
  fs.writeFileSync(join(h, '.ccrc', 'accounts.json'), `${JSON.stringify(roster, null, 2)}\n`);
  env(h);
  return h;
}

/** Prints nothing and exits 0 — the pre-existing emptiness case. */
const STUB_SILENT_OK = '#!/usr/bin/env node\nprocess.exit(0);\n';
/** Prints a two-line, non-JSON stack to STDOUT and exits 7 — the exact shape
 *  the round 1 reviewer measured breaking both "exactly one JSON object on
 *  stdout" and the 0/1/2 exit-code contract at once. */
const STUB_STACK = "#!/usr/bin/env node\n"
  + "process.stdout.write('Error: kaboom\\n    at somewhere.js:12:34\\n');\n"
  + 'process.exit(7);\n';
/** Round 1 review addendum: the SAME two-line non-JSON body as `STUB_STACK`,
 *  but exiting 0 — INSIDE the rc-clamp's 0/1/2 allow-list, so this stub can
 *  be caught ONLY by the shape check, never by the clamp. `STUB_STACK`'s own
 *  exit 7 trips both guards at once, which is why removing the shape check
 *  alone left it green; this one isolates the shape check as its own
 *  measured, committed case. */
const STUB_STACK_EXIT0 = "#!/usr/bin/env node\n"
  + "process.stdout.write('Error: kaboom\\n    at somewhere.js:12:34\\n');\n"
  + 'process.exit(0);\n';
/** Prints one valid refusal object and exits 1 — the shape check and the
 *  rc-clamp must both let this through UNCHANGED. */
const STUB_VALID_REFUSAL = '#!/usr/bin/env node\n'
  + "process.stdout.write(JSON.stringify({ok:false,error:'roster-absent',detail:'stub refusal'}) + '\\n');\n"
  + 'process.exit(1);\n';
/** C2: a VALID object, `type=="object"`, rc 0 — `_models_answer`'s three
 *  clamps (non-empty, object, 0/1/2) all pass this — but with no `lanes`
 *  FIELD at all, the exact half-updated-box shape `_models_answer`'s own
 *  clamps do not reach: a node half new enough to answer at all, old enough
 *  that its `lanes` op does not exist yet. */
const STUB_VALID_NO_LANES = '#!/usr/bin/env node\n'
  + "process.stdout.write(JSON.stringify({ok:true}) + '\\n');\n"
  + 'process.exit(0);\n';

function env(h: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const e = ghContainedEnv(h, { ...process.env, HOME: h, ...extra });
  const poison = (name: string, says: string): void =>
    fs.writeFileSync(join(h, '.local', 'bin', name),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\n`
      // C13: the header goes in via `curl -K -` on stdin now, never argv —
      // captured separately so a test can assert BOTH halves: argv never
      // carries the token, and stdin is where it actually went.
      + (name === 'curl' ? `cat >> "$HOME/${name}-stdin-poison" 2>/dev/null\n` : '')
      + `echo "${says}" >&2\nexit 97\n`, { mode: 0o755 });
  poison('curl', 'ccrc tests must never reach a real server');
  poison('systemctl', 'ccrc tests must never query this box\'s real systemd');
  poison('launchctl', 'ccrc tests must never query this box\'s real launchd');
  return e;
}

interface Result { code: number; stdout: string; stderr: string }
function run(args: string[], extra: NodeJS.ProcessEnv = {}): Result {
  const r = spawnSync(BASH, [join(home, 'ccrc', 'ccd', 'ccrc'), ...args],
    { env: env(home, extra), encoding: 'utf8', input: '' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** The contract: stdout is EXACTLY one JSON object and nothing else. */
function oneObject(r: Result): Record<string, unknown> {
  const lines = r.stdout.split('\n');
  expect(lines[lines.length - 1], `stdout is not newline-terminated: ${JSON.stringify(r.stdout)}`).toBe('');
  expect(lines.length, `stdout carried ${lines.length - 1} lines, not one`).toBe(2);
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

const poisonLog = (name: string): string[] => {
  const p = join(home, `${name}-poison`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

/** C13: what `curl` read on STDIN — where `-K -` now carries the
 *  Authorization header, so a caller can assert the token landed here and
 *  nowhere in {@link poisonLog}'s argv capture. */
const poisonStdin = (name: string): string => {
  const p = join(home, `${name}-stdin-poison`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};

const registryOf = (id: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', `${id}.classes.json`), 'utf8'));

const writeCatalogue = (id: string, cat: unknown = CODEX): void => {
  fs.mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
  fs.writeFileSync(join(home, '.ccrc', 'models', `${id}.json`), JSON.stringify(cat));
};

beforeEach(() => { home = box(); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('the models dispatcher', () => {
  it('spells its per-lane subcommand list once, at file scope', () => {
    // The dispatcher below and the refusal that lists what this build
    // implements must read ONE string, or a subcommand can dispatch while the
    // refusal claims it does not exist.
    const src = fs.readFileSync(CCRC_SRC, 'utf8');
    const m = /^MODELS_SUBS="([^"]*)"$/m.exec(src);
    expect(m, 'ccd/ccrc has no file-scope MODELS_SUBS').toBeTruthy();
    expect(m![1]!.split(' ').filter(Boolean).sort())
      .toEqual(['discovery', 'init', 'rm', 'set-class', 'set-effort', 'set-subagent', 'show']);
  });

  it('spells the reserved first-token words once, at file scope', () => {
    // Deviation B-4: `refresh` and `litellm` are box-wide subcommands in the
    // slot an account id otherwise occupies, and an account id may legally BE
    // one of those words.
    const src = fs.readFileSync(CCRC_SRC, 'utf8');
    const m = /^MODELS_RESERVED="([^"]*)"$/m.exec(src);
    expect(m, 'ccd/ccrc has no file-scope MODELS_RESERVED').toBeTruthy();
    expect(m![1]!.split(' ').filter(Boolean).sort()).toEqual(['litellm', 'refresh']);
  });

  it('`_models_id_ok` reads the shared WRAPPER_ID_RE, not a hand-copied literal', () => {
    // Round 1 review, Important 3: a fourth typed-out `^[a-z][a-z0-9-]{0,31}$`
    // was the ONLY guard between `ccrc models <id> init` and a write outside
    // ~/.ccrc/models/ (`deploy/models-op.mjs` has no traversal guard of its
    // own), and it had drifted out of sync with `shared/roster.ts`'s ID_RE
    // three times already (`ccrc-wrapper-shape`'s own header). A static pin
    // so a fifth copy cannot creep back into this one function.
    const src = fs.readFileSync(CCRC_SRC, 'utf8');
    const m = /^_models_id_ok\(\) \{[\s\S]*?^\}$/m.exec(src);
    expect(m, 'ccd/ccrc has no _models_id_ok function').toBeTruthy();
    expect(m![0]).not.toContain('[a-z0-9-]{0,31}');
  });

  it('with nothing after it refuses at exit 2 with a body', () => {
    const r = run(['models']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('missing-argument');
  });

  it('with an id and no subcommand names the ones this build has', () => {
    const r = run(['models', 'gpt']);
    expect(r.code).toBe(2);
    const b = oneObject(r);
    expect(b['error']).toBe('missing-subcommand');
    expect(String(b['detail'])).toContain('show');
  });

  it('an unknown subcommand refuses at exit 2 rather than reaching node', () => {
    const r = run(['models', 'gpt', 'frobnicate']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-subcommand');
    expect(fs.existsSync(join(home, 'gh-poison'))).toBe(false);
  });

  it('an id that is not an id refuses at exit 2, before node', () => {
    const r = run(['models', '../escape', 'show']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('bad-account-id');
  });

  it('REFUSES an account literally named `refresh`, naming the collision (deviation B-4)', () => {
    // `ID_RE` allows it, and the grammar cannot allow both readings. The
    // refusal is at exit 2, on the ROSTER, and names the fix.
    fs.rmSync(home, { recursive: true, force: true });
    home = box({ ...ROSTER, accounts: [...ROSTER.accounts,
      { id: 'refresh', label: 'refresh', configDirSuffix: '.claude-refresh',
        exec: { kind: 'external' }, homeAble: false, hue: 'green', telemetry: 'none' }] });
    const r = run(['models', 'refresh', '--all']);
    expect(r.code).toBe(2);
    const b = oneObject(r);
    expect(b['error']).toBe('reserved-account-id');
    expect(String(b['detail'])).toContain('rename');
  });

  it('spells the implemented box-wide subcommands once, at file scope', () => {
    const src = fs.readFileSync(CCRC_SRC, 'utf8');
    const m = /^MODELS_BOX_SUBS="([^"]*)"$/m.exec(src);
    expect(m, 'ccd/ccrc has no file-scope MODELS_BOX_SUBS').toBeTruthy();
    expect(m![1]!.split(' ').filter(Boolean).sort()).toEqual(['litellm', 'refresh']);
  });
});

describe('ccrc models <id> show', () => {
  it('answers one JSON object and a human summary on STDERR', () => {
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['ok']).toBe(true);
    expect(b['id']).toBe('gpt');
    expect(b['registry']).toBeNull();
    // The verb's contract is one object on stdout; a person still needs a
    // sentence, so it goes where a sentence goes.
    expect(r.stderr).toMatch(/never probed/);
    expect(r.stderr).toMatch(/no class registry yet/);
  });

  it('--json prints the object and NOTHING on stderr', () => {
    const r = run(['models', 'gpt', 'show', '--json']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['ok']).toBe(true);
    expect(r.stderr).toBe('');
  });

  it('summarises a probed, seeded lane: the four unclassified, the missing fable, the subagent', () => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect((b['derived'] as { unclassified: string[] }).unclassified).toHaveLength(4);
    expect(r.stderr).toContain('gpt-6-astra');
    expect(r.stderr).toMatch(/fable\s+—/);
    expect(r.stderr).toMatch(/subagents run as sonnet/);
  });

  it('an anthropic lane answers read-only and says why', () => {
    const r = run(['models', 'claude-a', 'show']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['registry']).toBeNull();
    expect(r.stderr).toMatch(/Claude Code's own defaults/);
  });

  it('names a drifted settings key in the summary, with the remedy', () => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
    const p = join(home, '.claude-gpt', 'settings.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.env.ANTHROPIC_MODEL = 'wrong';
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    const r = run(['models', 'gpt', 'show']);
    expect(oneObject(r)['settingsDrift']).toEqual(['ANTHROPIC_MODEL']);
    expect(r.stderr).toMatch(/settings\.json has drifted/);
  });

  it('an ORPHAN registry — no roster row for this id — answers orphan:true rather than refusing (§11)', () => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
    fs.writeFileSync(join(home, '.ccrc', 'models', 'ghost.classes.json'),
      fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.classes.json'), 'utf8'));
    const r = run(['models', 'ghost', 'show']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['orphan']).toBe(true);
    expect((b['derived'] as { available: string[] }).available).toEqual([]);
  });

  it('a refusal still carries exactly one JSON object on stdout', () => {
    fs.rmSync(join(home, '.ccrc', 'accounts.json'));
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('roster-absent');
  });

  it('reaches node and NOTHING else — no curl, no systemctl, no gh', () => {
    run(['models', 'gpt', 'show']);
    expect(poisonLog('curl')).toEqual([]);
    expect(poisonLog('systemctl')).toEqual([]);
    expect(fs.existsSync(join(home, 'gh-poison'))).toBe(false);
  });

  it('takes only --json', () => {
    const r = run(['models', 'gpt', 'show', '--wat']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });
});

describe('ccrc models <id> init', () => {
  it('seeds the gpt registry and materialises, at exit 0', () => {
    const r = run(['models', 'gpt', 'init', 'codex']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['created']).toBe(true);
    expect((registryOf('gpt')['classes'] as Record<string, unknown>)['opus']).toBe('gpt-5.6-sol');
    expect(registryOf('gpt')['subagent']).toBe('sonnet');
    const settings = JSON.parse(fs.readFileSync(join(home, '.claude-gpt', 'settings.json'), 'utf8'));
    expect(settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('ccrc-unavailable-fable');
  });

  it('needs a probe kind', () => {
    const r = run(['models', 'gpt', 'init']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toContain('probe');
  });

  it('refuses an unknown probe kind at exit 2, before node runs', () => {
    const r = run(['models', 'gpt', 'init', 'gemini']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-probe');
  });

  it('refuses `openai` with its own sentence — that is a PROVIDER, not a probe kind', () => {
    const r = run(['models', 'gpt', 'init', 'openai']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toMatch(/spelled "codex"/);
  });

  it('refuses `anthropic` with its own sentence', () => {
    const r = run(['models', 'claude-a', 'init', 'anthropic']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toMatch(/Claude Code's own defaults/);
  });

  it('passes --base-url through for a compatible lane', () => {
    const r = run(['models', 'router', 'init', 'compatible', '--base-url', 'https://api.cortecs.ai']);
    expect(r.code).toBe(0);
    expect(registryOf('router')['baseUrl']).toBe('https://api.cortecs.ai');
  });

  it('an openrouter lane is created unseeded and prints the remedy', () => {
    const r = run(['models', 'router', 'init', 'openrouter']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['created']).toBe(true);
    expect(String(b['remedy'])).toMatch(/discovery add/);
  });

  it('takes no extra argument', () => {
    const r = run(['models', 'gpt', 'init', 'codex', 'extra']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });
});

// Round 1 review, Important 2: `_models_answer`'s seam had no test at all —
// `grep -n no-answer server/test/ccrc-models.test.ts` found nothing. These
// three drop a STUB `deploy/models-op.mjs` into the fixture box, through
// `boxWithStubOp`, and drive it through `ccrc models <id> show` — the seam
// itself does not care which subcommand called it.
describe('the _models_answer seam ("no-answer")', () => {
  it('the node half prints nothing and exits 0: refused, not a silent drop', () => {
    fs.rmSync(home, { recursive: true, force: true });
    home = boxWithStubOp(STUB_SILENT_OK);
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('no-answer');
    expect(r.stderr).not.toBe('');
  });

  it('the node half prints a bare stack and exits 7: refused, not two stray lines on stdout', () => {
    // This is the case the round 1 review measured: emptiness alone let both
    // lines of the stack through as if they were the promised JSON object,
    // and the caller's exit code was the node half's raw 7, not this file's
    // own 0/1/2.
    fs.rmSync(home, { recursive: true, force: true });
    home = boxWithStubOp(STUB_STACK);
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('no-answer');
    expect(r.stderr).not.toBe('');
  });

  it('the node half prints a bare stack and exits 0: refused by the SHAPE check alone', () => {
    // Round 1 review addendum: `STUB_STACK`'s exit 7 trips the rc-clamp too,
    // so removing the shape check leaves that case green — the clamp alone
    // still catches it. This stub's exit code (0) is inside the clamp's
    // 0/1/2 allow-list, so ONLY the shape check can refuse it; the mutation
    // check below removes that check and expects exactly this case to go
    // red while (b) stays green.
    fs.rmSync(home, { recursive: true, force: true });
    home = boxWithStubOp(STUB_STACK_EXIT0);
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('no-answer');
    expect(r.stderr).not.toBe('');
  });

  it('the node half prints one valid refusal object and exits 1: passed through unchanged', () => {
    // The shape check and the rc clamp must not turn a REAL refusal from
    // deploy/models-op.mjs into a manufactured "no-answer" — that would hide
    // the node half's own diagnosis behind this seam's.
    fs.rmSync(home, { recursive: true, force: true });
    home = boxWithStubOp(STUB_VALID_REFUSAL);
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('roster-absent');
    expect(b['detail']).toBe('stub refusal');
  });
});

// C2: `_models_answer`'s three clamps (non-empty, object, 0/1/2) all pass a
// valid-but-fieldless body — none of them check that the body carries the
// FIELDS the caller for this op then reads. `refresh --all` used to read
// `.lanes[]` with no shape guard of its own: on a body missing `lanes`, that
// jq call failed, the loop variable and its count both went empty, the
// `while` loop never ran, and the tail printed `all(.ok)` over an empty
// array — `ok:true`, exit 0 — over a body the seam's own comment says "must
// not reach the caller as a bare exit code".
describe('ccrc models refresh --all guards the lanes answer\'s SHAPE, not just its emptiness (C2)', () => {
  it('a valid object with no "lanes" field is a no-answer refusal, never a zero-row ok:true', () => {
    home = boxWithStubOp(STUB_VALID_NO_LANES);
    const r = run(['models', 'refresh', '--all']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['ok']).toBe(false);
    expect(b['error']).toBe('no-answer');
    expect(r.stderr).not.toBe('');
    expect(r.stderr.split('\n').filter((l) => l.length > 0).every((l) => l.startsWith('ccrc:'))).toBe(true);
  });

  it('the named-lane form already refuses correctly, unaffected by this guard', () => {
    home = boxWithStubOp(STUB_VALID_NO_LANES);
    const r = run(['models', 'refresh', 'router']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('no-answer');
  });
});

describe('ccrc models <id> set-class', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
  });

  it('assigns a class and rewrites the lane\'s settings.json and TSV', () => {
    const r = run(['models', 'gpt', 'set-class', 'fable', 'gpt-6-astra']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['ok']).toBe(true);
    const settings = JSON.parse(fs.readFileSync(join(home, '.claude-gpt', 'settings.json'), 'utf8'));
    expect(settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('gpt-6-astra');
    expect(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.classes.tsv'), 'utf8'))
      .toContain('fable\tgpt-6-astra\tassigned\n');
  });

  it('`none` clears it', () => {
    const r = run(['models', 'gpt', 'set-class', 'opus', 'none']);
    expect(r.code).toBe(0);
    expect((registryOf('gpt')['classes'] as Record<string, unknown>)['opus']).toBeNull();
    expect(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.classes.tsv'), 'utf8'))
      .toContain('opus\t\tunassigned\n');
  });

  it('refuses a class that is not one of the four, at exit 2, before node', () => {
    const r = run(['models', 'gpt', 'set-class', 'subagent', 'gpt-5.5']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-class');
    expect(String(oneObject(r)['detail'])).toMatch(/set-subagent/);
  });

  it('needs both a class and a model', () => {
    expect(run(['models', 'gpt', 'set-class', 'fable']).code).toBe(2);
    expect(run(['models', 'gpt', 'set-class']).code).toBe(2);
  });

  it('takes no third argument', () => {
    const r = run(['models', 'gpt', 'set-class', 'fable', 'gpt-6-astra', 'extra']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });
});

describe('ccrc models <id> set-subagent', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
  });

  it('moves CLAUDE_CODE_SUBAGENT_MODEL, and nothing else in the block', () => {
    const before = JSON.parse(fs.readFileSync(join(home, '.claude-gpt', 'settings.json'), 'utf8'));
    const r = run(['models', 'gpt', 'set-subagent', 'opus']);
    expect(r.code).toBe(0);
    const after = JSON.parse(fs.readFileSync(join(home, '.claude-gpt', 'settings.json'), 'utf8'));
    expect(after.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('gpt-5.6-sol');
    expect(after.env.ANTHROPIC_MODEL).toBe(before.env.ANTHROPIC_MODEL);
    expect(after.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(before.env.ANTHROPIC_DEFAULT_SONNET_MODEL);
  });

  it('refuses a class whose slot is null, naming set-class', () => {
    const r = run(['models', 'gpt', 'set-subagent', 'fable']);
    expect(r.code).toBe(1);
    expect(String(oneObject(r)['detail'])).toMatch(/set-class fable/);
  });

  it('refuses a word that is not a class, at exit 2', () => {
    const r = run(['models', 'gpt', 'set-subagent', 'sonnet-class']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-class');
  });

  it('needs a class', () => {
    expect(run(['models', 'gpt', 'set-subagent']).code).toBe(2);
  });
});

describe('ccrc models <id> set-effort', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
  });

  it('sets a level and it reaches the effort file the shim reads', () => {
    const r = run(['models', 'gpt', 'set-effort', 'sonnet', 'xhigh']);
    expect(r.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.effort.json'), 'utf8'))
      .byModel['gpt-5.6-terra']).toBe('xhigh');
  });

  it('refuses a level the classed model does not offer', () => {
    const r = run(['models', 'gpt', 'set-effort', 'haiku', 'ultra']);
    expect(r.code).toBe(1);
    expect(String(oneObject(r)['detail'])).toContain('gpt-5.6-luna');
  });

  it('refuses a class that is not one of the four, at exit 2', () => {
    const r = run(['models', 'gpt', 'set-effort', 'subagent', 'high']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-class');
  });
});

describe('ccrc models <id> discovery', () => {
  const whitelist = (providers: string[]): void => {
    fs.mkdirSync(join(home, '.handoff'), { recursive: true });
    fs.writeFileSync(join(home, '.handoff', 'providers-whitelist.json'), JSON.stringify({ providers }));
  };
  const endpointsFixture = (names: string[]): string => {
    const p = join(home, 'endpoints-fixture.json');
    fs.writeFileSync(p, JSON.stringify({ data: { endpoints: names.map((n) => ({ provider_name: n })) } }));
    return p;
  };
  // The probe is a box-level executable with no lane context (Task 8's
  // controller ruling): `_models_endpoints` supplies the lane's key by
  // sourcing this file in a SUBSHELL around the probe call, never in ccrc's
  // own shell — the same line `shared/wrapper.mjs`'s generated wrapper emits.
  const writeSecrets = (exportIt = true): void => {
    fs.mkdirSync(join(home, '.secrets'), { recursive: true });
    fs.writeFileSync(join(home, '.secrets', 'router.env'),
      `${exportIt ? 'export ' : ''}ANTHROPIC_AUTH_TOKEN=lane-token\n`);
  };

  it('add and rm on a codex lane, with no whitelist question asked', () => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
    const r = run(['models', 'gpt', 'discovery', 'add', 'gpt-5.5']);
    expect(r.code).toBe(0);
    // `deploy/models-op.mjs`'s scope conversion (Task 6, ruling 2026-09-08):
    // every already-classed id, in CLASSES order, THEN the new one — not the
    // brief's literal order, which predates that ruling.
    expect(registryOf('gpt')['discovery']).toEqual(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.5']
      .filter((x) => (registryOf('gpt')['discovery'] as string[]).includes(x)));
    expect(fs.existsSync(join(home, '.handoff', 'providers-whitelist.json'))).toBe(false);
    expect(run(['models', 'gpt', 'discovery', 'catalogue']).code).toBe(0);
    expect(registryOf('gpt')['discovery']).toBe('catalogue');
  });

  it('an unknown action is a usage error naming the three', () => {
    run(['models', 'router', 'init', 'openrouter']);
    const r = run(['models', 'router', 'discovery', 'purge']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toContain('catalogue');
  });

  it('catalogue takes no model id', () => {
    run(['models', 'router', 'init', 'openrouter']);
    const r = run(['models', 'router', 'discovery', 'catalogue', 'gpt-5.5']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });

  // Fix round 1, Finding 1: the pre-check `show` call used to re-label EVERY
  // node refusal as `no-answer` — the empty-body seam's reserved "the build
  // is broken, redeploy" code — discarding node's own diagnosis. `ghost` is
  // never created in this describe block, so its `id` passes `_models_id_ok`
  // (a legal shape, not a reserved word) and reaches node, which refuses
  // `no-such-account` — the most common operator mistake this pre-check can
  // hit: a typo'd or already-removed id.
  it('a typo\'d or removed id gets node\'s own no-such-account, not a masked no-answer', () => {
    const r = run(['models', 'ghost', 'discovery', 'add', 'gpt-5.5']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('no-such-account');
  });

  describe('the ownership whitelist, on an openrouter lane only (§5)', () => {
    beforeEach(() => {
      run(['models', 'router', 'init', 'openrouter']);
      writeSecrets();
    });

    it('admits a model a whitelisted provider serves, and says which', () => {
      whitelist(['fireworks']);
      const r = run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'],
        { CCRC_MODELS_PROBE_FIXTURE: endpointsFixture(['Fireworks', 'Z.AI']) });
      expect(r.code).toBe(0);
      expect(oneObject(r)['servedBy']).toEqual(['fireworks']);
      expect(registryOf('router')['discovery']).toEqual(['z-ai/glm-5.2']);
    });

    it('refuses when no whitelisted provider serves it, and writes nothing', () => {
      whitelist(['fireworks']);
      const r = run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'],
        { CCRC_MODELS_PROBE_FIXTURE: endpointsFixture(['Z.AI']) });
      expect(r.code).toBe(1);
      expect(oneObject(r)['error']).toBe('no-allowed-provider');
      expect(registryOf('router')['discovery']).toEqual([]);
    });

    it('refuses when the endpoints call itself fails, and writes nothing', () => {
      whitelist(['fireworks']);
      const r = run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'],
        { CCRC_MODELS_PROBE_FIXTURE: join(home, 'nope') });
      expect(r.code).toBe(1);
      expect(oneObject(r)['error']).toBe('endpoints-unreachable');
      expect(registryOf('router')['discovery']).toEqual([]);
    });

    it('rm never asks the whitelist question — removing needs no permission', () => {
      whitelist(['fireworks']);
      run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'],
        { CCRC_MODELS_PROBE_FIXTURE: endpointsFixture(['Fireworks']) });
      const r = run(['models', 'router', 'discovery', 'rm', 'z-ai/glm-5.2']);
      expect(r.code).toBe(0);
      expect(registryOf('router')['discovery']).toEqual([]);
    });

    it('leaves no endpoints temp file behind', () => {
      // Tightened per the brief's own Step 8 caveat: measured on this box,
      // `_plat_mktemp`'s bare `mktemp` call (CCD_OS=linux, the non-darwin arm)
      // DOES honour $TMPDIR, and its default name (`tmp.XXXXXXXXXX`) carries
      // no "endpoints" substring — so a leak would land outside `home` AND
      // fail the old filter's own name check. Pointing $TMPDIR at an empty
      // directory this test owns, and asserting THAT directory ends up empty,
      // is what actually observes the leak this case exists to catch.
      whitelist(['fireworks']);
      const tmpdir = join(home, 'tmpdir-for-endpoints');
      fs.mkdirSync(tmpdir);
      run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'],
        { CCRC_MODELS_PROBE_FIXTURE: endpointsFixture(['Fireworks']), TMPDIR: tmpdir });
      expect(fs.readdirSync(tmpdir)).toEqual([]);
    });

    // Controller ruling on `_models_endpoints` (Task 8, predates the brief):
    // the probe has no lane context, so a lane with no `exec.secretsFile` and
    // no ambient key gets the probe's OWN refusal, surfaced unchanged.
    it('with no secrets file and no ambient token, refuses with the probe\'s own message', () => {
      fs.rmSync(join(home, '.secrets', 'router.env'));
      const r = run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'], { ANTHROPIC_AUTH_TOKEN: '' });
      expect(r.code).toBe(1);
      expect(oneObject(r)['error']).toBe('endpoints-unreachable');
      expect(String(oneObject(r)['detail'])).toContain('needs the lane\'s key: set ANTHROPIC_AUTH_TOKEN');
    });

    // No CCRC_MODELS_PROBE_FIXTURE here — the fixture seam bypasses the token
    // check entirely, so it cannot prove the token flowed anywhere. Instead
    // this drives the REAL openrouter fetch arm, whose `curl` the harness
    // poisons: the poison harness records curl's own argv AND its stdin
    // separately (C13: the header travels on stdin via `curl -K -`, never
    // argv), so a `Bearer lane-token` on STDIN proves the secrets file's
    // token reached the probe's request while argv stays clean — and neither
    // reaches ccrc's own environment or output. Measured: dropping `export`
    // from the secrets file (`writeSecrets(false)`) leaves the subshell's
    // ANTHROPIC_AUTH_TOKEN unexported, so `exec`ing the probe does not
    // inherit it, the probe's own token gate refuses BEFORE curl runs, and
    // this case reds.
    it('sources the lane\'s secrets file for the probe; the token never reaches ccrc\'s own output', () => {
      const r = run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2']);
      expect(r.code).toBe(1);
      expect(oneObject(r)['error']).toBe('endpoints-unreachable');
      expect(poisonStdin('curl')).toContain('Bearer lane-token');
      expect(poisonLog('curl').join('\n')).not.toContain('lane-token');
      expect(poisonLog('curl').join('\n')).not.toContain('Authorization');
      expect(r.stdout).not.toContain('lane-token');
      expect(r.stderr).not.toContain('lane-token');
    });
  });

  // Fix round 1, Finding 2 (superseded by the final wave's C3 fix):
  // `_models_endpoints`'s `else` (ambient-environment) branch — taken when the
  // roster row has NO `exec.secretsFile` at all — was executed by zero tests.
  // `router`'s "no secrets file" case only deletes the FILE while the row
  // still declares one, which stops at the `[ -r ]` guard inside the `if`
  // branch. `router2` carries no `secretsFile` in the roster at all, so
  // `secrets` is empty and this describe's cases are the ones that actually
  // reach the `else`. C3 (final wave): `_models_run_probe` now unsets the
  // credential names the probe honours in BOTH branches before running it, so
  // there is no longer an "ambient environment" for a secrets-file-less lane
  // to inherit — a lane with no secrets file gets NO token, full stop, and
  // always surfaces the probe's own refusal, whatever the calling shell
  // happens to be carrying.
  describe('the ambient-environment branch, on a lane with no exec.secretsFile (§5)', () => {
    beforeEach(() => { run(['models', 'router2', 'init', 'openrouter']); });

    it('with no ambient token, refuses with the probe\'s own message', () => {
      const r = run(['models', 'router2', 'discovery', 'add', 'z-ai/glm-5.2'], { ANTHROPIC_AUTH_TOKEN: '' });
      expect(r.code).toBe(1);
      expect(oneObject(r)['error']).toBe('endpoints-unreachable');
      expect(String(oneObject(r)['detail'])).toContain('needs the lane\'s key: set ANTHROPIC_AUTH_TOKEN');
    });

    // C3: the ambient token here stands in for another lane's key already
    // sitting in the calling shell's environment — exactly what
    // `shared/wrapper.mjs`'s generated wrapper sources before exec'ing
    // `claude`. MEASURED before the fix: this reached curl as `Bearer
    // ambient-token`, i.e. a lane with no secrets file forwarded whatever key
    // the calling session happened to carry. After the fix, `_models_run_
    // probe` unsets it before the probe ever runs, so router2 never sees it
    // and the probe refuses before curl is invoked at all.
    it('with an ambient token, still refuses — a lane with no secrets file never sees the calling shell\'s own key', () => {
      const r = run(['models', 'router2', 'discovery', 'add', 'z-ai/glm-5.2'],
        { ANTHROPIC_AUTH_TOKEN: 'ambient-token' });
      expect(r.code).toBe(1);
      expect(oneObject(r)['error']).toBe('endpoints-unreachable');
      expect(String(oneObject(r)['detail'])).toContain('needs the lane\'s key: set ANTHROPIC_AUTH_TOKEN');
      expect(poisonLog('curl')).toEqual([]);
      expect(r.stdout).not.toContain('ambient-token');
      expect(r.stderr).not.toContain('ambient-token');
    });
  });

  // C3: the `compatible` arm is the one the finding's own repro exercises —
  // an ambient `ANTHROPIC_AUTH_TOKEN` (another lane's key, already in the
  // calling shell) reaching THIS lane's `baseUrl`, a host that key was never
  // issued for. Same fix, same shape as the openrouter case above: no secrets
  // file means no token reaches curl, whatever the calling shell carries.
  it('C3: a compatible lane with no secrets file never forwards an ambient token to its own baseUrl either', () => {
    run(['models', 'router2', 'init', 'compatible', '--base-url', 'https://vendor.example.com']);
    const r = run(['models', 'refresh', 'router2'], { ANTHROPIC_AUTH_TOKEN: 'ambient-token' });
    expect(r.code).toBe(1);
    expect(poisonLog('curl').join('\n')).not.toContain('ambient-token');
    expect(poisonLog('curl').join('\n')).not.toContain('Authorization');
    expect(r.stdout).not.toContain('ambient-token');
    expect(r.stderr).not.toContain('ambient-token');
  });
});

describe('ccrc models <id> rm (§4.1 Lifecycle, §10, §11) — reap, not a mutation', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
  });

  it('removes all four files and clears exactly the eight env keys, leaving another env key', () => {
    const p = join(home, '.claude-gpt', 'settings.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.env.DISABLE_TELEMETRY = '1';
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    const r = run(['models', 'gpt', 'rm']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['ok']).toBe(true);
    expect((b['removed'] as string[]).length).toBe(4);
    expect(b['settings']).toBe('cleared');
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.classes.json'))).toBe(false);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.json'))).toBe(false);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.classes.tsv'))).toBe(false);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.effort.json'))).toBe(false);
    const after = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(after.env.DISABLE_TELEMETRY).toBe('1');
    expect(Object.keys(after.env)).not.toContain('ANTHROPIC_MODEL');
  });

  it('a second run exits 0 with removed: []', () => {
    run(['models', 'gpt', 'rm']);
    const r = run(['models', 'gpt', 'rm']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['removed']).toEqual([]);
  });

  it('refuses an argument at exit 2', () => {
    const r = run(['models', 'gpt', 'rm', 'extra']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });

  it('an orphan — a registry for an id the fixture roster has no row for — reports settings: orphan', () => {
    fs.writeFileSync(join(home, '.ccrc', 'models', 'ghost.classes.json'),
      fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.classes.json'), 'utf8'));
    const r = run(['models', 'ghost', 'rm']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['settings']).toBe('orphan');
  });
});

describe('ccrc models refresh', () => {
  // Controller ruling on this task: a successfully-refreshed CODEX lane now
  // runs the litellm step (§5), which shells out to `pgrep` (is the proxy
  // running?) and, conditionally, `ccgpt stop`. The fixture HOME rule forbids
  // reaching this box's real binaries, so every test in this describe gets a
  // functional stub — not just the ones that name `gpt` explicitly — planted
  // BEFORE each case, the same shape `describe('ccrc models litellm')`'s own
  // `pgrep`/`ccgpt` helpers use. Harmless for a test that never refreshes a
  // codex lane: the litellm step never runs there (§5, "non-codex lanes never
  // trigger the litellm step"), so the stub just sits unused.
  beforeEach(() => {
    fs.writeFileSync(join(home, '.local', 'bin', 'pgrep'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/pgrep-calls"\nexit 1\n', { mode: 0o755 });
    fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/ccgpt-calls"\nexit 0\n', { mode: 0o755 });
  });

  it('with no argument is a usage error naming both forms', () => {
    const r = run(['models', 'refresh']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toContain('--all');
  });

  it('refreshes one lane and writes its catalogue', () => {
    run(['models', 'gpt', 'init', 'codex']);
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['ok']).toBe(true);
    expect(b['refreshed']).toEqual([{ id: 'gpt', probe: 'codex', ok: true, count: 9, litellm: 'rendered' }]);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.json'))).toBe(true);
  });

  it('re-materialises the lane it refreshed, so the effort file is freshly rewritten from the new catalogue', () => {
    // Fix round 1, Finding 3: the original version of this test set no
    // effort level of its own, so `SEEDS.codex`'s own `effort` map (written,
    // unvalidated, by `init`'s OWN materialise call, before any catalogue
    // exists) was byte-identical to what `refresh`'s re-materialise would
    // separately produce — the test stayed green with that re-materialise
    // call deleted entirely (measured directly).
    //
    // A CONTENT-based fix (e.g. `set-effort haiku ultra` before any catalogue
    // exists, expecting the catalogue to DROP it once one arrives) does not
    // work either — measured directly, not just reasoned: `parseRegistry`
    // (`shared/models.mjs`) and `effortFile` (`shared/modelenv.mjs`) run the
    // IDENTICAL "does the classed model's own `efforts` list include this
    // level" check against the SAME catalogue, and `materialise`'s general op
    // path calls `readRegistry` — which runs `parseRegistry` — BEFORE it ever
    // calls `effortFile`. So a level the new catalogue would have DROPPED
    // instead makes the whole re-materialise call REFUSE (`registry-invalid`)
    // first, and that refusal is swallowed by refresh's own `|| true` (the
    // deferred masking minor) — leaving the file exactly as stale as if
    // refresh's materialise call had never run at all: no observable
    // difference, for the same underlying reason as the original bug.
    // `effortFile`'s own "dropped, not refused" case is consequently
    // unreachable through this call path for ANY registry that stays valid.
    //
    // What genuinely differs, provably, on every refresh — independent of
    // registry content — is that `materialise` always does a fresh
    // `writeFileSync(tmp) + renameSync(tmp, path)` (`deploy/models-op.mjs`),
    // which replaces the file's INODE even when the bytes it writes are
    // identical. `test/ccd-swap-carry.test.ts` and
    // `test/install-graphify-skill.test.ts` use the same `.ino` idiom for
    // "was this file freshly rewritten, not merely left alone". Measured:
    // with the mutation below (deleting the materialise call), the inode is
    // IDENTICAL before and after, because nothing touches the file during
    // refresh at all.
    run(['models', 'gpt', 'init', 'codex']);
    const effortPath = join(home, '.ccrc', 'models', 'gpt.effort.json');
    const before = fs.statSync(effortPath).ino;
    run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const after = fs.statSync(effortPath).ino;
    expect(after).not.toBe(before);
    // The content itself is, correctly, unchanged (SEEDS.codex's own
    // haiku/sonnet/opus levels are all valid against CODEX_RAW) — the TSV
    // sibling test below is what a CONTENT difference (a RETIRED class)
    // actually looks like.
    expect(JSON.parse(fs.readFileSync(effortPath, 'utf8')))
      .toEqual({ byModel: { 'gpt-5.6-luna': 'high', 'gpt-5.6-terra': 'high', 'gpt-5.6-sol': 'max' } });
  });

  it('re-materialises the TSV too, so a RETIRED class is visible to ccd', () => {
    run(['models', 'gpt', 'init', 'codex']);
    run(['models', 'gpt', 'set-class', 'sonnet', 'gpt-5.5-mini']);
    run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.classes.tsv'), 'utf8'))
      .toContain('sonnet\tgpt-5.5-mini\tretired\n');
  });

  it('--all probes every lane that HAS a registry, and no others', () => {
    // The probe kind lives in the registry file (round-2 ruling 10), so a lane
    // without one has no probe to run — asking would be a question with no
    // answer. `router` is initialised too, so this run is a MIXED result:
    // its normaliser refuses a Codex body.
    run(['models', 'gpt', 'init', 'codex']);
    run(['models', 'router', 'init', 'openrouter']);
    const r = run(['models', 'refresh', '--all'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const refreshed = oneObject(r)['refreshed'] as { id: string }[];
    expect(refreshed.map((x) => x.id)).toEqual(['gpt', 'router']);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'claude-a.json'))).toBe(false);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'claude.json'))).toBe(false);
  });

  it('--all with NO registries anywhere is an empty, successful run', () => {
    const r = run(['models', 'refresh', '--all']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['refreshed']).toEqual([]);
  });

  it('--all exits 1 when any lane failed, and still reports the ones that worked', () => {
    run(['models', 'gpt', 'init', 'codex']);
    run(['models', 'router', 'init', 'openrouter']);
    const r = run(['models', 'refresh', '--all'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(1);
    const rows = oneObject(r)['refreshed'] as { id: string; ok: boolean }[];
    expect(rows.find((x) => x.id === 'gpt')!.ok).toBe(true);
    expect(rows.find((x) => x.id === 'router')!.ok).toBe(false);
  });

  // C7 (second half): re-materialise's failure used to be swallowed
  // (`_models_node materialise ... || true`), so a lane whose catalogue had
  // just refreshed kept reporting `ok:true` with a fresh `count` while its
  // TSV/settings.json stayed STALE — the exact silent-drift shape the row's
  // own STOP-THEN-WRITE comment already refuses for LiteLLM. Forcing
  // materialise to fail deterministically: pre-creating a DIRECTORY at the
  // TSV path it writes means its `renameSync(tmp, p)` throws (p is not a
  // file), the same failure shape a permissions or disk-full problem would
  // produce on a real box.
  it('a lane whose re-materialise fails is a FAILED row, and litellm never runs (C7)', () => {
    run(['models', 'gpt', 'init', 'codex']);
    const tsvPath = join(home, '.ccrc', 'models', 'gpt.classes.tsv');
    fs.rmSync(tsvPath, { force: true });
    fs.mkdirSync(tsvPath);
    const r = run(['models', 'refresh', '--all'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['ok']).toBe(false);
    const rows = b['refreshed'] as { id: string; ok: boolean; reason?: string; litellm?: string }[];
    expect(rows).toEqual([{ id: 'gpt', ok: false, reason: expect.any(String) }]);
    expect(rows[0]!.reason!.length).toBeGreaterThan(0);
    // The probe's own effect stands (§6.1 amendment: a failed materialise
    // does not undo a successful catalogue fetch) — only the derived files
    // and the LiteLLM step, which reads them, are what the failure gates.
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.json'))).toBe(true);
    expect(fs.existsSync(join(home, '.handoff', 'litellm-config.yaml'))).toBe(false);
    expect(fs.existsSync(join(home, 'ccgpt-calls')), 'the litellm step must never run when materialise failed').toBe(false);
  });

  it('refuses an id the roster does not have', () => {
    const r = run(['models', 'refresh', 'ghost']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('no-such-lane');
  });

  it('refuses a lane with no registry, naming init', () => {
    const r = run(['models', 'refresh', 'gpt']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('no-such-lane');
    expect(String(oneObject(r)['detail'])).toMatch(/init/);
  });

  it('refuses an anthropic lane by name — there is nothing to probe (§5)', () => {
    const r = run(['models', 'refresh', 'claude-a']);
    expect(r.code).toBe(1);
    expect(String(oneObject(r)['detail'])).toMatch(/Claude Code's own defaults/);
  });

  it('passes a compatible lane\'s baseUrl to the probe', () => {
    run(['models', 'router', 'init', 'compatible', '--base-url', 'https://api.cortecs.ai']);
    const r = run(['models', 'refresh', 'router'], { CCRC_MODELS_PROBE_FIXTURE: COMPAT_RAW });
    expect(r.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', 'router.json'), 'utf8')).probe)
      .toBe('compatible');
  });

  // Controller ruling on this task (predates the brief): `_models_refresh_one`
  // runs the probe through the SAME secrets-sourcing subshell
  // `_models_endpoints` uses — factored into `_models_run_probe` — so a
  // `compatible` lane's catalogue fetch (which sends `ANTHROPIC_AUTH_TOKEN` as
  // a Bearer header, `ccrc-models-probe`'s `compatible` fetch arm) gets the
  // lane's key too. No `CCRC_MODELS_PROBE_FIXTURE` here — that seam bypasses
  // the fetch (and so the header) entirely, so it cannot prove the token
  // flowed anywhere; this drives the REAL `compatible` fetch arm, whose
  // `curl` the harness poisons, exactly as the discovery describe block's own
  // served-by test does for `_models_endpoints`. The poison harness records
  // curl's own argv AND its stdin separately (C13: the header travels on
  // stdin via `curl -K -`, never argv) — a `Bearer lane-token` on STDIN
  // proves the secrets file's token reached the probe's request while argv
  // stays clean, and the failing curl (poison exits 97) is what "refresh"
  // being wired straight through the real fetch arm looks like on this box:
  // the catalogue fetch fails, the lane's previous (nonexistent) catalogue
  // stays absent, and the run reports that one lane failed.
  it('sources the lane\'s secrets file for the compatible probe too; the token never reaches ccrc\'s own output', () => {
    fs.mkdirSync(join(home, '.secrets'), { recursive: true });
    fs.writeFileSync(join(home, '.secrets', 'router.env'), 'export ANTHROPIC_AUTH_TOKEN=lane-token\n');
    run(['models', 'router', 'init', 'compatible', '--base-url', 'https://api.cortecs.ai']);
    const r = run(['models', 'refresh', 'router']);
    expect(r.code).toBe(1);
    // Fix round 1, Finding 2 (ruling): every failed row now carries `reason`
    // (the probe's own first stderr line) — `count` dropped from a failed
    // row entirely, since it was always 0 and never a fact about the lane.
    const refreshed = oneObject(r)['refreshed'] as { id: string; probe: string; ok: boolean; reason: string }[];
    expect(refreshed).toEqual([{ id: 'router', probe: 'compatible', ok: false, reason: expect.any(String) }]);
    expect(refreshed[0]!.reason.length).toBeGreaterThan(0);
    expect(poisonStdin('curl')).toContain('Bearer lane-token');
    expect(poisonLog('curl').join('\n')).not.toContain('lane-token');
    expect(poisonLog('curl').join('\n')).not.toContain('Authorization');
    expect(r.stdout).not.toContain('lane-token');
    expect(r.stderr).not.toContain('lane-token');
  });

  it('a single-lane failure exits 1 and leaves the previous catalogue stale, not deleted', () => {
    run(['models', 'gpt', 'init', 'codex']);
    run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: join(home, 'nope') });
    expect(r.code).toBe(1);
    const cat = JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.json'), 'utf8'));
    expect(cat.stale).toBe(true);
    expect(cat.models).toHaveLength(9);
  });

  it('takes one lane id or --all and nothing more', () => {
    const r = run(['models', 'refresh', 'gpt', '--all']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });

  // Fix round 1, Finding 1: `_models_answer lanes --file "$file"` can return
  // non-zero carrying a LEGITIMATE refusal body from node (a corrupt
  // accounts.json is the reachable case; the half-updated-box `no-answer`
  // seam is the other). The old `|| exit $?` captured that body into `$lanes`
  // (a command-substitution local) and exited without ever printing it —
  // empty stdout, a real refusal silently lost. `oneObject()` is what would
  // have caught it: an empty-stdout run fails on "stdout carried 0 lines, not
  // one" before ever reaching `error`.
  it('a corrupt accounts.json is reported as node\'s own refusal, not an empty stdout (Fix round 1, Finding 1)', () => {
    fs.writeFileSync(join(home, '.ccrc', 'accounts.json'), '{not json');
    const r = run(['models', 'refresh', '--all']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('roster-invalid');
  });

  // Fix round 1, Finding 2 (ruling): `hasRegistry` used to be computed AFTER
  // a catalogue-read shortcut that treated a broken CATALOGUE as "no
  // registry at all" — hiding the one lane `readCatalogue`'s own refusal text
  // names `ccrc models refresh <id>` as the remedy for. `readRegistry` now
  // always runs, so a valid registry behind a corrupt catalogue is still
  // found and still refreshed.
  it('a lane whose catalogue is corrupt is still refreshed, and repaired (Fix round 1, Finding 2)', () => {
    // `init` itself refuses on an already-broken catalogue file (the general
    // op path's early `cat.err` gate), so the registry has to be seeded
    // first, with no catalogue file yet, and the catalogue corrupted after.
    run(['models', 'gpt', 'init', 'codex']);
    fs.writeFileSync(join(home, '.ccrc', 'models', 'gpt.json'), '{"probe":"gemini"}');
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(0);
    expect(oneObject(r)['refreshed'])
      .toEqual([{ id: 'gpt', probe: 'codex', ok: true, count: 9, litellm: 'rendered' }]);
    const cat = JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.json'), 'utf8'));
    expect(cat.models).toHaveLength(9);
  });

  // The other half of the same ruling: a REGISTRY that exists but does not
  // parse/validate is `hasRegistry: true` with `probe: null` — the old code
  // fed the literal string "null" to the probe as its probe kind. Such a row
  // is now reported as a failed row named by the registry's own message,
  // without ever reaching the probe.
  it('a lane whose registry does not parse/validate is a failed row with a reason, and never reaches the probe (Fix round 1, Finding 2)', () => {
    fs.mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
    // No `subagent` key — the same fixture `models-op.test.ts`'s own
    // registry-invalid case uses.
    fs.writeFileSync(join(home, '.ccrc', 'models', 'gpt.classes.json'),
      JSON.stringify({ probe: 'codex', classes: { haiku: null, sonnet: null, opus: null, fable: null } }));
    const r = run(['models', 'refresh', '--all'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(1);
    const rows = oneObject(r)['refreshed'] as Record<string, unknown>[];
    const row = rows.find((x) => x['id'] === 'gpt')!;
    expect(row['ok']).toBe(false);
    expect(String(row['reason'])).toContain('subagent');
    expect('probe' in row).toBe(false);
    expect('count' in row).toBe(false);
    // The probe was never invoked: no catalogue landed for this lane.
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.json'))).toBe(false);
  });

  it('refresh <id> on a lane whose registry does not parse/validate refuses with that message, not no-such-lane (Fix round 1, Finding 2)', () => {
    fs.mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
    fs.writeFileSync(join(home, '.ccrc', 'models', 'gpt.classes.json'),
      JSON.stringify({ probe: 'codex', classes: { haiku: null, sonnet: null, opus: null, fable: null } }));
    const r = run(['models', 'refresh', 'gpt']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('registry-invalid');
    expect(String(oneObject(r)['detail'])).toContain('subagent');
  });

  // Controller ruling on this task: the beforeEach's functional stubs prove
  // the litellm step BEHAVES correctly; this proves it never falls through to
  // whatever real `pgrep`/`ccgpt` this box happens to have on PATH if a stub
  // were ever missing — the same poisoned-tools pattern `env()` uses for
  // curl, systemctl and launchctl (`poisonLog`), applied here to the two
  // binaries this step is new for. Poisoned rather than stubbed: both always
  // exit 97 and log their argv, so `_models_litellm_running`'s nonzero-exit
  // "not running" reading holds even under a poison, and the assertion is
  // that `ccgpt`'s poison log — the restart step — stays EMPTY: a restart is
  // not expected when nothing looks like it is running.
  it('never reaches a real pgrep or ccgpt — poisoned, and no restart fires when neither looks running', () => {
    fs.writeFileSync(join(home, '.local', 'bin', 'pgrep'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/pgrep-poison"\n'
      + 'echo "ccrc tests must never reach a real pgrep" >&2\nexit 97\n', { mode: 0o755 });
    fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/ccgpt-poison"\n'
      + 'echo "ccrc tests must never reach a real ccgpt" >&2\nexit 97\n', { mode: 0o755 });
    run(['models', 'gpt', 'init', 'codex']);
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(0);
    expect(poisonLog('ccgpt')).toEqual([]);
  });
});

describe('ccrc models litellm', () => {
  const configPath = (): string => join(home, '.handoff', 'litellm-config.yaml');

  /** A `pgrep` that answers "LiteLLM is running" or "it is not", and records
   *  its argv — the probe `ccrc` uses to decide whether a restart is owed. */
  const pgrep = (running: boolean): void =>
    fs.writeFileSync(join(home, '.local', 'bin', 'pgrep'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/pgrep-calls"\n${running ? 'echo 4242\nexit 0' : 'exit 1'}\n`,
      { mode: 0o755 });

  /** A `ccgpt` that records its argv instead of stopping a real proxy. */
  const ccgpt = (): void =>
    fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/ccgpt-calls"\nexit 0\n', { mode: 0o755 });

  const calls = (name: string): string[] => {
    const p = join(home, `${name}-calls`);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
  };

  beforeEach(() => {
    pgrep(false); ccgpt();
    run(['models', 'gpt', 'init', 'codex']);
    run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    fs.rmSync(join(home, 'ccgpt-calls'), { force: true });
    fs.rmSync(configPath(), { force: true });
    fs.rmSync(`${configPath()}.prev`, { force: true });
  });

  it('renders the config from the lane\'s catalogue, with no reasoning key', () => {
    const r = run(['models', 'litellm', 'gpt']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['changed']).toBe(true);
    const yaml = fs.readFileSync(configPath(), 'utf8');
    // Scoped to the GENERATED block, not the whole file — the shipped
    // template's own header comment (carried verbatim) legitimately says
    // "reasoning" explaining why there is none; `litellm-render.test.ts`'s
    // own template-level case already bans a literal `reasoning:` key
    // anywhere, including in a comment.
    expect(yaml.slice(yaml.indexOf('model_list:'), yaml.indexOf('litellm_settings:'))).not.toContain('reasoning');
    expect(yaml).toContain('  - model_name: gpt-6-astra');
    // No `[1m]` alias in the GENERATED block (§6.3, amended 2026-09-08, Task
    // 16c; scoped in fix round 1 — the template's own header comment, carried
    // verbatim, now legitimately says `[1m]` explaining why there is none, so
    // a whole-file ban would fail on that prose, same as the `reasoning` ban
    // above). A fleet-host measurement found the catalogue's advertised
    // context is not the usable one, so the generator stops emitting a name
    // that would tell Claude Code it has 1M of room — the backend has no such
    // NAME (the removed alias mapped to the real id all along); the client's
    // window BELIEF was the lie (2026-07-26).
    expect(yaml.slice(yaml.indexOf('model_list:'), yaml.indexOf('litellm_settings:'))).not.toMatch(/\[1m\]/);
    expect(yaml).not.toContain('gpt-reserve');
  });

  it('is idempotent — a second run reports changed:false and touches nothing', () => {
    run(['models', 'litellm', 'gpt']);
    const before = fs.statSync(configPath()).mtimeMs;
    const r = run(['models', 'litellm', 'gpt']);
    expect(oneObject(r)['changed']).toBe(false);
    expect(fs.statSync(configPath()).mtimeMs).toBe(before);
  });

  it('keeps the previous config beside the new one', () => {
    fs.mkdirSync(join(home, '.handoff'), { recursive: true });
    fs.writeFileSync(configPath(), 'model_list: []\n');
    run(['models', 'litellm', 'gpt']);
    expect(fs.readFileSync(`${configPath()}.prev`, 'utf8')).toBe('model_list: []\n');
  });

  it('does NOT restart LiteLLM when it is not running', () => {
    run(['models', 'litellm', 'gpt']);
    expect(calls('ccgpt')).toEqual([]);
  });

  it('restarts LiteLLM when it IS running and the config changed, and says it did', () => {
    pgrep(true);
    const r = run(['models', 'litellm', 'gpt']);
    expect(r.code).toBe(0);
    expect(calls('ccgpt')).toEqual(['stop']);
    expect(r.stderr).toMatch(/stopped the running LiteLLM proxy/);
  });

  it('does NOT restart when the config did not change, even if it is running', () => {
    run(['models', 'litellm', 'gpt']);
    pgrep(true);
    fs.rmSync(join(home, 'ccgpt-calls'), { force: true });
    run(['models', 'litellm', 'gpt']);
    expect(calls('ccgpt')).toEqual([]);
  });

  // Fix round 1 (this task, controller ruling): STOP-THEN-WRITE. A running
  // proxy that will not stop must refuse BEFORE the op ever writes, so the
  // next run sees the same difference and retries — writing first and only
  // then discovering the stop failed would leave the new config already on
  // disk, reporting "unchanged" forever after, while the box keeps serving
  // the stale rendering with no operator signal.
  it('refuses when a running proxy will not stop, and writes nothing', () => {
    pgrep(true);
    fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/ccgpt-calls"\nexit 1\n', { mode: 0o755 });
    const r = run(['models', 'litellm', 'gpt']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['ok']).toBe(false);
    expect(b['error']).toBe('restart-failed');
    expect(fs.existsSync(configPath())).toBe(false);
    expect(fs.existsSync(`${configPath()}.prev`)).toBe(false);
  });

  it('restarts (a successful stop) and writes, reporting restarted:true', () => {
    fs.mkdirSync(join(home, '.handoff'), { recursive: true });
    fs.writeFileSync(configPath(), 'model_list: []\n');
    pgrep(true);
    const r = run(['models', 'litellm', 'gpt']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['changed']).toBe(true);
    expect(b['restarted']).toBe(true);
    expect(calls('ccgpt')).toEqual(['stop']);
    expect(fs.readFileSync(`${configPath()}.prev`, 'utf8')).toBe('model_list: []\n');
  });

  it('a second run after a failed stop retries once the proxy can be stopped', () => {
    pgrep(true);
    fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/ccgpt-calls"\nexit 1\n', { mode: 0o755 });
    const r1 = run(['models', 'litellm', 'gpt']);
    expect(r1.code).toBe(1);
    expect(fs.existsSync(configPath())).toBe(false);
    ccgpt();
    const r2 = run(['models', 'litellm', 'gpt']);
    expect(r2.code).toBe(0);
    expect(oneObject(r2)['changed']).toBe(true);
    expect(fs.existsSync(configPath())).toBe(true);
  });

  it('refuses a never-probed lane rather than rendering an empty list', () => {
    fs.rmSync(join(home, '.ccrc', 'models', 'gpt.json'));
    const r = run(['models', 'litellm', 'gpt']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('never-probed');
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it('refuses a lane whose probe is not codex', () => {
    run(['models', 'router', 'init', 'openrouter']);
    const r = run(['models', 'litellm', 'router']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('not-a-codex-lane');
  });

  it('needs an id', () => {
    expect(run(['models', 'litellm']).code).toBe(2);
  });
});

describe('refresh runs the litellm step for a codex lane (§5)', () => {
  const configPath = (): string => join(home, '.handoff', 'litellm-config.yaml');
  beforeEach(() => {
    fs.writeFileSync(join(home, '.local', 'bin', 'pgrep'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    run(['models', 'gpt', 'init', 'codex']);
  });

  it('a first refresh of the gpt lane renders the config', () => {
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(0);
    expect(fs.existsSync(configPath())).toBe(true);
    expect((oneObject(r)['refreshed'] as { litellm: string }[])[0]!.litellm).toBe('rendered');
  });

  it('a second refresh with the same catalogue leaves it alone', () => {
    run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const before = fs.statSync(configPath()).mtimeMs;
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(fs.statSync(configPath()).mtimeMs).toBe(before);
    expect((oneObject(r)['refreshed'] as { litellm: string }[])[0]!.litellm).toBe('unchanged');
  });

  it('a non-Codex lane\'s refresh never touches the LiteLLM config', () => {
    run(['models', 'router', 'init', 'openrouter']);
    const orRaw = join(here, 'fixtures', 'catalogues', 'openrouter-raw-page.json');
    run(['models', 'refresh', 'router'], { CCRC_MODELS_PROBE_FIXTURE: orRaw });
    expect(fs.existsSync(configPath())).toBe(false);
  });

  // Fix round 1 (this task, controller ruling): a lane whose litellm step
  // refuses (a running proxy that will not stop) is a FAILED row, and the
  // whole run's exit code follows it — an `ok:true` row that quietly named a
  // failure was exactly the bug (the hourly `refresh --all` exiting 0 while
  // the box served the previous model list). The catalogue probe itself still
  // succeeded and its effects stand — the lane's catalogue is on disk — but
  // the LiteLLM config, having refused to write, is not.
  it('a lane whose restart fails is a FAILED row, and the run exits 1', () => {
    fs.writeFileSync(join(home, '.local', 'bin', 'pgrep'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/pgrep-calls"\necho 4242\nexit 0\n`, { mode: 0o755 });
    fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/ccgpt-calls"\nexit 1\n', { mode: 0o755 });
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['ok']).toBe(false);
    const rows = b['refreshed'] as { id: string; ok: boolean; reason?: string }[];
    expect(rows).toEqual([{ id: 'gpt', ok: false, reason: expect.any(String) }]);
    expect(rows[0]!.reason).toMatch(/could not be stopped/);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.json'))).toBe(true);
    expect(fs.existsSync(configPath())).toBe(false);
  });
});
