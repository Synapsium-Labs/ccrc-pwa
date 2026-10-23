// THE STALE-ARCHIVE ARM (fleet disk retention, D-6643; spec 2026-10-23 §2.7.5). `staleArchiveVerdict` (L1) holds the
// rule and `staleArchivePass` (L3) gathers its facts and acts. NOTHING here reaches a box: ccd is a scripted recorder,
// the coordination store is a stub and every pane, transcript and clock is injected.
import { describe, it, expect } from 'vitest';
import {
  STALE_ARCHIVE_AFTER_MS, STALE_ARCHIVE_SIGHTING_GAP_MS, staleArchiveVerdict,
  type StaleArchiveFacts, type StaleArchiveRow,
} from '../src/archivedExpiry.js';
import {
  STALE_ARCHIVE_SWEEP_MS, staleArchivePass, type StaleArchiveDeps, type StaleArchiveMemory,
} from '../src/coord/staleArchive.js';
import { ACTOR_FLAGS_CAP, ARCHIVE_IF_NO_PANE_CAP, CCD_ARGV } from '../src/ccdargv.js';
import type { SessionRecord } from '../src/registry.js';

const DAY = 86_400_000;
const NOW = 1_790_000_000_000;
const row = (over: Partial<StaleArchiveRow> = {}): StaleArchiveRow => ({
  workspace: 'ws-a', archivedAt: null, child: { kind: 'none' }, identityMeasured: true, held: null, ...over,
});
const facts = (over: Partial<StaleArchiveFacts> = {}): StaleArchiveFacts => ({
  claims: 'never', pane: 'absent', sightings: { firstAt: NOW - 2 * STALE_ARCHIVE_SIGHTING_GAP_MS, lastAt: NOW },
  viewer: false, evidenceAtMs: NOW - 15 * DAY, ...over,
});

describe('staleArchiveVerdict (L1)', () => {
  it('archives a never-claimant with no pane for 15 days, seen twice', () => {
    expect(staleArchiveVerdict(row(), facts(), NOW)).toEqual({ eligible: true });
  });

  it('keeps it at 13 days, and at the boundary the other way', () => {
    expect(staleArchiveVerdict(row(), facts({ evidenceAtMs: NOW - 13 * DAY }), NOW)).toEqual({ eligible: false, why: 'recent' });
    expect(staleArchiveVerdict(row(), facts({ evidenceAtMs: NOW - STALE_ARCHIVE_AFTER_MS }), NOW)).toEqual({ eligible: true });
    expect(STALE_ARCHIVE_AFTER_MS).toBe(14 * DAY);
  });

  it('keeps a row seen once, or twice inside the hour', () => {
    expect(staleArchiveVerdict(row(), facts({ sightings: { firstAt: NOW, lastAt: NOW } }), NOW)).toEqual({ eligible: false, why: 'one-sighting' });
    expect(staleArchiveVerdict(row(), facts({ sightings: { firstAt: NOW - STALE_ARCHIVE_SIGHTING_GAP_MS + 1, lastAt: NOW } }), NOW))
      .toEqual({ eligible: false, why: 'one-sighting' });
    expect(staleArchiveVerdict(row(), facts({ sightings: null }), NOW)).toEqual({ eligible: false, why: 'one-sighting' });
  });

  it('keeps a viewer, a hold, a child mark of any reading, an archived row, a main checkout and an unmeasured identity', () => {
    expect(staleArchiveVerdict(row(), facts({ viewer: true }), NOW)).toEqual({ eligible: false, why: 'viewer' });
    expect(staleArchiveVerdict(row({ held: 'program' }), facts(), NOW)).toEqual({ eligible: false, why: 'held' });
    expect(staleArchiveVerdict(row({ child: { kind: 'child', runId: 4 } }), facts(), NOW)).toEqual({ eligible: false, why: 'child' });
    expect(staleArchiveVerdict(row({ child: { kind: 'unreadable' } }), facts(), NOW)).toEqual({ eligible: false, why: 'child' });
    expect(staleArchiveVerdict(row({ archivedAt: 5 }), facts(), NOW)).toEqual({ eligible: false, why: 'archived' });
    expect(staleArchiveVerdict(row({ workspace: null }), facts(), NOW)).toEqual({ eligible: false, why: 'not-a-workspace' });
    expect(staleArchiveVerdict(row({ identityMeasured: false }), facts(), NOW)).toEqual({ eligible: false, why: 'identity-unmeasured' });
  });

  it('keeps any past claimant and a claims read that failed', () => {
    expect(staleArchiveVerdict(row(), facts({ claims: 'ever' }), NOW)).toEqual({ eligible: false, why: 'claimant' });
    expect(staleArchiveVerdict(row(), facts({ claims: 'unreadable' }), NOW)).toEqual({ eligible: false, why: 'claims-unreadable' });
  });

  it('keeps a pane that is up, or that nobody could measure', () => {
    expect(staleArchiveVerdict(row(), facts({ pane: 'present' }), NOW)).toEqual({ eligible: false, why: 'pane' });
    expect(staleArchiveVerdict(row(), facts({ pane: 'unmeasured' }), NOW)).toEqual({ eligible: false, why: 'pane' });
  });

  it('keeps a row with no evidence of when it last ran: missing evidence is never read as old', () => {
    expect(staleArchiveVerdict(row(), facts({ evidenceAtMs: null }), NOW)).toEqual({ eligible: false, why: 'no-evidence' });
  });
});

