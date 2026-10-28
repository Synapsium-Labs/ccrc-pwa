// W7's PWA census, held two ways (D-7179; Task C7a; plan docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md;
// spec §5.1 rule 3, "a census reports before its series starts"): against FIXTURE sources, so each query counts what it
// claims and passes over its look-alike, and against the REAL tree, where each query's sites are printed by file and
// symbol and today's count is held as a floor-and-ceiling pair, so a moved or added site is visible in review. Nothing
// here ratchets: each may-only-shrink pin lands in `rings/pwa-one-owner.test.ts`, in the commit that reaches its count.
//
// BAND ROWS (D-7221). A query that a feature PR still in review changes is held as a band, its floor the count on that
// PR's head and its ceiling today's, so the PR's merge-queue run stays green here and a site added above today's count
// still reds. Measured on #1720's head `fad44037b` (one `/api/accounts` poll per tab): `accountsReaders()` 1 and
// `requestPolls()` 2; every other query counts the same there. #1715 merged before this task (`63efdeeea`), so
// `bucketOrders()` is an exact pair on the merged tree.
import { describe, it, expect } from 'vitest';
import {
  ANSWER_LIFECYCLE, accountsReaders, accountsReadersIn, answerPaths, answerPathsIn, archivedChecks, archivedChecksIn, bucketOrders, bucketOrdersIn,
  clientPairingDefinitions, clientPairingDefinitionsIn, coordPresenceSites, coordPresenceSitesIn, countBy, dialogSheetStates,
  dialogSheetStatesIn, ensureCallers, ensureCallersIn, fixture, inlineDeadChecks, inlineDeadChecksIn, pageClockSubscriptions,
  pageClockSubscriptionsIn, paneTextDecisions, paneTextDecisionsIn, placementCopies, placementCopiesIn, PUSH_SW, requestPolls,
  requestPollsIn, runMatchers, runMatchersIn, sessionPathLiterals, sessionPathLiteralsIn, showSite, singleReaders, singleReadersIn,
  storageOwners, storageOwnersIn, storageTypes, storageTypesIn, viewerWordsAsPresence, viewerWordsAsPresenceIn, type W7Site,
} from './pwa.js';
import { transcriptCopyRules, transcriptCopyRulesIn } from './pwa.js';
import { ENSURE_OWNER, SESSION_PATH_OWNER } from './pwa.js';

const F = 'pwa/src/fixture.tsx';
/** The one storage port (C7l, D-7190): the storage census counts the owners and types outside it. */
const STORAGE_PORT = 'pwa/src/lib/storage.ts';
const run = (q: (p: ReturnType<typeof fixture>, file: string) => W7Site[], src: string, file = F): W7Site[] => q(fixture(src, file), file);
const lines = (sites: readonly W7Site[]): string[] => sites.map((s) => s.text);

/** Print a REAL row's sites, by file and symbol, so the PR body and a reviewer read the same list. */
const show = (name: string, sites: readonly W7Site[]): void => {
  console.log(`census-w7 ${name}: ${sites.length}\n${sites.map((s) => `  ${showSite(s)}`).join('\n')}`);
};

/** A REAL row: today's count as an exact floor-and-ceiling pair (`floor === ceiling`), or a band (D-7221). */
const held = (name: string, sites: readonly W7Site[], floor: number, ceiling: number = floor): void => {
  show(name, sites);
  expect(sites.length, `${name}: at least ${floor}`).toBeGreaterThanOrEqual(floor);
  expect(sites.length, `${name}: at most ${ceiling}`).toBeLessThanOrEqual(ceiling);
};

