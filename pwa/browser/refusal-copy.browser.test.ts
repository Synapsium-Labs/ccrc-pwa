// The `registry-unmeasurable` refusal, drawn, in a real Chrome over the production build (D-5972, #549, ARCH-11b).
// D-5971 moved the word to the table's 502 everywhere and made the four surfaces that render it inline branch on the
// WORD instead of the status: the archive-conflict sheet (PrSheet's "Archive now", then "Archive anyway"), the abandon
// sheet and the resume sheet's reclaim (both off a run row on /runs), and the coordinator banner's Pause. Each case
// answers that surface's POST with `502 { ok:false, error:'registry-unmeasurable' }` and asserts that the surface's
// own sentence for the word is drawn, whole, inside its sheet body or banner, with no horizontal page scroll and no
// page error, at 360, 390, 1280 and 1920 in both skins and both Phosphor palettes.
//
// Chrome comes from `resolveChrome()` in `beforeAll`, which THROWS when neither `CCRC_CHROME` nor
// `/usr/bin/google-chrome` is an executable file: a box without Chrome gives a red leg, never a skipped one.
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/refusal-copy.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { ABANDON_COPY } from '../src/fleet/AbandonSheet';
import { RECLAIM_COPY } from '../src/fleet/ResumeSheet';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const SKINS = [REFINED, INSTRUMENT] as const;
/** The two Phosphor palettes, one per mode. */
const THEMES = [PHOSPHOR, 'light'] as const;
const WIDTHS = [360, 390, 1280, 1920] as const;
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

/** `apiErrorText`'s sentence for the word (`lib/api.ts`'s `API_ERROR_TEXT`), which the archive-conflict sheet and the
 *  banner render. Spelled here, not imported: the table is module-private, and a drift is what this leg should see. */
const API_SENTENCE = 'The session registry could not be read, so this box cannot say whether that session exists.';

// ---- the fixture: neutral names only -------------------------------------------------------------------------------

const NOW = 1_792_362_479;
const WORKER = 'project-a-one';
const COORD = 'project-a-coord';
const RUN_ID = 3;

const session = (id: string, ws: string, extra: object = {}): object => ({
  id, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: `/w/project-a/${ws}`, workspace: ws, name: ws,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false, version: null, model: null, effort: null,
  ultracode: false, branch: `ws/${ws}`, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null,
  archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'idle', unmeasured: [], started: true,
  child: { kind: 'none' }, lifecycle: 'running', ...extra,
});

const MERGED_PR = {
  phase: 'merged', number: 7, url: null, title: 'a merged change', checks: null, checkNames: null, ahead: 1,
  reason: null, checkedAt: NOW * 1000, mergedAt: NOW * 1000, retryAt: null,
};

/** The run both run-board cases act on: open, on WORKER's workspace, claimed by a coordinator measured dead. */
const RUN = {
  id: RUN_ID, program: 'programme-a', programTitle: 'Programme A', wave: 1, waveOf: 2, project: 'project-a',
  homeProject: null, sessionId: WORKER, workspace: 'one', branch: 'ws/one', state: 'working', kind: 'work',
  reviews: null, claimedBy: COORD, resumed: false, clearedAt: null, openedAt: NOW * 1000 - 1_000_000,
  dispatchStartedAt: null, dispatchedAt: NOW * 1000 - 900_000, closedAt: null, handoffCommit: null,
  items: { done: 1, total: 4 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null,
            briefQueued: true, clearError: null, coordKickoffPendingSince: null },
  childReclaim: null,
};

const SESSIONS = [
  session(WORKER, 'one', { pr: MERGED_PR }),
  session(COORD, 'coord', { status: 'dead', lifecycle: 'orphan', bucket: 'idle' }),
];

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': { runs: [RUN] },
    '/api/claims': [],
    '/api/coord/caps': { caps: { maxConcurrentWorkers: 4, maxSessionsPerDay: 20 }, usage: { running: 1, dispatchedIn24h: 1 } },
    [`/api/sessions/${WORKER}/pr`]: { pr: MERGED_PR, draft: null, facts: null },
  },
  fleetFrames: [
    { type: 'fleet', sessions: SESSIONS },
    { type: 'runs', runs: [RUN] },
    { type: 'coord', coord: { pause: 'clear' } },
  ],
};

const REFUSAL = JSON.stringify({ ok: false, error: 'registry-unmeasurable' });

// ---- the leg -------------------------------------------------------------------------------------------------------

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

/** Open the app at `route` in `view`, every refusing POST answered at 502 with the word, and wait for the shell to
 *  stamp the skin and theme it was asked for. A route registered after `openApp`'s runs first (Playwright). */
async function boot(view: AppView, route: string): Promise<{ page: Page; errors: string[]; posts: string[]; close: () => Promise<void> }> {
  const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
  const posts: string[] = [];
  await ctx.route('**/api/**', async (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname;
    if (req.method() !== 'POST') return r.fallback();
    posts.push(path);
    if (path === `/api/sessions/${WORKER}/archive`) {
      const force = (req.postDataJSON() as { force?: unknown } | null)?.force === true;
      // The first tap is refused as run-open, which opens the conflict sheet; "Archive anyway" meets the word.
      return force
        ? r.fulfill({ status: 502, contentType: 'application/json', body: REFUSAL })
        : r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({
          ok: false, error: 'run-open', runs: [{ id: RUN_ID, program: RUN.program, wave: RUN.wave, waveOf: RUN.waveOf }],
        }) });
    }
    if (path === `/api/runs/${RUN_ID}/abandon` || path === `/api/runs/${RUN_ID}/reclaim` || path === '/api/coord/pause') {
      return r.fulfill({ status: 502, contentType: 'application/json', body: REFUSAL });
    }
    return r.fallback();
  });
  await page.goto(server!.origin + route);
  await page.waitForFunction(([skin, theme]) => {
    const root = document.documentElement;
    return root.getAttribute('data-skin') === skin && (root.getAttribute('data-theme') ?? 'phosphor') === theme;
  }, [view.skin, view.theme] as const, { timeout: 20_000 });
  return { page, errors, posts, close: () => ctx.close() };
}

