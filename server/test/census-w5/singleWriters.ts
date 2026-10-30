// W5's non-account single-writer census (D-7071; ARCH-72, Task C5d; plan 2026-10-27-consolidation-w5-ccd-helpers.md;
// spec K16). This plan's own module for ARCH-72's two non-account facts (no series appends to `consolidationCensus.ts`,
// D-7043); it imports that file's helpers, `scan/parse.ts` (through which every `server/src` source assertion goes) and
// `accountMarkers.ts`'s program readers, and is never re-exported from `consolidationCensus.ts`. Its FIXTURE and REAL
// rows live in the sibling `singleWriters.test.ts`. C5j takes `ccdVerbsWriters()` 3 -> 1; C5k (OA-C13 ruled (b)) pins
// `usageSidecarDeleters()`'s two by name, may only shrink.
//
// KNOWN WIDTH. `ccdVerbsWriters` reads each `.ccdVerbs` member reference the parser finds and counts it a writer when the
// text after it on its line is a plain `=` (not `==`, `===` or `=>`); a write through a destructure, `Object.assign`, an
// alias of the state object or a computed member is not seen. An initialiser is a `ccdVerbs: null` property (optionally
// `as …`) in an object literal; one with another value is not seen. `usageSidecarDeleters` reads bash `rm` commands
// whose operand names `usage/`, and python bodies that remove a path joined under `"usage"`; a removal through another
// tool, or of a path assembled out of sight, is not seen.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { bashCodeOf, REPO, sourceFiles } from '../consolidationCensus.js';
import { identifierReferences, parseSource } from '../scan/parse.js';
import { bashBodies, ccdProgramBodies, maskQuoted, shippedBashPrograms, type ProgramBody } from './accountMarkers.js';

/** One site: `name` is `<file>#<symbol>`; `file` is repo-relative; `line` 1-based. */
export interface WriterSite { readonly name: string; readonly file: string; readonly line: number; readonly text: string }

/** The `server/src` writers and initialisers of `FleetState.ccdVerbs` (base: 3 writers, `remote/client.ts#onReady`,
 *  `refreshcaps.ts#makeRefreshCaps` and the local-mode closure in `index.ts`; 2 initialisers). A writer is named by its
 *  innermost enclosing symbol (`(module)` when none). */
export function ccdVerbsWriters(root: string = REPO): { writers: WriterSite[]; initialisers: WriterSite[] } {
  const writers: WriterSite[] = [];
  const initialisers: WriterSite[] = [];
  for (const abs of sourceFiles(root, 'server/src')) {
    const rel = path.relative(path.join(root, 'server/src'), abs).split(path.sep).join('/');
    const text = readFileSync(abs, 'utf8');
    if (!text.includes('ccdVerbs')) continue;
    const lines = text.split('\n');
    const symbols = parseSource(text, abs).symbols;
    const symbolAt = (line: number): string => {
      const s = symbols.filter((x) => x.line <= line && x.endLine >= line).sort((a, b) => (a.endLine - a.line) - (b.endLine - b.line))[0];
      return s ? s.name.slice(s.name.lastIndexOf('.') + 1) : '(module)';
    };
    const seen = new Set<number>();
    for (const r of identifierReferences(text, abs, new Set(['ccdVerbs']))) {
      const t = lines[r.line - 1] ?? '';
      if (/\.ccdVerbs$/.test(r.context) && /\.ccdVerbs\s*=(?![=>])/.test(t) && !seen.has(r.line)) {
        seen.add(r.line);
        writers.push({ name: `${rel}#${symbolAt(r.line)}`, file: `server/src/${rel}`, line: r.line, text: t });
      } else if (/^ccdVerbs\s*:\s*null(?:\s+as\s+[^,}]+)?$/.test(r.context.trim())) {
        initialisers.push({ name: `${rel}#${symbolAt(r.line)}`, file: `server/src/${rel}`, line: r.line, text: t });
      }
    }
  }
  return { writers, initialisers };
}

