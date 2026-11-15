// server/test/overlord-read.test.ts — the Overlord's history read: the request and answer readers
// (shared/overlordHistory.ts) and the read module (ccd/history/overlord-read.mjs) on a fixture store (plan
// docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md, Task 3; ruled F3, F4, F5, R1, R3).
//
// The module runs in a file worker inside a child process (the agent's own way of running it), never in-process; the
// credential case runs it in a child process's main thread, under the read spy, because a worker started with
// `env: {}` would leave the spy inert. Every HOME is a fixture under the per-run temp root.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import * as lib from '../../ccd/history/lib.mjs';
import { OVERLORD_READ_ANSWER_MAX_BYTES } from '../../ccd/history/overlord-read.mjs';
import * as overlordHistory from '../../shared/overlordHistory.js';
import { HISTORY_REASON_WORDS, OVERLORD_HISTORY_ANSWER_MAX_BYTES, readOverlordHistoryAnswer, overlordTargetId } from '../../shared/overlordHistory.js';
import { requestReaderCases, answerReaderCases } from './sim/overlordHistorySets.js';
import {
  makeHistoryBox, runSweep, runCli, withPane, seedFamily, preloadOptions, PRELOADS, REPO, type HistoryBox,
} from './historyHelpers.js';
import { userRow, assistantRow, boundaryRow, summaryRow, type Row } from './historyFixtures.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const HEAVY = 180_000;
const HIST = path.join(REPO, 'ccd', 'history');
const WORKER = path.join(HIST, 'overlord-worker.mjs');
const READ = path.join(HIST, 'overlord-read.mjs');

// ── the request and answer readers: their cases live once, in sim/overlordHistorySets.ts ─────────────────────────────
describe('readOverlordHistoryRequest: the one reader of a request', () => {
  for (const [name, c] of Object.entries(requestReaderCases(overlordHistory))) it(name, c);

  it('the canonical target id', () => {
    expect([overlordTargetId({ kind: 'all' }), overlordTargetId({ kind: 'project', project: 'p' }), overlordTargetId({ kind: 'session', session: 's' })])
      .toEqual(['all', 'project:p', 'session:s']);
  });
});

describe('readOverlordHistoryAnswer: the one reader of an answer', () => {
  for (const [name, c] of Object.entries(answerReaderCases(overlordHistory))) it(name, c);

  it('the parity of the history words: the copy is exactly lib.mjs REASONS, both ways', () => {
    const libWords = Object.keys(lib.REASONS).sort();
    expect(libWords.length, 'CONTROL: lib was read').toBeGreaterThan(40);
    expect([...HISTORY_REASON_WORDS].sort()).toEqual(libWords);
  });

  it("the module's bound is the wire's bound", () => {
    expect(OVERLORD_READ_ANSWER_MAX_BYTES).toBe(OVERLORD_HISTORY_ANSWER_MAX_BYTES);
  });
});

