// The item page read top to bottom (desktop-polish wave 186), measured in a real Chrome over the production build, in both
// skins. The operator, at a desk about 2000 px wide, had the list pane, the item and a third column of acts side by side, and
// a came-back item's reason as the page's last line. This file holds the answer: at 1280, 1440 and 2000 the item is ONE
// column (the band, the title, why it came back, why, how, the history, then "Your move" last), capped at the transcript's
// own prose measure (`--measure-chat-prose`); a history longer than four acts folds its earlier ones; the How list draws its
// numbers; a fenced command is a copy block whose Copy, pressed from the keyboard, puts exactly the block's text on the
// clipboard; a huge fence scrolls inside its own box and the page never scrolls sideways; an image in the text is a link and
// nothing is fetched for it; hostile text runs nothing. At 390 the phone keeps the same order with no sideways scroll.
// Every fixture is invented.
//
//   CCRC_CHROME=$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/item-reading.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
import { withRunBinding } from '../test/runBindingFixture';

const NOW = Date.now();
const MIN = 60_000;
/** The command the do item's step asks the operator to run: quotes, a pipe and two lines. */
const COMMAND = 'ccrc doctor --json | grep -c "fail"\nccrc version';
const HUGE = `echo ${'x'.repeat(1800)}`;
const IMAGE_HOST = 'images.example.test';

const session = (id: string, role: string): object => ({
  id, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: `/w/project-a/${id}`,
  workspace: id, name: id, status: 'busy', statusUpdatedAt: NOW - MIN, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: `ws/${id}`, ctxPct: 40, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'working', bucketSince: NOW - 6 * MIN, unmeasured: [],
  started: true, child: { kind: 'none' }, role,
});
const RUNS = [{
  id: 100, program: 'prog-a', programTitle: 'Programme A', wave: 2, waveOf: 5, project: 'project-a', homeProject: 'project-a',
  sessionId: 'prog-a-w1', workspace: 'prog-a-w1', branch: 'ws/prog-a-w1', state: 'working', kind: 'work', reviews: null,
  claimedBy: 'prog-a-coord', resumed: false, clearedAt: null, openedAt: NOW - 3_600_000, dispatchStartedAt: null,
  dispatchedAt: NOW - 3_000_000, closedAt: null, handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false,
}];
const SESSIONS = [session('prog-a-coord', 'coordinator'), session('prog-a-w1', 'child')];

