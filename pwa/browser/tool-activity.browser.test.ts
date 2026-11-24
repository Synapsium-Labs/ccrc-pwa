// One collapsed row per stretch of a turn's tool activity (desktop polish wave 168), in a real Chrome over the production
// build, with the real virtual list.
//
// jsdom lays nothing out and replaces virtuoso, so this file holds what only Chrome can: over a long, tool-heavy session
// in both skins, both palettes, at a phone's and a desk's width, the newest stretch reads as ONE collapsed line with its
// failed call surfaced under it; calls arriving in that closed stretch while the reader is scrolled up leave it closed
// and move nothing the reader is looking at; the row opens in place into the cards (Refined's run groups, Instrument's
// tool cards) with no sideways scroll; and the reader's open row is still open after the list unmounted it on a scroll
// to the top and mounted it again on the way back.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/tool-activity.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [PHOSPHOR, 'light'].flatMap((theme) =>
  [390, 1280].map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

// ---- the fixture: one session, neutral names ----------------------------------------------------------------------
const NOW = 1_792_362_479;
const SESSION = {
  id: 'project-a-one', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a/one',
  workspace: 'one', name: 'one', status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: 'ws/one', ctxPct: null, paneCols: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null,
  subagents: null, background: null, withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'working',
  unmeasured: [], started: true, child: { kind: 'none' },
};
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': {
      accounts: [{
        wrapper: 'lane-a', five: 40, seven: 50, ts: NOW, fiveResetAt: NOW + 7_800, sevenResetAt: NOW + 259_800,
        fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
      }],
      projected: null,
      roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', pool: null, homeAble: true, hidden: false }],
    },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': [], '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: [SESSION] }],
};

const TS = new Date((NOW - 600) * 1000).toISOString();
/** A command wider than any column. */
const LONG_COMMAND = `cd /w/project-a && ${'npm run check-everything-in-the-workspace '.repeat(4)}--reporter=verbose`;
let k = 0;
const call = (into: object[], name: string, input: object, isError = false): void => {
  k += 1;
  into.push({ kind: 'tool_use', uuid: `u${k}`, ts: TS, toolId: `t${k}`, name, input: JSON.stringify(input) });
  into.push({ kind: 'tool_result', ts: TS, toolId: `t${k}`, text: isError ? 'exit 1' : 'ok', isError });
};
/** TURNS turns of prose and tools mixed, long enough that the list unmounts its top rows at the bottom; the last turn
 *  ends on a stretch of three calls, the middle one failed, so an append lands in that stretch. */
const TURNS = 24;
const EVENTS: object[] = [];
for (let i = 0; i < TURNS; i += 1) {
  EVENTS.push({ kind: 'user', uuid: `q${i}`, ts: TS, text: `Run step ${i}.` });
  EVENTS.push({ kind: 'assistant', uuid: `a${i}`, ts: TS, text: `Reading for step ${i}, then running it.` });
  call(EVENTS, 'Read', { file_path: `/w/project-a/src/a${i}.ts` });
  call(EVENTS, 'Bash', { command: LONG_COMMAND });
  call(EVENTS, 'Edit', { file_path: `/w/project-a/src/a${i}.ts`, old_string: 'a', new_string: 'b' });
  EVENTS.push({ kind: 'assistant', uuid: `b${i}`, ts: TS, text: `Step ${i} is done.` });
}
EVENTS.push({ kind: 'user', uuid: 'q-last', ts: TS, text: 'Last step.' });
EVENTS.push({ kind: 'assistant', uuid: 'a-last', ts: TS, text: 'Checking first.' });
call(EVENTS, 'Read', { file_path: '/w/project-a/src/last.ts' });
call(EVENTS, 'Bash', { command: 'npm test' }, true);
call(EVENTS, 'Read', { file_path: '/w/project-a/src/after.ts' });
/** Two calls that arrive later, in the last stretch. */
const LATER: object[] = [];
call(LATER, 'Grep', { pattern: 'useSkin' });
call(LATER, 'Bash', { command: 'git status' });

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

