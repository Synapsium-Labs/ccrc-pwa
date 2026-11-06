// Colour in the assistant's prose (chat reading Task C, D-8061; spec 2026-11-06 §3.1). The assistant's prose takes hue
// in four places only: action lead-ins and the markers of the list after one in amber, other lead-ins in the NOTE blue,
// status labels on the callouts' own pairs, and names as links (`.msg-assist a`, no new rule). `remarkChatMarks` (Task
// M, D-8060) writes the attributes; these rules colour them, under T4a's scope (D-7234), so the Docs reader and an opened
// recap keep today's ink. This file reads the stylesheet's text; `chat-colour.browser.test.ts` measures what Chrome draws
// and `design/contrast-check.mjs` gates every pair in all twelve palettes.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { atBlock, declValue, stripComments } from './cssRule';
import { MARK_ATTR, type StatusTone } from '../src/lib/chatMarks';

const read = (...seg: string[]): string =>
  readFileSync(path.join(import.meta.dirname, '..', '..', ...seg), 'utf8');

const prose = read('ui', 'src', 'components', 'prose.css');
const docsCss = read('pwa', 'src', 'docs', 'docs.css');

/** T4a's scope (D-7234): assistant prose that is neither a Docs page nor an opened recap. */
const SCOPE = '.msg-assist:not(.doc-body):not(.compaction-body)';

/** One selector, normalised: whitespace collapsed, none just inside a paren or after a comma within one, and
 *  attribute values unquoted. `cssRule.ts`'s `normSel` also drops the space AFTER a `)`, which is a descendant
 *  combinator here (`…) strong`), so it would read the scope and its subject as one compound. */
function normSel(sel: string): string {
  return sel.trim().replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s*,\s*/g, ',')
    .replace(/=(['"])(.*?)\1\]/g, '=$2]');
}

/** A selector list split at its top-level commas only: `:is(ul, ol)` is one selector's part, not two selectors.
 *  `cssRule.ts`'s readers split at every comma, which a rule using `:is(…)` defeats. */
function splitSelectors(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of prelude) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => normSel(s)).filter((s) => s !== '');
}

/** Every innermost rule of `css`, comments stripped, in source order, with its offset in the stripped text. */
function rulesOf(css: string): { selectors: string[]; body: string; at: number }[] {
  const out: { selectors: string[]; body: string; at: number }[] = [];
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const prelude = (m[1] ?? '').trim();
    if (prelude === '' || prelude.startsWith('@')) continue;
    out.push({ selectors: splitSelectors(prelude), body: m[2] ?? '', at: m.index ?? 0 });
  }
  return out;
}

/** The one rule whose selector list holds `sel`; throws when none does, so a renamed rule is a failure. */
function ruleFor(css: string, sel: string): { selectors: string[]; body: string; at: number } {
  const want = normSel(sel);
  const found = rulesOf(css).filter((r) => r.selectors.includes(want));
  if (found.length !== 1) throw new Error(`${found.length} rules for ${sel}`);
  return found[0]!;
}

const LEAD = (kind: 'action' | 'info'): string => `${SCOPE} strong[${MARK_ATTR.lead}='${kind}']`;
const MARKER = `${SCOPE} :is(ul, ol)[${MARK_ATTR.afterLead}='action'] > li::marker`;
const LABEL = `${SCOPE} [${MARK_ATTR.status}]`;
const TONE = (tone: StatusTone): string => `${SCOPE} [${MARK_ATTR.status}='${tone}']`;

/** Spec §3.1's status table: each tone's text and ground, pairs the callouts already use. A `Record` over
 *  `StatusTone`, so a fifth tone in `chatMarks.ts` is a compile error here until it has a row. */
const TONES: Readonly<Record<StatusTone, { color: string; background: string }>> = {
  ok: { color: '--status-busy-text', background: '--accent-tint' },
  merged: { color: '--pr-merged', background: '--acct-violet-tint' },
  wait: { color: '--status-attention-text', background: '--status-attention-tint' },
  fail: { color: '--status-dead-text', background: '--status-dead-tint-solid' },
};

/** The attributes the colour rules select on. */
const COLOUR_ATTRS = [MARK_ATTR.lead, MARK_ATTR.afterLead, MARK_ATTR.status];

describe('colour in the assistant\'s prose (D-8061)', () => {
  it('each lead-in rule reads its token', () => {
    expect(declValue(ruleFor(prose, LEAD('action')).body, 'color')).toBe('var(--status-attention-text)');
    expect(declValue(ruleFor(prose, LEAD('info')).body, 'color')).toBe('var(--acct-blue)');
  });

  it('the action list\'s marker reads --status-attention-text', () => {
    expect(declValue(ruleFor(prose, MARKER).body, 'color')).toBe('var(--status-attention-text)');
  });

  it('a status word is drawn as a small label', () => {
    const body = ruleFor(prose, LABEL).body;
    expect(declValue(body, 'border-radius')).toBe('var(--r-sm)');
    expect(declValue(body, 'padding-inline')).toBe('var(--sp-1)');
    expect(declValue(body, 'font-weight')).toBe('var(--weight-medium)');
    // The label's shape owns no colour: the tone rules below do.
    expect(declValue(body, 'color')).toBeNull();
    expect(declValue(body, 'background')).toBeNull();
  });

  describe('each tone rule sets the spec\'s colour and ground', () => {
    for (const [tone, pair] of Object.entries(TONES) as [StatusTone, { color: string; background: string }][]) {
      it(`${tone}: ${pair.color} on ${pair.background}`, () => {
        const body = ruleFor(prose, TONE(tone)).body;
        expect(declValue(body, 'color')).toBe(`var(${pair.color})`);
        expect(declValue(body, 'background')).toBe(`var(${pair.background})`);
      });
    }
  });

  it('every new rule\'s selector starts with the T4a scope', () => {
    const scope = `${normSel(SCOPE)} `;
    for (const sel of [LEAD('action'), LEAD('info'), MARKER, LABEL, ...Object.keys(TONES).map((t) => TONE(t as StatusTone))]) {
      for (const member of ruleFor(prose, sel).selectors) expect(member.startsWith(scope), member).toBe(true);
    }
  });

  it('no rule in prose.css names data-lead, data-after-lead or data-status without it', () => {
    const scope = `${normSel(SCOPE)} `;
    const naming = rulesOf(prose).flatMap((r) => r.selectors).filter((s) => COLOUR_ATTRS.some((a) => s.includes(`[${a}`)));
    // Not vacuous: the eight rules above all name one.
    expect(naming.length).toBeGreaterThanOrEqual(8);
    for (const member of naming) expect(member.startsWith(scope), member).toBe(true);
  });

  it('the rules sit inside @layer components, after the T4a chip rule', () => {
    const layer = atBlock(prose, '@layer components');
    const t4a = ruleFor(layer, `${SCOPE} .md-code`).at;
    for (const sel of [LEAD('action'), LEAD('info'), MARKER, LABEL, TONE('fail')]) {
      expect(ruleFor(layer, sel).at, sel).toBeGreaterThan(t4a);
    }
  });

  it('docs.css names none of the attributes', () => {
    const text = stripComments(docsCss);
    for (const attr of Object.values(MARK_ATTR)) expect(text, attr).not.toContain(attr);
  });
});
