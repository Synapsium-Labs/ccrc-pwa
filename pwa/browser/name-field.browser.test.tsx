// The "Name or Linear ticket" field behind both doors, in a real Chrome over the production build (named workspaces
// S7 and S8). jsdom lays nothing out, so `test/add-workspace-sheet.test.tsx` and `test/new-session-name.test.tsx` hold
// the behaviour and this file holds what only an engine can say: the field is not focused when a sheet opens (no
// keyboard on the two-tap path), the confirm and the field stay whole inside the viewport at phone widths, a long
// name cannot push the account out of the confirm, and nothing overflows sideways.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. A later `ctx.route` wins over the fixture's,
// which is how a refusal is staged here. For the per-width review: `CCRC_SHOTS=<a directory>` keeps one picture per
// step. Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config
// vitest.browser.config.ts browser/name-field.browser.test.tsx )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';
import { TEST_ROSTER } from '../test/rosterFixture';

const VIEWS: AppView[] = [
  { skin: REFINED, theme: PHOSPHOR, width: 360 },
  { skin: REFINED, theme: PHOSPHOR, width: 390 },
  { skin: REFINED, theme: 'light', width: 390 },
  { skin: INSTRUMENT, theme: PHOSPHOR, width: 1280 },
];
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const shotName = (step: string, v: AppView): string => `name-${step}-${v.skin}-${v.theme}-${v.width}.png`;

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: { wrapper: 'claude9', score: 29 }, roster: TEST_ROSTER },
    '/api/projects': {
      roots: ['/w'],
      projects: [
        { name: 'project-a', workdir: '/w/project-a', pool: { state: 'untagged' }, placement: { kind: 'projected', wrapper: 'claude9', score: 29 } },
        { name: 'project-b', workdir: '/w/project-b', pool: { state: 'untagged' }, placement: { kind: 'projected', wrapper: 'claude9', score: 29 } },
      ],
    },
    '/api/linear/resolve': { kind: 'named', slug: 'eng-1234', title: 'ENG-1234 - Fix the login flow', source: 'linear' },
  },
  fleetFrames: [{
    type: 'fleet',
    sessions: [fleetSession({
      id: 'claude9-project-a', wrapper: 'claude9', home: 'claude9', project: 'project-a', workdir: '/w/project-a',
      status: 'idle', bucket: 'idle', started: true,
    })],
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

/** Stage the workspace create's answer, after the fixture's own routes so it wins. */
const answerCreate = async (ctx: BrowserContext, status: number, body: unknown): Promise<void> => {
  await ctx.route('**/api/projects/*/workspaces', (route) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(body),
  }));
};

const PANEL = '.sheet-panel[data-state="open"]';
const settle = async (page: Page): Promise<void> => {
  await page.locator(PANEL).waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), undefined, { timeout: 5_000 });
};
const shot = async (page: Page, step: string, v: AppView): Promise<void> => {
  const dir = process.env.CCRC_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${shotName(step, v)}` });
};

/** Where the field, the confirm and the panel are, and what holds the focus. */
const measure = (page: Page, confirmName: RegExp) => page.evaluate(({ source, panelSelector }) => {
  const confirmRe = new RegExp(source);
  const r = (el: Element | null) => {
    if (el === null) return null;
    const b = el.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
  };
  const panel = document.querySelector(panelSelector);
  const input = panel?.querySelector('input') ?? null;
  const confirm = [...(panel?.querySelectorAll('button') ?? [])].find((b) => confirmRe.test(b.textContent ?? '')) ?? null;
  const label = confirm?.querySelector('span') ?? confirm;
  return {
    vw: window.innerWidth, vh: window.innerHeight, docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    panel: r(panel ?? null), input: r(input), confirm: r(confirm),
    confirmLabelClipped: label !== null && label.scrollWidth > label.clientWidth + 1,
    focusIsInput: document.activeElement instanceof HTMLInputElement,
  };
}, { source: confirmName.source, panelSelector: PANEL });

const whole = (m: Awaited<ReturnType<typeof measure>>, where: string, justOpened = false): void => {
  const panel = m.panel!, input = m.input!, confirm = m.confirm!;
  expect(m.docOverflow, `${where}: the page overflows sideways`).toBe(false);
  if (justOpened) expect(m.focusIsInput, `${where}: the field took the focus when the sheet opened`).toBe(false);
  expect.soft(panel.bottom, `${where}: the panel runs past the viewport`).toBeLessThanOrEqual(m.vh + 0.5);
  for (const [what, b] of [['field', input], ['confirm', confirm]] as const) {
    expect.soft(b.left, `${where}: the ${what} is cut on the left`).toBeGreaterThanOrEqual(-0.5);
    expect.soft(b.right, `${where}: the ${what} is cut on the right`).toBeLessThanOrEqual(m.vw + 0.5);
    expect.soft(b.top, `${where}: the ${what} is above the viewport`).toBeGreaterThanOrEqual(-0.5);
    // A whole pixel of slack: the new-session sheet's body scrolls, and its confirm can sit on the fold's own line.
    expect.soft(b.bottom, `${where}: the ${what} is below the fold`).toBeLessThanOrEqual(m.vh + 1);
  }
};

describe('the + sheet', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page } = await openApp(browser!, view, FIXTURE);
      try {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(server!.origin + '/');
        await page.getByRole('button', { name: /New workspace on project-a/ }).click();
        await settle(page);
        const where = named(view);
        whole(await measure(page, /^Add workspace$/), `${where}, empty`, true);
        await shot(page, 'plus-empty', view);

        // A ticket: pending, then Linear's title, with the id and branch it will get.
        await page.getByLabel('Name or Linear ticket').fill('ENG-1234');
        await page.getByText('from Linear').waitFor({ timeout: 5_000 });
        whole(await measure(page, /^Add workspace$/), `${where}, ticket`);
        await shot(page, 'plus-ticket', view);

        // A name long enough to need cutting: the confirm still fits and the slug says it was shortened.
        await page.getByLabel('Name or Linear ticket').fill('Investigate the flaky upload test on the staging runner after the retry change');
        await page.getByText(/Shortened to fit/).waitFor({ timeout: 5_000 });
        // The + door's confirm is one label whatever is typed ("Add workspace"), so a long name cannot reach it.
        const long = await measure(page, /^Add workspace$/);
        whole(long, `${where}, long name`);
        expect(long.confirmLabelClipped, `${where}: the confirm's label is cut`).toBe(false);
        await shot(page, 'plus-long', view);

        // A refused name: the sentence, a disabled confirm.
        await page.getByLabel('Name or Linear ticket').fill('!!');
        await page.getByText('That has no letters or numbers in it.').waitFor();
        expect(await page.getByRole('button', { name: 'Add workspace' }).isDisabled(), `${where}: a refused name leaves the confirm enabled`).toBe(true);
        await shot(page, 'plus-refused', view);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }

  it('a taken slug keeps the sheet open with the text in the field', async () => {
    const view = VIEWS[1]!;
    const { ctx, page } = await openApp(browser!, view, FIXTURE);
    try {
      await answerCreate(ctx, 409, { ok: false, error: 'slug-taken' });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(server!.origin + '/');
      await page.getByRole('button', { name: /New workspace on project-a/ }).click();
      await settle(page);
      await page.getByLabel('Name or Linear ticket').fill('ENG-1234');
      await page.getByRole('button', { name: 'Add workspace' }).click();
      await page.getByRole('alert').waitFor({ timeout: 5_000 });
      expect(await page.getByRole('alert').textContent()).toContain('project-a-eng-1234 already exists');
      expect(await page.getByLabel('Name or Linear ticket').inputValue()).toBe('ENG-1234');
      whole(await measure(page, /^Add workspace$/), `${named(view)}, 409`);
      await shot(page, 'plus-taken', view);
    } finally {
      await ctx.close();
    }
  }, 60_000);
});

