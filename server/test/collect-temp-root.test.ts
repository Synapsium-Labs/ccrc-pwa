// Child reclamation wave 9 (spec §5.10): the temp-root collector's ONE executor, `collectTempRoot`, case by case at each
// of its six steps. A scripted ccd answers behind the agent's real exec whitelist, and the lane's memory is a fake of
// its port. Every case is a SAFETY case. The collector's verb is composed only when all of these hold:
//   - the box advertises both capabilities, and the id passes the predicate;
//   - nothing is paused and nobody is looking;
//   - two observations carry observation 2's own token, at least an interval apart;
//   - no open run holds the id;
//   - each of those is re-read with no await between the re-read and the argv;
//   - the lane is live.
// The lane's start hold-off is asked at its offer (Task 7's collectOffers), never by this job.
// FIXTURE HOME ONLY.
import { describe, it, expect } from 'vitest';
import { COLLECT_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { COLLECT_LANE_LIVE_MARKER, collectLatchFeedBody, type CollectObservation } from '../src/collectLane.js';
import { CHILD_BIRTH_SKEW_MS } from '../src/coord/childSpent.js';
import { collectTempRoot, type CollectJob } from '../src/coord/collectTempRoot.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import type { OpenSiblingsResult } from '../src/coord/store.js';
import type { CollectToken } from '../../shared/api.js';
import { FULL_CAPS, ID, INTERVAL, RIPE, T0, TOK, TOK2, auditDoc, rig } from './collectTempRootFixture.js';

const job: CollectJob = { id: ID, epoch: 0 };   // the rig's cell starts at epoch 0 (`r.job()` builds the same); no case here moves it
const AUDIT = ['ws-audit', '--session', ID, '--collect'];
const actOf = (token: string): string[] =>
  ['ws-collect', '--expect', token, '--session', ID, '--surface', 'agent', '--actor', 'collect sweep'];
const without = (cap: string): string[] => FULL_CAPS.filter((c) => c !== cap);

describe('the live act, end to end: the control every stop below is measured against', () => {
  it('two observations an interval apart, nobody looking, no open run: audits, then spends observation 2’s token on the job’s id', async () => {
    const r = rig();
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'acted', composedMono: T0, result: { kind: 'collected' } });
    expect(r.attempts).toEqual([AUDIT, actOf(TOK)]);
    expect(r.attempts[1], 'never --defer-expired').not.toContain('--defer-expired');
    expect(r.lane.clears, 'no lane-wide clear').toEqual([]);
  });

  it('the token on the argv is the one observation 2’s document carries', async () => {
    const T = 'e'.repeat(64) as CollectToken;
    const r = rig({ obs1: { token: T, arrivedMono: T0 - INTERVAL } });
    r.answerAudit(() => ({ code: 0, stdout: auditDoc({ witness: r.witness, token: T }), stderr: '' }));
    await collectTempRoot(r.deps, job);
    expect(r.attempts[1]).toEqual(actOf(T));
  });

  it('observation 2 arrives when its answer arrives: an audit that took 5 ms licenses an observation 1 that was 5 ms short when the audit was composed', async () => {
    const r = rig({ obs1: { token: TOK, arrivedMono: T0 - INTERVAL + 5 } });
    r.hooks.audit = () => { r.lane.advance(5); };
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'acted', composedMono: T0 + 5 });
  });

  it.each(['empty', 'reject'] as const)('an act answering no document (%s) is reported with the instant it was composed', async (how) => {
    const r = rig();
    r.hooks.act = () => { r.lane.advance(9); };
    r.answerAct(() => {
      if (how === 'reject') throw new Error('the agent link closed');
      return { code: 1, stdout: '', stderr: '' };
    });
    expect(await collectTempRoot(r.deps, job))
      .toMatchObject({ kind: 'acted', composedMono: T0, result: { kind: 'no-document' }, arrived: { mono: T0 + 9 } });
  });
});

