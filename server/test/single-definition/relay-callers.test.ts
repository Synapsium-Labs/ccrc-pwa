// THE RELAY'S CALLERS (Overlord W2 relay plan, `docs/superpowers/plans/2026-11-16-overlord-w2/w2-relay.md`, PR A's first part).
// Tasks A1 to A3 ship pure deciders with no production caller: nothing in `server/src` but the relay's own modules imports
// `relayBody.ts`, `relay.ts` or `citedNames.ts`, and nothing but the relay's verdict calls `overlaps.ts#relayFactsOf`. Each
// later task adds its file to `RELAY_CALLERS` in its own pull request:
//   - the relay door's facts and handler (Task A4: `relayFactsInTx` in `coord/relayFacts.ts`, the handler in
//     `coord/overlordRoutes.ts`) are the first callers of `parseRelayBody`, `relayVerdict`, `citedNamesOf`, `renderRelayBody`
//     and `relayPriority`;
//   - the nudge door (Task A5) is the first caller of `parseNudgeBody`;
//   - the operator's requests read (`blockedBy`, overlaps' question 3) builds its facts through `relayFactsOf`.
// The relay's modules also write no log line, so no name the cited words carry can reach one. The census is a pure function
// over parsed files, so a planted file proves each rule fires.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL, rel } from './helpers.js';
import { parseSource, type ParsedFile } from '../scan/parse.js';
import { parsedFile } from '../scan/symbols.js';

/** The relay's own modules: they may import each other. */
const RELAY_MODULES = ['server/src/coord/citedNames.ts', 'server/src/coord/relay.ts', 'server/src/coord/relayBody.ts'];
/** Where `relayFactsOf` lives, and the one module that calls it today. */
const FACTS_HOME = 'server/src/coord/overlaps.ts';
const FACTS_CALLERS = ['server/src/coord/relay.ts'];
/** Each later caller's file. Empty at this tip: nothing is reachable at merge. */
export const RELAY_CALLERS: readonly string[] = [];

/** A relative specifier of `file`, resolved to a repository path with its `.ts` extension. */
const resolve = (file: string, spec: string): string | null =>
  (spec.startsWith('.') ? path.posix.join(path.posix.dirname(file), spec).replace(/\.js$/u, '.ts') : null);

/** Every problem in one parsed file, as one line each. */
function problemsOf(file: string, parsed: Pick<ParsedFile, 'imports' | 'calls'>, callers: readonly string[]): string[] {
  const problems: string[] = [];
  const isRelay = RELAY_MODULES.includes(file);
  if (!isRelay && !callers.includes(file)) {
    for (const edge of parsed.imports) {
      const target = resolve(file, edge.specifier);
      if (target !== null && RELAY_MODULES.includes(target)) problems.push(`${file} imports ${target} and is not in RELAY_CALLERS`);
    }
  }
  for (const c of parsed.calls) {
    if (c.name === 'relayFactsOf' && file !== FACTS_HOME && !FACTS_CALLERS.includes(file) && !callers.includes(file)) {
      problems.push(`${file} calls relayFactsOf and is not in RELAY_CALLERS`);
    }
    if (isRelay && /^console\./u.test(c.callee)) problems.push(`${file} writes a log line (${c.callee})`);
  }
  return problems;
}

const SERVER_SRC = ALL.filter((f) => rel(f).startsWith('server/src/'));

describe('the relay\'s callers (W2 relay A, first part: nothing is reachable at merge)', () => {
  it('no file in server/src but the relay\'s own imports its modules, or calls relayFactsOf, and none of them logs', () => {
    const problems = SERVER_SRC.flatMap((f) => problemsOf(rel(f), parsedFile(f), RELAY_CALLERS));
    expect(problems).toEqual([]);
  });

  it('the relay\'s modules exist, and RELAY_CALLERS names only files that exist', () => {
    const files = new Set(SERVER_SRC.map(rel));
    for (const f of [...RELAY_MODULES, FACTS_HOME, ...FACTS_CALLERS, ...RELAY_CALLERS]) expect(files.has(f), f).toBe(true);
  });

  const DOOR = 'server/src/coord/overlordRoutes.ts';
  const CONTROLS: readonly [string, string, string, readonly string[], RegExp | null][] = [
    ['a door that imports the verdict', DOOR, "import { relayVerdict } from './relay.js';", [], /imports server\/src\/coord\/relay\.ts/],
    ['a door that imports the parser by type only', DOOR, "import type { RelayBody } from './relayBody.js';", [], /imports server\/src\/coord\/relayBody\.ts/],
    ['a door that imports the name match', DOOR, "import { citedNamesOf } from './citedNames.js';", [], /imports server\/src\/coord\/citedNames\.ts/],
    ['a door that calls relayFactsOf', DOOR, "const f = relayFactsOf('programme-a', []);", [], /calls relayFactsOf/],
    ['a relay module that logs', 'server/src/coord/relay.ts', "console.warn('ccrc-server: relay');", [], /writes a log line/],
    ['a listed caller holds', DOOR, "import { relayVerdict } from './relay.js';\nconst f = relayFactsOf('programme-a', []);", [DOOR], null],
    ['the relay importing its body parser holds', 'server/src/coord/relay.ts', "import { isRelayBodyWhy } from './relayBody.js';", [], null],
  ];
  it.each(CONTROLS)('CONTROL: %s', (_name, file, src, callers, red) => {
    const problems = problemsOf(file, parseSource(src), callers);
    if (red === null) expect(problems).toEqual([]);
    else expect(problems.some((p) => red.test(p)), problems.join('\n')).toBe(true);
  });
});
