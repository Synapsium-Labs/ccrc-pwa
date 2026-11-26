// Desktop polish wave 185 (task note docs/superpowers/programs/desktop-polish/tall-draft-submit.md): a box whose own
// marker row is out of view, and the readers that anchored on the row above it.
//
// SYNTHETIC PANES. Every pane named `SYNTHETIC_*` below is BUILT HERE, not captured. It follows the operator's picture of
// Claude Code 2.1.332 (a box taller than its row cap: a count on its top rule, "↑ 156 more", and no prompt glyph on the
// first row in view) and the past-turn rows a recorded 2.1.332 pane shows (`fixtures/panes/box/placeholder-error-hint-*`).
// The real build's bytes are not on record yet, so no case here makes a claim about that build: each makes a claim about
// a SHAPE. The one recorded pane used (`cc300-paste-empty-box.txt`, Claude Code 2.1.300) is the true stranded nudge's box.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyedQueue } from '../src/inject/queue.js';
import { sendPrompt, submitEnter, readBoxText, draftOfMeasured } from '../src/inject/send.js';
import { Tmux, type Runner } from '../src/exec.js';
import { renderMailNudge } from '../src/coord/envelope.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const noSleep = async () => {};

/** Tmux backed by a fake runner: capture-pane returns scripted panes in order (the last one repeats). */
function fakeTmux(panes: string[]) {
  const calls: string[][] = [];
  let capIdx = 0;
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'capture-pane') {
      const pane = panes[Math.min(capIdx, panes.length - 1)]!;
      capIdx++;
      return { ran: true, code: 0, stdout: pane, stderr: '' };
    }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  return { tmux: new Tmux(run), calls };
}
const keys = (calls: string[][]) => calls.filter((c) => c[1] === 'send-keys').map((c) => c[c.length - 1]!);
/** A clock that moves 50 ms a read, so `clearBox`'s budget ends a press loop on a pane that never changes. */
const ticking = () => { let t = 0; return () => (t += 50); };

const W = 220;
const NUDGE = renderMailNudge('x');
/** The mail lane's own options for the generic nudge (`watch.ts`'s send, `resumeRuleOf`'s generic answer). */
const LANE = { onDraft: 'stash', resumeIfOwn: true, clearMailResidue: true, holdIfAutoContinueArmed: true } as const;

/** A past user turn as Claude Code draws it above the box (2.1.300 and 2.1.332 alike): glyph, grey background. */
const pastTurn = (t: string) => `\x1b[38;5;246m\x1b[48;5;237m❯ \x1b[38;5;231m${t}\x1b[39m\x1b[49m`;
const PLAIN_RULE = `\x1b[38;5;244m${'─'.repeat(W)}\x1b[39m`;
const countRule = (n: number) => `\x1b[38;5;244m${'─'.repeat(W - 16)} ↑ ${n} more ──\x1b[39m`;

/** SYNTHETIC: a 50-row pane whose last past user turn is `turn` (on `turnRows` rows), then a tall box of 20 rows with NO
 *  glyph in view under `top` (a count rule, or a plain one for a form nobody has measured), then its closing rule. */
function SYNTHETIC_tallBox(turn: string, top: string, turnRows: 1 | 2 = 1): string {
  const head = turnRows === 1 ? [pastTurn(turn.slice(0, W - 2))] : [pastTurn(turn.slice(0, 120)), `  ${turn.slice(120, 240)}`];
  const above = [...head, '', '\x1b[38;5;231m⏺\x1b[39m ok', ''];
  const box = Array.from({ length: 20 }, (_, i) => `  person line ${157 + i} of the draft they are still writing`);
  const foot = ['  \x1b[38;5;220m⏵⏵ auto mode on\x1b[39m'];
  const fill = 50 - above.length - 2 - box.length - foot.length;
  return [...above, ...Array<string>(fill).fill(''), top, ...box, PLAIN_RULE, ...foot].join('\n') + '\n';
}
/** SYNTHETIC: after an Enter took the box: the person's first line is the newest past turn, the box is empty. */
const SYNTHETIC_AFTER_SUBMIT = [pastTurn('person line 1 of the draft they are still writing'), ...Array<string>(45).fill(''),
  PLAIN_RULE, '\x1b[39m❯ ', PLAIN_RULE, '  auto mode on'].join('\n') + '\n';