describe('step 1 — both capabilities, then the id predicate on the job’s own id', () => {
  it.each<[string, readonly string[] | null]>([
    ['no collect-v1', without(COLLECT_CAP)],
    ['no reclaim-pause-v1, a box the phone cannot pause', without(RECLAIM_PAUSE_CAP)],
    ['no caps list at all, no evidence', null],
  ])('%s: nothing is asked of the box, and the lane clears every pair', async (_what, caps) => {
    const r = rig({ caps });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'not-asked', step: 1, why: 'caps' });
    expect(r.attempts).toEqual([]);
    expect(r.lane.clears).toEqual(['caps']);
  });

  it.each(['--actor', '--surface', '--reason', '--expect', '--session', '--', '-h', '-x', '.hidden', 'x'.repeat(256)])(
    'the id %s is refused before any argv: no audit, no act', async (id) => {
      const r = rig();
      expect(await collectTempRoot(r.deps, { id, epoch: 0 })).toMatchObject({ kind: 'not-asked', step: 1, why: 'id-refused' });
      expect(r.attempts).toEqual([]);
    });

  it.each(['a--actor', 'a.--actor', 'x'.repeat(255)])('the id %s passes the predicate and is audited as itself', async (id) => {
    const r = rig();
    await collectTempRoot(r.deps, { id, epoch: 0 });
    expect(r.attempts[0]).toEqual(['ws-audit', '--session', id, '--collect']);
  });
});

describe('step 2 — the switch, from one listing, at the job’s start', () => {
  it('reclaim-paused stops it before ccd is asked anything, shadow included, and the lane clears every pair', async () => {
    for (const live of [true, false]) {
      const r = rig({ paused: true, live });
      expect(await collectTempRoot(r.deps, job), `live: ${String(live)}`).toMatchObject({ kind: 'not-asked', step: 2, why: 'paused' });
      expect(r.attempts).toEqual([]);
      expect(r.lane.clears).toEqual(['paused']);
    }
  });

  it.each(['null', 'reject'] as const)('a registry listing that answers %s cannot rule a pause out: paused, nothing asked', async (how) => {
    const r = rig();
    r.hooks.listing = (n) => (n === 1 ? how : undefined);
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'not-asked', step: 2, why: 'paused' });
    expect(r.attempts).toEqual([]);
  });
});

describe('step 3 — a person at the session', () => {
  it('defers it before any argv, with no ceiling and no licence past it', async () => {
    const r = rig();
    r.see(true);
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'not-asked', step: 3, why: 'presence' });
    expect(r.attempts).toEqual([]);
  });
});

