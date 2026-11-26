// Overlord W1, the renewal readings' wiring (plan `w1-renewal-readings.md`, PRs A, B and C): `renewalReadingsOf` reads each
// wired producer once per pass, answers the Overlord's fields, and catches each producer on its own (review 2183 F17); PR C adds
// the designation's two readings and binds the pass's latch raise to the ladder's one raise path; PR B adds `notLocal`, for
// every generation the gather reads, from the watcher's transcript resolver, bracketed by the isolation word's carrier. PR D adds
// the account readings, the Overlord's only: one pool answer per Overlord session per pass, the account facts and the candidates
// once per pass.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
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
import { renewalReadingsOf, type AccountReads, type ReadingsCoord } from '../src/continuity/renewalReadingsWiring.js';
import { parsePoolAnswer, type PoolAnswerRead } from '../src/poolrule.js';
import type { AccountLimits } from '../src/limits.js';
import type { CcdArgv } from '../src/ccdargv.js';
import type { CcdResult } from '../src/coord/ports.js';
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

// ------------------------------------------------------------------------------------------------- PR D: the account readings

const NOW_S = Math.floor(NOW / 1000);
const lim = (pct: number): AccountLimits => ({ five: pct, seven: pct, ts: NOW_S - 60, fiveResetAt: NOW_S + 9_000, sevenResetAt: NOW_S + 300_000,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false });
/** Three Anthropic accounts: `lane-a` (the generation's) in `pool-b`, `lane-b` and `lane-c` in `pool-a`, the designation's set. */
const ACCOUNTS = [['lane-a', 'pool-b'], ['lane-b', 'pool-a'], ['lane-c', 'pool-a']].map(([id, pool]) => ({
  id, pool, homeAble: true, exec: { kind: 'upstream' }, telemetry: 'anthropic', fableBilling: 'included', continuity: { kind: 'recorded' },
}));
const ACFG = { ...CFG, registryDir: '/fixture-home/.cc-sessions', roster: { byId: new Map(ACCOUNTS.map((a) => [a.id, { configDirSuffix: `.claude-${a.id}` }])), accounts: ACCOUNTS } } as unknown as CcrcConfig;
const OPUS = BOUND({ model: 'opus' });
const answerLine = (verdict: string, crossing = 'none'): string =>
  `pool-answer side=set:pool-a verdict=${verdict} pool-side=account pool-state=named:pool-b crossing=${crossing} account=lane-a\n`;
/** The account reads, each call recorded; `limits` throws when it is an Error. */
function acctReads(calls: string[], o: { answer?: string; limits?: Record<string, AccountLimits> | Error } = {}): AccountReads {
  return {
    poolAnswer: async (id) => { calls.push(`pool-answer:${id}`); return parsePoolAnswer({ ran: true, code: 0, stdout: o.answer ?? answerLine('mismatch') }); },
    limits: async (nowS) => {
      calls.push(`limits:${nowS}`);
      if (o.limits instanceof Error) throw o.limits;
      return o.limits ?? { 'lane-a': lim(90), 'lane-b': lim(40), 'lane-c': lim(40) };
    },
    shares: async () => { calls.push('shares'); return { kind: 'absent' }; },
  };
}
/** The store with its central edges (none: the declared tags decide), each read recorded in `calls`. */
const withEdges = (c: ReturnType<typeof coordOf>): ReadingsCoord =>
  ({ ...c.coord, accountPoolEdges: () => { c.calls.push('edges'); return new Map(); } });
const acctDeps = (calls: string[], logs: string[] = [], o: Parameters<typeof acctReads>[1] = {}) =>
  ({ ...deps(logs), cfg: ACFG, accountReads: acctReads(calls, o) });
const pick = (w1: object | undefined) => {
  const r = (w1 ?? {}) as Record<string, unknown>;
  return { accountOutsideSet: r['accountOutsideSet'], classUnservable: r['classUnservable'], accountLoadMove: r['accountLoadMove'] };
};

