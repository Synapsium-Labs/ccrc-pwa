// `reloadRoster` (D-5518, D-5513; accounts plan Task A12): the server's one way to take a roster the fleet box
// answered. It refuses another fleet's roster, swaps `cfg.roster`, writes the controller's mirror atomically, lets the
// fleet-health agreement be recomputed, and feeds A10's fingerprint table: the fingerprints every answer carries are
// ingested, and a removed lane's rows are deleted. Reconcile runs the `roster` sub after any account op that errors
// or times out, and records it.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { SECRET_MASK } from '../../shared/api.js';
import { parseRoster } from '../../shared/roster.js';
import { generateAccountsSh } from '../../shared/generate.mjs';
import { bodyDigest } from '../../shared/mark.mjs';
import { loadConfig, reloadRoster, rosterAnswerOf, type CcrcConfig, type RosterAnswer } from '../src/config.js';
import { SecretMasker, fingerprintGeneration, fingerprintRow, type FingerprintAnswer } from '../src/accounts/mask.js';
import { reconcilingAccountOps } from '../src/accounts/reconcile.js';
import type { AccountOpResult, AccountOps } from '../src/accounts/ops.js';
import { AccountAudit } from '../src/accounts/audit.js';
import { openCoordDb } from '../src/coord/db.js';
import { buildServer } from '../src/server.js';
import type { FleetState } from '../src/fleetstate.js';
import { DEFAULT_TEST_ROSTER, seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NODE = '11111111-2222-4333-8444-555555555555';
const OTHER_NODE = '99999999-2222-4333-8444-555555555555';
const TOKEN = 'box-token-for-the-roster-reload-suite';
/** A compatible key: no credential shape, so only its fingerprint can mask it. Assembled at run time. */
const KEY_A = ['compat', 'q'.repeat(18), '7Hd2'].join('-');
const KEY_D = ['compat', 'r'.repeat(18), '9Kp4'].join('-');

/** The default roster plus one lane, `claude-e`, so a reload has something to change. */
const GROWN = {
  ...DEFAULT_TEST_ROSTER,
  accounts: [...DEFAULT_TEST_ROSTER.accounts, {
    id: 'claude-e', label: 'claude-e', configDirSuffix: '.claude-e',
    exec: { kind: 'generated', secretsFile: '.cc-secrets/claude-e-oauth.env' },
    homeAble: true, hue: 'amber', telemetry: 'anthropic',
  }],
};
/** The default roster without `claude-d`. */
const SHRUNK = { ...DEFAULT_TEST_ROSTER, accounts: DEFAULT_TEST_ROSTER.accounts.filter((a) => a.id !== 'claude-d') };

const remoteCfg = (): CcrcConfig => {
  const home = mkTmp('ccrc-roster-reload-');
  seedRoster(home);
  return loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
};
const mirrorOf = (cfg: CcrcConfig): string => cfg.accountsPath;
const answerOf = (roster: unknown, over: Partial<RosterAnswer> = {}): RosterAnswer =>
  ({ roster, fleetIdentity: NODE, fingerprints: null, ...over });
const fps = (token: string, rows: [string, string][]): FingerprintAnswer =>
  ({ gen: fingerprintGeneration(token), rows: rows.map(([lane, key]) => fingerprintRow(token, lane, key)) });

const maskers: SecretMasker[] = [];
const maskerOver = (db: DatabaseSync, token: () => string, requestRekey?: () => Promise<FingerprintAnswer | null>): SecretMasker => {
  const m = new SecretMasker({ db, token, ...(requestRekey ? { requestRekey } : {}), log: () => {} });
  maskers.push(m);
  return m;
};
const rowsIn = (db: DatabaseSync): { laneId: string; gen: string }[] =>
  db.prepare('SELECT laneId, gen FROM secret_fingerprints ORDER BY laneId').all() as unknown as { laneId: string; gen: string }[];

afterEach(() => { for (const m of maskers.splice(0)) m.close(); });

describe('reloadRoster (D-5518)', () => {
  it('a roster from another fleet identity is refused and nothing changes', () => {
    const cfg = remoteCfg();
    const before = readFileSync(mirrorOf(cfg), 'utf8');
    const roster = cfg.roster;
    const r = reloadRoster(cfg, answerOf(GROWN, { fleetIdentity: OTHER_NODE }), { fleetIdentity: () => NODE });
    expect(r).toEqual({ ok: false, why: 'fleet-identity' });
    expect(cfg.roster).toBe(roster);
    expect(readFileSync(mirrorOf(cfg), 'utf8')).toBe(before);
    // An answer that names no fleet, and a server that knows none, are refused the same way.
    expect(reloadRoster(cfg, answerOf(GROWN, { fleetIdentity: null }), { fleetIdentity: () => NODE }).ok).toBe(false);
    expect(reloadRoster(cfg, answerOf(GROWN), { fleetIdentity: () => null }).ok).toBe(false);
    expect(cfg.roster).toBe(roster);
  });

  it('a roster that does not parse is refused and nothing changes', () => {
    const cfg = remoteCfg();
    const roster = cfg.roster;
    const r = reloadRoster(cfg, answerOf({ version: 1, accounts: [{ id: 'Bad Id' }] }), { fleetIdentity: () => NODE });
    expect(r).toEqual({ ok: false, why: 'roster-invalid' });
    expect(cfg.roster).toBe(roster);
  });

  it('a good roster swaps `cfg.roster`, writes the mirror 0644 and recomputes `ownRosterFp`', async () => {
    const cfg = remoteCfg();
    const home = cfg.home;
    const fleetFp = bodyDigest(generateAccountsSh(parseRoster(GROWN)));
    const fleetState = { connected: true, downSince: null, rosterFp: fleetFp, build: null, ccdVerbs: null } as unknown as FleetState;
    const app = await buildServer({ ...testDeps(home), cfg, fleetState });
    try {
      const health = async (): Promise<unknown> => (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json<{ roster: unknown }>().roster;
      expect(await health()).toBe('divergent');
      const inoBefore = statSync(mirrorOf(cfg)).ino;
      const r = reloadRoster(cfg, answerOf(GROWN), { fleetIdentity: () => NODE });
      expect(r).toEqual({ ok: true, changed: true });
      expect(cfg.roster.byId.has('claude-e')).toBe(true);
      const st = statSync(mirrorOf(cfg));
      expect(st.mode & 0o777).toBe(0o644);
      // Atomic: a new file renamed over the old, so a reader mid-write sees the old file or the new one, never half.
      expect(st.ino).not.toBe(inoBefore);
      expect(JSON.parse(readFileSync(mirrorOf(cfg), 'utf8'))).toEqual(GROWN);
      expect(readdirSync(path.dirname(mirrorOf(cfg))).filter((n) => n.includes('.tmp'))).toEqual([]);
      expect(await health()).toBe('agreed');
      // The same roster again changes nothing and rewrites nothing.
      const inoAfter = st.ino;
      expect(reloadRoster(cfg, answerOf(GROWN), { fleetIdentity: () => NODE })).toEqual({ ok: true, changed: false });
      expect(statSync(mirrorOf(cfg)).ino).toBe(inoAfter);
    } finally {
      await app.close();
    }
  });

  it('in local mode the roster file is the box\'s own and is never rewritten by the server', () => {
    const home = mkTmp('ccrc-roster-reload-local-');
    seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home });
    const ino = statSync(cfg.accountsPath).ino;
    const before = readFileSync(cfg.accountsPath, 'utf8');
    expect(reloadRoster(cfg, answerOf(GROWN), { fleetIdentity: () => NODE })).toEqual({ ok: true, changed: true });
    expect(cfg.roster.byId.has('claude-e')).toBe(true);
    expect(statSync(cfg.accountsPath).ino).toBe(ino);
    expect(readFileSync(cfg.accountsPath, 'utf8')).toBe(before);
  });

  it('`rosterAnswerOf` reads a verb\'s answer, and refuses one with no roster', () => {
    const fp = fps(TOKEN, [['claude-a', KEY_A]]);
    expect(rosterAnswerOf(JSON.stringify({ ok: true, roster: GROWN, fleetIdentity: NODE, fingerprints: fp })))
      .toEqual({ roster: GROWN, fleetIdentity: NODE, fingerprints: fp });
    expect(rosterAnswerOf(JSON.stringify({ ok: true, roster: GROWN, fleetIdentity: NODE })))
      .toEqual({ roster: GROWN, fleetIdentity: NODE, fingerprints: null });
    expect(rosterAnswerOf(JSON.stringify({ ok: true, lane: 'claude-a' }))).toBeNull();
    expect(rosterAnswerOf('not json')).toBeNull();
  });
});

