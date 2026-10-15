import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyedQueue } from '../src/inject/queue.js';
import { draftOf, ownPasteChip, ownRenderedBox, sendPrompt, submitEnter } from '../src/inject/send.js';
import { Tmux, type Runner } from '../src/exec.js';

// D-TBD-paste-chip-submit (plan docs/superpowers/plans/2026-10-15-paste-chip-send.md). Claude Code collapses one
// terminal read of more than 800 characters into a chip, `[Pasted text #N]`, and holds the text in full behind it.
// The echo check then never sees our first 24 characters, so `sendPrompt` used to refuse `verify-failed` with
// `submittable` and leave the operator a tap (or, as reported, a trip to the terminal) to send what was already
// typed. It now presses Enter itself, but only on a chip it can prove is its own: the box was proven empty or cleared
// by this call before the type loop, the box now holds exactly ONE chip and nothing else, the chip's line count
// matches the newlines we typed, and what we typed was long enough to collapse. Every other shape keeps today's
// refusal, `submittable` included where it was set.
//
// Every pane here is a RECORDED Claude Code 2.1.300 screen (`fixtures/panes/cc300-paste-*.txt`): 220x50, read with
// `capture-pane -p -e` as `Tmux.captureAnsi` reads, typed with sendPrompt's own key sequence (`send-keys -l --` per
// line, `M-Enter` between lines) on a throwaway local tmux server, 2026-10-15, macOS, tmux 3.7c, `--safe-mode --model
// haiku`. Scrubbed of the work-dir path. The text each one was typed from is regenerated below by `recorded`, and the
// first describe pins that the two agree.

const panesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'panes');
const fixture = (name: string): string => readFileSync(path.join(panesDir, name), 'utf8');

const EMPTY = fixture('cc300-paste-empty-box.txt');          // idle, the dim ghost suggestion in the box
const CHIP = fixture('cc300-paste-chip-1000.txt');           // one 1000-char line → `❯ [Pasted text #1]`
const CHIP_LINES = fixture('cc300-paste-chip-lines.txt');    // 10 lines in ONE `send-keys -l` → `[Pasted text #2 +9 lines]`
const TWO_CHIPS = fixture('cc300-paste-chips-2000.txt');     // one 2000-char line → `[Pasted text #3][Pasted text #4]`
const LOST_HEAD = fixture('cc300-paste-lost-head-1100.txt'); // one 1100-char line → only its last 78 chars, no chip
const CHIP_ROWS = fixture('cc300-paste-chip-rows-3x1000.txt'); // three 1000-char lines → a chip on each of 3 rows
const MIXED = fixture('cc300-paste-mixed-rows.txt');         // short, 1000, short → text, chip, text
const SUBMITTED = fixture('cc300-paste-submitted.txt');      // after Enter on CHIP: the turn ran, the box is empty
const QUEUED = fixture('cc300-paste-queued.txt');            // after Enter on a chip during a turn: the queue hint

/** The probe's text generator, so a test types exactly what the recorded pane was typed from. */
const WORDS = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu'.split(' ');
function recorded(n: number, tag: string): string {
  let s = `${tag} Reply with only the word OK and use no tools.`;
  for (let i = 0; s.length < n; i++) s += ' ' + WORDS[i % WORDS.length];
  const end = ` END-${tag}`;
  return (s.slice(0, n - end.length) + end).slice(0, n);
}