/** The shipped bash bodies under `ccd/` (ccd with its library, every other bash program, and the `.sh` files). */
function shellBodies(root: string): Array<{ program: string; body: ProgramBody }> {
  const out: Array<{ program: string; body: ProgramBody }> = [];
  const dir = path.join(root, 'ccd');
  const sh = existsSync(dir) ? readdirSync(dir).sort().filter((e) => e.endsWith('.sh') && statSync(path.join(dir, e)).isFile()).map((e) => `ccd/${e}`) : [];
  for (const file of [...shippedBashPrograms(root), ...sh]) {
    const bodies = file === 'ccd/ccd' ? ccdProgramBodies(root)
      : bashBodies(readFileSync(path.join(root, file), 'utf8')).map((b) => ({ ...b, file }));
    for (const body of bodies) out.push({ program: file, body });
  }
  return out;
}

/** The python bodies (`def` blocks) of every `.py` file under `ccd/`, by indentation. */
function pythonDefs(root: string): Array<{ file: string; name: string; line: number; lines: string[] }> {
  const out: Array<{ file: string; name: string; line: number; lines: string[] }> = [];
  const dir = path.join(root, 'ccd');
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir).sort()) {
    if (!e.endsWith('.py')) continue;
    const rel = `ccd/${e}`;
    const lines = readFileSync(path.join(dir, e), 'utf8').split('\n');
    lines.forEach((l, i) => {
      const m = /^(\s*)def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(l);
      if (!m) return;
      const ind = m[1]!.length;
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const t = lines[j]!;
        if (t.trim() !== '' && (t.length - t.trimStart().length) <= ind) break;
        body.push(t);
      }
      out.push({ file: rel, name: m[2]!, line: i + 1, lines: body });
    });
  }
  return out;
}

/** ARCH-72's usage-sidecar deleters (base: 2, `ccd/ccd#_usage_purge` and `ccd/ccd-usage-sweep.py#reap_orphans`); a writer
 *  removing its own staged temp (an `rm` of a `$usage…tmp` variable it also `mv`s into place) is reported apart. */
export function usageSidecarDeleters(root: string = REPO): { deleters: WriterSite[]; stagedTempCleanup: WriterSite[] } {
  const deleters: WriterSite[] = [];
  const stagedTempCleanup: WriterSite[] = [];
  for (const { program, body } of shellBodies(root)) {
    const name = `${body.fn ? program : body.file}#${body.name}`;
    let del: WriterSite | null = null;
    let staged: WriterSite | null = null;
    for (const l of body.lines) {
      const code = maskQuoted(bashCodeOf(l.raw), /[;&|()<>`]/);
      for (const seg of code.split(/;|&&|\|\||\||\{|\}/)) {
        const m = /(?:^|\s)rm\s+((?:-[A-Za-z-]+\s+)*)(.*)$/.exec(seg);
        if (!m) continue;
        const ops = m[2]!;
        if (/usage\//.test(ops)) del ??= { name, file: body.file, line: l.line, text: l.raw };
        else if (/\$\{?usage[A-Za-z0-9_]*tmp\b/.test(ops)) staged ??= { name, file: body.file, line: l.line, text: l.raw };
      }
    }
    if (del) deleters.push(del);
    if (staged) stagedTempCleanup.push(staged);
  }
  for (const d of pythonDefs(root)) {
    const text = d.lines.join('\n');
    if (!/os\.path\.join\([^)]*["']usage["']/.test(text)) continue;
    const at = d.lines.findIndex((l) => /\b(?:os\.remove|os\.unlink|os\.rmdir|shutil\.rmtree)\s*\(/.test(l));
    if (at >= 0) deleters.push({ name: `${d.file}#${d.name}`, file: d.file, line: d.line + 1 + at, text: d.lines[at]! });
  }
  return { deleters, stagedTempCleanup };
}
