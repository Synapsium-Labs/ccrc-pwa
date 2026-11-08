// D-8071 (spec §11.1, F6, A8): a run keeps the title it was opened with, and a later open never moves a programme's
// name. Migration's column and copy, the store's two programme writes and the wire field, over fixture coord.db files.
// The entry's slot is found by its DDL and never hard-coded.
import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore, toRunSummary } from '../src/coord/store.js';
import { programmeNameFromSlug } from '../../shared/api.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const ADD = /ALTER TABLE runs ADD COLUMN title\b/;
const SLOT = MIGRATIONS.findIndex((m) => ADD.test(m)) + 1;

/** The statement Rollback names: each programme's title from its newest run's title. */
const RESTORE_SQL =
  'UPDATE programs SET title = (SELECT r.title FROM runs r WHERE r.program = programs.slug AND r.title IS NOT NULL ' +
  'ORDER BY r.id DESC LIMIT 1) WHERE EXISTS (SELECT 1 FROM runs r WHERE r.program = programs.slug AND r.title IS NOT NULL)';

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-titles-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore, program: string, title: string, wave: number, programmeTitle?: string): number => {
  const r = s.openRun({
    program, title, project: 'demo', wave, waveOf: null, claimedBy: 'coord-a',
    ...(programmeTitle !== undefined ? { programmeTitle } : {}),
  });
  if (!('id' in r)) throw new Error(`fixture openRun refused: ${JSON.stringify(r)}`);
  return r.id;
};
const programmeTitleOf = (s: CoordStore, slug: string): string =>
  (s.db.prepare('SELECT title FROM programs WHERE slug = ?').get(slug) as { title: string }).title;
const wire = (s: CoordStore, id: number): string | null | undefined => {
  const r = s.run(id);
  if (!r.ok || r.run === null) throw new Error('fixture run unreadable');
  return toRunSummary(r.run).runTitle;
};

const plantedBefore = (plant: (raw: DatabaseSync) => void): string => {
  const p = path.join(mkTmp('ccrc-mig-titles-'), '.ccrc', 'coord.db');
  mkdirSync(path.dirname(p), { recursive: true });
  const raw = new DatabaseSync(p);
  tx(raw, () => {
    for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
    raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
    plant(raw);
  });
  raw.close();
  return p;
};

describe('programmeNameFromSlug', () => {
  it('reads a slug as words', () => {
    expect(programmeNameFromSlug('programme-a')).toBe('Programme a');
    expect(programmeNameFromSlug('lane_a-b')).toBe('Lane_a b');
  });
});

describe('opens leave the programme name alone', () => {
  it('an open leaves programs.title alone', () => {
    const s = store();
    open(s, 'programme-a', 'Wave one title', 1, 'Programme A');
    open(s, 'programme-a', 'Wave two title', 2, 'Renamed');
    expect(programmeTitleOf(s, 'programme-a')).toBe('Programme A');
  });

  it('a run keeps its own title after a later open', () => {
    const s = store();
    const a = open(s, 'programme-a', 'Wave one title', 1);
    const b = open(s, 'programme-a', 'Wave two title', 2);
    expect([wire(s, a), wire(s, b)]).toEqual(['Wave one title', 'Wave two title']);
  });

  it('programmeTitle is used only for a new programme row', () => {
    const s = store();
    open(s, 'programme-a', 'T1', 1, 'Programme A');
    open(s, 'programme-b', 'T2', 1);
    expect(programmeTitleOf(s, 'programme-a')).toBe('Programme A');
    expect(programmeTitleOf(s, 'programme-b')).toBe('Programme b');
  });
});

describe('the migration', () => {
  const planted = (): CoordStore => new CoordStore(openCoordDb(plantedBefore((raw) => {
    raw.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('programme-a', 'Old Title', 1, 'active')");
    raw.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('programme-b', 'Other', 1, 'active')");
    for (const [id, prog, wave] of [[1, 'programme-a', 1], [2, 'programme-a', 2], [3, 'programme-b', 1]] as const) {
      raw.prepare(
        "INSERT INTO runs (id, program, wave, waveOf, project, state, claimedBy, openedAt) " +
        "VALUES (?, ?, ?, NULL, 'demo', 'done', 'c', 1)",
      ).run(id, prog, wave);
    }
  })));

  it('the entry is one additive column, past every frozen entry', () => {
    expect(SLOT, 'no MIGRATIONS entry adds runs.title').toBeGreaterThanOrEqual(43);
    expect(MIGRATIONS.filter((m) => ADD.test(m)).length).toBe(1);
  });

  it('the migration copies programs.title to the newest run and sets programs.title to the slug as words', () => {
    const s = planted();
    expect(wire(s, 2)).toBe('Old Title');
    expect(wire(s, 3)).toBe('Other');
    expect(programmeTitleOf(s, 'programme-a')).toBe('Programme a');
    expect(programmeTitleOf(s, 'programme-b')).toBe('Programme b');
  });

  it('earlier runs keep a null title', () => {
    const s = planted();
    expect(wire(s, 1)).toBeNull();
  });

  it('the restore statement puts each programme\'s old title back', () => {
    const s = planted();
    s.db.exec(RESTORE_SQL);
    expect(programmeTitleOf(s, 'programme-a')).toBe('Old Title');
    expect(programmeTitleOf(s, 'programme-b')).toBe('Other');
  });
});
