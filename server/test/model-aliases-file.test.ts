// Model-class Anthropic arm A2, Task A2.2: the aliases file's format, `parseAliases`, `serializeAliases` and
// `aliasesSourceCause` (shared/model-aliases.mjs), `model-advance-file.test.ts`'s arrangement.
import { describe, it, expect } from 'vitest';
import {
  ALIASES_VERSION, AliasesInvalid, aliasesSourceCause, parseAliases, resolveAliases, serializeAliases,
} from '../../shared/model-aliases.mjs';
import type { AliasRow, Aliases } from '../../shared/model-aliases.mjs';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const ROW: AliasRow = { id: 'claude-opus-9-2', label: 'Opus 9.2', efforts: ['low', 'high'], defaultEffort: 'high', minVersion: '9.2.0' };

/** A complete file from the resolver, with a row, a held row, an unlaunchable id and an orphan to carry every field. */
function example(): Aliases {
  const rows = new Map<string, AliasRow>([
    [ROW.id, ROW], ['claude-opus-9-1', { ...ROW, id: 'claude-opus-9-1', efforts: null, minVersion: null }],
  ]);
  const own = [{
    format: 'current' as const, fetchedAt: '2026-11-18T11:06:40Z',
    aliasTargets: { haiku: null, sonnet: null, opus: 'claude-opus-9-2', fable: null }, rows, skipped: [],
  }];
  const base = {
    own, box: [], launches: [{ class: 'sonnet' as const, id: 'claude-sonnet-9-1', bornAt: '2026-11-18T12:00:00Z' }],
    holds: { opus: { at: '2026-11-17T00:00:00Z', model: 'claude-opus-9-1' } }, saved: { 'claude-opus-9-1': 'max' }, nowMs: NOW,
  };
  // The id is written while the build can launch it; the build then falls below the row's minimum.
  const first = resolveAliases({ ...base, prior: null, laneVersion: '9.2.0' });
  return resolveAliases({ ...base, prior: first, laneVersion: '9.1.0', nowMs: NOW + 3_600_000 });
}
const copy = (): any => JSON.parse(JSON.stringify(example()));

