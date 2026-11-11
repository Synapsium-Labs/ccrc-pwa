// Settings › Automation › Test box › "Connect a test box" (test box connect plan TC15, D-8166; spec 2026-11-07 §2.2's width
// table), in a real Chrome over the production build, at 360, 390, 1280, 1470 and 1920 px, in both skins and both themes.
// `src/fleet/TestBoxConnect.test.tsx` holds the flow's behaviour in jsdom; this file holds what only an engine can say,
// row by row of the spec's table:
//   * phone (360, 390): one column; the steps a numbered list with only the current step open inside its item; the key line
//     wraps inside its block with Copy full width under it; the preflight a list, one check a line; every button full width
//     and at least `--tap-min` tall; no horizontal scroll;
//   * laptop (1280, 1470): two columns, the step list on the left and the current step on the right, the act's button at the end
//     of its state line, the settings a two-column form;
//   * wide (1920): three areas, the steps, the current step and the ledger's recent acts.
// At every width nothing in the flow or on the page overflows sideways, and every enabled text clears 4.5:1 on the ground it is
// drawn on.
//
// The app answers from a fixture (`browser/app.ts`) and the test's own routes play the fleet: no server, no ccd, no test box. Run:
// `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/testbox-connect.browser.test.ts )`. `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { TESTBOX_CONNECT_TEXT } from '../src/fleet/testboxAdminWords';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';

const T = TESTBOX_CONNECT_TEXT;
const TITLE = SETTINGS_CARDS.automation.testbox.title;
const SKINS = [REFINED, INSTRUMENT] as const;
const THEMES = ['light', PHOSPHOR] as const;
const WIDTHS = [360, 390, 1280, 1470, 1920] as const;
const bandOf = (width: number): 'phone' | 'laptop' | 'wide' => (width < 900 ? 'phone' : width < 1600 ? 'laptop' : 'wide');

const ADDRESS = '10.0.0.7';
const FP = `SHA256:${'A'.repeat(43)}`;
const LINE = `from="192.0.2.1" ssh-ed25519 ${'B'.repeat(68)} ccrc-testbox`;
const TOOLS = { node: '22.11.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };
/** No box connected: the server's `off` block, carrying the connect surface's word. */
const BLOCK = {
  state: 'off', reasons: [], summary: 'off', switch: 'off', at: Date.now(), host: { tools: TOOLS, release: 'v0.0.900', measuredAt: '2026-10-30T11:59:59Z' },
  box: null, cells: [], counts: { remote: 0, fallback: 0, refused: 0, unreadable: 0, byReason: {} },
  admin: { connected: false, hostKey: 'none', act: null, parity: 'none' },
};

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a', repo: { state: 'named', slug: 'team/project-a' } }] },
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

const baseStatus = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1, connected: false, addressSet: false, login: null, fingerprint: null, hostKey: 'none', boxFileSha256: null, act: null,
  boxSettings: null, boxSettingsAt: null, installedTag: null, parity: null, ...over,
});

interface Box { left: number; right: number; top: number; bottom: number; width: number; height: number }
interface Measured {
  band: string | null;
  viewport: number;
  pageScrollWidth: number;
  pageClientWidth: number;
  flow: { scrollWidth: number; clientWidth: number; box: Box };
  openSteps: number;
  steps: Box;
  panel: Box | null;
  ledger: Box | null;
  currentItem: Box | null;
  keyLine: { box: Box; scrollWidth: number; clientWidth: number; lines: number } | null;
  copy: Box | null;
  tapMin: number;
  buttons: { name: string; box: Box }[];
  stateLine: Box | null;
  stateButton: Box | null;
  checks: Box[];
  fields: Box[];
  families: number;
  phases: Box[];
  overflowing: string[];
  contrast: { text: string; ratio: number }[];
}

