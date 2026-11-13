// THE CHARACTERS' ART IS GENERATED DATA, AND EVERY RULE OF THAT IS A ROW HERE.
//
// `ui/design/make-characters.mjs` reads the brand brief's 28 SVGs and writes `ui/src/characters/art.ts` (shape and
// tone, never a colour) and `characters.css` (each tone reads its token). This file pins what the generator makes
// (the committed files are its output), what it refuses (ten rows, each fed one bad SVG), and what the art must
// keep for the design system to hold: tones that read tokens, every tone measured against the page on every
// palette, stepped animation, reduced motion that stills every loop, and a still frame that is the mood's own rest.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ART } from '../../ui/src/characters/art';
import type { ArtNode } from '../../ui/src/characters/art';
import { CHARACTERS, MOODS } from '../../shared/face';
import { compileAll, crop, parseArt, stillGrid } from '../../ui/design/make-characters.mjs';
import { colourLiteralsIn, parseCss } from './sourceScan';

const REPO = path.join(import.meta.dirname, '..', '..');
const SVG_DIR = path.join(REPO, 'docs', 'design', 'overlord', 'svg');
const CSS_FILE = path.join(REPO, 'ui', 'src', 'characters', 'characters.css');
const svg = (name: string): string => readFileSync(path.join(SVG_DIR, `${name}.svg`), 'utf8');
const css = (): string => readFileSync(CSS_FILE, 'utf8');

const allNodes = (nodes: readonly ArtNode[]): ArtNode[] =>
  nodes.flatMap((n) => [n, ...allNodes(n.kids ?? [])]);
const everyNode = (): ArtNode[] =>
  CHARACTERS.flatMap((c) => MOODS.flatMap((m) => allNodes(ART[c][m].nodes)));

/** The tone -> token table of the plan, as it must read in `characters.css`. */
const TONE_TOKENS: Record<string, string> = {
  ground: '--bg-page', body: '--accent', ink: '--ink-primary', crown: '--status-attention',
  alarm: '--status-dead', 'off-body': '--ink-tertiary', 'off-detail': '--ink-secondary', tear: '--acct-blue',
};

