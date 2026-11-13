// The compactions reader and counter (Overlord W1a, context readings; spec Table 3.3.11b "Two compactions in one
// generation", Table 3.6a). The reader keeps absent, unreadable and malformed apart; the counter counts one compaction
// per pre line, a post line within COMPACTION_PAIR_MS after a pre of the same trigger and transcript being the same one.
import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';
import {
  COMPACTION_PAIR_MS, compactionsPaths, compactionsSince, readCompactionsMeasured, type CompactionLine,
} from '../src/continuity/compactions.js';
import { COUNT_CASES, checkMonotonic, smallSequences } from './continuityCompactionsCases.js';

const ID = 'lane-a-project-a';
const T = 1_800_000_000_000;

describe('compactionsSince', () => {
  it('COMPACTION_PAIR_MS is ten minutes, the window the cases are written against', () => {
    expect(COMPACTION_PAIR_MS).toBe(600_000);
  });
  it.each(COUNT_CASES.map(([n, l, s, w]) => [n, l, s, w] as const))('%s', (_name, lines, since, want) => {
    expect(compactionsSince(lines, since)).toBe(want);
  });
  it('appending a line never lowers the count, over every sequence of up to four lines', () => {
    expect(smallSequences().length).toBe(1 + 6 + 36 + 216 + 1296);
    expect(() => checkMonotonic(compactionsSince)).not.toThrow();
  });
  it('the order of the lines does not change the count', () => {
    const lines: CompactionLine[] = [
      { phase: 'post', trigger: 'auto', at: T + 60_000, transcript: null, scope: 'main' },
      { phase: 'pre', trigger: 'auto', at: T, transcript: null, scope: 'main' },
    ];
    expect(compactionsSince(lines, T)).toBe(1);
    expect(compactionsSince([...lines].reverse(), T)).toBe(1);
  });
});

/** A FleetIO whose reads answer from a table: a path it does not name is absent. */
const tableIO = (files: Record<string, string | 'unreadable'>): FleetIO => ({
  readFileMeasured: async (p: string) => {
    const v = files[p];
    if (v === undefined) return { ok: false, reason: 'absent' };
    if (v === 'unreadable') return { ok: false, reason: 'unreadable' };
    return { ok: true, content: v };
  },
}) as unknown as FleetIO;

const P = compactionsPaths('/reg', ID);
/** A journal record in the hook's own sixteen-key shape (JOURNAL_RECORD_PRED). */
const record = (at: number, trigger = 'auto', transcript: string | null = '/t/a.jsonl'): string => JSON.stringify({
  agent: null, at, built: null, chars: 120, cited: null, cwd: null, fences: 0, filesChars: null, liveAgents: 0,
  parentLive: null, scope: 'main', served: false, setSize: null, steered: false, transcript, trigger,
});
const preLine = (at: number, trigger = 'auto', transcript: string | null = '/t/a.jsonl'): string =>
  JSON.stringify({ at, trigger, scope: 'main', transcript, phase: 'pre' });

