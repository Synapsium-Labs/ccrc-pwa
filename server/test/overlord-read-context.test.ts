// server/test/overlord-read-context.test.ts — the store-measuring helpers that leave ccd/history/cli.mjs for
// ccd/history/read-context.mjs (plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md, Task 1; the
// coordinator's ruling F1, "move, not guard", and R1, R2).
//
// - The characterization runs the CLI in a child process, as history-cli.test.ts does, and pins what the moved code
//   decides: an absent store, an unreadable store, a server-role home, a damaged table, a good read's store id, and a
//   value masked through a recorded pair. Every expected value is a literal measured on `main` before the move.
// - read-context.mjs loads in a file worker, where cli.mjs cannot (its module-level `process.umask`).
// - read-context.mjs has no side effects at load, and its `measureReach(home, '')` opens no `ccrc.env`.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  makeHistoryBox, runSweep, runCli, withPane, seedFamily, preloadOptions, PRELOADS, REPO, type HistoryBox,
} from './historyHelpers.js';
import { userRow, assistantRow, boundaryRow, summaryRow, type Row } from './historyFixtures.js';
import { parsedFile } from './scan/symbols.js';
import { identifierReferences } from './scan/parse.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const ID = 'lane-a-project-a';
const PROJECT = 'project-a';
const G1 = '0189abcd-1234-4678-9abc-0123456789ab';
const TA = 'a1a1a1a1-1111-4111-8111-111111111111';
const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const HEAVY = 120_000;
const HIST = path.join(REPO, 'ccd', 'history');
const READ_CONTEXT = path.join(HIST, 'read-context.mjs');
const CLI = path.join(HIST, 'cli.mjs');

