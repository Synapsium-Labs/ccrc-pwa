// W5's redactor census (D-7071; ARCH-67, Task C5d; plan 2026-10-27-consolidation-w5-ccd-helpers.md; spec K7, K18). This
// plan's own module for ARCH-67 (no series appends to `consolidationCensus.ts`, D-7043); it imports that file's helpers
// and `accountMarkers.ts`'s program readers, and is never re-exported from `consolidationCensus.ts`. Its FIXTURE and REAL
// rows live in the sibling `redactors.test.ts`. C5h takes `pythonRedactorTables()` 1 -> 0 and C5i takes
// `logLineRedactors()` 2 -> 1; each lands its may-only-shrink pin in the commit that reaches the count (spec §5.1 rule 3).
//
// WHAT IT COUNTS. The rule tables and redactors in ccd's shipped programs (`shippedBashPrograms`, ccd's library read with
// `ccd/ccd`, and the `.py` files under `ccd/`): a python table of `(pattern, suffix)` pairs fed to `re.compile`; a bash
// function that redacts a LINE (it binds a local from `$1`, strips URL userinfo or rewrites `$HOME` to `~` in it, and
// prints it back); and every other userinfo strip in bash code, by the body it is in.
//
// KNOWN WIDTH. The userinfo shape is a negated bracket class holding `/` and `@`, then `*`, `+` or `)`, then `@`
// (`[^/@[:space:]]*@`, `+([^\/@?#[:space:]])@`, `[^/@\t\n\v\f\r ]+@`). A strip spelled another way (a `case` glob, a
// `sed` with other delimiters, an `awk` script) is not seen. A heredoc's body is never bash code here: its lines are read
// only by `pythonRedactorTables`. A function inside a `# ccrc:generated` region whose bytes equal `ccd/ccd`'s function of
// the same name is that function's copy (the accounts plan's C5a rule; C5i re-points the compare to its region row's
// `source`): it is a counted function's copy, never a site of its own.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { bashCodeOf, REPO } from '../consolidationCensus.js';
import { bashBodies, ccdProgramBodies, shippedBashPrograms, type ProgramBody } from './accountMarkers.js';

/** One site: `name` is `<file>#<function>` (or `<file>#<top-level>`), with a `:<TABLE>` suffix for a python table. */
export interface RedactorSite { readonly name: string; readonly file: string; readonly line: number; readonly text: string }

/** The URL-userinfo shape (see KNOWN WIDTH). */
export const USERINFO_SHAPE = /\[\^\\?\/@(?:[^\][]|\[:[a-z]+:\])*\][*+)]*@/;

/** The 1-based lines of `src` that are heredoc bodies (their terminator line included). */
export function heredocLines(src: string): Set<number> {
  const open = /(?<!<)<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;
  const out = new Set<number>();
  const pending: { word: string; tabs: boolean }[] = [];
  src.split('\n').forEach((raw, i) => {
    if (pending.length > 0) {
      out.add(i + 1);
      const h = pending[0]!;
      if ((h.tabs ? raw.replace(/^\t+/, '') : raw) === h.word) pending.shift();
      return;
    }
    for (const m of bashCodeOf(raw).matchAll(open)) pending.push({ word: m[3]!, tabs: m[1] === '-' });
  });
  return out;
}

/** The bash programs this census reads, with their bodies: `ccd/ccd` as ccd's whole program (its library included), every
 *  other shipped bash program, and the top-level `.sh` files under `ccd/`. Each body's heredoc lines are marked. */
function bashProgramBodies(root: string): Array<{ file: string; bodies: ProgramBody[]; heredoc: Map<string, Set<number>> }> {
  const out: Array<{ file: string; bodies: ProgramBody[]; heredoc: Map<string, Set<number>> }> = [];
  const dir = path.join(root, 'ccd');
  const sh = existsSync(dir) ? readdirSync(dir).sort().filter((e) => e.endsWith('.sh') && statSync(path.join(dir, e)).isFile()).map((e) => `ccd/${e}`) : [];
  for (const file of [...shippedBashPrograms(root), ...sh]) {
    if (file === 'ccd/ccd') {
      const bodies = ccdProgramBodies(root);
      const heredoc = new Map<string, Set<number>>();
      for (const f of new Set(bodies.map((b) => b.file))) heredoc.set(f, heredocLines(readFileSync(path.join(root, f), 'utf8')));
      out.push({ file, bodies, heredoc });
      continue;
    }
    const src = readFileSync(path.join(root, file), 'utf8');
    out.push({ file, bodies: bashBodies(src).map((b) => ({ ...b, file })), heredoc: new Map([[file, heredocLines(src)]]) });
  }
  return out;
}

/** A body's bash code lines (heredoc bodies dropped, comments cut). */
const codeLines = (b: ProgramBody, heredoc: Map<string, Set<number>>): Array<{ line: number; raw: string; code: string }> =>
  b.lines.filter((l) => !(heredoc.get(b.file)?.has(l.line) ?? false)).map((l) => ({ line: l.line, raw: l.raw, code: bashCodeOf(l.raw) }));

