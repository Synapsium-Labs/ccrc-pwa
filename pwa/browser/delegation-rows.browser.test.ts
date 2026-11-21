// The delegation broker's entries, measured in a real Chrome over the production build, in both skins and both palettes. The
// jsdom suites (test/fleet-screen.test.tsx, test/fleet-rollup-render.test.tsx, test/project-card.test.tsx,
// test/session-worktrees.test.tsx) pin the markup; this file holds what they cannot. Desktop polish C48 (D-8782): the fleet
// list draws NO delegation row (not a session's agent or workflow, not a worktree, not an unowned tree, not the foot's region
// of entries whose session is listed nowhere, and no group of them), so on the list what is measured is that none is drawn and
// the card still fits at each width. Their home is the session's own page: its header's entry list (the entries it started)
// and its worktree section (the worktrees it started or holds, with the row's three controls), which this file measures at
// a phone's width and at a desk: every control inside its row and reached by a tap at its centre, the floor at a phone's
// width, clear of the floating button, the focus ring not clipped, and the focus around the controls' real sheet.
//
// The list's fixture is one card, project-a: a programme (`port-api`: its coordinator and one worker) and a session in no
// programme. The frame carries entries of all three listed sessions, worktrees, an offline one, an unowned tree and an
// activity whose session is in no fleet list, none of which may be drawn on the list. Instrument is put in its project mode
// (`GROUP_MODE_KEY`), where it draws the same project cards as Refined.
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
import { PANEL_BANNED, SECTION_4_4_WORDS } from '../test/panelCensus';

/** The broker's condition words: since H3 (D-8875) no row of the fleet list or the session panel says one (spec 2026-11-19
 *  §4.4), so they are the words the census below must not find. §4.4's five, written out on their own (`panelCensus.ts`,
 *  HF2), and the table's words, whatever it says; the census below also bans the table's sentences (`PANEL_BANNED`). */
const CONDITION_WORDS = [...new Set([...SECTION_4_4_WORDS, ...Object.values(LIVENESS_QUALIFIER).map((q) => q.word)])];

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
  // Its task tally keeps its details row when its last worktree leaves (the focus cases below): since H3 (D-8875) its recorded
  // entry no longer does.
  session('lone-tidy-pass', 'project-a', { tasks: { done: 1, total: 3, running: 0, active: null } }),
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
    lease({ leaseId: 'l-lone-b', parentId: 'lone-tidy-pass', adminRecord: 'agent-l2', canonicalPath: '/w/project-a/.claude/worktrees/agent-l2',
      disposition: 'ephemeral', expiresAt: null, firstObservedAt: '2026-10-26T10:30:00.000Z' }),
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
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(400); // the first paint's transitions settle
  return opened;
}

