// W3's question census (slug question-census; Task Q3a; ARCH-56 (#791), ARCH-57 (#792), ARCH-58 (#793); plan
// 2026-10-26-consolidation-w3-questions.md). W3's own module, as W8's chains keep theirs under `census-w8/`: no two
// series append to `consolidationCensus.ts`'s tail (spec §5.1 rule 6). Each query returns `CensusSite` rows the way
// `consolidationCensus.ts`'s own do, through its shared helpers, and its fixture and real-tree rows live in the sibling
// `questions.test.ts`. Only W3's tasks edit this file.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parsedFile } from '../scan/symbols.js';
import { codeOf, esc, REPO, siteAt, sitesOf, sourceFiles, watcherFacts, type CensusSite } from '../consolidationCensus.js';

// W3's counted exits (plan docs/superpowers/plans/2026-10-26-consolidation-w3-questions.md). Every query is read from
// the syntax tree (`scan/symbols.ts`, over `scan/parse.ts`), and every one REPORTS: nothing below is ratcheted here.
// Each may-only-shrink pin lands in the commit that reaches its wave target (spec §5.1 rule 3), in Q3c to Q3f.
// KNOWN WIDTH, every query below: a member reached through a computed name, an alias or a destructured binding is not
// seen, and a route is only an `app.<verb>('<literal path>', …)` registration.

/** The `FleetWatcher` fields that carry a held question, by name (a closed list, checked against the class's fields:
 *  a name that is no longer a field leaves the census). */
export const QUESTION_HOLD_CARRIER_NAMES: readonly string[] = ['heldAsks', 'heldApprovals', 'lapsedAsks', 'pendingReseed'];

/** The question state `registerCoordRoutes` holds in a closure local, made once per server (never module scope). */
export const ROUTE_QUESTION_STATE_NAMES: readonly string[] = ['approvalInputs'];

/** One carrier of question state: where it is declared, and its owner (the class, or the function whose local it is). */
export interface QuestionCarrierSite extends CensusSite { readonly name: string; readonly owner: string }

/** W3's question hold carriers: `FleetWatcher`'s fields in `QUESTION_HOLD_CARRIER_NAMES` (4 at the base), then each
 *  `ROUTE_QUESTION_STATE_NAMES` binding declared inside `registerCoordRoutes` (`approvalInputs`, 1). 5 at the base. After
 *  Q3d and Q3e the same names are looked for in `coord/questions.ts`'s `createQuestions`, so the owner column says where
 *  each carrier lives, and a module-scope binding of one of them reports the owner `module scope`. */
export function questionHoldCarriers(root: string = REPO): QuestionCarrierSite[] {
  const out: QuestionCarrierSite[] = [];
  const names = [...QUESTION_HOLD_CARRIER_NAMES, ...ROUTE_QUESTION_STATE_NAMES];
  const w = watcherFacts(root);
  if (w !== null) {
    for (const f of w.facts.fields) {
      if (f.cls === 'FleetWatcher' && QUESTION_HOLD_CARRIER_NAMES.includes(f.name)) out.push({ ...siteAt(w, f.line), name: f.name, owner: 'FleetWatcher' });
    }
  }
  for (const [rel, fn] of [['server/src/coord/routes.ts', 'registerCoordRoutes'], ['server/src/coord/questions.ts', 'createQuestions']] as const) {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) continue;
    const parsed = parsedFile(abs);
    const lines = parsed.text.split('\n');
    const owner = parsed.symbols.find((s) => s.name === fn);
    for (const b of parsed.bindings) {
      if (!names.includes(b.name)) continue;
      const inside = owner !== undefined && b.start >= owner.start && b.end <= owner.end;
      const atTop = b.scopeStart === 0;
      if (!inside && !atTop) continue;
      out.push({ file: rel, line: b.line, text: lines[b.line - 1] ?? '', name: b.name, owner: inside ? fn : 'module scope' });
    }
  }
  return out;
}

/** The pane-edge maps: what the pane showed, per session. Not question state (slug question-census): reported, never
 *  ratcheted. */
export const QUESTION_PANE_EDGE_NAMES: readonly string[] = ['dialogIds', 'actionlessAsks', 'settlingAsks'];

/** `FleetWatcher`'s pane-edge maps still declared (3 at the base). */
export function questionPaneEdges(root: string = REPO): CensusSite[] {
  const w = watcherFacts(root);
  return w === null ? [] : w.facts.fields.filter((f) => f.cls === 'FleetWatcher' && QUESTION_PANE_EDGE_NAMES.includes(f.name)).map((f) => siteAt(w, f.line));
}

