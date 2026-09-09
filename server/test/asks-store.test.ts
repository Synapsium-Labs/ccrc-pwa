// The ask pre-emption lane's coord.db table (D-2169), task 4: only that the
// migration lands at the right version with the columns the lane needs.
// Reading/writing it is task 5's job.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, openCoordDb } from '../src/coord/db.js';
import { mkTmp } from './tmpHelpers.js';

const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');

describe('the asks table', () => {
  it('is created at schema version 9 with the columns the lane needs', () => {
    const home = mkTmp('ccrc-coord-');
    const db = openCoordDb(dbPathIn(home));
    expect(COORD_SCHEMA_VERSION).toBe(9);
    const cols = (db.prepare("SELECT name FROM pragma_table_info('asks')").all() as
      { name: string }[]).map((r) => r.name).sort();
    expect(cols).toEqual([
      'answer', 'answeredAt', 'answeredBy', 'askAt', 'askKey', 'at', 'childId',
      'dialogId', 'id', 'options', 'parentId', 'question', 'releasedAt', 'runId', 'state',
    ]);
    db.close();
  });
});
