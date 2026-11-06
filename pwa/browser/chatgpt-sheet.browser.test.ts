// The ChatGPT device-code sheet at every width (accounts plan Task A25 Step 4, D-8051; spec 2026-10-18 accounts-connect
// §7.2, §12.1–§12.4). Sixteen cells: phone 360 and 390, laptop 1280 and wide 1920, both skins, dark and light, in a real
// Chrome over the production build, with no fleet behind it: the routes are answered by the fixture below.
//
// Each cell walks the add and reads, at every step: the skin and theme drawn are the ones the cell names, and nothing
// scrolls sideways (the page, or the sheet).
//  - The frame with nothing to choose: the models line, and no radio.
//  - The code well: the code at 24px, mono, on one line, unclipped, its Copy on the same row, inside the sheet.
//  - The primaries swap: below 900, Copy link is the primary and full width; at ≥900, Open is a 52px primary with the
//    server's host in mono beside it.
//  - The waiting line: "… waiting for you to approve" pulses, and the countdown is amber.
//  - The ending (Cancel) offers Start again and Discard, with no link and no code on screen.
//  - The result frame after `done`: the lane is still Off, as a new lane is on the real wire, it says it is signed in with
//    ChatGPT from its check, with Turn it on, the compromise disclosure, and no wrong-account act.
//
// The fake box takes the add through the real argv builder, so a body the verb's list refuses is refused here too.
//
// Then Sign in again, in its own sixteen cells (spec §9 row 5): a Signed-out Codex lane's card holds it as the primary at
// the tap floor, the sheet shows the same card, and the ending lists the lane's session with Restart beside the
// disclosure. Each of those cells goes on to Remove, whose folder line is on, at its skin's row height, inside the sheet.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';
import { buildAccountArgv } from '../../shared/account-argv';
import { stateWordFor } from '../../shared/accounts';

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
const rostered = (id: string, hue: string, provider = 'anthropic', kind = 'token'): Record<string, unknown> => ({
  id, label: id, hue, homeAble: true, hidden: false, pool: null, provider, kind, ...(kind === 'codex' ? { managed: true } : {}),
});
const CHECK = { verdict: 'ok', at: now };
const READY = { state: { word: 'signed-in', source: 'checked just now', at: now }, check: CHECK, ready: true };
/** A new lane after its passing check, the word from the real derivation: a disabled lane is Off first, whatever its
 *  check found, so nothing here can show a state the wire can't. */
const CHECKED = {
  state: stateWordFor({ disabled: true, authDead: false, five: null, seven: 12, provider: 'openai', kind: 'codex', lane: { kind: 'read', state: { check: CHECK } }, now }),
  check: CHECK, ready: true,
};
const OFF = { state: { word: 'off', source: 'Off on the fleet host' }, ready: false, notReadyReason: 'not-checked' };
const ROSTER = [rostered('lane-a', 'cyan'), rostered('lane-b', 'violet')];
const ACCOUNTS = {
  accounts: [acct('lane-a'), acct('lane-b')],
  projected: { wrapper: 'lane-a', score: 12 },
  roster: ROSTER,
  lanes: { 'lane-a': READY, 'lane-b': READY },
  connect: {
    accountOps: 'available', gate: 'armed', origin: 'https', caps: ['account-v2', 'account-auth-v1', 'account-codex-v1'], stepUpFreshUntil: now + 3_600_000,
  },
};
const ID = 'lane-g';
const ATTEMPT = 'c'.repeat(32);
const HOST = 'auth.example.invalid';
const URL = `https://${HOST}/codex/device`;
// The widest code the shape allows: eight full-width glyphs and the hyphen.
const CODE = 'WWWW-WWWW';
const FIXTURE: AppFixture = {
  api: { '/api/feed': { events: [] }, '/api/accounts': ACCOUNTS },
  fleetFrames: [{ type: 'fleet', sessions: [] }],
};

