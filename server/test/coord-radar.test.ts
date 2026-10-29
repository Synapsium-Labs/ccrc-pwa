// Landing order wave 4b, Task 1: the radar's `probe` parser and the per-session derivation (`coord/radar.ts`). The
// fixtures are wave 3b's worked example and its failed-fetch shapes, neutral names throughout; no file is read.
import { describe, expect, it } from 'vitest';
import { RADAR_PROBE_FRESH_S } from '../../shared/api.js';
import {
  RADAR_PATH_MAX, RADAR_PROBE_MAX_BYTES, parseProbe, sessionLandingsOf,
  type ProbeDoc, type ProbeRead, type RadarRow,
} from '../src/coord/radar.js';

const NOW = Date.parse('2026-10-27T09:00:00Z');
const iso = (offsetS: number): string => new Date(NOW + offsetS * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const sha = (n: number): string => n.toString(16).padStart(40, '0');

/** Wave 3b's worked example: three open heads, 12 and 14 bound and paired (a conflict on src/x.ts), 13 unbound. */
const worked = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1, project: 'proj-a', at: iso(0), state: 'measured',
  base: { ref: 'main', sha: sha(9) },
  heads: [
    { pr: 12, head: sha(12), branch: 'ws/alpha', id: 'lane-a-proj-a-alpha', base: { state: 'clean' } },
    { pr: 13, head: sha(13), branch: 'feature/x', id: null, base: { state: 'conflict', paths: ['README.md'], pathsCut: false } },
    { pr: 14, head: sha(14), branch: 'ws/beta', id: 'lane-a-proj-a-beta', base: { state: 'unmeasured', why: 'budget' } },
  ],
  headsCut: false,
  pairs: [{ a: 12, b: 14, state: 'conflict', paths: ['src/x.ts'], pathsCut: false }],
  pairHeads: [14, 12], pairsCut: false,
  store: { before: { count: 0, size: 0, inPack: 0, packs: 0 }, after: { count: 0, size: 0, inPack: 0, packs: 0 } },
  scratch: { sizeKiB: 0 }, elapsedMs: 1234,
  ...over,
});
const read = (o: unknown, nowMs = NOW, project = 'proj-a'): ProbeRead => parseProbe(JSON.stringify(o), project, nowMs);
const unreadable = (r: ProbeRead): void => { expect(r).toEqual({ ok: false, reason: 'unreadable' }); };
const okDoc = (o: unknown, nowMs = NOW): ProbeDoc => {
  const r = read(o, nowMs);
  if (!r.ok) throw new Error(`expected a readable doc, got ${r.reason}`);
  return r.doc;
};
/** The failed-fetch shape (wave 3b `write_failed`): no base, no heads, no pairs. */
const FETCH_FAILED = { state: 'unmeasured', why: 'fetch-failed', base: null, heads: [], pairs: [], pairHeads: [] };

