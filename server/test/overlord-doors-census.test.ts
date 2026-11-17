// Overlord W1, gates A (plan w1-gates.md Task 1, F8; spec Table 11.2): the door table (`coord/overlordDoors.ts`) against
// the routes files that register the doors. Every row is registered in the file it names; in `coord/overlordRoutes.ts`
// and `continuity/routes.ts` every registration has a row or a `NOT_OVERLORD_DOORS` entry, and never both; the table's
// columns agree with each other (a GET is `view`, a DELETE is not, an operator row is never `operate`).
//
// WHAT THE SCAN CANNOT SEE: a route registered through a helper, a loop or another registrar (`app.route({…})`, a
// `registerX(app)` that is not one of the files named here, a computed path). It reads literal `app.get|post|put|delete(
// '<path>'` calls with the repo's one parser wrapper (`scan/parse.ts`), as the other censuses do. A file outside this list
// that registers an Overlord door is a row naming it, which the "every row is registered there" test then reads.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSource } from './scan/parse.js';
import { OVERLORD_DOORS, NOT_OVERLORD_DOORS, doorRow } from '../src/coord/overlordDoors.js';
import { DOOR_GROUPS, VERB_CLASSES } from '../../shared/overlord-identity.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OVERLORD_ROUTES = 'server/src/coord/overlordRoutes.ts';
const CONTINUITY_ROUTES = 'server/src/continuity/routes.ts';
const LEDGERS_ROUTES = 'server/src/coord/ledgersRoutes.ts';
const FILES = [OVERLORD_ROUTES, CONTINUITY_ROUTES, LEDGERS_ROUTES] as const;
/** Table 11.1d's server words (the later waves' words join here when their pieces land). */
const SERVER_WORDS = ['continuity-v1', 'timers-v1', 'overlord-v1'];
const VERBS = new Set(['get', 'post', 'put', 'delete']);

/** Every literal `app.<verb>('<path>'` registration of a source text, as `METHOD path`. */
export function registrationsOf(text: string, fileName = 'routes.ts'): string[] {
  return parseSource(text, fileName).calls
    .filter((c) => /^app\.(get|post|put|delete)$/.test(c.callee) && c.args[0]?.kind === 'string' && VERBS.has(c.name ?? ''))
    .map((c) => `${(c.name as string).toUpperCase()} ${c.args[0]!.text}`);
}
const sourceOf = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');
const regs: Record<string, string[]> = Object.fromEntries(FILES.map((f) => [f, registrationsOf(sourceOf(f), f)]));
const rowRegistration = (r: { method: string; path: string }): string => `${r.method} ${r.path}`;
const rows = Object.entries(OVERLORD_DOORS);

/** The registrations of a file that neither a row nor an entry names. */
export function unaccounted(file: string, registrations: readonly string[]): string[] {
  const named = new Set<string>([
    ...rows.filter(([, r]) => r.file === file).map(([, r]) => rowRegistration(r)),
    ...Object.entries(NOT_OVERLORD_DOORS).filter(([, e]) => e.file === file).map(([k]) => k),
  ]);
  return registrations.filter((r) => !named.has(r));
}

describe('the door table against the routes files', () => {
  it('the scan finds registrations in each file (a zero would make every other test vacuous)', () => {
    for (const f of FILES) expect(regs[f]!.length, f).toBeGreaterThan(0);
  });
  it('every row is registered in the file it names, and that file is one of the three read here', () => {
    for (const [key, r] of rows) {
      expect(FILES as readonly string[], key).toContain(r.file);
      expect(regs[r.file], key).toContain(rowRegistration(r));
    }
  });
  for (const f of [OVERLORD_ROUTES, CONTINUITY_ROUTES]) {
    it(`${f}: every registration has a row or a NOT_OVERLORD_DOORS entry`, () => {
      expect(unaccounted(f, regs[f]!)).toEqual([]);
    });
  }
  it('a registration is never both a row and a NOT_OVERLORD_DOORS entry', () => {
    const rowRegs = new Set(rows.map(([, r]) => rowRegistration(r)));
    for (const k of Object.keys(NOT_OVERLORD_DOORS)) expect(rowRegs.has(k), k).toBe(false);
  });
  it('every NOT_OVERLORD_DOORS entry is a registration of the file it names, with a reason', () => {
    for (const [k, e] of Object.entries(NOT_OVERLORD_DOORS)) {
      expect(regs[e.file] ?? [], k).toContain(k);
      expect(e.why.length, k).toBeGreaterThan(10);
    }
  });
  it('CONTROL: a planted registration with no row or entry is found, in each of the two files', () => {
    for (const f of [OVERLORD_ROUTES, CONTINUITY_ROUTES]) {
      const planted = `${sourceOf(f)}\napp.post('/api/planted/door', async () => 1);\n`;
      expect(unaccounted(f, registrationsOf(planted, f)), f).toEqual(['POST /api/planted/door']);
    }
  });
});

describe('the table itself', () => {
  it('keys are kebab-case and unique, and doorRow reads each, and throws on one it lacks', () => {
    const keys = rows.map(([k]) => k);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) { expect(k).toMatch(/^[a-z]+(?:-[a-z]+)*$/); expect(doorRow(k)).toBe(OVERLORD_DOORS[k]); }
    expect(() => doorRow('no-such-door')).toThrow();
    expect(() => doorRow('constructor')).toThrow();
  });
  it('the only registration two rows share is card with card-record', () => {
    const by = new Map<string, string[]>();
    for (const [k, r] of rows) by.set(rowRegistration(r), [...(by.get(rowRegistration(r)) ?? []), k]);
    const shared = [...by.values()].filter((ks) => ks.length > 1);
    expect(shared).toEqual([['card', 'card-record']]);
  });
  it('groups and verb classes are words of the vocabulary; an overlord row names one of the server words', () => {
    for (const [k, r] of rows) {
      expect(DOOR_GROUPS, k).toContain(r.group);
      expect(VERB_CLASSES, k).toContain(r.verbClass);
      if (r.group === 'overlord') {
        expect(SERVER_WORDS, k).toContain(r.word);
        expect(['refuse', 'hook'], k).toContain(r.others);
        expect(typeof r.write, k).toBe('boolean');
      }
    }
  });
  it('a GET row is view, a DELETE is never view, and an operator row is never operate', () => {
    for (const [k, r] of rows) {
      if (r.method === 'GET') expect(r.verbClass, k).toBe('view');
      if (r.method === 'DELETE') expect(r.verbClass, k).not.toBe('view');
      if (r.group === 'operator') expect(r.verbClass, k).not.toBe('operate');
    }
  });
  it('the rows on landing are the plan\'s, with the goals ratify door already on main', () => {
    expect(rows.map(([k]) => k)).toEqual([
      'designate', 'retire', 'designation', 'portfolio-rank', 'goals-ratify',
      'card', 'card-record', 'notes-write', 'notes-read', 'handover', 'probe-read', 'probe-answer',
    ]);
  });
});
