// Settings › Automation › Work in transcript folders, in a real Chrome over the production build (D-7898). jsdom lays
// nothing out, so `test/transcript-work-card.test.tsx` holds the words and the markup, and this file holds what the
// operator's every-width rule asks: at 360, 390, 1280 and 1920, in Refined and Instrument, in the dark and the light
// theme, the line and the largest entries (one long token each) sit inside their card with nothing scrolling sideways.
// Neutral names only.
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/transcript-work-card.browser.test.ts )`.
// `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import type { DiskHealth, DiskTranscriptWork } from '../../shared/disk';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const SKINS = [REFINED, INSTRUMENT] as const;
const THEMES = [PHOSPHOR, 'light'] as const;
const WIDTHS = [360, 390, 1280, 1920] as const;
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
// A long slug, as Claude Code munges a deep workdir: one unbroken token the card must wrap.
const SLUG = '-home-user-worktrees-project-a-a-rather-long-workspace-name-for-a-wave';
type Case = 'warn' | 'none' | 'unmeasured';
const TW: Record<Case, DiskTranscriptWork> = {
  warn: {
    at: Date.now(), level: 'warn', entries: 7, bytes: 1.75 * GIB, top: [
      { name: `lane-a/${SLUG}/scratch-repo`, bytes: 1.25 * GIB },
      { name: `lane-a/${SLUG}/0b6c1d2e-3f40-4a51-8b62-7c83d94ea5f6/recovery-20261021`, bytes: 300 * MIB },
      { name: `lane-b/${SLUG}/build-out`, bytes: 90 * MIB },
      { name: `lane-b/${SLUG}/report.html`, bytes: 5 * MIB },
      { name: 'lane-b/-w-project-b/probe.txt', bytes: 88 },
    ],
  },
  none: { at: Date.now(), level: 'ok', entries: 0, bytes: 0, top: [] },
  unmeasured: { at: Date.now(), level: 'unmeasured', entries: 0, bytes: 0, top: [] },
};
const LINES: Record<Case, RegExp> = {
  warn: /^7 entries kept in transcript folders · 1\.7 GiB, over the warn bound$/,
  none: /^No work kept in transcript folders$/,
  unmeasured: /^Transcript folders unmeasured: the last count did not finish$/,
};
const disk = (c: Case): DiskHealth => ({ at: Date.now(), level: 'ok', filesystems: [], expectedMounts: [], pressure: false, holders: [], transcriptWork: TW[c] });
const fixture = (c: Case): AppFixture => ({
  api: {
    '/api/fleet/health': { mode: 'remote', connected: true, downSince: null, disk: disk(c) },
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

describe('Settings › Automation › Work in transcript folders fits at every width, skin and theme (D-7898)', () => {
  for (const c of ['warn', 'none', 'unmeasured'] as const) {
    for (const view of c === 'warn' ? VIEWS : VIEWS.filter((v) => v.theme === PHOSPHOR)) {
      it(`${c}: ${named(view)}`, async () => {
        const { ctx, page, errors } = await openApp(browser!, view, fixture(c));
        try {
          await page.goto(server!.origin + '/settings/automation');
          const section = page.getByRole('region', { name: SETTINGS_CARDS.automation.transcripts.title });
          const line = section.locator('[data-transcript-work-line]');
          await expect.poll(async () => (await line.textContent()) ?? '', { timeout: 20_000 }).toMatch(LINES[c]);
          const m = await section.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const items = [...el.querySelectorAll<HTMLElement>('[data-transcript-work-top] > li')].map((li) => {
              const b = li.getBoundingClientRect();
              return { left: b.left, right: b.right, over: li.scrollWidth - li.clientWidth, text: li.textContent ?? '' };
            });
            const detail = document.querySelector('.shell-detail');
            return {
              vw: window.innerWidth, left: r.left, right: r.right, items,
              sectionOver: el.scrollWidth - el.clientWidth,
              detailOver: detail === null ? 0 : detail.scrollWidth - detail.clientWidth,
              pageOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
          });
          const shots = process.env.CCRC_SHOTS;
          if (shots) await section.screenshot({ path: path.join(shots, `transcript-work-${c}-${view.skin}-${view.theme}-${view.width}.png`) });
          expect(m.items.length).toBe(c === 'warn' ? 5 : 0);
          if (c === 'warn') expect(m.items[0]!.text).toBe(`lane-a/${SLUG}/scratch-repo · 1.2 GiB`);
          expect(m.left).toBeGreaterThanOrEqual(0);
          expect(m.right).toBeLessThanOrEqual(m.vw);
          for (const it of m.items) {
            expect(it.left).toBeGreaterThanOrEqual(m.left - 0.5);
            expect(it.right).toBeLessThanOrEqual(m.right + 0.5);
            expect(it.over).toBeLessThanOrEqual(0);
          }
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
