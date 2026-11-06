// Chrome measures the colour in the assistant's prose over the production build (chat reading Task C, D-8061; spec
// 2026-11-06 §3.1): action lead-ins and the markers of the list after one in amber, other lead-ins in the NOTE blue,
// status labels on their tones' pairs, and everything else at today's ink, in chat only. `chat-colour.test.ts` reads
// the rules' text; this file reads what the engine resolves them to, on the marks `remarkChatMarks` (D-8060) writes.
// The Docs reader's own profile writes no mark (Task M's "the docs profile carries no chat mark"), so the scope is
// proved here on the chat's own marked markup cloned into a `.msg-assist.doc-body` page, and on a real opened recap.
// Run: `( cd pwa && CCRC_CHROME=<Chrome> ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 --no-file-parallelism browser/chat-colour.browser.test.ts )`.
// `CCRC_SHOTS=<a directory>` keeps one picture of the message per view.
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { MARK_ATTR, type StatusTone } from '../src/lib/chatMarks';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

// tool-well-colour.browser.test.ts's VIEWS: both skins, the default dark palette and light, phone to desk.
const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [PHOSPHOR, 'light'].flatMap((theme) =>
  [360, 390, 1280, 1920].map((width) => ({ skin, theme, width }))));
const NOW = 1_792_362_479;
const TS = new Date((NOW - 600) * 1000).toISOString();
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
      accounts: [{ wrapper: 'lane-a', five: 40, seven: 50, ts: NOW, fiveResetAt: NOW + 7_800,
        sevenResetAt: NOW + 259_800, fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false }],
      projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', pool: null, homeAble: true, hidden: false }],
    },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': [], '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: [SESSION] }],
};

/** The spec's screenshot shape: two kinds of lead-in, an action list, every tone in a label position, a table whose
 *  first column opens with status words, a plain list, and ordinary uses of a status word. */
const TURN = [
  "**Why I can't do it.** The gate needs a token this session does not hold.",
  '',
  '**What to do (either one):**',
  '',
  '1. Re-run the check.',
  '2. Ask for the token.',
  '',
  '**What happens next.** #652 failed, CI green, #651 merged, and run 1527 is blocked.',
  '',
  '| State | Note |',
  '|---|---|',
  '| passed on the second try | fine |',
  '| blocked by the queue | waits |',
  '',
  'Plain steps, after an ordinary paragraph:',
  '',
  '- one',
  '- two',
  '',
  'I read the value passed to the parser, and it was a red herring.',
].join('\n');
const LEAD_TEXT = "Why I can't do it.";
const PLAIN_TEXT = 'the value passed to the parser';

const EVENTS = [
  { kind: 'user', uuid: 'r1', ts: TS, text: TURN, compaction: true },
  { kind: 'user', uuid: 'q1', ts: TS, text: 'Where does it stand?' },
  { kind: 'assistant', uuid: 'a1', ts: TS, text: TURN },
];

/** Spec §3.1's status table, the tokens each tone draws. */
const TONES: Readonly<Record<StatusTone, { color: string; background: string }>> = {
  ok: { color: '--status-busy-text', background: '--accent-tint' },
  merged: { color: '--pr-merged', background: '--acct-violet-tint' },
  wait: { color: '--status-attention-text', background: '--status-attention-tint' },
  fail: { color: '--status-dead-text', background: '--status-dead-tint-solid' },
};
/** What the turn's labels are, in document order. */
const LABELS: readonly [StatusTone, string][] = [
  ['fail', 'failed'], ['ok', 'green'], ['merged', 'merged'], ['wait', 'blocked'], ['ok', 'passed'], ['wait', 'blocked'],
];

/** The cases the plan names (Task C, Step 3), carried on each assertion so a red says which one. */
const A = 'action lead-ins and their list markers are amber, info lead-ins blue';
const S = "each status label draws its tone's text and ground";
const I = 'body text and ordinary uses of a status word stay --ink-primary';
const D = 'the Docs reader keeps ink';
const R = 'an opened recap keeps ink';
const C = 'the control: in chat the attributes draw';