const base = (id: number, over: object): object => ({
  id, program: 'prog-a', runId: null, kind: 'do', title: 'Update the test box and report what `ccrc doctor` says',
  why: `The test box has not reported for two days, so its status card reads **stale**. See the chart: ![status chart](https://${IMAGE_HOST}/chart.png). Hostile words stay words: <script>window.__ran = 1</script> and [a script link](javascript:window.__ran=2).`,
  how: ['Open a shell on the test box.', `Run the check and paste its output into the note:\n\n\`\`\`bash\n${COMMAND}\n\`\`\``, `If it is long, this one line shows it:\n\n\`\`\`\n${HUGE}\n\`\`\``],
  options: null, recommended: null, recommendedWhy: null, neededBy: 'blocking', soonLabel: null, state: 'open', stale: false,
  raisedAt: NOW - 3 * 60 * MIN, tickedAt: null, closedAt: null, answer: null, note: null, secretSlot: null, secretSet: null,
  history: [{ at: NOW - 3 * 60 * MIN, act: 'raise', note: null }, { at: NOW - 2 * 60 * MIN, act: 'tick', note: null },
    { at: NOW - 100 * MIN, act: 'return', note: 'The doctor lines were missing from the note.' },
    { at: NOW - 90 * MIN, act: 'tick', note: null },
    { at: NOW - 60 * MIN, act: 'return', note: 'The update ran on the wrong box: the stamp still reads the **old** build.' }],
  ...over,
});
const ITEMS = [
  base(1, {}),
  base(2, { kind: 'decide', title: 'Choose how the sync step treats a box that is *behind*', how: ['Read the options below.'],
    options: ['Wait for the box to update', 'Skip the box and mark the run `partial`', 'Stop the run'], recommended: 0,
    recommendedWhy: 'Waiting costs a day at most; a `partial` run has to be redone anyway.', history: [{ at: NOW - 30 * MIN, act: 'raise', note: null }] }),
  // Fix round 1, F2: options that name an address, a console path and an item. They are words: a tap picks the option.
  base(3, { kind: 'decide', title: 'Pick where the report goes', how: [],
    options: ['See https://example.com/report', 'Open [the runs](/runs)', 'Close item 1 now'], recommended: null, recommendedWhy: null,
    history: [{ at: NOW - 30 * MIN, act: 'raise', note: null }] }),
  // Fix round 2, F1: a worded outside link, its host after it.
  base(4, { title: 'Read the runbook before the update', how: [],
    why: 'The steps are in [the runbook for the test box update](https://runbooks.example.com/test-box/update) and nowhere else.',
    history: [{ at: NOW - 30 * MIN, act: 'raise', note: null }] }),
];
const WAITING = { items: ITEMS, cleared: [], goals: [] };
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/runs': RUNS, '/api/claims': [], '/api/waiting': { ok: true, waiting: WAITING },
  },
  fleetFrames: [
    { type: 'fleet', sessions: withRunBinding(SESSIONS as never[], RUNS as never[]) }, { type: 'runs', runs: RUNS },
    { type: 'waiting', waiting: WAITING },
  ],
};

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

