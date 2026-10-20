// The Sheet honours reduced motion (D-5930), in a real Chrome over the production build.
//
// vaul slides its panel and fades its overlay with keyframe animations at an unlayered `animation-duration: .5s`. The
// Sheet used to retime them with transition utilities, which a keyframe never reads, so it slid for vaul's half
// second under every setting, `prefers-reduced-motion: reduce` included. `ui/src/lib/motion.ts` puts the keyframes on
// four variables that each surface sets from the tokens, and the tokens' reduced-motion block takes every duration to
// 1ms. jsdom computes no animation, so `test/sheet-motion.test.tsx` holds the classes and this file holds what Chrome
// computes from them: the open Sheet ("Keyboard shortcuts", `?`) and the open palette (Ctrl+K), under `no-preference`
// and under `reduce`, at 360, 390, 1280 and 1920 in both skins and both Phosphor palettes; the closing panel's
// curve; and vaul's snap-back after a short drag, an inline transition the same helper retimes.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/vaul-motion.browser.test.tsx )`.
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
/** A timing function with its spaces and leading-zero spellings folded: the build minifies `0.2` to `.2`. */
const flat = (s: string): string => s.replace(/\s+/g, '').replace(/(^|[(,])\./g, '$10.');

async function boot(page: Page, view: AppView): Promise<void> {
  await page.goto(server!.origin + '/');
  await page.waitForFunction(([skin, theme]) => {
    const root = document.documentElement;
    return root.getAttribute('data-skin') === skin && (root.getAttribute('data-theme') ?? 'phosphor') === theme;
  }, [view.skin, view.theme] as const, { timeout: 20_000 });
  // The first VISIBLE landmark: on a phone the frame's `main#content` is hidden on the fleet route (the swap) and the
  // fleet column, a `section.fleet`, is what shows (W2 S2b; D-5466).
  await page.locator('main:visible, section.fleet:visible, [data-page-scaffold]:visible').first().waitFor({ timeout: 20_000 });
}

/** The root's resolved value of a token, as the page sees it under the current media. */
const token = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

interface Read { readonly duration: string; readonly curve: string }

async function openSheet(page: Page): Promise<{ panel: Read; overlay: Read }> {
  await page.keyboard.press('?');
  await page.locator('.sheet-panel[data-state="open"]').waitFor({ timeout: 10_000 });
  return page.evaluate(() => {
    const read = (el: Element | null): Read => {
      if (el === null) throw new Error('no element');
      const s = getComputedStyle(el);
      return { duration: s.animationDuration, curve: s.animationTimingFunction };
    };
    return { panel: read(document.querySelector('.sheet-panel')), overlay: read(document.querySelector('[data-testid="sheet-overlay"]')) };
  });
}

async function openPalette(page: Page): Promise<Read> {
  await page.keyboard.press('Control+k');
  const content = page.locator('[role="dialog"][data-state="open"]:has([role="combobox"])');
  await content.waitFor({ timeout: 10_000 });
  return content.evaluate((el) => {
    const s = getComputedStyle(el);
    return { duration: s.animationDuration, curve: s.animationTimingFunction };
  });
}

describe("the Sheet's motion is vaul's keyframes on the tokens (D-5930)", () => {
  for (const view of VIEWS) {
    it(`the open Sheet's animationDuration is --dur-sheet under no-preference — ${named(view)}`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await boot(page, view);
        const want = ms(await token(page, '--dur-sheet'));
        expect(want, '--dur-sheet resolves to a real pace').toBeGreaterThan(100);
        const { panel, overlay } = await openSheet(page);
        expect(ms(panel.duration), 'panel').toBe(want);
        expect(ms(overlay.duration), 'overlay').toBe(want);
        expect(flat(panel.curve), 'the entrance springs').toBe(flat(await token(page, '--curve-spring')));
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it(`the open Sheet's animationDuration is 0.001s under reduce — ${named(view)}`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await boot(page, view);
        const { panel, overlay } = await openSheet(page);
        expect(panel.duration, 'panel').toBe('0.001s');
        expect(overlay.duration, 'overlay').toBe('0.001s');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it(`the open palette's animationDuration is --dur-base under no-preference and 0.001s under reduce — ${named(view)}`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await boot(page, view);
        const want = ms(await token(page, '--dur-base'));
        expect(want, '--dur-base resolves to a real pace').toBeGreaterThan(100);
        expect(ms((await openPalette(page)).duration), 'no-preference').toBe(want);
        await page.keyboard.press('Escape');
        await page.locator('[role="combobox"]').waitFor({ state: 'detached', timeout: 10_000 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect((await openPalette(page)).duration, 'reduce').toBe('0.001s');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it(`the closing panel's animationTimingFunction is the swift curve — ${named(view)}`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await boot(page, view);
        await openSheet(page);
        // Read at the moment vaul flips the panel to `closed`: it unmounts once the exit has run. The observer is
        // INSTALLED (an awaited evaluate) before Escape is pressed, so the flip cannot happen unwatched.
        await page.evaluate(() => {
          const el = document.querySelector('.sheet-panel')!;
          const read = (): Read => {
            const s = getComputedStyle(el);
            return { duration: s.animationDuration, curve: s.animationTimingFunction };
          };
          (window as unknown as { __closing: Promise<Read> }).__closing = new Promise<Read>((resolve) => {
            if (el.getAttribute('data-state') === 'closed') { resolve(read()); return; }
            new MutationObserver((_, obs) => {
              if (el.getAttribute('data-state') !== 'closed') return;
              obs.disconnect();
              resolve(read());
            }).observe(el, { attributes: true, attributeFilter: ['data-state'] });
          });
        });
        await page.keyboard.press('Escape');
        const read = await page.evaluate(() => (window as unknown as { __closing: Promise<Read> }).__closing);
        expect(flat(read.curve)).toBe(flat(await token(page, '--curve-swift')));
        expect(ms(read.duration), 'the exit runs at --dur-slow').toBe(ms(await token(page, '--dur-slow')));
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    // vaul's snap-back after a drag that does not dismiss is an inline TRANSITION (`resetDrawer`: `transform .5s`),
    // not a keyframe; only an important declaration beats an inline style, so VAUL_MOTION retimes it too.
    for (const motion of ['no-preference', 'reduce'] as const) {
      it(`the snap-back after a short drag runs on the tokens under ${motion} — ${named(view)}`, async () => {
        const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
        try {
          await page.emulateMedia({ reducedMotion: motion });
          await boot(page, view);
          await openSheet(page);
          await page.waitForTimeout(600); // vaul refuses a drag in the first 500ms after it opens
          const box = (await page.locator('.sheet-panel').boundingBox())!;
          const x = box.x + box.width / 2;
          const y = box.y + 4; // the grabber's strip: no text to select, which would also refuse the drag
          await page.mouse.move(x, y);
          await page.mouse.down();
          for (let i = 1; i <= 8; i++) { await page.mouse.move(x, y + i * 6); await page.waitForTimeout(40); }
          await page.mouse.up();
          const after = await page.evaluate(async () => {
            const el = document.querySelector<HTMLElement>('.sheet-panel')!;
            const s = getComputedStyle(el);
            const read = { inline: el.style.transition, duration: s.transitionDuration, curve: s.transitionTimingFunction };
            await new Promise((r) => setTimeout(r, 60));
            return { ...read, state: el.getAttribute('data-state'), transform: getComputedStyle(el).transform };
          });
          expect(after.state, 'a short slow drag does not dismiss').toBe('open');
          expect(after.inline, "vaul's resetDrawer ran (its inline transition)").toMatch(/transform/);
          if (motion === 'reduce') {
            expect(after.duration, 'the snap-back').toBe('0.001s');
            expect(['none', 'matrix(1, 0, 0, 1, 0, 0)'], 'back at rest 60ms after release').toContain(after.transform);
          } else {
            expect(ms(after.duration), 'the snap-back springs at --dur-sheet').toBe(ms(await token(page, '--dur-sheet')));
            expect(flat(after.curve), 'on the spring').toBe(flat(await token(page, '--curve-spring')));
          }
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});
