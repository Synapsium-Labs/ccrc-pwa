// The highlight registry as data (native Docs reader, W5h-a Task 2; base spec 2026-10-01 section 4.10 Files and
// "One registry", section 4.4 "Is there a grammar?"; the plan's refinement (n)). The main thread knows which
// grammars the highlight worker registers, and which fence words reach them, as data: nothing on the main thread
// asks highlight.js. `highlight-names.test.ts` holds this table equal to the worker's instance
// (`highlightGrammars.ts#HLJS`) in both directions.
//
// Imports nothing (base spec 4.10's Files table): W5h-b retired W5 part 1's main-thread highlight bounds, whose caps and
// scans this file held until then.
//
// Ring L1: pure data and pure functions.

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
