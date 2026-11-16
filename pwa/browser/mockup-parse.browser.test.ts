// M5.B8: the parse budget of the mockup viewer, measured in a real Chrome (native Docs reader, completion plan Task 5,
// C1; base spec 2026-10-01 5.6.2 "The time budget", rows M5.B8 and E13). The pre-scan (`mockup/prescan.ts`, rule v7 and the
// attribute cap D-8671; the labels below are the versions and review rounds of the completion plan's Results, C1) is the only
// guard before the browser's uncancellable `DOMParser` parse, so its limits are only as good as the
// worst page it ADMITS. This file builds each worst shape the limits admit, at the constants `policy.ts` holds, and
// times `new DOMParser().parseFromString(text, 'text/html')` on it inside a blank page (`performance.now()` around the
// one call). Every gate asserts, in node, that `prescanMockup` ADMITS the fixture and that it stands at the limit it
// stands for, then that Chrome parses it in at most PARSE_BUDGET_MS (the median of three, so one slow turn of a loaded
// box is not a red). The gates, in this order:
//   (a) formatting reconstruction: a `<p>`, then F `<b>`-like elements with distinct attributes (the parser clones them
//       into every later paragraph; `a` and `nobr` are left out because the parser collapses a second one), then
//       `<p>x</p>` until the tag limit;
//   (b) the deep shape: nested `<div>` to a pre-scan depth of MOCKUP_MAX_DEPTH, then `<span></span>` pairs inside the
//       deepest until the tag limit, and the same with `<p></p>` pairs, whose start tag walks the whole stack;
//   (f) nested tables, where the parser's depth exceeds the pre-scan's (the implied `tbody`): `<table><tr><td>` to the
//       deepest depth the pre-scan admits, then `<td>x</td>` to the tag limit;
//   (w) the WORST shape the property test (`test/mockup-prescan.test.ts`) found, by its node ratio, rebuilt at the tag
//       limit: its hostile unit at the most the pre-scan admits (F repeats), an enclosing block closed, then `<p>x</p>` to
//       the tag limit. The unit is `<b data-i=k><table></b></table>`: the parser ignores that `</b>`, so each `<b>` stays
//       in its list of active formatting elements while the pre-scan counts it;
//   (t) the text- and comment-heavy shape at the deepest stack the pre-scan admits: `<b>`, 255 real divs, then `x<!---->` runs
//       to the 2 MiB bound (a deep stack makes every text run and comment cost what its depth costs);
//   (x) FOREIGN CONTENT (D-8663), one row per variant, small (128 repeats, about 3 000 tags): the formatting-leak unit through
//       each integration point (svg foreignObject, desc, title; math mi, mo, mn, ms, mtext, annotation-xml), the two leaks the
//       review measured through an svg `style` (a comment, and an attribute value, hiding `</style></b>`), and the svg `title`
//       RCDATA bypass. Each asserts `foreign-markup`, and parses in Chromium ONLY when `prescanMockup` admits the page (a v2
//       pre-scan does, and the row prints what Chromium built: more than 36 elements a tag is the leak, and the row is red);
//   (y) a SELF-CLOSED `<svg/>` or `<math/>` (v4): the parser pops it at once, and the `<object>`, `<applet>`, `<marquee>` or
//       `<template>` after it is an HTML element with a formatting marker that ignores `</b>`; each of the eight variants (100
//       copies, 1000 paragraphs, 40 elements a tag) asserts `too-many-formatting`, and parses in Chromium only if admitted;
//   (z) v5, RAW TEXT AND TAG ENDS, EXACT. (z1) the review's nested raw name (`<b id=k><R><R></R>` + 8 divs + `</R></b>`, for style,
//       title, textarea, xmp, iframe, noembed, noframes and script) and its `<svg / >` family (`<svg / >`, `<svg /\t>`,
//       `<svg / x>`, `<math / >`, then a style and 8 divs), 100 copies and 1000 paragraphs, 12 heavy fixtures, each refused and
//       parsed in Chromium only if admitted; (z2) the ORACLE rows: a batch of small pages parsed once in Chromium, and the
//       pre-scan's answer compared with it: where a script, a style, a textarea or a plaintext ends (the number of `<b>` the
//       parser makes after the text, against the pre-scan's formatting count), and whether a root tag self-closed (the number
//       of children the root `<svg>` or `<math>` has, against the pre-scan's depth);
//   (v6) THE FIFTH REVIEW (round 5). (v6a) the generators, `S(M, R)` = `<div>` + M x `<b id=k>` + `</div>` + R x `<p>x`, 100 and 1000:
//       CDATA after the parser left foreign content (`<svg></p><![CDATA[>`, `<math></br>...`, `<svg><font color=x>...`), a raw-text
//       start the parser ignores (`<template><col><xmp>`, `<plaintext>`), and the stale-entry shapes (an implicit close of a p, a
//       heading or a button, a form with a null pointer, an ignored `<tr>`, `<td>` or `<caption>`, followed by li and dd): 12 heavy
//       fixtures, each refused, and parsed in Chromium only if admitted; (v6c) the oracle pages: CDATA as a bogus comment or not,
//       `</p>` and `</br>` as foreign exits, and font with and without color, face and size;
//   (v7) THE SIXTH REVIEW (round 6). FOREIGN CONTENT IS EXACT OR REFUSED: the scan's foreign entries are one run on top of its stack that mirrors
//       the parser's (a root is pushed only where the parser surely makes it; a self-closed child pops at once; an end tag walks
//       down through the run; a breakout, `</p>` and `</br>` pop exactly the run; an end tag whose walk reaches an HTML entry
//       refuses). (v7a) the review's five cycles (a stale foreign source, eight elements the parser holds as HTML specials, an exit,
//       the close of a formatting element), 100 copies and 1000 paragraphs: refused, and parsed in Chromium only if admitted;
//       (v7c) the ORACLE: every HTML element name against Chromium's breakout list, icon and exit pages against the namespace
//       Chromium gives the element after them, the font breakout, and CDATA after an exit;
//   (cap) THE ATTRIBUTE CAP (D-8671), after the seventh review (round 7). The parser copies every attribute of a
//       formatting element into each clone it makes, so a tag
//       with 150 000 attributes and 4 000 paragraphs took 19.1 s. (cap-a) the review's probes g1 to g3, at sizes that stay under a second
//       on v7 (20 000 attributes): refused `too-many-attributes`, parsed in Chromium only if admitted; (cap) the two WORST shapes the
//       cap admits, gated at MOCKUP_MAX_ATTRIBUTES: F formatting elements each carrying the cap's attributes, filled to the tag limit
//       (reconstruction), and the adoption-agency variant;
//   (d) the control: E13's 660 KiB of nested `<div>`, parsed DIRECTLY (not through `parseMockup`), must exceed 1000 ms,
//       which proves the timer can see the hazard, and the same text is refused `too-deep` by the pre-scan.
// A fixture counts against the 12 when Chromium parses it, so the foreign rows (refused on v3) cost nothing there.
// The shapes v2 REFUSES (the old divergence shape `<span><div></span>`, and the misnested `<b><div></b>`, plain and with
// distinct attributes) are no Chrome fixtures any more: `test/mockup-prescan.test.ts` holds them as refusals.
// Under `CCRC_MEASURE=1` each gate prints one `M5B8-MEASURE` line through stderr: shape, parameters, bytes, the pre-scan's
// tags/depth/formatting, the DOM size and the three times with their median, after one line naming the engine. A run
// builds at most 12 fixtures (the memo check below), each at most 2 MiB, all in memory, each timed three times (the
// control once).
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> [CCRC_MEASURE=1] ./node_modules/.bin/vitest run --config
// vitest.browser.config.ts browser/mockup-parse.browser.test.ts )`, through `ccrc test`.
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import {
  MOCKUP_FORMATTING_ELEMENTS, MOCKUP_MAX_ATTRIBUTES, MOCKUP_MAX_DEPTH, MOCKUP_MAX_OPEN_FORMATTING, MOCKUP_MAX_TAGS,
} from '../src/docs/mockup/policy';
import { prescanMockup, type MockupPrescan } from '../src/docs/mockup/prescan';
import { resolveChrome } from './harness';