/** Each delegation row's words (in the session header's entry list and in its worktree section): whether its condition
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
const expectWords = (words: readonly PartsFit[], width: number): void => {
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
  // A positive control, per width. At a desk some separator is measured mid-line: the path shares its row's line there (HF2
  // fix round 1, review 3184 F2: this is what catches a path put on a line of its own at every width). Below the desk a path
  // takes a line of its own since HF2 (D-8877; review 3123 F3), so a two-part row there has no mid-line separator at all: its
  // one separator starts the path's line, and the control counts it there (where the check above asks it is not drawn).
  if (touch(width)) expect(words.reduce((n, w) => n + w.midLine + w.lineStarts, 0), 'some separator is measured').toBeGreaterThan(0);
  else expect(words.reduce((n, w) => n + w.midLine, 0), 'some separator is measured mid-line').toBeGreaterThan(0);
};

describe.each(SKINS)('the fleet list draws no delegation row on a card in %s (D-8782)', (skin) => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      it(`at ${width} (${theme}): no sideways scroll, no page error, no delegation row, group or foot region on the list`, async () => {
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
          // Review 2864 F1: the activity whose session no list carries has no foot region either: nothing of the delegation frame
          // is drawn anywhere in the fleet list.
          expect(await page.locator('.fleet-unlisted, .fleet-list .proj-work').count(), 'no foot region and no delegation row in the list').toBe(0);
          const listText = await page.evaluate(() => document.querySelector('.fleet-list')?.textContent ?? '');
          for (const gone of ['reconcile every reader', 'session not listed', 'gone-session']) {
            expect(listText, `${gone}: not in the fleet list`).not.toContain(gone);
          }
          expect(errors, 'page errors').toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }
});

// ---- the session's worktree section (D-8782, review 2864 F4, F6) -----------------------------------------------------------
// The worktrees moved from the fleet list's rows into the session's own page. The lone session `lone-tidy-pass` holds two: a
// raw one (Keep worktree, Attach to…, Not delegated; a long path, a works-on chip and the inferred chips) and an ordinary one
// (Keep worktree, Not delegated). Each control sits inside its row and the section, is reached by a tap at its centre, and
// reaches the tap floor on a touch screen; at the end of the page every button is clear of the floating button and reached;
// the focus ring is not clipped; and the section lies wholly inside the page at 360 px, the narrowest phone.
const SESSION_ID = 'lone-tidy-pass';
const SECTION_WIDTHS = [360, 390, 1280, 1920] as const;
const touch = (width: number): boolean => width < 900;

async function openSession(skin: string, theme: string, width: number) {
  const opened = await openApp(browser!, { skin, theme, width }, FIXTURE);
  await opened.page.goto(`${server!.origin}/s/${SESSION_ID}`);
  await opened.page.waitForSelector('.chat-head', { timeout: 20_000 });
  const door = opened.page.getByRole('button', { name: 'Session details' });
  if (await door.count() > 0 && await door.getAttribute('aria-expanded') === 'false') await door.click();
  await opened.page.waitForSelector('.sess-worktrees .proj-work', { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(400);
  return opened;
}

/** The section's rows and chips: inside the section and the page, nothing overflowing the row. */
const measureSection = (): { sideScroll: number; section: { left: number; right: number; viewport: number };
  rows: { text: string; inSection: boolean; overflow: number; chips: { text: string; inRow: boolean; width: number }[] }[] } => {
  const sec = document.querySelector<HTMLElement>('.sess-worktrees')!;
  const sr = sec.getBoundingClientRect();
  const within = (a: DOMRect, b: DOMRect): boolean => a.left >= b.left - 0.5 && a.right <= b.right + 0.5;
  return {
    sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    section: { left: sr.left, right: sr.right, viewport: document.documentElement.clientWidth },
    rows: [...sec.querySelectorAll<HTMLElement>('.proj-work')].map((row) => {
      const r = row.getBoundingClientRect();
      return { text: row.textContent ?? '', inSection: within(r, sr), overflow: row.scrollWidth - row.clientWidth,
        chips: [...row.querySelectorAll<HTMLElement>('.proj-work-chip, .sess-workson')].map((c) => {
          const cr = c.getBoundingClientRect();
          return { text: c.textContent ?? '', inRow: within(cr, r), width: cr.width };
        }) };
    }),
  };
};

/** Every control of the section: its name, whether it sits inside its row and the section on all four sides, its height, and
 *  whether a tap at its centre, with it scrolled to the middle of the screen, reaches it. And the tap floor the token resolves to. */
const measureSectionControls = (): { floor: number; controls: { text: string; name: string; inRow: boolean; inSection: boolean;
  height: number; reached: boolean }[] } => {
  const probe = document.createElement('div');
  probe.style.height = 'var(--tap-min)';
  document.body.append(probe);
  const floor = probe.getBoundingClientRect().height;
  probe.remove();
  const within = (a: DOMRect, b: DOMRect): boolean =>
    a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
  return {
    floor,
    controls: [...document.querySelectorAll<HTMLElement>('.sess-worktrees .proj-work-controls button')].map((b) => {
      b.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { text: b.textContent ?? '', name: b.getAttribute('aria-label') ?? '',
        inRow: within(r, b.closest('.proj-work')!.getBoundingClientRect()),
        inSection: within(r, b.closest('.sess-worktrees')!.getBoundingClientRect()), height: r.height,
        reached: hit !== null && b.contains(hit) };
    }),
  };
};

