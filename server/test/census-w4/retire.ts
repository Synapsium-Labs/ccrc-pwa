// ARCH-44's census module (D-7165, D-7174; plan 2026-10-27-consolidation-arch44-retire.md, §The census files). Its own
// module, as ARCH-43's sleep censuses (`sleep.ts`) and ARCH-42's bound-by census (`bindings.ts`) keep theirs: no series
// appends to `consolidationCensus.ts`'s tail (spec §5.1 rule 6). It imports that module's shared helpers (`CensusSite`,
// `REPO`, `sourceFiles`), never copies one, is never re-exported from it, and walks no TypeScript tree of its own: every
// query reads `scan/symbols.ts` and `scan/parse.ts` (`retireFacts`, D-7227, where a query needs a literal or a type). Its
// FIXTURE and REAL rows live in the sibling `retire.test.ts`; the REAL rows report until their series starts, and the
// ratchets go in `single-definition/late-census.test.ts`.
//
// THE FIVE QUESTIONS (C4h):
//   - `retireGateLadders`: the hand-written gate ladders of the retire executors (3 at the base; 0 after C4m);
//   - `retireActSites`: the functions composing a retire verb's argv (3, pinned exact: D-7177);
//   - `retireQueueSites`: each retire entry queued through `.queue.run(` or `retireExecutor(` (4 `queue.run` at the base);
//   - `retireQueueOwners`: the functions owning a `KeyedQueue` run of a retire entry (4 at the base; 1 after C4n, D-7203);
//   - `retireNoticeSites`: the functions writing a retire reason's feed row through `notify(` (pinned exact: D-7176).
import path from 'node:path';
import { parsedFile } from '../scan/symbols.js';
import { identifierReferences, retireFacts, type CallSite, type ParsedFile, type SymbolSpan } from '../scan/parse.js';
import { REPO, sourceFiles, type CensusSite } from '../consolidationCensus.js';

/** One site of a parsed-symbol census: the unit it was found in (`file#name`, a method by its own name), anchored on
 *  that unit's first line. */
export interface RetireSite extends CensusSite { readonly symbol: string }

const relOf = (root: string, f: string): string => path.relative(root, f).split(path.sep).join('/');
const lastName = (q: string): string => q.slice(q.lastIndexOf('.') + 1);
const CODE_UNITS: ReadonlySet<SymbolSpan['kind']> = new Set(['function', 'variable-function', 'method', 'arrow-property']);
const within = (c: { start: number; end: number }, s: { start: number; end: number }): boolean => s.start <= c.start && c.end <= s.end;
/** The innermost named code unit holding `c`, if any. */
const ownerOf = (p: ParsedFile, c: { start: number; end: number }): SymbolSpan | undefined =>
  p.symbols.filter((s) => CODE_UNITS.has(s.kind) && within(c, s)).sort((a, b) => b.start - a.start)[0];
const siteOf = (file: string, p: ParsedFile, s: SymbolSpan): RetireSite =>
  ({ file, line: s.line, text: p.text.split('\n')[s.line - 1] ?? '', symbol: `${file}#${lastName(s.name)}` });
/** The top-level functions of a file: a `function` or a function-valued `const`, never nested in another unit. */
const topLevel = (p: ParsedFile): SymbolSpan[] =>
  p.symbols.filter((s) => (s.kind === 'function' || s.kind === 'variable-function') && !s.name.includes('.'));

/** The retire act keys `ccdCan(` is asked with (`CCD_CAN`'s rows of the three destructive verbs and the loose arm). */
export const RETIRE_ACT_KEYS: readonly string[] = ['wsReclaim', 'wsExpire', 'wsCollect', 'wsCollectLoose'];

