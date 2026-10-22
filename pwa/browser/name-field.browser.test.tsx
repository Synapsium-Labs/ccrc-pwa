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
import { GROUP_MODE_KEY } from '../src/skins/instrument/FleetTable';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';
import { TEST_ROSTER } from '../test/rosterFixture';
import { LOOKUP_NOTE, type LookupNote } from '../src/fleet/workspaceNameWords';

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

/** These cases measure the project cards, which Instrument draws in its project mode (D-5473): seed that mode before
 *  the first paint. Refined ignores the key. */
const openCards = async (view: AppView): ReturnType<typeof openApp> => {
  const opened = await openApp(browser!, view, FIXTURE);
  await opened.ctx.addInitScript((key) => {
    try { localStorage.setItem(key, 'project'); } catch { /* no storage: Instrument opens on status */ }
  }, GROUP_MODE_KEY);
  return opened;
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
      const { ctx, page } = await openCards(view);
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
    const { ctx, page } = await openCards(view);
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
      const { ctx, page } = await openCards(view);
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
    const { ctx, page } = await openCards(view);
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

  it('a refusal under the field sits a full 16px above the routing row, which the pinned confirm crops', async () => {
    // Second blind review, S4-1: the error line sat 14px over the "Class" label. Footer and divider are the sheets' own
    // (no pinned-footer sheet has a divider), so only the spacing is this field's.
    for (const view of [VIEWS[0]!, VIEWS[1]!]) {
      const { ctx, page } = await openCards(view);
      try {
        await answerCreate(ctx, 409, { ok: false, error: 'slug-taken' });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(server!.origin + '/');
        await page.getByRole('button', { name: /new session/i }).first().click();
        await settle(page);
        await page.getByRole('button', { name: /team·alt/ }).click();
        await page.getByRole('button', { name: /^project-b/ }).click();
        await page.getByLabel('Name or Linear ticket').fill('ENG-1234');
        await page.getByRole('button', { name: /^Start ENG-1234/ }).click();
        await page.getByRole('alert').waitFor({ timeout: 5_000 });
        const gap = await page.evaluate((panelSelector) => {
          const alert = document.querySelector(`${panelSelector} [role="alert"]`);
          const label = [...document.querySelectorAll(`${panelSelector} .route-field-label`)].find((l) => l.textContent === 'Class');
          return alert === null || label === undefined ? NaN : label.getBoundingClientRect().top - alert.getBoundingClientRect().bottom;
        }, PANEL);
        expect(gap, `${named(view)}: the refusal is ${gap}px above the Class label`).toBeGreaterThanOrEqual(16);
      } finally {
        await ctx.close();
      }
    }
  }, 60_000);

  it('an overflow account closes the door with its sentence', async () => {
    const view = VIEWS[1]!;
    const { ctx, page } = await openCards(view);
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

// A LOOKUP ANSWER MUST NOT MOVE THE SHEET (second blind review, S3-1). The preview's height is reserved, and the
// answers that add a reason line, and for two of them the pointer to Settings, are the tallest states it has. Each is
// staged by the ref typed (`ctx.route` by the `ref` query), on both doors and at every width: the panel's top, the
// field's top and the preview's own height are the same empty, pending and answered, and everything the preview says
// sits inside the block that was reserved for it.
const ANSWERS: ReadonlyArray<{ ref: string; reason: LookupNote }> = [
  { ref: 'ENG-9999', reason: 'not-found' },
  { ref: 'ENG-1', reason: 'not-configured' },
  { ref: 'ENG-2', reason: 'unauthorised' },
];

const answerResolve = async (ctx: BrowserContext): Promise<void> => {
  await ctx.route('**/api/linear/resolve*', (route) => {
    const ref = new URL(route.request().url()).searchParams.get('ref') ?? '';
    const hit = ANSWERS.find((a) => a.ref === ref);
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ kind: 'named', slug: ref.toLowerCase(), title: ref, source: 'offline', reason: hit?.reason ?? 'not-found' }),
    });
  });
};

/** Where the sheet's top, the field's top and the preview's height are, and where the preview's last line ends. */
const stance = (page: Page) => page.evaluate((panelSelector) => {
  const panel = document.querySelector(panelSelector);
  // The NAME field, not the project search above it on the new-session sheet: its description is its preview's.
  const input = panel?.querySelector('input[aria-describedby$="-preview"]') ?? null;
  const preview = input === null ? null : document.getElementById(input.getAttribute('aria-describedby') ?? '');
  const last = preview?.lastElementChild ?? null;
  return {
    panelTop: panel?.getBoundingClientRect().top ?? NaN,
    inputTop: input?.getBoundingClientRect().top ?? NaN,
    previewHeight: preview?.getBoundingClientRect().height ?? NaN,
    previewBottom: preview?.getBoundingClientRect().bottom ?? NaN,
    contentBottom: last?.getBoundingClientRect().bottom ?? NaN,
  };
}, PANEL);

