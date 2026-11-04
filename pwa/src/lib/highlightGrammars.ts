// The highlight worker's grammars: one private highlight.js instance with the 15 grammars part 1 registered (native
// Docs reader, W5h-a Task 2; base spec 2026-10-01 section 4.10 Files and "The private instance"; M4.H3, M4.H5, M4.H6).
// `xmlWithoutSubLanguages` moved here from `markdown.tsx` in W5h-a; the grammar-graph helpers that derived part 1's
// per-grammar caps retired with those caps in W5h-b.
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
 *  embeds xml, about 650 ms on its worst shape, `<a>` in lines, which W5 part 1 gave a page budget of its own
 *  (retired in W5h-b); the claim it supports is the GROWTH, linear from 8 to 128 KiB, not the figures). What it costs: script and style contents are uncoloured (one real 375-character html fence holds
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
 *  No markdown fence of `docs/superpowers` holds the shape (470 checked), and chat's golden files are unchanged.
 *  It stays after W5h-b retired part 1's other bounds (base spec 4.10 "What stays"): it keeps xml linear on those
 *  regions, so fewer xml, html and markdown blocks reach the worker's deadline, and restoring script and style
 *  colouring would change chat's golden files. */
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
