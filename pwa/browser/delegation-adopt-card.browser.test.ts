// Settings › Automation › Worktrees left behind (D-8114), in a real Chrome over the production build, at 360, 390, 1280 and
// 1920 in both skins. `test/delegation-adopt-section.test.tsx` holds the card's behaviour in jsdom; this file holds what only
// an engine can say: the card in shadow with a full list of long names, then with the sheet open, then with a refusal shown
// (the fleet box's change check missing), then a server whose sign-in is dark (`sign-in-unarmed`, review 1665 N6), nothing in
// the card or on the page overflowing sideways, and the two choices
// reached and picked: Keep them only after the sheet's confirm, Do not keep at once, each write answered by the stub below.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. `GET`/`POST /api/coord/delegation-adopt` answer from
// one stored view that starts in shadow with the switch off. The second block holds where the focus lands once a write settles
// against the answer's timing (review 1703 F1 and F6): a server answers in tens of ms, inside the confirm sheet's exit. Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary>
// ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/delegation-adopt-card.browser.test.ts )`.
// `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import type { DelegationAdoptionKeep } from '../../shared/api';
import type { DelegationAdoptView } from '../../shared/delegation-adopt';
import { DELEGATION_ADOPT_REFUSAL_TEXT, DELEGATION_ADOPT_TEXT as T, delegationAdoptRefusedLine } from '../src/fleet/delegationAdoptWords';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: readonly AppView[] = [360, 390, 1280, 1920].flatMap((width) => [
  { skin: REFINED, theme: PHOSPHOR, width }, { skin: INSTRUMENT, theme: 'light', width },
]);
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const DOOR = '/api/coord/delegation-adopt';

/** Fifty worktrees with the longest names the card is likely to meet: one long token each, which must wrap, not push. */
const KEEPS: DelegationAdoptionKeep[] = Array.from({ length: 50 }, (_, i) => ({
  project: 'project-with-a-rather-long-name', worktree: `agent-a${String(i).padStart(2, '0')}-0123456789abcdef0123456789abcdef`,
  parent: 'session-0123456789abcdef0123456789abcdef',
  ...(i % 2 === 0 ? { changes: { dirty: true, aheadOfBase: i, branchAheadOfBase: i % 3 === 0 ? 'no-branch' as const : 1 } } : {}),
}));
const SHADOW: DelegationAdoptView = {
  state: 'clear', caps: { verb: 'present', audit: 'present' }, refused: { on: null, off: null },
  adoption: { mode: 'shadow', adopted: 0, wouldAdopt: 53, waiting: 1, unchanged: 3, unaudited: 0, conflicting: 0, unsupported: 0, uncensused: 0, owed: 0, keeps: { items: KEEPS, more: 3 } },
};
const NO_CHECK: DelegationAdoptView = {
  ...SHADOW, caps: { verb: 'present', audit: 'absent' }, refused: { on: 'fleet-audit-missing', off: null },
  adoption: { ...SHADOW.adoption!, mode: 'unmeasured', wouldAdopt: 0, keeps: undefined },
};

/** A server whose sign-in is dark: the view reads whole, with on refused for the caller (review 1665 N6). */
const DARK: DelegationAdoptView = { ...SHADOW, refused: { on: 'sign-in-unarmed', off: null } };

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

interface Box { left: number; right: number; top: number; bottom: number }
interface Measured {
  viewport: number;
  pageScrollWidth: number;
  pageClientWidth: number;
  detail: { scrollWidth: number; clientWidth: number } | null;
  section: { scrollWidth: number; clientWidth: number };
  card: { scrollWidth: number; clientWidth: number; box: Box };
  texts: { text: string; box: Box }[];
}