async function open(skin: string, width: number, id: number) {
  const opened = await openApp(browser!, { skin, theme: 'light', width }, FIXTURE);
  const requested: string[] = [];
  opened.page.on('request', (r) => { requested.push(r.url()); });
  await opened.page.goto(`${server!.origin}/waiting/${id}`);
  await opened.page.waitForSelector('.wi-detail', { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(250);
  const shots = process.env['CCRC_SHOTS'];
  if (shots !== undefined && shots !== '') {
    await opened.page.screenshot({ path: `${shots}/${skin}-${width}-${id === 1 ? 'do' : 'decide'}.png`, fullPage: width !== 390 });
  }
  return { ...opened, requested };
}

/** The device's saved copy, drawn on a cold start with no live list (as `waiting.browser.test.ts` seeds it). */
const SAVED_FIXTURE: AppFixture = {
  api: { ...FIXTURE.api, '/api/waiting': {} },
  fleetFrames: FIXTURE.fleetFrames.filter((f) => (f as { type?: string }).type !== 'waiting'),
};
async function openSaved(skin: string, width: number, id: number) {
  const opened = await openApp(browser!, { skin, theme: 'light', width }, SAVED_FIXTURE);
  await opened.ctx.addInitScript((copy) => {
    try { localStorage.setItem('ccrc.waiting-snapshot.v1', copy); } catch { /* no storage: no saved copy, and the case says so */ }
  }, JSON.stringify({ savedAt: NOW - 4 * MIN, view: WAITING }));
  await opened.page.goto(`${server!.origin}/waiting/${id}`);
  await opened.page.waitForSelector('.wi-detail', { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(250);
  return opened;
}

const sideways = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const paneSideways = (page: Page): Promise<number> => page.evaluate(() => {
  const pane = document.querySelector('.shell-detail');
  return pane === null ? 0 : pane.scrollWidth - pane.clientWidth;
});

/** The page's reading order and its column, measured. */
const layout = (page: Page) => page.evaluate(() => {
  const top = (s: string): number => document.querySelector(s)?.getBoundingClientRect().top ?? NaN;
  const bottom = (s: string): number => document.querySelector(s)?.getBoundingClientRect().bottom ?? NaN;
  const detail = document.querySelector('.wi-detail')!;
  const sections = [...document.querySelectorAll('.wi-detail .wi-card > section')];
  const headed = (word: string): Element | undefined => sections.find((s) => s.querySelector('.wi-h')?.textContent === word);
  // The transcript's prose cap in px, resolved in the item text's own font as `.msg-assist` resolves it.
  const probe = document.createElement('div');
  probe.className = 'msg-assist';
  probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--measure-chat-prose)';
  document.querySelector('.wi')!.appendChild(probe);
  const cap = probe.getBoundingClientRect().width;
  probe.remove();
  return {
    columns: getComputedStyle(detail).gridTemplateColumns.split(' ').length,
    detailWidth: detail.getBoundingClientRect().width,
    cap,
    what: bottom('.wi-what'),
    back: top('.wi-came-back'),
    why: headed('Why')?.getBoundingClientRect().top ?? NaN,
    how: headed('How')?.getBoundingClientRect().top ?? NaN,
    historyBottom: headed('History')?.getBoundingClientRect().bottom ?? NaN,
    move: top('.wi-act'),
  };
});

describe.each([REFINED, INSTRUMENT] as const)('the item page reads top to bottom, in %s', (skin) => {
  for (const width of [1280, 1440, 2000] as const) {
    it(`at ${width}: one detail column at the transcript's measure; "Your move" after the history; why it came back under the title`, async () => {
      const { ctx, page, errors } = await open(skin, width, 1);
      try {
        const l = await layout(page);
        expect(l.columns, JSON.stringify(l)).toBe(1);
        expect(l.detailWidth, JSON.stringify(l)).toBeLessThanOrEqual(Math.ceil(l.cap) + 1);
        expect(l.back, JSON.stringify(l)).toBeGreaterThanOrEqual(l.what);
        expect(l.why, JSON.stringify(l)).toBeGreaterThan(l.back);
        expect(l.how, JSON.stringify(l)).toBeGreaterThan(l.why);
        expect(l.move, JSON.stringify(l)).toBeGreaterThanOrEqual(l.historyBottom);
        expect(await page.locator('.wi-came-back').innerText()).toContain('the stamp still reads the old build');
        expect(await sideways(page), 'sideways scroll').toBe(0);
        expect(await paneSideways(page), 'the detail pane\'s sideways overflow').toBeLessThanOrEqual(0);
        expect(errors).toEqual([]);
      } finally { await ctx.close(); }
    });

    it(`at ${width}: a decision's options and their recommendation stay in "Your move", after the history`, async () => {
      const { ctx, page, errors } = await open(skin, width, 2);
      try {
        const l = await layout(page);
        expect(l.columns).toBe(1);
        const inMove = await page.evaluate(() => {
          const move = document.querySelector('.wi-act')!;
          return { radios: move.querySelectorAll('input[type="radio"]').length, why: move.querySelector('.wi-why-rec') !== null };
        });
        expect(inMove).toEqual({ radios: 4, why: true });
        expect(l.move).toBeGreaterThanOrEqual(l.historyBottom);
        expect(await sideways(page)).toBe(0);
        expect(errors).toEqual([]);
      } finally { await ctx.close(); }
    });
  }

  it('the How list draws its step numbers', async () => {
    const { ctx, page } = await open(skin, 1440, 1);
    try {
      const markers = await page.evaluate(() => [...document.querySelectorAll('.wi-steps > li')].map((li) => getComputedStyle(li).listStyleType));
      expect(markers).toEqual(['decimal', 'decimal', 'decimal']);
    } finally { await ctx.close(); }
  });

  it('a history of five acts folds the two earlier ones, and the newest three stay open', async () => {
    const { ctx, page } = await open(skin, 1440, 1);
    try {
      const fold = await page.evaluate(() => ({
        summary: document.querySelector('.wi-earlier > summary')?.textContent,
        open: (document.querySelector('.wi-earlier') as HTMLDetailsElement | null)?.open,
        shown: document.querySelectorAll('ul.wi-history[aria-label="History"] > li').length,
      }));
      expect(fold).toEqual({ summary: '2 earlier', open: false, shown: 3 });
    } finally { await ctx.close(); }
  });

  it('a fenced command is a copy block: Copy, from the keyboard, puts exactly its text on the clipboard', async () => {
    const { ctx, page } = await open(skin, 1440, 1);
    try {
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server!.origin });
      const button = page.locator('.wi-steps .code-block').first().locator('button.code-block-copy');
      await button.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => button.innerText()).toMatch(/copied/i);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(COMMAND);
    } finally { await ctx.close(); }
  });

  it('a huge fence scrolls inside its own box; the page never scrolls sideways', async () => {
    const { ctx, page } = await open(skin, 1280, 1);
    try {
      const pre = await page.evaluate(() => {
        const p = [...document.querySelectorAll('.wi-steps .code-block pre')].at(-1)!;
        const card = document.querySelector('.wi-detail > .wi-card')!.getBoundingClientRect();
        return { scrolls: p.scrollWidth > p.clientWidth, past: p.getBoundingClientRect().right - card.right };
      });
      expect(pre.scrolls).toBe(true);
      expect(pre.past).toBeLessThanOrEqual(0);
      expect(await sideways(page)).toBe(0);
      expect(await paneSideways(page)).toBeLessThanOrEqual(0);
    } finally { await ctx.close(); }
  });

  it('an image in the text is a link: no <img>, and no request leaves for it; hostile text runs nothing', async () => {
    const { ctx, page, requested } = await open(skin, 1440, 1);
    try {
      const drawn = await page.evaluate(() => ({
        imgs: document.querySelectorAll('.wi img').length,
        link: document.querySelector(`.wi a[href^="https://images.example.test/"]`)?.textContent ?? null,
        scripts: document.querySelectorAll('.wi script').length,
        ran: (window as unknown as { __ran?: number }).__ran ?? null,
        scriptLinks: [...document.querySelectorAll('.wi a')].filter((a) => (a.getAttribute('href') ?? '').startsWith('javascript')).length,
      }));
      expect(drawn).toEqual({ imgs: 0, link: 'status chart', scripts: 0, ran: null, scriptLinks: 0 });
      expect(requested.filter((u) => u.includes(IMAGE_HOST))).toEqual([]);
    } finally { await ctx.close(); }
  });

  it('at 390: the same order, nothing sideways', async () => {
    for (const id of [1, 2]) {
      const { ctx, page, errors } = await open(skin, 390, id);
      try {
        const l = await layout(page);
        expect(l.columns).toBe(1);
        if (id === 1) expect(l.back).toBeGreaterThanOrEqual(l.what);
        expect(l.move).toBeGreaterThanOrEqual(l.historyBottom);
        expect(await sideways(page)).toBe(0);
        expect(errors).toEqual([]);
      } finally { await ctx.close(); }
    }
  });
});

