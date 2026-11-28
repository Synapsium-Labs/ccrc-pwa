// An item's text as Markdown (desktop-polish wave 186): `ItemMarkdown` (`lib/markdown.tsx`), the item profile's guard
// (`lib/remarkItemGuard.ts`) and the prose splitter (`lib/hastLinkRuns.ts`). Every fixture is invented.
//
// What it holds, case by case: each mark is drawn; a fenced block is the transcript's copy block, and Copy copies exactly the
// block's text, says so, and says when the copy failed; hostile text is drawn inert; an image is its link and never an
// `<img>`; old plain prose reads as it was written (the guard); references link in prose and never inside code; a title is
// inline; and the transcript's own output is unchanged by any of it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMarkdown, ItemMarkdown } from '../src/lib/markdown';
import type { TextLinkRun } from '../src/lib/hastLinkRuns';
import { guardItemTree } from '../src/lib/remarkItemGuard';
import { withSyncHighlight } from './highlightTestStore';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** The item's text drawn in a box of its own, as the item page draws it. */
const draw = (text: string, extra: { inline?: boolean; links?: (t: string) => readonly TextLinkRun[] } = {}): HTMLElement =>
  render(withSyncHighlight(<div className="box"><ItemMarkdown text={text} {...extra} /></div>)).container.querySelector('.box') as HTMLElement;
const html = (text: string): string => renderToStaticMarkup(withSyncHighlight(<ItemMarkdown text={text} />));
const chatHtml = (text: string): string => renderToStaticMarkup(withSyncHighlight(<ChatMarkdown text={text} />));

/** A splitter that reads a whole `https` address as one outside link, and nothing else as a link (as `linkRuns` refuses
 *  `http:` and the rest). */
const httpsOnly = (t: string): readonly TextLinkRun[] =>
  (/^https:\/\/\S+$/.test(t) ? [{ kind: 'link', text: t, href: t, external: true }] : [{ kind: 'text', text: t }]);

describe('each mark is drawn', () => {
  it('paragraphs, asterisk emphasis, a list, inline code, a fenced block and a link', () => {
    const box = draw('First *one* and **two**.\n\n- alpha\n- beta\n\nRun `ccrc doctor` now.\n\n```bash\nccrc doctor\n```\n\n[the guide](https://example.com/guide)', { links: httpsOnly });
    expect(box.querySelectorAll('p').length).toBeGreaterThanOrEqual(2);
    expect(box.querySelector('em')?.textContent).toBe('one');
    expect(box.querySelector('strong')?.textContent).toBe('two');
    expect([...box.querySelectorAll('ul > li')].map((l) => l.textContent)).toEqual(['alpha', 'beta']);
    expect(box.querySelector('code.md-code')?.textContent).toBe('ccrc doctor');
    expect(box.querySelector('.code-block pre')?.textContent).toBe('ccrc doctor');
    expect(box.querySelector('.code-block button.code-block-copy')).not.toBeNull();
    const a = box.querySelector('a[href="https://example.com/guide"]');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toContain('noopener');
  });

  it('a heading (a setext underline) is drawn as bold text, never a heading element', () => {
    const box = draw('Steps\n=====\n\nThen go.');
    expect(box.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    expect(box.querySelector('p > strong')?.textContent).toBe('Steps');
  });

  it('a table is the transcript\'s table, in its own scroller', () => {
    const box = draw('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(box.querySelector('.md-table-wrap > table td')?.textContent).toBe('1');
  });

  it('the inline form (a title, an option) keeps marks inside one line and drops every block', () => {
    const box = draw('Run `ccrc doctor` **now**\n\n- a list\n\n```\nblock\n```', { inline: true });
    expect(box.querySelector('p, ul, li, pre, .code-block')).toBeNull();
    expect(box.querySelector('code')?.textContent).toBe('ccrc doctor');
    expect(box.querySelector('strong')?.textContent).toBe('now');
  });
});

describe('a fenced block is a copy block', () => {
  const BLOCK = 'echo "a | b"\nprintf \'%s\\n\' "two words" | sort';
  const fenced = `Run this:\n\n\`\`\`bash\n${BLOCK}\n\`\`\``;

  it('Copy writes exactly the block\'s text (quotes, a pipe, two lines), then says Copied', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const box = draw(fenced);
    const button = box.querySelector('button.code-block-copy') as HTMLButtonElement;
    expect(button.type).toBe('button');
    await act(async () => { fireEvent.click(button); await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledWith(BLOCK);
    expect(button.querySelector('[aria-live="polite"]')?.textContent).toBe('Copied');
  });

  it('a refused write says Copy failed', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: () => Promise.reject(new Error('NotAllowedError')) } });
    const button = draw(fenced).querySelector('button.code-block-copy') as HTMLButtonElement;
    await act(async () => { fireEvent.click(button); await Promise.resolve(); await Promise.resolve(); });
    expect(button.textContent).toBe('Copy failed');
    expect(button.getAttribute('data-copy-failed')).toBe('true');
  });

  it('a page with no clipboard says Copy failed', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    const button = draw(fenced).querySelector('button.code-block-copy') as HTMLButtonElement;
    await act(async () => { fireEvent.click(button); });
    expect(button.textContent).toBe('Copy failed');
  });
});

