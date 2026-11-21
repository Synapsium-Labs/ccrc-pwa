// D-8142, D-8817: a coordinator's fleet card wears the role BADGE (the word `coordinator` is its accessible name, not drawn),
// first on its context line, in a real Chrome over the production build. One legible fact at every width: the badge is drawn
// whole (not cut, not wrapped), 16px square, inside its row, on the first line of the context; a long branch beside it keeps the token-shortened form below the desk and its two-line clamp at the
// desk (D-6332), and a child's card never wears it. `test/card-header-facts.test.tsx` holds the model and the markup;
// this file holds the geometry. Measured in Refined's cards and in Instrument's status and project modes, in the Phosphor
// palette and the light theme, at 360, 390, 1280, 1470 and 1920.
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/role-fact.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { GROUP_MODE_KEY } from '../src/skins/instrument/FleetTable';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';
import { withRunBinding } from '../test/runBindingFixture';

const THEMES = [PHOSPHOR, 'light'] as const;
const WIDTHS = [360, 390, 1280, 1470, 1920] as const;
const MODES = [
  { skin: REFINED, mode: 'cards' },
  { skin: INSTRUMENT, mode: 'status' },
  { skin: INSTRUMENT, mode: 'project' },
] as const;
const CASES = MODES.flatMap(({ skin, mode }) => THEMES.flatMap((theme) =>
  WIDTHS.map((width) => ({ view: { skin, theme, width } as AppView, mode }))));
const named = (v: AppView, mode: string): string => `${v.skin}, ${v.theme}, ${v.width}px, ${mode}`;

const PROJECT = 'project-a';
const BRANCH_60 = 'feat/garden-stone-silver-harbor-morning-cedars-quiet-river-run';
const ROSTER = [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', pool: 'pool-a', homeAble: true, hidden: false }];
const row = (ws: string, extra: object = {}): object => ({
  id: `${PROJECT}-${ws}`, wrapper: 'lane-a', home: 'lane-a', project: PROJECT, workdir: `/w/${PROJECT}/${ws}`, workspace: ws,
  name: ws, status: 'busy', statusUpdatedAt: null, limits: null, dialogPending: false, version: null, model: null,
  effort: null, ultracode: false, branch: `ws/${ws}`, ctxPct: null, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'working', unmeasured: [], started: true,
  child: { kind: 'none' }, role: 'coordinator', ...extra,
});
const PR = { phase: 'open', number: 123, url: null, title: null, checks: 'pass', checkNames: null, ahead: 1, reason: null,
  checkedAt: 1, mergedAt: null, retryAt: null };
const SESSIONS = [
  row('coord-branch', { branch: BRANCH_60 }),
  row('coord-pr', { pr: PR }),
  row('child-branch', { role: 'child', branch: BRANCH_60 }),
  row('selected'),
];
const SELECTED = `${PROJECT}-selected`;
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: ROSTER },
    '/api/projects': { roots: ['/w'], projects: [{ name: PROJECT, workdir: `/w/${PROJECT}` }] },
    '/api/runs': [],
    '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: SESSIONS }],
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

async function boot(view: AppView, mode: string): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
  if (mode === 'project') {
    await ctx.addInitScript((key) => {
      try { localStorage.setItem(key, 'project'); } catch { /* no storage: Instrument opens on status */ }
    }, GROUP_MODE_KEY);
  }
  await page.goto(server!.origin + (view.width >= 900 ? `/s/${SELECTED}` : '/'));
  await page.waitForFunction(([skin, theme]) => {
    const root = document.documentElement;
    return root.getAttribute('data-skin') === skin && (root.getAttribute('data-theme') ?? 'phosphor') === theme;
  }, [view.skin, view.theme] as const, { timeout: 20_000 });
  await page.locator('.sess-line').first().waitFor();
  return { page, errors, close: () => ctx.close() };
}

interface RowRole {
  readonly name: string;
  readonly roles: number;
  readonly label: string;
  readonly text: string;
  readonly width: number;
  readonly cut: boolean;
  readonly inside: boolean;
  readonly oneLine: boolean;
  readonly firstOnLine: boolean;
  readonly contextOneLine: boolean;
}

