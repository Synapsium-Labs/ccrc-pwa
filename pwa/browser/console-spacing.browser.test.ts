// Even spacing in the console at a desk (desktop polish wave 182), measured in a real Chrome over the production build.
// The user's first-run feedback was three insets and three top lines: the list column at 16, the page scaffold's screens at
// 14 (a literal in Instrument's role table), Waiting on you and the session header at 8 from the divider, and at 1440
// Instrument's pages centred 84 in while Waiting stayed at 8; New project a 44 px row of its own lining up with nothing.
// The ruling (the coordinator's answer to the measured proposal): one inset, `--gutter`, in both panes and on every
// detail screen (Instrument's desk role now `var(--sp-4)`); the page column's centring is a skin role,
// `--page-margin-inline` (Refined centres, Instrument at a desk starts at the gutter); every pane opens on a `--head-h`
// row with its title or controls centred in it; the head block's gaps are tokens; New project rides the toggle's line.
// Refined keeps its list column at 16 and its centred page column; its detail screens agree with each other.
//
// Every expected figure is read from the computed tokens, never a literal: the cases hold the relations, so a token
// moved on purpose moves the layout with it.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/console-spacing.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
import { withRunBinding } from '../test/runBindingFixture';

const NOW = Date.now();
const MIN = 60_000;
const nowSec = Math.floor(NOW / 1000);
const session = (id: string, project: string, bucket: string, status: string, extra: object = {}): object => ({
  id, wrapper: 'lane-a', home: 'lane-a', project, workdir: `/w/${project}/${id}`,
  workspace: id, name: id, status, statusUpdatedAt: NOW - MIN, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: `ws/${id}`, ctxPct: 40, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket, bucketSince: NOW - 6 * MIN, unmeasured: [],
  started: true, child: { kind: 'none' }, ...extra,
});
const account = (wrapper: string): Record<string, unknown> => ({
  wrapper, five: 12, seven: 30, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
});
const ACCOUNTS = {
  accounts: [account('lane-a')], projected: { wrapper: 'lane-a', score: 12 },
  roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'sign-in' }],
  lanes: { 'lane-a': { state: { word: 'signed-in', source: 'checked 4m ago', at: NOW - 240_000 }, ready: true } },
};
const NOTHING_WAITING = { items: [], cleared: [], goals: [] };

/** The user's first run: one account, two exited main checkouts, no live session, the pool projection never synced, nothing
 *  waiting, and no `connect` answer (sign-in dark, so Accounts draws its door's reason). */
const FIRST: AppFixture = {
  api: {
    '/api/feed': { events: [] }, '/api/accounts': ACCOUNTS, '/api/runs': [], '/api/claims': [],
    '/api/waiting': { ok: true, waiting: NOTHING_WAITING },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }, { name: 'project-b', workdir: '/w/project-b' }] },
  },
  fleetFrames: [
    { type: 'fleet', sessions: [
      session('project-a', 'project-a', 'dead', 'dead', { workspace: null, name: null, branch: 'main', workdir: '/w/project-a' }),
      session('project-b', 'project-b', 'dead', 'dead', { workspace: null, name: null, branch: 'main', workdir: '/w/project-b' }),
    ] },
    { type: 'pools', pools: { listed: false, enforcement: 'unknown', accountPools: 'unavailable', epoch: 0, observedEpoch: null } },
    { type: 'waiting', waiting: NOTHING_WAITING },
  ],
};

