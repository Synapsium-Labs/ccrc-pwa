// Child reclamation, wave 3 — the server's half (spec 2026-09-22 §5.5–§5.7,
// §5.9): the fourteen box words and what each means, the two ccd documents
// read, the pure close decision, and THE ONE EXECUTOR `reclaimChild`, driven
// end to end against a fixture registry, a real CoordStore and a scripted ccd.
//
// The runner is `testDeps`', so every argv the executor composes crosses the
// agent's REAL exec whitelist first (`guardRunner`) — a `ws-reclaim` without
// its `--expect` grant would throw here, not merely on the fleet.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, MAIL_CHILD_RECLAIMED_ERROR, type OpenSiblingsResult } from '../src/coord/store.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { CHILD_BIRTH_SKEW_MS } from '../src/coord/childSpent.js';
import {
  CHILD_RECLAIM_TOKEN_KIND, childReclaimDecision, childReclaimRowListing, isChildReclaimDeferWhy,
  childReclaimReleaseActor, parseChildReclaimAudit, parseChildReclaimResult, reclaimChild, releaseRetiredChildHold,
  type ChildReclaimDecisionInput, type ChildReclaimDeps, type ChildReclaimReleaseRequest, type ChildReclaimToken,
} from '../src/coord/childReclaim.js';
import { NotifyLog } from '../src/notifylog.js';
import { readSessionRecord } from '../src/registry.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { SENTENCES } from '../src/wsaudit.js';
import { LC_REASON_MAX_BYTES, holdReason } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { CCD } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';

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
    expect(parseChildReclaimResult(ID, reclaimedDoc(7, WIP), ''))
      .toEqual({ kind: 'reclaimed', wip: { kind: 'commit', sha: WIP }, secretsDropped: 0 });
    expect(parseChildReclaimResult(ID, reclaimedDoc(7), ''))
      .toEqual({ kind: 'reclaimed', wip: { kind: 'none' }, secretsDropped: 0 });
  });
  // Review 170 F4: a reclaim that committed nothing but DROPPED a secret-shaped
  // edit (a hidden-flag one among them) left something uncommitted. ccd counts
  // them; anything but a non-negative integer — a missing key included — is
  // `'unreadable'`, never 0.
  it('reads secretsDropped as a count, and anything else — missing, negative, fractional, a string — as unreadable', () => {
    expect(parseChildReclaimResult(ID, reclaimedDoc(7, null, 2), ''))
      .toEqual({ kind: 'reclaimed', wip: { kind: 'none' }, secretsDropped: 2 });
    for (const bad of [-1, 1.5, '1', null, [1]]) {
      expect(parseChildReclaimResult(ID, reclaimedDoc(7, null, bad), ''), JSON.stringify(bad))
        .toEqual({ kind: 'reclaimed', wip: { kind: 'none' }, secretsDropped: 'unreadable' });
    }
    expect(parseChildReclaimResult(ID, JSON.stringify({ reclaimed: ID, childOf: 7, wip: null, attic: 2, residueBytes: null }), ''))
      .toEqual({ kind: 'reclaimed', wip: { kind: 'none' }, secretsDropped: 'unreadable' });
  });
  // Fix round 1, review Minor #2: a SHA-256 repository pins a 64-hex commit,
  // not 40 — that must not be dropped to `null` (which would say nothing was
  // left uncommitted when work was in fact pinned). Any OTHER shape (present
  // but unattributable) is `'unreadable'`, a third state distinct from both
  // "no wip" and "a wip we can name".
  it('reads a 64-hex WIP commit (a SHA-256 repository), and calls a malformed one unreadable', () => {
    const WIP256 = 'c'.repeat(64);
    expect(parseChildReclaimResult(ID, reclaimedDoc(7, WIP256), ''))
      .toEqual({ kind: 'reclaimed', wip: { kind: 'commit', sha: WIP256 }, secretsDropped: 0 });
    expect(parseChildReclaimResult(ID, reclaimedDoc(7, 'not-hex-at-all'), ''))
      .toEqual({ kind: 'reclaimed', wip: { kind: 'unreadable' }, secretsDropped: 0 });
    expect(parseChildReclaimResult(ID, reclaimedDoc(7, 'a'.repeat(39)), ''))
      .toEqual({ kind: 'reclaimed', wip: { kind: 'unreadable' }, secretsDropped: 0 });
  });
  // Fix round 2, review minor B: ONLY a literal `null` means nothing was
  // pinned. A present non-string value (a number, a boolean, an object) and
  // a MISSING key must all render `'unreadable'`, exactly like a malformed
  // string — never silently folded into "nothing uncommitted was left".
  it('a wip that is a number, boolean, object or missing is unreadable — only null means nothing pinned', () => {
    const doc = (wip: unknown) => JSON.stringify({ reclaimed: ID, childOf: 7, wip, attic: 2, residueBytes: null, secretsDropped: 0 });
    expect(parseChildReclaimResult(ID, doc(12345), '')).toEqual({ kind: 'reclaimed', wip: { kind: 'unreadable' }, secretsDropped: 0 });
    expect(parseChildReclaimResult(ID, doc(true), '')).toEqual({ kind: 'reclaimed', wip: { kind: 'unreadable' }, secretsDropped: 0 });
    expect(parseChildReclaimResult(ID, doc({ sha: WIP }), '')).toEqual({ kind: 'reclaimed', wip: { kind: 'unreadable' }, secretsDropped: 0 });
    expect(parseChildReclaimResult(
      ID, JSON.stringify({ reclaimed: ID, childOf: 7, attic: 2, residueBytes: null, secretsDropped: 0 }), '', // no `wip` key at all
    )).toEqual({ kind: 'reclaimed', wip: { kind: 'unreadable' }, secretsDropped: 0 });
    expect(parseChildReclaimResult(ID, doc(null), '')).toEqual({ kind: 'reclaimed', wip: { kind: 'none' }, secretsDropped: 0 });
  });
  it('a reclaim of ANOTHER id is a failure, not a success, and never resumable', () => {
    const out = parseChildReclaimResult('demo-other', reclaimedDoc(7), '');
    expect(out.kind).toBe('failed');
    expect(out.kind === 'failed' ? out.resume : 'resumable').toBe('not-resumable');
  });
  it('reads a known refusal, and fails an unknown one', () => {
    expect(parseChildReclaimResult(ID, JSON.stringify({ refused: 'state-changed', detail: 'd', paths: [] }), ''))
      .toEqual({ kind: 'refused', token: 'state-changed', detail: 'd' });
    const unknown = parseChildReclaimResult(ID, JSON.stringify({ refused: 'not-archived', detail: '', paths: [] }), '');
    expect(unknown.kind).toBe('failed');
    // Fix round 2, review minor C: an unrecognised refusal word is a
    // REFUSAL in substance — nothing on the box advanced — so it is never
    // resumable, unlike a genuine post-start `{failed:…}` document.
    expect(unknown.kind === 'failed' ? unknown.resume : 'resumable').toBe('not-resumable');
  });
  it('reads a post-start failure, and a call cut short with nothing printed — both resumable', () => {
    expect(parseChildReclaimResult(ID, JSON.stringify({ failed: 'worktree-remove-failed', detail: 'busy' }), ''))
      .toEqual({ kind: 'failed', resume: 'resumable', detail: 'worktree-remove-failed: busy' });
    const cutShort = parseChildReclaimResult(ID, '', '');
    expect(cutShort.kind).toBe('failed');
    expect(cutShort.kind === 'failed' ? cutShort.resume : 'not-resumable').toBe('resumable');
  });

  // `probe-unmeasured` is the presence rungs' own in-lock tmux probe (spec
  // §5.7's rungs 5/6) failing BEFORE any act — unlike every other post-start
  // `{failed:…}` document, the destructive tail never started (spec §5.6:
  // no breadcrumb can exist until it does), so a retry has nothing to resume
  // from and starts completely afresh — the SAME sentence an unrecognised
  // refusal word already gets ('not-resumable'), never `resumable`'s
  // "resumes where it stopped" promise.
  it('maps the in-lock probe-unmeasured failure to not-resumable — a retry starts afresh, never resumable', () => {
    const out = parseChildReclaimResult(ID, JSON.stringify({ failed: 'probe-unmeasured', detail: 'tmux unreachable' }), '');
    expect(out).toEqual({ kind: 'failed', resume: 'not-resumable', detail: 'probe-unmeasured: tmux unreachable' });
    // Every OTHER post-start failure word stays `resumable` — this is a
    // narrow exception for this one word, not a wider default flip.
    const other = parseChildReclaimResult(ID, JSON.stringify({ failed: 'attic-pin-failed', detail: 'x' }), '');
    expect(other).toEqual({ kind: 'failed', resume: 'resumable', detail: 'attic-pin-failed: x' });
  });

  // Parity: the ONE word this file special-cases must still be the word ccd
  // actually prints. A ccd rename would silently return this exception to
  // ordinary `resumable` handling with no red anywhere else, because
  // `parseChildReclaimResult` never fails to parse a `{failed:…}` document —
  // it just stops recognising the special case.
  it("the special-cased word is ccd's own — `_ws_reclaim_failed_json probe-unmeasured`", () => {
    const ccd = readFileSync(CCD, 'utf8');
    expect(ccd).toContain('_ws_reclaim_failed_json probe-unmeasured');
  });

  // Review 170 F20: a PRE-LOCK die of `cmd_ws_reclaim` — recognised POSITIVELY
  // against ccd's own stderr text, never guessed from the exit status alone —
  // is `resume: 'pre-lock-die'`, distinct from every other non-resumable
  // failure above. Read straight from ccd/ccd's RECLAIM region (the region
  // above `_ws_reclaim_locked`), so a reworded die reds this case rather than
  // silently drifting back to `resume: 'resumable'`.
  describe('a pre-lock die of cmd_ws_reclaim', () => {
    const ccdSrc = readFileSync(CCD, 'utf8');
    const region = ccdSrc.slice(ccdSrc.indexOf('\ncmd_ws_reclaim() {'), ccdSrc.indexOf('\n_ws_reclaim_fork() {'));
    // Extract the exact literal a ccd `die "..."` (or `_lc_refuse`'s trailing
    // message argument) prints — ANCHORED to the call itself (review 170 fr-I
    // m3), never the first quoted string that happens to contain `needle`: a
    // comment quoting a die's text ABOVE the die itself would otherwise become
    // the pinned subject, silently. A message ccd builds with an interpolated
    // variable (only the lock path today) is returned up to the `$`, its
    // fixed prefix.
    const dieMessage = (needle: string): string => {
      const re = /\bdie "((?:[^"\\]|\\.)*)"|_lc_refuse\s+reclaim\s+"\$id"\s+\S+[\s\\]*"((?:[^"\\]|\\.)*)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(region)) !== null) {
        const text = m[1] ?? m[2];
        if (text.includes(needle)) {
          const dollar = text.indexOf('$');
          return dollar === -1 ? text : text.slice(0, dollar);
        }
      }
      throw new Error(`no die("...")/_lc_refuse(...) call in the RECLAIM region contains ${JSON.stringify(needle)}`);
    };
    // The SIX single-line dies' needles, shared by the positive case below
    // and the EXTENDED-die case (review 170 fr-I rereview-r1 I2: the first
    // round's extended case covered only 2 of 6, leaving 4 patterns' `$`
    // anchors unpinned individually — reusing one list makes that impossible).
    const SINGLE_LINE_NEEDLES: readonly [string, string][] = [
      ['usage', 'usage: ccd ws-reclaim'],
      ['bad token', 'bad token'],
      ['bad run id', 'bad run id'],
      ['bad session id', 'bad session id'],
      ['python3 unavailable', 'cannot quote the reclaim record safely'],
      ['flock unavailable', 'flock (util-linux) is unavailable'],
    ];
    it.each(SINGLE_LINE_NEEDLES)('%s is resume: "pre-lock-die", and the detail is ccd\'s own message', (_what, needle) => {
      const msg = dieMessage(needle);
      const out = parseChildReclaimResult(ID, '', `ccd: ${msg}`);
      expect(out).toEqual({ kind: 'failed', resume: 'pre-lock-die', detail: msg });
    });
    // Review 170 fr-I I2 (and its rereview-r1 residual): the end anchors are
    // what make "a reworded die reds" true for a rewording that EXTENDS the
    // message (ccd adds detail to a die rather than changing it) — an
    // unanchored `^bad token` would still match `bad token (want 64 hex)`.
    // ALL SIX needles, not a subset: dropping any ONE pattern's `$` must red
    // exactly that die's case here.
    it.each(SINGLE_LINE_NEEDLES)('an EXTENDED %s die (ccd appends detail) is NOT recognised', (_what, needle) => {
      const msg = dieMessage(needle);
      const out = parseChildReclaimResult(ID, '', `ccd: ${msg} (extra detail ccd could add)`);
      expect(out).toEqual({ kind: 'failed', resume: 'resumable',
        detail: `ccd: ${msg} (extra detail ccd could add)` });
    });
    it('an UNRECOGNISED non-JSON stderr stays resume: "resumable" — a post-lock abort has empty stdout too', () => {
      const out = parseChildReclaimResult(ID, '', 'ccd: worktree-remove-failed: device busy');
      expect(out).toEqual({ kind: 'failed', resume: 'resumable',
        detail: 'ccd: worktree-remove-failed: device busy' });
    });
    it('reclaimChild renders the recur sentence, not "retried from the start" or "resumes where it stopped"', async () => {
      const msg = dieMessage('bad token');
      const s = await rig({ script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) },
        verb: { code: 1, stdout: '', stderr: `ccd: ${msg}` } }) });
      const out = await reclaimChild(s.deps, s.req());
      expect(out).toMatchObject({ kind: 'failed', resume: 'pre-lock-die', detail: msg });
      // Review 170 fr-I rereview-r1 m2: the sentence must be true of the
      // THIRD family too (lock-unopenable, below), which "the call's own
      // arguments, or ccd/python3/flock" is not — so it names no cause at
      // all and leaves that to `detail` (asserted via `msg` above).
      expect(s.bodies()[0]).toContain('ccd refused the call before anything started');
      expect(s.bodies()[0]).toContain('it refuses the same way every time until that changes');
      expect(s.bodies()[0]).not.toContain('the problem is on the box');
      expect(s.bodies()[0]).not.toContain("the call's own arguments");
      expect(s.bodies()[0]).not.toContain('resumes where it stopped');
      expect(s.bodies()[0]).not.toContain('It is retried from the start.');
    });

    // Review 170 fr-I I1: the lock-unopenable die's REAL shape, measured by
    // running the ACTUAL committed verb in a fixture HOME with the lock path
    // turned into a directory — never a hand-typed stderr string. The old
    // synthetic `ccd: cannot open the reap lock at <prefix>` this replaced
    // pinned a shape ccd never emits (a single line): bash's OWN redirection
    // diagnostic always comes first.
    describe('the lock-unopenable die, measured for real', () => {
      let h: PrHarness;
      beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-lockdie-'); });
      afterEach(() => { h.cleanup(); });

      it('is recognised from the REAL captured stdout/stderr/exit, and gets the SAME feed sentence', async () => {
        makeChild(h);
        const tok = evalOf(h).token;
        const lockPath = path.join(h.home, '.cc-sessions', `.reap-${CHILD_ID}.lock`);
        mkdirSync(lockPath, { recursive: true });
        const r = childReclaimVerb(h, tok);
        expect(r.code, r.stderr).toBe(1);
        expect(r.stdout).toBe('');
        expect(r.stderr).toContain(`cannot open the reap lock at ${lockPath}`);
        const out = parseChildReclaimResult(CHILD_ID, r.stdout, r.stderr);
        expect(out).toEqual({ kind: 'failed', resume: 'pre-lock-die',
          detail: `cannot open the reap lock at ${lockPath}` });
        // Review 170 fr-I rereview-r1 m2: the feed sentence for THIS die,
        // fed from the REAL captured stderr — never a synthetic string —
        // must be the same cause-neutral sentence as every other pre-lock
        // die, and must not name "ccd, python3 or flock" (none of which
        // caused this one: a lock/registry-directory state did).
        const s = await rig({ script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) },
          verb: { code: r.code, stdout: r.stdout, stderr: r.stderr } }) });
        const feedOut = await reclaimChild(s.deps, s.req());
        expect(feedOut).toMatchObject({ kind: 'failed', resume: 'pre-lock-die' });
        expect(s.bodies()[0]).toContain('ccd refused the call before anything started');
        expect(s.bodies()[0]).toContain('it refuses the same way every time until that changes');
        expect(s.bodies()[0]).not.toContain('ccd, python3 or flock');
        expect(s.bodies()[0]).not.toContain('the problem is on the box');
      });
    });

    // The shape's boundary, from the REAL template above (never itself a
    // hand-invented shape): the final line and every preceding line must
    // name the SAME lock path, and nothing may follow the final line.
    it('a bash diagnostic naming a DIFFERENT path than ccd\'s own line is not recognised', () => {
      const stderr = '/x/ccd: line 25912: /other/path.lock: Is a directory\n'
        + 'ccd: cannot open the reap lock at /real/path.lock';
      const out = parseChildReclaimResult(ID, '', stderr);
      expect(out).toEqual({ kind: 'failed', resume: 'resumable', detail: stderr });
    });
    it('trailing content after ccd\'s own line is not recognised', () => {
      const stderr = '/x/ccd: line 25912: /real/path.lock: Is a directory\n'
        + 'ccd: cannot open the reap lock at /real/path.lock\n'
        + 'something else';
      const out = parseChildReclaimResult(ID, '', stderr);
      expect(out).toEqual({ kind: 'failed', resume: 'resumable', detail: stderr });
    });
    it('ccd\'s own line with NO preceding bash diagnostic is still recognised (zero-or-more)', () => {
      const out = parseChildReclaimResult(ID, '', 'ccd: cannot open the reap lock at /real/path.lock');
      expect(out).toEqual({ kind: 'failed', resume: 'pre-lock-die', detail: 'cannot open the reap lock at /real/path.lock' });
    });
    // Review 170 fr-I rereview-r1, "New Minor": the last-line pattern's `^`
    // start anchor was correct in the shipped code but UNPINNED — no case
    // exercised a final line with content BEFORE `ccd: `. `.exec` with no
    // `^` searches anywhere in the string, so a line like `x ccd: cannot
    // open the reap lock at /p` would be admitted and `.slice('ccd: '.length)`
    // would then cut mid-string, returning a garbled detail.
    it('a final line with content BEFORE "ccd: " is not recognised (the last-line start anchor)', () => {
      const stderr = 'x ccd: cannot open the reap lock at /real/path.lock';
      const out = parseChildReclaimResult(ID, '', stderr);
      expect(out).toEqual({ kind: 'failed', resume: 'resumable', detail: stderr });
    });
  });
});

