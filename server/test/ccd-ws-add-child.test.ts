// `ccd ws-add --child <runId>` (child-workspace reclamation, spec §5.1, wave 1).
//
// The flag is the box half of the two authorities that make a workspace a
// CHILD: `cmd_ws_add` strips it in the same loop as `--no-rc`/`--surface`/
// `--actor`/`--route`, refuses anything that is not a run id before a worktree,
// a row or a pane exists, and stamps `$REG/<id>.child` before the first spawn
// so `_spawn_start` already contains that pane (`ccd-child-tmpdir.test.ts`).
//
// Fixture HOMEs only (`makeCcdHarness`); `WS_ADD_REAL_SPAWN` keeps
// `_spawn_start` real and records `tmux` instead of running it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, WS_ADD_REAL_SPAWN, type CcdHarness } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-ws-add-child-'); h.makeRepo('demo'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
/** `ccd-lifecycle-sites.test.ts`'s spelling: macOS ships coreutils' `timeout` as `gtimeout`. */
const TIMEOUT_BIN = process.platform === 'darwin' ? 'gtimeout' : 'timeout';

/** `ccd-route-argv.test.ts`'s `shStatus`: status and both streams, with an
 *  optional wall clock for the one case that is about the loop terminating. */
const shStatus = (snippet: string, boundSec?: number, env: NodeJS.ProcessEnv = {}): { status: number; out: string } => {
  const bash = ['bash', '-c', `source "${CCD}"; exec 2>&1; ${snippet}`];
  const argv = boundSec === undefined ? bash : [TIMEOUT_BIN, String(boundSec), ...bash];
  try {
    const out = execFileSync(argv[0]!, argv.slice(1),
      { encoding: 'utf8', cwd: h.home,
        env: ghContainedEnv(h.home, { ...process.env, HOME: h.home, ...env }, { systemd: true, tmux: true }) });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

const wsAdd = (args: string): { status: number; out: string } =>
  shStatus(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add ${args}`, 30);
const newSessions = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));
const nothingCreated = (): void => {
  expect(h.reg(ID, 'uuid'), 'the refusal must precede the registry row').toBeNull();
  expect(h.reg(ID, 'child'), 'and the marker').toBeNull();
  expect(fs.existsSync(path.join(h.home, 'worktrees', 'demo')), 'and the worktree').toBe(false);
  expect(newSessions(), 'and the pane').toEqual([]);
};

describe('--child on ws-add writes the marker the first spawn reads', () => {
  it('ws-add --no-rc --child 7 demo: the marker holds the run id, and the first pane is contained', () => {
    const r = wsAdd('--no-rc --child 7 demo');
    expect(r.status, r.out).toBe(0);
    expect(h.reg(ID, 'child')).toBe('7');
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', `${ID}.child`), 'utf8'),
      'the run id and nothing else — no newline a string-exact reader would trip on').toBe('7');
    expect(h.reg(ID, 'rc'), '--no-rc still means what it meant').toBe('off');
    expect(newSessions()).toHaveLength(1);
    expect(newSessions()[0]).toContain(`TMPDIR='${path.join(h.home, '.cc-tmp', ID)}'`);
  });

  it('the equals form binds the same value', () => {
    expect(wsAdd('--no-rc --child=42 demo').status).toBe(0);
    expect(h.reg(ID, 'child')).toBe('42');
  });

  it('--child AFTER the positional binds the same row — the strip loop is positionless (D-410)', () => {
    const r = wsAdd(`--no-rc demo --child 7 --surface agent --actor 'run:7 dispatch'`);
    expect(r.status, r.out).toBe(0);
    expect(h.reg(ID, 'child')).toBe('7');
    expect(h.reg(ID, 'project')).toBe('demo');
    expect(h.reg(ID, 'workspace')).toBe('quiet-mesa');
  });

  it('WITHOUT --child there is no marker and no TMPDIR — every workspace minted before this is not a child', () => {
    const r = wsAdd('--no-rc demo');
    expect(r.status, r.out).toBe(0);
    expect(h.reg(ID, 'child')).toBeNull();
    expect(newSessions()[0]).not.toContain('TMPDIR=');
  });
});

describe('--child refuses anything but a run id, before anything exists', () => {
  it('as the FINAL token it refuses with the usage line rather than hanging', () => {
    const r = wsAdd('--no-rc demo --child');
    expect(r.status, 'a valueless --child never terminated — the arity check is gone').not.toBe(124);
    expect(r.status).toBe(1);
    expect(r.out).toContain('usage: ccd ws-add [--no-rc] [--child <runId>]');
    nothingCreated();
  });

  it.each([
    ['abc'], ['0'], ['07'], ['-1'], ['+7'], ['7x'], ['12345678901'], [''], ['7 8'],
  ])('refuses %j with the run-id sentence and leaves the box as it found it', (bad) => {
    const r = wsAdd(`--no-rc --child '${bad}' demo`);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(`ccd: --child needs a run id (a positive integer), got: ${bad}`);
    nothingCreated();
  });

  it('accepts the largest ten-digit id — the bound is on length, not on a guessed maximum', () => {
    expect(wsAdd('--no-rc --child 9999999999 demo').status).toBe(0);
    expect(h.reg(ID, 'child')).toBe('9999999999');
  });
});

/** A UTF-8 locale on this box in which bash's `[1-9]` range admits `²` — found
 *  by MEASURING that property, never by name (`pool-tag-parity.test.ts`'s rule:
 *  `C.utf8` collates by codepoint and could not show the defect). The probe
 *  runs no ccd, but it is a bash spawn in a `ccd-*` file, so it goes through
 *  `ghContainedEnv` like every other (`ccd-workspaces.test.ts`'s scan), under a
 *  throwaway HOME of its own because no harness exists yet at module scope. */
const PROBE_HOME = mkTmp('ccrc-child-locale-probe-');
const WIDE_DIGIT_LOCALE: string | null = (() => {
  let list: string[] = [];
  try {
    list = execFileSync('locale', ['-a'], { encoding: 'utf8' })
      .split('\n').map((l) => l.trim()).filter((l) => /utf-?8$/i.test(l));
  } catch { return null; }
  for (const loc of list) {
    try {
      const out = execFileSync('bash', ['-c', '[[ "²" =~ ^[1-9]$ ]] && echo yes || echo no'],
        { encoding: 'utf8', cwd: PROBE_HOME,
          env: ghContainedEnv(PROBE_HOME, { ...process.env, HOME: PROBE_HOME, LC_ALL: loc }, { systemd: true, tmux: true }) }).trim();
      if (out === 'yes') return loc;
    } catch { /* this locale is unusable for the probe; try the next */ }
  }
  return null;
})();

describe('the run-id grammar is ASCII in every locale (D-2522\'s shape)', () => {
  it('is spelled ONCE in ccd/ccd — every run-id parse calls _child_runid_valid', () => {
    // Wave 3's `--child-of` parse and its marker reads call the helper; none
    // re-spells the pattern, whose ten-digit bound `{0,9}` is its fingerprint.
    // A second spelling would be a second grammar free to drift — and the
    // first place it would drift is the `LC_ALL=C` shadow above.
    const code = fs.readFileSync(CCD, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l));
    const spelled = code.filter((l) => l.includes('[0-9]{0,9}'));
    expect(spelled, 'the run-id pattern must be spelled exactly once — in _child_runid_valid').toHaveLength(1);
    expect(spelled[0]).toMatch(/^_child_runid_valid\(\) \{/);
  });

  it.skipIf(WIDE_DIGIT_LOCALE === null)('refuses a superscript digit under a locale whose ranges admit it', () => {
    const r = shStatus(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --child '1²' demo`,
      30, { LC_ALL: WIDE_DIGIT_LOCALE! });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('--child needs a run id');
    nothingCreated();
  });
});