/** The budget M5.B8 pins (base 5.6.2): a parse of an admitted page finishes within it. */
const PARSE_BUDGET_MS = 1000;
/** The most bytes a generated fixture may have (the Docs HTML cap, `DOCS_MAX_DOC_BYTES`). */
const FIXTURE_MAX_BYTES = 2 * 1024 * 1024;
/** The most fixtures one run generates (plan Task 5 step 4). */
const FIXTURE_MAX_COUNT = 12;
const MEASURE = process.env['CCRC_MEASURE'] === '1';

/** The formatting elements the shape cycles through. `a` and `nobr` are left out: a second one while the first is
 *  active runs the parser's adoption agency and removes the earlier, so they would not stay active at F. */
const SHAPE_NAMES: readonly string[] = [...MOCKUP_FORMATTING_ELEMENTS].filter((n) => n !== 'a' && n !== 'nobr');

/** (a): a `<p>`, `open` formatting elements with distinct attributes, then `<p>x</p>` while the tag count stays within `tags`. */
const formattingShape = (open: number, tags: number): string => {
  let text = '<p>';
  for (let k = 0; k < open; k += 1) text += `<${SHAPE_NAMES[k % SHAPE_NAMES.length]!} data-i="${k}">`;
  return text + '<p>x</p>'.repeat(Math.floor((tags - 1 - open) / 2));
};
/** (b): the deepest stack the pre-scan admits, `depth` open names: `depth - 1` nested divs, then `<span></span>` pairs (or
 *  `<p></p>` pairs, whose start tag walks the whole stack for a `p` in scope) inside the deepest while the tag count stays
 *  within `tags`. The brief's "256 divs, then spans inside the deepest" would put the first span at depth 257, which the
 *  pre-scan refuses, so the divs are one fewer and the pairs sit at depth 256. */
const deepShape = (depth: number, tags: number, fill: 'span' | 'p' = 'span'): string =>
  '<div>'.repeat(depth - 1) + `<${fill}></${fill}>`.repeat(Math.floor((tags - (depth - 1)) / 2));
/** (f): nested tables, where the parser's depth exceeds the pre-scan's (the implied `tbody`): `<table><tr><td>` while the
 *  pre-scan's depth stays within `depth`, then `<td>x</td>` inside the deepest cell while the tag count stays within `tags`. */
const tablesShape = (depth: number, tags: number): string => {
  const levels = Math.floor((depth - 1) / 3);
  return '<table><tr><td>'.repeat(levels) + '<td>x</td>'.repeat(Math.floor((tags - levels * 3) / 2));
};
/** (w): the property test's worst admitted shape, rebuilt at the tag limit: `<section>`, `open` copies of the hostile unit,
 *  `</section>`, then `<p>x</p>` while the tag count stays within `tags`. */
const worstShape = (open: number, tags: number): string => {
  let text = '<section>';
  for (let k = 0; k < open; k += 1) text += `<b data-i=${k}><table></b></table>`;
  text += '</section>';
  return text + '<p>x</p>'.repeat(Math.floor((tags - 2 - 4 * open) / 2));
};
/** (c): the reconstruction shape with `attributes` distinct attributes on each of F formatting elements (`a` and `nobr` left out as in (a)). */
const attributeRecon = (open: number, attributes: number, tags: number): string => {
  let text = '<p>';
  for (let k = 0; k < open; k += 1) {
    text += `<${SHAPE_NAMES[k % SHAPE_NAMES.length]!}${Array.from({ length: attributes }, (_, j) => ` a${k}_${j}`).join('')}>`;
  }
  return text + '<p>x</p>'.repeat(Math.floor((tags - 1 - open) / 2));
};
/** (c): the adoption-agency variant: F attributed formatting elements closed out of their block, then cycles of eight nested divs
 *  inside which `</b>` runs the adoption agency over a furthest block. */
