// The desk width's stylesheet contract (spec 2026-11-06 §2.1, D-8059), read as text: vitest runs with no CSS, so this
// is the scrape `cssRule.ts` argues for. Chrome's half, what these rules lay out, is `browser/chat-width.browser.test.ts`.
//
// RED FIRST, and what each case catches:
//   the column's cap left at 780, or the prose role missing from :root ........ "the top-level :root declares …"
//   the ≥1600 block's `--measure-chat: 820px` put back ........................... "no width block re-declares --measure-chat"
//   Instrument's log column left at 860, or its prose role missing ............. "Instrument declares …"
//   the role dropped from the skin catalogue ..................................... "SKIN_TOKENS.density names …"
//   the chat prose rule deleted, or its selector list drifting from prose.css's . "at ≥900, .chat-item .msg-assist's prose …"
//   the measure resolved per element again (no registered length) ................ "the chat measure is resolved once …"
//   the user bubble left at 85%, or at 70% with no prose cap (fix round 1, F2) .... "at ≥900, .msg-user and .msg-attach …"
//   the attachments left at 85% beside a capped bubble (F9) ...................... "at ≥900, .msg-user and .msg-attach …"
//   the shared measure, or the Docs reader's, re-pointed at the chat role ........ "prose.css's measure rule still reads …"
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SKIN_TOKENS } from '@ccrc/ui';
import { declValue, norm, rootBody, ruleIn, stripComments } from './cssRule';

const ROOT = path.join(import.meta.dirname, '..', '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const TOKENS = read('ui/src/styles/tokens.css');
const SKINS = read('ui/src/styles/skins.css');
const PROSE = read('ui/src/components/prose.css');
const CHAT = read('pwa/src/session/chat.css');
const DOCS = read('pwa/src/docs/docs.css');
const INSTRUMENT = ":root[data-skin='instrument']";
/** The registered length the chat's prose children read (fix round 1, F3), set on `.msg-assist` from the token. */
const CAP = '--chat-prose-cap';

/** The body of every TOP-LEVEL block whose prelude starts `@media`, with its prelude, in source order. Comments are
 *  stripped first, so a brace in prose cannot unbalance the walk. */
function mediaBlocks(text: string): { prelude: string; body: string }[] {
  const scan = stripComments(text);
  const out: { prelude: string; body: string }[] = [];
  let depth = 0;
  let from = 0;
  let open = -1;
  for (let i = 0; i < scan.length; i += 1) {
    const c = scan[i];
    if (c === '{') {
      if (depth === 0) open = i;
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        const prelude = norm(scan.slice(from, open));
        if (prelude.startsWith('@media')) out.push({ prelude, body: scan.slice(open + 1, i) });
        from = i + 1;
      }
    } else if (c === ';' && depth === 0) {
      from = i + 1;
    }
  }
  return out;
}

/** Every innermost rule in `text`, its prelude normalised whole. `cssRule.ts`'s readers split a selector list at every
 *  comma, which would cut `:is(p, ul, …)` apart; the rules read here are compared by their exact prelude instead. */
function rules(text: string): { prelude: string; body: string }[] {
  return [...stripComments(text).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ prelude: norm(m[1] ?? ''), body: m[2] ?? '' }));
}
const listed = (prelude: string, sel: string): boolean => prelude.split(/,(?![^(]*\))/).map((x) => x.trim()).includes(sel);

const DESK = '@media(min-width: 900px)';
const MEASURE_RULE = /^\.msg-assist > :is\((.*)\)$/;
/** The `:is(…)` list of prose.css's READING MEASURE rule, the one rule there that reads `var(--measure-prose)`. */
function proseMeasureList(): string[] {
  const measure = rules(PROSE).filter((r) => declValue(r.body, 'max-width') === 'var(--measure-prose)');
  expect(measure.map((r) => r.prelude), 'prose.css has one measure rule, on .msg-assist\'s prose children').toHaveLength(1);
  const m = MEASURE_RULE.exec(measure[0]!.prelude);
  expect(m, `the measure rule's selector: ${measure[0]!.prelude}`).not.toBeNull();
  return m![1]!.split(',');
}

