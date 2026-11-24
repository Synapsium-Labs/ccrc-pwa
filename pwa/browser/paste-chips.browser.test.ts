// Paste chips in a real Chrome over the production build (desktop-polish wave 169; Goals modification 90, second
// half). A chip is its label between two invisible markers, so the field's value itself says which chips it holds, and
// the browser's own undo and redo bring the markers back with the label (review 3480's ruling). A long text written to
// the clipboard and pasted with the keyboard shows as ONE chip in the field and ONE in the row above it, and the send
// makes ONE request whose `text` is the full pasted text, counted after a settling window. Measured here, each with the
// chip row and the one request's payload read: Backspace after a chip and Delete before it take it whole, with typed
// text kept on both sides; arrow keys, Shift+arrow, word moves and a click keep the caret off a chip's inside and
// select it whole; Expand and Remove, by click and by Enter and Space on the focused control, leave focus in the field
// and the caret in place; a word delete reaching into a chip takes it whole; a composition beside a chip, driven
// through Chrome's own; copy and cut carry the full text; undo and redo after each; review 3480's F1 (a long paste over
// a selection ending inside a chip, from plain text and from another chip), F2 (`[` and a short paste starting with one
// over a fully selected chip) and F3 (a hand-typed copy of a live label beside the chip, and the label retyped after the
// chip was deleted, through undo and redo); review 3589's cases (a label never wraps at 390 px; a soft line delete
// beside a chip takes it whole; a composition reaching into a label shows the break and holds the send, and undo, redo,
// the notice's Undo and its Dismiss walk through it; after a send, a label the redo brings back names nothing); and in
// both skins and both palettes the chip's label, its expand control and its remove glyph read at 4.5:1 or better on the
// ground drawn behind them, at rest, hovered and keyboard-focused. At a phone width with a touch screen the controls
// reach the 44px floor and the page does not scroll sideways.
//
// The review cases compare what the field shows (`shown`, and `seen` where the label's spaces differ between
// revisions), so they run unchanged against the revisions those reviews read (the task note's red-first counts).
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
/** A visible label, and the chip as the field holds it: that label between the two markers. */
/** The label's spaces are no-break (review 3589), so it never wraps. `TYPED` is the same label typed by hand. */
const token = (n: number, l: number): string => `[Pasted text #${n} +${l} lines]`.replace(/ /g, '\u00a0');
const chip = (n: number, l: number): string => `\u2062${token(n, l)}\u2063`;
const TOKEN = token(1, 42);
const CHIP = chip(1, 42);
const TYPED = '[Pasted text #1 +42 lines]';
/** What the field shows: its value without the invisible markers. */
const shown = (v: string): string => v.replace(/[\u2062\u2063]/g, '');

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
        await expect.poll(() => s.field.inputValue()).toBe(CHIP);
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

const pasteText = async (s: Opened, text: string): Promise<void> => {
  await s.page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await s.field.focus();
  await s.page.keyboard.press('Control+V');
};
/** Set the selection, then let the browser's `selectionchange` for it run before anything else moves it (Chrome sends
 *  one for two moves made in a row, and the composer reads where the focus came from). */
const caretAt = async (s: Opened, at: number, end = at): Promise<void> => {
  await s.field.evaluate((el: HTMLTextAreaElement, [c, e]) => el.setSelectionRange(c!, e!), [at, end]);
  await s.page.waitForTimeout(40);
};
const undo = (s: Opened): Promise<void> => s.page.keyboard.press('Control+Z');
const redo = (s: Opened): Promise<void> => s.page.keyboard.press('Control+Shift+Z');
/** The numbers of the chips the row lists, once the field's value reads `value`. */
const settled = async (s: Opened, value: string): Promise<string[]> => {
  await expect.poll(() => s.field.inputValue()).toBe(value);
  return s.page.locator('.paste-chip-n').allTextContents();
};
/** What a reader sees, with a no-break space read as a space: the same for the reviewed revisions' labels. */
const seen = (v: string): string => shown(v).replace(/\u00a0/g, ' ');
/** The same as `settled`, once the field SHOWS `text` (both read by `seen`). */
const shows = async (s: Opened, text: string): Promise<string[]> => {
  await expect.poll(async () => seen(await s.field.inputValue())).toBe(seen(text));
  return s.page.locator('.paste-chip-n').allTextContents();
};
/** The selection after a key, once the browser has had its say. */
const after = async (s: Opened, key: string): Promise<[number, number]> => {
  await s.page.keyboard.press(key);
  await s.page.waitForTimeout(40);
  return (await state(s)).sel as [number, number];
};

