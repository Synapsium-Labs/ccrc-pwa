// Wave 4 PR3: real lane delivery of upkeep and compaction. Every home and database is a fixture.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { FleetWatcher } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import {
  DELEGATION_CHECKPOINT_FILE, DelegationDurability, encodeDelegationCheckpoint,
} from '../src/coord/delegation-checkpoint.js';
import { DELEGATION_JOURNAL_FILE, DELEGATION_CARRIED_FILE, DELEGATION_RETENTION_FLOOR_MS, buildDelegationJournalRecord, encodeDelegationJournalRecord, parseDelegationJournal } from '../src/coord/delegation-journal.js';
import { DELEGATION_EVENTS_CAP, DELEGATION_HOUR_NEVER_CLOSED, delegationSha256Hex, type DelegationJournalRecordV1 } from '../src/coord/delegation-model.js';
import { oldRuleCheckpoint } from './delegationOldRuleFixture.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const HOUR = 3_600_000;
const MIN = 60_000;
const AT = Date.UTC(2026, 9, 15, 10);
const OWNER = 'lane-a-demo';
const INC = 'g1';
const CLAUDE = '11111111-2222-3333-4444-555555555555';
const iso = (ms: number): string => new Date(ms).toISOString();
const bucket = (ms: number): string => iso(ms).replace(/[-:T]/g, '').slice(0, 10);
const interval = (at: number, recordedAt = at + 2 * HOUR) => ({
  sessionId: OWNER, parentIncarnation: INC, utcHour: iso(at), state: 'measured' as const, detail: null, recordedAt: iso(recordedAt),
});
const cursor = (at: number) => ({
  sessionId: OWNER, parentIncarnation: INC, bucket: bucket(at), cursor: 10, lastSize: 10, lastCompleteAt: iso(at + 5 * MIN),
  intervalState: 'measured' as const, detail: null, anchor: { start: 0, sha256: 'a'.repeat(64) }, replaced: false,
});
const worlds: Array<{ watcher: FleetWatcher; coord: CoordStore }> = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) { await w.watcher.closeDelegation(); w.coord.db.close(); }
  vi.restoreAllMocks();
});

function world(legacy = false) {
  const home = mkTmp('ccrc-compaction-lane-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  if (legacy) {
    const records: DelegationJournalRecordV1[] = [];
    for (const [n, extra] of [
      { eventKind: 'SessionStart', source: 'startup' },
      { eventKind: 'PreToolUse', toolName: 'Bash', toolUseId: 'toolu_z', listing: ['a'] },
      { eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 'toolu_z', listing: ['a'], outcome: 'completed' },
    ].entries()) {
      const event = {
        v: 1, observedAt: iso(AT - 3 * HOUR + n * MIN), sessionId: OWNER, parentIncarnation: INC, claudeSessionId: CLAUDE,
        eventId: delegationSha256Hex(`lane-event-${n}`), bucket: bucket(AT - 3 * HOUR), startOffset: n * 100, endOffset: n * 100 + 99, ...extra,
      } as DelegationEventEnvelopeV1;
      records.push(buildDelegationJournalRecord({ sequence: n + 1, acceptedAt: event.observedAt, previousDigest: records.at(-1)?.digest ?? null, entry: { kind: 'evidence-accepted', event } }));
    }
    writeFileSync(path.join(home, '.ccrc', DELEGATION_JOURNAL_FILE), Buffer.concat(records.map(encodeDelegationJournalRecord)));
    writeFileSync(path.join(home, '.ccrc', DELEGATION_CHECKPOINT_FILE), encodeDelegationCheckpoint({ ...oldRuleCheckpoint(records), revision: 1 }));
  }
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-compaction-projects-') } as never);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const clock = { ms: 0 };
  const watcher = new FleetWatcher({ ...testDeps(home), cfg, coord, io: localIO, monotonicMs: () => clock.ms,
    fleetState: { connected: true, downSince: null, ccdVerbs: ['caps', DELEGATION_EVENTS_CAP] },
  } as never, new Bus(), 10_000);
  watcher.setDelegationSeams({ loopTurn: async () => {}, onPassPhase: () => { clock.ms += 2000; } });
  worlds.push({ watcher, coord });
  return { home, watcher, coord, clock };
}
type World = ReturnType<typeof world>;
async function pass(w: World, now: number): Promise<void> {
  w.clock.ms += 60_000; // The delivery cadence is monotonic; every requested fixture pass must actually run.
  vi.spyOn(Date, 'now').mockReturnValue(now);
  (w.watcher as unknown as { delegationCensus: unknown }).delegationCensus = { measuredAt: now, projects: new Map(), incarnations: new Map() };
  await w.watcher.sweepDelegation([], []);
}
const measures = (d: DelegationDurability) => ({ ...d.commitMeasures(), revision: d.state().checkpoint.revision });
const delta = (d: DelegationDurability, before: ReturnType<typeof measures>) => ({
  encodes: d.commitMeasures().encodes - before.encodes, writes: d.commitMeasures().writes - before.writes,
  revision: d.state().checkpoint.revision - before.revision,
});
async function upkeepWorld() {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(Date, 'now').mockReturnValue(AT + MIN);
  const w = world(true);
  const d = (await w.watcher.delegationApplier())!;
  await d.applyAccepted({ accepted: [], cursor: cursor(AT - 49 * HOUR), interval: interval(AT - 49 * HOUR) });
  await d.applyAccepted({ accepted: [], cursor: null, interval: interval(AT - 200 * HOUR) });
  return { w, d };
}

