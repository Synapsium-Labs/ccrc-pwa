// The endpoint gate's census (D-7305; the 2026-10-29 consolidation TS/MJS kernel base-url plan, Task BU1; spec
// 2026-10-19 §5.13, §5.1 rules 1 and 3). This plan's own module, as W3's, W5's, W7's and W8's keep theirs
// (`census-w3/`, `census-w5/`, `census-w7/`, `census-w8/`): no task appends to `consolidationCensus.ts`, and that file
// never re-exports this one, so no import cycle forms. It imports `REPO` and `codeOf` from `consolidationCensus.ts` and
// reads code through the scan parser (`scan/parse.ts`), never a copy of either. Every count a base-url PR body quotes
// comes from a named query here. Its fixture and real-tree rows live in the sibling `baseUrl.test.ts`; the ceilings the
// later tasks add live in `single-definition/roster-bash.test.ts`, importing from this module.
//
// KNOWN WIDTH, every query: a file that does not parse yields what the parser recovered; a value reached through a
// spread, a computed member or a call is not seen. `loopbackSets()` reads string-only array literals, so an array that
// holds one of the hosts beside any other element, or builds one from pieces, is not a set. `inlineGates()` sees a
// `new URL(` on a code line (a line that `codeOf` keeps) and a `.protocol` compared with `'http:'`, inside one named
// symbol. `gateImporters()` reads relative specifiers only.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { REPO, codeOf } from '../consolidationCensus.js';
import { parseSource, retireFacts, statementStartAt, stringExpressions, type ParsedFile, type SymbolSpan } from '../scan/parse.js';
import { resolveVite } from '../rings/resolveVite.js';

/** The source trees an endpoint gate could be written in: the shared layer, both packages, the PWA and the deploy
 *  tooling. */
export const BASE_URL_CENSUS_DIRS: readonly string[] = ['shared', 'server/src', 'pwa/src', 'agent/src', 'deploy'];

/** The gate's own three files. Their edges to each other are not callers (`gateImporters()`). */
export const GATE_FILES: readonly string[] = ['shared/base-url.ts', 'shared/base-url.mjs', 'shared/base-url.d.mts'];

/** The trees an importer of the gate may sit in: every code tree of the repository, tests included. */
export const IMPORTER_DIRS: readonly string[] = ['.github', 'agent', 'ccd', 'deploy', 'pwa', 'server', 'shared', 'ui'];

/** The three hosts a plain-`http:` endpoint may name, as a set (order is not part of it). */
const LOOPBACK = ['127.0.0.1', '[::1]', 'localhost'] as const;
const LOOPBACK_SET: ReadonlySet<string> = new Set(LOOPBACK);

/** Directories no query walks: installed packages and build output. */
const SKIP_DIRS: ReadonlySet<string> = new Set(['node_modules', 'dist', 'dist-pwa', 'coverage', '.git']);

const rel = (root: string, abs: string): string => path.relative(root, abs).split(path.sep).join('/');

/** Every file under `root/dir` whose name matches `ext`, sorted, declaration files INCLUDED (unlike
 *  `consolidationCensus.ts#sourceFiles`, which skips them: a `.d.mts` is where a declaration and a type alias live).
 *  `__`-prefixed transient mutants are skipped, as there. */
function filesUnder(root: string, dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d).sort()) {
      if (e.startsWith('__') || SKIP_DIRS.has(e)) continue;
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (ext.test(e)) out.push(p);
    }
  };
  walk(path.join(root, dir));
  return out;
}

/** `.ts`, `.tsx`, `.mjs` and `.d.mts` (a declaration file is a `.ts` by its last extension). */
const CENSUS_EXT = /\.(?:tsx?|mjs|d\.mts)$/;

function censusFiles(root: string, dirs: readonly string[] = BASE_URL_CENSUS_DIRS): Array<{ abs: string; file: string }> {
  return dirs.flatMap((d) => filesUnder(root, d, CENSUS_EXT)).map((abs) => ({ abs, file: rel(root, abs) }));
}

/** The innermost named symbol of `p` that holds offset `at`, or `null` (module scope). */
function enclosing(p: ParsedFile, at: number): SymbolSpan | null {
  let best: SymbolSpan | null = null;
  for (const s of p.symbols) {
    if (s.start <= at && at < s.end && (best === null || s.end - s.start < best.end - best.start)) best = s;
  }
  return best;
}

// ── gateDefinitions ────────────────────────────────────────────────────────────────────────────────────────────

