// Child reclamation, wave 3 — the server's half (spec 2026-09-22 §5.5–§5.7,
// §5.9): the fourteen box words and what each means, the two ccd documents
// read, the pure close decision, and THE ONE EXECUTOR `reclaimChild`, driven
// end to end against a fixture registry, a real CoordStore and a scripted ccd.
//
// The runner is `testDeps`', so every argv the executor composes crosses the
// agent's REAL exec whitelist first (`guardRunner`) — a `ws-reclaim` without
// its `--expect` grant would throw here, not merely on the fleet.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, MAIL_CHILD_RECLAIMED_ERROR, type OpenSiblingsResult } from '../src/coord/store.js';
import {
  CHILD_RECLAIM_TOKEN_KIND, childReclaimDecision, childReclaimRowListing, isChildReclaimDeferWhy,
  parseChildReclaimAudit, parseChildReclaimResult, reclaimChild, type ChildReclaimDecisionInput,
  type ChildReclaimDeps, type ChildReclaimToken,
} from '../src/coord/childReclaim.js';
import { NotifyLog } from '../src/notifylog.js';
import { readSessionRecord } from '../src/registry.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { SENTENCES } from '../src/wsaudit.js';
import { testDeps } from './helpers.js';
import { CCD } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'demo-quiet-basin';
const TOK = 'a'.repeat(64);
const WIP = 'b'.repeat(40);
/** A box that advertises the verb, its capability and the dec flags. */
const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-audit', 'ws-reclaim', 'reclaim-v1', 'actor-flags-v1'] };

const auditDoc = (childOf: number, verdict: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ id: ID, mode: 'reclaim', childOf, verdict, detail: '', ...extra });
const reclaimedDoc = (childOf: number, wip: string | null = null, secretsDropped: unknown = 0): string =>
  JSON.stringify({ reclaimed: ID, childOf, wip, attic: 2, residueBytes: null, secretsDropped });

interface Script { audit?: { code: number; stdout: string; stderr?: string }; verb?: { code: number; stdout: string; stderr?: string } }

/** A child workspace on disk (registry fields + `.child`), its minting run
 *  CLOSED in a real CoordStore, one outstanding delivery addressed to it, and
 *  a scripted ccd. `mark` overrides the marker's bytes; `null` writes none.
 *  `markSymlink` plants `.child` as a symlink instead (amendment A8): `'dangling'`
 *  points nowhere, `'live'` points at a sibling file holding this run's own id. */