describe('W7 PWA census: FIXTURE rows (each query against one counted site and one look-alike)', () => {
  it('accountsReaders: a call of api.accounts counts; a comment and another api member do not', () => {
    const got = run(accountsReadersIn, [
      '// api.accounts() is polled by the store',
      'export function Strip() { const load = () => { void api.accounts().then(() => {}); }; void api.claims(); }',
    ].join('\n'));
    expect(got.map((s) => [s.symbol, s.text])).toEqual([['Strip.load', 'api.accounts()']]);
  });

  it("inlineDeadChecks: s.status === 'dead' counts; a comment, a bucket and a !== '' check do not", () => {
    const got = run(inlineDeadChecksIn, [
      "// s.status === 'dead' in a comment",
      "export const gone = (s: S): boolean => s.status === 'dead';",
      "export const dead = (s: S): boolean => s.bucket === 'dead' || s.status !== '';",
      "export const live = (s: S): boolean => 'dead' !== s.status;",
    ].join('\n'));
    expect(got.map((s) => [s.symbol, s.text])).toEqual([['gone', "s.status === 'dead'"], ['live', "'dead' !== s.status"]]);
  });

  it('inlineDeadChecks: the owner, fleet/presence.ts, holds the definition and is not counted (C7c, D-7181)', () => {
    const text = "export function paneGone(s: S): boolean { return s.status === 'dead'; }";
    expect(run(inlineDeadChecksIn, text, 'pwa/src/fleet/presence.ts')).toEqual([]);
    expect(run(inlineDeadChecksIn, text, 'pwa/src/fleet/other.ts').map((s) => s.symbol)).toEqual(['paneGone']);
  });

  it('coordPresenceSites: the definition, each call and an answer compared with dead; another function is not', () => {
    const got = run(coordPresenceSitesIn, [
      'export function coordPresence(c: string | null, s: S | null, f: boolean): P { return "alive"; }',
      'export function note(r: R) { const presence = coordPresence(r.claimedBy, null, true); return presence === "dead"; }',
      'export function other(r: R) { const state = coordPresenceOf(r); return state === "dead"; }',
    ].join('\n'));
    expect(got.map((s) => [s.kind, s.symbol])).toEqual([['definition', 'coordPresence'], ['call', 'note'], ['answer-dead', 'note']]);
  });

  it('runMatchers: a claimant compared with a session id, sessionById.get(run.claimedBy) and the named readers count; a run compared with itself, a presence check and a Map.get on a session id do not', () => {
    const got = run(runMatchersIn, [
      'export function f(runs: R[], s: S, sessionById: Map<string, S>, run: R) {',
      '  const mine = runs.filter((r) => r.claimedBy === s.id);',
      '  const coord = sessionById.get(run.claimedBy);',
      '  const self = runs.filter((r) => r.claimedBy !== r.sessionId);',
      "  const named = runs.filter((r) => r.sessionId !== '');",
      '  const own = sessionById.get(s.id);',
      '  const open = runForSession(runs, s);',
      '  const seen = childRunsSeen(new Set(), [s], runs);',
      '}',
    ].join('\n'));
    expect(got.map((s) => [s.kind, s.text])).toEqual([
      ['comparison', 'r.claimedBy === s.id'], ['lookup', 'sessionById.get(run.claimedBy)'],
      ['runForSession', 'runForSession(runs, s)'], ['childRunsSeen', 'childRunsSeen(new Set(), [s], runs)'],
    ]);
  });

  it('runMatchers: a lookup inside a named run reader in runWords.ts reports as named; the same text elsewhere, or in another symbol, is a lookup (C7d, D-7182)', () => {
    const text = [
      'export function workerOf(run: R, sessionsById: Map<string, S>) { return sessionsById.get(run.sessionId) ?? null; }',
      'export function other(run: R, sessionsById: Map<string, S>) { return sessionsById.get(run.claimedBy) ?? null; }',
    ].join('\n');
    expect(run(runMatchersIn, text, 'pwa/src/fleet/runWords.ts').map((s) => [s.kind, s.symbol])).toEqual([['named', 'workerOf'], ['lookup', 'other']]);
    expect(run(runMatchersIn, text, 'pwa/src/fleet/other.ts').map((s) => [s.kind, s.symbol])).toEqual([['lookup', 'workerOf'], ['lookup', 'other']]);
  });

  it('requestPolls: a setInterval whose handler calls api.* counts; a clock tick beside a request, usePoll and the stores do not', () => {
    const src = [
      'export function Strip() {',
      '  useEffect(() => { const load = () => { void api.claims(); }; load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, []);',
      '}',
      'export function Clock() {',
      '  void api.linear();',
      '  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);',
      '}',
    ].join('\n');
    expect(run(requestPollsIn, src).map((s) => s.symbol)).toEqual(['Strip']);
    expect(run(requestPollsIn, src, 'pwa/src/lib/usePoll.ts')).toEqual([]);
    expect(run(requestPollsIn, src, 'pwa/src/stores/fleet.ts')).toEqual([]);
  });

  it('answerPaths: an answer writer, a busy composition and a push-sw /ask fetch count; generated text, interrupt and a reader do not', () => {
    const tsx = [
      'export function Sheet() { const pick = async () => { await api.answerDialog(id, d, 1); await api.answerDialogTab(id, r); }; }',
      "export function Stop() { void api.interrupt(id, 'escape'); void api.ask; }",
      'export function Envelope({ answering, denying }: P) { const busy = answering !== null || denying; }',
      'export function Plain({ waiting }: P) { const busy = waiting; }',
    ].join('\n');
    expect(run(answerPathsIn, tsx).map((s) => [s.kind, s.symbol])).toEqual([['writer', 'Sheet'], ['busy', 'Envelope']]);
    // C7e (D-7183): a write through an injected seam is a writer too; the same writes inside the lifecycle are its reducer.
    const seam = [
      "export function Seamed() { void answers.answerDialogText(id, d, 1, 't'); void answers.interrupt(id, 'deny'); }",
      "export function Escape() { void seam.interrupt(id, 'escape'); void store.applyAnswered(d, null); }",
    ].join('\n');
    expect(run(answerPathsIn, seam).map((s) => [s.kind, s.symbol])).toEqual([['writer', 'Seamed']]);
    expect(run(answerPathsIn, seam, ANSWER_LIFECYCLE).map((s) => [s.kind, s.symbol])).toEqual([['reducer', 'Seamed']]);
    const sw = [
      'self.addEventListener("notificationclick", async () => {',
      '  await fetch(`/api/sessions/${encodeURIComponent(sid)}/ask`, { method: "POST" });',
      '  await fetch(`/api/sessions/${encodeURIComponent(sid)}/seen`, { method: "POST" });',
      '});',
      '// ccrc:generated answer-lifecycle BEGIN',
      'async function generated() { await fetch(`/api/sessions/${sid}/ask`, {}); }',
      '// ccrc:generated answer-lifecycle END',
    ].join('\n');
    expect(run(answerPathsIn, sw, PUSH_SW).map((s) => [s.kind, s.line])).toEqual([['push-sw', 2]]);
  });

  it('dialogSheetStates: useState and useState<string | null>(null) inside DialogSheet count; one in another component does not', () => {
    const got = run(dialogSheetStatesIn, [
      'export function DialogSheet() {',
      '  const [a, setA] = useState<string | null>(null);',
      '  const [b, setB] = useState(0);',
      '}',
      'export function EnvelopeSheet() { const [c, setC] = useState(false); }',
    ].join('\n'));
    expect(got.map((s) => s.line)).toEqual([2, 3]);
  });

  it('clientPairingDefinitions: each named module-scope definition counts once; a local of the same name and another name do not', () => {
    const got = run(clientPairingDefinitionsIn, [
      'const norm = (s: string): string => s.trim();',
      'const WRAP_BAR_RE = /^\\s*│\\s*/;',
      'export function askScreen(a: A, d: D): string | null { const norm = 1; return null; }',
      'export function askSource(a: A): S { return a; }',
    ].join('\n'));
    expect(got.map((s) => s.symbol)).toEqual(['norm', 'WRAP_BAR_RE', 'askScreen']);
  });

  it('paneTextDecisions: COMPACTION_RE and showsPrompt count; a glyph constant does not', () => {
    const got = run(paneTextDecisionsIn, [
      'const COMPACTION_RE = /^This session is being continued/;',
      "export const PROMPT_GLYPH = '❯';",
      'export function showsPrompt(rows: readonly string[]): boolean { return rows.length > 0; }',
    ].join('\n'));
    expect(got.map((s) => s.symbol)).toEqual(['COMPACTION_RE', 'showsPrompt']);
  });

  it('bucketOrders: a numeric rank and an order: table count; a label table and a derived list do not', () => {
    const got = run(bucketOrdersIn, [
      'export const RANK = { attention: 0, done: 1, idle: 2, working: 3, cleanup: 4, archived: 5, dead: 6 };',
      "export const GROUPS = { attention: { order: 0, label: 'a' }, done: { order: 1, label: 'b' }, working: { order: 2, label: 'c' }, idle: { order: 3, label: 'd' }, cleanup: { order: 4, label: 'e' }, archived: { order: 5, label: 'f' }, dead: { order: 6, label: 'g' } };",
      "export const WORD = { attention: 'Needs you', done: 'Done', idle: 'Idle', working: 'Working', cleanup: 'Cleanup', archived: 'Archived', dead: 'Exited' };",
      'export const ORDER = Object.keys(RANK).sort((a, b) => RANK[a] - RANK[b]);',
    ].join('\n'));
    expect(got.map((s) => s.symbol)).toEqual(['RANK', 'GROUPS']);
  });

  it('archivedChecks: an archivedAt absence check counts, == null too; a truthiness test and a value comparison do not', () => {
    const got = run(archivedChecksIn, [
      'export const a = (s: S) => s.archivedAt !== null;',
      'export const b = (s: S) => s?.archivedAt != null;',
      'export const c = (s: S) => Boolean(s.archivedAt);',
      'export const d = (s: S) => s.archivedAt === s.bucketSince;',
    ].join('\n'));
    expect(lines(got)).toEqual(['s.archivedAt !== null', 's?.archivedAt != null']);
  });

  it('sessionPathLiterals: a template starting /s/ counts; /runs and a path in a comment do not', () => {
    const got = run(sessionPathLiteralsIn, [
      '// navigate(`/s/${id}`) in a comment',
      'export const go = (id: string) => navigate(`/s/${encodeURIComponent(id)}`);',
      "export const runs = () => navigate('/runs');",
    ].join('\n'));
    expect(lines(got)).toEqual(['`/s/${encodeURIComponent(id)}`']);
  });

  it('ensureCallers: function S({ ensure = api.ensure }) {} counts beside a comment naming api.ensure, which does not', () => {
    const got = run(ensureCallersIn, [
      '// the Revive door hands api.ensure on',
      'function S({ ensure = api.ensure }) {}',
      'export const wake = (id: string) => api.ensure(id);',
      'export const other = (id: string) => docsApi.ensure(id);',
    ].join('\n'));
    expect(got.map((s) => [s.kind, s.line])).toEqual([['reference', 2], ['call', 3]]);
  });

  it('storageOwners: a file naming localStorage counts once; a comment does not', () => {
    expect(run(storageOwnersIn, '// localStorage is read elsewhere\nexport const a = 1;\n')).toEqual([]);
    const got = run(storageOwnersIn, 'export const a = () => window.localStorage.getItem("k");\nexport const b = () => localStorage.setItem("k", "v");\n');
    expect(got.map((s) => [s.kind, s.line])).toEqual([['localStorage', 1]]);
  });

  it('storageTypes: a getItem member signature counts; a getItem call does not', () => {
    const got = run(storageTypesIn, [
      'export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }',
      'export const read = (s: Storage) => s.getItem("k");',
    ].join('\n'));
    expect(got.map((s) => s.line)).toEqual([1]);
  });

  it('pageClockSubscriptions: visibilitychange and online count; pagehide does not', () => {
    const got = run(pageClockSubscriptionsIn, [
      "document.addEventListener('visibilitychange', a);",
      "window.addEventListener('online', b);",
      "window.addEventListener('pagehide', c);",
    ].join('\n'));
    expect(got.map((s) => s.kind)).toEqual(['visibilitychange', 'online']);
  });

  it('singleReaders: calls and member references of api.feed, api.runs and api.projects count; docsApi.projects does not', () => {
    const got = run(singleReadersIn, [
      'export const a = () => api.feed(100);',
      'export const b = () => api.runs(true);',
      'export function S({ loadProjects = api.projects }) {}',
      'export const d = () => docsApi.projects();',
    ].join('\n'));
    expect(got.map((s) => s.kind)).toEqual(['feed:call', 'runs:call', 'projects:reference']);
  });

  it('placementCopies: a leastLoaded call outside SwapSheet and a projectHome copy count; SwapSheet and an import do not', () => {
    const src = "import { leastLoaded } from './accountPicker';\nexport const home = (a: A[]) => leastLoaded(a, a);\n";
    expect(run(placementCopiesIn, src, 'pwa/src/fleet/NewSessionSheet.tsx').map((s) => s.kind)).toEqual(['leastLoaded']);
    expect(run(placementCopiesIn, src, 'pwa/src/fleet/SwapSheet.tsx')).toEqual([]);
    expect(run(placementCopiesIn, 'export function projectHome(a: A[]) { return a[0]; }\n').map((s) => s.kind)).toEqual(['definition']);
  });

  it('viewerWordsAsPresence: each identifier occurrence counts; a comment and a look-alike name do not', () => {
    const got = run(viewerWordsAsPresenceIn, [
      "import { PRESENCE_TTL_MS } from '../../shared/api';",
      '// PRESENCE_REFRESH_MS in a comment',
      'export const ttl = PRESENCE_TTL_MS * 2;',
      'export const presenceOf = 1;',
    ].join('\n'), 'server/src/fixture.ts');
    expect(got.map((s) => [s.kind, s.line])).toEqual([['PRESENCE_TTL_MS', 1], ['PRESENCE_TTL_MS', 3]]);
  });
});

