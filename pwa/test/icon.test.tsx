// The Icon primitive and the colour-emoji census (D-5100, skins plan Task 8).
//
// Three things are pinned here, each because a regression in it is silent:
//
// 1. THE SHAPE. `Icon` is decoration. It is `aria-hidden` and never focusable
//    (an SVG is focusable by default in some engines), and it is stroked in
//    `currentColor`, so it follows the control's ink in every palette and both
//    skins. A skin owns no colour (spec §3.2); neither does an icon.
// 2. THE VENDORED NODES. `ui/src/icons/lucide.ts` is data turned into elements
//    by `createElement`. No markup string reaches the DOM, so the only way in
//    for anything unsafe is an attr. The tags are a closed set and the attrs are
//    geometric. A `style`, `href`, `class` or `on*` attr reds.
// 3. THE CENSUS. A colour emoji is drawn by the platform's emoji font: its own
//    colours, its own size, a different picture on every OS. So none ships in
//    `pwa/src` or `ui/src`, outside comments, stories and tests. Each remaining
//    exception is registered with the characters it may hold and the reason it
//    waits, and the registry is checked both ways: a listed file that no longer
//    holds them is stale.
//
// MUTATIONS (run on a copy, red/green recorded in the PR body):
//   | aria-hidden removed from Icon                    | the shape case     |
//   | glyph="🔑" restored at an unregistered call site | the census         |
//   | a registry entry for a file with no emoji        | the census, stale  |
//   | a node carrying `style`                          | the closed-set case|
//   | U+FE0E dropped from WARN_GLYPH                   | the text-glyph case|
//   | R2a: `shield` dropped from NAMES, regenerated    | the Settings index |
//   | R2a: `stroke-width` hand-added to `shield`       | the closed-set case|
//   | R2a: a `<g>` wrapper added to `bot`              | the closed-set case|
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import ts from 'typescript';
import { Icon, MAIL_GLYPH, SETTINGS_GLYPH, WARN_GLYPH } from '@ccrc/ui';
import { ICONS, LUCIDE_VERSION } from '../../ui/src/icons/lucide';

const ROOT = path.join(import.meta.dirname, '..', '..');

describe('Icon', () => {
  it('Icon renders an aria-hidden, non-focusable svg stroked in currentColor at 16, 20 and 24', () => {
    const widths: Record<number, string> = { 16: '1.75', 20: '1.75', 24: '1.5' };
    for (const size of [16, 20, 24] as const) {
      const { container, unmount } = render(<Icon name="bell" size={size} />);
      const svg = container.querySelector('svg');
      expect(svg, `size ${size}`).not.toBeNull();
      expect(svg!.getAttribute('aria-hidden')).toBe('true');
      expect(svg!.getAttribute('focusable')).toBe('false');
      expect(svg!.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg!.getAttribute('width')).toBe(String(size));
      expect(svg!.getAttribute('height')).toBe(String(size));
      expect(svg!.getAttribute('fill')).toBe('none');
      expect(svg!.getAttribute('stroke')).toBe('currentColor');
      expect(svg!.getAttribute('stroke-width')).toBe(widths[size]);
      expect(svg!.getAttribute('stroke-linecap')).toBe('round');
      expect(svg!.getAttribute('stroke-linejoin')).toBe('round');
      expect(svg!.children.length, 'drawn from the nodes').toBe(ICONS.bell.length);
      unmount();
    }
    // The default is 16.
    const { container } = render(<Icon name="mail" />);
    expect(container.querySelector('svg')!.getAttribute('width')).toBe('16');
  });

  it('every icon node\'s tag is in the closed set and every attr is geometric', () => {
    const TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
    const ATTRS = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points']);
    const names = Object.keys(ICONS);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const nodes = ICONS[name as keyof typeof ICONS];
      expect(nodes.length, name).toBeGreaterThan(0);
      for (const [tag, attrs] of nodes) {
        expect(TAGS.has(tag), `${name}: <${tag}>`).toBe(true);
        for (const [k, v] of Object.entries(attrs)) {
          expect(ATTRS.has(k), `${name}: <${tag} ${k}>`).toBe(true);
          expect(typeof v === 'string' || typeof v === 'number', `${name}: ${k}`).toBe(true);
        }
      }
    }
    // This task's names (Task 10 and later tasks add their own).
    for (const n of ['bell', 'bell-off', 'key-round', 'settings', 'mail', 'hand', 'file-text']) {
      expect(names, n).toContain(n);
    }
  });

  // Settings redesign Task R2a (spec §3.2): the section index draws one icon
  // per section and a chevron on each row. Each is vendored, and each draws.
  it('the Settings index icons are vendored', () => {
    const GEOMETRIC = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
    for (const name of ['bot', 'chevron-right', 'palette', 'refresh-cw', 'shield'] as const) {
      // Named first, so a missing icon reds with its name, not a TypeError inside Icon.
      expect(Object.keys(ICONS), name).toContain(name);
      const { container, unmount } = render(<Icon name={name} size={20} />);
      const svg = container.querySelector('svg');
      expect(svg, name).not.toBeNull();
      const drawn = [...svg!.children].filter((c) => GEOMETRIC.has(c.tagName.toLowerCase()));
      expect(drawn.length, `${name} draws at least one geometric child`).toBeGreaterThan(0);
      unmount();
    }
  });

  it('the vendored set ships its licence and names its lucide version', () => {
    const licence = readFileSync(path.join(ROOT, 'ui/src/icons/LICENSE.lucide'), 'utf8');
    expect(licence).toMatch(/^ISC License/);
    expect(licence).toMatch(/Lucide Icons and Contributors/);
    expect(LUCIDE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    const src = readFileSync(path.join(ROOT, 'ui/src/icons/lucide.ts'), 'utf8');
    expect(src).toContain(`lucide-static ${LUCIDE_VERSION}`);
    expect(src).toContain('make-icons.mjs');
  });
});

