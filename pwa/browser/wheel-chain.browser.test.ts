// A wheel over a code block or a tool well reaches the transcript (D-6437, desktop polish Task C5), in a real Chrome
// over the production build.
//
// A code block is a scroll container, and `overscroll-behavior: contain` on it stops scroll chaining on both axes even
// when the block has nothing to scroll: measured at 1920 in both skins, a wheel over a block moved `.chat-scroller`
// 0 px, over prose 600 px. jsdom computes no layout and dispatches no wheel, so this file holds what Chrome does with
// `page.mouse.wheel`: at 1280 and 1920 in both skins and both palettes, with the pointer over the element —
//   - a block, and a tool card's result well, whose content fits: the wheel moves the transcript and not the box;
//   - a block taller than `--well-max`: the wheel scrolls the block first, then, with the block at its end, the
//     transcript, and the block stays at its end;
//   - a block with a 300-character line: a sideways wheel moves the block's `scrollLeft` and not the transcript's
//     `scrollTop` (a regression pin: the x-axis containment is kept);
//   - control: a wheel over prose moves the transcript, which proves this harness can see a chain at all.
// Every wheel is measured from a settled position: the scroller (virtuoso, anchored to the bottom, following output)
// and the box are read until several consecutive reads agree, so settling never counts as a wheel's effect. The box's
// and the scroller's positions are read and asserted separately, so a red names which one moved. The pointer is
// checked to be over the target (`elementFromPoint`) before every wheel: over the composer or a sticky head it would
// fake a result.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/wheel-chain.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [PHOSPHOR, 'light'].flatMap((theme) =>
  [1280, 1920].map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

// ---- the fixture: one session, neutral names ----------------------------------------------------------------------
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

const TS = new Date((NOW - 600) * 1000).toISOString();
const EVENTS: object[] = [];
let n = 0;
const say = (text: string): void => {
  n += 1;
  EVENTS.push({ kind: 'assistant', uuid: `a${n}`, ts: TS, text });
};
/** A paragraph tall enough (a few wrapped lines) that the rows between the boxes give the transcript room to move. */
const prose = (label: string): void => say(
  `${label}: the checks for project-a ran in lane-a and nothing in the output needed a second look. `
  + 'Each step wrote its result to the log, the log was read from the top, and the summary below repeats only what '
  + 'changed since the last run. Nothing else in the workspace moved while they ran.');
const fence = (lines: string[]): string => `\`\`\`\n${lines.join('\n')}\n\`\`\``;

EVENTS.push({ kind: 'user', uuid: 'q1', ts: TS, text: 'Run the checks.' });
for (let i = 1; i <= 6; i += 1) prose(`Prose before ${i}`);
say(`Three lines:\n\n${fence(['fit-line-1 alpha', 'fit-line-2 beta', 'fit-line-3 gamma'])}`);
for (let i = 1; i <= 5; i += 1) prose(`Prose after fit ${i}`);
say(`One long line:\n\n${fence([`wide-${'x'.repeat(295)}`])}`);
for (let i = 1; i <= 5; i += 1) prose(`Prose after wide ${i}`);
say(`Sixty lines:\n\n${fence(Array.from({ length: 60 }, (_, i) => `tall-line-${String(i + 1).padStart(2, '0')} omega`))}`);
for (let i = 1; i <= 5; i += 1) prose(`Prose after tall ${i}`);
EVENTS.push({ kind: 'tool_use', uuid: 'u1', ts: TS, toolId: 't1', name: 'Bash', input: JSON.stringify({ command: 'npm run check' }) });
EVENTS.push({ kind: 'tool_result', ts: TS, toolId: 't1', text: 'result-line-1 ok\nresult-line-2 ok', isError: false });
for (let i = 1; i <= 8; i += 1) prose(`Prose after the card ${i}`);

// ---- the page half: what each wheel is measured on -----------------------------------------------------------------
type Kind = 'fit' | 'wide' | 'tall' | 'well' | 'prose';
interface Reading { scroller: number; boxTop: number; boxLeft: number; room: { down: number; up: number } }

