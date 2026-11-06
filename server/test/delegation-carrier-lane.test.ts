// Delegation broker wave 5, PR6 (Task 5.6.2): the lane's carrier step, on `delegation-watch.test.ts`'s rig (a trimmed copy of its
// world, spool and census helpers) with a RECORDING `runCcd`. A row either answers the verb itself (and may write the carrier the argv
// describes, as the box would), or runs the REAL `cmd_ws_lease_mark` on a fixture box (`makeCcdHarness`). Every home is a fixture:
// nothing reads or writes the live `~/.ccrc` or `~/.cc-sessions`.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { FleetSession } from '../../shared/api.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { FleetWatcher, DELEGATION_SWEEP_MS } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { LEASE_MARK_CAP, LEASE_MARK_LOCK_CAP } from '../src/ccdargv.js';
import type { CcdResult } from '../src/coord/ports.js';
import { DELEGATION_CHECKPOINT_FILE, DelegationDurability, decodeDelegationCheckpoint } from '../src/coord/delegation-checkpoint.js';
import { DELEGATION_JOURNAL_FILE } from '../src/coord/delegation-journal.js';
import {
  DELEGATION_EVENTS_CAP, formatDelegationInstant, type DelegationCensusRecord, type DelegationCheckpointV1, type DelegationLeaseRow,
} from '../src/coord/delegation-model.js';
import type { DelegationCensusPass } from '../src/coord/gitref.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import * as F from './leaseFixture.js';
import { emptyCarrierLaneMemory, markLeaseCarrier, planCarrierPass } from '../src/coord/delegationCarrierMark.js';
import {
  DELEGATION_CARRIER_REFUSAL_RETRY_PASSES, planCarrierSteps, type DelegationCarrierBody, type StandingMarkRefusal,
} from '../src/coord/delegation-carrier.js';
import { checkpointWithLease, leaseRow } from './delegationLeaseFixture.js';

const NOW = Date.UTC(2026, 9, 15, 10, 30, 0);
const INC = '0189abcd-1234-5678-9abc-0123456789ab';
const CLAUDE = '6350faa0-a1be-4e78-939c-57485268f6fc';
const BUCKET10 = '2026101510';
const ROW_MS = 120_000;
const at = (n: number): number => NOW + n * DELEGATION_SWEEP_MS;
const iso = (ms: number): string => formatDelegationInstant(ms);

type Answer = (argv: readonly string[]) => CcdResult | Promise<CcdResult>;
/** A FleetIO whose two measured reads are counted (review 1546 F6c): `dir <path>` and `file <path>`, under the leases directory only. */
const countingIO = (): { io: typeof localIO; reads: string[] } => {
  const reads: string[] = [];
  const io = Object.create(localIO) as typeof localIO;
  const note = (kind: string, p: string): void => { if (p.includes('/delegation/leases')) reads.push(`${kind} ${p}`); };
  io.readFileMeasured = ((...a: Parameters<typeof localIO.readFileMeasured>) => { note('file', a[0]); return localIO.readFileMeasured(...a); }) as typeof localIO.readFileMeasured;
  io.readdirMeasured = ((...a: Parameters<typeof localIO.readdirMeasured>) => { note('dir', a[0]); return localIO.readdirMeasured(...a); }) as typeof localIO.readdirMeasured;
  return { io, reads };
};
interface World {
  home: string; registryDir: string; watcher: FleetWatcher; argvs: string[][]; answer: Answer; reads: string[];
  fleet: { connected: boolean; downSince: null; ccdVerbs: string[] | null };
}
const worlds: World[] = [];
const harnesses: CcdHarness[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(worlds.splice(0).map((w) => w.watcher.closeDelegation().catch(() => undefined)));
  for (const h of harnesses.splice(0)) h.cleanup();
});

