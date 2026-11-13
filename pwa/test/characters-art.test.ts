// THE CHARACTERS' ART IS GENERATED DATA, AND EVERY RULE OF THAT IS A ROW HERE.
//
// `ui/design/make-characters.mjs` reads the brand brief's 28 SVGs and writes `ui/src/characters/art.ts` (shape and
// tone, never a colour) and `characters.css` (each tone reads its token). This file pins what the generator makes
// (the committed files are its output), what it refuses (each row fed one bad SVG), and what the art must
// keep for the design system to hold: tones that read tokens, every tone measured against the page on every
// palette, stepped animation, reduced motion that stills every loop, and a still frame that is the mood's own rest.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ART, CHARACTER_CLASSES } from '../../ui/src/characters/art';
import type { ArtNode } from '../../ui/src/characters/art';
import { CHARACTERS, MOODS, isCharacter, isMood } from '../../shared/face';
import { compileAll, crop, parseArt, restingStyles, stillGrid } from '../../ui/design/make-characters.mjs';
import { colourLiteralsIn, parseCss } from './sourceScan';

const REPO = path.join(import.meta.dirname, '..', '..');
const SVG_DIR = path.join(REPO, 'docs', 'design', 'overlord', 'svg');
const CSS_FILE = path.join(REPO, 'ui', 'src', 'characters', 'characters.css');
const svg = (name: string): string => readFileSync(path.join(SVG_DIR, `${name}.svg`), 'utf8');
const css = (): string => readFileSync(CSS_FILE, 'utf8');
const allSvgs = (): Record<string, string> =>
  Object.fromEntries(readdirSync(SVG_DIR).filter((f) => f.endsWith('.svg')).map((f) => [f, svg(f.slice(0, -4))]));

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
    const r = spawnSync('node', ['../ui/design/make-characters.mjs', '--check'], {
      encoding: 'utf8',
      cwd: path.join(import.meta.dirname, '..'),
    });
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
    // Comments are stripped first, so a row that is commented out is no row (`//` only ever starts a line here: the
    // labels carry single `/` characters, as in `dead dot / page`).
    const source = readFileSync(path.join(import.meta.dirname, '..', 'design', 'contrast-check.mjs'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
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
    for (const d of animations) {
      // Every entry of a comma list, split where no parenthesis is open (`steps(1, end)` keeps its comma).
      const entries = d.value.split(/,(?![^(]*\))/).map((e) => e.trim());
      for (const e of entries) expect(e, `${d.chain.join(' ')}: ${d.value}`).toContain('steps(');
    }
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

  it('every animated selector is also stilled by data-still, the bounded play\'s stillness', () => {
    // `Character`'s `play={false}` and the five-second play both set `data-still`; this is the only thing it stills.
    const decls = parseCss(css()).decls;
    const reduced = decls
      .filter((d) => d.prop === 'animation' && d.value === 'none' && d.chain[0]?.startsWith('@media (prefers-reduced-motion'))
      .flatMap((d) => (d.chain[d.chain.length - 1] ?? '').split(',').map((s) => s.trim()));
    expect(reduced.length).toBeGreaterThan(25);
    expect(reduced.filter((s) => s.includes('.chr-dur-'))).toHaveLength(3);
    const still = decls
      .filter((d) => d.prop === 'animation' && d.value === 'none' && d.chain.length === 1)
      .map((d) => d.chain[0] as string);
    for (const s of reduced) expect(still, `${s} has no data-still rule`).toContain(`.chr[data-still] ${s}`);
    expect(still.length, 'a data-still rule stills something the reduced block does not').toBe(reduced.length);
  });

  it('characters.css declares no filter and no box-shadow: a glow means life', () => {
    const props = parseCss(css()).decls.map((d) => d.prop);
    expect(props.length).toBeGreaterThan(100);
    expect(props.filter((p) => p === 'filter' || p === 'backdrop-filter' || p.includes('shadow'))).toEqual([]);
  });

  it('CHARACTER_CLASSES is every class characters.css selects, plus chr', () => {
    const selected = new Set<string>(['chr']);
    for (const d of parseCss(css()).decls) {
      for (const link of d.chain) {
        if (link.startsWith('@')) continue;
        for (const m of link.matchAll(/\.(chr[\w-]*)/g)) selected.add(m[1] as string);
      }
    }
    expect(selected.size).toBeGreaterThan(40);
    expect([...CHARACTER_CLASSES].sort()).toEqual([...selected].sort());
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

  it('each label is the drawn aria-label, all 28', () => {
    for (const c of CHARACTERS) {
      for (const m of MOODS) {
        const drawn = svg(`${c}-${m}`).match(/aria-label="([^"]*)"/)?.[1];
        expect(drawn, `${c}-${m}`).toBeTruthy();
        expect(ART[c][m].label, `${c}-${m}`).toBe(drawn);
      }
    }
  });

  it('isCharacter and isMood accept every member and refuse the rest', () => {
    for (const c of CHARACTERS) expect(isCharacter(c), c).toBe(true);
    for (const m of MOODS) expect(isMood(m), m).toBe(true);
    for (const v of ['Orb', 'orb ', 'orbs', 'dark_lord', '', 'neutral', 1, null, {}, ['orb'], undefined]) {
      expect(isCharacter(v), String(v)).toBe(false);
    }
    for (const v of ['Neutral', 'neutral ', 'neutrals', 'orb', '', 0, null, {}, ['neutral'], undefined]) {
      expect(isMood(v), String(v)).toBe(false);
    }
    // A member of the other list is not a member of this one.
    expect(isCharacter(MOODS[0])).toBe(false);
    expect(isMood(CHARACTERS[0])).toBe(false);
  });

  it('the resting pose reads each class\'s own translate, unitless axis or not', () => {
    // `.md-puzzle{transform:translate(2px,0)}` shifts Confused's pupil two cells, `.md-ponder1{…translate(1px,0)}`
    // shifts Thinking's crown eyes one: valid CSS, read as no shift when the reader wanted `px` on both axes.
    const ground = (g: ReturnType<typeof stillGrid>, y: number): number[] =>
      (g[y] ?? []).flatMap((c, x) => (c?.tone === 'ground' && c.alpha === null ? [x] : []));
    const neutral = stillGrid(parseArt(svg('orb-neutral')));
    const confused = stillGrid(parseArt(svg('orb-confused')));
    expect(ground(neutral, 19)).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
    expect(ground(confused, 16)).toEqual([16, 17, 18, 19]);
    expect(ground(confused, 18)).toEqual([14, 17, 18, 19, 20, 21]);
    expect(ground(confused, 19)).toEqual([14, 15, 16, 17, 18, 19, 20, 21]);
    expect(ground(confused, 20)).toEqual([14, 15, 16, 17, 18, 19, 20, 21]);
    const thinking = stillGrid(parseArt(svg('dark-lord-thinking')));
    for (const y of [13, 14, 15]) {
      const crown = (thinking[y] ?? []).flatMap((c, x) => (c?.tone === 'crown' ? [x] : []));
      expect(crown, `row ${y}`).toEqual([10, 11, 12, 13, 20, 21, 22, 23]);
    }
    const rest = restingStyles(allSvgs());
    expect(rest.get('chr-puzzle')?.at).toEqual([2, 0]);
    expect(rest.get('chr-ponder1')?.at).toEqual([1, 0]);
    expect(rest.get('chr-ponder')?.at).toEqual([3, -1]);
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

/** The shaded node's fill swapped for another tone's, its `fill-opacity` kept. */
function alphaOffGround(base: string): string {
  const shaded = base.match(/fill="(#[0-9A-Fa-f]{6})" fill-opacity="0.3"/)?.[1];
  const other = [...base.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]).find((c) => c !== shaded);
  return base.replace(`fill="${shaded}" fill-opacity="0.3"`, `fill="${other}" fill-opacity="0.3"`);
}

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
    ['a transform on a path', base.replace('<path ', '<path transform="translate(1 0)" '), /refused transform/],
    ['a transform on a rect', base.replace('<rect ', '<rect transform="translate(1 0)" '), /refused transform/],
    ['a class rule declaring a filter', base.replace('</style>', '.md-glow{filter:drop-shadow(0 0 2px currentColor)}</style>'), /refused property/],
    ['a class rule declaring a box-shadow', base.replace('</style>', '.md-glow{box-shadow:0 0 4px currentColor}</style>'), /refused property/],
    ['a class rule animated by longhands', base.replace('</style>', '.md-run{animation-name:md-up2;animation-duration:1s}</style>'), /refused property/],
    ['a keyframe step declaring a filter', base.replace('</style>', '@keyframes md-glowk{0%{filter:blur(1px)}}</style>'), /refused property/],
    ['an !important animation, which would beat the reduced-motion and data-still rules', base.replace('.md-hop{animation:md-up2 1.2s steps(1) infinite}', '.md-hop{animation:md-up2 1.2s steps(1) infinite !important}'), /refused important/],
    ['a keyframe step declaring !important', base.replace('</style>', '@keyframes md-imp{0%{opacity:0 !important}}</style>'), /refused important/],
    ['an eased entry after a stepped one in an animation list', base.replace('.md-hop{animation:md-up2 1.2s steps(1) infinite}', '.md-hop{animation:md-up2 1.2s steps(1) infinite, md-up2 1.2s ease-in-out infinite}'), /refused animation.*not stepped/],
    ['a nested block inside a class body', base.replace('</style>', '.md-nx{opacity:1;transform:hover, *{animation:md-up2 1s steps(1) infinite;transform:none}}</style>'), /refused nested block/],
    ['a nested block inside a keyframe step', base.replace('</style>', '@keyframes md-nk{0%{opacity:0;&{filter:blur(1px)}}}</style>'), /refused nested block/],
    ['a keyframe step prelude that swallowed a declaration', base.replace('</style>', '@keyframes md-k{filter:blur(1px);0%{opacity:0}}</style>'), /refused keyframe step/],
    ['an animation naming a keyframe the sheet does not define', base.replace('</style>', '.md-zz{animation:fade-in 1s steps(1)}</style>'), /refused animation.*fade-in/],
    ['an animation naming a keyframe in quotes', base.replace('</style>', '.md-zz{animation:"md-up2" 1s steps(1)}</style>'), /refused animation.*"md-up2".*not a number/],
    ['an animation naming a keyframe with an escape', base.replace('</style>', '.md-zz{animation:md\\-up2 1s steps(1)}</style>'), /refused animation.*not a number/],
    ['an animation reading its name from var()', base.replace('</style>', '.md-zz{animation:var(--k) 1s steps(1)}</style>'), /refused animation.*var\(/],
    ['an animation reading its time from var()', base.replace('</style>', '.md-zz{animation:md-up2 var(--t) steps(1)}</style>'), /refused animation.*var\(/],
    ['a timing function that only contains steps(', base.replace('</style>', '.md-zz{animation:md-up2 1s xsteps(1)}</style>'), /refused animation.*xsteps\(1\)/],
    ['a keyframe name that holds steps( and no timing', base.replace('</style>', '.md-zz{animation:md-up2 1s a-steps(1)}</style>'), /refused animation.*a-steps\(1\)/],
    ['a steps( with a count that is not an integer', base.replace('</style>', '.md-zz{animation:md-up2 1s steps(1.5)}</style>'), /refused animation.*steps\(1\.5\)/],
    ['an easing function beside a stepped one', base.replace('</style>', '.md-zz{animation:md-up2 1s steps(1) cubic-bezier(0,0,1,1)}</style>'), /refused animation.*cubic-bezier/],
    ['a style rule of two classes', base.replace('</style>', '.a .b{opacity:0}</style>'), /refused inline style/],
    ['a style rule on an element', base.replace('</style>', 'div{opacity:0}</style>'), /refused inline style/],
    ['a style rule on a pseudo-class', base.replace('</style>', '.a:hover{opacity:0}</style>'), /refused inline style/],
    ['an alpha on a tone that is not ground', alphaOffGround(base), /refused alpha.*outside/],
    ['a path that is not whole-cell rectangles', base.replace('d="M2 7h2v1h-2z', 'd="M2 7l2 1z'), /refused path/],
    ['a rect with a number that is not whole', base.replace('x="13"', 'x="0.5"'), /refused rect number/],
    ['an inline style outside the six', base.replace('<g class="md-look">', '<g class="md-look" style="animation-delay: -2s">'), /refused inline style/],
  ];
  it.each(bad)('refuses %s', (_name, text, word) => {
    expect(text).not.toBe(base);
    expect(() => parseArt(text)).toThrow(word);
  });
  it('accepts what the tightened check must still allow: a STEPS( in capitals, a jump term, a .5% stop', () => {
    const ok = base.replace('</style>', '.md-zz{animation:md-up2 .5s STEPS(2, Jump-End) 2 forwards}@keyframes md-fr{.5%{opacity:0}}</style>');
    expect(ok).not.toBe(base);
    expect(() => parseArt(ok)).not.toThrow();
  });
  it.each([['ui/design/make-characters.mjs'], ['pwa/design/icon-gen.mjs']])(
    '%s imports under a virtual argv[1] without throwing, and writes nothing',
    (rel) => {
      // `realpathSync` throws on a path that does not exist (`node -e`, a runner passing a virtual one).
      const url = new URL(`file://${path.join(REPO, rel)}`).href;
      const code = `process.argv[1] = '/nowhere/virtual-entry.mjs'; await import(${JSON.stringify(url)}); console.log('imported');`;
      const run = spawnSync('node', ['--input-type=module', '-e', code], { encoding: 'utf8' });
      expect(run.stderr).toBe('');
      expect(run.stdout.trim()).toBe('imported');
      expect(run.status).toBe(0);
    },
  );
  it('refuses a drawn duration on a part that no animation paces', () => {
    // A duration is emitted as its part's shorthand (`.chr-<part>.chr-dur-<ms>`, D-5930's one-place retiming), so a
    // duration with no animated class beside it has nothing to pace, and the generator refuses it.
    const files = allSvgs();
    const bare = base.replace(/<path (fill="#[0-9A-Fa-f]{6}")/, '<path style="animation-duration: 6s" $1');
    expect(bare).not.toBe(base);
    expect(() => compileAll(files)).not.toThrow();
    expect(() => compileAll({ ...files, 'orb-neutral.svg': bare })).toThrow(/refused pace/);
  });
  it('refuses a drawn duration on a part that also carries a drawn delay', () => {
    // The shorthand a duration is emitted as would reset the delay to 0, so the pair is refused.
    const files = allSvgs();
    const both = base.replace('<g class="md-look">', '<g class="md-look md-delay-500" style="animation-duration: 6s">');
    expect(both).not.toBe(base);
    expect(() => compileAll({ ...files, 'orb-neutral.svg': both })).toThrow(/refused pace.*no delay/);
  });
  it('refuses a file that is not <character>-<mood>.svg, whole, never a TypeError', () => {
    const files = allSvgs();
    for (const name of ['orb-bogus.svg', 'bogus-neutral.svg', 'bogus.svg', 'Orb-neutral.svg']) {
      expect(() => compileAll({ ...files, [name]: base }), name).toThrow(/refused file/);
    }
  });
  it('refuses a resting transform that is not a whole-cell translate', () => {
    const confused = svg('orb-confused');
    const rotated = confused.replace('.md-puzzle{transform:translate(2px,0)', '.md-puzzle{transform:rotate(5deg)');
    expect(rotated).not.toBe(confused);
    expect(() => restingStyles({ 'orb-confused.svg': confused })).not.toThrow();
    expect(() => restingStyles({ 'orb-confused.svg': rotated })).toThrow(/refused transform/);
  });
  it('accepts a comma inside steps() and a comma list of keyframe stops', () => {
    const ok = base.replace('</style>', '.md-ok{animation:md-up2 1s steps(1, end) infinite, md-up2 2s steps(2, start) infinite}@keyframes md-lst{0%,50%{opacity:0}to{opacity:1}}</style>');
    expect(ok).not.toBe(base);
    expect(() => parseArt(ok)).not.toThrow();
  });
  it('refuses a second transform or opacity in one class body, and an opacity that is not the literal 0 or 1', () => {
    const rest = (body: string): string => base.replace('</style>', `.md-rs{${body}}</style>`);
    expect(() => restingStyles({ 'orb-neutral.svg': rest('opacity:0') })).not.toThrow();
    expect(() => restingStyles({ 'orb-neutral.svg': rest('opacity:0;opacity:1') })).toThrow(/refused declaration/);
    expect(() => restingStyles({ 'orb-neutral.svg': rest('transform:translate(1px,0);transform:translate(2px,0)') })).toThrow(/refused declaration/);
    for (const v of ['.0', '0.0', '0%', '.5']) {
      expect(() => restingStyles({ 'orb-neutral.svg': rest(`opacity:${v}`) }), v).toThrow(/refused opacity/);
    }
  });
  it('refuses a class or keyframe name defined two ways across two files', () => {
    const other = base.replace('.md-hop{animation:md-up2 1.2s', '.md-hop{animation:md-up2 1.3s');
    expect(other).not.toBe(base);
    expect(() => compileAll({ 'orb-neutral.svg': base, 'orb-happy.svg': other })).toThrow(/defined two ways/);
  });
});
