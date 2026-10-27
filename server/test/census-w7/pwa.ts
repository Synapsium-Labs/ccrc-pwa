// W7's PWA census (D-7179; Task C7a; plan docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, §What the
// measurement found items 1 to 18; ARCH-28, -29, -49, -53 follow-up, -58, -61, -64, -75; spec §5.1 rules 1 and 3).
// W7's own module, as W3's, W5's and W8's are (§The census files): no W7 task appends to `consolidationCensus.ts`.
// Every query is read from the syntax tree through `scan/parse.ts` (the one parser importer), over the files
// `rings/walkSrc.ts` lists, and every one REPORTS: `pwa.test.ts` prints each query's sites by file and symbol and holds
// today's count as a floor-and-ceiling pair (two band rows, D-7221). The may-only-shrink ratchets land later, in
// `rings/pwa-one-owner.test.ts`, in the commit that reaches each count (spec §5.1 rule 3); this file adds none.
// KNOWN WIDTH, every query below: syntax only, no type checker. A member reached through a computed name, an alias, a
// destructured binding or a re-export is not seen; a site is attributed to its innermost enclosing symbol as
// `scan/parse.ts` keys symbols (an object-literal method or an arrow passed straight to a call is not a symbol, so its
// sites belong to the symbol around it); a file that does not parse yields what the parser recovered.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { identifierReferences, parseSource, stringExpressions, type CallSite, type Comparison, type ParsedFile } from '../scan/parse.js';
import { parsedFile } from '../scan/symbols.js';
import { REPO, walkSrc } from '../rings/walkSrc.js';

/** One counted site: the repo-relative file, its innermost enclosing symbol (`(module)` at top level), its 1-based line,
 *  the counted source text, and the query's own kind tag where it has more than one kind of site. */
export interface W7Site {
  readonly file: string;
  readonly symbol: string;
  readonly line: number;
  readonly text: string;
  readonly kind: string;
}

/** The PWA's sources: every `.ts`/`.tsx` under `pwa/src` (tests and stories are not sources, `walkSrc`'s rule). */
export const pwaSources = (): string[] => walkSrc({ roots: ['pwa/src'], min: 300, match: /\.tsx?$/ });

const lineStart = (text: string, line: number): string => text.split('\n')[line - 1] ?? '';

/** The innermost symbol of `p` whose span holds `[start, end)`, by qualified name; `(module)` when none does. */
export function enclosingSymbol(p: ParsedFile, start: number, end: number = start): string {
  let best: { name: string; size: number } | null = null;
  for (const s of p.symbols) {
    if (s.start <= start && end <= s.end && (best === null || s.end - s.start < best.size)) best = { name: s.name, size: s.end - s.start };
  }
  return best?.name ?? '(module)';
}

/** The outermost (top-level) symbol name holding `start`: the component or function a reader would name. */
export const topSymbol = (p: ParsedFile, start: number): string => enclosingSymbol(p, start).split('.')[0]!;

const site = (p: ParsedFile, file: string, start: number, line: number, text: string, kind = ''): W7Site =>
  ({ file, symbol: enclosingSymbol(p, start), line, text, kind });

const callSite = (p: ParsedFile, file: string, c: CallSite, kind = ''): W7Site =>
  site(p, file, c.start, c.line, p.text.slice(c.start, c.end).replace(/\s*\n\s*/g, ' ').slice(0, 140), kind);

const cmpSite = (p: ParsedFile, file: string, c: Comparison, kind = ''): W7Site => site(p, file, c.start, c.line, c.text.slice(0, 140), kind);

/** Run one per-file query over every PWA source. */
const overPwa = (q: (p: ParsedFile, file: string) => W7Site[]): W7Site[] => pwaSources().flatMap((rel) => q(parsedFile(rel), rel));

/** Parse a fixture source (`file` names its extension, so `.tsx` parses JSX). */
export const fixture = (text: string, file = 'pwa/src/fixture.tsx'): ParsedFile => parseSource(text, file);

