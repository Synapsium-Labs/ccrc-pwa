// The mockup pre-scan (native Docs reader, completion plan Task 5, C1; base spec 2026-10-01 5.6.2; rows M5.22 and the
// counting rules of 5.6.2). `prescanMockup` is one linear pass over the raw text that decides, before the browser's
// uncancellable parse, whether the page may be parsed at all: the depth of a stack of open names, the count of every
// start and end tag, and a multiset of open formatting elements that only each element's own end tag decrements. Every
// limit is inclusive, and every fixture here is built from the constants `policy.ts` exports, never from a literal, except
// the absolute pins of the limits' measured values (fix round 1, A6), which red when any limit is raised.
// A fixture that quotes a limit's value would stay green when the value moved.
// v2 (D-8661) changes WHEN a push, a pop and a formatting decrement happen: an end tag the parser ignores no longer pops
// or decrements, and no start tag pushes inside a comment, a bogus comment or a tag's attribute section. Rows that
// pinned v1's pop behaviour are changed below and named in the C1 report; the property test at the end holds the whole
// rule to what a real parser builds.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCS_MAX_DOC_BYTES } from '../../shared/docs';
import { prescanMockup } from '../src/docs/mockup/prescan';
import {
  MOCKUP_FORMATTING_ELEMENTS, MOCKUP_MAX_ATTRIBUTES, MOCKUP_MAX_DEPTH, MOCKUP_MAX_OPEN_FORMATTING, MOCKUP_MAX_TAGS, MOCKUP_VOID_ELEMENTS,
} from '../src/docs/mockup/policy';

const D = MOCKUP_MAX_DEPTH;
const T = MOCKUP_MAX_TAGS;
const F = MOCKUP_MAX_OPEN_FORMATTING;
const A = MOCKUP_MAX_ATTRIBUTES;
const rep = (s: string, n: number): string => s.repeat(n);

describe('depth: the stack of open names (limit inclusive)', () => {
  it('exactly MOCKUP_MAX_DEPTH nested divs are admitted, with the depth reached', () => {
    expect(prescanMockup(rep('<div>', D))).toEqual({ ok: true, depth: D, tags: D, formatting: 0 });
  });

  it('one more is refused too-deep, with the counts at that moment (the scan stops there)', () => {
    expect(prescanMockup(rep('<div>', D + 1))).toEqual({ ok: false, why: 'too-deep', depth: D + 1, tags: D + 1, formatting: 0 });
    expect(prescanMockup(rep('<div>', D + 50))).toEqual({ ok: false, why: 'too-deep', depth: D + 1, tags: D + 1, formatting: 0 });
  });

  it('a self-close slash still pushes (conservative): <div/> is open', () => {
    expect(prescanMockup(rep('<div/>', D)).ok).toBe(true);
    expect(prescanMockup(rep('<div/>', D + 1))).toMatchObject({ ok: false, why: 'too-deep' });
  });

  it('an end tag pops only when its match is the TOP entry: anything above the match blocks it, and is retained', () => {
    // v6: the scan never pops through an entry it holds, because the parser may not hold that entry (a stale one).
    const base = `${rep('<div>', 250)}<span></div>`;
    expect(prescanMockup(`${base}${rep('<p>', D - 251)}`)).toMatchObject({ ok: true, depth: D });
    expect(prescanMockup(`${base}${rep('<p>', D - 250)}`)).toMatchObject({ ok: false, why: 'too-deep' });
    expect(prescanMockup(`${rep('<div>', 250)}<span></span></div>${rep('<p>', D - 249)}`)).toMatchObject({ ok: true, depth: D });
  });

  it('an end tag with no matching open name is ignored: it pops nothing', () => {
    expect(prescanMockup(`${rep('<div>', D - 1)}</span><div>`)).toMatchObject({ ok: true, depth: D });
    expect(prescanMockup(`${rep('<div>', D - 1)}</span><div><div>`)).toMatchObject({ ok: false, why: 'too-deep' });
    expect(prescanMockup('</x></y></z>')).toEqual({ ok: true, depth: 0, tags: 3, formatting: 0 });
  });

  it('the depth reported is the maximum reached, not where the text ends', () => {
    expect(prescanMockup(`${rep('<div>', 10)}${rep('</div>', 10)}<p>`)).toEqual({ ok: true, depth: 10, tags: 21, formatting: 0 });
  });

  it('the old divergence shape: </span> is BLOCKED by the div above it, so the stack keeps what the parser keeps', () => {
    // v1 popped here and kept depth 2; the parser ignores </span> with a div on top, so v2 changes nothing at </span>.
    expect(prescanMockup(rep('<span><div></span>', 100))).toEqual({ ok: true, depth: 200, tags: 300, formatting: 0 });
  });

  it('upper-case names count, and an end tag matches a name in another case', () => {
    expect(prescanMockup(rep('<DIV>', D + 1))).toMatchObject({ ok: false, why: 'too-deep' });
    expect(prescanMockup(rep('<DiV></dIv>', 400))).toEqual({ ok: true, depth: 1, tags: 800, formatting: 0 });
  });

  it('only A-Z are lowered: the Kelvin sign (U+212A) is not a K, so </\u212A> matches no <k>', () => {
    // toLowerCase would turn it into 'k' and let the close pop one <k>: 256 would be admitted instead of 257 refused.
    expect(prescanMockup(`${rep('<k>', D - 1)}</\u212A><k><k>`)).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
  });
});

describe('void elements push nothing', () => {
  it.each([...MOCKUP_VOID_ELEMENTS])('<%s> never raises the depth, in either case', (name) => {
    expect(prescanMockup(`${rep(`<${name}>`, D + 10)}${rep(`<${name.toUpperCase()}/>`, 10)}`)).toMatchObject({ ok: true, depth: 0 });
  });

  it('an end tag of a void name is ignored', () => {
    expect(prescanMockup(`<div></br></div>`)).toEqual({ ok: true, depth: 1, tags: 3, formatting: 0 });
  });
});

describe('tags: every start and end tag counts (limit inclusive)', () => {
  it('exactly MOCKUP_MAX_TAGS tags are admitted; one more is refused too-many-tags', () => {
    expect(prescanMockup(rep('<br>', T))).toEqual({ ok: true, depth: 0, tags: T, formatting: 0 });
    expect(prescanMockup(rep('<br>', T + 1))).toEqual({ ok: false, why: 'too-many-tags', depth: 0, tags: T + 1, formatting: 0 });
    expect(prescanMockup(rep('<br>', T + 500))).toEqual({ ok: false, why: 'too-many-tags', depth: 0, tags: T + 1, formatting: 0 });
  });

  it('an end tag counts, matched or not', () => {
    const pairs = Math.floor(T / 2);
    const text = rep('<p></p>', pairs);
    expect(prescanMockup(text)).toMatchObject({ ok: true, tags: pairs * 2 });
    expect(prescanMockup(`${text}${rep('</q>', T - pairs * 2)}`)).toMatchObject({ ok: true, tags: T });
    expect(prescanMockup(`${text}${rep('</q>', T - pairs * 2 + 1)}`)).toMatchObject({ ok: false, why: 'too-many-tags', tags: T + 1 });
  });
});

describe('formatting: a multiset only each element\'s own end tag decrements (limit inclusive)', () => {
  it('exactly MOCKUP_MAX_OPEN_FORMATTING open <b> are admitted; one more is refused too-many-formatting', () => {
    expect(prescanMockup(rep('<b>', F))).toEqual({ ok: true, depth: F, tags: F, formatting: F });
    expect(prescanMockup(rep('<b>', F + 1))).toEqual({ ok: false, why: 'too-many-formatting', depth: F + 1, tags: F + 1, formatting: F + 1 });
    expect(prescanMockup(rep('<b>', F + 40))).toEqual({ ok: false, why: 'too-many-formatting', depth: F + 1, tags: F + 1, formatting: F + 1 });
  });

  it.each([...MOCKUP_FORMATTING_ELEMENTS])('<%s> is a formatting element', (name) => {
    expect(prescanMockup(rep(`<${name}>`, F + 1))).toMatchObject({ ok: false, why: 'too-many-formatting' });
    expect(prescanMockup(rep(`<${name.toUpperCase()}>`, F))).toMatchObject({ ok: true, formatting: F });
  });

  it('the names are counted together: a mix of elements shares the one limit', () => {
    const names = [...MOCKUP_FORMATTING_ELEMENTS];
    const mix = (n: number): string => Array.from({ length: n }, (_, i) => `<${names[i % names.length]!}>`).join('');
    expect(prescanMockup(mix(F))).toMatchObject({ ok: true, formatting: F });
    expect(prescanMockup(mix(F + 1))).toMatchObject({ ok: false, why: 'too-many-formatting' });
  });

  it('an element that is not a formatting element is not counted', () => {
    expect(prescanMockup(`${rep('<span>', 100)}${rep('<div>', 100)}`)).toMatchObject({ ok: true, formatting: 0 });
  });

  it('an unrelated close does not cancel an open one: </p> popping through <b> leaves it counted', () => {
    const half = Math.floor(F / 2);
    const text = `<p>${rep('<b>', half)}</p><p>${rep('<b>', F - half + 1)}`;
    expect(prescanMockup(text)).toMatchObject({ ok: false, why: 'too-many-formatting', formatting: F + 1 });
    expect(prescanMockup(`<p>${rep('<b>', half)}</p><p>${rep('<b>', F - half)}`)).toMatchObject({ ok: true, formatting: F });
  });

  it('a close of another formatting element is blocked by the <i> above it, so both stay counted: <b><i></b> repeated', () => {
    expect(prescanMockup(rep('<b><i></b>', F / 2))).toMatchObject({ ok: true, formatting: F });
    expect(prescanMockup(rep('<b><i></b>', F / 2 + 1))).toMatchObject({ ok: false, why: 'too-many-formatting' });
  });

  it('a formatting element\'s own end tag does decrement', () => {
    expect(prescanMockup(rep('<b></b>', 1000))).toMatchObject({ ok: true, depth: 1, formatting: 1 });
    expect(prescanMockup(`${rep('<b>', F)}</b><b>`)).toMatchObject({ ok: true, formatting: F });
    expect(prescanMockup(`${rep('<b>', F)}</B><b>`)).toMatchObject({ ok: true, formatting: F });
    expect(prescanMockup(`${rep('<b>', F)}</b><b><b>`)).toMatchObject({ ok: false, why: 'too-many-formatting' });
  });

  it('an end tag with nothing open does not take the count below zero', () => {
    expect(prescanMockup(`${rep('</b>', 10)}${rep('<b>', F)}`)).toMatchObject({ ok: true, formatting: F });
    expect(prescanMockup(`${rep('</b>', 10)}${rep('<b>', F + 1)}`)).toMatchObject({ ok: false, why: 'too-many-formatting' });
  });

  it('the formatting reconstruction shape: <b> opened in a <p>, then many <p>x</p>', () => {
    const shape = (open: number): string => `<p>${rep('<b>', open)}${rep('<p>x</p>', 100)}`;
    expect(prescanMockup(shape(F))).toMatchObject({ ok: true, formatting: F });
    expect(prescanMockup(shape(F + 1))).toMatchObject({ ok: false, why: 'too-many-formatting' });
  });
});

describe('every tag is still COUNTED, wherever it sits (v2); only the regions the tokenizer makes text push nothing', () => {
  it.each([
    ['a comment', `<!--${rep('<br>', T + 1)}-->`],
    ['a bogus comment', `<!x${rep('<br>', T + 1)}>`],
    ['a double-quoted attribute value', `<p title="${rep('<br>', T + 1)}">`],
    ['a single-quoted attribute value', `<p title='${rep('<br>', T + 1)}'>`],
    ['<script>', `<script>${rep('<br>', T + 1)}</script>`],
    ['an unterminated comment', `<!--${rep('<br>', T + 1)}`],
  ])('%s cannot hide tags from the count', (_name, text) => {
    expect(prescanMockup(text)).toMatchObject({ ok: false, why: 'too-many-tags', tags: T + 1 });
  });

  it('an unquoted attribute value that runs on as <br <br ... is a run of attribute NAMES (D-8671): refused by the attribute cap before the tag limit', () => {
    expect(prescanMockup(`<p title=${rep('<br ', T + 1)}>`)).toMatchObject({ ok: false, why: 'too-many-attributes' });
  });

  it('a tag inside a comment, a bogus comment or an attribute section is counted and pushes nothing', () => {
    expect(prescanMockup('<!--<div></div>-->')).toEqual({ ok: true, depth: 0, tags: 2, formatting: 0 });
    expect(prescanMockup('<!x <div>>')).toEqual({ ok: true, depth: 0, tags: 1, formatting: 0 });
    expect(prescanMockup('<p title="<div></div>">')).toEqual({ ok: true, depth: 1, tags: 3, formatting: 0 });
    expect(prescanMockup('</p <b>')).toEqual({ ok: true, depth: 0, tags: 2, formatting: 0 });
    expect(prescanMockup(`<!--${rep('<b>', F + 1)}-->`)).toMatchObject({ ok: true, formatting: 0 });
    expect(prescanMockup(`<p title="${rep('<b>', F + 1)}">`)).toMatchObject({ ok: true, formatting: 0 });
  });

  it.each([
    ['<script>', 'script'],
    ['<style>', 'style'],
    ['<textarea>', 'textarea'],
    ['<title>', 'title'],
    ['<xmp>', 'xmp'],
    ['<iframe>', 'iframe'],
    ['<noembed>', 'noembed'],
    ['<noframes>', 'noframes'],
    ['<plaintext>', 'plaintext'],
  ])('raw text of %s pushes nothing and counts its tags; the element ends exactly at its own end tag (v5)', (_name, tag) => {
    expect(prescanMockup(`<${tag}>${rep('<div>', D + 1)}`)).toMatchObject({ ok: true, depth: 1, tags: D + 2 });
    expect(prescanMockup(`<${tag}><!--${rep('<div>', D + 1)}-->${rep('<b data-i=1>', F + 1)}`)).toMatchObject({ ok: true, depth: 1, formatting: 0 });
    if (tag !== 'plaintext') {
      expect(prescanMockup(`<${tag}>${rep('<div>', D + 1)}</${tag}>${rep('<div>', D + 1)}`)).toMatchObject({ ok: false, why: 'too-deep' });
      expect(prescanMockup(`<${tag}>x</${tag}>${rep('<div>', D)}`)).toMatchObject({ ok: true, depth: D });
    }
  });
});