/**
 * The retire executors' gate ladders: each TOP-LEVEL function under `server/src` whose OWN body (not counting a function
 * or arrow nested inside it) calls `ccdCan(` with a literal retire act key AND calls `.isVisible(`, one site per
 * function. 3 at the base: `coord/childReclaim.ts#childReclaimOutcome`, `coord/expireArchived.ts#expireArchived`,
 * `coord/collectTempRoot.ts#collectTempRoot`. `staleArchive.ts#act` reads both with `wsArchive` and is not counted.
 * A port builder that puts the two calls in SEPARATE nested readers (arrows or methods of the literal it returns, or
 * named functions nested in it) orders nothing itself, and is not counted (the shape C4k, C4l and C4m leave behind).
 * KNOWN WIDTH: "nested" is a named unit (`scan/parse.ts`'s symbols) or a member of the function's returned or a
 * top-level const's object literal (`retireFacts`); an anonymous callback passed to a call is read as the body's own.
 */
export function retireGateLadders(root: string = REPO): RetireSite[] {
  const out: RetireSite[] = [];
  for (const f of sourceFiles(root, 'server/src')) {
    const file = relOf(root, f);
    const p = parsedFile(f);
    const facts = retireFacts(p);
    const nestedLiteralMembers = Object.values(facts.literals).flatMap((l) => l.properties)
      .filter((m) => m.kind === 'arrow' || m.kind === 'method');
    for (const fn of topLevel(p)) {
      const nested = [
        ...p.symbols.filter((s) => s !== fn && CODE_UNITS.has(s.kind) && within(s, fn)),
        ...nestedLiteralMembers.filter((m) => within(m, fn)),
      ];
      const own = (c: CallSite): boolean => within(c, fn) && !nested.some((n) => within(c, n));
      const gate = p.calls.some((c) => own(c) && c.callee === 'ccdCan' && c.args[1]?.kind === 'string'
        && RETIRE_ACT_KEYS.includes(c.args[1].text));
      const presence = p.calls.some((c) => own(c) && c.name === 'isVisible' && c.callee !== 'isVisible');
      if (gate && presence) out.push(siteOf(file, p, fn));
    }
  }
  return out;
}

