// Chrome measures the transcript's tool-well palette, stripped controls and fit over the production build (D-6387).
// Run: `( cd pwa && CCRC_CHROME=<Chrome> ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 --no-file-parallelism browser/tool-well-colour.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { ANSI_HUE_TOKEN } from '../src/lib/ansi';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

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
const COMMAND = 'printf "hello from project-a"';
const EVENTS = [
  { kind: 'user', uuid: 'q1', ts: TS, text: 'Run the check.' },
  { kind: 'assistant', uuid: 'a1', ts: TS, text: 'Running it.' },
  { kind: 'tool_use', uuid: 'u1', ts: TS, toolId: 't1', name: 'Bash',
    input: JSON.stringify({ description: 'Check \x1b[31moutput\x1b[0m', command: COMMAND }) },
  { kind: 'tool_result', ts: TS, toolId: 't1', text: [30, 31, 32, 33, 34, 35, 36].map((n) => `\x1b[${n}m${n}\x1b[0m`).join(' ') + '\x1b[2K\x1b]0;title\x07', isError: false },
  { kind: 'tool_use', uuid: 'u2', ts: TS, toolId: 't2', name: 'Bash', input: 'literal\x1b[2Kinput' },
  { kind: 'tool_result', ts: TS, toolId: 't2', text: 'ok', isError: false },
];
let dist: string | undefined;
let server: DistServer | undefined;
let browser: Browser | undefined;
beforeAll(async () => {
  const executablePath = resolveChrome();
  dist = buildDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);
afterAll(async () => { await browser?.close(); await server?.close(); removeDist(dist); });

describe('an expanded Bash card shows its command and output in palette hues on the well, no escape byte visible, no sideways scroll', () => {
  for (const view of VIEWS) {
    it(`${view.skin}, ${view.theme}, ${view.width}px`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await ctx.routeWebSocket(/\/ws\/session\//, (ws) => ws.send(JSON.stringify({
          type: 'backlog', uuid: 'u-1', events: EVENTS, offset: 1, file: '/w/t.jsonl', missing: false,
          searchComplete: true, fileMeasured: true,
        })));
        await page.goto(`${server!.origin}/s/${SESSION.id}`);
        await page.waitForSelector('.chat-item', { timeout: 20_000 });
        const groups = page.locator('.ref-tool-group-row');
        for (let i = 0; i < await groups.count(); i += 1) {
          const group = groups.nth(i);
          if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
        }
        const cards = page.locator('.toolcard').filter({ has: page.locator('.tool-name', { hasText: 'Bash' }) });
        const card = cards.nth(0);
        const rawCard = cards.nth(1);
        await rawCard.locator('.tool-row').click();
        expect(await rawCard.locator('.well').first().textContent()).toBe('literalinput');
        await card.locator('.tool-row').click();
        await expect.poll(() => card.locator('.well').count()).toBe(2);
        const m = await card.evaluate((element, hueTokens) => {
          const wells = [...element.querySelectorAll<HTMLElement>('.well')];
          const probe = document.createElement('span');
          document.body.append(probe);
          const token = (name: string): string => {
            probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(name);
            return getComputedStyle(probe).color;
          };
          const bg = token('--bg-well');
          const hues = Object.entries(hueTokens).map(([hue, name]) => ({
            hue, actual: wells[1]?.querySelector<HTMLElement>(`.ansi-${hue}`) ? getComputedStyle(wells[1].querySelector<HTMLElement>(`.ansi-${hue}`)!).color : null,
            expected: token(name),
          }));
          const stringToken = token('--syn-string');
          probe.remove();
          const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          let escape = false;
          while (walk.nextNode()) if (walk.currentNode.textContent?.includes('\x1b')) escape = true;
          const scroller = document.querySelector<HTMLElement>('.chat-scroller');
          return {
            input: wells[0]?.querySelector('.hljs')?.textContent ?? null,
            hues, stringToken,
            stringColour: wells[0]?.querySelector<HTMLElement>('.hljs-string') ? getComputedStyle(wells[0].querySelector<HTMLElement>('.hljs-string')!).color : null,
            backgrounds: wells.map((well) => getComputedStyle(well).backgroundColor), bg,
            escape, text: wells.map((well) => well.textContent ?? '').join(''), styled: wells.flatMap((well) => [...well.querySelectorAll('[style]')]).length,
            scrollerSide: scroller ? scroller.scrollWidth - scroller.clientWidth : -1,
            pageSide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        }, ANSI_HUE_TOKEN);
        expect(m.input).toBe(`# Check output\n${COMMAND}`);
        expect(m.hues).toHaveLength(7);
        for (const hue of m.hues) expect(hue.actual, hue.hue).toBe(hue.expected);
        expect(m.stringColour).toBe(m.stringToken);
        expect(m.backgrounds).toEqual([m.bg, m.bg]);
        const surfaces = await page.evaluate(() => {
          const host = document.createElement('div');
          host.innerHTML = '<div class="msg-assist"><code class="md-code">x</code></div><article class="msg-assist doc-body"><code class="md-code">x</code></article><div class="msg-assist compaction-body"><code class="md-code">x</code></div>';
          document.body.append(host);
          const probe = document.createElement('span');
          document.body.append(probe);
          const colour = (name: string) => { probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(name); return getComputedStyle(probe).color; };
          const samples = [...host.querySelectorAll('code')].map((el) => {
            const s = getComputedStyle(el);
            return { colour: s.color, background: s.backgroundColor, border: s.borderColor, font: s.font, padding: s.padding, radius: s.borderRadius };
          });
          const expected = { primary: colour('--ink-primary'), raised: colour('--bg-raised'), edge: colour('--edge-subtle'), ink: colour('--ink-on-well'), well: colour('--bg-well'), hair: colour('--well-bar-hair') };
          host.remove(); probe.remove();
          return { samples, expected };
        });
        const [message, doc, compact] = surfaces.samples;
        expect(message).toMatchObject({ colour: surfaces.expected.ink, background: surfaces.expected.well, border: surfaces.expected.hair });
        for (const surface of [doc, compact]) {
          expect(surface).toMatchObject({ colour: surfaces.expected.primary, background: surfaces.expected.raised, border: surfaces.expected.edge });
          expect([surface?.font, surface?.padding, surface?.radius]).toEqual([message?.font, message?.padding, message?.radius]);
        }
        expect(m.escape).toBe(false);
        expect(m.text).not.toMatch(/\[\d+(?:;\d+)*[a-zA-Z]/);
        expect(m.styled).toBe(0);
        expect(m.scrollerSide).toBe(0);
        expect(m.pageSide).toBe(0);
        expect(errors).toEqual([]);
      } finally { await ctx.close(); }
    });
  }
});