/** `ccd/ccd`'s (and its library's) function texts by name: a generated region's source. */
function ccdFunctionTexts(root: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of ccdProgramBodies(root)) if (b.fn && !out.has(b.name)) out.set(b.name, b.text);
  return out;
}

/** Whether a body is a generated copy of `ccd/ccd`'s function of the same name, byte for byte. */
const isGeneratedCopy = (program: string, b: ProgramBody, ccdFns: ReadonlyMap<string, string>): boolean =>
  program !== 'ccd/ccd' && b.generated && ccdFns.get(b.name) === b.text;

/** Whether a function body is a LINE redactor: it binds a local from `$1`, carries a userinfo strip or a `$HOME` -> `~`
 *  rewrite, and prints that local back. */
function isLineRedactor(lines: ReadonlyArray<{ code: string }>): boolean {
  const code = lines.map((l) => l.code).join('\n');
  const bound = /\blocal\s+(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*([A-Za-z_][A-Za-z0-9_]*)="\$\{?1\b/.exec(code);
  if (!bound) return false;
  const v = bound[1]!;
  const strips = USERINFO_SHAPE.test(code);
  const home = /\$\{?HOME\b/.test(code) && /~["}]/.test(code);
  const prints = new RegExp(`\\bprintf '%s(?:\\\\n)?' "\\$\\{?${v}\\}?"`).test(code);
  return (strips || home) && prints;
}

/** ARCH-67's log-line redactor census: every bash function in the shipped programs that redacts a line (base: 2,
 *  `ccd/ccrc#_upd_redact` and `ccd/ccd-update-sync#redact`). A byte-equal generated copy counts zero. */
export function logLineRedactors(root: string = REPO): RedactorSite[] {
  const ccdFns = ccdFunctionTexts(root);
  const out: RedactorSite[] = [];
  for (const p of bashProgramBodies(root)) {
    for (const b of p.bodies) {
      if (!b.fn || isGeneratedCopy(p.file, b, ccdFns)) continue;
      const lines = codeLines(b, p.heredoc);
      if (isLineRedactor(lines)) out.push({ name: `${p.file}#${b.name}`, file: b.file, line: b.lines[0]!.line, text: b.lines[0]!.raw });
    }
  }
  return out;
}

/** Every userinfo strip in bash code outside a counted function (a line redactor, or a generated copy of one), one site
 *  per body (base: 1, `ccd/ccrc-doctor-checks#_check_box-settings`). A heredoc's body is not read. */
export function inlineUserinfoStrips(root: string = REPO): RedactorSite[] {
  const ccdFns = ccdFunctionTexts(root);
  const out: RedactorSite[] = [];
  for (const p of bashProgramBodies(root)) {
    for (const b of p.bodies) {
      const lines = codeLines(b, p.heredoc);
      // A counted function: a hand-written line redactor, or a generated byte-equal copy of a `ccd/ccd` function. A
      // generated body that differs from its source by one byte is neither, so its strip is a site of its own.
      if (b.fn && (isGeneratedCopy(p.file, b, ccdFns) || (!b.generated && isLineRedactor(lines)))) continue;
      const hit = lines.find((l) => USERINFO_SHAPE.test(l.code));
      if (hit) out.push({ name: `${b.fn ? p.file : b.file}#${b.name}`, file: b.file, line: hit.line, text: hit.raw });
    }
  }
  return out;
}

/** A python table of `(pattern, suffix)` pairs: `NAME = (` or `NAME = [` whose first element is a string pair. */
const PY_TABLE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*[[(]\s*\(\s*r?(['"])/;

/** ARCH-67's python rule-table census: every `PY_TABLE` assignment in ccd's shipped programs (bash heredocs and `.py`
 *  files alike) whose name the same file feeds to `re.compile` (base: 1, `ccd/ccd#_docs_py:REDACT_RULES`). A table in a
 *  bash program is named by the function its heredoc is in. */
export function pythonRedactorTables(root: string = REPO): RedactorSite[] {
  const out: RedactorSite[] = [];
  const scan = (name: (line: number) => string, file: string, lines: ReadonlyArray<{ line: number; raw: string }>, text: string): void => {
    for (const l of lines) {
      const m = PY_TABLE.exec(l.raw);
      if (!m) continue;
      const fed = new RegExp(`re\\.compile\\([^\\n]*\\bin\\s+${m[1]!}\\b|\\bfor\\b[^\\n]*\\bin\\s+${m[1]!}\\b[^\\n]*re\\.compile|re\\.compile\\([^)]*\\b${m[1]!}\\b`);
      if (fed.test(text)) out.push({ name: `${name(l.line)}:${m[1]!}`, file, line: l.line, text: l.raw });
    }
  };
  for (const p of bashProgramBodies(root)) {
    for (const b of p.bodies) {
      const text = readFileSync(path.join(root, b.file), 'utf8');
      scan(() => `${b.fn ? p.file : b.file}#${b.name}`, b.file, b.lines, text);
    }
  }
  const dir = path.join(root, 'ccd');
  const py: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d).sort()) {
      const q = path.join(d, e);
      if (statSync(q).isDirectory()) { if (e !== 'node_modules' && e !== '__pycache__') walk(q); continue; }
      if (e.endsWith('.py')) py.push(path.relative(root, q).split(path.sep).join('/'));
    }
  };
  walk(dir);
  for (const file of py) {
    const text = readFileSync(path.join(root, file), 'utf8');
    scan(() => file, file, text.split('\n').map((raw, i) => ({ line: i + 1, raw })), text);
  }
  return out;
}

// ---- C5h: what the library loader publishes, and the two redactor pins (D-7125; design note §2) ----
import { enclosingFunctions } from './ccdHelpers.js';

/** The globals whose writers and readers `loaderGlobals` reports. `__CCD_LAYOUT` and `__CCD_HASH_CMD` are what
 *  `_ccd_lib_load` decided (written there only); the two pins are written only by their top-level placeholder lines, which
 *  the installer stamps. */
export const LOADER_GLOBALS: readonly string[] = ['__CCD_LAYOUT', '__CCD_HASH_CMD', '__CCD_REDACT_SHA256', '__CCD_REDACT_CLI_SHA256'];

/** One line that writes or reads one global: its file, its enclosing function (`null` at the top level) and its text. */
export interface GlobalSite {
  readonly global: string;
  readonly file: string;
  readonly fn: string | null;
  readonly line: number;
  readonly text: string;
}

const nameRe = (n: string): string => `(?<![A-Za-z0-9_])${n}(?![A-Za-z0-9_])`;

/** Whether bash code `code` WRITES the global `n`, in any of the forms design note §2 lists: a plain, appending or indexed
 *  assignment (and `${n:=v}`); a declaration that names it (`declare`, `local`, `typeset`, `readonly`, `export`, any flags,
 *  any position, `-n` included); a builtin that writes it (`printf -v`, `read`, `mapfile`/`readarray`, `unset`); an
 *  `eval`, `source` or `.` command (at a command position) whose line names it; and an indirect expansion (`${!…}`) on a line that names it. */
export function writesGlobal(code: string, n: string): boolean {
  const w = nameRe(n);
  if (!new RegExp(w).test(code)) return false;
  return [
    new RegExp(`(?<![A-Za-z0-9_$\\{!#])${n}(?:\\[[^\\]]*\\])?\\+?=(?!=)`),
    new RegExp(`\\$\\{${n}:?=`),
    new RegExp(`(?<![A-Za-z0-9_])(?:declare|local|typeset|readonly|export)(?![A-Za-z0-9_])[^;&|]*${w}`),
    new RegExp(`(?<![A-Za-z0-9_])printf(?![A-Za-z0-9_])[^;&|]*-v\\s*['"]?${n}(?![A-Za-z0-9_])`),
    new RegExp(`(?<![A-Za-z0-9_])(?:read|mapfile|readarray|unset)(?![A-Za-z0-9_])[^;&|]*${w}`),
    new RegExp(`(?:^\\s*|[;&|({]\\s*|(?<![A-Za-z0-9_])(?:then|do|else)\\s+)(?:eval|source|\\.)\\s[^\\n]*${w}`),
    /\$\{!/,
  ].some((re) => re.test(code));
}

/** Whether bash code `code` READS the global `n` (`$n`, `${n…}`, `${#n…}`, `${!n…}`). */
export function readsGlobal(code: string, n: string): boolean {
  return new RegExp(`\\$${n}(?![A-Za-z0-9_])|\\$\\{[#!]?${n}(?![A-Za-z0-9_])`).test(code);
}

/** Every write and every read of `LOADER_GLOBALS` in the files the body evaluates: `ccd/ccd` and every `ccd/lib/*.sh`
 *  (the loader evaluates the library inside its own function scope, AFTER it publishes the layout, so a library line
 *  could rewrite it). Heredoc bodies are not bash code and are dropped; comments are stripped. */
export function loaderGlobals(root: string = REPO): { writes: GlobalSite[]; reads: GlobalSite[] } {
  const lib = path.join(root, 'ccd', 'lib');
  const files = ['ccd/ccd', ...(existsSync(lib) ? readdirSync(lib).sort().filter((e) => e.endsWith('.sh')).map((e) => `ccd/lib/${e}`) : [])];
  const writes: GlobalSite[] = [];
  const reads: GlobalSite[] = [];
  for (const file of files) {
    const src = readFileSync(path.join(root, file), 'utf8');
    const heredoc = heredocLines(src);
    const fns = enclosingFunctions(src);
    src.split('\n').forEach((raw, i) => {
      if (heredoc.has(i + 1)) return;
      const code = bashCodeOf(raw);
      for (const g of LOADER_GLOBALS) {
        const site = { global: g, file, fn: fns[i + 1] ?? null, line: i + 1, text: raw };
        if (writesGlobal(code, g)) writes.push(site);
        if (readsGlobal(code, g)) reads.push(site);
      }
    });
  }
  return { writes, reads };
}
