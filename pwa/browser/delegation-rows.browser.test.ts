// The delegation broker's entries in the fleet list, the fleet foot's region and the session header (wave 4, PR2; delegation
// visibility), measured in a real Chrome over the production build at 390, 1280 and 1920, in both skins and both palettes.
// The jsdom suites (test/fleet-screen.test.tsx, test/fleet-rollup-render.test.tsx, test/project-card.test.tsx) pin the markup;
// this file holds what they cannot. Desktop polish C48 (D-8782): the fleet list draws NO delegation row on a card (not a
// session's agent or workflow, not a worktree, not an unowned tree, no group of them), so what is measured on the page now is
// that none is drawn and the card still fits at each width, plus the rows that remain: the region at the foot of the list
// (entries whose session is in no fleet list: a long name and a long raw session id) and the session header's entry list.
//
// The fixture is one card, project-a: a programme (`port-api`: its coordinator and one worker) and a session in no
// programme. The frame carries entries of all three listed sessions, two worktrees, an offline one and an unowned tree, none of
// which may be drawn on the card; one activity's session is in no fleet list, so the region draws it, opened here.
// Instrument is put in its project mode (`GROUP_MODE_KEY`), where it draws the same project cards as Refined.
//
//   CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=1 browser/delegation-rows.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
import { GROUP_MODE_KEY } from '../src/skins/instrument/FleetTable';
import { withRunBinding } from '../test/runBindingFixture';
import { activity, frame, lease, unowned } from '../test/delegationFixture';
import { LIVENESS_QUALIFIER } from '../src/fleet/delegationWords';

/** The four condition words a delegation row may carry: the words a phone must always show whole (D-7783). */
const CONDITION_WORDS = Object.values(LIVENESS_QUALIFIER).map((q) => q.word);

const NOW = Date.now();

const session = (id: string, project: string, extra: object = {}): object => ({
  id, wrapper: 'lane-a', home: 'lane-a', project, workdir: `/w/${project}/${id}`,
  workspace: id, name: id, status: 'busy', statusUpdatedAt: NOW - 60_000, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: `ws/${id}`, ctxPct: 40, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'working', bucketSince: NOW - 60_000, unmeasured: [],
  started: true, child: { kind: 'none' }, ...extra,
});

const RUNS = [{
  id: 100, program: 'port-api', programTitle: 'Port the API', wave: 2, waveOf: 4, project: 'project-a', homeProject: 'project-a',
  sessionId: 'port-w1', workspace: 'port-w1', branch: 'ws/port-w1', state: 'working', kind: 'work', reviews: null,
  claimedBy: 'port-coord', resumed: false, clearedAt: null, openedAt: NOW - 3_600_000, dispatchStartedAt: null,
  dispatchedAt: NOW - 3_000_000, closedAt: null, handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false,
}];

const SESSIONS = [
  session('port-coord', 'project-a', { role: 'coordinator' }),
  // Real subagents on a card session (D-8771): the no-count pin below can fail for them. At `main` the card already drew none (D-5545).
  session('port-w1', 'project-a', { role: 'child', subagents: [{ name: 'code-reviewer', startedAt: NOW - 60_000 }, { name: 'explorer', startedAt: NOW - 30_000 }] }),
  session('lone-tidy-pass', 'project-a'),
];

const DELEGATION = frame({
  activities: [
    activity({ activityId: 'a-lone', parentId: 'lone-tidy-pass',
      displayName: 'map every caller of the projection decider across the server and the PWA trees' }),
    activity({ activityId: 'a-coord', parentId: 'port-coord', displayName: 'read the plan' }),
    activity({ activityId: 'a-chip', parentId: 'port-w1', placement: 'chip', displayName: 'check the wire' }),
    activity({ activityId: 'a-unlisted', parentId: 'gone-session-from-an-earlier-run-with-a-long-identifier-of-its-own',
      displayName: 'reconcile every reader of the projection frame across the server, the agent and the PWA trees' }),
  ],
  leases: [
    lease({ leaseId: 'l-lone', parentId: 'lone-tidy-pass', sourceKind: 'raw', project: 'project-b', adminRecord: 'agent-l1',
      canonicalPath: '/w/project-a/.claude/worktrees/agent-a1b2c3d4e5f6-a-very-long-worktree-name', disposition: 'ephemeral', expiresAt: null }),
    lease({ leaseId: 'l-via', parentId: 'port-w1', adminRecord: 'agent-v1', canonicalPath: '/w/project-a/.claude/worktrees/agent-v1' }),
    lease({ leaseId: 'l-off', parentId: 'coord-gone', group: 'offline-coordinator', sourceKind: 'raw', adminRecord: 'agent-o1',
      canonicalPath: '/w/project-a/.claude/worktrees/agent-o1' }),
  ],
  unowned: [unowned({ adminRecord: 'agent-u1', canonicalPath: '/w/project-a/.claude/worktrees/agent-u1', verdict: 'conflicting' })],
});

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/runs': RUNS, '/api/claims': [],
  },
  // A current server's frames: each worker carries the run binding over RUNS (D-7182, C7d), then the projection.
  fleetFrames: [
    { type: 'fleet', sessions: withRunBinding(SESSIONS as never[], RUNS as never[]) },
    { type: 'runs', runs: RUNS },
    { type: 'delegation', delegation: DELEGATION },
  ],
};

