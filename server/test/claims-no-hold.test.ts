// D12 ruling 1, held by mechanism: a claim writes NOTHING to the registry —
// no `.hold`, no run, no verb, no grant. The third assertion exercises the
// REAL `sweepNames`, because asserting a file's absence alone stays green the
// day someone "simplifies" claims onto ws-hold: `sweepNames` skips a held row,
// so the best "what is this session doing" signal on the fleet would freeze
// the moment a workspace claimed anything (the naming-sweep trap).
import { describe, it, expect } from 'vitest';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Bus } from '../src/bus.js';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };
const ID = 'demo-quiet-mesa';
const UUID = 'a'.repeat(36);
const WORKDIR = '/w/demo/quiet-mesa';
const MUNGED = '-w-demo-quiet-mesa';      // mungePath: /._ -> - (munge.ts:1)

/** name-sweep.test.ts's fixture row: a workspace still on its born branch. */
const seed = (home: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: WORKDIR, uuid: UUID,
    started: '1', workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
};

const TITLE = (t: string): string => JSON.stringify({ type: 'ai-title', aiTitle: t });
const transcript = (home: string): void => {
  const dir = path.join(home, '.claude', 'projects', MUNGED);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${UUID}.jsonl`), TITLE('Fix the PR sheet') + '\n');
};

/** name-sweep.test.ts's harness runner, with one addition: a ws-hold that
 *  APPLIES the verb's own effect (writes `$REG/<id>.hold`), so a mutant that
 *  reaches for the verb produces the exact on-disk state the real ccd would —
 *  and the sweep assertion below can catch the freeze it causes. */
const harness = (home: string): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push([...args]);
    if (args[0] === 'capture-pane') {
      return { code: 0, stdout: `  👤 claude │ 🤖 Sonnet 5 │ ⎇ ws/quiet-mesa │ 🎯 demo`, stderr: '' };
    }
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: '4061\n', stderr: '' };
    if (args[0] === 'ws-hold') {
      const at = args.indexOf('--session');
      const reasonAt = args.indexOf('--reason');
      writeFileSync(path.join(home, '.cc-sessions', `${args[at + 1]}.hold`),
        reasonAt >= 0 ? args[reasonAt + 1]! : '');
      return { code: 0, stdout: 'held', stderr: '' };
    }
    if (args[0] === 'ws-rename') {
      return { code: 0, stdout: `{"renamed":"${ID}","old":"ws/quiet-mesa","new":"ws/fix-the-pr-sheet"}`, stderr: '' };
    }
    return { code: 1, stdout: '', stderr: '' };
  };
  return { run, calls };
};

describe('a claim writes nothing to the registry (D12 ruling 1)', () => {
  it('acquire leaves the registry byte-listing identical, runs no verb, and the REAL sweepNames still renames', async () => {
    const home = mkTmp('ccrc-noh-');
    seed(home);
    transcript(home);
    const h = harness(home);
    const deps = { ...testDeps(home, h.run), mailToken: TOKEN,
      coord: new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))) };
    const app: FastifyInstance = await buildServer(deps);
    try {
      const reg = path.join(home, '.cc-sessions');
      const before = readdirSync(reg).sort();
      const callsBefore = h.calls.length;

      const res = await app.inject({ method: 'POST', url: '/api/claims', headers: tok,
        payload: { byId: ID, byUuid: UUID, project: 'demo',
          paths: ['shared/api.ts'], intent: 'rewiring the roster' } });
      expect(res.statusCode).toBe(200);

      // 1: the registry keyspace is untouched — no `.hold`, no new field. A
      //    claim lives in coord.db and nowhere else.
      expect(readdirSync(reg).sort()).toEqual(before);
      expect(before).not.toContain(`${ID}.hold`);

      // 2: no ccd verb ran — no verb, no grant, no exec at all. (The registry
      //    reads the attribution gate performs go through deps.io, never the
      //    runner, so ANY new call here is a verb the claim minted.)
      expect(h.calls.length, 'the claim route must not run ccd').toBe(callsBefore);

      // 3: THE REAL SWEEP. The workspace is claimed and still gets its rename:
      //    the sweep's hold-freeze must not fire for a claim, because the
      //    claim deliberately is not a hold. This is the assertion that reds
      //    the "simplify claims onto ws-hold" mutant, whose harness ws-hold
      //    writes the real file.
      const w = new FleetWatcher(deps, new Bus(), 2000);
      await w.sweepNames();
      expect(h.calls.filter((c) => c[0] === 'ws-rename').map((c) => c[4]))
        .toEqual(['ws/fix-the-pr-sheet']);
    } finally {
      await app.close();
    }
  });
});
