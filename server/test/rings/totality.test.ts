// ARCH-04 (#545), stage 4. TOTALITY: every non-test file under `server/src` and `pwa/src` has exactly one ring and
// exactly one context. The ring is `ring.ts`'s `serverRing` or `pwaRing` (the 08-10 spec's rules, from the file's own
// imports, timers and header); the context is the row of the spec's own context table (`ringContextMap.ts` reads the
// block between its `ring-context-map` markers), by the spec's rule: a file row beats the directory row, directory
// rows do not nest, two rows never name one file. A new file in a directory with no row (`screens/`, `stores/`,
// `remote/`, the top level of each package) needs a file row in the spec's table in the same PR; a row that names no
// file is stale and is deleted. The contexts are ARCH-34's vocabulary (`CCD_CONTEXTS`). No exemption set: the table
// is the override map, and every row in it is a reason written in the spec.
import { describe, expect, it } from 'vitest';
import { CCD_CONTEXTS } from '../consolidationCensus.js';
import { pwaRing, serverRing, type Ring } from './ring.js';
import {
  assignContexts, fileRowNames, parseContextTable, readContextTable, type ContextRow,
} from './ringContextMap.js';
import { walkSrc } from './walkSrc.js';

const SERVER_FILES = (): string[] => walkSrc({ roots: ['server/src'], min: 150 });
const PWA_FILES = (): string[] => walkSrc({ roots: ['pwa/src'], min: 250, extensions: /\.(?:ts|tsx|mjs|css)$/ });
const srcRel = (pkg: 'server' | 'pwa', f: string): string => f.slice(`${pkg}/src/`.length);

const TABLE = [
  '<!-- ring-context-map:start -->',
  '| Context | `server/src` | `pwa/src` |',
  '|---|---|---|',
  '| C1 Fleet | `accounts/**`, `fleet.ts`, `coord/placement.ts` | `fleet/**`, `lib/acc*.ts` |',
  '| C2 Mutation | `exec.ts` | (none) |',
  '| K Kernels | `index.ts` | `main.tsx`, `lib/**` |',
  '<!-- ring-context-map:end -->',
].join('\n');

describe('the context table (ARCH-04 stage 4)', () => {
  it('CONTROL: the parser reads file rows, directory rows and (none), and a missing block throws', () => {
    const rows = parseContextTable(TABLE);
    expect(rows.map((r) => `${r.context} ${r.pkg} ${r.pattern}${r.dir ? ' dir' : ''}`)).toEqual([
      'C1 server accounts/** dir', 'C1 server fleet.ts', 'C1 server coord/placement.ts',
      'C1 pwa fleet/** dir', 'C1 pwa lib/acc*.ts',
      'C2 server exec.ts', 'K server index.ts', 'K pwa main.tsx', 'K pwa lib/** dir',
    ]);
    expect(() => parseContextTable('no table here')).toThrow(/no ring-context-map block/);
    expect(() => parseContextTable(TABLE.replace('| K Kernels', '| K2 Kernels'))).not.toThrow();
  });

  it('CONTROL: a `*` stays inside one path segment, and a `.` is literal', () => {
    expect(fileRowNames('lib/acc*.ts', 'lib/accounts.ts')).toBe(true);
    expect(fileRowNames('lib/acc*.ts', 'lib/sub/accounts.ts')).toBe(false);
    expect(fileRowNames('lib/acc*.ts', 'lib/accounts.tsx')).toBe(false);
    expect(fileRowNames('fleet/Archive*.tsx', 'fleet/ArchiveSheet.tsx')).toBe(true);
    expect(fileRowNames('a.ts', 'aXts')).toBe(false);
  });

  it('CONTROL: the assignment gives a file row precedence and reports each way the table can fail', () => {
    const rows = parseContextTable(TABLE);
    const ok = assignContexts('server', ['accounts/x.ts', 'accounts/deep/y.ts', 'coord/placement.ts', 'exec.ts', 'index.ts'], rows);
    expect(ok.unmapped).toEqual([]);
    expect(ok.ambiguous).toEqual([]);
    expect([...ok.context]).toEqual([
      ['accounts/x.ts', 'C1'], ['accounts/deep/y.ts', 'C1'], ['coord/placement.ts', 'C1'], ['exec.ts', 'C2'], ['index.ts', 'K'],
    ]);
    // A planted file in a directory with no row is unmapped (the red this rule exists for).
    expect(assignContexts('server', ['screens/new.ts'], rows).unmapped).toEqual(['screens/new.ts']);
    // A stale row: it names no file.
    expect(assignContexts('server', ['exec.ts'], rows).deadRows).toContain('C1 `fleet.ts`');
    // Two file rows naming one file.
    const two: ContextRow[] = [...rows, { context: 'C2', pkg: 'server', pattern: 'fleet.*', dir: false }];
    expect(assignContexts('server', ['fleet.ts'], two).ambiguous).toHaveLength(1);
    // Two directory rows covering one file, and a directory row under another.
    const dirs: ContextRow[] = [...rows, { context: 'C2', pkg: 'server', pattern: 'accounts/deep/**', dir: true }];
    const nested = assignContexts('server', ['accounts/deep/y.ts'], dirs);
    expect(nested.ambiguous).toHaveLength(1);
    expect(nested.nested).toEqual(['`accounts/deep/**` under `accounts/**`']);
    // A pattern written twice.
    const dup: ContextRow[] = [...rows, { context: 'C2', pkg: 'server', pattern: 'exec.ts', dir: false }];
    expect(assignContexts('server', ['exec.ts'], dup).duplicateRows).toEqual(['`exec.ts`']);
  });

  it('the spec holds each of the ten contexts, once and in order, and every row names a known context', () => {
    const rows = readContextTable();
    const order = [...new Set(rows.map((r) => r.context))];
    expect(order).toEqual([...CCD_CONTEXTS]);
  });
});

