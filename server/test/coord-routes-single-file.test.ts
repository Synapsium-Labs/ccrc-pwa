// Route-parity's ground truth (build 9 D17). `coordinator-skill.test.ts:158`
// scans coord/routes.ts ONLY, matching app.(get|post)( — so a coordination
// route registered in another file, or under another verb, would be
// registered and NAMED NOWHERE: invisible to the corpus linkage in both
// directions. This suite closes both holes, with the coverage floor that
// keeps a scan over nothing from proving nothing. Release is
// POST /api/claims/:id/release; there is NO DELETE on this surface, ever.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', 'src');
const COORD_ROUTES = path.join('coord', 'routes.ts');

/** The coordination surface by path prefix. `/api/fleet` is NOT here — it is
 *  server.ts's own read and always was; `/api/feed` and `/api/lifecycle` are
 *  coord.db reads and are. */
const COORD_PREFIXES = ['/api/mail', '/api/runs', '/api/coord', '/api/feed',
  '/api/lifecycle', '/api/peers', '/api/claims', '/api/ledger'];

/** Every Fastify shorthand, all five verbs — a DELETE added tomorrow must be
 *  swept, not silently skipped (auth-gate.test.ts:72's own rule). */
const REG_RE = /app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

interface Reg { file: string; verb: string; routePath: string }
const registrations = (): Reg[] => {
  const out: Reg[] = [];
  for (const f of walk(SRC).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(REG_RE)) {
      out.push({ file: path.relative(SRC, f), verb: m[1]!, routePath: m[2]! });
    }
  }
  return out;
};

const isCoord = (p: string): boolean => COORD_PREFIXES.some((pre) => p.startsWith(pre));

describe('all coordination routes live in coord/routes.ts (D17)', () => {
  it('no file but coord/routes.ts registers a coordination path', () => {
    const strays = registrations()
      .filter((r) => isCoord(r.routePath) && r.file !== COORD_ROUTES)
      .map((r) => `${r.file}: app.${r.verb}('${r.routePath}')`);
    expect(strays, 'coordinator-skill.test.ts scans coord/routes.ts ONLY — a route here is ' +
      'named nowhere').toEqual([]);
  });

  it('coord/routes.ts registers with get and post ONLY — release is a POST, not a DELETE', () => {
    const verbs = registrations().filter((r) => r.file === COORD_ROUTES).map((r) => r.verb);
    expect(verbs.every((v) => v === 'get' || v === 'post'),
      `the parity scanner's regex knows only get/post; found: ${verbs.join(',')}`).toBe(true);
    // Belt and braces: neither the longhand app.route nor a DELETE on a
    // coordination path anywhere in server/src.
    const src = readFileSync(path.join(SRC, COORD_ROUTES), 'utf8');
    expect(src.includes('app.route(')).toBe(false);
    expect(src.includes("'DELETE'")).toBe(false);
    const deletes = registrations().filter((r) => r.verb === 'delete' && isCoord(r.routePath));
    expect(deletes).toEqual([]);
  });

  it('the scanner-coverage floor: it found the file, and at least the wave-7 route count', () => {
    const coord = registrations().filter((r) => r.file === COORD_ROUTES);
    // 21 = the 14 pre-build-9b registrations + wave 7's seven. A floor, not an
    // exact pin — auth-gate.test.ts:194 owns the exact number — so this suite
    // does not double-edit on every future route, but a scanner that quietly
    // stopped matching SOME registrations still reds here.
    expect(coord.length).toBeGreaterThanOrEqual(21);
    // ...and the specific seven this build added, so the floor cannot be met
    // by the old routes alone:
    const paths = coord.map((r) => `${r.verb.toUpperCase()} ${r.routePath}`);
    for (const r of ['GET /api/peers', 'POST /api/claims', 'POST /api/claims/:id/release',
      'POST /api/claims/:id/break', 'GET /api/claims', 'POST /api/ledger/deviations',
      'GET /api/ledger']) {
      expect(paths, `${r} was not found by the scanner`).toContain(r);
    }
  });
});