const OLD = 'lane-h';
const OUT = { state: { word: 'signed-out', source: 'Signed out · HTTP 401 · checked 2h ago', at: now - 7_200_000 }, ready: false, notReadyReason: 'check-failed' };
const LIVE = fleetSession({ id: `${OLD}:p-one`, wrapper: OLD, home: OLD, project: 'p-one', title: 'one with a long session title' });
const REAUTH_FIXTURE: AppFixture = {
  api: {
    '/api/feed': { events: [] },
    '/api/accounts': {
      ...ACCOUNTS,
      accounts: [acct('lane-a'), acct('lane-b'), { ...acct(OLD), five: null, authDead: true }],
      roster: [...ROSTER, rostered(OLD, 'blue', 'openai', 'codex')],
      lanes: { ...ACCOUNTS.lanes, [OLD]: OUT },
    },
  },
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

/** The fake box: the add, the attempt, its status, the cancel and the check. `box.phase` moves the attempt on. */
async function routes(ctx: BrowserContext, id = ID): Promise<{ phase: 'starting' | 'url' | 'done' }> {
  const box: { phase: 'starting' | 'url' | 'done' } = { phase: 'starting' };
  const expiresAt = Date.now() + 7 * 60_000 + 30_000;
  const json = (body: unknown): { status: number; contentType: string; body: string } =>
    ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await ctx.route('**/api/accounts', async (route) => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    const { id: lane, ...fields } = route.request().postDataJSON() as Record<string, unknown>;
    if (!buildAccountArgv('add', lane, fields, false).ok) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'bad-request' }) });
      return;
    }
    await route.fulfill(json({ ok: true, roster: [...ROSTER, rostered(ID, 'blue', 'openai', 'codex')], lane: OFF, fleetIdentity: null }));
  });
  await ctx.route(`**/api/accounts/${id}/**`, async (route) => {
    const p = new globalThis.URL(route.request().url()).pathname;
    if (p.endsWith('/auth/start')) { box.phase = 'url'; await route.fulfill(json({ ok: true, attemptId: ATTEMPT, expiresAt })); return; }
    if (p.endsWith('/auth/cancel')) { box.phase = 'starting'; await route.fulfill(json({ ok: true })); return; }
    if (p.endsWith('/auth')) {
      await route.fulfill(json(box.phase === 'url'
        ? { ok: true, state: 'url', url: URL, host: HOST, userCode: CODE, updatedAt: Date.now(), expiresAt }
        : { ok: true, state: box.phase, updatedAt: Date.now(), expiresAt }));
      return;
    }
    if (p.endsWith('/check')) { await route.fulfill(json({ ok: true, lane: id === ID ? CHECKED : READY })); return; }
    if (p.endsWith('/remove')) {
      await route.fulfill(json({
        ok: true, fleetIdentity: null,
        check: { live: 0, sleeping: [], archived: 0, upstream: false, otherHomeAble: 1, authInProgress: false, discardable: false, at: Date.now() },
      }));
      return;
    }
    await route.fallback();
  });
  return box;
}

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

