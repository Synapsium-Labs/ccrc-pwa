// server/test/overlord-read.test.ts — the Overlord's history read: the request and answer readers
// (shared/overlordHistory.ts) and the read module (ccd/history/overlord-read.mjs) on a fixture store (plan
// docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md, Task 3; ruled F3, F4, F5, R1, R3).
//
// The module runs in a file worker inside a child process (the agent's own way of running it), never in-process; the
// credential case runs it in a child process's main thread, under the open spy (fixtures/overlord-history/
// preload-openspy.mjs: sync, callback and promise opens and streams), because a worker started with `env: {}` would leave
// the spy inert. Every HOME is a fixture under the per-run temp root.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import * as lib from '../../ccd/history/lib.mjs';
import { OVERLORD_READ_ANSWER_MAX_BYTES, TOUCHED_SESSIONS_MAX } from '../../ccd/history/overlord-read.mjs';
import * as overlordHistory from '../../shared/overlordHistory.js';
import {
  HISTORY_REASON_WORDS, OVERLORD_HISTORY_ANSWER_MAX_BYTES, OVERLORD_HISTORY_SCOPE_ARGS, OVERLORD_HISTORY_TOUCHED_SESSIONS_MAX,
  readOverlordHistoryAnswer, readOverlordHistoryRequest, overlordTargetId,
} from '../../shared/overlordHistory.js';
import { requestReaderCases, answerReaderCases } from './sim/overlordHistorySets.js';
import {
  makeHistoryBox, runSweep, runCli, withPane, seedFamily, preloadOptions, REPO, type HistoryBox,
} from './historyHelpers.js';
import { userRow, assistantRow, boundaryRow, summaryRow, type Row } from './historyFixtures.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const HEAVY = 180_000;
const HIST = path.join(REPO, 'ccd', 'history');
const WORKER = path.join(HIST, 'overlord-worker.mjs');
const READ = path.join(HIST, 'overlord-read.mjs');
const OPENSPY = path.join(REPO, 'server', 'test', 'fixtures', 'overlord-history', 'preload-openspy.mjs');

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

