import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyedQueue } from '../src/inject/queue.js';
import { sendPrompt, ownPasteChip, ownRenderedBox, ECHO_BUDGET_MS, ECHO_POLL_MS, ECHO_TRIES, SUBMIT_TRIES } from '../src/inject/send.js';
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

// D-6366 fix round: a shape the call can prove is its own ends the echo wait at the ECHO_TRIES floor. The text arm's
// 24-character needle can never match a paste chip or a row-capped box's marker row, so without this exit those
// messages would always wait out the whole budget before their Enter.
describe('a proven own shape ends the echo wait at the floor (D-6366)', () => {
  const panes = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'panes');
  const fixture = (name: string): string => readFileSync(path.join(panes, name), 'utf8');
  const WORDS = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu'.split(' ');
  /** The probe's text generator (see send-paste-chip.test.ts), so the text is exactly what the recorded pane was typed from. */
  function recorded(n: number, tag: string): string {
    let t = `${tag} Reply with only the word OK and use no tools.`;
    for (let i = 0; t.length < n; i++) t += ' ' + WORDS[i % WORDS.length];
    const end = ` END-${tag}`;
    return (t.slice(0, n - end.length) + end).slice(0, n);
  }
  const lines = (k: number, w: number, tag: string): string =>
    Array.from({ length: k }, (_, j) => recorded(w, `${tag}L${String(j).padStart(2, '0')}`)).join('\n');

  /** The recorded empty box, then `typed` once the literal is sent, then the empty box after an Enter; free sleep. */
  function paneRig(typed: string) {
    const empty = fixture('cc300-paste-empty-box.txt');
    const submitted = fixture('cc300-paste-submitted.txt');
    let isTyped = false;
    let entered = false;
    let echoPolls = 0;
    const keys: string[] = [];
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'send-keys') {
        if (args.includes('-l')) isTyped = true;
        else { keys.push(args.at(-1)!); if (args.at(-1) === 'Enter') entered = true; }
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'capture-pane') {
        if (isTyped && !entered && args.includes('-e')) echoPolls++;
        return { code: 0, stdout: entered ? submitted : isTyped ? typed : empty, stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    return { d: { tmux: new Tmux(run), queue: new KeyedQueue(), sleep: async () => {} }, keys, polls: () => echoPolls };
  }

  it('an own paste chip is submitted after ECHO_TRIES polls, not the budget', async () => {
    const r = paneRig(fixture('cc300-paste-chip-1000.txt'));
    const res = await sendPrompt(r.d, 'x', recorded(1000, 'c1000'));
    expect(res).toEqual({ ok: true });
    expect(r.keys.filter((k) => k === 'Enter')).toHaveLength(1);
    expect(r.polls()).toBe(ECHO_TRIES);
  });

  it('an own row-capped box is submitted after ECHO_TRIES polls, not the budget', async () => {
    const r = paneRig(fixture('cc300-paste-tall-40-lines.txt'));
    const res = await sendPrompt(r.d, 'x', lines(40, 80, 'tall40'));
    expect(res).toEqual({ ok: true });
    expect(r.keys.filter((k) => k === 'Enter')).toHaveLength(1);
    expect(r.polls()).toBe(ECHO_TRIES);
  });

  // D-6366 fix round 2: the chip half of the exit. A chip that states its lines (`[Pasted text #2 +9 lines]`) is one
  // `ownPasteChip` proves and `ownRenderedBox` does not (it reads only a bare chip), so this pane is the one
  // that holds the `ownPasteChip` disjunct up.
  it('an own paste chip only ownPasteChip proves is submitted after ECHO_TRIES polls', async () => {
    const chipLines = fixture('cc300-paste-chip-lines.txt');
    const text = Array.from({ length: 10 }, (_, j) => recorded(80, `m10lfL${String(j).padStart(2, '0')}`)).join('\n');
    const parts = text.split('\n');
    expect(ownPasteChip(chipLines, parts, 'proven-empty')).not.toBeNull();
    expect(ownRenderedBox(chipLines, parts, 'proven-empty')).toBeNull();
    const r = paneRig(chipLines);
    const res = await sendPrompt(r.d, 'x', text);
    expect(res).toEqual({ ok: true });
    expect(r.keys.filter((k) => k === 'Enter')).toHaveLength(1);
    expect(r.polls()).toBe(ECHO_TRIES);
  });
});

