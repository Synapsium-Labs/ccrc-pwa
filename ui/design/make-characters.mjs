// Character generator: the ONE place the Overlord's art becomes data.
//
// Run: node ui/design/make-characters.mjs --write   (writes art.ts and characters.css)
//      node ui/design/make-characters.mjs --check   (exit 1 when the committed files are not what this makes)
//      node ui/design/make-characters.mjs           (dry run, prints a report)
//
// WHY A GENERATOR. The brand brief (docs/design/briefs/2026-11-11-overlord-brand.md) draws 28 SVGs, two characters in
// fourteen moods, each carrying its own copy of one 59-name animation vocabulary and its colours as hex. The app
// cannot ship that: a hex in a shipped file is a second copy of a token, and 28 copies of one stylesheet is 28 chances
// for a name to mean two things. So the art is read ONCE, here, and written as typed data (`art.ts`, shape and tone,
// never a colour) and one stylesheet (`characters.css`, each tone reading its token).
//
// THE GENERATOR REFUSES RATHER THAN GUESSES. Anything outside the vocabulary measured in the plan (the tags, the
// attributes, the colours of the tone table, the three shading strengths, whole-cell translates, paths and rects, the
// six inline styles, a name defined two ways) throws, so a redrawn SVG that steps outside it is a red build and not a
// silently different face. Each refusal has its own message, and `pwa/test/characters-art.test.ts` feeds each one a
// bad file.
//
// THIS FILE TYPES THE DRAWN HEX. That is allowed here: it is a design-time tool and ships nowhere, and it sits outside
// `pwa/`, which is what `contrast.test.ts`'s hand-typed-copy sweep walks (`make-themes.mjs`'s seeds are typed hex the
// same way). Nothing it WRITES carries a hex.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SVG_DIR = path.join(HERE, '..', '..', 'docs', 'design', 'overlord', 'svg');
const FACE_TS = path.join(HERE, '..', '..', 'shared', 'face.ts');
const OUT_DIR = path.join(HERE, '..', 'src', 'characters');
const ART_TS = path.join(OUT_DIR, 'art.ts');
const CSS = path.join(OUT_DIR, 'characters.css');

// ── the vocabulary ──────────────────────────────────────────────────────────

/** The brief's colour table: drawn colour -> tone. Offline's greys step up one token each (`offline-greys-step-up`). */
const DRAWN_TONE = {
  '#0B0D0C': 'ground',
  '#45D67E': 'body',
  '#ECF0EC': 'ink',
  '#F2B84B': 'crown',
  '#E06A55': 'alarm',
  '#5C655D': 'off-body',
  '#8B948C': 'off-detail',
  '#ADB6AE': 'off-detail',
  '#2988FF': 'tear',
};
/** Tone -> token: the one table, in the order its rules are written. */
const TONE_TOKEN = {
  ground: '--bg-page',
  body: '--accent',
  ink: '--ink-primary',
  crown: '--status-attention',
  alarm: '--status-dead',
  'off-body': '--ink-tertiary',
  'off-detail': '--ink-secondary',
  tear: '--acct-blue',
};
const ALPHAS = ['0.22', '0.3', '0.35'];
const TAGS = new Set(['svg', 'style', 'g', 'path', 'rect']);
const ROOT_ATTRS = new Set(['xmlns', 'width', 'height', 'viewBox', 'shape-rendering', 'role', 'aria-label']);
const PART_ATTRS = {
  g: new Set(['class', 'transform', 'style']),
  path: new Set(['d', 'class', 'fill', 'fill-opacity', 'transform', 'style']),
  rect: new Set(['x', 'y', 'width', 'height', 'class', 'fill', 'fill-opacity', 'transform', 'style']),
};
/** The six inline styles the drawn art uses, each as a modifier class emitted after the rules. A delay is its own
 *  rule. A duration is NOT spelled as its longhand: the `animation-duration`/`animation-timing-function` longhand
 *  stays out of ui/src (D-5930, `server/test/single-definition/docs-l0.test.ts` refuses an `animation-duration:`
 *  literal anywhere else), and the drawn art's pace stays in each part's own shorthand, so each drawn duration is
 *  emitted as the paced part's own `animation` shorthand, on the compound selector `.chr-<part>.chr-dur-<ms>`, with
 *  only the duration changed (`pacedRules`). */
