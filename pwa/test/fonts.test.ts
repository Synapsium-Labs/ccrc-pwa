import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { declaredValues, norm, stripComments } from './cssRule';

// ── The Geist pair, self-hosted (D-5095) ────────────────────────────────────
//
// Geist and Geist Mono are part of the identity core (D-5094): both skins draw
// every glyph of UI and mono text in them. They are VENDORED, never a
// dependency (spec §12 O5) and never a font host: the files sit in
// ui/src/fonts/, pinned to one release of the `geist` npm package by SHA-256,
// and Vite emits them as same-origin hashed assets. The licence (SIL OFL 1.1)
// ships beside the app at /licenses/Geist-OFL.txt, a byte-identical copy.
//
// The two @font-face rules sit atop tokens.css, beside the stacks that name
// them (D-5450), not in a fonts.css of their own: the contrast gate's walk
// requires every stylesheet under ui/src to hold a style rule, and that suite
// is frozen while the Docs reader is in flight.
//
// What this suite holds, case by case:
//   (1) the two woff2 files are the pinned release's, byte for byte;
//   (2) the two @font-face rules point at exactly those files;
//   (3) the stacks lead with Geist and keep today's system stacks behind it,
//       so a glyph Geist lacks falls back per glyph to the face it had before;
//   (4) nothing reaches an external font host;
//   (5) the shipped licence is the vendored one, and is the OFL 1.1;
//   (6) the faces are top-level rules of tokens.css, which theme.css imports.

const REPO = path.join(import.meta.dirname, '..', '..');
const UI_STYLES = path.join(REPO, 'ui', 'src', 'styles');
const FONTS_DIR = path.join(REPO, 'ui', 'src', 'fonts');
const THEME_CSS = path.join(UI_STYLES, 'theme.css');
const TOKENS_CSS = path.join(UI_STYLES, 'tokens.css');
const VENDORED_OFL = path.join(FONTS_DIR, 'OFL.txt');
const SHIPPED_OFL = path.join(REPO, 'pwa', 'public', 'licenses', 'Geist-OFL.txt');

/** The release the files were taken from (`npm pack geist@1.8.1`). */
const GEIST_VERSION = '1.8.1';

/** Each vendored file and its SHA-256, as unpacked from that release. */
const PINNED: Readonly<Record<string, string>> = {
  'Geist-Variable.woff2': '9ce2d97863cab59a0c7522534112d6c42a4e25c0e6b2ab37766761b0f82cfbd6',
  'GeistMono-Variable.woff2': '119f3e159fc15dd77311e929d3a657a193b57a3e625234666bc43c6e2b1127f7',
  'OFL.txt': '930853ee1daa68554d9e35c8a9175affb74f699fad9a5da6ee5ebe76379d9137',
};

/** Today's stacks, before Geist led them. Kept whole, as the fallback. */
const SYSTEM_UI =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SYSTEM_MONO =
  'ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, "Roboto Mono", "Liberation Mono", monospace';

const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');
const read = (file: string): string => readFileSync(file, 'utf8');

/** The body of every `@font-face { … }` in a stylesheet, comments stripped. */
function fontFaces(css: string): string[] {
  return [...stripComments(css).matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
}

/** One declaration's value inside a block body, whitespace collapsed. */
function decl(body: string, prop: string): string | null {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body);
  return m ? m[1]!.trim().replace(/\s+/g, ' ') : null;
}

describe('(1) the vendored woff2 files are the pinned release, byte for byte', () => {
  it('both woff2 files exist and match their recorded SHA-256', () => {
    for (const file of ['Geist-Variable.woff2', 'GeistMono-Variable.woff2']) {
      const p = path.join(FONTS_DIR, file);
      expect(existsSync(p), `${file} is vendored`).toBe(true);
      expect(sha256(p), `${file} is geist@${GEIST_VERSION}'s`).toBe(PINNED[file]);
    }
  });

  it("tokens.css's note on the faces records the version and each file's SHA-256", () => {
    const css = read(TOKENS_CSS);
    expect(css).toContain(`geist@${GEIST_VERSION}`);
    for (const [file, hash] of Object.entries(PINNED)) {
      expect(css, `${file}'s hash in the header`).toContain(hash);
    }
    expect(css).toContain('SIL Open Font License 1.1');
  });
});

describe('(2) the two @font-face rules point at the vendored files', () => {
  it("the faces' two src urls resolve to those files", () => {
    const faces = fontFaces(read(TOKENS_CSS));
    expect(faces).toHaveLength(2);
    const byFamily = new Map(faces.map((f) => [decl(f, 'font-family'), f]));
    expect([...byFamily.keys()].sort()).toEqual(["'Geist Mono'", "'Geist'"]);
    const want: Readonly<Record<string, string>> = {
      "'Geist'": 'Geist-Variable.woff2',
      "'Geist Mono'": 'GeistMono-Variable.woff2',
    };
    for (const [family, file] of Object.entries(want)) {
      const face = byFamily.get(family)!;
      const src = decl(face, 'src');
      const m = /^url\('([^']+)'\) format\('woff2'\)$/.exec(src ?? '');
      expect(m, `${family}'s src is one same-origin woff2 url: ${src}`).not.toBeNull();
      const resolved = path.resolve(UI_STYLES, m![1]!);
      expect(existsSync(resolved), `${family}'s url resolves to a file: ${m![1]}`).toBe(true);
      expect(resolved, `${family}'s url names its own file`).toBe(path.join(FONTS_DIR, file));
      expect(decl(face, 'font-weight'), family).toBe('100 900');
      expect(decl(face, 'font-style'), family).toBe('normal');
      expect(decl(face, 'font-display'), family).toBe('swap');
    }
  });
});

