// One project's landing line on its card, its pause control and its withdraw sheet (landing order wave 5k, Task 8), in a real
// Chrome over the production build: 360, 390, 1280, 1470 and 1920 wide, both skins (Instrument in its project mode, where
// it draws the same project cards), light and dark. jsdom lays nothing out and runs no real focus, so what is measured
// here is what the component cases cannot hold: the block's fit at phone width, the tap floor, where focus lands, and the
// doors' bodies as the page sends them.
//
// Each case registers its own `**/api/landing**` route (F4: the shared fixture in `app.ts` is not extended), which answers
// `project-a` with section 5's five entries, `project-b` with an empty line and `project-c` with one entry or a pause, and
// records each POST body. A route registered after `openApp`'s own takes precedence over it.
//
// Desktop polish wave 192: every block starts rolled up. The four families that read the open block tap its disclosure
// once first (`unroll`); the fifth reads the rolled-up block: its summary's fit, Enter and Space, the choice kept across
// a re-read and Instrument's view switch, and a reload that rolls every block up again.
//
//   CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/landing-line.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer, type OpenedApp } from './app';
import { expectStampedTheme } from './stampedTheme';
import { GROUP_MODE_KEY } from '../src/skins/instrument/FleetTable';

const NOW = Date.now();
const MIN = 60_000;
const PROJECTS = ['project-a', 'project-b', 'project-c'] as const;
type Project = (typeof PROJECTS)[number];

const session = (id: string, project: string): object => ({
  id, wrapper: 'lane-a', home: 'lane-a', project, workdir: `/w/${project}/${id}`,
  workspace: id, name: id, status: 'busy', statusUpdatedAt: NOW - MIN, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: `ws/${id}`, ctxPct: 40, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'working', bucketSince: NOW - MIN, unmeasured: [],
  started: true, child: { kind: 'none' },
});
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/projects': { roots: ['/w'], projects: PROJECTS.map((name) => ({ name, workdir: `/w/${name}` })) },
    '/api/runs': { runs: [], nextBefore: null }, '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: PROJECTS.map((p) => session(`lane-a-${p}`, p)) }, { type: 'runs', runs: [] }],
};

// Section 5's first sketch; entry ids are the PR plus 900.
type Entry = Record<string, unknown> & { id: number; pr: number; pinnedAt: number; afterIds: number[] };
const entry = (project: string, pr: number, over: Record<string, unknown> = {}): Entry => ({
  id: pr + 900, project, pr, pinnedSha: 'a'.repeat(40), handoffCommit: 'c'.repeat(40), runId: pr, state: 'pinned', baseSha: null,
  ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false, setBy: 'lane-a', pinnedAt: 1000 + pr, ...over } as Entry);
const FIVE = (): Entry[] => [
  entry('project-a', 101, { fixesMain: true }),
  entry('project-a', 102, { state: 'ejected', ejectionKind: 'new-head', ejections: 1 }),
  entry('project-a', 104, { afterIds: [1001] }),
  entry('project-a', 107, { afterIds: [1003, 1004] }),
  entry('project-a', 109, { state: 'unknown' }),
];
const line = (project: string, entries: Entry[], paused = false): object => {
  const pinned = entries.filter((e) => e['state'] === 'pinned');
  const waits = entries.some((e) => e.pr === 107) ? [{ entryId: 1007, reason: 'withdrawn', on: [{ entryId: 1003, pr: 103 }] }] : undefined;
  return {
    ok: true, project, operatorPaused: paused, mainRedHold: false, entries, entriesScope: 'open',
    order: paused ? { paused: true, by: ['operator'], order: pinned, ...(waits ? { waits } : {}) }
      : { paused: false, order: pinned, head: pinned[0] ?? null, ...(waits ? { waits } : {}) },
  };
};

