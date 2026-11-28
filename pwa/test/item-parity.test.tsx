// The item page and the summaries read one text alike (fix round 1 of desktop-polish wave 186, F7, review 4189). The rule that
// keeps old prose as written lives twice: in the page's guard (`lib/remarkItemGuard.ts`, over the transcript's own parser) and
// in the summaries' projection (`shared/itemText.ts`, a scanner that imports nothing). This case feeds one corpus to both and
// compares the plain words, so the two cannot drift apart unseen. Every fixture is invented.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ItemMarkdown } from '../src/lib/markdown';
import { linkRuns } from '../src/ledgers/ledgerLinks';
import { itemPlainText } from '../../shared/itemText';
import { withSyncHighlight } from './highlightTestStore';

afterEach(cleanup);

const links = (t: string) => linkRuns(t, 'project-a');
const BLOCKS = new Set(['P', 'LI', 'UL', 'OL', 'PRE', 'DIV', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'SECTION']);

/** The words a reader sees on the page: text in order, a space at each block's edges, the copy block's bar (its language label and Copy) left out. */
function pageWords(text: string): string {
  const box = render(withSyncHighlight(<div><ItemMarkdown text={text} links={links} /></div>)).container;
  const walk = (n: Node): string => {
    let out = '';
    n.childNodes.forEach((c) => {
      if (c.nodeType === Node.TEXT_NODE) { out += c.nodeValue ?? ''; return; }
      if (!(c instanceof HTMLElement) || c.classList.contains('code-block-bar') || c.getAttribute('aria-hidden') === 'true') return;
      // An outside link's host is the page's own addition beside the writer's words; the summary never carries it (F1, round 2).
      if (c.classList.contains('wi-link-host')) return;
      // A line break is a space between words (round 2, F2).
      if (c.tagName === 'BR') { out += ' '; return; }
      const block = BLOCKS.has(c.tagName);
      out += `${block ? ' ' : ''}${walk(c)}${block ? ' ' : ''}`;
    });
    return out;
  };
  const words = walk(box).replace(/\s+/g, ' ').trim();
  cleanup();
  return words;
}

/** Texts the page and the summary must read alike. */
const AGREE: readonly string[] = [
  'Run `ccrc doctor` **now**, then *check*.',
  'See [the spec](https://example.com/s) and <https://example.com/x> and ![the chart](https://example.com/c.png).',
  // The reviewer's two drifts: an address in angle brackets, and a code span across a soft line break.
  'Write to <ops@example.com> now.',
  'Run `ccrc\ndoctor` now, and an *emphasis\nacross lines* too.',
  // A single tilde is no strikethrough on either side; two are.
  'Use ~old~ names, not ~~these~~.',
  // A2: an escape and a character reference stay as written.
  'Match ccrc-[0-9]+\\.log only; type \\*all\\* to list.',
  'Ask AT&amp;T, then &lt;b&gt;.',
  // Old prose.
  'Edit src/*.ts and docs/*.md; the cap is 5*3*2.',
  'Call __init__, set _private_ and run_tests_now.',
  'Remove *.log. Keep src/* as it is. Clear build/*. Then rebuild lib/* from scratch.',
  '*The run is over.* Next. This is *important*. And **this** too.',
  'a*b* c, *b*c here, Remove *.log and keep it* today, Remove *all of src/* now.',
  '# of retries is 3',
  '> 5 failures means it is broken.',
  '- then run it again.',
  '2026. was the year it moved.',
  'See[^1] there.\n\n[^1]: the note',
  '[draft]: docs/x.md',
  'Paste this:\n\n```bash\nccrc doctor --fix\n```\n\nthen tell me.',
  'First paragraph.\n\nSecond paragraph with `code`.',
];

/** Texts the two read differently, on purpose: the text, the page's words, the summary's, and why. Both sides are pinned, so
 *  a change on either side is seen; a change that closes one moves its text to AGREE (fix round 2, F2). */
const DIFFER: ReadonlyArray<readonly [string, string, string, string]> = [
  ['- one\n- two', 'one two', '- one - two',
    'two or more lines make a list on the page; the one-line summary keeps the writer\'s markers, so it still reads as steps'],
  ['| a | b |\n|---|---|\n| 1 | 2 |', 'a b 1 2', '| a | b | |---|---| | 1 | 2 |',
    'a table is a table on the page; a summary keeps its pipes (A6, a follow-up of the coordinator\'s)'],
  ['Steps\n=====', 'Steps', 'Steps =====', 'a setext heading is bold on the page; a summary keeps the underline (A6, a follow-up)'],
  ['- [ ] confirm the result', 'confirm the result', '- [ ] confirm the result',
    'a task item is a checkbox on the page; the summary keeps its brackets, so it still reads as a task'],
  ['Before\n\n***\n\nAfter', 'Before After', 'Before *** After', 'a thematic break is a rule on the page; a summary keeps its stars'],
  ['one\\\ntwo', 'one two', 'one\\ two', 'a line-end backslash is a line break on the page; a summary keeps the backslash'],
  ['[docs/a.md](https://example.com/z)', 'https://example.com/z', 'docs/a.md',
    'the page draws a link whose words are another address as where it opens (round 1, A3); a summary keeps the words'],
];

describe('the item page and its summaries read one text alike (F7)', () => {
  it.each(AGREE)('%j', (text) => {
    expect(pageWords(text)).toBe(itemPlainText(text));
  });

  it.each(DIFFER)('the listed difference %j: page %j, summary %j (%s)', (text, page, summary) => {
    expect(pageWords(text)).toBe(page);
    expect(itemPlainText(text)).toBe(summary);
  });
});