/** The newest tool-activity row on screen, and what the reader sees of it. */
async function newest(page: Page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('.tool-activity')];
    const row = rows[rows.length - 1];
    const button = row?.querySelector<HTMLElement>('.tool-activity-row');
    return row === undefined || button === null || button === undefined ? null : {
      text: button.textContent ?? '',
      expanded: button.getAttribute('aria-expanded'),
      height: Math.round(button.getBoundingClientRect().height),
      failedSurfaced: row.querySelector('.tool-activity-first[data-attention="failed"] .tool-dot--err') !== null,
    };
  });
}

/** Scroll the transcript to a place and give the virtual list time to settle there. */
async function scrollTo(page: Page, where: 'top' | 'middle' | 'bottom'): Promise<void> {
  await page.evaluate((w) => {
    const s = document.querySelector<HTMLElement>('.chat-scroller')!;
    s.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: w === 'bottom' ? 100 : -100 }));
    s.scrollTop = w === 'top' ? 0 : w === 'middle' ? Math.round((s.scrollHeight - s.clientHeight) / 2) : s.scrollHeight;
  }, where);
  await page.waitForTimeout(600);
}

describe('one collapsed row per stretch of tool activity (desktop polish wave 168)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        let send: ((frame: object) => void) | null = null;
        await ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
          send = (frame) => ws.send(JSON.stringify(frame));
          send({
            type: 'backlog', uuid: 'u-1', events: EVENTS, offset: 1, file: '/w/t.jsonl', missing: false,
            searchComplete: true, fileMeasured: true,
          });
        });
        await page.goto(`${server!.origin}/s/${SESSION.id}`);
        await page.waitForSelector('.tool-activity-row', { timeout: 20_000 });
        await page.waitForTimeout(600);

        // Collapsed by default, one line, its words, and its failed call surfaced under it.
        const tapMin = await page.evaluate(() =>
          Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')));
        let last = await newest(page);
        expect(last, 'no tool-activity row on screen').not.toBeNull();
        expect(last!.expanded).toBe('false');
        expect(last!.text).toContain('Tool activity');
        expect(last!.text).toContain('3 calls');
        expect(last!.text).toContain('1 failed');
        expect(last!.height, 'the row is not one line').toBeLessThanOrEqual(Math.ceil(tapMin) + 1);
        expect(last!.failedSurfaced, 'the failed call is not surfaced on the collapsed row').toBe(true);
        // Collapsed, no tool card is drawn outside the surfaced one.
        const loose = await page.evaluate(() =>
          [...document.querySelectorAll('.toolcard')].filter((c) => c.closest('.tool-activity-first') === null).length);
        expect(loose, 'a tool card is drawn outside a collapsed row').toBe(0);

        // Calls arrive in the closed stretch while the reader is scrolled up: nothing they look at moves.
        await scrollTo(page, 'middle');
        const anchor = async () => page.evaluate(() => {
          const s = document.querySelector<HTMLElement>('.chat-scroller')!;
          const top = s.getBoundingClientRect().top;
          const item = [...s.querySelectorAll<HTMLElement>('.chat-item')].find((el) => el.getBoundingClientRect().top >= top);
          return { scrollTop: Math.round(s.scrollTop), text: item?.textContent ?? '', at: Math.round((item?.getBoundingClientRect().top ?? 0) - top) };
        });
        const before = await anchor();
        expect(before.text, 'no row in view at the middle').not.toBe('');
        expect(send, 'the session socket never opened').not.toBeNull();
        send!({ type: 'events', uuid: 'u-1', events: LATER, offset: 2 });
        await page.waitForTimeout(800);
        const after = await anchor();
        expect(after.text, 'the row in view changed').toBe(before.text);
        expect(Math.abs(after.at - before.at), 'the row in view moved').toBeLessThanOrEqual(1);
        expect(Math.abs(after.scrollTop - before.scrollTop), 'the scroll position moved').toBeLessThanOrEqual(1);
        await scrollTo(page, 'bottom');
        last = await newest(page);
        expect(last!.text).toContain('5 calls');
        expect(last!.expanded, 'the arriving calls opened the row').toBe('false');

        // Opened, the row shows the cards in place, held to the column.
        await page.locator('.tool-activity-row').last().click();
        await page.waitForTimeout(300);
        const opened = await page.evaluate(() => {
          const rows = [...document.querySelectorAll<HTMLElement>('.tool-activity')];
          const body = rows[rows.length - 1]!.querySelector<HTMLElement>('.tool-activity-body');
          const scroller = document.querySelector<HTMLElement>('.chat-scroller')!;
          return {
            groups: body?.querySelectorAll('.ref-tool-group').length ?? -1,
            cards: body?.querySelectorAll('.toolcard').length ?? -1,
            scrollerSide: scroller.scrollWidth - scroller.clientWidth,
            pageSide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        if (view.skin === REFINED) {
          // Read, the failed Bash (alone, as before), and the run after it: Read, Grep, git status.
          expect(opened.groups, "Refined's run groups are inside the opened row").toBe(2);
        } else {
          expect(opened.cards, "Instrument's five tool cards are inside the opened row").toBe(5);
        }
        expect(opened.scrollerSide, 'the transcript has no sideways scroll').toBe(0);
        expect(opened.pageSide, 'the page has no sideways scroll').toBe(0);

        // The reader's choice outlives the list unmounting the row.
        await scrollTo(page, 'top');
        const openAtTop = await page.locator('.tool-activity-row[aria-expanded="true"]').count();
        expect(openAtTop, 'the opened row is still mounted at the top: the transcript is too short to test this').toBe(0);
        await scrollTo(page, 'bottom');
        last = await newest(page);
        expect(last!.expanded, 'the opened row closed after a scroll away and back').toBe('true');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});

// ---- review 3450: the live row at a phone's width, and a live row that grows ----------------------------------------
/** The turns before the live one: long enough to scroll, every call answered. */
const HISTORY: object[] = EVENTS.slice(0, EVENTS.findIndex((e) => (e as { uuid?: string }).uuid === 'q-last'));
/** A last turn whose stretch is live: an answered Read, a Bash that failed (unless `failed` is false: then it passed),
 *  and a Bash still running, which the F4 cases hold an approval for. */
const LIVE_TURN = (failed = true): { events: object[]; running: string } => {
  const events: object[] = [...HISTORY];
  events.push({ kind: 'user', uuid: 'q-live', ts: TS, text: 'Publish it.' });
  events.push({ kind: 'assistant', uuid: 'a-live', ts: TS, text: 'Building, then publishing.' });
  call(events, 'Read', { file_path: '/w/project-a/src/publish.ts' });
  call(events, 'Bash', { command: 'npm run build' }, failed);
  k += 1;
  const running = `t${k}`;
  events.push({ kind: 'tool_use', uuid: `u${k}`, ts: TS, toolId: running, name: 'Bash', input: JSON.stringify({ command: 'npm publish' }) });
  return { events, running };
};
const APPROVAL = { type: 'ask', ask: { approval: { tool: 'Bash', summary: 'npm publish' } } };

/** Open the session with `events`, and hand back the socket's sender. */
async function openSession(page: Page, ctx: Awaited<ReturnType<typeof openApp>>['ctx'], events: object[], frames: object[] = []) {
  let send: ((frame: object) => void) | null = null;
  await ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
    send = (frame) => ws.send(JSON.stringify(frame));
    send({
      type: 'backlog', uuid: 'u-1', events, offset: 1, file: '/w/t.jsonl', missing: false, searchComplete: true, fileMeasured: true,
    });
    for (const f of frames) send(f);
  });
  await page.goto(`${server!.origin}/s/${SESSION.id}`);
  await page.waitForSelector('.tool-activity-row', { timeout: 20_000 });
  await page.waitForTimeout(800);
  return (frame: object): void => { expect(send, 'the session socket never opened').not.toBeNull(); send!(frame); };
}