/** The store methods whose call lapses, releases or prunes a question row: what makes a method a question sweep. */
export const QUESTION_SWEEP_ACTS: readonly string[] = ['releaseAsk', 'lapseApproval', 'staleApproval', 'pruneApprovalInputs', 'pruneAskQuestions'];

/** One question sweep entry point: the `FleetWatcher` method `tick` calls, at the line `tick` calls it. */
export interface SweepEntrySite extends CensusSite { readonly method: string }

/** W3's question sweep entry points: the `FleetWatcher` methods `tick`'s own body calls (`this.<m>(`) that reach a
 *  `QUESTION_SWEEP_ACTS` store call, directly or through the `this.` methods they call (arrows inside them included).
 *  At the base, `sweepAsks` (through `askPass`) and `sweepApprovals` (2). A public half that `tick` does not call itself is
 *  not an entry point. */
export function questionSweepEntries(root: string = REPO): SweepEntrySite[] {
  const abs = path.join(root, 'server/src/watch.ts');
  if (!existsSync(abs)) return [];
  const parsed = parsedFile(abs);
  const lines = parsed.text.split('\n');
  const method = (name: string) => parsed.symbols.find((s) => s.name === `FleetWatcher.${name}`);
  const callsOf = (s: { start: number; end: number }) => parsed.calls.filter((c) => c.start >= s.start && c.end <= s.end);
  const own = (callee: string): string | null => /^this\.(\w+)$/.exec(callee)?.[1] ?? null;
  const reaches = (name: string, seen: Set<string>): boolean => {
    if (seen.has(name)) return false;
    seen.add(name);
    const s = method(name);
    if (s === undefined) return false;
    const cs = callsOf(s);
    if (cs.some((c) => c.name !== null && QUESTION_SWEEP_ACTS.includes(c.name) && own(c.callee) === null)) return true;
    return cs.some((c) => { const m = own(c.callee); return m !== null && reaches(m, seen); });
  };
  const tick = method('tick');
  if (tick === undefined) return [];
  const out: SweepEntrySite[] = [];
  const done = new Set<string>();
  for (const c of callsOf(tick)) {
    const m = own(c.callee);
    if (m === null || done.has(m)) continue;
    done.add(m);
    if (reaches(m, new Set())) out.push({ file: 'server/src/watch.ts', line: c.line, text: lines[c.line - 1] ?? '', method: m });
  }
  return out;
}

/** Who a question door answers for: the dispatched child's parent (`claimant`), the operator at the PWA (`operator`), or
 *  nobody (`navigation`: it moves the pane and answers nothing). */
export type QuestionDoorTag = 'claimant' | 'operator' | 'navigation';

/** The question doors by path, each with its principal. A POST whose path has a question door's shape and is not a
 *  row here is reported `untagged`, and the census test reds. */
export const QUESTION_DOOR_TAGS: Readonly<Record<string, QuestionDoorTag>> = {
  '/api/asks/:id/answer': 'claimant',
  '/api/asks/:id/release': 'claimant',
  '/api/approvals/:id/rule': 'claimant',
  '/api/approvals/:id/release': 'claimant',
  '/api/sessions/:id/ask': 'operator',
  '/api/sessions/:id/dialog': 'operator',
  '/api/sessions/:id/dialog/text': 'operator',
  '/api/sessions/:id/dialog/multi': 'operator',
  '/api/sessions/:id/dialog/tab': 'navigation',
};

/** A question door's shape: a verb under an ask's or an approval's id, an operator's answer or dialog door under a
 *  session's id, or anything under `/api/questions/`. `POST /api/approvals` (the raise) and the session's own
 *  `/hold`/`/release` are not. */
const QUESTION_DOOR_SHAPE = /^\/api\/(?:(?:asks|approvals)\/:id\/[^/]+|sessions\/:id\/(?:ask|dialog(?:\/[^/]+)?)|questions\/.*)$/;

/** The files whose route registrations the door census reads. */
const QUESTION_DOOR_FILES: readonly string[] = ['server/src/coord/routes.ts', 'server/src/server.ts'];

/** One route registration: its method, its path and the call's span (for "which route holds this call"). */
interface RouteRegistration { readonly verb: string; readonly path: string; readonly start: number; readonly end: number; readonly line: number }

const ROUTE_CALLEE = /^(?:app|fastify|instance|server)\.(get|post|put|patch|delete)$/;

