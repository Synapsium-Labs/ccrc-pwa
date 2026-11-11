// Settings › Automation › Test box, the CONNECTED card (test box connect plan TC16, D-8166; spec 2026-11-07 §2.2's second width
// table), in a real Chrome over the production build, at 360, 390, 1280, 1470 and 1920 px, in both skins and both themes.
// `src/fleet/TestBoxManage.test.tsx` holds the card's behaviour in jsdom; this file holds what only an engine can say, row by row
// of the spec's table:
//   * phone (360, 390): one column; the controls full width, one per row, every one at least `--tap-min` tall; the last act one
//     line; the settings families folded; the confirm sheet keeps Confirm and Cancel reachable at 360 by 667;
//   * laptop (1280, 1470): the controls at the end of the state line, the settings a two-column form, the last act under the state;
//   * wide (1920): the settings' two groups side by side and the ledger's last ten acts beside the state.
// At every width nothing in the card or on the page overflows sideways, and every enabled text clears 4.5:1 on the ground it is
// drawn on.
//
// The app answers from a fixture (`browser/app.ts`) and the test's own routes play the fleet: no server, no ccd, no test box. Run:
// `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/testbox-manage.browser.test.ts )`. `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { TESTBOX_PROTO, type StatusAnswer } from '../../shared/testbox';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { TESTBOX_MANAGE_TEXT } from '../src/fleet/testboxAdminWords';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';

const T = TESTBOX_MANAGE_TEXT;
const TITLE = SETTINGS_CARDS.automation.testbox.title;
const SKINS = [REFINED, INSTRUMENT] as const;
const THEMES = ['light', PHOSPHOR] as const;
const WIDTHS = [360, 390, 1280, 1470, 1920] as const;
const bandOf = (width: number): 'phone' | 'laptop' | 'wide' => (width < 900 ? 'phone' : width < 1600 ? 'laptop' : 'wide');

const FP = `SHA256:${'A'.repeat(43)}`;
const TOOLS = { node: '22.11.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };
/** A box running a tree its installer marker (v0.0.800) does not name, so every control, Apply release included, is drawn. */
const STATUS: StatusAnswer = {
  t: 'status', state: 'ok', reason: null, serviceVersion: '1.0.0', proto: TESTBOX_PROTO, release: 'v0.0.899', tools: TOOLS,
  sync: { state: 'idle', detail: null, at: '2026-10-30T10:00:00Z' }, runs: { inProgress: 0, limit: 4 }, queueDepth: 0, pristine: [], failedKeys: [],
  heldRunUsers: [], repositories: [],
};
const BLOCK = {
  state: 'ok', reasons: [], summary: 'ok', switch: 'off', at: Date.now(), host: { tools: TOOLS, release: 'v0.0.900', measuredAt: '2026-10-30T11:59:59Z' },
  box: STATUS, cells: [], counts: { remote: 0, fallback: 0, refused: 0, unreadable: 0, byReason: {} },
  admin: { connected: true, hostKey: 'pinned', act: null, parity: 'pass' },
};
const STATUS_ADMIN = {
  v: 1, connected: true, addressSet: true, login: 'root', fingerprint: FP, hostKey: 'pinned', boxFileSha256: 'f'.repeat(64), act: null,
  boxSettings: [
    { key: 'CCRC_TESTBOX_RUNS', state: 'ok', value: '2', from: 'default' },
    { key: 'CCRC_TESTBOX_WORKERS', state: 'ok', value: '2', from: 'file' },
    { key: 'CCRC_TESTBOX_RUN_MEMORY_MAX', state: 'ok', value: '4G', from: 'file' },
    { key: 'CCRC_TESTBOX_LISTEN', state: 'ok', from: 'file' },
  ],
  boxSettingsAt: 1, installedTag: 'v0.0.800', parity: null,
};
const EVENTS = Array.from({ length: 12 }, (_, i) => ({
  id: 12 - i, at: Date.parse('2026-11-10T12:00:00Z') + (12 - i) * 60_000, actor: 'phone a1b2c3d4', act: 'repair', actId: null, outcome: 'ok', code: null,
  fingerprint: null, fleetIdentity: null,
}));

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [] },
    '/api/runs': { runs: [] },
    '/api/claims': [],
  },
  fleetFrames: [
    { type: 'fleet', sessions: [] },
    { type: 'runs', runs: [] },
    { type: 'coord', coord: { pause: 'clear' } },
  ],
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