const attributeAdoption = (open: number, attributes: number, tags: number): string => {
  let text = '<div>';
  for (let k = 0; k < open; k += 1) {
    text += `<${SHAPE_NAMES[k % SHAPE_NAMES.length]!}${Array.from({ length: attributes }, (_, j) => ` a${k}_${j}`).join('')}>`;
  }
  const cycle = `<div>x${'<div>'.repeat(8)}</b>${'</div>'.repeat(9)}`;
  return `${text}</div>${cycle.repeat(Math.floor((tags - 2 - open) / 19))}`;
};
/** (t): `<b>`, 255 real divs, then `x<!---->` runs filling the 2 MiB bound. */
const textHeavyShape = (): string => `<b>${'<div>'.repeat(255)}${'x<!---->'.repeat(Math.floor((FIXTURE_MAX_BYTES - 3 - 5 * 255) / 8))}`;
/** (x): `<wrap>`, `copies` of a unit built per copy, `</wrap>`, then `<p>x</p>` paragraphs: the unit leaves formatting elements in
 *  the parser's list while the pre-scan's stack and count read small, and each paragraph clones them. */
const foreignLeak = (unit: (k: number) => string, wrap: string, copies = 128, paragraphs = 1000): string =>
  `<${wrap}>${Array.from({ length: copies }, (_, k) => unit(k)).join('')}</${wrap}>${'<p>x</p>'.repeat(paragraphs)}`;
/** (d): E13's fixture, 660 KiB of nested divs. */
const e13Text = (): string => '<div>'.repeat(Math.ceil((660 * 1024) / 5));

let browser: Browser;
let engine = '';
const memo = new Map<string, { text: string; times: number[]; elements: number }>();

/** Times `parseFromString` `runs` times on `text` inside a blank page of a fresh context; the DOM size is read once, outside the timer. */
async function timeParse(key: string, text: string, runs: number): Promise<{ text: string; times: number[]; elements: number }> {
  const known = memo.get(key);
  if (known !== undefined) return known;
  expect(Buffer.byteLength(text, 'utf8'), `${key} stays within the fixture byte bound`).toBeLessThanOrEqual(FIXTURE_MAX_BYTES);
  expect(memo.size, 'the run stays within the fixture count bound').toBeLessThan(FIXTURE_MAX_COUNT);
  const page = await (await browser.newContext()).newPage();
  try {
    await page.goto('about:blank');
    const result = await page.evaluate(({ text: html, runs: n }) => {
      const times: number[] = [];
      let elements = 0;
      for (let i = 0; i < n; i += 1) {
        const t0 = performance.now();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        times.push(performance.now() - t0);
        if (i === 0) elements = doc.getElementsByTagName('*').length;
      }
      return { times, elements };
    }, { text, runs });
    const out = { text, ...result };
    memo.set(key, out);
    return out;
  } finally {
    await page.context().close();
  }
}

const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const ms = (x: number): string => x.toFixed(1);
const counts = (p: MockupPrescan): string => `tags=${p.tags} depth=${p.depth} formatting=${p.formatting}`;

/** One measurement line, read by whoever fixes the limits. */
const printed = new Set<string>();
function report(shape: string, params: string, got: { text: string; times: number[]; elements: number }): void {
  if (printed.has(`${shape} ${params}`)) return;
  printed.add(`${shape} ${params}`);
  process.stderr.write(`M5B8-MEASURE shape=${shape} params=${params} bytes=${Buffer.byteLength(got.text, 'utf8')} prescan[${counts(prescanMockup(got.text))}] `
    + `ok=${prescanMockup(got.text).ok} domElements=${got.elements} times_ms=[${got.times.map(ms).join(', ')}] median_ms=${ms(median(got.times))}\n`);
}

beforeAll(async () => {
  const executablePath = resolveChrome();
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const ua = await page.evaluate(() => navigator.userAgent);
  await page.close();
  engine = `browser.version=${browser.version()} build=${path.basename(path.dirname(path.dirname(executablePath)))} userAgent=${ua}`;
  if (MEASURE) process.stderr.write(`M5B8-MEASURE engine ${engine} limits[depth=${MOCKUP_MAX_DEPTH} tags=${MOCKUP_MAX_TAGS} formatting=${MOCKUP_MAX_OPEN_FORMATTING}]\n`);
});
afterAll(async () => {
  await browser?.close();
});

/** Asserts the always-on facts of one gating fixture: admitted by the pre-scan, at the limits it is the worst of, and
 *  parsed within the budget. */
async function gate(key: string, text: string, reaches: (p: MockupPrescan) => boolean): Promise<void> {
  const verdict = prescanMockup(text);
  expect(verdict, 'the worst shape the limits admit is ADMITTED by the pre-scan').toMatchObject({ ok: true });
  expect(reaches(verdict), `the fixture reaches the limit it stands for: ${counts(verdict)}`).toBe(true);
  const got = await timeParse(key, text, 3);
  if (MEASURE) report(key.split(' ')[0]!, key.slice(key.indexOf(' ') + 1), got);
  expect(median(got.times), `${key}: median of ${got.times.map(ms).join(', ')} ms`).toBeLessThanOrEqual(PARSE_BUDGET_MS);
}

