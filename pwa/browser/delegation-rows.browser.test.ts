// The delegation broker's rows on a project card (wave 4, PR2), measured in a real Chrome over the production build at
// 390, 1280 and 1920, in both skins and both palettes. The jsdom suites (test/project-card.test.tsx,
// test/fleet-rollup-render.test.tsx) pin the markup; this file holds what they cannot: that every row of delegated work,
// every worktree with its chips and every group member fits its card at each width, with no sideways scroll.
//
// The fixture is one card, project-a: a programme (`port-api`: its coordinator, which has delegated work, and one worker,
// whose live activity is a chip on its row and whose worktree sits under the coordinator `via` it) and a session in no
// programme, whose delegated work and raw worktree (a long name and a long path, a works-on chip, `inferred` and the
// creating Bash call) nest under it; both heads' folds are opened. Both groups are opened too: a worktree whose parent
// is gone and one unowned tree. One activity's session is in no fleet list, so the fleet foot's region draws it, with a long name and a long raw session id; the region is opened too.
// Instrument is put in its project mode (`GROUP_MODE_KEY`), where it draws the same project cards as Refined.
// Delegation broker wave 5, PR10: the frame is a newer server's, so the worktree rows carry their controls. The lone session's
// raw worktree offers all three (Keep worktree, Attach to…, Not delegated) on the longest row; the worker's worktree is kept,
// with its two words (`worktree kept`, `kept until <date>`) and two controls; the unowned tree's hidden lease offers Not
// delegated. The offline group's worktree is an older server's row and offers none. Every control must sit inside its row
// and card, and on a phone reach the tap floor.
//
//   CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/delegation-rows.browser.test.ts
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
  session('port-w1', 'project-a', { role: 'child' }),
  session('lone-tidy-pass', 'project-a'),
];

