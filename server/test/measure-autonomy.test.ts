// `deploy/measure-autonomy.py` (coordinator-autonomy spec §1.2 and §10) against neutral transcript fixtures under
// `test/fixtures/measure-autonomy/`. The script is run as a subprocess; its functions are reached through its
// subcommands, never by import.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, statSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMailNudge } from '../src/coord/envelope.js';
import { IDLE_COMPACT_NUDGE_PROMPT, RESUME_PROMPT_PREFIX, MAIL_ENVELOPE_FENCE } from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import { mkTmp } from './tmpHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'deploy', 'measure-autonomy.py');
const FIXTURES = path.join(ROOT, 'server', 'test', 'fixtures', 'measure-autonomy');

const run = (args: string[]) => spawnSync('python3', ['-I', SCRIPT, ...args], {
  encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000,
});
const rows = (stdout: string): Record<string, string> =>
  Object.fromEntries(stdout.split('\n').filter((l) => /^[a-z0-9_-]+: /.test(l)).map((l) => l.split(': ', 2) as [string, string]));

interface Wait { id: string; session: string; kind: string; hours: number; excerpt: string }
const waitsOf = (out: string): Wait[] => JSON.parse(readFileSync(path.join(out, 'waits.json'), 'utf8')) as Wait[];

/** A fixture tree with only the named subdirectories, copied so a test may add to it. */
function tree(...names: string[]): string {
  const dir = mkTmp('ccrc-autonomy-fx-');
  for (const n of names) cpSync(path.join(FIXTURES, n), path.join(dir, n), { recursive: true });
  return dir;
}
const census = (root: string, extra: string[] = []) => {
  const out = mkTmp('ccrc-autonomy-out-');
  const r = run(['transcripts', '--root', root, '--out', out, ...extra]);
  expect(r.status, r.stderr).toBe(0);
  return { out, r, table: rows(r.stdout), waits: waitsOf(out) };
};
const listing = (dir: string): string[] => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile()).map((e) => {
    const p = path.join(e.parentPath, e.name);
    return `${p}:${statSync(p).mtimeMs}:${statSync(p).size}`;
  }).sort();

