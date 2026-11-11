import { describe, expect, it } from 'vitest';
import {
  CASE_CAUSES, CASE_MIN_OCCURRENCES, CASE_MIN_PROGRAMMES, CASE_MODE, CASE_WINDOW_MS, caseRunIds, caseWindowFrom, casesDue,
} from '../src/coord/practiceCases.js';
import type { CaseDue, CaseObservationRow, CasesInput } from '../src/coord/practiceCases.js';
import { stallDetail } from '../src/coord/stall.js';
import type { StallArm, StallMode } from '../src/coord/stall.js';
import { STALL_ARMS } from '../../shared/stall-watch.js';

const NOW = 1_800_000_000_000;
const FROM = NOW - CASE_WINDOW_MS;

function row(eventId: number, runId: number, at: number, arm: StallArm, key = eventId, rung: 1 | 2 | 3 = 1, mode: StallMode = 'shadow'): CaseObservationRow {
  return { eventId, runId, at, detail: stallDetail(mode, arm, rung, key) };
}
const progs = (runIds: number[], slug: string): Map<number, string> => new Map(runIds.map((r) => [r, slug]));
const sig = (arm: string): string => `stall-arm:${arm}`;

describe('casesDue', () => {
  it("pins the spec's values", () => {
    expect([CASE_WINDOW_MS, CASE_MIN_OCCURRENCES, CASE_MIN_PROGRAMMES, CASE_MODE]).toEqual([1_209_600_000, 3, 2, 'shadow']);
    expect(CASE_CAUSES).toEqual(['count', 'programmes']);
    expect(caseWindowFrom(NOW)).toBe(FROM);
  });
  it('three episodes of one arm in one programme open a count case', () => {
    const rows = [row(11, 1, FROM + 1, 'quiet'), row(12, 2, FROM + 2, 'quiet'), row(13, 3, NOW, 'quiet')];
    expect(casesDue({ rows, programOf: progs([1, 2, 3], 'prog-a'), newestCaseAt: new Map(), now: NOW })).toEqual([
      { signature: 'stall-arm:quiet', cause: 'count', occurrences: 3, programmes: ['prog-a'], evidence: [11, 12, 13], windowFrom: FROM },
    ]);
  });
  it('two episodes in two programmes open a programmes case', () => {
    const rows = [row(11, 1, FROM + 1, 'quiet'), row(12, 2, FROM + 2, 'quiet')];
    const programOf = new Map([[1, 'prog-a'], [2, 'prog-b']]);
    expect(casesDue({ rows, programOf, newestCaseAt: new Map(), now: NOW })).toEqual([
      { signature: 'stall-arm:quiet', cause: 'programmes', occurrences: 2, programmes: ['prog-a', 'prog-b'], evidence: [11, 12], windowFrom: FROM },
    ]);
  });
  it('three rungs of one episode are one occurrence', () => {
    const rows = [row(11, 1, FROM + 1, 'quiet', 5, 1), row(12, 1, FROM + 2, 'quiet', 5, 2), row(13, 1, FROM + 3, 'quiet', 5, 3)];
    expect(casesDue({ rows, programOf: progs([1], 'prog-a'), newestCaseAt: new Map(), now: NOW })).toEqual([]);
  });
  it('a live and a shadow row of one episode are one occurrence', () => {
    const rows = [row(11, 1, FROM + 1, 'quiet', 5, 1, 'shadow'), row(12, 1, FROM + 2, 'quiet', 5, 1, 'live'), row(13, 2, FROM + 3, 'quiet')];
    expect(casesDue({ rows, programOf: progs([1, 2], 'prog-a'), newestCaseAt: new Map(), now: NOW })).toEqual([]);
  });
  it("the window's edge: at FROM counts, at FROM - 1 does not", () => {
    const at = (t: number): CaseDue[] => casesDue({
      rows: [row(11, 1, t, 'dead'), row(12, 2, FROM + 5, 'dead'), row(13, 3, FROM + 6, 'dead')],
      programOf: progs([1, 2, 3], 'prog-a'), newestCaseAt: new Map(), now: NOW,
    });
    expect(at(FROM)).toHaveLength(1);
    expect(at(FROM - 1)).toEqual([]);
  });
  it('a case consumes its evidence: only occurrences after the newest case count', () => {
    const rows = [row(11, 1, FROM + 1, 'quiet'), row(12, 2, FROM + 2, 'quiet'), row(13, 3, FROM + 3, 'quiet')];
    const due = (newest: number): CaseDue[] => casesDue({ rows, programOf: progs([1, 2, 3], 'prog-a'), newestCaseAt: new Map([[sig('quiet'), newest]]), now: NOW });
    expect(due(FROM)).toHaveLength(1);
    expect(due(FROM + 3)).toEqual([]);
    expect(due(FROM + 1).length).toBe(0);
  });
  it('a run missing from programOf is not counted', () => {
    const rows = [row(11, 1, FROM + 1, 'quiet'), row(12, 2, FROM + 2, 'quiet'), row(13, 3, FROM + 3, 'quiet')];
    expect(casesDue({ rows, programOf: progs([1, 2], 'prog-a'), newestCaseAt: new Map(), now: NOW })).toEqual([]);
  });
  it('a row this build cannot read, or an arm a later build added, changes nothing', () => {
    const rows: CaseObservationRow[] = [
      { eventId: 1, runId: 1, at: NOW, detail: 'stall:new-arm:1:5' }, { eventId: 2, runId: 1, at: NOW, detail: null }, { eventId: 3, runId: 1, at: NOW, detail: 'x' },
    ];
    expect(casesDue({ rows, programOf: progs([1], 'prog-a'), newestCaseAt: new Map(), now: NOW })).toEqual([]);
    expect(caseRunIds(rows)).toEqual([]);
  });
  it('caseRunIds names each run of a parseable row once, ascending', () => {
    const rows = [row(1, 7, NOW, 'quiet'), row(2, 3, NOW, 'dead'), row(3, 7, NOW, 'dead'), { eventId: 4, runId: 1, at: NOW, detail: null }];
    expect(caseRunIds(rows)).toEqual([3, 7]);
  });
});