let runId = 100;
const run = (program: string, title: string, claimedBy: string, sessionId: string): object => ({
  id: runId++, program, programTitle: title, wave: 2, waveOf: 5, project: 'project-a', homeProject: 'project-a', sessionId,
  workspace: sessionId, branch: `ws/${sessionId}`, state: 'working', kind: 'work', reviews: null, claimedBy, resumed: false,
  clearedAt: null, openedAt: NOW - 3_600_000, dispatchStartedAt: null, dispatchedAt: NOW - 3_000_000, closedAt: null,
  handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false,
});
const BUSY_SESSIONS = [
  session('prog-b-coord', 'project-a', 'working', 'busy', { role: 'coordinator' }),
  session('prog-b-w1', 'project-a', 'working', 'busy', { role: 'child' }),
  session('prog-a-coord', 'project-a', 'working', 'busy', { role: 'coordinator' }),
  session('prog-a-w1', 'project-a', 'attention', 'idle', { role: 'child', dialogPending: true, hookState: 'waiting', askSummary: 'Which branch?' }),
  session('desk-density-pass', 'project-b', 'working', 'busy'),
  session('echo-wait-budget-fix', 'project-b', 'dead', 'dead'),
];
const RUNS = [run('prog-b', 'Programme B', 'prog-b-coord', 'prog-b-w1'), run('prog-a', 'Programme A', 'prog-a-coord', 'prog-a-w1')];
const item = (id: number, program: string, over: object): object => ({
  id, program, runId: null, kind: 'do', title: `Item ${id} title`, why: 'Why this is needed, in a plain sentence.',
  how: ['Open Settings.'], options: null, neededBy: 'soon', soonLabel: null, state: 'open', stale: false,
  raisedAt: NOW - 20 * MIN, tickedAt: null, closedAt: null, answer: null, note: null, secretSlot: null, secretSet: null,
  history: [{ at: NOW - 20 * MIN, act: 'raise', note: null }], ...over,
});
const WAITING = {
  items: [
    item(1, 'prog-b', { neededBy: 'blocking', kind: 'decide', options: ['Library first', 'Keep the order'], title: 'Choose the order' }),
    item(5, 'prog-a', { neededBy: 'later', title: 'Pick a release date' }),
  ],
  cleared: [], goals: [],
};
/** A fleet in use: sessions in several groups, two runs, items waiting; the pool projection in step (no lag line). */
const BUSY: AppFixture = {
  api: { ...FIRST.api, '/api/runs': RUNS, '/api/waiting': { ok: true, waiting: WAITING } },
  fleetFrames: [
    { type: 'fleet', sessions: withRunBinding(BUSY_SESSIONS as never[], RUNS as never[]) }, { type: 'runs', runs: RUNS },
    { type: 'pools', pools: { listed: false, enforcement: 'unknown', accountPools: 'unavailable' } },
    { type: 'waiting', waiting: WAITING },
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

/** What one screen measures: the tokens, the pane's content edges, and per anchor its box. */
interface Measured {
  readonly tokens: { gutter: number; headH: number; rowH: number; tapMin: number; sp1: number; sp2: number; sp3: number };
  /** The detail pane's and the list column's inner left and top (inside any border). */
  readonly detail: { left: number; top: number; right: number } | null;
  readonly nav: { left: number; top: number; right: number } | null;
  /** Named boxes: `[left, top, right, bottom]`, or null when the selector matched nothing visible. Each `*Pad` box is the
   *  element's CONTENT box (inside its padding), the edge a screen's text starts at. */
  readonly boxes: Readonly<Record<string, readonly [number, number, number, number] | null>>;
}

const ANCHORS: Readonly<Record<string, string>> = {
  scaffoldRowPad: '.shell-detail [data-page-scaffold] > header > div',
  scaffoldTitle: '.shell-detail [data-page-scaffold] > header h1',
  scaffoldRow: '.shell-detail [data-page-scaffold] > header > div',
  scaffoldBody: '.shell-detail [data-page-scaffold] [data-page-body] > :first-child',
  waitingPad: '.shell-detail .wl',
  waitingHead: '.shell-detail .wl > .wl-head',
  waitingTitle: '.shell-detail .wl .wl-title',
  waitingNote: '.shell-detail .wl > .wl-note',
  waitingSummary: '.shell-detail .wl > .wl-summary',
  waitingGrid: '.shell-detail .wl > .wl-grid',
  chatHeadPad: '.shell-detail .chat-head',
  fleetPad: '.shell-nav .fleet',
  headRow: '.shell-nav .ins-head-row',
  toggle: '.shell-nav .ins-head-row .ins-toggle',
  door: '.shell-nav .fleet-new-project',
  lag: '.shell-nav .pool-epoch-lag',
  firstGroup: '.shell-nav .ins-group-head',
};

async function measure(page: Page): Promise<Measured> {
  return page.evaluate((anchors) => {
    const root = getComputedStyle(document.documentElement);
    const px = (t: string): number => parseFloat(root.getPropertyValue(t));
    const visible = (el: Element | null): el is HTMLElement => {
      if (el === null) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const inner = (sel: string): { left: number; top: number; right: number } | null => {
      const el = document.querySelector(sel);
      if (!visible(el)) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left + el.clientLeft, top: r.top + el.clientTop, right: r.left + el.clientLeft + el.clientWidth };
    };
    const boxes: Record<string, [number, number, number, number] | null> = {};
    for (const [name, sel] of Object.entries(anchors)) {
      const el = [...document.querySelectorAll(sel)].find(visible) ?? null;
      if (el === null) { boxes[name] = null; continue; }
      const r = el.getBoundingClientRect();
      if (name.endsWith('Pad')) {
        const cs = getComputedStyle(el);
        boxes[name] = [r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), r.top + parseFloat(cs.paddingTop),
          r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight), r.bottom];
      } else boxes[name] = [r.left, r.top, r.right, r.bottom];
    }
    return {
      tokens: { gutter: px('--gutter'), headH: px('--head-h'), rowH: px('--row-h'), tapMin: px('--tap-min'), sp1: px('--sp-1'), sp2: px('--sp-2'), sp3: px('--sp-3') },
      detail: inner('.shell-detail'), nav: inner('.shell-nav'), boxes,
    };
  }, ANCHORS);
}

