// The Waiting on you row for a session on a usage limit that no account has room to take (D-8123, limit-swap-autofix Task 11),
// measured in a real Chrome over the production build. The jsdom suites (test/limit-wait-row.test.tsx, waiting-screen.test.tsx)
// pin the words and the requests; this file holds what they cannot, the per-width table: at a 390 phone, a 1280 laptop and a
// 1920 wide screen, in both skins and every palette, the page never scrolls sideways, throws no page error, both controls are
// drawn inside the row, the row's words and pills clear 4.5:1 on the ground they are drawn on, and "Swap to…" opens the swap
// sheet narrowed to the account with room.
//
// The fixture is two sessions on a limit (one still to choose, one that chose to wait) and two accounts: the one they are on is
// at its ceiling and `lane-b` has room. Names are neutral on purpose: the repository is public.
//
//   CCRC_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/limit-wait-row.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, REFINED, THEMES } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';

const NOW = Date.now();
const MIN = 60_000;
const RESET = NOW + 3 * 60 * MIN;

const stuck = (id: string, title: string, waiting: boolean): object => fleetSession({
  id, title, project: 'project-a', wrapper: 'lane-a', home: 'lane-a', workdir: `/w/project-a/${id}`, workspace: id,
  statusUpdatedAt: NOW - MIN, bucketSince: NOW - 12 * MIN, started: true,
  limitWait: { since: NOW - 12 * MIN, reset: RESET, account: 'lane-a', waiting },
});
const SESSIONS = [stuck('project-a-w1', 'Review worker', false), stuck('project-a-w2', 'Cleanup worker with a rather long title that must wrap on a phone', true)];

const usage = (wrapper: string, five: number, seven: number): object => ({
  wrapper, five, seven, ts: NOW / 1000, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false,
  disabled: false, authDead: false,
});
const ROSTER = [
  { id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false, pool: null },
  { id: 'lane-b', label: 'lane-b', hue: 'violet', homeAble: true, hidden: false, pool: null },
  { id: 'lane-c', label: 'lane-c', hue: 'magenta', homeAble: true, hidden: false, pool: null },
];
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [usage('lane-a', 100, 100), usage('lane-b', 20, 30), usage('lane-c', 99, 99)], projected: null, roster: ROSTER },
    '/api/runs': [], '/api/claims': [], '/api/waiting': { ok: true, waiting: { items: [], cleared: [], goals: [] } },
  },
  fleetFrames: [
    { type: 'fleet', sessions: SESSIONS }, { type: 'runs', runs: [] }, { type: 'waiting', waiting: { items: [], cleared: [], goals: [] } },
  ],
};

const SKINS = [REFINED, INSTRUMENT] as const;
const WIDTHS = [390, 1280, 1920] as const;
const PALETTES = THEMES.map((t) => t.id);

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

/** What the page measures, in the page: per row, whether every control sits inside the row's box, how wide it is drawn, and
 *  the contrast of each word on the ground it is drawn on. */
const measure = (): {
  rows: { session: string; inside: boolean; controls: string[]; widest: number; ratios: { what: string; ratio: number }[] }[];
} => {
  const rgb = (s: string): number[] => {
    const v = (s.match(/[\d.]+/g) ?? []).map(Number);
    return s.startsWith('color(') ? v.map((n) => n * 255) : v;
  };
  const lum = ([r, g, b]: number[]): number => {
    const ch = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * ch(r!) + 0.7152 * ch(g!) + 0.0722 * ch(b!);
  };
  const ratio = (el: Element): number => {
    const k = getComputedStyle(el);
    let bg = k.backgroundColor;
    for (let n: Element | null = el; n !== null && /rgba\(.*,\s*0\)$|transparent/.test(bg); n = n.parentElement) bg = getComputedStyle(n).backgroundColor;
    const [a, b] = [lum(rgb(k.color)), lum(rgb(bg))].sort((x, y) => y - x);
    return (a! + 0.05) / (b! + 0.05);
  };
  return {
    rows: [...document.querySelectorAll<HTMLElement>('[data-testid="limit-wait-row"]')].map((row) => {
      const box = row.getBoundingClientRect();
      const controls = [...row.querySelectorAll<HTMLElement>('.wl-limit-acts > *')];
      const words = [...row.querySelectorAll('.wl-what, .wl-why, .wl-meta > span:last-child, .wl-pill, [data-waiting-until]')];
      return {
        session: row.getAttribute('data-session') ?? '',
        inside: controls.every((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.left >= box.left - 0.5 && r.right <= box.right + 0.5; }),
        controls: controls.map((c) => c.textContent ?? ''),
        widest: Math.max(...controls.map((c) => c.getBoundingClientRect().width)),
        ratios: words.map((w) => ({ what: (w.textContent ?? '').slice(0, 40), ratio: ratio(w) })),
      };
    }),
  };
};

async function open(skin: string, theme: string, width: number) {
  const opened = await openApp(browser!, { skin, theme, width }, FIXTURE);
  await opened.page.goto(server!.origin + '/waiting');
  await opened.page.waitForSelector('[data-testid="limit-wait-row"]', { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(250); // the first paint's transitions settle
  return opened;
}

describe.each(SKINS)('the usage-limit row in %s', (skin) => {
  for (const theme of PALETTES) {
    for (const width of WIDTHS) {
      it(`at ${width} (${theme}): no sideways scroll, both controls inside the row, every word at 4.5:1`, async () => {
        const { ctx, page, errors } = await open(skin, theme, width);
        try {
          const shots = process.env['CCRC_SHOTS'];
          if (shots !== undefined && shots !== '') await page.screenshot({ path: `${shots}/limit-wait-${skin}-${theme}-${width}.png`, fullPage: true });
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'sideways scroll').toBe(0);
          const m = await page.evaluate(measure);
          expect(m.rows.map((r) => r.session)).toEqual(['project-a-w1', 'project-a-w2']);
          // The first row still has to choose: both controls. The second chose to wait: its wait control is words, and Swap to… stays.
          expect(m.rows[0]!.controls).toEqual(['Swap to…', expect.stringMatching(/^Wait until reset at \d{2}:\d{2}/)]);
          expect(m.rows[1]!.controls.length).toBe(2);
          expect(m.rows[1]!.controls[0]).toBe('Swap to…');
          expect(m.rows[1]!.controls[1]).toMatch(/^Waiting until \d{2}:\d{2}/);
          for (const r of m.rows) {
            expect(r.inside, `${r.session}: the controls sit inside the row`).toBe(true);
            for (const w of r.ratios) expect(w.ratio, `${r.session}: "${w.what}"`).toBeGreaterThanOrEqual(4.5);
          }
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }

  for (const width of WIDTHS) {
    it(`Swap to… at ${width}: the sheet offers only the account with room, and nothing scrolls sideways`, async () => {
      const { ctx, page, errors } = await open(skin, PALETTES[0]!, width);
      try {
        await page.locator('[data-session="project-a-w1"] button', { hasText: 'Swap to…' }).click();
        const sheet = page.getByRole('dialog');
        await sheet.waitFor({ timeout: 20_000 });
        const names = await sheet.getByRole('button').allTextContents();
        expect(names.some((n) => /lane-b/.test(n)), 'the account with room is offered').toBe(true);
        expect(names.some((n) => /lane-c/.test(n)), 'an account at 99 is not').toBe(false);
        expect(names.some((n) => /lane-a/.test(n)), 'the account it is stopped on is not').toBe(false);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'sideways scroll').toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
