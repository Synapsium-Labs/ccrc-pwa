// The disk lanes' shadow journal (D-6861): the three unarmed lanes' verdicts are kept in `coord.db`, once
// per key across a restart, pruned by age and by size, and read back through one read-only route. Fixture HOMEs only;
// nothing here reaches a box and no arming marker is created.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { Bus } from '../src/bus.js';
import { NO_SESSION } from '../src/auth/gate.js';
import { recordExpireFeed } from '../src/coord/expireArchived.js';
import { recordNestedRescueShadow } from '../src/coord/nestedRescueShadow.js';
import { decideShadowJournalQuery, journalShadowVerdict } from '../src/coord/shadowJournal.js';
import { STALE_ARCHIVE_SIGHTING_GAP_MS } from '../src/archivedExpiry.js';
import { staleArchivePass, type StaleArchiveDeps } from '../src/coord/staleArchive.js';
import type { SessionRecord } from '../src/registry.js';
import {
  SHADOW_JOURNAL_MAX_AGE_MS, SHADOW_JOURNAL_MAX_ROWS, shadowVerdictKey, type ShadowVerdictInput,
} from '../../shared/shadowJournal.js';
import { ACTOR_FLAGS_CAP, ARCHIVE_IF_NO_PANE_CAP } from '../src/ccdargv.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const DAY = 86_400_000;
const NOW = 1_790_000_000_000;
/** The read's clock: after the rows a test writes at NOW, inside their retention. */
const LATER = NOW + 20_000;
const v = (over: Partial<ShadowVerdictInput> = {}): ShadowVerdictInput => ({
  lane: 'nested-rescue', subject: 's1', path: '<tree>/repo-a', epoch: '7', rung: 'reclaim:rescue', bytes: null, inodes: null, detail: 'a nested repository would be rescued', ...over,
});
const open = (file: string): CoordStore => new CoordStore(openCoordDb(file));

describe('CoordStore.recordShadowVerdict', () => {
  it('writes a verdict once per key, and a restart on the same file does not write it again', () => {
    const file = path.join(mkTmp('ccrc-shadow-'), '.ccrc', 'coord.db');
    const a = open(file);
    expect(a.recordShadowVerdict(v(), NOW)).toBe(true);
    expect(a.recordShadowVerdict(v(), NOW + 1000)).toBe(false);
    const b = open(file);
    expect(b.recordShadowVerdict(v(), NOW + 2000)).toBe(false);
    expect(b.recordShadowVerdict(v({ path: '<tree>/repo-b' }), NOW + 2000)).toBe(true);
    const rows = b.shadowVerdicts({ lane: null, subject: null, limit: 10 }, LATER);
    expect(rows.map((r) => [r.path, r.at, r.rung])).toEqual([['<tree>/repo-b', NOW + 2000, 'reclaim:rescue'], ['<tree>/repo-a', NOW, 'reclaim:rescue']]);
    expect(rows[1]!.key).toBe(shadowVerdictKey(v()));
  });

  it('prunes by age, and keeps only the newest SHADOW_JOURNAL_MAX_ROWS', () => {
    const s = open(path.join(mkTmp('ccrc-shadow-'), '.ccrc', 'coord.db'));
    s.recordShadowVerdict(v({ epoch: 'old' }), NOW);
    s.recordShadowVerdict(v({ epoch: 'new' }), NOW + SHADOW_JOURNAL_MAX_AGE_MS + 1);
    expect(s.shadowVerdicts({ lane: null, subject: null, limit: 10 }, LATER).map((r) => r.key)).toEqual([shadowVerdictKey(v({ epoch: 'new' }))]);
    for (let i = 0; i < SHADOW_JOURNAL_MAX_ROWS + 3; i++) s.recordShadowVerdict(v({ epoch: `e${i}` }), NOW + SHADOW_JOURNAL_MAX_AGE_MS + 10 + i);
    expect(s.shadowVerdicts({ lane: null, subject: null, limit: 1000 }, LATER)).toHaveLength(1000);
    const n = (s as unknown as { db: { prepare: (q: string) => { get: () => { n: number } } } }).db.prepare('SELECT COUNT(*) AS n FROM shadow_journal').get().n;
    expect(n).toBe(SHADOW_JOURNAL_MAX_ROWS);
  });

  it('filters by lane and subject, and redacts what it stores', () => {
    const s = open(path.join(mkTmp('ccrc-shadow-'), '.ccrc', 'coord.db'));
    s.recordShadowVerdict(v({ lane: 'stale-archive', subject: 'a', path: null, detail: 'x' }), NOW);
    s.recordShadowVerdict(v({ subject: 'b', detail: 'token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 leaked' }), NOW + 1);
    expect(s.shadowVerdicts({ lane: 'stale-archive', subject: null, limit: 10 }, LATER).map((r) => r.subject)).toEqual(['a']);
    expect(s.shadowVerdicts({ lane: null, subject: 'b', limit: 10 }, LATER)[0]!.detail).not.toContain('abcdefghijklmnop');
  });

  it('redacts a secret-shaped token in a path from both stored columns, path and key (D-6861)', () => {
    const s = open(path.join(mkTmp('ccrc-shadow-'), '.ccrc', 'coord.db'));
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    s.recordShadowVerdict(v({ path: `<tree>/${secret}/repo` }), NOW);
    const raw = (s as unknown as { db: { prepare: (q: string) => { all: () => { key: string; path: string }[] } } })
      .db.prepare('SELECT key, path FROM shadow_journal').all();
    expect(raw).toHaveLength(1);
    expect(raw[0]!.path).toContain('<tree>/');
    expect(raw[0]!.path).not.toContain('abcdefghijklmnop');
    expect(raw[0]!.key).not.toContain('abcdefghijklmnop');
    expect(raw[0]!.key).toBe(shadowVerdictKey(v({ path: raw[0]!.path })));
  });

  it('a read never answers a row older than the retention, though no write has pruned it (D-6861)', () => {
    const s = open(path.join(mkTmp('ccrc-shadow-'), '.ccrc', 'coord.db'));
    s.recordShadowVerdict(v(), NOW);
    expect(s.shadowVerdicts({ lane: null, subject: null, limit: 10 }, NOW + SHADOW_JOURNAL_MAX_AGE_MS)).toHaveLength(1);
    expect(s.shadowVerdicts({ lane: null, subject: null, limit: 10 }, NOW + SHADOW_JOURNAL_MAX_AGE_MS + 1)).toEqual([]);
  });

  it('journalShadowVerdict never throws: a closed database costs the row only', () => {
    const s = open(path.join(mkTmp('ccrc-shadow-'), '.ccrc', 'coord.db'));
    (s as unknown as { db: { close: () => void } }).db.close();
    expect(journalShadowVerdict(s, v(), NOW)).toBe(false);
  });
});

