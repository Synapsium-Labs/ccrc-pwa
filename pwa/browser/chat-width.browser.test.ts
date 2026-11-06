// The chat at a desk (spec 2026-11-06 §2.1, D-8059), measured in a real Chrome over the production build.
//
// jsdom lays nothing out, so this file holds what Chrome computes for one session whose transcript has a 900-word
// paragraph, a 300-column fenced block and a six-column table in one assistant turn, then a long user turn, with the
// inline ask up (`test/askFixtures.ts`'s fixture 1), at 1280, 1600 (Refined with its inspector rail and without it),
// 2560 and 390, in both skins, Phosphor & Ink:
//   - "the column is the cap or the pane": `.chat-item` is Refined's 1200 px or the pane, whichever is narrower, and
//     Instrument's whole pane;
//   - "prose is held to the chat measure from the column's left edge": the paragraph is the skin's chat prose measure
//     (Refined 76ch, Instrument 88ch, resolved in the paragraph's own font) or the column, and starts at its left edge;
//   - "code, tables and the composer take the full column": the code block, the table and the inline ask are the
//     column's content width and the composer is the column;
//   - "the user bubble sits at the column's right edge, at most 70% wide and never wider than the prose" (fix round 1,
//     F2: `min(70%, var(--measure-chat-prose))`), with its attachments no wider than it (F9);
//   - "headings share the paragraphs' measure": the h1's and h2's max-width is the paragraph's (F3, the measure resolved
//     once on `.msg-assist`);
//   - "no horizontal page scroll": the page never scrolls sideways, and the 300-column block scrolls inside its well;
//   - "390 is unchanged": on a phone the paragraph's max-width is the shared `--measure-prose`, the column is the pane
//     and the user bubble is 85% of it (F8).
// The expected figures come from the spec's values, not from the tokens, so the first four are red on a tree that
// still has 780 and 72ch.
//
// `CCRC_SHOTS=<a directory>` keeps one picture per view and writes every view's figures to `chat-width-figures.json`
// there (the PR's before and after). Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary>
// ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/chat-width.browser.test.ts )`.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';
import { ASKER_PROJECT, ASKER_SESSION, askFixture } from '../test/askFixtures';
import { servedSocket } from '../test/wirePairing';

/** The spec's values (§2.1): the column's cap in px (null: the pane), and the chat prose measure in ch. */
const SPEC: Readonly<Record<string, { cap: number | null; proseCh: number }>> = {
  [REFINED]: { cap: 1200, proseCh: 76 },
  [INSTRUMENT]: { cap: null, proseCh: 88 },
};

interface View extends AppView { readonly rail: boolean }
const VIEWS: View[] = [REFINED, INSTRUMENT].flatMap((skin) => [
  ...[1280, 1600, 2560, 390].map((width) => ({ skin, theme: PHOSPHOR, width, rail: skin === REFINED && width === 1600 })),
  ...(skin === REFINED ? [{ skin, theme: PHOSPHOR, width: 1600, rail: false }] : []),
]);
const named = (v: View): string => `${v.skin}, ${v.theme}, ${v.width}px${v.width === 1600 && v.skin === REFINED ? (v.rail ? ', inspector rail' : ', rail hidden') : ''}`;
const slug = (v: View): string => `${v.skin}-${v.theme}-${v.width}${v.width === 1600 && v.skin === REFINED ? (v.rail ? '-rail' : '-norail') : ''}`;

// ---- the fixture: one session, neutral names -------------------------------------------------------------------------
const NOW = 1_792_362_479;
const TS = new Date((NOW - 600) * 1000).toISOString();
const SESSION = fleetSession({
  id: 'lane-a-project-a', wrapper: 'lane-a', home: 'lane-a', project: ASKER_PROJECT, workdir: '/w/project-a',
  workspace: ASKER_SESSION, status: 'busy', bucket: 'working', hookState: 'waiting', started: true,
});
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

