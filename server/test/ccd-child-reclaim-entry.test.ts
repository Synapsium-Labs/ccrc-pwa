// DIRECT RECLAIM ENTRY (reclaim-entry-safety, D-3696): a supported direct
// `ws-reclaim`, or a syntactically valid direct `ws-audit --session <id>
// --reclaim [--defer-expired]`, reaches the Bash body only through a measured
// Bash >= 4.4 in privileged mode, established BEFORE Bash startup can consume
// inherited functions, `BASH_ENV` or shell-option state.
//
// What every case here runs is the INSTALLED direct entry — `<home>/.local/bin/ccd`
// executed by the kernel, as the server's `execFile` and the agent's both do —
// never `source ccd/ccd`. Source mode stays injectable by design, so its one
// row here (C3) is a CONTROL: proof the split did not quietly change it.
//
// FIXTURE HOMEs ONLY. The verb under test is destructive. Every destructive
// assertion reads the disk and git afterwards — the child's tree, its branch,
// its registry row, the competing row — never only what the verb printed.
//
// TRUST BOUNDARY, stated where the fixtures live: runtime PATH and every
// executable it selects are trusted prerequisites. The `tmux`/`systemctl`
// models below are honest fixture substrates on PATH, not attacks; an attack
// here is inherited SHELL STATE — `BASH_ENV`, `BASH_FUNC_*`, `SHELLOPTS`,
// `BASHOPTS`, `CDPATH`, `ENV`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, installDirectEntry, type DirectEntry } from './ccdWsHelpers.js';
import { itLinux } from './platformFixtures.js';
import {
  CHILD_BRANCH, CHILD_ENV, CHILD_ID, CHILD_RUN, CHILD_STUBS, evalOf, makeChild, type Child,
} from './childReclaimFixture.js';

let h: PrHarness;
let de: DirectEntry;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-entry-'); });
afterEach(() => { h.cleanup(); });

// ── the substrate on PATH ───────────────────────────────────────────────
// Privileged Bash imports no function, so the sourced suites' function stubs
// cannot reach a direct entry: these are EXECUTABLES, written over the
// harness's refusing poisons in its own PATH-first directory (they are
// create-if-absent there, so a model planted here stays). POSIX sh, and no
// shell function anywhere in them, so an imported function cannot redefine
// what they answer.

/** `tmux` as a file-backed model: `$HOME/tmux-sessions` (one name per line),
 *  `$HOME/tmux-clients-<name>` (what `list-clients` prints). An exact `=name:`
 *  target matches exactly; anything else must match a whole line. Every call
 *  is appended to `$HOME/ccd-calls`. No match: tmux's own `can't find
 *  session` wording, which `_session_probe` reads as `gone`. */
const TMUX_MODEL_SH = `#!/bin/sh
printf 'tmux %s\\n' "$*" >> "$HOME/ccd-calls"
verb=$1; shift; t=
while [ $# -gt 0 ]; do case $1 in -t) t=$2; shift 2 ;; *) shift ;; esac; done
n=$t
case $t in =*) n=\${t#=}; n=\${n%:} ;; esac
hit=
if [ -f "$HOME/tmux-sessions" ]; then
  while IFS= read -r s; do [ "$s" = "$n" ] && hit=$s; done < "$HOME/tmux-sessions"
fi
[ -n "$hit" ] || { echo "can't find session: $n" >&2; exit 1; }
case $verb in
  has-session) exit 0 ;;
  list-clients) cat "$HOME/tmux-clients-$hit" 2>/dev/null; exit 0 ;;
  kill-session)
    grep -vxF -- "$hit" "$HOME/tmux-sessions" > "$HOME/tmux-sessions.new"
    mv "$HOME/tmux-sessions.new" "$HOME/tmux-sessions"; exit 0 ;;
esac
exit 1
`;

/** `systemctl --user` as a model of a unit that stops when asked: `is-active`
 *  answers `inactive`, every other verb is recorded to `$HOME/systemctl-calls`
 *  and succeeds. `$HOME/late-row` arms T1: the FIRST `disable` plants its
 *  contents as `$REG/demo-late.workdir` — a row that appears after the ladder
 *  passed and before the tail's final ownership measurement. */
