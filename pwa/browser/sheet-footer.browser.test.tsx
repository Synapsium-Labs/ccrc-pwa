// The Sheet's pinned footer (D-5932), in a real Chrome over the production build.
//
// A sheet's answers were the last child of its scrolling body, so a tall body scrolled them away: What's new with
// several releases put Update all below a phone's fold. `Sheet`'s `footer` is a row of the panel after the body, and
// the body shrinks and scrolls instead. jsdom lays nothing out, so `test/sheet-footer.test.tsx` holds the classes and
// this file holds the rects Chrome computes: What's new with eight releases of notes, opened from Settings › Updates,
// at 360, 390, 1280 and 1920 in both skins and both palettes — the body overflows and scrolls, the footer is inside
// the panel and below the body, and Update all and Close are whole inside the viewport, so nothing is clipped at the
// bottom on a desktop either.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/sheet-footer.browser.test.tsx )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [PHOSPHOR, 'light'].flatMap((theme) =>
  [360, 390, 1280, 1920].map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const NOW = Date.now();
const stamp = (version: string) => ({
  sha: 'bd2bf57a91c3e0d4f6a8b2c5e7d9f1a3b5c7e9d1', ref: 'main', builtAt: '2026-09-20T12:00:00Z', dirty: false, version,
});
const node = (nodeId: string, role: 'fleet' | 'server') => ({
  nodeId, role, label: role, os: 'linux',
  current: stamp('v0.0.2'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['update-gate'], agentOps: role === 'fleet' ? [] : null, highestVersion: 'v0.0.2', previousVersion: null,
  floorRead: 'measured', previousRead: 'absent',
  measuredAt: NOW - 60_000, reachable: true, unreachableSince: null,
  channel: 'dev', desiredTag: 'v0.0.10', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
});
const NOTES = (n: number): string => [
  `Changes since v0.0.${n - 1}`, '',
  'New', ...Array.from({ length: 4 }, (_, i) => `- A new thing the operator can see on the board, number ${i + 1} #${n}${i}`), '',
  'Fixed', ...Array.from({ length: 3 }, (_, i) => `- A fix to a sheet that used to misbehave, number ${i + 1} #${n}${i + 5}`), '',
].join('\n');
const RELEASES = Array.from({ length: 8 }, (_, i) => i + 3).map((n) => ({
  tag: `v0.0.${n}`, version: `0.0.${n}`, channel: 'dev', publishedAt: Date.parse('2026-10-18T09:00:00Z') + n * 3_600_000,
  commitSha: null, bundleListed: true, yanked: false, refused: [], notes: NOTES(n),
}));
const FIXTURE: AppFixture = {
  api: {
    '/api/updates': {
      catalogue: { lastOkAt: NOW - 60_000, lastError: null },
      releases: RELEASES,
      nodes: [node('0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10', 'fleet'), node('5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93', 'server')],
      intent: [],
      source: { owner: 'owner-a', repo: 'repo-a' },
    },
  },
  fleetFrames: [{ type: 'fleet', sessions: [] }],
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

/** The open panel's, body's and footer's rects, the body's overflow, and each footer button's rect. */
const measure = (page: Page) => page.evaluate(() => {
  const r = (el: Element | null) => {
    if (el === null) return null;
    const b = el.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
  };
  const p = document.querySelector('.sheet-panel[data-state="open"]');
  const body = p?.querySelector<HTMLElement>('.sheet-body') ?? null;
  const footer = p?.querySelector('.sheet-footer') ?? null;
  return {
    vh: window.innerHeight, vw: window.innerWidth,
    panel: r(p ?? null), body: r(body), footer: r(footer),
    footerInBody: footer !== null && footer.closest('.sheet-body') !== null,
    overflows: body !== null && body.scrollHeight > body.clientHeight + 1,
    buttons: [...(footer?.querySelectorAll('button') ?? [])].map((b) => ({ name: b.textContent ?? '', ...r(b)! })),
  };
});

describe("What's new with several releases: the footer stays in the panel and in view (D-5932)", () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page } = await openApp(browser!, view, FIXTURE);
      try {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(server!.origin + '/settings/updates');
        const opener = page.getByRole('button', { name: "See what's new" });
        await opener.waitFor({ timeout: 20_000 });
        await opener.scrollIntoViewIfNeeded();
        await opener.click();
        await page.locator('.sheet-panel[data-state="open"] .sheet-footer').waitFor({ timeout: 10_000 });
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), undefined, { timeout: 5_000 });
        const m = await measure(page);
        const where = named(view);
        expect(m.footerInBody, `${where}: the footer is inside the scrolling body`).toBe(false);
        expect(m.overflows, `${where}: eight releases should overflow the body (the fixture no longer tests a tall body)`).toBe(true);
        const panel = m.panel!, body = m.body!, footer = m.footer!;
        expect.soft(footer.top, `${where}: the footer starts above the body's end`).toBeGreaterThanOrEqual(body.bottom - 0.5);
        expect.soft(footer.bottom, `${where}: the footer runs past the panel`).toBeLessThanOrEqual(panel.bottom + 0.5);
        expect.soft(panel.bottom, `${where}: the panel runs past the viewport`).toBeLessThanOrEqual(m.vh + 0.5);
        expect(m.buttons.map((b) => b.name)).toEqual(['Update all', 'Close']);
        for (const b of m.buttons) {
          expect.soft(b.top, `${where}: ${b.name} is above the viewport`).toBeGreaterThanOrEqual(-0.5);
          expect.soft(b.bottom, `${where}: ${b.name} is below the fold`).toBeLessThanOrEqual(m.vh + 0.5);
          expect.soft(b.bottom, `${where}: ${b.name} is clipped by the panel`).toBeLessThanOrEqual(panel.bottom + 0.5);
          expect.soft(b.left, `${where}: ${b.name} is cut on the left`).toBeGreaterThanOrEqual(-0.5);
          expect.soft(b.right, `${where}: ${b.name} is cut on the right`).toBeLessThanOrEqual(m.vw + 0.5);
        }
        // For the per-width review: `CCRC_SHOTS=<a directory>` keeps one picture per view.
        const shots = process.env.CCRC_SHOTS;
        if (shots) await page.screenshot({ path: `${shots}/whats-new-${view.skin}-${view.theme}-${view.width}.png` });
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});

