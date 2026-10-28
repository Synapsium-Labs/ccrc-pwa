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
  accountsReaders, accountsReadersIn, answerPaths, answerPathsIn, archivedChecks, archivedChecksIn, bucketOrders, bucketOrdersIn,
  clientPairingDefinitions, clientPairingDefinitionsIn, coordPresenceSites, coordPresenceSitesIn, countBy, dialogSheetStates,
  dialogSheetStatesIn, ensureCallers, ensureCallersIn, fixture, inlineDeadChecks, inlineDeadChecksIn, pageClockSubscriptions,
  pageClockSubscriptionsIn, paneTextDecisions, paneTextDecisionsIn, placementCopies, placementCopiesIn, PUSH_SW, requestPolls,
  requestPollsIn, runMatchers, runMatchersIn, sessionPathLiterals, sessionPathLiteralsIn, showSite, singleReaders, singleReadersIn,
  storageOwners, storageOwnersIn, storageTypes, storageTypesIn, viewerWordsAsPresence, viewerWordsAsPresenceIn, type W7Site,
} from './pwa.js';

const F = 'pwa/src/fixture.tsx';
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
  // BAND (D-7221): floor 1 is #1720's head (the store's one call), ceiling 5 today's. Pinned exact by C7b once #1720
  // has merged (its shrunk Step 2).
  it('accountsReaders(): 5 calls of api.accounts at the base (band 1..5 until #1720 merges, C7b pins it)', () => {
    held('accountsReaders', accountsReaders(), 1, 5);
  });

  it('inlineDeadChecks(): 16 comparisons of a status with dead, in 9 files', () => {
    const sites = inlineDeadChecks();
    held('inlineDeadChecks', sites, 16);
    expect(Object.keys(countBy(sites, (s) => s.file)).length).toBe(9);
  });

  it('coordPresenceSites(): 1 definition, 3 calls, 2 answers compared with dead', () => {
    const sites = coordPresenceSites();
    held('coordPresenceSites', sites, 6);
    expect(countBy(sites, (s) => s.kind)).toEqual({ definition: 1, call: 3, 'answer-dead': 2 });
  });

  it('runMatchers(): 4 inline comparisons, 7 map lookups, runForSession 7 calls, childRunsSeen 1', () => {
    const sites = runMatchers();
    held('runMatchers', sites, 19);
    expect(countBy(sites, (s) => s.kind)).toEqual({ comparison: 4, lookup: 7, runForSession: 7, childRunsSeen: 1 });
  });

  // BAND (D-7221): floor 2 is #1720's head (`HotFilesStrip`, `useFleetHealth`), ceiling 6 today's. Pinned exact by C7b
  // once #1720 has merged; C7m then takes the last two.
  it('requestPolls(): 6 hand-written request polls at the base (band 2..6 until #1720 merges, C7b pins it)', () => {
    held('requestPolls', requestPolls(), 2, 6);
  });

  it('answerPaths(): 3 (DialogSheet\'s writes, EnvelopeSheet\'s busy, push-sw.js\'s one handler)', () => {
    const sites = answerPaths();
    held('answerPaths', sites, 3);
    expect(countBy(sites, (s) => s.kind)).toEqual({ writer: 1, busy: 1, 'push-sw': 1 });
  });

  it('dialogSheetStates(): 11 useState calls inside DialogSheet', () => {
    held('dialogSheetStates', dialogSheetStates(), 11);
  });

  it('clientPairingDefinitions(): 9, prefixMatches and norm among them', () => {
    held('clientPairingDefinitions', clientPairingDefinitions(), 9);
  });

  it('paneTextDecisions(): 2 (COMPACTION_RE, showsPrompt)', () => {
    held('paneTextDecisions', paneTextDecisions(), 2);
  });

  // Exact on the merged tree: #1715 (one bucket vocabulary) landed before this task, so no band.
  it('bucketOrders(): 2 (RANK, STATUS_GROUPS)', () => {
    held('bucketOrders', bucketOrders(), 2);
  });

  it('archivedChecks(): 8 absence checks on archivedAt', () => {
    held('archivedChecks', archivedChecks(), 8);
  });

  // C9 (D-6441) gave FleetScreen and Instrument's FleetTable one session opener (`fleet/openers.ts`): their two
  // literals became one, 14 in 12 files to 13 in 11.
  it('sessionPathLiterals(): 13 string expressions starting /s/, in 11 files', () => {
    const sites = sessionPathLiterals();
    held('sessionPathLiterals', sites, 13);
    expect(Object.keys(countBy(sites, (s) => s.file)).length).toBe(11);
  });

  it('ensureCallers(): 6 owners of api.ensure (5 calls, 1 member reference)', () => {
    const sites = ensureCallers();
    held('ensureCallers', sites, 6);
    expect(countBy(sites, (s) => s.kind)).toEqual({ call: 5, reference: 1 });
  });

  it('storageOwners(): 10 files naming localStorage, none sessionStorage', () => {
    const sites = storageOwners();
    held('storageOwners', sites, 11);
    expect(countBy(sites, (s) => s.kind)).toEqual({ localStorage: 11 });
  });

  it('storageTypes(): 1 local storage type', () => {
    held('storageTypes', storageTypes(), 1);
  });

  it('pageClockSubscriptions(): 10 visibilitychange, 2 online', () => {
    const sites = pageClockSubscriptions();
    held('pageClockSubscriptions', sites, 12);
    expect(countBy(sites, (s) => s.kind)).toEqual({ visibilitychange: 10, online: 2 });
  });

  it('singleReaders(): api.feed 2, api.runs 2, api.projects 3 (calls and member references)', () => {
    const sites = singleReaders();
    held('singleReaders', sites, 7);
    expect(countBy(sites, (s) => s.kind.split(':')[0]!)).toEqual({ feed: 2, runs: 2, projects: 3 });
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