const WORDS = ['the', 'column', 'holds', 'a', 'reading', 'measure', 'while', 'code', 'and', 'tables', 'take', 'room'];
const PARAGRAPH = Array.from({ length: 900 }, (_, i) => WORDS[i % WORDS.length]).join(' ') + '.';
const WIDE_LINE = Array.from({ length: 30 }, (_, i) => `col_${String(i).padStart(4, '0')}`).join(' ').padEnd(300, '=');
const TABLE = ['| one | two | three | four | five | six |', '|---|---|---|---|---|---|',
  '| a cell | b cell | c cell | d cell | e cell | f cell |', '| a | b | c | d | e | f |'].join('\n');
const HEADING = Array.from({ length: 40 }, (_, i) => WORDS[(i + 5) % WORDS.length]).join(' ');
const ASSISTANT = `# ${HEADING}\n\n## ${HEADING}\n\n${PARAGRAPH}\n\n\`\`\`text\n${WIDE_LINE}\n\`\`\`\n\n${TABLE}`;
/** A sent document with a long name: the attachment grid's max-content is that name, so it reaches its cap (F9). */
const DOC_CLIP = `/w/.cc-clips/lane-a-project-a/clip-${'notes-'.repeat(50)}end.md`;
const USER = `${DOC_CLIP}\n${Array.from({ length: 80 }, (_, i) => WORDS[(i + 3) % WORDS.length]).join(' ')}`;
const BACKLOG = {
  type: 'backlog', uuid: 'u-1', offset: 1, file: '/w/t.jsonl', missing: false, searchComplete: true, fileMeasured: true,
  events: [
    { kind: 'assistant', uuid: 'a1', ts: TS, text: ASSISTANT },
    { kind: 'user', uuid: 'q1', ts: TS, text: USER },
  ],
};
const FRAMES = (): object[] => [BACKLOG, { type: 'status', status: 'busy', statusUpdatedAt: null }, ...askFixture(1).frames];

let dist: string | undefined;
let server: DistServer | undefined;
let browser: Browser | undefined;
const figures: Record<string, Measure> = {};

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  const shots = process.env['CCRC_SHOTS'];
  if (shots !== undefined && shots !== '') writeFileSync(path.join(shots, 'chat-width-figures.json'), `${JSON.stringify(figures, null, 2)}\n`);
});

interface Box { left: number; right: number; width: number }
interface Measure {
  rail: boolean;
  /** The column's container: `.chat-item`'s parent, its content width. */
  pane: number;
  /** `.chat-item`'s border box, and its content box (less its padding). */
  column: Box;
  content: Box;
  paragraph: Box;
  /** The paragraph's computed max-width, and `--measure-prose` resolved in the same place. */
  paragraphMax: string;
  /** The h1's and the h2's computed max-width (fix round 1, F3). */
  headingMax: string[];
  measureProse: string;
  /** One ch, and the spec's chat prose measure, in px in the paragraph's own font. */
  ch: number;
  proseMeasure: number;
  code: Box;
  codeScrolls: boolean;
  table: Box;
  ask: Box | null;
  composer: Box;
  bubble: Box;
  attach: Box | null;
  pageSide: number;
}

