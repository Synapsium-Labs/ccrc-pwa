// Settings › Integrations › Project linking (the linking standard, D-8147; the compact list, D-8932),
// in a real Chrome over the production build, at 360, 390, 1280, 1470 and 1920, in both skins and both themes.
// `test/project-linking-card.test.tsx` holds the card's behaviour in jsdom; this file holds what only an engine can say:
//   * THE LIST AS IT OPENS. The counts are said once at the head. A row that waits for the operator comes first, open and
//     flagged: each reason with the control that settles it under it, and the rest of its form behind "More settings",
//     which takes no room until it is opened. A linked project is one line, shut; the projects with no team sit behind one
//     group's button, and a row of the shut group takes no room at all. Under 600 of card width a line leads with the name
//     and the rest wraps under it; from 600 its name, team, owner and state sit in columns on one line, in BOTH skins at a
//     laptop's width and wider (the refined skin's card never reaches 760, so the columns start under that).
//   * nothing in the card or on the page scrolls sideways, and no text is cut short or clipped (no ellipsis, no element
//     scrolling inside itself), with a long project name that has to wrap, as drawn and with every row opened;
//   * EVERY ROW OPENED: the layout follows the card's own width, not the window's (a container query): under 480 the cells
//     stack, from 480 key and visibility share a line with the template cell under them, from 760 key, visibility and the
//     template cell share ONE grid line. The hierarchy cell sits under that: its owner select takes a line of its own, and
//     the toggles and the state line share the one under it (D-8184). An unlinked row is its name, its key field, Save
//     and "More settings" on one line from 480; below, the name over the other three;
//   * on a phone the key field and Save share a line, and the select and the template button are as wide as the card;
//   * D-8405: a project the route answers once per checkout directory is ONE row, and the automatic link's line and the
//     candidates' one-tap buttons (long team names and evidence) wrap inside the key cell, at every width and skin;
//   * the keyboard alone opens a line, and the group, and reaches the controls inside; in a row that waits, the control its
//     reason names is the first stop after the line; the act for every project follows its select;
//   * a key cleared on a linked row moves the row into the group, which opens, and focus lands on its key field.
//
// The cases are in two files, because vitest runs the cases of one file serially and as one file they took 870 s in one
// merge-queue run (landing-order wave 1e, D-9026): `project-linking-card-wide.browser.test.ts` holds the sweep over every
// width of THE LIST AS IT OPENS and EVERY ROW OPENED, and this file the rest. Both import their fixture, measures and
// helpers from `projectLinkingCardRig.ts`.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. Run: `( cd pwa && CCRC_CHROME=<a Chrome or
// Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/project-linking-card.browser.test.ts )`.
// `CCRC_SHOTS=<a directory>` keeps a picture of the stale note per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { HIERARCHY_TEXT, NOT_LIVE_WORDS } from '../src/fleet/hierarchyWords';
import { LINKING_ROW_WORDS } from '../src/fleet/linkingWords';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';
import {
  THEMES, SKINS, WIDTHS, named, NOW, wire, LONG_TEAM, measure, assertContained, open, openAll, holdRig,
} from './projectLinkingCardRig';

