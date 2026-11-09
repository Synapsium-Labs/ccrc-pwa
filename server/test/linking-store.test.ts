// D-8147: the `project_linking` table's SQL (`coord/linkingStore.ts`), over a real coord.db.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { linkingAll, linkingOf, recordReading, setLinking } from '../src/coord/linkingStore.js';
import { mkTmp } from './tmpHelpers.js';

let dir: string;
let db: ReturnType<typeof openCoordDb>;

beforeEach(() => {
  dir = mkTmp('ccrc-linking-store-');
  db = openCoordDb(path.join(dir, 'coord.db'));
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

const MEASURED = { state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'absent', at: 100 } as const;

describe('project_linking', () => {
  it('a project with no row reads unmeasured with no key and mode unknown', () => {
    expect(linkingOf(db, 'project-a')).toEqual({ teamKey: null, override: null, measured: { state: 'unmeasured' }, mode: 'unknown' });
  });

  it('setLinking writes the key and override and leaves the reading', () => {
    recordReading(db, 'project-a', MEASURED);
    setLinking(db, 'project-a', { teamKey: 'KEY', override: 'public' }, 'device-1', 200);
    expect(linkingOf(db, 'project-a')).toEqual({ teamKey: 'KEY', override: 'public', measured: MEASURED, mode: 'public' });
    const row = db.prepare('SELECT setBy, setAt FROM project_linking WHERE project = ?').get('project-a');
    expect({ ...row }).toEqual({ setBy: 'device-1', setAt: 200 });
  });

  it('recordReading writes the reading and leaves the key', () => {
    setLinking(db, 'project-a', { teamKey: 'KEY', override: null }, 'device-1', 200);
    recordReading(db, 'project-a', MEASURED);
    expect(linkingOf(db, 'project-a')).toEqual({ teamKey: 'KEY', override: null, measured: MEASURED, mode: 'private' });
    recordReading(db, 'project-a', { state: 'unmeasured' });
    expect(linkingOf(db, 'project-a').teamKey).toBe('KEY');
    expect(linkingOf(db, 'project-a').measured).toEqual({ state: 'unmeasured' });
  });

  it('a failed reading keeps the last measured visibility out of the mode', () => {
    recordReading(db, 'project-a', MEASURED);
    recordReading(db, 'project-a', { state: 'failed', reason: 'gh-failed', at: 300 });
    expect(linkingOf(db, 'project-a')).toEqual({
      teamKey: null, override: null, measured: { state: 'failed', reason: 'gh-failed', at: 300 }, mode: 'unknown',
    });
    // The last visibility stays in the row, so the next measurement overwrites it and nothing else has to.
    expect(db.prepare('SELECT visibility FROM project_linking WHERE project = ?').get('project-a')).toEqual({ visibility: 'private' });
    recordReading(db, 'project-a', { ...MEASURED, visibility: 'public', at: 400 });
    expect(linkingOf(db, 'project-a').measured).toMatchObject({ state: 'measured', visibility: 'public', at: 400 });
  });

  it('linkingAll reads every row in one query', () => {
    setLinking(db, 'project-a', { teamKey: 'KEY', override: null }, 'device-1', 1);
    recordReading(db, 'project-b', MEASURED);
    const all = linkingAll(db);
    expect([...all.keys()].sort()).toEqual(['project-a', 'project-b']);
    expect(all.get('project-b')?.mode).toBe('private');
    expect(all.get('project-a')?.teamKey).toBe('KEY');
  });
});
