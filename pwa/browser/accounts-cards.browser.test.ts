// The Refined Accounts cards at every width (accounts plan Task A2 Step 4, D-7718; spec 2026-10-18 accounts-connect
// §4.4, §12.1). Five lanes, the plan's fixture: lane-a (on, fresh usage, a long label), lane-b (401), lane-c (5h at
// 100%), lane-d (off), lane-e (codex). Sixteen cells: phone 360 and 390, laptop 1280 and wide 1920, both skins, light
// and dark. Instrument draws the same cards in its own tokens until Task A4 moves it to its table, so the rail still
// marks lane-b there.
//
// Each cell also reads what the plan's §Acceptance asks of every cell: the skin and theme the cell names are the ones
// drawn, every truncation carries its whole value in `title`, nothing on a head's first line overlaps, every lamp is a
// glyph with its word, a coarse pointer's every target in the list takes a tap 44px tall (the pool chip's own hit area
// included), no key shows but its masked hint, and the pool chip's sheet is the bottom sheet below 900 and the centred
// dialog from 900, its field at 16px. The screen itself has no field.
//
// THE OFFLINE ROW (§Acceptance, spec §12.5): one cell per skin at 360 and 1280, dark, each read twice. Warm: the link
// drops while the screen is open, and the cards keep the last answer (the server's words, the roll-up), every age on a
// card counting on from the page's clock, the source's included (D-7718 (10)): the clock moves an hour, then past a
// reset.
// Cold: the app starts with no link, from the offline snapshot (sessions and roster, never `lanes`, G15), and the
// screen draws no card it cannot read, so nothing says Signed in and no identity or key hint shows.
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

/** The SPA's own navigation, as a link tap makes it. */
const go = (page: Page, to: string): Promise<void> => page.evaluate((path) => {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}, to);

/** An unmasked key or token: the one shape no cell may show (spec §3.3). The fixture carries only the masked hint. */
const KEY_SHAPE = /\b(sk-or-v1-|sk-ant-|sk-)[A-Za-z0-9_-]{8,}/;

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
  readonly skin: string | null;
  readonly theme: string;
  readonly untitledTruncations: string[];
  readonly headOverlaps: string[];
  readonly lamps: string[];
  readonly missedTaps: string[];
  readonly fields: number;
  readonly text: string;
}

/** The pool chip's sheet, at rest. */
interface SheetShot {
  readonly animation: string;
  readonly rect: { x: number; y: number; w: number; h: number };
  readonly vw: number;
  readonly vh: number;
  readonly inputFontSizes: string[];
}

