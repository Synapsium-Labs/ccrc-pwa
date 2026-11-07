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
import { DELEGATION_AUDIT_HOLD_MS, DELEGATION_HOLD_CLOSING, DELEGATION_REMINDER_LEAD_MS } from '../src/coord/delegation-adoption.js';
import type { DelegationDurability } from '../src/coord/delegation-checkpoint.js';
import { delegationAdoptionHealthOf, type DelegationEventEnvelopeV1, type FleetSession, type Presence } from '../../shared/api.js';
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
  audit: Audit; feed: { title: string; body: string }[]; pushes: string[];
  /** PR7b (review 1609 F1): `presence` defaults from `status` (`dead` for dead, else `alive`); set it to send a row tmux did not answer for. */
  sessions: { id: string; incarnation: string; status?: 'idle' | 'dead'; stoppedAt?: number; presence?: Presence }[];
  /** PR7b: run inside the fixture io before it reads a file or lists a directory (review 1609 F4, the one-`try` advisory). */
  onRead?: (file: string) => void; onList?: (dir: string) => void;
  /** Review 1604 F4: run inside the recording `ws-lease-audit`, before it answers. */
  onAudit?: () => void;
  /** Review 1587 F1: ids the registry's listing names whose row it could not assemble (no record, no session). */
  unbuilt: string[];
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
    sessions: [{ id: OWNER, incarnation: INC }], unbuilt: [] } as Omit<World, 'watcher'> as World;
  const runCcd = async (argv: readonly string[]): Promise<CcdResult> => {
    made.argvs.push([...argv]);
    const f = flagsOf(argv);
    if (argv[0] === 'ws-lease-mark') {
      writeCarrier(made, f);
      return ok(`${JSON.stringify({ ok: true, answer: 'written', lease: f.lease, generation: Number(f.generation), state: f.state })}\n`);
    }
    if (argv[0] === 'ws-lease-audit') made.onAudit?.();
    if (argv[0] === 'ws-lease-audit') return ok(`${JSON.stringify({ ...made.audit, lease: f.lease, generation: Number(f.generation) })}\n`);
    throw new Error(`unexpected ccd ${argv.join(' ')}`);
  };
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  const record = notifyLog.record.bind(notifyLog);
  vi.spyOn(notifyLog, 'record').mockImplementation((e) => { made.feed.push({ title: e.title, body: e.body }); return record(e); });
  const push = { notify: (p: { title: string }) => { made.pushes.push(p.title); return Promise.resolve(); } };
  const io = { ...localIO,
    readFileMeasured: (...a: Parameters<typeof localIO.readFileMeasured>) => { made.onRead?.(a[0]); return localIO.readFileMeasured(...a); },
    readdirMeasured: (...a: Parameters<typeof localIO.readdirMeasured>) => { made.onList?.(a[0]); return localIO.readdirMeasured(...a); } };
  const deps = { ...testDeps(home), monotonicMs: () => Date.now(), cfg, io, coord, fleetState: fleet, runCcd, notifyLog, push };
  made.watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  worlds.push(made);
  return made;
}

const WTX: DelegationCensusRecord = { project: 'demo', adminRecord: 'wt-x', canonicalPath: '/w/demo/.claude/worktrees/wt-x', headBranch: null,
  headSha: 'a'.repeat(40), claudeBase: 'b'.repeat(40), locked: false, baseAgreesFirstLog: true, state: 'present', diagnostic: null };
const sessionOf = (id: string, status: 'idle' | 'dead' = 'idle', stoppedAt?: number, presence?: Presence) => ({ id, project: 'demo', status,
  presence: presence ?? (status === 'dead' ? 'dead' : 'alive'),
  stoppedBy: (stoppedAt === undefined ? null : { at: stoppedAt, surface: 'ccd' }) as FleetSession['stoppedBy'], archivedAt: null as FleetSession['archivedAt'] });
/** One census pass at `ms`: the census lists `recs`, and the registry lists the world's sessions (an absent session: no row; an unbuilt
 *  one: named by the listing, with no record and no session). */
const pass = async (w: World, ms: number, recs: DelegationCensusRecord[] = [WTX], census = true): Promise<void> => {
  vi.spyOn(Date, 'now').mockReturnValue(ms);
  const c: DelegationCensusPass = { measuredAt: ms, projects: new Map([['demo', { read: { ok: true, records: [] }, delegation: recs }]]),
    incarnations: new Map(w.sessions.map((s) => [s.id, { kind: 'measured', incarnation: s.incarnation }] as const)) };
  if (census) (w.watcher as unknown as { delegationCensus: DelegationCensusPass | null }).delegationCensus = c;
  (w.watcher as unknown as { listedIds: ReadonlySet<string> | null }).listedIds = new Set(w.sessions.map((x) => x.id));
  const s = w.sessions.filter((x) => !w.unbuilt.includes(x.id)).map((x) => sessionOf(x.id, x.status, x.stoppedAt, x.presence));
  await w.watcher.sweepDelegation(s as never, s.map((x) => ({ id: x.id, project: x.project, child: { kind: 'none' } })) as never);
};
/** PR7b: a pass with no newer census, so the lane notes its sessions and the adoption step does not run (review 1609 F2, F5). */
const quietPass = (w: World, ms: number): Promise<void> => pass(w, ms, [WTX], false);