const at = async (page: Page, path: string, ready: string): Promise<Measured> => {
  await page.goto(server!.origin + path);
  await page.waitForSelector(ready, { timeout: 20_000 });
  await page.waitForTimeout(300); // the accounts poll and the fleet frames settle the head block
  return measure(page);
};
const need = (m: Measured, name: string): readonly [number, number, number, number] => {
  const b = m.boxes[name];
  if (b === null || b === undefined) throw new Error(`${name} (${ANCHORS[name]}) is not drawn`);
  return b;
};
const centreY = (b: readonly [number, number, number, number]): number => (b[1] + b[3]) / 2;
const NEAR = 0.6; // sub-pixel rounding of a centred box

/** The detail screens a desk shows, each with the anchor its text starts at and the element whose box is its title. */
const PAGES = [
  { name: 'Accounts', path: '/accounts', pad: 'scaffoldRowPad', title: 'scaffoldTitle', kind: 'page' },
  { name: 'Settings', path: '/settings', pad: 'scaffoldRowPad', title: 'scaffoldTitle', kind: 'page' },
  { name: 'Mail', path: '/mail', pad: 'scaffoldRowPad', title: 'scaffoldTitle', kind: 'page' },
  { name: 'Archive', path: '/archive', pad: 'scaffoldRowPad', title: 'scaffoldTitle', kind: 'page' },
  { name: 'Runs', path: '/runs', pad: 'scaffoldRowPad', title: 'scaffoldTitle', kind: 'wide' },
  { name: 'Waiting on you', path: '/waiting', pad: 'waitingPad', title: 'waitingTitle', kind: 'wide' },
] as const;
const DESKS = [[1280, 800], [1440, 900]] as const;
const THEMES = [PHOSPHOR, 'light'] as const;

