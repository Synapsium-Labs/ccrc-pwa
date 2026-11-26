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
//   CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/landing-line.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer, type OpenedApp } from './app';
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
  await opened.page.waitForSelector('section.landing-line', { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  return opened;
}
const regionOf = (page: Page, project: string): Locator => page.locator(`section.landing-line[aria-label="Landing line of ${project}"] >> visible=true`).first();
const button = (scope: Page | Locator, name: string): Locator => scope.getByRole('button', { name, exact: true }).first();
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
const fiveLine = (): Line => ({
  answers: { 'project-a': () => line('project-a', FIVE()), 'project-b': () => line('project-b', []), 'project-c': () => line('project-c', []) },
  posts: [], next: null,
});
const NOTICE = { word: 'landing-withdrawn', entryId: 1004, kind: 'queued', toId: 'lane-a-project-a', mailId: 1, deliveryId: 2 };

const WIDTHS = [360, 390, 1280, 1470, 1920];
for (const skin of [REFINED, INSTRUMENT]) {
  for (const theme of ['light', 'dark']) {
    describe(`the landing line, ${skin} ${theme}`, () => {
      for (const width of WIDTHS) {
        it(`at ${width}px: the line as read, its fit, the pause round trip, Cancel's and Done's focus`, async () => {
          const c = fiveLine();
          const { ctx, page, errors } = await open(skin, theme, width, c);
          try {
            // The empty line's card draws no block.
            await expect.poll(() => page.locator('section.landing-line[aria-label="Landing line of project-b"]').count()).toBe(0);
            const a = regionOf(page, 'project-a');
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
      }
    });
  }
}
