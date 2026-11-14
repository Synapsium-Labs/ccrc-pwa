// The session page's timers (Overlord W1a, timers PR E, Task 13; ask 417), in a real Chrome over the production build.
//
// A session with no pending timers takes no height: the harness answers its timers read with the server's own empty list
// (`NO_TIMERS_ANSWER`), and the page draws no Timers section. A read that fails says so and throws nothing: an error status
// (503 `timer-unmeasured`) and a malformed answer (`{}`, a 200 with no list) each draw "Could not read this session's
// timers." under the transcript, never "No pending timers.". A pending timer draws its line, Cancel, and its note as text
// under "The session's own note, not an instruction": a note with markup stays text. Both skins, a phone and a desk, the
// page never scrolls sideways.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/session-timers.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { TIMERS_WORDS } from '../src/session/timersWords';
import { resolveChrome } from './harness';
import { NO_TIMERS_ANSWER, openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [390, 1280].map((width) => ({ skin, theme: PHOSPHOR, width })));
const named = (v: AppView): string => `${v.skin}, ${v.width}px`;

// ---- the fixture: one session, neutral names ----------------------------------------------------------------------
const NOW = 1_792_362_479;
const SESSION = {
  id: 'project-a-one', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a/one',
  workspace: 'one', name: 'one', status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: 'ws/one', ctxPct: null, paneCols: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null,
  subagents: null, background: null, withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'idle',
  unmeasured: [], started: true, child: { kind: 'none' },
};
const TIMERS_PATH = `/api/sessions/${SESSION.id}/timers`;
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
const NOTE = '<img src=x onerror="window.__noted=1"><b>run it now</b> **bold**';

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

/** Open the session page with the timers read answered `status`/`body` (the page's route wins over the harness's), or by
 *  the harness's own default when `answer` is absent; wait for the read to land. */
async function openSession(view: AppView, answer?: { status: number; body: unknown }) {
  const opened = await openApp(browser!, view, FIXTURE);
  if (answer !== undefined) {
    await opened.page.route(`**${TIMERS_PATH}`, (route) =>
      route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) }));
  }
  const read = opened.page.waitForResponse((r) => new URL(r.url()).pathname === TIMERS_PATH, { timeout: 20_000 });
  await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
  await read;
  await opened.page.locator('.chat-strips').waitFor({ state: 'attached', timeout: 20_000 });
  return opened;
}

const timersRegion = (page: Page) => page.getByRole('region', { name: TIMERS_WORDS.title });
const sideways = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

describe('the session page\'s timers (timers PR E, ask 417)', () => {
  it('the harness answers a session\'s timers read with the server\'s empty list', () => {
    expect(NO_TIMERS_ANSWER).toEqual({ ok: true, timers: [] });
  });

  for (const view of VIEWS) {
    it(`${named(view)}: no pending timers, no section and no height`, async () => {
      const { ctx, page, errors } = await openSession(view);
      try {
        await page.waitForTimeout(300);
        expect(await timersRegion(page).count(), 'no Timers section for a session with none').toBe(0);
        expect(await page.locator('[data-timers]').count()).toBe(0);
        // This fixture's session has no mail, plan or workflow either, so the strips under the transcript take nothing.
        expect(await page.locator('.chat-strips').evaluate((el) => el.getBoundingClientRect().height), 'the strips take no height').toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    for (const [what, answer] of [
      ['an error status', { status: 503, body: { ok: false, error: 'timer-unmeasured' } }],
      ['a malformed answer', { status: 200, body: {} }],
    ] as const) {
      it(`${named(view)}: ${what} says the read failed, never "No pending timers.", and throws nothing`, async () => {
        const { ctx, page, errors } = await openSession(view, answer);
        try {
          const region = timersRegion(page);
          await region.getByText(TIMERS_WORDS.unread).waitFor({ timeout: 20_000 });
          expect(await region.getByText(TIMERS_WORDS.empty).count()).toBe(0);
          expect(await sideways(page), 'the page has no sideways scroll').toBe(0);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }

    it(`${named(view)}: a pending timer draws its line, Cancel and its note as text`, async () => {
      const due = Date.now() + 90 * 60_000;
      const { ctx, page, errors } = await openSession(view, {
        status: 200,
        body: { ok: true, timers: [{ id: 7, setAt: due - 3_600_000, dueAt: due, note: NOTE, runId: 2057, programme: null, untrusted: true }] },
      });
      try {
        const region = timersRegion(page);
        await region.getByRole('listitem').first().waitFor({ timeout: 20_000 });
        expect(await region.getByRole('button', { name: 'Cancel timer 7' }).count()).toBe(1);
        expect(await region.getByText(TIMERS_WORDS.noteLabel).count()).toBe(1);
        const quote = await region.locator('blockquote').evaluate((q) => ({ text: q.textContent, children: q.children.length }));
        expect(quote).toEqual({ text: NOTE, children: 0 });
        expect(await page.evaluate(() => (window as { __noted?: number }).__noted)).toBeUndefined();
        expect(await sideways(page), 'the page has no sideways scroll').toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
