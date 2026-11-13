// The app icons and the favicon show the Orb (the Overlord face plan, Task 4). The generator is design/icon-gen.mjs; this
// file reads the PNGs it wrote and the tones' values from tokens.css, and types no hex of its own.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { loadThemes, resolveColor } from '../design/audit.mjs';
import { crop, parseArt, stillGrid } from '../../ui/design/make-characters.mjs';

const PWA = path.join(import.meta.dirname, '..');
const REPO = path.join(PWA, '..');
const ICONS = path.join(PWA, 'public', 'icons');

type Rgb = [number, number, number];
interface Png { width: number; height: number; px: Buffer }

/** Width, height and RGBA of a PNG whose rows all use filter 0, which is all the generator writes. */
function readPng(file: string): Png {
  const buf = readFileSync(path.join(ICONS, file));
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const idat: Buffer[] = [];
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at);
    if (buf.toString('ascii', at + 4, at + 8) === 'IDAT') idat.push(buf.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (stride + 1)], `row ${y} filter`).toBe(0);
    raw.copy(px, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { width, height, px };
}
const at = (p: Png, x: number, y: number): [number, number, number, number] => {
  const i = (y * p.width + x) * 4;
  return [p.px[i]!, p.px[i + 1]!, p.px[i + 2]!, p.px[i + 3]!];
};

// ── the tones' values: tokens.css through the design system's one reader (design/audit.mjs), `:root` being Phosphor ──
const { DARK } = loadThemes(PWA);
const token = (name: string): Rgb => {
  if (DARK[name] === undefined) throw new Error(`no ${name} in tokens.css's :root`);
  return resolveColor(DARK[name], DARK).slice(0, 3) as Rgb;
};
const charactersCss = readFileSync(path.join(REPO, 'ui', 'src', 'characters', 'characters.css'), 'utf8');
const toneToken = (tone: string): Rgb => {
  const m = new RegExp(`\\.chr-t-${tone}\\{fill:var\\((--[a-z-]+)\\)\\}`).exec(charactersCss);
  if (!m) throw new Error(`no tone ${tone} in characters.css`);
  return token(m[1]!);
};
const TONES = ['ground', 'body', 'ink', 'crown', 'alarm', 'off-body', 'off-detail', 'tear'];
const PAGE = token('--bg-page');
const ACCENT = token('--accent');
const INK = token('--ink-primary');
/** `--bg-page` at `alpha` over `base`, rounded the way the generator rounds. */
const shade = (alpha: number, base: Rgb): Rgb => PAGE.map((c, i) => Math.round(c * alpha + base[i]! * (1 - alpha))) as Rgb;
const key = (c: ArrayLike<number>): string => `${c[0]},${c[1]},${c[2]}`;

const grid = stillGrid(parseArt(readFileSync(path.join(REPO, 'docs', 'design', 'overlord', 'svg', 'orb-neutral.svg'), 'utf8')));

interface Icon { file: string; size: number; scale: number; maskable: boolean; radius?: number; window?: [number, number, number, number] }
const ICON_ROWS: Icon[] = [
  { file: 'icon-512.png', size: 512, scale: 13, maskable: false, radius: 112 },
  { file: 'icon-192.png', size: 192, scale: 5, maskable: false, radius: 42 },
  { file: 'icon-maskable-512.png', size: 512, scale: 10, maskable: true },
  { file: 'icon-maskable-192.png', size: 192, scale: 4, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, scale: 5, maskable: false },
  { file: 'favicon-32.png', size: 32, scale: 1, maskable: false, window: [5, 13, 22, 14] },
];

