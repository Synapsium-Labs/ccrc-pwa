// Docs reader completion plan Task 12 (part A): `docs/reader/history.ts`, the pure decisions behind the frame's version
// list. Every hash is a placeholder (`'a'.repeat(40)`), every path and project a placeholder too.
import { describe, expect, it } from 'vitest';
import type { DocPin, DocsLogEntry, DocsLogOk } from '../../shared/docs';
import {
  READER_SEED_DATE_MAX_UNITS, READER_SEED_MAX_COMMITS, READER_SEED_MAX_PARENTS, READER_SEED_SUBJECT_MAX_UNITS,
  readerChangesBase, readerLogAsk, readerServedHash, readerVersionMove, readerVersionSeed,
} from '../src/docs/reader/history';

const SHA40 = 'a'.repeat(40);
const SHA64 = 'b'.repeat(64);
const DATE = '2026-01-02T03:04:05+00:00';

/** A full 40-hex hash made from a number, so each entry has its own. */
const hashOf = (n: number): string => n.toString(16).padStart(40, '0');

function entry(n: number, over: Partial<DocsLogEntry> = {}): DocsLogEntry {
  return { sha: hashOf(n), parent: hashOf(n + 1), date: DATE, author: 'someone', subject: `change ${n}`, ...over };
}

function logOf(entries: unknown[], over: Record<string, unknown> = {}): DocsLogOk {
  return {
    v: 1, verb: 'docs-log', ok: true, elapsedMs: 1, commit: SHA40, section: 'specs', path: 'a/b.md',
    entries, truncated: false, ...over,
  } as unknown as DocsLogOk;
}

const commitsOf = (log: DocsLogOk | null, only: string | null = null) => readerVersionSeed(SHA40, false, log, only)!.commits;

describe('readerVersionSeed: the served hash', () => {
  it('accepts a full 40-hex and a full 64-hex hash', () => {
    expect(readerVersionSeed(SHA40, false, null, null)).toEqual({ sha: SHA40, draft: false, commits: null, only: null });
    expect(readerVersionSeed(SHA64, false, null, null)).toEqual({ sha: SHA64, draft: false, commits: null, only: null });
  });

  it('refuses a short, long, upper-case, non-hex, empty or padded hash, never cutting one into validity', () => {
    const bad = [
      'a'.repeat(7), 'a'.repeat(39), 'a'.repeat(41), 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(40),
      `${'a'.repeat(39)}g`, '', `${SHA40} `, ` ${SHA40}`, `${SHA40}\n`,
    ];
    for (const sha of bad) expect(readerVersionSeed(sha, false, logOf([entry(1)]), null)).toBeNull();
  });

  it('draft is true only for true', () => {
    expect(readerVersionSeed(SHA40, true, null, null)!.draft).toBe(true);
    expect(readerVersionSeed(SHA40, false, null, null)!.draft).toBe(false);
    expect(readerVersionSeed(SHA40, 'yes' as unknown as boolean, null, null)!.draft).toBe(false);
    expect(readerVersionSeed(SHA40, 1 as unknown as boolean, null, null)!.draft).toBe(false);
  });
});

describe('readerVersionSeed: the commits', () => {
  it('no history supplied gives null commits and no day filter, even for a valid one', () => {
    expect(readerVersionSeed(SHA40, false, null, SHA40)).toEqual({ sha: SHA40, draft: false, commits: null, only: null });
  });

  it('a well-formed log maps subject, date and parents, and drops the author', () => {
    const log = logOf([entry(1), entry(2, { parent: null })]);
    const commits = commitsOf(log)!;
    expect(commits).toEqual([
      { sha: hashOf(1), subject: 'change 1', date: DATE, parents: [hashOf(2)] },
      { sha: hashOf(2), subject: 'change 2', date: DATE, parents: [] },
    ]);
    for (const c of commits) expect(Object.keys(c).sort()).toEqual(['date', 'parents', 'sha', 'subject']);
  });

  it('a root commit has no parents, a later one has its first parent, and none lists more than the library keeps', () => {
    const commits = commitsOf(logOf([entry(1), entry(2, { parent: null }), entry(3, { parent: SHA64 })]))!;
    expect(commits.map((c) => c.parents)).toEqual([[hashOf(2)], [], [SHA64]]);
    for (const c of commits) expect(c.parents.length).toBeLessThanOrEqual(READER_SEED_MAX_PARENTS);
  });

  it('the limits are the library\'s', () => {
    expect([READER_SEED_MAX_COMMITS, READER_SEED_SUBJECT_MAX_UNITS, READER_SEED_DATE_MAX_UNITS, READER_SEED_MAX_PARENTS])
      .toEqual([100, 200, 64, 16]);
  });

  it('an empty list of entries is an empty history, not none', () => {
    expect(commitsOf(logOf([]))).toEqual([]);
  });
});

