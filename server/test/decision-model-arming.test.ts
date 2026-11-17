// Overlord W2, decision model B, Task 6: the arming store (`decision_rows`, `decision_host`, `decision_lines`, the anchor columns of
// `decision_days`, M19's read) in `server/src/coord/decisionModelStore.ts`, over a real `coord.db` and a real authority journal
// and guard in a fixture directory. Never the live HOME.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openCoordDb } from '../src/coord/db.js';
import { tx } from '../src/coord/tx.js';
import { OVERLORD_AUTHORITY_BASENAME } from '../src/coord/overlordAuthority.js';
import { OverlordAuthorityJournal, overlordAuthorityFileAt } from '../src/coord/overlordAuthorityJournal.js';
import { OverlordAuthorityGuard } from '../src/coord/overlordAuthorityGuard.js';
import {
  admitDecisionLine, currentDecisionLine, decisionHostRead, decisionLineById, decisionMeasures, decisionRowRead, decisionRowSideOf,
  moveDecisionRowInTx, recordAnchorRun, recordCanary, recordDecision, setDecisionHostInTx, settleDecisionCalls, UNREADABLE_GATE_SIDE,
  type DecisionLineWrite, type DecisionRowMove,
} from '../src/coord/decisionModelStore.js';
import { DECISION_CEILING_MAX, DECISION_CEILING_MIN, DECISION_QUESTIONS, DECISION_ROW_DEFAULT, DECISION_ROW_IDS, type DecisionRowSide } from '../../shared/decisionModel.js';
import { fakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => removeTmpFixtures());

const T0 = Date.parse('2026-11-16T10:00:00.000Z');
const OFF: DecisionRowSide = DECISION_ROW_DEFAULT;
const side = (o: Partial<DecisionRowSide> = {}): DecisionRowSide => ({ ...OFF, ...o });

interface Fx {
  dir: string; db: DatabaseSync; journal: OverlordAuthorityJournal; guard: OverlordAuthorityGuard; leaf: string;
  lines(): { kind: string; row: string; gate: boolean; from: DecisionRowSide; to: DecisionRowSide }[];
  head(): { sequence: number } | undefined;
  /** One move inside its own `tx()`. */
  move(m: Partial<DecisionRowMove> & Pick<DecisionRowMove, 'to'>): ReturnType<typeof moveDecisionRowInTx>;
}

let n = 0;
/** One migrated `coord.db`, made once and copied for each case: on a loaded box each fresh `openCoordDb` costs seconds of fsync. */
let template: Buffer;
beforeAll(() => {
  const file = path.join(mkTmp('ccrc-decision-arming-template-'), 'coord.db');
  openCoordDb(file).close();
  template = readFileSync(file);
});

