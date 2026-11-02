// Remove, Discard and Replace token at every width (accounts plan Task A19 Step 4, D-7742; spec 2026-10-18
// accounts-connect §9, §11, §3.11, §12.4). Sixteen cells: phone 360 and 390, laptop 1280 and wide 1920, both skins,
// dark and light, in a real Chrome over the production build, with no fleet behind it.
//
// Each cell reads, at every step: the skin and theme drawn are the ones the cell names, and nothing scrolls sideways
// (the page, or the sheet).
//  - The fold: Replace token on the token lane, Remove… on every lane, each at the tap floor.
//  - The pre-check and the blocked state: the box's line, the live session with Move and Move all, the sleeping one
//    listed apart with Wake and move; the destructive button disabled with the count still on the lane. Move opens A3's
//    mover in place of the remove sheet (one sheet at a time), and closing it asks the box again, which recounts.
//  - The typed confirm with the keyboard up at 360: the viewport is cut to the height a phone keyboard leaves, the sheet
//    shrinks with it, and the danger button is still reachable inside the panel and the viewport.
//  - The danger button: a keyboard focus draws its ring (outline or box shadow), in both palettes.
//  - The ledger: Removed, Kept on the box, the revoke link, and the checklist item at the tap floor, ticked.
//  - Discard: one button, no typed field. Replace: the field, then the restart row, the revoke item and the disclosure.
// The contrast of every ink is the gate's (`node design/contrast-check.mjs`), not this file's.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession, hibernatedSession } from '../test/fleetFixture';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 390, 1280, 1920];
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const now = Date.now();
const nowSec = Math.floor(now / 1000);
const acct = (wrapper: string): Record<string, unknown> => ({
  wrapper, five: 12, seven: 30, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
});
const rostered = (id: string, hue: string, kind = 'token'): Record<string, unknown> => ({
  id, label: id, hue, homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind,
});
const READY = { state: { word: 'signed-in', source: 'checked just now', at: now }, ready: true };
const ROSTER = [rostered('lane-a', 'cyan'), rostered('lane-b', 'violet', 'sign-in'), rostered('lane-c', 'blue')];
const ACCOUNTS = {
  accounts: [acct('lane-a'), acct('lane-b'), acct('lane-c')],
  projected: { wrapper: 'lane-a', score: 12 },
  roster: ROSTER,
  lanes: { 'lane-a': READY, 'lane-b': READY, 'lane-c': READY },
  connect: { accountOps: 'available', gate: 'armed', origin: 'https', caps: ['account-v2'], stepUpFreshUntil: now + 3_600_000 },
};
const LIVE = fleetSession({ id: 'lane-b:p-one', wrapper: 'lane-b', home: 'lane-b', project: 'p-one', title: 'one with a long session title' });
const ASLEEP = hibernatedSession(now - 60_000, { id: 'lane-b:p-two', wrapper: 'lane-b', home: 'lane-b', project: 'p-two', title: 'two' });
const ON_A = fleetSession({ id: 'lane-a:p-one', wrapper: 'lane-a', home: 'lane-a', project: 'p-one', title: 'three' });
const FIXTURE: AppFixture = {
  api: {
    '/api/feed': { events: [] },
    '/api/accounts': ACCOUNTS,
    '/api/accounts/lane-a/credential': { ok: true, lane: READY },
    '/api/accounts/lane-a/check': { ok: true, lane: READY },
    '/api/accounts/revoke-ack': { ok: true },
  },
  fleetFrames: [{ type: 'fleet', sessions: [LIVE, ASLEEP, ON_A] }],
};

const check = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ok: true,
  check: {
    live: 0, sleeping: [], archived: 0, upstream: false, otherHomeAble: 2, authInProgress: false, discardable: false,
    at: Date.now(), ...over,
  },
  fleetIdentity: null,
});

/** Remove's route on lane-b: the pre-check answers blocked, then the sleeper alone, then nothing; the act its ledger.
 *  lane-c's pre-check answers discardable. Both read the body's mode. */
