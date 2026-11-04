// Re-authenticate an existing lane at every width (accounts plan Task A38 Step 4, D-7872; spec 2026-10-18
// accounts-connect §4.2, §4.4, §9, §12.4). Sixteen cells: phone 360 and 390, laptop 1280 and wide 1920, both skins, dark
// and light, in a real Chrome over the production build, with no fleet behind it: the routes are answered below. Then the
// offline row: one cell per skin at 360 and 1280, dark.
//
// Each cell reads, at every step: the skin and theme drawn are the ones the cell names, and nothing scrolls sideways
// (the page, or the sheet).
//  - The trouble cards: Signed out on a sign-in lane holds Switch to a long-lived token (the primary) then Sign in
//    again; Signed out on a token lane, Mint a new token then Paste a token; the Expiring (minted token) card, Replace
//    token then Switch to sign-in, under its two sentences. Below 900 the two buttons stack, the primary first; at 900
//    and up they share a row. Each is at the tap floor.
//  - The re-auth run (the Expiring card's Replace token): the confirm frame (Mint a new token the primary, Paste a token
//    instead beside it), the URL card, the code, `done`, and the ending: the fresh check's word, the stated identity with
//    the old one as its default, the restart list, the revoke item and the compromise disclosure.
//  - Offline mid-attempt: the sentence with the last-known deadline, and no link, code field or Send.
// The contrast of every ink is the gate's (`node design/contrast-check.mjs`), not this file's.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 390, 1280, 1920];
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const OFFLINE_VIEWS: AppView[] = SKINS.flatMap((skin) => [360, 1280].map((width) => ({ skin, theme: PHOSPHOR, width })));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const now = Date.now();
const nowSec = Math.floor(now / 1000);
const DAY = 86_400_000;
const acct = (wrapper: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  wrapper, five: 12, seven: 30, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});
const rostered = (id: string, hue: string, kind: string): Record<string, unknown> => ({
  id, label: id, hue, homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind,
});
const OUT = { state: { word: 'signed-out', source: 'Signed out · HTTP 401 · checked 2h ago', at: now - 2 * 3_600_000 }, ready: false, notReadyReason: 'check-failed' };
const MINTED_AT = now - 335 * DAY;
const EXPIRING = {
  state: { word: 'expiring', source: 'token minted 11 months ago · about 4 weeks left · estimated', at: MINTED_AT },
  ready: true, check: { verdict: 'ok', at: now - 60_000 }, mintedAt: MINTED_AT, identity: 'someone@example.invalid', identitySource: 'stated',
};
const READY = { state: { word: 'signed-in', source: 'checked just now', at: now }, ready: true };
const ROSTER = [rostered('lane-a', 'cyan', 'sign-in'), rostered('lane-b', 'violet', 'token'), rostered('lane-c', 'blue', 'token')];
const ACCOUNTS = {
  accounts: [acct('lane-a', { authDead: true }), acct('lane-b', { authDead: true }), acct('lane-c')],
  projected: { wrapper: 'lane-c', score: 12 },
  roster: ROSTER,
  lanes: { 'lane-a': { ...OUT, identity: 'someone@example.invalid', identitySource: 'measured' }, 'lane-b': OUT, 'lane-c': EXPIRING },
  connect: {
    accountOps: 'available', gate: 'armed', origin: 'https', caps: ['account-v2', 'account-auth-v1'], stepUpFreshUntil: now + 3_600_000,
  },
};
const ID = 'lane-c';
const ATTEMPT = 'c'.repeat(32);
const URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&response_type=code&scope=user%3Ainference&state=s';
const LIVE = fleetSession({ id: 'lane-c:p-one', wrapper: 'lane-c', home: 'lane-c', project: 'p-one', title: 'one with a long session title' });
const FIXTURE: AppFixture = {
  api: { '/api/feed': { events: [] }, '/api/accounts': ACCOUNTS, '/api/accounts/revoke-ack': { ok: true } },
  fleetFrames: [{ type: 'fleet', sessions: [LIVE] }],
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

const go = (page: Page, to: string): Promise<void> => page.evaluate((path) => {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}, to);

/** The fake box's re-auth on lane-c: the attempt, its status (`phase`), the code, the cancel and the fresh check. */
async function reauthRoutes(ctx: BrowserContext): Promise<{ expiresAt: number }> {
  let phase: 'starting' | 'waiting-code' | 'exchanging' | 'done' = 'starting';
  const expiresAt = Date.now() + 7 * 60_000 + 30_000;
  const json = (body: unknown): { status: number; contentType: string; body: string } =>
    ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await ctx.route(`**/api/accounts/${ID}/**`, async (route) => {
    const p = new globalThis.URL(route.request().url()).pathname;
    if (p.endsWith('/auth/start')) { phase = 'waiting-code'; await route.fulfill(json({ ok: true, attemptId: ATTEMPT, expiresAt })); return; }
    if (p.endsWith('/auth/code')) { phase = 'exchanging'; await route.fulfill(json({ ok: true })); return; }
    if (p.endsWith('/auth/cancel')) { phase = 'starting'; await route.fulfill(json({ ok: true })); return; }
    if (p.endsWith('/auth')) {
      const st = phase;
      if (phase === 'exchanging') phase = 'done';
      await route.fulfill(json(st === 'waiting-code'
        ? { ok: true, state: st, url: URL, host: 'claude.com', updatedAt: Date.now(), expiresAt }
        : { ok: true, state: st, updatedAt: Date.now(), expiresAt }));
      return;
    }
    if (p.endsWith('/check')) { await route.fulfill(json({ ok: true, lane: READY })); return; }
    await route.fallback();
  });
  return { expiresAt };
}

/** What every step reads: the skin and theme drawn, and whether anything scrolls sideways. */
async function frame(page: Page): Promise<{ skin: string | null; theme: string; docOverflow: number; sheetOverflow: number }> {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.sheet-panel');
    return {
      skin: document.documentElement.getAttribute('data-skin'),
      theme: document.documentElement.getAttribute('data-theme') ?? 'phosphor',
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sheetOverflow: panel === null ? 0 : panel.scrollWidth - panel.clientWidth,
    };
  });
}

