// Settings › Updates › Nodes, the supervisor sweep's line (D-8386, residue R37), in a real Chrome over the production
// build at 390, 1280 and 1920 in both skins. `test/update-sweep-line.test.tsx` holds the line's words and when it shows
// in jsdom; this file holds what only an engine can say: the longest record the writer can leave (`down: <n>: <ids>`,
// cut at 200 characters) wraps inside its node row, nothing in the row or on the page runs sideways, and the row whose
// report carried no sweep word has no line.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. Run: `( cd pwa && CCRC_CHROME=<a Chrome or
// Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/update-sweep-line.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { UPDATE_SWEEP_MAX } from '../../shared/api';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: readonly AppView[] = [390, 1280, 1920].flatMap((width) => [
  { skin: REFINED, theme: PHOSPHOR, width }, { skin: INSTRUMENT, theme: 'light', width },
]);
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const MIN = 60_000;

/** The longest `down` record `_upd_sweep_set_down` writes: the count, then whole unit ids while they fit in 200. */
const LONG_DOWN = ((): string => {
  let word = 'down: 9:';
  for (let i = 0; ; i++) {
    const id = `demo-quiet-basin-${String(i).padStart(2, '0')}-a1b2c3d4`;
    if (word.length + 1 + id.length > UPDATE_SWEEP_MAX) return word;
    word = `${word} ${id}`;
  }
})();

const node = (role: 'fleet' | 'server', id: string, sweep: string | null) => ({
  nodeId: id, role, label: role, os: 'linux',
  current: { sha: 'bd2bf57a91c3e0d4f6a8b2c5e7d9f1a3b5c7e9d1', ref: 'main', builtAt: '2026-09-20T12:00:00Z', dirty: false, version: 'v0.0.9' },
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['update-gate'], agentOps: role === 'server' ? null : [], highestVersion: 'v0.0.9', previousVersion: null,
  floorRead: 'measured', previousRead: 'absent', measuredAt: Date.now() - MIN, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null, request: null,
  report: {
    phase: 'done', target: 'v0.0.9', startedAt: Date.now() - 10 * MIN, updatedAt: Date.now() - 8 * MIN, detail: null,
    ...(sweep === null ? {} : { sweep }),
  },
  update: { state: 'idle', target: 'v0.0.9', startedAt: null, detail: 'done: v0.0.9' },
});

const FIXTURE: AppFixture = {
  api: {
    '/api/updates': {
      catalogue: { lastOkAt: Date.now() - 4 * MIN, lastError: null }, releases: [], intent: [],
      nodes: [
        node('fleet', '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10', LONG_DOWN),
        node('server', '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93', null),
      ],
    },
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [] },
    '/api/runs': { runs: [] },
    '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: [] }, { type: 'runs', runs: [] }],
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

interface Box { left: number; right: number; top: number; bottom: number }

describe('Settings › Updates › Nodes: the sweep line at every width, in both skins (D-8386)', () => {
  it('the fixture\'s record is the writer\'s longest shape', () => {
    expect(LONG_DOWN.length).toBeGreaterThan(UPDATE_SWEEP_MAX - 40);
    expect(LONG_DOWN.length).toBeLessThanOrEqual(UPDATE_SWEEP_MAX);
  });

  for (const view of VIEWS) {
    it(named(view), async () => {
      const app = await openApp(browser!, view, FIXTURE);
      const { ctx, page, errors } = app;
      try {
        await page.goto(server!.origin + '/settings/updates');
        const line = page.getByTestId('settings-node-sweep');
        await expect.poll(() => line.count(), { timeout: 20_000 }).toBe(1);
        expect(await line.textContent()).toBe(`Supervisor sweep: ${LONG_DOWN}`);

        const m = await line.evaluate((el) => {
          const box = (e: Element | Range): Box => {
            const r = e.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          };
          const row = el.closest('li.settings-node')!;
          const list = el.closest('ul.settings-nodes')!;
          const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 16;
          const range = document.createRange();
          range.selectNodeContents(el);
          return {
            viewport: window.innerWidth,
            pageScrollWidth: document.documentElement.scrollWidth, pageClientWidth: document.documentElement.clientWidth,
            line: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, box: box(el), height: el.getBoundingClientRect().height, lineHeight },
            words: box(range),
            row: { scrollWidth: row.scrollWidth, clientWidth: row.clientWidth, box: box(row), label: row.querySelector('.settings-node-label')?.textContent },
            list: { scrollWidth: list.scrollWidth, clientWidth: list.clientWidth },
            others: [...list.querySelectorAll('li.settings-node')].filter((r) => r !== row)
              .map((r) => ({ label: r.querySelector('.settings-node-label')?.textContent, sweep: r.querySelector('[data-testid="settings-node-sweep"]') !== null })),
          };
        });
        expect(m.row.label, 'the line sits on the fleet row').toBe('fleet');
        expect(m.others, 'the row with no sweep word has no line').toEqual([{ label: 'server', sweep: false }]);
        expect(m.line.scrollWidth, 'the line overflows sideways').toBeLessThanOrEqual(m.line.clientWidth);
        expect(m.row.scrollWidth, 'the node row overflows sideways').toBeLessThanOrEqual(m.row.clientWidth);
        expect(m.list.scrollWidth, 'the node list overflows sideways').toBeLessThanOrEqual(m.list.clientWidth);
        expect(m.pageScrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(m.pageClientWidth);
        expect(m.line.box.left, 'the line starts left of its row').toBeGreaterThanOrEqual(m.row.box.left - 0.5);
        expect(m.line.box.right, 'the line runs past its row').toBeLessThanOrEqual(m.row.box.right + 0.5);
        expect(m.words.left, 'the words start left of their line').toBeGreaterThanOrEqual(m.line.box.left - 0.5);
        expect(m.words.right, 'the words run past their line').toBeLessThanOrEqual(m.line.box.right + 0.5);
        expect(m.line.box.right, 'the line runs past the viewport').toBeLessThanOrEqual(m.viewport);
        // At a phone width the 200-character record must wrap rather than run on one line.
        if (view.width === 390) expect(m.line.height, 'the record did not wrap at a phone width').toBeGreaterThan(m.line.lineHeight * 1.5);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