describe('the Refined Accounts cards at every width and skin (D-7718)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.goto(server!.origin + '/');
        await go(page, '/accounts');
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
            skin: document.documentElement.getAttribute('data-skin'),
            theme: document.documentElement.getAttribute('data-theme') ?? 'phosphor',
            untitledTruncations: [...document.querySelectorAll<HTMLElement>('[data-page-body] *')]
              .filter((e) => getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth)
              .filter((e) => e.title !== e.textContent).map((e) => e.textContent!),
            headOverlaps: cards.filter((c) => {
              const kids = [...c.querySelector('.accounts-row-head')!.children].map((k) => rect(k));
              return kids.some((k, i) => i > 0 && k.left < kids[i - 1]!.right - 0.5);
            }).map((c) => c.dataset['lane']!),
            lamps: cards.map((c) => {
              const glyph = c.querySelector('.acct-lamp-glyph')?.textContent ?? '';
              const word = c.querySelector('.acct-lamp-word')?.textContent ?? '';
              return glyph !== '' && word !== '' ? 'ok' : `${c.dataset['lane']}: ${JSON.stringify(glyph)} ${JSON.stringify(word)}`;
            }).filter((x) => x !== 'ok'),
            // A coarse pointer's target, by hit test: 21px above and below its centre must still land on it, so a
            // chip whose hit area is a pseudo-element (the pool chip's `::before`) counts by what a tap reaches.
            missedTaps: matchMedia('(pointer: coarse)').matches
              ? [...document.querySelectorAll<HTMLElement>('.accounts-list button, .accounts-list [tabindex="0"]')].filter((t) => {
                t.scrollIntoView({ block: 'center' });
                const b = rect(t);
                const cx = b.left + b.width / 2;
                const cy = b.top + b.height / 2;
                return [cy - 21, cy + 21].some((y) => {
                  const hit = document.elementFromPoint(cx, y);
                  return hit === null || (hit !== t && !t.contains(hit));
                });
              }).map((t) => `${t.className} ${t.textContent}`)
              : [],
            fields: document.querySelectorAll('[data-page-body] input, [data-page-body] textarea, [data-page-body] select').length,
            text: document.querySelector('[data-page-body]')!.textContent!,
          };
        }, CARDS);
        expect([m.skin, m.theme], 'the cell draws the skin and theme it names').toEqual([view.skin, view.theme]);
        expect(m.order, 'trouble cards first').toEqual(['lane-b', 'lane-c', 'lane-a', 'lane-d', 'lane-e']);
        expect(m.rollUp).toBe('5 accounts · 1 signed out · 1 rate-limited · 1 off');
        expect(m.docOverflow, 'no horizontal page scroll').toBeLessThanOrEqual(0);
        expect(m.cardOverflow, 'nothing overflows a card').toEqual([]);
        expect(m.headWraps, 'every head line 1 stays one line').toEqual([]);
        expect(m.rails, 'the rail on the Signed-out card only').toEqual(['lane-b']);
        expect(m.weeklyOnly).toBe(true);
        expect(m.clippedFields, 'every command shows whole').toEqual([]);
        expect(m.untitledTruncations, 'every truncation carries its whole value in title').toEqual([]);
        expect(m.headOverlaps, 'nothing on a head line 1 overlaps').toEqual([]);
        expect(m.lamps, 'no glyph without its word').toEqual([]);
        expect(m.fields, 'the screen has no field').toBe(0);
        expect(m.text, 'the key shows only as its masked hint').toContain('sk-or-v1-…a3f9');
        expect(m.text).not.toMatch(KEY_SHAPE);
        if (view.width < 900) {
          expect(m.labelEllipsised, 'the long label ellipsises').toBe(true);
          expect(m.fieldWidthShare, 'the CLI field takes the row').toBeGreaterThan(0.95);
          expect(m.copyBelowField, 'Copy stacks under the field').toBe(true);
          expect(m.smallTargets, '44px targets').toEqual([]);
          expect(m.missedTaps, 'every target in the list takes a 44px tap').toEqual([]);
        } else {
          // The skin's own `--page-max`: Refined's 760 (spec §12.1), Instrument's wider reading column until A4.
          if (view.skin === REFINED) expect(m.pageMax).toBe(760);
          expect(m.bodyWidth, 'the column at --page-max').toBeLessThanOrEqual(m.pageMax);
          expect(m.metersSideBySide, 'the meters side by side').toBe(true);
        }
        // The container the pool chip's sheet uses: unchanged by A2, read so the cell says it.
        await page.locator('[data-testid="acct-pool-chip-lane-a"]').click();
        await page.locator('.sheet-panel[data-state="open"]').waitFor({ timeout: 10_000 });
        const sheet: SheetShot = await page.evaluate(async () => {
          const el = document.querySelector<HTMLElement>('.sheet-panel')!;
          await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)));
          const b = el.getBoundingClientRect();
          return {
            animation: getComputedStyle(el).animationName, rect: { x: b.x, y: b.y, w: b.width, h: b.height },
            vw: innerWidth, vh: innerHeight,
            inputFontSizes: [...el.querySelectorAll('input, textarea, select')].map((i) => getComputedStyle(i).fontSize),
          };
        });
        if (view.width < 900) {
          expect(sheet.animation, 'the bottom sheet').toBe('slideFromBottom');
          expect(Math.round(sheet.rect.w)).toBe(sheet.vw);
          expect(Math.abs(sheet.rect.y + sheet.rect.h - sheet.vh), 'on the foot of the screen').toBeLessThanOrEqual(1);
        } else {
          expect(sheet.animation, 'the centred dialog').toBe('sheet-pop-in');
          expect(Math.abs(sheet.rect.x + sheet.rect.w / 2 - sheet.vw / 2), 'centred across').toBeLessThanOrEqual(1);
          expect(Math.abs(sheet.rect.y + sheet.rect.h / 2 - sheet.vh / 2), 'centred down').toBeLessThanOrEqual(1);
        }
        expect(sheet.inputFontSizes.length, 'the sheet has its field').toBeGreaterThan(0);
        expect(sheet.inputFontSizes.every((f) => f === '16px'), `--fs-input 16: ${sheet.inputFontSizes.join(', ')}`).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