describe('what is a tag', () => {
  it.each([
    ['a space after <', '< div>'],
    ['a digit', '<1>'],
    ['a bang', '<!doctype html>'],
    ['a question mark', '<?xml version="1.0"?>'],
    ['an end tag with a space', '</ div>'],
    ['an end tag with nothing', '</>'],
    ['a bare <', 'a < b'],
    ['a trailing <', 'text<'],
    ['a trailing </', 'text</'],
    ['a non-ASCII letter', '<él>'],
  ])('%s is not a tag', (_name, text) => {
    expect(prescanMockup(text)).toEqual({ ok: true, depth: 0, tags: 0, formatting: 0 });
  });

  it('a tag at the end of the text, with no closing >, still counts', () => {
    expect(prescanMockup('<div')).toEqual({ ok: true, depth: 1, tags: 1, formatting: 0 });
    expect(prescanMockup('</div')).toEqual({ ok: true, depth: 0, tags: 1, formatting: 0 });
  });

  it.each([
    ['tab', '\t'], ['line feed', '\n'], ['form feed', '\f'], ['carriage return', '\r'], ['space', ' '], ['slash', '/'], ['>', '>'],
  ])('a name ends at %s', (_name, end) => {
    // <b?> has the name b and counts as formatting; if the name ran on, `b?`/`b` would not be a formatting element.
    expect(prescanMockup(`<b${end}x>`)).toMatchObject({ formatting: 1 });
  });

  it('a name does not end at other characters: <b-x> and <b > are not <b>', () => {
    expect(prescanMockup('<b-x><b >')).toMatchObject({ ok: true, depth: 2, tags: 2, formatting: 0 });
    expect(prescanMockup('<div-x></div>')).toMatchObject({ ok: true, depth: 1, tags: 2 });
  });

  it('a start tag inside an end tag\'s attributes counts as a tag but pushes nothing (v1 counted its formatting)', () => {
    expect(prescanMockup('</p <b>')).toMatchObject({ ok: true, tags: 2, formatting: 0 });
  });
});

describe('v2 (D-8661): an end tag the parser ignores neither pops nor decrements; the review\'s shapes are REFUSED', () => {
  const kinds = (text: string) => { const v = prescanMockup(text); return v.ok ? 'ok' : v.why; };

  it('(1) <b data-i=k><table></b></table> repeated, then paragraphs: </b> is blocked by the table, so formatting stays counted', () => {
    const text = `<div>${Array.from({ length: 1874 }, (_, k) => `<b data-i=${k}><table></b></table>`).join('')}</div>${rep('<p>x</p>', 3751)}`;
    expect(prescanMockup(text)).toMatchObject({ ok: false, why: 'too-many-formatting', formatting: F + 1 });
  });

  it('(1b) the same with <svg><desc></b></desc></svg> in place of the table', () => {
    const text = `<div>${Array.from({ length: 1874 }, (_, k) => `<b data-i=${k}><svg><desc></b></desc></svg>`).join('')}</div>${rep('<p>x</p>', 3751)}`;
    // v7: the </b> reaches an HTML entry through the foreign run, which the scan does not follow, so the page is refused at once.
    expect(prescanMockup(text)).toMatchObject({ ok: false, why: 'foreign-markup' });
  });

  it('(2) 58 x (<span> + 255 divs + </span>): one </span> above 255 divs pops none of them, so the depth is refused', () => {
    const text = rep(`<span>${rep('<div>', 255)}</span>`, 58);
    expect(prescanMockup(text)).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
  });

  it('(3a) the old divergence shape <span><div></span> to the tag limit is refused too-deep', () => {
    expect(kinds(rep('<span><div></span>', T / 3))).toBe('too-deep');
  });

  it('(3b) the misnested <b><div></b> to the tag limit is refused too-many-formatting (before the depth reaches its limit)', () => {
    expect(prescanMockup(rep('<b><div></b>', T / 3))).toMatchObject({ ok: false, why: 'too-many-formatting' });
  });

  it('(3c) the same with distinct attributes is refused too-many-formatting', () => {
    const text = Array.from({ length: T / 3 }, (_, k) => `<b data-i="${k}"><div></b>`).join('');
    expect(prescanMockup(text)).toMatchObject({ ok: false, why: 'too-many-formatting' });
  });

  it.each([
    ['a comment', '<div><!--</div>-->'],
    ['a bogus comment', '<div><!x</div>>'],
    ['a processing-instruction comment', '<div><?x </div>>'],
    ['an attribute value', '<div title="</div>">'],
    ['a single-quoted attribute value', "<div title='</div>'>"],
  ])('(4) %s can no longer pop: <div>... repeated grows the depth and is refused', (_name, unit) => {
    expect(prescanMockup(rep(unit, D + 1))).toMatchObject({ ok: false, why: 'too-deep' });
  });

  it('(4b) <i title="</i>"> repeated cannot pop either: the formatting count grows and is refused', () => {
    expect(prescanMockup(rep('<i title="</i>">', F + 1))).toMatchObject({ ok: false, why: 'too-many-formatting' });
  });

  it('(5) raw text cannot pop what is below it: <div><script></div></script> repeated is refused', () => {
    expect(prescanMockup(rep('<div><script></div></script>', D + 1))).toMatchObject({ ok: false, why: 'too-deep' });
  });

  it("(5b) a script's own end tag still pops what its text pushed: <div><script>'<li><li>'</script></div> x 1000 is admitted", () => {
    expect(prescanMockup(rep("<div><script>'<li><li>'</script></div>", 1000))).toMatchObject({ ok: true, depth: 2 });
  });

  it('(5c) only a raw element\'s own end tag pops in raw mode: </style> inside a script pops nothing', () => {
    expect(prescanMockup(`<script>${rep('<style></style>', 5)}</script>`)).toMatchObject({ ok: true, tags: 12 });
    expect(prescanMockup(rep('<script></p></script>', 1000))).toMatchObject({ ok: true, depth: 1 });
  });

  it('(6) a formatting end tag that is blocked does not decrement; one with no match does not either', () => {
    expect(prescanMockup(rep('<b><div></b>', F))).toMatchObject({ ok: true, formatting: F });
    expect(prescanMockup(rep('<b><div></b>', F + 1))).toMatchObject({ ok: false, why: 'too-many-formatting' });
    expect(prescanMockup(`${rep('<b>', F)}${rep('</i>', 100)}<b>`)).toMatchObject({ ok: false, why: 'too-many-formatting' });
  });

});

describe('v2 (D-8661): the corrections the review of the rule added', () => {
  it('a comment ends at <!-->, at <!---> and at --!>, as the tokenizer ends it, so what follows is markup', () => {
    for (const open of ['<!-->', '<!--->', '<!-- x --!>', '<!----!>', '<!-- x --->']) {
      expect(prescanMockup(`${open}${rep('<div>', D + 1)}-->`), open).toMatchObject({ ok: false, why: 'too-deep' });
    }
  });

  it('a real comment still hides its pushes, and its own end marker is not part of it', () => {
    expect(prescanMockup(`<!-- ${rep('<div>', D + 1)} -->`)).toMatchObject({ ok: true, depth: 0 });
    expect(prescanMockup(`<!---->${rep('<div>', D)}`)).toMatchObject({ ok: true, depth: D });
    expect(prescanMockup(`<!--- x -->${rep('<div>', D)}`)).toMatchObject({ ok: true, depth: D });
    expect(prescanMockup(`<!---!>${rep('<div>', D + 1)}-->`)).toMatchObject({ ok: true, depth: 0 });
  });

  it('an unterminated comment runs to the end of the text', () => {
    expect(prescanMockup(`<!-- ${rep('<div>', D + 5)}`)).toMatchObject({ ok: true, depth: 0 });
  });

  it('a bogus comment ends at the first >: <!DOCTYPE, <![CDATA[ and <? alike', () => {
    expect(prescanMockup(`<!DOCTYPE html>${rep('<div>', D)}`)).toMatchObject({ ok: true, depth: D });
    expect(prescanMockup(`<![CDATA[ x ]]>${rep('<div>', D)}`)).toMatchObject({ ok: true, depth: D });
    expect(prescanMockup(`<? x ?>${rep('<div>', D)}`)).toMatchObject({ ok: true, depth: D });
    expect(prescanMockup(`<!x>${rep('<div>', D + 1)}`)).toMatchObject({ ok: false, why: 'too-deep' });
    expect(prescanMockup(`</ x>${rep('<div>', D + 1)}`)).toMatchObject({ ok: false, why: 'too-deep' });
    expect(prescanMockup(`</>${rep('<div>', D + 1)}`)).toMatchObject({ ok: false, why: 'too-deep' });
  });

  it('</body> and </html> change nothing: the parser keeps its stack', () => {
    for (const name of ['body', 'html']) {
      expect(prescanMockup(rep(`<${name}>${rep('<span>', 200)}</${name}>`, 70)), name).toMatchObject({ ok: false, why: 'too-deep' });
    }
    expect(prescanMockup(`<html><body><p>x</p></body></html>`)).toEqual({ ok: true, depth: 3, tags: 6, formatting: 0 });
  });

  it('</form> never pops: the parser ignores it with a null form pointer, so a form entry stays (and blocks what is below it)', () => {
    expect(prescanMockup(rep('<form></form>', D))).toMatchObject({ ok: true, depth: D });
    expect(prescanMockup(rep('<form></form>', D + 1))).toMatchObject({ ok: false, why: 'too-deep' });
    expect(prescanMockup(rep('<div><form></form></div>', 100))).toMatchObject({ ok: true, depth: 200 });
    expect(prescanMockup(rep('<form><span></form>', D))).toMatchObject({ ok: false, why: 'too-deep' });
  });



});

describe('v2 (D-8661): the attribute section is tokenized as the tokenizer does', () => {
  it('a quote opens a value ONLY after =: in a name, or inside an unquoted value, it is data', () => {
    expect(prescanMockup(rep('<div a=b"c>', D + 1))).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
    expect(prescanMockup(rep('<div a"b>', D + 1))).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
    expect(prescanMockup(rep(`<div a'b>`, D + 1))).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
    expect(prescanMockup(rep('<div "a>', D + 1))).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
  });

  it('a quoted value hides a > and a tag inside it, but the tag still counts', () => {
    expect(prescanMockup('<p a=">" b=\'<div>\'><div>')).toEqual({ ok: true, depth: 2, tags: 3, formatting: 0 });
  });

  it('a missing value ends at >: <div a=> and <div a= >', () => {
    expect(prescanMockup(rep('<div a=>', D + 1))).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
    expect(prescanMockup(rep('<div a= >', D + 1))).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
  });

  it('a value directly after a quoted value, and a self-closing slash, are read in their own states', () => {
    expect(prescanMockup(rep('<div a="x"b="<p>">', D + 1))).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
    expect(prescanMockup(rep('<div a="x"/>', D + 1))).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
    expect(prescanMockup(rep('<div / a="<p>">', D + 1))).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
    expect(prescanMockup(rep('<div =">">', D + 1))).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
  });

  it('an unquoted value runs to whitespace or >, and the next attribute name may start with a quote or <', () => {
    expect(prescanMockup(rep('<div a=b <p>', D + 1))).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
  });

  it('a tag whose attribute section never ends runs to the end of the text', () => {
    expect(prescanMockup(`<div a="${rep('<div>', 50)}`)).toMatchObject({ ok: true, depth: 1, tags: 51 });
  });

  it('end tags tokenize attributes the same way: </div a=">"> is one end tag', () => {
    expect(prescanMockup('<div></div a=">"><span>')).toEqual({ ok: true, depth: 1, tags: 3, formatting: 0 });
  });
});

