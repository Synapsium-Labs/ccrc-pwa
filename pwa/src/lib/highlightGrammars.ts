// The highlight worker's grammars: one private highlight.js instance with the 15 grammars part 1 registered, and the
// grammar-graph helpers that derive part 1's caps over it (native Docs reader, W5h-a Task 2; base spec 2026-10-01
// section 4.10 Files and "The private instance"; M4.H3, M4.H5, M4.H6; the plan's refinement (n)). `xmlWithoutSubLanguages`
// and `deriveBoundedCaps` moved here from `markdown.tsx`, their text unchanged (that file keeps its own copies until
// Task 6 deletes them, so two instances coexist meanwhile: the core module's default and `HLJS`).
//
// Imported only inside the highlight worker's closure and by tests: the main thread knows the grammars as data
// (`highlightNames.ts`), and `highlight-names.test.ts` holds the two equal in both directions.
//
// Ring L1, worker side: pure over highlight.js; no I/O, no timer.

import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml'; // html / svg
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';
import sql from 'highlight.js/lib/languages/sql';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import php from 'highlight.js/lib/languages/php';

export type HighlightApi = typeof hljs;
type LanguageFn = Parameters<HighlightApi['registerLanguage']>[1];

/** highlight.js's `xml` grammar (registered as `xml`, with `html` and `svg` and every alias xml declares: xhtml, rss, atom, xjb, xsd, xsl, plist and wsf) with the `subLanguage` removed from the two modes
 *  that carry one that costs: the `<script>` mode (`'javascript'`; `["javascript","handlebars","xml"]` through 11.11) and
 *  the `<style>` mode (`'css'`; `["css","xml"]` through 11.11), the `starts` of the two tag modes. highlight.js 11.12
 *  narrowed both from a list to a single name, so the walk below matches either shape. Those are the only modes of the stock definition with a
 *  `subLanguage`; each keeps its `end` and `returnEnd`, so the contents run to the closing tag as ONE plain run.
 *  Why (review 450 F1): the grammar is quadratic on those regions whatever they embed (`<script>` repeated one per line, no
 *  closer: 1, 2, 4 and 8 KiB cost 66, 308, 1 729 and 7 918 ms; `<style>{` per line, 8 KiB 2.4 s with no javascript
 *  involved), and with them removed every probed shape is linear (a snapshot of 2026-10-14 on a loaded box, load average about 40: xml 167 ms per 64 KiB at most; markdown, which
 *  embeds xml, about 650 ms on its worst shape, `<a>` in lines, which is why it has a page budget of its own,
 *  `DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS`; the claim it supports is the GROWTH, linear from 8 to 128 KiB, not the figures). What it costs: script and style contents are uncoloured (one real 375-character html fence holds
 *  `<script` or `<style>`); in an `xml` or html block, markup outside them is coloured as before. Three grammars hand
 *  tags to `xml` with a kept continuation, so an unclosed `<script>` or `<style>` reaches past its own contents
 *  there (review 460 F9 and review 471 F1, measured against stock highlight.js 11.11.1):
 *  - in a `markdown` block, chat's included, every later inline tag of the block (`<a href>`, `<b>`, after a later
 *    heading too) renders as a bare `language-xml` span with no tag, name or attribute colour. After `<script>`
 *    stock xml coloured those tags as tags; after `<style>` stock coloured them as CSS (selector tags), not as tags.
 *    Only the matching closing tag (`</script>` or `</style>` respectively) restores colour; any other closing tag,
 *    the other of the two included, leaves it so;
 *  - in the JSX of `javascript` and `typescript` (and their aliases, `jsx` and `tsx` among them), the rest of the
 *    block after an unclosed `<script>` or `<style>` is plain, where stock coloured it in the sub-language the tag
 *    starts (javascript after `<script>`; css or xml after `<style>`, whichever highlight.js's relevance picked),
 *    never as the block's own grammar;
 *  - the same two grammars hand an `html` tagged template (html`...`) to `xml` with the same kept continuation, so a
 *    `<script>` or `<style>` inside one leaves every later JSX tag of the block uncoloured (a bare `language-xml`
 *    span), while the code around those tags keeps its colour.
 *  No markdown fence of `docs/superpowers` holds the shape (470 checked), and chat's golden files are unchanged. `xml` and `markdown` then reach no
 *  bounded grammar, so they keep the 64 KiB cap. */
export const xmlWithoutSubLanguages: LanguageFn = (h) => {
  const def = xml(h);
  const seen = new Set<object>();
  const stack: object[] = [def];
  while (stack.length > 0) {
    const mode = stack.pop()!;
    if (seen.has(mode)) continue;
    seen.add(mode);
    const m = mode as { subLanguage?: unknown; contains?: unknown; variants?: unknown; starts?: unknown };
    const subs = typeof m.subLanguage === 'string' ? [m.subLanguage] : Array.isArray(m.subLanguage) ? m.subLanguage : [];
    if (subs.includes('javascript') || subs.includes('css')) delete m.subLanguage;
    for (const list of [m.contains, m.variants]) {
      if (Array.isArray(list)) for (const child of list) if (typeof child === 'object' && child !== null) stack.push(child);
    }
    if (typeof m.starts === 'object' && m.starts !== null) stack.push(m.starts);
  }
  return def;
};