describe('the app icons', () => {
  it('each icon has its size', () => {
    for (const r of ICON_ROWS) {
      const p = readPng(r.file);
      expect([p.width, p.height], r.file).toEqual([r.size, r.size]);
    }
  });

  it('a maskable mark stays inside the safe zone', () => {
    for (const r of ICON_ROWS.filter((x) => x.maskable)) {
      const p = readPng(r.file);
      let marked = 0;
      for (let y = 0; y < p.height; y++) {
        for (let x = 0; x < p.width; x++) {
          const c = at(p, x, y);
          expect(c[3], `${r.file} is full bleed`).toBe(255);
          if (key(c) === key(ACCENT)) continue;
          marked++;
          // the pixel's farthest corner from the centre
          const dx = Math.max(Math.abs(x - r.size / 2), Math.abs(x + 1 - r.size / 2));
          const dy = Math.max(Math.abs(y - r.size / 2), Math.abs(y + 1 - r.size / 2));
          expect(Math.hypot(dx, dy), `${r.file} (${x},${y})`).toBeLessThanOrEqual(0.4 * r.size);
        }
      }
      expect(marked, r.file).toBeGreaterThan(0);
    }
  });

  it('the apple and favicon icons are opaque', () => {
    for (const f of ['apple-touch-icon.png', 'favicon-32.png']) {
      const p = readPng(f);
      for (let i = 3; i < p.px.length; i += 4) expect(p.px[i], f).toBe(255);
    }
  });

  it('every colour is a Phosphor token, or the drawn shading over one', () => {
    const allowed = new Set<string>();
    for (const t of TONES) {
      const v = toneToken(t);
      allowed.add(key(v));
      for (const a of [0.22, 0.3, 0.35]) allowed.add(key(shade(a, v)));
    }
    for (const r of ICON_ROWS) {
      const p = readPng(r.file);
      for (let y = 0; y < p.height; y++) {
        for (let x = 0; x < p.width; x++) {
          const c = at(p, x, y);
          if (c[3] === 255) expect(allowed.has(key(c)), `${r.file} (${x},${y}) ${key(c)}`).toBe(true);
        }
      }
    }
  });

  it('each shaded cell composites over the colour that icon draws beneath it', () => {
    let shaded = 0;
    for (const r of ICON_ROWS) {
      const p = readPng(r.file);
      const [wx, wy, ww, wh] = r.window ?? [0, 0, 32, 32];
      const cells = crop(grid, wx, wy, ww, wh);
      const ox = Math.floor((r.size - ww * r.scale) / 2);
      const oy = Math.floor((r.size - wh * r.scale) / 2);
      cells.forEach((row, cy) => row.forEach((cell, cx) => {
        if (!cell || cell.alpha === null) return;
        // the maskable icons draw the body in the page colour; the others draw `under`'s token
        const base = r.maskable || cell.under === null ? PAGE : toneToken(cell.under);
        const want = key(shade(cell.alpha, base));
        shaded++;
        for (let dy = 0; dy < r.scale; dy++) {
          for (let dx = 0; dx < r.scale; dx++) {
            const got = at(p, ox + cx * r.scale + dx, oy + cy * r.scale + dy);
            expect(key(got), `${r.file} cell (${wx + cx},${wy + cy}) over ${cell.under}`).toBe(want);
          }
        }
      }));
    }
    expect(shaded).toBeGreaterThan(0);
  });

  /** What an icon draws on a cell of the Orb's still grid: the tone's colour, the shading over what is beneath, or the ground. */
  const cellColour = (r: Icon, cell: (typeof grid)[number][number]): Rgb => {
    const ground = r.maskable ? ACCENT : PAGE;
    if (!cell) return ground;
    // the maskable icons draw the ground, body and crown in the page colour; the others draw the tone's token
    const drawn = (tone: string): Rgb => (r.maskable && (tone === 'ground' || tone === 'body' || tone === 'crown') ? PAGE : toneToken(tone));
    if (cell.alpha === null) return drawn(cell.tone);
    return shade(cell.alpha, r.maskable || cell.under === null ? PAGE : toneToken(cell.under));
  };

  it('every cell of every icon is the colour that icon draws there', () => {
    for (const r of ICON_ROWS) {
      const p = readPng(r.file);
      const [wx, wy, ww, wh] = r.window ?? [0, 0, 32, 32];
      const cells = crop(grid, wx, wy, ww, wh);
      const ox = Math.floor((r.size - ww * r.scale) / 2);
      const oy = Math.floor((r.size - wh * r.scale) / 2);
      const ground = r.maskable ? ACCENT : PAGE;
      for (let y = 0; y < p.height; y++) {
        for (let x = 0; x < p.width; x++) {
          const c = at(p, x, y);
          if (c[3] !== 255) continue; // the `any` icons' corner band: its own row below
          const cx = Math.floor((x - ox) / r.scale);
          const cy = Math.floor((y - oy) / r.scale);
          const inside = x >= ox && y >= oy && cx < ww && cy < wh;
          const want = inside ? cellColour(r, cells[cy]![cx]!) : ground;
          expect(key(c), `${r.file} (${x},${y})${inside ? ` cell (${wx + cx},${wy + cy})` : ' ground'}`).toBe(key(want));
        }
      }
    }
  });

  it('an any icon is a rounded page-colour square: transparent corners, an opaque ground', () => {
    for (const r of ICON_ROWS.filter((x) => x.radius)) {
      const p = readPng(r.file);
      expect(at(p, 0, 0)[3], `${r.file} corner`).toBe(0);
      expect(at(p, r.size - 1, r.size - 1)[3], `${r.file} far corner`).toBe(0);
      // inside the square, outside the mark
      expect(at(p, r.size / 2, 3), `${r.file} ground`).toEqual([...PAGE, 255]);
      expect(at(p, 3, r.size / 2), `${r.file} ground`).toEqual([...PAGE, 255]);
    }
  });

  it('every non-opaque pixel of an any icon is the ground colour in the rounded corners band', () => {
    for (const r of ICON_ROWS.filter((x) => x.radius)) {
      const radius = r.radius!;
      const p = readPng(r.file);
      let partial = 0;
      for (let y = 0; y < p.height; y++) {
        for (let x = 0; x < p.width; x++) {
          const c = at(p, x, y);
          if (c[3] === 255) continue;
          // distance past the corner circle's centre; the inscribed rounded square is where it is `radius` or less
          const dx = Math.max(radius - (x + 0.5), 0, x + 0.5 - (r.size - radius));
          const dy = Math.max(radius - (y + 0.5), 0, y + 0.5 - (r.size - radius));
          const d = Math.hypot(dx, dy);
          const where = `${r.file} (${x},${y}) alpha ${c[3]}`;
          expect(d, `${where} is outside the rounded square`).toBeGreaterThan(radius - 0.5);
          if (c[3] > 0) { partial++; expect(d, `${where} is within the anti-aliasing`).toBeLessThan(radius + 0.5); }
          expect(key(c), `${where} keeps the ground's colour`).toBe(key(PAGE));
        }
      }
      expect(partial, `${r.file} has an anti-aliased edge`).toBeGreaterThan(0);
    }
  });

  it('the committed icons are what the generator makes', () => {
    const run = spawnSync('node', ['design/icon-gen.mjs', '--check'], { cwd: PWA, encoding: 'utf8' });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });

  it('the mark is the Orb, not the old chevron', () => {
    const p = readPng('icon-512.png');
    const row = Array.from({ length: p.width }, (_, x) => key(at(p, x, 256)));
    expect(row).toContain(key(INK));
  });
});
