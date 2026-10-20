/**
 * D-5910 (plan docs/superpowers/plans/2026-10-20-mail-and-run-truth-draft-never-blocks-rejected-m.md, Task P1a;
 * spec §2.2). The box reader's corpus: text rendered dim is not input, whatever SGR encoding carries the dim.
 *
 * CORPUS README. `fixtures/panes/box/` sits inside the one pane corpus, and `verdicts.json` beside the captures holds
 * one column per caller (ARCH-24's per-caller verdict shape): `draftOfMeasured` (this file) and ccd's
 * `_pane_box_draft` (`ccd-pane-box-draft.test.ts`). Recorded 2026-10-20 from Claude Code 2.1.303, macOS, tmux 3.7c,
 * a throwaway local tmux server at 220x50, `--safe-mode --model haiku`, read with `capture-pane -p -e` as
 * `Tmux.captureAnsi` reads, work-dir path scrubbed to `<projects-root>/project-a`. Recorded verbatim:
 * `placeholder-dim`, the four `draft-*`, `stranded-clear` (typed, not submitted; the slash menu is open),
 * `empty-nbsp` (the box after a turn: `❯` + U+00A0 and nothing else) and `box-capped-tall` (61 lines typed: the box
 * keeps its last 20 rows and draws `❯` on the first of them). The draft and empty captures hold a submitted turn in
 * the scrollback, so a reader that took the FIRST `❯` row would read that turn.
 *
 * DERIVED (D-6007), each from `placeholder-dim` with only the placeholder's dim codes substituted, because 2.1.303 renders its
 * hint with the bare pair and the other encodings are what the same pane carries under another renderer:
 *  - `placeholder-dim-combined`: the open as `\e[2;3m`. tmux 3.7c emits that combined form itself when dim and
 *    another attribute start on one cell (measured: `printf '\e[2;3m…'` captures back unchanged).
 *  - `placeholder-dim-after-reset` (D-6006): the open as `\e[0;2m` after a bold marker. tmux 3.7c writes ANY
 *    attribute removal as a reset, so dim following a bold cell captures as `\e[1m…\e[0;2m` (measured).
 *  - `placeholder-dim22`: the close as `\e[22m`. tmux 3.7c never emits it (it normalises a dim-off to `\e[0m`,
 *    measured), so this pins the spec's named encoding for any reader handed raw terminal output.
 * D-6007: `box-taller-than-capture` is the fleet's measured 2026-09-18 shape (`send.test.ts`'s
 * `BOX_TALLER_THAN_THE_WINDOW`: the marker row scrolled out of the 50-row window) with its text made neutral.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftOfMeasured, type BoxRead } from '../src/inject/send.js';

const boxDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'panes', 'box');
const capture = (name: string): string => readFileSync(path.join(boxDir, name), 'utf8');

interface Verdict { draftOfMeasured: BoxRead; _pane_box_draft: string | null }
const VERDICTS = (JSON.parse(readFileSync(path.join(boxDir, 'verdicts.json'), 'utf8')) as {
  captures: Record<string, Verdict>;
}).captures;

const names = (prefix: string): string[] => Object.keys(VERDICTS).filter((n) => n.startsWith(prefix));

describe('the box reader corpus (D-5910)', () => {
  it('every capture has a verdict row, and every verdict row a capture', () => {
    const files = readdirSync(boxDir).filter((f) => f.endsWith('.ansi')).sort();
    expect(Object.keys(VERDICTS).sort()).toEqual(files);
    // The red-first minimum: the encodings the spec names are all held.
    for (const f of ['placeholder-dim.ansi', 'placeholder-dim-combined.ansi', 'placeholder-dim22.ansi'])
      expect(files).toContain(f);
  });

  describe("each placeholder capture reads `{box:'present', draft:''}`", () => {
    it('the corpus holds every placeholder encoding', () => {
      expect(names('placeholder-').length).toBeGreaterThanOrEqual(4);
    });
    for (const n of names('placeholder-')) {
      it(n, () => {
        // The capture really does show the hint, so an empty read is the strip at work, not an empty row.
        expect(capture(n)).toContain('Try "edit <filepath> to..."');
        expect(draftOfMeasured(capture(n))).toEqual({ box: 'present', draft: '' });
      });
    }
  });

  it('each draft capture reads its own text', () => {
    const drafts = [...names('draft-'), 'stranded-clear.ansi'];
    expect(drafts.length).toBe(5);
    for (const n of drafts) {
      const want = VERDICTS[n]!.draftOfMeasured;
      expect(want.box === 'present' && want.draft !== '', n).toBe(true);
      expect(draftOfMeasured(capture(n)), n).toEqual(want);
    }
  });

  it('the paste chip reads as its chip row', () => {
    expect(draftOfMeasured(capture('draft-paste-chip.ansi'))).toEqual({ box: 'present', draft: '[Pasted text #4]' });
    expect(draftOfMeasured(capture('draft-image-chip.ansi'))).toEqual({ box: 'present', draft: '[Image #5]' });
  });

  it('the taller box reads `absent`', () => {
    expect(draftOfMeasured(capture('box-taller-than-capture.ansi'))).toEqual({ box: 'absent' });
    // The 2.1.303 row cap keeps a marker in view, so that shape is present and non-empty: it refuses as a draft.
    expect(draftOfMeasured(capture('box-capped-tall.ansi'))).toEqual(VERDICTS['box-capped-tall.ansi']!.draftOfMeasured);
  });

  it('`empty-nbsp` reads empty', () => {
    expect(capture('empty-nbsp.ansi')).toContain('❯ \n');
    expect(draftOfMeasured(capture('empty-nbsp.ansi'))).toEqual({ box: 'present', draft: '' });
  });

  it('the widened dim rule still ends at the first reset: real text after a dim run survives', () => {
    // The two hard-won subtleties `DIM_SPAN`'s comment records, under each new encoding.
    const row = (open: string, close: string): string => `\x1b[39m❯ ${open}ghost${close}REAL\x1b[0m\n`;
    for (const [open, close] of [['\x1b[2;3m', '\x1b[0;1m'], ['\x1b[0;2m', '\x1b[22m'], ['\x1b[2m', '\x1b[22;1m']])
      expect(draftOfMeasured(row(open!, close!)), JSON.stringify([open, close])).toEqual({ box: 'present', draft: 'REAL' });
    // A truecolour code whose parameters contain a 2 is not a dim open.
    expect(draftOfMeasured('❯ \x1b[38;2;10;20;30mreal colour\x1b[0m\n')).toEqual({ box: 'present', draft: 'real colour' });
  });
});