// ---- the offline row ------------------------------------------------------------------------------------------------

const OFFLINE_VIEWS: AppView[] = SKINS.flatMap((skin) => [360, 1280].map((width) => ({ skin, theme: PHOSPHOR, width })));

/** What an offline cell reads off the page. */
interface OfflineRead {
  readonly cards: { lane: string; state: string; word: string; source: string; usage: string }[];
  readonly loading: boolean;
  readonly rollUp: string | null;
  readonly reconnecting: boolean;
  readonly docOverflow: number;
  readonly fields: number;
  readonly text: string;
}

const readOffline = (page: Page): Promise<OfflineRead> => page.evaluate((sel) => ({
  cards: [...document.querySelectorAll<HTMLElement>(sel)].map((c) => ({
    lane: c.dataset['lane']!, state: c.dataset['state']!,
    word: c.querySelector('.acct-lamp-word')?.textContent ?? '',
    source: c.querySelector('.accounts-state-source')?.textContent ?? '',
    usage: c.querySelector('.accounts-fresh')?.textContent ?? '',
  })),
  loading: document.querySelector('.accounts-list [data-loading="true"]') !== null,
  rollUp: document.querySelector('.accounts-rollup')?.textContent ?? null,
  // The shell's own offline reading (the fleet store's `conn`), wherever this skin draws it at this width.
  reconnecting: [...document.querySelectorAll<HTMLElement>('.offline-banner')]
    .some((b) => b.checkVisibility() && (b.textContent ?? '').includes('Reconnecting')),
  docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  fields: document.querySelectorAll('[data-page-body] input, [data-page-body] textarea, [data-page-body] select').length,
  text: document.querySelector('[data-page-body]')?.textContent ?? '',
}), CARDS);

