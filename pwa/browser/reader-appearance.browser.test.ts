// Hosted appearance in the production reader, inspected in the sandbox through Playwright.
// The catalogue and slot names come from their respective owners, not a second test catalogue.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Frame, type Page } from 'playwright-core';
import { PHOSPHOR, SKINS, SKIN_STORAGE_KEY, SYSTEM, THEMES, THEME_STORAGE_KEY } from '@ccrc/ui';
import { APPEARANCE_PAIRS, APPEARANCE_SLOTS, MERMAID_HOSTED_KINDS } from '@synapsium-labs/pinax-lib/frame';
import { DOC_SECTION_SLUGS, DOCS_RESPONSE_HEADERS } from '../../shared/docs';
import { LAB_ORIGIN_CLASSES, LAB_PROBE_NAMES, LAB_SITE_CLASSES, READER_LAB_RUNS_PATH, readerLabClosePath, readerLabRunPath } from '../../shared/readerLab';
import { READER_APPEARANCE_LABEL, READER_APPEARANCE_MAP, readerAppearanceOf } from '../src/docs/reader/appearance';
import { READER_STORE_PREFIX } from '../src/lib/readerLimits';
import { COMMIT_A, entry, treeOk, treeResponse } from '../test/docsFixtures';
import { openApp, serveDist, sharedDist, type DistServer, type OpenedApp } from './app';
import { resolveChrome } from './harness';
import { MEASURE, readerCeilingReading, readerTimingLoad } from './measurement';
import { readRedraws, REDRAW_FIGURE, setRedrawGate, traceRedrawTasks, waitForRedrawDrain, waitForRedraws, watchRedraws } from './reader-redraw';

const SECTION = DOC_SECTION_SLUGS[0]!;
const NAME = 'appearance.md';
const DOC = '# Appearance\n\nA short document.\n\n## Words used here\n\n| Term | Meaning |\n| --- | --- |\n| Widget | A neutral thing |\n\nWidget, D1 and [ordinary link](#part-0) with `inline code` in a sentence.\n\n## Decisions\n\n| ID | Decision | Status |\n| --- | --- | --- |\n| D1 | Keep the card | Agreed |\n| D2 | Change the rail | Changed |\n\n```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```\n\n'
  + '```mermaid\nflowchart LR\n  C --> D\n  classDef own fill:#d4edda\n  class C own\n```\n\n'
  + '```mermaid\njourney\n  title A day\n  section Work\n    Task: 3: Me\n```\n\n'
  + Array.from({ length: 100 }, (_, i) => `## Part ${i}\n\nA paragraph of the document.\n\n`).join('');
const BLOB = 'a'.repeat(40);
const APPEARANCE_FOLLOW_MAX_MS = 100;
// Fixtures are keyed by kind so a new installed kind requires a drawing, rather than silently going untested.
const DRAWINGS = {
  'flowchart-v2': 'flowchart LR\n  A[Start] -->|Next| B[Finish]',
  sequence: 'sequenceDiagram\n  participant A as Sender\n  participant B as Receiver\n  A->>B: Send\n  B-->>A: Reply',
  classDiagram: 'classDiagram\n  class Shape\n  class Square\n  Shape <|-- Square : extends',
  stateDiagram: 'stateDiagram-v2\n  [*] --> Ready\n  Ready --> Done : go\n  Done --> [*]',
  gantt: 'gantt\n  title Schedule\n  dateFormat YYYY-MM-DD\n  section Work\n  Start :a, 2026-01-01, 4d\n  Finish :b, after a, 4d',
  pie: 'pie\n  title Shares\n  "First" : 55\n  "Second" : 45',
  er: 'erDiagram\n  GROUP ||--o{ ITEM : holds',
  gitGraph: 'gitGraph\n  commit id: "Start"\n  branch branch-a\n  commit id: "Work"\n  checkout main\n  merge branch-a id: "Join"',
} satisfies Record<(typeof MERMAID_HOSTED_KINDS)[number], string>;
let browser: Browser;
let server: DistServer;
beforeAll(async () => {
  const dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath: resolveChrome(), headless: true });
}, 180_000);
afterAll(async () => { await browser?.close(); await server?.close(); });

type FirstReadyTrace = {
  mountedAt?: number;
  admittedAt?: number;
  fallbackAt?: number;
  hookAt?: number;
  sent?: { at: number; rootPresent: boolean; seedAppearance: boolean | null; messageAppearance: boolean };
};

async function firstReadyHostTrace(page: Page) {
  return page.evaluate(() => {
    const trace = (window as Window & { __firstReadyTrace?: FirstReadyTrace }).__firstReadyTrace;
    return { ...trace, fellBack: document.querySelector('.doc-plain-note') !== null || trace?.fallbackAt !== undefined };
  });
}

async function open(skin: string, theme: string, device: 'light' | 'dark', stale?: string,
  prepare?: (app: OpenedApp) => Promise<() => Promise<void>>, text = DOC): Promise<OpenedApp> {
  const size = Buffer.byteLength(text);
  const tree = treeOk({ entries: [entry(SECTION, NAME, { committed: { kind: 'file', blob: BLOB, size } })] });
  const app = await openApp(browser, { width: 1280, skin, theme, tab: 'console' }, { api: {}, fleetFrames: [] });
  await app.page.emulateMedia({ colorScheme: device });
  await app.ctx.addInitScript(({ colours, firstReady }) => {
    const isHost = window === window.top;
    if (!isHost && !firstReady) return;
    const w = window as unknown as {
      __appearanceOps: { at: number }[];
      __appearanceAtReady?: { scheme: string; colour: Record<string, string> };
      __firstReadyTrace?: FirstReadyTrace;
    };
    const now = () => performance.timeOrigin + performance.now();
    const trace: FirstReadyTrace | undefined = firstReady ? { hookAt: now() } : undefined;
    if (trace) w.__firstReadyTrace = trace;
    if (isHost && trace) {
      // Observe the host's own ready/fallback projection independently of the frame-side send probe.
      new MutationObserver(() => {
        if (document.querySelector('.docs-reader iframe')) {
          trace.mountedAt ??= now();
          if (!document.querySelector('.doc-formatting')) trace.admittedAt ??= now();
        }
        if (document.querySelector('.doc-plain-note')) trace.fallbackAt ??= now();
      }).observe(document, { childList: true, subtree: true });
    }
    w.__appearanceOps = [];
    const original = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
      const kind = message !== null && typeof message === 'object' ? (message as { t?: string }).t : undefined;
      if (isHost && kind === 'appearance') w.__appearanceOps.push({ at: performance.timeOrigin + performance.now() });
      if (!isHost && kind === 'ready' && w.__appearanceAtReady === undefined) {
        // Sample within the frame at its first send, before the host can respond. No new listener or port.
        const root = document.querySelector('[data-docreader-root]');
        const at = now();
        if (root) {
          const cs = getComputedStyle(root);
          w.__appearanceAtReady = { scheme: cs.colorScheme,
            colour: Object.fromEntries(colours.map((slot) => [slot, cs.getPropertyValue(`--${slot}`).trim()])) };
        }
        if (trace && !trace.sent) {
          let seedAppearance: boolean | null = null;
          try {
            const seed = JSON.parse(document.querySelector('head script[type="application/json"]')?.textContent ?? 'null');
            if (seed && typeof seed === 'object') seedAppearance = Object.hasOwn(seed, 'appearance');
          } catch { /* An unreadable seed is reported as unknown, not as an absent field. */ }
          trace.sent = { at, rootPresent: root !== null, seedAppearance, messageAppearance: Object.hasOwn(message as object, 'appearance') };
        }
      }
      Reflect.apply(original, this, transfer === undefined ? [message] : [message, transfer]);
    };
  }, { colours: APPEARANCE_SLOTS.colour, firstReady: stale !== undefined });
  if (stale !== undefined) await app.ctx.addInitScript(([key, value]) => {
    if (window === window.top) localStorage.setItem(key, value);
  }, [`${READER_STORE_PREFIX}pref:prefs`, JSON.stringify({ theme: stale })] as const);
  await app.ctx.route((u) => u.pathname.startsWith('/api/docs/'), async (route) => {
    if (route.request().method() !== 'GET') { await route.fulfill({ status: 204 }); return; }
    const pathname = new URL(route.request().url()).pathname;
    const payload = pathname.endsWith('/tree') ? treeResponse(tree) : {
      ok: true, contentClass: 'markdown', from: 'ccd', show: {
        v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: SECTION, path: NAME,
        size, sha256: BLOB.padEnd(64, '0'), encoding: 'utf8', text, commit: COMMIT_A, blob: BLOB, onRef: 'contains',
      },
    };
    await route.fulfill({ status: 200, headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(payload) });
  });
  const during = await prepare?.(app);
  await app.page.goto(`${server.origin}/docs/demo/${SECTION}/${NAME}`, { waitUntil: 'domcontentloaded' });
  await during?.();
  try {
    await app.page.waitForFunction(() => document.querySelector('.docs-reader iframe') !== null && document.querySelector('.doc-formatting') === null,
      undefined, { timeout: 90_000 });
  } catch (error) {
    if (stale === undefined) throw error;
    const trace = await firstReadyHostTrace(app.page).catch(() => null);
    throw new Error(`AP-3 host ready wait failed; first-ready trace: ${JSON.stringify(trace)}`, { cause: error });
  }
  return app;
}