describe('Instrument at a desk: one inset and one head line in both panes', () => {
  for (const [width, height] of DESKS) {
    for (const theme of THEMES) {
      const view = `instrument, ${theme}, ${width}x${height}`;
      it(`${view}: every detail screen and the list column start --gutter from their pane, and --gutter is --sp-4`, async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin: INSTRUMENT, theme, width }, FIRST);
        try {
          await page.setViewportSize({ width, height });
          const lefts: Record<string, number> = {};
          let tokens: Measured['tokens'] | null = null;
          for (const p of PAGES) {
            const m = await at(page, p.path, ANCHORS[p.title]!);
            tokens = m.tokens;
            lefts[p.name] = need(m, p.pad)[0] - m.detail!.left;
            lefts[`${p.name} (title)`] = need(m, p.title)[0] - m.detail!.left;
          }
          const s = await at(page, '/s/project-a', '.chat-head');
          lefts['session header'] = need(s, 'chatHeadPad')[0] - s.detail!.left;
          lefts['list column'] = need(s, 'fleetPad')[0] - s.nav!.left;
          lefts['list head row'] = need(s, 'headRow')[0] - s.nav!.left;
          const g = tokens!.gutter;
          expect(g, '--gutter is the spacing scale\'s 16 at a desk, never a literal 14').toBe(16);
          // The scaffold's caret has no box of its own before the title here, so a title's left is its row's text start.
          for (const [name, left] of Object.entries(lefts)) {
            if (name.endsWith('(title)') && !name.startsWith('Waiting')) continue;
            expect(Math.abs(left - g), `${name}: ${left} from its pane, against --gutter ${g}`).toBeLessThan(NEAR);
          }
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 120_000);

      it(`${view}: every detail title and the list column's head row are centred in one --head-h band from the pane's top`, async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin: INSTRUMENT, theme, width }, FIRST);
        try {
          await page.setViewportSize({ width, height });
          const centres: Record<string, number> = {};
          let tokens: Measured['tokens'] | null = null;
          for (const p of PAGES) {
            const m = await at(page, p.path, ANCHORS[p.title]!);
            tokens = m.tokens;
            centres[p.name] = centreY(need(m, p.title)) - m.detail!.top;
            if (p.name === 'Waiting on you') centres['list head row'] = centreY(need(m, 'headRow')) - m.nav!.top;
          }
          const band = tokens!.headH / 2;
          for (const [name, c] of Object.entries(centres)) {
            expect(Math.abs(c - band), `${name}: centred ${c} below its pane's top, against --head-h / 2 = ${band}`).toBeLessThan(NEAR);
          }
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 120_000);

      it(`${view}: New project rides the toggle's line at --row-h, ending at the column's inset, and the lag line sits under that row`, async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin: INSTRUMENT, theme, width }, FIRST);
        try {
          await page.setViewportSize({ width, height });
          const m = await at(page, '/waiting', '.shell-nav .fleet-new-project');
          const { rowH, sp3 } = m.tokens;
          const door = need(m, 'door');
          const toggle = need(m, 'toggle');
          const row = need(m, 'headRow');
          const lag = need(m, 'lag');
          const group = need(m, 'firstGroup');
          expect(door[3] - door[1], 'the door is --row-h tall under a mouse').toBeCloseTo(rowH, 0);
          expect(Math.abs(centreY(door) - centreY(toggle)), 'the door is on the toggle\'s line').toBeLessThan(NEAR);
          expect(Math.abs(door[2] - need(m, 'fleetPad')[2]), 'the door ends at the column\'s right inset').toBeLessThan(NEAR);
          expect(door[0] - toggle[2], 'the door follows the toggle, not over it').toBeGreaterThanOrEqual(0);
          expect(lag[1] - row[3], 'head row to the lag line: --sp-3').toBeCloseTo(sp3, 0);
          expect(group[1] - lag[3], 'the lag line to the first group: --sp-3').toBeCloseTo(sp3, 0);
          expect(lag[0] - m.nav!.left, 'the lag line starts at the inset').toBeCloseTo(m.tokens.gutter, 0);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 120_000);

      it(`${view}: the head blocks' gaps are tokens (head row then --sp-2; groups --sp-3; the list's rows --sp-1 under its head row)`, async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin: INSTRUMENT, theme, width }, BUSY);
        try {
          await page.setViewportSize({ width, height });
          const w = await at(page, '/waiting', '.shell-detail .wl-summary');
          const { sp1, sp2, sp3, headH } = w.tokens;
          const head = need(w, 'waitingHead');
          expect(head[3] - head[1], 'Waiting\'s head is a --head-h row').toBeCloseTo(headH, 0);
          expect(head[1] - w.detail!.top, 'its row starts at the pane\'s top').toBeCloseTo(0, 0);
          expect(need(w, 'waitingSummary')[1] - head[3], 'head row to the first line: --sp-2').toBeCloseTo(sp2, 0);
          expect(need(w, 'waitingGrid')[1] - need(w, 'waitingSummary')[3], 'between groups: --sp-3').toBeCloseTo(sp3, 0);
          expect(need(w, 'firstGroup')[1] - need(w, 'headRow')[3], 'the list\'s head row to its first group: --sp-1').toBeCloseTo(sp1, 0);
          const a = await at(page, '/mail', ANCHORS.scaffoldTitle!);
          expect(need(a, 'scaffoldBody')[1] - need(a, 'scaffoldRow')[3], 'a page\'s head row to its first line: --sp-2').toBeCloseTo(sp2, 0);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 120_000);
    }
  }
});

