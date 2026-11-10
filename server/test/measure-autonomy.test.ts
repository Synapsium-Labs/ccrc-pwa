// `deploy/measure-autonomy.py` (coordinator-autonomy spec §1.2 and §10) against neutral transcript fixtures under
// `test/fixtures/measure-autonomy/`. The script is run as a subprocess; its functions are reached through its
// subcommands, never by import.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMailNudge } from '../src/coord/envelope.js';
import { stallCoordBlockedPushText, stallDetail } from '../src/coord/stall.js';
import type { StallCoordBlockedInput, StallNotify } from '../src/coord/stall.js';
import {
  IDLE_COMPACT_NUDGE_PROMPT, RESUME_PROMPT_PREFIX, MAIL_ENVELOPE_FENCE, ASK_OPERATOR_PRINCIPAL, RUN_TRANSITIONS,
} from '../../shared/api.js';
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

/** The title `stallCoordBlockedPushText` writes at a rung, for workspace `ws`. */
function blockedTitle(rung: 1 | 2): string {
  const input = {
    session: {
      sessionId: 'demo-coord', role: 'coordinator', run: null, worker: { present: false }, mark: { ok: false },
      liveStartedAt: null, markUnreadableSince: null, mail: [], deliveries: [], notices: [],
      arming: { disabled: false, live: true, escalate: true }, coordinationPaused: false,
    },
    child: { kind: 'unlisted' }, runs: [], episode: null,
  } as unknown as StallCoordBlockedInput;
  const n = { mode: 'live', arm: 'coord-blocked', rung, key: 1, at: 0 } as StallNotify;
  return stallCoordBlockedPushText(input, n, Date.now()).title;
}

