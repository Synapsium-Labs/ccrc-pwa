// The mail lane's rows, compact (desktop polish wave 176), in a real Chrome over the production build, with the real
// virtual list: in both skins at a phone's and a desk's width, over a long coordinator transcript (a wake every few
// minutes: the lane's prompt, the fetch and its card, the ack, a line of prose, and some prompts that arrived back to
// back), the closed lines sit at the tap floor and are one line; Tab reaches one and Enter and Space open and close it;
// the header the reader tapped stays where it was when its row opens and closes; and a newer question arriving below
// leaves the question card the reader saw open as it was, moving nothing they read.
//
// It also MEASURES what the mail rows cost a reader, scrolling the whole transcript and summing the rows by what they
// are, and logs it (`MEASURE …`). The same pass run over a build of `main` is the "before" in the task note, and each
// view's mail rows must come to under a third of it (review 3737 A9), so a prompt line that stopped being compact is red
// here in all four views (measured with `isMailPrompt` false: 16073px at 390 against a bound of 8203). A fold that stopped
// folding is not caught by that bound (measured with the fold removed: 4229px at 390, 4150px at 1280, both under it): it
// is the assertion of one prompt row per wake that catches it (36 rows against 30), in all four views.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/mail-rows.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MAIL_ENVELOPE_FENCE } from '../../shared/api';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [390, 1280].map((width) => ({ skin, theme: PHOSPHOR, width })));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