describe('Refined at a desk: its detail screens agree with each other; its list column and centred page column stay', () => {
  for (const [width, height] of DESKS) {
    for (const theme of THEMES) {
      const view = `refined, ${theme}, ${width}x${height}`;
      it(`${view}: the page screens share one left, the wide screens (Runs, Waiting on you) another at --gutter, the session header the transcript's 16`, async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin: REFINED, theme, width }, FIRST);
        try {
          await page.setViewportSize({ width, height });
          const lefts: Record<string, { left: number; kind: string }> = {};
          let gutter = 0;
          for (const p of PAGES) {
            const m = await at(page, p.path, ANCHORS[p.title]!);
            gutter = m.tokens.gutter;
            lefts[p.name] = { left: need(m, p.pad)[0] - m.detail!.left, kind: p.kind };
          }
          const s = await at(page, '/s/project-a', '.chat-head');
          // The session screen's edge is the transcript's own inset (--sp-4, 16), not the gutter (the amendment for that screen).
          expect(need(s, 'chatHeadPad')[0] - s.detail!.left, 'the session header at the transcript\'s inset').toBeCloseTo(16, 0);
          expect(need(s, 'fleetPad')[0] - s.nav!.left, 'the list column keeps its 16 (--sp-4)').toBeCloseTo(16, 0);
          const pages = Object.entries(lefts).filter(([, v]) => v.kind === 'page');
          for (const [name, v] of pages) expect(v.left, `${name} against Accounts`).toBeCloseTo(lefts['Accounts']!.left, 0);
          // Both wide columns are wider than the pane here, so each starts at the gutter.
          for (const name of ['Runs', 'Waiting on you']) expect(lefts[name]!.left, `${name} at --gutter`).toBeCloseTo(gutter, 0);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 120_000);

      it(`${view}: every detail title is centred in one --head-h band from the pane's top`, async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin: REFINED, theme, width }, FIRST);
        try {
          await page.setViewportSize({ width, height });
          for (const p of PAGES) {
            const m = await at(page, p.path, ANCHORS[p.title]!);
            const c = centreY(need(m, p.title)) - m.detail!.top;
            expect(Math.abs(c - m.tokens.headH / 2), `${p.name}: centred ${c}, against --head-h / 2`).toBeLessThan(NEAR);
          }
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 120_000);
    }
  }
});

/** Every button or select in a page scaffold's head row on the four screens that draw one in the first run: the control's
 *  box, its focus ring's reach (outline width + offset, read from the stylesheet the control would draw focused), whether
 *  its label is cut, and the row's box; plus one control in the page's BODY, which the rule must not reach. */
const HEAD_CONTROL_PAGES = [
  { name: 'Accounts', path: '/accounts', body: '.acct-door-reason button' },
  { name: 'Mail', path: '/mail', body: null },
  { name: 'Runs', path: '/runs', body: null },
  { name: 'a Settings section', path: '/settings/updates', body: null },
] as const;
async function headControls(page: Page, bodySel: string | null): Promise<{
  row: readonly [number, number, number, number];
  controls: { text: string; box: readonly [number, number, number, number]; ring: number; cut: boolean; why: string }[];
  body: number | null;
  rowH: number; tapMin: number;
}> {
  return page.evaluate((bodySelector) => {
    const root = getComputedStyle(document.documentElement);
    const row = document.querySelector('.shell-detail [data-page-scaffold] > header > div')!;
    const rr = row.getBoundingClientRect();
    const controls = [...row.querySelectorAll<HTMLElement>('button, select')].filter((el) => el.getBoundingClientRect().width > 0).map((el) => {
      const r = el.getBoundingClientRect();
      // The ring a keyboard focus draws: focus the control as the keyboard does and read its outline.
      el.focus({ focusVisible: true } as FocusOptions);
      const cs = getComputedStyle(el);
      const ring = (cs.outlineStyle === 'none' ? 0 : parseFloat(cs.outlineWidth)) + parseFloat(cs.outlineOffset || '0');
      el.blur();
      // Cut: the label is wider than the control (an ellipsis or a squeeze), or its EM box (font-size tall, centred on its
      // text box, where a glyph is drawn) leaves the control. The text box itself is taller than the em by the font's own
      // leading (Back's 26 px glyph has a 34 px box with no ink in its top and bottom 4), so it is not the measure.
      const range = document.createRange();
      range.selectNodeContents(el);
      const t = range.getBoundingClientRect();
      const em = parseFloat(getComputedStyle(el).fontSize);
      const mid = (t.top + t.bottom) / 2;
      const cut = el.scrollWidth > el.clientWidth + 0.5
        || (t.height > 0 && (mid - em / 2 < r.top - 0.5 || mid + em / 2 > r.bottom + 0.5 || t.left < r.left - 0.5 || t.right > r.right + 0.5));
      return { text: (el.textContent ?? '').trim() || el.getAttribute('aria-label') || el.tagName, box: [r.left, r.top, r.right, r.bottom] as const, ring, cut, why: `text ${t.top.toFixed(1)}-${t.bottom.toFixed(1)} x ${t.left.toFixed(1)}-${t.right.toFixed(1)} in ${r.top.toFixed(1)}-${r.bottom.toFixed(1)} x ${r.left.toFixed(1)}-${r.right.toFixed(1)}, font ${getComputedStyle(el).fontSize}` };
    });
    const bodyEl = bodySelector === null ? null : document.querySelector<HTMLElement>(`.shell-detail [data-page-body] ${bodySelector}`);
    return {
      row: [rr.left, rr.top, rr.right, rr.bottom] as const, controls,
      body: bodyEl === null ? null : bodyEl.getBoundingClientRect().height,
      rowH: parseFloat(root.getPropertyValue('--row-h')), tapMin: parseFloat(root.getPropertyValue('--tap-min')),
    };
  }, bodySel);
}

