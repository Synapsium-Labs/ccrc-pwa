// The mail lane's rows, compact (desktop polish wave 176), in a real Chrome over the production build, with the real
// virtual list: in both skins at a phone's and a desk's width, over a long coordinator transcript (a wake every few
// minutes: the lane's prompt, the fetch and its card, the ack, a line of prose, and some prompts that arrived back to
// back), the closed lines sit at the tap floor and are one line; Tab reaches one and Enter and Space open and close it;
// the header the reader tapped stays where it was when its row opens and closes; and a row above the reader that
// changes size (the newest question card closing because newer mail arrived below) moves nothing they read.
//
// It also MEASURES what the mail rows cost a reader, scrolling the whole transcript and summing the rows by what they
// are, and logs it (`MEASURE …`). The same pass run over a build of `main` is the "before" in the task note.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/mail-rows.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { renderEnvelope, renderMailNudge } from '../../server/src/coord/envelope';
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
const NUDGE = renderMailNudge(SELF);
let k = 0;
const call = (into: object[], command: string, text: string, min: number): void => {
  k += 1;
  into.push({ kind: 'tool_use', uuid: `u${k}`, ts: at(min), toolId: `t${k}`, name: 'Bash', input: JSON.stringify({ command }) });
  into.push({ kind: 'tool_result', ts: at(min), toolId: `t${k}`, text, isError: false });
};
const envelope = (i: number, kind: string, subject: string, body: string): string => renderEnvelope({
  id: 1000 + i, fromId: `project-a-worker-${i % 3}`, toId: SELF, runId: 40 + (i % 3), program: 'demo', wave: i % 5, waveOf: 5,
  kind: kind as 'status', subject, artifacts: i % 4 === 0 ? [`/w/project-a/docs/report-${i}.md`] : [], body,
});
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
async function openSession(page: Page, ctx: Awaited<ReturnType<typeof openApp>>['ctx'], events: object[]) {
  let send: ((frame: object) => void) | null = null;
  await ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
    send = (frame) => ws.send(JSON.stringify(frame));
    send({
      type: 'backlog', uuid: 'u-1', events, offset: 1, file: '/w/t.jsonl', missing: false, searchComplete: true, fileMeasured: true,
    });
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
        expect(m.rows).toBeGreaterThan(0);
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
        expect(lines.some((l) => /^Mail arrived 2 times, /.test(l.label)) || lines.some((l) => /^Mail arrived, /.test(l.label)),
          'no prompt line in view').toBe(true);

        // 2. The keyboard: Tab reaches a line from the one before it, Enter opens it, Space closes it, with a visible focus.
        const prompts = page.locator('.chat-scroller .mail-prompt-line[aria-expanded="false"]');
        await prompts.first().focus();
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return el === null ? null : { mail: el.matches('.mail-prompt-line, .mail-card-head, .tool-activity-row'), visible: el.matches(':focus-visible') };
        });
        expect(focused, 'Tab left the transcript').not.toBeNull();
        expect(focused!.mail, 'Tab did not reach the next line of the transcript').toBe(true);
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

    it(`newer mail below leaves the question card the reader saw open, and moves nothing they read: ${named(view)}`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        // The last wake's question card is the newest mail row, open by default under its closed stretch. Below it, a
        // long reply the reader is reading. Newer mail arrives at the foot: the question card is no longer the newest,
        // but the reader has seen it open, so it stays open (`MailRows.tsx#useOpen`). Letting it close moved the
        // paragraph in view by the card's height in every view (measured before the rule: 5 lines up), because the
        // list does not hold the reader's place over a change that comes with a new item at the end.
        const events = coordinatorTranscript();
        const reply = Array.from({ length: 60 }, (_, i) => `Line ${i} of the reply about which base the next wave should take.`).join('\n\n');
        events.push({ kind: 'assistant', uuid: 'long', ts: at(WAKES * 6), text: reply });
        const send = await openSession(page, ctx, events);
        await scrollTo(page, 'bottom');
        // Read inside the long reply, the open question card wholly above.
        await page.evaluate(() => {
          const s = document.querySelector<HTMLElement>('.chat-scroller')!;
          const cards = [...s.querySelectorAll<HTMLElement>('.mail-card--open')];
          const card = cards[cards.length - 1]!;
          s.scrollTop += card.getBoundingClientRect().bottom - s.getBoundingClientRect().top + 200;
        });
        await page.waitForTimeout(800);
        const reading = async () => page.evaluate(() => {
          const s = document.querySelector<HTMLElement>('.chat-scroller')!;
          const top = s.getBoundingClientRect().top;
          const para = [...s.querySelectorAll<HTMLElement>('p')].find((el) => el.getBoundingClientRect().top >= top + 40);
          const cards = [...s.querySelectorAll<HTMLElement>('.mail-card--open')];
          const card = cards[cards.length - 1];
          return {
            text: para?.textContent ?? '',
            at: Math.round((para?.getBoundingClientRect().top ?? 0) - top),
            open: cards.length,
            cardBottom: card === undefined ? null : Math.round(card.getBoundingClientRect().bottom - top),
          };
        });
        const before = await reading();
        const later: object[] = [];
        k += 1;
        later.push({ kind: 'user', uuid: 'n-late', ts: at(WAKES * 6 + 5), text: NUDGE });
        call(later, '~/.local/bin/ccrc-api mail fetch 2999', envelope(99, 'status', 'wave-done', BODY), WAKES * 6 + 5);
        send({ type: 'events', uuid: 'u-1', events: later, offset: 2 });
        await page.waitForTimeout(1200);
        const after = await reading();
        console.log(`ABOVE ${named(view)}: ${JSON.stringify({ before, after })}`);
        expect(before.text, 'no paragraph in view').not.toBe('');
        expect(before.open, 'the question card is not open by default').toBeGreaterThan(0);
        expect(before.cardBottom!, 'the open card is not wholly above the reader').toBeLessThanOrEqual(0);
        expect(after.open, 'the question card the reader saw open closed').toBe(1);
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
