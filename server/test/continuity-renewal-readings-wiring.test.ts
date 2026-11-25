// Overlord W1, the renewal readings' wiring (plan `w1-renewal-readings.md`, PRs A, B and C): `renewalReadingsOf` reads each
// wired producer once per pass, answers the Overlord's fields, and catches each producer on its own (review 2183 F17); PR C adds
// the designation's two readings and binds the pass's latch raise to the ladder's one raise path; PR B adds `notLocal`, for
// every generation the gather reads, from the watcher's transcript resolver, bracketed by the isolation word's carrier.
import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { localIO, type FleetIO } from '../src/io.js';
import { parsedFile, sourceOfSymbol } from './scan/symbols.js';
import { codeOnly } from './sourceScan.js';
import { FIT_WINDOW, SPOT_PROBE_EVERY_TOKENS } from '../../shared/continuity.js';
import type { BackstopRead } from '../../shared/renewal-readings.js';
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';
import type { LatchRaiseInput } from '../src/coord/overlordLadderStore.js';
import type { CcrcConfig } from '../src/config.js';
import type { GenRow, StartRead } from '../src/continuity/continuityStore.js';
import type { SessionRecord } from '../src/registry.js';
import { GLOB_STAT_CONCURRENCY, type ResolveOpts, type TranscriptResolution } from '../src/transcript/resolve.js';
import type { WakingHostKey } from '../src/isolationWord.js';
import type { TurnMarkRead } from '../src/coord/stall.js';
import type { GenReadings } from '../src/continuity/generationsLane.js';
import { renewalReadingsOf, type ReadingsCoord } from '../src/continuity/renewalReadingsWiring.js';
import type { SpotsRead } from '../src/continuity/renewalReadings.js';
import type { UsageRead } from '../src/usage.js';

const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);
const gen = (over: Partial<GenRow>): GenRow =>
  ({ id: 1, sessionId: 'lane-a-project-a', role: 'overlord', model: 'claude-opus-5-5', lane: 'lane-a', startId: 7, startReportedAt: NOW - 86_400_000,
    ...over }) as GenRow;
const usage = (ctxWindow: number | null, stale = false): UsageRead => ({ kind: 'reading', uuid: null, usage: {
  ts: 1, model: 'claude-opus-5-5', class: null, effort: null, ctxPct: null, ctxTokens: 1_000, ctxWindow, cost: null, cacheExpiresAt: null, stale,
} });
const base = (u: UsageRead = usage(200_000), turn: TurnMarkRead = { ok: false, reason: 'absent' }): GenReadings =>
  ({ usage: u, compactions: { kind: 'absent' }, turn, behind: { kind: 'measured', value: false } });
const ROW: BackstopRead = { ok: true, backstop: { hour: 4, zone: 'UTC', isDefault: true, setAt: 0 } };
const NONE: DesignationRead = { kind: 'not-designated', row: null };
const VIEW = (over: Partial<DesignationView> = {}): DesignationView => ({
  bound: { sessionId: 'lane-a-project-a', generation: 'g1' }, pending: null, term: 1, designatedTerm: 1, model: 'fable',
  accountPools: { pools: ['pool-a'], untagged: false }, pastIds: [], actor: 'device:console-a', lastAttempt: null, stopsOwed: [], ...over,
});
const BOUND = (over: Partial<DesignationView> = {}): DesignationRead => ({ kind: 'designated', sessionId: 'lane-a-project-a', term: VIEW(over).term, row: VIEW(over) });
const FALSE = { kind: 'measured', value: false } as const;
const TRUE = { kind: 'measured', value: true } as const;
/** `notLocal` for a generation whose start the default fake does not hold. */
const NO_START = { kind: 'unmeasured', why: 'start row absent' } as const;
const START_UUID = '22222222-3333-4444-5555-666666666666';
const startRead = (source: 'startup' | 'resume' | 'compact' | 'clear' = 'startup'): StartRead => ({ ok: true, row: {
  id: 7, sessionId: 'lane-a-project-a', reportId: 'r-7', uuid: START_UUID, source, model: 'claude-opus-5-5', rowIncarnation: null,
  reportedAt: NOW - 86_400_000, receivedAt: NOW - 86_400_000,
} });