describe('the aliases file', () => {
  it('the example carries every field the resolver writes', () => {
    const o = copy().classes.opus;
    expect(o.unlaunchable).toEqual({ needs: '9.2.0', laneVersion: '9.1.0' });
    expect(o.row).not.toBeNull();
    expect(o.heldRow).not.toBeNull();
    expect(copy().classes.sonnet.source).toBe('use');
  });

  it('a round trip through serializeAliases and parseAliases', () => {
    const a = example();
    const text = serializeAliases(a);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "classes": {');
    expect(parseAliases(JSON.parse(text))).toEqual(JSON.parse(JSON.stringify(a)));
    expect(serializeAliases(parseAliases(JSON.parse(text)))).toBe(text);
    expect(ALIASES_VERSION).toBe(1);
  });

  it('a file with no cache and no ids parses', () => {
    const a = resolveAliases({
      own: [], box: [], launches: [], prior: null, holds: {}, laneVersion: null, saved: {}, nowMs: NOW,
    });
    expect(a.cache).toEqual({ none: 'absent' });
    expect(parseAliases(JSON.parse(serializeAliases(a)))).toEqual(a);
    expect(aliasesSourceCause(parseAliases(JSON.parse(serializeAliases(a))))).toBe('alias-source-absent');
  });

  it('an unknown key is kept, at the top and in a class', () => {
    const j = copy();
    j.future = { a: 1 };
    j.classes.opus.extra = 'kept';
    const a = parseAliases(j);
    expect(a.future).toEqual({ a: 1 });
    expect(a.classes.opus.extra).toBe('kept');
    expect(serializeAliases(a)).toContain('"extra": "kept"');
  });

  it('v: 2 is refused', () => {
    const j = copy(); j.v = 2;
    try { parseAliases(j); throw new Error('not refused'); } catch (e) {
      expect(e).toBeInstanceOf(AliasesInvalid);
      expect((e as AliasesInvalid).field).toBe('v');
    }
  });

  const refuse = (mut: (j: any) => void, field: string): void => {
    const j = copy();
    mut(j);
    let caught: unknown = null;
    try { parseAliases(j); } catch (e) { caught = e; }
    expect(caught, field).toBeInstanceOf(AliasesInvalid);
    expect((caught as AliasesInvalid).field).toBe(field);
    expect((caught as AliasesInvalid).message).toContain(field);
  };

  it('each field is refused by name', () => {
    refuse((j) => { j.at = '2026-11-19T12:00:00.000Z'; }, 'at');
    refuse((j) => { delete j.cache; }, 'cache');
    refuse((j) => { j.cache = { none: 'gone' }; }, 'cache.none');
    refuse((j) => { j.cache = { format: 'newer', fetchedAt: '2026-11-18T11:06:40Z' }; }, 'cache.format');
    refuse((j) => { j.cache = { format: 'current', fetchedAt: null }; }, 'cache.fetchedAt');
    refuse((j) => { j.cache = { format: 'current', fetchedAt: 17 }; }, 'cache.fetchedAt');
    refuse((j) => { j.stale = 'no'; }, 'stale');
    refuse((j) => { delete j.classes; }, 'classes');
    refuse((j) => { j.classes.gpt = j.classes.opus; }, 'classes.gpt');
    refuse((j) => { delete j.classes.fable; }, 'classes.fable');
    refuse((j) => { j.classes.opus.id = 'not an id'; }, 'classes.opus.id');
    refuse((j) => { j.classes.opus.source = 'guess'; }, 'classes.opus.source');
    refuse((j) => { j.classes.opus.evidenceAt = 'yesterday'; }, 'classes.opus.evidenceAt');
    refuse((j) => { j.classes.opus.idSince = 5; }, 'classes.opus.idSince');
    refuse((j) => { j.classes.opus.seenAt = '2026-11-18'; }, 'classes.opus.seenAt');
    refuse((j) => { j.classes.opus.cacheTarget = ''; }, 'classes.opus.cacheTarget');
    refuse((j) => { j.classes.opus.seenId = 3; }, 'classes.opus.seenId');
    refuse((j) => { j.classes.opus.unobserved = null; }, 'classes.opus.unobserved');
    refuse((j) => { j.classes.opus.unlaunchable = 'yes'; }, 'classes.opus.unlaunchable');
    refuse((j) => { j.classes.opus.unlaunchable.needs = 'soon'; }, 'classes.opus.unlaunchable.needs');
    refuse((j) => { j.classes.opus.unlaunchable.laneVersion = 9; }, 'classes.opus.unlaunchable.laneVersion');
    refuse((j) => { j.classes.opus.row = 'x'; }, 'classes.opus.row');
    refuse((j) => { j.classes.opus.row.id = 'bad id'; }, 'classes.opus.row.id');
    refuse((j) => { j.classes.opus.row.label = 4; }, 'classes.opus.row.label');
    refuse((j) => { j.classes.opus.row.efforts = 'high'; }, 'classes.opus.row.efforts');
    refuse((j) => { j.classes.opus.row.efforts = [1]; }, 'classes.opus.row.efforts');
    refuse((j) => { j.classes.opus.row.defaultEffort = 1; }, 'classes.opus.row.defaultEffort');
    refuse((j) => { j.classes.opus.row.minVersion = 'v9'; }, 'classes.opus.row.minVersion');
    refuse((j) => { j.classes.opus.rowFrom = 'elsewhere'; }, 'classes.opus.rowFrom');
    refuse((j) => { j.classes.opus.rowFrom = null; }, 'classes.opus.rowFrom');
    refuse((j) => { j.classes.opus.heldRow = []; }, 'classes.opus.heldRow');
    refuse((j) => { j.classes.opus.orphaned = { id: 'claude-opus-9-1', level: '' }; }, 'classes.opus.orphaned.level');
    refuse((j) => { j.classes.opus.orphaned = { id: 'no good', level: 'max' }; }, 'classes.opus.orphaned.id');
    refuse((j) => { j.classes.opus.orphaned = 'x'; }, 'classes.opus.orphaned');
  });

  it('a top level that is not an object is refused with an empty field', () => {
    for (const bad of [null, 3, 'x', []]) {
      try { parseAliases(bad); throw new Error('not refused'); } catch (e) {
        expect(e).toBeInstanceOf(AliasesInvalid);
        expect((e as AliasesInvalid).field).toBe('');
      }
    }
  });

  it('an older-format cache with an unreadable time parses, a current one needs the time', () => {
    const j = copy(); j.cache = { fetchedAt: null, format: 'older' };
    expect(parseAliases(j).cache).toEqual({ fetchedAt: null, format: 'older' });
  });
});

describe('aliasesSourceCause', () => {
  it('absent when no class has an id, stale when the cache is stale, else null', () => {
    const a = copy();
    expect(aliasesSourceCause(parseAliases(a))).toBeNull();
    a.stale = true;
    expect(aliasesSourceCause(parseAliases(a))).toBe('alias-cache-stale');
    for (const c of Object.keys(a.classes)) a.classes[c].id = null;
    expect(aliasesSourceCause(parseAliases(a))).toBe('alias-source-absent');
  });
});
