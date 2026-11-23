// D-8808, D-8809 (linear-hierarchy wave 8, `w8-linking-measurement-record`): the team doors' refusal words have ONE owner,
// `TEAM_SUGGEST_REFUSALS` and `TEAM_CONFIRM_REFUSALS` (`shared/linking.ts`). Each door answers through its own typed refuser
// (`refuseSuggest`, `refuseConfirm` in `routes.ts`), so a word outside its list is a compile error; this file holds the other
// direction, read from the handler's parsed calls (`scan/symbols.ts`), never from its text: every word the list names is one
// the handler can answer, and the handler reaches no refusal past its refuser except the words it passes through from the box
// token and the attribution check. Its width: it counts calls of `refuseSuggest`, `refuseConfirm` and `refuseRoute` by name,
// so an inline `reply.code(n).send(...)` (which `refusal-status.test.ts` ratchets), another helper or an alias is not seen;
// and a decider's answer is read as the words its declared return type names, not the ones its body returns. The guides read the same lists (`coordinator-plan-reference.test.ts` for the suggest
// door, `overlord-skill.test.ts` for the confirm door), so a word added here reds the guide that does not name it.
import { describe, expect, it } from 'vitest';
import { TEAM_CONFIRM_REFUSALS, TEAM_SUGGEST_REFUSALS } from '../../shared/linking.js';
import { callsIn, sourceOfSymbol, symbolOf } from './scan/symbols.js';
import type { CallSite } from './scan/parse.js';

const ROUTES = 'server/src/linking/routes.ts';
const POLICY = 'server/src/linking/policy.ts';

/** A refuser argument that is a decider's answer, read as the words that decider's declared return type names. */
const DECIDED: Readonly<Record<string, { symbol: string; field: 'error' | 'word' }>> = {
  'pair.error': { symbol: 'teamPairVerdict', field: 'error' },
  'standing.error': { symbol: 'suggesterVerdict', field: 'error' },
  'text.word': { symbol: 'suggestionReasonVerdict', field: 'word' },
};

/** The words a decider's declared return type names in `field` (`error: 'a' | 'b'`). */
function declaredWords(symbol: string, field: 'error' | 'word'): string[] {
  const m = new RegExp(`${field}: ((?:'[a-z-]+'(?: \\| )?)+)`).exec(sourceOfSymbol(POLICY, symbol));
  expect(m, `${symbol} declares no ${field} words`).toBeTruthy();
  return [...m![1]!.matchAll(/'([a-z-]+)'/g)].map((x) => x[1]!);
}

/** The door's handler: its one `app.post` call in `registerLinkingRoutes`, and the calls inside it. */
function doorCalls(url: string): CallSite[] {
  const calls = callsIn(symbolOf(ROUTES, 'registerLinkingRoutes'));
  const door = calls.filter((c) => c.callee === 'app.post' && c.args[0]?.kind === 'string' && c.args[0].text === url);
  expect(door, `registerLinkingRoutes registers ${url} once`).toHaveLength(1);
  return calls.filter((c) => c.start > door[0]!.start && c.end <= door[0]!.end);
}

/** Every word the door answers through `refuser`, a literal read as itself and a decider's answer as its declared words; an
 *  argument the pin cannot resolve fails it rather than being skipped. */
function wordsThrough(calls: readonly CallSite[], refuser: string): Set<string> {
  const words = new Set<string>();
  for (const c of calls.filter((x) => x.name === refuser)) {
    const arg = c.args[1];
    if (arg?.kind === 'string') { words.add(arg.text); continue; }
    const decided = arg === undefined ? undefined : DECIDED[arg.text];
    expect(decided, `${refuser} answers ${arg?.text ?? 'nothing'}, a word this pin cannot read`).toBeDefined();
    for (const w of declaredWords(decided!.symbol, decided!.field)) words.add(w);
  }
  return words;
}

/** The `refuseRoute` calls inside the door, by their word's text: what the door answers past its own refuser. */
const passedThrough = (calls: readonly CallSite[]): string[] =>
  calls.filter((c) => c.name === 'refuseRoute').map((c) => c.args[1]?.text ?? '').sort();

describe('the team doors answer exactly their refusal vocabulary (D-8808, D-8809)', () => {
  it('the suggest door answers every word of TEAM_SUGGEST_REFUSALS and no other, through refuseSuggest', () => {
    const calls = doorCalls('/api/linking/suggest');
    expect([...wordsThrough(calls, 'refuseSuggest')].sort()).toEqual([...TEAM_SUGGEST_REFUSALS].sort());
    // The box token's word (its `onRequest`) and the attribution check's words are the box-token lanes' own, passed through.
    expect(passedThrough(calls)).toEqual(['attributed.error', 'unauthenticated']);
  });

  it('the confirm door answers every word of TEAM_CONFIRM_REFUSALS and no other, through refuseConfirm', () => {
    const calls = doorCalls('/api/linking/confirm');
    expect([...wordsThrough(calls, 'refuseConfirm')].sort()).toEqual([...TEAM_CONFIRM_REFUSALS].sort());
    // The Overlord gate answers its own refusals and returns `refused`; the door passes only the box token's word.
    expect(passedThrough(calls)).toEqual(['unauthenticated']);
  });

  it('each list names a word once', () => {
    for (const list of [TEAM_SUGGEST_REFUSALS, TEAM_CONFIRM_REFUSALS]) expect(new Set(list).size).toBe(list.length);
  });
});
