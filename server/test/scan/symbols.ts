/**
 * D-5854 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0g; ARCH-06 (#554), the W1a slice;
 * spec 2026-10-19-ccrc-consolidation-wave-design.md §5.2). Symbol-keyed source slices for the server's test scanners.
 *
 * A literal source pin that finds its region with `indexOf` on a line of text, or ends it at the next `\n  }\n`, turns
 * red when the code it reads MOVES (into a helper, below a new method, to another indentation) with no behaviour
 * change. A slice keyed on the symbol's qualified name (`FleetWatcher.pushOne`, `buildServer`, `outer.inner`) follows
 * the code as long as the symbol keeps its name. What it cannot follow is a REWRITE: a pin over text a change rewrites
 * is re-pointed by that change, by name, in its own commit.
 *
 * Built on `scan/parse.ts` (D-5853), the one parser importer: syntax only, no type checker. `sqlStatementsIn` arrives
 * with the slice that needs it (ARCH-06's later slices).
 * KNOWN WIDTH: what `parse.ts` does not key (a computed member name, an object-literal method, a function bound through
 * `as`, a call or parentheses) is not a symbol here either; an overloaded or twice-declared name throws as ambiguous.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSource, type CallSite, type ParsedFile, type SymbolSpan } from './parse.js';

/** The repository root: a relative `file` is resolved against it (`server/src/watch.ts`). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** One symbol of one file, with its source text. */
export interface SourceSymbol extends SymbolSpan {
  file: string;
  text: string;
}

const cache = new Map<string, ParsedFile>();

/** Parse `file` (absolute, or relative to the repository root), re-reading it on every call so a fixture rewritten
 *  between two calls is seen; the parse is cached per path and text. */
export function parsedFile(file: string): ParsedFile {
  const abs = path.isAbsolute(file) ? file : path.join(REPO_ROOT, file);
  const text = readFileSync(abs, 'utf8');
  const hit = cache.get(abs);
  if (hit && hit.text === text) return hit;
  const parsed = parseSource(text, abs);
  cache.set(abs, parsed);
  return parsed;
}

/** The symbol `name` of `file`, by its qualified name. Throws, naming the symbol and the file, when there is none
 *  or more than one. */
export function symbolOf(file: string, name: string): SourceSymbol {
  const parsed = parsedFile(file);
  const found = parsed.symbols.filter((s) => s.name === name);
  if (found.length !== 1) {
    const where = path.isAbsolute(file) ? path.relative(REPO_ROOT, file) : file;
    throw new Error(found.length === 0
      ? `scan/symbols: no symbol '${name}' in ${where}`
      : `scan/symbols: '${name}' is declared ${found.length} times in ${where}`);
  }
  const s = found[0]!;
  return { ...s, file: parsed.path, text: parsed.text.slice(s.start, s.end) };
}

/** The source text of `file`'s symbol `name`, from its first token to its last (`symbolOf`'s throws apply). */
export function sourceOfSymbol(file: string, name: string): string {
  return symbolOf(file, name).text;
}

/** Every call inside `symbol`'s span, in source order, nested functions' calls included (each call keeps its own
 *  `line` in the file). */
export function callsIn(symbol: SourceSymbol): CallSite[] {
  return parsedFile(symbol.file).calls.filter((c) => c.start >= symbol.start && c.end <= symbol.end);
}
