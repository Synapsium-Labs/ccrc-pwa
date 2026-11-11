// D-8276: a session on an older Claude Code build than the newest the fleet runs wears ONE quiet marker on its fleet
// card, `cc .296 behind`, in a real Chrome over the production build (working rows, so no rollup folds them). One legible fact at every width: the marker is
// drawn whole (not cut), inside its row, and a session on the newest build wears none. `test/build-behind.test.tsx`
// holds the model and the markup; this file holds the geometry. Measured in Refined's cards and in Instrument's status
// mode, in the Phosphor palette and the light theme, at 390, 1280 and 1920.
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/build-behind.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'] as const;
const WIDTHS = [390, 1280, 1920] as const;
const SKINS = [REFINED, INSTRUMENT] as const;
const CASES = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }) as AppView)));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const PROJECT = 'project-a';
const ROSTER = [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', pool: 'pool-a', homeAble: true, hidden: false }];
const row = (ws: string, version: string, extra: object = {}): object => ({
  id: `${PROJECT}-${ws}`, wrapper: 'lane-a', home: 'lane-a', project: PROJECT, workdir: `/w/${PROJECT}/${ws}`, workspace: ws,
  name: ws, status: 'busy', statusUpdatedAt: null, limits: null, dialogPending: false, version, model: null,
  effort: null, ultracode: false, branch: `ws/${ws}`, ctxPct: null, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'working', unmeasured: [], started: true,
  child: { kind: 'none' }, role: 'coordinator', ...extra,
});
const SESSIONS = [
  row('behind-row', '2.1.296'),
  row('current-row', '2.1.302'),
  row('selected', '2.1.302'),
];
const SELECTED = `${PROJECT}-selected`;
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: ROSTER },
    '/api/projects': { roots: ['/w'], projects: [{ name: PROJECT, workdir: `/w/${PROJECT}` }] },
    '/api/runs': [],
    '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: SESSIONS }],
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

async function boot(view: AppView): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
  await page.goto(server!.origin + (view.width >= 900 ? `/s/${SELECTED}` : '/'));
  await page.waitForFunction(([skin, theme]) => {
    const root = document.documentElement;
    return root.getAttribute('data-skin') === skin && (root.getAttribute('data-theme') ?? 'phosphor') === theme;
  }, [view.skin, view.theme] as const, { timeout: 20_000 });
  await page.locator('.sess-line').first().waitFor();
  return { page, errors, close: () => ctx.close() };
}

interface RowMarker {
  readonly name: string;
  readonly markers: number;
  readonly text: string;
  readonly cut: boolean;
  readonly inside: boolean;
}

/** Per row: its name, how many `behind` markers it draws, and the first one's geometry. */
function measure(page: Page): Promise<RowMarker[]> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.sess-line')].map((line) => {
    const open = line.querySelector('.sess-open');
    const name = (open?.querySelector('.sr-only') ?? open?.querySelector('.sess-label'))?.textContent ?? '';
    const all = line.querySelectorAll<HTMLElement>('[data-marker="behind"]');
    const m = all[0];
    if (m === undefined) return { name, markers: 0, text: '', cut: false, inside: true };
    const r = m.getBoundingClientRect();
    const l = line.getBoundingClientRect();
    return {
      name, markers: all.length, text: m.textContent ?? '',
      cut: m.scrollWidth > m.clientWidth + 0.5,
      inside: r.left >= l.left - 0.5 && r.right <= l.right + 0.5 && r.top >= l.top - 0.5 && r.bottom <= l.bottom + 0.5,
    };
  }));
}

const sideScroll = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

describe('D-8276: a card on an older Claude Code build says so, quietly', () => {
  for (const view of CASES) {
    it(`the behind row wears one whole marker, the current row none (${named(view)})`, async () => {
      const { page, errors, close } = await boot(view);
      try {
        await page.locator('[data-marker="behind"]').first().waitFor({ timeout: 20_000 });
        const rows = await measure(page);
        const behind = rows.find((x) => x.name === 'behind-row');
        expect(behind, 'the behind row is drawn').toBeDefined();
        expect(behind!.markers, 'exactly one behind marker').toBe(1);
        expect(behind!.text).toBe('cc .296 behind');
        expect(behind!.cut, 'the marker is not cut').toBe(false);
        expect(behind!.inside, 'the marker is inside its row').toBe(true);
        const current = rows.find((x) => x.name === 'current-row');
        expect(current, 'the current row is drawn').toBeDefined();
        expect(current!.markers, 'a row on the newest build wears none').toBe(0);
        expect(await sideScroll(page), 'no horizontal overflow').toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    }, 90_000);
  }
});