describe('hostile text is drawn inert', () => {
  it('an HTML tag is text, never an element', () => {
    const box = draw('Add <b>bold</b> and <script>alert(1)</script> and <img src=x onerror=alert(1)>.');
    expect(box.querySelector('b, script, img')).toBeNull();
    expect(box.textContent).toContain('<script>alert(1)</script>');
  });

  it('a script link keeps its words and is no link', () => {
    const box = draw('[click](javascript:alert(1)) and [data](data:text/html,x)');
    expect(box.querySelector('a')).toBeNull();
    expect(box.textContent).toBe('click and data');
  });

  it('an anchor the splitter did not judge is its words: with no splitter, a writer\'s link links nothing (fix round 1, F1)', () => {
    const box = draw('[the guide](https://example.com/guide) and <https://example.com/x> and https://example.com/y');
    expect(box.querySelector('a')).toBeNull();
    expect(box.textContent).toBe('the guide and https://example.com/x and https://example.com/y');
  });

  it('a refused link\'s words are walked by the same splitter: an autolink inside them is judged too (F1)', () => {
    const box = draw('[a <http://evil.example/x> b](http://y.example) [c <mailto:x@example.com> d](javascript:alert(1)) [e <https://ok.example/z> f](http://y.example)', { links: httpsOnly });
    expect([...box.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://ok.example/z']);
    expect(box.textContent).toBe('a http://evil.example/x b c mailto:x@example.com d e https://ok.example/z f');
  });

  it('a link whose words are an address or a path other than where it opens is drawn as where it opens (A3)', () => {
    const box = draw('[https://docs.example/x](https://other.example/y), [docs/a.md](https://other.example/z), [https://same.example/s](https://same.example/s) and [the guide](https://other.example/g)', { links: httpsOnly });
    expect([...box.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['https://other.example/y', 'https://other.example/y'], ['https://other.example/z', 'https://other.example/z'],
      ['https://same.example/s', 'https://same.example/s'], ['the guide', 'https://other.example/g'],
    ]);
  });

  it('a footnote is its words: no footnote section, no back-arrow, no ids (A4)', () => {
    const box = draw('See[^1] there.\n\n[^1]: the note', { links: httpsOnly });
    expect(box.querySelector('section, sup, [id], [data-footnotes]')).toBeNull();
    expect(box.textContent).not.toContain('Footnotes');
    expect(box.textContent).toContain('See[^1] there.');
    expect(box.textContent).toContain('[^1]: the note');
  });

  it('a huge fence is one code block (its box scrolls; the browser file measures the page)', () => {
    const line = 'x'.repeat(1900);
    const box = draw(`\`\`\`\n${line}\n\`\`\``);
    expect(box.querySelectorAll('.code-block pre')).toHaveLength(1);
    expect(box.querySelector('.code-block pre')?.textContent).toBe(line);
  });
});

describe('an image is its link, never fetched', () => {

  it('an image is an anchor with its alt text, and no <img> is made', () => {
    const box = draw('See ![the chart](https://example.com/chart.png) here.', { links: httpsOnly });
    expect(box.querySelector('img')).toBeNull();
    const a = box.querySelector('a[href="https://example.com/chart.png"]');
    expect(a?.textContent).toBe('the chart');
    expect(a?.getAttribute('target')).toBe('_blank');
  });

  it('a link to an image address is a link, not an embedded image', () => {
    const box = draw('[the chart](https://example.com/chart.png)', { links: httpsOnly });
    expect(box.querySelector('img')).toBeNull();
    expect(box.querySelector('a')?.textContent).toBe('the chart');
  });

  it('an image whose address the splitter does not link is its alt text (an http page, a local path)', () => {
    for (const src of ['http://example.com/x.png', '/local/x.png']) {
      const box = draw(`![a picture](${src})`, { links: httpsOnly });
      expect(box.querySelector('img, a')).toBeNull();
      expect(box.textContent).toBe('a picture');
      cleanup();
    }
  });

  it('with no splitter at all, an image is only its alt text', () => {
    const box = draw('![a picture](https://example.com/chart.png)');
    expect(box.querySelector('img, a')).toBeNull();
    expect(box.textContent).toBe('a picture');
  });
});

/** Old item text, written before item text was Markdown, and what a reader must still see. */
const OLD_PROSE: ReadonlyArray<readonly [string, string]> = [
  ['a glob star twice in one line', 'Edit src/*.ts and docs/*.md before the run.'],
  ['a product of numbers', 'The cap is 5*3*2 = 30 slots.'],
  ['a name with double underscores', 'Call __init__ and run_tests_now first.'],
  ['a single underscore pair', 'Set _private_ on the row.'],
  ['a path with a placeholder', 'Read ~/.cc-sessions/<id>.uuid then ws/<slug>.'],
  ['a number sign before a PR number', 'PR #3427 holds it.'],
  ['a line starting with a number', '2026. was the year it moved.'],
  ['a number sign and a space', '# of retries is 3, and it stays there.'],
  ['a greater-than sign', '> 5 failures means it is broken.'],
  ['a hyphen and a space', '- then run it again.'],
  ['a line indented four spaces', '    the old indented note stays prose.'],
  ['angle brackets in a comparison', 'Keep a > b and a < b true.'],
  ['a single-tilde pair (fix round 1, F7: the item profile has no single-tilde strikethrough)', 'Use ~old~ and ~new~ names.'],
  ['a backslash before a full stop (A2)', 'Match ccrc-[0-9]+\\.log only.'],
  ['a backslash before a mark (A2)', 'Type \\*all\\* to list.'],
  ['a character reference (A2)', 'Ask AT&amp;T, then &lt;b&gt;.'],
  ['a bracketed label, a colon and a path (A4: no reference definitions)', '[draft]: docs/x.md'],
  ['a glob that ends a sentence, then a second glob', 'Clear build/*. Then rebuild lib/* from scratch.'],
  ['a bare glob that ends a sentence, then a path glob', 'Remove *.log. Keep src/* as it is.'],
];

describe('old plain prose reads as it was written', () => {
  it.each(OLD_PROSE)('%s', (_name, text) => {
    const box = draw(text);
    expect(box.querySelector('em, strong, del, ol, ul, blockquote, h1, h2, h3, h4, h5, h6, pre, .code-block')).toBeNull();
    expect(box.textContent).toBe(text.trim());
  });

  // Fix round 1, F3: each clause of the guard has a case that only that clause catches. Each text is emphasis (or a list) in
  // the transcript's own output, so deleting the clause draws it so on the item page too.
  const CLAUSES: ReadonlyArray<readonly [string, string, string]> = [
    ['G1 the character before an opening run binds it (BOUND_BEFORE)', 'a*b* c', 'em'],
    ['G2 the character after a closing run binds it (BOUND_AFTER)', '*b*c here', 'em'],
    ['G3 a full stop just inside the opening run is a glob (GLOB_AFTER_OPEN)', 'Remove *.log and keep it* today', 'em'],
    ['G4 a slash just inside the closing run is a glob (GLOB_BEFORE_CLOSE)', 'Remove *all of src/* now', 'em'],
  ];
  it.each(CLAUSES)('%s', (_name, text, mark) => {
    expect(chatHtml(text)).toContain(`<${mark}>`);
    const box = draw(text);
    expect(box.querySelector(mark)).toBeNull();
    expect(box.textContent).toBe(text);
  });

  it('G5 a one-item list over two lines stays a list (only a one-line item is a sentence)', () => {
    const text = '- then run it\n  and check the result';
    expect(chatHtml(text)).toContain('<li>');
    expect([...draw(text).querySelectorAll('ul > li')].map((l) => l.textContent)).toEqual(['then run it\nand check the result']);
  });

  it('a mark between spaces is still a mark, and a full stop after it ends the sentence', () => {
    const box = draw('This is *important*. And **this** too.');
    expect(box.querySelector('em')?.textContent).toBe('important');
    expect(box.querySelector('strong')?.textContent).toBe('this');
  });

  it('a full stop inside a closing run is still a mark: an emphasised sentence', () => {
    expect(draw('*The run is over.* Next.').querySelector('em')?.textContent).toBe('The run is over.');
  });

  it('two numbered lines are a list', () => {
    const box = draw('1. open the shell\n2. run the check');
    expect([...box.querySelectorAll('ol > li')].map((l) => l.textContent)).toEqual(['open the shell', 'run the check']);
  });

  it('a task line stays a checkbox', () => {
    expect(draw('- [ ] confirm the result').querySelector('input[type="checkbox"]')).not.toBeNull();
  });

  it('the guard walks a deep tree without recursion', () => {
    let node: { type: string; children: unknown[] } = { type: 'text', children: [] };
    for (let i = 0; i < 100_000; i += 1) node = { type: 'paragraph', children: [node] };
    expect(() => guardItemTree(node as never, '')).not.toThrow();
  });
});

describe('the transcript is unchanged', () => {
  it('the same old prose fed to both: the transcript still draws CommonMark, the item draws the prose', () => {
    const text = OLD_PROSE[0]![1];
    expect(chatHtml(text)).toBe('<p>Edit src/<em>.ts and docs/</em>.md before the run.</p>');
    expect(html(text)).toBe(`<p>${text}</p>`);
    const callNote = '- then run it again.';
    expect(chatHtml(callNote)).toBe('<ul>\n<li>then run it again.</li>\n</ul>');
  });
});

describe('references link in prose, never inside code', () => {
  const links = (t: string): readonly TextLinkRun[] => {
    const at = t.indexOf('item 12');
    if (at < 0) return [{ kind: 'text', text: t }];
    return [
      { kind: 'text', text: t.slice(0, at) },
      { kind: 'link', text: 'item 12', href: '/waiting/12', external: false },
      { kind: 'text', text: t.slice(at + 'item 12'.length) },
    ];
  };

  it('a reference in a sentence is a console link', () => {
    const a = draw('See item 12 for the rest.', { links }).querySelector('a');
    expect(a?.getAttribute('href')).toBe('/waiting/12');
    expect(a?.getAttribute('target')).toBeNull();
    expect(a?.textContent).toBe('item 12');
  });

  it('the same words in inline code or a fenced block are not', () => {
    const box = draw('Run `item 12` now.\n\n```\nitem 12\n```', { links });
    expect(box.querySelector('a')).toBeNull();
  });

  it('a reference in a title (the inline form) links too', () => {
    expect(draw('Close item 12', { inline: true, links }).querySelector('a')?.textContent).toBe('item 12');
  });
});
