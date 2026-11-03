// The Waiting on you list and the item view (desktop-polish PL5a, D-7712), measured in a real Chrome over the production
// build. The jsdom suites (test/waiting-screen.test.tsx, item-view.test.tsx, waiting-routes.test.tsx) pin the markup and the
// words; this file holds what they cannot: at 390, 1280 and 1920 in both skins and in every palette, the page never scrolls
// sideways, throws no page error, draws each programme's group in its hue (the item's left rule is the computed
// `--prog-<hue>`), and every pill and the item band's programme name clear 4.5:1 against the ground they are actually drawn on.
//
// The fixture is two programmes: `prog-b` holds a blocking item, a soon item with its own label, an item that came back
// and a checking one; `prog-a` holds a later item, a checking item whose coordinator is not responding, and a session's
// question. `prog-a` sorts first alphabetically, so the blocking programme coming first can only be the blocking-first
// rule. Names are neutral on purpose: the repository is public.
//
// MUTATION TABLE: see the PR body.
//
//   CCRC_CHROME=$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/waiting.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, REFINED, THEMES } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type DistServer } from './app';
import { withRunBinding } from '../test/runBindingFixture';

const NOW = Date.now();
const MIN = 60_000;

const session = (id: string, project: string, bucket: string, status: string, extra: object = {}): object => ({
  id, wrapper: 'lane-a', home: 'lane-a', project, workdir: `/w/${project}/${id}`,
  workspace: id, name: id, status, statusUpdatedAt: NOW - MIN, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: `ws/${id}`, ctxPct: 40, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket, bucketSince: NOW - 6 * MIN, unmeasured: [],
  started: true, child: { kind: 'none' }, ...extra,
});
const asking = { dialogPending: true, hookState: 'waiting', askSummary: 'Which branch should the fix land on?' };

let runId = 100;
const run = (program: string, title: string, project: string, claimedBy: string, sessionId: string): object => ({
  id: runId++, program, programTitle: title, wave: 2, waveOf: 5, project, homeProject: project, sessionId, workspace: sessionId,
  branch: `ws/${sessionId}`, state: 'working', kind: 'work', reviews: null, claimedBy, resumed: false, clearedAt: null,
  openedAt: NOW - 3_600_000, dispatchStartedAt: null, dispatchedAt: NOW - 3_000_000, closedAt: null, handoffCommit: null,
  items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null,
});

const SESSIONS = [
  session('prog-b-coord', 'project-a', 'working', 'busy', { role: 'coordinator' }),
  session('prog-b-w1', 'project-a', 'working', 'busy', { role: 'child' }),
  session('prog-a-coord', 'project-a', 'working', 'busy', { role: 'coordinator' }),
  session('prog-a-w1', 'project-a', 'attention', 'idle', { role: 'child', ...asking }),
];
const RUNS = [
  run('prog-b', 'Programme B', 'project-a', 'prog-b-coord', 'prog-b-w1'),
  run('prog-a', 'Programme A', 'project-a', 'prog-a-coord', 'prog-a-w1'),
];

const item = (id: number, program: string, over: object): object => ({
  id, program, runId: null, kind: 'do', title: `Item ${id} title`, why: 'Why this is needed, in a plain sentence that may run long enough to wrap on a phone.',
  how: ['Open Settings.', 'Set it to Live.'], options: null, neededBy: 'soon', soonLabel: null, state: 'open', stale: false,
  raisedAt: NOW - 20 * MIN, tickedAt: null, closedAt: null, answer: null, note: null, secretSlot: null, secretSet: null,
  history: [{ at: NOW - 20 * MIN, act: 'raise', note: null }], ...over,
});
const WAITING = {
  items: [
    item(1, 'prog-b', { neededBy: 'blocking', kind: 'decide', options: ['Library first', 'Keep the order'], title: 'Choose the order of the remaining waves' }),
    item(2, 'prog-b', { soonLabel: 'Before wave 6', kind: 'value', title: 'Give the review-round limit' }),
    item(3, 'prog-b', {
      title: 'Switch the cleanup lane to live', note: 'Settings still shows record only.',
      history: [{ at: NOW - 3 * 60 * MIN, act: 'raise', note: null }, { at: NOW - 2 * 60 * MIN, act: 'tick', note: null },
        { at: NOW - 60 * MIN, act: 'return', note: 'Settings still shows record only.' }],
    }),
    item(4, 'prog-b', { state: 'checking', tickedAt: NOW - 5 * MIN, title: 'Review the requested change' }),
    item(5, 'prog-a', { neededBy: 'later', title: 'Pick a release date' }),
    item(6, 'prog-a', { state: 'checking', stale: true, tickedAt: NOW - 50 * MIN, title: 'Flip the setting' }),
  ],
  cleared: [item(9, 'prog-b', { state: 'done', closedAt: NOW - 24 * 60 * MIN, title: 'Approve the prototype' })],
  goals: [],
};
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/runs': RUNS, '/api/claims': [], '/api/waiting': { ok: true, waiting: WAITING },
  },
  fleetFrames: [
    { type: 'fleet', sessions: withRunBinding(SESSIONS as never[], RUNS as never[]) }, { type: 'runs', runs: RUNS },
    { type: 'waiting', waiting: WAITING },
  ],
};

const SKINS = [REFINED, INSTRUMENT] as const;
const WIDTHS = [390, 1280, 1920] as const;
const PALETTES = THEMES.map((t) => t.id);

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

