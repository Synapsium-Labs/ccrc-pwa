// ARCH-42's bound-by census, held two ways (`consolidation-census.test.ts`'s discipline; D-TBD-bound-by-census; plan
// 2026-10-26-arch-42-bindings-of.md): against a FIXTURE tree, so the query counts what it claims and passes over what it
// must not, and against the REAL tree, as a may-only-shrink ceiling that the commit moving each site onto
// `CoordStore.bindingsOf` lowers by one.
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parsedFile } from '../scan/symbols.js';
import { REPO } from '../consolidationCensus.js';
import { BOUND_BY_READERS, boundByCalls, boundBySites, type BoundBySite } from './bindings.js';

/** The real tree's site count, pinned exactly (a ceiling that is also a floor, `run-session-census.test.ts`'s rule): each
 *  move onto `bindingsOf` lowers it in the same commit, and a new site is red until it is moved or justified. */
const BOUND_BY_CEILING = 4;

/** Where each reader is defined, by its qualified name: a rename moves the reader out of the census, and this row says so. */
const READER_HOMES: Readonly<Record<string, readonly [string, string]>> = {
  openRunsForSession: ['server/src/coord/store.ts', 'CoordStore.openRunsForSession'],
  openRunsClaimedBy: ['server/src/coord/bindingReads.ts', 'openRunsClaimedBy'],
  childParentRead: ['server/src/coord/bindingReads.ts', 'childParentRead'],
  sessionRunRead: ['server/src/coord/bindingReads.ts', 'sessionRunRead'],
  claimantsOfSession: ['server/src/coord/bindingReads.ts', 'claimantsOfSession'],
};

const show = (sites: readonly BoundBySite[]): void => {
  console.log(`census bound-by: ${sites.length}\n${sites.map((s) => `  ${s.file} ${s.owner} [${s.readers.join(', ')}]`).join('\n')}`);
};

describe('ARCH-42 bound-by census (D-TBD-bound-by-census)', () => {
  it('FIXTURE: one row per named unit that calls a reader; readers, other reads, comments and tests are not sites', () => {
    const t = mkdtempSync(path.join(tmpdir(), 'w4-bound-by-'));
    try {
      const put = (rel: string, body: string): void => {
        mkdirSync(path.dirname(path.join(t, rel)), { recursive: true });
        writeFileSync(path.join(t, rel), body);
      };
      put('server/src/lane.ts', [
        'export function both(coord: Store, id: string): boolean {',
        '  const w = coord.openRunsForSession(id);',
        '  const again = coord.openRunsForSession(id, 3);',
        '  const c = openRunsClaimedBy(coord, id);',
        '  return w.ok && again.ok && c.ok;',
        '}',
        'export class Lane {',
        '  card(id: string): unknown { return sessionRunRead(this.coord, id, inc); }',
        '  parent(id: string): unknown { return childParentRead(this.coord, id, null, inc); }',
        '}',
        'export const whom = (coord: Store, id: string): string[] => claimantsOfSession(coord, id);',
        'export function history(coord: Store, id: string): unknown {',
        '  // coord.openRunsForSession(id) in a comment is no call',
        '  return [coord.runsNamingSession(id), coord.bindingRunsOf(id), coord.activeClaims(), coord.run(1)];',
        '}',
      ].join('\n'));
      put('server/src/readers.ts', [
        'export function openRunsClaimedBy(port: Port, id: string): unknown { return port.openRunsForSession(id, undefined, undefined, "claimant"); }',
        'export function claimantsOfSession(port: Port, id: string): unknown { return port.bindingRunsOf(id, "ordinal"); }',
      ].join('\n'));
      put('server/test/lane.test.ts', 'it("x", () => { coord.openRunsForSession("a"); });\n');
      const sites = boundBySites(t);
      expect(sites.map((s) => `${s.file} ${s.owner} ${s.readers.join('+')}`)).toEqual([
        'server/src/lane.ts both openRunsForSession+openRunsClaimedBy',
        'server/src/lane.ts Lane.card sessionRunRead',
        'server/src/lane.ts Lane.parent childParentRead',
        'server/src/lane.ts whom claimantsOfSession',
      ]);
      expect(boundByCalls(t)).toHaveLength(6);
    } finally {
      rmSync(t, { recursive: true, force: true });
    }
  });

  it('REAL: the site count is the pinned one', () => {
    const sites = boundBySites(REPO);
    show(sites);
    expect(sites.length).toBe(BOUND_BY_CEILING);
  });

  it('REAL: every reader is still defined where the census looks for it', () => {
    expect(Object.keys(READER_HOMES).sort()).toEqual([...BOUND_BY_READERS].sort());
    for (const [file, name] of Object.values(READER_HOMES)) {
      expect(parsedFile(path.join(REPO, file)).symbols.filter((s) => s.name === name), `${name} in ${file}`).toHaveLength(1);
    }
  });
});
