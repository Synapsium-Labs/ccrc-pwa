// The compact gauges fit their box (W2 Task S2c), in a real Chrome over the production build.
//
// No screen places the gauges yet (Refined's app bar and Instrument's shell will), and the shells will give them a
// box a few hundred pixels wide. jsdom lays nothing out, so `test/fleet-pieces.test.tsx` holds the count and this file
// holds what Chrome computes: the door's markup (`CompactGauges`, rendered here) is put into the running app, so the
// app's own stylesheets lay it out, in boxes 262, 300, 358 and 600 wide, for each arrangement, at 360, 390, 1280 and
// 1920 in both skins and both palettes. Every gauge that shows is whole inside the row; no two gauges, nor a gauge
// and the "+n", overlap; no reading is clipped; a short name is never truncated; and the door does not overflow.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/compact-gauges.browser.test.tsx )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import type { AccountUsage } from '../../shared/api';
import { CompactGauges, type CompactArrangement } from '../src/fleet/CompactGauges';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [PHOSPHOR, 'light'].flatMap((theme) =>
  [360, 390, 1280, 1920].map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const BOXES = [262, 300, 358, 600];
const ARRANGEMENTS: CompactArrangement[] = ['bar', 'led', 'grid'];
const FIXTURE: AppFixture = { api: {}, fleetFrames: [{ type: 'fleet', sessions: [] }] };

const nowSec = Math.floor(Date.now() / 1000);
const lane = (wrapper: string, five: number | null, seven: number | null, over: Partial<AccountUsage> = {}): AccountUsage => ({
  wrapper, five, seven, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});
const LANES = [
  lane('lane-a', 30, 100), lane('lane-b', 12, null), lane('lane-with-a-long-name', 90, 5), lane('lane-d', 0, null, { fiveRolledOver: true }),
  lane('lane-e', null, null), lane('lane-f', 5, 6), lane('lane-g', 7, 8), lane('lane-h', 99, 2),
];
const markup = (compact: CompactArrangement): string =>
  renderToStaticMarkup(<CompactGauges compact={compact} lanes={LANES} roster={[]} placeholder={null} />);

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

interface Fault { readonly box: number; readonly compact: string; readonly what: string }

describe('the compact gauges fit their box', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.goto(server!.origin + '/');
        // The fleet's stylesheet is loaded once a rule of the gauges' is in the document.
        await page.waitForFunction(() => [...document.styleSheets].some((sh) => {
          try { return [...sh.cssRules].some((r) => r.cssText.includes('.accounts-compact-lanes')); } catch { return false; }
        }), undefined, { timeout: 20_000 });
        const faults = await page.evaluate(({ boxes, doors }) => {
          const out: Fault[] = [];
          const host = document.createElement('div');
          host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:var(--bg, #000)';
          document.body.appendChild(host);
          for (const [compact, html] of doors) {
            for (const box of boxes) {
              host.innerHTML = `<div style="width:${box}px">${html}</div>`;
              const say = (what: string): void => { out.push({ box, compact, what }); };
              const door = host.querySelector<HTMLElement>('.accounts-compact')!;
              const row = door.querySelector<HTMLElement>('.accounts-compact-lanes')!;
              const r = row.getBoundingClientRect();
              const shown = [...row.querySelectorAll<HTMLElement>('.accounts-compact-gauge')]
                .filter((g) => g.getBoundingClientRect().top < r.bottom - 1);
              if (shown.length === 0) say('no gauge shows');
              if (door.scrollWidth > door.clientWidth + 0.5) say(`door overflows: ${door.scrollWidth} > ${door.clientWidth}`);
              const rects = shown.map((g) => g.getBoundingClientRect());
              const more = door.querySelector<HTMLElement>('.accounts-compact-more');
              if (more !== null) rects.push(more.getBoundingClientRect());
              for (let i = 0; i < rects.length; i += 1) {
                for (let j = i + 1; j < rects.length; j += 1) {
                  const a = rects[i]!; const b = rects[j]!;
                  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                  if (x > 0.5 && y > 0.5) say(`items ${i} and ${j} overlap by ${x.toFixed(1)}px`);
                }
              }
              if (more !== null && more.getBoundingClientRect().right > door.getBoundingClientRect().right + 0.5) say('+n is clipped');
              for (const g of shown) {
                const gr = g.getBoundingClientRect();
                const name = g.querySelector<HTMLElement>('.accounts-compact-name')!;
                const pct = g.querySelector<HTMLElement>('.accounts-compact-pct')!;
                const pr = pct.getBoundingClientRect();
                if (gr.right > r.right + 0.5) say(`${name.textContent} sticks out of the row`);
                if (pr.right > gr.right + 0.5 || pct.scrollWidth > pct.clientWidth + 0.5) say(`${name.textContent}'s ${pct.textContent} is clipped`);
                if ((name.textContent ?? '').length <= 6 && name.scrollWidth > name.clientWidth + 0.5) say(`${name.textContent} is truncated`);
                if (name.getBoundingClientRect().width < 1) say(`${name.textContent} collapsed to nothing`);
              }
            }
          }
          host.remove();
          return out;
        }, { boxes: BOXES, doors: ARRANGEMENTS.map((c) => [c, markup(c)] as const) });
        expect(faults).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});