describe('step 4 — observation 2 against observation 1', () => {
  it('a box that cannot answer ws-audit asks nothing, and the lane clears every pair', async () => {
    const r = rig({ caps: without('ws-audit') });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'not-asked', step: 4, why: 'caps' });
    expect(r.attempts).toEqual([]);
    expect(r.lane.clears).toEqual(['caps']);
  });

  it.each([
    ['changed-recently', 'verdict', 0, { verdict: 'changed-recently', idleAt: 1_790_000_100 }],
    ['an unmeasured probe', 'unmeasured', 1, { verdict: 'unmeasured', unmeasured: 'checkouts' }],
  ] as const)('%s is reported for the lane to fold, and nothing is composed', async (_what, kind, code, over) => {
    const r = rig();
    r.answerAudit(() => ({ code, stdout: auditDoc({ witness: r.witness, ...over }), stderr: '' }));
    expect(await collectTempRoot(r.deps, job))
      .toMatchObject({ kind: 'answered', step: 4, why: 'not-collectable', audit: { value: { kind } } });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it.each(['empty', 'reject'] as const)('an audit with no document (%s) is reported as such, never a throw: the runner rejects or answers nothing', async (how) => {
    const r = rig();
    r.answerAudit(() => {
      if (how === 'reject') throw new Error('the runner was killed');
      return { code: 1, stdout: '', stderr: '' };
    });
    expect(await collectTempRoot(r.deps, job))
      .toMatchObject({ kind: 'answered', step: 4, why: 'not-collectable', audit: { value: { kind: 'no-document' } } });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it.each<[string, CollectObservation | null]>([
    ['no observation 1 stands (a restart, a clear)', null],
    ['observation 1 carries another token', { token: TOK2, arrivedMono: T0 - INTERVAL }],
    ['observation 1 arrived less than the interval before observation 2', { token: TOK, arrivedMono: T0 - INTERVAL + 1 }],
  ])('%s: not licensed, and the collector’s verb is never composed', async (_what, obs1) => {
    const r = rig({ obs1 });
    expect(await collectTempRoot(r.deps, job))
      .toMatchObject({ kind: 'answered', step: 4, why: 'not-licensed', audit: { value: { kind: 'collectable', token: TOK } } });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('exactly the interval is licensed (the boundary)', async () => {
    const r = rig({ obs1: { token: TOK, arrivedMono: T0 - INTERVAL } });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'acted' });
  });

  it('a clear that lands while observation 2 is in flight makes it stale: no observation, nothing composed, even if a pair stands again when it arrives', async () => {
    for (const clear of ['lane', 'id'] as const) {
      const r = rig();
      r.hooks.audit = () => {
        if (clear === 'lane') r.lane.clearAll(); else r.lane.resetId(ID);
        r.lane.seed(RIPE);
      };
      expect(await collectTempRoot(r.deps, job), clear).toMatchObject({ kind: 'answered', step: 4, why: 'stale' });
      expect(r.attempts, clear).toEqual([AUDIT]);
    }
  });
});

describe('step 4 — the open-run hold, judged on observation 2’s document', () => {
  it('a run bound to the id DURING the audit holds it at step 4, and nothing is composed', async () => {
    const r = rig();
    r.hooks.audit = () => { r.openRun({ sessionId: ID }); };
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'held', step: 4, hold: { why: 'id-in-open-run' } });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('the hold is judged on every collectable observation 2, licensed or not, so a held id never seeds a pair', async () => {
    const r = rig({ obs1: null });
    r.openRun({ sessionId: ID });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'held', step: 4, hold: { why: 'id-in-open-run' } });
  });

  it('an absent run holds it: a lost or rebuilt database makes every run absent at once', async () => {
    const r = rig({ witness: () => ({ run: '987654', at: String(Date.now()) }) });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'held', step: 4, hold: { why: 'run-absent' } });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('a re-bound child: an open run naming the id, which is not the witness’s run, holds it', async () => {
    const r = rig();
    r.openRun({ sessionId: ID });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'held', step: 4, hold: { why: 'id-in-open-run' } });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('a reused run id: a witness run opened after the witness’s instant plus the skew holds it (the birth fence)', async () => {
    const r = rig({ witness: (m) => ({ run: String(m.id), at: String(m.openedAt - CHILD_BIRTH_SKEW_MS - 1) }) });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'held', step: 4, hold: { why: 'run-after-witness' } });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('a FRESH collectable document with no witness holds it', async () => {
    const r = rig({ witness: null });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'held', step: 4, hold: { why: 'no-witness-run' } });
  });

  it('a resume document with no witness is held by an open run naming the id, and by nothing else', async () => {
    const held = rig({ witness: null, resume: 'moved' });
    held.openRun({ sessionId: ID });
    expect(await collectTempRoot(held.deps, job)).toMatchObject({ kind: 'held', step: 4, hold: { why: 'id-in-open-run' } });
    const free = rig({ witness: null, resume: 'moved' });
    expect(await collectTempRoot(free.deps, job), 'it finishes an act begun under these gates').toMatchObject({ kind: 'acted' });
  });

  it('an unreadable store holds it', async () => {
    const r = rig({ coord: (real) => ({
      run: (id: number) => real.run(id),
      openRunsClaimedBy: (id: string) => real.openRunsClaimedBy(id),
      openRunsForSession: (): OpenSiblingsResult => ({ ok: false, kind: 'run-unreadable', detail: 'the runs table could not be read' }),
    }) });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'held', step: 4, hold: { why: 'store-unreadable' } });
    expect(r.attempts).toEqual([AUDIT]);
  });
});

