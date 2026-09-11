import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD } from './ccdWsHelpers.js';
import { AUTO_CONTINUE_RE, autoContinueArmed } from '../src/pane/dialog.js';

/** ccd's `_pane_auto_continue_armed` is `grep -qiE "<literal>"`; this reads the
 *  literal off that line. Bash cannot import TS, so there are two copies by
 *  construction and this test is the mechanism that keeps them one. */
const ccdLiteral = (): string => {
  const lines = readFileSync(CCD, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith('_pane_auto_continue_armed()'));
  if (i < 0) throw new Error('_pane_auto_continue_armed not found in ccd/ccd');
  const m = /grep -qiE "([^"]+)"/.exec(lines.slice(i, i + 8).join('\n'));
  if (!m) throw new Error('no grep -qiE literal inside _pane_auto_continue_armed');
  return m[1]!;
};

describe('autoContinueArmed is ccd\'s _pane_auto_continue_armed, verbatim (D-2367)', () => {
  it("the server's regex source is ccd's literal, case-insensitive on both sides", () => {
    expect(AUTO_CONTINUE_RE.source).toBe(ccdLiteral());
    expect(AUTO_CONTINUE_RE.flags).toContain('i');
  });
  it.each([
    ['Usage limit reached · continuing automatically at 11:50am · esc or type to cancel', true],
    ['Usage limit reached · continuing shortly · esc to cancel', true],
    ['Usage limit reached · Continuing automatically at 11:50am', true],
    ["You've hit your session limit · resets 11:50am (UTC)", false],
    ['Your usage limit has reset · press enter to continue', false],
    ['? for shortcuts\n❯ ', false],
  ])('%s -> %s', (pane, armed) => { expect(autoContinueArmed(pane)).toBe(armed); });
});