describe('W7 PWA census: REAL rows (reporting, not ratcheting; spec §5.1 rule 3)', () => {
  // Pinned exact by C7b (D-7180, D-7221): #1720 merged, and the fleet store's `fetchAccounts` default is the one call.
  // The may-only-shrink ratchet is `rings/pwa-one-owner.test.ts`'s one-owner block.
  it('accountsReaders(): 1 call of api.accounts, the fleet store\'s fetchAccounts default', () => {
    const sites = accountsReaders();
    held('accountsReaders', sites, 1);
    expect(sites.map((s) => s.file)).toEqual(['pwa/src/stores/fleet.ts']);
  });

  it('inlineDeadChecks(): 0 comparisons of a status with dead outside fleet/presence.ts (C7c, D-7181)', () => {
    const sites = inlineDeadChecks();
    held('inlineDeadChecks', sites, 0);
  });

  it('coordPresenceSites(): 0 (coordPresence deleted, C7c; its callers read fleet/presence.ts#coordinatorPresence)', () => {
    const sites = coordPresenceSites();
    held('coordPresenceSites', sites, 0);
  });

  // Desktop-polish Task G2 added three: the programme box's own matches (fleetTree's `claimed` index, programmeBoxes'
  // claim map, and rowRun's call of runForSession).
  // C7d (D-7182): `runCard`'s two card lookups (D-7205) report as named, beside the new readers' by-id lookups,
  // `workerOf`'s one (D-7205) and `coordinatorOf`'s one (D-7207).
  it('runMatchers(): 0 inline comparisons, 0 map lookups, runForSession 0 calls, childRunsSeen 1; 4 named by-id lookups in the readers', () => {
    const sites = runMatchers();
    held('runMatchers', sites.filter((s) => s.kind !== 'named'), 1);
    expect(countBy(sites, (s) => s.kind)).toEqual({ childRunsSeen: 1, named: 4 });
  });

  // Pinned exact by C7b (D-7180, D-7221): #1720 merged, leaving `HotFilesStrip`'s and `useFleetHealth`'s timers, which
  // C7m takes. The ratchet is `rings/pwa-one-owner.test.ts`'s one-owner block.
  it('requestPolls(): 0 hand-written request polls (HotFilesStrip and useFleetHealth are on usePoll, C7m)', () => {
    const sites = requestPolls();
    held('requestPolls', sites, 0);
    expect(sites.map((s) => s.file)).toEqual([]);
  });

  // C7e (D-7183): EnvelopeSheet's busy comes from the answer lifecycle (Step 4), DialogSheet's writes are the
  // lifecycle's commands, performed in one place (Step 5), and push-sw.js's request is its generated region (Step 7,
  // OA-C17 (a), D-7265), which no hand-written answer request is left beside.
  it('answerPaths(): 1 (the answer lifecycle\'s performer)', () => {
    const sites = answerPaths();
    held('answerPaths', sites, 1);
    expect(countBy(sites, (s) => s.kind)).toEqual({ reducer: 1 });
  });

  // C7e Step 5 (D-7183): each answer kind's state moves into the answer lifecycle in its own commit.
  it('dialogSheetStates(): 3 useState calls inside DialogSheet (otherFor, focusNonce, raiseMark)', () => {
    held('dialogSheetStates', dialogSheetStates(), 3);
  });

  // C7f (D-7184): the sheets read the wire's pairing, and the nine definitions are deleted.
  it('clientPairingDefinitions(): 0 (from 9: the seven pairing functions and constant, prefixMatches and norm)', () => {
    held('clientPairingDefinitions', clientPairingDefinitions(), 0);
  });

  it('paneTextDecisions(): 1 (from 2: COMPACTION_RE deleted by C7i, D-7187; showsPrompt stays)', () => {
    held('paneTextDecisions', paneTextDecisions(), 1);
  });

  // Exact on the merged tree: #1715 (one bucket vocabulary) landed before this task, so no band.
  // C7j (D-7188): `RANK` reads `shared/api.ts#BUCKET_RANK`, which the query reads too, and `STATUS_GROUPS` lost its
  // `order` (the status table reads `BUCKET_ORDER`): 2 -> 1.
  it('bucketOrders(): 1 (from 2: shared/api.ts#BUCKET_RANK, the one order)', () => {
    const sites = bucketOrders();
    held('bucketOrders', sites, 1);
    expect(sites.map((s) => `${s.file}#${s.symbol}`)).toEqual(['shared/api.ts#BUCKET_RANK']);
  });

  // C7j Step 5 (D-7188, OA-C15 (a)): the 8 sites read `shared/api.ts#isArchivedRow`, the archived bucket or cleanup.
  it('archivedChecks(): 0 (from 8: every site reads isArchivedRow)', () => {
    held('archivedChecks', archivedChecks(), 0);
  });

  // C9 (D-6441) gave FleetScreen and Instrument's FleetTable one session opener (`fleet/openers.ts`): their two
  // literals became one, 14 in 12 files to 13 in 11. C7k (D-7189) moved the 13 onto `lib/routes.ts#sessionPath`, whose
  // own template is the one the query still sees.
  it('sessionPathLiterals(): 1, sessionPath\'s own template, and 0 (from 13) outside it', () => {
    const sites = sessionPathLiterals();
    show('sessionPathLiterals', sites);
    expect(sites.map((s) => `${s.file}#${s.symbol}`)).toEqual([SESSION_PATH_OWNER]);
    held('sessionPathLiterals outside sessionPath', sites.filter((s) => `${s.file}#${s.symbol}` !== SESSION_PATH_OWNER), 0);
  });

  // C7k (D-7189): the six owners (five calls and ResumeSheet's default) read `session/useEnsure.ts`, whose
  // `ensureSession` is the one call.
  it('ensureCallers(): 1 (from 6) owner of api.ensure, useEnsure.ts#ensureSession\'s call', () => {
    const sites = ensureCallers();
    held('ensureCallers', sites, 1);
    expect(sites.map((s) => `${s.file}#${s.symbol}`)).toEqual([ENSURE_OWNER]);
    expect(countBy(sites, (s) => s.kind)).toEqual({ call: 1 });
  });

  // C7l (D-7190) adds the one storage port, `lib/storage.ts`, which names `window.localStorage` and declares the one
  // storage type (and its in-memory instance's `getItem`); its own sites are held exactly, and the owners and types
  // outside it are the count each owner's move lowers.
  it('storageOwners(): the port, and 11 files outside it naming localStorage, none sessionStorage', () => {
    const sites = storageOwners();
    show('storageOwners', sites);
    expect(sites.filter((s) => s.file === STORAGE_PORT).map((s) => s.symbol)).toEqual(['pageStorage']);
    const outside = sites.filter((s) => s.file !== STORAGE_PORT);
    held('storageOwners outside lib/storage.ts', outside, 11);
    expect(countBy(outside, (s) => s.kind)).toEqual({ localStorage: 11 });
  });

  it('storageTypes(): the port\'s StoragePort and its in-memory instance, and 1 local storage type outside it', () => {
    const sites = storageTypes();
    show('storageTypes', sites);
    expect(sites.filter((s) => s.file === STORAGE_PORT).map((s) => s.symbol)).toEqual(['(module)', 'memoryStorage']);
    held('storageTypes outside lib/storage.ts', sites.filter((s) => s.file !== STORAGE_PORT), 1);
  });

  it('pageClockSubscriptions(): 1 visibilitychange, 1 online', () => {
    const sites = pageClockSubscriptions();
    held('pageClockSubscriptions', sites, 2);
    expect(countBy(sites, (s) => s.kind)).toEqual({ visibilitychange: 1, online: 1 });
  });

  it('singleReaders(): api.feed 1, api.runs 1, api.projects 1 (calls and member references)', () => {
    const sites = singleReaders();
    held('singleReaders', sites, 3);
    expect(countBy(sites, (s) => s.kind.split(':')[0]!)).toEqual({ feed: 1, runs: 1, projects: 1 });
  });

  // The K15 exit, met on main and pinned here (plan item 16).
  it('placementCopies(): 0', () => {
    held('placementCopies', placementCopies(), 0);
  });

  it('viewerWordsAsPresence(): the viewer constants and the defer-derived identifiers, by name', () => {
    const sites = viewerWordsAsPresence();
    const byName = countBy(sites, (s) => s.kind);
    console.log(`census-w7 viewerWordsAsPresence: ${sites.length} ${JSON.stringify(byName)}`);
    held('viewerWordsAsPresence', sites, 62);
    expect(byName).toEqual({
      PRESENCE_REFRESH_MS: 3, PRESENCE_TTL_MS: 3, PRESENCE_OPEN_TTL_MS: 7,
      presenceHeldSince: 7, lastPresenceWallAt: 7, lastPresenceDeferredAt: 7, firstPresenceDeferredAt: 9, collectAfterPresence: 4,
      presenceSince: 5, childReclaimPresenceWithin: 3, CollectPresence: 2, CHILD_RECLAIM_PRESENCE_GAP_PASSES: 2, CHILD_RECLAIM_PRESENCE_DEFERS: 3,
    });
  });
});