let eventSerial = 0;
async function seedCompaction(d: DelegationDurability, oldCount = 12, recentCount = 1) {
  const accepted: DelegationEventEnvelopeV1[] = [];
  for (let i = 0; i < oldCount + recentCount; i++) {
    const n = ++eventSerial;
    const at = i < oldCount ? AT - 12 * 24 * HOUR + i * MIN : AT - HOUR + i * MIN;
    accepted.push({ v: 1, observedAt: iso(at), sessionId: OWNER, parentIncarnation: INC, claudeSessionId: CLAUDE,
      eventId: delegationSha256Hex(`daily-event-${n}`), bucket: bucket(at), startOffset: n * 100, endOffset: n * 100 + 99,
      ...(i === 0 ? { eventKind: 'SubagentStart' as const, agentId: 'agent-a', agentType: null }
        : { eventKind: 'SessionStart' as const, source: 'startup' as const }),
    });
  }
  for (const event of accepted) {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(event.observedAt));
    await d.applyAccepted({ accepted: [{ event }], cursor: null, interval: null });
  }
}
const slowFields = (line: string): Record<string, number> => Object.fromEntries(
  [...line.matchAll(/ ([a-zA-Z]+)=(\d+)/g)].map((m) => [m[1]!, Number(m[2])]),
);
const compactSizes = ['cutRecords', 'cutBytes', 'carried', 'carriedBytes', 'eventsCut', 'rowsRetired'];

