// Two check-then-write sites in ccd/session-hook.sh, raced (D-7503).
//
// THE HISTORY SPOOL'S APPEND. The drain renames `<id>.jsonl` away every tick and the next hook creates it again, so the
// path moves both ways, regular to absent and absent to regular. A guard that probes "absent or regular" with two `stat`s
// can see each half of a move and refuse a plain append in either probe order, and the line is lost. The shipped append
// refuses only a POSITIVE non-regular type at the path, opens the file once for append, and writes only through that
// descriptor, after checking the descriptor is a regular file and the path is not a link.
//
// THE JOIN FILE'S ROTATION TARGET. `<id>.joinedprev` moves absent to regular (a rotation's `mv -f`) and regular to absent
// (a purge's `rm -f`). Its two guards in `_hook_join_record` refuse only a positive non-regular type, as the entry guard
// on `<id>.joined` already does (D-5434), so no move between absent and regular stops a rotation.
//
// Every bash run here is a FIXED driver script written to a fixture directory; paths and counts reach it as arguments.
// The statement under test is read out of the shipped hook and written into the driver's text, never a path or an env value.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const SRC = (): string => fs.readFileSync(HOOK, 'utf8');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const ID = 'demo-quiet-basin';
const SID = '7d0c3f5e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

/** The history spool block's one append line: the trimmed line of the block that starts `[[` and names `$_hs_p`. */
const historyAppendLine = (): string => {
  const src = SRC();
  const block = src.slice(src.indexOf('# >>> history-spool (spec 2026-10-05 §5.1)'), src.indexOf('# <<< history-spool'));
  const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('[[') && l.includes('"$_hs_p"'));
  expect(lines, 'one append line in the history spool block').toHaveLength(1);
  return lines[0]!;
};
/** The leading `[[ … ]]` of an append line: the guard its write waits on. */
const leadingGuard = (line: string): string => {
  const m = /^\[\[ .*? \]\]/.exec(line);
  expect(m, 'the append line opens with a [[ guard').not.toBeNull();
  return m![0];
};
/** The append's guard on main before D-7503, and the same with its two probes swapped (absence first, as D-7448 did for
 *  the delegation spool): the two controls. */
const OLD_GUARD = '[[ ! -L "$_hs_p" && ( -f "$_hs_p" || ! -e "$_hs_p" ) ]]';
const SWAPPED_GUARD = '[[ ! -L "$_hs_p" && ( ! -e "$_hs_p" || -f "$_hs_p" ) ]]';

/** Every `[[ … ]]` in `_hook_join_record` that names `$jp`. */
const joinPrevGuards = (): string[] => {
  const src = SRC();
  const start = src.indexOf('_hook_join_record() {');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  return [...body.matchAll(/\[\[ [^\]]*"\$jp"[^\]]*\]\]/g)].map((m) => m[0]);
};
const OLD_JP_GUARDS = ['[[ ! -L "$jp" && ( -f "$jp" || ! -e "$jp" ) ]]', '[[ ! -L "$jf" && ! -L "$jp" && ( -f "$jp" || ! -e "$jp" ) ]]'];