describe('(3) the stacks lead with the Geist pair', () => {
  it('the stacks lead with Geist and Geist Mono and keep the system stacks after them', () => {
    const tokens = read(TOKENS_CSS);
    const ui = declaredValues(tokens, ':root', '--family-ui');
    const mono = declaredValues(tokens, ':root', '--family-mono');
    expect(ui.length, '--family-ui is declared').toBeGreaterThan(0);
    expect(mono.length, '--family-mono is declared').toBeGreaterThan(0);
    for (const v of ui) expect(norm(v)).toBe(norm(`"Geist", ${SYSTEM_UI}`));
    for (const v of mono) expect(norm(v)).toBe(norm(`"Geist Mono", ${SYSTEM_MONO}`));
  });
});

/** Every stylesheet, html file and script source the two packages ship. */
function sources(): string[] {
  const roots = [
    path.join(REPO, 'ui', 'src'),
    path.join(REPO, 'ui', '.storybook'),
    path.join(REPO, 'pwa', 'src'),
    path.join(REPO, 'pwa', 'public'),
  ];
  const out: string[] = [path.join(REPO, 'pwa', 'index.html')];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(css|html|ts|tsx|js|mjs)$/.test(name)) out.push(p);
    }
  };
  for (const r of roots) walk(r);
  return out;
}

/** What reaching a font host looks like in a stylesheet, page or script. */
const EXTERNAL: ReadonlyArray<readonly [string, RegExp]> = [
  ['a Google Fonts host', /fonts\.(googleapis|gstatic)\.com/i],
  ['an @import of a remote stylesheet', /@import\s+(url\(\s*)?['"]?(https?:)?\/\//i],
  ['a remote url() in an @font-face', /@font-face\s*\{[^}]*url\(\s*['"]?(https?:)?\/\//i],
  ['a remote stylesheet <link>', /<link\b[^>]*\brel=["']?stylesheet\b[^>]*\bhref=["']?(https?:)?\/\//i],
  ['a remote stylesheet <link>', /<link\b[^>]*\bhref=["']?(https?:)?\/\/[^>]*\brel=["']?stylesheet\b/i],
];

describe('(4) no font host', () => {
  it('no stylesheet, index.html or ts source under pwa/ or ui/ reaches an external font host', () => {
    const files = sources();
    // A walker that found nothing would pass vacuously.
    expect(files.filter((f) => f.endsWith('.css')).length).toBeGreaterThan(10);
    expect(files).toContain(TOKENS_CSS);
    const hits: string[] = [];
    for (const f of files) {
      const text = read(f);
      for (const [what, re] of EXTERNAL) {
        if (re.test(text)) hits.push(`${path.relative(REPO, f)}: ${what}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('(5) the licence ships', () => {
  it('the shipped licence is byte-identical to the vendored one, and is the SIL Open Font License 1.1', () => {
    expect(existsSync(SHIPPED_OFL), 'pwa/public/licenses/Geist-OFL.txt').toBe(true);
    expect(sha256(VENDORED_OFL)).toBe(PINNED['OFL.txt']);
    expect(readFileSync(SHIPPED_OFL).equals(readFileSync(VENDORED_OFL)), 'byte-identical').toBe(true);
    const text = read(SHIPPED_OFL);
    expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(text).toContain('This Font Software is licensed under the SIL Open Font License, Version 1.1.');
  });
});

/** Each `@font-face` keyword's brace depth in a stylesheet, comments stripped. */
function faceDepths(css: string): number[] {
  const text = stripComments(css);
  const out: number[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '@' && text.startsWith('@font-face', i)) out.push(depth);
  }
  return out;
}

describe('(6) the faces are top-level rules of the sheet theme.css imports', () => {
  it('tokens.css declares both faces at the top level, and theme.css imports tokens.css', () => {
    // A face nested in :root, a palette block or any style rule is dropped.
    expect(faceDepths(read(TOKENS_CSS))).toEqual([0, 0]);
    const theme = stripComments(read(THEME_CSS));
    const at = theme.indexOf("@import './tokens.css';");
    expect(at, "theme.css has @import './tokens.css';").toBeGreaterThan(-1);
    expect(at, 'before the first rule, where an @import still counts').toBeLessThan(theme.indexOf('{'));
    // No second home for a face: one declaration per family, in the ui package.
    for (const f of sources().filter((p) => p.endsWith('.css') && p !== TOKENS_CSS)) {
      expect(faceDepths(read(f)), `${path.relative(REPO, f)} declares an @font-face`).toEqual([]);
    }
  });
});