/** Runs in the page before the app: finds a target by its text (virtuoso unmounts far rows, so every use re-finds it). */
function installFinder(): void {
  const w = window as unknown as { __c5: Record<string, unknown> };
  const find = (kind: string): HTMLElement | null => {
    const within = (sel: string, text: string): HTMLElement | null =>
      [...document.querySelectorAll<HTMLElement>(sel)].find((e) => (e.textContent ?? '').includes(text)) ?? null;
    if (kind === 'fit') return within('.msg-assist pre', 'fit-line-1');
    if (kind === 'wide') return within('.msg-assist pre', 'wide-');
    if (kind === 'tall') return within('.msg-assist pre', 'tall-line-01');
    if (kind === 'well') return within('.toolcard pre.well', 'result-line-1');
    return within('.msg-assist p', 'Prose after tall 2');
  };
  w.__c5 = { find };
}

async function reading(page: Page, kind: Kind): Promise<Reading | null> {
  return page.evaluate(([k]) => {
    const f = (window as unknown as { __c5: { find: (kind: string) => HTMLElement | null } }).__c5.find;
    const sc = document.querySelector<HTMLElement>('.chat-scroller');
    const box = f(k);
    if (!sc || !box) return null;
    return {
      scroller: sc.scrollTop, boxTop: box.scrollTop, boxLeft: box.scrollLeft,
      room: { down: sc.scrollHeight - sc.clientHeight - sc.scrollTop, up: sc.scrollTop },
    };
  }, [kind] as const);
}

/** Wait until the scroller's and the box's positions agree across eight consecutive reads 50 ms apart. */
async function settle(page: Page, kind: Kind): Promise<Reading> {
  let same = 0;
  let last = '';
  let r: Reading | null = null;
  for (let i = 0; i < 160 && same < 8; i += 1) {
    r = await reading(page, kind);
    const key = JSON.stringify(r === null ? null : [r.scroller, r.boxTop, r.boxLeft]);
    same = key === last && r !== null ? same + 1 : 0;
    last = key;
    await page.waitForTimeout(50);
  }
  if (r === null || same < 8) throw new Error(`the ${kind} target did not settle (harness failure, not a wheel result)`);
  return r;
}

/** Bring the target to the middle of the scroller. Virtuoso re-measures rows as they mount, so one jump can land
 *  elsewhere: repeat until the target's centre sits within 8 px of the scroller's centre on three reads in a row,
 *  searching upward from the bottom while the row is not mounted. */
async function reveal(page: Page, kind: Kind): Promise<void> {
  let centred = 0;
  for (let i = 0; i < 120 && centred < 3; i += 1) {
    const r = await page.evaluate(([k]) => {
      const f = (window as unknown as { __c5: { find: (kind: string) => HTMLElement | null } }).__c5.find;
      const sc = document.querySelector<HTMLElement>('.chat-scroller')!;
      const box = f(k);
      if (!box) {
        sc.scrollTop = Math.max(0, sc.scrollTop - 500);
        return { state: sc.scrollTop === 0 ? 'absent' : 'searching', off: 0 };
      }
      const b = box.getBoundingClientRect();
      const s = sc.getBoundingClientRect();
      const off = b.top + b.height / 2 - (s.top + s.height / 2);
      if (Math.abs(off) >= 8) sc.scrollTop += off;
      return { state: 'found', off };
    }, [kind] as const);
    await page.waitForTimeout(150);
    if (r.state === 'absent') break;
    centred = r.state === 'found' && Math.abs(r.off) < 8 ? centred + 1 : 0;
  }
  if (centred < 3) throw new Error(`the ${kind} target could not be centred in the transcript (harness failure)`);
}

/** Open the Bash card: Refined first opens the run's group, then the card's own row (Instrument draws it directly). */
async function openCard(page: Page): Promise<void> {
  const group = page.locator('.ref-tool-group-row');
  for (let i = 0; i < 60 && (await page.locator('.toolcard .tool-row').count()) === 0; i += 1) {
    if ((await group.count()) > 0) {
      await group.first().scrollIntoViewIfNeeded();
      if ((await group.first().getAttribute('aria-expanded')) !== 'true') await group.first().click();
    } else {
      await page.evaluate(() => { const sc = document.querySelector<HTMLElement>('.chat-scroller')!; sc.scrollTop = Math.max(0, sc.scrollTop - 400); });
    }
    await page.waitForTimeout(150);
  }
  const row = page.locator('.toolcard', { has: page.locator('.tool-name', { hasText: 'Bash' }) }).locator('.tool-row').first();
  await row.scrollIntoViewIfNeeded();
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
  await page.waitForTimeout(500);   // the body opens over 0.24 s
}

