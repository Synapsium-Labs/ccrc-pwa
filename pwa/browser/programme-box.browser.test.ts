// A programme as a box in its project card (Task G2), measured in a real Chrome over the production build. The jsdom
// suites (test/programme-box.test.ts, test/programme-box-card.test.tsx) pin the decider and the markup; this file
// holds what they cannot: the layout at 390, 1280 and 1920 in both skins and both palettes, the hue the box's rule is
// actually drawn in, the kicker's measured contrast, and the tap floor of the box's controls under a coarse pointer.
//
// The fixture is two projects and three programmes. project-a holds `billing` (a worker asks the operator) and
// `search-index`, which share an FNV-1a bucket (cyan), so the second takes violet; project-b holds `port-api` (blue)
// and a session in no programme. Instrument is put in its project mode (`GROUP_MODE_KEY`), where it draws the same
// project cards as Refined.
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
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type DistServer } from './app';
import { GROUP_MODE_KEY } from '../src/skins/instrument/FleetTable';

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
  },
  fleetFrames: [{ type: 'fleet', sessions: SESSIONS }, { type: 'runs', runs: RUNS }],
};

const SKINS = [REFINED, INSTRUMENT] as const;
const THEMES = [PHOSPHOR, 'light'] as const;
const WIDTHS = [390, 1280, 1920] as const;

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
    return {
      hue, title: kicker.querySelector('.pg-title')?.textContent ?? '', rule: getComputedStyle(box).borderLeftColor, hueColour,
      kickerRatio: (a! + 0.05) / (b! + 0.05),
      tray: [...box.querySelectorAll('.pg-tray .sess-label')].map((e) => e.textContent ?? ''),
      state: box.getAttribute('data-state'),
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
    for (const width of [390, 1280] as const) {
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
            rows: [...box.querySelectorAll('.pg-tray .sess-line')].map(h),
            actions,
          };
        });
        expect(m.foot.length, `${width}: the footer is drawn`).toBe(1);
        expect(m.rows.length, `${width}: the asking worker is drawn`).toBe(1);
        expect(m.actions.length, `${width}: its ⋯ is drawn`).toBe(1);
        for (const v of [...m.foot, ...m.rows]) expect(v, `${width}px`).toBeGreaterThanOrEqual(44);
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
