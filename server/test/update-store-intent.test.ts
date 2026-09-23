// Centralised update management W2 (design 2026-09-20 §6 "Journal", §9, §12),
// the intent store: `update_intent` + `update_epoch` and the flat-file journal
// under them. `pool-edges-store.test.ts`'s doctrine, applied to intent: the
// journal is appended INSIDE the transaction, BEFORE the commit, and the next
// epoch is MAX(file, db) + 1 — so an epoch is SKIPPED, NEVER REISSUED. Every
// refusal is a distinct return arm decided before the transaction opens (§18 "a
// refusing write never returns void"), and a journal that cannot be read or
// written is a result arm, never a throw past the method.
import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  FLEET_SCOPE, UPDATE_STORE_REFUSE_CODES, isUpdateStoreRefuseCode, type UpdateStoreRefuseCode,
} from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type SetIntentResult, type UpdateIntentPatch } from '../src/coord/store.js';
import { UpdateIntentLog, defaultUpdateIntentLogPath, type UpdateIntentLogEntry } from '../src/coord/updateintentlog.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_000_000_000_000;
const NODE_A = '01234567-89ab-cdef-0123-456789abcdef';
const NODE_B = 'fedcba98-7654-3210-fedc-ba9876543210';
const SEED = { scope: '*', channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel', setAt: 0, setBy: 'migration' };

const fresh = () => {
  const d = mkTmp('ccrc-update-intent-');
  return { store: new CoordStore(openCoordDb(path.join(d, 'coord.db'))),
           log: new UpdateIntentLog(path.join(d, 'update-intent.log')), dir: d };
};

/** A live node row, written by the store's own measurement writer (Task 5), so
 *  a node scope is real in the way the intent route will find it. */
const measured = (nodeId: string, label: string): NodeMeasurement => ({
  nodeId, role: 'fleet', label,
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main',
  currentBuiltAt: '2026-09-22T00:00:00Z', currentDirty: false,
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  os: 'linux', measuredAt: NOW, report: null,
});
const withNode = (store: CoordStore, nodeId: string, label = 'fleet'): void => {
  expect(store.upsertNodeMeasurement(measured(nodeId, label)).ok).toBe(true);
};
/** Fixture-only raw SQL — a token a newer build wrote, a restored snapshot. */
const raw = (store: CoordStore, sql: string): void => { store.db.prepare(sql).run(); };
const journal = (log: UpdateIntentLog): unknown[] =>
  readFileSync(log.logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as unknown);
const entry = (epoch: number): UpdateIntentLogEntry => ({
  epoch, scope: FLEET_SCOPE, channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel', setBy: 'pwa', at: epoch,
});

// `setIntent`'s refusal words live in the ONE update-store vocabulary (ruling
// R5: `UPDATE_STORE_REFUSE_CODES`, Task 4's array, appended to by Tasks 5 and
// 6) — so the check runs ONE way: every arm is declared there. The reverse
// ("every code is emitted by setIntent") is false by design, the array holding
// Tasks 4's and 5's words too. `SET_INTENT_WHYS` is this test's own list of the
// six arms, held equal to the union BOTH ways at compile time, so the runtime
// case below checks every arm and not a subset. Compile-checked by
// `typecheck-tests.test.ts`; asserted below so the lines are read.
type SetIntentWhy = Extract<SetIntentResult, { ok: false }>['why'];
const SET_INTENT_WHYS = ['empty-patch', 'bad-field', 'unknown-scope', 'no-channel',
  'journal-unreadable', 'journal-unwritable'] as const satisfies readonly SetIntentWhy[];
const everyWhyListed: [Exclude<SetIntentWhy, (typeof SET_INTENT_WHYS)[number]>] extends [never] ? true : never = true;
const everyWhyDeclared: [Exclude<SetIntentWhy, UpdateStoreRefuseCode>] extends [never] ? true : never = true;

describe('UpdateIntentLog — the journal on its own', () => {
  it('defaultUpdateIntentLogPath is <ccrcDir>/update-intent.log', () => {
    const ccrcDir = path.join('fixture-home', '.ccrc');
    expect(defaultUpdateIntentLogPath(ccrcDir)).toBe(path.join(ccrcDir, 'update-intent.log'));
  });

  it('a missing file is null — no intent was ever journalled', () => {
    expect(fresh().log.maxEpoch()).toBeNull();
  });

  it('append creates the parent, writes one NDJSON line per entry, and maxEpoch reads the max across every line', () => {
    const log = new UpdateIntentLog(path.join(mkTmp('ccrc-update-intent-'), 'nested', '.ccrc', 'update-intent.log'));
    log.append(entry(1));
    log.append(entry(4));
    log.append(entry(2));
    expect(log.maxEpoch()).toBe(4);
    expect(journal(log)).toEqual([entry(1), entry(4), entry(2)]);
  });

  it('A TORN FINAL LINE STILL COUNTS — a crash mid-append must not resurrect its epoch', () => {
    const { log } = fresh();
    log.append(entry(1));
    appendFileSync(log.logPath, '{"epoch":7,"scope":"*","chan');   // no newline, no close
    expect(log.maxEpoch()).toBe(7);
  });

  it('an UNREADABLE log throws — it must fail the write, never read as empty', () => {
    const dir = mkTmp('ccrc-update-intent-');
    mkdirSync(path.join(dir, 'update-intent.log'));                 // a DIRECTORY at the path: EISDIR
    expect(() => new UpdateIntentLog(path.join(dir, 'update-intent.log')).maxEpoch()).toThrow();
  });

  it('an EXISTING zero-length file THROWS rather than answering null', () => {
    const { log } = fresh();
    writeFileSync(log.logPath, '');
    expect(() => log.maxEpoch()).toThrow(/yields no epoch/);
  });

  it('EXISTING content with no "epoch":<digits> anywhere THROWS, same as zero-length', () => {
    const { log } = fresh();
    writeFileSync(log.logPath, 'not json, no epoch key here\n');
    expect(() => log.maxEpoch()).toThrow(/yields no epoch/);
  });
});

describe('setIntent — accepted writes', () => {
  it('the seed row is the fleet default and the epoch starts at 0', () => {
    const { store } = fresh();
    expect(store.intents()).toEqual([SEED]);
    expect(store.updateEpoch()).toEqual({ epoch: 0, issuedAt: 0 });
  });

  it('a patch changes only the fields it names, stamps setAt/setBy, and bumps the epoch once per write', () => {
    const { store, log } = fresh();
    const want = { scope: '*', channel: 'dev', pinnedTag: null, auto: 'off', notify: 'channel', setAt: NOW, setBy: 'pwa' };
    expect(store.setIntent(FLEET_SCOPE, { channel: 'dev' }, log, NOW)).toEqual({ ok: true, epoch: 1, row: want });
    expect(store.intentFor(FLEET_SCOPE)).toEqual(want);
    expect(store.updateEpoch()).toEqual({ epoch: 1, issuedAt: NOW });
    expect(store.setIntent(FLEET_SCOPE, { notify: 'stable' }, log, NOW + 5)).toMatchObject({ ok: true, epoch: 2 });
    expect(store.intentFor(FLEET_SCOPE)).toEqual({ ...want, notify: 'stable', setAt: NOW + 5 });
    expect(store.updateEpoch()).toEqual({ epoch: 2, issuedAt: NOW + 5 });
  });

  it('APPENDS THE JOURNAL — one line per write, carrying the whole resulting row under its epoch', () => {
    const { store, log } = fresh();
    store.setIntent(FLEET_SCOPE, { channel: 'dev' }, log, NOW);
    store.setIntent(FLEET_SCOPE, { auto: 'channel' }, log, NOW + 1);
    expect(journal(log)).toEqual([
      { epoch: 1, scope: '*', channel: 'dev', pinnedTag: null, auto: 'off', notify: 'channel', setBy: 'pwa', at: NOW },
      { epoch: 2, scope: '*', channel: 'dev', pinnedTag: null, auto: 'channel', notify: 'channel', setBy: 'pwa', at: NOW + 1 },
    ]);
  });

  it('pinnedTag: a tag pins, an absent field leaves the pin standing, and null clears it', () => {
    const { store, log } = fresh();
    store.setIntent(FLEET_SCOPE, { pinnedTag: 'v0.0.9' }, log, NOW);
    expect(store.intentFor(FLEET_SCOPE)?.pinnedTag).toBe('v0.0.9');
    store.setIntent(FLEET_SCOPE, { auto: 'off' }, log, NOW + 1);
    expect(store.intentFor(FLEET_SCOPE)?.pinnedTag).toBe('v0.0.9');
    store.setIntent(FLEET_SCOPE, { pinnedTag: null }, log, NOW + 2);
    expect(store.intentFor(FLEET_SCOPE)?.pinnedTag).toBeNull();
  });

  it("a node scope's first write takes its absent fields from '*' AS IT STANDS THEN — and does not follow '*' afterwards", () => {
    const { store, log } = fresh();
    withNode(store, NODE_A);
    store.setIntent(FLEET_SCOPE, { channel: 'dev', notify: 'stable', pinnedTag: 'v0.0.9' }, log, NOW);
    expect(store.setIntent(NODE_A, { auto: 'off' }, log, NOW + 1)).toEqual({
      ok: true, epoch: 2,
      row: { scope: NODE_A, channel: 'dev', pinnedTag: 'v0.0.9', auto: 'off', notify: 'stable', setAt: NOW + 1, setBy: 'pwa' },
    });
    store.setIntent(FLEET_SCOPE, { channel: 'stable', pinnedTag: null }, log, NOW + 2);
    expect(store.intentFor(NODE_A)).toMatchObject({ channel: 'dev', pinnedTag: 'v0.0.9' });
    expect(store.intents().map((i) => i.scope)).toEqual(['*', NODE_A]);   // '*' (0x2A) sorts first
  });

  it("an existing node row is patched in place — it does not re-inherit from '*'", () => {
    const { store, log } = fresh();
    withNode(store, NODE_A);
    store.setIntent(NODE_A, { channel: 'dev' }, log, NOW);                // inherits notify 'channel'
    store.setIntent(FLEET_SCOPE, { notify: 'off' }, log, NOW + 1);
    store.setIntent(NODE_A, { auto: 'off' }, log, NOW + 2);
    expect(store.intentFor(NODE_A)).toMatchObject({ channel: 'dev', notify: 'channel', setAt: NOW + 2 });
  });

  it('recovery takes MAX(journal, db): a journal ahead of the db SKIPS its epochs, never reissues them', () => {
    const { store, log } = fresh();
    // A crash between append and commit: the journal is ahead.
    writeFileSync(log.logPath, JSON.stringify(entry(9)) + '\n');
    expect(store.setIntent(FLEET_SCOPE, { channel: 'dev' }, log, NOW)).toMatchObject({ ok: true, epoch: 10 });
    expect(store.updateEpoch()).toEqual({ epoch: 10, issuedAt: NOW });
  });

  it('a db ahead of an ABSENT journal moves forward from the db', () => {
    const { store, log } = fresh();
    raw(store, 'UPDATE update_epoch SET epoch = 5, issuedAt = 1 WHERE id = 1');
    expect(existsSync(log.logPath)).toBe(false);
    expect(store.setIntent(FLEET_SCOPE, { channel: 'dev' }, log, NOW)).toMatchObject({ ok: true, epoch: 6 });
  });
});

describe('setIntent — every refusal is its own arm, decided before the transaction, and leaves no journal line', () => {
  const untouched = (store: CoordStore, log: UpdateIntentLog): void => {
    expect(existsSync(log.logPath), 'a refused write journalled a line').toBe(false);
    expect(store.updateEpoch()).toEqual({ epoch: 0, issuedAt: 0 });
    expect(store.intents()).toEqual([SEED]);
  };

  it('an empty patch — no field, or every field undefined — is empty-patch', () => {
    const { store, log } = fresh();
    expect(store.setIntent(FLEET_SCOPE, {}, log, NOW)).toEqual({ ok: false, why: 'empty-patch' });
    expect(store.setIntent(FLEET_SCOPE, { channel: undefined, pinnedTag: undefined }, log, NOW))
      .toEqual({ ok: false, why: 'empty-patch' });
    untouched(store, log);
  });

  // The route hands the store parsed JSON; the patch's type is a claim about the
  // caller, not a measurement of it — so each value is checked as `unknown`.
  const BAD: [keyof UpdateIntentPatch, Record<string, unknown>][] = [
    ['channel', { channel: 'nightly' }],
    ['channel', { channel: 'Stable' }],
    ['pinnedTag', { pinnedTag: '0.0.9' }],
    ['pinnedTag', { pinnedTag: 'v0.0.9 ' }],
    ['pinnedTag', { pinnedTag: '' }],
    ['auto', { auto: 'always' }],
    ['auto', { channel: 'dev', auto: 1 }],
    ['notify', { notify: 'loud' }],
  ];
  it.each(BAD)('an out-of-vocabulary %s is bad-field naming it — %j', (field, patch) => {
    const { store, log } = fresh();
    expect(store.setIntent(FLEET_SCOPE, patch as unknown as UpdateIntentPatch, log, NOW))
      .toEqual({ ok: false, why: 'bad-field', field });
    untouched(store, log);
  });

  it("a scope that is neither '*' nor a LIVE node row is unknown-scope — a superseded row included", () => {
    const { store, log } = fresh();
    expect(store.setIntent(NODE_A, { channel: 'dev' }, log, NOW))
      .toEqual({ ok: false, why: 'unknown-scope', scope: NODE_A });
    withNode(store, NODE_B, 'fleet-b');
    raw(store, `UPDATE nodes SET supersededBy = '${NODE_A}' WHERE nodeId = '${NODE_B}'`);
    expect(store.setIntent(NODE_B, { channel: 'dev' }, log, NOW))
      .toEqual({ ok: false, why: 'unknown-scope', scope: NODE_B });
    untouched(store, log);
  });

  // D-3194: `rekeyNode` carries the `nodes` row and its
  // refusals to the UUID, never an `update_intent` row (setIntent is its one
  // writer) — so intent under a label would be orphaned by the re-key and the
  // node would silently fall back to '*'. A node scope must be a measured id.
  it('a LIVE label-keyed row is unknown-scope — a node scope must be a measured node-id, and the re-keyed id is accepted', () => {
    const { store, log } = fresh();
    withNode(store, 'fleet', 'fleet');                                // a pre-W1 node, keyed by its label
    expect(store.db.prepare("SELECT 1 AS one FROM nodes WHERE nodeId = 'fleet' AND supersededBy IS NULL").get(),
      'the fixture must plant a LIVE label-keyed row').toEqual({ one: 1 });
    expect(store.setIntent('fleet', { channel: 'dev' }, log, NOW))
      .toEqual({ ok: false, why: 'unknown-scope', scope: 'fleet' });
    untouched(store, log);
    // The way out: the first measured node-id re-keys the row, and that id is a scope.
    expect(store.rekeyNode('fleet', NODE_A)).toEqual({ ok: true, how: 'rekeyed', retired: 0, revived: false });
    expect(store.setIntent(NODE_A, { channel: 'dev' }, log, NOW)).toMatchObject({ ok: true, epoch: 1 });
  });

  it("a merge whose channel reads null is no-channel — never the fleet default, which would be fail-open", () => {
    const { store, log } = fresh();
    raw(store, "UPDATE update_intent SET channel = 'nightly' WHERE scope = '*'");   // a newer build's token
    expect(store.setIntent(FLEET_SCOPE, { auto: 'off' }, log, NOW))
      .toEqual({ ok: false, why: 'no-channel', scope: '*', base: '*' });
    withNode(store, NODE_A);
    expect(store.setIntent(NODE_A, { notify: 'off' }, log, NOW))
      .toEqual({ ok: false, why: 'no-channel', scope: NODE_A, base: '*' });
    expect(existsSync(log.logPath), 'a refused write journalled a line').toBe(false);
    // Naming a channel is the way out, and it writes a token the vocabulary knows.
    expect(store.setIntent(FLEET_SCOPE, { channel: 'stable' }, log, NOW)).toMatchObject({ ok: true, epoch: 1 });
    expect(store.intentFor(FLEET_SCOPE)?.channel).toBe('stable');
  });

  it("a node row's OWN unreadable channel is no-channel with that row as the base — '*' is never consulted", () => {
    const { store, log } = fresh();
    withNode(store, NODE_A);
    expect(store.setIntent(NODE_A, { channel: 'dev' }, log, NOW)).toMatchObject({ ok: true, epoch: 1 });
    raw(store, `UPDATE update_intent SET channel = 'nightly' WHERE scope = '${NODE_A}'`);
    expect(store.setIntent(NODE_A, { auto: 'off' }, log, NOW + 1))
      .toEqual({ ok: false, why: 'no-channel', scope: NODE_A, base: NODE_A });
    expect(store.updateEpoch().epoch).toBe(1);
  });

  // D3 (final fix wave): a refusal decided BEFORE `tx()` opens must never
  // touch the journal at all — not `maxEpoch()`, not `append()`. A log that
  // COUNTS and THROWS on both proves it more strongly than `existsSync`
  // above: `existsSync` cannot tell "never called" from "called and its
  // throw was swallowed". Mutation: move the refusal checks (empty-patch,
  // bad-field, unknown-scope, no-channel) to AFTER `log.maxEpoch()` inside
  // the transaction — this reds on the first case (`maxEpochCalls` becomes 1).
  class CountingThrowingLog {
    readonly logPath = path.join('never-used', 'update-intent.log');
    maxEpochCalls = 0;
    appendCalls = 0;
    maxEpoch(): number | null { this.maxEpochCalls += 1; throw new Error('must not be called'); }
    append(): void { this.appendCalls += 1; throw new Error('must not be called'); }
  }

  it('an empty patch and an unknown scope never call the journal — a counting/throwing log proves it', () => {
    const { store } = fresh();
    const log = new CountingThrowingLog() as unknown as UpdateIntentLog;
    expect(store.setIntent(FLEET_SCOPE, {}, log, NOW)).toEqual({ ok: false, why: 'empty-patch' });
    expect((log as unknown as CountingThrowingLog).maxEpochCalls).toBe(0);
    expect((log as unknown as CountingThrowingLog).appendCalls).toBe(0);
    expect(store.setIntent(NODE_A, { channel: 'dev' }, log, NOW))
      .toEqual({ ok: false, why: 'unknown-scope', scope: NODE_A });
    expect((log as unknown as CountingThrowingLog).maxEpochCalls).toBe(0);
    expect((log as unknown as CountingThrowingLog).appendCalls).toBe(0);
  });
});

// A journal fake that WRITES inside the still-open transaction and then fails:
// the probe row must be gone afterwards, which is what proves the transaction
// rolled back rather than merely "nothing had been written yet".
class WritingThenThrowingLog {
  readonly logPath = path.join('never-written', 'update-intent.log');
  constructor(private readonly db: DatabaseSync) {}
  maxEpoch(): number | null { return null; }
  append(): void {
    this.db.prepare(
      "INSERT INTO update_intent (scope, channel, pinnedTag, auto, notify, setAt, setBy) " +
      "VALUES ('rollback-probe', 'stable', NULL, 'off', 'channel', 0, 'migration')",
    ).run();
    throw new Error('disk full');
  }
}

describe('setIntent — a journal that cannot be read or written is a result arm, and the transaction rolls back', () => {
  it('an UNREADABLE journal is journal-unreadable — never read as empty, never thrown past the method', () => {
    const { store, log } = fresh();
    writeFileSync(log.logPath, JSON.stringify(entry(3)) + '\n');
    // 0o200 (write-only), not 0o000 — `pool-edges-store.test.ts`'s measured
    // reason: only `maxEpoch`'s own read can fail here, so a mutated reader that
    // swallows the error is not rescued by `append` failing one line later.
    chmodSync(log.logPath, 0o200);
    const r = store.setIntent(FLEET_SCOPE, { channel: 'dev' }, log, NOW);
    if (r.ok || r.why !== 'journal-unreadable') throw new Error(`expected journal-unreadable, got ${JSON.stringify(r)}`);
    expect(r.detail).toMatch(/EACCES/);
    expect(store.updateEpoch()).toEqual({ epoch: 0, issuedAt: 0 });
    expect(store.intentFor(FLEET_SCOPE)?.channel).toBe('stable');
  });

  it('a zero-length journal is journal-unreadable — existing-but-empty is not absent', () => {
    const { store, log } = fresh();
    writeFileSync(log.logPath, '');
    const r = store.setIntent(FLEET_SCOPE, { channel: 'dev' }, log, NOW);
    if (r.ok || r.why !== 'journal-unreadable') throw new Error(`expected journal-unreadable, got ${JSON.stringify(r)}`);
    expect(r.detail).toMatch(/yields no epoch/);
    expect(store.updateEpoch().epoch).toBe(0);
  });

  it('an UNWRITABLE journal is journal-unwritable and commits nothing', () => {
    const { store, log } = fresh();
    writeFileSync(log.logPath, JSON.stringify(entry(3)) + '\n');
    chmodSync(log.logPath, 0o400);                                   // readable: maxEpoch answers 3; append is refused
    const r = store.setIntent(FLEET_SCOPE, { channel: 'dev' }, log, NOW);
    if (r.ok || r.why !== 'journal-unwritable') throw new Error(`expected journal-unwritable, got ${JSON.stringify(r)}`);
    expect(r.detail).toMatch(/EACCES/);
    expect(store.updateEpoch()).toEqual({ epoch: 0, issuedAt: 0 });
    expect(store.intents()).toEqual([SEED]);
  });

  it('a throw from append after a write inside the transaction is a result — and the write is rolled back', () => {
    const { store } = fresh();
    expect(store.setIntent(FLEET_SCOPE, { channel: 'dev' }, new WritingThenThrowingLog(store.db), NOW))
      .toEqual({ ok: false, why: 'journal-unwritable', detail: 'disk full' });
    expect(store.intents()).toEqual([SEED]);                          // the probe row is gone
    expect(store.updateEpoch()).toEqual({ epoch: 0, issuedAt: 0 });
  });
});

// `pool-edges-store.test.ts`'s F1 fakes, re-aimed: `setIntent` takes the log as
// a parameter, so a fake whose `append()` reads the SAME db observes the world
// from INSIDE the still-open transaction.
class ObservingLog {
  readonly logPath = path.join('never-written', 'update-intent.log');
  seen: { channel: string; epoch: number; entry: UpdateIntentLogEntry } | null = null;
  constructor(private readonly db: DatabaseSync) {}
  maxEpoch(): number | null { return null; }
  append(e: UpdateIntentLogEntry): void {
    const channel = (this.db.prepare("SELECT channel FROM update_intent WHERE scope = '*'").get() as { channel: string }).channel;
    const epoch = (this.db.prepare('SELECT epoch FROM update_epoch WHERE id = 1').get() as { epoch: number }).epoch;
    this.seen = { channel, epoch, entry: e };
  }
}
// The CONTROL: the same connection DOES see a row written inside the
// transaction — without it, `channel: 'stable'` above could mean "uncommitted
// rows are invisible here" rather than "append ran before the upsert".
class InsertingControlLog {
  readonly logPath = path.join('never-written', 'update-intent.log');
  before: number | null = null;
  after: number | null = null;
  constructor(private readonly db: DatabaseSync) {}
  maxEpoch(): number | null { return null; }
  append(): void {
    const count = (): number => (this.db.prepare('SELECT COUNT(*) AS n FROM update_intent').get() as { n: number }).n;
    this.before = count();
    this.db.prepare(
      "INSERT INTO update_intent (scope, channel, pinnedTag, auto, notify, setAt, setBy) " +
      "VALUES ('control-probe', 'stable', NULL, 'off', 'channel', 0, 'migration')",
    ).run();
    this.after = count();
  }
}

describe('journal-before-commit is OBSERVABLE, not just orderable', () => {
  it('append sees the row and the epoch as they were — before the upsert and before the epoch row', () => {
    const { store } = fresh();
    const observer = new ObservingLog(store.db);
    expect(store.setIntent(FLEET_SCOPE, { channel: 'dev' }, observer, NOW)).toMatchObject({ ok: true, epoch: 1 });
    expect(observer.seen).toEqual({
      channel: 'stable', epoch: 0,
      entry: { epoch: 1, scope: '*', channel: 'dev', pinnedTag: null, auto: 'off', notify: 'channel', setBy: 'pwa', at: NOW },
    });
    expect(store.intentFor(FLEET_SCOPE)?.channel).toBe('dev');
    expect(store.updateEpoch().epoch).toBe(1);
  });

  it('CONTROL: the same connection DOES see a row inserted inside the transaction', () => {
    const { store } = fresh();
    const control = new InsertingControlLog(store.db);
    store.setIntent(FLEET_SCOPE, { channel: 'dev' }, control, NOW);
    expect([control.before, control.after]).toEqual([1, 2]);
  });
});

describe('intent reads', () => {
  it('out-of-vocabulary tokens read through the named fallbacks (D-3181)', () => {
    const { store } = fresh();
    raw(store, "UPDATE update_intent SET channel = 'nightly', auto = 'sometimes', notify = 'loud', pinnedTag = '0.0.9' WHERE scope = '*'");
    // channel → null (never the fleet default); auto → off (nothing unattended);
    // notify → channel (hear of more, never of nothing); a malformed pin is still
    // a pin — the resolver finds it ineligible rather than reading "unpinned".
    const want = { scope: '*', channel: null, pinnedTag: '0.0.9', auto: 'off', notify: 'channel', setAt: 0, setBy: 'migration' };
    expect(store.intentFor(FLEET_SCOPE)).toEqual(want);
    expect(store.intents()).toEqual([want]);
  });

  it('intentFor answers null for a scope with no row — a different answer from a row whose channel reads null', () => {
    const { store } = fresh();
    expect(store.intentFor(NODE_A)).toBeNull();
  });

  it("setIntent's refusal words are declared, once each, in the ONE update-store vocabulary (ruling R5)", () => {
    expect([everyWhyListed, everyWhyDeclared]).toEqual([true, true]);
    for (const c of SET_INTENT_WHYS) expect(isUpdateStoreRefuseCode(c), c).toBe(true);
    // Appended once — a second copy of a word (or a sibling task's word
    // re-appended) is a duplicate the guard alone would never notice.
    expect(new Set(UPDATE_STORE_REFUSE_CODES).size, 'a word is declared twice').toBe(UPDATE_STORE_REFUSE_CODES.length);
    expect(isUpdateStoreRefuseCode('journal-missing')).toBe(false);
    expect(isUpdateStoreRefuseCode(null)).toBe(false);
  });
});