const LONG_PATH = '/w/project-a/.claude/worktrees/agent-a1b2c3d4e5f6-a-very-long-worktree-name-that-should-wrap-rather-than-push';
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
      canonicalPath: LONG_PATH, disposition: 'ephemeral', expiresAt: null }),
    lease({ leaseId: 'l-via', parentId: 'port-w1', adminRecord: 'agent-v1', canonicalPath: '/w/project-a/.claude/worktrees/agent-v1',
      disposition: 'adopted', expiresAt: new Date(NOW + 7 * 86_400_000).toISOString() }),
    lease({ leaseId: 'l-off', parentId: 'coord-gone', group: 'offline-coordinator', sourceKind: 'raw', adminRecord: 'agent-o1',
      canonicalPath: '/w/project-a/.claude/worktrees/agent-o1' }),
  ],
  unowned: [unowned({ adminRecord: 'agent-u1', canonicalPath: '/w/project-a/.claude/worktrees/agent-u1', verdict: 'conflicting',
    leaseId: '0b0c3f8e-5d55-4c1e-9a77-2f1d8c3e4a10' })],
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
    try { localStorage.setItem(key, 'project'); } catch { /* the default mode is then measured, and the rows are absent */ }
  }, [GROUP_MODE_KEY] as const);
  await opened.page.goto(server!.origin + '/');
  await opened.page.waitForSelector('.proj-group-toggle', { timeout: 20_000 });
  // Both groups start closed, and the two heads' children fold (two of them reach `CHILD_FOLD_MIN`): open each, as the
  // operator would, so every row is drawn.
  for (const name of ['Offline coordinator', 'Unowned work']) {
    await opened.page.locator('.proj-group-toggle', { hasText: name }).click();
  }
  await opened.page.locator('.fleet-unlisted .proj-group-toggle').click();
  const folded = opened.page.locator('.proj-children-toggle[aria-expanded="false"]');
  for (let n = await folded.count(); n > 0; n = await folded.count()) await folded.first().click();
  await opened.page.waitForSelector('.proj-work >> nth=5', { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(400); // the first paint's transitions settle
  return opened;
}

interface RowFit {
  readonly text: string;
  readonly inCard: boolean;
  readonly overflow: number;
  readonly cells: { readonly text: string; readonly inRow: boolean; readonly width: number }[];
}

/** Every delegation row on a card: whether it sits inside its card, how far its content overflows its own box, and
 *  whether each of its chips sits inside the row with a width of its own. */
const measureRows = (): RowFit[] => [...document.querySelectorAll<HTMLElement>('.proj-card .proj-work')].map((row) => {
  const card = row.closest('.proj-card')!.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const within = (a: DOMRect, b: DOMRect): boolean => a.left >= b.left - 0.5 && a.right <= b.right + 0.5;
  return {
    text: row.textContent ?? '',
    inCard: within(r, card),
    overflow: row.scrollWidth - row.clientWidth,
    cells: [...row.querySelectorAll<HTMLElement>('.proj-work-chip, .sess-workson')].map((c) => {
      const cr = c.getBoundingClientRect();
      return { text: c.textContent ?? '', inRow: within(cr, r), width: cr.width };
    }),
  };
});

/** PR10: every worktree control on a card: its label and accessible name, whether it sits inside its row and its card on
 *  all four sides (fix round 1, F9 (j)), its height, and whether a tap at its centre, with the control scrolled to the
 *  middle of the screen, reaches it rather than the floating button (F9 (i)); and the tap floor the token resolves to (a
 *  coarse pointer at 390, so the floor is measured where a thumb uses it). */
const measureControls = (): { floor: number; controls: { text: string; name: string; inRow: boolean; inCard: boolean;
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
    controls: [...document.querySelectorAll<HTMLElement>('.proj-card .proj-work-controls button')].map((b) => {
      b.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { text: b.textContent ?? '', name: b.getAttribute('aria-label') ?? '',
        inRow: within(r, b.closest('.proj-work')!.getBoundingClientRect()),
        inCard: within(r, b.closest('.proj-card')!.getBoundingClientRect()), height: r.height,
        reached: hit !== null && b.contains(hit) };
    }),
  };
};

/** PR10 fix round 2 (review 1623 F6): every scroller scrolled to its end (the page, and on the desk the fleet column, which
 *  scrolls on its own), so the page's last row of controls sits where it rests. */
const scrollToEnd = (): void => {
  window.scrollTo(0, document.documentElement.scrollHeight);
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    const y = getComputedStyle(el).overflowY;
    if ((y === 'auto' || y === 'scroll') && el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight;
  }
};
/** At that resting place, every button drawn whole in view in the fleet list: a tap at its centre reaches it, and its
 *  box meets no floating button (Refined's `+ New`, Instrument's round `+`). The measured set is the fleet list's buttons
 *  (the cards' controls and toggles, then the fleet foot's toggle, the list's own last row). The page's last row of
 *  controls must be among them: the list's end padding and the screen's own bottom padding (`.fleet`'s) are the band that
 *  keeps that last row clear, so a screen that stops reserving it is seen here (review 1626 F6). The New project door
 *  that once followed the list (review 1624 F8) heads it now (add-project spec 2026-11-04 §2, as redrawn), so nothing
 *  outside the list is measured. Only a phone's width mounts a floating button; at 1280 and 1920 neither skin does
 *  (`fabs` is 0), so there the overlap half of the check is empty by design and the tap half still runs. */
const measureResting = (): {
  lastShown: boolean; fabs: number;
  buttons: { name: string; control: boolean; reached: boolean; underFab: string | null }[];
} => {
  const list = document.querySelector<HTMLElement>('.fleet-list')!;
  let view = { top: 0, bottom: window.innerHeight };
  for (let el = list.parentElement; el !== null; el = el.parentElement) {
    const y = getComputedStyle(el).overflowY;
    if ((y === 'auto' || y === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
      const r = el.getBoundingClientRect();
      view = { top: Math.max(0, r.top), bottom: Math.min(window.innerHeight, r.bottom) };
      break;
    }
  }
  const last = [...list.querySelectorAll<HTMLElement>('.proj-card .proj-work-controls')].filter((c) => c.querySelector('button') !== null).at(-1);
  const fabs = [...document.querySelectorAll<HTMLElement>('.ref-fab, .fab')].map((f) => f.getBoundingClientRect())
    .filter((f) => f.width > 0 && f.height > 0);
  const shown = [...list.querySelectorAll<HTMLElement>('button')].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= view.top - 0.5 && r.bottom <= view.bottom + 0.5;
  });
  return {
    lastShown: last !== undefined && [...last.querySelectorAll<HTMLElement>('button')].every((b) => shown.includes(b)),
    fabs: fabs.length,
    buttons: shown.map((b) => {
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const fab = fabs.find((f) => r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top);
      return { name: b.getAttribute('aria-label') ?? (b.textContent ?? '').trim(), control: last?.contains(b) ?? false,
        reached: hit !== null && b.contains(hit), underFab: fab === undefined ? null : `${Math.round(r.bottom)} > ${Math.round(fab.top)}` };
    }),
  };
};