const rig = async (over: { mark?: string | null; markSymlink?: 'dangling' | 'live'; script?: (runId: number) => Script;
                           fleetState?: FleetState; visible?: boolean; row?: boolean; now?: number } = {}) => {
  const home = mkTmp('ccrc-child-reclaim-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 2, claimedBy: 'demo-coordinator' });
  if (!('id' in opened)) throw new Error('openRun refused');
  const runId = opened.id;
  coord.markDispatched(runId, ID, ID, 'ws/quiet-basin', false);
  expect(coord.closeRun({ runId, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p',
    viaClosing: false }).ok).toBe(true);
  if (over.row !== false) {
    const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`,
      started: '1', workspace: ID, branch: 'ws/quiet-basin', base: 'origin/main' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
    if (over.markSymlink === 'dangling') {
      symlinkSync(path.join(reg, 'no-such-target'), path.join(reg, `${ID}.child`));
    } else if (over.markSymlink === 'live') {
      const target = path.join(reg, `${ID}.child-target`);
      writeFileSync(target, String(runId));
      symlinkSync(target, path.join(reg, `${ID}.child`));
    } else {
      const mark = over.mark === undefined ? String(runId) : over.mark;
      if (mark !== null) writeFileSync(path.join(reg, `${ID}.child`), mark);
    }
  }
  const m = coord.insertMail({ fromId: 'demo-coordinator', fromUuid: 'u', toId: ID, runId: null,
    kind: 'status', subject: 's', body: 'b', artifacts: [] });
  const delivery = coord.queueDelivery(m.id, ID, '<mail/>').id;
  const script = over.script?.(runId) ?? { audit: { code: 0, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) },
                                          verb: { code: 0, stdout: reclaimedDoc(runId) } };
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const r = args[0] === 'ws-audit' ? script.audit : args[0] === 'ws-reclaim' ? script.verb : undefined;
    return r === undefined ? { code: 1, stdout: '', stderr: `unscripted ${args[0]}` }
      : { code: r.code, stdout: r.stdout, stderr: r.stderr ?? '' };
  };
  const base = testDeps(home, run);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps: ChildReclaimDeps = {
    coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
    fleetState: over.fleetState ?? CAPS,
    presence: { isVisible: (id: string) => over.visible === true && id === ID },
    notifyLog,
    ...(over.now === undefined ? {} : { now: () => over.now! }),
  };
  const feed = () => coord.feedEvents(50).filter((e) => e.sessionId === ID).map((e) => e.title);
  const bodies = () => coord.feedEvents(50).filter((e) => e.sessionId === ID).map((e) => e.body);
  const deliveryState = () => (coord.db.prepare('SELECT state, lastError FROM mail_deliveries WHERE id = ?')
    .get(delivery) as { state: string; lastError: string | null });
  return { home, reg, coord, runId, deps, calls, feed, bodies, deliveryState,
           // `deferredSinceMs` (spec §5.7, §5.9: the feed row says how long
           // it waited): `null` is close's value; a number is the sweep's
           // first deferral of this child.
           req: (deferExpired = false, deferredSinceMs: number | null = null) =>
             ({ sessionId: ID, runId, trigger: deferredSinceMs === null ? 'close' as const : 'sweep' as const,
                deferExpired, deferredSinceMs }) };
};

describe('the fourteen words', () => {
  it('are exactly the words ccd’s RECLAIM region refuses with — harvested, both directions', () => {
    const ccd = readFileSync(CCD, 'utf8');
    const begin = ccd.indexOf('RECLAIM-BEGIN');
    const end = ccd.indexOf('RECLAIM-END');
    expect(begin, 'the RECLAIM region is missing its BEGIN marker').toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    const region = ccd.slice(begin, end).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const harvested = new Set([
      ...[...region.matchAll(/_reap_refuse ([a-z][a-z-]*)/g)].map((m) => m[1]!),
      ...[...region.matchAll(/"refused":"([a-z][a-z-]*)"/g)].map((m) => m[1]!),
    ]);
    expect([...harvested].sort()).toEqual(Object.keys(CHILD_RECLAIM_TOKEN_KIND).sort());
  });

  it('the audit journals exactly the TERMINAL words — ccd’s case list equals the kind map’s terminal arm', () => {
    // `cmd_ws_audit --reclaim` writes a lifecycle line for a terminal verdict
    // ONLY (Task 5; spec §5.9 — the attention list reads terminal rows, and a
    // retryable line a pass would bury the journal); its pattern is a second
    // spelling of this map's terminal arm, in another language, so it is held
    // equal here rather than trusted. The right-hand side is DERIVED from the
    // map, never a second literal: a word the map moves between kinds moves
    // the expectation with it.
    //
    // Fix round 1, review Minor #1 (departure `r5-list-outside-region`): the
    // notes said to read this list "from the RECLAIM region ONLY", but the
    // list actually lives in `cmd_ws_audit` at ccd/ccd:12919-12921, well ABOVE
    // `RECLAIM-BEGIN` — the letter cannot be met. The intent (never let a
    // SECOND copy silently become the one compared, since `.exec` takes only
    // the first match) is what this asserts instead: `matchAll` over the
    // WHOLE file, and an exact count of one.
    const ccd = readFileSync(CCD, 'utf8');
    const matches = [...ccd.matchAll(
      /case "\$REAP_VERDICT" in\n\s+([a-z|-]+)\)\n\s+_lc_emit reclaim refused "\$id" "" verb ws-audit/g,
    )];
    expect(matches, 'cmd_ws_audit no longer journals a terminal reclaim refusal, or a second site appeared')
      .toHaveLength(1);
    const terminal = Object.entries(CHILD_RECLAIM_TOKEN_KIND)
      .filter(([, kind]) => kind === 'terminal').map(([token]) => token).sort();
    expect(terminal.length, 'guards the guard: an empty arm would equal an empty list').toBeGreaterThan(0);
    expect(matches[0]![1]!.split('|').sort()).toEqual(terminal);
  });

  it('every RETRY word is a defer reason, and no other word is', () => {
    for (const [token, kind] of Object.entries(CHILD_RECLAIM_TOKEN_KIND)) {
      expect(isChildReclaimDeferWhy(token), token).toBe(kind === 'retry');
    }
  });

  it('every TERMINAL word has a server sentence — the only ones a person is ever shown', () => {
    for (const [token, kind] of Object.entries(CHILD_RECLAIM_TOKEN_KIND)) {
      if (kind === 'terminal') expect(SENTENCES[token], token).toBeTypeOf('string');
    }
  });
});

describe('parseChildReclaimAudit', () => {
  it('reads a token and the run the marker names', () => {
    expect(parseChildReclaimAudit(ID, auditDoc(7, 'reclaimable', { token: TOK })))
      .toEqual({ kind: 'token', token: TOK, childOf: 7 });
  });
  it('reads a refusal by its word', () => {
    expect(parseChildReclaimAudit(ID, auditDoc(7, 'attached', { detail: 'a client' })))
      .toEqual({ kind: 'refused', token: 'attached', detail: 'a client' });
  });
  // Fix round 1, review Minor #3: symmetric with `parseChildReclaimResult`,
  // which already checks its document's `reclaimed`/`refused` id against
  // `sessionId`. Every ccd registry read prints `"id":<--session argument>`
  // first, so this is a one-line defence, not a new failure mode.
  it('an id naming ANOTHER session is unreadable, never spent on the wrong workspace', () => {
    expect(parseChildReclaimAudit(ID, auditDoc(7, 'reclaimable', { token: TOK, id: 'demo-other' })).kind)
      .toBe('unreadable');
  });
  it.each([
    ['no JSON at all', 'ccd: usage: ccd ws-audit --session <id>'],
    // `no-such-session` is a word BOTH ladders print: without the mode check
    // a plain audit's answer would read as a reclaim refusal.
    ['the PLAIN audit (no mode)', JSON.stringify({ id: ID, verdict: 'no-such-session', detail: '' })],
    ['reclaimable with no token', auditDoc(7, 'reclaimable')],
    ['reclaimable with a short token', auditDoc(7, 'reclaimable', { token: 'abc' })],
    ['reclaimable with no childOf', JSON.stringify({ id: ID, mode: 'reclaim', childOf: null, verdict: 'reclaimable', token: TOK })],
    // One run-id grammar (wave 2's `CHILD_RUN_ID`, ten ASCII digits): a
    // `childOf` no marker could carry is not a run id, however numeric.
    ['reclaimable with an eleven-digit childOf', JSON.stringify({ id: ID, mode: 'reclaim', childOf: 12345678901, verdict: 'reclaimable', token: TOK })],
    ['a verdict this build does not know', auditDoc(7, 'sensitive-ignored')],
    // The audit's unmeasured answer is a DOCUMENT, not a word the ladder
    // refuses with: read at all, it is unreadable — `failed`, like its exit 1.
    ['the unmeasured answer', auditDoc(7, 'unmeasured', { detail: 'could not read the stash list' })],
  ])('%s is unreadable — never a token, never a refusal', (_what, stdout) => {
    expect(parseChildReclaimAudit(ID, stdout).kind).toBe('unreadable');
  });
});

describe('parseChildReclaimResult', () => {
  it('reads reclaimed, with and without a WIP commit', () => {
    expect(parseChildReclaimResult(ID, reclaimedDoc(7, WIP), '')).toEqual({ kind: 'reclaimed', wip: WIP, secretsDropped: 0 });
    expect(parseChildReclaimResult(ID, reclaimedDoc(7), '')).toEqual({ kind: 'reclaimed', wip: null, secretsDropped: 0 });
  });
  // Review 170 F4: a reclaim that committed nothing but DROPPED a secret-shaped
  // edit (a hidden-flag one among them) left something uncommitted. ccd counts
  // them; anything but a non-negative integer — a missing key included — is
  // `'unreadable'`, never 0.
  it('reads secretsDropped as a count, and anything else — missing, negative, fractional, a string — as unreadable', () => {
    expect(parseChildReclaimResult(ID, reclaimedDoc(7, null, 2), '')).toEqual({ kind: 'reclaimed', wip: null, secretsDropped: 2 });
    for (const bad of [-1, 1.5, '1', null, [1]]) {
      expect(parseChildReclaimResult(ID, reclaimedDoc(7, null, bad), ''), JSON.stringify(bad))
        .toEqual({ kind: 'reclaimed', wip: null, secretsDropped: 'unreadable' });
    }
    expect(parseChildReclaimResult(ID, JSON.stringify({ reclaimed: ID, childOf: 7, wip: null, attic: 2, residueBytes: null }), ''))
      .toEqual({ kind: 'reclaimed', wip: null, secretsDropped: 'unreadable' });
  });
  // Fix round 1, review Minor #2: a SHA-256 repository pins a 64-hex commit,
  // not 40 — that must not be dropped to `null` (which would say nothing was
  // left uncommitted when work was in fact pinned). Any OTHER shape (present
  // but unattributable) is `'unreadable'`, a third state distinct from both
  // "no wip" and "a wip we can name".
  it('reads a 64-hex WIP commit (a SHA-256 repository), and calls a malformed one unreadable', () => {
    const WIP256 = 'c'.repeat(64);
    expect(parseChildReclaimResult(ID, reclaimedDoc(7, WIP256), '')).toEqual({ kind: 'reclaimed', wip: WIP256, secretsDropped: 0 });
    expect(parseChildReclaimResult(ID, reclaimedDoc(7, 'not-hex-at-all'), ''))
      .toEqual({ kind: 'reclaimed', wip: 'unreadable', secretsDropped: 0 });
    expect(parseChildReclaimResult(ID, reclaimedDoc(7, 'a'.repeat(39)), ''))
      .toEqual({ kind: 'reclaimed', wip: 'unreadable', secretsDropped: 0 });
  });
  // Fix round 2, review minor B: ONLY a literal `null` means nothing was
  // pinned. A present non-string value (a number, a boolean, an object) and
  // a MISSING key must all render `'unreadable'`, exactly like a malformed
  // string — never silently folded into "nothing uncommitted was left".
  it('a wip that is a number, boolean, object or missing is unreadable — only null means nothing pinned', () => {
    const doc = (wip: unknown) => JSON.stringify({ reclaimed: ID, childOf: 7, wip, attic: 2, residueBytes: null, secretsDropped: 0 });
    expect(parseChildReclaimResult(ID, doc(12345), '')).toEqual({ kind: 'reclaimed', wip: 'unreadable', secretsDropped: 0 });
    expect(parseChildReclaimResult(ID, doc(true), '')).toEqual({ kind: 'reclaimed', wip: 'unreadable', secretsDropped: 0 });
    expect(parseChildReclaimResult(ID, doc({ sha: WIP }), '')).toEqual({ kind: 'reclaimed', wip: 'unreadable', secretsDropped: 0 });
    expect(parseChildReclaimResult(
      ID, JSON.stringify({ reclaimed: ID, childOf: 7, attic: 2, residueBytes: null, secretsDropped: 0 }), '', // no `wip` key at all
    )).toEqual({ kind: 'reclaimed', wip: 'unreadable', secretsDropped: 0 });
    expect(parseChildReclaimResult(ID, doc(null), '')).toEqual({ kind: 'reclaimed', wip: null, secretsDropped: 0 });
  });
  it('a reclaim of ANOTHER id is a failure, not a success, and never resumable', () => {
    const out = parseChildReclaimResult('demo-other', reclaimedDoc(7), '');
    expect(out.kind).toBe('failed');
    expect(out.kind === 'failed' ? out.resumable : true).toBe(false);
  });
  it('reads a known refusal, and fails an unknown one', () => {
    expect(parseChildReclaimResult(ID, JSON.stringify({ refused: 'state-changed', detail: 'd', paths: [] }), ''))
      .toEqual({ kind: 'refused', token: 'state-changed', detail: 'd' });
    const unknown = parseChildReclaimResult(ID, JSON.stringify({ refused: 'not-archived', detail: '', paths: [] }), '');
    expect(unknown.kind).toBe('failed');
    // Fix round 2, review minor C: an unrecognised refusal word is a
    // REFUSAL in substance — nothing on the box advanced — so it is never
    // resumable, unlike a genuine post-start `{failed:…}` document.
    expect(unknown.kind === 'failed' ? unknown.resumable : true).toBe(false);
  });
  it('reads a post-start failure, and a call cut short with nothing printed — both resumable', () => {
    expect(parseChildReclaimResult(ID, JSON.stringify({ failed: 'worktree-remove-failed', detail: 'busy' }), ''))
      .toEqual({ kind: 'failed', resumable: true, detail: 'worktree-remove-failed: busy' });
    const cutShort = parseChildReclaimResult(ID, '', '');
    expect(cutShort.kind).toBe('failed');
    expect(cutShort.kind === 'failed' ? cutShort.resumable : false).toBe(true);
  });
});

describe('childReclaimDecision — has the coordinator finished with this child?', () => {
  const OPEN_NONE: OpenSiblingsResult = { ok: true, siblings: [] };
  // Every `ChildReclaimMinting` row fixture carries `dispatchStartedAt`
  // (controller ruling P7) — a plain literal here, since the pure decision
  // reads only `reviews`/`sessionId`, never this column; Task 9 is the one
  // that places a fast-path spent verdict against it before it decides.
  const base: ChildReclaimDecisionInput = {
    mark: { kind: 'child', runId: 7 },
    minting: { kind: 'row', sessionId: ID, reviews: null, dispatchStartedAt: 1_000 },
    sessionId: ID,
    siblings: OPEN_NONE, reviewed: { kind: 'none' }, final: false, state: 'done', spent: { kind: 'unasked' },
    retiresProgram: false,
  };
  /** A REVIEW child (spec §5.7, "A review child is finished later than its own run"): minted by review run 7, which reviews work run 5. */
  const REVIEW_MINTED = { kind: 'row', sessionId: ID, reviews: 5, dispatchStartedAt: 1_000 } as const;
  it.each<[string, Partial<ChildReclaimDecisionInput>, ReturnType<typeof childReclaimDecision>]>([
    ['a final close', { final: true }, { reclaim: true }],
    ['an abandon', { state: 'failed' }, { reclaim: true }],
    ['a close that retires the program', { retiresProgram: true }, { reclaim: true }],
    // Amendment A2: a spent verdict finishes the child only when its evidence
    // is PROVEN dated to THIS incarnation (`source: 'live'` is the only
    // source that can ever carry `incarnation: 'this'`) — a recycled slug
    // (spec §5.5) means unplaced evidence may belong to an earlier workspace.
    ['a spent child, its evidence PROVEN this incarnation',
      { spent: { kind: 'spent', pr: 3, source: 'live', incarnation: 'this' } }, { reclaim: true }],
    ['a spent child whose evidence is UNPLACED — not proven this incarnation, HOLDS on a non-final close',
      { spent: { kind: 'spent', pr: 3, source: 'registry', incarnation: 'unplaced' } },
      { reclaim: false, why: 'not-finished' }],
    ['a spent child whose LIVE evidence is undated (still unplaced) — HOLDS the same way',
      { spent: { kind: 'spent', pr: 3, source: 'live', incarnation: 'unplaced' } },
      { reclaim: false, why: 'not-finished' }],
    ['the ordinary non-final close', {}, { reclaim: false, why: 'not-finished' }],
    ['an unspent child', { spent: { kind: 'unspent' } }, { reclaim: false, why: 'not-finished' }],
    ['an UNMEASURED spent verdict — never read as spent', { spent: { kind: 'unmeasured', detail: 'x' } },
      { reclaim: false, why: 'not-finished' }],
    ['no marker', { mark: { kind: 'none' }, final: true }, { reclaim: false, why: 'not-a-child' }],
    ['an unreadable marker', { mark: { kind: 'unreadable' }, final: true }, { reclaim: false, why: 'marker-unreadable' }],
    ['an unreadable minting row', { minting: { kind: 'unreadable' }, final: true }, { reclaim: false, why: 'marker-unreadable' }],
    ['a minting run the database does not have', { minting: { kind: 'absent' }, final: true },
      { reclaim: false, why: 'not-a-child' }],
    ['a minting run bound to ANOTHER session',
      { minting: { kind: 'row', sessionId: 'demo-other', reviews: null, dispatchStartedAt: 1_000 }, final: true },
      { reclaim: false, why: 'not-a-child' }],
    ['a minting run bound to NO session',
      { minting: { kind: 'row', sessionId: null, reviews: null, dispatchStartedAt: 1_000 }, final: true },
      { reclaim: false, why: 'not-a-child' }],
    // Spec §5.7 — a review child is kept while the run it reviewed is open:
    // the coordinator cites the report in its clips BY PATH in fix-round mail.
    // Its two edges: a reviewed row that cannot be READ defers
    // (`marker-unreadable`), and one the database does not have is not proven
    // terminal, so it keeps the child (`review-report-live`).
    ['a REVIEW child while the run it reviewed is still open — even on a final close',
      { minting: REVIEW_MINTED, reviewed: { kind: 'row', state: 'awaiting-review' }, final: true },
      { reclaim: false, why: 'review-report-live' }],
    ['a REVIEW child once the run it reviewed is terminal — reclaimed like any other',
      { minting: REVIEW_MINTED, reviewed: { kind: 'row', state: 'done' }, final: true }, { reclaim: true }],
    ['a REVIEW child whose reviewed run the database does not have — not proven terminal, kept',
      { minting: REVIEW_MINTED, reviewed: { kind: 'absent' }, final: true }, { reclaim: false, why: 'review-report-live' }],
    ['a REVIEW child whose reviewed run cannot be read — never authorised',
      { minting: REVIEW_MINTED, reviewed: { kind: 'unreadable' }, final: true }, { reclaim: false, why: 'marker-unreadable' }],
    ['an open sibling', { siblings: { ok: true, siblings: [{ id: 9, program: 'p', wave: 2, waveOf: 3 }] }, final: true },
      { reclaim: false, why: 'siblings-open' }],
    ['an unreadable sibling list', { siblings: { ok: false, kind: 'run-unreadable', detail: 'x' }, final: true },
      { reclaim: false, why: 'siblings-unreadable' }],
  ])('%s', (_what, patch, expected) => {
    expect(childReclaimDecision({ ...base, ...patch })).toEqual(expected);
  });
});

describe('childReclaimRowListing — what the second listing found (amendment A6, fix round 1)', () => {
  // Fix round 1, review Important #1: the export must return WHAT it
  // listed — `.uuid` and `.child` reported SEPARATELY — never a caller's
  // question pre-folded into one `'listed'` word. Its own rig calls it with
  // exactly `{ io, cfg }`, never the whole `ChildReclaimDeps`, to pin the
  // narrowed dependency the fix also asked for: no `coord`/`runCcd` needed.
  const freshListingDeps = () => {
    const home = mkTmp('ccrc-child-reclaim-listing-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const { io, cfg } = testDeps(home);
    return { reg, deps: { io, cfg } };
  };
  it('unlistable: the listing itself failed, proving nothing', async () => {
    const { deps } = freshListingDeps();
    expect(await childReclaimRowListing({ ...deps, io: { ...deps.io, readdir: async () => null } }, ID))
      .toEqual({ kind: 'unlistable' });
  });
  it('neither .uuid nor .child is listed', async () => {
    const { deps } = freshListingDeps();
    expect(await childReclaimRowListing(deps, ID)).toEqual({ kind: 'listed', uuid: false, child: false });
  });
  it('.uuid only — a session identity with no child marker (P5, Task 9: `none` at close, not a child)', async () => {
    const { reg, deps } = freshListingDeps();
    writeFileSync(path.join(reg, `${ID}.uuid`), `u-${ID}`);
    expect(await childReclaimRowListing(deps, ID)).toEqual({ kind: 'listed', uuid: true, child: false });
  });
  it('.child only — a marker with no session identity (P5, Task 9: `unreadable` at close, defer)', async () => {
    const { reg, deps } = freshListingDeps();
    writeFileSync(path.join(reg, `${ID}.child`), '7');
    expect(await childReclaimRowListing(deps, ID)).toEqual({ kind: 'listed', uuid: false, child: true });
  });
  it('both .uuid and .child listed', async () => {
    const { reg, deps } = freshListingDeps();
    writeFileSync(path.join(reg, `${ID}.uuid`), `u-${ID}`);
    writeFileSync(path.join(reg, `${ID}.child`), '7');
    expect(await childReclaimRowListing(deps, ID)).toEqual({ kind: 'listed', uuid: true, child: true });
  });
});

describe('reclaimChild — the one executor', () => {
  it('audit → token → verb, then cancels the child’s mail and writes ONE feed row', async () => {
    const s = await rig();
    const out = await reclaimChild(s.deps, s.req());
    expect(out).toEqual({ kind: 'reclaimed', sessionId: ID, runId: s.runId, wip: null, secretsDropped: 0 });
    expect(s.calls).toEqual([
      ['ws-audit', '--session', ID, '--reclaim'],
      ['ws-reclaim', '--expect', TOK, '--child-of', String(s.runId), '--session', ID,
       '--surface', 'agent', '--actor', `run:${s.runId} reclaim close`],
    ]);
    expect(s.deliveryState()).toEqual({ state: 'rejected', lastError: MAIL_CHILD_RECLAIMED_ERROR });
    expect(s.feed()).toEqual(['child reclaimed']);
  });

  // Fix round 1, review Minor #2, at the feed row: a malformed WIP does not
  // silently claim nothing was left.
  it('a malformed WIP commit renders as unreadable in the feed, not as nothing left', async () => {
    const s = await rig({ script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) },
      verb: { code: 0, stdout: JSON.stringify({ reclaimed: ID, childOf: runId, wip: 'not-a-real-sha', attic: 2, residueBytes: null }) } }) });
    const out = await reclaimChild(s.deps, s.req());
    expect(out).toMatchObject({ kind: 'reclaimed', wip: 'unreadable' });
    expect(s.bodies()[0]).toContain('its commit id could not be read');
    expect(s.bodies()[0]).not.toContain('Nothing uncommitted was left');
  });

  // Review 170 F4: the feed must not say "Nothing uncommitted was left" while
  // a secret-shaped edit — a hidden-flag one among them — was dropped.
  it.each([
    ['nothing committed, nothing dropped', null, 0, 'Nothing uncommitted was left.', null],
    ['nothing committed, one secret dropped', null, 1, 'No work was committed. 1 secret-shaped path was dropped, never committed — the record names it.', 'Nothing uncommitted was left'],
    ['nothing committed, the count unreadable', null, 'unreadable', 'Whether a secret-shaped path was dropped could not be read.', 'Nothing uncommitted was left'],
    ['a WIP, and two secrets dropped', WIP, 2, `Uncommitted work was pinned as ${WIP}. 2 secret-shaped paths were dropped, never committed — the record names them.`, 'Nothing uncommitted'],
  ] as const)('the feed row says what was left: %s', async (_what, wip, dropped, says, never) => {
    const s = await rig({ script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) },
      verb: { code: 0, stdout: reclaimedDoc(runId, wip, dropped === 'unreadable' ? null : dropped) } }) });
    const out = await reclaimChild(s.deps, s.req());
    expect(out).toMatchObject({ kind: 'reclaimed', wip, secretsDropped: dropped });
    expect(s.bodies()[0]).toContain(says);
    if (never !== null) expect(s.bodies()[0]).not.toContain(never);
  });

  it('refuses on NO evidence of the capability — the verb alone is not the token', async () => {
    for (const ccdVerbs of [null, ['ws-audit', 'ws-reclaim']]) {
      const s = await rig({ fleetState: { ...CAPS, ccdVerbs } });
      const out = await reclaimChild(s.deps, s.req());
      expect(out).toMatchObject({ kind: 'deferred', why: 'unsupported' });
      expect(s.calls, 'nothing is sent to a box that did not prove it has the verb').toEqual([]);
      expect(s.deliveryState().state).toBe('queued');
      expect(s.feed()).toEqual(['child reclaim deferred']);
    }
  });

  it.each<[string, { mark?: string | null; row?: boolean }, string]>([
    ['a marker naming ANOTHER run', { mark: '999' }, 'marker-mismatch'],
    ['no marker at all', { mark: null }, 'marker-mismatch'],
    ['an unreadable marker', { mark: 'seven' }, 'marker-unreadable'],
  ])('%s defers before any ccd call', async (_what, over, why) => {
    const s = await rig(over);
    expect(await reclaimChild(s.deps, s.req())).toMatchObject({ kind: 'deferred', why });
    expect(s.calls).toEqual([]);
  });

  // The plan's Amendment A8 (pinned at this wave's consumer): the registry's own
  // `childMarkOf` already folds a LISTED-but-unreadable `.child` into
  // `unreadable` (F4, D-3348) — a dangling symlink is exactly that shape.
  // This pins the fold at THIS consumer: no ccd call, mail stays queued.
  it('a DANGLING symlink at .child defers marker-unreadable with no ccd call, mail stays queued', async () => {
    const s = await rig({ markSymlink: 'dangling' });
    expect(await reclaimChild(s.deps, s.req())).toMatchObject({ kind: 'deferred', why: 'marker-unreadable' });
    expect(s.calls).toEqual([]);
    expect(s.deliveryState().state).toBe('queued');
  });

  // The optional second A8 case: a LIVE symlink to a file holding the run id
  // reads as `child` HERE (Node's read follows the link), while ccd's own
  // `_reg_get` refuses ANY symlink outright (`[[ ! -L … ]]`) — so the audit
  // answers `not-a-child`, terminal and safe: the two sides may disagree on
  // this one shape, and disagreeing safely is the point.
  it('a LIVE symlink to a file holding the run id reads as child — the audit then answers not-a-child (terminal, safe)', async () => {
    const s = await rig({ markSymlink: 'live',
      script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId, 'not-a-child', { detail: 'the marker is a symlink' }) } }) });
    const out = await reclaimChild(s.deps, s.req());
    expect(out).toMatchObject({ kind: 'refused', token: 'not-a-child' });
    expect(out.kind === 'refused' ? out.sentence : '').toBe(SENTENCES['not-a-child']);
    expect(s.calls.map((c) => c[0])).toEqual(['ws-audit']);
  });

  it('a registry row that is gone is `gone` — no call, no feed row, and its mail is cancelled', async () => {
    // The box half of an earlier attempt finished (the row is purged) but the
    // server never reached its cancel — a restart between, or `purge-incomplete`
    // read as `failed`. This attempt is the last one that will ever see this
    // child, so the cancel rides it.
    const s = await rig({ row: false });
    expect(await reclaimChild(s.deps, s.req())).toEqual({ kind: 'gone', sessionId: ID });
    expect(s.calls).toEqual([]);
    expect(s.feed()).toEqual([]);
    expect(s.deliveryState()).toEqual({ state: 'rejected', lastError: MAIL_CHILD_RECLAIMED_ERROR });
  });

  it('a row `readSessionRecord` DROPS is not `gone` — the second listing still names it, and its mail stays', async () => {
    // `absent` is two populations (wave 2's `childBindGate` reads it the same
    // way): no row, AND a row `buildRecord` dropped because an identity field
    // read back empty. The second is a child that may be alive.
    const s = await rig();
    writeFileSync(path.join(s.reg, `${ID}.workdir`), '');
    const probe = await readSessionRecord(s.deps.io, s.deps.cfg, ID);
    expect(probe, 'the fixture really is the DROPPED population').toEqual({ found: false, reason: 'absent' });
    expect(await reclaimChild(s.deps, s.req())).toMatchObject({ kind: 'deferred', why: 'marker-unreadable' });
    expect(s.calls).toEqual([]);
    expect(s.deliveryState().state).toBe('queued');
    // …and with NO marker listed: a dropped row whose `.uuid` is still there
    // is a session that holds this id, child or not — its mail stays too.
    const n = await rig({ mark: null });
    writeFileSync(path.join(n.reg, `${ID}.workdir`), '');
    expect(await reclaimChild(n.deps, n.req())).toMatchObject({ kind: 'deferred', why: 'marker-unreadable' });
    expect(n.deliveryState().state).toBe('queued');
  });

  // Fix round 2, review Minor A: a `.child` marker with NO `.uuid` at all —
  // the FIRST `readSessionRecord` call never even reaches a field read
  // (`absent` fires immediately on a missing `.uuid`), so this exercises the
  // SECOND listing's `.child`-only branch specifically: `again.uuid ||
  // again.child` (childReclaim.ts, the executor's own gone-check). Every
  // other fixture in this file writes `.uuid` even when it writes no
  // `.child`, so a mutant that collapsed that disjunct to `again.uuid` alone
  // stayed green until this case — it would have called this live row
  // `gone` and cancelled its mail.
  it('a .child marker with NO .uuid at all defers marker-unreadable — never gone, mail stays', async () => {
    const s = await rig({ row: false });
    writeFileSync(path.join(s.reg, `${ID}.child`), String(s.runId));
    expect(await reclaimChild(s.deps, s.req())).toMatchObject({ kind: 'deferred', why: 'marker-unreadable' });
    expect(s.calls).toEqual([]);
    expect(s.deliveryState().state).toBe('queued');
  });

  it('a SECOND listing that fails is no proof of absence — its mail stays', async () => {
    // Count the listings `readSessionRecord` itself takes on a row-less
    // registry (measured, never typed), then fail the one after them.
    const m = await rig({ row: false });
    let taken = 0;
    await readSessionRecord({ ...m.deps.io, readdir: async (d: string) => { taken += 1; return m.deps.io.readdir(d); } },
      m.deps.cfg, ID);
    const u = await rig({ row: false });
    let lists = 0;
    const deps: ChildReclaimDeps = { ...u.deps, io: { ...u.deps.io,
      readdir: async (d: string) => { lists += 1; return lists <= taken ? u.deps.io.readdir(d) : null; } } };
    expect(await reclaimChild(deps, u.req())).toMatchObject({ kind: 'deferred', why: 'marker-unreadable' });
    expect(u.deliveryState().state).toBe('queued');
  });

  it('an UNLISTABLE registry is not `gone` — its mail stays', async () => {
    // Step 1's absent arm is a MEASURED absence; a listing that failed is
    // `marker-unreadable`, and a child that may still be there keeps its mail.
    const s = await rig();
    const deps: ChildReclaimDeps = { ...s.deps, io: { ...s.deps.io, readdir: async () => null } };
    expect(await reclaimChild(deps, s.req())).toMatchObject({ kind: 'deferred', why: 'marker-unreadable' });
    expect(s.deliveryState().state).toBe('queued');
  });

  it('an open sibling defers, and an UNREADABLE sibling list defers — never read as "none"', async () => {
    const s = await rig();
    const next = s.coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 2, waveOf: 2, claimedBy: 'demo-coordinator' });
    if (!('id' in next)) throw new Error('openRun refused');
    s.coord.setSession(next.id, ID);
    expect(await reclaimChild(s.deps, s.req())).toMatchObject({ kind: 'deferred', why: 'siblings-open' });
    const u = await rig();
    u.coord.openRunsForSession = () => ({ ok: false, kind: 'run-unreadable', detail: 'runs.id unrepresentable' });
    expect(await reclaimChild(u.deps, u.req())).toMatchObject({ kind: 'deferred', why: 'siblings-unreadable' });
    expect([...s.calls, ...u.calls]).toEqual([]);
  });

  it('defers while someone is looking — and the expired defer proceeds, flag on both argvs', async () => {
    const s = await rig({ visible: true });
    expect(await reclaimChild(s.deps, s.req())).toMatchObject({ kind: 'deferred', why: 'presence' });
    expect(s.calls).toEqual([]);
    const out = await reclaimChild(s.deps, s.req(true));
    expect(out.kind).toBe('reclaimed');
    expect(s.calls.map((c) => c.includes('--defer-expired'))).toEqual([true, true]);
  });

  // Spec §5.7 ("the feed row says how long it waited and why") and §5.9
  // ("deferred with its elapsed time"): the wait rides the REQUEST, and
  // the executor renders it. Both directions pinned — a sweep deferral states
  // its wait, close's `null` states none, and the ceiling states the wait it
  // ended and why the reclaim went ahead anyway.
  const T0 = 1_800_000_000_000;
  it('a SWEEP deferral states how long the child has waited, and why; close’s null states no wait', async () => {
    const s = await rig({ visible: true, now: T0 + 7 * 60_000 + 59_000 });
    expect(await reclaimChild(s.deps, s.req(false, T0))).toMatchObject({ kind: 'deferred', why: 'presence' });
    expect(s.bodies()).toHaveLength(1);
    expect(s.bodies()[0]).toContain('reclaim deferred (presence) — someone is viewing this session.');
    expect(s.bodies()[0]).toContain('Deferred for 7 minutes so far.');
    const c = await rig({ visible: true, now: T0 });
    expect(await reclaimChild(c.deps, c.req())).toMatchObject({ kind: 'deferred', why: 'presence' });
    expect(c.bodies()[0]).not.toContain('Deferred for');
  });

  it('a CEILING-EXPIRED reclaim states the wait it ended and why it went ahead', async () => {
    const s = await rig({ visible: true, now: T0 + 16 * 60_000 });
    expect((await reclaimChild(s.deps, s.req(true, T0))).kind).toBe('reclaimed');
    expect(s.feed()).toEqual(['child reclaimed']);
    expect(s.bodies()[0]).toContain('The defer ceiling was reached after 16 minutes of deferral');
    expect(s.bodies()[0]).toContain('no longer held it back');
    // A reclaim that was never deferred says nothing about a wait.
    const plain = await rig({ now: T0 });
    await reclaimChild(plain.deps, plain.req());
    expect(plain.bodies()[0]).not.toContain('defer');
  });

  it.each<[ChildReclaimToken, string]>([
    ['containment-unproven', 'refused'], ['not-a-child', 'refused'], ['no-worktree-record', 'refused'],
    ['attached', 'deferred'], ['reap-in-progress', 'deferred'], ['no-such-session', 'gone'],
  ])('an AUDIT refusal %s is %s, and the verb is never called', async (token, kind) => {
    const s = await rig({ script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId, token, { detail: 'd' }) } }) });
    const out = await reclaimChild(s.deps, s.req());
    expect(out.kind).toBe(kind);
    if (out.kind === 'refused') expect(out.sentence).toBe(SENTENCES[token]);
    expect(s.calls.map((c) => c[0])).toEqual(['ws-audit']);
    expect(s.deliveryState().state).toBe('queued');
  });

  it('a token minted for ANOTHER run is not spent', async () => {
    const s = await rig({ script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId + 1, 'reclaimable', { token: TOK }) } }) });
    expect(await reclaimChild(s.deps, s.req())).toMatchObject({ kind: 'deferred', why: 'marker-mismatch' });
    expect(s.calls.map((c) => c[0])).toEqual(['ws-audit']);
  });

  it('a VERB refusal or failure leaves the mail alone — the child is still there', async () => {
    const refused = await rig({ script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) },
      verb: { code: 0, stdout: JSON.stringify({ refused: 'state-changed', detail: 'the tree moved', paths: [] }) } }) });
    expect(await reclaimChild(refused.deps, refused.req())).toMatchObject({ kind: 'deferred', why: 'state-changed' });
    expect(refused.deliveryState().state).toBe('queued');
    const failed = await rig({ script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) },
      verb: { code: 1, stdout: JSON.stringify({ failed: 'worktree-remove-failed', detail: 'busy' }) } }) });
    const out = await reclaimChild(failed.deps, failed.req());
    // Fix round 1, review Minor #4 (corrected fix round 2 minor C): a
    // `{failed:…}` document genuinely started ccd's tail, so it IS
    // resumable — its own breadcrumb resumes it — and the feed text says so.
    expect(out).toMatchObject({ kind: 'failed', resumable: true, detail: 'worktree-remove-failed: busy' });
    expect(failed.deliveryState().state).toBe('queued');
    expect(failed.feed()).toEqual(['child reclaim failed']);
    expect(failed.bodies()[0]).toContain('the box resumes where it stopped');
  });

  // Fix round 1, review Minor #6: a coverage gap — both paths already run
  // through code other cases test only at parse level. Fix round 2, review
  // minor C: both are REFUSALS in substance — ccd's ladder never advanced
  // this session's state — so neither is resumable, and neither may promise
  // "the box resumes where it stopped".
  it('a verb reclaimed document naming ANOTHER id is a failure, not a success — mail stays, never resumable', async () => {
    const s = await rig({ script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) },
      verb: { code: 0, stdout: JSON.stringify({ reclaimed: 'demo-other', childOf: runId, wip: null, attic: 2, residueBytes: null }) } }) });
    const out = await reclaimChild(s.deps, s.req());
    expect(out).toMatchObject({ kind: 'failed', resumable: false });
    expect(out.kind === 'failed' ? out.detail : '').toContain('demo-other');
    expect(s.deliveryState().state).toBe('queued');
    expect(s.feed()).toEqual(['child reclaim failed']);
    expect(s.bodies()[0]).toContain('It is retried from the start.');
    expect(s.bodies()[0]).not.toContain('resumes where it stopped');
  });

  it('an unrecognised verb refusal word is not resumable — nothing on the box advanced', async () => {
    const s = await rig({ script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) },
      verb: { code: 0, stdout: JSON.stringify({ refused: 'a-word-this-build-does-not-know', detail: 'd', paths: [] }) } }) });
    const out = await reclaimChild(s.deps, s.req());
    expect(out).toMatchObject({ kind: 'failed', resumable: false });
    expect(s.bodies()[0]).toContain('It is retried from the start.');
    expect(s.bodies()[0]).not.toContain('resumes where it stopped');
  });

  it('a verb-level refused: no-such-session is gone, with no cancel and no feed row', async () => {
    const s = await rig({ script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) },
      verb: { code: 0, stdout: JSON.stringify({ refused: 'no-such-session', detail: 'raced with a purge', paths: [] }) } }) });
    expect(await reclaimChild(s.deps, s.req())).toEqual({ kind: 'gone', sessionId: ID });
    expect(s.deliveryState().state).toBe('queued');
    expect(s.feed()).toEqual([]);
  });

  it('an audit the box could not answer is a failure, never resumable', async () => {
    const s = await rig({ script: () => ({ audit: { code: 1, stdout: '', stderr: 'ccd: python3 unavailable' } }) });
    const out = await reclaimChild(s.deps, s.req());
    expect(out).toMatchObject({ kind: 'failed', resumable: false });
    // Fix round 1, review Minor #4: nothing on the box's destructive path
    // started, so the feed must not promise a resume.
    expect(s.bodies()[0]).toContain('It is retried from the start.');
    expect(s.bodies()[0]).not.toContain('resumes where it stopped');
  });

  it('the failed feed text never doubles the final punctuation', async () => {
    const s = await rig({ script: () => ({ audit: { code: 1, stdout: '', stderr: 'ccd: something failed.' } }) });
    await reclaimChild(s.deps, s.req());
    expect(s.bodies()[0]).not.toContain('..');
  });

  // Fix round 2, review minor C: an empty `detail` on a `{failed:…}` document
  // must not render "…failed: ." — the separator is dropped, not left dangling.
  it('a failed document with an EMPTY detail never renders "failed: ."', async () => {
    const s = await rig({ script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) },
      verb: { code: 1, stdout: JSON.stringify({ failed: 'worktree-remove-failed', detail: '' }) } }) });
    const out = await reclaimChild(s.deps, s.req());
    expect(out.kind === 'failed' ? out.detail : '').toBe('worktree-remove-failed');
    expect(s.bodies()[0]).not.toContain('failed: .');
  });

  it('an audit that EXITS 1 is failed whatever it printed — its unmeasured document, and even a token', async () => {
    // The audit's unmeasured answer is a reclaim document with
    // `"verdict":"unmeasured"` at exit 1 (Task 5). The exit status is read
    // BEFORE a byte is parsed, so no exit-1 document — a token-bearing one
    // included — is ever spent.
    const u = await rig({ script: (runId) => ({ audit: { code: 1,
      stdout: auditDoc(runId, 'unmeasured', { detail: 'could not read the stash list' }),
      stderr: 'ccd: ws-audit --reclaim measured nothing: could not read the stash list — retry' } }) });
    const out = await reclaimChild(u.deps, u.req());
    expect(out).toMatchObject({ kind: 'failed', resumable: false });
    expect(out.kind === 'failed' ? out.detail : '').toContain('measured nothing');
    expect(u.feed()).toEqual(['child reclaim failed']);
    const t = await rig({ script: (runId) => ({ audit: { code: 1, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) } }) });
    expect(await reclaimChild(t.deps, t.req())).toMatchObject({ kind: 'failed', resumable: false });
    expect(t.calls.map((c) => c[0]), 'the verb was never called on an exit-1 token').toEqual(['ws-audit']);
    expect(t.deliveryState().state).toBe('queued');
  });

  it('with no feed log the reclaim still happens', async () => {
    const s = await rig();
    const { notifyLog: _dropped, ...noLog } = s.deps;
    expect((await reclaimChild(noLog, s.req())).kind).toBe('reclaimed');
    expect(s.feed()).toEqual([]);
  });
});