interface Box { left: number; right: number; top: number; bottom: number; width: number; height: number }
interface Measured {
  band: string | null;
  viewport: number;
  pageScrollWidth: number;
  pageClientWidth: number;
  card: { scrollWidth: number; clientWidth: number; box: Box };
  tapMin: number;
  state: Box | null;
  controls: Box | null;
  buttons: { name: string; box: Box }[];
  lastAct: { box: Box; lines: number } | null;
  ledger: { box: Box; rows: number } | null;
  main: Box | null;
  settings: Box | null;
  groups: { name: string; box: Box }[];
  families: { open: number; total: number; summaries: Box[] };
  fieldColumns: number;
  inputs: Box[];
  overflowing: string[];
  contrast: { text: string; ratio: number }[];
}

/** The connected card's geometry and ink, measured in the page. */
const measure = (el: Element): Measured => {
  const box = (e: Element): Box => {
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const shown = (e: Element | null): e is Element => e !== null && e.checkVisibility({ contentVisibilityAuto: true });
  const boxOf = (sel: string): Box | null => { const e = el.querySelector(sel); return shown(e) ? box(e) : null; };
  const rgb = (s: string): number[] => {
    const v = (s.match(/[\d.]+/g) ?? []).map(Number);
    return s.startsWith('color(') ? v.map((n) => n * 255) : v;
  };
  const lum = ([r, g, b]: number[]): number => {
    const ch = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * ch(r!) + 0.7152 * ch(g!) + 0.0722 * ch(b!);
  };
  const ratio = (e: Element): number => {
    const k = getComputedStyle(e);
    let bg = k.backgroundColor;
    for (let n: Element | null = e; n !== null && /rgba\(.*,\s*0\)$|transparent/.test(bg); n = n.parentElement) bg = getComputedStyle(n).backgroundColor;
    const [a, b] = [lum(rgb(k.color)), lum(rgb(bg))].sort((x, y) => y - x);
    return (a! + 0.05) / (b! + 0.05);
  };
  const last = el.querySelector<HTMLElement>('[data-testbox="last-act"]');
  const lastBox = shown(last) ? box(last) : null;
  const lineHeight = last === null ? 0 : parseFloat(getComputedStyle(last).lineHeight);
  const ledger = el.querySelector('[data-testbox="manage-ledger"]');
  const textual = [...el.querySelectorAll<HTMLElement>('p, span, label, summary, li, code, dt, dd, legend, button')].filter((e) => {
    if (!shown(e) || (e instanceof HTMLButtonElement && e.disabled)) return false;
    return [...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
  });
  const opened = [...el.querySelectorAll<HTMLInputElement>('.testbox-settings .testbox-form input')].filter(shown);
  return {
    band: el.getAttribute('data-band'),
    viewport: window.innerWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    pageClientWidth: document.documentElement.clientWidth,
    card: { scrollWidth: (el as HTMLElement).scrollWidth, clientWidth: (el as HTMLElement).clientWidth, box: box(el) },
    tapMin: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')),
    state: boxOf('[data-testbox="manage-state"]'),
    controls: boxOf('[data-testbox="manage-controls"]'),
    buttons: [...el.querySelectorAll<HTMLButtonElement>('[data-testbox="manage-controls"] button')].filter((b) => shown(b)).map((b) => ({ name: b.textContent ?? '', box: box(b) })),
    lastAct: lastBox === null ? null : { box: lastBox, lines: Math.round(lastBox.height / (lineHeight || 1)) },
    ledger: ledger !== null && shown(ledger) ? { box: box(ledger), rows: ledger.querySelectorAll('li').length } : null,
    main: boxOf('.testbox-manage-main'),
    settings: boxOf('[data-testbox="settings"]'),
    groups: [...el.querySelectorAll<HTMLElement>('.testbox-settings-group')].filter(shown).map((g) => ({ name: g.getAttribute('data-group') ?? '', box: box(g) })),
    families: {
      open: el.querySelectorAll('.testbox-settings details[open]').length,
      total: el.querySelectorAll('.testbox-settings details').length,
      summaries: [...el.querySelectorAll('.testbox-settings details > summary')].filter(shown).map(box),
    },
    fieldColumns: new Set(opened.map((i) => Math.round(i.getBoundingClientRect().left))).size,
    inputs: opened.map(box),
    overflowing: [...el.querySelectorAll('*')]
      // A text field scrolls its own long value inside itself, as every input does; that is not the layout overflowing.
      .filter((e) => !(e instanceof HTMLInputElement) && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible')
      .map((e) => e.tagName.toLowerCase() + (e.getAttribute('data-testbox') ?? '')),
    contrast: textual.map((e) => ({ text: (e.textContent ?? '').slice(0, 40), ratio: ratio(e) })),
  };
};

/** The checks every view shares, at every width: nothing scrolls sideways, every enabled text clears 4.5:1. */
function common(m: Measured, width: number, at: string): void {
  expect(m.band, `${at}: the band`).toBe(bandOf(width));
  expect(m.card.scrollWidth, `${at}: the card overflows sideways`).toBeLessThanOrEqual(m.card.clientWidth);
  expect(m.overflowing, `${at}: an element inside the card scrolls sideways`).toEqual([]);
  expect(m.pageScrollWidth, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(m.pageClientWidth);
  expect(m.card.box.left, `${at}: left of the viewport`).toBeGreaterThanOrEqual(0);
  expect(m.card.box.right, `${at}: right of the viewport`).toBeLessThanOrEqual(m.viewport);
  const low = m.contrast.filter((c) => c.ratio < 4.5);
  expect(low, `${at}: text under 4.5:1`).toEqual([]);
  expect(m.contrast.length, `${at}: some text was measured`).toBeGreaterThan(0);
}

async function open(skin: string, theme: string, width: number, admin: Record<string, unknown> = STATUS_ADMIN): Promise<{ page: Page; ctx: Awaited<ReturnType<typeof openApp>>['ctx']; errors: string[] }> {
  const { ctx, page, errors } = await openApp(browser!, { skin, theme, width }, FIXTURE);
  const answer = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await ctx.route('**/api/testbox', (r) => r.fulfill(answer({ ok: true, testbox: BLOCK })));
  await ctx.route('**/api/testbox/admin', (r) => r.fulfill(answer({ ok: true, status: admin, events: EVENTS.slice(0, 10) })));
  await ctx.route('**/api/testbox/admin/*', (r) => r.fulfill(answer({ ok: true, status: admin, events: EVENTS.slice(0, 10), result: {} })));
  return { page, ctx, errors };
}

describe.each(SKINS)('the connected test box card in %s', (skin) => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      it(`${theme}, ${width}px: the card, its settings and its sheet at the spec's layout for the band`, async () => {
        const { ctx, page, errors } = await open(skin, theme, width);
        try {
          page.setDefaultTimeout(10_000); // an action that cannot happen fails with its own words, not the test's deadline
          await page.goto(server!.origin + '/settings/automation');
          const section = page.getByRole('region', { name: TITLE });
          const card = section.locator('[data-testbox="manage"]');
          await card.locator('[data-testbox="manage-controls"]').waitFor({ timeout: 20_000 });
          const shots = process.env.CCRC_SHOTS;
          const shot = async (n: string): Promise<void> => {
            if (shots) await section.screenshot({ path: path.join(shots, `testbox-manage-${skin}-${theme}-${width}-${n}.png`) });
          };
          const read = async (at: string): Promise<Measured> => {
            await page.waitForTimeout(350); // a button's ground transition settles before its ink is read
            const m = await card.evaluate(measure);
            common(m, width, at);
            return m;
          };

          // The connected card: five controls (Apply release is drawn: the running release is not the marker's), the last act one line.
          const one = await read('connected');
          await shot('1');
          expect(one.buttons.map((b) => b.name), `${width}px: the controls`).toEqual([T.settings, T.repair, T.replace, T.disconnect, T.applyRelease]);
          expect(one.lastAct, `${width}px: the last act is drawn`).not.toBeNull();
          if (width < 900) {
            const main = one.main!;
            let previousBottom = -Infinity;
            for (const b of one.buttons) {
              expect(b.box.height, `${width}px: ${b.name} is at least --tap-min tall`).toBeGreaterThanOrEqual(one.tapMin - 0.5);
              expect(Math.abs(b.box.width - main.width), `${width}px: ${b.name} is full width`).toBeLessThanOrEqual(1);
              expect(b.box.top, `${width}px: ${b.name} is on its own row`).toBeGreaterThanOrEqual(previousBottom - 0.5);
              previousBottom = b.box.bottom;
            }
            expect(one.controls!.top, 'the controls are under the state lines').toBeGreaterThanOrEqual(one.state!.bottom - 0.5);
            expect(one.ledger, 'no ledger beside the state on a phone').toBeNull();
          } else {
            const controls = one.controls!;
            const state = one.state!;
            expect(controls.left, `${width}px: the controls are at the end of the state line`).toBeGreaterThanOrEqual(state.right - 0.5);
            expect(Math.abs(controls.top - state.top), `${width}px: the controls and the state share a top`).toBeLessThanOrEqual(1);
            expect(Math.abs(controls.right - one.main!.right), `${width}px: the controls end the line`).toBeLessThanOrEqual(1);
            if (width >= 1600) {
              expect(one.ledger!.rows, 'the last ten acts').toBe(10);
              expect(one.ledger!.box.left, 'the ledger is beside the state').toBeGreaterThanOrEqual(one.main!.right - 0.5);
              expect(Math.abs(one.ledger!.box.top - one.main!.top), 'the ledger and the state share a top').toBeLessThanOrEqual(1);
            } else {
              expect(one.ledger, 'one act, under the state, below 1600').toBeNull();
              expect(one.lastAct!.box.top, 'the last act is under the state at the laptop band').toBeGreaterThanOrEqual(state.top - 0.5);
            }
          }
          if (width < 900) expect(one.lastAct!.lines, `${width}px: the last act is one line or wraps whole, never cut`).toBeGreaterThanOrEqual(1);

          // Settings.
          await card.locator('[data-testbox="settings-toggle"]').click();
          await card.locator('[data-testbox="settings"]').waitFor();
          const two = await read('settings, folded');
          await shot('2');
          expect(two.families.total, 'the box families (D-8290 adds the live probes\'), the fleet host\'s and the pairing keys').toBe(7);
          expect(two.families.open, 'every family is folded').toBe(0);
          if (width < 900) {
            for (const s of two.families.summaries) expect(s.height, `${width}px: a family's summary is at least --tap-min tall`).toBeGreaterThanOrEqual(two.tapMin - 0.5);
          }
          await card.locator('.testbox-settings details > summary').evaluateAll((all) => { for (const s of all) (s.parentElement as HTMLDetailsElement).open = true; });
          const three = await read('settings, open');
          await shot('3');
          if (width < 900) {
            expect(three.fieldColumns, `${width}px: one column`).toBe(1);
            for (const i of three.inputs) expect(i.height, `${width}px: an input is at least --tap-min tall`).toBeGreaterThanOrEqual(three.tapMin - 0.5);
          } else if (width < 1600) {
            // Box and fleet families in turn, a two-column form in each.
            expect(three.groups.map((g) => g.name)).toEqual(['box', 'fleet']);
            expect(three.groups[1]!.box.top, 'the fleet host\'s group follows the box\'s').toBeGreaterThanOrEqual(three.groups[0]!.box.bottom - 0.5);
            expect(three.fieldColumns, `${width}px: two columns`).toBe(2);
          } else {
            expect(three.groups.map((g) => g.name)).toEqual(['box', 'fleet']);
            expect(three.groups[1]!.box.left, 'the groups are side by side at 1920').toBeGreaterThanOrEqual(three.groups[0]!.box.right - 0.5);
            expect(Math.abs(three.groups[1]!.box.top - three.groups[0]!.box.top), 'side by side share a top').toBeLessThanOrEqual(1);
          }

          // The confirm sheet: what is removed, Confirm and Cancel always reachable (360 by 667 on a phone).
          if (width < 900) await page.setViewportSize({ width, height: 667 });
          await card.locator('[data-testbox="disconnect"]').click();
          const sheet = page.locator('[role="dialog"]');
          await sheet.waitFor();
          await page.waitForTimeout(500); // the sheet's rise settles
          const sheetM = await sheet.evaluate((el) => {
            const r = (e: Element | null): { top: number; bottom: number; left: number; right: number } | null => {
              if (e === null) return null;
              const b = e.getBoundingClientRect();
              return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
            };
            return {
              confirm: r(el.querySelector('[data-testbox="sheet-confirm"]')), cancel: r(el.querySelector('[data-testbox="sheet-cancel"]')),
              h: window.innerHeight, w: window.innerWidth, scroll: el.scrollWidth - el.clientWidth,
            };
          });
          await shot('4');
          expect(sheetM.confirm, `${width}px: Confirm is in the sheet`).not.toBeNull();
          expect(sheetM.cancel, `${width}px: Cancel is in the sheet`).not.toBeNull();
          for (const b of [sheetM.confirm!, sheetM.cancel!]) {
            expect(b.top, `${width}px: a sheet button is inside the viewport (top)`).toBeGreaterThanOrEqual(0);
            expect(b.bottom, `${width}px: a sheet button is inside the viewport (bottom, ${sheetM.h} tall)`).toBeLessThanOrEqual(sheetM.h);
            expect(b.left).toBeGreaterThanOrEqual(0);
            expect(b.right).toBeLessThanOrEqual(sheetM.w);
          }
          expect(sheetM.scroll, `${width}px: the sheet does not scroll sideways`).toBeLessThanOrEqual(0);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 120_000);
    }
  }
});

/** A lost access key: the blocked line and its form, which asks the address again (and the address the box sees, only if the key was
 *  refused). One column of full-width inputs and a full-width button on a phone, the same form at the laptop and wide bands. */
const REFUSED = {
  ...STATUS_ADMIN,
  act: { id: 'd'.repeat(32), sub: 'repair', phase: 'copy', phases: [], outcome: 'failed', code: 'auth-refused', startedAt: 1, endedAt: 2 },
};
describe.each(SKINS)('the connected card\'s blocked access form in %s', (skin) => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      it(`${theme}, ${width}px: the access form, with the address the box sees, fits and reads`, async () => {
        const { ctx, page, errors } = await open(skin, theme, width, REFUSED);
        try {
          page.setDefaultTimeout(10_000);
          await page.goto(server!.origin + '/settings/automation');
          const card = page.getByRole('region', { name: TITLE }).locator('[data-testbox="manage"]');
          await card.locator('[data-blocked="access"]').waitFor({ timeout: 20_000 });
          await page.waitForTimeout(350);
          const m = await card.evaluate(measure);
          common(m, width, 'blocked access');
          const form = await card.locator('[data-blocked="access"]').evaluate((el) => {
            const inputs = [...el.querySelectorAll('input')].map((i) => { const r = i.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height }; });
            const b = el.querySelector('[data-testbox="show-access"]')!.getBoundingClientRect();
            const root = el.getBoundingClientRect();
            return { inputs, button: { left: b.left, right: b.right, height: b.height }, root: { left: root.left, right: root.right },
              tapMin: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')) };
          });
          expect(form.inputs, 'address, port, login and the optional source').toHaveLength(4);
          for (const i of form.inputs) {
            expect(i.height, `${width}px: an input is at least --tap-min tall`).toBeGreaterThanOrEqual(form.tapMin - 0.5);
            expect(i.left, `${width}px: an input starts inside the card`).toBeGreaterThanOrEqual(form.root.left - 0.5);
            expect(i.right, `${width}px: an input ends inside the card`).toBeLessThanOrEqual(form.root.right + 0.5);
          }
          expect(form.button.height, `${width}px: the button is at least --tap-min tall`).toBeGreaterThanOrEqual(form.tapMin - 0.5);
          if (width < 900) expect(Math.abs((form.button.right - form.button.left) - (form.root.right - form.root.left)), `${width}px: the button is full width`).toBeLessThanOrEqual(1);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 120_000);
    }
  }
});