/** Per row: its name, how many `.sess-role` cells it draws, and the first one's geometry. */
function measure(page: Page): Promise<RowRole[]> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.sess-line')].map((line) => {
    const open = line.querySelector('.sess-open');
    const name = (open?.querySelector('.sr-only') ?? open?.querySelector('.sess-label'))?.textContent ?? '';
    const roles = line.querySelectorAll<HTMLElement>('.sess-role');
    const role = roles[0];
    const ctx = line.querySelector<HTMLElement>('.sess-meta--context');
    const empty = { name, roles: roles.length, label: '', text: '', width: 0, cut: false, inside: true, oneLine: true, firstOnLine: true, contextOneLine: true };
    if (role === undefined || ctx === undefined || ctx === null) return empty;
    const r = role.getBoundingClientRect();
    const l = line.getBoundingClientRect();
    const c = ctx.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(role).lineHeight) || r.height;
    return {
      ...empty,
      label: role.getAttribute('aria-label') ?? '',
      text: role.textContent ?? '',
      width: r.width,
      cut: role.scrollWidth > role.clientWidth + 0.5,
      inside: r.left >= l.left - 0.5 && r.right <= l.right + 0.5 && r.top >= l.top - 0.5 && r.bottom <= l.bottom + 0.5,
      oneLine: r.height <= lh * 1.5,
      // The role is the first cell of the context line: its left edge is the context's, its top the context's first line.
      firstOnLine: Math.abs(r.left - c.left) <= 1 && r.top - c.top <= lh,
      contextOneLine: c.height <= lh * 1.5,
    };
  }));
}

const sideScroll = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

describe('D-8142, D-8817: the card wears the coordinator badge', () => {
  for (const { view, mode } of CASES) {
    it(`a coordinator's card wears the badge whole, a child's does not (${named(view, mode)})`, async () => {
      const { page, errors, close } = await boot(view, mode);
      try {
        const rows = await measure(page);
        for (const name of ['coord-branch', 'coord-pr']) {
          const r = rows.find((x) => x.name === name);
          expect(r, `${name} is drawn`).toBeDefined();
          expect(r!.roles, `${name}: exactly one role cell`).toBe(1);
          expect(r!.label, `${name}: the accessible name`).toBe('coordinator');
          expect(r!.text, `${name}: no visible word`).toBe('');
          expect(r!.width, `${name}: the badge is its icon's 16px`).toBe(16);
          expect(r!.cut, `${name}: the badge is not cut`).toBe(false);
          expect(r!.inside, `${name}: the badge is inside its row`).toBe(true);
          expect(r!.oneLine, `${name}: the badge is on one line`).toBe(true);
          expect(r!.firstOnLine, `${name}: the badge begins the context line`).toBe(true);
        }
        // The PR row and, below the desk, the branch row keep their context on one line (the desk clamps a branch to two, D-6332).
        expect(rows.find((x) => x.name === 'coord-pr')!.contextOneLine, 'the PR context is one line').toBe(true);
        if (view.width < 900) {
          expect(rows.find((x) => x.name === 'coord-branch')!.contextOneLine, 'the branch context is one line').toBe(true);
        }
        const kid = rows.find((x) => x.name === 'child-branch');
        expect(kid, 'the child row is drawn').toBeDefined();
        expect(kid!.roles, 'a child wears no role').toBe(0);
        expect(await sideScroll(page), 'no horizontal overflow').toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    });
  }
});

// D-8834 (C51), after D-8817 (C50): in the session header the badge sits on the TITLE line, right after the session's name,
// sized to the name's text and on its baseline; the details row no longer carries it, so the header loses the line the badge
// stood on alone and is taller nowhere. A coordinator that holds a programme's run, so its header draws the Goals door, is
// opened at each width in each skin and theme.
const HEAD_NOW = Date.now();
const headRow = (id: string, extra: object = {}): object => ({
  ...row(id, extra), id: `${PROJECT}-${id}`, statusUpdatedAt: HEAD_NOW - 60_000, bucketSince: HEAD_NOW - 60_000, started: true,
});
const HEAD_RUN = {
  id: 301, program: 'billing', programTitle: 'Billing rework', wave: 3, waveOf: 6, project: PROJECT, homeProject: PROJECT,
  sessionId: `${PROJECT}-head-w1`, workspace: 'head-w1', branch: 'ws/head-w1', state: 'working', kind: 'work', reviews: null,
  claimedBy: `${PROJECT}-head-coord`, resumed: false, clearedAt: null, openedAt: HEAD_NOW - 3_600_000, dispatchStartedAt: null,
  dispatchedAt: HEAD_NOW - 3_000_000, closedAt: null, handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false,
};
// The coordinator is a workspace session, as the fleet's coordinators are, so the header draws its project as a crumb before the name.
const HEAD_SESSIONS = [headRow('head-coord', { ctxPct: 40 }), headRow('head-w1', { role: 'child' })];
const HEAD_FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: ROSTER },
    '/api/projects': { roots: ['/w'], projects: [{ name: PROJECT, workdir: `/w/${PROJECT}` }] },
    '/api/runs': [HEAD_RUN], '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: withRunBinding(HEAD_SESSIONS as never[], [HEAD_RUN] as never[]) }, { type: 'runs', runs: [HEAD_RUN] }],
};