/** The registered grammars a definition embeds through highlight.js `subLanguage`, by registered name. A grammar's
 *  definition is what `h.getLanguage` answers (the object `registerLanguage` stored). highlight.js 11.11.1 compiles a
 *  mode IN PLACE on first use (`compileMode` replaces `contains` and sets `isCompiled` on the registered mode itself);
 *  only variant and parent-dependent modes are cloned, through `inherit`, which copies `subLanguage`. So the walk sees
 *  every `subLanguage` before and after compilation, and it keeps a `seen` set because `'self'` and compiled modes make
 *  the graph cyclic. Never follows `parent`. A name nothing registers (yaml's `ruby`) reaches nothing. An EMPTY array
 *  means auto-detect across every registered grammar in highlight.js (`processSubLanguage` passes `null` to
 *  `highlightAuto`), so it reaches all of them. A string `subLanguage` is looked up by name WITHOUT alias resolution at
 *  runtime, while the walk resolves aliases with `getLanguage`, which can only over-bound, the safe direction. */
function embeddedGrammars(
  h: HighlightApi, def: object, nameOf: ReadonlyMap<object, string>, every: readonly string[],
): ReadonlySet<string> {
  const found = new Set<string>();
  const seen = new Set<object>();
  const stack: object[] = [def];
  while (stack.length > 0) {
    const mode = stack.pop()!;
    if (seen.has(mode)) continue;
    seen.add(mode);
    const m = mode as { subLanguage?: unknown; contains?: unknown; variants?: unknown; starts?: unknown };
    if (Array.isArray(m.subLanguage) && m.subLanguage.length === 0) for (const n of every) found.add(n);
    const subs = typeof m.subLanguage === 'string' ? [m.subLanguage] : Array.isArray(m.subLanguage) ? m.subLanguage : [];
    for (const sub of subs) {
      const target = typeof sub === 'string' ? h.getLanguage(sub) : undefined;
      const name = target === undefined ? undefined : nameOf.get(target);
      if (name !== undefined) found.add(name);
    }
    for (const list of [m.contains, m.variants]) {
      if (Array.isArray(list)) for (const child of list) if (typeof child === 'object' && child !== null) stack.push(child);
    }
    if (typeof m.starts === 'object' && m.starts !== null) stack.push(m.starts);
  }
  return found;
}

/** The bounded grammars of `h` and the cap each takes: the grammars of `base`, and every registered grammar whose
 *  `subLanguage` chain reaches one of them, at the SMALLEST cap among those its chain reaches (`embeddedGrammars` says
 *  what a chain is). Pure over `h`'s registered grammars, so a test derives it on synthetic instances. The set is fixed
 *  at module load: no grammar is registered later in `pwa/src`. */
export function deriveBoundedCaps(h: HighlightApi, base: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  const names = h.listLanguages();
  const nameOf = new Map<object, string>();
  for (const n of names) {
    const def = h.getLanguage(n);
    if (def !== undefined) nameOf.set(def, n);
  }
  const embeds = new Map<string, ReadonlySet<string>>();
  for (const n of names) embeds.set(n, embeddedGrammars(h, h.getLanguage(n)!, nameOf, names));
  const caps = new Map<string, number>(base);
  // Fixed point: a cap only ever falls, and there are finitely many grammars, so this ends.
  for (let changed = true; changed;) {
    changed = false;
    for (const n of names) {
      let cap = caps.get(n) ?? Infinity;
      for (const sub of embeds.get(n) ?? []) cap = Math.min(cap, caps.get(sub) ?? Infinity);
      if (cap !== Infinity && cap !== caps.get(n)) {
        caps.set(n, cap);
        changed = true;
      }
    }
  }
  return caps;
}

/** ccrc's own alias lists, registered beside the aliases each grammar declares. Registering a grammar also
 *  registers the aliases IT declares (that is where `golang` comes from); the php grammar declares none, so `php`
 *  is the only fence word that reaches it. */
export const CCRC_ALIASES: Readonly<Record<string, readonly string[]>> = {
  bash: ['zsh', 'shell'],
  typescript: ['tsx'],
  xml: ['html', 'svg'],
};

/** The highlight worker's one highlight.js instance: never the core module's default instance, never given a plugin
 *  or a configuration, so its escaping is highlight.js's default (M4.H6). */
export const HLJS: HighlightApi = hljs.newInstance();
for (const [name, def] of Object.entries({
  bash, typescript, javascript, json, python, css, xml: xmlWithoutSubLanguages,
  yaml, markdown, diff, sql, dockerfile, rust, go, php,
})) HLJS.registerLanguage(name, def);
for (const [languageName, aliases] of Object.entries(CCRC_ALIASES)) HLJS.registerAliases([...aliases], { languageName });