// Fix round 1 of wave 186 (review 4189). F8: on a saved copy the route's own line ("Saved on this device…") sits in the route's
// list wrapper, beside the strip and the item; #3427's one-edge rule puts all three on one left edge, and this wave's measure
// had moved the strip and the item without the wrapper. F2: an option's words hold no link, so a tap on them picks the
// option and the page stays. A7: under a coarse pointer the history's fold still says whether it is open.
describe.each([REFINED, INSTRUMENT] as const)('fix round 1, in %s', (skin) => {
  for (const width of [1280, 1440, 2000] as const) {
    it(`F8 at ${width}: on a saved copy the saved line, the strip and the item share one left edge`, async () => {
      const { ctx, page, errors } = await openSaved(skin, width, 1);
      try {
        const edges = await page.evaluate(() => {
          const left = (s: string): number => document.querySelector(s)?.getBoundingClientRect().left ?? NaN;
          const nav = document.querySelector('.wi-nav');
          const navStart = nav === null ? NaN : nav.getBoundingClientRect().left + parseFloat(getComputedStyle(nav).paddingLeft);
          return { saved: left('.wl-route > .wl .wl-note[data-current="false"]'), strip: navStart, card: left('.wi-detail > .wi-card') };
        });
        expect(Number.isNaN(edges.saved), JSON.stringify(edges)).toBe(false);
        expect(Math.abs(edges.saved - edges.card), JSON.stringify(edges)).toBeLessThanOrEqual(1);
        expect(Math.abs(edges.strip - edges.card), JSON.stringify(edges)).toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
      } finally { await ctx.close(); }
    });
  }

  it('F2: an option that names an address, a path or an item is words; a tap on them picks it and the page stays', async () => {
    const { ctx, page, errors } = await open(skin, 1440, 3);
    try {
      expect(await page.locator('.wi-act fieldset a').count()).toBe(0);
      // Each tap lands on the words a link would have held: the address, the path's words, the item reference.
      for (const [words, tap] of [['See https://example.com/report', 'https://example.com/report'], ['Open the runs', 'the runs'], ['Close item 1 now', 'item 1']] as const) {
        await page.locator('.wi-act fieldset label', { hasText: words }).first().getByText(tap, { exact: false }).first().click();
        expect(new URL(page.url()).pathname, words).toBe('/waiting/3');
        expect(await page.getByRole('radio', { name: words }).isChecked(), words).toBe(true);
      }
      expect(errors).toEqual([]);
    } finally { await ctx.close(); }
  });

  it('A7: under a coarse pointer the fold says it is closed, then open', async () => {
    const { ctx, page } = await open(skin, 390, 1);
    try {
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'the coarse pointer is emulated').toBe(true);
      const cue = (): Promise<string> => page.evaluate(() => getComputedStyle(document.querySelector('.wi-earlier > summary')!, '::before').content);
      expect(await cue()).toBe('"\u25B8"');
      await page.locator('.wi-earlier > summary').click();
      expect(await page.evaluate(() => (document.querySelector('.wi-earlier') as HTMLDetailsElement).open)).toBe(true);
      expect(await cue()).toBe('"\u25BE"');
    } finally { await ctx.close(); }
  });
});