const stays = (a: Awaited<ReturnType<typeof stance>>, b: Awaited<ReturnType<typeof stance>>, where: string): void => {
  expect.soft(Math.abs(a.panelTop - b.panelTop), `${where}: the sheet's top moved`).toBeLessThanOrEqual(1);
  expect.soft(Math.abs(a.inputTop - b.inputTop), `${where}: the field moved`).toBeLessThanOrEqual(1);
  expect.soft(Math.abs(a.previewHeight - b.previewHeight), `${where}: the preview's height changed (${a.previewHeight} -> ${b.previewHeight})`).toBeLessThanOrEqual(1);
  expect.soft(b.contentBottom, `${where}: the preview's last line runs past its reserved block`).toBeLessThanOrEqual(b.previewBottom + 0.5);
};

// A REQUEST IN FLIGHT LOCKS EVERY DOOR THE SAME WAY, AND VISIBLY (second blind review, S4-2): the field is disabled (no
// focus ring to stay lit) and what it was built from is dimmed. The create is held open by a gate the test releases.
describe('a request in flight', () => {
  for (const door of ['the + sheet', 'the new-session sheet'] as const) {
    it(`${door} dims the field, which is disabled and holds no focus`, async () => {
      const view = VIEWS[1]!;
      const { ctx, page } = await openCards(view);
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => { release = resolve; });
      try {
        await ctx.route('**/api/projects/*/workspaces', async (route) => {
          await gate;
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(server!.origin + '/');
        if (door === 'the + sheet') {
          await page.getByRole('button', { name: /New workspace on project-a/ }).click();
          await settle(page);
          await page.getByLabel('Name or Linear ticket').fill('Login cleanup');
          await page.getByRole('button', { name: 'Add workspace' }).click();
        } else {
          await page.getByRole('button', { name: /new session/i }).first().click();
          await settle(page);
          await page.getByRole('button', { name: /team·alt/ }).click();
          await page.getByRole('button', { name: /^project-b/ }).click();
          await page.getByLabel('Name or Linear ticket').fill('Login cleanup');
          await page.getByRole('button', { name: /^Start Login cleanup/ }).click();
        }
        await page.locator(`${PANEL} input:disabled`).first().waitFor({ timeout: 5_000 });
        const look = await page.evaluate((panelSelector) => {
          const input = document.querySelector(`${panelSelector} input[aria-describedby$="-preview"]`);
          const locked = input?.closest('[data-locked]') ?? null;
          return {
            // `:disabled`, not the `disabled` property: an input in a disabled fieldset is inert and the property still reads false.
            disabled: input?.matches(':disabled') === true,
            readOnly: input instanceof HTMLInputElement && input.readOnly,
            opacity: locked === null ? NaN : Number(getComputedStyle(locked).opacity),
            focused: document.activeElement === input,
          };
        }, PANEL);
        expect(look, `${door}: the field is not disabled`).toMatchObject({ disabled: true });
        expect(look.readOnly, `${door}: the field is read-only instead of disabled`).toBe(false);
        expect(look.opacity, `${door}: the locked field is not dimmed`).toBeLessThanOrEqual(0.7);
        expect(look.focused, `${door}: a locked field holds the focus`).toBe(false);
        await shot(page, `inflight-${door === 'the + sheet' ? 'plus' : 'session'}`, view);
      } finally {
        release();
        await ctx.close();
      }
    }, 60_000);
  }
});

describe('a lookup answer does not move the sheet', () => {
  for (const view of VIEWS) {
    for (const door of ['the + sheet', 'the new-session sheet'] as const) {
      it(`${door}, ${named(view)}`, async () => {
        const { ctx, page } = await openCards(view);
        try {
          await answerResolve(ctx);
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await page.goto(server!.origin + '/');
          if (door === 'the + sheet') {
            await page.getByRole('button', { name: /New workspace on project-a/ }).click();
            await settle(page);
          } else {
            await page.getByRole('button', { name: /new session/i }).first().click();
            await settle(page);
            await page.getByRole('button', { name: /team·alt/ }).click();
            await page.getByRole('button', { name: /^project-b/ }).click();
          }
          const field = page.getByLabel('Name or Linear ticket');
          const empty = await stance(page);
          for (const { ref, reason } of ANSWERS) {
            const where = `${door}, ${named(view)}, ${ref} (${reason})`;
            await field.fill(ref);
            await page.getByText('looking up…').waitFor({ timeout: 5_000 });
            stays(empty, await stance(page), `${where}, pending`);
            await page.getByText(LOOKUP_NOTE[reason].hint).waitFor({ timeout: 5_000 });
            stays(empty, await stance(page), `${where}, answered`);
            const pointer = LOOKUP_NOTE[reason].pointer;
            if (pointer !== null) await page.getByRole('button', { name: pointer }).waitFor({ timeout: 5_000 });
            await shot(page, `lookup-${reason}-${door === 'the + sheet' ? 'plus' : 'session'}`, view);
          }
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }
});
