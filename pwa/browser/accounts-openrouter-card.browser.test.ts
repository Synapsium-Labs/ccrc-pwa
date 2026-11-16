// An OpenRouter lane's card at every width (accounts plan Task A26, D-8023 (13); spec 2026-10-18 accounts-connect §3.4,
// §4.1, §4.4, §8.3). A26 is the first writer of `keyHint`, `validatedAt` and `credit`, and this screen already reads
// them, so a lane `ccrc account add` makes reaches this card with no pwa file changing. Sixteen cells: phone 360 and 390,
// laptop 1280 and wide 1920, both skins, dark and light, in a real Chrome over the production build, with no fleet
// behind it.
//
// The lanes are the file's shape, not typed words: each is a lane-state record as the verb writes it, read by
// `laneStateOf` and worded by `stateWordFor`, which is what `lanesWire` does for the route. `ccrc-account-openrouter-v2`
// pins that the verb writes that record. lane-p has credit to spare and a session has reported; lane-q is at credit low,
// on the widest figures; lane-r has used its credit up; lane-s has no limit; lane-a is an Anthropic lane for contrast.
// The OpenRouter lanes other than lane-p have no telemetry row, which is a fresh lane's answer.
//
// Each cell reads: the skin and theme drawn are the ones the cell names; the state word and its source, whole, on every
// card; the key's line, whose hint is always on screen and whose whole value is in `title`; the trouble card's dollar
// figures and its command; no dollar figure on the no-limit card; the kind chip; nothing scrolls sideways or overflows a
// card; a head's first line stays one line; under a coarse pointer every target takes a 44px tap; no key shows but its
// masked hint; and the Remove ledger names the key by that hint, inside the viewport. The Replace sheet is out of this
// file: it is Anthropic's alone.
//
// THE KEY'S LINE ON A PHONE. Spec §4.4 keeps the head to two lines at 360, so the identity line ellipsises, as "Signed in
// as …" does. At 360 and 390 that cuts the validation's age from this line, in both skins. The hint, which is what names
// the key, stays on screen, and that is what a phone cell pins. From 900 the line is whole.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { laneStateOf, stateWordFor } from '../../shared/accounts';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 390, 1280, 1920];
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const now = Date.now();
const nowSec = Math.floor(now / 1000);
const HOUR_MS = 3_600_000;
const HINT = 'sk-or-v1-…a26a';

/** A lane-state record as `ccrc account add` and `check` leave it, its `credit` in the file's own words. */
const written = (limit: number | null, remaining: number | null): Record<string, unknown> => ({
  keyHint: HINT, keySource: 'pasted', keyLabel: 'ccrc lane', credential: 'held',
  validatedAt: new Date(now - 2 * HOUR_MS).toISOString(),
  credit: { limit, limit_remaining: remaining, usage: 1.6, is_free_tier: false },
  check: { verdict: 'ok', at: new Date(now - 2 * HOUR_MS).toISOString() },
});
/** What `lanesWire` answers for that record, on a lane nothing else is wrong with. */
const wired = (record: Record<string, unknown>): Record<string, unknown> => {
  const state = laneStateOf(record)!;
  return {
    state: stateWordFor({
      disabled: false, authDead: false, five: null, seven: null, fiveResetAt: null, sevenResetAt: null,
      provider: 'openrouter', kind: 'key', lane: { kind: 'read', state }, now,
    }),
    check: state.check, keyHint: state.keyHint, validatedAt: state.validatedAt, credit: state.credit,
    credential: state.credential, ready: true,
  };
};
const orLane = (id: string, hue: string, label = id): Record<string, unknown> => ({
  id, label, hue, homeAble: false, hidden: false, pool: null, provider: 'openrouter', kind: 'key', telemetry: 'openrouter',
});
const usage = (wrapper: string, five: number | null, seven: number | null): Record<string, unknown> => ({
  wrapper, five, seven, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
});
const ROSTER = [
  { id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'sign-in' },
  orLane('lane-p', 'amber', 'lane-p, the operator’s own long label for this lane'),
  orLane('lane-q', 'violet'), orLane('lane-r', 'blue'), orLane('lane-s', 'green'),
];
const ACCOUNTS = {
  accounts: [usage('lane-a', 12, 30), usage('lane-p', null, null)],
  projected: { wrapper: 'lane-a', score: 12 },
  roster: ROSTER,
  lanes: {
    'lane-a': {
      state: { word: 'signed-in', source: 'checked 4m ago', at: now - 240_000 },
      identity: 'someone@example.invalid', identitySource: 'measured', ready: true,
    },
    'lane-p': wired(written(20, 18.4)),
    'lane-q': wired(written(1250.5, 62.25)),
    'lane-r': wired(written(20, 0)),
    'lane-s': wired(written(null, null)),
  },
  connect: { accountOps: 'available', gate: 'armed', origin: 'https', caps: ['account-v2'], stepUpFreshUntil: now + HOUR_MS },
};
const FIXTURE: AppFixture = {
  api: { '/api/feed': { events: [] }, '/api/accounts': ACCOUNTS },
  fleetFrames: [{ type: 'fleet', sessions: [] }],
};