const noSleep = async () => {};
const SGR = /\x1b\[[0-9;]*m/g;

/**
 * A pane that answers by PHASE, driven by the keys this call actually sends: `start` until the first key, `cleared`
 * after a C-u (the clear arms), `typed` after the first literal, and `entered[k]` after the (k+1)th Enter (the last one
 * repeats). A scripted list could not tell "the chip appeared after OUR type" from "it was on the next capture".
 */
function phaseTmux(o: { start: string; typed: string; cleared?: string; entered?: string[] }) {
  const calls: string[][] = [];
  let phase: 'start' | 'cleared' | 'typed' = 'start';
  let enters = 0;
  const entered = o.entered ?? [SUBMITTED];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'capture-pane') {
      const pane = enters > 0 ? entered[Math.min(enters, entered.length) - 1]!
        : phase === 'typed' ? o.typed : phase === 'cleared' ? (o.cleared ?? EMPTY) : o.start;
      return { code: 0, stdout: pane, stderr: '' };
    }
    if (args[0] === 'send-keys') {
      if (args[3] === '-l') phase = 'typed';
      else if (args.at(-1) === 'C-u' && phase === 'start') phase = 'cleared';
      else if (args.at(-1) === 'Enter') enters++;
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { tmux: new Tmux(run), calls };
}

const keysOf = (calls: string[][]): string[] =>
  calls.filter((c) => c[1] === 'send-keys').map((c) => (c[4] === '-l' ? `lit(${c.at(-1)!.length})` : c.at(-1)!));
const enters = (calls: string[][]): number => keysOf(calls).filter((k) => k === 'Enter').length;
const deps = (tmux: Tmux) => ({ tmux, queue: new KeyedQueue(), sleep: noSleep });

describe('the recorded 2.1.300 paste panes (sanity: fixture and generator agree)', () => {
  it('reads each box the way the probe saw it', () => {
    expect(draftOf(EMPTY)).toBe('');
    expect(draftOf(CHIP)).toBe('[Pasted text #1]');
    expect(draftOf(CHIP_LINES)).toBe('[Pasted text #2 +9 lines]');
    expect(draftOf(TWO_CHIPS)).toBe('[Pasted text #3][Pasted text #4]');
    expect(draftOf(CHIP_ROWS)).toBe('[Pasted text #8]');
    expect(draftOf(SUBMITTED)).toBe('');
    expect(draftOf(QUEUED)).toBe('');                 // the dim queue hint is stripped
    // The lost head: the box holds the LAST 78 characters of what was typed and nothing marks the loss.
    const text = recorded(1100, 'c1100');
    expect(text.endsWith(draftOf(LOST_HEAD))).toBe(true);
    expect(draftOf(LOST_HEAD).length).toBe(78);
    // The submitted turn in the scrollback is the whole text, expanded.
    expect(SUBMITTED.replace(SGR, '')).toContain('END-c1000');
  });
});

describe('sendPrompt submits a paste chip it can prove is its own (D-TBD-paste-chip-submit)', () => {
  // THE OPERATOR'S CASE. One long paragraph, typed into an empty box, collapsed to one chip. Today: `verify-failed`,
  // `submittable`, no Enter, and the operator goes to the terminal to press it.
  it('one long line, one chip: presses Enter once and reports ok', async () => {
    const { tmux, calls } = phaseTmux({ start: EMPTY, typed: CHIP });
    const res = await sendPrompt(deps(tmux), 'lane-a', recorded(1000, 'c1000'));
    expect(res).toEqual({ ok: true });
    expect(keysOf(calls)).toEqual(['lit(1000)', 'Enter']);
  });

  it('a busy session queues it: the queue hint is proof the chip left the box', async () => {
    const { tmux, calls } = phaseTmux({ start: EMPTY, typed: CHIP, entered: [QUEUED] });
    expect(await sendPrompt(deps(tmux), 'lane-a', recorded(1000, 'c1000'))).toEqual({ ok: true });
    expect(enters(calls)).toBe(1);
  });

  it('an Enter the box swallows twice is enter-ignored, and the chip is still offered as the rescue', async () => {
    const { tmux, calls } = phaseTmux({ start: EMPTY, typed: CHIP, entered: [CHIP] });
    const res = await sendPrompt(deps(tmux), 'lane-a', recorded(1000, 'c1000'));
    expect(res).toMatchObject({ ok: false, error: 'enter-ignored', draft: '[Pasted text #1]', submittable: true });
    expect(enters(calls)).toBe(2);
    // ...and the rescue still sends exactly that chip.
    const rescue = phaseTmux({ start: CHIP, typed: CHIP });
    expect(await submitEnter(deps(rescue.tmux), 'lane-a', '[Pasted text #1]')).toEqual({ ok: true });
  });

  // PROVENANCE, the "cleared by our own lane" arm: the box held something, this call cleared it, then typed.
  it('a box this call cleared first (replaceDraft) counts as proven', async () => {
    const human = EMPTY.replace('❯\xa0\x1b[2mTry "how do I log an error?"\x1b[0m', '❯\xa0a half-typed human line');
    expect(draftOf(human)).toBe('a half-typed human line');
    const { tmux, calls } = phaseTmux({ start: human, typed: CHIP });
    const res = await sendPrompt(deps(tmux), 'lane-a', recorded(1000, 'c1000'), { replaceDraft: true });
    expect(res).toEqual({ ok: true });
    expect(keysOf(calls)).toEqual(['C-u', 'lit(1000)', 'Enter']);
  });

  it('and so does the mail lane\'s cleared residue (clearMailResidue)', async () => {
    const residue = EMPTY.replace('❯\xa0\x1b[2mTry "how do I log an error?"\x1b[0m', '❯\xa0[Pasted text #1 +54 lines]');
    const { tmux, calls } = phaseTmux({ start: residue, typed: CHIP });
    const res = await sendPrompt(deps(tmux), 'lane-a', recorded(1000, 'c1000'), { clearMailResidue: true });
    expect(res).toEqual({ ok: true });
    expect(keysOf(calls)).toEqual(['C-u', 'lit(1000)', 'Enter']);
  });

  it('a chip whose line count is the newlines we typed is ours too', async () => {
    // Not a shape sendPrompt's per-line typing was measured producing (its lines go in separate calls, M-Enter
    // between), but the one in which a chip states a count, and the count is what proves it.
    const text = Array.from({ length: 10 }, (_, j) => recorded(80, `m10lfL${String(j).padStart(2, '0')}`)).join('\n');
    expect(text.length).toBe(809);
    const { tmux, calls } = phaseTmux({ start: EMPTY, typed: CHIP_LINES });
    expect(await sendPrompt(deps(tmux), 'lane-a', text)).toEqual({ ok: true });
    expect(enters(calls)).toBe(1);
  });
});

describe('every other shape keeps today\'s refusal (D-TBD-paste-chip-submit\'s guards)', () => {
  const refusesWithoutEnter = async (typed: string, text: string) => {
    const { tmux, calls } = phaseTmux({ start: EMPTY, typed });
    const res = await sendPrompt(deps(tmux), 'lane-a', text);
    expect(enters(calls)).toBe(0);
    return res;
  };

  // SINGLE CHIP. Two chips on the row: the macOS read size split one line in two. The text is all there, but this
  // guard takes one chip only; the operator still gets the tap.
  it('two chips on the row: verify-failed, submittable, no Enter', async () => {
    const res = await refusesWithoutEnter(TWO_CHIPS, recorded(2000, 'c2000'));
    expect(res).toMatchObject({ ok: false, error: 'verify-failed', draft: '[Pasted text #3][Pasted text #4]', submittable: true });
  });


  // LINE COUNT. The box states 9 newlines; we typed 2.
  it('a chip whose line count is not ours: verify-failed, submittable, no Enter', async () => {
    const text = [0, 1, 2].map((j) => recorded(300, `x${j}`)).join('\n');
    const res = await refusesWithoutEnter(CHIP_LINES, text);
    expect(res).toMatchObject({ ok: false, error: 'verify-failed', draft: '[Pasted text #2 +9 lines]', submittable: true });
  });

  it('a chip stating lines over a single typed line: no Enter', async () => {
    const res = await refusesWithoutEnter(CHIP_LINES, recorded(1000, 'c1000'));
    expect(res).toMatchObject({ ok: false, error: 'verify-failed', submittable: true });
  });

  it('a chip stating NO lines over a multi-line message: no Enter', async () => {
    // Three lines, each long enough to collapse, but the box shows one bare chip: two lines are unaccounted for.
    const text = [0, 1, 2].map((j) => recorded(1000, `y${j}`)).join('\n');
    const res = await refusesWithoutEnter(CHIP, text);
    expect(res).toMatchObject({ ok: false, error: 'verify-failed', draft: '[Pasted text #1]', submittable: true });
  });

  // COLLAPSE FLOOR. A line of 800 characters is typed as text (measured: 800 echoes, 801 collapses), so a chip over
  // it is not what we typed.
  it('a chip over a line too short to have collapsed: no Enter', async () => {
    const res = await refusesWithoutEnter(CHIP, recorded(800, 'c800'));
    expect(res).toMatchObject({ ok: false, error: 'verify-failed', draft: '[Pasted text #1]', submittable: true });
  });

  it('...and one character more is long enough', async () => {
    const { tmux, calls } = phaseTmux({ start: EMPTY, typed: CHIP });
    expect(await sendPrompt(deps(tmux), 'lane-a', recorded(801, 'c801'))).toEqual({ ok: true });
    expect(enters(calls)).toBe(1);
  });

  // NOT A CHIP AT ALL. The macOS lost-head race: the box holds the tail of our line and no chip. Enter would submit
  // 78 of 1100 characters (measured in the investigation), so no Enter and no rescue, as today.
  it('the lost head: verify-failed, NO submittable, no Enter', async () => {
    const res = await refusesWithoutEnter(LOST_HEAD, recorded(1100, 'c1100'));
    expect(res).toMatchObject({ ok: false, error: 'verify-failed', draft: draftOf(LOST_HEAD) });
    expect((res as { submittable?: boolean }).submittable).toBeUndefined();
  });

  // Not this feature's arm: the marker row is our first line, so the needle echoes and the ordinary submit runs.
  it('a chip in the middle of a message whose first line echoes is the ordinary path', async () => {
    const text = ['mix Reply with only OK, no tools. Header line.', recorded(1000, 'mixB'), 'and a short closing line'].join('\n');
    const { tmux, calls } = phaseTmux({ start: EMPTY, typed: MIXED });
    expect(await sendPrompt(deps(tmux), 'lane-a', text)).toEqual({ ok: true });
    expect(enters(calls)).toBe(1);
  });
});

describe('ownPasteChip: the decision, guard by guard', () => {
  const ONE = [recorded(1000, 'c1000')];
  it('answers the chip row when every guard holds', () => {
    expect(ownPasteChip(CHIP, ONE, 'proven-empty')).toBe('[Pasted text #1]');
    expect(ownPasteChip(CHIP, ONE, 'cleared-by-us')).toBe('[Pasted text #1]');
  });
  // PROVENANCE. No path in sendPrompt types without proving the box first, so this is the guard's only red: the
  // decision itself refuses a box whose state before the type loop nobody proved.
  it('PROVENANCE: refuses a box nobody proved empty before typing', () => {
    expect(ownPasteChip(CHIP, ONE, 'unproven')).toBeNull();
  });
  it('SINGLE CHIP: refuses two chips, a chip with rows below, and a chip with text after it', () => {
    expect(ownPasteChip(TWO_CHIPS, [recorded(2000, 'c2000')], 'proven-empty')).toBeNull();
    expect(ownPasteChip(CHIP_ROWS, [recorded(1000, 'a')], 'proven-empty')).toBeNull();
    const chipAndTail = CHIP.replace('[Pasted text #1]', '[Pasted text #1] amet consectetur');
    expect(ownPasteChip(chipAndTail, ONE, 'proven-empty')).toBeNull();
  });
  it('LINE COUNT: the stated count must be the newlines typed, and no count means one line', () => {
    const ten = Array.from({ length: 10 }, (_, j) => recorded(81, `L${j}`));
    expect(ownPasteChip(CHIP_LINES, ten, 'proven-empty')).toBe('[Pasted text #2 +9 lines]');
    expect(ownPasteChip(CHIP_LINES, ten.slice(1), 'proven-empty')).toBeNull();
    expect(ownPasteChip(CHIP, ten, 'proven-empty')).toBeNull();
  });
  it('COLLAPSE FLOOR: what we typed must be over 800 characters', () => {
    expect(ownPasteChip(CHIP, [recorded(800, 'x')], 'proven-empty')).toBeNull();
    expect(ownPasteChip(CHIP, [recorded(801, 'x')], 'proven-empty')).toBe('[Pasted text #1]');
  });
});

// ── D-TBD-tall-box-echo ────────────────────────────────────────────────────────────────────────────────────────────
//
// THE ROW CAP, which the three investigations measured as the likeliest shape of the operator's report. Claude Code
// 2.1.300 shows at most (rows - 10) / 2 rows of its input box (20 in the fleet's 220x50 window), scrolls the box
// inside itself, keeps the LAST rows in view and draws `❯` on the first visible one. So any message taller than 20
// rows (a few pasted paragraphs) puts a later line, or a blank separator line, on the marker row, the needle never
// matches, and the send came back `verify-failed` with no `submittable` at all: the operator's only exit was the
// terminal, where one Enter sent the whole text intact. And a long line above or inside such a message is a chip row.
//
// `ownRenderedBox` reads the WHOLE box and accepts it only when it is provably the rendering of what we typed: the
// same provenance as the chip arm; every line over the collapse floor drawn as one bare chip row, and every such chip
// in view (so no long line is hidden above the window, where a lost head could not be seen); the text between and
// after the chips equal to ours (whitespace aside, which wrapping moves); the text before the first chip in view a
// suffix of ours; and, when that suffix is not the whole of it, the box exactly as tall as the measured cap.

const TALL40 = fixture('cc300-paste-tall-40-lines.txt');                  // 40 lines of 80, marker on line 21
const PARAS7 = fixture('cc300-paste-tall-paras-blank-marker.txt');        // 7 paragraphs of 500, a blank marker row
const PARACHIP = fixture('cc300-paste-tall-with-chip.txt');               // 7 paragraphs, the 6th a chip, in view
const CHIP_ABOVE = fixture('cc300-paste-tall-chip-above.txt');            // 9 paragraphs, the 2nd a chip, scrolled out
const CHIP_FIRST = fixture('cc300-paste-chip-first-rows-below.txt');      // a 1000-char line, then two short lines
const SPLIT_FIRST = fixture('cc300-paste-split-first-line-sent.txt');     // the same, the long line auto-submitted alone
const TALL_SPLIT = fixture('cc300-paste-tall-split-first-sent.txt');      // 9 paragraphs, the long 1st auto-submitted

const lines = (k: number, w: number, tag: string): string =>
  Array.from({ length: k }, (_, j) => recorded(w, `${tag}L${String(j).padStart(2, '0')}`)).join('\n');
const paras = (k: number, tag: string, long: number | null): string =>
  Array.from({ length: k }, (_, j) => recorded(j === long ? 1000 : 500, `${tag}P${j}`)).join('\n\n');
const TEXT = {
  tall40: lines(40, 80, 'tall40'),
  paras7: paras(7, 'paras7', null),
  parachip: paras(7, 'parachip', 5),
  chipabove: paras(9, 'chipabove', 1),
  chiptop: paras(9, 'chiptop', 0),
  chipfirst: [recorded(1000, 'chipfirstA'), 'second line, short', 'third line, short'].join('\n'),
  longfirst: [recorded(1000, 'longfirstA'), 'second line, short', 'third line, short'].join('\n'),
};
const markerRowOf = (pane: string): string => draftOf(pane);
/** The capture's lines, the marker row's index, and the closing rule's index below it. */
const boxSpan = (pane: string): { lines: string[]; marker: number; close: number } => {
  const lines = pane.split('\n');
  const plain = lines.map((l) => l.replace(SGR, ''));
  const marker = plain.map((l) => l.startsWith('❯')).lastIndexOf(true);
  const close = plain.findIndex((l, i) => i > marker && /^─{8,}$/.test(l.trim()));
  return { lines, marker, close };
};

describe('the recorded row-capped panes (sanity)', () => {
  it('the marker row is a LATER line, or blank, and never the first line', () => {
    expect(markerRowOf(TALL40).startsWith('tall40L20 ')).toBe(true);
    expect(markerRowOf(PARAS7)).toBe('');
    expect(markerRowOf(CHIP_ABOVE)).toBe('');
    expect(markerRowOf(CHIP_FIRST)).toBe('[Pasted text #48]');
    expect(markerRowOf(SPLIT_FIRST)).toBe('second line, short');
    expect(PARACHIP.replace(SGR, '')).toContain('  [Pasted text #11]');
  });
});

describe('sendPrompt submits a row-capped box that is provably what it typed (D-TBD-tall-box-echo)', () => {
  const submits = async (typed: string, text: string) => {
    const { tmux, calls } = phaseTmux({ start: EMPTY, typed });
    const res = await sendPrompt(deps(tmux), 'lane-a', text);
    expect(res).toEqual({ ok: true });
    expect(enters(calls)).toBe(1);
    return calls;
  };

  it('40 short lines: the marker row is line 21', async () => {
    const calls = await submits(TALL40, TEXT.tall40);
    expect(keysOf(calls).filter((k) => k === 'M-Enter')).toHaveLength(39);
  });
  it('7 paragraphs: the marker row is a blank separator line', () => submits(PARAS7, TEXT.paras7));
  it('7 paragraphs, one of them a chip in view', () => submits(PARACHIP, TEXT.parachip));
  it('a long FIRST line drawn as a chip with our short lines below it (not row-capped at all)', () =>
    submits(CHIP_FIRST, TEXT.chipfirst));
  // `ownPasteChip` refuses this one (a chip with rows below it: its SINGLE CHIP unit case); this arm reads all three
  // rows and finds a chip for each of our three long lines. The investigation measured the shape submitting exact.
  it('three long lines, a chip on each row', () =>
    submits(CHIP_ROWS, [0, 1, 2].map((j) => recorded(1000, `ml3L${String(j).padStart(2, '0')}`)).join('\n')));
  it('a busy session queues it', async () => {
    const { tmux } = phaseTmux({ start: EMPTY, typed: TALL40, entered: [QUEUED] });
    expect(await sendPrompt(deps(tmux), 'lane-a', TEXT.tall40)).toEqual({ ok: true });
  });

  it('an Enter swallowed twice is enter-ignored; the marker row is the rescue\'s claim', async () => {
    const { tmux, calls } = phaseTmux({ start: EMPTY, typed: TALL40, entered: [TALL40] });
    const res = await sendPrompt(deps(tmux), 'lane-a', TEXT.tall40);
    expect(res).toMatchObject({ ok: false, error: 'enter-ignored', draft: markerRowOf(TALL40), submittable: true });
    expect(enters(calls)).toBe(2);
  });
  it('...but a BLANK marker row is no claim at all: enter-ignored with no submittable', async () => {
    const { tmux } = phaseTmux({ start: EMPTY, typed: PARAS7, entered: [PARAS7] });
    const res = await sendPrompt(deps(tmux), 'lane-a', TEXT.paras7);
    expect(res).toMatchObject({ ok: false, error: 'enter-ignored', draft: '' });
    expect((res as { submittable?: boolean }).submittable).toBeUndefined();
  });
  it('the proof is OUR tail leaving the box: a human typing into the emptied box is not a second Enter', async () => {
    const human = EMPTY.replace('❯\xa0\x1b[2mTry "how do I log an error?"\x1b[0m', '❯\xa0and now the human types');
    const { tmux, calls } = phaseTmux({ start: EMPTY, typed: TALL40, entered: [human] });
    expect(await sendPrompt(deps(tmux), 'lane-a', TEXT.tall40)).toEqual({ ok: true });
    expect(enters(calls)).toBe(1);
  });
});

describe('a box that is not provably what we typed keeps today\'s refusal (D-TBD-tall-box-echo\'s guards)', () => {
  const refuses = async (typed: string, text: string) => {
    const { tmux, calls } = phaseTmux({ start: EMPTY, typed });
    const res = await sendPrompt(deps(tmux), 'lane-a', text);
    expect(res).toMatchObject({ ok: false, error: 'verify-failed', draft: markerRowOf(typed) });
    expect(enters(calls)).toBe(0);
    return res;
  };

  // A LONG LINE ABOVE THE WINDOW. Its chip is out of view, so nothing shows it was not lost (macOS loses the head of
  // a 1023 to 1821-character line and draws only its tail).
  it('a chip scrolled out above the window', () => refuses(CHIP_ABOVE, TEXT.chipabove));

  // THE AUTO-SUBMIT SPLIT (measured here, 3 of 16 tries with no pause): M-Enter right after a long first line
  // submitted that line as its own turn, and the rest was typed into a fresh box. Half the message is already sent;
  // claiming `ok` for the rest would hide that.
  it('the long first line already went out on its own: the rest is in the box', () => refuses(SPLIT_FIRST, TEXT.longfirst));
  it('...and the same in a row-capped box', () => refuses(TALL_SPLIT, TEXT.chiptop));

  it('a window whose rows are not our text', async () => {
    const res = await refuses(TALL40, TEXT.tall40.replace('tall40L30 Reply', 'tall40L30 Rephrase'));
    expect((res as { submittable?: boolean }).submittable).toBeUndefined();
  });
  it('our tail, but the box one row short of the measured cap', async () => {
    // DERIVED from TALL40: the top visible row removed and `❯` moved onto the next one, so the box shows 19 rows of
    // our tail. Not a shape the cap draws, so a head is missing for some other reason.
    const { lines: rows, marker: i } = boxSpan(TALL40);
    const nineteen = [...rows.slice(0, i), '', '❯ ' + rows[i + 1]!.replace(SGR, '').trim(), ...rows.slice(i + 2)].join('\n');
    expect(markerRowOf(nineteen).startsWith('tall40L21 ')).toBe(true);
    await refuses(nineteen, TEXT.tall40);
  });
  it('the macOS lost head is still refused: its chip is missing', () => refuses(LOST_HEAD, recorded(1100, 'c1100')));
});

describe('ownRenderedBox: the decision, guard by guard', () => {
  it('answers our visible tail when every guard holds', () => {
    expect(ownRenderedBox(TALL40, TEXT.tall40.split('\n'), 'proven-empty')!.endsWith('END-tall40L39')).toBe(true);
    expect(ownRenderedBox(PARACHIP, TEXT.parachip.split('\n'), 'cleared-by-us')).not.toBeNull();
  });
  it('PROVENANCE: refuses a box nobody proved empty before typing', () => {
    expect(ownRenderedBox(TALL40, TEXT.tall40.split('\n'), 'unproven')).toBeNull();
  });
  it('EVERY CHIP IN VIEW: refuses when a long line\'s chip is not on screen', () => {
    expect(ownRenderedBox(CHIP_ABOVE, TEXT.chipabove.split('\n'), 'proven-empty')).toBeNull();
    // ...and a chip on screen where we typed no long line
    expect(ownRenderedBox(PARACHIP, TEXT.paras7.replace(/paras7/g, 'parachip').split('\n'), 'proven-empty')).toBeNull();
  });
  it('TEXT AFTER A CHIP: must equal ours', () => {
    const text = TEXT.parachip.replace('parachipP6 Reply', 'parachipP6 Rephrase');
    expect(ownRenderedBox(PARACHIP, text.split('\n'), 'proven-empty')).toBeNull();
  });
  it('TEXT BEFORE THE FIRST CHIP IN VIEW: must be a suffix of ours', () => {
    const text = TEXT.tall40.replace('tall40L25 Reply', 'tall40L25 Rephrase');
    expect(ownRenderedBox(TALL40, text.split('\n'), 'proven-empty')).toBeNull();
  });
  it('A HIDDEN HEAD NEEDS A FULL BOX: the cap is (rows - 10) / 2', () => {
    // The same 50-row capture read as if it came from a 52-row pane: the cap would be 21, the box shows 20.
    expect(ownRenderedBox(TALL40 + '\n\n', TEXT.tall40.split('\n'), 'proven-empty')).toBeNull();
  });
  it('A CHIP SHAPE IT DOES NOT VOUCH FOR anywhere in the box: two chips on a row, a counted chip', () => {
    const twoChips = PARACHIP.replace('[Pasted text #11]', '[Pasted text #11][Pasted text #12]');
    expect(ownRenderedBox(twoChips, TEXT.parachip.split('\n'), 'proven-empty')).toBeNull();
    const counted = PARACHIP.replace('[Pasted text #11]', '[Pasted text #11 +3 lines]');
    expect(ownRenderedBox(counted, TEXT.parachip.split('\n'), 'proven-empty')).toBeNull();
  });
  it('COLLAPSE FLOOR: a line of 800 is typed text, so a chip row over it is not ours; 801 is a chip', () => {
    const rest = ['second line, short', 'third line, short'];
    expect(ownRenderedBox(CHIP_FIRST, [recorded(800, 'chipfirstA'), ...rest], 'proven-empty')).toBeNull();
    expect(ownRenderedBox(CHIP_FIRST, [recorded(801, 'chipfirstA'), ...rest], 'proven-empty')).not.toBeNull();
  });
  it('NOTHING VISIBLE: refuses a box of blank rows', () => {
    const { lines: rows, marker, close } = boxSpan(TALL40);
    const blank = [...rows.slice(0, marker), '❯\xa0', ...rows.slice(marker + 1, close).map(() => ''), ...rows.slice(close)].join('\n');
    expect(boxSpan(blank).close - boxSpan(blank).marker).toBe(20);
    expect(ownRenderedBox(blank, ['', '', ''], 'proven-empty')).toBeNull();
  });
  it('THE BOX MUST CLOSE: a box with no rule under it is not read', () => {
    // CHIP_FIRST needs no cap (the whole message is in view), so only the missing rule can refuse it.
    expect(ownRenderedBox(CHIP_FIRST, TEXT.chipfirst.split('\n'), 'proven-empty')).not.toBeNull();
    const { lines: rows, close } = boxSpan(CHIP_FIRST);
    const unclosed = rows.map((l, i) => (i >= close ? '' : l)).join('\n');
    expect(ownRenderedBox(unclosed, TEXT.chipfirst.split('\n'), 'proven-empty')).toBeNull();
  });
  it('A CHIP-SHAPED LINE OF OUR OWN is not vouched for either: the box cannot tell it from a widget chip', () => {
    const ours = '[Pasted text #3] is what the box showed';
    const pane = CHIP_FIRST.replace('second line, short', ours);
    expect(draftOf(pane)).toBe('[Pasted text #48]');
    expect(ownRenderedBox(pane, [recorded(1000, 'chipfirstA'), ours, 'third line, short'], 'proven-empty')).toBeNull();
  });
});