// C7q (D-7212): the transcript copy's reading and a usable question envelope, one definition each.
describe('W7 PWA census, C7q: transcriptCopyRules (D-7212)', () => {
  it('FIXTURE: each rule counts once, at its innermost function; a call of the shared rule and a half rule do not', () => {
    const got = run(transcriptCopyRulesIn, [
      'export function readCopy(a: A | undefined): Q | null {',
      "  if (a === undefined || a.question.trim() === '' || a.options.some((o) => o === null)) return null;",
      '  return a;',
      '}',
      'export function outer(e: E): boolean {',
      "  const usable = (x: E): boolean => x.questions.length > 0 && x.questions[0]!.question.trim() !== '';",
      '  return usable(e);',
      '}',
      'export function caller(a: A): boolean { return transcriptQuestion(a.ask) !== null && usableQuestions(a); }',
      "export function half(a: A): boolean { return a.question.trim() === ''; }",
      'export function other(e: E): boolean { return e.questions.length > 0; }',
    ].join('\n'), 'server/src/fixture.ts');
    expect(got.map((s) => [s.kind, s.symbol])).toEqual([['copy', 'readCopy'], ['usable', 'outer.usable']]);
  });

  it('REAL: 2 sites, one copy and one usable, both in shared/ask-menu.ts', () => {
    const sites = transcriptCopyRules();
    held('transcriptCopyRules', sites, 2);
    expect(sites.map((s) => [s.kind, `${s.file}#${s.symbol}`])).toEqual([
      ['copy', 'shared/ask-menu.ts#transcriptQuestion'], ['usable', 'shared/ask-menu.ts#usableQuestions'],
    ]);
  });
});

