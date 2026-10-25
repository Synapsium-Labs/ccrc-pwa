// The shared half of the wheel-chain browser files (D-6437, desktop polish Task C5): one session with neutral names, a
// backlog of prose, code blocks, tool cards and answer chips, and the helpers that open it in a real Chrome over the
// production build, put the pointer over one box, wheel once and read the settled before and after. Not a test file
// (no `*.browser.test.*` in its name, so the browser config does not collect it); `wheel-chain.browser.test.ts`
// (code blocks, the sideways wheel and the control), `wheel-chain-well.browser.test.ts` (the tall tool well) and
// `wheel-chain-chip.browser.test.ts` (the answer chips) import it. They are split by box because vitest runs the
// cases of one file serially and CI's browser job has a fixed timeout, while files run in parallel. Each file builds
// and serves `dist` in its own `beforeAll` and hands its Chrome and server to the helpers as a `Rig`.
import { expect } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { openApp, type AppFixture, type AppView, type DistServer } from './app';

/** What a file's `beforeAll` leaves behind: its Chrome and the server for its own build of the app. */
export interface Rig { browser: Browser; server: DistServer }

export const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [PHOSPHOR, 'light'].flatMap((theme) =>
  [1280, 1920].map((width) => ({ skin, theme, width }))));
export const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