interface HeadMeasure {
  /** The badge is a node of the title (`.chat-title`) that follows the name's own node (`.chat-title-text`). */
  readonly inTitleAfterName: boolean;
  /** The badge is the last child of `.chat-title-glue`, whose text before it is the name's last character, one box that cannot break. */
  readonly glued: boolean;
  readonly badgesInHeader: number;
  /** A badge still inside the details (`.chat-facts`). */
  readonly inFacts: boolean;
  readonly badge: { readonly w: number; readonly h: number; readonly top: number; readonly bottom: number; readonly cls: string; readonly text: string } | null;
  /** The name's text: its font size and the box of its last line. */
  readonly name: { readonly fontPx: number; readonly top: number; readonly bottom: number } | null;
  /** The text baseline of the line the badge sits on, from a zero-size inline-block probe placed beside the badge. */
  readonly baseline: number | null;
  /** What the badge's own carrier adds to the header: the height lost when the badge's nearest `.chat-fact` (the details row's
   *  cell, as C50 drew it) or, where it is in the title, the badge itself is hidden. */
  readonly carrierAdds: number | null;
  /** The line the old placement costs: the header's height with the badge drawn as C50 drew it, as the FIRST cell of the
   *  details row, less the header's own; the row's height and the gap above it; whether it stood alone on its line. */
  readonly oldRowAdds: number;
  /** The same growth of the text block (`.chat-title-wrap`, where the shared header draws it; the header itself where there is none):
   *  the header's own growth can be held back by its other column, the doors, whose height is a floor at the desk. */
  readonly oldBlockAdds: number;
  readonly oldRow: { readonly h: number; readonly gap: number; readonly alone: boolean } | null;
}