let server: DistServer | undefined;
let browser: Browser | undefined;
beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  server = await serveDist(sharedDist());
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);
afterAll(async () => { await browser?.close(); await server?.close(); });

interface Measure {
  readonly tokens: Record<string, string>;
  readonly leads: { kind: string | null; text: string; colour: string }[];
  readonly actionMarkers: string[];
  readonly plainMarkers: string[];
  readonly labels: { tone: string | null; text: string; colour: string; background: string }[];
  readonly body: { lead: string; plain: string; plainLabels: number };
  /** Each surface's marked elements read before and after their attributes are stripped in place: equal means the
   *  attributes draw nothing there. `marked` says the surface carried marks at all. */
  readonly surfaces: Record<'docs' | 'recap' | 'chatClone', { marked: number; before: string[]; after: string[] }>;
}

describe('colour in the assistant\'s prose (D-8061)', () => {
  for (const view of VIEWS) {
    it(`${view.skin}, ${view.theme}, ${view.width}px`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await ctx.routeWebSocket(/\/ws\/session\//, (ws) => ws.send(JSON.stringify({
          type: 'backlog', uuid: 'u-1', events: EVENTS, offset: 1, file: '/w/t.jsonl', missing: false,
          searchComplete: true, fileMeasured: true,
        })));
        await page.goto(`${server!.origin}/s/${SESSION.id}`);
        const message = page.locator('.msg-assist:not(.compaction-body)', { hasText: LEAD_TEXT });
        await message.locator(`[${MARK_ATTR.status}]`).first().waitFor({ timeout: 20_000 });
        await page.locator('.compaction-head').first().click();
        await page.locator(`.compaction--open .compaction-body [${MARK_ATTR.status}]`).first().waitFor({ timeout: 10_000 });
        const shots = process.env['CCRC_SHOTS'];
        if (shots) await message.screenshot({ path: path.join(shots, `chat-colour-${view.skin}-${view.theme}-${view.width}.png`) });

        const m: Measure = await page.evaluate(({ attr, tones, leadText, plainText }) => {
          const probe = document.createElement('span');
          document.body.append(probe);
          const token = (name: string): string => {
            probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(name);
            return getComputedStyle(probe).color;
          };
          const names = ['--status-attention-text', '--acct-blue', '--ink-primary', '--ink-tertiary',
            ...Object.values(tones).flatMap((t) => [t.color, t.background])];
          const tokens = Object.fromEntries(names.map((n) => [n, token(n)]));
          probe.remove();
          const chat = [...document.querySelectorAll<HTMLElement>('.msg-assist:not(.compaction-body)')]
            .find((el) => el.textContent?.includes(leadText));
          if (chat === undefined) throw new Error('no assistant message');
          const markerOf = (li: Element): string => getComputedStyle(li, '::marker').color;
          const plain = [...chat.querySelectorAll<HTMLElement>(':scope > p')].find((p) => p.textContent?.includes(plainText));
          const leadP = chat.querySelector<HTMLElement>(':scope > p');
          const colourAttrs = [attr.lead, attr.afterLead, attr.status];
          const marked = colourAttrs.map((a) => `[${a}]`).join(',');
          /** Read every marked element of `root` (its ink, ground, weight and inline padding, and a list's markers),
           *  strip the colour attributes in place, and read the same elements again. */
          const strip = (root: Element): { marked: number; before: string[]; after: string[] } => {
            const els = [...root.querySelectorAll(marked)];
            const read = (): string[] => els.flatMap((el) => {
              const s = getComputedStyle(el);
              const markers = el.matches('ul, ol') ? [...el.children].map(markerOf) : [];
              return [`${el.tagName} ${s.color} ${s.backgroundColor} ${s.fontWeight} ${s.paddingLeft}`, ...markers];
            });
            const before = read();
            for (const el of els) for (const a of colourAttrs) el.removeAttribute(a);
            return { marked: els.length, before, after: read() };
          };
          const out = {
            tokens,
            leads: [...chat.querySelectorAll(`strong[${attr.lead}]`)].map((el) => ({
              kind: el.getAttribute(attr.lead), text: el.textContent ?? '', colour: getComputedStyle(el).color,
            })),
            actionMarkers: [...chat.querySelectorAll(`:scope > :is(ul, ol)[${attr.afterLead}='action'] > li`)].map(markerOf),
            plainMarkers: [...chat.querySelectorAll(`:scope > :is(ul, ol):not([${attr.afterLead}]) > li`)].map(markerOf),
            labels: [...chat.querySelectorAll<HTMLElement>(`[${attr.status}]`)].map((el) => {
              const s = getComputedStyle(el);
              return { tone: el.getAttribute(attr.status), text: el.textContent ?? '', colour: s.color, background: s.backgroundColor };
            }),
            body: {
              lead: leadP ? getComputedStyle(leadP).color : '',
              plain: plain ? getComputedStyle(plain).color : '',
              plainLabels: plain ? plain.querySelectorAll(`[${attr.status}]`).length : -1,
            },
          };
          // The same marked markup as a Docs page, and as chat (the control: there the attributes DO draw).
          const docs = document.createElement('article');
          docs.className = 'msg-assist doc-body';
          docs.append(...[...chat.childNodes].map((n) => n.cloneNode(true)));
          const clone = document.createElement('div');
          clone.className = 'msg-assist';
          clone.append(...[...chat.childNodes].map((n) => n.cloneNode(true)));
          document.body.append(docs, clone);
          const recap = document.querySelector('.compaction--open .compaction-body');
          if (recap === null) throw new Error('no opened recap');
          const surfaces = { docs: strip(docs), recap: strip(recap), chatClone: strip(clone) };
          docs.remove();
          clone.remove();
          return { ...out, surfaces };
        }, { attr: MARK_ATTR, tones: TONES, leadText: LEAD_TEXT, plainText: PLAIN_TEXT });
        const t = m.tokens;

        // action lead-ins and their list markers are amber, info lead-ins blue
        expect(m.leads.map((l) => [l.kind, l.text]), A).toEqual([
          ['info', LEAD_TEXT], ['action', 'What to do (either one):'], ['info', 'What happens next.'],
        ]);
        for (const lead of m.leads) {
          expect(lead.colour, `${A}: ${lead.text}`).toBe(lead.kind === 'action' ? t['--status-attention-text'] : t['--acct-blue']);
        }
        expect(m.actionMarkers, A).toEqual([t['--status-attention-text'], t['--status-attention-text']]);

        // each status label draws its tone's text and ground
        expect(m.labels.map((l) => [l.tone, l.text]), S).toEqual(LABELS);
        for (const label of m.labels) {
          const pair = TONES[label.tone as StatusTone];
          expect([label.colour, label.background], `${S}: ${label.text}`).toEqual([t[pair.color], t[pair.background]]);
        }

        // body text and ordinary uses of a status word stay --ink-primary
        expect(m.body.lead, I).toBe(t['--ink-primary']);
        expect(m.body.plain, I).toBe(t['--ink-primary']);
        expect(m.body.plainLabels, I).toBe(0);
        expect(m.plainMarkers, I).toEqual([t['--ink-tertiary'], t['--ink-tertiary']]);

        // the Docs reader keeps ink: the chat's own marked markup on a Docs page draws exactly what it draws unmarked
        expect(m.surfaces.docs.marked, D).toBe(m.leads.length + 1 + m.labels.length);
        expect(m.surfaces.docs.before, D).toEqual(m.surfaces.docs.after);

        // an opened recap keeps ink: its marks (the chat profile writes them there too) draw nothing
        expect(m.surfaces.recap.marked, R).toBe(m.surfaces.docs.marked);
        expect(m.surfaces.recap.before, R).toEqual(m.surfaces.recap.after);

        // the control: in chat the same comparison does see the attributes
        expect(m.surfaces.chatClone.marked, C).toBe(m.surfaces.docs.marked);
        expect(m.surfaces.chatClone.before, C).not.toEqual(m.surfaces.chatClone.after);
        expect(errors).toEqual([]);
      } finally { await ctx.close(); }
    });
  }
});
