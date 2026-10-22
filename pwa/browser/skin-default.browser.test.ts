// The per-device default, measured in a real Chrome over the production build (polish plan S18, D-5096, D-6389): a
// desk with a mouse boots Instrument and a phone or a tablet boots Refined, with nothing stored. The jsdom suites
// (test/skin-boot.test.tsx, test/skin-catalogue.test.ts) pin the rule with a stubbed `matchMedia`; this file holds the
// claim itself, that the shipped snippet and the shipped bundle, asked by a real engine, give those answers.
//
// Fresh context per case, and NOTHING stored unless a case says so, which is why this file builds its contexts itself:
// `openApp` always stores a skin and a theme, and a default is exactly what a stored value would hide. The `/api` and
// `/ws` answers are `openApp`'s (every poller reads `{}` as "nothing to say"; every socket opens and stays silent).
//
// Two reads per case. The PRE-PAINT read loads the page with the bundle's scripts aborted, so the only thing that can
// have stamped `data-skin` is the inline snippet in index.html; the MOUNTED read waits for the app to render and reads
// it again, after `initSkin` has resolved the choice a second time. They must agree.
//
// The phone is emulated with `hasTouch` alone: measured in this Chrome, `(hover: hover) and (pointer: fine)` is true
// for a plain context, and false (hover none, pointer coarse) with `hasTouch: true`, with or without `isMobile`. Each
// case ASSERTS the query's answer in the page, so the emulation is proven, not assumed. The viewport is a width and
// nothing more: the rule reads the primary input, never the window (O1, O2), so a desktop narrowed to 390 stays
// Instrument.
//
// Chrome comes from `resolveChrome()` in `beforeAll`, which THROWS when neither `CCRC_CHROME` nor
// `/usr/bin/google-chrome` is an executable file: a box without Chrome gives a red leg, never a skipped one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { DEVICE_QUERY, INSTRUMENT, REFINED, SKIN_STORAGE_KEY } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, removeDist, serveDist, type DistServer } from './app';

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

interface Device {
  readonly width: number;
  /** A touch screen: a coarse pointer that cannot hover, as a phone or a tablet has. */
  readonly touch: boolean;
  /** Stored under the skin key before the first paint; nothing when absent. */
  readonly stored?: string;
}

/** A context that stores nothing but what `device.stored` names, with `/api` and `/ws` answered as `openApp` does. */
async function contextFor(device: Device): Promise<BrowserContext> {
  const ctx = await browser!.newContext({
    viewport: { width: device.width, height: device.width < 900 ? 844 : 900 }, hasTouch: device.touch, serviceWorkers: 'block',
  });
  if (device.stored !== undefined) {
    await ctx.addInitScript(([key, value]) => {
      try { localStorage.setItem(key, value); } catch { /* a context without storage boots the default */ }
    }, [SKIN_STORAGE_KEY, device.stored] as const);
  }
  await ctx.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.routeWebSocket(/\/ws\//, () => {});
  return ctx;
}

const skinOf = (page: Page): Promise<string | null> => page.evaluate(() => document.documentElement.dataset['skin'] ?? null);

interface Boot {
  /** What the inline snippet stamped, the bundle's scripts aborted. */
  readonly prePaint: string | null;
  /** What `data-skin` reads once the app has rendered. */
  readonly mounted: string | null;
  /** DEVICE_QUERY's answer in the page. */
  readonly isDesk: boolean;
  readonly overflow: number;
}

async function boot(device: Device): Promise<Boot> {
  const ctx = await contextFor(device);
  try {
    const bare = await ctx.newPage();
    await bare.route('**/*.js', (route) => route.abort());
    await bare.goto(server!.origin, { waitUntil: 'domcontentloaded' });
    const prePaint = await skinOf(bare);
    await bare.close();

    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => { errors.push(e.message); });
    await page.goto(server!.origin);
    await page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0);
    await page.waitForTimeout(300);
    expect(errors, 'the app threw while booting').toEqual([]);
    const isDesk = await page.evaluate((q) => matchMedia(q).matches, DEVICE_QUERY);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    return { prePaint, mounted: await skinOf(page), isDesk, overflow };
  } finally {
    await ctx.close();
  }
}

describe('a fresh profile boots the skin its device asks for', () => {
  for (const width of [1280, 1920]) {
    it(`a desktop with a mouse at ${width}px boots Instrument`, async () => {
      const b = await boot({ width, touch: false });
      expect(b.isDesk, 'a plain context is not a desk').toBe(true);
      expect(b.prePaint, 'the pre-paint snippet').toBe(INSTRUMENT);
      expect(b.mounted, 'the mounted app').toBe(INSTRUMENT);
    }, 60_000);
  }

  for (const width of [360, 390]) {
    it(`a phone at ${width}px (touch, coarse) boots Refined`, async () => {
      const b = await boot({ width, touch: true });
      expect(b.isDesk, 'touch emulation still answers as a desk').toBe(false);
      expect(b.prePaint, 'the pre-paint snippet').toBe(REFINED);
      expect(b.mounted, 'the mounted app').toBe(REFINED);
    }, 60_000);
  }

  it('a tablet at a desk width (touch, coarse, 1280px) boots Refined: the device decides, not the window', async () => {
    const b = await boot({ width: 1280, touch: true });
    expect(b.isDesk).toBe(false);
    expect(b.prePaint).toBe(REFINED);
    expect(b.mounted).toBe(REFINED);
  }, 60_000);
});

describe('a stored choice beats the device', () => {
  it('a stored refined stays Refined on a desktop', async () => {
    const b = await boot({ width: 1280, touch: false, stored: REFINED });
    expect(b.isDesk).toBe(true);
    expect(b.prePaint).toBe(REFINED);
    expect(b.mounted).toBe(REFINED);
  }, 60_000);

  it('a stored instrument stays Instrument on a phone', async () => {
    const b = await boot({ width: 390, touch: true, stored: INSTRUMENT });
    expect(b.isDesk).toBe(false);
    expect(b.prePaint).toBe(INSTRUMENT);
    expect(b.mounted).toBe(INSTRUMENT);
  }, 60_000);
});

describe('a desktop window narrowed to a phone width', () => {
  it('a desktop at 390px (a mouse, no touch) stays Instrument and the page does not scroll sideways', async () => {
    // O2: the window never decides. This is today's Instrument below 900 (D-6389); its phone layout is a later wave's,
    // so the case asserts the skin and that nothing overflows, not how the narrow shell is drawn.
    const b = await boot({ width: 390, touch: false });
    expect(b.isDesk).toBe(true);
    expect(b.prePaint).toBe(INSTRUMENT);
    expect(b.mounted).toBe(INSTRUMENT);
    expect(b.overflow, 'the page scrolls sideways at 390px').toBeLessThanOrEqual(0);
  }, 60_000);
});