const STYLE_MODIFIERS = {
  'animation-delay: -0.5s': { cls: 'chr-delay-500', css: 'animation-delay:-0.5s' },
  'animation-delay: -0.6s': { cls: 'chr-delay-600', css: 'animation-delay:-0.6s' },
  'animation-delay: -1s': { cls: 'chr-delay-1000', css: 'animation-delay:-1s' },
  'animation-duration: 1.6s': { cls: 'chr-dur-1600', dur: '1.6s' },
  'animation-duration: 5s': { cls: 'chr-dur-5000', dur: '5s' },
  'animation-duration: 6s': { cls: 'chr-dur-6000', dur: '6s' },
};
/** The properties a drawn class rule may declare, as measured in the 28 SVGs. Nothing else: a `filter` or a
 *  `box-shadow` would be a glow (a glow means life), and an `animation-*` longhand would escape every motion guard
 *  (the reduced-motion and data-still lists read the `animation` shorthand). */
const CLASS_PROPS = new Set(['animation', 'opacity', 'transform', 'transform-box', 'transform-origin']);
/** The properties a keyframe step may declare, as measured. */
const KEYFRAME_PROPS = new Set(['transform', 'opacity']);
const REDUCED = '@media (prefers-reduced-motion:reduce)';
const GRID = 32;

const refuse = (what, detail) => { throw new Error(`refused ${what}: ${detail}`); };

