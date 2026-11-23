// Paste chips in a real Chrome over the production build (desktop-polish wave 169; Goals modification 90, second
// half; review 3457's fix round). A long text written to the clipboard and pasted with the keyboard shows as ONE label
// in the composer's field and ONE chip in the row above it, and the send makes ONE request whose `text` is the full
// pasted text, counted after a settling window. With typed text on both sides of the label: Backspace after it and
// Delete before it take the whole label and keep both sides (F2); Expand, Remove and a key typed inside the label leave
// focus in the field and the caret where it belongs (F3); and the browser's own undo and redo, over the paste, both
// keys, Expand, Remove and the inside-key expansion, each bring the chip back with its text, because every edit the
// composer makes is the browser's own (`execCommand`). Copy and cut of a chip put its full text on the clipboard. In
// both skins and both palettes, the chip's label, its expand control and its remove glyph read at 4.5:1 or better on
// the ground actually drawn behind them, at rest, hovered and keyboard-focused (F1). At a phone width with a touch
// screen the controls reach the 44px floor and the page does not scroll sideways. Review 3469's fix round adds: redo
// after every act; undo and redo restoring chips by position where a label-shaped string would mislead (a `[`-leading
// Expand, a long paste inside a label whose text holds the new label, both collision sequences), with the payload
// counted; a word delete reaching into a label from either side; a composition driven through Chrome's own, beside and
// inside a label; a short paste inside a label; Enter and Space on the focused controls; and which control has focus
// in the focused contrast readings.
//
// The clipboard is Chrome's own (`navigator.clipboard.writeText` with the context granted clipboard access for the
// served origin), not the operating system's; the prompt route is simulated (`{"ok":true}`), so this pins the browser
// boundary only, as the paste-reliability note's §2 does.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/paste-chips.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const NOW = 1_792_362_479;
const SESSION = {
  id: 'project-a-one', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a/one',
  workspace: 'one', name: 'one', status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: 'ws/one', ctxPct: null, paneCols: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null,
  subagents: null, background: null, withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'working',
  unmeasured: [], started: true, child: { kind: 'none' },
};
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': {
      accounts: [{
        wrapper: 'lane-a', five: 40, seven: 50, ts: NOW, fiveResetAt: NOW + 7_800, sevenResetAt: NOW + 259_800,
        fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
      }],
      projected: null,
      roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', pool: null, homeAble: true, hidden: false }],
    },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': [], '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: [SESSION] }],
};

/** 40 lines with tabs, inner blank lines and trailing spaces, about 2 KB, with no edge whitespace (so today's
 *  whole-message trim leaves it as it is) and a tail label to find. */
const LONG = 'paste probe head\n' + Array.from({ length: 40 }, (_, i) => (i % 9 === 4 ? '' : `\tline ${String(i + 1).padStart(2, '0')}\tof the paste probe   ${'x'.repeat(20)}`))
  .join('\n') + '\nZQX-END-chip';
const TOKEN = '[Pasted text #1 +42 lines]';

let dist: string | undefined;
let server: DistServer | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