describe('step 5 — the switches once more, with the live marker: the job’s last await', () => {
  it('a pause raised during the audit stops it, and the lane clears every pair', async () => {
    const r = rig();
    r.hooks.audit = () => { r.raise(RECLAIM_PAUSE_MARKER); };
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'answered', step: 5, why: 'paused' });
    expect(r.attempts).toEqual([AUDIT]);
    expect(r.lane.clears).toEqual(['paused']);
  });

  it('a registry that does not list at the last await stops it as a pause, and is never read as a flip to shadowed', async () => {
    const r = rig();
    r.hooks.listing = (n) => (n === 2 ? 'null' : undefined);
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'answered', step: 5, why: 'paused' });
    expect(r.lane.flips).toEqual([]);
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('the marker removed during the audit: the lane flips to shadowed, and nothing is composed', async () => {
    const r = rig();
    r.hooks.audit = () => { r.lower(COLLECT_LANE_LIVE_MARKER); };
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'answered', step: 5, why: 'switch-flip' });
    expect(r.lane.flips).toEqual([false]);
    expect(r.attempts).toEqual([AUDIT]);
    // path-identity spec 2026-10-12 §5.4: the last listing proved the marker gone beside the untouched seed, so its latch
    // retired, once, through the journal, before the switch was resolved.
    expect(r.latches).toEqual([collectLatchFeedBody('collect sweep')]);
    expect(r.journal.read()).toMatchObject({ kind: 'ok', max: 1 });
  });

  it('the marker touched during the audit: the lane flips to live, and THIS job composes nothing', async () => {
    const r = rig({ live: false });
    r.hooks.audit = () => { r.raise(COLLECT_LANE_LIVE_MARKER); };
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'answered', step: 5, why: 'switch-flip' });
    expect(r.lane.flips).toEqual([true]);
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('a lane constructed with the marker standing sees a flip on its first job and composes nothing; its first act rests on observations seeded after the flip', async () => {
    const r = rig({ live: true, lastSeenLive: false });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'answered', step: 5, why: 'switch-flip' });
    expect(r.lane.flips).toEqual([true]);
    expect(r.attempts).toEqual([AUDIT]);
    expect(r.deps.lane.observation(ID), 'the flip cleared every pair').toBeNull();
    r.lane.seed(RIPE);
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'acted' });
    expect(r.attempts).toEqual([AUDIT, AUDIT, actOf(TOK)]);
  });
});

describe('step 6 — synchronous from the last await to the argv', () => {
  it('a pair cleared during the last await (a lane-wide clear, or a reset of the id’s own pair) composes nothing, even re-seeded', async () => {
    for (const [clear, reseed] of [['lane', false], ['lane', true], ['id', false], ['id', true]] as const) {
      const r = rig();
      r.hooks.listing = (n) => {
        if (n !== 2) return;
        if (clear === 'lane') r.lane.clearAll(); else r.lane.resetId(ID);
        if (reseed) r.lane.seed(RIPE);
      };
      expect(await collectTempRoot(r.deps, job), `${clear} ${String(reseed)}`)
        .toMatchObject({ kind: 'answered', step: 6, why: 'pair-cleared' });
      expect(r.attempts).toEqual([AUDIT]);
    }
  });

  it('observation 1 replaced during the last await, by another token or another arrival, composes nothing', async () => {
    for (const next of [{ token: TOK2, arrivedMono: T0 - INTERVAL }, { token: TOK, arrivedMono: T0 - INTERVAL - 1 }]) {
      const r = rig();
      r.hooks.listing = (n) => { if (n === 2) r.lane.seed(next); };
      expect(await collectTempRoot(r.deps, job), JSON.stringify(next)).toMatchObject({ kind: 'answered', step: 6, why: 'pair-cleared' });
    }
  });

  it('presence that appears during the last await composes nothing', async () => {
    const r = rig();
    r.hooks.listing = (n) => { if (n === 2) r.see(true); };
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'answered', step: 6, why: 'presence' });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('a run bound during the last await holds it: the hold’s store reads are made again at the act', async () => {
    for (const over of [{ sessionId: ID }, { claimedBy: ID }]) {
      const r = rig();
      r.hooks.listing = (n) => { if (n === 2) r.openRun(over); };
      expect(await collectTempRoot(r.deps, job), JSON.stringify(over))
        .toMatchObject({ kind: 'held', step: 6, hold: { why: 'id-in-open-run' } });
      expect(r.attempts).toEqual([AUDIT]);
    }
  });

  it('collect-v1 withdrawn during the last await: the capability asked again in the act’s own scope composes nothing', async () => {
    const r = rig();
    r.hooks.listing = (n) => { if (n === 2) r.state.ccdVerbs = without(COLLECT_CAP); };
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'answered', step: 6, why: 'caps' });
    expect(r.attempts).toEqual([AUDIT]);
    expect(r.lane.clears).toEqual(['caps']);
  });

  it('SHADOW: no marker, and the lane has seen none: every gate passes, it would collect, and the collector’s verb is never composed', async () => {
    const r = rig({ live: false });
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'would-collect', audit: { value: { kind: 'collectable', token: TOK } } });
    expect(r.attempts).toEqual([AUDIT]);
    expect(r.lane.flips).toEqual([]);
    expect(r.latches, 'path-identity spec 2026-10-12 §5.4: the listing proved the marker absent beside the seed, so its latch retired once')
      .toEqual([collectLatchFeedBody('collect sweep')]);
  });

  it('SHADOW re-reads at step 6 too: presence that appears during the last await stops a would-collect', async () => {
    const r = rig({ live: false });
    r.hooks.listing = (n) => { if (n === 2) r.see(true); };
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'answered', step: 6, why: 'presence' });
  });
});

