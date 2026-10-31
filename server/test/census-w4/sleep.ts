// ARCH-43's census module (D-7043; plan 2026-10-26-consolidation-arch43-arch72-accounts.md, §The census files). Its own
// module, as W3's questions and W8's chains keep theirs (`census-w3/`, `census-w8/`): no series appends to
// `consolidationCensus.ts`'s tail (spec §5.1 rule 6). It imports that module's shared helpers, never copies one, and is
// never re-exported from it; its fixture and real-tree rows live in the sibling `sleep.test.ts`.
import path from 'node:path';
import { parsedFile } from '../scan/symbols.js';
import { statementStartAt } from '../scan/parse.js';
import { REPO, sourceFiles, type CensusSite } from '../consolidationCensus.js';

// ARCH-43 (spec 2026-10-19 K1; plan C4a): the sleep lanes' two censuses. Both read parsed symbols (`scan/symbols.ts`, over
// `scan/parse.ts`), never a line regex, and both REPORT until their series reaches its target: `sleepVerdictLadders` 2 -> 1
// at C4b (`decideSleep`), `hibernateActSites` 2 -> 1 at C4d (one sleep executor), each pinned in the commit that reaches it.

/** One site of a parsed-symbol census: the function it was found in (`file#name`), anchored on that function's first
 *  line. */
export interface SymbolSite extends CensusSite { readonly symbol: string }

const relOf = (root: string, f: string): string => path.relative(root, f).split(path.sep).join('/');

/**
 * The sleep verdicts' hold ladders: each function under `server/src` whose body RETURNS a `hold('viewer')` call, one site
 * per function (the innermost named function holding the call). 2 at the C4a base: `server/src/stopDone.ts#stopDoneVerdict`
 * and `server/src/coord/hibernate.ts#hibernateVerdict`.
 * KNOWN WIDTH: "returns" is the text just before the call, from its statement's start, ending in `return`; a call returned
 * through a ternary, a wrapper or a variable, a `hold` under another name and a `'viewer'` built from pieces are not seen.
 */
export function sleepVerdictLadders(root: string = REPO): SymbolSite[] {
  const out: SymbolSite[] = [];
  for (const f of sourceFiles(root, 'server/src')) {
    const file = relOf(root, f);
    const p = parsedFile(f);
    const lines = p.text.split('\n');
    const seen = new Set<string>();
    for (const c of p.calls) {
      if (c.callee !== 'hold' || c.args[0]?.kind !== 'string' || c.args[0].text !== 'viewer') continue;
      if (!/\breturn\s*$/.test(p.text.slice(statementStartAt(p.text, c.start, f), c.start))) continue;
      const fn = p.symbols
        .filter((s) => (s.kind === 'function' || s.kind === 'variable-function' || s.kind === 'method' || s.kind === 'arrow-property')
          && s.start <= c.start && c.end <= s.end)
        .sort((a, b) => b.start - a.start)[0];
      if (fn === undefined || seen.has(fn.name)) continue;
      seen.add(fn.name);
      out.push({ file, line: fn.line, text: lines[fn.line - 1] ?? '', symbol: `${file}#${fn.name}` });
    }
  }
  return out;
}

/** How an act site hands its argv to `runCcd(`: written in the call, or bound first in the same body. */
export type HibernateActShape = 'inline' | 'bound';
export interface HibernateActSite extends SymbolSite { readonly shape: HibernateActShape }

const HIBERNATE_ARGV = /\bCCD_ARGV\.hibernate\s*\(/;

/**
 * The `ccd hibernate` act sites: each TOP-LEVEL function under `server/src` (a `function` or a `const` arrow, nested
 * closures included in its body) that passes to a `runCcd(` call either a `CCD_ARGV.hibernate(` expression (`inline`) or
 * an identifier the same body binds to one (`const argv = CCD_ARGV.hibernate(…)`, then `runCcd(argv)`: `bound`), one site
 * per function. A `CCD_ARGV.hibernate(` that only feeds `verbSupported(` or `ccdCan(` is a verb question, not an act, and
 * is not counted. 2 at the C4a base: `server/src/stopDoneSweep.ts#stopDonePass` (inline) and
 * `server/src/hibernateSweep.ts#actOn` (bound); a textual `runCcd(CCD_ARGV.hibernate(` query finds 1 and is not this
 * census. KNOWN WIDTH: a class method, an argv passed through a helper or a second variable, and a `runCcd` under another
 * name are not seen.
 */
export function hibernateActSites(root: string = REPO): HibernateActSite[] {
  const out: HibernateActSite[] = [];
  for (const f of sourceFiles(root, 'server/src')) {
    const file = relOf(root, f);
    const p = parsedFile(f);
    const lines = p.text.split('\n');
    for (const fn of p.symbols) {
      if (fn.name.includes('.') || (fn.kind !== 'function' && fn.kind !== 'variable-function')) continue;
      let shape: HibernateActShape | null = null;
      for (const c of p.calls) {
        if (c.name !== 'runCcd' || c.start < fn.start || c.end > fn.end) continue;
        const arg = c.args[0]?.text ?? '';
        if (HIBERNATE_ARGV.test(arg)) { shape = 'inline'; break; }
        const bound = /^[A-Za-z_$][\w$]*$/.test(arg) && p.bindings.some((b) => b.name === arg && b.start >= fn.start && b.end <= fn.end
          && b.scopeStart <= c.start && c.start < b.scopeEnd && HIBERNATE_ARGV.test(b.init));
        if (bound) shape ??= 'bound';
      }
      if (shape !== null) out.push({ file, line: fn.line, text: lines[fn.line - 1] ?? '', symbol: `${file}#${fn.name}`, shape });
    }
  }
  return out;
}
