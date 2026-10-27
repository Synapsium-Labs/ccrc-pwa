// W8's journal-chain census module (the 2026-10-26 consolidation W8 plan, Task C8-0's census split).
// The journal chain (the journal kernel and its epoch floors, ARCH-73)
// fills it with its census queries, in C8f, then C8g.
// Each query returns `CensusSite` rows the way `consolidationCensus.ts`'s own do, and it imports what it needs from
// `consolidationCensus.ts`; it never re-exports this module, so no import cycle forms, and every count a W8 PR body
// quotes comes from a named query of this module. It reads no imported value at top level (only types, and functions
// called inside a query). Its fixture and real-tree rows live in the sibling `journal.test.ts`, which the chain's
// first task creates. No other chain edits this file; a chain's first task that finds it non-empty stops and
// reports.
//
// C8f (D-7058; ARCH-73 #808, its journal half) adds three queries. It imports `REPO`, `codeOf`, `sourceFiles` and the
// `CensusSite` type from `consolidationCensus.ts`, and `parsedFile` from `scan/symbols.ts` (over `scan/parse.ts`).
// KNOWN WIDTH: `epochFloorReaders` and `journalFloorSites` are LEXICAL (`codeOf`'s comment rule, one site per code
// line): a regex or a MAX assembled from pieces, or spelled with other names, is not seen. `appendBeforeApplySites`
// reads the syntax tree: a journal reached through an alias, or a write not spelled `this.db.prepare(…)`, is not seen.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parsedFile } from '../scan/symbols.js';
import { codeOf, REPO, sourceFiles, type CensusSite } from '../consolidationCensus.js';

/** The kernel: the one file each query passes over. */
const KERNEL = 'server/src/journalKernel.ts';
/** The store whose transactions `appendBeforeApplySites` reads. */
const STORE = 'server/src/coord/store.ts';

/** Every code line under `server/src`, outside the kernel, that matches `re`: one site per line. */
const linesMatching = (root: string, re: RegExp): CensusSite[] => {
  const out: CensusSite[] = [];
  for (const f of sourceFiles(root, 'server/src')) {
    const file = path.relative(root, f).split(path.sep).join('/');
    if (file === KERNEL) continue;
    readFileSync(f, 'utf8').split('\n').forEach((text, i) => {
      if (re.test(codeOf(text))) out.push({ file, line: i + 1, text });
    });
  }
  return out;
};

/** The epoch readers: a `/"epoch":(\d+)/` regex on a code line of `server/src`, outside `journalKernel.ts`. 2 at the
 *  base (`PoolEdgeLog.maxEpoch`, `UpdateIntentLog.maxEpoch`, one body twice); 0 once both hand their text to
 *  `maxJournalEpoch`. */
export function epochFloorReaders(root: string = REPO): CensusSite[] {
  return linesMatching(root, /"epoch":\(\\d\+\)/);
}

/** The hand-written MAX(file, db) floors: a `Math.max(dbMax, fileMax)` or a `fileMax === null ? dbMax` on a code line
 *  of `server/src`, outside `journalKernel.ts`, one site per line. 3 at the base (`allocateDeviations`,
 *  `setAccountPools`, `setIntent`); 0 once each calls `journalFloor`. */
export function journalFloorSites(root: string = REPO): CensusSite[] {
  return linesMatching(root, /Math\.max\(\s*dbMax\s*,\s*fileMax\s*\)|\bfileMax\s*===\s*null\s*\?\s*dbMax\b/);
}

/** One hand-written append-before-apply ordering: the site is the journal append, `method` the store method it is in. */
export interface AppendBeforeApplySite extends CensusSite { readonly method: string }

/** A statement that writes: its first argument opens with `INSERT`, `UPDATE`, `DELETE` or `REPLACE`. */
const WRITE_SQL = /^\W*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i;
/** A journal append spelled the store's way: `log.append(`, `journal.appendGeneration(`, or `<p>.append(` for a
 *  parameter `<p>` typed `…Log` in the enclosing method's signature. */
const DIRECT_APPEND = /^(?:log\.append|journal\.appendGeneration)$/;

/** The hand-written journal-then-row orderings in `coord/store.ts`: inside a `tx(` callback, a journal append (see
 *  `DIRECT_APPEND`) followed, in the same callback, by a `this.db.prepare(` write, where the append is NOT inside an
 *  `appendThenApply(` call. One site per transaction, at its first such append. A read-only `tx()` (no append, or no
 *  write after it) passes. 4 at the base (`allocateDeviations`, `setAccountPools`, `setIntent`, `setCollectLane`). */
export function appendBeforeApplySites(root: string = REPO): AppendBeforeApplySite[] {
  const abs = path.join(root, STORE);
  let parsed;
  try { parsed = parsedFile(abs); } catch { return []; }
  const lines = parsed.text.split('\n');
  const kernelSpans = parsed.calls.filter((c) => c.name === 'appendThenApply').map((c) => [c.start, c.end] as const);
  const inKernel = (pos: number): boolean => kernelSpans.some(([s, e]) => pos >= s && pos < e);
  const methods = parsed.symbols.filter((s) => s.kind === 'method' || s.kind === 'function');
  const enclosing = (pos: number) => methods.filter((m) => pos >= m.start && pos < m.end)
    .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
  const out: AppendBeforeApplySite[] = [];
  for (const t of parsed.calls) {
    if (t.callee !== 'tx') continue;
    const inside = parsed.calls.filter((c) => c.start > t.start && c.end <= t.end);
    const m = enclosing(t.start);
    const signature = m === undefined ? '' : parsed.text.slice(m.start, parsed.text.indexOf('{', m.start));
    const isAppend = (callee: string): boolean => {
      if (DIRECT_APPEND.test(callee)) return true;
      const p = /^([A-Za-z_$][\w$]*)\.append$/.exec(callee);
      return p !== null && new RegExp(`\\b${p[1]}\\s*:\\s*[A-Za-z_$][\\w$]*Log\\b`).test(signature);
    };
    const append = inside.find((c) => isAppend(c.callee) && !inKernel(c.start)
      && inside.some((w) => w.start > c.end && w.callee === 'this.db.prepare' && WRITE_SQL.test(w.args[0]?.text ?? '')));
    if (append === undefined) continue;
    out.push({ file: STORE, line: append.line, text: lines[append.line - 1] ?? '', method: m?.name ?? '(top level)' });
  }
  return out;
}