describe('decideShadowJournalQuery', () => {
  it('defaults, and refuses what it cannot read', () => {
    expect(decideShadowJournalQuery({})).toEqual({ ok: true, lane: null, subject: null, limit: 200 });
    expect(decideShadowJournalQuery({ lane: 'expire-child', limit: '5' })).toMatchObject({ ok: true, lane: 'expire-child', limit: 5 });
    for (const q of [{ lane: 'orphan-tree' }, { limit: '0' }, { limit: '1001' }, { limit: 'x' }, { subject: '' }]) {
      expect(decideShadowJournalQuery(q).ok, JSON.stringify(q)).toBe(false);
    }
  });
});

describe('the three lanes write their verdicts', () => {
  it('nested-rescue: one row per path, and a refusal asked again is not a second row', () => {
    const coord = open(path.join(mkTmp('ccrc-shadow-'), '.ccrc', 'coord.db'));
    const row = { sessionId: 's1', runId: 4, key: '4', who: 's1, child of run #4', count: 2, paths: ['<tree>/a', '<tree>/b'],
      rung: 'reclaim:rescue' as const };
    recordNestedRescueShadow({ coord }, row);
    recordNestedRescueShadow({ coord }, row);
    const rows = coord.shadowVerdicts({ lane: 'nested-rescue', subject: null, limit: 10 }, LATER);
    expect(rows.map((r) => r.path).sort()).toEqual(['<tree>/a', '<tree>/b']);
    expect(rows[0]!.subject).toBe('s1');
    // The rung is the caller's: the expiry ladder's refusal of the same session says so, as a row of its own.
    recordNestedRescueShadow({ coord }, { ...row, key: '900', count: 1, paths: ['<tree>/a'], rung: 'expire:rescue' });
    expect(coord.shadowVerdicts({ lane: 'nested-rescue', subject: null, limit: 10 }, LATER).map((r) => r.rung).sort())
      .toEqual(['expire:rescue', 'reclaim:rescue', 'reclaim:rescue']);
    recordNestedRescueShadow({ coord }, { ...row, key: '5', count: 0, paths: [] });
    expect(coord.shadowVerdicts({ lane: null, subject: null, limit: 10 }, LATER)).toHaveLength(3);
  });

  it('expire-child: a child held by its arm alone is journalled; an ordinary archive and an unarmed lane\'s child are not', () => {
    const coord = open(path.join(mkTmp('ccrc-shadow-'), '.ccrc', 'coord.db'));
    const base = { sessionId: 's2', archivedAt: 1000, expiresAt: 2000, sensitive: 0 } as const;
    recordExpireFeed({ coord, notifyLog: undefined }, { kind: 'would-expire', child: true, childArmHeld: true, ...base }, false);
    recordExpireFeed({ coord, notifyLog: undefined }, { kind: 'would-expire', child: true, childArmHeld: true, ...base }, false);
    recordExpireFeed({ coord, notifyLog: undefined }, { kind: 'would-expire', ...base, sessionId: 's3' }, false);
    recordExpireFeed({ coord, notifyLog: undefined }, { kind: 'would-expire', child: true, ...base, sessionId: 's4' }, false);
    const rows = coord.shadowVerdicts({ lane: null, subject: null, limit: 10 }, LATER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lane: 'expire-child', subject: 's2', rung: 'child-shadow', path: null });
  });

  it('stale-archive: the shadow pass journals each due row once, and the journal outlives the in-memory dedupe', async () => {
    const coord = open(path.join(mkTmp('ccrc-shadow-'), '.ccrc', 'coord.db'));
    const rec = { id: 'a', wrapper: 'lane-a', project: 'project-a', workdir: '/w/a', uuid: 'u-a', workspace: 'ws-a', archivedAt: null,
      held: null, child: { kind: 'none' }, unmeasured: [], spawn: null, supervisedAt: null, hibernatedAt: null, lifecycleUnmeasured: [] } as unknown as SessionRecord;
    let now = NOW;
    const deps = {
      coord: { childReclaimCoordinatorClaims: () => new Map(), openCoordinatorIds: () => [], lifecycleFor: () => [],
        recordShadowVerdict: (x: ShadowVerdictInput, n: number) => coord.recordShadowVerdict(x, n) },
      viewers: { isVisible: () => false }, notice: () => {}, runCcd: async () => { throw new Error('shadow composes nothing'); },
      fleetState: { ccdVerbs: ['ws-archive', ARCHIVE_IF_NO_PANE_CAP, ACTOR_FLAGS_CAP] }, pane: async () => 'absent', transcriptMtimeMs: async () => NOW - 15 * DAY, wokeAtMs: async () => null,
      listRegistry: async () => ({ ok: true, entries: [] }), rowNow: async (r: SessionRecord) => r, queueRun: (_id: string, fn: () => unknown) => fn(),
      log: () => {}, now: () => now,
    } as unknown as StaleArchiveDeps;
    const run = async (mem: Parameters<typeof staleArchivePass>[1]) => { await staleArchivePass(deps, mem, [rec], []); now += STALE_ARCHIVE_SIGHTING_GAP_MS + 1; await staleArchivePass(deps, mem, [rec], []); };
    await run({ sightings: new Map(), would: new Set(), failed: new Map() });
    await run({ sightings: new Map(), would: new Set(), failed: new Map() });
    const rows = coord.shadowVerdicts({ lane: 'stale-archive', subject: null, limit: 10 }, LATER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subject: 'a', rung: 'archive-if-no-pane' });
  });
});