async function frameOf(page: Page): Promise<Frame> {
  const frame = await (await page.locator('.docs-reader iframe').elementHandle())?.contentFrame();
  if (!frame) throw new Error('reader frame absent');
  return frame;
}

// Resolve the console's token through the browser, independently of the library validator. The library returns
// canonical six-digit lower-case hex; a custom property's CSSOM text is not necessarily in that spelling.
async function hostAppearanceValues(page: Page): Promise<{ scheme: string; colour: Record<string, string>; skin: Record<string, string> }> {
  return page.evaluate((map) => {
    const cs = getComputedStyle(document.documentElement);
    const probe = document.createElement('span');
    probe.hidden = true;
    document.body.append(probe);
    try {
      const colour = Object.fromEntries(Object.entries(map.colour).map(([slot, token]) => {
        const raw = cs.getPropertyValue(token);
        if (!CSS.supports('color', raw)) throw new Error(`unresolved host colour ${token}: ${raw}`);
        probe.style.color = raw;
        const resolved = getComputedStyle(probe).color;
        const rgb = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(resolved);
        if (!rgb) throw new Error(`expected an opaque sRGB host colour for ${token}: ${resolved}`);
        return [slot, `#${rgb.slice(1).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`];
      }));
      const skin = Object.fromEntries(Object.entries(map.skin).map(([slot, token]) => [slot, cs.getPropertyValue(token).trim()]));
      skin.sectionFamily = cs.getPropertyValue('--family-section') === cs.getPropertyValue('--family-mono') ? 'mono' : 'sans';
      return { scheme: cs.colorScheme, colour, skin };
    } finally { probe.remove(); }
  }, READER_APPEARANCE_MAP);
}

// SLOT_PROPERTY is library-internal. The installed contract's property naming is --<colour slot> and
// --dr-<hyphenated skin slot>; inspect inline values as well as the library's applied-slot marker.
async function assertAppearance(page: Page): Promise<void> {
  const host = await hostAppearanceValues(page);
  const frame = await frameOf(page);
  const inner = await frame.evaluate(async ({ colours, skins }) => {
    const root = document.querySelector<HTMLElement>('[data-docreader-root]');
    if (!root) throw new Error('reader root absent');
    const cs = getComputedStyle(root);
    await document.fonts.load('16px "Docreader Host Sans"');
    await document.fonts.load('16px "Docreader Host Mono"');
    await document.fonts.ready;
    return {
      scheme: cs.colorScheme,
      colour: Object.fromEntries(colours.map((slot) => [slot, cs.getPropertyValue(`--${slot}`).trim().toLowerCase()])),
      inline: Object.fromEntries(colours.map((slot) => [slot, root.style.getPropertyValue(`--${slot}`).trim()])),
      skins: (root.getAttribute('data-docreader-skin') ?? '').split(' ').filter(Boolean),
      skinInline: Object.fromEntries(skins.map((slot) => [slot, root.style.getPropertyValue(`--dr-${slot.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`).trim()])),
      fonts: [...document.fonts].filter((f) => f.family.includes('Docreader Host')).map((f) => ({ family: f.family.replaceAll('"', ''), status: f.status })),
    };
  }, { colours: APPEARANCE_SLOTS.colour, skins: APPEARANCE_SLOTS.skin });
  expect(inner.colour).toEqual(host.colour);
  expect(inner.scheme).toBe(host.scheme);
  for (const slot of APPEARANCE_SLOTS.colour) expect(inner.inline[slot], slot).not.toBe('');
  expect(inner.skins.sort()).toEqual([...APPEARANCE_SLOTS.skin].sort());
  for (const slot of APPEARANCE_SLOTS.skin) expect(inner.skinInline[slot], slot).not.toBe('');
  for (const family of ['Docreader Host Sans', 'Docreader Host Mono']) {
    expect(inner.fonts.some((f) => f.family === family && f.status === 'loaded'), family).toBe(true);
  }
  await frame.locator('.aa-btn').click();
  expect(await frame.getByText(READER_APPEARANCE_LABEL, { exact: true }).count()).toBe(1);
  const family = await frame.locator('.aa-menu legend').first().evaluate((el) => getComputedStyle(el).fontFamily.replaceAll('"', ''));
  expect(family.startsWith(`Docreader Host ${host.skin.sectionFamily === 'mono' ? 'Mono' : 'Sans'}`)).toBe(true);
}

// Drive the same command doors the operator uses while the reader remains mounted.
async function choose(page: Page, kind: 'theme' | 'layout', label: string): Promise<void> {
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('Control+k');
  const title = kind === 'theme' ? 'Switch theme' : 'Switch layout';
  const input = page.getByRole('combobox', { name: 'Command palette', exact: true });
  // The option's accessible name also includes its group. Select the row by its exact visible title.
  const option = (text: string) => page.getByRole('option').filter({ has: page.getByText(text, { exact: true }) });
  await input.fill(title, { timeout: 10_000 });
  await option(kind === 'theme' ? 'Switch theme…' : 'Switch layout →').click({ timeout: 10_000 });
  const choices = page.getByRole('combobox', { name: title, exact: true });
  await choices.fill(label, { timeout: 10_000 });
  await option(label).click({ timeout: 10_000 });
  await choices.waitFor({ state: 'detached', timeout: 10_000 });
}

async function seedOf(page: Page): Promise<{ nonce: string }> {
  return page.locator('.docs-reader iframe').evaluate((el) => {
    const doc = new DOMParser().parseFromString(el.getAttribute('srcdoc') ?? '', 'text/html');
    const seed = doc.querySelector('head script[type="application/json"]');
    if (!seed) throw new Error('frame seed absent');
    return JSON.parse(seed.textContent ?? '') as { nonce: string };
  });
}

async function prepareFigure(frame: Frame): Promise<void> {
  const button = frame.locator('figure.mermaid-figure').first().locator('.fig-render-btn');
  if (await button.count() > 0) await button.click();
  await frame.waitForFunction(() => document.querySelector('figure.mermaid-figure')?.getAttribute('data-docreader-draw') === 'drawn'
    && document.querySelector('figure.mermaid-figure svg') !== null, undefined, { timeout: 90_000 });
  await frame.evaluate(() => window.scrollTo(0, 400));
}

type WriteSnapshot = Awaited<ReturnType<typeof hostAppearanceValues>> & { at: number };
type FrameWatch = { changes: WriteSnapshot[]; pending: Set<string>; repeats: string[]; old: Element | null };
type HostWatch = { __hostTimes: number[]; __appearanceOps: { at: number }[] };
type TransitionCursor = { stamps: number; operations: number; writes: number };