// ─── 1. /api/accounts readers (ARCH-28, C7b) ───────────────────────────────────────────────────────────────────────

/** A call whose callee is exactly `api.accounts` (`api.accounts()`, `void api.accounts().then(…)`), one site per call.
 *  5 on the base (the store's `fetchAccounts` default, `AccountsStrip`, `useProjectedHome`, `useAccountUsage`,
 *  `useAccountsPoll`); 1 on #1720's head (the store's). KNOWN WIDTH: a member reference that is not called
 *  (`load = api.accounts`) is not a call and is not counted (none on the base, plan item 15). */
export function accountsReadersIn(p: ParsedFile, file: string): W7Site[] {
  return p.calls.filter((c) => c.callee === 'api.accounts').map((c) => callSite(p, file, c));
}
export const accountsReaders = (): W7Site[] => overPwa(accountsReadersIn);

// ─── 2. inline dead checks and coordPresence (ARCH-49, C7c) ────────────────────────────────────────────────────────

const DEAD_OPERAND = /^(?:'dead'|"dead"|`dead`)\s*(?:===|!==|==|!=)|(?:===|!==|==|!=)\s*(?:'dead'|"dead"|`dead`)$/;

/** A dead check: an equality comparison one of whose operands has the leaf name `status` (`s.status`, `session!.status`,
 *  a bare `status`) and the other is the literal `'dead'`. 16 on the base, in 9 files (plan item 2). Comments are not
 *  code, so they never count; `s.bucket === 'dead'`, `st === 'dead'` and `presence === 'dead'` are not `status` leaves
 *  (`hibernate-census.test.ts` counts those). KNOWN WIDTH: a `switch (s.status) { case 'dead': }` is not a comparison. */
export function inlineDeadChecksIn(p: ParsedFile, file: string): W7Site[] {
  return p.comparisons.filter((c) => (c.leftLeaf === 'status' || c.rightLeaf === 'status') && DEAD_OPERAND.test(c.text))
    .map((c) => cmpSite(p, file, c));
}
export const inlineDeadChecks = (): W7Site[] => overPwa(inlineDeadChecksIn);

/** `coordPresence`'s definition (a symbol of that name, kind `definition`) and its calls (kind `call`), and each
 *  comparison of a value bound from a `coordPresence(…)` call with `'dead'` (kind `answer-dead`). 1 definition, 3 calls
 *  (`orphanNote`, `RunRow`, `SessionScreen`), 2 answer comparisons on the base (plan item 2). KNOWN WIDTH: an answer
 *  compared inline (`coordPresence(r) === 'dead'`) is counted as a call only. */
export function coordPresenceSitesIn(p: ParsedFile, file: string): W7Site[] {
  const out: W7Site[] = [];
  for (const s of p.symbols) if (s.name.split('.').pop() === 'coordPresence') out.push({ file, symbol: s.name, line: s.line, text: lineStart(p.text, s.line).trim().slice(0, 140), kind: 'definition' });
  // An answer is the NAME a `coordPresence(…)` call is bound to, read file-wide: `orphanWords.ts` binds `presence` in
  // `orphanNote` and compares it in `orphanGuidance`, which it hands the answer to under the same name.
  const bound = new Set<string>();
  for (const c of p.calls) {
    if (c.name !== 'coordPresence') continue;
    out.push(callSite(p, file, c, 'call'));
    if (c.boundTo !== null) bound.add(c.boundTo);
  }
  for (const c of p.comparisons) {
    if (/'dead'|"dead"/.test(c.text) && ((c.leftLeaf !== null && bound.has(c.leftLeaf)) || (c.rightLeaf !== null && bound.has(c.rightLeaf)))) out.push(cmpSite(p, file, c, 'answer-dead'));
  }
  return out.sort((a, b) => a.line - b.line);
}
export const coordPresenceSites = (): W7Site[] => overPwa(coordPresenceSitesIn);

