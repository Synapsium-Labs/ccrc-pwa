// Delegation broker wave 5, PR7 (Task 5.7.3): the lane's adoption step, shadow and live, on the carrier lane's rig (a FleetWatcher over a
// fixture home, a real CoordStore, a recording `runCcd` that writes the carrier a mark describes and answers `ws-lease-audit` from a
// table). The agent lease is made through the lane's own applier, from evidence whose SubagentStop ends the activity. Every home is a
// fixture: nothing reads or writes the live `~/.ccrc` or `~/.cc-sessions`.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { NotifyLog } from '../src/notifylog.js';
import { FleetWatcher, DELEGATION_SWEEP_MS } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { LEASE_AUDIT_CAP, LEASE_MARK_CAP, LEASE_MARK_LOCK_CAP, ORPHAN_LEASE_CAP } from '../src/ccdargv.js';
import type { CcdResult } from '../src/coord/ports.js';
import {
  DELEGATION_EVENTS_CAP, delegationSha256Hex, encodeDelegationNaturalKey, formatDelegationInstant, type DelegationCensusRecord, type DelegationLeaseRow,
} from '../src/coord/delegation-model.js';
import type { DelegationCensusPass } from '../src/coord/gitref.js';
import { DELEGATION_HOLD_CLOSING, DELEGATION_REMINDER_LEAD_MS } from '../src/coord/delegation-adoption.js';
import type { DelegationDurability } from '../src/coord/delegation-checkpoint.js';
import { delegationAdoptionHealthOf, type DelegationEventEnvelopeV1, type FleetSession } from '../../shared/api.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = Date.UTC(2026, 9, 15, 10, 30, 0);
const INC = '0189abcd-1234-4678-9abc-0123456789ab';
const OWNER = 'demo-a';
const ROW_MS = 120_000;
const FULL = ['caps', DELEGATION_EVENTS_CAP, LEASE_MARK_CAP, LEASE_MARK_LOCK_CAP, ORPHAN_LEASE_CAP, LEASE_AUDIT_CAP];
const at = (n: number): number => NOW + n * DELEGATION_SWEEP_MS;
const iso = (ms: number): string => formatDelegationInstant(ms);
const CLOSING = 'After that date the worktree is no longer held back from the disk sweep, which never removes uncommitted work, and removes a worktree with unpushed commits only after saving them to a rescue ref.';

type Audit = Record<string, unknown>;
interface World {
  home: string; registryDir: string; watcher: FleetWatcher; coord: CoordStore; argvs: string[][]; fleet: { connected: boolean; downSince: null; ccdVerbs: string[] | null };
  audit: Audit; feed: { title: string; body: string }[]; pushes: string[]; sessions: { id: string; incarnation: string }[];
}
const worlds: World[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(worlds.splice(0).map((w) => w.watcher.closeDelegation().catch(() => undefined)));
});

