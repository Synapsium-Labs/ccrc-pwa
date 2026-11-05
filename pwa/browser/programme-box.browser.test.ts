// A programme as a box in its project card (Task G2), measured in a real Chrome over the production build. The jsdom
// suites (test/programme-box.test.ts, test/programme-box-card.test.tsx) pin the decider and the markup; this file
// holds what they cannot: the layout at 360, 390, 900, 1280 and 1920 in both skins and both palettes, the hue the box's rule is
// actually drawn in, the kicker's measured contrast, and the tap floor of the box's controls under a coarse pointer.
//
// The fixture is two projects and three programmes. project-a holds `billing` (a worker asks the operator) and
// `search-index`, which share an FNV-1a bucket (cyan), so the second takes violet; project-b holds `port-api` (blue)
// and a session in no programme. Instrument is put in its project mode (`GROUP_MODE_KEY`), where it draws the same
// project cards as Refined.
//
// PL5b (D-7713): the waiting chip rides the same fixture. `billing` holds 100 open items, so its chip prints its WIDEST
// figure, "99+ waiting on you" (the cap every badge reads); `search-index` holds 3; `port-api` holds only an item being
// checked, so it has no chip. Every width, skin and palette below measures the chip as drawn: inside its box, with the kicker
// not overflowing, at 4.5:1, and at the 44 px tap floor under a coarse pointer. The chip opens the one Waiting on you list
// filtered to its programme (PL11, D-7986), and the box's title opens the programme's Goals page (`/programmes/<slug>`), each
// measured at the same widths: no sideways scroll, no page error, the programme's name on the surface in the hue.
//
// MUTATION TABLE (plan Task G2 Step 8; RUN, this file alone, each mutant restored from a saved copy, sha checked): see
// the PR body; the decider's and the card's mutants are in test/programme-box*.test.ts*.
//
//   CCRC_CHROME=$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/programme-box.browser.test.ts
//
// `CCRC_SHOTS=<a directory outside the work tree>` also writes one screenshot per skin, palette and width there.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
import { GROUP_MODE_KEY } from '../src/skins/instrument/FleetTable';
import { withRunBinding } from '../test/runBindingFixture';

const NOW = Date.now();

const session = (id: string, project: string, bucket: string, status: string, extra: object = {}): object => ({
  id, wrapper: 'lane-a', home: 'lane-a', project, workdir: `/w/${project}/${id}`,
  workspace: id, name: id, status, statusUpdatedAt: NOW - 60_000, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: `ws/${id}`, ctxPct: 40, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket, bucketSince: NOW - 60_000, unmeasured: [],
  started: true, child: { kind: 'none' }, ...extra,
});
const asking = { dialogPending: true, hookState: 'waiting', askSummary: 'Which branch should the fix land on?' };

let runId = 100;
const run = (program: string, title: string, project: string, claimedBy: string, sessionId: string, wave: number, waveOf: number | null): object => ({
  id: runId++, program, programTitle: title, wave, waveOf, project, homeProject: project, sessionId, workspace: sessionId,
  branch: `ws/${sessionId}`, state: 'working', kind: 'work', reviews: null, claimedBy, resumed: false, clearedAt: null,
  openedAt: NOW - 3_600_000, dispatchStartedAt: null, dispatchedAt: NOW - 3_000_000, closedAt: null, handoffCommit: null,
  items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null,
});