// ─── 3. run matchers (ARCH-61, C7d) ────────────────────────────────────────────────────────────────────────────────

const RUN_SIDE = new Set(['sessionId', 'claimedBy']);
const RUN_KEY = /\.(?:sessionId|claimedBy)$/;

/** The run-to-session matchers (plan item 3), by kind:
 *  - `comparison`: an equality comparison between a `sessionId` or `claimedBy` leaf and an `id` leaf, neither operand
 *    absent (4 on the base). `ev.sessionId !== ''` (no `id` leaf) and `r.claimedBy !== r.sessionId` (a run compared with
 *    itself) are not matchers;
 *  - `lookup`: a `.get(…)` call (any receiver) whose one argument is a member expression ending in `.sessionId` or
 *    `.claimedBy`, the run-to-session map lookup where #746's recycled-id hazard lives (7 on the base); a `get` keyed on a
 *    session's own `id` is not one;
 *  - `runForSession` and `childRunsSeen`: each call of the two named readers (7 and 1 on the base).
 *  KNOWN WIDTH: the receiver of a lookup is not typed, so a `.get(ev.sessionId)` on a non-run event would count (none
 *  on the base); a comparison through a renamed local is not seen. */
export function runMatchersIn(p: ParsedFile, file: string): W7Site[] {
  const out: W7Site[] = [];
  for (const c of p.comparisons) {
    if (c.absent) continue;
    const l = c.leftLeaf, r = c.rightLeaf;
    if ((l !== null && RUN_SIDE.has(l) && r === 'id') || (r !== null && RUN_SIDE.has(r) && l === 'id')) out.push(cmpSite(p, file, c, 'comparison'));
  }
  for (const c of p.calls) {
    if (c.name === 'get' && c.callee.endsWith('.get') && c.args.length === 1 && c.args[0]!.kind === 'other' && RUN_KEY.test(c.args[0]!.text)) out.push(callSite(p, file, c, 'lookup'));
    else if (c.name === 'runForSession' || c.name === 'childRunsSeen') out.push(callSite(p, file, c, c.name));
  }
  return out.sort((a, b) => a.line - b.line);
}
export const runMatchers = (): W7Site[] => overPwa(runMatchersIn);

// ─── 4. hand-written request polls (ARCH-30's remainder, C7b and C7m) ──────────────────────────────────────────────

/** A `setInterval(…)` call whose enclosing symbol also calls an `api.*` member, in a file outside `pwa/src/lib/usePoll.ts`
 *  and `pwa/src/stores/`, read through its HANDLER (slug request-poll-handler): the `api.*` call must sit in the function
 *  the interval runs (a named function of the enclosing symbol, or the inline arrow), so a clock tick beside a request
 *  in the same component (`LinearSection`'s `setNow` tick) is not a request poll; a handler the symbol does not define
 *  falls back to the whole enclosing symbol. 6 on the base (`AccountsStrip`,
 *  `useProjectedHome`, `useAccountUsage`, `useAccountsPoll`, `HotFilesStrip`, `useFleetHealth`); 2 on #1720's head.
 *  `main.tsx`'s update check and `LinearSection`'s clock tick call no `api.*` member and are not request polls.
 *  KNOWN WIDTH: a poll whose request is made in another symbol (a loader passed in) is not seen. */
