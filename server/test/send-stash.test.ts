import { afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyedQueue } from '../src/inject/queue.js';
import { ECHO_BUDGET_MS, ECHO_POLL_MS, sendPrompt, STASH_TRIES, SUBMIT_TRIES, type SendResult } from '../src/inject/send.js';
import { Tmux, type Runner } from '../src/exec.js';

/** D-6366: the echo polls a free sleep takes (the wait is the larger of ECHO_TRIES polls and ECHO_BUDGET_MS). */
const ECHO_WAIT_POLLS = ECHO_BUDGET_MS / ECHO_POLL_MS;

/**
 * D-5911 (plan docs/superpowers/plans/2026-10-20-mail-and-run-truth-draft-never-blocks-rejected-m.md, Task P1b; spec
 * §2.1, §2.3). `sendPrompt`'s `onDraft: 'stash'`: a draft is saved with Claude Code's own prompt stash (`C-s`), the
 * box is verified empty, the message is typed and submitted, and Claude Code's restore is verified.
 *
 * WHAT THE PROBE MEASURED (Step 0; Claude Code 2.1.303, macOS, tmux 3.7c, a throwaway local tmux server at 220x50,
 * `--safe-mode --model haiku`; captures in `fixtures/panes/box/stash-*.ansi`, work-dir path scrubbed):
 *  (a) `C-s` on a non-empty box empties it (`stash-after-cs`), and a ` › stashed ·` notice appears on the
 *      notification row two rows above the marker row;
 *  (b) a submit restores the draft at once, before the turn's first capture 0.6 s later: a one-line draft
 *      (`stash-restored`), a multi-line draft (`stash-restored-multi-line`) and a text-plus-chip draft
 *      (`stash-restored-paste-chip`), with "Draft restored" on the notification row;
 *  (c) `/clear` then Enter restores it too (`stash-clear-restored`);
 *  (d) the notice IS a held-stash indicator: it stays while the stash is held, on an empty box, with new text in the
 *      box (`stash-held-with-text`), during a running turn (`stash-held-during-turn`), after an ordinary turn ends,
 *      and at 80 columns; it goes the moment the stash is popped. So the carrier ships armed (spec §8 O1 does not
 *      arise);
 *  (e) `C-s` on an empty box with a stash held pops it.
 *
 * The fake below emulates exactly those five facts over the captured layout (notification row, rule, marker row,
 * rule, footer). The first case drives `sendPrompt` over the recorded panes themselves.
 */

const boxDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'panes', 'box');
const capture = (name: string): string => readFileSync(path.join(boxDir, name), 'utf8');

const noSleep = async () => {};
const RULE = '─'.repeat(80);
const PLACEHOLDER = '\x1b[2mTry "fix typecheck errors"\x1b[0m';

interface Cc {
  box: string[];
  stash: string[] | null;
  history: string[];
  menu: boolean;
  running: boolean;
  armed: boolean;
  /** A transcript, todo or spinner row above the notification row, shown when no turn is running. */
  above: string;
  /** Other text on the notification row, left of the update notice. */
  notice: string;
  /** D-6011: how many coming captures draw no held-stash indicator although a stash is held (a frame that does
   *  not parse: a transient redraw, a notification taking the row). */
  hideIndicator: number;
}

interface FakeOpts {
  box?: string[];
  stash?: string[] | null;
  menu?: boolean;
  running?: boolean;
  armed?: boolean;
  above?: string;
  /** `inert`: a rebound or missing binding, `C-s` does nothing. */
  stashKey?: 'stash' | 'inert';
  /** Claude Code restores the stash at submit (measured, b). `false` models a restore that does not land. */
  restoreOnSubmit?: boolean;
  /** `C-s` on an empty box pops a held stash (measured, e). */
  popWorks?: boolean;
  /** How many Enters are swallowed before one submits. */
  swallowEnters?: number;
  /** A non-slash submit starts a turn ("esc to interrupt" on the spinner row). */
  runOnSubmit?: boolean;
  /** Called before the k-th capture after the first submit (k from 1), to land a late event. */
  afterSubmit?: (k: number, s: Cc) => void;
  /** D-6010: the n-th typed literal (from 1) is refused by tmux, `type-failed`. */
  failLiteral?: number;
  /** D-6010: typed literals never reach the box (the echo never renders). */
  dropLiterals?: boolean;
  /** D-6010: after the first typed literal, the next `blind` captures come back with no box (`no-box`) or fail
   *  (`dead`), then the pane reads normally again. */
  blindAfterType?: { kind: 'no-box' | 'dead'; captures: number };
  /** D-6366: from the first Enter, this many captures fail (a link drop), then the pane reads normally again. */
  blindAfterEnter?: number;
  /** D-6366: called before every capture once an Enter has been pressed, with the number of Enters so far and the
   *  number of captures since the latest one (from 1): an event landing between the proof's polls and its final read. */
  afterEnter?: (enters: number, k: number, s: Cc) => void;
  /** D-6011: each swallowed Enter hides the held-stash indicator from this many following captures. */
  hideAfterSwallow?: number;
  /** D-6366: render lag. The first Enter takes effect (submits) just before this capture after it (from 1), so the
   *  captures before it still read our text in the box. */
  landAtCapture?: number;
  /** D-6366: the captures after the first Enter (k from 1, counted from that Enter on) this answers true for fail,
   *  as a link drop does. */
  failCapture?: (k: number) => boolean;
  /** D-6366: the captures after the first Enter (k from 1) that return, but with no box in them (a transcript-only
   *  pane: an overlay over the composer, the marker row scrolled out). */
  absentCapture?: (k: number) => boolean;
  /** D-6366: called on every capture, for a test's moving clock. */
  tick?: () => void;
}

const nonBlank = (rows: string[]): boolean => rows.some((r) => r.trim() !== '');

function render(s: Cc): string {
  const lines = ['\x1b[1m❯\x1b[0m an earlier turn', '⏺ done', ''];
  if (s.menu) {
    lines.push(' Pick one', ' ❯ 1. Yes', '   2. No', '', ' Enter to confirm · Esc to cancel');
    return lines.join('\n') + '\n';
  }
  lines.push(s.running ? '✳ Working… (3s · esc to interrupt)' : s.above);
  const shown = s.stash !== null && !(s.hideIndicator > 0 && s.hideIndicator--);
  lines.push(`\x1b[38;5;246m${s.notice}${shown ? ' › stashed ·' : ''}\x1b[39m \x1b[38;5;114m✔ Update installed\x1b[39m`);
  lines.push(RULE);
  if (!nonBlank(s.box)) lines.push(`❯ ${PLACEHOLDER}`);
  else s.box.forEach((r, i) => lines.push((i === 0 ? '❯ ' : '  ') + r));
  lines.push(RULE);
  lines.push(s.armed
    ? '  Usage limit reached · continuing automatically at 10:00 · esc or type to cancel'
    : '  ⏵⏵ auto mode on (shift+tab to cycle)');
  return lines.join('\n') + '\n';
}

