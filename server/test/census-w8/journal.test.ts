// W8's journal-chain census, held two ways (`consolidation-census.test.ts`'s discipline; D-7058; ARCH-73 #808): against
// a FIXTURE tree, so each query counts each shape it claims and passes over the kernel's own lines, a comment and a
// read-only `tx()`; and against the REAL tree, where C8f's moves leave each list empty (2, 3 and 4 at the base
// `fd32f3ecd`, which the PR body prints) while the shapes the queries look for still stand inside the kernel.
// C8g (D-7059) adds `journalFramers` (3 sites in 2 framers at its base, 0 at its tip) and `delegationKernelImports` (0).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO } from '../consolidationCensus.js';
import { mkTmp, removeTmpFixtures } from '../tmpHelpers.js';
import { parsedFile } from '../scan/symbols.js';
import {
  appendBeforeApplySites, appendThenApplyBreaks, delegationKernelImports, epochFloorReaders, journalFloorSites, journalFramers,
} from './journal.js';

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
    expect(epochFloorReaders(t).map((s) => [s.file, s.line])).toEqual([['server/src/a.ts', 2], ['server/src/b/c.ts', 1]]);
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
      '  intent(input: { project: string }, ledger: LedgerLog): void {',
      '    tx(this.db, () => {',
      '      ledger.append([]);',
      "      this.db.prepare('INSERT INTO ledger_alloc (n) VALUES (?)').run(3);",
      '    });',
      '  }',
      '  dollar($log: PoolEdgeLog): void {',
      '    tx(this.db, () => {',
      '      $log.append([]);',
      "      this.db.prepare('DELETE FROM pool_edges').run();",
      '    });',
      '  }',
      '}',
    ].join('\n'));
    expect(appendBeforeApplySites(t).map((s) => [s.line, s.method])).toEqual([
      [4, 'CoordStore.pools'], [11, 'CoordStore.lane'], [20, 'CoordStore.intent'], [26, 'CoordStore.dollar'],
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

describe('appendThenApplyBreaks', () => {
  const store = (body: string): string => tree({ 'server/src/coord/store.ts': body });

  it('names a kernel call outside tx(), a write before the append, an append after a write, and no append', () => {
    const t = store([
      'export class CoordStore {',
      '  bare(log: PoolEdgeLog): number {',
      '    return appendThenApply({',
      '      decide: () => ({ go: 1 }),',
      '      append: (e) => log.append([{ epoch: e }]),',
      "      apply: (e) => { this.db.prepare('UPDATE pool_epoch SET epoch = ?').run(e); return e; },",
      '    });',
      '  }',
      '  rowInDecide(log: PoolEdgeLog): number {',
      '    return tx(this.db, () => appendThenApply({',
      "      decide: () => { this.db.prepare('INSERT INTO pool_edges (pool) VALUES (?)').run('p'); return { go: 1 }; },",
      '      append: (e) => log.append([{ epoch: e }]),',
      '      apply: (e) => e,',
      '    }));',
      '  }',
      '  appendLate(log: PoolEdgeLog): number {',
      '    return tx(this.db, () => appendThenApply({',
      '      decide: () => ({ go: 1 }),',
      '      append: () => undefined,',
      "      apply: (e) => { this.db.prepare('UPDATE pool_epoch SET epoch = ?').run(e); log.append([{ epoch: e }]); return e; },",
      '    }));',
      '  }',
      '  unseen(sink: Writer): number {',
      '    return tx(this.db, () => appendThenApply({',
      '      decide: () => ({ go: 1 }),',
      '      append: (e) => sink.append(e),',
      '      apply: (e) => e,',
      '    }));',
      '  }',
      '}',
    ].join('\n'));
    expect(appendThenApplyBreaks(t).map((s) => [s.line, s.method, s.why])).toEqual([
      [3, 'CoordStore.bare', 'outside-tx'],
      [10, 'CoordStore.rowInDecide', 'write-before-append'],
      [17, 'CoordStore.appendLate', 'write-before-append'],
      [24, 'CoordStore.unseen', 'no-append'],
    ]);
  });

  it('passes a kernel call inside tx() whose append precedes every write, and a tree with no store', () => {
    const t = store([
      'export class CoordStore {',
      '  good(input: { a: string }, journal: CollectLaneJournal): number {',
      '    return tx(this.db, () => appendThenApply({',
      "      decide: () => ({ go: (this.db.prepare('SELECT generation FROM collect_lane_settings').get() as { g: number }).g + 1 }),",
      '      append: (g) => journal.appendGeneration(g),',
      "      apply: (g) => { this.db.prepare('UPDATE collect_lane_settings SET generation = ?').run(g); return g; },",
      '    }));',
      '  }',
      '}',
    ].join('\n'));
    expect(appendThenApplyBreaks(t)).toEqual([]);
    expect(appendThenApplyBreaks(tree({ 'server/src/a.ts': 'export {};\n' }))).toEqual([]);
  });
});

describe('journalFramers (D-7059)', () => {
  it('counts a newline split or lastIndexOf in the four journal files, and only parseCollectLaneJournal in collectLane.ts', () => {
    const t = tree({
      'server/src/coord/mirrorplan.ts': [
        'export function frameRead(data: string) {',
        "  const lastLf = data.lastIndexOf('\\n');",
        "  // data.split('\\n') in a comment is not a call",
        '  return data.slice(0, lastLf + 1).split("\\n");',
        '}',
        "export const other = (s: string) => s.split(',').concat(s.split(/\\r?\\n/));",
      ].join('\n'),
      'server/src/coord/journalparse.ts': "export const one = (s: string) => s.indexOf('\\n') + s.split('\\t').length;\n",
      'server/src/collectLane.ts': [
        "export function stderrLines(err: string) { return err.split('\\n'); }",
        'export function parseCollectLaneJournal(text: string) {',
        "  const records = text.split('\\n');",
        '  return records;',
        '}',
      ].join('\n'),
      'server/src/coord/collectLaneJournal.ts': "export const tailOf = (s: string) => s.lastIndexOf('\\n');\n",
      'server/src/journalKernel.ts': "export const k = (s: string) => s.split('\\n');\n",
      'server/src/coord/elsewhere.ts': "export const e = (s: string) => s.split('\\n');\n",
    });
    expect(journalFramers(t).map((x) => [x.file, x.line, x.method])).toEqual([
      ['server/src/coord/mirrorplan.ts', 2, 'frameRead'],
      ['server/src/coord/mirrorplan.ts', 4, 'frameRead'],
      ['server/src/coord/mirrorplan.ts', 6, '(top level)'],
      ['server/src/collectLane.ts', 3, 'parseCollectLaneJournal'],
      ['server/src/coord/collectLaneJournal.ts', 1, '(top level)'],
    ]);
  });

  it('answers nothing for a tree without the files, or with collectLane.ts lacking the parser', () => {
    expect(journalFramers(tree({ 'server/src/a.ts': 'export {};\n' }))).toEqual([]);
    expect(journalFramers(tree({ 'server/src/collectLane.ts': "export const f = (s: string) => s.split('\\n');\n" }))).toEqual([]);
  });
});

describe('delegationKernelImports (D-7059)', () => {
  it('names each delegation-*.ts import of journalKernel, by any spelling, and passes over other files and imports', () => {
    const t = tree({
      'server/src/coord/delegation-a.ts': "import { appendThenApply } from '../journalKernel.js';\nimport { x } from './y.js';\n",
      'server/src/coord/delegation-b.ts': "import type { JournalPhase } from '../journalKernel';\n",
      'server/src/coord/delegation-c.ts': "import { other } from '../journalKernelFriend.js';\n",
      'server/src/coord/store.ts': "import { appendThenApply } from '../journalKernel.js';\n",
    });
    expect(delegationKernelImports(t).map((x) => [x.file, x.line])).toEqual([
      ['server/src/coord/delegation-a.ts', 1], ['server/src/coord/delegation-b.ts', 1],
    ]);
    expect(delegationKernelImports(tree({ 'server/src/a.ts': 'export {};\n' }))).toEqual([]);
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

  it('every appendThenApply call in store.ts sits inside a tx() and appends before it writes', () => {
    expect(appendThenApplyBreaks()).toEqual([]);
  });

  it('the two journals frame through splitJournalRecords: no hand-rolled framer left (3 sites in 2 framers at the base)', () => {
    expect(journalFramers()).toEqual([]);
  });

  it('no delegation-*.ts file imports the journal kernel', () => {
    expect(delegationKernelImports()).toEqual([]);
  });

  it('the queries are not over nothing: the kernel defines the pieces, and the four writers call appendThenApply', () => {
    const kernel = parsedFile(path.join(REPO, 'server/src/journalKernel.ts'));
    expect(kernel.symbols.map((x) => x.name)).toEqual(expect.arrayContaining(['maxJournalEpoch', 'journalFloor', 'appendThenApply']));
    const calls = parsedFile(path.join(REPO, 'server/src/coord/store.ts')).calls.filter((c) => c.name === 'appendThenApply');
    expect(calls).toHaveLength(4);
  });
});