async function removeRoutes(ctx: BrowserContext): Promise<{ checks: () => number }> {
  let n = 0;
  await ctx.route('**/api/accounts/*/remove', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { mode?: string };
    const lane = new URL(route.request().url()).pathname.split('/')[3];
    let json: unknown;
    if (body.mode === 'check') {
      const at = Date.now();
      if (lane === 'lane-c') json = check({ discardable: true, at });
      else {
        const shape = [{ live: 1, sleeping: ['lane-b:p-two'] }, { live: 0, sleeping: ['lane-b:p-two'] }, {}][Math.min(n++, 2)]!;
        json = check({ ...shape, at });
      }
    } else {
      json = {
        ok: true, roster: ROSTER.filter((r) => r['id'] !== lane),
        removed: [`~/.local/bin/${lane}`, `~/.cc-secrets/${lane}-oauth.env`], kept: [`~/.claude-${lane}`], rehomed: [],
        atProvider: [{ kind: 'anthropic-token', state: 'still-valid', revokeAt: 'claude-code-settings' }],
      };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
  });
  return { checks: () => n };
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

const go = (page: Page, to: string): Promise<void> => page.evaluate((path) => {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}, to);

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

/** Once the open panel has stopped moving (the spring up, or the dialog's fade). */
const settled = (page: Page): Promise<unknown> => page.waitForFunction(() => new Promise<boolean>((done) => {
  const el = document.querySelector<HTMLElement>('.sheet-panel');
  if (el === null) { done(false); return; }
  const a = el.getBoundingClientRect().top;
  setTimeout(() => done(el.getBoundingClientRect().top === a), 150);
}), undefined, { timeout: 10_000 });

/** The height of each button named `name` inside `scope`. */
const heights = (page: Page, scope: string, name: string): Promise<number[]> => page.evaluate(([s, n]) =>
  [...document.querySelectorAll<HTMLElement>(`${s} button, ${s} [role="checkbox"]`)]
    .filter((b) => (b.textContent ?? '').trim() === n).map((b) => b.getBoundingClientRect().height), [scope, name] as const);

describe('Remove, Discard and Replace token at every width and skin (D-7742)', () => {
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
        const routes = await removeRoutes(ctx);
        await page.goto(server!.origin + '/');
        await go(page, '/accounts');
        await page.waitForSelector('.accounts-row[data-lane="lane-b"] .acct-fold', { timeout: 30_000 });

        // The fold.
        for (const [lane, name] of [['lane-a', 'Replace token'], ['lane-a', 'Remove…'], ['lane-b', 'Remove…']] as const) {
          const h = await heights(page, `.accounts-row[data-lane="${lane}"] .acct-fold`, name);
          expect(h, `${lane}'s ${name}`).toHaveLength(1);
          expect(h[0]!, `${lane}'s ${name} at the tap floor`).toBeGreaterThanOrEqual(43.5);
        }
        expect(await heights(page, '.accounts-row[data-lane="lane-b"] .acct-fold', 'Replace token'), 'a sign-in lane has no Replace token').toHaveLength(0);
        await step(page, 'fold');

        // The pre-check, blocked.
        await page.locator('.accounts-row[data-lane="lane-b"] .acct-fold').getByRole('button', { name: 'Remove…' }).click();
        await page.waitForSelector('[data-testid="remove-check"]');
        await settled(page);
        const arm = await page.evaluate(() => {
          const p = document.querySelector<HTMLElement>('.sheet-panel')!.getBoundingClientRect();
          return { centred: Math.abs((p.left + p.right) / 2 - innerWidth / 2) <= 1, width: p.width,
            bottom: p.bottom >= innerHeight - 1 && p.left <= 1 && p.right >= innerWidth - 1,
            rect: [p.top, p.right, p.bottom, p.left, innerWidth, innerHeight].map(Math.round).join(',') };
        });
        if (desk) {
          expect(arm.centred, 'at ≥900 the sheet is the centred dialog').toBe(true);
          expect(arm.width).toBeLessThanOrEqual(561);
        } else if (!arm.bottom) {
          // The spring may still be settling its last pixels: the panel comes to rest on the bottom edge.
          await page.waitForFunction(() => {
            const p = document.querySelector<HTMLElement>('.sheet-panel')!.getBoundingClientRect();
            return p.bottom >= innerHeight - 1 && p.left <= 1 && p.right >= innerWidth - 1;
          }, undefined, { timeout: 5_000 }).catch(() => {
            throw new Error(`below 900 the sheet is a bottom sheet (${arm.rect})`);
          });
        }
        const blocked = await page.evaluate(() => ({
          line: document.querySelector('[data-testid="remove-check"]')?.textContent ?? '',
          sleeping: document.querySelector('[data-sleeping="true"]')?.textContent ?? '',
          button: [...document.querySelectorAll<HTMLButtonElement>('.sheet-panel button.btn-danger')].map((b) => [b.textContent, b.disabled]),
        }));
        expect(blocked.line).toMatch(/^1 live session · not the upstream lane · 2 other lanes can take new sessions · no sign-in in progress · read just now$/);
        expect(blocked.sleeping).toContain('lane-b:p-two');
        expect(blocked.button).toEqual([['Remove lane-b · 2 sessions still on it', true]]);
        for (const name of ['Move', 'Move all', 'Wake and move']) {
          const h = await heights(page, '.sheet-panel', name);
          expect(h, name).toHaveLength(1);
          expect(h[0]!, `${name} at the tap floor`).toBeGreaterThanOrEqual(43.5);
        }
        await step(page, 'blocked pre-check');

        // Move: the mover takes the remove sheet's place, and closing it asks the box again.
        await page.locator('.sheet-panel').getByRole('button', { name: 'Move', exact: true }).click();
        await page.waitForSelector('.move-row');
        await settled(page);
        // One sheet at a time: the remove sheet's panel leaves (its exit runs on vaul's keyframes) as the mover's arrives.
        await page.waitForFunction(() => document.querySelectorAll('.sheet-panel').length === 1, undefined, { timeout: 10_000 });
        await step(page, 'mover');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.querySelector('[data-testid="remove-check"]')?.textContent?.startsWith('0 live sessions'));
        expect(routes.checks()).toBe(2);
        // Wake and move, then the mover again; the box then reads nothing on the lane.
        await page.locator('.sheet-panel').getByRole('button', { name: 'Wake and move' }).click();
        await page.waitForSelector('.move-row');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => [...document.querySelectorAll('.sheet-panel button.btn-danger')].some((b) => b.textContent === 'Remove lane-b'));
        await settled(page);

        // The typed confirm with the keyboard up (at 360: the viewport cut to what a phone keyboard leaves).
        const field = page.locator('.sheet-panel .acct-field input');
        await field.click();
        await field.fill('lane-b');
        if (view.width === 360) await page.setViewportSize({ width: 360, height: 420 });
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => {
          const b = document.activeElement as HTMLElement;
          const cs = getComputedStyle(b);
          b.scrollIntoView({ block: 'nearest' });
          const r = b.getBoundingClientRect();
          const p = document.querySelector<HTMLElement>('.sheet-panel')!.getBoundingClientRect();
          return {
            text: b.textContent, danger: b.classList.contains('btn-danger'),
            ring: (cs.outlineStyle !== 'none' && Number.parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none',
            inPanel: r.top >= p.top - 1 && r.bottom <= p.bottom + 1,
            inView: r.top >= 0 && r.bottom <= innerHeight + 1,
            panelFits: p.top >= -1,
          };
        });
        expect(focus.text).toBe('Remove lane-b');
        expect(focus.danger, 'the destructive act is the danger variant').toBe(true);
        expect(focus.ring, 'a keyboard focus draws the danger button\'s ring').toBe(true);
        expect(focus.inPanel && focus.inView, 'the button stays reachable with the keyboard up').toBe(true);
        expect(focus.panelFits, 'the sheet shrinks rather than leaving the screen').toBe(true);
        await step(page, 'typed confirm');
        if (view.width === 360) await page.setViewportSize({ width: 360, height: 800 });

        // The ledger.
        await page.keyboard.press('Enter');
        await page.waitForSelector('[data-frame="removed"]');
        const ledger = await page.evaluate(() => ({
          heads: [...document.querySelectorAll('.acct-removal-head')].map((h) => h.textContent),
          link: document.querySelector<HTMLAnchorElement>('.acct-at-provider a')?.href ?? '',
        }));
        expect(ledger.heads).toEqual(['Removed', 'Kept on the box', 'Still valid at the provider until you revoke it']);
        expect(ledger.link).toBe('https://claude.ai/settings/claude-code');
        const box = await heights(page, '.acct-at-provider', 'I revoked it');
        expect(box, 'one checklist item').toHaveLength(1);
        // The 44px floor holds on a coarse pointer (spec §12.4), which every phone cell is; a desk's fine pointer draws
        // the option row at its own height.
        if (!desk) expect(box[0]!, 'the checklist item at the tap floor').toBeGreaterThanOrEqual(43.5);
        await page.locator('.acct-at-provider [role="checkbox"]').click();
        await page.waitForSelector('.acct-at-provider [role="checkbox"][aria-checked="true"]');
        await step(page, 'ledger');
        await page.locator('.sheet-panel').getByRole('button', { name: 'Done' }).click();
        await page.waitForFunction(() => document.querySelector('.sheet-panel') === null);

        // Discard: lane-c, which the box measures discardable.
        await page.locator('.accounts-row[data-lane="lane-c"] .acct-fold').getByRole('button', { name: 'Remove…' }).click();
        await page.waitForSelector('.sheet-panel button.btn-danger');
        await settled(page);
        const discard = await page.evaluate(() => ({
          buttons: [...document.querySelectorAll('.sheet-panel button.btn-danger')].map((b) => b.textContent),
          field: document.querySelector('.sheet-panel .acct-field input') !== null,
        }));
        expect(discard).toEqual({ buttons: ['Discard this lane'], field: false });
        await step(page, 'discard');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.querySelector('.sheet-panel') === null);

        // Replace token on lane-a.
        await page.locator('.accounts-row[data-lane="lane-a"] .acct-fold').getByRole('button', { name: 'Replace token' }).click();
        await page.waitForSelector('.sheet-panel .acct-secret input');
        await settled(page);
        await step(page, 'replace');
        const token = 'sk-ant-oat01-' + 'Y'.repeat(60);
        await page.fill('.sheet-panel .acct-secret input', token);
        await page.locator('.sheet-panel').getByRole('button', { name: 'Replace token' }).click();
        await page.waitForSelector('.acct-compromise');
        const replaced = await page.evaluate(() => ({
          restart: [...document.querySelectorAll('.sheet-panel button')].some((b) => b.textContent === 'Restart'),
          revoke: document.querySelector('.sheet-panel [role="checkbox"]')?.getAttribute('aria-checked') ?? null,
          inPage: document.documentElement.outerHTML.includes('YYYYYYYYYY'),
        }));
        expect(replaced).toEqual({ restart: true, revoke: 'false', inPage: false });
        await page.locator('.acct-compromise > summary').click();
        await step(page, 'replaced, with the disclosure open');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 120_000);
  }
});
