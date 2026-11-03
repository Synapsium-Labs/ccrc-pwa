// The Add account door and the connect sheet at every width (accounts plan Task A18 Step 4, D-5522, D-7740; spec
// 2026-10-18 accounts-connect §5, §12.1–§12.4). Sixteen cells: phone 360 and 390, laptop 1280 and wide 1920, both skins,
// dark and light, in a real Chrome over the production build, with no fleet behind it.
//
// Each cell walks Anthropic Paste end to end and reads, at every step: the skin and theme drawn are the ones the cell
// names, and nothing scrolls sideways (the page, or the sheet).
//  - The door: exactly one, the lane list's last row on a phone (the skin's row height, 52px in Refined and 44px in
//    Instrument) and the page header's action at ≥900; narrowed (a dark gate's answer, in a second context), it stays,
//    aria-disabled, with its reason and its command beneath it.
//  - The sheet at 1280 and 1920 is the centred dialog (D-5933's desktop arm, measured here), and a bottom sheet below 900.
//  - Name it: the hue swatches are one row of six, each at least 44px wide; the derived folder line is one mono line that
//    ellipsises rather than wraps when the name is long.
//  - Method: Mint and Sign in are narrowed in place (no `account-auth-v1` yet), Paste is selected, and the radio follows
//    the provider table's order.
//  - A refused paste: the sentence, and the field empty. The result: Turn it on, and the ledger.
// The contrast of every ink is the gate's (`node design/contrast-check.mjs`), not this file's.
//
// THE OFFLINE ROW (§Acceptance, spec §12.5; D-7740 (8)): one cell per skin at 360 and 1280, dark, four in all, each read
// twice. Warm: the sheet is open on the method frame with a token typed when the link drops; the screen keeps the last
// answer with every age counting on, the field is gone with its value, and the door, each card's switch and the sheet's
// primary are refused with the one sentence and its read-line. Cold: the app starts with no link, from the offline
// snapshot; the door is refused with the never-read line, a tap opens nothing, and no field is drawn.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';
import { PROVIDERS } from '../../shared/providers';

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
const rostered = (id: string, hue: string): Record<string, unknown> => ({
  id, label: id, hue, homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'token',
});
const READY = { state: { word: 'signed-in', source: 'checked just now', at: now }, ready: true };
const ROSTER = [rostered('lane-a', 'cyan'), rostered('lane-b', 'violet')];
const ACCOUNTS = {
  accounts: [acct('lane-a'), acct('lane-b')],
  projected: { wrapper: 'lane-a', score: 12 },
  roster: ROSTER,
  lanes: { 'lane-a': READY, 'lane-b': READY },
  connect: { accountOps: 'available', gate: 'armed', origin: 'https', caps: ['account-v2'], stepUpFreshUntil: now + 3_600_000 },
};
const LONG_ID = 'lane-with-a-name-long-enough-x';
const FIXTURE: AppFixture = {
  api: {
    '/api/feed': { events: [] },
    '/api/accounts': ACCOUNTS,
    [`/api/accounts/${LONG_ID}/check`]: { ok: true, lane: READY },
  },
  fleetFrames: [{ type: 'fleet', sessions: [] }],
};
/** The same box with the gate dark: no `lanes` and no `connect` on the answer (D-5511). */
const DARK: AppFixture = {
  ...FIXTURE,
  api: { ...FIXTURE.api, '/api/accounts': { accounts: ACCOUNTS.accounts, projected: ACCOUNTS.projected, roster: ROSTER } },
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

const go = (page: Page, to: string): Promise<void> => page.evaluate((path) => {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}, to);

/** The add route answers a refusal until `accept` is called, then the new lane; every other request falls through to
 *  the fixture. */
async function addRoute(ctx: BrowserContext): Promise<{ accept: () => void }> {
  let refuse = true;
  await ctx.route('**/api/accounts', async (route) => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    const body = refuse
      ? { status: 400, json: { error: 'key-rejected' } }
      : { status: 200, json: { ok: true, roster: [...ROSTER, rostered(LONG_ID, 'blue')], lane: READY, fleetIdentity: null } };
    await route.fulfill({ status: body.status, contentType: 'application/json', body: JSON.stringify(body.json) });
  });
  return { accept: () => { refuse = false; } };
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

describe('the Add account door and the connect sheet at every width and skin (D-7740)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const desk = view.width >= 900;
      const step = async (page: Page, what: string): Promise<void> => {
        const f = await frame(page);
        expect([f.skin, f.theme], `${what}: the cell draws the skin and theme it names`).toEqual([view.skin, view.theme]);
        expect(f.docOverflow, `${what}: no horizontal page scroll`).toBeLessThanOrEqual(0);
        expect(f.sheetOverflow, `${what}: nothing scrolls sideways in the sheet`).toBeLessThanOrEqual(1);
      };

      // The narrowed door, on a dark gate's answer.
      const dark = await openApp(browser!, view, DARK);
      try {
        await dark.page.goto(server!.origin + '/');
        await go(dark.page, '/accounts');
        await dark.page.waitForSelector('.acct-door-reason', { timeout: 30_000 });
        const n = await dark.page.evaluate(() => {
          const doors = [...document.querySelectorAll<HTMLElement>('.acct-door, .acct-door-action')];
          const door = doors[0]!;
          const reason = document.getElementById(door.getAttribute('aria-describedby') ?? '')!;
          return {
            doors: doors.length,
            disabled: door.getAttribute('aria-disabled'),
            reason: reason?.textContent ?? '',
            command: document.querySelector('.acct-door-reason .acct-fix-field')?.textContent ?? '',
            below: reason.getBoundingClientRect().top >= door.getBoundingClientRect().bottom - 1,
          };
        });
        expect(n.doors, 'one door, narrowed in place').toBe(1);
        expect(n.disabled).toBe('true');
        expect(n.reason).toContain('Turn on sign-in for this PWA first');
        expect(n.command).toBe('ccrc auth on');
        expect(n.below, 'the reason sits beneath the door').toBe(true);
        await step(dark.page, 'narrowed door');
        expect(dark.errors).toEqual([]);
      } finally {
        await dark.ctx.close();
      }

      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        const add = await addRoute(ctx);
        await page.goto(server!.origin + '/');
        await go(page, '/accounts');
        await page.waitForSelector('.accounts-row[data-lane="lane-b"]', { timeout: 30_000 });

        // The door: one per width.
        const d = await page.evaluate(() => {
          const doors = [...document.querySelectorAll<HTMLElement>('.acct-door, .acct-door-action')];
          const list = document.querySelector('.accounts-list');
          const rowH = getComputedStyle(document.documentElement).getPropertyValue('--row-h').trim();
          const door = doors[0]!;
          return {
            doors: doors.length,
            lastRow: list !== null && list.lastElementChild === door,
            inHead: door.closest('[data-page-head], header, .sticky') !== null || door.closest('[data-page-body]') === null,
            height: door.getBoundingClientRect().height,
            rowH: Number.parseFloat(rowH),
          };
        });
        expect(d.doors, 'one door per width').toBe(1);
        if (desk) {
          expect(d.lastRow, 'at ≥900 the door is not a list row').toBe(false);
          expect(d.inHead, 'at ≥900 the door is the page header\'s action').toBe(true);
        } else {
          expect(d.lastRow, 'on a phone the door is the list\'s last row').toBe(true);
          expect(d.height, 'the door is the skin\'s row height').toBeGreaterThanOrEqual(d.rowH - 0.5);
          expect(d.height).toBeGreaterThanOrEqual(44);
        }
        await step(page, 'door');

        // Provider.
        await page.click('.acct-door, .acct-door-action');
        await page.waitForSelector('[data-frame="provider"]');
        // Once the panel has stopped moving (the spring up, or the dialog's fade).
        await page.waitForFunction(() => new Promise<boolean>((done) => {
          const el = document.querySelector<HTMLElement>('.sheet-panel');
          if (el === null) { done(false); return; }
          const a = el.getBoundingClientRect().top;
          setTimeout(() => done(el.getBoundingClientRect().top === a), 150);
        }), undefined, { timeout: 10_000 });
        const arm = await page.evaluate(() => {
          const p = document.querySelector<HTMLElement>('.sheet-panel')!.getBoundingClientRect();
          return {
            width: p.width,
            centred: Math.abs((p.left + p.right) / 2 - innerWidth / 2) <= 1,
            // Full width and anchored at the bottom edge (vaul's panel runs a little past it, under the safe area).
            bottom: p.bottom >= innerHeight - 1 && p.top > 0 && p.left <= 1 && p.right >= innerWidth - 1,
          };
        });
        if (desk) {
          expect(arm.centred, 'at ≥900 the sheet is the centred dialog').toBe(true);
          expect(arm.width).toBeLessThanOrEqual(561);
        } else {
          expect(arm.bottom, 'below 900 the sheet is a bottom sheet').toBe(true);
        }
        await step(page, 'provider frame');

        // Name it.
        await page.click('[data-frame="provider"] button.opt');
        await page.waitForSelector('[data-frame="name"]');
        await page.fill('[data-frame="name"] input.font-mono', LONG_ID);
        await page.fill('[data-frame="name"] .acct-field:nth-of-type(2) input', 'Lane with a long name');
        const nm = await page.evaluate(() => {
          const cells = [...document.querySelectorAll<HTMLElement>('.acct-hue')];
          const tops = new Set(cells.map((c) => Math.round(c.getBoundingClientRect().top)));
          const derived = document.querySelector<HTMLElement>('.acct-derived')!;
          const cs = getComputedStyle(derived);
          return {
            hues: cells.length,
            rows: tops.size,
            narrowest: Math.min(...cells.map((c) => c.getBoundingClientRect().width)),
            derivedLines: Math.round(derived.getBoundingClientRect().height / Number.parseFloat(cs.lineHeight || '16')),
            ellipsis: cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap',
            mono: cs.fontFamily.toLowerCase().includes('mono'),
          };
        });
        expect(nm.hues).toBe(6);
        expect(nm.rows, 'the six swatches sit in one row').toBe(1);
        expect(nm.narrowest, 'each swatch cell is at least 44px').toBeGreaterThanOrEqual(44);
        expect(nm.ellipsis, 'the derived folder line ellipsises').toBe(true);
        expect(nm.derivedLines, 'the derived folder line is one line').toBeLessThanOrEqual(1);
        expect(nm.mono).toBe(true);
        await step(page, 'name frame');

        // Method: Paste selected; Mint and Sign in narrowed in place, in the table's order.
        await page.click('[data-frame="name"] button.btn-primary');
        await page.waitForSelector('[data-frame="method"]');
        const m = await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>('input[name="acct-method"]')]
          .map((r) => ({ value: r.value, checked: r.checked, disabled: r.disabled })));
        // The order is read from the table, never restated here: Mint first since accounts plan Task A20 (Q1).
        const table: readonly string[] = PROVIDERS.anthropic.connect;
        expect(m.map((r) => r.value), 'the radio follows the provider table').toEqual([...table]);
        expect(m.find((r) => r.value === 'paste')).toEqual({ value: 'paste', checked: true, disabled: false });
        expect(m.filter((r) => r.disabled).map((r) => r.value)).toEqual(table.filter((v) => v !== 'paste'));
        await step(page, 'method frame');

        // A refused paste: the sentence, and the field empty.
        const token = 'sk-ant-oat01-' + 'Z'.repeat(60);
        await page.fill('.acct-secret input', token);
        await page.click('[data-frame="method"] button.btn-primary');
        await page.waitForSelector('.acct-notice');
        const refused = await page.evaluate(() => ({
          notice: document.querySelector('[data-frame="method"] .acct-notice')?.textContent ?? '',
          field: document.querySelector<HTMLInputElement>('.acct-secret input')?.value ?? null,
        }));
        expect(refused.notice).toBe('That token was refused (HTTP 401). Nothing was saved.');
        expect(refused.field, 'a refused paste re-presents an empty field').toBe('');
        await step(page, 'refused paste');

        // The result.
        add.accept();
        await page.fill('.acct-secret input', token);
        await page.click('[data-frame="method"] button.btn-primary');
        await page.waitForSelector('[data-frame="result"]', { timeout: 30_000 });
        const r = await page.evaluate(() => ({
          turnOn: [...document.querySelectorAll('[data-frame="result"] button')].some((b) => b.textContent === 'Turn it on'),
          ledger: document.querySelectorAll('.acct-ledger > li').length,
          inPage: document.documentElement.outerHTML.includes('ZZZZZZZZZZ'),
        }));
        expect(r.turnOn).toBe(true);
        expect(r.ledger).toBeGreaterThanOrEqual(2);
        expect(r.inPage, 'the pasted token is in no DOM node').toBe(false);
        await step(page, 'result frame');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

