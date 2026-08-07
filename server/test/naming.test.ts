// The 40 is the SLUG's budget, not the branch's: `ws/` is three more characters
// on the wire and the rule deliberately does not count them.
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO } from '../src/io.js';
import { SLUG_MAX, deriveBranch } from '../src/naming.js';
import { readAiTitle } from '../src/transcript/title.js';
import { mkTmp } from './tmpHelpers.js';

describe('deriveBranch', () => {
  it('lowercases, collapses every non-alphanumeric run to one dash, and prefixes ws/', () => {
    expect(deriveBranch('Fix the PR sheet')).toBe('ws/fix-the-pr-sheet');
    expect(deriveBranch('Debug: WHY does /api/fleet 502?')).toBe('ws/debug-why-does-api-fleet-502');
    expect(deriveBranch('  leading and trailing  ')).toBe('ws/leading-and-trailing');
    expect(deriveBranch('a___b...c')).toBe('ws/a-b-c');
  });

  it('produces a name ccd’s own _ws_branch_valid accepts', () => {
    // Not a second implementation of that rule — a demonstration that the
    // character class this function emits is a subset of the one ccd permits.
    // The verdict itself still comes from the box, as `bad-branch`.
    for (const t of ['Ünïcødé tïtlé', '!!!', 'a/b\\c:d', '.lock', 'trailing-']) {
      const b = deriveBranch(t);
      if (b === null) continue;
      expect(b, t).toMatch(/^ws\/[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('is null for a title with nothing alphanumeric in it', () => {
    expect(deriveBranch('')).toBeNull();
    expect(deriveBranch('   ')).toBeNull();
    expect(deriveBranch('—— ··· ——')).toBeNull();
  });

  // ── the 40-character budget ──
  it('the budget excludes the ws/ prefix', () => {
    const b = deriveBranch('x '.repeat(60));
    expect(b).not.toBeNull();
    expect(b!.slice('ws/'.length).length).toBeLessThanOrEqual(SLUG_MAX);
    expect(SLUG_MAX).toBe(40);
  });

  it('drops back to the last dash at or before the cut — never forward past it', () => {
    // The spec's own worked example. `brainstorm-helix-and-slide-notes-integration`
    // is 44 characters; a cut at 40 lands mid-`integration`, and dropping BACK
    // gives 32. Rounding forward would give the whole 44 and blow the budget.
    expect(deriveBranch('Brainstorm Helix and slide notes integration'))
      .toBe('ws/brainstorm-helix-and-slide-notes');
  });

  it('does not drop back when the cut already lands on a boundary', () => {
    // slug[40] === '-': the first 40 characters are a whole word run, so there
    // is nothing to drop back over. A blind lastIndexOf would lose the last
    // whole word for no reason.
    const slug = 'a'.repeat(SLUG_MAX);
    expect(deriveBranch(`${'a'.repeat(SLUG_MAX)} b`)).toBe(`ws/${slug}`);
  });

  it('hard-cuts a single word with no dash in the first 40 characters', () => {
    // 45 characters, one word: there is no boundary to drop back to, so the
    // rule cuts at 40 rather than emitting nothing.
    expect(deriveBranch('Refactoringtheauthenticationmiddlewarepipeline'))
      .toBe('ws/refactoringtheauthenticationmiddlewarepi');
  });

  it('never emits a trailing dash', () => {
    // The cut can land immediately after a dash; the drop-back is what removes
    // it, and this is the assertion that says so rather than assuming it.
    for (let n = 30; n <= 60; n++) {
      const b = deriveBranch('ab '.repeat(n));
      expect(b, `n=${n}`).not.toBeNull();
      expect(b!, `n=${n}`).not.toMatch(/-$/);
      expect(b!.slice('ws/'.length).length, `n=${n}`).toBeLessThanOrEqual(SLUG_MAX);
    }
  });
});

describe('readAiTitle', () => {
  const TITLE = (t: string): string =>
    JSON.stringify({ type: 'ai-title', aiTitle: t, sessionId: '5016f833' });
  const USER = (text: string): string =>
    JSON.stringify({ type: 'user', message: { role: 'user', content: text } });

  const fileWith = (lines: string[]): string => {
    const f = path.join(mkTmp('ccrc-title-'), 't.jsonl');
    writeFileSync(f, lines.join('\n') + '\n');
    return f;
  };

  it('reads the ai-title line nothing else in the codebase consumes', async () => {
    // `transcript/ask.ts:11-16` names `ai-title` among the types it deliberately
    // skips; this is the first consumer it has ever had.
    expect(await readAiTitle(localIO, fileWith([
      USER('do the thing'),
      TITLE('Brainstorm Helix and slide notes integration'),
      USER('now do the next thing'),
    ]))).toBe('Brainstorm Helix and slide notes integration');
  });

  it('takes the LAST one — Claude Code rewrites the line once per turn', async () => {
    expect(await readAiTitle(localIO, fileWith([
      TITLE('First guess'), USER('x'), TITLE('Second guess'),
    ]))).toBe('Second guess');
  });

  it('is null for a transcript that has none — nine of 609 on this box', async () => {
    expect(await readAiTitle(localIO, fileWith([USER('a'), USER('b')]))).toBeNull();
  });

  it('is null for a file that is not there at all', async () => {
    expect(await readAiTitle(localIO, path.join(mkTmp('ccrc-title-'), 'nope.jsonl'))).toBeNull();
  });

  it('survives the junk a live transcript actually carries', async () => {
    expect(await readAiTitle(localIO, fileWith([
      '', '   ', 'not json at all', 'null', '42', '"a string"',
      JSON.stringify({ type: 'ai-title' }),                   // no aiTitle
      JSON.stringify({ type: 'ai-title', aiTitle: 17 }),      // wrong type
      JSON.stringify({ type: 'ai-title', aiTitle: '   ' }),   // blank
      TITLE('The real one'),
    ]))).toBe('The real one');
  });

  it('reads a 256 KB tail, and finds a title that far back', async () => {
    // Measured across the 600 transcripts on this box that carry one: the last
    // ai-title sits at most 45,996 bytes from EOF (p95 31,177; median 12,687).
    // This fixture puts one at ~200 KB — inside the window — behind 2 MB of
    // noise that must NOT be read.
    const filler = USER('x'.repeat(2000));
    const f = fileWith([
      TITLE('Far too early to see'),
      ...Array.from({ length: 1000 }, () => filler),   // ~2 MB
      TITLE('Inside the window'),
      ...Array.from({ length: 100 }, () => filler),    // ~200 KB
    ]);
    expect(await readAiTitle(localIO, f)).toBe('Inside the window');
  });

  it('never returns half a line that the tail cut through', async () => {
    // The tail almost certainly starts mid-line; the first line of the chunk is
    // dropped. Without that, a truncated `{"type":"ai-ti` reaches JSON.parse.
    const f = fileWith([
      ...Array.from({ length: 200 }, (_, i) => TITLE(`stale ${i} ${'y'.repeat(2000)}`)),
      TITLE('The last one'),
    ]);
    expect(await readAiTitle(localIO, f)).toBe('The last one');
  });
});