// C7i (D-7187; OA-C16 (a)): Claude Code's prompt glyph has one pane-text spelling. Imported in the block, so the file's
// header imports stay as other tasks append to them.
describe('W7 PWA census: the prompt glyph\'s pane-text spellings (C7i, D-7187)', () => {
  it('FIXTURE promptGlyphSpellings: a string that is the glyph counts; the glyph in a regex, a longer string and JSX text do not', async () => {
    const { promptGlyphSpellingsIn } = await import('./pwa.js');
    const got = run(promptGlyphSpellingsIn, [
      "export const PROMPT_GLYPH = '❯';",
      "export function startsWithPromptGlyph(row: string): boolean { return row.startsWith('❯'); }",
      'const OPTION_RE = /^\\s*(❯)?\\s*(\\d+)\\.\\s+(.+)$/;',
      "const hint = '❯ 1. Yes';",
      'export const Row = () => <span>❯</span>;',
    ].join('\n'));
    // A module-scope binding is not a symbol (`scan/parse.ts`), so the constant's site is `(module)`.
    expect(got.map((s) => [s.symbol, s.text, s.line])).toEqual([['(module)', "'❯'", 1], ['startsWithPromptGlyph', "'❯'", 2]]);
  });

  it('REAL promptGlyphSpellings(): 1 (from 2: drawerView.ts\'s PROMPT_GLYPH and dialog.ts#startsWithPromptGlyph import shared/pane-glyph.ts)', async () => {
    const { promptGlyphSpellings } = await import('./pwa.js');
    const sites = promptGlyphSpellings();
    held('promptGlyphSpellings', sites, 1);
    expect(sites.map((s) => `${s.file}#${s.symbol}`)).toEqual(['shared/pane-glyph.ts#(module)']);
  });
});