function routeRegistrations(parsed: ReturnType<typeof parsedFile>): RouteRegistration[] {
  return parsed.calls.flatMap((c) => {
    const m = ROUTE_CALLEE.exec(c.callee);
    const p = c.args[0];
    return m !== null && p?.kind === 'string' ? [{ verb: m[1]!.toUpperCase(), path: p.text, start: c.start, end: c.end, line: c.line }] : [];
  });
}

/** One question door: the route, as `POST <path>`, and its tag. */
export interface QuestionDoorSite extends CensusSite { readonly route: string; readonly tag: QuestionDoorTag | 'untagged' }

/** W3's question doors: the POST registrations in `coord/routes.ts` and `server.ts` whose path has a question door's
 *  shape, tagged from `QUESTION_DOOR_TAGS`. 9 at the base: 4 claimant, 4 operator, 1 navigation. */
export function questionDoors(root: string = REPO): QuestionDoorSite[] {
  const out: QuestionDoorSite[] = [];
  for (const rel of QUESTION_DOOR_FILES) {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) continue;
    const parsed = parsedFile(abs);
    const lines = parsed.text.split('\n');
    for (const r of routeRegistrations(parsed)) {
      if (r.verb !== 'POST' || !QUESTION_DOOR_SHAPE.test(r.path)) continue;
      out.push({ file: rel, line: r.line, text: lines[r.line - 1] ?? '', route: `POST ${r.path}`, tag: QUESTION_DOOR_TAGS[r.path] ?? 'untagged' });
    }
  }
  return out;
}

/** One watcher door-in: the public `FleetWatcher` method a route calls to touch question state, at its declaration. */
export interface DoorInSite extends CensusSite { readonly method: string; readonly callers: readonly string[] }

/** W3's watcher door-ins: the public (not `private`) `FleetWatcher` methods whose body reads `this.<carrier>` for a
 *  `QUESTION_HOLD_CARRIER_NAMES` field, and that `coord/routes.ts` or `server.ts` calls (`<x>.<method>(`, by name). At
 *  the base, `releaseHeldAsk`, `answeredLate`, `releaseHeldApproval` and `approvalRuled` (4); each lists the routes that
 *  call it. */
export function questionDoorIns(root: string = REPO): DoorInSite[] {
  const abs = path.join(root, 'server/src/watch.ts');
  if (!existsSync(abs)) return [];
  const parsed = parsedFile(abs);
  const lines = parsed.text.split('\n');
  const touches = (s: { start: number; end: number }): boolean => {
    const body = parsed.text.slice(s.start, s.end).split('\n').map(codeOf).join('\n');
    return QUESTION_HOLD_CARRIER_NAMES.some((c) => new RegExp(`\\bthis\\.${c}\\b`).test(body));
  };
  const candidates = parsed.symbols.filter((s) => s.kind === 'method' && s.name.startsWith('FleetWatcher.')
    && !/^\s*(?:(?:static|async|override)\s+)*private\b/.test(parsed.text.slice(s.start, s.start + 40)) && touches(s));
  const callers = new Map<string, string[]>();
  for (const rel of QUESTION_DOOR_FILES) {
    const f = path.join(root, rel);
    if (!existsSync(f)) continue;
    const p = parsedFile(f);
    const routes = routeRegistrations(p);
    for (const c of p.calls) {
      if (c.name === null || c.head === 'this') continue;
      const route = routes.filter((r) => r.start <= c.start && c.end <= r.end).sort((a, b) => b.start - a.start)[0];
      const key = route === undefined ? rel : `${route.verb} ${route.path}`;
      const list = callers.get(c.name) ?? [];
      if (!list.includes(key)) list.push(key);
      callers.set(c.name, list);
    }
  }
  return candidates.flatMap((s) => {
    const name = s.name.slice('FleetWatcher.'.length);
    const by = callers.get(name);
    return by === undefined ? [] : [{ file: 'server/src/watch.ts', line: s.line, text: lines[s.line - 1] ?? '', method: name, callers: by }];
  });
}

/** The `CoordStore` question methods, a CLOSED list (slug question-census): every public `CoordStore` method whose
 *  name says ask, approval or question is on it, or on `NOT_QUESTION_STORE_METHODS`, and the census test reds on a
 *  method on neither (`coordStoreQuestionShapedMethods`). 32. */