describe('the text glyph constants', () => {
  it('the three text glyph constants carry U+FE0E', () => {
    for (const [name, g] of Object.entries({ MAIL_GLYPH, WARN_GLYPH, SETTINGS_GLYPH })) {
      expect([...g].length, name).toBe(2);
      expect(g.endsWith('︎'), `${name} asks for text presentation`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// THE CENSUS.
// ---------------------------------------------------------------------------

/** A file allowed to hold colour emoji until its owner lands, the exact
 *  characters it may hold, and why it waits. Keyed per character so a NEW emoji
 *  in a registered file still reds. */
const REGISTERED: Record<string, { chars: string; why: string }> = {
  'pwa/src/session/SessionHeader.tsx': { chars: '🤖', why: '#402 holds the file' },
  'ui/src/components/tool-card.tsx': { chars: '❓', why: 'the ask sheet half' },
  // D-5452: #402 now also edits FleetHead.tsx (the Docs door), so the Account
  // door's swap waits for it. 📄 is NOT listed: it reds here, and is swapped
  // for `Icon file-text` (plan Task 8, "#402's 📄").
  'pwa/src/fleet/FleetHead.tsx': { chars: '🔑', why: '#402 holds the file (D-5452)' },
};

/** A colour emoji: emoji presentation by default (not asked back to text with
 *  U+FE0E), or any pictograph asked for emoji with U+FE0F. */
function colourEmoji(text: string): string[] {
  const out: string[] = [];
  const chars = [...text];
  chars.forEach((c, i) => {
    const next = chars[i + 1];
    if (/\p{Emoji_Presentation}/u.test(c) && next !== '︎') out.push(c);
    else if (/\p{Extended_Pictographic}/u.test(c) && next === '️') out.push(c);
  });
  return out;
}

/** The text a file can put on screen: every string, template and JSX text
 *  node of a .ts/.tsx (comments are trivia, never nodes), or a stylesheet with
 *  its comments removed. */
function drawnText(file: string, src: string): string {
  if (file.endsWith('.css')) return src.replace(/\/\*[\s\S]*?\*\//g, '');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const parts: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)
      || n.kind === ts.SyntaxKind.TemplateHead || n.kind === ts.SyntaxKind.TemplateMiddle || n.kind === ts.SyntaxKind.TemplateTail) {
      parts.push((n as ts.LiteralLikeNode).text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return parts.join('\n');
}

function censusFiles(): string[] {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'pwa/src', 'ui/src'], { cwd: ROOT })
    .toString().split('\n').filter(Boolean);
  return listed.filter((f) => /\.(tsx?|css)$/.test(f) && !/\.stories\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
}

describe('the colour-emoji census', () => {
  it("the colour-emoji census: no emoji-presentation character in pwa/src or ui/src outside comments, stories and tests, except the registry", () => {
    const found: Record<string, Set<string>> = {};
    for (const f of censusFiles()) {
      const hits = colourEmoji(drawnText(f, readFileSync(path.join(ROOT, f), 'utf8')));
      if (hits.length > 0) found[f] = new Set(hits);
    }
    const unregistered = Object.entries(found).flatMap(([f, set]) => {
      const allowed = new Set([...(REGISTERED[f]?.chars ?? '')]);
      return [...set].filter((c) => !allowed.has(c)).map((c) => `${f}: ${c}`);
    });
    expect(unregistered, 'a colour emoji: draw it with Icon, or ask for text with U+FE0E').toEqual([]);
    const stale = Object.entries(REGISTERED).flatMap(([f, { chars }]) =>
      [...chars].filter((c) => !found[f]?.has(c)).map((c) => `${f}: ${c}`));
    expect(stale, 'a registry entry whose file no longer holds it is stale: remove it').toEqual([]);
  });

  it('the census sees what it must and skips what it must', () => {
    expect(colourEmoji('🔑')).toEqual(['🔑']);
    expect(colourEmoji('⚠')).toEqual([]);
    expect(colourEmoji('⚠️')).toEqual(['⚠']);
    expect(colourEmoji('✋︎')).toEqual([]);
    expect(drawnText('a.tsx', "// 🔑\n/* 🔔 */\nconst a = '✋';\nexport const b = <i>🔕</i>;")).not.toMatch(/🔑|🔔/u);
    expect(colourEmoji(drawnText('a.tsx', "const a = '✋';\nexport const b = <i>🔕</i>;"))).toEqual(['✋', '🔕']);
    expect(colourEmoji(drawnText('a.css', '/* 🔑 */ .a { content: "🔔"; }'))).toEqual(['🔔']);
  });
});