/** `shared/face.ts` is the one list of characters and moods; this reads it rather than keeping a second copy. */
function faceLists() {
  const src = readFileSync(FACE_TS, 'utf8');
  const list = (name) => {
    const m = src.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`));
    if (!m) throw new Error(`shared/face.ts: no ${name} list`);
    return [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]);
  };
  return { characters: list('CHARACTERS'), moods: list('MOODS') };
}

// ── CSS ─────────────────────────────────────────────────────────────────────

const rename = (s) => s.replace(/(?<![\w-])(?:md|dl)-/g, 'chr-');
const squash = (s) => s.replace(/\s+/g, '');

/** The top-level blocks of a stylesheet: `{ prelude, body }`, nesting kept inside `body`. */
function cssBlocks(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) {
      if (text.slice(i).trim()) refuse('inline style', 'a stylesheet fragment with no block');
      break;
    }
    const prelude = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    if (depth !== 0) refuse('inline style', 'an unbalanced block');
    out.push({ prelude, body: text.slice(open + 1, j - 1).trim() });
    i = j;
  }
  return out;
}

/** The property names of one declaration block, each checked against an allow-list. */
function checkProps(body, allowed, where) {
  for (const decl of body.split(';')) {
    if (!decl.trim()) continue;
    const prop = decl.split(':')[0].trim();
    if (!allowed.has(prop)) refuse('property', `${prop || decl.trim()} in ${where} is outside (${[...allowed].join(', ')})`);
  }
}

/** One file's `<style>`: its class rules and keyframes (renamed to `chr-*`), and what its reduced-motion blocks name. */
function readStyle(styleText) {
  /** @type {Map<string, {key:string, selector:string, body:string}>} */
  const defs = new Map();
  const add = (key, entry) => {
    const had = defs.get(key);
    if (had && squash(had.body) !== squash(entry.body)) {
      refuse('name', `${key} is defined two ways in one file`);
    }
    defs.set(key, entry);
  };
  for (const { prelude, body } of cssBlocks(styleText)) {
    if (prelude === REDUCED || squash(prelude) === squash(REDUCED)) {
      // Each block only stills animations; the generator re-derives the whole block, so it need only be that shape.
      for (const inner of cssBlocks(body)) {
        if (squash(inner.body) !== 'animation:none') {
          refuse('inline style', `a reduced-motion rule that is not animation:none (${inner.prelude})`);
        }
      }
      continue;
    }
    const kf = prelude.match(/^@keyframes\s+([\w-]+)$/);
    if (kf) {
      for (const step of cssBlocks(body)) checkProps(step.body, KEYFRAME_PROPS, `@keyframes ${kf[1]} ${step.prelude}`);
      const name = rename(kf[1]);
      add(`keyframes ${name}`, { key: `keyframes ${name}`, selector: `@keyframes ${name}`, body: rename(body) });
      continue;
    }
    const cl = prelude.match(/^\.([\w-]+)$/);
    if (cl) {
      checkProps(body, CLASS_PROPS, `.${cl[1]}`);
      const name = rename(cl[1]);
      add(`class ${name}`, { key: `class ${name}`, selector: `.${name}`, body: rename(body) });
      continue;
    }
    refuse('inline style', `a rule that is neither one class nor one keyframes (${prelude})`);
  }
  return defs;
}

const isAnimated = (body) => /(^|;)\s*animation\s*:/.test(body);

// ── one SVG ─────────────────────────────────────────────────────────────────

function parseAttrs(raw, where) {
  const attrs = {};
  let used = 0;
  for (const m of raw.matchAll(/\s+([\w:-]+)="([^"]*)"/g)) {
    attrs[m[1]] = m[2];
    used += m[0].length;
  }
  if (used !== raw.length) refuse('attribute', `unreadable attributes on ${where}`);
  return attrs;
}

/** The element tree of one file, the `<style>` text apart. */
function readMarkup(svgText) {
  const styleMatch = svgText.match(/<style>([\s\S]*?)<\/style>/);
  const style = styleMatch ? styleMatch[1] : '';
  const body = styleMatch ? svgText.replace(styleMatch[0], '') : svgText;
  const tag = /<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/y;
  const root = { tag: '#root', attrs: {}, kids: [] };
  const stack = [root];
  let pos = 0;
  while (pos < body.length) {
    if (/\s/.test(body[pos])) { pos++; continue; }
    tag.lastIndex = pos;
    const m = tag.exec(body);
    if (!m) refuse('tag', `unreadable markup at ${JSON.stringify(body.slice(pos, pos + 24))}`);
    pos = tag.lastIndex;
    const [, closing, name, rawAttrs, selfClose] = m;
    if (!TAGS.has(name)) refuse('tag', `<${name}> is outside the set (${[...TAGS].join(', ')})`);
    if (closing) {
      const top = stack.pop();
      if (!top || top.tag !== name) refuse('tag', `</${name}> closes nothing open`);
      continue;
    }
    const node = { tag: name, attrs: parseAttrs(rawAttrs, `<${name}>`), kids: [] };
    stack[stack.length - 1].kids.push(node);
    if (!selfClose) stack.push(node);
  }
  if (stack.length !== 1) refuse('tag', 'an element is never closed');
  const svg = root.kids[0];
  if (!svg || svg.tag !== 'svg' || root.kids.length !== 1) refuse('tag', 'the file is not one <svg>');
  return { svg, style };
}

function toneOf(attrs, tag) {
  const drawn = attrs.fill && attrs.fill.toUpperCase();
  const tone = DRAWN_TONE[drawn];
  if (!tone) refuse('colour', `${attrs.fill ?? '(no fill)'} on <${tag}> is outside the tone table`);
  const out = { tone };
  if (attrs['fill-opacity'] !== undefined) {
    if (!ALPHAS.includes(attrs['fill-opacity']) || tone !== 'ground') {
      refuse('alpha', `fill-opacity ${attrs['fill-opacity']} on ${tone} is outside the three shading strengths`);
    }
    out.alpha = Number(attrs['fill-opacity']);
  }
  return out;
}

function classesOf(attrs) {
  const cls = [];
  if (attrs.class !== undefined) cls.push(...rename(attrs.class).split(/\s+/).filter(Boolean));
  if (attrs.style !== undefined) {
    const mod = STYLE_MODIFIERS[attrs.style];
    if (!mod) refuse('inline style', `style="${attrs.style}" is outside the six`);
    cls.push(mod.cls);
  }
  return cls.length ? cls.join(' ') : undefined;
}

function nodeOf(el) {
  for (const a of Object.keys(el.attrs)) {
    if (!PART_ATTRS[el.tag]?.has(a)) refuse('attribute', `${a} on <${el.tag}> is outside its set`);
  }
  const node = { tag: el.tag };
  const cls = classesOf(el.attrs);
  if (cls) node.cls = cls;
  if (el.tag === 'g') {
    if (el.attrs.transform !== undefined) {
      const t = el.attrs.transform.match(/^translate\((-?\d+) (-?\d+)\)$/);
      if (!t) refuse('transform', `${el.attrs.transform} is not a whole-cell translate`);
      node.at = [Number(t[1]), Number(t[2])];
    }
    node.kids = el.kids.map(nodeOf);
    return node;
  }
  if (el.kids.length) refuse('tag', `<${el.tag}> holds children`);
  if (el.attrs.transform !== undefined) refuse('transform', `${el.attrs.transform} on <${el.tag}>: only a <g> translates`);
  Object.assign(node, toneOf(el.attrs, el.tag));
  if (el.tag === 'path') {
    const d = el.attrs.d ?? '';
    const cells = d.match(/^(?:M\d+ \d+h\d+v\d+h-\d+z)+$/);
    const whole = cells && [...d.matchAll(/h(\d+)v\d+h-(\d+)z/g)].every((m) => m[1] === m[2]);
    if (!whole) refuse('path', `d="${d.slice(0, 40)}" is not a run of whole-cell rectangles`);
    node.d = d;
  } else {
    for (const k of ['x', 'y', 'width', 'height']) {
      if (!/^\d+$/.test(el.attrs[k] ?? '')) refuse('rect number', `${k}="${el.attrs[k]}" is not a whole number`);
    }
    node.x = Number(el.attrs.x); node.y = Number(el.attrs.y);
    node.w = Number(el.attrs.width); node.h = Number(el.attrs.height);
  }
  return node;
}

/** One file: the mood's art, and the class and keyframe definitions it carries. */
function readFile(svgText) {
  const { svg, style } = readMarkup(svgText);
  for (const a of Object.keys(svg.attrs)) {
    if (!ROOT_ATTRS.has(a)) refuse('root attribute', `${a} on <svg> is outside its set`);
  }
  const label = svg.attrs['aria-label'];
  if (label === undefined) refuse('root attribute', 'the <svg> has no aria-label');
  if (svg.kids.some((k) => k.tag === 'svg' || k.tag === 'style')) refuse('tag', 'a nested <svg> or <style>');
  return { art: { label, nodes: svg.kids.map(nodeOf) }, defs: readStyle(style) };
}

/** One SVG text -> its mood's art. Throws a `refused <what>: …` error for anything outside the vocabulary. */
export function parseArt(svgText) {
  return readFile(svgText).art;
}

// ── the whole set ───────────────────────────────────────────────────────────

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function serNode(n, ind) {
  const pad = '  '.repeat(ind);
  const f = [`tag: ${q(n.tag)}`];
  if (n.cls !== undefined) f.push(`cls: ${q(n.cls)}`);
  if (n.tone !== undefined) f.push(`tone: ${q(n.tone)}`);
  if (n.alpha !== undefined) f.push(`alpha: ${n.alpha}`);
  if (n.d !== undefined) f.push(`d: ${q(n.d)}`);
  if (n.x !== undefined) f.push(`x: ${n.x}, y: ${n.y}, w: ${n.w}, h: ${n.h}`);
  if (n.at !== undefined) f.push(`at: [${n.at[0]}, ${n.at[1]}]`);
  if (!n.kids) return `${pad}{ ${f.join(', ')} },`;
  const kids = n.kids.map((k) => serNode(k, ind + 1)).join('\n');
  return `${pad}{ ${f.join(', ')}, kids: [\n${kids}\n${pad}] },`;
}

/** Each drawn duration as its part's shorthand on a compound selector (see `STYLE_MODIFIERS`). A paced node carries
 *  exactly one animated class and no delay modifier, or the generator refuses: a shorthand would reset a drawn delay,
 *  and two animated classes leave the pace ambiguous. */
function pacedRules(art, classRules) {
  const durs = new Map(Object.values(STYLE_MODIFIERS).filter((m) => m.dur).map((m) => [m.cls, m.dur]));
  const delays = new Set(Object.values(STYLE_MODIFIERS).filter((m) => m.css).map((m) => m.cls));
  const animatedBody = new Map(classRules.filter((d) => isAnimated(d.body)).map((d) => [d.selector.slice(1), d.body]));
  const out = new Map();
  const walk = (nodes) => {
    for (const n of nodes) {
      const cls = (n.cls ?? '').split(/\s+/).filter(Boolean);
      const dur = cls.filter((c) => durs.has(c));
      if (dur.length > 0) {
        const parts = cls.filter((c) => animatedBody.has(c));
        if (dur.length !== 1 || parts.length !== 1 || cls.some((c) => delays.has(c))) {
          refuse('pace', `"${n.cls}" must carry one duration, one animated class and no delay`);
        }
        const body = animatedBody.get(parts[0]);
        const shorthand = body.match(/(?:^|;)\s*animation\s*:\s*([^;]+)/)[1].trim();
        const paced = shorthand.replace(/(^|\s)(\d*\.?\d+m?s)(?=\s|$)/, `$1${durs.get(dur[0])}`);
        if (paced === shorthand && !shorthand.includes(durs.get(dur[0]))) refuse('pace', `no duration in "${shorthand}"`);
        out.set(`.${parts[0]}.${dur[0]}`, `animation:${paced}`);
      }
      if (n.kids) walk(n.kids);
    }
  };
  for (const c of Object.keys(art)) for (const m of Object.keys(art[c])) walk(art[c][m].nodes);
  return [...out.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([selector, body]) => ({ selector, body }));
}

const classesIn = (nodes, into) => {
  for (const n of nodes) {
    for (const c of (n.cls ?? '').split(/\s+/).filter(Boolean)) into.add(c);
    if (n.kids) classesIn(n.kids, into);
  }
  return into;
};

/** `{ 'orb-neutral.svg': text, … }` -> `{ art, css }`, the text of both generated files. */
export function compileAll(files) {
  const { characters, moods } = faceLists();
  /** @type {Map<string, {selector:string, body:string}>} */
  const defs = new Map();
  const art = {};
  const names = Object.keys(files).sort();
  for (const file of names) {
    const m = file.match(/^([a-z-]+)-([a-z]+)\.svg$/);
    const character = m && characters.find((c) => m[1] === c);
    if (!m || !character || !moods.includes(m[2])) refuse('file', `${file} is not <character>-<mood>.svg of shared/face.ts`);
    const one = readFile(files[file]);
    for (const [key, def] of one.defs) {
      const had = defs.get(key);
      if (had && squash(had.body) !== squash(def.body)) {
        refuse('name', `${key} is defined two ways (${file} disagrees with an earlier file)`);
      }
      if (!had) defs.set(key, def);
    }
    (art[character] ??= {})[m[2]] = one.art;
  }
  for (const c of characters) for (const mood of moods) {
    if (!art[c]?.[mood]) refuse('set', `${c}-${mood}.svg is missing`);
  }

  // art.ts
  const used = new Set(['chr']);
  const body = characters.map((c) => {
    const moodsText = moods.map((mood) => {
      const a = art[c][mood];
      classesIn(a.nodes, used);
      const nodes = a.nodes.map((n) => serNode(n, 4)).join('\n');
      return `    ${/^[a-z]+$/.test(mood) ? mood : q(mood)}: {\n      label: ${q(a.label)},\n      nodes: [\n${nodes}\n      ],\n    },`;
    }).join('\n');
    return `  ${/^[a-z]+$/.test(c) ? c : q(c)}: {\n${moodsText}\n  },`;
  }).join('\n');

  // characters.css
  const classRules = [...defs.values()].filter((d) => d.selector.startsWith('.'));
  const keyframes = [...defs.values()].filter((d) => d.selector.startsWith('@keyframes'));
  const paced = pacedRules(art, classRules);
  const animated = [...classRules.filter((d) => isAnimated(d.body)).map((d) => d.selector), ...paced.map((d) => d.selector)];
  const mods = Object.values(STYLE_MODIFIERS);
  const toneRules = Object.entries(TONE_TOKEN).map(([t, tok]) => `.chr-t-${t}{fill:var(${tok})}`);
  const css = [
    '/* ccrc:generated by ui/design/make-characters.mjs — do not edit */',
    '/* Tones: each reads its token, so a character follows the palette. Colour is never typed here. */',
    ...toneRules,
    '/* The drawn animation vocabulary (renamed md-* and dl-* to chr-*). Every animation is stepped. */',
    ...classRules.map((d) => `${d.selector}{${d.body}}`),
    ...keyframes.map((d) => `${d.selector}{${d.body}}`),
    '/* The six inline styles the art drew, as classes after the rules so they win: each delay as its own rule, each',
    '   duration as its part\'s shorthand on a compound selector (the `animation-duration`/`animation-timing-function`',
    '   longhand stays out of ui/src, D-5930; the drawn art\'s pace stays in each part\'s own shorthand). */',
    ...mods.filter((m) => m.css).map((m) => `.${m.cls}{${m.css}}`),
    ...paced.map((d) => `${d.selector}{${d.body}}`),
    '/* Reduced motion stills every animation; the resting pose is each part\'s own base style. */',
    `${REDUCED}{\n${animated.join(',\n')}{animation:none}\n}`,
    '/* A bounded play (Character data-still): the same stillness, asked for by the component. */',
    ...animated.map((s) => `.chr[data-still] ${s}{animation:none}`),
    '',
  ].join('\n');

  for (const m of mods) used.add(m.cls);
  for (const t of Object.keys(TONE_TOKEN)) used.add(`chr-t-${t}`);
  for (const d of classRules) used.add(d.selector.slice(1));
  const classes = [...used].sort();

  const tones = Object.keys(TONE_TOKEN).map(q).join(' | ');
  const artTs = `// ccrc:generated by ui/design/make-characters.mjs — do not edit
// The brand brief's 28 SVGs as data: shape and tone, never a colour. Each tone reads its token in characters.css.
import type { Character, Mood } from '../../../shared/face';

/** The brief's colour table, as tones. \`shade\` is not a tone: it is \`ground\` with an \`alpha\`. */
export type Tone = ${tones};

export interface ArtNode {
  readonly tag: 'g' | 'path' | 'rect';
  readonly cls?: string;          // space-separated \`chr-*\` classes
  readonly tone?: Tone;           // absent on a \`g\`
  readonly alpha?: 0.22 | 0.3 | 0.35;
  readonly d?: string;            // a \`path\`'s whole-cell rectangles, verbatim
  readonly x?: number; readonly y?: number; readonly w?: number; readonly h?: number;   // a \`rect\`
  readonly at?: readonly [number, number];   // a \`g\`'s whole-cell translate
  readonly kids?: readonly ArtNode[];
}

export interface MoodArt { readonly label: string; readonly nodes: readonly ArtNode[] }

export const ART: Readonly<Record<Character, Readonly<Record<Mood, MoodArt>>>> = {
${body}
};

/** Every \`chr-*\` class \`art.ts\` emits and \`characters.css\` selects, for \`design-system-boundary\`'s \`OWNED\`. */
export const CHARACTER_CLASSES: readonly string[] = [
${classes.map((c) => `  ${q(c)},`).join('\n')}
];
`;
  return { art: artTs, css };
}

// ── the resting pose, for the icons (Task 4) ────────────────────────────────

/** A class's base style as the sleeping art rests: hidden (`opacity:0`) and/or shifted by a whole-cell translate. Read
 *  from the drawn SVGs' own style blocks, once. */
let BASE = null;
/** `{ 'orb-neutral.svg': text, … }` -> class name -> `{ hidden, at }`. A resting `transform` that is not a
 *  whole-cell `translate(x[px], y[px])` is refused: reading it as no shift would draw a wrong still frame. */
export function restingStyles(files) {
  const base = new Map();
  for (const f of Object.keys(files).sort()) {
    const { style } = readMarkup(files[f]);
    for (const d of readStyle(style).values()) {
      if (!d.selector.startsWith('.')) continue;
      const hidden = /(^|;)\s*opacity\s*:\s*0\s*(;|$)/.test(d.body);
      let at = [0, 0];
      const decl = d.body.match(/(?:^|;)\s*transform\s*:\s*([^;]*)/);
      if (decl) {
        const t = decl[1].trim().match(/^translate\((-?\d+)(?:px)?\s*,\s*(-?\d+)(?:px)?\)$/);
        if (!t) refuse('transform', `${d.selector} rests at "${decl[1].trim()}", which is not a whole-cell translate`);
        at = [Number(t[1]), Number(t[2])];
      }
      base.set(d.selector.slice(1), { hidden, at });
    }
  }
  return base;
}
function baseStyles() {
  return (BASE ??= restingStyles(readSvgDir()));
}

/**
 * The still frame of one mood: 32 rows of 32 cells. A cell is the topmost tone painted there in the resting pose
 * (`null` when nothing is), and for a shaded cell the shading's `alpha` and the tone beneath it as `under`.
 * @returns {({ tone: string; under: string | null; alpha: number | null } | null)[][]}
 */
export function stillGrid(art) {
  const base = baseStyles();
  const grid = Array.from({ length: GRID }, () => Array.from({ length: GRID }, () => null));
  const put = (x, y, n) => {
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
    const below = grid[y][x];
    if (n.alpha !== undefined) {
      grid[y][x] = { tone: n.tone, under: below ? (below.alpha === null ? below.tone : below.under) : null, alpha: n.alpha };
    } else {
      grid[y][x] = { tone: n.tone, under: null, alpha: null };
    }
  };
  const paint = (nodes, dx, dy, hidden) => {
    for (const n of nodes) {
      let nx = dx; let ny = dy; let nh = hidden;
      for (const c of (n.cls ?? '').split(/\s+/).filter(Boolean)) {
        const b = base.get(c);
        if (b) { nh = nh || b.hidden; nx += b.at[0]; ny += b.at[1]; }
      }
      if (n.at) { nx += n.at[0]; ny += n.at[1]; }
      if (n.kids) { paint(n.kids, nx, ny, nh); continue; }
      if (nh) continue;
      const cell = { tone: n.tone, alpha: n.alpha };
      if (n.d !== undefined) {
        for (const m of n.d.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)/g)) {
          const [x0, y0, w, h] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
          for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x + nx, y + ny, cell);
        }
      } else {
        for (let y = n.y; y < n.y + n.h; y++) for (let x = n.x; x < n.x + n.w; x++) put(x + nx, y + ny, cell);
      }
    }
  };
  paint(art.nodes, 0, 0, false);
  return grid;
}

/** A window of a grid: `w` cells across and `h` down from (`x`, `y`). */
export function crop(grid, x, y, w, h) {
  return grid.slice(y, y + h).map((row) => row.slice(x, x + w));
}

// ── the command ─────────────────────────────────────────────────────────────

function readSvgDir() {
  const files = {};
  for (const f of readdirSync(SVG_DIR).filter((n) => n.endsWith('.svg')).sort()) {
    files[f] = readFileSync(path.join(SVG_DIR, f), 'utf8');
  }
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { art, css } = compileAll(readSvgDir());
  const have = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
  const same = have(ART_TS) === art && have(CSS) === css;
  if (process.argv.includes('--check')) {
    if (same) { console.log('up to date: art.ts and characters.css match the SVGs'); process.exit(0); }
    console.error('DRIFT: art.ts or characters.css is not what the SVGs produce.');
    console.error('Fix with: node ui/design/make-characters.mjs --write');
    process.exit(1);
  }
  if (process.argv.includes('--write')) {
    if (same) console.log('already up to date');
    else {
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(ART_TS, art);
      writeFileSync(CSS, css);
      console.log(`wrote ${path.relative(process.cwd(), ART_TS)} and ${path.relative(process.cwd(), CSS)}`);
    }
  } else {
    console.log(`${art.split('\n').length} lines of art.ts, ${css.split('\n').length} lines of characters.css (dry run; pass --write)`);
  }
}