describe('the ChatGPT device-code sheet at every width and skin (D-8051)', () => {
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
        const box = await routes(ctx);
        await page.goto(server!.origin + '/');
        await go(page, '/accounts');
        await page.waitForSelector('.accounts-row[data-lane="lane-b"]', { timeout: 30_000 });

        // Provider → Name it → the frame with nothing to choose.
        await page.click('.acct-door, .acct-door-action');
        await page.waitForSelector('[data-frame="provider"]');
        await page.click('[data-frame="provider"] button.opt:has-text("OpenAI")');
        await page.waitForSelector('[data-frame="name"]');
        await page.fill('[data-frame="name"] input.font-mono', ID);
        await page.fill('[data-frame="name"] .acct-field:nth-of-type(2) input', 'Lane G');
        await page.click('[data-frame="name"] button.btn-primary');
        await page.waitForSelector('[data-frame="method"]');
        expect(await page.locator('input[name="acct-method"]').count(), 'OpenAI has no radio').toBe(0);
        expect(await page.textContent('[data-frame="method"]')).toContain('Models: luna, terra and sol from your ChatGPT plan.');
        await step(page, 'the models frame');

        // The device-code card.
        await page.click('[data-frame="method"] button.btn-primary');
        await page.waitForSelector('.acct-device-code', { timeout: 30_000 });
        const well = await page.evaluate(() => {
          const code = document.querySelector<HTMLElement>('.acct-device-code')!;
          const copy = document.querySelector<HTMLElement>('.acct-device-copy')!;
          const panel = document.querySelector<HTMLElement>('.sheet-panel')!.getBoundingClientRect();
          const c = code.getBoundingClientRect();
          const b = copy.getBoundingClientRect();
          const s = getComputedStyle(code);
          return {
            font: Number.parseFloat(s.fontSize), mono: s.fontFamily.toLowerCase().includes('mono'), track: s.letterSpacing, wrap: s.whiteSpace,
            lines: code.getClientRects().length, clipped: code.scrollWidth > code.clientWidth + 1 && s.display !== 'inline',
            width: c.width, inside: c.left >= panel.left && c.right <= panel.right && b.right <= panel.right,
            sameRow: b.top < c.bottom && b.bottom > c.top,
            noOverlap: b.left >= c.right - 1,
          };
        });
        expect(well.font, 'the code is 24px').toBe(24);
        expect(well.mono).toBe(true);
        expect(Number.parseFloat(well.track), 'it carries the caps tracking').toBeGreaterThan(1.9);
        expect(well.wrap).toBe('nowrap');
        expect(well.lines, 'the code never wraps').toBe(1);
        expect(well.clipped, 'the code is not clipped').toBe(false);
        expect(well.width, 'nine glyphs fit the 296px a 360 phone leaves').toBeLessThanOrEqual(296);
        expect(well.inside, 'the code and its Copy stay inside the sheet').toBe(true);
        expect(well.sameRow, 'the Copy sits on the code\'s row').toBe(true);
        expect(well.noOverlap, 'the Copy does not sit on the code').toBe(true);

        const card = await page.evaluate(() => {
          const c = document.querySelector<HTMLElement>('.acct-url-card')!.getBoundingClientRect();
          const copy = [...document.querySelectorAll<HTMLButtonElement>('.acct-url-card button')].find((b) => b.textContent === 'Copy link')!;
          const open = document.querySelector<HTMLAnchorElement>('.acct-url-card a[href]')!;
          const host = document.querySelector<HTMLElement>('.acct-url-acts .acct-url-host');
          const o = open.getBoundingClientRect();
          const h = host?.getBoundingClientRect();
          return {
            copyPrimary: copy.classList.contains('btn-primary'), openPrimary: open.classList.contains('btn-primary'),
            copyWidth: copy.getBoundingClientRect().width, cardWidth: c.width, openHeight: o.height, openText: open.textContent ?? '',
            rel: open.rel, target: open.target, hostText: host?.textContent ?? null,
            hostBeside: h === undefined ? false : h.left >= o.right - 1 && h.top < o.bottom && h.bottom > o.top,
            codeField: document.querySelector('.acct-code') !== null,
          };
        });
        expect(card.rel).toBe('noopener noreferrer');
        expect(card.target).toBe('_blank');
        expect(card.codeField, 'a device sign-in has no code field').toBe(false);
        if (desk) {
          expect(card.openPrimary, 'at ≥900 Open is the primary').toBe(true);
          expect(card.openText).toContain('Open the ChatGPT sign-in page');
          expect(card.copyPrimary).toBe(false);
          expect(card.openHeight, 'the Open primary is 52px').toBeGreaterThanOrEqual(52);
          expect(card.hostText, "the host beside it is the server's").toBe(HOST);
          expect(card.hostBeside, 'the mono host sits beside Open').toBe(true);
        } else {
          expect(card.copyPrimary, 'on a phone Copy link is the primary').toBe(true);
          expect(card.openPrimary).toBe(false);
          expect(card.copyWidth, 'Copy link takes the full width').toBeGreaterThanOrEqual(card.cardWidth - 1);
        }

        // The waiting ledger line pulses; the countdown is amber.
        const amber = await page.evaluate(() => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--status-attention-text)';
          document.querySelector('.sheet-panel')!.appendChild(probe);
          const want = getComputedStyle(probe).color;
          probe.remove();
          const cd = document.querySelector<HTMLElement>('.acct-countdown')!;
          const li = document.querySelector<HTMLElement>('.acct-ledger > li[data-wait="true"]');
          const dot = li?.querySelector<HTMLElement>('.acct-ledger-dot') ?? null;
          return {
            same: getComputedStyle(cd).color === want, line: li?.textContent ?? '',
            pulse: dot === null ? '' : getComputedStyle(dot).animationName,
          };
        });
        expect(amber.same, 'the countdown is amber while it waits on the operator').toBe(true);
        expect(amber.line).toContain('… waiting for you to approve');
        expect(amber.pulse, 'the waiting line pulses').not.toBe('');
        expect(amber.pulse).not.toBe('none');
        await step(page, 'the device-code card');

        // An ending: Cancel leaves no link and no code on screen.
        await page.click('.acct-connect button:text-is("Cancel")');
        await page.waitForSelector('.acct-connect button:text-is("Start the sign-in again")');
        const t = await page.evaluate((code) => ({
          discard: [...document.querySelectorAll('.acct-connect button')].some((b) => b.textContent === 'Discard this lane'),
          link: document.querySelectorAll('.acct-connect a[href]').length,
          code: document.querySelector('.acct-connect')!.textContent!.includes(code),
        }), CODE);
        expect(t).toEqual({ discard: true, link: 0, code: false });
        await step(page, 'the ending');

        // Start again, approve, done: the result frame.
        await page.click('.acct-connect button:text-is("Start the sign-in again")');
        await page.waitForSelector('.acct-device-code', { timeout: 30_000 });
        box.phase = 'done';
        await page.waitForSelector('[data-frame="result"]', { timeout: 30_000 });
        const r = await page.evaluate(() => ({
          turnOn: [...document.querySelectorAll('[data-frame="result"] button')].some((b) => b.textContent === 'Turn it on'),
          wrong: [...document.querySelectorAll('[data-frame="result"] button')].some((b) => b.textContent === 'Sign this lane out and start again'),
          compromise: document.querySelector('.acct-compromise') !== null,
          line: document.querySelector('[data-frame="result"]')!.textContent ?? '',
          word: document.querySelector('[data-frame="result"] .acct-result-word')!.getAttribute('data-state'),
        }));
        expect(r.turnOn).toBe(true);
        expect(r.wrong, 'a Codex lane has no sign-out act').toBe(false);
        expect(r.compromise).toBe(true);
        expect(r.word, 'a new lane is off until it is turned on').toBe('off');
        expect(r.line).toContain('Signed in with ChatGPT');
        await step(page, 'the result frame');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 120_000);
  }
});

