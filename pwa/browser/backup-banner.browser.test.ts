// The backup banner and Settings' quiet Backups line, in a real Chrome over the production build (D-7860). jsdom lays
// nothing out, so `test/backup-banner.test.tsx` holds the words, the predicate and the markup, and this file holds what
// the operator's every-width rule asks: at 360, 390, 1280 and 1920, in Refined and Instrument, in the dark and the light
// theme, a failed or stale block draws the banner once, inside the viewport, on at most two lines; a healthy block and a
// box without backups draw none; and the Settings line sits inside its card with nothing scrolling sideways.
// Neutral names only; the times are relative to the run.
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/backup-banner.browser.test.ts )`.
// `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { backupVerdict, type BackupHealth, type BackupRead } from '../../shared/backup';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const SKINS = [REFINED, INSTRUMENT] as const;
const THEMES = [PHOSPHOR, 'light'] as const;
const WIDTHS = [360, 390, 1280, 1920] as const;
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const H = 3_600_000;
const NOW = Date.now();
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const judged = (r: BackupRead): BackupHealth => backupVerdict(r, NOW, NOW, 36);
type Case = 'failed' | 'stale' | 'ok' | 'not-configured';
const BLOCKS: Record<Case, BackupHealth> = {
  failed: judged({ state: 'read', files: { 'last-success': iso(NOW - 25 * H), 'last-failure': `${iso(NOW - H)} mode=backup exit=2 step-a` } }),
  stale: judged({ state: 'read', files: { 'last-success': iso(NOW - 40 * H) } }),
  ok: judged({ state: 'read', files: { 'last-success': iso(NOW - 5 * H) } }),
  'not-configured': judged({ state: 'not-configured' }),
};
const fixture = (c: Case): AppFixture => ({
  api: {
    '/api/fleet/health': { mode: 'remote', connected: true, downSince: null, backup: BLOCKS[c] },
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': [],
    '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: [] }, { type: 'coord', coord: { pause: 'clear' } }],
});

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

describe('the backup banner: failed and stale fit at every width, skin and theme (D-7860)', () => {
  for (const c of ['failed', 'stale'] as const) {
    for (const view of VIEWS) {
      it(`${c}: ${named(view)}`, async () => {
        const { ctx, page, errors } = await openApp(browser!, view, fixture(c));
        try {
          await page.goto(server!.origin + '/');
          await page.waitForSelector('[data-banner="backup"] [role="status"]', { timeout: 20_000 });
          const m = await page.evaluate(() => {
            const banners = [...document.querySelectorAll<HTMLElement>('[data-banner="backup"] [role="status"]')]
              .filter((el) => el.getClientRects().length > 0);
            const el = banners[0]!;
            const r = el.getBoundingClientRect();
            const msg = el.querySelector<HTMLElement>('.banner-msg')!;
            const lineHeight = parseFloat(getComputedStyle(msg).lineHeight);
            return {
              drawn: banners.length, text: msg.textContent ?? '',
              left: r.left, right: r.right, vw: document.documentElement.clientWidth,
              lines: Math.round(msg.getBoundingClientRect().height / lineHeight),
              overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              msgOver: msg.scrollWidth - msg.clientWidth,
            };
          });
          const shots = process.env.CCRC_SHOTS;
          if (shots) await page.screenshot({ path: path.join(shots, `backup-${c}-${view.skin}-${view.theme}-${view.width}.png`) });
          expect(m.drawn).toBe(1);
          if (c === 'stale') expect(m.text).toBe('No successful backup for 40 h');
          else expect(m.text).toMatch(/^Backup failed at \d{2}:\d{2}( · \d+ \w+)? \(exit 2\)$/);
          expect(m.left).toBeGreaterThanOrEqual(0);
          expect(m.right).toBeLessThanOrEqual(m.vw);
          expect(m.overflow).toBeLessThanOrEqual(0);
          expect(m.msgOver).toBeLessThanOrEqual(0);
          expect(m.lines).toBeLessThanOrEqual(2);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }
});

describe('a healthy backup and a box without backups draw no banner (D-7860)', () => {
  for (const c of ['ok', 'not-configured'] as const) {
    for (const width of [390, 1280] as const) {
      const view: AppView = { skin: width === 390 ? REFINED : INSTRUMENT, theme: PHOSPHOR, width };
      it(`${c}: ${named(view)}`, async () => {
        const { ctx, page, errors } = await openApp(browser!, view, fixture(c));
        try {
          // The health poll's answer is the evidence: the banner is judged after it landed, never before.
          const landed = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/fleet/health', { timeout: 20_000 });
          await page.goto(server!.origin + '/');
          await landed;
          await page.waitForTimeout(500);
          expect(await page.locator('[data-banner="backup"] [role="status"]').count()).toBe(0);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }
});

describe('Settings › Automation › Backups: the quiet line fits at every width, skin and theme (D-7860)', () => {
  const LINES: Record<Case, RegExp> = {
    ok: /^Last backup 5 h ago$/, 'not-configured': /^Backups not configured$/,
    stale: /^No successful backup for 40 h$/, failed: /^Backup failed at /,
  };
  for (const c of ['ok', 'not-configured', 'stale'] as const) {
    for (const view of VIEWS) {
      it(`${c}: ${named(view)}`, async () => {
        const { ctx, page, errors } = await openApp(browser!, view, fixture(c));
        try {
          await page.goto(server!.origin + '/settings/automation');
          const section = page.getByRole('region', { name: SETTINGS_CARDS.automation.backup.title });
          const line = section.locator('[data-backup-line]');
          await expect.poll(async () => (await line.textContent()) ?? '', { timeout: 20_000 }).toMatch(LINES[c]);
          const m = await section.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const ln = el.querySelector('[data-backup-line]')!.getBoundingClientRect();
            const detail = document.querySelector('.shell-detail');
            return {
              vw: window.innerWidth, left: r.left, right: r.right, lineLeft: ln.left, lineRight: ln.right,
              sectionOver: el.scrollWidth - el.clientWidth,
              detailOver: detail === null ? 0 : detail.scrollWidth - detail.clientWidth,
              pageOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
          });
          const shots = process.env.CCRC_SHOTS;
          if (shots) await section.screenshot({ path: path.join(shots, `backup-settings-${c}-${view.skin}-${view.theme}-${view.width}.png`) });
          expect(m.left).toBeGreaterThanOrEqual(0);
          expect(m.right).toBeLessThanOrEqual(m.vw);
          expect(m.lineLeft).toBeGreaterThanOrEqual(m.left - 0.5);
          expect(m.lineRight).toBeLessThanOrEqual(m.right + 0.5);
          expect(m.sectionOver).toBeLessThanOrEqual(0);
          expect(m.detailOver).toBeLessThanOrEqual(0);
          expect(m.pageOver).toBeLessThanOrEqual(0);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }
});