describe('the characters\' art', () => {
  it('every character has every mood, and nothing else', () => {
    expect(Object.keys(ART)).toEqual([...CHARACTERS]);
    for (const c of CHARACTERS) expect(Object.keys(ART[c]), c).toEqual([...MOODS]);
  });

  it('the committed files are what the generator makes', () => {
    const r = spawnSync('node', ['../ui/design/make-characters.mjs', '--check'], { encoding: 'utf8' });
    expect(r.error, 'could not run the generator').toBeUndefined();
    expect(r.status, `run \`npm run characters\` in ui/: ${r.stdout}${r.stderr}`).toBe(0);
  });

  it('no colour literal in a face declaration or field', () => {
    const decls = parseCss(css()).decls;
    expect(decls.length).toBeGreaterThan(100);
    for (const d of decls) expect(colourLiteralsIn(d.value), `${d.chain.join(' ')} { ${d.prop} }`).toEqual([]);
    const nodes = everyNode();
    expect(nodes.length).toBeGreaterThan(100);
    for (const n of nodes) {
      const fields = [n.tone, n.cls, n.d, n.x, n.y, n.w, n.h, n.alpha, ...(n.at ?? [])];
      for (const f of fields) expect(colourLiteralsIn(String(f ?? '')), JSON.stringify(n).slice(0, 80)).toEqual([]);
    }
  });

  it('each tone reads the token the table names', () => {
    const pairs: Record<string, string> = {};
    for (const d of parseCss(css()).decls) {
      const sel = d.chain[d.chain.length - 1] ?? '';
      const m = sel.match(/^\.chr-t-([\w-]+)$/);
      if (m && d.prop === 'fill') pairs[m[1] as string] = d.value.replace(/^var\((.*)\)$/, '$1');
    }
    expect(pairs).toEqual(TONE_TOKENS);
  });

  it('each tone has its contrast row, or is exempt by name', () => {
    // `pairs` is not exported and the gate's output never prints a ground, so this reads the gate's source: the row
    // whose label is the named one must stand on the page, at the table's floor, for the tone's own token.
    const source = readFileSync(path.join(import.meta.dirname, '..', 'design', 'contrast-check.mjs'), 'utf8');
    const rows = [...source.matchAll(/\[`\$\{name\} (.+?)`, (T\.\w+), (T\.\w+), ([\d.]+)\]/g)]
      .map((m) => ({ label: m[1] as string, fg: m[2], ground: m[3], floor: Number(m[4]) }));
    expect(rows.length).toBeGreaterThan(20);
    const EXEMPT: Record<string, string> = { ground: 'the page itself' };
    const TABLE: Record<string, { label: string; fg: string; floor: number }> = {
      body: { label: 'accent focus ring / page (UI 3:1)', fg: 'T.accent', floor: 3 },
      ink: { label: 'ink-primary / page', fg: 'T.inkP', floor: 4.5 },
      crown: { label: 'attention dot / page (UI 3:1)', fg: 'T.att', floor: 3 },
      alarm: { label: 'dead dot / page (UI 3:1)', fg: 'T.dead', floor: 3 },
      'off-body': { label: 'ink-tertiary / page', fg: 'T.inkT', floor: 4.5 },
      'off-detail': { label: 'ink-secondary / page', fg: 'T.inkS', floor: 4.5 },
      tear: { label: 'acct-blue / page', fg: 'T.blue', floor: 4.5 },
    };
    // Every tone the art uses is in one of the two tables: a new tone with neither goes red.
    const tones = new Set(everyNode().map((n) => n.tone).filter((t): t is NonNullable<typeof t> => !!t));
    expect([...tones].sort()).toEqual(Object.keys(TONE_TOKENS).sort());
    for (const t of tones) {
      if (t in EXEMPT) continue;
      const want = TABLE[t];
      expect(want, `tone ${t} has neither a contrast row nor an exemption`).toBeDefined();
      const row = rows.find((r) => r.label === want?.label);
      expect(row, `no row "${want?.label}" in contrast-check.mjs`).toBeDefined();
      expect(row?.ground, want?.label).toBe('T.page');
      expect(row?.fg, want?.label).toBe(want?.fg);
      expect(row?.floor, want?.label).toBe(want?.floor);
    }
  });

  it('every animation is stepped', () => {
    const animations = parseCss(css()).decls.filter((d) => d.prop === 'animation' && d.value !== 'none');
    expect(animations.length).toBeGreaterThan(20);
    for (const d of animations) expect(d.value, d.chain.join(' ')).toContain('steps(');
  });

  it('every animated selector is stilled under reduced motion', () => {
    const decls = parseCss(css()).decls;
    const animated = decls
      .filter((d) => d.prop === 'animation' && d.value !== 'none' && d.chain.length === 1)
      .map((d) => d.chain[0] as string);
    const stilled = new Set(decls
      .filter((d) => d.prop === 'animation' && d.value === 'none' && d.chain[0]?.startsWith('@media (prefers-reduced-motion'))
      .flatMap((d) => (d.chain[d.chain.length - 1] ?? '').split(',').map((s) => s.trim())));
    expect(animated).toContain('.chr-peeklook');
    for (const s of animated) expect(stilled.has(s), `${s} is not stilled under reduced motion`).toBe(true);
  });

  it('the art stays on the grid', () => {
    for (const n of everyNode()) {
      if (n.d !== undefined) expect(n.d).toMatch(/^(M\d+ \d+h\d+v\d+h-\d+z)+$/);
      for (const v of [n.x, n.y, n.w, n.h, ...(n.at ?? [])]) {
        if (v !== undefined) expect(Number.isInteger(v), JSON.stringify(n).slice(0, 80)).toBe(true);
      }
    }
  });

  it('the shading keeps its three drawn strengths', () => {
    const seen = new Set<number>();
    for (const n of everyNode()) {
      if (n.alpha === undefined) continue;
      expect(n.tone).toBe('ground');
      seen.add(n.alpha);
    }
    expect([...seen].sort()).toEqual([0.22, 0.3, 0.35]);
  });

  it('each label is the drawn aria-label', () => {
    const drawn = svg('orb-sleeping').match(/aria-label="([^"]*)"/)?.[1];
    expect(drawn).toBeTruthy();
    expect(ART.orb.sleeping.label).toBe(drawn);
  });

  it('the eye is shared', () => {
    // The almond's top row: the `ink` cells of row 14 in the still grid. Rows 14 and 15 would be wrong: Happy and
    // Thinking put the ground pupil on row 15. No mood translates the almond (every translate moves the pupil only).
    const SHARED = ['afraid', 'alert', 'dizzy', 'happy', 'thinking'];
    const EXEMPT: Record<string, string> = {
      angry: 'a lowered lid: the almond starts at row 18',
      suspicious: 'a lowered lid: the almond starts at row 18',
      offline: 'the same shape, drawn in off-detail',
      sleeping: 'the almond is in the hidden peek group; the doze curve shows',
      sad: 'a body lid covers rows 14 to 17',
      crying: 'a body lid covers rows 14 to 17',
      confused: 'the lid covers row 14 and most of row 15',
      laughing: 'the eye is squeezed shut',
    };
    // A mood added to MOODS must be named in one list or the other.
    expect([...SHARED, ...Object.keys(EXEMPT), 'neutral'].sort()).toEqual([...MOODS].sort());
    const inkRow14 = (mood: string): number[] =>
      (crop(stillGrid(parseArt(svg(`orb-${mood}`))), 0, 14, 32, 1)[0] ?? [])
        .flatMap((c, x) => (c?.tone === 'ink' ? [x] : []));
    const eye = inkRow14('neutral');
    expect(eye.length).toBeGreaterThan(4);
    for (const mood of SHARED) expect(inkRow14(mood), mood).toEqual(eye);
  });
});