/** The flow's geometry and ink, measured in the page. */
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
  const tapMin = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min'));
  const line = el.querySelector<HTMLElement>('[data-testbox="key-line"]');
  const lineBox = shown(line) ? box(line) : null;
  const lineHeight = line === null ? 0 : parseFloat(getComputedStyle(line).lineHeight);
  const textual = [...el.querySelectorAll<HTMLElement>('p, span, label, summary, li, code, legend, button')].filter((e) => {
    if (!shown(e) || (e instanceof HTMLButtonElement && e.disabled)) return false;
    return [...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
  });
  return {
    band: el.getAttribute('data-band'),
    viewport: window.innerWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    pageClientWidth: document.documentElement.clientWidth,
    flow: { scrollWidth: (el as HTMLElement).scrollWidth, clientWidth: (el as HTMLElement).clientWidth, box: box(el) },
    openSteps: el.querySelectorAll('[data-testbox="step-open"]').length,
    steps: box(el.querySelector('[data-testbox="steps"]')!),
    panel: boxOf('[data-testbox="step-panel"]'),
    ledger: boxOf('[data-testbox="ledger"]'),
    currentItem: boxOf('[data-testbox="steps"] > li[data-state="current"]'),
    keyLine: line !== null && lineBox !== null
      ? { box: lineBox, scrollWidth: line.scrollWidth, clientWidth: line.clientWidth, lines: Math.round(lineBox.height / (lineHeight || 1)) } : null,
    copy: boxOf('[data-testbox="copy-key"]'),
    tapMin,
    buttons: [...el.querySelectorAll<HTMLButtonElement>('button')].filter((b) => shown(b)).map((b) => ({ name: b.textContent ?? '', box: box(b) })),
    stateLine: boxOf('[data-testbox="connect-state"]'),
    stateButton: (() => { const b = el.querySelector('[data-testbox="connect-state"] button'); return shown(b) ? box(b) : null; })(),
    checks: [...el.querySelectorAll('[data-testbox="checks"] > li')].filter(shown).map(box),
    fields: [...el.querySelectorAll('.testbox-form input')].filter(shown).map(box),
    families: el.querySelectorAll('details[data-family]').length,
    phases: [...el.querySelectorAll('[data-testbox="phases"] > li')].filter(shown).map(box),
    overflowing: [...el.querySelectorAll('*')]
      // A text field scrolls its own long value inside itself, as every input does; that is not the layout overflowing.
      .filter((e) => !(e instanceof HTMLInputElement) && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible')
      .map((e) => e.tagName.toLowerCase() + (e.getAttribute('data-testbox') ?? '')),
    contrast: textual.map((e) => ({ text: (e.textContent ?? '').slice(0, 40), ratio: ratio(e) })),
  };
};

/** The checks every step shares, at every width: nothing scrolls sideways, every enabled text clears 4.5:1. */
function common(m: Measured, width: number, at: string): void {
  expect(m.band, `${at}: the band`).toBe(bandOf(width));
  expect(m.flow.scrollWidth, `${at}: the flow overflows sideways`).toBeLessThanOrEqual(m.flow.clientWidth);
  expect(m.overflowing, `${at}: an element inside the flow scrolls sideways`).toEqual([]);
  expect(m.pageScrollWidth, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(m.pageClientWidth);
  expect(m.flow.box.left, `${at}: left of the viewport`).toBeGreaterThanOrEqual(0);
  expect(m.flow.box.right, `${at}: right of the viewport`).toBeLessThanOrEqual(m.viewport);
  const low = m.contrast.filter((c) => c.ratio < 4.5);
  expect(low, `${at}: text under 4.5:1`).toEqual([]);
  expect(m.contrast.length, `${at}: some text was measured`).toBeGreaterThan(0);
}

/** The phone rows: one open step, every button full width and tap-min tall. */
function phoneRows(m: Measured, at: string): void {
  expect(m.openSteps, `${at}: the current step is the only open step`).toBe(1);
  expect(m.panel, `${at}: no separate panel on a phone`).toBeNull();
  expect(m.ledger, `${at}: no ledger on a phone`).toBeNull();
  const current = m.currentItem!;
  for (const b of m.buttons) {
    expect(b.box.height, `${at}: ${b.name} is at least --tap-min tall`).toBeGreaterThanOrEqual(m.tapMin - 0.5);
    // Full width: as wide as the step it sits in.
    expect(Math.abs(b.box.width - current.width), `${at}: ${b.name} spans its step`).toBeLessThanOrEqual(1);
    expect(b.box.left, `${at}: ${b.name} starts inside the step`).toBeGreaterThanOrEqual(current.left - 0.5);
    expect(b.box.right, `${at}: ${b.name} ends inside the step`).toBeLessThanOrEqual(current.right + 0.5);
  }
}

async function open(skin: string, theme: string, width: number): Promise<{ page: Page; ctx: Awaited<ReturnType<typeof openApp>>['ctx']; errors: string[]; fleet: { status: Record<string, unknown>; posts: { sub: string; body: unknown }[] } }> {
  const { ctx, page, errors } = await openApp(browser!, { skin, theme, width }, FIXTURE);
  const fleet = { status: baseStatus(), posts: [] as { sub: string; body: unknown }[] };
  const answer = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await ctx.route('**/api/testbox', (r) => r.fulfill(answer({ ok: true, testbox: BLOCK })));
  await ctx.route('**/api/testbox/admin', (r) => r.fulfill(answer({ ok: true, status: fleet.status, events: [
    { id: 2, at: Date.parse('2026-11-10T12:30:00Z'), actor: 'phone a1b2c3d4', act: 'connect', actId: null, outcome: 'ok', code: null, fingerprint: null, fleetIdentity: null },
  ] })));
  let preflights = 0;
  await ctx.route('**/api/testbox/admin/*', async (r) => {
    const sub = new URL(r.request().url()).pathname.split('/').pop()!;
    fleet.posts.push({ sub, body: r.request().postDataJSON() });
    let result: Record<string, unknown> = {};
    // `key` records the connection and keeps a pin that is already there (the verb never unpins on a repeated key).
    if (sub === 'key') { fleet.status = { ...fleet.status, addressSet: true, login: 'root' }; result = { line: LINE }; }
    if (sub === 'probe') result = { fingerprint: FP };
    if (sub === 'pin') fleet.status = baseStatus({ addressSet: true, login: 'root', hostKey: 'pinned', fingerprint: FP });
    if (sub === 'preflight') {
      preflights += 1;
      result = preflights === 1
        ? { pass: false, checks: [{ check: 'os', ok: true, code: null }, { check: 'xfs', ok: false, code: 'not-xfs-reflink' }, { check: 'egress', ok: false, code: 'no-egress' }] }
        : { pass: true, checks: [{ check: 'os', ok: true, code: null }, { check: 'xfs', ok: true, code: null }] };
    }
    if (sub === 'connect') {
      fleet.status = baseStatus({ addressSet: true, login: 'root', hostKey: 'pinned', fingerprint: FP, act: {
        id: 'a'.repeat(32), sub: 'connect', phase: 'copy', phases: [{ name: 'verify', ms: 800 }], outcome: 'running', code: null, startedAt: 1, endedAt: null } });
    }
    await r.fulfill(answer({ ok: true, status: fleet.status, events: [], result }));
  });
  return { page, ctx, errors, fleet };
}

describe.each(SKINS)('Connect a test box in %s', (skin) => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      it(`${theme}, ${width}px: steps 1 to 5 at the spec's layout for the band`, async () => {
        const { ctx, page, errors, fleet } = await open(skin, theme, width);
        try {
          page.setDefaultTimeout(10_000); // an action that cannot happen fails with its own words, not the test's deadline
          await page.goto(server!.origin + '/settings/automation');
          const section = page.getByRole('region', { name: TITLE });
          const flow = section.locator('[data-testbox="connect"]');
          await flow.getByRole('button', { name: T.begin }).waitFor({ timeout: 20_000 });
          const shots = process.env.CCRC_SHOTS;
          const shot = async (n: string): Promise<void> => {
            if (shots) await section.screenshot({ path: path.join(shots, `testbox-connect-${skin}-${theme}-${width}-${n}.png`) });
          };
          const read = async (at: string): Promise<Measured> => {
            await page.waitForTimeout(350); // a button's ground transition settles before its ink is read
            const m = await flow.evaluate(measure);
            common(m, width, at);
            if (width < 900) phoneRows(m, at);
            else {
              expect(m.openSteps, `${at}: laptop and wide draw the step in its own panel`).toBe(0);
              const panel = m.panel!;
              expect(panel.left, `${at}: the panel is right of the step list`).toBeGreaterThanOrEqual(m.steps.right - 0.5);
              expect(Math.abs(panel.top - m.steps.top), `${at}: the list and the panel share a top`).toBeLessThanOrEqual(1);
              if (width >= 1600) {
                const ledger = m.ledger!;
                expect(ledger, `${at}: the ledger is the third area`).not.toBeNull();
                expect(ledger.left, `${at}: the ledger is right of the panel`).toBeGreaterThanOrEqual(panel.right - 0.5);
                expect(Math.abs(ledger.top - m.steps.top), `${at}: three areas share a top`).toBeLessThanOrEqual(1);
              } else {
                expect(m.ledger, `${at}: no ledger below 1600`).toBeNull();
              }
              if (m.stateButton !== null && m.stateLine !== null) {
                expect(Math.abs(m.stateButton.right - m.stateLine.right), `${at}: the act's button ends its state line`).toBeLessThanOrEqual(1);
              }
            }
            return m;
          };

          await flow.getByRole('button', { name: T.begin }).click();
          // Step 1.
          await flow.getByLabel(T.addressLabel).fill(ADDRESS);
          await read('step 1');
          await shot('1');
          await flow.getByRole('button', { name: T.next }).click();

          // Step 2: the line wraps inside its block with Copy under it.
          await flow.getByRole('button', { name: T.makeKey }).click();
          await flow.locator('[data-testbox="key-line"]').waitFor();
          const two = await read('step 2');
          await shot('2');
          const line = two.keyLine!;
          expect(line.scrollWidth, 'the key line wraps inside its block').toBeLessThanOrEqual(line.clientWidth);
          expect(line.box.right).toBeLessThanOrEqual(two.flow.box.right + 0.5);
          if (width < 900) {
            expect(line.lines, 'the key line wraps on a phone').toBeGreaterThan(1);
            expect(two.copy!.top, 'Copy sits under the line').toBeGreaterThanOrEqual(line.box.bottom - 0.5);
            expect(Math.abs(two.copy!.width - line.box.width), 'Copy is as wide as the line').toBeLessThanOrEqual(1);
          }
          await flow.getByRole('button', { name: T.added }).click();

          // Step 3: the fingerprint, then a preflight that fails twice over, one check a line.
          await flow.getByRole('button', { name: T.probe }).click();
          await flow.locator('[data-testbox="fingerprint"]').waitFor();
          await read('step 3 fingerprint');
          await flow.getByRole('button', { name: T.confirmFingerprint }).click();
          await flow.locator('[data-testbox="checks"]').waitFor();
          const three = await read('step 3 preflight');
          await shot('3');
          expect(three.checks, 'one line a check').toHaveLength(3);
          for (let i = 1; i < three.checks.length; i++) expect(three.checks[i]!.top, 'checks stack').toBeGreaterThanOrEqual(three.checks[i - 1]!.bottom - 0.5);
          // The recorded connection can be taken back: Start over sits beside Show the access line again, in the step it belongs to.
          expect(await flow.getByRole('button', { name: T.startOver }).count(), 'Start over is offered once an address is recorded').toBe(1);
          await flow.getByRole('button', { name: T.showLineAgain }).click();
          await flow.getByLabel(T.sourceLabel).waitFor();
          const again = await read('step 2 again: the connection typed again');
          await shot('2again');
          expect(again.fields.length, 'address, port, login and the optional source').toBeGreaterThanOrEqual(4);
          await flow.getByLabel(T.addressLabel, { exact: true }).fill(ADDRESS);
          await flow.getByRole('button', { name: T.showLineAgain }).click();
          await flow.locator('[data-testbox="key-line"]').waitFor();
          await flow.getByRole('button', { name: T.added }).click();
          await flow.getByRole('button', { name: T.probe }).click();

          // Step 4: four folded families, a two-column form beyond a phone.
          await flow.getByText(T.settingsIntro).waitFor();
          const four = await read('step 4');
          await shot('4');
          expect(four.families).toBe(4);
          // Two columns at the laptop band, one at the phone and the wide band (the wide band's panel shares the narrow settings card).
          const columns = bandOf(width) === 'laptop' ? 2 : 1;
          expect(new Set(four.fields.map((f) => Math.round(f.left))).size, `the form is ${columns} column(s) at ${width}px`).toBe(columns);
          await flow.getByLabel(T.repoName).fill('project-a');
          await flow.getByLabel(T.repoUrl).fill('https://git.invalid/team/project-a');
          await flow.getByLabel(T.repoPackage).fill('server');
          await flow.getByRole('button', { name: T.next }).click();

          // Step 5: install, and its six phases, one a line.
          await flow.getByRole('button', { name: T.install }).click();
          await flow.locator('[data-testbox="phases"]').waitFor();
          const five = await read('step 5');
          await shot('5');
          expect(five.phases).toHaveLength(6);
          for (let i = 1; i < five.phases.length; i++) expect(five.phases[i]!.top, 'phases stack').toBeGreaterThanOrEqual(five.phases[i - 1]!.bottom - 0.5);
          expect(fleet.posts.map((p) => p.sub)).toEqual(['key', 'probe', 'pin', 'preflight', 'key', 'preflight', 'connect']);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 120_000);
    }
  }
});