export function requestPollsIn(p: ParsedFile, file: string): W7Site[] {
  if (file.endsWith('pwa/src/lib/usePoll.ts') || file.includes('pwa/src/stores/')) return [];
  const out: W7Site[] = [];
  const callsApi = (from: number, to: number): boolean => p.calls.some((d) => d.start >= from && d.end <= to && d.head === 'api' && d.callee.startsWith('api.'));
  for (const c of p.calls) {
    if (c.callee !== 'setInterval') continue;
    const name = enclosingSymbol(p, c.start, c.end);
    const sym = p.symbols.find((s) => s.name === name);
    if (sym === undefined) continue;
    const h = c.args[0];
    // The handler: a named function of the enclosing symbol (`setInterval(load, …)` → `<symbol>.load`), else the call's
    // own text (an inline arrow), else the whole enclosing symbol (a handler bound elsewhere).
    const named = h !== undefined && /^[A-Za-z_$][\w$]*$/.test(h.text) ? p.symbols.find((s) => s.name === `${name}.${h.text}`) : undefined;
    const inline = h !== undefined && /^(?:async\s*)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)/.test(h.text);
    const counted = named !== undefined ? callsApi(named.start, named.end) : inline ? callsApi(c.start, c.end) : callsApi(sym.start, sym.end);
    if (counted) out.push(callSite(p, file, c));
  }
  return out;
}
export const requestPolls = (): W7Site[] => overPwa(requestPollsIn);

// ─── 5. answer paths and DialogSheet's states (ARCH-29, C7e) ───────────────────────────────────────────────────────

/** The notification's answer handler, a classic script outside `walkSrc`'s `pwa/src` set. */
export const PUSH_SW = 'pwa/public/push-sw.js';
const GEN_BEGIN = '// ccrc:generated answer-lifecycle BEGIN';
const GEN_END = '// ccrc:generated answer-lifecycle END';
const ANSWER_MEMBER = /^api\.answer[A-Z]\w*$/;

/** The answer paths (plan item 5), one site per path, by kind:
 *  - `writer`: a top-level `pwa/src` symbol that calls an `api.answer*` member or `api.interrupt(…, 'deny')` (one site per
 *    symbol, at its first such call): `DialogSheet` on the base;
 *  - `busy`: a top-level `pwa/src` symbol that binds `busy` from an `answering` flag (its own in-flight composition):
 *    `EnvelopeSheet` on the base;
 *  - `push-sw`: each `fetch(…)` call in `pwa/public/push-sw.js` whose URL argument ends `/ask`, outside the text between
 *    the `// ccrc:generated answer-lifecycle BEGIN`/`END` markers (absent on the base, which counts its one handler).
 *  3 on the base. KNOWN WIDTH: an answer request through a wrapper of another name is not seen. */
