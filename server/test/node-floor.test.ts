// The Node floor stops being prose here. `node:sqlite` is a built-in whose
// availability is version-sensitive — it shipped behind `--experimental-sqlite`
// and stopped needing the flag in a later 22.x — and `server/src/coord/db.ts`
// imports it unconditionally, so a box or a CI leg below the floor does not
// degrade, it fails to boot.
//
// THREE assertions, and the third is the one that matters: the first two pin
// the DECLARATION (all three packages agree, and they say a number), the third
// pins the FACT (this interpreter can actually do it). If they ever disagree,
// the declaration is what moves — see the plan's deviation D-6. Do not "fix" a
// red third assertion by lowering `engines`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGES = ['server', 'agent', 'pwa'];

const enginesOf = (pkg: string): string | undefined => {
  const j = JSON.parse(readFileSync(path.join(root, pkg, 'package.json'), 'utf8')) as
    { engines?: { node?: string } };
  return j.engines?.node;
};

/** `>=22.13.0` -> [22, 13, 0]. Deliberately understands ONE range form: the
 *  moment someone writes `^22 || >=24` this parser must fail loudly rather than
 *  silently accept a floor it did not understand. */
const floorOf = (range: string): [number, number, number] => {
  const m = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  expect(m, `engines.node must be a single '>=x.y.z' range, got ${JSON.stringify(range)}`).not.toBeNull();
  return [Number(m![1]), Number(m![2]), Number(m![3])];
};

describe('the node floor', () => {
  it('is declared in all three package.jsons, identically', () => {
    const ranges = PACKAGES.map((p) => [p, enginesOf(p)] as const);
    for (const [p, r] of ranges) expect(r, `${p}/package.json has no engines.node`).toBeTruthy();
    expect(new Set(ranges.map(([, r]) => r)).size,
      `the three packages declare different floors: ${JSON.stringify(ranges)}`).toBe(1);
  });

  it('is satisfied by the interpreter running this suite', () => {
    const [maj, min, pat] = floorOf(enginesOf('server')!);
    const [rMaj, rMin, rPat] = process.version.slice(1).split('.').map(Number) as [number, number, number];
    const ok = rMaj > maj || (rMaj === maj && (rMin > min || (rMin === min && rPat >= pat)));
    expect(ok, `running ${process.version}, floor is ${enginesOf('server')}`).toBe(true);
  });

  it('can import node:sqlite and construct a DatabaseSync — the reason the floor exists', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE probe (a INTEGER)');
    db.prepare('INSERT INTO probe VALUES (?)').run(1);
    expect((db.prepare('SELECT count(*) AS c FROM probe').get() as { c: number }).c).toBe(1);
    db.close();
  });
});