const ok = (stdout: string, code = 0): CcdResult => ({ ran: true, ok: code === 0, stdout, stderr: '', killed: false, signal: null });
const flagsOf = (argv: readonly string[]): Record<string, string> => {
  const f: Record<string, string> = {};
  for (let i = 1; i + 1 < argv.length; i += 2) f[argv[i]!.replace(/^--/, '')] = argv[i + 1]!;
  return f;
};
const marks = (w: World): Record<string, string>[] => w.argvs.filter((a) => a[0] === 'ws-lease-mark').map(flagsOf);
const written = (argv: readonly string[]): CcdResult => {
  const f = flagsOf(argv);
  return ok(`${JSON.stringify({ ok: true, answer: 'written', lease: f.lease, generation: Number(f.generation), state: f.state })}\n`);
};
/** The carrier the box would write for this argv (its identity fields as the argv names them). */
const writeCarrier = (w: World, f: Record<string, string>): void => {
  const dir = path.join(w.registryDir, 'delegation', 'leases');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${f.lease}.json`), `${JSON.stringify({
    v: 1, leaseId: f.lease, generation: Number(f.generation), state: f.state, journalSeq: Number(f['journal-seq']), parentId: f.parent,
    parentIncarnation: f['parent-incarnation'], activityId: f.activity, source: f.source, project: f.project,
    adminRecord: Buffer.from(f['admin-record-hex']!, 'hex').toString('utf8'), canonicalPath: '/fixture/tree', fingerprint: 'f'.repeat(64),
    claudeBase: null, branch: null, expiresAt: f['expires-at'] === undefined ? null : Number(f['expires-at']),
    releaseReason: f['release-reason'] ?? null, promotedRun: f['promoted-run'] === undefined ? null : Number(f['promoted-run']),
    promotedSession: f['promoted-session'] ?? null, markedAt: Date.now(),
  })}\n`);
};
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
/** The REAL verb on a fixture box; `pre` is shell run first in the same call (a stub). */
const realVerb = (h: CcdHarness, pre: () => string = () => ''): Answer => (argv) => {
  const out = F.run(h, argv.slice(1).map(q).join(' '), pre());
  return ok(`${out.lines.join('\n')}\n`, out.code);
};
/** `_plat_mv_notdir` fails on its `n`th call (the lease-mark suite's stub). */
const mvFailsOn = (n: number): string =>
  `eval "$(declare -f _plat_mv_notdir | sed '1s/^_plat_mv_notdir/__real_mv_notdir/')"; __mvn=0; `
  + `_plat_mv_notdir() { __mvn=$((__mvn + 1)); if (( __mvn == ${n} )); then return 1; fi; __real_mv_notdir "$@"; };`;

function world(opts: { home?: string; ccdVerbs?: string[] | null } = {}): World {
  const home = opts.home ?? mkTmp('ccrc-carrier-lane-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: path.join(home, 'projects') } as never);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const fleet = { connected: true, downSince: null,
    ccdVerbs: opts.ccdVerbs === undefined ? ['caps', DELEGATION_EVENTS_CAP, LEASE_MARK_CAP, LEASE_MARK_LOCK_CAP] : opts.ccdVerbs };
  const { io, reads } = countingIO();
  const made = { home, registryDir: cfg.registryDir, argvs: [] as string[][], answer: written as Answer, fleet, reads } as Omit<World, 'watcher'> as World;
  const runCcd = async (argv: readonly string[]): Promise<CcdResult> => { made.argvs.push([...argv]); return made.answer(argv); };
  const deps = { ...testDeps(home), monotonicMs: () => Date.now(), cfg, io, coord, fleetState: fleet, runCcd };
  made.watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  worlds.push(made);
  return made;
}

// ── the spool and the census (delegation-watch.test.ts's, trimmed) ─────────────────────────────────────────────────────────
const lineOf = (obj: unknown): string => `${JSON.stringify(obj)}\n`;
const common = (owner: string, extra: Record<string, unknown>, atIso: string) =>
  ({ v: 1, observedAt: atIso, sessionId: owner, parentIncarnation: INC, claudeSessionId: CLAUDE, ...extra });
const bash = (kind: 'PreToolUse' | 'PostToolUse', listing: string[], atIso: string): string =>
  lineOf(common('demo-a', { eventKind: kind, toolName: 'Bash', toolUseId: 'toolu_wt1', listing, cwd: '/w/demo', ...(kind === 'PostToolUse' ? { outcome: 'completed' } : {}) }, atIso));
const record = (adminRecord: string, over: Partial<DelegationCensusRecord> = {}): DelegationCensusRecord => ({
  project: 'demo', adminRecord, canonicalPath: `/w/demo/.claude/worktrees/${adminRecord}`, headBranch: null, headSha: 'a'.repeat(40),
  claudeBase: 'b'.repeat(40), locked: false, baseAgreesFirstLog: true, state: 'present', diagnostic: null, ...over,
});
const RAW = record('raw-tree');
const OLD = record('old-tree');
const sessionOf = (id: string) => ({ id, project: 'demo', status: 'idle' as const, stoppedBy: null as FleetSession['stoppedBy'], archivedAt: null as FleetSession['archivedAt'] });
const setCensus = (w: World, recs: DelegationCensusRecord[], measuredAt: number): void => {
  const pass: DelegationCensusPass = {
    measuredAt, projects: new Map([['demo', { read: { ok: true, records: [] }, delegation: recs }]]),
    incarnations: new Map([['demo-a', { kind: 'measured', incarnation: INC }]]),
  };
  (w.watcher as unknown as { delegationCensus: DelegationCensusPass | null }).delegationCensus = pass;
};
const censusPass = async (w: World, ms: number, recs: DelegationCensusRecord[] = [OLD, RAW]): Promise<void> => {
  vi.spyOn(Date, 'now').mockReturnValue(ms);
  setCensus(w, recs, ms);
  const s = [sessionOf('demo-a')];
  await w.watcher.sweepDelegation(s as never, s.map((x) => ({ id: x.id, project: x.project, child: { kind: 'none' } })) as never);
};
/** The rung-4 world of `delegation-watch.test.ts`: a session ran a raw `git worktree add`, and the lane was ready before it. */
async function rawTreeWorld(opts: { home?: string; ccdVerbs?: string[] | null } = {}): Promise<World> {
  const w = world(opts);
  const dir = path.join(w.registryDir, 'delegation', 'spool', 'demo-a');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${BUCKET10}.spool`), [
    lineOf(common('demo-a', { eventKind: 'SessionStart', source: 'startup' }, '2026-10-15T10:01:00.000Z')),
    bash('PreToolUse', ['old-tree'], '2026-10-15T10:05:00.000Z'), bash('PostToolUse', ['old-tree', 'raw-tree'], '2026-10-15T10:05:03.000Z'),
  ].join(''));
  const primedAt = Date.UTC(2026, 9, 15, 10, 0, 30);
  vi.spyOn(Date, 'now').mockReturnValue(primedAt);
  setCensus(w, [], primedAt);
  await w.watcher.sweepDelegation([], []);
  return w;
}
const leasesOf = (w: World): DelegationLeaseRow[] => {
  const cp = path.join(w.home, '.ccrc', DELEGATION_CHECKPOINT_FILE);
  return existsSync(cp) ? [...decodeDelegationCheckpoint(new Uint8Array(readFileSync(cp))).leases] : [];
};
const journal = (w: World): string => readFileSync(path.join(w.home, '.ccrc', DELEGATION_JOURNAL_FILE), 'utf8');
const laneOf = (w: World): Record<string, unknown> => (w.watcher as unknown as { delegationLane(): Record<string, unknown> }).delegationLane();
/** Aborts the lane's running pass, as its budget would, and answers the work promises to await (review 1546 F6b). */
const cutPass = (w: World): Promise<unknown>[] => {
  const running = laneOf(w)['running'] as Map<AbortController, Promise<unknown>>;
  const works = [...running.values()];
  for (const ac of running.keys()) ac.abort();
  return works;
};
const memoryOf = (w: World): { pass: number; refused: Map<string, StandingMarkRefusal> } =>
  laneOf(w)['carrierMemory'] as { pass: number; refused: Map<string, StandingMarkRefusal> };
/** A further lease on `adminRecord`, created through the applier as the lane would (the K13b rows). */
const maker = (w: World, first: DelegationLeaseRow) => async (adminRecord: string, n: number): Promise<string> => {
  const applier = (await w.watcher.delegationApplier())!;
  const out = await applier.createLease({ activityId: first.activityId, parentId: 'demo-a', parentIncarnation: INC, project: 'demo', adminRecord,
    canonicalPath: `/w/demo/.claude/worktrees/${adminRecord}`, creationBase: null, sourceKind: 'raw', correlationJournalIds: [], firstObservedAt: iso(at(2) + n) });
  expect(out.kind).toBe('created');
  return (out as { leaseId: string }).leaseId;
};
const recordOf = (argv: readonly string[]): string => Buffer.from(flagsOf(argv)['admin-record-hex']!, 'hex').toString();
const refuse = (word: string): CcdResult => ok(`${JSON.stringify({ ok: false, refusal: word, detail: `a fixture ${word}` })}\n`, 1);
/** The carrier body the box would hold for `lease` at its own generation, state and sequence. */
const bodyFor = (lease: DelegationLeaseRow, over: Partial<DelegationCarrierBody> = {}): DelegationCarrierBody => ({
  v: 1, leaseId: lease.leaseId, generation: lease.generation, state: lease.releasedAt !== null ? 'released' : lease.disposition,
  journalSeq: lease.currentJournalSequence, parentId: lease.parentId, parentIncarnation: lease.parentIncarnation, activityId: lease.activityId,
  source: lease.sourceKind, project: lease.project, adminRecord: lease.adminRecord, canonicalPath: lease.canonicalPath, fingerprint: 'f'.repeat(64),
  claudeBase: null, branch: null, expiresAt: null, releaseReason: null, promotedRun: null, promotedSession: null, markedAt: NOW, ...over,
});
/** Three census passes: the raw tree is linked and leased (generation 0) at the third, and its carrier is minted in the same pass. */
async function linked(w: World, recs: DelegationCensusRecord[] = [OLD, RAW]): Promise<DelegationLeaseRow> {
  for (const n of [0, 1, 2]) await censusPass(w, at(n), recs);
  const ls = leasesOf(w);
  expect(ls).toHaveLength(1);
  return ls[0]!;
}