describe('the column and the chat prose measure, as tokens (D-8059)', () => {
  it('the top-level :root declares --measure-chat 1200px and --measure-chat-prose 90ch', () => {
    const root = rootBody(TOKENS);
    expect(declValue(root, '--measure-chat')).toBe('1200px');
    expect(declValue(root, '--measure-chat-prose')).toBe('90ch');
    // The shared measure stays: the Docs reader and the phone read it.
    expect(declValue(root, '--measure-prose')).toBe('72ch');
  });

  it('no width block re-declares --measure-chat', () => {
    const blocks = [...mediaBlocks(TOKENS), ...mediaBlocks(SKINS)];
    expect(blocks.length, 'premise: the walk sees the width blocks').toBeGreaterThan(2);
    expect(blocks.some((b) => b.prelude.includes('1600px')), 'premise: the ≥1600 block is seen').toBe(true);
    const redeclared = blocks.filter((b) => /--measure-chat\s*:/.test(b.body)).map((b) => b.prelude);
    expect(redeclared).toEqual([]);
  });

  it('Instrument declares --measure-chat 100% and --measure-chat-prose 100ch', () => {
    const body = ruleIn(SKINS, INSTRUMENT);
    expect(declValue(body, '--measure-chat')).toBe('100%');
    expect(declValue(body, '--measure-chat-prose')).toBe('100ch');
  });

  it('SKIN_TOKENS.density names --measure-chat-prose', () => {
    expect(SKIN_TOKENS.density.map((t) => t.name)).toContain('--measure-chat-prose');
    expect(SKIN_TOKENS.density.map((t) => t.name)).toContain('--measure-chat');
  });
});

describe('the chat\'s rules at a desk (D-8059)', () => {
  it('at ≥900, .chat-item .msg-assist\'s prose children read max-width: var(--chat-prose-cap)', () => {
    const list = proseMeasureList();
    expect(list, 'premise: the measure list read from prose.css').toEqual(['p', 'ul', 'ol', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'hr', '.callout']);
    const want = norm(`.chat-item .msg-assist > :is(${list.join(', ')})`);
    const desk = mediaBlocks(CHAT).filter((b) => b.prelude === DESK);
    const hits = desk.flatMap((b) => rules(b.body)).filter((r) => r.prelude === want).map((r) => declValue(r.body, 'max-width'));
    expect(hits).toEqual([`var(${CAP})`]);
    // Nowhere else: below 900 the shared measure holds (spec §2: nothing changes on a phone).
    const everywhere = rules(CHAT).filter((r) => r.prelude === want);
    expect(everywhere, 'the chat prose rule is written once, inside the ≥900 block').toHaveLength(1);
  });

  it('the chat measure is resolved once, on .msg-assist, as a registered length whose source is --measure-chat-prose', () => {
    // Fix round 1, F3: `ch` resolves in each element's own font, so a heading capped in `ch` ran past the paragraphs.
    // A registered <length> computes to px where it is set, on `.msg-assist`, and its children inherit that one length.
    const registered = rules(CHAT).filter((r) => r.prelude === `@property ${CAP}`);
    expect(registered, `one @property ${CAP}`).toHaveLength(1);
    expect(declValue(registered[0]!.body, 'syntax')).toBe("'<length>'");
    expect(declValue(registered[0]!.body, 'inherits')).toBe('true');
    const desk = mediaBlocks(CHAT).filter((b) => b.prelude === DESK);
    const set = desk.flatMap((b) => rules(b.body)).filter((r) => r.prelude === '.chat-item .msg-assist').map((r) => declValue(r.body, CAP));
    expect(set).toEqual(['var(--measure-chat-prose)']);
    // Set nowhere else, so below 900 nothing reads it.
    expect(rules(CHAT).filter((r) => declValue(r.body, CAP) !== null)).toHaveLength(1);
  });

  it('at ≥900, .msg-user and .msg-attach read max-width: min(70%, var(--measure-chat-prose))', () => {
    const desk = mediaBlocks(CHAT).filter((b) => b.prelude === DESK);
    for (const sel of ['.msg-user', '.msg-attach']) {
      const values = desk.flatMap((b) => rules(b.body)).filter((r) => listed(r.prelude, sel))
        .map((r) => declValue(r.body, 'max-width')).filter((v) => v !== null);
      expect(values, sel).toEqual(['min(70%,var(--measure-chat-prose))']);
    }
  });

  it('prose.css\'s measure rule still reads var(--measure-prose), and docs.css\'s .doc-body still reads var(--measure-prose)', () => {
    proseMeasureList(); // throws unless prose.css has its one measure rule, on var(--measure-prose)
    expect(declValue(ruleIn(DOCS, '.doc-body'), 'max-width')).toBe('var(--measure-prose)');
    expect(stripComments(PROSE)).not.toMatch(/--measure-chat/);
    expect(stripComments(DOCS)).not.toMatch(/--measure-chat/);
  });
});