/** The retire verbs' argv builders: the three destructive verbs and the loose arm, never their audits. */
const RETIRE_ARGV = /\bCCD_ARGV\.(?:wsReclaim|wsExpire|wsCollect|wsCollectLoose)\s*\(/;

/**
 * The retire act sites: each named code unit under `server/src` that passes to a `runCcd(` call either a retire verb's
 * argv (`CCD_ARGV.wsReclaim(`, `.wsExpire(`, `.wsCollect(`, `.wsCollectLoose(`) written in the call (`inline`), or an
 * identifier the same unit binds to one (`bound`), one site per unit. 3 at the base: `coord/childReclaim.ts#
 * childReclaimAct` and `coord/expireArchived.ts#expireAct` (bound), `coord/collectTempRoot.ts#collectTempRoot` (inline,
 * both collect arms). Pinned exact by count and by name (D-7177): each verb is a different ccd verb with its own token
 * and flags, so nothing merges; C4k re-points the collector's to `collectTempRootAct` (D-7200).
 * KNOWN WIDTH: an argv handed through a helper or a second variable, and a `runCcd` under another name, are not seen.
 */
export function retireActSites(root: string = REPO): RetireSite[] {
  const out: RetireSite[] = [];
  for (const f of sourceFiles(root, 'server/src')) {
    const file = relOf(root, f);
    const p = parsedFile(f);
    const seen = new Set<SymbolSpan>();
    for (const c of p.calls) {
      if (c.name !== 'runCcd') continue;
      const fn = ownerOf(p, c);
      if (fn === undefined || seen.has(fn)) continue;
      const arg = c.args[0]?.text ?? '';
      const bound = /^[A-Za-z_$][\w$]*$/.test(arg) && p.bindings.some((b) => b.name === arg && within(b, fn)
        && b.scopeStart <= c.start && c.start < b.scopeEnd && RETIRE_ARGV.test(b.init));
      if (RETIRE_ARGV.test(arg) || bound) { seen.add(fn); out.push(siteOf(file, p, fn)); }
    }
  }
  return out;
}

/** The retire executors' entries, as a caller queues them. */
export const RETIRE_ENTRIES: readonly string[] = ['reclaimChild', 'expireArchived', 'collectTempRoot'];

/** How a retire entry reached the session's queue. */
export type RetireQueueVia = 'queue.run' | 'retireExecutor';
export interface RetireQueueSite extends RetireSite { readonly via: RetireQueueVia; readonly entry: string }

const isFunctionText = (t: string): boolean => /^(?:async\s*)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/.test(t);

/**
 * The retire entries queued: one site per call of `reclaimChild(`, `expireArchived(` or `collectTempRoot(` that lies
 * inside the FUNCTION argument of a `.queue.run(` call (its second argument) or of a `retireExecutor(` call (its third),
 * nested arrows inside that argument included (the close route's `childReclaimUnlessDisabled(…, () => reclaimChild(…))`
 * counts). Each site names its file, its enclosing named unit and `via`. 4 at the base, all `queue.run`:
 * `watch.ts#execChildReclaim`, `#collectAct`, `#archivedExpiryPass`, `coord/routes.ts#childReclaimPort`; after C4n the
 * same four, `via: retireExecutor` (D-7203). A forwarder that hands the queue a function VALUE
 * (`(id, fn) => this.deps.queue.run(id, fn)`) and an audit-only job (`learnCollect`) are no sites.
 * KNOWN WIDTH: a queue under another receiver name than `….queue`, and an entry called through an alias, are not seen.
 */
export function retireQueueSites(root: string = REPO): RetireQueueSite[] {
  const out: RetireQueueSite[] = [];
  for (const f of sourceFiles(root, 'server/src')) {
    const file = relOf(root, f);
    const p = parsedFile(f);
    for (const e of p.calls) {
      if (!RETIRE_ENTRIES.includes(e.callee)) continue;
      const holder = p.calls.find((q) => q !== e && within(e, q) && (() => {
        const via = /\.queue\.run$/.test(q.callee) ? 1 : q.callee === 'retireExecutor' ? 2 : -1;
        const fnArg = via < 0 ? undefined : q.args[via];
        return fnArg !== undefined && isFunctionText(fnArg.text) && fnArg.text.includes(`${e.callee}(`);
      })());
      if (holder === undefined) continue;
      const fn = ownerOf(p, e);
      if (fn === undefined) continue;
      out.push({ ...siteOf(file, p, fn), via: holder.callee === 'retireExecutor' ? 'retireExecutor' : 'queue.run', entry: e.callee });
    }
  }
  return out;
}

/** Why a unit owns a queued retire run: (a) it has a `queue.run` site; (b) it runs a `KeyedQueue`-typed parameter whose
 *  sibling parameter is typed as a retire entry. */
export interface RetireQueueOwner extends RetireSite { readonly by: 'a' | 'b' }

const ENTRY_TYPE = /\btypeof\s+(?:reclaimChild|expireArchived|collectTempRoot)\b/;

/**
 * The owners of a `KeyedQueue` run of a retire entry (D-7203). A named unit under `server/src` owns one when (a) it holds
 * a `retireQueueSites()` site with `via: queue.run`, or (b) it is a top-level function whose body calls `<p>.run(` where
 * `<p>` is one of its parameters typed as a `KeyedQueue` (bare or inside `Pick<…>`), and one of its parameter types names
 * `typeof reclaimChild`, `typeof expireArchived` or `typeof collectTempRoot`, directly or through the type aliases and
 * type parameters declared in its file, transitively (`retireFacts`' `signatures` and `aliases`). An alias that also names
 * `typeof childReclaimUnlessDisabled` (the close route's wrapped shape, D-7228) still counts; one naming only it does not.
 * 4 at the base, all by (a); (b) reads 0. After C4n: 1, `retireExecutor.ts#retireExecutor` by (b).
 */
export function retireQueueOwners(root: string = REPO): RetireQueueOwner[] {
  const out: RetireQueueOwner[] = [];
  const byA = new Set(retireQueueSites(root).filter((s) => s.via === 'queue.run').map((s) => s.symbol));
  const seenA = new Set<string>();
  for (const s of retireQueueSites(root)) {
    if (s.via !== 'queue.run' || seenA.has(s.symbol)) continue;
    seenA.add(s.symbol);
    out.push({ file: s.file, line: s.line, text: s.text, symbol: s.symbol, by: 'a' });
  }
  for (const f of sourceFiles(root, 'server/src')) {
    const file = relOf(root, f);
    const p = parsedFile(f);
    const facts = retireFacts(p);
    /** A type text with every alias it names expanded (its right-hand side and its type parameters), transitively. */
    const expand = (text: string): string => {
      let all = text;
      const done = new Set<string>();
      for (let changed = true; changed;) {
        changed = false;
        for (const a of Object.values(facts.aliases)) {
          if (done.has(a.name) || !new RegExp(`\\b${a.name}\\b`).test(all)) continue;
          done.add(a.name);
          all += ` ${a.text} ${a.typeParams ?? ''}`;
          changed = true;
        }
      }
      return all;
    };
    for (const fn of topLevel(p)) {
      const sig = facts.signatures[fn.name];
      if (sig === undefined) continue;
      const queues = sig.paramNames.filter((n, i): n is string => n !== null && /\bKeyedQueue\b/.test(sig.params[i] ?? ''));
      if (queues.length === 0) continue;
      const entryTyped = sig.params.some((t) => t !== null && ENTRY_TYPE.test(expand(`${t} ${sig.typeParams ?? ''}`)));
      const runs = p.calls.some((c) => within(c, fn) && queues.some((q) => c.callee === `${q}.run`));
      const site = siteOf(file, p, fn);
      if (entryTyped && runs && !byA.has(site.symbol)) out.push({ ...site, by: 'b' });
    }
  }
  return out;
}

/** The retire reasons' feed titles, by constant name: child-spent's (`CHILD_RECLAIM_*_FEED_TITLE`), the switch's
 *  (`CHILD_RECLAIM_DISABLED_FEED_TITLE`), the collector's (`COLLECT_FEED_TITLE`, `COLLECT_LOOSE_FEED_TITLE`,
 *  `COLLECT_SETTING_FEED_TITLE`) and the expiry lane's private table (`FEED_TITLE`, in `coord/expireArchived.ts` only). */
const titleNamesOf = (file: string, text: string): Set<string> => {
  const names = new Set<string>(['COLLECT_FEED_TITLE', 'COLLECT_LOOSE_FEED_TITLE', 'COLLECT_SETTING_FEED_TITLE']);
  for (const m of text.matchAll(/\bCHILD_RECLAIM_\w*FEED_TITLE\b/g)) names.add(m[0]);
  if (file === 'server/src/coord/expireArchived.ts') names.add('FEED_TITLE');
  return names;
};

/**
 * The retire notice sites: each named code unit under `server/src` that calls `notify(` with a retire reason's feed
 * title, one site per unit. The title is the unit's when (i) the unit itself names a title constant (`title:
 * CHILD_RECLAIM_FEED_TITLE[o.kind]`, or a local bound to `FEED_TITLE[r.kind]` and passed as `title`), or (ii) it takes the
 * title as data and a call of it in the same file passes a title constant (`this.collectRecordFeed(coord, { …, title:
 * COLLECT_FEED_TITLE.switch, … })`). Measured at C4h's Step 0 and pinned exact (D-7176: no notice moves).
 * KNOWN WIDTH: a title passed through a second unit, or from another file, is not followed.
 */
export function retireNoticeSites(root: string = REPO): RetireSite[] {
  const out: RetireSite[] = [];
  for (const f of sourceFiles(root, 'server/src')) {
    const file = relOf(root, f);
    const p = parsedFile(f);
    const names = titleNamesOf(file, p.text);
    const refs = identifierReferences(p.text, f, names).filter((r) => r.role !== 'import');
    const seen = new Set<SymbolSpan>();
    for (const c of p.calls) {
      if (c.callee !== 'notify') continue;
      const fn = ownerOf(p, c);
      if (fn === undefined || seen.has(fn)) continue;
      const own = refs.some((r) => r.line >= fn.line && r.line <= fn.endLine);
      const name = lastName(fn.name);
      const fed = p.calls.some((k) => !within(k, fn) && (k.callee === `this.${name}` || k.callee === name)
        && k.args.some((a) => [...names].some((n) => new RegExp(`\\b${n}\\b`).test(a.text))));
      if (own || fed) { seen.add(fn); out.push(siteOf(file, p, fn)); }
    }
  }
  return out;
}
