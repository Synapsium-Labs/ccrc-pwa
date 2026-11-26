// The Overlord chat's earlier-generation door (Overlord W1, the chat, Task 3; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`, questions 1, 2 and 12).
//
// FIRST, THE MEASUREMENT (Task 3 Step 1, a characterization case): on a fixture history store, through the Overlord's own read
// (`ccd/history/overlord-read.mjs` in its worker, as the agent runs it), which verb names a conversation's newest entries. The
// answer decides the arm the door builds: `paged`, or `not-pageable`. Every HOME is a fixture under the per-run temp root.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readOverlordHistoryAnswer } from '../../shared/overlordHistory.js';
import { makeHistoryBox, runSweep, seedFamily, REPO, type HistoryBox } from './historyHelpers.js';
import { userRow, assistantRow, type Row } from './historyFixtures.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const HEAVY = 180_000;
const WORKER = path.join(REPO, 'ccd', 'history', 'overlord-worker.mjs');

const ID_A = 'lane-a-overlord';
const GA = '0189abcd-1234-4678-9abc-0123456789ab';
const TA = 'a1a1a1a1-1111-4111-8111-111111111111';
const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const rid = (t: string, n: number): string => `${t.slice(0, 8)}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const iso = (k: number): string => new Date(T0 + k * 1000).toISOString();

/** `n` turns of neutral text: a user turn and an assistant reply each. */
function turns(t: string, n: number): Row[] {
  const rows: Row[] = [];
  const base = { sessionId: t, cwd: '/home/u/worktrees/p/quiet-basin' };
  for (let k = 1; k <= n; k += 1) {
    rows.push(userRow({ ...base, uuid: rid(t, 2 * k - 1), ts: iso(2 * k), text: `fixture question ${k}` }));
    rows.push(assistantRow({ ...base, uuid: rid(t, 2 * k), ts: iso(2 * k + 1), text: `Fixture answer ${k}.`, requestId: `req_${k}`, msgId: `msg_${k}` }));
  }
  return rows;
}

type Answer = Record<string, unknown> & { outcome: string };

/** overlord-worker.mjs in a file worker started as the agent starts it, inside a child process (overlord-read.test.ts' form). */
function read(box: HistoryBox, request: object): Answer {
  const runner = path.join(box.home, `runner-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(runner, [
    "import { Worker } from 'node:worker_threads';",
    `const w = new Worker(${JSON.stringify(WORKER)}, { workerData: { home: ${JSON.stringify(box.home)}, request: ${JSON.stringify(request)}, nowMs: Date.now() }, env: {}, stdout: true, stderr: true });`,
    "let answer = null;",
    "w.stdout.on('data', () => {}); w.stderr.on('data', () => {});",
    "w.on('message', (m) => { answer = m; });",
    "w.on('error', () => { answer = { outcome: 'worker-error' }; });",
    "w.on('exit', () => { process.stdout.write(JSON.stringify(answer)); });",
  ].join('\n'));
  const r = spawnSync(process.execPath, ['--no-warnings', runner], { encoding: 'utf8', timeout: 120_000, env: box.env });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as Answer;
}

describe('Task 3 Step 1: which verb pages one conversation (the characterization case)', () => {
  // MEASURED on this fixture: no read verb names a conversation's newest entries by its conversation id. `expand <conversation
  // id>` reads the id as an entry uuid and finds none (exit 3, no items); `describe` takes node ids only (`bad-args`). So the
  // door builds the `not-pageable` arm (question 2): every earlier divider reads "Read generation n in ccrc history", and a
  // first page is refused. `expand --around <entry>` does page one transcript, and its items carry `uuid`, `role`, `type`,
  // `ts_ms` and `text`, and NO conversation id: when paging joins (the history door's cursor), the ledger scope names the
  // `around` (step 7's second arm).
  it('a conversation id names no entry and no node; --around pages one transcript, and its items carry no conversation id', () => {
    const box = makeHistoryBox('ccrc-chat-earlier-measure-');
    seedFamily(box, { id: ID_A, project: 'project-a', uuid: TA, generation: GA, rows: turns(TA, 3) });
    expect(runSweep(box).code).toBe(0);
    const target = { kind: 'session', session: ID_A };
    const expanded = read(box, { verb: 'expand', target, agents: false, args: [TA] });
    expect([expanded.outcome, expanded['exit'], expanded['total']], 'expand of a conversation id finds nothing').toEqual(['rows', 3, 0]);
    const described = read(box, { verb: 'describe', target, agents: false, args: [TA] });
    expect([described.outcome, described['word']], 'describe takes a node id only').toEqual(['verb-refused', 'bad-args']);
    const around = read(box, { verb: 'expand', target, agents: false, args: ['--around', rid(TA, 6), '--before', '40', '--after', '0'] });
    expect(readOverlordHistoryAnswer(around), 'the wire reader accepts it').not.toBe('off-shape');
    expect([around.outcome, around['exit']]).toEqual(['rows', 0]);
    const items = around['items'] as Record<string, unknown>[];
    expect(items.map((i) => i['uuid']), 'the entries before it, and it, in file order').toEqual([1, 2, 3, 4, 5, 6].map((k) => rid(TA, k)));
    expect(items.map((i) => [i['role'], i['text']])).toEqual([
      ['user', 'fixture question 1'], ['assistant', 'Fixture answer 1.'], ['user', 'fixture question 2'],
      ['assistant', 'Fixture answer 2.'], ['user', 'fixture question 3'], ['assistant', 'Fixture answer 3.'],
    ]);
    for (const it of items) {
      expect(it['trust']).toBe('untrusted');
      expect(Object.values(it), 'no item field carries the conversation id').not.toContain(TA);
    }
  }, HEAVY);
});
