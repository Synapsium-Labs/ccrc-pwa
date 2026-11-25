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
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. Run: `( cd pwa && CCRC_CHROME=<a Chrome or
// Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/project-linking-card.browser.test.ts )`.
// `CCRC_SHOTS=<a directory>` keeps two pictures per view: the list as it opens, and with every row opened.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { HIERARCHY_TEXT, NOT_LIVE_WORDS } from '../src/fleet/hierarchyWords';
import { LINKING_ROW_WORDS, linkingCountsWords } from '../src/fleet/linkingWords';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';
import {
  THEMES, SKINS, WIDTHS, named, TITLE, NOW, LONG_NAME, wire, LONG_TEAM, PROJECTS, LISTED, WAITING, UNLINKED, CONTROLS,
  type Box, measure, assertContained, bandOf, LINE_COLUMNS, open, openAll, measureList, holdRig,
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
  for (const width of WIDTHS) {
    it(`the list as it opens at ${width}px: one line per linked project, waiting rows open and flagged, the rest behind the group; nothing overflows`, async () => {
      for (const skin of SKINS) {
        for (const theme of THEMES) {
          const view: AppView = { skin, theme, width };
          const { ctx, errors, section } = await open(view);
          try {
            const at = named(view);
            expect(await section.getByRole('heading', { name: TITLE }).count()).toBe(1);
            const m = await section.evaluate(measureList);
            const shots = process.env.CCRC_SHOTS;
            if (shots) await section.screenshot({ path: path.join(shots, `project-linking-${skin}-${theme}-${width}.png`) });
            // One row per project that carries a cell: the rows that wait, then the linked ones, then the group and the unlinked ones.
            expect(m.order, `${at}: the order`).toEqual([...LISTED, '(group)', ...UNLINKED]);
            expect(m.counts, `${at}: the counts, said once at the head`).toBe(linkingCountsWords({ decisions: 3, linked: 1, unlinked: 2 }));
            expect(m.group?.text, `${at}: the group counts its projects`).toBe('2 projects not linked to Linear');
            expect(m.group?.expanded, `${at}: the group is shut`).toBe('false');
            for (const l of m.lines) {
              if (UNLINKED.includes(l.name)) {
                expect(l.kind, `${at}: ${l.name}`).toBe('unlinked');
                expect(l.hidden, `${at}: ${l.name} is hidden while the group is shut`).toBe(true);
                // `hidden` must take the row out of the layout: a row of a shut group takes no room.
                expect(l.row.height, `${at}: ${l.name} takes room in a shut group`).toBe(0);
                continue;
              }
              const waits = WAITING.includes(l.name);
              expect(l.kind, `${at}: ${l.name}`).toBe(waits ? 'decision' : 'linked');
              expect(l.open, `${at}: ${l.name} is ${waits ? 'not open' : 'not one line'}`).toBe(waits);
              expect(l.flagged, `${at}: ${l.name}'s flag`).toBe(waits);
              expect(l.reasons > 0, `${at}: ${l.name}'s reasons`).toBe(waits);
              // The line is the row's whole width and at least a tap tall, so the whole line opens it.
              expect(l.summary!.height, `${at}: ${l.name}'s line is under the tap floor`).toBeGreaterThanOrEqual(43.5);
              expect(l.summary!.width, `${at}: ${l.name}'s line is not the row's width`).toBeGreaterThan(l.row.width - 2);
              if (!waits) expect(l.row.height, `${at}: ${l.name} is more than its line`).toBeLessThanOrEqual(l.summary!.height + 2);
              const [name, ...rest] = l.parts as [Box, ...Box[]];
              expect(rest.length, `${at}: ${l.name}'s line has its parts`).toBeGreaterThanOrEqual(1);
              for (const part of [...l.parts, ...(l.extra === null ? [] : [l.extra])]) {
                expect(part.right, `${at}: ${l.name}'s line runs past its row`).toBeLessThanOrEqual(l.row.right + 0.5);
                expect(part.left, `${at}: ${l.name}'s line starts left of its row`).toBeGreaterThanOrEqual(l.row.left - 0.5);
              }
              expect(l.extra !== null, `${at}: ${l.name} draws its flag and notes`).toBe(waits || l.notes.length > 0);
              if (m.body.width >= LINE_COLUMNS) {
                // Columns: every part sits on the line's one grid line (their baselines are aligned, so a part in a smaller
                // size starts a few pixels lower: each overlaps the name's own line), each to the right of the one before.
                for (const part of rest) {
                  expect(part.top < name.bottom && part.bottom > name.top, `${at}: ${l.name}'s line is not one grid line at ${Math.round(m.body.width)}px`).toBe(true);
                }
                for (let i = 1; i < l.parts.length; i++) expect(l.parts[i]!.left, `${at}: ${l.name}'s columns`).toBeGreaterThan(l.parts[i - 1]!.left);
                // The flag and the notes take the line under the columns, from the team's column on: the columns are the same on every row.
                if (l.extra !== null) {
                  expect(l.extra.top, `${at}: ${l.name}'s flag and notes are not under its columns`).toBeGreaterThanOrEqual(Math.max(...l.parts.map((part) => part.bottom)) - 0.5);
                  expect(Math.abs(l.extra.left - rest[0]!.left), `${at}: ${l.name}'s flag and notes do not start at the team's column`).toBeLessThan(1);
                }
              } else {
                // The name leads on a line of its own; the rest wraps under it.
                for (const part of [...rest, ...(l.extra === null ? [] : [l.extra])]) {
                  expect(part.top, `${at}: ${l.name}'s parts are not under its name at ${Math.round(m.body.width)}px`).toBeGreaterThanOrEqual(name.bottom - 0.5);
                }
              }
              // A row that waits: each reason has the control that settles it directly under it, then "More settings", shut,
              // and what it has not shown takes no room. A row that does not wait has none of it.
              expect(l.slots.map((x) => x.control), `${at}: ${l.name}'s controls under its reasons`).toEqual(CONTROLS[l.name] ?? []);
              for (const x of l.slots) {
                expect(x.reasons.length, `${at}: ${l.name}'s ${x.control} has no reason over it`).toBeGreaterThanOrEqual(1);
                expect(x.controls.length, `${at}: ${l.name}'s ${x.control} reason has no control under it`).toBeGreaterThanOrEqual(1);
                const under = Math.max(...x.reasons.map((b) => b.bottom));
                for (const c of x.controls) {
                  expect(c.top, `${at}: ${l.name}'s ${x.control} control is not under its reason`).toBeGreaterThanOrEqual(under - 0.5);
                  expect(c.right, `${at}: ${l.name}'s ${x.control} control runs past its row`).toBeLessThanOrEqual(l.row.right + 0.5);
                }
              }
              expect(l.more !== null, `${at}: ${l.name}'s "More settings"`).toBe(waits);
              if (l.more !== null) {
                expect(l.more.expanded, `${at}: ${l.name}'s "More settings" starts shut`).toBe('false');
                expect(l.more.rest.height, `${at}: ${l.name}'s other settings take room before they are asked for`).toBe(0);
                expect(l.more.box.height, `${at}: ${l.name}'s "More settings" is under the tap floor`).toBeGreaterThanOrEqual(43.5);
              }
            }
            // The columns are for both skins at a laptop's width and wider: the refined card is narrower than its 760 px page column.
            if (width >= 1280) expect(m.body.width, `${at}: the card is too narrow for the line's columns`).toBeGreaterThanOrEqual(LINE_COLUMNS);
            // What Tab reaches before the group: a waiting row is its line, the controls its reasons name and "More settings".
            const stops = Object.fromEntries(m.lines.map((l) => [l.name, l.stops]));
            expect(stops['project-c'], `${at}: project-c's stops`).toEqual(['line', HIERARCHY_TEXT.owning, LINKING_ROW_WORDS.more]);
            expect(stops['project-d'], `${at}: project-d's stops`).toEqual(['line']);
            expect(stops[LONG_NAME], `${at}: the suggested row's stops`).toEqual(['line', 'key', 'Save', 'Link ABCDEFGHIJKLMNOP', 'Link BBB', LINKING_ROW_WORDS.more]);
            expect(stops['project-a'], `${at}: project-a's stops`)
              .toEqual(['line', HIERARCHY_TEXT.owning, HIERARCHY_TEXT.mapWaiting, 'select', NOT_LIVE_WORDS.show(1), LINKING_ROW_WORDS.more]);
            // The line names what differs from a quiet row.
            const notes = Object.fromEntries(m.lines.map((l) => [l.name, l.notes]));
            expect(notes['project-a'], `${at}: project-a's notes`).toEqual(['3 inbound issues waiting', LINKING_ROW_WORDS.noTemplate]);
            expect(notes['project-c'], `${at}: project-c's notes`).toEqual([LINKING_ROW_WORDS.public]);
            expect(notes['project-d'], `${at}: project-d's notes`).toEqual([LINKING_ROW_WORDS.notRead]);
            expect(m.ellipsis, `${at}: text is cut short with an ellipsis`).toEqual([]);
            expect(m.clipped, `${at}: an element is wider than its box`).toEqual([]);
            expect(m.pageScrollWidth, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(m.pageClientWidth);
            expect(m.body.right, `${at}: the card runs past the viewport`).toBeLessThanOrEqual(m.viewport);
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        }
      }
    }, 240_000);

    it(`every row opened at ${width}px: no horizontal overflow and no clipped text, in both skins and both themes`, async () => {
      for (const skin of SKINS) {
        for (const theme of THEMES) {
          const view: AppView = { skin, theme, width };
          const { ctx, errors, section } = await open(view);
          try {
            await openAll(section);
            const m = await section.evaluate(measure);
            const shots = process.env.CCRC_SHOTS;
            if (shots) await section.screenshot({ path: path.join(shots, `project-linking-open-${skin}-${theme}-${width}.png`) });
            expect(m.rows.map((r) => r.name), 'one row per project that carries a cell').toEqual(PROJECTS.map((p) => p.name));
            expect(m.rows[0]!.extras.length, 'project-a\'s automatic link line').toBe(1);
            expect(m.rows[1]!.extras.length, 'two candidates, each a button and an evidence line').toBe(4);
            assertContained(m, named(view));

            const at = named(view);
            const cardWidth = m.body.box.width;
            for (const r of m.rows) {
              const band = bandOf(cardWidth);
              const { name, key, visibility, template } = r.cells;
              const plain = UNLINKED.includes(r.name);
              if (plain) {
                // An unlinked row: its name, key field, Save and "More settings" on one line from 480; below, the name over the
                // other three, which share a line. The rest sits under them, in "More settings".
                const more = r.plainMore!;
                const [field] = r.keyLine as [Box, ...Box[]];
                expect(more.top < field.bottom && more.bottom > field.top, `${at}: ${r.name}'s "More settings" is not on its key field's line`).toBe(true);
                expect(more.left, `${at}: ${r.name}'s "More settings" is not after its key cell`).toBeGreaterThanOrEqual(key.right - 0.5);
                expect(more.right, `${at}: ${r.name}'s "More settings" runs past its row`).toBeLessThanOrEqual(r.row.right + 0.5);
                if (band === 'stack') expect(key.top, `${at}: ${r.name}'s key is not under its name`).toBeGreaterThanOrEqual(name.bottom - 0.5);
                else {
                  expect(name.top < field.bottom && name.bottom > field.top, `${at}: ${r.name}'s key is not beside its name at ${cardWidth}px`).toBe(true);
                  expect(key.left).toBeGreaterThan(name.left);
                }
                expect(visibility.top, `${at}: ${r.name}'s other settings are not under its key`).toBeGreaterThanOrEqual(key.bottom - 0.5);
              } else {
                // A listed row: its controls sit under its line.
                expect(key.top, `${at}: ${r.name}'s controls are not under its line`).toBeGreaterThanOrEqual(name.bottom - 0.5);
              }
              // The key cell leads the form's first line unless it is elsewhere: on an unlinked row's own line, or under a reason.
              const keyApart = plain || r.keyLifted;
              if (band === 'line') {
                // The controls' first line: the cells start at the same height.
                const first = keyApart ? [visibility, template] : [key, visibility, template];
                for (const c of first) expect(Math.abs(c.top - first[0]!.top), `${at}: ${r.name}'s cells are not on one line at ${cardWidth}px`).toBeLessThan(1);
                expect(template.left).toBeGreaterThan(visibility.left);
                if (!keyApart) expect(visibility.left).toBeGreaterThan(key.left);
              } else if (band === 'three') {
                // Key and visibility on one line, the template cell on the row under them.
                if (!keyApart) expect(Math.abs(visibility.top - key.top), `${at}: ${r.name}'s first line at ${cardWidth}px`).toBeLessThan(1);
                expect(template.top, `${at}: ${r.name}'s template cell is not under the line at ${cardWidth}px`).toBeGreaterThanOrEqual(visibility.top + 1);
              } else {
                // Stacked: each cell under the one before.
                expect(visibility.top).toBeGreaterThanOrEqual(key.bottom - 0.5);
                expect(template.top).toBeGreaterThanOrEqual(visibility.bottom - 0.5);
                // The select is as wide as the card's row, and so is the template button.
                expect(r.select.width, `${at}: ${r.name}'s select is not full width`).toBeGreaterThan(r.row.width - 2);
                if (r.button !== null) expect(r.button.width, `${at}: ${r.name}'s button is not full width`).toBeGreaterThan(r.row.width - 2);
              }
              // The key field and Save share a line at 390 and wider (360 may wrap Save under the field).
              if (width >= 390) {
                const [field, save] = r.keyLine;
                expect(Math.abs(save!.top - field!.top), `${at}: ${r.name}'s Save is not beside its field (key cell ${Math.round(r.cells.key.width)}px, field ${Math.round(field!.width)}px, Save ${Math.round(save!.width)}px)`).toBeLessThan(8);
              }
            }
            // D-8184: every project's row has its hierarchy cell inside it; the owning-project control draws for the shared key only.
            expect(Object.keys(m.hier), `${at}: a hierarchy cell per row`).toEqual(PROJECTS.map((p) => p.name));
            expect(Object.entries(m.hier).filter(([, h]) => h.owning).map(([n]) => n).sort(), `${at}: the shared key`).toEqual(['project-a', 'project-c']);
            // project-a's Linear owner is drawn under its reason (its inbound issues have no live owner); every other row's is in the cell.
            expect(Object.entries(m.hier).filter(([, h]) => h.ownerLifted).map(([n]) => n), `${at}: the owner under a reason`).toEqual(['project-a']);
            for (const r of m.rows) {
              const h = m.hier[r.name]!;
              expect(h.cell.right, `${at}: ${r.name}'s hierarchy cell runs past its row`).toBeLessThanOrEqual(r.row.right + 0.5);
              expect(h.cell.top, `${at}: ${r.name}'s hierarchy cell is not under the first line`).toBeGreaterThan(r.cells.name.top + 1);
              expect(h.owner.right, `${at}: ${r.name}'s owner select runs past its row`).toBeLessThanOrEqual(r.row.right + 0.5);
              const { ownerCell: owner, toggles, state } = h;
              // The owner comes before the toggles and the state, in the cell or above it.
              expect(toggles.top, `${at}: ${r.name}'s toggles are not under the owner select`).toBeGreaterThanOrEqual(owner.bottom - 0.5);
              if (cardWidth < 480) {
                expect(h.owner.width, `${at}: ${r.name}'s owner select is not full width`).toBeGreaterThan(r.row.width - 2);
                expect(state.top).toBeGreaterThanOrEqual(toggles.bottom - 0.5);
              } else {
                // A7: the owner select has a line of its own; the toggles and the state line share the one under it.
                expect(Math.abs(state.top - toggles.top), `${at}: ${r.name}'s second line at ${cardWidth}px`).toBeLessThan(1);
              }
            }
            // D-8186: Reshape in Linear draws for the two projects that are not migrated and carry a team key (project-c, project-d), whole
            // inside the state cell and the row, its words not cut; on a phone it is as wide as the cell.
            expect(Object.entries(m.hier).filter(([, h]) => h.reshape !== null).map(([n]) => n), `${at}: Reshape in Linear`).toEqual(['project-c', 'project-d']);
            for (const [n, h] of Object.entries(m.hier)) {
              if (h.reshape === null) continue;
              const r = m.rows.find((x) => x.name === n)!;
              const state = h.state;
              expect(h.reshapeText, `${at}: ${n}'s Reshape words`).toBe(HIERARCHY_TEXT.reshape);
              expect(h.reshape.left, `${at}: ${n}'s Reshape starts left of its cell`).toBeGreaterThanOrEqual(state.left - 0.5);
              expect(h.reshape.right, `${at}: ${n}'s Reshape runs past its cell`).toBeLessThanOrEqual(state.right + 0.5);
              expect(h.reshape.right, `${at}: ${n}'s Reshape runs past its row`).toBeLessThanOrEqual(r.row.right + 0.5);
              expect(h.reshape.height, `${at}: ${n}'s Reshape has no height`).toBeGreaterThan(0);
              if (cardWidth < 480) expect(h.reshape.width, `${at}: ${n}'s Reshape is not full width`).toBeGreaterThan(state.width - 2);
            }
            // The all-projects act sits at the card's end, under every row, and wraps nothing past the card.
            const { all } = m;
            expect(all.box.top, `${at}: the all-projects act is not at the card's end`).toBeGreaterThanOrEqual(m.rows[m.rows.length - 1]!.row.bottom - 0.5);
            expect(all.box.right, `${at}: the all-projects act runs past the card`).toBeLessThanOrEqual(m.body.box.right + 0.5);
            if (cardWidth < 480) {
              expect(all.select.width, `${at}: the all-projects select is not full width`).toBeGreaterThan(all.box.width - 2);
              expect(all.button.width, `${at}: the all-projects button is not full width`).toBeGreaterThan(all.box.width - 2);
              expect(all.button.top).toBeGreaterThanOrEqual(all.select.bottom - 0.5);
            } else {
              expect(all.button.left, `${at}: the all-projects button is not beside its select`).toBeGreaterThanOrEqual(all.select.right - 0.5);
              expect(Math.abs(all.button.bottom - all.select.bottom), `${at}: the all-projects button and select do not share a line`).toBeLessThan(2);
            }
            // The state line wraps inside its cell, never past it (project-a's reads "3 inbound issues wait for an owner").
            for (const r of m.rows) {
              const h = m.hier[r.name]!;
              for (const k of h.stateKids) expect(k.right, `${at}: ${r.name}'s state line runs past its cell`).toBeLessThanOrEqual(h.state.right + 0.5);
            }
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        }
      }
    }, 240_000);
  }

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
