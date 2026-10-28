// ARCH-08b (D-5969, #534): the FleetIO seam's failure contract, stated where a caller reads it.
//   - Every member of `FleetIO` (`src/io.ts`) carries a docstring with a `Failure contract:` line: what the member
//     answers when the read cannot be taken, and whether it can reject. A `// null on ANY failure` trailing comment is
//     not enough, because it is the line the folds below were written against.
//   - `readFileB64` is gone: it had no callers, and its `null` folded three conditions into one.
//   - The plain, collapsing `io.readdir(` may only lose call sites. A new listing whose failure decides anything reads
//     `readdirMeasured`, which tells an absent directory from an unreadable one.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(import.meta.dirname, '..', 'src');

/** The body of `export interface FleetIO { … }`, up to its closing brace at column 0. */
const fleetIoBody = (): string => {
  const text = readFileSync(path.join(SRC, 'io.ts'), 'utf8');
  const from = text.indexOf('export interface FleetIO {');
  expect(from, 'the FleetIO interface').toBeGreaterThan(-1);
  const to = text.indexOf('\n}\n', from);
  expect(to, 'its closing brace').toBeGreaterThan(from);
  return text.slice(from, to);
};

/** Each member's name, in declaration order: a line indented two spaces that opens a call signature. */
const members = (body: string): string[] => [...body.matchAll(/^ {2}(\w+)\(/gm)].map((m) => m[1]!);

/** Each member's docstring: the `/** … *\/` block that ends right above its signature, whitespace only between. */
const docs = (body: string): Map<string, string> =>
  new Map([...body.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*)\*\/[ \t]*\n {2}(\w+)\(/g)].map((m) => [m[2]!, m[1]!]));

describe('FleetIO — every member states its failure contract (D-5969)', () => {
  it('reads the members it is meant to read', () => {
    expect(members(fleetIoBody())).toEqual([
      'readFileMeasured', 'readFile', 'readFileFromMeasured', 'readFileFrom', 'readFileFromBytesMeasured',
      'readFileB64Measured', 'readdirMeasured', 'readdir', 'statMeasured', 'stat', 'lstatMeasured', 'realpath',
      'writeFileB64', 'tailFile', 'statfsMeasured', 'pressureMeasured',
    ]);
  });

  it('every member carries a docstring with a "Failure contract:" line', () => {
    const body = fleetIoBody();
    const doc = docs(body);
    const missing = members(body).filter((m) => !/Failure contract:/.test(doc.get(m) ?? ''));
    expect(missing, 'members whose docstring states no failure contract').toEqual([]);
  });

  it('readFileB64, which no caller used, is not a member', () => {
    expect(members(fleetIoBody())).not.toContain('readFileB64');
  });
});

/** Every `.ts` file under `src/`. */
const sources = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
});

/** The plain `io.readdir(` call sites, as measured when the five coord folds moved to `readdirMeasured` (D-5969). It
 *  may only go DOWN: migrate a site and lower it. Lowered to the measured count, 39, when each sleep lane's act-time
 *  listing (D-7047) was wired through `readdirMeasured` rather than added here. */
const PLAIN_READDIR_CEILING = 39;

describe('the plain io.readdir ratchet (D-5969)', () => {
  it(`has at most ${PLAIN_READDIR_CEILING} call sites under src/`, () => {
    const hits = sources(SRC).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\bio\.readdir\(/g)]
      .map(() => path.relative(SRC, f)));
    expect(hits.length, `plain io.readdir( sites: ${[...new Set(hits)].join(', ')}`).toBeLessThanOrEqual(PLAIN_READDIR_CEILING);
  });

  it('none of the five coord folds reads the plain listing', () => {
    for (const f of ['collectTempRoot.ts', 'endDeadCoordinator.ts', 'expireArchived.ts']) {
      expect(readFileSync(path.join(SRC, 'coord', f), 'utf8'), f).not.toMatch(/\bio\.readdir\(/);
    }
  });
});