describe('Task 3.7: daily compaction through the real lane', () => {
  it('W4-C28: spends one UTC day before the attempt and tries again only on the next day', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const d = (await w.watcher.delegationApplier())!;
    const compact = vi.spyOn(d, 'compactJournal');
    await pass(w, AT + MIN);
    await pass(w, AT + 2 * MIN);
    expect(compact).toHaveBeenCalledTimes(1);
    expect(compact).toHaveBeenCalledWith(AT + MIN, DELEGATION_RETENTION_FLOOR_MS);
    await pass(w, AT + 24 * HOUR);
    expect(compact).toHaveBeenCalledTimes(2);
  });

  it('W4-C28 rejection: no same-day retry, and the failure is reported once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const d = (await w.watcher.delegationApplier())!;
    const compact = vi.spyOn(d, 'compactJournal').mockRejectedValue(new Error('disk full (fixture)'));
    await pass(w, AT + MIN);
    await pass(w, AT + 2 * MIN);
    expect(compact).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.map((c) => c[0]).filter((m) => String(m).startsWith('ccrc-server: delegation compaction failed:')))
      .toEqual(['ccrc-server: delegation compaction failed: disk full (fixture)']);
    await pass(w, AT + 24 * HOUR);
    expect(compact).toHaveBeenCalledTimes(2);
  });

  it('W4-C28 reconstructing: never calls compaction before recovery is ready', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    writeFileSync(path.join(w.home, '.ccrc', DELEGATION_JOURNAL_FILE), 'not a journal\n');
    const d = (await w.watcher.delegationApplier())!;
    expect(d.pruningEnabled()).toBe(false);
    const compact = vi.spyOn(d, 'compactJournal');
    await pass(w, AT + MIN);
    expect(compact).not.toHaveBeenCalled();
  });

  it('W4-C28 reconstructing at the compaction boundary: a recovery during upkeep prevents the call', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const d = (await w.watcher.delegationApplier())!;
    const upkeep = d.upkeep.bind(d);
    vi.spyOn(d, 'upkeep').mockImplementation(async (request) => {
      const out = await upkeep(request);
      writeFileSync(path.join(w.home, '.ccrc', DELEGATION_JOURNAL_FILE), 'not a journal\n');
      await d.recover();
      expect(d.pruningEnabled()).toBe(false);
      return out;
    });
    const compact = vi.spyOn(d, 'compactJournal');
    await pass(w, AT + MIN);
    expect(compact).not.toHaveBeenCalled();
  });

  it('W4-C29: reports actual cut sizes and S+1 acceptedAt; a same-day pass carries none of the compaction size keys', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const d = (await w.watcher.delegationApplier())!;
    await seedCompaction(d);
    const before = parseDelegationJournal(new Uint8Array(readFileSync(path.join(w.home, '.ccrc', DELEGATION_JOURNAL_FILE))));
    const compact = vi.spyOn(d, 'compactJournal');
    await pass(w, AT + MIN);
    expect(compact).toHaveBeenCalledTimes(1);
    const out = await compact.mock.results[0]!.value;
    expect(out.kind).toBe('compacted');
    if (out.kind !== 'compacted') throw new Error('fixture did not compact');
    const lines = warn.mock.calls.map((c) => String(c[0]));
    const fields = slowFields(lines.find((m) => m.startsWith('ccrc-server: delegation pass slow:'))!);
    expect(Object.fromEntries(compactSizes.map((k) => [k, fields[k]]))).toEqual({
      cutRecords: out.plan.cutRecords, cutBytes: out.plan.cutBytes, carried: out.plan.carried.length,
      carriedBytes: out.plan.carriedBytes, eventsCut: out.eventsDeleted, rowsRetired: out.retired,
    });
    const next = before.find((r) => r.sequence === out.plan.cutThrough + 1)!;
    const carried = readFileSync(path.join(w.home, '.ccrc', DELEGATION_CARRIED_FILE));
    expect(lines.find((m) => m.startsWith('ccrc-server: delegation compaction:'))).toContain(
      `first retained ${next.sequence} accepted ${next.acceptedAt}`,
    );
    expect(lines.find((m) => m.startsWith('ccrc-server: delegation compaction:'))).toContain(
      `carried file ${carried.length} in ${out.plan.carried.length} lines`,
    );
    warn.mockClear();
    await pass(w, AT + 2 * MIN);
    const idle = slowFields(warn.mock.calls.map((c) => String(c[0])).find((m) => m.startsWith('ccrc-server: delegation pass slow:'))!);
    for (const k of compactSizes) expect(idle, k).not.toHaveProperty(k);
  });

  it('W4-C29 skip: nothing-to-cut reports the uncut journal first acceptedAt and the current carried file size', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const d = (await w.watcher.delegationApplier())!;
    await seedCompaction(d, 12, 1);
    const first = await d.compactJournal(AT, DELEGATION_RETENTION_FLOOR_MS);
    expect(first.kind).toBe('compacted');
    const journalPath = path.join(w.home, '.ccrc', DELEGATION_JOURNAL_FILE);
    const journal = readFileSync(journalPath);
    const firstRecord = parseDelegationJournal(new Uint8Array(journal))[0]!;
    const carried = readFileSync(path.join(w.home, '.ccrc', DELEGATION_CARRIED_FILE));
    const compact = vi.spyOn(d, 'compactJournal');
    await pass(w, AT + MIN);
    expect(compact).toHaveBeenCalledTimes(1);
    expect(await compact.mock.results[0]!.value).toMatchObject({ kind: 'skipped', reason: 'nothing-to-cut' });
    expect(warn.mock.calls.map((c) => String(c[0])).find((m) => m.startsWith('ccrc-server: delegation compaction:')))
      .toBe(`ccrc-server: delegation compaction: skipped (nothing-to-cut 0%); first record accepted ${firstRecord.acceptedAt}; carried file ${carried.length} in ${carried.toString().trim().split('\n').length} lines`);
    expect(readFileSync(journalPath)).toEqual(journal);
  });

  it('W4-C29 below-share: names the first journal record, not the first retained record or the cut successor', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const d = (await w.watcher.delegationApplier())!;
    await seedCompaction(d, 1, 20);
    const journal = parseDelegationJournal(new Uint8Array(readFileSync(path.join(w.home, '.ccrc', DELEGATION_JOURNAL_FILE))));
    const compact = vi.spyOn(d, 'compactJournal');
    await pass(w, AT + MIN);
    expect(compact).toHaveBeenCalledTimes(1);
    expect(await compact.mock.results[0]!.value).toMatchObject({ kind: 'skipped', reason: 'below-share' });
    const line = warn.mock.calls.map((c) => String(c[0])).find((m) => m.startsWith('ccrc-server: delegation compaction:'))!;
    expect(line).toMatch(/^ccrc-server: delegation compaction: skipped \(below-share \d+(?:\.\d+)?%\);/);
    expect(line).toContain(`first record accepted ${journal[0]!.acceptedAt}; carried file 0 in 0 lines`);
  });
});

