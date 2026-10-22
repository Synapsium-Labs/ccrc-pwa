import { describe, it, expect } from 'vitest';
import { KeyedQueue } from '../src/inject/queue.js';
import { sendPrompt, ECHO_BUDGET_MS, ECHO_POLL_MS, ECHO_TRIES } from '../src/inject/send.js';
import { Tmux, type Runner } from '../src/exec.js';

// D-6366: how long `sendPrompt` waits for the typed text to echo in the box. The wait was a fixed ECHO_TRIES polls,
// so a loaded box (slow captures) spent its 12 polls before the echo rendered and the send was refused `verify-failed`
// with the text left in the box. It now polls at least ECHO_TRIES times AND until ECHO_BUDGET_MS is spent, where spent
// is the larger of the wall time since the first poll (`d.now`) and the sum of the sleeps asked for.

const TEXT = 'hello from the lane';
const CLIP = '/home/u/.cc-clips/lane-a-project-a/clip-20260726-150340-a1b2.png';

/** More captures than any sane wait takes: a loop that counts its budget in wall time only spins on microtasks under a
 *  free sleep and would never let vitest's timer fire, so the fake answers loudly instead of hanging the run. */
const RUNAWAY = 1000;

/**
 * A fake pane that answers by what was done to it. Before the literal is typed the box is empty; after it, the box
 * shows `shown` once `echoAtPoll` echo polls (ansi captures since the literal) have passed (never, when undefined);
 * after an Enter it is empty again. `captureMs` is what each capture costs on the fake clock.
 */
function rig(o: { captureMs?: number; echoAtPoll?: number; shown?: string; fakeClock: boolean }) {
  let t = 0;
  let typed = false;
  let entered = false;
  let ansiSinceTyped = 0;
  let captures = 0;
  const keys: string[] = [];
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'send-keys') {
      if (args.includes('-l')) typed = true;
      else {
        keys.push(args.at(-1)!);
        if (args.at(-1) === 'Enter') entered = true;
      }
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'capture-pane') {
      if (++captures > RUNAWAY) throw new Error(`runaway echo wait: ${captures} captures`);
      t += o.captureMs ?? 0;
      const ansi = args.includes('-e');
      if (ansi && typed && !entered) ansiSinceTyped++;
      const echoed = typed && !entered && o.echoAtPoll !== undefined && ansiSinceTyped >= o.echoAtPoll;
      return { code: 0, stdout: echoed ? `❯ ${o.shown ?? TEXT}\n` : '❯ \n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const deps = o.fakeClock
    ? { sleep: async (ms: number) => { t += ms; }, now: () => t }
    : { sleep: async () => {} };
  return {
    d: { tmux: new Tmux(run), queue: new KeyedQueue(), ...deps },
    keys,
    /** The echo polls taken: every ansi capture between the literal and the Enter (or the refusal). */
    polls: () => ansiSinceTyped,
  };
}

describe('sendPrompt waits for the echo by a budget as well as a poll count (D-6366)', () => {
  it('an echo that renders after 12 polls but within the budget is submitted with one Enter', async () => {
    const echoAtPoll = ECHO_TRIES + 8;
    const r = rig({ captureMs: 50, echoAtPoll, fakeClock: true });
    expect((echoAtPoll * (ECHO_POLL_MS + 50))).toBeLessThan(ECHO_BUDGET_MS);
    const res = await sendPrompt(r.d, 'x', TEXT);
    expect(res).toEqual({ ok: true });
    expect(r.keys.filter((k) => k === 'Enter')).toHaveLength(1);
  });

  it('the attachment arm waits as long: an echo after 12 polls but within the budget is submitted with one Enter', async () => {
    const r = rig({ captureMs: 50, echoAtPoll: ECHO_TRIES + 8, shown: CLIP, fakeClock: true });
    const res = await sendPrompt(r.d, 'x', '', { attachments: [CLIP] });
    expect(res).toEqual({ ok: true });
    expect(r.keys.filter((k) => k === 'Enter')).toHaveLength(1);
  });

  it('an echo that never renders refuses verify-failed once both the poll floor and the budget are spent, text left, no Enter', async () => {
    const r = rig({ captureMs: 50, fakeClock: true });
    const res = await sendPrompt(r.d, 'x', TEXT);
    expect(res).toMatchObject({ ok: false, error: 'verify-failed' });
    expect(r.keys).toEqual([]);                      // no Enter, and no C-u: the text is left in the box
    expect(r.polls()).toBe(Math.max(ECHO_TRIES, Math.ceil(ECHO_BUDGET_MS / (ECHO_POLL_MS + 50))));
  });

  it('with a free sleep the wait is ECHO_BUDGET_MS / ECHO_POLL_MS polls', async () => {
    const r = rig({ fakeClock: false });             // sleep is free and the real clock barely moves
    const res = await sendPrompt(r.d, 'x', TEXT);
    expect(res).toMatchObject({ ok: false, error: 'verify-failed' });
    expect(r.polls()).toBe(ECHO_BUDGET_MS / ECHO_POLL_MS);
  });

  it('with 300 ms captures the wait ends at the wall deadline, not later', async () => {
    const r = rig({ captureMs: 300, fakeClock: true });
    const res = await sendPrompt(r.d, 'x', TEXT);
    expect(res).toMatchObject({ ok: false, error: 'verify-failed' });
    expect(r.polls()).toBe(Math.ceil(ECHO_BUDGET_MS / (ECHO_POLL_MS + 300)));
  });

  it('with 600 ms captures the wait is still at least ECHO_TRIES polls', async () => {
    const r = rig({ captureMs: 600, fakeClock: true });
    const res = await sendPrompt(r.d, 'x', TEXT);
    expect(res).toMatchObject({ ok: false, error: 'verify-failed' });
    expect((ECHO_TRIES * (ECHO_POLL_MS + 600))).toBeGreaterThan(ECHO_BUDGET_MS);   // the budget is spent before the floor
    expect(r.polls()).toBe(ECHO_TRIES);
  });
});