interface Moved { before: Reading; after: Reading; scroller: number; boxTop: number; boxLeft: number }

/** Put the pointer over the target's centre, prove it is there, wheel once, and read the settled before and after. */
async function wheelOver(page: Page, kind: Kind, dx: number, dy: number): Promise<Moved> {
  const before = await settle(page, kind);
  const box = await page.evaluate(([k]) => {
    const f = (window as unknown as { __c5: { find: (kind: string) => HTMLElement | null } }).__c5.find;
    const el = f(k)!;
    const b = el.getBoundingClientRect();
    const x = b.left + b.width / 2;
    const y = b.top + b.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, over: hit !== null && el.contains(hit), hit: hit?.className?.toString() ?? String(hit) };
  }, [kind] as const);
  expect(box.over, `the pointer at (${Math.round(box.x)}, ${Math.round(box.y)}) is over the ${kind} target, not ${box.hit}`).toBe(true);
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(700);   // Chrome latches a wheel sequence to one scroller until it pauses
  await page.mouse.wheel(dx, dy);
  const after = await settle(page, kind);
  return {
    before, after, scroller: after.scroller - before.scroller, boxTop: after.boxTop - before.boxTop,
    boxLeft: after.boxLeft - before.boxLeft,
  };
}

/** The wheel's direction: down when the transcript has room below the target, up otherwise. */
function direction(r: Reading): number {
  expect(Math.max(r.room.down, r.room.up), 'the transcript has room to move in some direction').toBeGreaterThan(400);
  return r.room.down > 400 ? 300 : -300;
}

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

/** One view of one case: the page is opened on the fixture, the target revealed (the card opened first for the well). */
async function inView(view: AppView, kind: Kind, body: (page: Page) => Promise<void>): Promise<void> {
  const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
  try {
    await ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
      ws.send(JSON.stringify({
        type: 'backlog', uuid: 'u-1', events: EVENTS, offset: 1, file: '/w/t.jsonl', missing: false,
        searchComplete: true, fileMeasured: true,
      }));
    });
    await page.addInitScript(installFinder);
    await page.goto(`${server!.origin}/s/${SESSION.id}`);
    await page.waitForSelector('.chat-item', { timeout: 20_000 });
    await page.waitForTimeout(500);
    if (kind === 'well') await openCard(page);
    await reveal(page, kind);
    await body(page);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
}

describe('a wheel over a code block whose content fits moves .chat-scroller', () => {
  for (const view of VIEWS) {
    it(named(view), () => inView(view, 'fit', async (page) => {
      const fit = await settle(page, 'fit');
      const dims = await page.evaluate(() => {
        const el = (window as unknown as { __c5: { find: (kind: string) => HTMLElement } }).__c5.find('fit');
        return { sh: el.scrollHeight, ch: el.clientHeight };
      });
      expect(dims.sh, 'the three-line block fits').toBeLessThanOrEqual(dims.ch);
      const dy = direction(fit);
      const m = await wheelOver(page, 'fit', 0, dy);
      expect(Math.abs(m.boxTop), 'the block has nothing to scroll').toBeLessThan(2);
      expect(Math.abs(m.scroller), `the transcript moved by ${m.scroller}px (wanted more than 50)`).toBeGreaterThan(50);
      expect(Math.sign(m.scroller), 'in the wheel direction').toBe(Math.sign(dy));
    }), 120_000);
  }
});