describe('the generator refuses what is outside the measured vocabulary', () => {
  const base = svg('orb-neutral');
  it('CONTROL: the base file parses', () => {
    expect(parseArt(base).nodes.length).toBeGreaterThan(2);
  });
  const bad: [string, string, RegExp][] = [
    ['a tag outside the set', base.replace('</svg>', '<circle></circle></svg>'), /refused tag/],
    ['an attribute outside a part\'s set', base.replace('<path ', '<path onclick="x" '), /refused attribute/],
    ['an attribute outside the root\'s set', base.replace('<svg ', '<svg preserveAspectRatio="none" '), /refused root attribute/],
    ['a colour outside the table', base.replace(/fill="#[0-9A-Fa-f]{6}"/, 'fill="#123456"'), /refused colour/],
    ['an alpha outside the three', base.replace('fill-opacity="0.3"', 'fill-opacity="0.5"'), /refused alpha/],
    ['a transform that is not a whole-cell translate', base.replace('<g class="md-look">', '<g class="md-look" transform="translate(0.5 0)">'), /refused transform/],
    ['a path that is not whole-cell rectangles', base.replace('d="M2 7h2v1h-2z', 'd="M2 7l2 1z'), /refused path/],
    ['a rect with a number that is not whole', base.replace('x="13"', 'x="0.5"'), /refused rect number/],
    ['an inline style outside the six', base.replace('<g class="md-look">', '<g class="md-look" style="animation-delay: -2s">'), /refused inline style/],
  ];
  it.each(bad)('refuses %s', (_name, text, word) => {
    expect(text).not.toBe(base);
    expect(() => parseArt(text)).toThrow(word);
  });
  it('refuses a drawn duration on a part that no animation paces', () => {
    // A duration is emitted as its part's shorthand (`.chr-<part>.chr-dur-<ms>`, D-5930's one-place retiming), so a
    // duration with no animated class beside it has nothing to pace, and the generator refuses it.
    const files = Object.fromEntries(readdirSync(SVG_DIR).filter((f) => f.endsWith('.svg')).map((f) => [f, svg(f.slice(0, -4))]));
    const bare = base.replace(/<path (fill="#[0-9A-Fa-f]{6}")/, '<path style="animation-duration: 6s" $1');
    expect(bare).not.toBe(base);
    expect(() => compileAll(files)).not.toThrow();
    expect(() => compileAll({ ...files, 'orb-neutral.svg': bare })).toThrow(/refused pace/);
  });
  it('refuses a class or keyframe name defined two ways across two files', () => {
    const other = base.replace('.md-hop{animation:md-up2 1.2s', '.md-hop{animation:md-up2 1.3s');
    expect(other).not.toBe(base);
    expect(() => compileAll({ 'orb-neutral.svg': base, 'orb-happy.svg': other })).toThrow(/defined two ways/);
  });
});