const rid = (transcript: string, n: number): string => `${transcript.slice(0, 8)}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const iso = (k: number): string => new Date(T0 + k * 1000).toISOString();

/** `n` manual compactions, so the family has nodes with gists (history-recall.test.ts' `cycles`). */
function cycles(transcript: string, n: number): Row[] {
  const rows: Row[] = [];
  const cwd = '/home/u/worktrees/p/quiet-basin';
  let k = 0;
  for (let c = 1; c <= n; c += 1) {
    const u = rid(transcript, ++k); const a = rid(transcript, ++k); const x = rid(transcript, ++k);
    const b = rid(transcript, ++k); const s = rid(transcript, ++k);
    const base = { sessionId: transcript, cwd };
    rows.push(userRow({ ...base, uuid: u, ts: iso(5 * c), text: `fixture request ${c}` }));
    rows.push(assistantRow({ ...base, uuid: a, ts: iso(5 * c + 1), text: `Fixture answer ${c}.`, requestId: `req_c_${c}`, msgId: `msg_c_${c}` }));
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

const dbFile = (box: HistoryBox): string => path.join(box.root, 'db', 'history.db');
const storeIdOf = (box: HistoryBox): string => fs.readFileSync(path.join(box.root, 'store.id'), 'utf8').trim();
const tree = (box: HistoryBox): ReturnType<typeof runCli> => runCli(box, ['tree', '--json'], { env: withPane(box, ID) });
/** The answer's stable fields: everything but the header's clock-derived values. */
const stable = (j: Record<string, unknown> | null): Record<string, unknown> => {
  const { header: _h, ...rest } = j ?? {};
  return rest;
};

describe('Task 1 characterization: what the moved helpers decide, through the CLI in a child process', () => {
  it('an absent store', () => {
    const box = makeHistoryBox('ccrc-ovr-rc-absent-');
    const r = tree(box);
    expect([r.code, r.json?.['reason'] ?? null, r.json?.['store_id'] ?? null], r.stderr).toEqual([6, null, null]);
    expect(r.json).toEqual({
      v: 1, exit: 6, store_id: null, coverage: 'this-box', scope: null, indexed_through_ms: null, lag_s: null,
      items: [], shown: 0, total: 0, next: null,
    });
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
  }, HEAVY);

  it('an unreadable store: a page destroyed past the header is store-unmeasured, with its store id', () => {
    const box = makeHistoryBox('ccrc-ovr-rc-unreadable-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: cycles(TA, 1) });
    const db = new DatabaseSync(dbFile(box));
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
    const fd = fs.openSync(dbFile(box), 'r+');
    try { fs.writeSync(fd, Buffer.alloc(4096, 0xa5), 0, 4096, 2 * 4096); } finally { fs.closeSync(fd); }
    const r = tree(box);
    expect([r.code, r.json?.['reason'], r.json?.['store_id']], r.stderr).toEqual([5, 'store-unmeasured', storeIdOf(box)]);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
  }, HEAVY);

  it('a server-role home: the CLI keeps its role read, and answers 9 before touching the store', () => {
    const box = makeHistoryBox('ccrc-ovr-rc-server-', { role: 'server' });
    const r = tree(box);
    expect([r.code, r.json?.['reason'] ?? null, r.json?.['store_id'] ?? null], r.stderr).toEqual([9, null, null]);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(fs.existsSync(path.join(box.home, 'tmux-calls')), 'answered before any identity read').toBe(false);
  }, HEAVY);

  it('a damaged table answers exit 5, store-read-failed, with its store id', () => {
    const box = makeHistoryBox('ccrc-ovr-rc-damaged-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: cycles(TA, 1) });
    const db = new DatabaseSync(dbFile(box), { enableForeignKeyConstraints: false });
    try { db.exec('DROP TABLE redact_hashes'); } finally { db.close(); }
    const r = tree(box);
    expect([r.code, r.json?.['reason'], r.json?.['store_id']], r.stderr).toEqual([5, 'store-read-failed', storeIdOf(box)]);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(r.stderr).toContain('ccrc history: store-read-failed: no such table: redact_hashes');
  }, HEAVY);

  it("a good read names the store's id", () => {
    const box = makeHistoryBox('ccrc-ovr-rc-good-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: cycles(TA, 2) });
    expect(runSweep(box).code).toBe(0);
    const r = tree(box);
    expect(r.code, r.stderr).toBe(0);
    const j = stable(r.json);
    expect(j['store_id']).toBe(storeIdOf(box));
    expect([j['exit'], j['coverage'], j['shown'], j['total']]).toEqual([0, 'this-box', 2, 2]);
    expect(j['next']).toMatch(/^next: "\$HOME\/\.local\/bin\/ccrc" history describe L[0-9a-f]{6,20}$/);
    expect(j['scope']).toEqual({
      kind: 'family', id: ID, project: PROJECT, families: [{ ccrc_id: ID, generation: G1, first_seen_ms: expect.any(Number) }],
      families_total: 1, transcripts: 1,
    });
  }, HEAVY);

  it('a value masked through a recorded pair (the pair index the read builds from redact_hashes)', () => {
    const box = makeHistoryBox('ccrc-ovr-rc-pair-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: cycles(TA, 2) });
    expect(runSweep(box).code).toBe(0);
    // Built from fragments, so the tree holds no literal secret-shaped token.
    const token = ['Qzv7', 'Kp2m', 'Wx9L', 'rT4n', 'Bh6Y', 'cJ8d'].join('');
    const db = new DatabaseSync(dbFile(box));
    try {
      const row = db.prepare('SELECT node_id FROM nodes WHERE gist IS NOT NULL ORDER BY node_id LIMIT 1').get() as { node_id: string };
      db.prepare('UPDATE nodes SET gist = ? WHERE node_id = ?').run(`Current Work: ${token}`, row.node_id);
      db.prepare('INSERT INTO redact_hashes (len, sha256, first_seen_ms) VALUES (?, ?, ?)')
        .run(token.length, new Uint8Array(createHash('sha256').update(token).digest()), Date.now());
    } finally { db.close(); }
    const r = tree(box);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).not.toContain(token);
    expect(r.stdout).toContain('Current Work: [redacted]');
  }, HEAVY);
});

/** A file worker (never an eval worker) that imports `target` and posts what happened. */
function importInWorker(target: string): { ok: boolean; code: string | null } {
  const dir = fs.mkdtempSync(path.join(process.env['TMPDIR'] ?? '/tmp', 'ccrc-ovr-rc-worker-'));
  const runner = path.join(dir, 'runner.mjs');
  const entry = path.join(dir, 'entry.mjs');
  fs.writeFileSync(entry, `import ${JSON.stringify(pathToFileURL(target).href)};\n`);
  fs.writeFileSync(runner, [
    "import { Worker } from 'node:worker_threads';",
    `const w = new Worker(${JSON.stringify(entry)});`,
    "w.on('error', (e) => { process.stdout.write(JSON.stringify({ ok: false, code: e && e.code ? e.code : null })); });",
    "w.on('exit', (c) => { if (c === 0) process.stdout.write(JSON.stringify({ ok: true, code: null })); });",
  ].join('\n'));
  const r = spawnSync(process.execPath, ['--no-warnings', runner], { encoding: 'utf8', timeout: 60_000 });
  return JSON.parse(r.stdout) as { ok: boolean; code: string | null };
}

describe('Task 1: read-context.mjs loads in a worker, has no side effects and reads no role', () => {
  it('a file worker imports read-context.mjs', () => {
    expect(importInWorker(READ_CONTEXT)).toEqual({ ok: true, code: null });
  }, HEAVY);

  it('CONTROL: the same import of cli.mjs fails with ERR_WORKER_UNSUPPORTED_OPERATION (its module-level umask); an isMainThread guard there would red this, and whoever adds one updates it', () => {
    expect(importInWorker(CLI)).toEqual({ ok: false, code: 'ERR_WORKER_UNSUPPORTED_OPERATION' });
  }, HEAVY);

  it('no side effects: no call runs at load but NO_PAIRS\' makePairIndex, and nothing names umask, env, exit or chdir', () => {
    const p = parsedFile(READ_CONTEXT);
    // A call outside every function body runs at load.
    const atLoad = p.calls.filter((c) => !p.symbols.some((s) => c.start >= s.start && c.end <= s.end)).map((c) => c.callee);
    expect(atLoad).toEqual(['makePairIndex']);
    // Every reference to `process`, by the line it stands in: none reads the environment, sets the umask, exits or moves.
    const uses = identifierReferences(p.text, READ_CONTEXT, new Set(['process'])).map((r) => r.context);
    expect(uses.some((c) => c.includes('process.platform')), 'CONTROL: the scan sees process.platform').toBe(true);
    expect(uses.filter((c) => /\bprocess\.(env|umask|exit|exitCode|chdir)\b/.test(c))).toEqual([]);
  });

  it('measureReach(home, \'\') answers without opening ccrc.env (R1), in a child process with the read spy', () => {
    const box = makeHistoryBox('ccrc-ovr-rc-norole-', { role: 'server' });
    const spy = path.join(box.home, 'readspy.log');
    const probe = path.join(box.home, 'probe.mjs');
    fs.writeFileSync(probe, [
      `import { measureReach } from ${JSON.stringify(pathToFileURL(READ_CONTEXT).href)};`,
      `const r = await measureReach(${JSON.stringify(box.home)}, '');`,
      'process.stdout.write(JSON.stringify({ role: r.role, darwin: r.darwin, statSettled: r.statSettled }));',
    ].join('\n'));
    const r = spawnSync(process.execPath, ['--no-warnings', probe], {
      encoding: 'utf8', timeout: 60_000,
      env: { ...box.env, HISTORY_TEST_READSPY: spy, NODE_OPTIONS: preloadOptions([PRELOADS.readspy]) },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ role: '', darwin: false, statSettled: true });
    const opened = fs.existsSync(spy) ? fs.readFileSync(spy, 'utf8') : '';
    expect(opened, 'CONTROL: the spy recorded the store reads').not.toBe('');
    expect(opened).not.toContain('ccrc.env');
  }, HEAVY);
});