let dir: string;
beforeEach(() => { dir = mkTmp('ccrc-hookrace-'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** Write a fixed driver and run it with `args`. */
const drive = (name: string, text: string, args: string[], timeout = 90_000): string => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, text, { mode: 0o755 });
  return execFileSync('bash', [f, ...args], { encoding: 'utf8', timeout });
};

describe('the history spool append under a drain that renames the file away (D-7503)', () => {
  /** A drain renames the spool file to a fresh drained name, `n` times, and a sibling hook creates the file again whenever
   *  it is absent, so the path moves both ways under the appender: regular to absent (the drain) and absent to regular
   *  (the sibling). In `guard` mode the appender spins on `code` alone and counts each false evaluation, a refused append.
   *  In `append` mode it runs `code` as the whole statement with a numbered `$_hs`; every line written lands in the spool
   *  file or a drained one, so the lines missing from all of them are the appends the statement refused. */
  const race = (mode: 'guard' | 'append', code: string, n: number): { ran: number; refused: number; found: number } => {
    const work = path.join(dir, `race-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(work);
    const driver = [
      '#!/usr/bin/env bash',
      '# $1 the work directory, $2 the number of drains',
      '_hs_p="$1/s.jsonl" n=$2 stop="$1/.stop"',
      '( for ((k = 0; k < n; k++)); do mv -f "$_hs_p" "$1/drained.$k" 2>/dev/null; done; : > "$stop" ) &',
      '( until [[ -e "$stop" ]]; do [[ -e "$_hs_p" ]] || : >> "$_hs_p"; done ) &',
      'i=0 refused=0',
      'until [[ -e "$stop" ]]; do',
      '  i=$((i + 1)); _hs="L$i"',
      mode === 'guard' ? `  ${code} || refused=$((refused + 1))` : `  ${code}`,
      'done',
      'wait',
      'printf \'%s %s\\n\' "$i" "$refused"',
      '',
    ].join('\n');
    const [ran, refused] = drive('history-race.sh', driver, [work, String(n)]).trim().split(' ').map(Number);
    let found = 0;
    for (const f of fs.readdirSync(work)) {
      if (f === '.stop') continue;
      found += fs.readFileSync(path.join(work, f), 'utf8').split('\n').filter((l) => /^L\d+$/.test(l)).length;
    }
    return { ran: ran!, refused: refused!, found };
  };

  it('control: the guard on main refuses appends while the drain renames, and so does the same guard with its probes swapped', () => {
    expect(race('guard', OLD_GUARD, 800).refused, 'the old order refuses a file a sibling is creating').toBeGreaterThan(0);
    expect(race('guard', SWAPPED_GUARD, 800).refused, 'absence first is not enough: the drain moves the file the other way').toBeGreaterThan(0);
  }, 180_000);

  it('the shipped guard never refuses a spool file that is only moving between absent and a regular file', () => {
    const r = race('guard', leadingGuard(historyAppendLine()), 600);
    expect(r.ran, 'the checker ran').toBeGreaterThan(0);
    expect(r.refused).toBe(0);
  }, 180_000);

  it('the shipped append loses no line while the drain renames the file away and a sibling creates it', () => {
    const r = race('append', historyAppendLine(), 600);
    expect(r.ran, 'the appender ran').toBeGreaterThan(0);
    expect(r.found, 'every append landed in the spool file or a drained one').toBe(r.ran);
  }, 180_000);
});

describe('the history spool append writes only through the descriptor it opened (D-7503)', () => {
  let home: string;
  beforeEach(() => {
    home = mkTmp('ccrc-hookrace-home-');
    fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), GENERATION);
    fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
    fs.mkdirSync(path.join(home, '.ccrc', 'history', 'spool'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(spool(), '');
  });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });
  const spool = (): string => path.join(home, '.ccrc', 'history', 'spool', `${ID}.jsonl`);

  /** A BASH_ENV whose DEBUG trap acts once, on the first command after the spool guard (the first command naming
   *  `-L "$_hs_p"`): `link` puts a symlink to T_OUT at the spool path, `drain` renames the spool file to T_OUT. */
  const TRAP = [
    '_t_s=0 _t_n=\'-L "$_hs_p"\'',
    'trap \'case $_t_s in',
    '  0) [[ $BASH_COMMAND == *"$_t_n"* ]] && _t_s=1 ;;',
    '  1) _t_s=2',
    '     case $T_MODE in',
    '       link) rm -f -- "$T_SPOOL"; ln -s -- "$T_OUT" "$T_SPOOL" ;;',
    '       drain) mv -f -- "$T_SPOOL" "$T_OUT" ;;',
    '     esac ;;',
    'esac\' DEBUG',
    '',
  ].join('\n');
  const runWithTrap = (mode: 'link' | 'drain', out: string): void => {
    const trap = path.join(home, 'swap-trap.bash');
    fs.writeFileSync(trap, TRAP);
    const r = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ hook_event_name: 'Stop', session_id: SID }), encoding: 'utf8',
      env: {
        ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
        TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
        CLAUDE_JOB_DIR: '', TMUX: '', CLAUDE_CONFIG_DIR: '', CLAUDECODE: '',
        BASH_ENV: trap, T_MODE: mode, T_SPOOL: spool(), T_OUT: out,
      },
    });
    expect(r.status, 'the hook exits 0').toBe(0);
    expect(r.stderr, 'the hook is silent').toBe('');
  };

  it('control: with no swap the trap leaves the line in the spool file', () => {
    const r = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ hook_event_name: 'Stop', session_id: SID }), encoding: 'utf8',
      env: {
        ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
        TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
        CLAUDE_JOB_DIR: '', TMUX: '', CLAUDE_CONFIG_DIR: '', CLAUDECODE: '',
      },
    });
    expect(r.status).toBe(0);
    expect(fs.readFileSync(spool(), 'utf8')).toMatch(/"ev":"Stop"/);
  });

  it('a symlink swapped in after the guard never receives the line: its target stays byte-identical', () => {
    const outside = path.join(home, 'outside.txt');
    fs.writeFileSync(outside, 'outside\n');
    runWithTrap('link', outside);
    expect(fs.lstatSync(spool()).isSymbolicLink(), 'the swap happened').toBe(true);
    expect(fs.readFileSync(outside, 'utf8')).toBe('outside\n');
  });

  it('a drain that renames the file after the guard gets the line in the renamed file, and no new spool file is made', () => {
    const drained = path.join(home, '.ccrc', 'history', 'spool', `${ID}.jsonl.draining`);
    runWithTrap('drain', drained);
    expect(fs.readFileSync(drained, 'utf8')).toMatch(/"ev":"Stop"/);
    expect(fs.existsSync(spool()), 'the line went through the descriptor opened before the rename').toBe(false);
  });
});

describe('the join file\'s rotation target guards under a target that is renamed in and purged (D-7503)', () => {
  /** A toggler moves `jp` absent to regular (`mv -f`, a rotation) and back (`rm -f`, a purge), `n` times, while a
   *  checker evaluates `expr` with `jf` a standing regular file. Every false evaluation is a rotation refused. */
  const race = (expr: string, n: number): { refused: number; ran: number } => {
    const work = path.join(dir, `jrace-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(work);
    const driver = [
      '#!/usr/bin/env bash',
      '# $1 the work directory, $2 the number of moves each way',
      'jf="$1/x.joined" jp="$1/x.joinedprev" n=$2 stop="$1/.stop"',
      ': > "$jf"',
      '( for ((k = 0; k < n; k++)); do : > "$1/t"; mv -f "$1/t" "$jp"; rm -f "$jp"; done; : > "$stop" ) &',
      'refused=0 ran=0',
      'until [[ -e "$stop" ]]; do',
      '  ran=$((ran + 1))',
      `  ${expr} || refused=$((refused + 1))`,
      'done',
      'wait',
      'printf \'%s %s\\n\' "$refused" "$ran"',
      '',
    ].join('\n');
    const [refused, ran] = drive('join-race.sh', driver, [work, String(n)]).trim().split(' ').map(Number);
    return { refused: refused!, ran: ran! };
  };

  it('control: the guards on main refuse a rotation while the target is renamed in and purged', () => {
    for (const g of OLD_JP_GUARDS) expect(race(g, 400).refused, g).toBeGreaterThan(0);
  }, 180_000);

  it('the shipped guards never refuse a target that is only moving between absent and a regular file', () => {
    const guards = joinPrevGuards();
    expect(guards, 'two guards name joinedprev: before the open and before the rename').toHaveLength(2);
    for (const g of guards) {
      const r = race(g, 300);
      expect(r.ran, g).toBeGreaterThan(0);
      expect(r.refused, g).toBe(0);
    }
  }, 180_000);

  it('the shipped guards still refuse a symlink (live or dangling), a directory or a FIFO at the target, and pass absent or regular', () => {
    const driver = [
      '#!/usr/bin/env bash',
      '# $1 the work directory, $2 the node to plant at the target',
      'jf="$1/x.joined" jp="$1/x.joinedprev"',
      ': > "$jf"; rm -rf "$jp"',
      'case $2 in',
      '  regular) : > "$jp" ;;',
      '  link) : > "$1/target"; ln -s "$1/target" "$jp" ;;',
      '  dangling) ln -s "$1/nowhere" "$jp" ;;',
      '  dir) mkdir "$jp" ;;',
      '  fifo) mkfifo "$jp" ;;',
      'esac',
      ...joinPrevGuards().map((g) => `if ${g}; then printf 'pass\\n'; else printf 'refuse\\n'; fi`),
      '',
    ].join('\n');
    const work = path.join(dir, 'types');
    fs.mkdirSync(work);
    const verdict = (node: string): string[] => drive('join-types.sh', driver, [work, node]).trim().split('\n');
    expect(verdict('absent')).toEqual(['pass', 'pass']);
    expect(verdict('regular')).toEqual(['pass', 'pass']);
    for (const node of ['link', 'dangling', 'dir', 'fifo']) expect(verdict(node), node).toEqual(['refuse', 'refuse']);
  });
});
