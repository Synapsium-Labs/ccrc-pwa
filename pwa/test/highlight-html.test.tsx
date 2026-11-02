// The main thread's check of the worker's HTML (native Docs reader, W5h-a Task 5; base spec 2026-10-01 section
// 4.10 "The single sink and its check", M4.H14). `checkHighlightHtml` accepts exactly `<span class="hljs-…">` with
// highlight.js scope classes, `<span class="language-NAME">` for a registered name or alias, `</span>`, and text
// whose `&` begins one of highlight.js's five entities, balanced; anything else is `null`. Linear: its step counter
// (not a clock) grows in proportion to the input. Only the check makes a `CheckedHighlightHtml`. The sink's half (a
// plain string at the code component renders plain) is appended by Task 6.
import { describe, expect, it } from 'vitest';
import { HLJS } from '../src/lib/highlightGrammars';
import { HIGHLIGHT_NAME_SET, isRegisteredGrammar } from '../src/lib/highlightNames';
import { checkHighlightHtml, codeBlocksOf, isCheckedHighlightHtml } from '../src/lib/highlightStore';
import { parseMarkdown } from '../src/lib/markdownParse';
import { CHAT_ALIAS_TAGS, CHAT_CORPUS, languageCases } from './markdownCorpus';

const colour = (lang: string, code: string): string => HLJS.highlight(code, { language: lang, ignoreIllegals: true }).value;

describe('M4.H14: what the check accepts', () => {
  it('the HTML highlight.js gives for every code block of M4.M1\'s corpus', () => {
    const cases = [...CHAT_CORPUS, ...languageCases([...HLJS.listLanguages(), ...CHAT_ALIAS_TAGS])];
    let seen = 0;
    for (const c of cases) {
      const parsed = parseMarkdown(c.text, 'chat');
      if (parsed.kind !== 'tree') continue;
      for (const b of codeBlocksOf(parsed.tree)) {
        if (!isRegisteredGrammar(b.lang)) continue;
        seen += 1;
        expect(checkHighlightHtml(colour(b.lang, b.raw)), `${c.name} ${b.lang}`).not.toBeNull();
      }
    }
    expect(seen).toBeGreaterThan(30);
  });

  it('a language-NAME wrapper for every registered name and alias, and the two real subLanguage shapes', () => {
    for (const n of HIGHLIGHT_NAME_SET) expect(checkHighlightHtml(`<span class="language-${n}">x</span>`), n).not.toBeNull();
    const md = colour('markdown', 'text <b>bold</b>');
    const docker = colour('dockerfile', 'RUN apt-get install -y a && echo "b"');
    expect(md).toContain('class="language-xml"');
    expect(docker).toContain('class="language-bash"');
    expect(checkHighlightHtml(md)).not.toBeNull();
    expect(checkHighlightHtml(docker)).not.toBeNull();
  });

  it('nested scope classes, the five entities and plain text', () => {
    const html = '<span class="hljs-title class_ inherited__">A</span> &amp; &lt; &gt; &quot; &#x27; <span class="hljs-meta"><span class="hljs-keyword">x</span></span>';
    expect(checkHighlightHtml(html)?.html).toBe(html);
    expect(checkHighlightHtml('')?.html).toBe('');
  });
});

describe('M4.H14: what the check refuses (each leaves the block plain)', () => {
  it.each([
    ['an img with onerror', '<img src=x onerror=alert(1)>'],
    ['an event attribute on a span', '<span onclick="x">a</span>'],
    ['a class without the hljs- prefix', '<span class="x">a</span>'],
    ['an unknown language name', '<span class="language-nope">a</span>'],
    ['a single-quoted class', "<span class='hljs-x'>a</span>"],
    ['an upper-case tag', '<SPAN class="hljs-x">a</SPAN>'],
    ['an upper-case class character', '<span class="hljs-X">a</span>'],
    ['an empty scope', '<span class="hljs-">a</span>'],
    ['a second attribute', '<span class="hljs-a" id="x">a</span>'],
    ['a link', '<a href="https://a.example">a</a>'],
    ['a named entity outside the five', 'a&nbsp;b'],
    ['a numeric entity', 'a&#60;b'],
    ['a bare <', 'a < b'],
    ['a bare >', 'a > b'],
    ['a raw double quote', 'say "x"'],
    ['a raw single quote', "it's"],
    ['an unclosed span', '<span class="hljs-x">a'],
    ['an extra </span>', 'a</span>'],
    ['a closer before its opener', '</span><span class="hljs-x">a'],
  ])('%s', (_name, html) => {
    expect(checkHighlightHtml(html)).toBeNull();
  });
});

describe('M4.H14: the check is one linear pass', () => {
  const steps = (html: string): number => {
    const s = { n: 0 };
    checkHighlightHtml(html, s);
    return s.n;
  };
  it.each([
    ['unterminated span openers', (n: number) => '<span class="hljs-'.repeat(n)],
    ['valid but never closed spans', (n: number) => '<span class="hljs-a">'.repeat(n)],
    ['plain text', (n: number) => 'a'.repeat(n * 20)],
    ['balanced spans', (n: number) => '<span class="hljs-a">b</span>'.repeat(n)],
  ])('%s: steps grow in proportion to the input (n against 2n)', (_name, make) => {
    const small = make(1 << 15);
    const big = make(1 << 16);
    expect(steps(small)).toBeLessThanOrEqual(2 * small.length);
    expect(steps(big)).toBeLessThanOrEqual(2.05 * steps(small) + 64);
    expect(big.length).toBeGreaterThan(1.9 * small.length);
  });
});

describe('only the check makes a CheckedHighlightHtml', () => {
  it('its answer is frozen and accepted; a look-alike, a string and null are not', () => {
    const checked = checkHighlightHtml('<span class="hljs-a">b</span>')!;
    expect(Object.isFrozen(checked)).toBe(true);
    expect(isCheckedHighlightHtml(checked)).toBe(true);
    expect(isCheckedHighlightHtml(Object.freeze({ html: checked.html }))).toBe(false);
    expect(isCheckedHighlightHtml(checked.html)).toBe(false);
    expect(isCheckedHighlightHtml(null)).toBe(false);
  });
});