describe('a wheel over a tool card\'s well whose content fits moves .chat-scroller', () => {
  for (const view of VIEWS) {
    it(named(view), () => inView(view, 'well', async (page) => {
      const well = await settle(page, 'well');
      const dims = await page.evaluate(() => {
        const el = (window as unknown as { __c5: { find: (kind: string) => HTMLElement } }).__c5.find('well');
        return { sh: el.scrollHeight, ch: el.clientHeight };
      });
      expect(dims.sh, 'the two-line result well fits').toBeLessThanOrEqual(dims.ch);
      const dy = direction(well);
      const m = await wheelOver(page, 'well', 0, dy);
      expect(Math.abs(m.boxTop), 'the well has nothing to scroll').toBeLessThan(2);
      expect(Math.abs(m.scroller), `the transcript moved by ${m.scroller}px (wanted more than 50)`).toBeGreaterThan(50);
      expect(Math.sign(m.scroller), 'in the wheel direction').toBe(Math.sign(dy));
    }), 120_000);
  }
});

describe('a wheel over a code block taller than --well-max scrolls the block first, then the transcript', () => {
  for (const view of VIEWS) {
    it(named(view), () => inView(view, 'tall', async (page) => {
      const start = await settle(page, 'tall');
      const dims = await page.evaluate(() => {
        const el = (window as unknown as { __c5: { find: (kind: string) => HTMLElement } }).__c5.find('tall');
        return { sh: el.scrollHeight, ch: el.clientHeight };
      });
      expect(dims.sh, 'the sixty-line block is taller than its cap').toBeGreaterThan(dims.ch + 300);
      expect(start.boxTop, 'the block starts at its top').toBe(0);
      expect(start.room.down, 'the transcript has room below the block').toBeGreaterThan(400);

      // First half: the block has room, so it takes the wheel and the transcript stays.
      const first = await wheelOver(page, 'tall', 0, 300);
      expect(first.boxTop, `the block moved by ${first.boxTop}px (wanted more than 50)`).toBeGreaterThan(50);
      expect(Math.abs(first.scroller), `the transcript moved by ${first.scroller}px while the block had room`).toBeLessThan(2);

      // Second half: the block at its end, the same wheel reaches the transcript and the block stays at its end.
      await page.evaluate(() => {
        const el = (window as unknown as { __c5: { find: (kind: string) => HTMLElement } }).__c5.find('tall');
        el.scrollTop = el.scrollHeight;
      });
      const atEnd = await settle(page, 'tall');
      expect(atEnd.room.down, 'the transcript still has room below the block').toBeGreaterThan(400);
      const second = await wheelOver(page, 'tall', 0, 300);
      expect(Math.abs(second.boxTop), 'the block stays at its end').toBeLessThan(2);
      expect(second.scroller, `the transcript moved by ${second.scroller}px (wanted more than 50)`).toBeGreaterThan(50);
    }), 120_000);
  }
});

describe('a sideways wheel over a code block that overflows moves the block\'s scrollLeft and not the scroller\'s scrollTop', () => {
  for (const view of VIEWS) {
    it(named(view), () => inView(view, 'wide', async (page) => {
      await settle(page, 'wide');
      const dims = await page.evaluate(() => {
        const el = (window as unknown as { __c5: { find: (kind: string) => HTMLElement } }).__c5.find('wide');
        return { sw: el.scrollWidth, cw: el.clientWidth, left: el.scrollLeft };
      });
      expect(dims.sw, 'the 300-character line overflows sideways').toBeGreaterThan(dims.cw + 300);
      expect(dims.left, 'the block starts at its left edge').toBe(0);
      const m = await wheelOver(page, 'wide', 300, 0);
      expect(m.boxLeft, `the block moved sideways by ${m.boxLeft}px (wanted more than 50)`).toBeGreaterThan(50);
      expect(Math.abs(m.scroller), `the transcript moved by ${m.scroller}px on a sideways wheel`).toBeLessThan(2);
    }), 120_000);
  }
});

describe('control: a wheel over prose moves .chat-scroller', () => {
  for (const view of VIEWS) {
    it(named(view), () => inView(view, 'prose', async (page) => {
      const prose = await settle(page, 'prose');
      const dy = direction(prose);
      const m = await wheelOver(page, 'prose', 0, dy);
      expect(Math.abs(m.scroller), `the transcript moved by ${m.scroller}px (wanted more than 50)`).toBeGreaterThan(50);
      expect(Math.sign(m.scroller), 'in the wheel direction').toBe(Math.sign(dy));
    }), 120_000);
  }
});