const MIN = 60_000;
const item = (id: number, program: string, over: object = {}): object => ({
  id, program, runId: null, kind: 'do', title: `Item ${id} title`, why: 'Why this is needed, in a plain sentence that may run long enough to wrap on a phone.',
  how: ['Open Settings.', 'Set it to Live.'], options: null, neededBy: 'soon', soonLabel: null, state: 'open', stale: false,
  raisedAt: NOW - 20 * MIN, tickedAt: null, closedAt: null, answer: null, note: null, secretSlot: null, secretSet: null,
  history: [{ at: NOW - 20 * MIN, act: 'raise', note: null }], ...over,
});
const GOALS = {
  program: 'billing', specPath: 'docs/superpowers/specs/2026-10-31-billing-design.md',
  inShort: 'Move billing onto the new ledger, one wave at a time, without a day of double entry.', inShortAt: NOW - 3 * 24 * 60 * MIN,
  modifications: [
    { id: 2, at: NOW - 60 * MIN, text: 'Dropped the old export, which nothing reads.', ruling: 'ledger entry 41', itemId: 3, pr: 77, merged: false },
    { id: 1, at: NOW - 5 * 24 * 60 * MIN, text: 'Added a second wave for the invoices.', ruling: null, itemId: null, pr: 70, merged: true },
  ],
};
const WAITING = {
  // 100 open items for `billing` (the chip's widest figure), 3 for `search-index`, and one being checked for `port-api`.
  items: [
    ...Array.from({ length: 100 }, (_v, i) => item(1 + i, 'billing', { title: `Billing item ${i + 1}` })),
    ...[201, 202, 203].map((id) => item(id, 'search-index')),
    item(301, 'port-api', { state: 'checking', tickedAt: NOW - 5 * MIN }),
  ],
  cleared: [], goals: [GOALS],
};

const SESSIONS = [
  session('billing-coord', 'project-a', 'working', 'busy', { role: 'coordinator' }),
  session('billing-w1', 'project-a', 'attention', 'idle', { role: 'child', ...asking }),
  session('billing-w2', 'project-a', 'working', 'busy', { role: 'child' }),
  session('billing-w3', 'project-a', 'idle', 'idle', { role: 'child' }),
  session('search-coord', 'project-a', 'working', 'busy', { role: 'coordinator' }),
  session('search-w1', 'project-a', 'working', 'busy', { role: 'child' }),
  session('search-w2', 'project-a', 'idle', 'idle', { role: 'child' }),
  session('port-coord', 'project-b', 'working', 'busy', { role: 'coordinator' }),
  session('port-w1', 'project-b', 'working', 'busy', { role: 'child' }),
  session('port-w2', 'project-b', 'done', 'idle', { role: 'child' }),
  session('lone-tidy-pass', 'project-b', 'working', 'busy'),
];
const RUNS = [
  run('billing', 'Billing rework', 'project-a', 'billing-coord', 'billing-w1', 3, 6),
  run('billing', 'Billing rework', 'project-a', 'billing-coord', 'billing-w2', 2, 6),
  run('billing', 'Billing rework', 'project-a', 'billing-coord', 'billing-w3', 1, 6),
  run('search-index', 'Search index', 'project-a', 'search-coord', 'search-w1', 2, null),
  run('search-index', 'Search index', 'project-a', 'search-coord', 'search-w2', 1, null),
  run('port-api', 'Port the API', 'project-b', 'port-coord', 'port-w1', 4, 5),
  run('port-api', 'Port the API', 'project-b', 'port-coord', 'port-w2', 3, 5),
];
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/runs': RUNS, '/api/claims': [],
    '/api/waiting': { ok: true, waiting: WAITING },
    '/api/programmes/billing/goals': { ok: true, goals: GOALS },
  },
  // The fleet frame of a current server: each worker carries the run binding over RUNS (D-7182, C7d).
  fleetFrames: [{ type: 'fleet', sessions: withRunBinding(SESSIONS as never[], RUNS as never[]) }, { type: 'runs', runs: RUNS }, { type: 'waiting', waiting: WAITING }],
};

const SKINS = [REFINED, INSTRUMENT] as const;
const THEMES = [PHOSPHOR, 'light'] as const;
// 360 is the narrowest phone the shell supports, 900 the layout breakpoint (the programme view's two columns and the shell's
// desk layout both start there): the chip's widest figure ("99+ waiting on you", on `billing`'s 100 items and one question) is
// measured at each, review 1386 F16.
const WIDTHS = [360, 390, 900, 1280, 1920] as const;

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

