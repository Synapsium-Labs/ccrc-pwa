#!/usr/bin/env node
// ccrc icon generator — "Phosphor & Ink" (design/DIRECTION.md).
//
// The app icon is the direction's one piece of terminal furniture: the ❯
// cursor, drawn in phosphor green with a soft breathing-glow bloom, on the
// dark green-cast graphite of --bg-page. No scanlines, no bezels — glow means
// life, and the icon is the app at rest, lamp lit.
//
// Zero dependencies: the chevron is rendered geometrically (distance-to-
// segment with round caps + gaussian bloom) into an RGBA buffer and written
// as a PNG by hand (zlib deflate + CRC32). Regenerate with:
//
//   node design/icon-gen.mjs
//
// Outputs (public/icons/):
//   icon-192.png / icon-512.png            purpose "any"
//   icon-maskable-192.png / -512.png       purpose "maskable" (glyph inside
//                                          the 40%-radius safe zone)
//   apple-touch-icon.png                   180×180, opaque (iOS home screen)
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// — tokens (values mirror src/styles/tokens.css; keep in sync by hand) —
const BG = [0x0b, 0x0d, 0x0c]; // --bg-page (dark)
const PHOSPHOR = [0x45, 0xd6, 0x7e]; // --accent / --status-busy
const BLOOM = [0x45, 0xd6, 0x7e]; // glow is the same phosphor, low alpha

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

// — geometry —

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  const dx = px - (ax + t * abx);
  const dy = py - (ay + t * aby);
  return Math.hypot(dx, dy);
}

/** Render the ❯ at `scale` (glyph height as a fraction of the icon side). */
function renderIcon(size, scale) {
  const G = size * scale; // glyph height
  const cx = size / 2 - G * 0.03; // slight left shift: a chevron's optical center leans apex-ward
  const cy = size / 2;
  const halfH = G / 2;
  const halfW = G * 0.3;
  const r = G * 0.13; // stroke radius (stroke ≈ 26% of glyph height)
  // two strokes meeting at the apex, endpoints inset so round caps stay in the box
  const top = [cx - halfW, cy - halfH + r];
  const apex = [cx + halfW, cy];
  const bot = [cx - halfW, cy + halfH - r];
  const sigma1 = G * 0.11; // tight bloom
  const sigma2 = G * 0.28; // wide faint halo (the 3-layer --glow-busy, flattened)

  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d1 = distToSegment(px, py, top[0], top[1], apex[0], apex[1]);
      const d2 = distToSegment(px, py, apex[0], apex[1], bot[0], bot[1]);
      const edge = Math.min(d1, d2) - r;
      const stroke = Math.max(0, Math.min(1, 0.5 - edge)); // 1px anti-aliased edge
      // Bloom is additive per stroke (min-distance would crease along the
      // bisector inside the V); both strokes lighting the apex is the point.
      let glow = 0;
      for (const d of [d1, d2]) {
        const e = Math.max(0, d - r);
        glow +=
          0.32 * Math.exp(-(e * e) / (2 * sigma1 * sigma1)) +
          0.08 * Math.exp(-(e * e) / (2 * sigma2 * sigma2));
      }
      glow = Math.min(1, glow);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        let v = BG[c] * (1 - glow) + BLOOM[c] * glow;
        v = v * (1 - stroke) + PHOSPHOR[c] * stroke;
        rgba[i + c] = Math.round(v);
      }
      rgba[i + 3] = 255; // opaque: full-bleed glass, correct for maskable + iOS
    }
  }
  return pngFromRgba(size, rgba);
}

// — outputs —

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const files = [
  ['icon-192.png', 192, 0.46],
  ['icon-512.png', 512, 0.46],
  // maskable: glyph + bloom comfortably inside the 40%-radius safe circle
  ['icon-maskable-192.png', 192, 0.36],
  ['icon-maskable-512.png', 512, 0.36],
  ['apple-touch-icon.png', 180, 0.46],
];

for (const [name, size, scale] of files) {
  const png = renderIcon(size, scale);
  writeFileSync(path.join(outDir, name), png);
  console.log(`${name}  ${size}×${size}  ${png.length} bytes`);
}