describe('Sign in again on a Codex lane, and its Remove line, at every width and skin (D-8051)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const step = async (page: Page, what: string): Promise<void> => {
        const f = await frame(page);
        expect([f.skin, f.theme], `${what}: the cell draws the skin and theme it names`).toEqual([view.skin, view.theme]);
        expect(f.docOverflow, `${what}: no horizontal page scroll`).toBeLessThanOrEqual(0);
        expect(f.sheetOverflow, `${what}: nothing scrolls sideways in the sheet`).toBeLessThanOrEqual(1);
      };
      const { ctx, page, errors } = await openApp(browser!, view, REAUTH_FIXTURE);
      try {
        const box = await routes(ctx, OLD);
        await page.goto(server!.origin + '/');
        await go(page, '/accounts');
        const acts = `.accounts-row[data-lane="${OLD}"] .acct-trouble-acts`;
        await page.waitForSelector(acts, { timeout: 30_000 });
        const primary = await page.evaluate((sel) => [...document.querySelectorAll<HTMLButtonElement>(`${sel} button`)]
          .map((b) => ({ text: b.textContent, primary: b.classList.contains('btn-primary'), height: b.getBoundingClientRect().height })), acts);
        expect(primary.map((a) => [a.text, a.primary])).toEqual([['Sign in again', true]]);
        expect(primary[0]!.height, 'at the tap floor').toBeGreaterThanOrEqual(43.5);
        await step(page, 'the trouble card');

        await page.locator(acts).getByRole('button', { name: 'Sign in again' }).click();
        await page.waitForSelector('[data-frame="reauth"]');
        await step(page, 'the confirm frame');
        await page.click('[data-frame="reauth"] button.btn-primary');
        await page.waitForSelector('.acct-device-code', { timeout: 30_000 });
        await step(page, 'the device-code card');

        box.phase = 'done';
        await page.waitForSelector('[data-frame="reauthed"]', { timeout: 30_000 });
        await page.waitForSelector('[data-frame="reauthed"] button:text-is("Restart")', { timeout: 30_000 });
        const end = await page.evaluate(() => {
          const root = document.querySelector<HTMLElement>('[data-frame="reauthed"]')!;
          const restart = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Restart')!;
          return { restart: restart.getBoundingClientRect().height, compromise: root.querySelector('.acct-compromise') !== null, text: root.textContent ?? '', revoke: root.querySelector('.acct-revoke') !== null };
        });
        expect(end.restart, 'Restart at the tap floor').toBeGreaterThanOrEqual(43.5);
        expect(end.compromise).toBe(true);
        expect(end.revoke, 'a sign-in has no token to revoke').toBe(false);
        expect(end.text).toContain('Signed in with ChatGPT');
        expect(end.text).toContain("This lane's gateway reloads the new sign-in itself");
        await step(page, 'the ending');
        await page.click('[data-frame="reauthed"] button:text-is("Done")');

        // Remove: the folder line, on, above the typed confirm.
        await page.locator(`.accounts-row[data-lane="${OLD}"] .acct-fold`).getByRole('button', { name: 'Remove…' }).click();
        await page.waitForSelector('[data-codex-folder="true"]', { timeout: 30_000 });
        const line = await page.evaluate(() => {
          const row = document.querySelector<HTMLElement>('[data-codex-folder="true"] [role="checkbox"]')!;
          const panel = document.querySelector<HTMLElement>('.sheet-panel')!.getBoundingClientRect();
          const r = row.getBoundingClientRect();
          return { checked: row.getAttribute('aria-checked'), height: r.height, rowHeight: Number.parseFloat(getComputedStyle(row).minHeight), inside: r.left >= panel.left && r.right <= panel.right, text: row.textContent ?? '' };
        });
        expect(line.checked).toBe('true');
        expect(line.height, "the option row at its skin's own height").toBeGreaterThanOrEqual(line.rowHeight - 0.5);
        expect(line.inside).toBe(true);
        expect(line.text).toContain("Delete this lane's ChatGPT sign-in folder");
        await step(page, 'the remove sheet');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 120_000);
  }
});
