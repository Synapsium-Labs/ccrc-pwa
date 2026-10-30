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
// C8f (D-7058; ARCH-73 #808, its journal half) adds four queries. It imports `REPO`, `esc`, `sitesOf` and the
// `CensusSite` type from `consolidationCensus.ts`, and `parsedFile` from `scan/symbols.ts` (over `scan/parse.ts`).
// KNOWN WIDTH: `epochFloorReaders` and `journalFloorSites` are LEXICAL (`codeOf`'s comment rule, one site per code
// line): a regex or a MAX assembled from pieces, or spelled with other names, is not seen. `appendBeforeApplySites` and
// `appendThenApplyBreaks` read the syntax tree: a journal reached through an alias, a write not spelled
// `this.db.prepare(…)`, or a transaction not spelled `tx(…)`, is not seen.
//
// C8g (D-7059; ARCH-73 #808, spec K17's first and second bullets) adds two: `journalFramers` and
// `delegationKernelImports`, both over the syntax tree. KNOWN WIDTH: a framer spelled other than a `split` or
// `lastIndexOf` call whose first argument is a newline (a `'\n'` string or a regex naming `\n`), a separator held in a
// variable, or framing in a file outside the four the query names, is not seen.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { parsedFile } from '../scan/symbols.js';
import type { CallSite, ParsedFile } from '../scan/parse.js';
import { esc, REPO, sitesOf, type CensusSite } from '../consolidationCensus.js';

/** The kernel: the one file each lexical query passes over. */
const KERNEL = 'server/src/journalKernel.ts';
/** The store whose transactions the two syntax-tree queries read. */
const STORE = 'server/src/coord/store.ts';