describe('fingerprint ingestion (D-5513, A10\'s table)', () => {
  const dbAt = (): DatabaseSync => openCoordDb(path.join(mkTmp('ccrc-roster-fp-'), 'coord.db'));

  it('a roster answer\'s fingerprints land in `secret_fingerprints` with the current generation', () => {
    const cfg = remoteCfg();
    const db = dbAt();
    const masker = maskerOver(db, () => TOKEN);
    expect(masker.maskText(`key ${KEY_A} end`)).toContain(KEY_A);
    const r = reloadRoster(cfg, answerOf(DEFAULT_TEST_ROSTER, { fingerprints: fps(TOKEN, [['claude-a', KEY_A]]) }),
      { fleetIdentity: () => NODE, fingerprints: masker });
    expect(r.ok).toBe(true);
    expect(rowsIn(db)).toEqual([{ laneId: 'claude-a', gen: fingerprintGeneration(TOKEN) }]);
    const shown = masker.maskText(`key ${KEY_A} end`);
    expect(shown).not.toContain(KEY_A);
    expect(shown).toContain(SECRET_MASK);
  });

  it('a removed lane\'s row is deleted', () => {
    const cfg = remoteCfg();
    const db = dbAt();
    const masker = maskerOver(db, () => TOKEN);
    expect(masker.ingest(fps(TOKEN, [['claude-a', KEY_A], ['claude-d', KEY_D]]))).toBe(true);
    expect(rowsIn(db).map((r) => r.laneId)).toEqual(['claude-a', 'claude-d']);
    reloadRoster(cfg, answerOf(SHRUNK), { fleetIdentity: () => NODE, fingerprints: masker });
    expect(rowsIn(db).map((r) => r.laneId)).toEqual(['claude-a']);
    expect(masker.maskText(`key ${KEY_D} end`)).toContain(KEY_D);
    // A lane the roster keeps but whose entry names no secret file holds no row either.
    expect(masker.ingest(fps(TOKEN, [['claude-b', KEY_D]]))).toBe(true);
    reloadRoster(cfg, answerOf(SHRUNK), { fleetIdentity: () => NODE, fingerprints: masker });
    expect(rowsIn(db).map((r) => r.laneId)).toEqual(['claude-a']);
  });

  it('a refused roster ingests nothing and deletes nothing', () => {
    const cfg = remoteCfg();
    const db = dbAt();
    const masker = maskerOver(db, () => TOKEN);
    masker.ingest(fps(TOKEN, [['claude-a', KEY_A], ['claude-d', KEY_D]]));
    reloadRoster(cfg, answerOf(SHRUNK, { fleetIdentity: OTHER_NODE, fingerprints: fps(TOKEN, [['claude-e', KEY_A]]) }),
      { fleetIdentity: () => NODE, fingerprints: masker });
    expect(rowsIn(db).map((r) => r.laneId)).toEqual(['claude-a', 'claude-d']);
  });

  it('a re-key deletes old-generation rows only for the lanes the answer names, and keeps masking the rest', async () => {
    const db = dbAt();
    let token = TOKEN;
    const NEXT = `${TOKEN}-rotated`;
    // The box answers the re-key without `claude-d` (its secret file unreadable at that moment, say).
    const rekey = (): Promise<FingerprintAnswer | null> => Promise.resolve(fps(NEXT, [['claude-a', KEY_A]]));
    const masker = maskerOver(db, () => token, rekey);
    masker.ingest(fps(TOKEN, [['claude-a', KEY_A], ['claude-d', KEY_D]]));
    token = NEXT;
    masker.fingerprintMax();   // reads the holder: the rotation is seen and the re-key asked for
    await new Promise((r) => setTimeout(r, 20));
    expect(rowsIn(db)).toEqual([
      { laneId: 'claude-a', gen: fingerprintGeneration(NEXT) },
      { laneId: 'claude-d', gen: fingerprintGeneration(TOKEN) },
    ]);
    expect(masker.maskText(`a ${KEY_A} d ${KEY_D}`)).not.toMatch(/7Hd2|9Kp4/);
  });

  it('a locked coord.db holds ingest for at most its short busy timeout, and the answer lands once the lock is gone', async () => {
    const dbPath = path.join(mkTmp('ccrc-roster-busy-'), 'coord.db');
    const db = openCoordDb(dbPath);
    const masker = maskerOver(db, () => TOKEN);
    const cfg = remoteCfg();
    const other = new DatabaseSync(dbPath);
    other.exec('BEGIN IMMEDIATE');
    try {
      const t0 = Date.now();
      const r = reloadRoster(cfg, answerOf(DEFAULT_TEST_ROSTER, { fingerprints: fps(TOKEN, [['claude-a', KEY_A]]) }),
        { fleetIdentity: () => NODE, fingerprints: masker });
      expect(Date.now() - t0).toBeLessThan(1_000);
      expect(r.ok).toBe(true);   // the roster itself is taken; the fingerprints follow when the database frees
    } finally {
      other.exec('COMMIT');
      other.close();
    }
    const deadline = Date.now() + 5_000;
    while (rowsIn(db).length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(rowsIn(db)).toEqual([{ laneId: 'claude-a', gen: fingerprintGeneration(TOKEN) }]);
    // The connection's own timeout is back where every other writer expects it.
    expect((db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout).toBe(5000);
  }, 15_000);
});

describe('reconcile (D-5518)', () => {
  const setup = (answer: (sub: string) => AccountOpResult) => {
    const cfg = remoteCfg();
    mkdirSync(path.join(cfg.home, '.ccrc'), { recursive: true });
    const db = openCoordDb(path.join(cfg.home, '.ccrc', 'coord.db'));
    const calls: string[] = [];
    const inner: AccountOps = { arm: 'remote', run: async (sub) => { calls.push(sub); return answer(sub); } };
    const ops = reconcilingAccountOps(inner, {
      reload: (a) => reloadRoster(cfg, a, { fleetIdentity: () => NODE }),
      audit: new AccountAudit(db), fleetIdentity: () => NODE,
    });
    const events = (): { act: string; laneId: string | null; outcome: string }[] =>
      db.prepare('SELECT act, laneId, outcome FROM account_events ORDER BY id').all() as never;
    return { cfg, calls, ops, events };
  };
  const rosterAnswer = (roster: unknown): AccountOpResult =>
    ({ kind: 'exited', code: 0, stdout: JSON.stringify({ ok: true, roster, fleetIdentity: NODE }) });

  it('a failed op triggers one `roster` sub and a `reconcile` row', async () => {
    for (const failed of [{ kind: 'timeout' }, { kind: 'lost' }, { kind: 'too-large' },
      { kind: 'exited', code: 1, stdout: '{"ok":false,"code":"lane-busy"}' }] as AccountOpResult[]) {
      const s = setup((sub) => sub === 'roster' ? rosterAnswer(GROWN) : failed);
      const r = await s.ops.run('check', 'claude-a', {});
      expect(r).toEqual(failed);
      expect(s.calls, failed.kind).toEqual(['check', 'roster']);
      expect(s.events(), failed.kind).toEqual([{ act: 'reconcile', laneId: 'claude-a', outcome: 'ok' }]);
      expect(s.cfg.roster.byId.has('claude-e'), failed.kind).toBe(true);
    }
  });

  it('a refusal before anything ran reconciles nothing', async () => {
    for (const nothing of [{ kind: 'refused', why: 'bad-id' }, { kind: 'unsupported' }, { kind: 'not-started' }] as AccountOpResult[]) {
      const s = setup((sub) => sub === 'roster' ? rosterAnswer(GROWN) : nothing);
      await s.ops.run('check', 'claude-a', {});
      expect(s.calls, nothing.kind).toEqual(['check']);
      expect(s.events(), nothing.kind).toEqual([]);
    }
  });

  it('a reconcile whose `roster` sub fails is recorded as failed, and is not retried on its own', async () => {
    const s = setup(() => ({ kind: 'timeout' }));
    await s.ops.run('enable', 'claude-a', {});
    expect(s.calls).toEqual(['enable', 'roster']);
    expect(s.events()).toEqual([{ act: 'reconcile', laneId: 'claude-a', outcome: 'failed' }]);
  });

  it('a mutating sub\'s answer feeds `reloadRoster` with no extra `roster` sub', async () => {
    const s = setup((sub) => sub === 'set' ? rosterAnswer(GROWN) : { kind: 'timeout' });
    const r = await s.ops.run('set', 'claude-a', {});
    expect(r.kind).toBe('exited');
    expect(s.calls).toEqual(['set']);
    expect(s.cfg.roster.byId.has('claude-e')).toBe(true);
    expect(s.events()).toEqual([]);
  });

  it('a roster that disagrees with the fleet\'s is reconciled, once per disagreement', async () => {
    const s = setup((sub) => sub === 'roster' ? rosterAnswer(GROWN) : { kind: 'timeout' });
    await s.ops.reconcileDivergence('fleet-fp-1');
    await s.ops.reconcileDivergence('fleet-fp-1');
    expect(s.calls).toEqual(['roster']);
    expect(s.events()).toEqual([{ act: 'reconcile', laneId: null, outcome: 'ok' }]);
    expect(s.cfg.roster.byId.has('claude-e')).toBe(true);
  });
});