function fakeCc(o: FakeOpts = {}) {
  const s: Cc = {
    box: [...(o.box ?? [])], stash: o.stash === undefined ? null : o.stash, history: [],
    menu: o.menu ?? false, running: o.running ?? false, armed: o.armed ?? false, above: o.above ?? '', notice: '',
    hideIndicator: 0,
  };
  const keys: string[] = [];
  let swallow = o.swallowEnters ?? 0;
  let submits = 0;
  let sinceSubmit = 0;
  let literals = 0;
  let blind = 0;
  let blindEnter = 0;
  let enters = 0;
  let sinceEnter = 0;
  let sinceFirstEnter = 0;
  let pendingLand = false;
  const submitNow = (): void => {
    if (!nonBlank(s.box)) return;
    const sent = s.box.join('\n');
    s.history.push(sent);
    submits++;
    if (submits === 1) blindEnter = o.blindAfterEnter ?? 0;
    s.box = [];
    if (o.runOnSubmit && !sent.startsWith('/')) s.running = true;
    if (s.stash !== null && (o.restoreOnSubmit ?? true)) { s.box = s.stash; s.stash = null; }
  };
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'capture-pane') {
      o.tick?.();
      if (enters > 0) {
        sinceFirstEnter++;
        if (pendingLand && sinceFirstEnter === o.landAtCapture) { pendingLand = false; submitNow(); }
        if (o.failCapture?.(sinceFirstEnter)) return { code: 1, stdout: '', stderr: "can't find pane" };
        if (o.absentCapture?.(sinceFirstEnter)) return { code: 0, stdout: ['⏺ a long transcript row', 'more transcript'].join('\n') + '\n', stderr: '' };
      }
      if (submits > 0) o.afterSubmit?.(++sinceSubmit, s);
      if (enters > 0) o.afterEnter?.(enters, ++sinceEnter, s);
      if (blindEnter > 0) { blindEnter--; return { code: 1, stdout: '', stderr: "can't find pane" }; }
      if (blind > 0) {
        blind--;
        if (o.blindAfterType!.kind === 'dead') return { code: 1, stdout: '', stderr: "can't find pane" };
        return { code: 0, stdout: ['⏺ a long transcript row', 'more transcript'].join('\n') + '\n', stderr: '' };
      }
      return { code: 0, stdout: render(s), stderr: '' };
    }
    if (args[0] === 'send-keys') {
      if (args[3] === '-l') {
        const text = args.at(-1)!;
        keys.push(`lit:${text}`);
        literals++;
        if (literals === 1 && o.blindAfterType) blind = o.blindAfterType.captures;
        if (o.failLiteral === literals) return { code: 1, stdout: '', stderr: 'refused' };
        if (o.dropLiterals) return { code: 0, stdout: '', stderr: '' };
        if (s.box.length === 0) s.box = [''];
        s.box[s.box.length - 1] += text;
        return { code: 0, stdout: '', stderr: '' };
      }
      const key = args.at(-1)!;
      keys.push(key);
      if (key === 'M-Enter') s.box.push('');
      else if (key === 'C-u') {
        if (s.box.length > 0 && s.box[s.box.length - 1] === '' && s.box.length > 1) s.box.pop();
        else if (s.box.length > 0) s.box[s.box.length - 1] = '';
      } else if (key === 'C-s') {
        if ((o.stashKey ?? 'stash') === 'inert') return { code: 0, stdout: '', stderr: '' };
        if (nonBlank(s.box)) { s.stash = s.box; s.box = []; }
        else if (s.stash !== null && (o.popWorks ?? true)) { s.box = s.stash; s.stash = null; }
      } else if (key === 'Enter') {
        enters++;
        sinceEnter = 0;
        if (swallow > 0) { swallow--; s.hideIndicator = o.hideAfterSwallow ?? 0; return { code: 0, stdout: '', stderr: '' }; }
        if (o.landAtCapture !== undefined && submits === 0) { pendingLand = true; return { code: 0, stdout: '', stderr: '' }; }
        submitNow();
      }
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { tmux: new Tmux(run), keys, state: s };
}

// A frozen clock: no capture stalls, so the blind-run deadline (`SUBMIT_BLIND_MS`) never ends a watch here; the poll count does.
const deps = (tmux: Tmux) => ({ tmux, queue: new KeyedQueue(), sleep: noSleep, now: () => 0 });
type SendOpts = NonNullable<Parameters<typeof sendPrompt>[3]>;
const STASH = { onDraft: 'stash' } as SendOpts;
const send = (f: ReturnType<typeof fakeCc>, text: string, opts: SendOpts = STASH): Promise<SendResult> =>
  sendPrompt(deps(f.tmux), 'lane-a', text, opts);
const typed = (keys: string[]): string[] => keys.filter((k) => k.startsWith('lit:'));

/** The post-submit capture on which the pop's fresh read lands: one `submitted` poll, then `STASH_TRIES` restore polls. */
const POP_CAPTURE = 1 + STASH_TRIES + 1;

afterEach(() => { vi.restoreAllMocks(); });

