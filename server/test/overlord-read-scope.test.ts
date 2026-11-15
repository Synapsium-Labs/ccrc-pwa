// server/test/overlord-read-scope.test.ts — the `overlord` read scope, unreachable from the CLI (plan
// docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md, Task 2; question 1, slug
// overlord-scope-outside-decide-scope).
//
// - decideScope never answers `overlord`: an enumeration over its inputs, and the CLI run with every recall variable and
//   `--session` set to the word.
// - cli.mjs, and every module it reaches inside ccd/history/, never imports overlord-read.mjs or overlord-worker.mjs.
// - familiesOf's `overlord` branch reads every project's families, one project's, or one id's across generations. Those
//   cases run in a child process on a fixture store.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as lib from '../../ccd/history/lib.mjs';
import {
  makeHistoryBox, runCli, withPane, seedFamily, plantSession, REPO, type HistoryBox,
} from './historyHelpers.js';
import { userRow, assistantRow, type Row } from './historyFixtures.js';
import { parsedFile } from './scan/symbols.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const HEAVY = 120_000;
const HIST = path.join(REPO, 'ccd', 'history');
const OVERLORD = 'overlord';

describe('decideScope never answers overlord: an enumeration over its inputs', () => {
  type Presence = { state: 'value'; value: string } | { state: 'absent' } | { state: 'unreadable' };
  const presences = (value: string): Array<Presence | { state: 'value'; value: string }> => [
    { state: 'value', value }, { state: 'absent' }, { state: 'unreadable' }, { state: 'value', value: '' },
    { state: 'value', value: OVERLORD },
  ];
  const sources = [...lib.SCOPE_SOURCES, 'nowhere', OVERLORD];
  const sessions: Array<string | null> = [null, 'lane-a-project-a', 'lane-b-project-a', 'Not An Id!', OVERLORD];
  const bools = [false, true];

  it('for every input, the verdict is a refusal or a SCOPE_KINDS kind, never overlord', () => {
    let verdicts = 0;
    let oks = 0;
    for (const source of sources) for (const project of bools) for (const workspace of bools) for (const agents of bools)
      for (const session of sessions) for (const regProject of presences('project-a')) for (const regWorkdir of presences('/w'))
        for (const sessionProject of [null, ...presences('project-a')]) {
          const v = lib.decideScope({
            source, id: 'lane-a-project-a', generation: { value: null, via: 'none' } as never,
            flags: { project, workspace, session, agents },
            reg: { project: regProject as never, workdir: regWorkdir as never, sessionProject: sessionProject as never },
          });
          verdicts += 1;
          if (v.ok) {
            oks += 1;
            expect(lib.SCOPE_KINDS as readonly string[], JSON.stringify({ source, project, workspace, session })).toContain(v.kind);
            expect(v.kind).not.toBe(OVERLORD);
          }
        }
    expect(verdicts, 'the enumeration ran').toBeGreaterThan(10_000);
    expect(oks, 'CONTROL: some inputs pass, so the kind check is not vacuous').toBeGreaterThan(100);
  });

  it('READ_SCOPE_KINDS is SCOPE_KINDS plus overlord, and SCOPE_KINDS does not hold overlord', () => {
    expect([...lib.READ_SCOPE_KINDS]).toEqual([...lib.SCOPE_KINDS, OVERLORD]);
    expect(lib.SCOPE_KINDS as readonly string[]).not.toContain(OVERLORD);
    expect(Object.isFrozen(lib.READ_SCOPE_KINDS)).toBe(true);
  });

  it("no option or value in the read verbs' argument table spells overlord", () => {
    const words: string[] = [];
    for (const [verb, spec] of Object.entries(lib.READ_OPTIONS)) {
      words.push(verb);
      for (const [flag, opt] of Object.entries((spec as { options: Record<string, { key: string; values?: readonly string[] }> }).options)) {
        words.push(flag, opt.key, ...(opt.values ?? []));
      }
    }
    expect(words.length, 'CONTROL: the table was read').toBeGreaterThan(20);
    expect(words.filter((w) => w.toLowerCase().includes(OVERLORD))).toEqual([]);
  });
});

/** Every relative import, reached from `entry` inside ccd/history/, by parsedFile's import edges. */
function reachedFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const todo = [entry];
  while (todo.length > 0) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const e of parsedFile(file).imports) {
      if (!e.specifier.startsWith('./')) continue;
      todo.push(path.join(path.dirname(file), e.specifier));
    }
  }
  return seen;
}

describe('the import pin: cli.mjs never reaches the Overlord read module', () => {
  it("cli.mjs's imports, and every module they reach inside ccd/history/, include neither overlord-read.mjs nor overlord-worker.mjs", () => {
    const reached = [...reachedFrom(path.join(HIST, 'cli.mjs'))].map((f) => path.basename(f));
    expect(reached, 'CONTROL: the walk reaches recall.mjs and read-context.mjs').toEqual(expect.arrayContaining(['recall.mjs', 'read-context.mjs', 'lib.mjs']));
    expect(reached.filter((f) => f === 'overlord-read.mjs' || f === 'overlord-worker.mjs')).toEqual([]);
  });
});

