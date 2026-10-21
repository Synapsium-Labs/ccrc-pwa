// D-6045, stage 2 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0n; ARCH-04 (#545)).
// META-RULE: a may-only-shrink exemption set that has not changed for more than 60 days, and whose reason has not
// been re-dated in that time, is red. An exemption set is a debt with a direction; one that sits unchanged for two
// months has stopped being paid down and stopped being looked at (deviation-refs' GRANDFATHERED sat at 16 from
// 2026-08-24). Each set has a stamp in `exemption-age.data.ts`: its size, held exactly so a change to the set edits
// the stamp, and a reason with the day it was last re-dated. An empty set is never stale.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseFile } from '../scan/parse.js';
import { EXEMPTION_SET_STAMPS, type SetStamp } from './exemption-age.data.js';
import { malformedEntries, type EntrySet } from './exemptions.js';
import { REPO } from './walkSrc.js';

const MAX_AGE_DAYS = 60;

/** Each stamp's problem, as `<id>: what is wrong`; empty when every set is current. */
function staleSets(stamps: Readonly<Record<string, SetStamp>>, sizes: ReadonlyMap<string, number>,
  today: Date): string[] {
  const out: string[] = [];
  const todayMs = Date.parse(today.toISOString().slice(0, 10));
  for (const [id, s] of Object.entries(stamps)) {
    const size = sizes.get(id);
    if (size === undefined) { out.push(`${id}: no such set`); continue; }
    if (size !== s.size) {
      out.push(`${id}: the set has ${size} entries, its stamp says ${s.size}; update the size and re-date the reason`);
      continue;
    }
    const days = Math.floor((todayMs - Date.parse(s.since)) / 86_400_000);
    if (size > 0 && days > MAX_AGE_DAYS) {
      out.push(`${id}: ${size} entries unchanged for ${days} days (since ${s.since}) without a re-dated reason; `
        + 'shrink it, or re-date its reason');
    }
  }
  return out;
}

/** The size of a set: an exported `EntrySet` of a `*.data.ts` module, the array under that key of a `.json` file, or
 *  the elements of a `new Set([...])` (or an array) bound to that name in any other file. */
async function sizeOf(id: string): Promise<number | undefined> {
  const [file, name] = id.split('#') as [string, string];
  const abs = path.join(REPO, file);
  if (file.endsWith('.data.ts')) {
    const mod = (await import(abs)) as Record<string, EntrySet | undefined>;
    return mod[name] === undefined ? undefined : Object.keys(mod[name]).length;
  }
  if (file.endsWith('.json')) {
    const v = (JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>)[name];
    return Array.isArray(v) ? v.length : undefined;
  }
  const init = parseFile(abs).bindings.find((b) => b.name === name)?.init;
  const list = init === undefined ? undefined : /\[([\s\S]*)\]/.exec(init)?.[1];
  if (list === undefined) return undefined;
  return list.match(/'[^']*'|"[^"]*"|\b\d+\b/g)?.length ?? 0;
}

/** Every `*_EXEMPTIONS` export of a `rings/*.data.ts` file, as a stamp id. */
function exemptionSetsOnDisk(): string[] {
  const dir = path.join(REPO, 'server/test/rings');
  const out: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.data.ts')).sort()) {
    const text = parseFile(path.join(dir, f)).text;
    for (const m of text.matchAll(/^export const (\w+_EXEMPTIONS)\b/gm)) out.push(`server/test/rings/${f}#${m[1]}`);
  }
  return out;
}

describe('an exemption set unchanged for more than 60 days needs a re-dated reason (ARCH-04 stage 2, D-6045)', () => {
  it('CONTROL: 61 days is stale, 60 is not, an empty set never is, and a changed set must restamp', () => {
    const today = new Date('2026-10-20T12:00:00Z');
    const stamp = (size: number, since: string): SetStamp => ({ size, reason: 'why', since });
    expect(staleSets({ old: stamp(3, '2026-08-20'), edge: stamp(3, '2026-08-21'), empty: stamp(0, '2025-01-01'),
      moved: stamp(4, '2026-10-20'), gone: stamp(1, '2026-10-20') },
    new Map([['old', 3], ['edge', 3], ['empty', 0], ['moved', 3]]), today)).toEqual([
      'old: 3 entries unchanged for 61 days (since 2026-08-20) without a re-dated reason; shrink it, or re-date its reason',
      'moved: the set has 3 entries, its stamp says 4; update the size and re-date the reason',
      'gone: no such set',
    ]);
  });

  it('CONTROL: a set is measured from its module, or from its literal in any other file', async () => {
    expect(await sizeOf('server/test/rings/outward-edges.data.ts#OUTWARD_EDGE_EXEMPTIONS')).toBeGreaterThan(0);
    expect(await sizeOf('server/test/deviation-refs.test.ts#GRANDFATHERED')).toBeGreaterThan(0);
    expect(await sizeOf('server/test/deviation-refs.test.ts#NO_SUCH_SET')).toBeUndefined();
    // A `.json` list (the growth check's, D-6211) is measured by its named array: a committed fixture with two
    // entries, so the arm's count is pinned for a non-empty list; the live list stays under the stamp rule below.
    expect(await sizeOf('server/test/fixtures/growth-exemptions/two-entries.json#exemptions')).toBe(2);
    expect(await sizeOf('server/test/fixtures/growth-exemptions/two-entries.json#no_such_key')).toBeUndefined();
    expect(exemptionSetsOnDisk()).toContain('server/test/rings/shared-imports.data.ts#SHARED_IMPORT_EXEMPTIONS');
  });

  it('every exemption set under rings/ has a stamp, and every stamp a one-line reason and a real date', () => {
    expect(exemptionSetsOnDisk().filter((id) => !(id in EXEMPTION_SET_STAMPS)), 'an exemption set without a stamp: '
      + 'add one to exemption-age.data.ts').toEqual([]);
    expect(malformedEntries(EXEMPTION_SET_STAMPS)).toEqual([]);
  });

  it('no stamped set is stale, and every stamp holds its set\'s size', async () => {
    const sizes = new Map<string, number>();
    for (const id of Object.keys(EXEMPTION_SET_STAMPS)) {
      const n = await sizeOf(id);
      if (n !== undefined) sizes.set(id, n);
    }
    expect(staleSets(EXEMPTION_SET_STAMPS, sizes, new Date())).toEqual([]);
  });
});