describe('GET /api/coord/shadow-journal', () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => { while (apps.length) await apps.pop()!.close(); });
  const rig = (withCoord = true) => {
    const home = mkTmp('ccrc-shadow-route-');
    const coord = open(path.join(home, '.ccrc', 'coord.db'));
    const base = testDeps(home);
    const app = Fastify();
    registerCoordRoutes(app, { ...base, ...(withCoord ? { coord } : {}) }, new Bus(), () => NO_SESSION,
      { tmux: base.tmux, queue: base.queue, readAsk: async () => null }, undefined);
    apps.push(app);
    return { app, coord };
  };

  it('answers the rows newest first, filtered, and refuses a bad query', async () => {
    const { app, coord } = rig();
    // The route reads at the wall clock, so the rows are written at it (older than the retention, they are not answered).
    const at = Date.now();
    coord.recordShadowVerdict(v({ lane: 'stale-archive', subject: 'a', path: null }), at);
    coord.recordShadowVerdict(v({ path: '<tree>/a' }), at + 1);
    const all = await app.inject({ method: 'GET', url: '/api/coord/shadow-journal' });
    expect(all.statusCode).toBe(200);
    expect((all.json() as { rows: { lane: string }[] }).rows.map((r) => r.lane)).toEqual(['nested-rescue', 'stale-archive']);
    const one = await app.inject({ method: 'GET', url: '/api/coord/shadow-journal?lane=stale-archive&limit=1' });
    expect((one.json() as { rows: unknown[] }).rows).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/coord/shadow-journal?lane=nope' })).statusCode).toBe(400);
  });

  it('is read only, and 501 without coordination', async () => {
    const { app } = rig(false);
    expect((await app.inject({ method: 'GET', url: '/api/coord/shadow-journal' })).statusCode).toBe(501);
    expect((await app.inject({ method: 'POST', url: '/api/coord/shadow-journal', payload: {} })).statusCode).toBe(404);
  });
});