// ── the module on a fixture store ────────────────────────────────────────────────────────────────────────────────
const ID_A = 'lane-a-project-a';
const ID_B = 'lane-b-project-b';
const GA = '0189abcd-1234-4678-9abc-0123456789ab';
const GB = '0189abcd-1234-4678-9abc-0123456789ad';
const TA = 'a1a1a1a1-1111-4111-8111-111111111111';
const TB = 'b2b2b2b2-2222-4222-8222-222222222222';
const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const rid = (t: string, n: number): string => `${t.slice(0, 8)}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const iso = (k: number): string => new Date(T0 + k * 1000).toISOString();
const SECRET = ['Qzv7', 'Kp2m', 'Wx9L', 'rT4n', 'Bh6Y', 'cJ8d'].join('');

/** `n` compaction cycles whose texts carry `word`, so the family has nodes (history-recall.test.ts' `cycles`). */
function cycles(t: string, n: number, word: string): Row[] {
  const rows: Row[] = [];
  const cwd = '/home/u/worktrees/p/quiet-basin';
  let k = 0;
  for (let c = 1; c <= n; c += 1) {
    const u = rid(t, ++k); const a = rid(t, ++k); const x = rid(t, ++k); const b = rid(t, ++k); const s = rid(t, ++k);
    const base = { sessionId: t, cwd };
    rows.push(userRow({ ...base, uuid: u, ts: iso(5 * c), text: `fixture request ${word} ${c} zqsecretword ${SECRET}` }));
    rows.push(assistantRow({ ...base, uuid: a, ts: iso(5 * c + 1), text: `Fixture answer ${word} ${c}.`, requestId: `req_${t.slice(0, 4)}_${c}`, msgId: `msg_${t.slice(0, 4)}_${c}` }));
    rows.push(userRow({ ...base, uuid: x, ts: iso(5 * c + 2), text: `fixture follow-up ${c}` }));
    rows.push(boundaryRow({ ...base, uuid: b, ts: iso(5 * c + 3), trigger: 'manual', headUuid: x, anchorUuid: s, tailUuid: x, allUuids: [x] }));
    rows.push(summaryRow({ ...base, uuid: s, ts: iso(5 * c + 4), text: [
      'This session is being continued from a previous conversation. The summary below covers the earlier portion.',
      '<summary>', '1. Primary Request and Intent:', `   Fixture request ${c}.`,
      '8. Current Work:', `   Wrote part ${c} of the fixture.`,
      '9. Optional Next Step:', `   Continue with part ${c + 1}.`, '</summary>',
    ].join('\n') }));
  }
  return rows;
}

function twoProjects(prefix: string): HistoryBox {
  const box = makeHistoryBox(prefix);
  seedFamily(box, { id: ID_A, project: 'project-a', uuid: TA, generation: GA, rows: cycles(TA, 2, 'zqalpha') });
  seedFamily(box, { id: ID_B, project: 'project-b', uuid: TB, generation: GB, rows: cycles(TB, 2, 'zqbravo') });
  expect(runSweep(box).code).toBe(0);   // one more tick: derivation shares the run budget
  return box;
}

const dbFile = (box: HistoryBox): string => path.join(box.root, 'db', 'history.db');
type Answer = Record<string, unknown> & { outcome: string };

/** overlord-worker.mjs in a file worker started as the agent starts it (env {}, both streams piped and drained), inside a
 *  child process; the answer and whatever the worker wrote on stderr. */
function readInWorker(box: HistoryBox, request: object): { answer: Answer; stderr: string } {
  const runner = path.join(box.home, `runner-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(runner, [
    "import { Worker } from 'node:worker_threads';",
    `const w = new Worker(${JSON.stringify(WORKER)}, { workerData: { home: ${JSON.stringify(box.home)}, request: ${JSON.stringify(request)}, nowMs: Date.now() }, env: {}, stdout: true, stderr: true });`,
    "let err = ''; let answer = null;",
    "w.stdout.on('data', () => {}); w.stderr.on('data', (c) => { err += c; });",
    "w.on('message', (m) => { answer = m; });",
    "w.on('error', () => { answer = { outcome: 'worker-error' }; });",
    "w.on('exit', () => { process.stdout.write(JSON.stringify({ answer, stderr: err })); });",
  ].join('\n'));
  const r = spawnSync(process.execPath, ['--no-warnings', runner], { encoding: 'utf8', timeout: 120_000, env: box.env });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as { answer: Answer; stderr: string };
}

const read = (box: HistoryBox, request: object): Answer => readInWorker(box, request).answer;