export function answerPathsIn(p: ParsedFile, file: string): W7Site[] {
  const out: W7Site[] = [];
  if (file.endsWith('.js')) {
    const b = p.text.indexOf(GEN_BEGIN);
    const e = b < 0 ? -1 : p.text.indexOf(GEN_END, b);
    for (const c of p.calls) {
      if (c.callee !== 'fetch' || c.args.length === 0) continue;
      if (b >= 0 && e >= 0 && c.start > b && c.start < e) continue;
      if (/\/ask['"`]$/.test(c.args[0]!.text) || (c.args[0]!.kind === 'string' && c.args[0]!.text.endsWith('/ask'))) out.push(callSite(p, file, c, 'push-sw'));
    }
    return out;
  }
  const writers = new Set<string>();
  for (const c of p.calls) {
    const writes = ANSWER_MEMBER.test(c.callee) || (c.callee === 'api.interrupt' && c.args[1]?.kind === 'string' && c.args[1].text === 'deny');
    if (!writes) continue;
    const top = topSymbol(p, c.start);
    if (writers.has(top)) continue;
    writers.add(top);
    out.push({ ...callSite(p, file, c, 'writer'), symbol: top });
  }
  for (const b of p.bindings) {
    if (b.name === 'busy' && /\banswering\b/.test(b.init)) out.push({ file, symbol: topSymbol(p, b.start), line: b.line, text: lineStart(p.text, b.line).trim().slice(0, 140), kind: 'busy' });
  }
  return out;
}
export const answerPaths = (): W7Site[] => [...overPwa(answerPathsIn), ...answerPathsIn(parseSource(readFileSync(path.join(REPO, PUSH_SW), 'utf8'), PUSH_SW), PUSH_SW)];

/** A `useState(…)` or `useState<…>(…)` call (or `React.useState`) whose top-level enclosing symbol is `DialogSheet`.
 *  11 on the base (plan item 5: the ten in its state block and `raiseMark`). */
export function dialogSheetStatesIn(p: ParsedFile, file: string): W7Site[] {
  return p.calls.filter((c) => (c.callee === 'useState' || c.callee === 'React.useState') && topSymbol(p, c.start) === 'DialogSheet')
    .map((c) => ({ ...callSite(p, file, c), text: lineStart(p.text, c.line).trim().slice(0, 140) }));
}
export const dialogSheetStates = (): W7Site[] => overPwa(dialogSheetStatesIn);

// ─── 6. the client's pairing definitions (ARCH-58's PWA half, C7f) ─────────────────────────────────────────────────

/** The client pairing's names (plan item 6): the six readers, the wrap-bar pattern and the two helpers they stand on. */
export const CLIENT_PAIRING_NAMES: readonly string[] = ['questionCorresponds', 'titleMatches', 'liveQuestion', 'namedQuestion', 'shownQuestion', 'askScreen', 'WRAP_BAR_RE', 'prefixMatches', 'norm'];

/** A binding declared at module scope: its scope is the whole file (the source file's span runs to the end of the text;
 *  `scopeStart` is the first token, after any header comment). */
const atModuleScope = (p: ParsedFile, b: { scopeEnd: number }): boolean => b.scopeEnd >= p.text.length;

const moduleDefinitions = (p: ParsedFile, file: string, names: readonly string[], kind = ''): W7Site[] => {
  const seen = new Set<string>();
  const out: W7Site[] = [];
  for (const s of p.symbols) {
    if (!s.name.includes('.') && names.includes(s.name) && !seen.has(s.name)) { seen.add(s.name); out.push({ file, symbol: s.name, line: s.line, text: lineStart(p.text, s.line).trim().slice(0, 140), kind }); }
  }
  for (const b of p.bindings) {
    if (atModuleScope(p, b) && names.includes(b.name) && !seen.has(b.name)) { seen.add(b.name); out.push({ file, symbol: b.name, line: b.line, text: lineStart(p.text, b.line).trim().slice(0, 140), kind }); }
  }
  return out.sort((a, b) => a.line - b.line);
};

/** A module-scope definition (a top-level function or a module-scope binding) named one of `CLIENT_PAIRING_NAMES`, in
 *  any PWA source. 9 on the base, all in `session/askLive.ts`. A helper inlined into its caller leaves the count.
 *  KNOWN WIDTH: a definition under another name is not seen (the name list is closed, and reviewed). */
export const clientPairingDefinitionsIn = (p: ParsedFile, file: string): W7Site[] => moduleDefinitions(p, file, CLIENT_PAIRING_NAMES);
export const clientPairingDefinitions = (): W7Site[] => overPwa(clientPairingDefinitionsIn);

/** The pane-text decisions the PWA makes on its own (plan items 7 and 8): `COMPACTION_RE` (which decides `foldsAway`) and
 *  `showsPrompt` (the drawer's prompt judgement). 2 on the base. KNOWN WIDTH: a closed name list. */
export const PANE_TEXT_DECISION_NAMES: readonly string[] = ['COMPACTION_RE', 'showsPrompt'];
export const paneTextDecisionsIn = (p: ParsedFile, file: string): W7Site[] => moduleDefinitions(p, file, PANE_TEXT_DECISION_NAMES);
export const paneTextDecisions = (): W7Site[] => overPwa(paneTextDecisionsIn);

// ─── 9, 10. bucket orders and "archived" (ARCH-75, C7j) ────────────────────────────────────────────────────────────

/** The seven fleet buckets, by their wire words. */
export const BUCKETS: readonly string[] = ['attention', 'done', 'idle', 'working', 'cleanup', 'archived', 'dead'];

/** A bucket order: a module-scope binding whose initialiser is an object literal giving EVERY bucket a numeric rank, as a
 *  bare number (`attention: 0`) or an `order:` field (`attention: { order: 0, … }`). 2 on the base (`sortFleet.ts#RANK`,
 *  `statusGroups.ts#STATUS_GROUPS`). A label-only table (`BUCKET_WORD`) and a derived list (`BUCKET_ORDER`, computed
 *  from `RANK`) are not orders. KNOWN WIDTH: an order written as an array literal of the words is not seen. */
export function bucketOrdersIn(p: ParsedFile, file: string): W7Site[] {
  return p.bindings.filter((b) => atModuleScope(p, b) && /^\s*\{/.test(b.init)
    && BUCKETS.every((w) => new RegExp(`\\b${w}\\s*:\\s*(?:\\d|\\{[^}]*\\border\\s*:\\s*\\d)`).test(b.init)))
    .map((b) => ({ file, symbol: b.name, line: b.line, text: lineStart(p.text, b.line).trim().slice(0, 140), kind: '' }));
}
export const bucketOrders = (): W7Site[] => overPwa(bucketOrdersIn);

/** An absence check on `archivedAt`: an equality comparison with an `archivedAt` leaf and an absent operand (`null`,
 *  `undefined`), either operator. 8 on the base (plan item 10). KNOWN WIDTH: a truthiness test (`if (s.archivedAt)`) is
 *  not a comparison. */
export function archivedChecksIn(p: ParsedFile, file: string): W7Site[] {
  return p.comparisons.filter((c) => c.absent && (c.leftLeaf === 'archivedAt' || c.rightLeaf === 'archivedAt')).map((c) => cmpSite(p, file, c));
}
export const archivedChecks = (): W7Site[] => overPwa(archivedChecksIn);

// ─── 11, 12. the session path and ensure (ARCH-75, C7k) ────────────────────────────────────────────────────────────

/** A session path: a string expression (literal, template or `+` chain) whose cooked text starts `/s/`. 14 on the base,
 *  in 12 files (plan item 11). KNOWN WIDTH: a path built from a variable prefix (`base + id`) is not seen. */
export function sessionPathLiteralsIn(p: ParsedFile, file: string): W7Site[] {
  return stringExpressions(p.text, file).filter((e) => !e.partial && e.text.startsWith('/s/'))
    .map((e) => site(p, file, e.start, e.line, p.text.slice(e.start, e.end).slice(0, 140)));
}
export const sessionPathLiterals = (): W7Site[] => overPwa(sessionPathLiteralsIn);

/** Every reference to the member `api.<member>`, called or not (an `identifierReferences` hit on `<member>` whose parent
 *  is the member expression `api.<member>`), kind `call` or `reference`. */
const apiMemberRefs = (p: ParsedFile, file: string, member: string): W7Site[] => {
  const lines = p.text.split('\n');
  return identifierReferences(p.text, file, new Set([member])).filter((r) => r.context === `api.${member}`).map((r) => {
    const text = (lines[r.line - 1] ?? '').trim();
    return { file, symbol: enclosingSymbol(p, lineOffset(p.text, r.line, `api.${member}`)), line: r.line, text: text.slice(0, 140), kind: r.role === 'call' ? 'call' : 'reference' };
  });
};
const lineOffset = (text: string, line: number, needle: string): number => {
  let at = 0;
  for (let i = 1; i < line; i++) at = text.indexOf('\n', at) + 1;
  const hit = text.indexOf(needle, at);
  return hit < 0 ? at : hit;
};

/** The owners of `api.ensure`: every call AND every member reference not called (a default parameter
 *  `ensure = api.ensure` hands the act on, so it is an owner). 6 on the base: 5 calls and `ResumeSheet`'s default
 *  (plan item 12). A comment naming `api.ensure` is not code. */
export const ensureCallersIn = (p: ParsedFile, file: string): W7Site[] => apiMemberRefs(p, file, 'ensure');
export const ensureCallers = (): W7Site[] => overPwa(ensureCallersIn);

// ─── 13. storage (ARCH-75, C7l) ────────────────────────────────────────────────────────────────────────────────────

/** A storage owner: a file with an `identifierReferences` hit on `localStorage` or `sessionStorage` (one site per file,
 *  at its first hit). 10 on the base, none naming `sessionStorage` (plan item 13). A comment is not a hit. */
export function storageOwnersIn(p: ParsedFile, file: string): W7Site[] {
  const hit = identifierReferences(p.text, file, new Set(['localStorage', 'sessionStorage']))[0];
  return hit === undefined ? [] : [{ file, symbol: enclosingSymbol(p, lineOffset(p.text, hit.line, hit.name)), line: hit.line, text: lineStart(p.text, hit.line).trim().slice(0, 140), kind: hit.name }];
}
export const storageOwners = (): W7Site[] => overPwa(storageOwnersIn);

/** A local storage type: a declaration of a `getItem` member (an interface or type-literal member signature, or a class
 *  method), told from a use by its parent (`getItem(key: string): …`, not `x.getItem`). One site per declaration. 1 on
 *  the base (`session/drawerView.ts#StorageLike`); the DOM's `Storage`, which three seams name, is not local. KNOWN
 *  WIDTH: a storage type with no `getItem` member is not seen. */
export function storageTypesIn(p: ParsedFile, file: string): W7Site[] {
  return identifierReferences(p.text, file, new Set(['getItem'])).filter((r) => r.role === 'other' && /^getItem\s*[(<:?]/.test(r.context))
    .map((r) => ({ file, symbol: enclosingSymbol(p, lineOffset(p.text, r.line, 'getItem')), line: r.line, text: lineStart(p.text, r.line).trim().slice(0, 140), kind: '' }));
}
export const storageTypes = (): W7Site[] => overPwa(storageTypesIn);

// ─── 14. the page clock (ARCH-75, C7m) ─────────────────────────────────────────────────────────────────────────────

/** An `addEventListener('visibilitychange' | 'online', …)` call, kind the event. 10 and 2 on the base (plan item 14).
 *  `pagehide` is a different event (the page going away) and is not counted. */
export function pageClockSubscriptionsIn(p: ParsedFile, file: string): W7Site[] {
  return p.calls.filter((c) => c.name === 'addEventListener' && c.args[0]?.kind === 'string' && (c.args[0].text === 'visibilitychange' || c.args[0].text === 'online'))
    .map((c) => callSite(p, file, c, c.args[0]!.text));
}
export const pageClockSubscriptions = (): W7Site[] => overPwa(pageClockSubscriptionsIn);

// ─── 15. single readers (ARCH-75, C7n) ─────────────────────────────────────────────────────────────────────────────

/** The fleet reads W7 holds to one reader each: every call or member reference of `api.feed`, `api.runs` and
 *  `api.projects` (the fleet API, not `docsApi.projects`), kind `<member>:call` or `<member>:reference`. 2, 2 and 3 on the
 *  base (plan item 15; `StartProgramSheet`'s `loadProjects = api.projects` is the reference). */
export function singleReadersIn(p: ParsedFile, file: string): W7Site[] {
  return ['feed', 'runs', 'projects'].flatMap((m) => apiMemberRefs(p, file, m).map((s) => ({ ...s, kind: `${m}:${s.kind}` }))).sort((a, b) => a.line - b.line);
}
export const singleReaders = (): W7Site[] => overPwa(singleReadersIn);

// ─── 16. placement (K15) ───────────────────────────────────────────────────────────────────────────────────────────

/** The placement scorers a PWA copy would be built from: the PWA's own least-loaded pick and the server's projection. */
export const PLACEMENT_NAMES: readonly string[] = ['leastLoaded', 'projectHome'];
/** The one legitimately different caller (spec K15: a swap target, not a new session's home) and the picker's own file. */
export const PLACEMENT_ALLOWED: readonly string[] = ['pwa/src/fleet/SwapSheet.tsx', 'pwa/src/fleet/accountPicker.ts'];

/** A PWA copy of new-session placement: a reference (not an import) to `leastLoaded` or `projectHome` in a file other
 *  than `SwapSheet.tsx` and `accountPicker.ts`, or a definition of `projectHome` anywhere in the PWA. 0 on the base: the
 *  K15 exit is met, `NewSessionSheet` reads the server's `projected` (plan item 16). KNOWN WIDTH: a copy written under
 *  another name is not seen. */
export function placementCopiesIn(p: ParsedFile, file: string): W7Site[] {
  const out: W7Site[] = [];
  if (!PLACEMENT_ALLOWED.includes(file)) {
    for (const r of identifierReferences(p.text, file, new Set(PLACEMENT_NAMES))) {
      // A declaration's own name (`function projectHome(…)`, `const projectHome = …`) is the definition row below.
      const declares = new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s*${r.name}\\b|^${r.name}\\s*[=:]`).test(r.context);
      if (r.role !== 'import' && !declares) out.push({ file, symbol: enclosingSymbol(p, lineOffset(p.text, r.line, r.name)), line: r.line, text: lineStart(p.text, r.line).trim().slice(0, 140), kind: r.name });
    }
  }
  return [...out, ...moduleDefinitions(p, file, ['projectHome'], 'definition')];
}
export const placementCopies = (): W7Site[] => overPwa(placementCopiesIn);

// ─── 18. viewer words read as presence (the ARCH-53 follow-up, C7o) ────────────────────────────────────────────────

/** The viewer constants and the defer-derived identifiers that still say "presence" for a viewer fact (plan item 18). */
export const VIEWER_PRESENCE_NAMES: readonly string[] = [
  'PRESENCE_REFRESH_MS', 'PRESENCE_TTL_MS', 'PRESENCE_OPEN_TTL_MS',
  'presenceHeldSince', 'lastPresenceWallAt', 'lastPresenceDeferredAt', 'firstPresenceDeferredAt', 'collectAfterPresence',
  'presenceSince', 'childReclaimPresenceWithin', 'CollectPresence', 'CHILD_RECLAIM_PRESENCE_GAP_PASSES', 'CHILD_RECLAIM_PRESENCE_DEFERS',
];

/** Every identifier occurrence of a `VIEWER_PRESENCE_NAMES` name in a source (imports included; comments are not code),
 *  kind the name. Walked over `server/src`, `shared/` and `pwa/src`. */
export function viewerWordsAsPresenceIn(p: ParsedFile, file: string): W7Site[] {
  return identifierReferences(p.text, file, new Set(VIEWER_PRESENCE_NAMES))
    .map((r) => ({ file, symbol: enclosingSymbol(p, lineOffset(p.text, r.line, r.name)), line: r.line, text: lineStart(p.text, r.line).trim().slice(0, 140), kind: r.imported ?? r.name }));
}
export const viewerWordsAsPresence = (): W7Site[] => [
  ...walkSrc({ roots: ['server/src'], min: 200, match: /\.ts$/ }),
  ...walkSrc({ roots: ['shared'], min: 5, flat: true, match: /\.ts$/ }),
  ...pwaSources(),
].flatMap((rel) => viewerWordsAsPresenceIn(parsedFile(rel), rel));

/** Each site as one printed line: `file#symbol:line  text` (kind in brackets when the query tags kinds). */
export const showSite = (s: W7Site): string => `${s.file}#${s.symbol}:${s.line}${s.kind === '' ? '' : ` [${s.kind}]`}  ${s.text}`;

/** A query's sites counted by a key (kind, file or name), for a row that pins each part of a count. */
export const countBy = (sites: readonly W7Site[], key: (s: W7Site) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const s of sites) out[key(s)] = (out[key(s)] ?? 0) + 1;
  return out;
};
