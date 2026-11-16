// Task C15 (D-8111), item 1 (review 1585's leaf module, review 1590 I2 and N-g): the reader of an audit document's
// `heldBy` lives in one leaf L1 module that imports only L0, so `cleanupHeldBy.ts` and `archivedExpiry.ts` no longer
// import each other, and every lane parser takes the reader from the leaf.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { parseFile } from '../scan/parse.js';
import { serverRing } from './ring.js';
import { REPO, walkSrc } from './walkSrc.js';

const LEAF = 'server/src/heldByRead.ts';
const importsOf = (file: string) => parseFile(path.join(REPO, file)).imports;
const specifiers = (file: string): string[] => [...new Set(importsOf(file).map((i) => i.specifier))].sort();

describe('the held-by leaf module', () => {
  it('is L1 and imports only L0', () => {
    expect(serverRing(LEAF).ring).toBe('L1');
    expect(specifiers(LEAF)).toEqual(['../../shared/api.js']);
  });

  it('archivedExpiry.ts no longer imports cleanupHeldBy.ts, so the two do not import each other', () => {
    expect(specifiers('server/src/archivedExpiry.ts')).not.toContain('./cleanupHeldBy.js');
    expect(specifiers('server/src/cleanupHeldBy.ts')).toContain('./archivedExpiry.js');
  });

  it('every lane parser takes the reader and its type from the leaf, and nothing of it from cleanupHeldBy.ts', () => {
    const readers: Record<string, string> = {
      'server/src/archivedExpiry.ts': './heldByRead.js',
      'server/src/collectLane.ts': './heldByRead.js',
      'server/src/coord/childReclaim.ts': '../heldByRead.js',
      'server/src/childReclaimSweep.ts': './heldByRead.js',
    };
    for (const [file, leaf] of Object.entries(readers)) {
      expect(specifiers(file), file).toContain(leaf);
      expect(specifiers(file).filter((s) => /cleanupHeldBy\.js$/.test(s)), file).toEqual([]);
    }
  });

  it('the server declares and imports no heldByRowsOf, so that name is the console reader\'s alone (heldByRowsWords.ts)', () => {
    const spellers = walkSrc({ roots: ['server/src'], min: 170 }).filter((f) => {
      const p = parseFile(path.join(REPO, f));
      return p.symbols.some((x) => x.name === 'heldByRowsOf') || p.imports.some((i) => i.names.includes('heldByRowsOf'));
    });
    expect(spellers).toEqual([]);
    expect(parseFile(path.join(REPO, LEAF)).symbols.map((x) => x.name)).toContain('heldByFieldOf');
  });
});
