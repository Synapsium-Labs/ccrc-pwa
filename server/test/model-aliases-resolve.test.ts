// Model-class Anthropic arm A2, Task A2.2: `resolveAliases` (shared/model-aliases.mjs), one case per rule of spec §2.5.2
// and the plan's "The rule, per class". Pure: every input is built here, invented ids only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aliasesSourceCause, bareModelId, resolveAliases, CACHE_STALE_AFTER_MS } from '../../shared/model-aliases.mjs';
import type { AliasRow, Aliases, CacheReading, Launch, ResolveInput } from '../../shared/model-aliases.mjs';
import type { ModelClass } from '../../shared/models.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const NOW = Date.parse('2026-11-17T12:00:00Z');
const NOW_ISO = '2026-11-17T12:00:00Z';
const T1 = '2026-11-10T08:00:00Z';
const T2 = '2026-11-12T08:00:00Z';
const T3 = '2026-11-14T08:00:00Z';
const T4 = '2026-11-16T08:00:00Z';

const X1 = 'claude-opus-9-1';
const X2 = 'claude-opus-9-2';
const S1 = 'claude-sonnet-9-1';
const H1 = 'claude-haiku-9-1';
const F1 = 'claude-fable-9-1';

const row = (id: string, over: Partial<AliasRow> = {}): AliasRow => ({
  id, label: `label ${id}`, efforts: ['low', 'high'], defaultEffort: 'high', minVersion: null, ...over,
});
const cache = (fetchedAt: string, targets: Partial<Record<ModelClass, string>>, rows: AliasRow[] = []): CacheReading => ({
  format: 'current', fetchedAt,
  aliasTargets: { haiku: null, sonnet: null, opus: null, fable: null, ...targets },
  rows: new Map(rows.map((r) => [r.id, r])),
});
const launch = (cls: ModelClass, id: string, bornAt: string): Launch => ({ class: cls, id, bornAt });
const resolve = (over: Partial<ResolveInput> = {}): Aliases => resolveAliases({
  own: [], box: [], launches: [], prior: null, holds: {}, laneVersion: '9.9.0', saved: {}, nowMs: NOW, ...over,
});