describe('PR6: the lane marks carriers, reads them back, and counts what it cannot', () => {
  it('W5-K11: a linked lease is minted, then marked at generation 1, then seen once its carrier reads back', async () => {
    const w = await rawTreeWorld();
    const lease = await linked(w);
    expect(lease).toMatchObject({ generation: 1, carrierGenerationSeen: null });
    expect(journal(w)).toContain('"reason":"carrier"');
    expect(marks(w), 'the mint is journal only').toEqual([]);
    await censusPass(w, at(3));
    expect(marks(w)).toEqual([expect.objectContaining({ lease: lease.leaseId, generation: '1', state: 'ephemeral', source: 'raw',
      'journal-seq': String(lease.currentJournalSequence), parent: 'demo-a', 'parent-incarnation': INC, project: 'demo' })]);
    expect(leasesOf(w)[0]!.carrierGenerationSeen, 'nothing read back yet').toBeNull();
    writeCarrier(w, marks(w)[0]!);
    await censusPass(w, at(4));
    expect(leasesOf(w)[0]).toMatchObject({ generation: 1, carrierGenerationSeen: 1, currentJournalSequence: lease.currentJournalSequence });
    expect(marks(w), 'a carrier read back equal is seen, never marked again').toHaveLength(1);
    expect(w.watcher.currentDelegationHealth()?.carriers).toMatchObject({ marked: 1, pending: 0, unsupported: 0, mismatched: 0 });
  }, ROW_MS);

  it('W5-K11b: a verb that answers written but wrote nothing moves nothing, and the planner marks again', async () => {
    const w = await rawTreeWorld();
    await linked(w);
    await censusPass(w, at(3));
    await censusPass(w, at(4));
    expect(marks(w).map((f) => f.generation)).toEqual(['1', '1']);
    expect(leasesOf(w)[0]!.carrierGenerationSeen).toBeNull();
    expect(journal(w)).not.toContain('"kind":"lease-carrier-seen"');
  }, ROW_MS);

  it('W5-K12: without lease-mark-v1, or with no capability evidence at all, nothing is minted or composed and the health counts unsupported', async () => {
    const w = await rawTreeWorld({ ccdVerbs: ['caps', DELEGATION_EVENTS_CAP] });
    await linked(w);
    await censusPass(w, at(3));
    expect(w.argvs.filter((a) => a[0] === 'ws-lease-mark')).toEqual([]);
    expect(leasesOf(w)[0]!.generation, 'no mint either').toBe(0);
    expect(w.watcher.currentDelegationHealth()?.carriers).toMatchObject({ unsupported: 1, marked: 0, pending: 0 });
    w.fleet.ccdVerbs = null;                                          // no evidence at all: refused, never assumed
    await censusPass(w, at(4));
    expect(w.argvs.filter((a) => a[0] === 'ws-lease-mark')).toEqual([]);
    expect(leasesOf(w)[0]!.generation).toBe(0);
  }, ROW_MS);

  it('W5-K13: a standing refusal leaves the journal alone, logs once, and is composed again only when its tree changes; busy is retried', async () => {
    const w = await rawTreeWorld();
    const LOCKED = record('raw-tree', { locked: true });
    const lease = await linked(w, [OLD, LOCKED]);
    w.answer = () => ok(`${JSON.stringify({ ok: false, refusal: 'locked', detail: 'the tree is locked in git' })}\n`, 1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const before = journal(w);
    await censusPass(w, at(3), [OLD, LOCKED]);
    expect(marks(w)).toHaveLength(1);
    expect(journal(w), 'a refusal changes no journal').toBe(before);
    const line = `ccrc-server: delegation: carrier ${lease.leaseId} generation 1 refused locked`;
    expect(warn.mock.calls.filter((c) => String(c[0]).startsWith(line))).toHaveLength(1);
    await censusPass(w, at(4), [OLD, LOCKED]);
    expect(marks(w), 'a standing refusal is not composed again').toHaveLength(1);
    expect(w.watcher.currentDelegationHealth()?.carriers).toMatchObject({ refused: 1 });
    w.answer = () => ok(`${JSON.stringify({ ok: false, refusal: 'busy', detail: 'another mark holds the lock' })}\n`, 1);
    await censusPass(w, at(5), [OLD, RAW]);                           // the lock removed: the census row changes
    expect(marks(w), 'composed once the tree changed').toHaveLength(2);
    await censusPass(w, at(6), [OLD, RAW]);
    expect(marks(w), 'busy is retried on the very next pass').toHaveLength(3);
    expect(warn.mock.calls.filter((c) => String(c[0]).startsWith(line)), 'still one line for generation 1').toHaveLength(1);
  }, ROW_MS);

  it('W5-K13b: nine locked leases and nine released leases with no carrier never hold a new lease out of its carrier', async () => {
    const LOCKED = (i: number): DelegationCensusRecord => record(`locked-${i}`, { locked: true });
    const RELEASED = (i: number): string => `gone-${i}`;
    const recs = [OLD, RAW, ...Array.from({ length: 9 }, (_, i) => LOCKED(i))];
    const w = await rawTreeWorld();
    w.answer = (argv) => {                                            // locked trees refuse; `raw-tree`'s carrier is written as the box would
      const rec = Buffer.from(flagsOf(argv)['admin-record-hex']!, 'hex').toString();
      if (rec.startsWith('locked-')) return ok(`${JSON.stringify({ ok: false, refusal: 'locked', detail: 'locked' })}\n`, 1);
      if (rec === 'raw-tree') writeCarrier(w, flagsOf(argv));
      return written(argv);
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = await linked(w, recs);
    const applier = (await w.watcher.delegationApplier())!;
    const make = maker(w, first);
    const locked: string[] = [];
    for (let i = 0; i < 9; i++) locked.push(await make(`locked-${i}`, i));
    for (let i = 0; i < 9; i++) {
      const id = await make(RELEASED(i), 20 + i);
      expect((await applier.releaseLease({ leaseId: id, expectGeneration: 0, releaseReason: 'native-removed', at: iso(at(3)), lastHeadSha: null, resolvesThrough: null })).kind).toBe('applied');
    }
    // the nine locked leases are minted and each refused once (the first `raw-tree` mark rides along)
    for (let n = 3; n < 8; n++) await censusPass(w, at(n), recs);
    const named = (f: Record<string, string>): string => f.lease!;
    expect(new Set(marks(w).map(named).filter((id) => locked.includes(id)))).toEqual(new Set(locked));
    const seenBefore = marks(w).length;
    const fresh = await make('fresh-tree', 40);
    const all = [...recs, record('fresh-tree')];
    await censusPass(w, at(8), all);
    expect(leasesOf(w).find((l) => l.leaseId === fresh)!.generation, 'minted in the first pass').toBe(1);
    await censusPass(w, at(9), all);
    const late = marks(w).slice(seenBefore);
    expect(late.map(named), 'marked in the second, and no argv names any of the eighteen').toEqual([fresh]);
    writeCarrier(w, late[0]!);
    await censusPass(w, at(10), all);
    expect(leasesOf(w).find((l) => l.leaseId === fresh)!.carrierGenerationSeen, 'seen in the third').toBe(1);
    expect(marks(w).slice(seenBefore).map(named)).toEqual([fresh]);
    expect(w.watcher.currentDelegationHealth()?.carriers).toMatchObject({ refused: 9, pending: 0 });
  }, ROW_MS);
});

describe('PR6 fix round 1 (review 1546): the lane re-reads, bounds and orders', () => {
  it('W5-K4: the seen applied through PR5b\'s door moves neither the generation nor the sequence, so the next plan counts it marked', async () => {
    const w = await rawTreeWorld();
    const lease = await linked(w);
    const applier = (await w.watcher.delegationApplier())!;
    const rb = new Map([[lease.leaseId, { kind: 'carrier' as const, body: bodyFor(lease) }]]);
    const planOf = () => planCarrierSteps({ checkpoint: applier.state().checkpoint as DelegationCheckpointV1, readBack: rb, supported: true,
      lockSupported: true, nowMs: NOW, pass: 1, refused: new Map(), censusRow: new Map(), indexed: new Set(), deferred: new Map() });
    expect(planOf().steps).toEqual([{ kind: 'seen', leaseId: lease.leaseId, generation: 1 }]);
    expect((await applier.noteCarrierSeen({ leaseId: lease.leaseId, generation: 1, at: iso(at(3)) })).kind).toBe('applied');
    const second = planOf();
    expect(second.steps).toEqual([]);
    expect(second.health).toMatchObject({ marked: 1, mismatched: 0 });
  }, ROW_MS);

  it('D-8034 (F1): an up-to-date carrier changed out of band counts mismatched, and one removed is marked again', async () => {
    const w = await rawTreeWorld();
    const lease = await linked(w);
    await censusPass(w, at(3));
    const f = marks(w)[0]!;
    writeCarrier(w, f);
    await censusPass(w, at(4));
    expect(leasesOf(w)[0]!.carrierGenerationSeen).toBe(1);
    for (const [n, over] of [[5, { generation: '2' }], [6, { 'journal-seq': '999' }]] as const) {
      writeCarrier(w, { ...f, ...over });
      await censusPass(w, at(n));
      expect(w.watcher.currentDelegationHealth()?.carriers, `pass ${n}`).toMatchObject({ mismatched: 1, marked: 0 });
      expect(marks(w), 'a mismatched carrier is never overwritten').toHaveLength(1);
    }
    rmSync(path.join(w.registryDir, 'delegation', 'leases', `${lease.leaseId}.json`));
    await censusPass(w, at(7));
    expect(marks(w).slice(1)).toEqual([expect.objectContaining({ lease: lease.leaseId, generation: '1', state: 'ephemeral' })]);
  }, ROW_MS);

  it('F5: a verb that answers written while the carrier it left is ahead journals no seen, and the next pass counts it mismatched', async () => {
    const w = await rawTreeWorld();
    w.answer = (argv) => { writeCarrier(w, { ...flagsOf(argv), generation: String(Number(flagsOf(argv).generation) + 1) }); return written(argv); };
    await linked(w);
    await censusPass(w, at(3));
    expect(marks(w)).toHaveLength(1);
    expect(journal(w)).not.toContain('"kind":"lease-carrier-seen"');
    expect(leasesOf(w)[0]!.carrierGenerationSeen).toBeNull();
    await censusPass(w, at(4));
    expect(marks(w)).toHaveLength(1);
    expect(w.watcher.currentDelegationHealth()?.carriers).toMatchObject({ mismatched: 1 });
  }, ROW_MS);

  it('D-8039 (F3): a nested or tree-held refusal the census row cannot see is composed again after thirty passes', async () => {
    for (const word of ['nested', 'tree-held']) {
      const w = await rawTreeWorld();
      let refusing = true;                                            // a containing workdir, or another lease's carrier, holds the tree
      w.answer = (argv) => { if (refusing) return refuse(word); writeCarrier(w, flagsOf(argv)); return written(argv); };
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const lease = await linked(w);
      await censusPass(w, at(3));
      await censusPass(w, at(4));
      expect(marks(w), `${word}: standing`).toHaveLength(1);
      refusing = false;                                               // the cause is gone, and nothing in the census row says so
      const memory = memoryOf(w);
      const recorded = memory.refused.get(lease.leaseId)!.pass;
      memory.pass = recorded + DELEGATION_CARRIER_REFUSAL_RETRY_PASSES - 2;
      await censusPass(w, at(5));
      expect(marks(w), `${word}: still standing at pass 29`).toHaveLength(1);
      await censusPass(w, at(6));
      expect(marks(w), `${word}: composed again at pass 30`).toHaveLength(2);
      await censusPass(w, at(7));
      expect(leasesOf(w)[0]!.carrierGenerationSeen, word).toBe(1);
    }
  }, 2 * ROW_MS);

  it('D-8039 (F4): nine leases that answer unmeasured every pass never hold a new lease out of its carrier', async () => {
    const recs = [OLD, RAW, ...Array.from({ length: 9 }, (_, i) => record(`unm-${i}`))];
    const w = await rawTreeWorld();
    w.answer = (argv) => { if (recordOf(argv).startsWith('unm-')) return refuse('unmeasured'); writeCarrier(w, flagsOf(argv)); return written(argv); };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const make = maker(w, await linked(w, recs));
    const unm: string[] = [];
    for (let i = 0; i < 9; i++) unm.push(await make(`unm-${i}`, i));
    for (let n = 3; n < 7; n++) await censusPass(w, at(n), recs);
    expect(new Set(marks(w).map((f) => f.lease!).filter((id) => unm.includes(id))), 'each of the nine was composed and answered unmeasured').toEqual(new Set(unm));
    const before = marks(w).length;
    const fresh = await make('fresh-tree', 40);
    const all = [...recs, record('fresh-tree')];
    await censusPass(w, at(7), all);
    expect(leasesOf(w).find((l) => l.leaseId === fresh)!.generation, 'minted in the first pass').toBe(1);
    await censusPass(w, at(8), all);
    expect(marks(w).slice(before).map((f) => f.lease), 'marked in the second').toContain(fresh);
    await censusPass(w, at(9), all);
    expect(leasesOf(w).find((l) => l.leaseId === fresh)!.carrierGenerationSeen, 'seen in the third').toBe(1);
  }, ROW_MS);

  it('F10: a mark that did not run keeps its lease measured against the by-tree entries, so an entry written late is healed', async () => {
    const w = await rawTreeWorld();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    w.answer = () => ({ ran: false, ok: false, stdout: '', stderr: '', killed: true, signal: 'SIGTERM', reason: 'timeout', detail: 'a fixture timeout' });
    const lease = await linked(w);
    await censusPass(w, at(3));
    expect(marks(w)).toHaveLength(1);
    const applier = (await w.watcher.delegationApplier())!;
    expect((await applier.releaseLease({ leaseId: lease.leaseId, expectGeneration: 1, releaseReason: 'foreign', at: iso(at(3)), lastHeadSha: null,
      resolvesThrough: null })).kind).toBe('applied');
    w.answer = written;
    const mine = (): Record<string, string>[] => marks(w).filter((f) => f.lease === lease.leaseId);   // the tree, still listed, is leased anew
    await censusPass(w, at(4));
    expect(mine(), 'no entry names it yet: no heal').toHaveLength(1);
    const byTree = path.join(w.registryDir, 'delegation', 'leases', 'by-tree');
    mkdirSync(byTree, { recursive: true });
    writeFileSync(path.join(byTree, 'e'.repeat(64)), `${lease.leaseId}\n`);   // the verb that timed out wrote its entry late
    await censusPass(w, at(5));
    expect(mine().slice(1)).toEqual([expect.objectContaining({ lease: lease.leaseId, state: 'released', 'release-reason': 'foreign' })]);
  }, ROW_MS);

  it('F6b: a pass aborted between two carrier marks composes nothing more', async () => {
    const w = await rawTreeWorld();
    const make = maker(w, await linked(w));
    await make('second-tree', 1);
    const recs = [OLD, RAW, record('second-tree')];
    await censusPass(w, at(3), recs);                                  // the second is minted; the first is marked, and stays behind
    let works: Promise<unknown>[] = [];
    let cut = true;
    w.answer = (argv) => { if (cut) { cut = false; works = cutPass(w); } return written(argv); };
    const before = marks(w).length;
    await censusPass(w, at(4), recs);
    await Promise.allSettled(works);
    expect(marks(w).length - before, 'one mark, then the cut').toBe(1);
  }, ROW_MS);

  it('F6b: a pass aborted between two native-removed releases releases nothing more', async () => {
    const w = await rawTreeWorld();
    const make = maker(w, await linked(w));
    await make('second-tree', 1);
    await censusPass(w, at(3), [OLD, RAW, record('second-tree')]);
    await censusPass(w, at(4), [OLD]);                                 // both trees gone from one listing
    const orig = DelegationDurability.prototype.releaseLease;
    let works: Promise<unknown>[] = [];
    const release = vi.spyOn(DelegationDurability.prototype, 'releaseLease').mockImplementation(async function (this: DelegationDurability, req) {
      if (release.mock.calls.length === 1) works = cutPass(w);
      return orig.call(this, req);
    });
    await censusPass(w, at(5), [OLD]);
    await Promise.allSettled(works);
    expect(release, 'one release, then the cut').toHaveBeenCalledTimes(1);
    expect(leasesOf(w).filter((l) => l.releasedAt !== null)).toHaveLength(1);
  }, ROW_MS);
  it('D-8034 (review 1547 F2): a lease whose mark did not run stops costing the by-tree read thirty passes after it', async () => {
    const w = await rawTreeWorld();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    w.answer = () => ({ ran: false, ok: false, stdout: '', stderr: '', killed: true, signal: 'SIGTERM', reason: 'timeout', detail: 'a fixture timeout' });
    const lease = await linked(w);
    await censusPass(w, at(3));
    const applier = (await w.watcher.delegationApplier())!;
    expect((await applier.releaseLease({ leaseId: lease.leaseId, expectGeneration: 1, releaseReason: 'foreign', at: iso(at(3)), lastHeadSha: null,
      resolvesThrough: null })).kind).toBe('applied');
    w.answer = written;
    const byTreeReads = (): number => w.reads.splice(0).filter((r) => r.startsWith('dir ') && r.endsWith('/delegation/leases/by-tree')).length;
    byTreeReads();
    await censusPass(w, at(4));
    expect(byTreeReads(), 'inside the bound: measured every pass').toBe(1);
    await censusPass(w, at(5));
    expect(byTreeReads()).toBe(1);
    const memory = laneOf(w)['carrierMemory'] as { pass: number; notRan: Map<string, number> };
    // review 1549 F3: the bound's lower edge, the last pass inside it: still measured, and still held out of `notIndexed`
    memory.pass = memory.notRan.get(lease.leaseId)! + DELEGATION_CARRIER_REFUSAL_RETRY_PASSES - 2;
    await censusPass(w, at(6));
    expect(byTreeReads(), 'one pass inside the bound: measured').toBe(1);
    expect(memory.notRan.has(lease.leaseId), 'one pass inside the bound: still a mark that did not run').toBe(true);
    await censusPass(w, at(7));
    expect(byTreeReads(), 'at the bound: measured once more, and then not indexed').toBe(1);
    await censusPass(w, at(8));
    expect(byTreeReads(), 'past the bound: no by-tree read').toBe(0);
  }, ROW_MS);

  it('D-8039 (review 1547 F3): a lease that answered unmeasured once is composed again within two passes, ahead of eight that always do', async () => {
    const recs = [OLD, RAW, ...Array.from({ length: 8 }, (_, i) => record(`unm-${i}`)), record('blip-tree')];
    const w = await rawTreeWorld();
    let blip = true;
    w.answer = (argv) => {
      const rec = recordOf(argv);
      if (rec.startsWith('unm-')) return refuse('unmeasured');
      if (rec === 'blip-tree' && blip) { blip = false; return refuse('unmeasured'); }   // transient
      writeCarrier(w, flagsOf(argv));
      return written(argv);
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const make = maker(w, await linked(w, recs));
    for (let i = 0; i < 8; i++) await make(`unm-${i}`, i);
    for (let n = 3; n < 7; n++) await censusPass(w, at(n), recs);
    const late = await make('blip-tree', 40);
    const tries = (): number => marks(w).filter((f) => f.lease === late).length;
    await censusPass(w, at(7), recs);                                  // minted
    await censusPass(w, at(8), recs);
    expect(tries(), 'composed once, and answered unmeasured').toBe(1);
    await censusPass(w, at(9), recs);
    await censusPass(w, at(10), recs);
    expect(tries(), 'composed again within two passes').toBe(2);
    await censusPass(w, at(11), recs);
    expect(leasesOf(w).find((l) => l.leaseId === late)!.carrierGenerationSeen).toBe(1);
  }, ROW_MS);

  it('F9 (review 1547 F4a): a lease moved between the pass\'s plan and its step composes nothing that pass, and is marked at the next', async () => {
    const w = await rawTreeWorld();
    const first = await linked(w);
    const second = await maker(w, first)('second-tree', 1);
    const recs = [OLD, RAW, record('second-tree')];
    await censusPass(w, at(3), recs);                                  // the first is marked (no carrier written), the second minted
    const applier = (await w.watcher.delegationApplier())!;
    const keep = { at: iso(at(3)), expiresAt: iso(at(3) + 7 * 86_400_000), terminalEvidenceAt: null, runId: null, promotedSession: null,
      auditEvidence: null, carrierRequired: false, resolvesThrough: null };
    let moved = false;
    w.answer = async (argv) => {
      if (!moved && flagsOf(argv).lease === first.leaseId) {             // the second moves while the first's mark runs
        moved = true;
        expect((await applier.transitionLease({ leaseId: second, expectGeneration: 1, reason: 'retain', ...keep })).kind).toBe('applied');
      }
      return written(argv);
    };
    const before = marks(w).length;
    await censusPass(w, at(4), recs);
    expect(moved).toBe(true);
    expect(marks(w).slice(before).map((f) => f.lease), 'the moved lease composes nothing this pass').toEqual([first.leaseId]);
    await censusPass(w, at(5), recs);
    expect(marks(w).slice(before).filter((f) => f.lease === second)).toEqual([expect.objectContaining({ generation: '2', state: 'retained' })]);
  }, ROW_MS);
});

describe('PR6 fix round 1 (review 1546 F6c): the reads one carrier pass makes', () => {
  const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  it('one listing, every carrier behind that is listed, eight up-to-date ones least recently read first, an unowned released one once, the by-tree entries once', async () => {
    const home = mkTmp('ccrc-carrier-reads-');
    const registryDir = path.join(home, '.cc-sessions');
    const dir = path.join(registryDir, 'delegation', 'leases');
    mkdirSync(dir, { recursive: true });
    const row = (n: number, over: Partial<DelegationLeaseRow>): DelegationLeaseRow => leaseRow({ leaseId: id(n), adminRecord: `wt-${n}`,
      canonicalPath: `/work/project-a/.claude/worktrees/wt-${n}`, creatingJournalSequence: 10 + n, currentJournalSequence: 10 + n, generation: 1, ...over });
    const up = Array.from({ length: 10 }, (_, n) => row(n, { carrierGenerationSeen: 1 }));
    for (const l of up) writeFileSync(path.join(dir, `${l.leaseId}.json`), JSON.stringify(bodyFor(l)));
    const behind = row(20, {});                                        // not listed: absent, with no read
    const gone = row(21, { releasedAt: '2026-11-10T00:00:00.000Z' });  // released with no carrier: the by-tree entries are read once
    writeFileSync(path.join(dir, `${id(40)}.json`), JSON.stringify(bodyFor(row(40, { releasedAt: '2026-11-10T00:00:00.000Z' }), { releaseReason: 'foreign' })));
    const cp: DelegationCheckpointV1 = { ...checkpointWithLease(), leases: [...up, behind, gone], lineage: [] };
    const { io, reads } = countingIO();
    const memory = emptyCarrierLaneMemory();
    const pass = () => planCarrierPass({ io, registryDir }, cp, memory, { fleetState: { ccdVerbs: [LEASE_MARK_CAP, LEASE_MARK_LOCK_CAP] }, nowMs: NOW,
      census: [], workdirs: [] });
    const file = (n: number): string => `file ${dir}/${id(n)}.json`;
    const first = await pass();
    expect(reads.splice(0)).toEqual([`dir ${dir}`, ...[0, 1, 2, 3, 4, 5, 6, 7].map(file), file(40), `dir ${dir}/by-tree`]);
    expect(first.steps).toMatchObject([{ kind: 'mark', args: { leaseId: id(20) } }]);
    expect(memory.health).toMatchObject({ marked: 10, unowned: 0, mismatched: 0 });
    await pass();
    expect(reads.splice(0), 'the two left over first, then the least recently read; no unowned, no by-tree').toEqual([`dir ${dir}`, ...[8, 9, 0, 1, 2, 3, 4, 5].map(file)]);
  });
  it('review 1547 F4b: an unowned carrier whose body names another lease reads malformed, counts unmeasured, and is read again', async () => {
    const home = mkTmp('ccrc-carrier-reads-');
    const registryDir = path.join(home, '.cc-sessions');
    const dir = path.join(registryDir, 'delegation', 'leases');
    mkdirSync(dir, { recursive: true });
    const other = leaseRow({ leaseId: id(42), releasedAt: '2026-11-10T00:00:00.000Z', generation: 1 });
    writeFileSync(path.join(dir, `${id(41)}.json`), JSON.stringify(bodyFor(other, { releaseReason: 'foreign' })));
    const cp: DelegationCheckpointV1 = { ...checkpointWithLease(), leases: [], lineage: [] };
    const { io, reads } = countingIO();
    const memory = emptyCarrierLaneMemory();
    const pass = () => planCarrierPass({ io, registryDir }, cp, memory, { fleetState: { ccdVerbs: [LEASE_MARK_CAP, LEASE_MARK_LOCK_CAP] }, nowMs: NOW,
      census: [], workdirs: [] });
    for (const n of [1, 2]) {
      await pass();
      expect(reads.splice(0), `pass ${n}`).toEqual([`dir ${dir}`, `file ${dir}/${id(41)}.json`]);
      expect(memory.health, `pass ${n}`).toMatchObject({ unmeasured: 1, unowned: 0 });
    }
    expect(memory.releasedUnowned.size, 'never remembered as released').toBe(0);
  });
});

describe('PR6: markLeaseCarrier asks the capability itself', () => {
  it('W5-K12b: with no carrier-mark capability, or no evidence at all, the composer composes and runs nothing', async () => {
    const cp = checkpointWithLease({ generation: 1, parentIncarnation: INC });
    const lease = cp.leases[0]!;
    const argvs: string[][] = [];
    const deps = (ccdVerbs: string[] | null) => ({
      io: { readFileMeasured: async () => ({ ok: false as const, reason: 'absent' as const }), readdirMeasured: async () => ({ ok: false as const, reason: 'absent' as const }) },
      registryDir: '/nowhere', runCcd: async (argv: readonly string[]): Promise<CcdResult> => { argvs.push([...argv]); return written(argv); },
      fleetState: { ccdVerbs }, durable: { noteCarrierSeen: async () => { throw new Error('never asked'); } }, nowMs: () => NOW,
    });
    for (const verbs of [['caps', DELEGATION_EVENTS_CAP], null]) {
      expect(await markLeaseCarrier(deps(verbs) as never, lease, cp)).toMatchObject({ kind: 'refused', word: 'unmeasured' });
    }
    expect(argvs, 'nothing composed on no evidence').toEqual([]);
    expect(await markLeaseCarrier(deps(['caps', LEASE_MARK_CAP]) as never, lease, cp)).toMatchObject({ kind: 'marked', seen: false });
    expect(argvs.map((a) => a[0]), 'the capability present: one mark').toEqual(['ws-lease-mark']);
  });

  /** The composer's deps over a fixture read: `carrier` is the file the read-back finds (absent when undefined). */
  const composer = (o: { verbs: string[] | null; carrier?: string; seen?: unknown[]; seenThrows?: boolean }) => {
    const argvs: string[][] = [];
    const d = {
      io: { readFileMeasured: async () => (o.carrier === undefined ? { ok: false as const, reason: 'absent' as const } : { ok: true as const, content: o.carrier }),
        readdirMeasured: async () => ({ ok: false as const, reason: 'absent' as const }) },
      registryDir: '/nowhere', runCcd: async (argv: readonly string[]): Promise<CcdResult> => { argvs.push([...argv]); return written(argv); },
      fleetState: { ccdVerbs: o.verbs }, nowMs: () => NOW,
      durable: { noteCarrierSeen: async (req: unknown) => { if (o.seenThrows === true) throw new Error('a fixture throw'); o.seen?.push(req); return { kind: 'applied' }; } },
    };
    return { d: d as never, argvs };
  };
  const BOTH = ['caps', LEASE_MARK_CAP, LEASE_MARK_LOCK_CAP];

  it('D-8037 (F2): without lease-mark-lock-v1 a held-state lease composes nothing and counts unsupported, an ephemeral one is marked; with it both are', async () => {
    const held = leaseRow({ leaseId: '00000000-0000-4000-8000-000000000001', generation: 2, carrierGenerationSeen: 1, disposition: 'retained',
      cleanupDueAt: '2026-11-17T12:00:00.000Z', parentIncarnation: INC, adminRecord: 'wt-h', creatingJournalSequence: 5, currentJournalSequence: 7 });
    const eph = leaseRow({ leaseId: '00000000-0000-4000-8000-000000000002', generation: 1, parentIncarnation: INC, adminRecord: 'wt-e',
      creatingJournalSequence: 6, currentJournalSequence: 6 });
    const cp: DelegationCheckpointV1 = { ...checkpointWithLease(), leases: [held, eph], lineage: [] };
    for (const [verbs, want] of [[['caps', LEASE_MARK_CAP], [eph.leaseId]], [BOTH, [held.leaseId, eph.leaseId]]] as const) {
      const memory = emptyCarrierLaneMemory();
      const { d, argvs } = composer({ verbs: [...verbs] });
      const plan = await planCarrierPass(d, cp, memory, { fleetState: { ccdVerbs: [...verbs] }, nowMs: NOW, census: [], workdirs: [] });
      expect(plan.steps.map((s) => (s.kind === 'mark' ? s.args.leaseId : '')), verbs.join(' ')).toEqual(want);
      expect(memory.health?.unsupported, verbs.join(' ')).toBe(want.length === 1 ? 1 : 0);
      const outs = [await markLeaseCarrier(d, held, cp), await markLeaseCarrier(d, eph, cp)];
      expect(outs.map((o) => o.kind), verbs.join(' ')).toEqual(want.length === 1 ? ['unsupported', 'marked'] : ['marked', 'marked']);
      expect(argvs.map((a) => flagsOf(a).lease), 'only what was marked was composed').toEqual(want);
    }
  });

  it('F5: a verb that answers written while the carrier reads back behind, ahead, foreign or naming another lease journals no seen', async () => {
    const cp = checkpointWithLease({ generation: 2, carrierGenerationSeen: 1, parentIncarnation: INC, currentJournalSequence: 9 });
    const lease = cp.leases[0]!;
    const seen: unknown[] = [];
    for (const body of [bodyFor(lease, { generation: 1 }), bodyFor(lease, { generation: 3 }), bodyFor(lease, { parentId: 'lane-b-demo' }),
      bodyFor(lease, { journalSeq: 8 }), bodyFor(lease, { leaseId: '99999999-0000-4000-8000-000000000009' })]) {
      const { d } = composer({ verbs: BOTH, carrier: JSON.stringify(body), seen });
      expect(await markLeaseCarrier(d, lease, cp)).toEqual({ kind: 'marked', answer: 'written', seen: false });
    }
    expect(seen, 'no read-back but an equal one is seen').toEqual([]);
    const { d } = composer({ verbs: BOTH, carrier: JSON.stringify(bodyFor(lease)), seen });
    expect(await markLeaseCarrier(d, lease, cp)).toEqual({ kind: 'marked', answer: 'written', seen: true });
    expect(seen).toEqual([expect.objectContaining({ leaseId: lease.leaseId, generation: 2 })]);
  });

  it('F9: a lease that moved between the plan and the step composes nothing; the planned generation and state compose as planned', async () => {
    const cp = checkpointWithLease({ generation: 2, parentIncarnation: INC });
    const lease = cp.leases[0]!;
    const { d, argvs } = composer({ verbs: BOTH });
    expect(await markLeaseCarrier(d, lease, cp, { generation: 1, state: 'ephemeral' })).toEqual({ kind: 'moved' });
    expect(await markLeaseCarrier(d, lease, cp, { generation: 2, state: 'adopted' })).toEqual({ kind: 'moved' });
    expect(argvs).toEqual([]);
    expect(await markLeaseCarrier(d, lease, cp, { generation: 2, state: 'ephemeral' })).toMatchObject({ kind: 'marked' });
    expect(argvs).toHaveLength(1);
  });

  it('F13: a seen door that throws after a landed mark is logged as a throw, and the mark stands', async () => {
    const cp = checkpointWithLease({ generation: 1, parentIncarnation: INC });
    const lease = cp.leases[0]!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { d } = composer({ verbs: BOTH, carrier: JSON.stringify(bodyFor(lease)), seenThrows: true });
    expect(await markLeaseCarrier(d, lease, cp)).toEqual({ kind: 'marked', answer: 'written', seen: false });
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([`ccrc-server: delegation: carrier ${lease.leaseId} seen threw: a fixture throw`]);
  });
});

describe('PR6 on a fixture box: the real ws-lease-mark answers the lane', () => {
  const box = (): CcdHarness => {
    const h = makeCcdHarness('ccrc-carrier-lane-box-');
    harnesses.push(h);
    h.makeRepo('demo');
    F.agentTree(h, 'raw-tree');
    return h;
  };

  it('W5-K11c: a carrier two generations behind is marked once at the journal generation, written by the verb, and seen', async () => {
    const h = box();
    const w = await rawTreeWorld({ home: h.home });
    w.answer = realVerb(h);
    const lease = await linked(w);
    await censusPass(w, at(3));
    expect(leasesOf(w)[0]).toMatchObject({ generation: 1, carrierGenerationSeen: 1 });
    const applier = (await w.watcher.delegationApplier())!;
    const keep = { at: iso(at(3)), expiresAt: iso(at(3) + 7 * 86_400_000), terminalEvidenceAt: null, runId: null, promotedSession: null,
      auditEvidence: null, carrierRequired: false, resolvesThrough: null };
    expect((await applier.transitionLease({ leaseId: lease.leaseId, expectGeneration: 1, reason: 'retain', ...keep })).kind).toBe('applied');
    expect((await applier.transitionLease({ leaseId: lease.leaseId, expectGeneration: 2, reason: 'operator-retain', ...keep })).kind).toBe('applied');
    expect(F.carrier(h, lease.leaseId)).toMatchObject({ generation: 1 });
    const before = marks(w).length;
    await censusPass(w, at(4));
    expect(marks(w).slice(before)).toEqual([expect.objectContaining({ lease: lease.leaseId, generation: '3', state: 'retained' })]);
    expect(F.carrier(h, lease.leaseId)).toMatchObject({ generation: 3, state: 'retained', expiresAt: at(3) + 7 * 86_400_000 });
    expect(leasesOf(w)[0]).toMatchObject({ generation: 3, carrierGenerationSeen: 3 });
  }, ROW_MS);

  it('W5-K8b (the lane): a half-written mark, then a release, ends after one pass with no by-tree entry and the orphan rung not held', async () => {
    const h = box();
    const w = await rawTreeWorld({ home: h.home });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let pre = mvFailsOn(2);                                           // the carrier's rename fails: the index entry is written first (D-7803)
    w.answer = realVerb(h, () => pre);
    const lease = await linked(w);
    await censusPass(w, at(3));
    const byTree = path.join(F.leasesDir(h), 'by-tree');
    const entries = (): string[] => readdirSync(byTree).filter((n) => !n.startsWith('.'));
    expect(entries().map((n) => readFileSync(path.join(byTree, n), 'utf8').trim())).toEqual([lease.leaseId]);
    expect(existsSync(F.carrierPath(h, lease.leaseId))).toBe(false);
    const applier = (await w.watcher.delegationApplier())!;
    expect((await applier.releaseLease({ leaseId: lease.leaseId, expectGeneration: 1, releaseReason: 'foreign', at: iso(at(3)), lastHeadSha: null,
      resolvesThrough: null })).kind).toBe('applied');
    pre = '';
    const before = marks(w).length;
    await censusPass(w, at(4));
    expect(marks(w).slice(before).filter((f) => f.lease === lease.leaseId)).toEqual([expect.objectContaining({ state: 'released', 'release-reason': 'foreign' })]);
    expect(entries().map((n) => readFileSync(path.join(byTree, n), 'utf8').trim())).not.toContain(lease.leaseId);
    const tree = path.join(F.main(h), '.claude', 'worktrees', 'raw-tree');
    expect(h.sh(`_dl_orphan_rung ${q(F.main(h))} ${q(tree)}; echo "rc=$?"`).trim().split('\n').pop(), 'the orphan rung reads the tree not held').toBe('rc=0');
  }, ROW_MS);
});

// Review 1549 (PR6, carried into PR7): F2 and F4, through `planCarrierPass` itself over a stub FleetIO (the leases directory lists no
// carrier; the by-tree directory lists what the row says), so each row reads exactly what the memory decides.
describe('1549 F2 and F4: the carrier pass\'s memory', () => {
  const FLEET = { ccdVerbs: ['caps', LEASE_MARK_CAP, LEASE_MARK_LOCK_CAP] };
  const L1 = '11111111-1111-4111-8111-111111111111', L2 = '22222222-2222-4222-8222-222222222222';
  const stubIO = (byTree: Record<string, string>) => ({
    readdirMeasured: async (p: string) => (p.endsWith('/by-tree') ? { ok: true as const, entries: Object.keys(byTree) } : { ok: true as const, entries: [] as string[] }),
    readFileMeasured: async (p: string) => {
      const name = p.slice(p.lastIndexOf('/') + 1);
      return name in byTree ? { ok: true as const, content: `${byTree[name]}\n` } : { ok: false as const, reason: 'absent' as const };
    },
  });
  const two = (over1: Partial<DelegationLeaseRow>, over2: Partial<DelegationLeaseRow>): DelegationCheckpointV1 => {
    const a = leaseRow({ leaseId: L1, adminRecord: 'wt-1', creatingJournalSequence: 1, currentJournalSequence: 1, ...over1 });
    const b = leaseRow({ leaseId: L2, adminRecord: 'wt-2', creatingJournalSequence: 2, currentJournalSequence: 2, ...over2 });
    return { ...checkpointWithLease(), leases: [a, b], lineage: [] };
  };
  const marksOf = (steps: readonly { kind: string; args?: { leaseId: string } }[]): string[] => steps.flatMap((s) => (s.kind === 'mark' ? [s.args!.leaseId] : []));

  it('F2: a lease that answered unmeasured leaves the deferred group once a read-back journals seen, and is composed ahead of a deferred older one', async () => {
    const memory = emptyCarrierLaneMemory();
    memory.unmeasured.set(L1, 1).set(L2, 2);                         // both answered unmeasured; the older first
    const d = { io: stubIO({}), registryDir: '/fixture/reg' };
    // the newer one's carrier was read back equal and journalled seen: it is up to date, so it leaves the group
    await planCarrierPass(d as never, two({ generation: 1, carrierGenerationSeen: 0 }, { generation: 1, carrierGenerationSeen: 1 }), memory,
      { fleetState: FLEET, nowMs: NOW, census: [], workdirs: [] });
    expect([...memory.unmeasured.keys()]).toEqual([L1]);
    // its generation moves: it is composed first, the still-deferred older one after it
    const next = await planCarrierPass(d as never, two({ generation: 1, carrierGenerationSeen: 0 }, { generation: 2, carrierGenerationSeen: 1 }), memory,
      { fleetState: FLEET, nowMs: NOW, census: [], workdirs: [] });
    expect(marksOf(next.steps as never)).toEqual([L2, L1]);
  });

  it('F4: an entry written late names a lease already measured without one; it is measured again and healed', async () => {
    const memory = emptyCarrierLaneMemory();
    memory.notIndexed.add(L1);                                        // measured earlier with no entry naming it
    const released = '2026-10-15T10:00:00.000Z';
    const cp = two({ generation: 2, carrierGenerationSeen: 1, releasedAt: released }, { generation: 2, carrierGenerationSeen: 1, releasedAt: released });
    const key = 'a'.repeat(64);
    // the other released lease asks for the by-tree read; the late entry names L1
    const first = await planCarrierPass({ io: stubIO({ [key]: L1 }), registryDir: '/fixture/reg' } as never, cp, memory, { fleetState: FLEET, nowMs: NOW, census: [], workdirs: [] });
    expect(memory.notIndexed.has(L1), 'named by an entry: no longer measured without one').toBe(false);
    expect(marksOf(first.steps as never)).toEqual([L1]);
    // the pass after: the other lease is measured without an entry, and L1 is still asked for, so its heal is still composed
    const second = await planCarrierPass({ io: stubIO({ [key]: L1 }), registryDir: '/fixture/reg' } as never, cp, memory, { fleetState: FLEET, nowMs: NOW, census: [], workdirs: [] });
    expect(memory.notIndexed.has(L2)).toBe(true);
    expect(marksOf(second.steps as never)).toEqual([L1]);
  });
});
