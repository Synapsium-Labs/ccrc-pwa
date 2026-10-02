// `deploy/measure-workspace-lifecycle.py` (workspace lifecycle spec §9) against a REAL coord.db — built by this
// build's own migrations, so a schema change the instrument has not followed reds here — and a state-cache
// snapshot in the server's own shape.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { TERMINAL_RUN_STATES } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'deploy', 'measure-workspace-lifecycle.py');
const NOW_S = 1_790_000_000;
const DAY = 86_400;

const run = (args: string[]) => spawnSync('python3', [SCRIPT, ...args], {
  encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000,
});
const rows = (stdout: string): Record<string, string> =>
  Object.fromEntries(stdout.split('\n').filter((l) => /^[a-z_0-9]+: /.test(l)).map((l) => l.split(': ', 2) as [string, string]));

/** A snapshot row carrying only what the instrument reads. */
const row = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, workspace: id, held: null, archivedAt: null, bucket: 'idle', stranded: null, ...over });

function fixture() {
  const home = mkTmp('ccrc-measure-');
  const dbPath = path.join(home, '.ccrc', 'coord.db');
  const db = openCoordDb(dbPath);
  const s = new CoordStore(db);
  const closed = (sessionId: string, claimedBy = 'coord') => {
    const r = s.openRun({ program: 'lifecycle', title: 'L', project: 'demo', wave: 1, waveOf: 1, claimedBy });
    if (!('id' in r)) throw new Error('openRun refused');
    s.bindSession(r.id, sessionId);
    expect(s.advance(r.id, 'failed', 'test-close').ok).toBe(true);
  };
  const act = (sessionId: string, name: string, atS: number) => db.prepare(
    'INSERT INTO lifecycle_events (gen, ingestedAt, act, outcome, sessionId, at, raw) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('1'.repeat(19), 1, name, 'done', sessionId, atS * 1000, `${name} ${sessionId} ${atS}`);
  return { home, dbPath, db, s, closed, act };
}

const writeCache = (home: string, sessions: unknown[]) => {
  const p = path.join(home, '.ccrc', 'state-cache.json');
  writeFileSync(p, JSON.stringify({ sessions, savedAt: (NOW_S - 30) * 1000 }));
  return p;
};

describe('measure-workspace-lifecycle.py', () => {
  it('its terminal set is shared/api.ts’s TERMINAL_RUN_STATES — the second spelling is bound to the first', () => {
    const m = /^TERMINAL = \(([^)]*)\)/m.exec(readFileSync(SCRIPT, 'utf8'));
    expect(m).not.toBeNull();
    expect(m![1]!.split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean)).toEqual([...TERMINAL_RUN_STATES]);
  });

  it('counts released rows by the six conditions, splits needs-a-person, and compares with the wire', () => {
    const f = fixture();
    for (const id of ['loose', 'folded', 'busy', 'strand', 'held', 'arch', 'coordnow', 'wireonly']) f.closed(id);
    f.closed('main');                                                   // a main checkout: workspace null below
    f.s.openRun({ program: 'next', title: 'N', project: 'demo', wave: 1, waveOf: 1, claimedBy: 'coordnow' });
    const rel = { runId: 1, program: 'lifecycle', programTitle: 'L', claimedBy: 'coord', closedAt: 1, child: false };
    const cache = writeCache(f.home, [
      row('loose'),
      row('folded', { releasedFrom: rel }),
      row('busy', { bucket: 'working' }),
      row('strand', { stranded: { at: 1, reason: 'no lane' } }),
      row('held', { held: 'program:x wave:1/1' }),
      row('arch', { archivedAt: NOW_S - DAY, bucket: 'archived' }),
      row('coordnow'),
      row('main', { workspace: null }),
      row('neverrun'),
      row('wireonly-x', { releasedFrom: rel }),
    ]);
    const r = run(['--db', f.dbPath, '--cache', cache, '--now', String(NOW_S)]);
    expect(r.status, r.stderr).toBe(0);
    const o = rows(r.stdout);
    expect(o['rows_total']).toBe('10');
    expect(o['snapshot_age_s']).toBe('30');
    expect(o['released_computed']).toBe('4');                           // loose, folded, busy, strand
    expect(o['released_needs_person']).toBe('2');                       // busy, strand
    expect(o['released_top_level']).toBe('1');                          // loose
    expect(r.stdout).toContain('released_top_level: 1\n  loose\n');
    expect(o['released_wire_only']).toBe('1');                          // wireonly-x: no run, yet marked
  });

  it('archived workspaces older than a week, held and unheld; a main checkout never counts', () => {
    const f = fixture();
    const cache = writeCache(f.home, [
      row('old', { archivedAt: NOW_S - 8 * DAY }),
      row('oldheld', { archivedAt: NOW_S - 8 * DAY, held: 'x' }),
      row('young', { archivedAt: NOW_S - 6 * DAY }),
      row('oldmain', { workspace: null, archivedAt: NOW_S - 30 * DAY }),
    ]);
    const o = rows(run(['--db', f.dbPath, '--cache', cache, '--now', String(NOW_S)]).stdout);
    expect(o['archived_over_7d_unheld']).toBe('1');
    expect(o['archived_over_7d_held']).toBe('1');
  });

  it('archive→return delays from the journal: every return act, the 6- and 7-day bands, the horizon', () => {
    const f = fixture();
    f.act('a', 'archive', NOW_S - 20 * DAY);
    f.act('a', 'restore', NOW_S - 19 * DAY);                            // 1 day
    f.act('b', 'archive', NOW_S - 15 * DAY);
    f.act('b', 'start', NOW_S - 15 * DAY + 6 * DAY + 3600);             // 6 d 1 h
    f.act('c', 'archive', NOW_S - 12 * DAY);
    f.act('c', 'swap', NOW_S - 12 * DAY + 8 * DAY);                     // 8 days
    f.act('d', 'archive', NOW_S - 2 * DAY);                             // never returned
    f.act('e', 'ensure', NOW_S - DAY);                                  // a return with no archive before it
    const cache = writeCache(f.home, []);
    const r = run(['--db', f.dbPath, '--cache', cache, '--now', String(NOW_S), '--days', '14']);
    const o = rows(r.stdout);
    expect(o['archive_returns']).toBe('3');
    expect(o['archive_return_max_s']).toBe(String(8 * DAY));
    expect(o['archive_returns_over_6d']).toBe('2');
    expect(o['archive_returns_over_7d']).toBe('1');
    expect(o['journal_horizon_days']).toBe('20.0');
    expect(o['archive_acts_per_day']).toBe('2 over 14 days');          // c and d are inside 14 days; a and b are not
  });

  it('a removal or a re-creation ends an archive: a reused slug is a new workspace, never a late return', () => {
    const f = fixture();
    f.act('reused', 'archive', NOW_S - 20 * DAY);
    f.act('reused', 'destroy', NOW_S - 19 * DAY);
    f.act('reused', 'spawn', NOW_S - 5 * DAY);                          // a new workspace under the old id
    f.act('recreated', 'archive', NOW_S - 20 * DAY);
    f.act('recreated', 'create', NOW_S - 10 * DAY);
    f.act('recreated', 'start', NOW_S - 10 * DAY + 60);
    const o = rows(run(['--db', f.dbPath, '--cache', writeCache(f.home, []), '--now', String(NOW_S)]).stdout);
    expect(o['archive_returns']).toBe('0');
    expect(o['archive_returns_over_7d']).toBe('0');
  });

  it('a second archive restarts the clock: the return pairs with the NEWEST archive', () => {
    const f = fixture();
    f.act('twice', 'archive', NOW_S - 20 * DAY);
    f.act('twice', 'archive', NOW_S - 3 * DAY);
    f.act('twice', 'restore', NOW_S - 2 * DAY);
    const o = rows(run(['--db', f.dbPath, '--cache', writeCache(f.home, []), '--now', String(NOW_S)]).stdout);
    expect(o['archive_returns']).toBe('1');
    expect(o['archive_return_max_s']).toBe(String(DAY));
  });

  it('a terminal run with no close time is doubt, not a release — the server\u2019s rule', () => {
    const f = fixture();
    f.closed('noclose');
    f.db.prepare('UPDATE runs SET closedAt = NULL WHERE sessionId = ?').run('noclose');
    const o = rows(run(['--db', f.dbPath, '--cache', writeCache(f.home, [row('noclose')]), '--now', String(NOW_S)]).stdout);
    expect(o['released_computed']).toBe('0');
  });

  it('refuses a missing database without creating one, and never writes the one it reads', () => {
    const f = fixture();
    const cache = writeCache(f.home, [row('x')]);
    const missing = path.join(f.home, 'nope', 'coord.db');
    const r = run(['--db', missing, '--cache', cache, '--now', String(NOW_S)]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('no coord.db');
    expect(() => statSync(missing)).toThrow();
    const before = readFileSync(f.dbPath);
    expect(run(['--db', f.dbPath, '--cache', cache, '--now', String(NOW_S)]).status).toBe(0);
    expect(readFileSync(f.dbPath).equals(before)).toBe(true);
  });

  it('refuses a snapshot that is not one', () => {
    const f = fixture();
    const bad = path.join(f.home, 'bad.json');
    writeFileSync(bad, JSON.stringify({ nope: true }));
    const r = run(['--db', f.dbPath, '--cache', bad, '--now', String(NOW_S)]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('not a fleet snapshot');
  });
});
