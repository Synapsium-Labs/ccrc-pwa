// Child reclamation wave 8 — what a FAILED attempt promises about the next one
// (spec §5.6, §5.9, §7 item 6). Three readers change together:
//   - `parseChildReclaimResult`'s failed arm reads the WORD first, then wave 7's
//     additive `crumb`: `containment-refuted` is `stuck` whatever `crumb` says;
//     otherwise `crumb:false` is not-resumable and `crumb:true` is resumable
//     (the act had started); a key that is absent or not a boolean falls back
//     to the pre-crumb word set;
//   - `childReclaimAudit` reads an exit-1 document for ONE thing, the audit's
//     own `unmeasured` answer and whether it names a breadcrumb phase, and can
//     never answer a token;
//   - the feed's failed tail is one exhaustive decision, word first:
//     `purge-incomplete` has its own sentence, and so does `stuck`.
// The runner is `testDeps`', so every argv the executor composes crosses the
// agent's real exec whitelist first. Fixture HOME only (`mkTmp`).
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  CHILD_RECLAIM_FEED_QUIET_NONE, CHILD_RECLAIM_PROBE_UNMEASURED, CHILD_RECLAIM_PURGE_INCOMPLETE,
  CHILD_RECLAIM_STUCK_TOKENS, childReclaimFailedTail, childReclaimTokenKind, isChildReclaimResume,
  isChildReclaimStuckToken, parseChildReclaimAuditFailed, parseChildReclaimResult, reclaimChild,
  type ChildReclaimAuditFailedRead, type ChildReclaimDeps, type ChildReclaimRequest, type ChildReclaimResume,
} from '../src/coord/childReclaim.js';
import { isLcRefusalToken } from '../../shared/api.js';
import { NotifyLog } from '../src/notifylog.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'demo-quiet-basin';
const TOK = 'a'.repeat(64);
const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-audit', 'ws-reclaim', 'reclaim-v1', 'actor-flags-v1'] };
const ERR = 'ccd: ws-audit --reclaim measured nothing: could not read the stash list — retry';
const RESUMES = 'It is retried; the box resumes where it stopped.';
const AFRESH = 'It is retried from the start.';
/** Every `ChildReclaimResume` value, held total by the test project's typecheck. */
const ALL_RESUME = { resumable: true, 'not-resumable': true, 'pre-lock-die': true, stuck: true } satisfies
  Record<ChildReclaimResume, true>;

const read = (doc: Record<string, unknown>) => parseChildReclaimResult(ID, JSON.stringify(doc), '');