async function openAndMeasure(view: View): Promise<{ measured: Measure; errors: string[] }> {
  const opened = await openApp(browser!, view, FIXTURE);
  try {
    await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
      servedSocket(ws);
      for (const frame of FRAMES()) ws.send(JSON.stringify(frame));
    });
    await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
    await opened.page.waitForSelector('.chat-item .msg-assist .md-table-wrap', { timeout: 30_000 });
    await opened.page.waitForSelector('.chat-item .msg-user', { timeout: 30_000 });
    if (view.width >= 900) await opened.page.waitForSelector('[data-ask-surface="inline"]', { timeout: 30_000 });
    if (view.skin === REFINED && view.width === 1600) {
      await opened.page.waitForSelector('[data-command="toggle-inspector"]', { timeout: 20_000 });
      const shown = await opened.page.evaluate(() => document.querySelector('.ref-inspector') !== null);
      if (shown !== view.rail) {
        await opened.page.locator('[data-command="toggle-inspector"]').click();
        await opened.page.waitForFunction((want) => (document.querySelector('.ref-inspector') !== null) === want, view.rail);
      }
    }
    await opened.page.waitForTimeout(800); // the first layout, the fonts and the rail's transition settle
    const shots = process.env['CCRC_SHOTS'];
    if (shots !== undefined && shots !== '') {
      mkdirSync(shots, { recursive: true });
      await opened.page.screenshot({ path: path.join(shots, `chat-width-${slug(view)}.png`) });
    }
    const measured = await opened.page.evaluate((proseCh): Measure => {
      const box = (el: Element): Box => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
      };
      const assist = document.querySelector<HTMLElement>('.chat-item .msg-assist')!;
      const item = assist.closest<HTMLElement>('.chat-item')!;
      const cs = getComputedStyle(item);
      const r = item.getBoundingClientRect();
      const padL = parseFloat(cs.paddingLeft);
      const padR = parseFloat(cs.paddingRight);
      const parent = item.parentElement!;
      const ps = getComputedStyle(parent);
      const paragraph = [...assist.children].find((c) => c.tagName === 'P')!;
      const probe = (style: string): HTMLElement => {
        const p = document.createElement('p');
        p.style.cssText = `position:absolute;visibility:hidden;${style}`;
        assist.appendChild(p);
        return p;
      };
      // max-width none: a `p` here is a prose child, which the measure rules would cap.
      const chProbe = probe('max-width:none;width:1ch');
      const measureProbe = probe(`max-width:none;width:${proseCh}ch`);
      const proseProbe = probe('max-width:var(--measure-prose)');
      const out = {
        ch: chProbe.getBoundingClientRect().width,
        proseMeasure: measureProbe.getBoundingClientRect().width,
        measureProse: getComputedStyle(proseProbe).maxWidth,
      };
      chProbe.remove(); measureProbe.remove(); proseProbe.remove();
      const pre = assist.querySelector<HTMLElement>('.code-block pre')!;
      const ask = document.querySelector('[data-ask-surface="inline"]');
      const doc = document.documentElement;
      return {
        rail: document.querySelector('.ref-inspector') !== null,
        pane: parent.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight),
        column: { left: r.left, right: r.right, width: r.width },
        content: { left: r.left + padL, right: r.right - padR, width: r.width - padL - padR },
        paragraph: box(paragraph),
        paragraphMax: getComputedStyle(paragraph).maxWidth,
        headingMax: ['H1', 'H2'].map((tag) => getComputedStyle([...assist.children].find((c) => c.tagName === tag)!).maxWidth),
        ...out,
        code: box(assist.querySelector('.code-block')!),
        codeScrolls: pre.scrollWidth > pre.clientWidth + 1,
        table: box(assist.querySelector('.md-table-wrap')!),
        ask: ask === null ? null : box(ask),
        composer: box(document.querySelector('.composer')!),
        bubble: box(document.querySelector('.chat-item .msg-user')!),
        attach: (() => { const a = document.querySelector('.chat-item .msg-attach'); return a === null ? null : box(a); })(),
        pageSide: doc.scrollWidth - window.innerWidth,
      };
    }, SPEC[view.skin]!.proseCh);
    if (shots !== undefined && shots !== '') {
      // A second picture with the ask put away, after measuring, so the transcript's layout can be seen.
      await opened.page.addStyleTag({ content: '[data-ask-surface] { display: none !important; }' });
      await opened.page.waitForTimeout(300);
      await opened.page.screenshot({ path: path.join(shots, `chat-width-${slug(view)}-transcript.png`) });
    }
    return { measured, errors: opened.errors };
  } finally {
    await opened.ctx.close();
  }
}

const near = (actual: number, expected: number, what: string): void => {
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(1);
};