describe('measure-autonomy transcripts', () => {
  it('its second spellings are bound to shared/api.ts’s', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toContain(JSON.stringify(IDLE_COMPACT_NUDGE_PROMPT).slice(1, -1).replace(/\\"/g, '"'));
    expect(src).toContain(RESUME_PROMPT_PREFIX);
    expect(src).toContain(`MAIL_NUDGE_HEAD = '${renderMailNudge('x').slice(0, 29)}'`);
    expect(src).toContain(`MAIL_FENCE = '${MAIL_ENVELOPE_FENCE}'`);
    expect(src).toContain(`OPERATOR_PRINCIPAL = '${ASK_OPERATOR_PRINCIPAL}'`);
    // the shadow detail head `stallDetail` writes, up to the rung
    const detailHead = stallDetail('shadow', 'coord-blocked', 1, 0).split(':').slice(0, 2).join(':') + ':';
    expect(src).toContain(`'${detailHead}%'`);
    // the title's rung-1 spelling and its rung-2 suffix, as `stallCoordBlockedPushText` writes them
    expect(src).toContain(`BLOCKED_TITLE = '${blockedTitle(1).split(' ›')[0]!.replace('⚠', '\\u26a0')}'`);
    expect(blockedTitle(2).startsWith(blockedTitle(1).split(' ›')[0]!)).toBe(true);
    expect(src).toContain(`BLOCKED_TITLE + ' (escalated)%'`);
    expect(blockedTitle(2)).toContain(' (escalated)');
    expect(blockedTitle(1)).toContain(' ›');
    expect(src).toContain(`BLOCKED_TITLE + ' \\u203a%'`);
    // the states `RUN_TRANSITIONS` leaves no edge out of
    const terminal = Object.entries(RUN_TRANSITIONS).filter(([, to]) => to.length === 0).map(([k]) => k).sort();
    const m = /RUN_TERMINAL = \(([^)]*)\)/.exec(src);
    expect(m, 'RUN_TERMINAL').not.toBeNull();
    expect(m![1]!.split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean).sort()).toEqual(terminal);
    // `server/src/idlenudge.ts`'s turn-end system rows
    const nudge = readFileSync(path.join(ROOT, 'server', 'src', 'idlenudge.ts'), 'utf8');
    const t = /TURN_END_SUBTYPES: readonly string\[\] = \[([^\]]*)\]/.exec(nudge);
    const u = /^TURN_END_SUBTYPES = \(([^)]*)\)/m.exec(src);
    expect(t && u, 'TURN_END_SUBTYPES').toBeTruthy();
    const names = (x: string): string[] => x.split(',').map((y) => y.trim().replace(/'/g, '')).filter(Boolean).sort();
    expect(names(u![1]!)).toEqual(names(t![1]!));
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
    // intent and a dispatched run, no Skill use: a coordinator by intent alone
    expect(census(tree('coord-intent')).table['coordinators']).toBe('1');
    // the skill loaded, no run opened or dispatched: not a coordinator
    const s = census(tree('coord-skill-only'));
    expect(s.table['transcripts']).toBe('1');
    expect(s.table['coordinators']).toBe('0');
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
 *  4 asks that reached the operator), programme `beta` (one run open 2026-11-04 01:00 to 05:00 = 1 day, nothing raised),
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
  ev.run(alphaRun, T('2026-11-03T06:00:00Z'), 'dispatched', 'dispatched', 'watcher');
  db.prepare('UPDATE run_events SET detail = ? WHERE runId = ? AND at = ?').run(stallDetail('shadow', 'coord-blocked', 1, 5), alphaRun, T('2026-11-03T06:00:00Z'));
  const item = db.prepare(
    "INSERT INTO operator_items (program, runId, raisedBy, kind, title, why, how, neededBy, state, raisedAt) " +
    "VALUES (?, NULL, 'coord', 'decision', 't', 'w', '[]', 'soon', 'open', ?)");
  for (const at of ['2026-11-02T11:00:00Z', '2026-11-02T12:00:00Z', '2026-11-03T07:00:00Z', '2026-10-20T09:00:00Z']) item.run('alpha', T(at));
  const ask = db.prepare(
    "INSERT INTO asks (at, childId, parentId, runId, askKey, askAt, dialogId, question, options, state, answeredBy, answeredAt, " +
    "releasedAt, releaseReason) VALUES (?, 'child', ?, ?, 'k', 1, 'd', 'q', '[]', ?, ?, ?, ?, ?)");
  ask.run(T('2026-11-02T13:00:00Z'), 'parent-1', alphaRun, 'released', null, null, T('2026-11-02T13:00:00Z'), 'parent-not-live');
  ask.run(T('2026-11-02T14:00:00Z'), 'parent-1', alphaRun, 'answered', 'parent-1', T('2026-11-02T14:01:00Z'), null, null);
  // reached the operator through a coordinator: the sweep's lapse and the parent's own hand-over (releaseReason null)
  ask.run(T('2026-11-02T15:00:00Z'), 'parent-1', alphaRun, 'released', null, null, T('2026-11-02T15:30:00Z'), null);
  ask.run(T('2026-11-02T16:00:00Z'), 'parent-1', alphaRun, 'declined', null, null, T('2026-11-02T16:05:00Z'), null);
  // asked of the operator directly: counted by `at` when the operator answered it, not when it went stale
  ask.run(T('2026-11-02T17:00:00Z'), 'operator', alphaRun, 'answered', 'operator', T('2026-11-02T17:10:00Z'), null, null);
  ask.run(T('2026-11-02T18:00:00Z'), 'operator', alphaRun, 'stale', null, null, T('2026-11-02T18:20:00Z'), null);
  // decided by nobody: the dialog vanished while a coordinator held it
  ask.run(T('2026-11-02T19:00:00Z'), 'parent-1', alphaRun, 'stale', null, null, T('2026-11-02T19:10:00Z'), null);
  const feed = db.prepare("INSERT INTO feed_events (epoch, seq, at, kind, sessionId, title, body) VALUES ('e', ?, ?, 'run', ?, ?, 'b')");
  let seq = 0;
  const blocked = (iso: string, session: string, title = blockedTitle(1)): void => { feed.run(++seq, T(iso), session, title); };
  blocked('2026-11-03T10:05:00Z', 'c1');
  blocked('2026-11-03T10:50:00Z', 'c1', blockedTitle(2));   // the same session-hour
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
  it('reads M3 per programme-day: 3.5, 0.0 and 2.33 over all', () => {
    const r = itemsRun(['--db', fixtureDb(), ...WINDOW]);
    expect(r.status, r.stderr).toBe(0);
    const t = rows(r.stdout);
    expect(t['programmes']).toBe('2');
    expect(t['m3-p1']).toBe('items=3 asks=4 days=2 value=3.5');
    expect(t['m3-p2']).toBe('items=0 asks=0 days=1 value=0.0');
    expect(t['m3-all']).toBe('items=3 asks=4 days=3 value=2.33');
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
    expect(t['m3-p1']).toContain('asks=4 ');   // not the answered one, not the two stale ones
  });

  it('reads M6 per week: coordinator-hours flagged by coord-blocked', () => {
    const t = rows(itemsRun(['--db', fixtureDb(), ...WINDOW]).stdout);
    // week of 2026-11-02: c1 at 10:00 and 11:00, c2 at 10:00 = 3; week of 2026-11-09: c1 = 1; the other arm is not counted
    expect(t['m6-2026-11-02']).toBe('3');
    expect(t['m6-2026-11-09']).toBe('1');
  });

  it('counts the shadow observations the feed does not carry, so an unarmed box is not read as zero', () => {
    const t = rows(itemsRun(['--db', fixtureDb(), ...WINDOW]).stdout);
    expect(t['m6-shadow-rows']).toBe('1');
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

// ── sample and score: the M4 draw and its per-part share (spec §5.1's split rule) ──
const csvIds = (file: string): string[] =>
  readFileSync(file, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')[0]);

describe('measure-autonomy sample and score', () => {
  const wide = ['--since', '2026-10-01', '--until', '2026-11-16'];

  it('draws the same ids twice for the same seed', () => {
    const db = fixtureDb();
    const draw = (): string[] => {
      const out = mkTmp('ccrc-autonomy-out-');
      const r = run(['sample', '--db', db, '--n', '2', '--seed', '7', ...wide, '--out', out]);
      expect(r.status, r.stderr).toBe(0);
      return csvIds(path.join(out, 'sample.csv'));
    };
    const first = draw();
    expect(first).toHaveLength(2);
    expect(draw()).toEqual(first);
  });

  it('writes sample.csv with the columns id, kind, title, why, parts and an empty parts', () => {
    const out = mkTmp('ccrc-autonomy-out-');
    const r = run(['sample', '--db', fixtureDb(), '--n', '30', '--seed', '1', ...wide, '--out', out]);
    expect(r.status, r.stderr).toBe(0);
    const lines = readFileSync(path.join(out, 'sample.csv'), 'utf8').trim().split('\n');
    expect(lines[0]).toBe('id,kind,title,why,parts');
    expect(lines).toHaveLength(5);          // all four items: n exceeds the pool
    expect(lines[1].endsWith(',')).toBe(true);
    expect(readdirSync(out)).toEqual(['sample.csv']);
  });

  it('exits 2 for a missing --db and creates no file', () => {
    const dir = mkTmp('ccrc-autonomy-db-');
    const r = run(['sample', '--db', path.join(dir, 'coord.db'), '--n', '3', '--seed', '1', '--out', path.join(dir, 'o')]);
    expect(r.status).toBe(2);
    expect(readdirSync(dir)).toEqual([]);
  });

  const scoreFile = (body: string): string => {
    const f = path.join(mkTmp('ccrc-autonomy-score-'), 'filled.csv');
    writeFileSync(f, 'id,kind,title,why,parts\n' + body);
    return f;
  };

  it('reads 3 of 4 parts as 75% routine or big', () => {
    const r = run(['score', scoreFile('1,decision,t,w,routine\n2,decision,t,w,o3\n3,decision,t,w,big;routine\n')]);
    expect(r.status, r.stderr).toBe(0);
    const t = rows(r.stdout);
    expect(t['parts']).toBe('4');
    expect(t['routine-or-big']).toBe('3');
    expect(t['m4']).toBe('75.0');
  });

  it('refuses a row with an unknown class and names the row', () => {
    const r = run(['score', scoreFile('1,decision,t,w,routine\n9,decision,t,w,maybe\n')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('9');
    expect(r.stderr).toContain('maybe');
  });

  it('refuses a row with no parts', () => {
    const r = run(['score', scoreFile('5,decision,t,w,\n')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('5');
  });
});

// ── calls: M5, M7 and M8 over the call record, and --pinned-from-server for M2 (D-8126, plan Task A10-1) ──
function callsDb(): string {
  const dbPath = path.join(mkTmp('ccrc-autonomy-calls-'), 'coord.db');
  const db = openCoordDb(dbPath);
  db.prepare('INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, ?)').run('alpha', 'Alpha', T('2026-10-01T00:00:00Z'), 'active');
  const runId = Number(db.prepare('INSERT INTO runs (program, wave, project, state, openedAt) VALUES (?, 1, ?, ?, ?)')
    .run('alpha', 'demo', 'dispatched', T('2026-11-02T10:00:00Z')).lastInsertRowid);
  const call = db.prepare(
    'INSERT INTO coordinator_calls (program, runId, madeBy, class, question, options, chosen, why, reversible, wakeOn, expiresAt, at, overturnedAt, wokenAt) ' +
    'VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?, ?, ?, ?)');
  const at = (iso: string): number => T(iso);
  // nine big calls (two overturned) and a tenth that is also an M8 hit: ten in the window, 2 overturned
  for (let i = 0; i < 9; i++) {
    call.run('alpha', runId, 'coord-1', 'big', null, `chose option ${i}`, 'because', null, null, at('2026-11-03T09:00:00Z') + i * 60_000,
      i < 2 ? at('2026-11-04T09:00:00Z') : null, null);
  }
  call.run('alpha', runId, 'coord-1', 'big', 'May the work switch to usage credits?', 'switched to usage credits', 'cheaper', null, null,
    at('2026-11-03T16:00:00Z'), null, null);
  // a big call before the window, overturned: not counted
  call.run('alpha', runId, 'coord-1', 'big', null, 'old choice', 'because', null, null, at('2026-10-01T09:00:00Z'), at('2026-10-02T09:00:00Z'), null);
  // a block woken at 12:00; its coordinator's next call is at 12:04 (M7 = 4 minutes)
  call.run('alpha', runId, 'coord-2', 'block', null, 'wait for the review', 'the review is pending', 'condition:review-done',
    at('2026-11-04T09:00:00Z'), at('2026-11-03T11:00:00Z'), null, at('2026-11-03T12:00:00Z'));
  call.run('alpha', runId, 'coord-2', 'routine', null, 'carried on with the next task', 'plain', null, null, at('2026-11-03T12:04:00Z'), null, null);
  // a block that lapsed at 14:00 (no wake): the programme's run moves at 14:10 (M7 = 10 minutes)
  call.run('alpha', runId, 'coord-3', 'block', null, 'wait for the build', 'the build is running', 'condition:build',
    at('2026-11-03T14:00:00Z'), at('2026-11-03T13:00:00Z'), null, null);
  db.prepare('INSERT INTO run_events (runId, at, fromState, toState, causedBy) VALUES (?, ?, ?, ?, ?)')
    .run(runId, at('2026-11-03T14:10:00Z'), 'dispatched', 'closing', 'coordinator');
  // M8: a routine call whose text names an operator-only act (the deploy, O1)
  call.run('alpha', runId, 'coord-1', 'routine', null, 'deployed the server to the live box', 'it was ready', null, null, at('2026-11-03T15:00:00Z'), null, null);
  db.close();
  return dbPath;
}
const callsRun = (args: string[] = []) =>
  run(['calls', '--db', callsDb(), '--since', '2026-11-02', '--until', '2026-11-16', ...args]);

describe('measure-autonomy calls', () => {
  it('reads M5 as 20% when 2 of 10 big calls in the window were overturned', () => {
    const r = callsRun();
    expect(r.status, r.stderr).toBe(0);
    const t = rows(r.stdout);
    expect(t['m5-big']).toBe('10');
    expect(t['m5-overturned']).toBe('2');
    expect(t['m5']).toBe('20');
  });

  it('reads M7 from a woken block to the coordinator\'s next call, and a lapsed block to the run event', () => {
    const t = rows(callsRun().stdout);
    expect(t['m7-cleared']).toBe('2');
    expect(t['m7-acted']).toBe('2');
    expect(t['m7-median-min']).toBe('7');   // 4 and 10 minutes
    expect(t['m7-max-min']).toBe('10');
    expect(t['m7-over-10']).toBe('0');
  });

  it('lists the calls whose text names an O1 to O4 act for a human to audit, and writes them under --out only', () => {
    const out = mkTmp('ccrc-autonomy-m8-');
    const r = callsRun(['--out', out]);
    expect(r.status, r.stderr).toBe(0);
    const t = rows(r.stdout);
    expect(t['m8-listed']).toBe('2');
    const csv = readFileSync(path.join(out, 'm8-audit.csv'), 'utf8').trim().split('\n');
    expect(csv[0]).toBe('id,class,act,excerpt');
    expect(csv).toHaveLength(3);
    expect(csv.some((l) => /,routine,o1,/.test(l))).toBe(true);
    expect(csv.some((l) => /,big,o2,/.test(l))).toBe(true);
  });

  it('opens the database read-only and refuses a missing one without creating it', () => {
    const missing = path.join(mkTmp('ccrc-autonomy-none-'), 'none.db');
    const r = run(['calls', '--db', missing]);
    expect(r.status).toBe(2);
    expect(existsSync(missing)).toBe(false);
  });
});

describe('measure-autonomy transcripts --pinned-from-server', () => {
  const jsonl = (rowsIn: object[]): string => rowsIn.map((r) => JSON.stringify(r)).join('\n') + '\n';
  /** A coordinator transcript on `slug` that opens one dialog and has it answered after `mins` minutes. */
  const coordOn = (slug: string, mins: number): string => jsonl([
    { type: 'assistant', uuid: `${slug}-1`, timestamp: '2026-11-02T09:00:00.000Z', message: { id: `${slug}-m1`, role: 'assistant', stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 's', name: 'Skill', input: { skill: 'ccrc-coordinator' } },
      { type: 'tool_use', id: 'b', name: 'Bash', input: { command: `ccrc-api runs open --program ${slug} --wave 1` } },
      { type: 'tool_use', id: 'g', name: 'Bash', input: { command: `ccrc-api goals show ${slug}` } }] } },
    { type: 'assistant', uuid: `${slug}-2`, timestamp: '2026-11-02T09:10:00.000Z', message: { id: `${slug}-m2`, role: 'assistant', stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 'q', name: 'AskUserQuestion', input: { questions: [{ question: 'Which layout?' }] } }] } },
    { type: 'user', uuid: `${slug}-3`, timestamp: new Date(Date.parse('2026-11-02T09:10:00Z') + mins * 60_000).toISOString(),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'q', content: 'first' }] } },
  ]);
  const stubDir = (): { dir: string; bin: string; log: string } => {
    const dir = mkTmp('ccrc-autonomy-stub-');
    const bin = path.join(dir, 'ccrc-api');
    const log = path.join(dir, 'calls.log');
    writeFileSync(bin, [
      '#!/bin/sh',
      `echo "$*" >> '${log}'`,
      'case "$1 $2" in',
      '  "runs list") echo \'[{"id":1,"program":"pinned-one"},{"id":2,"program":"loose-one"},{"id":3,"program":"pinned-one"}]\' ;;',
      '  "goals show") case "$3" in',
      '    pinned-one) echo \'{"goals":{"program":"pinned-one","specPath":"docs/spec.md","modifications":[]},"openItems":[],"bigCalls":[]}\' ;;',
      '    *) echo \'{"goals":{"program":"loose-one","specPath":null,"modifications":[]},"openItems":[],"bigCalls":[]}\' ;;',
      '  esac ;;',
      '  *) echo "unexpected verb" >&2; exit 9 ;;',
      'esac', '',
    ].join('\n'), { mode: 0o755 });
    return { dir, bin, log };
  };
  const rootWith = (): string => {
    const dir = mkTmp('ccrc-autonomy-pin-');
    for (const [name, body] of [['pinned-one', coordOn('pinned-one', 30)], ['loose-one', coordOn('loose-one', 45)]] as const) {
      const sub = path.join(dir, name);
      mkdirSync(sub, { recursive: true });
      writeFileSync(path.join(sub, `${name}.jsonl`), body);
    }
    return dir;
  };

  it('counts M2 over the pinned programmes only, reading the list through goals show and runs list', () => {
    const { bin, log } = stubDir();
    const out = mkTmp('ccrc-autonomy-pin-out-');
    const r = run(['transcripts', '--root', rootWith(), '--out', out, '--pinned-from-server', '--ccrc-api', bin]);
    expect(r.status, r.stderr).toBe(0);
    const t = rows(r.stdout);
    expect(t['pinned-programmes']).toBe('1');
    expect(t['m2']).toMatch(/^count=1 /);
    expect(t['m2']).toContain('hours=0.5');
    expect(t['dialog']).toMatch(/^count=2 /);   // the unfiltered census is still printed
    const calls = readFileSync(log, 'utf8').trim().split('\n').sort();
    expect(calls).toEqual(['goals show loose-one', 'goals show pinned-one', 'runs list']);
  });

  it('refuses any other verb before the client runs', () => {
    const { bin, log } = stubDir();
    const py = [
      'import importlib.util, sys',
      `spec = importlib.util.spec_from_file_location('ma', ${JSON.stringify(SCRIPT)})`,
      'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      `m.CCRC_API_BIN = ${JSON.stringify(bin)}`,
      'for verb in (["mail", "send"], ["runs", "open"], ["goals", "pin", "x"], ["goals", "show"], ["runs", "list", "--all"]):',
      '    try:',
      '        m.ccrc_api(verb)',
      '    except SystemExit as e:',
      '        assert e.code == 2, (verb, e.code)',
      '    else:',
      '        raise AssertionError(verb)',
    ].join('\n');
    const r = spawnSync('python3', ['-I', '-c', py], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(log)).toBe(false);
  });
});
