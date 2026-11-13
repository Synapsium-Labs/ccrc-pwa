// The session's model sheet names each class's model from the lane's own model files (D-8406), in a real Chrome over the
// production build. The sheet's layout is unchanged by D-8406; what changed is where its words come from, and a lane's
// catalogue can hand it a label of any length. So: at 360, 390, 1280 and 1920 in both skins and both palettes, the
// sheet lists the labels `GET /api/models/:lane` gave it (one long enough that no phone row holds it on one line),
// each with its class word under it, in the Anthropic list's order with Default last; a long label wraps inside its
// row, never past the sheet or the page; and the live model's row is the selected one.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/model-sheet-labels.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 390, 1280, 1920];
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

// ---- the fixture: neutral names -----------------------------------------------------------------------------------
const LONG_LABEL = 'Lane A Model Opus Tier With A Catalogue Label Long Enough To Wrap On Any Phone Row';
const MODELS = {
  ok: true, lane: 'lane-a',
  models: {
    kind: 'read',
    classes: {
      opus: { model: 'vendor/model-opus-tier-7', label: LONG_LABEL },
      sonnet: { model: 'vendor/model-sonnet-tier-7', label: 'Model Sonnet Tier 7' },
      fable: { model: 'vendor/model-fable-tier-7', label: 'Model Fable Tier 7' },
      haiku: { model: 'vendor/model-haiku-tier-7', label: 'Model Haiku Tier 7' },
    },
  },
};
const SESSION = fleetSession({
  id: 'lane-a-project-a', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a',
  workspace: null, name: null, status: 'idle', bucket: 'idle', model: 'vendor/model-sonnet-tier-7', effort: 'high',
});
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': [], '/api/claims': [],
    '/api/models/lane-a': MODELS,
  },
  fleetFrames: [{ type: 'fleet', sessions: [SESSION] }],
};
const LABELS = [LONG_LABEL, 'Model Sonnet Tier 7', 'Model Fable Tier 7', 'Model Haiku Tier 7', 'Default'];
const SUBLABELS = ['Opus class', 'Sonnet class', 'Fable class', 'Haiku class', ''];

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

interface SheetMeasure {
  labels: string[];
  sublabels: string[];
  selected: string[];
  pageOverflow: number;
  /** Rows or labels whose box leaves the sheet's, or whose text runs past its own box. */
  escapes: string[];
  /** The long label's height over one line of it: above 1 means it wrapped. */
  longLines: number;
}

describe('the model sheet names its rows from the lane registry, at every width (D-8406)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const opened = await openApp(browser!, view, FIXTURE);
      try {
        const { page } = opened;
        await page.goto(`${server!.origin}/s/${SESSION.id}`);
        const door = page.locator(".chat-head [data-command='session-model']").first();
        await door.waitFor({ timeout: 20_000 });
        await page.waitForTimeout(300); // the first paint's transitions and the models read settle
        await door.click();
        await page.waitForFunction(() => document.querySelectorAll('[role="dialog"] .opt').length >= 5, undefined, { timeout: 20_000 });
        await page.waitForFunction((l) => document.querySelector('[role="dialog"] .opt-label')?.textContent === l, LONG_LABEL,
          { timeout: 20_000 });
        await page.waitForTimeout(400); // the sheet's entry transition
        const m = await page.evaluate((): SheetMeasure => {
          const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
          const box = dialog.getBoundingClientRect();
          const rows = [...dialog.querySelectorAll<HTMLElement>('.opt')];
          const escapes: string[] = [];
          for (const row of rows) {
            const r = row.getBoundingClientRect();
            if (r.left < box.left - 0.5 || r.right > box.right + 0.5) escapes.push(`row ${row.textContent}`);
            for (const el of row.querySelectorAll<HTMLElement>('.opt-label, .opt-desc')) {
              const e = el.getBoundingClientRect();
              if (e.right > r.right + 0.5 || el.scrollWidth > el.clientWidth + 1) escapes.push(`text ${el.textContent}`);
            }
          }
          const long = rows[0]!.querySelector<HTMLElement>('.opt-label')!;
          const lineHeight = parseFloat(getComputedStyle(long).lineHeight) || parseFloat(getComputedStyle(long).fontSize) * 1.2;
          return {
            labels: rows.map((r) => r.querySelector('.opt-label')?.textContent ?? ''),
            sublabels: rows.map((r) => r.querySelector('.opt-desc')?.textContent ?? ''),
            selected: rows.filter((r) => r.classList.contains('opt--selected')).map((r) => r.querySelector('.opt-label')?.textContent ?? ''),
            pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
            escapes,
            longLines: long.getBoundingClientRect().height / lineHeight,
          };
        });
        expect(m.labels, named(view)).toEqual(LABELS);
        expect(m.sublabels, named(view)).toEqual(SUBLABELS);
        expect(m.selected, named(view)).toEqual(['Model Sonnet Tier 7']);
        expect(m.pageOverflow, `${named(view)}: the page scrolls sideways`).toBeLessThanOrEqual(0);
        expect(m.escapes, named(view)).toEqual([]);
        if (view.width < 900) expect(m.longLines, `${named(view)}: the long label wraps`).toBeGreaterThan(1.5);
      } finally {
        await opened.ctx.close();
      }
    }, 60_000);
  }
});
