// D-8399 (plan docs/superpowers/plans/2026-11-12-test-box-ledger-values.md; amends TC12 of the test box connect plan): a
// settings act's ledger row records each changed setting's old and new value, every value read through that setting's own
// typed reader (`fitsTestboxShape`, the L0 copy of `_tb_shape`), so a row still holds no free text; a secret-bearing setting,
// and every class the readers show only as set or not set (a path, an address, a list), records presence only. Here: the
// contract's value rules and stored-change reader, the ledger writer and reader over a real coord.db, the staged changes of a
// long act, and the migration that adds both. The route's and the lane's halves are in `testbox-admin-routes.test.ts` and
// `testbox-admin-lane.test.ts`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  TESTBOX_BOX_KEYS, TESTBOX_HOST_KEYS, TESTBOX_LEDGER_VALUE_MAX, TESTBOX_SECRET_BEARING_KEYS, TESTBOX_SHAPE_CLASS,
  readTestboxLedgerChanges, testboxLedgerShowsValue, testboxLedgerValueOf, testboxLedgerValueOfRow,
} from '../../shared/testbox-admin.js';
import { COORD_SCHEMA_VERSION, openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { actorOf } from '../src/accounts/audit.js';
import { TestboxAudit } from '../src/testboxAudit.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); removeTmpFixtures(); });

const NODE = '0a17a17a-0000-4000-8000-0000000012c1';
const ACT_ID = 'c'.repeat(32);
const DAY_MS = 86_400_000;
const actor = actorOf('a test phone', 'ab'.repeat(32));
const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');
const ledger = (now: () => number = Date.now): { db: DatabaseSync; audit: TestboxAudit } => {
  const db = openCoordDb(dbPathIn(mkTmp('ccrc-testbox-ledger-values-')));
  return { db, audit: new TestboxAudit(db, now) };
};

describe('the ledger value of one setting (D-8399)', () => {
  it('a non-secret value-class setting records its value, read through its own shape', () => {
    expect(testboxLedgerValueOf('CCRC_TESTBOX_BUDGET', '45m')).toEqual({ value: '45m' });
    expect(testboxLedgerValueOf('CCRC_TESTBOX_WORKERS', '3')).toEqual({ value: '3' });
    expect(testboxLedgerValueOf('CCRC_TESTBOX_LOST_RUN', 'fail')).toEqual({ value: 'fail' });
    expect(testboxLedgerValueOf('CCRC_TESTBOX_RUN_CPU_QUOTA', '200%')).toEqual({ value: '200%' });
    // off its shape it is no value at all
    expect(testboxLedgerValueOf('CCRC_TESTBOX_BUDGET', 'soon')).toEqual({ presence: 'unknown' });
    expect(testboxLedgerValueOf('CCRC_TESTBOX_WORKERS', '3; rm -rf /')).toEqual({ presence: 'unknown' });
    // bounded: a long run of digits its shape allows records as set
    expect(testboxLedgerValueOf('CCRC_TESTBOX_BUDGET', `${'9'.repeat(TESTBOX_LEDGER_VALUE_MAX)}m`)).toEqual({ presence: 'set' });
    expect(testboxLedgerValueOf('CCRC_TESTBOX_BUDGET', '')).toEqual({ presence: 'not-set' });
    expect(testboxLedgerValueOf('CCRC_TESTBOX_BUDGET', null)).toEqual({ presence: 'not-set' });
  });

  it('a secret-bearing setting, and every path, address or list, records presence only and never its value', () => {
    expect([...TESTBOX_SECRET_BEARING_KEYS].sort()).toEqual(['CCRC_TESTBOX_GIT_KEY', 'CCRC_TESTBOX_SERVICE_TOKEN_FILE', 'CCRC_TESTBOX_TOKEN_FILE']);
    for (const k of TESTBOX_SECRET_BEARING_KEYS) {
      expect(testboxLedgerShowsValue(k), k).toBe(false);
      expect(testboxLedgerValueOf(k, '/root/.ccrc/testbox-token'), k).toEqual({ presence: 'set' });
    }
    for (const [k, v] of [
      ['CCRC_TESTBOX_ROOT', '/srv/box'], ['CCRC_TESTBOX_URL', 'http://10.0.0.9:7790'], ['CCRC_TESTBOX_LISTEN', '10.0.0.9:7790'],
      ['CCRC_TESTBOX_DENY_GLOBS', '*.pem .env'], ['CCRC_TESTBOX_EGRESS_ALLOW', 'registry.npmjs.org'], ['CCRC_TESTBOX_PRISTINE_RETRY', '1m 5m'],
    ] as const) expect(testboxLedgerValueOf(k, v), k).toEqual({ presence: 'set' });
    // the rule covers all 47 keys: a value only for a key whose readers show one, and no secret-bearing key among them
    const shown = [...TESTBOX_HOST_KEYS, ...TESTBOX_BOX_KEYS].filter(testboxLedgerShowsValue);
    for (const k of shown) expect(['url', 'path', 'hostport', 'globs', 'hosts', 'envnames', 'durations']).not.toContain(TESTBOX_SHAPE_CLASS[k]);
    expect(shown.filter((k) => TESTBOX_SECRET_BEARING_KEYS.includes(k))).toEqual([]);
    expect(testboxLedgerShowsValue('CCRC_PORT')).toBe(false);
  });

  it('a reader row records what the reader says: a value, set, not set, or unknown', () => {
    expect(testboxLedgerValueOfRow('CCRC_TESTBOX_WORKERS', { key: 'CCRC_TESTBOX_WORKERS', state: 'ok', value: '2', from: 'file' } as never)).toEqual({ value: '2' });
    expect(testboxLedgerValueOfRow('CCRC_TESTBOX_RUNS', { key: 'CCRC_TESTBOX_RUNS', state: 'ok', value: '2', from: 'default' } as never)).toEqual({ value: '2' });
    expect(testboxLedgerValueOfRow('CCRC_TESTBOX_ROOT', { key: 'CCRC_TESTBOX_ROOT', state: 'ok', from: 'file' } as never)).toEqual({ presence: 'set' });
    expect(testboxLedgerValueOfRow('CCRC_TESTBOX_ROOT', { key: 'CCRC_TESTBOX_ROOT', state: 'ok', from: 'default' } as never)).toEqual({ presence: 'not-set' });
    expect(testboxLedgerValueOfRow('CCRC_TESTBOX_WORKERS', { key: 'CCRC_TESTBOX_WORKERS', state: 'refused', from: 'file', why: 'on or off' } as never)).toEqual({ presence: 'unknown' });
    expect(testboxLedgerValueOfRow('CCRC_TESTBOX_WORKERS', undefined)).toEqual({ presence: 'unknown' });
    // a reader that carried a secret-bearing key's value still records presence only
    expect(testboxLedgerValueOfRow('CCRC_TESTBOX_SERVICE_TOKEN_FILE', { key: 'CCRC_TESTBOX_SERVICE_TOKEN_FILE', state: 'ok', value: '/var/lib/t', from: 'file' } as never)).toEqual({ presence: 'set' });
  });
});

describe('the stored changes reader (D-8399)', () => {
  const good = [
    { key: 'CCRC_TESTBOX_BUDGET', old: { value: '30m' }, new: { value: '45m' } },
    { key: 'CCRC_TESTBOX_DENY_GLOBS', old: { presence: 'set' }, new: { presence: 'default' } },
  ];
  it('takes a list of typed changes', () => {
    expect(readTestboxLedgerChanges(good)).toEqual(good);
  });
  it('refuses free text, a secret value, an unknown key, a repeat, an extra field and an empty or overlong list', () => {
    const bad: unknown[] = [
      [], null, 'x', [{ ...good[0], why: 'free text' }], [{ key: 'CCRC_TESTBOX_BUDGET', old: { value: 'soon' }, new: { value: '45m' } }],
      [{ key: 'CCRC_TESTBOX_TOKEN_FILE', old: { presence: 'set' }, new: { value: '/root/t' } }],
      [{ key: 'CCRC_TESTBOX_ROOT', old: { value: '/srv/box' }, new: { presence: 'set' } }],
      [{ key: 'CCRC_PORT', old: { value: '1' }, new: { value: '2' } }], [good[0], good[0]],
      [{ key: 'CCRC_TESTBOX_BUDGET', old: { value: '30m', presence: 'set' }, new: { value: '45m' } }],
      [{ key: 'CCRC_TESTBOX_BUDGET', old: { presence: 'maybe' }, new: { value: '45m' } }],
      Array.from({ length: TESTBOX_BOX_KEYS.length + 1 }, (_, i) => ({ key: `CCRC_TESTBOX_K${i}`, old: { presence: 'set' }, new: { presence: 'set' } })),
    ];
    for (const b of bad) expect(readTestboxLedgerChanges(b), JSON.stringify(b)).toBeNull();
  });
});

describe('the ledger writer and reader carry changes (D-8399)', () => {
  const changes = [{ key: 'CCRC_TESTBOX_BUDGET', old: { value: '30m' }, new: { value: '45m' } }] as const;
  const row = { act: 'settings-fleet', outcome: 'ok', fleetIdentity: NODE, actor } as const;

  it('an ok settings row is written with its changes and read back typed', () => {
    const { audit } = ledger();
    expect(audit.write({ ...row, changes }).ok).toBe(true);
    expect(audit.write({ ...row }).ok).toBe(true);
    const [plain, changed] = audit.recent(10);
    expect(changed!.changes).toEqual(changes);
    expect('changes' in plain!).toBe(false);
  });

  it('refuses changes on a row that did not end ok, on an act that changes no setting, or off the reader', () => {
    const { db, audit } = ledger();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const e of [
      { ...row, outcome: 'refused', code: 'key-in-ccrc-env', changes }, { ...row, act: 'repair', changes },
      { ...row, changes: [{ key: 'CCRC_TESTBOX_GIT_KEY', old: { presence: 'set' }, new: { value: '/root/k' } }] },
      { ...row, changes: [] },
    ]) expect(audit.write(e as never), JSON.stringify(e)).toEqual({ ok: false, why: 'changes' });
    expect((db.prepare('SELECT COUNT(*) AS n FROM testbox_events').get() as { n: number }).n).toBe(0);
  });

  it('a stored value the reader refuses is read as no changes, never shown', () => {
    const { db, audit } = ledger();
    db.prepare("INSERT INTO testbox_events (at, actor, act, outcome, fleetIdentity, changes) VALUES (1, 'a 00000000', 'settings-fleet', 'ok', NULL, ?)")
      .run(JSON.stringify([{ key: 'CCRC_TESTBOX_TOKEN_FILE', old: { value: '/root/secret' }, new: { presence: 'set' } }]));
    db.prepare("INSERT INTO testbox_events (at, actor, act, outcome, fleetIdentity, changes) VALUES (2, 'a 00000000', 'settings-fleet', 'ok', NULL, 'not json')").run();
    const rows = audit.recent(10);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect('changes' in r).toBe(false);
    expect(JSON.stringify(rows)).not.toContain('/root/secret');
  });

  it('a long act\'s changes are staged by its id, taken by its end row, and dropped by any end row', () => {
    const { db, audit } = ledger();
    const box = [{ key: 'CCRC_TESTBOX_WORKERS', old: { value: '2' }, new: { value: '4' } }];
    expect(audit.stage(ACT_ID, box)).toBe(true);
    expect(audit.staged(ACT_ID)).toEqual(box);
    expect(audit.staged('d'.repeat(32))).toBeUndefined();
    expect(audit.write({ act: 'settings-box', actId: ACT_ID, outcome: 'ok', changes: audit.staged(ACT_ID), fleetIdentity: NODE, actor }).ok).toBe(true);
    expect(audit.staged(ACT_ID)).toBeUndefined();
    expect(audit.recent(1)[0]!.changes).toEqual(box);
    // a failed end row writes no changes and still drops what was staged
    const other = 'e'.repeat(32);
    audit.stage(other, box);
    expect(audit.write({ act: 'settings-box', actId: other, outcome: 'failed', code: 'idle-deadline', fleetIdentity: NODE, actor }).ok).toBe(true);
    expect(audit.staged(other)).toBeUndefined();
    expect((db.prepare('SELECT COUNT(*) AS n FROM testbox_staged_changes').get() as { n: number }).n).toBe(0);
  });

  it('staging refuses what the reader refuses and a bad act id; staged rows are swept with the ledger', () => {
    let now = 400 * DAY_MS;
    const { db, audit } = ledger(() => now);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(audit.stage('not-an-id', [{ key: 'CCRC_TESTBOX_WORKERS', old: { value: '2' }, new: { value: '4' } }])).toBe(false);
    expect(audit.stage(ACT_ID, [{ key: 'CCRC_TESTBOX_GIT_KEY', old: { value: '/k' }, new: { value: '/k2' } }] as never)).toBe(false);
    now = 10 * DAY_MS;
    expect(audit.stage(ACT_ID, [{ key: 'CCRC_TESTBOX_WORKERS', old: { value: '2' }, new: { value: '4' } }])).toBe(true);
    audit.sweep(400 * DAY_MS);
    expect((db.prepare('SELECT COUNT(*) AS n FROM testbox_staged_changes').get() as { n: number }).n).toBe(0);
  });
});

