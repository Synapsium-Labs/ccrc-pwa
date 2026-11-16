// `parseMockup`, the one HTML parse of a mockup (native Docs reader, completion plan Task 5, C1; base spec 2026-10-01
// 5.6.2 step 4, rows M5.22 and the DOMParser bullet of M5.16). The pre-scan runs first and a refusal returns BEFORE a
// parser is constructed: the native parse cannot be aborted, so the only guard is never starting it. The global
// `DOMParser` is replaced by a counting subclass, so a refusal is shown to construct none and to parse nothing, and an
// admitted page to construct exactly one and parse once. Fixtures at each limit are built from `policy.ts`'s constants.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMockup } from '../src/docs/mockup/parse';
import { prescanMockup } from '../src/docs/mockup/prescan';
import {
  MOCKUP_MAX_ATTRIBUTES, MOCKUP_MAX_DEPTH, MOCKUP_MAX_OPEN_FORMATTING, MOCKUP_MAX_TAGS,
} from '../src/docs/mockup/policy';

const RealDOMParser = DOMParser;
let constructed = 0;
let parsed: Array<readonly [string, string]> = [];

beforeEach(() => {
  constructed = 0;
  parsed = [];
  vi.stubGlobal('DOMParser', class extends RealDOMParser {
    constructor() {
      super();
      constructed += 1;
    }
    override parseFromString(text: string, type: DOMParserSupportedType): Document {
      parsed.push([text, type]);
      return super.parseFromString(text, type);
    }
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const rep = (s: string, n: number): string => s.repeat(n);

describe('a refusal constructs no parser and parses nothing (M5.22)', () => {
  it.each([
    ['too-deep', rep('<div>', MOCKUP_MAX_DEPTH + 1)],
    ['too-many-tags', rep('<br>', MOCKUP_MAX_TAGS + 1)],
    ['too-many-formatting', rep('<b>', MOCKUP_MAX_OPEN_FORMATTING + 1)],
    ['too-many-formatting (the reconstruction shape)', `<p>${rep('<b>', MOCKUP_MAX_OPEN_FORMATTING + 1)}${rep('<p>x</p>', 50)}`],
    ['too-many-tags (hidden in a script: raw text still counts its tags)', `<script>${rep('<br>', MOCKUP_MAX_TAGS + 1)}</script>`],
    ['too-deep (a comment ended by <!-->)', `<!-->${rep('<div>', MOCKUP_MAX_DEPTH + 1)}-->`],
    ['too-deep (the divergence shape: </span> over a div pops nothing)', rep('<span><div></span>', MOCKUP_MAX_DEPTH)],
    ['too-many-formatting (the review shape: </b> over a table pops nothing)',
      `<div>${Array.from({ length: 1874 }, (_, k) => `<b data-i=${k}><table></b></table>`).join('')}</div>${rep('<p>x</p>', 3751)}`],
    ['foreign-markup (the same with <svg><desc>: </b> reaches the HTML b through the foreign run)',
      `<div>${Array.from({ length: 1874 }, (_, k) => `<b data-i=${k}><svg><desc></b></desc></svg>`).join('')}</div>${rep('<p>x</p>', 3751)}`],
    ['too-deep (58 x <span> + 255 divs + </span>)', rep(`<span>${rep('<div>', 255)}</span>`, 58)],
    ['too-deep (</form> over spans keeps them)', rep(`<form>${rep('<span>', 200)}</form>`, 70)],
    ['too-many-formatting (misnested <b><div></b>)', rep('<b><div></b>', MOCKUP_MAX_TAGS / 3)],
    ['too-many-formatting (a self-closed <svg/> before an <object>: </b> is blocked)',
      `<div>${Array.from({ length: 100 }, (_, k) => `<b data-i=${k}><svg/><object></b></object>`).join('')}</div>${rep('<div>x</div>', 1000)}`],
    ['too-deep (a nested raw name keeps 8 divs the parser keeps: <b><style><style></style> + 8 divs)',
      `<section>${Array.from({ length: 100 }, (_, k) => `<b id=${k}><style><style></style>${rep('<div>', 8)}</style></b>`).join('')}</section>${rep('<div>x</div>', 1000)}`],
    ['foreign-markup (a not-self-closed <svg / > holds a foreign svg: the style after it is text-only)',
      `<section>${Array.from({ length: 100 }, (_, k) => `<b id=${k}><svg / ><style>${rep('<div>', 8)}</style></b>`).join('')}</section>${rep('<div>x</div>', 1000)}`],
    ['too-many-formatting (CDATA after </p> left foreign content: a bogus comment, so the payload is seen)', `<svg></p><![CDATA[>${'<div>' + Array.from({ length: 100 }, (_, k) => `<b id=${k}>`).join('') + '</div>'}${rep('<p>x', 1000)}]]>`],
    ['foreign-markup (CDATA with a foreign entry open)', '<svg><![CDATA[x]]></svg>'],
    ['foreign-markup (a raw-text start inside a template: <template><col><xmp>)', `<template><col><xmp></template>${'<div>' + Array.from({ length: 100 }, (_, k) => `<b id=${k}>`).join('') + '</div>'}${rep('<p>x', 1000)}</xmp>`],
    ['too-deep (a stale ignored <tr>: <tr><span></tr> repeated)', rep('<tr><span></tr>', MOCKUP_MAX_DEPTH)],
    ['foreign-markup (a start tag inside an svg foreignObject)', '<svg><foreignObject><span></foreignObject></svg>'],
    ['foreign-markup (a comment inside an svg style)', '<svg><style><!--</style></b>--></svg>'],
    ['foreign-markup (a start tag inside a math mi)', '<math><mi><b data-i=1></mi></math>'],
    ['too-many-attributes (one start tag past MOCKUP_MAX_ATTRIBUTES; fix round 1, A6)',
      `<b${Array.from({ length: MOCKUP_MAX_ATTRIBUTES + 1 }, (_, k) => ` a${k}`).join('')}>x</b>`],
  ])('%s', (name, text) => {
    const answer = parseMockup(text);
    expect(answer.ok).toBe(false);
    expect(answer).toEqual({ ok: false, prescan: prescanMockup(text) });
    expect(answer.prescan.ok).toBe(false);
    expect(answer.prescan.ok ? '' : answer.prescan.why).toBe(name.split(' ')[0]);
    expect(constructed).toBe(0);
    expect(parsed).toEqual([]);
  });

  it('the refusal carries the measured counts, so the viewer can show them', () => {
    const answer = parseMockup(rep('<div>', MOCKUP_MAX_DEPTH + 9));
    expect(answer.prescan).toEqual({ ok: false, why: 'too-deep', depth: MOCKUP_MAX_DEPTH + 1, tags: MOCKUP_MAX_DEPTH + 1, formatting: 0 });
  });
});

describe('an admitted page is parsed once, by one parser', () => {
  it('returns the Document of exactly the text it was given, as text/html, with the pre-scan beside it', () => {
    const text = '<!doctype html><html><head><title>Demo page</title></head><body><h1 id="a">Hello</h1><p>one<b>two</b></p></body></html>';
    const answer = parseMockup(text);
    expect(answer.ok).toBe(true);
    if (!answer.ok) throw new Error('unreachable');
    expect(constructed).toBe(1);
    expect(parsed).toEqual([[text, 'text/html']]);
    expect(answer.doc.title).toBe('Demo page');
    expect(answer.doc.getElementById('a')?.textContent).toBe('Hello');
    expect(answer.doc.querySelector('p')?.innerHTML).toBe('one<b>two</b>');
    expect(answer.prescan).toEqual(prescanMockup(text));
    expect(answer.prescan).toEqual({ ok: true, depth: 4, tags: 14, formatting: 1 });
  });

  it('reads the global at call time: a parser replaced after import is the one used', () => {
    const second: string[] = [];
    vi.stubGlobal('DOMParser', class extends RealDOMParser {
      override parseFromString(text: string, type: DOMParserSupportedType): Document {
        second.push(text);
        return super.parseFromString(text, type);
      }
    });
    expect(parseMockup('<p>x</p>').ok).toBe(true);
    expect(second).toEqual(['<p>x</p>']);
    expect(constructed).toBe(0);
  });

  it('an empty page is admitted and parsed once', () => {
    expect(parseMockup('').ok).toBe(true);
    expect(constructed).toBe(1);
    expect(parsed).toHaveLength(1);
  });
});

describe('a fixture exactly at each limit is admitted and parsed once (M5.22)', () => {
  it.each([
    ['depth MOCKUP_MAX_DEPTH', rep('<div>', MOCKUP_MAX_DEPTH), { depth: MOCKUP_MAX_DEPTH }],
    ['tags MOCKUP_MAX_TAGS', rep('<br>', MOCKUP_MAX_TAGS), { tags: MOCKUP_MAX_TAGS }],
    ['formatting MOCKUP_MAX_OPEN_FORMATTING', rep('<b>', MOCKUP_MAX_OPEN_FORMATTING), { formatting: MOCKUP_MAX_OPEN_FORMATTING }],
  ])('%s', (_name, text, counts) => {
    const answer = parseMockup(text);
    expect(answer.ok).toBe(true);
    expect(answer.prescan).toMatchObject({ ok: true, ...counts });
    expect(constructed).toBe(1);
    expect(parsed).toHaveLength(1);
    if (answer.ok) expect(answer.doc.body).not.toBeNull();
  });
});