// ---- the offline row ------------------------------------------------------------------------------------------------

const OFFLINE_VIEWS: AppView[] = SKINS.flatMap((skin) => [360, 1280].map((width) => ({ skin, theme: PHOSPHOR, width })));
/** The one sentence and its read-line (`offlineRefusal`). */
const OFFLINE_READ = /^You're offline: nothing was sent\. Read \d+m ago\.$/;
const OFFLINE_NEVER = "You're offline: nothing was sent. Nothing has been read from the server since this page opened.";
/** The box as before, each lane last checked two minutes ago, so its source counts on from the page's clock. */
const CHECKED = { state: { word: 'signed-in', source: 'checked 2m ago', at: now - 120_000 }, ready: true };
const OFFLINE_FIXTURE: AppFixture = {
  ...FIXTURE,
  api: { ...FIXTURE.api, '/api/accounts': { ...ACCOUNTS, lanes: { 'lane-a': CHECKED, 'lane-b': CHECKED } } },
};

/** Hold the shell on its offline reading for the read that follows (accounts-cards.browser.test.ts's `holdOffline`:
 *  the page's clock is paused so no backoff rung's attempt lands in the read, and the hold waits for the store's
 *  `down`). The caller resumes the clock. */
const holdOffline = async (page: Page): Promise<void> => {
  const at = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(at + 1_000);
  await page.waitForFunction(() => document.querySelector('.fleet')?.getAttribute('data-conn') === 'down', undefined,
    { polling: 50, timeout: 10_000 });
};