describe('a pause and a refused audit gate each say which, in their own sentence (spec §5.10)', () => {
  const RAISED = `${RECLAIM_PAUSE_MARKER} is raised`;
  const UNLISTED = 'the registry did not list';
  const detailOf = (o: Awaited<ReturnType<typeof collectTempRoot>>): string => ('detail' in o ? o.detail : '');

  it('step 2, reclaim-paused raised: the pause says it is raised, and nothing of a registry that did not list', async () => {
    const r = rig({ paused: true });
    const o = await collectTempRoot(r.deps, job);
    expect(o).toMatchObject({ kind: 'not-asked', step: 2, why: 'paused' });
    expect(detailOf(o)).toContain(RAISED);
    expect(detailOf(o)).not.toContain(UNLISTED);
  });

  it('step 2, a registry that did not list: the pause says so, and never that reclaim-paused is raised', async () => {
    const r = rig();
    r.hooks.listing = (n) => (n === 1 ? 'null' : undefined);
    const o = await collectTempRoot(r.deps, job);
    expect(o).toMatchObject({ kind: 'not-asked', step: 2, why: 'paused' });
    expect(detailOf(o)).toContain(UNLISTED);
    expect(detailOf(o)).not.toContain(RAISED);
  });

  it('step 5, reclaim-paused raised during the audit: the pause says it is raised', async () => {
    const r = rig();
    r.hooks.audit = () => { r.raise(RECLAIM_PAUSE_MARKER); };
    const o = await collectTempRoot(r.deps, job);
    expect(o).toMatchObject({ kind: 'answered', step: 5, why: 'paused' });
    expect(detailOf(o)).toContain(RAISED);
    expect(detailOf(o)).not.toContain(UNLISTED);
  });

  it('step 5, a registry that did not list at the last await: the pause says so, and never that reclaim-paused is raised', async () => {
    const r = rig();
    r.hooks.listing = (n) => (n === 2 ? 'null' : undefined);
    const o = await collectTempRoot(r.deps, job);
    expect(o).toMatchObject({ kind: 'answered', step: 5, why: 'paused' });
    expect(detailOf(o)).toContain(UNLISTED);
    expect(detailOf(o)).not.toContain(RAISED);
  });

  it('step 4, collect-v1 withdrawn after step 1: the refusal names the capability, never a box that cannot answer ws-audit', async () => {
    const r = rig();
    r.hooks.listing = (n) => { if (n === 1) r.state.ccdVerbs = without(COLLECT_CAP); };
    const o = await collectTempRoot(r.deps, job);
    expect(o).toMatchObject({ kind: 'not-asked', step: 4, why: 'caps' });
    expect(detailOf(o)).toContain(`no longer advertises ${COLLECT_CAP}`);
    expect(detailOf(o)).not.toContain('cannot answer ws-audit');
    expect(r.attempts).toEqual([]);
    expect(r.lane.clears).toEqual(['caps']);
  });

  it('step 4, no ws-audit in the verb list: the refusal says the box cannot answer ws-audit, and names no capability', async () => {
    const r = rig({ caps: without('ws-audit') });
    const o = await collectTempRoot(r.deps, job);
    expect(o).toMatchObject({ kind: 'not-asked', step: 4, why: 'caps' });
    expect(detailOf(o)).toContain('cannot answer ws-audit');
    expect(detailOf(o)).not.toContain(COLLECT_CAP);
  });
});