function coordOf(over: Partial<{ spots: (cls: string) => SpotsRead; backstop: () => BackstopRead; designation: () => DesignationRead;
  raise: (latch: LatchRaiseInput) => ReturnType<ReadingsCoord['raiseLatch']>; start: (id: number) => StartRead }> = {}) {
  const calls: string[] = [];
  const raised: LatchRaiseInput[] = [];
  const coord: ReadingsCoord = {
    closedSpotProbes: (cls) => { calls.push(`spots:${cls}`); return (over.spots ?? (() => ({ ok: true, spots: [] })))(cls) as never; },
    backstopRead: () => { calls.push('backstop'); return (over.backstop ?? (() => ROW))(); },
    designationRead: () => { calls.push('designation'); return (over.designation ?? (() => NONE))(); },
    startById: (id) => { calls.push(`start:${id}`); return (over.start ?? (() => ({ ok: true, row: null })))(id); },
    raiseLatch: (_journal, latch) => { raised.push(latch); return (over.raise ?? (() => ({ ok: true, changed: true, journalled: true, recordSequence: 7, notice: 'none' as const })))(latch); },
  };
  return { coord, calls, raised };
}
const CFG = { home: '/fixture-home', roster: { byId: new Map([['lane-a', { configDirSuffix: '.claude-lane-a' }]]) } } as unknown as CcrcConfig;
const KEY: WakingHostKey = { digest: 'a'.repeat(64), keyEpoch: 3 };
type Asked = ResolveOpts;
type Resolve = (o: ResolveOpts) => Promise<TranscriptResolution>;
/** The session's own account's projects root under `CFG`, and the place the start's transcript has in project directory `dir`. */
const ROOT = '/fixture-home/.claude-lane-a/projects';
const placeIn = (dir: string): string => `${ROOT}/${dir}/${START_UUID}.jsonl`;
/** What the fleet io's measured reads see: the projects root lists `p`, `q` and every directory a file in `files` sits in; a
 *  stat is present for a file in `files`, unreadable for a path in `unreadable`, else a proven absence. `listing` makes the
 *  listing itself a failure. */
type Disk = { readonly files?: () => ReadonlySet<string>; readonly listing?: 'absent' | 'unreadable'; readonly unreadable?: ReadonlySet<string> };
/** A fleet io stand-in with only the two measured reads the measured search makes; `onRead` sees each path read. Any other
 *  member is missing, so a read the search should not make throws and fails the case. */
function diskIO(d: Disk, onRead: (p: string) => void): FleetIO {
  const files = (): ReadonlySet<string> => d.files?.() ?? new Set<string>();
  return {
    readdirMeasured: async (root: string) => {
      onRead(root);
      if (d.listing !== undefined) return { ok: false, reason: d.listing };
      const names = new Set(['p', 'q']);
      for (const f of files()) if (path.dirname(path.dirname(f)) === root) names.add(path.basename(path.dirname(f)));
      return { ok: true, entries: [...names].sort() };
    },
    statMeasured: async (p: string) => {
      onRead(p);
      if (d.unreadable?.has(p) === true) return { ok: false, reason: 'unreadable' };
      return files().has(p) ? { ok: true, mtimeMs: 1, size: 1 } : { ok: false, reason: 'absent' };
    },
  } as unknown as FleetIO;
}
/** The pass's deps. `answer` is the shared resolver's (a throw when it is an Error), each ask recorded in `asks`; `disk` is what
 *  the fleet io's measured reads see (`false`: no io wired), each path read recorded in `reads`. The carrier answers `keys` in
 *  turn (the last one repeated), or, with `moveIn`, KEY until that read has run and the next key epoch after it: a host that
 *  moves only during the shared ask, or only during the measured search. The clock reads NOW, or `afterProbe` once the measured
 *  search has read. `resolve` replaces the shared ask outright. */