describe('M5.B8 (a): formatting reconstruction', { timeout: 120_000 }, () => {
  it('the worst formatting shape the limits admit (F = MOCKUP_MAX_OPEN_FORMATTING at MOCKUP_MAX_TAGS) parses within the budget', async () => {
    await gate(`a-formatting F=${MOCKUP_MAX_OPEN_FORMATTING} T=${MOCKUP_MAX_TAGS}`, formattingShape(MOCKUP_MAX_OPEN_FORMATTING, MOCKUP_MAX_TAGS),
      (p) => p.formatting === MOCKUP_MAX_OPEN_FORMATTING && p.tags >= MOCKUP_MAX_TAGS - 1);
  });
});

describe('M5.B8 (b): the deep shape', { timeout: 120_000 }, () => {
  it('the worst deep shape the limits admit (MOCKUP_MAX_DEPTH at MOCKUP_MAX_TAGS) parses within the budget', async () => {
    await gate(`b-deep D=${MOCKUP_MAX_DEPTH} T=${MOCKUP_MAX_TAGS}`, deepShape(MOCKUP_MAX_DEPTH, MOCKUP_MAX_TAGS),
      (p) => p.depth === MOCKUP_MAX_DEPTH && p.tags >= MOCKUP_MAX_TAGS - 1);
  });

  it('the same stack filled with <p></p> pairs, whose start tag walks the whole stack, parses within the budget too', async () => {
    await gate(`b-deep-p D=${MOCKUP_MAX_DEPTH} T=${MOCKUP_MAX_TAGS}`, deepShape(MOCKUP_MAX_DEPTH, MOCKUP_MAX_TAGS, 'p'),
      (p) => p.depth === MOCKUP_MAX_DEPTH && p.tags >= MOCKUP_MAX_TAGS - 1);
  });
});

describe('M5.B8 (f): nested tables, where the parser\'s depth exceeds the pre-scan\'s', { timeout: 120_000 }, () => {
  it('nested tables at MOCKUP_MAX_DEPTH and MOCKUP_MAX_TAGS are admitted and parse within the budget', async () => {
    await gate(`f-tables D=${MOCKUP_MAX_DEPTH} T=${MOCKUP_MAX_TAGS}`, tablesShape(MOCKUP_MAX_DEPTH, MOCKUP_MAX_TAGS),
      (p) => p.depth >= MOCKUP_MAX_DEPTH - 2 && p.tags >= MOCKUP_MAX_TAGS - 2);
  });
});

describe('M5.B8 (w): the worst shape the property test found, rebuilt at the tag limit', { timeout: 120_000 }, () => {
  it('its hostile unit F times, an enclosing block closed, then paragraphs to MOCKUP_MAX_TAGS, is admitted and parses within the budget', async () => {
    await gate(`w-worst-property F=${MOCKUP_MAX_OPEN_FORMATTING} T=${MOCKUP_MAX_TAGS}`, worstShape(MOCKUP_MAX_OPEN_FORMATTING, MOCKUP_MAX_TAGS),
      (p) => p.formatting === MOCKUP_MAX_OPEN_FORMATTING && p.tags >= MOCKUP_MAX_TAGS - 2);
  });

  it('one more copy of the unit is refused too-many-formatting, so the shape stands exactly at the limit', () => {
    expect(prescanMockup(worstShape(MOCKUP_MAX_OPEN_FORMATTING + 1, MOCKUP_MAX_TAGS))).toMatchObject({ ok: false, why: 'too-many-formatting' });
  });
});

/** Refused by the current pre-scan with no parse; admitted by an older one, parsed once, and printed. */
async function refusedRow(key: string, text: string, why: string): Promise<void> {
  const verdict = prescanMockup(text);
  const tagsText = (text.match(/<\/?[A-Za-z]/g) ?? []).length;
  if (verdict.ok) {
    const got = await timeParse(key, text, 1);
    process.stderr.write(`M5B8-FOREIGN ${key} admitted=true tags=${tagsText} elements=${got.elements} per_tag=${(got.elements / tagsText).toFixed(1)} `
      + `ms=${ms(got.times[0]!)} prescan[${counts(verdict)}]\n`);
  } else process.stderr.write(`M5B8-FOREIGN ${key} refused=${verdict.why} prescan[${counts(verdict)}]\n`);
  expect(verdict, `${key}: the pre-scan must refuse it`).toMatchObject({ ok: false, why });
}


const foreignRow = (key: string, text: string): Promise<void> => refusedRow(key, text, 'foreign-markup');

describe('M5.B8 (cap, D-8671): the worst shapes the attribute cap admits', { timeout: 120_000 }, () => {
  it('F formatting elements each with MOCKUP_MAX_ATTRIBUTES attributes, filled to MOCKUP_MAX_TAGS (reconstruction), parse within the budget', async () => {
    await gate(`c-attr-recon F=${MOCKUP_MAX_OPEN_FORMATTING} A=${MOCKUP_MAX_ATTRIBUTES} T=${MOCKUP_MAX_TAGS}`,
      attributeRecon(MOCKUP_MAX_OPEN_FORMATTING, MOCKUP_MAX_ATTRIBUTES, MOCKUP_MAX_TAGS),
      (p) => p.formatting === MOCKUP_MAX_OPEN_FORMATTING && p.tags >= MOCKUP_MAX_TAGS - 1);
  });

  it('the adoption-agency variant at the cap parses within the budget too', async () => {
    await gate(`c-attr-adoption F=${MOCKUP_MAX_OPEN_FORMATTING} A=${MOCKUP_MAX_ATTRIBUTES} T=${MOCKUP_MAX_TAGS}`,
      attributeAdoption(MOCKUP_MAX_OPEN_FORMATTING, MOCKUP_MAX_ATTRIBUTES, MOCKUP_MAX_TAGS),
      (p) => p.formatting === MOCKUP_MAX_OPEN_FORMATTING && p.tags >= MOCKUP_MAX_TAGS - 20);
  });

  it('one attribute past the cap on any of the elements is refused too-many-attributes', () => {
    expect(prescanMockup(attributeRecon(MOCKUP_MAX_OPEN_FORMATTING, MOCKUP_MAX_ATTRIBUTES + 1, MOCKUP_MAX_TAGS))).toMatchObject({ ok: false, why: 'too-many-attributes' });
    expect(prescanMockup(attributeAdoption(MOCKUP_MAX_OPEN_FORMATTING, MOCKUP_MAX_ATTRIBUTES + 1, MOCKUP_MAX_TAGS))).toMatchObject({ ok: false, why: 'too-many-attributes' });
  });
});

