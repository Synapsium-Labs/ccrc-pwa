// Overlord W2, request ids A, Task A2 (store layer): the two reads of a request's work, and the census that keeps each
// to one definition and one SQL home.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { sourceOfSymbol } from './scan/symbols.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const build = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-reqid-'), 'coord.db')));
const request = (coord: CoordStore, id: number): number => {
  coord.db.prepare("INSERT INTO overlord_requests (id, origin, summary, state, openedAt) VALUES (?, 'overlord', 'a request', 'received', 1)").run(id);
  return id;
};
const run = (coord: CoordStore, program: string, wave: number, requestId?: number): number =>
  (coord.openRun({ program, title: program, project: 'project-a', wave, waveOf: null, claimedBy: `lane-${program}`,
    ...(requestId === undefined ? {} : { requestId }) }) as { id: number }).id;
const mod = (coord: CoordStore, program: string, requestId?: number): number =>
  coord.addModification(program, { text: 't', ruling: null, itemId: null, pr: null, ...(requestId === undefined ? {} : { requestId }) }, 1);

describe('runsForRequest', () => {
  it("returns the request's runs of that programme in id order, none of another programme or of no request", () => {
    const coord = build();
    const r = request(coord, 1); const other = request(coord, 2);
    const a1 = run(coord, 'a', 1, r);
    run(coord, 'a', 2);            // no request
    run(coord, 'a', 3, other);     // another request
    const b1 = run(coord, 'b', 1, r); // another programme
    const a4 = run(coord, 'a', 4, r);
    const got = coord.runsForRequest(r, 'a');
    expect(got.map((x) => x.id)).toEqual([a1, a4]);
    expect(got.every((x) => x.program === 'a')).toBe(true);
    expect(coord.runsForRequest(r, 'b').map((x) => x.id)).toEqual([b1]);
  });
  it('is [] for a request with no run', () => {
    const coord = build();
    const r = request(coord, 1);
    expect(coord.runsForRequest(r, 'a')).toEqual([]);
  });
});

describe('modificationsForRequest', () => {
  it('counts the same way, 0 for none', () => {
    const coord = build();
    const r = request(coord, 1); const other = request(coord, 2);
    run(coord, 'a', 1); run(coord, 'b', 1);
    mod(coord, 'a', r); mod(coord, 'a', r); mod(coord, 'a'); mod(coord, 'a', other); mod(coord, 'b', r);
    expect(coord.modificationsForRequest(r, 'a')).toBe(2);
    expect(coord.modificationsForRequest(r, 'b')).toBe(1);
    expect(coord.modificationsForRequest(99, 'a')).toBe(0);
  });
});

describe('the request read of runs', () => {
  // The literal WHERE the store uses, copied here; the second assertion keeps the copy from drifting.
  const WHERE = 'WHERE r.requestId = ? AND r.program = ? ORDER BY r.id';
  // Read through the symbol scan (`scan/symbols.ts`), not as raw file text: the literal-pin ratchet counts a raw read.
  const STORE = 'server/src/coord/store.ts';

  it('the store source contains the literal, and EXPLAIN QUERY PLAN of it names runs_request', () => {
    expect(sourceOfSymbol(STORE, 'CoordStore.runsForRequest')).toContain(WHERE);
    const coord = build();
    const plan = (coord.db.prepare(`EXPLAIN QUERY PLAN SELECT r.id FROM runs r JOIN programs p ON p.slug = r.program ${WHERE}`).all(1, 'a') as { detail: string }[])
      .map((r) => r.detail).join('\n');
    expect(plan).toContain('runs_request');
  });

  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []);

  it('runsForRequest and modificationsForRequest are each defined once, as a method or function', () => {
    const files = walk(SRC);
    const defs = (name: string): string[] => files.filter((f) =>
      new RegExp(`^\\s*(export function |public |)${name}\\(`, 'm').test(readFileSync(f, 'utf8'))).map((f) => path.relative(SRC, f)).sort();
    expect(defs('runsForRequest')).toEqual(['coord/store.ts']);
    // ledgersStore's function and the CoordStore delegate beside `addModification`: the delegate is the only other definition.
    expect(defs('modificationsForRequest')).toEqual(['coord/ledgersStore.ts', 'coord/store.ts']);
    // `symbolOf` throws unless the store declares the delegate exactly once.
    expect(sourceOfSymbol(STORE, 'CoordStore.modificationsForRequest')).toMatch(/\{\s*return ledgers\.modificationsForRequest\(this\.db, /);
  });

  it('no file under server/src but store.ts and ledgersStore.ts reads `requestId = ?`', () => {
    // `overlordRequestStore.ts` reads `requestId = ?` of its own tables (the request's citations); what counts is a read
    // of `runs` or `programme_modifications` on the same line as the predicate.
    const near = /\b(runs|programme_modifications)\b[^\n]{0,200}requestId = \?|requestId = \?[^\n]{0,200}\b(runs|programme_modifications)\b/;
    const holders = walk(SRC).filter((f) => near.test(readFileSync(f, 'utf8'))).map((f) => path.relative(SRC, f)).sort();
    expect(holders.filter((h) => h !== 'coord/store.ts' && h !== 'coord/ledgersStore.ts')).toEqual([]);
    expect(holders).toContain('coord/store.ts');
  });
});