async function open(skin: string, theme: string, width: number, touch = false) {
  const opened = await openApp(browser!, { skin, theme, width, touch }, FIXTURE);
  await opened.ctx.addInitScript(([key]) => {
    try { localStorage.setItem(key, 'project'); } catch { /* the default mode is then measured, and the box is absent */ }
  }, [GROUP_MODE_KEY] as const);
  await opened.page.goto(server!.origin + '/');
  await opened.page.waitForSelector('section.pg-box', { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(400); // the first paint's transitions settle
  return opened;
}

interface BoxMeasure {
  readonly hue: string | null;
  readonly title: string;
  readonly rule: string;
  readonly hueColour: string;
  readonly kickerRatio: number;
  readonly tray: string[];
  readonly state: string | null;
  /** The waiting chip, or null when the box draws none: its words, its ink on its ground, and whether it sits wholly inside
   *  the box with the kicker not overflowing. */
  readonly chip: { readonly text: string; readonly ratio: number; readonly fits: boolean } | null;
}

/** Every box on the page: its hue, its left rule's colour beside the computed `--prog-<hue>`, the kicker's measured
 *  contrast, and the workers its tray draws. */
const measureBoxes = (): BoxMeasure[] => {
  const rgb = (s: string): number[] => (s.match(/[\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]: number[]): number => {
    const ch = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * ch(r!) + 0.7152 * ch(g!) + 0.0722 * ch(b!);
  };
  return [...document.querySelectorAll<HTMLElement>('section.pg-box')].map((box) => {
    const hue = box.getAttribute('data-hue');
    const probe = document.createElement('span');
    probe.style.color = `var(--prog-${hue})`;
    box.appendChild(probe);
    const hueColour = getComputedStyle(probe).color;
    probe.remove();
    const kicker = box.querySelector<HTMLElement>('.pg-kicker')!;
    const k = getComputedStyle(kicker);
    const [a, b] = [lum(rgb(k.color)), lum(rgb(k.backgroundColor))].sort((x, y) => y - x);
    const chipEl = kicker.querySelector<HTMLElement>('.pg-waiting');
    let chip: BoxMeasure['chip'] = null;
    if (chipEl !== null) {
      const c = getComputedStyle(chipEl);
      const [ca, cb] = [lum(rgb(c.color)), lum(rgb(c.backgroundColor))].sort((x, y) => y - x);
      const at = chipEl.getBoundingClientRect();
      const frame = box.getBoundingClientRect();
      chip = {
        // The door's decorative glyph (aria-hidden) leads its words: the words are what the chip says.
        text: (chipEl.textContent ?? '').replace(/^›/, ''), ratio: (ca! + 0.05) / (cb! + 0.05),
        fits: at.left >= frame.left - 0.5 && at.right <= frame.right + 0.5 && kicker.scrollWidth <= kicker.clientWidth + 1,
      };
    }
    return {
      hue, title: kicker.querySelector('.pg-title')?.textContent ?? '', rule: getComputedStyle(box).borderLeftColor, hueColour,
      kickerRatio: (a! + 0.05) / (b! + 0.05),
      tray: [...box.querySelectorAll('.pg-tray .sess-label')].map((e) => e.textContent ?? ''),
      state: box.getAttribute('data-state'),
      chip,
    };
  });
};

describe.each(SKINS)('the programme box in %s', (skin) => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      it(`at ${width} (${theme}): no sideways scroll, no page error, each box in its hue, the kicker at 4.5:1, the tray folded`, async () => {
        const { ctx, page, errors } = await open(skin, theme, width);
        try {
          const shots = process.env['CCRC_SHOTS'];
          if (shots !== undefined && shots !== '') {
            await page.screenshot({ path: `${shots}/after-${skin}-${theme}-${width}.png`, fullPage: true });
          }
          const sideScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(sideScroll, 'sideways scroll').toBe(0);
          const boxes = await page.evaluate(measureBoxes);
          expect(boxes.map((b) => [b.title, b.hue])).toEqual([
            ['Billing rework', 'cyan'], ['Search index', 'violet'], ['Port the API', 'blue'],
          ]);
          for (const b of boxes) {
            expect(b.rule, `${b.title}: the left rule is the computed --prog-${b.hue}`).toBe(b.hueColour);
            expect(b.kickerRatio, `${b.title}: the kicker's text on its band`).toBeGreaterThanOrEqual(4.5);
          }
          // PL5b: the chip, at its widest on `billing`, and none where nothing waits on the operator.
          expect(boxes.map((b) => [b.title, b.chip?.text ?? null])).toEqual([
            ['Billing rework', '99+ waiting on you'], ['Search index', '3 waiting on you'], ['Port the API', null],
          ]);
          for (const b of boxes) {
            if (b.chip === null) continue;
            expect(b.chip.fits, `${b.title}: the chip sits inside the box and the kicker does not overflow`).toBe(true);
            expect(b.chip.ratio, `${b.title}: the chip's text on its ground`).toBeGreaterThanOrEqual(4.5);
          }
          const billing = boxes[0]!;
          expect(billing.state).toBe('needs');
          expect(billing.tray, 'folded, the tray holds only the worker that asks').toEqual(['billing-w1']);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }

  // The tray's row is the card's own row (`rowBody`): its tap surface is the row and its ⋯ button's hit overlay, measured
  // as instrument-desk.browser.test.ts measures them (the overlay's inset from the padding box).
  it('keeps the footer toggle and the asking worker\'s row and ⋯ at the 44 px tap floor under a coarse pointer', async () => {
    for (const width of WIDTHS) {
      const { ctx, page, errors } = await open(skin, PHOSPHOR, width, true);
      try {
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'a coarse pointer').toBe(true);
        const m = await page.evaluate(() => {
          const h = (el: Element): number => Math.round(el.getBoundingClientRect().height);
          const box = document.querySelector('section.pg-box')!;
          const actions = [...box.querySelectorAll<HTMLElement>('.pg-tray .sess-actions')].map((el) => {
            const inset = parseFloat(getComputedStyle(el, '::before').top);
            return { w: Math.round(el.clientWidth - 2 * inset), h: Math.round(el.clientHeight - 2 * inset) };
          });
          return {
            foot: [...box.querySelectorAll('.pg-foot button')].map(h),
            chips: [...document.querySelectorAll('section.pg-box .pg-waiting')].map((el) => ({ h: h(el), w: Math.round(el.getBoundingClientRect().width) })),
            rows: [...box.querySelectorAll('.pg-tray .sess-line')].map(h),
            actions,
          };
        });
        expect(m.foot.length, `${width}: the footer is drawn`).toBe(1);
        expect(m.rows.length, `${width}: the asking worker is drawn`).toBe(1);
        expect(m.actions.length, `${width}: its ⋯ is drawn`).toBe(1);
        for (const v of [...m.foot, ...m.rows]) expect(v, `${width}px`).toBeGreaterThanOrEqual(44);
        expect(m.chips.length, `${width}: the two chips are drawn`).toBe(2);
        for (const c of m.chips) {
          expect(c.h, `${width}px: the chip, tall`).toBeGreaterThanOrEqual(44);
          expect(c.w, `${width}px: the chip, wide`).toBeGreaterThanOrEqual(44);
        }
        for (const a of m.actions) {
          expect(a.h, `${width}px: the ⋯ hit area, tall`).toBeGreaterThanOrEqual(44);
          expect(a.w, `${width}px: the ⋯ hit area, wide`).toBeGreaterThanOrEqual(44);
        }
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }
  });
});

// Desktop-polish PL10, D26 amended (D-7952): every box's title is a door into its programme view, whatever its count (port-api
// has nothing open), and the box whose programme has a pin (billing) links its spec in the Docs reader. At 360, 390, 900 and
// 1280, under a coarse pointer each is at the 44 px floor, and no kicker overflows its box.
describe.each(SKINS)('every programme box opens its view and links its spec in %s (PL10)', (skin) => {
  for (const width of [360, 390, 900, 1280] as const) {
    it(`at ${width}: each title is a door, billing's box links its spec, both at the tap floor, no kicker overflows`, async () => {
      const { ctx, page, errors } = await open(skin, PHOSPHOR, width, true);
      try {
        const m = await page.evaluate(() => {
          const r = (el: Element) => { const b = el.getBoundingClientRect(); return { h: Math.round(b.height), w: Math.round(b.width) }; };
          return [...document.querySelectorAll<HTMLElement>('section.pg-box')].map((box) => {
            const kicker = box.querySelector<HTMLElement>('.pg-kicker')!;
            const door = kicker.querySelector<HTMLAnchorElement>('a.pg-title-door');
            const spec = kicker.querySelector<HTMLAnchorElement>('a.pg-spec');
            return {
              title: kicker.querySelector('.pg-title')?.textContent ?? '',
              door: door === null ? null : { href: door.getAttribute('href'), ...r(door) },
              spec: spec === null ? null : { href: spec.getAttribute('href'), ...r(spec) },
              overflow: kicker.scrollWidth - kicker.clientWidth, boxOverflow: box.scrollWidth - box.clientWidth,
            };
          });
        });
        expect(m.length, `${width}: the boxes`).toBeGreaterThanOrEqual(2);
        for (const b of m) {
          expect(b.door, `${width} ${b.title}: the title is a door`).not.toBeNull();
          expect(b.door!.href, b.title).toMatch(/^\/programmes\//);
          expect(b.door!.h, `${width} ${b.title}: the door, tall`).toBeGreaterThanOrEqual(44);
          expect(b.overflow, `${width} ${b.title}: the kicker overflows`).toBeLessThanOrEqual(1);
          expect(b.boxOverflow, `${width} ${b.title}: the box overflows`).toBeLessThanOrEqual(1);
        }
        const billing = m.find((b) => b.door?.href === '/programmes/billing');
        expect(billing?.spec?.href, `${width}: billing links its pin`).toBe('/docs/project-a/specs/2026-10-31-billing-design.md');
        expect(billing!.spec!.h, `${width}: the spec link, tall`).toBeGreaterThanOrEqual(44);
        for (const b of m.filter((x) => x !== billing)) expect(b.spec, `${width} ${b.title}: no pin, no link`).toBeNull();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'sideways').toBeLessThanOrEqual(0);
        // A box with nothing waiting opens its view by its title.
        await page.click('section.pg-box a.pg-title-door[href="/programmes/port-api"]');
        await page.waitForFunction(() => location.pathname === '/programmes/port-api');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});

// PL5b, as PL11 (D-7986; spec §2, D29) left it: the chip is a door to the one Waiting on you list, filtered to the programme,
// with every one of the programme's rows on it and the rail's filter set; the programme's own page is its Goals page, reached
// from the box's title, laid out as the prototype's view 2 with no list of its own: Goals beside a "N waiting on you" link to
// that filtered list. No sideways scroll at any width, no page error, the programme's name in its hue on the surface.
describe.each(SKINS)('the chip opens the filtered list in %s (PL11)', (skin) => {
  for (const width of WIDTHS) {
    it(`at ${width}: the chip opens /waiting?programme=billing, its items and question, with the rail's filter set`, async () => {
      const { ctx, page, errors } = await open(skin, 'light', width);
      try {
        await page.click('section.pg-box[data-hue="cyan"] .pg-waiting');
        await page.waitForSelector('.wl-groups .wl-item', { timeout: 10_000 });
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => location.pathname + location.search)).toBe('/waiting?programme=billing');
        const m = await page.evaluate(() => ({
          sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          rows: document.querySelectorAll('.wl-groups .wl-item').length,
          groups: [...document.querySelectorAll('.wl-groups .wl-group')].map((g) => g.getAttribute('data-program')),
          pressed: document.querySelector('.wl-rail [aria-pressed="true"] .wl-rail-name')?.textContent ?? '',
        }));
        expect(m.sideScroll, 'sideways scroll').toBe(0);
        expect(m.groups).toEqual(['billing']);
        expect(m.rows, 'every open item of the programme is a row, and the question').toBe(101);
        expect(m.pressed).toBe('Billing rework');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});

describe.each(SKINS)('the programme\'s Goals page, opened from the title in %s', (skin) => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      it(`at ${width} (${theme}): the title opens /programmes/billing, with Goals and a link to its 101 on the list, and no sideways scroll`, async () => {
        const { ctx, page, errors } = await open(skin, theme, width);
        try {
          await page.click('section.pg-box[data-hue="cyan"] a.pg-title-door');
          await page.waitForSelector('.pv', { timeout: 10_000 });
          await page.waitForSelector('.pg-goals .pg-goals-text', { timeout: 10_000 });
          await page.waitForTimeout(300);
          expect(new URL(page.url()).pathname).toBe('/programmes/billing');
          const shots = process.env['CCRC_SHOTS'];
          if (shots !== undefined && shots !== '') await page.screenshot({ path: `${shots}/view-${skin}-${theme}-${width}.png` });
          const m = await page.evaluate(() => {
            const rgb = (s: string): number[] => (s.match(/[\d.]+/g) ?? []).map(Number);
            const lum = ([r, g, b]: number[]): number => {
              const ch = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
              return 0.2126 * ch(r!) + 0.7152 * ch(g!) + 0.0722 * ch(b!);
            };
            const ratio = (el: Element): number => {
              const k = getComputedStyle(el);
              let bg = k.backgroundColor;
              for (let n: Element | null = el; n !== null && /rgba\(.*,\s*0\)$|transparent/.test(bg); n = n.parentElement) bg = getComputedStyle(n).backgroundColor;
              const [a, b] = [lum(rgb(k.color)), lum(rgb(bg))].sort((x, y) => y - x);
              return (a! + 0.05) / (b! + 0.05);
            };
            const kicker = document.querySelector('.pv-head .pv-kicker')!;
            const hueProbe = document.createElement('span');
            hueProbe.style.color = 'var(--prog-cyan)';
            document.querySelector('.pv-head')!.appendChild(hueProbe);
            const hueColour = getComputedStyle(hueProbe).color;
            hueProbe.remove();
            return {
              sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              title: document.querySelector('.pv-head .pv-title')?.textContent ?? '',
              heading: document.querySelector('.pv-card .pv-h')?.textContent ?? '',
              rows: document.querySelectorAll('.pv .wl-item').length,
              waitingLink: [document.querySelector('.pv a.pv-waiting')?.textContent ?? '', document.querySelector('.pv a.pv-waiting')?.getAttribute('href') ?? ''],
              nameRatio: ratio(kicker), nameColour: getComputedStyle(kicker).color, hueColour,
              pending: document.querySelector('.pg-goals-pending')?.textContent ?? '',
              pendingRatio: ratio(document.querySelector('.pg-goals-pending')!),
              inShortRatio: ratio(document.querySelector('.pg-goals-text')!),
              specLink: document.querySelector('.pg-goals-open a')?.getAttribute('href') ?? '',
              itemLink: document.querySelector('.pg-goals-item a')?.getAttribute('href') ?? '',
              overflowing: [...document.querySelectorAll<HTMLElement>('.pv, .pv-two, .pv-card, .pg-goals')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className),
            };
          });
          expect(m.sideScroll, 'sideways scroll').toBe(0);
          expect(m.overflowing, 'a panel wider than its frame').toEqual([]);
          expect(m.title).toBe('Billing rework');
          // The page draws no list of its own; it counts what the combined list counts, the 100 open items and the asking
          // worker's question, as a link to that list filtered to the programme.
          expect(m.heading).toBe('Waiting on you');
          expect(m.rows, 'no row of the list on the Goals page').toBe(0);
          expect(m.waitingLink).toEqual(['101 waiting on you', '/waiting?programme=billing']);
          expect(m.nameColour, 'the name is drawn in the programme\'s hue').toBe(m.hueColour);
          expect(m.nameRatio, 'the name on the surface').toBeGreaterThanOrEqual(4.5);
          expect(m.inShortRatio).toBeGreaterThanOrEqual(4.5);
          expect(m.pending).toBe('spec update pending (PR #77)');
          expect(m.pendingRatio, 'a pending change on the attention tint').toBeGreaterThanOrEqual(4.5);
          expect(m.specLink).toBe('/docs/project-a/specs/2026-10-31-billing-design.md');
          expect(m.itemLink, 'the change that came from item 3 links to it').toBe('/waiting/3?from=goals%3Abilling'); // the filtered list, its way back this Goals page (plan PL9; PL11; review 1537 F2)
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});