const SKINS = [REFINED, INSTRUMENT] as const;
const THEMES = [PHOSPHOR, 'light'] as const;
const WIDTHS = [390, 1280, 1920] as const;

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

async function open(skin: string, theme: string, width: number) {
  const opened = await openApp(browser!, { skin, theme, width }, FIXTURE);
  await opened.ctx.addInitScript(([key]) => {
    try { localStorage.setItem(key, 'project'); } catch { /* the default mode is then measured */ }
  }, [GROUP_MODE_KEY] as const);
  await opened.page.goto(server!.origin + '/');
  await opened.page.waitForSelector('.proj-card', { timeout: 20_000 });
  // The region at the foot of the list starts closed: open it, as the operator would, so its row is drawn. It is the one
  // place a delegation entry is still listed outside a session's details (D-8782).
  await opened.page.locator('.fleet-unlisted .proj-group-toggle').click();
  await opened.page.waitForSelector('.fleet-unlisted .proj-work', { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(400); // the first paint's transitions settle
  return opened;
}

const measureUnlisted = (): { text: string; inList: boolean; overflow: number }[] => {
  const list = document.querySelector<HTMLElement>('.fleet-list')!.getBoundingClientRect();
  const within = (a: DOMRect, b: DOMRect): boolean => a.left >= b.left - 0.5 && a.right <= b.right + 0.5;
  return [...document.querySelectorAll<HTMLElement>('.fleet-unlisted, .fleet-unlisted .proj-work')].map((el) => ({
    text: el.textContent ?? '', inList: within(el.getBoundingClientRect(), list), overflow: el.scrollWidth - el.clientWidth,
  }));
};

/** Each delegation row's words (on a card, in the fleet foot's region and in the session header): whether its condition
 *  word and its last part each lie wholly inside the row's words box. Only the one free-text part may end in an
 *  ellipsis; a clip of either of these is a row whose state or session a phone cannot read (review 1424 F1, D-7783).
 *  The boxes are measured, not the container's scroll width, because the words box hides its overflow. */
interface PartsFit {
  readonly text: string;
  readonly condition: boolean;
  readonly last: boolean;
  readonly hasCondition: boolean;
  /** The free-text part: its width against the floor (`min(8ch, its own length)`), and whether its text is cut, in a
   *  box that clips (a computed `overflow-x` other than `visible`: with `visible` the text paints on over the next part)
   *  and ends in an ellipsis (review 1431 F2, F3; review 1435 F2). `null` for a row with no such part. */
  readonly name: { readonly width: number; readonly floor: number; readonly cut: boolean; readonly clips: boolean;
    readonly ellipsis: boolean } | null;
  /** Parts after the first that start a line, and of those, the ones whose middot is drawn (review 1431 D). */
  readonly lineStarts: number;
  readonly leadingDots: readonly string[];
  /** Parts that draw a separator and sit under an overflow clip, which cuts that separator away in an engine with no
   *  `overflow-clip-margin` (review 1435 F1). */
  readonly clippedSeparators: readonly string[];
  /** Parts after the first that share a line with the part before them, and of those, the ones whose separator is not
   *  drawn in the gap between the two: a tap at the gap's centre reaches the part only through its `::before`, so this
   *  measures where the glyph's box is, and a gap narrower than the floor is one the glyph covers a word in (review 1435
   *  F2). */
  readonly midLine: number;
  readonly missingSeparators: readonly string[];
}
/** The name's floor, in characters of its own font (review 1431 F2): the test's own figure, never read from the CSS. */
const NAME_FLOOR_CH = 8;
/** The least gap a separator is drawn in: wide enough for the glyph and a space either side at the rows' sizes. */
const GAP_FLOOR_PX = 6;
const measureParts = ({ words, floorCh, gapFloor }: { words: readonly string[]; floorCh: number; gapFloor: number }): PartsFit[] =>
  [...document.querySelectorAll<HTMLElement>('.proj-work-parts')].map((box) => {
    box.scrollIntoView({ block: 'center', inline: 'nearest' });
    const b = box.getBoundingClientRect();
    const inside = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5;
    };
    const parts = [...box.querySelectorAll<HTMLElement>('.proj-work-part')];
    const cond = parts.find((p) => words.includes(p.textContent ?? ''));
    const nameEl = box.querySelector<HTMLElement>('.proj-work-name');
    // The box the name's text is drawn in: its own inner box, or the part itself if there is none.
    const textEl = nameEl?.querySelector<HTMLElement>('.proj-work-name-text') ?? nameEl;
    let name: PartsFit['name'] = null;
    if (nameEl !== null && textEl !== null && textEl !== undefined) {
      const probe = document.createElement('span');
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${getComputedStyle(nameEl).font}`;
      probe.textContent = '0'.repeat(floorCh);
      document.body.append(probe);
      const chFloor = probe.getBoundingClientRect().width;
      probe.remove();
      const t = getComputedStyle(textEl);
      name = {
        width: nameEl.getBoundingClientRect().width, floor: Math.min(chFloor, textEl.scrollWidth),
        cut: textEl.scrollWidth > textEl.clientWidth + 0.5, clips: t.overflowX !== 'visible', ellipsis: t.textOverflow === 'ellipsis',
      };
    }
    // A middot is drawn at a line's start when its box lies inside the clipping words box there.
    const clips = getComputedStyle(box).overflowX !== 'visible';
    const starts = parts.slice(1).filter((p) => Math.abs(p.getBoundingClientRect().left - b.left) < 1);
    const leadingDots = starts.filter((p) => {
      const dot = getComputedStyle(p, '::before');
      if (dot.content === 'none' || dot.content === '') return false;
      if (dot.position !== 'absolute') return true;
      const dotRight = p.getBoundingClientRect().right - parseFloat(dot.right);
      return !(clips && dotRight <= b.left + 0.5);
    }).map((p) => p.textContent ?? '');
    const separated = parts.slice(1);
    const clippedSeparators = separated.filter((p) => getComputedStyle(p).overflowX !== 'visible').map((p) => p.textContent ?? '');
    const mids = separated.filter((p) => !starts.includes(p));
    const missingSeparators = mids.filter((p) => {
      const prev = parts[parts.indexOf(p) - 1]!.getBoundingClientRect();
      const r = p.getBoundingClientRect();
      const gap = r.left - prev.right;
      if (gap < gapFloor) return true;
      const hit = document.elementFromPoint(prev.right + gap / 2, r.top + Math.min(r.height, parseFloat(getComputedStyle(p).lineHeight) || r.height) / 2);
      return hit === null || !p.contains(hit);
    }).map((p) => p.textContent ?? '');
    return {
      text: box.textContent ?? '', hasCondition: cond !== undefined,
      condition: cond === undefined || inside(cond), last: parts.length === 0 || inside(parts[parts.length - 1]!),
      name, lineStarts: starts.length, leadingDots, clippedSeparators, midLine: mids.length, missingSeparators,
    };
  });

/** What every row's words must hold wherever they are drawn: the condition word and the last part whole, the name at
 *  its floor, no line that starts with a middot, and every separator unclipped and drawn in its gap. */
const expectWords = (words: readonly PartsFit[]): void => {
  for (const w of words) {
    expect(w.condition, `${w.text}: its condition word is whole`).toBe(true);
    expect(w.last, `${w.text}: its last part is whole`).toBe(true);
    // Review 1431 F2: the name is never squeezed below its floor; the line wraps first.
    if (w.name !== null) expect(w.name.width, `${w.text}: the name keeps its floor`).toBeGreaterThanOrEqual(w.name.floor - 0.5);
    // Review 1431 D: no wrapped line starts with a lone middot.
    expect(w.leadingDots, `${w.text}: no line starts with a middot`).toEqual([]);
    // Review 1435 F1: no part that draws a separator is under a clip, so no engine cuts the separator away.
    expect(w.clippedSeparators, `${w.text}: every separator's part computes overflow-x: visible`).toEqual([]);
    // Review 1435 F2: every mid-line separator is drawn in the gap between its part and the one before.
    expect(w.missingSeparators, `${w.text}: every mid-line separator is drawn in its gap`).toEqual([]);
  }
  expect(words.reduce((n, w) => n + w.midLine, 0), 'some separator is measured mid-line').toBeGreaterThan(0);
};

describe.each(SKINS)('the fleet list draws no delegation row on a card in %s (D-8782)', (skin) => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      it(`at ${width} (${theme}): no sideways scroll, no page error, no delegation row on a card, the region's row fits`, async () => {
        const { ctx, page, errors } = await open(skin, theme, width);
        try {
          const shots = process.env['CCRC_SHOTS'];
          if (shots !== undefined && shots !== '') {
            await page.screenshot({ path: `${shots}/delegation-${skin}-${theme}-${width}.png`, fullPage: true });
          }
          const sideScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(sideScroll, 'sideways scroll').toBe(0);
          // Positive controls: the three listed sessions' rows are drawn, so an empty `.proj-work` set is not an empty card.
          const drawn = await page.evaluate(() => {
            const lines = [...document.querySelectorAll('.sess-line')];
            return { rows: lines.length, withSubagents: lines.some((l) => l.textContent?.includes('port-w1')),
              card: document.querySelector('.proj-card')?.textContent ?? '' };
          });
          expect(drawn.rows, 'positive control: the session rows were drawn').toBeGreaterThanOrEqual(3);
          expect(drawn.withSubagents, 'positive control: the row with subagents was drawn').toBe(true);
          // D-8782: no delegation row, group header or control on any card, and none of the frame's names on one.
          expect(await page.locator('.proj-card .proj-work').count(), 'no delegation row on a card').toBe(0);
          expect(await page.locator('.proj-card .proj-group-toggle').count(), 'no group header on a card').toBe(0);
          expect(await page.locator('.proj-work-controls').count(), 'no worktree control anywhere on the page').toBe(0);
          for (const gone of ['map every caller', 'read the plan', 'check the wire', 'agent-l1', 'agent-v1', 'agent-o1', 'agent-u1', 'Offline coordinator', 'Unowned work']) {
            expect(drawn.card, `${gone}: not on a card`).not.toContain(gone);
          }
          // D-8771 (and C46): no session row counts its delegated entries or subagents, in its text or accessible name.
          const scanned = await page.evaluate(() => {
            const lines = [...document.querySelectorAll('.sess-line')];
            return lines.flatMap((line) => [line.textContent ?? '', ...[...line.querySelectorAll('*')]
              .flatMap((e) => [e.getAttribute('aria-label'), e.getAttribute('title')]).filter((x): x is string => x !== null)]);
          });
          expect(scanned.filter((s) => /delegated|subagent|⑂/i.test(s)), 'no session row counts its delegated entries or subagents').toEqual([]);
          expect(await page.locator('.sess-meta-chip').count(), 'the R9 chip is gone').toBe(0);
          const folds = await page.evaluate(() => [...document.querySelectorAll('.proj-children-part')].map((e) => e.textContent ?? ''));
          expect(folds.filter((s) => /delegated|worktrees/.test(s)), 'no fold line names delegated work or worktrees').toEqual([]);
          // The region: one toggle and its one row, inside the fleet list, nothing overflowing.
          const unlisted = await page.evaluate(measureUnlisted);
          expect(unlisted, 'the region and its one row').toHaveLength(2);
          for (const u of unlisted) {
            expect(u.inList, `${u.text}: inside the fleet list`).toBe(true);
            expect(u.overflow, `${u.text}: nothing overflows it`).toBeLessThanOrEqual(1);
          }
          // F1 (review 1424): a long name never hides the condition word or the `from` part, in the region.
          const words = await page.evaluate(measureParts, { words: CONDITION_WORDS, floorCh: NAME_FLOOR_CH, gapFloor: GAP_FLOOR_PX });
          expect(words.filter((w) => w.hasCondition).length, 'the region\'s row has a condition word').toBe(1);
          expectWords(words);
          if (width === 390) {
            // Review 1431 F3: the long name is cut, in a box that clips, with an ellipsis; and the region row's `from` part
            // starts a line of its own, so the middot rule is measured on a real wrapped line.
            const row = words.find((w) => w.text.includes('reconcile every reader'));
            expect(row?.name, 'reconcile every reader: has a name part').not.toBeNull();
            expect(row!.name!.cut, 'its name is cut').toBe(true);
            expect(row!.name!.clips, 'its text\'s box clips').toBe(true);
            expect(row!.name!.ellipsis, 'with an ellipsis').toBe(true);
            expect(row!.lineStarts, 'the region row wraps').toBeGreaterThan(0);
          }
          expect(errors, 'page errors').toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }
});

// ---- the session header at a phone's width (review 1424 F2, F3) ------------------------------------------------------
// A session whose facts fill Refined's one-row chip rail (a long model and branch, a PR, a question to its coordinator,
// subagents), with three recorded entries, one of them a long name. With the details door and the entry list open, each
// entry row shows its condition word whole (F2: the list never collapses inside the rail), and each of the header's two
// toggles, the subagent one and the delegated one, has a hit area of at least --tap-min (F3).
const HEAD_ID = 'project-c-head-pass';
const HEAD_SESSIONS = [session(HEAD_ID, 'project-c', {
  model: 'claude-opus-5-5-with-a-very-long-model-identifier-20261027', effort: 'high',
  branch: 'ws/head-pass-a-long-branch-name-that-no-rail-holds-in-one-piece',
  subagents: [{ name: 'explore', startedAt: NOW - 120_000 }, { name: 'verify', startedAt: NOW - 60_000 }],
  withCoordinator: { kind: 'question', parentId: 'project-c-coordinator-with-a-long-name-id', since: NOW, notifyAt: NOW + 600_000 },
  pr: { phase: 'open', number: 123, url: null, title: null, checks: 'pass', checkNames: null, ahead: 1, reason: null,
    checkedAt: null, mergedAt: null, retryAt: null },
})];
const HEAD_FIXTURE: AppFixture = {
  api: FIXTURE.api,
  fleetFrames: [
    { type: 'fleet', sessions: HEAD_SESSIONS },
    { type: 'delegation', delegation: frame({ activities: [
      activity({ activityId: 'h1', parentId: HEAD_ID, placement: 'chip',
        displayName: 'reconcile every reader of the projection frame across the server, the agent and the PWA trees' }),
      activity({ activityId: 'h2', parentId: HEAD_ID, displayName: 'read the plan', liveness: 'stale',
        openedAt: '2026-10-26T10:01:00.000Z' }),
      activity({ activityId: 'h3', parentId: HEAD_ID, displayName: null, liveness: 'unmeasured',
        openedAt: '2026-10-26T10:02:00.000Z' }),
    ] }) },
  ],
};

describe.each(SKINS)('the session header\'s entry list and toggles at 390 in %s', (skin) => {
  for (const theme of THEMES) {
    it(`${theme}: every entry shows its condition word, and each toggle's hit area is at least --tap-min`, async () => {
      const { ctx, page, errors } = await openApp(browser!, { skin, theme, width: 390 }, HEAD_FIXTURE);
      try {
        await page.goto(`${server!.origin}/s/${HEAD_ID}`);
        await page.waitForSelector('.chat-head', { timeout: 20_000 });
        const door = page.getByRole('button', { name: 'Session details' });
        if (await door.count() > 0 && await door.getAttribute('aria-expanded') === 'false') await door.click();
        const toggle = page.locator('.chat-head .sess-subagents', { hasText: '3 delegated' });
        await toggle.waitFor({ timeout: 20_000 });
        await toggle.click();
        await page.waitForSelector('.chat-head .sess-entries .proj-work >> nth=2', { state: 'attached', timeout: 20_000 });
        await page.evaluate(async () => { await document.fonts.ready; });
        await page.waitForTimeout(300);
        const shots = process.env['CCRC_SHOTS'];
        if (shots !== undefined && shots !== '') {
          await page.screenshot({ path: `${shots}/delegation-head-${skin}-${theme}-390.png`, fullPage: true });
        }
        const sideScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(sideScroll, 'sideways scroll').toBe(0);
        // F2: every header entry row is wide enough to show its condition word whole, and the word is on the screen:
        // inside what the header shows (Refined's rail scrolls sideways; its visible box is the rail's own).
        const shown = await page.evaluate((words) => {
          const clipOf = (el: Element): DOMRect => (el.closest('.ref-chip-rail') ?? el.closest('.chat-head')!).getBoundingClientRect();
          const visible = (r: DOMRect, c: DOMRect): boolean => r.width > 0 && r.left >= c.left - 0.5 && r.right <= c.right + 0.5;
          const rows = [...document.querySelectorAll<HTMLElement>('.chat-head .sess-entries .proj-work-parts')].map((box) => {
            const b = box.getBoundingClientRect();
            const cond = [...box.querySelectorAll<HTMLElement>('.proj-work-part')].find((p) => words.includes(p.textContent ?? ''));
            const r = cond?.getBoundingClientRect();
            return { text: box.textContent ?? '', width: b.width,
              whole: r !== undefined && r.width > 0 && r.left >= b.left - 0.5 && r.right <= b.right + 0.5,
              onScreen: r !== undefined && visible(r, clipOf(box)) };
          });
          // The toggle that opened it stays on the screen beside the list, so the same tap closes it.
          const t = [...document.querySelectorAll<HTMLElement>('.chat-head .sess-subagents')].find((e) => /delegated$/.test(e.textContent ?? ''));
          // The list's description wraps inside the list, never running on past it as one line.
          const list = document.querySelector<HTMLElement>('.chat-head .sess-entries')!;
          const note = list.querySelector<HTMLElement>('.sess-entries-note')!;
          return { rows, toggleOnScreen: t !== undefined && visible(t.getBoundingClientRect(), clipOf(t)),
            noteInList: visible(note.getBoundingClientRect(), list.getBoundingClientRect()) && visible(note.getBoundingClientRect(), clipOf(list)) };
        }, CONDITION_WORDS);
        expect(shown.rows, 'three entry rows').toHaveLength(3);
        for (const r of shown.rows) {
          expect(r.width, `${r.text}: the row has a width`).toBeGreaterThan(0);
          expect(r.whole, `${r.text}: its condition word is whole`).toBe(true);
          expect(r.onScreen, `${r.text}: its condition word is on the screen`).toBe(true);
        }
        expect(shown.toggleOnScreen, 'the delegated toggle is on the screen with the list open').toBe(true);
        expect(shown.noteInList, 'the list\'s description wraps inside it, on the screen').toBe(true);
        // F3: both header toggles on a touch screen, measured as boxes and by what a tap at their centre reaches. Both
        // texts are wider than the floor, so the width floor is read as the computed minimum, which only the rule sets.
        const targets = await page.evaluate(() => {
          const floor = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min'));
          return { floor, coarse: matchMedia('(pointer: coarse)').matches,
            toggles: [...document.querySelectorAll<HTMLElement>('.chat-head .chat-facts .sess-subagents')].map((t) => {
              const r = t.getBoundingClientRect();
              const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
              return { text: t.textContent ?? '', height: r.height, minWidth: parseFloat(getComputedStyle(t).minWidth) || 0,
                reached: hit !== null && t.contains(hit) };
            }) };
        });
        expect(targets.floor, 'the token resolves').toBe(44);
        expect(targets.coarse, 'the harness gives 390 a touch screen').toBe(true);
        expect(targets.toggles.map((t) => t.text), 'the subagent toggle and the delegated toggle').toHaveLength(2);
        for (const t of targets.toggles) {
          expect(t.height, `${t.text}: height`).toBeGreaterThanOrEqual(targets.floor);
          expect(t.minWidth, `${t.text}: width floor`).toBe(targets.floor);
          expect(t.reached, `${t.text}: a tap at its centre reaches it`).toBe(true);
        }
        // Review 1435 G3: the header's entry rows hold what the card's rows hold (measured last: it scrolls each row into
        // view). Review 1431 F3: the long-name entry is cut, in a box that clips, with an ellipsis.
        const headWords = await page.evaluate(measureParts, { words: CONDITION_WORDS, floorCh: NAME_FLOOR_CH, gapFloor: GAP_FLOOR_PX });
        expect(headWords, 'three entry rows').toHaveLength(3);
        expectWords(headWords);
        const headName = headWords.find((w) => w.text.includes('reconcile every reader'))?.name;
        expect(headName, 'the long entry has a name part').toBeDefined();
        expect(headName && { cut: headName.cut, clips: headName.clips, ellipsis: headName.ellipsis }, 'the long entry is cut')
          .toEqual({ cut: true, clips: true, ellipsis: true });
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});

// Review 1431 F1: on a desk with a mouse the header's toggles keep their base size and the header its base height (the
// operator's ruling of 2026-10-15). The base is measured on the page itself: the same header with every minimum the
// toggles could take removed, so the check needs no figure from another box.
describe.each(SKINS)('the session header\'s toggles at 1280 with a mouse in %s', (skin) => {
  it('keep their base size, and the header its base height', async () => {
    const { ctx, page, errors } = await openApp(browser!, { skin, theme: PHOSPHOR, width: 1280 }, HEAD_FIXTURE);
    try {
      await page.goto(`${server!.origin}/s/${HEAD_ID}`);
      await page.locator('.chat-head .sess-subagents', { hasText: '3 delegated' }).waitFor({ timeout: 20_000 });
      await page.evaluate(async () => { await document.fonts.ready; });
      await page.waitForTimeout(300);
      const measure = (): Promise<{ fine: boolean; head: number; toggles: number[] }> => page.evaluate(() => ({
        fine: matchMedia('(pointer: fine)').matches,
        head: document.querySelector<HTMLElement>('.chat-head')!.getBoundingClientRect().height,
        toggles: [...document.querySelectorAll<HTMLElement>('.chat-head .chat-facts .sess-subagents')].map((t) => t.getBoundingClientRect().height),
      }));
      const now = await measure();
      await page.addStyleTag({ content: '.chat-head .chat-facts .sess-subagents { min-height: 0 !important; min-width: 0 !important; }' });
      await page.waitForTimeout(100);
      const base = await measure();
      expect(now.fine, 'a mouse: a fine pointer').toBe(true);
      expect(now.toggles, 'the subagent toggle and the delegated toggle').toHaveLength(2);
      expect(now.toggles, 'each toggle at its base height').toEqual(base.toggles);
      for (const h of now.toggles) expect(h, 'under the tap floor').toBeLessThan(44);
      expect(now.head, 'the header at its base height').toBe(base.head);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);
});

// Review 1431 F: the list is brought into view by the tap that opens it, never by a remount. With the list open, the
// frame is withdrawn (the list unmounts, its disclosure stays open), the operator swipes the rail to its end, and the
// frame comes back: the list mounts again, and the rail stays where the operator left it.
describe('the session header\'s entry list in refined at 390 is brought into view by the tap only', () => {
  it('a remount while open scrolls nothing', async () => {
    const opened = await openApp(browser!, { skin: REFINED, theme: PHOSPHOR, width: 390 }, HEAD_FIXTURE);
    const { ctx, page, errors } = opened;
    try {
      await page.goto(`${server!.origin}/s/${HEAD_ID}`);
      await page.waitForSelector('.chat-head', { timeout: 20_000 });
      const door = page.getByRole('button', { name: 'Session details' });
      if (await door.count() > 0 && await door.getAttribute('aria-expanded') === 'false') await door.click();
      await page.locator('.chat-head .sess-subagents', { hasText: '3 delegated' }).click();
      await page.waitForSelector('.chat-head .sess-entries', { state: 'attached', timeout: 20_000 });
      const rail = (): Promise<{ left: number; max: number; list: boolean }> => page.evaluate(() => {
        const r = document.querySelector<HTMLElement>('.chat-head .ref-chip-rail')!;
        return { left: r.scrollLeft, max: r.scrollWidth - r.clientWidth, list: document.querySelector('.chat-head .sess-entries') !== null };
      });
      expect((await rail()).left, 'the tap brought the list to the rail\'s start').toBeLessThanOrEqual(1);
      opened.send('/ws/fleet', { type: 'delegation', delegation: null });
      await page.waitForFunction(() => document.querySelector('.chat-head .sess-entries') === null, null, { timeout: 20_000 });
      await page.evaluate(() => { const r = document.querySelector<HTMLElement>('.chat-head .ref-chip-rail')!; r.scrollLeft = r.scrollWidth; });
      opened.send('/ws/fleet', HEAD_FIXTURE.fleetFrames[1]);
      await page.waitForSelector('.chat-head .sess-entries', { state: 'attached', timeout: 20_000 });
      await page.waitForTimeout(200);
      const after = await rail();
      expect(after.list, 'the list is back, still open').toBe(true);
      expect(after.max, 'the rail still has room to scroll').toBeGreaterThan(1);
      expect(after.left, 'the rail stays where the operator left it').toBeGreaterThan(1);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);
});
