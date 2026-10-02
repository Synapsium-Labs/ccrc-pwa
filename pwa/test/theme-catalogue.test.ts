// THE PICKER AND THE PALETTES ARE BOUND TO EACH OTHER.
//
// `ui/src/styles/themes.ts` is the one hand-typed enumeration in the theming
// system: a human-readable label cannot be derived from a CSS selector, so it
// has to be written somewhere. Everything else — which palettes exist, which
// get measured — is DISCOVERED from `tokens.css`.
//
// That split is only safe if the two halves are checked against each other.
// Unbound, the failure is silent in both directions and neither suite notices:
// a palette added to tokens.css with no entry here is a theme nobody can
// select, and an entry here with no palette is a picker row that stamps a
// `data-theme` no stylesheet answers — which does not fall back to the
// default, it leaves the app rendering `:root`'s dark palette with whatever
// the chooser's own styling implies, i.e. a theme that half-applied.
//
// So: the ids in THEMES are EXACTLY the `[data-theme='…']` blocks in
// tokens.css, plus the default, which deliberately has no block.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { THEMES, THEME_STORAGE_KEY, PHOSPHOR, SYSTEM, applyTheme, resolveTheme } from '@ccrc/ui';

const TOKENS = path.join(
  import.meta.dirname, '..', '..', 'ui', 'src', 'styles', 'tokens.css');

/** Every `[data-theme='x']` block in tokens.css, by id.
 *
 *  The selector is matched WHOLE — `[data-theme='light']` must not also match
 *  `[data-theme='solarized-light']`, and a compound like
 *  `[data-theme='x'][data-acct='y']` is deliberately not a palette block. */
const declared = (): string[] => {
  const css = readFileSync(TOKENS, 'utf8');
  const ids = new Set<string>();
  for (const m of css.matchAll(/^\[data-theme='([a-z0-9-]+)'\]\s*\{/gm)) ids.add(m[1] as string);
  return [...ids].sort();
};

describe('the theme catalogue is bound to the palettes', () => {
  it('finds palette blocks at all', () => {
    // Guards the guard: a regex that silently matched nothing would make every
    // assertion below pass against an empty set.
    expect(declared().length).toBeGreaterThan(5);
  });

  it('every selectable theme has a palette, and every palette is selectable', () => {
    // PHOSPHOR is excluded on BOTH sides, not skipped on one: it is `:root`,
    // so it is selectable and has no block, and that is the only id of which
    // that is true.
    const selectable = THEMES.map((t) => t.id).filter((id) => id !== PHOSPHOR).sort();
    expect(selectable).toEqual(declared());
  });

  it('the default is the ABSENCE of a palette block, and there is exactly one', () => {
    // Phosphor & Ink is `:root`. A `[data-theme='phosphor']` block would make
    // the default an override of itself — doubling every measurement the
    // contrast gate makes, to describe the palette it already started from.
    const phosphor = THEMES.filter((t) => t.id === PHOSPHOR);
    expect(phosphor).toHaveLength(1);
    expect(phosphor[0]?.label).toBe('Phosphor & Ink');
    expect(declared()).not.toContain(PHOSPHOR);
    // It is also FIRST — the console's own palette leads the picker.
    expect(THEMES[0]?.id).toBe(PHOSPHOR);
  });

  it('labels and notes are present and distinct', () => {
    const labels = THEMES.map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const t of THEMES) {
      expect(t.label.length, t.label).toBeGreaterThan(2);
      expect(t.note.length, t.label).toBeGreaterThan(10);
    }
  });

  it('offers both modes, in useful numbers', () => {
    // The ask was light AND dark, not a dark list with one light apology.
    const dark = THEMES.filter((t) => t.mode === 'dark').length;
    const light = THEMES.filter((t) => t.mode === 'light').length;
    expect(dark).toBeGreaterThanOrEqual(3);
    expect(light).toBeGreaterThanOrEqual(3);
  });
});

describe('the generated palettes are what the seeds produce', () => {
  // THE GENERATOR'S OUTPUT IS A TRACKED FILE, AND NOTHING BOUND IT TO ITS INPUT.
  //
  // `tokens.css`'s generated block says "do not edit by hand". That was the
  // whole enforcement: a hand-edit to a generated value survived every gate as
  // long as it cleared contrast, and the seed it claimed to derive from became
  // a lie in the direction the banner does not warn about. A comment is a
  // request; this is the mechanism.
  //
  // `--check` recomputes the block and compares without writing, so asking the
  // question cannot accidentally answer it by performing the fix.
  it('tokens.css matches ui/design/make-themes.mjs', () => {
    const r = spawnSync('node', ['design/make-themes.mjs', '--check'], {
      cwd: path.join(import.meta.dirname, '..', '..', 'ui'),
      encoding: 'utf8',
    });
    expect(r.error, 'could not run the generator').toBeUndefined();
    expect(`${r.stdout}${r.stderr}`.trim()).toContain('up to date');
    expect(r.status, 'run `npm run themes` in ui/ to regenerate').toBe(0);
  });
});