describe('parseChildReclaimResult: the word first, then crumb', () => {
  it('crumb false is not-resumable whatever the word — a pre-breadcrumb pin-failed included', () => {
    for (const w of ['pin-failed', 'tombstone-unwritable', 'worktree-remove-failed', 'a-word-a-newer-ccd-prints']) {
      expect(read({ failed: w, detail: 'd', crumb: false }), w)
        .toEqual({ kind: 'failed', resume: 'not-resumable', detail: `${w}: d`, token: w });
    }
  });

  it('crumb true is resumable whatever the word — a resumed arm’s probe-unmeasured included', () => {
    for (const w of ['probe-unmeasured', 'state-changed', 'pin-failed']) {
      expect(read({ failed: w, detail: 'd', crumb: true }), w)
        .toEqual({ kind: 'failed', resume: 'resumable', detail: `${w}: d`, token: w });
    }
  });

  it('an absent crumb falls back to the pre-crumb words', () => {
    expect(read({ failed: 'probe-unmeasured', detail: 'd' })).toMatchObject({ resume: 'not-resumable' });
    expect(read({ failed: 'state-changed', detail: 'd' })).toMatchObject({ resume: 'not-resumable' });
    expect(read({ failed: 'pin-failed', detail: 'd' })).toMatchObject({ resume: 'resumable' });
  });

  it('a crumb that is not a boolean is absence, never either value', () => {
    for (const crumb of ['true', 'false', 1, 0, null, {}, []]) {
      const c = JSON.stringify(crumb);
      expect(read({ failed: 'probe-unmeasured', detail: 'd', crumb }), c).toMatchObject({ resume: 'not-resumable' });
      expect(read({ failed: 'pin-failed', detail: 'd', crumb }), c).toMatchObject({ resume: 'resumable' });
    }
  });

  it('containment-refuted is stuck whatever crumb says, with its token', () => {
    for (const extra of [{ crumb: true }, { crumb: false }, {}]) {
      expect(read({ failed: 'containment-refuted', detail: 'd', ...extra }), JSON.stringify(extra))
        .toEqual({ kind: 'failed', resume: 'stuck', detail: 'containment-refuted: d', token: 'containment-refuted' });
    }
  });

  it('purge-incomplete is read like any word: the feed, not the parse, gives it its own sentence', () => {
    expect(read({ failed: 'purge-incomplete', detail: 'd', crumb: true }))
      .toEqual({ kind: 'failed', resume: 'resumable', detail: 'purge-incomplete: d', token: 'purge-incomplete' });
  });

  it('crumb is read on a failed document only: a refusal and a reclaimed document ignore it', () => {
    expect(read({ refused: 'not-a-child', detail: 'd', crumb: true }))
      .toEqual({ kind: 'refused', token: 'not-a-child', detail: 'd' });
    expect(read({ reclaimed: ID, wip: null, secretsDropped: 0, crumb: false })).toMatchObject({ kind: 'reclaimed' });
  });

  it('the stuck set is one journal word, never a refusal kind, and stuck is a resume value', () => {
    expect([...CHILD_RECLAIM_STUCK_TOKENS]).toEqual(['containment-refuted']);
    for (const w of CHILD_RECLAIM_STUCK_TOKENS) {
      expect(isLcRefusalToken(w), w).toBe(true);
      expect(childReclaimTokenKind(w), w).toBeNull();
    }
    expect(isChildReclaimStuckToken('containment-refuted')).toBe(true);
    expect(isChildReclaimStuckToken('worktree-remove-failed')).toBe(false);
    expect(Object.keys(ALL_RESUME).every(isChildReclaimResume)).toBe(true);
    expect(isLcRefusalToken(CHILD_RECLAIM_PURGE_INCOMPLETE)).toBe(true);
    expect(isLcRefusalToken(CHILD_RECLAIM_PROBE_UNMEASURED)).toBe(true);
  });
});

describe('parseChildReclaimAuditFailed: an exit-1 audit is read for its unmeasured answer, never a token', () => {
  const doc = (o: Record<string, unknown> = {}): string => JSON.stringify(
    { id: ID, mode: 'reclaim', childOf: 7, verdict: 'unmeasured', detail: 'could not read the stash list', ...o });
  const detail = `ws-audit --reclaim failed: ${ERR}`;

  it('unmeasured naming a breadcrumb phase is resumable', () => {
    expect(parseChildReclaimAuditFailed(ID, doc({ resume: 'worktree' }), ERR))
      .toEqual({ kind: 'unmeasured', resume: 'resumable', detail });
  });

  it('unmeasured naming no phase is not-resumable: absent, empty, or not a string', () => {
    for (const extra of [{}, { resume: '' }, { resume: null }, { resume: 3 }, { resume: ['worktree'] }]) {
      expect(parseChildReclaimAuditFailed(ID, doc(extra), ERR), JSON.stringify(extra))
        .toEqual({ kind: 'unmeasured', resume: 'not-resumable', detail });
    }
  });

  it('every other exit-1 shape is unreadable — a token-bearing document first of all', () => {
    const shapes: readonly (readonly [string, string])[] = [
      ['reclaimable, with a token', doc({ verdict: 'reclaimable', token: TOK, resume: 'worktree' })],
      ['a refusal verdict', doc({ verdict: 'not-a-child', resume: 'worktree' })],
      ['a verdict this build does not know', doc({ verdict: 'something-new', resume: 'worktree' })],
      ['another session', doc({ id: 'demo-other-basin', resume: 'worktree' })],
      ['another mode', doc({ mode: 'plain', resume: 'worktree' })],
      ['no mode', JSON.stringify({ id: ID, verdict: 'unmeasured', resume: 'worktree' })],
      ['a JSON array', '[]'],
      ['JSON null', 'null'],
      ['nothing printed', ''],
      ['a document cut short', doc({ resume: 'worktree' }).slice(0, 40)],
    ];
    for (const [name, stdout] of shapes) {
      expect(parseChildReclaimAuditFailed(ID, stdout, ERR), name).toEqual({ kind: 'unreadable', detail });
    }
  });

  it('its answer type has no token arm and no refused arm', () => {
    const noToken: [Extract<ChildReclaimAuditFailedRead, { kind: 'token' }>] extends [never] ? true : false = true;
    const noRefused: [Extract<ChildReclaimAuditFailedRead, { kind: 'refused' }>] extends [never] ? true : false = true;
    expect([noToken, noRefused]).toEqual([true, true]);
  });
});