/** What an offline cell reads off the page: the door and its reason, each card's ages and switch, the sheet's notice
 *  and primary, and every field drawn. */
const readOffline = (page: Page): Promise<{
  door: { disabled: string | null; reason: string };
  cards: { lane: string | undefined; source: string; usage: string; switchDisabled: boolean; reason: string; checks: number }[];
  sheet: { offline: string; primaryDisabled: boolean | null; secret: number } | null;
  fields: number;
  docOverflow: number;
}> => page.evaluate(() => {
  const door = document.querySelector<HTMLElement>('.acct-door, .acct-door-action')!;
  const panel = document.querySelector<HTMLElement>('.sheet-panel');
  const primary = panel?.querySelector<HTMLButtonElement>('[data-frame="method"] button.btn-primary') ?? null;
  return {
    door: {
      disabled: door.getAttribute('aria-disabled'),
      reason: document.getElementById(door.getAttribute('aria-describedby') ?? '')?.textContent ?? '',
    },
    cards: [...document.querySelectorAll<HTMLElement>('.accounts-row')].map((c) => ({
      lane: c.dataset['lane'],
      source: c.querySelector('.accounts-state-source')?.textContent ?? '',
      usage: c.querySelector('.accounts-fresh')?.textContent ?? '',
      switchDisabled: c.querySelector<HTMLButtonElement>('.acct-switch')?.disabled ?? false,
      reason: c.querySelector('.acct-knob-reason')?.textContent ?? '',
      checks: c.querySelectorAll('.acct-check').length,
    })),
    sheet: panel === null ? null : {
      offline: panel.querySelector('.acct-offline')?.textContent ?? '',
      primaryDisabled: primary === null ? null : primary.disabled,
      secret: panel.querySelectorAll('.acct-secret').length,
    },
    // Any text field on the page: the sheet's radios are choices, not fields.
    fields: document.querySelectorAll('input:not([type="radio"]):not([type="checkbox"]), textarea').length,
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

describe('the Add account door and the connect sheet offline, one cell per skin at 360 and 1280, dark (D-7740 (8); spec §12.5)', () => {
  for (const view of OFFLINE_VIEWS) {
    it(named(view), async () => {
      // Warm: the link drops with the sheet open and a token typed.
      const warm = await openApp(browser!, view, OFFLINE_FIXTURE);
      try {
        await warm.page.clock.install({ time: now });
        await warm.page.goto(server!.origin + '/');
        await go(warm.page, '/accounts');
        await warm.page.waitForSelector('.accounts-row[data-lane="lane-b"]', { timeout: 30_000 });
        await warm.page.click('.acct-door, .acct-door-action');
        await warm.page.waitForSelector('[data-frame="provider"]');
        await warm.page.click('[data-frame="provider"] button.opt');
        await warm.page.waitForSelector('[data-frame="name"]');
        await warm.page.fill('[data-frame="name"] input.font-mono', 'lane-c');
        await warm.page.fill('[data-frame="name"] .acct-field:nth-of-type(2) input', 'Lane C');
        await warm.page.click('[data-frame="name"] button.btn-primary');
        await warm.page.waitForSelector('[data-frame="method"] .acct-secret input');
        const token = 'sk-ant-oat01-' + 'Y'.repeat(60);
        await warm.page.fill('.acct-secret input', token);
        warm.cut();
        // Four minutes with the link down, so the read-line and every age have moved on.
        await warm.page.clock.fastForward(4 * 60_000);
        await warm.page.waitForTimeout(1_000);
        await holdOffline(warm.page);
        const m = await readOffline(warm.page);
        const leaked = await warm.page.evaluate(() => document.documentElement.outerHTML.includes('YYYYYYYYYY'));
        const f = await frame(warm.page);
        await warm.page.clock.resume();
        expect([f.skin, f.theme], 'the cell draws the skin and theme it names').toEqual([view.skin, view.theme]);
        expect(m.door.disabled, 'the door narrows in place').toBe('true');
        expect(m.door.reason).toMatch(OFFLINE_READ);
        // The screen keeps the last answer, each age on its own clock.
        expect(m.cards.map((c) => c.lane)).toEqual(['lane-a', 'lane-b']);
        for (const c of m.cards) {
          expect(c.source, `${c.lane}: the state's source keeps counting`).toBe('checked 6m ago');
          expect(c.usage, `${c.lane}: the usage reading keeps its age`).toMatch(/^last reported \d+m ago$/);
          expect(c.switchDisabled, `${c.lane}: the switch is refused`).toBe(true);
          expect(c.reason, `${c.lane}: with the sentence and the read-line`).toMatch(OFFLINE_READ);
          expect(c.checks, `${c.lane}: no Check is offered`).toBe(0);
        }
        // The sheet: the sentence, its primary refused, and no secret field (its value went with its node).
        expect(m.sheet).not.toBeNull();
        expect(m.sheet!.offline).toMatch(OFFLINE_READ);
        expect(m.sheet!.primaryDisabled, "the frame's primary is refused").toBe(true);
        expect(m.sheet!.secret, 'no secret field offline').toBe(0);
        expect(m.fields, 'no field on the page').toBe(0);
        expect(leaked, 'the typed token is in no DOM node').toBe(false);
        expect(m.docOverflow).toBeLessThanOrEqual(0);
        expect(f.sheetOverflow).toBeLessThanOrEqual(1);
        expect(warm.errors).toEqual([]);
      } finally {
        await warm.ctx.close();
      }

      // Cold: a start with no link, from the offline snapshot (sessions and the roster, never `lanes`, G15).
      const cold = await openApp(browser!, view, OFFLINE_FIXTURE);
      try {
        const snapshot = {
          savedAt: now - 600_000, sessions: [fleetSession({ id: 'demo-quiet-basin', project: 'demo', wrapper: 'lane-a' })],
          roster: ROSTER,
        };
        await cold.ctx.addInitScript((snap) => { localStorage.setItem('ccrc.fleet-snapshot.v1', snap); }, JSON.stringify(snapshot));
        cold.cut();
        await cold.page.clock.install({ time: now });
        await cold.page.goto(server!.origin + '/');
        // The snapshot was read: the fleet counts its one session.
        await cold.page.getByText('1 session', { exact: true }).first().waitFor({ timeout: 30_000 });
        await go(cold.page, '/accounts');
        await cold.page.waitForSelector('.acct-door, .acct-door-action', { timeout: 30_000 });
        await cold.page.waitForTimeout(1_500);
        await holdOffline(cold.page);
        const m = await readOffline(cold.page);
        await cold.page.clock.resume();
        expect(m.door.disabled).toBe('true');
        expect(m.door.reason, 'the sentence, and the read-line of a page that has read nothing').toBe(OFFLINE_NEVER);
        // No usage answer has landed, so the list is the count-free placeholder (accounts-cards' cold cell): no card,
        // and so no switch or Check, is drawn on what the snapshot cannot say.
        expect(m.cards.filter((c) => c.lane !== undefined), 'no card it cannot read').toEqual([]);
        expect(await cold.page.locator('.acct-switch, .acct-check').count(), 'no switch or Check is offered').toBe(0);
        expect(m.fields, 'no field on the page').toBe(0);
        expect(m.docOverflow).toBeLessThanOrEqual(0);
        // `aria-disabled` reads as not enabled to Playwright's own checks, so the tap is forced: the door must ignore it.
        await cold.page.click('.acct-door, .acct-door-action', { force: true });
        await cold.page.waitForTimeout(500);
        expect(await cold.page.locator('.sheet-panel').count(), 'a tap on the refused door opens nothing').toBe(0);
        expect(cold.errors).toEqual([]);
      } finally {
        await cold.ctx.close();
      }
    }, 90_000);
  }
});