describe('the new-session sheet', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page } = await openApp(browser!, view, FIXTURE);
      try {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(server!.origin + '/');
        await page.getByRole('button', { name: /new session/i }).first().click();
        await settle(page);
        await page.getByRole('button', { name: /team·alt/ }).click();
        await page.getByRole('button', { name: /^project-b/ }).click();
        const where = named(view);
        const empty = await measure(page, /^Start project-b on team·alt$/);
        whole(empty, `${where}, empty`, true);
        await shot(page, 'session-empty', view);

        // THE PREVIEW'S HEIGHT IS RESERVED: typing a name, and Linear's answer replacing the offline title, must not move
        // the sheet. The panel's top is the measure: it is anchored at its foot, so any growth shows there.
        await page.getByLabel('Name or Linear ticket').fill('ENG-1');
        const pending = await measure(page, /^Start ENG-1 on team·alt$/);
        expect(Math.abs(pending.panel!.top - empty.panel!.top), `${where}: the sheet jumped when a name was typed`).toBeLessThanOrEqual(1);
        await page.getByLabel('Name or Linear ticket').fill('ENG-1234');
        await page.getByText('from Linear').waitFor({ timeout: 5_000 });
        const ticket = await measure(page, /^Start ENG-1234 on team·alt$/);
        whole(ticket, `${where}, ticket`);
        expect(Math.abs(ticket.panel!.top - empty.panel!.top), `${where}: the sheet jumped when Linear answered`).toBeLessThanOrEqual(1);
        await shot(page, 'session-ticket', view);

        await page.getByLabel('Name or Linear ticket').fill('Investigate the flaky upload test on the staging runner after the retry change');
        await page.getByText(/Shortened to fit/).waitFor({ timeout: 5_000 });
        const long = await measure(page, /^Start Investigate/);
        whole(long, `${where}, long name`);
        await shot(page, 'session-long', view);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }

  it('an account refusal returns to the account step with ccd\'s reason', async () => {
    const view = VIEWS[1]!;
    const { ctx, page } = await openApp(browser!, view, FIXTURE);
    try {
      await answerCreate(ctx, 409, { ok: false, error: 'account-refused', reason: 'claude9:auth-dead' });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(server!.origin + '/');
      await page.getByRole('button', { name: /new session/i }).first().click();
      await settle(page);
      await page.getByRole('button', { name: /team·alt/ }).click();
      await page.getByRole('button', { name: /^project-b/ }).click();
      await page.getByLabel('Name or Linear ticket').fill('Login cleanup');
      await page.getByRole('button', { name: 'Start Login cleanup on team·alt' }).click();
      await page.getByRole('alert').waitFor({ timeout: 5_000 });
      expect(await page.getByRole('alert').textContent()).toContain("team·alt can't sign in right now. Pick another account. Nothing was created.");
      await shot(page, 'session-account-refused', view);
    } finally {
      await ctx.close();
    }
  }, 60_000);

  it('an overflow account closes the door with its sentence', async () => {
    const view = VIEWS[1]!;
    const { ctx, page } = await openApp(browser!, view, FIXTURE);
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(server!.origin + '/');
      await page.getByRole('button', { name: /new session/i }).first().click();
      await settle(page);
      await page.getByRole('button', { name: /^gpt/ }).click();
      await page.getByRole('button', { name: /^project-b/ }).click();
      expect(await page.getByLabel('Name or Linear ticket').isDisabled()).toBe(true);
      await page.getByText("Workspaces don't start on overflow accounts.").waitFor();
      await shot(page, 'session-overflow', view);
    } finally {
      await ctx.close();
    }
  }, 60_000);
});
