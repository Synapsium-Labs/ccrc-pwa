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

  it('C4 an ORDINARY direct verb keeps its inherited environment: its probe and its payload each run BASH_ENV', () => {
    // Sanitization is protected-entry-only (the plan as tightened): an
    // ordinary start's probe and payload both see the caller's environment.
    plantModels();
    de = installDirectEntry(h.home);
    const marks = path.join(h.home, 'bash-env-ran');
    const r = direct(['caps'], { BASH_ENV: bashEnvFile(`printf '%s\\n' "$0" >> "${marks}"`) });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')).toContain('ws-reclaim');
    expect(fs.readFileSync(marks, 'utf8').split('\n').filter(Boolean), 'the ordinary probe, then the payload')
      .toEqual(['ccd-entry-probe', de.body]);
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

  // A TRUSTED decision-critical executable that happens to be a Bash script:
  // the body is privileged, the CHILD it starts is not. Planted over PATH's
  // `find` in the harness's PATH-first directory, faithful in every call.
  const REAL_FIND = spawnSync('bash', ['-c', 'command -v find'], { encoding: 'utf8' }).stdout.trim();
  const plantBashFind = (): void => {
    fs.writeFileSync(path.join(h.home, '.local', 'bin', 'find'),
      `#!${fs.realpathSync(spawnSync('bash', ['-c', 'printf %s "$BASH"'], { encoding: 'utf8' }).stdout)}\n`
      + `PATH=${path.dirname(REAL_FIND)}:/usr/bin:/bin find "$@"\n`, { mode: 0o755 });
  };
  const O5: Record<string, () => Record<string, string>> = {
    'BASH_ENV': () => ({ BASH_ENV: bashEnvFile('case " $* " in *.workdir*) exit 0 ;; esac') }),
    'ENV': () => ({ ENV: bashEnvFile('case " $* " in *.workdir*) exit 0 ;; esac'), SHELLOPTS: 'posix' }),
    'an exported function': () => HOSTILE['A3 an exported BASH_FUNC_find%% lies before startup']!(),
  };
  for (const [name, hostile] of Object.entries(O5)) {
    itLinux(`O5 a trusted Bash-wrapper find’s child Bash consumes no inherited ${name}: the competing child survives`, () => {
      const c = setup();
      plantBashFind();
      plantCompetingRow(c);
      const env = hostile();
      const { doc } = audit(env);
      const r = reclaim(evalOf(h, { pre: `${LYING_FIND};` }).token || ANY_TOKEN, env);
      intact(c);
      expect(docOf(r)['reclaimed'], `${r.stdout}${r.stderr}`).toBeUndefined();
      expect(doc['verdict']).toBe('containment-unproven');
    }, 180_000);
  }

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
  ['valid audit skeleton with a session value the body will reject', ['ws-audit', '--session', '../../etc/passwd', '--reclaim'], true],
  ['audit, missing session-value position', ['ws-audit', '--session', '--reclaim'], false],
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

// ── the launcher itself ─────────────────────────────────────────────────
const REAL_BASH = fs.realpathSync(spawnSync('bash', ['-c', 'printf %s "$BASH"'], { encoding: 'utf8' }).stdout);
const RECLAIM_ARGV = ['ws-reclaim', '--expect', ANY_TOKEN, '--child-of', '7', '--session', 'x'] as const;

/** A fixture `bash` in its own directory: `kind` decides what it does with
 *  each call, and every call is logged to `$HOME/bash-log` as `<name> <argv>`.
 *  These are TRUST-BOUNDARY fixtures — interpreters PATH selects — modelling
 *  what the launcher must refuse or skip, never an attack it defeats. */
type Shape = 'good' | 'old' | 'strip-payload' | 'strip-all' | 'malformed' | 'duplicate' | 'overlong' | 'failed';
const fakeBash = (name: string, kind: Shape): string => {
  const dir = path.join(h.home, 'interp', name);
  fs.mkdirSync(dir, { recursive: true });
  const log = `printf '%s %s\\n' '${name}' "$*" >> "$HOME/bash-log"`;
  const last = 'last=; for a; do last=$a; done';
  const isProbe = 'case " $* " in *" -c "*) probe=1 ;; *) probe= ;; esac';
  const strip = 'n=$#; i=0; while [ $i -lt $n ]; do a=$1; shift; i=$((i+1)); [ "$a" = -p ] || set -- "$@" "$a"; done';
  const body: Record<Shape, string> = {
    good: `exec '${REAL_BASH}' "$@"`,
    // What a Bash 3.2/4.2/4.3 does with the probe — its floor test fails, so
    // it prints nothing — and an exit that marks it if it is ever handed the payload.
    old: `${isProbe}\n[ -n "$probe" ] && exit 1\nexit 97`,
    'strip-payload': `${isProbe}\n[ -n "$probe" ] && exec '${REAL_BASH}' "$@"\n${strip}\nexec '${REAL_BASH}' "$@"`,
    'strip-all': `${strip}\nexec '${REAL_BASH}' "$@"`,
    malformed: `${last}\nprintf 'ccd-entry-probe p %sX\\n' "$last"`,
    duplicate: `${last}\nprintf 'ccd-entry-probe p %s\\n' "$last" "$last"`,
    overlong: `${last}\nprintf 'ccd-entry-probe p %s\\n' "$last"; i=0; while [ $i -lt 400 ]; do printf x; i=$((i+1)); done`,
    failed: `${last}\nprintf 'ccd-entry-probe p %s\\n' "$last"; exit 1`,
  };
  fs.writeFileSync(path.join(dir, 'bash'), `#!/bin/sh\n${log}\n${body[kind]}\n`, { mode: 0o755 });
  return dir;
};
const bashLog = (): string[] => {
  const f = path.join(h.home, 'bash-log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
};
const harnessBin = (): string => path.join(h.home, '.local', 'bin');
const argvOut = (): string => path.join(h.home, 'argv-out');
const refusedBy = (r: Ran, cls: string): void => {
  expect(r.code, `${cls}: ${r.stderr}`).toBe(125);
  expect(r.stderr).toContain(`ccd: refused (entry-${cls}):`);
};

describe('the launcher’s Python startup is isolated (-IS through the kernel)', () => {
  const planted = (marker: string): string =>
    `import os\nopen(${JSON.stringify(marker)}, 'a').write('imported\\n')\nraise SystemExit('poisoned module ran')\n`;

  it('the rendered shebang is the canonical python3 with -IS, and the kernel gives it isolated, env-free, user-site-free, site-free flags', () => {
    de = installDirectEntry(h.home, { body: ECHO_BODY });
    const first = fs.readFileSync(de.entry, 'utf8').split('\n')[0];
    expect(first).toBe(`#!${de.python} -IS`);
    expect(path.isAbsolute(de.python!)).toBe(true);
    // The SAME first line over a body that reports its own flags, executed
    // through the kernel — the one way to measure what this kernel does with it.
    const probe = path.join(h.home, 'flags-probe');
    fs.writeFileSync(probe, `${first}\nimport sys\nf = sys.flags\nprint(sys.version_info[0], f.isolated, f.ignore_environment, f.no_user_site, f.no_site)\n`, { mode: 0o755 });
    const r = spawnSync(probe, [], { encoding: 'utf8', env: { ...cleanEnv(), HOME: h.home, PYTHONHOME: '/nonexistent-python-home' } });
    expect(r.stdout.trim(), r.stderr).toBe('3 1 1 1 1');
  }, 60_000);

  it('hostile PYTHONHOME, PYTHONPATH, a module beside the launcher, one in the cwd and user-site customize hooks are all ignored — and no bytecode is left', () => {
    de = installDirectEntry(h.home, { body: ECHO_BODY });
    const marks = path.join(h.home, 'python-poison-ran');
    const pp = path.join(h.home, 'pythonpath');
    const cwd = path.join(h.home, 'cwd');
    for (const d of [pp, cwd]) fs.mkdirSync(d, { recursive: true });
    for (const d of [pp, cwd, harnessBin()]) {
      for (const mod of ['hashlib', 'subprocess', 'select', 'sitecustomize', 'usercustomize']) fs.writeFileSync(path.join(d, `${mod}.py`), planted(marks));
    }
    const usersite = spawnSync(de.python!, ['-c', 'import site;print(site.getusersitepackages())'],
      { encoding: 'utf8', env: { ...cleanEnv(), HOME: h.home } }).stdout.trim();
    expect(usersite.startsWith(h.home), usersite).toBe(true);
    fs.mkdirSync(usersite, { recursive: true });
    for (const mod of ['sitecustomize', 'usercustomize']) fs.writeFileSync(path.join(usersite, `${mod}.py`), planted(marks));
    const r = direct(RECLAIM_ARGV, {
      PYTHONHOME: '/nonexistent-python-home', PYTHONPATH: pp, PYTHONSTARTUP: path.join(pp, 'hashlib.py'),
      PYTHONDONTWRITEBYTECODE: '', PYTHONSAFEPATH: '',
    }, { cwd });
    expect(r.code, r.stderr).toBe(0);
    expect(echoed().argv).toEqual([...RECLAIM_ARGV]);
    expect(fs.existsSync(marks), 'a planted module or customize hook ran').toBe(false);
    const leftovers = spawnSync('find', [path.join(h.home, '.local'), cwd, pp, '(', '-name', '__pycache__', '-o', '-name', '*.pyc', '-o', '-name', '*.tmp*', ')'],
      { encoding: 'utf8' }).stdout.trim();
    expect(leftovers, 'bytecode or a launcher temporary was left behind').toBe('');
  }, 60_000);

  it('the tracked template carries each placeholder exactly once, and a launcher left unrendered refuses by name', () => {
    const tpl = fs.readFileSync(path.resolve(__dirname, '../../ccd/ccd-entry.py'), 'utf8');
    for (const p of ['@CCRC_PYTHON3@', '@CCRC_CCD_SHA256@']) expect(tpl.split(p).length - 1, p).toBe(1);
    expect(tpl.split('\n')[0]).toBe('#!@CCRC_PYTHON3@ -IS');
    expect(tpl.match(/@CCRC_[A-Z0-9_]+@/g)).toEqual(['@CCRC_PYTHON3@', '@CCRC_CCD_SHA256@']);
    de = installDirectEntry(h.home, { body: ECHO_BODY });
    fs.writeFileSync(de.entry, tpl.replace('@CCRC_PYTHON3@', de.python!), { mode: 0o755 });
    const r = direct(['caps']);
    refusedBy(r, 'unrendered');
    expect(fs.existsSync(argvOut()), 'the body never ran').toBe(false);
  }, 60_000);
});

describe('the interpreter scan — PATH in order, proved, and the exact candidate reused', () => {
  it('B1 the first eligible PATH bash is probed once and that exact executable runs the payload', () => {
    de = installDirectEntry(h.home, { body: ECHO_BODY });
    const a = fakeBash('first', 'good');
    const b = fakeBash('second', 'good');
    const r = direct(RECLAIM_ARGV, {}, { path: `${a}:${a}:${b}:${harnessBin()}` });
    expect(r.code, r.stderr).toBe(0);
    expect(echoed().flags).toContain('p');
    const log = bashLog();
    expect(log.filter((l) => l.startsWith('second ')), 'a later eligible bash is never asked').toEqual([]);
    expect(log.filter((l) => l.startsWith('first ') && / -c /.test(` ${l} `)), 'probed ONCE, a repeated PATH entry included').toHaveLength(1);
    expect(log.filter((l) => !/ -c /.test(` ${l} `))).toEqual([`first -p -- ${de.body} ${RECLAIM_ARGV.join(' ')}`]);
  }, 60_000);

  it('B2 an old bash first is skipped for a later eligible one, which is the one exec’d; an all-old PATH refuses', () => {
    de = installDirectEntry(h.home, { body: ECHO_BODY });
    const old = fakeBash('old', 'old');
    const good = fakeBash('brew', 'good');
    for (const argv of [RECLAIM_ARGV, ['caps'] as const]) {
      fs.rmSync(path.join(h.home, 'bash-log'), { force: true });
      const r = direct(argv, {}, { path: `${old}:${good}:${harnessBin()}` });
      expect(r.code, r.stderr).toBe(0);
      expect(bashLog().filter((l) => l.startsWith('old ') && !/ -c /.test(` ${l} `)), 'the old bash never ran the payload').toEqual([]);
      expect(bashLog().filter((l) => l.startsWith('brew ') && / -- /.test(l))).toHaveLength(1);
    }
    fs.rmSync(argvOut(), { force: true });
    for (const argv of [RECLAIM_ARGV, ['caps'] as const]) {
      const r = direct(argv, {}, { path: `${old}:${fakeBash('old2', 'old')}:${harnessBin()}` });
      refusedBy(r, 'no-bash');
      expect(fs.existsSync(argvOut()), 'nothing ran').toBe(false);
    }
  }, 60_000);

  it('B3 a bash whose probe passes but which strips -p from the payload: the BODY refuses before any external work', () => {
    plantModels();
    de = installDirectEntry(h.home);
    const strip = fakeBash('strip', 'strip-payload');
    const before = fs.readdirSync(path.join(h.home, '.cc-sessions')).sort();
    const r = direct(RECLAIM_ARGV, {}, { path: `${strip}:${harnessBin()}:${process.env['PATH'] ?? ''}` });
    refusedBy(r, 'unprivileged');
    expect(bashLog().filter((l) => / -- /.test(l))).toEqual([`strip -p -- ${de.body} ${RECLAIM_ARGV.join(' ')}`]);
    expect(fs.readdirSync(path.join(h.home, '.cc-sessions')).sort(), 'the registry was not touched').toEqual(before);
    expect(fs.existsSync(path.join(h.home, 'ccd-calls')), 'no tmux call').toBe(false);
    expect(fs.existsSync(path.join(h.home, 'systemctl-calls')), 'no unit call').toBe(false);
  }, 60_000);

  it('B4 a bash that strips -p from the probe too is never selected: the launcher refuses before any payload', () => {
    de = installDirectEntry(h.home, { body: ECHO_BODY });
    const r = direct(RECLAIM_ARGV, {}, { path: `${fakeBash('strip', 'strip-all')}:${harnessBin()}` });
    refusedBy(r, 'no-bash');
    expect(bashLog().filter((l) => / -- /.test(l)), 'no payload was started').toEqual([]);
    expect(fs.existsSync(argvOut())).toBe(false);
  }, 60_000);

  for (const kind of ['malformed', 'duplicate', 'overlong', 'failed'] as const) {
    it(`B5 a ${kind} probe answer refuses — never folded into an ordinary start`, () => {
      de = installDirectEntry(h.home, { body: ECHO_BODY });
      const r = direct(RECLAIM_ARGV, {}, { path: `${fakeBash(kind, kind)}:${harnessBin()}` });
      refusedBy(r, 'no-bash');
      expect(bashLog().filter((l) => / -- /.test(l)), 'no payload was started').toEqual([]);
      expect(fs.existsSync(argvOut())).toBe(false);
    }, 60_000);
  }

  it('no bash on PATH at all refuses — the launcher never falls back to a shell of its own', () => {
    de = installDirectEntry(h.home, { body: ECHO_BODY });
    for (const argv of [RECLAIM_ARGV, ['caps'] as const]) refusedBy(direct(argv, {}, { path: harnessBin() }), 'no-bash');
    expect(fs.existsSync(argvOut())).toBe(false);
  }, 60_000);
});

describe('argv, entry spellings and the installed layout', () => {
  const HARD = ['', ' ', 'a b', 'line1\nline2', '*', '?[x]', "'q'", '"dq"', ';', '--', '-x', '-p', '$(touch pwned)', '\\', '%s%n'];

  it('argv arrives byte-exact through both kinds of entry, and nothing in it is ever evaluated', () => {
    de = installDirectEntry(h.home, { body: ECHO_BODY });
    for (const argv of [['ws-reclaim', ...HARD], ['caps', ...HARD]]) {
      const r = direct(argv);
      expect(r.code, r.stderr).toBe(0);
      expect(echoed().argv).toEqual(argv);
    }
    expect(fs.existsSync(path.join(h.home, 'pwned'))).toBe(false);
  }, 60_000);

  it('undecodable Unix bytes in argv round-trip exactly', () => {
    de = installDirectEntry(h.home, { body: ECHO_BODY });
    const r = spawnSync('/bin/sh', ['-c', 'exec "$0" ws-reclaim "$(printf "\\377\\376")" "a$(printf "\\200")b" "$(printf "\\303\\251")"', de.entry],
      { cwd: h.home, env: { ...cleanEnv(), HOME: h.home, PATH: `${harnessBin()}:${process.env['PATH'] ?? ''}` } });
    expect(r.status, String(r.stderr)).toBe(0);
    const raw = fs.readFileSync(argvOut());
    const parts: Buffer[] = [];
    let at = 0;
    for (let i = 0; i < raw.length; i++) if (raw[i] === 0) { parts.push(raw.subarray(at, i)); at = i + 1; }
    expect(parts.slice(1).map((b) => b.toString('hex'))).toEqual(['ws-reclaim', '\xff\xfe', 'a\x80b', '\xc3\xa9']
      .map((s) => Buffer.from(s, 'latin1').toString('hex')));
  }, 60_000);

  it('absolute, relative, PATH and symlinked spellings converge on one launcher and one body', () => {
    de = installDirectEntry(h.home, { body: ECHO_BODY });
    const link = path.join(h.home, 'bin', 'ccd-alias');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(de.entry, link);
    const spellings: Array<[string, () => Ran]> = [
      ['absolute', () => direct(RECLAIM_ARGV)],
      ['relative', () => direct(RECLAIM_ARGV, {}, { entry: './.local/bin/ccd' })],
      ['PATH', () => {
        const r = spawnSync('/bin/sh', ['-c', 'exec ccd "$@"', 'sh', ...RECLAIM_ARGV], { cwd: h.home, encoding: 'utf8',
          env: { ...cleanEnv(), HOME: h.home, PATH: `${harnessBin()}:${process.env['PATH'] ?? ''}` } });
        return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
      }],
      ['symlink', () => direct(RECLAIM_ARGV, {}, { entry: link })],
    ];
    for (const [name, run] of spellings) {
      fs.rmSync(argvOut(), { force: true });
      const r = run();
      expect(r.code, `${name}: ${r.stderr}`).toBe(0);
      expect(echoed().flags, name).toContain('p');
      expect(echoed().argv, name).toEqual([...RECLAIM_ARGV]);
    }
  }, 60_000);

  it('a copy or a hard link of the launcher outside the installed layout refuses by name rather than guessing a body', () => {
    de = installDirectEntry(h.home, { body: ECHO_BODY });
    const copy = path.join(h.home, 'elsewhere', 'ccd');
    const hard = path.join(h.home, 'hardlinked', 'ccd');
    for (const p of [copy, hard]) fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.copyFileSync(de.entry, copy);
    fs.chmodSync(copy, 0o755);
    fs.linkSync(de.entry, hard);
    for (const p of [copy, hard]) {
      const r = direct(['caps'], {}, { entry: p });
      refusedBy(r, 'layout');
      expect(r.stderr).toContain(p);
    }
    expect(fs.existsSync(argvOut())).toBe(false);
  }, 60_000);

  it('the body must be present, a regular file, readable, and the one the launcher was rendered for', () => {
    const cases: Array<[string, string, () => void]> = [
      ['absent', 'body-absent', () => fs.rmSync(de.body)],
      ['a directory', 'body-type', () => { fs.rmSync(de.body); fs.mkdirSync(de.body); }],
      ['a symlink to identical bytes', 'body-type', () => {
        const real = `${de.body}.real`; fs.renameSync(de.body, real); fs.symlinkSync(real, de.body);
      }],
      ['one byte longer', 'body-digest', () => fs.appendFileSync(de.body, '\n')],
      ...(process.getuid?.() === 0 ? [] : [['unreadable', 'body-unreadable', () => fs.chmodSync(de.body, 0o000)] as [string, string, () => void]]),
    ];
    for (const [name, cls, spoil] of cases) {
      de = installDirectEntry(h.home, { body: ECHO_BODY });
      fs.rmSync(`${de.body}.real`, { force: true });
      fs.rmSync(argvOut(), { force: true });
      spoil();
      for (const argv of [RECLAIM_ARGV, ['caps'] as const]) refusedBy(direct(argv), cls);
      expect(fs.existsSync(argvOut()), `${name}: the body never ran`).toBe(false);
      fs.chmodSync(path.dirname(de.body), 0o755);
      try { fs.chmodSync(de.body, 0o644); } catch { /* absent or a link */ }
      fs.rmSync(de.body, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('the protected payload starts with no Bash startup state to hand on (D-3696, as tightened)', () => {
  const ENV_BODY = '#!/usr/bin/env bash\n{ printf "%s\\0" "$-"; printf "%s\\0" "$@"; } > "$HOME/argv-out"\nenv > "$HOME/env-out"\n';
  const HOSTILE_ALL = {
    BASH_ENV: '/nonexistent/bash-env', ENV: '/nonexistent/env', SHELLOPTS: 'xtrace', BASHOPTS: 'nocasematch',
    CDPATH: '/tmp', GLOBIGNORE: '*', 'BASH_FUNC_find%%': '() { :; }', KEEP_ME: 'ordinary',
  };
  const envKeys = (): string[] => fs.readFileSync(path.join(h.home, 'env-out'), 'utf8').split('\n')
    .map((l) => l.split('=')[0]!).filter(Boolean);

  it('a protected payload’s environment — and so every child it starts — carries none of it; an ordinary one keeps all of it', () => {
    de = installDirectEntry(h.home, { body: ENV_BODY });
    expect(direct(RECLAIM_ARGV, HOSTILE_ALL).code).toBe(0);
    const prot = envKeys();
    for (const k of ['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS', 'CDPATH', 'GLOBIGNORE']) expect(prot, k).not.toContain(k);
    expect(prot.filter((k) => k.startsWith('BASH_FUNC_'))).toEqual([]);
    expect(prot, 'an ordinary variable is untouched').toContain('KEEP_ME');
    // `env` itself ran under the inherited SHELLOPTS/BASHOPTS only for the
    // ORDINARY start, where they are the caller's business.
    expect(direct(['caps'], { ...HOSTILE_ALL, SHELLOPTS: '', BASHOPTS: '', GLOBIGNORE: '' }).code).toBe(0);
    const ord = envKeys();
    for (const k of ['BASH_ENV', 'ENV', 'CDPATH', 'KEEP_ME']) expect(ord, k).toContain(k);
    expect(ord.filter((k) => k.startsWith('BASH_FUNC_find'))).toHaveLength(1);
  }, 60_000);
});

describe('explicit Bash — outside the guarantee, and the body still never trusts a claim', () => {
  it('a clean explicit `bash ccd/ccd` with protected argv refuses at entry; a forged marker grants nothing', () => {
    for (const env of [{}, { CCD_ENTRY_PRIVILEGED: '1', CCD_LAUNCHER: '1', CCD_ENTRY: 'launcher', CCD_HARDENED: '1' }]) {
      for (const argv of [RECLAIM_ARGV, ['ws-audit', '--session', 'x', '--reclaim'] as const]) {
        const r = explicitBash([], argv, env);
        refusedBy(r, 'unprivileged');
      }
    }
  }, 60_000);

  it('an explicit bash that imports SHELLOPTS=privileged reports p — and still refuses, because its imported functions are seen', () => {
    const r = explicitBash([], RECLAIM_ARGV, { SHELLOPTS: 'privileged', 'BASH_FUNC_find%%': '() { :; }' });
    refusedBy(r, 'imported-functions');
  }, 60_000);

  it('an explicit `bash -p` passes the entry check and reaches the verb’s own parser (what the migrated explicit callers rely on)', () => {
    const r = explicitBash(['-p'], ['ws-reclaim']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toContain('usage: ccd ws-reclaim');
  }, 60_000);
});

// ── every supported production entry crosses the launcher (Task 5) ─────────
/** An echo body writing to an ABSOLUTE fixture path — never `$HOME`, because
 *  the server's own runner hands the child this test process's environment. */
const outBody = (out: string): string =>
  `#!/usr/bin/env bash\n{ printf "%s\\0" "$-"; printf "%s\\0" "\${BASH_VERSINFO[0]}.\${BASH_VERSINFO[1]}" "$BASH"; printf "%s\\0" "$@"; } > ${JSON.stringify(out)}\n`;
const readOut = (out: string): { flags: string; version: string; bash: string; argv: string[] } => {
  const parts = fs.readFileSync(out, 'utf8').split('\0');
  parts.pop();
  return { flags: parts[0] ?? '', version: parts[1] ?? '', bash: parts[2] ?? '', argv: parts.slice(3) };
};

describe('every supported production entry crosses the installed launcher', () => {
  const AUDIT_ARGV = ['ws-audit', '--session', 'demo-x', '--reclaim'];

  it('the server’s own local runner (realRunner, cfg.ccdBin = ~/.local/bin/ccd): protected argv starts privileged, ordinary does not', async () => {
    const out = path.join(h.home, 'runner-out');
    de = installDirectEntry(h.home, { body: outBody(out) });
    const { realRunner } = await import('../src/exec.js');
    for (const [argv, privileged] of [[RECLAIM_ARGV, true], [AUDIT_ARGV, true], [['caps'], false]] as const) {
      fs.rmSync(out, { force: true });
      const r = await realRunner(de.entry, [...argv]);
      expect(r.code, r.stderr).toBe(0);
      expect(readOut(out).flags.includes('p'), argv.join(' ')).toBe(privileged);
      expect(readOut(out).argv).toEqual([...argv]);
    }
  }, 60_000);

  it('the systemd unit’s ExecStart (`%h/.local/bin/ccd supervise %i`) execs the launcher — an ordinary start', () => {
    const out = path.join(h.home, 'unit-out');
    de = installDirectEntry(h.home, { body: outBody(out) });
    const unit = fs.readFileSync(path.resolve(__dirname, '../../ccd/claude-session@.service'), 'utf8');
    const exec = /^ExecStart=(.+)$/m.exec(unit)?.[1];
    expect(exec, 'the unit has no ExecStart').toBe('%h/.local/bin/ccd supervise %i');
    const [file, ...args] = exec!.replaceAll('%h', h.home).replaceAll('%i', 'demo-x').split(' ');
    const r = spawnSync(file!, args, { encoding: 'utf8', env: { ...cleanEnv(), HOME: h.home } });
    expect(r.status, r.stderr).toBe(0);
    expect(file).toBe(de.entry);
    expect(readOut(out)).toMatchObject({ argv: ['supervise', 'demo-x'] });
    expect(readOut(out).flags).not.toContain('p');
  }, 60_000);

  it('the launchd job’s ProgramArguments (ccd/ccd’s plist) exec the launcher — an ordinary start', () => {
    const out = path.join(h.home, 'plist-out');
    de = installDirectEntry(h.home, { body: outBody(out) });
    const src = fs.readFileSync(CCD, 'utf8');
    const block = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(src)?.[1] ?? '';
    const argv = [...block.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]!.replace('${HOME}', h.home).replace('${id}', 'demo-x'));
    expect(argv[0], 'the job does not exec the installed entry').toBe(de.entry);
    const r = spawnSync(argv[0]!, argv.slice(1), { encoding: 'utf8', env: { ...cleanEnv(), HOME: h.home } });
    expect(r.status, r.stderr).toBe(0);
    expect(readOut(out).argv).toEqual(['supervise', 'demo-x']);
    expect(readOut(out).flags).not.toContain('p');
  }, 60_000);

  it.runIf(process.platform === 'darwin')('DARWIN: a launchd-shaped PATH with /bin/bash 3.2 first — the later Homebrew bash is proved, chosen and the one that runs', () => {
    const out = path.join(h.home, 'darwin-out');
    de = installDirectEntry(h.home, { body: outBody(out) });
    const system = spawnSync('/bin/bash', ['-c', 'printf %s "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"'], { encoding: 'utf8' }).stdout;
    expect(system, 'this runner\'s /bin/bash is not the 3.2 a launchd PATH puts first — the row measures nothing').toBe('3.2');
    expect(REAL_BASH, 'no Bash >= 4.4 outside /bin on this runner').not.toBe('/bin/bash');
    const PATH = `/usr/bin:/bin:/usr/sbin:/sbin:${path.dirname(REAL_BASH)}`;
    for (const [argv, privileged] of [[RECLAIM_ARGV, true], [['caps'], false]] as const) {
      fs.rmSync(out, { force: true });
      const r = direct(argv, {}, { path: PATH });
      expect(r.code, r.stderr).toBe(0);
      const got = readOut(out);
      expect(fs.realpathSync(got.bash), 'the candidate that ran is not the eligible later one').toBe(REAL_BASH);
      expect(Number(got.version.split('.')[0]) * 100 + Number(got.version.split('.')[1]), got.version).toBeGreaterThanOrEqual(404);
      expect(got.flags.includes('p')).toBe(privileged);
    }
  }, 60_000);
});

// ── fail-shut external commands (Task 5) ──────────────────────────────────
// TRUST-BOUNDARY CONTROLS, labelled as such: these PATH executables are
// faithful to the box except that they FAIL — a decision-critical command that
// could not answer. A failure is unmeasured, never an empty answer, and nothing
// is removed.
describe('a decision-critical command that fails is unmeasured, never empty — the child survives', () => {
  const REAL = (cmd: string): string => spawnSync('bash', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).stdout.trim();
  const failing: Record<string, () => string> = {
    'find, on the registry enumeration': () => `#!/bin/sh\ncase "$*" in *.workdir*) echo "find: '$HOME/.cc-sessions': Permission denied" >&2; exit 1 ;; esac\nexec ${REAL('find')} "$@"\n`,
    'git, on the worktree list': () => `#!/bin/sh\ncase "$*" in *"worktree list"*) echo "fatal: unable to read worktrees" >&2; exit 128 ;; esac\nexec ${REAL('git')} "$@"\n`,
  };
  for (const [name, stub] of Object.entries(failing)) {
    itLinux(`${name}: the direct audit answers unmeasured with no token, and the direct reclaim fails and removes nothing`, () => {
      const c = setup();
      const { doc: clean } = audit();
      expect(clean['verdict']).toBe('reclaimable');
      const cmd = name.split(',')[0]!;
      fs.writeFileSync(path.join(h.home, '.local', 'bin', cmd), stub(), { mode: 0o755 });
      const { r, doc } = audit();
      expect(r.code, `${r.stdout}${r.stderr}`).toBe(1);
      expect(doc['verdict']).toBe('unmeasured');
      expect(doc['token']).toBeUndefined();
      const v = reclaim(String(clean['token']));
      intact(c, []);
      expect(v.code, `${v.stdout}${v.stderr}`).toBe(1);
      expect(docOf(v)['failed'], `${v.stdout}`).toBe('probe-unmeasured');
    }, 180_000);
  }
});