let dist: string | undefined;
let server: DistServer | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
  holdRig({ browser, server });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('Settings › Integrations › Project linking, per width, skin and theme (D-8147, D-8932)', () => {
  for (const width of [390, 1280]) {
    it(`the keyboard alone opens a line and the group, and reaches the controls inside, at ${width}px`, async () => {
      for (const skin of SKINS) {
        const view: AppView = { skin, theme: 'light', width };
        const { ctx, page, errors, section } = await open(view);
        try {
          const at = named(view);
          const row = section.locator('[data-linking-row="project-d"]');
          const fold = row.locator(':scope > details');
          const line = fold.locator(':scope > summary');
          const isOpen = (): Promise<boolean> => fold.evaluate((d) => (d as HTMLDetailsElement).open);
          expect(await isOpen(), `${at}: project-d starts as one line`).toBe(false);
          await line.focus();
          await page.keyboard.press('Enter');
          expect(await isOpen(), `${at}: Enter opens the line`).toBe(true);
          // Tab goes on into the row: its key field is the first control inside.
          await page.keyboard.press('Tab');
          expect(await page.evaluate(() => document.activeElement?.closest('[data-linking-row]')?.getAttribute('data-linking-row') ?? null), `${at}: Tab enters the row`).toBe('project-d');
          expect(await page.evaluate(() => document.activeElement?.tagName), `${at}: the key field is the first control`).toBe('INPUT');
          await line.focus();
          await page.keyboard.press('Space');
          expect(await isOpen(), `${at}: Space shuts it`).toBe(false);
          // A shut line's controls are out of the tab order: Tab from the line leaves the row.
          await page.keyboard.press('Tab');
          expect(await page.evaluate(() => document.activeElement?.closest('[data-linking-row]')?.getAttribute('data-linking-row') ?? null), `${at}: Tab skips a shut row's controls`).not.toBe('project-d');

          const group = section.locator('[data-linking-group] button');
          await group.focus();
          await page.keyboard.press('Enter');
          expect(await group.getAttribute('aria-expanded'), `${at}: Enter opens the group`).toBe('true');
          const field = section.locator('[data-linking-row="project-e"] input');
          await field.waitFor({ timeout: 30_000 });
          // The first unlinked row's key field follows the group's button in the tab order.
          await page.keyboard.press('Tab');
          expect(await page.evaluate(() => document.activeElement?.closest('[data-linking-row]')?.getAttribute('data-linking-row') ?? null), `${at}: Tab reaches the first unlinked row`).toBe('project-e');
          await page.keyboard.type('zzz');
          expect(await field.inputValue(), `${at}: the key is typed, uppercased`).toBe('ZZZ');

          // A row that waits: the control its reason names is the first stop after its line, and "More settings" the next.
          const focused = (): Promise<string> => page.evaluate(() => {
            const e = document.activeElement;
            return `${e?.closest('[data-linking-row], [data-linking-all]')?.getAttribute('data-linking-row') ?? (e?.closest('[data-linking-all]') ? 'all' : '')}|${e?.textContent ?? ''}`;
          });
          await section.locator('[data-linking-row="project-c"] > details > summary').focus();
          await page.keyboard.press('Tab');
          expect(await focused(), `${at}: the box the reason names comes first`).toBe(`project-c|${HIERARCHY_TEXT.owning}`);
          await page.keyboard.press('Tab');
          expect(await focused(), `${at}: then "More settings"`).toBe(`project-c|${LINKING_ROW_WORDS.more}`);
          await page.keyboard.press('Enter');
          await page.keyboard.press('Tab');
          expect(await page.evaluate(() => document.activeElement?.tagName), `${at}: "More settings" opens onto the key field`).toBe('INPUT');

          // The coordinator for every project: the act is drawn beside its select, and Tab reaches it next, before the "show" control.
          const all = section.locator('[data-linking-all]');
          await all.locator('select').selectOption('cc-coord-a');
          await all.locator('select').focus();
          await page.keyboard.press('Tab');
          expect(await focused(), `${at}: the act follows its select`).toBe(`all|${HIERARCHY_TEXT.allAct}`);
          await page.keyboard.press('Tab');
          expect(await focused(), `${at}: the "show" control follows the act`).toBe(`all|${NOT_LIVE_WORDS.show(1)}`);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }
    }, 120_000);
  }

  for (const width of [360, 1920]) {
    it(`a failed re-read after a write shows the stale note and Read again, contained, at ${width}px`, async () => {
      for (const skin of SKINS) {
        const view: AppView = { skin, theme: 'light', width };
        const { ctx, page, errors, section } = await open(view);
        try {
          // The hierarchy read fails from now on: the write below saves (the fixture answers it), and its re-read is refused.
          await ctx.route('**/api/hierarchy', (route) => route.abort('failed'));
          // project-a waits, so File into initiatives is behind its "More settings".
          await section.locator('[data-linking-row="project-a"] [data-linking-rest]').click();
          await section.locator('[data-linking-row="project-a"]').getByRole('checkbox', { name: HIERARCHY_TEXT.initiatives }).click();
          const note = section.locator('.linking-stale');
          await note.waitFor({ timeout: 30_000 });
          expect(await note.getByRole('button', { name: HIERARCHY_TEXT.readAgain }).count()).toBe(1);
          await openAll(section);
          const m = await section.evaluate(measure);
          assertContained(m, named(view));
          const box = await note.boundingBox();
          const card = await section.locator('.linking-card').boundingBox();
          expect(box!.x, `${named(view)}: the stale note starts left of the card`).toBeGreaterThanOrEqual(card!.x - 0.5);
          expect(box!.x + box!.width, `${named(view)}: the stale note runs past the card`).toBeLessThanOrEqual(card!.x + card!.width + 0.5);
          const button = await note.getByRole('button').boundingBox();
          expect(button!.width, `${named(view)}: Read again keeps its usual size`).toBeLessThan(box!.width);
          const shots = process.env.CCRC_SHOTS;
          if (shots) await section.screenshot({ path: path.join(shots, `project-linking-stale-${skin}-${width}.png`) });
          void page;
          expect(errors.filter((e) => !/Failed to fetch|net::ERR/.test(e))).toEqual([]);
        } finally {
          await ctx.close();
        }
      }
    }, 120_000);
  }

  for (const width of [390, 1280]) {
    it(`a key cleared on a linked row moves it into the group, which opens, and focus lands on its key field, at ${width}px`, async () => {
      for (const skin of SKINS) {
        const view: AppView = { skin, theme: 'light', width };
        const { ctx, page, errors, section } = await open(view);
        try {
          const at = named(view);
          const row = section.locator('[data-linking-row="project-d"]');
          const group = section.locator('[data-linking-group] button');
          expect(await group.getAttribute('aria-expanded'), `${at}: the group starts shut`).toBe('false');
          await row.locator(':scope > details > summary').click();
          const field = row.locator('.linking-key-line input');
          await field.fill('');
          await field.press('Enter');
          await section.locator('[data-linking-row="project-d"][data-linking-kind="unlinked"]').waitFor({ timeout: 30_000 });
          expect(await group.getAttribute('aria-expanded'), `${at}: the group opened on the row`).toBe('true');
          expect(await group.textContent(), `${at}: the group counts it`).toBe('3 projects not linked to Linear');
          // The field that was typed in is gone with the row's old place: focus is on the row's field where it now sits.
          await page.waitForFunction(() => {
            const e = document.activeElement;
            return e?.tagName === 'INPUT' && e.closest('[data-linking-row]')?.getAttribute('data-linking-row') === 'project-d';
          }, undefined, { timeout: 30_000 });
          expect(await row.locator('.linking-key-line input').getAttribute('aria-label'), `${at}: the field is named for its project`).toBe(LINKING_ROW_WORDS.keyFor('project-d'));
          expect(await row.locator('.linking-result').textContent(), `${at}: its answer came with it`).toContain('Saved.');
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }
    }, 120_000);
  }

  it('at 1280 an opened row holds its three cells on one line wherever the card is 760 px or wider, and the template cell wraps under them elsewhere', async () => {
    const seen: string[] = [];
    for (const skin of SKINS) {
      const view: AppView = { skin, theme: 'light', width: 1280 };
      const { ctx, section } = await open(view);
      try {
        await openAll(section);
        const m = await section.evaluate(measure);
        const first = m.rows[0]!;
        const { key, visibility, template } = first.cells;
        seen.push(`${skin}: card ${Math.round(m.body.box.width)}px`);
        expect(Math.abs(visibility.top - key.top), `${skin} at 1280`).toBeLessThan(1);
        if (m.body.box.width >= 760) {
          expect(Math.abs(template.top - key.top), `${skin} at 1280`).toBeLessThan(1);
        } else {
          expect(template.top, `${skin} at 1280: the template cell wraps to the row's second line`).toBeGreaterThan(key.top + 1);
        }
      } finally {
        await ctx.close();
      }
    }
    expect(seen.length).toBe(SKINS.length);
  }, 120_000);

  // D-8808 (wave 8, Task 8.6): the workspace picker and candidate rows that name a workspace, a long suggestion's reason and an
  // Overlord link's line, at every width, in both skins and both themes: all wrap inside the key cell, and nothing scrolls sideways.
  for (const width of WIDTHS) {
    it(`the workspace picker, candidates with workspaces and an Overlord link stay inside the key cell at ${width}px`, async () => {
      const WS = (id: string, name: string, keys: string[]) => ({
        state: 'connected', outcome: 'ok', org: name, id, name, urlKey: id.slice(0, 4) === '1111' ? 'ws-a' : 'ws-b', user: 'user-a', keyTail: 'abcd', checkedAt: NOW - 60_000,
        teams: keys.map((key) => ({ key, name: key })),
      });
      const long = 'a suggested reason long enough that it has to wrap onto several lines on a phone screen';
      const fixture: AppFixture = {
        api: {
          '/api/hierarchy': { ok: true, coordinators: [], projects: [] },
          '/api/linear/workspaces': {
            ok: true, store: 'ok', legacy: null,
            workspaces: [WS('11111111-1111-4111-8111-111111111111', 'ws-a', ['AAA']), WS('22222222-2222-4222-8222-222222222222', 'ws-b-with-a-rather-long-workspace-name', ['AAA'])],
          },
          '/api/accounts': { accounts: [], projected: null, roster: [] },
          '/api/feed': { events: [] },
          '/api/projects': {
            roots: ['/w'],
            projects: [
              { name: 'project-a', workdir: '/w/project-a', linking: wire({ teamKey: 'AAA', teamWorkspace: '11111111-1111-4111-8111-111111111111' }) },
              { name: 'project-b', workdir: '/w/project-b', linking: wire({
                teamKey: null, teamCandidates: [
                  { key: 'AAA', name: LONG_TEAM, evidence: { kind: 'pr-attachments', ids: 4, of: 5 }, workspaceId: '11111111-1111-4111-8111-111111111111', workspaceName: 'ws-a' },
                  { key: 'AAA', name: LONG_TEAM, evidence: { kind: 'suggested', by: 'cc-coord-with-a-long-identifier', why: long }, workspaceId: '22222222-2222-4222-8222-222222222222', workspaceName: 'ws-b-with-a-rather-long-workspace-name' },
                ],
              }) },
              { name: 'project-c', workdir: '/w/project-c', linking: wire({
                teamKey: 'AAA', teamLink: { source: 'overlord', teamName: LONG_TEAM, evidence: { kind: 'ticket-ids', ids: 1234, of: 1250 }, at: NOW - 60_000, callId: 7 },
              }) },
            ],
          },
        },
        fleetFrames: [{ type: 'fleet', sessions: [] }, { type: 'coord', coord: { pause: 'clear' } }],
      };
      for (const skin of SKINS) for (const theme of THEMES) {
        const view: AppView = { skin, theme, width };
        const app = await openApp(browser!, view, fixture);
        try {
          await app.page.goto(server!.origin + '/settings/integrations');
          const section = app.page.locator('[data-linking="section"]');
          await section.locator('[data-linking-row]').first().waitFor({ timeout: 30_000 });
          // project-b waits on its suggested teams, so it comes first; project-a and project-c are linked with nothing to decide
          // (one line each): open every row to measure its key cell.
          await openAll(section);
          await section.locator('[data-linking-workspace]').first().waitFor({ timeout: 30_000 });
          const at = named(view);
          const m = await section.evaluate((el) => {
            const box = (e: Element) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
            const rows = [...el.querySelectorAll('[data-linking-row]')].map((r) => {
              const key = box(r.querySelector('.linking-key')!);
              const inside = [...r.querySelectorAll('.linking-workspace, .linking-workspace select, .linking-candidate, .linking-candidate p, .linking-candidate button, .linking-auto, .linking-key a')].map(box);
              return { name: r.getAttribute('data-linking-row') ?? '', key, inside,
                pickers: r.querySelectorAll('[data-linking-workspace]').length, candidates: r.querySelectorAll('.linking-candidate').length,
                call: r.querySelectorAll('.linking-key a').length };
            });
            return {
              rows, pageScroll: document.documentElement.scrollWidth, pageClient: document.documentElement.clientWidth,
              clipped: [...el.querySelectorAll('*')].filter((e) => e.tagName !== 'SELECT' && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0).map((e) => e.tagName.toLowerCase() + '.' + (e.getAttribute('class') ?? '')),
              ellipsis: [...el.querySelectorAll('*')].filter((e) => getComputedStyle(e).textOverflow === 'ellipsis').length,
            };
          });
          expect(m.rows.map((r) => [r.name, r.pickers, r.candidates, r.call]), `${at}: a picker for a key two workspaces hold, two candidate rows, the call link`)
            .toEqual([['project-b', 0, 2, 0], ['project-a', 1, 0, 0], ['project-c', 1, 0, 1]]);
          for (const r of m.rows) for (const b of r.inside) {
            expect(b.right, `${at}: ${r.name} runs past its key cell`).toBeLessThanOrEqual(r.key.right + 0.5);
            expect(b.left, `${at}: ${r.name} starts left of its key cell`).toBeGreaterThanOrEqual(r.key.left - 0.5);
          }
          expect(m.pageScroll, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(m.pageClient);
          expect(m.clipped, `${at}: an element is wider than its box`).toEqual([]);
          expect(m.ellipsis, `${at}: text is cut short`).toBe(0);
          expect(app.errors.filter((e) => !/Failed to fetch|net::ERR/.test(e))).toEqual([]);
        } finally {
          await app.ctx.close();
        }
      }
    }, 240_000);
  }
});