/** A fixture box at the newest schema: a real `coord.db`, the authority journal beside it, and a guard told the boot verdict. */
function fx(): Fx {
  const dir = path.join(mkTmp('ccrc-decision-arming-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'coord.db'), template);
  const db = openCoordDb(path.join(dir, 'coord.db'));
  const leaf = path.join(dir, OVERLORD_AUTHORITY_BASENAME);
  const clock = fakeTime({ wallMs: T0 }).ports.clock;
  let journal!: OverlordAuthorityJournal;
  const guard = new OverlordAuthorityGuard({ healTornTail: () => journal.healTornTail(db), measure: () => journal.measure(db) });
  journal = new OverlordAuthorityJournal(overlordAuthorityFileAt(dir), { clock }, guard);
  guard.bootVerdict(journal.measure(db));
  return {
    dir, db, journal, guard, leaf,
    lines: () => (existsSync(leaf) ? readFileSync(leaf, 'utf8').split('\n').filter((l) => l !== '').map((l) => (JSON.parse(l) as { entry: never }).entry) : []),
    head: () => db.prepare('SELECT sequence FROM overlord_authority_head').get() as { sequence: number } | undefined,
    move: (m) => tx(db, () => moveDecisionRowInTx(db, journal, {
      row: 'relay.method', expected: OFF, heldCause: null, actor: 'device-a', at: T0, opKey: `op-${++n}`, ...m,
    })),
  };
}

let f: Fx;
beforeEach(() => { f = fx(); });

describe('the migration and the absent row', () => {
  it('writes no decision_rows row, no host and no line, and an absent row reads the default with no cause', () => {
    for (const t of ['decision_rows', 'decision_host', 'decision_lines']) {
      expect(f.db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get(), t).toEqual({ c: 0 });
    }
    for (const row of DECISION_ROW_IDS) {
      expect(decisionRowRead(f.db, row), row).toEqual({ kind: 'row', state: { ...DECISION_ROW_DEFAULT, heldCause: null } });
      expect(decisionRowSideOf(f.db, row), row).toEqual(DECISION_ROW_DEFAULT);
    }
    expect(DECISION_ROW_DEFAULT).toMatchObject({ mode: 'off', held: false, armedLine: null });
  });
});

describe('boot coherence: decision_rows is an authority table, never seeded', () => {
  it('a box at the new schema with no head row and no decision row boots coherent', () => {
    expect(f.journal.measure(f.db)).toEqual({ kind: 'coherent' });
    expect(f.guard.state()).toEqual({ kind: 'coherent' });
  });
  it('a decision_rows row with no head row and no journal reads rolled-back (missing): why the table is never seeded', () => {
    f.db.prepare(`INSERT INTO decision_rows (row, mode, ceiling, updatedAt, actor) VALUES ('relay.method', 'shadow', 600, 1, 'device-a')`).run();
    expect(f.journal.measure(f.db)).toEqual({ kind: 'rolled-back', cause: 'missing' });
  });
  it('a decision_host or decision_lines row alone does not (only the listed table counts)', () => {
    tx(f.db, () => setDecisionHostInTx(f.db, { kind: 'local', endpoint: 'http://127.0.0.1:9000/v1', origin: 'http://127.0.0.1:9000', modelId: 'model-a', keySetAt: null }, 'device-a', 1));
    admitDecisionLine(f.db, line());
    expect(f.journal.measure(f.db)).toEqual({ kind: 'coherent' });
  });
  it('a move through the writer leaves it coherent again: record and row together', () => {
    expect(f.move({ row: 'relay.method', to: side({ mode: 'shadow' }) })).toMatchObject({ ok: true, kind: 'appended' });
    expect(f.journal.measure(f.db)).toEqual({ kind: 'coherent' });
  });
});

describe('moveDecisionRowInTx: the journal record first, then the row, in one transaction', () => {
  it('outside a transaction it throws, and nothing is appended', () => {
    expect(() => moveDecisionRowInTx(f.db, f.journal, {
      row: 'relay.method', expected: OFF, to: side({ mode: 'shadow' }), heldCause: null, actor: 'device-a', at: T0, opKey: 'op-x',
    })).toThrow(/only inside the caller's tx\(\)/);
    expect(f.lines()).toEqual([]);
    expect(f.head()).toBeUndefined();
  });

  it('a first move on an absent row appends with from = the default, then writes the row and moves the head row', () => {
    const r = f.move({ row: 'relay.method', to: side({ mode: 'shadow', ceiling: 600 }), at: T0 + 5, actor: 'device-a' });
    expect(r).toEqual({ ok: true, kind: 'appended', state: { mode: 'shadow', ceiling: 600, armedLine: null, held: false, heldCause: null } });
    expect(f.lines()).toEqual([{ kind: 'authority-decision-row', opKey: expect.any(String), row: 'relay.method', gate: false,
      from: DECISION_ROW_DEFAULT, to: side({ mode: 'shadow' }) }]);
    expect(f.head()).toEqual({ sequence: 1 });
    expect(f.db.prepare('SELECT row, mode, ceiling, armedLineId, armedLineValue, heldCause, heldAt, updatedAt, actor FROM decision_rows').all())
      .toEqual([{ row: 'relay.method', mode: 'shadow', ceiling: 600, armedLineId: null, armedLineValue: null, heldCause: null, heldAt: null,
        updatedAt: T0 + 5, actor: 'device-a' }]);
    expect(decisionRowSideOf(f.db, 'relay.method')).toEqual(side({ mode: 'shadow' }));
  });

  it('the record states the gate by the catalogue (scope.widens true, relay.method false) and the second move chains from the row it wrote', () => {
    f.move({ row: 'scope.widens', to: side({ mode: 'shadow' }) });
    f.move({ row: 'scope.widens', expected: side({ mode: 'shadow' }), to: side({ mode: 'armed', armedLine: { id: 4, line: 0.9 } }) });
    f.move({ row: 'relay.method', to: side({ mode: 'shadow' }) });
    const ls = f.lines();
    expect(ls.map((l) => [l.row, l.gate])).toEqual([['scope.widens', true], ['scope.widens', true], ['relay.method', false]]);
    expect(ls[1]!.from).toEqual(side({ mode: 'shadow' }));
    expect(ls[1]!.to).toEqual(side({ mode: 'armed', armedLine: { id: 4, line: 0.9 } }));
    expect(f.head()).toEqual({ sequence: 3 });
    expect(f.db.prepare('SELECT armedLineId, armedLineValue FROM decision_rows WHERE row = ?').get('scope.widens')).toEqual({ armedLineId: 4, armedLineValue: 0.9 });
    expect(decisionRowRead(f.db, 'scope.widens')).toMatchObject({ kind: 'row', state: { mode: 'armed', armedLine: { id: 4, line: 0.9 } } });
  });

  it('row-changed: expected differs from the row, and nothing is appended or written', () => {
    f.move({ row: 'relay.method', to: side({ mode: 'shadow' }) });
    const before = { lines: f.lines().length, head: f.head() };
    for (const expected of [OFF, side({ mode: 'shadow', ceiling: 601 }), side({ mode: 'shadow', held: true }),
      side({ mode: 'shadow', armedLine: { id: 1, line: 0.9 } })]) {
      expect(f.move({ row: 'relay.method', expected, to: side({ mode: 'off' }) })).toEqual({ ok: false, error: 'row-changed' });
    }
    expect(f.lines()).toHaveLength(before.lines);
    expect(f.head()).toEqual(before.head);
    expect(decisionRowSideOf(f.db, 'relay.method')).toEqual(side({ mode: 'shadow' }));
  });

  it('row-changed on an absent row whose expected is not the default', () => {
    expect(f.move({ row: 'goals.conflict', expected: side({ mode: 'shadow' }), to: side({ mode: 'off' }) })).toEqual({ ok: false, error: 'row-changed' });
    expect(f.lines()).toEqual([]);
    expect(f.db.prepare('SELECT COUNT(*) AS c FROM decision_rows').get()).toEqual({ c: 0 });
  });

  it('a bad record (a ceiling out of bounds) answers bad-entry from the journal, writes no row, and appends nothing', () => {
    const r = f.move({ row: 'relay.method', to: side({ mode: 'shadow', ceiling: 49 }) });
    expect(r).toMatchObject({ ok: false, error: 'bad-entry' });
    expect(f.lines()).toEqual([]);
    expect(f.db.prepare('SELECT COUNT(*) AS c FROM decision_rows').get()).toEqual({ c: 0 });
  });

  describe('over a rolled-back guard', () => {
    beforeEach(() => { f.guard.writerFailed('ahead'); expect(f.guard.state()).toEqual({ kind: 'rolled-back', cause: 'ahead' }); });

    it('a widening (off to shadow) writes nothing and answers authority-rolled-back', () => {
      const r = f.move({ row: 'relay.method', to: side({ mode: 'shadow' }) });
      expect(r).toMatchObject({ ok: false, error: 'authority-rolled-back' });
      expect(f.db.prepare('SELECT COUNT(*) AS c FROM decision_rows').get()).toEqual({ c: 0 });
      expect(f.lines()).toEqual([]);
    });
    it('a narrowing (a lower ceiling) writes the row and answers row-only, with no record', () => {
      const r = f.move({ row: 'relay.method', to: side({ ceiling: 300 }) });
      expect(r).toMatchObject({ ok: true, kind: 'row-only', state: { ceiling: 300, mode: 'off' } });
      expect(f.lines()).toEqual([]);
      expect(f.head()).toBeUndefined();
      expect(decisionRowSideOf(f.db, 'relay.method')).toEqual(side({ ceiling: 300 }));
    });
  });

  describe('a hold: heldCause and heldAt', () => {
    beforeEach(() => { f.move({ row: 'relay.method', to: side({ mode: 'shadow' }) }); });
    const held = (): { heldCause: string | null; heldAt: number | null } =>
      f.db.prepare("SELECT heldCause, heldAt FROM decision_rows WHERE row = 'relay.method'").get() as never;

    it('a move to held with a cause stores the cause and the time', () => {
      const r = f.move({ row: 'relay.method', expected: side({ mode: 'shadow' }), to: side({ mode: 'shadow', held: true }), heldCause: 'drift', at: T0 + 100, actor: 'server' });
      expect(r).toMatchObject({ ok: true, state: { held: true, heldCause: 'drift' } });
      expect(held()).toEqual({ heldCause: 'drift', heldAt: T0 + 100 });
      expect(decisionRowRead(f.db, 'relay.method')).toMatchObject({ state: { held: true, heldCause: 'drift' } });
      expect(f.db.prepare("SELECT actor FROM decision_rows WHERE row = 'relay.method'").get()).toEqual({ actor: 'server' });
    });
    it('a later move that stays held with heldCause null keeps the cause and the first heldAt', () => {
      f.move({ row: 'relay.method', expected: side({ mode: 'shadow' }), to: side({ mode: 'shadow', held: true }), heldCause: 'drift', at: T0 + 100 });
      const r = f.move({ row: 'relay.method', expected: side({ mode: 'shadow', held: true }), to: side({ mode: 'shadow', held: true, ceiling: 300 }), heldCause: null, at: T0 + 900 });
      expect(r).toMatchObject({ ok: true, state: { held: true, heldCause: 'drift', ceiling: 300 } });
      expect(held()).toEqual({ heldCause: 'drift', heldAt: T0 + 100 });
      expect(f.db.prepare("SELECT updatedAt FROM decision_rows WHERE row = 'relay.method'").get()).toEqual({ updatedAt: T0 + 900 });
    });
    it('a held row given a new cause takes it, and keeps the first heldAt', () => {
      f.move({ row: 'relay.method', expected: side({ mode: 'shadow' }), to: side({ mode: 'shadow', held: true }), heldCause: 'drift', at: T0 + 100 });
      f.move({ row: 'relay.method', expected: side({ mode: 'shadow', held: true }), to: side({ mode: 'shadow', held: true }), heldCause: 'canary', at: T0 + 900 });
      expect(held()).toEqual({ heldCause: 'canary', heldAt: T0 + 100 });
    });
    it('a move off held clears both; a later hold is held from its own time', () => {
      f.move({ row: 'relay.method', expected: side({ mode: 'shadow' }), to: side({ mode: 'shadow', held: true }), heldCause: 'drift', at: T0 + 100 });
      f.move({ row: 'relay.method', expected: side({ mode: 'shadow', held: true }), to: side({ mode: 'shadow' }), heldCause: 'canary', at: T0 + 200 });
      expect(held()).toEqual({ heldCause: null, heldAt: null });
      f.move({ row: 'relay.method', expected: side({ mode: 'shadow' }), to: side({ mode: 'shadow', held: true }), heldCause: 'bound', at: T0 + 300 });
      expect(held()).toEqual({ heldCause: 'bound', heldAt: T0 + 300 });
    });
    it('a move to held with no cause on a row not held throws BEFORE anything is appended', () => {
      const lines = f.lines().length;
      const head = f.head();
      expect(() => f.move({ row: 'relay.method', expected: side({ mode: 'shadow' }), to: side({ mode: 'shadow', held: true }), heldCause: null }))
        .toThrow(/a move to held names its cause/);
      expect(f.lines()).toHaveLength(lines);
      expect(f.head()).toEqual(head);
      expect(held()).toEqual({ heldCause: null, heldAt: null });
      expect(f.guard.state()).toEqual({ kind: 'coherent' });
    });
  });

  describe('an unreadable row', () => {
    const plant = (sql: string): void => { f.db.exec(sql); };
    it.each([
      ['a heldCause out of the vocabulary', "INSERT INTO decision_rows (row, mode, ceiling, heldCause, heldAt, updatedAt, actor) VALUES ('relay.method', 'shadow', 600, 'bogus', 1, 1, 'x')"],
      ['half an armed line (an id, no value)', "INSERT INTO decision_rows (row, mode, ceiling, armedLineId, updatedAt, actor) VALUES ('relay.method', 'armed', 600, 3, 1, 'x')"],
      ['half an armed line (a value, no id)', "INSERT INTO decision_rows (row, mode, ceiling, armedLineValue, updatedAt, actor) VALUES ('relay.method', 'armed', 600, 0.9, 1, 'x')"],
      // A value that is not a number ('abc' in a REAL column stays text) must not read as an armed line of NaN.
      ['an armed line whose value is not a number', "INSERT INTO decision_rows (row, mode, ceiling, armedLineId, armedLineValue, updatedAt, actor) VALUES ('relay.method', 'armed', 600, 3, 'abc', 1, 'x')"],
      ['an armed line whose value is outside 0 to 1', "INSERT INTO decision_rows (row, mode, ceiling, armedLineId, armedLineValue, updatedAt, actor) VALUES ('relay.method', 'armed', 600, 3, 1.5, 1, 'x')"],
      ['a ceiling that is not an integer', "INSERT INTO decision_rows (row, mode, ceiling, updatedAt, actor) VALUES ('relay.method', 'shadow', 'many', 1, 'x')"],
    ])('%s reads unreadable, an advice row reads off, and a move answers row-unreadable', (_why, sql) => {
      plant(sql);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        expect(decisionRowRead(f.db, 'relay.method')).toEqual({ kind: 'unreadable' });
        expect(decisionRowSideOf(f.db, 'relay.method')).toEqual(DECISION_ROW_DEFAULT);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]![0])).toMatch(/relay\.method.*cannot be read.*off/);
      } finally { warn.mockRestore(); }
      expect(f.move({ row: 'relay.method', to: side({ mode: 'shadow' }) })).toEqual({ ok: false, error: 'row-unreadable' });
      expect(f.lines()).toEqual([]);
      expect(f.head()).toBeUndefined();
    });
    // Review 2418 F4 (the coordinator's ruling: fail closed): an unreadable GATE row reads armed and held, so it shuts and its
    // outcome goes to the operator, never the code verdict a disarmed gate would let through.
    it.each([
      ['a heldCause out of the vocabulary', "INSERT INTO decision_rows (row, mode, ceiling, heldCause, heldAt, updatedAt, actor) VALUES ('scope.widens', 'shadow', 600, 'bogus', 1, 1, 'x')"],
      ['half an armed line', "INSERT INTO decision_rows (row, mode, ceiling, armedLineId, updatedAt, actor) VALUES ('scope.widens', 'armed', 600, 3, 1, 'x')"],
      ['a ceiling that is not an integer', "INSERT INTO decision_rows (row, mode, ceiling, updatedAt, actor) VALUES ('scope.widens', 'shadow', 'many', 1, 'x')"],
      ['a ceiling outside the authority grammar', "INSERT INTO decision_rows (row, mode, ceiling, updatedAt, actor) VALUES ('scope.widens', 'armed', 9999, 1, 'x')"],
    ])('a gate row with %s reads unreadable and the side is armed and held, with a warning', (_why, sql) => {
      plant(sql);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        expect(decisionRowRead(f.db, 'scope.widens')).toEqual({ kind: 'unreadable' });
        const got = decisionRowSideOf(f.db, 'scope.widens');
        expect(got).toEqual(UNREADABLE_GATE_SIDE);
        expect(got).toMatchObject({ mode: 'armed', held: true, armedLine: null, ceiling: DECISION_ROW_DEFAULT.ceiling });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]![0])).toMatch(/scope\.widens.*cannot be read.*armed and held/);
        // The warning names the row and never the stored text.
        expect(String(warn.mock.calls[0]![0])).not.toMatch(/bogus|many|9999/);
      } finally { warn.mockRestore(); }
      expect(f.move({ row: 'scope.widens', to: side({ mode: 'shadow' }) })).toEqual({ ok: false, error: 'row-unreadable' });
      expect(f.lines()).toEqual([]);
    });
    it('every gate reads shut when its row is unreadable, and every advice row reads off', () => {
      f.db.exec('DROP TABLE decision_rows');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        for (const row of DECISION_ROW_IDS) {
          const gate = DECISION_QUESTIONS[row].direction === 'gate';
          expect(decisionRowSideOf(f.db, row), row).toEqual(gate ? UNREADABLE_GATE_SIDE : DECISION_ROW_DEFAULT);
        }
        expect(warn).toHaveBeenCalledTimes(DECISION_ROW_IDS.length);
      } finally { warn.mockRestore(); }
    });
    it('a ceiling of 49 or 5001 in the table reads unreadable; 50 and 5000 read as rows (review 2418 F5)', () => {
      expect([DECISION_CEILING_MIN, DECISION_CEILING_MAX]).toEqual([50, 5000]);
      const put = (row: string, ceiling: number): void => {
        f.db.prepare("INSERT OR REPLACE INTO decision_rows (row, mode, ceiling, updatedAt, actor) VALUES (?, 'shadow', ?, 1, 'x')").run(row, ceiling);
      };
      for (const row of ['relay.method', 'scope.widens'] as const) {
        for (const ceiling of [49, 5001, 0, -1]) {
          put(row, ceiling);
          expect(decisionRowRead(f.db, row), `${row} ${ceiling}`).toEqual({ kind: 'unreadable' });
        }
        for (const ceiling of [50, 5000, 600]) {
          put(row, ceiling);
          expect(decisionRowRead(f.db, row), `${row} ${ceiling}`).toMatchObject({ kind: 'row', state: { mode: 'shadow', ceiling } });
        }
      }
    });
    it('another row is not affected', () => {
      plant("INSERT INTO decision_rows (row, mode, ceiling, heldCause, updatedAt, actor) VALUES ('relay.method', 'shadow', 600, 'bogus', 1, 'x')");
      expect(decisionRowRead(f.db, 'goals.conflict')).toMatchObject({ kind: 'row' });
    });
    it('a failed read (the table gone) reads unreadable, never the default', () => {
      f.db.exec('DROP TABLE decision_rows');
      expect(decisionRowRead(f.db, 'relay.method')).toEqual({ kind: 'unreadable' });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try { expect(decisionRowSideOf(f.db, 'relay.method')).toEqual(DECISION_ROW_DEFAULT); } finally { warn.mockRestore(); }
    });
  });
});

