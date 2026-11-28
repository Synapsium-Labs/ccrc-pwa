// THE ACT WRITERS' CALLERS (Overlord W2, act rows A; the coordinator's item 3). At merge nothing in production calls the act
// writers: the act journal implements their port and its piece wires the first door. So `writeActInTx` and `settleActInTx` have no
// caller and no reference in `server/src` outside their own file. A door that calls one is a later piece's, which replaces this
// pin with the census of Task A6 (every call passes the allow its door's decider answered).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALL, rel } from './single-definition/helpers.js';
import { parseSource, type ParsedFile } from './scan/parse.js';
import { parsedFile } from './scan/symbols.js';

const STORE = 'server/src/coord/overlordActsStore.ts';
const WRITERS = ['writeActInTx', 'settleActInTx'] as const;
const NAMED = new RegExp(`\\b(?:${WRITERS.join('|')})\\b`);

function problemsOf(file: string, parsed: Pick<ParsedFile, 'calls'>, text: string): string[] {
  if (file === STORE) return [];
  const calls = parsed.calls.filter((c) => (WRITERS as readonly string[]).includes(c.name ?? c.callee)).map((c) => `${file} calls ${c.name ?? c.callee}`);
  return calls.length > 0 ? calls : NAMED.test(text) ? [`${file} names an act writer`] : [];
}

const SERVER_SRC = ALL.filter((f) => rel(f).startsWith('server/src/'));

describe('the act writers have no caller outside their own file and the tests (item 3)', () => {
  it('no file of server/src but the store calls or names writeActInTx or settleActInTx', () => {
    expect(SERVER_SRC.map(rel)).toContain(STORE);
    expect(SERVER_SRC.length).toBeGreaterThan(200);
    expect(SERVER_SRC.flatMap((f) => problemsOf(rel(f), parsedFile(f), readFileSync(f, 'utf8')))).toEqual([]);
  });
  it('the store itself defines both', () => {
    const src = readFileSync(SERVER_SRC.find((f) => rel(f) === STORE)!, 'utf8');
    for (const w of WRITERS) expect(src).toMatch(new RegExp(`export function ${w}\\(`));
  });
  const F = 'server/src/coord/overlordRoutes.ts';
  it.each([
    ['a call', 'writeActInTx(db, journal, w, at);', /calls writeActInTx/],
    ['a settle call', "settleActInTx(db, journal, 1, 'done', 'door', at);", /calls settleActInTx/],
    ['a reference passed on', 'const go = { write: settleActInTx };', /names an act writer/],
    ['an unrelated name', 'writeActInTxLater(db);', null],
  ] as const)('CONTROL: %s', (_n, src, red) => {
    const p = problemsOf(F, parseSource(`function f() { ${src} }`), src);
    if (red === null) expect(p).toEqual([]);
    else expect(p.some((x) => red.test(x)), p.join('\n')).toBe(true);
  });
});
