// The kill switch row and Check at every width (accounts plan Task A14 Step 4, D-7732; spec 2026-10-18 accounts-connect
// §10, §12.1). Sixteen cells: phone 360 and 390, laptop 1280 and wide 1920, both skins, dark and light, in a real Chrome
// over the production build, with no fleet behind it. The fixture's `connect` says the fleet can run the acts, so every
// card draws its knob row: lane-a on, lane-d off and not ready (its last check failed) with two sessions still running on it,
// lane-l off and never checked (a legacy lane).
//
// Each cell reads: the skin and theme drawn are the ones the cell names; the reason sits on its own line UNDER the knob,
// never beside it, and starts at the row's left edge; nothing scrolls sideways or overflows a card; Check reads "Check ·
// one test reply" whole; the disabled knob draws in `--ink-disabled` and the on knob in `--accent`; under a coarse pointer
// (360, 390) the knob and Check take a 44px tap; at 1280 and 1920 the row sits inside the page's column. The contrast of
// every ink the row uses is the gate's (`node design/contrast-check.mjs`), not this file's.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { fleetSession } from '../test/fleetFixture';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 390, 1280, 1920];
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const now = Date.now();
const nowSec = Math.floor(now / 1000);
const acct = (wrapper: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  wrapper, five: 12, seven: 30, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});
const rostered = (id: string, hue: string): Record<string, unknown> => ({
  id, label: id, hue, homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'sign-in',
});
const FIXTURE: AppFixture = {
  api: {
    '/api/feed': { events: [] },
    '/api/accounts': {
      accounts: [acct('lane-a'), acct('lane-d', { disabled: true }), acct('lane-l', { disabled: true })],
      projected: { wrapper: 'lane-a', score: 12 },
      roster: [rostered('lane-a', 'cyan'), rostered('lane-d', 'blue'), rostered('lane-l', 'violet')],
      lanes: {
        'lane-a': { state: { word: 'signed-in', source: 'checked 4m ago', at: now - 240_000 }, ready: true },
        'lane-d': { state: { word: 'off', source: 'Off on the fleet host' }, ready: false, notReadyReason: 'check-failed' },
        'lane-l': { state: { word: 'off', source: 'Off on the fleet host' }, ready: false, notReadyReason: 'not-checked' },
      },
      connect: { accountOps: 'available', gate: 'armed', origin: 'https' },
    },
  },
  fleetFrames: [{
    type: 'fleet',
    sessions: [
      fleetSession({ id: 'demo-quiet-basin', project: 'demo', wrapper: 'lane-d' }),
      fleetSession({ id: 'demo-still-pond', project: 'demo', wrapper: 'lane-d' }),
    ],
  }],
};

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

const go = (page: Page, to: string): Promise<void> => page.evaluate((path) => {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}, to);

interface Measured {
  readonly skin: string | null;
  readonly theme: string;
  readonly rows: number;
  readonly docOverflow: number;
  readonly cardOverflow: string[];
  readonly reasonUnder: boolean;
  readonly reasonAtLeft: boolean;
  readonly reasonText: string;
  readonly legacyReason: string;
  readonly stateA: string;
  readonly stateD: string;
  readonly checkClipped: string[];
  readonly checkText: string;
  readonly offDisabled: boolean;
  readonly onEnabled: boolean;
  readonly disabledInk: [string, string];
  readonly onInk: [string, string];
  readonly smallTargets: string[];
  readonly rowInsideBody: boolean;
}