describe('overlord-read.mjs on a fixture store, in a worker', () => {
  it('reads across projects: search with target all finds project-b; the CLI inside project-a does not', () => {
    const box = twoProjects('ccrc-ovr-read-across-');
    const a = read(box, { verb: 'search', target: { kind: 'all' }, agents: false, args: ['zqbravo'] });
    expect(a.outcome, JSON.stringify(a).slice(0, 400)).toBe('rows');
    expect(a['total'] as number).toBeGreaterThan(0);
    expect(JSON.stringify(a['items'])).toContain('zqbravo');
    const both = read(box, { verb: 'search', target: { kind: 'all' }, agents: false, args: ['fixture'] });
    const ids = new Set((both['scope'] as { families: { ccrc_id: string }[] }).families.map((f) => f.ccrc_id));
    expect([...ids].sort()).toEqual([ID_A, ID_B]);
    const cli = runCli(box, ['grep', 'zqbravo', '--json'], { env: withPane(box, ID_A) });
    expect([cli.code, cli.json?.['total']], 'CONTROL: the CLI inside project-a reads only its own').toEqual([3, 0]);
    const own = read(box, { verb: 'search', target: { kind: 'project', project: 'project-a' }, agents: false, args: ['zqbravo'] });
    expect([own.outcome, own['exit'], own['total']], 'a project-a target does not reach project-b').toEqual(['rows', 3, 0]);
  }, HEAVY);

  it("a rows answer carries exactly exit, items, shown, total and scope; every item is untrusted; the scope names overlord and the canonical target", () => {
    const box = twoProjects('ccrc-ovr-read-fields-');
    const a = read(box, { verb: 'search', target: { kind: 'project', project: 'project-b' }, agents: false, args: ['zqbravo'] });
    expect(Object.keys(a).sort()).toEqual(['exit', 'items', 'outcome', 'scope', 'shown', 'total']);
    expect(readOverlordHistoryAnswer(a), 'the wire reader accepts it').not.toBe('off-shape');
    const items = a['items'] as Record<string, unknown>[];
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(it['trust']).toBe('untrusted');
    expect(a['scope']).toMatchObject({ kind: 'overlord', id: 'project:project-b', project: 'project-b', families_total: 1 });
  }, HEAVY);

  it("describe and expand of a project-b node answer what the CLI's own JSON carries in project-b, minus next", () => {
    const box = twoProjects('ccrc-ovr-read-describe-');
    const db = new DatabaseSync(dbFile(box), { readOnly: true });
    let node: string;
    try {
      node = (db.prepare("SELECT n.node_id AS id FROM nodes n JOIN sessions s ON s.session_pk = n.session_pk WHERE s.project = 'project-b' AND n.depth = 0 ORDER BY n.node_id LIMIT 1").get() as { id: string }).id;
    } finally { db.close(); }
    for (const verb of ['describe', 'expand'] as const) {
      const a = read(box, { verb, target: { kind: 'all' }, agents: false, args: [node] });
      const cli = runCli(box, [verb, node, '--json'], { env: withPane(box, ID_B) });
      expect(cli.code, cli.stderr).toBe(0);
      expect(a.outcome, JSON.stringify(a).slice(0, 300)).toBe('rows');
      expect([a['exit'], a['shown'], a['total']], verb).toEqual([cli.json!['exit'], cli.json!['shown'], cli.json!['total']]);
      expect(a['items'], verb).toEqual(cli.json!['items']);
      expect(a['scope'], verb).toMatchObject({ kind: 'overlord', id: 'all' });
      expect(Object.keys(a)).not.toContain('next');
    }
  }, HEAVY);

  it("the belt is the store's recorded pairs: a recorded value is masked, never carried", () => {
    const box = twoProjects('ccrc-ovr-read-belt-');
    const db = new DatabaseSync(dbFile(box));
    try {
      db.prepare('INSERT INTO redact_hashes (len, sha256, first_seen_ms) VALUES (?, ?, ?)')
        .run(SECRET.length, new Uint8Array(createHash('sha256').update(SECRET).digest()), Date.now());
    } finally { db.close(); }
    const a = read(box, { verb: 'search', target: { kind: 'all' }, agents: false, args: ['zqsecretword'] });
    expect(a.outcome).toBe('rows');
    const text = JSON.stringify(a);
    expect(text).toContain('zqsecretword');
    expect(text).not.toContain(SECRET);
    expect(text).toContain('[redacted]');
  }, HEAVY);

  it('store refusals: absent, unreadable, a damaged table, and no store at all', () => {
    const absent = makeHistoryBox('ccrc-ovr-read-absent-');
    expect(read(absent, { verb: 'search', target: { kind: 'all' }, agents: false, args: ['x'] })).toEqual({ outcome: 'store-refused', word: 'store-absent' });
    const none = makeHistoryBox('ccrc-ovr-read-none-', { shim: false });
    expect(read(none, { verb: 'search', target: { kind: 'all' }, agents: false, args: ['x'] })).toEqual({ outcome: 'store-refused', word: 'no-store' });
    const box = twoProjects('ccrc-ovr-read-store-');
    const db = new DatabaseSync(dbFile(box), { enableForeignKeyConstraints: false });
    try { db.exec('DROP TABLE redact_hashes'); } finally { db.close(); }
    const damaged = readInWorker(box, { verb: 'search', target: { kind: 'all' }, agents: false, args: ['zqbravo'] });
    expect(damaged.answer).toEqual({ outcome: 'store-refused', word: 'store-read-failed' });
    expect(damaged.stderr, 'CONTROL: the worker wrote its line on stderr, which the agent discards').toContain('store-read-failed');
    fs.writeFileSync(path.join(box.root, 'store.writer'), 'not a writer token\n');
    expect(read(box, { verb: 'search', target: { kind: 'all' }, agents: false, args: ['x'] })).toEqual({ outcome: 'store-refused', word: 'store-unmeasured' });
  }, HEAVY);

  it("verb refusals: an unindexed target, a bad id, a well-formed id not found (rows, no items), a bad argument", () => {
    const box = twoProjects('ccrc-ovr-read-verb-');
    expect(read(box, { verb: 'search', target: { kind: 'project', project: 'project-z' }, agents: false, args: ['x'] }))
      .toEqual({ outcome: 'verb-refused', word: 'not-indexed' });
    expect(read(box, { verb: 'search', target: { kind: 'session', session: 'lane-z-project-z' }, agents: false, args: ['x'] }))
      .toEqual({ outcome: 'verb-refused', word: 'not-indexed' });
    expect(read(box, { verb: 'describe', target: { kind: 'all' }, agents: false, args: ['not a node'] }))
      .toEqual({ outcome: 'verb-refused', word: 'bad-args' });
    const missing = read(box, { verb: 'describe', target: { kind: 'all' }, agents: false, args: ['N0123456789abcdef'] });
    expect([missing.outcome, missing['exit'], missing['items']]).toEqual(['rows', 3, []]);
    expect(read(box, { verb: 'search', target: { kind: 'all' }, agents: false, args: ['x', '--sort', 'sideways'] }))
      .toEqual({ outcome: 'verb-refused', word: 'bad-args' });
    expect(read(box, { verb: 'search', target: { kind: 'all' }, agents: false, args: ['--regex', 'a.*'] }), 'a --regex that reached the module is refused, no child')
      .toEqual({ outcome: 'request-refused', word: 'regex' });
  }, HEAVY);

  it('writes nothing: the db file and its -wal are byte-identical after every read', () => {
    const box = twoProjects('ccrc-ovr-read-nowrite-');
    // A WAL reader's open creates an EMPTY -wal when none stands (the CLI's openReader does the same): no byte is written,
    // so an absent -wal and an empty one read alike. The -shm is not compared: a reader records its read position there.
    const bytes = (f: string): string => {
      const b = fs.existsSync(f) ? fs.readFileSync(f) : Buffer.alloc(0);
      return b.length === 0 ? 'empty' : createHash('sha256').update(b).digest('hex');
    };
    const before = [bytes(dbFile(box)), bytes(`${dbFile(box)}-wal`)];
    for (const verb of ['search', 'describe', 'expand'] as const) {
      read(box, { verb, target: { kind: 'all' }, agents: true, args: verb === 'search' ? ['fixture'] : ['N0123456789abcdef'] });
    }
    expect([bytes(dbFile(box)), bytes(`${dbFile(box)}-wal`)]).toEqual(before);
  }, HEAVY);
});