describe('childReclaimDecision — has the coordinator finished with this child?', () => {
  const OPEN_NONE: OpenSiblingsResult = { ok: true, siblings: [] };
  // Every `ChildReclaimMinting` row fixture carries `sessionBornAt`/
  // `sessionBornFor`/`dispatchStartedAt` (migration 16/migration 5) — a
  // plain literal here, since the pure decision reads only
  // `reviews`/`sessionId`, never these columns; Task 9 is the one that places
  // a fast-path spent verdict against them before it decides.
  const base: ChildReclaimDecisionInput = {
    mark: { kind: 'child', runId: 7 },
    minting: { kind: 'row', sessionId: ID, reviews: null, sessionBornAt: 1_000, sessionBornFor: ID,
               dispatchStartedAt: 1_000 },
    sessionId: ID,
    siblings: OPEN_NONE, reviewed: { kind: 'none' }, final: false, state: 'done', spent: { kind: 'unasked' },
    spentFastPath: false, hasCoordinated: false,
    retiresProgram: false,
  };
  /** A REVIEW child (spec §5.7, "A review child is finished later than its own run"): minted by review run 7, which reviews work run 5. */
  const REVIEW_MINTED = { kind: 'row', sessionId: ID, reviews: 5, sessionBornAt: 1_000, sessionBornFor: ID,
                           dispatchStartedAt: 1_000 } as const;
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
      { reclaim: false, why: 'not-finished-undated' }],
    ['a spent child whose LIVE evidence is undated (still unplaced) — HOLDS the same way',
      { spent: { kind: 'spent', pr: 3, source: 'live', incarnation: 'unplaced' } },
      { reclaim: false, why: 'not-finished-undated' }],
    ['the ordinary non-final close', {}, { reclaim: false, why: 'not-finished' }],
    ['an unspent child', { spent: { kind: 'unspent' } }, { reclaim: false, why: 'not-finished' }],
    // Spec §5.3's `-merge-commit` word: a fast-path spent (registry/`.prhistory`)
    // whose live re-date came back `unspent` — the merge-commit path — holds
    // with a different word than the ordinary unspent hand-over above.
    ['an unspent child, but the fast path triggered its re-date',
      { spent: { kind: 'unspent' }, spentFastPath: true }, { reclaim: false, why: 'not-finished-merge-commit' }],
    ['an UNMEASURED spent verdict — never read as spent', { spent: { kind: 'unmeasured', detail: 'x' } },
      { reclaim: false, why: 'not-finished-unmeasured' }],
    ['a child that has EVER coordinated a run — never reclaimed automatically, even on a final close',
      { hasCoordinated: true, final: true }, { reclaim: false, why: 'has-coordinated' }],
    // `hasCoordinated: 'unreadable'` folds into
    // `siblings-unreadable` at the SAME place the sibling check itself
    // ranks — never ahead of the identity checks above it.
    ['an unreadable coordination-history read, alone, folds where the sibling check ranks',
      { hasCoordinated: 'unreadable', final: true }, { reclaim: false, why: 'siblings-unreadable' }],
    ['an unreadable coordination-history read on a NON-CHILD — not-a-child still ranks first',
      { mark: { kind: 'none' }, hasCoordinated: 'unreadable', final: true }, { reclaim: false, why: 'not-a-child' }],
    ['no marker', { mark: { kind: 'none' }, final: true }, { reclaim: false, why: 'not-a-child' }],
    ['an unreadable marker', { mark: { kind: 'unreadable' }, final: true }, { reclaim: false, why: 'marker-unreadable' }],
    ['an unreadable minting row', { minting: { kind: 'unreadable' }, final: true }, { reclaim: false, why: 'marker-unreadable' }],
    ['a minting run the database does not have', { minting: { kind: 'absent' }, final: true },
      { reclaim: false, why: 'not-a-child' }],
    ['a minting run bound to ANOTHER session',
      { minting: { kind: 'row', sessionId: 'demo-other', reviews: null, sessionBornAt: 1_000,
                    sessionBornFor: 'demo-other', dispatchStartedAt: 1_000 }, final: true },
      { reclaim: false, why: 'not-a-child' }],
    ['a minting run bound to NO session',
      { minting: { kind: 'row', sessionId: null, reviews: null, sessionBornAt: 1_000, sessionBornFor: null,
                    dispatchStartedAt: 1_000 }, final: true },
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
    expect(out).toEqual({ kind: 'reclaimed', sessionId: ID, runId: s.runId, wip: { kind: 'none' }, secretsDropped: 0 });
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
    expect(out).toMatchObject({ kind: 'reclaimed', wip: { kind: 'unreadable' } });
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
    const wipShape = wip === null ? { kind: 'none' } : { kind: 'commit', sha: wip };
    expect(out).toMatchObject({ kind: 'reclaimed', wip: wipShape, secretsDropped: dropped });
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
    expect(out).toMatchObject({ kind: 'failed', resume: 'resumable', detail: 'worktree-remove-failed: busy' });
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
    expect(out).toMatchObject({ kind: 'failed', resume: 'not-resumable' });
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
    expect(out).toMatchObject({ kind: 'failed', resume: 'not-resumable' });
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
    expect(out).toMatchObject({ kind: 'failed', resume: 'not-resumable' });
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
    expect(out).toMatchObject({ kind: 'failed', resume: 'not-resumable' });
    expect(out.kind === 'failed' ? out.detail : '').toContain('measured nothing');
    expect(u.feed()).toEqual(['child reclaim failed']);
    const t = await rig({ script: (runId) => ({ audit: { code: 1, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) } }) });
    expect(await reclaimChild(t.deps, t.req())).toMatchObject({ kind: 'failed', resume: 'not-resumable' });
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

// releaseRetiredChildHold — the hold-release job (spec §5.7's "no hold"
// conjunct, once its accounting has retired). Unit-level, driven straight
// against the export rather than through the sweep: what is only provable
// HERE is that the job's OWN re-reads — the row, the accounting, the
// programme's open-run count, the child's siblings and its coordination
// history — each independently gate the release, before ccd is ever called.
// `child-reclaim-sweep.test.ts` proves the SWEEP-side timing (two consecutive
// passes, the in-flight guard, the ordinary path picking up afterward).
describe('releaseRetiredChildHold — the hold-release job', () => {
  const RID = 'demo-quiet-basin';

  /** A minimal registry row plus a real `CoordStore` — no journal, no mirror:
   *  the job reads the mirror only to place the birth of a session that has
   *  coordinated. `row` defaults to a live one; pass `false` to omit it (the
   *  "the row is gone" case). */
  const rrig = async (over: {
    fleetState?: FleetState;
    script?: (id: string) => { code: number; stdout: string; stderr?: string };
    row?: false;
  } = {}) => {
    const home = mkTmp('ccrc-child-release-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const calls: string[][] = [];
    const run: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args[0] !== 'ws-release') return { code: 1, stdout: '', stderr: `unscripted ${args[0]}` };
      const s = over.script?.(RID) ?? { code: 0, stdout: `released ${RID}\n` };
      return { code: s.code, stdout: s.stdout, stderr: s.stderr ?? '' };
    };
    const base = testDeps(home, run);
    const deps: ChildReclaimDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
      fleetState: over.fleetState ?? { connected: true, downSince: null, rosterFp: null, build: null,
        ccdVerbs: ['ws-release', 'actor-flags-v1'] } };
    const writeRow = (fields: Record<string, string>): void => {
      const base2: Record<string, string> = { uuid: `u-${RID}`, wrapper: 'claude', project: 'demo',
        workdir: `/w/${RID}`, workspace: 'quiet-basin', branch: 'ws/quiet-basin', base: 'origin/main',
        started: '1', ...fields };
      for (const [k, v] of Object.entries(base2)) writeFileSync(path.join(reg, `${RID}.${k}`), v);
    };
    if (over.row !== false) writeRow({});
    return { home, reg, coord, deps, calls, writeRow };
  };

  /** A terminal run of `program`, WAVE 1, its own hold text — the open/dispatch
   *  claim — and the close-claim rendering `holdReason(program, 2, null, null)`
   *  the caller ordinarily plants as the row's `.hold` (the non-final close's
   *  own claim, the shape `childReclaimHoldRead` matches most often). */
  const terminalRun = (coord: CoordStore, program: string): number => {
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    expect(coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'test', handoffCommit: null,
      program, viaClosing: false }).ok).toBe(true);
    return r.id;
  };

  it('every re-read agrees: composes ws-release and answers released', async () => {
    const f = await rrig();
    const runId = terminalRun(f.coord, 'demo');
    const reason = holdReason('demo', 2, null, null);
    f.writeRow({ child: String(runId), hold: reason });
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program: 'demo', accountedRunId: runId };
    expect(await releaseRetiredChildHold(f.deps, req)).toBe('released');
    expect(f.calls).toEqual([['ws-release', '--session', RID,
      '--surface', 'agent', '--actor', `run:${runId} reclaim sweep: program demo retired`]]);
  });

  // ccd refuses an `--actor` over `LC_REASON_MAX_BYTES` bytes, and a
  // programme name written before today's route shaping may be any length:
  // the actor is shortened to fit, so the release is not failed on every pass.
  it('a very long programme name is cut inside the actor, which stays within ccd\'s cap — and the release still runs', async () => {
    const f = await rrig();
    const program = `${'p'.repeat(300)}${'é'.repeat(400)}`;
    // Today's `openRun` refuses such a name, so the legacy row is written the
    // way only an older build could have: straight into the run's column.
    const runId = terminalRun(f.coord, 'demo');
    const db = (f.coord as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): unknown } } }).db;
    db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES (?, 'legacy', 0, 'done')").run(program);
    db.prepare('UPDATE runs SET program = ? WHERE id = ?').run(program, runId);
    const reason = holdReason(program, 2, null, null);
    f.writeRow({ child: String(runId), hold: reason });
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program, accountedRunId: runId };
    expect(await releaseRetiredChildHold(f.deps, req)).toBe('released');
    const actor = f.calls[0]![f.calls[0]!.indexOf('--actor') + 1]!;
    expect(Buffer.byteLength(actor, 'utf8')).toBeLessThanOrEqual(LC_REASON_MAX_BYTES);
    expect(actor).toMatch(new RegExp(`^run:${runId} reclaim sweep: program p{300}é+… retired$`));
    // …and an ordinary name is never touched.
    expect(childReclaimReleaseActor(7, 'demo')).toBe('run:7 reclaim sweep: program demo retired');
  });

  it('ccd\'s own idempotent no-op — the hold was already gone on the box — answers not-held', async () => {
    const f = await rrig({ script: () => ({ code: 0, stdout: `not held ${RID}\n` }) });
    const runId = terminalRun(f.coord, 'demo');
    const reason = holdReason('demo', 2, null, null);
    f.writeRow({ child: String(runId), hold: reason });
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program: 'demo', accountedRunId: runId };
    expect(await releaseRetiredChildHold(f.deps, req)).toBe('not-held');
  });

  it('a non-zero ccd exit answers failed, never changed', async () => {
    const f = await rrig({ script: () => ({ code: 1, stdout: '', stderr: 'boom' }) });
    const runId = terminalRun(f.coord, 'demo');
    const reason = holdReason('demo', 2, null, null);
    f.writeRow({ child: String(runId), hold: reason });
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program: 'demo', accountedRunId: runId };
    expect(await releaseRetiredChildHold(f.deps, req)).toBe('failed');
  });

  it('a box that does not advertise ws-release answers failed and never calls ccd — gated exactly as the close route gates it', async () => {
    const f = await rrig({ fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: ['actor-flags-v1'] } });
    const runId = terminalRun(f.coord, 'demo');
    const reason = holdReason('demo', 2, null, null);
    f.writeRow({ child: String(runId), hold: reason });
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program: 'demo', accountedRunId: runId };
    expect(await releaseRetiredChildHold(f.deps, req)).toBe('failed');
    expect(f.calls).toEqual([]);
  });

  it('(iv) the hold text changed before the job ran — no release', async () => {
    const f = await rrig();
    const runId = terminalRun(f.coord, 'demo');
    const reason = holdReason('demo', 2, null, null);
    f.writeRow({ child: String(runId), hold: reason });
    // The row's OWN current text has since moved on — a human overwrote it,
    // or a fresh dispatch re-held it — after this job was queued with the
    // OLDER `reason` byte-captured at the deciding pass.
    writeFileSync(path.join(f.reg, `${RID}.hold`), 'a human wrote this over it');
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program: 'demo', accountedRunId: runId };
    expect(await releaseRetiredChildHold(f.deps, req)).toBe('changed');
    expect(f.calls, 'no argv composed once the byte re-check disagreed').toEqual([]);
  });

  it('(v) a run of that programme opened between the passes — no release', async () => {
    const f = await rrig();
    const runId = terminalRun(f.coord, 'demo');
    const reason = holdReason('demo', 2, null, null);
    f.writeRow({ child: String(runId), hold: reason });
    // A fresh wave of the SAME programme opened after the deciding pass —
    // the programme is open again, so the count re-check must catch it even
    // though the row's held text and the accounted run are both unchanged.
    const r2 = f.coord.openRun({ program: 'demo', title: 'demo', project: 'demo', wave: 2, waveOf: null,
      claimedBy: 'demo-coord' });
    if (!('id' in r2)) throw new Error(`openRun r2 refused: ${JSON.stringify(r2)}`);
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program: 'demo', accountedRunId: runId };
    expect(await releaseRetiredChildHold(f.deps, req)).toBe('changed');
    expect(f.calls, 'no argv composed once the count re-check disagreed').toEqual([]);
  });

  it('(iv′) the accounting re-read catches an accounted run whose own fields moved on, even though the held text on disk is unchanged', async () => {
    const f = await rrig();
    const runId = terminalRun(f.coord, 'demo');
    const reason = holdReason('demo', 2, null, null);   // R.wave+1's rendering AT the deciding pass
    f.writeRow({ child: String(runId), hold: reason });
    // A terminal run's own wave never actually moves in the live system —
    // this is engineered specifically to prove the job re-derives the
    // rendering from R's CURRENT fields rather than trusting the cached
    // `reason` a second time: with the accounting re-read deleted, a job that
    // only re-checks BYTES (this test's `reason` is still byte-identical to
    // the row's current text) would release against evidence that no longer
    // proves anything once R's own row has moved on.
    f.coord.db.prepare('UPDATE runs SET wave = ? WHERE id = ?').run(5, runId);
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program: 'demo', accountedRunId: runId };
    expect(await releaseRetiredChildHold(f.deps, req)).toBe('changed');
    expect(f.calls, 'no argv composed once the re-derived rendering disagreed').toEqual([]);
  });

  it('(vi) a lost database — the accounted run is absent — answers changed, never released', async () => {
    const f = await rrig();
    const reason = 'program:ghost wave:2';
    f.writeRow({ child: '999', hold: reason });
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId: 999, reason, program: 'ghost', accountedRunId: 999 };
    expect(await releaseRetiredChildHold(f.deps, req)).toBe('changed');
    expect(f.calls).toEqual([]);
  });

  it('the marker no longer names this run — no release', async () => {
    const f = await rrig();
    const runId = terminalRun(f.coord, 'demo');
    const other = terminalRun(f.coord, 'demo-other');
    const reason = holdReason('demo', 2, null, null);
    f.writeRow({ child: String(other), hold: reason });   // re-bound to a different run since
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program: 'demo', accountedRunId: runId };
    expect(await releaseRetiredChildHold(f.deps, req)).toBe('changed');
  });

  it('the row is gone entirely — a listable registry that no longer names this session — no release', async () => {
    const f = await rrig({ row: false });
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId: 1, reason: 'program:demo wave:2',
      program: 'demo', accountedRunId: 1 };
    expect(await releaseRetiredChildHold(f.deps, req)).toBe('changed');
  });

  it('an unlistable registry answers failed, never changed — a read this process could not finish is doubt, not "gone"', async () => {
    const f = await rrig();
    const runId = terminalRun(f.coord, 'demo');
    const reason = holdReason('demo', 2, null, null);
    f.writeRow({ child: String(runId), hold: reason });
    const deps: ChildReclaimDeps = { ...f.deps, io: { ...f.deps.io, readdir: async () => null } };
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program: 'demo', accountedRunId: runId };
    expect(await releaseRetiredChildHold(deps, req)).toBe('failed');
  });

  it('a run still naming this child — the child\'s own open siblings — no release', async () => {
    const f = await rrig();
    const runId = terminalRun(f.coord, 'demo');
    const reason = holdReason('demo', 2, null, null);
    f.writeRow({ child: String(runId), hold: reason });
    const sib = f.coord.openRun({ program: 'demo-other', title: 't', project: 'demo', wave: 1, waveOf: null,
      claimedBy: 'demo-coord' });
    if (!('id' in sib)) throw new Error(`openRun sib refused: ${JSON.stringify(sib)}`);
    f.coord.markDispatched(sib.id, RID, RID, 'ws/quiet-basin', false);
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program: 'demo', accountedRunId: runId };
    expect(await releaseRetiredChildHold(f.deps, req)).toBe('changed');
  });

  // K7 — step 5 is the coordination fence too (spec §1 rule 4; spec §5.6:
  // slugs recycle): a claim that ended before this generation's `create`,
  // less the skew, belongs to an earlier workspace under the same id, so a
  // retired programme's hold on this child is still released.
  it('K7: a claim that ended before this generation was born does not stop the release — released', async () => {
    const f = await rrig();
    const runId = terminalRun(f.coord, 'demo');
    const reason = holdReason('demo', 2, null, null);
    f.writeRow({ child: String(runId), hold: reason });
    const claim = f.coord.openRun({ program: 'demo-earlier', title: 't', project: 'demo', wave: 1, waveOf: null,
      claimedBy: RID });
    if (!('id' in claim)) throw new Error(`openRun claim refused: ${JSON.stringify(claim)}`);
    expect(f.coord.closeRun({ runId: claim.id, finalState: 'failed', causedBy: 'test', handoffCommit: null,
      program: 'demo-earlier', viaClosing: false }).ok).toBe(true);
    const read = f.coord.run(claim.id);
    if (!read.ok || read.run === null || read.run.closedAt === null) throw new Error('the claim has no closedAt');
    const born = read.run.closedAt + CHILD_BIRTH_SKEW_MS + 1;
    const line = JSON.stringify({ uid: 'k7.1.1', at: born, act: 'create', outcome: 'done', verb: 'ws-add', id: RID });
    f.coord.ingestJournal({ gen: '1790000000000000000', rows: [parseJournalLine(line)], cursor: 200, size: 200, at: born });
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program: 'demo', accountedRunId: runId };
    expect(await releaseRetiredChildHold({ ...f.deps, now: () => born + 1_000 }, req)).toBe('released');
    expect(f.calls.map((c) => c[0])).toEqual(['ws-release']);
  });

  it('a child with an open coordinator claim — the coordinator read — no release', async () => {
    const f = await rrig();
    const runId = terminalRun(f.coord, 'demo');
    const reason = holdReason('demo', 2, null, null);
    f.writeRow({ child: String(runId), hold: reason });
    const coordRun = f.coord.openRun({ program: 'demo-coordinated', title: 't', project: 'demo', wave: 1,
      waveOf: null, claimedBy: RID });
    if (!('id' in coordRun)) throw new Error(`openRun coordRun refused: ${JSON.stringify(coordRun)}`);
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program: 'demo', accountedRunId: runId };
    expect(await releaseRetiredChildHold(f.deps, req)).toBe('changed');
  });

  // Step 6: a release queued before an operator raised `reclaim-paused`
  // must not remove the hold the operator may have raised it to keep —
  // `cmd_ws_release` does not read the marker itself.
  it('reclaim-paused raised before the job ran — no release, and ccd is never called', async () => {
    const f = await rrig();
    const runId = terminalRun(f.coord, 'demo');
    const reason = holdReason('demo', 2, null, null);
    f.writeRow({ child: String(runId), hold: reason });
    writeFileSync(path.join(f.reg, 'reclaim-paused'), '');
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program: 'demo', accountedRunId: runId };
    expect(await releaseRetiredChildHold(f.deps, req)).toBe('changed');
    expect(f.calls).toEqual([]);
  });

  it('a switch that cannot be read — the listing fails at step 6 alone — answers failed, and ccd is never called', async () => {
    const f = await rrig();
    const runId = terminalRun(f.coord, 'demo');
    const reason = holdReason('demo', 2, null, null);
    f.writeRow({ child: String(runId), hold: reason });
    // Every read before step 6 succeeds; the listing fails only once the
    // coordinator read (step 5, the last one before it) has run.
    let pastStep5 = false;
    const original = f.coord.childReclaimCoordinatorClaims.bind(f.coord);
    vi.spyOn(f.coord, 'childReclaimCoordinatorClaims').mockImplementation(() => { pastStep5 = true; return original(); });
    const deps: ChildReclaimDeps = { ...f.deps, io: { ...f.deps.io,
      readdir: async (dir: string, timeoutMs?: number, signal?: AbortSignal) =>
        (pastStep5 ? null : f.deps.io.readdir(dir, timeoutMs, signal)) } };
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program: 'demo', accountedRunId: runId };
    expect(await releaseRetiredChildHold(deps, req)).toBe('failed');
    expect(pastStep5).toBe(true);
    expect(f.calls).toEqual([]);
  });

  it('a throwing open-siblings read answers failed, never rejects — step 4 is try-wrapped like every other read', async () => {
    const f = await rrig();
    const runId = terminalRun(f.coord, 'demo');
    const reason = holdReason('demo', 2, null, null);
    f.writeRow({ child: String(runId), hold: reason });
    const spy = vi.spyOn(f.coord, 'openRunsForSession').mockImplementation(() => { throw new Error('boom'); });
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program: 'demo', accountedRunId: runId };
    await expect(releaseRetiredChildHold(f.deps, req)).resolves.toBe('failed');
    expect(f.calls).toEqual([]);
    spy.mockRestore();
  });

  it('the accounted run is no longer terminal — the accounting re-check catches it — no release', async () => {
    const f = await rrig();
    const runId = terminalRun(f.coord, 'demo');
    const reason = holdReason('demo', 2, null, null);
    f.writeRow({ child: String(runId), hold: reason });
    // Not a live path — a terminal run's own state does not move in
    // production (see the check's own comment in `childReclaim.ts`). Isolated
    // from the COUNT re-check (step 3) on purpose: a raw `UPDATE … SET
    // state='working'` on the real row would also make `programOpenRunCount`
    // — a SEPARATE query over the same table — read the programme as open
    // again, so that mutant would be caught by step 3 regardless of step 2.
    // Only THIS read's own answer is doctored; the real row underneath stays
    // terminal, so the count re-check genuinely reads zero and cannot be
    // what catches a step-2 mutant.
    const real = f.coord.run.bind(f.coord);
    const spy = vi.spyOn(f.coord, 'run').mockImplementation((id: number) => {
      const r = real(id);
      if (id !== runId || !r.ok || r.run === null) return r;
      return { ok: true as const, run: { ...r.run, state: 'working' as const } };
    });
    const req: ChildReclaimReleaseRequest = { sessionId: RID, runId, reason, program: 'demo', accountedRunId: runId };
    expect(await releaseRetiredChildHold(f.deps, req)).toBe('changed');
    expect(f.calls).toEqual([]);
    spy.mockRestore();
  });
});
