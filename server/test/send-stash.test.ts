import { afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyedQueue } from '../src/inject/queue.js';
import { sendPrompt, STASH_TRIES, type SendResult } from '../src/inject/send.js';
import { Tmux, type Runner } from '../src/exec.js';

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
}

interface FakeOpts {
  box?: string[];
  stash?: string[] | null;
  menu?: boolean;
  running?: boolean;
  armed?: boolean;
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
}

const nonBlank = (rows: string[]): boolean => rows.some((r) => r.trim() !== '');

function render(s: Cc): string {
  const lines = ['\x1b[1m❯\x1b[0m an earlier turn', '⏺ done', ''];
  if (s.menu) {
    lines.push(' Pick one', ' ❯ 1. Yes', '   2. No', '', ' Enter to confirm · Esc to cancel');
    return lines.join('\n') + '\n';
  }
  lines.push(s.running ? '✳ Working… (3s · esc to interrupt)' : '');
  lines.push(`\x1b[38;5;246m${s.stash !== null ? ' › stashed ·' : ''}\x1b[39m \x1b[38;5;114m✔ Update installed\x1b[39m`);
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
    menu: o.menu ?? false, running: o.running ?? false, armed: o.armed ?? false,
  };
  const keys: string[] = [];
  let swallow = o.swallowEnters ?? 0;
  let submits = 0;
  let sinceSubmit = 0;
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'capture-pane') {
      if (submits > 0) o.afterSubmit?.(++sinceSubmit, s);
      return { code: 0, stdout: render(s), stderr: '' };
    }
    if (args[0] === 'send-keys') {
      if (args[3] === '-l') {
        const text = args.at(-1)!;
        keys.push(`lit:${text}`);
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
        if (swallow > 0) { swallow--; return { code: 0, stdout: '', stderr: '' }; }
        if (!nonBlank(s.box)) return { code: 0, stdout: '', stderr: '' };
        const sent = s.box.join('\n');
        s.history.push(sent);
        submits++;
        s.box = [];
        if (o.runOnSubmit && !sent.startsWith('/')) s.running = true;
        if (s.stash !== null && (o.restoreOnSubmit ?? true)) { s.box = s.stash; s.stash = null; }
      }
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { tmux: new Tmux(run), keys, state: s };
}

const deps = (tmux: Tmux) => ({ tmux, queue: new KeyedQueue(), sleep: noSleep });
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
