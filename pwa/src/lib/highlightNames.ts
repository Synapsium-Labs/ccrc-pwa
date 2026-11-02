// The highlight registry as data (native Docs reader, W5h-a Task 2; base spec 2026-10-01 section 4.10 Files and
// "One registry", section 4.4 "Is there a grammar?"; the plan's refinement (n)). The main thread knows which
// grammars the highlight worker registers, and which fence words reach them, as data: nothing on the main thread
// asks highlight.js. `highlight-names.test.ts` holds this table equal to the worker's instance
// (`highlightGrammars.ts#HLJS`) in both directions.
//
// Imports only `markdownLimits.ts`, for part 1's caps, until W5h-b, and nothing after. The helpers below the banner
// moved here from `markdown.tsx`, their text unchanged (that file keeps its own copies until Task 6 deletes them).
//
// Ring L1: pure data and pure functions.

import { MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS, MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS } from './markdownLimits';

/** The 15 grammars the highlight worker registers, sorted (its `listLanguages()`; M4.H5). */
export const HIGHLIGHT_GRAMMARS: readonly string[] = [
  'bash', 'css', 'diff', 'dockerfile', 'go', 'javascript', 'json', 'markdown', 'php', 'python', 'rust', 'sql',
  'typescript', 'xml', 'yaml',
];

/** Every alias the worker resolves, to its grammar: each grammar's own aliases and `highlightGrammars.ts`'s
 *  `CCRC_ALIASES`, as the installed highlight.js answers them (measured at the W5h-a plan's Task 2 Step 0). */
export const HIGHLIGHT_ALIASES: Readonly<Record<string, string>> = {
  atom: 'xml',
  cjs: 'javascript',
  cts: 'typescript',
  docker: 'dockerfile',
  golang: 'go',
  gyp: 'python',
  html: 'xml',
  ipython: 'python',
  js: 'javascript',
  json5: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  md: 'markdown',
  mjs: 'javascript',
  mkd: 'markdown',
  mkdown: 'markdown',
  mts: 'typescript',
  patch: 'diff',
  plist: 'xml',
  py: 'python',
  rs: 'rust',
  rss: 'xml',
  sh: 'bash',
  shell: 'bash',
  svg: 'xml',
  ts: 'typescript',
  tsx: 'typescript',
  wsf: 'xml',
  xhtml: 'xml',
  xjb: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  yml: 'yaml',
  zsh: 'bash',
};

/** Every name a fence may use to reach a grammar: the 15 names and every alias. The main thread's check accepts
 *  `<span class="language-NAME">` for these names only (section 4.10). */
export const HIGHLIGHT_NAME_SET: ReadonlySet<string> = new Set([...HIGHLIGHT_GRAMMARS, ...Object.keys(HIGHLIGHT_ALIASES)]);

/** The grammar `lang` names, resolved as highlight.js's `getLanguage` resolves it (lower-cased; a name, else an
 *  alias); `null` when none. Own keys only, so no prototype key is a grammar. */
export function grammarOf(lang: string): string | null {
  const name = lang.toLowerCase();
  if (HIGHLIGHT_GRAMMARS.includes(name)) return name;
  return Object.hasOwn(HIGHLIGHT_ALIASES, name) ? HIGHLIGHT_ALIASES[name]! : null;
}

/** Whether `lang` names a registered grammar (a name or an alias). The one predicate: `CodeBlock`, `blockKey`, the
 *  text leaf and the tool wells' plan read it; nothing on the main thread asks highlight.js. */
export function isRegisteredGrammar(lang: string): boolean {
  return lang !== '' && grammarOf(lang) !== null;
}

export const LANG_LABEL: Readonly<Record<string, string>> = {
  bash: 'bash', sh: 'shell', shell: 'shell', zsh: 'zsh',
  typescript: 'TypeScript', ts: 'TypeScript', tsx: 'TSX',
  javascript: 'JavaScript', js: 'JavaScript', jsx: 'JSX',
  json: 'JSON', python: 'Python', py: 'Python', css: 'CSS',
  xml: 'XML', html: 'HTML', yaml: 'YAML', yml: 'YAML',
  markdown: 'Markdown', md: 'Markdown', diff: 'diff', sql: 'SQL',
  dockerfile: 'Dockerfile', rust: 'Rust', go: 'Go', php: 'PHP',
};

