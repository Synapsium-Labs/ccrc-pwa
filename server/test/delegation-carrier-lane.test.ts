// Delegation broker wave 5, PR6 (Task 5.6.2): the lane's carrier step, on `delegation-watch.test.ts`'s rig (a trimmed copy of its
// world, spool and census helpers) with a RECORDING `runCcd`. A row either answers the verb itself (and may write the carrier the argv
// describes, as the box would), or runs the REAL `cmd_ws_lease_mark` on a fixture box (`makeCcdHarness`). Every home is a fixture:
// nothing reads or writes the live `~/.ccrc` or `~/.cc-sessions`.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { FleetSession } from '../../shared/api.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { FleetWatcher, DELEGATION_SWEEP_MS } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { LEASE_MARK_CAP } from '../src/ccdargv.js';
import type { CcdResult } from '../src/coord/ports.js';
import { DELEGATION_CHECKPOINT_FILE, decodeDelegationCheckpoint } from '../src/coord/delegation-checkpoint.js';
import { DELEGATION_JOURNAL_FILE } from '../src/coord/delegation-journal.js';
import {
  DELEGATION_EVENTS_CAP, formatDelegationInstant, type DelegationCensusRecord, type DelegationLeaseRow,
} from '../src/coord/delegation-model.js';
import type { DelegationCensusPass } from '../src/coord/gitref.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import * as F from './leaseFixture.js';

const NOW = Date.UTC(2026, 9, 15, 10, 30, 0);
const INC = '0189abcd-1234-5678-9abc-0123456789ab';
const CLAUDE = '6350faa0-a1be-4e78-939c-57485268f6fc';
const BUCKET10 = '2026101510';
const ROW_MS = 120_000;
const at = (n: number): number => NOW + n * DELEGATION_SWEEP_MS;
const iso = (ms: number): string => formatDelegationInstant(ms);

type Answer = (argv: readonly string[]) => CcdResult | Promise<CcdResult>;
interface World {
  home: string; registryDir: string; watcher: FleetWatcher; argvs: string[][]; answer: Answer;
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
  const fleet = { connected: true, downSince: null, ccdVerbs: opts.ccdVerbs === undefined ? ['caps', DELEGATION_EVENTS_CAP, LEASE_MARK_CAP] : opts.ccdVerbs };
  const made = { home, registryDir: cfg.registryDir, argvs: [] as string[][], answer: written as Answer, fleet } as Omit<World, 'watcher'> as World;
  const runCcd = async (argv: readonly string[]): Promise<CcdResult> => { made.argvs.push([...argv]); return made.answer(argv); };
  const deps = { ...testDeps(home), monotonicMs: () => Date.now(), cfg, io: localIO, coord, fleetState: fleet, runCcd };
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
    const make = async (adminRecord: string, n: number): Promise<string> => {
      const out = await applier.createLease({ activityId: first.activityId, parentId: 'demo-a', parentIncarnation: INC, project: 'demo', adminRecord,
        canonicalPath: `/w/demo/.claude/worktrees/${adminRecord}`, creationBase: null, sourceKind: 'raw', correlationJournalIds: [], firstObservedAt: iso(at(2) + n) });
      expect(out.kind).toBe('created');
      return (out as { leaseId: string }).leaseId;
    };
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
