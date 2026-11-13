// The manifest program's journal fold and finished rule against the server's (session-continuity 6b, Task 2; D-8368, D-8370).
//
// `ccd/lib/inflight-manifest.py` re-spells `server/src/workflows/model.ts`'s `foldJournal` (and `parseLine`'s head search) and its
// `decideRun` finished rule, because it runs on a box where the server's code is not. This file runs both over ONE table of sidecar
// trees and holds them equal, except for three pinned differences: a summary that is `killed`, non-final or unparseable, which the
// server reads finished (any summary file no older than the journal; `read.ts` stats the file and calls `parseSummary` later, only
// for the row's view) and the manifest reads in flight (D-8370). A fourth difference reds by name.
//
// The server side is `read.ts`'s composition: `decideRun` with `proc: { kind: 'gone' }`, `summaryMtime` the summary file's mtime
// whenever the file exists (never gated on `parseSummary`), and `foldJournal` over `splitLines` for the keys. The program's side is
// the item or the retirement it prints for the same tree: in flight (not finished), holed (finished, and the latest attempt of some
// key ends on a rate-limit row) or no item (finished). The journal fold shows through `holed`: each row says which agent's
// transcript ends on the limit, so a reader that took the wrong agent for a key, or dropped a line the server counts, answers
// differently.
//
// Mutation rows (the brief's MP-* table): MP-KILLED, MP-PARSE and MP-JOURNALHEAD each go red on the one case below that carries
// the words the table cites.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { decideRun, emptyCarry, emptyFold, foldJournal, splitLines } from '../src/workflows/model.js';

const REPO = path.resolve(__dirname, '../..');
const PROG = path.join(REPO, 'ccd', 'lib', 'inflight-manifest.py');
const JQ_LIB = path.join(REPO, 'ccd', 'lib');
const SID = 'demo-quiet-basin';
const UUID = '6350faa0-a1be-4e78-939c-57485268f6fc';
const RUN = 'wf_0123abcd-0ab';
const NOW = 1_800_000_000;
const key = (n: number): string => `v1:${n.toString(16).padStart(64, '0')}`;
const RATE = '{"type":"assistant","isApiErrorMessage":true,"error":"rate_limit"}\n';
const FIN = '{"type":"assistant","message":{"stop_reason":"end_turn"}}\n';

type Row = {
  name: string;
  /** Journal lines as written, each ended with LF. */
  journal: string[];
  /** The summary file's bytes, or null for none. */
  summary: string | null;
  /** The journal's mtime relative to the summary's: 'older' (summary newer), 'newer' or 'same'. */
  journalIs?: 'older' | 'newer' | 'same';
  /** Agents the table plants, by id: the transcript's last row. */
  agents?: Record<string, 'rate-limit' | 'finished'>;
  /** The server and the manifest are pinned to differ on this row (D-8370). */
  pinned?: boolean;
};
const J = (type: string, k: number, agentId: string): string => JSON.stringify({ type, key: key(k), agentId });
const TABLE: Row[] = [
  { name: 'no summary', journal: [J('started', 1, 'a1'), J('failed', 1, 'a1')], summary: null, agents: { a1: 'rate-limit' } },
  { name: 'completed with an older journal', journal: [J('started', 1, 'a1'), J('failed', 1, 'a1')], summary: '{"status":"completed"}', journalIs: 'older', agents: { a1: 'rate-limit' } },
  { name: 'completed with a newer journal', journal: [J('started', 1, 'a1')], summary: '{"status":"completed"}', journalIs: 'newer', agents: { a1: 'rate-limit' } },
  { name: 'failed', journal: [J('started', 1, 'a1'), J('failed', 1, 'a1')], summary: '{"status":"failed"}', journalIs: 'older', agents: { a1: 'finished' } },
  { name: 'killed', journal: [J('started', 1, 'a1')], summary: '{"status":"killed"}', journalIs: 'older', agents: { a1: 'finished' }, pinned: true },
  { name: 'a summary whose status is not final', journal: [J('started', 1, 'a1')], summary: '{"status":"running"}', journalIs: 'older', agents: { a1: 'finished' }, pinned: true },
  { name: 'a summary that does not parse', journal: [J('started', 1, 'a1')], summary: '{"status":', journalIs: 'older', agents: { a1: 'finished' }, pinned: true },
  { name: 'a key retried under a new agent id (the limited first attempt is no hole)', journal: [J('started', 1, 'a1'), J('started', 1, 'a2'), J('result', 1, 'a2')], summary: '{"status":"completed"}', journalIs: 'older', agents: { a1: 'rate-limit', a2: 'finished' } },
  { name: 'a key retried under a new agent id, the latest attempt limited', journal: [J('started', 1, 'a1'), J('started', 1, 'a2'), J('failed', 1, 'a2')], summary: '{"status":"completed"}', journalIs: 'older', agents: { a1: 'finished', a2: 'rate-limit' } },
  { name: 'a journal line that is not JSON and carries none of the three fields', journal: ['not json at all', J('started', 1, 'a1'), J('failed', 1, 'a1')], summary: '{"status":"completed"}', journalIs: 'older', agents: { a1: 'rate-limit' } },
  { name: 'a journal line cut mid-JSON whose head carries type, key and agentId', journal: [`{"type":"started","key":"${key(1)}","agentId":"a1","label":"cut mid-str`], summary: '{"status":"completed"}', journalIs: 'older', agents: { a1: 'rate-limit' } },
];