// ---- the fixture: one session, neutral names ----------------------------------------------------------------------
const NOW = 1_792_362_479;
export const SESSION = {
  id: 'project-a-one', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a/one',
  workspace: 'one', name: 'one', status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: 'ws/one', ctxPct: null, paneCols: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null,
  subagents: null, background: null, withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'working',
  unmeasured: [], started: true, child: { kind: 'none' },
};
export const FIXTURE: AppFixture = {
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
export const EVENTS: object[] = [];
let n = 0;
const say = (text: string): void => {
  n += 1;
  EVENTS.push({ kind: 'assistant', uuid: `a${n}`, ts: TS, text });
};
/** A paragraph tall enough (a few wrapped lines) that the rows between the boxes give the transcript room to move. */
const prose = (label: string): void => say(
  `${label}: the checks for project-a ran in lane-a and nothing in the output needed a second look. `
  + 'Each step wrote its result to the log, the log was read from the top, and the summary below repeats only what '
  + 'changed since the last run. Nothing else in the workspace moved while they ran.');
const fence = (lines: string[]): string => `\`\`\`\n${lines.join('\n')}\n\`\`\``;

EVENTS.push({ kind: 'user', uuid: 'q1', ts: TS, text: 'Run the checks.' });
for (let i = 1; i <= 6; i += 1) prose(`Prose before ${i}`);
say(`Three lines:\n\n${fence(['fit-line-1 alpha', 'fit-line-2 beta', 'fit-line-3 gamma'])}`);
for (let i = 1; i <= 5; i += 1) prose(`Prose after fit ${i}`);
say(`One long line:\n\n${fence([`wide-${'x'.repeat(295)}`])}`);
for (let i = 1; i <= 5; i += 1) prose(`Prose after wide ${i}`);
say(`Sixty lines:\n\n${fence(Array.from({ length: 60 }, (_, i) => `tall-line-${String(i + 1).padStart(2, '0')} omega`))}`);
for (let i = 1; i <= 5; i += 1) prose(`Prose after tall ${i}`);
EVENTS.push({ kind: 'tool_use', uuid: 'u1', ts: TS, toolId: 't1', name: 'Bash', input: JSON.stringify({ command: 'npm run check' }) });
EVENTS.push({ kind: 'tool_result', ts: TS, toolId: 't1', text: 'result-line-1 ok\nresult-line-2 ok', isError: false });
for (let i = 1; i <= 8; i += 1) prose(`Prose after the card ${i}`);
// A second Bash card whose result is sixty lines (taller than `--well-max`), and two AskUserQuestion cards whose answer
// chips are a one-line reply that fits and a typed reply of 150 words that wraps well past `--well-max`. The harness
// parses `"<question>"=(no option selected) notes: <typed reply>` into the chip (`tool-card.tsx`'s `askAnswers`).
EVENTS.push({ kind: 'tool_use', uuid: 'u2', ts: TS, toolId: 't2', name: 'Bash', input: JSON.stringify({ command: 'npm run tall-check' }) });
EVENTS.push({
  kind: 'tool_result', ts: TS, toolId: 't2', isError: false,
  text: Array.from({ length: 60 }, (_, i) => `tallwell-line-${String(i + 1).padStart(2, '0')} omega`).join('\n'),
});
for (let i = 1; i <= 5; i += 1) prose(`Prose after the tall well ${i}`);
const ask = (id: string, question: string, reply: string): void => {
  EVENTS.push({
    kind: 'tool_use', uuid: `u${id}`, ts: TS, toolId: id, name: 'AskUserQuestion',
    input: JSON.stringify({ questions: [{ question, header: 'Where', multiSelect: false, options: [{ label: 'one', description: 'x' }, { label: 'two', description: 'y' }] }] }),
  });
  EVENTS.push({
    kind: 'tool_result', ts: TS, toolId: id, isError: false,
    text: `Your questions have been answered: "${question}"=(no option selected) notes: ${reply}. You can now continue with these answers.`,
  });
};
ask('t3', 'Which workspace should the short check run in?', 'chipfit-start project-a');
for (let i = 1; i <= 5; i += 1) prose(`Prose after the short chip ${i}`);
ask('t4', 'Which workspace should the long check run in?',
  `chip-start ${Array.from({ length: 150 }, (_, i) => `reply-word-${String(i + 1).padStart(3, '0')}`).join(' ')}`);
for (let i = 1; i <= 8; i += 1) prose(`Prose after the tall chip ${i}`);

// ---- the page half: what each wheel is measured on -----------------------------------------------------------------
export type Kind = 'fit' | 'wide' | 'tall' | 'well' | 'tallwell' | 'chipfit' | 'chip' | 'prose';
export interface Reading { scroller: number; boxTop: number; boxLeft: number; room: { down: number; up: number } }

/** Runs in the page before the app: finds a target by its text (virtuoso unmounts far rows, so every use re-finds it). */
export function installFinder(): void {
  const w = window as unknown as { __c5: Record<string, unknown> };
  const find = (kind: string): HTMLElement | null => {
    const within = (sel: string, text: string): HTMLElement | null =>
      [...document.querySelectorAll<HTMLElement>(sel)].find((e) => (e.textContent ?? '').includes(text)) ?? null;
    if (kind === 'fit') return within('.msg-assist pre', 'fit-line-1');
    if (kind === 'wide') return within('.msg-assist pre', 'wide-');
    if (kind === 'tall') return within('.msg-assist pre', 'tall-line-01');
    if (kind === 'well') return within('.toolcard pre.well', 'result-line-1');
    if (kind === 'tallwell') return within('.toolcard pre.well', 'tallwell-line-01');
    if (kind === 'chipfit') return within('.tool-ask-a', 'chipfit-start');
    if (kind === 'chip') return within('.tool-ask-a', 'chip-start');
    return within('.msg-assist p', 'Prose after tall 2');
  };
  w.__c5 = { find };
}

export async function reading(page: Page, kind: Kind): Promise<Reading | null> {
  return page.evaluate(([k]) => {
    const f = (window as unknown as { __c5: { find: (kind: string) => HTMLElement | null } }).__c5.find;
    const sc = document.querySelector<HTMLElement>('.chat-scroller');
    const box = f(k);
    if (!sc || !box) return null;
    return {
      scroller: sc.scrollTop, boxTop: box.scrollTop, boxLeft: box.scrollLeft,
      room: { down: sc.scrollHeight - sc.clientHeight - sc.scrollTop, up: sc.scrollTop },
    };
  }, [kind] as const);
}

/** Wait until the scroller's and the box's positions agree across eight consecutive reads 50 ms apart. */
export async function settle(page: Page, kind: Kind): Promise<Reading> {
  let same = 0;
  let last = '';
  let r: Reading | null = null;
  for (let i = 0; i < 160 && same < 8; i += 1) {
    r = await reading(page, kind);
    const key = JSON.stringify(r === null ? null : [r.scroller, r.boxTop, r.boxLeft]);
    same = key === last && r !== null ? same + 1 : 0;
    last = key;
    await page.waitForTimeout(50);
  }
  if (r === null || same < 8) throw new Error(`the ${kind} target did not settle (harness failure, not a wheel result)`);
  return r;
}

/** Bring the target to the middle of the scroller. Virtuoso re-measures rows as they mount, so one jump can land
 *  elsewhere: repeat until the target's centre sits within 8 px of the scroller's centre on three reads in a row,
 *  searching upward from the bottom while the row is not mounted. */
export async function reveal(page: Page, kind: Kind): Promise<void> {
  let centred = 0;
  for (let i = 0; i < 120 && centred < 3; i += 1) {
    const r = await page.evaluate(([k]) => {
      const f = (window as unknown as { __c5: { find: (kind: string) => HTMLElement | null } }).__c5.find;
      const sc = document.querySelector<HTMLElement>('.chat-scroller')!;
      const box = f(k);
      if (!box) {
        sc.scrollTop = Math.max(0, sc.scrollTop - 500);
        return { state: sc.scrollTop === 0 ? 'absent' : 'searching', off: 0 };
      }
      const b = box.getBoundingClientRect();
      const s = sc.getBoundingClientRect();
      const off = b.top + b.height / 2 - (s.top + s.height / 2);
      if (Math.abs(off) >= 8) sc.scrollTop += off;
      return { state: 'found', off };
    }, [kind] as const);
    await page.waitForTimeout(150);
    if (r.state === 'absent') break;
    centred = r.state === 'found' && Math.abs(r.off) < 8 ? centred + 1 : 0;
  }
  if (centred < 3) throw new Error(`the ${kind} target could not be centred in the transcript (harness failure)`);
}

/** Open the Bash card whose summary holds `command`: Refined first opens the run's group, then the card's own row
 *  (Instrument draws it directly). Every collapsed group in reach is opened until the card is mounted. */
export async function openCard(page: Page, command: string): Promise<void> {
  const card = page.locator('.toolcard', { has: page.locator('.tool-sum', { hasText: command }) });
  const groups = page.locator('.ref-tool-group-row[aria-expanded="false"]');
  for (let i = 0; i < 80 && (await card.count()) === 0; i += 1) {
    if ((await groups.count()) > 0) {
      await groups.first().scrollIntoViewIfNeeded();
      await groups.first().click();
    } else {
      await page.evaluate(() => { const sc = document.querySelector<HTMLElement>('.chat-scroller')!; sc.scrollTop = Math.max(0, sc.scrollTop - 400); });
    }
    await page.waitForTimeout(150);
  }
  const row = card.locator('.tool-row').first();
  await row.scrollIntoViewIfNeeded();
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
  await page.waitForTimeout(500);   // the body opens over 0.24 s
}

export interface Moved { before: Reading; after: Reading; scroller: number; boxTop: number; boxLeft: number }

/** Put the pointer over the target's centre, prove it is there, wheel once, and read the settled before and after. */
export async function wheelOver(page: Page, kind: Kind, dx: number, dy: number): Promise<Moved> {
  const before = await settle(page, kind);
  const box = await page.evaluate(([k]) => {
    const f = (window as unknown as { __c5: { find: (kind: string) => HTMLElement | null } }).__c5.find;
    const el = f(k)!;
    const b = el.getBoundingClientRect();
    const x = b.left + b.width / 2;
    const y = b.top + b.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, over: hit !== null && el.contains(hit), hit: hit?.className?.toString() ?? String(hit) };
  }, [kind] as const);
  expect(box.over, `the pointer at (${Math.round(box.x)}, ${Math.round(box.y)}) is over the ${kind} target, not ${box.hit}`).toBe(true);
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(700);   // Chrome latches a wheel sequence to one scroller until it pauses
  await page.mouse.wheel(dx, dy);
  const after = await settle(page, kind);
  return {
    before, after, scroller: after.scroller - before.scroller, boxTop: after.boxTop - before.boxTop,
    boxLeft: after.boxLeft - before.boxLeft,
  };
}

