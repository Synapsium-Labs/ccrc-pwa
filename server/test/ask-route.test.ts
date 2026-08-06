import { describe, it, expect } from 'vitest';
import { askKey } from '../src/askkey.js';

const ask = (question: string, labels: string[]) => ({
  questions: [{ question, options: labels.map((label) => ({ label })) }],
});

describe('askKey', () => {
  it('is stable across re-reads of the same envelope', () => {
    expect(askKey(ask('Which colour?', ['Red', 'Blue'])))
      .toBe(askKey(ask('Which colour?', ['Red', 'Blue'])));
  });

  it('changes when the question changes', () => {
    expect(askKey(ask('Which colour?', ['Red', 'Blue'])))
      .not.toBe(askKey(ask('Which shape?', ['Red', 'Blue'])));
  });

  it('changes when an option label changes', () => {
    expect(askKey(ask('Which colour?', ['Red', 'Blue'])))
      .not.toBe(askKey(ask('Which colour?', ['Red', 'Green'])));
  });

  it('changes when options are reordered — position is part of the answer', () => {
    expect(askKey(ask('Which colour?', ['Red', 'Blue'])))
      .not.toBe(askKey(ask('Which colour?', ['Blue', 'Red'])));
  });

  it('has no key for an approval envelope — those answer through the pane path', () => {
    expect(askKey({ approval: { tool: 'Bash', summary: 'rm -rf /tmp/x' } })).toBeNull();
  });

  it('has no key for a null ask or an empty questions array', () => {
    expect(askKey(null)).toBeNull();
    expect(askKey({ questions: [] })).toBeNull();
  });
});

import { answerAsk } from '../src/inject/ask.js';
import { KeyedQueue } from '../src/inject/queue.js';

function deps(overrides: Partial<Parameters<typeof answerAsk>[0]> = {}) {
  const keys: string[] = [];
  return {
    keys,
    d: {
      queue: new KeyedQueue(),
      tmux: {
        capture: async () => 'pane',
        captureAnsi: async () => 'pane',
        sendKey: async (_id: string, k: string) => { keys.push(k); },
        sendLiteral: async (_id: string, t: string) => { keys.push(`lit:${t}`); },
      } as never,
      readAsk: async () => ({ ask: ask('Which colour?', ['Red', 'Blue']), state: 'waiting' as const }),
      sleep: async () => {},
      ...overrides,
    },
  };
}

describe('answerAsk', () => {
  it('sends the digit alone for a single-select answer', async () => {
    const { keys, d } = deps();
    const r = await answerAsk(d as never, 'cc-x', askKey(ask('Which colour?', ['Red', 'Blue']))!, [1]);
    expect(r).toEqual({ ok: true });
    expect(keys).toEqual(['2']);   // 0-based index 1 → the digit 2; it selects AND confirms
  });

  it('refuses a key that does not match the current envelope', async () => {
    const { keys, d } = deps();
    const r = await answerAsk(d as never, 'cc-x', 'deadbeefdeadbeef', [0]);
    expect(r).toEqual({ ok: false, error: 'ask-mismatch' });
    expect(keys).toEqual([]);      // nothing was pressed
  });

  it('refuses when the hook is not waiting', async () => {
    const { d } = deps({ readAsk: async () => ({ ask: null, state: 'working' as const }) });
    expect(await answerAsk(d as never, 'cc-x', 'k', [0])).toEqual({ ok: false, error: 'not-waiting' });
  });

  it('refuses an out-of-range index', async () => {
    const { d } = deps();
    const key = askKey(ask('Which colour?', ['Red', 'Blue']))!;
    expect(await answerAsk(d as never, 'cc-x', key, [7])).toEqual({ ok: false, error: 'range' });
  });

  it('refuses multiple indexes when the question is not multiSelect', async () => {
    const { d } = deps();
    const key = askKey(ask('Which colour?', ['Red', 'Blue']))!;
    expect(await answerAsk(d as never, 'cc-x', key, [0, 1])).toEqual({ ok: false, error: 'multiselect' });
  });

  it('sends every digit then Enter for a multiSelect answer', async () => {
    const multi = { questions: [{ question: 'Pick some', multiSelect: true,
      options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }] };
    const { keys, d } = deps({ readAsk: async () => ({ ask: multi, state: 'waiting' as const }) });
    const r = await answerAsk(d as never, 'cc-x', askKey(multi)!, [0, 2]);
    expect(r).toEqual({ ok: true });
    expect(keys).toEqual(['1', '3', 'Enter']);
  });

  it('refuses an approval envelope — those are the pane path', async () => {
    const { d } = deps({ readAsk: async () => ({ ask: { approval: { tool: 'Bash', summary: '' } }, state: 'waiting' as const }) });
    expect(await answerAsk(d as never, 'cc-x', 'k', [0])).toEqual({ ok: false, error: 'ask-mismatch' });
  });

  it('refuses a dead pane', async () => {
    const { d } = deps();
    (d.tmux as unknown as { capture: () => Promise<string | null> }).capture = async () => null;
    const key = askKey(ask('Which colour?', ['Red', 'Blue']))!;
    expect(await answerAsk(d as never, 'cc-x', key, [0])).toEqual({ ok: false, error: 'not-alive' });
  });
});