describe('childReclaimFailedTail: one decision, the word first, every resume value spoken', () => {
  it('purge-incomplete says the reclaim completed, what stands is named, and the sweep asks again only if the row’s own files stand, whatever its resume', () => {
    for (const resume of Object.keys(ALL_RESUME) as ChildReclaimResume[]) {
      const t = childReclaimFailedTail({ resume, token: CHILD_RECLAIM_PURGE_INCOMPLETE });
      expect(t, resume).toBe(
        'The reclaim itself completed and its registry row was purged; what still stands is named above. If the row’s own files still stand, the sweep asks again.');
    }
  });

  it('stuck says ccrc retries on its long backoff while automatic reclamation runs, and the box resumes once fixed', () => {
    expect(childReclaimFailedTail({ resume: 'stuck', token: 'containment-refuted' })).toBe(
      'While automatic reclamation runs, ccrc retries it on its long backoff; the box resumes from its breadcrumb once the tree or row is fixed.');
  });

  it('the three older values keep their sentences', () => {
    expect(childReclaimFailedTail({ resume: 'resumable', token: 'pin-failed' })).toBe(RESUMES);
    expect(childReclaimFailedTail({ resume: 'not-resumable', token: null })).toBe(AFRESH);
    expect(childReclaimFailedTail({ resume: 'pre-lock-die', token: null })).toBe(
      'ccd refused the call before anything started; nothing was touched, and it refuses the same way every time until that changes.');
  });

  it('every resume value has a sentence of its own', () => {
    const tails = (Object.keys(ALL_RESUME) as ChildReclaimResume[]).map((resume) => childReclaimFailedTail({ resume, token: null }));
    expect(new Set(tails).size).toBe(Object.keys(ALL_RESUME).length);
  });
});

/** A closed minting run and a registry row, a scripted ccd that records each
 *  verb it was asked, and the feed — `child-reclaim-pre-crumb.test.ts`'s rig,
 *  with the audit scripted too. */