describe('with typed text on both sides of the chip (refined, 1280px)', () => {
  const LABELLED = `a${CHIP}b`;
  const AFTER = 1 + CHIP.length;

  /** `a` + chip + `b`, the caret at `at`. */
  const setup = async (s: Opened, at: number): Promise<void> => {
    await s.field.focus();
    await s.page.keyboard.type('ab');
    await s.page.keyboard.press('ArrowLeft');
    await pasteLong(s);
    await expect.poll(() => s.field.inputValue()).toBe(LABELLED);
    await caretAt(s, at);
  };

  const undoBringsItBack = async (s: Opened): Promise<void> => {
    await undo(s);
    expect(await settled(s, LABELLED)).toEqual(['#1']);
  };
  /** Redo gives `then` back with no chip, and a second undo brings the chip back again. */
  const redoThenUndo = async (s: Opened, then: string): Promise<void> => {
    await redo(s);
    expect(await settled(s, then)).toEqual([]);
    await undoBringsItBack(s);
  };

  it('Backspace after the chip and Delete before it take it whole, keep both sides, and undo and redo follow', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await setup(s, AFTER);
      await s.page.keyboard.press('Backspace');
      expect(await state(s)).toEqual({ value: 'ab', focused: true, sel: [1, 1] });
      expect(await s.page.getByRole('list', { name: 'Pasted text' }).count()).toBe(0);
      await undoBringsItBack(s);
      await redoThenUndo(s, 'ab');
      await caretAt(s, 1);
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
      await undo(s);
      expect(await settled(s, 'ab')).toEqual([]);
      await redo(s);
      expect(await settled(s, LABELLED)).toEqual(['#1']);
      expect(await sendAndSettle(s)).toEqual([{ text: `a${LONG}b` }]);
    } finally {
      await s.ctx.close();
    }
  });

  it('Expand and Remove leave focus in the field with the caret in place, and undo and redo follow', async () => {
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

  it('Enter on the focused expand control and Space on the focused remove control act, focus back in the field', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await setup(s, 0);
      await s.page.getByRole('button', { name: 'Expand pasted text #1, 42 lines, into the message' }).focus();
      await s.page.keyboard.press('Enter');
      expect(await state(s)).toEqual({ value: `a${LONG}b`, focused: true, sel: [1 + LONG.length, 1 + LONG.length] });
      await undoBringsItBack(s);
      await redoThenUndo(s, `a${LONG}b`);
      await s.page.getByRole('button', { name: 'Remove pasted text #1' }).focus();
      await s.page.keyboard.press('Space');
      expect(await state(s)).toEqual({ value: 'ab', focused: true, sel: [1, 1] });
      await undoBringsItBack(s);
      await redoThenUndo(s, 'ab');
      expect(await sendAndSettle(s)).toEqual([{ text: `a${LONG}b` }]);
    } finally {
      await s.ctx.close();
    }
  });

  it('arrows, Shift+arrows, word moves and a click never leave the caret inside the chip', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await setup(s, 1);
      await s.page.waitForTimeout(40);
      expect(await after(s, 'ArrowRight')).toEqual([AFTER, AFTER]);
      expect(await after(s, 'ArrowRight')).toEqual([AFTER + 1, AFTER + 1]);
      expect(await after(s, 'ArrowLeft')).toEqual([AFTER, AFTER]);
      expect(await after(s, 'ArrowLeft')).toEqual([1, 1]);
      expect(await after(s, 'Shift+ArrowRight')).toEqual([1, AFTER]);
      expect(await after(s, 'Shift+ArrowLeft')).toEqual([1, 1]);
      await caretAt(s, 0);
      await s.page.waitForTimeout(40);
      for (let i = 0; i < 4; i += 1) {
        const [a, b] = await after(s, 'Control+ArrowRight');
        expect(a === b && (a <= 1 || a >= AFTER), `word move ${i} at ${a}`).toBe(true);
      }
      for (let i = 0; i < 4; i += 1) {
        const [a, b] = await after(s, 'Control+ArrowLeft');
        expect(a === b && (a <= 1 || a >= AFTER), `word move back ${i} at ${a}`).toBe(true);
      }
      // A click in the middle of the label: the caret goes to the nearer edge.
      const box = (await s.field.boundingBox())!;
      for (const x of [0.1, 0.3, 0.5]) {
        await s.page.mouse.click(box.x + 8 + x * 200, box.y + box.height / 2);
        await s.page.waitForTimeout(40);
        const [a, b] = (await state(s)).sel as [number, number];
        expect(a === b && (a <= 1 || a >= AFTER), `click at ${x}: ${a}`).toBe(true);
      }
      // Typed over a selection that covers the chip, the key replaces the chip; undo brings it back.
      await caretAt(s, 1);
      await s.page.waitForTimeout(40);
      await after(s, 'Shift+ArrowRight');
      await s.page.keyboard.type('X');
      expect(await settled(s, 'aXb')).toEqual([]);
      await undo(s);
      expect(await settled(s, LABELLED)).toEqual(['#1']);
      expect(await sendAndSettle(s)).toEqual([{ text: `a${LONG}b` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('copy and cut put the full text on the clipboard, never the label; a cut ending inside the chip takes it whole', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await setup(s, 0);
      await s.page.waitForTimeout(40);
      const clip = (): Promise<string> => s.page.evaluate(() => navigator.clipboard.readText());
      await s.page.keyboard.press('Control+A');
      await s.page.keyboard.press('Control+C');
      await expect.poll(clip).toBe(`a${LONG}b`);
      expect(await s.field.inputValue()).toBe(LABELLED);
      await caretAt(s, 0);
      await caretAt(s, 0, 6);
      await s.page.keyboard.press('Control+X');
      await expect.poll(clip).toBe(`a${LONG}`);
      expect(await state(s)).toEqual({ value: 'b', focused: true, sel: [0, 0] });
      await undoBringsItBack(s);
      await redoThenUndo(s, 'b');
      expect(await sendAndSettle(s)).toEqual([{ text: `a${LONG}b` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('a word delete reaching into the chip takes it whole, from either side; an ordinary one is the browser’s own', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await s.field.focus();
      await s.page.keyboard.type('x  yz');
      await caretAt(s, 2);
      await pasteLong(s);
      const labelled = `x ${CHIP} yz`;
      expect(await settled(s, labelled)).toEqual(['#1']);
      await caretAt(s, labelled.length);
      await s.page.keyboard.press('Control+Backspace');
      expect(await settled(s, `x ${CHIP} `)).toEqual(['#1']);
      await undo(s);
      expect(await settled(s, labelled)).toEqual(['#1']);
      // Backward from after the space that follows the chip.
      await caretAt(s, 2 + CHIP.length + 1);
      await s.page.keyboard.press('Control+Backspace');
      const back = (await state(s)).value;
      expect(shown(back)).not.toContain('Pasted');
      expect(await s.page.locator('.paste-chip-n').allTextContents()).toEqual([]);
      await undo(s);
      expect(await settled(s, labelled)).toEqual(['#1']);
      await redo(s);
      expect(await settled(s, back)).toEqual([]);
      await undo(s);
      expect(await settled(s, labelled)).toEqual(['#1']);
      // Forward from between `x` and the space.
      await caretAt(s, 1);
      await s.page.keyboard.press('Control+Delete');
      const fwd = (await state(s)).value;
      expect(shown(fwd)).not.toContain('Pasted');
      expect(await s.page.locator('.paste-chip-n').allTextContents()).toEqual([]);
      await undo(s);
      expect(await settled(s, labelled)).toEqual(['#1']);
      await redo(s);
      expect(await settled(s, fwd)).toEqual([]);
      await undo(s);
      expect(await settled(s, labelled)).toEqual(['#1']);
      expect(await sendAndSettle(s)).toEqual([{ text: `x ${LONG} yz` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('a composition beside the chip keeps it, and undo follows (Chrome’s own composition)', async () => {
    // Driven through Chrome's own composition (DevTools `Input.imeSetComposition`, then a commit), not an operating
    // system's input method or a phone keyboard.
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await setup(s, AFTER);
      const cdp = await s.page.context().newCDPSession(s.page);
      await cdp.send('Input.imeSetComposition', { text: 'k', selectionStart: 1, selectionEnd: 1 });
      expect(await s.page.locator('.paste-chip-n').allTextContents()).toEqual(['#1']);
      await cdp.send('Input.imeSetComposition', { text: 'ka', selectionStart: 2, selectionEnd: 2 });
      await cdp.send('Input.insertText', { text: 'か' });
      expect(await settled(s, `a${CHIP}かb`)).toEqual(['#1']);
      await undo(s);
      expect(await settled(s, LABELLED)).toEqual(['#1']);
      await redo(s);
      expect(await settled(s, `a${CHIP}かb`)).toEqual(['#1']);
      expect(await sendAndSettle(s)).toEqual([{ text: `a${LONG}かb` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });
});

/** `n` numbered lines tagged `tag`, none with edge whitespace. */
const numbered = (tag: string, n: number): string => Array.from({ length: n }, (_, i) => `${tag} line ${i + 1}`).join('\n');
/** A text that starts with `[`, as a JSON array or a timestamped log does: 21 lines. */
const BRACKETED = `[12:00:01] paste probe head\n${numbered('br', 20)}`;
/** A second chip, and a first chip whose text holds that second chip's exact label. */
const NEXT = numbered('next', 20);
const HOLDER = `holder head\n${numbered('holder', 9)}\n${token(2, 20)}\n${numbered('holder tail', 9)}`;
const THIRD = numbered('third', 16);

describe('review 3480: a paste over a selection, a key over a chip, a retyped label (refined, 1280px)', () => {
  it('F1: a long paste over a selection from plain text into a chip replaces the chip and is a chip', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await s.field.focus();
      await s.page.keyboard.type('ab');
      await s.page.keyboard.press('ArrowLeft');
      await pasteLong(s);
      expect(await shows(s, `a${TOKEN}b`)).toEqual(['#1']);
      const v = await s.field.inputValue();
      await caretAt(s, 0);
      await caretAt(s, 0, v.indexOf('[Pasted') + 5);
      await pasteText(s, NEXT);
      expect(await shows(s, `${token(2, 20)}b`)).toEqual(['#2']);
      await undo(s);
      expect(await shows(s, `a${TOKEN}b`)).toEqual(['#1']);
      await redo(s);
      expect(await shows(s, `${token(2, 20)}b`)).toEqual(['#2']);
      expect(await sendAndSettle(s)).toEqual([{ text: `${NEXT}b` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('F1: a long paste over a selection from one chip into another replaces both and is a chip', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await s.field.focus();
      await s.page.keyboard.type('amb');
      await caretAt(s, 2);
      await pasteText(s, NEXT);
      await caretAt(s, 1);
      await pasteLong(s);
      expect(await shows(s, `a${token(2, 42)}m${token(1, 20)}b`)).toEqual(['#2', '#1']);
      const v = await s.field.inputValue();
      await caretAt(s, 0);
      await caretAt(s, v.indexOf('[Pasted') + 4, v.lastIndexOf('[Pasted') + 5);
      await pasteText(s, THIRD);
      expect(await shows(s, `a${token(3, 16)}b`)).toEqual(['#3']);
      await undo(s);
      expect(await shows(s, `a${token(2, 42)}m${token(1, 20)}b`)).toEqual(['#2', '#1']);
      await redo(s);
      expect(await shows(s, `a${token(3, 16)}b`)).toEqual(['#3']);
      expect(await sendAndSettle(s)).toEqual([{ text: `a${THIRD}b` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('F2: `[` typed over a fully selected chip replaces it, and nothing is revived through undo and redo', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await pasteLong(s);
      expect(await shows(s, TOKEN)).toEqual(['#1']);
      await s.page.keyboard.press('Control+A');
      await s.page.keyboard.type('[');
      expect(await shows(s, '[')).toEqual([]);
      await undo(s);
      expect(await shows(s, TOKEN)).toEqual(['#1']);
      await redo(s);
      expect(await shows(s, '[')).toEqual([]);
      expect(await sendAndSettle(s)).toEqual([{ text: '[' }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('F2: a short paste starting with `[` over a fully selected chip replaces it', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await pasteLong(s);
      expect(await shows(s, TOKEN)).toEqual(['#1']);
      await s.page.keyboard.press('Control+A');
      await pasteText(s, '[short]');
      expect(await shows(s, '[short]')).toEqual([]);
      await undo(s);
      expect(await shows(s, TOKEN)).toEqual(['#1']);
      await redo(s);
      expect(await shows(s, '[short]')).toEqual([]);
      expect(await sendAndSettle(s)).toEqual([{ text: '[short]' }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('F3: a hand-typed copy of the live label beside the chip stays text through every undo and redo', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await pasteLong(s);
      expect(await shows(s, TOKEN)).toEqual(['#1']);
      await s.page.keyboard.type(` ${TYPED}`);
      expect(await shows(s, `${TOKEN} ${TYPED}`)).toEqual(['#1']);
      // Every undo and redo, read: the row lists the chip exactly when the field starts with it, and never the copy.
      // (Read from what the field shows, so this case means the same against the reviewed revision.)
      const step = async (key: () => Promise<void>, what: string): Promise<string> => {
        await key();
        await s.page.waitForTimeout(20);
        const v = await s.field.inputValue();
        expect(await s.page.locator('.paste-chip-n').allTextContents(), `${what}: ${shown(v)}`).toEqual(shown(v).startsWith(TOKEN) ? ['#1'] : []);
        return v;
      };
      let steps = 0;
      for (let v = await s.field.inputValue(); v !== '' && steps < 60; steps += 1) v = await step(() => undo(s), `undo ${steps}`);
      for (let i = 0; i < steps; i += 1) await step(() => redo(s), `redo ${i}`);
      expect(await shows(s, `${TOKEN} ${TYPED}`)).toEqual(['#1']);
      expect(await sendAndSettle(s)).toEqual([{ text: `${LONG} ${TYPED}` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('F3: the label retyped by hand after the chip was deleted is never a chip; undo back to the chip brings the chip', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await pasteLong(s);
      expect(await shows(s, TOKEN)).toEqual(['#1']);
      await s.page.keyboard.press('Backspace');
      expect(await shows(s, '')).toEqual([]);
      await s.page.keyboard.type('x');
      await s.page.keyboard.type(`${TYPED} z`);
      await s.page.keyboard.press('Home');
      await s.page.keyboard.press('Delete');
      expect(await shows(s, `${TYPED} z`)).toEqual([]);
      // Undo back to the chip, reading every step: the row lists the chip exactly when the field holds it, and the
      // hand-typed label is never one. (Chrome undoes a delete and the typing after it as one step, and its redo of
      // that step brings back the delete alone, in a plain textarea too: measured, so redo is not read here.)
      let steps = 0;
      while ((await s.field.inputValue()) !== CHIP && steps < 60) {
        await undo(s);
        await s.page.waitForTimeout(20);
        const v = await s.field.inputValue();
        expect(await s.page.locator('.paste-chip-n').allTextContents(), `undo ${steps}: ${shown(v)}`).toEqual(v === CHIP ? ['#1'] : []);
        steps += 1;
      }
      expect(await shows(s, TOKEN)).toEqual(['#1']);
      expect(await sendAndSettle(s)).toEqual([{ text: LONG }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });
});

describe('review 3480 F6: Enter while a composition is open (refined, 1280px)', () => {
  it('Enter during Chrome’s own composition sends nothing; after it ends, Enter sends once', async () => {
    // Chrome's own composition (DevTools), not an operating system's input method.
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await pasteLong(s);
      expect(await shows(s, TOKEN)).toEqual(['#1']);
      const cdp = await s.page.context().newCDPSession(s.page);
      const composing = await s.field.evaluate((el: HTMLTextAreaElement) => {
        const seen: boolean[] = [];
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') seen.push(e.isComposing); });
        (window as unknown as { seen: boolean[] }).seen = seen;
        return true;
      });
      expect(composing).toBe(true);
      await cdp.send('Input.imeSetComposition', { text: 'ka', selectionStart: 2, selectionEnd: 2 });
      await s.page.keyboard.press('Enter');
      await s.page.waitForTimeout(400);
      const seen = await s.page.evaluate(() => (window as unknown as { seen: boolean[] }).seen);
      expect(seen).toEqual([true]); // Chrome marks that keydown as composing (measured)
      expect(s.bodies).toEqual([]);
      await cdp.send('Input.insertText', { text: 'か' });
      await s.page.waitForTimeout(100);
      // Chrome's synthetic composition lets that Enter's own newline land after the composed text (measured); an
      // operating system's input method takes the Enter itself (not measured). Today's trim takes the newline.
      expect(shown(await s.field.inputValue())).toBe(`${TOKEN}か\n`);
      expect(await sendAndSettle(s)).toEqual([{ text: `${LONG}か` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });
});

describe('review 3589: a break is shown and held, and the browser’s undo walks back through it', () => {
  /** The break notice, its two controls, and whether Send is enabled. */
  const broken = (s: Opened) => s.page.locator('.paste-broken');
  const undoControl = (s: Opened) => s.page.getByRole('button', { name: 'Undo the edit that broke the pasted block' });
  const dismissControl = (s: Opened) =>
    s.page.getByRole('button', { name: 'Dismiss the broken pasted block and keep the text as it shows' });
  /** Enter, then a settling window: whether any request left. */
  const enterSendsNothing = async (s: Opened): Promise<void> => {
    const before = s.bodies.length;
    await s.field.focus();
    await s.page.keyboard.press('Enter');
    await s.page.waitForTimeout(400);
    expect(s.bodies).toHaveLength(before);
  };

  it('at 390 px a label never wraps, whatever stands before it on its line', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 390 });
    try {
      await pasteLong(s);
      expect(await shows(s, TOKEN)).toEqual(['#1']);
      const written = await s.field.inputValue(); // the chip as the composer wrote it
      // Measured on the field itself: for each run of text before the chip, the line the chip's end sits on starts at or
      // before the chip, and the line its start sits on ends at or after it. (Values written for the reading, then put
      // back; no input event.)
      const wraps = await s.field.evaluate((el: HTMLTextAreaElement, c: string) => {
        const keep = el.value;
        const bad: number[] = [];
        for (let k = 0; k < 40; k += 1) {
          el.value = `${'w'.repeat(k)} ${c} tail`;
          const s0 = k + 1;
          const e0 = s0 + c.length;
          el.setSelectionRange(e0, e0);
          document.getSelection()!.modify('move', 'backward', 'lineboundary');
          const from = el.selectionStart;
          el.setSelectionRange(s0, s0);
          document.getSelection()!.modify('move', 'forward', 'lineboundary');
          if (from > s0 || el.selectionEnd < e0) bad.push(k);
        }
        el.value = keep;
        return bad;
      }, written);
      expect(wraps).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('a line delete from after the chip takes it whole; undo and redo walk through it (390 px)', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 390 });
    try {
      await s.field.focus();
      await s.page.keyboard.type('www ');
      await pasteLong(s);
      await s.page.keyboard.type(' tail');
      const whole = `www ${CHIP} tail`;
      expect(await shows(s, whole)).toEqual(['#1']);
      await caretAt(s, 4 + CHIP.length);
      await s.field.evaluate((el) => {
        const w = window as unknown as { kinds: string[] };
        w.kinds = [];
        el.addEventListener('beforeinput', (e) => w.kinds.push((e as InputEvent).inputType));
      });
      await s.page.keyboard.press('Control+Shift+Backspace');
      // A soft line delete, the browser's own (the composer plans none).
      expect(await s.page.evaluate(() => (window as unknown as { kinds: string[] }).kinds)).toEqual(['deleteSoftLineBackward']);
      const after = await s.field.inputValue();
      expect(seen(after)).not.toContain('Pasted');
      expect(seen(after)).toContain(' tail');
      expect(await broken(s).count()).toBe(0); // a whole chip or none: nothing broken
      await undo(s);
      expect(await shows(s, whole)).toEqual(['#1']);
      await redo(s);
      expect(await shows(s, after)).toEqual([]);
      await undo(s);
      expect(await shows(s, whole)).toEqual(['#1']);
      // A touch-width view: Enter is a newline there, and Ctrl+Enter sends.
      await s.page.keyboard.press('Control+Enter');
      await expect.poll(() => s.bodies.length, { timeout: 5_000 }).toBeGreaterThan(0);
      await s.page.waitForTimeout(400);
      expect(s.bodies).toEqual([{ text: `www ${LONG} tail` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('a composition reaching into a label: the break shows, Send holds, undo and redo walk back and forth, Undo releases', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await s.field.focus();
      await s.page.keyboard.type('ab');
      await s.page.keyboard.press('ArrowLeft');
      await pasteLong(s);
      const whole = `a${CHIP}b`;
      expect(await shows(s, whole)).toEqual(['#1']);
      // Chrome's own composition, replacing a range that starts in `a` and ends inside the label.
      const cdp = await s.page.context().newCDPSession(s.page);
      await cdp.send('Input.imeSetComposition', { text: 'Q', selectionStart: 1, selectionEnd: 1, replacementStart: 0, replacementEnd: 8 });
      await cdp.send('Input.insertText', { text: 'Q' });
      const hurt = await s.field.inputValue();
      expect(seen(hurt)).toBe(seen(`Q${CHIP.slice(7)}b`));
      expect(await s.page.locator('.paste-chip-n').count()).toBe(0);
      await expect.poll(() => broken(s).count()).toBe(1);
      expect(await s.page.getByRole('button', { name: 'Send' }).isDisabled()).toBe(true);
      await enterSendsNothing(s);
      expect(await s.field.inputValue()).toBe(hurt); // nothing written back on its own
      // The browser's undo walks back to the intact chip, and its redo forward to the break.
      await undo(s);
      expect(await shows(s, whole)).toEqual(['#1']);
      expect(await broken(s).count()).toBe(0);
      await redo(s);
      expect(await shows(s, hurt)).toEqual([]);
      expect(await broken(s).count()).toBe(1);
      // The notice's own Undo, with its controls at the 44px floor.
      for (const c of [undoControl(s), dismissControl(s)]) {
        const box = (await c.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await undoControl(s).click();
      expect(await shows(s, whole)).toEqual(['#1']);
      expect(await broken(s).count()).toBe(0);
      expect(await state(s)).toMatchObject({ focused: true });
      expect(await sendAndSettle(s)).toEqual([{ text: `a${LONG}b` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('Dismiss keeps every character the field shows, as one undoable edit, and releases the send', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await s.field.focus();
      await s.page.keyboard.type('ab');
      await s.page.keyboard.press('ArrowLeft');
      await pasteLong(s);
      const cdp = await s.page.context().newCDPSession(s.page);
      await cdp.send('Input.imeSetComposition', { text: 'Q', selectionStart: 1, selectionEnd: 1, replacementStart: 0, replacementEnd: 8 });
      await cdp.send('Input.insertText', { text: 'Q' });
      const hurt = await s.field.inputValue();
      await expect.poll(() => broken(s).count()).toBe(1);
      await enterSendsNothing(s);
      await dismissControl(s).click();
      expect(await shows(s, hurt)).toEqual([]);
      expect(await broken(s).count()).toBe(0);
      await undo(s);
      expect(await shows(s, hurt)).toEqual([]);
      expect(await broken(s).count()).toBe(1);
      await redo(s);
      expect(await shows(s, hurt)).toEqual([]);
      expect(await sendAndSettle(s)).toEqual([{ text: shown(hurt) }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('after a send, a label the browser’s redo brings back names nothing: no chip, the break shows, nothing sends (F5)', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await s.field.focus();
      await s.page.keyboard.type('x');
      await pasteLong(s);
      expect(await sendAndSettle(s)).toEqual([{ text: `x${LONG}` }]);
      const other = LONG.replace('paste probe head', 'other probe head'); // the same line count
      await pasteText(s, other);
      expect(await shows(s, token(2, 42))).toEqual(['#2']);
      // Chrome's history from before the send survives it (measured): undos past the new paste change nothing visible,
      // and the redo after them brings values from before the send back.
      for (let i = 0; i < 4; i += 1) await undo(s);
      expect(await shows(s, '')).toEqual([]);
      await redo(s);
      await expect.poll(async () => seen(await s.field.inputValue())).toContain(seen(token(1, 42)));
      expect(await s.page.locator('.paste-chip-n').allTextContents()).toEqual([]);
      await expect.poll(() => broken(s).count()).toBe(1);
      await enterSendsNothing(s);
      await dismissControl(s).click();
      const plain = shown(await s.field.inputValue());
      expect(seen(plain)).toContain(seen(token(1, 42)));
      await s.page.keyboard.press('Enter');
      await expect.poll(() => s.bodies.length, { timeout: 5_000 }).toBe(2);
      await s.page.waitForTimeout(400);
      expect(s.bodies).toEqual([{ text: `x${LONG}` }, { text: plain.trim() }]);
      expect(JSON.stringify(s.bodies[1])).not.toContain('probe head'); // no pasted text, old or new, behind the label
    } finally {
      await s.ctx.close();
    }
  });
});

describe('undo and redo are the value the browser restores, parsed (refined, 1280px)', () => {
  it('an Expand whose text starts with [ : undo brings the chip, redo the text, once; the send carries it once', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await s.field.focus();
      await s.page.keyboard.type('ab');
      await s.page.keyboard.press('ArrowLeft');
      await pasteText(s, BRACKETED);
      expect(await settled(s, `a${chip(1, 21)}b`)).toEqual(['#1']);
      await s.page.getByRole('button', { name: 'Expand pasted text #1, 21 lines, into the message' }).click();
      expect(await settled(s, `a${BRACKETED}b`)).toEqual([]);
      for (let i = 0; i < 2; i += 1) {
        await undo(s);
        expect(await settled(s, `a${chip(1, 21)}b`)).toEqual(['#1']);
        await redo(s);
        expect(await settled(s, `a${BRACKETED}b`)).toEqual([]);
      }
      expect(await sendAndSettle(s)).toEqual([{ text: `a${BRACKETED}b` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('a chip whose text holds the next chip’s label: Expand, select all, Backspace, undo, redo', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await pasteText(s, HOLDER);
      await pasteText(s, NEXT);
      expect(await settled(s, `${chip(1, 20)}${chip(2, 20)}`)).toEqual(['#1', '#2']);
      await s.page.getByRole('button', { name: 'Expand pasted text #1, 20 lines, into the message' }).click();
      expect(await settled(s, `${HOLDER}${chip(2, 20)}`)).toEqual(['#2']);
      await s.page.keyboard.press('Control+A');
      await s.page.keyboard.press('Backspace');
      expect(await settled(s, '')).toEqual([]);
      await undo(s);
      expect(await settled(s, `${HOLDER}${chip(2, 20)}`)).toEqual(['#2']);
      await redo(s);
      expect(await settled(s, '')).toEqual([]);
      await undo(s);
      expect(await settled(s, `${HOLDER}${chip(2, 20)}`)).toEqual(['#2']);
      expect(await sendAndSettle(s)).toEqual([{ text: `${HOLDER}${NEXT}` }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });

  it('a removed chip stays removed through undo and redo of an Expand that shows its label as text', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await pasteText(s, HOLDER);
      await pasteText(s, NEXT);
      await s.page.getByRole('button', { name: 'Remove pasted text #2' }).click();
      expect(await settled(s, chip(1, 20))).toEqual(['#1']);
      await s.page.getByRole('button', { name: 'Expand pasted text #1, 20 lines, into the message' }).click();
      expect(await settled(s, HOLDER)).toEqual([]);
      await undo(s);
      expect(await settled(s, chip(1, 20))).toEqual(['#1']);
      await redo(s);
      expect(await settled(s, HOLDER)).toEqual([]);
      expect(await sendAndSettle(s)).toEqual([{ text: HOLDER }]);
      expect(s.errors).toEqual([]);
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
          await expect.poll(() => s.field.inputValue()).toBe(CHIP);
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
          await expect.poll(() => s.field.inputValue()).toBe(CHIP);
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