describe('the kill switch row at every width and skin (D-7732)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.goto(server!.origin + '/');
        await go(page, '/accounts');
        await page.waitForFunction(() => document.querySelectorAll('.acct-knob').length === 3
          && document.querySelector(".accounts-row[data-lane='lane-d'] .acct-knob-state")?.textContent?.includes('2 running'),
        undefined, { timeout: 30_000 });
        const m: Measured = await page.evaluate(() => {
          const card = (id: string): HTMLElement => document.querySelector<HTMLElement>(`.accounts-row[data-lane='${id}']`)!;
          const rect = (el: Element): DOMRect => el.getBoundingClientRect();
          const knobD = card('lane-d').querySelector<HTMLElement>('.acct-knob')!;
          const switchD = knobD.querySelector<HTMLElement>('.acct-switch')!;
          const reasonD = knobD.querySelector<HTMLElement>('.acct-knob-reason')!;
          const switchA = card('lane-a').querySelector<HTMLElement>('.acct-switch')!;
          const checks = [...document.querySelectorAll<HTMLElement>('.acct-check')];
          const token = (name: string): string => {
            const probe = document.createElement('span');
            probe.style.color = `var(${name})`;
            document.body.append(probe);
            const c = getComputedStyle(probe).color;
            probe.remove();
            return c;
          };
          const body = document.querySelector('[data-page-body]')!;
          const coarse = matchMedia('(pointer: coarse)').matches;
          return {
            skin: document.documentElement.getAttribute('data-skin'),
            theme: document.documentElement.getAttribute('data-theme') ?? 'phosphor',
            rows: document.querySelectorAll('.acct-knob').length,
            docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            cardOverflow: [...document.querySelectorAll<HTMLElement>('.accounts-row[data-lane]')]
              .filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.dataset['lane']!),
            reasonUnder: rect(reasonD).top >= rect(switchD).bottom - 1,
            reasonAtLeft: Math.abs(rect(reasonD).left - rect(knobD).left) <= 1,
            reasonText: reasonD.textContent ?? '',
            legacyReason: card('lane-l').querySelector('.acct-knob-reason')?.textContent ?? '',
            stateA: card('lane-a').querySelector('.acct-knob-state')?.textContent ?? '',
            stateD: card('lane-d').querySelector('.acct-knob-state')?.textContent ?? '',
            checkClipped: checks.filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent!),
            checkText: checks[0]?.textContent ?? '',
            offDisabled: (switchD as HTMLButtonElement).disabled,
            onEnabled: !(switchA as HTMLButtonElement).disabled && switchA.getAttribute('aria-checked') === 'true',
            disabledInk: [getComputedStyle(switchD.querySelector('.acct-switch-track')!).borderTopColor, token('--ink-disabled')],
            onInk: [getComputedStyle(switchA.querySelector('.acct-switch-track')!).backgroundColor, token('--accent')],
            smallTargets: coarse
              ? [...document.querySelectorAll<HTMLElement>('.acct-switch, .acct-check')].filter((t) => rect(t).height < 44)
                .map((t) => t.className)
              : [],
            rowInsideBody: [...document.querySelectorAll('.acct-knob')].every((k) => rect(k).right <= rect(body).right + 0.5
              && rect(k).left >= rect(body).left - 0.5),
          };
        });
        expect([m.skin, m.theme], 'the cell draws the skin and theme it names').toEqual([view.skin, view.theme]);
        expect(m.rows, 'every card draws its knob row').toBe(3);
        expect(m.docOverflow, 'no horizontal page scroll').toBeLessThanOrEqual(0);
        expect(m.cardOverflow, 'nothing overflows a card').toEqual([]);
        expect(m.reasonText).toBe("Not ready: the last check didn't pass. Check it first.");
        expect(m.legacyReason).toBe('Check it once to turn it on');
        expect(m.reasonUnder, 'the reason wraps under the knob, never beside it').toBe(true);
        expect(m.reasonAtLeft, 'the reason starts at the row\'s left edge').toBe(true);
        expect(m.stateA).toBe('On: new sessions can land here');
        expect(m.stateD).toBe('Off: no new sessions; the 2 running here keep running.');
        expect(m.checkText).toBe('Check · one test reply');
        expect(m.checkClipped, 'Check shows whole').toEqual([]);
        expect(m.offDisabled, 'a not-ready off lane cannot be turned on').toBe(true);
        expect(m.onEnabled, 'an on lane can be switched off').toBe(true);
        expect(m.disabledInk[0], 'the disabled knob draws in --ink-disabled').toBe(m.disabledInk[1]);
        expect(m.onInk[0], 'the on knob draws in --accent').toBe(m.onInk[1]);
        expect(m.smallTargets, '44px targets under a coarse pointer').toEqual([]);
        expect(m.rowInsideBody, 'the row stays inside the page column').toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});