/** Remove's route: the pre-check clears, and the act answers the ledger the verb gives an OpenRouter lane. */
const removeRoute = async (ctx: BrowserContext): Promise<void> => { await ctx.route('**/api/accounts/*/remove', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}') as { mode?: string };
  const json = body.mode === 'check'
    ? {
      ok: true, fleetIdentity: null,
      check: { live: 0, sleeping: [], archived: 0, upstream: false, otherHomeAble: 2, authInProgress: false, discardable: false, at: Date.now() },
    }
    : {
      ok: true, roster: ROSTER.filter((r) => r.id !== 'lane-s'), rehomed: [],
      removed: ['~/.local/bin/lane-s', '~/.cc-secrets/lane-s-openrouter.env'], kept: ['~/.claude-lane-s'],
      atProvider: [{ kind: 'openrouter-key', state: 'still-valid', revokeAt: 'openrouter-keys' }],
    };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
}); };

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

const CARDS = '.accounts-list .accounts-row[data-lane]';

/** The SPA's own navigation, as a link tap makes it. */
const go = (page: Page, to: string): Promise<void> => page.evaluate((path) => {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}, to);

/** An unmasked key: the one shape no cell may show (spec §3.3). */
const KEY_SHAPE = /\bsk-or-v1-[A-Za-z0-9_-]{8,}/;

/** One card, as the page draws it. */
interface CardRead {
  readonly lane: string;
  readonly state: string;
  readonly word: string;
  readonly chip: string;
  readonly identity: string;
  readonly identityTitle: string;
  readonly identityCut: boolean;
  /** The hint's last character, with room for the ellipsis after it, ends inside the line's own box. */
  readonly hintOnScreen: boolean;
  readonly source: string;
  readonly sourceCut: boolean;
  readonly wrong: string;
  readonly effect: string;
  readonly commands: string[];
  readonly text: string;
}

interface Measured {
  readonly skin: string | null;
  readonly theme: string;
  readonly cards: CardRead[];
  readonly rollUp: string | null;
  readonly docOverflow: number;
  readonly cardOverflow: string[];
  readonly headWraps: string[];
  readonly headOverlaps: string[];
  readonly clippedFields: string[];
  readonly untitledTruncations: string[];
  readonly missedTaps: string[];
  readonly text: string;
}

