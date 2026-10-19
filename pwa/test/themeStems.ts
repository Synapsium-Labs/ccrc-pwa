// theme.css's `@theme` colour keys, read as text: the one map from a Tailwind
// colour utility's stem to the token it names (`phosphor -> var(--accent)`).
//
// Two suites resolve a utility through it. `utility-pairs.test.ts` pairs a
// component's self-grounded ink and ground; `wordmark.test.tsx` resolves the
// caret's colour, which has no ground of its own (the INHERITED_GROUNDS case
// utility-pairs excludes). It lives here so the two read one mapping rather
// than two copies of it (D-5470).
import { readFileSync } from 'node:fs';
import path from 'node:path';

const THEME_CSS = path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'styles', 'theme.css');

/** theme.css's `@theme` block as `utility-stem -> css expression`, e.g.
 *  `phosphor -> var(--accent)`. This is the ONLY source of truth for whether a
 *  `text-*` names a colour or a font size: `--color-ink-primary` exists and
 *  `--color-base` does not, so `text-ink-primary` is ink and `text-base` is a
 *  size. A hand-kept exclusion list of size names would be the same drift
 *  utility-pairs exists to avoid. */
export function colourStems(): Map<string, string> {
  const css = readFileSync(THEME_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map<string, string>();
  for (const m of css.matchAll(/--color-([\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1] ?? '', (m[2] ?? '').trim());
  }
  return out;
}