// Fix round 2 of wave 186 (review 4219), F1: a worded outside link draws its host after it, outside the anchor. At 390 the host
// sits on one line, nothing scrolls sideways, and the link's accessible name is its words alone.
describe.each([REFINED, INSTRUMENT] as const)('fix round 2, in %s', (skin) => {
  it('F1 at 390: the host follows the link, unsplit, outside its name; no sideways scroll', async () => {
    const { ctx, page, errors } = await open(skin, 390, 4);
    try {
      const host = await page.evaluate(() => {
        const el = document.querySelector('.wi-card .wi-text a[target="_blank"] + .wi-link-host');
        if (el === null) return null;
        const rects = [...el.getClientRects()].filter((r) => r.width > 0);
        return { text: el.textContent, lines: new Set(rects.map((r) => Math.round(r.top))).size, inLink: el.closest('a') !== null,
          right: Math.max(...rects.map((r) => r.right)), vw: document.documentElement.clientWidth };
      });
      expect(host, 'the host is drawn after the link').not.toBeNull();
      expect(host!.text).toBe(' (runbooks.example.com)');
      expect(host!.lines, JSON.stringify(host)).toBe(1);
      expect(host!.inLink).toBe(false);
      expect(host!.right, JSON.stringify(host)).toBeLessThanOrEqual(host!.vw);
      expect(await page.getByRole('link', { name: 'the runbook for the test box update', exact: true }).count()).toBe(1);
      expect(await sideways(page), 'sideways scroll').toBe(0);
      expect(errors).toEqual([]);
    } finally { await ctx.close(); }
  });
});