describe('M5.B8 (cap-a, D-8671): the attribute probes g1 to g3, in real Chromium: refused, and parsed only if admitted', { timeout: 180_000 }, () => {
  const attrs = (count: number): string => Array.from({ length: count }, (_, k) => ` a${k.toString(36)}`).join('');
  it('g1: <div><b a0..a20000></div> + 1000 paragraph divs', async () => {
    await refusedRow('cap-g1', `<div><b${attrs(20_000)}></div>${'<div>x</div>'.repeat(1000)}`, 'too-many-attributes');
  });

  it('g2: a single start tag with 150 000 attributes', async () => {
    await refusedRow('cap-g2', `<div><b${attrs(150_000)}></div>`, 'too-many-attributes');
  });

  it('g3: the p-chain variant (20 000 attributes, 250 paragraphs)', async () => {
    await refusedRow('cap-g3-p', `<div><b${attrs(20_000)}></div>${'<p>x'.repeat(250)}`, 'too-many-attributes');
  });

  it('g3: the adoption-agency variant (20 000 attributes, 100 cycles)', async () => {
    await refusedRow('cap-g3-aaa', `<div><b${attrs(20_000)}></div>${`<div>x${'<div>'.repeat(8)}</b>${'</div>'.repeat(9)}`.repeat(100)}`, 'too-many-attributes');
  });
});

describe('M5.B8 (t): text and comment runs at the deepest admitted stack', { timeout: 120_000 }, () => {
  it('<b>, 255 divs, then x<!----> runs to 2 MiB is admitted and parses within the budget', async () => {
    await gate(`t-text-heavy D=${MOCKUP_MAX_DEPTH}`, textHeavyShape(), (p) => p.depth === MOCKUP_MAX_DEPTH && p.tags === 256);
  });
});

describe('M5.B8 (x): foreign content, in real Chromium: every variant is refused foreign-markup, and parsed only if admitted', { timeout: 120_000 }, () => {
  it.each([
    ['svg', 'foreignObject'], ['svg', 'desc'], ['svg', 'title'], ['math', 'mi'], ['math', 'mo'], ['math', 'mn'], ['math', 'ms'],
    ['math', 'mtext'], ['math', 'annotation-xml'],
  ])('the formatting-leak unit through <%s><%s> (table, 128 copies, 1000 paragraphs)', async (root, el) => {
    await foreignRow(`x-${root}-${el}`, foreignLeak((k) => `<b data-i=${k}><${root}><${el}><span></${el}></${root}></b>`, 'table'));
  });

  it('an svg style whose comment hides </style></b> (the pre-scan must not leave the text-only element early)', async () => {
    await foreignRow('x-style-comment', foreignLeak((k) => `<b data-i=${k}><svg><style><!--</style></b>--></svg>`, 'div'));
  });

  it('an svg style whose attribute value hides </style></b>', async () => {
    await foreignRow('x-style-attribute', foreignLeak((k) => `<b data-i=${k}><svg><style><g title="</style></b>"></svg>`, 'div'));
  });

  it('the svg title bypass: a font with color leaves foreign content (v6), so the title is RCDATA and the b after its first </title is SEEN and counted', async () => {
    await refusedRow('x-title-rcdata', foreignLeak((k) => `<svg><font color=red><title><!--</title><b data-i=${k}>--></title></font></svg>`, 'div'), 'too-many-formatting');
  });
});

describe('M5.B8 (y): a self-closed svg or math, in real Chromium: the parser pops it at once, and an HTML element with a marker follows', { timeout: 120_000 }, () => {
  it.each(['svg', 'math'].flatMap((r) => ['object', 'applet', 'marquee', 'template'].map((e) => [r, e] as const)))(
    '<b data-i=k><%s/><%s></b></...> x 100, then 1000 paragraphs (40 elements a tag in Chromium) is refused too-many-formatting',
    async (root, el) => {
      const unit = (k: number): string => `<b data-i=${k}><${root}/><${el}></b></${el}>`;
      await refusedRow(`y-${root}-${el}`, `<div>${Array.from({ length: 100 }, (_, k) => unit(k)).join('')}</div>${'<div>x</div>'.repeat(1000)}`, 'too-many-formatting');
    },
  );
});

