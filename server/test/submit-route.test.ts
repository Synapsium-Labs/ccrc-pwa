import { describe, it, expect } from 'vitest';
import { submitEnter } from '../src/inject/send.js';
import { KeyedQueue } from '../src/inject/queue.js';

const BOX = (text: string) => `some scrollback\n❯ ${text}\n`;
const EMPTY_BOX = '❯ \n';
const MENU = 'Do you want to proceed?\n❯ 1. Yes\n  2. No\n';

function deps(frames: string[]) {
  const keys: string[] = [];
  let i = 0;
  return {
    keys,
    d: {
      queue: new KeyedQueue(),
      sleep: async () => {},
      tmux: {
        capture: async () => frames[Math.min(i, frames.length - 1)] ?? null,
        captureAnsi: async () => frames[Math.min(i++, frames.length - 1)] ?? null,
        sendKey: async (_id: string, k: string) => { keys.push(k); },
        sendLiteral: async () => {},
      } as never,
    },
  };
}

describe('submitEnter', () => {
  it('presses Enter once and reports ok when the text leaves the box', async () => {
    const { keys, d } = deps([BOX('hello there'), EMPTY_BOX]);
    expect(await submitEnter(d as never, 'cc-x')).toEqual({ ok: true });
    expect(keys).toEqual(['Enter']);
  });

  it('refuses an empty box — there is nothing to send', async () => {
    const { keys, d } = deps([EMPTY_BOX]);
    expect(await submitEnter(d as never, 'cc-x')).toEqual({ ok: false, error: 'nothing-to-submit' });
    expect(keys).toEqual([]);
  });

  it('refuses while a menu owns the keyboard', async () => {
    const { keys, d } = deps([MENU]);
    expect(await submitEnter(d as never, 'cc-x')).toEqual({ ok: false, error: 'dialog-open' });
    expect(keys).toEqual([]);
  });

  it('refuses a dead pane', async () => {
    const d = { queue: new KeyedQueue(), sleep: async () => {},
      tmux: { captureAnsi: async () => null, sendKey: async () => {} } as never };
    expect(await submitEnter(d as never, 'cc-x')).toEqual({ ok: false, error: 'not-alive' });
  });

  it('reports enter-ignored when the text is still there, and does NOT press again', async () => {
    const { keys, d } = deps([BOX('hello there')]);   // every frame identical
    expect(await submitEnter(d as never, 'cc-x')).toEqual({ ok: false, error: 'enter-ignored' });
    expect(keys).toEqual(['Enter']);   // exactly one — no blind retry loop
  });
});