/** Open the session screen at `view`, recording every prompt request's body. */
const open = async (view: AppView) => {
  const opened = await openApp(browser!, view, FIXTURE);
  await opened.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server!.origin });
  const bodies: unknown[] = [];
  await opened.page.route('**/api/sessions/*/prompt', async (route) => {
    bodies.push(JSON.parse(route.request().postData() ?? 'null'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
  const field = opened.page.getByRole('textbox', { name: 'Message' });
  await field.waitFor({ timeout: 20_000 });
  return { ...opened, bodies, field };
};
type Opened = Awaited<ReturnType<typeof open>>;

const pasteLong = async (s: Opened): Promise<void> => {
  await s.page.evaluate((text) => navigator.clipboard.writeText(text), LONG);
  await s.field.focus();
  await s.page.keyboard.press('Control+V');
};

const chipCount = (page: Page): Promise<number> =>
  page.getByRole('list', { name: 'Pasted text' }).getByRole('listitem').count();

/** The field's value, whether it has focus, and its selection. */
const state = (s: Opened) => s.field.evaluate((el: HTMLTextAreaElement) => ({
  value: el.value, focused: document.activeElement === el, sel: [el.selectionStart, el.selectionEnd],
}));

/** Send with Enter, wait for the first request and then a settling window, and return every body seen. */
const sendAndSettle = async (s: Opened): Promise<unknown[]> => {
  await s.page.keyboard.press('Enter');
  await expect.poll(() => s.bodies.length, { timeout: 5_000 }).toBeGreaterThan(0);
  await s.page.waitForTimeout(400);
  return s.bodies;
};

describe('a long paste shows one chip and sends the full text in one request', () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    it(`${skin}, 1280px`, async () => {
      const s = await open({ skin, theme: PHOSPHOR, width: 1280 });
      try {
        await pasteLong(s);
        await expect.poll(() => s.field.inputValue()).toBe(TOKEN);
        expect(await chipCount(s.page)).toBe(1);
        expect(await sendAndSettle(s)).toEqual([{ text: LONG }]);
        expect(await s.field.inputValue()).toBe('');
        expect(await s.page.getByRole('list', { name: 'Pasted text' }).count()).toBe(0);
        // Undo after the send brings nothing back: the send's empty field is a value the composer writes.
        await s.page.keyboard.press('Control+Z');
        await s.page.waitForTimeout(200);
        expect(await s.field.inputValue()).toBe('');
        expect(await s.page.getByRole('list', { name: 'Pasted text' }).count()).toBe(0);
        expect(s.bodies).toHaveLength(1);
        expect(s.errors).toEqual([]);
      } finally {
        await s.ctx.close();
      }
    });
  }
});

describe('with typed text on both sides of the label (refined, 1280px)', () => {
  const LABELLED = `a${TOKEN}b`;
  const AFTER = 1 + TOKEN.length;

  /** `a` + label + `b`, the caret at `at`. */
  const setup = async (s: Opened, at: number): Promise<void> => {
    await s.field.focus();
    await s.page.keyboard.type('ab');
    await s.page.keyboard.press('ArrowLeft');
    await pasteLong(s);
    await expect.poll(() => s.field.inputValue()).toBe(LABELLED);
    await s.field.evaluate((el: HTMLTextAreaElement, c) => el.setSelectionRange(c, c), at);
  };

  const undoBringsItBack = async (s: Opened): Promise<void> => {
    await s.page.keyboard.press('Control+Z');
    await expect.poll(() => s.field.inputValue()).toBe(LABELLED);
    expect(await chipCount(s.page)).toBe(1);
  };
  /** Redo gives `after` back with no chip, and a second undo brings the chip back again (review 3469 A4). */
  const redoThenUndo = async (s: Opened, after: string): Promise<void> => {
    await s.page.keyboard.press('Control+Shift+Z');
    await expect.poll(() => s.field.inputValue()).toBe(after);
    expect(await s.page.getByRole('list', { name: 'Pasted text' }).count()).toBe(0);
    await undoBringsItBack(s);
  };

  it('Backspace after the label and Delete before it take the whole label, keep both sides, and undo restores it', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await setup(s, AFTER);
      await s.page.keyboard.press('Backspace');
      expect(await state(s)).toEqual({ value: 'ab', focused: true, sel: [1, 1] });
      expect(await s.page.getByRole('list', { name: 'Pasted text' }).count()).toBe(0);
      await undoBringsItBack(s);
      await s.page.keyboard.press('Control+Shift+Z');
      await expect.poll(() => s.field.inputValue()).toBe('ab');
      await undoBringsItBack(s);
      await s.field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(1, 1));
      await s.page.keyboard.press('Delete');
      expect(await state(s)).toEqual({ value: 'ab', focused: true, sel: [1, 1] });
      await undoBringsItBack(s);
      await redoThenUndo(s, 'ab');
      expect(await sendAndSettle(s)).toEqual([{ text: `a${LONG}b` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('undo and redo of the paste itself', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await setup(s, AFTER);
      await s.page.keyboard.press('Control+Z');
      await expect.poll(() => s.field.inputValue()).toBe('ab');
      await s.page.keyboard.press('Control+Shift+Z');
      await expect.poll(() => s.field.inputValue()).toBe(LABELLED);
      expect(await chipCount(s.page)).toBe(1);
      expect(await sendAndSettle(s)).toEqual([{ text: `a${LONG}b` }]);
    } finally {
      await s.ctx.close();
    }
  });

  it('Expand and Remove leave focus in the field with the caret in place, and undo restores the chip', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await setup(s, 0);
      await s.page.getByRole('button', { name: 'Expand pasted text #1, 42 lines, into the message' }).click();
      expect(await state(s)).toEqual({ value: `a${LONG}b`, focused: true, sel: [1 + LONG.length, 1 + LONG.length] });
      await undoBringsItBack(s);
      await redoThenUndo(s, `a${LONG}b`);
      await s.page.getByRole('button', { name: 'Remove pasted text #1' }).click();
      expect(await state(s)).toEqual({ value: 'ab', focused: true, sel: [1, 1] });
      await undoBringsItBack(s);
      await redoThenUndo(s, 'ab');
      expect(await sendAndSettle(s)).toEqual([{ text: `a${LONG}b` }]);
    } finally {
      await s.ctx.close();
    }
  });

  it('a key typed inside the label expands it, the caret after the key, and undo restores the chip', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await setup(s, 6);
      await s.page.keyboard.type('X');
      const at = 1 + LONG.length + 1;
      expect(await state(s)).toEqual({ value: `a${LONG}Xb`, focused: true, sel: [at, at] });
      expect(await s.page.getByRole('list', { name: 'Pasted text' }).count()).toBe(0);
      await undoBringsItBack(s);
      await redoThenUndo(s, `a${LONG}Xb`);
      expect(await sendAndSettle(s)).toEqual([{ text: `a${LONG}b` }]);
    } finally {
      await s.ctx.close();
    }
  });

  it('copy and cut put the full text on the clipboard, never the label', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await setup(s, 0);
      const clip = (): Promise<string> => s.page.evaluate(() => navigator.clipboard.readText());
      await s.page.keyboard.press('Control+A');
      await s.page.keyboard.press('Control+C');
      await expect.poll(clip).toBe(`a${LONG}b`);
      expect(await s.field.inputValue()).toBe(LABELLED);
      await s.field.evaluate((el: HTMLTextAreaElement, end) => el.setSelectionRange(1, end), AFTER);
      await s.page.keyboard.press('Control+X');
      await expect.poll(clip).toBe(LONG);
      expect(await state(s)).toEqual({ value: 'ab', focused: true, sel: [1, 1] });
      await undoBringsItBack(s);
      await redoThenUndo(s, 'ab');
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });
});