/** The wheel's direction: down when the transcript has room below the target, up otherwise. */
export function direction(r: Reading): number {
  expect(Math.max(r.room.down, r.room.up), 'the transcript has room to move in some direction').toBeGreaterThan(400);
  return r.room.down > 400 ? 300 : -300;
}

/** One view of one case (`rig`: the calling file's Chrome and served build): the page is opened on the fixture, the
 *  target revealed (the card opened first for a well). */
export async function inView(rig: Rig, view: AppView, kind: Kind, body: (page: Page) => Promise<void>): Promise<void> {
  const { ctx, page, errors } = await openApp(rig.browser, view, FIXTURE);
  try {
    await ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
      ws.send(JSON.stringify({
        type: 'backlog', uuid: 'u-1', events: EVENTS, offset: 1, file: '/w/t.jsonl', missing: false,
        searchComplete: true, fileMeasured: true,
      }));
    });
    await page.addInitScript(installFinder);
    await page.goto(`${rig.server.origin}/s/${SESSION.id}`);
    await page.waitForSelector('.chat-item', { timeout: 20_000 });
    await page.waitForTimeout(500);
    if (kind === 'well') await openCard(page, 'npm run check');
    if (kind === 'tallwell') await openCard(page, 'npm run tall-check');
    await reveal(page, kind);
    await body(page);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
}