export interface GateDefinitions {
  /** `file#BASE_URL_OK` for every `const BASE_URL_OK = …` (exported or not), sorted. */
  readonly definitions: string[];
  /** `file#BASE_URL_OK` for every `declare const BASE_URL_OK` (exported or not), sorted: a type, not a body. */
  readonly declarations: string[];
}

const DECLARE_RE = /^\s*(?:export\s+)?declare\s+const\s+BASE_URL_OK\b/;

/** Every `const BASE_URL_OK` under the census roots, definitions and declarations apart. A definition is a parsed
 *  `const` binding with an initialiser (`let` and `var` are not the gate's shape); a declaration is a `declare const`
 *  code line, which binds no value. 2 definitions (`shared/base-url.mjs`, `shared/base-url.ts`) and 1 declaration
 *  (`shared/base-url.d.mts`) at the plan's base. */
export function gateDefinitions(root: string = REPO): GateDefinitions {
  const definitions: string[] = [];
  const declarations: string[] = [];
  for (const { abs, file } of censusFiles(root)) {
    const text = readFileSync(abs, 'utf8');
    if (!text.includes('BASE_URL_OK')) continue;
    const p = parseSource(text, abs);
    for (const b of p.bindings) {
      if (b.name !== 'BASE_URL_OK') continue;
      const stmt = text.slice(statementStartAt(text, b.start, abs), b.start);
      if (/^(?:export\s+)?const\s+$/.test(stmt)) definitions.push(`${file}#BASE_URL_OK`);
    }
    for (const line of text.split('\n')) if (DECLARE_RE.test(codeOf(line))) declarations.push(`${file}#BASE_URL_OK`);
  }
  return { definitions: definitions.sort(), declarations: declarations.sort() };
}

/** The files `gateDefinitions()` names, either kind. */
function gateDefinitionFiles(root: string): Set<string> {
  const { definitions, declarations } = gateDefinitions(root);
  return new Set([...definitions, ...declarations].map((s) => s.slice(0, s.indexOf('#'))));
}

// ── loopbackSets ───────────────────────────────────────────────────────────────────────────────────────────────

/** Every array literal whose elements are exactly the three loopback hosts, in ANY order, under the census roots:
 *  `file#NAME` for the `const`/`let`/`var` it initialises (through `as const` or a type annotation), else
 *  `file#<symbol>` for the function it sits in, else `file:<line>`. Sorted. The array is read from the parser's string
 *  expressions: a run of string literals separated only by commas, opened by `[` and closed by `]`. A two-host array,
 *  a set with a fourth element and a repeated host are not sets. 3 at the plan's base (`shared/base-url.mjs`,
 *  `shared/base-url.ts`, `shared/models.mjs`, each `#LOOPBACK_HOSTS`). */
export function loopbackSets(root: string = REPO): string[] {
  const out: string[] = [];
  for (const { abs, file } of censusFiles(root)) {
    const text = readFileSync(abs, 'utf8');
    if (!LOOPBACK.every((h) => text.includes(h))) continue;
    const strs = stringExpressions(text, abs).filter((s) => !s.partial);
    const p = parseSource(text, abs);
    for (let i = 0; i < strs.length; i += 1) {
      const open = text.slice(0, strs[i]!.start).match(/\[\s*$/);
      if (!open) continue;
      const run = [strs[i]!];
      while (i + run.length < strs.length && /^\s*,\s*$/.test(text.slice(run[run.length - 1]!.end, strs[i + run.length]!.start))) {
        run.push(strs[i + run.length]!);
      }
      if (!/^\s*,?\s*\]/.test(text.slice(run[run.length - 1]!.end))) continue;
      const values = run.map((s) => s.text);
      if (values.length !== LOOPBACK.length || new Set(values).size !== values.length || !values.every((v) => LOOPBACK_SET.has(v))) continue;
      const arrayStart = strs[i]!.start - open[0].length;
      const bound = p.bindings.find((b) => b.initStart === arrayStart);
      const owner = enclosing(p, arrayStart);
      const line = text.slice(0, arrayStart).split('\n').length;
      out.push(bound ? `${file}#${bound.name}` : owner ? `${file}#${owner.name}` : `${file}:${line}`);
    }
  }
  return out.sort();
}

// ── verdictTypeDecls ───────────────────────────────────────────────────────────────────────────────────────────

