// D-7510 (ring-exemption drain, server half, Task RS7): the push service masks from its construction on. Once its
// constructor takes the masker, that guarantee lives at the composition root: `index.ts` builds the service with the
// shape-only masker and swaps in the wired one with `push?.setMasker(masker)` once coord.db is open. No other test
// reads that root (`push-masker-pin.test.ts` and the every-egress row build their own service), so these rows do.
// They read `index.ts` only through `scan/symbols.ts#parsedFile` and `scan/parse.ts#parseSource`. `parseSource`'s
// calls leave out `new` expressions, so the `push` binding's init is read with its one `new PushService(` turned into
// a `PushService(` call, whose arguments the parser splits.
import { describe, it, expect } from 'vitest';
import { parsedFile } from './scan/symbols.js';
import { parseSource, type Binding, type CallSite } from './scan/parse.js';

const INDEX = 'server/src/index.ts';
const index = parsedFile(INDEX);
const CONSTRUCTION = 'new PushService(';

/** `index.ts`'s top-level `push` binding. */
const pushBinding = (): Binding => {
  const top = index.bindings.filter((b) => b.name === 'push' && b.scopeStart === 0 && b.scopeEnd === index.text.length);
  expect(top, "index.ts's top-level `push` binding").toHaveLength(1);
  return top[0]!;
};

/** The `PushService` constructions in the `push` binding's init, read as calls. */
const constructions = (): CallSite[] => {
  const init = pushBinding().init;
  expect(init.split(CONSTRUCTION).length - 1, 'one `new PushService(` in the push binding').toBe(1);
  return parseSource(init.replace(CONSTRUCTION, 'PushService('), 'push-init.ts').calls.filter((c) => c.name === 'PushService');
};

const setMaskerCalls = (): CallSite[] => index.calls.filter((c) => c.name === 'setMasker' && c.head === 'push');

describe("the composition root builds the push service masked (D-7510)", () => {
  it('the push binding holds exactly one PushService construction', () => {
    expect(constructions()).toHaveLength(1);
  });

  it('push?.setMasker(masker) is called once, after the push binding, with the wired SecretMasker', () => {
    const calls = setMaskerCalls();
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.args).toEqual([{ kind: 'other', text: 'masker' }]);
    expect(call.start).toBeGreaterThan(pushBinding().end);
    const inScope = index.bindings.filter((b) => b.name === 'masker' && b.start < call.start
      && b.scopeStart <= call.start && call.start <= b.scopeEnd);
    expect(inScope.length, 'a `masker` binding in scope at the setMasker call').toBeGreaterThan(0);
    const innermost = inScope.reduce((a, b) => (b.scopeStart >= a.scopeStart ? b : a));
    expect(innermost.init.startsWith('new SecretMasker(')).toBe(true);
  });
});
