// Claude Code's prompt glyph, by its bytes (W7 C7i, D-7187; OA-C16 (a); plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, Task C7i Step 4). The drawer's view
// (`pwa/src/session/drawerView.ts#PROMPT_GLYPH`, which `showsPrompt` and `anchorRow` read) and the server's dialog
// parser (`server/src/pane/dialog.ts#startsWithPromptGlyph`) judge pane text by the same character. This pins the
// character, U+276F (UTF-8 e2 9d af), and the parser's verdicts on the rows around it, so the move to one spelling
// changes no byte and no verdict. `drawerView.ts` is imported by path (the `w7-compaction-parity.test.ts` precedent).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startsWithPromptGlyph } from '../src/pane/dialog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const drawerView = async (): Promise<{ PROMPT_GLYPH: string; showsPrompt: (rows: readonly string[]) => boolean }> =>
  await import(path.join(ROOT, 'pwa/src/session/drawerView.ts')) as { PROMPT_GLYPH: string; showsPrompt: (rows: readonly string[]) => boolean };

const hex = (s: string): string => Buffer.from(s, 'utf8').toString('hex');

describe('the prompt glyph is U+276F in the drawer and the dialog parser (C7i, D-7187)', () => {
  it('the drawer\'s PROMPT_GLYPH is the one code point U+276F, UTF-8 e2 9d af', async () => {
    const { PROMPT_GLYPH } = await drawerView();
    expect([PROMPT_GLYPH.length, PROMPT_GLYPH.codePointAt(0), hex(PROMPT_GLYPH)]).toEqual([1, 0x276f, 'e29daf']);
  });

  it('the dialog parser\'s verdicts: a row that starts with U+276F, and the look-alikes that do not', () => {
    const rows = ['❯', '❯ 1. Yes', '❯ type here', ' ❯ indented', '> 1. Yes', '› 1. Yes', '❱ x', '1. ❯'];
    expect(rows.map((r) => [hex(r), startsWithPromptGlyph(r)])).toEqual([
      ['e29daf', true],
      ['e29daf20312e20596573', true],
      ['e29dafc2a0747970652068657265', true],
      ['20e29daf20696e64656e746564', false],
      ['3e20312e20596573', false],
      ['e280ba20312e20596573', false],
      ['e29db12078', false],
      ['312e20e29daf', false],
    ]);
  });

  it('the drawer\'s showsPrompt agrees on the same character', async () => {
    const { showsPrompt } = await drawerView();
    expect([showsPrompt(['❯']), showsPrompt(['vim ~', '1. ❯']), showsPrompt(['> 1. Yes', '› x']), showsPrompt([])])
      .toEqual([true, true, false, false]);
  });
});