const SYSTEMCTL_MODEL_SH = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/systemctl-calls"
case " $* " in *" is-active "*) echo inactive; exit 3 ;; esac
case " $* " in *" disable "*)
  if [ -f "$HOME/late-row" ]; then
    cp "$HOME/late-row" "$HOME/.cc-sessions/demo-late.workdir"
    printf 'u-late\\n' > "$HOME/.cc-sessions/demo-late.uuid"
    rm -f "$HOME/late-row"
  fi ;;
esac
exit 0
`;

const plantModels = (): void => {
  const bin = path.join(h.home, '.local', 'bin');
  for (const [name, text] of [['tmux', TMUX_MODEL_SH], ['systemctl', SYSTEMCTL_MODEL_SH]] as const) {
    fs.writeFileSync(path.join(bin, name), text, { mode: 0o755 });
    fs.chmodSync(path.join(bin, name), 0o755);
  }
};

// ── the environment ─────────────────────────────────────────────────────
/** Every variable Bash startup consumes or that this suite plants, removed
 *  from the inherited test environment so a CONTROL is clean by construction. */
const STARTUP_KEYS = ['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS', 'CDPATH', 'GLOBIGNORE'];
const cleanEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('BASH_FUNC_') || STARTUP_KEYS.includes(k)) continue;
    env[k] = v;
  }
  return env;
};

interface Ran { code: number; stdout: string; stderr: string }

/** The installed direct entry, executed by the kernel with `args` — the
 *  server's and the agent's own `execFile` shape. `env` is laid over a clean
 *  environment; the harness's PATH-first directory (the models, the `gh`
 *  poison) is always first. */
const direct = (args: readonly string[], env: Record<string, string> = {},
  o: { entry?: string; cwd?: string; path?: string } = {}): Ran => {
  const bin = path.join(h.home, '.local', 'bin');
  const r = spawnSync(o.entry ?? de.entry, [...args], {
    cwd: o.cwd ?? h.home, encoding: 'utf8', timeout: 120_000,
    env: {
      ...cleanEnv(), HOME: h.home, CCD_RECLAIM_RESIDUE_ROOT: path.join(h.home, 'residue'),
      PATH: o.path ?? `${bin}:${process.env['PATH'] ?? ''}`, ...env,
    },
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/** `ccd/ccd` run by an EXPLICIT `bash` — the invocation the launcher never
 *  sees, outside the guarantee. */
const explicitBash = (bashArgs: readonly string[], args: readonly string[], env: Record<string, string> = {}): Ran => {
  const bin = path.join(h.home, '.local', 'bin');
  const r = spawnSync('bash', [...bashArgs, CCD, ...args], {
    cwd: h.home, encoding: 'utf8', timeout: 120_000,
    env: { ...cleanEnv(), HOME: h.home, CCD_RECLAIM_RESIDUE_ROOT: path.join(h.home, 'residue'),
      PATH: `${bin}:${process.env['PATH'] ?? ''}`, ...env },
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/** The lying `find` the defect was measured with: it answers success, and
 *  nothing, to the registry's `*.workdir` enumeration, and is the real `find`
 *  for every other call. */
const LYING_FIND = 'find() { [[ "$*" == *.workdir* ]] && return 0; command find "$@"; }';

const bashEnvFile = (text: string): string => {
  const f = path.join(h.home, 'hostile-bash-env.sh');
  fs.writeFileSync(f, `${text}\n`);
  return f;
};

const HOSTILE: Record<string, () => Record<string, string>> = {
  'A1 BASH_ENV defines a lying find': () => ({ BASH_ENV: bashEnvFile(LYING_FIND) }),
  'A2 BASH_ENV installs a READONLY lying find': () => ({ BASH_ENV: bashEnvFile(`${LYING_FIND}; readonly -f find`) }),
  'A3 an exported BASH_FUNC_find%% lies before startup': () => ({
    'BASH_FUNC_find%%': '() { [[ "$*" == *.workdir* ]] && return 0; command find "$@"; }',
  }),
};

// ── the fixture ─────────────────────────────────────────────────────────
const OTHER = 'demo-other';
const reg = (id: string, field: string): string => path.join(h.home, '.cc-sessions', `${id}.${field}`);

/** Another registry row naming the child's own tree — R31's case: the honest
 *  verdict is `containment-unproven`, and nothing may be removed. */
const plantCompetingRow = (c: Child, id = OTHER): void => {
  fs.writeFileSync(reg(id, 'uuid'), `u-${id}\n`);
  fs.writeFileSync(reg(id, 'workdir'), c.wt);
};

const setup = (): Child => {
  plantModels();
  const c = makeChild(h);
  de = installDirectEntry(h.home);
  return c;
};

const audit = (env: Record<string, string> = {}, extra: readonly string[] = []): { r: Ran; doc: Record<string, unknown> } => {
  const r = direct(['ws-audit', '--session', CHILD_ID, '--reclaim', ...extra], env);
  let doc: Record<string, unknown> = {};
  try { doc = JSON.parse(r.stdout) as Record<string, unknown>; } catch { /* the caller asserts on r */ }
  return { r, doc };
};

const reclaim = (token: string, env: Record<string, string> = {}, extra: readonly string[] = []): Ran =>
  direct(['ws-reclaim', '--expect', token, '--child-of', String(CHILD_RUN), '--session', CHILD_ID, ...extra], env);

const ANY_TOKEN = 'a'.repeat(64);

/** Everything a refusal must leave standing, read from disk and git. */
const intact = (c: Child, rows: readonly string[] = [OTHER]): void => {
  expect(fs.existsSync(c.wt), 'the child’s tree survives').toBe(true);
  expect(fs.existsSync(path.join(c.wt, 'f2.txt')), 'its work survives').toBe(true);
  expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'its branch survives').toContain(CHILD_BRANCH);
  expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'git still records the tree').toContain(`worktree ${c.wt}\n`);
  expect(fs.existsSync(reg(CHILD_ID, 'uuid')), 'its registry row survives').toBe(true);
  for (const id of rows) {
    expect(fs.readFileSync(reg(id, 'workdir'), 'utf8').trim(), `row ${id} still names the tree`).toBe(c.wt);
  }
};

const removed = (c: Child): boolean => !fs.existsSync(c.wt);

const docOf = (r: Ran): Record<string, unknown> => {
  try { return JSON.parse(r.stdout) as Record<string, unknown>; } catch { return {}; }
};

// ── controls ────────────────────────────────────────────────────────────
describe('controls — the clean direct entry answers as ccd always has', () => {
  itLinux('C1 a clean direct audit of a child another row names answers containment-unproven, with no token', () => {
    const c = setup();
    plantCompetingRow(c);
    const { r, doc } = audit();
    expect(r.code, r.stderr).toBe(0);
    expect(doc['verdict'], r.stderr).toBe('containment-unproven');
    expect(doc['token']).toBeUndefined();
    intact(c);
  }, 120_000);

  itLinux('C2 a clean direct reclaim of that child refuses containment-unproven and removes nothing', () => {
    const c = setup();
    plantCompetingRow(c);
    const r = reclaim(ANY_TOKEN);
    expect(r.code, r.stderr).toBe(0);
    expect(docOf(r)['refused'], r.stdout + r.stderr).toBe('containment-unproven');
    intact(c);
  }, 120_000);

  itLinux('C2b the same fixture CAN reclaim through the direct entry — an unshared child is removed (the attacks’ survival is not vacuous)', () => {
    const c = setup();
    const { r: ar, doc } = audit();
    expect(ar.code, ar.stderr).toBe(0);
    expect(doc['verdict'], ar.stderr).toBe('reclaimable');
    expect(doc['token'], 'the direct audit mints the token the sourced ladder mints').toBe(evalOf(h).token);
    const r = reclaim(String(doc['token']));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r)['reclaimed']).toBe(CHILD_ID);
    expect(removed(c), 'the child’s tree is gone').toBe(true);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toBe('');
  }, 180_000);

  it('C3 source mode stays injectable: a sourced poisoned find is observable — even with protected-looking positionals', () => {
    // `source ccd/ccd ws-reclaim …` gives the sourced file protected-looking
    // positionals; source mode must still not run the direct-entry guard, and
    // the shell that sourced it keeps the function it defined.
    const c = makeChild(h);
    plantCompetingRow(c);
    const out = h.sh(`source "${CCD}" ws-reclaim --expect ${ANY_TOKEN}; ${LYING_FIND};`
      + ` _ws_reclaim_workdir_shared ${CHILD_ID} "${c.wt}"; printf 'rc=%s shared=[%s]' "$?" "$_WS_SHARED_ROWS"`);
    expect(out, 'the sourced poison answered: no competing row').toBe('rc=0 shared=[]');
    const honest = h.sh(`_ws_reclaim_workdir_shared ${CHILD_ID} "${c.wt}"; printf 'rc=%s shared=[%s]' "$?" "$_WS_SHARED_ROWS"`);
    expect(honest, 'the same call without the poison names the row').toBe(`rc=0 shared=[${OTHER}]`);
  }, 60_000);

  it('C4 an ORDINARY direct verb keeps its inherited environment: BASH_ENV runs once, for the payload', () => {
    plantModels();
    de = installDirectEntry(h.home);
    const marks = path.join(h.home, 'bash-env-ran');
    const r = direct(['caps'], { BASH_ENV: bashEnvFile(`printf 'ran\\n' >> "${marks}"`) });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')).toContain('ws-reclaim');
    expect(fs.readFileSync(marks, 'utf8'), 'BASH_ENV ran exactly once — the payload’s, never a probe’s').toBe('ran\n');
  }, 60_000);
});

// ── startup attacks ─────────────────────────────────────────────────────
describe('startup attacks against the direct entry — the competing child survives', () => {
  for (const [name, hostile] of Object.entries(HOSTILE)) {
    itLinux(`${name}: the direct audit stays honest and the direct reclaim removes nothing`, () => {
      const c = setup();
      plantCompetingRow(c);
      const env = hostile();
      const { r: ar, doc } = audit(env);
      // Whatever token the audit did or did not mint, the poisoned verb is
      // handed the token a poisoned audit WOULD mint — the strongest consent.
      const token = typeof doc['token'] === 'string' ? doc['token'] : evalOf(h, { pre: `${LYING_FIND};` }).token || ANY_TOKEN;
      const r = reclaim(token, env);
      intact(c);
      expect(docOf(r)['reclaimed'], `the verb was steered: ${r.stdout}${r.stderr}`).toBeUndefined();
      expect(doc['verdict'], `the audit was steered: ${ar.stdout}${ar.stderr}`).toBe('containment-unproven');
    }, 180_000);
  }

  itLinux('A4 a competing row that appears AFTER the token was minted survives a poisoned verb', () => {
    const c = setup();
    const { doc } = audit();
    expect(doc['verdict']).toBe('reclaimable');
    plantCompetingRow(c);
    const r = reclaim(String(doc['token']), HOSTILE['A3 an exported BASH_FUNC_find%% lies before startup']!());
    intact(c);
    expect(docOf(r)['reclaimed'], `the verb was steered: ${r.stdout}${r.stderr}`).toBeUndefined();
  }, 180_000);

  itLinux('T1 a row that appears between the ladder and the tail’s final ownership measurement survives a poisoned verb', () => {
    const c = setup();
    const { doc } = audit();
    expect(doc['verdict']).toBe('reclaimable');
    fs.writeFileSync(path.join(h.home, 'late-row'), c.wt);
    const r = reclaim(String(doc['token']), HOSTILE['A1 BASH_ENV defines a lying find']!());
    expect(fs.existsSync(reg('demo-late', 'workdir')), 'the late row was planted mid-verb (fixture control)').toBe(true);
    intact(c, ['demo-late']);
    expect(docOf(r)['reclaimed'], `the verb was steered: ${r.stdout}${r.stderr}`).toBeUndefined();
  }, 180_000);

  itLinux('R1 an interrupted reclaim:worktree resumed under a poisoned find leaves a competing row’s tree standing', () => {
    const c = setup();
    h.sh(`${CHILD_STUBS} export ${CHILD_ENV}; _ws_reclaim_eval ${CHILD_ID} 0 ${CHILD_RUN} >/dev/null`
      + ` && _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" "$REAP_BRANCH" ${CHILD_RUN}`
      + ` && _ws_tombstone ${CHILD_ID} '[]' "$(_ws_reclaim_tomb_fields ${CHILD_RUN})" >/dev/null`
      + ` && _reg_set ${CHILD_ID} reaping reclaim:worktree`);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:worktree');
    plantCompetingRow(c);
    const token = h.sh(`_ws_reclaim_resume_eval ${CHILD_ID} 0 ${CHILD_RUN} worktree >/dev/null; printf '%s' "$REAP_TOKEN"`);
    const r = reclaim(token, HOSTILE['A3 an exported BASH_FUNC_find%% lies before startup']!());
    expect(fs.existsSync(c.wt), 'the tree another row names survives the resume').toBe(true);
    expect(fs.existsSync(path.join(c.wt, 'f2.txt')), 'its work survives').toBe(true);
    expect(fs.readFileSync(reg(OTHER, 'workdir'), 'utf8')).toBe(c.wt);
    expect(docOf(r)['reclaimed'], `the resume was steered: ${r.stdout}${r.stderr}`).toBeUndefined();
  }, 180_000);

  itLinux('S1 an imported tmux that lies an attached session away: attached-defer still wins, the pane and the tree survive', () => {
    const c = setup();
    fs.writeFileSync(path.join(h.home, 'tmux-sessions'), `cc-${CHILD_ID}\n`);
    fs.writeFileSync(path.join(h.home, `tmux-clients-cc-${CHILD_ID}`), '/dev/pts/9\n');
    const LYING_TMUX = 'tmux() { case "$1" in has-session) echo "can\'t find session: x" >&2; return 1 ;; esac; command tmux "$@"; }';
    const lie = { 'BASH_FUNC_tmux%%': LYING_TMUX.slice('tmux'.length) };
    const { doc } = audit(lie);
    const token = evalOf(h, { pre: `${LYING_TMUX};` }).token || ANY_TOKEN;
    const r = reclaim(token, lie);
    expect(fs.readFileSync(path.join(h.home, 'tmux-sessions'), 'utf8'), 'the attached pane was never killed').toBe(`cc-${CHILD_ID}\n`);
    intact(c, []);
    expect(docOf(r)['refused'], `${r.stdout}${r.stderr}`).toBe('attached');
    expect(doc['verdict'], 'the audit was steered past the attached client').toBe('attached');
  }, 180_000);

  itLinux('O1 inherited SHELLOPTS=xtrace plus a lying imported find cannot authorize protected entry', () => {
    const c = setup();
    plantCompetingRow(c);
    const env = { SHELLOPTS: 'xtrace', ...HOSTILE['A3 an exported BASH_FUNC_find%% lies before startup']!() };
    const { r: ar, doc } = audit(env);
    const r = reclaim(evalOf(h, { pre: `${LYING_FIND};` }).token || ANY_TOKEN, env);
    intact(c);
    expect(docOf(r)['reclaimed']).toBeUndefined();
    expect(doc['verdict'], ar.stderr.slice(0, 400)).toBe('containment-unproven');
    expect(ar.stderr, 'xtrace from the environment never switched on').not.toMatch(/^\+ /m);
  }, 180_000);

  itLinux('O1b inherited SHELLOPTS=privileged plus a lying imported find cannot forge the privileged boundary', () => {
    // Measured (bash 5.2): a plain bash that IMPORTS `SHELLOPTS=privileged`
    // reports `p` in `$-` AND still imports exported functions (D-3697).
    const c = setup();
    plantCompetingRow(c);
    const env = { SHELLOPTS: 'privileged', ...HOSTILE['A3 an exported BASH_FUNC_find%% lies before startup']!() };
    const { doc } = audit(env);
    const r = reclaim(evalOf(h, { pre: `${LYING_FIND};` }).token || ANY_TOKEN, env);
    intact(c);
    expect(docOf(r)['reclaimed']).toBeUndefined();
    expect(doc['verdict']).toBe('containment-unproven');
  }, 180_000);

  itLinux('O2 inherited BASHOPTS=nocasematch cannot fold a case-variant competing row into the child itself', () => {
    // Measured: under an imported `nocasematch`, `[[ "$o" != "$id" ]]` is
    // case-insensitive, so the registry walk skips `DEMO-QUIET-BASIN` as the
    // child's own row and proves nothing else names the tree.
    const c = setup();
    plantCompetingRow(c, CHILD_ID.toUpperCase());
    const env = { BASHOPTS: 'nocasematch' };
    const { doc } = audit(env);
    const r = reclaim(String(doc['token'] ?? ANY_TOKEN), env);
    intact(c, [CHILD_ID.toUpperCase()]);
    expect(docOf(r)['reclaimed'], `${r.stdout}${r.stderr}`).toBeUndefined();
    expect(doc['verdict']).toBe('containment-unproven');
  }, 180_000);

  itLinux('O3 a hostile CDPATH cannot redirect the protected measurements', () => {
    const c = setup();
    plantCompetingRow(c);
    const decoy = path.join(h.home, 'decoy');
    for (const d of ['.git', 'demo', 'quiet-basin', 'worktrees/demo/quiet-basin']) fs.mkdirSync(path.join(decoy, d), { recursive: true });
    const env = { CDPATH: decoy };
    const { doc } = audit(env);
    expect(doc['verdict']).toBe('containment-unproven');
    const r = reclaim(ANY_TOKEN, env);
    expect(docOf(r)['refused']).toBe('containment-unproven');
    intact(c);
  }, 180_000);

  itLinux('O4 a hostile ENV cannot steer the protected body', () => {
    const c = setup();
    plantCompetingRow(c);
    const marks = path.join(h.home, 'env-ran');
    const env = { ENV: bashEnvFile(`${LYING_FIND}; printf 'ran\\n' >> "${marks}"`) };
    const { doc } = audit(env);
    expect(doc['verdict']).toBe('containment-unproven');
    const r = reclaim(ANY_TOKEN, env);
    expect(docOf(r)['refused']).toBe('containment-unproven');
    expect(fs.existsSync(marks), 'ENV was never read').toBe(false);
    intact(c);
  }, 180_000);
});

