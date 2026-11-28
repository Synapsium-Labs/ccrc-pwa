// The code shortlist's cases (Overlord W2 request record plan, Tasks B1 and B2). Written ONCE here, as suite cases over the
// module: `request-shortlist.test.ts` runs them against the real module, and `sim/requestSets.ts` runs them against each textual
// mutant (the every-run floors of D-8217). The expectations are spelled out here, never derived from the module's own lists.
//
// The properties of plan §7 (monotone, fail-open, capped, no goals, deterministic) run over a seeded generator
// (`mulberry32`): the tree carries no property-testing library, so each property draws a fixed number of inputs from a fixed
// seed, and a failure names its seed and draw.
import { expect } from 'vitest';
import type { ExpectedPath } from '../../shared/overlordRequests.js';
import type { HistoryReadOutcome } from '../src/coord/overlordHistory.js';
import type { SuiteCase } from './sim/mutate.js';
import { mulberry32 } from './fakeTime.js';

export type ShortlistModule = typeof import('../src/coord/requestShortlist.js');
type M = ShortlistModule;
type Input = Parameters<M['codeShortlist']>[0];
type Claim = { programme: string; project: string; paths: string[]; renewedAt: number };
type Hit = { programme: string; project: string; file: string; latestMs: number | null };

const T = 1_800_000_000_000;
const P = 'project-a';
const Q = 'project-b';
const ep = (path: string, project = P): ExpectedPath => ({ project, path });
const claim = (programme: string, paths: string[], renewedAt = T, project = P): Claim => ({ programme, project, paths, renewedAt });
const hit = (programme: string, file: string, latestMs: number | null = T, project = P): Hit => ({ programme, project, file, latestMs });
const live = (...slugs: string[]) => ({ kind: 'measured' as const, live: new Set(slugs) });
const claims = (...cs: Claim[]) => ({ kind: 'measured' as const, claims: cs });
const touched = (...hs: Hit[]) => ({ kind: 'measured' as const, hits: hs });
const NOT_ASKED = { kind: 'not-asked' as const };
const input = (over: Partial<Input>): Input =>
  ({ expected: [], claims: claims(), touched: NOT_ASKED, live: live(), ...over });
const names = (m: M, i: Input): string[] => m.codeShortlist(i).candidates.map((c) => c.programme);

// ------------------------------------------------------------------------------------------------------ Table 7, row by row