/** The landing route of one case: per-project answers the case may change, and every POST body, in order. */
interface Line {
  answers: Record<Project, () => object>;
  posts: { path: string; body: Record<string, unknown> }[];
  /** The answer to the next POST; default 200 with a body built from the request. */
  next: ((path: string, body: Record<string, unknown>) => { status: number; body: object }) | null;
}
async function routeLine(ctx: BrowserContext, c: Line): Promise<void> {
  await ctx.route('**/api/landing**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'GET') {
      const p = url.searchParams.get('project') as Project;
      const answer = c.answers[p];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer === undefined ? { ok: true, project: p, operatorPaused: false, mainRedHold: false, entries: [], order: { paused: false, order: [], head: null } } : answer()) });
      return;
    }
    const body = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
    c.posts.push({ path: url.pathname, body });
    const made = c.next?.(url.pathname, body) ?? { status: 200, body: { ok: true } };
    c.next = null;
    await route.fulfill({ status: made.status, contentType: 'application/json', body: JSON.stringify(made.body) });
  });
}

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

async function open(skin: string, theme: string, width: number, c: Line): Promise<OpenedApp> {
  const opened = await openApp(browser!, { skin, theme, width }, FIXTURE);
  await opened.ctx.addInitScript(([key]) => {
    try { localStorage.setItem(key, 'project'); } catch { /* the default mode is then measured, and the line is absent */ }
  }, [GROUP_MODE_KEY] as const);
  await routeLine(opened.ctx, c);
  await opened.page.goto(server!.origin + '/fleet');
  await expectStampedTheme(opened.page, theme);
  await opened.page.waitForSelector('section.landing-line', { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  return opened;
}
const regionOf = (page: Page, project: string): Locator => page.locator(`section.landing-line[aria-label="Landing line of ${project}"] >> visible=true`).first();
const button = (scope: Page | Locator, name: string): Locator => scope.getByRole('button', { name, exact: true }).first();
/** Desktop polish wave 192: the block's disclosure, the title. The block starts rolled up. */
const toggleOf = (page: Page, project: string): Locator => button(regionOf(page, project), 'Landing line');
/** The one added tap of each case below that reads the open block. */
const unroll = async (page: Page, project: string): Promise<void> => {
  await toggleOf(page, project).click();
  await expect.poll(() => toggleOf(page, project).getAttribute('aria-expanded')).toBe('true');
};
const focusedName = (page: Page): Promise<string> => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  return el === null ? '' : (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();
});
/** Every control of the block at the tap floor, the block not wider than its card, its focus rings inside the window. */
const measureBlock = (page: Page, project: string) => page.evaluate((p) => {
  const block = [...document.querySelectorAll<HTMLElement>(`section.landing-line[aria-label="Landing line of ${p}"]`)].find((el) => el.offsetParent !== null)!;
  const card = block.closest<HTMLElement>('section.proj-card')!;
  return {
    vw: innerWidth,
    buttons: [...block.querySelectorAll<HTMLElement>('button')].map((b) => { const r = b.getBoundingClientRect(); return { name: b.getAttribute('aria-label') ?? '', h: r.height, left: r.left, right: r.right }; }),
    blockOverflow: block.scrollWidth - block.clientWidth,
    cardOverflow: card.scrollWidth - card.clientWidth,
    pageX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}, project);
/** Wave 192: the rolled-up block's fit. Its buttons (the disclosure alone), and its summary: inside the card, not running
 *  sideways, and how many lines it wraps to. */
const measureRolled = (page: Page, project: string) => page.evaluate((p) => {
  const block = [...document.querySelectorAll<HTMLElement>(`section.landing-line[aria-label="Landing line of ${p}"]`)].find((el) => el.offsetParent !== null)!;
  const card = block.closest<HTMLElement>('section.proj-card')!;
  const s = block.querySelector<HTMLElement>('.landing-line-summary');
  const cr = card.getBoundingClientRect();
  let summary: { left: number; right: number; overflow: number; lines: number } | null = null;
  if (s !== null) {
    const r = s.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(s);
    const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
    summary = { left: r.left, right: r.right, overflow: s.scrollWidth - s.clientWidth, lines };
  }
  return {
    vw: innerWidth,
    buttons: [...block.querySelectorAll<HTMLElement>('button')].map((b) => { const r = b.getBoundingClientRect(); return { name: (b.textContent ?? '').trim(), h: r.height, left: r.left, right: r.right }; }),
    summary, card: { left: cr.left, right: cr.right },
    blockOverflow: block.scrollWidth - block.clientWidth,
    cardOverflow: card.scrollWidth - card.clientWidth,
    pageX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}, project);
const summaryOf = (page: Page, project: string): Promise<string | null> => regionOf(page, project).locator('.landing-line-summary').textContent();
interface AxNode { nodeId: string; ignored: boolean; role?: { value: string }; name?: { value: string }; childIds?: string[] }
/** Wave 192 (D-9153): what Chrome's own accessibility tree holds under the block's region, read over CDP, because the open
 *  body is drawn with `display: contents`, a box under which some engines have dropped roles. Chromium only: this file
 *  drives no other engine, so a WebKit or Gecko tree is not measured here. Ignored nodes are walked through, not kept. */
async function axUnder(page: Page, project: string): Promise<{ role: string; name: string }[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as unknown as { nodes: AxNode[] };
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const roots = nodes.filter((n) => !n.ignored && n.role?.value === 'region' && n.name?.value === `Landing line of ${project}`);
    expect(roots.length, `one region for ${project} in the accessibility tree`).toBe(1);
    const out: { role: string; name: string }[] = [];
    const walk = (ids: string[] | undefined): void => {
      for (const id of ids ?? []) {
        const n = byId.get(id);
        if (n === undefined) continue;
        if (!n.ignored) out.push({ role: n.role?.value ?? '', name: n.name?.value ?? '' });
        walk(n.childIds);
      }
    };
    walk(roots[0]!.childIds);
    return out;
  } finally {
    await cdp.detach();
  }
}
/** Thirteen invented entries for project-b, all pinned. */
const THIRTEEN = (): Entry[] => Array.from({ length: 13 }, (_, i) => entry('project-b', 201 + i));
const fiveLine = (): Line => ({
  answers: { 'project-a': () => line('project-a', FIVE()), 'project-b': () => line('project-b', []), 'project-c': () => line('project-c', []) },
  posts: [], next: null,
});
const NOTICE = { word: 'landing-withdrawn', entryId: 1004, kind: 'queued', toId: 'lane-a-project-a', mailId: 1, deliveryId: 2 };

/** Wave 192 fix round 1 (F2): the disclosure's computed ground, the block's, and the two tokens BareRow's press ground
 *  reads, each resolved by the page itself to the colour it paints. */
const groundsOf = (page: Page, project: string) => page.evaluate((p) => {
  const block = [...document.querySelectorAll<HTMLElement>(`section.landing-line[aria-label="Landing line of ${p}"]`)].find((el) => el.offsetParent !== null)!;
  const title = block.querySelector<HTMLElement>(':scope > .landing-line-title')!;
  const resolve = (token: string): string => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = `var(${token})`;
    block.appendChild(probe);
    const v = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return v;
  };
  // Any colour syntax the page computes (`color-mix()` resolves to `color(srgb …)`), as 8-bit sRGB through a canvas.
  const rgbaOf = (css: string): [number, number, number, number] => {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    const x = c.getContext('2d')!;
    x.clearRect(0, 0, 1, 1);
    x.fillStyle = css;
    x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
  };
  const ink = getComputedStyle(title).color;
  const titleBg = getComputedStyle(title).backgroundColor;
  const blockBg = getComputedStyle(block).backgroundColor;
  return {
    title: titleBg, block: blockBg, hover: resolve('--bg-hover'), pressed: resolve('--bg-pressed'),
    rgba: { ink: rgbaOf(ink), title: rgbaOf(titleBg), block: rgbaOf(blockBg) },
  };
}, project);
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
type Rgba = [number, number, number, number];
/** `top` painted over an opaque `under`, as the page composites it. */
const over = (top: Rgba, under: Rgba): Rgba => {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)).concat(1) as Rgba;
};
const luminance = ([r, g, b]: Rgba): number => {
  const lin = (c: number): number => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
/** WCAG's ratio of the title's ink on the ground painted under it: the title's own ground over the block's. */
const titleContrast = ({ rgba: g }: { rgba: { ink: Rgba; title: Rgba; block: Rgba } }): number => {
  const ground = over(g.title, g.block);
  const ink = over(g.ink, ground);
  const [hi, lo] = [luminance(ink), luminance(ground)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const WIDTHS = [360, 390, 1280, 1470, 1920];
for (const skin of [REFINED, INSTRUMENT]) {
  for (const theme of ['light', PHOSPHOR]) {
    describe(`the landing line, ${skin} ${theme}`, () => {
      // Fix round 1, F2: the disclosure keeps @ccrc/ui's BareRow grounds, as the card's four other disclosures do. A real
      // mouse over it and a real press, at a desk width (Tailwind's hover is gated on a pointer that hovers).
      it('the disclosure\'s grounds: the block\'s at rest, BareRow\'s hover ground under the mouse, its pressed ground while held', async () => {
        const { ctx, page, errors } = await open(skin, theme, 1280, fiveLine());
        try {
          const t = toggleOf(page, 'project-a');
          const rest = await groundsOf(page, 'project-a');
          expect(rest.hover, 'the hover token is a ground of its own').not.toBe(rest.block);
          expect(rest.pressed, 'the pressed token is a ground of its own').not.toBe(rest.block);
          expect([TRANSPARENT, rest.block], 'at rest the disclosure shows the block\'s ground').toContain(rest.title);
          // The title's ink on each ground it shows, as painted (the gate measures it on the block's ground only).
          const ratios: Record<string, number> = { rest: titleContrast(rest) };
          await t.hover();
          await expect.poll(async () => (await groundsOf(page, 'project-a')).title, { timeout: 5_000 }).toBe(rest.hover);
          ratios['hover'] = titleContrast(await groundsOf(page, 'project-a'));
          await page.mouse.down();
          await expect.poll(async () => (await groundsOf(page, 'project-a')).title, { timeout: 5_000 }).toBe(rest.pressed);
          ratios['pressed'] = titleContrast(await groundsOf(page, 'project-a'));
          console.log(`title contrast ${skin} ${theme}: ${JSON.stringify(Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, Number(v.toFixed(2))])))}`);
          for (const [state, ratio] of Object.entries(ratios)) expect(ratio, `the title's ink ${state}`).toBeGreaterThanOrEqual(4.5);
          await page.mouse.up();
          await expect.poll(() => t.getAttribute('aria-expanded')).toBe('true');
          await page.mouse.move(0, 0);
          await expect.poll(async () => (await groundsOf(page, 'project-a')).title, { timeout: 5_000 }).toBe(rest.title);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
      for (const width of WIDTHS) {
        it(`at ${width}px: the line as read, its fit, the pause round trip, Cancel's and Done's focus`, async () => {
          const c = fiveLine();
          const { ctx, page, errors } = await open(skin, theme, width, c);
          try {
            // The empty line's card draws no block.
            await expect.poll(() => page.locator('section.landing-line[aria-label="Landing line of project-b"]').count()).toBe(0);
            const a = regionOf(page, 'project-a');
            await unroll(page, 'project-a');
            expect(await a.getByRole('status').textContent()).toBe('Next to land: #101.');
            const text = (await a.textContent()) ?? '';
            for (const want of ['#101', 'next to land', 'fixes main', '#104', 'in line', '#107', 'waits on #103 (withdrawn)', '#102',
              'sent back for a fix round (its head moved)', '#109', 'set aside: its record does not read as a current pin, so it is not in the order']) {
              expect(text, want).toContain(want);
            }
            for (const pr of [101, 104, 107, 102, 109]) expect(await button(a, `Withdraw #${pr} from project-a's landing line`).count(), `#${pr}`).toBe(1);
            const m = await measureBlock(page, 'project-a');
            for (const b of m.buttons) {
              expect(b.h, `${b.name} at the tap floor`).toBeGreaterThanOrEqual(44);
              expect(b.left, `${b.name}'s ring inside the window`).toBeGreaterThanOrEqual(2);
              expect(b.right, `${b.name}'s ring inside the window`).toBeLessThanOrEqual(m.vw - 2);
            }
            expect(m.blockOverflow, 'nothing in the block runs sideways').toBeLessThanOrEqual(1);
            expect(m.cardOverflow, 'nothing in the card runs sideways').toBeLessThanOrEqual(1);
            expect(m.pageX, 'no sideways page scroll').toBeLessThanOrEqual(0);

            // Pause: one POST whose answer says paused while the re-read after it still reads running (fix round 1, F4), so
            // the label must stay `Pause line` (row M8); only a read that says paused makes it offer Resume.
            c.next = () => ({ status: 200, body: { ok: true, project: 'project-a', operatorPaused: true, changed: true, seq: 4 } });
            const reread = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().includes('project=project-a') && c.posts.length === 1);
            await button(a, 'Pause line for project-a').click();
            await reread;
            await button(a, 'Pause line for project-a').waitFor({ timeout: 10_000 });
            expect(c.posts).toEqual([{ path: '/api/landing/pause', body: { project: 'project-a', paused: true } }]);
            expect(await button(a, 'Resume line for project-a').count(), 'the answer alone flips nothing').toBe(0);
            c.answers['project-a'] = () => line('project-a', FIVE(), true);
            await expect.poll(async () => {
              await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
              return button(a, 'Resume line for project-a').count();
            }, { timeout: 15_000 }).toBe(1);
            expect(await a.getByRole('status').textContent()).toBe('Paused by you. Nothing lands.');
            c.next = () => {
              c.answers['project-a'] = () => line('project-a', FIVE());
              return { status: 200, body: { ok: true, project: 'project-a', operatorPaused: false, changed: true, seq: 5 } };
            };
            await button(a, 'Resume line for project-a').click();
            await button(a, 'Pause line for project-a').waitFor({ timeout: 10_000 });

            // Cancel on #107's sheet gives the focus back to #107's Withdraw.
            await button(a, "Withdraw #107 from project-a's landing line").click();
            const dialog107 = page.getByRole('dialog', { name: 'Withdraw #107?' });
            await dialog107.waitFor();
            expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null), 'focus moved into the sheet').toBe(true);
            await button(dialog107, 'Cancel').click();
            await dialog107.waitFor({ state: 'detached' });
            await expect.poll(() => focusedName(page)).toBe("Withdraw #107 from project-a's landing line");

            // Withdraw #104: the read's pin time is sent, the notices are listed, every later read is without #104, and Done
            // puts the focus on the pause button.
            await button(a, "Withdraw #104 from project-a's landing line").click();
            const dialog = page.getByRole('dialog', { name: 'Withdraw #104?' });
            await dialog.waitFor();
            expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null), 'focus moved into the sheet').toBe(true);
            c.next = () => {
              c.answers['project-a'] = () => line('project-a', FIVE().filter((e) => e.pr !== 104));
              return { status: 200, body: { ok: true, entry: { ...entry('project-a', 104), state: 'withdrawn' }, previous: entry('project-a', 104), changed: true, seq: 6, notices: [NOTICE] } };
            };
            await button(dialog, 'Withdraw #104').click();
            await dialog.getByText('Withdrawn: #104 is out of the line. Nothing that waited on it was freed.').waitFor();
            expect(c.posts.at(-1)).toEqual({ path: '/api/landing/withdraw', body: { project: 'project-a', pr: 104, pinnedAt: 1104 } });
            expect(await dialog.textContent()).toContain('Told lane-a-project-a, its coordinator.');
            await button(dialog, 'Done').click();
            await dialog.waitFor({ state: 'detached' });
            await expect.poll(() => button(a, "Withdraw #104 from project-a's landing line").count()).toBe(0);
            await expect.poll(() => focusedName(page)).toBe('Pause line for project-a');
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        });

        it(`at ${width}px: landing-entry-moved once, the sheet stays, re-reads, and the next confirm sends the new pin time`, async () => {
          const c = fiveLine();
          const { ctx, page, errors } = await open(skin, theme, width, c);
          try {
            const a = regionOf(page, 'project-a');
            await unroll(page, 'project-a');
            await button(a, "Withdraw #104 from project-a's landing line").click();
            const dialog = page.getByRole('dialog', { name: 'Withdraw #104?' });
            await dialog.waitFor();
            c.next = () => {
              // Re-pinned, with a new dependant #111, so the sheet's adoption of the re-read shows (fix round 1, F6).
              c.answers['project-a'] = () => line('project-a', [...FIVE().map((e) => (e.pr === 104 ? { ...e, pinnedAt: 7777 } : e)), entry('project-a', 111, { afterIds: [1004] })]);
              return { status: 409, body: { ok: false, error: 'landing-entry-moved' } };
            };
            await button(dialog, 'Withdraw #104').click();
            await dialog.getByRole('alert').getByText('The server\'s record of that entry does not match what this screen read', { exact: false }).waitFor();
            // The sheet adopts the re-read in the open, then the confirm sends its pin time.
            await dialog.getByText('these open entries wait on it directly: #107, #111.', { exact: false }).waitFor({ timeout: 10_000 });
            c.next = () => ({ status: 200, body: { ok: true, entry: { ...entry('project-a', 104), state: 'withdrawn' }, previous: entry('project-a', 104), changed: true, seq: 7, notices: [] } });
            await button(dialog, 'Withdraw #104').click();
            await dialog.getByText('Withdrawn: #104 is out of the line.', { exact: false }).waitFor();
            expect(c.posts.map((p) => p.body['pinnedAt'])).toEqual([1104, 7777]);
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        });

        it(`at ${width}px: the only entry withdrawn, the empty re-read keeps the sheet, Done leaves the card focused; terminal keeps the gone line`, async () => {
          const c = fiveLine();
          const only = entry('project-c', 301);
          c.answers['project-c'] = () => line('project-c', [only]);
          const { ctx, page, errors } = await open(skin, theme, width, c);
          try {
            const cc = regionOf(page, 'project-c');
            await unroll(page, 'project-c');
            await button(cc, "Withdraw #301 from project-c's landing line").click();
            const dialog = page.getByRole('dialog', { name: 'Withdraw #301?' });
            await dialog.waitFor();
            c.next = () => {
              c.answers['project-c'] = () => line('project-c', []);
              return { status: 200, body: { ok: true, entry: { ...only, state: 'withdrawn' }, previous: only, changed: true, seq: 8, notices: [{ ...NOTICE, entryId: 1201 }] } };
            };
            await button(dialog, 'Withdraw #301').click();
            await dialog.getByText('Withdrawn: #301 is out of the line.', { exact: false }).waitFor();
            await expect.poll(() => page.locator('section.landing-line[aria-label="Landing line of project-c"]').count()).toBe(0);
            expect(await dialog.textContent()).toContain('Told lane-a-project-a, its coordinator.');
            await button(dialog, 'Done').click();
            await dialog.waitFor({ state: 'detached' });
            await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('proj-card') === true)).toBe(true);

            // The same line answering landing-entry-terminal: the sentence and the gone line stay until the sheet is closed.
            c.answers['project-c'] = () => line('project-c', [only]);
            await expect.poll(async () => {
              await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
              return page.locator('section.landing-line[aria-label="Landing line of project-c"]').count();
            }, { timeout: 15_000 }).toBeGreaterThan(0);
            // Wave 192: the block came back on a later read still open, as the operator left it; no second tap.
            expect(await toggleOf(page, 'project-c').getAttribute('aria-expanded')).toBe('true');
            await button(regionOf(page, 'project-c'), "Withdraw #301 from project-c's landing line").click();
            const again = page.getByRole('dialog', { name: 'Withdraw #301?' });
            await again.waitFor();
            c.next = () => {
              c.answers['project-c'] = () => line('project-c', []);
              return { status: 409, body: { ok: false, error: 'landing-entry-terminal' } };
            };
            await button(again, 'Withdraw #301').click();
            await again.getByText('#301 is no longer in the line as last read, so there is nothing to withdraw.').waitFor();
            expect(await again.getByRole('alert').textContent()).toContain('That entry has already left the line');
            expect(await button(again, 'Withdraw #301').isDisabled()).toBe(true);
            expect(await again.textContent()).not.toContain('Withdrawn:');
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        });

        it(`at ${width}px: Resume on a line with no entries removes the block and puts the focus on the card`, async () => {
          const c = fiveLine();
          c.answers['project-c'] = () => line('project-c', [], true);
          const { ctx, page, errors } = await open(skin, theme, width, c);
          try {
            const cc = regionOf(page, 'project-c');
            expect(await cc.getByRole('status').textContent()).toBe('Paused by you. Nothing lands.');
            await unroll(page, 'project-c');
            c.next = () => {
              c.answers['project-c'] = () => line('project-c', []);
              return { status: 200, body: { ok: true, project: 'project-c', operatorPaused: false, changed: true, seq: 9 } };
            };
            await button(cc, 'Resume line for project-c').click();
            await expect.poll(() => page.locator('section.landing-line[aria-label="Landing line of project-c"]').count()).toBe(0);
            await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('proj-card') === true)).toBe(true);
            expect(c.posts).toEqual([{ path: '/api/landing/pause', body: { project: 'project-c', paused: false } }]);
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        });

        // Desktop polish wave 192: every block starts rolled up, with one summary line that wraps inside its card; Enter
        // and Space open and close it; the choice outlives a re-read and (Instrument) a switch to Status and back; a
        // reload starts every block rolled up again.
        it(`at ${width}px: rolled up on first draw, the summary's fit, Enter and Space, kept across a re-read and a view switch, rolled up after a reload`, async () => {
          const c: Line = {
            answers: {
              'project-a': () => line('project-a', FIVE()),
              'project-b': () => line('project-b', THIRTEEN()),
              'project-c': () => line('project-c', [entry('project-c', 301)], true),
            },
            posts: [], next: null,
          };
          const { ctx, page, errors } = await open(skin, theme, width, c);
          try {
            for (const p of PROJECTS) {
              await regionOf(page, p).waitFor();
              expect(await toggleOf(page, p).getAttribute('aria-expanded'), p).toBe('false');
              expect(await regionOf(page, p).getByRole('button').count(), `${p}: the disclosure is the block's only control`).toBe(1);
            }
            expect(await regionOf(page, 'project-a').getByRole('status').textContent()).toBe('Next to land: #101.');
            expect(await summaryOf(page, 'project-a')).toBe('5 in line: #101, #104, #107 (waiting on a withdrawn entry), #102 (sent back), #109 (set aside)');
            expect(await summaryOf(page, 'project-b')).toBe(`13 in line: ${THIRTEEN().slice(0, 12).map((x) => `#${x.pr}`).join(', ')} and 1 more`);
            expect(await regionOf(page, 'project-c').getByRole('status').textContent()).toBe('Paused by you. Nothing lands.');
            expect(await summaryOf(page, 'project-c')).toBe('One in line: #301');
            for (const p of PROJECTS) {
              const m = await measureRolled(page, p);
              for (const b of m.buttons) {
                expect(b.h, `${p} ${b.name} at the tap floor`).toBeGreaterThanOrEqual(44);
                expect(b.left, `${p} ${b.name}'s ring inside the window`).toBeGreaterThanOrEqual(2);
                expect(b.right, `${p} ${b.name}'s ring inside the window`).toBeLessThanOrEqual(m.vw - 2);
              }
              expect(m.summary, `${p} draws its summary`).not.toBeNull();
              expect(m.summary!.left, `${p}: the summary inside its card`).toBeGreaterThanOrEqual(m.card.left);
              expect(m.summary!.right, `${p}: the summary inside its card`).toBeLessThanOrEqual(m.card.right);
              expect(m.summary!.overflow, `${p}: the summary does not run sideways`).toBeLessThanOrEqual(1);
              expect(m.blockOverflow, `${p}: nothing in the block runs sideways`).toBeLessThanOrEqual(1);
              expect(m.cardOverflow, `${p}: nothing in the card runs sideways`).toBeLessThanOrEqual(1);
              expect(m.pageX, 'no sideways page scroll').toBeLessThanOrEqual(0);
            }
            if (width <= 390) expect((await measureRolled(page, 'project-b')).summary!.lines, 'thirteen entries wrap at phone width').toBeGreaterThanOrEqual(2);
            // Rolled up, Chrome's tree holds the disclosure and the status, and no pause control, list or Withdraw.
            const rolled = await axUnder(page, 'project-a');
            expect(rolled.filter((n) => n.role === 'button').map((n) => n.name)).toEqual(['Landing line']);
            expect(rolled.some((n) => n.role === 'status')).toBe(true);
            expect(rolled.some((n) => n.role === 'list' || n.role === 'listitem')).toBe(false);

            // Enter opens it and Space closes it; focus stays on the disclosure.
            const isToggleFocused = (): Promise<boolean> => page.evaluate(() => {
              const el = document.activeElement;
              return el !== null && el.classList.contains('landing-line-title') && el.closest('section.landing-line')?.getAttribute('aria-label') === 'Landing line of project-a';
            });
            await toggleOf(page, 'project-a').focus();
            await page.keyboard.press('Enter');
            await expect.poll(() => toggleOf(page, 'project-a').getAttribute('aria-expanded')).toBe('true');
            expect(await button(regionOf(page, 'project-a'), "Withdraw #104 from project-a's landing line").count()).toBe(1);
            expect(await regionOf(page, 'project-a').locator('.landing-line-summary').count(), 'no summary while open').toBe(0);
            expect(await isToggleFocused()).toBe(true);
            // Open, Chrome's tree still holds the pause button and the rows' list under the region, through the contents box.
            const opened = await axUnder(page, 'project-a');
            expect(opened.filter((n) => n.role === 'button').map((n) => n.name)).toEqual([
              'Landing line', 'Pause line for project-a',
              ...[101, 104, 107, 102, 109].map((pr) => `Withdraw #${pr} from project-a's landing line`)]);
            expect(opened.filter((n) => n.role === 'list')).toHaveLength(1);
            expect(opened.filter((n) => n.role === 'listitem')).toHaveLength(5);
            await page.keyboard.press('Space');
            await expect.poll(() => toggleOf(page, 'project-a').getAttribute('aria-expanded')).toBe('false');
            expect(await button(regionOf(page, 'project-a'), "Withdraw #104 from project-a's landing line").count()).toBe(0);
            expect(await isToggleFocused()).toBe(true);

            // Opened, it survives a re-read; the other cards stay rolled up.
            await page.keyboard.press('Enter');
            await expect.poll(() => toggleOf(page, 'project-a').getAttribute('aria-expanded')).toBe('true');
            const reread = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().includes('project=project-a'));
            await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
            await reread;
            expect(await toggleOf(page, 'project-a').getAttribute('aria-expanded')).toBe('true');
            expect(await toggleOf(page, 'project-b').getAttribute('aria-expanded')).toBe('false');

            // Instrument draws the cards in its Project view: a switch to Status unmounts them, and back draws them open.
            if (skin === INSTRUMENT) {
              await page.getByRole('radio', { name: 'Status', exact: true }).first().click();
              await expect.poll(() => page.locator('section.landing-line[aria-label="Landing line of project-a"] >> visible=true').count()).toBe(0);
              await page.getByRole('radio', { name: 'Project', exact: true }).first().click();
              await regionOf(page, 'project-a').waitFor();
              expect(await toggleOf(page, 'project-a').getAttribute('aria-expanded'), 'still open after Status and back').toBe('true');
              expect(await toggleOf(page, 'project-b').getAttribute('aria-expanded')).toBe('false');
            }

            // A reload starts every block rolled up: the choice was never stored in the browser.
            await page.reload();
            await page.waitForSelector('section.landing-line', { timeout: 20_000 });
            for (const p of PROJECTS) {
              await regionOf(page, p).waitFor();
              expect(await toggleOf(page, p).getAttribute('aria-expanded'), `${p} after the reload`).toBe('false');
            }
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        });
      }
    });
  }
}