/** How far the reader is from the foot of the transcript, in px, and the row at the top of the view. */
async function position(page: Page) {
  return page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('.chat-scroller')!;
    const top = s.getBoundingClientRect().top;
    const item = [...s.querySelectorAll<HTMLElement>('.chat-item')].find((el) => el.getBoundingClientRect().top >= top);
    return {
      fromFoot: Math.round(s.scrollHeight - s.scrollTop - s.clientHeight),
      text: item?.textContent ?? '',
      at: Math.round((item?.getBoundingClientRect().top ?? 0) - top),
      pill: document.querySelector('.jump-latest') !== null,
    };
  });
}

const NARROW: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [PHOSPHOR, 'light'].flatMap((theme) =>
  [360, 390].map((width) => ({ skin, theme, width }))));

describe('the live row fits a phone column with its flags (review 3450 F4)', () => {
  for (const view of NARROW) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await openSession(page, ctx, LIVE_TURN().events, [APPROVAL]);
        const m = await page.evaluate(() => {
          const rows = [...document.querySelectorAll<HTMLElement>('.tool-activity')];
          const box = rows[rows.length - 1]!;
          const button = box.querySelector<HTMLElement>('.tool-activity-row')!;
          const right = button.getBoundingClientRect().right;
          const scroller = document.querySelector<HTMLElement>('.chat-scroller')!;
          const flags = [...button.querySelectorAll<HTMLElement>('.tool-activity-flag')];
          return {
            text: button.textContent ?? '',
            overflow: button.scrollWidth - button.clientWidth,
            rowPastColumn: Math.round(right - scroller.getBoundingClientRect().right),
            flags: flags.map((f) => ({
              text: f.textContent ?? '',
              cut: f.scrollWidth - f.clientWidth,
              past: Math.round(f.getBoundingClientRect().right - right),
            })),
            wait: box.querySelector('.tool-activity-wait')?.textContent ?? null,
            control: (() => {
              const c = box.querySelector<HTMLElement>('.tool-activity-wait .tool-activity-answer');
              if (c === null) return null;
              const r = c.getBoundingClientRect();
              return {
                height: Math.round(r.height),
                past: Math.round(r.right - scroller.getBoundingClientRect().right),
                cut: c.scrollWidth - c.clientWidth,
                tapMin: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')),
              };
            })(),
            scrollerSide: scroller.scrollWidth - scroller.clientWidth,
            pageSide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        console.log(`F4 ${named(view)}: ${JSON.stringify(m)}`);
        expect(m.text).toContain('running');
        expect(m.flags.map((f) => f.text.trim())).toEqual(['waiting on you', '1 failed']);
        expect(m.overflow, 'the row overflows its own box').toBeLessThanOrEqual(0);
        expect(m.rowPastColumn, 'the row passes the column').toBeLessThanOrEqual(0);
        for (const f of m.flags) {
          expect(f.cut, `flag "${f.text}" is cut`).toBeLessThanOrEqual(0);
          expect(f.past, `flag "${f.text}" is past the row's edge`).toBeLessThanOrEqual(0);
        }
        expect(m.wait, 'the live wait line is not drawn').toContain('waiting for you');
        // The wait's one control (review 3478 A3): there, inside the column, uncut, at least the tap minimum tall.
        expect(m.control, 'the wait line has no control').not.toBeNull();
        expect(m.control!.past, 'the control passes the column').toBeLessThanOrEqual(0);
        expect(m.control!.cut, 'the control\'s word is cut').toBeLessThanOrEqual(0);
        expect(m.control!.height, 'the control is under the tap minimum').toBeGreaterThanOrEqual(Math.floor(m.control!.tapMin));
        // Reached by the keyboard from the row before it, with a visible focus and its name. At a phone's width the
        // approval's sheet is up over the transcript, which the app hides from assistive technology behind it; the
        // transcript's control is what the reader uses once they close the sheet, so it is measured then.
        await page.keyboard.press('Escape');
        await expect.poll(() => page.locator('[role="dialog"]').count(), 'the sheet did not close').toBe(0);
        await page.locator('.tool-activity-row').last().focus();
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          const style = el === null ? null : getComputedStyle(el);
          return el === null ? null : {
            isControl: el.matches('.tool-activity-wait .tool-activity-answer'),
            visible: el.matches(':focus-visible'),
            outline: style!.outlineStyle === 'none' ? 0 : Number.parseFloat(style!.outlineWidth),
            hidden: el.closest('[aria-hidden="true"], [inert]') !== null,
          };
        });
        expect(focus?.isControl, 'Tab from the row does not reach the wait control').toBe(true);
        expect(focus?.visible, 'the control\'s focus is not visible').toBe(true);
        expect(focus?.outline, 'the control draws no focus ring').toBeGreaterThan(0);
        expect(focus?.hidden, 'the control is hidden from assistive technology').toBe(false);
        expect(await page.locator('.tool-activity-wait').last().getByRole('button', { name: 'Answer', exact: true }).count(),
          'the control has no accessible name "Answer"').toBe(1);
        expect(m.scrollerSide, 'the transcript has no sideways scroll').toBe(0);
        expect(m.pageSide, 'the page has no sideways scroll').toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});

const GROWTH: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [390, 1280].map((width) => ({ skin, theme: PHOSPHOR, width })));