/** The language a code element's class names (`language-<name>`), lower-cased; `''` when it names none. */
export function codeLanguage(className: string): string {
  return (/language-([\w-]+)/.exec(className)?.[1] ?? '').toLowerCase();
}

// ---- Until W5h-b: what W5 part 1's main-thread bounds need (base spec 4.10; the W5h-a plan's refinement (n)). ----

/** Part 1's per-grammar block caps (review 450 F1): `typescript` and `javascript` at MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS,
 *  `rust` at MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS, by grammar. Static: `highlight-names.test.ts` holds it equal to
 *  `highlightGrammars.ts#deriveBoundedCaps` over the worker's grammars, so a grammar that comes to embed a bounded
 *  one through `subLanguage` reds that test until it is added here. */
export const HIGHLIGHT_BOUNDED_CAPS: ReadonlyMap<string, number> = new Map<string, number>([
  ['javascript', MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS],
  ['rust', MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS],
  ['typescript', MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS],
]);

/** The part 1 cap of the grammar `lang` resolves to; `null` for any other grammar, or none. */
function boundedCap(lang: string): number | null {
  const grammar = grammarOf(lang);
  return grammar === null ? null : HIGHLIGHT_BOUNDED_CAPS.get(grammar) ?? null;
}

/** The longest block, in characters, part 1 lets be highlighted in `lang`: its grammar's cap, else
 *  MD_HIGHLIGHT_BLOCK_MAX_CHARS. */
export function highlightBlockCap(lang: string): number {
  return boundedCap(lang) ?? MD_HIGHLIGHT_BLOCK_MAX_CHARS;
}

/** Whether a block in `lang` counts against part 1's scan page budget (DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS). */
export function inScanPageBudget(lang: string): boolean {
  return boundedCap(lang) !== null;
}

/** Whether a block in `lang` counts against part 1's markdown page budget (DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS):
 *  every name that resolves to the `markdown` grammar. */
export function inMarkdownPageBudget(lang: string): boolean {
  return grammarOf(lang) === 'markdown';
}

/** The longest run of word units in `s` (0 for none): a word unit is a UTF-16 code unit in `[A-Za-z0-9_$]` or at
 *  `0x7f` or above. The upper range is counted because highlight.js's PHP grammar takes `\x7f-\xff` as identifier
 *  characters (64 KiB of `_é` in a `php` fence cost about 38 s), and a unit above it cannot be told from one inside
 *  it without the grammar, so the class fails closed. One pass over its code units, no regular expression, so its
 *  cost is linear in the length of `s` whatever it holds. */
export function longestWordRun(s: string): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f || c === 0x24 || c >= 0x7f) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

/** The length in UTF-16 code units of the longest line of `s` (0 for none); a line ends at `\n` or `\r`, so a
 *  CRLF pair counts neither character. One pass, linear in the length of `s`. */
export function longestLine(s: string): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c === 0x0a || c === 0x0d) {
      run = 0;
    } else {
      run += 1;
      if (run > best) best = run;
    }
  }
  return best;
}

/** The length of the longest run of blank code units in `s` (0 for none): ECMAScript's `\s` set, U+0009 to U+000D,
 *  U+0020, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. The run crosses line
 *  breaks: `typescript` and `javascript` cost highlight.js the square of a blank run that holds a line terminator
 *  (64 KiB of `\n` about 5 to 6 s, of U+2028 about 10 s), and these are exactly the units that join such a run. One
 *  pass, no regular expression, so its cost is linear in the length of `s` whatever it holds. */
export function longestBlankRun(s: string): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if ((c >= 0x09 && c <= 0x0d) || c === 0x20 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a)
        || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}