/** With every scroller at its end, each button of the section drawn whole: a tap at its centre reaches it and its box meets no
 *  floating button (Refined's `+ New`, Instrument's round `+`). The fleet screen mounts the floating button at a phone's width
 *  only; on the session page it may be absent (`fabs` 0), and then the overlap half is empty by design. */
const measureSectionResting = (): { fabs: number; buttons: { name: string; reached: boolean; underFab: string | null }[] } => {
  window.scrollTo(0, document.documentElement.scrollHeight);
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    const y = getComputedStyle(el).overflowY;
    if ((y === 'auto' || y === 'scroll') && el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight;
  }
  const fabs = [...document.querySelectorAll<HTMLElement>('.ref-fab, .fab')].map((f) => f.getBoundingClientRect())
    .filter((f) => f.width > 0 && f.height > 0);
  return {
    fabs: fabs.length,
    buttons: [...document.querySelectorAll<HTMLElement>('.sess-worktrees button')].map((b) => {
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const fab = fabs.find((f) => r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top);
      return { name: b.getAttribute('aria-label') ?? (b.textContent ?? '').trim(),
        reached: hit !== null && b.contains(hit), underFab: fab === undefined ? null : `${Math.round(r.bottom)} > ${Math.round(fab.top)}` };
    }),
  };
};