describe('the marker is loud when it cannot land, and dies with the row', () => {
  it('a marker write that fails WARNS and still spawns — the workspace is simply not a child', () => {
    const r = shStatus(`${WS_ADD_REAL_SPAWN}
      eval "$(declare -f _reg_set | sed '1s/^_reg_set/_reg_set_real/')"
      _reg_set() { [[ "$2" == child ]] && return 1; _reg_set_real "$@"; }
      CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --child 7 demo`, 30);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`ccd: warn: could not write ${path.join(h.home, '.cc-sessions', `${ID}.child`)}`);
    expect(h.reg(ID, 'child')).toBeNull();
    expect(h.reg(ID, 'uuid'), 'the workspace was still created').not.toBeNull();
    expect(newSessions()[0], 'and, being no child, it is not contained').not.toContain('TMPDIR=');
  });

  it('_reg_purge takes the marker with the rest of the row — measured on the file, not the inventory', () => {
    expect(wsAdd('--no-rc --child 7 demo').status).toBe(0);
    expect(h.reg(ID, 'child')).toBe('7');
    h.sh(`_reg_purge ${ID}`);
    expect(h.reg(ID, 'child')).toBeNull();
    expect(h.reg(ID, 'uuid')).toBeNull();
  });

  it('cmd_caps advertises child-argv-v1', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain('child-argv-v1');
  });
});
