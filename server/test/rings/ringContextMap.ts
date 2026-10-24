/**
 * ARCH-04 (#545), stage 4. The 08-10 spec's context table ("Deciding a file's ring and context", the block between
 * its `ring-context-map` markers) read as data, and the one function that gives a file its context. The spec's
 * rules, in words: a file's context is the row that names the file itself (a file row, which may use `*` inside one
 * path segment); a file no file row names takes the row of the directory it sits under (a `dir/**` row); directory
 * rows do not nest; two file rows never name one file. Paths are relative to the package's `src/`. The contexts are
 * ARCH-34's vocabulary (`CCD_CONTEXTS`), the same ten the `ccd/contexts.tsv` manifest uses.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CCD_CONTEXTS, type CcdContext } from '../consolidationCensus.js';
import { REPO } from './walkSrc.js';

export const SPEC_FILE = 'docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md';

export type Pkg = 'server' | 'pwa';
export interface ContextRow { context: CcdContext; pkg: Pkg; pattern: string; dir: boolean }

const MARK_START = '<!-- ring-context-map:start -->';
const MARK_END = '<!-- ring-context-map:end -->';

/** The table's rows from the spec's text: one row per backtick-quoted pattern of a `server/src` or `pwa/src` cell. A
 *  cell that reads `(none)` has none. Throws on a row whose first cell names no known context, or a table that is
 *  missing: a parser that read nothing would map nothing, and a rule over nothing passes. */
export function parseContextTable(spec: string): ContextRow[] {
  const a = spec.indexOf(MARK_START);
  const b = spec.indexOf(MARK_END);
  if (a < 0 || b < a) throw new Error('the spec has no ring-context-map block');
  const out: ContextRow[] = [];
  for (const line of spec.slice(a + MARK_START.length, b).split('\n')) {
    if (!/^\|\s*(?:C\d|K)\b/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const id = /^(C\d|K)\b/.exec(cells[0] ?? '')![1]! as CcdContext;
    if (!(CCD_CONTEXTS as readonly string[]).includes(id)) throw new Error(`context table: unknown context ${id}`);
    if (cells.length !== 3) throw new Error(`context table: ${id} has ${cells.length} cells, expected 3`);
    (['server', 'pwa'] as const).forEach((pkg, i) => {
      for (const m of cells[i + 1]!.matchAll(/`([^`]+)`/g)) {
        const pattern = m[1]!;
        out.push({ context: id, pkg, pattern, dir: pattern.endsWith('/**') });
      }
    });
  }
  return out;
}

/** The table as the spec on disk holds it. */
export const readContextTable = (root: string = REPO): ContextRow[] =>
  parseContextTable(readFileSync(path.join(root, SPEC_FILE), 'utf8'));

/** True when a file row's pattern names `file` (a path relative to `src/`): `*` stands for any run of characters
 *  inside one path segment, and everything else is literal. */
export function fileRowNames(pattern: string, file: string): boolean {
  const re = pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('[^/]*');
  return new RegExp(`^${re}$`).test(file);
}

/** True when a `dir/**` row covers `file`: the file sits anywhere under that directory. */
export const dirRowCovers = (pattern: string, file: string): boolean => file.startsWith(pattern.slice(0, -2));

export interface Assignment {
  /** Each file with the one context it takes. */
  context: Map<string, CcdContext>;
  /** Files no row reaches (a new file in a directory with no row needs a file row in the same PR). */
  unmapped: string[];
  /** Files two file rows name, or that no file row names and two directory rows cover. */
  ambiguous: string[];
  /** Rows that name or cover no file: a stale row, to be deleted. */
  deadRows: string[];
  /** Directory rows where one sits under another (the spec: directory rows do not nest). */
  nested: string[];
  /** Rows of one package written twice. */
  duplicateRows: string[];
}

/** Gives every file of one package its context by the spec's rules, and lists everything that breaks them. */
export function assignContexts(pkg: Pkg, files: readonly string[], allRows: readonly ContextRow[]): Assignment {
  const rows = allRows.filter((r) => r.pkg === pkg);
  const fileRows = rows.filter((r) => !r.dir);
  const dirRows = rows.filter((r) => r.dir);
  const context = new Map<string, CcdContext>();
  const out: Assignment = { context, unmapped: [], ambiguous: [], deadRows: [], nested: [], duplicateRows: [] };
  for (const f of files) {
    const named = fileRows.filter((r) => fileRowNames(r.pattern, f));
    const covering = dirRows.filter((r) => dirRowCovers(r.pattern, f));
    const picked = named.length > 0 ? named : covering;
    if (picked.length === 0) { out.unmapped.push(f); continue; }
    if (picked.length > 1) { out.ambiguous.push(`${f}: ${picked.map((r) => `${r.context} \`${r.pattern}\``).join(' and ')}`); continue; }
    context.set(f, picked[0]!.context);
  }
  // A row is live when it names or covers a file, even one a file row outranks (a `dir/**` row whose every file has
  // a file row of its own is still the directory's default).
  for (const r of rows) {
    const reaches = files.some((f) => (r.dir ? dirRowCovers(r.pattern, f) : fileRowNames(r.pattern, f)));
    if (!reaches) out.deadRows.push(`${r.context} \`${r.pattern}\``);
  }
  for (const a of dirRows) {
    for (const b of dirRows) {
      if (a !== b && b.pattern.startsWith(a.pattern.slice(0, -2))) out.nested.push(`\`${b.pattern}\` under \`${a.pattern}\``);
    }
  }
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.pattern)) out.duplicateRows.push(`\`${r.pattern}\``);
    seen.add(r.pattern);
  }
  return out;
}