// ---- the fixture: one coordinator session, neutral names --------------------------------------------------------------
const NOW = 1_792_362_479;
const SELF = 'project-a-coord';
const SESSION = {
  id: SELF, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a/coord',
  workspace: 'coord', name: 'coord', status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: 'ws/coord', ctxPct: null, paneCols: null,
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

const BASE = (NOW - 4 * 3600) * 1000;
const at = (min: number): string => new Date(BASE + min * 60_000).toISOString();
/** The generic nudge as the server types it (`server/test/fixtures/mail-prompt-forms.json`, held equal to the server's
 *  renderer by `server/test/mail-prompt-forms.test.ts`), addressed to this session. */
const FORMS = JSON.parse(readFileSync(
  path.join(import.meta.dirname, '..', '..', 'server', 'test', 'fixtures', 'mail-prompt-forms.json'), 'utf8',
)) as { self: string; forms: { generic: string } };
const NUDGE = FORMS.forms.generic.split(FORMS.self).join(SELF);
let k = 0;
const call = (into: object[], command: string, text: string, min: number): void => {
  k += 1;
  into.push({ kind: 'tool_use', uuid: `u${k}`, ts: at(min), toolId: `t${k}`, name: 'Bash', input: JSON.stringify({ command }) });
  into.push({ kind: 'tool_result', ts: at(min), toolId: `t${k}`, text, isError: false });
};
/** A fetched envelope in the grammar a transcript holds it in (as `pwa/test/mail-card.test.tsx` writes it out). */
const envelope = (i: number, kind: string, subject: string, body: string): string => {
  const id = 1000 + i;
  const lines = [`id: ${id}`, `from: project-a-worker-${i % 3}`, `to: ${SELF}`, `run: ${40 + (i % 3)} (program:demo wave ${i % 5}/5)`,
    `kind: ${kind}`, `subject: ${subject}`];
  if (i % 4 === 0) lines.push('artifacts:', `  /w/project-a/docs/report-${i}.md`);
  lines.push(`ack: ccrc-api mail ack ${id} --json -   (${id} is this DELIVERY id, not the`,
    '  mail row\'s own id) with body {"fromId":"<your ccd id>","fromUuid":"<your uuid>"}.', '--');
  return '```' + MAIL_ENVELOPE_FENCE + '\n' + lines.join('\n') + '\n' + body + '\n```';
};
const BODY = 'suite: green\n{"branchTip":"0123456789abcdef0123456789abcdef01234567","prNumber":12,"prPhase":"draft"}\n'
  + 'The wave is built and pushed once; the fast run on the exact tip is green.';

/** WAKES wakes of a coordinator: the lane's prompt (twice in a row every fifth wake, as a prompt that arrived while the
 *  last was being read does), the inbox read, the fetch whose result is the card, the ack, and a line of prose. The
 *  last wake's mail is a question to this session, so it is the newest mail row and opens by default. */
const WAKES = 30;
function coordinatorTranscript(lastAsks = true): object[] {
  const events: object[] = [];
  for (let i = 0; i < WAKES; i += 1) {
    const min = i * 6;
    events.push({ kind: 'user', uuid: `n${i}`, ts: at(min), text: NUDGE });
    if (i % 5 === 4) events.push({ kind: 'user', uuid: `n${i}b`, ts: at(min + 1), text: NUDGE });
    call(events, `~/.local/bin/ccrc-api mail inbox`, `inbox: 1 printed, 1 acked (delivery ${2000 + i})`, min + 1);
    const asks = lastAsks && i === WAKES - 1;
    call(events, `~/.local/bin/ccrc-api mail fetch ${2000 + i}`,
      envelope(i, asks ? 'question' : 'status', asks ? 'which base should the next wave take?' : 'wave-done', BODY), min + 1);
    call(events, `~/.local/bin/ccrc-api mail ack ${2000 + i} --json -`, '{"ok":true}', min + 2);
    events.push({ kind: 'assistant', uuid: `a${i}`, ts: at(min + 2), text: `Wave ${i} measured; the claim holds. Waiting for the next mail.` });
  }
  return events;
}

/** The mail rows' screen height on a build of `main` at 7b0dc02ff9, the same pass over the same transcript (the task
 *  note's section 6): the lower of the two skins at each width. */
const BEFORE_PX: Record<number, number> = { 390: 24_611, 1280: 15_484 };

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
  await page.waitForSelector('.chat-scroller .chat-item', { timeout: 20_000 });
  await page.waitForTimeout(800);
  return (frame: object): void => { expect(send, 'the session socket never opened').not.toBeNull(); send!(frame); };
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

/** Every row of the transcript, measured once each while the whole list is scrolled through, by what it is: the lane's
 *  prompt (a quiet line, or on a build before this wave a bubble whose text is the prompt), a mail card standing alone,
 *  a tool-activity row (which now holds the fetched cards), or anything else. Read the same way on `main`'s build. */
async function measureAll(page: Page) {
  await scrollTo(page, 'top');
  const seen = new Map<string, { kind: string; h: number }>();
  for (let step = 0; step < 400; step += 1) {
    const done = await page.evaluate((head) => {
      const s = document.querySelector<HTMLElement>('.chat-scroller')!;
      const rows = [...s.querySelectorAll<HTMLElement>('[data-index]')].map((el) => {
        const item = el.querySelector<HTMLElement>('.chat-item') ?? el;
        const kind = item.querySelector('.mail-prompt') !== null ? 'prompt'
          : (item.querySelector('.msg-user')?.textContent ?? '').startsWith(head) ? 'prompt'
            : item.querySelector('.tool-activity') !== null ? 'activity'
              : item.querySelector('.mail-card') !== null ? 'card'
                : 'other';
        return { i: el.getAttribute('data-index')!, kind, h: Math.round(el.getBoundingClientRect().height) };
      });
      const atEnd = s.scrollTop + s.clientHeight >= s.scrollHeight - 1;
      s.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
      s.scrollTop += Math.round(s.clientHeight / 2);
      return { rows, atEnd };
    }, 'ccrc-mail: you have new mail.');
    for (const r of done.rows) seen.set(r.i, { kind: r.kind, h: r.h });
    if (done.atEnd) break;
    await page.waitForTimeout(150);
  }
  const sum: Record<string, { rows: number; px: number }> = {};
  for (const { kind, h } of seen.values()) {
    sum[kind] ??= { rows: 0, px: 0 };
    sum[kind].rows += 1;
    sum[kind].px += h;
  }
  return { rows: seen.size, sum };
}

describe('the mail rows of a long coordinator transcript (desktop polish wave 176)', () => {
  for (const view of VIEWS) {
    it(`MEASURE ${named(view)}`, async () => {
      const { ctx, page } = await openApp(browser!, view, FIXTURE);
      try {
        await openSession(page, ctx, coordinatorTranscript());
        const m = await measureAll(page);
        console.log(`MEASURE ${named(view)}: ${JSON.stringify(m)}`);
        const px = (kind: string): number => m.sum[kind]?.px ?? 0;
        const mail = px('prompt') + px('activity') + px('card');
        // Every wake's prompt is one line, the back-to-back pairs folded into one: one prompt row per wake.
        expect(m.sum.prompt?.rows, 'prompt rows').toBe(WAKES);
        expect(mail, `the mail rows came to ${mail}px against ${BEFORE_PX[view.width]}px before`).toBeLessThan(BEFORE_PX[view.width]! / 3);
      } finally {
        await ctx.close();
      }
    });
  }

  for (const view of VIEWS) {
    it(`closed lines at the tap floor, the keyboard, and the reader's place: ${named(view)}`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await openSession(page, ctx, coordinatorTranscript());
        const tapMin = await page.evaluate(() =>
          Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')));

        // 1. Every closed line on screen is one line at the tap floor, inside the column, and says what it is.
        await scrollTo(page, 'middle');
        const lines = await page.evaluate(() => {
          const s = document.querySelector<HTMLElement>('.chat-scroller')!;
          return [...s.querySelectorAll<HTMLElement>('.mail-prompt-line, .mail-card-head')].map((b) => ({
            h: Math.round(b.getBoundingClientRect().height),
            label: b.getAttribute('aria-label') ?? '',
            expanded: b.getAttribute('aria-expanded'),
            overflow: b.scrollWidth - b.clientWidth,
            past: Math.round(b.getBoundingClientRect().right - s.getBoundingClientRect().right),
          }));
        });
        const closed = lines.filter((l) => l.expanded === 'false');
        expect(closed.length, 'no closed mail line in view').toBeGreaterThan(0);
        for (const l of closed) {
          expect(l.h, `"${l.label}" is under the tap floor`).toBeGreaterThanOrEqual(Math.floor(tapMin));
          expect(l.h, `"${l.label}" is more than one line`).toBeLessThanOrEqual(Math.ceil(tapMin) + 1);
          expect(l.overflow, `"${l.label}" overflows its box`).toBeLessThanOrEqual(0);
          expect(l.past, `"${l.label}" passes the column`).toBeLessThanOrEqual(0);
          expect(l.label).toMatch(/^Mail (arrived|from )/);
        }
        // Mid-list, most wakes have one prompt: a single prompt's line is in view.
        expect(lines.some((l) => /^Mail arrived, \d\d:\d\d$/.test(l.label)), 'no single prompt line in view').toBe(true);

        // 2. The keyboard: Tab reaches a line from the one before it, Enter opens it, Space closes it, with a visible focus.
        // The target is named before the key: the control after the prompt line in the page's order, which in this
        // transcript is the wake's tool stretch (the inbox read, the fetch and its card, the ack).
        const prompts = page.locator('.chat-scroller .mail-prompt-line[aria-expanded="false"]');
        await prompts.first().focus();
        const target = await page.evaluate(() => {
          const s = document.querySelector<HTMLElement>('.chat-scroller')!;
          const all = [...s.querySelectorAll<HTMLElement>('button')];
          const next = all[all.indexOf(document.activeElement as HTMLElement) + 1];
          if (next === undefined) return null;
          next.setAttribute('data-tab-target', 'yes');
          return next.className.split(' ')[0];
        });
        expect(target, 'the prompt line has a control after it').toBe('tool-activity-row');
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return el === null ? null : { target: el.getAttribute('data-tab-target') === 'yes', visible: el.matches(':focus-visible') };
        });
        expect(focused, 'Tab left the transcript').not.toBeNull();
        expect(focused!.target, 'Tab did not reach the stretch after the prompt line').toBe(true);
        expect(focused!.visible, 'the focused line shows no focus').toBe(true);
        // Focus can scroll the line into view, and the virtual list lays out what the scroll brings into reach: the line
        // is scrolled to first and the list left to settle, so the key reaches the line the reader sees.
        const label = await prompts.first().getAttribute('aria-label');
        const line = page.locator(`.chat-scroller .mail-prompt-line[aria-label="${label}"]`).first();
        await line.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await line.focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => line.getAttribute('aria-expanded'), { message: 'Enter did not open the line' }).toBe('true');
        await page.waitForTimeout(600);
        await line.focus();
        await page.keyboard.press('Space');
        await expect.poll(() => line.getAttribute('aria-expanded'), { message: 'Space did not close the line' }).toBe('false');

        // 3. The header the reader taps stays where it was when its row opens and when it closes, mid-list and at the foot.
        for (const where of ['middle', 'bottom'] as const) {
          await scrollTo(page, where);
          const pick = await page.evaluate(() => {
            const s = document.querySelector<HTMLElement>('.chat-scroller')!;
            const top = s.getBoundingClientRect().top;
            const bottom = top + s.clientHeight;
            const heads = [...s.querySelectorAll<HTMLElement>('.mail-card-head[aria-expanded="false"], .mail-prompt-line[aria-expanded="false"]')]
              .filter((h) => h.getBoundingClientRect().top >= top + 40 && h.getBoundingClientRect().bottom <= bottom - 40);
            const h = heads[Math.floor(heads.length / 2)];
            if (h === undefined) return null;
            h.setAttribute('data-picked', 'yes');
            return h.getAttribute('aria-label');
          });
          expect(pick, `no closed mail line well inside the view at the ${where}`).not.toBeNull();
          const headAt = async () => page.evaluate(() => {
            const s = document.querySelector<HTMLElement>('.chat-scroller')!;
            const h = s.querySelector<HTMLElement>('[data-picked="yes"]');
            return h === null ? null : Math.round(h.getBoundingClientRect().top - s.getBoundingClientRect().top);
          });
          const at0 = await headAt();
          await page.locator('[data-picked="yes"]').click();
          await page.waitForTimeout(1000);
          const at1 = await headAt();
          await page.locator('[data-picked="yes"]').click();
          await page.waitForTimeout(1000);
          const at2 = await headAt();
          console.log(`TAP ${where} ${named(view)}: ${JSON.stringify({ pick, at0, at1, at2 })}`);
          expect(Math.abs(at1! - at0!), `the opened header moved (${where})`).toBeLessThanOrEqual(1);
          expect(Math.abs(at2! - at0!), `the closed header moved (${where})`).toBeLessThanOrEqual(1);
        }
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    it(`a newer question below leaves the question card the reader saw open, and moves nothing they read: ${named(view)}`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        // The last wake's question card is the newest asking card, open by default under its closed stretch. Below it,
        // a long reply the reader is reading. A newer question arrives at the foot: the first card no longer opens by
        // default, but the reader has seen it open, so it stays open where it was (`MailRow.tsx#useOpen`,
        // `mailRows.ts#underRow`). Letting it close moved the paragraph in view by the card's height in every view
        // (measured before the rule: 5 lines up), because the list does not hold the reader's place over a change that
        // comes with a new item at the end.
        const events = coordinatorTranscript();
        const reply = Array.from({ length: 60 }, (_, i) => `Line ${i} of the reply about which base the next wave should take.`).join('\n\n');
        events.push({ kind: 'assistant', uuid: 'long', ts: at(WAKES * 6), text: reply });
        const send = await openSession(page, ctx, events);
        await scrollTo(page, 'bottom');
        // Read inside the long reply, the open question card wholly above.
        const FIRST = '.mail-card--open:has(.mail-card-head[aria-label*="which base should the next wave take?"])';
        await page.evaluate((sel) => {
          const s = document.querySelector<HTMLElement>('.chat-scroller')!;
          const card = s.querySelector<HTMLElement>(sel)!;
          s.scrollTop += card.getBoundingClientRect().bottom - s.getBoundingClientRect().top + 200;
        }, FIRST);
        await page.waitForTimeout(800);
        const reading = async () => page.evaluate((sel) => {
          const s = document.querySelector<HTMLElement>('.chat-scroller')!;
          const top = s.getBoundingClientRect().top;
          const para = [...s.querySelectorAll<HTMLElement>('p')].find((el) => el.getBoundingClientRect().top >= top + 40);
          const card = s.querySelector<HTMLElement>(sel);
          return {
            text: para?.textContent ?? '',
            at: Math.round((para?.getBoundingClientRect().top ?? 0) - top),
            open: card !== null,
            cardBottom: card === null ? null : Math.round(card.getBoundingClientRect().bottom - top),
          };
        }, FIRST);
        const before = await reading();
        const later: object[] = [];
        k += 1;
        later.push({ kind: 'user', uuid: 'n-late', ts: at(WAKES * 6 + 5), text: NUDGE });
        call(later, '~/.local/bin/ccrc-api mail fetch 2999', envelope(99, 'question', 'which tag should the release take?', BODY), WAKES * 6 + 5);
        send({ type: 'events', uuid: 'u-1', events: later, offset: 2 });
        await page.waitForTimeout(1200);
        const after = await reading();
        console.log(`ABOVE ${named(view)}: ${JSON.stringify({ before, after })}`);
        expect(before.text, 'no paragraph in view').not.toBe('');
        expect(before.open, 'the question card is not open by default').toBe(true);
        expect(before.cardBottom!, 'the open card is not wholly above the reader').toBeLessThanOrEqual(0);
        expect(after.open, 'the question card the reader saw open closed').toBe(true);
        expect(after.cardBottom, 'the question card above the reader changed size or moved').toBe(before.cardBottom);
        expect(after.text, 'the paragraph in view changed').toBe(before.text);
        expect(Math.abs(after.at - before.at), 'the paragraph in view moved').toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});

// ---- desktop polish wave 179, B2: the question words are the last thing on a stretch's row to shrink -----------------
const NARROW: AppView[] = [REFINED, INSTRUMENT].map((skin) => ({ skin, theme: PHOSPHOR, width: 0 }))
  .flatMap((v) => [320, 360, 390].map((width) => ({ ...v, width })));

/** One closed stretch holding a failed call, a call still running and two fetched question cards to this session: the
 *  newest opens under its row, the older is hidden and the row says "2 messages, 1 question" beside "running" and
 *  "1 failed", the longest set of words the row carries at a phone's width. */
function stretchWithHiddenQuestion(): object[] {
  const events: object[] = [
    { kind: 'user', uuid: 'q-1', ts: at(0), text: 'Check the mail, then publish.' },
    { kind: 'assistant', uuid: 'a-1', ts: at(1), text: 'Reading the mail first.' },
  ];
  call(events, '~/.local/bin/ccrc-api mail fetch 2001', envelope(1, 'question', 'which base should the next wave take?', BODY), 2);
  call(events, '~/.local/bin/ccrc-api mail fetch 2002', envelope(2, 'question', 'which tag should the release take?', BODY), 3);
  call(events, 'npm run build', 'exit 1', 4);
  (events[events.length - 1] as { isError: boolean }).isError = true;
  k += 1;
  events.push({ kind: 'tool_use', uuid: `u${k}`, ts: at(5), toolId: `t${k}`, name: 'Bash', input: JSON.stringify({ command: 'npm publish' }) });
  return events;
}

describe('the question words of a closed stretch are the last to shrink (desktop polish wave 179, B2)', () => {
  // Plain, and with the session also waiting on an approval (a third flag, "waiting on you": the fixed parts of the row
  // are then too wide to share one line with the question words at a phone's width).
  const APPROVAL = { type: 'ask', ask: { approval: { tool: 'Bash', summary: 'npm publish' } } };
  for (const [view, waiting] of NARROW.flatMap((v) => [[v, false], [v, true]] as const)) {
    it(`${named(view)}${waiting ? ', waiting on you' : ''}: "1 question" is whole, inside the row and the column`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await openSession(page, ctx, stretchWithHiddenQuestion(), waiting ? [APPROVAL] : []);
        await page.waitForSelector('.tool-activity-row', { timeout: 20_000 });
        const tapMin = await page.evaluate(() =>
          Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')));
        const m = await page.evaluate(() => {
          const rows = [...document.querySelectorAll<HTMLElement>('.tool-activity-row')];
          const button = rows[rows.length - 1]!;
          const scroller = document.querySelector<HTMLElement>('.chat-scroller')!;
          const asks = button.querySelector<HTMLElement>('.tool-activity-asks');
          const r = asks?.getBoundingClientRect();
          const b = button.getBoundingClientRect();
          const s = scroller.getBoundingClientRect();
          return {
            text: button.textContent ?? '',
            asks: asks?.textContent ?? null,
            cut: asks === null ? null : asks.scrollWidth - asks.clientWidth,
            leftIn: r === undefined ? null : Math.round(r.left - b.left),
            rightPast: r === undefined ? null : Math.round(r.right - b.right),
            columnPast: r === undefined ? null : Math.round(r.right - s.right),
            rowPast: Math.round(b.right - s.right),
            rowOverflow: button.scrollWidth - button.clientWidth,
            scrollerSide: scroller.scrollWidth - scroller.clientWidth,
            wrapped: r === undefined ? null : r.top > button.querySelector<HTMLElement>('.tool-activity-title')!.getBoundingClientRect().bottom,
            height: Math.round(b.height),
          };
        });
        console.log(`B2 ${named(view)}${waiting ? ' waiting' : ''}: ${JSON.stringify(m)}`);
        expect(m.text, 'the row does not read as the fixture says').toContain('2 messages,');
        expect(m.text).toContain('running');
        expect(m.text).toContain('1 failed');
        expect(m.asks, 'the question words are not their own element').toBe('1 question');
        expect(m.cut, 'the question words are cut').toBeLessThanOrEqual(0);
        expect(m.leftIn!, 'the question words start before the row').toBeGreaterThanOrEqual(0);
        expect(m.rightPast!, 'the question words pass the row').toBeLessThanOrEqual(0);
        expect(m.columnPast!, 'the question words pass the column').toBeLessThanOrEqual(0);
        expect(m.rowPast, 'the row passes the column').toBeLessThanOrEqual(0);
        expect(m.rowOverflow, 'the row overflows its own box').toBeLessThanOrEqual(0);
        expect(m.height, 'the row is under the tap floor').toBeGreaterThanOrEqual(Math.floor(tapMin));
        expect(m.scrollerSide, 'the transcript scrolls sideways').toBeLessThanOrEqual(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});

// The wrap fallback (B2): when the fixed parts of the row (the chevron, the separators, the flags and the question words)
// do not fit one line, the row wraps to a second line before the question words are cut. No phone width needs it with these
// words (the title, counts and summary give way first), so the case injects a style that narrows the stretch and widens the row's gaps.
const WRAP_W = 230;
describe('a row that cannot fit its fixed parts wraps before the question words are cut (desktop polish wave 179, B2)', () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    const view: AppView = { skin, theme: PHOSPHOR, width: 390 };
    it(`${named(view)}, stretch narrowed to ${WRAP_W}px with wide gaps: wraps, the question words whole`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await openSession(page, ctx, stretchWithHiddenQuestion(), [{ type: 'ask', ask: { approval: { tool: 'Bash', summary: 'npm publish' } } }]);
        await page.waitForSelector('.tool-activity-row', { timeout: 20_000 });
        await page.addStyleTag({ content: `.tool-activity { max-width: ${WRAP_W}px; } .tool-activity-row { column-gap: 20px; }` });
        await page.waitForTimeout(600);
        const tapMin = await page.evaluate(() =>
          Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')));
        const m = await page.evaluate(() => {
          const rows = [...document.querySelectorAll<HTMLElement>('.tool-activity-row')];
          const button = rows[rows.length - 1]!;
          const asks = button.querySelector<HTMLElement>('.tool-activity-asks')!;
          const chev = button.querySelector<HTMLElement>('.tool-activity-chev')!.getBoundingClientRect();
          const scroller = document.querySelector<HTMLElement>('.chat-scroller')!;
          const r = asks.getBoundingClientRect();
          const b = button.getBoundingClientRect();
          return {
            width: Math.round(b.width),
            height: Math.round(b.height),
            chev: [Math.round(chev.top - b.top), Math.round(chev.bottom - b.top)], asksTop: Math.round(r.top - b.top),
            cut: asks.scrollWidth - asks.clientWidth,
            leftIn: Math.round(r.left - b.left),
            rightPast: Math.round(r.right - b.right),
            columnPast: Math.round(r.right - scroller.getBoundingClientRect().right),
            rowOverflow: button.scrollWidth - button.clientWidth,
            scrollerSide: scroller.scrollWidth - scroller.clientWidth,
          };
        });
        console.log(`B2 wrap ${named(view)}: ${JSON.stringify(m)}`);
        expect(m.width, 'the injected style did not narrow the row').toBeLessThanOrEqual(WRAP_W);
        expect(m.height, 'the row did not wrap').toBeGreaterThan(Math.ceil(tapMin));
        expect(m.cut, 'the question words are cut').toBeLessThanOrEqual(0);
        expect(m.leftIn, 'the question words start before the row').toBeGreaterThanOrEqual(0);
        expect(m.rightPast, 'the question words pass the row').toBeLessThanOrEqual(0);
        expect(m.columnPast, 'the question words pass the column').toBeLessThanOrEqual(0);
        expect(m.rowOverflow, 'the row overflows its own box').toBeLessThanOrEqual(0);
        expect(m.scrollerSide, 'the transcript scrolls sideways').toBeLessThanOrEqual(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