// Observe synchronously at the DOM boundary: MutationObserver batches can hide two writes in the same task.
// Leave both probes armed until the context closes, including between transitions. No new listener or port.
async function watchTransitions(page: Page, frame: Frame): Promise<TransitionCursor> {
  const operations = await page.evaluate(() => {
    const w = window as unknown as HostWatch;
    const root = document.documentElement;
    w.__hostTimes = [];
    const set = Element.prototype.setAttribute;
    const remove = Element.prototype.removeAttribute;
    const watch = (el: Element, key: string, write: () => void): void => {
      if (el !== root || (key !== 'data-theme' && key !== 'data-skin')) { write(); return; }
      const before = root.getAttribute(key);
      write();
      if (root.getAttribute(key) !== before) w.__hostTimes.push(performance.timeOrigin + performance.now());
    };
    Element.prototype.setAttribute = function (key, value) { watch(this, key, () => Reflect.apply(set, this, [key, value])); };
    Element.prototype.removeAttribute = function (key) { watch(this, key, () => Reflect.apply(remove, this, [key])); };
    return w.__appearanceOps.length;
  });
  await frame.evaluate(({ colours, skins }) => {
    const root = document.querySelector<HTMLElement>('[data-docreader-root]');
    if (!root) throw new Error('reader root absent');
    const style = root.style;
    const w = window as unknown as { __frameWatch: FrameWatch };
    const watch: FrameWatch = w.__frameWatch = { changes: [], pending: new Set(), repeats: [], old: null };
    const colourProps = colours.map((slot) => [slot, `--${slot}`] as const);
    const skinProps = skins.map((slot) => [slot, `--dr-${slot.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] as const);
    const slots = new Set<string>([...colourProps, ...skinProps].map(([, prop]) => prop));
    const set = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (key, value, priority) {
      Reflect.apply(set, this, [key, value, priority]);
      if (this !== style || !slots.has(key)) return;
      if (watch.pending.has(key)) watch.repeats.push(key);
      watch.pending.add(key);
      // Both palettes and skins in this fixture are complete. One write sets every owned slot, in any order.
      if (watch.pending.size !== slots.size) return;
      const at = performance.timeOrigin + performance.now();
      watch.pending.clear();
      watch.changes.push({ at, scheme: getComputedStyle(root).colorScheme,
        colour: Object.fromEntries(colourProps.map(([slot, prop]) => [slot, style.getPropertyValue(prop).trim().toLowerCase()])),
        skin: Object.fromEntries(skinProps.map(([slot, prop]) => [slot, style.getPropertyValue(prop).trim()])) });
    };
  }, { colours: APPEARANCE_SLOTS.colour, skins: APPEARANCE_SLOTS.skin });
  return { stamps: 0, operations, writes: 0 };
}

async function stamp(page: Page): Promise<string> {
  return page.evaluate(() => `${document.documentElement.getAttribute('data-skin') ?? ''}|${document.documentElement.getAttribute('data-theme') ?? ''}`);
}

async function checkTransition(page: Page, frame: Frame, cursor: TransitionCursor, device: 'light' | 'dark',
  transition: string, action: () => Promise<void>) {
  const before = await stamp(page);
  const handle = await page.locator('.docs-reader iframe').elementHandle();
  const nonce = (await seedOf(page)).nonce;
  expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  const scroll = await frame.evaluate(() => {
    const { __frameWatch: watch } = window as unknown as { __frameWatch: FrameWatch };
    watch.old = document.querySelector('figure.mermaid-figure svg');
    if (!watch.old) throw new Error('drawn figure absent');
    return window.scrollY;
  });
  expect(scroll).toBeGreaterThan(0);
  const clocks = () => page.evaluate(({ stamps, operations }) => {
    const w = window as unknown as HostWatch;
    return { hostTimes: w.__hostTimes.slice(stamps), operations: w.__appearanceOps.slice(operations) };
  }, cursor);
  const writes = () => frame.evaluate((offset) => {
    const { __frameWatch: watch } = window as unknown as { __frameWatch: FrameWatch };
    return { samples: watch.changes.slice(offset), pending: [...watch.pending], repeats: watch.repeats,
      sameFigure: document.querySelector('figure.mermaid-figure svg') === watch.old };
  }, cursor.writes);
  let after: string;
  try {
    await action();
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    after = await stamp(page);
    if (before !== after) {
      // A redraw is independent of the write probe, so a redraw without an appearance write is assertion-red.
      await frame.waitForFunction(() => {
        const { __frameWatch: watch } = window as unknown as { __frameWatch: FrameWatch };
        const svg = document.querySelector('figure.mermaid-figure svg');
        return svg !== null && svg !== watch.old;
      }, undefined, { timeout: 90_000 });
    }
  } catch (error) {
    if (MEASURE) {
      const [host, inner] = await Promise.allSettled([clocks(), writes()]);
      console.log(`AP-5-TRANSITION ${JSON.stringify({ device, transition, before, incomplete: true,
        hostStampMs: host.status === 'fulfilled' ? host.value.hostTimes[0] ?? null : null,
        operationSendMs: host.status === 'fulfilled' ? host.value.operations[0]?.at ?? null : null,
        frameWriteMs: inner.status === 'fulfilled' ? inner.value.samples[0]?.at ?? null : null })}`);
    }
    throw error;
  }
  const effective = before !== after;
  const [{ hostTimes, operations }, { samples, pending, repeats, sameFigure }] = await Promise.all([clocks(), writes()]);
  cursor.stamps += hostTimes.length;
  cursor.operations += operations.length;
  cursor.writes += samples.length;
  const sample = { transition, before, after, effective, hostStampMs: hostTimes[0] ?? null,
    operationSendMs: operations[0]?.at ?? null, frameWriteMs: samples[0]?.at ?? null };
  const latencyMs = sample.frameWriteMs !== null && sample.hostStampMs !== null ? sample.frameWriteMs - sample.hostStampMs : null;
  if (MEASURE) console.log(`AP-5-TRANSITION ${JSON.stringify({ device, ...sample, latencyMs })}`);
  expect(hostTimes, `${transition}: applied stamp writes`).toHaveLength(effective ? 1 : 0);
  expect(operations, `${transition}: appearance operation count`).toHaveLength(effective ? 1 : 0);
  expect(samples, `${transition}: in-frame appearance write count`).toHaveLength(effective ? 1 : 0);
  expect({ pending, repeats }, `${transition}: no partial or repeated slot write`).toEqual({ pending: [], repeats: [] });
  expect(sameFigure, `${transition}: only an applied change redraws`).toBe(!effective);
  if (effective) {
    // Check the first and only write before driving the next transition; a later matching write cannot mask a reorder.
    const { at: _, ...appearance } = samples[0]!;
    expect(appearance, `${transition}: matching in-frame appearance write`).toEqual(await hostAppearanceValues(page));
  }
  expect(await handle?.evaluate((el) => el === document.querySelector('.docs-reader iframe')), 'same iframe element').toBe(true);
  expect((await seedOf(page)).nonce, 'same mount nonce').toBe(nonce);
  expect(Math.abs((await frame.evaluate(() => window.scrollY)) - scroll), 'frame scroll delta').toBeLessThanOrEqual(1);
  return { ...sample, latencyMs };
}

function contrast(a: readonly number[], b: readonly number[]): number {
  const luminance = (rgb: readonly number[]): number => {
    const values = rgb.map((n) => { const x = n / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * values[0]! + 0.7152 * values[1]! + 0.0722 * values[2]!;
  };
  const x = luminance(a); const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Resolve each library pair in the actual frame, including its derived colour-mix values, to painted RGB pixels.
async function measuredPairs(frame: Frame): Promise<{ fg: string; bg: string; floor: number; a: number[]; b: number[] }[]> {
  return frame.evaluate((pairs) => {
    const root = document.querySelector('[data-docreader-root]');
    if (!root) throw new Error('reader root absent');
    const probe = document.createElement('span'); root.append(probe);
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas unavailable');
    const expression = (name: string): string => {
      if (name === 'derived:accent-hover') return 'var(--accent-hover)';
      const tint = /^tint:([^@]+)@(.+)$/.exec(name);
      return tint ? `color-mix(in srgb, var(--${tint[1]}) 4%, var(--${tint[2]}))` : `var(--${name})`;
    };
    const pixel = (name: string): number[] => {
      probe.style.color = expression(name);
      const value = getComputedStyle(probe).color;
      if (!value || value === 'transparent') throw new Error(`unresolved colour ${name}: ${value}`);
      context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
      const rgba = [...context.getImageData(0, 0, 1, 1).data];
      if (rgba[3] !== 255) throw new Error(`non-opaque colour ${name}: ${value}`);
      return rgba.slice(0, 3);
    };
    try { return pairs.map((p) => ({ ...p, a: pixel(p.fg), b: pixel(p.bg) })); }
    finally { probe.remove(); }
  }, APPEARANCE_PAIRS);
}

type FigurePaint = { label: string; ink: number[]; ground: number[]; floor: number };

/** Read ink and grounds from the drawn SVG, not from Mermaid's theme configuration. */
function drawingPaint(svg: Element): { labels: FigurePaint[]; lines: FigurePaint[]; hollowMarkers: { fill: string; stroke: string; width: string }[] } {
  if (!(svg instanceof SVGSVGElement)) throw new Error('missing figure SVG');
  const plate = svg.parentElement;
  if (!plate) throw new Error('missing figure plate');
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas unavailable');
  const pixel = (value: string): number[] => {
    if (!CSS.supports('color', value)) throw new Error(`unresolved drawing paint: ${value}`);
    context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  };
  const over = (rgba: readonly number[], ground: readonly number[], opacity = 1): number[] => {
    const alpha = rgba[3]! / 255 * opacity;
    return ground.map((x, i) => rgba[i]! * alpha + x * (1 - alpha));
  };
  const css = (el: Element): CSSStyleDeclaration => getComputedStyle(el);
  const probe = document.createElement('span'); probe.hidden = true; plate.append(probe);
  const token = (name: string): string => {
    probe.style.color = `var(--${name})`;
    return css(probe).color;
  };
  const grounds = ['surface', 'surface2'].map((name) => pixel(token(name)).slice(0, 3));
  const rules = [token('border'), token('rule')];
  const plateColour = pixel(css(plate).backgroundColor);
  probe.remove();
  if (plateColour[3] !== 255) throw new Error('hosted figure plate is not opaque');
  const hidden = 'defs, marker, clipPath, mask, pattern, style, title, desc';
  const visible = (el: Element): boolean => !el.closest(hidden) && css(el).visibility === 'visible' && el.getClientRects().length > 0;
  const opacity = (el: Element): number => {
    let alpha = 1;
    for (let n: Element | null = el; n && n !== plate; n = n.parentElement) alpha *= Number(css(n).opacity);
    return alpha;
  };
  const shapes = [...svg.querySelectorAll<SVGGeometryElement>('rect, circle, ellipse, polygon, polyline, path, line')].filter(visible);
  const fills = shapes.flatMap((el) => {
    const s = css(el); const matrix = el.getScreenCTM();
    if (el.localName === 'line' || s.fill === 'none' || !matrix) return [];
    return [{ el, fill: pixel(s.fill), alpha: Number(s.fillOpacity) * opacity(el), box: el.getBoundingClientRect(), inv: matrix.inverse() }];
  });
  const labels: FigurePaint[] = [];
  const walker = document.createTreeWalker(svg, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const el = n.parentElement;
    const label = n.textContent?.trim();
    if (!label || !el || !visible(el) || opacity(el) === 0) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const box = range.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const s = css(el); const svgText = el instanceof SVGElement;
    const ink = pixel(svgText ? s.fill : s.color);
    const htmlBackground: number[][] = [];
    for (let p: Element | null = el; p && !(p instanceof SVGElement); p = p.parentElement) {
      htmlBackground.unshift(pixel(css(p).backgroundColor));
    }
    for (const fraction of [0.25, 0.5, 0.75]) {
      const x = box.left + box.width * fraction; const y = box.top + box.height / 2;
      let ground = plateColour.slice(0, 3);
      for (const q of fills) {
        if (!(q.el.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        if (x < q.box.left || x > q.box.right || y < q.box.top || y > q.box.bottom) continue;
        if (q.el.isPointInFill(new DOMPoint(x, y).matrixTransform(q.inv))) ground = over(q.fill, ground, q.alpha);
      }
      for (const bg of htmlBackground) ground = over(bg, ground);
      labels.push({ label, ground, ink: over(ink, ground, opacity(el) * (svgText ? Number(s.fillOpacity) : 1)), floor: 4.5 });
    }
  }
  const lines: FigurePaint[] = [];
  const markers = new Set<Element>();
  for (const el of shapes) {
    const s = css(el);
    for (const marker of [s.markerStart, s.markerMid, s.markerEnd]) {
      const id = /#([^"')]+)["']?\)$/.exec(marker)?.[1];
      const target = id === undefined ? null : document.getElementById(id);
      if (target && svg.contains(target)) markers.add(target);
    }
  }
  const tips = [...markers].flatMap((el) => [...el.querySelectorAll('path, circle, rect, polygon, polyline, line')]);
  const hollowMarkers: { fill: string; stroke: string; width: string }[] = [];
  for (const el of [...shapes, ...tips]) {
    const s = css(el);
    const paints: Array<[part: 'stroke' | 'fill', colour: string, alpha: number]> = [];
    // Pie slice gaps are the plate, not a line. Commit-internal marks are not connecting lines.
    if (el.matches('.pieCircle, .commit-merge')) continue;
    const hollow = el.matches('marker.zeroOrOne > circle, marker.zeroOrMore > circle');
    if (hollow) hollowMarkers.push({ fill: s.fill, stroke: s.stroke, width: s.strokeWidth });
    if (s.stroke !== 'none' && parseFloat(s.strokeWidth) > 0) paints.push(['stroke', s.stroke, Number(s.strokeOpacity)]);
    // A hollow ER marker uses its fill as ground; the outline is the meaningful paint.
    if (!hollow && el.closest('marker') && el.localName !== 'line' && s.fill !== 'none') paints.push(['fill', s.fill, Number(s.fillOpacity)]);
    for (const [part, colour, alpha] of paints) {
      if ((!hollow && rules.includes(colour)) || alpha === 0 || opacity(el) === 0) continue;
      const ink = pixel(colour);
      if (ink[3] === 0) continue;
      const label = `${el.localName}.${el.getAttribute('class') ?? ''} ${part} ${colour}`;
      for (const ground of grounds) lines.push({ label, ground, ink: over(ink, ground, alpha * opacity(el)), floor: 3 });
    }
  }
  return { labels, lines, hollowMarkers };
}

describe('Docs hosted appearance', () => {
  const appearances = [...THEMES.map((t) => ({ theme: t.id, device: 'light' as const })),
    { theme: SYSTEM, device: 'light' as const }, { theme: SYSTEM, device: 'dark' as const }];

  it('the installed validator accepts every mapped token from the production CSS', async () => {
    const tokens = [...new Set([
      ...Object.values(READER_APPEARANCE_MAP.colour), ...Object.values(READER_APPEARANCE_MAP.skin),
      '--family-ui', '--family-mono',
    ] as const)];
    const failures: unknown[] = [];
    for (const pointer of ['fine', 'coarse'] as const) for (const { id: skin } of SKINS) for (const choice of appearances) {
      const app = await openApp(browser, { width: 1280, touch: pointer === 'coarse', skin, theme: choice.theme }, { api: {}, fleetFrames: [] });
      try {
        await app.page.emulateMedia({ colorScheme: choice.device });
        await app.page.goto(`${server.origin}/fleet`, { waitUntil: 'load' });
        const actual = await app.page.evaluate((names) => {
          const root = document.documentElement;
          const style = getComputedStyle(root);
          return {
            skin: root.getAttribute('data-skin'), palette: root.getAttribute('data-theme'), scheme: style.colorScheme,
            pointer: matchMedia('(pointer: fine)').matches ? 'fine' : matchMedia('(pointer: coarse)').matches ? 'coarse' : 'none',
            tokens: Object.fromEntries(names.map((token) => [token, style.getPropertyValue(token)])),
          };
        }, tokens);
        const palette = choice.theme === SYSTEM ? (choice.device === 'light' ? 'light' : PHOSPHOR) : choice.theme;
        const selected = THEMES.find((t) => t.id === palette);
        expect(selected, `applied palette ${palette} is in the catalogue`).toBeDefined();
        expect([actual.skin, actual.palette ?? PHOSPHOR, actual.scheme, actual.pointer]).toEqual([skin, palette, selected!.mode, pointer]);
        expect(app.errors).toEqual([]);
        // No spelling conversion here: the adapter forwards this text to the installed validator unchanged.
        const verdict = readerAppearanceOf((token) => actual.tokens[token] ?? '', actual.scheme);
        const combination = { skin, pointer, choice, palette };
        for (const { key, why } of verdict.refused) {
          const [group, slot] = key.split('.');
          const map = group === 'colour' ? READER_APPEARANCE_MAP.colour : group === 'skin' ? READER_APPEARANCE_MAP.skin : {};
          const token = (map as Readonly<Record<string, string>>)[slot ?? ''];
          failures.push({ ...combination, key, token, text: token === undefined ? undefined : actual.tokens[token], why });
        }
        if (verdict.dropped !== null && verdict.refused.length === 0) failures.push({ ...combination, ...verdict.dropped });
        for (const slot of APPEARANCE_SLOTS.skin) {
          if (verdict.value.skin?.[slot] === undefined && !verdict.refused.some(({ key }) => key === `skin.${slot}`)) {
            failures.push({ ...combination, key: `skin.${slot}`, token: READER_APPEARANCE_MAP.skin[slot], why: 'missing' });
          }
        }
      } finally {
        await app.ctx.close();
      }
    }
    expect(failures, 'every built token that the bridge forwards must survive the installed validator').toEqual([]);
  }, 300_000);

  it('AP-1 AP-2: each discovered palette and both system modes in each skin', async () => {
    console.log(`AP-1 AP-2 opens ${SKINS.length * appearances.length} (${SKINS.length} skins x ${appearances.length} appearances)`);
    for (const skin of SKINS) for (const choice of appearances) {
      const app = await open(skin.id, choice.theme, choice.device);
      try { await assertAppearance(app.page); expect(app.errors).toEqual([]); } finally { await app.ctx.close(); }
    }
  }, 600_000);

  it.each([['light', 'dark'], ['phosphor', 'light']] as const)('AP-3: %s host ignores stale %s reader theme', async (theme, stale) => {
    const app = await open(SKINS[0]!.id, theme, 'light', stale);
    try {
      const { scheme, colour } = await hostAppearanceValues(app.page);
      const { atReady, frameTrace } = await (await frameOf(app.page)).evaluate(() => {
        const w = window as Window & { __appearanceAtReady?: unknown; __firstReadyTrace?: FirstReadyTrace };
        return { atReady: w.__appearanceAtReady, frameTrace: w.__firstReadyTrace };
      });
      const hostTrace = await firstReadyHostTrace(app.page);
      const { mountedAt } = hostTrace;
      const fromMount = (at: number | undefined) => at === undefined || mountedAt === undefined ? null : at - mountedAt;
      const trace = { hostTrace, frameTrace: frameTrace ?? null, sentAfterMountMs: fromMount(frameTrace?.sent?.at),
        admittedAfterMountMs: fromMount(hostTrace.admittedAt), fallbackAfterMountMs: fromMount(hostTrace.fallbackAt) };
      expect(atReady, `the frame sent ready with the console appearance already applied; first-ready trace: ${JSON.stringify(trace)}`)
        .toEqual({ scheme, colour });
      await assertAppearance(app.page);
      expect(app.errors).toEqual([]);
    } finally { await app.ctx.close(); }
  }, 120_000);

  it('AP-4: a held bridge chunk seeds the latest palette and skin', async () => {
    expect(SKINS.length).toBeGreaterThanOrEqual(2);
    const targetTheme = THEMES.find((t) => t.id !== 'light');
    if (!targetTheme) throw new Error('no alternate palette');
    let release!: () => void;
    let arrived!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const arrival = new Promise<void>((done) => { arrived = done; });
    const app = await open(SKINS[0]!.id, 'light', 'light', undefined, async (pending) => {
      await pending.ctx.route(/\/assets\/bridge-[^/]+\.js$/, async (route) => {
        arrived();
        await gate;
        await route.fallback();
      });
      return async () => {
        await Promise.race([arrival, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('bridge chunk did not arrive')), 60_000))]);
        try {
          expect(await pending.page.locator('.docs-reader iframe').count()).toBe(0);
          await choose(pending.page, 'theme', targetTheme.label);
          await choose(pending.page, 'layout', SKINS[1]!.label);
        } finally { release(); }
      };
    });
    try {
      const choices = await app.page.evaluate(({ themeKey, skinKey }) => [
        localStorage.getItem(themeKey), localStorage.getItem(skinKey),
      ], { themeKey: THEME_STORAGE_KEY, skinKey: SKIN_STORAGE_KEY });
      expect(choices).toEqual([targetTheme.id, SKINS[1]!.id]);
      const seedColour = await app.page.locator('.docs-reader iframe').evaluate((el) => {
        const doc = new DOMParser().parseFromString(el.getAttribute('srcdoc') ?? '', 'text/html');
        const seed = doc.querySelector('head script[type="application/json"]');
        if (!seed) throw new Error('frame seed absent');
        return (JSON.parse(seed.textContent ?? '') as { appearance?: { colour?: Record<string, string>; skin?: Record<string, string> } }).appearance;
      });
      const hostValues = await hostAppearanceValues(app.page);
      expect(seedColour?.colour).toEqual(hostValues.colour);
      expect(seedColour?.skin).toEqual(hostValues.skin);
      await assertAppearance(app.page);
      await app.page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      const ops = await app.page.evaluate(() => (window as unknown as { __appearanceOps: unknown[] }).__appearanceOps.length);
      expect(ops, 'at most one appearance operation while opening').toBeLessThanOrEqual(1);
    } finally { await app.ctx.close(); }
  }, 180_000);

  it.each(['light', 'dark'] as const)('AP-5: palette and skin transitions in place with device %s', async (device) => {
    const startLoad = MEASURE ? readerTimingLoad() : undefined;
    expect(THEMES.length).toBeGreaterThan(1);
    expect(SKINS.length).toBeGreaterThanOrEqual(2);
    type Timed = Awaited<ReturnType<typeof checkTransition>> & { latencyMs: number };
    let worst: Timed | undefined;
    let allClocksOrdered = true;
    let effective = 0;
    let noops = 0;
    let app: OpenedApp | undefined;
    let complete = false;
    const ceiling = APPEARANCE_FOLLOW_MAX_MS;
    try {
      app = await open(SKINS[0]!.id, THEMES[0]!.id, device);
      const { page } = app;
      const frame = await frameOf(page);
      await prepareFigure(frame);
      const cursor = await watchTransitions(page, frame);
      const run = async (transition: string, action: () => Promise<void>): Promise<void> => {
        const sample = await checkTransition(page, frame, cursor, device, transition, action);
        if (sample.effective) effective += 1;
        else noops += 1;
        if (MEASURE && sample.effective) {
          const { hostStampMs, operationSendMs, frameWriteMs, latencyMs } = sample;
          allClocksOrdered &&= hostStampMs !== null && operationSendMs !== null && frameWriteMs !== null
            && hostStampMs <= operationSendMs && operationSendMs <= frameWriteMs;
          if (latencyMs !== null && (!worst || latencyMs > worst.latencyMs)) worst = { ...sample, latencyMs };
        }
      };
      for (let i = 0; i < THEMES.length; i += 1) {
        const current = THEMES[i]!;
        const next = THEMES[(i + 1) % THEMES.length]!;
        expect(current.id).not.toBe(next.id);
        await run(`${current.id} → ${next.id}`, () => choose(page, 'theme', next.label));
        await run(`${next.id} → Follow system`, () => choose(page, 'theme', 'Follow system'));
        await run(`Follow system → ${next.id}`, () => choose(page, 'theme', next.label));
      }
      await run(`${THEMES[0]!.id} → Follow system`, () => choose(page, 'theme', 'Follow system'));
      const otherMode = device === 'light' ? 'dark' : 'light';
      await run(`Follow system: device ${device} → ${otherMode}`, () => page.emulateMedia({ colorScheme: otherMode }));
      await run(`Follow system: device ${otherMode} → ${device}`, () => page.emulateMedia({ colorScheme: device }));
      await run(`skin ${SKINS[0]!.id} → ${SKINS[1]!.id}`, () => choose(page, 'layout', SKINS[1]!.label));
      await run(`skin ${SKINS[1]!.id} → ${SKINS[0]!.id}`, () => choose(page, 'layout', SKINS[0]!.label));
      console.log(`AP-5 ${device}: ${effective} effective, ${noops} no-op transitions, ${THEMES.length} discovered palettes`);
      expect(effective + noops).toBe(THEMES.length * 3 + 5);
      expect(app.errors).toEqual([]);
      complete = true;
    } finally {
      if (MEASURE) {
        const reading = complete && worst && allClocksOrdered
          ? readerCeilingReading(worst.latencyMs, ceiling, 'AP-M27').reading : 'incomplete';
        console.log(`AP-5-TIMING ${JSON.stringify({ device, startLoad, endLoad: readerTimingLoad(), ceiling, reading, worst })}`);
      }
      await app?.ctx.close();
    }
    if (MEASURE) {
      expect(worst, `${device}: measured an applied appearance write`).toBeDefined();
      expect(allClocksOrdered, `${device}: host stamp, operation send and frame write are ordered`).toBe(true);
      if (readerCeilingReading(worst!.latencyMs, ceiling, 'AP-M27').assertCeiling) {
        expect(worst!.latencyMs, `${device}: ${worst!.transition} appearance latency in ms`).toBeLessThanOrEqual(ceiling);
      }
    }
  }, 1_200_000);

  it('D-9054: drawn figures redraw nearest first in separate tasks and cancel the old queue', async () => {
    const startLoad = MEASURE ? readerTimingLoad() : undefined;
    const count = 4;
    const spacer = 'A paragraph keeps the next figure at a distinct distance.\n\n'.repeat(24);
    const text = `# Redraw order\n\n${Array.from({ length: count }, (_, i) => `## Figure ${i + 1}\n\n\`\`\`mermaid\nflowchart LR\n  A[Start ${i + 1}] --> B[Finish]\n\`\`\`\n\n${spacer}`).join('')}`;
    const initial = THEMES[0]!;
    const first = THEMES[1]!;
    const newest = THEMES[2]!;
    const app = await open(SKINS[0]!.id, initial.id, 'light', undefined, undefined, text);
    try {
      const { page } = app;
      const frame = await frameOf(page);
      const figures = frame.locator(REDRAW_FIGURE);
      const initialPaint = (await hostAppearanceValues(page)).colour.surface2;
      expect(await figures.count()).toBe(count);
      for (const figure of await figures.all()) {
        await figure.locator('.fig-render-btn').click();
        await figure.locator('svg[data-docreader-hosted-figure]').waitFor({ state: 'attached' });
      }
      await figures.last().evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const geometry = await watchRedraws(frame, !MEASURE);
      expect(new Set(geometry.map(({ distance }) => distance)).size, 'every drawing has a distinct viewport distance').toBe(count);
      const order = [...geometry].sort((a, b) => a.distance - b.distance).map(({ figure }) => figure);
      expect(order, 'distance is not document order').not.toEqual([0, 1, 2, 3]);
      expect((await readRedraws(frame)).paints).toEqual(Array<string>(count).fill(initialPaint!));
      const redraw = async (): Promise<void> => {
        await choose(page, 'theme', first.label);
        await waitForRedraws(frame, count);
        if (!MEASURE) await waitForRedrawDrain(frame);
      };
      const tasks = MEASURE ? (await redraw(), undefined) : await traceRedrawTasks(page, redraw);
      const firstPaint = (await hostAppearanceValues(page)).colour.surface2;
      expect(firstPaint).not.toBe(initialPaint);
      const firstRun = await readRedraws(frame);
      if (tasks) {
        expect(tasks.starts, 'one trace mark for each actual redraw start').toHaveLength(count);
        expect(new Set(tasks.starts).size, 'one figure redraw per Chromium task').toBe(count);
        expect(tasks.writes, 'one trace mark for each SVG replacement').toHaveLength(count);
        expect(new Set(tasks.writes).size, 'one SVG replacement per Chromium task').toBe(count);
      }
      expect(firstRun.starts, 'nearest-first redraw starts').toEqual(order);
      expect(firstRun.writes.map(({ figure }) => figure), 'nearest-first redraw writes').toEqual(order);
      expect(firstRun.writes.map(({ paint }) => paint), 'every drawing was repainted exactly once').toEqual(Array<string>(count).fill(firstPaint!));
      if (MEASURE) {
        const gapsMs = firstRun.writes.slice(1).map(({ at }, i) => at - firstRun.writes[i]!.at);
        const ceiling = 200;
        const worstMs = Math.max(...gapsMs);
        expect(gapsMs.every((ms) => Number.isFinite(ms) && ms >= 0), 'finite, ordered redraw times').toBe(true);
        const { reading, assertCeiling } = readerCeilingReading(worstMs, ceiling, 'AP-M31');
        console.log(`AP-REDRAW-GAPS ${JSON.stringify({ startLoad, endLoad: readerTimingLoad(), gapsMs, worstMs, ceiling, reading })}`);
        if (assertCeiling) expect(worstMs, 'consecutive figure redraw gap in ms').toBeLessThanOrEqual(ceiling);
      }

      await setRedrawGate(frame, 'holdAfterNextWrite');
      await choose(page, 'theme', initial.label);
      await waitForRedraws(frame, count + 1, true);
      const queued = await readRedraws(frame);
      expect(queued.writes.slice(count).map(({ paint }) => paint), 'one old redraw completed before the gate').toEqual([initialPaint]);
      expect(queued.starts).toHaveLength(count + 1);
      await choose(page, 'theme', newest.label);
      const newestPaint = (await hostAppearanceValues(page)).colour.surface2;
      expect(new Set([initialPaint, firstPaint, newestPaint]).size, 'the three actual host paints differ').toBe(3);
      await frame.waitForFunction((want) => {
        const root = document.querySelector('[data-docreader-root]');
        return root && getComputedStyle(root).getPropertyValue('--surface2').trim() === want;
      }, newestPaint, { timeout: 90_000 });
      expect((await readRedraws(frame)).writes).toHaveLength(count + 1);
      await setRedrawGate(frame, 'release');
      await waitForRedraws(frame, 2 * count + 1);
      await waitForRedrawDrain(frame);
      const final = await readRedraws(frame);
      expect(final.starts.slice(count + 1), 'the newer appearance canceled all older queued starts').toEqual(order);
      expect(final.writes.slice(count + 1).map(({ figure }) => figure), 'only the newest redraw queue completed').toEqual(order);
      expect(final.writes.slice(count + 1).map(({ paint }) => paint), 'no old paint after the newer appearance arrived').toEqual(Array<string>(count).fill(newestPaint!));
      expect(final.paints, 'all drawn figures finish in the newest colours').toEqual(Array<string>(count).fill(newestPaint!));
      console.log(`AP-REDRAW ${JSON.stringify({ geometry, order, tasks, oldTimersHeld: queued.held, newestPaint })}`);
      expect(app.errors).toEqual([]);
    } finally { await app.ctx.close(); }
  }, 240_000);

  it('AP-6: native chrome computes the host skin tokens in each skin', async () => {
    const text = `${DOC}\n## Plan\n\n- [ ] **Step 1 (reader): Check the controls.**\n`;
    for (const skin of SKINS) {
      const app = await open(skin.id, 'light', 'light', undefined, undefined, text);
      try {
        const host = await app.page.evaluate(() => {
          const p = document.createElement('div');
          p.style.cssText = 'position:absolute;box-shadow:var(--elev-pop);border-radius:var(--r-md);height:var(--row-h);font-size:var(--fs-section);font-weight:var(--weight-section);letter-spacing:var(--ls-section);text-transform:var(--case-section)';
          document.body.append(p);
          const cs = getComputedStyle(p);
          const out = { shadow: cs.boxShadow, radius: cs.borderTopLeftRadius, row: cs.height, fontSize: cs.fontSize, fontWeight: cs.fontWeight, tracking: cs.letterSpacing, casing: cs.textTransform,
            family: getComputedStyle(document.documentElement).getPropertyValue('--family-section').trim() === getComputedStyle(document.documentElement).getPropertyValue('--family-mono').trim() ? 'mono' : 'sans' };
          p.style.borderRadius = 'var(--r-sm)'; const small = getComputedStyle(p).borderTopLeftRadius;
          p.style.borderRadius = 'var(--r-lg)'; const large = getComputedStyle(p).borderTopLeftRadius;
          p.remove(); return { ...out, small, large };
        });
        const frame = await frameOf(app.page);
        await frame.locator('.aa-btn').click();
        const chrome = await frame.evaluate(() => {
          const cs = (selector: string): CSSStyleDeclaration => {
            const el = document.querySelector(selector); if (!el) throw new Error(`missing chrome ${selector}`); return getComputedStyle(el);
          };
          const menu = cs('.aa-menu'); const legend = cs('.aa-menu legend');
          const row = cs('.aa-menu .opt'); const label = cs('.aa-menu .opt label'); const segment = cs('.aa-menu .seg');
          const block = (s: CSSStyleDeclaration) => ({ height: s.height, lineHeight: s.lineHeight,
            paddingTop: s.paddingTop, paddingBottom: s.paddingBottom,
            borderTop: s.borderTopWidth, borderBottom: s.borderBottomWidth, boxSizing: s.boxSizing });
          return { shadow: menu.boxShadow, radius: cs('.aa-menu .aa-btns button').borderTopLeftRadius,
            small: cs('li.task-list-item .who').borderTopLeftRadius, large: menu.borderTopLeftRadius,
            row: row.height, minimum: row.minHeight,
            heightDetail: { row: block(row), label: block(label), gap: segment.rowGap },
            fontSize: legend.fontSize, fontWeight: legend.fontWeight, tracking: legend.letterSpacing, casing: legend.textTransform,
            family: legend.fontFamily };
        });
        console.log(`AP-6-AA-ROW ${JSON.stringify({ skin: skin.id, host: host.row, minHeight: chrome.minimum, ...chrome.heightDetail })}`);
        for (const key of ['shadow', 'radius', 'small', 'large', 'fontSize', 'fontWeight', 'tracking', 'casing'] as const) {
          expect(chrome[key], `${skin.id}: ${key}`).toBe(host[key]);
        }
        // D-9053: compare the floor and the rendered height separately at the default text size.
        const floor = parseFloat(host.row);
        const rendered = parseFloat(chrome.row);
        expect(chrome.minimum, `${skin.id}: Aa row minimum equals host control row`).toBe(host.row);
        expect(rendered, `${skin.id}: Aa row reaches the floor`).toBeGreaterThanOrEqual(floor);
        expect(rendered, `${skin.id}: Aa row is at most 2px above the floor`).toBeLessThanOrEqual(floor + 2);
        expect(chrome.family.replaceAll('"', '').startsWith(`Docreader Host ${host.family === 'mono' ? 'Mono' : 'Sans'}`)).toBe(true);
      } finally { await app.ctx.close(); }
    }
  }, 240_000);

  it('AP-6: preference persistence, hosted Aa and keyboard focus', async () => {
    const app = await open(SKINS[0]!.id, THEMES[0]!.id, 'light');
    try {
      let frame = await frameOf(app.page);
      await frame.locator('.aa-btn').click();
      const line = frame.locator('.aa-menu .aa-hosted');
      expect(await line.textContent()).toBe(READER_APPEARANCE_LABEL);
      expect(await frame.locator('input[data-pref="theme"]').count()).toBe(0);
      expect(await line.evaluate((el) => ({ tag: el.tagName, tab: (el as HTMLElement).tabIndex }))).toEqual({ tag: 'P', tab: -1 });
      await frame.locator('input[data-pref="width"][value="wide"]').check({ force: true });
      await frame.locator('input[data-pref="font"][value="sans"]').check({ force: true });
      const prefKey = `${READER_STORE_PREFIX}pref:prefs`;
      await app.page.waitForFunction((key) => {
        const value = localStorage.getItem(key);
        if (!value) return false;
        const pref = JSON.parse(value) as { width?: string; font?: string };
        return pref.width === 'wide' && pref.font === 'sans';
      }, prefKey, { timeout: 10_000 });
      const prefs = await app.page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>, prefKey);
      expect(prefs).not.toHaveProperty('theme');
      // Tab through actual controls, recording that the static label never becomes the active element.
      await frame.locator('.aa-btn').focus();
      for (let i = 0; i < 12; i += 1) {
        await app.page.keyboard.press('Tab');
        expect(await frame.evaluate(() => document.activeElement?.classList.contains('aa-hosted') ?? false)).toBe(false);
      }
      await frame.locator('.aa-btn').click();
      const fold = frame.locator('.h-fold').first();
      expect(await fold.getAttribute('aria-expanded')).toBe('true');
      await fold.click({ force: true });
      expect(await fold.getAttribute('aria-expanded')).toBe('false');
      await app.page.waitForFunction((prefix) => Object.keys(localStorage).some((k) => k.startsWith(prefix) && k.endsWith(':folds') && (localStorage.getItem(k) ?? '').includes('words-used-here')),
        READER_STORE_PREFIX, { timeout: 10_000 });
      await app.page.reload({ waitUntil: 'domcontentloaded' });
      await app.page.waitForFunction(() => document.querySelector('.docs-reader iframe') !== null && document.querySelector('.doc-formatting') === null,
        undefined, { timeout: 90_000 });
      frame = await frameOf(app.page);
      await frame.locator('.aa-btn').click();
      expect(await frame.locator('input[data-pref="width"][value="wide"]').isChecked()).toBe(true);
      expect(await frame.locator('input[data-pref="font"][value="sans"]').isChecked()).toBe(true);
      expect(await frame.locator('.h-fold').first().getAttribute('aria-expanded')).toBe('false');
      expect(app.errors).toEqual([]);
    } finally { await app.ctx.close(); }
  }, 180_000);

  it('AP-6: a real lab-profile mount keeps the Aa theme control', async () => {
    const app = await openApp(browser, { width: 1280, skin: SKINS[0]!.id, theme: 'light' }, { api: {}, fleetFrames: [] });
    const nonce = 'BBBBBBBBBBBBBBBBBBBBBB';
    let tapped = false;
    const zero = (keys: readonly string[]): Record<string, number> => Object.fromEntries(keys.map((key) => [key, 0]));
    try {
      // Only the lab's server door is a fixture. The page, lazy adapter, iframe and its menu are the built app's.
      await app.ctx.route((url) => url.pathname.startsWith('/api/reader-lab/'), async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === READER_LAB_RUNS_PATH) { await route.fulfill({ json: { ok: true, nonce, ttlMs: 900_000 } }); return; }
        if (path === readerLabRunPath(nonce)) {
          const probes = Object.fromEntries(LAB_PROBE_NAMES.map((name) => [name, {
            hits: name === 'popup-ran' && tapped ? 1 : 0, cookie: 0, upgrade: 0,
            site: zero(LAB_SITE_CLASSES), origin: zero(LAB_ORIGIN_CLASSES),
          }]));
          await route.fulfill({ json: { ok: true, run: { openedAt: 0, expiresAt: 900_000, counted: Number(tapped), ignored: 0, saturated: false, probes } } });
          return;
        }
        if (path === readerLabClosePath(nonce)) { await route.fulfill({ json: { ok: true, closed: true } }); return; }
        await route.fulfill({ status: 204 });
      });
      await app.page.goto(`${server.origin}/settings/reader-lab`);
      await app.page.getByRole('button', { name: 'Start', exact: true }).click();
      await app.page.frameLocator('.reader-lab-stage > iframe').first().getByRole('button', { name: 'Tap here' }).click({ timeout: 30_000 });
      tapped = true;
      const frame = app.page.frameLocator('.reader-lab-mount iframe').first();
      await frame.locator('.aa-btn').click({ timeout: 75_000 });
      expect(await frame.locator('.aa-menu input[data-pref="theme"][value="auto"]').isChecked()).toBe(true);
      expect(await frame.getByText(READER_APPEARANCE_LABEL, { exact: true }).count()).toBe(0);
    } finally { await app.ctx.close(); }
  }, 120_000);

  it.each(THEMES)('AP-6: every installed Mermaid kind meets its paint floors in $label', async (theme) => {
    const text = '# Figure contrast\n\n' + MERMAID_HOSTED_KINDS.map((kind) => `## ${kind}\n\n\`\`\`mermaid\n${DRAWINGS[kind]}\n\`\`\`\n`).join('\n');
    const app = await open(SKINS[0]!.id, theme.id, theme.mode, undefined, undefined, text);
    try {
      const frame = await frameOf(app.page);
      const figures = frame.locator('figure.mermaid-figure');
      expect(await figures.count()).toBe(MERMAID_HOSTED_KINDS.length);
      const failures: string[] = [];
      for (const [i, kind] of MERMAID_HOSTED_KINDS.entries()) {
        const figure = figures.nth(i);
        const button = figure.locator('.fig-render-btn');
        if (await button.count()) await button.click();
        const svg = figure.locator('pre.mermaid svg');
        await svg.waitFor({ timeout: 30_000 });
        expect(await svg.getAttribute('data-docreader-hosted-figure'), `${kind}: hosted renderer`).not.toBeNull();
        const measured = await svg.evaluate(drawingPaint);
        if (kind === 'er') {
          expect(measured.hollowMarkers.length, 'ER fixture uses a hollow cardinality marker').toBeGreaterThan(0);
          for (const marker of measured.hollowMarkers) {
            expect(marker.stroke, 'hollow marker has an outline').not.toBe('none');
            expect(parseFloat(marker.width), 'hollow marker outline is visible').toBeGreaterThan(0);
          }
          console.log(`AP-6-ER-MARKER ${JSON.stringify({ theme: theme.id, ...measured.hollowMarkers[0] })}`);
        }
        expect(measured.labels.length, `${kind}: at least one painted label`).toBeGreaterThan(0);
        // Pie chart outlines and slice separators are borders/plate, not connecting lines.
        if (kind !== 'pie') expect(measured.lines.length, `${kind}: at least one painted line`).toBeGreaterThan(0);
        for (const sample of [...measured.labels, ...measured.lines]) {
          const ratio = contrast(sample.ink, sample.ground);
          if (ratio < sample.floor) failures.push(`${kind} ${sample.label}: ${ratio.toFixed(2)}:1 < ${sample.floor}:1`);
        }
      }
      expect(failures, theme.id).toEqual([]);
      expect(app.errors).toEqual([]);
    } finally { await app.ctx.close(); }
  }, 240_000);

  it('AP-6: contrast pairs on the computed hosted frame in every palette', async () => {
    for (const theme of THEMES) {
      const app = await open(SKINS[0]!.id, theme.id, theme.mode);
      try {
        const frame = await frameOf(app.page);
        const pairs = await measuredPairs(frame);
        expect(pairs.length).toBe(APPEARANCE_PAIRS.length);
        for (const p of pairs) expect(contrast(p.a, p.b), `${theme.id}: ${p.fg} on ${p.bg}`).toBeGreaterThanOrEqual(p.floor);
        await frame.locator('.aa-btn').click();
        await frame.locator('.aa-btn').focus();
        await app.page.keyboard.press('Tab');
        const focus = await frame.evaluate(() => {
          const active = document.activeElement;
          const label = active?.matches('.aa-menu input') ? active.nextElementSibling : active;
          if (!active || !label) throw new Error('Tab did not reach a focus control');
          const css = getComputedStyle(label);
          return { visible: active.matches(':focus-visible'), style: css.outlineStyle, width: parseFloat(css.outlineWidth), colour: css.outlineColor };
        });
        expect(focus.visible, `${theme.id}: keyboard focus`).toBe(true);
        expect(focus.style).toBe('solid');
        expect(focus.width).toBeGreaterThan(0);
        // The focused control must paint the very colour covered by the 3:1 focus pairs.
        const computedFocus = await frame.evaluate(() => {
          const root = document.querySelector('[data-docreader-root]')!;
          const p = document.createElement('span'); p.style.color = 'var(--focus)'; root.append(p);
          const value = getComputedStyle(p).color; p.remove(); return value;
        });
        expect(focus.colour).toBe(computedFocus);
        await frame.locator('.aa-btn').click();
        await prepareFigure(frame);
        const edge = await frame.evaluate(() => {
          const figure = document.querySelector('figure.mermaid-figure');
          const root = document.querySelector('[data-docreader-root]');
          const path = figure?.querySelector('svg path.flowchart-link');
          if (!root || !path) throw new Error('drawn flowchart edge absent');
          const probe = document.createElement('span'); probe.style.color = 'var(--surface)'; root.append(probe);
          const plate = getComputedStyle(probe).color; probe.remove();
          const stroke = getComputedStyle(path).stroke;
          const c = document.createElement('canvas'); c.width = c.height = 1;
          const ctx = c.getContext('2d'); if (!ctx) throw new Error('canvas unavailable');
          const pixel = (value: string): number[] => {
            if (!CSS.supports('color', value)) throw new Error(`not a colour: ${value}`);
            ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
            const rgba = [...ctx.getImageData(0, 0, 1, 1).data];
            if (rgba[3] !== 255) throw new Error(`not opaque: ${value}`);
            return rgba.slice(0, 3);
          };
          return { stroke, plate, a: pixel(stroke), b: pixel(plate), hosted: figure?.querySelector('svg')?.hasAttribute('data-docreader-hosted-figure') };
        });
        expect(edge.hosted).toBe(true);
        expect(contrast(edge.a, edge.b), `${theme.id}: figure edge on plate`).toBeGreaterThanOrEqual(3);
      } finally { await app.ctx.close(); }
    }
  }, 600_000);

  it('AP-6: link, index and quick-jump cues when palette hues collide', async () => {
    const ids = ['github-light', 'solarized-light', 'catppuccin-latte', 'solarized-dark', 'phosphor', 'light'];
    const cases = ids.map((id) => {
      const found = THEMES.find((theme) => theme.id === id);
      if (!found) throw new Error(`required cue palette absent: ${id}`);
      return found;
    });
    for (const theme of cases) {
      const app = await open(SKINS[0]!.id, theme.id, theme.mode);
      try {
        const frame = await frameOf(app.page);
        const term = frame.locator('a.term').first();
        const xref = frame.locator('a.xref').first();
        const ordinary = frame.getByRole('link', { name: 'ordinary link', exact: true });
        expect(await term.count(), `${theme.id}: fixture glossary link`).toBeGreaterThan(0);
        expect(await xref.count(), `${theme.id}: fixture id link`).toBeGreaterThan(0);
        const styles = await Promise.all([term, xref, ordinary].map((loc) => loc.evaluate((el) => {
          const cs = getComputedStyle(el); return { line: cs.textDecorationLine, style: cs.textDecorationStyle };
        })));
        if (['github-light', 'solarized-light', 'catppuccin-latte'].includes(theme.id)) {
          expect(styles).toEqual([{ line: 'underline', style: 'dotted' }, { line: 'underline', style: 'dashed' }, { line: 'underline', style: 'solid' }]);
        }
        if (['solarized-dark', 'solarized-light'].includes(theme.id)) expect(styles[1]!.style).not.toBe(styles[2]!.style);
        if (['phosphor', 'light'].includes(theme.id)) {
          if (!(await frame.evaluate(() => document.querySelector('[data-docreader-root]')?.classList.contains('toc-open')))) {
            await frame.locator('.toc-btn').click();
          }
          await frame.getByRole('tab', { name: /^Index/ }).click();
          const dots = await frame.evaluate(() => ['ok', 'info'].map((role) => {
            const el = document.querySelector(`.toc-index .dot.${role}`);
            if (!el) throw new Error(`index ${role} dot absent`);
            const cs = getComputedStyle(el); const box = el.getBoundingClientRect();
            return { radius: cs.borderRadius, width: box.width, height: box.height };
          }));
          expect(dots[0]).not.toEqual(dots[1]);
          await frame.getByRole('tab', { name: /^Index/ }).press('Escape');
        }
        await frame.locator('button.jump-btn:visible').click({ timeout: 10_000 });
        await frame.locator('.jump.open li.sel').waitFor({ timeout: 10_000 });
        const jump = await frame.evaluate(() => {
          const root = document.querySelector('[data-docreader-root]');
          const selected = document.querySelector('.jump.open li.sel');
          if (!root || !selected) throw new Error('quick jump selection absent');
          const probe = document.createElement('span'); probe.style.color = 'var(--accent)'; root.append(probe);
          const accent = getComputedStyle(probe).color; probe.remove();
          return { shadow: getComputedStyle(selected).boxShadow, accent };
        });
        expect(jump.shadow).toBe(`${jump.accent} 2px 0px 0px 0px inset`);
      } finally { await app.ctx.close(); }
    }
  }, 600_000);

  it.each(['light', 'phosphor'])('AP-6: author-styled and journey figures retain the library plate and filter in %s', async (theme) => {
    const app = await open(SKINS[0]!.id, theme, 'light');
    try {
      const frame = await frameOf(app.page);
      const figures = frame.locator('figure.mermaid-figure');
      expect(await figures.count()).toBe(3);
      for (const index of [1, 2]) {
        const figure = figures.nth(index);
        const button = figure.locator('.fig-render-btn');
        if (await button.count() > 0) await button.click();
        await frame.waitForFunction((i) => document.querySelectorAll('figure.mermaid-figure')[i]?.getAttribute('data-docreader-draw') === 'drawn', index, { timeout: 90_000 });
        const values = await figure.evaluate((el) => {
          const root = el.closest('[data-docreader-root]');
          const pre = el.querySelector('pre.mermaid:has(svg)'); const svg = pre?.querySelector('svg');
          if (!root || !pre || !svg) throw new Error('fallback drawing absent');
          const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--plate)'; probe.style.filter = 'var(--fig-filter)'; root.append(probe);
          const base = getComputedStyle(probe); const out = {
            hosted: svg.hasAttribute('data-docreader-hosted-figure'), plate: getComputedStyle(pre).backgroundColor,
            filter: getComputedStyle(svg).filter, expectedPlate: base.backgroundColor, expectedFilter: base.filter,
          };
          probe.remove(); return out;
        });
        expect(values.hosted, `fallback figure ${index}`).toBe(false);
        expect(values.plate).toBe(values.expectedPlate);
        expect(values.filter).toBe(values.expectedFilter);
      }
    } finally { await app.ctx.close(); }
  }, 240_000);

  it('AP-8: the mount seed actually carries appearance', async () => {
    const app = await open(SKINS[0]!.id, THEMES[0]!.id, 'light');
    try {
      const appearance = await app.page.locator('.docs-reader iframe').evaluate((el) => {
        const doc = new DOMParser().parseFromString(el.getAttribute('srcdoc') ?? '', 'text/html');
        const seed = doc.querySelector('head script[type="application/json"]');
        if (!seed) throw new Error('frame seed absent');
        return (JSON.parse(seed.textContent ?? '') as { appearance?: unknown }).appearance;
      });
      expect(appearance).toMatchObject({ label: READER_APPEARANCE_LABEL, colour: expect.any(Object), skin: expect.any(Object) });
    } finally { await app.ctx.close(); }
  }, 120_000);
});