/** A card's credential acts: each one's words, whether it is the primary, and its box. */
const actsOf = (page: Page, lane: string): Promise<{ text: string; primary: boolean; top: number; bottom: number; height: number }[]> =>
  page.evaluate((l) => [...document.querySelectorAll<HTMLButtonElement>(`.accounts-row[data-lane="${l}"] .acct-trouble-acts button`)]
    .map((b) => {
      const r = b.getBoundingClientRect();
      return { text: (b.textContent ?? '').trim(), primary: b.classList.contains('btn-primary'), top: r.top, bottom: r.bottom, height: r.height };
    }), lane);

describe('Re-authenticate an existing lane at every width and skin (D-7872)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const desk = view.width >= 900;
      const step = async (page: Page, what: string): Promise<void> => {
        const f = await frame(page);
        expect([f.skin, f.theme], `${what}: the cell draws the skin and theme it names`).toEqual([view.skin, view.theme]);
        expect(f.docOverflow, `${what}: no horizontal page scroll`).toBeLessThanOrEqual(0);
        expect(f.sheetOverflow, `${what}: nothing scrolls sideways in the sheet`).toBeLessThanOrEqual(1);
      };
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await reauthRoutes(ctx);
        await page.goto(server!.origin + '/');
        await go(page, '/accounts');
        await page.waitForSelector('.accounts-row[data-lane="lane-c"] .acct-trouble-acts', { timeout: 30_000 });

        // The trouble cards, each act at the tap floor; the two stack below 900, the primary first.
        const want: Record<string, [string, string]> = {
          'lane-a': ['Switch to a long-lived token', 'Sign in again'],
          'lane-b': ['Mint a new token', 'Paste a token'],
          'lane-c': ['Replace token', 'Switch to sign-in'],
        };
        for (const [lane, [first, second]] of Object.entries(want)) {
          const acts = await actsOf(page, lane);
          expect(acts.map((a) => [a.text, a.primary]), `${lane}'s acts, the primary first`).toEqual([[first, true], [second, false]]);
          for (const a of acts) expect(a.height, `${lane}'s ${a.text} at the tap floor`).toBeGreaterThanOrEqual(43.5);
          if (desk) expect(Math.abs(acts[0]!.top - acts[1]!.top), `${lane}: at ≥900 the two share a row`).toBeLessThanOrEqual(1);
          else expect(acts[1]!.top, `${lane}: below 900 the second stacks under the primary`).toBeGreaterThanOrEqual(acts[0]!.bottom - 1);
        }
        const expiring = await page.evaluate(() => document.querySelector('.accounts-row[data-lane="lane-c"] .acct-trouble')?.textContent ?? '');
        expect(expiring).toContain("lane-c's token was minted about 11 months ago.");
        expect(expiring).toContain('Long-lived tokens last about a year. When it lapses the lane signs out.');
        await step(page, 'trouble cards');

        // The Expiring card's Replace token: the mint first, the paste its second way.
        await page.locator('.accounts-row[data-lane="lane-c"] .acct-trouble-acts').getByRole('button', { name: 'Replace token' }).click();
        await page.waitForSelector('.acct-reauth [data-frame="reauth"]');
        const confirm = await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.acct-reauth .acct-actions button')]
          .map((b) => [(b.textContent ?? '').trim(), b.classList.contains('btn-primary')]));
        expect(confirm).toEqual([['Paste a token instead', false], ['Mint a new token', true]]);
        await step(page, 'confirm frame');

        // The run: the URL card, the code, done.
        await page.click('.acct-reauth button:text-is("Mint a new token")');
        await page.waitForSelector('.acct-reauth .acct-url-card', { timeout: 30_000 });
        expect(await page.evaluate(() => document.querySelector('.acct-reauth .acct-countdown')?.textContent ?? ''))
          .toMatch(/^Expires at \d\d:\d\d · \d+:\d\d left$/);
        await step(page, 'URL card');
        await page.fill('.acct-reauth .acct-code input', 'Q'.repeat(40));
        await page.click('.acct-reauth .acct-code-send');

        // The ending: the fresh check, the stated identity, the restart list, the revoke item, the disclosure.
        await page.waitForSelector('.acct-reauth [data-frame="reauthed"] .acct-result-word', { timeout: 30_000 });
        const end = await page.evaluate(() => {
          const root = document.querySelector<HTMLElement>('.acct-reauth')!;
          const restart = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Restart');
          const tick = root.querySelector<HTMLElement>('[role="checkbox"]');
          return {
            word: root.querySelector('.acct-result-word')?.textContent ?? '',
            stated: root.querySelector<HTMLInputElement>('.acct-stated input')?.value ?? null,
            restart: restart === undefined ? 0 : restart.getBoundingClientRect().height,
            tick: tick === null ? 0 : tick.getBoundingClientRect().height,
            tickLabel: tick?.textContent ?? '',
            compromise: root.querySelector('.acct-compromise') !== null,
            ledger: [...root.querySelectorAll('.acct-ledger-text')].map((l) => l.textContent),
            code: document.documentElement.outerHTML.includes('QQQQQQQQQQ'),
          };
        });
        expect(end.word).toContain('Signed in · lane-c');
        expect(end.stated, 'the stated identity defaults to the old one').toBe('someone@example.invalid');
        expect(end.restart, 'Restart at the tap floor').toBeGreaterThanOrEqual(43.5);
        // The checklist item's floor is a phone's (A19's rule): Instrument's desk rows are its denser row.
        if (!desk) expect(end.tick, 'the revoke item at the tap floor').toBeGreaterThanOrEqual(43.5);
        else expect(end.tick, 'the revoke item is drawn').toBeGreaterThan(0);
        expect(end.tickLabel).toContain('I revoked the old token');
        expect(end.compromise).toBe(true);
        expect(end.ledger).toContain('✓ New token minted, checked and installed on the fleet host');
        expect(end.ledger).toContain('✓ Checked: one test reply · first-run setup verified');
        expect(end.code, 'the code is in no DOM node').toBe(false);
        await step(page, 'ending');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

