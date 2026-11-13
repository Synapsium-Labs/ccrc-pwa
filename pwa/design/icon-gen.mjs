#!/usr/bin/env node
// ccrc icon generator: the Orb, the brand brief's mark (docs/design/overlord/).
//
// Every icon draws the Orb's Neutral still (`orb-neutral.svg`, read through the
// design system's own parser, `ui/design/make-characters.mjs`) as whole-pixel
// cells, at a whole multiple per icon, so the pixels stay the grid's. Colours
// are never typed here: each tone's value is read from `tokens.css`'s Phosphor
// block (`:root`, through `audit.mjs`'s `loadThemes` and `resolveColor`), by the token name `characters.css` gives that tone. The
// brief's shading (the page colour at 0.22, 0.3 or 0.35) is composited once over
// the colour that icon draws beneath the cell, so the icons keep the drawn rim.
//
// Zero dependencies: the PNGs are written by hand (zlib deflate + CRC32).
// Regenerate with:
//
//   node design/icon-gen.mjs
//
// `node design/icon-gen.mjs --check` writes nothing: it compares the PNGs it would write with the committed ones
// byte for byte and exits 1 on any difference (`app-icons.test.ts` runs it). Importing the file does nothing.
//
// Outputs (public/icons/):
//   icon-192.png / icon-512.png            purpose "any": the Orb on a rounded
//                                          page-colour square, corners transparent
//   icon-maskable-192.png / -512.png       purpose "maskable": the accent colour
//                                          full bleed, the Orb's body and crown
//                                          drawn in the page colour, every mark
//                                          pixel inside the 40%-radius safe zone
//   apple-touch-icon.png                   180x180, opaque (iOS rounds it)
//   favicon-32.png                         the eye alone, 1x, opaque
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crop, parseArt, stillGrid } from '../../ui/design/make-characters.mjs';
import { loadThemes, resolveColor } from './audit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');

// — tones, read from the stylesheets —

// `tokens.css` is read by the design system's one reader (`audit.mjs`: `loadThemes`, `resolveColor`), as the
// contrast gate reads it; `:root` is the Phosphor palette, `DARK`.
const { DARK } = loadThemes();
const token = (name) => {
  if (DARK[name] === undefined) throw new Error(`icon-gen: no ${name} in tokens.css's :root`);
  return resolveColor(DARK[name], DARK).slice(0, 3);
};
const charactersCss = readFileSync(path.join(REPO, 'ui', 'src', 'characters', 'characters.css'), 'utf8');
function toneValue(tone) {
  const m = new RegExp(`\\.chr-t-${tone}\\{fill:var\\((--[a-z-]+)\\)\\}`).exec(charactersCss);
  if (!m) throw new Error(`icon-gen: no tone ${tone} in characters.css`);
  return token(m[1]);
}
const PAGE = token('--bg-page');
const ACCENT = token('--accent');

// — PNG plumbing —

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function pngFromRgba(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // raw scanlines, filter byte 0 per row
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// — drawing —

const GRID = stillGrid(
  parseArt(readFileSync(path.join(REPO, 'docs', 'design', 'overlord', 'svg', 'orb-neutral.svg'), 'utf8')),
);

/** `top` at `alpha` over `base`, rounded once. */
const composite = (top, alpha, base) => top.map((c, i) => Math.round(c * alpha + base[i] * (1 - alpha)));

/**
 * One icon. `window` crops the grid (x, y, w, h in cells); `scale` is pixels per cell; `ground` is the colour the
 * mark sits on; `maskable` draws the body and crown in the page colour; `radius` rounds the square (corners transparent).
 */
function renderIcon({ size, scale, window = [0, 0, 32, 32], ground, maskable = false, radius = 0 }) {
  const [wx, wy, ww, wh] = window;
  const cells = crop(GRID, wx, wy, ww, wh);
  const ox = Math.floor((size - ww * scale) / 2);
  const oy = Math.floor((size - wh * scale) / 2);
  const rgba = Buffer.alloc(size * size * 4);
  const put = (x, y, c, a = 255) => {
    const i = (y * size + x) * 4;
    rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = a;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 255;
      if (radius > 0) {
        // distance past the rounded corner's centre, one pixel of anti-aliasing
        const dx = Math.max(radius - (x + 0.5), 0, x + 0.5 - (size - radius));
        const dy = Math.max(radius - (y + 0.5), 0, y + 0.5 - (size - radius));
        a = Math.round(255 * Math.max(0, Math.min(1, radius - Math.hypot(dx, dy) + 0.5)));
      }
      put(x, y, ground, a);
    }
  }
  const drawn = (tone) => (maskable && (tone === 'ground' || tone === 'body' || tone === 'crown') ? PAGE : toneValue(tone));
  cells.forEach((row, cy) => row.forEach((cell, cx) => {
    if (!cell) return;
    const colour = cell.alpha === null
      ? drawn(cell.tone)
      : composite(PAGE, cell.alpha, cell.under === null || maskable ? PAGE : toneValue(cell.under));
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) put(ox + cx * scale + dx, oy + cy * scale + dy, colour);
    }
  }));
  return pngFromRgba(size, rgba);
}

// — outputs —

const outDir = path.join(HERE, '..', 'public', 'icons');

const files = [
  ['icon-192.png', { size: 192, scale: 5, ground: PAGE, radius: 42 }],
  ['icon-512.png', { size: 512, scale: 13, ground: PAGE, radius: 112 }],
  // maskable: the mark inside the 40%-radius safe circle
  ['icon-maskable-192.png', { size: 192, scale: 4, ground: ACCENT, maskable: true }],
  ['icon-maskable-512.png', { size: 512, scale: 10, ground: ACCENT, maskable: true }],
  ['apple-touch-icon.png', { size: 180, scale: 5, ground: PAGE }],
  ['favicon-32.png', { size: 32, scale: 1, ground: PAGE, window: [5, 13, 22, 14] }],
];

// Only a run of this file does anything: importing it writes nothing.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const stale = files.filter(([name, spec]) => {
      const file = path.join(outDir, name);
      return !existsSync(file) || !readFileSync(file).equals(renderIcon(spec));
    });
    for (const [name] of stale) console.error(`icon-gen: ${name} is not what the generator makes; run node design/icon-gen.mjs`);
    if (stale.length) process.exit(1);
    console.log(`icon-gen: ${files.length} icons match the generator`);
  } else {
    mkdirSync(outDir, { recursive: true });
    for (const [name, spec] of files) {
      const png = renderIcon(spec);
      writeFileSync(path.join(outDir, name), png);
      console.log(`${name}  ${spec.size}x${spec.size}  ${png.length} bytes`);
    }
  }
}