describe('parseProbe: the files', () => {
  it("wave 3b's worked example reads, and carries the doc without store, scratch or elapsedMs", () => {
    const r = read(worked());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc).toEqual({
      project: 'proj-a', at: iso(0), baseRef: 'main',
      heads: [
        { pr: 12, head: sha(12), branch: 'ws/alpha', id: 'lane-a-proj-a-alpha', base: { state: 'clean' } },
        { pr: 13, head: sha(13), branch: 'feature/x', id: null, base: { state: 'conflict', paths: ['README.md'], pathsCut: false } },
        { pr: 14, head: sha(14), branch: 'ws/beta', id: 'lane-a-proj-a-beta', base: { state: 'unmeasured' } },
      ],
      headsCut: false,
      pairs: [{ a: 12, b: 14, answer: { state: 'conflict', paths: ['src/x.ts'], pathsCut: false } }],
      pairHeads: [14, 12], pairsCut: false,
    });
  });

  it('the failed-fetch example answers unmeasured, never ok', () => {
    expect(read(worked(FETCH_FAILED))).toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('a gh-failed doc keeps its base and answers unmeasured', () => {
    expect(read(worked({ ...FETCH_FAILED, why: 'gh-failed', base: { ref: 'main', sha: sha(9) } })))
      .toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('a doc of exactly 524288 bytes reads, and one of 524289 is unreadable', () => {
    const body = JSON.stringify(worked());
    const pad = (n: number): string => body + ' '.repeat(n - Buffer.byteLength(body, 'utf8'));
    expect(RADAR_PROBE_MAX_BYTES).toBe(524288);
    expect(parseProbe(pad(524288), 'proj-a', NOW).ok).toBe(true);
    unreadable(parseProbe(pad(524289), 'proj-a', NOW));
  });

  it('the size is counted in bytes, not characters', () => {
    // \u00e9 is two bytes in UTF-8: a doc of 524289 bytes has fewer characters than the cap, and is still over it.
    const body = JSON.stringify(worked({ scratch: { note: '\u00e9'.repeat(100) } }));
    const pad = (n: number): string => body + ' '.repeat(n - Buffer.byteLength(body, 'utf8'));
    expect(parseProbe(pad(524288), 'proj-a', NOW).ok).toBe(true);
    const over = pad(524289);
    expect(over.length).toBeLessThan(524288);
    unreadable(parseProbe(over, 'proj-a', NOW));
  });

  it('bad JSON, and JSON that is not an object', () => {
    unreadable(parseProbe('{not json', 'proj-a', NOW));
    unreadable(parseProbe('[]', 'proj-a', NOW));
    unreadable(parseProbe('null', 'proj-a', NOW));
    unreadable(parseProbe('', 'proj-a', NOW));
  });

  it('v other than 1, and a foreign project', () => {
    unreadable(read(worked({ v: 2 })));
    unreadable(read(worked({ v: undefined })));
    unreadable(read(worked({ project: 'proj-b' })));
    unreadable(read(worked(), NOW, 'proj-b'));
  });

  it('a state that is neither measured nor unmeasured', () => {
    unreadable(read(worked({ state: 'red' })));
    unreadable(read(worked({ state: undefined })));
  });

  it('a measured doc: a why, no base, a base with a bad sha or an empty ref', () => {
    unreadable(read(worked({ why: 'budget' })));
    unreadable(read(worked({ base: null })));
    unreadable(read(worked({ base: { ref: 'main', sha: 'A'.repeat(40) } })));
    unreadable(read(worked({ base: { ref: 'main', sha: 'a'.repeat(39) } })));
    unreadable(read(worked({ base: { ref: '', sha: sha(9) } })));
    unreadable(read(worked({ base: undefined })));
  });

  it('an unmeasured doc: no why, an empty or over-long why, heads, pairs, or a malformed base', () => {
    unreadable(read(worked({ ...FETCH_FAILED, why: undefined })));
    unreadable(read(worked({ ...FETCH_FAILED, why: '' })));
    unreadable(read(worked({ ...FETCH_FAILED, why: 'x'.repeat(65) })));
    unreadable(read(worked({ ...FETCH_FAILED, why: 7 })));
    unreadable(read(worked({ ...FETCH_FAILED, heads: worked().heads })));
    unreadable(read(worked({ ...FETCH_FAILED, pairs: worked().pairs })));
    unreadable(read(worked({ ...FETCH_FAILED, base: { ref: 'main' } })));
    expect(read(worked({ ...FETCH_FAILED, why: 'x'.repeat(64) }))).toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('headsCut and pairsCut must be booleans', () => {
    unreadable(read(worked({ headsCut: undefined })));
    unreadable(read(worked({ headsCut: 'no' })));
    unreadable(read(worked({ pairsCut: 0 })));
    unreadable(read(worked({ pairsCut: null })));
  });

  it('heads, pairs and pairHeads must be arrays', () => {
    unreadable(read(worked({ heads: undefined })));
    unreadable(read(worked({ pairs: {} })));
    unreadable(read(worked({ pairHeads: undefined })));
  });

  it.each([
    ['a zero pr', { pr: 0 }],
    ['a fractional pr', { pr: 1.5 }],
    ['a string pr', { pr: '12' }],
    ['a short head', { head: 'a'.repeat(39) }],
    ['an upper-case head', { head: 'A'.repeat(40) }],
    ['a missing branch', { branch: undefined }],
    ['a numeric id', { id: 7 }],
    ['an absent id', { id: undefined }],
    ['a missing base answer', { base: undefined }],
    ['a base answer with an unknown state', { base: { state: 'green' } }],
    ['a conflict with no paths', { base: { state: 'conflict', pathsCut: false } }],
    ['a conflict with a non-string path', { base: { state: 'conflict', paths: [1], pathsCut: false } }],
    ['a conflict with no pathsCut', { base: { state: 'conflict', paths: ['a'] } }],
    ['an unmeasured answer with no why', { base: { state: 'unmeasured' } }],
    ['an unmeasured answer with an empty why', { base: { state: 'unmeasured', why: '' } }],
    ['an unmeasured answer with an over-long why', { base: { state: 'unmeasured', why: 'y'.repeat(65) } }],
  ])('a heads entry with %s is unreadable', (_name, over) => {
    const heads = [{ ...(worked().heads as Record<string, unknown>[])[0], ...over }];
    unreadable(read(worked({ heads, pairs: [], pairHeads: [] })));
  });

  it('a repeated head pr is unreadable', () => {
    const h = (worked().heads as Record<string, unknown>[])[0];
    unreadable(read(worked({ heads: [h, { ...h, head: sha(99) }], pairs: [], pairHeads: [] })));
  });

  it('an unmeasured answer written as the radar writes it (rc-<n>, budget) reads, against no word list', () => {
    for (const why of ['rc-128', 'timeout', 'no-tree', 'budget', 'a-word-nobody-wrote']) {
      const heads = [{ pr: 12, head: sha(12), branch: 'ws/alpha', id: null, base: { state: 'unmeasured', why } }];
      expect(read(worked({ heads, pairs: [], pairHeads: [] })).ok, why).toBe(true);
    }
  });

  it('a head\'s id is null or a registry id: an empty string or a non-string is unreadable', () => {
    const one = (id: unknown) => [{ pr: 12, head: sha(12), branch: 'ws/alpha', id, base: { state: 'clean' } }];
    expect(read(worked({ heads: one(null), pairs: [], pairHeads: [] })).ok).toBe(true);
    unreadable(read(worked({ heads: one(''), pairs: [], pairHeads: [] })));
    unreadable(read(worked({ heads: one(''), pairs: [], pairHeads: [12] })));
    unreadable(read(worked({ heads: one(7), pairs: [], pairHeads: [] })));
    unreadable(read(worked({ heads: one('-x'), pairs: [], pairHeads: [] })));
  });

  it('pairHeads: a pr that is no head, a repeat, a head with a null id, or a non-number is unreadable', () => {
    unreadable(read(worked({ pairHeads: [14, 99] })));
    unreadable(read(worked({ pairHeads: [14, 14] })));
    unreadable(read(worked({ pairHeads: [14, 13] })));   // 13 has a null id
    unreadable(read(worked({ pairHeads: [14, '12'] })));
    unreadable(read(worked({ pairHeads: [14, 0] })));
  });

  it('pairHeads has no upper length bound: eleven bound heads read (the radar knob is unbounded)', () => {
    const heads = Array.from({ length: 11 }, (_v, i) => ({
      pr: 100 - i, head: sha(100 - i), branch: `ws/h${i}`, id: `lane-a-proj-a-h${i}`, base: { state: 'clean' },
    }));
    expect(read(worked({ heads, pairs: [], pairHeads: heads.map((h) => h.pr) })).ok).toBe(true);
  });

  it('pairs: a >= b, a member outside pairHeads, a duplicate, or a malformed answer is unreadable', () => {
    const pair = { a: 12, b: 14, state: 'conflict', paths: ['src/x.ts'], pathsCut: false };
    unreadable(read(worked({ pairs: [{ ...pair, a: 14, b: 12 }] })));
    unreadable(read(worked({ pairs: [{ ...pair, a: 12, b: 12 }] })));
    unreadable(read(worked({ pairs: [{ ...pair, b: 13 }] })));     // 13 is not in pairHeads
    unreadable(read(worked({ pairs: [{ ...pair, b: 99 }] })));
    unreadable(read(worked({ pairs: [pair, pair] })));
    unreadable(read(worked({ pairs: [{ ...pair, state: 'red' }] })));
    unreadable(read(worked({ pairs: [{ ...pair, paths: undefined }] })));
    unreadable(read(worked({ pairs: [{ a: 12, b: 14, state: 'unmeasured' }] })));
    unreadable(read(worked({ pairs: [{ ...pair, a: '12' }] })));
  });

  it('a clean pair and an unmeasured pair read', () => {
    const doc = okDoc(worked({
      pairs: [{ a: 12, b: 14, state: 'unmeasured', why: 'rc-1' }],
    }));
    expect(doc.pairs).toEqual([{ a: 12, b: 14, answer: { state: 'unmeasured' } }]);
    expect(okDoc(worked({ pairs: [{ a: 12, b: 14, state: 'clean' }] })).pairs[0]!.answer).toEqual({ state: 'clean' });
  });

  it('an empty file is unreadable (a symlink or a FIFO never reaches the parser: the reader refuses it first)', () => {
    unreadable(parseProbe('', 'proj-a', NOW));
  });

  describe('the clock', () => {
    it(`a doc ${RADAR_PROBE_FRESH_S} s old reads, and one 1201 s old is stale`, () => {
      expect(read(worked({ at: iso(-RADAR_PROBE_FRESH_S) })).ok).toBe(true);
      expect(read(worked({ at: iso(-1201) }))).toEqual({ ok: false, reason: 'stale' });
    });
    it('a doc 60 s ahead reads, and one 61 s ahead is stale', () => {
      expect(read(worked({ at: iso(60) })).ok).toBe(true);
      expect(read(worked({ at: iso(61) }))).toEqual({ ok: false, reason: 'stale' });
    });
    // D-7481: the radar writes `%Y-%m-%dT%H:%M:%SZ`; an `at` of any other shape is a doc the radar did not write.
    it('a missing, non-string or malformed at is unreadable, not stale (the radar\'s stamp grammar)', () => {
      unreadable(read(worked({ at: undefined })));
      unreadable(read(worked({ at: 'yesterday' })));
      unreadable(read(worked({ at: 17 })));
      unreadable(read(worked({ at: null })));
      unreadable(read(worked({ at: '2026-10-27 09:00:00' })));
      unreadable(read(worked({ at: '2026-10-27T09:00:00.000Z' })));   // with millis
      unreadable(read(worked({ at: '2026-10-27T09:00:00+00:00' })));
      unreadable(read(worked({ ...FETCH_FAILED, at: 'yesterday' })));
    });
    it('a well-formed stamp still reads', () => {
      expect(read(worked({ at: '2026-10-27T09:00:00Z' })).ok).toBe(true);
    });
    it('a stale unmeasured doc is stale; an unreadable stale doc is unreadable (the order of the reasons)', () => {
      expect(read(worked({ ...FETCH_FAILED, at: iso(-5000) }))).toEqual({ ok: false, reason: 'stale' });
      unreadable(read(worked({ at: iso(-5000), v: 2 })));
    });
  });
});

const ROWS: RadarRow[] = [
  { id: 'lane-a-proj-a-alpha', branch: 'ws/alpha', pr: { number: 12, open: true } },
  { id: 'lane-a-proj-a-beta', branch: 'ws/beta', pr: { number: 14, open: true } },
];
const landings = (over: Record<string, unknown> = {}, rows: readonly RadarRow[] = ROWS, nowMs = NOW) =>
  sessionLandingsOf(okDoc(worked(over)), rows, nowMs);

describe('sessionLandingsOf', () => {
  it("the worked example's three heads: two matched sessions, each with the other's conflict, and the null-id head unbound", () => {
    const m = landings();
    expect([...m.keys()]).toEqual(['lane-a-proj-a-alpha', 'lane-a-proj-a-beta']);
    // No row is on the null-id head's branch `feature/x`, so nothing is unbound.
    expect(m.get('lane-a-proj-a-alpha')).toEqual({
      at: iso(0), pr: 12, head: sha(12), baseRef: 'main',
      base: { state: 'clean' },
      paired: true,
      conflicts: [{ pr: 14, paths: ['src/x.ts'], pathsCut: false }],
      unmeasuredWith: [],
      cut: { heads: false, pairs: false, unbound: false },
    });
    expect(m.get('lane-a-proj-a-beta')).toEqual({
      at: iso(0), pr: 14, head: sha(14), baseRef: 'main',
      base: { state: 'unmeasured' },
      paired: true,
      conflicts: [{ pr: 12, paths: ['src/x.ts'], pathsCut: false }],
      unmeasuredWith: [],
      cut: { heads: false, pairs: false, unbound: false },
    });
  });

  it('a conflict with the base carries its paths and pathsCut, and a row with no PR yet still matches', () => {
    const rows: RadarRow[] = [{ id: 'lane-a-proj-a-alpha', branch: 'ws/alpha', pr: null }];
    const heads = [{ pr: 12, head: sha(12), branch: 'ws/alpha', id: 'lane-a-proj-a-alpha',
      base: { state: 'conflict', paths: ['a.ts', 'b.ts'], pathsCut: true } }];
    const l = landings({ heads, pairs: [], pairHeads: [12] }, rows).get('lane-a-proj-a-alpha');
    expect(l?.base).toEqual({ state: 'conflict', paths: ['a.ts', 'b.ts'], pathsCut: true });
    expect(l?.conflicts).toEqual([]);
  });

  it('a null id gives no entry, and no session is matched to it', () => {
    const rows: RadarRow[] = [{ id: 'lane-a-proj-a-gamma', branch: 'feature/x', pr: null }, ...ROWS];
    const m = landings({}, rows);
    expect(m.has('lane-a-proj-a-gamma')).toBe(false);
    expect([...m.keys()].sort()).toEqual(['lane-a-proj-a-alpha', 'lane-a-proj-a-beta']);
  });

  it('an id on two heads gives no entry for either head', () => {
    const heads = [
      { pr: 12, head: sha(12), branch: 'ws/alpha', id: 'lane-a-proj-a-alpha', base: { state: 'clean' } },
      { pr: 15, head: sha(15), branch: 'ws/alpha', id: 'lane-a-proj-a-alpha', base: { state: 'clean' } },
    ];
    const m = landings({ heads, pairs: [], pairHeads: [12, 15] });
    expect(m.size).toBe(0);
  });

  it('a branch moved after the tick gives no entry', () => {
    const rows: RadarRow[] = [{ id: 'lane-a-proj-a-alpha', branch: 'ws/alpha-2', pr: null }, ROWS[1]!];
    const m = landings({}, rows);
    expect(m.has('lane-a-proj-a-alpha')).toBe(false);
    expect(m.has('lane-a-proj-a-beta')).toBe(true);
  });

  it('a row whose branch is unmeasured (null) gives no entry', () => {
    const m = landings({}, [{ id: 'lane-a-proj-a-alpha', branch: null, pr: null }]);
    expect(m.size).toBe(0);
  });

  it('a PR number that differs gives no entry, and so does a PR that is no longer open', () => {
    const differs = landings({}, [{ id: 'lane-a-proj-a-alpha', branch: 'ws/alpha', pr: { number: 99, open: true } }]);
    expect(differs.size).toBe(0);
    const merged = landings({}, [{ id: 'lane-a-proj-a-alpha', branch: 'ws/alpha', pr: { number: 12, open: false } }]);
    expect(merged.size).toBe(0);
  });

  it('a row that no head names gives no entry', () => {
    expect(landings({}, [{ id: 'lane-a-proj-a-delta', branch: 'ws/delta', pr: null }]).size).toBe(0);
  });

  it('a null-id head on a fleet branch sets unbound on every landing', () => {
    const rows: RadarRow[] = [...ROWS, { id: 'lane-a-proj-a-gamma', branch: 'feature/x', pr: null }];
    const m = landings({}, rows);
    expect([...m.keys()].sort()).toEqual(['lane-a-proj-a-alpha', 'lane-a-proj-a-beta']);
    for (const l of m.values()) expect(l.cut.unbound).toBe(true);
  });

  it('a null-id head on no fleet branch leaves unbound false', () => {
    for (const l of landings().values()) expect(l.cut.unbound).toBe(false);
  });

  it('a pair is shown on both of its PRs, and on no third', () => {
    const heads = [12, 14, 16].map((pr, i) => ({
      pr, head: sha(pr), branch: `ws/h${i}`, id: `lane-a-proj-a-h${i}`, base: { state: 'clean' },
    }));
    const rows: RadarRow[] = heads.map((h) => ({ id: h.id, branch: h.branch, pr: { number: h.pr, open: true } }));
    const m = landings({
      heads, pairHeads: [16, 14, 12],
      pairs: [{ a: 12, b: 14, state: 'conflict', paths: ['x'], pathsCut: false }],
    }, rows);
    expect(m.get('lane-a-proj-a-h0')?.conflicts).toEqual([{ pr: 14, paths: ['x'], pathsCut: false }]);
    expect(m.get('lane-a-proj-a-h1')?.conflicts).toEqual([{ pr: 12, paths: ['x'], pathsCut: false }]);
    expect(m.get('lane-a-proj-a-h2')?.conflicts).toEqual([]);
    expect(m.get('lane-a-proj-a-h2')?.unmeasuredWith).toEqual([]);
  });

  it('an unmeasured pair lands in unmeasuredWith on both PRs, and a clean pair lands nowhere', () => {
    const m = landings({ pairs: [{ a: 12, b: 14, state: 'unmeasured', why: 'budget' }] });
    for (const [id, other] of [['lane-a-proj-a-alpha', 14], ['lane-a-proj-a-beta', 12]] as const) {
      expect(m.get(id)?.unmeasuredWith).toEqual([other]);
      expect(m.get(id)?.conflicts).toEqual([]);
    }
    const clean = landings({ pairs: [{ a: 12, b: 14, state: 'clean' }] });
    for (const l of clean.values()) {
      expect(l.unmeasuredWith).toEqual([]);
      expect(l.conflicts).toEqual([]);
    }
  });

  it('a head outside pairHeads reads paired: false', () => {
    const m = landings({ pairHeads: [14], pairs: [] });
    expect(m.get('lane-a-proj-a-alpha')?.paired).toBe(false);
    expect(m.get('lane-a-proj-a-beta')?.paired).toBe(true);
  });

  it('a 400-character path is cut to 300, in a pair and in a base answer', () => {
    const long = 'p'.repeat(400);
    const heads = [{ pr: 12, head: sha(12), branch: 'ws/alpha', id: 'lane-a-proj-a-alpha',
      base: { state: 'conflict', paths: [long, 'short.ts'], pathsCut: false } },
    { pr: 14, head: sha(14), branch: 'ws/beta', id: 'lane-a-proj-a-beta', base: { state: 'clean' } }];
    const m = landings({
      heads, pairHeads: [14, 12],
      pairs: [{ a: 12, b: 14, state: 'conflict', paths: [long], pathsCut: false }],
    });
    const a = m.get('lane-a-proj-a-alpha');
    expect(RADAR_PATH_MAX).toBe(300);
    expect(a?.base.paths).toEqual(['p'.repeat(300), 'short.ts']);
    expect(a?.conflicts[0]?.paths).toEqual(['p'.repeat(300)]);
    // A character cut is not the radar's own cut: the flag is carried, not set.
    expect(a?.conflicts[0]?.pathsCut).toBe(false);
  });

  it('a path is never cut inside a surrogate pair', () => {
    const emoji = '\u{1F600}';
    const path = 'p'.repeat(299) + emoji;   // 301 UTF-16 units
    const heads = [{ pr: 12, head: sha(12), branch: 'ws/alpha', id: 'lane-a-proj-a-alpha',
      base: { state: 'conflict', paths: [path], pathsCut: false } }];
    const l = landings({ heads, pairs: [], pairHeads: [12] }).get('lane-a-proj-a-alpha');
    expect(l?.base.paths).toEqual(['p'.repeat(299)]);
  });

  it('each cut flag is carried through: headsCut, pairsCut and the paths flags', () => {
    expect(landings({ headsCut: true }).get('lane-a-proj-a-alpha')?.cut).toEqual({ heads: true, pairs: false, unbound: false });
    expect(landings({ pairsCut: true }).get('lane-a-proj-a-alpha')?.cut).toEqual({ heads: false, pairs: true, unbound: false });
    const m = landings({ pairs: [{ a: 12, b: 14, state: 'conflict', paths: ['x'], pathsCut: true }] });
    expect(m.get('lane-a-proj-a-alpha')?.conflicts[0]?.pathsCut).toBe(true);
  });

  it('a doc already out of its window answers an empty map', () => {
    const doc = okDoc(worked());
    expect(sessionLandingsOf(doc, ROWS, NOW + 1201 * 1000).size).toBe(0);
    expect(sessionLandingsOf(doc, ROWS, NOW + 1200 * 1000).size).toBe(2);
  });

  it('an empty registry gives an empty map', () => {
    expect(landings({}, []).size).toBe(0);
  });
});