describe("a page's head-row controls: min(--row-h, --tap-min) under a mouse, the tap floor under touch (rule (c))", () => {
  for (const skin of [INSTRUMENT, REFINED]) {
    for (const [width, height] of DESKS) {
      for (const touch of [false, true]) {
        const view = `${skin}, ${width}x${height}, ${touch ? 'touch' : 'mouse'}`;
        it(`${view}: each control's height, centred on its row, its focus ring inside the row, its label whole; a body control untouched`, async () => {
          const { ctx, page, errors } = await openApp(browser!, { skin, theme: PHOSPHOR, width, touch }, FIRST);
          try {
            await page.setViewportSize({ width, height });
            let seen = 0;
            for (const p of HEAD_CONTROL_PAGES) {
              await at(page, p.path, ANCHORS.scaffoldTitle!);
              const m = await headControls(page, p.body);
              const want = touch ? m.tapMin : Math.min(m.rowH, m.tapMin);
              for (const c of m.controls) {
                seen += 1;
                const h = c.box[3] - c.box[1];
                expect(h, `${p.name} · ${c.text}: height`).toBeCloseTo(want, 0);
                expect(Math.abs((c.box[1] + c.box[3]) / 2 - (m.row[1] + m.row[3]) / 2), `${p.name} · ${c.text}: centred on its row`).toBeLessThan(NEAR);
                // Under a mouse the ring fits the row whole (32 + 2 x 4 in Instrument's 40). Under touch the control IS the row's
                // height (44 in 44), so its ring has always reached past the row: held as it is, not pinned.
                if (!touch) {
                  expect(c.box[1] - c.ring, `${p.name} · ${c.text}: ring top inside the row`).toBeGreaterThanOrEqual(m.row[1] - 0.01);
                  expect(c.box[3] + c.ring, `${p.name} · ${c.text}: ring bottom inside the row`).toBeLessThanOrEqual(m.row[3] + 0.01);
                }
                expect(c.ring, `${p.name} · ${c.text}: draws a focus ring`).toBeGreaterThan(0);
                expect(c.cut, `${p.name} · ${c.text}: label whole (${c.why})`).toBe(false);
              }
              // The rule is the head row's alone: a control in the page's body keeps the tap floor under a mouse too.
              if (m.body !== null) expect(m.body, `${p.name}: a body control keeps the tap floor`).toBeGreaterThanOrEqual(m.tapMin - 0.01);
            }
            expect(seen, 'the four screens draw head-row controls').toBeGreaterThanOrEqual(4);
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        }, 120_000);
      }
    }
  }
});

/** A session's socket: a short transcript and its status, so the transcript's column and the composer are drawn. */
const sessionFrames = (status: 'idle' | 'busy'): object[] => [
  {
    type: 'backlog', uuid: 'u-1', offset: 1, file: '/w/t.jsonl', missing: false, searchComplete: true, fileMeasured: true,
    events: [
      { kind: 'user', uuid: 'q1', ts: new Date(NOW - 10 * MIN).toISOString(), text: 'Measure the two panes.' },
      { kind: 'assistant', uuid: 'a1', ts: new Date(NOW - 9 * MIN).toISOString(), text: 'Both panes start at one inset now.' },
    ],
  },
  { type: 'status', status, statusUpdatedAt: null },
];
const WITH_TRANSCRIPTS: AppFixture = {
  ...BUSY,
  socketFrames: { '/ws/session/prog-a-w1': sessionFrames('idle'), '/ws/session/prog-b-w1': sessionFrames('busy') },
};

describe("a session screen has one edge: its header, its transcript and its composer (the ruling's amendment for the session screen)", () => {
  for (const skin of [INSTRUMENT, REFINED]) {
    for (const [width, height] of DESKS) {
      for (const [state, id] of [['idle', 'prog-a-w1'], ['busy', 'prog-b-w1']] as const) {
        it(`${skin}, ${width}x${height}, ${state}: the header's text, the transcript's column and the composer start on one left edge; the header's last control ends on the composer's right edge`, async () => {
          const { ctx, page, errors } = await openApp(browser!, { skin, theme: PHOSPHOR, width }, WITH_TRANSCRIPTS);
          try {
            await page.setViewportSize({ width, height });
            await page.goto(server!.origin + `/s/${id}`);
            await page.waitForSelector('.shell-detail .chat-item', { timeout: 20_000 });
            await page.waitForSelector('.shell-detail .composer', { timeout: 20_000 });
            await page.waitForTimeout(300);
            const e = await page.evaluate(() => {
              const content = (sel: string): [number, number] => {
                const el = document.querySelector<HTMLElement>(sel)!;
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return [r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight)];
              };
              const head = document.querySelector('.shell-detail .chat-head')!;
              // The header's text edge: the leftmost text it draws outside its controls (each skin has its own header markup).
              const walker = document.createTreeWalker(head, NodeFilter.SHOW_TEXT);
              let textLeft = Infinity;
              for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
                if ((n.textContent ?? '').trim() === '' || n.parentElement?.closest('button, a[href]') !== null) continue;
                const range = document.createRange();
                range.selectNodeContents(n);
                for (const r of range.getClientRects()) if (r.width > 0) textLeft = Math.min(textLeft, r.left);
              }
              const title = { left: textLeft };
              const lastRight = Math.max(...[...head.querySelectorAll('button, a[href]')].map((b) => b.getBoundingClientRect())
                .filter((r) => r.width > 0).map((r) => r.right));
              return { head: content('.shell-detail .chat-head'), title: title.left, lastRight, item: content('.shell-detail .chat-item'), composer: content('.shell-detail .composer') };
            });
            expect(Math.abs(e.title - e.composer[0]), `the header's text (${e.title}) on the composer's left edge (${e.composer[0]})`).toBeLessThan(NEAR);
            expect(Math.abs(e.item[0] - e.composer[0]), `the transcript's column (${e.item[0]}) on the composer's left edge`).toBeLessThan(NEAR);
            expect(Math.abs(e.head[0] - e.composer[0]), 'the header\'s side on the same edge').toBeLessThan(NEAR);
            expect(Math.abs(e.lastRight - e.composer[1]), `the header's last control (${e.lastRight}) ends on the composer's right edge (${e.composer[1]})`).toBeLessThan(NEAR);
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        }, 120_000);
      }
    }
  }
});