describe.each(SKINS)('the session\'s worktree section in %s (D-8782)', (skin) => {
  for (const theme of THEMES) {
    for (const width of SECTION_WIDTHS) {
      it(`at ${width} (${theme}): the section and its controls fit, are reached, and keep their ring`, async () => {
        const { ctx, page, errors } = await openSession(skin, theme, width);
        try {
          const shots = process.env['CCRC_SHOTS'];
          if (shots !== undefined && shots !== '') {
            await page.screenshot({ path: `${shots}/worktrees-${skin}-${theme}-${width}.png`, fullPage: true });
          }
          const fit = await page.evaluate(measureSection);
          expect(fit.sideScroll, 'sideways scroll').toBe(0);
          expect(fit.section.left, 'the section starts on the screen').toBeGreaterThanOrEqual(-0.5);
          expect(fit.section.right, 'the section ends on the screen').toBeLessThanOrEqual(fit.section.viewport + 0.5);
          expect(fit.rows, 'the lone session holds two worktrees').toHaveLength(2);
          for (const row of fit.rows) {
            expect(row.inSection, `${row.text}: inside the section`).toBe(true);
            expect(row.overflow, `${row.text}: nothing overflows the row`).toBeLessThanOrEqual(1);
            for (const c of row.chips) {
              expect(c.inRow, `${c.text}: inside its row`).toBe(true);
              expect(c.width, `${c.text}: drawn`).toBeGreaterThan(0);
            }
          }
          const chips = fit.rows.flatMap((r) => r.chips.map((c) => c.text));
          expect(chips.filter((t) => t === 'inferred'), 'the raw worktree wears inferred').toHaveLength(1);
          expect(chips.some((t) => t.includes('project-b')), 'the works-on chip').toBe(true);
          // The words hold what the list's rows held: the last part whole, the name (the path, H3) at its floor. Since H3
          // (D-8875) no worktree row says a condition word.
          const words = await page.evaluate(measureParts, { words: CONDITION_WORDS, floorCh: NAME_FLOOR_CH, gapFloor: GAP_FLOOR_PX });
          expect(words.filter((w) => w.hasCondition).length, 'no worktree row has a condition word').toBe(0);
          expectWords(words, width);
          const shown = await page.evaluate(measureSectionControls);
          expect(shown.controls.map((c) => c.text).sort(), 'the worktree controls').toEqual(
            ['Attach to…', 'Keep worktree', 'Keep worktree', 'Not delegated', 'Not delegated']);
          expect(new Set(shown.controls.map((c) => c.name)).size, 'each control\'s name is its own').toBe(5);
          for (const c of shown.controls) {
            expect(c.name.startsWith(c.text), `${c.name}: its name carries its label`).toBe(true);
            expect(c.inRow, `${c.name}: inside its row`).toBe(true);
            expect(c.inSection, `${c.name}: inside the section`).toBe(true);
            expect(c.reached, `${c.name}: a tap at its centre reaches it`).toBe(true);
            if (touch(width)) expect(c.height, `${c.name}: reaches the tap floor`).toBeGreaterThanOrEqual(shown.floor - 0.5);
          }
          const resting = await page.evaluate(measureSectionResting);
          expect(resting.buttons, 'the buttons are measured at the page\'s end').toHaveLength(5);
          for (const c of resting.buttons) {
            expect(c.underFab, `${c.name}: clear of the floating button at the end of the page`).toBeNull();
            expect(c.reached, `${c.name}: a tap at its centre reaches it at the end of the page`).toBe(true);
          }
          // Task C38 (D-8670): the box a script focuses after a keyboard action draws the page's ring, and no ancestor up to the
          // page's header clips it (the ring reaches 4px outside the box: a 2px outline, 2px offset).
          await page.keyboard.press('Shift');
          const ring = await page.evaluate(() => {
            const box = document.querySelector<HTMLElement>('.sess-worktrees .proj-work-controls')!;
            box.focus();
            const style = getComputedStyle(box);
            const reach = (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0);
            const r = box.getBoundingClientRect();
            const clippedBy: string[] = [];
            for (let el = box.parentElement; el !== null && el !== document.body; el = el.parentElement) {
              const cs = getComputedStyle(el);
              if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
              const c = el.getBoundingClientRect();
              if (r.left - reach < c.left - 0.5 || r.right + reach > c.right + 0.5 || r.top - reach < c.top - 0.5 || r.bottom + reach > c.bottom + 0.5) {
                clippedBy.push(el.className);
              }
            }
            return { visible: box.matches(':focus-visible'), outline: style.outlineStyle, drawn: reach > 0, clippedBy };
          });
          expect(ring, 'the script-focused box after a keyboard action: focus-visible, with its ring drawn whole')
            .toEqual({ visible: true, outline: 'solid', drawn: true, clippedBy: [] });
          expect(errors, 'page errors').toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }
});

// ---- where the focus goes around a worktree control's real sheet (review 1624 F3; review 2864 F4) -------------------------
// jsdom unmounts a closed sheet at once, so the jsdom suite cannot see what the real one does: its panel stays mounted through
// a 180-320 ms exit, holding the focus, and it gives the focus back to its opener as it closes. Both arms (the bottom sheet at
// 390, the centred dialog at 1280 and 1920), in both skins and both palettes, on the lone session's raw worktree, which offers
// all three controls: Cancel gives the focus back to the control that opened the confirm; Keep leaves it on the row's box; a
// confirmed act that is refused leaves it on the box with the sentence said; and an ask the row stops offering while it is open
// (the row moves to `promoted`, so Attach, its opener, goes) places it on the box in the commit that closes the ask. A row that
// leaves while its confirm is open hands the focus to the section's heading (another row stays), or, when it was the last, to
// the details region, also after a `Tab` has moved the focus inside the confirm, which arms the confirm's focus trap: the
// hand-off waits until the trap has gone (review 1626 F2, review 1628 F1).
const FOCUS_ROW = 'agent-l1';
/** What holds the focus, named the way the section would name it. */
const sectionFocusAt = (): string => {
  const a = document.activeElement;
  if (a === null || a === document.body) return 'body';
  if (a.closest('[role="dialog"]') !== null) return `dialog: ${(a.textContent ?? '').trim() || a.getAttribute('aria-label') || a.tagName}`;
  if (a.classList.contains('proj-work-controls')) return `box: ${a.getAttribute('aria-label') ?? ''}`;
  if (a.matches('.sess-worktrees > .sess-entries-note')) return 'section heading';
  // The details region, or in Refined (where it is `display: contents`) the rail that holds it.
  if (a.classList.contains('chat-facts') || a.classList.contains('ref-chip-rail')) return 'details region';
  // The header's title, which takes the focus when the details row itself goes with the last worktree (desktop polish C51, review 2963 F3).
  if (a.matches('.chat-head .chat-title')) return 'header title';
  return a.getAttribute('aria-label') ?? a.className;
};
const keptAnswer = (): string => JSON.stringify({ ok: true, lease: 'l-lone', generation: 2, disposition: 'retained',
  expiresAt: new Date(NOW + 7 * 86_400_000).toISOString(), carrier: 'pending' });

/** The next frame with the lone session's raw worktree changed by `over`, or gone when `over` is null; `alone` drops its sibling too. */
const withLone = (over: object | null, alone = false): object => ({ type: 'delegation', delegation: { ...DELEGATION,
  leases: DELEGATION.leases.flatMap((l) => (l.leaseId === 'l-lone-b' && alone ? [] : l.leaseId !== 'l-lone' ? [l]
    : over === null ? [] : [{ ...l, ...over }])) } });

describe.each(SKINS)('the focus around a worktree control\'s real sheet in %s (review 1624 F3)', (skin) => {
  for (const theme of THEMES) for (const width of [390, 1280, 1920] as const) {
    it(`at ${width} (${theme}): Cancel, Keep, a refusal and a dropped ask each leave the focus where the section says`, async () => {
      const { ctx, page, errors, send } = await openSession(skin, theme, width);
      try {
        const control = (name: string) => page.getByRole('button', { name: `${name} (${FOCUS_ROW})`, exact: true });
        const settled = async (): Promise<void> => {
          await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5_000 });
          await page.waitForTimeout(150);
        };
        await control('Not delegated').scrollIntoViewIfNeeded();
        await control('Not delegated').click();
        await page.waitForSelector('[role="dialog"]');
        expect(await page.evaluate(sectionFocusAt), 'a danger confirm opens on Cancel').toBe('dialog: Cancel');
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
        await settled();
        expect(await page.evaluate(sectionFocusAt), 'after Cancel').toBe(`Not delegated (${FOCUS_ROW})`);
        await page.route('**/api/leases/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: keptAnswer() }));
        await control('Keep worktree').click();
        await page.getByText(/^Worktree kept until/).first().waitFor();
        expect(await page.evaluate(sectionFocusAt), 'after Keep').toBe(`box: Worktree ${FOCUS_ROW}`);
        await page.unroute('**/api/leases/**');
        await page.route('**/api/leases/**', (route) => route.fulfill({ status: 409, contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'carrier-behind', detail: '' }) }));
        await control('Attach to…').click();
        await page.waitForSelector('[role="dialog"]');
        await page.getByRole('dialog').getByRole('button', { name: 'Attach to lone-tidy-pass', exact: true }).click();
        await page.locator('.sess-worktrees [role="alert"]', { hasText: 'has not caught up' }).first().waitFor();
        await settled();
        expect(await page.evaluate(sectionFocusAt), 'after a refusal').toBe(`box: Worktree ${FOCUS_ROW}`);
        await page.unroute('**/api/leases/**');
        await control('Attach to…').click();
        await page.waitForSelector('[role="dialog"]');
        send('/ws/fleet', withLone({ disposition: 'promoted' }));
        await control('Attach to…').waitFor({ state: 'detached' });
        await settled();
        expect(await page.evaluate(sectionFocusAt), 'after a dropped ask').toBe(`box: Worktree ${FOCUS_ROW}`);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);

    it(`at ${width} (${theme}): a row that leaves while its confirm is open hands the focus to the section's heading, or the details region (review 1626 F2)`, async () => {
      const { ctx, page, errors, send } = await openSession(skin, theme, width);
      try {
        const attach = page.getByRole('button', { name: `Attach to… (${FOCUS_ROW})`, exact: true });
        for (const [variant, next, key, lands] of [
          ['its record dropped', withLone(null), null, 'section heading'],
          ['its state one this build cannot read', withLone({ disposition: 'future-word' }), null, 'section heading'],
          ['its record dropped, after a Tab inside the confirm', withLone(null), 'Tab', 'section heading'],
          ['its state one this build cannot read, after a Tab inside the confirm', withLone({ disposition: 'future-word' }), 'Tab', 'section heading'],
          ['the last row dropped', withLone(null, true), null, 'details region'],
          ['the last row dropped, after a Tab inside the confirm', withLone(null, true), 'Tab', 'details region'],
        ] as const) {
          send('/ws/fleet', withLone({}));
          await attach.scrollIntoViewIfNeeded();
          await attach.click();
          await page.waitForSelector('[role="dialog"]');
          if (key !== null) {
            await page.keyboard.press(key);
            expect(await page.evaluate(sectionFocusAt), `${variant}: the focus moved inside the confirm`).toMatch(/^dialog: /);
          }
          send('/ws/fleet', next);
          await attach.waitFor({ state: 'detached' });
          await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5_000 });
          await page.waitForTimeout(300);
          expect(await page.evaluate(sectionFocusAt), variant).toBe(lands);
        }
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);

    // Desktop polish C51, review 2963 F3 (the reviewer's probe): a session whose details are worktrees ALONE, with no recorded
    // entry, PR, hold or other fact. When its last worktree leaves, the details row goes with it (`detailsHaveFacts`), so the
    // region that held the focus is gone: the header's title takes it, never `body`. Before the code decided the row, a
    // stylesheet hid it and the focus fell to `body` in Instrument.
    it(`at ${width} (${theme}): a session whose details are worktrees alone hands the focus to the header's title when its last worktree leaves`, async () => {
      const noEntry = { ...DELEGATION, activities: DELEGATION.activities.filter((a: { activityId: string }) => a.activityId !== 'a-lone') };
      const only = (leases: readonly { leaseId: string }[]): object => ({ type: 'delegation', delegation: { ...noEntry, leases } });
      const { ctx, page, errors, send } = await openSession(skin, theme, width);
      try {
        const attach = page.getByRole('button', { name: `Attach to… (${FOCUS_ROW})`, exact: true });
        // The lone session's row carries a context marker (`ctxPct: 40`) and a task tally, facts of its own: with either the row
        // would stay. Cleared, its details hold its worktrees alone.
        send('/ws/fleet', { type: 'fleet', sessions: SESSIONS.map((x) => ((x as { id: string }).id === SESSION_ID ? { ...x, ctxPct: null, tasks: null } : x)) });
        for (const key of [null, 'Tab'] as const) {
          send('/ws/fleet', only(DELEGATION.leases));
          await page.waitForTimeout(300);
          const door = page.getByRole('button', { name: 'Session details' });
          if (await door.count() > 0 && await door.getAttribute('aria-expanded') === 'false') await door.click();
          await attach.scrollIntoViewIfNeeded();
          await attach.click();
          await page.waitForSelector('[role="dialog"]');
          if (key !== null) await page.keyboard.press(key);
          send('/ws/fleet', only(DELEGATION.leases.filter((l: { parentId: string }) => l.parentId !== 'lone-tidy-pass')));
          await attach.waitFor({ state: 'detached' });
          await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5_000 });
          await page.waitForTimeout(300);
          expect(await page.evaluate(sectionFocusAt), `the last worktree dropped${key === null ? '' : ', after a Tab inside the confirm'}`).toBe('header title');
          expect(await page.locator('.chat-facts').count(), 'the details row went with it').toBe(0);
        }
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

// ---- the session header sheds its broker lists (session helpers H3, D-8875) --------------------------------------------
// A session whose facts fill Refined's one-row chip rail (a long model and branch, a PR, a question to its coordinator,
// subagents), with three recorded entries, one of them a long name, and two worktrees, one whose presence on disk was not
// measured. Before H3 the header drew a subagent toggle and an `N delegated` toggle opening the entries with their condition
// words (review 1424 F2, F3; review 1431 F1 and F). Now, at a phone and a desk, in both skins and themes: no toggle, no entry
// row, no subagent's or entry's name, no condition word or sentence and no bare `unmeasured` anywhere in the header, its
// titles or its accessible names; each worktree row draws its path on the screen; the presence line is said once in the
// section's head; and nothing scrolls the page sideways.
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
    ], leases: [
      lease({ leaseId: 'h-l1', parentId: HEAD_ID, project: 'project-c', adminRecord: 'agent-h1', liveness: 'live',
        canonicalPath: '/w/project-c/.claude/worktrees/agent-h1', disposition: 'retained', expiresAt: null }),
      lease({ leaseId: 'h-l2', parentId: HEAD_ID, project: 'project-c', adminRecord: 'agent-h2', liveness: 'stale', workspace: 'unmeasured',
        canonicalPath: '/w/project-c/.claude/worktrees/agent-h2', disposition: 'ephemeral', expiresAt: null }),
    ] }) },
  ],
};

describe.each(SKINS)('the session header sheds its broker lists in %s (H3)', (skin) => {
  for (const [theme, width] of [[PHOSPHOR, 360], ['light', 360], [PHOSPHOR, 390], ['light', 390], [PHOSPHOR, 1280], ['light', 1280]] as const) {
    it(`${theme} at ${width}: no toggle, entry, condition word or unmeasured; each worktree's path on the screen`, async () => {
      const { ctx, page, errors } = await openApp(browser!, { skin, theme, width }, HEAD_FIXTURE);
      try {
        await page.goto(`${server!.origin}/s/${HEAD_ID}`);
        await page.waitForSelector('.chat-head', { timeout: 20_000 });
        // HF2 fix round 1 (review 3184 F1): the door is opened the way a reader opens it, a tap on a phone, and nothing after
        // the tap puts the rail back: Refined's phone rail scrolls sideways and this fixture's branch chip is wider than it, so
        // reaching the door scrolls the rail, and the paths must start on the screen in that state.
        const door = page.getByRole('button', { name: 'Session details' });
        // Where the closed door sits: past the rail's right edge means reaching it scrolls the rail (the positive control below).
        const doorBeyond = await page.evaluate(() => {
          const d = document.querySelector<HTMLElement>('.chat-details-toggle');
          const rail = d?.closest<HTMLElement>('.ref-chip-rail') ?? null;
          return d !== null && rail !== null && d.getBoundingClientRect().right > rail.getBoundingClientRect().right + 0.5;
        });
        if (await door.count() > 0 && await door.getAttribute('aria-expanded') === 'false') await (width < 900 ? door.tap() : door.click());
        await page.waitForSelector('.chat-head .sess-worktrees .proj-work >> nth=1', { state: 'attached', timeout: 20_000 });
        await page.evaluate(async () => { await document.fonts.ready; });
        await page.waitForTimeout(300);
        const shots = process.env['CCRC_SHOTS'];
        if (shots !== undefined && shots !== '') {
          await page.screenshot({ path: `${shots}/delegation-head-${skin}-${theme}-${width}.png`, fullPage: true });
        }
        const sideScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(sideScroll, 'sideways scroll').toBe(0);
        const read = await page.evaluate(() => {
          const head = document.querySelector<HTMLElement>('.chat-head')!;
          const texts = [head.innerText];
          for (const el of head.querySelectorAll('*')) {
            for (const a of ['title', 'aria-label']) { const v = el.getAttribute(a); if (v !== null && v !== '') texts.push(v); }
          }
          const clipOf = (el: Element): DOMRect => (el.closest('.ref-chip-rail') ?? el.closest('.chat-head')!).getBoundingClientRect();
          const paths = [...head.querySelectorAll<HTMLElement>('.sess-worktrees .proj-work-name-text')].map((p) => {
            const r = p.getBoundingClientRect();
            const c = clipOf(p);
            return { text: p.textContent ?? '', onScreen: r.width > 0 && r.left >= c.left - 0.5 && r.left < c.right };
          });
          const section = head.querySelector<HTMLElement>('.sess-worktrees')!;
          const rail = head.querySelector<HTMLElement>('.ref-chip-rail');
          const doorEl = head.querySelector<HTMLElement>('.chat-details-toggle');
          const sr = section.getBoundingClientRect();
          const sc = clipOf(section);
          const dr = doorEl?.getBoundingClientRect() ?? null;
          const dc = doorEl === null ? null : clipOf(doorEl);
          return { texts, paths, toggles: head.querySelectorAll('.sess-subagents, .sess-entries, .sess-subagent-list').length,
            presence: (section.innerText.match(/presence on disk not measured for 1 tree/g) ?? []).length,
            railOverflow: rail === null ? 0 : rail.scrollWidth - rail.clientWidth,
            // The section's own start (its head and every row's left edge) inside the rail's window, not only the paths'.
            sectionIn: sr.left >= sc.left - 0.5 && sr.right <= sc.right + 0.5,
            // The door just tapped stays where the tap found it: inside the rail's window, and focused.
            doorIn: dr === null || dc === null ? null : dr.left >= dc.left - 0.5 && dr.right <= dc.right + 0.5,
            doorFocused: doorEl !== null && document.activeElement === doorEl };
        });
        expect(read.toggles, 'no toggle and no list').toBe(0);
        const all = read.texts.join(' \n ');
        expect(all, 'no count or toggle of subagents or entries').not.toMatch(/\bsubagents?\b|\d+ delegated|⑂/i);
        expect(all, 'no subagent or entry name').not.toMatch(/reconcile every reader|read the plan|\bexplore\b|\bverify\b/);
        expect(PANEL_BANNED.filter((w) => all.toLowerCase().includes(w.toLowerCase())),
          'no condition word, sentence or unmeasured').toEqual([]);
        expect(read.paths.map((p) => p.text), 'each worktree row says its path').toEqual([
          '/w/project-c/.claude/worktrees/agent-h1', '/w/project-c/.claude/worktrees/agent-h2']);
        for (const p of read.paths) expect(p.onScreen, `${p.text}: its path starts on the screen`).toBe(true);
        expect(read.sectionIn, 'the worktrees section lies inside the rail\'s window').toBe(true);
        expect(read.presence, 'the presence line, once, in the section\'s head').toBe(1);
        if (skin === REFINED && width < 900) {
          // A positive control: the closed door sat past the rail's edge, so the tap scrolled the rail to reach it (review 3184 F1).
          expect(doorBeyond, 'positive control: the closed door sat past the rail\'s edge').toBe(true);
          expect(read.railOverflow, 'the open rail is no wider than its window').toBeLessThanOrEqual(1);
          expect(read.doorIn, 'the door the tap opened lies in the rail\'s window').toBe(true);
          expect(read.doorFocused, 'the door keeps the focus the tap gave it').toBe(true);
          // Closed again by a tap, the rail is the sideways row it was: wider than its window, and a sideways wheel scrolls it.
          await door.tap();
          await page.waitForFunction(() => document.querySelector('.chat-head .sess-worktrees') === null, null, { timeout: 5_000 });
          const box = (await page.locator('.ref-chip-rail').boundingBox())!;
          const before = await page.evaluate(() => document.querySelector<HTMLElement>('.ref-chip-rail')!.scrollLeft);
          await page.mouse.move(box.x + box.width / 2, box.y + 12);
          await page.mouse.wheel(before > 0 ? -400 : 400, 0);
          await page.waitForFunction((b) => document.querySelector<HTMLElement>('.ref-chip-rail')!.scrollLeft !== b, before, { timeout: 5_000 });
          const closed = await page.evaluate(() => {
            const rail = document.querySelector<HTMLElement>('.ref-chip-rail')!;
            return { overflow: rail.scrollWidth - rail.clientWidth > 1, expanded: document.querySelector('.chat-details-toggle')?.getAttribute('aria-expanded') };
          });
          expect(closed, 'closed: a sideways row again, and the wheel scrolls it').toEqual({ overflow: true, expanded: 'false' });
        }
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});