/** RECORDED (Claude Code 2.1.300, 220x50): an empty box. The true stranded nudge is this box holding the nudge, wrapped
 *  at a space onto a continuation row as the build wraps a line longer than the box. */
const EMPTY_300 = readFileSync(path.join(here, 'fixtures/panes/cc300-paste-empty-box.txt'), 'utf8');
function strandedNudge300(): string {
  const cut = NUDGE.lastIndexOf(' ', W - 4);
  const lines = EMPTY_300.split('\n');
  const marker = lines.findLastIndex((l) => l.includes('❯'));
  lines.splice(marker, 1, `\x1b[39m❯ ${NUDGE.slice(0, cut)}`, `  ${NUDGE.slice(cut + 1)}`);
  return lines.join('\n');
}
const EMPTIED_300 = EMPTY_300;

describe('wave 185, point 1: the resume presses Enter only on a box read whole and closed', () => {
  it('a past generic nudge above a box whose marker is out of view is not resumed: no Enter on the person\'s draft', async () => {
    // A form nobody has measured (a plain top rule, no glyph in view), so the labelled-rule guard does not fire and this
    // case stands on the resume's own proof alone.
    const { tmux, calls } = fakeTmux([SYNTHETIC_tallBox(NUDGE, PLAIN_RULE)]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', NUDGE, LANE);
    expect(keys(calls)).not.toContain('Enter');
    // The lane's next arm: the box is stashed whole (C-s), never submitted. This static pane never empties after it, so
    // the stash is reported failed; on a real pane the box empties, the nudge is typed, and the build restores the draft.
    expect(res).toMatchObject({ ok: false, error: 'stash-failed' });
  });

  it('the same with the past nudge wrapped over two rows', async () => {
    const { tmux, calls } = fakeTmux([SYNTHETIC_tallBox(NUDGE, PLAIN_RULE, 2)]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', NUDGE, LANE);
    expect(keys(calls)).not.toContain('Enter');
    expect(res).toMatchObject({ ok: false, error: 'stash-failed' });
  });

  it('a longer draft that starts with our text is not resumed (draft-present, no key)', async () => {
    const box = ['earlier turn', '─'.repeat(60), `❯ ${NUDGE.slice(0, 80)} and then the person kept typing`, '─'.repeat(60), '  footer'].join('\n') + '\n';
    const { tmux, calls } = fakeTmux([box]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', NUDGE.slice(0, 80), { resumeIfOwn: true });
    expect(res).toMatchObject({ ok: false, error: 'draft-present' });
    expect(keys(calls)).toEqual([]);
  });

  it('the true stranded nudge, on a recorded 2.1.300 box, still resumes with one Enter and nothing typed', async () => {
    const { tmux, calls } = fakeTmux([strandedNudge300(), EMPTIED_300]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', NUDGE, LANE);
    expect(res).toEqual({ ok: true });
    expect(keys(calls)).toEqual(['Enter']);
  });
});

describe('wave 185, point 2: a labelled rule below the last glyph row means the box\'s marker is out of view', () => {
  const PANE = SYNTHETIC_tallBox(NUDGE, countRule(156));
  const OTHER = SYNTHETIC_tallBox('an older question about the release notes for this week', countRule(156));

  it('the box reads absent, not the past turn', () => {
    expect(draftOfMeasured(PANE)).toEqual({ box: 'absent' });
    expect(draftOfMeasured(OTHER)).toEqual({ box: 'absent' });
  });

  it('the mail lane presses nothing at all and answers box-unreadable', async () => {
    const { tmux, calls } = fakeTmux([PANE, SYNTHETIC_AFTER_SUBMIT]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', NUDGE, LANE);
    expect(res).toMatchObject({ ok: false, error: 'box-unreadable' });
    expect(keys(calls)).toEqual([]);
  });

  it('Replace fires no C-u into it (it pressed 24 before), and answers box-unreadable', async () => {
    const { tmux, calls } = fakeTmux([OTHER]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep, now: ticking() }, 'x', 'hello there', { onDraft: 'replace' });
    expect(res).toMatchObject({ ok: false, error: 'box-unreadable' });
    expect(keys(calls)).toEqual([]);
  });

  it('the refusal no longer shows the past turn as the person\'s draft', async () => {
    const { tmux } = fakeTmux([OTHER]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hello there');
    expect(res).toMatchObject({ ok: false, error: 'box-unreadable' });
    expect(res).not.toHaveProperty('draft');
  });

  it('the park probe reads it as unreadable, and the rescue Enter refuses it', async () => {
    const q = new KeyedQueue();
    expect(await readBoxText({ tmux: fakeTmux([OTHER]).tmux, queue: q }, 'x')).toBeNull();
    const s = fakeTmux([OTHER]);
    expect(await submitEnter({ tmux: s.tmux, queue: q, sleep: noSleep }, 'x', 'an older question about the release notes for this week'))
      .toEqual({ ok: false, error: 'box-unreadable' });
    expect(keys(s.calls)).toEqual([]);
  });

  it('the count may sit near the rule\'s left, after a run of three or more rule characters', () => {
    const left = SYNTHETIC_tallBox(NUDGE, `\x1b[38;5;244m─── ↑ 3 more ${'─'.repeat(W - 13)}\x1b[39m`);
    expect(draftOfMeasured(left)).toEqual({ box: 'absent' });
  });

  it('a row that does not start at the first column with rule characters is not a labelled rule (no change)', () => {
    const indented = SYNTHETIC_tallBox('an older question', `  ${'─'.repeat(40)} ↑ 156 more ${'─'.repeat(40)}`);
    expect(draftOfMeasured(indented)).toEqual({ box: 'present', draft: 'an older question' });
    const wordsFirst = SYNTHETIC_tallBox('an older question', `↑ 156 more ${'─'.repeat(W - 12)}`);
    expect(draftOfMeasured(wordsFirst)).toEqual({ box: 'present', draft: 'an older question' });
  });
});

/**
 * A box that follows the keys, drawn as Claude Code 2.1.300 draws a short one (recorded panes: the marker row starts with
 * the glyph, every row below it is indented two columns, a plain rule above and below the box at the first column), so a
 * send's captures show what it typed. Enter submits: the text becomes a past turn and the box empties.
 */
function followingBox() {
  const lines: string[] = [''];
  const turns: string[] = [];
  const calls: string[][] = [];
  const render = () => [...turns.map(pastTurn), '', '─'.repeat(80),
    `\x1b[39m❯ ${lines[0]}`, ...lines.slice(1).map((l) => (l === '' ? '' : `  ${l}`)), '─'.repeat(80), '  footer'].join('\n') + '\n';
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: render(), stderr: '' };
    if (args[0] === 'send-keys') {
      const key = args[args.length - 1]!;
      if (args.includes('-l')) lines[lines.length - 1] += key;
      else if (key === 'M-Enter') lines.push('');
      else if (key === 'Enter') { turns.push(lines[0]!); lines.splice(0, lines.length, ''); }
    }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  return { tmux: new Tmux(run), calls, turns };
}

describe('wave 185, point 2: our own message holding a rule-like line still types, echoes and submits', () => {
  for (const [name, line] of [
    ['a table\'s crossing line', `${'─'.repeat(12)}┼${'─'.repeat(12)}`],
    ['a labelled line of our own', '─── notes ───'],
  ] as const) {
    it(`${name}: typed, echoed at the marker row and submitted, as on main`, async () => {
      const { tmux, calls, turns } = followingBox();
      const text = `please read these notes\n${line}\nthe end`;
      const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', text);
      expect(res).toEqual({ ok: true });
      expect(turns).toEqual(['please read these notes']);
      expect(keys(calls).filter((k) => k === 'Enter')).toHaveLength(1);
    });
  }
});

describe('wave 185, point 2: the recorded panes', () => {

  it('no recorded pane changes its reading: the guard fires on none of them', () => {
    // The reading before wave 185: the last glyph row, as is.
    const before = (pane: string) => {
      const row = pane.split('\n').filter((l) => l.replace(/\x1b\[[0-9;]*m/g, '').startsWith('❯')).at(-1);
      return row === undefined ? 'absent' : 'present';
    };
    const dir = path.join(here, 'fixtures/panes');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f.endsWith('.txt') || f.endsWith('.ansi')) files.push(p);
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThan(100);
    const moved = files.filter((p) => { const pane = readFileSync(p, 'utf8'); return draftOfMeasured(pane).box !== before(pane); });
    expect(moved).toEqual([]);
  });
});