export const QUESTION_STORE_METHODS: readonly string[] = [
  'askById', 'insertAsk', 'asksForParent', 'heldAskFor', 'currentAskFor', 'currentAsksFor', 'takeAskForAnswer', 'untakeAsk',
  'settleAsk', 'releaseAsk', 'declineAsk', 'staleAsk', 'restampAsk', 'heldQuestionRows', 'heldApprovalRowsByChild',
  'approvalById', 'approvalsForChild', 'heldApprovalsFor', 'approvalsInState', 'insertApproval', 'takeApprovalForRule',
  'declineApproval', 'lapseApproval', 'markApprovalOperator', 'markApprovalOperatorRows', 'staleApproval',
  'pruneApprovalInputs', 'pruneAskQuestions', 'digestAsks', 'digestApprovals', 'askForCorrection', 'driftHeldQuestions',
];

/** Public `CoordStore` methods whose names look like a question method and are not one, each with why. */
export const NOT_QUESTION_STORE_METHODS: Readonly<Record<string, string>> = {
  raiseReviewCapAsk: "the review cap's own raise row (D-6795), not the asks table",
  digestDay: "the digest's send ledger, not a question table",
  claimDigestDay: "the digest's send ledger, not a question table",
};

/** The public `CoordStore` methods (no `private`) whose name says ask, approval, question or digest: the set
 *  `QUESTION_STORE_METHODS` and `NOT_QUESTION_STORE_METHODS` must partition. */
export function coordStoreQuestionShapedMethods(root: string = REPO): string[] {
  const abs = path.join(root, 'server/src/coord/store.ts');
  if (!existsSync(abs)) return [];
  const parsed = parsedFile(abs);
  return parsed.symbols
    .filter((s) => s.kind === 'method' && s.name.startsWith('CoordStore.')
      && !/^\s*(?:(?:static|async|override)\s+)*private\b/.test(parsed.text.slice(s.start, s.start + 40)))
    .map((s) => s.name.slice('CoordStore.'.length))
    .filter((n) => /ask|approv|question|digest/i.test(n))
    .sort();
}

/** The one question-store call W3 leaves where it is, by name: the hook's poll is on the signing path, which no W3 diff
 *  touches (slug question-census). */
export const QUESTION_STORE_EXCLUDED: ReadonlyArray<{ readonly file: string; readonly symbol: string; readonly method: string }> = [
  { file: 'server/src/coord/routes.ts', symbol: 'GET /api/approvals/:id/ruling', method: 'approvalById' },
];

/** One question-store call: the enclosing route (`POST /api/asks/:id/answer`) or else the innermost named symbol
 *  (`FleetWatcher.askPass`, `buildDigest`), the method, and whether `QUESTION_STORE_EXCLUDED` names it. */
export interface QuestionStoreCallSite extends CensusSite { readonly symbol: string; readonly method: string; readonly excluded: boolean }

/** W3's question-store calls outside the store: every call of a `QUESTION_STORE_METHODS` name (`<x>.<method>(`, never
 *  `this.<method>(`) in `server/src` and `shared/`, outside `coord/store.ts` and `coord/questions.ts`. 48 at the base in 6
 *  files (`watch.ts` 22, `coord/routes.ts` 14, `server.ts` 5, `coord/digest.ts` 4, `fleet.ts` 2, `coord/driftLane.ts` 1),
 *  1 of them excluded by name: 47 counted. Q3f's may-only-shrink pin holds the whole list at the excluded row. */
export function questionStoreCallsOutside(root: string = REPO): QuestionStoreCallSite[] {
  const out: QuestionStoreCallSite[] = [];
  for (const dir of ['server/src', 'shared']) {
    for (const f of sourceFiles(root, dir)) {
      const file = path.relative(root, f).split(path.sep).join('/');
      if (file === 'server/src/coord/store.ts' || file === 'server/src/coord/questions.ts') continue;
      const parsed = parsedFile(f);
      const lines = parsed.text.split('\n');
      const routes = routeRegistrations(parsed);
      for (const c of parsed.calls) {
        if (c.name === null || !QUESTION_STORE_METHODS.includes(c.name) || c.callee === c.name || /^this\.\w+$/.test(c.callee)) continue;
        const route = routes.filter((r) => r.start <= c.start && c.end <= r.end).sort((a, b) => b.start - a.start)[0];
        const sym = parsed.symbols.filter((s) => s.kind !== 'class' && s.start <= c.start && c.end <= s.end).sort((a, b) => b.start - a.start)[0];
        const symbol = route !== undefined ? `${route.verb} ${route.path}` : sym?.name ?? '(module)';
        const excluded = QUESTION_STORE_EXCLUDED.some((x) => x.file === file && x.symbol === symbol && x.method === c.name);
        out.push({ file, line: c.line, text: lines[c.line - 1] ?? '', symbol, method: c.name, excluded });
      }
    }
  }
  return out;
}