const ID = 'lane-a-project-a';
const ID_B = 'lane-b-project-b';
const G1 = '0189abcd-1234-4678-9abc-0123456789ab';
const G2 = '0189abcd-1234-4678-9abc-0123456789ac';
const GB = '0189abcd-1234-4678-9abc-0123456789ad';
const TA1 = 'a1a1a1a1-1111-4111-8111-111111111111';
const TA2 = 'a2a2a2a2-1111-4111-8111-111111111111';
const TB = 'b2b2b2b2-2222-4222-8222-222222222222';
const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const rid = (t: string, n: number): string => `${t.slice(0, 8)}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
function turns(t: string, word: string): Row[] {
  const cwd = '/home/u/worktrees/p/quiet-basin';
  return [
    userRow({ uuid: rid(t, 1), ts: new Date(T0 + 1000).toISOString(), sessionId: t, cwd, text: `fixture question ${word}` }),
    assistantRow({ uuid: rid(t, 2), ts: new Date(T0 + 2000).toISOString(), sessionId: t, cwd, text: `Fixture answer ${word}.`,
      requestId: `req_${t.slice(0, 8)}`, msgId: `msg_${t.slice(0, 8)}` }),
  ];
}

/** Two projects' families, and one id with two generations. */
function twoProjects(prefix: string): HistoryBox {
  const box = makeHistoryBox(prefix);
  seedFamily(box, { id: ID, project: 'project-a', uuid: TA1, generation: G1, rows: turns(TA1, 'zqalpha') });
  seedFamily(box, { id: ID, project: 'project-a', uuid: TA2, generation: G2, rows: turns(TA2, 'zqalphatwo') });
  seedFamily(box, { id: ID_B, project: 'project-b', uuid: TB, generation: GB, rows: turns(TB, 'zqbravo') });
  return box;
}

/** familiesOf over the store, in a child process: each selection's `ccrc_id/generation` pairs. */
function familiesIn(box: HistoryBox, sels: Record<string, unknown>[]): string[][] {
  const probe = path.join(box.home, 'families.mjs');
  fs.writeFileSync(probe, [
    `import { openReader } from ${JSON.stringify(pathToFileURL(path.join(HIST, 'store.mjs')).href)};`,
    `import { familiesOf } from ${JSON.stringify(pathToFileURL(path.join(HIST, 'recall.mjs')).href)};`,
    `const db = openReader(${JSON.stringify(path.join(box.root, 'db', 'history.db'))});`,
    `const out = ${JSON.stringify(sels)}.map((sel) => familiesOf(db, sel).map((f) => f.ccrcId + '/' + f.generation));`,
    'db.close();',
    'process.stdout.write(JSON.stringify(out));',
  ].join('\n'));
  const r = spawnSync(process.execPath, ['--no-warnings', probe], { encoding: 'utf8', timeout: 60_000, env: box.env });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as string[][];
}

describe("familiesOf's overlord branch (in a child process, on a fixture store)", () => {
  it('all reads both projects; a project-b target reads only its own; a session target reads that id across generations; family is unchanged', () => {
    const box = twoProjects('ccrc-ovr-scope-fam-');
    const [all, projectB, session, family, unknown] = familiesIn(box, [
      { kind: OVERLORD, target: 'all', project: null, id: null },
      { kind: OVERLORD, target: 'project', project: 'project-b', id: null },
      { kind: OVERLORD, target: 'session', project: null, id: ID },
      { kind: 'family', id: ID, generation: G1, project: null, workdir: null, workdirReal: null },
      { kind: OVERLORD, target: 'everything', project: 'project-a', id: ID },
    ]);
    expect([...all!].sort()).toEqual([`${ID}/${G1}`, `${ID}/${G2}`, `${ID_B}/${GB}`].sort());
    expect(projectB).toEqual([`${ID_B}/${GB}`]);
    expect([...session!].sort()).toEqual([`${ID}/${G1}`, `${ID}/${G2}`].sort());
    expect(family, "CONTROL: a family selection still reads ownFamily's answer").toEqual([`${ID}/${G1}`]);
    expect(unknown, 'a target off the grammar reads nothing').toEqual([]);
  }, HEAVY);
});

describe('unreachable by the environment and argv: the CLI never answers a scope of kind overlord', () => {
  it('every recall variable set to overlord, with and without a pane, and --session overlord: refused as today, never kind overlord', () => {
    const box = twoProjects('ccrc-ovr-scope-cli-');
    plantSession(box, ID, { project: 'project-a' });
    const seam = { CCRC_RECALL_SESSION: OVERLORD, CCRC_RECALL_ARM: OVERLORD, CCRC_RECALL_ASOF: OVERLORD };
    const runs = [
      runCli(box, ['grep', 'zqbravo', '--json'], { env: seam }),
      runCli(box, ['grep', 'zqbravo', '--json'], { env: { ...withPane(box, ID), ...seam } }),
      runCli(box, ['grep', 'zqbravo', '--json', '--session', OVERLORD], { env: withPane(box, ID) }),
      runCli(box, ['tree', '--json', '--session', OVERLORD], { env: withPane(box, ID) }),
    ];
    const answers = runs.map((r) => [r.code, r.json?.['reason'] ?? null]);
    expect(answers).toEqual([[2, 'headless-unarmed'], [2, 'headless-in-pane'], [2, 'cross-project'], [2, 'cross-project']]);
    for (const r of runs) expect((r.json?.['scope'] as { kind?: string } | null)?.kind ?? null).not.toBe(OVERLORD);
    const own = runCli(box, ['grep', 'zqalphatwo', '--json'], { env: withPane(box, ID) });
    expect([own.code, (own.json?.['scope'] as { kind: string }).kind], 'CONTROL: the own read answers family').toEqual([0, 'family']);
  }, HEAVY);
});