// ── the pass ────────────────────────────────────────────────────────────────

const rec = (id: string, over: Record<string, unknown> = {}): SessionRecord => ({
  id, wrapper: 'lane-a', project: 'project-a', workdir: `/w/${id}`, uuid: `u-${id}`,
  workspace: `ws-${id}`, archivedAt: null, held: null, child: { kind: 'none' }, unmeasured: [],
  spawn: null, supervisedAt: null, hibernatedAt: null, lifecycleUnmeasured: [], ...over,
}) as unknown as SessionRecord;

interface Harness {
  deps: StaleArchiveDeps; mem: StaleArchiveMemory; ccd: string[][]; feed: { title: string; body: string }[];
  clock: { now: number }; listing: { names: string[] | null }; fresh: Record<string, Record<string, unknown>>; rows: Map<string, SessionRecord>; setPane: (p: 'absent' | 'present' | 'unmeasured') => void; ccdAnswer: { stderr: string; ok: boolean };
}
const harness = (o: {
  claims?: Record<string, unknown>; open?: string[]; evidence?: number | null | 'unreadable'; viewer?: boolean; caps?: string[];
  claimsThrow?: boolean; beforeAct?: (id: string) => void; acts?: { act: string; at: number | null; outcome: string }[];
} = {}): Harness => {
  const clock = { now: NOW };
  const ccd: string[][] = [];
  const feed: { title: string; body: string }[] = [];
  let pane: 'absent' | 'present' | 'unmeasured' = 'absent';
  const ccdAnswer = { stderr: '', ok: true };
  const listing: { names: string[] | null } = { names: [] };
  const fresh: Record<string, Record<string, unknown>> = {};
  const rows = new Map<string, SessionRecord>();
  const deps: StaleArchiveDeps = {
    coord: {
      childReclaimCoordinatorClaims: () => { if (o.claimsThrow) throw new Error('db'); return new Map(Object.entries(o.claims ?? {})) as never; },
      openCoordinatorIds: () => o.open ?? [],
      lifecycleFor: () => (o.acts ?? []) as never,
    },
    presence: { isVisible: () => o.viewer === true },
    notice: (e) => { feed.push({ title: e.title, body: e.body }); },
    runCcd: async (argv) => { ccd.push([...argv]); return { ok: ccdAnswer.ok, stdout: '', stderr: ccdAnswer.stderr, killed: false, signal: null } as never; },
    fleetState: { ccdVerbs: o.caps ?? ['ws-archive', ARCHIVE_IF_NO_PANE_CAP, ACTOR_FLAGS_CAP] } as never,
    pane: async () => pane,
    transcriptMtimeMs: async () => (o.evidence === undefined ? NOW - 15 * DAY : o.evidence === null ? 'none' : o.evidence),
    wokeAtMs: async () => null,
    listRegistry: async () => (listing.names === null ? { ok: false, reason: 'unreadable' } : { ok: true, entries: listing.names }) as never,
    rowNow: async (r) => ({ ...(rows.get(r.id) ?? r), ...(fresh[r.id] ?? {}) }) as SessionRecord,
    queueRun: (id, fn) => (o.beforeAct?.(id), fn()),
    log: () => {},
    now: () => clock.now,
  };
  return { deps, listing, fresh, rows, mem: { sightings: new Map(), would: new Set(), failed: new Map() }, ccd, feed, clock, setPane: (p) => { pane = p; }, ccdAnswer };
};
const pass = (h: Harness, records: SessionRecord[], names: string[]) => {
  h.listing.names = names;
  for (const r of records) h.rows.set(r.id, r);
  return staleArchivePass(h.deps, h.mem, records, names);
};
const LIVE = ['stale-archive-live'];
/** Two passes an hour and a bit apart, the second the one that may act. */
const twoPasses = async (h: Harness, records: SessionRecord[], names: string[]) => {
  await pass(h, records, names);
  h.clock.now += STALE_ARCHIVE_SIGHTING_GAP_MS + 1;
  return pass(h, records, names);
};