interface Drawn {
  readonly text: string;
  /** How far the refusal's box runs past its container's right edge, and past the viewport's (<= 0 fits). */
  readonly pastContainer: number;
  readonly pastViewport: number;
  /** The refusal draws all of its text: nothing clipped sideways. */
  readonly whole: boolean;
  readonly visible: boolean;
  readonly sideScroll: number;
}

/** Measure the refusal paragraph `selector` inside the topmost `container`. */
function measure(page: Page, container: string, selector: string): Promise<Drawn> {
  return page.evaluate(([c, s]) => {
    const box = [...document.querySelectorAll<HTMLElement>(c)].at(-1);
    if (box === undefined) throw new Error(`no ${c} is open`);
    const el = box.querySelector<HTMLElement>(s);
    if (el === null) throw new Error(`no ${s} inside ${c}`);
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      text: el.textContent ?? '',
      pastContainer: r.right - box.getBoundingClientRect().right,
      pastViewport: r.right - document.documentElement.clientWidth,
      whole: el.scrollWidth <= el.clientWidth + 0.5,
      visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
      sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, [container, selector] as const);
}

function expectDrawn(d: Drawn, sentence: string, where: string): void {
  expect.soft(d.text, `${where}: the refusal's words`).toBe(sentence);
  expect.soft(d.visible, `${where}: the refusal is not drawn`).toBe(true);
  expect.soft(d.whole, `${where}: the refusal is cut sideways`).toBe(true);
  expect.soft(d.pastContainer, `${where}: the refusal runs past its container`).toBeLessThanOrEqual(0.5);
  expect.soft(d.pastViewport, `${where}: the refusal runs past the viewport`).toBeLessThanOrEqual(0.5);
  expect.soft(d.sideScroll, `${where}: the page scrolls sideways`).toBe(0);
}

describe('D-5972: registry-unmeasurable at 502 is drawn by its word on all four surfaces', () => {
  for (const view of VIEWS) {
    it(`archive conflict, abandon, resume and the coordinator banner (${named(view)})`, async () => {
      const { page, errors, posts, close } = await boot(view, `/s/${WORKER}`);
      try {
        // ArchiveConflictSheet, through PrSheet's merged branch.
        await page.locator('.keycap--pr').first().click();
        await page.getByRole('button', { name: 'Archive now' }).click();
        await page.getByRole('button', { name: 'Archive anyway' }).click();
        await page.locator('.archive-conflict-sheet .abandon-error').waitFor();
        expectDrawn(await measure(page, '.sheet-body', '.archive-conflict-sheet .abandon-error'), API_SENTENCE, `archive conflict, ${named(view)}`);

        // AbandonSheet and ResumeSheet, off the run row.
        await page.goto(`${server!.origin}/runs`);
        await page.getByRole('button', { name: `Abandon run ${RUN_ID}` }).click();
        await page.locator('.sheet-body').getByRole('button', { name: 'Abandon', exact: true }).click();
        await page.locator('.sheet-body .abandon-error').waitFor();
        const abandon = await measure(page, '.sheet-body', '.abandon-error');
        expect.soft(abandon.text, 'abandon: the sheet prefixes nothing it does not own').toContain(ABANDON_COPY['registry-unmeasurable']);
        expectDrawn(abandon, abandon.text, `abandon, ${named(view)}`);
        await page.keyboard.press('Escape');
        await page.locator('.sheet-body').waitFor({ state: 'detached' });

        await page.getByRole('button', { name: `Resume run ${RUN_ID}` }).click();
        await page.getByRole('button', { name: 'That id cannot be revived' }).click();
        await page.getByLabel(`Hand run ${RUN_ID} to this session id`).fill('project-a-two');
        await page.getByRole('button', { name: 'Reclaim' }).click();
        await page.locator('.sheet-body .abandon-error').waitFor();
        expectDrawn(await measure(page, '.sheet-body', '.abandon-error'), RECLAIM_COPY['registry-unmeasurable'], `resume, ${named(view)}`);
        await page.keyboard.press('Escape');
        await page.locator('.sheet-body').waitFor({ state: 'detached' });

        // CoordBanner's Pause.
        await page.locator('.coord-banner').getByRole('button', { name: 'Pause' }).click();
        await page.locator('.coord-banner .coord-error').waitFor();
        expectDrawn(await measure(page, '.coord-banner', '.coord-error'), API_SENTENCE, `coordinator banner, ${named(view)}`);

        expect(posts).toEqual([
          `/api/sessions/${WORKER}/archive`, `/api/sessions/${WORKER}/archive`,
          `/api/runs/${RUN_ID}/abandon`, `/api/runs/${RUN_ID}/reclaim`, '/api/coord/pause',
        ]);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    });
  }
});