describe('Storybook stamps themes the way the app does', () => {
  // WHY THIS GUARD EXISTS, MEASURED.
  //
  // The preview decorator used to call `setAttribute('data-theme', theme)`
  // with its global defaulting to `'dark'`. tokens.css has no
  // `[data-theme='dark']` block — the app's dark palette is `:root`, reached
  // by the ABSENCE of the attribute — so every story rendered against a
  // selector matching nothing, every token fell through to `:root`, and it
  // looked right by coincidence. It was found by applying a real palette
  // across every story at once: one story re-rendered, the decorator re-ran,
  // and it stamped `dark` back over the palette under test.
  //
  // The fix is that Storybook and the app share ONE function. This checks they
  // still do, because the failure mode is invisible — the stories look fine.
  const previewSrc = readFileSync(
    path.join(import.meta.dirname, '..', '..', 'ui', '.storybook', 'preview.ts'), 'utf8');
  // COMMENTS ARE STRIPPED BEFORE SCANNING. The decorator's own header quotes
  // the defective call it replaced — naming the bug is how the next reader
  // knows not to reintroduce it — and a scan that reads prose as code would
  // red on the explanation while the code was correct. (audit.mjs strips
  // comments before matching for the same reason, and for the same class of
  // false positive.)
  const preview = previewSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

  it('goes through applyTheme rather than setting the attribute itself', () => {
    expect(preview).toContain('applyTheme(');
    expect(preview, 'the decorator stamps data-theme by hand again')
      .not.toMatch(/setAttribute\(\s*['"]data-theme['"]/);
  });

  it('derives its toolbar from the catalogue instead of listing palettes', () => {
    expect(preview).toContain('THEMES.map(');
    // The two literals the old toolbar hand-listed. Either reappearing means
    // the list has been re-typed and can drift from tokens.css again.
    expect(preview).not.toContain("value: 'dark'");
    expect(preview).not.toContain("value: 'light'");
  });

  it('defaults to the same palette the app defaults to', () => {
    expect(preview).toContain('initialGlobals: { theme: PHOSPHOR }');
  });
});

describe('resolveTheme refuses what this build cannot render', () => {
  it('passes through a palette it knows', () => {
    expect(resolveTheme('nord')).toBe('nord');
  });

  it('falls back to the default for anything it does not', () => {
    // A value written by a NEWER build, or by hand. Leaving the document
    // stamped with it would render the app against a palette whose tokens are
    // not in this bundle — every token falling through to :root EXCEPT the
    // ones the stale value happens to match, which is the half-palette the
    // contrast gate cannot see because no such block exists to measure.
    for (const junk of ['', null, undefined, 'not-a-theme', 'Nord', '../evil']) {
      expect(resolveTheme(junk), String(junk)).toBe(SYSTEM);
    }
  });

  it('keeps SYSTEM as a choice in its own right, distinct from any palette', () => {
    expect(resolveTheme(SYSTEM)).toBe(SYSTEM);
    expect(THEMES.some((t) => t.id === SYSTEM)).toBe(false);
  });

  it('names its storage key once', () => {
    expect(THEME_STORAGE_KEY).toBe('ccrc-theme');
  });

  it("index.html's pre-paint script uses the same key and sentinels", () => {
    // That script CANNOT import these — it runs before the bundle exists, and
    // that is argued in its own comment. So the strings are a second copy by
    // necessity, which makes them exactly the kind of copy that needs binding
    // rather than the kind that needs justifying.
    const html = readFileSync(
      path.join(import.meta.dirname, '..', 'index.html'), 'utf8');
    expect(html).toContain(`'${THEME_STORAGE_KEY}'`);
    expect(html).toContain(`'${SYSTEM}'`);
    expect(html).toContain(`'${PHOSPHOR}'`);
  });
});

describe('applyTheme stamps the document', () => {
  it('sets the attribute for a palette', () => {
    const el = document.createElement('html');
    applyTheme('dracula', el, false);
    expect(el.getAttribute('data-theme')).toBe('dracula');
  });

  it('REMOVES the attribute for Phosphor, rather than writing a value', () => {
    const el = document.createElement('html');
    el.setAttribute('data-theme', 'dracula');
    applyTheme(PHOSPHOR, el, false);
    expect(el.hasAttribute('data-theme')).toBe(false);
  });

  it('SYSTEM follows the OS between the two Phosphor palettes, both ways', () => {
    const el = document.createElement('html');
    applyTheme(SYSTEM, el, true);
    expect(el.getAttribute('data-theme')).toBe('light');
    applyTheme(SYSTEM, el, false);
    expect(el.hasAttribute('data-theme')).toBe(false);
  });

  it('a pinned palette ignores the OS entirely', () => {
    // The whole point of pinning: someone on a light desktop who wants Nord
    // gets Nord, not Nord-until-the-sun-goes-down.
    const el = document.createElement('html');
    applyTheme('nord', el, true);
    expect(el.getAttribute('data-theme')).toBe('nord');
    applyTheme('nord', el, false);
    expect(el.getAttribute('data-theme')).toBe('nord');
  });
});