/** The two verdict types a declaration of the gate's shape names. */
export const VERDICT_TYPES = ['BaseUrlRefusal', 'BaseUrlVerdict'] as const;
export type VerdictType = (typeof VERDICT_TYPES)[number];

/** For each verdict type, the sorted files under `shared/` (`.ts` or `.d.mts`) that declare it as a top-level type
 *  alias, exported or not. 2 each at the plan's base (`shared/base-url.d.mts`, `shared/base-url.ts`). */
export function verdictTypeDecls(root: string = REPO): Record<VerdictType, string[]> {
  const out: Record<VerdictType, string[]> = { BaseUrlRefusal: [], BaseUrlVerdict: [] };
  for (const abs of filesUnder(root, 'shared', /\.(?:ts|d\.mts)$/)) {
    const text = readFileSync(abs, 'utf8');
    if (!VERDICT_TYPES.some((t) => text.includes(t))) continue;
    const aliases = retireFacts(parseSource(text, abs)).aliases;
    for (const t of VERDICT_TYPES) if (aliases[t]) out[t].push(rel(root, abs));
  }
  for (const t of VERDICT_TYPES) out[t].sort();
  return out;
}

// ── DIFFERENT_QUESTIONS, differentQuestions ────────────────────────────────────────────────────────────────────

/** Readers that parse a URL and judge its scheme or host for a reason that is not an endpoint's (plan item 7), by
 *  `file#symbol`, each with its reason. Reported by name, never counted as an inline gate, and not moved. A reader
 *  that disappears leaves this list in the same commit. */
export const DIFFERENT_QUESTIONS: Readonly<Record<string, string>> = {
  'server/src/accounts/gate.ts#accountOriginClass':
    "classifies the server's own origin with a 127.0.0.0/8 range: a browser's secure-context rule, not an endpoint's",
  'server/src/auth/webauthn.ts#originProblem':
    'judges the WebAuthn origin as a bare serialized origin: a browser rule, not an endpoint gate',
  'server/src/update/catalogue.ts#safeDownloadUrl':
    'takes https: with no user name or password for a release asset URL, never plain http',
};

/** The `DIFFERENT_QUESTIONS` entries whose symbol still exists in its file, sorted. 3 at the plan's base. */
export function differentQuestions(root: string = REPO): string[] {
  const out: string[] = [];
  for (const key of Object.keys(DIFFERENT_QUESTIONS)) {
    const [file, symbol] = key.split('#') as [string, string];
    const abs = path.join(root, file);
    if (!existsSync(abs)) continue;
    if (parseSource(readFileSync(abs, 'utf8'), abs).symbols.some((s) => s.name === symbol)) out.push(key);
  }
  return out.sort();
}

// ── inlineGates ────────────────────────────────────────────────────────────────────────────────────────────────

export interface InlineGates {
  /** `file#symbol` for every inline endpoint gate, sorted. */
  readonly gates: string[];
  /** The same shape in a `DIFFERENT_QUESTIONS` reader, sorted: reported apart, not counted. */
  readonly apart: string[];
}