describe('Task 3.1: upkeep through the real lane', () => {
  it('W4-C1: interval retention, cursor retention and zero-delta retirement share one encode, write and revision', async () => {
    // Splitting the lane into three commits, or removing rowsChanged, breaks these measured deltas.
    const { w, d } = await upkeepWorld();
    expect(d.state().checkpoint.activities).toHaveLength(1);
    const before = measures(d);
    await pass(w, AT + MIN);
    expect(delta(d, before)).toEqual({ encodes: 1, writes: 1, revision: 1 });
    expect(d.state().checkpoint.activities).toEqual([]);
    expect(d.state().checkpoint.bucketCursors).toEqual([]);
    expect(d.state().checkpoint.observationIntervals.map((r) => r.utcHour)).toEqual([iso(AT - 49 * HOUR)]);
    expect(w.watcher.delegationReport().cursorsPruned).toBe(1);
  });

  it('W4-C2: the next same-hour pass has nothing due and never enters the upkeep door', async () => {
    const { w, d } = await upkeepWorld();
    await pass(w, AT + MIN);
    const upkeep = vi.spyOn(d, 'upkeep');
    const before = measures(d);
    await pass(w, AT + 2 * MIN);
    expect(upkeep).not.toHaveBeenCalled();
    expect(delta(d, before)).toEqual({ encodes: 0, writes: 0, revision: 0 });
  });

  it('W4-C2b: a new UTC hour enters the door with nothing due: no applied commit, encode, write or revision', async () => {
    const { w, d } = await upkeepWorld();
    await pass(w, AT + MIN);
    const upkeep = vi.spyOn(d, 'upkeep');
    const before = measures(d);
    await pass(w, AT + HOUR + MIN);
    expect(upkeep).toHaveBeenCalledExactlyOnceWith({ nowMs: AT + HOUR + MIN, intervals: false, cursors: true, zeroDelta: true });
    expect(await upkeep.mock.results[0]!.value).toEqual({ intervalsChanged: false, cursorsDropped: 0, cursorsUnparseable: 0, retired: 0, applied: null });
    expect(delta(d, before)).toEqual({ encodes: 0, writes: 0, revision: 0 });
  });

  it('N6 and RB22: a rejected hourly upkeep spends its hour, warns once and does not prevent reconciliation', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const phases: string[] = [];
    w.watcher.setDelegationSeams({ onPassPhase: (phase) => { w.clock.ms += 2000; phases.push(phase); } });
    const d = (await w.watcher.delegationApplier())!;
    await d.applyAccepted({ accepted: [], cursor: cursor(AT - 49 * HOUR), interval: interval(AT - 49 * HOUR) });
    const upkeep = vi.spyOn(d, 'upkeep').mockRejectedValue(new Error('disk full (fixture)'));
    const before = measures(d);
    await pass(w, AT + MIN);
    expect(phases).toContain('reconcile');
    await pass(w, AT + 2 * MIN);
    expect(upkeep).toHaveBeenCalledTimes(1);
    expect(delta(d, before)).toEqual({ encodes: 0, writes: 0, revision: 0 });
    expect(warn.mock.calls.map((c) => c[0]).filter((m) => String(m).startsWith('ccrc-server: delegation upkeep failed:')))
      .toEqual(['ccrc-server: delegation upkeep failed: disk full (fixture)']);
    await pass(w, AT + HOUR + MIN);
    expect(upkeep).toHaveBeenCalledTimes(2);
  });

  it('W4-C3: a measured interval crosses the never-closed deadline mid-hour without dropping its cursor', async () => {
    // Gating intervals to the cursor hour leaves this measured row falsely complete until the next hour.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const first = AT + HOUR + MIN;
    await pass(w, first);
    const d = (await w.watcher.delegationApplier())!;
    const oldHour = AT - 24 * HOUR;
    await d.applyAccepted({ accepted: [], cursor: cursor(oldHour), interval: interval(oldHour, oldHour + MIN) });
    const upkeep = vi.spyOn(d, 'upkeep');
    await pass(w, first + 2 * MIN);
    expect(upkeep).toHaveBeenCalledWith({ nowMs: first + 2 * MIN, intervals: true, cursors: false, zeroDelta: false });
    expect((await upkeep.mock.results[0]!.value).cursorsDropped).toBe(0);
    expect(d.state().checkpoint.observationIntervals[0]).toMatchObject({ state: 'unmeasured', detail: expect.stringContaining(DELEGATION_HOUR_NEVER_CLOSED) });
    expect(d.state().checkpoint.bucketCursors.map((c) => c.bucket)).toEqual([bucket(oldHour)]);
    expect(w.watcher.delegationReport().cursorsPruned).toBe(0);
  });
});