let serial = 0;
const ev = (ms: number) => {
  const n = ++serial;
  return { v: 1 as const, observedAt: iso(ms), sessionId: OWNER, parentIncarnation: INC, claudeSessionId: '11111111-2222-3333-4444-555555555555',
    eventId: delegationSha256Hex(`pr7-lane-event-${n}`), bucket: '2026101510', startOffset: n * 100, endOffset: n * 100 + 99 };
};
/** The lane, primed and ready, holding one `agent` lease on `wt-x` whose activity ended (its SubagentStop) at `NOW - 20 min`; with
 *  `ended: false` the activity is still active (no SubagentStop), so only the parent can give terminal evidence. */
async function leased(opts: { caps?: string[] | null; ended?: boolean } = {}): Promise<{ w: World; durable: DelegationDurability; lease: DelegationLeaseRow }> {
  const w = world(opts);
  await pass(w, NOW - 25 * 60_000, []);
  const durable = (await w.watcher.delegationApplier())!;
  const E0 = NOW - 22 * 60_000;
  const events: DelegationEventEnvelopeV1[] = [{ ...ev(E0), eventKind: 'SessionStart', source: 'startup' } as DelegationEventEnvelopeV1,
    { ...ev(E0 + 60_000), eventKind: 'SubagentStart', agentId: 'agent-x', agentType: null } as DelegationEventEnvelopeV1,
    ...(opts.ended === false ? [] : [{ ...ev(E0 + 120_000), eventKind: 'SubagentStop', agentId: 'agent-x', agentType: null, agentTranscriptPath: null } as DelegationEventEnvelopeV1])];
  await durable.applyAccepted({ accepted: events.map((event) => ({ event, acceptedAt: iso(Date.parse(event.observedAt) + 1000) })), cursor: null, interval: null });
  const cp = durable.state().checkpoint;
  const activityId = cp.activityIdsByNaturalKey[encodeDelegationNaturalKey({ parentId: OWNER, parentIncarnation: INC, sourceKind: 'agent', upstreamId: 'agent-x' })]!;
  expect(cp.activities.find((a) => a.activityId === activityId)?.executionState, 'CONTROL: the SubagentStop ended the activity, or none ran')
    .toBe(opts.ended === false ? 'active' : 'ended');
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

// Review 1587, fix round 1 (the coordinator's rulings of 2026-11-06): what the step feeds the decider and the memory it keeps.
describe('PR7 fix round 1: the parents, kept evidence, held audits, attention, dated notices, the owed count and the log memories', () => {
  type LaneMemo = { firstDead: Map<string, number>; running: Map<AbortController, Promise<unknown>> };
  const laneOf = (w: World): LaneMemo => (w.watcher as unknown as { delegationLane(): LaneMemo }).delegationLane();
  const disposition = (durable: DelegationDurability, id: string) => leaseOf(durable, id).disposition;
  const dead = (w: World): void => { w.sessions = [{ id: OWNER, incarnation: INC, status: 'dead' }]; };
  const alive = (w: World): void => { w.sessions = [{ id: OWNER, incarnation: INC }]; };
  const kept = (w: World) => w.feed.filter((f) => f.title === 'worktree kept: demo/wt-x');

  it('F1: a parent the listing names but the registry could not assemble is unmeasured, never absent: no adoption over the settle and the passes', async () => {
    const { w, durable, lease } = await leased({ ended: false });
    touch(w, 'delegation-adopt');
    for (let n = 0; n < 3; n += 1) await pass(w, at(n));          // alive: the carrier is minted, marked and seen
    w.unbuilt = [OWNER];
    for (let n = 3; n < 16; n += 1) await pass(w, at(n));
    expect(disposition(durable, lease.leaseId)).toBe('ephemeral');
    w.unbuilt = [];
    w.sessions = [];
    expect(disposition(durable, lease.leaseId)).toBe('ephemeral');
    await passesUntilKept(w, durable, lease.leaseId, 16, 12);
    expect(disposition(durable, lease.leaseId), 'CONTROL: unlisted (absent), the same lease is adopted').toBe('adopted');
  }, ROW_MS);

  it('F2: a dead parent whose dead-since memory has aged out still counts would-adopt in shadow, and adopts live', async () => {
    const { w, durable, lease } = await leased({ ended: false });
    for (let n = 0; n < 3; n += 1) await pass(w, at(n));
    dead(w);
    for (let n = 3; n < 14; n += 1) await pass(w, at(n));
    expect(health(w)).toMatchObject({ mode: 'shadow', wouldAdopt: 1 });
    expect(laneOf(w).firstDead.has(OWNER), 'CONTROL: the death is remembered').toBe(true);
    const late = at(3) + 62 * 60_000;                                // past the lane's 60-minute dead-since memory
    await pass(w, late);
    expect(laneOf(w).firstDead.has(OWNER), 'CONTROL: the dead-since memory aged out').toBe(false);
    expect(health(w)).toMatchObject({ mode: 'shadow', wouldAdopt: 1 });
    touch(w, 'delegation-adopt');
    for (let k = 1; k < 4 && disposition(durable, lease.leaseId) === 'ephemeral'; k += 1) await pass(w, late + k * 60_000);
    expect(disposition(durable, lease.leaseId)).toBe('adopted');
  }, ROW_MS);

  it.each([1, 3])('F2: a parent dead for %i pass(es) and then alive again at its incarnation (a supervisor restart) never adopts', async (deadPasses) => {
    const { w, durable, lease } = await leased({ ended: false });
    touch(w, 'delegation-adopt');
    for (let n = 0; n < 3; n += 1) await pass(w, at(n));
    dead(w);
    for (let n = 3; n < 3 + deadPasses; n += 1) await pass(w, at(n));
    alive(w);
    for (let n = 3 + deadPasses; n < 20; n += 1) await pass(w, at(n));
    expect(disposition(durable, lease.leaseId)).toBe('ephemeral');
    expect(health(w)?.adopted ?? 0).toBe(0);
  }, ROW_MS);

  it('F2: a restart (a new lane, fresh memory) over a dead parent adopts nothing on death alone; measured absent, it adopts', async () => {
    const { w, lease } = await leased({ ended: false });
    for (let n = 0; n < 3; n += 1) await pass(w, at(n));
    dead(w);
    await w.watcher.closeDelegation();
    w.watcher = new FleetWatcher((w.watcher as unknown as { deps: unknown }).deps as never, new Bus(), 10_000);
    touch(w, 'delegation-adopt');
    for (let n = 3; n < 20; n += 1) await pass(w, at(n));
    const restarted = (await w.watcher.delegationApplier())!;                    // review 1604 F3: the NEW lane's applier
    expect(leaseOf(restarted, lease.leaseId).disposition).toBe('ephemeral');
    expect(health(w)?.adopted ?? 0).toBe(0);
    expect(laneOf(w).firstDead.size, 'the new lane never saw the parent alive, so it never saw it die').toBe(0);
    w.sessions = [];                                                             // CONTROL: the row measured absent is evidence a restart keeps
    for (let n = 20; n < 32 && leaseOf(restarted, lease.leaseId).disposition === 'ephemeral'; n += 1) await pass(w, at(n));
    expect(leaseOf(restarted, lease.leaseId).disposition).toBe('adopted');
  }, ROW_MS);

  it('F3: a held audit answer older than an hour is asked again before an adoption', async () => {
    const { w, durable, lease } = await leased();
    for (let n = 0; n < 9; n += 1) await pass(w, at(n));
    expect(audits(w)).toHaveLength(1);
    expect(health(w)?.wouldAdopt).toBe(1);
    touch(w, 'delegation-adopt');
    const late = at(8) + DELEGATION_AUDIT_HOLD_MS + 60_000;
    await pass(w, late);
    expect(disposition(durable, lease.leaseId), 'the day-old answer does not adopt').toBe('ephemeral');
    await pass(w, late + 60_000);
    expect(audits(w), 'asked again').toHaveLength(2);
    expect(disposition(durable, lease.leaseId)).toBe('adopted');
  }, ROW_MS);

  it('F3: an unmeasured audit answer is never held: the next pass asks for it again', async () => {
    const { w, lease } = await leased();
    w.audit = { ok: false, refusal: 'unmeasured', detail: 'fixture: the tree could not be measured' };
    const counts: number[] = [];
    for (let n = 0; n < 12; n += 1) { await pass(w, at(n)); counts.push(audits(w).length); }
    const first = counts.indexOf(1);
    expect(first, `CONTROL: an audit ran (${counts.join(',')})`).toBeGreaterThanOrEqual(0);
    expect(counts[first + 2], `asked by the next pass, composed at the start of the one after (${counts.join(',')})`).toBe(2);
    expect(audits(w).every((a) => a[2] === lease.leaseId)).toBe(true);
  }, ROW_MS);

  it('A8: an unchanged lease is not audited again within the hour; past it, it is', async () => {
    const { w, durable, lease } = await leased();
    touch(w, 'delegation-adopt');
    w.audit = { ...w.audit, changed: false };
    for (let n = 0; n < 30; n += 1) await pass(w, at(n));
    expect(audits(w)).toHaveLength(1);
    expect(health(w)?.unchanged).toBe(1);
    const late = at(0) + DELEGATION_AUDIT_HOLD_MS + 5 * 60_000;
    for (let k = 0; k < 6; k += 1) await pass(w, late + k * 60_000);
    expect(audits(w)).toHaveLength(2);
    expect(disposition(durable, lease.leaseId)).toBe('ephemeral');
  }, ROW_MS);

  it('F4: a pass cut while the adopt transition is awaited raises its attention items on the next pass, once', async () => {
    const { w, durable, lease } = await leased();
    const WTY = { ...WTX, adminRecord: 'wt-y', canonicalPath: '/w/demo/.claude/worktrees/wt-y' };
    const second = await durable.createLease({ activityId: lease.activityId, parentId: OWNER, parentIncarnation: INC, project: 'demo', adminRecord: 'wt-y',
      canonicalPath: WTY.canonicalPath, creationBase: null, sourceKind: 'agent', correlationJournalIds: [], firstObservedAt: lease.firstObservedAt });
    if (second.kind !== 'created') throw new Error('the second lease was not created');
    for (let n = 0; n < 9; n += 1) await pass(w, at(n), [WTX, WTY]);
    expect(health(w)?.wouldAdopt, 'CONTROL: both wait in shadow, settled and audited').toBe(2);
    await durable.applyCheckpointChange((cp) => ({ ...cp, attempts: [...cp.attempts, { attemptId: delegationSha256Hex('pr7-fr1-conflict'), parentId: OWNER,
      parentIncarnation: INC, project: 'demo', adminRecord: 'wt-y', canonicalPath: WTY.canonicalPath, attemptedAt: iso(at(8)), rung: null, verdict: 'conflicting',
      evidenceJournalIds: [], detail: 'rungs-disagree' }] }));
    touch(w, 'delegation-adopt');
    const lane = laneOf(w);
    let late: Promise<unknown>[] = [];
    const real = durable.transitionLease.bind(durable);
    vi.spyOn(durable, 'transitionLease').mockImplementationOnce(async (a) => {
      late = [...lane.running.values()];
      for (const ac of lane.running.keys()) ac.abort();           // the pass is cut while the act is awaited
      return real(a);
    });
    await pass(w, at(9), [WTX, WTY]);
    await Promise.allSettled(late);
    expect(disposition(durable, lease.leaseId), 'CONTROL: the act landed').toBe('adopted');
    const conflicts = () => w.pushes.filter((t) => t === 'worktree on a conflicting tree: demo/wt-y').length;
    expect(conflicts(), 'the cut pass pushed nothing after the act').toBe(0);
    await pass(w, at(10), [WTX, WTY]);
    expect(conflicts()).toBe(1);
    await pass(w, at(11), [WTX, WTY]);
    expect(conflicts(), 'once').toBe(1);
  }, ROW_MS);

  it('F5: an adoption made while mail-disabled stood, lifted after its hold ended, queues no digest', async () => {
    const { w, durable, lease } = await leased();
    touch(w, 'delegation-adopt');
    touch(w, 'mail-disabled');
    await passesUntilKept(w, durable, lease.leaseId, 0);
    expect(disposition(durable, lease.leaseId)).toBe('adopted');
    expect(mail(w)).toEqual([]);
    const due = Date.parse(leaseOf(durable, lease.leaseId).cleanupDueAt!);
    unmark(w, 'mail-disabled');
    await pass(w, due + 60_000);
    await pass(w, due + 2 * 60_000);
    expect(mail(w)).toEqual([]);
    expect(health(w)?.owed ?? 0).toBe(0);
  }, ROW_MS);

  it('F6: a digest already sent is not owed while mail-disabled stands', async () => {
    const { w, durable, lease } = await leased();
    touch(w, 'delegation-adopt');
    const next = await passesUntilKept(w, durable, lease.leaseId, 0);
    expect(mail(w)).toHaveLength(1);
    touch(w, 'mail-disabled');
    await pass(w, at(next));
    await pass(w, at(next + 1));
    expect(health(w)?.owed ?? 0).toBe(0);
  }, ROW_MS);

  it('F6, A2: an unmeasured recipient holds the notice and counts as owed, and never writes the record-only row; measured again, it is mailed once', async () => {
    const { w, durable, lease } = await leased();
    touch(w, 'delegation-adopt');
    touch(w, 'mail-disabled');
    const next = await passesUntilKept(w, durable, lease.leaseId, 0);
    expect(kept(w)).toHaveLength(1);
    w.unbuilt = [OWNER];
    unmark(w, 'mail-disabled');
    await pass(w, at(next));
    await pass(w, at(next + 1));
    expect(mail(w)).toEqual([]);
    expect(health(w)?.owed).toBe(1);
    expect(kept(w), 'no record-only row for a recipient that did not read').toHaveLength(1);
    w.unbuilt = [];
    await pass(w, at(next + 2));
    await pass(w, at(next + 3));
    expect(mail(w).map((m) => m.subject)).toEqual([`delegation: worktree kept for ${OWNER} (${lease.leaseId}, generation 2)`]);
  }, ROW_MS);

  it('A1: a refused adoption at a generation shadow already logged still logs its refusal once', async () => {
    const { w, durable, lease } = await leased();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (let n = 0; n < 9; n += 1) await pass(w, at(n));
    const lines = () => warn.mock.calls.map((c) => String(c[0]));
    expect(lines().filter((l) => l.startsWith(`ccrc-server: delegation: adoption shadow: would adopt ${lease.leaseId}`))).toHaveLength(1);
    vi.spyOn(durable, 'transitionLease').mockResolvedValue({ kind: 'refused', refusal: 'carrier-behind', detail: 'fixture refusal' } as never);
    touch(w, 'delegation-adopt');
    for (let n = 9; n < 13; n += 1) await pass(w, at(n));
    expect(lines().filter((l) => l.startsWith(`ccrc-server: delegation: adoption of ${lease.leaseId} refused`))).toEqual([
      `ccrc-server: delegation: adoption of ${lease.leaseId} refused carrier-behind: fixture refusal`]);
  }, ROW_MS);
});

// Review 1604, fix round 2.
describe('PR7 fix round 2: rotation, a pass cut inside an audit, and a retracted death', () => {
  type LaneMemo = { firstDead: Map<string, number>; running: Map<AbortController, Promise<unknown>>; adoptMemory: Record<string, unknown> };
  const laneOf = (w: World): LaneMemo => (w.watcher as unknown as { delegationLane(): LaneMemo }).delegationLane();

  it('F4: a pass cut inside an awaited audit writes no lane memory and queues nothing', async () => {
    const { w } = await leased();
    let n = 0;
    const memo = () => laneOf(w).adoptMemory as { asked: unknown[] };
    for (; n < 12 && memo().asked.length === 0; n += 1) await pass(w, at(n));
    expect(memo().asked.length, 'CONTROL: an audit is asked for').toBe(1);
    const snap = (): string => JSON.stringify(memo(), (_k, v: unknown) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v));
    const before = snap(), mailBefore = mail(w).length;
    let late: Promise<unknown>[] = [];
    w.onAudit = () => { const lane = laneOf(w); late = [...lane.running.values()]; for (const ac of lane.running.keys()) ac.abort(); };
    await pass(w, at(n));
    await Promise.allSettled(late);
    expect(snap()).toBe(before);
    expect(mail(w)).toHaveLength(mailBefore);
  }, ROW_MS);

  it('F7: a death the lane kept, then retracted by a stop stamp dated at it, never adopts', async () => {
    const { w, durable, lease } = await leased({ ended: false });
    touch(w, 'delegation-adopt');
    for (let n = 0; n < 3; n += 1) await pass(w, at(n));
    w.sessions = [{ id: OWNER, incarnation: INC, status: 'dead' }];
    for (let n = 3; n < 6; n += 1) await pass(w, at(n));                       // the death counted at at(3), kept from at(4)
    expect(laneOf(w).firstDead.get(OWNER), 'CONTROL: the death is counted').toBe(at(3));
    w.sessions = [{ id: OWNER, incarnation: INC, status: 'dead', stoppedAt: at(3) }];
    for (let n = 6; n < 20; n += 1) await pass(w, at(n));
    expect(laneOf(w).firstDead.has(OWNER), 'CONTROL: the lane retracted it').toBe(false);
    expect(leaseOf(durable, lease.leaseId).disposition).toBe('ephemeral');
  }, ROW_MS);
});