describe('no credential file is opened (R1), in a child process under the read spy', () => {
  it('the read opens no ~/.cc-secrets file, no box token and no ccrc.env, and still answers', () => {
    const box = twoProjects('ccrc-ovr-read-spy-');
    fs.mkdirSync(path.join(box.home, '.cc-secrets'), { recursive: true });
    fs.writeFileSync(path.join(box.home, '.cc-secrets', 'sentinel.env'), 'SENTINEL_KEY=sentinel-value-1\n');
    fs.writeFileSync(path.join(box.home, '.cc-secrets', 'ccrc-mail.token'), 'sentinel-token\n');
    fs.writeFileSync(path.join(box.home, '.ccrc', 'mail.token'), 'sentinel-token\n');
    fs.writeFileSync(path.join(box.home, '.ccrc', 'agent.env'), 'CCRC_AGENT_TOKEN=sentinel\n');
    expect(fs.existsSync(path.join(box.home, '.ccrc', 'ccrc.env')), 'CONTROL: the box carries a ccrc.env').toBe(true);
    const spy = path.join(box.home, 'readspy.log');
    const probe = path.join(box.home, 'probe.mjs');
    fs.writeFileSync(probe, [
      `import { overlordRead } from ${JSON.stringify(pathToFileURL(READ).href)};`,
      `const a = await overlordRead(${JSON.stringify(box.home)}, { verb: 'search', target: { kind: 'all' }, agents: true, args: ['fixture'] }, Date.now());`,
      'process.stdout.write(JSON.stringify(a));',
    ].join('\n'));
    const r = spawnSync(process.execPath, ['--no-warnings', probe], {
      encoding: 'utf8', timeout: 120_000, env: { ...box.env, HISTORY_TEST_READSPY: spy, NODE_OPTIONS: preloadOptions([PRELOADS.readspy]) },
    });
    expect(r.status, r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as Answer).outcome).toBe('rows');
    const opened = fs.readFileSync(spy, 'utf8');
    expect(opened, 'CONTROL: the spy recorded the store reads').toContain('history');
    for (const p of ['.cc-secrets', 'mail.token', 'ccrc.env', 'agent.env', 'auth-scratch', 'operator-secrets']) expect(opened, p).not.toContain(p);
  }, HEAVY);
});
