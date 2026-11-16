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

  it("the construction's third argument is SHAPE_ONLY_MASKER, imported from ./accounts/mask.js and bound nowhere in index.ts", () => {
    const [ctor] = constructions();
    expect(ctor!.args).toHaveLength(3);
    expect(ctor!.args[2]).toEqual({ kind: 'other', text: 'SHAPE_ONLY_MASKER' });
    const edges = index.imports.filter((i) => i.specifier === './accounts/mask.js');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.typeOnly).toBe(false);
    expect(edges[0]!.names).toContain('SHAPE_ONLY_MASKER');
    expect(edges[0]!.typeNames ?? []).not.toContain('SHAPE_ONLY_MASKER');
    expect(index.bindings.filter((b) => b.name === 'SHAPE_ONLY_MASKER')).toEqual([]);
  });
});

// The push outbox (Overlord W1, plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox.md, Task 4): the boot
// pass runs once, synchronously, on the process's one clock, after the store opens and before the fleet link connects,
// so nothing can push before it and every `sending` row it finds belongs to a process that died.
describe('the composition root runs the push outbox boot pass before anything can push (Overlord W1)', () => {
  const callsNamed = (name: string): CallSite[] => index.calls.filter((c) => c.name === name);
  const topBinding = (name: string): Binding => {
    const top = index.bindings.filter((b) => b.name === name && b.scopeStart === 0 && b.scopeEnd === index.text.length);
    expect(top, `index.ts's top-level \`${name}\` binding`).toHaveLength(1);
    return top[0]!;
  };

  it('bootPushOutbox(coord, time.clock) is called once, after the store is built and the time ports exist', () => {
    const boots = callsNamed('bootPushOutbox');
    expect(boots).toHaveLength(1);
    const boot = boots[0]!;
    expect(boot.args).toEqual([{ kind: 'other', text: 'coord' }, { kind: 'other', text: 'time.clock' }]);
    expect(boot.start).toBeGreaterThan(topBinding('coord').end);
    expect(boot.start).toBeGreaterThan(topBinding('time').end);
    expect(topBinding('time').init).toBe('systemTimePorts()');
  });

  it('the boot pass comes before the fleet link connects', () => {
    const connects = callsNamed('connectFleet');
    expect(connects.length).toBeGreaterThan(0);
    const boot = callsNamed('bootPushOutbox')[0]!;
    for (const c of connects) expect(boot.start).toBeLessThan(c.start);
  });
});