const RAW_TEXT_NAMES = ['style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'script'];

describe('M5.B8 (z1): the v5 review shapes, in real Chromium: refused, and parsed only if admitted', { timeout: 180_000 }, () => {
  it.each(RAW_TEXT_NAMES)('<b id=k><%s><%s></...> + 8 divs + </...></b> x 100, then 1000 paragraphs', async (raw) => {
    const unit = (k: number): string => `<b id=${k}><${raw}><${raw}></${raw}>${'<div>'.repeat(8)}</${raw}></b>`;
    await refusedRow(`z-nested-${raw}`, `<section>${Array.from({ length: 100 }, (_, k) => unit(k)).join('')}</section>${'<div>x</div>'.repeat(1000)}`, 'too-deep');
  });

  it.each(['<svg / >', '<svg /\t>', '<svg / x>', '<math / >'])('<b id=k>%j<style> + 8 divs + </style></b> x 100, then 1000 paragraphs', async (tag) => {
    const unit = (k: number): string => `<b id=${k}>${tag}<style>${'<div>'.repeat(8)}</style></b>`;
    await refusedRow(`z-spaced-${JSON.stringify(tag)}`, `<section>${Array.from({ length: 100 }, (_, k) => unit(k)).join('')}</section>${'<div>x</div>'.repeat(1000)}`, 'foreign-markup');
  });
});

describe('M5.B8 (z2): the pre-scan agrees with Chromium on where raw text ends and on whether a root tag self-closed', { timeout: 120_000 }, () => {
  /** What Chromium made of each page: the number of `<b>` elements, and the number of children of its first svg or math root. */
  async function oracle(texts: readonly string[]): Promise<Array<{ b: number; rootChildren: number }>> {
    const page = await (await browser.newContext()).newPage();
    try {
      await page.goto('about:blank');
      return await page.evaluate((all) => all.map((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return { b: doc.getElementsByTagName('b').length, rootChildren: doc.querySelector('svg, math')?.children.length ?? -1 };
      }), [...texts]);
    } finally {
      await page.context().close();
    }
  }

  /** `<open>` + pre + `</close>` + `<b data-i=1>` + `</close>`: the parser makes the b only if the text ended at the first end tag. */
  const endsAt = (open: string, pre: string, close: string, again = close): string => `<${open}>${pre}${close}<b data-i=1>${again}`;

  const SCRIPT_PRES = [
    'x', '<!-x', '<!-- x ', '<!-->', '<!--->', '<!---->', '<!--<script>', '<!--<SCRIPT>', '<!--<script/>', '<!--<script\t>', '<!--<script\n>', '<!--<script\f>',
    '<!--<script >', '<!--<scripts>', '<!--<script1>', '<!--<scrip>', '<!--<script', '<!--<script> -->', '<!--<script> --!>', '<!--<script> <!-- ',
    '<!--<script></script >', '<!--<script></script/>', '<!--<script></scripts>', '<!--<script> --><!--', '<!--</scriptx>', '<!-- - -- --- ->', '<!------',
    '<!--<script>--', '<!--<script>-- >', '<!--<script> - -> ', '<!--<script></script x>', '<!--<script></SCRIPT>', '<!--<script> </script> --> ',
  ];
  const SCRIPT_CLOSES = ['</script>', '</SCRIPT>', '</script\t>', '</script\n>', '</script\f>', '</script />', '</script/>', '</script a=">">', '</script a="<b data-i=2>">', '</scriptx>'];
  const OTHER_PRES = (name: string): string[] => ['x', '<!--', '<script>', `</${name}x>`, `</${name.slice(0, -1)}>`, `</${name}1>`, `</${name}-x>`, `</ ${name}>`, `<${name}>`, `</${name}`];
  const OTHER_CLOSES = (name: string): string[] => [`</${name}>`, `</${name.toUpperCase()}>`, `</${name}\t>`, `</${name}\n>`, `</${name}\f>`, `</${name} />`, `</${name}/>`, `</${name} a=">">`, `</${name} a='>'>`, `</${name} a="<b data-i=2>">`];

  it('script data: every escape, double escape and end-tag shape ends where Chromium ends it', async () => {
    const texts: string[] = [];
    for (const pre of SCRIPT_PRES) texts.push(endsAt('script', pre, '</script>'));
    for (const close of SCRIPT_CLOSES) for (const pre of ['', '<!-- x ']) texts.push(endsAt('script', pre, close, '</script>'));
    texts.push('<SCRIPT>x</SCRIPT><b data-i=1></script>');
    const made = await oracle(texts);
    texts.forEach((text, i) => {
      const verdict = prescanMockup(text);
      expect(verdict.ok, text).toBe(true);
      expect(verdict.formatting, `${JSON.stringify(text)}: Chromium made ${made[i]!.b} b`).toBe(made[i]!.b);
    });
  });

  it('style, xmp, iframe, noembed, noframes, textarea, title and plaintext end where Chromium ends them', async () => {
    const texts: string[] = [];
    for (const name of ['style', 'xmp', 'iframe', 'noembed', 'noframes', 'textarea', 'title']) {
      for (const pre of OTHER_PRES(name)) texts.push(endsAt(name, pre, `</${name}>`));
      for (const close of OTHER_CLOSES(name)) texts.push(endsAt(name, 'x', close, `</${name}>`));
    }
    texts.push('<plaintext>x</plaintext><b data-i=1><div>', '<plaintext><b data-i=1>', '<b data-i=1><plaintext>x</plaintext><b data-i=2>');
    const made = await oracle(texts);
    texts.forEach((text, i) => {
      const verdict = prescanMockup(text);
      expect(verdict.ok, text).toBe(true);
      expect(verdict.formatting, `${JSON.stringify(text)}: Chromium made ${made[i]!.b} b`).toBe(made[i]!.b);
    });
  });

  it('a root tag self-closes exactly when the tokenizer\'s self-closing flag is set: the children the root keeps equal the pre-scan\'s depth less one', async () => {
    const tags = [
      '<svg/>', '<svg />', '<svg\t/>', '<svg\n/>', '<svg a/>', '<svg a />', '<svg a="b"/>', "<svg a='b'/>", '<svg a="b" />', '<svg =/>', '<svg "/>', "<svg '/>", '<svg </>',
      '<svg //>', '<svg / />', '<svg a=b />', '<svg a="b"c="d"/>', '<svg a=b c/>', '<svg a b/>', '<svg a="b"\t/>', '<math/>', '<SVG/>',
      '<svg>', '<svg / >', '<svg /\t>', '<svg /\n>', '<svg /\f>', '<svg / x>', '<svg /x>', '<svg a=b/>', '<svg a= b/>', '<svg a= />', '<svg a=/>', '<svg a="b"/ >',
      '<svg a="/">', "<svg a='/'>", '<svg a=>', '<svg =>', '<svg a="b" / >', '<svg / / x>', '<math / >', '<svg a=b/ >', "<svg a='b'x/ >",
    ];
    const texts = tags.map((tag) => `${tag}<g>`);
    const made = await oracle(texts);
    texts.forEach((text, i) => {
      const verdict = prescanMockup(text);
      expect(verdict.ok, text).toBe(true);
      expect(verdict.depth - 1, `${JSON.stringify(tags[i])}: Chromium kept ${made[i]!.rootChildren} children`).toBe(made[i]!.rootChildren);
    });
  });
});

const CHAIN = '<li><dd>'.repeat(5);
const storm = (m: number, r: number): string => `<div>${Array.from({ length: m }, (_, k) => `<b id=${k}>`).join('')}</div>${'<p>x'.repeat(r)}`;
const staleStorm = (unit: (k: number) => string): string => `<div>${Array.from({ length: 100 }, (_, k) => unit(k)).join('')}</div>${'<p>x</p>'.repeat(1000)}`;

describe('M5.B8 (v6a): the fifth review\'s shapes, in real Chromium: refused, and parsed only if admitted', { timeout: 180_000 }, () => {
  it.each([
    ['<svg></p><![CDATA[>', '', 'too-many-formatting'],
    ['<math></br><![CDATA[>', '', 'too-many-formatting'],
    ['<svg><font color=x><![CDATA[>', '', 'too-many-formatting'],
    ['<template><col><xmp></template>', '</xmp>', 'foreign-markup'],
    ['<template><col><plaintext></template>', '', 'foreign-markup'],
  ])('%s + S(100, 1000)', async (head, tail, why) => {
    await refusedRow(`v6-${head}`, `${head}${storm(100, 1000)}${tail}${head.includes('CDATA') ? ']]>' : ''}`, why);
  });

  it.each([
    ['p', (k: number) => `<b id=${k}><p><p></p>${CHAIN}</p></b>`],
    ['h1', (k: number) => `<b id=${k}><h1><h2></h2>${CHAIN}</h1></b>`],
    ['button', (k: number) => `<b id=${k}><button><button></button>${CHAIN}</button></b>`],
    ['form', (k: number) => `<b id=${k}>${'<form><table></form></table></form>'.repeat(9)}</b>`],
    ['tr', (k: number) => `<b id=${k}><tr>${CHAIN}</tr></b>`],
    ['td', (k: number) => `<b id=${k}><td>${CHAIN}</td></b>`],
    ['caption', (k: number) => `<b id=${k}><caption>${CHAIN}</caption></b>`],
  ])('a stale %s (an implicit close, a null form pointer, or a start tag the parser ignores), 100 copies and 1000 paragraphs', async (name, unit) => {
    await refusedRow(`v6-stale-${name}`, staleStorm(unit), 'too-deep');
  });
});

describe('M5.B8 (v7a): the sixth review\'s cycles, in real Chromium: refused, and parsed only if admitted', { timeout: 180_000 }, () => {
  it.each([
    ['svg stale, <br> exit', (k: number) => `<b id=${k}><svg><g></svg>${'<section>'.repeat(8)}<br></b>`],
    ['svg stale, </p> exit', (k: number) => `<b id=${k}><svg><g></svg>${'<section>'.repeat(8)}</p></b>`],
    ['svg path/ stale, font color exit', (k: number) => `<b id=${k}><svg><path/></svg>${'<article>'.repeat(8)}<font color=r></font></b>`],
    ['math stale, span exit', (k: number) => `<b id=${k}><math><mrow></math>${'<nav>'.repeat(8)}<span></span></b>`],
    ['a instead of b', (k: number) => `<a id=${k}><svg><g></svg>${'<aside>'.repeat(8)}<br></a>`],
  ])('%s: 100 copies and 1000 paragraphs', async (name, unit) => {
    await refusedRow(`v7-${name}`, `<div>${Array.from({ length: 100 }, (_, k) => unit(k)).join('')}</div>${'<p>x</p>'.repeat(1000)}`, 'too-deep');
  });
});

describe('M5.B8 (v7c): the pre-scan\'s foreign state agrees with Chromium\'s', { timeout: 180_000 }, () => {
  const XHTML = 'http://www.w3.org/1999/xhtml';
  interface Made { b: number; svgChildren: number; descNs: string | null; foNs: string | null }
  async function oracle(texts: readonly string[]): Promise<Made[]> {
    const page = await (await browser.newContext()).newPage();
    try {
      await page.goto('about:blank');
      return await page.evaluate((all) => all.map((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const first = (name: string): Element | null => [...doc.getElementsByTagName('*')].find((e) => e.localName.toLowerCase() === name) ?? null;
        return {
          b: doc.getElementsByTagName('b').length,
          svgChildren: doc.querySelector('svg, math')?.children.length ?? -1,
          descNs: first('desc')?.namespaceURI ?? null,
          foNs: first('foreignobject')?.namespaceURI ?? null,
        };
      }), [...texts]);
    } finally {
      await page.context().close();
    }
  }

  it('every HTML element name: Chromium breaks out of svg on exactly the names the scan breaks out on (a name the scan holds foreign but Chromium breaks out on would desync it)', async () => {
    const HTML_NAMES = ('a abbr acronym address applet area article aside audio b base basefont bdi bdo bgsound big blockquote body br button canvas caption center cite '
      + 'code col colgroup data datalist dd del details dfn dialog dir div dl dt em embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head '
      + 'header hgroup hr html i iframe image img input ins isindex kbd keygen label legend li link listing main map mark marquee menu menuitem meta meter nav nobr '
      + 'noembed noframes noscript object ol optgroup option output p param picture plaintext pre progress q rb rp rt rtc ruby s samp script search section select '
      + 'slot small source span strike strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track tt u ul var video wbr xmp').split(' ');
    const texts = HTML_NAMES.map((name) => `<svg><${name}></svg>`);
    const made = await oracle(texts);
    HTML_NAMES.forEach((name, i) => {
      const verdict = prescanMockup(texts[i]!);
      // The scan broke out when its stack never held the element above the svg: depth 1. A refusal or depth 2 is a foreign child.
      const scanBreaksOut = verdict.ok && verdict.depth === 1;
      const chromiumBreaksOut = made[i]!.svgChildren === 0;
      expect(scanBreaksOut, `<svg><${name}>: Chromium kept ${made[i]!.svgChildren} children in the svg`).toBe(chromiumBreaksOut);
    });
  });

  it('pages after which the parser is back in HTML are clean for the scan, and pages that leave foreign content open refuse the next start tag: the namespace Chromium gives <desc> decides', async () => {
    const tail = '<desc><span></desc>';
    const clean = [
      '<svg></svg>', '<svg><path/><use/></svg>', '<svg><g><path/></svg>', '<svg><g><g></g></g></svg>', '<svg><defs><symbol id=a><path/></symbol></defs></svg>',
      '<svg><title>T</title><g/></svg>', '<svg><style>.a{}</style></svg>', '<svg><g></p>', '<svg></br>', '<svg><g><div>', '<svg><g><span></span>', '<svg><font color=x>',
      '<math><mrow></math>', '<math><mrow></br>', '<svg><svg><path/></svg></svg>', '<svg/>', '<math/>', '<div><svg><g></g></svg></div>', '<b><svg></svg></b>',
      '<svg><a href="#x"><path/></a></svg>', '<svg><text>x</text></svg>', '<svg><g/><g/></svg>', '<svg><g><svg/></g></svg>',
    ];
    const open = ['<svg>', '<svg><g>', '<svg><g><path/>', '<math>', '<math><mrow>', '<svg><svg>', '<svg><font>', '<svg><g><g>'];
    const pages = [...clean, ...open];
    const made = await oracle(pages.map((p) => `${p}${tail}`));
    pages.forEach((page, i) => {
      const pv = prescanMockup(page);
      expect(pv.ok, `${page} is a page the scan follows`).toBe(true);
      const tv = prescanMockup(`${page}${tail}`);
      const htmlAfter = made[i]!.descNs === XHTML;
      expect(tv.ok, `${page}: Chromium made desc in ${made[i]!.descNs}`).toBe(htmlAfter);
      expect(htmlAfter, page).toBe(clean.includes(page));
    });
  });

  it('font breaks out of foreign content only with color, face or size: the scan reads the next start tag as HTML exactly then', async () => {
    const attrs = ['', 'color=x', 'COLOR=x', 'face=x', 'size=1', 'a=b color', 'color', "a='x' size='1'", '\tcolor=x', 'style=x', 'colorx=1', 'xcolor=1', 'a="color=1"', 'a=color', 'data-size=1'];
    const pages = attrs.map((a) => `<svg><font ${a}><foreignObject><span></foreignObject>`);
    const made = await oracle(pages);
    pages.forEach((page, i) => {
      const htmlFo = made[i]!.foNs === XHTML;
      expect(prescanMockup(page).ok, `${JSON.stringify(attrs[i])}: Chromium made foreignObject in ${made[i]!.foNs}`).toBe(htmlFo);
    });
  });

  it('CDATA after the parser has left foreign content is a bogus comment: the b counts agree; with foreign content open the scan refuses', async () => {
    const texts = [
      '<svg></p><![CDATA[><b data-i=1>]]>', '<math></br><![CDATA[><b data-i=1>]]>', '<svg><font color=x><![CDATA[><b data-i=1>]]>', '<svg><font face=x><![CDATA[><b data-i=1>]]>',
      '<![CDATA[><b data-i=1>]]>', '<div><![CDATA[><b data-i=1>]]></div>', '<svg><g></p><![CDATA[><b data-i=1>]]>', '<svg><font size=1><![CDATA[x><b data-i=1>]]>',
      '<svg></svg><![CDATA[><b data-i=1>]]>', '<svg><g><div><![CDATA[><b data-i=1>]]>',
    ];
    const made = await oracle(texts);
    texts.forEach((text, i) => {
      const verdict = prescanMockup(text);
      expect(verdict.ok, text).toBe(true);
      // A font start tag is a formatting name here, so it counts one beside the b elements the parser made.
      expect(verdict.formatting - (text.includes('<font') ? 1 : 0), `${JSON.stringify(text)}: Chromium made ${made[i]!.b} b`).toBe(made[i]!.b);
    });
    for (const refused of ['<svg><![CDATA[><b data-i=1>]]>', '<svg><font><![CDATA[><b data-i=1>]]>', '<math><![CDATA[x]]>', '<svg><g><![CDATA[x]]>']) {
      expect(prescanMockup(refused), refused).toMatchObject({ ok: false, why: 'foreign-markup' });
    }
  });
});

describe('M5.B8 (d): the control, E13\'s 660 KiB of nested divs', { timeout: 180_000 }, () => {
  it('parsed DIRECTLY it exceeds 1000 ms (the timer can see the hazard), and the pre-scan refuses it too-deep', async () => {
    const text = e13Text();
    expect(Buffer.byteLength(text, 'utf8')).toBeGreaterThanOrEqual(660 * 1024);
    expect(prescanMockup(text)).toMatchObject({ ok: false, why: 'too-deep' });
    const got = await timeParse('d-control E13 660KiB', text, 1);
    if (MEASURE) report('d-control', 'E13 660KiB nested div', got);
    expect(got.times[0], `the control parsed in ${got.times.map(ms).join(', ')} ms`).toBeGreaterThan(PARSE_BUDGET_MS);
  });
});