describe('a live row that changes size keeps the reader where they were (review 3450 F5, A5)', () => {
  for (const view of GROWTH) {
    it(`${named(view)}: opened, calls arrive; closed, a failure surfaces`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        const { events, running } = LIVE_TURN(false);
        const send = await openSession(page, ctx, events);
        const lastRowHeight = async (): Promise<number> => page.evaluate(() => {
          const rows = [...document.querySelectorAll<HTMLElement>('.tool-activity')];
          return Math.round(rows[rows.length - 1]!.getBoundingClientRect().height);
        });
        /** `n` calls arriving after the running one; with `settle`, the running one's result first. */
        const more = (n: number, failLast: boolean, settle = true): object[] => {
          const out: object[] = settle ? [{ kind: 'tool_result', ts: TS, toolId: running, text: 'ok', isError: false }] : [];
          for (let i = 0; i < n; i += 1) call(out, 'Grep', { pattern: `p${k}` }, failLast && i === n - 1);
          return out;
        };
        const height = async (): Promise<number> => page.evaluate(() => document.querySelector('.chat-scroller')!.scrollHeight);
        let offset = 2;
        // 1. At the foot, the live row opened by the reader: calls arrive in it, and it changes size.
        await scrollTo(page, 'bottom');
        await page.locator('.tool-activity-row').last().click();
        await page.waitForTimeout(400);
        await scrollTo(page, 'bottom');
        const atFootOpen = await position(page);
        const openBefore = await lastRowHeight();
        // The running call keeps running, so the arriving calls add rows in both skins (review 3478 F7: a Refined row
        // whose running call settled joined its neighbours' run group and SHRANK, which a clamp at the foot hides).
        send({ type: 'events', uuid: 'u-1', events: more(4, false, false), offset: offset++ });
        await page.waitForTimeout(1000);
        const afterOpen = await position(page);
        const openGrew = (await lastRowHeight()) - openBefore;
        // 2. At the foot, a closed live row: a failure arrives and its card surfaces under the row.
        await page.locator('.tool-activity-row').last().click(); // close it
        await page.waitForTimeout(300);
        await scrollTo(page, 'bottom');
        const atFootClosed = await position(page);
        const closedBefore = await lastRowHeight();
        const failing: object[] = [];
        call(failing, 'Bash', { command: 'npm audit' }, true); // the stretch's first failure: its card surfaces
        send({ type: 'events', uuid: 'u-1', events: failing, offset: offset++ });
        await page.waitForTimeout(1000);
        const afterClosed = await position(page);
        const closedGrew = (await lastRowHeight()) - closedBefore;
        // 3. Higher up, with the live row still mounted below (review 3478 F6): it grows, and the row the reader is reading
        // does not move.
        await page.locator('.tool-activity-row').last().click(); // open again
        await page.waitForTimeout(700);
        await scrollTo(page, 'bottom');
        await page.evaluate(() => { document.querySelector<HTMLElement>('.chat-scroller')!.scrollTop -= 500; });
        await page.waitForTimeout(600);
        const midBefore = await position(page);
        const midHeight = await height();
        send({ type: 'events', uuid: 'u-1', events: more(3, true, false), offset: offset++ });
        await page.waitForTimeout(1000);
        const midAfter = await position(page);
        const midGrew = (await height()) - midHeight;
        console.log(`F5 ${named(view)}: ${JSON.stringify({ atFootOpen, afterOpen, openGrew, atFootClosed, afterClosed, closedGrew, midBefore, midAfter, midGrew })}`);
        expect(openGrew, 'the opened live row did not grow: the case measures nothing').toBeGreaterThan(0);
        expect(closedGrew, 'no failure card surfaced under the closed row: the case measures nothing').toBeGreaterThan(0);
        expect(atFootOpen.fromFoot, 'not at the foot before the opened row grew').toBeLessThanOrEqual(2);
        expect(afterOpen.fromFoot, 'the opened live row grew and the reader left the foot').toBeLessThanOrEqual(2);
        expect(atFootClosed.fromFoot, 'not at the foot before the failure surfaced').toBeLessThanOrEqual(2);
        expect(afterClosed.fromFoot, 'a failure surfaced and the reader left the foot').toBeLessThanOrEqual(2);
        expect(midBefore.fromFoot, 'the reader is not above the foot').toBeGreaterThan(100);
        expect(midGrew, 'nothing changed size while the reader was higher up: the case measures nothing').not.toBe(0);
        expect(midAfter.fromFoot, 'the reader higher up was taken to the foot').toBeGreaterThan(100);
        expect(midAfter.text, 'the row in view changed').toBe(midBefore.text);
        expect(Math.abs(midAfter.at - midBefore.at), 'the row in view moved').toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});

// ---- review 3478: a tap is the reader's, and a row above the reader that grows -------------------------------------
/** An answered question: its card stands alone in both skins, a few lines tall. */
const answered = (into: object[], question: string): void => {
  k += 1;
  into.push({
    kind: 'tool_use', uuid: `u${k}`, ts: TS, toolId: `t${k}`, name: 'AskUserQuestion',
    input: JSON.stringify({ questions: [{ question, header: 'Pick', options: [{ label: 'Ink' }, { label: 'Paper' }] }] }),
  });
  into.push({ kind: 'tool_result', ts: TS, toolId: `t${k}`, text: `User has answered your questions: "${question}"="Ink".`, isError: false });
};
/** A last turn whose one stretch, opened, is taller than any viewport: answered questions between reads. */
const TALL_TURN = (): object[] => {
  const events: object[] = [...HISTORY];
  events.push({ kind: 'user', uuid: 'q-tall', ts: TS, text: 'Ask me everything.' });
  events.push({ kind: 'assistant', uuid: 'a-tall', ts: TS, text: 'A few questions first.' });
  for (let i = 0; i < 14; i += 1) {
    answered(events, `Which way for part ${i} of the change, the first or the second?`);
    call(events, 'Read', { file_path: `/w/project-a/src/part${i}.ts` });
  }
  return events;
};

describe('opening a row at the foot leaves the header the reader tapped where it was (review 3478 F5)', () => {
  for (const view of GROWTH) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await openSession(page, ctx, TALL_TURN());
        await scrollTo(page, 'bottom');
        const header = async () => page.evaluate(() => {
          const s = document.querySelector<HTMLElement>('.chat-scroller')!;
          const rows = [...document.querySelectorAll<HTMLElement>('.tool-activity-row')];
          const row = rows[rows.length - 1]!;
          return {
            at: Math.round(row.getBoundingClientRect().top - s.getBoundingClientRect().top),
            box: Math.round(row.closest('.tool-activity')!.getBoundingClientRect().height),
            view: s.clientHeight,
            fromFoot: Math.round(s.scrollHeight - s.scrollTop - s.clientHeight),
          };
        });
        const before = await header();
        await page.locator('.tool-activity-row').last().click();
        await page.waitForTimeout(1200);
        const after = await header();
        console.log(`F5 tap ${named(view)}: ${JSON.stringify({ before, after })}`);
        expect(before.fromFoot, 'not at the foot before the tap').toBeLessThanOrEqual(2);
        expect(after.box, 'the opened stretch is not taller than the view: the case measures nothing').toBeGreaterThan(after.view);
        expect(Math.abs(after.at - before.at), 'the header the reader tapped moved').toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});

describe('a row above the reader that changes size moves nothing they read (review 3478 F6)', () => {
  for (const view of GROWTH) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        // The current turn: a stretch whose Bash is still running, prose, then a tall stretch the reader opens and reads.
        const events: object[] = [...HISTORY];
        events.push({ kind: 'user', uuid: 'q-above', ts: TS, text: 'Check both.' });
        call(events, 'Read', { file_path: '/w/project-a/src/slow.ts' });
        k += 1;
        const slow = `t${k}`;
        events.push({ kind: 'tool_use', uuid: `u${k}`, ts: TS, toolId: slow, name: 'Bash', input: JSON.stringify({ command: 'npm run slow' }) });
        events.push({ kind: 'assistant', uuid: 'a-above', ts: TS, text: 'While that runs, a few questions.' });
        for (let i = 0; i < 10; i += 1) {
          answered(events, `Which way for part ${i} of the change, the first or the second?`);
          call(events, 'Read', { file_path: `/w/project-a/src/part${i}.ts` });
        }
        events.push({ kind: 'assistant', uuid: 'b-above', ts: TS, text: 'Questions done.' });
        const send = await openSession(page, ctx, events);
        await scrollTo(page, 'bottom');
        await page.locator('.tool-activity-row').last().click();
        await page.waitForTimeout(800);
        // Read inside the opened stretch, the running stretch out of view above.
        await page.evaluate(() => {
          const s = document.querySelector<HTMLElement>('.chat-scroller')!;
          const rows = [...document.querySelectorAll<HTMLElement>('.tool-activity')];
          const tall = rows[rows.length - 1]!;
          s.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
          s.scrollTop += tall.getBoundingClientRect().top - s.getBoundingClientRect().top + 200;
        });
        await page.waitForTimeout(600);
        const reading = async () => page.evaluate(() => {
          const s = document.querySelector<HTMLElement>('.chat-scroller')!;
          const top = s.getBoundingClientRect().top;
          const card = [...s.querySelectorAll<HTMLElement>('.tool-activity-body .tool-ask, .tool-activity-body .toolcard, .tool-activity-body .ref-tool-group')]
            .find((el) => el.getBoundingClientRect().top >= top);
          const rows = [...document.querySelectorAll<HTMLElement>('.tool-activity')];
          const above = rows[rows.length - 2];
          return {
            text: card?.textContent ?? '',
            at: Math.round((card?.getBoundingClientRect().top ?? 0) - top),
            fromFoot: Math.round(s.scrollHeight - s.scrollTop - s.clientHeight),
            aboveBottom: above === undefined ? null : Math.round(above.getBoundingClientRect().bottom - top),
            aboveHeight: above === undefined ? null : Math.round(above.getBoundingClientRect().height),
          };
        });
        const before = await reading();
        // The running call fails: its card surfaces under its closed row, above the reader.
        send({ type: 'events', uuid: 'u-1', events: [{ kind: 'tool_result', ts: TS, toolId: slow, text: 'exit 1', isError: true }], offset: 2 });
        await page.waitForTimeout(1000);
        const after = await reading();
        console.log(`F6 above ${named(view)}: ${JSON.stringify({ before, after })}`);
        expect(before.text, 'no card in view inside the opened stretch').not.toBe('');
        expect(before.aboveBottom, 'the growing row is not above the reader').not.toBeNull();
        expect(before.aboveBottom!, 'the growing row is not above the reader').toBeLessThanOrEqual(0);
        expect(after.aboveHeight! - before.aboveHeight!, 'the row above did not grow: the case measures nothing').toBeGreaterThan(0);
        expect(after.text, 'the card in view changed').toBe(before.text);
        expect(Math.abs(after.at - before.at), 'the card in view moved').toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
