// The Sheet's desktop arm (D-5933), in a real Chrome over the production build.
//
// jsdom computes no layout and no animation, so `test/sheet-desktop-arm.test.tsx` holds the chrome and the classes
// and this file holds what Chrome computes from them, for the "Keyboard shortcuts" sheet (`?`, the default `md`):
// from 900 the open panel runs `sheet-pop-in`, not vaul's `slideFromBottom`, at `--dur-base` (0.001s under
// `reduce`); it is centred, 560px wide, round on every corner, on `--elev-pop` (Instrument's hairline), with no
// overscroll strip below it, no grabber and a ✕ of at least 44px; a drag on it neither moves nor closes it. Below 900
// it is the bottom sheet it was. At 360, 390, 1280 and 1920 in both skins and both Phosphor palettes.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/sheet-desktop-arm.browser.test.tsx )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [PHOSPHOR, 'light'].flatMap((theme) =>
  [360, 390, 1280, 1920].map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const FIXTURE: AppFixture = { api: {}, fleetFrames: [{ type: 'fleet', sessions: [] }] };

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

/** A CSS time (`0.42s`, `420ms`) in milliseconds. */
const ms = (t: string): number => {
  const m = /^\s*([\d.]+)(ms|s)\s*$/.exec(t);
  if (m === null) throw new Error(`not a CSS time: ${JSON.stringify(t)}`);
  return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
};

async function boot(page: Page, view: AppView): Promise<void> {
  await page.goto(server!.origin + '/');
  await page.waitForFunction(([skin, theme]) => {
    const root = document.documentElement;
    return root.getAttribute('data-skin') === skin && (root.getAttribute('data-theme') ?? 'phosphor') === theme;
  }, [view.skin, view.theme] as const, { timeout: 20_000 });
  await page.locator('main:visible, section.fleet:visible, [data-page-scaffold]:visible').first().waitFor({ timeout: 20_000 });
}

interface Shot {
  readonly name: string; readonly duration: string; readonly after: string; readonly shadow: string; readonly pop: string;
  readonly radius: string; readonly rect: { x: number; y: number; w: number; h: number };
  readonly vw: number; readonly vh: number; readonly grabber: boolean;
  readonly close: { w: number; h: number } | null;
}

async function openSheet(page: Page): Promise<Shot> {
  await page.keyboard.press('?');
  await page.locator('.sheet-panel[data-state="open"]').waitFor({ timeout: 10_000 });
  return page.evaluate(async () => {
    const el = document.querySelector<HTMLElement>('.sheet-panel')!;
    // Read at rest: mid-entrance the rise is still under way. The duration and name stay computed after it ends.
    await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)));
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    // The resolved `--elev-pop`, through a probe so `var()` chains resolve the way the panel's own shadow does.
    const probe = document.createElement('div');
    probe.style.boxShadow = 'var(--elev-pop)';
    el.appendChild(probe);
    const pop = getComputedStyle(probe).boxShadow;
    probe.remove();
    const close = el.querySelector<HTMLElement>('button[aria-label="Close"]');
    const cr = close?.getBoundingClientRect();
    return {
      name: s.animationName, duration: s.animationDuration, after: getComputedStyle(el, '::after').content,
      shadow: s.boxShadow, pop, radius: s.borderBottomLeftRadius,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height }, vw: window.innerWidth, vh: window.innerHeight,
      grabber: el.querySelector('.sheet-grabber') !== null,
      close: cr === undefined ? null : { w: cr.width, h: cr.height },
    };
  });
}

describe("the Sheet's desktop arm, as Chrome draws it (D-5933)", () => {
  for (const view of VIEWS) {
    const desk = view.width >= 900;

    it(`${desk ? 'a centred dialog on sheet-pop-in' : 'the bottom sheet on vaul\'s slide'} under no-preference — ${named(view)}`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await boot(page, view);
        const want = ms(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue(
          window.innerWidth >= 900 ? '--dur-base' : '--dur-sheet').trim()));
        const shot = await openSheet(page);
        expect(ms(shot.duration), 'the entrance runs on the tokens').toBe(want);
        if (desk) {
          expect(shot.name, "the arm replaced vaul's slide").toBe('sheet-pop-in');
          expect(Math.round(shot.rect.w), 'md is 560 wide').toBe(560);
          expect(Math.abs(shot.rect.x + shot.rect.w / 2 - shot.vw / 2), 'centred across').toBeLessThanOrEqual(1);
          expect(Math.abs(shot.rect.y + shot.rect.h / 2 - shot.vh / 2), 'centred down').toBeLessThanOrEqual(1);
          expect(shot.radius, 'round at the foot too').not.toBe('0px');
          expect(shot.after, 'no overscroll strip under the dialog').toBe('none');
          // Tailwind's shadow utility composes its transparent inset and ring layers first; the lift is the last.
          expect(shot.shadow.endsWith(shot.pop), `on --elev-pop: ${shot.shadow}`).toBe(true);
          if (view.skin === INSTRUMENT) expect(shot.pop, "Instrument's hairline").toMatch(/ 0px 0px 0px 1px$|^rgb.*0px 0px 0px 1px/);
          else expect(shot.pop, 'a shadow that falls down').toMatch(/0px 12px 40px/);
          expect(shot.grabber).toBe(false);
          expect(shot.close, 'a ✕').not.toBeNull();
          expect(Math.min(shot.close!.w, shot.close!.h), 'the ✕ is a tap target').toBeGreaterThanOrEqual(44);
        } else {
          expect(shot.name).toBe('slideFromBottom');
          expect(Math.round(shot.rect.w), 'the full width').toBe(shot.vw);
          expect(shot.grabber).toBe(true);
          expect(shot.close).toBeNull();
        }
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it(`the open panel's animationDuration is 0.001s under reduce — ${named(view)}`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await boot(page, view);
        const shot = await openSheet(page);
        expect(shot.name).toBe(desk ? 'sheet-pop-in' : 'slideFromBottom');
        expect(shot.duration).toBe('0.001s');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    if (desk) {
      it(`a drag on the dialog neither moves nor closes it — ${named(view)}`, async () => {
        const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
        try {
          await page.emulateMedia({ reducedMotion: 'no-preference' });
          await boot(page, view);
          await openSheet(page);
          await page.waitForTimeout(600); // vaul refuses a drag in the first 500ms after it opens
          const box = (await page.locator('.sheet-panel').boundingBox())!;
          const x = box.x + box.width / 2;
          const y = box.y + 4;
          await page.mouse.move(x, y);
          await page.mouse.down();
          for (let i = 1; i <= 12; i++) { await page.mouse.move(x, y + i * 20); await page.waitForTimeout(20); }
          await page.mouse.up();
          await page.waitForTimeout(300);
          const after = await page.evaluate(() => {
            const el = document.querySelector<HTMLElement>('.sheet-panel');
            return el === null ? null : { state: el.getAttribute('data-state'), transform: getComputedStyle(el).transform, inline: el.style.transform };
          });
          expect(after?.state, 'still open').toBe('open');
          expect(after?.inline ?? '', 'vaul never translated it').toBe('');
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});