// ── the protected grammar ───────────────────────────────────────────────
/** A body that reports what it was started with: `$-` (the privileged flag
 *  shows as `p`) and its argv, NUL-terminated, to `$HOME/argv-out`. Installed
 *  in place of the real body, so the LAUNCHER's classification is what is read. */
const ECHO_BODY = '#!/usr/bin/env bash\n{ printf "%s\\0" "$-"; printf "%s\\0" "$@"; } > "$HOME/argv-out"\n';
const echoed = (): { flags: string; argv: string[] } => {
  const parts = fs.readFileSync(path.join(h.home, 'argv-out'), 'utf8').split('\0');
  parts.pop();
  return { flags: parts[0] ?? '', argv: parts.slice(1) };
};

/** The GRAMMAR TABLE, run against both classifiers. `true` = protected. */
const GRAMMAR: ReadonlyArray<readonly [string, readonly string[], boolean]> = [
  ['ws-reclaim alone', ['ws-reclaim'], true],
  ['ws-reclaim with the full tail', ['ws-reclaim', '--expect', ANY_TOKEN, '--child-of', '7', '--session', 'x'], true],
  ['ws-reclaim with a malformed tail (the body’s parser owns that)', ['ws-reclaim', '--nonsense'], true],
  ['valid audit --reclaim', ['ws-audit', '--session', 'x', '--reclaim'], true],
  ['valid audit --reclaim --defer-expired', ['ws-audit', '--session', 'x', '--reclaim', '--defer-expired'], true],
  ['plain audit', ['ws-audit', '--session', 'x'], false],
  ['audit, --defer-expired alone', ['ws-audit', '--session', 'x', '--defer-expired'], false],
  ['audit, missing session id', ['ws-audit', '--session', '--reclaim'], false],
  ['audit, --reclaim out of order', ['ws-audit', '--reclaim', '--session', 'x'], false],
  ['audit, --defer-expired before --reclaim', ['ws-audit', '--session', 'x', '--defer-expired', '--reclaim'], false],
  ['audit, a later duplicate --reclaim', ['ws-audit', '--session', 'x', '--reclaim', '--reclaim'], false],
  ['audit, an extra token', ['ws-audit', '--session', 'x', '--reclaim', 'extra'], false],
  ['audit, an extra token after --defer-expired', ['ws-audit', '--session', 'x', '--reclaim', '--defer-expired', 'extra'], false],
  ['caps', ['caps'], false],
  ['a verb merely CONTAINING ws-reclaim later', ['caps', 'ws-reclaim'], false],
  ['ws-reclaimx (prefix only)', ['ws-reclaimx'], false],
];

describe('the protected grammar — the launcher and the body classify the same argv the same way', () => {
  for (const [name, argv, protectedShape] of GRAMMAR) {
    it(`${name} → ${protectedShape ? 'protected' : 'ordinary'}`, () => {
      // The launcher: what the echo body was started with.
      de = installDirectEntry(h.home, { body: ECHO_BODY });
      const r = direct(argv);
      expect(r.code, r.stderr).toBe(0);
      const got = echoed();
      expect(got.argv, 'argv arrives exactly').toEqual([...argv]);
      expect(got.flags.includes('p'), `launcher: flags ${got.flags}`).toBe(protectedShape);
      // The body: an EXPLICIT, unprivileged bash. A protected shape is refused
      // at entry; an ordinary one reaches ccd's own dispatcher.
      const b = explicitBash([], argv);
      const refusedAtEntry = b.code === 125 && /refused \(entry-/.test(b.stderr);
      expect(refusedAtEntry, `body: rc ${b.code} ${b.stderr.slice(0, 300)}`).toBe(protectedShape);
    }, 60_000);
  }
});