describe('renewalReadingsOf (PR D: the account readings)', () => {
  afterEach(removeTmpFixtures);

  it('outside the set with a serving candidate is due (F1: pool set B1\'s line, `pool-side=account`); the class serves here; the account is not a candidate', async () => {
    const c = coordOf({ designation: () => OPUS });
    const r = await renewalReadingsOf(acctDeps([]), withEdges(c), []).w1(gen({}), base());
    expect(pick(r.w1)).toEqual({ accountOutsideSet: TRUE, classUnservable: FALSE,
      accountLoadMove: { kind: 'unmeasured', why: 'account not a candidate' } });
  });

  it('the same line with `verdict=serve` is not due', async () => {
    const c = coordOf({ designation: () => OPUS });
    const r = await renewalReadingsOf(acctDeps([], [], { answer: answerLine('serve') }), withEdges(c), []).w1(gen({}), base());
    expect(r.w1?.accountOutsideSet).toEqual(FALSE);
  });

  it('the load move reads the candidates and the turn marker: a candidate at the hard line, idle, with another under the soft line, is due; busy, it is not', async () => {
    const c = coordOf({ designation: () => OPUS });
    const pass = renewalReadingsOf(acctDeps([], [], { limits: { 'lane-a': lim(40), 'lane-b': lim(90), 'lane-c': lim(40) } }), withEdges(c), []);
    const mark = (state: 'working' | 'done'): TurnMarkRead => ({ ok: true, sessionId: 'lane-b-project-a', state, event: 'Stop', at: 1, turnAt: null,
      stopAt: null, bg: 0, bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], crons: null, graceUntil: null });
    const on = gen({ sessionId: 'lane-a-project-a', lane: 'lane-b' });
    expect((await pass.w1(on, base(usage(200_000), mark('done')))).w1?.accountLoadMove).toEqual(TRUE);
    expect((await pass.w1(on, base(usage(200_000), mark('working')))).w1?.accountLoadMove).toEqual(FALSE);
    expect((await pass.w1(on, base(usage(200_000), { ok: false, reason: 'absent' }))).w1?.accountLoadMove)
      .toEqual({ kind: 'unmeasured', why: 'turn marker absent' });
  });

  it('the pool answer is asked once per pass and only for the Overlord; the limits, the shares and the edges are read once per pass', async () => {
    const calls: string[] = [];
    const c = coordOf({ designation: () => OPUS });
    const pass = renewalReadingsOf(acctDeps(calls), withEdges(c), []);
    await pass.w1(gen({ id: 1 }), base());
    await pass.w1(gen({ id: 2 }), base());
    const coordinator = await pass.w1(gen({ id: 3, role: 'coordinator', sessionId: 'lane-b-project-b' }), base());
    expect(calls).toEqual([`limits:${NOW_S}`, 'shares', 'pool-answer:lane-a-project-a']);
    expect(c.calls.filter((x) => x === 'edges' || x === 'designation')).toEqual(['designation', 'edges']);
    expect(pick(coordinator.w1)).toEqual({ accountOutsideSet: undefined, classUnservable: undefined, accountLoadMove: undefined });
  });

  it('the designation first (fix round 1, I): no designation or a rebind reads measured false, unreadable reads unmeasured, and none of the three reads anything else', async () => {
    const run = async (d: DesignationRead) => {
      const calls: string[] = [];
      const c = coordOf({ designation: () => d });
      const r = await renewalReadingsOf(acctDeps(calls), withEdges(c), []).w1(gen({}), base());
      return { got: pick(r.w1), reads: [...calls, ...c.calls.filter((x) => x === 'edges')] };
    };
    const F3 = { accountOutsideSet: FALSE, classUnservable: FALSE, accountLoadMove: FALSE };
    expect(await run(NONE)).toEqual({ got: F3, reads: [] });
    expect(await run({ kind: 'not-designated', row: VIEW({ bound: null }) })).toEqual({ got: F3, reads: [] });
    expect(await run({ ...OPUS, sessionId: 'lane-b-project-b' } as DesignationRead)).toEqual({ got: F3, reads: [] });
    const U = { kind: 'unmeasured', why: 'designation unreadable' };
    expect(await run({ kind: 'unmeasured', why: 'locked' })).toEqual({ got: { accountOutsideSet: U, classUnservable: U, accountLoadMove: U }, reads: [] });
  });

  it('a facts read that throws reads each of the three `<reading> read failed`, logged once per reading, and the other fields read as their ports answer (F17)', async () => {
    const logs: string[] = [];
    const c = coordOf({ designation: () => OPUS });
    const pass = renewalReadingsOf(acctDeps([], logs, { limits: new Error('disk') }), withEdges(c), []);
    for (const id of [1, 2]) {
      const r = await pass.w1(gen({ id }), base());
      expect(pick(r.w1)).toEqual({ accountOutsideSet: { kind: 'unmeasured', why: 'account set read failed' },
        classUnservable: { kind: 'unmeasured', why: 'class serviceability read failed' }, accountLoadMove: { kind: 'unmeasured', why: 'account load read failed' } });
      expect(r.w1?.termRaised).toEqual(FALSE);
    }
    expect(logs).toHaveLength(3);
    for (const l of logs) expect(l).toContain('disk');
  });

  it('with no store edges, or with no runner, no io or no config to build the reads from, the three keep the lane\'s W1 and nothing is read', async () => {
    const W1 = { accountOutsideSet: undefined, classUnservable: undefined, accountLoadMove: undefined };
    const calls: string[] = [];
    const c = coordOf({ designation: () => OPUS });
    const noEdges = await renewalReadingsOf(acctDeps(calls), c.coord, []).w1(gen({}), base());
    expect(pick(noEdges.w1), 'no edges').toEqual(W1);
    expect(calls).toEqual([]);
    const ran: string[][] = [];
    const runCcd = async (argv: CcdArgv): Promise<CcdResult> => { ran.push([...argv]); throw new Error('no runner expected'); };
    const full = { ...deps(), cfg: ACFG, runCcd, fleetState: { ccdVerbs: ['pool-set'] } };
    const { runCcd: _r, ...noRunner } = full;
    const { io: _i, ...noIo } = full;
    const { cfg: _c, ...noCfg } = full;
    for (const [arm, d] of [['no runner', noRunner], ['no io', noIo], ['no config', noCfg]] as const) {
      const r = await renewalReadingsOf(d, withEdges(c), []).w1(gen({}), base());
      expect(pick(r.w1), arm).toEqual(W1);
    }
    expect(ran).toEqual([]);
    expect(c.calls).not.toContain('edges');
  });

  // Fix round 1 (review 3797 F): the composition hands the wiring the coordination store itself, whose edges read is a method that
  // needs its object (`this.db`). A stand-in arrow function survives being taken off its object; the real store does not. The central
  // edge moves `lane-a` into the set, so the load reading sees it as a candidate only if the store's own edges were read.
  it('over a real coordination store on a fixture database, the central edges are read and the three measure from them', async () => {
    const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-rr-acct-'), '.ccrc', 'coord.db')));
    s.db.exec(`INSERT INTO overlord_designation (id, sessionId, generation, term, designatedTerm, model, accountPools, actor, updatedAt)
      VALUES (1, 'lane-a-project-a', 'generation-a', 1, 1, 'opus', '{"pools":["pool-a"],"untagged":false}', 'actor', 1)`);
    s.db.exec("INSERT INTO pool_edges (subjectKind, subjectId, pool, addedAt, addedBy) VALUES ('account', 'lane-a', 'pool-a', 1, NULL)");
    expect(s.designationRead()).toMatchObject({ kind: 'designated', sessionId: 'lane-a-project-a' });
    const logs: string[] = [];
    const coord: ReadingsCoord = s;
    const r = await renewalReadingsOf(acctDeps([], logs, { answer: answerLine('serve') }), coord, []).w1(gen({}), base());
    expect(pick(r.w1)).toEqual({ accountOutsideSet: FALSE, classUnservable: FALSE,
      accountLoadMove: { kind: 'unmeasured', why: 'turn marker absent' } });
    expect(logs.filter((l) => /account|class serviceability/.test(l))).toEqual([]);
  });

  it('wired from the watcher\'s runner, the pool answer is the body\'s composer: `pool-answer --session <id>` behind the pool-set word, never run without it', async () => {
    for (const verbs of [['pool-set'], []]) {
      const argvs: string[][] = [];
      const runCcd = async (argv: CcdArgv): Promise<CcdResult> => {
        argvs.push([...argv]);
        return { ran: true, ok: true, exitCode: 0, stdout: answerLine('serve'), stderr: '', killed: false, signal: null } as unknown as CcdResult;
      };
      const io = { readFileMeasured: async () => ({ ok: false, reason: 'absent' }), readdirMeasured: async () => ({ ok: false, reason: 'absent' }),
        readdir: async () => null, readFile: async () => null, statMeasured: async () => ({ ok: false, reason: 'absent' }), stat: async () => null } as unknown as FleetIO;
      const c = coordOf({ designation: () => OPUS });
      await renewalReadingsOf({ ...deps(), cfg: ACFG, io, runCcd, fleetState: { ccdVerbs: verbs } }, withEdges(c), []).w1(gen({}), base());
      expect(argvs.filter((a) => a[0] === 'pool-answer'), verbs.join()).toEqual(verbs.length === 0 ? [] : [['pool-answer', '--session', 'lane-a-project-a']]);
    }
  });

  it('the account readings\' only ccd read is the body adapter\'s pool-answer composer (the source pin, Review Focus 4)', () => {
    const file = parsedFile('server/src/continuity/renewalReadingsWiring.ts');
    const body = file.imports.filter((e) => /overlordBody/.test(e.specifier)).flatMap((e) => e.names).sort();
    expect(body).toEqual(['bodyRunner', 'ccdPoolAnswer']);
  });
});