// ── the halted reason rides with its button (D-6031) ────────────────────────────────────────────────────────────
// While a node halts the fleet Update all is disabled and `aria-describedby` its reason. In the body that line sat
// after eight releases, thousands of pixels below the greyed button; in the footer it is straight above it.
const HALTED: AppFixture = {
  ...FIXTURE,
  api: {
    '/api/updates': {
      ...(FIXTURE.api['/api/updates'] as object),
      nodes: [
        { ...node('0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10', 'fleet'),
          update: { state: 'failed', target: 'v0.0.9', startedAt: NOW - 600_000, detail: 'gate: unit not up' } },
        node('5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93', 'server'),
      ],
    },
  },
};

describe("What's new while a node halts the fleet: the reason is in view, above Update all (D-6031)", () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page } = await openApp(browser!, view, HALTED);
      try {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(server!.origin + '/settings/updates');
        const opener = page.getByRole('button', { name: "See what's new" });
        await opener.waitFor({ timeout: 20_000 });
        await opener.scrollIntoViewIfNeeded();
        await opener.click();
        await page.locator('.sheet-panel[data-state="open"] .sheet-footer').waitFor({ timeout: 10_000 });
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), undefined, { timeout: 5_000 });
        const m = await page.evaluate(() => {
          const p = document.querySelector('.sheet-panel[data-state="open"]')!;
          const ua = [...p.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Update all')!;
          const line = document.getElementById(ua.getAttribute('aria-describedby') ?? '');
          const box = (el: Element) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
          return {
            vh: window.innerHeight, disabled: ua.disabled, button: box(ua),
            line: line === null ? null : { ...box(line), inFooter: line.closest('.sheet-footer') !== null },
          };
        });
        const where = named(view);
        expect(m.disabled, `${where}: Update all is not disabled`).toBe(true);
        expect(m.line, `${where}: aria-describedby names no element`).not.toBeNull();
        expect.soft(m.line!.inFooter, `${where}: the reason line is not in the footer`).toBe(true);
        expect.soft(m.line!.top, `${where}: the reason line is above the viewport`).toBeGreaterThanOrEqual(-0.5);
        expect.soft(m.line!.bottom, `${where}: the reason line is below the fold`).toBeLessThanOrEqual(m.vh + 0.5);
        expect.soft(m.line!.bottom, `${where}: the reason line is not above Update all`).toBeLessThanOrEqual(m.button.top + 0.5);
        const shots = process.env.CCRC_SHOTS;
        if (shots) await page.screenshot({ path: `${shots}/whats-new-halted-${view.skin}-${view.theme}-${view.width}.png` });
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});