/** `sitesOf` over `server/src`, outside the kernel, one site per code line however many matches it holds. */
const linesMatching = (root: string, re: RegExp): CensusSite[] => {
  const seen = new Set<string>();
  return sitesOf(root, ['server/src'], re, (rel) => rel === KERNEL).filter((s) => {
    const key = `${s.file}\n${s.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** The epoch readers: a `/"epoch":(\d+)/` regex on a code line of `server/src`, outside `journalKernel.ts`. 2 at the
 *  base (`PoolEdgeLog.maxEpoch`, `UpdateIntentLog.maxEpoch`, one body twice); 0 once both hand their text to
 *  `maxJournalEpoch`. */
export function epochFloorReaders(root: string = REPO): CensusSite[] {
  return linesMatching(root, /"epoch":\(\\d\+\)/g);
}

/** The hand-written MAX(file, db) floors: a `Math.max(dbMax, fileMax)` or a `fileMax === null ? dbMax` on a code line
 *  of `server/src`, outside `journalKernel.ts`, one site per line. 3 at the base (`allocateDeviations`,
 *  `setAccountPools`, `setIntent`); 0 once each calls `journalFloor`. */
export function journalFloorSites(root: string = REPO): CensusSite[] {
  return linesMatching(root, /Math\.max\(\s*dbMax\s*,\s*fileMax\s*\)|\bfileMax\s*===\s*null\s*\?\s*dbMax\b/g);
}

/** One site in `coord/store.ts`, with the store method it is in. */
export interface StoreJournalSite extends CensusSite { readonly method: string }
/** One hand-written append-before-apply ordering: the site is the journal append. */
export type AppendBeforeApplySite = StoreJournalSite;
/** One `appendThenApply(` call that breaks the order it exists to keep, and why. */
export interface AppendThenApplyBreak extends StoreJournalSite {
  readonly why: 'outside-tx' | 'write-before-append' | 'no-append';
}

/** A statement that writes: its first argument opens with `INSERT`, `UPDATE`, `DELETE` or `REPLACE`. */
const WRITE_SQL = /^\W*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i;
/** A journal append spelled the store's way: `log.append(`, `journal.appendGeneration(`, or `<p>.append(` for a name
 *  `<p>` typed `…Log` in the enclosing method (its parameter list, in practice). */
const DIRECT_APPEND = /^(?:log\.append|journal\.appendGeneration)$/;

/** The store's parse with the three predicates both syntax-tree queries share; `null` when the tree has no store. */
const storeFacts = (root: string): {
  parsed: ParsedFile; lines: string[]; methodOf: (pos: number) => string;
  isAppend: (c: CallSite) => boolean; isWrite: (c: CallSite) => boolean;
} | null => {
  let parsed: ParsedFile;
  try { parsed = parsedFile(path.join(root, STORE)); } catch { return null; }
  const methods = parsed.symbols.filter((s) => s.kind === 'method' || s.kind === 'function')
    .sort((a, b) => (a.end - a.start) - (b.end - b.start));
  const enclosing = (pos: number) => methods.find((m) => pos >= m.start && pos < m.end);
  return {
    parsed,
    lines: parsed.text.split('\n'),
    methodOf: (pos) => enclosing(pos)?.name ?? '(top level)',
    isAppend: (c) => {
      if (DIRECT_APPEND.test(c.callee)) return true;
      const p = /^([A-Za-z_$][\w$]*)\.append$/.exec(c.callee);
      const m = enclosing(c.start);
      return p !== null && m !== undefined
        && new RegExp(`(?:^|[^\\w$])${esc(p[1]!)}\\s*:\\s*[A-Za-z_$][\\w$]*Log\\b`).test(parsed.text.slice(m.start, m.end));
    },
    isWrite: (c) => c.callee === 'this.db.prepare' && WRITE_SQL.test(c.args[0]?.text ?? ''),
  };
};

const within = (outer: CallSite) => (c: CallSite): boolean => c.start > outer.start && c.end <= outer.end;

/** The hand-written journal-then-row orderings in `coord/store.ts`: inside a `tx(` callback, a journal append (see
 *  `DIRECT_APPEND`) followed, in the same callback, by a `this.db.prepare(` write, where the append is NOT inside an
 *  `appendThenApply(` call (`appendThenApplyBreaks` reads those). One site per transaction, at its first such append.
 *  A read-only `tx()` (no append, or no write after it) passes. 4 at the base (`allocateDeviations`,
 *  `setAccountPools`, `setIntent`, `setCollectLane`); 0 once each writer calls `appendThenApply`. */
export function appendBeforeApplySites(root: string = REPO): AppendBeforeApplySite[] {
  const f = storeFacts(root);
  if (f === null) return [];
  const kernelCalls = f.parsed.calls.filter((c) => c.name === 'appendThenApply');
  const inKernel = (c: CallSite): boolean => kernelCalls.some((k) => within(k)(c));
  const out: AppendBeforeApplySite[] = [];
  for (const t of f.parsed.calls) {
    if (t.callee !== 'tx') continue;
    const inside = f.parsed.calls.filter(within(t));
    const append = inside.find((c) => f.isAppend(c) && !inKernel(c) && inside.some((w) => w.start > c.end && f.isWrite(w)));
    if (append === undefined) continue;
    out.push({ file: STORE, line: append.line, text: f.lines[append.line - 1] ?? '', method: f.methodOf(append.start) });
  }
  return out;
}

/** The `appendThenApply(` calls in `coord/store.ts` that do not keep the kernel's order: one called outside every
 *  `tx(` callback (`outside-tx`: the kernel opens no transaction, so its rows would autocommit one by one), one where a
 *  `this.db.prepare(` write precedes the step's first journal append in source order (`write-before-append`: a row
 *  written in `decide`, or an append placed after a write in `apply`), and one with no journal append this census can
 *  see (`no-append`: an append it cannot read is an order it cannot judge). 0 at C8f's tip. */
export function appendThenApplyBreaks(root: string = REPO): AppendThenApplyBreak[] {
  const f = storeFacts(root);
  if (f === null) return [];
  const txs = f.parsed.calls.filter((c) => c.callee === 'tx');
  const out: AppendThenApplyBreak[] = [];
  for (const k of f.parsed.calls) {
    if (k.name !== 'appendThenApply') continue;
    const site = { file: STORE, line: k.line, text: f.lines[k.line - 1] ?? '', method: f.methodOf(k.start) };
    if (!txs.some((t) => within(t)(k))) out.push({ ...site, why: 'outside-tx' });
    const inside = f.parsed.calls.filter(within(k));
    const append = inside.find((c) => f.isAppend(c));
    if (append === undefined) { out.push({ ...site, why: 'no-append' }); continue; }
    if (inside.some((w) => f.isWrite(w) && w.start < append.start)) out.push({ ...site, why: 'write-before-append' });
  }
  return out;
}

/** The files the lifecycle mirror and the collect-lane journal frame NDJSON in, and (for `collectLane.ts`) the one
 *  function there whose text is journal text: the rest of that file splits other strings (a refusal's stderr). */
const FRAMER_SCOPES: readonly { readonly file: string; readonly fn?: string }[] = [
  { file: 'server/src/coord/mirrorplan.ts' },
  { file: 'server/src/coord/journalparse.ts' },
  { file: 'server/src/collectLane.ts', fn: 'parseCollectLaneJournal' },
  { file: 'server/src/coord/collectLaneJournal.ts' },
];

/** A call that frames on a newline: `split(…)` or `lastIndexOf(…)` whose first argument is the string `\n` or a regex
 *  literal naming `\n`. */
const isNewlineFrame = (c: CallSite): boolean => {
  if (c.name !== 'split' && c.name !== 'lastIndexOf') return false;
  const a = c.args[0];
  return a !== undefined && ((a.kind === 'string' && a.text === '\n') || (a.kind === 'regex' && a.text.includes('\\n')));
};

/** One hand-rolled framing call, with the function it is in. */
export type JournalFramerSite = StoreJournalSite;

/** The hand-rolled NDJSON framers of the two journals: a `split('\n')` or `lastIndexOf('\n')` call (see
 *  `isNewlineFrame`) in `coord/mirrorplan.ts`, `coord/journalparse.ts`, `collectLane.ts#parseCollectLaneJournal` or
 *  `coord/collectLaneJournal.ts`, outside `journalKernel.ts` (which is none of them). 3 sites in 2 framers at the base
 *  (`frameRead`'s `lastIndexOf` and `split`, `parseCollectLaneJournal`'s `split`); 0 once both call
 *  `splitJournalRecords`. A file the tree lacks is passed over. */
export function journalFramers(root: string = REPO): JournalFramerSite[] {
  const out: JournalFramerSite[] = [];
  for (const scope of FRAMER_SCOPES) {
    let parsed: ParsedFile;
    try { parsed = parsedFile(path.join(root, scope.file)); } catch { continue; }
    const fns = parsed.symbols.filter((x) => x.kind === 'function' || x.kind === 'method' || x.kind === 'arrow-property')
      .sort((a, b) => (a.end - a.start) - (b.end - b.start));
    const span = scope.fn === undefined ? null : parsed.symbols.find((x) => x.name === scope.fn) ?? null;
    if (scope.fn !== undefined && span === null) continue;
    const lines = parsed.text.split('\n');
    for (const c of parsed.calls) {
      if (!isNewlineFrame(c)) continue;
      if (span !== null && !(c.start >= span.start && c.end <= span.end)) continue;
      const method = fns.find((m) => c.start >= m.start && c.start < m.end)?.name ?? '(top level)';
      out.push({ file: scope.file, line: c.line, text: lines[c.line - 1] ?? '', method });
    }
  }
  return out;
}

/** The imports of `journalKernel.ts` from a `server/src/coord/delegation-*.ts` file: the delegation journal is an
 *  authority, not a projection (spec §3.19), and shares nothing with the kernel. One row per import edge. */
export function delegationKernelImports(root: string = REPO): CensusSite[] {
  const dir = path.join(root, 'server/src/coord');
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const out: CensusSite[] = [];
  for (const name of names.filter((n) => /^delegation-.*\.ts$/.test(n)).sort()) {
    const file = `server/src/coord/${name}`;
    const parsed = parsedFile(path.join(root, file));
    const lines = parsed.text.split('\n');
    for (const e of parsed.imports) {
      if (!/(?:^|\/)journalKernel(?:\.[cm]?[jt]s)?$/.test(e.specifier)) continue;
      out.push({ file, line: e.line, text: lines[e.line - 1] ?? '' });
    }
  }
  return out;
}
