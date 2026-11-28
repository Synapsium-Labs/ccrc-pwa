// THE REQUEST MOVE'S CALL SITES (Overlord W2, plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-requests.md Task A3, F8).
// Every call of `planRequestMoveInTx` or `planRequestInsertInTx` in `server/src` passes its `actor` as a LITERAL, and that literal is
// the one its file's door group may pass: the Overlord's routes only `'overlord'`, the coordinator doors only `'owner'`, the
// operator's doors only `'operator'`, the lane modules only `'server'`. An actor that is not a literal is red, and so is a call
// from a file with no row. Today nothing calls either (the record writes no row until a door exists), so the census holds with
// an empty map; each later piece adds its file's row in its own pull request. The store's own apply re-runs its plan with the
// input it was given, so the store file is the one exemption.
import { describe, expect, it } from 'vitest';
import { ALL, rel } from './helpers.js';
import { parseSource, type CallSite, type ParsedFile } from '../scan/parse.js';
import { parsedFile } from '../scan/symbols.js';
import type { RequestActor } from '../../../shared/overlordRequests.js';

const STORE = 'server/src/coord/overlordRequestStore.ts';
const PLANNERS = ['planRequestMoveInTx', 'planRequestInsertInTx'] as const;

/** Each calling file's allowed literal actors. Empty in request record A: the doors and lanes add their rows. */
export const REQUEST_MOVE_CALLERS: Readonly<Record<string, readonly RequestActor[]>> = {};

const ACTOR = /\bactor\s*:\s*'([a-z-]+)'/;

/** Every problem with the planner calls of one parsed file, as one line each. */
function callerProblems(file: string, parsed: Pick<ParsedFile, 'calls'>, callers: typeof REQUEST_MOVE_CALLERS): string[] {
  if (file === STORE) return [];
  const problems: string[] = [];
  for (const c of parsed.calls.filter((x: CallSite) => (PLANNERS as readonly string[]).includes(x.name ?? ''))) {
    const allowed = callers[file];
    if (allowed === undefined) { problems.push(`${file} calls ${c.name} and has no REQUEST_MOVE_CALLERS row`); continue; }
    const arg = c.args[1]?.text ?? '';
    const m = ACTOR.exec(arg);
    if (m === null) { problems.push(`${file}: ${c.name}'s actor is not a literal: ${arg}`); continue; }
    if (!(allowed as readonly string[]).includes(m[1]!)) problems.push(`${file}: ${c.name} passes actor '${m[1]}', its row allows [${allowed.join(', ')}]`);
  }
  return problems;
}

const SERVER_SRC = ALL.filter((f) => rel(f).startsWith('server/src/'));

describe('the request move\'s call sites (W2 request record A, F8)', () => {
  it('every planner call in server/src passes a literal actor its file\'s row allows', () => {
    const problems = SERVER_SRC.flatMap((f) => callerProblems(rel(f), parsedFile(f), REQUEST_MOVE_CALLERS));
    expect(problems).toEqual([]);
  });

  it('every row names a file that exists', () => {
    const files = new Set(SERVER_SRC.map(rel));
    for (const f of Object.keys(REQUEST_MOVE_CALLERS)) expect(files.has(f), f).toBe(true);
  });

  const F = 'server/src/coord/overlordRoutes.ts';
  const CONTROLS: readonly [string, string, typeof REQUEST_MOVE_CALLERS, RegExp | null][] = [
    ['a caller with no row', "planRequestMoveInTx(db, { id, move: 'drop', actor: 'overlord' });", {}, /has no REQUEST_MOVE_CALLERS row/],
    ['an actor that is not a literal', 'planRequestMoveInTx(db, { id, move, actor: who });', { [F]: ['overlord'] }, /actor is not a literal/],
    ['the wrong literal', "planRequestInsertInTx(db, { summary, actor: 'operator' });", { [F]: ['overlord'] }, /passes actor 'operator'/],
    ['the right literal holds', "planRequestMoveInTx(db, { id, move: 'drop', actor: 'overlord' });", { [F]: ['overlord'] }, null],
  ];
  it.each(CONTROLS)('CONTROL: %s', (_name, src, callers, red) => {
    const problems = callerProblems(F, parseSource(`function f() { ${src} }`), callers);
    if (red === null) expect(problems).toEqual([]);
    else expect(problems.some((p) => red.test(p)), problems.join('\n')).toBe(true);
  });
});