const made: string[] = [];
afterEach(() => { for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

/** One table row as a sidecar tree and a record; -> the server's reading and the program's. */
const both = (r: Row): { server: { finished: boolean; holed: boolean }; prog: { finished: boolean; holed: boolean } } => {
  const home = mkTmp('ccrc-manifest-parity-');
  made.push(home);
  const reg = path.join(home, '.cc-sessions');
  const cfg = path.join(home, 'cfg');
  fs.mkdirSync(reg, { recursive: true });
  const side = path.join(cfg, 'projects', '-p', UUID);
  const runDir = path.join(side, 'subagents', 'workflows', RUN);
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(side, 'workflows'), { recursive: true });
  const at = (p: string, body: string, t: number): void => { fs.writeFileSync(p, body); fs.utimesSync(p, t, t); };
  const sm = NOW - 100;
  const jm = r.journalIs === 'newer' ? NOW - 50 : r.journalIs === 'same' ? sm : r.summary === null ? NOW - 60 : NOW - 150;
  const journalBytes = r.journal.map((l) => `${l}\n`).join('');
  at(path.join(runDir, 'journal.jsonl'), journalBytes, jm);
  if (r.summary !== null) at(path.join(side, 'workflows', `${RUN}.json`), r.summary, sm);
  for (const [id, end] of Object.entries(r.agents ?? {})) {
    at(path.join(runDir, `agent-${id}.jsonl`), end === 'rate-limit' ? RATE : FIN, NOW - 200);
  }
  const rec = JSON.stringify({ v: 1, t: (NOW - 100) * 1000, k: 'workflow', w: 'lane-a', uuid: UUID, run: RUN, task: 't1', script: null });
  fs.writeFileSync(path.join(reg, `${SID}.deleg`), `${rec}\n`);

  // The server's side: read.ts's composition.
  const fold = foldJournal(emptyFold(), splitLines(emptyCarry(), new Uint8Array(Buffer.from(journalBytes))).lines);
  const decision = decideRun({
    summaryMtime: r.summary === null ? null : sm * 1000, journalMtime: jm * 1000, activityMtime: jm * 1000, proc: { kind: 'gone' },
  });
  const holedServer = [...fold.keys.values()].some((k) => (r.agents?.[k.agentId]) === 'rate-limit');
  const server = { finished: decision === 'finished', holed: holedServer };

  const p = spawnSyncGroup('python3', ['-I', PROG, reg, SID, cfg, UUID, 'swap', String(NOW), String(64 * 2 ** 20), '16384', '65536', '3600', String(7 * 86400), '-', JQ_LIB, '-', '-', String(1048576 + 4096)],
    { encoding: 'utf8', timeout: 60_000 });
  expect(p.status, p.stderr).toBe(0);
  const items = String(p.stdout).split('\n').filter((l) => l.startsWith('item '));
  const cls = items.length === 0 ? null : /class=(\S+)/.exec(items[0]!)![1]!;
  return { server, prog: { finished: cls === null || cls === 'holed', holed: cls === 'holed' } };
};

describe('the manifest program agrees with the server\'s journal fold and finished rule', () => {
  it('the journal fold and the finished rule agree with server/src/workflows/model.ts over one table, except a summary that is killed, non-final or unparseable, which the server reads finished and the manifest reads in flight', () => {
    const differ: string[] = [];
    for (const r of TABLE) {
      const { server, prog } = both(r);
      if (r.pinned === true) {
        expect(server.finished, `${r.name}: the server reads any summary no older than the journal as finished`).toBe(true);
        expect(prog.finished, `${r.name}: the manifest reads it in flight`).toBe(false);
        differ.push(r.name);
        continue;
      }
      expect(prog.finished, `${r.name}: finished`).toBe(server.finished);
      // Holed only means something for a finished run; the fold shows through which agent decides it.
      if (server.finished) expect(prog.holed, `${r.name}: holed`).toBe(server.holed);
    }
    expect(differ, 'the three pinned differences, by name').toEqual([
      'killed', 'a summary whose status is not final', 'a summary that does not parse',
    ]);
  });
});
