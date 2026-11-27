// `_pane_unicode_env` (ccd/ccd) -- the pane's symbol set on a box whose terminal Claude Code does not recognise.
//
// Claude Code picks its TUI symbols with `is-unicode-supported`, which on win32 answers yes only for a terminal it
// knows by environment (WT_SESSION, TERM=xterm-256color, ...) and never for a tmux pane. On an MSYS2 box every pane
// therefore drew the ASCII fallbacks -- `>` for the prompt and menu cursor, a check mark as a square root -- while
// every pane reader in this tree keys on U+276F and `pane-glyph.test.ts` pins `>` as NOT the glyph. Measured on a
// private tmux socket with the same Claude Code build: `> 2. Dark mode` plain, the real glyph with
// `TERMINUS_SUBLIME=1`, the one variable of that list Claude Code reads nowhere else.
//
// So the fix is the PANE, not the reader: both spawn lines splice `$resenv`, and `$resenv` carries this function's
// answer. Off Windows it answers nothing and the spawn line is byte-identical.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, CCD } from './ccdWsHelpers.js';

const h = makeCcdHarness('ccrc-paneuni-');
const ask = (ostype: string): string => h.sh(`OSTYPE=${ostype}; printf '[%s]' "$(_pane_unicode_env)"`);

describe('_pane_unicode_env', () => {
  it('names the switch on an MSYS2 and on a Cygwin userland', () => {
    expect(ask('msys')).toBe('[TERMINUS_SUBLIME=1]');
    expect(ask('cygwin')).toBe('[TERMINUS_SUBLIME=1]');
  });

  it('answers NOTHING on the fleet userlands -- their panes are already unicode', () => {
    // The negative control: an unconditional export would also be green above.
    expect(ask('linux-gnu')).toBe('[]');
    expect(ask('darwin23')).toBe('[]');
    expect(ask('')).toBe('[]');
  });
});

describe('both spawn lines carry it', () => {
  const src = fs.readFileSync(path.resolve(CCD), 'utf8');

  it('`$resenv` is assembled with the answer, once', () => {
    expect(src.match(/glyphenv=\$\(_pane_unicode_env\)/g)).toHaveLength(1);
    // `.*` after it: the Windows port's `$shellenv` (`_pane_shell_env`) follows it on the same line.
    expect(src).toMatch(/^\s*resenv="\$resenv\$\{adjenv:\+ \$adjenv\}.*\$\{glyphenv:\+ \$glyphenv\}.*"$/m);
  });

  it('and every `exec env` that launches the wrapper splices `$resenv`', () => {
    // Without this a THIRD spawn line added later would launch an ASCII pane while the two above stay green.
    const lines = src.split('\n').filter((l) => /exec env .*\$WRAPPER_DIR\/\$wrapper/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(l).toContain('$resenv');
  });
});
