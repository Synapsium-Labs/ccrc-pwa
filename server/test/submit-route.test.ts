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

  // Review Important 1: every success frame above (BOX -> EMPTY_BOX) proves
  // submission by the box turning EMPTY, so this file never actually
  // exercised the needle-based proof `submitted()` uses in production — a
  // regression to `needle = ''` (the emptiness-only check `submitted` was
  // written to retire, see send.ts's own comment on the busy-session bug)
  // would leave every test above green. Post-Enter here the box shows a
  // DIFFERENT, NON-EMPTY row — the shape a busy Claude Code session actually
  // renders (it swaps the row for a hint rather than emptying it) — so
  // success can only be proved by "our text left", not by "the box is empty".
  it('proves submission via the needle leaving the box, not via emptiness — a busy-session shape', async () => {
    const { keys, d } = deps([BOX('hello there'), 'some scrollback\n❯ Press up to edit queued messages\n']);
    expect(await submitEnter(d as never, 'cc-x')).toEqual({ ok: true });
    expect(keys).toEqual(['Enter']);
  });

  // Review Important 2: `draftOf` reads only the box's ❯-marked FIRST row (its
  // own docstring says so); a message whose first line is itself blank — the
  // shape `sendPrompt` leaves via M-Enter when the composed prompt's first
  // `\n`-split part is '' (send.ts's own `parts` loop) — renders an
  // indistinguishable blank marker row while the real text sits one row down,
  // unmarked. Reporting `nothing-to-submit` there is a false claim; refuse
  // with the honest, distinct token instead, and still press nothing.
  it('refuses a blank first row that hides real content one row down — honestly, not as "nothing to submit"', async () => {
    const { keys, d } = deps(['❯ \n  actual text\n']);
    expect(await submitEnter(d as never, 'cc-x')).toEqual({ ok: false, error: 'blank-first-row' });
    expect(keys).toEqual([]);
  });

  // The companion case: a blank marker row immediately closed by the box's
  // own rule (the shape a GENUINELY empty box always has in production — see
  // LIVE_CU_FRAMES in send.test.ts) must still say `nothing-to-submit`, not
  // the new token — proving the rule-row boundary stops the scan before it
  // ever reaches chrome below the box (which shares the box's own two-space
  // indent and would otherwise look just like a continuation row).
  it('still refuses nothing-to-submit when the blank row is closed by the box\'s own rule, chrome and all', async () => {
    const { keys, d } = deps(['❯ \n──────────\n  👤 team·max │ chrome status bar\n']);
    expect(await submitEnter(d as never, 'cc-x')).toEqual({ ok: false, error: 'nothing-to-submit' });
    expect(keys).toEqual([]);
  });
});