/** PR10 fix round 1, F9 (h): on every delegation work line drawn with a visible bracket, the bracket sits on the words' first line
 *  (its vertical centre inside the first word's box), even when the line wraps its controls under the words. */
const measureBrackets = (): { text: string; onWords: boolean; wrapped: boolean }[] =>
  [...document.querySelectorAll<HTMLElement>('.proj-card .proj-nest')].flatMap((nest) => {
    const bracket = nest.querySelector<HTMLElement>(':scope > .proj-nest-bracket');
    const work = nest.querySelector<HTMLElement>(':scope > .proj-work');
    const first = work?.querySelector<HTMLElement>('.proj-work-part');
    if (bracket === null || work === null || first === null || first === undefined) return [];
    const br = bracket.getBoundingClientRect();
    const fr = first.getBoundingClientRect();
    if (br.width === 0 || br.height === 0) return [];   // a row in a programme box draws no bracket
    const mid = br.top + br.height / 2;
    return [{ text: work.textContent ?? '', onWords: mid >= fr.top - 0.5 && mid <= fr.bottom + 0.5,
      wrapped: work.getBoundingClientRect().height > fr.height * 2 }];
  });

/** The fleet foot's region and each of its rows: inside the fleet list's box, and nothing overflowing its own box. A
 *  region without its `min-width: 0` widens the list's one grid track past the list, which this sees at every width,
 *  the desk sidebar's included (where the page itself does not scroll). */
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