const deps = (logs: string[] = [], o: { answer?: TranscriptResolution | Error; disk?: Disk | false;
  keys?: (WakingHostKey | 'unmeasured')[]; isolation?: false; moveIn?: 'transcript' | 'probe'; afterProbe?: number;
  asks?: Asked[]; reads?: string[]; resolve?: Resolve } = {}) => {
  const keys = o.keys ?? [KEY];
  let k = 0;
  let moved = false;
  let now = NOW;
  const carrier = (): WakingHostKey | 'unmeasured' => o.moveIn === undefined ? keys[Math.min(k++, keys.length - 1)]!
    : moved ? { ...KEY, keyEpoch: KEY.keyEpoch + 1 } : KEY;
  const transcript: Resolve = o.resolve ?? (async (a) => {
    o.asks?.push(a);
    if (o.moveIn === 'transcript') moved = true;
    const answer = o.answer ?? FOUND_HERE;
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const io = o.disk === false ? undefined : diskIO(o.disk ?? {}, (p) => {
    o.reads?.push(p);
    if (o.moveIn === 'probe') moved = true;
    if (o.afterProbe !== undefined) now = o.afterProbe;
  });
  return {
    time: { clock: { wall: () => now }, entropy: { hex: (n: number) => 'a'.repeat(2 * n) } }, log: (l: string) => logs.push(l), cfg: CFG,
    transcript, ...(io === undefined ? {} : { io }),
    ...(o.isolation === false ? {} : { isolation: { wakingHostKey: carrier } }),
  };
};
/** A resolver fake with the shared resolver's memory (`TranscriptResolver`'s fallback arm): a `fallback` is served again while
 *  its own path has no file, whatever was written elsewhere. `files` maps a uuid to the path its transcript has now. `served`
 *  counts the answers served from memory. */
function memoResolver(files: Map<string, string>) {
  const memo = new Map<string, TranscriptResolution>();
  const counts = { served: 0 };
  const walk: Resolve = async (o) => {
    const at = files.get(o.uuid);
    return at === undefined ? { kind: 'fallback', path: `${o.configDir}/projects/raw/${o.uuid}.jsonl`, complete: true }
      : { kind: 'found', path: at, rung: 'uuid-glob', account: null, uuid: o.uuid };
  };
  const resolve: Resolve = async (o) => {
    const key = `${o.configDir}|${o.uuid}|${o.dir}`;
    const held = memo.get(key);
    if (held !== undefined && held.kind === 'fallback' && files.get(o.uuid) !== held.path) { counts.served += 1; return held; }
    const a = await walk(o);
    memo.set(key, a);
    return a;
  };
  return { resolve, counts };
}
const FOUND_HERE: TranscriptResolution = { kind: 'found', path: '/fixture-home/.claude-lane-a/projects/p/x.jsonl', rung: 'registry-resolved', account: null, uuid: START_UUID };
const ABSENT_HERE: TranscriptResolution = { kind: 'fallback', path: '/fixture-home/.claude-lane-a/projects/p/x.jsonl', complete: true };
const SEARCH_CUT: TranscriptResolution = { kind: 'fallback', path: '/fixture-home/.claude-lane-a/projects/p/x.jsonl', complete: false };
const REC = (over: Partial<SessionRecord> = {}): SessionRecord =>
  ({ id: 'lane-a-project-a', wrapper: 'lane-a', workdir: '/fixture-projects/project-a', uuid: START_UUID, unmeasured: [], ...over }) as SessionRecord;

describe('renewalReadingsOf (PR A: the fitted ceiling and the backstop)', () => {
  it('an Overlord generation reads its fitted ceiling (the hard cap until fitted) and the backstop', async () => {
    const { coord } = coordOf();
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({}), base());
    expect(r.w1).toEqual({ fittedCeilingTokens: { kind: 'measured', value: 100_000 }, backstopDue: { kind: 'measured', value: true },
      termRaised: FALSE, classChanged: FALSE, notLocal: NO_START });
  });

  it('a coordinator generation gets none of the Overlord\'s fields, and only its start is read for it (PR B: notLocal)', async () => {
    const { coord, calls } = coordOf();
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({ role: 'coordinator' }), base());
    expect(r.w1).toEqual({ notLocal: NO_START });
    expect(calls).toEqual(['start:7']);
  });

  it('the spots are read once per model class per pass, and the backstop row once per pass', async () => {
    const { coord, calls } = coordOf();
    const pass = renewalReadingsOf(deps(), coord, []);
    await pass.w1(gen({ id: 1 }), base());
    await pass.w1(gen({ id: 2 }), base());
    await pass.w1(gen({ id: 3, model: 'claude-sonnet-5-5' }), base());
    expect(calls.filter((c) => c.startsWith('spots:'))).toEqual(['spots:opus', 'spots:sonnet']);
    expect(calls.filter((c) => c === 'backstop')).toEqual(['backstop']);
    const next = renewalReadingsOf(deps(), coord, []);
    await next.w1(gen({}), base());
    expect(calls.filter((c) => c === 'backstop')).toHaveLength(2);
  });

  it('the window comes from the base readings of the same sample: a stale sidecar reads unmeasured', async () => {
    const { coord } = coordOf();
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({}), base(usage(200_000, true)));
    expect(r.w1?.fittedCeilingTokens).toEqual({ kind: 'unmeasured', why: 'usage stale' });
  });

  it('a model that is unknown reads unmeasured, and the spots are not read', async () => {
    const { coord, calls } = coordOf();
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({ model: null }), base());
    expect(r.w1?.fittedCeilingTokens).toEqual({ kind: 'unmeasured', why: 'model unknown' });
    expect(calls.some((c) => c.startsWith('spots:'))).toBe(false);
  });

  it('the class\'s spots reach the ceiling: a bad first bucket reads `no depth holds`', async () => {
    const spots = Array.from({ length: FIT_WINDOW }, (_, i) =>
      ({ depthTokens: SPOT_PROBE_EVERY_TOKENS, grade: 'fail' as const, closed: true, modelClass: 'opus', at: i }));
    const { coord } = coordOf({ spots: () => ({ ok: true, spots }) });
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({}), base(usage(1_000_000)));
    expect(r.w1?.fittedCeilingTokens).toEqual({ kind: 'unmeasured', why: 'no depth holds' });
  });

  it('a spot read that throws makes the ceiling unmeasured `fitted ceiling read failed`, leaves the backstop as its port answers, logs once, and the pass completes for every generation (F17)', async () => {
    const logs: string[] = [];
    const { coord } = coordOf({ spots: () => { throw new Error('disk'); } });
    const pass = renewalReadingsOf(deps(logs), coord, []);
    const one = await pass.w1(gen({ id: 1 }), base());
    const two = await pass.w1(gen({ id: 2 }), base());
    for (const r of [one, two]) {
      expect(r.w1).toEqual({ fittedCeilingTokens: { kind: 'unmeasured', why: 'fitted ceiling read failed' }, backstopDue: { kind: 'measured', value: true },
        termRaised: FALSE, classChanged: FALSE, notLocal: NO_START });
    }
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('disk');
  });

  it('a backstop read that throws makes only `backstopDue` unmeasured; an unread row reads unmeasured with its detail', async () => {
    const thrown = coordOf({ backstop: () => { throw new Error('locked'); } });
    const r = await renewalReadingsOf(deps(), thrown.coord, []).w1(gen({}), base());
    expect(r.w1).toEqual({ fittedCeilingTokens: { kind: 'measured', value: 100_000 }, backstopDue: { kind: 'unmeasured', why: 'backstop read failed' },
      termRaised: FALSE, classChanged: FALSE, notLocal: NO_START });
    const unread = coordOf({ backstop: () => ({ ok: false, detail: 'renewal_backstop_settings has no row' }) });
    const u = await renewalReadingsOf(deps(), unread.coord, []).w1(gen({}), base());
    expect(u.w1?.backstopDue).toEqual({ kind: 'unmeasured', why: 'backstop unread: renewal_backstop_settings has no row' });
  });

  it('the backstop reads the generation\'s own start: one started after today\'s 04:00 UTC is not due', async () => {
    const { coord } = coordOf();
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({ startReportedAt: Date.UTC(2026, 5, 10, 5) }), base());
    expect(r.w1?.backstopDue).toEqual({ kind: 'measured', value: false });
  });
});

