// The Overlord history op's guards, their cases and their mutant sets (Overlord W1,
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md`, Task 3 Step 4; review 2126 F1 and F9). Each
// guard's cases are written ONCE here, as suite cases over a module: the op's suites run them against the real module,
// and `mutation-floors.test.ts` runs them against each named mutant (D-8217's every-run floors):
//   - the two wire readers (shared/overlordHistory.ts), run by overlord-read.test.ts;
//   - decideScope never answering `overlord` (ccd/history/lib.mjs), run by overlord-read-scope.test.ts;
//   - measureReach opening no ccrc.env with the empty role (ccd/history/read-context.mjs), run by
//     overlord-read-context.test.ts;
//   - the op's ready word and its link-close terminate (agent/src/historyOp.ts), which agent/test/overlord-history-op.test.ts
//     pins on a real agent, here on the module alone.
// The side-effect pin over read-context.mjs is a scan of its text, which no module suite can see: its bite is a
// planted-control case in overlord-read-context.test.ts instead.
import fs, { mkdirSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';
import { mkTmp } from '../tmpHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = path.join(ROOT, 'shared/overlordHistory.ts');
const LIB = path.join(ROOT, 'ccd/history/lib.mjs');
const READ_CONTEXT = path.join(ROOT, 'ccd/history/read-context.mjs');
const HISTORY_OP = path.join(ROOT, 'agent/src/historyOp.ts');

export type OverlordHistoryModule = typeof import('../../../shared/overlordHistory.js');
export type HistoryLibModule = typeof import('../../../ccd/history/lib.mjs');
/** read-context.mjs, as far as these cases call it (a plain module with no declaration file). */
export interface ReadContextModule { measureReach(home: string, role: string): Promise<{ role: string }> }
/** agent/src/historyOp.ts, as far as these cases call it (typed here, so the server's type check never compiles the agent). */
export interface HistoryOpModule {
  createHistoryOp(seams: { resolveWorker: () => string | null; deadlineMs: number; platform: string; log: (line: string) => void }): {
    readonly servable: boolean;
    run(home: string, request: object, owner: object): Promise<unknown>;
    abandon(owner: object): void;
  };
}

/** `readOverlordHistoryRequest`'s cases. */
export function requestReaderCases(m: OverlordHistoryModule): Record<string, SuiteCase> {
  const read = (raw: unknown): unknown => {
    const r = m.readOverlordHistoryRequest(raw);
    return r.ok ? r.request : r.refusal;
  };
  const base = { verb: 'search', target: { kind: 'all' }, args: ['x'] };
  return {
    'accepts each verb with valid arguments, filling the defaults': () => {
      expect(read({ verb: 'search', target: { kind: 'all' }, args: ['deploy', '--limit', '5'] }))
        .toEqual({ verb: 'search', target: { kind: 'all' }, agents: false, args: ['deploy', '--limit', '5'] });
      expect(read({ verb: 'describe', target: { kind: 'project', project: 'project-b' }, agents: true, args: ['N0123456789'] }))
        .toEqual({ verb: 'describe', target: { kind: 'project', project: 'project-b' }, agents: true, args: ['N0123456789'] });
      expect(read({ verb: 'expand', target: { kind: 'session', session: 'lane-a-project-a' } }))
        .toEqual({ verb: 'expand', target: { kind: 'session', session: 'lane-a-project-a' }, agents: false, args: [] });
    },
    'ignores a key it does not know (absence permits)': () => {
      expect(read({ ...base, newerField: { a: 1 } })).toEqual({ verb: 'search', target: { kind: 'all' }, agents: false, args: ['x'] });
      expect(read({ ...base, t: 'req', id: 4, op: 'overlord-history' }), 'the envelope\'s own keys').toEqual({ verb: 'search', target: { kind: 'all' }, agents: false, args: ['x'] });
      expect(read({ ...base, target: { kind: 'project', project: 'project-a', session: 'lane-a-project-a' } }))
        .toEqual({ verb: 'search', target: { kind: 'project', project: 'project-a' }, agents: false, args: ['x'] });
    },
    'refuses a verb off the list': () => {
      expect(read(null)).toBe('not-object');
      expect(read([base])).toBe('not-object');
      for (const verb of ['tree', 'grep', 'touched', 'status', '', 7]) expect(read({ ...base, verb }), String(verb)).toBe('bad-verb');
    },
    'refuses a target off the grammar, and reads each arm by its own field': () => {
      expect(read({ ...base, target: { kind: 'workspace' } })).toBe('bad-target');
      expect(read({ ...base, target: 'all' })).toBe('bad-target');
      expect(read({ ...base, target: { kind: 'project', project: '' } })).toBe('bad-project');
      expect(read({ ...base, target: { kind: 'project', project: '../etc' } })).toBe('bad-project');
      expect(read({ ...base, target: { kind: 'session', session: 'Not An Id!' } })).toBe('bad-session');
      expect(read({ ...base, target: { kind: 'session', session: '..' } })).toBe('bad-session');
      expect(read({ ...base, target: { kind: 'session', project: 'project-a' } }), 'the session arm reads session').toBe('bad-session');
      expect(read({ ...base, target: { kind: 'project', session: 'lane-a-project-a' } }), 'the project arm reads project').toBe('bad-project');
    },
    'refuses arguments of the wrong type or size, and the scope flags': () => {
      expect(read({ ...base, agents: 'yes' })).toBe('bad-agents');
      expect(read({ ...base, args: 'x' })).toBe('bad-args');
      expect(read({ ...base, args: [1] })).toBe('bad-args');
      expect(read({ ...base, args: ['x'.repeat(m.OVERLORD_HISTORY_ARG_MAX_CHARS + 1)] })).toBe('bad-args');
      expect(read({ ...base, args: Array.from({ length: m.OVERLORD_HISTORY_ARGS_MAX + 1 }, () => 'x') })).toBe('bad-args');
      for (const flag of ['--session', '--project', '--workspace', '--agents', '--json']) expect(read({ ...base, args: ['x', flag] }), flag).toBe('bad-args');
    },
    'refuses regex and any argument spelling --regex (F3)': () => {
      expect(read({ ...base, regex: 'a.*b' })).toBe('regex');
      expect(read({ ...base, args: ['--regex', 'a.*b'] })).toBe('regex');
      expect(read({ ...base, args: ['x', '--', '--regex'] }), 'after -- too').toBe('regex');
      expect(read({ ...base, args: ['--regex=a'] })).toBe('regex');
    },
    'refuses a bare -- (review 2126 F3)': () => {
      expect(read({ ...base, args: ['--'] })).toBe('separator');
      expect(read({ ...base, args: ['x', '--', 'y'] })).toBe('separator');
      expect(read({ ...base, args: ['---', '-', '--x'] }), 'only the bare separator').toEqual({ verb: 'search', target: { kind: 'all' }, agents: false, args: ['---', '-', '--x'] });
    },
    'refuses a body over the bound, and admits one just under it': () => {
      const fill = (n: number) => ({ ...base, pad: 'x'.repeat(n) });
      const under = m.OVERLORD_HISTORY_REQUEST_MAX_BYTES - JSON.stringify(fill(0)).length;
      expect(read(fill(under))).toEqual({ verb: 'search', target: { kind: 'all' }, agents: false, args: ['x'] });
      expect(read(fill(under + 1))).toBe('oversize');
    },
  };
}

/** `readOverlordHistoryAnswer`'s cases. */
export function answerReaderCases(m: OverlordHistoryModule): Record<string, SuiteCase> {
  const scope = { kind: 'overlord', id: 'all', project: null, families: [{ ccrc_id: 'lane-a-project-a', generation: 'g', first_seen_ms: 1 }], families_total: 1, transcripts: 1 };
  const rows = { outcome: 'rows', exit: 0, items: [{ node_id: 'N1', trust: 'untrusted' }], shown: 1, total: 1, scope };
  const off = (v: unknown): void => { expect(m.readOverlordHistoryAnswer(v), JSON.stringify(v).slice(0, 120)).toBe('off-shape'); };
  return {
    'reads every outcome back typed': () => {
      expect(m.readOverlordHistoryAnswer(rows)).toEqual(rows);
      expect(m.readOverlordHistoryAnswer({ ...rows, exit: 3, items: [], shown: 0, total: 0 })).toEqual({ ...rows, exit: 3, items: [], shown: 0, total: 0 });
      expect(m.readOverlordHistoryAnswer({ outcome: 'verb-refused', word: 'not-indexed' })).toEqual({ outcome: 'verb-refused', word: 'not-indexed' });
      expect(m.readOverlordHistoryAnswer({ outcome: 'verb-refused', word: 'out-of-scope' })).toEqual({ outcome: 'verb-refused', word: 'out-of-scope' });
      for (const w of ['store-absent', 'no-store', 'recall-off', 'store-read-failed']) {
        expect(m.readOverlordHistoryAnswer({ outcome: 'store-refused', word: w })).toEqual({ outcome: 'store-refused', word: w });
      }
      expect(m.readOverlordHistoryAnswer({ outcome: 'request-refused', word: 'regex' })).toEqual({ outcome: 'request-refused', word: 'regex' });
      expect(m.readOverlordHistoryAnswer({ outcome: 'busy' })).toEqual({ outcome: 'busy' });
      expect(m.readOverlordHistoryAnswer({ outcome: 'deadline' })).toEqual({ outcome: 'deadline' });
      expect(m.readOverlordHistoryAnswer({ outcome: 'too-large', bytes: 70_000 })).toEqual({ outcome: 'too-large', bytes: 70_000 });
      expect(m.readOverlordHistoryAnswer({ outcome: 'failed', word: 'internal' })).toEqual({ outcome: 'failed', word: 'internal' });
    },
    'a missing discriminant or an unknown outcome is off-shape': () => {
      off({ exit: 0, items: [], shown: 0, total: 0, scope });
      off({ ...rows, outcome: undefined });
      off({ outcome: 'lost' });
      off({ outcome: 'rows-and-more' });
      off('rows');
    },
    'a word off its closed list is off-shape': () => {
      off({ outcome: 'verb-refused', word: 'store-absent' });
      off({ outcome: 'verb-refused', word: 'a message from somewhere' });
      off({ outcome: 'store-refused', word: 'not-indexed' });
      off({ outcome: 'failed', word: 'boom: a message' });
      off({ outcome: 'request-refused', word: 'bad-request' });
    },
    'a rows answer off its shape, an item without trust untrusted included, is off-shape': () => {
      off({ ...rows, items: 'x' });
      off({ ...rows, scope: null });
      off({ ...rows, scope: { ...scope, kind: 'family' } });
      off({ ...rows, exit: 2 });
      off({ ...rows, items: [{ node_id: 'N1' }] });
      off({ ...rows, items: [{ node_id: 'N1', trust: 'trusted' }] });
    },
    'every own word reads back under its one outcome, and is off-shape under the others (review 2126 F6)': () => {
      // The expected outcome of each own word, stated here: a word the map gains without a line here is red.
      const own: Record<string, string> = {
        'not-indexed': 'verb-refused', 'recall-off': 'store-refused', 'no-store': 'store-refused', 'store-absent': 'store-refused',
        internal: 'failed',
      };
      expect([...m.OVERLORD_HISTORY_OWN_WORDS].sort()).toEqual(Object.keys(own).sort());
      for (const word of m.OVERLORD_HISTORY_OWN_WORDS) {
        expect(m.isOverlordHistoryOwnWord(word), word).toBe(true);
        for (const outcome of ['verb-refused', 'store-refused', 'failed']) {
          const got = m.readOverlordHistoryAnswer({ outcome, word });
          expect(got, `${outcome} ${word}`).toEqual(outcome === own[word] ? { outcome, word } : 'off-shape');
        }
      }
      expect(m.isOverlordHistoryOwnWord('bad-args'), 'a history word is no own word').toBe(false);
    },
    'an oversize field is off-shape': () => {
      off({ ...rows, items: Array.from({ length: m.OVERLORD_HISTORY_ITEMS_MAX + 1 }, () => ({ trust: 'untrusted' })) });
      off({ ...rows, items: [{ text: 'x'.repeat(m.OVERLORD_HISTORY_ANSWER_MAX_BYTES), trust: 'untrusted' }] });
      off({ ...rows, scope: { ...scope, id: 'x'.repeat(513) } });
      off({ outcome: 'too-large', bytes: -1 });
      off({ outcome: 'too-large' });
    },
  };
}

/** decideScope's cases: it never answers `overlord` (Task 2). */
export function decideScopeCases(lib: HistoryLibModule): Record<string, SuiteCase> {
  const OVERLORD = 'overlord';
  type Presence = { state: 'value'; value: string } | { state: 'absent' } | { state: 'unreadable' };
  const presences = (value: string): Presence[] => [
    { state: 'value', value }, { state: 'absent' }, { state: 'unreadable' }, { state: 'value', value: '' },
    { state: 'value', value: OVERLORD },
  ];
  const sources = [...lib.SCOPE_SOURCES, 'nowhere', OVERLORD];
  const sessions: Array<string | null> = [null, 'lane-a-project-a', 'lane-b-project-a', 'Not An Id!', OVERLORD];
  const bools = [false, true];
  return {
    'for every input, the verdict is a refusal or a SCOPE_KINDS kind, never overlord': () => {
      let verdicts = 0;
      let oks = 0;
      for (const source of sources) for (const project of bools) for (const workspace of bools) for (const agents of bools)
        for (const session of sessions) for (const regProject of presences('project-a')) for (const regWorkdir of presences('/w'))
          for (const sessionProject of [null, ...presences('project-a')]) {
            const v = lib.decideScope({
              source, id: 'lane-a-project-a', generation: { value: null, via: 'none' } as never,
              flags: { project, workspace, session, agents },
              reg: { project: regProject as never, workdir: regWorkdir as never, sessionProject: sessionProject as never },
            } as never) as { ok: boolean; kind?: string };
            verdicts += 1;
            if (v.ok) {
              oks += 1;
              expect(lib.SCOPE_KINDS as readonly string[], JSON.stringify({ source, project, workspace, session })).toContain(v.kind);
              expect(v.kind).not.toBe(OVERLORD);
            }
          }
      expect(verdicts, 'the enumeration ran').toBeGreaterThan(10_000);
      expect(oks, 'CONTROL: some inputs pass, so the kind check is not vacuous').toBeGreaterThan(100);
    },
  };
}

/** Every path `fn` hands an fs open, list or stream, in this process: the sync, callback and promise forms. */
async function opensDuring(fn: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const note = (p: unknown): void => { if (typeof p === 'string') seen.push(p); else if (p instanceof URL) seen.push(fileURLToPath(p)); };
  const wraps: Array<[Record<string, unknown>, string]> = [
    ...['readFileSync', 'openSync', 'readdirSync', 'readFile', 'open', 'readdir', 'createReadStream'].map((n) => [fs as unknown as Record<string, unknown>, n] as [Record<string, unknown>, string]),
    ...['readFile', 'open', 'readdir'].map((n) => [fs.promises as unknown as Record<string, unknown>, n] as [Record<string, unknown>, string]),
  ];
  const real = wraps.map(([o, n]) => o[n] as (...a: unknown[]) => unknown);
  wraps.forEach(([o, n], k) => { o[n] = function spy(this: unknown, p: unknown, ...rest: unknown[]) { note(p); return real[k]!.call(this, p, ...rest); }; });
  syncBuiltinESMExports();
  try {
    await fn();
  } finally {
    wraps.forEach(([o, n], k) => { o[n] = real[k]; });
    syncBuiltinESMExports();
  }
  return seen;
}

/** measureReach's case: with the empty role it opens no ccrc.env, by any form (R1). */
export function measureReachCases(m: ReadContextModule): Record<string, SuiteCase> {
  return {
    "measureReach(home, '') answers the empty role and opens no ccrc.env, a server role recorded there included (R1)": async () => {
      const home = mkTmp('ccrc-ovr-reach-');
      mkdirSync(path.join(home, '.ccrc'), { recursive: true });
      writeFileSync(path.join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
      const control = path.join(home, 'spy-control');
      writeFileSync(control, 'x');
      let role: string | null = null;
      const opened = await opensDuring(async () => {
        role = (await m.measureReach(home, '')).role;
        fs.readFileSync(control);
      });
      expect(opened, 'CONTROL: the spy sees an open').toContain(control);
      expect(role).toBe('');
      expect(opened.filter((p) => p.endsWith('ccrc.env'))).toEqual([]);
    },
  };
}

const sleep = (ms: number): Promise<'slept'> => new Promise((r) => setTimeout(() => r('slept'), ms));

/** The op's cases on the module alone: the ready word (Task 4) and the link-close terminate (review 2126 F1). */
export function historyOpCases(m: HistoryOpModule): Record<string, SuiteCase> {
  const seams = (platform: string, entry: string | null, extra: { deadlineMs?: number; log?: (l: string) => void } = {}) => ({
    resolveWorker: () => entry, deadlineMs: extra.deadlineMs ?? 1_000, platform, log: extra.log ?? (() => {}),
  });
  return {
    'servable only where the worker entry resolves and the platform is not macOS': () => {
      const entry = path.join(ROOT, 'ccd', 'history', 'overlord-worker.mjs');
      expect(m.createHistoryOp(seams('linux', entry)).servable).toBe(true);
      expect(m.createHistoryOp(seams('linux', null)).servable).toBe(false);
      expect(m.createHistoryOp(seams('darwin', entry)).servable).toBe(false);
    },
    "closing the owner's link terminates its worker: failed long before the deadline, and the slot frees": async () => {
      const dir = mkTmp('ccrc-ovr-op-');
      const never = path.join(dir, 'never.mjs');
      writeFileSync(never, 'setInterval(() => {}, 1000);\n');
      const logged: string[] = [];
      const op = m.createHistoryOp(seams('linux', never, { deadlineMs: 10_000, log: (l) => { logged.push(l); } }));
      const req = { verb: 'search', target: { kind: 'all' }, agents: false, args: ['x'] };
      const owner = {};
      const pending = op.run(dir, req, owner);
      await sleep(100);
      op.abandon({});
      expect(await op.run(dir, req, {}), "CONTROL: another link's close leaves the slot held").toEqual({ outcome: 'busy' });
      op.abandon(owner);
      expect(await Promise.race([pending, sleep(5_000)]), 'answered at the close, not at the 10 s deadline')
        .toEqual({ outcome: 'failed', word: 'internal' });
      expect(logged).toEqual(['ccrc-agent: overlord-history failed']);
      const next = {};
      const second = op.run(dir, req, next);
      op.abandon(next);
      expect(await second, 'the slot freed on the exit: the next read started').toEqual({ outcome: 'failed', word: 'internal' });
    },
  };
}

const REQUEST_KEY = 'shared/overlordHistory.ts#readOverlordHistoryRequest';
const ANSWER_KEY = 'shared/overlordHistory.ts#readOverlordHistoryAnswer';
const SCOPE_KEY = 'ccd/history/lib.mjs#decideScope';
const REACH_KEY = 'ccd/history/read-context.mjs#measureReach';
const OP_KEY = 'agent/src/historyOp.ts#createHistoryOp';

export const OVERLORD_HISTORY_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [REQUEST_KEY]: {
    modulePath: MODULE,
    mutants: [
      { id: 'R1 drop the verb check', old: "if (typeof verb !== 'string' || !Object.prototype.hasOwnProperty.call(HISTORY_VERB_MAP, verb)) return no('bad-verb');", new: "if (typeof verb !== 'string') return no('bad-verb');" },
      { id: 'R2 refuse an unknown key', old: "if (Object.prototype.hasOwnProperty.call(raw, 'regex')) return no('regex');", new: "if (Object.prototype.hasOwnProperty.call(raw, 'regex')) return no('regex');\n  if (Object.keys(raw).some((k) => !['verb', 'target', 'agents', 'args'].includes(k))) return no('bad-args');" },
      { id: 'R3 accept --regex', old: "if (words.some((a) => a === '--regex' || a.startsWith('--regex='))) return no('regex');", new: '' },
      { id: 'R4 swap the project and session arms', old: "if (kind === 'project') return nameOk(raw['project']) ? { kind, project: raw['project'] } : 'bad-project';\n  if (kind === 'session') return nameOk(raw['session']) ? { kind, session: raw['session'] } : 'bad-session';", new: "if (kind === 'project') return nameOk(raw['session']) ? { kind, project: raw['session'] } : 'bad-project';\n  if (kind === 'session') return nameOk(raw['project']) ? { kind, session: raw['project'] } : 'bad-session';" },
      { id: 'R5 accept a regex key', old: "if (Object.prototype.hasOwnProperty.call(raw, 'regex')) return no('regex');", new: '' },
      { id: 'R6 a looser bound', old: 'if (utf8Bytes(text) > OVERLORD_HISTORY_REQUEST_MAX_BYTES)', new: 'if (utf8Bytes(text) > OVERLORD_HISTORY_REQUEST_MAX_BYTES + 1)' },
      { id: 'R7 scope flags pass', old: "if (words.some((a) => SCOPE_ARGS.has(a))) return no('bad-args');", new: '' },
      { id: 'R8 accept a bare --', old: "if (words.includes('--')) return no('separator');", new: '' },
    ],
    suite: requestReaderCases,
  } as MutantSet<OverlordHistoryModule> as MutantSet<never>,
  [ANSWER_KEY]: {
    modulePath: MODULE,
    mutants: [
      { id: 'A1 accept an unknown outcome', old: "default: return 'off-shape';", new: "default: return { outcome: 'busy' };" },
      { id: 'A2 accept a word off a closed list', old: "return has(HISTORY_REASON_MAP, word) || ownWordOf(outcome, word) ? { outcome, word: word as OverlordVerbRefusedWord }", new: "return typeof word === 'string' ? { outcome, word: word as OverlordVerbRefusedWord }" },
      { id: 'A3 a missing discriminant reads as rows', old: 'switch (outcome) {', new: "switch (outcome ?? 'rows') {" },
      { id: 'A4 accept an item without trust untrusted', old: "for (const it of items) if (!isObj(it) || it['trust'] !== 'untrusted') return null;", new: 'for (const it of items) if (!isObj(it)) return null;' },
      { id: 'A5 a failed answer carries any word', old: "case 'failed': return ownWordOf(outcome, word) ?", new: "case 'failed': return typeof word === 'string' ?" },
      { id: 'A6 no item cap', old: 'items.length > OVERLORD_HISTORY_ITEMS_MAX ||', new: '' },
      { id: 'A7 an own word under another outcome', old: "'no-store': 'store-refused',", new: "'no-store': 'verb-refused'," },
    ],
    suite: answerReaderCases,
  } as MutantSet<OverlordHistoryModule> as MutantSet<never>,
  [SCOPE_KEY]: {
    modulePath: LIB,
    mutants: [
      { id: 'S1 an env source with --session answers overlord', old: "return verdict('family', { id: session, generation: session === i.id ? i.generation.value : null });", new: "return verdict(i.source === SCOPE_SOURCES[1] ? 'overlord' : 'family', { id: session, generation: session === i.id ? i.generation.value : null });" },
    ],
    suite: decideScopeCases,
  } as MutantSet<HistoryLibModule> as MutantSet<never>,
  [REACH_KEY]: {
    modulePath: READ_CONTEXT,
    mutants: [
      { id: 'C1 measureReach reads the role from ccrc.env', old: "  const P = historyPaths(home);\n  const darwin = process.platform === 'darwin';", new: "  const P = historyPaths(home);\n  readTrimmed(`${home}/.ccrc/ccrc.env`);\n  const darwin = process.platform === 'darwin';" },
    ],
    suite: measureReachCases,
  } as MutantSet<ReadContextModule> as MutantSet<never>,
  [OP_KEY]: {
    modulePath: HISTORY_OP,
    mutants: [
      { id: 'H1 servable without the platform check', old: "servable: seams.platform !== 'darwin' && seams.resolveWorker() !== null,", new: 'servable: seams.resolveWorker() !== null,' },
      { id: 'H2 servable without the resolver check', old: "servable: seams.platform !== 'darwin' && seams.resolveWorker() !== null,", new: "servable: seams.platform !== 'darwin'," },
      { id: 'H3 closing the link does not terminate', old: 'if (slot !== null && slot.owner === owner) slot.worker.terminate().catch(drain);', new: 'void owner;' },
    ],
    suite: historyOpCases,
  } as MutantSet<HistoryOpModule> as MutantSet<never>,
};
