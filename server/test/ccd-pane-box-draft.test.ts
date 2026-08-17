/**
 * ONE reader for the input box's own row, so ccd's two injectors cannot drift
 * from each other or from `draftOf` (server/src/inject/send.ts).
 *
 * Both guards read the FIRST `❯` line with a PLAIN space today. Measured on
 * this box, that is wrong in both directions: it returns a scrollback turn
 * (`❯ /compact`) while the real box is empty — failing shut, skipping a
 * legitimate compact — and it returns NOTHING while the box row is `❯` +
 * U+00A0 + text, which is failing OPEN, i.e. typing a slash command on top of
 * somebody's draft.
 *
 * The NBSP is not a guess: `send.test.ts`'s LIVE_CU_FRAMES is a verbatim
 * `capture-pane -e` of a real TYPED draft and its box row is
 * `'\x1b[39m❯\xa0AAA first line'`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
// `server/package.json` is `"type":"module"`, so `require` is NOT defined in
// this scope — a CommonJS read here throws ReferenceError and the mutation
// guard at the bottom of this file asserts nothing at all.
import { readFileSync } from 'node:fs';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-box-draft-'); });
afterEach(() => { h.cleanup(); });

/** U+00A0. Spelled as an escape, not as a literal, so the byte under test
 *  survives every editor and diff viewer this file passes through. */
const NBSP = '\u00a0';

/** Runs `_pane_box_draft` over a pane and returns exactly what it echoed. */
const draft = (pane: string): string => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; _pane_box_draft "$1"`, 'bash', pane], {
    encoding: 'utf8', cwd: h.home, timeout: 15000,
    // BOTH poisons. This snippet sources ccd, so it can reach
    // `_have_systemctl`/`_supervised_start`, and `ccd-workspaces.test.ts`'s
    // source scan is what makes that a property of every ccd test file rather
    // than a rule each one remembers.
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true }),
  });
  expect(r.status, r.stderr ?? '').toBe(0);
  return (r.stdout ?? '').replace(/\n$/, '');
};

const pane = (boxRows: string[]): string =>
  ['earlier turn', `❯ an older submitted turn`, '● a reply', '─'.repeat(24),
    ...boxRows, '─'.repeat(24), '  👤 team·max'].join('\n') + '\n';

describe('_pane_box_draft', () => {
  it('reads the LAST marker line, not the first — a scrollback turn is not the box', () => {
    // The measured failure: `grep -m1` returned `/compact` from the scrollback
    // while the box was empty, so auto-compact skipped a session forever.
    expect(draft(pane([`❯${NBSP}`]))).toBe('');
  });

  it('accepts U+00A0 as the separator — the byte a real typed draft actually carries', () => {
    expect(draft(pane([`❯${NBSP}fix the flaky test`]))).toBe('fix the flaky test');
  });

  it('still accepts a plain space', () => {
    expect(draft(pane(['❯ fix the flaky test']))).toBe('fix the flaky test');
  });

  it('trims trailing whitespace, as the guards it replaces did', () => {
    expect(draft(pane([`❯${NBSP}half a thought   `]))).toBe('half a thought');
  });

  it('reads nothing from a pane with no box at all', () => {
    expect(draft('just some output\nno marker here\n')).toBe('');
  });

  // The separator is stripped as the WHOLE two-byte NBSP or a whole space, not
  // as a byte class over {0x20,0xc2,0xa0}: a byte class eats the 0xc2 LEAD BYTE
  // of any Latin-1-supplement character the draft happens to start with, and
  // hands the caller a mojibake fragment of the operator's own text.
  it('does not eat the lead byte of a draft that starts with a two-byte character', () => {
    expect(draft(pane([`❯${NBSP}£5 is the budget`]))).toBe('£5 is the budget');
    expect(draft(pane(['❯ ¡ojo! check the staging deploy']))).toBe('¡ojo! check the staging deploy');
  });

  // The mutation table: reinstating either half of the old rule reds a test
  // above. `grep -m1` reds test 1; a plain-space-only separator reds test 2.
  it('is the ONLY box-row reader left in ccd — no inline grep survives', () => {
    const src = readFileSync(CCD, 'utf8');
    expect(src.match(/grep -m1 "\^❯ "/g), 'an inline box-row grep is back').toBeNull();
    expect((src.match(/_pane_box_draft\(\)/g) ?? []).length).toBe(1);
  });
});