describe('renewalReadingsOf (PR C: the designation\'s readings)', () => {
  it('the designation is read once per pass, for Overlord generations only', async () => {
    const { coord, calls } = coordOf({ designation: () => BOUND() });
    const pass = renewalReadingsOf(deps(), coord, []);
    await pass.w1(gen({ id: 1, term: 1, designatedClass: 'fable' }), base());
    await pass.w1(gen({ id: 2, term: 1, designatedClass: 'fable' }), base());
    await pass.w1(gen({ id: 3, role: 'coordinator' }), base());
    expect(calls.filter((c) => c === 'designation')).toEqual(['designation']);
  });

  it('a restore that raised the term makes termRaised due; a class changed after the mint makes classChanged due', async () => {
    const { coord } = coordOf({ designation: () => BOUND({ term: 2, model: 'opus' }) });
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({ term: 1, designatedClass: 'fable' }), base());
    expect(r.w1?.termRaised).toEqual({ kind: 'measured', value: true });
    expect(r.w1?.classChanged).toEqual({ kind: 'measured', value: true });
  });

  it('a generation minted before the class was recorded reads classChanged unmeasured, and termRaised still reads', async () => {
    const { coord } = coordOf({ designation: () => BOUND() });
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({ term: 1, designatedClass: null }), base());
    expect(r.w1?.classChanged).toEqual({ kind: 'unmeasured', why: 'minted before the class was recorded' });
    expect(r.w1?.termRaised).toEqual(FALSE);
  });

  it('an unmeasured designation reads both unmeasured; a throwing read reads both `designation read failed`, logged once per reading, the rest unaffected', async () => {
    const unread = coordOf({ designation: () => ({ kind: 'unmeasured', why: 'a term is not a count' }) });
    const u = await renewalReadingsOf(deps(), unread.coord, []).w1(gen({ term: 1, designatedClass: 'fable' }), base());
    expect([u.w1?.termRaised, u.w1?.classChanged]).toEqual([{ kind: 'unmeasured', why: 'designation unreadable' }, { kind: 'unmeasured', why: 'designation unreadable' }]);
    const logs: string[] = [];
    const thrown = coordOf({ designation: () => { throw new Error('locked'); } });
    const t = await renewalReadingsOf(deps(logs), thrown.coord, []).w1(gen({ term: 1, designatedClass: 'fable' }), base());
    expect(t.w1).toEqual({ fittedCeilingTokens: { kind: 'measured', value: 100_000 }, backstopDue: { kind: 'measured', value: true },
      termRaised: { kind: 'unmeasured', why: 'designation read failed' }, classChanged: { kind: 'unmeasured', why: 'designation read failed' },
      notLocal: NO_START });
    expect(logs.filter((l) => l.includes('locked'))).toHaveLength(2);
  });
});

