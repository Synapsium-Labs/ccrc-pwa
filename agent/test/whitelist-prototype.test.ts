// FINAL REVIEW, gates finding 6 / destructive F7 — `isExecAllowed` THREW on
// prototype-named commands instead of answering the question.
//
// Reproduced on `4e8b689`, verbatim output:
//
//   constructor          -> THREW: prefixes.some is not a function
//   __proto__            -> THREW: prefixes.some is not a function
//   toString             -> THREW: prefixes.some is not a function
//   valueOf              -> THREW: prefixes.some is not a function
//   hasOwnProperty       -> THREW: prefixes.some is not a function
//   isPrototypeOf        -> THREW: prefixes.some is not a function
//   propertyIsEnumerable -> THREW: prefixes.some is not a function
//   toLocaleString       -> THREW: prefixes.some is not a function
//
// `EXEC_WHITELIST` is a plain object literal, so `EXEC_WHITELIST['constructor']`
// returned the INHERITED `Object` — truthy, so `if (!prefixes) return false`
// never fired — and `.some` is not a method of a constructor function.
//
// Both reviewers were right that it fails CLOSED: the throw is inside an async
// handler, so `handleReq(ws, req, ctx).catch(…)` (agent/src/server.ts:363)
// converts it to `{ok:false, err:'prefixes.some is not a function'}` and no
// `runExec` happens. That is why this is a correctness fix, not a security one.
// What makes it worth fixing anyway is the shape of the near miss: the ONLY
// thing standing between "wrong error message" and "permitted" is that no
// caller wraps the call in a `try`/`catch` that treats an exception as benign.
// `defaultsToTrueOnThrow` below is that caller, written out, so the pin is
// against the hole and not merely against the message.
import { describe, it, expect } from 'vitest';
import { isExecAllowed } from '../src/whitelist.js';

const PROTO_NAMES = [
  'constructor', '__proto__', 'toString', 'valueOf',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString',
];

describe('a prototype-named command answers false — it does not throw', () => {
  it.each(PROTO_NAMES)('isExecAllowed(%j, …)', (name) => {
    // Every argv shape the wire can produce, including one that IS a valid
    // tmux/ccd prefix — the refusal must come from the command, not the args.
    for (const args of [[], ['x'], ['pr', 'merge', '1'], ['has-session'], ['start', 'claude', 'demo']]) {
      let result: unknown = 'not-called';
      expect(() => { result = isExecAllowed(name, args); },
        `${name} must answer the question, not throw it`).not.toThrow();
      expect(result, `${name} ${args.join(' ')}`).toBe(false);
    }
  });

  it('a caller that swallows exceptions still gets a refusal', () => {
    // The one line that would have turned the throw into a real hole: a tidy-up
    // deciding an exception means "nothing to see here". With no exception to
    // swallow, the refusal is the only answer available.
    const defaultsToTrueOnThrow = (cmd: string, args: string[]): boolean => {
      try { return isExecAllowed(cmd, args); } catch { return true; }
    };
    for (const name of PROTO_NAMES) {
      expect(defaultsToTrueOnThrow(name, ['x']), name).toBe(false);
    }
  });

  it('the legitimate commands are unaffected by the guarded lookup', () => {
    // `Object.hasOwn` must not become a refusal of the two real keys — the
    // failure mode of over-tightening this is a dead fleet, not a leak.
    expect(isExecAllowed('tmux', ['capture-pane', '-t', 'cc-x', '-p'])).toBe(true);
    expect(isExecAllowed('ccd', ['start', 'claude', 'demo'])).toBe(true);
    expect(isExecAllowed('ccd', ['ws-reap', '--expect', 'a'.repeat(64), '--session', 'x'])).toBe(true);
    expect(isExecAllowed('ccd', ['ws-rm', 'x'])).toBe(false);
    expect(isExecAllowed('gh', ['pr', 'merge', '1'])).toBe(false);
  });
});
