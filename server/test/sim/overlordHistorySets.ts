// The Overlord history op's two wire readers, their cases and their mutant sets (Overlord W1,
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md`, Task 3 Step 4). Each reader's cases are written
// ONCE here, as suite cases over a module: `overlord-read.test.ts` runs them against the real `shared/overlordHistory.ts`,
// and `mutation-floors.test.ts` runs them against each named mutant (D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = path.join(ROOT, 'shared/overlordHistory.ts');

export type OverlordHistoryModule = typeof import('../../../shared/overlordHistory.js');

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
    'an oversize field is off-shape': () => {
      off({ ...rows, items: Array.from({ length: m.OVERLORD_HISTORY_ITEMS_MAX + 1 }, () => ({ trust: 'untrusted' })) });
      off({ ...rows, items: [{ text: 'x'.repeat(m.OVERLORD_HISTORY_ANSWER_MAX_BYTES), trust: 'untrusted' }] });
      off({ ...rows, scope: { ...scope, id: 'x'.repeat(513) } });
      off({ outcome: 'too-large', bytes: -1 });
      off({ outcome: 'too-large' });
    },
  };
}

const REQUEST_KEY = 'shared/overlordHistory.ts#readOverlordHistoryRequest';
const ANSWER_KEY = 'shared/overlordHistory.ts#readOverlordHistoryAnswer';

export const OVERLORD_HISTORY_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [REQUEST_KEY]: {
    modulePath: MODULE,
    mutants: [
      { id: 'R1 drop the verb check', old: "if (typeof verb !== 'string' || !Object.prototype.hasOwnProperty.call(HISTORY_VERB_MAP, verb)) return no('bad-verb');", new: "if (typeof verb !== 'string') return no('bad-verb');" },
      { id: 'R2 refuse an unknown key', old: "if (Object.prototype.hasOwnProperty.call(raw, 'regex')) return no('regex');", new: "if (Object.prototype.hasOwnProperty.call(raw, 'regex')) return no('regex');\n  if (Object.keys(raw).some((k) => !['verb', 'target', 'agents', 'args'].includes(k))) return no('bad-args');" },
      { id: 'R3 accept --regex', old: "if (a === '--regex' || a.startsWith('--regex=')) return no('regex');", new: '' },
      { id: 'R4 swap the project and session arms', old: "if (kind === 'project') return nameOk(raw['project']) ? { kind, project: raw['project'] } : 'bad-project';\n  if (kind === 'session') return nameOk(raw['session']) ? { kind, session: raw['session'] } : 'bad-session';", new: "if (kind === 'project') return nameOk(raw['session']) ? { kind, project: raw['session'] } : 'bad-project';\n  if (kind === 'session') return nameOk(raw['project']) ? { kind, session: raw['project'] } : 'bad-session';" },
      { id: 'R5 accept a regex key', old: "if (Object.prototype.hasOwnProperty.call(raw, 'regex')) return no('regex');", new: '' },
      { id: 'R6 a looser bound', old: 'if (utf8Bytes(text) > OVERLORD_HISTORY_REQUEST_MAX_BYTES)', new: 'if (utf8Bytes(text) > OVERLORD_HISTORY_REQUEST_MAX_BYTES + 1)' },
      { id: 'R7 scope flags pass', old: "if (SCOPE_ARGS.has(a)) return no('bad-args');", new: '' },
    ],
    suite: requestReaderCases,
  } as MutantSet<OverlordHistoryModule> as MutantSet<never>,
  [ANSWER_KEY]: {
    modulePath: MODULE,
    mutants: [
      { id: 'A1 accept an unknown outcome', old: "default: return 'off-shape';", new: "default: return { outcome: 'busy' };" },
      { id: 'A2 accept a word off a closed list', old: "return has(HISTORY_REASON_MAP, word) || word === 'not-indexed' ?", new: "return typeof word === 'string' ?" },
      { id: 'A3 a missing discriminant reads as rows', old: 'switch (outcome) {', new: "switch (outcome ?? 'rows') {" },
      { id: 'A4 accept an item without trust untrusted', old: "for (const it of items) if (!isObj(it) || it['trust'] !== 'untrusted') return null;", new: 'for (const it of items) if (!isObj(it)) return null;' },
      { id: 'A5 a failed answer carries any word', old: "case 'failed': return word === 'internal' ?", new: "case 'failed': return typeof word === 'string' ?" },
      { id: 'A6 no item cap', old: 'items.length > OVERLORD_HISTORY_ITEMS_MAX ||', new: '' },
    ],
    suite: answerReaderCases,
  } as MutantSet<OverlordHistoryModule> as MutantSet<never>,
};
