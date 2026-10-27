// W8's journal-chain census, held two ways (`consolidation-census.test.ts`'s discipline; D-7058; ARCH-73 #808): against
// a FIXTURE tree, so each query counts each shape it claims and passes over the kernel's own lines, a comment and a
// read-only `tx()`; and against the REAL tree, where C8f's moves leave each list empty (2, 3 and 4 at the base
// `fd32f3ecd`, which the PR body prints) while the shapes the queries look for still stand inside the kernel.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO } from '../consolidationCensus.js';
import { mkTmp, removeTmpFixtures } from '../tmpHelpers.js';
import { appendBeforeApplySites, epochFloorReaders, journalFloorSites } from './journal.js';

afterEach(removeTmpFixtures);

const tree = (files: Record<string, string>): string => {
  const t = mkTmp('w8-journal-census-');
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(t, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return t;
};

describe('epochFloorReaders', () => {
  it('counts the epoch regex on a code line, one site per line, and passes over the kernel and comments', () => {
    const t = tree({
      'server/src/a.ts': [
        'export function a(line: string) {',
        '  const m = /"epoch":(\\d+)/.exec(line);',
        '  // the old body read /"epoch":(\\d+)/ too',
        '  return m;',
        '}',
      ].join('\n'),
      'server/src/b/c.ts': 'const r = /"epoch":(\\d+)/; const q = /"epoch":(\\d+)/;\n',
      'server/src/journalKernel.ts': '    const m = /"epoch":(\\d+)/.exec(line);\n',
      'server/src/d.ts': 'const n = /"n":(\\d+)/.exec(line);\n',
    });
    expect(epochFloorReaders(t).map((s) => `${s.file}:${s.line}`)).toEqual(['server/src/a.ts:2', 'server/src/b/c.ts:1']);
  });
});

describe('journalFloorSites', () => {
  it('counts each MAX(file, db) shape, one site per line, and passes over the kernel and comments', () => {
    const t = tree({
      'server/src/coord/store.ts': [
        'const a = (fileMax === null ? dbMax : Math.max(dbMax, fileMax)) + 1;',
        'const b = Math.max(dbMax, fileMax);',
        'const c = fileMax === null ? dbMax : 0;',
        '// fileMax === null ? dbMax : Math.max(dbMax, fileMax)',
        'const d = Math.max(a, b);',
      ].join('\n'),
      'server/src/journalKernel.ts': '  return Math.max(dbMax, fileMax);\n',
    });
    expect(journalFloorSites(t).map((s) => s.line)).toEqual([1, 2, 3]);
  });
});

describe('appendBeforeApplySites', () => {
  const store = (body: string): string => tree({ 'server/src/coord/store.ts': body });

  it('counts each shape: log.append, journal.appendGeneration and a *Log parameter\'s append, before a write', () => {
    const t = store([
      'export class CoordStore {',
      '  pools(input: { a: string }, log: PoolEdgeLog): number {',
      '    return tx(this.db, () => {',
      '      log.append([{ epoch: 1 }]);',
      "      this.db.prepare('UPDATE pool_epoch SET epoch = ?').run(1);",
      '      return 1;',
      '    });',
      '  }',
      '  lane(journal: CollectLaneJournal): void {',
      '    tx(this.db, () => {',
      '      journal.appendGeneration(2);',
      '      this.db.prepare(',
      "        'UPDATE collect_lane_settings SET generation = ? ' +",
      "        'WHERE id = 1',",
      '      ).run(2);',
      '    });',
      '  }',
      '  intent(ledger: LedgerLog): void {',
      '    tx(this.db, () => {',
      '      ledger.append([]);',
      "      this.db.prepare('INSERT INTO ledger_alloc (n) VALUES (?)').run(3);",
      '    });',
      '  }',
      '}',
    ].join('\n'));
    expect(appendBeforeApplySites(t).map((s) => [s.line, s.method])).toEqual([
      [4, 'CoordStore.pools'], [11, 'CoordStore.lane'], [20, 'CoordStore.intent'],
    ]);
  });

  it('passes over a read-only tx(), an append with no write after it, a non-Log parameter, a comment and appendThenApply', () => {
    const t = store([
      'export class CoordStore {',
      '  readOnly(log: PoolEdgeLog): number {',
      "    return tx(this.db, () => (this.db.prepare('SELECT epoch FROM pool_epoch').get() as { e: number }).e + (log.maxEpoch() ?? 0));",
      '  }',
      '  writeFirst(log: PoolEdgeLog): void {',
      '    tx(this.db, () => {',
      "      this.db.prepare('UPDATE pool_epoch SET epoch = 1').run();",
      '      log.append([]);',
      "      this.db.prepare('SELECT 1').get();",
      '    });',
      '  }',
      '  other(list: string[]): void {',
      '    tx(this.db, () => {',
      "      list.append('x');",
      "      this.db.prepare('DELETE FROM pool_edges').run();",
      '    });',
      '  }',
      '  commented(log: PoolEdgeLog): void {',
      '    tx(this.db, () => {',
      '      // log.append([]); then the write',
      "      this.db.prepare('DELETE FROM pool_edges').run();",
      '    });',
      '  }',
      '  kernel(log: PoolEdgeLog): number {',
      '    return tx(this.db, () => appendThenApply({',
      '      decide: () => ({ go: 1 }),',
      '      append: (e) => log.append([{ epoch: e }]),',
      "      apply: (e) => { this.db.prepare('UPDATE pool_epoch SET epoch = ?').run(e); return e; },",
      '    }));',
      '  }',
      '}',
    ].join('\n'));
    expect(appendBeforeApplySites(t)).toEqual([]);
  });

  it('answers nothing for a tree with no store', () => {
    expect(appendBeforeApplySites(tree({ 'server/src/a.ts': 'export {};\n' }))).toEqual([]);
  });
});

describe('the real tree (C8f\'s tip)', () => {
  it('every byte-twin epoch reader hands its text to the kernel: none left (2 at the base)', () => {
    expect(epochFloorReaders()).toEqual([]);
  });

  it('every MAX(file, db) floor is journalFloor: none hand-written (3 at the base)', () => {
    expect(journalFloorSites()).toEqual([]);
  });

  it('every journal-then-row ordering in store.ts is appendThenApply: none hand-written (4 at the base, setCollectLane moved)', () => {
    expect(appendBeforeApplySites()).toEqual([]);
  });

  it('the queries are not over nothing: the kernel holds the shapes, and the four writers call appendThenApply', () => {
    const kernel = readFileSync(path.join(REPO, 'server/src/journalKernel.ts'), 'utf8');
    expect(kernel).toContain('/"epoch":(\\d+)/');
    expect(kernel).toContain('Math.max(dbMax, fileMax)');
    const store = readFileSync(path.join(REPO, 'server/src/coord/store.ts'), 'utf8');
    expect(store.match(/\bappendThenApply</g)?.length).toBe(4);
  });
});