describe("Refined's desk runs line: the door and New project share it, the chooser has a line of its own (the ruling's point 5; ruling A, condition 3)", () => {
  for (const [width, height] of DESKS) {
    for (const [name, fixture] of [['first run', FIRST], ['busy', BUSY]] as const) {
      it(`refined, ${width}x${height}, ${name}: the Runs door and New project on the runs line, the chooser on its own line under it on the inset and the column's gap, none overlapping, the door's words one line`, async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin: REFINED, theme: PHOSPHOR, width }, fixture);
        try {
          await page.setViewportSize({ width, height });
          await page.goto(server!.origin + '/fleet');
          await page.waitForSelector('.shell-nav .fleet-runs-line .fleet-new-project', { timeout: 20_000 });
          await page.waitForTimeout(300);
          const m = await page.evaluate(() => {
            const line = document.querySelector('.shell-nav .fleet-runs-line')!;
            const boxes = [...line.children].map((k) => {
              const r = k.getBoundingClientRect();
              const c = k.getAttribute('class') ?? '';
              const cls = c.includes('fleet-runs-row') ? 'fleet-runs-row' : c.includes('fleet-new-project') ? 'fleet-new-project'
                : k.querySelector('select[aria-label="Class"]') !== null || k.matches('select') ? 'chooser' : c;
              return { cls, l: r.left, t: r.top, r: r.right, b: r.bottom };
            });
            const row = line.querySelector<HTMLElement>('.fleet-runs-row')!;
            const range = document.createRange();
            range.selectNodeContents(row);
            const tops = [...new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)))];
            const lr = line.getBoundingClientRect();
            // The chooser: the one in the column, its own line (the column's child that holds it), and what is drawn next.
            const choosers = [...document.querySelectorAll<HTMLElement>('.shell-nav select[aria-label="Class"]')];
            const sel = choosers[0] ?? null;
            const sb = sel?.getBoundingClientRect() ?? null;
            let own: Element | null = sel;
            while (own !== null && own.parentElement !== line.parentElement) own = own.parentElement;
            let next = own?.nextElementSibling ?? null;
            while (next !== null && next.getBoundingClientRect().height === 0) next = next.nextElementSibling;
            const probe = document.createElement('div');
            probe.style.cssText = 'position:absolute;visibility:hidden;height:var(--sp-3)';
            document.body.appendChild(probe);
            const sp3 = probe.getBoundingClientRect().height;
            probe.remove();
            return {
              boxes, lines: tops.length, words: row.textContent ?? '', line: { l: lr.left, r: lr.right, t: lr.top, b: lr.bottom },
              choosers: choosers.length, inLine: sel !== null && line.contains(sel),
              chooser: sb === null ? null : { l: sb.left, t: sb.top, b: sb.bottom },
              nextTop: next === null ? null : next.getBoundingClientRect().top, sp3,
            };
          });
          expect(m.boxes.map((b) => b.cls), 'the runs line holds the door and New project').toEqual(['fleet-runs-row', 'fleet-new-project']);
          expect(m.choosers, 'one chooser in the column').toBe(1);
          expect(m.inLine, 'the chooser is not on the runs line').toBe(false);
          expect(m.chooser!.t, 'the chooser is under the runs line').toBeGreaterThanOrEqual(m.line.b - 0.5);
          expect(Math.abs(m.chooser!.l - m.line.l), 'the chooser starts on the runs line\'s inset').toBeLessThanOrEqual(0.5);
          expect(m.chooser!.t - m.line.b, "the column's gap above the chooser").toBeCloseTo(m.sp3, 0);
          expect(m.nextTop, 'something is drawn under the chooser').not.toBeNull();
          expect(m.nextTop! - m.chooser!.b, "the column's gap under the chooser").toBeCloseTo(m.sp3, 0);
          const [door, add] = [m.boxes[0]!, m.boxes[1]!];
          expect(door.t < add.b && add.t < door.b, 'the door and New project share one line (their boxes overlap vertically)').toBe(true);
          for (let i = 0; i < m.boxes.length; i += 1) {
            for (let j = i + 1; j < m.boxes.length; j += 1) {
              const a = m.boxes[i]!;
              const b = m.boxes[j]!;
              const apart = a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t + 0.5 || b.b <= a.t + 0.5;
              expect(apart, `${a.cls} and ${b.cls} do not overlap`).toBe(true);
            }
            expect(m.boxes[i]!.l, `${m.boxes[i]!.cls} inside the line`).toBeGreaterThanOrEqual(m.line.l - 0.5);
            expect(m.boxes[i]!.r, `${m.boxes[i]!.cls} inside the line`).toBeLessThanOrEqual(m.line.r + 0.5);
          }
          expect(m.lines, `"${m.words}" on one line`).toBe(1);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 120_000);
    }
  }
});