describe('an OpenRouter lane card at every width and skin (D-8023 (13))', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await removeRoute(ctx);
        await page.goto(server!.origin + '/');
        await go(page, '/accounts');
        await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 5, CARDS, { timeout: 30_000 });
        const m: Measured = await page.evaluate((sel) => {
          const cards = [...document.querySelectorAll<HTMLElement>(sel)];
          const rect = (el: Element): DOMRect => el.getBoundingClientRect();
          const cut = (el: HTMLElement | null): boolean => el !== null && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight + 1);
          const words = (c: HTMLElement, q: string): string => c.querySelector(q)?.textContent ?? '';
          const hintOnScreen = (line: HTMLElement | null): boolean => {
            const text = line?.firstChild;
            if (line === null || text === null || text === undefined) return false;
            const end = (text.textContent ?? '').indexOf(' · ');
            if (end < 0) return false;
            const range = document.createRange();
            range.setStart(text, 0);
            range.setEnd(text, end);
            return range.getBoundingClientRect().right + 12 <= rect(line).right;
          };
          return {
            skin: document.documentElement.getAttribute('data-skin'),
            theme: document.documentElement.getAttribute('data-theme') ?? 'phosphor',
            cards: cards.map((c) => ({
              lane: c.dataset['lane']!, state: c.dataset['state']!,
              word: words(c, '.acct-lamp-word'), chip: words(c, '.acct-kind-chip'),
              identity: words(c, '.acct-identity'), identityTitle: c.querySelector<HTMLElement>('.acct-identity')?.title ?? '',
              identityCut: cut(c.querySelector<HTMLElement>('.acct-identity')),
              hintOnScreen: hintOnScreen(c.querySelector<HTMLElement>('.acct-identity')),
              source: words(c, '.accounts-state-source'), sourceCut: cut(c.querySelector<HTMLElement>('.accounts-state-source')),
              wrong: words(c, '.acct-trouble-wrong'), effect: words(c, '.acct-trouble-effect'),
              commands: [...c.querySelectorAll<HTMLElement>('.acct-fix-field')].map((f) => f.textContent ?? ''),
              text: c.textContent ?? '',
            })),
            rollUp: document.querySelector('.accounts-rollup')?.textContent ?? null,
            docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            cardOverflow: cards.filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.dataset['lane']!),
            headWraps: cards.filter((c) => {
              const kids = [...c.querySelector('.accounts-row-head')!.children].map((k) => rect(k));
              return kids.some((k) => Math.abs(k.top + k.height / 2 - (kids[0]!.top + kids[0]!.height / 2)) > 4);
            }).map((c) => c.dataset['lane']!),
            headOverlaps: cards.filter((c) => {
              const kids = [...c.querySelector('.accounts-row-head')!.children].map((k) => rect(k));
              return kids.some((k, i) => i > 0 && k.left < kids[i - 1]!.right - 0.5);
            }).map((c) => c.dataset['lane']!),
            clippedFields: [...document.querySelectorAll<HTMLElement>('.acct-fix-field')]
              .filter((f) => f.scrollHeight > f.clientHeight + 1 || f.scrollWidth > f.clientWidth + 1).map((f) => f.textContent!),
            untitledTruncations: [...document.querySelectorAll<HTMLElement>('[data-page-body] *')]
              .filter((e) => getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth)
              .filter((e) => e.title !== e.textContent).map((e) => e.textContent!),
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
            text: document.querySelector('[data-page-body]')!.textContent!,
          };
        }, CARDS);
        const card = (lane: string): CardRead => m.cards.find((c) => c.lane === lane)!;

        expect([m.skin, m.theme], 'the cell draws the skin and theme it names').toEqual([view.skin, view.theme]);
        expect(m.cards.map((c) => c.lane), 'trouble cards first').toEqual(['lane-r', 'lane-q', 'lane-a', 'lane-p', 'lane-s']);
        expect(m.rollUp).toBe('5 accounts · 1 rate-limited · 1 expiring');

        // The key's line, the same on all four: the masked hint and the age of the validation.
        for (const lane of ['lane-p', 'lane-q', 'lane-r', 'lane-s']) {
          expect(card(lane).chip, lane).toBe('openrouter · key');
          expect(card(lane).identity, lane).toBe(`Key ${HINT} · validated 2h ago`);
          expect(card(lane).identityTitle, `${lane}'s title carries the whole line`).toBe(card(lane).identity);
          expect(card(lane).hintOnScreen, `${lane}'s hint is on screen`).toBe(true);
          if (view.width >= 900) expect(card(lane).identityCut, `${lane}'s key line is whole`).toBe(false);
          expect(card(lane).sourceCut, `${lane}'s source is whole`).toBe(false);
        }
        // Credit to spare: a plain signed-in card that names no figure.
        expect([card('lane-p').state, card('lane-p').word, card('lane-p').source]).toEqual(['signed-in', 'Signed in', 'checked 2h ago']);
        expect(card('lane-p').text).not.toContain('$');
        // Credit low: the state word, its source and the trouble card agree on the figures.
        expect([card('lane-q').state, card('lane-q').word]).toEqual(['expiring', 'Expiring']);
        expect(card('lane-q').source).toBe('credit low · $62.25 of $1250.50 left');
        expect(card('lane-q').wrong).toBe("lane-q's OpenRouter key has $62.25 of $1250.50 left.");
        expect(card('lane-q').effect).toBe('When it hits zero, requests on it fail.');
        expect(card('lane-q').commands).toEqual(['ccrc account credential --id lane-q --credential - < /path/to/credential-file']);
        // Credit used up.
        expect([card('lane-r').state, card('lane-r').word]).toEqual(['rate-limited', 'Rate-limited']);
        expect(card('lane-r').source).toBe('credit used up · $0.00 of $20 left');
        expect(card('lane-r').wrong).toBe("lane-r's OpenRouter key has used up its credit.");
        expect(card('lane-r').effect).toBe('No sessions are on it.');
        expect(card('lane-r').commands).toEqual(['ccrc account disable --id lane-r']);
        // No limit: the same plain card, and no figure anywhere on it.
        expect([card('lane-s').state, card('lane-s').word, card('lane-s').source]).toEqual(['signed-in', 'Signed in', 'checked 2h ago']);
        expect(card('lane-s').text).not.toContain('$');
        expect(card('lane-s').wrong).toBe('');

        expect(m.docOverflow, 'no horizontal page scroll').toBeLessThanOrEqual(0);
        expect(m.cardOverflow, 'nothing overflows a card').toEqual([]);
        expect(m.headWraps, 'every head line 1 stays one line').toEqual([]);
        expect(m.headOverlaps, 'nothing on a head line 1 overlaps').toEqual([]);
        expect(m.clippedFields, 'every command shows whole').toEqual([]);
        expect(m.untitledTruncations, 'every truncation carries its whole value in title').toEqual([]);
        if (view.width < 900) expect(m.missedTaps, 'every target in the list takes a 44px tap').toEqual([]);
        expect(m.text).not.toMatch(KEY_SHAPE);

        // Remove on the no-limit lane: the ledger names the key by its hint, inside the viewport.
        await page.locator('.accounts-row[data-lane="lane-s"] .acct-fold').getByRole('button', { name: 'Remove…' }).click();
        const field = page.locator('.sheet-panel .acct-field input');
        await field.fill('lane-s');
        await page.locator('.sheet-panel').getByRole('button', { name: 'Remove lane' }).click();
        const provider = page.locator('.acct-at-provider');
        await provider.waitFor({ timeout: 10_000 });
        expect(await provider.textContent()).toContain("(it's the key ending in …a26a).");
        const sheet = await page.evaluate(() => {
          const el = document.querySelector<HTMLElement>('.sheet-panel')!;
          const b = el.getBoundingClientRect();
          return {
            inside: b.left >= -0.5 && b.right <= innerWidth + 0.5 && b.top >= -0.5 && b.bottom <= innerHeight + 0.5,
            sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            text: el.textContent ?? '',
          };
        });
        expect(sheet.inside, 'the sheet sits inside the viewport').toBe(true);
        expect(sheet.sideways, 'no horizontal page scroll').toBeLessThanOrEqual(0);
        expect(sheet.text).not.toMatch(KEY_SHAPE);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