const ok = (stdout: string, code = 0): CcdResult => ({ ran: true, ok: code === 0, stdout, stderr: '', killed: false, signal: null });
const flagsOf = (argv: readonly string[]): Record<string, string> => {
  const f: Record<string, string> = {};
  for (let i = 1; i + 1 < argv.length; i += 2) f[argv[i]!.replace(/^--/, '')] = argv[i + 1]!;
  return f;
};
const marks = (w: World): Record<string, string>[] => w.argvs.filter((a) => a[0] === 'ws-lease-mark').map(flagsOf);
const audits = (w: World): string[][] => w.argvs.filter((a) => a[0] === 'ws-lease-audit');
/** The carrier the box would write for this argv. */
const writeCarrier = (w: World, f: Record<string, string>): void => {
  const dir = path.join(w.registryDir, 'delegation', 'leases');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${f.lease}.json`), `${JSON.stringify({
    v: 1, leaseId: f.lease, generation: Number(f.generation), state: f.state, journalSeq: Number(f['journal-seq']), parentId: f.parent,
    parentIncarnation: f['parent-incarnation'], activityId: f.activity, source: f.source, project: f.project,
    adminRecord: Buffer.from(f['admin-record-hex']!, 'hex').toString('utf8'), canonicalPath: '/fixture/tree', fingerprint: 'f'.repeat(64),
    claudeBase: null, branch: null, expiresAt: f['expires-at'] === undefined ? null : Number(f['expires-at']),
    releaseReason: f['release-reason'] ?? null, promotedRun: null, promotedSession: null, markedAt: 1,
  })}\n`);
};

function world(opts: { caps?: string[] | null } = {}): World {
  const home = mkTmp('ccrc-adopt-lane-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: path.join(home, 'projects') } as never);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  coord.db.exec('PRAGMA synchronous = OFF');
  const fleet = { connected: true, downSince: null, ccdVerbs: opts.caps === undefined ? [...FULL] : opts.caps };
  const made = { home, registryDir: cfg.registryDir, coord, argvs: [] as string[][], fleet, feed: [] as { title: string; body: string }[], pushes: [] as string[],
    audit: { ok: true, lease: 'x', generation: 1, tip: 'a'.repeat(40), dirty: false, aheadOfBase: 1, branchAheadOfBase: 'no-branch', changed: true, token: 'tok-1' } as Audit,
    sessions: [{ id: OWNER, incarnation: INC }] } as Omit<World, 'watcher'> as World;
  const runCcd = async (argv: readonly string[]): Promise<CcdResult> => {
    made.argvs.push([...argv]);
    const f = flagsOf(argv);
    if (argv[0] === 'ws-lease-mark') {
      writeCarrier(made, f);
      return ok(`${JSON.stringify({ ok: true, answer: 'written', lease: f.lease, generation: Number(f.generation), state: f.state })}\n`);
    }
    if (argv[0] === 'ws-lease-audit') return ok(`${JSON.stringify({ ...made.audit, lease: f.lease, generation: Number(f.generation) })}\n`);
    throw new Error(`unexpected ccd ${argv.join(' ')}`);
  };
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  const record = notifyLog.record.bind(notifyLog);
  vi.spyOn(notifyLog, 'record').mockImplementation((e) => { made.feed.push({ title: e.title, body: e.body }); return record(e); });
  const push = { notify: (p: { title: string }) => { made.pushes.push(p.title); return Promise.resolve(); } };
  const deps = { ...testDeps(home), monotonicMs: () => Date.now(), cfg, io: localIO, coord, fleetState: fleet, runCcd, notifyLog, push };
  made.watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  worlds.push(made);
  return made;
}

const WTX: DelegationCensusRecord = { project: 'demo', adminRecord: 'wt-x', canonicalPath: '/w/demo/.claude/worktrees/wt-x', headBranch: null,
  headSha: 'a'.repeat(40), claudeBase: 'b'.repeat(40), locked: false, baseAgreesFirstLog: true, state: 'present', diagnostic: null };
const sessionOf = (id: string) => ({ id, project: 'demo', status: 'idle' as const, stoppedBy: null as FleetSession['stoppedBy'], archivedAt: null as FleetSession['archivedAt'] });
/** One census pass at `ms`: the census lists `recs`, and the registry lists the world's sessions (an absent session: no row). */
const pass = async (w: World, ms: number, recs: DelegationCensusRecord[] = [WTX]): Promise<void> => {
  vi.spyOn(Date, 'now').mockReturnValue(ms);
  const c: DelegationCensusPass = { measuredAt: ms, projects: new Map([['demo', { read: { ok: true, records: [] }, delegation: recs }]]),
    incarnations: new Map(w.sessions.map((s) => [s.id, { kind: 'measured', incarnation: s.incarnation }] as const)) };
  (w.watcher as unknown as { delegationCensus: DelegationCensusPass | null }).delegationCensus = c;
  const s = w.sessions.map((x) => sessionOf(x.id));
  await w.watcher.sweepDelegation(s as never, s.map((x) => ({ id: x.id, project: x.project, child: { kind: 'none' } })) as never);
};

let serial = 0;
const ev = (ms: number) => {
  const n = ++serial;
  return { v: 1 as const, observedAt: iso(ms), sessionId: OWNER, parentIncarnation: INC, claudeSessionId: '11111111-2222-3333-4444-555555555555',
    eventId: delegationSha256Hex(`pr7-lane-event-${n}`), bucket: '2026101510', startOffset: n * 100, endOffset: n * 100 + 99 };
};
/** The lane, primed and ready, holding one `agent` lease on `wt-x` whose activity ended (its SubagentStop) at `NOW - 20 min`. */
async function leased(opts: { caps?: string[] | null } = {}): Promise<{ w: World; durable: DelegationDurability; lease: DelegationLeaseRow }> {
  const w = world(opts);
  await pass(w, NOW - 25 * 60_000, []);
  const durable = (await w.watcher.delegationApplier())!;
  const E0 = NOW - 22 * 60_000;
  const events: DelegationEventEnvelopeV1[] = [{ ...ev(E0), eventKind: 'SessionStart', source: 'startup' } as DelegationEventEnvelopeV1,
    { ...ev(E0 + 60_000), eventKind: 'SubagentStart', agentId: 'agent-x', agentType: null } as DelegationEventEnvelopeV1,
    { ...ev(E0 + 120_000), eventKind: 'SubagentStop', agentId: 'agent-x', agentType: null, agentTranscriptPath: null } as DelegationEventEnvelopeV1];
  await durable.applyAccepted({ accepted: events.map((event) => ({ event, acceptedAt: iso(Date.parse(event.observedAt) + 1000) })), cursor: null, interval: null });
  const cp = durable.state().checkpoint;
  const activityId = cp.activityIdsByNaturalKey[encodeDelegationNaturalKey({ parentId: OWNER, parentIncarnation: INC, sourceKind: 'agent', upstreamId: 'agent-x' })]!;
  expect(cp.activities.find((a) => a.activityId === activityId)?.executionState, 'CONTROL: the SubagentStop ended the activity').toBe('ended');
  const made = await durable.createLease({ activityId, parentId: OWNER, parentIncarnation: INC, project: 'demo', adminRecord: 'wt-x',
    canonicalPath: WTX.canonicalPath!, creationBase: null, sourceKind: 'agent', correlationJournalIds: [], firstObservedAt: iso(E0 + 60_000) });
  if (made.kind !== 'created') throw new Error('the fixture lease was not created');
  return { w, durable, lease: leaseOf(durable, made.leaseId) };
}
const leaseOf = (durable: DelegationDurability, id: string): DelegationLeaseRow => durable.state().checkpoint.leases.find((l) => l.leaseId === id)! as DelegationLeaseRow;
const touch = (w: World, name: string): void => writeFileSync(path.join(w.registryDir, name), '');
const unmark = (w: World, name: string): void => rmSync(path.join(w.registryDir, name), { force: true });
const mail = (w: World): { toId: string; subject: string; body: string }[] =>
  w.coord.db.prepare('SELECT toId, subject, body FROM mail ORDER BY id').all() as { toId: string; subject: string; body: string }[];
const health = (w: World) => delegationAdoptionHealthOf(w.watcher.currentDelegationHealth() ?? {});
/** Passes from `from` until the lease leaves `ephemeral` or `max` passes ran; answers the next pass index. */
async function passesUntilKept(w: World, durable: DelegationDurability, id: string, from: number, max = 10): Promise<number> {
  let n = from;
  for (; n < from + max; n += 1) {
    await pass(w, at(n));
    if (leaseOf(durable, id).disposition !== 'ephemeral') return n + 1;
  }
  return n;
}

describe('PR7: the lane adopts a changed worktree with terminal evidence behind delegation-adopt, and owes its owner one notice', () => {
  it('W5-Q1: marker absent — shadow only: the lease stays ephemeral, would-adopt is counted and logged once, and nothing is mailed, fed or marked', async () => {
    const { w, durable, lease } = await leased();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (let n = 0; n < 9; n += 1) await pass(w, at(n));
    expect(leaseOf(durable, lease.leaseId)).toMatchObject({ disposition: 'ephemeral', generation: 1, carrierGenerationSeen: 1 });
    expect(health(w)).toMatchObject({ mode: 'shadow', wouldAdopt: 1, adopted: 0 });
    const shadow = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('ccrc-server: delegation: adoption shadow: would adopt '));
    expect(shadow).toEqual([`ccrc-server: delegation: adoption shadow: would adopt ${lease.leaseId} (demo/wt-x, terminal ${iso(NOW - 20 * 60_000)})`]);
    expect(mail(w)).toEqual([]);
    expect(w.feed).toEqual([]);
    expect(marks(w).map((f) => f.state), 'the carrier is only ever marked ephemeral').toEqual(['ephemeral']);
  }, ROW_MS);

  it('W5-Q2: marker present — adopted at generation 2 with its expiry, marked in the same pass, one feed row, one notice to the parent, and the parent\'s lineage retained', async () => {
    const { w, durable, lease } = await leased();
    touch(w, 'delegation-adopt');
    const next = await passesUntilKept(w, durable, lease.leaseId, 0);
    const kept = leaseOf(durable, lease.leaseId);
    expect(kept).toMatchObject({ disposition: 'adopted', generation: 2, terminalEvidenceAt: iso(NOW - 20 * 60_000) });
    expect(kept.cleanupDueAt).toBe(iso(at(next - 1) + 7 * 86_400_000));
    expect(marks(w).at(-1), 'the carrier argv for generation 2 is composed in the same pass').toMatchObject({ generation: '2', state: 'adopted',
      'expires-at': String(Date.parse(kept.cleanupDueAt!)) });
    expect(w.feed.filter((f) => f.title === 'worktree kept: demo/wt-x')).toHaveLength(1);
    const sent = mail(w);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ toId: OWNER, subject: `delegation: worktree kept for ${OWNER} (${lease.leaseId}, generation 2)` });
    expect(sent[0]!.body).toContain(`~/.local/bin/ccrc-api leases retain ${lease.leaseId} --json '{"byId":"<your id>","byUuid":"<your uuid>"}'`);
    expect(sent[0]!.body).toContain(CLOSING);
    expect(DELEGATION_HOLD_CLOSING).toBe(CLOSING);
    const row = durable.state().checkpoint.sessions.find((s) => s.sessionId === OWNER && s.parentIncarnation === INC);
    expect(row?.effectiveBasis, 'the adopt fold (PR5a, D-7973) retains the parent\'s lineage').toContain('retained-lineage');
    expect(health(w)).toMatchObject({ mode: 'live', owed: 0 });
  }, ROW_MS);

  it('W5-Q3: a restart (a new lane over the same journal and store) does not queue the notice again, though the first was acked', async () => {
    const { w, durable, lease } = await leased();
    touch(w, 'delegation-adopt');
    const next = await passesUntilKept(w, durable, lease.leaseId, 0);
    await pass(w, at(next));
    expect(mail(w)).toHaveLength(1);
    w.coord.db.prepare("UPDATE mail_deliveries SET state = 'acked'").run();
    await w.watcher.closeDelegation();
    const again = new FleetWatcher((w.watcher as unknown as { deps: unknown }).deps as never, new Bus(), 10_000);
    w.watcher = again;
    for (let n = next + 1; n < next + 4; n += 1) await pass(w, at(n));
    expect(leaseOf((await again.delegationApplier())!, lease.leaseId).disposition, 'CONTROL: the new lane reads the adoption').toBe('adopted');
    expect(mail(w), 'the subject dedupe holds across every delivery state').toHaveLength(1);
  }, ROW_MS);

  it('W5-Q3b: a crash between the transition and the mail leaves the notice owed; the next ready pass queues it exactly once', async () => {
    const { w, durable, lease } = await leased();
    touch(w, 'delegation-adopt');
    let faults = 1;
    const has = w.coord.hasMailWithSubject.bind(w.coord);
    vi.spyOn(w.coord, 'hasMailWithSubject').mockImplementation((...a) => { if (faults > 0) { faults -= 1; throw new Error('a fixture fault inside the notice\'s transaction'); } return has(...a); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const next = await passesUntilKept(w, durable, lease.leaseId, 0);
    expect(leaseOf(durable, lease.leaseId).disposition).toBe('adopted');
    expect(mail(w), 'the fault lost the queue, not the adoption').toEqual([]);
    expect(health(w)?.owed).toBe(1);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('could not be queued'))).toBe(true);
    await w.watcher.closeDelegation();
    w.watcher = new FleetWatcher((w.watcher as unknown as { deps: unknown }).deps as never, new Bus(), 10_000);
    await pass(w, at(next));
    expect(mail(w)).toHaveLength(1);
    await pass(w, at(next + 1));
    expect(mail(w), 'and the pass after queues none').toHaveLength(1);
  }, ROW_MS);

  it('W5-Q4: mail-disabled standing — adopted, nothing queued, owed 1; lifted, the next pass queues it once and the pass after none', async () => {
    const { w, durable, lease } = await leased();
    touch(w, 'delegation-adopt');
    touch(w, 'mail-disabled');
    const next = await passesUntilKept(w, durable, lease.leaseId, 0);
    await pass(w, at(next));
    expect(leaseOf(durable, lease.leaseId).disposition).toBe('adopted');
    expect(mail(w)).toEqual([]);
    expect(health(w)?.owed).toBe(1);
    unmark(w, 'mail-disabled');
    await pass(w, at(next + 1));
    expect(mail(w)).toHaveLength(1);
    await pass(w, at(next + 2));
    expect(mail(w)).toHaveLength(1);
    expect(health(w)?.owed ?? 0, 'nothing owed (absent: nothing counted, D-8035\'s rule)').toBe(0);
  }, ROW_MS);

  it('W5-Q4b: a second lease adopted in a later pass for the same recipient gets its own notice; the first is not queued again', async () => {
    const { w, durable, lease } = await leased();
    touch(w, 'delegation-adopt');
    const next = await passesUntilKept(w, durable, lease.leaseId, 0);
    expect(mail(w)).toHaveLength(1);
    const WTY = { ...WTX, adminRecord: 'wt-y', canonicalPath: '/w/demo/.claude/worktrees/wt-y' };
    const second = await durable.createLease({ activityId: lease.activityId, parentId: OWNER, parentIncarnation: INC, project: 'demo', adminRecord: 'wt-y',
      canonicalPath: WTY.canonicalPath, creationBase: null, sourceKind: 'agent', correlationJournalIds: [], firstObservedAt: lease.firstObservedAt });
    if (second.kind !== 'created') throw new Error('the second lease was not created');
    for (let n = next; n < next + 10 && leaseOf(durable, second.leaseId).disposition === 'ephemeral'; n += 1) await pass(w, at(n), [WTX, WTY]);
    expect(leaseOf(durable, second.leaseId).disposition).toBe('adopted');
    expect(mail(w).map((m) => m.subject)).toEqual([`delegation: worktree kept for ${OWNER} (${lease.leaseId}, generation 2)`,
      `delegation: worktree kept for ${OWNER} (${second.leaseId}, generation 2)`]);
  }, ROW_MS);

  // O5-4 (a): a programme worker's notice goes to the coordinator `leaseCoordinatorOf` names, through the binding series (D-8042).
  // The 501-run cases put the claimant's run at each end of the parent's series (review 1564 F1): FIRST (the lowest id), so the bounded
  // `delegationRunStamps()` window (the newest 500 closed by id) drops it (W5-DM11d); LAST (the highest id), so a series read capped at 500
  // rows in id order drops it.
  it.each(['open', 'closed', 'closed, first of 502 in the parent\'s own series', 'closed, last of 502 in the parent\'s own series'] as const)('W5-Q5: a worker\'s lease (%s run) is noticed to its coordinator, never the worker', async (shape) => {
    const { w, durable, lease } = await leased();
    const first = Date.parse(lease.firstObservedAt);
    let k = 0;
    const open = (claimedBy: string): number => {
      const r = w.coord.openRun({ program: `program-${k++}`, title: 'run-a', project: 'demo', wave: 1, waveOf: 1, claimedBy });
      if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
      return r.id;
    };
    // 501 closed runs of the worker, claimed by another coordinator, with intervals after the lease's first observation
    const others = (): void => {
      for (let i = 0; i < 501; i += 1) {
        const id = open('coord-b-demo');
        expect(w.coord.advance(id, 'failed', 'test-close').ok).toBe(true);
        w.coord.db.prepare('UPDATE runs SET sessionId = ?, openedAt = ?, closedAt = ? WHERE id = ?').run(OWNER, first + 3_600_000, first + 7_200_000, id);
      }
    };
    if (shape.includes('last of 502')) others();
    const mine = open('coord-a-demo');
    w.coord.bindSession(mine, OWNER);
    if (shape !== 'open') expect(w.coord.advance(mine, 'failed', 'test-close').ok).toBe(true);
    w.coord.db.prepare('UPDATE runs SET openedAt = ?, closedAt = ? WHERE id = ?').run(first - 60_000, shape === 'open' ? null : first + 60_000, mine);
    if (shape.includes('first of 502')) others();
    touch(w, 'delegation-adopt');
    await passesUntilKept(w, durable, lease.leaseId, 0);
    expect(leaseOf(durable, lease.leaseId).disposition).toBe('adopted');
    expect(mail(w).map((m) => [m.toId, m.subject])).toEqual([['coord-a-demo', `delegation: worktree kept for coord-a-demo (${lease.leaseId}, generation 2)`]]);
  }, ROW_MS);

  it('W5-Q6: a parent with no registry row — adopted (the parent measured absent is terminal evidence too), a feed row, and no mail', async () => {
    const { w, durable, lease } = await leased();
    touch(w, 'delegation-adopt');
    w.sessions = [];
    await passesUntilKept(w, durable, lease.leaseId, 0);
    expect(leaseOf(durable, lease.leaseId).disposition).toBe('adopted');
    expect(w.feed.filter((f) => f.title === 'worktree kept: demo/wt-x')).toHaveLength(1);
    expect(mail(w)).toEqual([]);
    expect(health(w)?.owed, 'a null recipient owes nothing').toBe(0);
  }, ROW_MS);

  it('W5-Q6b: adopted on a changed incarnation of a non-programme parent — a feed row and no mail carrying a Retain line it could not use', async () => {
    const { w, durable, lease } = await leased();
    touch(w, 'delegation-adopt');
    w.sessions = [{ id: OWNER, incarnation: '7f3c9a10-5555-4aaa-8bbb-0123456789cd' }];
    await passesUntilKept(w, durable, lease.leaseId, 0);
    expect(leaseOf(durable, lease.leaseId).disposition).toBe('adopted');
    expect(w.feed.filter((f) => f.title === 'worktree kept: demo/wt-x')).toHaveLength(1);
    expect(mail(w)).toEqual([]);
  }, ROW_MS);

  it('W5-Q9: attention — a breaker suspended over two passes raises one push; a passed expiry one; a conflicting lease one; none repeats', async () => {
    const { w, durable, lease } = await leased();
    const lane = (w.watcher as unknown as { delegationLane(): Record<string, unknown> }).delegationLane();
    // the breaker: two parents measured dead inside its window
    (lane['firstDead'] as Map<string, number>).set('lane-p1-demo', at(0) - 60_000).set('lane-p2-demo', at(0) - 60_000);
    await pass(w, at(0));
    (lane['firstDead'] as Map<string, number>).set('lane-p1-demo', at(1) - 60_000).set('lane-p2-demo', at(1) - 60_000);
    await pass(w, at(1));
    expect(w.pushes.filter((t) => t === 'delegation adoption suspended')).toHaveLength(1);
    expect(health(w)?.mode).toBe('suspended');
    // a conflicting attempt on the lease's tree
    await durable.applyCheckpointChange((cp) => ({ ...cp, attempts: [...cp.attempts, { attemptId: delegationSha256Hex('pr7-conflict'), parentId: OWNER,
      parentIncarnation: INC, project: 'demo', adminRecord: 'wt-x', canonicalPath: WTX.canonicalPath!, attemptedAt: iso(at(1)), rung: null, verdict: 'conflicting',
      evidenceJournalIds: [], detail: 'rungs-disagree' }] }));
    (lane['firstDead'] as Map<string, number>).clear();
    await pass(w, at(2));
    await pass(w, at(3));
    expect(w.pushes.filter((t) => t === 'worktree on a conflicting tree: demo/wt-x')).toHaveLength(1);
    expect(health(w)?.conflicting).toBe(1);
    // a kept lease past its expiry and the hold's margin
    const kept = await durable.transitionLease({ leaseId: lease.leaseId, expectGeneration: leaseOf(durable, lease.leaseId).generation, reason: 'operator-retain',
      at: iso(at(3)), expiresAt: iso(at(4)), terminalEvidenceAt: null, runId: null, promotedSession: null, auditEvidence: null, carrierRequired: false, resolvesThrough: null });
    expect(kept.kind).toBe('applied');
    await pass(w, at(4) + 2 * 3_600_000);
    await pass(w, at(5) + 2 * 3_600_000);
    expect(w.pushes.filter((t) => t === 'worktree no longer held back: demo/wt-x')).toHaveLength(1);
    expect(w.pushes.filter((t) => t === 'delegation adoption suspended'), 'none repeats').toHaveLength(1);
  }, ROW_MS);

  it('W5-Q7: a kept lease 23 hours from its expiry is reminded once; the next pass queues none', async () => {
    const { w, durable, lease } = await leased();
    touch(w, 'delegation-adopt');
    const next = await passesUntilKept(w, durable, lease.leaseId, 0);
    const due = Date.parse(leaseOf(durable, lease.leaseId).cleanupDueAt!);
    await pass(w, due - 23 * 3_600_000);
    await pass(w, due - 23 * 3_600_000 + DELEGATION_SWEEP_MS);
    const reminders = mail(w).filter((m) => m.subject.startsWith('delegation: worktree hold ends soon'));
    expect(reminders.map((m) => [m.toId, m.subject])).toEqual([[OWNER, `delegation: worktree hold ends soon (${lease.leaseId}, generation 2)`]]);
    expect(reminders[0]!.body).toContain(CLOSING);
    expect(due - 23 * 3_600_000 >= due - DELEGATION_REMINDER_LEAD_MS && next > 0).toBe(true);
  }, ROW_MS);

  it('W5-Q8: no lease-audit-v1 — the decider sees unsupported and adopts (counts changed), and no ws-lease-audit argv is composed', async () => {
    const { w, durable, lease } = await leased({ caps: FULL.filter((c) => c !== LEASE_AUDIT_CAP) });
    touch(w, 'delegation-adopt');
    await passesUntilKept(w, durable, lease.leaseId, 0);
    expect(leaseOf(durable, lease.leaseId).disposition).toBe('adopted');
    expect(audits(w)).toEqual([]);
  }, ROW_MS);

  it('W5-Q8b: with lease-audit-v1 the audit is composed once, read-only, and an unchanged answer keeps the tree ephemeral', async () => {
    const { w, durable, lease } = await leased();
    touch(w, 'delegation-adopt');
    w.audit = { ...w.audit, changed: false };
    for (let n = 0; n < 6; n += 1) await pass(w, at(n));
    expect(leaseOf(durable, lease.leaseId).disposition).toBe('ephemeral');
    expect(audits(w)[0]).toEqual(['ws-lease-audit', '--lease', lease.leaseId, '--generation', '1']);
    expect(health(w)?.unchanged).toBe(1);
  }, ROW_MS);

  it.each([[LEASE_MARK_LOCK_CAP], [ORPHAN_LEASE_CAP]])('boxHolds: a box without %s adopts nothing and counts unsupported (D-8040 carried to adoption)', async (missing) => {
    const { w, durable, lease } = await leased({ caps: FULL.filter((c) => c !== missing) });
    touch(w, 'delegation-adopt');
    for (let n = 0; n < 9; n += 1) await pass(w, at(n));
    expect(leaseOf(durable, lease.leaseId)).toMatchObject({ disposition: 'ephemeral', carrierGenerationSeen: 1 });
    expect(health(w)?.unsupported).toBe(1);
  }, ROW_MS);

  it('review 1564 F8 (rows only): with capabilities unmeasured (ccdVerbs null) adoption adopts nothing and counts unsupported', async () => {
    const { w, durable, lease } = await leased();
    touch(w, 'delegation-adopt');
    for (let n = 0; n < 3; n += 1) await pass(w, at(n));          // the carrier is minted, marked and seen on a measured box
    w.fleet.ccdVerbs = null;
    for (let n = 3; n < 9; n += 1) await pass(w, at(n));
    expect(leaseOf(durable, lease.leaseId).disposition).toBe('ephemeral');
    expect(health(w)?.unsupported).toBe(1);
    expect(audits(w), 'and no audit is composed on no evidence').toEqual([]);
  }, ROW_MS);
});