describe("onDraft: 'stash' (D-5911)", () => {
  it("a draft pane: `C-s`, then the text, then Enter, in that order; the result is `ok` with `draftRestore:'restored'`", async () => {
    // The recorded panes, phase by phase: the draft, the box after `C-s`, the box with our text and the stash held,
    // and the box after submit with the draft restored.
    const keys: string[] = [];
    let phase: 'draft' | 'stashed' | 'typed' | 'submitted' = 'draft';
    const PANES = {
      draft: capture('stash-draft.ansi'), stashed: capture('stash-after-cs.ansi'),
      typed: capture('stash-held-with-text.ansi'), submitted: capture('stash-restored.ansi'),
    };
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'capture-pane') return { code: 0, stdout: PANES[phase], stderr: '' };
      if (args[0] === 'send-keys') {
        const k = args[3] === '-l' ? `lit:${args.at(-1)}` : args.at(-1)!;
        keys.push(k);
        if (k === 'C-s' && phase === 'draft') phase = 'stashed';
        else if (k.startsWith('lit:') && phase === 'stashed') phase = 'typed';
        else if (k === 'Enter' && phase === 'typed') phase = 'submitted';
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const res = await sendPrompt(deps(new Tmux(run)), 'lane-a', 'second thing typed', STASH);
    expect(keys).toEqual(['C-s', 'lit:second thing typed', 'Enter']);
    expect(res).toEqual({ ok: true, draftRestore: 'restored' });
  });

  it('the same over the fake: a multi-line draft is stashed whole and read back whole', async () => {
    const f = fakeCc({ box: ['first line of a note', 'second line of a note'] });
    const res = await send(f, 'hello from the lane');
    expect(f.keys).toEqual(['C-s', 'lit:hello from the lane', 'Enter']);
    expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    expect(f.state.history).toEqual(['hello from the lane']);
    expect(f.state.box).toEqual(['first line of a note', 'second line of a note']);
  });

  describe('the submit proof on the stash path', () => {
    it("a stashed `/clear` draft is not submitted by the `/clear` send's retry Enter", async () => {
      const f = fakeCc({ box: ['/clear'] });
      const res = await send(f, '/clear');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(f.state.history).toEqual(['/clear']);
      expect(f.state.box).toEqual(['/clear']);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    });

    it('a restored draft that starts with the needle gets no second Enter', async () => {
      const f = fakeCc({ box: ['hello world, and the rest of a half typed thought'] });
      const res = await send(f, 'hello world');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(f.state.history).toEqual(['hello world']);
      expect(f.state.box).toEqual(['hello world, and the rest of a half typed thought']);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    });

    it('a box that could be the restored draft, mid-render, gets no retry Enter: `ok` unverified when a turn started', async () => {
      const draft = 'hello world, and the rest of a half typed thought';
      const f = fakeCc({
        box: [draft], runOnSubmit: true,
        // The restore renders a prefix of the draft on every read after submit.
        afterSubmit: (_k, s) => { s.box = ['hello world, and the rest']; },
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = await send(f, 'hello world');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(f.keys.filter((k) => k === 'C-s')).toHaveLength(1);
      expect(res).toEqual({ ok: true, draftRestore: 'restore-unverified' });
      expect(warn).toHaveBeenCalled();
    });

    it('…and `enter-ignored` with no rescue claim when nothing proves the turn started', async () => {
      const f = fakeCc({
        box: ['hello world, and the rest of a half typed thought'],
        afterSubmit: (_k, s) => { s.box = ['hello world, and the rest']; },
      });
      const res = await send(f, 'hello world');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toBe('enter-ignored');
      // The box may be the human's draft: no correspondence claim, no rescue flag.
      expect(res.submittable).toBeUndefined();
      expect(res.draft).toBeUndefined();
    });

    it('D-6008: our own text equal to the stashed draft, Enter swallowed, is still ours while the stash is held', async () => {
      // A human `/clear` stashed around dispatch's `/clear`, and the first Enter lost: the box reads `/clear` either
      // way, and only the held-stash indicator tells "ours, unsent" from "submitted and restored".
      const f = fakeCc({ box: ['/clear'], swallowEnters: 1 });
      const res = await send(f, '/clear');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(2);
      expect(f.state.history).toEqual(['/clear']);
      expect(f.state.box).toEqual(['/clear']);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    });
    it('D-6009: the word "stashed" in a transcript or todo row is not the indicator: a restored draft gets no second Enter', async () => {
      for (const row of ['⏺ I stashed the WIP with git stash and rebased', '  ☐ Restore the stashed changes', '⏺ The notice reads › stashed · while a stash is held']) {
        const draft = 'hello world, and the rest of a half typed thought';
        const f = fakeCc({ box: [draft], afterSubmit: (_k, s) => { s.above = row; } });
        const res = await send(f, 'hello world');
        expect(f.keys.filter((k) => k === 'Enter'), row).toHaveLength(1);
        expect(f.state.history, row).toEqual(['hello world']);
        expect(f.state.box, row).toEqual([draft]);
        expect(res, row).toEqual({ ok: true, draftRestore: 'restored' });
      }
      // …nor does a notification row that says "stashed" without the measured ` › stashed ·` form.
      const draft = 'hello world, and the rest of a half typed thought';
      const f = fakeCc({ box: [draft], afterSubmit: (_k, s) => { s.notice = ' 2 changes stashed'; } });
      const res = await send(f, 'hello world');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(f.state.history).toEqual(['hello world']);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    });

    it('D-6009: the word "stashed" in a transcript row does not refuse `stash-occupied`', async () => {
      const f = fakeCc({ box: ['a half typed note'], above: '⏺ I stashed the WIP with git stash' });
      const res = await send(f, 'hello from the lane');
      expect(f.keys).toEqual(['C-s', 'lit:hello from the lane', 'Enter']);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    });

    it('D-6008: while the stash is held, our text that is only a PREFIX of the stashed draft gets no retry Enter', async () => {
      const f = fakeCc({ box: ['hello world, and the rest of a half typed thought'], swallowEnters: 1 });
      const res = await send(f, 'hello world');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(f.state.history).toEqual([]);
      // D-6010: the stash is still held, so the box is ours: cleared, and the draft popped back.
      expect(res).toMatchObject({ ok: false, error: 'enter-ignored-restored' });
      expect(f.state.box).toEqual(['hello world, and the rest of a half typed thought']);
      expect(f.state.stash).toBeNull();
    });

    it('a turn already running before the call proves nothing: a mid-render box is `enter-ignored`, one Enter', async () => {
      const f = fakeCc({
        box: ['hello world, and the rest of a half typed thought'], running: true,
        afterSubmit: (_k, s) => { s.box = ['hello world, and the rest']; },
      });
      const res = await send(f, 'hello world');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toBe('enter-ignored');
      expect(res.submittable).toBeUndefined();
      expect(res.draft).toBeUndefined();
    });
  });

  describe('the restore', () => {
    it('restore missing, box empty: one `C-s` pop, then verified', async () => {
      const f = fakeCc({ box: ['a half typed note'], restoreOnSubmit: false });
      const res = await send(f, 'hello from the lane');
      expect(f.keys).toEqual(['C-s', 'lit:hello from the lane', 'Enter', 'C-s']);
      expect(f.state.box).toEqual(['a half typed note']);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    });

    it("restore still missing: `ok` with `draftRestore:'restore-unverified'`, and a warn line", async () => {
      const f = fakeCc({ box: ['a half typed note'], restoreOnSubmit: false, popWorks: false });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = await send(f, 'hello from the lane');
      expect(f.keys).toEqual(['C-s', 'lit:hello from the lane', 'Enter', 'C-s']);
      expect(res).toEqual({ ok: true, draftRestore: 'restore-unverified' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toMatch(/^ccrc-server: /);
    });

    it('a restore that lands between the last capture and the pop: no `C-s` is sent', async () => {
      const f = fakeCc({
        box: ['a half typed note'], restoreOnSubmit: false,
        afterSubmit: (k, s) => { if (k === POP_CAPTURE && s.stash !== null) { s.box = s.stash; s.stash = null; } },
      });
      const res = await send(f, 'hello from the lane');
      expect(f.keys).toEqual(['C-s', 'lit:hello from the lane', 'Enter']);
      expect(f.state.box).toEqual(['a half typed note']);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    });

    it('no held-stash indicator at the pop: no `C-s` is sent, `restore-unverified`', async () => {
      // The stash was already restored and consumed (or cleared) by the human: a `C-s` cannot bring it back.
      const f = fakeCc({
        box: ['a half typed note'], restoreOnSubmit: false,
        afterSubmit: (k, s) => { if (k === 1) s.stash = null; },
      });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = await send(f, 'hello from the lane');
      expect(f.keys).toEqual(['C-s', 'lit:hello from the lane', 'Enter']);
      expect(res).toEqual({ ok: true, draftRestore: 'restore-unverified' });
    });

    it("a dialog open at the pop's capture: no `C-s` is sent", async () => {
      const f = fakeCc({
        box: ['a half typed note'], restoreOnSubmit: false,
        afterSubmit: (k, s) => { if (k === POP_CAPTURE) s.menu = true; },
      });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = await send(f, 'hello from the lane');
      expect(f.keys).toEqual(['C-s', 'lit:hello from the lane', 'Enter']);
      expect(res).toEqual({ ok: true, draftRestore: 'restore-unverified' });
    });
  });

  describe('the refusals', () => {
    it('the box not empty after `C-s`: `stash-failed`, and nothing typed', async () => {
      const f = fakeCc({ box: ['a half typed note'], stashKey: 'inert' });
      const res = await send(f, 'hello from the lane');
      expect(f.keys).toEqual(['C-s']);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('stash-failed');
      expect(f.state.box).toEqual(['a half typed note']);
    });

    it('a held-stash indicator: `stash-occupied`, and no key sent', async () => {
      const f = fakeCc({ box: ['newer text'], stash: ['an earlier stashed note'] });
      const res = await send(f, 'hello from the lane');
      expect(f.keys).toEqual([]);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('stash-occupied');
      expect(f.state.stash).toEqual(['an earlier stashed note']);
    });

    it('the held-stash indicator is read from the recorded panes too', async () => {
      for (const name of ['stash-held-with-text.ansi', 'stash-held-during-turn.ansi']) {
        const keys: string[] = [];
        const run: Runner = async (_cmd, args) => {
          if (args[0] === 'capture-pane') {
            // The running-turn capture has an empty box; give it a draft so the carrier is asked.
            const pane = capture(name).replace(/❯ (\x1b\[39m)?\n/, '❯ a draft$1\n');
            return { code: 0, stdout: pane, stderr: '' };
          }
          if (args[0] === 'send-keys') keys.push(args.at(-1)!);
          return { code: 0, stdout: '', stderr: '' };
        };
        const res = await sendPrompt(deps(new Tmux(run)), 'lane-a', 'hello', STASH);
        expect(keys, name).toEqual([]);
        expect(res, name).toMatchObject({ ok: false, error: 'stash-occupied' });
      }
    });

    it('the auto-continue hold and `turn-running` refuse before `C-s`', async () => {
      const armed = fakeCc({ box: ['a half typed note'], armed: true });
      expect(await send(armed, 'hi', { ...STASH, holdIfAutoContinueArmed: true })).toMatchObject({ ok: false, error: 'auto-continue-armed' });
      expect(armed.keys).toEqual([]);
      const running = fakeCc({ box: ['a half typed note'], running: true });
      expect(await send(running, 'hi', { ...STASH, refuseIfTurnRunning: true })).toMatchObject({ ok: false, error: 'turn-running' });
      expect(running.keys).toEqual([]);
    });

    it('`dialog-open` refuses before `C-s`', async () => {
      const f = fakeCc({ box: ['a half typed note'], menu: true });
      expect(await send(f, 'hi')).toEqual({ ok: false, error: 'dialog-open' });
      expect(f.keys).toEqual([]);
    });
  });

  describe('D-6010: a send that fails after its `C-s` gives the draft back', () => {
    const DRAFT = ['a half typed note'];
    const pops = (keys: string[]): number => keys.filter((k) => k === 'C-s').length;
    // Each arm ends with the human's draft back in the box, the stash empty, and the refusal's word unchanged.
    const givenBack = (f: ReturnType<typeof fakeCc>, res: SendResult, error: string): void => {
      expect(res).toMatchObject({ ok: false, error });
      expect(f.state.stash, 'the draft is not left in the stash').toBeNull();
      expect(f.state.box).toEqual(DRAFT);
      expect(f.state.history, 'nothing was submitted').toEqual([]);
      expect(pops(f.keys), 'one stash, one pop').toBe(2);
    };

    it('`type-failed` mid-message: our partial text is cleared and the stash popped', async () => {
      const f = fakeCc({ box: [...DRAFT], failLiteral: 2 });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = await send(f, 'first line of ours\nsecond line of ours');
      givenBack(f, res, 'type-failed');
      expect(f.keys.indexOf('C-u')).toBeGreaterThan(f.keys.indexOf('lit:second line of ours'));
    });

    it('`verify-failed` (the echo never rendered): the empty box takes the pop', async () => {
      const f = fakeCc({ box: [...DRAFT], dropLiterals: true });
      const res = await send(f, 'hello from the lane');
      givenBack(f, res, 'verify-failed');
      expect(f.keys).not.toContain('C-u');
    });

    it('`box-unreadable` (no box on any echo poll): once the box is back, our text is cleared and the stash popped', async () => {
      const f = fakeCc({ box: [...DRAFT], blindAfterType: { kind: 'no-box', captures: ECHO_WAIT_POLLS } });
      const res = await send(f, 'hello from the lane');
      givenBack(f, res, 'box-unreadable');
    });

    it('`not-alive` (every echo capture failed): once the pane reads again, our text is cleared and the stash popped', async () => {
      const f = fakeCc({ box: [...DRAFT], blindAfterType: { kind: 'dead', captures: ECHO_WAIT_POLLS } });
      const res = await send(f, 'hello from the lane');
      givenBack(f, res, 'not-alive');
    });

    it('`enter-ignored` (both Enters swallowed): our text cleared, the stash popped, `enter-ignored-restored`, no rescue claim', async () => {
      const f = fakeCc({ box: [...DRAFT], swallowEnters: 2 });
      const res = await send(f, 'hello from the lane');
      givenBack(f, res, 'enter-ignored-restored');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(2);
      expect(res).not.toHaveProperty('draft');
      expect(res).not.toHaveProperty('submittable');
    });

    it('`enter-ignored` whose pop does not land: `enter-ignored-restored` still (our text is gone), the draft in the stash, a warn line', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const f = fakeCc({ box: [...DRAFT], swallowEnters: 2, popWorks: false });
      const res = await send(f, 'hello from the lane');
      expect(res).toMatchObject({ ok: false, error: 'enter-ignored-restored' });
      expect(res).not.toHaveProperty('draft');
      expect(f.state.box.filter((r) => r.trim() !== '')).toEqual([]);
      expect(f.state.stash).toEqual(DRAFT);
      expect(f.state.history).toEqual([]);
      expect(warn).toHaveBeenCalled();
    });

    it('`restore-unverified` (a turn started over a box that could be the restore): a stash still held on an empty box is popped', async () => {
      const draft = 'hello world, and the rest of a half typed thought';
      const f = fakeCc({
        box: [draft], restoreOnSubmit: false, runOnSubmit: true,
        // Every submit poll reads a prefix of the draft (maybe the restore mid-render); then the box is empty with
        // the stash still held: the restore never landed.
        afterSubmit: (k, s) => {
          if (k <= SUBMIT_TRIES) s.box = ['hello world, and the rest'];
          else if (k === SUBMIT_TRIES + 1) s.box = [];
        },
      });
      const res = await send(f, 'hello world');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(pops(f.keys)).toBe(2);
      expect(f.state.stash).toBeNull();
      expect(f.state.box).toEqual([draft]);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    });

    it('`stash-failed` with the stash landing after the budget: the late stash is popped back', async () => {
      const f = fakeCc({ box: [...DRAFT] });
      let captures = 0;
      let late = false;
      const tmux = f.tmux;
      const capture = tmux.captureAnsi.bind(tmux);
      const key = tmux.sendKey.bind(tmux);
      // The first `C-s` lands only after the last of the budget's polls, before the give-back's fresh capture.
      tmux.sendKey = async (id: string, k: string) => {
        if (k === 'C-s' && !late) { late = true; f.keys.push(k); return true; }
        return key(id, k);
      };
      tmux.captureAnsi = async (id: string) => {
        if (++captures === 2 + STASH_TRIES) { f.state.stash = f.state.box; f.state.box = []; }
        return capture(id);
      };
      const res = await send(f, 'hello from the lane');
      expect(res).toMatchObject({ ok: false, error: 'stash-failed' });
      expect(f.keys.filter((k) => k === 'C-s'), 'the late stash, then its pop').toHaveLength(2);
      expect(f.state.stash).toBeNull();
      expect(f.state.box).toEqual(DRAFT);
      expect(typed(f.keys)).toEqual([]);
    });

    it('no stash held at the give-back: nothing is pressed, even over a box that reads like a prefix of ours', async () => {
      // The human popped their own stash (ctrl+s) while our echo never rendered: the box holds their draft, which is a
      // prefix of what we typed. With no stash held the box cannot be ours over a stash, so it is never cleared.
      const f = fakeCc({ box: ['hello world'], dropLiterals: true });
      const tmux = f.tmux;
      const capture = tmux.captureAnsi.bind(tmux);
      tmux.captureAnsi = async (id: string) => {
        if (typed(f.keys).length > 0 && f.state.stash !== null) { f.state.box = f.state.stash; f.state.stash = null; }
        return capture(id);
      };
      const res = await send(f, 'hello world, said the lane');
      expect(res).toMatchObject({ ok: false, error: 'verify-failed' });
      expect(f.keys).not.toContain('C-u');
      expect(pops(f.keys), 'only the stash itself').toBe(1);
      expect(f.state.box).toEqual(['hello world']);
    });

    it('text in the box this send cannot prove its own is left alone, with a warn line', async () => {
      // Both Enters swallowed, and the human typed over our text meanwhile: not a prefix of ours, never cleared.
      const f = fakeCc({
        box: [...DRAFT], swallowEnters: 2,
      });
      const tmux = f.tmux;
      const orig = tmux.sendKey.bind(tmux);
      let enters = 0;
      tmux.sendKey = async (id: string, key: string) => {
        const r = await orig(id, key);
        if (key === 'Enter' && ++enters === 2) f.state.box = ['hello from the lane, and someone kept typing'];
        return r;
      };
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = await send(f, 'hello from the lane');
      expect(res).toMatchObject({ ok: false, error: 'enter-ignored' });
      expect(f.keys).not.toContain('C-u');
      expect(pops(f.keys)).toBe(1);
      expect(f.state.box).toEqual(['hello from the lane, and someone kept typing']);
      expect(f.state.stash).toEqual(DRAFT);
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('D-6011: `resumeIfOwn` with a stash held', () => {
    it('a restored human draft that begins with the needle never takes the retry Enter (a turn started: `ok`)', async () => {
      // An earlier stash-path send left our nudge in the box over a held stash. The resume's Enter submits it and
      // Claude Code restores the stash: a human draft that starts with the same 24 characters.
      const nudge = 'you have mail waiting for you, fetch it';
      const human = `${nudge.slice(0, 30)} and then the human kept typing`;
      const f = fakeCc({ box: [nudge], stash: [human], runOnSubmit: true });
      const res = await send(f, nudge, { ...STASH, resumeIfOwn: true });
      expect(f.keys).toEqual(['Enter']);
      expect(f.state.history).toEqual([nudge]);
      expect(f.state.box).toEqual([human]);
      expect(res).toEqual({ ok: true });
    });

    it('…and with no turn to prove the submit, `enter-ignored` with no rescue claim, still one Enter', async () => {
      const nudge = 'you have mail waiting for you, fetch it';
      const human = `${nudge.slice(0, 30)} and then the human kept typing`;
      const f = fakeCc({ box: [nudge], stash: [human] });
      const res = await send(f, nudge, { ...STASH, resumeIfOwn: true });
      expect(f.keys).toEqual(['Enter']);
      expect(f.state.box).toEqual([human]);
      expect(res).toMatchObject({ ok: false, error: 'enter-ignored' });
      expect(res).not.toHaveProperty('draft');
      expect(res).not.toHaveProperty('submittable');
    });

    it('…and while the stash still shows, our unsent text still gets the retry Enter', async () => {
      const nudge = 'you have mail waiting for you, fetch it';
      const f = fakeCc({ box: [nudge], stash: ['an earlier human note'], swallowEnters: 1 });
      const res = await send(f, nudge, { ...STASH, resumeIfOwn: true });
      expect(f.keys).toEqual(['Enter', 'Enter']);
      expect(f.state.history).toEqual([nudge]);
      expect(res).toEqual({ ok: true });
    });

    it("D-6367: `resumeIfOwn: 'whole'` over a held stash goes through the held-stash submit: a swallowed Enter gets the retry, the stash stays unsent", async () => {
      const ours = 'please review the latest diff of the module';
      const f = fakeCc({ box: [ours], stash: ['an earlier human note'], swallowEnters: 1 });
      const res = await send(f, ours, { resumeIfOwn: 'whole' });
      expect(f.keys).toEqual(['Enter', 'Enter']);
      expect(f.state.history).toEqual([ours]);
      expect(f.state.box).toEqual(['an earlier human note']);
      expect(res).toEqual({ ok: true });
    });

    // The whole-mode twins of the prefix mode's gates: the resume's `submit` is `submitOverHeldStash`, so the
    // indicator gate and the blind-watch rule bind it too. A bypass to `pressEnterAndConfirm` keeps the retry Enter.
    it("D-6367: `resumeIfOwn: 'whole'` over a held stash: a capture missing the indicator after a swallowed Enter is not a delivery", async () => {
      const ours = 'please review the latest diff of the module';
      const f = fakeCc({ box: [ours], stash: ['an earlier human note'], swallowEnters: 1, hideAfterSwallow: 1 });
      const res = await send(f, ours, { resumeIfOwn: 'whole' });
      expect(f.state.history).toEqual([]);
      expect(res).toMatchObject({ ok: false, error: 'enter-ignored' });
      expect(res).not.toHaveProperty('submittable');
      expect(f.keys).toEqual(['Enter']);
    });

    it("D-6367: `resumeIfOwn: 'whole'` over a held stash: a watch that went blind after reading our box buys no retry Enter", async () => {
      const ours = 'please review the latest diff of the module';
      const human = 'an earlier human note';
      // One good read of our text, the Enter landing at capture 2, every capture after it failing to the end of the watch.
      const f = fakeCc({ box: [ours], stash: [human], landAtCapture: 2, failCapture: (k) => k >= 2 && k <= SUBMIT_TRIES });
      const res = await send(f, ours, { resumeIfOwn: 'whole' });
      expect(f.keys).toEqual(['Enter']);
      expect(f.state.history).toEqual([ours]);
      expect(f.state.box).toEqual([human]);
      expect(res).toEqual({ ok: true });
    });

    it("D-6367: `resumeIfOwn: 'whole'` never stashes (onDraft is not consulted) and its Enter's restore is not mistaken for our text", async () => {
      const ours = 'please review the latest diff of the module';
      const human = `${ours.slice(0, 30)} and then the human kept typing`;
      const f = fakeCc({ box: [ours], stash: [human] });
      const res = await send(f, ours, { ...STASH, resumeIfOwn: 'whole' });
      expect(f.keys).toEqual(['Enter']);
      expect(f.state.history).toEqual([ours]);
      expect(f.state.box).toEqual([human]);
      expect(res).toEqual({ ok: true });
    });

    it('post-merge review: a capture missing the indicator after a swallowed Enter is not a delivery', async () => {
      const nudge = 'you have mail waiting for you, fetch it';
      const f = fakeCc({ box: [nudge], stash: ['an earlier human note'], swallowEnters: 1, hideAfterSwallow: 1 });
      const res = await send(f, nudge, { ...STASH, resumeIfOwn: true });
      expect(f.state.history).toEqual([]);
      expect(res).not.toEqual({ ok: true });
      expect(res).toMatchObject({ ok: false, error: 'enter-ignored' });
      expect(res).not.toHaveProperty('submittable');
      expect(f.keys).toEqual(['Enter']);
    });
  });

  describe('D-6011: the ordinary submit on an empty box with a stash already held', () => {
    // The precondition is reachable from D-6010's own failure arm (a pop that does not land leaves the box empty and
    // the stash held) as well as from a human's own ctrl+s. Claude Code restores the held stash at OUR submit.
    it("dispatch's `/clear` over a held `/clear …` stash: one Enter, the human's draft back in the box, unsent", async () => {
      // A slash command starts no turn, so nothing proves the submit: refused without a rescue claim, never a
      // retry Enter onto the human's restored draft.
      const human = '/clear and also my note';
      const f = fakeCc({ box: [], stash: [human] });
      const res = await send(f, '/clear');
      expect(f.keys).toEqual(['lit:/clear', 'Enter']);
      expect(f.state.history).toEqual(['/clear']);
      expect(f.state.box).toEqual([human]);
      expect(res).toMatchObject({ ok: false, error: 'enter-ignored' });
      expect(res).not.toHaveProperty('draft');
      expect(res).not.toHaveProperty('submittable');
    });

    it('a mail nudge over a held stash that begins with the needle: one Enter, the human draft unsent', async () => {
      const nudge = 'you have mail waiting for you, fetch it';
      const human = `${nudge.slice(0, 30)} and then the human kept typing`;
      const f = fakeCc({ box: [], stash: [human], runOnSubmit: true });
      const res = await send(f, nudge, { ...STASH, resumeIfOwn: true });
      expect(f.keys).toEqual([`lit:${nudge}`, 'Enter']);
      expect(f.state.history).toEqual([nudge]);
      expect(f.state.box).toEqual([human]);
      expect(res).toEqual({ ok: true });
    });

    it('…a turn already running before the call proves nothing: `enter-ignored`, one Enter', async () => {
      const nudge = 'you have mail waiting for you, fetch it';
      const human = `${nudge.slice(0, 30)} and then the human kept typing`;
      const f = fakeCc({ box: [], stash: [human], running: true });
      const res = await send(f, nudge, { ...STASH, resumeIfOwn: true });
      expect(f.keys).toEqual([`lit:${nudge}`, 'Enter']);
      expect(f.state.box).toEqual([human]);
      expect(res).toMatchObject({ ok: false, error: 'enter-ignored' });
      expect(res).not.toHaveProperty('draft');
    });

    it('…and while the stash still shows, our swallowed text still gets the retry Enter', async () => {
      const f = fakeCc({ box: [], stash: ['an earlier human note'], swallowEnters: 1 });
      const res = await send(f, 'hello from the lane');
      expect(f.keys).toEqual(['lit:hello from the lane', 'Enter', 'Enter']);
      expect(f.state.history).toEqual(['hello from the lane']);
      expect(res).toEqual({ ok: true });
    });

    it('post-merge review: a capture missing the indicator after a swallowed Enter is not a delivery', async () => {
      // The review's probe: one post-Enter frame where the indicator does not parse, our text still in the box.
      const f = fakeCc({ box: [], stash: ['an earlier human note'], swallowEnters: 1, hideAfterSwallow: 1 });
      const res = await send(f, 'hello from the lane');
      expect(f.state.history).toEqual([]);
      expect(f.state.box).toEqual(['hello from the lane']);
      expect(res).not.toEqual({ ok: true });
      expect(res).toMatchObject({ ok: false, error: 'enter-ignored' });
      expect(res).not.toHaveProperty('draft');
      expect(res).not.toHaveProperty('submittable');
      expect(f.keys).toEqual(['lit:hello from the lane', 'Enter']);
    });

    it('…and a box that no longer starts with our needle is still a delivery, indicator or not', async () => {
      const f = fakeCc({ box: [], stash: ['an earlier human note'] });
      const res = await send(f, 'hello from the lane');
      expect(f.keys).toEqual(['lit:hello from the lane', 'Enter']);
      expect(f.state.box).toEqual(['an earlier human note']);
      expect(res).toEqual({ ok: true });
    });
  });

  describe('D-6366: a lost reply after Enter on the stash paths', () => {
    // Captures fail through the whole Enter watch (SUBMIT_TRIES polls) and no retry Enter follows a watch that read no
    // box, so the proof is decided by the final read.
    const BLIND = SUBMIT_TRIES;

    it('around our own stash: a final read without our text runs the restore check and pops the stash', async () => {
      const human = 'a half typed note of the human';
      const f = fakeCc({ box: [human], restoreOnSubmit: false, blindAfterEnter: BLIND });
      const res = await send(f, 'hello from the lane');
      expect(f.keys).toEqual(['C-s', 'lit:hello from the lane', 'Enter', 'C-s']);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
      expect(f.state.history).toEqual(['hello from the lane']);
      expect(f.state.box).toEqual([human]);
      expect(f.state.stash).toBeNull();
    });

    it('around our own stash: the loop\'s own classifier decides at the final read (a restored draft that begins with the needle)', async () => {
      const human = 'hello world, and the rest of a half typed thought';
      // The restore lands after the blind reads, on the final read: the box equals the stash and no indicator shows.
      const f = fakeCc({
        box: [human], restoreOnSubmit: false, blindAfterEnter: BLIND,
        afterSubmit: (k, s) => { if (k === BLIND + 1 && s.stash !== null) { s.box = s.stash; s.stash = null; } },
      });
      const res = await send(f, 'hello world');
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
      expect(f.state.history).toEqual(['hello world']);
      expect(f.state.box).toEqual([human]);
    });

    it('over a stash already held: a final read without our text is ok', async () => {
      const f = fakeCc({ box: [], stash: ['an earlier human note'], restoreOnSubmit: false, blindAfterEnter: BLIND });
      const res = await send(f, 'hello from the lane');
      expect(f.keys).toEqual(['lit:hello from the lane', 'Enter']);
      expect(f.state.history).toEqual(['hello from the lane']);
      expect(res).toEqual({ ok: true });
    });
  });

  describe('D-6366 fix round: a blind watch buys no retry Enter, and the final read judges three ways', () => {
    const human = 'a half typed note of the human';

    it('an all-blind watch never presses a retry Enter onto a restored draft (around our own stash)', async () => {
      // Default `restoreOnSubmit: true`: Claude Code gives the human's draft back at OUR submit, so a retry Enter
      // would submit it. The first Enter landed; its watch read nothing.
      const f = fakeCc({ box: [human], blindAfterEnter: SUBMIT_TRIES });
      const res = await send(f, 'hello from the lane');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(f.state.history).toEqual(['hello from the lane']);
      expect(f.state.box).toEqual([human]);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    });

    it('an all-blind watch never presses a retry Enter onto a restored draft (over a stash already held)', async () => {
      const f = fakeCc({ box: [], stash: [human], blindAfterEnter: SUBMIT_TRIES });
      const res = await send(f, 'hello from the lane');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(f.state.history).toEqual(['hello from the lane']);
      expect(f.state.box).toEqual([human]);
      expect(res).toEqual({ ok: true });
    });

    it('a maybe-restored final read offers no draft and no submittable (around our own stash)', async () => {
      // Both Enters are swallowed (the watches read our text), then a restore render lands between the last poll and
      // the final read: the box is a prefix of the stashed draft, which may be the human's. "Send it" must never get a
      // draft to press Enter on, and the send is not delivered.
      // Our text and the stashed draft share the 24-character needle and differ after it, so the watches read `ours`.
      const stashed = 'please summarise the open issues instead of what I said';
      const f = fakeCc({
        box: [stashed], swallowEnters: 2,
        afterEnter: (n, k, s) => { if (n === 2 && k === SUBMIT_TRIES + 1) s.box = ['please summarise the open iss']; },
      });
      const res = await send(f, 'please summarise the open pull requests');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(2);
      expect(res).toMatchObject({ ok: false, error: 'enter-ignored' });
      expect(res).not.toHaveProperty('draft');
      expect(res).not.toHaveProperty('submittable');
      expect(f.state.history).toEqual([]);
    });

    it('a maybe-restored final read offers no draft and no submittable (over a stash already held)', async () => {
      // Both Enters swallowed; at the final read our text is still the box but the held-stash indicator does not parse.
      const f = fakeCc({
        box: [], stash: ['an earlier human note'], swallowEnters: 2,
        afterEnter: (n, k, s) => { if (n === 2 && k === SUBMIT_TRIES + 1) s.hideIndicator = 2; },
      });
      const res = await send(f, 'hello from the lane');
      expect(res).toMatchObject({ ok: false, error: 'enter-ignored' });
      expect(res).not.toHaveProperty('draft');
      expect(res).not.toHaveProperty('submittable');
      expect(f.state.history).toEqual([]);
    });
  });

  describe('D-6366 fix round 2: a watch that went blind after reading our box buys no retry Enter', () => {
    const human = 'a half typed note of the human';
    const SEVEN = (k: number): boolean => k >= 2 && k <= SUBMIT_TRIES;

    // One good read of our own text (the Enter has not rendered yet), then the Enter lands at capture 2 and every
    // capture after it fails to the end of the watch: the first Enter took, its reply was lost, and Claude Code has
    // given the human's draft back. The watch read our box once, so `pane` is not null; the retry Enter would submit
    // the human's draft.
    it('one good read, then seven failed captures, the Enter landing at capture 2: one Enter (around our own stash)', async () => {
      const f = fakeCc({ box: [human], landAtCapture: 2, failCapture: SEVEN });
      const res = await send(f, 'hello from the lane');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(f.state.history).toEqual(['hello from the lane']);
      expect(f.state.box).toEqual([human]);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    });

    it('one good read, then seven failed captures, the Enter landing at capture 2: one Enter (over a stash already held)', async () => {
      const f = fakeCc({ box: [], stash: [human], landAtCapture: 2, failCapture: SEVEN });
      const res = await send(f, 'hello from the lane');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(f.state.history).toEqual(['hello from the lane']);
      expect(f.state.box).toEqual([human]);
      expect(res).toEqual({ ok: true });
    });

    // The same on a clock that moves: each capture costs 200 ms and each sleep its argument, so the blind run spends
    // `SUBMIT_BLIND_MS` and the watch ends on the deadline with the box last read at poll 3.
    const moving = (f: ReturnType<typeof fakeCc>, clock: { t: number }) => ({
      tmux: f.tmux, queue: new KeyedQueue(), sleep: async (ms: number) => { clock.t += ms; }, now: () => clock.t,
    });
    const BLIND_RUN = (k: number): boolean => k >= 4 && k <= 7;

    it('a watch that goes blind after reading our box never presses a retry Enter onto a restored draft (moving clock), around our own stash', async () => {
      const clock = { t: 0 };
      const f = fakeCc({ box: [human], landAtCapture: 4, failCapture: BLIND_RUN, tick: () => { clock.t += 200; } });
      const res = await sendPrompt(moving(f, clock), 'lane-a', 'hello from the lane', STASH);
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(f.state.history).toEqual(['hello from the lane']);
      expect(f.state.box).toEqual([human]);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    });

    it('a watch that goes blind after reading our box never presses a retry Enter onto a restored draft (moving clock), over a stash already held', async () => {
      const clock = { t: 0 };
      const f = fakeCc({ box: [], stash: [human], landAtCapture: 4, failCapture: BLIND_RUN, tick: () => { clock.t += 200; } });
      const res = await sendPrompt(moving(f, clock), 'lane-a', 'hello from the lane', STASH);
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(f.state.history).toEqual(['hello from the lane']);
      expect(f.state.box).toEqual([human]);
      expect(res).toEqual({ ok: true });
    });

    // D-6366 fix round 3. A capture that returns with NO box in it is not a failed capture, but after the last box read it
    // is no better: the Enter may have landed unseen, with the restored draft drawn nowhere. Same shapes, absent boxes.
    const ABSENT_ALL = (k: number): boolean => k >= 1 && k <= SUBMIT_TRIES;
    const ABSENT_AFTER_READ = (k: number): boolean => k >= 2 && k <= SUBMIT_TRIES;

    it('an all-absent first watch (no capture shows a box, the Enter landing at capture 1): one Enter (around our own stash)', async () => {
      const f = fakeCc({ box: [human], landAtCapture: 1, absentCapture: ABSENT_ALL });
      const res = await send(f, 'hello from the lane');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(f.state.history).toEqual(['hello from the lane']);
      expect(f.state.box).toEqual([human]);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    });

    it('an all-absent first watch (no capture shows a box, the Enter landing at capture 1): one Enter (over a stash already held)', async () => {
      const f = fakeCc({ box: [], stash: [human], landAtCapture: 1, absentCapture: ABSENT_ALL });
      const res = await send(f, 'hello from the lane');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(f.state.history).toEqual(['hello from the lane']);
      expect(f.state.box).toEqual([human]);
      expect(res).toEqual({ ok: true });
    });

    it('one good read, then seven captures with no box, the Enter landing at capture 2: one Enter (around our own stash)', async () => {
      const f = fakeCc({ box: [human], landAtCapture: 2, absentCapture: ABSENT_AFTER_READ });
      const res = await send(f, 'hello from the lane');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(f.state.history).toEqual(['hello from the lane']);
      expect(f.state.box).toEqual([human]);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    });

    it('one good read, then seven captures with no box, the Enter landing at capture 2: one Enter (over a stash already held)', async () => {
      const f = fakeCc({ box: [], stash: [human], landAtCapture: 2, absentCapture: ABSENT_AFTER_READ });
      const res = await send(f, 'hello from the lane');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(1);
      expect(f.state.history).toEqual(['hello from the lane']);
      expect(f.state.box).toEqual([human]);
      expect(res).toEqual({ ok: true });
    });

    // The overlay-swallow case keeps its retry: every poll after the failed one read our box, so the Enter was
    // swallowed, nothing was restored, and the second Enter is what sends.
    it('a watch that read our box on every poll after its failed capture keeps the retry Enter', async () => {
      const f = fakeCc({ box: [human], swallowEnters: 1, failCapture: (k) => k === 2 });
      const res = await send(f, 'hello from the lane');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(2);
      expect(f.state.history).toEqual(['hello from the lane']);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    });

    // D-6367, R29 F2: the absent-box twins of the case above, one per stash path; a box-less capture resets it too.
    it('a watch that read our box on every poll after its box-less capture keeps the retry Enter (around our own stash)', async () => {
      const f = fakeCc({ box: [human], swallowEnters: 1, absentCapture: (k) => k === 2 });
      const res = await send(f, 'hello from the lane');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(2);
      expect(f.state.history).toEqual(['hello from the lane']);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    });

    it('a watch that read our box on every poll after its box-less capture keeps the retry Enter (over a stash already held)', async () => {
      const f = fakeCc({ box: [], stash: [human], swallowEnters: 1, absentCapture: (k) => k === 2 });
      const res = await send(f, 'hello from the lane');
      expect(f.keys.filter((k) => k === 'Enter')).toHaveLength(2);
      expect(f.state.history).toEqual(['hello from the lane']);
      expect(res).toEqual({ ok: true });
    });
  });

  describe('precedence', () => {
    it('`resumeIfOwn`, `clearMailResidue` and `ownStrandedClear` still win over `stash`', async () => {
      const own = fakeCc({ box: ['hello world'] });
      expect(await send(own, 'hello world', { ...STASH, resumeIfOwn: true })).toEqual({ ok: true });
      expect(own.keys).toEqual(['Enter']);

      const residue = fakeCc({ box: ['```ccrc-mail'] });
      await send(residue, 'hi', { ...STASH, clearMailResidue: true });
      expect(residue.keys[0]).toBe('C-u');
      expect(residue.keys).not.toContain('C-s');

      const stranded = fakeCc({ box: ['/clear'] });
      expect(await send(stranded, '/clear', { ...STASH, ownStrandedClear: true })).toEqual({ ok: true });
      expect(stranded.keys).toEqual(['C-u', 'lit:/clear', 'Enter']);
    });

    it('an unproven `/clear` is stashed, not cleared', async () => {
      const f = fakeCc({ box: ['/clear'] });
      const res = await send(f, 'hello from the lane');
      expect(f.keys).toEqual(['C-s', 'lit:hello from the lane', 'Enter']);
      expect(f.state.box).toEqual(['/clear']);
      expect(res).toEqual({ ok: true, draftRestore: 'restored' });
    });

    it('`onDraft` omitted: `draft-present`, as today', async () => {
      const f = fakeCc({ box: ['a half typed note'] });
      expect(await send(f, 'hi', {})).toEqual({ ok: false, error: 'draft-present', draft: 'a half typed note' });
      expect(f.keys).toEqual([]);
    });

    it("`onDraft: 'replace'` clears, and never stashes", async () => {
      const f = fakeCc({ box: ['a half typed note'] });
      expect(await send(f, 'hi', { onDraft: 'replace' } as SendOpts)).toEqual({ ok: true });
      expect(f.keys[0]).toBe('C-u');
      expect(f.keys).not.toContain('C-s');
    });

    it('an empty box takes no `C-s` and reports no restore', async () => {
      const f = fakeCc({ box: [] });
      expect(await send(f, 'hi')).toEqual({ ok: true });
      expect(f.keys).toEqual(['lit:hi', 'Enter']);
    });
  });
});