// ── a tall footer leaves the body room (D-6030) ─────────────────────────────────────────────────────────────────
// The resume sheet with reclaim open pins five controls. In a landscape phone (740x360) and a phone with the keyboard
// up (360x420) the uncapped footer took the whole panel and the body — title and question — measured 0px.
const T = 1_792_362_479;
const WORKER = 'project-a-one';
const COORD = 'project-a-coord';
const session = (id: string, ws: string, extra: object = {}) => ({
  id, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: `/w/project-a/${ws}`, workspace: ws, name: ws,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false, version: null, model: null, effort: null,
  ultracode: false, branch: `ws/${ws}`, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null,
  archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'idle', unmeasured: [], started: true,
  child: { kind: 'none' }, lifecycle: 'running', ...extra,
});
const RUN = {
  id: 3, program: 'programme-a', programTitle: 'Programme A', wave: 1, waveOf: 2, project: 'project-a',
  homeProject: null, sessionId: WORKER, workspace: 'one', branch: 'ws/one', state: 'working', kind: 'work',
  reviews: null, claimedBy: COORD, resumed: false, clearedAt: null, openedAt: T * 1000 - 1_000_000,
  dispatchStartedAt: null, dispatchedAt: T * 1000 - 900_000, closedAt: null, handoffCommit: null,
  items: { done: 1, total: 4 }, unreadMail: 0,
  health: {
    mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true,
    clearError: null, coordKickoffPendingSince: null,
  },
  childReclaim: null,
};
const RESUME: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': { runs: [RUN] }, '/api/claims': [],
    '/api/coord/caps': { caps: { maxConcurrentWorkers: 4, maxSessionsPerDay: 20 }, usage: { running: 1, dispatchedIn24h: 1 } },
  },
  fleetFrames: [
    { type: 'fleet', sessions: [session(WORKER, 'one'), session(COORD, 'coord', { status: 'dead', lifecycle: 'orphan' })] },
    { type: 'runs', runs: [RUN] }, { type: 'coord', coord: { pause: 'clear' } },
  ],
};
const SHORT: (AppView & { height: number })[] = [
  { skin: REFINED, theme: PHOSPHOR, width: 740, height: 360 },
  { skin: INSTRUMENT, theme: 'light', width: 740, height: 360 },
  { skin: REFINED, theme: PHOSPHOR, width: 360, height: 420 },
  { skin: INSTRUMENT, theme: 'light', width: 360, height: 420 },
];

describe('the resume sheet with reclaim open in a short viewport: the body keeps room (D-6030)', () => {
  for (const view of SHORT) {
    it(`${named(view)}, ${view.height}px tall`, async () => {
      const { ctx, page } = await openApp(browser!, view, RESUME);
      try {
        await page.setViewportSize({ width: view.width, height: view.height });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(server!.origin + '/runs');
        await page.getByRole('button', { name: 'Resume run 3' }).click({ timeout: 20_000 });
        await page.getByRole('button', { name: 'That id cannot be revived' }).click();
        await page.getByLabel('Hand run 3 to this session id').waitFor({ timeout: 10_000 });
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), undefined, { timeout: 5_000 });
        const m = await page.evaluate(() => {
          const p = [...document.querySelectorAll('.sheet-panel[data-state="open"]')].at(-1)!;
          const body = p.querySelector<HTMLElement>('.sheet-body')!;
          const footer = p.querySelector<HTMLElement>('.sheet-footer')!;
          const title = p.querySelector('.sheet-title')!;
          const box = (el: Element) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
          return {
            vh: window.innerHeight, panel: box(p), body: box(body), bodyClient: body.clientHeight,
            title: box(title), footer: box(footer),
            controls: footer.querySelectorAll('button, input').length,
          };
        });
        const where = `${named(view)}, ${view.height}px tall`;
        expect.soft(m.bodyClient, `${where}: the body is squeezed to nothing`).toBeGreaterThanOrEqual(48);
        expect.soft(m.title.top, `${where}: the title starts above the body`).toBeGreaterThanOrEqual(m.body.top - 0.5);
        expect.soft(m.title.top, `${where}: the title is not in the body's visible part`).toBeLessThan(m.body.bottom);
        expect.soft(m.footer.bottom, `${where}: the footer runs past the panel`).toBeLessThanOrEqual(m.panel.bottom + 0.5);
        expect.soft(m.panel.bottom, `${where}: the panel runs past the viewport`).toBeLessThanOrEqual(m.vh + 0.5);
        expect(m.controls, `${where}: the five reclaim controls are not all in the footer`).toBe(5);
        // Every control is reachable: scrolled into view inside the footer, it is whole in the viewport.
        for (const name of [`Revive ${COORD}`, 'Re-kickoff', 'Reclaim', 'Cancel']) {
          const b = page.locator('.sheet-panel[data-state="open"] .sheet-footer').getByRole('button', { name, exact: true });
          await b.scrollIntoViewIfNeeded();
          const r = (await b.boundingBox())!;
          expect.soft(r.y, `${where}: ${name} is above the viewport`).toBeGreaterThanOrEqual(-0.5);
          expect.soft(r.y + r.height, `${where}: ${name} is below the fold`).toBeLessThanOrEqual(view.height + 0.5);
        }
        const shots = process.env.CCRC_SHOTS;
        if (shots) await page.screenshot({ path: `${shots}/resume-reclaim-${view.skin}-${view.theme}-${view.width}x${view.height}.png` });
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});