describe('the Accounts cards offline, one cell per skin at 360 and 1280, dark (D-7718; spec §12.5)', () => {
  for (const view of OFFLINE_VIEWS) {
    it(`warm: the link drops with the screen open, and the cards keep the last answer — ${named(view)}`, async () => {
      const app = await openApp(browser!, view, FIXTURE);
      try {
        // The page's clock starts at the fixture's instant and runs, so the hours the link stays down can be passed.
        await app.page.clock.install({ time: now });
        await app.page.goto(server!.origin + '/');
        await go(app.page, '/accounts');
        await app.page.waitForFunction((sel) => document.querySelectorAll(sel).length === 5, CARDS, { timeout: 30_000 });
        const before = await readOffline(app.page);
        app.cut();
        // Leave and come back: the remount asks for a fresh answer (D-7180), which now fails.
        await go(app.page, '/');
        await go(app.page, '/accounts');
        await app.page.waitForFunction((sel) => document.querySelectorAll(sel).length === 5, CARDS, { timeout: 30_000 });
        await app.page.waitForTimeout(1_500);
        const m = await readOffline(app.page);
        expect(m.cards.map((c) => [c.lane, c.state, c.word, c.source]), "the server's words and sources stand")
          .toEqual(before.cards.map((c) => [c.lane, c.state, c.word, c.source]));
        expect(m.cards.map((c) => c.lane)).toEqual(['lane-b', 'lane-c', 'lane-a', 'lane-d', 'lane-e']);
        expect(m.cards.every((c) => !c.source.includes('no lane state')), 'held lanes are not forgotten').toBe(true);
        expect(m.cards.every((c) => c.usage !== ''), 'every card keeps its usage age').toBe(true);
        expect(m.rollUp).toBe('5 accounts · 1 signed out · 1 rate-limited · 1 off');
        // From 900 the fleet pane beside the screen carries the shell's "Reconnecting…". Below 900 nothing on the
        // Accounts screen says the link is down: the PR's offline row names that, and A18 owns the sentence.
        if (view.width >= 900) expect(m.reconnecting, "the shell's offline reading is on screen").toBe(true);
        expect(m.docOverflow).toBeLessThanOrEqual(0);
        expect(m.fields, 'no secret or code field').toBe(0);
        expect(m.text).not.toMatch(KEY_SHAPE);

        // An hour on with the link still down: every age on a card is the card's own clock's, the source's too
        // (D-7718 (10)), so no card says "checked 2h ago" beside a trouble line that says 3h.
        await app.page.clock.fastForward(3_600_000);
        await app.page.waitForTimeout(1_000);
        const later = await readOffline(app.page);
        const sourceOf = (lane: string): string => later.cards.find((c) => c.lane === lane)?.source ?? '';
        expect(sourceOf('lane-b')).toBe('HTTP 401 · checked 3h ago');
        expect(await app.page.locator(`${CARDS}[data-lane='lane-b'] .acct-trouble-wrong`).textContent())
          .toBe("lane-b's token was refused (HTTP 401) 3h ago.");
        expect(sourceOf('lane-a')).toBe('checked 1h ago');
        expect(sourceOf('lane-e')).toBe('checked 1h ago');
        expect(sourceOf('lane-c')).toMatch(/^5h limit reached · resets in 1[01]m$/);
        expect(sourceOf('lane-d')).toBe('Off on the fleet host');
        expect(later.cards.map((c) => [c.lane, c.state, c.word]), "the server's words stand")
          .toEqual(before.cards.map((c) => [c.lane, c.state, c.word]));
        // Past the reset, the countdown is gone from the source as "Resets in" is gone from the trouble line.
        await app.page.clock.fastForward(15 * 60_000);
        await app.page.waitForTimeout(1_000);
        const past = await readOffline(app.page);
        expect(past.cards.find((c) => c.lane === 'lane-c')?.source).toBe('5h limit reached');
        expect(await app.page.locator(`${CARDS}[data-lane='lane-c'] .acct-trouble-effect`).textContent()).not.toMatch(/Resets in/);
        expect(app.errors).toEqual([]);
      } finally {
        await app.ctx.close();
      }
    }, 90_000);

    it(`cold: a start with no link draws no card it cannot read — ${named(view)}`, async () => {
      const app = await openApp(browser!, view, FIXTURE);
      try {
        // The offline snapshot `lib/offline.ts` writes (its key and shape): sessions and the roster, never `lanes`.
        const snapshot = {
          savedAt: now - 600_000, sessions: [fleetSession({ id: 'demo-quiet-basin', project: 'demo', wrapper: 'lane-a' })],
          roster: ACCOUNTS.roster,
        };
        await app.ctx.addInitScript((snap) => { localStorage.setItem('ccrc.fleet-snapshot.v1', snap); }, JSON.stringify(snapshot));
        app.cut();
        await app.page.goto(server!.origin + '/');
        // The snapshot was read: the fleet counts its one session, and the shell says it is reconnecting.
        await app.page.getByText('1 session', { exact: true }).first().waitFor({ timeout: 30_000 });
        await app.page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('.offline-banner')]
          .some((b) => b.checkVisibility() && (b.textContent ?? '').includes('Reconnecting')), undefined, { timeout: 30_000 });
        await go(app.page, '/accounts');
        await app.page.locator('[data-page-body]').waitFor({ timeout: 30_000 });
        await app.page.waitForTimeout(1_500);
        const m = await readOffline(app.page);
        expect(m.cards.filter((c) => c.state === 'signed-in'), 'never Signed in on an absence').toEqual([]);
        if (view.width >= 900) expect(m.reconnecting, "the shell's offline reading is on screen").toBe(true);
        expect(m.text, 'no identity on an absence').not.toContain('someone@example.invalid');
        expect(m.text, 'no key hint either').not.toContain('a3f9');
        expect(m.text).not.toMatch(KEY_SHAPE);
        expect(m.fields, 'no secret or code field').toBe(0);
        expect(m.docOverflow).toBeLessThanOrEqual(0);
        // What it draws today, read so the PR's offline row can say it: no usage answer has landed, so the list is the
        // one count-free placeholder and there is no roll-up (A18 owns drawing the snapshot's roster with its ages).
        expect(m.loading).toBe(true);
        expect(m.cards).toEqual([]);
        expect(m.rollUp).toBeNull();
        expect(app.errors).toEqual([]);
      } finally {
        await app.ctx.close();
      }
    }, 90_000);
  }
});
