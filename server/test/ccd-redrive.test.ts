import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-redrive-'); });
afterEach(() => { h.cleanup(); });

/** tmux, RECORDING: `capture-pane` answers `$PANE_TEXT`, everything else is logged. */
const STUBS = `sleep() { :; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls";
    case "\${1:-}" in capture-pane) printf '%s\\n' "\${PANE_TEXT:-}" ;; esac; return 0; };
  _pane_box_draft() { printf '%s' "\${BOX_DRAFT:-}"; };`;
const sendKeys = (): string[] => h.calls().filter((l) => l.includes('send-keys'));
const READY = '? for shortcuts\n❯ ';
const ARMED = 'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel\n❯ ';

describe('_inject_spawn_effort stands down on an armed auto-continue (D-2229)', () => {
  it('types nothing into a session waiting out a limit', () => {
    h.sh(`${STUBS} _inject_spawn_effort cc-test`, { PANE_TEXT: ARMED });
    expect(sendKeys()).toEqual([]);
  });
  it('control: a ready pane gets /effort', () => {
    h.sh(`${STUBS} _inject_spawn_effort cc-test`, { PANE_TEXT: READY });
    expect(sendKeys().some((k) => k.includes('-l /effort'))).toBe(true);
  });
});

describe('_pane_auto_continue_armed', () => {
  it.each([
    ['continuing automatically at 11:50am', true],
    ['Usage limit reached · continuing shortly · esc to cancel', true],
    ['Usage limit reached · continuing automatically when it resets · esc to cancel', true],
    ["You've hit your session limit · resets 11:50am (UTC)", false],
    ['? for shortcuts', false],
  ])('%s -> %s', (pane, armed) => {
    const out = h.sh(`_pane_auto_continue_armed ${JSON.stringify(pane)} && echo yes || echo no`);
    expect(out).toBe(armed ? 'yes' : 'no');
  });
});