async function measureHead(page: Page): Promise<HeadMeasure> {
  return page.evaluate(() => {
    const head = document.querySelector<HTMLElement>('.chat-head')!;
    const SEL = '[role="img"][aria-label="coordinator"]';
    const title = head.querySelector<HTMLElement>('.chat-title');
    const nameEl = title?.querySelector<HTMLElement>('.chat-title-text') ?? null;
    const anyBadge = head.querySelector<HTMLElement>(SEL);
    const badgeEl = title?.querySelector<HTMLElement>(SEL) ?? null;
    const inTitleAfterName = badgeEl !== null && nameEl !== null
      && (nameEl.compareDocumentPosition(badgeEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const inFacts = head.querySelector('.chat-facts ' + SEL) !== null;
    const glue = badgeEl?.parentElement ?? null;
    const glued = glue !== null && glue.classList.contains('chat-title-glue') && glue.lastElementChild === badgeEl
      && glue.firstChild?.nodeType === Node.TEXT_NODE && Array.from(glue.firstChild.textContent ?? '').length === 1
      && getComputedStyle(glue).whiteSpace === 'nowrap';
    const bsvg = badgeEl?.querySelector('svg')?.getBoundingClientRect();
    const br = badgeEl?.getBoundingClientRect();
    const badge = badgeEl === null || bsvg === undefined || br === undefined ? null
      : { w: bsvg.width, h: bsvg.height, top: br.top, bottom: br.bottom, cls: badgeEl.className, text: badgeEl.textContent ?? '' };
    const rects = nameEl === null ? [] : [...nameEl.getClientRects()];
    const last = rects[rects.length - 1];
    const name = nameEl === null || last === undefined ? null
      : { fontPx: parseFloat(getComputedStyle(nameEl).fontSize), top: last.top, bottom: last.bottom };
    // The baseline: a zero-size inline-block sits with its bottom edge on the line's baseline.
    let baseline: number | null = null;
    if (badgeEl !== null) {
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0';
      badgeEl.after(probe);
      baseline = probe.getBoundingClientRect().bottom;
      probe.remove();
    }
    const headH = head.getBoundingClientRect().height;
    let carrierAdds: number | null = null;
    if (anyBadge !== null) {
      const carrier = anyBadge.closest<HTMLElement>('.chat-fact') ?? anyBadge;
      const saved = carrier.style.display;
      carrier.style.display = 'none';
      carrierAdds = headH - head.getBoundingClientRect().height;
      carrier.style.display = saved;
    }
    // THE C50 COMPARISON IS A FROZEN COPY (review 2963 F8): the old placement is rebuilt here from C50's own rules, written into this test,
    // not read from `main` or from a stylesheet that still holds them (C51 removed them). It matches C50 today (a row of 16.5 px and a 5 px
    // gap, 21.5 px at 360, equal to the real difference between `main` and the first version of this change), and it exists to give
    // "one line shorter" a figure that does not move when the header's own rules do. If the details row's rules change, this copy is
    // not updated by itself and the figure it gives is C50's, not the new row's.
    // The old placement, rebuilt from C50's own rules (`.chat-fact-role`: a flex line of 1lh at the row's font size, the glyph 1em of
    // --fs-meta), as the FIRST cell of the details row, measured, then taken out again.
    let oldRowAdds = 0;
    let oldBlockAdds = 0;
    const block = head.querySelector<HTMLElement>('.chat-title-wrap') ?? head;
    const blockH = block.getBoundingClientRect().height;
    let oldRow: { h: number; gap: number; alone: boolean } | null = null;
    // The details row is not drawn for a coordinator with nothing else to show (`detailsHaveFacts`): the old placement is rebuilt as
    // the row `SessionDetails` drew at C50, a full-width item at the end of the meta block, when there is none to put it in.
    let facts = head.querySelector<HTMLElement>('.chat-facts');
    let madeFacts = false;
    if (facts === null) {
      const meta = head.querySelector<HTMLElement>('.chat-meta');
      if (meta !== null) {
        facts = document.createElement('div');
        facts.className = 'chat-facts';
        meta.append(facts);
        madeFacts = true;
      }
    }
    if (anyBadge !== null && facts !== null) {
      const row = document.createElement('span');
      row.className = 'chat-fact';
      row.style.cssText = 'display:flex;align-items:center;min-height:1lh';
      const clone = anyBadge.cloneNode(true) as HTMLElement;
      clone.className = 'inline-flex flex-none items-center justify-center';
      clone.style.fontSize = 'var(--fs-meta)';
      clone.querySelector('svg')!.style.cssText = 'width:1em;height:1em';
      row.append(clone);
      facts.prepend(row);
      oldRowAdds = head.getBoundingClientRect().height - headH;
      oldBlockAdds = block.getBoundingClientRect().height - blockH;
      const rr = row.getBoundingClientRect();
      // Alone on its line: nothing else of the meta block (its chips and facts, in either skin's rail) shares its rows.
      const others = [...head.querySelectorAll<HTMLElement>('.chat-meta *')]
        .filter((el) => !row.contains(el) && !el.contains(row) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
      const alone = others.every((el) => { const r = el.getBoundingClientRect(); return r.bottom <= rr.top + 0.5 || r.top >= rr.bottom - 0.5; });
      // What stands above the row: the meta block's row gap, which every full-width row of it is set apart by.
      const above = parseFloat(getComputedStyle(facts.parentElement!).rowGap);
      oldRow = { h: rr.height, gap: Number.isFinite(above) ? above : 0, alone };
      row.remove();
    }
    if (madeFacts) facts?.remove();
    return { inTitleAfterName, glued, badgesInHeader: head.querySelectorAll(SEL).length, inFacts, badge, name, baseline, carrierAdds, oldRowAdds, oldBlockAdds, oldRow };
  });
}

describe('D-8834: the header\'s role badge sits on the title line, after the name', () => {
  const measured = new Map<string, Promise<HeadMeasure>>();
  /** One page per view and theme and width, opened by the first case that asks and measured once for the three. */
  const measureView = (skin: string, theme: string, width: number): Promise<HeadMeasure> => {
    const key = `${skin}/${theme}/${width}`;
    const had = measured.get(key);
    if (had !== undefined) return had;
    const made = (async (): Promise<HeadMeasure> => {
      const { ctx, page, errors } = await openApp(browser!, { skin, theme, width } as AppView, HEAD_FIXTURE);
      try {
        await page.goto(server!.origin + `/s/${PROJECT}-head-coord`);
        await page.waitForSelector('.chat-head', { timeout: 20_000 });
        await page.evaluate(async () => { await document.fonts.ready; });
        // This coordinator has nothing else to say, so the header draws no details row and no Details door (a phone has none to open).
        expect(await page.getByRole('button', { name: /details/i }).count(), 'no Details door for an empty row').toBe(0);
        expect(await page.locator('.chat-facts').count(), 'no details row for an empty row').toBe(0);
        await page.waitForTimeout(300);
        const m = await measureHead(page);
        expect(errors, 'no page errors').toEqual([]);
        return m;
      } finally {
        await ctx.close();
      }
    })();
    measured.set(key, made);
    return made;
  };
  for (const { skin, theme, width } of [INSTRUMENT, REFINED].flatMap((skin) =>
    THEMES.flatMap((theme) => [360, 1280].map((width) => ({ skin, theme, width }))))) {
    const at = `${skin}, ${theme}, ${width}px`;

    it(`${at}: one badge, inside the title line after the name, and not in the details row`, async () => {
      const m = await measureView(skin, theme, width);
      expect(m.badge, 'the title line draws the badge').not.toBeNull();
      expect(m.badgesInHeader, 'one badge in the whole header').toBe(1);
      expect(m.inTitleAfterName, 'inside the title line, after the name').toBe(true);
      expect(m.glued, 'in one unbreakable box with the name\'s last character').toBe(true);
      expect(m.inFacts, 'not in the details row').toBe(false);
      expect(m.badge?.text, 'no visible word').toBe('');
      expect(m.badge?.cls, 'the card\'s role rule is not on the header badge').not.toContain('sess-role');
    });

    it(`${at}: the name's size, on the name's line and baseline`, async () => {
      const m = await measureView(skin, theme, width);
      expect(m.badge, 'the title line draws the badge').not.toBeNull();
      const name = m.name!;
      expect(name, 'the name is drawn').not.toBeNull();
      expect(m.badge!.w, 'the glyph is the name\'s font size wide').toBeCloseTo(name.fontPx, 0);
      expect(m.badge!.h, 'the glyph is the name\'s font size tall').toBeCloseTo(name.fontPx, 0);
      // It shares the name's line box: the badge's centre is inside the box of the name's last line.
      const centre = (m.badge!.top + m.badge!.bottom) / 2;
      expect(centre, 'the badge\'s centre is inside the name\'s last line box').toBeGreaterThanOrEqual(name.top - 0.5);
      expect(centre, 'the badge\'s centre is inside the name\'s last line box').toBeLessThanOrEqual(name.bottom + 0.5);
      // On the baseline: the icon's bottom edge is on it, lowered by the icon rule's 0.125em and no more.
      expect(m.badge!.bottom - m.baseline!, 'the badge rests on the baseline').toBeGreaterThanOrEqual(-0.5);
      expect(m.badge!.bottom - m.baseline!, 'and drops no more than the icon rule').toBeLessThanOrEqual(name.fontPx * 0.125 + 0.5);
    });

    it(`${at}: the badge adds no line, and the header is shorter by the line it stood alone on at C50`, async () => {
      const m = await measureView(skin, theme, width);
      // No taller anywhere: hiding the badge's carrier changes nothing, so a worker's header of the same name is as tall.
      expect(m.carrierAdds, 'the badge has a carrier').not.toBeNull();
      expect(Math.abs(m.carrierAdds!), 'the badge adds no height of its own').toBeLessThanOrEqual(0.5);
      // The line saved: C50's placement, rebuilt as a cell of the details row, costs the row's height and the gap above it
      // when it stands alone on its line, and nothing when it shares one.
      expect(m.oldRow, 'the old row could be rebuilt').not.toBeNull();
      const seen = `(row ${m.oldRow!.h}px, gap ${m.oldRow!.gap}px, text block grew ${m.oldBlockAdds}px, header grew ${m.oldRowAdds}px, alone ${m.oldRow!.alone})`;
      if (m.oldRow!.alone) {
        // The text block loses exactly the row and its gap. The header loses all of it unless the doors column, which sets a floor
        // at the desk, is the taller of the two columns (the header then loses what the text block was above that floor).
        expect(Math.abs(m.oldBlockAdds - (m.oldRow!.h + m.oldRow!.gap)), `one whole line, with its gap ${seen}`).toBeLessThanOrEqual(1.5);
        expect(m.oldRowAdds, `the header never loses more than the text block ${seen}`).toBeLessThanOrEqual(m.oldBlockAdds + 0.5);
        if (width < 900) expect(Math.abs(m.oldRowAdds - m.oldBlockAdds), `below the desk the header loses the whole line ${seen}`).toBeLessThanOrEqual(1.5);
        else expect(m.oldRowAdds, `at the desk the header loses the line less the doors' floor ${seen}`).toBeGreaterThan(0);
      } else expect(Math.abs(m.oldRowAdds), `a row that shared its line took no line of its own ${seen}`).toBeLessThanOrEqual(1);
      // Instrument drew the badge alone on a line at both widths (the operator's look of 2026-11-20); Refined's rail drew it on the rail.
      if (skin === INSTRUMENT) expect(m.oldRow!.alone, 'C50 drew the badge alone on its line in Instrument').toBe(true);
    });
  }
});

// D-8834, review 2963 F1: the badge is glued to the name's last character, so it never wraps alone onto a line of its own. The
// first version drew it as a plain inline box after the name, which broke before it at the lengths where the name's last line
// nearly filled the column (Refined at 360 and 390 px was taller than the header with no badge at about one length in five). A
// sweep, not one name: in each view the name is replaced in place by names of 1 to 130 characters, as words and as one unbroken
// token, and at each length two things must hold. The badge's centre is inside the box of the name's last line. And the header
// is no taller than the same header with the badge hidden (which is a worker's header of that name: the badge is the only
// difference on the title line, and a worker draws none) WHERE THE BADGE HAS ROOM: when the name's last line leaves less than the
// glyph's width and gap before the column's edge, the glyph needs a line the worker's name did not, and the header is taller by
// that one line; nothing can change that short of drawing the glyph over the doors. The text is replaced in the page (the
// head text node and the glue's own character), so the markup around it is the app's own. THE RULE, as the coordinator ruled it
// (2026-11-20, fix round 1): the badge never sits alone on a line, and a coordinator's header is taller than a worker's only where
// the name's last line has no room for the glyph. The sweep asserts both halves.
describe("D-8834: the badge never sits alone on a line, and a coordinator's header is taller than a worker's only where the name's last line has no room for the glyph (a name-length sweep)", () => {
  for (const { skin, theme, width } of [INSTRUMENT, REFINED].flatMap((skin) =>
    THEMES.flatMap((theme) => [360, 390, 1280].map((width) => ({ skin, theme, width }))))) {
    it(`${skin}, ${theme}, ${width}px: names of 1 to 130 characters, words and one token`, async () => {
      const { ctx, page, errors } = await openApp(browser!, { skin, theme, width } as AppView, HEAD_FIXTURE);
      try {
        await page.goto(server!.origin + `/s/${PROJECT}-head-coord`);
        await page.waitForSelector('.chat-head', { timeout: 20_000 });
        await page.evaluate(async () => { await document.fonts.ready; });
        await page.waitForTimeout(300);
        const result = await page.evaluate(() => {
          const head = document.querySelector<HTMLElement>('.chat-head')!;
          const title = head.querySelector<HTMLElement>('.chat-title')!;
          const nameEl = title.querySelector<HTMLElement>('.chat-title-text')!;
          const glue = nameEl.querySelector<HTMLElement>('.chat-title-glue');
          const badge = title.querySelector<HTMLElement>('[role="img"][aria-label="coordinator"]');
          type Fail = { kind: string; len: number; inLine: boolean; extra: number; room: boolean; dbg: string };
          const none = { drawn: false, checked: 0, fails: [] as Fail[], taller: 0 };
          if (badge === null || glue === null) return none;
          const headNode = nameEl.firstChild as Text;
          const lastNode = glue.firstChild as Text;
          const WORDS = 'garden stone silver harbor morning cedars quiet river nimble copper lantern meadow willow granite amber falcon ';
          const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789';
          const make = (kind: string, n: number): string => {
            const raw = kind === 'words' ? WORDS.repeat(Math.ceil(n / WORDS.length) + 1).slice(0, n) : TOKEN.repeat(Math.ceil(n / TOKEN.length)).slice(0, n);
            return kind === 'words' ? raw.trimEnd() || 'a' : raw;
          };
          const fails: Fail[] = [];
          let checked = 0;
          let taller = 0;
          const textRects = (): DOMRect[] => [headNode, lastNode].flatMap((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return [...range.getClientRects()].filter((r) => r.width > 0);
          });
          for (const kind of ['words', 'token']) {
            for (let len = 1; len <= 130; len += 1) {
              const chars = Array.from(make(kind, len));
              lastNode.data = chars.pop() ?? '';
              headNode.data = chars.join('');
              const br = badge.getBoundingClientRect();
              const rects = textRects();
              if (rects.length === 0) continue;
              const lastTop = Math.max(...rects.map((r) => r.top));
              const lastLine = rects.filter((r) => r.top >= lastTop - 1);
              const top = Math.min(...lastLine.map((r) => r.top));
              const bottom = Math.max(...lastLine.map((r) => r.bottom));
              const centre = (br.top + br.bottom) / 2;
              const inLine = centre >= top - 0.5 && centre <= bottom + 0.5;
              const h = head.getBoundingClientRect().height;
              const tH = title.getBoundingClientRect().height;
              badge.style.display = 'none';
              const hNone = head.getBoundingClientRect().height;
              const tHn = title.getBoundingClientRect().height;
              // The worker's last line, with the badge gone: has the glyph room to its right before the column's edge?
              const workerLast = textRects();
              const wTop = Math.max(...workerLast.map((r) => r.top));
              const wRight = Math.max(...workerLast.filter((r) => r.top >= wTop - 1).map((r) => r.right));
              badge.style.display = '';
              const need = br.width + parseFloat(getComputedStyle(badge).marginInlineStart);
              const titleBox = title.getBoundingClientRect();
              // Room means clearly: a glyph that fits to within a pixel is decided by sub-pixel widths, so it counts as no room.
              const room = wRight + need + 1 <= titleBox.left + title.clientWidth;
              const extra = h - hNone;
              checked += 1;
              if (extra > 0.5) taller += 1;
              if (!inLine || (extra > 0.5 && room)) fails.push({ kind, len, inLine, extra: Math.round(extra * 100) / 100, room, dbg: `title ${tH} vs ${tHn}, worker right ${Math.round(wRight)}, limit ${Math.round(titleBox.left + title.clientWidth)}, need ${need}, head ${h} vs ${hNone}` });
            }
          }
          return { drawn: true, checked, fails, taller };
        });
        expect(result.drawn, 'the header draws the badge, glued in its own box').toBe(true);
        expect(result.checked, 'every length was measured').toBe(260);
        const shown = result.fails.slice(0, 10).map((f) => `${f.kind}:${f.len}(${f.inLine ? 'in line' : 'off the last line'}, +${f.extra}px, room ${f.room}, ${f.dbg})`).join(' | ');
        expect(result.fails.length, `${result.fails.length} of 260 names put the badge off the name's last line or make the header taller with room to spare: ${shown}`).toBe(0);
        // The cases where the glyph truly had no room are few: the sweep reports them, and they are bounded by one line each.
        expect(result.taller, 'names whose last line leaves no room for the glyph').toBeLessThan(40);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});

// D-8834: the looks of the session header, for the note and the PR. When `CCRC_SHOTS` names a directory (outside the work
// tree, or the task's `docs/design/…/c51/` folder) and `CCRC_SHOT_TAG` a word (`before` or `after`), each case below also
// writes the coordinator's header there, with its details open, and, below the desk, closed too. Without `CCRC_SHOTS` no case
// is registered, so the suite is unchanged.
const SHOTS = process.env['CCRC_SHOTS'] ?? '';
const SHOT_TAG = process.env['CCRC_SHOT_TAG'] ?? 'after';
if (SHOTS !== '') describe('D-8834: the session header screenshots (opt in)', () => {
  for (const { skin, theme, width } of [INSTRUMENT, REFINED].flatMap((skin) =>
    THEMES.flatMap((theme) => [360, 1280].map((width) => ({ skin, theme, width }))))) {
    it(`${skin}, ${theme}, ${width}px: the coordinator's header`, async () => {
      const { ctx, page, errors } = await openApp(browser!, { skin, theme, width } as AppView, HEAD_FIXTURE);
      try {
        await page.goto(server!.origin + `/s/${PROJECT}-head-coord`);
        await page.waitForSelector('.chat-head', { timeout: 20_000 });
        await page.evaluate(async () => { await document.fonts.ready; });
        await page.waitForTimeout(300);
        const name = `${SHOT_TAG}-header-${skin}-${theme}-${width}`;
        const toggle = page.getByRole('button', { name: /details/i });
        if (await toggle.count() > 0) {
          await page.locator('.chat-head').screenshot({ path: `${SHOTS}/${name}-closed.png` });
          if ((await toggle.first().getAttribute('aria-expanded')) === 'false') await toggle.first().click();
          await page.waitForTimeout(300);
        }
        await page.locator('.chat-head').screenshot({ path: `${SHOTS}/${name}.png` });
        // A long name that wraps in every view (review 2963: the first screenshots all used one 10-character name). The name's text
        // is replaced in the page, in the app's own markup: the head's text node, and the glue's one character beside the badge.
        await page.evaluate(() => {
          const nameEl = document.querySelector<HTMLElement>('.chat-head .chat-title-text')!;
          const chars = Array.from('garden stone silver harbor morning cedars quiet river nimble copper lantern meadow willow granite amber falcon');
          const last = chars.pop() ?? '';
          (nameEl.firstChild as Text).data = chars.join('');
          (nameEl.querySelector('.chat-title-glue')!.firstChild as Text).data = last;
        });
        await page.waitForTimeout(200);
        await page.locator('.chat-head').screenshot({ path: `${SHOTS}/${name}-longname.png` });
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