describe('resolveAliases: which candidate wins', () => {
  it('own fresh cache wins', () => {
    const a = resolve({ own: [cache(T4, { opus: X2 }, [row(X2)])] });
    expect(a.classes.opus).toMatchObject({
      id: X2, source: 'cache', evidenceAt: T4, cacheTarget: X2, seenId: null, seenAt: null, idSince: NOW_ISO,
    });
    expect(a.at).toBe(NOW_ISO);
    expect(a.stale).toBe(false);
    expect(a.cache).toEqual({ fetchedAt: T4, format: 'current' });
    expect(a.classes.sonnet.id).toBeNull();
  });

  it('newer use outranks an older cache', () => {
    const a = resolve({ own: [cache(T2, { opus: X1 })], launches: [launch('opus', X2, T3)] });
    expect(a.classes.opus).toMatchObject({ id: X2, source: 'use', evidenceAt: T3, cacheTarget: X1, seenId: X2, seenAt: T3 });
  });

  it('an older launch does not outrank the cache', () => {
    const a = resolve({ own: [cache(T3, { opus: X2 })], launches: [launch('opus', X1, T2)] });
    expect(a.classes.opus).toMatchObject({ id: X2, source: 'cache', evidenceAt: T3, cacheTarget: X2, seenId: X1, seenAt: T2 });
  });

  it('a tie goes to the cache', () => {
    const a = resolve({ own: [cache(T3, { opus: X2 })], launches: [launch('opus', X1, T3)] });
    expect(a.classes.opus).toMatchObject({ id: X2, source: 'cache' });
  });

  it('the newest own current file is the lane cache', () => {
    const a = resolve({ own: [cache(T1, { opus: X1 }), cache(T3, { opus: X2 }), cache(T2, { opus: X1 })] });
    expect(a.classes.opus).toMatchObject({ id: X2, evidenceAt: T3 });
    expect(a.cache).toEqual({ fetchedAt: T3, format: 'current' });
  });

  it('a stale cache keeps its target until newer evidence', () => {
    const fetched = '2026-11-09T12:00:00Z'; // eight days before NOW
    expect(NOW - Date.parse(fetched)).toBeGreaterThan(CACHE_STALE_AFTER_MS);
    const old = resolve({ own: [cache(fetched, { opus: X1 })], launches: [launch('opus', X2, '2026-11-08T12:00:00Z')] });
    expect(old.classes.opus).toMatchObject({ id: X1, source: 'cache' });
    expect(old.stale).toBe(true);
    expect(aliasesSourceCause(old)).toBe('alias-cache-stale');
    const newer = resolve({ own: [cache(fetched, { opus: X1 })], launches: [launch('opus', X2, T4)] });
    expect(newer.classes.opus).toMatchObject({ id: X2, source: 'use' });
    expect(newer.stale).toBe(true);
  });

  it('seven days to the second is not stale, a second more is', () => {
    const edge = new Date(NOW - CACHE_STALE_AFTER_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
    expect(resolve({ own: [cache(edge, { opus: X1 })] }).stale).toBe(false);
    const past = new Date(NOW - CACHE_STALE_AFTER_MS - 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    expect(resolve({ own: [cache(past, { opus: X1 })] }).stale).toBe(true);
  });

  it('an older-format newest file is stale and is never a candidate', () => {
    const a = resolve({ own: [cache(T2, { opus: X1 }), { format: 'older', fetchedAt: T4 }] });
    expect(a.stale).toBe(true);
    expect(a.cache).toEqual({ fetchedAt: T4, format: 'older' });
    expect(a.classes.opus).toMatchObject({ id: X1, source: 'cache', evidenceAt: T2 });
    const only = resolve({ own: [{ format: 'older', fetchedAt: T4 }] });
    expect(only.stale).toBe(true);
    expect(only.classes.opus.id).toBeNull();
    expect(aliasesSourceCause(only)).toBe('alias-source-absent');
    // An older file whose time is unreadable is the oldest, so a current file is the newest.
    const unread = resolve({ own: [{ format: 'older', fetchedAt: null }, cache(T2, { opus: X1 })] });
    expect(unread.stale).toBe(false);
    expect(unread.cache).toEqual({ fetchedAt: T2, format: 'current' });
    const alone = resolve({ own: [{ format: 'older', fetchedAt: null }] });
    expect(alone.cache).toEqual({ fetchedAt: null, format: 'older' });
    expect(alone.stale).toBe(true);
  });

  it('the cache field says why there is no reading', () => {
    expect(resolve().cache).toEqual({ none: 'absent' });
    expect(resolve().stale).toBe(false);
    expect(resolve({ own: [{ format: 'invalid', why: 'x' }] }).cache).toEqual({ none: 'invalid' });
    expect(resolve({ own: [], ownUnreadable: true }).cache).toEqual({ none: 'unreadable' });
    expect(resolve({ own: [{ format: 'invalid', why: 'x' }], ownUnreadable: true }).cache).toEqual({ none: 'unreadable' });
    // An invalid file beside a usable one changes nothing.
    expect(resolve({ own: [{ format: 'invalid', why: 'x' }, cache(T2, { opus: X1 })] }).cache)
      .toEqual({ fetchedAt: T2, format: 'current' });
  });
});

describe('resolveAliases: the lane build', () => {
  const needsNew = cache(T3, { opus: X2 }, [row(X2, { minVersion: '9.2.0' })]);

  it('target needs a newer build is no candidate', () => {
    const a = resolve({ own: [needsNew], laneVersion: '9.1.9' });
    expect(a.classes.opus).toMatchObject({ id: null, source: null, unobserved: true, cacheTarget: X2 });
    const ok = resolve({ own: [needsNew], laneVersion: '9.2.0' });
    expect(ok.classes.opus).toMatchObject({ id: X2, source: 'cache' });
    // part by part as integers: 9.10.0 is above 9.2.0
    expect(resolve({ own: [needsNew], laneVersion: '9.10.0' }).classes.opus.id).toBe(X2);
    expect(resolve({ own: [needsNew], laneVersion: '10.0' }).classes.opus.id).toBe(X2);
  });

  it('a launch still supplies the id when the cache target needs a newer build', () => {
    const a = resolve({ own: [needsNew], laneVersion: '9.1.0', launches: [launch('opus', X1, T1)] });
    expect(a.classes.opus).toMatchObject({ id: X1, source: 'use', cacheTarget: X2 });
  });

  it('an unreadable build gates a minimum', () => {
    expect(resolve({ own: [needsNew], laneVersion: null }).classes.opus.id).toBeNull();
    const noMin = cache(T3, { opus: X2 }, [row(X2)]);
    expect(resolve({ own: [noMin], laneVersion: null }).classes.opus.id).toBe(X2);
  });

  it('a target with no row has no minimum and is a candidate', () => {
    const a = resolve({ own: [cache(T3, { opus: X2 })], laneVersion: null });
    expect(a.classes.opus).toMatchObject({ id: X2, row: null, rowFrom: null, unlaunchable: null, unobserved: false });
  });

  it('a kept id the build cannot launch is dropped from the label', () => {
    const prior = resolve({ own: [cache(T3, { opus: X2 }, [row(X2, { minVersion: '9.2.0' })])], laneVersion: '9.2.0' });
    const since = prior.classes.opus.idSince;
    expect(prior.classes.opus.unlaunchable).toBeNull();
    // The build goes back below the row's minimum: the id stays in the file, flagged, and nothing else moves.
    const down = resolve({
      prior, own: [cache(T3, { opus: X2 }, [row(X2, { minVersion: '9.2.0' })])], laneVersion: '9.1.0',
      nowMs: NOW + 3_600_000,
    });
    expect(down.classes.opus).toMatchObject({
      id: X2, source: 'cache', evidenceAt: T3, idSince: since, unobserved: true,
      unlaunchable: { needs: '9.2.0', laneVersion: '9.1.0' },
    });
    // An unreadable build names no build.
    expect(resolve({ prior, own: [cache(T3, { opus: X2 }, [row(X2, { minVersion: '9.2.0' })])], laneVersion: null })
      .classes.opus.unlaunchable).toEqual({ needs: '9.2.0', laneVersion: null });
    // The build comes back: the id is unchanged, observed again, idSince kept.
    const back = resolve({
      prior: down, own: [cache(T3, { opus: X2 }, [row(X2, { minVersion: '9.2.0' })])], laneVersion: '9.2.0',
      nowMs: NOW + 7_200_000,
    });
    expect(back.classes.opus).toMatchObject({ id: X2, unlaunchable: null, unobserved: false, idSince: since });
  });

  it('a newer id replaces an unlaunchable one', () => {
    const rows = [row(X2, { minVersion: '9.2.0' }), row(X1)];
    const prior = resolve({ own: [cache(T2, { opus: X2 }, rows)], laneVersion: '9.2.0' });
    const a = resolve({
      prior, own: [cache(T2, { opus: X2 }, rows)], laneVersion: '9.1.0', launches: [launch('opus', X1, T4)],
    });
    expect(a.classes.opus).toMatchObject({ id: X1, source: 'use', unlaunchable: null, unobserved: false, idSince: NOW_ISO });
  });
});

describe('resolveAliases: the kept reading and the prior id', () => {
  it('the kept reading survives its marker', () => {
    const prior = resolve({ own: [cache(T1, { opus: X1 })], launches: [launch('opus', X2, T3)] });
    expect(prior.classes.opus).toMatchObject({ id: X2, seenId: X2, seenAt: T3 });
    const a = resolve({ prior, own: [cache(T1, { opus: X1 })], launches: [] });
    expect(a.classes.opus).toMatchObject({ id: X2, source: 'use', evidenceAt: T3, seenId: X2, seenAt: T3, idSince: prior.classes.opus.idSince });
  });

  it('a newer marker replaces the kept reading, an older one does not', () => {
    const prior = resolve({ launches: [launch('opus', X1, T2)] });
    const newer = resolve({ prior, launches: [launch('opus', X2, T3)] });
    expect(newer.classes.opus).toMatchObject({ seenId: X2, seenAt: T3, id: X2 });
    const older = resolve({ prior: newer, launches: [launch('opus', X1, T1)] });
    expect(older.classes.opus).toMatchObject({ seenId: X2, seenAt: T3, id: X2 });
    // Of several markers the newest by process start counts.
    const many = resolve({ launches: [launch('opus', X1, T1), launch('opus', X2, T4), launch('opus', X1, T2)] });
    expect(many.classes.opus).toMatchObject({ seenId: X2, seenAt: T4 });
  });

  it('older evidence never replaces the id', () => {
    const prior = resolve({ own: [cache(T3, { opus: X2 })] });
    const aged = resolve({ prior, nowMs: NOW + 86_400_000 });
    const a = resolve({
      prior: aged, own: [cache(T2, { opus: X1 })], launches: [launch('opus', X1, T1)], nowMs: NOW + 2 * 86_400_000,
    });
    expect(a.classes.opus).toMatchObject({
      id: X2, source: 'cache', evidenceAt: T3, idSince: prior.classes.opus.idSince, cacheTarget: X1, seenId: X1,
    });
    // The same date as the evidence does not replace it either.
    const same = resolve({ prior, own: [cache(T3, { opus: X1 })] });
    expect(same.classes.opus).toMatchObject({ id: X2, evidenceAt: T3 });
  });

  it('newer evidence of the same id moves the evidence, not idSince', () => {
    const prior = resolve({ own: [cache(T2, { opus: X2 })] });
    const a = resolve({ prior, own: [cache(T4, { opus: X2 })], nowMs: NOW + 3_600_000 });
    expect(a.classes.opus).toMatchObject({ id: X2, evidenceAt: T4, idSince: prior.classes.opus.idSince });
  });

  it('a first id has idSince now, an unchanged id keeps idSince, a changed one takes the new time', () => {
    const first = resolve({ own: [cache(T2, { opus: X1 })] });
    expect(first.classes.opus.idSince).toBe(NOW_ISO);
    const later = NOW + 5 * 3_600_000;
    const same = resolve({ prior: first, own: [cache(T2, { opus: X1 })], nowMs: later });
    expect(same.classes.opus.idSince).toBe(NOW_ISO);
    const moved = resolve({ prior: first, own: [cache(T4, { opus: X2 })], nowMs: later });
    expect(moved.classes.opus.idSince).toBe('2026-11-17T17:00:00Z');
    expect(moved.at).toBe('2026-11-17T17:00:00Z');
  });

  it('every time is whole-second ISO', () => {
    const a = resolve({ own: [cache(T2, { opus: X1 })], nowMs: NOW + 123 });
    const times = [a.at, a.classes.opus.idSince, a.classes.opus.evidenceAt];
    for (const t of times) expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(() => resolve({ nowMs: Number.NaN })).toThrow(RangeError);
  });

  it('use ignores another family', () => {
    const a = resolve({ launches: [launch('opus', S1, T3), launch('opus', 'claude-other-9-1', T4)] });
    expect(a.classes.opus).toMatchObject({ id: null, seenId: null, seenAt: null });
    expect(a.classes.sonnet.id).toBeNull();
    // A launch is read for the class it names only.
    const b = resolve({ launches: [launch('sonnet', S1, T3)] });
    expect(b.classes.sonnet).toMatchObject({ id: S1, source: 'use' });
    expect(b.classes.opus.id).toBeNull();
    // A launch whose time is not whole-second ISO is dropped.
    expect(resolve({ launches: [launch('opus', X1, '2026-11-14T08:00:00.500Z')] }).classes.opus.seenId).toBeNull();
  });

  it('no source', () => {
    const a = resolve();
    for (const c of ['haiku', 'sonnet', 'opus', 'fable'] as const) {
      expect(a.classes[c]).toMatchObject({
        id: null, source: null, evidenceAt: null, idSince: null, unobserved: true, row: null, heldRow: null, orphaned: null,
      });
    }
    expect(aliasesSourceCause(a)).toBe('alias-source-absent');
  });

  it('one class with an id is a source', () => {
    const a = resolve({ own: [cache(T2, { sonnet: S1 })] });
    expect(aliasesSourceCause(a)).toBeNull();
    expect(a.classes.opus.unobserved).toBe(true);
  });
});

describe('resolveAliases: rows', () => {
  it('own row first, box row by id', () => {
    const own = cache(T3, { opus: X2 }, [row(X2, { label: 'own label' })]);
    const box = cache(T4, { opus: X1 }, [row(X2, { label: 'box label' }), row(S1)]);
    const a = resolve({ own: [own], box: [box] });
    expect(a.classes.opus).toMatchObject({ rowFrom: 'own', row: { label: 'own label' } });
    // Not listed by the own cache: the newest box reading that lists it.
    const b = resolve({ own: [cache(T3, { opus: X2 })], box: [cache(T1, {}, [row(X2, { label: 'older box' })]), box] });
    expect(b.classes.opus).toMatchObject({ rowFrom: 'box', row: { label: 'box label' } });
    // A box reading's targets are never read.
    const c = resolve({ box: [box] });
    expect(c.classes.opus.id).toBeNull();
    expect(c.classes.opus.cacheTarget).toBeNull();
    // Listed nowhere: no row.
    expect(resolve({ own: [cache(T3, { opus: X2 })], box: [cache(T1, {}, [row(S1)])] }).classes.opus)
      .toMatchObject({ row: null, rowFrom: null });
  });

  it('a row is a copy, and its effort field keeps null and empty apart', () => {
    const r = row(H1, { efforts: [] });
    const own = cache(T3, { haiku: H1, sonnet: S1 }, [r, row(S1, { efforts: null })]);
    const a = resolve({ own: [own] });
    expect(a.classes.haiku.row?.efforts).toEqual([]);
    expect(a.classes.sonnet.row?.efforts).toBeNull();
    expect(a.classes.haiku.row).not.toBe(r);
  });

  it('a box row that needs a newer build gates a target the own cache gives no row for', () => {
    const box = cache(T4, {}, [row(X2, { minVersion: '9.2.0' })]);
    const a = resolve({ own: [cache(T3, { opus: X2 })], box: [box], laneVersion: '9.1.0' });
    expect(a.classes.opus.id).toBeNull();
  });
});

describe('resolveAliases: holds, rows of a hold, orphaned levels', () => {
  it('a held class with only older evidence is unobserved', () => {
    const a = resolve({ own: [cache(T2, { opus: X2 })], holds: { opus: { at: T3, model: X1 } } });
    expect(a.classes.opus).toMatchObject({ id: X2, evidenceAt: T2, unobserved: true });
  });

  it('a cache fetched after the hold observes it', () => {
    const a = resolve({ own: [cache(T4, { opus: X2 })], holds: { opus: { at: T3, model: X1 } } });
    expect(a.classes.opus.unobserved).toBe(false);
    const edge = resolve({ own: [cache(T3, { opus: X2 })], holds: { opus: { at: T3, model: X1 } } });
    expect(edge.classes.opus.unobserved).toBe(false);
  });

  it('a hold on one class leaves another observed', () => {
    const a = resolve({
      own: [cache(T2, { opus: X2, sonnet: S1 })], holds: { opus: { at: T3, model: X1 } },
    });
    expect(a.classes.opus.unobserved).toBe(true);
    expect(a.classes.sonnet.unobserved).toBe(false);
    expect(a.classes.haiku.unobserved).toBe(true); // no id
  });

  it('a held class carries the held id\'s row', () => {
    const own = cache(T4, { opus: X2 }, [row(X2, { label: 'current' }), row(X1, { label: 'held' })]);
    const a = resolve({ own: [own], holds: { opus: { at: T3, model: X1 } } });
    expect(a.classes.opus.row?.label).toBe('current');
    expect(a.classes.opus.heldRow?.label).toBe('held');
    expect(a.classes.sonnet.heldRow).toBeNull();
    // The held id's row from the box when the own cache has none; none anywhere is null.
    const b = resolve({ own: [cache(T4, { opus: X2 })], box: [cache(T1, {}, [row(X1, { label: 'box held' })])], holds: { opus: { at: T3, model: X1 } } });
    expect(b.classes.opus.heldRow?.label).toBe('box held');
    expect(resolve({ own: [cache(T4, { opus: X2 })], holds: { opus: { at: T3, model: X1 } } }).classes.opus.heldRow).toBeNull();
  });

  it('a held class\'s id is still resolved from evidence', () => {
    const a = resolve({ own: [cache(T4, { opus: X2 })], holds: { opus: { at: T3, model: X1 } } });
    expect(a.classes.opus.id).toBe(X2);
  });

  it('orphaned names a saved level under another id of the class\'s family when the current id has none', () => {
    const own = cache(T3, { opus: X2, sonnet: S1 });
    const a = resolve({ own: [own], saved: { [X1]: 'max', [S1]: 'low', 'claude-fable-9-1': 'high' } });
    expect(a.classes.opus.orphaned).toEqual({ id: X1, level: 'max' });
    expect(a.classes.sonnet.orphaned).toBeNull(); // the current id has its own saved level
    // The current id has one: null.
    expect(resolve({ own: [own], saved: { [X1]: 'max', [X2]: 'high' } }).classes.opus.orphaned).toBeNull();
    // [1m] on a saved key is the same id.
    expect(resolve({ own: [own], saved: { [`${X2}[1m]`]: 'high', [X1]: 'max' } }).classes.opus.orphaned).toBeNull();
    // No saved levels, or no current id: null.
    expect(resolve({ own: [own] }).classes.opus.orphaned).toBeNull();
    expect(resolve({ saved: { [X1]: 'max' } }).classes.opus.orphaned).toBeNull();
    // Several: the greatest id, whatever the key order.
    expect(resolve({ own: [cache(T3, { opus: 'claude-opus-9-3' })], saved: { [X2]: 'low', [X1]: 'max' } }).classes.opus.orphaned)
      .toEqual({ id: X2, level: 'low' });
  });
});

describe('bareModelId', () => {
  const table: { raw: string; bare: string }[] = JSON.parse(
    readFileSync(path.join(here, 'fixtures', 'model-id-bare.json'), 'utf8'));

  it('strips one [1m], reading every row of the shared fixture table', () => {
    expect(table.length).toBeGreaterThanOrEqual(5);
    for (const { raw, bare } of table) expect(bareModelId(raw), raw).toBe(bare);
  });

  it('the table covers a double suffix, a plain id and a suffix inside an id', () => {
    const raws = table.map((r) => r.raw);
    expect(raws.some((r) => r.endsWith('[1m][1m]'))).toBe(true);
    expect(raws.some((r) => !r.includes('[1m]'))).toBe(true);
    expect(raws.some((r) => r.includes('[1m]') && !r.endsWith('[1m]'))).toBe(true);
  });
});