describe('staleArchivePass (L3)', () => {
  it('ARMED: the second sighting archives with --if-no-pane and the stale reason, and writes one feed row', async () => {
    const h = harness();
    const out = await twoPasses(h, [rec('a')], LIVE);
    expect(h.ccd).toHaveLength(1);
    expect(h.ccd[0]).toEqual([...CCD_ARGV.wsArchive('a', { surface: 'agent', actor: 'sweep:stale-archive', reason: 'stale' }, { ifNoPane: true })]);
    expect(h.ccd[0]).toContain('--if-no-pane');
    expect(h.ccd[0]!.slice(h.ccd[0]!.indexOf('--reason'), h.ccd[0]!.indexOf('--reason') + 2)).toEqual(['--reason', 'stale']);
    expect(out.map((o) => o.kind)).toEqual(['archived']);
    expect(h.feed).toHaveLength(1);
  });

  it('SHADOW: records would-archive once, and composes nothing, however many passes', async () => {
    const h = harness();
    await twoPasses(h, [rec('a')], []);
    h.clock.now += STALE_ARCHIVE_SWEEP_MS;
    const again = await pass(h, [rec('a')], []);
    expect(h.ccd).toEqual([]);
    expect(h.feed).toHaveLength(1);
    expect(h.feed[0]!.title).toMatch(/would archive/i);
    expect(again.map((o) => o.kind)).toEqual(['would-archive']);
  });

  it('the first pass never acts: one sighting is not two', async () => {
    const h = harness();
    await pass(h, [rec('a')], LIVE);
    expect(h.ccd).toEqual([]);
  });

  it('a pane back between the sightings starts the count again', async () => {
    const h = harness();
    await pass(h, [rec('a')], LIVE);
    h.clock.now += STALE_ARCHIVE_SIGHTING_GAP_MS + 1;
    h.setPane('present');
    await pass(h, [rec('a')], LIVE);
    h.setPane('absent');
    h.clock.now += 1;
    await pass(h, [rec('a')], LIVE);
    expect(h.ccd).toEqual([]);
  });

  it('13 days, no evidence, a viewer, a hold, a child, a main checkout, any past claim and a current claim all keep', async () => {
    const cases: [string, Harness, SessionRecord][] = [
      ['13 days', harness({ evidence: NOW - 13 * DAY }), rec('a')],
      ['no evidence', harness({ evidence: null }), rec('a')],
      ['viewer', harness({ viewer: true }), rec('a')],
      ['hold', harness(), rec('a', { held: 'program' })],
      ['child', harness(), rec('a', { child: { kind: 'child', runId: 2 } })],
      ['main checkout', harness(), rec('a', { workspace: null })],
      ['past claim', harness({ claims: { a: 7 } }), rec('a')],
      ['current claim', harness({ open: ['a'] }), rec('a')],
      ['claims unreadable', harness({ claimsThrow: true }), rec('a')],
    ];
    for (const [name, h, r] of cases) {
      await twoPasses(h, [r], LIVE);
      expect(h.ccd, name).toEqual([]);
      expect(h.feed, name).toEqual([]);
    }
  });

  it('a hibernated row whose .supervised is 15 days old and has no transcript archives', async () => {
    const h = harness({ evidence: null });
    await twoPasses(h, [rec('a', { hibernatedAt: Math.floor(NOW / 1000), supervisedAt: Math.floor((NOW - 15 * DAY) / 1000) })], LIVE);
    expect(h.ccd).toHaveLength(1);
  });

  it('a transcript that could not be read keeps the row however old the other evidence is', async () => {
    const h = harness({ evidence: 'unreadable' });
    await twoPasses(h, [rec('a', { supervisedAt: Math.floor((NOW - 15 * DAY) / 1000) })], LIVE);
    expect(h.ccd).toEqual([]);
  });

  it('a .spawn that is listed but read as absent keeps the row', async () => {
    const h = harness();
    await twoPasses(h, [rec('a')], [...LIVE, 'a.spawn']);
    expect(h.ccd).toEqual([]);
  });

  it('a claim made, or a claims read that fails, between the verdict and the act stops the archive', async () => {
    const mk = (mutate: (h: Harness) => void) => {
      const h: Harness = harness({ beforeAct: () => mutate(h) });
      return h;
    };
    const cases: [string, Harness, string][] = [
      ['past claim', mk((h) => { h.deps.coord!.childReclaimCoordinatorClaims = (() => new Map([['a', 1]])) as never; }), 'claimant'],
      ['open coordinator', mk((h) => { h.deps.coord!.openCoordinatorIds = () => ['a']; }), 'claimant'],
      ['claims throw', mk((h) => { h.deps.coord!.openCoordinatorIds = () => { throw new Error('db'); }; }), 'claims-unreadable'],
    ];
    for (const [name, h, why] of cases) {
      const out = await twoPasses(h, [rec('a')], LIVE);
      expect(h.ccd, name).toEqual([]);
      expect(out, name).toEqual([{ kind: 'deferred', id: 'a', why }]);
    }
  });

  it('the newest of the registry stamps and the journal counts: a spawn 2 days ago keeps the row', async () => {
    const h = harness();
    await twoPasses(h, [rec('a', { spawn: { at: Math.floor((NOW - 2 * DAY) / 1000), rc: 0 } })], LIVE);
    expect(h.ccd).toEqual([]);
    const g = harness({ acts: [{ act: 'supervise', at: NOW - DAY, outcome: 'done' }] });
    await twoPasses(g, [rec('a')], LIVE);
    expect(g.ccd).toEqual([]);
  });

  it('a pane back at the act: ccd answers live, and it is recorded and nothing else', async () => {
    const h = harness();
    h.ccdAnswer.ok = false;
    h.ccdAnswer.stderr = 'ccd: live\n';
    const out = await twoPasses(h, [rec('a')], LIVE);
    expect(h.ccd).toHaveLength(1);
    expect(out.map((o) => o.kind)).toEqual(['live-at-act']);
    expect(h.feed).toEqual([]);
    expect(h.mem.sightings.has('a')).toBe(false);
  });

  it('someone who opens the session between the verdict and the act defers it', async () => {
    const h = harness();
    let calls = 0;
    (h.deps as { presence: unknown }).presence = { isVisible: () => ++calls > 2 };
    const out = await twoPasses(h, [rec('a')], LIVE);
    expect(h.ccd).toEqual([]);
    expect(out.map((o) => o.kind)).toEqual(['deferred']);
  });

  it('a row ccd always refuses does not hold the head of the line: the next due row is archived on the next pass', async () => {
    const h = harness();
    const run = h.deps.runCcd;
    (h.deps as { runCcd: StaleArchiveDeps['runCcd'] }).runCcd = async (argv: Parameters<StaleArchiveDeps['runCcd']>[0]) => (argv.includes('a')
      ? (h.ccd.push([...argv]), { ok: false, stdout: '', stderr: 'ccd: worktree is gone\n', killed: false, signal: null } as never)
      : run(argv));
    const recs = [rec('a'), rec('b')];
    const first = await twoPasses(h, recs, LIVE);
    expect(first.map((o) => o.kind)).toEqual(['failed']);
    h.clock.now += 3_600_000;
    const second = await pass(h, recs, LIVE);
    expect(second.map((o) => [o.kind, o.id])).toEqual([['archived', 'b']]);
    h.clock.now += 25 * 3_600_000;
    const third = await pass(h, recs, LIVE);
    expect(third.map((o) => [o.kind, o.id])).toEqual([['failed', 'a']]);
  });

  it('at most one act a pass, fleet-wide', async () => {
    const h = harness();
    await twoPasses(h, [rec('a'), rec('b'), rec('c')], LIVE);
    expect(h.ccd).toHaveLength(1);
  });

  it('reclaim-paused stops it entirely, and forgets the sightings', async () => {
    const h = harness();
    await pass(h, [rec('a')], LIVE);
    h.clock.now += STALE_ARCHIVE_SIGHTING_GAP_MS + 1;
    await pass(h, [rec('a')], [...LIVE, 'reclaim-paused']);
    expect(h.ccd).toEqual([]);
    expect(h.mem.sightings.size).toBe(0);
  });

  it('a box that does not advertise the capability, or the actor flags, is never sent the flag', async () => {
    for (const caps of [[ACTOR_FLAGS_CAP], [ARCHIVE_IF_NO_PANE_CAP], []]) {
      const h = harness({ caps });
      await twoPasses(h, [rec('a')], LIVE);
      expect(h.ccd, caps.join()).toEqual([]);
    }
  });

  it('an unreadable registry listing is no licence: it holds like a raised pause', async () => {
    const h = harness();
    await twoPasses(h, [rec('a')], null as never);
    expect(h.ccd).toEqual([]);
  });

  it('a pause raised, or the switch lifted, while the act waits on the queue stops the archive', async () => {
    for (const [names, kind] of [[[...LIVE, 'reclaim-paused'], 'deferred'], [[], 'would-archive'], [null, 'deferred']] as const) {
      const h = harness({ beforeAct: () => { h.listing.names = names as never; } });
      await pass(h, [rec('a')], LIVE);
      h.clock.now += STALE_ARCHIVE_SIGHTING_GAP_MS + 1;
      const out = await pass(h, [rec('a')], LIVE);
      expect(h.ccd, String(names)).toEqual([]);
      expect(out.map((o) => o.kind)).toEqual([kind]);
    }
  });

  it('a hold, a child mark, an archive or a new claim set between the verdict and the act stops the archive', async () => {
    for (const over of [{ held: 'program' }, { child: { kind: 'child', runId: 3 } }, { archivedAt: 9 }, { unmeasured: ['x'] }]) {
      const h = harness({ beforeAct: () => { h.fresh.a = over; } });
      const out = await twoPasses(h, [rec('a')], LIVE);
      expect(h.ccd, JSON.stringify(over)).toEqual([]);
      expect(out.map((o) => o.kind)).toEqual(['deferred']);
    }
    const c = harness();
    c.deps.coord!.openCoordinatorIds = () => [];
    await pass(c, [rec('a')], LIVE);
    c.clock.now += STALE_ARCHIVE_SIGHTING_GAP_MS + 1;
    c.deps.coord!.childReclaimCoordinatorClaims = (() => new Map([['a', 1]])) as never;
    await pass(c, [rec('a')], LIVE);
    expect(c.ccd).toEqual([]);
  });

  it('an unreadable .supervised keeps the row however old the other evidence is', async () => {
    const h = harness();
    await twoPasses(h, [rec('a', { lifecycleUnmeasured: ['supervised'] })], LIVE);
    expect(h.ccd).toEqual([]);
  });
});