describe('measure-autonomy transcripts', () => {
  it('its second spellings are bound to shared/api.ts’s', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toContain(JSON.stringify(IDLE_COMPACT_NUDGE_PROMPT).slice(1, -1).replace(/\\"/g, '"'));
    expect(src).toContain(RESUME_PROMPT_PREFIX);
    expect(src).toContain(`MAIL_NUDGE_HEAD = '${renderMailNudge('x').slice(0, 29)}'`);
    expect(src).toContain(`MAIL_FENCE = '${MAIL_ENVELOPE_FENCE}'`);
  });

  it('counts a coordinator and not a worker', () => {
    const a = census(tree('coord-a'));
    expect(a.table['coordinators']).toBe('1');
    const both = census(tree('coord-a', 'worker-a'));
    expect(both.table['coordinators']).toBe('1');
    expect(both.table['transcripts']).toBe('2');
    expect(both.waits.map((w) => w.session)).not.toContain('session-w');
    expect(census(tree('worker-a')).table['coordinators']).toBe('0');
  });

  it('counts a coordinator by intent as well as by the skill, and one that loaded the skill but opened no run not at all', () => {
    const b = census(tree('coord-b'));
    expect(b.table['coordinators']).toBe('1');
  });

  it('removes a swap copy by message id', () => {
    const solo = census(tree('coord-a'));
    const withCopy = census(tree('coord-a', 'coord-a-copy'));
    expect(withCopy.table['coordinators']).toBe(solo.table['coordinators']);
    expect(withCopy.table['typed-reply']).toBe(solo.table['typed-reply']);
    expect(withCopy.table['all']).toBe(solo.table['all']);
    expect(withCopy.waits.map((w) => [w.kind, w.hours])).toEqual(solo.waits.map((w) => [w.kind, w.hours]));
  });

  it('counts a question-ending turn only when the operator typed the next prompt', () => {
    const { waits, table } = census(tree('coord-a'));
    const typed = waits.filter((w) => w.kind === 'typed-reply');
    expect(typed).toHaveLength(1);
    expect(typed[0]!.hours).toBe(0.5);
    expect(typed[0]!.excerpt).toContain('Which of the two layouts');
    expect(table['typed-reply']).toMatch(/^count=1 /);
  });

  it('does not count a question followed by a harness-written row as an operator reply', () => {
    const { waits } = census(tree('coord-harness'));
    expect(waits.filter((w) => w.kind === 'typed-reply')).toHaveLength(0);
  });

  it('does not count a question followed by the mail lane\'s typed wake prompt', () => {
    const fixture = readFileSync(path.join(FIXTURES, 'coord-a', 'session-a.jsonl'), 'utf8');
    expect(fixture).toContain('ccrc-mail: you have new mail.');
    expect(census(tree('coord-a')).waits.filter((w) => w.kind === 'typed-reply')).toHaveLength(1);
  });

  it('does not count a question followed by the idle-compaction nudge', () => {
    const { waits } = census(tree('coord-b'));
    expect(waits.filter((w) => w.kind === 'typed-reply')).toHaveLength(0);
  });

  it('times an AskUserQuestion from the dialog to its answer', () => {
    const { waits, table } = census(tree('coord-b'));
    const dialog = waits.filter((w) => w.kind === 'dialog');
    expect(dialog).toHaveLength(1);
    expect(dialog[0]!.hours).toBe(1.5);
    expect(dialog[0]!.excerpt).toContain('Merge the demo branch now?');
    expect(table['dialog']).toMatch(/^count=1 over_1h=1 /);
  });

  it('reads the 700-character tail only', () => {
    // coord-b's question-ending turn has its `?` 800 characters from the end and a typed prompt after it.
    const { waits } = census(tree('coord-b'));
    expect(waits.filter((w) => w.kind === 'typed-reply')).toHaveLength(0);
  });

  it('keeps the excerpt to 300 characters and out of stdout', () => {
    const { waits, r } = census(tree('coord-a', 'coord-b'));
    for (const w of waits) expect(w.excerpt.length).toBeLessThanOrEqual(300);
    expect(r.stdout).not.toContain('Which of the two layouts');
  });

  it('writes waits.json and waits-over-1h.csv under --out', () => {
    const { out } = census(tree('coord-a', 'coord-b'));
    const csv = readFileSync(path.join(out, 'waits-over-1h.csv'), 'utf8').trim().split('\n');
    expect(csv[0]).toBe('id,kind,hours,excerpt,parts');
    expect(csv).toHaveLength(2);
    expect(csv[1]).toMatch(/,dialog,1\.5,/);
    expect(csv[1]!.endsWith(',')).toBe(true);
  });

  it('keeps a wait out of a window it did not start in', () => {
    const { waits } = census(tree('coord-a', 'coord-b'), ['--since', '2026-11-03']);
    expect(waits).toHaveLength(0);
    const inside = census(tree('coord-a', 'coord-b'), ['--since', '2026-11-02', '--until', '2026-11-03']);
    expect(inside.waits).toHaveLength(2);
  });

  it('writes only under --out', () => {
    const root = tree('coord-a', 'coord-b', 'worker-a');
    const before = listing(root);
    const out = mkTmp('ccrc-autonomy-out-');
    const created = new Set<string>();
    const r = run(['transcripts', '--root', root, '--out', path.join(out, 'nested')]);
    expect(r.status, r.stderr).toBe(0);
    expect(listing(root)).toEqual(before);
    for (const f of readdirSync(out, { recursive: true })) created.add(String(f));
    expect([...created].sort()).toEqual(['nested', 'nested/waits-over-1h.csv', 'nested/waits.json']);
  });

  it('refuses an --out inside a transcript root', () => {
    const root = tree('coord-a');
    const before = listing(root);
    const r = run(['transcripts', '--root', root, '--out', path.join(root, 'coord-a', 'out')]);
    expect(r.status).toBe(2);
    expect(existsSync(path.join(root, 'coord-a', 'out'))).toBe(false);
    expect(listing(root)).toEqual(before);
  });

  it('refuses a root that does not exist, and creates nothing', () => {
    const out = mkTmp('ccrc-autonomy-out-');
    const gone = path.join(out, 'no-such-root');
    const r = run(['transcripts', '--root', gone, '--out', path.join(out, 'o')]);
    expect(r.status).toBe(2);
    expect(existsSync(gone)).toBe(false);
    expect(existsSync(path.join(out, 'o'))).toBe(false);
  });
});

// ── items: M3 and M6 over a fixture coord.db (built from MIGRATIONS through openCoordDb; never a live database) ──
const T = (iso: string): number => Date.parse(iso);

/** A fixture `coord.db`: programme `alpha` (one run open from 2026-11-02 10:00 to 2026-11-03 08:00 = 2 UTC days, 3 items,
 *  1 ask released to the operator), programme `beta` (one run open 2026-11-04 01:00 to 05:00 = 1 day, nothing raised),
 *  plus rows the counts must not take: an item raised before the window, an ask the coordinator answered. */
function fixtureDb(): string {
  const dbPath = path.join(mkTmp('ccrc-autonomy-db-'), 'coord.db');
  const db = openCoordDb(dbPath);
  const prog = db.prepare('INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, ?)');
  prog.run('alpha', 'Alpha', T('2026-10-01T00:00:00Z'), 'active');
  prog.run('beta', 'Beta', T('2026-10-01T00:00:00Z'), 'active');
  const run = db.prepare('INSERT INTO runs (program, wave, project, state, openedAt) VALUES (?, 1, ?, ?, ?)');
  const alphaRun = Number(run.run('alpha', 'demo', 'done', T('2026-11-02T10:00:00Z')).lastInsertRowid);
  const betaRun = Number(run.run('beta', 'demo', 'done', T('2026-11-04T01:00:00Z')).lastInsertRowid);
  const ev = db.prepare('INSERT INTO run_events (runId, at, fromState, toState, causedBy) VALUES (?, ?, ?, ?, ?)');
  ev.run(alphaRun, T('2026-11-02T10:05:00Z'), 'planned', 'dispatched', 'coordinator');
  ev.run(alphaRun, T('2026-11-03T08:00:00Z'), 'closing', 'done', 'coordinator');
  ev.run(betaRun, T('2026-11-04T05:00:00Z'), 'closing', 'done', 'coordinator');
  const item = db.prepare(
    "INSERT INTO operator_items (program, runId, raisedBy, kind, title, why, how, neededBy, state, raisedAt) " +
    "VALUES (?, NULL, 'coord', 'decision', 't', 'w', '[]', 'soon', 'open', ?)");
  for (const at of ['2026-11-02T11:00:00Z', '2026-11-02T12:00:00Z', '2026-11-03T07:00:00Z', '2026-10-20T09:00:00Z']) item.run('alpha', T(at));
  const ask = db.prepare(
    "INSERT INTO asks (at, childId, parentId, runId, askKey, askAt, dialogId, question, options, state, answeredBy, answeredAt, " +
    "releasedAt, releaseReason) VALUES (?, 'child', ?, ?, 'k', 1, 'd', 'q', '[]', ?, ?, ?, ?, ?)");
  ask.run(T('2026-11-02T13:00:00Z'), 'parent-1', alphaRun, 'released', null, null, T('2026-11-02T13:00:00Z'), 'parent-not-live');
  ask.run(T('2026-11-02T14:00:00Z'), 'parent-1', alphaRun, 'answered', 'parent-1', T('2026-11-02T14:01:00Z'), null, null);
  const feed = db.prepare("INSERT INTO feed_events (epoch, seq, at, kind, sessionId, title, body) VALUES ('e', ?, ?, 'run', ?, ?, 'b')");
  let seq = 0;
  const blocked = (iso: string, session: string, title = '⚠ coordinator blocked › ws'): void => { feed.run(++seq, T(iso), session, title); };
  blocked('2026-11-03T10:05:00Z', 'c1');
  blocked('2026-11-03T10:50:00Z', 'c1', '⚠ coordinator blocked (escalated) › ws');   // the same session-hour
  blocked('2026-11-03T11:10:00Z', 'c1');
  blocked('2026-11-03T10:30:00Z', 'c2');
  blocked('2026-11-10T09:00:00Z', 'c1');                                             // the next week
  blocked('2026-11-03T12:00:00Z', 'c1', '⚠ stall › ws');                             // another arm
  db.close();
  return dbPath;
}
const itemsRun = (args: string[]) => run(['items', ...args]);
const WINDOW = ['--since', '2026-11-02', '--until', '2026-11-16'];

describe('measure-autonomy items', () => {
  it('reads M3 per programme-day: 2.0, 0.0 and 1.33 over all', () => {
    const r = itemsRun(['--db', fixtureDb(), ...WINDOW]);
    expect(r.status, r.stderr).toBe(0);
    const t = rows(r.stdout);
    expect(t['programmes']).toBe('2');
    expect(t['m3-p1']).toBe('items=3 asks=1 days=2 value=2.0');
    expect(t['m3-p2']).toBe('items=0 asks=0 days=1 value=0.0');
    expect(t['m3-all']).toBe('items=3 asks=1 days=3 value=1.33');
  });

  it('prints no programme slug, only an ordinal', () => {
    const r = itemsRun(['--db', fixtureDb(), ...WINDOW]);
    expect(r.stdout).not.toMatch(/alpha|beta/);
  });

  it('does not count an item raised outside the window', () => {
    const t = rows(itemsRun(['--db', fixtureDb(), ...WINDOW]).stdout);
    expect(t['m3-p1']).toContain('items=3 ');
    const wide = rows(itemsRun(['--db', fixtureDb(), '--since', '2026-10-01', '--until', '2026-11-16']).stdout);
    expect(wide['m3-p1']).toContain('items=4 ');
  });

  it('does not count an ask the coordinator answered', () => {
    const t = rows(itemsRun(['--db', fixtureDb(), ...WINDOW]).stdout);
    expect(t['m3-p1']).toContain('asks=1 ');
  });

  it('reads M6 per week: coordinator-hours flagged by coord-blocked', () => {
    const t = rows(itemsRun(['--db', fixtureDb(), ...WINDOW]).stdout);
    // week of 2026-11-02: c1 at 10:00 and 11:00, c2 at 10:00 = 3; week of 2026-11-09: c1 = 1; the other arm is not counted
    expect(t['m6-2026-11-02']).toBe('3');
    expect(t['m6-2026-11-09']).toBe('1');
  });

  it('writes items.json only under --out', () => {
    const db = fixtureDb();
    const out = mkTmp('ccrc-autonomy-out-');
    const r = itemsRun(['--db', db, ...WINDOW, '--out', path.join(out, 'o')]);
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(out, { recursive: true }).map(String).sort()).toEqual(['o', 'o/items.json']);
    const j = JSON.parse(readFileSync(path.join(out, 'o', 'items.json'), 'utf8')) as { programmes: { slug: string }[] };
    expect(j.programmes.map((x) => x.slug)).toEqual(['alpha', 'beta']);
  });

  it('leaves the database bytes and mtime unchanged', () => {
    const db = fixtureDb();
    utimesSync(db, 1_700_000_000, 1_700_000_000);
    const before = { bytes: readFileSync(db), mtime: statSync(db).mtimeMs };
    const r = itemsRun(['--db', db, ...WINDOW]);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(db).equals(before.bytes)).toBe(true);
    expect(statSync(db).mtimeMs).toBe(before.mtime);
  });

  it('exits 2 for a missing --db and creates no file', () => {
    const dir = mkTmp('ccrc-autonomy-db-');
    const gone = path.join(dir, 'coord.db');
    const r = itemsRun(['--db', gone, ...WINDOW]);
    expect(r.status).toBe(2);
    expect(readdirSync(dir)).toEqual([]);
  });
});
