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
// screen the controls reach the 44px floor and the page does not scroll sideways.
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
      await s.page.getByRole('button', { name: 'Remove pasted text #1' }).click();
      expect(await state(s)).toEqual({ value: 'ab', focused: true, sel: [1, 1] });
      await undoBringsItBack(s);
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
          // Keyboard focus: Tab forward from the field until the expand control has it.
          await s.field.focus();
          for (let i = 0; i < 8 && !(await expand.evaluate((el) => el === document.activeElement)); i += 1) await s.page.keyboard.press('Shift+Tab');
          await s.page.waitForTimeout(300);
          states['expand focused'] = { expand: await expand.evaluate(contrastOf) };
          await s.page.keyboard.press('Tab');
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