/** One definition of an envelope-pairing rule: which side of the wire defines it, and the name. */
export interface PairingRuleSite extends CensusSite { readonly side: 'server' | 'pwa'; readonly name: string }

const pairingDefinitions = (root: string, names: Readonly<Record<'server' | 'pwa', readonly string[]>>): PairingRuleSite[] => {
  const out: PairingRuleSite[] = [];
  for (const [side, dirs] of [['server', ['server/src', 'shared']], ['pwa', ['pwa/src']]] as const) {
    if (names[side].length === 0) continue;
    const re = new RegExp(`\\b(?:function\\s+|const\\s+|let\\s+)(${names[side].map(esc).join('|')})\\b`, 'g');
    for (const s of sitesOf(root, dirs, re)) {
      for (const m of codeOf(s.text).matchAll(re)) out.push({ ...s, side, name: m[1]! });
    }
  }
  return out;
};

/** The normalize-and-prefix rule's definitions (a `function`, `const` or `let` of the name): server `pairMatches`,
 *  PWA `prefixMatches`. 2 at the base, one per side; Q3g keeps the server at 1 (moved into `pane/askPairing.ts`, with
 *  `transcript/ask.ts` re-exporting it), and W7 takes the PWA's to 0. */
export function envelopePairingRules(root: string = REPO): PairingRuleSite[] {
  return pairingDefinitions(root, { server: ['pairMatches', 'prefixMatches'], pwa: ['prefixMatches', 'pairMatches'] });
}

/** The pairing's title-matching definitions (`titleMatches`, `WRAP_BAR_RE`), either side. At the base only the PWA's
 *  (`askLive.ts`, 2 names); server-side envelope pairing 0, until Q3g's port. */
export function envelopePairingTitleRules(root: string = REPO): PairingRuleSite[] {
  return pairingDefinitions(root, { server: ['titleMatches', 'WRAP_BAR_RE'], pwa: ['titleMatches', 'WRAP_BAR_RE'] });
}

/** The W3 task that moves each question-store call, by `file | enclosing symbol` (the plan's Q3a table). A counted call
 *  whose key is not here has no owner, and the census test reds. Rows only leave this table. */
export const QUESTION_STORE_OWNERS: Readonly<Record<string, 'Q3b' | 'Q3d' | 'Q3e' | 'Q3f'>> = {
  'server/src/watch.ts | FleetWatcher.stallWorkerFor': 'Q3d',
  'server/src/watch.ts | FleetWatcher.detectDialogs': 'Q3d',
  'server/src/watch.ts | FleetWatcher.loadReseed': 'Q3d',
  'server/src/watch.ts | FleetWatcher.staleReseedRow': 'Q3d',
  'server/src/watch.ts | FleetWatcher.reseedFromRows': 'Q3d',
  'server/src/watch.ts | FleetWatcher.restampHeldAsk': 'Q3d',
  'server/src/watch.ts | FleetWatcher.askPass': 'Q3d',
  'server/src/watch.ts | FleetWatcher.tryHoldApproval': 'Q3d',
  'server/src/watch.ts | FleetWatcher.sweepApprovals': 'Q3d',
  'server/src/watch.ts | FleetWatcher.releaseHeldApproval': 'Q3d',
  'server/src/watch.ts | FleetWatcher.settleClearedApproval': 'Q3d',
  'server/src/watch.ts | FleetWatcher.tryHold': 'Q3d',
  'server/src/watch.ts | FleetWatcher.hold': 'Q3d',
  'server/src/coord/routes.ts | POST /api/approvals': 'Q3e',
  'server/src/coord/routes.ts | POST /api/asks/:id/answer': 'Q3f',
  'server/src/coord/routes.ts | POST /api/asks/:id/release': 'Q3f',
  'server/src/coord/routes.ts | POST /api/approvals/:id/rule': 'Q3f',
  'server/src/coord/routes.ts | POST /api/approvals/:id/release': 'Q3f',
  'server/src/server.ts | POST /api/sessions/:id/dialog': 'Q3f',
  'server/src/server.ts | POST /api/sessions/:id/ask': 'Q3f',
};