describe('readCompactionsMeasured keeps absent, unreadable and malformed apart', () => {
  it('the three paths are the registry\'s journal, the pre file and its rotation', () => {
    expect(P).toEqual({ journal: '/reg/lane-a-project-a.compactions', pre: '/reg/lane-a-project-a.compactevents',
      prev: '/reg/lane-a-project-a.compacteventsprev' });
  });
  it('none of the three files: absent, never zero lines', async () => {
    expect(await readCompactionsMeasured(tableIO({}), '/reg', ID)).toEqual({ kind: 'absent' });
  });
  it.each(['journal', 'pre', 'prev'] as const)('the %s file unreadable: unreadable, even beside readable ones', async (which) => {
    const files: Record<string, string> = { [P.journal]: `${record(T)}\n`, [P.pre]: `${preLine(T)}\n`, [P.prev]: '' };
    files[P[which]] = 'unreadable';
    expect(await readCompactionsMeasured(tableIO(files), '/reg', ID)).toEqual({ kind: 'unreadable' });
  });
  it('a journal record reads as a post line, a pre line as a pre line, in milliseconds', async () => {
    const r = await readCompactionsMeasured(tableIO({
      [P.journal]: `${record(T + 60_000, 'manual')}\n`, [P.pre]: `${preLine(T, 'manual')}\n`,
    }), '/reg', ID);
    expect(r).toEqual({ kind: 'lines', skipped: 0, eventsAbsent: false, lines: [
      { at: T + 60_000, trigger: 'manual', phase: 'post', transcript: '/t/a.jsonl', scope: 'main' },
      { at: T, trigger: 'manual', phase: 'pre', transcript: '/t/a.jsonl', scope: 'main' },
    ] });
  });
  it('the journal alone (an older hook, before any pre line) reads its posts, and says the events files are absent', async () => {
    const r = await readCompactionsMeasured(tableIO({ [P.journal]: `${record(T)}\n${record(T + 1)}\n` }), '/reg', ID);
    expect(r.kind === 'lines' && r.lines.map((l) => l.phase)).toEqual(['post', 'post']);
    expect(r).toMatchObject({ kind: 'lines', eventsAbsent: true });
  });
  // Review 1927 M1: eventsAbsent is true only when BOTH events files are absent; either one present is a hook that
  // writes pre lines, so its count is no mere lower bound.
  it.each(['pre', 'prev'] as const)('the journal and the %s file: eventsAbsent is false', async (which) => {
    const r = await readCompactionsMeasured(tableIO({ [P.journal]: `${record(T)}\n`, [P[which]]: '' }), '/reg', ID);
    expect(r).toMatchObject({ kind: 'lines', eventsAbsent: false });
  });
  it('the pre files alone (no compaction has settled yet) read their pres', async () => {
    const r = await readCompactionsMeasured(tableIO({ [P.prev]: `${preLine(T)}\n` }), '/reg', ID);
    expect(r.kind === 'lines' && r.lines).toEqual([{ at: T, trigger: 'auto', phase: 'pre', transcript: '/t/a.jsonl', scope: 'main' }]);
  });
  it('a malformed line is counted in skipped and never thrown; a trailing newline is not a line', async () => {
    const r = await readCompactionsMeasured(tableIO({
      [P.journal]: `${record(T)}\n{"at":\nnot json\n[1]\n{"at":-1,"trigger":"auto"}\n{"at":"1","trigger":"auto"}\n`,
      [P.pre]: `${preLine(T)}\n{"at":5,"trigger":"auto","transcript":7,"phase":"pre"}\n${preLine(T + 1).slice(0, 20)}`,
    }), '/reg', ID);
    expect(r).toMatchObject({ kind: 'lines', skipped: 7 });
    expect(r.kind === 'lines' && r.lines).toHaveLength(2);
  });
  it('a pre file line without phase "pre", and a journal line with a phase, are skipped: no line is counted twice', async () => {
    const r = await readCompactionsMeasured(tableIO({
      [P.journal]: `${preLine(T)}\n`, [P.pre]: `${record(T)}\n`,
    }), '/reg', ID);
    expect(r).toEqual({ kind: 'lines', lines: [], skipped: 2, eventsAbsent: false });
  });
  it('a refused line in the pre file reads as refused, and never cancels a pre (plan review 1896 B3)', async () => {
    const refused = JSON.stringify({ at: T + 5, trigger: 'auto', scope: 'main', transcript: '/t/a.jsonl', phase: 'refused' });
    const r = await readCompactionsMeasured(tableIO({ [P.pre]: `${preLine(T)}\n${refused}\n` }), '/reg', ID);
    expect(r.kind === 'lines' && r.lines.map((l) => l.phase)).toEqual(['pre', 'refused']);
    expect(r.kind === 'lines' && compactionsSince(r.lines, T)).toBe(1);
  });
  it('each line keeps the hook\'s scope verdict; a word outside the three reads null, never main', async () => {
    const line = (scope: unknown): string => JSON.stringify({ at: T, trigger: 'auto', scope, transcript: null, phase: 'pre' });
    const r = await readCompactionsMeasured(tableIO({ [P.pre]: ['main', 'subagent', 'ambiguous', null, 'Main', 7]
      .map((x) => line(x)).join('\n') }), '/reg', ID);
    expect(r.kind === 'lines' && r.lines.map((l) => l.scope)).toEqual(['main', 'subagent', 'ambiguous', null, null, null]);
  });
  it('a trigger outside auto and manual reads other', async () => {
    const r = await readCompactionsMeasured(tableIO({ [P.pre]: `${preLine(T, 'weird')}\n` }), '/reg', ID);
    expect(r.kind === 'lines' && r.lines[0]!.trigger).toBe('other');
  });
  it('a pre line seen in both files (a rotation between the two reads) is taken once', async () => {
    const both = `${preLine(T)}\n${preLine(T + 1)}\n`;
    const r = await readCompactionsMeasured(tableIO({ [P.pre]: both, [P.prev]: both }), '/reg', ID);
    expect(r.kind === 'lines' && r.lines.map((l) => l.at)).toEqual([T, T + 1]);
  });
  it('reads the current pre file before its rotation, so a rotation between the reads can never hide a line', async () => {
    const order: string[] = [];
    const io = { readFileMeasured: async (p: string) => { order.push(p); return { ok: false, reason: 'absent' }; } } as unknown as FleetIO;
    await readCompactionsMeasured(io, '/reg', ID);
    expect(order.indexOf(P.pre)).toBeLessThan(order.indexOf(P.prev));
  });
  it('from the real paths through localIO, an EACCES file included', async () => {
    const reg = mkTmp('ccrc-continuity-compactions-');
    mkdirSync(reg, { recursive: true });
    writeFileSync(path.join(reg, `${ID}.compactions`), `${record(T)}\n`);
    writeFileSync(path.join(reg, `${ID}.compactevents`), `${preLine(T - 1)}\n`);
    const r = await readCompactionsMeasured(localIO, reg, ID);
    expect(r.kind === 'lines' && compactionsSince(r.lines, T - 1)).toBe(1);
    if (process.getuid?.() !== 0) {
      chmodSync(path.join(reg, `${ID}.compactevents`), 0o000);
      expect(await readCompactionsMeasured(localIO, reg, ID)).toEqual({ kind: 'unreadable' });
    }
  });
});