export function codeShortlistCases(m: M): Record<string, SuiteCase> {
  return {
    'step 1: a programme that is not live is never a candidate': () => {
      const i = input({ expected: [ep('a/x.ts')], claims: claims(claim('alpha', ['a/x.ts']), claim('beta', ['a/x.ts'])),
        live: live('alpha') });
      expect(names(m, i)).toEqual(['alpha']);
    },
    'step 1: an unreadable programmes read leaves no candidate, and says so': () => {
      const s = m.codeShortlist(input({ expected: [ep('a/x.ts')], claims: claims(claim('alpha', ['a/x.ts'])),
        live: { kind: 'unmeasured', why: 'programmes-unreadable' } }));
      expect([s.candidates, s.live]).toEqual([[], 'unmeasured']);
    },
    'step 2: with no expected path every programme with a live claim is one, claimHits its distinct claimed paths': () => {
      const s = m.codeShortlist(input({ claims: claims(claim('alpha', ['a/x.ts', 'a/y.ts', 'a/z.ts']), claim('alpha', ['a/x.ts']),
        claim('beta', ['b/z.ts'])), live: live('alpha', 'beta') }));
      expect(s.basis).toBe('claims-only');
      expect(s.candidates.map((c) => [c.programme, c.claimHits, c.touchedHits])).toEqual([['alpha', 3, 0], ['beta', 1, 0]]);
    },
    'step 2: with no expected path a touched hit alone makes no candidate': () => {
      const s = m.codeShortlist(input({ touched: touched(hit('alpha', 'a/x.ts')), live: live('alpha') }));
      expect(s.candidates).toEqual([]);
    },
    'step 3: a claimed directory covers an expected file under it, and an expected directory a claimed file under it': () => {
      const s = m.codeShortlist(input({ expected: [ep('a/sub/x.ts'), ep('b')],
        claims: claims(claim('alpha', ['a/sub']), claim('beta', ['b/y.ts'])), live: live('alpha', 'beta') }));
      expect(s.candidates.map((c) => [c.programme, c.claimHits])).toEqual([['alpha', 1], ['beta', 1]]);
    },
    'step 3: a claim in another project does not meet the path, and a prefix that is not a directory does not either': () => {
      const s = m.codeShortlist(input({ expected: [ep('shared/x.ts')],
        claims: claims(claim('alpha', ['shared/x.ts'], T, Q), claim('beta', ['shared-utils'])), live: live('alpha', 'beta') }));
      expect(s.candidates).toEqual([]);
    },
    'step 3: claimHits counts expected paths, not claims': () => {
      const s = m.codeShortlist(input({ expected: [ep('a/x.ts'), ep('a/y.ts')],
        claims: claims(claim('alpha', ['a']), claim('alpha', ['a/x.ts'])), live: live('alpha') }));
      expect(s.candidates[0]!.claimHits).toBe(2);
    },
    'step 4: a touched hit counts the expected file it names, in the same project': () => {
      const s = m.codeShortlist(input({ expected: [ep('a/x.ts'), ep('a/y.ts')],
        touched: touched(hit('alpha', 'a/x.ts'), hit('alpha', 'a/x.ts', T - 5), hit('beta', 'a/y.ts', T, Q)),
        live: live('alpha', 'beta') }));
      expect(s.candidates.map((c) => [c.programme, c.touchedHits])).toEqual([['alpha', 1]]);
    },
    'step 4, the directory rule: an expected directory meets claims and never touched': () => {
      const s = m.codeShortlist(input({ expected: [ep('a')], claims: claims(claim('beta', ['a/y.ts'])),
        touched: touched(hit('alpha', 'a/x.ts'), hit('alpha', 'a')), live: live('alpha', 'beta') }));
      // A hit is only ever on a file the read was asked; one naming the directory itself still counts, one under it does not.
      expect(s.candidates.map((c) => [c.programme, c.claimHits, c.touchedHits])).toEqual([['beta', 1, 0], ['alpha', 0, 1]]);
      const t = m.codeShortlist(input({ expected: [ep('a')], touched: touched(hit('alpha', 'a/x.ts')), live: live('alpha') }));
      expect(t.candidates).toEqual([]);
    },
    'step 4: an unmeasured read adds no touched hit, and says why': () => {
      const s = m.codeShortlist(input({ expected: [ep('a/x.ts')], claims: claims(claim('alpha', ['a/x.ts'])),
        touched: { kind: 'unmeasured', why: 'not-served' }, live: live('alpha') }));
      expect(s.candidates.map((c) => [c.programme, c.claimHits, c.touchedHits])).toEqual([['alpha', 1, 0]]);
      expect([s.touched, s.touchedWhy]).toEqual(['unmeasured', ['not-served']]);
    },
    'step 4: a partial read counts its hits and carries its whys': () => {
      const s = m.codeShortlist(input({ expected: [ep('a/x.ts')],
        touched: { kind: 'partial', hits: [hit('alpha', 'a/x.ts')], why: ['budget', 'item-refused'] }, live: live('alpha') }));
      expect(s.candidates.map((c) => [c.programme, c.touchedHits])).toEqual([['alpha', 1]]);
      expect([s.touched, s.touchedWhy]).toEqual(['partial', ['budget', 'item-refused']]);
    },
    'step 5: a programme with no hit of either kind is not a candidate': () => {
      const s = m.codeShortlist(input({ expected: [ep('a/x.ts')], claims: claims(claim('alpha', ['b/y.ts'])),
        touched: touched(hit('beta', 'c/z.ts')), live: live('alpha', 'beta') }));
      expect(s.candidates).toEqual([]);
    },
    'step 6: a claim outranks history': () => {
      const s = m.codeShortlist(input({ expected: [ep('a/x.ts'), ep('a/y.ts'), ep('a/z.ts')],
        claims: claims(claim('beta', ['a/x.ts'], T - 1000)),
        touched: touched(hit('alpha', 'a/x.ts', T), hit('alpha', 'a/y.ts', T), hit('alpha', 'a/z.ts', T)), live: live('alpha', 'beta') }));
      expect(s.candidates.map((c) => c.programme)).toEqual(['beta', 'alpha']);
    },
    'step 6: equal claim hits rank by touched hits, then the newest claim or touch, then slug': () => {
      const s = m.codeShortlist(input({ expected: [ep('a/x.ts'), ep('a/y.ts')],
        claims: claims(claim('delta', ['a/x.ts'], T - 50), claim('gamma', ['a/x.ts'], T - 50), claim('beta', ['a/x.ts'], T - 10),
          claim('alpha', ['a/x.ts'], T - 90)),
        touched: touched(hit('alpha', 'a/y.ts', T - 80)), live: live('alpha', 'beta', 'gamma', 'delta') }));
      expect(s.candidates.map((c) => c.programme)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
      expect(s.candidates.map((c) => c.newest)).toEqual([T - 80, T - 10, T - 50, T - 50]);
    },
    'step 6: an unknown time ranks after every known one': () => {
      const s = m.codeShortlist(input({ expected: [ep('a/x.ts')],
        touched: touched(hit('alpha', 'a/x.ts', null), hit('beta', 'a/x.ts', 0)), live: live('alpha', 'beta') }));
      expect(s.candidates.map((c) => [c.programme, c.newest])).toEqual([['beta', 0], ['alpha', null]]);
    },
    'step 6: cut at six': () => {
      const slugs = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
      const s = m.codeShortlist(input({ expected: [ep('a/x.ts')], claims: claims(...slugs.map((p, k) => claim(p, ['a/x.ts'], T - k))),
        live: live(...slugs) }));
      expect(s.candidates.map((c) => c.programme)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    },
    'a repeated expected path counts once': () => {
      const s = m.codeShortlist(input({ expected: [ep('a/x.ts'), ep('a/x.ts')], claims: claims(claim('alpha', ['a/x.ts'])),
        touched: touched(hit('alpha', 'a/x.ts')), live: live('alpha') }));
      expect(s.candidates.map((c) => [c.claimHits, c.touchedHits])).toEqual([[1, 1]]);
    },
    'an unreadable claims read leaves touched standing, and says so': () => {
      const s = m.codeShortlist(input({ expected: [ep('a/x.ts')], claims: { kind: 'unmeasured', why: 'claims-unreadable' },
        touched: touched(hit('alpha', 'a/x.ts')), live: live('alpha') }));
      expect([s.candidates.map((c) => c.programme), s.claims, s.basis]).toEqual([['alpha'], 'unmeasured', 'paths']);
    },
    'the answer names each read': () => {
      const s = m.codeShortlist(input({ expected: [ep('a/x.ts')], touched: touched() }));
      expect([s.live, s.claims, s.touched, s.touchedWhy, s.basis]).toEqual(['measured', 'measured', 'measured', [], 'paths']);
      expect(m.codeShortlist(input({})).touched).toBe('not-asked');
    },
    ...propertyCases(m),
  };
}

// --------------------------------------------------------------------------------------------------------- the properties

const DRAWS = 200;
const SLUGS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota'];
const FILES = ['a', 'a/x.ts', 'a/y.ts', 'b/z.ts', 'b', 'c/d/e.ts'];

function draw(seed: number): Input {
  const r = mulberry32(seed);
  const pick = <X>(xs: readonly X[]): X => xs[Math.floor(r() * xs.length)]!;
  const n = (max: number): number => Math.floor(r() * (max + 1));
  const project = (): string => (r() < 0.8 ? P : Q);
  const expected = Array.from({ length: n(4) }, () => ep(pick(FILES), project()));
  const cs = Array.from({ length: n(10) }, () => claim(pick(SLUGS), Array.from({ length: 1 + n(2) }, () => pick(FILES)), T - n(1000), project()));
  const hs = Array.from({ length: n(10) }, () => hit(pick(SLUGS), pick(FILES), r() < 0.1 ? null : T - n(1000), project()));
  const liveSet = SLUGS.filter(() => r() < 0.8);
  return { expected, claims: claims(...cs), touched: touched(...hs), live: live(...liveSet) };
}

const rankOf = (m: M, i: Input, p: string): number => {
  const k = names(m, i).indexOf(p);
  return k === -1 ? Number.POSITIVE_INFINITY : k;
};

function propertyCases(m: M): Record<string, SuiteCase> {
  const each = (check: (i: Input, seed: number) => void) => () => { for (let s = 1; s <= DRAWS; s += 1) check(draw(s), s); };
  return {
    'property, monotone: adding a live claim to a programme never lowers its rank': each((i, seed) => {
      const r = mulberry32(seed * 7919);
      const p = SLUGS[Math.floor(r() * SLUGS.length)]!;
      const extra = claim(p, [FILES[Math.floor(r() * FILES.length)]!], T - Math.floor(r() * 1000));
      const more: Input = { ...i, claims: claims(...(i.claims.kind === 'measured' ? i.claims.claims as Claim[] : []), extra) };
      expect(rankOf(m, more, p), `seed ${seed}`).toBeLessThanOrEqual(rankOf(m, i, p));
    }),
    'property, fail-open: an unmeasured touched read removes no programme that had a claim hit': each((i, seed) => {
      const before = m.codeShortlist(i).candidates.filter((c) => c.claimHits > 0);
      const after = m.codeShortlist({ ...i, touched: { kind: 'unmeasured', why: 'busy' } }).candidates;
      // Every claim-hit programme stays, unless the cut at six now holds six with at least its claim hits (its touched hits,
      // which broke a tie in its favour, are gone).
      for (const p of before) {
        if (after.some((c) => c.programme === p.programme)) continue;
        expect(after.length === 6 && after.every((c) => c.claimHits >= p.claimHits), `seed ${seed} ${p.programme}`).toBe(true);
      }
    }),
    'property, capped: never more than six candidates': each((i, seed) => {
      const wide: Input = { ...i, expected: FILES.map((f) => ep(f)), live: live(...SLUGS) };
      expect(m.codeShortlist(wide).candidates.length, `seed ${seed}`).toBeLessThanOrEqual(6);
      expect(m.codeShortlist(i).candidates.length, `seed ${seed}`).toBeLessThanOrEqual(6);
    }),
    'property, deterministic: the same input in another order gives the same answer': each((i, seed) => {
      const rev: Input = {
        ...i,
        claims: claims(...[...(i.claims.kind === 'measured' ? i.claims.claims as Claim[] : [])].reverse()),
        touched: touched(...[...(i.touched.kind === 'measured' ? i.touched.hits as Hit[] : [])].reverse()),
        live: live(...[...(i.live.kind === 'measured' ? i.live.live : [])].reverse()),
      };
      expect(m.codeShortlist(rev), `seed ${seed}`).toEqual(m.codeShortlist(i));
    }),
    'property, no goals: the decider reads no field it is not given': each((i, seed) => {
      // A goals field planted on the input changes nothing, and the answer names no goals text.
      const planted = { ...i, goals: 'MARKER-GOALS' } as unknown as Input;
      const a = m.codeShortlist(planted);
      expect(a, `seed ${seed}`).toEqual(m.codeShortlist(i));
      expect(JSON.stringify(a)).not.toContain('MARKER-GOALS');
    }),
  };
}

// ------------------------------------------------------------------------------------------- the request and the answer

const req = (m: M, ...paths: string[]) => m.touchedRequestOf(paths.map((p) => ep(p)))!;
const rows = (items: unknown[], shown = items.length, total = items.length): HistoryReadOutcome => ({
  kind: 'answer',
  answer: { outcome: 'rows', exit: 0, items: items as never, shown, total,
    scope: { kind: 'overlord', id: 'all', project: null, families: [], families_total: 0, transcripts: 1 } },
});
const item = (asked: number, file: string, sessions: unknown[], whole = true) =>
  ({ asked, file, whole, sessions, trust: 'untrusted' });
const s = (ccrcId: string, latestMs: number | null = T) => ({ ccrcId, latestMs });

export function touchedRequestCases(m: M): Record<string, SuiteCase> {
  return {
    'no expected path asks nothing': () => { expect(m.touchedRequestOf([])).toBe(null); },
    'the first eight in order, each path once, as one touched request over every project': () => {
      const t = m.touchedRequestOf(['a/1', 'a/2', 'a/2', 'a/3', 'a/4', 'a/5', 'a/6', 'a/7'].map((p, k) => ep(p, k === 2 ? Q : P)))!;
      expect(t.request).toEqual({ verb: 'touched', target: { kind: 'all' }, agents: false, args: ['a/1', 'a/2', 'a/3', 'a/4', 'a/5', 'a/6', 'a/7'] });
      expect(t.partial).toEqual([]);
    },
    'a ninth path is not read: more-than-eight': () => {
      const t = m.touchedRequestOf(['a/1', 'a/2', 'a/3', 'a/4', 'a/5', 'a/6', 'a/7', 'a/8', 'a/9'].map((p) => ep(p)))!;
      expect([t.paths, t.partial]).toEqual([['a/1', 'a/2', 'a/3', 'a/4', 'a/5', 'a/6', 'a/7', 'a/8'], ['more-than-eight']]);
    },
    'a path off the grammar is not asked: path-refused; only such paths ask nothing': () => {
      const t = m.touchedRequestOf([ep('../x'), ep('a/x.ts'), ep('/abs'), ep('a b'), ep('a/*.ts'), ep('-a'), ep('a:b')])!;
      expect([t.paths, t.partial]).toEqual([['a/x.ts'], ['path-refused']]);
      expect(m.touchedRequestOf([ep('../x')])).toBe(null);
    },
    'the path grammar: normalised, relative, bounded, the CLI path characters': () => {
      for (const ok of ['a', 'a/b.ts', 'a_b/c-d.test.ts', '.github/x.yml', 'x'.repeat(512)]) expect(m.touchedPathOk(ok), ok).toBe(true);
      for (const no of ['', '.', './a', 'a/', 'a//b', 'a/../b', '/a', '-a', 'a b', 'a*', 'a?', 'a[', 'a:b', 'a\\b', 'a\nb', 'é',
        'x'.repeat(513), 3, null]) expect(m.touchedPathOk(no), String(no)).toBe(false);
    },
  };
}

export function touchedAnswerCases(m: M): Record<string, SuiteCase> {
  const asked = (): ReturnType<M['touchedRequestOf']> & object => req(m, 'a/x.ts', 'a/y.ts');
  const no = (o: HistoryReadOutcome, linkDown = false) => m.touchedAnswerOf(o, asked(), linkDown);
  const ans = (a: object): HistoryReadOutcome => ({ kind: 'answer', answer: a as never });
  return {
    'each condition that is not a reading has its own word, and none is an empty reading': () => {
      expect(no({ kind: 'no-agent' })).toEqual({ kind: 'unmeasured', why: 'not-served' });
      expect(no({ kind: 'no-agent' }, true)).toEqual({ kind: 'unmeasured', why: 'link-down' });
      expect(no({ kind: 'many-agents' })).toEqual({ kind: 'unmeasured', why: 'many-agents' });
      expect(no({ kind: 'unsupported' })).toEqual({ kind: 'unmeasured', why: 'not-served' });
      expect(no({ kind: 'not-started' })).toEqual({ kind: 'unmeasured', why: 'link-down' });
      expect(no({ kind: 'lost' })).toEqual({ kind: 'unmeasured', why: 'link-down' });
      expect(no({ kind: 'timeout' })).toEqual({ kind: 'unmeasured', why: 'deadline' });
      expect(no(ans({ outcome: 'busy' }))).toEqual({ kind: 'unmeasured', why: 'busy' });
      expect(no(ans({ outcome: 'deadline' }))).toEqual({ kind: 'unmeasured', why: 'deadline' });
      expect(no(ans({ outcome: 'store-refused', word: 'store-missing' }))).toEqual({ kind: 'unmeasured', why: 'history-unreadable' });
      expect(no(ans({ outcome: 'verb-refused', word: 'not-indexed' }))).toEqual({ kind: 'unmeasured', why: 'history-unreadable' });
      expect(no(ans({ outcome: 'too-large', bytes: 70_000 }))).toEqual({ kind: 'unmeasured', why: 'history-unreadable' });
      expect(no(ans({ outcome: 'failed', word: 'internal' }))).toEqual({ kind: 'unmeasured', why: 'history-unreadable' });
      expect(no(ans({ outcome: 'request-refused', word: 'bad-args' }))).toEqual({ kind: 'unmeasured', why: 'refused' });
    },
    "an older agent's refusal of the verb reads as not served": () => {
      expect(no(ans({ outcome: 'request-refused', word: 'bad-verb' }))).toEqual({ kind: 'unmeasured', why: 'not-served' });
    },
    'a whole answer: each session on its asked path, no partial word': () => {
      const a = no(rows([item(0, 'a/x.ts', [s('lane-a-project-a'), s('lane-b-project-a', null)]), item(1, 'a/y.ts', [])]));
      expect(a).toEqual({ kind: 'rows', partial: [], rows: [
        { path: 'a/x.ts', ccrcId: 'lane-a-project-a', latestMs: T }, { path: 'a/x.ts', ccrcId: 'lane-b-project-a', latestMs: null }] });
    },
    'an item that is not whole is shown-below-total; fewer items than paths, or shown below total, is budget': () => {
      expect(no(rows([item(0, 'a/x.ts', [s('lane-a')], false), item(1, 'a/y.ts', [])]))).toMatchObject({ partial: ['shown-below-total'] });
      expect(no(rows([item(0, 'a/x.ts', [s('lane-a')])], 1, 2))).toMatchObject({ kind: 'rows', partial: ['budget'], rows: [{ ccrcId: 'lane-a' }] });
      expect(no(rows([item(0, 'a/x.ts', []), item(1, 'a/y.ts', [])], 1, 2))).toMatchObject({ partial: ['budget'] });
      // Fewer items than paths is budget even when the answer's own counts agree with each other.
      expect(no(rows([item(0, 'a/x.ts', [])], 1, 1))).toMatchObject({ partial: ['budget'] });
    },
    "the request's own words ride the answer, in their order": () => {
      const t = m.touchedRequestOf([ep('../x'), ...['a/1', 'a/2', 'a/3', 'a/4', 'a/5', 'a/6', 'a/7', 'a/8'].map((p) => ep(p))])!;
      const items = t.paths.map((p, k) => item(k, p, [], k !== 0));
      expect(m.touchedAnswerOf(rows(items), t, false)).toMatchObject({ partial: ['more-than-eight', 'path-refused', 'shown-below-total'] });
    },
    'paths are data from another box: an item that names another path, leaves its project, or is off its shape is refused': () => {
      const marker = 'MARKER-PATH';
      const bad: unknown[][] = [
        [item(0, `../${marker}`, [s('lane-a')]), item(1, 'a/y.ts', [s('lane-b')])],
        [item(0, 'a/y.ts', [s('lane-a')]), item(1, 'a/y.ts', [s('lane-b')])],
        [item(1, 'a/x.ts', [s('lane-a')]), item(1, 'a/y.ts', [s('lane-b')])],
        [{ ...item(0, 'a/x.ts', [s('lane-a')]), whole: 'yes' }, item(1, 'a/y.ts', [s('lane-b')])],
        [item(0, 'a/x.ts', [s(`../${marker}`)]), item(1, 'a/y.ts', [s('lane-b')])],
        [item(0, 'a/x.ts', [s('lane-a', -1)]), item(1, 'a/y.ts', [s('lane-b')])],
        [item(0, 'a/x.ts', Array.from({ length: 33 }, (_x, k) => s(`lane-${k}`))), item(1, 'a/y.ts', [s('lane-b')])],
        [item(0, '/a/x.ts', [s('lane-a')]), item(1, 'a/y.ts', [s('lane-b')])],
      ];
      for (const items of bad) {
        const a = no(rows(items));
        expect(a, JSON.stringify(items).slice(0, 120)).toEqual({ kind: 'rows', partial: ['item-refused'],
          rows: [{ path: 'a/y.ts', ccrcId: 'lane-b', latestMs: T }] });
        expect(JSON.stringify(a)).not.toContain(marker);
      }
      const extra = no(rows([item(0, 'a/x.ts', []), item(1, 'a/y.ts', []), item(2, 'a/z.ts', [s('lane-c')])]));
      expect(extra).toEqual({ kind: 'rows', partial: ['item-refused'], rows: [] });
    },
    'thirty-two sessions on an item are taken': () => {
      const many = Array.from({ length: 32 }, (_x, k) => s(`lane-${k}`));
      expect(no(rows([item(0, 'a/x.ts', many), item(1, 'a/y.ts', [])]))).toMatchObject({ partial: [] });
    },
  };
}

export function touchedReadCases(m: M): Record<string, SuiteCase> {
  const answer = { kind: 'rows' as const, partial: [] as const, rows: [
    { path: 'a/x.ts', ccrcId: 'lane-a', latestMs: T }, { path: 'a/y.ts', ccrcId: 'lane-b', latestMs: null },
    { path: 'a/y.ts', ccrcId: 'lane-gone', latestMs: T } ] };
  const runs = new Map([
    ['lane-a', [{ programme: 'alpha', project: P }, { programme: 'beta', project: Q }]],
    ['lane-b', [{ programme: 'gamma', project: P }]],
  ]);
  return {
    'a session in runs of two programmes counts toward both; a session in none is dropped': () => {
      expect(m.touchedReadOf(answer, { kind: 'measured', runs })).toEqual({ kind: 'measured', hits: [
        { programme: 'alpha', project: P, file: 'a/x.ts', latestMs: T }, { programme: 'beta', project: Q, file: 'a/x.ts', latestMs: T },
        { programme: 'gamma', project: P, file: 'a/y.ts', latestMs: null }] });
    },
    'a partial answer stays partial with its whys; an unmeasured one stays unmeasured': () => {
      expect(m.touchedReadOf({ ...answer, partial: ['budget'] }, { kind: 'measured', runs })).toMatchObject({ kind: 'partial', why: ['budget'] });
      expect(m.touchedReadOf({ kind: 'unmeasured', why: 'busy' }, { kind: 'measured', runs })).toEqual({ kind: 'unmeasured', why: 'busy' });
    },
    'an unreadable runs read is unmeasured, never an empty reading': () => {
      expect(m.touchedReadOf(answer, { kind: 'unmeasured' })).toEqual({ kind: 'unmeasured', why: 'runs-unreadable' });
    },
  };
}

/** Every case of the module, for the test file. */
export function shortlistCases(m: M): Record<string, SuiteCase> {
  return { ...codeShortlistCases(m), ...touchedRequestCases(m), ...touchedAnswerCases(m), ...touchedReadCases(m) };
}