/** What the page measures: contrast of each pill and of the band's programme name on the ground drawn behind them, and each
 *  group's hue and its items' left rule beside the computed `--prog-<hue>`. Runs in the page. */
const measure = (): {
  pills: { text: string; ratio: number }[]; band: { ratio: number } | null; questions: { program: string; session: string }[];
  groups: { program: string; hue: string; rule: string[]; hueColour: string }[];
} => {
  // `getComputedStyle` answers `rgb(r, g, b)` in 0-255, but a `color-mix()` ground (the dead tint) comes back as
  // `color(srgb r g b)` in 0-1: scale it, or its luminance is read wrong.
  const rgb = (s: string): number[] => {
    const v = (s.match(/[\d.]+/g) ?? []).map(Number);
    return s.startsWith('color(') ? v.map((n) => n * 255) : v;
  };
  const lum = ([r, g, b]: number[]): number => {
    const ch = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * ch(r!) + 0.7152 * ch(g!) + 0.0722 * ch(b!);
  };
  const ratio = (el: Element): number => {
    const k = getComputedStyle(el);
    // The ground is the nearest ancestor (or the element) with an opaque background.
    let bg = k.backgroundColor;
    for (let n: Element | null = el; n !== null && /rgba\(.*,\s*0\)$|transparent/.test(bg); n = n.parentElement) bg = getComputedStyle(n).backgroundColor;
    const [a, b] = [lum(rgb(k.color)), lum(rgb(bg))].sort((x, y) => y - x);
    return (a! + 0.05) / (b! + 0.05);
  };
  const band = document.querySelector('.wi-band .wi-prog');
  return {
    pills: [...document.querySelectorAll('.wl-pill')].map((p) => ({ text: p.textContent ?? '', ratio: ratio(p) })),
    band: band === null ? null : { ratio: ratio(band) },
    questions: [...document.querySelectorAll<HTMLElement>('.wl-question')].map((q) => ({
      program: q.closest('.wl-group')?.getAttribute('data-program') ?? '', session: q.getAttribute('data-session') ?? '',
    })),
    groups: [...document.querySelectorAll<HTMLElement>('.wl-group')].map((g) => {
      const hue = g.getAttribute('data-hue') ?? '';
      const probe = document.createElement('span');
      probe.style.color = `var(--prog-${hue})`;
      g.appendChild(probe);
      const hueColour = getComputedStyle(probe).color;
      probe.remove();
      return { program: g.getAttribute('data-program') ?? '', hue, rule: [...g.querySelectorAll('.wl-item')].map((i) => getComputedStyle(i).borderLeftColor), hueColour };
    }),
  };
};

async function open(skin: string, theme: string, width: number, path: string) {
  const opened = await openApp(browser!, { skin, theme, width }, FIXTURE);
  await opened.page.goto(server!.origin + path);
  await opened.page.waitForSelector(path === '/waiting' ? '.wl-group' : '.wi', { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(250); // the first paint's transitions settle
  return opened;
}

describe.each(SKINS)('Waiting on you in %s', (skin) => {
  for (const theme of PALETTES) {
    for (const width of WIDTHS) {
      it(`the list at ${width} (${theme}): no sideways scroll, no page error, each group in its hue, every pill at 4.5:1`, async () => {
        const { ctx, page, errors } = await open(skin, theme, width, '/waiting');
        try {
          const shots = process.env['CCRC_SHOTS'];
          if (shots !== undefined && shots !== '') await page.screenshot({ path: `${shots}/waiting-${skin}-${theme}-${width}.png`, fullPage: true });
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'sideways scroll').toBe(0);
          const m = await page.evaluate(measure);
          expect(m.groups.map((g) => g.program)).toEqual(['prog-b', 'prog-a']); // the blocking programme first, though it sorts last
          for (const g of m.groups) {
            expect(g.hue, `${g.program} has a fleet hue`).toMatch(/^(cyan|violet|magenta|blue)$/);
            for (const rule of g.rule) expect(rule, `${g.program}: an item's left rule is the computed --prog-${g.hue}`).toBe(g.hueColour);
          }
          // The session's question is a row of the list, in its own programme's group.
          expect(m.questions).toEqual([{ program: 'prog-a', session: 'prog-a-w1' }]);
          expect(m.pills.length).toBeGreaterThanOrEqual(8); // five summary pills, and a pill on each row
          for (const p of m.pills) expect(p.ratio, `pill "${p.text}"`).toBeGreaterThanOrEqual(4.5);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });

      it(`the item view at ${width} (${theme}): no sideways scroll, no page error, the band's name and the pill at 4.5:1`, async () => {
        const { ctx, page, errors } = await open(skin, theme, width, '/waiting');
        try {
          await page.click('.wl-item[data-item="3"]'); // the item that came back
          await page.waitForSelector('.wi');
          expect(await page.evaluate(() => location.pathname)).toBe('/waiting/3');
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'sideways scroll').toBe(0);
          const m = await page.evaluate(measure);
          expect(m.band, 'the programme band is drawn').not.toBeNull();
          expect(m.band!.ratio, "the band's programme name on its tint").toBeGreaterThanOrEqual(4.5);
          expect(m.pills.length).toBeGreaterThanOrEqual(1);
          for (const p of m.pills) expect(p.ratio, `pill "${p.text}"`).toBeGreaterThanOrEqual(4.5);
          expect(await page.textContent('.wi-history')).toContain('sent back: Settings still shows record only.');
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});
