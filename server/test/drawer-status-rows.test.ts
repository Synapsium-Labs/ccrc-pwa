// TMUX_STATUS_ROWS pins the one row tmux's status line takes from every
// attached client. A tmux client of R rows views a window of R − 1 rows while
// the status line is on (one row), so the drawer attaches a client of
// PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS rows (220x51) to be exactly the
// window's size and leave tmux nothing to pan (spec
// docs/superpowers/specs/2026-10-14-terminal-drawer-every-width-design.md §5.1,
// D-5005). That arithmetic is only true while ccd/tmux.conf leaves tmux's
// default single status line, so this test reds the day it turns the line off
// or makes it multi-line.
//
// RED FIRST, reconstructed from git at stage close (2026-10-15: this file at
// Task 2's commit, run against shared/api.ts as that commit's parent had it):
// 1 of 8 failed, the is-exactly-1 case. The other seven hold the regex to
// fixture text, which no change to shared/api.ts can fail.
//
// MUTATION TABLE (plan Task 2 Step 4; RUN 2026-10-15 at stage close on an
// isolated copy of the branch: each mutant applied, the named suites run
// alone, the file restored and compared byte for byte). Every row went RED:
//   TMUX_STATUS_ROWS = 0 ...................... is-exactly-1, and drawer-window-sized-client's (a), (b) and (c) on real tmux
//   a scratch tmux.conf with `status off` ..... the tmux.conf case
//   the regex without [2-5] ................... the status-2 case, and the leading-spaces case (status 5)
//   the regex without its ^\s* anchor ......... the commented-out-line case
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TMUX_STATUS_ROWS } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TMUX_CONF = path.resolve(here, '..', '..', 'ccd', 'tmux.conf');

// Catches an uncommented `set`/`set-option` line that sets `status` to `off`
// or to `2`–`5`: both depart from tmux's default single status line, so both
// would make TMUX_STATUS_ROWS wrong (the constant is true only while the file
// leaves that default in place).
const NON_DEFAULT_STATUS = /^\s*set(-option)?\s+(-\w+\s+)*status\s+(off|[2-5])\b/m;

describe('TMUX_STATUS_ROWS', () => {
  it('is exactly 1', () => {
    expect(TMUX_STATUS_ROWS).toBe(1);
  });

  it('ccd/tmux.conf leaves tmux\'s default single status line', () => {
    const text = readFileSync(TMUX_CONF, 'utf8');
    expect(text, `ccd/tmux.conf must be the real file (contains default-terminal); ` +
      `if it ever sets status off or multi-line, TMUX_STATUS_ROWS would be wrong`)
      .toContain('default-terminal');
    expect(text, `ccd/tmux.conf must not turn the status line off or make it ` +
      `multi-line, or TMUX_STATUS_ROWS would be wrong`)
      .not.toMatch(NON_DEFAULT_STATUS);
  });

  it('the regex matches a status-off line', () => {
    expect(NON_DEFAULT_STATUS.test('set -g status off'), 'fixture: "set -g status off"')
      .toBe(true);
  });

  it('the regex matches a multi-line status line', () => {
    expect(NON_DEFAULT_STATUS.test('set-option -g status 2'), 'fixture: "set-option -g status 2"')
      .toBe(true);
  });

  it('the regex does not match status-style', () => {
    expect(NON_DEFAULT_STATUS.test('set -g status-style bg=black'), 'fixture: "set -g status-style bg=black"')
      .toBe(false);
  });

  it('the regex does not match a commented-out line', () => {
    expect(NON_DEFAULT_STATUS.test('# set -g status off'), 'fixture: "# set -g status off"')
      .toBe(false);
  });

  it('the regex matches a line with leading spaces', () => {
    expect(NON_DEFAULT_STATUS.test('  set -g status 5'), 'fixture: "  set -g status 5"')
      .toBe(true);
  });

  it('the regex does not match status on', () => {
    expect(NON_DEFAULT_STATUS.test('set -g status on'), 'fixture: "set -g status on"')
      .toBe(false);
  });
});
