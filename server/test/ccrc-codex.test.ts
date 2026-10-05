// `ccd/ccrc`'s Codex lane library (Plan 2b-2) — what every `ccrc codex` verb,
// the `ccrc-codex` launcher and the install spine read a lane THROUGH. This
// file owns what the library ANSWERS; the verbs that act on those answers are
// the lifecycle describes below the library's (Task 5 appends them).
//
// ── HOW IT IS CONTAINED ───────────────────────────────────────────────────
//  1. HOME is a `mkTmp` directory. ccrc is SOURCED from `<home>/ccrc/ccd/ccrc`
//     — the `BASH_SOURCE` guard at the file's foot exists for this, and
//     `ccrc-account.test.ts`'s `sourceCall` is the idiom — so `CCRC_HERE`
//     resolves `../deploy/models-op.mjs` and `ccrc-wrapper-shape` the way a
//     deployed box does.
//  2. `plantSystemd` writes a FUNCTIONAL fake `systemctl` and a recording
//     `systemd-run` into `<home>/.local/bin` BEFORE `ghContainedEnv(…,
//     {systemd:true})` runs, so its create-if-absent poisons never displace
//     them and nothing here reaches this box's user manager, on which live
//     `ccgpt-*` units run.
//  3. Every listener binds 127.0.0.1 on a port the kernel chose. No case names
//     a fixed port.
//  4. `curl` is poisoned and asserted untouched: the library speaks HTTP over
//     bash's own `/dev/tcp`, because the ccrc install/doctor harnesses poison
//     curl and a probe that needed it would read every lane as unmeasurable.
//  5. This file is NOT in `ccd-workspaces.test.ts`'s name-triggered
//     containment scan (it selects /^ccd.*\.ts$/); the poisons are here
//     because they are right, not because a scanner demands them.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { pythonOrSkip, spawnPy } from './ccgptHarness.js';
import { describeLinux, IS_DARWIN, itLinux } from './platformFixtures.js';
import {
  alive, codexAuthDir, codexRoster, eventually, failUnitStop, fakeUnit, freePorts, killLaneProcesses, laneAnswer,
  litellmEvidence, litellmTeardownEvents, plantCodexBins, plantFakeRuntime, plantLaneConfig, plantSystemd, portAccepts, psArgs,
  refuseLitellmStart, registerLaneCleanup, resistLitellmTerm, slowLitellmListen, spawnFakeLitellm, spawnListener, systemctlCalls, systemdRunArgv,
  systemdRunCalls, trackChild, unitPid,
} from './codexLaneFixture.js';
import type { FakeRuntime, FakeRuntimeOptions } from './codexLaneFixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const PY = pythonOrSkip();
/** Spec §5.4's `runtime.env`, whole: one line, one trailing newline. */
const KEY_FILE = /^LITELLM_MASTER_KEY=sk-[0-9a-f]{48}\n$/;

/** An `exec.kind: "external"` row whose TELEMETRY says codex: the shape of a
 *  Codex lane that another launcher runs. `ext-a` is fixture vocabulary, not
 *  any box's lane. `CCRC_CODEX_BACKEND` names it; the library must never run
 *  it. */
const EXTERNAL_CODEX_TELEMETRY = {
  id: 'ext-a', label: 'ext-a', configDirSuffix: '.claude-ext-a',
  exec: { kind: 'external' }, homeAble: false, telemetry: 'codex',
};

const homes: string[] = [];
afterEach(async () => {
  for (const h of homes.splice(0)) await killLaneProcesses(h);
});

function env(h: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const e = ghContainedEnv(h, { ...process.env, HOME: h }, { systemd: true, tmux: true });
  fs.writeFileSync(join(h, '.local', 'bin', 'curl'),
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/curl-poison"\n'
    + 'echo "the codex lane library must never reach curl" >&2\nexit 97\n', { mode: 0o755 });
  // Nothing ambient steers the library: its own knobs, the tiers' variables,
  // and COLUMNS (which truncates `ps`'s argv — a case sets it deliberately).
  for (const k of Object.keys(e)) {
    if (/^(CCRC_CODEX_|CCGPT_)/.test(k) || ['CHATGPT_TOKEN_DIR', 'LITELLM_MASTER_KEY', 'COLUMNS'].includes(k)) {
      delete e[k];
    }
  }
  return { ...e, ...extra };
}

/** A box: the tree `ccrc` resolves against, the fake manager, the poisons. */
function box(prefix: string, opts: { userManager?: boolean } = {}): string {
  const h = mkTmp(prefix);
  const ccd = join(h, 'ccrc', 'ccd');
  fs.mkdirSync(ccd, { recursive: true });
  for (const f of ['ccrc', 'ccrc-wrapper-shape']) fs.symlinkSync(join(REPO, 'ccd', f), join(ccd, f));
  fs.symlinkSync(join(REPO, 'deploy'), join(h, 'ccrc', 'deploy'));
  fs.symlinkSync(join(REPO, 'shared'), join(h, 'ccrc', 'shared'));
  plantSystemd(h, { userManager: opts.userManager ?? false });   // BEFORE env() — header, point 2
  env(h);
  homes.push(h);
  return h;
}

interface Result { code: number; stdout: string; stderr: string }

/** Source ccrc, then run `script` — one bash, the library's own shell.
 *  `umask 022` FIRST (ruling PF-9, as Tasks 6 and 8 do): a runner whose
 *  ambient umask already gives 0700 would make row 19's mutation (dropping
 *  `umask 077 &&` from the lane-dir `mkdir`) pass by coincidence, and the
 *  0700 pin would bind nothing. */