describe('the chat at a desk: a wide column, prose held to a measure (D-8059)', () => {
  for (const view of VIEWS) {
    describe(named(view), () => {
      let measured: Measure | undefined;
      let errors: string[] = [];
      const desk = view.width >= 900;

      beforeAll(async () => {
        ({ measured, errors } = await openAndMeasure(view));
        figures[slug(view)] = measured;
      }, 90_000);

      if (desk) {
        it('the column is the cap or the pane', () => {
          const m = measured!;
          if (view.skin === REFINED && view.width === 1600) expect(m.rail, 'premise: the rail is as the view says').toBe(view.rail);
          const cap = SPEC[view.skin]!.cap;
          near(m.column.width, cap === null ? m.pane : Math.min(cap, m.pane), 'the column');
        });

        it('prose is held to the chat measure from the column\'s left edge', () => {
          const m = measured!;
          expect(m.proseMeasure, 'premise: the measure resolved in the paragraph\'s font').toBeGreaterThan(0);
          expect(m.paragraph.width).toBeLessThanOrEqual(m.proseMeasure + 1);
          // 900 words fill the line, so the paragraph IS the measure, or the column where that is narrower.
          near(m.paragraph.width, Math.min(m.proseMeasure, m.content.width), 'the paragraph');
          near(m.paragraph.left, m.content.left, 'the paragraph\'s left edge');
        });

        it('code, tables and the composer take the full column', () => {
          const m = measured!;
          const cap = SPEC[view.skin]!.cap;
          const column = cap === null ? m.pane : Math.min(cap, m.pane);
          const content = column - (m.column.width - m.content.width);
          near(m.code.width, content, 'the code block');
          near(m.table.width, content, 'the table');
          expect(m.ask, 'premise: the inline ask is up').not.toBeNull();
          near(m.ask!.width, content, 'the inline ask');
          near(m.ask!.left, m.content.left, 'the inline ask\'s left edge');
          near(m.composer.width, column, 'the composer');
        });

        it('the user bubble sits at the column\'s right edge, at most 70% wide and never wider than the prose', () => {
          const m = measured!;
          near(m.bubble.right, m.content.right, 'the bubble\'s right edge');
          expect(m.bubble.width, `the bubble (${m.bubble.width}) against 70% of ${m.content.width}`).toBeLessThanOrEqual(0.7 * m.content.width + 1);
          // Fix round 1, F2: a user turn is never wider than the reply beside it (Instrument 2560 and Refined 1600 with
          // the rail hidden are where 70% of the column passes the prose).
          expect(m.bubble.width, `the bubble (${m.bubble.width}) against the paragraph (${m.paragraph.width})`).toBeLessThanOrEqual(m.paragraph.width + 1);
          // 80 words fill the bubble, so it reaches its cap: 85%, or a bare 70%, is wider than this where it binds.
          near(m.bubble.width, Math.min(0.7 * m.content.width, m.proseMeasure), 'the bubble at its cap');
          // F9: the attachments above it are never wider than it, and share its right edge.
          expect(m.attach, 'premise: the turn has an attachment').not.toBeNull();
          expect(m.attach!.width, `the attachments (${m.attach!.width}) against the bubble (${m.bubble.width})`).toBeLessThanOrEqual(m.bubble.width + 1);
          near(m.attach!.right, m.content.right, 'the attachments\' right edge');
        });

        it('headings share the paragraphs\' measure', () => {
          const m = measured!;
          expect(m.headingMax, `h1 and h2 against the paragraph's ${m.paragraphMax}`).toEqual([m.paragraphMax, m.paragraphMax]);
        });
      }

      it('no horizontal page scroll', () => {
        const m = measured!;
        expect(m.pageSide).toBeLessThanOrEqual(0);
        expect(m.codeScrolls, 'the 300-column block scrolls inside its well').toBe(true);
        expect(errors).toEqual([]);
      });

      if (!desk) {
        it('390 is unchanged', () => {
          const m = measured!;
          expect(m.paragraphMax, 'the phone paragraph caps at the shared --measure-prose').toBe(m.measureProse);
          // F8: the phone bubble stays at 85% of the column (80 words fill it).
          near(m.bubble.width, 0.85 * m.content.width, 'the phone bubble at 85%');
          near(m.column.width, m.pane, 'the column is the pane');
        });
      }
    });
  }
});