describe('a re-auth offline mid-attempt, one cell per skin at 360 and 1280, dark (spec §12.5)', () => {
  for (const view of OFFLINE_VIEWS) {
    it(named(view), async () => {
      const app = await openApp(browser!, view, FIXTURE);
      try {
        const { expiresAt } = await reauthRoutes(app.ctx);
        await app.page.goto(server!.origin + '/');
        await go(app.page, '/accounts');
        await app.page.waitForSelector('.accounts-row[data-lane="lane-a"] .acct-trouble-acts', { timeout: 30_000 });
        // lane-c's Replace token, then the mint, to the code field; then the link drops.
        await app.page.locator('.accounts-row[data-lane="lane-c"] .acct-trouble-acts').getByRole('button', { name: 'Replace token' }).click();
        await app.page.click('.acct-reauth button:text-is("Mint a new token")');
        await app.page.waitForSelector('.acct-reauth .acct-code input', { timeout: 30_000 });
        app.cut();
        await app.page.waitForSelector('.acct-reauth [data-sign-in-offline="true"]', { timeout: 30_000 });
        const m = await app.page.evaluate(() => {
          const root = document.querySelector<HTMLElement>('.acct-reauth')!;
          const cancel = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Cancel');
          return {
            sentence: root.querySelector('[data-sign-in-offline="true"]')?.textContent ?? '',
            links: root.querySelectorAll('a[href]').length,
            fields: root.querySelectorAll('input').length,
            send: root.querySelector('.acct-code-send') !== null,
            cancelDisabled: cancel?.disabled ?? null,
            docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        const hm = await app.page.evaluate((t) => {
          const d = new Date(t);
          return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }, expiresAt);
        expect(m.sentence).toBe(`The server isn't answering. The sign-in keeps running on the fleet host until ${hm}. Reopen this when you're back online.`);
        expect(m.links, 'no link offline').toBe(0);
        expect(m.fields, 'no code field offline').toBe(0);
        expect(m.send, 'no Send offline').toBe(false);
        expect(m.cancelDisabled, 'Cancel is drawn and refused').toBe(true);
        expect(m.docOverflow).toBeLessThanOrEqual(0);
        const f = await frame(app.page);
        expect([f.skin, f.theme]).toEqual([view.skin, view.theme]);
        expect(f.sheetOverflow).toBeLessThanOrEqual(1);
        expect(app.errors).toEqual([]);
      } finally {
        await app.ctx.close();
      }
    }, 90_000);
  }
});