// The oracle: the brief's rule, written here independently of the module.
function oracle(input: CasesInput): CaseDue[] {
  const from = input.now - 14 * 86_400_000;
  const eps = new Map<string, { arm: string; run: number; at: number; id: number }>();
  for (const r of input.rows) {
    const m = /^(stall|stall-shadow):([a-z0-9-]+):([123]):(\d+)$/.exec(r.detail ?? '');
    if (!m || !(STALL_ARMS as readonly string[]).includes(m[2]!)) continue;
    const k = `${r.runId}|${m[2]}|${m[4]}`;
    const e = eps.get(k);
    if (!e || r.at < e.at || (r.at === e.at && r.eventId < e.id)) eps.set(k, { arm: m[2]!, run: r.runId, at: r.at, id: r.eventId });
  }
  const by = new Map<string, { at: number; id: number; prog: string }[]>();
  for (const e of eps.values()) {
    const prog = input.programOf.get(e.run);
    const s = `stall-arm:${e.arm}`;
    if (prog === undefined || e.at < from || e.at <= (input.newestCaseAt.get(s) ?? -Infinity)) continue;
    by.set(s, [...(by.get(s) ?? []), { at: e.at, id: e.id, prog }]);
  }
  const out: CaseDue[] = [];
  for (const [s, list] of [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const progs2 = [...new Set(list.map((x) => x.prog))].sort();
    const cause = list.length >= 3 ? 'count' : progs2.length >= 2 ? 'programmes' : null;
    if (cause) out.push({ signature: s, cause, occurrences: list.length, programmes: progs2, evidence: list.map((x) => x.id).sort((a, b) => a - b), windowFrom: from });
  }
  return out;
}

interface Case { input: CasesInput }
function grid(): Case[] {
  const cases: Case[] = [];
  for (const arm of STALL_ARMS) {
    const control: StallArm = arm === 'quiet' ? 'dead' : 'quiet';
    for (let n = 0; n <= 4; n++) {
      for (let p = 1; p <= Math.max(1, Math.min(n, 3)); p++) {
        for (const first of [FROM + 1000, FROM, FROM - 1]) {
          const rows: CaseObservationRow[] = [];
          const programOf = new Map<number, string>();
          const times: number[] = [];
          for (let i = 0; i < n; i++) {
            const at = i === 0 ? first : FROM + 1000 * (i + 1);
            times.push(at);
            rows.push(row(100 + i, i + 1, at, arm, i));
            programOf.set(i + 1, `prog-${'abc'[i % p]}`);
          }
          rows.push(row(200, 10, NOW, control, 0), row(201, 11, NOW, control, 1));
          programOf.set(10, 'prog-a'); programOf.set(11, 'prog-a');
          for (const nc of [undefined, FROM - 5, first, NOW]) {
            const newestCaseAt = new Map<string, number>();
            if (nc !== undefined) newestCaseAt.set(sig(arm), nc);
            cases.push({ input: { rows, programOf, newestCaseAt, now: NOW } });
          }
        }
      }
    }
  }
  return cases;
}

describe('the whole domain', () => {
  const cases = grid();
  it('is 1,680 inputs', () => expect(cases).toHaveLength(1680));
  it('matches the oracle on every input', () => {
    for (const { input } of cases) expect(casesDue(input)).toEqual(oracle(input));
  });
  it('is monotone: less evidence never adds a signature, and an unreadable row changes nothing', () => {
    const sigs = (i: CasesInput): Set<string> => new Set(casesDue(i).map((d) => d.signature));
    for (const { input } of cases) {
      const base = sigs(input);
      const subset = (s: Set<string>): boolean => [...s].every((x) => base.has(x));
      for (let i = 0; i < input.rows.length; i++) {
        expect(subset(sigs({ ...input, rows: input.rows.filter((_, j) => j !== i) }))).toBe(true);
      }
      for (const run of input.programOf.keys()) {
        const po = new Map(input.programOf); po.delete(run);
        expect(subset(sigs({ ...input, programOf: po }))).toBe(true);
      }
      for (const s of [...base, sig('quiet')]) {
        const nc = new Map(input.newestCaseAt); nc.set(s, Math.max(nc.get(s) ?? 0, FROM) + 1000);
        expect(subset(sigs({ ...input, newestCaseAt: nc }))).toBe(true);
      }
      const extra: CaseObservationRow = { eventId: 999, runId: 1, at: NOW, detail: 'stall:new-arm:1:5' };
      expect(casesDue({ ...input, rows: [...input.rows, extra] })).toEqual(casesDue(input));
    }
  });
});