const NEW_URL = /\bnew\s+URL\s*\(/g;
const NEW_URL_ON_LINE = /\bnew\s+URL\s*\(/;

/** True when the code of `span` reads a loopback set (a name holding `loopback`, any case) or a loopback literal. */
function readsLoopback(text: string, span: SymbolSpan, strs: ReturnType<typeof stringExpressions>): boolean {
  const code = text.slice(span.start, span.end).split('\n').map(codeOf).join('\n');
  if (/loopback/i.test(code.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, "''"))) return true;
  return strs.some((s) => s.start >= span.start && s.end <= span.end && LOOPBACK_SET.has(s.text));
}

/** Every named function, outside the files `gateDefinitions()` names, that both parses a value with `new URL(` and
 *  admits `http:` only on a loopback host: it compares a `.protocol` with `'http:'` and reads a loopback set or
 *  literal. One site per function (the innermost symbol holding the `new URL(`). `DIFFERENT_QUESTIONS` readers are
 *  reported apart. 1 at the plan's base (`shared/models.mjs#parseRegistry`), with 2 apart. */
export function inlineGates(root: string = REPO): InlineGates {
  const skip = gateDefinitionFiles(root);
  const gates = new Set<string>();
  const apart = new Set<string>();
  for (const { abs, file } of censusFiles(root)) {
    if (skip.has(file)) continue;
    const text = readFileSync(abs, 'utf8');
    if (!NEW_URL_ON_LINE.test(text) || !text.includes('http:')) continue;
    const p = parseSource(text, abs);
    const strs = stringExpressions(text, abs);
    const lines = text.split('\n');
    for (const m of text.matchAll(NEW_URL)) {
      const line = text.slice(0, m.index).split('\n').length;
      if (!NEW_URL_ON_LINE.test(codeOf(lines[line - 1] ?? ''))) continue;
      const owner = enclosing(p, m.index!);
      if (owner === null) continue;
      const httpTest = p.comparisons.some((c) => c.start >= owner.start && c.start < owner.end
        && (c.leftLeaf === 'protocol' || c.rightLeaf === 'protocol') && /(['"`])http:\1/.test(c.text));
      if (!httpTest || !readsLoopback(text, owner, strs)) continue;
      const key = `${file}#${owner.name}`;
      (key in DIFFERENT_QUESTIONS ? apart : gates).add(key);
    }
  }
  return { gates: [...gates].sort(), apart: [...apart].sort() };
}

// ── gateImporters ──────────────────────────────────────────────────────────────────────────────────────────────

/** One import or re-export declaration of the gate. `resolves` is the file TypeScript resolves the specifier to (a
 *  `.js` specifier to its `.ts` twin, an extension-less one to the `.ts`, an `.mjs` one to the `.mjs`); `vite` is the
 *  file the PWA's bundler runs (`rings/resolveVite.ts`), given for a file under `pwa/` or `ui/` only. */
export interface GateImportSite {
  readonly file: string;
  readonly specifier: string;
  readonly resolves: string;
  readonly vite?: string;
}

const IMPORTER_EXT = /\.(?:[cm]?[jt]sx?)$/;

/** TypeScript's resolution of a relative specifier from `fromAbs`, enough for the gate's names: a written extension's
 *  source twin first (`.js` → `.ts`/`.tsx`, `.mjs` → `.mts`, `.cjs` → `.cts`), then the file as written; an
 *  extension-less specifier as `.ts`, `.tsx`, `.d.ts`, then a directory's `index`. `null` when it names no file. */
function resolveTs(fromAbs: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromAbs), spec);
  const isFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();
  const ext = path.extname(base);
  const twins: Record<string, string[]> = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };
  for (const t of twins[ext] ?? []) if (isFile(base.slice(0, -ext.length) + t)) return base.slice(0, -ext.length) + t;
  if (isFile(base)) return base;
  for (const e of ['.ts', '.tsx', '.d.ts']) if (isFile(base + e)) return base + e;
  for (const e of ['.ts', '.tsx', '.d.ts']) if (isFile(path.join(base, `index${e}`))) return path.join(base, `index${e}`);
  return null;
}

/** Every import or re-export declaration (`import … from`, `export … from`, `import x = require(…)`; one site per
 *  declaration) whose relative specifier resolves, by TypeScript or by the PWA's bundler, to one of `GATE_FILES`, in
 *  any file under `IMPORTER_DIRS` other than those three. Sorted by file, then line. The ten sites of the plan's item 2,
 *  in nine files, at its base. */
export function gateImporters(root: string = REPO): GateImportSite[] {
  const gate = new Set(GATE_FILES);
  const out: Array<GateImportSite & { line: number }> = [];
  for (const abs of IMPORTER_DIRS.flatMap((d) => filesUnder(root, d, IMPORTER_EXT))) {
    const file = rel(root, abs);
    if (gate.has(file)) continue;
    const text = readFileSync(abs, 'utf8');
    if (!text.includes('base-url')) continue;
    for (const e of parseSource(text, abs).imports) {
      if (e.kind !== 'import' && e.kind !== 'export-from' && e.kind !== 'import-equals') continue;
      if (!e.specifier.startsWith('./') && !e.specifier.startsWith('../')) continue;
      const ts = resolveTs(abs, e.specifier);
      const resolves = ts === null ? null : rel(root, ts);
      const inBundle = file.startsWith('pwa/') || file.startsWith('ui/');
      const v = inBundle ? resolveVite(abs, e.specifier) : null;
      const vite = v === null || v === 'external' ? null : rel(root, v);
      if (!(resolves !== null && gate.has(resolves)) && !(vite !== null && gate.has(vite))) continue;
      out.push({ file, specifier: e.specifier, resolves: resolves ?? '', ...(inBundle && vite !== null ? { vite } : {}), line: e.line });
    }
  }
  out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  return out.map(({ line: _line, ...site }) => site);
}