// C7g (D-7185, D-7485; ARCH-57 #792, PWA half): the PWA answers operator questions through one writer,
// `lib/api.ts#answerQuestion`, on W3 Q3f's door. Its counted exit is the old writers' names in code (10 on the base, 0
// at the tip) and the old doors' paths, which survive only in the skew table a server without `questions-v1` is
// answered through, and in push-sw.js's render of it. Imported in the block, so the file's header imports stay as other
// tasks append to them.
describe('W7 PWA census: the operator answer doors (C7g, D-7185, D-7485)', () => {
  it('FIXTURE oldAnswerWriters: a definition, a call, a member reference and a Pick key count; answerDialogTab, a comment and an import do not', async () => {
    const { oldAnswerWritersIn } = await import('./pwa.js');
    const got = run(oldAnswerWritersIn, [
      "import { answerAsk } from './x';",
      'export const api = { answerDialog: async (id: string) => post(id), answerDialogTab: async (id: string) => post(id) };',
      '// api.answerDialogMulti(id, d, [1]) in a comment',
      'export function Sheet() { void api.answerDialogText(id, d, 1, t); const f = seam.answerDialogMulti; void api.answerDialogTab(id, r); }',
      "export type Seam = Pick<Api, 'answerDialog' | 'answerQuestion'>;",
    ].join('\n'), 'pwa/src/fixture.ts');
    expect(got.map((s) => [s.kind, s.line])).toEqual([['reference', 2], ['call', 4], ['reference', 4], ['name', 5]]);
  });

  it('FIXTURE oldAnswerDoorPaths: an old door in a template counts as a door, in the skew table and the region by their kinds; /dialog/tab and the family do not', async () => {
    const { oldAnswerDoorPathsIn } = await import('./pwa.js');
    const ts = [
      'export const writer = (id: string) => post(`${sid(id)}/dialog/multi`, {});',
      "export const LEGACY_ANSWER_DOORS = { ask: '/ask', row: '/dialog' } as const;",
      'export const tab = (id: string) => post(`${sid(id)}/dialog/tab`, {});',
      "export const family = (id: string) => post('/api/questions/session-' + id + '/answer', {});",
    ].join('\n');
    expect(run(oldAnswerDoorPathsIn, ts, 'pwa/src/fixture.ts').map((s) => [s.kind, s.line])).toEqual([['door', 1], ['skew-table', 2], ['skew-table', 2]]);
    const sw = [
      "const a = fetch('/api/sessions/' + sid + '/ask');",
      '// ccrc:generated answer-lifecycle BEGIN',
      "const b = '/api/sessions/' + encodeURIComponent(sid) + '/ask';",
      '// ccrc:generated answer-lifecycle END',
    ].join('\n');
    expect(run(oldAnswerDoorPathsIn, sw, PUSH_SW).map((s) => [s.kind, s.line])).toEqual([['door', 1], ['region', 3]]);
  });

  it('REAL oldAnswerWriters(): 0 (from 10): no pwa/src code names answerDialog, answerDialogText, answerDialogMulti or answerAsk', async () => {
    const { oldAnswerWriters } = await import('./pwa.js');
    held('oldAnswerWriters', oldAnswerWriters(), 0);
  });

  it('REAL oldAnswerDoorPaths(): 5 (from 9): the skew table\'s 4 and the region\'s 1; no door anywhere else', async () => {
    const { oldAnswerDoorPaths } = await import('./pwa.js');
    const sites = oldAnswerDoorPaths();
    held('oldAnswerDoorPaths', sites, 5);
    expect(sites.map((s) => [s.kind, s.file])).toEqual([
      ['skew-table', 'pwa/src/session/answerLifecycle.ts'], ['skew-table', 'pwa/src/session/answerLifecycle.ts'],
      ['skew-table', 'pwa/src/session/answerLifecycle.ts'], ['skew-table', 'pwa/src/session/answerLifecycle.ts'],
      ['region', PUSH_SW],
    ]);
  });
});
