// Instrument's desk toggle row, measured in a real Chrome over the production build (T2f, D-6371; review 1117, F1).
// The row is FleetTable's `<div className="flex … flex-wrap …">`: the Status / Project radiogroup and, in project mode at a
// desk, the class chooser. jsdom has no layout, so the jsdom suites (test/fleet-class-chooser.test.tsx,
// test/instrument-list.test.tsx) pin the classes and the structure; this file holds what they cannot:
//   (a) at 900 and 1280, under a fine and a coarse pointer, in status mode and in project mode at 100% text, the row is
//       one height, `--row-h` (32 fine, 44 coarse), with or without the chooser on it, so the toggle and the list do not
//       move when the mode changes; the chooser is on the row, never overlapping the radiogroup; no option's words are cut;
//   (b) at 1280 (the 340 px list column) in project mode at 150% and 200% text, the chooser wraps BELOW the radiogroup
//       instead of running under it, the radiogroup spans the row, no option is cut, and nothing scrolls sideways.
//
// A new file, because the desk file (instrument-desk.browser.test.ts) was another task's claim when this was written.
// One theme (phosphor) is enough: the geometry is the same in both, the colours differ.
//
// TEXT SCALING is on the px TOKENS, as ask-inline.browser.test.ts does: the app's sizes are `--fs-*` px tokens, so
// the root font-size does nothing to them. Every one of them is read from the computed style and set to base * z / 100 px.
//
// The behaviour holds at HEAD, so the red is shown by mutation (each run on the working tree, then restored from a saved
// copy and sha-checked), this file alone, run with -t as named:
// MUTATION TABLE (T2f review 1117 F1; RUN):
//   `flex-wrap` removed from the row wrapper in FleetTable ... (b) "the chooser wraps below the radiogroup at 150% and 200% text": `fine pointer, 150%: the chooser wrapped below the radiogroup: expected 109 to be greater than or equal to 142` (touch: `… expected 109 to be greater than or equal to 152.5`)
//   the radiogroup's `flex-auto` made `flex-1` ................ (b) the same cases: the same two messages (the chooser stays at top 109, beside the radiogroup)
//   `className="min-h-row"` removed from the chooser in FleetTable  (a) "the row is one height in both modes, under a fine pointer": `project mode: the row is --row-h, as in status mode: expected 44 to be 32` (fine pointer at 900 and 1280; the touch cases stay green, where `--row-h` is 44)
//   the text scaling made a no-op (the test's own `setProperty` skipped) ... (b): `fine pointer, 150%: the options' font size, scaled from 13px: expected 13 to be close to 19.5` (and touch): the scaling is asserted to take, so a token that fails to scale cannot pass for a wrapped row
//
//   CCRC_CHROME=$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/fleet-toggle-row.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type DistServer } from './app';
import { GROUP_MODE_KEY } from '../src/skins/instrument/FleetTable';

const session = (ws: string, project: string, bucket: string, status: string): object => ({
  id: `${project}-${ws}`, wrapper: 'lane-a', home: 'lane-a', project, workdir: `/w/${project}/${ws}`,
  workspace: ws, name: ws, status, statusUpdatedAt: null, limits: null, dialogPending: false, version: null, model: null,
  effort: null, ultracode: false, branch: `ws/${ws}`, ctxPct: 40, paneCols: null, tasks: null, pr: null, archivedAt: null,
  archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket, unmeasured: [], started: true,
  child: { kind: 'none' },
});
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/runs': [], '/api/claims': [],
  },
  fleetFrames: [{
    type: 'fleet',
    sessions: [
      session('review-wave', 'project-a', 'attention', 'idle'), session('desk-pass', 'project-a', 'working', 'busy'),
      session('words-pass', 'project-b', 'working', 'busy'), session('tidy-run', 'project-b', 'done', 'idle'),
    ],
  }],
};

let dist: string | undefined;
let server: DistServer | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  dist = buildDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  removeDist(dist);
});

type Mode = 'status' | 'project';
const TOKENS = ['--fs-2xs', '--fs-xs', '--fs-sm', '--fs-md', '--fs-base', '--fs-lg', '--fs-xl', '--fs-2xl', '--fs-input'];