export interface Tall {
  readonly kind: Kind;
  /** The box's wrapper, which the sweep nudges (`position: relative; top: k/8 px`, test-only). */
  readonly wrapper: string;
  readonly what: string;
  /** The least scroll range the fixture box must have, past its cap. */
  readonly range: number;
  /** A box that wraps its lines never scrolls sideways: its `scrollWidth` must not pass its `clientWidth`. */
  readonly wraps: boolean;
}

/** One view of the tall-box case: the box takes the wheel while it has room, and with the box at its end the FIRST wheel
 *  reaches the transcript at every sub-pixel offset of its wrapper. */
export function tallBox(rig: Rig, view: AppView, t: Tall): Promise<void> {
  return inView(rig, view, t.kind, async (page) => {
    const start = await settle(page, t.kind);
    const dims = await page.evaluate(([k]) => {
      const el = (window as unknown as { __c5: { find: (kind: string) => HTMLElement } }).__c5.find(k);
      return { sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth };
    }, [t.kind] as const);
    expect(dims.sh, `the ${t.what} is taller than its cap`).toBeGreaterThan(dims.ch + t.range);
    if (t.wraps) expect(dims.sw, `the ${t.what} wraps, so it never scrolls sideways`).toBeLessThanOrEqual(dims.cw);
    expect(start.boxTop, `the ${t.what} starts at its top`).toBe(0);
    expect(start.room.down, `the transcript has room below the ${t.what}`).toBeGreaterThan(400);

    // First half: the box has room, so it takes the wheel and the transcript stays.
    const first = await wheelOver(page, t.kind, 0, 300);
    expect(first.boxTop, `the ${t.what} moved by ${first.boxTop}px (wanted more than 50)`).toBeGreaterThan(50);
    expect(Math.abs(first.scroller), `the transcript moved by ${first.scroller}px while the ${t.what} had room`).toBeLessThan(2);

    // Second half: the box at its end, the FIRST wheel reaches the transcript and the box stays at its end. Run at eight
    // sub-pixel offsets of the box's wrapper: a box whose scroll range is fractional is latched by Chrome at its end for
    // the wheel at some page offsets (about .06-.44 of a pixel), swallowing it, so one resting offset proves nothing
    // about the others. Each offset is its own settle.
    for (let k = 0; k < 8; k += 1) {
      const at = `at a ${k}/8 px offset of the ${t.what}'s wrapper`;
      await page.evaluate(([top, sel]) => {
        let st = document.getElementById('c5-nudge') as HTMLStyleElement | null;
        if (!st) { st = document.createElement('style'); st.id = 'c5-nudge'; document.head.append(st); }
        st.textContent = `${sel} { position: relative; top: ${top}px; }`;
      }, [k / 8, t.wrapper] as const);
      await reveal(page, t.kind);
      await page.evaluate(([kind]) => {
        const el = (window as unknown as { __c5: { find: (kind: string) => HTMLElement } }).__c5.find(kind);
        el.scrollTop = el.scrollHeight;
      }, [t.kind] as const);
      const atEnd = await settle(page, t.kind);
      expect(atEnd.room.down, `the transcript still has room below the ${t.what} ${at}`).toBeGreaterThan(400);
      const second = await wheelOver(page, t.kind, 0, 300);
      expect(Math.abs(second.boxTop), `the ${t.what} stays at its end ${at}`).toBeLessThan(2);
      expect(second.scroller, `the first wheel moved the transcript by ${second.scroller}px (wanted more than 50) ${at}`).toBeGreaterThan(50);
    }
  });
}
