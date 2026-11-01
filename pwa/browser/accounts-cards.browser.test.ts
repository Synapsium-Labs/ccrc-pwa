// The Refined Accounts cards at every width (accounts plan Task A2 Step 4, D-7718; spec 2026-10-18 accounts-connect
// §4.4, §12.1). Five lanes, the plan's fixture: lane-a (on, fresh usage, a long label), lane-b (401), lane-c (5h at
// 100%), lane-d (off), lane-e (codex). Sixteen cells: phone 360 and 390, laptop 1280 and wide 1920, both skins, light
// and dark. Instrument draws the same cards in its own tokens until Task A4 moves it to its table, so the rail still
// marks lane-b there.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
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
const rostered = (id: string, hue: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, label: id, hue, homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'sign-in', ...over,
});
const checked = (verdict: string, ago: number): { verdict: string; at: number } => ({ verdict, at: now - ago });
const ACCOUNTS = {
  accounts: [
    acct('lane-a'),
    acct('lane-b', { authDead: true }),
    acct('lane-c', { five: 100, fiveResetAt: nowSec + 72 * 60 }),
    acct('lane-d', { disabled: true }),
    acct('lane-e', { five: null, seven: 40 }),
  ],
  projected: { wrapper: 'lane-a', score: 12 },
  roster: [
    rostered('lane-a', 'cyan', { label: 'lane-a, the operator’s own long label for this lane' }),
    rostered('lane-c', 'violet'),
    rostered('lane-d', 'blue', { provider: 'openrouter', kind: 'key' }),
    rostered('lane-b', 'amber', { kind: 'token' }),
    rostered('lane-e', 'magenta', { provider: 'openai', kind: 'codex', homeAble: false }),
  ],
  lanes: {
    'lane-a': {
      state: { word: 'signed-in', source: 'checked 4m ago', at: now - 240_000 }, check: checked('ok', 240_000),
      identity: 'someone@example.invalid', identitySource: 'measured', ready: true,
    },
    'lane-b': { state: { word: 'signed-out', source: 'HTTP 401 · checked 2h ago', at: now - 7_200_000 }, ready: false, notReadyReason: 'not-checked' },
    'lane-c': { state: { word: 'rate-limited', source: '5h limit reached · resets in 1h 12m' }, ready: true },
    'lane-d': { state: { word: 'off', source: 'Off on the fleet host' }, keyHint: 'sk-or-v1-…a3f9', validatedAt: now - 2 * 86_400_000, ready: true },
    'lane-e': { state: { word: 'signed-in', source: 'checked 9m ago', at: now - 540_000 }, ready: true },
  },
};
const FIXTURE: AppFixture = {
  api: { '/api/feed': { events: [] }, '/api/accounts': ACCOUNTS },
  fleetFrames: [{ type: 'fleet', sessions: [] }],
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

const CARDS = '.accounts-list .accounts-row[data-lane]';

/** What the page measures of its cards, in one read. */
interface Measured {
  readonly order: string[];
  readonly docOverflow: number;
  readonly cardOverflow: string[];
  readonly headWraps: string[];
  readonly labelEllipsised: boolean;
  readonly rails: string[];
  readonly fieldWidthShare: number;
  readonly copyBelowField: boolean;
  readonly smallTargets: string[];
  readonly clippedFields: string[];
  readonly bodyWidth: number;
  readonly pageMax: number;
  readonly metersSideBySide: boolean;
  readonly weeklyOnly: boolean;
  readonly rollUp: string | null;
}

describe('the Refined Accounts cards at every width and skin (D-7718)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.goto(server!.origin + '/');
        await page.evaluate(() => {
          history.pushState(null, '', '/accounts');
          dispatchEvent(new PopStateEvent('popstate'));
        });
        await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 5, CARDS, { timeout: 30_000 });
        const m: Measured = await page.evaluate((sel) => {
          const cards = [...document.querySelectorAll<HTMLElement>(sel)];
          const card = (id: string): HTMLElement => cards.find((c) => c.dataset['lane'] === id)!;
          const rect = (el: Element | null): DOMRect => (el as HTMLElement).getBoundingClientRect();
          const headWraps = cards.filter((c) => {
            const kids = [...c.querySelector('.accounts-row-head')!.children].map((k) => rect(k));
            return kids.some((k) => Math.abs(k.top + k.height / 2 - (kids[0]!.top + kids[0]!.height / 2)) > 4);
          }).map((c) => c.dataset['lane']!);
          const label = card('lane-a').querySelector<HTMLElement>('.acct-card-label')!;
          const row = card('lane-c').querySelector<HTMLElement>('.acct-fix-row')!;
          const field = row.querySelector<HTMLElement>('.acct-fix-field')!;
          const copy = row.querySelector<HTMLElement>('.acct-fix-copy')!;
          const targets = [...document.querySelectorAll<HTMLElement>('.acct-fix-field, .acct-fix-copy')];
          const meters = [...card('lane-a').querySelectorAll<HTMLElement>('.acct-rows > .acct-row')];
          return {
            order: cards.map((c) => c.dataset['lane']!),
            docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            cardOverflow: cards.filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.dataset['lane']!),
            headWraps,
            labelEllipsised: label.scrollWidth > label.clientWidth && getComputedStyle(label).textOverflow === 'ellipsis',
            rails: cards.filter((c) => getComputedStyle(c).borderLeftWidth === '2px').map((c) => c.dataset['lane']!),
            fieldWidthShare: rect(field).width / rect(row).width,
            copyBelowField: rect(copy).top >= rect(field).bottom - 1,
            smallTargets: targets.filter((t) => rect(t).height < 44).map((t) => t.className),
            clippedFields: [...document.querySelectorAll<HTMLElement>('.acct-fix-field')]
              .filter((f) => f.scrollHeight > f.clientHeight + 1 || f.scrollWidth > f.clientWidth + 1).map((f) => f.textContent!),
            bodyWidth: rect(document.querySelector('[data-page-body]')).width,
            pageMax: parseFloat(getComputedStyle(document.querySelector('[data-page-body]')!).maxWidth),
            metersSideBySide: meters.length === 2 && Math.abs(rect(meters[0]!).top - rect(meters[1]!).top) < 2,
            weeklyOnly: card('lane-e').textContent!.includes('weekly window only'),
            rollUp: document.querySelector('.accounts-rollup')?.textContent ?? null,
          };
        }, CARDS);
        expect(m.order, 'trouble cards first').toEqual(['lane-b', 'lane-c', 'lane-a', 'lane-d', 'lane-e']);
        expect(m.rollUp).toBe('5 accounts · 1 signed out · 1 rate-limited · 1 off');
        expect(m.docOverflow, 'no horizontal page scroll').toBeLessThanOrEqual(0);
        expect(m.cardOverflow, 'nothing overflows a card').toEqual([]);
        expect(m.headWraps, 'every head line 1 stays one line').toEqual([]);
        expect(m.rails, 'the rail on the Signed-out card only').toEqual(['lane-b']);
        expect(m.weeklyOnly).toBe(true);
        expect(m.clippedFields, 'every command shows whole').toEqual([]);
        if (view.width < 900) {
          expect(m.labelEllipsised, 'the long label ellipsises').toBe(true);
          expect(m.fieldWidthShare, 'the CLI field takes the row').toBeGreaterThan(0.95);
          expect(m.copyBelowField, 'Copy stacks under the field').toBe(true);
          expect(m.smallTargets, '44px targets').toEqual([]);
        } else {
          // The skin's own `--page-max`: Refined's 760 (spec §12.1), Instrument's wider reading column until A4.
          if (view.skin === REFINED) expect(m.pageMax).toBe(760);
          expect(m.bodyWidth, 'the column at --page-max').toBeLessThanOrEqual(m.pageMax);
          expect(m.metersSideBySide, 'the meters side by side').toBe(true);
        }
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