describe('the migration: testbox_events.changes and testbox_staged_changes (D-8399)', () => {
  const SLOT = MIGRATIONS.findIndex((m) => /CREATE TABLE testbox_staged_changes(?![A-Za-z0-9_])/.test(m)) + 1;
  const objectNames = (db: DatabaseSync): string[] =>
    (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'").all() as unknown as { name: string }[]).map((r) => r.name);

  it('is one entry after testbox_events, which adds one nullable column and one table, and nothing else', () => {
    const events = MIGRATIONS.findIndex((m) => /CREATE TABLE testbox_events(?![A-Za-z0-9_])/.test(m)) + 1;
    expect(SLOT).toBeGreaterThan(events);
    expect(MIGRATIONS.filter((m) => /testbox_staged_changes/.test(m))).toHaveLength(1);
    const p = dbPathIn(mkTmp('ccrc-mig-testbox-changes-'));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => { for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!); raw.exec(`PRAGMA user_version = ${SLOT - 1}`); });
    raw.prepare("INSERT INTO testbox_events (at, actor, act, outcome) VALUES (1, 'a 00000000', 'repair', 'ok')").run();
    const had = objectNames(raw);
    raw.exec(MIGRATIONS[SLOT - 1]!);
    raw.exec(`PRAGMA user_version = ${SLOT}`);
    expect(objectNames(raw).filter((n) => !had.includes(n))).toEqual(['testbox_staged_changes']);
    const cols = (raw.prepare('PRAGMA table_info(testbox_events)').all() as unknown as { name: string; notnull: number; dflt_value: unknown }[]);
    expect(cols.map((c) => c.name)).toEqual(['id', 'at', 'actor', 'act', 'actId', 'outcome', 'code', 'fingerprint', 'fleetIdentity', 'changes']);
    expect(cols.at(-1)).toMatchObject({ notnull: 0, dflt_value: null });
    // the row an older build wrote reads as having no changes
    expect(raw.prepare('SELECT changes FROM testbox_events').get()).toEqual({ changes: null });
    raw.close();
    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(COORD_SCHEMA_VERSION);
    expect('changes' in new TestboxAudit(db).recent(1)[0]!).toBe(false);
    db.close();
  });

  it('an older build\'s writer, which names its own columns, still writes on the migrated file', () => {
    const { db } = ledger();
    db.prepare('INSERT INTO testbox_events (at, actor, act, actId, outcome, code, fingerprint, fleetIdentity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(1, 'a 00000000', 'settings-fleet', null, 'ok', null, null, NODE);
    expect(db.prepare('SELECT changes FROM testbox_events').get()).toEqual({ changes: null });
  });
});
