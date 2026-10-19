// Hover, pressed and the selected row (D-5101, skins Task 9).
//
// THREE CLAIMS, each a mechanism rather than a comment:
//   1. every interactive primitive carries a hover AND a pressed state, read off
//      the class string that ships (rows, doors, the back chevron, keycaps, and
//      the ghost and quiet buttons);
//   2. no hover is written where a coarse pointer can trip it: a stylesheet
//      `:hover` lives inside `@media (hover: hover)`, and a primitive's hover is
//      Tailwind's `hover:` variant, which v4 gates on that same query;
//   3. the selected fleet row is the accent tint plus a rail, never the
//      reverse-video slab it replaced.
//
// The colour half — that every ink drawn on the tint, the hover and the pressed
// ground clears its floor in every palette — is the gate's
// (design/contrast-check.mjs); this file pins that the gate STATES those
// grounds with the inks Step 0 measured on them.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  BACK_BUTTON, BARE_ROW, DOOR, KEYCAP, LIST_ROW, buttonVariants,
} from '@ccrc/ui';
import { cn } from '../../ui/src/lib/cn';
import { atBlock, declValue, ruleIn, stripComments } from './cssRule';

const ROOT = path.join(import.meta.dirname, '..', '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

/** A utility present as a whole class, optionally behind `enabled:` — a
 *  disabled control neither lifts nor sinks, which is the stricter spelling. */
const has = (cls: string, utility: string): boolean =>
  new RegExp(`(^|\\s)(enabled:)?${utility.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(cls);

describe('every interactive primitive carries a hover and a pressed state', () => {
  // Rows and buttons lift to a GROUND under the mouse and sink to a deeper one
  // while held. Both grounds are opaque palette derivations (tokens.css).
  const grounded: Record<string, string> = {
    ListRow: LIST_ROW,
    BareRow: BARE_ROW,
    'Button ghost': buttonVariants({ variant: 'ghost' }),
    'Button quiet': buttonVariants({ variant: 'quiet', size: 'fit' }),
    // `ghost`'s twin on the dead hue (D-5099) takes its lift and its press
    // too (D-5495): it was the one hairline button that did neither.
    'Button danger-ghost': buttonVariants({ variant: 'danger-ghost', size: 'fit' }),
  };
  it.each(Object.entries(grounded))('%s lifts to --bg-hover and sinks to --bg-pressed', (_name, cls) => {
    expect(has(cls, 'hover:bg-hover'), `${_name}: no hover ground`).toBe(true);
    expect(has(cls, 'active:bg-pressed'), `${_name}: no pressed ground`).toBe(true);
  });

  // A disabled hairline button stands down (D-5448): its lift and press are
  // gated on `enabled:`, so a disabled one neither lifts nor sinks (D-5495).
  const hairline: Record<string, string> = {
    'Button ghost': buttonVariants({ variant: 'ghost' }),
    'Button danger-ghost': buttonVariants({ variant: 'danger-ghost', size: 'fit' }),
  };
  it.each(Object.entries(hairline))('%s gates its lift and press on enabled:', (_name, cls) => {
    expect(cls, `${_name}: a disabled one lifts`).toMatch(/(^|\s)enabled:hover:bg-hover(\s|$)/);
    expect(cls, `${_name}: a disabled one sinks`).toMatch(/(^|\s)enabled:active:bg-pressed(\s|$)/);
    expect(cls, `${_name}: an ungated lift`).not.toMatch(/(^|\s)(hover:bg-hover|active:bg-pressed)(\s|$)/);
  });

  // A door, the back chevron and a keycap are INK on chrome, not a ground: they
  // brighten to the primary ink under the mouse and keep the press they had.
  const inked: Record<string, [string, RegExp]> = {
    Door: [DOOR, /(^|\s)active:scale-\[0\.88\](\s|$)/],
    BackButton: [BACK_BUTTON, /(^|\s)active:scale-\[0\.88\](\s|$)/],
    Keycap: [KEYCAP, /(^|\s)enabled:active:translate-y-px(\s|$)/],
  };
  it.each(Object.entries(inked))('%s brightens to the primary ink and keeps its press', (_name, [cls, press]) => {
    expect(has(cls, 'hover:text-ink-primary'), `${_name}: no hover ink`).toBe(true);
    expect(cls, `${_name}: lost its press`).toMatch(press);
  });

  it('the terminal\'s Reconnect holds the well on hover (D-5454)', () => {
    // A ghost on the terminal's well: the card-mixed hover ground would sit
    // under --ink-on-well at 1.17:1 in Phosphor Daylight. The call site's
    // `enabled:hover:bg-transparent` must REPLACE the variant's hover through
    // the merge, not sit beside it and lose the cascade.
    const drawer = read('pwa/src/session/TerminalDrawer.tsx');
    const at = drawer.match(/variant="ghost" className="(term-retry[^"]*)"/);
    expect(at, 'the Reconnect button').not.toBeNull();
    const merged = cn(buttonVariants({ variant: 'ghost' }), at![1]);
    expect(has(merged, 'hover:bg-transparent')).toBe(true);
    expect(has(merged, 'hover:bg-hover')).toBe(false);
  });

  // D-5462 (Task 14b): KEYCAP's hover is a utility, and an UNLAYERED app rule
  // beats every layered rule whatever its specificity. The header's rule sat
  // unlayered on the primary ink, so the lift was dead twice over: outranked,
  // and onto the ink it already wore. The secondary rest is scoped to a
  // pointer that can hover: on touch the hover never fires, so the cap keeps
  // the primary ink it always had (Refined stays pixel-identical on a phone).
  it("the header's keycaps rest below the hover ink only where hover exists, in a layer the hover outranks (D-5462)", () => {
    const chat = read('pwa/src/session/chat.css');
    const layered = atBlock(chat, '@layer components');
    const rest = declValue(ruleIn(layered, '.chat-head .keycap'), 'color');
    expect(rest, 'without hover the header cap keeps the primary ink').toBe('var(--ink-primary)');
    const hover = atBlock(layered, '@media (hover: hover)');
    expect(declValue(ruleIn(hover, '.chat-head .keycap'), 'color'),
      'under a hovering pointer the cap rests on the secondary ink, one tier under the lift')
      .toBe('var(--ink-secondary)');
    expect(has(KEYCAP, 'hover:text-ink-primary')).toBe(true);
  });

  it('no unlayered rule in chat.css re-declares the header keycap colour (D-5462)', () => {
    // Structural, not one spelling: `.chat-head > .keycap`, a grouped list or
    // a compound selector outranks the hover just as `.chat-head .keycap`
    // would. Only the stand-down (`:disabled`) may stay unlayered, because the
    // hover is `enabled:`-gated and nothing contests it there.
    const chat = stripComments(read('pwa/src/session/chat.css'));
    const unlayered = chat.replace(stripComments(atBlock(chat, '@layer components')), '');
    const offenders: string[] = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    for (let m = re.exec(unlayered); m !== null; m = re.exec(unlayered)) {
      const body = m[2] ?? '';
      if (!/(^|[;\s])color\s*:/.test(body)) continue;
      for (const sel of (m[1] ?? '').split(',')) {
        if (/\.chat-head\b/.test(sel) && /\.keycap\b/.test(sel) && !/:disabled\b/.test(sel)) {
          offenders.push(sel.trim());
        }
      }
    }
    expect(offenders, 'an unlayered header keycap colour outranks the hover again').toEqual([]);
  });

  it('the terminal keys hold the well ink under the mouse (D-5462)', () => {
    // On the well the primitive's primary ink is dark glass on dark glass in
    // the light theme. Unlayered, `.term-keys .keycap` outranks the hover, so
    // the cap keeps --ink-on-well; layering it would let the hover through.
    const chat = read('pwa/src/session/chat.css');
    expect(declValue(ruleIn(chat, '.term-keys .keycap'), 'color')).toBe('var(--ink-on-well)');
    expect(atBlock(chat, '@layer components'), 'the terminal cap moved into the layer')
      .not.toMatch(/\.term-keys \.keycap\s*\{/);
  });

  it('the theme bridge maps both grounds, so the utilities resolve to the tokens', () => {
    const theme = read('ui/src/styles/theme.css');
    expect(theme).toMatch(/--color-hover:\s*var\(--bg-hover\);/);
    expect(theme).toMatch(/--color-pressed:\s*var\(--bg-pressed\);/);
  });

  it('both grounds are declared once in :root, opaque mixes of the ink over the card', () => {
    const tokens = read('ui/src/styles/tokens.css');
    const root = ruleIn(tokens, ':root');
    const squash = (v: string | null): string => (v ?? '').replace(/\s+/g, '');
    expect(squash(declValue(root, '--bg-hover')))
      .toBe(squash('color-mix(in srgb, var(--ink-primary) 5%, var(--bg-surface))'));
    expect(squash(declValue(root, '--bg-pressed')))
      .toBe(squash('color-mix(in srgb, var(--ink-primary) 9%, var(--bg-surface))'));
    // Declared once: the hand-tuned light block re-declares the INPUTS, so
    // var() resolves both per theme, and a second hand copy would drift.
    expect(ruleIn(tokens, "[data-theme='light']")).not.toMatch(/--bg-(hover|pressed)\s*:/);
  });
});

// ── the hover fades at the skin's --dur-fast (Task 9 Step 4) ─────────────────

/** The background half of a two-property `[transition:…]` shorthand at the
 *  skin's fast duration: 180ms in Refined, 120ms in Instrument (skins.css). */
const FADES_GROUND = /(^|\s)\[transition:[^\s\]]*background-color_var\(--dur-fast\)[^\s\]]*\](\s|$)/;
/** Any OTHER transition utility. Beside the shorthand it would race it in the
 *  cascade, and `cn` cannot dedupe the custom `duration-press`. */
const RIVAL_TRANSITION = /(^|\s)(transition-(transform|colors|all|\[)|transition(?=\s|$)|duration-)/;

describe('a lifted ground fades in at --dur-fast, the per-skin duration', () => {
  const grounded: Record<string, string> = {
    ListRow: LIST_ROW,
    BareRow: BARE_ROW,
    'Button ghost': buttonVariants({ variant: 'ghost' }),
    'Button quiet': buttonVariants({ variant: 'quiet', size: 'fit' }),
    // `ghost`'s twin on the dead hue (D-5099) takes its lift and its press
    // too (D-5495): it was the one hairline button that did neither.
    'Button danger-ghost': buttonVariants({ variant: 'danger-ghost', size: 'fit' }),
  };
  it.each(Object.entries(grounded))('%s transitions background-color at var(--dur-fast), and nothing races it', (_name, cls) => {
    expect(cls, `${_name}: the hover ground snaps`).toMatch(FADES_GROUND);
    expect(cls, `${_name}: a second transition utility races the shorthand`).not.toMatch(RIVAL_TRANSITION);
    expect(has(cls, 'motion-reduce:transition-none'), `${_name}: ignores reduced motion`).toBe(true);
  });

  it('the fleet row fades its hover ground at var(--dur-fast), and reduced motion stills it', () => {
    const fleetCss = read('pwa/src/fleet/fleet.css');
    const squash = (v: string | null): string => (v ?? '').replace(/\s+/g, '');
    expect(squash(declValue(ruleIn(fleetCss, '.sess-line'), 'transition')))
      .toBe('background-colorvar(--dur-fast)var(--curve-swift)');
    // motion-reduced.test.ts holds the block's position; this holds the name.
    expect(stripComments(fleetCss)).toMatch(/prefers-reduced-motion:\s*reduce\)\s*\{[^@]*\.sess-line\s*\{\s*transition:\s*none;/);
  });

  it('the duration differs by skin: 180ms in Refined, 120ms in Instrument', () => {
    expect(declValue(ruleIn(read('ui/src/styles/tokens.css'), ':root'), '--dur-fast')).toBe('180ms');
    expect(read('ui/src/styles/skins.css'))
      .toMatch(/:root\[data-skin='instrument'\]\s*\{[^}]*--dur-fast:\s*120ms;/);
  });

  it('an anchor wearing the ghost lifts and sinks without enabled:, which never matches an <a>', () => {
    const sheet = read('pwa/src/session/PrSheet.tsx');
    const at = sheet.match(/<a className=\{([^}]*\}\)[^}]*)\}/);
    expect(at, 'the Open on GitHub anchor').not.toBeNull();
    const expr = at![1]!;
    expect(expr).toMatch(/buttonVariants\(\{ variant: 'ghost' \}\)/);
    expect(expr).toMatch(/(^|['\s])hover:bg-hover(\s|')/);
    expect(expr).toMatch(/(^|['\s])active:bg-pressed(\s|')/);
  });
});

// ── no sticky hover ──────────────────────────────────────────────────────────

/** Every rule whose selector names `:hover`, with whether an enclosing block is
 *  `@media (hover: hover)`. A small brace walker over the comment-stripped
 *  sheet: preludes are pushed on `{` and popped on `}`. */
function hoverRules(src: string): { selector: string; guarded: boolean }[] {
  const css = stripComments(src);
  const out: { selector: string; guarded: boolean }[] = [];
  const stack: string[] = [];
  let buf = '';
  for (const ch of css) {
    if (ch === '{') {
      const prelude = buf.trim().replace(/\s+/g, ' ');
      if (!prelude.startsWith('@') && /:hover\b/.test(prelude)) {
        out.push({ selector: prelude, guarded: stack.some((p) => /^@media\b[^{]*\(\s*hover\s*:\s*hover\s*\)/.test(p)) });
      }
      stack.push(prelude);
      buf = '';
    } else if (ch === '}') {
      stack.pop();
      buf = '';
    } else if (ch === ';') {
      buf = '';
    } else {
      buf += ch;
    }
  }
  return out;
}

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...cssFiles(rel));
    else if (e.name.endsWith('.css')) out.push(rel);
  }
  return out;
}

/** The hovers that predate D-5101 and sit outside the guard, as they stand on
 *  this task's base. Each is an INK or underline change on a desktop
 *  affordance, never a ground, so a hover stuck on a phone after a tap leaves
 *  the control in its accent ink rather than a lifted fill. Registered so the
 *  scan can hold every OTHER rule, and so this list can only shrink: a stale
 *  entry reds below, exactly like the contrast census. */
const GRANDFATHERED_UNGUARDED = new Set([
  'pwa/src/session/chat.css: .compaction-head:hover .compaction-hint',
  'pwa/src/session/chat.css: .dlg-reply-send:not(:disabled):hover',
  'pwa/src/session/chat.css: .dlg-details-toggle:hover',
  'pwa/src/session/chat.css: .slash-item:hover, .slash-item:focus-visible',
  'ui/src/components/prose.css: .msg-assist a:hover',
  'ui/src/components/prose.css: .code-block-copy:hover, .code-block-copy[data-copied]',
  'ui/src/components/task-card.css: .task-card-toggle:hover',
]);

describe('no hover is written outside Tailwind\'s hover: variant or a (hover: hover) block', () => {
  const found = [...cssFiles('pwa/src'), ...cssFiles('ui/src')]
    .flatMap((f) => hoverRules(read(f)).map((r) => ({ ...r, key: `${f}: ${r.selector}` })));

  it('the scan sees the guarded fleet row, so an empty result is a finding', () => {
    expect(found.find((r) => r.selector.startsWith('.sess-line') && r.guarded), 'the fleet row hover').toBeDefined();
  });

  it('every stylesheet :hover sits inside @media (hover: hover), or is registered', () => {
    const unguarded = found.filter((r) => !r.guarded).map((r) => r.key);
    expect(unguarded.filter((k) => !GRANDFATHERED_UNGUARDED.has(k))).toEqual([]);
  });

  it('no registered hover is stale', () => {
    const unguarded = new Set(found.filter((r) => !r.guarded).map((r) => r.key));
    expect([...GRANDFATHERED_UNGUARDED].filter((k) => !unguarded.has(k))).toEqual([]);
  });
});

// ── the selected row ─────────────────────────────────────────────────────────

const fleet = read('pwa/src/fleet/fleet.css');

describe('the selected row is tint plus rail, not reverse video', () => {
  it('paints the accent tint with a 2px accent rail, and never the ink as a ground', () => {
    const rule = ruleIn(fleet, '.sess-line--active');
    expect(declValue(rule, 'background')).toBe('var(--accent-tint)');
    expect(declValue(rule, 'box-shadow')).toBe('inset 2px 0 0 var(--accent)');
    expect(rule).not.toMatch(/background:\s*var\(--ink-primary\)/);
    // The ink is no longer flipped: the label keeps the card's ink.
    expect(declValue(rule, 'color')).toBeNull();
  });

  it("a folded card's name says it holds the selection in the row's own idiom, not an inverted chip (D-5495)", () => {
    // The fold hides the selected row, so the card name stands in for it. It
    // was the retired slab at chip scale; it now wears the row's tint and rail.
    // Both also carry a forced-colours outline; this is about the normal-colour
    // rules, so read them with that block taken out.
    const normal = fleet.replace(atBlock(fleet, '@media (forced-colors: active)'), '');
    const chip = ruleIn(normal, '.proj-card[data-holds-selection] .proj-card-name');
    const row = ruleIn(normal, '.sess-line--active');
    expect(declValue(chip, 'background')).toBe(declValue(row, 'background'));
    expect(declValue(chip, 'box-shadow')).toBe(declValue(row, 'box-shadow'));
    expect(chip).not.toMatch(/var\(--ink-primary\)|var\(--bg-page\)/);
    expect(declValue(chip, 'color')).toBeNull();
    // The rail is 2px inside the chip's left edge, so the name starts past it.
    expect(declValue(chip, 'padding')).toMatch(/^0 var\(--sp-1\)\s*0 calc\(var\(--sp-1\)\s*\+\s*2px\)$/);
  });

  it('keeps the label semibold, the non-colour channel', () => {
    expect(declValue(ruleIn(fleet, '.sess-line--active .sess-label'), 'font-weight'))
      .toBe('var(--weight-semibold)');
  });

  it('lifts an unselected row under the mouse, inside (hover: hover) only', () => {
    const rows = hoverRules(fleet).filter((r) => r.selector.includes('.sess-line'));
    expect(rows.map((r) => r.selector)).toEqual(['.sess-line:not(.sess-line--active):hover']);
    expect(rows.every((r) => r.guarded)).toBe(true);
    // D-5455: the selected row keeps its tint under the mouse.
    expect(fleet).toMatch(/\.sess-line:not\(\.sess-line--active\):hover\s*\{\s*background:\s*var\(--bg-hover\);/);
  });
});

// ── the gate states each new ground with the inks drawn on it ────────────────

const gate = read('pwa/design/contrast-check.mjs');
/** A `const NAME = [...]` list of token names in the gate's source. */
function gateList(name: string): string[] {
  const m = gate.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  expect(m, `${name} is not declared in contrast-check.mjs`).not.toBeNull();
  return [...(m![1] ?? '').matchAll(/'(--[a-z0-9-]+)'/g)].map((x) => x[1]!);
}

describe('the gate measures each new ground with exactly the inks drawn on it', () => {
  const NEUTRAL = ['--ink-primary', '--ink-secondary', '--ink-tertiary'];
  const STATUS_TEXT = ['busy', 'attention', 'dead', 'done', 'cleanup'].map((s) => `--status-${s}-text`);
  const LANES = ['cyan', 'violet', 'blue', 'magenta', 'amber', 'green'].map((k) => `--acct-${k}`);

  it('the tint carries the neutral inks, every status text and every lane hue, and the dots at 3:1', () => {
    expect(gateList('SELECTED_ROW_INKS').sort()).toEqual([...NEUTRAL, ...STATUS_TEXT, ...LANES].sort());
    expect(gateList('SELECTED_ROW_DOTS').sort()).toEqual(
      ['busy', 'idle', 'attention', 'dead', 'done', 'cleanup'].map((s) => `--status-${s}`).sort());
  });

  it('hover carries the same inks, because a hovered fleet row keeps its meta', () => {
    expect(gateList('HOVER_INKS').sort()).toEqual([...NEUTRAL, ...STATUS_TEXT, ...LANES].sort());
  });

  it('pressed carries the neutral inks and the danger menu label, and nothing else (D-5454)', () => {
    expect(gateList('PRESSED_INKS').sort()).toEqual([...NEUTRAL, '--status-dead-text'].sort());
  });

  it("the danger-ghost's hairline is gated on the grounds it lifts and sinks to (D-5495)", () => {
    // Its label, --status-dead-text, is already in HOVER_INKS and PRESSED_INKS;
    // the hairline is a non-text boundary, so it gets its own 3:1 pairs.
    expect(gate).toMatch(/danger hairline \/ hover \(UI 3:1\)`, T\.dead, T\.hover, 3\]/);
    expect(gate).toMatch(/danger hairline \/ pressed \(UI 3:1\)`, T\.dead, T\.pressed, 3\]/);
  });

  it('the slab pair is retired with the slab', () => {
    expect(gate).not.toMatch(/selected-row meta ink \/ slab/);
  });
});
