// Model-class Anthropic arm A2, Task A2.1: `parseCatalogueCache` and `newestCache` (shared/model-aliases.mjs), the pure
// reader of Claude Code's catalogue cache. The fixtures under fixtures/model-catalog/ are synthetic: the shape of a
// measured cache file, invented ids, no credential-shaped value.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newestCache, parseCatalogueCache } from '../../shared/model-aliases.mjs';
import type { CacheReading } from '../../shared/model-aliases.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): any => JSON.parse(readFileSync(path.join(here, 'fixtures', 'model-catalog', name), 'utf8'));
const current = (name: string): Extract<CacheReading, { format: 'current' }> => {
  const r = parseCatalogueCache(fixture(name));
  if (r.format !== 'current') throw new Error(`${name} did not parse as current: ${JSON.stringify(r)}`);
  return r;
};

/** The shortest current-format file, for the rows that edit one field. */
const small = (over: Record<string, unknown> = {}, rows: unknown[] = []): any => ({
  version: 2, fetchedAt: 1795000000000,
  catalog: { config: { provider_alias_targets: {}, models: rows, ...over } },
});

describe('parseCatalogueCache', () => {
  it('current format parses rows and targets', () => {
    const r = current('tok-fixture-cc.json');
    expect(r.fetchedAt).toBe('2026-11-18T11:06:40Z');
    expect(r.aliasTargets).toEqual({
      haiku: 'claude-haiku-9-1', sonnet: 'claude-sonnet-9-1', opus: 'claude-opus-9-2', fable: 'claude-fable-9-1',
    });
    expect(r.rows.get('claude-opus-9-2')).toEqual({
      id: 'claude-opus-9-2', label: 'Opus 9.2', efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultEffort: 'xhigh', minVersion: '9.2.0',
    });
    expect(r.rows.get('claude-opus-9-1')).toMatchObject({ efforts: ['low', 'medium', 'high', 'max'], minVersion: null });
    expect(r.rows.get('claude-fable-9-1')?.minVersion).toBe('9.1.0');
    expect([...r.rows.keys()]).toHaveLength(6);
  });

  it('older format is never a source', () => {
    const r = parseCatalogueCache(fixture('older-fixture-cc.json'));
    expect(r).toEqual({ format: 'older', fetchedAt: '2026-11-06T21:20:00Z' });
    expect('aliasTargets' in r).toBe(false);
    expect('rows' in r).toBe(false);
  });

  it('an older-format file whose fetch time cannot be read has a null fetchedAt', () => {
    expect(parseCatalogueCache({ version: 1, fetchedAt: 'yesterday', catalog: { config: { models: [] } } }))
      .toEqual({ format: 'older', fetchedAt: null });
    expect(parseCatalogueCache({ version: 1, catalog: { config: {} } })).toEqual({ format: 'older', fetchedAt: null });
  });

  it('invalid answers why', () => {
    for (const bad of [null, 7, 'x', [], {}, { catalog: null }, { catalog: { config: [] } }]) {
      const r = parseCatalogueCache(bad);
      expect(r.format).toBe('invalid');
      expect(r.format === 'invalid' && r.why.length).toBeGreaterThan(0);
    }
    const badId = parseCatalogueCache(small({}, [{ id: 'bad id with spaces' }]));
    expect(badId.format).toBe('invalid');
    expect(badId.format === 'invalid' && badId.why).toContain('models[0].id');
    const noId = parseCatalogueCache(small({}, [{ name: 'x' }]));
    expect(noId.format).toBe('invalid');
    const badTarget = parseCatalogueCache(small({ provider_alias_targets: { opus: { default: 'no good' } } }));
    expect(badTarget.format).toBe('invalid');
    const badMin = parseCatalogueCache(small({}, [{ id: 'claude-opus-9-1', min_claude_code_version: 'soon' }]));
    expect(badMin.format).toBe('invalid');
  });

  it('a current file whose fetch time cannot be read is invalid, an ISO string is accepted', () => {
    const noTime = small(); delete noTime.fetchedAt;
    expect(parseCatalogueCache(noTime).format).toBe('invalid');
    expect(parseCatalogueCache({ ...small(), fetchedAt: -5 }).format).toBe('invalid');
    expect(parseCatalogueCache({ ...small(), fetchedAt: 'no' }).format).toBe('invalid');
    const iso = parseCatalogueCache({ ...small(), fetchedAt: '2026-11-18T11:06:40.123Z' });
    expect(iso.format === 'current' && iso.fetchedAt).toBe('2026-11-18T11:06:40Z');
  });

  it('a target with no row keeps the target', () => {
    const r = current('no-row-target.json');
    expect(r.aliasTargets.opus).toBe('claude-opus-9-3');
    expect(r.rows.has('claude-opus-9-3')).toBe(false);
    // A class the map does not name is a null target.
    expect(r.aliasTargets.haiku).toBeNull();
    expect(r.aliasTargets.fable).toBeNull();
    expect(r.aliasTargets.sonnet).toBe('claude-sonnet-9-1');
  });

  it('a target needs its own row only to carry a minimum build', () => {
    const r = current('fable-needs-new.json');
    expect(r.aliasTargets.fable).toBe('claude-fable-9-2');
    expect(r.rows.get('claude-fable-9-2')?.minVersion).toBe('9.5.0');
    expect(r.rows.get('claude-sonnet-9-1')?.minVersion).toBeNull();
  });

  it('no effort field is null, takes-none is empty', () => {
    const r = current('tok-fixture-cc.json');
    expect(r.rows.get('claude-opus-9-0')?.efforts).toBeNull();
    expect(r.rows.get('claude-opus-9-0')?.defaultEffort).toBeNull();
    expect(r.rows.get('claude-haiku-9-1')?.efforts).toEqual([]);
    expect(r.rows.get('claude-haiku-9-1')?.efforts).not.toBeNull();
    // An explicit empty list is "lists none" too, and a "none" thinking type wins over a stray list.
    const e = current('no-row-target.json');
    expect(e.rows.get('claude-sonnet-9-1')?.efforts).toEqual(['low', 'high']);
    const t = parseCatalogueCache(small({}, [
      { id: 'claude-haiku-9-1', thinking: { type: 'none' }, runtime: { effort_levels: ['low'] } },
      { id: 'claude-opus-9-1', runtime: { effort_levels: [] } },
    ]));
    expect(t.format === 'current' && t.rows.get('claude-haiku-9-1')?.efforts).toEqual([]);
    expect(t.format === 'current' && t.rows.get('claude-opus-9-1')?.efforts).toEqual([]);
  });

  it('a row with no display name has label null', () => {
    const r = current('tok-fixture-cc.json');
    expect(r.rows.get('claude-opus-9-0')?.label).toBeNull();
    expect(r.rows.get('claude-opus-9-0')?.minVersion).toBeNull();
    expect(r.rows.get('claude-sonnet-9-1')?.label).toBe('Sonnet 9.1');
  });

  it('a trailing [1m] on a target is stripped by the one reader', () => {
    const r = parseCatalogueCache(small({ provider_alias_targets: { opus: { default: 'claude-opus-9-1[1m]' } } }));
    expect(r.format === 'current' && r.aliasTargets.opus).toBe('claude-opus-9-1');
  });
});

describe('newestCache', () => {
  const at = (iso: string): CacheReading => ({
    format: 'current', fetchedAt: iso, aliasTargets: { haiku: null, sonnet: null, opus: iso, fable: null }, rows: new Map(),
  });

  it('several files: the newest current file, a newer older-format file ignored, null for only older files', () => {
    const a = at('2026-11-01T00:00:00Z');
    const b = at('2026-11-10T00:00:00Z');
    const c = at('2026-11-05T00:00:00Z');
    const older: CacheReading = { format: 'older', fetchedAt: '2026-11-17T00:00:00Z' };
    const bad: CacheReading = { format: 'invalid', why: 'x' };
    expect(newestCache([a, b, c])).toBe(b);
    expect(newestCache([b, a, c])).toBe(b);
    expect(newestCache([a, older, bad, c])).toBe(c);
    expect(newestCache([older, { format: 'older', fetchedAt: null }, bad])).toBeNull();
    expect(newestCache([])).toBeNull();
  });

  it('a tie keeps the first of the tied files', () => {
    const a = at('2026-11-01T00:00:00Z');
    const b = at('2026-11-01T00:00:00Z');
    expect(newestCache([a, b])).toBe(a);
  });
});