describe('v6 (D-8663): ordinary markup stays admitted (RE-BASELINED: an omitted end tag is retained, so each page repeats a unit a realistic 30 times, not 300)', () => {
  it.each([
    ['an omitted </p> before </div>', '<div><p>text</div>'],
    ['an omitted </li> before </ul>', '<ul><li>a<li>b</ul>'],
    ['an omitted </li> inside a nested list', '<ul><li>a<ul><li>b</ul></ul>'],
    ['omitted </td></tr> before </table>', '<table><tr><td>x<td>y<tr><td>z</table>'],
    ['an omitted </tbody></tr></td> before </table>', '<table><thead><tr><th>h<tbody><tr><td>x</table>'],
    ['<dl><dt><dd>', '<dl><dt>a<dd>b<dt>c<dd>d</dl>'],
    ['<select><option><option>', '<select><option>a<option>b<optgroup><option>c</select>'],
    ['an unclosed inline element before a block end tag', '<div><span>a<a href="x">b</a></div>'],
    ['a comment full of markup', '<!-- <div><p><b data-i=1><table> -->'],
    ['an attribute value full of <div>', '<p title="<div><div><div>">x</p>'],
    ['a script full of <div> strings', '<script>var s = "<div><div><div>";</script>'],
    ['a style full of <div> text', '<style>/* <div><div> */ a { }</style>'],
    ['a textarea and a title full of markup', '<textarea><div><p></textarea><title><span><div></title>'],
    ['an inline svg with a title', '<svg><title>t</title><g><path d="M0"></path></g></svg>'],
    ['a button holding a span', '<button><span>x</button>'],
    ['a heading with an unclosed inline element', '<h2>a <span>b</h2>'],
    ['a template', '<template><p>x</template>'],
    ['an object with an unclosed inline element', '<object><span>x</object>'],
  ])('%s, repeated 30 times', (_name, unit) => {
    expect(prescanMockup(rep(unit, 30)).ok).toBe(true);
  });

  it('the cost, pinned: an end tag the markup omits leaves its element on the stack, and a page that omits 256 of them is refused', () => {
    expect(prescanMockup(rep('<div><p>text</div>', 128))).toMatchObject({ ok: true, depth: D });
    expect(prescanMockup(rep('<div><p>text</div>', 129))).toMatchObject({ ok: false, why: 'too-deep' });
    expect(prescanMockup(rep('<ul><li>a<li>b</ul>', 85))).toMatchObject({ ok: true, depth: 255 });
    expect(prescanMockup(rep('<ul><li>a<li>b</ul>', 86))).toMatchObject({ ok: false, why: 'too-deep' });
  });

  it('formatting starts inside raw text are not counted (v5: raw text pushes nothing), and the element\'s own end tag ends it', () => {
    expect(prescanMockup(`<script>${rep('<b>', F + 1)}</script>`)).toMatchObject({ ok: true, formatting: 0 });
    expect(prescanMockup(`<script>${rep('<b></b>', F + 1)}</script><b>`)).toMatchObject({ ok: true, formatting: 1 });
  });

  it('a whole document: doctype, head, body, a table and a script', () => {
    const doc = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title><style>a{}</style></head>'
      + '<body><div class="a"><p>x<table><tr><td>1<td>2</table></div><script>if (a < b) { var s = "</p>"; }</script></body></html>';
    expect(prescanMockup(doc)).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The property (D-8661; the review's reconstruction bound). A page the pre-scan ADMITS must not make a real parser
// build more than `(MOCKUP_MAX_OPEN_FORMATTING + 4) * tags + 16` elements: at most F clones per tag. The parser here is
// the test environment's own `DOMParser` (jsdom, parse5 underneath); `pwa/src` never names one outside parse.ts. The
// documents come from a deterministic PRNG over a grammar of hostile pieces, in segments of one unit repeated (a
// hostile unit, then a fill), 200 to 3000 tags each, under the REAL limits. A v1 pre-scan fails this row: its pops
// and decrements follow end tags the parser ignores, so it admits the review's shape and the parser builds millions.
// ---------------------------------------------------------------------------------------------------------------
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The pieces a random unit is built from; `@` becomes the unit's running number, so attributes stay distinct. */
const PIECES: readonly string[] = [
  '<b data-i=@>', '<i data-i="@">', "<em data-i='@'>", '<font data-i=@>', '<u data-i="@">', '<code data-i="@">', '<s data-i="@">',
  '<small data-i="@">', '<strong data-i="@">', '<tt data-i="@">', '<big data-i="@">', '<strike data-i="@">', '<a href="#@">', '<nobr>',
  '</b>', '</i>', '</em>', '</a>', '</font>', '</u>', '</nobr>', '</code>',
  '<div>', '</div>', '<p>', '</p>', '<span>', '</span>', '<li>', '</li>', '<ul>', '</ul>', '<table>', '</table>', '<tbody>', '<tr>', '</tr>', '<td>', '</td>',
  '<th>', '<caption>', '<colgroup>', '<svg>', '</svg>', '<desc>', '</desc>', '<math>', '</math>', '<mi>', '</mi>', '<foreignObject>', '</foreignObject>',
  '<select>', '</select>', '<option>', '</option>', '<optgroup>', '<template>', '</template>', '<form>', '</form>', '<body>', '</body>', '<html>', '</html>',
  '<noscript>', '</noscript>', '<button>', '</button>', '<h1>', '</h1>', '<section>', '</section>', '<dd>', '<dt>', '<dl>', '</dl>',
  '<script>', '</script>', '<style>', '</style>', '<textarea>', '</textarea>', '<title>', '</title>', '<xmp>', '<iframe>', '</iframe>',
  '<!--', '-->', '<!-->', '<!--->', '--!>', '<!x>', '<!x', '<?p', '>', '<!DOCTYPE html>',
  '<div title="</b>">', "<p title='<div>'>", '<b data-i="@" title="</b>">', '<span a=">', '"', "'", '<a b=c"d>', '<div a=>', '<div a="x"b=y/>',
  '</span>', '</td>', '</table>', 'x', ' ', '<br>', '<img src=a>',
  // v3: foreign content, integration points, text-only foreign elements, CDATA and breakouts.
  '<g>', '</g>', '<path/>', '<use href=#a>', '<font>', '<font color=red>', '</font>', '<annotation-xml>', '</annotation-xml>', '<mo>', '<mtext>',
  '<script>', '</script>', '<!--<script>', '<!-->', '<svg / >', '<svg /\t>', '<svg / x>', '<svg/ >', '<svg a=b/>', '<style><style>', '</style>', '<title>', '<textarea>', '<xmp>',
  '<svg><g></svg>', '<svg><path/></svg>', '<math><mrow></math>', '<section>', '</svg>', '</g>', '<g>', '<path/>', '<use/>',
  // The cap (D-8671): attribute-rich tags (the cap refuses them; the property bound counts elements, so it cannot see their cost: the Chromium gates do).
  `<b${Array.from({ length: 70 }, (_, k) => ` a${k}`).join('')}>`, `<div${Array.from({ length: 70 }, (_, k) => ` a${k}`).join('')}>`, '<b a b a b a b a>', '<b a=1 b=\'2\' c="3" d>',
  '<![CDATA[>', '<svg></p>', '<math></br>', '<font color=x>', '<template><col>', '<tr>', '<caption>', '<form>', '</form>',
  '<![CDATA[', ']]>', '<![CDATA[x]]>', '<svg><style>', '</style></svg>', '<svg><title>', '</title></svg>', '<svg><desc>', '<math><mi>',
  '<svg><foreignObject>', '</foreignObject></svg>', '<div><svg>', '</div>', '<svg/>', '<math/>', '<object>', '</object>', '<applet>', '<marquee>', '<template>',
];
/** Units known to fool a pop rule that follows an end tag the parser ignores (the review's classes, and this rule's own). */
/** The raw-text names whose text the tokenizer ends at its own end tag (plaintext never ends). */
const RAW_NAMES = ['style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'script'] as const;
const SEEDS: readonly string[] = [
  '<b data-i=@><table></b></table>', '<b data-i=@><svg><desc></b></desc></svg>', '<b data-i=@><div></b>', '<span><div></span>',
  '<form><span></form>', '<body><span></body>', '<html><i data-i=@></html>', '<select><div><b data-i=@></select>', '<noscript><p></noscript>',
  '<!--><b data-i=@>', '<i data-i=@><template></i></template>', '<b data-i=@><button></b></button>', '<a href=@><p></a>', '<p><b data-i=@></p>',
  '<b data-i=@><math><mi></b></mi></math>', '<em data-i=@><td></em></td>', '<!-- x --!><b data-i=@>',
  // v3: the review's foreign-content shapes (the desc and mi ones are invisible to parse5, the rest are not).
  '<b data-i=@><svg><foreignObject><span></foreignObject></svg></b>', '<b data-i=@><svg><desc><span></desc></svg></b>',
  '<b data-i=@><math><mi><span></mi></math></b>', '<svg><foreignObject><span></foreignObject></svg>', '<b data-i=@><svg><font><foreignObject><span></foreignObject></svg></b>',
  '<svg><font color=red><title><!--</title><b data-i=@>--></title></font></svg>', '<b data-i=@><svg><style><!--</style></b>--></svg>',
  '<b data-i=@><svg><style><g title="</style></b>"></svg>', '<svg><style><![CDATA[</style><b data-i=@>]]></style></svg>', '<svg><g><div>',
  // v4: a self-closed root is popped at once by the parser, and an HTML element with a formatting marker follows it.
  '<b data-i=@><svg/><object></b></object>', '<b data-i=@><svg/><applet></b></applet>', '<b data-i=@><svg/><marquee></b></marquee>', '<b data-i=@><svg/><template></b></template>',
  '<b data-i=@><math/><object></b></object>', '<b data-i=@><math/><applet></b></applet>', '<b data-i=@><math/><marquee></b></marquee>', '<b data-i=@><math/><template></b></template>',
  // v5: a raw name nested in its own text (the tokenizer ends the text at the first end tag), eight divs the parser keeps, script
  // escapes, and whitespace after a slash in a root tag.
  ...RAW_NAMES.map((r) => `<b id=@><${r}><${r}></${r}>${'<div>'.repeat(8)}</${r}></b>`),
  `<b id=@><script><!--<script></script>${'<div>'.repeat(8)}</script></b>`, `<b id=@><script><!--</script>${'<div>'.repeat(8)}</script></b>`,
  `<b id=@><svg / ><style>${'<div>'.repeat(8)}</style></b>`, `<b id=@><svg /\t><style>${'<div>'.repeat(8)}</style></b>`, `<b id=@><svg / x><style>${'<div>'.repeat(8)}</style></b>`,
  `<b id=@><svg/ ><desc></b></desc>`,
  // v6: CDATA after the parser left foreign content (a bogus comment to the first >), a raw-text start the parser ignores in a
  // template, and stale entries (an implicit close, an ignored start tag, a form with a null pointer).
  '<svg></p><![CDATA[><b id=@>]]>', '<math></br><![CDATA[><b id=@>]]>', '<svg><font color=x><![CDATA[><b id=@>]]>',
  '<template><col><xmp></template><b id=@></xmp>', '<template><col><plaintext></template><b id=@>', '<template><col><style></template><b id=@></style>',
  `<b id=@><p><p></p>${'<li><dd>'.repeat(5)}</p></b>`, `<b id=@><h1><h2></h2>${'<li><dd>'.repeat(5)}</h1></b>`,
  `<b id=@><button><button></button>${'<li><dd>'.repeat(5)}</button></b>`, `<b id=@><tr>${'<li><dd>'.repeat(5)}</tr></b>`,
  `<b id=@><td>${'<li><dd>'.repeat(5)}</td></b>`, `<b id=@><caption>${'<li><dd>'.repeat(5)}</caption></b>`,
  `<b id=@>${'<form><table></form></table></form>'.repeat(9)}</b>`, `<b id=@><tr><span></tr></b>`,
  // v7: a stale foreign source, eight elements the parser holds as HTML specials, an exit the parser performs, the close of a b.
  `<b id=@${Array.from({ length: 70 }, (_, k) => ` a${k}`).join('')}><p>x`, `<b id=@><svg><g></svg>${'<section>'.repeat(8)}<br></b>`, `<b id=@><svg><g></svg>${'<section>'.repeat(8)}</p></b>`,
  `<b id=@><svg><path/></svg>${'<article>'.repeat(8)}<font color=r></font></b>`, `<b id=@><math><mrow></math>${'<nav>'.repeat(8)}<span></span></b>`,
  `<a id=@><svg><g></svg>${'<aside>'.repeat(8)}<br></a>`, `<b id=@><svg><g></svg>${'<section>'.repeat(8)}</br></b>`,
  `<b id=@><svg><g><div></svg>${'<section>'.repeat(8)}</b>`, `<b id=@><svg><g></p>${'<section>'.repeat(8)}</b>`,
];
/** What follows a hostile segment: anything that makes a parser reconstruct formatting elements or grow a stack. */
const FILLS: readonly string[] = ['<p>x</p>', '<div>x</div>', '<td>x</td>', '<li>x</li>', 'x', '<span>x</span>', '<p>x', '<tr><td>x', '<h1>x</h1>', '<br>'];

const tagsIn = (unit: string): number => (unit.match(/<\/?[A-Za-z]/g) ?? []).length;

interface Doc { readonly text: string; readonly segments: ReadonlyArray<readonly [string, number]> }

const WRAPS = ['div', 'section', 'p', 'li', 'td', 'table'] as const;

/** `forced` fixes the classic shape's hostile unit and enclosing block, so the first documents cover every seed in every block. */
function genDoc(rand: () => number, forced?: { seed: string; wrap: (typeof WRAPS)[number] }): Doc {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  let budget = 200 + Math.floor(rand() * 2800);
  const units: string[] = [];
  const classic = forced !== undefined || rand() < 0.45;
  if (classic) {
    // The classic shape: one known hostile unit repeated (about a third of the tags), then one fill (the rest): the leak
    // is worth `units x fills` elements, so it needs both big, as the review's measured shapes have.
    units.push(forced?.seed ?? pick(SEEDS));
    // The leak is worth `copies x paragraphs` elements, so a bound of 36 a tag needs about 5 000 tags for the nested-raw units.
    budget = forced !== undefined ? 5000 + Math.floor(rand() * 1000) : 2400 + Math.floor(rand() * 600);
  } else {
    const hostile = 1 + Math.floor(rand() * 2);
    for (let k = 0; k < hostile; k += 1) {
      if (rand() < 0.3) units.push(pick(SEEDS));
      else units.push(Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(PIECES)).join(''));
    }
  }
  units.push(pick(FILLS));
  const weights = classic ? [0.28 + rand() * 0.1, 0.62 - rand() * 0.1] : units.map(() => 0.05 + rand());
  const sum = weights.reduce((x, y) => x + y, 0);
  // Half the documents close an enclosing block between the hostile segments and the fill: that pop takes the parser's
  // stack down while its list of active formatting elements stays, and the fill then reconstructs them (the review's shape).
  const wrap = forced !== undefined ? forced.wrap : rand() < 0.5 ? pick(WRAPS) : null;
  let id = 0;
  const segments: Array<readonly [string, number]> = [];
  let text = '';
  // Half the classic documents hold the hostile unit to a few copies (at most 40, around the formatting limit), so the
  // pre-scan ADMITS them and the bound is tested on the worst shapes it lets through; the fill takes the rest of the tags.
  const fixed = classic && forced === undefined && rand() < 0.5 ? 1 + Math.floor(rand() * 40) : null;
  units.forEach((unit, k) => {
    if (k === units.length - 1 && wrap !== null) text += `</${wrap}>`;
    let times = Math.max(1, Math.min(2000, Math.floor((budget * weights[k]! / sum) / Math.max(1, tagsIn(unit)))));
    if (fixed !== null && k === 0) times = fixed;
    else if (fixed !== null) times = Math.max(1, Math.min(2000, Math.floor((budget - fixed * tagsIn(units[0]!)) / Math.max(1, tagsIn(unit)))));
    if (k === 0 && wrap !== null) text += `<${wrap}>`;
    segments.push([k === 0 && wrap !== null ? `<${wrap}>` + unit : unit, times]);
    for (let r = 0; r < times; r += 1) text += unit.replace(/@/g, () => String((id += 1)));
  });
  return { text, segments };
}

describe('the property: an admitted page never makes a parser build more than (F + 4) x tags + 16 elements', { timeout: 300_000 }, () => {
  it('800 generated documents (every hostile unit in every enclosing block, then random ones) of 200 to 3000 tags, parsed by the test environment\'s own parser', () => {
    const rand = prng(0x5eed1d);
    let admitted = 0;
    let refused = 0;
    const violations: string[] = [];
    let worst = { ratio: 0, perTag: 0, elements: 0, tags: 0, desc: '' };
    for (let n = 0; n < 800; n += 1) {
      const sys = SEEDS.length * WRAPS.length;
      const doc = genDoc(rand, n < sys ? { seed: SEEDS[n % SEEDS.length]!, wrap: WRAPS[Math.floor(n / SEEDS.length)]! } : undefined);
      const verdict = prescanMockup(doc.text);
      if (!verdict.ok) {
        refused += 1;
        continue;
      }
      admitted += 1;
      const elements = new DOMParser().parseFromString(doc.text, 'text/html').getElementsByTagName('*').length;
      const bound = (F + 4) * verdict.tags + 16;
      const ratio = elements / bound;
      if (ratio > worst.ratio) worst = { ratio, perTag: elements / Math.max(1, verdict.tags), elements, tags: verdict.tags, desc: JSON.stringify(doc.segments) };
      if (elements > bound) violations.push(`document ${n} (${verdict.tags} tags, formatting ${verdict.formatting}): ${elements} > ${bound}: ${JSON.stringify(doc.segments).slice(0, 300)}`);
    }
    process.stderr.write(`PRESCAN-PROPERTY admitted=${admitted} refused=${refused} worst_ratio=${worst.ratio.toFixed(4)} elements_per_tag=${worst.perTag.toFixed(2)} `
      + `elements=${worst.elements} tags=${worst.tags} segments=${worst.desc.slice(0, 500)}\n`);
    expect(violations.slice(0, 5), `${violations.length} admitted documents broke the bound`).toEqual([]);
    expect(admitted, 'enough admitted documents that the bound is really tested').toBeGreaterThanOrEqual(100);
    expect(refused, 'the grammar is hostile enough that the pre-scan refuses a good share').toBeGreaterThanOrEqual(60);
  });

  it('the review\'s own shape is caught: a pre-scan that admits it would fail the bound', () => {
    const text = `<div>${Array.from({ length: 300 }, (_, k) => `<b data-i=${k}><table></b></table>`).join('')}</div>${rep('<p>x</p>', 600)}`;
    const elements = new DOMParser().parseFromString(text, 'text/html').getElementsByTagName('*').length;
    expect(elements, 'what the parser builds from this shape').toBeGreaterThan((F + 4) * (300 * 4 + 1200 + 2) + 16);
    expect(prescanMockup(text).ok).toBe(false);
  });
});

const INTEGRATION_POINTS: ReadonlyArray<readonly [string, string]> = [
  ['svg', 'foreignObject'], ['svg', 'desc'], ['svg', 'title'], ['math', 'mi'], ['math', 'mo'], ['math', 'mn'], ['math', 'ms'],
  ['math', 'mtext'], ['math', 'annotation-xml'],
];
const TEXT_ONLY = ['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'textarea', 'plaintext', 'title'];
const foreignMarkup = { ok: false, why: 'foreign-markup' } as const;

describe('v3 (D-8663): integration points refuse markup, in real Chromium\'s terms (the browser leg holds the oracle)', () => {
  it.each(INTEGRATION_POINTS)('<%s><%s> with a start tag inside is refused foreign-markup', (root, el) => {
    expect(prescanMockup(`<${root}><${el}><span></${el}></${root}>`)).toMatchObject(foreignMarkup);
  });

  it.each(INTEGRATION_POINTS)('the formatting-leak unit through <%s><%s>: <table> + L x <b data-i=k>... + </table> + paragraphs is refused', (root, el) => {
    const unit = (k: number): string => `<b data-i=${k}><${root}><${el}><span></${el}></${root}></b>`;
    const text = `<table>${Array.from({ length: 64 }, (_, k) => unit(k)).join('')}</table>${rep('<p>x</p>', 200)}`;
    expect(prescanMockup(text)).toMatchObject(foreignMarkup);
  });

  it('the hidden-depth unit: <b> + (<svg><foreignObject><span></foreignObject></svg>) x R + comment fill is refused', () => {
    const text = `<b>${rep('<svg><foreignObject><span></foreignObject></svg>', 100)}${rep('x<!---->', 1000)}`;
    expect(prescanMockup(text)).toMatchObject(foreignMarkup);
  });

  it('text inside an integration point is admitted', () => {
    expect(prescanMockup('<svg><foreignObject>plain text</foreignObject></svg>')).toMatchObject({ ok: true });
    expect(prescanMockup('<svg><desc>D</desc></svg><math><mi>x</mi><mo>+</mo><mn>1</mn><ms>s</ms><mtext>t</mtext></math>')).toMatchObject({ ok: true });
    expect(prescanMockup(rep('<svg><desc>D</desc></svg><math><mi>x</mi></math>', 60))).toMatchObject({ ok: true });
  });

  it('an end tag pops an integration point with its own name, and a parent\'s end tag pops through it (v7: the foreign walk)', () => {
    expect(prescanMockup('<svg><foreignObject>a</foreignObject><g><path/></g></svg>')).toMatchObject({ ok: true });
    // v7: the foreign walk pops through an integration point, as the parser's foreign end-tag steps do (it was refused as stale in v6).
    expect(prescanMockup('<svg><foreignObject>a</svg><div>x</div>')).toMatchObject({ ok: true });
    expect(prescanMockup('<math><annotation-xml>a</annotation-xml><mi>b</mi></math>')).toMatchObject({ ok: true });
  });
});

describe('v3 (D-8663): the namespace of a start tag, and what a breakout pops', () => {
  it('a breakout name pops every foreign entry down to the nearest HTML entry, as the parser does', () => {
    expect(prescanMockup(rep('<svg><g><div></div>', 1000))).toMatchObject({ ok: true, depth: 2 });
    expect(prescanMockup(rep('<svg><g><span></span>', 1000))).toMatchObject({ ok: true, depth: 2 });
    expect(prescanMockup(rep('<math><mrow><p>x</p>', 1000))).toMatchObject({ ok: true, depth: 2 });
  });

  it('any other name stays in the foreign namespace: a, g, path, text, use, tspan, and font without color, face or size', () => {
    expect(prescanMockup(`<svg>${rep('<g>', D - 1)}`)).toMatchObject({ ok: true, depth: D });
    expect(prescanMockup(`<svg>${rep('<g>', D)}`)).toMatchObject({ ok: false, why: 'too-deep' });
    // font is formatting too, so the formatting limit speaks first; svg stays on the stack under it (a breakout would pop it).
    expect(prescanMockup(`<svg>${rep('<font>', F)}`)).toMatchObject({ ok: true, depth: F + 1 });
    expect(prescanMockup(`<svg>${rep('<font style=x>', F)}`)).toMatchObject({ ok: true, depth: F + 1 });
    // With color, face or size the parser breaks out: svg is popped and the font is an HTML entry.
    expect(prescanMockup(`<svg>${rep('<font color=red>', F)}`)).toMatchObject({ ok: true, depth: F });
  });

  it('font breaks out only with color, face or size: a bare font keeps the foreign state, a font with color pops svg', () => {
    expect(prescanMockup('<svg><font><foreignObject><span></foreignObject></font></svg>')).toMatchObject(foreignMarkup);
    expect(prescanMockup('<svg><font style=x><foreignObject><span></foreignObject></font></svg>')).toMatchObject(foreignMarkup);
    // After a breakout foreignObject is an unknown HTML element: no integration point, so the span is an ordinary child.
    expect(prescanMockup('<svg><font color=red><foreignObject><span></foreignObject></font></svg>')).toMatchObject({ ok: true });
    const unit = (k: number): string => `<b data-i=${k}><svg><font><foreignObject><span></foreignObject></svg></b>`;
    expect(prescanMockup(`<table>${Array.from({ length: 64 }, (_, k) => unit(k)).join('')}</table>${rep('<p>x</p>', 200)}`)).toMatchObject(foreignMarkup);
  });

  it('formatting counts rise for every formatting name in either namespace and are not lowered by a foreign pop', () => {
    expect(prescanMockup(rep('<svg><a></a></svg>', F))).toMatchObject({ ok: true, formatting: F });
    expect(prescanMockup(rep('<svg><a></a></svg>', F + 1))).toMatchObject({ ok: false, why: 'too-many-formatting' });
  });
});

describe('v3 (D-8663): a foreign RAW-named element is text-only, and the exit point is the same in both readings', () => {
  it.each(TEXT_ONLY)('<svg><%s>text</%s> is admitted, with markup characters that are not markup', (name) => {
    expect(prescanMockup(`<svg><${name}>a < b && c > d, 1<2, x <\t</${name}><path/></svg>`)).toMatchObject({ ok: true });
    expect(prescanMockup(`<svg><${name.toUpperCase()}>text</${name}><path/></svg>`)).toMatchObject({ ok: true });
    expect(prescanMockup(`<math><${name}>text</${name} ><mi>x</mi></math>`)).toMatchObject({ ok: true });
  });

  it.each(TEXT_ONLY)('<svg><%s> refuses a start tag, a comment, a bogus comment, another end tag and a stray </ inside', (name) => {
    for (const inside of ['<b>', '<!--x-->', '<!x>', '<?x>', '</span>', '</ >', '</>', '<i data-i=1>', `</${name}x>`]) {
      expect(prescanMockup(`<svg><${name}>${inside}</${name}></svg>`), `${name}: ${inside}`).toMatchObject(foreignMarkup);
    }
    expect(prescanMockup(`<svg><${name}>text</${name}`)).toMatchObject(foreignMarkup);
  });

  it('its own end tag has its attribute section tokenized exactly, then pops it', () => {
    expect(prescanMockup('<svg><style>a</style a=">">x</svg>')).toMatchObject({ ok: true, tags: 4 });
    expect(prescanMockup(rep('<svg><style>a</style  x=y ><path/></svg>', 100))).toMatchObject({ ok: true });
    expect(prescanMockup('<svg><style>a</style/><path/></svg>')).toMatchObject({ ok: true });
  });

  it('the exact opener <![CDATA[ is text, up to the first ]]>: inside it every markup character still refuses', () => {
    expect(prescanMockup('<svg><style><![CDATA[.a{fill:#000}]]></style><path/></svg>')).toMatchObject({ ok: true });
    expect(prescanMockup('<svg><style><![CDATA[.a{}]]>b<![CDATA[.c{}]]></style></svg>')).toMatchObject({ ok: true });
    expect(prescanMockup('<svg><style><![CDATA[a < b]]></style></svg>')).toMatchObject({ ok: true });
    expect(prescanMockup('<svg><style><![CDATA[</style><b>]]></style></svg>')).toMatchObject(foreignMarkup);
    expect(prescanMockup('<svg><style><![CDATA[<b>]]></style></svg>')).toMatchObject(foreignMarkup);
    expect(prescanMockup('<svg><style><![CDATA[<!--]]></style></svg>')).toMatchObject(foreignMarkup);
    expect(prescanMockup('<svg><style><![CDATA[a</style>')).toMatchObject(foreignMarkup);
    expect(prescanMockup('<svg><style><![CDATA[<![CDATA[x]]></style></svg>')).toMatchObject(foreignMarkup);
    expect(prescanMockup('<svg><style><![cdata[x]]></style></svg>')).toMatchObject(foreignMarkup);
  });

  it('the old required row: <svg><style> with <!-- and </style> in a comment cannot pop, and is refused at the <!--', () => {
    expect(prescanMockup('<svg><style><!--</style>--></svg>')).toMatchObject(foreignMarkup);
  });

  it('the two leak shapes the review measured in Chromium (a comment, and an attribute value, hiding </style></b>) are refused', () => {
    const wrapped = (unit: (k: number) => string): string =>
      `<div>${Array.from({ length: 128 }, (_, k) => unit(k)).join('')}</div>${rep('<p>x</p>', 1000)}`;
    expect(prescanMockup(wrapped((k) => `<b data-i=${k}><svg><style><!--</style></b>--></svg>`))).toMatchObject(foreignMarkup);
    expect(prescanMockup(wrapped((k) => `<b data-i=${k}><svg><style><g title="</style></b>"></svg>`))).toMatchObject(foreignMarkup);
  });

  it('the svg title bypass (a font with color leaves foreign content, so the title is HTML RCDATA and the b after its first end tag is seen)', () => {
    const unit = (k: number): string => `<svg><font color=red><title><!--</title><b data-i=${k}>--></title></font></svg>`;
    const text = `<div>${Array.from({ length: 128 }, (_, k) => unit(k)).join('')}</div>${rep('<p>x</p>', 1000)}`;
    expect(prescanMockup(text)).toMatchObject({ ok: false, why: 'too-many-formatting' });
    expect(prescanMockup('<svg><title><!--</title>--><span></title></svg>')).toMatchObject(foreignMarkup);
  });

  it('a text-only element pops through the foreign walk, so the integration counter drops and the next start tag is fine', () => {
    expect(prescanMockup('<svg><title>T</title><g><path/></g></svg>')).toMatchObject({ ok: true });
    expect(prescanMockup('<svg><title>T</title><b>x</b></svg>')).toMatchObject({ ok: true });
  });
});

describe('v3 (D-8663): CDATA is read by namespace', () => {
  it('in foreign content <![CDATA[ is refused (v6): with a foreign entry open the scan cannot tell a section from a bogus comment', () => {
    expect(prescanMockup(`<svg><![CDATA[${rep('<div>', D + 1)}]]></svg>`)).toMatchObject(foreignMarkup);
    expect(prescanMockup(`<svg><![CDATA[a>b ${rep('<div>', D + 1)} ]]>`)).toMatchObject(foreignMarkup);
    expect(prescanMockup(`<svg><![CDATA[${rep('<div>', D + 5)}`)).toMatchObject(foreignMarkup);
  });

  it('in HTML it is a bogus comment that ends at the first >', () => {
    expect(prescanMockup(`<![CDATA[${rep('<div>', D + 1)}]]>`)).toMatchObject({ ok: true, depth: D });
    expect(prescanMockup(`<div><![CDATA[${rep('<div>', D + 1)}]]>`)).toMatchObject({ ok: false, why: 'too-deep' });
  });
});

describe('v3 (D-8663): ordinary inline SVG stays admitted', () => {
  const ICONS = [
    '<svg><title>Close</title><path d="M0 0"/></svg>',
    '<svg><desc>D</desc><g><path/></g></svg>',
    '<svg><title>T</title><desc>D</desc><style>.a{fill:#000}</style><use href="#x"/></svg>',
  ];
  it.each(ICONS)('%s', (icon) => {
    expect(prescanMockup(icon)).toMatchObject({ ok: true });
  });

  it('such icons in a row (RE-BASELINED: an inline svg is retained, 2 or 3 entries each, so about 90 icons, not 300), and a page of them among HTML', () => {
    expect(prescanMockup(rep(ICONS.join(''), 30))).toMatchObject({ ok: true });
    expect(prescanMockup(rep(`<div class="i">${ICONS[2]}<span>label</span></div>`, 40))).toMatchObject({ ok: true });
  });

  it('icons with nested g, path, use, defs and a linearGradient (RE-BASELINED to 12 icons: each is retained)', () => {
    const icon = '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><g><g><path d="M0"/><use href="#g"/></g></g><a href="#x"><path d="M1"/></a></svg>';
    expect(prescanMockup(icon)).toMatchObject({ ok: true });
    expect(prescanMockup(rep(icon.replace('<a href="#x"><path d="M1"/></a>', ''), 12))).toMatchObject({ ok: true });
  });

  it('an svg style with CDATA, and a script with an attribute-free end tag', () => {
    expect(prescanMockup('<svg><style type="text/css"><![CDATA[\n.a { fill: #000 }\n.b > .c { stroke: red }\n]]></style><path class="a"/></svg>')).toMatchObject({ ok: true });
    expect(prescanMockup('<svg><script>var a = 1 < 2;</script><path/></svg>')).toMatchObject({ ok: true });
  });
});

const SELF_CLOSED_ROOTS = ['svg', 'math'] as const;
const HTML_ELEMENTS_WITH_MARKER = ['object', 'applet', 'marquee', 'template'] as const;

describe('v4 (D-8663): a self-closed svg or math is popped at once, so what follows is read as the parser reads it', () => {
  const leak = (root: string, el: string, copies: number, fill: number): string =>
    `<div>${Array.from({ length: copies }, (_, k) => `<b data-i=${k}><${root}/><${el}></b></${el}>`).join('')}</div>${rep('<div>x</div>', fill)}`;

  it.each(SELF_CLOSED_ROOTS.flatMap((r) => HTML_ELEMENTS_WITH_MARKER.map((e) => [r, e] as const)))(
    '<b data-i=k><%s/><%s></b></...> x N, then paragraphs, is refused (the blocked </b> no longer decrements the formatting count)',
    (root, el) => {
      expect(prescanMockup(leak(root, el, 400, 4000))).toMatchObject({ ok: false, why: 'too-many-formatting' });
      expect(prescanMockup(leak(root, el, 100, 1000))).toMatchObject({ ok: false, why: 'too-many-formatting' });
    },
  );

  it('a self-closed svg or math pushes nothing, in any case and with attributes, and the next element is HTML', () => {
    expect(prescanMockup(rep('<svg/>', 1000))).toMatchObject({ ok: true, depth: 0 });
    expect(prescanMockup(rep('<math/>', 1000))).toMatchObject({ ok: true, depth: 0 });
    expect(prescanMockup(rep('<SVG />', 1000))).toMatchObject({ ok: true, depth: 0 });
    expect(prescanMockup(rep('<svg viewBox="0 0 1 1" class=a />', 1000))).toMatchObject({ ok: true, depth: 0 });
    expect(prescanMockup(rep('<svg a="x"/>', 1000))).toMatchObject({ ok: true, depth: 0 });
    expect(prescanMockup(rep('<svg/><foreignObject><span></foreignObject>', 100))).toMatchObject({ ok: true });
  });

  it('only the tokenizer\'s own self-closing flag counts: a slash inside an unquoted value, or none, still pushes', () => {
    expect(prescanMockup(rep('<svg a=b/>', D + 1))).toMatchObject({ ok: false, why: 'too-deep' });
    expect(prescanMockup(rep('<svg>', D + 1))).toMatchObject({ ok: false, why: 'too-deep' });
    expect(prescanMockup(rep('<math a="/">', D + 1))).toMatchObject({ ok: false, why: 'too-deep' });
    expect(prescanMockup(rep('<svg a=">/">', D + 1))).toMatchObject({ ok: false, why: 'too-deep' });
  });

  it('every foreign self-closed element pushes nothing too (v7: the parser pops it at once and the foreign state is exact)', () => {
    expect(prescanMockup(`<svg>${rep('<path/>', D)}</svg>`)).toMatchObject({ ok: true, depth: 1 });
    expect(prescanMockup(`<svg>${rep('<svg/>', 1000)}</svg>`)).toMatchObject({ ok: true, depth: 1 });
  });
});

describe('v4 (D-8663): a foreign entry above the match blocks every end tag outside the implied-closer group', () => {
  it('a formatting end tag over a foreign entry is refused (v7: its walk reaches the HTML b, which the scan does not follow)', () => {
    refusedAs('<b><svg></b>', 'foreign-markup');
    refusedAs('<b data-i=1><math><mi>x</mi></b>', 'foreign-markup');
  });

  it('any other non-closer end tag over a foreign entry is blocked too (span, a, em, noscript)', () => {
    refusedAs('<span><svg></span>', 'foreign-markup');
    refusedAs('<em><svg><g></em>', 'foreign-markup');
    refusedAs('<noscript><svg></noscript>', 'foreign-markup');
  });

  it('the implied-closer group is gone: a closer end tag pops only its match at the top, like every other end tag', () => {
    // A div end tag with an svg open reaches the HTML div through the foreign run: refused (v7).
    refusedAs('<div><svg></div>', 'foreign-markup');
    expect(prescanMockup(rep('<p>x</p><ul><li>a</li><li>b</li></ul>', 1000))).toMatchObject({ ok: true, depth: 2 });
    expect(prescanMockup(rep('<table><tr><td>x</td></tr></table>', 1000))).toMatchObject({ ok: true, depth: 3 });
  });

  it('inline svg inside inline HTML: the HTML parent closes once the svg is closed (v7: a self-closed child leaves nothing)', () => {
    expect(prescanMockup(rep('<span><svg></svg>label</span>', 1000))).toMatchObject({ ok: true, depth: 2 });
    expect(prescanMockup(rep('<a href="#x"><svg><path/></svg></a>', 20))).toMatchObject({ ok: true });
    expect(prescanMockup(rep('<button><svg><use href="#x"/></svg> OK</button>', 60))).toMatchObject({ ok: true });
  });
});

/** `<b id=k><R><R></R>` + 8 divs + `</R></b>` repeated, closed by a block, then paragraphs: the review's nested-raw-name shape. */
const nestedRaw = (raw: string, copies: number, fill: number): string =>
  `<section>${Array.from({ length: copies }, (_, k) => `<b id=${k}><${raw}><${raw}></${raw}>${rep('<div>', 8)}</${raw}></b>`).join('')}</section>${rep('<div>x</div>', fill)}`;
/** `<b id=k>` + a not-self-closed root tag + `<style>` + 8 divs + `</style></b>`: the review's self-closing-whitespace shape. */
const spacedRoot = (tag: string, copies: number, fill: number): string =>
  `<section>${Array.from({ length: copies }, (_, k) => `<b id=${k}>${tag}<style>${rep('<div>', 8)}</style></b>`).join('')}</section>${rep('<div>x</div>', fill)}`;

describe('v5 (D-8663): raw text is exact and pushes nothing (a nested raw name no longer keeps the scan raw)', () => {
  it.each(RAW_NAMES)('<b id=k><%s><%s></%s> + 8 divs + </%s></b> x N, then paragraphs, is refused (the divs the parser keeps stay on the stack)', (raw) => {
    expect(prescanMockup(nestedRaw(raw, 100, 1000))).toMatchObject({ ok: false, why: 'too-deep' });
    expect(prescanMockup(nestedRaw(raw, 300, 2700))).toMatchObject({ ok: false, why: 'too-deep' });
  });

  it('one copy is admitted, with the 8 divs counted on the stack and the b held (the structure the parser keeps)', () => {
    for (const raw of RAW_NAMES) {
      expect(prescanMockup(`<b id=1><${raw}><${raw}></${raw}>${rep('<div>', 8)}</${raw}></b>`), raw).toMatchObject({ ok: true, depth: 9, formatting: 1 });
    }
  });

  it.each(['style', 'xmp', 'iframe', 'noembed', 'noframes', 'textarea', 'title'])(
    '<%s>: its end tag needs a terminator after the name, any case, with attributes tokenized exactly', (raw) => {
      const hides = (inside: string): number => {
        const v = prescanMockup(`<${raw}>${inside}</${raw}><b data-i=1>`);
        return v.ok ? v.formatting : -1;
      };
      // Not its end tag: the text goes on to the real one (so the b after is seen: formatting 1).
      for (const notEnd of [`</${raw}x>`, `</${raw.slice(0, -1)}>`, `</${raw}1>`, `</${raw}-x>`, `</ ${raw}>`, `<${raw}>`, `</${raw}`]) {
        expect(hides(notEnd), notEnd).toBe(1);
      }
      for (const end of ['\t', '\n', '\f', ' ', '/', ' a=">"', ' a=\'>\'', ' a=b>c']) {
        const text = `<${raw}>x</${raw.toUpperCase()}${end}${end.endsWith('>') ? '' : '>'}<b data-i=1>`;
        const v = prescanMockup(text);
        expect(v.ok ? v.formatting : -1, JSON.stringify(end)).toBe(1);
      }
    });

  it('the opener\'s end tag has its attribute section walked: a tag inside a quoted value is not a tag the scan pushes', () => {
    for (const raw of ['style', 'script', 'textarea']) {
      expect(prescanMockup(`<${raw}>x</${raw} a="<b data-i=2>"><b data-i=1>`), raw).toMatchObject({ ok: true, formatting: 1, tags: 4 });
      expect(prescanMockup(`<${raw}>x</${raw} a=<b data-i=2>><b data-i=1>`), raw).toMatchObject({ ok: true, formatting: 1 });
    }
  });

  it('plaintext never ends: everything after it is text, its end tag included', () => {
    expect(prescanMockup('<plaintext>x</plaintext><b data-i=1><div>')).toMatchObject({ ok: true, depth: 1, formatting: 0, tags: 4 });
  });

  it('a raw element that is unterminated at the end of the text runs to it, counting tags', () => {
    expect(prescanMockup(`<style>${rep('<b>', 100)}`)).toMatchObject({ ok: true, depth: 1, formatting: 0, tags: 101 });
    expect(prescanMockup(`<style>${rep('<b>', MOCKUP_MAX_TAGS)}`)).toMatchObject({ ok: false, why: 'too-many-tags' });
  });
});

describe('v5 (D-8663): script data, state by state (the HTML standard\'s tokenizer: escape start, escaped, double-escaped)', () => {
  /** After `<script>` + pre + `</script>`: a `<b>` that the scan sees only when the script ended at the FIRST `</script>`. */
  const seen = (pre: string, close = '</script>'): number => {
    const v = prescanMockup(`<script>${pre}${close}<b data-i=1></script>`);
    return v.ok ? v.formatting : -1;
  };

  it.each([
    ['plain data', 'x', 1],
    ['an escape start then data (`<!-` and one dash is not an escape)', '<!-x', 1],
    ['escaped by `<!--`: the first </script> still ends it', '<!-- x ', 1],
    ['`<!-->` leaves escape at once (escaped dash dash, `>`)', '<!-->', 1],
    ['`<!--->` too', '<!--->', 1],
    ['`<!---->` too', '<!---->', 1],
    ['double escape start: `<script>` after `<!--` hides the first </script>', '<!--<script>', 0],
    ['double escape start in upper case', '<!--<SCRIPT>', 0],
    ['double escape start with a slash terminator', '<!--<script/>', 0],
    ['double escape start with a tab, an LF and an FF', '<!--<script\t>', 0],
    ['LF', '<!--<script\n>', 0],
    ['FF', '<!--<script\f>', 0],
    ['space', '<!--<script >', 0],
    ['a longer name is not double escape: `<scripts>`', '<!--<scripts>', 1],
    ['a digit after the name is not a terminator: `<script1>`', '<!--<script1>', 1],
    ['a shorter name is not double escape: `<scrip>`', '<!--<scrip>', 1],
    ['`<script` with no terminator before the end', '<!--<script', 1],
    ['double escaped: `-->` returns to script data, so the first </script> ends it', '<!--<script> -->', 1],
    ['double escaped: `--!>` does not', '<!--<script> --!>', 0],
    ['double escaped: a second `<!--` changes nothing', '<!--<script> <!-- ', 0],
    ['double escaped: `</script >` goes back to escaped, then the first </script> ends it', '<!--<script></script >', 1],
    ['double escaped: `</script/>` likewise', '<!--<script></script/>', 1],
    ['double escaped: `</scripts>` does not leave double escape', '<!--<script></scripts>', 0],
    ['escaped, `-->` back to data, `<!--` escaped again', '<!--<script> --><!--', 1],
    ['escaped: `</scriptx>` is text', '<!--</scriptx>', 1],
    ['escaped: dashes then `>` is data again', '<!-- - -- --- ->', 1],
    ['data: a `<!--` hidden in a longer run of dashes', '<!------', 1],
  ])('%s', (_name, pre, formatting) => {
    expect(seen(pre), pre).toBe(formatting);
  });

  it('the first </script> ends script data and escaped text whatever follows its name (tab, LF, FF, space, slash, >)', () => {
    for (const close of ['</script>', '</SCRIPT>', '</script\t>', '</script\n>', '</script\f>', '</script />', '</script/>', '</script a=">">']) {
      expect(seen('<!-- x ', close), close).toBe(1);
      expect(seen('', close), close).toBe(1);
    }
    expect(seen('', '</scriptx>'), 'not an end tag: the text goes on to the real one, which hides the b').toBe(0);
  });

  it('a script hidden by double escape ends at the second </script>, which pops the script', () => {
    expect(prescanMockup(`<script><!--<script></script>${rep('<div>', D + 1)}</script>`)).toMatchObject({ ok: true, depth: 1 });
    expect(prescanMockup(rep('<script><!--<script></script><div></script>', D + 1))).toMatchObject({ ok: true, depth: 1 });
    expect(prescanMockup(rep('<script><!-- x </script><div></script>', D + 1))).toMatchObject({ ok: false, why: 'too-deep' });
  });
});

describe('v5 (D-8663): the attribute tokenizer decides the tag\'s end and its self-closing flag exactly', () => {
  /** `<svg ...>` then `<g>`: depth 1 when the root tag self-closed (nothing pushed, `g` is HTML), 2 when it did not. */
  const depthAfter = (tag: string): number => {
    const v = prescanMockup(`${tag}<g>`);
    return v.ok ? v.depth : -1;
  };

  it.each([
    '<svg/>', '<svg />', '<svg\t/>', '<svg\n/>', '<svg a/>', '<svg a />', '<svg a="b"/>', "<svg a='b'/>", '<svg a="b" />', '<svg =/>', '<svg "/>', "<svg '/>", '<svg </>',
    '<svg //>', '<svg / />', '<svg a=b />', '<svg a="b"c="d"/>', '<svg a=b c/>', '<svg a b/>', '<svg a="b"\t/>', '<math/>', '<SVG/>',
  ])('self-closed (the flag is set by a / immediately followed by >): %j', (tag) => {
    expect(depthAfter(tag), tag).toBe(1);
  });

  it.each([
    '<svg>', '<svg / >', '<svg /\t>', '<svg /\n>', '<svg /\f>', '<svg / x>', '<svg /x>', '<svg a=b/>', '<svg a= b/>', '<svg a= />', '<svg a=/>', '<svg a="b"/ >', '<svg a="/">', "<svg a='/'>",
    '<svg a=>', '<svg =>', '<svg a="b" / >', '<svg / / x>', '<math / >', '<svg a=b/ >', '<svg a=\'b\'x/ >',
  ])('not self-closed (whitespace or another character after the slash returns to before-attribute-name; a slash in a value is data): %j', (tag) => {
    expect(depthAfter(tag), tag).toBe(2);
  });

  it('a > ends the tag in before-attribute-value (missing value), in unquoted values, and after a name, but not inside quotes', () => {
    expect(prescanMockup(rep('<div a=><div b=c><div d><div e=">"x="y">', 40))).toMatchObject({ ok: true, depth: 160 });
    expect(prescanMockup(rep('<div a=>', D + 1))).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
  });

  it('a first = starts an attribute name; a quote, an apostrophe and a < are part of a name; a quote opens a value only after =', () => {
    expect(prescanMockup(rep('<div ="x">', D + 1))).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
    expect(prescanMockup(rep('<div a"b>', D + 1))).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
    expect(prescanMockup(rep('<div a<b>', D + 1))).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
    expect(prescanMockup(rep('<div a=b"c<d>', D + 1))).toMatchObject({ ok: false, why: 'too-deep', depth: D + 1 });
  });

  it('end tags tokenize the same states, so an end tag\'s own `/ >` and quotes decide its end too', () => {
    expect(prescanMockup('<div></div / ><span>')).toMatchObject({ ok: true, depth: 1, tags: 3 });
    expect(prescanMockup('<div></div a=">"><span>')).toMatchObject({ ok: true, depth: 1, tags: 3 });
    expect(prescanMockup('<style>x</style / ><b data-i=1>')).toMatchObject({ ok: true, formatting: 1 });
  });

  it('the review shapes: <svg / >, <svg /\\t> and <svg / x> hold a foreign svg, so the style after it is text-only and refuses markup', () => {
    for (const tag of ['<svg / >', '<svg /\t>', '<svg / x>', '<math / >', '<svg /\n>']) {
      expect(prescanMockup(spacedRoot(tag, 100, 1000)), tag).toMatchObject({ ok: false, why: 'foreign-markup' });
      expect(prescanMockup(spacedRoot(tag, 250, 2500)), tag).toMatchObject({ ok: false, why: 'foreign-markup' });
    }
  });
});

/** The fifth review's (round 5) test payload `S(M, R)`: M unclosed formatting elements in a block that is then closed, then R paragraphs. */
const storm = (m: number, r: number): string => `<div>${Array.from({ length: m }, (_, k) => `<b id=${k}>`).join('')}</div>${rep('<p>x', r)}`;
/** `<div>` + `copies` of a unit + `</div>` + paragraphs: the stale-entry shapes the review measured. */
const staleUnits = (unit: (k: number) => string, copies: number, fill: number): string =>
  `<div>${Array.from({ length: copies }, (_, k) => unit(k)).join('')}</div>${rep('<p>x</p>', fill)}`;
const CHAIN = rep('<li><dd>', 5);

describe('v6 (D-8663): CDATA is a section only when the scan\'s foreign state is certain; a foreign entry open refuses it', () => {
  it.each([
    ['<svg></p><![CDATA[>'],
    ['<math></br><![CDATA[>'],
    ['<svg><font color=x><![CDATA[>'],
    ['<svg><g></p><![CDATA[>'],
    ['<math><mi>x</mi></br><![CDATA[>'],
  ])('%s + S(100, 1000) + ]]>: the parser has left foreign content, so this is a bogus comment ending at the first >, and the payload is seen', (opener) => {
    expect(prescanMockup(`${opener}${storm(100, 1000)}]]>`)).toMatchObject({ ok: false, why: 'too-many-formatting' });
  });

  it('a <![CDATA[ with ANY foreign entry on the stack refuses foreign-markup (its end may differ between readings)', () => {
    expect(prescanMockup('<svg><![CDATA[x]]></svg>')).toMatchObject({ ok: false, why: 'foreign-markup' });
    expect(prescanMockup('<svg><g><![CDATA[x]]></g></svg>')).toMatchObject({ ok: false, why: 'foreign-markup' });
    expect(prescanMockup('<math><mi><![CDATA[x]]></mi></math>')).toMatchObject({ ok: false, why: 'foreign-markup' });
    expect(prescanMockup('<svg><font><![CDATA[x]]>')).toMatchObject({ ok: false, why: 'foreign-markup' });
  });

  it('with no foreign entry it is a bogus comment that ends at the first >, whatever follows', () => {
    expect(prescanMockup('<![CDATA[><b data-i=1>]]>')).toMatchObject({ ok: true, formatting: 1 });
    expect(prescanMockup('<div><![CDATA[><b data-i=1>]]></div>')).toMatchObject({ ok: true, formatting: 1 });
    expect(prescanMockup('<svg></p><![CDATA[><b data-i=1>]]>')).toMatchObject({ ok: true, formatting: 1 });
  });

  it('the opener inside a text-only foreign element is still text (its own rule), and still refuses markup after it', () => {
    expect(prescanMockup('<svg><style><![CDATA[.a{fill:#000}]]></style></svg>')).toMatchObject({ ok: true });
    expect(prescanMockup('<svg><style><![CDATA[</style><b>]]></style></svg>')).toMatchObject({ ok: false, why: 'foreign-markup' });
  });
});

describe('v6 (D-8663): the parser\'s own foreign exits: </p> and </br> pop foreign entries, and font with color, face or size is a breakout', () => {
  it('</p> and </br> with a foreign top pop the foreign entries down to the nearest HTML entry, then run as HTML end tags', () => {
    expect(prescanMockup(rep('<svg></p>', 1000))).toMatchObject({ ok: true, depth: 1 });
    expect(prescanMockup(rep('<math></br>', 1000))).toMatchObject({ ok: true, depth: 1 });
    expect(prescanMockup(rep('<svg><g><path/></p>', 1000))).toMatchObject({ ok: true, depth: 2 });
    expect(prescanMockup(rep('<p><svg></p>', 1000))).toMatchObject({ ok: true, depth: 2 });
    expect(prescanMockup(rep('<div><svg></br>', 100))).toMatchObject({ ok: true, depth: 101 });
  });

  it('they stop at an integration point, which the parser also keeps', () => {
    expect(prescanMockup(rep('<svg><desc></p>', 5))).toMatchObject({ ok: false, why: 'foreign-markup' });
    // v7: with an integration point open the parser runs the HTML rules for </p> inside it, which the scan does not follow.
    expect(prescanMockup('<svg><desc></p>text</desc></svg>')).toMatchObject({ ok: false, why: 'foreign-markup' });
  });

  it.each([
    ['<svg><font color=x><g>', 2], ['<svg><font COLOR=x><g>', 2], ['<svg><font face=x><g>', 2], ['<svg><font size=1><g>', 2], ['<svg><font a=b color><g>', 2],
    ['<svg><font color><g>', 2], ["<svg><font a='x' size='1'><g>", 2], ['<svg><font\tcolor=x><g>', 2],
    ['<svg><font style=x><g>', 3], ['<svg><font><g>', 3], ['<svg><font colorx=1><g>', 3], ['<svg><font xcolor=1><g>', 3], ['<svg><font a="color=1"><g>', 3],
    ['<svg><font a=color><g>', 3], ['<svg><font data-size=1><g>', 3],
  ])('%s is %i deep: font breaks out only on an attribute NAMED color, face or size (the exact attribute tokenizer)', (text, depth) => {
    expect(prescanMockup(text)).toMatchObject({ ok: true, depth });
  });
});

describe('v6 (D-8663): a raw-text start tag inside template refuses (the parser ignores it in column-group mode)', () => {
  it.each([...RAW_NAMES, 'plaintext'])('<template><col><%s></template> + S(100, 1000) + the end tag is refused foreign-markup', (raw) => {
    expect(prescanMockup(`<template><col><${raw}></template>${storm(100, 1000)}</${raw}>`)).toMatchObject({ ok: false, why: 'foreign-markup' });
    expect(prescanMockup(`<template><${raw}>x</${raw}></template>`)).toMatchObject({ ok: false, why: 'foreign-markup' });
    expect(prescanMockup(`<template><div><${raw}>`)).toMatchObject({ ok: false, why: 'foreign-markup' });
  });

  it('without a template on the stack the same tags are raw text, and after the template closes they are again', () => {
    expect(prescanMockup('<xmp>x</xmp><plaintext>y')).toMatchObject({ ok: true });
    expect(prescanMockup('<template><p>x</p></template><style>a{}</style>')).toMatchObject({ ok: true });
  });
});

describe('v6 (D-8663): an end tag pops only when its match is the TOP entry (stale entries cannot be popped through)', () => {
  it.each([
    ['a stale p: <p><p></p> then li, dd', (k: number) => `<b id=${k}><p><p></p>${CHAIN}</p></b>`],
    ['a stale heading: <h1><h2></h2>', (k: number) => `<b id=${k}><h1><h2></h2>${CHAIN}</h1></b>`],
    ['a stale button: <button><button></button>', (k: number) => `<b id=${k}><button><button></button>${CHAIN}</button></b>`],
    ['a stale a: <a><a></a>', (k: number) => `<b id=${k}><a><a></a>${CHAIN}</a></b>`],
    ['a stale dd: <dd><dt></dt>', (k: number) => `<b id=${k}><dd><dt></dt>${rep('<li><p>', 5)}</dd></b>`],
    ['a stale option: <option><option></option>', (k: number) => `<b id=${k}><option><option></option>${CHAIN}</option></b>`],
    ['a form with a null form pointer', (k: number) => `<b id=${k}>${rep('<form><table></form></table></form>', 9)}</b>`],
    ['a table in a cell', (k: number) => `<b id=${k}><table><td><table></table><caption></table></b>`],
    ['a caption in a cell', (k: number) => `<b id=${k}><table><caption><table><td></caption></table></b>`],
    ['an ignored <tr> in body, then li and dd', (k: number) => `<b id=${k}><tr>${CHAIN}</tr></b>`],
    ['an ignored <td> in body, then li and dd', (k: number) => `<b id=${k}><td>${CHAIN}</td></b>`],
    ['an ignored <caption> in body, then li and dd', (k: number) => `<b id=${k}><caption>${CHAIN}</caption></b>`],
  ])('%s: refused (100 copies, 1000 paragraphs)', (_name, unit) => {
    expect(prescanMockup(staleUnits(unit, 100, 1000)).ok).toBe(false);
  });

  it.each([['tr'], ['td'], ['caption']])('an ignored <%s> in body with a span inside, closed (<tr><span></tr> x N) is refused: depth grows, nothing is hidden', (tag) => {
    expect(prescanMockup(rep(`<${tag}><span></${tag}>`, D))).toMatchObject({ ok: false, why: 'too-deep' });
    expect(prescanMockup(`${rep(`<${tag}><span></${tag}>`, 5000)}${rep('x<!---->', 1000)}`)).toMatchObject({ ok: false, why: 'too-deep' });
  });

  it('only a match at the top pops: a closed-in-order tree empties, anything above the match blocks it and is retained', () => {
    expect(prescanMockup(rep('<div><p><b></b></p></div>', 1000))).toMatchObject({ ok: true, depth: 3 });
    expect(prescanMockup(rep('<div><span></div>', 1000))).toMatchObject({ ok: false, why: 'too-deep' });
    expect(prescanMockup(rep('<ul><li>a</ul>', 1000))).toMatchObject({ ok: false, why: 'too-deep' });
    expect(prescanMockup(rep('<svg><g><path/></g></svg>', 1000))).toMatchObject({ ok: true, depth: 2 });
  });

  it('a formatting count drops only when its own end tag pops its own TOP entry', () => {
    expect(prescanMockup(rep('<b></b>', 1000))).toMatchObject({ ok: true, formatting: 1 });
    expect(prescanMockup(rep('<b><i></b>', F))).toMatchObject({ ok: false, why: 'too-many-formatting' });
    expect(prescanMockup(rep('<b><span></b>', F + 1))).toMatchObject({ ok: false, why: 'too-many-formatting' });
  });
});

/** The sixth review's (round 6) cycle: a stale foreign source (an svg or math closed out of order, or with a self-closed child), eight
 *  elements a parser holds as HTML specials, an exit the parser also performs (a breakout start tag, `</p>`, a void), then the
 *  close of a formatting element. */
const SOURCES: ReadonlyArray<readonly [string, string]> = [['<svg><g></svg>', '<svg><g></svg>'], ['<svg><path/></svg>', '<svg><path/></svg>'], ['<math><mrow></math>', '<math><mrow></math>']];
const EXITS: ReadonlyArray<string> = ['<br>', '</p>', '<font color=r></font>', '<span></span>', '</br>'];
const refusedAs = (text: string, why: string | null = null): void => {
  const v = prescanMockup(text);
  expect(v.ok, text.slice(0, 80)).toBe(false);
  if (why !== null) expect(v.ok ? '' : v.why, text.slice(0, 80)).toBe(why);
};

describe('v7 (D-8663): the sixth review\'s cycles, all variants, refused', () => {
  it.each(SOURCES.flatMap(([name, source]) => EXITS.map((exit) => [name, exit, source] as const)))(
    'stale source %s + 8 sections + %s + </b>, 100 copies and 1000 paragraphs, and 300 copies and 3000', (_name, exit, source) => {
      const unit = (k: number): string => `<b id=${k}>${source}${rep('<section>', 8)}${exit}</b>`;
      refusedAs(staleUnits(unit, 100, 1000));
      refusedAs(staleUnits(unit, 300, 3000));
    },
  );

  it('the review\'s own five generators', () => {
    const cases: Array<(k: number) => string> = [
      (k) => `<b id=${k}><svg><g></svg>${rep('<section>', 8)}<br></b>`,
      (k) => `<b id=${k}><svg><g></svg>${rep('<section>', 8)}</p></b>`,
      (k) => `<b id=${k}><svg><path/></svg>${rep('<article>', 8)}<font color=r></font></b>`,
      (k) => `<b id=${k}><math><mrow></math>${rep('<nav>', 8)}<span></span></b>`,
      (k) => `<a id=${k}><svg><g></svg>${rep('<aside>', 8)}<br></a>`,
    ];
    for (const unit of cases) refusedAs(staleUnits(unit, 100, 2000));
  });
});

describe('v7 (D-8663): foreign content is exact or refused: the foreign entries are one run on top and mirror the parser\'s', () => {
  it('ordinary icons leave NOTHING on the stack: a self-closed child pops at once, an end tag pops through the foreign run', () => {
    const icons = [
      '<svg><path/><use/></svg>', '<svg viewBox="0 0 1 1"><path d="M0"/></svg>', '<svg><defs><symbol id="a"><path d="M0"/></symbol></defs><use href="#a"/></svg>',
      '<svg><g><g><path/><circle/></g></g></svg>', '<svg><title>T</title><desc>D</desc><g><path/></g></svg>', '<svg><style>.a{fill:#000}</style><use/></svg>',
      '<svg><style><![CDATA[.a{}]]></style><rect/></svg>', '<math><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow></math>',
      '<svg><g/><g></g><path/></svg>', '<svg><svg><path/></svg></svg>', '<svg><g><path/></svg>',
    ];
    for (const icon of icons) {
      expect(prescanMockup(rep(icon, 1000)), icon).toMatchObject({ ok: true, depth: expect.any(Number) });
      const v = prescanMockup(rep(icon, 1000));
      expect(v.ok ? v.depth : -1, icon).toBeLessThanOrEqual(6);
    }
    // A foreign <a> is still counted as a formatting name and never lowered (a known limit), so it is not repeated 1000 times.
    expect(prescanMockup(rep('<svg><a href="#x"><path/></a></svg>', F))).toMatchObject({ ok: true, depth: 2 });
    expect(prescanMockup(rep('<div class="i"><svg><path/><use/></svg></div>', 1000))).toMatchObject({ ok: true, depth: 2 });
    expect(prescanMockup(rep('<button><svg><use href="#x"/></svg> OK</button>', 1000))).toMatchObject({ ok: true, depth: 2 });
    expect(prescanMockup(rep('<a href="#x"><svg><g><path/></g></svg>label</a>', 1000))).toMatchObject({ ok: true, depth: 3 });
  });

  it('an end tag walks down through the foreign entries to the first of its name and pops through it', () => {
    expect(prescanMockup(rep('<svg><g><path/></svg>', 1000))).toMatchObject({ ok: true, depth: 2 });
    expect(prescanMockup(rep('<svg><g><g></g></svg>', 1000))).toMatchObject({ ok: true, depth: 3 });
    expect(prescanMockup(rep('<svg><g><g></g></g></svg>', 1000))).toMatchObject({ ok: true, depth: 3 });
    expect(prescanMockup('<svg><g></g></g>')).toMatchObject({ ok: false, why: 'foreign-markup' });
  });

  it('REFUSES when it cannot show its stack equals the parser\'s: an end tag whose walk reaches an HTML entry or the bottom', () => {
    for (const text of ['<svg><g></div>', '<svg></b>', '<div><svg></div>', '<svg><g></x></svg>', '<svg></body>', '<svg></html>', '<svg></form>', '<svg><g></span>', '<b><svg></b>', '</svg>x<svg></g>']) {
      refusedAs(text, 'foreign-markup');
    }
    // After the root is gone the same tags are plain HTML end tags again.
    expect(prescanMockup('<svg></svg></div></b></x>')).toMatchObject({ ok: true });
  });

  it('a breakout pops EXACTLY the foreign run, then is an HTML entry; so do </p> and </br> (font with color, face or size is a breakout)', () => {
    expect(prescanMockup(rep('<svg><g><div></div>', 1000))).toMatchObject({ ok: true, depth: 2 });
    expect(prescanMockup(rep('<svg><g><span>x</span>', 1000))).toMatchObject({ ok: true, depth: 2 });
    expect(prescanMockup(rep('<svg><g><font color=x></font>', 1000))).toMatchObject({ ok: true, depth: 2 });
    expect(prescanMockup(rep('<svg><g></p>', 1000))).toMatchObject({ ok: true, depth: 2 });
    expect(prescanMockup(rep('<math><mrow></br>', 1000))).toMatchObject({ ok: true, depth: 2 });
    expect(prescanMockup(rep('<p><svg></p>', 1000))).toMatchObject({ ok: true, depth: 2 });
    expect(prescanMockup(rep('<svg><g><br>', 1000))).toMatchObject({ ok: true, depth: 2 });
    // The pop took the root with it: the next root opens afresh, and an HTML entry stays on the stack.
    expect(prescanMockup(rep('<svg><div>', D))).toMatchObject({ ok: true, depth: D });
    expect(prescanMockup(rep('<svg><div>', D + 1))).toMatchObject({ ok: false, why: 'too-deep' });
  });

  it('</p> and </br> with an integration point open refuse (the parser then runs the HTML rules inside it)', () => {
    refusedAs('<svg><desc></p>text</desc></svg>', 'foreign-markup');
    refusedAs('<math><mi></br></mi></math>', 'foreign-markup');
  });

  it('a root start the parser ignores never opens foreign content: svg and math refuse with a template or a select open, or after a frameset', () => {
    for (const root of ['<svg>', '<math>', '<svg viewBox="0 0 1 1">']) {
      refusedAs(`<template>${root}`, 'foreign-markup');
      refusedAs(`<template><col>${root}`, 'foreign-markup');
      refusedAs(`<select>${root}`, 'foreign-markup');
      refusedAs(`<select><option>${root}`, 'foreign-markup');
      refusedAs(`<frameset></frameset>${root}`, 'foreign-markup');
    }
    expect(prescanMockup('<template><p>x</p></template><svg><path/></svg>')).toMatchObject({ ok: true });
    expect(prescanMockup('<select><option>a</option></select><svg><path/></svg>')).toMatchObject({ ok: true });
    expect(prescanMockup('<svg/><math/>')).toMatchObject({ ok: true });
  });

  it('a self-closed foreign element pops at once and pushes nothing; a nested root is a foreign element', () => {
    expect(prescanMockup(`<svg>${rep('<path/>', 1000)}</svg>`)).toMatchObject({ ok: true, depth: 1 });
    expect(prescanMockup(`<svg>${rep('<input/>', 1000)}</svg>`)).toMatchObject({ ok: true, depth: 1 });
    expect(prescanMockup(`<svg>${rep('<input>', D)}</svg>`)).toMatchObject({ ok: false, why: 'too-deep' });
    expect(prescanMockup(`<svg>${rep('<link>', D - 1)}`)).toMatchObject({ ok: true, depth: D });
    expect(prescanMockup('<svg><svg><svg></svg></svg></svg>')).toMatchObject({ ok: true, depth: 3 });
  });

  it('every round-6 refusal stands: CDATA with foreign content open, a raw-text start in a template, a stale <tr>', () => {
    refusedAs('<svg><![CDATA[x]]></svg>', 'foreign-markup');
    refusedAs('<template><col><xmp></template>', 'foreign-markup');
    refusedAs(rep('<tr><span></tr>', D), 'too-deep');
    refusedAs(`<svg></p><![CDATA[>${'<div>' + Array.from({ length: 100 }, (_, k) => `<b id=${k}>`).join('') + '</div>'}${rep('<p>x', 1000)}]]>`, 'too-many-formatting');
  });
});

/** `count` distinct attribute names `a0 a1 ...` (base 36), each preceded by a space. */
const attrs = (count: number): string => Array.from({ length: count }, (_, k) => ` a${k.toString(36)}`).join('');
const tooMany = { ok: false, why: 'too-many-attributes' } as const;

describe('the cap (D-8671): a start tag with more than MOCKUP_MAX_ATTRIBUTES attributes refuses the page', () => {
  it('the limit is inclusive: exactly MOCKUP_MAX_ATTRIBUTES attributes are admitted, one more is refused too-many-attributes', () => {
    for (const tag of ['b', 'div', 'span', 'a', 'p', 'svg', 'br', 'input', 'style', 'script', 'textarea', 'table', 'custom-element']) {
      expect(prescanMockup(`<${tag}${attrs(A)}>`), tag).toMatchObject({ ok: true });
      expect(prescanMockup(`<${tag}${attrs(A + 1)}>`), tag).toMatchObject(tooMany);
    }
    expect(prescanMockup(`<svg><g${attrs(A + 1)}></g></svg>`)).toMatchObject(tooMany);
    expect(prescanMockup(`<svg${attrs(A + 1)}/>`)).toMatchObject(tooMany);
    expect(prescanMockup(`<svg><path${attrs(A + 1)}/></svg>`)).toMatchObject(tooMany);
  });

  it('every attribute TOKEN counts: a duplicated name, a name with no value, quoted, single-quoted and unquoted values, and a first =', () => {
    expect(prescanMockup(`<b${' a'.repeat(A + 1)}>`)).toMatchObject(tooMany);
    expect(prescanMockup(`<b${' a'.repeat(A)}>`)).toMatchObject({ ok: true });
    expect(prescanMockup(`<b${Array.from({ length: A + 1 }, (_, k) => ` a${k}="v"`).join('')}>`)).toMatchObject(tooMany);
    expect(prescanMockup(`<b${Array.from({ length: A + 1 }, (_, k) => ` a${k}='v'`).join('')}>`)).toMatchObject(tooMany);
    expect(prescanMockup(`<b${Array.from({ length: A + 1 }, (_, k) => ` a${k}=v`).join('')}>`)).toMatchObject(tooMany);
    expect(prescanMockup(`<b${Array.from({ length: A + 1 }, (_, k) => ` a${k}= v`).join('')}>`)).toMatchObject(tooMany);
    expect(prescanMockup(`<b${Array.from({ length: A + 1 }, (_, k) => ` a${k}="v"b${k}`).join('')}>`)).toMatchObject(tooMany);
    // A first = starts a name; after a name, white space and then = is a VALUE (after-attribute-name), so the names are separated by a slash.
    expect(prescanMockup(`<b ${Array.from({ length: A + 1 }, (_, k) => `=${k}`).join('/')}>`)).toMatchObject(tooMany);
    expect(prescanMockup(`<b ${Array.from({ length: A }, (_, k) => `=${k}`).join('/')}>`)).toMatchObject({ ok: true });
    expect(prescanMockup(`<b${Array.from({ length: A + 1 }, (_, k) => `\t=${k}`).join('')}>`)).toMatchObject({ ok: true });
    expect(prescanMockup(`<b${Array.from({ length: A + 1 }, (_, k) => `\n"${k}`).join('')}>`)).toMatchObject(tooMany);
    expect(prescanMockup(`<b${Array.from({ length: A + 1 }, (_, k) => ` a${k}/`).join('')}>`)).toMatchObject(tooMany);
  });

  it('what is not an attribute token is not counted: a value full of names, a comment, text, an end tag\'s attributes', () => {
    expect(prescanMockup(`<b a="${attrs(5000)}">`)).toMatchObject({ ok: true });
    expect(prescanMockup(`<b a=${'x'.repeat(5000)}>`)).toMatchObject({ ok: true });
    expect(prescanMockup(`<!-- <b${attrs(5000)}> -->`)).toMatchObject({ ok: true, tags: 1 });
    expect(prescanMockup(`<script>var s = "<b${attrs(5000)}>";</script>`)).toMatchObject({ ok: true });
    expect(prescanMockup(`<b></b${attrs(5000)}>`)).toMatchObject({ ok: true });
    expect(prescanMockup(`<style>x</style${attrs(5000)}>`)).toMatchObject({ ok: true });
  });

  it('each start tag has its own budget: many tags at the cap are fine', () => {
    expect(prescanMockup(rep(`<br${attrs(A)}>`, 200))).toMatchObject({ ok: true });
    expect(prescanMockup(`${rep(`<br${attrs(A)}>`, 200)}<br${attrs(A + 1)}>`)).toMatchObject(tooMany);
  });

  it('the refusal carries the counts at that moment, and it is checked before the tag is pushed', () => {
    expect(prescanMockup(`<div><b${attrs(A + 1)}>`)).toMatchObject({ ok: false, why: 'too-many-attributes', depth: 1, formatting: 0 });
  });

  // The review's three probes (g1 to g3): Chromium copies every attribute into each reconstruction or adoption clone.
  it('g1: <div><b a0 ... aK></div> + paragraph divs (K = 150 000, 10 000, 1 000, 65)', () => {
    for (const k of [150_000, 10_000, 1000, A + 1]) {
      expect(prescanMockup(`<div><b${attrs(k)}></div>${rep('<div>x</div>', 4000)}`), String(k)).toMatchObject(tooMany);
    }
  });

  it('g2: a single start tag with 150 000 attributes', () => {
    expect(prescanMockup(`<div><b${attrs(150_000)}></div>`)).toMatchObject(tooMany);
    expect(prescanMockup(`<b${attrs(150_000)}>`)).toMatchObject(tooMany);
  });

  it('g3: the p-chain and the adoption-agency variants', () => {
    expect(prescanMockup(`<div><b${attrs(150_000)}></div>${rep('<p>x', 250)}`)).toMatchObject(tooMany);
    const unit = `<div>x${rep('<div>', 8)}</b>${rep('</div>', 9)}`;
    expect(prescanMockup(`<div><b${attrs(100_000)}></div>${rep(unit, 300)}`)).toMatchObject(tooMany);
  });

  it('the worst shape the cap admits stays a normal page: F formatting elements with the cap\'s attributes, filled to the tag limit', () => {
    const names = [...MOCKUP_FORMATTING_ELEMENTS].filter((n) => n !== 'a' && n !== 'nobr');
    let text = '<p>';
    for (let k = 0; k < F; k += 1) text += `<${names[k % names.length]!}${Array.from({ length: A }, (_, j) => ` a${k}_${j}`).join('')}>`;
    text += rep('<p>x</p>', Math.floor((T - 1 - F) / 2));
    expect(prescanMockup(text)).toMatchObject({ ok: true, formatting: F });
  });
});

/** Every `.html` file under `dir`, recursively, by `readdir` (no git). */
function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...htmlFiles(p));
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

describe('M5.EX4: the limits refuse no committed page and no page of a realistic shape', () => {
  const REPO = path.join(import.meta.dirname, '..', '..');

  it("this repository's committed HTML under docs/ (at most DOCS_MAX_DOC_BYTES; a larger file is download-only) is admitted", () => {
    const docs = htmlFiles(path.join(REPO, 'docs')).filter((f) => statSync(f).size <= DOCS_MAX_DOC_BYTES);
    expect(docs.length, 'at least one committed HTML file was read, so this row cannot pass vacuously').toBeGreaterThan(0);
    const rows = docs.map((f) => ({ file: path.relative(REPO, f).split(path.sep).join('/'), verdict: prescanMockup(readFileSync(f, 'utf8')) }));
    expect(rows.filter((r) => !r.verdict.ok).map((r) => ({ file: r.file, ...r.verdict }))).toEqual([]);
    for (const r of rows) process.stderr.write(`PRESCAN-DOCS-FILE ${r.file} depth=${r.verdict.depth} tags=${r.verdict.tags} formatting=${r.verdict.formatting}\n`);
    const most = (key: 'depth' | 'tags' | 'formatting'): number => Math.max(...rows.map((r) => r.verdict[key]));
    process.stderr.write(`PRESCAN-DOCS files=${rows.length} max_depth=${most('depth')} max_tags=${most('tags')} max_formatting=${most('formatting')}\n`);
  });

  /** A chain of `depth` divs holding `<p>x</p>` pairs, then its closes: exactly `tags` tags (a `<br>` makes up an odd one). */
  const generated = (depth: number, tags: number): string => {
    const rest = tags - 2 * depth;
    return `${rep('<div>', depth)}${rep('<p>x</p>', Math.floor(rest / 2))}${rest % 2 === 1 ? '<br>' : ''}${rep('</div>', depth)}`;
  };

  it.each([9, 12])('a synthetic page nested %i deep, sized to exactly MOCKUP_MAX_TAGS, is admitted', (depth) => {
    expect(prescanMockup(generated(depth, T))).toEqual({ ok: true, depth: depth + 1, tags: T, formatting: 0 });
  });

  it('the generator is exact: one tag over the limit is refused, so the page above sits at the limit', () => {
    expect(prescanMockup(generated(9, T + 1))).toMatchObject({ ok: false, why: 'too-many-tags', tags: T + 1 });
  });
});

describe('K1 (fix round 1, A1): the committed mockups\' attributes and desk-nav-mockup.html\'s depth', () => {
  const REPO = path.join(import.meta.dirname, '..', '..');

  it('each committed mockup\'s most attributes on one element is within MOCKUP_MAX_ATTRIBUTES, and desk-nav stands at depth 12', () => {
    const docs = htmlFiles(path.join(REPO, 'docs')).filter((f) => statSync(f).size <= DOCS_MAX_DOC_BYTES);
    expect(docs.length).toBeGreaterThan(0);
    const rows = docs.map((f) => {
      // jsdom's parser, an oracle independent of the pre-scan: the attributes an element keeps (a duplicated name once).
      const doc = new DOMParser().parseFromString(readFileSync(f, 'utf8'), 'text/html');
      let most = 0;
      for (const el of doc.querySelectorAll('*')) most = Math.max(most, el.attributes.length);
      return { file: path.relative(REPO, f).split(path.sep).join('/'), most };
    });
    for (const r of rows) process.stderr.write(`PRESCAN-DOCS-ATTRS ${r.file} most_attributes=${r.most}\n`);
    expect(rows.filter((r) => r.most > MOCKUP_MAX_ATTRIBUTES)).toEqual([]);
    const desk = docs.filter((f) => f.endsWith(`${path.sep}2026-11-06-desk-nav-mockup.html`));
    expect(desk).toHaveLength(1);
    expect(prescanMockup(readFileSync(desk[0]!, 'utf8'))).toMatchObject({ ok: true, depth: 12 });
  });
});

describe('the limits\' values are pinned in absolute numbers (fix round 1, A6): raising any one reds here', () => {
  it('depth 256, tags 15 000, open formatting 32, attributes 64 on a start tag', () => {
    expect({ depth: D, tags: T, formatting: F, attributes: A }).toEqual({ depth: 256, tags: 15_000, formatting: 32, attributes: 64 });
  });

  it('each boundary at its literal value: admitted at the value, refused one past it', () => {
    const attrs = (n: number): string => Array.from({ length: n }, (_, k) => ` a${k}`).join('');
    expect(prescanMockup(`<b${attrs(64)}>x</b>`).ok).toBe(true);
    expect(prescanMockup(`<b${attrs(65)}>x</b>`)).toMatchObject({ ok: false, why: 'too-many-attributes' });
    expect(prescanMockup('<div>'.repeat(256)).ok).toBe(true);
    expect(prescanMockup('<div>'.repeat(257))).toMatchObject({ ok: false, why: 'too-deep' });
    expect(prescanMockup('<br>'.repeat(15_000)).ok).toBe(true);
    expect(prescanMockup('<br>'.repeat(15_001))).toMatchObject({ ok: false, why: 'too-many-tags' });
    expect(prescanMockup('<b>'.repeat(32)).ok).toBe(true);
    expect(prescanMockup('<b>'.repeat(33))).toMatchObject({ ok: false, why: 'too-many-formatting' });
  });
});

describe('the module: ring L1, one linear pass', () => {
  const source = readFileSync(path.join(import.meta.dirname, '..', 'src', 'docs', 'mockup', 'prescan.ts'), 'utf8');

  it('imports only ./policy', () => {
    const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(specifiers).toEqual(['./policy']);
    const code = source.split('\n').filter((l) => !/^\s*(?:\/\/|\/\*|\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/\bDOMParser\b|\btoLowerCase\b|\bsetTimeout\b|\bdocument\b|\bwindow\b/);
  });
});