/** Open the fleet at `width` in `mode` (seeded before the first paint), the text at `zoom` per cent, and measure the row. */
async function measure(width: number, touch: boolean, mode: Mode, zoom = 100) {
  const opened = await openApp(browser!, { skin: INSTRUMENT, theme: PHOSPHOR, width, touch }, FIXTURE);
  const { ctx, page } = opened;
  try {
    await ctx.addInitScript(([key, value]) => {
      try { localStorage.setItem(key!, value!); } catch { /* no storage: the app opens on status */ }
    }, [GROUP_MODE_KEY, mode]);
    await page.setViewportSize({ width, height: 800 });
    await page.goto(server!.origin + '/');
    await page.waitForSelector('.shell-nav [role="radiogroup"]', { timeout: 20_000 });
    await page.waitForTimeout(600);
    if (zoom !== 100) await scaleText(page, zoom);
    return await page.evaluate(() => {
      const box = (el: Element): { left: number; right: number; top: number; bottom: number; width: number; height: number } => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      const group = document.querySelector<HTMLElement>('.shell-nav [role="radiogroup"]')!;
      const row = group.parentElement!;
      const choosers = [...document.querySelectorAll<HTMLElement>('select[aria-label="Class"]')];
      const nav = document.querySelector<HTMLElement>('.shell-nav')!;
      const gb = box(group);
      const cb = choosers[0] === undefined ? null : box(choosers[0]);
      return {
        rowHeight: box(row).height, rowWidth: box(row).width, group: gb, chooser: cb, choosers: choosers.length,
        inRow: choosers[0] !== undefined && row.contains(choosers[0]),
        inGroup: choosers[0] !== undefined && group.contains(choosers[0]),
        overlap: cb !== null && !(cb.left >= gb.right - 0.5 || cb.right <= gb.left + 0.5 || cb.top >= gb.bottom - 0.5 || cb.bottom <= gb.top + 0.5),
        cutOptions: [...group.querySelectorAll<HTMLElement>('[role="radio"]')].filter((o) => o.scrollWidth > o.clientWidth).map((o) => o.textContent),
        // The non-vacuity floor: the options the two checks above read, and the size their words are drawn at.
        radios: group.querySelectorAll('[role="radio"]').length,
        optionFont: parseFloat(getComputedStyle(group.querySelector<HTMLElement>('[role="radio"]') ?? group).fontSize),
        rowH: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h')),
        pageSideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        navSideScroll: nav.scrollWidth - nav.clientWidth,
      };
    });
  } finally {
    await ctx.close();
  }
}

async function scaleText(page: Page, zoom: number): Promise<void> {
  await page.evaluate(([tokens, z]) => {
    const root = document.documentElement;
    for (const t of tokens as string[]) {
      const base = parseFloat(getComputedStyle(root).getPropertyValue(t));
      if (Number.isFinite(base)) root.style.setProperty(t, `${base * (z as number) / 100}px`);
    }
  }, [TOKENS, zoom] as const);
  await page.waitForTimeout(300);
}

describe("Instrument's desk toggle row, in a real Chrome", () => {
  for (const [pointer, touch, expected] of [['fine pointer', false, 32], ['touch', true, 44]] as const) {
    for (const width of [900, 1280]) {
      it(`the row is one height in both modes, under a ${pointer} at ${width}`, async () => {
        const status = await measure(width, touch, 'status');
        const project = await measure(width, touch, 'project');
        expect(status.rowH, '`--row-h` as the page computes it').toBe(expected);
        expect(project.rowH).toBe(expected);
        expect(status.rowHeight, 'status mode: the row is --row-h').toBe(status.rowH);
        expect(project.rowHeight, 'project mode: the row is --row-h, as in status mode').toBe(status.rowHeight);
        expect([status.radios, project.radios], 'the toggle\'s two options, in each mode').toEqual([2, 2]);
        expect(status.choosers, 'status mode has no chooser on the row').toBe(0);
        expect(project.choosers, 'project mode has the one chooser').toBe(1);
        expect(project.inRow, 'the chooser is on the toggle row').toBe(true);
        expect(project.inGroup, 'the chooser is inside the radiogroup').toBe(false);
        expect(project.overlap, 'the chooser overlaps the radiogroup').toBe(false);
        expect(project.chooser!.height, 'the chooser is as tall as the row').toBe(project.rowH);
        expect(status.cutOptions, 'status mode: options whose words are cut').toEqual([]);
        expect(project.cutOptions, 'project mode: options whose words are cut').toEqual([]);
      }, 120_000);
    }
  }

  for (const [pointer, touch] of [['fine pointer', false], ['touch', true]] as const) {
    it(`the chooser wraps below the radiogroup at 150% and 200% text, under a ${pointer} at 1280`, async () => {
      const base = await measure(1280, touch, 'project');
      for (const zoom of [150, 200]) {
        const m = await measure(1280, touch, 'project', zoom);
        const at = `${pointer}, ${zoom}%`;
        // The scaling took: the options' words are drawn at the scaled size, so a token that failed to scale cannot
        // pass for a row that wraps.
        expect(m.radios, `${at}: the toggle's two options`).toBe(2);
        expect(m.optionFont, `${at}: the options' font size, scaled from ${base.optionFont}px`).toBeCloseTo(base.optionFont * zoom / 100, 0);
        expect(m.choosers, `${at}: one chooser`).toBe(1);
        expect(m.chooser!.top, `${at}: the chooser wrapped below the radiogroup`).toBeGreaterThanOrEqual(m.group.bottom - 0.5);
        expect(m.group.width, `${at}: the radiogroup spans the row`).toBeGreaterThanOrEqual(m.rowWidth - 1);
        expect(m.overlap, `${at}: the chooser overlaps the radiogroup`).toBe(false);
        expect(m.cutOptions, `${at}: options whose words are cut`).toEqual([]);
        expect(m.pageSideScroll, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(0);
        expect(m.navSideScroll, `${at}: the list column scrolls sideways`).toBeLessThanOrEqual(0);
      }
    }, 180_000);
  }
});
