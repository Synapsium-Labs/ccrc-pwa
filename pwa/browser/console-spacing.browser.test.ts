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

async function measure(page: Page, anchorSet: Readonly<Record<string, string>> = ANCHORS): Promise<Measured> {
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
  }, anchorSet);
}

/** Waits for the layout to settle, a condition and never a fixed pause: the fonts are loaded and every box the selectors
 *  match has read the same on three polls in a row, 100 ms apart. The accounts poll and the fleet frames land after the
 *  first paint and can move the head block, so a loaded box waits as long as that takes and an idle one no longer. */
const settle = (page: Page, selectors: readonly string[] = Object.values(ANCHORS)): Promise<unknown> =>
  page.waitForFunction((list) => {
    const w = window as unknown as { spacingSig?: string; spacingSame?: number };
    const sig = list.map((s) => [...document.querySelectorAll(s)].map((e) => {
      const r = e.getBoundingClientRect();
      return `${r.left},${r.top},${r.width},${r.height}`;
    }).join(';')).join('|');
    if (w.spacingSig === sig) w.spacingSame = (w.spacingSame ?? 0) + 1;
    else { w.spacingSig = sig; w.spacingSame = 0; }
    return document.fonts.status === 'loaded' && w.spacingSame >= 2;
  }, selectors, { polling: 100, timeout: 20_000 });