// ------------------------------------------------------------------------------------- PR H: the launch profile's hold and digest

describe('renewalReadingsOf (PR H: the holds into the account readings, and the Overlord\'s installBehind)', () => {
  afterEach(removeTmpFixtures);
  const SERVE = answerLine('serve');
  /** The store with its edges and the standing holds `holds` answers, each read recorded. */
  const withHolds = (c: ReturnType<typeof coordOf>, holds: () => ReturnType<NonNullable<ReadingsCoord['accountHolds']>>): ReadingsCoord =>
    ({ ...withEdges(c), accountHolds: () => { c.calls.push('holds'); return holds(); } });

  it('a held account is outside the set: on a serve verdict, with another account serving, the hard row is due (F7)', async () => {
    const c = coordOf({ designation: () => OPUS });
    const r = await renewalReadingsOf(acctDeps([], [], { answer: SERVE }), withHolds(c, () => ({ ok: true, lanes: ['lane-a'] })), []).w1(gen({}), base());
    expect(r.w1?.accountOutsideSet).toEqual(TRUE);
  });

  it('a clear puts the account back: the same serve verdict with no hold standing is not due', async () => {
    const c = coordOf({ designation: () => OPUS });
    const r = await renewalReadingsOf(acctDeps([], [], { answer: SERVE }), withHolds(c, () => ({ ok: true, lanes: [] })), []).w1(gen({}), base());
    expect(r.w1?.accountOutsideSet).toEqual(FALSE);
  });

  it('holds that cannot be read leave the reading unmeasured on a serve verdict, never "no holds"', async () => {
    const c = coordOf({ designation: () => OPUS });
    const r = await renewalReadingsOf(acctDeps([], [], { answer: SERVE }), withHolds(c, () => ({ ok: false, detail: 'locked' })), []).w1(gen({}), base());
    expect(r.w1?.accountOutsideSet).toEqual({ kind: 'unmeasured', why: 'holds unread: locked' });
  });

  it('a store with no holds read keeps the reading as PR D left it (not wired)', async () => {
    const c = coordOf({ designation: () => OPUS });
    const r = await renewalReadingsOf(acctDeps([], [], { answer: SERVE }), withEdges(c), []).w1(gen({}), base());
    expect(r.w1?.accountOutsideSet).toEqual(FALSE);
  });

  it('the holds are read once a pass, and not at all for a coordinator or when the designation answers alone', async () => {
    const c = coordOf({ designation: () => OPUS });
    const pass = renewalReadingsOf(acctDeps([], [], { answer: SERVE }), withHolds(c, () => ({ ok: true, lanes: [] })), []);
    await pass.w1(gen({ id: 1 }), base());
    await pass.w1(gen({ id: 2 }), base());
    await pass.w1(gen({ id: 3, role: 'coordinator' }), base());
    expect(c.calls.filter((x) => x === 'holds')).toHaveLength(1);
    const none = coordOf({ designation: () => NONE });
    await renewalReadingsOf(acctDeps([], [], { answer: SERVE }), withHolds(none, () => ({ ok: true, lanes: [] })), []).w1(gen({}), base());
    expect(none.calls.filter((x) => x === 'holds')).toEqual([]);
  });

  it('a held account is left out of the candidates the other account readings read', async () => {
    // lane-b and lane-c are the set's; lane-b held, the generation on lane-b: not a candidate any more
    const c = coordOf({ designation: () => OPUS });
    const r = await renewalReadingsOf(acctDeps([], [], { answer: SERVE }), withHolds(c, () => ({ ok: true, lanes: ['lane-b'] })), [])
      .w1(gen({ lane: 'lane-b' }), base());
    expect(r.w1?.accountLoadMove).toEqual({ kind: 'unmeasured', why: 'account not a candidate' });
  });

  /** One node row of role `both` whose stamp reads: a single box agrees with itself. */
  const BOTH = { role: 'both', stampRead: 'ok', currentSha: 's', currentRef: 'main', currentBuiltAt: 'b', currentDirty: false, currentVersion: null };
  const SERVER = { ...BOTH, role: 'server' };
  const FLEET = (sha: string) => ({ ...BOTH, role: 'fleet', currentSha: sha });
  const loads = (profileDigest: string | null) => ({ ok: true as const, newest: { start: {} as never, carry: { kind: 'none' } as const,
    report: { profileDigest } as never } });
  const withInstall = (c: ReturnType<typeof coordOf>, digest: string | null, nodes: () => unknown[]): ReadingsCoord =>
    ({ ...c.coord, startLoadsOfNewestStart: () => loads(digest) as never, nodes: nodes as never });

  it('the Overlord\'s installBehind: a digest that differs while the builds agree is a new install; an equal one is behind as the roll says', async () => {
    const { launchDigestOf } = await import('../src/continuity/launchProfile.js');
    const d = launchDigestOf('overlord');
    const ask = async (digest: string | null, nodes: () => unknown[], behind: GenReadings['behind'] = FALSE) => (await renewalReadingsOf(deps(), withInstall(coordOf(), digest, nodes), [])
      .w1(gen({}), { ...base(), behind })).w1?.installBehind;
    expect(await ask('0'.repeat(64), () => [BOTH])).toEqual(TRUE);
    expect(await ask(d, () => [BOTH])).toEqual(FALSE);
    expect(await ask(d, () => [BOTH], TRUE)).toEqual(TRUE);
    expect(await ask('0'.repeat(64), () => [SERVER, FLEET('s')])).toEqual(TRUE);
    expect(await ask(null, () => [BOTH])).toEqual({ kind: 'unmeasured', why: 'no digest reported' });
  });

  it('build skew reads the install-behind reading unmeasured, never behind: builds that differ, are unknown or cannot be read', async () => {
    const ask = async (nodes: () => unknown[]) => (await renewalReadingsOf(deps(), withInstall(coordOf(), '0'.repeat(64), nodes), [])
      .w1(gen({}), { ...base(), behind: TRUE })).w1?.installBehind;
    const SKEW = { kind: 'unmeasured', why: 'build skew' };
    expect(await ask(() => [SERVER, FLEET('t')])).toEqual(SKEW);
    expect(await ask(() => [])).toEqual(SKEW);
    expect(await ask(() => { throw new Error('locked'); })).toEqual(SKEW);
  });

  it('a coordinator\'s installBehind is untouched, and a store without the two reads leaves the Overlord\'s to the gather', async () => {
    const coordinator = await renewalReadingsOf(deps(), withInstall(coordOf(), '0'.repeat(64), () => [BOTH]), []).w1(gen({ role: 'coordinator' }), base());
    expect(coordinator.w1?.installBehind).toBeUndefined();
    const bare = await renewalReadingsOf(deps(), coordOf().coord, []).w1(gen({}), base());
    expect(bare.w1?.installBehind).toBeUndefined();
  });
});

describe('the watcher binds the latch (PR C) and the transcript resolver (PR B)', () => {
  it('sweepGenerations hands the pass the wiring\'s latch, and the wiring the watcher\'s one memoized resolver', () => {
    const sweep = codeOnly(sourceOfSymbol('server/src/watch.ts', 'FleetWatcher.sweepGenerations'));
    expect(sweep).toContain('const w1 = renewalReadingsOf({ ...this.deps, transcript: (o) => this.transcripts.resolve(o) }, coord, records)');
    expect(sweep).toMatch(/generationsPass\(\{[^}]*latch: w1\.latch,\s*holdsSettled: this\.generationsHoldsSettled \}/);
  });
});