// PR7b (run 1612): the coordinator's rulings on review 1609, the third review of PR7.
describe('PR7b (review 1609): presence, a retraction kept while unbuilt, cuts that keep what came back, an outlived death, and the step\'s own try', () => {
  type Memo = { asked: { leaseId: string }[]; audits: Map<string, unknown>; watch: Map<string, unknown>; health: { waiting: number; wouldAdopt: number } | null };
  type LaneMemo = { firstDead: Map<string, number>; retractedDeaths: Set<string>; running: Map<AbortController, Promise<unknown>>; adoptMemory: Memo };
  const laneOf = (w: World): LaneMemo => (w.watcher as unknown as { delegationLane(): LaneMemo }).delegationLane();
  const disposition = (durable: DelegationDurability, id: string) => leaseOf(durable, id).disposition;
  const dead = (w: World, more: Partial<World['sessions'][number]> = {}): void => { w.sessions = [{ id: OWNER, incarnation: INC, status: 'dead', ...more }]; };
  const snap = (w: World): string => JSON.stringify(laneOf(w).adoptMemory, (_k, v: unknown) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v));
  /** Cut the lane's pass from inside an awaited read; answers the work the cut lets run on (D-7878), to be awaited. */
  const cutNow = (w: World): Promise<unknown>[] => { const lane = laneOf(w); const late = [...lane.running.values()]; for (const ac of lane.running.keys()) ac.abort(); return late; };
  /** `n` more leases on the fixture lease's activity, one tree each. */
  const more = async (durable: DelegationDurability, lease: DelegationLeaseRow, n: number): Promise<{ trees: DelegationCensusRecord[]; ids: string[] }> => {
    const trees = [WTX], ids = [lease.leaseId];
    for (let i = 1; i <= n; i += 1) {
      const t = { ...WTX, adminRecord: `wt-${i}`, canonicalPath: `/w/demo/.claude/worktrees/wt-${i}` };
      const made = await durable.createLease({ activityId: lease.activityId, parentId: OWNER, parentIncarnation: INC, project: 'demo', adminRecord: t.adminRecord,
        canonicalPath: t.canonicalPath, creationBase: null, sourceKind: 'agent', correlationJournalIds: [], firstObservedAt: lease.firstObservedAt });
      if (made.kind !== 'created') throw new Error('a lease was not created');
      trees.push(t);
      ids.push(made.leaseId);
    }
    return { trees, ids };
  };

  it.each(['unknown', 'asleep', 'dead'] as const)('F1: a parent with a kept death whose row then reads presence %s (status dead) adopts only when measured dead', async (presence) => {
    const { w, durable, lease } = await leased({ ended: false });
    touch(w, 'delegation-adopt');
    for (let n = 0; n < 3; n += 1) await pass(w, at(n));
    dead(w);
    for (let n = 3; n < 6; n += 1) await pass(w, at(n));
    expect(laneOf(w).adoptMemory.watch.has(lease.leaseId), 'CONTROL: the death is kept').toBe(true);
    dead(w, { presence });
    for (let n = 6; n < 24 && disposition(durable, lease.leaseId) === 'ephemeral'; n += 1) await pass(w, at(n));
    if (presence === 'dead') { expect(disposition(durable, lease.leaseId), 'CONTROL: measured dead, it adopts').toBe('adopted'); return; }
    expect(disposition(durable, lease.leaseId)).toBe('ephemeral');
    expect(health(w)).toMatchObject({ waiting: 1, adopted: 0 });
  }, ROW_MS);

  it('F2: a late stop stamp on a pass that does not run the step, the row then listed but unbuilt, then built: the retraction stands and it never adopts', async () => {
    const { w, durable, lease } = await leased({ ended: false });
    touch(w, 'delegation-adopt');
    for (let n = 0; n < 3; n += 1) await pass(w, at(n));
    dead(w);
    for (let n = 3; n < 6; n += 1) await pass(w, at(n));
    expect(laneOf(w).adoptMemory.watch.has(lease.leaseId), 'CONTROL: the death is kept').toBe(true);
    dead(w, { stoppedAt: at(3) });
    await quietPass(w, at(6));
    expect(laneOf(w).retractedDeaths.has(OWNER), 'CONTROL: retracted on a pass that does not run the step').toBe(true);
    expect(laneOf(w).adoptMemory.watch.has(lease.leaseId), 'CONTROL: so the decider still keeps the death').toBe(true);
    w.unbuilt = [OWNER];
    await pass(w, at(7));
    expect(laneOf(w).retractedDeaths.has(OWNER), 'listed but unbuilt is not a measured absence').toBe(true);
    w.unbuilt = [];
    for (let n = 8; n < 24; n += 1) await pass(w, at(n));
    expect(disposition(durable, lease.leaseId)).toBe('ephemeral');
  }, ROW_MS);

  it('F3: four asks, a cut after two answers: the two are held, and the next pass asks only the other two', async () => {
    const { w, durable, lease } = await leased();
    const { trees, ids } = await more(durable, lease, 3);
    for (let n = 0; n < 20 && laneOf(w).adoptMemory.asked.length < 4; n += 1) await pass(w, at(n), trees);
    expect(laneOf(w).adoptMemory.asked.map((a) => a.leaseId).sort(), 'CONTROL: all four asked in one pass').toEqual([...ids].sort());
    const k = audits(w).length;
    let calls = 0, late: Promise<unknown>[] = [];
    w.onAudit = () => { calls += 1; if (calls === 3) late = cutNow(w); };
    await pass(w, at(30), trees);
    await Promise.allSettled(late);
    w.onAudit = undefined;
    const answered = audits(w).slice(k, k + 2).map((a) => a[2]!);
    expect([...laneOf(w).adoptMemory.audits.keys()].sort(), 'the two answers back before the cut are held').toEqual([...answered].sort());
    expect(laneOf(w).adoptMemory.asked.map((a) => a.leaseId).sort(), 'their asks are dropped').toEqual(ids.filter((id) => !answered.includes(id)).sort());
    const before = audits(w).length;
    await pass(w, at(31), trees);
    expect(audits(w).slice(before).map((a) => a[2]).sort(), 'the next pass asks only the other two').toEqual(ids.filter((id) => !answered.includes(id)).sort());
  }, ROW_MS);

  it('F4: a pass cut inside its carrier read writes no lane memory', async () => {
    const { w, lease } = await leased();
    for (let n = 0; n < 12 && (laneOf(w).adoptMemory.health?.wouldAdopt ?? 0) === 0; n += 1) await pass(w, at(n));
    expect(laneOf(w).adoptMemory.health?.wouldAdopt, 'CONTROL: read, audited and counted in shadow').toBe(1);
    const before = snap(w);
    let late: Promise<unknown>[] = [], armed = true;
    w.onRead = (file) => { if (armed && file.endsWith(`/delegation/leases/${lease.leaseId}.json`)) { armed = false; late = cutNow(w); } };
    await pass(w, at(20));
    await Promise.allSettled(late);
    expect(armed, 'CONTROL: the step read the carrier').toBe(false);
    expect(snap(w)).toBe(before);
  }, ROW_MS);

  it('F4: a pass cut inside the effects loop keeps the adoption that landed, acts no further, and queues its notice on the next pass', async () => {
    const { w, durable, lease } = await leased();
    const { trees, ids } = await more(durable, lease, 1);
    for (let n = 0; n < 12 && (laneOf(w).adoptMemory.health?.wouldAdopt ?? 0) < 2; n += 1) await pass(w, at(n), trees);
    expect(laneOf(w).adoptMemory.health?.wouldAdopt, 'CONTROL: both settled and audited in shadow').toBe(2);
    const health0 = JSON.stringify(laneOf(w).adoptMemory.health);
    touch(w, 'delegation-adopt');
    let late: Promise<unknown>[] = [];
    const real = durable.transitionLease.bind(durable);
    vi.spyOn(durable, 'transitionLease').mockImplementationOnce(async (a) => { late = cutNow(w); return real(a); });
    await pass(w, at(20), trees);
    await Promise.allSettled(late);
    expect(ids.map((id) => disposition(durable, id)), 'the first landed; the cut stopped the second').toEqual(['adopted', 'ephemeral']);
    expect(w.feed.filter((f) => f.title === 'worktree kept: demo/wt-x'), 'the landed act kept its feed row').toHaveLength(1);
    expect(mail(w), 'no notice queued on the cut pass').toEqual([]);
    expect(JSON.stringify(laneOf(w).adoptMemory.health), 'and no health written').toBe(health0);
    await pass(w, at(21), trees);
    expect(mail(w).map((m) => m.subject)).toContain(`delegation: worktree kept for ${OWNER} (${lease.leaseId}, generation 2)`);
  }, ROW_MS);

  it('F5: alive on a pass where the step does not run, then dead again: the new death\'s own settle and passes apply', async () => {
    const { w, durable, lease } = await leased({ ended: false });
    touch(w, 'delegation-adopt');
    for (let n = 0; n < 3; n += 1) await pass(w, at(n));
    dead(w);
    for (let n = 3; n < 6; n += 1) await pass(w, at(n));
    expect(laneOf(w).adoptMemory.watch.has(lease.leaseId), 'CONTROL: the first death is kept').toBe(true);
    w.sessions = [{ id: OWNER, incarnation: INC }];
    await quietPass(w, at(6));
    dead(w);
    for (let n = 7; n < 13; n += 1) await pass(w, at(n));
    expect(disposition(durable, lease.leaseId), 'not on the first death').toBe('ephemeral');
    await passesUntilKept(w, durable, lease.leaseId, 13, 6);
    expect(leaseOf(durable, lease.leaseId)).toMatchObject({ disposition: 'adopted', terminalEvidenceAt: iso(at(8)) });
  }, ROW_MS);

  it('F6 (a): a census record that reads unreadable holds the entry, counted waiting; read again, it adopts on the first pass', async () => {
    const { w, durable, lease } = await leased();
    for (let n = 0; n < 12 && (laneOf(w).adoptMemory.health?.wouldAdopt ?? 0) === 0; n += 1) await pass(w, at(n));
    expect(laneOf(w).adoptMemory.health?.wouldAdopt, 'CONTROL: settled and audited in shadow').toBe(1);
    const unread: DelegationCensusRecord = { ...WTX, headSha: null, claudeBase: null, baseAgreesFirstLog: null, state: 'unreadable', diagnostic: 'fixture: the record did not read' };
    await pass(w, at(20), [unread]);                                 // one pass: a dropped entry would count nothing and restart its passes
    expect(laneOf(w).adoptMemory.health).toMatchObject({ waiting: 1, wouldAdopt: 0 });
    touch(w, 'delegation-adopt');
    await pass(w, at(21));
    expect(disposition(durable, lease.leaseId)).toBe('adopted');
  }, ROW_MS);

  // Review 1604 F2's ten-lease row, rewritten for review 1609 F6 (b): no lease is past rule 4 until one pass, so the count starts there.
  it('F2, F6 (b): ten leases past rules 4 to 6 at one pass — eight read and counted, the other two on the next, counted from after the settle', async () => {
    const { w, durable, lease } = await leased({ caps: FULL.filter((c) => c !== LEASE_AUDIT_CAP), ended: false });
    const { trees, ids } = await more(durable, lease, 9);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logged = () => new Set(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('ccrc-server: delegation: adoption shadow: would adopt '))
      .map((l) => l.split(' ')[6]));
    let n = 0;
    for (; n < 20 && durable.state().checkpoint.leases.some((l) => l.carrierGenerationSeen !== 1); n += 1) await pass(w, at(n), trees);
    w.sessions = [];                                                                // measured absent: every lease's terminal evidence at once
    for (; n < 40 && (laneOf(w).adoptMemory.health?.wouldAdopt ?? 0) === 0; n += 1) {
      expect(logged().size, 'CONTROL: nothing is counted before the reading pass').toBe(0);
      await pass(w, at(n), trees);
    }
    const first = logged();
    expect(first, 'the reading pass counts the eight oldest').toEqual(new Set(ids.slice(0, 8)));
    await pass(w, at(n), trees);
    expect(new Set([...logged()].filter((id) => !first.has(id))), 'the next pass counts the other two').toEqual(new Set(ids.slice(8)));
    expect((laneOf(w).adoptMemory as unknown as { lastRead: Map<string, number> }).lastRead.size, 'CONTROL: every carrier read within the two passes').toBe(10);
  }, ROW_MS);

  it('F6 (d): a parent-death lease with a definite changed:false is asked again after the hour', async () => {
    const { w, durable, lease } = await leased({ ended: false });
    touch(w, 'delegation-adopt');
    w.audit = { ...w.audit, changed: false };
    for (let n = 0; n < 3; n += 1) await pass(w, at(n));
    dead(w);
    for (let n = 3; n < 20 && audits(w).length === 0; n += 1) await pass(w, at(n));
    await pass(w, at(20));
    expect(audits(w), 'CONTROL: asked once').toHaveLength(1);
    expect(health(w)?.unchanged, 'CONTROL: unchanged').toBe(1);
    const late = at(3) + DELEGATION_AUDIT_HOLD_MS + 5 * 60_000;
    for (let k = 0; k < 6; k += 1) await pass(w, late + k * 60_000);
    expect(audits(w), 'asked again past the hour').toHaveLength(2);
    expect(disposition(durable, lease.leaseId)).toBe('ephemeral');
  }, ROW_MS);

  it('the one-try advisory: a throw out of the adoption step never skips PR6\'s carrier step on that pass', async () => {
    const { w, durable, lease } = await leased();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let armed = true;
    w.onList = (dir) => { if (armed && dir === w.registryDir) { armed = false; throw new Error('fixture: the adoption step throws'); } };
    expect(leaseOf(durable, lease.leaseId).generation, 'CONTROL: no carrier yet').toBe(0);
    await pass(w, at(0));
    expect(armed, 'CONTROL: the adoption step threw').toBe(false);
    expect(leaseOf(durable, lease.leaseId).generation, 'the carrier step minted the carrier on the same pass').toBe(1);
  }, ROW_MS);

  it.each([['changed: true', 'changed', { changed: true }], ['changed: unmeasured', 'unchecked', { changed: 'unmeasured' }],
    ['no lease-audit-v1', 'unchecked', null]] as const)('F9: an audit that answered %s — the feed row and the digest read %s', async (_name, word, audit) => {
    const { w, durable, lease } = await leased(audit === null ? { caps: FULL.filter((c) => c !== LEASE_AUDIT_CAP) } : {});
    if (audit !== null) w.audit = { ...w.audit, ...audit };
    touch(w, 'delegation-adopt');
    await passesUntilKept(w, durable, lease.leaseId, 0);
    expect(disposition(durable, lease.leaseId)).toBe('adopted');
    const row = w.feed.filter((f) => f.title === 'worktree kept: demo/wt-x');
    expect(row).toHaveLength(1);
    const first = mail(w)[0]!.body.split('\n')[0]!;
    expect(row[0]!.body).toContain(word === 'changed' ? 'left this worktree changed' : 'could not be checked');
    expect(first).toContain(word === 'changed' ? 'left changed' : 'could not be checked');
    expect([row[0]!.body, first].map((t) => /\bleft\b/.test(t)), 'never "left ... changed" unless it answered changed: true').toEqual([word === 'changed', word === 'changed']);
  }, ROW_MS);
});