const at = async (page: Page, path: string, ready: string, anchorSet: Readonly<Record<string, string>> = ANCHORS): Promise<Measured> => {
  await page.goto(server!.origin + path);
  await page.waitForSelector(ready, { timeout: 20_000 });
  await settle(page, Object.values(anchorSet));
  return measure(page, anchorSet);
};
const need = (m: Measured, name: string): readonly [number, number, number, number] => {
  const b = m.boxes[name];
  if (b === null || b === undefined) throw new Error(`${name} is not drawn`);
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

describe('Instrument at a desk: one inset and one head line in both panes (Accounts, Settings, Mail, Archive, Runs, Waiting on you, a session, the list column)', () => {
  for (const [width, height] of DESKS) {
    for (const theme of THEMES) {
      const view = `instrument, ${theme}, ${width}x${height}`;
      it(`${view}: Accounts, Settings, Mail, Archive, Runs, Waiting on you, a session's header and the list column start --gutter from their pane, and --gutter is --sp-4`, async () => {
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

      it(`${view}: the titles of Accounts, Settings, Mail, Archive, Runs and Waiting on you, and the list column's head row, are centred in one --head-h band from the pane's top`, async () => {
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

      it(`${view}: New project rides the toggle's line at --row-h, ending at the column's inset, and the lag line sits --sp-2 under that row`, async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin: INSTRUMENT, theme, width }, FIRST);
        try {
          await page.setViewportSize({ width, height });
          const m = await at(page, '/waiting', '.shell-nav .fleet-new-project');
          const { rowH, sp2, sp3 } = m.tokens;
          const door = need(m, 'door');
          const toggle = need(m, 'toggle');
          const row = need(m, 'headRow');
          const lag = need(m, 'lag');
          const group = need(m, 'firstGroup');
          expect(door[3] - door[1], 'the door is --row-h tall under a mouse').toBeCloseTo(rowH, 0);
          expect(Math.abs(centreY(door) - centreY(toggle)), 'the door is on the toggle\'s line').toBeLessThan(NEAR);
          expect(Math.abs(door[2] - need(m, 'fleetPad')[2]), 'the door ends at the column\'s right inset').toBeLessThan(NEAR);
          expect(door[0] - toggle[2], 'the door follows the toggle, not over it').toBeGreaterThanOrEqual(0);
          expect(lag[1] - row[3], 'head row to the lag line, its first line: --sp-2, the scaffold\'s value (ruling 4)').toBeCloseTo(sp2, 0);
          expect(group[1] - lag[3], 'the lag line to the first group: --sp-3').toBeCloseTo(sp3, 0);
          expect(lag[0] - m.nav!.left, 'the lag line starts at the inset').toBeCloseTo(m.tokens.gutter, 0);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 120_000);

      it(`${view}: the head blocks' gaps are tokens (head row then --sp-2, in the list column in both modes too; groups --sp-3)`, async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin: INSTRUMENT, theme, width }, BUSY);
        try {
          await page.setViewportSize({ width, height });
          const w = await at(page, '/waiting', '.shell-detail .wl-summary');
          const { sp2, sp3, headH } = w.tokens;
          const head = need(w, 'waitingHead');
          expect(head[3] - head[1], 'Waiting\'s head is a --head-h row').toBeCloseTo(headH, 0);
          expect(head[1] - w.detail!.top, 'its row starts at the pane\'s top').toBeCloseTo(0, 0);
          expect(need(w, 'waitingSummary')[1] - head[3], 'head row to the first line: --sp-2').toBeCloseTo(sp2, 0);
          expect(need(w, 'waitingGrid')[1] - need(w, 'waitingSummary')[3], 'between groups: --sp-3').toBeCloseTo(sp3, 0);
          expect(need(w, 'firstGroup')[1] - need(w, 'headRow')[3], 'status mode: the list\'s head row to its first group: --sp-2 (ruling 4)').toBeCloseTo(sp2, 0);
          // Pressing the switch moves nothing under the head row: Project mode's first line, the chooser, is --sp-2 down too.
          await page.click('.shell-nav .ins-head-row [role="radio"]:not([aria-checked="true"])');
          await page.waitForSelector('.shell-nav .ins-chooser-line > *', { timeout: 20_000 });
          await settle(page, ['.shell-nav .ins-head-row', '.shell-nav .ins-chooser-line > *']);
          const p = await measure(page, { ...ANCHORS, chooser: '.shell-nav .ins-chooser-line > *' });
          expect(need(p, 'chooser')[1] - need(p, 'headRow')[3], 'project mode: the list\'s head row to the chooser: --sp-2 (ruling 4)').toBeCloseTo(sp2, 0);
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

describe('Refined at a desk: Accounts, Settings, Mail, Archive, Runs, Waiting on you and a session agree with each other; its list column and centred page column stay', () => {
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

      it(`${view}: the titles of Accounts, Settings, Mail, Archive, Runs and Waiting on you are centred in one --head-h band from the pane's top`, async () => {
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
            let addAccount = 0;
            for (const p of HEAD_CONTROL_PAGES) {
              await at(page, p.path, ANCHORS.scaffoldTitle!);
              const m = await headControls(page, p.body);
              const want = touch ? m.tapMin : Math.min(m.rowH, m.tapMin);
              for (const c of m.controls) {
                seen += 1;
                if (p.name === 'Accounts' && /Add account/.test(c.text)) addAccount += 1;
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
            expect(addAccount, 'Add account is one of the Accounts head row\'s controls, measured above').toBe(1);
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
            await settle(page, ['.shell-detail .chat-head', '.shell-detail .chat-item', '.shell-detail .composer']);
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
          await settle(page, ['.shell-nav .fleet-runs-line', '.shell-nav .fleet-runs-line > *', '.shell-nav .fleet-chooser-line']);
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

describe('the Accounts head block on the merged door (#3402): one edge for its lines, the roll-up and projection one group', () => {
  for (const skin of [INSTRUMENT, REFINED]) {
    for (const [width, height] of DESKS) {
      it(`${skin}, ${width}x${height}: the door's reason starts on the body's edge with its mark's room outside it; the roll-up and the projection --sp-1 apart; the live region keeps its sr-only box`, async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin, theme: PHOSPHOR, width }, FIRST);
        try {
          await page.setViewportSize({ width, height });
          await at(page, '/accounts', '.acct-door-reason');
          await page.waitForSelector('.accounts-projection', { timeout: 20_000 });
          const m = await page.evaluate(() => {
            const tok = (name: string): number => {
              const probe = document.createElement('div');
              probe.style.cssText = `position:absolute;visibility:hidden;height:var(${name})`;
              document.body.appendChild(probe);
              const h = probe.getBoundingClientRect().height;
              probe.remove();
              return h;
            };
            /** Where an element's first line of text starts (its ink, not its box). */
            const inkLeft = (el: Element): number => {
              const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
              let left = Infinity;
              for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
                if ((n.textContent ?? '').trim() === '') continue;
                const r = document.createRange();
                r.selectNodeContents(n);
                for (const b of r.getClientRects()) if (b.width > 0) left = Math.min(left, b.left);
                if (left !== Infinity) break;
              }
              return left;
            };
            const reason = document.querySelector('.acct-door-reason')!;
            const sentence = document.getElementById('acct-door-reason')!;
            const rollup = document.querySelector('.accounts-rollup')!;
            const projection = document.querySelector('.accounts-projection')!;
            const live = reason.querySelector<HTMLElement>('p.sr-only');
            return {
              sp1: tok('--sp-1'), sp2: tok('--sp-2'),
              reasonBox: reason.getBoundingClientRect().left, reasonInk: inkLeft(sentence), rollupInk: inkLeft(rollup),
              rollupBottom: rollup.getBoundingClientRect().bottom, projectionTop: projection.getBoundingClientRect().top,
              liveMargin: live === null ? null : getComputedStyle(live).margin,
            };
          });
          expect(Math.abs(m.reasonInk - m.rollupInk), `the reason's text starts on the body's edge (reason ${m.reasonInk}, roll-up ${m.rollupInk})`).toBeLessThanOrEqual(0.5);
          expect(m.reasonInk - m.reasonBox, "the mark's room (--sp-2) stays inside the reason's box, before its text").toBeCloseTo(m.sp2, 0);
          expect(m.projectionTop - m.rollupBottom, 'the roll-up and the projection are one group, --sp-1 apart').toBeCloseTo(m.sp1, 0);
          expect(m.liveMargin, 'the live region is drawn').not.toBeNull();
          expect(m.liveMargin, "the reason's paragraph rule leaves the live region's sr-only margin alone").toBe('-1px');
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 120_000);

      for (const touch of [false, true]) {
        const pointer = touch ? 'touch' : 'mouse';
        it(`${skin}, ${width}x${height}, ${pointer}: the disclosure is min(--row-h, --tap-min) under a mouse and the tap floor under touch, with equal --sp-1 gaps above and below it (ruling 3)`, async () => {
          const { ctx, page, errors } = await openApp(browser!, { skin, theme: PHOSPHOR, width, touch }, FIRST);
          try {
            await page.setViewportSize({ width, height });
            await at(page, '/accounts', '.acct-door-reason details > summary');
            await settle(page, ['.acct-door-reason', '.acct-door-reason > *', '.acct-door-reason details > summary']);
            const m = await page.evaluate(() => {
              const tok = (name: string): number => {
                const probe = document.createElement('div');
                probe.style.cssText = `position:absolute;visibility:hidden;height:var(${name})`;
                document.body.appendChild(probe);
                const h = probe.getBoundingClientRect().height;
                probe.remove();
                return h;
              };
              const details = document.querySelector('.acct-door-reason details')!;
              const summary = details.querySelector('summary')!.getBoundingClientRect();
              const before = details.previousElementSibling!.getBoundingClientRect();
              const after = details.nextElementSibling!.getBoundingClientRect();
              return {
                rowH: tok('--row-h'), tapMin: tok('--tap-min'), sp1: tok('--sp-1'),
                height: summary.height, above: summary.top - before.bottom, below: after.top - summary.bottom,
              };
            });
            const want = touch ? m.tapMin : Math.min(m.rowH, m.tapMin);
            expect(m.height, `the summary under ${pointer}: ${m.height}, against ${want}`).toBeCloseTo(want, 0);
            expect(m.above, `above the disclosure: ${m.above}, against --sp-1 ${m.sp1}`).toBeCloseTo(m.sp1, 0);
            expect(m.below, `below the closed disclosure: ${m.below}, against the gap above it, --sp-1 ${m.sp1}`).toBeCloseTo(m.sp1, 0);
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        }, 120_000);
      }
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

// ---- Fix round 1 (the coordinator's rulings on review run 3943) ----

const EPIC = {
  key: 'e-1', title: 'Epic one', summary: 'The epic summary, a sentence that wraps on a phone screen at either width.',
  project: 'project-a', waves: [1], state: 'active', url: null, sync: 'none', syncWord: null,
  checkpoints: [{ key: 'c-1', title: 'First checkpoint', kind: 'acceptance', state: 'open', proves: [], metAt: null, evidence: null,
    url: null, sync: 'none', syncWord: null }],
  tickets: [{ key: 't-1', kind: 'work', title: 'A ticket', project: 'project-a', checkpoint: 'c-1', source: 'plan', state: 'open',
    runId: null, identifier: null, url: null, sync: 'none', syncWord: null }],
};
/** The busy fleet with what the run pages, the programme, its epic and Upkeep read. */
const SCREENS: AppFixture = {
  api: {
    ...BUSY.api,
    '/api/runs': { runs: RUNS, nextBefore: null },
    '/api/runs/100': { ok: true, run: RUNS[0], spend: { measured: false, reason: 'no-sweep' } },
    '/api/runs/100/items': { ok: true, items: [] },
    '/api/runs/100/record': { ok: true, run: RUNS[0], events: [], reviewedBy: [], olderEvents: 0 },
    '/api/runs/100/signals': { ok: true, signals: { signals: { suite: { ok: false, why: 'absent' }, failure: { ok: false, why: 'absent' } } } },
    '/api/coord/caps': { ok: true, caps: { maxConcurrentWorkers: 4 }, usage: { running: 1 }, updatedAt: null },
    '/api/runs/find': { ok: true, exact: null, runs: [], reviewsOf: [], next: null },
    '/api/programmes/prog-b/plan': { ok: true, plan: { program: 'prog-b', planned: true, initiatives: [], epics: [EPIC], doneWhen: [] } },
    '/api/projects/project-a/upkeep': { ok: true, epic: { ...EPIC, key: 'upkeep', title: 'Upkeep', checkpoints: [] }, notClosed: [] },
  },
  fleetFrames: BUSY.fleetFrames,
};

/** The ledger screens and the item route's three parts: each root's content box (inside its padding) and its border box. */
const LEDGER_ANCHORS: Readonly<Record<string, string>> = {
  ledgerPad: '.shell-detail .wl', ledgerBox: '.shell-detail .wl',
  itemPad: '.shell-detail .wi', itemBox: '.shell-detail .wi',
  stripPad: '.shell-detail .wi-nav:not(.rd-strip)', stripBox: '.shell-detail .wi-nav:not(.rd-strip)',
  digestPad: '.shell-detail .digest-screen', digestBox: '.shell-detail .digest-screen',
};
const sidewaysScroll = (page: Page): Promise<number> =>
  page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);

describe('the phone: every ledger root and the item route sit at the scaffold\'s inset (ruling 1, which widens ruling 6)', () => {
  const LEDGERS = [
    { name: 'Programme', path: '/programmes/prog-b', parts: ['ledger'] },
    { name: 'Epic', path: '/programmes/prog-b/epics/e-1', parts: ['ledger'] },
    { name: 'Upkeep', path: '/projects/project-a/upkeep', parts: ['ledger'] },
    { name: 'the item route', path: '/waiting/1', parts: ['item', 'strip'] },
  ] as const;
  for (const skin of [INSTRUMENT, REFINED]) {
    for (const width of [360, 390]) {
      it(`${skin}, ${width}x844: Programme, Epic and Upkeep's roots, and the item route's body and step strip, start --gutter from the screen's edge; nothing scrolls sideways`, async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin, theme: PHOSPHOR, width }, SCREENS);
        try {
          for (const l of LEDGERS) {
            const m = await at(page, l.path, `.shell-detail ${l.parts[0] === 'ledger' ? '.wl' : '.wi'}`, LEDGER_ANCHORS);
            const g = m.tokens.gutter;
            for (const part of l.parts) {
              const left = need(m, `${part}Pad`)[0] - m.detail!.left;
              expect(Math.abs(left - g), `${l.name}, ${part}: its text starts ${left} from the edge, against --gutter ${g}`).toBeLessThan(NEAR);
            }
            expect(await sidewaysScroll(page), `${l.name}: nothing scrolls sideways`).toBeLessThanOrEqual(0);
          }
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 120_000);
    }
  }
});

describe('at a desk: the item view, its step strip and the coordinator digest start --gutter inside their column, which starts at the pane or centres in it as the skin says', () => {
  const PARTS = [
    { name: 'the item view', path: '/waiting/1', part: 'item' },
    { name: 'its step strip', path: '/waiting/1', part: 'strip' },
    { name: 'the coordinator digest', path: '/digest', part: 'digest' },
  ] as const;
  for (const skin of [INSTRUMENT, REFINED]) {
    for (const [width, height] of DESKS) {
      it(`${skin}, ${width}x${height}: the item view, its step strip and the digest: --gutter of padding; Instrument's column at the pane's edge, Refined's centred`, async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin, theme: PHOSPHOR, width }, SCREENS);
        try {
          await page.setViewportSize({ width, height });
          for (const p of PARTS) {
            const m = await at(page, p.path, LEDGER_ANCHORS[`${p.part}Box`]!, LEDGER_ANCHORS);
            const g = m.tokens.gutter;
            const box = need(m, `${p.part}Box`);
            const pad = need(m, `${p.part}Pad`)[0] - box[0];
            expect(Math.abs(pad - g), `${p.name}: its padding ${pad}, against --gutter ${g}`).toBeLessThan(NEAR);
            const before = box[0] - m.detail!.left;
            const after = m.detail!.right - box[2];
            if (skin === INSTRUMENT) {
              expect(Math.abs(before), `${p.name}: Instrument's column starts at the pane's edge (${before})`).toBeLessThan(NEAR);
            } else {
              expect(Math.abs(before - after), `${p.name}: Refined's column centres (${before} and ${after})`).toBeLessThan(1);
            }
          }
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 120_000);
    }
  }
});

describe('under the head row, the first line is --sp-2 down on every screen outside the list (ruling 4)', () => {
  const FIRSTS = [
    { name: 'Runs (its find box)', path: '/runs', first: '.shell-detail [data-page-body] .rf-box' },
    { name: 'a run (its Back control)', path: '/runs/100', first: '.shell-detail .rd-strip .wi-back' },
    { name: 'Runs advanced (its Back control)', path: '/runs/advanced', first: '.shell-detail .rd-strip .wi-back' },
  ] as const;
  for (const skin of [INSTRUMENT, REFINED]) {
    for (const [width, height] of DESKS) {
      it(`${skin}, ${width}x${height}: Runs, a run and Runs advanced: the head row to the first line is --sp-2, and that line starts on the body's edge`, async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin, theme: PHOSPHOR, width }, SCREENS);
        try {
          await page.setViewportSize({ width, height });
          for (const f of FIRSTS) {
            const m = await at(page, f.path, f.first, { ...ANCHORS, first: f.first });
            const gap = need(m, 'first')[1] - need(m, 'scaffoldRow')[3];
            expect(gap, `${f.name}: ${gap} under the head row, against --sp-2 ${m.tokens.sp2}`).toBeCloseTo(m.tokens.sp2, 0);
            const edge = need(m, 'first')[0] - need(m, 'scaffoldRowPad')[0];
            expect(Math.abs(edge), `${f.name}: it starts ${edge} from the head row's text edge`).toBeLessThan(NEAR);
          }
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 120_000);
    }
  }
});
