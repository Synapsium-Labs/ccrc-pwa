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
    expect(await submitEnter(d as never, 'cc-x', 'hello there')).toEqual({ ok: true });
    expect(keys).toEqual(['Enter']);
  });

  it('refuses an empty box — there is nothing to send', async () => {
    const { keys, d } = deps([EMPTY_BOX]);
    expect(await submitEnter(d as never, 'cc-x', 'hello there')).toEqual({ ok: false, error: 'nothing-to-submit' });
    expect(keys).toEqual([]);
  });

  it('refuses while a menu owns the keyboard', async () => {
    const { keys, d } = deps([MENU]);
    expect(await submitEnter(d as never, 'cc-x', 'hello there')).toEqual({ ok: false, error: 'dialog-open' });
    expect(keys).toEqual([]);
  });

  it('refuses a dead pane', async () => {
    const d = { queue: new KeyedQueue(), sleep: async () => {},
      tmux: { captureAnsi: async () => null, sendKey: async () => {} } as never };
    expect(await submitEnter(d as never, 'cc-x', 'hello there')).toEqual({ ok: false, error: 'not-alive' });
  });

  it('reports enter-ignored when the text is still there, and does NOT press again', async () => {
    const { keys, d } = deps([BOX('hello there')]);   // every frame identical
    expect(await submitEnter(d as never, 'cc-x', 'hello there')).toEqual({ ok: false, error: 'enter-ignored' });
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
    expect(await submitEnter(d as never, 'cc-x', 'hello there')).toEqual({ ok: true });
    expect(keys).toEqual(['Enter']);
  });

  // Review Important 2: `draftOf` reads only the box's ❯-marked FIRST row (its
  // own docstring says so); a box whose first row is blank renders an
  // indistinguishable blank marker row while the real text sits one row down,
  // unmarked. Reporting `nothing-to-submit` there is a false claim; refuse
  // with the honest, distinct token instead, and still press nothing.
  //
  // WHERE THAT PANE COMES FROM (wave-check): this comment used to name it as
  // "the shape `sendPrompt` leaves via M-Enter when the composed prompt's
  // first \n-split part is ''". Task 402 deleted that producer —
  // `composePrompt` strips leading blank lines, and `send.test.ts` pins that
  // the M-Enter loop can no longer manufacture the shape. What reaches this
  // refusal now is a human who pressed Enter in the box first, or a pre-402
  // client still on the wire; the case is as real as it ever was, and this
  // test is unchanged.
  it('refuses a blank first row that hides real content one row down — honestly, not as "nothing to submit"', async () => {
    const { keys, d } = deps(['❯ \n  actual text\n']);
    expect(await submitEnter(d as never, 'cc-x', 'actual text')).toEqual({ ok: false, error: 'blank-first-row' });
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
    expect(await submitEnter(d as never, 'cc-x', 'anything')).toEqual({ ok: false, error: 'nothing-to-submit' });
    expect(keys).toEqual([]);
  });

  // PR F whole-branch review, Critical: this route presses Enter on WHATEVER
  // the box holds, and the box is shared mutable state. The live sequence:
  // "run the tests" is left in the box by enter-ignored; the operator sends
  // "check the logs", hits the draft-conflict sheet, taps Replace draft, which
  // C-u's the box and types the new message; the first bubble is still on
  // screen still offering Send it. Without a correspondence gate that tap
  // submits "check the logs" and reports success for "run the tests", whose
  // text then exists nowhere at all.
  it('refuses to press Enter on a box that no longer holds what the caller was shown', async () => {
    const { keys, d } = deps([BOX('check the logs')]);
    expect(await submitEnter(d as never, 'cc-x', 'run the tests'))
      .toEqual({ ok: false, error: 'box-mismatch' });
    expect(keys).toEqual([]);
  });

  // The other half of the same gate: a box holding exactly what was proven to
  // be there still submits. (Trimmed on both sides — `draftOf` trims the row
  // it reads, so the claim it handed out is trimmed too.)
  it('presses Enter when the box still reads exactly what the caller was shown', async () => {
    const { keys, d } = deps([BOX('run the tests'), EMPTY_BOX]);
    expect(await submitEnter(d as never, 'cc-x', '  run the tests  ')).toEqual({ ok: true });
    expect(keys).toEqual(['Enter']);
  });
});