const rig = async (script: (runId: number) => { audit: { code: number; stdout: string; stderr?: string };
  verb?: { code: number; stdout: string } }, feedQuiet = CHILD_RECLAIM_FEED_QUIET_NONE) => {
  const home = mkTmp('ccrc-child-reclaim-failed-arm-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 2, claimedBy: 'demo-coordinator' });
  if (!('id' in opened)) throw new Error('openRun refused');
  const runId = opened.id;
  coord.markDispatched(runId, ID, ID, 'ws/quiet-basin', false);
  expect(coord.closeRun({ runId, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p',
    viaClosing: false }).ok).toBe(true);
  const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`,
    started: '1', workspace: ID, branch: 'ws/quiet-basin', base: 'origin/main', child: String(runId) };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  const s = script(runId);
  const calls: string[] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args[0]);
    if (args[0] === 'ws-audit') return { code: s.audit.code, stdout: s.audit.stdout, stderr: s.audit.stderr ?? '' };
    if (args[0] === 'ws-reclaim' && s.verb) return { code: s.verb.code, stdout: s.verb.stdout, stderr: '' };
    return { code: 1, stdout: '', stderr: `unscripted ${args[0]}` };
  };
  const base = testDeps(home, run);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps: ChildReclaimDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd, fleetState: CAPS,
    presence: { isVisible: () => false }, notifyLog };
  const req: ChildReclaimRequest = { sessionId: ID, runId, trigger: 'close' as const, deferExpired: false,
    deferredSinceMs: null, feedQuiet, licenceGeneration: { kind: 'none' } };
  const bodies = () => coord.feedEvents(50).filter((e) => e.sessionId === ID).map((e) => e.body);
  return { deps, req, bodies, calls };
};

const auditDoc = (runId: number, verdict: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ id: ID, mode: 'reclaim', childOf: runId, verdict, detail: 'd', ...extra });
const tokenAudit = (runId: number) => ({ code: 0, stdout: auditDoc(runId, 'reclaimable', { detail: '', token: TOK }) });

describe('reclaimChild: the exit-1 audit arm', () => {
  it('an unmeasured audit over a standing breadcrumb is failed and resumable, with ccd’s journal word', async () => {
    const s = await rig((runId) => ({ audit: { code: 1, stdout: auditDoc(runId, 'unmeasured', { resume: 'worktree' }), stderr: ERR } }));
    expect(await reclaimChild(s.deps, s.req)).toEqual({ kind: 'failed', sessionId: ID, runId: s.req.runId,
      resume: 'resumable', detail: `ws-audit --reclaim failed: ${ERR}`, token: 'probe-unmeasured' });
    expect(s.calls).toEqual(['ws-audit']);
    expect(s.bodies()).toHaveLength(1);
    expect(s.bodies()[0]).toContain(RESUMES);
  });

  it('one naming no phase is failed and not-resumable, with the same word', async () => {
    const s = await rig((runId) => ({ audit: { code: 1, stdout: auditDoc(runId, 'unmeasured'), stderr: ERR } }));
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', resume: 'not-resumable', token: 'probe-unmeasured' });
    expect(s.bodies()[0]).toContain(AFRESH);
    expect(s.bodies()[0]).not.toContain('resumes where it stopped');
  });

  it('a token printed at exit 1 is never spent: unreadable, a null token, and the verb never called', async () => {
    const s = await rig((runId) => ({ audit: { code: 1, stdout: auditDoc(runId, 'reclaimable', { token: TOK, resume: 'worktree' }) },
      verb: { code: 0, stdout: JSON.stringify({ reclaimed: ID }) } }));
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', resume: 'not-resumable', token: null });
    expect(s.calls, 'the verb was never called on an exit-1 token').toEqual(['ws-audit']);
  });

  it('a failing item that already lists probe-unmeasured quiets the repeat feed row', async () => {
    const s = await rig((runId) => ({ audit: { code: 1, stdout: auditDoc(runId, 'unmeasured'), stderr: ERR } }),
      { deferWhy: null, failureToken: 'probe-unmeasured' });
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', token: 'probe-unmeasured' });
    expect(s.bodies()).toEqual([]);
  });
});

describe('reclaimChild: the feed tail follows the word first', () => {
  it('containment-refuted is stuck, and the feed says the box resumes once the tree or row is fixed', async () => {
    const s = await rig((runId) => ({ audit: tokenAudit(runId),
      verb: { code: 1, stdout: JSON.stringify({ failed: 'containment-refuted', detail: 'demo-twin names it', crumb: true }) } }));
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', resume: 'stuck', token: 'containment-refuted' });
    expect(s.bodies()[0]).toContain('containment-refuted: demo-twin names it. While automatic reclamation runs, ccrc retries it');
    expect(s.bodies()[0]).not.toContain(RESUMES);
  });

  it('purge-incomplete says the reclaim completed and the sweep asks again only if the row’s own files stand, never that the box resumes', async () => {
    const s = await rig((runId) => ({ audit: tokenAudit(runId),
      verb: { code: 1, stdout: JSON.stringify({ failed: 'purge-incomplete', crumb: true,
        detail: 'the reclaim completed — … — and the registry row WAS purged, but /r/x.lock could not be removed and still stands' }) } }));
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', token: 'purge-incomplete' });
    expect(s.bodies()[0]).toContain('still stands. The reclaim itself completed and its registry row was purged');
    expect(s.bodies()[0]).toContain('If the row’s own files still stand, the sweep asks again.');
    expect(s.bodies()[0]).not.toContain('nothing retries it');
    expect(s.bodies()[0]).not.toContain('resumes where it stopped');
    expect(s.bodies()[0]).not.toContain(AFRESH);
  });

  it('a pre-breadcrumb pin-failed (crumb false) says it is retried from the start', async () => {
    const s = await rig((runId) => ({ audit: tokenAudit(runId),
      verb: { code: 1, stdout: JSON.stringify({ failed: 'pin-failed', detail: 'the disk is full', crumb: false }) } }));
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', resume: 'not-resumable' });
    expect(s.bodies()[0]).toContain(AFRESH);
  });
});