describe.each(SKINS)('delegation rows on a project card in %s', (skin) => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      it(`at ${width} (${theme}): no sideways scroll, no page error, every row and chip inside its card`, async () => {
        const { ctx, page, errors } = await open(skin, theme, width);
        try {
          const shots = process.env['CCRC_SHOTS'];
          if (shots !== undefined && shots !== '') {
            await page.screenshot({ path: `${shots}/delegation-${skin}-${theme}-${width}.png`, fullPage: true });
          }
          const sideScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(sideScroll, 'sideways scroll').toBe(0);
          const rows = await page.evaluate(measureRows);
          // The lone session's two, the coordinator's activity and the worker's worktree in the box, and one per group.
          expect(rows, 'six delegation rows').toHaveLength(6);
          for (const row of rows) {
            expect(row.inCard, `${row.text}: inside its card`).toBe(true);
            expect(row.overflow, `${row.text}: nothing overflows the row`).toBeLessThanOrEqual(1);
            for (const c of row.cells) {
              expect(c.inRow, `${c.text}: inside its row`).toBe(true);
              expect(c.width, `${c.text}: drawn`).toBeGreaterThan(0);
            }
          }
          const unlisted = await page.evaluate(measureUnlisted);
          expect(unlisted, 'the region and its one row').toHaveLength(2);
          for (const u of unlisted) {
            expect(u.inList, `${u.text}: inside the fleet list`).toBe(true);
            expect(u.overflow, `${u.text}: nothing overflows it`).toBeLessThanOrEqual(1);
          }
          // F1 (review 1424): a long name never hides the condition word or the `from` part, on a card or in the region.
          const words = await page.evaluate(measureParts, { words: CONDITION_WORDS, floorCh: NAME_FLOOR_CH, gapFloor: GAP_FLOOR_PX });
          expect(words.filter((w) => w.hasCondition).length, 'every activity and worktree row has a condition word').toBe(6);
          if (width !== 390) {
            // Review 1435 G1: on the desk a name longer than the floor that fits is drawn whole, so the name grows. Asked
            // first, so a name that stops growing is named here rather than by the floor's sub-pixel margin below.
            const fits = words.find((w) => w.text.includes('read the plan'));
            expect(fits?.name, 'read the plan: has a name part').not.toBeNull();
            expect(fits!.name!.cut, 'read the plan: drawn whole').toBe(false);
          }
          expectWords(words);
          if (width === 390) {
            // Review 1431 F3: the long names are cut, in a box that clips, with an ellipsis; and the region row's `from`
            // part starts a line of its own, so the middot rule above is measured on a real wrapped line.
            for (const long of ['map every caller', 'reconcile every reader']) {
              const row = words.find((w) => w.text.includes(long));
              expect(row?.name, `${long}: has a name part`).not.toBeNull();
              expect(row!.name!.cut, `${long}: its name is cut`).toBe(true);
              expect(row!.name!.clips, `${long}: its text's box clips`).toBe(true);
              expect(row!.name!.ellipsis, `${long}: with an ellipsis`).toBe(true);
            }
            expect(words.find((w) => w.text.includes('reconcile every reader'))!.lineStarts, 'the region row wraps').toBeGreaterThan(0);
          }
          const chips = rows.flatMap((r) => r.cells.map((c) => c.text));
          expect(chips.filter((t) => t === 'inferred'), 'each raw worktree wears inferred').toHaveLength(2);
          expect(chips.some((t) => t.includes('project-b')), 'the works-on chip').toBe(true);
          // R9: the worker's live activity is a chip on its row, never a row.
          const r9 = await page.evaluate(() => [...document.querySelectorAll('.sess-meta-chip')].map((e) => e.textContent));
          expect(r9).toContain('1 delegated');
          // PR10: the six controls of the three newer-server rows, each inside its row and card on all four sides, reached by
          // a tap at its centre (never under the floating button), named uniquely, and on a phone at the tap floor.
          const shown = await page.evaluate(measureControls);
          expect(shown.controls.map((c) => c.text).sort(), 'the worktree controls').toEqual(
            ['Attach to…', 'Keep worktree', 'Keep worktree', 'Not delegated', 'Not delegated', 'Not delegated']);
          expect(new Set(shown.controls.map((c) => c.name)).size, 'each control\'s name is its own').toBe(6);
          for (const c of shown.controls) {
            expect(c.name.startsWith(c.text), `${c.name}: its name carries its label`).toBe(true);
            expect(c.inRow, `${c.name}: inside its row`).toBe(true);
            expect(c.inCard, `${c.name}: inside its card`).toBe(true);
            expect(c.reached, `${c.name}: a tap at its centre reaches it`).toBe(true);
            if (width === 390) expect(c.height, `${c.name}: reaches the tap floor`).toBeGreaterThanOrEqual(shown.floor - 0.5);
          }
          expect(rows.some((r) => r.text.includes('worktree kept until')), 'the kept words, said once').toBe(true);
          // Fix round 2 (review 1623 F6): the page's last row of controls, where it rests at the end of the list.
          await page.evaluate(scrollToEnd);
          await page.waitForTimeout(150);
          const resting = await page.evaluate(measureResting);
          expect(resting.lastShown, 'the last row of controls is drawn whole at the end of the list').toBe(true);
          expect(resting.buttons.some((c) => c.control), 'the last row of controls is measured').toBe(true);
          expect(resting.fabs, 'a floating button at a phone\'s width only').toBe(width === 390 ? 1 : 0);
          for (const c of resting.buttons) {
            expect(c.underFab, `${c.name}: clear of the floating button at the end of the list`).toBeNull();
            expect(c.reached, `${c.name}: a tap at its centre reaches it at the end of the list`).toBe(true);
          }
          // F8 (d): the box a script focuses after an act draws no ring, even after a keyboard action.
          await page.keyboard.press('Shift');
          const ring = await page.evaluate(() => {
            const box = document.querySelector<HTMLElement>('.proj-card .proj-work-controls')!;
            box.focus();
            return { visible: box.matches(':focus-visible'), outline: getComputedStyle(box).outlineStyle };
          });
          expect(ring, 'the script-focused box: focus-visible, and no ring').toEqual({ visible: true, outline: 'none' });
          const brackets = await page.evaluate(measureBrackets);
          expect(brackets.length, 'the bracketed work lines').toBeGreaterThan(0);
          for (const b of brackets) expect(b.onWords, `${b.text}: its bracket sits on the words' first line`).toBe(true);
          if (width === 390) expect(brackets.some((b) => b.wrapped), 'a line that wraps is measured').toBe(true);
          if (shots !== undefined && shots !== '') {
            // Fix round 2 (review 1623 F6): the evidence views. On the desk, the offline-coordinator row and the unowned row
            // scrolled into view; at every width, an open confirm and a refusal.
            if (width !== 390) {
              for (const [name, text] of [['offline', 'Offline coordinator'], ['unowned', 'Unowned work']] as const) {
                await page.locator('.proj-card .proj-group-toggle', { hasText: text }).evaluate((t) =>
                  (t.parentElement?.querySelector('.proj-work') ?? t).scrollIntoView({ block: 'start' }));
                await page.waitForTimeout(150);
                await page.screenshot({ path: `${shots}/delegation-${skin}-${theme}-${width}-${name}.png` });
              }
            }
            const notDelegated = page.locator('.proj-card .proj-work-controls button', { hasText: 'Not delegated' }).first();
            await notDelegated.scrollIntoViewIfNeeded();
            await notDelegated.click();
            await page.waitForSelector('[role="dialog"]');
            await page.waitForTimeout(400);
            await page.screenshot({ path: `${shots}/delegation-${skin}-${theme}-${width}-confirm.png` });
            await page.keyboard.press('Escape');
            await page.waitForTimeout(400);
            await page.route('**/api/leases/**', (route) => route.fulfill({ status: 409, contentType: 'application/json',
              body: JSON.stringify({ ok: false, error: 'carrier-behind', detail: '' }) }));
            const keep = page.locator('.proj-card .proj-work-controls button', { hasText: 'Keep worktree' }).first();
            await keep.scrollIntoViewIfNeeded();
            await keep.click();
            await page.locator('.proj-card [role="alert"]', { hasText: 'has not caught up' }).first().waitFor();
            await page.screenshot({ path: `${shots}/delegation-${skin}-${theme}-${width}-refusal.png` });
          }
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});

// ---- where the focus goes around a worktree control's real sheet (review 1624 F3) ------------------------------------
// jsdom unmounts a closed sheet at once, so the card suite cannot see what the real one does: its panel stays mounted
// through a 180-320 ms exit, holding the focus, and it gives the focus back to its opener as it closes. Both arms (the
// bottom sheet at 390, the centred dialog at 1280 and 1920), in both skins and both palettes (review 1626 F14), on the lone
// session's raw worktree, which offers all three controls: Cancel gives the focus back to the control that opened the
// confirm; Keep leaves it on the row's box; a confirmed act that is refused leaves it on the box with the sentence said;
// and an ask the row stops offering while it is open (the row moves to `promoted`, so Attach, its opener, goes) places it
// on the box in the commit that closes the ask, while the closing panel still holds it (review 1626 F10). A row that
// leaves while its confirm is open (its record dropped, or its state one this build cannot read) hands the focus to its
// card's heading (review 1626 F2), also after a `Tab` has moved the focus inside the confirm, which arms the confirm's
// focus trap: the hand-off waits until the trap has gone (review 1628 F1).
const FOCUS_ROW = 'agent-l1';
/** What holds the focus, named the way the row would name it. */
const focusAt = (): string => {
  const a = document.activeElement;
  if (a === null || a === document.body) return 'body';
  if (a.closest('[role="dialog"]') !== null) return `dialog: ${(a.textContent ?? '').trim() || a.getAttribute('aria-label') || a.tagName}`;
  if (a.classList.contains('proj-work-controls')) return `box: ${a.getAttribute('aria-label') ?? ''}`;
  if (a.classList.contains('proj-card-toggle')) return `card: ${a.querySelector('.proj-card-name')?.textContent ?? ''}`;
  return a.getAttribute('aria-label') ?? a.className;
};
const keptAnswer = (): string => JSON.stringify({ ok: true, lease: 'l-lone', generation: 2, disposition: 'retained',
  expiresAt: new Date(NOW + 7 * 86_400_000).toISOString(), carrier: 'pending' });

/** The next frame with the lone session's worktree changed by `over`, or gone when `over` is null. */
const withLone = (over: object | null): object => ({ type: 'delegation', delegation: { ...DELEGATION,
  leases: DELEGATION.leases.flatMap((l) => (l.leaseId !== 'l-lone' ? [l] : over === null ? [] : [{ ...l, ...over }])) } });

describe.each(SKINS)('the focus around a worktree control\'s real sheet in %s (review 1624 F3)', (skin) => {
  for (const theme of THEMES) for (const width of WIDTHS) {
    it(`at ${width} (${theme}): Cancel, Keep, a refusal and a dropped ask each leave the focus where the row says`, async () => {
      const { ctx, page, errors, send } = await open(skin, theme, width);
      try {
        const control = (name: string) => page.getByRole('button', { name: `${name} (${FOCUS_ROW})`, exact: true });
        const settled = async (): Promise<void> => {
          await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5_000 });
          await page.waitForTimeout(150);
        };
        // Cancel: the sheet gives the focus back to the control that opened it.
        await control('Not delegated').scrollIntoViewIfNeeded();
        await control('Not delegated').click();
        await page.waitForSelector('[role="dialog"]');
        expect(await page.evaluate(focusAt), 'a danger confirm opens on Cancel').toBe('dialog: Cancel');
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
        await settled();
        expect(await page.evaluate(focusAt), 'after Cancel').toBe(`Not delegated (${FOCUS_ROW})`);
        // Keep acts at once: the focus waits on the row's box while the controls are disabled, and stays there.
        await page.route('**/api/leases/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: keptAnswer() }));
        await control('Keep worktree').click();
        await page.getByText(/^Worktree kept until/).first().waitFor();
        expect(await page.evaluate(focusAt), 'after Keep').toBe(`box: Worktree ${FOCUS_ROW}`);
        // A confirmed act the door refuses: the sentence is said, and the focus is on the box.
        await page.unroute('**/api/leases/**');
        await page.route('**/api/leases/**', (route) => route.fulfill({ status: 409, contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'carrier-behind', detail: '' }) }));
        await control('Attach to…').click();
        await page.waitForSelector('[role="dialog"]');
        await page.getByRole('dialog').getByRole('button', { name: 'Attach to lone-tidy-pass', exact: true }).click();
        await page.locator('.proj-card [role="alert"]', { hasText: 'has not caught up' }).first().waitFor();
        await settled();
        expect(await page.evaluate(focusAt), 'after a refusal').toBe(`box: Worktree ${FOCUS_ROW}`);
        // A dropped ask: Attach is open when the next frame moves the row to `promoted`. Attach, the sheet's opener, is
        // gone, so the sheet gives the focus back to nothing, and the closing panel holds it until the row places it.
        await page.unroute('**/api/leases/**');
        await control('Attach to…').click();
        await page.waitForSelector('[role="dialog"]');
        send('/ws/fleet', withLone({ disposition: 'promoted' }));
        await control('Attach to…').waitFor({ state: 'detached' });
        await settled();
        expect(await page.evaluate(focusAt), 'after a dropped ask').toBe(`box: Worktree ${FOCUS_ROW}`);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it(`at ${width} (${theme}): a row that leaves while its confirm is open hands the focus to its card's heading (review 1626 F2)`, async () => {
      const { ctx, page, errors, send } = await open(skin, theme, width);
      try {
        const attach = page.getByRole('button', { name: `Attach to… (${FOCUS_ROW})`, exact: true });
        for (const [variant, frame, key] of [
          ['its record dropped', withLone(null), null],
          ['its state one this build cannot read', withLone({ disposition: 'future-word' }), null],
          ['its record dropped, after a Tab inside the confirm', withLone(null), 'Tab'],
          ['its state one this build cannot read, after a Tab inside the confirm', withLone({ disposition: 'future-word' }), 'Tab'],
        ] as const) {
          send('/ws/fleet', withLone({}));
          await attach.scrollIntoViewIfNeeded();
          await attach.click();
          await page.waitForSelector('[role="dialog"]');
          if (key !== null) {
            await page.keyboard.press(key);
            expect(await page.evaluate(focusAt), `${variant}: the focus moved inside the confirm`).toMatch(/^dialog: /);
          }
          send('/ws/fleet', frame);
          await attach.waitFor({ state: 'detached' });
          await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5_000 });
          await page.waitForTimeout(300);
          expect(await page.evaluate(focusAt), variant).toBe('card: project-a');
        }
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
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