describe('renewalReadingsOf (PR C: the latch raise)', () => {
  it('binds the ladder\'s one raise: the cap is the cause row\'s (chat), raised by the renewal lane, at the pass clock', async () => {
    const { coord, raised } = coordOf();
    const r = renewalReadingsOf(deps(), coord, []).latch('probes-failed-twice', 'generation 4 degraded');
    expect(r).toEqual({ ok: true });
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ cause: 'probes-failed-twice', cap: 'chat', detail: 'generation 4 degraded', at: NOW,
      raisedBy: { kind: 'lane', lane: 'renewal-lane' } });
    expect(raised[0]!.opKey).toMatch(/^latch-raise-a+$/);
  });

  it('a refused raise answers ok false with the refusal word, for the lane to log', () => {
    const journal = coordOf({ raise: () => ({ ok: false, error: 'journal-unreadable' }) as never });
    expect(renewalReadingsOf(deps(), journal.coord, []).latch('probes-failed-twice', 'd')).toEqual({ ok: false, why: 'journal-unreadable' });
    const actor = coordOf({ raise: () => ({ ok: false, reason: 'actor' }) as never });
    expect(renewalReadingsOf(deps(), actor.coord, []).latch('probes-failed-twice', 'd')).toEqual({ ok: false, why: 'actor' });
  });
});