/** `n` numbered lines tagged `tag`, none with edge whitespace. */
const numbered = (tag: string, n: number): string => Array.from({ length: n }, (_, i) => `${tag} line ${i + 1}`).join('\n');
/** A text that starts with `[`, as a JSON array or a timestamped log does (review 3469 F1): 21 lines. */
const BRACKETED = `[12:00:01] paste probe head\n${numbered('br', 20)}`;
const BRACKETED_TOKEN = '[Pasted text #1 +21 lines]';
/** The second chip of a draft, and a first chip whose text holds that second chip's exact label (review 3469 F2, F3). */
const NEXT = numbered('next', 20);
const NEXT_TOKEN = '[Pasted text #2 +20 lines]';
const HOLDER = `holder head\n${numbered('holder', 9)}\n${NEXT_TOKEN}\n${numbered('holder tail', 9)}`;
const HOLDER_TOKEN = '[Pasted text #1 +20 lines]';

const pasteText = async (s: Opened, text: string): Promise<void> => {
  await s.page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await s.field.focus();
  await s.page.keyboard.press('Control+V');
};
const caretAt = (s: Opened, at: number): Promise<void> =>
  s.field.evaluate((el: HTMLTextAreaElement, c) => el.setSelectionRange(c, c), at);
const undo = (s: Opened): Promise<void> => s.page.keyboard.press('Control+Z');
const redo = (s: Opened): Promise<void> => s.page.keyboard.press('Control+Shift+Z');
/** The field's value and the numbers of the chips the row lists, once the value reads `value`. */
const settled = async (s: Opened, value: string): Promise<string[]> => {
  await expect.poll(() => s.field.inputValue()).toBe(value);
  return s.page.locator('.paste-chip-n').allTextContents();
};