describe('the phone holds its figures; Waiting on you joins its scaffold\'s inset (ruling 6)', () => {
  for (const skin of [INSTRUMENT, REFINED]) {
    it(`${skin}, 390x844: Waiting and every page at --gutter, the list column at 16, the session header at --sp-2, Waiting's title --sp-2 down`, async () => {
      const { ctx, page, errors } = await openApp(browser!, { skin, theme: PHOSPHOR, width: 390 }, FIRST);
      try {
        const w = await at(page, '/waiting', ANCHORS.waitingTitle!);
        const { gutter, sp2 } = w.tokens;
        expect(need(w, 'waitingPad')[0] - w.detail!.left, 'Waiting at --gutter').toBeCloseTo(gutter, 0);
        expect(need(w, 'waitingTitle')[1] - w.detail!.top, 'Waiting\'s title --sp-2 below the top, as today').toBeCloseTo(sp2, 0);
        for (const path of ['/accounts', '/settings', '/mail']) {
          const m = await at(page, path, ANCHORS.scaffoldTitle!);
          expect(need(m, 'scaffoldRowPad')[0] - m.detail!.left, `${path} at --gutter`).toBeCloseTo(gutter, 0);
        }
        const s = await at(page, '/s/project-a', '.chat-head');
        expect(need(s, 'chatHeadPad')[0] - s.detail!.left, 'the session header keeps its --sp-2').toBeCloseTo(sp2, 0);
        const f = await at(page, '/fleet', '.shell-nav .fleet');
        expect(need(f, 'fleetPad')[0] - f.nav!.left, 'the list keeps its 16').toBeCloseTo(16, 0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 120_000);
  }
});