describe("the request reader's hand copies of lib's grammar, both ways (review 2126 F8)", () => {
  const read = (raw: unknown): unknown => {
    const r = readOverlordHistoryRequest(raw);
    return r.ok ? 'ok' : r.refusal;
  };

  it("the scope flags are exactly lib's options every read verb takes (COMMON_READ_OPTIONS)", () => {
    const perVerb = Object.values(lib.READ_OPTIONS).map((spec) => new Set(Object.keys((spec as { options: object }).options)));
    expect(perVerb.length, 'CONTROL: the table was read').toBeGreaterThanOrEqual(5);
    const common = [...perVerb[0]!].filter((o) => perVerb.every((s) => s.has(o))).sort();
    expect(common.length, 'CONTROL: the common options are not empty').toBeGreaterThan(0);
    expect([...OVERLORD_HISTORY_SCOPE_ARGS].sort()).toEqual(common);
    for (const flag of common) expect(read({ verb: 'search', target: { kind: 'all' }, args: ['x', flag] }), flag).toBe('bad-args');
  });

  it("a project or session name is exactly lib's idOk, its length bound SPOOL_ID_MAX included", () => {
    const names = [
      'a', 'lane-a-project-a', 'A.b_c-9', '.', '..', '', ' ', 'a b', 'a/b', '\u00e9', 'a\nb',
      ...Array.from({ length: 95 }, (_, k) => String.fromCharCode(32 + k)),
      'x'.repeat(lib.SPOOL_ID_MAX), 'x'.repeat(lib.SPOOL_ID_MAX + 1),
    ];
    expect(lib.idOk('x'.repeat(lib.SPOOL_ID_MAX)) && !lib.idOk('x'.repeat(lib.SPOOL_ID_MAX + 1)), 'CONTROL: lib bounds the length').toBe(true);
    for (const name of names) {
      const want = lib.idOk(name);
      expect(read({ verb: 'search', target: { kind: 'project', project: name }, args: ['x'] }) === 'ok', `project ${JSON.stringify(name)}`).toBe(want);
      expect(read({ verb: 'search', target: { kind: 'session', session: name }, args: ['x'] }) === 'ok', `session ${JSON.stringify(name)}`).toBe(want);
    }
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

  it("no --json is appended (review 2126 F3): a bare -- that reached the module is refused, and a trailing value-taking option is the verb's bad-args", () => {
    const box = twoProjects('ccrc-ovr-read-sep-');
    expect(read(box, { verb: 'search', target: { kind: 'all' }, agents: false, args: ['--', 'zqbravo'] }), 'a bare --')
      .toEqual({ outcome: 'request-refused', word: 'separator' });
    for (const [verb, args] of [['search', ['zqbravo', '--cursor']], ['describe', ['--node']], ['expand', ['--around']]] as const) {
      expect(read(box, { verb, target: { kind: 'all' }, agents: false, args: [...args] }), `${verb} ${args.join(' ')}`)
        .toEqual({ outcome: 'verb-refused', word: 'bad-args' });
    }
    const ok = read(box, { verb: 'search', target: { kind: 'all' }, agents: false, args: ['zqbravo'] });
    expect([ok.outcome, ok['exit']], 'CONTROL: the same words without the dangling option read').toEqual(['rows', 0]);
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
    for (const verb of ['search', 'describe', 'expand', 'touched'] as const) {
      const args = verb === 'search' ? ['fixture'] : verb === 'touched' ? ['ccd/one.mjs', 'ccd/two.mjs'] : ['N0123456789abcdef'];
      const a = read(box, { verb, target: { kind: 'all' }, agents: true, args });
      if (verb === 'touched') expect(a.outcome, 'CONTROL: touched read the store').toBe('rows');
    }
    expect([bytes(dbFile(box)), bytes(`${dbFile(box)}-wal`)]).toEqual(before);
  }, HEAVY);
});

describe('no credential file is opened (R1), in a child process under the open spy (review 2126 F4)', () => {
  it('search, describe and expand open no ~/.cc-secrets file, no box token and no ccrc.env, by any fs form, and still answer', () => {
    const box = twoProjects('ccrc-ovr-read-spy-');
    fs.mkdirSync(path.join(box.home, '.cc-secrets'), { recursive: true });
    fs.writeFileSync(path.join(box.home, '.cc-secrets', 'sentinel.env'), 'SENTINEL_KEY=sentinel-value-1\n');
    fs.writeFileSync(path.join(box.home, '.cc-secrets', 'ccrc-mail.token'), 'sentinel-token\n');
    fs.writeFileSync(path.join(box.home, '.ccrc', 'mail.token'), 'sentinel-token\n');
    fs.writeFileSync(path.join(box.home, '.ccrc', 'agent.env'), 'CCRC_AGENT_TOKEN=sentinel\n');
    expect(fs.existsSync(path.join(box.home, '.ccrc', 'ccrc.env')), 'CONTROL: the box carries a ccrc.env').toBe(true);
    const db = new DatabaseSync(dbFile(box), { readOnly: true });
    let node: string;
    try {
      node = (db.prepare('SELECT node_id AS id FROM nodes WHERE depth = 0 ORDER BY node_id LIMIT 1').get() as { id: string }).id;
    } finally { db.close(); }
    const spy = path.join(box.home, 'openspy.log');
    const probe = path.join(box.home, 'probe.mjs');
    const control = path.join(box.home, 'spy-control');
    fs.writeFileSync(control, 'x');
    fs.writeFileSync(probe, [
      "import fs from 'node:fs';",
      "import { open as openP } from 'node:fs/promises';",
      `import { overlordRead } from ${JSON.stringify(pathToFileURL(READ).href)};`,
      `const home = ${JSON.stringify(box.home)};`,
      `const node = ${JSON.stringify(node)};`,
      'const out = [];',
      "out.push(await overlordRead(home, { verb: 'search', target: { kind: 'all' }, agents: true, args: ['fixture'] }, Date.now()));",
      "out.push(await overlordRead(home, { verb: 'describe', target: { kind: 'all' }, agents: true, args: [node] }, Date.now()));",
      "out.push(await overlordRead(home, { verb: 'expand', target: { kind: 'all' }, agents: true, args: [node] }, Date.now()));",
      // CONTROL: each form the spy wraps, on a file of the test's own, so a spy that went inert is red.
      `const c = ${JSON.stringify(control)};`,
      "fs.readFileSync(c); fs.closeSync(fs.openSync(c, 'r')); await (await openP(c, 'r')).close();",
      'await fs.promises.readFile(c); await new Promise((r) => fs.readFile(c, () => r()));',
      "await new Promise((r) => fs.open(c, 'r', (e, fd) => { fs.closeSync(fd); r(); }));",
      "await new Promise((r) => fs.createReadStream(c).on('close', r).resume());",
      'process.stdout.write(JSON.stringify(out.map((a) => a.outcome)));',
    ].join('\n'));
    const r = spawnSync(process.execPath, ['--no-warnings', probe], {
      encoding: 'utf8', timeout: 120_000, env: { ...box.env, OVERLORD_TEST_OPENSPY: spy, NODE_OPTIONS: preloadOptions([OPENSPY]) },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout), 'each verb answered rows').toEqual(['rows', 'rows', 'rows']);
    const opened = fs.readFileSync(spy, 'utf8');
    expect(opened, 'CONTROL: the spy recorded the store reads').toContain('history');
    for (const fn of ['readFileSync', 'openSync', 'promises.open', 'promises.readFile', 'readFile', 'open', 'createReadStream']) {
      expect(opened.split('\n'), `CONTROL: the spy sees ${fn}`).toContain(`${fn} ${control}`);
    }
    for (const p of ['.cc-secrets', 'mail.token', 'ccrc.env', 'agent.env', 'auth-scratch', 'operator-secrets']) expect(opened, p).not.toContain(p);
  }, HEAVY);
});

// ── touched, the fourth verb (Overlord W2, request record B1, RQ5) ─────────────────────────────────────────────────────
describe('touched: one CLI read per path, ids and times only, under its own budget', () => {
  it("the runner's session bound is the wire's bound", () => {
    expect(TOUCHED_SESSIONS_MAX).toBe(OVERLORD_HISTORY_TOUCHED_SESSIONS_MAX);
  });

  /** One family whose epoch root is a fixture directory, and a native leaf per call naming files (history-touched.test.ts'
   *  `plant`, kept to what touched reads). */
  type Plant = (id: string, latest: number, files: string[], family?: 'a' | 'b') => void;
  function touchedBox(prefix: string, rootName = 'work-root'): { box: HistoryBox; plant: Plant } {
    const box = twoProjects(prefix);
    const root = path.join(box.home, rootName);
    fs.mkdirSync(root, { recursive: true });
    const db = new DatabaseSync(dbFile(box));
    const ids: Record<'a' | 'b', { pk: number; seq: number; tpk: number }> = {} as never;
    try {
      for (const [k, id, gen, t] of [['a', ID_A, GA, TA], ['b', ID_B, GB, TB]] as const) {
        const fam = db.prepare('SELECT session_pk FROM sessions WHERE ccrc_id = ? AND generation = ?').get(id, gen) as { session_pk: number };
        const ep = db.prepare('SELECT seq FROM epochs WHERE session_pk = ? AND confirmed_ms IS NOT NULL ORDER BY seq LIMIT 1').get(fam.session_pk) as { seq: number };
        const tr = db.prepare("SELECT transcript_pk FROM transcripts WHERE cc_session_uuid = ? AND agent_id = ''").get(t) as { transcript_pk: number };
        db.prepare('UPDATE epochs SET cwd = ?, cwd_real = ? WHERE session_pk = ?').run(root, root, fam.session_pk);
        ids[k] = { pk: Number(fam.session_pk), seq: Number(ep.seq), tpk: Number(tr.transcript_pk) };
      }
    } finally { db.close(); }
    const plant: Plant = (id, latest, files, family = 'a') => {
      const f = ids[family];
      const w = new DatabaseSync(dbFile(box));
      try {
        w.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, topics,
          summary_blob_id, boundary_entry_id, span_start_uuid, earliest_ms, latest_ms, src_chars, desc_count, desc_chars,
          directive_flag, capped, parser_version, created_ms)
          VALUES (?, ?, ?, ?, 'native_leaf', 0, 'fixture', ?, NULL, NULL, NULL, NULL, ?, ?, 0, 0, 0, 0, 0, 1, ?)`)
          .run(id, f.pk, f.seq, f.tpk, `Gist zqgisttext of ${id}.`, latest - 500, latest, Date.now());
        for (const p of files) w.prepare("INSERT INTO node_refs (node_id, kind, value, origin) VALUES (?, 'path', ?, 'tool_use')").run(id, p);
      } finally { w.close(); }
    };
    return { box, plant };
  }

  // The header copy (slug touched-header-reads-as-project, the coordinator's three pins, call 2022): the history library's
  // header line refuses the Overlord's read kind on purpose, and the touched runner builds that line only to size its reserve,
  // so the Overlord's read hands it a context whose kind reads as project, for that line alone.
  it('pin 3: the header line throws on the Overlord read kind, and not on any of the three scope kinds', () => {
    const h = { id: 'x', project: 'project-a', families: 1, transcripts: 1, indexedThroughMs: null, lagS: null };
    expect(() => lib.headerLine({ ...h, kind: 'overlord' })).toThrow(/kind outside SCOPE_KINDS/);
    expect([...lib.SCOPE_KINDS].sort()).toEqual(['family', 'project', 'workspace']);
    for (const kind of lib.SCOPE_KINDS) expect(() => lib.headerLine({ ...h, kind }), kind).not.toThrow();
  });

  it("pin 1: the copy is the header's alone: under each of the three targets the rows are that target's", () => {
    const { box, plant } = touchedBox('ccrc-ovr-touched-targets-');
    plant('Lpin1a', T0 + 1000, ['ccd/both.mjs'], 'a');
    plant('Lpin1b', T0 + 2000, ['ccd/both.mjs'], 'b');
    const ids = (target: object): string[] => {
      const a = read(box, { verb: 'touched', target, agents: false, args: ['ccd/both.mjs'] });
      expect(a.outcome, JSON.stringify(a).slice(0, 300)).toBe('rows');
      const item = (a['items'] as { whole: boolean; sessions: { ccrcId: string }[] }[])[0]!;
      // Whole: every row the read ranked named a session of this target's families (a row outside them would be unnamed).
      expect(item.whole, `${JSON.stringify(target)}: every ranked row is the target's`).toBe(true);
      return item.sessions.map((s) => s.ccrcId).sort();
    };
    expect(ids({ kind: 'all' })).toEqual([ID_A, ID_B]);
    expect(ids({ kind: 'project', project: 'project-b' })).toEqual([ID_B]);
    expect(ids({ kind: 'project', project: 'project-a' })).toEqual([ID_A]);
    expect(ids({ kind: 'session', session: ID_A })).toEqual([ID_A]);
  }, HEAVY);

  it('pin 2: nothing of the header leaves: ids and times only, the scope record the real one, no planted marker', () => {
    const MARK = 'zqhdrmarker';
    const { box, plant } = touchedBox('ccrc-ovr-touched-header-', `root-${MARK}`);
    plant(`L${MARK}1`, T0 + 1000, ['ccd/one.mjs', `ccd/${MARK}.mjs`]);
    for (const target of [{ kind: 'all' }, { kind: 'project', project: 'project-a' }, { kind: 'session', session: ID_A }]) {
      const a = read(box, { verb: 'touched', target, agents: false, args: ['ccd/one.mjs'] });
      expect(a.outcome).toBe('rows');
      const text = JSON.stringify(a);
      for (const t of [MARK, 'scope=', 'coverage=', 'indexed-through=', 'lag=', 'touched ccd/', '(no graph)', 'zqgisttext', 'refs ']) {
        expect(text, `${JSON.stringify(target)} carries ${t}`).not.toContain(t);
      }
      const scope = a['scope'] as { kind: string; id: string };
      expect([scope.kind, scope.id], 'the scope record is the real context, never the copy').toEqual(['overlord', overlordTargetId(target as never)]);
      for (const it of a['items'] as Record<string, unknown>[]) expect(Object.keys(it).sort()).toEqual(['asked', 'file', 'sessions', 'trust', 'whole']);
    }
  }, HEAVY);

  it('one item per path, in order: the asked index and path, whole, each session once at its newest time; no gist, no ref', () => {
    const { box, plant } = touchedBox('ccrc-ovr-touched-');
    plant('Lt0uch1', T0 + 1000, ['ccd/one.mjs']);
    plant('Lt0uch2', T0 + 5000, ['ccd/one.mjs', 'ccd/two.mjs']);
    const a = read(box, { verb: 'touched', target: { kind: 'all' }, agents: false, args: ['ccd/one.mjs', 'ccd/two.mjs', 'ccd/none.mjs'] });
    expect(a.outcome, JSON.stringify(a).slice(0, 400)).toBe('rows');
    expect(readOverlordHistoryAnswer(a), JSON.stringify(a).slice(0, 400)).not.toBe('off-shape');
    expect(Object.keys(a).sort()).toEqual(['exit', 'items', 'outcome', 'scope', 'shown', 'total']);
    expect([a.outcome, a['exit'], a['shown'], a['total']]).toEqual(['rows', 0, 3, 3]);
    expect(a['items']).toEqual([
      { asked: 0, file: 'ccd/one.mjs', whole: true, sessions: [{ ccrcId: ID_A, latestMs: T0 + 5000 }], trust: 'untrusted' },
      { asked: 1, file: 'ccd/two.mjs', whole: true, sessions: [{ ccrcId: ID_A, latestMs: T0 + 5000 }], trust: 'untrusted' },
      { asked: 2, file: 'ccd/none.mjs', whole: true, sessions: [], trust: 'untrusted' },
    ]);
    expect(JSON.stringify(a)).not.toContain('zqgisttext');
    const none = read(box, { verb: 'touched', target: { kind: 'all' }, agents: false, args: ['ccd/none.mjs'] });
    expect([none.outcome, none['exit'], (none['items'] as unknown[]).length], 'nothing found is exit 3 with its item').toEqual(['rows', 3, 1]);
  }, HEAVY);

  it('a path whose rows pass the read limit is not whole', () => {
    const { box, plant } = touchedBox('ccrc-ovr-touched-cut-');
    for (let k = 0; k < 51; k += 1) plant(`Lcut${k.toString(36).padStart(3, '0')}`, T0 + k, ['ccd/many.mjs']);
    const a = read(box, { verb: 'touched', target: { kind: 'all' }, agents: false, args: ['ccd/many.mjs'] });
    const items = a['items'] as { whole: boolean; sessions: unknown[] }[];
    expect([a.outcome, items[0]!.whole, items[0]!.sessions.length]).toEqual(['rows', false, 1]);
  }, HEAVY);

  it('a path off the CLI grammar is the verb refusing its arguments; the request reader still refuses a regex', () => {
    const { box } = touchedBox('ccrc-ovr-touched-args-');
    for (const bad of [['a b.ts'], ['a:b'], ['ccd/x.mjs:12']]) {
      expect(read(box, { verb: 'touched', target: { kind: 'all' }, agents: false, args: bad }), bad.join(' '))
        .toEqual({ outcome: 'verb-refused', word: 'bad-args' });
    }
    expect(read(box, { verb: 'touched', target: { kind: 'all' }, agents: false, args: ['--regex', 'x'] }))
      .toEqual({ outcome: 'request-refused', word: 'regex' });
  }, HEAVY);

  it('the budget: it stops between paths once TOUCHED_OPEN_BUDGET_MS has passed, answers what it read, and its worker exits', () => {
    const { box, plant } = touchedBox('ccrc-ovr-touched-budget-');
    plant('Lbudg1', T0 + 1000, ['ccd/one.mjs']);
    const probe = path.join(box.home, 'budget.mjs');
    fs.writeFileSync(probe, [
      `import { overlordRead, TOUCHED_OPEN_BUDGET_MS } from ${JSON.stringify(pathToFileURL(READ).href)};`,
      // The clock reads 0 at the start, then the budget exactly at the first check between paths.
      'const ticks = [0, TOUCHED_OPEN_BUDGET_MS];',
      'const mono = () => ticks.shift() ?? 1e12;',
      `const a = await overlordRead(${JSON.stringify(box.home)}, { verb: 'touched', target: { kind: 'all' }, agents: false, args: ['ccd/one.mjs', 'ccd/two.mjs'] }, Date.now(), mono);`,
      'const under = [0, TOUCHED_OPEN_BUDGET_MS - 1, TOUCHED_OPEN_BUDGET_MS - 1];',
      `const b = await overlordRead(${JSON.stringify(box.home)}, { verb: 'touched', target: { kind: 'all' }, agents: false, args: ['ccd/one.mjs', 'ccd/two.mjs'] }, Date.now(), () => under.shift() ?? 1e12);`,
      'process.stdout.write(JSON.stringify([a, b]));',
    ].join('\n'));
    const r = spawnSync(process.execPath, ['--no-warnings', probe], { encoding: 'utf8', timeout: 120_000, env: box.env });
    expect(r.status, r.stderr).toBe(0);
    const [cut, whole] = JSON.parse(r.stdout) as Answer[];
    expect([cut!.outcome, cut!['shown'], cut!['total'], (cut!['items'] as { asked: number }[]).map((i) => i.asked)]).toEqual(['rows', 1, 2, [0]]);
    expect([whole!['shown'], whole!['total']], 'CONTROL: under the budget every path is read').toEqual([2, 2]);
    // The worker's own exit: the agent's run of the same request in a file worker answers and the thread exits.
    expect(readInWorker(box, { verb: 'touched', target: { kind: 'all' }, agents: false, args: ['ccd/one.mjs'] }).answer.outcome).toBe('rows');
  }, HEAVY);
});