// D-6366 fix round 2: the early end comes AFTER the echo check. An ordinary, fully echoed box is also one
// `ownRenderedBox` proves, so an echo that first renders at the floor must still be taken as an echo and submitted on
// the echo proof (the box still starts with the needle), not on the tail proof.
describe('a late echo keeps the echo proof (D-6366)', () => {
  const RULE = '─'.repeat(40);
  const MSG = 'please review the open pull requests today';
  it('a late echo on a pane where the two proofs disagree is submitted on the echo proof', async () => {
    // Before the Enter the box is empty until echo poll ECHO_TRIES, then holds the whole message (a box
    // `ownRenderedBox` proves). After it the box holds a PREFIX of the message that still starts with the needle but
    // no longer holds the tail: the echo proof says "still ours" (retry Enter, then refuse), the tail proof "gone".
    let typed = false;
    let entered = false;
    let polls = 0;
    const keys: string[] = [];
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'send-keys') {
        if (args.includes('-l')) typed = true;
        else { keys.push(args.at(-1)!); if (args.at(-1) === 'Enter') entered = true; }
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'capture-pane') {
        if (typed && !entered && args.includes('-e')) polls++;
        const row = entered ? MSG.slice(0, 30) : typed && polls >= ECHO_TRIES ? MSG : '';
        return { code: 0, stdout: `❯ ${row}\n${RULE}\n`, stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const d = { tmux: new Tmux(run), queue: new KeyedQueue(), sleep: async () => {} };
    const res = await sendPrompt(d, 'x', MSG);
    expect(polls).toBe(ECHO_TRIES);
    expect(res).toMatchObject({ ok: false, error: 'enter-ignored' });
    expect(keys.filter((k) => k === 'Enter')).toHaveLength(2);
  });
});

// D-6366: the proof's blind polls (failed captures) get a wall deadline. A hung tmux makes each capture fail
// only after its own timeout, so counting polls alone would make the proof cost 16 timeouts where base cost 4.
describe('with every capture failing after 10 s the proof ends within base\'s bound (D-6366)', () => {
  it('with every capture failing after 10 s, the proof ends within base\'s bound', async () => {
    const HUNG_MS = 10_000;
    let t = 0;
    let entered = false;
    let typed = false;
    let firstEnterAt = 0;
    let capturesAfterEnter = 0;
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'send-keys') {
        if (args.includes('-l')) typed = true;
        if (args.at(-1) === 'Enter') { if (!entered) firstEnterAt = t; entered = true; t += HUNG_MS; }
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'capture-pane') {
        if (!entered) return { code: 0, stdout: typed ? '❯ hello from the lane\n' : '❯ \n', stderr: '' };
        capturesAfterEnter++;
        t += HUNG_MS;
        return { code: 1, stdout: '', stderr: 'timed out' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const d = { tmux: new Tmux(run), queue: new KeyedQueue(), sleep: async (ms: number) => { t += ms; }, now: () => t };
    const res = await sendPrompt(d, 'x', 'hello from the lane');
    expect(res).toMatchObject({ ok: false, error: 'enter-ignored' });
    // Base: one capture per watch (a failed one ends it) and the final read's two: four after the first Enter.
    expect(capturesAfterEnter).toBe(4);
    expect(t - firstEnterAt).toBeLessThanOrEqual(65_000);
  });
});

// D-6366 fix round 2: the blind deadline counts from the first failed capture of the CURRENT blind run, and any
// capture that returns ends that run. A loaded box (200 ms a capture) must not lose its remaining polls to one blip.
describe('a link blip does not cut the post-Enter watch (D-6366)', () => {
  const CAPTURE_MS = 200;
  /** Captures after the first Enter fail at the k values in `failAt` (k from 1); the box keeps our text, so every Enter
   *  is ignored. Answers the captures taken between the first Enter and the retry Enter: the first watch's polls. */
  async function firstWatchPolls(failAt: ReadonlySet<number>): Promise<number> {
    let t = 0;
    let typed = false;
    let enters = 0;
    let k = 0;
    let atRetry = -1;
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'send-keys') {
        if (args.includes('-l')) typed = true;
        if (args.at(-1) === 'Enter') { enters++; if (enters === 2) atRetry = k; }
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'capture-pane') {
        t += CAPTURE_MS;
        if (enters > 0) { k++; if (failAt.has(k)) return { code: 1, stdout: '', stderr: 'blip' }; }
        return { code: 0, stdout: typed ? '❯ hello from the lane\n' : '❯ \n', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const d = { tmux: new Tmux(run), queue: new KeyedQueue(), sleep: async (ms: number) => { t += ms; }, now: () => t };
    const res = await sendPrompt(d, 'x', 'hello from the lane');
    expect(res).toMatchObject({ ok: false, error: 'enter-ignored' });
    return atRetry;
  }

  it('a link blip at 200 ms per capture still gets the watch\'s remaining polls', async () => {
    expect(await firstWatchPolls(new Set([4]))).toBe(SUBMIT_TRIES);
  });

  it('two blips apart each get their own deadline: the first one\'s run ended at the capture between', async () => {
    expect(await firstWatchPolls(new Set([2, 7]))).toBe(SUBMIT_TRIES);
  });
});