describe('the host', () => {
  const host = { kind: 'local' as const, endpoint: 'http://127.0.0.1:9000/v1', origin: 'http://127.0.0.1:9000', modelId: 'model-a', keySetAt: null };
  it('none before a set; the set row after, then an update in place', () => {
    expect(decisionHostRead(f.db)).toEqual({ kind: 'none' });
    tx(f.db, () => setDecisionHostInTx(f.db, host, 'device-a', 10));
    expect(decisionHostRead(f.db)).toEqual({ kind: 'host', host: { ...host, updatedAt: 10, actor: 'device-a' } });
    tx(f.db, () => setDecisionHostInTx(f.db, { ...host, kind: 'hosted', modelId: 'model-b', keySetAt: 20 }, 'device-b', 30));
    expect(decisionHostRead(f.db)).toEqual({ kind: 'host', host: { ...host, kind: 'hosted', modelId: 'model-b', keySetAt: 20, updatedAt: 30, actor: 'device-b' } });
    expect(f.db.prepare('SELECT COUNT(*) AS c FROM decision_host').get()).toEqual({ c: 1 });
  });
  it('outside a transaction it throws and writes nothing', () => {
    expect(() => setDecisionHostInTx(f.db, host, 'device-a', 10)).toThrow(/only inside the caller's tx\(\)/);
    expect(decisionHostRead(f.db)).toEqual({ kind: 'none' });
  });
  it('a kind out of the vocabulary reads unreadable', () => {
    f.db.exec("INSERT INTO decision_host (id, kind, endpoint, origin, modelId, updatedAt, actor) VALUES (1, 'cloud', 'e', 'o', 'm', 1, 'x')");
    expect(decisionHostRead(f.db)).toEqual({ kind: 'unreadable' });
  });
  it('holds no key: no column of the table carries one', () => {
    const cols = (f.db.prepare('PRAGMA table_info(decision_host)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['id', 'kind', 'endpoint', 'origin', 'modelId', 'keySetAt', 'updatedAt', 'actor']);
  });
});

function line(o: Partial<DecisionLineWrite> = {}): DecisionLineWrite {
  return { row: 'relay.method', revision: 'rev-a', hostKind: 'local', origin: 'http://127.0.0.1:9000', modelId: 'model-a', line: 0.9,
    labelled: 60, errors: 1, bound: 0.08, canaryExpected: 40, baseline: ['likely', 'unlikely', 'very-likely'], admittedAt: 100, ...o };
}

describe('lines', () => {
  const KEY = { hostKind: 'local' as const, origin: 'http://127.0.0.1:9000', modelId: 'model-a', revision: 'rev-a' };
  it('admit answers increasing ids, and a baseline round-trips', () => {
    const a = admitDecisionLine(f.db, line());
    const b = admitDecisionLine(f.db, line({ line: 0.85, baseline: [] }));
    const c = admitDecisionLine(f.db, line({ row: 'scope.widens' }));
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(decisionLineById(f.db, a)).toEqual({ ...line(), id: a, canaryAsked: 0, canaryCrossed: 0 });
    expect(decisionLineById(f.db, b)).toMatchObject({ line: 0.85, baseline: [] });
    expect(decisionLineById(f.db, 9999)).toBeNull();
  });
  it('current is the newest under the exact key, and null under another row, origin, model, host kind or revision', () => {
    const a = admitDecisionLine(f.db, line());
    expect(currentDecisionLine(f.db, 'relay.method', KEY)?.id).toBe(a);
    const b = admitDecisionLine(f.db, line({ line: 0.8 }));
    expect(currentDecisionLine(f.db, 'relay.method', KEY)).toMatchObject({ id: b, line: 0.8 });
    admitDecisionLine(f.db, line({ origin: 'http://127.0.0.1:9001', line: 0.5 }));
    admitDecisionLine(f.db, line({ modelId: 'model-b', line: 0.5 }));
    admitDecisionLine(f.db, line({ hostKind: 'hosted', line: 0.5 }));
    admitDecisionLine(f.db, line({ revision: 'rev-b', line: 0.5 }));
    admitDecisionLine(f.db, line({ row: 'goals.conflict', line: 0.5 }));
    expect(currentDecisionLine(f.db, 'relay.method', KEY)?.id).toBe(b);
    expect(currentDecisionLine(f.db, 'relay.method', { ...KEY, origin: 'http://127.0.0.1:9002' })).toBeNull();
    expect(currentDecisionLine(f.db, 'relay.method', { ...KEY, modelId: 'model-c' })).toBeNull();
    expect(currentDecisionLine(f.db, 'relay.method', { ...KEY, hostKind: 'zero-retention' })).toBeNull();
    expect(currentDecisionLine(f.db, 'relay.method', { ...KEY, revision: 'rev-c' })).toBeNull();
    expect(currentDecisionLine(f.db, 'readback.adds', KEY)).toBeNull();
    // each of the others answers its own
    expect(currentDecisionLine(f.db, 'relay.method', { ...KEY, revision: 'rev-b' })).toMatchObject({ revision: 'rev-b' });
    expect(currentDecisionLine(f.db, 'goals.conflict', KEY)).toMatchObject({ row: 'goals.conflict' });
  });
  it('recordCanary updates the two columns of that line only', () => {
    const a = admitDecisionLine(f.db, line());
    const b = admitDecisionLine(f.db, line({ line: 0.8 }));
    recordCanary(f.db, a, 25, 1);
    expect(decisionLineById(f.db, a)).toMatchObject({ canaryAsked: 25, canaryCrossed: 1, canaryExpected: 40 });
    expect(decisionLineById(f.db, b)).toMatchObject({ canaryAsked: 0, canaryCrossed: 0 });
    recordCanary(f.db, a, 40, 2);
    expect(decisionLineById(f.db, a)).toMatchObject({ canaryAsked: 40, canaryCrossed: 2 });
  });
  it('a baseline this build cannot read reads as none, never a throw', () => {
    const a = admitDecisionLine(f.db, line());
    f.db.prepare('UPDATE decision_lines SET baseline = ? WHERE id = ?').run('not json', a);
    expect(decisionLineById(f.db, a)).toMatchObject({ baseline: [] });
    f.db.prepare('UPDATE decision_lines SET baseline = ? WHERE id = ?').run('["likely","certain"]', a);
    expect(decisionLineById(f.db, a)).toMatchObject({ baseline: [] });
  });
});

describe('recordAnchorRun', () => {
  const DAY = '2026-11-16';
  const day = (): Record<string, unknown> | undefined =>
    f.db.prepare("SELECT serve, maintain, reserved, unavailableMs, anchorBands, anchorDrift FROM decision_days WHERE row = 'relay.method' AND day = ?").get(DAY);
  it('writes the two anchor columns and does not disturb the counts of the same (row, day), before or after', () => {
    settleDecisionCalls(f.db, ['relay.method'], DAY, 'serve', 0, 4, 250);
    recordAnchorRun(f.db, 'relay.method', DAY, ['likely', 'unlikely'], true);
    expect(day()).toEqual({ serve: 4, maintain: 0, reserved: 0, unavailableMs: 250, anchorBands: '["likely","unlikely"]', anchorDrift: 1 });
    settleDecisionCalls(f.db, ['relay.method'], DAY, 'maintain', 0, 20, 0);
    expect(day()).toEqual({ serve: 4, maintain: 20, reserved: 0, unavailableMs: 250, anchorBands: '["likely","unlikely"]', anchorDrift: 1 });
    recordAnchorRun(f.db, 'relay.method', DAY, ['doubtful'], false);
    expect(day()).toEqual({ serve: 4, maintain: 20, reserved: 0, unavailableMs: 250, anchorBands: '["doubtful"]', anchorDrift: 0 });
  });
  it('a first write for a (row, day) with no counts inserts the row with zero counts', () => {
    recordAnchorRun(f.db, 'relay.method', DAY, [], false);
    expect(day()).toEqual({ serve: 0, maintain: 0, reserved: 0, unavailableMs: 0, anchorBands: '[]', anchorDrift: 0 });
  });
  it('another row or day is untouched', () => {
    recordAnchorRun(f.db, 'relay.method', DAY, ['likely'], true);
    expect(f.db.prepare('SELECT COUNT(*) AS c FROM decision_days').get()).toEqual({ c: 1 });
    recordAnchorRun(f.db, 'relay.method', '2026-11-17', ['likely'], true);
    recordAnchorRun(f.db, 'goals.conflict', DAY, ['likely'], true);
    expect(f.db.prepare('SELECT COUNT(*) AS c FROM decision_days').get()).toEqual({ c: 3 });
  });
});

describe('decisionMeasures (M19)', () => {
  const rec = (stateHash: string, verdict: 'yes' | 'unsure' | 'no', at: number, row: 'relay.method' | 'goals.conflict' = 'relay.method'): void => {
    recordDecision(f.db, { row, revision: 'rev-a', modelId: 'model-a', hostKind: 'local', origin: 'http://127.0.0.1:9000', stateHash, lineGen: 1,
      verdict, p: 0.5, band: 'doubtful', ms: 5, refs: {}, inline: null, at });
  };
  const SINCE = '2026-11-16';
  const since = Date.parse(`${SINCE}T00:00:00Z`);

  it('answers a row per catalogue row, in order, each with zeroes and no hold when nothing is there', () => {
    const m = decisionMeasures(f.db, SINCE);
    expect(m.map((r) => r.row)).toEqual([...DECISION_ROW_IDS]);
    for (const r of m) {
      expect(r).toEqual({ row: r.row, bound: null, unsureShare: 0, canaryCrossed: 0, canaryAsked: 0, canaryExpected: 0, unavailableMs: 0,
        calls: { serve: 0, maintain: 0 }, held: null });
    }
  });

  it('one row with records, days, lines and a hold: every field', () => {
    // records: four since the day (two unsure), one before it (excluded), one on another row
    rec('a', 'unsure', since); rec('b', 'unsure', since + 1000); rec('c', 'yes', since + 2000); rec('d', 'no', since + 3000);
    rec('old', 'unsure', since - 1);
    rec('g', 'unsure', since + 10, 'goals.conflict');
    // days: one before the day (excluded), two since
    settleDecisionCalls(f.db, ['relay.method'], '2026-11-15', 'serve', 0, 100, 9000);
    settleDecisionCalls(f.db, ['relay.method'], '2026-11-16', 'serve', 0, 6, 300);
    settleDecisionCalls(f.db, ['relay.method'], '2026-11-16', 'maintain', 0, 20, 0);
    settleDecisionCalls(f.db, ['relay.method'], '2026-11-17', 'serve', 0, 4, 200);
    // lines: the newest (by id) carries the figures; an older one for the same row does not
    const old = admitDecisionLine(f.db, line({ bound: 0.4, canaryExpected: 99 }));
    recordCanary(f.db, old, 99, 9);
    const cur = admitDecisionLine(f.db, line({ bound: 0.07, canaryExpected: 40, revision: 'rev-b' }));
    recordCanary(f.db, cur, 30, 1);
    // a hold
    f.move({ row: 'relay.method', to: side({ mode: 'shadow' }) });
    f.move({ row: 'relay.method', expected: side({ mode: 'shadow' }), to: side({ mode: 'shadow', held: true }), heldCause: 'canary' });

    const m = decisionMeasures(f.db, SINCE).find((r) => r.row === 'relay.method')!;
    expect(m).toEqual({
      row: 'relay.method', bound: 0.07, unsureShare: 0.5, canaryCrossed: 1, canaryAsked: 30, canaryExpected: 40, unavailableMs: 500,
      calls: { serve: 10, maintain: 20 }, held: 'canary',
    });
    // the other row's own figures, not this row's
    expect(decisionMeasures(f.db, SINCE).find((r) => r.row === 'goals.conflict')).toMatchObject({ unsureShare: 1, calls: { serve: 0, maintain: 0 }, held: null, bound: null });
  });

  it('a later day leaves out earlier records and days', () => {
    rec('a', 'unsure', since); rec('b', 'yes', since + 86_400_000);
    settleDecisionCalls(f.db, ['relay.method'], '2026-11-16', 'serve', 0, 6, 300);
    settleDecisionCalls(f.db, ['relay.method'], '2026-11-17', 'serve', 0, 4, 200);
    expect(decisionMeasures(f.db, '2026-11-17').find((r) => r.row === 'relay.method')).toMatchObject({ unsureShare: 0, calls: { serve: 4, maintain: 0 }, unavailableMs: 200 });
  });

  it('an unreadable row reads the word unreadable as its hold, never null', () => {
    f.db.exec("INSERT INTO decision_rows (row, mode, ceiling, heldCause, updatedAt, actor) VALUES ('relay.method', 'shadow', 600, 'bogus', 1, 'x')");
    expect(decisionMeasures(f.db, SINCE).find((r) => r.row === 'relay.method')!.held).toBe('unreadable');
  });
});