describe('every non-test file under server/src and pwa/src has one ring and one context (ARCH-04 stage 4)', () => {
  it('the walk reaches at least 400 files across the two packages', () => {
    expect(SERVER_FILES().length + PWA_FILES().length).toBeGreaterThanOrEqual(400);
  });

  for (const [pkg, files] of [['server', SERVER_FILES], ['pwa', PWA_FILES]] as const) {
    it(`${pkg}/src: every file takes exactly one context from the spec's table, and the table has no stale or nested row`, () => {
      const a = assignContexts(pkg, files().map((f) => srcRel(pkg, f)), readContextTable());
      expect(a.unmapped, 'no row reaches these: add a file row to the spec\'s ring-context-map table in this PR').toEqual([]);
      expect(a.ambiguous, 'two rows name one file: the spec lets exactly one').toEqual([]);
      expect(a.nested, 'directory rows do not nest').toEqual([]);
      expect(a.duplicateRows, 'a pattern written twice').toEqual([]);
      expect(a.deadRows, 'a row that names no file is stale: delete it').toEqual([]);
    });
  }

  it('server/src: every file takes exactly one ring, L1 to L5, and index.ts alone is the composition root', () => {
    const rings = new Map<string, Ring>(SERVER_FILES().map((f) => [f, serverRing(f).ring]));
    expect([...rings].filter(([, r]) => r === 'L0' || r === undefined), 'server/src holds no L0 file').toEqual([]);
    expect([...rings].filter(([, r]) => r === 'L5').map(([f]) => f)).toEqual(['server/src/index.ts']);
    for (const r of ['L1', 'L2', 'L3', 'L4'] as const) {
      expect([...rings.values()].includes(r), `no server file is ${r}: the classifier has gone stale`).toBe(true);
    }
  });

  it('pwa/src: every file takes exactly one ring, L1 to L5, and main.tsx alone is the composition root', () => {
    const rings = new Map<string, Ring>(PWA_FILES().map((f) => [f, pwaRing(f).ring]));
    expect([...rings].filter(([, r]) => r === 'L0' || r === undefined), 'pwa/src holds no L0 file').toEqual([]);
    expect([...rings].filter(([, r]) => r === 'L5').map(([f]) => f)).toEqual(['pwa/src/main.tsx']);
    for (const r of ['L1', 'L2', 'L3', 'L4'] as const) {
      expect([...rings.values()].includes(r), `no pwa file is ${r}: the classifier has gone stale`).toBe(true);
    }
    expect([...rings].filter(([f]) => f.endsWith('.css')).filter(([, r]) => r !== 'L4'), 'a .css file is L4').toEqual([]);
  });
});