describe('undo and redo restore chips by position, never by a label-shaped string (review 3469, refined, 1280px)', () => {
  it('F1: redo of an Expand whose text starts with [ gives that text once, and the send carries it once', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await s.field.focus();
      await s.page.keyboard.type('ab');
      await s.page.keyboard.press('ArrowLeft');
      await pasteText(s, BRACKETED);
      expect(await settled(s, `a${BRACKETED_TOKEN}b`)).toEqual(['#1']);
      await s.page.getByRole('button', { name: 'Expand pasted text #1, 21 lines, into the message' }).click();
      expect(await settled(s, `a${BRACKETED}b`)).toEqual([]);
      await undo(s);
      expect(await settled(s, `a${BRACKETED_TOKEN}b`)).toEqual(['#1']);
      await redo(s);
      expect(await settled(s, `a${BRACKETED}b`)).toEqual([]);
      await undo(s);
      expect(await settled(s, `a${BRACKETED_TOKEN}b`)).toEqual(['#1']);
      await redo(s);
      expect(await settled(s, `a${BRACKETED}b`)).toEqual([]);
      expect(await sendAndSettle(s)).toEqual([{ text: `a${BRACKETED}b` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('F2: a long paste inside a label whose text holds the new label binds the label the paste appended', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await pasteText(s, HOLDER);
      expect(await settled(s, HOLDER_TOKEN)).toEqual(['#1']);
      await caretAt(s, 5);
      await pasteText(s, NEXT);
      expect(await settled(s, `${HOLDER}${NEXT_TOKEN}`)).toEqual(['#2']);
      await undo(s);
      expect(await settled(s, HOLDER_TOKEN)).toEqual(['#1']);
      await redo(s);
      expect(await settled(s, `${HOLDER}${NEXT_TOKEN}`)).toEqual(['#2']);
      expect(await sendAndSettle(s)).toEqual([{ text: `${HOLDER}${NEXT}` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('F3 (a): Expand, select all, Backspace, undo: the live chip comes back where it was, not inside the expanded text', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await pasteText(s, HOLDER);
      await pasteText(s, NEXT);
      expect(await settled(s, `${HOLDER_TOKEN}${NEXT_TOKEN}`)).toEqual(['#1', '#2']);
      await s.page.getByRole('button', { name: 'Expand pasted text #1, 20 lines, into the message' }).click();
      expect(await settled(s, `${HOLDER}${NEXT_TOKEN}`)).toEqual(['#2']);
      await s.page.keyboard.press('Control+A');
      await s.page.keyboard.press('Backspace');
      expect(await settled(s, '')).toEqual([]);
      await undo(s);
      expect(await settled(s, `${HOLDER}${NEXT_TOKEN}`)).toEqual(['#2']);
      await redo(s);
      expect(await settled(s, '')).toEqual([]);
      await undo(s);
      expect(await settled(s, `${HOLDER}${NEXT_TOKEN}`)).toEqual(['#2']);
      expect(await sendAndSettle(s)).toEqual([{ text: `${HOLDER}${NEXT}` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('F3 (b): a removed chip stays removed through undo and redo of an Expand that exposes its label', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await pasteText(s, HOLDER);
      await pasteText(s, NEXT);
      expect(await settled(s, `${HOLDER_TOKEN}${NEXT_TOKEN}`)).toEqual(['#1', '#2']);
      await s.page.getByRole('button', { name: 'Remove pasted text #2' }).click();
      expect(await settled(s, HOLDER_TOKEN)).toEqual(['#1']);
      await s.page.getByRole('button', { name: 'Expand pasted text #1, 20 lines, into the message' }).click();
      expect(await settled(s, HOLDER)).toEqual([]);
      await undo(s);
      expect(await settled(s, HOLDER_TOKEN)).toEqual(['#1']);
      await redo(s);
      expect(await settled(s, HOLDER)).toEqual([]);
      expect(await sendAndSettle(s)).toEqual([{ text: HOLDER }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('F5: a word delete reaching into a label keeps the chip text, keeps ordinary words, and undo and redo work (both ways)', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await s.field.focus();
      await s.page.keyboard.type('x  yz');
      await caretAt(s, 2);
      await pasteLong(s);
      const labelled = `x ${TOKEN} yz`;
      expect(await settled(s, labelled)).toEqual(['#1']);
      // An ordinary word delete beside a chip is the browser's own.
      await caretAt(s, labelled.length);
      await s.page.keyboard.press('Control+Backspace');
      expect(await settled(s, `x ${TOKEN} `)).toEqual(['#1']);
      await undo(s);
      expect(await settled(s, labelled)).toEqual(['#1']);
      // Backward, from between the space and `yz`: the word reaches into the label.
      const afterSpace = 2 + TOKEN.length + 1;
      await caretAt(s, afterSpace);
      await s.page.keyboard.press('Control+Backspace');
      const back = await settled(s, `x ${LONG}yz`);
      expect(back).toEqual([]);
      expect(await state(s)).toEqual({ value: `x ${LONG}yz`, focused: true, sel: [2 + LONG.length, 2 + LONG.length] });
      await undo(s);
      expect(await settled(s, labelled)).toEqual(['#1']);
      await redo(s);
      expect(await settled(s, `x ${LONG}yz`)).toEqual([]);
      await undo(s);
      expect(await settled(s, labelled)).toEqual(['#1']);
      // Forward, from between `x` and the space: the word reaches into the label from its left.
      await caretAt(s, 1);
      await s.page.keyboard.press('Control+Delete');
      expect(await settled(s, `x${LONG} yz`)).toEqual([]);
      await undo(s);
      expect(await settled(s, labelled)).toEqual(['#1']);
      expect(await sendAndSettle(s)).toEqual([{ text: `x ${LONG} yz` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('F4: an input method composing inside a label is never scripted: its text lands once, beside the chip text', async () => {
    // Driven through Chrome's own composition (DevTools `Input.imeSetComposition`, then a commit), not an operating
    // system's input method or a phone keyboard.
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await s.field.focus();
      await s.page.keyboard.type('ab');
      await s.page.keyboard.press('ArrowLeft');
      await pasteLong(s);
      expect(await settled(s, `a${TOKEN}b`)).toEqual(['#1']);
      const cdp = await s.page.context().newCDPSession(s.page);
      const compose = async (): Promise<void> => {
        await cdp.send('Input.imeSetComposition', { text: 'k', selectionStart: 1, selectionEnd: 1 });
        await cdp.send('Input.imeSetComposition', { text: 'ka', selectionStart: 2, selectionEnd: 2 });
        await cdp.send('Input.insertText', { text: 'か' });
      };
      // Right after the label: the chip stays, the composed text follows it.
      await caretAt(s, 1 + TOKEN.length);
      await compose();
      expect(await settled(s, `a${TOKEN}かb`)).toEqual(['#1']);
      await undo(s);
      expect(await settled(s, `a${TOKEN}b`)).toEqual(['#1']);
      // Inside the label: the composition lands as the input method made it, and when it ends the label becomes its
      // full text with the composed text after it, once, the caret after it.
      await caretAt(s, 6);
      await compose();
      expect(await settled(s, `a${LONG}かb`)).toEqual([]);
      expect(await state(s)).toEqual({ value: `a${LONG}かb`, focused: true, sel: [2 + LONG.length, 2 + LONG.length] });
      // The stated limit: that expansion is a value the composer writes, so the browser's undo then has nothing to
      // undo; nothing is lost or doubled.
      await undo(s);
      await s.page.waitForTimeout(200);
      expect(await s.field.inputValue()).toBe(`a${LONG}かb`);
      expect(await sendAndSettle(s)).toEqual([{ text: `a${LONG}かb` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('A5: a short paste inside a label expands it before the paste, and undo and redo follow', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await pasteLong(s);
      expect(await settled(s, TOKEN)).toEqual(['#1']);
      await caretAt(s, 6);
      await pasteText(s, 'short');
      expect(await state(s)).toEqual({ value: `${LONG}short`, focused: true, sel: [LONG.length + 5, LONG.length + 5] });
      expect(await s.page.locator('.paste-chip-n').allTextContents()).toEqual([]);
      await undo(s);
      expect(await settled(s, TOKEN)).toEqual(['#1']);
      await redo(s);
      expect(await settled(s, `${LONG}short`)).toEqual([]);
      expect(await sendAndSettle(s)).toEqual([{ text: `${LONG}short` }]);
    } finally {
      await s.ctx.close();
    }
  });

  it('A4: Enter on the focused expand control and Space on the focused remove control act, and focus returns to the field', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await s.field.focus();
      await s.page.keyboard.type('ab');
      await s.page.keyboard.press('ArrowLeft');
      await pasteLong(s);
      expect(await settled(s, `a${TOKEN}b`)).toEqual(['#1']);
      const expand = s.page.getByRole('button', { name: 'Expand pasted text #1, 42 lines, into the message' });
      await expand.focus();
      await s.page.keyboard.press('Enter');
      expect(await state(s)).toEqual({ value: `a${LONG}b`, focused: true, sel: [1 + LONG.length, 1 + LONG.length] });
      await undo(s);
      expect(await settled(s, `a${TOKEN}b`)).toEqual(['#1']);
      await s.page.getByRole('button', { name: 'Remove pasted text #1' }).focus();
      await s.page.keyboard.press('Space');
      expect(await state(s)).toEqual({ value: 'ab', focused: true, sel: [1, 1] });
      await undo(s);
      expect(await settled(s, `a${TOKEN}b`)).toEqual(['#1']);
      expect(await sendAndSettle(s)).toEqual([{ text: `a${LONG}b` }]);
    } finally {
      await s.ctx.close();
    }
  });
});

/** The contrast of `el`'s text on the ground actually drawn behind it: every background from the element up to the
 *  page composited over the one below it. Runs in the page. */
const contrastOf = (el: Element): number => {
  const parse = (s: string): number[] => {
    const v = (s.match(/[\d.]+/g) ?? []).map(Number);
    const rgb = s.startsWith('color(') ? v.slice(0, 3).map((n) => n * 255) : v.slice(0, 3);
    return [...rgb, v.length > 3 ? v[3]! : 1];
  };
  const layers: number[][] = [];
  for (let n: Element | null = el; n !== null; n = n.parentElement) layers.push(parse(getComputedStyle(n).backgroundColor));
  let ground = [255, 255, 255];
  for (const [r, g, b, a] of layers.reverse()) ground = [r!, g!, b!].map((c, i) => c * a! + ground[i]! * (1 - a!));
  const [r, g, b, a] = parse(getComputedStyle(el).color);
  const ink = [r!, g!, b!].map((c, i) => c * a! + ground[i]! * (1 - a!));
  const lum = (c: number[]): number => {
    const ch = (v: number): number => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * ch(c[0]!) + 0.7152 * ch(c[1]!) + 0.0722 * ch(c[2]!);
  };
  const [hi, lo] = [lum(ink), lum(ground)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('the chip reads at 4.5:1 on the ground drawn behind it, at rest, hovered and focused (F1)', () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    for (const theme of [PHOSPHOR, 'light']) {
      it(`${skin}, ${theme}`, async () => {
        const s = await open({ skin, theme, width: 1280 });
        try {
          await pasteLong(s);
          await expect.poll(() => s.field.inputValue()).toBe(TOKEN);
          const expand = s.page.getByRole('button', { name: 'Expand pasted text #1, 42 lines, into the message' });
          const remove = s.page.getByRole('button', { name: 'Remove pasted text #1' });
          const glyph = remove.locator('span');
          const label = s.page.locator('.paste-chip-label');
          const read = async (): Promise<Record<string, number>> => ({
            label: await label.evaluate(contrastOf),
            expand: await expand.evaluate(contrastOf),
            remove: await glyph.evaluate(contrastOf),
          });
          const states: Record<string, Record<string, number>> = { rest: await read() };
          await expand.hover();
          await s.page.waitForTimeout(300);
          states['expand hovered'] = { expand: await expand.evaluate(contrastOf) };
          await remove.hover();
          await s.page.waitForTimeout(300);
          states['remove hovered'] = { remove: await glyph.evaluate(contrastOf) };
          await s.page.mouse.move(0, 0);
          // Keyboard focus: Shift+Tab back from the field until the expand control has it, then Tab to the remove
          // control; each reading asserts which control holds focus (review 3469 A1).
          const focused = (el: Element): boolean => el === document.activeElement;
          await s.field.focus();
          for (let i = 0; i < 8 && !(await expand.evaluate(focused)); i += 1) await s.page.keyboard.press('Shift+Tab');
          expect(await expand.evaluate(focused), 'expand control focused').toBe(true);
          await s.page.waitForTimeout(300);
          states['expand focused'] = { expand: await expand.evaluate(contrastOf) };
          await s.page.keyboard.press('Tab');
          expect(await remove.evaluate(focused), 'remove control focused').toBe(true);
          await s.page.waitForTimeout(300);
          states['remove focused'] = { remove: await glyph.evaluate(contrastOf) };
          for (const [name, pairs] of Object.entries(states)) {
            for (const [what, ratio] of Object.entries(pairs)) expect(ratio, `${what}, ${name}`).toBeGreaterThanOrEqual(4.5);
          }
          expect(s.errors).toEqual([]);
        } finally {
          await s.ctx.close();
        }
      });
    }
  }
});

describe('at a phone width the chip’s controls reach the floor and the page does not scroll sideways', () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    for (const theme of [PHOSPHOR, 'light']) {
      it(`${skin}, ${theme}, 390px`, async () => {
        const s = await open({ skin, theme, width: 390 });
        try {
          await pasteLong(s);
          await expect.poll(() => s.field.inputValue()).toBe(TOKEN);
          for (const name of ['Expand pasted text #1, 42 lines, into the message', 'Remove pasted text #1']) {
            const box = await s.page.getByRole('button', { name }).boundingBox();
            expect(box, name).not.toBeNull();
            expect(box!.width, name).toBeGreaterThanOrEqual(44);
            expect(box!.height, name).toBeGreaterThanOrEqual(44);
          }
          const sideways = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(sideways).toBeLessThanOrEqual(0);
          await s.page.getByRole('button', { name: 'Expand pasted text #1, 42 lines, into the message' }).click();
          await expect.poll(() => s.field.inputValue()).toBe(LONG);
          expect(s.errors).toEqual([]);
        } finally {
          await s.ctx.close();
        }
      });
    }
  }
});