describe('renewalReadingsOf (PR B: notLocal)', () => {
  const turned: TurnMarkRead = { ok: true, sessionId: 'lane-a-project-a', state: 'done', event: 'Stop', at: NOW - 60_000, turnAt: null,
    stopAt: NOW - 60_000, bg: 0, bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], crons: null, graceUntil: null };
  const quiet: TurnMarkRead = { ...turned, stopAt: NOW - 2 * 86_400_000, at: NOW - 2 * 86_400_000 };

  it('asks the resolver with the start\'s uuid, the registry workdir and the session\'s own account\'s config dir, and no foreign key', async () => {
    const asks: Asked[] = [];
    const { coord } = coordOf({ start: () => startRead() });
    await renewalReadingsOf(deps([], { asks }), coord, [REC()]).w1(gen({}), base());
    expect(asks).toEqual([{ configDir: '/fixture-home/.claude-lane-a', dir: '/fixture-projects/project-a',
      registryWorkdir: '/fixture-projects/project-a', uuid: START_UUID }]);
    expect('foreign' in asks[0]!).toBe(false);
  });

  it('a coordinator\'s generation reads notLocal, and nothing else changes in its inputs', async () => {
    const { coord } = coordOf({ start: () => startRead('resume') });
    const r = await renewalReadingsOf(deps([], { answer: ABSENT_HERE }), coord, [REC()]).w1(gen({ role: 'coordinator' }), base());
    expect(r.w1).toEqual({ notLocal: TRUE });
  });

  it('a found transcript reads local, at another project directory of the same account and after a continued-in marker too', async () => {
    const { coord } = coordOf({ start: () => startRead('resume') });
    for (const answer of [FOUND_HERE, { ...FOUND_HERE, rung: 'uuid-glob' as const },
      { ...FOUND_HERE, uuid: '44444444-5555-6666-7777-888888888888', followedFrom: [START_UUID] }]) {
      const r = await renewalReadingsOf(deps([], { answer }), coord, [REC()]).w1(gen({}), base(undefined, turned));
      expect(r.w1?.notLocal).toEqual(FALSE);
    }
  });

  it('a resumed start with no file is not local before any turn; a fresh one is local before a turn and not local after one', async () => {
    const resumed = coordOf({ start: () => startRead('resume') });
    const fresh = coordOf({ start: () => startRead('startup') });
    const d = () => deps([], { answer: ABSENT_HERE });
    expect((await renewalReadingsOf(d(), resumed.coord, [REC()]).w1(gen({}), base(undefined, quiet))).w1?.notLocal).toEqual(TRUE);
    expect((await renewalReadingsOf(d(), fresh.coord, [REC()]).w1(gen({}), base(undefined, quiet))).w1?.notLocal).toEqual(FALSE);
    expect((await renewalReadingsOf(d(), fresh.coord, [REC()]).w1(gen({}), base(undefined, turned))).w1?.notLocal).toEqual(TRUE);
  });

  it('a search that could not look everywhere reads unmeasured after a turn (the case a guessed path would have read as not local), and takes no measured search (3742 F1)', async () => {
    const { coord } = coordOf({ start: () => startRead('startup') });
    const reads: string[] = [];
    const r = await renewalReadingsOf(deps([], { answer: SEARCH_CUT, reads }), coord, [REC()]).w1(gen({}), base(undefined, turned));
    expect(r.w1?.notLocal).toEqual({ kind: 'unmeasured', why: 'transcript search incomplete' });
    expect(reads).toEqual([]);
  });

  it('no registry row, an unmeasured identity or an account with no config dir is never asked, and reads unmeasured with its reason', async () => {
    const { coord } = coordOf({ start: () => startRead('resume') });
    for (const [records, lane, why] of [[[], 'lane-a', 'no registry row'], [[REC({ unmeasured: ['uuid'] } as never)], 'lane-a', 'identity unmeasured'],
      [[REC({ wrapper: 'lane-z' })], 'lane-z', 'no config dir']] as const) {
      const asks: Asked[] = [];
      const r = await renewalReadingsOf(deps([], { asks, answer: ABSENT_HERE }), coord, records as readonly SessionRecord[]).w1(gen({ lane }), base());
      expect(r.w1?.notLocal, why).toEqual({ kind: 'unmeasured', why });
      expect(asks, why).toEqual([]);
    }
  });

  it('a registry row whose conversation or account has moved from the generation\'s is never asked, and reads unmeasured (F2)', async () => {
    const { coord } = coordOf({ start: () => startRead('resume') });
    for (const [rec, lane, why] of [
      [REC({ uuid: '99999999-3333-4444-5555-666666666666' }), 'lane-a', "registry conversation differs from the start's"],
      [REC({ wrapper: 'lane-b' }), 'lane-a', "registry account differs from the generation's"],
      [REC(), null, 'generation account unknown'],
    ] as const) {
      const asks: Asked[] = [];
      const reads: string[] = [];
      const r = await renewalReadingsOf(deps([], { asks, reads, answer: ABSENT_HERE }), coord, [rec]).w1(gen({ lane }), base(undefined, turned));
      expect(r.w1?.notLocal, why).toEqual({ kind: 'unmeasured', why });
      expect([asks, reads], why).toEqual([[], []]);
    }
  });

  it('an absence the shared resolver serves from its memory is checked by the measured search over the fleet io, the only arm wired in production, which finds the file at another spelling (3696 F1, 3718 F1)', async () => {
    const files = new Map<string, string>();
    const r = memoResolver(files);
    const disk: Disk = { files: () => new Set(files.values()) };
    const { coord } = coordOf({ start: () => startRead('startup') });
    const first = await renewalReadingsOf(deps([], { resolve: r.resolve, disk }), coord, [REC()]).w1(gen({}), base(undefined, quiet));
    expect(first.w1?.notLocal).toEqual(FALSE);
    files.set(START_UUID, placeIn('resolved-spelling'));
    const second = await renewalReadingsOf(deps([], { resolve: r.resolve, disk }), coord, [REC()]).w1(gen({}), base(undefined, turned));
    expect(r.counts.served).toBe(1);
    expect(second.w1?.notLocal).toEqual(FALSE);
    files.clear();
    const gone = await renewalReadingsOf(deps([], { resolve: r.resolve, disk }), coord, [REC()]).w1(gen({}), base(undefined, turned));
    expect(gone.w1?.notLocal).toEqual(TRUE);
  });

  it('over the real fleet io on a fixture HOME, a remembered absence beside the file on disk reads local, and the file gone reads not local (3718 F1)', async () => {
    const home = mkTmp('rr-b-notlocal-');
    const file = path.join(home, '.claude-lane-a', 'projects', '-elsewhere-project-a', `${START_UUID}.jsonl`);
    mkdirSync(path.dirname(file), { recursive: true });
    mkdirSync(path.join(home, '.claude-lane-a', 'projects', '-fixture-projects-project-a'));
    writeFileSync(file, '{}\n');
    const { coord } = coordOf({ start: () => startRead('resume') });
    const d = () => ({ ...deps([], { answer: ABSENT_HERE, disk: false }), cfg: { ...CFG, home } as CcrcConfig, io: localIO });
    expect((await renewalReadingsOf(d(), coord, [REC()]).w1(gen({}), base())).w1?.notLocal).toEqual(FALSE);
    rmSync(file);
    expect((await renewalReadingsOf(d(), coord, [REC()]).w1(gen({}), base())).w1?.notLocal).toEqual(TRUE);
  });

  it('with no fleet io wired, an absence from the shared resolver is never believed (3696 F1)', async () => {
    const { coord } = coordOf({ start: () => startRead('resume') });
    const r = await renewalReadingsOf(deps([], { answer: ABSENT_HERE, disk: false }), coord, [REC()]).w1(gen({}), base(undefined, turned));
    expect(r.w1?.notLocal).toEqual({ kind: 'unmeasured', why: 'absence not measured' });
  });

  it('a found answer from the shared resolver takes no measured search; an absence takes one: the account\'s projects root, then every place it names', async () => {
    const { coord } = coordOf({ start: () => startRead('resume') });
    const reads: string[] = [];
    await renewalReadingsOf(deps([], { reads }), coord, [REC()]).w1(gen({}), base());
    expect(reads).toEqual([]);
    await renewalReadingsOf(deps([], { reads, answer: ABSENT_HERE }), coord, [REC()]).w1(gen({}), base());
    expect(reads).toEqual([ROOT, placeIn('p'), placeIn('q')]);
  });

  it('the measured search holds its stats to the resolver\'s bound: forty directories, never more than GLOB_STAT_CONCURRENCY in flight (3742 F3)', async () => {
    const { coord } = coordOf({ start: () => startRead('resume') });
    const names = Array.from({ length: 40 }, (_, i) => `d${String(i).padStart(2, '0')}`);
    let inFlight = 0;
    let most = 0;
    let stats = 0;
    const io = {
      readdirMeasured: async () => ({ ok: true, entries: names }),
      statMeasured: async () => {
        inFlight += 1; stats += 1; most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return { ok: false, reason: 'absent' };
      },
    } as unknown as FleetIO;
    const r = await renewalReadingsOf({ ...deps([], { answer: ABSENT_HERE, disk: false }), io }, coord, [REC()]).w1(gen({}), base());
    expect(r.w1?.notLocal).toEqual(TRUE);
    expect([stats, most]).toEqual([40, GLOB_STAT_CONCURRENCY]);
  });

  it('an unreadable read in the measured search makes the absence unmeasured: the projects listing, or one place with the rest absent (3718 F3)', async () => {
    const { coord } = coordOf({ start: () => startRead('resume') });
    for (const [disk, why] of [[{ listing: 'unreadable' }, 'projects listing unreadable'],
      [{ unreadable: new Set([placeIn('q')]) }, 'a transcript place unreadable']] as const) {
      const r = await renewalReadingsOf(deps([], { answer: ABSENT_HERE, disk }), coord, [REC()]).w1(gen({}), base(undefined, turned));
      expect(r.w1?.notLocal, why).toEqual({ kind: 'unmeasured', why });
    }
  });

  it('an absence is believed when every read of it was a proven absence: no projects root at all, or every place absent (3718 F3)', async () => {
    const { coord } = coordOf({ start: () => startRead('resume') });
    for (const disk of [{ listing: 'absent' }, {}] as const) {
      const r = await renewalReadingsOf(deps([], { answer: ABSENT_HERE, disk }), coord, [REC()]).w1(gen({}), base(undefined, turned));
      expect(r.w1?.notLocal, JSON.stringify(disk)).toEqual(TRUE);
    }
  });

  it('a first turn still running reads unmeasured: the transcript\'s first append may not have landed (F1, the race)', async () => {
    const { coord } = coordOf({ start: () => startRead('startup') });
    const working: TurnMarkRead = { ...quiet, state: 'working', stopAt: null, at: NOW - 1_000 };
    const r = await renewalReadingsOf(deps([], { answer: ABSENT_HERE }), coord, [REC()]).w1(gen({}), base(undefined, working));
    expect(r.w1?.notLocal).toEqual({ kind: 'unmeasured', why: 'first turn still running' });
  });

  it('the absence is dated after the measured search: a marker event between the ask and the search\'s end does not make it older (F1)', async () => {
    const { coord } = coordOf({ start: () => startRead('startup') });
    const lateStop: TurnMarkRead = { ...turned, at: NOW + 500 };
    const r = await renewalReadingsOf(deps([], { answer: ABSENT_HERE, afterProbe: NOW + 1_000 }), coord, [REC()]).w1(gen({}), base(undefined, lateStop));
    expect(r.w1?.notLocal).toEqual(TRUE);
    const stale = await renewalReadingsOf(deps([], { answer: ABSENT_HERE }), coord, [REC()]).w1(gen({}), base(undefined, lateStop));
    expect(stale.w1?.notLocal).toEqual({ kind: 'unmeasured', why: 'absence older than the turn marker' });
  });

  it('the second carrier read comes after the reads: a host that moves only during the shared ask, or only during the measured search, reads unmeasured (F3)', async () => {
    const { coord } = coordOf({ start: () => startRead('resume') });
    for (const moveIn of ['transcript', 'probe'] as const) {
      const r = await renewalReadingsOf(deps([], { answer: ABSENT_HERE, moveIn }), coord, [REC()]).w1(gen({}), base());
      expect(r.w1?.notLocal, moveIn).toEqual({ kind: 'unmeasured', why: 'host changed during the read' });
    }
    const still = await renewalReadingsOf(deps([], { answer: FOUND_HERE, moveIn: 'probe' }), coord, [REC()]).w1(gen({}), base());
    expect(still.w1?.notLocal).toEqual(FALSE);
  });

  it('a start that cannot be read, or has no row, is never asked about', async () => {
    for (const [start, why] of [[{ ok: false, detail: 'locked' }, 'start unread: locked'], [{ ok: true, row: null }, 'start row absent']] as const) {
      const asks: Asked[] = [];
      const { coord } = coordOf({ start: () => start as StartRead });
      const r = await renewalReadingsOf(deps([], { asks }), coord, [REC()]).w1(gen({}), base());
      expect(r.w1?.notLocal).toEqual({ kind: 'unmeasured', why });
      expect(asks).toEqual([]);
    }
  });

  it('the carrier is read before and after the ask: a host that changed between them reads unmeasured; no reader reads host unmeasured', async () => {
    const { coord } = coordOf({ start: () => startRead('resume') });
    const moved = await renewalReadingsOf(deps([], { answer: ABSENT_HERE, keys: [KEY, { ...KEY, keyEpoch: 4 }] }), coord, [REC()]).w1(gen({}), base());
    expect(moved.w1?.notLocal).toEqual({ kind: 'unmeasured', why: 'host changed during the read' });
    const unread = await renewalReadingsOf(deps([], { answer: ABSENT_HERE, keys: ['unmeasured'] }), coord, [REC()]).w1(gen({}), base());
    expect(unread.w1?.notLocal).toEqual({ kind: 'unmeasured', why: 'host unmeasured' });
    const none = await renewalReadingsOf(deps([], { answer: ABSENT_HERE, isolation: false }), coord, [REC()]).w1(gen({}), base());
    expect(none.w1?.notLocal).toEqual({ kind: 'unmeasured', why: 'host unmeasured' });
  });

  it('a resolver that throws reads `not-local read failed`, logged once per pass, and the other fields read as their ports answer (F17)', async () => {
    const logs: string[] = [];
    const { coord } = coordOf({ start: () => startRead('resume') });
    const pass = renewalReadingsOf(deps(logs, { answer: new Error('link reset') }), coord, [REC(), REC({ id: 'lane-a-project-b' })]);
    const one = await pass.w1(gen({}), base());
    const two = await pass.w1(gen({ id: 2, sessionId: 'lane-a-project-b' }), base());
    for (const r of [one, two]) {
      expect(r.w1).toEqual({ fittedCeilingTokens: { kind: 'measured', value: 100_000 }, backstopDue: TRUE, termRaised: FALSE, classChanged: FALSE,
        notLocal: { kind: 'unmeasured', why: 'not-local read failed' } });
    }
    expect(logs.filter((l) => l.includes('link reset'))).toHaveLength(1);
  });

  it('a pass with no transcript port, or no roster, answers no notLocal, which keeps the lane\'s W1, and reads no start', async () => {
    for (const drop of ['transcript', 'cfg'] as const) {
      const { coord, calls } = coordOf({ start: () => startRead('resume') });
      const { [drop]: _gone, ...d } = deps([], { answer: ABSENT_HERE });
      const r = await renewalReadingsOf(d, coord, [REC()]).w1(gen({ role: 'coordinator' }), base());
      expect(r.w1, drop).toEqual({});
      expect(calls, drop).toEqual([]);
    }
  });

  it('the wiring file names no ccd argv in its imports or its code, and never passes `foreign` to the resolver (the source pin, F4)', () => {
    const file = parsedFile('server/src/continuity/renewalReadingsWiring.ts');
    expect(file.imports.map((e) => e.specifier).filter((x) => /ccdargv/i.test(x))).toEqual([]);
    expect(file.imports.flatMap((e) => e.names).filter((x) => /ccd_?argv/i.test(x))).toEqual([]);
    const code = codeOnly(file.text);
    expect(code).toContain('const o: ResolveOpts = { configDir, dir: who.workdir, registryWorkdir: who.workdir, uuid: ask.uuid };');
    expect(code).not.toMatch(/ccdargv|CCD_ARGV|CcdArgv/);
    expect(code).not.toMatch(/\bforeign\b/);
  });
});

describe('the watcher binds the latch (PR C) and the transcript resolver (PR B)', () => {
  it('sweepGenerations hands the pass the wiring\'s latch, and the wiring the watcher\'s one memoized resolver', () => {
    const sweep = codeOnly(sourceOfSymbol('server/src/watch.ts', 'FleetWatcher.sweepGenerations'));
    expect(sweep).toContain('const w1 = renewalReadingsOf({ ...this.deps, transcript: (o) => this.transcripts.resolve(o) }, coord, records)');
    expect(sweep).toMatch(/generationsPass\(\{[^}]*latch: w1\.latch \}/);
  });
});