describe('Settings › Automation › Worktrees left behind at every width, in both skins (D-8114)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      let current: DelegationAdoptView = SHADOW;
      const posts: unknown[] = [];
      // The write waits on the case, so the card can be measured while it holds the choice.
      let answer: () => void = () => undefined;
      const held = (): Promise<void> => new Promise((done) => { answer = done; });
      let hold: Promise<void> | null = null;
      await ctx.route(`**${DOOR}`, async (r) => {
        const req = r.request();
        if (req.method() === 'POST') {
          const body = req.postDataJSON() as { on?: unknown } | null;
          posts.push(body);
          if (typeof body?.on !== 'boolean') {
            return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'bad-request' }) });
          }
          if (hold !== null) await hold;
          current = { ...current, state: body.on ? 'set' : 'clear' };
        }
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...current }) });
      });
      try {
        await page.goto(server!.origin + '/settings/automation');
        const section = page.getByRole('region', { name: T.title });
        const off = section.getByRole('radio', { name: T.off });
        const on = section.getByRole('radio', { name: T.on });
        await expect.poll(() => off.isChecked(), { timeout: 20_000 }).toBe(true);
        expect(await section.getByRole('radio').count(), 'the card does not offer exactly two choices').toBe(2);
        expect(await on.isChecked()).toBe(false);
        expect(await section.getByRole('group', { name: T.legend }).isVisible(), 'the switch is not visible').toBe(true);
        expect(await section.getByRole('listitem').count(), 'the list is not drawn whole').toBe(50);

        const measure = (): Promise<Measured> => section.evaluate((el): Measured => {
          const box = (e: Element): Box => {
            const r = e.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          };
          const card = el.querySelector(':scope > div:last-child');
          if (card === null) throw new Error('the card has no body');
          const detail = document.querySelector('.shell-detail');
          return {
            viewport: window.innerWidth,
            pageScrollWidth: document.documentElement.scrollWidth,
            pageClientWidth: document.documentElement.clientWidth,
            detail: detail === null ? null : { scrollWidth: detail.scrollWidth, clientWidth: detail.clientWidth },
            section: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth },
            card: { scrollWidth: card.scrollWidth, clientWidth: card.clientWidth, box: box(card) },
            texts: [...card.querySelectorAll('p, label, legend, li')].map((e) => ({ text: e.textContent ?? '', box: box(e) })),
          };
        });
        const fits = (m: Measured): void => {
          expect(m.card.scrollWidth, 'the card overflows sideways').toBeLessThanOrEqual(m.card.clientWidth);
          expect(m.section.scrollWidth, 'the section overflows sideways').toBeLessThanOrEqual(m.section.clientWidth);
          if (m.detail !== null) expect(m.detail.scrollWidth, 'the detail pane scrolls sideways').toBeLessThanOrEqual(m.detail.clientWidth);
          expect(m.pageScrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(m.pageClientWidth);
          expect(m.card.box.left, 'the card starts left of the viewport').toBeGreaterThanOrEqual(0);
          expect(m.card.box.right, 'the card runs past the viewport').toBeLessThanOrEqual(m.viewport);
          for (const t of m.texts) {
            expect(t.box.left, `"${t.text}" starts left of its card`).toBeGreaterThanOrEqual(m.card.box.left - 0.5);
            expect(t.box.right, `"${t.text}" runs past its card`).toBeLessThanOrEqual(m.card.box.right + 0.5);
            expect(t.box.bottom - t.box.top, `"${t.text}" has no height`).toBeGreaterThan(0);
          }
        };
        fits(await measure());
        const shots = process.env.CCRC_SHOTS;
        if (shots) fs.mkdirSync(shots, { recursive: true });
        /** The viewport, with one line of the card scrolled to its middle. */
        const viewAt = async (text: string, file: string): Promise<void> => {
          await section.getByText(text).evaluate((e) => { e.scrollIntoView({ block: 'center' }); });
          await page.screenshot({ path: path.join(shots!, file) });
        };
        if (shots) await section.screenshot({ path: path.join(shots, `delegation-adopt-shadow-${view.skin}-${view.width}.png`) });

        // Keep them asks first: the sheet opens, nothing is sent, and the radio stays where the server put it.
        await on.click();
        const sheet = page.getByRole('dialog');
        await expect.poll(() => sheet.isVisible(), { timeout: 10_000 }).toBe(true);
        expect(await sheet.getByText(/This would keep 53 worktrees/).count(), 'the sheet does not name the count').toBe(1);
        expect(await sheet.getByText(/mailed/).count(), 'the sheet does not say the owners are mailed').toBe(1);
        expect(posts, 'a tap sent a write before the confirm').toEqual([]);
        await page.waitForTimeout(500);   // the sheet's own entrance, so the picture shows it at rest
        if (shots) await page.screenshot({ path: path.join(shots, `delegation-adopt-confirm-${view.skin}-${view.width}.png`) });
        await sheet.getByRole('button', { name: 'Cancel' }).click();
        await expect.poll(() => sheet.isVisible(), { timeout: 10_000 }).toBe(false);
        expect(posts).toEqual([]);

        // Confirmed: the write waits on the answer, the choice is held with its line on screen and still fitting.
        hold = held();
        await on.click();
        await sheet.getByRole('button', { name: T.confirmLabel }).click();
        await expect.poll(() => section.getByText(T.asked).isVisible(), { timeout: 10_000 }).toBe(true);
        expect(await off.isChecked(), 'the tap moved the radio before the server said so').toBe(true);
        expect(await on.isDisabled(), 'the choice is not held while the tap waits').toBe(true);
        fits(await measure());
        hold = null;
        answer();
        await expect.poll(() => on.isChecked(), { timeout: 10_000 }).toBe(true);
        await expect.poll(() => on.isDisabled(), { timeout: 10_000 }).toBe(false);
        expect(await section.getByText(T.asked).count()).toBe(0);
        // Review 1699 R2-1: once the settled view reaches the card through the Settings frame, the focus is the radio it checks,
        // so Space there re-asks for what stands instead of sending the opposite choice.
        await expect.poll(() => on.evaluate((e) => e === document.activeElement), { timeout: 10_000 }).toBe(true);

        // And back from the keyboard: Do not keep asks nothing; its write is held too, and the focus follows the new reading.
        hold = held();
        await on.focus();
        await page.keyboard.press('ArrowUp');
        await expect.poll(() => section.getByText(T.asked).isVisible(), { timeout: 10_000 }).toBe(true);
        hold = null;
        answer();
        await expect.poll(() => off.isChecked(), { timeout: 10_000 }).toBe(true);
        await expect.poll(() => off.isDisabled(), { timeout: 10_000 }).toBe(false);
        await expect.poll(() => off.evaluate((e) => e === document.activeElement), { timeout: 10_000 }).toBe(true);
        expect(posts).toEqual([{ on: true }, { on: false }]);

        // A refusal shown: the fleet box's change check is missing, so Keep them cannot be chosen, and the card says why.
        current = NO_CHECK;
        await page.reload();
        await expect.poll(() => section.getByText(delegationAdoptRefusedLine(T.on, 'fleet-audit-missing')).isVisible(), { timeout: 20_000 }).toBe(true);
        expect(await section.getByText(DELEGATION_ADOPT_REFUSAL_TEXT['fleet-audit-missing'], { exact: false }).count()).toBeGreaterThan(0);
        expect(await on.isDisabled(), 'a refused choice is offered').toBe(true);
        expect(await off.isDisabled()).toBe(false);
        fits(await measure());
        if (shots) await section.screenshot({ path: path.join(shots, `delegation-adopt-refused-${view.skin}-${view.width}.png`) });
        // The section's own picture is mostly the list; this one is the viewport with the refusal line in it.
        if (shots) await viewAt(delegationAdoptRefusedLine(T.on, 'fleet-audit-missing'), `delegation-adopt-refused-view-${view.skin}-${view.width}.png`);

        // Sign-in dark: the view still reads whole (the switch, the list), and Keep them is refused in the card's own words.
        current = DARK;
        await page.reload();
        await expect.poll(() => section.getByText(delegationAdoptRefusedLine(T.on, 'sign-in-unarmed')).isVisible(), { timeout: 20_000 }).toBe(true);
        expect(await off.isChecked(), 'a dark server\'s view did not read').toBe(true);
        expect(await on.isDisabled(), 'a refused choice is offered').toBe(true);
        expect(await off.isDisabled()).toBe(false);
        expect(await section.getByRole('listitem').count(), 'the list is not drawn whole').toBe(50);
        fits(await measure());
        if (shots) await section.screenshot({ path: path.join(shots, `delegation-adopt-signin-${view.skin}-${view.width}.png`) });
        if (shots) await viewAt(delegationAdoptRefusedLine(T.on, 'sign-in-unarmed'), `delegation-adopt-signin-view-${view.skin}-${view.width}.png`);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

/** A server whose ccd has no keep switch: both choices refused (`fleet-switch-missing`), so every radio is disabled. */
const NO_SWITCH: DelegationAdoptView = {
  ...SHADOW, caps: { verb: 'absent', audit: 'present' }, refused: { on: 'fleet-switch-missing', off: 'fleet-switch-missing' },
};

/** Where the focus is: the element, whether it is inside the card's section, and the text it holds (a radio's is its label's). */
interface Focus { tag: string; value: string | null; inCard: boolean; text: string }

// Review 1703 F1, F2, F3 and F6 (one mechanism, ruled): one confirmed write makes one refocus request, which fires once when the
// write settles; focus inside the card's own confirm sheet, while it is open or leaving, is nowhere, so the request waits until the
// sheet is gone. jsdom has no exit animation and a held write answers after the sheet has gone, so only these rows see the sheet's
// exit. `answer` is how long the stub waits before it answers each POST: 0 ms and 150 ms land inside the exit; `held` answers
// only once the sheet has gone.
describe('the focus once a write settles, against the answer\'s timing (D-8114; review 1703 F1, F6)', () => {
  const FOCUS_VIEWS: readonly AppView[] = [{ skin: REFINED, theme: PHOSPHOR, width: 390 }, { skin: INSTRUMENT, theme: 'light', width: 1280 }];
  type Answer = number | 'held';
  type Reply = 'ok' | 'unmeasurable' | 'reject' | 'reject-refusing';
  async function card(view: AppView, reply: Reply, answer: Answer) {
    const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
    let current: DelegationAdoptView = SHADOW;
    const posts: unknown[] = [];
    let release: () => void = () => undefined;
    let gate: Promise<void> | null = null;
    await ctx.route(`**${DOOR}`, async (r) => {
      const req = r.request();
      if (req.method() === 'POST') {
        const body = req.postDataJSON() as { on: boolean };
        posts.push(body);
        if (answer === 'held') {
          gate = new Promise((done) => { release = done; });
          await gate;
        } else if (answer > 0) await new Promise((done) => { setTimeout(done, answer); });
        if (reply === 'reject' || reply === 'reject-refusing') {
          if (reply === 'reject-refusing') current = NO_SWITCH;   // the re-read the rejection asks for refuses the reading's choice
          return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'internal' }) });
        }
        current = reply === 'unmeasurable' ? { ...current, state: 'unmeasurable' } : { ...current, state: body.on ? 'set' : 'clear' };
      }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...current }) });
    });
    await page.goto(server!.origin + '/settings/automation');
    const section = page.getByRole('region', { name: T.title });
    const off = section.getByRole('radio', { name: T.off });
    const on = section.getByRole('radio', { name: T.on });
    await expect.poll(() => off.isChecked(), { timeout: 20_000 }).toBe(true);
    const sheet = page.getByRole('dialog');
    const focus = (): Promise<Focus> => page.evaluate((name): Focus => {
      const a = document.activeElement as HTMLElement | null;
      const cardOf = document.querySelector(`input[name="${name}"]`)?.closest('section') ?? null;
      const text = a instanceof HTMLInputElement ? [...(a.labels ?? [])].map((l) => l.textContent ?? '').join(' ') : a?.textContent ?? '';
      return {
        tag: a?.tagName ?? 'null', value: a instanceof HTMLInputElement ? a.value : null,
        inCard: cardOf !== null && a !== null && cardOf.contains(a), text: text.trim(),
      };
    }, 'settings-delegation-adopt');
    /** Keep them, then its sheet's confirm; resolves once the sheet has gone (a held write is answered first). */
    const keep = async (): Promise<void> => {
      await on.click();
      await sheet.getByRole('button', { name: T.confirmLabel }).click();
      await expect.poll(() => sheet.count(), { timeout: 10_000 }).toBe(0);
      if (answer === 'held') {
        await expect.poll(() => gate !== null, { timeout: 10_000 }).toBe(true);
        release();
      }
    };
    /** The focus once it has settled: polled until `ok` holds, then read once more after a pause, so a late move shows. */
    const settled = async (ok: (f: Focus) => boolean): Promise<Focus> => {
      await expect.poll(async () => ok(await focus()), { timeout: 5_000 }).toBe(true);
      await page.waitForTimeout(400);
      return focus();
    };
    return {
      ctx, page, errors, posts, section, on, off, sheet, keep, focus, settled,
      release: () => { release(); }, show: (v: DelegationAdoptView) => { current = v; },
    };
  }

  for (const view of FOCUS_VIEWS) {
    for (const answer of [0, 150, 'held'] as const) {
      it(`${named(view)}: answered at ${answer === 'held' ? 'held' : `${answer} ms`}, Keep them then Do not keep: the focus is the radio of the settled reading`, async () => {
        const c = await card(view, 'ok', answer);
        try {
          await c.keep();
          await expect.poll(() => c.on.isChecked(), { timeout: 10_000 }).toBe(true);
          const kept = await c.settled((f) => f.value === 'on');
          expect(kept, 'Keep them: the focus is not the radio of the settled reading').toMatchObject({ tag: 'INPUT', value: 'on', inCard: true });
          await c.off.click();
          if (answer === 'held') {
            await expect.poll(() => c.posts.length, { timeout: 10_000 }).toBe(2);
            await c.page.waitForTimeout(100);
            c.release();
          }
          await expect.poll(() => c.off.isChecked(), { timeout: 10_000 }).toBe(true);
          const left = await c.settled((f) => f.value === 'off');
          expect(left, 'Do not keep: the focus is not the radio of the settled reading').toMatchObject({ tag: 'INPUT', value: 'off', inCard: true });
          expect(c.posts).toEqual([{ on: true }, { on: false }]);
          expect(c.errors).toEqual([]);
        } finally {
          await c.ctx.close();
        }
      }, 60_000);
    }

    it(`${named(view)}: answered at 0 ms with the marker unread: the focus is the unmeasured note`, async () => {
      const c = await card(view, 'unmeasurable', 0);
      try {
        await c.keep();
        await expect.poll(() => c.section.getByText(T.unmeasured).isVisible(), { timeout: 10_000 }).toBe(true);
        const f = await c.settled((x) => x.text === T.unmeasured);
        expect(f).toMatchObject({ inCard: true, text: T.unmeasured });
        expect(c.errors).toEqual([]);
      } finally {
        await c.ctx.close();
      }
    }, 60_000);

    it(`${named(view)}: Keep them rejected at 0 ms: the focus is inside the card, on an element that holds text, never BODY`, async () => {
      const c = await card(view, 'reject', 0);
      try {
        await c.keep();
        await expect.poll(() => c.section.getByRole('status').count(), { timeout: 10_000 }).toBe(1);
        const f = await c.settled((x) => x.inCard);
        expect(f.tag).not.toBe('BODY');
        expect(f.inCard).toBe(true);
        expect(f.text, 'the focused element holds no text').not.toBe('');
        expect(await c.off.isChecked()).toBe(true);
        expect(c.errors).toEqual([]);
      } finally {
        await c.ctx.close();
      }
    }, 60_000);

    for (const answer of [0, 600] as const) {
      it(`${named(view)}: Keep them rejected at ${answer} ms, and the re-read refuses both choices: the focus is a line with text, never a disabled radio or BODY (F6)`, async () => {
        const c = await card(view, 'reject-refusing', answer);
        try {
          await c.keep();
          await expect.poll(() => c.off.isDisabled(), { timeout: 10_000 }).toBe(true);
          const f = await c.settled((x) => x.inCard);
          expect(f.tag, 'the focus is on a radio the re-read disabled').not.toBe('INPUT');
          expect(f.inCard).toBe(true);
          expect(f.text, 'the focused element holds no text').not.toBe('');
          expect(c.errors).toEqual([]);
        } finally {
          await c.ctx.close();
        }
      }, 60_000);
    }

    it(`${named(view)}: the sheet is open when a re-read refuses Keep them, and the operator confirms: nothing is sent and the focus comes back inside the card`, async () => {
      const c = await card(view, 'ok', 0);
      try {
        await c.on.click();
        await expect.poll(() => c.sheet.isVisible(), { timeout: 10_000 }).toBe(true);
        c.show(DARK);
        await c.page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });   // the page clock's re-poll
        const line = delegationAdoptRefusedLine(T.on, 'sign-in-unarmed');
        await expect.poll(() => c.page.evaluate((t) => document.body.textContent?.includes(t) ?? false, line), { timeout: 10_000 }).toBe(true);
        await c.sheet.getByRole('button', { name: T.confirmLabel }).click();
        await expect.poll(() => c.sheet.count(), { timeout: 10_000 }).toBe(0);
        const f = await c.settled((x) => x.inCard);
        expect(f).toMatchObject({ tag: 'INPUT', value: 'off', inCard: true });
        expect(c.posts).toEqual([]);
        expect(c.errors).toEqual([]);
      } finally {
        await c.ctx.close();
      }
    }, 60_000);
  }
});