describe('readerVersionSeed: the subject cut', () => {
  const subjectOf = (subject: string) => commitsOf(logOf([entry(1, { subject })]))![0]!.subject;
  const ASTRAL = '\u{1F600}';
  const lone = (s: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

  it('keeps exactly 200 units and cuts 201 to 200', () => {
    expect(subjectOf('x'.repeat(200))).toBe('x'.repeat(200));
    expect(subjectOf('x'.repeat(201))).toBe('x'.repeat(200));
  });

  it('drops a pair that straddles the 200th unit whole, keeping 199 units', () => {
    const s = 'x'.repeat(199) + ASTRAL + 'y';
    expect(s.length).toBe(202);
    const cut = subjectOf(s);
    expect(cut).toBe('x'.repeat(199));
    expect(cut.length).toBe(199);
  });

  it('keeps a pair that ends exactly at the 200th unit', () => {
    const s = 'x'.repeat(198) + ASTRAL + 'y';
    expect(subjectOf(s)).toBe('x'.repeat(198) + ASTRAL);
  });

  it('cuts 200 astral characters (400 units) to 200 units with no lone surrogate', () => {
    const cut = subjectOf(ASTRAL.repeat(200));
    expect(cut.length).toBe(200);
    expect(cut).toBe(ASTRAL.repeat(100));
    expect(lone(cut)).toBe(false);
  });
});

describe('readerVersionSeed: the date and the cap', () => {
  it('a date of 64 units is kept; one of 65 makes the whole history null', () => {
    const d64 = '2'.repeat(64);
    expect(commitsOf(logOf([entry(1, { date: d64 })]))![0]!.date).toBe(d64);
    expect(commitsOf(logOf([entry(1), entry(2, { date: '2'.repeat(65) })]))).toBeNull();
  });

  it('keeps 100 entries, and of 101 only the first 100, newest first, ignoring a malformed 101st', () => {
    const hundred = Array.from({ length: 100 }, (_, i) => entry(i + 1));
    expect(commitsOf(logOf(hundred))!.map((c) => c.sha)).toEqual(hundred.map((e) => e.sha));
    const more = [...hundred, entry(101)];
    expect(commitsOf(logOf(more))!).toHaveLength(100);
    expect(commitsOf(logOf(more))![0]!.sha).toBe(hashOf(1));
    expect(commitsOf(logOf(more))![99]!.sha).toBe(hashOf(100));
    expect(commitsOf(logOf([...hundred, null, 'junk', { sha: 'bad' }]))).toHaveLength(100);
  });
});

describe('readerVersionSeed: a history that is not shown as complete', () => {
  it('a truncated walk gives null commits', () => {
    expect(commitsOf(logOf([entry(1)], { truncated: true }))).toBeNull();
  });

  it('a missing, inherited or non-false truncated gives null commits', () => {
    const base = { entries: [entry(1)] };
    expect(commitsOf(base as unknown as DocsLogOk)).toBeNull();
    expect(commitsOf(Object.assign(Object.create({ truncated: false }), base) as DocsLogOk)).toBeNull();
    for (const truncated of [0, null, 'false', undefined]) expect(commitsOf(logOf([entry(1)], { truncated }))).toBeNull();
  });

  it('missing, inherited or non-array entries give null commits', () => {
    expect(commitsOf({ truncated: false } as unknown as DocsLogOk)).toBeNull();
    expect(commitsOf(Object.assign(Object.create({ entries: [entry(1)] }), { truncated: false }) as DocsLogOk)).toBeNull();
    for (const entries of [null, 'abc', { length: 1, 0: entry(1) }, 1]) {
      expect(commitsOf({ truncated: false, entries } as unknown as DocsLogOk)).toBeNull();
    }
  });

  it('one malformed entry anywhere in the first 100 makes the whole history null', () => {
    const bads: unknown[] = [
      entry(2, { sha: 'abc1234' }),
      entry(2, { sha: 'a'.repeat(39) }),
      entry(2, { sha: 'A'.repeat(40) }),
      entry(2, { parent: 'abc1234' }),
      entry(2, { parent: 'A'.repeat(40) }),
      entry(2, { parent: undefined }),
      entry(2, { subject: 5 as unknown as string }),
      entry(2, { date: 5 as unknown as string }),
      Object.create({ sha: SHA40 }, {
        parent: { value: null, enumerable: true }, date: { value: DATE, enumerable: true },
        subject: { value: 's', enumerable: true },
      }),
      Object.create({ subject: 's' }, {
        sha: { value: SHA40, enumerable: true }, parent: { value: null, enumerable: true },
        date: { value: DATE, enumerable: true },
      }),
      null,
      'text',
    ];
    for (const bad of bads) {
      expect(commitsOf(logOf([entry(1), bad, entry(3)]))).toBeNull();
      expect(commitsOf(logOf([bad]))).toBeNull();
    }
  });
});

describe('readerVersionSeed: the day filter', () => {
  const log = logOf([entry(1), entry(2), entry(0xabc, { parent: hashOf(900) })]);

  it('is kept when it names an entry', () => {
    expect(commitsOf(log, hashOf(2))).not.toBeNull();
    expect(readerVersionSeed(SHA40, false, log, hashOf(2))!.only).toBe(hashOf(2));
    expect(readerVersionSeed(SHA40, false, log, hashOf(1))!.only).toBe(hashOf(1));
  });

  it('is kept when it names the oldest commit\'s parent, which is no entry itself', () => {
    expect(log.entries.some((e) => e.sha === hashOf(900))).toBe(false);
    expect(readerVersionSeed(SHA40, false, log, hashOf(900))!.only).toBe(hashOf(900));
  });

  it('is dropped when it names neither an entry nor a parent', () => {
    expect(readerVersionSeed(SHA40, false, log, hashOf(555))!.only).toBeNull();
    expect(readerVersionSeed(SHA40, false, log, SHA64)!.only).toBeNull();
  });

  it('is dropped when it is not a full hash', () => {
    const named = hashOf(0xabc);
    expect(readerVersionSeed(SHA40, false, log, named)!.only).toBe(named);
    for (const only of [named.slice(0, 7), named.toUpperCase(), `${named} `, '']) {
      expect(readerVersionSeed(SHA40, false, log, only)!.only).toBeNull();
    }
  });

  it('is dropped when the history is unavailable', () => {
    expect(readerVersionSeed(SHA40, false, null, hashOf(2))!.only).toBeNull();
    expect(readerVersionSeed(SHA40, false, logOf([entry(1)], { truncated: true }), hashOf(1))!.only).toBeNull();
  });
});

describe('readerVersionMove', () => {
  it('a sha opens at it, with no day filter', () => {
    expect(readerVersionMove({ sha: SHA40 })).toEqual({ at: SHA40, only: null });
    expect(readerVersionMove({ sha: SHA64 })).toEqual({ at: SHA64, only: null });
  });

  it('a sha and a day filter give both; a day filter alone goes to the latest', () => {
    expect(readerVersionMove({ sha: SHA40, only: SHA64 })).toEqual({ at: SHA40, only: SHA64 });
    expect(readerVersionMove({ only: SHA40 })).toEqual({ at: null, only: SHA40 });
  });

  it('nothing, or null fields, goes to the latest with no day filter', () => {
    expect(readerVersionMove({})).toEqual({ at: null, only: null });
    expect(readerVersionMove({ sha: null, only: null })).toEqual({ at: null, only: null });
    expect(readerVersionMove({ sha: undefined, only: undefined })).toEqual({ at: null, only: null });
  });

  it('a field that is not a full hash refuses the whole request', () => {
    const bad: unknown[] = ['abc1234', 'A'.repeat(40), 'a'.repeat(41), '', 5, {}, true, `${SHA40} `];
    for (const v of bad) {
      expect(readerVersionMove({ sha: v as string })).toBeNull();
      expect(readerVersionMove({ only: v as string })).toBeNull();
      expect(readerVersionMove({ sha: SHA40, only: v as string })).toBeNull();
      expect(readerVersionMove({ sha: v as string, only: SHA40 })).toBeNull();
    }
  });

  it('an inherited field reads as absent', () => {
    expect(readerVersionMove(Object.create({ sha: SHA40 }) as { sha?: string })).toEqual({ at: null, only: null });
    expect(readerVersionMove(Object.create({ sha: 'junk', only: 'junk' }) as { sha?: string })).toEqual({ at: null, only: null });
  });
});

describe('readerChangesBase', () => {
  const committed: DocPin = { kind: 'committed', commit: SHA40, servedRef: 'origin/main', section: 'specs', path: 'a/b.md' };
  const draft: DocPin = { kind: 'draft', branch: 'ws/demo', head: SHA40, section: 'specs', path: 'a/b.md', fp: 'f'.repeat(16) };

  it('a committed pin and a full hash give the pin at that commit, keeping the served ref, section and path', () => {
    expect(readerChangesBase(committed, SHA64)).toEqual({
      kind: 'committed', commit: SHA64, servedRef: 'origin/main', section: 'specs', path: 'a/b.md',
    });
  });

  it('a draft pin answers null', () => {
    expect(readerChangesBase(draft, SHA64)).toBeNull();
  });

  it('a hash that is not a full commit answers null', () => {
    for (const sha of ['abc1234', 'A'.repeat(40), '', `${SHA40} `]) expect(readerChangesBase(committed, sha)).toBeNull();
  });
});

describe('readerServedHash', () => {
  it('a committed show is served at its commit, never its head', () => {
    expect(readerServedHash({ source: 'committed', commit: SHA40, head: SHA64 })).toBe(SHA40);
    expect(readerServedHash({ source: 'committed', commit: SHA64 })).toBe(SHA64);
  });

  it('a draft is served at its head, never its commit', () => {
    expect(readerServedHash({ source: 'draft', head: SHA40, commit: SHA64 })).toBe(SHA40);
    expect(readerServedHash({ source: 'draft', head: SHA64 })).toBe(SHA64);
  });

  it('an absent field answers null, for either source', () => {
    expect(readerServedHash({ source: 'committed' })).toBeNull();
    expect(readerServedHash({ source: 'draft' })).toBeNull();
    expect(readerServedHash({ source: 'committed', head: SHA40 })).toBeNull();
    expect(readerServedHash({ source: 'draft', commit: SHA40 })).toBeNull();
  });

  it('it does not validate: a value that is not a full commit comes back as it is, for the seed to refuse', () => {
    expect(readerServedHash({ source: 'committed', commit: 'abc' })).toBe('abc');
    expect(readerServedHash({ source: 'committed', commit: '' })).toBe('');
    expect(readerVersionSeed(readerServedHash({ source: 'committed', commit: 'abc' }) ?? '', false, null, null)).toBeNull();
  });
});

describe('readerLogAsk', () => {
  const committed: DocPin = { kind: 'committed', commit: SHA64, servedRef: 'origin/main', section: 'specs', path: 'a/b.md' };
  const draftPin: DocPin = { kind: 'draft', branch: 'ws/demo', head: SHA40, section: 'specs', path: 'a/b.md', fp: 'f'.repeat(16) };

  it('a committed body at a full served hash asks for the opened pin\'s commit, section and path, and nothing else', () => {
    expect(readerLogAsk(committed, false, SHA40)).toEqual({ commit: SHA64, section: 'specs', path: 'a/b.md' });
    expect(readerLogAsk(committed, false, SHA64)).toEqual({ commit: SHA64, section: 'specs', path: 'a/b.md' });
  });

  it('a draft body asks for nothing, whatever the pin and the hash', () => {
    expect(readerLogAsk(committed, true, SHA40)).toBeNull();
    expect(readerLogAsk(draftPin, true, SHA40)).toBeNull();
  });

  it('a draft pin asks for nothing, even for a body not flagged as a draft', () => {
    expect(readerLogAsk(draftPin, false, SHA40)).toBeNull();
  });

  it('a served hash that is not a full commit asks for nothing', () => {
    for (const served of ['', 'abc1234', 'A'.repeat(40), `${SHA40} `, 'a'.repeat(39)]) expect(readerLogAsk(committed, false, served)).toBeNull();
  });
});