function lib(h: string, script: string, extra: NodeJS.ProcessEnv = {}): Result {
  const r = spawnSync(BASH, ['-c', `umask 022\n. "${join(h, 'ccrc', 'ccd', 'ccrc')}"\n${script}`],
    { env: env(h, extra), encoding: 'utf8', input: '', timeout: 15_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** `ccrc <args>` as a box runs it. */
function ccrc(h: string, args: string[]): Result {
  const r = spawnSync(BASH, [join(h, 'ccrc', 'ccd', 'ccrc'), ...args],
    { env: env(h), encoding: 'utf8', input: '', timeout: 15_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

type Ports = Record<string, { proxyPort: number; litellmPort: number }>;

/** codex-a (telemetry codex), codex-b (telemetry none), and the external
 *  telemetry-codex row — the roster on which `exec.kind` and
 *  `CCRC_CODEX_BACKEND` disagree in BOTH directions. */
async function twoLanes(h: string): Promise<Ports> {
  const [a1, a2, b1, b2] = await freePorts(4);
  codexRoster(h, [
    { id: 'codex-a', proxyPort: a1!, litellmPort: a2! },
    { id: 'codex-b', proxyPort: b1!, litellmPort: b2!, telemetry: 'none' },
  ], [EXTERNAL_CODEX_TELEMETRY]);
  return { 'codex-a': { proxyPort: a1!, litellmPort: a2! }, 'codex-b': { proxyPort: b1!, litellmPort: b2! } };
}

const laneDir = (h: string, id: string): string => join(h, '.ccrc', 'codex', id);
const laneJson = (h: string, id: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(join(laneDir(h, id), 'lane.json'), 'utf8')) as Record<string, unknown>;
const litellmYaml = (h: string, id: string): string => join(laneDir(h, id), 'litellm.yaml');
const sha256 = (p: string): string => createHash('sha256').update(fs.readFileSync(p)).digest('hex');

describe('_codex_row — one codex lane, read from accounts.json by exec.kind', () => {
  it('sets the six CX_ fields from the row, and says nothing', async () => {
    const h = box('ccrc-codex-row-');
    const p = await twoLanes(h);
    const r = lib(h, '_codex_row codex-a && printf "%s|%s|%s|%s|%s|%s\\n" '
      + '"$CX_ID" "$CX_KIND" "$CX_CFG" "$CX_AUTH" "$CX_PROXY" "$CX_LITELLM"');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(`codex-a|codex|.claude-codex-a|${codexAuthDir('codex-a')}|`
      + `${p['codex-a']!.proxyPort}|${p['codex-a']!.litellmPort}\n`);
    expect(r.stderr).toBe('');
  });

  it('an id the roster lacks is not-rostered, and a refusal empties every CX_ field', async () => {
    const h = box('ccrc-codex-row-absent-');
    await twoLanes(h);
    const r = lib(h, '_codex_row codex-a >/dev/null; _codex_row codex-z; rc=$?; '
      + 'printf "%s|%s|%s|%s\\n" "$rc" "$CX_ID" "$CX_PROXY" "$CX_AUTH"');
    expect(r.stdout).toBe('1|||\n');
    expect(r.stderr).toMatch(/^ccrc codex: not-rostered: account 'codex-z' /m);
  });

  it('an external lane whose telemetry says codex is not-codex — exec.kind decides, never telemetry', async () => {
    const h = box('ccrc-codex-row-external-');
    await twoLanes(h);
    const r = lib(h, '_codex_row ext-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: not-codex: account 'ext-a' is exec\.kind "external"/m);
  });

  it('a malformed id is refused as usage, at rc 2, before any path is built from it', async () => {
    // rc 2 and not 1: `ccrc codex` exits 2 on a usage refusal and 1 on every
    // other one (the ccrc header's exit-code rule), and it can only do that if
    // the library keeps the two apart. The not-rostered case above pins the 1.
    const h = box('ccrc-codex-row-badid-');
    await twoLanes(h);
    const r = lib(h, "_codex_row '../codex-a'");
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc codex: usage: /m);
  });

  it('an unreadable roster is roster-invalid, never not-rostered', async () => {
    const h = box('ccrc-codex-row-broken-');
    await twoLanes(h);
    fs.writeFileSync(join(h, '.ccrc', 'accounts.json'), '{not json');
    const r = lib(h, '_codex_row codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: /m);
    expect(r.stderr).not.toMatch(/not-rostered/);
  });

  it('a box whose ccrc-wrapper-shape is missing is install-incomplete — a refusal, not an unbound-variable crash', async () => {
    const h = box('ccrc-codex-row-noshape-');
    await twoLanes(h);
    fs.rmSync(join(h, 'ccrc', 'ccd', 'ccrc-wrapper-shape'));
    const r = lib(h, '_codex_row codex-a; echo "rc=$?"');
    expect(r.stdout).toBe('rc=1\n');
    expect(r.stderr).toMatch(/^ccrc codex: install-incomplete: /m);
    expect(r.stderr).not.toMatch(/unbound variable/);
  });

  it('a hand-edited row whose two ports are one is roster-invalid', async () => {
    const h = box('ccrc-codex-row-oneport-');
    await twoLanes(h);
    const f = join(h, '.ccrc', 'accounts.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { accounts: Array<{ id: string; exec: Record<string, unknown> }> };
    const a = j.accounts.find((x) => x.id === 'codex-a')!;
    a.exec['litellmPort'] = a.exec['proxyPort'];
    fs.writeFileSync(f, JSON.stringify(j));
    const r = lib(h, '_codex_row codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: .*exec\.proxyPort\/exec\.litellmPort/m);
  });

  it.each([
    ['a relative escape', '../x'],
    ['an absolute path', '/abs'],
    ['empty', ''],
    // Final-review fix wave, D1: `shared/roster.ts`'s `parseAuthDir`, rule
    // for rule — `ccrc codex login` writes the credential into this path, and
    // `ccrc uninstall --purge` empties ~/.ccrc.
    ['~/.ccrc itself', '.ccrc'],
    ['under ~/.ccrc', '.ccrc/tok'],
    ['ending in a separator', '.codex-a/'],
    ['outside the safe charset', 'a b/$(x)'],
    ['a bare dot', '.'],
    ['led by ./', './x'],
    ['carrying /./', 'a/./b'],
  ])('a hand-edited row whose exec.authDir is %s is roster-invalid, and CX_AUTH is emptied', async (_what, authDir) => {
    const h = box('ccrc-codex-row-authdir-');
    await twoLanes(h);
    const f = join(h, '.ccrc', 'accounts.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { accounts: Array<{ id: string; exec: Record<string, unknown> }> };
    const a = j.accounts.find((x) => x.id === 'codex-a')!;
    a.exec['authDir'] = authDir;
    fs.writeFileSync(f, JSON.stringify(j));
    const r = lib(h, '_codex_row codex-a; rc=$?; printf "%s|%s\\n" "$rc" "$CX_AUTH"');
    expect(r.stdout).toBe('1|\n');
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: .*exec\.authDir/m);
  });

  it('an exec.authDir that only BEGINS like ~/.ccrc — a sibling such as .ccrc-backups — is a legal row, as the roster validator reads it (D1\'s control)', async () => {
    const h = box('ccrc-codex-row-authdir-sibling-');
    await twoLanes(h);
    const f = join(h, '.ccrc', 'accounts.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { accounts: Array<{ id: string; exec: Record<string, unknown> }> };
    j.accounts.find((x) => x.id === 'codex-a')!.exec['authDir'] = '.ccrc-backups/codex-a';
    fs.writeFileSync(f, JSON.stringify(j));
    const r = lib(h, '_codex_row codex-a; rc=$?; printf "%s|%s\\n" "$rc" "$CX_AUTH"');
    expect(r.stdout, r.stderr).toBe('0|.ccrc-backups/codex-a\n');
  });

  it('a hand-edited row whose configDirSuffix escapes is roster-invalid, and CX_CFG is emptied', async () => {
    const h = box('ccrc-codex-row-cfgsuffix-');
    await twoLanes(h);
    const f = join(h, '.ccrc', 'accounts.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { accounts: Array<Record<string, unknown>> };
    const a = j.accounts.find((x) => x['id'] === 'codex-a')!;
    a['configDirSuffix'] = '../../etc';
    fs.writeFileSync(f, JSON.stringify(j));
    const r = lib(h, '_codex_row codex-a; rc=$?; printf "%s|%s\\n" "$rc" "$CX_CFG"');
    expect(r.stdout).toBe('1|\n');
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: .*configDirSuffix/m);
  });

  it('a roster naming an account more than once is roster-invalid, never its first row silently', async () => {
    const h = box('ccrc-codex-row-duplicate-');
    await twoLanes(h);
    const f = join(h, '.ccrc', 'accounts.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { accounts: Array<Record<string, unknown>> };
    const a = j.accounts.find((x) => x['id'] === 'codex-a')!;
    j.accounts.push({ ...a });
    fs.writeFileSync(f, JSON.stringify(j));
    const r = lib(h, '_codex_row codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: .*more than once/m);
  });
});

describe('_codex_lanes — the codex lanes, by exec.kind', () => {
  it('lists every exec.kind codex row in roster order and never a telemetry:codex external row', async () => {
    const h = box('ccrc-codex-lanes-');
    await twoLanes(h);
    const r = lib(h, '_codex_lanes');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('codex-a\ncodex-b\n');
    // CONTROL — the telemetry-keyed list disagrees in BOTH directions on this
    // roster, so a `_codex_lanes` that read it would red above, whichever way.
    const t = lib(h, '. "$HOME/.ccrc/accounts.sh"; printf "%s\\n" "${CCRC_CODEX_BACKEND[@]}"');
    expect(t.stdout).toBe('codex-a\next-a\n');
  });

  it('a roster with no codex lane prints nothing, at rc 0', async () => {
    const h = box('ccrc-codex-lanes-none-');
    codexRoster(h, [], [EXTERNAL_CODEX_TELEMETRY]);
    const r = lib(h, '_codex_lanes; echo "rc=$?"');
    expect(r.stdout).toBe('rc=0\n');
    expect(r.stderr).toBe('');
  });

  it('a roster it cannot read answers rc 1 and prints no id — "none" and "unreadable" are two answers', async () => {
    const h = box('ccrc-codex-lanes-broken-');
    await twoLanes(h);
    fs.writeFileSync(join(h, '.ccrc', 'accounts.json'), '[]');
    const r = lib(h, '_codex_lanes; echo "rc=$?"');
    expect(r.stdout).toBe('rc=1\n');
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: /m);
  });

  // Final-review fix wave, C2: the install spine probes node and systemctl
  // by name, never jq, so a jq that cannot run must not read as a bad
  // roster there — its own rc and its own word, over a VALID roster.
  it('no jq on PATH answers rc 2, missing-dependency, and never roster-invalid — over a roster that is valid (review C2)', async () => {
    const h = box('ccrc-codex-lanes-nojq-');
    await twoLanes(h);
    const r = lib(h, 'PATH=/nonexistent-ccrc-path; _codex_lanes; echo "rc=$?"');
    expect(r.stdout).toBe('rc=2\n');
    expect(r.stderr).toMatch(/^ccrc codex: missing-dependency: jq is not on PATH/m);
    expect(r.stderr).not.toMatch(/roster-invalid/);
  });
});

describe('_codex_tier_port — the ONE tier -> port mapping (final-review fix wave)', () => {
  it('answers each tier\'s port from the row, and rc 1 with nothing for a tier word it does not know or a row not read', async () => {
    const h = box('ccrc-codex-tier-port-');
    const p = await twoLanes(h);
    const r = lib(h, '_codex_row codex-a; for t in litellm shim proxy ""; do '
      + 'x="$(_codex_tier_port "$t")"; printf "%s=%s|%s\\n" "${t:-empty}" "$?" "$x"; done; '
      + 'CX_LITELLM=""; x="$(_codex_tier_port litellm)"; printf "unread=%s|%s\\n" "$?" "$x"');
    expect(r.stdout).toBe([
      `litellm=0|${p['codex-a']!.litellmPort}`, `shim=0|${p['codex-a']!.proxyPort}`,
      'proxy=1|', 'empty=1|', 'unread=1|', '',
    ].join('\n'));
  });

  // A literal-absence pin, honest by its own terms: a hand-written copy of
  // the mapping in either spelling the four old sites used reds it.
  it('ccd/ccrc spells the mapping nowhere else — no port assignment reads CX_LITELLM or CX_PROXY by a tier test', () => {
    const src = fs.readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    expect(src).not.toMatch(/port="\$CX_(LITELLM|PROXY)"/);
    const uses = src.split('\n').filter((l) => /_codex_tier_port "\$tier"/.test(l) && !/^\s*#/.test(l));
    expect(uses.length, uses.join('\n')).toBeGreaterThanOrEqual(4);
  });
});

describe('_codex_lane_json_ensure — lane.json equals the roster, written only by models-op', () => {
  async function initialised(prefix: string): Promise<{ h: string; p: Ports }> {
    const h = box(prefix);
    const p = await twoLanes(h);
    const init = ccrc(h, ['models', 'codex-a', 'init', 'codex']);
    expect(init.code, init.stderr).toBe(0);
    return { h, p };
  }

  it('a current lane.json is left alone — no materialise: same inode, same mtime', async () => {
    const { h } = await initialised('ccrc-codex-lanejson-current-');
    const f = join(laneDir(h, 'codex-a'), 'lane.json');
    const before = fs.statSync(f);
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('current\n');
    const r = lib(h, '_codex_lane_json_ensure codex-a');
    expect(r.code, r.stderr).toBe(0);
    const after = fs.statSync(f);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('an absent lane.json is materialised from the roster', async () => {
    const { h, p } = await initialised('ccrc-codex-lanejson-absent-');
    fs.rmSync(join(laneDir(h, 'codex-a'), 'lane.json'));
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('absent\n');
    const r = lib(h, '_codex_lane_json_ensure codex-a');
    expect(r.code, r.stderr).toBe(0);
    expect(laneJson(h, 'codex-a')).toMatchObject({
      id: 'codex-a', configDir: '.claude-codex-a', authDir: codexAuthDir('codex-a'),
      proxyPort: p['codex-a']!.proxyPort, litellmPort: p['codex-a']!.litellmPort,
    });
  });

  // ONE FIELD AT A TIME, and the reason is measured: a case that moved both
  // ports at once stayed green with the proxyPort comparison deleted, because
  // the litellmPort one caught it.
  it.each([
    ['exec.proxyPort', 'proxyPort'],
    ['exec.litellmPort', 'litellmPort'],
    ['exec.authDir', 'authDir'],
    ['configDirSuffix', 'configDir'],
  ] as const)('a lane.json whose %s the roster no longer names is stale, and re-materialised', async (field, key) => {
    const { h } = await initialised('ccrc-codex-lanejson-field-');
    const f = join(h, '.ccrc', 'accounts.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { accounts: Array<Record<string, unknown>> };
    const row = j.accounts.find((x) => x['id'] === 'codex-a')!;
    const exec = row['exec'] as Record<string, unknown>;
    let want: unknown;
    if (field === 'exec.authDir') want = exec['authDir'] = `${codexAuthDir('codex-a')}-moved`;
    else if (field === 'configDirSuffix') want = row['configDirSuffix'] = '.claude-codex-a-moved';
    else {
      const taken = new Set([exec['proxyPort'], exec['litellmPort']]);
      let port = (await freePorts(1))[0]!;
      while (taken.has(port)) port = (await freePorts(1))[0]!;
      want = exec[key] = port;
    }
    fs.writeFileSync(f, JSON.stringify(j));
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('stale\n');
    const r = lib(h, '_codex_lane_json_ensure codex-a');
    expect(r.code, r.stderr).toBe(0);
    expect(laneJson(h, 'codex-a')[key]).toBe(want);
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('current\n');
  });

  it('a lane.json naming another lane is stale, and re-materialised as this one', async () => {
    const { h } = await initialised('ccrc-codex-lanejson-id-');
    const f = join(laneDir(h, 'codex-a'), 'lane.json');
    fs.writeFileSync(f, JSON.stringify({ ...laneJson(h, 'codex-a'), id: 'codex-b' }));
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('stale\n');
    expect(lib(h, '_codex_lane_json_ensure codex-a').code).toBe(0);
    expect(laneJson(h, 'codex-a')['id']).toBe('codex-a');
  });

  it('a lane.json without its units is stale, and re-materialising restores them', async () => {
    const { h } = await initialised('ccrc-codex-lanejson-units-');
    const f = join(laneDir(h, 'codex-a'), 'lane.json');
    const j = laneJson(h, 'codex-a');
    const units = j['units'];
    delete j['units'];
    fs.writeFileSync(f, JSON.stringify(j));
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('stale\n');
    expect(lib(h, '_codex_lane_json_ensure codex-a').code).toBe(0);
    expect(laneJson(h, 'codex-a')['units']).toEqual(units);
  });

  it('a lane with no class registry is no-registry, names init, and writes nothing', async () => {
    const h = box('ccrc-codex-lanejson-noreg-');
    await twoLanes(h);
    const r = lib(h, '_codex_lane_json_ensure codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: no-registry: .*'ccrc models codex-a init codex'/m);
    expect(fs.existsSync(laneDir(h, 'codex-a'))).toBe(false);
  });

  it('a lane.json the materialiser cannot replace is lane-unwritable, carrying models-op\'s own reason', async () => {
    const { h } = await initialised('ccrc-codex-lanejson-dir-');
    const f = join(laneDir(h, 'codex-a'), 'lane.json');
    fs.rmSync(f);
    fs.mkdirSync(join(f, 'occupied'), { recursive: true });
    const r = lib(h, '_codex_lane_json_ensure codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: lane-unwritable: .*materialise-failed/m);
  });

  it('an external lane is not-codex before models-op is ever asked', async () => {
    const h = box('ccrc-codex-lanejson-external-');
    await twoLanes(h);
    const r = lib(h, '_codex_lane_json_ensure ext-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: not-codex: /m);
    expect(fs.existsSync(laneDir(h, 'ext-a'))).toBe(false);
  });

  it('a malformed id is usage at rc 2 through lane.json\'s state and its ensure too — the row\'s rc is passed on, never folded to 1', async () => {
    const h = box('ccrc-codex-lanejson-badid-');
    await twoLanes(h);
    const r = lib(h, '_codex_lane_json_state ../codex-a; a=$?; _codex_lane_json_ensure ../codex-a; echo "state=$a ensure=$?"');
    expect(r.stdout).toBe('state=2 ensure=2\n');
    expect(r.stderr).toMatch(/^ccrc codex: usage: /m);
    expect(fs.existsSync(join(h, '.ccrc', 'codex'))).toBe(false);
  });
});

describe('_codex_runtime_env_ensure — the lane\'s gateway key file (spec §5.4)', () => {
  const envFile = (h: string, id = 'codex-a'): string => join(laneDir(h, id), 'runtime.env');
  const keyOf = (h: string, id = 'codex-a'): string =>
    fs.readFileSync(envFile(h, id), 'utf8').slice('LITELLM_MASTER_KEY='.length).trimEnd();

  it('mints exactly one line, LITELLM_MASTER_KEY=sk-<48 hex>, at 0600 in a 0700 directory, and prints nothing', () => {
    const h = box('ccrc-codex-env-mint-');
    const r = lib(h, '_codex_runtime_env_ensure codex-a && printf "%s\\n" "$CX_ENV_ACTION"');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('created\n');
    expect(fs.readFileSync(envFile(h), 'utf8')).toMatch(KEY_FILE);
    expect(fs.statSync(envFile(h)).mode & 0o777).toBe(0o600);
    expect(fs.statSync(laneDir(h, 'codex-a')).mode & 0o777).toBe(0o700);
    const key = keyOf(h);
    expect(r.stdout + r.stderr).not.toContain(key.slice('sk-'.length));
    expect(r.stderr).toBe('');
  });

  it('is stable: a second call keeps the same bytes and the same inode', () => {
    const h = box('ccrc-codex-env-stable-');
    expect(lib(h, '_codex_runtime_env_ensure codex-a').code).toBe(0);
    const bytes = fs.readFileSync(envFile(h), 'utf8');
    const ino = fs.statSync(envFile(h)).ino;
    const r = lib(h, '_codex_runtime_env_ensure codex-a && printf "%s\\n" "$CX_ENV_ACTION"');
    expect(r.stdout).toBe('kept\n');
    expect(fs.readFileSync(envFile(h), 'utf8')).toBe(bytes);
    expect(fs.statSync(envFile(h)).ino).toBe(ino);
    expect(r.stdout + r.stderr).not.toContain(keyOf(h).slice('sk-'.length));
  });

  it('re-chmods a drifted mode back to 0600 without touching the key', () => {
    const h = box('ccrc-codex-env-mode-');
    expect(lib(h, '_codex_runtime_env_ensure codex-a').code).toBe(0);
    const bytes = fs.readFileSync(envFile(h), 'utf8');
    fs.chmodSync(envFile(h), 0o644);
    const r = lib(h, '_codex_runtime_env_ensure codex-a && printf "%s\\n" "$CX_ENV_ACTION"');
    expect(r.stdout).toBe('rechmod\n');
    expect(fs.statSync(envFile(h)).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(envFile(h), 'utf8')).toBe(bytes);
  });

  const VALID = `LITELLM_MASTER_KEY=sk-${'ab'.repeat(24)}`;
  it.each([
    ['a short key', 'LITELLM_MASTER_KEY=sk-short\n'],
    ['uppercase hex', `LITELLM_MASTER_KEY=sk-${'AB'.repeat(24)}\n`],
    ['no trailing newline', VALID],
    ['a trailing blank line', `${VALID}\n\n`],
    ['a second line', `${VALID}\nOTHER=1\n`],
    ['another variable', `OPENAI_API_KEY=sk-${'ab'.repeat(24)}\n`],
  ])('replaces a malformed file (%s) with a well-formed one', (_what, text) => {
    const h = box('ccrc-codex-env-malformed-');
    fs.mkdirSync(laneDir(h, 'codex-a'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(envFile(h), text, { mode: 0o600 });
    const r = lib(h, '_codex_runtime_env_ensure codex-a && printf "%s\\n" "$CX_ENV_ACTION"');
    expect(r.stdout, r.stderr).toBe('replaced\n');
    expect(fs.readFileSync(envFile(h), 'utf8')).toMatch(KEY_FILE);
    expect(fs.statSync(envFile(h)).mode & 0o777).toBe(0o600);
  });

  it('replaces a symlink at runtime.env with a file, and leaves the link\'s target alone', () => {
    // The target's RELATIVE PATH is exactly as long as a well-formed file
    // (71 bytes). `stat` reports a link's own size — its target path's length
    // — so with any other length the size check would refuse the link by
    // coincidence and the `-L` refusal would be pinned by nothing (measured:
    // green with it deleted, until this length was chosen).
    const h = box('ccrc-codex-env-link-');
    const name = `${'t'.repeat(71 - '.env'.length)}.env`;
    expect(name.length).toBe(`${VALID}\n`.length);
    fs.mkdirSync(laneDir(h, 'codex-a'), { recursive: true, mode: 0o700 });
    const target = join(laneDir(h, 'codex-a'), name);
    fs.writeFileSync(target, `${VALID}\n`, { mode: 0o644 });
    fs.symlinkSync(name, envFile(h));
    const r = lib(h, '_codex_runtime_env_ensure codex-a && printf "%s\\n" "$CX_ENV_ACTION"');
    expect(r.stdout, r.stderr).toBe('replaced\n');
    expect(fs.lstatSync(envFile(h)).isFile()).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe(`${VALID}\n`);
    expect(fs.statSync(target).mode & 0o777).toBe(0o644);
  });

  it('two lanes get two keys', () => {
    const h = box('ccrc-codex-env-two-');
    expect(lib(h, '_codex_runtime_env_ensure codex-a && _codex_runtime_env_ensure codex-b').code).toBe(0);
    expect(keyOf(h, 'codex-a')).not.toBe(keyOf(h, 'codex-b'));
  });

  it('a malformed id is usage (rc 2), and nothing is written — "..", with its ~/.ccrc/runtime.env, included', () => {
    const h = box('ccrc-codex-env-badid-');
    const r = lib(h, "_codex_runtime_env_ensure '..'");
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc codex: usage: /m);
    expect(fs.existsSync(join(h, '.ccrc', 'runtime.env'))).toBe(false);
  });

  it('no external command the mint runs is handed the key', () => {
    // Every external command on the mint's path, replaced by a recorder that
    // logs its argv and execs the real binary. The key is born in a `$( )` and
    // written by the `printf` BUILTIN, so no argv may carry it — a mint that
    // routed the value through `env printf`, `echo | tee` or any other
    // external writer puts it in this log (measured: `env printf` → 1 hit).
    const h = box('ccrc-codex-env-argv-');
    for (const n of ['od', 'tr', 'chmod', 'mv', 'mkdir', 'rm', 'env']) {
      const real = spawnSync('bash', ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim();
      expect(real, `${n} is not on this box's PATH`).not.toBe('');
      fs.writeFileSync(join(h, '.local', 'bin', n),
        `#!/bin/sh\nprintf '%s %s\\n' '${n}' "$*" >> "$HOME/argv-log"\nexec '${real}' "$@"\n`, { mode: 0o755 });
    }
    expect(lib(h, '_codex_runtime_env_ensure codex-a').code).toBe(0);
    const log = fs.readFileSync(join(h, 'argv-log'), 'utf8');
    // CONTROL: the recorders were on PATH — the mint's own `od` is in the log.
    expect(log).toMatch(/^od -An -tx1 -N24 \/dev\/urandom$/m);
    expect(log).not.toContain(keyOf(h).slice('sk-'.length));
  });

  it('a symlink at the OLD predictable tmp name ($f.tmp.$$) is left untouched — mktemp never reuses an existing name, so runtime.env stays a real file', () => {
    // `$$` inside the sourced script is the SAME pid a plain `tmp="$f.tmp.$$"`
    // would have used, so planting the decoy there reproduces exactly the
    // name a pre-mktemp implementation would follow: with plain `>`, this
    // symlink gets FOLLOWED (writing the real key into decoyTarget) and then
    // `mv`'d onto runtime.env, leaving runtime.env itself a symlink. With
    // mktemp's random template name, the mint never looks at this path at
    // all, so the decoy — and its target — are exactly as planted.
    const h = box('ccrc-codex-env-tmpsymlink-');
    const script = [
      'dir="$(_codex_lane_dir codex-a)"',
      'mkdir -p -- "$dir"',
      "printf 'not a key\\n' > \"$dir/decoy-target\"",
      'ln -s decoy-target "$dir/runtime.env.tmp.$$"',
      '_codex_runtime_env_ensure codex-a && printf "%s\\n" "$CX_ENV_ACTION"',
    ].join('\n');
    const r = lib(h, script);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('created\n');
    const dir = laneDir(h, 'codex-a');
    // runtime.env is a REAL FILE holding the real key, never the decoy symlink.
    expect(fs.lstatSync(envFile(h)).isFile()).toBe(true);
    expect(fs.readFileSync(envFile(h), 'utf8')).toMatch(KEY_FILE);
    // the decoy at the OLD vulnerable naming ($f.tmp.$$) is exactly as planted.
    const tmps = fs.readdirSync(dir).filter((n) => n.startsWith('runtime.env.tmp.'));
    expect(tmps.length, 'the decoy symlink should still be present, untouched').toBe(1);
    expect(fs.lstatSync(join(dir, tmps[0]!)).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(join(dir, 'decoy-target'), 'utf8')).toBe('not a key\n');
  });
});

describe('_codex_port_listening', () => {
  it.skipIf(!PY)('0 for a port something accepts on, 1 for one nothing holds', async () => {
    const h = box('ccrc-codex-port-');
    const l = await spawnListener(h, { answer: '404' });
    const [free] = await freePorts(1);
    const r = lib(h, `_codex_port_listening ${l.port}; a=$?; _codex_port_listening ${free}; echo "$a $?"`);
    expect(r.stdout).toBe('0 1\n');
  });

  it.skipIf(!PY)('a malformed CCRC_CODEX_PROBE_S falls back to the default bound instead of failing every probe', async () => {
    // `_plat_timeout` hands its first word to `timeout`, which exits 125
    // WITHOUT RUNNING THE COMMAND on a duration it cannot parse — every
    // listener would read as absent, and a start would try to bind over it.
    const h = box('ccrc-codex-port-knob-');
    const l = await spawnListener(h, { answer: '404' });
    const r = lib(h, `_codex_port_listening ${l.port}; echo "$?"`, { CCRC_CODEX_PROBE_S: 'soon' });
    expect(r.stdout).toBe('0\n');
  });

  // `_codex_probe_secs`'s OWN printed value, not the end-to-end probe: a
  // listener that answers immediately (as the case above's does) completes
  // well within either a 2s bound or NO bound at all, so it cannot tell the
  // two apart — measured, this exact it.each against `_codex_port_listening`
  // stayed green with the normalisation deleted. Only a direct read of
  // `_codex_probe_secs`'s stdout distinguishes them.
  it.each([
    ['a non-digit word', 'soon', '2'],
    ["GNU timeout's own spelling for NO TIMEOUT", '00', '2'],
    ['three digits, all zero', '000', '2'],
    ['an over-long digit string', '99999', '2'],
    ['a well-formed override', '5', '5'],
  ])('_codex_probe_secs (%s: %s) falls back to the default bound (%s)', (_what, given, want) => {
    // `00` is its own hazard: GNU `timeout 00` means NO TIMEOUT AT ALL
    // (measured: `timeout 00 sleep 2` exits 0 after 2s, not 125 — the
    // duration parses as zero and `timeout` reads zero as unbounded), so it
    // must fall back to the default bound rather than pass through as a
    // literal (and unbounded) one.
    const h = box('ccrc-codex-probe-secs-');
    const r = lib(h, '_codex_probe_secs', { CCRC_CODEX_PROBE_S: given });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(want);
  });

  it('2 when the bounded connect expires — held, not free', async () => {
    const h = box('ccrc-codex-port-expired-');
    const [port] = await freePorts(1);
    // `_plat_timeout`'s own expiry code, returned without waiting: what a
    // listener that never completes the handshake produces.
    const r = lib(h, `_plat_timeout() { return 124; }; _codex_port_listening ${port}; echo "$?"`);
    expect(r.stdout).toBe('2\n');
  });

  it('3 for anything that is not a port', () => {
    const h = box('ccrc-codex-port-bad-');
    const r = lib(h, 'for p in abc 0 65536 "" 1.5; do _codex_port_listening "$p"; printf "%s " "$?"; done');
    expect(r.stdout).toBe('3 3 3 3 3 ');
  });
});

describe.skipIf(!PY)('_codex_tier_ours — running, and OURS (spec §7.4)', () => {
  async function lanes(prefix: string, opts: { userManager?: boolean } = {}): Promise<{ h: string; p: Ports }> {
    const h = box(prefix, opts);
    const p = await twoLanes(h);
    // `init` materialises lane.json, whose `units` are the ONLY place a unit
    // name comes from.
    expect(ccrc(h, ['models', 'codex-a', 'init', 'codex']).code).toBe(0);
    return { h, p };
  }
  /** `rc|via|pid|why`. Called DIRECTLY in the library's shell — a `$( … )`
   *  around it would lose the CX_TIER_* it sets. */
  const ours = (h: string, id: string, tier: string, extra: NodeJS.ProcessEnv = {}): string =>
    lib(h, `_codex_tier_ours ${id} ${tier}; printf '%s|%s|%s|%s\\n' "$?" "$CX_TIER_VIA" "$CX_TIER_PID" "$CX_TIER_WHY"`,
      extra).stdout.trim();
  const pidfile = (h: string, id: string, tier: string, pid: number): void =>
    fs.writeFileSync(join(laneDir(h, id), `${tier}.pid`), `${pid}\n`);
  const shimArgv = (h: string, id: string): string[] => [join(h, '.local', 'bin', 'ccgpt-proxy.py'), `--ccrc-lane=${id}`];

  it('the REAL ccgpt-proxy.py, started as this lane WITH its --ccrc-lane marker, binds and answers — ours (0) by its answer alone, and via nohup by its pid', async () => {
    // The marker is a word the shim never reads (it reads no argv; its lane is
    // CCGPT_ACCOUNT_ID), and this case is what proves the word inert: the REAL
    // shim, marker present, still binds and answers /ccgpt/lane. It runs the
    // PLACED copy, because `$HOME/.local/bin/ccgpt-proxy.py` is the path
    // `_codex_pid_is_tier` matches.
    const { h, p } = await lanes('ccrc-codex-ours-realshim-');
    const { shimFile } = plantCodexBins(h);
    const { child } = spawnPy(shimFile, {
      home: h,
      args: ['--ccrc-lane=codex-a'],
      env: {
        CCGPT_ACCOUNT_ID: 'codex-a',
        CCGPT_PROXY_PORT: String(p['codex-a']!.proxyPort),
        CCGPT_LITELLM_PORT: String(p['codex-a']!.litellmPort),
      },
    });
    trackChild(h, child);
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${p['codex-a']!.proxyPort}/ccgpt/lane`);
        up = res.ok && ((await res.json()) as { lane?: unknown }).lane === 'codex-a';
      } catch { /* not bound yet */ }
      if (!up) await new Promise((r) => setTimeout(r, 50));
    }
    expect(up, 'the real shim, marker present, never answered as codex-a').toBe(true);
    expect(ours(h, 'codex-a', 'shim')).toBe('0|||');
    // Its command line carries the marker, so once its pid is recorded the
    // pid itself is proven this lane's tier.
    pidfile(h, 'codex-a', 'shim', child.pid!);
    expect(ours(h, 'codex-a', 'shim')).toBe(`0|nohup|${child.pid!}|`);
    expect(fs.existsSync(join(h, 'curl-poison'))).toBe(false);
  });

  it('a JSON answer for this lane, with its pid in shim.pid carrying this lane\'s marker, is ours via nohup', async () => {
    const { h, p } = await lanes('ccrc-codex-ours-shimpid-');
    const l = await spawnListener(h, {
      answer: 'json', lane: 'codex-a', port: p['codex-a']!.proxyPort, argv: shimArgv(h, 'codex-a'),
    });
    pidfile(h, 'codex-a', 'shim', l.pid);
    expect(ours(h, 'codex-a', 'shim')).toBe(`0|nohup|${l.pid}|`);
  });

  it.each([
    ['the other repository\'s shim — text/plain, the bare id', 'text' as const, 'codex-a', 'listener-unidentified'],
    ['a ccrc shim answering ANOTHER lane', 'json' as const, 'codex-b', 'listener-answers-other-lane'],
    ['a JSON object carrying more than "lane"', 'json-extra' as const, 'codex-a', 'listener-unidentified'],
    ['the right body served as text/plain', 'json-as-text' as const, 'codex-a', 'listener-unidentified'],
    ['the right body at status 500', 'json-500' as const, 'codex-a', 'listener-unidentified'],
    ['a LiteLLM-shaped 404', '404' as const, '', 'listener-unidentified'],
  ])('on the shim port, %s is foreign (2)', async (_what, answer, lane, why) => {
    const { h, p } = await lanes('ccrc-codex-ours-foreign-');
    await spawnListener(h, { answer, lane, port: p['codex-a']!.proxyPort });
    expect(ours(h, 'codex-a', 'shim')).toBe(`2|||${why}`);
  });

  it('nothing on the port and no live pid or unit is not running (1)', async () => {
    const { h } = await lanes('ccrc-codex-ours-down-');
    expect(ours(h, 'codex-a', 'shim')).toBe('1|||');
    expect(ours(h, 'codex-a', 'litellm')).toBe('1|||');
  });

  it('another lane\'s shim pid in this lane\'s pidfile is a stale pidfile, ignored — not running (1), never this lane\'s — and this lane\'s own, not yet listening, is ours, starting (4)', async () => {
    // The `--ccrc-lane=<id>` marker: the shim reads no argv, so without it
    // every lane's shim has one command line and a stale pidfile could hand
    // this lane another lane's live shim to "stop". Both listeners bind a
    // kernel-chosen port, so this lane's proxyPort answers nothing. A pidfile
    // whose live pid is not this lane's tier is no handle at all: it is
    // neither adopted nor foreign, and the silent port says "not running".
    const { h } = await lanes('ccrc-codex-ours-marker-');
    const other = await spawnListener(h, { answer: '404', argv: shimArgv(h, 'codex-b') });
    pidfile(h, 'codex-a', 'shim', other.pid);
    expect(ours(h, 'codex-a', 'shim')).toBe('1|||');
    const mine = await spawnListener(h, { answer: '404', argv: shimArgv(h, 'codex-a') });
    pidfile(h, 'codex-a', 'shim', mine.pid);
    expect(ours(h, 'codex-a', 'shim')).toBe(`4|nohup|${mine.pid}|`);
  });

  it('LiteLLM: a pid in litellm.pid whose argv holds this lane\'s --config, listening on litellmPort, is ours (0)', async () => {
    const { h, p } = await lanes('ccrc-codex-ours-litellm-');
    const l = await spawnListener(h, {
      answer: '404', port: p['codex-a']!.litellmPort, argv: ['--config', litellmYaml(h, 'codex-a')],
    });
    pidfile(h, 'codex-a', 'litellm', l.pid);
    expect(ours(h, 'codex-a', 'litellm')).toBe(`0|nohup|${l.pid}|`);
  });

  it('LiteLLM: identity survives a narrow COLUMNS — ps is read unbounded', async () => {
    // procps honours $COLUMNS even into a pipe (measured: COLUMNS=40 cut a
    // 366-byte argv to 40 bytes), and the --config path is the argv's tail.
    const { h, p } = await lanes('ccrc-codex-ours-columns-');
    const l = await spawnListener(h, {
      answer: '404', port: p['codex-a']!.litellmPort, argv: ['--config', litellmYaml(h, 'codex-a')],
    });
    pidfile(h, 'codex-a', 'litellm', l.pid);
    expect(ours(h, 'codex-a', 'litellm', { COLUMNS: '20' })).toBe(`0|nohup|${l.pid}|`);
  });

  it('LiteLLM: a listener on litellmPort with no identified pid is foreign (2)', async () => {
    const { h, p } = await lanes('ccrc-codex-ours-litellm-anon-');
    await spawnListener(h, { answer: '404', port: p['codex-a']!.litellmPort, argv: ['--config', litellmYaml(h, 'codex-a')] });
    expect(ours(h, 'codex-a', 'litellm')).toBe('2|||listener-unidentified');
  });

  // Review F1: a pid this lane's by its command line is OURS, RUNNING only
  // when it ITSELF holds litellmPort's listening socket. A LiteLLM that has
  // not bound yet, or has just died on EADDRINUSE, while another process holds
  // its port, used to read 0 off its argv plus a connect that succeeded.
  // PLATFORM-ONLY (the ruling): the ownership read is /proc on Linux; the
  // Darwin arm (lsof) is asked on Linux in the helper case below.
  it.skipIf(IS_DARWIN)('LiteLLM: this lane\'s pid by its command line that does NOT hold litellmPort, while another process listens there, is foreign (2) listener-other-process, with its handle — never ours (0) (review F1)', async () => {
    const { h, p } = await lanes('ccrc-codex-ours-litellm-otherproc-');
    // Bound to a kernel-chosen port: this lane's LiteLLM by its command line,
    // not the process on litellmPort.
    const mine = await spawnListener(h, { answer: '404', argv: ['--config', litellmYaml(h, 'codex-a')] });
    pidfile(h, 'codex-a', 'litellm', mine.pid);
    expect(ours(h, 'codex-a', 'litellm')).toBe(`4|nohup|${mine.pid}|`);
    await spawnListener(h, { answer: '404', port: p['codex-a']!.litellmPort });
    expect(ours(h, 'codex-a', 'litellm')).toBe(`2|nohup|${mine.pid}|listener-other-process`);
  });

  // Final-review fix wave (the Task 5 residue "shim arm ours"): the SAME
  // class on the other tier. A shim pid this lane's by its `--ccrc-lane`
  // marker, while ANOTHER process holds the proxy port and answers there,
  // used to read `listener-unidentified` — a 2 with no handle any consumer
  // could stop through, so a `Restart=always` shim crash-looping against the
  // holder could never be stopped by ccrc.
  it.skipIf(IS_DARWIN)('shim: this lane\'s shim pid by its marker that does NOT hold proxyPort, while another process answers there, is foreign (2) listener-other-process, with its handle — the LiteLLM rule\'s twin (fix wave)', async () => {
    const { h, p } = await lanes('ccrc-codex-ours-shim-otherproc-');
    const mine = await spawnListener(h, { answer: '404', argv: shimArgv(h, 'codex-a') });
    pidfile(h, 'codex-a', 'shim', mine.pid);
    expect(ours(h, 'codex-a', 'shim')).toBe(`4|nohup|${mine.pid}|`);
    await spawnListener(h, { answer: 'text', lane: 'codex-a', port: p['codex-a']!.proxyPort });
    expect(ours(h, 'codex-a', 'shim')).toBe(`2|nohup|${mine.pid}|listener-other-process`);
    // …and the proven shim that DOES hold its own port, answering in
    // another shape, keeps its answer's own word (no handle exception).
    // A stub `_codex_tier_port` points the question at `own`'s port.
    const own = await spawnListener(h, { answer: 'text', lane: 'codex-a', argv: shimArgv(h, 'codex-a') });
    pidfile(h, 'codex-a', 'shim', own.pid);
    const stub = `_codex_tier_port() { printf '%s' ${own.port}; }\n`;
    expect(lib(h, `${stub}_codex_tier_ours codex-a shim; printf '%s|%s|%s\\n' "$?" "$CX_TIER_PID" "$CX_TIER_WHY"`).stdout.trim())
      .toBe(`2|${own.pid}|listener-unidentified`);
  });

  // The consumer half of the same residue: the stop reads the shim's handle
  // through `_codex_tier_is_our_handle`, so it ends this lane's shim and
  // leaves the holder. Run through an ASYNC spawn so this process reaps the
  // killed listener (a spawnSync would leave it a zombie that `kill -0`
  // still calls alive).
  it.skipIf(IS_DARWIN)('shim: _codex_stop_tier stops this lane\'s own shim through its proven handle while another process holds the port, and leaves the holder running (fix wave)', async () => {
    const { h, p } = await lanes('ccrc-codex-stop-shim-otherproc-');
    const mine = await spawnListener(h, { answer: '404', argv: shimArgv(h, 'codex-a') });
    pidfile(h, 'codex-a', 'shim', mine.pid);
    const holder = await spawnListener(h, { answer: 'text', lane: 'codex-a', port: p['codex-a']!.proxyPort });
    const r = await new Promise<Result>((resolve) => {
      const c = spawn(BASH, ['-c', `umask 022\n. "${join(h, 'ccrc', 'ccd', 'ccrc')}"\n_codex_stop_tier codex-a shim`],
        { env: env(h), stdio: ['ignore', 'pipe', 'pipe'] });
      trackChild(h, c);
      let out = '';
      let err = '';
      c.stdout!.on('data', (x: Buffer) => { out += x.toString(); });
      c.stderr!.on('data', (x: Buffer) => { err += x.toString(); });
      c.on('close', (code) => resolve({ code: code ?? -1, stdout: out, stderr: err }));
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('stopped\n');
    await eventually(() => mine.child.exitCode !== null || mine.child.signalCode !== null, 'this lane\'s shim to end', 5000);
    expect(holder.child.exitCode, 'the stop ended the port\'s holder').toBeNull();
    expect(await portAccepts(p['codex-a']!.proxyPort)).toBe(true);
    expect(r.stderr).toMatch(/ccrc left it running\.$/m);
  }, 30_000);

  // The ONE reading of the handle exception (review A1): every consumer that
  // decides "this lane's own, stop it through its handle" asks this, so the
  // exception cannot be re-derived three ways again.
  it('_codex_tier_is_our_handle: 0 and 4 are this lane\'s; of the 2s only listener-other-process is; 1, 3 and anything else are not (review A1)', () => {
    const h = box('ccrc-codex-our-handle-');
    const r = lib(h, 'for c in 0:"" 4:"" 2:listener-other-process 2:listener-unidentified 2:unit-unproven 2:"" 1:"" 3:"" 127:"" "":""; do '
      + 'CX_TIER_WHY="${c#*:}"; _codex_tier_is_our_handle "${c%%:*}"; printf "%s=%s " "$c" "$?"; done');
    expect(r.stdout).toBe('0:=0 4:=0 2:listener-other-process=0 2:listener-unidentified=1 2:unit-unproven=1 2:=1 1:=1 3:=1 127:=1 :=1 ');
  });

  const HAS_LSOF = spawnSync('bash', ['-c', 'command -v lsof'], { encoding: 'utf8' }).status === 0;
  const PID1_FD_READABLE = ((): boolean => { try { fs.readdirSync('/proc/1/fd'); return true; } catch { return false; } })();
  const listens = (h: string, pid: number | string, port: number | string, pre = '', extra: NodeJS.ProcessEnv = {}): string =>
    lib(h, `${pre}_codex_pid_listens ${pid} ${port}; printf '%s|%s\\n' "$?" "$CX_LISTEN_WHY"`, extra).stdout.trim();

  // Review N4: 1 is "a LISTEN socket on the port is visible, and it is not
  // this pid's". A port with no LISTEN row at all is 3: the caller asks only
  // after a connect succeeded, so an empty table is a disagreement with the
  // kernel, and a 1 would be rendered as "another process holds the port".
  it.skipIf(IS_DARWIN)('_codex_pid_listens (Linux, /proc): 0 for the pid holding the port\'s LISTEN socket; 1 for a live pid that does not, and a dead pid, while one is visible; 3 with a reason for a port with no LISTEN socket visible, and for arguments that are no pid and port (review F1, N4)', async () => {
    const h = box('ccrc-codex-listens-');
    const l = await spawnListener(h, { answer: '404' });
    const q = await spawnListener(h, { answer: '404' });
    const [free] = await freePorts(1);
    expect(listens(h, l.pid, l.port)).toBe('0|');
    expect(listens(h, q.pid, l.port)).toBe('1|');
    expect(listens(h, spawnSync('true').pid!, l.port)).toBe('1|');
    expect(listens(h, l.pid, free!)).toBe(`3|no LISTEN socket on port ${free!} is visible in /proc/net/tcp or /proc/net/tcp6`);
    expect(listens(h, spawnSync('true').pid!, free!)).toMatch(/^3\|no LISTEN socket on port /);
    expect(listens(h, 'x', l.port)).toMatch(/^3\|'x' and '\d+' are not a pid and a port$/);
    expect(listens(h, l.pid, 0)).toMatch(/^3\|/);
  });

  // Review N2: LISTEN rows only. A process that does not listen can hold a
  // socket whose LOCAL port is the lane's: bound to 127.0.0.2:<port> and
  // connected to the listener on 127.0.0.1:<port>. Read without the `0A`
  // filter, its connected socket's inode matches and it reads as the port's
  // holder, F1's false adoption again.
  it.skipIf(IS_DARWIN)('_codex_pid_listens (Linux): a process that does not listen, holding a connected socket whose local port is the port, is 1 — only a LISTEN socket counts (review N2)', async () => {
    const h = box('ccrc-codex-listens-connected-');
    const l = await spawnListener(h, { answer: '404' });
    const client = spawn(PY!, ['-c', [
      'import socket, sys, time',
      's = socket.socket()',
      'port = int(sys.argv[1])',
      "s.bind(('127.0.0.2', port))",
      "s.connect(('127.0.0.1', port))",
      "print('READY', flush=True)",
      'time.sleep(600)',
    ].join('\n'), String(l.port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    trackChild(h, client);
    await new Promise<void>((resolve, reject) => {
      let out = '';
      let err = '';
      client.stdout!.on('data', (c: Buffer) => { out += c.toString(); if (out.includes('READY')) resolve(); });
      client.stderr!.on('data', (c: Buffer) => { err += c.toString(); });
      client.once('exit', (code) => reject(new Error(`the connected client exited (${code}) before READY: ${err}`)));
    });
    expect(listens(h, client.pid!, l.port)).toBe('1|');
    expect(listens(h, l.pid, l.port)).toBe('0|');
  });

  // No readlink: every fd would fail its read, and "none of its fds holds
  // the port" would be a 1 nothing measured. It is 3, as no lsof is on Darwin.
  // Final-review fix wave (the Task 5 residue): a readlink that IS on PATH
  // but fails on every fd measured nothing either, and a 1 there reads the
  // port's own holder as "another process holds it".
  it.skipIf(IS_DARWIN)('_codex_pid_listens (Linux): a readlink that fails on every fd of a live pid is 3, cannot ask, never 1 (fix wave)', async () => {
    const h = box('ccrc-codex-listens-readlink-fails-');
    const l = await spawnListener(h, { answer: '404' });
    const bin = join(h, 'readlink-fails');
    fs.mkdirSync(bin);
    fs.writeFileSync(join(bin, 'readlink'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    expect(listens(h, l.pid, l.port, `PATH=${bin}:$PATH; `)).toBe(`3|readlink read none of /proc/${l.pid}/fd's entries`);
    // CONTROL: the real readlink reads the same holder as 0.
    expect(listens(h, l.pid, l.port)).toBe('0|');
  });

  it.skipIf(IS_DARWIN)('_codex_pid_listens (Linux): no readlink on PATH is 3, cannot ask, never 1 (review N1)', async () => {
    const h = box('ccrc-codex-listens-noreadlink-');
    const l = await spawnListener(h, { answer: '404' });
    const only = join(h, 'awk-only');
    fs.mkdirSync(only);
    fs.symlinkSync(spawnSync('bash', ['-c', 'command -v awk'], { encoding: 'utf8' }).stdout.trim(), join(only, 'awk'));
    expect(listens(h, l.pid, l.port, `PATH=${only}; `)).toBe('3|readlink is not on PATH');
  });

  // Review N1: GNU `ls -l` spells a link's target by an ambient QUOTING_STYLE
  // even into a pipe (`-> 'socket:[N]'` under shell and shell-escape,
  // `-> "socket:[N]"` under c, curly quotes under locale and clocale), so a
  // helper that parsed its listing read a healthy holder as 1 on such a box,
  // and every start there failed naming another process. One `readlink` per
  // fd, compared exactly, has no quoting to follow.
  it.skipIf(IS_DARWIN).each(['shell-escape', 'shell', 'c', 'locale', 'clocale'])('_codex_pid_listens (Linux): the holder of the LISTEN socket is 0 under an ambient QUOTING_STYLE=%s (review N1)', async (style) => {
    const h = box('ccrc-codex-listens-quoting-');
    const l = await spawnListener(h, { answer: '404' });
    expect(listens(h, l.pid, l.port, '', { QUOTING_STYLE: style })).toBe('0|');
  });

  // Another user's process: an fd table the kernel will not list, so the
  // answer is "cannot ask", never "does not listen". pid 1 is root's; a runner
  // that can read it (root, or a container) has no such process to ask about.
  it.skipIf(IS_DARWIN || PID1_FD_READABLE)('_codex_pid_listens (Linux): a live pid whose fd table cannot be read is 3, cannot ask, with that reason (review F1)', async () => {
    const h = box('ccrc-codex-listens-pid1-');
    const l = await spawnListener(h, { answer: '404' });
    expect(listens(h, 1, l.port)).toBe('3|/proc/1/fd is unreadable');
  });

  // The Darwin arm, asked on this Linux box by setting CCD_OS in the sourced
  // shell (nothing else the helper calls reads it): lsof answers what /proc
  // answers, and no lsof on PATH is 3, cannot ask.
  it.skipIf(IS_DARWIN || !HAS_LSOF)('_codex_pid_listens (the Darwin arm, asked on Linux): lsof answers 0, 1 and a port with no LISTEN socket (3) as /proc does, and no lsof on PATH is 3 (review F1, N4)', async () => {
    const h = box('ccrc-codex-listens-lsof-');
    const l = await spawnListener(h, { answer: '404' });
    const q = await spawnListener(h, { answer: '404' });
    const [free] = await freePorts(1);
    expect(listens(h, l.pid, l.port, 'CCD_OS=darwin; ')).toBe('0|');
    expect(listens(h, q.pid, l.port, 'CCD_OS=darwin; ')).toBe('1|');
    expect(listens(h, q.pid, free!, 'CCD_OS=darwin; ')).toBe(`3|no LISTEN socket on port ${free!} is visible to lsof`);
    expect(listens(h, l.pid, l.port, 'CCD_OS=darwin; PATH=/nonexistent-ccrc-path; ')).toBe('3|lsof is not on PATH');
  });

  // Review N3: the Darwin arm's lsof runs under the probe bound, as every
  // other probe in the block does (macOS lsof stat()s mounts, and a hung
  // network mount hangs it). A stub lsof that outlives the bound is 3, inside
  // the bound's time, and so is a status lsof itself never gives. Both lsof
  // calls are bounded: the second stub answers the pid query with nothing, so
  // the port-wide query is the one that hangs. Runs on both platforms: the
  // arm is the platform's own on macOS, and CCD_OS asks it on Linux.
  it('_codex_pid_listens (the Darwin arm): an lsof that outlives the probe bound is 3, cannot ask, inside the bound — for either query — and an lsof status that is neither 0 nor 1 is 3 (review N3)', async () => {
    const h = box('ccrc-codex-listens-lsof-hang-');
    const bin = join(h, 'lsof-stub');
    fs.mkdirSync(bin);
    const stub = (body: string): void => fs.writeFileSync(join(bin, 'lsof'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    const pre = `CCD_OS=darwin; PATH=${bin}:$PATH; `;
    const probe = { CCRC_CODEX_PROBE_S: '1' };
    stub('exec sleep 30');
    let t0 = Date.now();
    expect(listens(h, process.pid, 4242, pre, probe)).toBe('3|lsof did not answer inside the 1s probe bound');
    expect(Date.now() - t0).toBeLessThan(10_000);
    stub('case " $* " in *" -p "*) exit 1 ;; esac\nexec sleep 30');
    t0 = Date.now();
    expect(listens(h, process.pid, 4242, pre, probe)).toBe('3|lsof did not answer inside the 1s probe bound');
    expect(Date.now() - t0).toBeLessThan(10_000);
    // A status lsof never gives is no answer, even over output that would
    // otherwise read as a holder: for the pid query (which would read 0,
    // adopted) and for the port-wide one (which would read 1).
    stub('echo 4242; exit 2');
    expect(listens(h, process.pid, 4242, pre, probe)).toBe('3|lsof exited 2');
    stub('case " $* " in *" -p "*) exit 1 ;; esac\necho 4242; exit 2');
    expect(listens(h, process.pid, 4242, pre, probe)).toBe('3|lsof exited 2');
  }, 60_000);

  // Final-review fix wave (the Task 5 residue): the pid that bound BETWEEN
  // the two lsof queries shows up in the port-wide one. It is the holder, 0,
  // never "another process holds it" (1). Stubbed, so it runs on both
  // platforms, as the bound case above does.
  it('_codex_pid_listens (the Darwin arm): the pid itself in the port-wide list is 0, alone or beside another; only another pid alone is 1 (fix wave)', () => {
    const h = box('ccrc-codex-listens-lsof-self-');
    const bin = join(h, 'lsof-stub');
    fs.mkdirSync(bin);
    const pre = `CCD_OS=darwin; PATH=${bin}:$PATH; `;
    const stub = (portWide: string): void => fs.writeFileSync(join(bin, 'lsof'),
      `#!/bin/sh\ncase " $* " in *" -p "*) exit 1 ;; esac\nprintf '${portWide}'\nexit 0\n`, { mode: 0o755 });
    stub(`${process.pid}\\n`);
    expect(listens(h, process.pid, 4242, pre)).toBe('0|');
    stub(`99999\\n${process.pid}\\n`);
    expect(listens(h, process.pid, 4242, pre)).toBe('0|');
    stub(`${process.pid}9\\n`);   // a longer pid that merely BEGINS with this one
    expect(listens(h, process.pid, 4242, pre)).toBe('1|');
    stub('99999\\n');
    expect(listens(h, process.pid, 4242, pre)).toBe('1|');
  });

  // Ownership that cannot be measured is rc 3 with its own sentence: never
  // adopted (0), and never called foreign (2) on a guess.
  it('LiteLLM: a proven pid on an answering port whose ownership cannot be measured is 3, tier-unmeasured, with the helper\'s reason (review F1)', async () => {
    const { h, p } = await lanes('ccrc-codex-ours-litellm-unmeasurable-');
    const l = await spawnListener(h, {
      answer: '404', port: p['codex-a']!.litellmPort, argv: ['--config', litellmYaml(h, 'codex-a')],
    });
    pidfile(h, 'codex-a', 'litellm', l.pid);
    const r = lib(h, "_codex_pid_listens() { CX_LISTEN_WHY='a stub that cannot ask'; return 3; }\n"
      + `_codex_tier_ours codex-a litellm; printf '%s|%s|%s|%s\\n' "$?" "$CX_TIER_VIA" "$CX_TIER_PID" "$CX_TIER_WHY"`);
    expect(r.stdout.trim()).toBe(`3|nohup|${l.pid}|`);
    expect(r.stderr).toMatch(new RegExp(`^ccrc codex: tier-unmeasured: codex-a's litellm tier: pid ${l.pid} is this lane's by its command line and port ${p['codex-a']!.litellmPort} answers, .*\\(a stub that cannot ask\\)`, 'm'));
    // Every other caller is pointed at status (this is the CONTROL)…
    expect(r.stderr).toContain("'ccrc codex status codex-a' reports the lane.");
    // …and status itself is not pointed at itself (fix wave, the Task 5
    // residue): the same sentence, without that clause, then its UNKNOWN line.
    const st = lib(h, "_codex_pid_listens() { CX_LISTEN_WHY='a stub that cannot ask'; return 3; }\n"
      + '_codex_cmd_status codex-a 0');
    expect(st.stderr).toMatch(/^ccrc codex: tier-unmeasured: codex-a's litellm tier: .*\(a stub that cannot ask\)/m);
    expect(st.stderr).not.toContain("'ccrc codex status codex-a' reports the lane");
    expect(st.stdout).toMatch(/^ccrc codex: codex-a: litellm UNKNOWN — its state could not be measured$/m);
  });

  it.each([
    ['another lane\'s config', (h: string) => litellmYaml(h, 'codex-b')],
    ['a longer path that begins with this lane\'s', (h: string) => `${litellmYaml(h, 'codex-a')}.prev`],
  ])('LiteLLM: a pid whose --config is %s is not this lane\'s (2)', async (_what, cfg) => {
    const { h, p } = await lanes('ccrc-codex-ours-litellm-cfg-');
    const l = await spawnListener(h, { answer: '404', port: p['codex-a']!.litellmPort, argv: ['--config', cfg(h)] });
    pidfile(h, 'codex-a', 'litellm', l.pid);
    expect(ours(h, 'codex-a', 'litellm')).toBe('2|||listener-unidentified');
  });

  it('LiteLLM: this lane\'s pid alive but not listening yet is ours, starting (4); a live stranger in the pidfile is a stale pidfile — not running (1) while nothing answers, foreign (2) once something unproven does; a dead pid is not running (1)', async () => {
    // Bound to a kernel-chosen port, not litellmPort: a tier still importing
    // litellm, whose command line is already this lane's.
    const { h, p } = await lanes('ccrc-codex-ours-litellm-notlistening-');
    const l = await spawnListener(h, { answer: '404', argv: ['--config', litellmYaml(h, 'codex-a')] });
    pidfile(h, 'codex-a', 'litellm', l.pid);
    expect(ours(h, 'codex-a', 'litellm')).toBe(`4|nohup|${l.pid}|`);
    // This process: alive, and no tier's command line — the pid a pidfile
    // names after a reboot handed it to somebody else. A STALE pidfile, not a
    // foreign tier: it is ignored, so it can neither wedge the lane nor be
    // signalled as ccrc's own, and the silent port says "not running".
    pidfile(h, 'codex-a', 'litellm', process.pid);
    expect(ours(h, 'codex-a', 'litellm')).toBe('1|||');
    // A pid whose process has exited and been reaped: no live handle at all.
    const dead = spawnSync('true').pid;
    pidfile(h, 'codex-a', 'litellm', dead);
    expect(ours(h, 'codex-a', 'litellm')).toBe('1|||');
    // The stale pidfile again, now with an unproven listener on litellmPort:
    // the PORT decides, and it is foreign for the port's reason, never for one
    // drawn from the pidfile.
    pidfile(h, 'codex-a', 'litellm', process.pid);
    await spawnListener(h, { answer: '404', port: p['codex-a']!.litellmPort });
    expect(ours(h, 'codex-a', 'litellm')).toBe('2|||listener-unidentified');
  });

  it('a connect that outlives the bound is held: unresponsive (2) with no handle, ours, starting (4) with a proven one', async () => {
    // `_plat_timeout`'s own expiry code, returned without waiting: what a port
    // whose holder never completes the handshake produces.
    const { h } = await lanes('ccrc-codex-ours-expired-');
    const probe = (): string => lib(h, `_plat_timeout() { return 124; }; _codex_tier_ours codex-a litellm; `
      + `printf '%s|%s|%s|%s\\n' "$?" "$CX_TIER_VIA" "$CX_TIER_PID" "$CX_TIER_WHY"`).stdout.trim();
    expect(probe()).toBe('2|||listener-unresponsive');
    const l = await spawnListener(h, { answer: '404', argv: ['--config', litellmYaml(h, 'codex-a')] });
    pidfile(h, 'codex-a', 'litellm', l.pid);
    expect(probe()).toBe(`4|nohup|${l.pid}|`);
  });

  it('a tier word it does not know, and a lane that is not codex, are rc 3 with a sentence', async () => {
    const { h } = await lanes('ccrc-codex-ours-usage-');
    const a = lib(h, '_codex_tier_ours codex-a proxy; echo "rc=$?"');
    expect(a.stdout).toBe('rc=3\n');
    expect(a.stderr).toMatch(/^ccrc codex: usage: /m);
    const b = lib(h, '_codex_tier_ours ext-a shim; echo "rc=$?"');
    expect(b.stdout).toBe('rc=3\n');
    expect(b.stderr).toMatch(/^ccrc codex: not-codex: /m);
  });

  // PLATFORM-ONLY: darwin has no user manager — `_svc_have_user_manager`
  // answers 1 there by contract, so no unit is ever asked and this arm has no
  // darwin counterpart to contrast with (the nohup cases above run on both).
  describeLinux('with a user manager (the fake one)', () => {
    it('a live unit whose MainPID holds this lane\'s --config and listens is ours via systemd — asked by the name lane.json records', async () => {
      const { h, p } = await lanes('ccrc-codex-ours-unit-', { userManager: true });
      // A unit name the id alone would NOT derive: the library must READ it
      // from lane.json (models-op's `laneManifest` is its one derivation).
      const f = join(laneDir(h, 'codex-a'), 'lane.json');
      const unit = 'fixture-codex-a-litellm.service';
      fs.writeFileSync(f, JSON.stringify({ ...laneJson(h, 'codex-a'), units: { litellm: unit, shim: 'fixture-codex-a-shim.service' } }));
      const l = await spawnListener(h, {
        answer: '404', port: p['codex-a']!.litellmPort, argv: ['--config', litellmYaml(h, 'codex-a')],
      });
      fakeUnit(h, unit, { state: 'active', pid: l.pid });
      expect(ours(h, 'codex-a', 'litellm')).toBe(`0|systemd|${l.pid}|`);
      expect(systemctlCalls(h)).toEqual(expect.arrayContaining([
        `--user is-active ${unit}`, `--user show -p MainPID --value ${unit}`,
      ]));
    });

    it('a unit name lane.json spells like a flag is never handed to systemctl', async () => {
      const { h } = await lanes('ccrc-codex-ours-unit-flag-', { userManager: true });
      const f = join(laneDir(h, 'codex-a'), 'lane.json');
      fs.writeFileSync(f, JSON.stringify({ ...laneJson(h, 'codex-a'), units: { litellm: '--all.service', shim: '--all.service' } }));
      expect(ours(h, 'codex-a', 'litellm')).toBe('1|||');
      expect(systemctlCalls(h).filter((c) => c.includes('--all.service'))).toEqual([]);
    });

    it('a live unit whose MainPID does not prove this lane is foreign (2): unit-unproven — no MainPID, or a stranger\'s', async () => {
      // The unit NAME is not identity: the other repository's live tiers run
      // under these same names (the 2026-09-23 live-box census).
      const { h } = await lanes('ccrc-codex-ours-unit-silent-', { userManager: true });
      const unit = (laneJson(h, 'codex-a')['units'] as Record<string, string>)['litellm']!;
      fakeUnit(h, unit, { state: 'active' });
      expect(ours(h, 'codex-a', 'litellm')).toBe('2|||unit-unproven');
      // This process as its MainPID: alive, and no tier's command line.
      fakeUnit(h, unit, { state: 'active', pid: process.pid });
      expect(ours(h, 'codex-a', 'litellm')).toBe('2|||unit-unproven');
    });

    // Review A2 (ruling PF-13): this lane's own crash-looping tier reads
    // exactly so between two restarts, so `status` must not call it FOREIGN
    // or "not this lane's" — it says UNPROVEN, in `_codex_foreign_what`'s
    // words, with the retry. The JSON keeps the contract's word.
    it('status names a live unit whose identity is only unproven UNPROVEN, with the retry — never FOREIGN (review A2)', async () => {
      const { h, p } = await lanes('ccrc-codex-status-unproven-', { userManager: true });
      const unit = (laneJson(h, 'codex-a')['units'] as Record<string, string>)['litellm']!;
      fakeUnit(h, unit, { state: 'active' });
      const r = lib(h, '_codex_cmd_status codex-a 0');
      expect(r.code, r.stderr).toBe(0);
      const line = r.stdout.split('\n').find((l) => l.startsWith('ccrc codex: codex-a: litellm '));
      expect(line).toBe(`ccrc codex: codex-a: litellm UNPROVEN — the unit ${unit} is active, but its identity as codex-a's litellm tier is unproven: `
        + 'a unit of that name is live with no process that proves this lane, and port '
        + `${p['codex-a']!.litellmPort} does not answer. `
        + 'Re-run in a few seconds: this lane\'s own tier reads this way between two of its restarts, and proves itself once its process is back. '
        + `If it still reads this way, 'systemctl --user status ${unit}' shows what the unit runs.`);
      const j = lib(h, '_codex_cmd_status codex-a 1');
      expect((JSON.parse(j.stdout) as { tiers: Record<string, { state: string }> }).tiers['litellm']!.state).toBe('foreign');
    });

    it('a live unit whose MainPID holds this lane\'s --config while nothing listens yet is ours, starting (4) via systemd', async () => {
      const { h } = await lanes('ccrc-codex-ours-unit-starting-', { userManager: true });
      const unit = (laneJson(h, 'codex-a')['units'] as Record<string, string>)['litellm']!;
      // A kernel-chosen port, not litellmPort: the unit's process has not bound yet.
      const l = await spawnListener(h, { answer: '404', argv: ['--config', litellmYaml(h, 'codex-a')] });
      fakeUnit(h, unit, { state: 'active', pid: l.pid });
      expect(ours(h, 'codex-a', 'litellm')).toBe(`4|systemd|${l.pid}|`);
    });

    it('with the manager down, no unit is asked about at all', async () => {
      const { h } = await lanes('ccrc-codex-ours-unit-nomgr-', { userManager: false });
      const unit = (laneJson(h, 'codex-a')['units'] as Record<string, string>)['litellm']!;
      fakeUnit(h, unit, { state: 'active' });
      expect(ours(h, 'codex-a', 'litellm')).toBe('1|||');
      expect(systemctlCalls(h)).toContain('--user show-environment');
      expect(systemctlCalls(h).filter((c) => c.startsWith('--user is-active'))).toEqual([]);
    });
  });
});

describe('_codex_started_json and _codex_tier_stale — "running the update" is its own claim (spec §7.4)', () => {
  async function planted(prefix: string): Promise<{ h: string; gen: string; stamp: string; shim: string }> {
    const h = box(prefix);
    const [a1, a2] = await freePorts(2);
    codexRoster(h, [{ id: 'codex-a', proxyPort: a1!, litellmPort: a2! }]);
    const { shimFile } = plantCodexBins(h);
    const rt = plantFakeRuntime(h);
    return { h, gen: rt.gen, stamp: rt.stamp, shim: shimFile };
  }
  const stale = (h: string): string =>
    lib(h, '_codex_tier_stale codex-a litellm; a=$?; _codex_tier_stale codex-a shim; echo "litellm=$a shim=$?"').stdout.trim();
  const record = (h: string): void => {
    fs.mkdirSync(laneDir(h, 'codex-a'), { recursive: true });
    const r = lib(h, 'for t in $CODEX_TIERS; do _codex_started_json "$t" > "$(_codex_lane_dir codex-a)/$t.started" || exit 1; done');
    expect(r.code, r.stderr).toBe(0);
  };

  // `check` hands its stamp read and its probe hash to the box's real python3
  // (through the fake interpreter), so this one case needs python3; every
  // other case here runs `ccgpt-runtime python`, which runs no interpreter.
  it.skipIf(!PY)('the planted runtime is one the REAL ccgpt-runtime accepts — and its check asks the fake interpreter', async () => {
    const { h, gen, stamp } = await planted('ccrc-codex-stale-parity-');
    const cli = join(h, '.local', 'bin', 'ccgpt-runtime');
    const run = (a: string): Result => {
      const r = spawnSync(BASH, [cli, a], { env: env(h), encoding: 'utf8', timeout: 15_000 });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    expect(run('check').code, run('check').stderr).toBe(0);
    expect(run('python').stdout).toBe(`${gen}/bin/python\n`);
    // All three of check's `-I -c` questions reached the fake: the version it
    // answers itself, and the stamp read and probe hash it execs on python3.
    const calls = fs.readFileSync(join(gen, 'python-calls'), 'utf8');
    for (const k of ['importlib.metadata', 'json.load', 'hashlib']) expect(calls, k).toContain(k);
    // The stamp is the builder's own bytes: json.dump's default separators,
    // its key order, its `python` and `canary` shapes, one trailing newline.
    expect(fs.readFileSync(stamp, 'utf8')).toMatch(new RegExp('^\\{"requirement": "[^"]+", '
      + '"probeSha256": "[0-9a-f]{64}", "litellm": "1\\.101\\.0", "python": "\\d+\\.\\d+\\.\\d+", '
      + '"canary": "raw-shape-leaks-system-role=no", "builtAt": "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z"\\}\\n$'));
    // CONTROL: a stamp recording a version the interpreter does not report.
    const j = JSON.parse(fs.readFileSync(stamp, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(stamp, `${JSON.stringify({ ...j, litellm: '0.0.0' })}\n`);
    const bad = run('check');
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/ccgpt-runtime: mutated/);
  });

  it('each tier\'s record names the RESOLVED generation and the sha256 of that tier\'s code file', async () => {
    const { h, gen, stamp, shim } = await planted('ccrc-codex-stale-record-');
    const r = lib(h, '_codex_started_json litellm && _codex_started_json shim');
    expect(r.code, r.stderr).toBe(0);
    const [lit, sh] = r.stdout.trim().split('\n').map((l) => JSON.parse(l) as unknown);
    expect(lit).toEqual({ generation: gen, code: sha256(stamp) });
    expect(sh).toEqual({ generation: gen, code: sha256(shim) });
    expect(r.stdout).not.toContain('/current');
  });

  it('no record is stale (0); the record a start would write is current (1)', async () => {
    const { h } = await planted('ccrc-codex-stale-first-');
    expect(stale(h)).toBe('litellm=0 shim=0');
    record(h);
    expect(stale(h)).toBe('litellm=1 shim=1');
  });

  it('a new generation makes both tiers stale', async () => {
    const { h } = await planted('ccrc-codex-stale-gen-');
    record(h);
    plantFakeRuntime(h);
    expect(stale(h)).toBe('litellm=0 shim=0');
  });

  it('a changed shim file makes only the shim stale; a rewritten stamp only LiteLLM', async () => {
    const { h, stamp, shim } = await planted('ccrc-codex-stale-code-');
    record(h);
    fs.appendFileSync(shim, '# a newer shim\n');
    expect(stale(h)).toBe('litellm=1 shim=0');
    record(h);
    fs.appendFileSync(stamp, ' ');
    expect(stale(h)).toBe('litellm=0 shim=1');
  });

  it('an unparseable record is stale', async () => {
    const { h } = await planted('ccrc-codex-stale-garbled-');
    record(h);
    fs.writeFileSync(join(laneDir(h, 'codex-a'), 'shim.started'), 'not json');
    expect(stale(h)).toBe('litellm=1 shim=0');
  });

  it('no runtime NOW is "cannot tell" (2) for both tiers, never stale — a restart would have nothing to start', async () => {
    const { h } = await planted('ccrc-codex-stale-noruntime-');
    record(h);
    fs.rmSync(join(h, '.ccrc', 'runtime', 'codex', 'current'));
    expect(stale(h)).toBe('litellm=2 shim=2');
  });
});

describe('_codex_reap_files — the file half of the reap (Plan 2b-1 carry-forward 8)', () => {
  it('removes the lane\'s generated state and its directory; never its logs, its OAuth, or another lane\'s files', async () => {
    const h = box('ccrc-codex-reap-');
    await twoLanes(h);
    expect(ccrc(h, ['models', 'codex-a', 'init', 'codex']).code).toBe(0);
    expect(lib(h, '_codex_runtime_env_ensure codex-a && _codex_runtime_env_ensure codex-b').code).toBe(0);
    const dir = laneDir(h, 'codex-a');
    // With lane.json (init) and runtime.env (above), EXACTLY the reap list:
    // every file `_codex_reap_files` owns, the per-lane lock file included.
    for (const f of ['litellm.yaml', 'litellm.yaml.prev', 'litellm.started', 'shim.started', 'litellm.pid', 'shim.pid', '.lock']) {
      fs.writeFileSync(join(dir, f), 'fixture\n');
    }
    const logs = join(h, '.ccrc', 'logs', 'codex', 'codex-a');
    fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(join(logs, 'litellm.log'), 'a log line\n');
    const auth = join(h, codexAuthDir('codex-a'));
    fs.mkdirSync(auth, { recursive: true });
    fs.writeFileSync(join(auth, 'auth.json'), '{"token":"test-token-not-a-secret"}\n');
    const other = fs.readFileSync(join(laneDir(h, 'codex-b'), 'runtime.env'), 'utf8');

    const r = lib(h, '_codex_reap_files codex-a');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toBe('');
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.readFileSync(join(logs, 'litellm.log'), 'utf8')).toBe('a log line\n');
    expect(fs.readFileSync(join(auth, 'auth.json'), 'utf8')).toBe('{"token":"test-token-not-a-secret"}\n');
    expect(fs.readFileSync(join(laneDir(h, 'codex-b'), 'runtime.env'), 'utf8')).toBe(other);
  });

  it('a runtime.env.tmp.* leftover from an interrupted mint is removed by the reap', () => {
    // mktemp's own random suffix, so this is a GLOB, not a fixed name — a
    // killed `_codex_runtime_env_ensure` can leave a key-bearing tmp file
    // behind, and it must not survive account removal or silently block the
    // directory's own removal.
    const h = box('ccrc-codex-reap-tmpfile-');
    const dir = laneDir(h, 'codex-a');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(join(dir, 'lane.json'), '{}\n');
    const leftover = join(dir, 'runtime.env.tmp.a1B2c3');
    fs.writeFileSync(leftover, `LITELLM_MASTER_KEY=sk-${'ab'.repeat(24)}\n`, { mode: 0o600 });
    const r = lib(h, '_codex_reap_files codex-a');
    expect(r.code, r.stderr).toBe(0);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('keeps the directory, and what it does not own inside it', () => {
    const h = box('ccrc-codex-reap-foreign-');
    const dir = laneDir(h, 'codex-a');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'lane.json'), '{}\n');
    fs.writeFileSync(join(dir, 'notes.txt'), 'the operator\'s\n');
    expect(lib(h, '_codex_reap_files codex-a').code).toBe(0);
    expect(fs.readdirSync(dir)).toEqual(['notes.txt']);
  });

  it('needs no roster row — a lane already removed from accounts.json is still reaped', () => {
    const h = box('ccrc-codex-reap-unrostered-');
    codexRoster(h, []);
    const dir = laneDir(h, 'codex-a');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'lane.json'), '{}\n');
    expect(lib(h, '_codex_reap_files codex-a').code).toBe(0);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('a malformed id is usage (rc 2), and removes nothing — ".." would have named ~/.ccrc itself', () => {
    const h = box('ccrc-codex-reap-badid-');
    fs.mkdirSync(join(h, '.ccrc'), { recursive: true });
    fs.writeFileSync(join(h, '.ccrc', 'runtime.env'), 'sentinel\n');
    const r = lib(h, "_codex_reap_files '..'");
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc codex: usage: /m);
    expect(fs.readFileSync(join(h, '.ccrc', 'runtime.env'), 'utf8')).toBe('sentinel\n');
  });

  it('a file it cannot remove is lane-unwritable, rc 1, and the rest are still removed', () => {
    const h = box('ccrc-codex-reap-stuck-');
    const dir = laneDir(h, 'codex-a');
    fs.mkdirSync(join(dir, 'lane.json', 'occupied'), { recursive: true });
    fs.writeFileSync(join(dir, 'runtime.env'), 'x\n');
    const r = lib(h, '_codex_reap_files codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: lane-unwritable: could not remove .*lane\.json/m);
    expect(fs.existsSync(join(dir, 'runtime.env'))).toBe(false);
  });
});

// The fixture's own contract, for the suites after this one: the lifecycle,
// launcher, spine, uninstall and account-removal cases plant EVERY built
// runtime generation through `plantFakeRuntime` and every manager through
// `plantSystemd`. Neither case below calls the library.
describe('codexLaneFixture — the runtime and the manager later suites plant through it', () => {
  it('plantFakeRuntime: a named generation, a custom interpreter body, and no stamp — each as the REAL ccgpt-runtime reads it', () => {
    const h = box('ccrc-codex-fixture-runtime-');
    const { runtimeCli } = plantCodexBins(h);
    const python = (): Result => {
      const r = spawnSync(BASH, [runtimeCli, 'python'], { env: env(h), encoding: 'utf8', timeout: 15_000 });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    const body = '#!/bin/sh\necho "a custom interpreter body" >&2\nexit 42\n';
    const named = plantFakeRuntime(h, { generationName: 'gen-20260101T000000Z-1', python: body });
    expect(path.basename(named.gen)).toBe('gen-20260101T000000Z-1');
    expect(fs.readlinkSync(join(named.root, 'current'))).toBe('gen-20260101T000000Z-1');
    expect(fs.readFileSync(named.python, 'utf8')).toBe(body);
    expect(fs.existsSync(named.stamp)).toBe(true);
    // `python` runs no interpreter, so the body's exit 42 never shows.
    expect(python().stdout).toBe(`${named.gen}/bin/python\n`);
    // No stamp: a generation `ccgpt-runtime python` calls mutated, not absent.
    const bare = plantFakeRuntime(h, { generationName: 'gen-20260101T000000Z-2', stamp: false });
    expect(bare.stamp).toBeNull();
    expect(fs.existsSync(join(bare.gen, '.ccrc-runtime.json'))).toBe(false);
    expect(python()).toEqual({ code: 1, stdout: '', stderr: 'ccgpt-runtime: mutated\n' });
    // A name off the builder's generation shape throws here, rather than
    // planting a runtime the builder reads as absent.
    expect(() => plantFakeRuntime(h, { generationName: 'gen-latest' })).toThrow(/generationName "gen-latest"/);
    expect(fs.readlinkSync(join(bare.root, 'current'))).toBe('gen-20260101T000000Z-2');
  });

  it('plantSystemd\'s refuseSpawn: systemd-run records the call, refuses in a real manager\'s words, and runs nothing — while the manager stays up', () => {
    const h = box('ccrc-codex-fixture-refusespawn-');
    plantSystemd(h, { userManager: true, refuseSpawn: true });
    const bin = join(h, '.local', 'bin');
    const marker = join(h, 'spawned');
    const run = (cmd: string, args: string[]): Result => {
      const r = spawnSync(BASH, [join(bin, cmd), ...args], { env: env(h), encoding: 'utf8', timeout: 15_000 });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    const start = (): Result =>
      run('systemd-run', ['--user', '--collect', '--quiet', '--unit=fixture-refused.service', '--', 'touch', marker]);
    const r = start();
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^Failed to start transient service unit: /);
    expect(systemdRunCalls(h)).toEqual([`--user --collect --quiet --unit=fixture-refused.service -- touch ${marker}`]);
    expect(fs.existsSync(marker), 'a refusing manager ran the command').toBe(false);
    // The manager is UP, so a unit can still be asked about: the shape a
    // suite needs to prove a path asks and never starts.
    expect(run('systemctl', ['--user', 'show-environment']).code).toBe(0);
    // CONTROL: planting again without the knob clears it, and the refusal
    // sentence goes with it.
    plantSystemd(h, { userManager: true });
    expect(fs.existsSync(join(h, 'fake-systemd', 'refuse-spawn'))).toBe(false);
    expect(start().stderr).not.toMatch(/^Failed to start transient service unit: /);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Plan 2b-2 Task 5 — `ccrc codex start|stop|status`: the lane RUNS, in fixtures.
//
// These cases run REAL processes on kernel-chosen loopback ports: the shipped
// shim (the copy `plantCodexBins` placed, exec'd by the fake runtime python
// with ccrc's own argv) and a stdlib stand-in for LiteLLM. The service manager
// is codexLaneFixture.ts' fake, which Task 5 taught to run what it is handed.
//
// Containment is this file's (its header, and Task 4's `box`/`env`):
//   - `plantSystemd` runs before `env()`, so a real systemd-run or systemctl
//     is unreachable; `curl` stays poisoned, and one case asserts it untouched
//     — the library speaks HTTP over bash's own /dev/tcp.
//   - No case binds or probes a fixed port.
//   - `killLaneProcesses` runs current-run product stops while the fixture
//     state exists, then ends direct current-run child handles. Persisted PIDs
//     are observations only.
// ════════════════════════════════════════════════════════════════════════════
describe.skipIf(!PY)('ccrc codex start|stop|status: the lane runs, in fixtures (Plan 2b-2 Task 5)', () => {
  const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

  interface Lane { proxyPort: number; litellmPort: number; authDir: string }
  interface Life { home: string; lanes: Record<string, Lane>; rt: FakeRuntime; shimFile: string }

  /** `ccrc codex <args>` as the launcher runs it: this file's `env()` with a
   *  20 s readiness bound, a timeout past a start's lock wait plus its own
   *  readiness wait, and stdin from /dev/null so a detached tier inherits
   *  nothing spawnSync waits on. */
  function codex(home: string, args: string[], extra: NodeJS.ProcessEnv = {}): Result {
    const r = spawnSync(BASH, [join(home, 'ccrc', 'ccd', 'ccrc'), 'codex', ...args], {
      env: env(home, { CCRC_CODEX_READY_S: '20', ...extra }), encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 150_000,
    });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }
  /** The same verb, NOT awaited: for the cases where two verbs overlap. */
  function codexAsync(home: string, args: string[], extra: NodeJS.ProcessEnv = {}): Promise<Result> {
    return new Promise((resolve) => {
      const c = spawn(BASH, [join(home, 'ccrc', 'ccd', 'ccrc'), 'codex', ...args],
        { env: env(home, { CCRC_CODEX_READY_S: '20', ...extra }), stdio: ['ignore', 'pipe', 'pipe'] });
      trackChild(home, c);
      let out = '';
      let err = '';
      c.stdout!.on('data', (x: Buffer) => { out += x.toString(); });
      c.stderr!.on('data', (x: Buffer) => { err += x.toString(); });
      c.on('close', (code) => resolve({ code: code ?? -1, stdout: out, stderr: err }));
    });
  }

  const logDir = (home: string, id: string): string => join(home, '.ccrc', 'logs', 'codex', id);
  const stopCalls = (home: string): string[] => systemctlCalls(home).filter((c) => c.startsWith('--user stop'));

  /** `env(home)`'s PATH with `tool` reachable NOWHERE and nothing else
   *  missing: the fixture's own `.local/bin` first (the fake manager, the
   *  poisons), then one directory of links to the first copy of every other
   *  executable on that PATH. The list is DERIVED, because the whole verb runs
   *  under this PATH and a hand-kept list would be a second census of what it
   *  calls. `ccrc-install.test.ts`' `pathWithout` keeps one, and its comments
   *  count what that has cost. */
  function pathWithout(home: string, tool: string): string {
    const head = join(home, '.local', 'bin');
    if (fs.existsSync(join(head, tool))) throw new Error(`pathWithout: the fixture itself planted ${tool} in ${head}`);
    const d = join(home, `no-${tool}-bin`);
    fs.mkdirSync(d, { recursive: true });
    const seen = new Set<string>([tool]);
    for (const dir of (env(home)['PATH'] ?? '').split(':')) {
      if (dir === '' || path.resolve(dir) === head || !fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (seen.has(name)) continue;
        const p = join(dir, name);
        try {
          fs.accessSync(p, fs.constants.X_OK);
          if (!fs.statSync(p).isFile()) continue;
        } catch { continue; }
        seen.add(name);
        fs.symlinkSync(p, join(d, name));
      }
    }
    return `${head}:${d}`;
  }

  /** A fleet box in miniature, on Task 4's `box()`:
   *  - the tree `ccrc` resolves against, the fake manager and the poisons;
   *  - `ccgpt-runtime` and `ccgpt-proxy.py` placed as `_inst_bins` would
   *    (`plantCodexBins`: copies of the shipped files, so the shim that runs IS
   *    the shipped file);
   *  - the codex roster, and a class registry and lane.json per lane, both
   *    written through the real verb;
   *  - an OAuth login (existence only), and a litellm.yaml per lane rendered by
   *    the real renderer (`plantLaneConfig`, ruling R20);
   *  - the fake runtime. */
  async function lifeBox(opts: { userManager: boolean; ids?: string[] }): Promise<Life> {
    const home = box('ccrc-codex-life-', { userManager: opts.userManager });
    const { shimFile } = plantCodexBins(home);
    const ids = opts.ids ?? ['codex-a', 'codex-b'];
    const ports = await freePorts(ids.length * 2);
    codexRoster(home, ids.map((id, i) => ({ id, proxyPort: ports[2 * i]!, litellmPort: ports[2 * i + 1]! })));
    const rt = plantFakeRuntime(home);
    const lanes: Record<string, Lane> = {};
    ids.forEach((id, i) => {
      const authDir = codexAuthDir(id);
      lanes[id] = { proxyPort: ports[2 * i]!, litellmPort: ports[2 * i + 1]!, authDir };
      // This is deliberately registered before any caller can start the lane.
      // It invokes the real product stop while roster, lane and fake-manager
      // state still exist; cleanup ignores the result to preserve test failures.
      registerLaneCleanup(home, `codex:${id}`, () => { codex(home, ['stop', id]); });
      const init = ccrc(home, ['models', id, 'init', 'codex']);
      expect(init.code, init.stderr).toBe(0);
      fs.mkdirSync(join(home, authDir), { recursive: true, mode: 0o700 });
      fs.writeFileSync(join(home, authDir, 'auth.json'), '{"fixture":"test-token-not-a-secret"}\n', { mode: 0o600 });
      expect(plantLaneConfig(home, id)).toBe(litellmYaml(home, id));
    });
    return { home, lanes, rt, shimFile };
  }

  // ── L0: the instrument, before anything leans on it ────────────────────────
  it.skipIf(!PY)('L0 the instrument: the fake manager requests a per-unit Python supervisor stop, waits for exact-child completion, refuses a second live unit of one name, and its stop ends only what this HOME started', async () => {
    const home = box('ccrc-codex-fake-', { userManager: true });
    // The parse gate first (ruling R44): every program this task's fixture
    // writes as a whole file parses — the two manager fakes, the runtime
    // interpreter with its tier arms, and the stand-in LiteLLM.
    const gen = plantFakeRuntime(home).gen;
    for (const f of [join(home, '.local', 'bin', 'systemctl'), join(home, '.local', 'bin', 'systemd-run'),
      join(gen, 'bin', 'python')]) {
      const n = spawnSync(BASH, ['-n', f], { encoding: 'utf8' });
      expect(n.status, `bash -n ${f}: ${n.stderr}`).toBe(0);
    }
    const standIn = join(home, 'fake-procs', 'fake-litellm.py');
    const ast = spawnSync(PY!, ['-I', '-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', standIn],
      { encoding: 'utf8' });
    expect(ast.status, `${standIn}: ${ast.stderr}`).toBe(0);
    const e = env(home, { CALLER_ONLY: 'leaked' });
    const sh = (cmd: string) => spawnSync(BASH, ['-c', cmd], { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const log = join(home, 'probe.log');
    const code = 'import os,signal,sys,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print(os.environ.get("A"), os.environ.get("CALLER_ONLY")); sys.stdout.flush(); time.sleep(12)';
    const run = `systemd-run --user --collect --quiet --unit=probe.service -p ${shq(`StandardOutput=append:${log}`)}`
      + ` -p ${shq(`StandardError=append:${log}`)} --setenv=A=1 -- ${shq(PY!)} -B -c ${shq(code)} ${shq(join(home, 'probe-marker'))}`;
    const r = sh(run);
    expect(r.status, r.stderr).toBe(0);
    // `1 None`: the --setenv pair arrived, and the CALLER's environment did not.
    await eventually(() => fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('1 None'), 'the probe line in its log');
    expect(sh('systemctl --user is-active probe.service').stdout.trim()).toBe('active');
    const pid = unitPid(home, 'probe.service');
    expect(pid).toBeGreaterThan(1);
    expect(sh('systemctl --user show -p MainPID --value probe.service').stdout.trim()).toBe(String(pid));
    // ONE live unit per name, as the real manager refuses a second.
    const dup = sh(run);
    expect([dup.status, /already exists/.test(dup.stderr)]).toEqual([1, true]);
    expect(sh('systemctl --user stop probe.service').status).toBe(0);
    await eventually(() => !alive(pid!), 'the probe to exit');
    const unitDir = join(home, 'fake-systemd', 'units', 'probe.service');
    // Fake systemctl can only request and await a named unit stop. Its Python
    // supervisor alone retains the direct child that receives TERM/KILL.
    expect(fs.readFileSync(join(unitDir, 'events'), 'utf8').split('\n').filter(Boolean))
      .toEqual(['TERM', 'TIMEOUT', 'KILL', 'WAIT:-9']);
    expect(fs.readFileSync(join(unitDir, 'state'), 'utf8')).toBe('inactive\n');
    expect(fs.readFileSync(join(unitDir, 'pid'), 'utf8')).toBe('0\n');
    const after = sh('systemctl --user is-active probe.service');
    expect(after.stdout.trim()).toBe('inactive');
    expect(after.status).not.toBe(0);
    // A seeded unit with no supervisor/control channel becomes inactive without
    // signalling its observed PID, so the stranger keeps running.
    const stranger = spawn('sleep', ['600'], { stdio: 'ignore' });
    trackChild(home, stranger);
    fakeUnit(home, 'stranger.service', { state: 'active', pid: stranger.pid! });
    expect(sh('systemctl --user stop stranger.service').status).toBe(0);
    expect(sh('systemctl --user is-active stranger.service').stdout.trim()).toBe('inactive');
    expect(psArgs(stranger.pid!)).toMatch(/^sleep 600/);
    expect(systemdRunArgv(home)[0]!.slice(0, 4)).toEqual(['--user', '--collect', '--quiet', '--unit=probe.service']);
  }, 60_000);

  it.skipIf(!PY)('L0a a responsive fake-manager tier records exact-child TERM then WAIT before stop marks its unit inactive', async () => {
    const home = box('ccrc-codex-manager-responsive-', { userManager: true });
    const e = env(home);
    const sh = (cmd: string) => spawnSync(BASH, ['-c', cmd], { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const unit = 'responsive.service';
    const unitDir = join(home, 'fake-systemd', 'units', unit);
    const run = `systemd-run --user --collect --quiet --unit=${unit} -- ${shq(PY!)} -B -c ${shq('import time; time.sleep(12)')}`;
    expect(sh(run).status).toBe(0);
    await eventually(() => fs.existsSync(join(unitDir, 'pid')) && unitPid(home, unit) !== null, 'the manager tier pid');
    const pid = unitPid(home, unit)!;
    expect(sh(`systemctl --user stop ${unit}`).status).toBe(0);
    expect(alive(pid), 'manager completion preceded the exact-child reap').toBe(false);
    expect(fs.readFileSync(join(unitDir, 'events'), 'utf8').split('\n').filter(Boolean)).toEqual(['TERM', 'WAIT:-15']);
    expect(fs.readFileSync(join(unitDir, 'state'), 'utf8')).toBe('inactive\n');
    expect(fs.readFileSync(join(unitDir, 'pid'), 'utf8')).toBe('0\n');
  }, 30_000);

  it.skipIf(!PY)('L0a a TERM-resistant fake-manager tier times out, kills and reaps its exact child before stop completion', async () => {
    const home = box('ccrc-codex-manager-resistant-', { userManager: true });
    const e = env(home);
    const sh = (cmd: string) => spawnSync(BASH, ['-c', cmd], { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const unit = 'resistant.service';
    const unitDir = join(home, 'fake-systemd', 'units', unit);
    const code = 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(12)';
    const run = `systemd-run --user --collect --quiet --unit=${unit} -- ${shq(PY!)} -B -c ${shq(code)}`;
    try {
      expect(sh(run).status).toBe(0);
      await eventually(() => fs.existsSync(join(unitDir, 'pid')) && unitPid(home, unit) !== null, 'the resistant manager tier pid');
      const pid = unitPid(home, unit)!;
      const supervisorPid = Number(fs.readFileSync(join(unitDir, 'supervisor-pid'), 'utf8').trim());
      const started = Date.now();
      expect(sh(`systemctl --user stop ${unit}`).status).toBe(0);
      expect(Date.now() - started, 'manager stop waited for self-expiry').toBeLessThan(9_000);
      // Round 2 (rereview Minor 2): a BEHAVIOURAL pin on the final exact wait.
      // The supervisor lingers after completion and reaps nothing more, so a
      // KILLed child it never waited for would still be its zombie here. Both
      // reads are `ps` observations, the tier's first: a supervisor row still
      // present at the second read was present at the first, so the first read
      // happened inside that window and cannot pass vacuously.
      const tierAfterStop = psArgs(pid);
      const supervisorAfterStop = psArgs(supervisorPid);
      expect(supervisorAfterStop, 'the supervisor no longer lingers after completion, so this pin binds nothing')
        .toContain(join(unitDir, 'supervisor.py'));
      expect(tierAfterStop, 'WAIT:-9 was written without the final exact wait').toBe('');
      expect(alive(pid), 'manager completion preceded the exact-child reap').toBe(false);
      const events = fs.readFileSync(join(unitDir, 'events'), 'utf8').split('\n').filter(Boolean);
      expect(events).toEqual(['TERM', 'TIMEOUT', 'KILL', 'WAIT:-9']);
      expect(fs.readFileSync(join(unitDir, 'state'), 'utf8')).toBe('inactive\n');
      expect(fs.readFileSync(join(unitDir, 'stop-complete'), 'utf8')).toBe('complete\n');
      const supervisor = fs.readFileSync(join(unitDir, 'supervisor.py'), 'utf8');
      const stopBody = supervisor.slice(supervisor.indexOf('def stop_exact_child'), supervisor.indexOf('with open(out'));
      const requestArm = supervisor.slice(supervisor.indexOf('while proc.poll() is None:'), supervisor.indexOf('time.sleep(linger)'));
      expect(stopBody).toContain('status = proc.wait()');
      expect(stopBody.indexOf('status = proc.wait()')).toBeLessThan(stopBody.indexOf('record("WAIT:%d" % status)'));
      expect(requestArm.indexOf('stop_exact_child(proc)')).toBeLessThan(requestArm.indexOf('complete_inactive()'));
      expect(fs.readFileSync(join(unitDir, 'pid'), 'utf8')).toBe('0\n');
    } catch (error) {
      await eventually(() => unitPid(home, unit) === null, 'the resistant manager tier to self-expire', 15_000);
      throw error;
    }
  }, 30_000);

  it('L0a fake manager refuses an unvalidated unit name before touching its unit directory', () => {
    const home = box('ccrc-codex-manager-name-', { userManager: true });
    const sh = (cmd: string) => spawnSync(BASH, ['-c', cmd], { env: env(home), encoding: 'utf8' });
    const result = sh('systemctl --user stop ..');
    expect(result.status).toBe(90);
    expect(result.stderr).toContain('unsafe unit name');
    expect(fs.existsSync(join(home, 'fake-systemd', 'state'))).toBe(false);
  });

  it('L0a a spawned starting unit stays manager-owned and completes only through its request channel', async () => {
    const home = box('ccrc-codex-manager-starting-', { userManager: true });
    const unit = 'starting.service';
    const unitDir = join(home, 'fake-systemd', 'units', unit);
    fs.mkdirSync(unitDir, { recursive: true });
    fs.writeFileSync(join(unitDir, 'spawned'), '');
    fs.writeFileSync(join(unitDir, 'state'), 'starting\n');
    fs.writeFileSync(join(unitDir, 'pid'), '0\n');
    const stop = spawn(BASH, ['-c', `systemctl --user stop ${unit}`], {
      env: env(home), stdio: 'ignore',
    });
    trackChild(home, stop);
    await eventually(() => fs.existsSync(join(unitDir, 'stop-request')),
      'the manager-owned starting unit to receive a stop request', 1_000);
    expect(fs.readFileSync(join(unitDir, 'state'), 'utf8')).toBe('starting\n');
    fs.writeFileSync(join(unitDir, 'state'), 'inactive\n');
    fs.writeFileSync(join(unitDir, 'pid'), '0\n');
    fs.writeFileSync(join(unitDir, 'stop-complete'), 'complete\n');
    const code = await new Promise<number | null>((resolve) => stop.once('exit', resolve));
    expect(code).toBe(0);
  }, 15_000);

  it.skipIf(!PY)('L0a every fake-manager supervisor has a finite default expiry above the normal readiness bound', async () => {
    const home = box('ccrc-codex-manager-default-expiry-', { userManager: true });
    const e = env(home);
    const sh = (cmd: string) => spawnSync(BASH, ['-c', cmd], { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const unit = 'default-expiry.service';
    const unitDir = join(home, 'fake-systemd', 'units', unit);
    const run = `systemd-run --user --collect --quiet --unit=${unit} -- ${shq(PY!)} -B -c ${shq('import time; time.sleep(12)')}`;
    expect(sh(run).status).toBe(0);
    try {
      await eventually(() => fs.existsSync(join(unitDir, 'supervisor.py')), 'the supervisor source');
      const supervisor = fs.readFileSync(join(unitDir, 'supervisor.py'), 'utf8');
      const match = /^ttl = float\(ttl_raw\) if ttl_raw is not None else ([0-9]+(?:\.[0-9]+)?)$/m.exec(supervisor);
      expect(match, 'an unset CCRC_FAKE_SUPERVISOR_TTL must not disable expiry').not.toBeNull();
      expect(Number(match![1])).toBeGreaterThanOrEqual(120);
      expect(supervisor).toContain('deadline = time.monotonic() + ttl');
    } finally {
      sh(`systemctl --user stop ${unit}`);
    }
  }, 30_000);

  it.skipIf(!PY)('L0a a fake-manager supervisor self-expires and reaps its responsive exact child', async () => {
    const home = box('ccrc-codex-manager-expiry-', { userManager: true });
    const e = env(home);
    const sh = (cmd: string) => spawnSync(BASH, ['-c', cmd], { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const unit = 'expiry.service';
    const unitDir = join(home, 'fake-systemd', 'units', unit);
    const run = `systemd-run --user --collect --quiet --unit=${unit} --setenv=CCRC_FAKE_SUPERVISOR_TTL=1 -- ${shq(PY!)} -B -c ${shq('import time; time.sleep(12)')}`;
    expect(sh(run).status).toBe(0);
    await eventually(() => fs.readFileSync(join(unitDir, 'state'), 'utf8') === 'inactive\n', 'the supervisor self-expiry', 5_000);
    expect(fs.readFileSync(join(unitDir, 'events'), 'utf8').split('\n').filter(Boolean)).toEqual(['TERM', 'WAIT:-15']);
    expect(fs.readFileSync(join(unitDir, 'pid'), 'utf8')).toBe('0\n');
  }, 15_000);

  // Round 2 (rereview Important 1): the supervisor's exact-child control must
  // not depend on its evidence files, because `afterAll` deletes every fixture
  // HOME while a unit a case left running (the uninstall namesake case's
  // deliberately foreign unit) may still be alive. Each tier below sleeps 15 s
  // and then exits ON ITS OWN, so a RED here can never leave a permanent
  // process. Every assertion reads the process table for a pid recorded
  // BEFORE the deletion; nothing in these cases signals any pid.
  const selfExpiringTier = (marker: string): string =>
    `${shq(PY!)} -B -c ${shq('import time; time.sleep(15)')} ${shq(marker)}`;
  /** Observation only (`ps`): the recorded pid is still this case's tier —
   *  its argv carries `marker` — or an unreaped zombie. */
  const tierRow = (pid: number, marker: string): boolean => {
    const args = psArgs(pid);
    return args.includes(marker) || /<defunct>/.test(args);
  };
  async function startSelfExpiringUnit(home: string, unit: string, setenv = ''): Promise<{ pid: number; marker: string; unitDir: string }> {
    const e = env(home);
    const marker = join(home, `tier-marker-${unit}`);
    const unitDir = join(home, 'fake-systemd', 'units', unit);
    const r = spawnSync(BASH, ['-c', `systemd-run --user --collect --quiet --unit=${unit} ${setenv} -- ${selfExpiringTier(marker)}`],
      { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(r.status, r.stderr).toBe(0);
    await eventually(() => fs.existsSync(join(unitDir, 'supervisor-ready')) && unitPid(home, unit) !== null,
      'the self-expiring tier pid', 5_000);
    const pid = unitPid(home, unit)!;
    expect(tierRow(pid, marker), 'the recorded pid is this case\'s tier').toBe(true);
    return { pid, marker, unitDir };
  }
  /** The bounded assertion, and on its failure a wait for the tier's own
   *  15-second exit, so a RED leaves nothing behind. Never a signal. */
  async function expectTierGone(pid: number, marker: string, what: string, ms: number): Promise<void> {
    try {
      await eventually(() => !tierRow(pid, marker), what, ms);
    } catch (error) {
      await eventually(() => !tierRow(pid, marker), 'the self-expiring tier to exit on its own', 20_000);
      throw error;
    }
  }

  it.skipIf(!PY)('L0a a vanished unit directory is a stop request: the supervisor reaps its exact child with no evidence file left to write', async () => {
    const home = box('ccrc-codex-manager-vanished-', { userManager: true });
    // The default 120-second expiry: only the vanished directory can end this
    // tier inside the bound.
    const { pid, marker, unitDir } = await startSelfExpiringUnit(home, 'vanished.service');
    fs.rmSync(unitDir, { recursive: true, force: true });
    await expectTierGone(pid, marker, 'the supervisor to reap its exact child once its unit directory vanished', 8_000);
  }, 45_000);

  it.skipIf(!PY)('L0a supervisor expiry reaps its exact child after the whole fixture HOME is gone', async () => {
    const home = box('ccrc-codex-manager-expiry-nohome-', { userManager: true });
    const { pid, marker } = await startSelfExpiringUnit(home, 'expiry-nohome.service', '--setenv=CCRC_FAKE_SUPERVISOR_TTL=3');
    // What `afterAll(removeTmpFixtures)` does at the end of every file.
    fs.rmSync(home, { recursive: true, force: true });
    expect(fs.existsSync(home)).toBe(false);
    await expectTierGone(pid, marker, 'the supervisor to reap its exact child with its HOME gone', 10_000);
  }, 45_000);

  it.skipIf(!PY)('L0a a TERM to the supervisor itself is a stop request: it reaps its exact child before it exits (a directly held handle, never a pid)', async () => {
    const home = box('ccrc-codex-manager-supervisor-term-', { userManager: true });
    // One real start plants the supervisor exactly as systemd-run writes it;
    // its own unit is then stopped through the manager's request channel.
    const planted = await startSelfExpiringUnit(home, 'source.service');
    const source = join(planted.unitDir, 'supervisor.py');
    const copy = join(home, 'supervisor-under-test.py');
    fs.copyFileSync(source, copy);
    spawnSync(BASH, ['-c', 'systemctl --user stop source.service'], { env: env(home), stdio: 'ignore' });
    await expectTierGone(planted.pid, planted.marker, 'the source unit\'s requested stop', 10_000);
    // The same source, run as THIS process's direct child: the one authority
    // that may signal it is the handle below, never an observed pid.
    const unitDir = join(home, 'direct-unit');
    fs.mkdirSync(unitDir);
    const marker = join(home, 'tier-marker-direct');
    const supervisor = spawn(PY!, ['-B', copy, unitDir, home, '/dev/null', '/dev/null',
      PY!, '-B', '-c', 'import time; time.sleep(15)', marker],
    { cwd: home, env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' }, stdio: 'ignore' });
    trackChild(home, supervisor);
    const exited = new Promise<number | null>((resolve) => supervisor.once('exit', (code) => resolve(code)));
    await eventually(() => fs.existsSync(join(unitDir, 'supervisor-ready')), 'the directly held supervisor to start its tier', 5_000);
    const pid = Number(fs.readFileSync(join(unitDir, 'pid'), 'utf8').trim());
    expect(tierRow(pid, marker), 'the recorded pid is this case\'s tier').toBe(true);
    supervisor.kill('SIGTERM');
    await expectTierGone(pid, marker, 'the TERMed supervisor to reap its exact child', 8_000);
    expect(await exited).toBe(0);
    expect(fs.readFileSync(join(unitDir, 'events'), 'utf8').split('\n').filter(Boolean)).toEqual(['TERM', 'WAIT:-15']);
    expect(fs.readFileSync(join(unitDir, 'stop-complete'), 'utf8')).toBe('complete\n');
  }, 60_000);

  it.skipIf(!PY)('L0a a launcher descheduled after it backgrounds the supervisor never overwrites the supervisor\'s active state and pid', async () => {
    const home = box('ccrc-codex-manager-launch-order-', { userManager: true });
    // Rereview Minor 3's model of a preempted launcher, applied to THIS HOME's
    // planted copy only: whatever the launcher still writes after the fork
    // lands a full second after the supervisor's own writes.
    const runner = join(home, '.local', 'bin', 'systemd-run');
    const anchor = 'supervisor="$!"\n';
    const src = fs.readFileSync(runner, 'utf8');
    expect(src.split(anchor), 'the planted systemd-run has one backgrounding point').toHaveLength(2);
    fs.writeFileSync(runner, src.replace(anchor, `${anchor}sleep 1\n`), { mode: 0o755 });
    const unit = 'launch-order.service';
    const unitDir = join(home, 'fake-systemd', 'units', unit);
    const marker = join(home, `tier-marker-${unit}`);
    const e = env(home);
    const sh = (cmd: string) => spawnSync(BASH, ['-c', cmd], { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    // Returns only after the injected second, so the launcher has finished
    // every write it makes.
    const r = sh(`systemd-run --user --collect --quiet --unit=${unit} -- ${selfExpiringTier(marker)}`);
    expect(r.status, r.stderr).toBe(0);
    try {
      await eventually(() => fs.existsSync(join(unitDir, 'supervisor-ready')), 'the supervisor to start its tier', 5_000);
      expect(fs.readFileSync(join(unitDir, 'state'), 'utf8'), 'the launcher overwrote the supervisor\'s state').toBe('active\n');
      const pid = unitPid(home, unit);
      expect(pid, 'the launcher overwrote the supervisor\'s pid').not.toBeNull();
      expect(tierRow(pid!, marker), 'the recorded pid is this case\'s tier').toBe(true);
      expect(sh(`systemctl --user is-active ${unit}`).stdout.trim()).toBe('active');
      expect(sh(`systemctl --user show -p MainPID --value ${unit}`).stdout.trim()).toBe(String(pid));
    } finally {
      // A request through the manager's own channel, never a signal. It ends
      // the tier on the RED path too, where no pid was left to observe.
      sh(`systemctl --user stop ${unit}`);
    }
    expect(fs.readFileSync(join(unitDir, 'stop-complete'), 'utf8')).toBe('complete\n');
    expect(fs.readFileSync(join(unitDir, 'events'), 'utf8').split('\n').filter(Boolean)).toEqual(['TERM', 'WAIT:-15']);
  }, 60_000);

  it('L0a safety pins: fake systemctl has no signal vocabulary at all, and the safety report says what the fixture does', () => {
    const fixture = fs.readFileSync(join(here, 'codexLaneFixture.ts'), 'utf8');
    const from = fixture.indexOf('const FAKE_SYSTEMCTL');
    const to = fixture.indexOf('const FAKE_SYSTEMD_RUN');
    expect(from, 'the FAKE_SYSTEMCTL constant').toBeGreaterThan(0);
    expect(to, 'the FAKE_SYSTEMD_RUN constant after it').toBeGreaterThan(from);
    const control = fixture.slice(from, to);
    // Round 2 (rereview Minor 1): STRUCTURAL, never one spelling. No `kill`
    // token in any case or form (bare, numeric, `-s KILL`, `-SIGKILL`,
    // `/bin/kill`, `pkill`, `killall`, `os.kill`, `killpg`, `pthread_kill`)
    // and no `/proc` read, over the whole constant AND over the bytes
    // plantSystemd writes. The senders that spell no `kill` are scanned the
    // same way, in any case: `fuser` (whose `-k` signals every holder of a
    // file), and the Python `signal` module's other senders,
    // `pidfd_send_signal`, `raise_signal`, `alarm` and `setitimer`.
    // Fake systemctl's only stop is the request/completion channel.
    const home = box('ccrc-codex-manager-vocabulary-', { userManager: true });
    const planted = fs.readFileSync(join(home, '.local', 'bin', 'systemctl'), 'utf8');
    for (const [what, text] of [['FAKE_SYSTEMCTL', control], ['the planted systemctl', planted]] as const) {
      expect(text.match(/kill/gi) ?? [], `${what} carries signal vocabulary`).toEqual([]);
      expect(text.match(/\/proc\b/g) ?? [], `${what} reads /proc`).toEqual([]);
      expect(text.match(/fuser/gi) ?? [], `${what} names fuser`).toEqual([]);
      expect(text.match(/pidfd_send_signal|raise_signal|alarm|setitimer/gi) ?? [],
        `${what} names a Python signal-module sender`).toEqual([]);
      expect(text, what).toContain('valid_unit "$u"');
      expect(text, what).toContain('stop-request');
      expect(text, what).toContain('stop-complete');
    }
    const report = fs.readFileSync(join(REPO, '.superpowers', 'sdd', '2026-09-23-gpt-lane-ownership-2b2-the-lane-runs', 'final-reaper-safety-report.md'), 'utf8');
    const prose = report.replace(/\s+/g, ' ');
    expect(report).not.toContain('final-reaper-ownership-correction-report.md');
    // Rereview F2b: the reparented-tier sentence ITSELF, not any mention of a
    // Python supervisor (the manager paragraph names one too).
    expect(prose).toContain('A reparented fake LiteLLM tier is owned through a directly held Python supervisor');
    expect(prose).not.toMatch(/shell supervisor/i);
    // Rereview observation: `active` is written before any wait.
    expect(prose).not.toContain('writes its state only after waiting');
  });

  // The stand-in LiteLLM started DIRECTLY (ruling R29), and a lane config
  // planted by the real renderer (ruling R20): what Tasks 8, 10 and 11 lean on.
  // Both branches have current-run ChildProcess ownership: direct tiers by
  // their handle and reparented tiers by their Python supervisor.
  const assertFakeLitellm = async (reparent: boolean): Promise<void> => {
    const home = box('ccrc-codex-fake-litellm-');
    const [port] = await freePorts(1);
    const config = plantLaneConfig(home, 'codex-a');
    expect(config).toBe(litellmYaml(home, 'codex-a'));
    expect(fs.statSync(config).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(config, 'utf8')).toContain('master_key: os.environ/LITELLM_MASTER_KEY');
    await expect(spawnFakeLitellm(home, { port: port!, config: join(home, 'absent.yaml'), reparent }))
      .rejects.toThrow(/is not a file/);
    const pid = await spawnFakeLitellm(home, { port: port!, config, reparent });
    expect(await portAccepts(port!)).toBe(true);
    // `_codex_pid_is_tier` proves a LiteLLM by `--config <this lane's litellm.yaml>`, two words.
    expect(lib(home, `_codex_pid_is_tier codex-a litellm ${pid}; echo "rc=$?"`).stdout).toBe('rc=0\n');
    expect(litellmEvidence(home, port!)?.['pid']).toBe(pid);
    await killLaneProcesses(home);
    if (reparent) await eventually(() => !alive(pid), 'the stand-in to exit');
    expect(await portAccepts(port!)).toBe(false);
  };

  it('L0b the instrument: spawnFakeLitellm (direct child) runs the stand-in with a lane tier\'s command line on the port it is given, refuses a config that is no file, and the afterEach cleanup ends it', async () => {
    await assertFakeLitellm(false);
  }, 60_000);

  it('L0b the instrument: spawnFakeLitellm (supervised) runs the stand-in with a lane tier\'s command line on the port it is given, refuses a config that is no file, and the afterEach cleanup ends it', async () => {
    await assertFakeLitellm(true);
  }, 60_000);

  it('L0c fixture cleanup owns a supervised stand-in through its current-run handle', async () => {
    const home = box('ccrc-codex-supervisor-owner-');
    const [port] = await freePorts(1);
    const pid = await spawnFakeLitellm(home, {
      port: port!, config: plantLaneConfig(home, 'codex-a'), reparent: true,
    });
    await killLaneProcesses(home);
    await eventually(() => !alive(pid), 'the current-run supervisor to reap its tier');
    expect(await portAccepts(port!)).toBe(false);
  }, 60_000);

  it('L0c1 a TERM-responsive supervised tier records TERM then WAIT, is reaped, and closes its port before cleanup resolves', async () => {
    const home = box('ccrc-codex-supervisor-responsive-');
    const [port] = await freePorts(1);
    const pid = await spawnFakeLitellm(home, {
      port: port!, config: plantLaneConfig(home, 'codex-a'), reparent: true,
    });
    await killLaneProcesses(home);
    expect(litellmTeardownEvents(home, port!)).toEqual(['TERM', 'WAIT:-15']);
    expect(alive(pid), 'the supervisor returned before its direct tier exited').toBe(false);
    expect(psArgs(pid), 'the supervisor did not reap its direct tier').toBe('');
    expect(await portAccepts(port!), 'the reaped tier kept its fixture port').toBe(false);
  }, 30_000);

  it('L0c2 a TERM-resistant supervised tier is killed, reaped, and closes its port before cleanup resolves', async () => {
    const home = box('ccrc-codex-supervisor-resistant-');
    const [port] = await freePorts(1);
    // The self-expiry is only the broken-path safety net. Fixed teardown KILLs
    // and reaps materially earlier, without signaling this observed PID.
    resistLitellmTerm(home, 12);
    const pid = await spawnFakeLitellm(home, {
      port: port!, config: plantLaneConfig(home, 'codex-a'), reparent: true,
    });
    const started = Date.now();
    try {
      await killLaneProcesses(home);
      expect(litellmTeardownEvents(home, port!)).toEqual(['TERM', 'TIMEOUT', 'KILL', 'WAIT:-9']);
      expect(Date.now() - started, 'cleanup waited for the fake self-expiry').toBeLessThan(9_000);
      expect(alive(pid), 'the supervisor returned before its direct tier exited').toBe(false);
      expect(psArgs(pid), 'the supervisor did not reap its direct tier').toBe('');
      expect(await portAccepts(port!), 'the reaped tier kept its fixture port').toBe(false);
    } catch (error) {
      // Broken RED/mutation paths may leave the tier until its finite expiry.
      await eventually(() => !alive(pid), 'the TERM-resistant fake to self-expire', 15_000);
      throw error;
    }
  }, 30_000);

  it('L0d a product stop reaps its supervised direct fixture tier while this Node process is blocked in spawnSync', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const d = laneDir(home, 'codex-a');
    const pid = await spawnFakeLitellm(home, {
      port: a.litellmPort, config: litellmYaml(home, 'codex-a'), reparent: true,
    });
    writeFileSync(join(d, 'litellm.pid'), `${pid}\n`, { mode: 0o600 });
    // `codex` blocks this event loop in spawnSync. The supervisor, a direct
    // child of this run, must wait/reap the tier without Node running events.
    const stopped = codex(home, ['stop', 'codex-a']);
    expect(stopped.code, stopped.stderr).toBe(0);
    await eventually(() => !alive(pid), 'the product-stopped supervised tier to be reaped');
    expect(psArgs(pid), 'a reaped tier has no remaining process-table row').toBe('');
    expect(await portAccepts(a.litellmPort)).toBe(false);
  }, 60_000);

  it('L0e fixture cleanup calls the real product stop before direct handles', async () => {
    const { home, lanes } = await lifeBox({ userManager: true, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const started = codex(home, ['start', 'codex-a']);
    expect(started.code, started.stderr).toBe(0);
    await killLaneProcesses(home);
    expect(stopCalls(home).join('\n')).toMatch(/ccgpt-codex-a-(litellm|shim)\.service/);
    expect(await portAccepts(a.proxyPort)).toBe(false);
    expect(await portAccepts(a.litellmPort)).toBe(false);
  }, 60_000);

  // ── the verb's surface: role, usage, refusals ──────────────────────────────
  // `login` too (ruling R18): the gate runs before any subcommand is dispatched,
  // so it answers here although `_codex_login` is Task 8's.
  it.each(['start', 'stop', 'status', 'login'])('L1 %s refuses on a server-role box, before it reads or locks anything', async (sub) => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    fs.writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
    const r = codex(home, [sub, 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: server-role: .*CCRC_ROLE=server/m);
    expect(r.stdout).toBe('');
    expect(systemdRunCalls(home)).toEqual([]);
    for (const f of ['runtime.env', '.lock']) expect(fs.existsSync(join(laneDir(home, 'codex-a'), f)), f).toBe(false);
  }, 60_000);

  const USAGE: Array<[string[], RegExp]> = [
    [[], /needs a subcommand/],
    [['wat', 'codex-a'], /no subcommand "wat"/],
    [['start'], /needs a lane id/],
    // `login` is a subcommand of this verb (ruling R18), so its missing id is
    // the id parse's refusal, not `no subcommand "login"`.
    [['login'], /needs a lane id/],
    [['start', 'codex-a', 'extra'], /got "extra"/],
    [['status', 'codex-a', '--yaml'], /got "--yaml"/],
  ];
  it.each(USAGE)('L2 a usage error is exit 2 (ruling R3), one line, before any lane is read: %j', (args, why) => {
    const home = box('ccrc-codex-usage-');   // no roster at all: usage is decided before one is read
    const r = codex(home, args);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc codex: usage: /m);
    expect(r.stderr).toMatch(why);
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(r.stdout).toBe('');
  });

  // `mintsKey`: not-logged-in and runtime-absent refuse BEFORE the gateway key is
  // generated; a lane that cannot run gets no key.
  const REFUSALS: Array<[string, (h: string) => void, RegExp, boolean]> = [
    ['not-logged-in', (h) => fs.rmSync(join(h, codexAuthDir('codex-a'), 'auth.json')), /ccrc codex login codex-a/, false],
    ['runtime-absent', (h) => fs.rmSync(join(h, '.ccrc', 'runtime', 'codex', 'current')), /ccgpt-runtime build/, false],
    // Ruling R4: this task renders nothing. Task 6's `_codex_litellm_ensure`
    // replaces this refusal with the render call, and moves this row.
    ['litellm-unrendered', (h) => fs.rmSync(litellmYaml(h, 'codex-a')), /ccrc models litellm codex-a/, true],
  ];
  it.each(REFUSALS)('L3 %s: refused by name, with its remedy, and nothing starts', async (code, spoil, remedy, mintsKey) => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    spoil(home);
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`^ccrc codex: ${code}: `, 'm'));
    expect(r.stderr).toMatch(remedy);
    expect(r.stdout).toBe('');
    for (const t of ['litellm', 'shim']) expect(fs.existsSync(join(laneDir(home, 'codex-a'), `${t}.pid`)), t).toBe(false);
    expect(litellmEvidence(home, lanes['codex-a']!.litellmPort)).toBeNull();
    expect(fs.existsSync(join(laneDir(home, 'codex-a'), 'runtime.env'))).toBe(mintsKey);
  }, 60_000);

  // Ruling R3: `_codex_row`'s rc 2 for a malformed id reaches the exit status;
  // every other refusal is 1.
  it.each([['claude', 'not-codex', 1], ['nobody', 'not-rostered', 1], ['Codex_A', 'usage', 2]] as const)(
    'L4 start %s answers %s, exit %i, through the verb', async (id, code, exit) => {
      const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
      const r = codex(home, ['start', id]);
      expect(r.code).toBe(exit);
      expect(r.stderr).toMatch(new RegExp(`^ccrc codex: ${code}: `, 'm'));
      expect(systemdRunCalls(home)).toEqual([]);
    }, 60_000);

  // ── identity: never adopt, never stop what cannot be identified ────────────
  it.each(['shim', 'litellm'] as const)('L5 a foreign listener on the %s port is refused by start and left running by stop, named both times (D-3488)', async (tier) => {
    // Linux runs the unit arm here, so "no systemd-run call" means something; the
    // macOS arm is always nohup, where the pidfiles say the same thing.
    const { home, lanes } = await lifeBox({ userManager: !IS_DARWIN, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const port = tier === 'shim' ? a.proxyPort : a.litellmPort;
    // The other repository's shim shape — text/plain, the bare id — with the SAME id.
    const other = await spawnListener(home, { answer: 'text', lane: 'codex-a', port });
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`^ccrc codex: port-foreign: port ${port} `, 'm'));
    expect(r.stderr).toMatch(/Nothing was started/);
    // NOTHING started, not even the tier whose port was free…
    expect(systemdRunCalls(home)).toEqual([]);
    for (const t of ['litellm', 'shim']) expect(fs.existsSync(join(laneDir(home, 'codex-a'), `${t}.pid`)), t).toBe(false);
    // …and the listener is untouched.
    expect(await portAccepts(port)).toBe(true);
    const s = codex(home, ['stop', 'codex-a']);
    expect(s.code, s.stderr).toBe(0);
    expect(s.stdout).toBe(tier === 'shim'
      ? 'ccrc codex: codex-a: litellm not running, shim foreign\n'
      : 'ccrc codex: codex-a: litellm foreign, shim not running\n');
    expect(s.stderr).toContain(`port ${port} (codex-a's ${tier} tier) is held by a listener that is not this lane's`);
    expect(s.stderr).toMatch(/ccrc left it running\.$/m);
    expect(stopCalls(home)).toEqual([]);
    expect(await portAccepts(port)).toBe(true);
    expect(psArgs(other.pid)).toContain('listener.py');
  }, 60_000);

  it('L6 status --json is ONE object in the contract shape, and reads lane.json without writing it', async () => {
    const { home, lanes, rt } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const gen = path.basename(rt.gen);
    const status = (): Record<string, unknown> => {
      const r = codex(home, ['status', 'codex-a', '--json']);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout.split('\n'), 'one line and its newline').toHaveLength(2);
      return JSON.parse(r.stdout) as Record<string, unknown>;
    };
    const stopped = { state: 'stopped', via: null, pid: null };
    expect(status()).toEqual({
      id: 'codex-a', tiers: { litellm: stopped, shim: stopped }, runtime: { generation: gen }, lane: { json: 'current' },
    });
    const lj = join(laneDir(home, 'codex-a'), 'lane.json');
    const good = fs.readFileSync(lj, 'utf8');
    fs.writeFileSync(lj, JSON.stringify({ ...JSON.parse(good), proxyPort: 1 }));
    expect(status()['lane']).toEqual({ json: 'stale' });
    expect(JSON.parse(fs.readFileSync(lj, 'utf8'))['proxyPort'], 'status re-rendered lane.json').toBe(1);
    fs.rmSync(lj);
    expect(status()['lane']).toEqual({ json: 'absent' });
    expect(fs.existsSync(lj), 'status wrote lane.json').toBe(false);
    fs.writeFileSync(lj, good);
    await spawnListener(home, { answer: 'text', lane: 'codex-a', port: a.proxyPort });
    expect((status()['tiers'] as Record<string, unknown>)['shim']).toEqual({ state: 'foreign', via: null, pid: null });
    const h = codex(home, ['status', 'codex-a']);
    expect(h.code).toBe(0);
    expect(h.stdout).toBe([
      'ccrc codex: codex-a: litellm stopped',
      // Review A2: named in `_codex_foreign_what`'s words, never a sentence
      // of status's own.
      `ccrc codex: codex-a: shim FOREIGN — port ${a.proxyPort} (codex-a's shim tier) is held by a listener that is not this lane's: its identity check failed. `
        + `Stop whatever holds port ${a.proxyPort}, or give codex-a other ports in ~/.ccrc/accounts.json. ccrc will neither adopt nor stop it.`,
      `ccrc codex: codex-a: runtime ${gen}; lane.json current`,
      '',
    ].join('\n'));
    fs.rmSync(join(home, '.ccrc', 'runtime', 'codex', 'current'));
    expect(status()['runtime']).toEqual({ generation: null });
  }, 60_000);

  // ── the nohup arm: a box with no user manager (and every macOS box) ────────
  it('L7 with no user manager the nohup arm runs both tiers — the REAL shim carrying its --ccrc-lane marker — records their pids, adopts them again, and stops them', async () => {
    const { home, lanes, shimFile } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const d = laneDir(home, 'codex-a');
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    const m = /^ccrc codex: codex-a: litellm started \(nohup (\d+)\), shim started \(nohup (\d+)\)\n$/.exec(r.stdout);
    expect(m, r.stdout).not.toBeNull();
    const lit = Number(m![1]);
    const shim = Number(m![2]);
    expect(Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'))).toBe(lit);
    expect(Number(fs.readFileSync(join(d, 'shim.pid'), 'utf8'))).toBe(shim);
    expect(alive(lit) && alive(shim)).toBe(true);
    expect(systemdRunCalls(home), 'a manager was asked to run something').toEqual([]);
    const logs = logDir(home, 'codex-a');
    expect(fs.readFileSync(join(logs, 'litellm.log'), 'utf8')).toMatch(/fixture litellm: listening on/);
    expect(fs.existsSync(join(logs, 'shim.log'))).toBe(true);
    // The key reached LiteLLM from runtime.env, and the recorded pid IS the tier.
    const ev = litellmEvidence(home, a.litellmPort)!;
    expect([ev['masterKeyShaped'], ev['pid']]).toEqual([true, lit]);
    // Ruling R6: the shim that runs IS the shipped file, started with ccrc's
    // lane marker as a whole word after it, and the marker is inert to it: it
    // binds and answers `/ccgpt/lane` as this lane.
    expect(sha256(shimFile)).toBe(sha256(join(REPO, 'ccd', 'ccgpt-proxy.py')));
    expect(` ${psArgs(shim).trim()} `).toContain(` ${shimFile} --ccrc-lane=codex-a `);
    const lane = await laneAnswer(a.proxyPort);
    expect(lane?.status).toBe(200);
    expect(lane?.type).toMatch(/^application\/json/);
    expect(JSON.parse(lane!.body)).toEqual({ lane: 'codex-a' });
    const st = codex(home, ['status', 'codex-a', '--json']);
    expect((JSON.parse(st.stdout) as { tiers: unknown }).tiers).toEqual({
      litellm: { state: 'running', via: 'nohup', pid: lit }, shim: { state: 'running', via: 'nohup', pid: shim },
    });
    const again = codex(home, ['start', 'codex-a']);
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).toBe(`ccrc codex: codex-a: litellm adopted (nohup ${lit}), shim adopted (nohup ${shim})\n`);
    const s = codex(home, ['stop', 'codex-a']);
    expect(s.code, s.stderr).toBe(0);
    expect(s.stdout).toBe('ccrc codex: codex-a: litellm stopped, shim stopped\n');
    await eventually(() => !alive(lit) && !alive(shim), 'both nohup tiers to exit');
    for (const f of ['litellm.pid', 'shim.pid', 'litellm.started', 'shim.started']) {
      expect(fs.existsSync(join(d, f)), f).toBe(false);
    }
    expect(fs.existsSync(join(home, 'curl-poison')), 'the lane verb reached curl').toBe(false);
  }, 120_000);

  it('L8 a pidfile naming another lane\'s live tier is STALE, not foreign: status reads stopped, stop signals nothing and removes it, and start replaces it without signalling its pid (ruling R34)', async () => {
    const { home, lanes } = await lifeBox({ userManager: false });
    const a = lanes['codex-a']!;
    const b = lanes['codex-b']!;
    expect(codex(home, ['start', 'codex-b']).code).toBe(0);
    const bd = laneDir(home, 'codex-b');
    const bl = Number(fs.readFileSync(join(bd, 'litellm.pid'), 'utf8'));
    const bs = Number(fs.readFileSync(join(bd, 'shim.pid'), 'utf8'));
    // codex-a's pidfiles name codex-b's LIVE tiers: pid reuse, or a hand edit.
    // Their command lines carry codex-b's --config and --ccrc-lane=codex-b, so
    // they prove nothing of codex-a's, and nothing answers on codex-a's ports:
    // `_codex_tier_ours` reads past both files and answers 1, not running.
    const ad = laneDir(home, 'codex-a');
    const plantStale = (): void => {
      fs.writeFileSync(join(ad, 'litellm.pid'), `${bl}\n`);
      fs.writeFileSync(join(ad, 'shim.pid'), `${bs}\n`);
    };
    const bStillUp = async (): Promise<void> => {
      expect(alive(bl) && alive(bs), "codex-b's tiers").toBe(true);
      expect(JSON.parse((await laneAnswer(b.proxyPort))!.body)).toEqual({ lane: 'codex-b' });
      expect(await portAccepts(b.litellmPort)).toBe(true);
      expect(fs.existsSync(join(bd, 'shim.pid'))).toBe(true);
    };
    plantStale();
    const st = JSON.parse(codex(home, ['status', 'codex-a', '--json']).stdout) as { tiers: Record<string, { state: string }> };
    expect([st.tiers['litellm']!.state, st.tiers['shim']!.state]).toEqual(['stopped', 'stopped']);
    // stop: nothing of codex-a's runs, nothing is foreign, and the stale files go.
    const s = codex(home, ['stop', 'codex-a']);
    expect(s.code, s.stderr).toBe(0);
    expect(s.stdout).toBe('ccrc codex: codex-a: litellm not running, shim not running\n');
    expect(s.stderr).toBe('');
    expect(fs.existsSync(join(ad, 'litellm.pid')) || fs.existsSync(join(ad, 'shim.pid')), 'stale pidfiles kept').toBe(false);
    await bStillUp();
    // start: this lane's own tiers, under their own pids, and codex-b's untouched.
    plantStale();
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    const m = /^ccrc codex: codex-a: litellm started \(nohup (\d+)\), shim started \(nohup (\d+)\)\n$/.exec(r.stdout);
    expect(m, r.stdout).not.toBeNull();
    expect([Number(fs.readFileSync(join(ad, 'litellm.pid'), 'utf8')), Number(fs.readFileSync(join(ad, 'shim.pid'), 'utf8'))])
      .toEqual([Number(m![1]), Number(m![2])]);
    expect(JSON.parse((await laneAnswer(a.proxyPort))!.body)).toEqual({ lane: 'codex-a' });
    await bStillUp();
    // The nohup arm is Darwin's production arm. Stop both tiers directly while
    // this successful test still owns the product command, rather than asking
    // afterEach to reconstruct authority from their evidence PIDs.
    expect(codex(home, ['stop', 'codex-a']).code).toBe(0);
    expect(codex(home, ['stop', 'codex-b']).code).toBe(0);
  }, 120_000);

  it('L9 a tier that never answers is tier-not-ready, naming its log, inside the bounded wait', async () => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    refuseLitellmStart(home);
    const t0 = Date.now();
    const r = codex(home, ['start', 'codex-a'], { CCRC_CODEX_READY_S: '3' });
    expect(r.code).toBe(1);
    const log = join(logDir(home, 'codex-a'), 'litellm.log');
    expect(r.stderr).toMatch(/^ccrc codex: tier-not-ready: codex-a's litellm tier did not answer as this lane within 3s/m);
    expect(r.stderr).toContain(log);
    expect(fs.readFileSync(log, 'utf8')).toMatch(/fixture litellm: refusing to start/);
    expect(Date.now() - t0).toBeLessThan(30_000);
    // LiteLLM exited before the failed start returned, but the shim has a
    // product pidfile. Stop it before a successful Darwin test returns.
    expect(codex(home, ['stop', 'codex-a']).code).toBe(0);
  }, 60_000);

  itLinux('L16 a tier whose proven handle lives while its port is silent is ours, starting: status says so, start waits on it and never starts over it, and stop stops it (ruling R7)', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const d = laneDir(home, 'codex-a');
    // Mint the gateway key FIRST. A start that creates or replaces runtime.env
    // restarts a 0 or 4 LiteLLM (ruling R21, L20's subject), so without this
    // line the start below would stop the planted tier and start its own. The
    // case would then test R21's restart, not R7's adopt-and-wait.
    expect(lib(home, '_codex_runtime_env_ensure codex-a').code).toBe(0);
    // A LiteLLM still importing: its command line is this lane's, and it binds
    // nothing yet. Linux-only because this deliberately reparented product
    // shape is under test; its explicit product stop remains the cleanup path.
    const plant = spawnSync(BASH, ['-c',
      'nohup "$0" -B -c "import time; time.sleep(600)" --config "$1" </dev/null >/dev/null 2>&1 & echo $!',
      PY!, litellmYaml(home, 'codex-a')], { encoding: 'utf8' });
    const pid = Number(plant.stdout.trim());
    expect(pid > 1, plant.stderr).toBe(true);
    fs.writeFileSync(join(d, 'litellm.pid'), `${pid}\n`);
    await eventually(() => psArgs(pid).includes(`--config ${litellmYaml(home, 'codex-a')}`), 'the planted tier to exec');
    const st = codex(home, ['status', 'codex-a', '--json']);
    expect((JSON.parse(st.stdout) as { tiers: Record<string, unknown> }).tiers['litellm'])
      .toEqual({ state: 'starting', via: 'nohup', pid });
    expect(codex(home, ['status', 'codex-a']).stdout)
      .toMatch(new RegExp(`^ccrc codex: codex-a: litellm starting \\(nohup, pid ${pid}\\)`, 'm'));
    const r = codex(home, ['start', 'codex-a'], { CCRC_CODEX_READY_S: '3' });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: tier-not-ready: codex-a's litellm tier did not answer as this lane within 3s/m);
    // It WAITED on the starting tier: no LiteLLM was started over it.
    expect(litellmEvidence(home, a.litellmPort)).toBeNull();
    expect(Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'))).toBe(pid);
    expect(alive(pid)).toBe(true);
    // Every stop stops a 4 (ruling R8): it is this lane's, by its command line.
    const s = codex(home, ['stop', 'codex-a']);
    expect(s.code, s.stderr).toBe(0);
    expect(s.stdout).toBe('ccrc codex: codex-a: litellm stopped, shim stopped\n');
    await eventually(() => !alive(pid), 'the starting tier to exit');
  }, 120_000);

  // Ruling R21: LiteLLM holds the key it was STARTED with, and the launcher
  // reads runtime.env on every session start. `restarts`: whether the file's
  // spoiling is a NEW key (`created`, `replaced`) or the same one (`rechmod`).
  const REKEY: Array<[string, (f: string) => void, boolean]> = [
    ['deleted', (f) => fs.rmSync(f), true],
    ['garbled', (f) => fs.writeFileSync(f, 'LITELLM_MASTER_KEY=not-a-key\n', { mode: 0o600 }), true],
    ['re-moded', (f) => fs.chmodSync(f, 0o644), false],
  ];
  it.each(REKEY)('L20 runtime.env %s under a running LiteLLM: a new key restarts that tier before readiness, the same key restarts nothing, and the shim is never restarted (ruling R21)', async (_what, spoil, restarts) => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const d = laneDir(home, 'codex-a');
    const keyFile = join(d, 'runtime.env');
    const first = codex(home, ['start', 'codex-a']);
    expect(first.code, first.stderr).toBe(0);
    const lit = Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'));
    const shim = Number(fs.readFileSync(join(d, 'shim.pid'), 'utf8'));
    const before = fs.readFileSync(keyFile, 'utf8');
    spoil(keyFile);
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    // The file is whole again, 0600, and a NEW key exactly when one was minted.
    const after = fs.readFileSync(keyFile, 'utf8');
    expect(after).toMatch(/^LITELLM_MASTER_KEY=sk-[0-9a-f]{48}\n$/);
    expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(after === before, 'the key is the one LiteLLM started with').toBe(!restarts);
    const now = Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'));
    if (restarts) {
      expect(r.stdout).toBe(`ccrc codex: codex-a: litellm started (nohup ${now}), shim adopted (nohup ${shim})\n`);
      expect(now).not.toBe(lit);
      await eventually(() => !alive(lit), 'the old-key LiteLLM to exit');
    } else {
      expect(r.stdout).toBe(`ccrc codex: codex-a: litellm adopted (nohup ${lit}), shim adopted (nohup ${shim})\n`);
      expect(now).toBe(lit);
    }
    // The LiteLLM that answers is the one the pidfile names, started from this
    // runtime.env: a restarted one read the new file at its spawn.
    expect([litellmEvidence(home, a.litellmPort)!['pid'], litellmEvidence(home, a.litellmPort)!['masterKeyShaped']])
      .toEqual([now, true]);
    expect(alive(shim), 'the shim').toBe(true);
    expect(JSON.parse((await laneAnswer(a.proxyPort))!.body)).toEqual({ lane: 'codex-a' });
    // Product stop is a behavioral assertion; the current-run callback covers
    // failure paths before afterEach releases this fixture HOME.
    expect(codex(home, ['stop', 'codex-a']).code).toBe(0);
  }, 120_000);

  // Ruling R22: every lane read goes through jq, and lane.json's one writer runs
  // under node, so both are proven before any subcommand reads a lane. `login`
  // is the one exception (ruling PF-31, Plan 2b-2 Task 8): it never runs
  // models-op.mjs, so it is excluded from the node case below and pinned past
  // it, on its own, next.
  it.each(['jq', 'node'])('L21 with no %s on PATH every subcommand that needs it is missing-dependency, named, before any lane is read (ruling R22)', async (tool) => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const PATH = pathWithout(home, tool);
    const subs = tool === 'node' ? ['start', 'stop', 'status'] : ['start', 'stop', 'status', 'login'];
    for (const sub of subs) {
      const r = codex(home, [sub, 'codex-a'], { PATH });
      expect(r.code, `${sub}: ${r.stderr}`).toBe(1);
      expect(r.stderr).toMatch(new RegExp(`^ccrc codex: missing-dependency: ${tool} is not on PATH`));
      expect(r.stderr.trimEnd().split('\n'), sub).toHaveLength(1);
      expect(r.stdout).toBe('');
    }
    expect(systemdRunCalls(home)).toEqual([]);
    for (const f of ['runtime.env', '.lock']) expect(fs.existsSync(join(laneDir(home, 'codex-a'), f)), f).toBe(false);
  }, 60_000);

  // Ruling PF-31: the phone's sign-in must not die on a dependency it never
  // uses. `login` never runs models-op.mjs, and the pane that reaches it runs
  // under the tmux server's own PATH, which need not carry node.
  it('L21b login with no node on PATH gets past the dependency probe (ruling PF-31)', async () => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const PATH = pathWithout(home, 'node');
    const r = codex(home, ['login', 'codex-a'], { PATH });
    // Past the probe: the lane library ran and reached the fake runtime,
    // whose default interpreter has no arm for the Authenticator program and
    // so exits 96 — never `missing-dependency`.
    expect(r.stderr).not.toMatch(/missing-dependency/);
    expect(r.stderr).toMatch(/^ccrc codex: login-failed: /m);
  }, 60_000);

  // Review fix round 1, findings spec-5/mut-5: the missing-dependency
  // SENTENCE, not just the probe, must be per-subcommand. Before this fix
  // the sentence was one hard-coded string ("'ccrc codex' needs both: jq …
  // and node runs …models-op.mjs …"), printed unconditionally, so a `login`
  // caller missing only jq (the one tool `login` ever checks, ruling PF-31)
  // was told it also needed node — the very dependency PF-31 exists to drop.
  it('L21c the missing-dependency sentence is built from what THIS subcommand checks, not a fixed "needs both"', async () => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const PATH = pathWithout(home, 'jq');
    const loginR = codex(home, ['login', 'codex-a'], { PATH });
    expect(loginR.code).toBe(1);
    expect(loginR.stderr).toMatch(/^ccrc codex: missing-dependency: jq is not on PATH, and 'ccrc codex login' needs jq, which reads the lane's roster row\.\s/m);
    expect(loginR.stderr).not.toContain('needs both');
    expect(loginR.stderr).not.toContain('node');
    expect(loginR.stderr).not.toContain('models-op.mjs');
    // start/stop/status are UNCHANGED: still "needs both", still name node.
    for (const sub of ['start', 'stop', 'status']) {
      const r = codex(home, [sub, 'codex-a'], { PATH });
      expect(r.code, sub).toBe(1);
      expect(r.stderr, sub).toContain("'ccrc codex' needs both: jq reads every lane's roster row and lane.json, and node runs");
      expect(r.stderr, sub).toContain('models-op.mjs');
    }
  }, 60_000);

  // Ruling R45: LiteLLM runs as `-m`, and both arms start a tier in $HOME
  // (Task 2), so without `-I` the interpreter puts $HOME first on sys.path and
  // a `~/litellm/` shadows the generation the runtime's own `-I` probe proved.
  // The fake runtime cannot show that, because its tier arm execs the stand-in
  // and resolves no module. So this asks the REAL python3, with the flags ccrc
  // actually passed, and swaps only the module name, for one that exists
  // nowhere but this HOME. The swap is deliberate: under `-I`, a python3 with a
  // real litellm installed would import it, and no case runs real litellm.
  it('L23 the LiteLLM tier runs isolated: the interpreter flags start passes keep $HOME, its working directory, off sys.path, so a ~/litellm/ cannot shadow the generation (ruling R45)', async () => {
    const { home, rt } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const r = codex(home, ['start', 'codex-a']);
    // What the fake runtime python was asked, one `$*` line per call. The
    // interpreter flags are every word before `-m`, and they precede every path.
    const callsFile = join(rt.gen, 'python-calls');
    const calls = fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf8').split('\n') : [];
    const line = calls.find((l) => ` ${l} `.includes(' -m litellm.proxy.proxy_cli '));
    expect(line, `start ran no LiteLLM: ${r.stderr}`).toBeDefined();
    const words = line!.split(' ');
    const flags = words.slice(0, words.indexOf('-m'));
    fs.writeFileSync(join(home, 'ccrc_cwd_shadow_probe.py'), 'print("SHADOW-LOADED")\n');
    const probe = (f: string[]) => spawnSync(PY!, [...f, '-B', '-m', 'ccrc_cwd_shadow_probe'], {
      cwd: home, env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home }, encoding: 'utf8',
    });
    // CONTROL: with no flags this interpreter DOES load the shadow from its
    // working directory, so a clean answer below is the flags' doing.
    expect(probe([]).stdout).toBe('SHADOW-LOADED\n');
    const iso = probe(flags);
    expect(iso.stdout, `the flags ${JSON.stringify(flags)} let a $HOME module shadow the generation's`).toBe('');
    expect(iso.stderr).toMatch(/No module named ccrc_cwd_shadow_probe/);
    // Asserted LAST, so a start without `-I` reds on the effect above, and not
    // only here: the fake runtime has no arm for a non-isolated `-m`, so that
    // start also ends `tier-not-ready`.
    expect(r.code, r.stderr).toBe(0);
    // This product stop is behavioral evidence; lifeBox registered the
    // current-run callback before this lane could start.
    expect(codex(home, ['stop', 'codex-a']).code).toBe(0);
  }, 60_000);

  // Ruling PF-15: "every refusal lands before anything is spawned" covers the
  // shim's own file. Without the pre-check, LiteLLM (the first tier) is
  // spawned and only the shim's start refuses, leaving a half-started lane.
  // Linux runs the unit arm here, so "no systemd-run call" means something;
  // the macOS arm is always nohup, where `litellm.pid` says the same thing.
  it('L24 a missing placed shim is shim-absent, with its remedy, before either tier is spawned (ruling PF-15)', async () => {
    const { home, lanes, shimFile } = await lifeBox({ userManager: !IS_DARWIN, ids: ['codex-a'] });
    fs.rmSync(shimFile);
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: shim-absent: /m);
    expect(r.stderr).toContain(shimFile);
    expect(r.stderr).toMatch(/'ccrc update' places it; re-run after\. Nothing was started\.$/m);
    expect(r.stderr).not.toMatch(/runtime-absent/);
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(r.stdout).toBe('');
    expect(systemdRunCalls(home)).toEqual([]);
    for (const t of ['litellm', 'shim']) expect(fs.existsSync(join(laneDir(home, 'codex-a'), `${t}.pid`)), t).toBe(false);
    expect(litellmEvidence(home, lanes['codex-a']!.litellmPort)).toBeNull();
  }, 60_000);

  // Ruling PF-17 (spec §7.4): a listener in ccrc's OWN shim shape that answers
  // as ANOTHER lane is `listener-answers-other-lane`, the dated incident of one
  // lane attaching to another's gateway, and its sentence says exactly that.
  it('L25 a ccrc-shaped shim answering as another lane on this lane\'s proxy port is port-foreign, named as another lane, and nothing starts (ruling PF-17)', async () => {
    const { home, lanes } = await lifeBox({ userManager: !IS_DARWIN, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const other = await spawnListener(home, { answer: 'json', lane: 'codex-b', port: a.proxyPort });
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`^ccrc codex: port-foreign: port ${a.proxyPort} \\(codex-a's shim tier\\) `
      + 'is held by a listener that is not this lane\'s: it answers as another lane\\. ', 'm'));
    expect(r.stderr).toMatch(/Nothing was started\.$/m);
    expect(r.stdout).toBe('');
    expect(systemdRunCalls(home)).toEqual([]);
    for (const t of ['litellm', 'shim']) expect(fs.existsSync(join(laneDir(home, 'codex-a'), `${t}.pid`)), t).toBe(false);
    // …and the other lane's shim still answers as itself.
    expect(JSON.parse((await laneAnswer(a.proxyPort))!.body)).toEqual({ lane: 'codex-b' });
    expect(psArgs(other.pid)).toContain('listener.py');
  }, 60_000);

  // Ruling PF-19: the readiness bound falls back to 90 exactly as
  // `_codex_probe_secs` falls back for its own: on a value that is empty, not
  // all digits, five characters or longer (`$(( ))` could wrap it), or zero
  // in ANY spelling — `00` included, because GNU `timeout 00` means no
  // timeout at all (the controller's measurement on the probe bound). Leading
  // zeros are decimal padding.
  it('L26 _codex_ready_secs reads CCRC_CODEX_READY_S in whole seconds, and falls back to 90 on every zero spelling and on an over-long value (ruling PF-19)', () => {
    const home = box('ccrc-codex-ready-');
    const rows: Array<[string | null, string]> = [
      [null, '90'], ['', '90'], ['20', '20'], ['007', '7'], ['0008', '8'], ['9999', '9999'],
      ['0', '90'], ['00', '90'], ['0000', '90'], ['2x', '90'], ['-5', '90'], [' 20', '90'],
      ['99999', '90'], ['00007', '90'], ['99999999999999999999', '90'],
    ];
    for (const [v, want] of rows) {
      const r = lib(home, 'printf "[%s]" "$(_codex_ready_secs)"; _codex_ready_secs >/dev/null; echo " rc=$?"',
        v === null ? {} : { CCRC_CODEX_READY_S: v });
      expect(r.stdout, `CCRC_CODEX_READY_S=${JSON.stringify(v)}`).toBe(`[${want}] rc=0\n`);
    }
  });

  // Ruling PF-21: every consumer of `_codex_stop_tier` CAPTURES its word and
  // never folds `foreign` into stopped. `start`'s rekey restart (ruling R21)
  // is one: if the tier it measured as this lane's reads `foreign` at the stop
  // (something outside ccrc changed it under the lock), it refuses by name,
  // and starts no LiteLLM over the tier it left running. The word is planted
  // by a stub of `_codex_stop_tier`, because no fixture can hand the stop a
  // tier that is ours at one measurement and foreign at the next.
  it('L27 a rekey restart whose stop answers foreign is tier-foreign, and starts nothing over the tier it left running (ruling PF-21)', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const d = laneDir(home, 'codex-a');
    const first = codex(home, ['start', 'codex-a']);
    expect(first.code, first.stderr).toBe(0);
    const lit = Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'));
    fs.rmSync(join(d, 'runtime.env'));   // `created` on the next start: a rekey
    const r = lib(home, '_codex_stop_tier() { printf \'foreign\\n\'; }; cmd_codex start codex-a',
      { CCRC_CODEX_READY_S: '3' });
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: tier-foreign: codex-a's litellm tier .*ccrc left it running.*Nothing was started\.$/m);
    expect(r.stdout).toBe('');
    // No LiteLLM was started over it: the pidfile, and the one that answers, are the first start's.
    expect(Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'))).toBe(lit);
    expect(litellmEvidence(home, a.litellmPort)!['pid']).toBe(lit);
    expect(alive(lit)).toBe(true);
    // The stub only simulates the failed rekey stop. End the real nohup tier
    // through the product before successful Darwin test completion.
    expect(codex(home, ['stop', 'codex-a']).code).toBe(0);
  }, 60_000);

  // CLASS FIX (review round 2, N0) — the re-reviewer's own probe, reproduced
  // here: a REAL stop (never stubbed, unlike L27 above) answers `stopped`
  // and genuinely frees the port, and a REAL foreign process binds it
  // immediately afterward, before this rekey's restart. Before this fix the
  // measured outcome was a NEW LiteLLM started onto that port anyway
  // (`litellm.started` written, a new pid), with the readiness wait's own
  // `tier-not-ready` the only signal — naming no holder. `_codex_stop_tier`
  // itself is left untouched (unlike L27's stub): only what runs AFTER it
  // returns is engineered, via the `declare -f` rename idiom this suite
  // already uses (ccd-ws-add-child.test.ts).
  it('L35 a rekey restart whose REAL stop frees the port, and a current-run foreign helper binds it before the restart, refuses port-foreign — the code _codex_foreign_what gives — names the holder, and starts nothing (review round 2, N0)', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const d = laneDir(home, 'codex-a');
    const first = codex(home, ['start', 'codex-a']);
    expect(first.code, first.stderr).toBe(0);
    const lit = Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'));
    fs.rmSync(join(d, 'runtime.env'));   // `created` on the next start: a rekey
    const trigger = join(home, 'foreign-trigger');
    const marker = join(home, 'foreign-bound');
    const foreignPy = join(home, 'foreign-holder.py');
    fs.writeFileSync(foreignPy, [
      'import os, socket, sys, time',
      'trigger, marker, port = sys.argv[1], sys.argv[2], int(sys.argv[3])',
      'while not os.path.exists(trigger): time.sleep(0.01)',
      's = socket.socket(socket.AF_INET, socket.SOCK_STREAM)',
      's.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)',
      "s.bind(('127.0.0.1', port))",
      's.listen(1)',
      'open(marker, "w").write(str(os.getpid()))',
      'time.sleep(20)',
    ].join('\n') + '\n');
    const helper = spawn(PY!, [foreignPy, trigger, marker, String(a.litellmPort)], {
      cwd: home, env: { ...process.env, HOME: home }, stdio: 'ignore',
    });
    trackChild(home, helper);
    const script = [
      // Real `_codex_stop_tier`, renamed aside; the wrapper calls it for
      // real, then releases the directly owned helper. The bind follows the
      // real stop return without converting a persisted PID into authority.
      "eval \"$(declare -f _codex_stop_tier | sed '1s/^_codex_stop_tier/_codex_stop_tier_real/')\"",
      '_codex_stop_tier() {',
      '  _codex_stop_tier_real "$@"; local rc=$?',
      `  : > ${shq(trigger)}`,
      `  for _i in $(seq 1 100); do [ -s ${shq(marker)} ] && break; sleep 0.05; done`,
      '  return "$rc"',
      '}',
      'cmd_codex start codex-a',
    ].join('\n');
    const r = lib(home, script, { CCRC_CODEX_READY_S: '3' });
    expect(fs.existsSync(marker), 'the foreign holder never bound the port').toBe(true);
    expect(r.code, r.stderr).toBe(1);
    // `_codex_foreign_what`'s own code for a raw socket with no lane
    // protocol is `port-foreign` (measured), not a fixed `tier-foreign` —
    // this step relays whatever it answers, never a hand-picked one.
    expect(r.stderr).toMatch(/^ccrc codex: port-foreign: /m);
    expect(r.stderr).toMatch(/is held by a listener that is not this lane's/m);
    expect(r.stderr).not.toMatch(/tier-not-ready/);
    expect(r.stderr).toMatch(/tier is now DOWN/m);
    expect(r.stderr).toContain('ccrc codex start codex-a');
    expect(r.stdout).toBe('');
    expect(fs.existsSync(join(d, 'litellm.pid')), 'a new litellm.pid was written over the foreign holder').toBe(false);
    expect(alive(lit)).toBe(false);   // the real stop really ended it
  }, 60_000);

  // The Task 10 residue C1: the rekey re-ask's `*)` arm — a re-ask, right
  // before the restart it owes, that cannot tell whether the port is free.
  // The stop is REAL and frees the port; only the answers AFTER it are
  // engineered (a flag file, because the stop runs in a `$( … )` subshell):
  // every later `_codex_tier_ours` then answers 3, as an unmeasurable
  // socket owner does.
  it('L36 a rekey restart whose re-ask right before the restart cannot be measured is tier-unmeasured, says the tier is DOWN, and starts nothing (Task 10 residue C1)', async () => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const d = laneDir(home, 'codex-a');
    const first = codex(home, ['start', 'codex-a']);
    expect(first.code, first.stderr).toBe(0);
    const lit = Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'));
    fs.rmSync(join(d, 'runtime.env'));   // `created` on the next start: a rekey
    const flag = join(home, 'rekey-stopped');
    const script = [
      "eval \"$(declare -f _codex_tier_ours | sed '1s/^_codex_tier_ours/_codex_tier_ours_real/')\"",
      `_codex_tier_ours() { [ -f ${shq(flag)} ] && return 3; _codex_tier_ours_real "$@"; }`,
      "eval \"$(declare -f _codex_stop_tier | sed '1s/^_codex_stop_tier/_codex_stop_tier_real/')\"",
      `_codex_stop_tier() { _codex_stop_tier_real "$@"; local rc=$?; : > ${shq(flag)}; return "$rc"; }`,
      'cmd_codex start codex-a',
    ].join('\n');
    const r = lib(home, script, { CCRC_CODEX_READY_S: '3' });
    expect(fs.existsSync(flag), 'the rekey never reached its stop').toBe(true);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: tier-unmeasured: whether codex-a's litellm tier's port is free right before the restart could not be measured \(the lane library answered 3\), so it was not started again for the new gateway key; codex-a's litellm tier is now DOWN\. Bring it back with: ccrc codex start codex-a\.$/m);
    expect(r.stderr).not.toMatch(/tier-not-ready/);
    expect(r.stdout).toBe('');
    expect(fs.existsSync(join(d, 'litellm.pid')), 'a litellm was started after an unmeasurable re-ask').toBe(false);
    expect(alive(lit)).toBe(false);   // the real stop really ended it
    // The shim survived the rekey's LiteLLM-only stop; end that nohup tier
    // through the product before a successful Darwin case returns.
    expect(codex(home, ['stop', 'codex-a']).code).toBe(0);
  }, 60_000);

  // Review A4 (D-3488: never signal what is not proven ours): the nohup
  // stop's SIGKILL follows a TERM wait of up to 10 s, and a pid reused
  // inside it would be a stranger. Every seam is stubbed — `kill` and
  // `sleep` included, so nothing is signalled and nothing waits — and the
  // pid named is this runner's own `sleep` child, in case a stub is lost.
  it('A4 the nohup stop re-proves the pid before its SIGKILL: a pid that no longer proves this lane\'s tier after the TERM wait is never killed (review A4)', async () => {
    const h = box('ccrc-codex-stop-reprove-');
    await twoLanes(h);
    const sleeper = spawn('sleep', ['600'], { stdio: 'ignore' });
    trackChild(h, sleeper);
    const pid = sleeper.pid!;
    const kills = join(h, 'kills');
    const run = (proven: 0 | 1): { r: Result; log: string[] } => {
      fs.rmSync(kills, { force: true });
      const r = lib(h, [
        // Not `n`: `_codex_stop_tier` has a `local n` of its own, which this
        // stub would read by bash's dynamic scope.
        'tier_calls=0',
        `_codex_tier_ours() { tier_calls=$((tier_calls + 1)); CX_TIER_WHY=''; if [ "$tier_calls" -eq 1 ]; then CX_TIER_VIA=nohup; CX_TIER_PID=${pid}; return 0; fi; CX_TIER_VIA=''; CX_TIER_PID=''; return 1; }`,
        `kill() { printf 'kill %s\\n' "$*" >> ${shq(kills)}; return 0; }`,
        'sleep() { :; }',
        `_codex_pid_is_tier() { printf 'reprove %s\\n' "$*" >> ${shq(kills)}; return ${proven}; }`,
        '_codex_stop_tier codex-a litellm',
      ].join('\n'));
      return { r, log: fs.existsSync(kills) ? fs.readFileSync(kills, 'utf8').split('\n').filter(Boolean) : [] };
    };
    const gone = run(1);
    expect(gone.r.stdout, gone.r.stderr).toBe('stopped\n');
    expect(gone.log[0]).toBe(`kill -TERM ${pid}`);
    expect(gone.log).toContain(`reprove codex-a litellm ${pid}`);
    expect(gone.log.filter((l) => l.startsWith('kill -KILL')), 'SIGKILL went to a pid that no longer proves the tier').toEqual([]);
    // CONTROL: the pid still proving the tier is killed, so the case can see a KILL.
    const still = run(0);
    expect(still.log).toContain(`kill -KILL ${pid}`);
    expect(sleeper.exitCode, 'a stub was lost and a real signal landed').toBeNull();
  }, 30_000);

  // Rulings R19 and R38, the lock's contract: held until `_codex_unlock`, the
  // ONLY release, which clears both variables; re-entrant AT ONCE for the lane
  // this shell, or a subshell of it, already holds (no second `flock`, which
  // would wait on this very process's lock); a call for another lane releases
  // the first; and rc 0 with nothing held where `flock` is missing. The
  // instrument for "held" is `flock -n` from another process. A 1 s readiness
  // bound makes a non-re-entrant subshell wait 31 s, past this runner's 15 s.
  it('L28 _codex_lock is held until _codex_unlock, re-entrant for its own lane in the shell and a subshell, releases the first lane for another, and holds nothing without flock (rulings R19, R38)', () => {
    const home = box('ccrc-codex-lock-');
    const held = (id: string): string =>
      `if flock -n ${shq(join(laneDir(home, id), '.lock'))} true; then echo "${id} free"; else echo "${id} held"; fi`;
    const r = lib(home, [
      '_codex_lock codex-a; echo "a rc=$? fd=${CX_LOCK_FD:+set} id=$CX_LOCK_ID"',
      held('codex-a'),
      'f1="$CX_LOCK_FD"; t0=$SECONDS',
      '_codex_lock codex-a; echo "again rc=$? same=$([ "$CX_LOCK_FD" = "$f1" ] && echo y)"',
      '( _codex_lock codex-a; echo "sub rc=$? id=$CX_LOCK_ID" )',
      'echo "at-once=$(( SECONDS - t0 < 5 ))"',
      held('codex-a'),
      '_codex_lock codex-b; echo "b rc=$? id=$CX_LOCK_ID"',
      held('codex-a'),
      held('codex-b'),
      '_codex_unlock; echo "unlock rc=$? fd=[$CX_LOCK_FD] id=[$CX_LOCK_ID]"',
      held('codex-b'),
      '_codex_unlock; echo "noop rc=$?"',
    ].join('\n'), { CCRC_CODEX_READY_S: '1' });
    expect(r.stdout, r.stderr).toBe([
      'a rc=0 fd=set id=codex-a', 'codex-a held',
      'again rc=0 same=y', 'sub rc=0 id=codex-a', 'at-once=1', 'codex-a held',
      'b rc=0 id=codex-b', 'codex-a free', 'codex-b held',
      'unlock rc=0 fd=[] id=[]', 'codex-b free', 'noop rc=0', '',
    ].join('\n'));
    expect(r.stderr).toBe('');
    // No flock on PATH: rc 0, nothing held, nothing opened.
    const bare = box('ccrc-codex-lock-noflock-');
    const n = lib(bare, '_codex_lock codex-a; echo "rc=$? fd=[${CX_LOCK_FD:-}]"',
      { PATH: pathWithout(bare, 'flock') });
    expect(n.stdout, n.stderr).toBe('rc=0 fd=[]\n');
    expect(fs.existsSync(join(laneDir(bare, 'codex-a'), '.lock'))).toBe(false);
  }, 60_000);

  // Review F1, end to end: the LiteLLM this start spawned is alive and this
  // lane's by its command line but has not bound (the stand-in told to wait
  // 600 s: a real one imports for 8-10 s), and ANOTHER process takes its port
  // once the start has classified both tiers. The start must never adopt that
  // port: not `litellm started`, not exit 0. A second start names the holder,
  // and a stop stops this lane's own process and leaves the holder running.
  // PLATFORM-ONLY (the ruling): the ownership read is /proc here.
  it.skipIf(IS_DARWIN)('L29 a LiteLLM this start spawned that has not bound, while another process takes its port, is never adopted: start ends tier-not-ready, a second start names the holder, and stop stops this lane\'s process and leaves the holder running (review F1)', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const d = laneDir(home, 'codex-a');
    slowLitellmListen(home, 600);
    const start = codexAsync(home, ['start', 'codex-a'], { CCRC_CODEX_READY_S: '6' });
    // The stand-in records itself before it waits: the start has classified
    // both tiers and spawned this one.
    await eventually(() => litellmEvidence(home, a.litellmPort) !== null, 'the spawned LiteLLM to record itself', 20_000);
    const mine = litellmEvidence(home, a.litellmPort)!['pid'] as number;
    const holder = await spawnListener(home, { answer: '404', port: a.litellmPort });
    const r = await start;
    expect(r.code, r.stdout).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ccrc codex: tier-not-ready: codex-a's litellm tier did not answer as this lane within 6s/m);
    expect(alive(mine)).toBe(true);
    expect(Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'))).toBe(mine);
    const again = codex(home, ['start', 'codex-a']);
    expect(again.code).toBe(1);
    expect(again.stderr).toMatch(new RegExp(`^ccrc codex: port-foreign: port ${a.litellmPort} \\(codex-a's litellm tier\\) `
      + `is held by a process that is not this lane's LiteLLM: pid ${mine} is this lane's by its command line`, 'm'));
    const s = codex(home, ['stop', 'codex-a']);
    expect(s.code, s.stderr).toBe(0);
    expect(s.stdout).toBe('ccrc codex: codex-a: litellm stopped, shim stopped\n');
    expect(s.stderr).toMatch(new RegExp(`port ${a.litellmPort} \\(codex-a's litellm tier\\) is held by a listener that is not this lane's.*ccrc left it running\\.$`, 'm'));
    await eventually(() => !alive(mine), 'this lane\'s LiteLLM to exit');
    expect(await portAccepts(a.litellmPort)).toBe(true);
    expect(psArgs(holder.pid)).toContain('listener.py');
  }, 120_000);

  // Review F2: the PF-15 pre-check's per-tier loop is reachable. lane.json's
  // state reads `current` for ANY non-empty unit string, while `_codex_unit`
  // takes only a `.service` name that cannot be read as a flag (Task 4's
  // "a unit name lane.json spells like a flag" case), so this lane.json passes
  // the ensure and names no usable shim unit.
  it('L31 a lane.json whose shim unit is no usable unit name reads current, and start refuses lane-unwritable in its pre-check, before either tier is spawned (review F2)', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const f = join(laneDir(home, 'codex-a'), 'lane.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { units: Record<string, string> };
    fs.writeFileSync(f, JSON.stringify({ ...j, units: { ...j.units, shim: '--all.service' } }));
    expect(lib(home, '_codex_lane_json_state codex-a').stdout).toBe('current\n');
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: lane-unwritable: .*lane\.json names no usable shim unit, .*Nothing was started\.$/m);
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(r.stdout).toBe('');
    expect(systemdRunCalls(home)).toEqual([]);
    for (const t of ['litellm', 'shim']) expect(fs.existsSync(join(laneDir(home, 'codex-a'), `${t}.pid`)), t).toBe(false);
    expect(litellmEvidence(home, lanes['codex-a']!.litellmPort)).toBeNull();
  }, 60_000);

  // Review F2: a stamp that exists but cannot be read passes the verb's own
  // runtime check (`ccgpt-runtime python` asks only that it exists) and fails
  // `_codex_started_json`, so the pre-check's own sentence answers. Root reads
  // a 0000 file, so the case cannot be staged there.
  it.skipIf(process.getuid?.() === 0)('L32 a runtime stamp that cannot be read is the pre-check\'s runtime-absent, with its own sentence, before either tier is spawned (review F2)', async () => {
    const { home, lanes, rt } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    fs.chmodSync(rt.stamp, 0o000);
    const r = codex(home, ['start', 'codex-a']);
    fs.chmodSync(rt.stamp, 0o644);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: runtime-absent: what codex-a's litellm tier would run cannot be recorded: .*Nothing was started\.$/m);
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(r.stdout).toBe('');
    expect(systemdRunCalls(home)).toEqual([]);
    for (const t of ['litellm', 'shim']) expect(fs.existsSync(join(laneDir(home, 'codex-a'), `${t}.pid`)), t).toBe(false);
    expect(litellmEvidence(home, lanes['codex-a']!.litellmPort)).toBeNull();
  }, 60_000);

  // Review F1: a 3 in the readiness wait is an answer `_codex_tier_ours` has
  // already printed (here, ownership it cannot measure: a stub), and waiting
  // cannot change it. The start ends at once, with that one line.
  it('L33 a readiness probe that cannot measure LiteLLM\'s ownership of its port ends the start at once, with its one line (review F1)', async () => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const t0 = Date.now();
    const r = lib(home, "_codex_pid_listens() { CX_LISTEN_WHY='a stub that cannot ask'; return 3; }\ncmd_codex start codex-a",
      { CCRC_CODEX_READY_S: '8' });
    const took = Date.now() - t0;
    expect(r.code, r.stderr).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr.trimEnd().split('\n')).toEqual([expect.stringMatching(
      /^ccrc codex: tier-unmeasured: codex-a's litellm tier: .*\(a stub that cannot ask\)/)]);
    expect(took).toBeLessThan(8000);
    // The stub's unmeasurable readiness answer left both product-started nohup
    // tiers live. Stop them while this Darwin-reachable case still owns them.
    expect(codex(home, ['stop', 'codex-a']).code).toBe(0);
  }, 60_000);

  // Review S1: the one `foreign` that carries a handle. This lane's LiteLLM is
  // running by its command line (bound elsewhere: a kernel-chosen port) while
  // another process holds litellmPort. Status must not say ccrc "will neither
  // adopt nor stop it": `stop` stops this lane's process there (L29) and
  // leaves the holder running, and the JSON keeps the handle.
  it.skipIf(IS_DARWIN)('L34 status names this lane\'s LiteLLM process running on a port another process holds, says what stop does, and keeps its via and pid in --json (review S1)', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const mine = await spawnListener(home, { answer: '404', argv: ['--config', litellmYaml(home, 'codex-a')] });
    fs.writeFileSync(join(laneDir(home, 'codex-a'), 'litellm.pid'), `${mine.pid}\n`);
    await spawnListener(home, { answer: '404', port: a.litellmPort });
    const h = codex(home, ['status', 'codex-a']);
    expect(h.code, h.stderr).toBe(0);
    expect(h.stdout.split('\n').slice(0, 2)).toEqual([
      `ccrc codex: codex-a: litellm FOREIGN — this lane's litellm process is running (nohup, pid ${mine.pid}) `
        + `but does not hold port ${a.litellmPort}: another process does. 'ccrc codex stop codex-a' stops this lane's `
        + 'process and leaves the other running',
      'ccrc codex: codex-a: shim stopped',
    ]);
    expect(h.stdout).not.toMatch(/neither adopt nor stop/);
    const j = codex(home, ['status', 'codex-a', '--json']);
    expect(j.code, j.stderr).toBe(0);
    expect((JSON.parse(j.stdout) as { tiers: Record<string, unknown> }).tiers).toEqual({
      litellm: { state: 'foreign', via: 'nohup', pid: mine.pid },
      shim: { state: 'stopped', via: null, pid: null },
    });
  }, 60_000);

  // ── the unit arm: a Linux box whose user manager answers ───────────────────
  // PLATFORM-ONLY: `_svc_have_user_manager` answers 1 on darwin unconditionally
  // (D-3483), so a macOS box has no unit arm to contrast with. The
  // arms these cases pin have no darwin counterpart, and L5–L9, L16, L20, L21
  // and L23 above run the nohup arm on both platforms, as L24–L28 run on both.
  describeLinux('with a user manager, each tier is one transient unit', () => {
    it('L10 two lanes start, run and stop independently; stopping one leaves the other up', async () => {
      const { home, lanes } = await lifeBox({ userManager: true });
      const a = lanes['codex-a']!;
      const b = lanes['codex-b']!;
      const sa = codex(home, ['start', 'codex-a']);
      expect(sa.code, sa.stderr).toBe(0);
      expect(sa.stdout).toBe('ccrc codex: codex-a: litellm started (systemd ccgpt-codex-a-litellm.service), '
        + 'shim started (systemd ccgpt-codex-a-shim.service)\n');
      const sb = codex(home, ['start', 'codex-b']);
      expect(sb.code, sb.stderr).toBe(0);
      // Each lane answers AS ITSELF on its own port: the REAL shim, started
      // with its --ccrc-lane marker (ruling R6), under its own unit.
      for (const [id, l] of [['codex-a', a], ['codex-b', b]] as const) {
        const ans = await laneAnswer(l.proxyPort);
        expect(ans?.status).toBe(200);
        expect(ans?.type).toMatch(/^application\/json/);
        expect(JSON.parse(ans!.body)).toEqual({ lane: id });
        expect(await portAccepts(l.litellmPort)).toBe(true);
      }
      const st = codex(home, ['stop', 'codex-a']);
      expect(st.code, st.stderr).toBe(0);
      expect(st.stdout).toBe('ccrc codex: codex-a: litellm stopped, shim stopped\n');
      // BY EXACT UNIT NAME — each proven by its MainPID first — the front tier
      // first, and nothing of codex-b's.
      expect(stopCalls(home)).toEqual([
        '--user stop ccgpt-codex-a-shim.service', '--user stop ccgpt-codex-a-litellm.service',
      ]);
      expect(await laneAnswer(a.proxyPort)).toBeNull();
      expect(await portAccepts(a.litellmPort)).toBe(false);
      expect(JSON.parse((await laneAnswer(b.proxyPort))!.body)).toEqual({ lane: 'codex-b' });
      expect(await portAccepts(b.litellmPort)).toBe(true);
      for (const f of ['litellm.started', 'shim.started', 'litellm.pid', 'shim.pid']) {
        expect(fs.existsSync(join(laneDir(home, 'codex-a'), f)), f).toBe(false);
      }
      expect(fs.existsSync(join(laneDir(home, 'codex-b'), 'shim.started'))).toBe(true);
      expect(codex(home, ['stop', 'codex-b']).code).toBe(0);
      expect(await laneAnswer(b.proxyPort)).toBeNull();
    }, 120_000);

    it('L11 the unit argv: app.slice, Restart=always, RestartSec=3, the log paths, runtime.env for litellm only, an isolated LiteLLM, the shim\'s lane marker, and no key', async () => {
      const { home, lanes, rt, shimFile } = await lifeBox({ userManager: true, ids: ['codex-a'] });
      const a = lanes['codex-a']!;
      expect(codex(home, ['start', 'codex-a']).code).toBe(0);
      const runs = systemdRunArgv(home);
      expect(runs).toHaveLength(2);
      const [lit, shim] = runs as [string[], string[]];
      const py = join(rt.gen, 'bin', 'python');
      const d = laneDir(home, 'codex-a');
      const logs = logDir(home, 'codex-a');
      const head = (unit: string): string[] =>
        ['--user', '--collect', '--quiet', `--unit=${unit}`, '--slice=app.slice', `--working-directory=${home}`];
      const props = (argv: string[]): string[] => argv.flatMap((x, i) => (x === '-p' ? [argv[i + 1]!] : []));
      const setenv = (argv: string[]): string[] =>
        argv.filter((x) => x.startsWith('--setenv=')).map((x) => x.slice('--setenv='.length));
      const after = (argv: string[]): string[] => argv.slice(argv.indexOf('--') + 1);

      expect(lit.slice(0, 6)).toEqual(head('ccgpt-codex-a-litellm.service'));
      expect(props(lit)).toEqual(expect.arrayContaining(['Restart=always', 'RestartSec=3',
        `StandardOutput=append:${logs}/litellm.log`, `StandardError=append:${logs}/litellm.log`,
        `EnvironmentFile=${d}/runtime.env`]));
      // Ruling R1: CHATGPT_TOKEN_DIR's last `_`-segment is DIR, so the helper
      // passes it. This is the cross-task pin on Task 2's name rule.
      expect(setenv(lit).sort()).toEqual(
        [`CHATGPT_TOKEN_DIR=${join(home, a.authDir)}`, `HOME=${home}`, 'LITELLM_LOCAL_MODEL_COST_MAP=True'].sort());
      // Ruling R45: `-I`, so the working directory ($HOME) is not on sys.path.
      // L23 measures what that buys, with the real interpreter.
      expect(after(lit)).toEqual([py, '-I', '-m', 'litellm.proxy.proxy_cli', '--config', litellmYaml(home, 'codex-a'),
        '--host', '127.0.0.1', '--port', String(a.litellmPort)]);

      expect(shim.slice(0, 6)).toEqual(head('ccgpt-codex-a-shim.service'));
      expect(props(shim)).toEqual(expect.arrayContaining(['Restart=always', 'RestartSec=3',
        `StandardOutput=append:${logs}/shim.log`, `StandardError=append:${logs}/shim.log`]));
      expect(props(shim).filter((p) => p.startsWith('EnvironmentFile=')), 'the shim is value-blind').toEqual([]);
      expect(setenv(shim).sort()).toEqual(['CCGPT_ACCOUNT_ID=codex-a', `CCGPT_LITELLM_PORT=${a.litellmPort}`,
        `CCGPT_PROXY_PORT=${a.proxyPort}`, `HOME=${home}`].sort());
      // Ruling R6: the shim file, then the lane marker, as two words — exactly
      // what Task 4's `_codex_pid_is_tier` proves a pid by.
      expect(after(shim)).toEqual([py, '-I', shimFile, '--ccrc-lane=codex-a']);
      // The RESOLVED generation, never through `current` (D-3480), asked of
      // the interpreter ccrc's own argv names (ruling PF-16), not of `py`.
      for (const argv of [lit, shim]) expect(after(argv)[0]!.split(path.sep)).not.toContain('current');

      // THE KEY: in runtime.env at 0600, and nowhere in any argv or recorded call…
      // This census IS spec §5.4's no-secret pin (D-3491, ruling R46).
      // The spec says to assert over `systemctl show` output in a fixture, but a
      // planted `show` answer would be a control derived from the measurement.
      const envText = fs.readFileSync(join(d, 'runtime.env'), 'utf8');
      expect(envText).toMatch(/^LITELLM_MASTER_KEY=sk-[0-9a-f]{48}\n$/);
      expect(fs.statSync(join(d, 'runtime.env')).mode & 0o777).toBe(0o600);
      const k = envText.trim().slice('LITELLM_MASTER_KEY='.length);
      const carriers = [...runs.flat(), ...systemctlCalls(home), ...systemdRunCalls(home),
        ...fs.readFileSync(join(rt.gen, 'python-calls'), 'utf8').split('\n')].filter((s) => s.includes(k)).length;
      expect(carriers, 'an argv element or a recorded call carries the gateway key').toBe(0);
      // No pair is secret-shaped by ruling R1's rule: a NAME whose last
      // `_`-segment ends with KEY, TOKEN, SECRET, PASSWORD or PASSWD.
      expect([...setenv(lit), ...setenv(shim)].map((s) => s.split('=')[0]!)
        .filter((n) => /(KEY|TOKEN|SECRET|PASSWORD|PASSWD)$/i.test(n.split('_').pop()!))).toEqual([]);
      // …and it still REACHED the litellm process, through the file alone.
      const ev = litellmEvidence(home, a.litellmPort)!;
      expect(ev['masterKeyShaped']).toBe(true);
      expect(ev['tokenDir']).toBe(join(home, a.authDir));
      expect(ev['costMapLocal']).toBe('True');
      expect(ev['home']).toBe(home);
      expect(fs.readFileSync(join(logs, 'litellm.log'), 'utf8')).toMatch(/fixture litellm: listening on/);
      // The record is Task 4's `_codex_started_json` output, nothing else, so
      // Task 4's `_codex_tier_stale` reads a fresh start as current (1) for both.
      expect(JSON.parse(fs.readFileSync(join(d, 'litellm.started'), 'utf8')))
        .toEqual({ generation: rt.gen, code: sha256(rt.stamp) });
      expect(JSON.parse(fs.readFileSync(join(d, 'shim.started'), 'utf8')))
        .toEqual({ generation: rt.gen, code: sha256(shimFile) });
      expect(lib(home, '_codex_tier_stale codex-a litellm; a=$?; _codex_tier_stale codex-a shim; echo "$a $?"').stdout)
        .toBe('1 1\n');
    }, 120_000);

    it('L12 start is idempotent: a second start adopts both tiers and spawns nothing', async () => {
      const { home, rt } = await lifeBox({ userManager: true, ids: ['codex-a'] });
      expect(codex(home, ['start', 'codex-a']).code).toBe(0);
      const lit = unitPid(home, 'ccgpt-codex-a-litellm.service');
      const shim = unitPid(home, 'ccgpt-codex-a-shim.service');
      const again = codex(home, ['start', 'codex-a']);
      expect(again.code, again.stderr).toBe(0);
      expect(again.stdout).toBe('ccrc codex: codex-a: litellm adopted (systemd ccgpt-codex-a-litellm.service), '
        + 'shim adopted (systemd ccgpt-codex-a-shim.service)\n');
      expect(systemdRunArgv(home)).toHaveLength(2);
      expect([unitPid(home, 'ccgpt-codex-a-litellm.service'), unitPid(home, 'ccgpt-codex-a-shim.service')]).toEqual([lit, shim]);
      const st = codex(home, ['status', 'codex-a', '--json']);
      expect(st.code).toBe(0);
      expect(JSON.parse(st.stdout)).toEqual({
        id: 'codex-a',
        tiers: { litellm: { state: 'running', via: 'systemd', pid: lit }, shim: { state: 'running', via: 'systemd', pid: shim } },
        runtime: { generation: path.basename(rt.gen) },
        lane: { json: 'current' },
      });
    }, 120_000);

    // Ruling PF-13: a unit of this name that is live with no process proving
    // this lane is UNPROVEN, and never claimed as another tool's. Two shapes:
    // a live stranger as MainPID, and MainPID 0, which is also this lane's own
    // tier crash-looping inside its RestartSec window. The sentence says the
    // identity is unproven and suggests retrying.
    it.each([['a live stranger', true], ['MainPID 0, as in a restart window', false]] as const)(
      'L13 an active unit of this name whose MainPID is not this lane\'s tier (%s) is unit-foreign, its identity named unproven, and left running', async (_what, stranger) => {
        const { home } = await lifeBox({ userManager: true, ids: ['codex-a'] });
        // A live process on a kernel-chosen port whose command line proves no lane.
        const other = stranger ? await spawnListener(home, { answer: '404' }) : null;
        fakeUnit(home, 'ccgpt-codex-a-litellm.service', { state: 'active', pid: other?.pid ?? 0 });
        const r = codex(home, ['start', 'codex-a']);
        expect(r.code).toBe(1);
        expect(r.stderr).toMatch(/^ccrc codex: unit-foreign: the unit ccgpt-codex-a-litellm\.service is active, but its identity as codex-a's litellm tier is unproven/m);
        expect(r.stderr).toMatch(/Re-run in a few seconds/);
        expect(r.stderr).not.toMatch(/another tool/);
        expect(systemdRunCalls(home)).toEqual([]);
        if (other !== null) expect(await portAccepts(other.port)).toBe(true);
      }, 60_000);

    it('L14 a unit the manager will not stop is stop-failed, and the other tier is still stopped', async () => {
      const { home, lanes } = await lifeBox({ userManager: true, ids: ['codex-a'] });
      const a = lanes['codex-a']!;
      expect(codex(home, ['start', 'codex-a']).code).toBe(0);
      failUnitStop(home, 'ccgpt-codex-a-shim.service', true);
      const s = codex(home, ['stop', 'codex-a']);
      expect(s.code).toBe(1);
      expect(s.stdout).toBe('');
      expect(s.stderr).toMatch(/^ccrc codex: stop-failed: codex-a's shim tier is still running/m);
      expect(await portAccepts(a.litellmPort)).toBe(false);
      expect(JSON.parse((await laneAnswer(a.proxyPort))!.body)).toEqual({ lane: 'codex-a' });
      failUnitStop(home, 'ccgpt-codex-a-shim.service', false);
      expect(codex(home, ['stop', 'codex-a']).code).toBe(0);
      expect(await laneAnswer(a.proxyPort)).toBeNull();
    }, 120_000);

    it('L15 two starts at once serialise on the lane lock: one starts, the other adopts, and neither is refused (ruling R11)', async () => {
      const { home } = await lifeBox({ userManager: true, ids: ['codex-a'] });
      const [r1, r2] = await Promise.all([codexAsync(home, ['start', 'codex-a']), codexAsync(home, ['start', 'codex-a'])]);
      expect([r1.code, r2.code], `${r1.stderr}\n${r2.stderr}`).toEqual([0, 0]);
      expect([r1.stdout, r2.stdout].sort()).toEqual([
        'ccrc codex: codex-a: litellm adopted (systemd ccgpt-codex-a-litellm.service), shim adopted (systemd ccgpt-codex-a-shim.service)\n',
        'ccrc codex: codex-a: litellm started (systemd ccgpt-codex-a-litellm.service), shim started (systemd ccgpt-codex-a-shim.service)\n',
      ]);
      expect(systemdRunArgv(home)).toHaveLength(2);
    }, 120_000);

    it('L17 a same-named unit that is not this lane\'s is never stopped: stop leaves it running and names it, and start refuses it (ruling R8, D-3488)', async () => {
      const { home, lanes } = await lifeBox({ userManager: true, ids: ['codex-a'] });
      const a = lanes['codex-a']!;
      // The fleet box's shape (m-livebox §3): the OTHER repository runs this
      // lane's tiers under the SAME unit names — its shim answering text/plain
      // with the same id, its LiteLLM reading the box-global config.
      const shim = await spawnListener(home, { answer: 'text', lane: 'codex-a', port: a.proxyPort });
      const lit = await spawnListener(home, {
        answer: '404', port: a.litellmPort, argv: ['--config', join(home, '.handoff', 'litellm-config.yaml')],
      });
      fakeUnit(home, 'ccgpt-codex-a-shim.service', { state: 'active', pid: shim.pid });
      fakeUnit(home, 'ccgpt-codex-a-litellm.service', { state: 'active', pid: lit.pid });
      const s = codex(home, ['stop', 'codex-a']);
      expect(s.code, s.stderr).toBe(0);
      expect(s.stdout).toBe('ccrc codex: codex-a: litellm foreign, shim foreign\n');
      for (const t of ['shim', 'litellm']) {
        expect(s.stderr).toMatch(new RegExp(`the unit ccgpt-codex-a-${t}\\.service is active but is not codex-a's ${t} tier.*ccrc left it running\\.$`, 'm'));
      }
      // No stop reached the manager, and both of the other repository's tiers still answer.
      expect(stopCalls(home)).toEqual([]);
      expect(await portAccepts(a.proxyPort)).toBe(true);
      expect(await portAccepts(a.litellmPort)).toBe(true);
      expect(psArgs(shim.pid)).toContain('listener.py');
      expect(psArgs(lit.pid)).toContain('listener.py');
      // And start will not attach this lane to them.
      const r = codex(home, ['start', 'codex-a']);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/^ccrc codex: unit-foreign: the unit ccgpt-codex-a-litellm\.service is active but is not codex-a's litellm tier/m);
      expect(systemdRunCalls(home)).toEqual([]);
      expect(await portAccepts(a.litellmPort)).toBe(true);
    }, 60_000);

    it('L18 ccrc codex stop during a start waits on the lane lock: the start finishes, then both tiers stop (ruling R11)', async () => {
      const { home, lanes } = await lifeBox({ userManager: true, ids: ['codex-a'] });
      const a = lanes['codex-a']!;
      // A LiteLLM that takes 4 s to bind: the start holds the lock through it.
      slowLitellmListen(home, 4);
      const start = codexAsync(home, ['start', 'codex-a']);
      // Once a unit is spawned, the start holds the lock and is waiting on readiness.
      await eventually(() => systemdRunArgv(home).length >= 1, 'the start to spawn its first unit', 20_000);
      const s = codex(home, ['stop', 'codex-a']);
      const r = await start;
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/^ccrc codex: codex-a: litellm started \(systemd /);
      expect(s.code, s.stderr).toBe(0);
      expect(s.stdout).toBe('ccrc codex: codex-a: litellm stopped, shim stopped\n');
      expect(await portAccepts(a.litellmPort)).toBe(false);
      expect(await laneAnswer(a.proxyPort)).toBeNull();
    }, 120_000);

    // Review F1 on the unit arm: this lane's OWN unit, MainPID proven, whose
    // process has not bound while another process holds the port. That is
    // port-foreign, never unit-foreign (the unit IS this lane's), and a stop
    // the manager refuses is stop-failed, never `foreign`: rc 0 would promise
    // no tier of this lane runs while this lane's unit still does.
    it('L30 this lane\'s LiteLLM unit whose process does not hold its port is port-foreign, never unit-foreign, and a stop that cannot end it is stop-failed, never foreign (review F1)', async () => {
      const { home, lanes } = await lifeBox({ userManager: true, ids: ['codex-a'] });
      const a = lanes['codex-a']!;
      const unit = 'ccgpt-codex-a-litellm.service';
      slowLitellmListen(home, 600);
      const start = codexAsync(home, ['start', 'codex-a'], { CCRC_CODEX_READY_S: '6' });
      await eventually(() => litellmEvidence(home, a.litellmPort) !== null, 'the unit\'s LiteLLM to record itself', 20_000);
      const mine = litellmEvidence(home, a.litellmPort)!['pid'] as number;
      expect(unitPid(home, unit)).toBe(mine);
      await spawnListener(home, { answer: '404', port: a.litellmPort });
      const r = await start;
      expect(r.code, r.stdout).toBe(1);
      expect(r.stdout).toBe('');
      const again = codex(home, ['start', 'codex-a']);
      expect(again.code).toBe(1);
      expect(again.stderr).toMatch(new RegExp(`^ccrc codex: port-foreign: port ${a.litellmPort} \\(codex-a's litellm tier\\) `
        + `is held by a process that is not this lane's LiteLLM: pid ${mine} is this lane's by its command line`, 'm'));
      expect(again.stderr).not.toMatch(/unit-foreign/);
      failUnitStop(home, unit, true);
      const s = codex(home, ['stop', 'codex-a']);
      expect(s.code).toBe(1);
      expect(s.stdout).toBe('');
      expect(s.stderr).toMatch(new RegExp(`^ccrc codex: stop-failed: codex-a's litellm tier is still running after the stop \\(systemd, pid ${mine}\\)`, 'm'));
      expect(alive(mine)).toBe(true);
      failUnitStop(home, unit, false);
      const s2 = codex(home, ['stop', 'codex-a']);
      expect(s2.code, s2.stderr).toBe(0);
      expect(s2.stdout).toBe('ccrc codex: codex-a: litellm stopped, shim not running\n');
      await eventually(() => !alive(mine), 'this lane\'s LiteLLM unit process to exit');
      expect(await portAccepts(a.litellmPort)).toBe(true);
    }, 120_000);

    it('L22 on the unit arm a start deletes a stale pidfile, which nothing else there would remove, and never signals its pid (ruling R34)', async () => {
      const { home, lanes } = await lifeBox({ userManager: true, ids: ['codex-a'] });
      const a = lanes['codex-a']!;
      const d = laneDir(home, 'codex-a');
      // A live process this lane's own pidfiles name, proving no lane: pid reuse
      // after the box ran the nohup arm, or a hand edit. No unit of this lane's
      // is active yet, so `_codex_tier_ours` reads the files, and reads past them.
      const stranger = spawn('sleep', ['600'], { stdio: 'ignore' });
      trackChild(home, stranger);
      for (const t of ['litellm', 'shim']) fs.writeFileSync(join(d, `${t}.pid`), `${stranger.pid}\n`);
      const r = codex(home, ['start', 'codex-a']);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe('ccrc codex: codex-a: litellm started (systemd ccgpt-codex-a-litellm.service), '
        + 'shim started (systemd ccgpt-codex-a-shim.service)\n');
      for (const t of ['litellm', 'shim']) expect(fs.existsSync(join(d, `${t}.pid`)), `${t}.pid`).toBe(false);
      // Unsignalled: a killed child of this process would read `[sleep] <defunct>`.
      expect(psArgs(stranger.pid!)).toMatch(/^sleep 600/);
      expect(JSON.parse((await laneAnswer(a.proxyPort))!.body)).toEqual({ lane: 'codex-a' });
      expect(await portAccepts(a.litellmPort)).toBe(true);
    }, 120_000);
  });
});

// `ccrc codex login <id>` (Plan 2b-2 Task 8, spec §9.3). The runtime here is a
// FIXTURE generation, planted by the fixture's one runtime planter (ruling
// R28), whose `bin/python` runs the REAL interpreter on the REAL `-c` program
// ccrc passes, with a stub `litellm.llms.chatgpt.authenticator` first on
// sys.path — so the program's import, its call and the environment it sees are
// all measured, and no network or real litellm is involved.
describe.skipIf(!pythonOrSkip())('ccrc codex login — the lane\'s own runtime signs it in', () => {
  const PY = pythonOrSkip() ?? '';
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const RUNTIME_SRC = join(ROOT, 'ccd', 'ccgpt-runtime');
  // A generation name carries an `XXXX-XXXX`-shaped run (`…000Z-4242`), which is
  // exactly what `ccd-account-auth` publishes as a device code — case A1 uses it.
  // It is the builder's `gen-<YYYYmmddTHHMMSSZ>-<pid>` shape, which
  // `plantFakeRuntime`'s `generationName` requires.
  const GEN = 'gen-20260923T000000Z-4242';
  const TOKEN = 'test-token-not-a-secret';
  // The lane's authDir, relative to HOME, as the ROSTER names it: `codexRoster`
  // writes exactly `codexAuthDir(id)`, so this is the roster's value, not an
  // assumption about it.
  const AUTH_REL = codexAuthDir('codex-a');
  type LoginMode = 'writes' | 'writes-nothing' | 'stamps-then-raises';

  const shq = (s: string): string => {
    expect(s, 'a fixture path carries a single quote').not.toContain("'");
    return `'${s}'`;
  };
  const firstCode = (s: string): string | undefined => /[A-Z0-9]{4}-[A-Z0-9]{4}/.exec(s)?.[0];
  const recPath = (home: string, name: string): string => join(home, 'login-rec', name);
  const rec = (home: string, name: string): string => readFileSync(recPath(home, name), 'utf8');
  const ranRuntime = (home: string): boolean => existsSync(recPath(home, 'argv0'));

  /** A deployed-shaped box: ccrc under <home>/ccrc/ccd (so `$CCRC_HERE/../deploy`
   *  resolves for `models init`), `deploy`/`shared` linked whole, and the REAL
   *  `ccgpt-runtime` on both paths a caller might name it by (the placed one
   *  and ccrc's sibling), with `codexRoster`'s `codex-a` lane. */
  const loginBox = async (): Promise<string> => {
    const home = mkTmp('ccrc-codex-login-');
    const ccd = join(home, 'ccrc', 'ccd');
    mkdirSync(ccd, { recursive: true });
    for (const f of ['ccrc', 'ccrc-wrapper-shape', 'ccrc-doctor-checks', 'ccgpt-runtime']) {
      symlinkSync(join(ROOT, 'ccd', f), join(ccd, f));
    }
    symlinkSync(join(ROOT, 'deploy'), join(home, 'ccrc', 'deploy'));
    symlinkSync(join(ROOT, 'shared'), join(home, 'ccrc', 'shared'));
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    symlinkSync(RUNTIME_SRC, join(home, '.local', 'bin', 'ccgpt-runtime'));
    const [proxyPort, litellmPort] = await freePorts(2);
    codexRoster(home, [{ id: 'codex-a', proxyPort: proxyPort!, litellmPort: litellmPort! }]);
    mkdirSync(join(home, 'login-rec'), { recursive: true });
    return home;
  };

  /** The OPTIONS `plantFakeRuntime` plants the login runtime from (ruling R28):
   *  `generationName: GEN` and an interpreter body. The generation, `current`
   *  and the stamp are the fixture's, in the builder's own bytes, so the real
   *  `ccgpt-runtime python` finds this runtime and the real `check` accepts it.
   *  This function writes only what is not a runtime: the stub authenticator
   *  package, OUTSIDE the runtime tree at `<home>/login-stub`, in `mode`.
   *  Every call site is `plantFakeRuntime(home, loginRuntime(home, mode))`. */
  const loginRuntime = (home: string, mode: LoginMode): FakeRuntimeOptions => {
    const recDir = join(home, 'login-rec');
    const stub = join(home, 'login-stub');
    const pkg = join(stub, 'litellm', 'llms', 'chatgpt');
    mkdirSync(pkg, { recursive: true });
    // Import time is when real litellm reads the cost-map switch, so it is
    // recorded at import time here.
    writeFileSync(join(stub, 'litellm', '__init__.py'), [
      'import json, os',
      `with open(os.path.join(${JSON.stringify(recDir)}, "import-env.json"), "w") as f:`,
      '    json.dump({"LITELLM_LOCAL_MODEL_COST_MAP": os.environ.get("LITELLM_LOCAL_MODEL_COST_MAP")}, f)',
    ].join('\n') + '\n');
    writeFileSync(join(stub, 'litellm', 'llms', '__init__.py'), '');
    writeFileSync(join(pkg, '__init__.py'), '');
    // The two env reads, the makedirs and the two writes the runtime's real
    // authenticator makes (read from its source, litellm 1.101.0).
    writeFileSync(join(pkg, 'authenticator.py'), [
      'import json, os',
      `REC = ${JSON.stringify(recDir)}`,
      `MODE = ${JSON.stringify(mode)}`,
      `TOKEN = ${JSON.stringify(TOKEN)}`,
      'class Authenticator:',
      '    def __init__(self):',
      '        self.token_dir = os.getenv("CHATGPT_TOKEN_DIR", os.path.expanduser("~/.config/litellm/chatgpt"))',
      '        self.auth_file = os.path.join(self.token_dir, os.getenv("CHATGPT_AUTH_FILE", "auth.json"))',
      '        if not os.path.exists(self.token_dir):',
      '            os.makedirs(self.token_dir, exist_ok=True)',
      '    def get_access_token(self):',
      '        with open(os.path.join(REC, "authenticator.json"), "w") as f:',
      '            json.dump({"tokenDir": self.token_dir, "authFile": self.auth_file,',
      '                       "env": sorted(k for k in os.environ',
      '                                     if k.startswith(("CHATGPT_", "LITELLM_", "OPENAI_")))}, f)',
      '        print("Sign in with ChatGPT using device code:")',
      '        print("1) Visit https://orchard-api/device")',
      '        print("2) Enter code: WXYZ-4321", flush=True)',
      '        if MODE == "stamps-then-raises":',
      '            with open(self.auth_file, "w") as f:',
      '                json.dump({"device_code_requested_at": 1}, f)',
      '            raise RuntimeError("fixture: the device code was never approved")',
      '        if MODE == "writes":',
      '            with open(self.auth_file, "w") as f:',
      '                json.dump({"access_token": TOKEN}, f)',
      '        return TOKEN',
    ].join('\n') + '\n');
    // THE INTERPRETER BODY (`plantFakeRuntime`'s `python` option), which owns
    // every arm. `check`'s three `-I -c` reads are answered as the fixture's
    // default fake answers them: the version itself (the default `version`,
    // 1.101.0, which the stamp records), and the stamp read and the probe hash
    // exec'd on the box's real python3. The Authenticator program is recorded,
    // then run. Isolated mode (-I) ignores PYTHONPATH, so the stub path is
    // inserted by a wrapper program rather than by the environment. Every other
    // argv or program exits 90, so a path this fixture never modelled reds.
    const python = [
      '#!/bin/sh',
      'case "$1 $2" in',
      '  "-I -c") : ;;',
      '  *) echo "fixture runtime python: unexpected argv: $*" >&2; exit 90 ;;',
      'esac',
      'case "$3" in',
      '  *importlib.metadata*) echo 1.101.0; exit 0 ;;',
      `  *json.load*|*hashlib*) exec ${shq(PY)} "$@" ;;`,
      '  *Authenticator*)',
      `    printf '%s\\n' "$0" >> ${shq(join(recDir, 'argv0'))}`,
      `    printf '%s\\n' "$#" > ${shq(join(recDir, 'argc'))}`,
      `    printf '%s' "$3" > ${shq(join(recDir, 'program'))}`,
      `    exec ${shq(PY)} -I -c 'import sys; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]); `
        + 'src = sys.argv[2]; sys.argv = ["-c"]; exec(compile(src, "<string>", "exec"), {"__name__": "__main__"})\' '
        + `${shq(stub)} "$3" ;;`,
      'esac',
      'echo "fixture runtime python: unexpected program: $3" >&2',
      'exit 90',
    ].join('\n') + '\n';
    return { generationName: GEN, python };
  };

  /** ccrc under `umask 022`, so the mode case measures ccrc's umask rather than
   *  the runner's; every variable the login scrubs, and every ccrc knob, is
   *  removed from the developer's environment before a case adds its own. The
   *  `CCRC_` prefix covers the lane library's two, `CCRC_CODEX_PROBE_S` and
   *  `CCRC_CODEX_READY_S` (ruling R23): `start`, which A8 runs, is a reader of
   *  both. */
  const runCcrc = (home: string, args: string[], extra: NodeJS.ProcessEnv = {}):
    { code: number; stdout: string; stderr: string } => {
    const base: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    for (const k of Object.keys(base)) {
      if (/^(CHATGPT_|LITELLM_|OPENAI_|CCRC_)/.test(k)) delete base[k];
    }
    const r = spawnSync('bash', ['-c', 'umask 022 && exec "$BASH" "$0" "$@"',
      join(home, 'ccrc', 'ccd', 'ccrc'), ...args], {
      encoding: 'utf8', cwd: home, timeout: 120_000,
      env: { ...ghContainedEnv(home, base, { systemd: true, tmux: true }), ...extra },
    });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };

  it('A1: runs the RESOLVED runtime\'s Authenticator over the roster\'s authDir, scrubbed, cost map local', async () => {
    const home = await loginBox();
    const rt = plantFakeRuntime(home, loginRuntime(home, 'writes'));
    const auth = join(home, AUTH_REL);
    const r = runCcrc(home, ['codex', 'login', 'codex-a'], {
      // Three ambient variables the runtime reads or could, one per prefix. The
      // second is the dangerous one: the real authenticator os.path.join()s it
      // onto the token dir, so an absolute value moves the credential out.
      CHATGPT_TOKEN_DIR: join(home, 'ambient-token-dir'),
      CHATGPT_AUTH_FILE: join(home, 'ambient', 'elsewhere.json'),
      OPENAI_API_KEY: 'ambient-not-a-secret',
      LITELLM_LOG: 'DEBUG',
    });
    expect(r.code, r.stderr).toBe(0);
    // The interpreter is the generation `ccgpt-runtime python` RESOLVED, never
    // one reached through `current` (D-3480: sys.prefix would follow it).
    // `rt.python` is `<gen>/bin/python` under this HOME, the spelling the
    // builder prints.
    expect(rec(home, 'argv0').trim().split('\n')).toEqual([rt.python]);
    expect(rec(home, 'argc').trim()).toBe('3');
    const program = rec(home, 'program');
    expect(program).toContain('from litellm.llms.chatgpt.authenticator import Authenticator');
    expect(program).toContain('Authenticator().get_access_token()');
    const a = JSON.parse(rec(home, 'authenticator.json')) as
      { tokenDir: string; authFile: string; env: string[] };
    expect(a.tokenDir).toBe(auth);
    expect(a.authFile).toBe(join(auth, 'auth.json'));
    expect(a.env).toEqual(['CHATGPT_TOKEN_DIR', 'LITELLM_LOCAL_MODEL_COST_MAP']);
    expect(JSON.parse(rec(home, 'import-env.json'))).toEqual({ LITELLM_LOCAL_MODEL_COST_MAP: 'True' });
    expect(existsSync(join(auth, 'auth.json'))).toBe(true);
    for (const p of ['ambient-token-dir', 'ambient']) {
      expect(existsSync(join(home, p)), `${p} was written — an ambient variable reached the runtime`).toBe(false);
    }
    // The device flow reaches the operator, and NOTHING ccrc printed before it
    // is shaped like a device code — `ccd-account-auth` publishes the FIRST one.
    expect(r.stdout).toContain('1) Visit https://orchard-api/device');
    expect(firstCode(r.stdout), 'ccrc printed a device-code-shaped run before the runtime did').toBe('WXYZ-4321');
    expect(r.stdout).toMatch(/^ccrc codex: codex-a: logged in/m);
    // get_access_token() RETURNS the access token: it is discarded, never shown.
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
  });

  it('A2: login-failed when the runtime exits 0 but leaves no auth.json', async () => {
    const home = await loginBox();
    plantFakeRuntime(home, loginRuntime(home, 'writes-nothing'));
    const r = runCcrc(home, ['codex', 'login', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: login-failed: .*no auth\.json/m);
    expect(r.stderr).toContain('ccrc codex login codex-a');
    expect(existsSync(join(home, AUTH_REL, 'auth.json'))).toBe(false);
    expect(r.stdout).not.toMatch(/logged in/);
  });

  it('A3: login-failed when the runtime fails AFTER stamping auth.json — existence alone is not a login', async () => {
    // The real authenticator writes {"device_code_requested_at": …} into
    // auth.json BEFORE it polls, so an abandoned device flow leaves the file.
    const home = await loginBox();
    plantFakeRuntime(home, loginRuntime(home, 'stamps-then-raises'));
    const r = runCcrc(home, ['codex', 'login', 'codex-a']);
    expect(existsSync(join(home, AUTH_REL, 'auth.json')),
      'the fixture did not stamp auth.json — this case would measure nothing').toBe(true);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: login-failed: .*exited 1/m);
    expect(r.stdout).not.toMatch(/logged in/);
  });

  it('A4: a NEW authDir and its auth.json are owner-only; an ADOPTED authDir keeps its mode', async () => {
    const home = await loginBox();
    plantFakeRuntime(home, loginRuntime(home, 'writes'));
    const auth = join(home, AUTH_REL);
    expect(runCcrc(home, ['codex', 'login', 'codex-a']).code).toBe(0);
    expect(statSync(auth).mode & 0o777).toBe(0o700);
    expect(statSync(join(auth, 'auth.json')).mode & 0o777).toBe(0o600);

    // Adoption is by path (spec §9.2): ccrc passes a directory it did not make
    // and never re-modes it.
    const adopted = await loginBox();
    plantFakeRuntime(adopted, loginRuntime(adopted, 'writes'));
    const dir = join(adopted, AUTH_REL);
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);
    expect(runCcrc(adopted, ['codex', 'login', 'codex-a']).code).toBe(0);
    expect(statSync(dir).mode & 0o777, 'login re-moded an adopted authDir').toBe(0o755);
  });

  it('A5: runtime-absent, naming the build, when no runtime has been built — and nothing is created', async () => {
    const home = await loginBox();
    const r = runCcrc(home, ['codex', 'login', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: runtime-absent: /m);
    expect(r.stderr).toContain('ccgpt-runtime build');
    expect(existsSync(join(home, AUTH_REL))).toBe(false);
  });

  it('A6: a lane that is not codex-kind is refused before the runtime runs', async () => {
    const home = await loginBox();
    plantFakeRuntime(home, loginRuntime(home, 'writes'));
    const r = runCcrc(home, ['codex', 'login', 'claude']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: not-codex: /m);
    expect(ranRuntime(home), 'the runtime ran for a lane that is not codex').toBe(false);
  });

  it('A7: login is behind the same role gate as the rest of ccrc codex', async () => {
    const home = await loginBox();
    plantFakeRuntime(home, loginRuntime(home, 'writes'));
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
    const r = runCcrc(home, ['codex', 'login', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: server-role: /m);
    expect(ranRuntime(home)).toBe(false);
  });

  it('A8: what login writes is exactly what start\'s not-logged-in gate reads', async () => {
    const home = await loginBox();
    plantFakeRuntime(home, loginRuntime(home, 'writes'));
    expect(runCcrc(home, ['models', 'codex-a', 'init', 'codex']).code).toBe(0);
    const current = join(home, '.ccrc', 'runtime', 'codex', 'current');
    const hide = (): void => renameSync(current, `${current}.hidden`);
    const show = (): void => renameSync(`${current}.hidden`, current);
    // BEFORE: the runtime is hidden too, so a start that checked the runtime
    // before auth would answer runtime-absent here — this half pins the order.
    hide();
    const before = runCcrc(home, ['codex', 'start', 'codex-a']);
    expect(before.code).toBe(1);
    expect(before.stderr).toMatch(/^ccrc codex: not-logged-in: /m);
    expect(before.stderr).toContain('ccrc codex login codex-a');
    show();
    expect(runCcrc(home, ['codex', 'login', 'codex-a']).code).toBe(0);
    // AFTER: the auth gate passes on what login left, and start stops at the
    // next gate — before any tier function, so no process is started.
    hide();
    const after = runCcrc(home, ['codex', 'start', 'codex-a']);
    expect(after.code).toBe(1);
    expect(after.stderr, 'start calls a lane login just signed in "not logged in"').not.toMatch(/not-logged-in/);
    expect(after.stderr).toMatch(/^ccrc codex: runtime-absent: /m);
  });

  it('A9: takes exactly one well-formed lane id, and a usage refusal exits 2', async () => {
    const home = await loginBox();
    plantFakeRuntime(home, loginRuntime(home, 'writes'));
    // Exit 2, not 1: `ccrc codex` exits 2 on a usage refusal (ruling R3, the
    // `ccd/ccrc` header's rule). The first two rows are the ARITY, which is
    // `cmd_codex`'s parse (Task 5, ruling R18): `_codex_login` checks none, so
    // these rows pin that login rides that parse. The third is a malformed id,
    // which `_codex_row` answers as usage at rc 2 (Task 4), and which login
    // must pass on as it came.
    for (const argv of [['codex', 'login'], ['codex', 'login', 'codex-a', 'extra'],
      ['codex', 'login', 'NOT_AN_ID']]) {
      const r = runCcrc(home, argv);
      expect(r.code, argv.join(' ')).toBe(2);
      expect(r.stderr).toMatch(/^ccrc codex: usage: /m);
    }
    expect(ranRuntime(home)).toBe(false);
  });
});
