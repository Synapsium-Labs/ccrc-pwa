// Delegation broker wave 4, PR2 Task 2.7 (W4-U27, spec §5.13), as fix round 1 of review 1029 (F1) rebuilt it: an older
// server sends no `delegation` frame, and the screen then claims nothing about delegated work. What it draws is what
// PR2's base drew for the same world, rendered by the base's own code (`fixtures/older-server/render-3ce530dad.json`,
// whose `capture` says how) and compared byte for byte. The one declared difference is each fleet list's
// `data-delegation="unavailable"`, the backup banner's empty slot (D-7860), which the base predates, and the fleet
// header's Docs, Account and Mail doors, which the base drew and today's head does not: they open places the phone's bottom
// bar holds (desktop-polish PL10, D-7952; the Account door's name had changed to lead with its word, D-7897, before it went),
// the programme box's title, which is now a door into its programme view, wrapped round the base's same title span (PL10, D26
// amended), and the projects head over each fleet screen's list with its New project door (add-project spec 2026-11-04 §2,
// as redrawn), which the base predates; nothing else is removed or rewritten. The file renders the world ONCE: React's
// `useId` counter is per module graph, so a second render, or a case before this one, numbers Instrument's tab ids
// differently from the capture's single render.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORLD_VIEWS, renderOlderServerWorld, type WorldView } from './olderServerWorld';

const PR2_BASE = '3ce530dad93e0276358e7807804f0839b1e17e78';
const baseline = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'older-server', 'render-3ce530dad.json'), 'utf8')) as {
  source: string; world: string; worldSha256: string; views: Record<WorldView, string>;
};
const LIST = 'class="fleet-list"';
const MARKED = `${LIST} data-delegation="unavailable"`;
const count = (html: string, token: string): number => html.split(token).length - 1;
/** The backup banner's slot (D-7860), which the banner stack keeps mounted and empty while the banner does not show. The
 *  base predates it, so it is the second declared difference: present once wherever the base drew the disk banner's
 *  slot, and empty. */
const BACKUP_SLOT = '<div class="banner-slot" data-banner="backup"></div>';
const DISK_SLOT = '<div class="banner-slot" data-banner="disk"></div>';
/** The fleet header's three doors to places the bottom bar holds (PL10): Docs, Account and Mail, each one button. */
const HEAD_DOORS = /<button[^>]*(?:class="docs-door"|accounts-door|class="mail-badge")[^>]*>.*?<\/button>/g;
/** The strip's no-lane placeholder, a door to the Accounts place, which a phone no longer draws: the bottom bar's Accounts door is
 *  that door (PL10 fix round 1, review 1466 F3, the coordinator's ruling on 15104). jsdom renders a phone. */
const STRIP_PLACEHOLDER = /<div class="accounts-strip" role="link"[^>]*><span class="accounts-strip-empty">[^<]*<\/span><\/div>/g;
/** The programme box's title door (PL10, D26 amended), round the title span the base drew. */
const TITLE_DOOR = /<a [^>]*pg-title-door[^>]*>(<span class="pg-title">[^<]*<\/span>)<\/a>/g;
/** React's `useId` values, renumbered by first appearance. The ids' NUMBERS are the counter's position, not markup: a
 *  closed sheet mounted at screen level (the Add project sheet, whose vaul root takes three ids though it draws nothing)
 *  moves every later id along, and the base's capture cannot know that. What an id names, and which elements share
 *  one, is still compared byte for byte. */
const renumberIds = (html: string): string => {
  const seen = new Map<string, number>();
  return html.replace(/_r_[a-z0-9]+_/g, (id) => {
    if (!seen.has(id)) seen.set(id, seen.size);
    return `_r_${seen.get(id)}_`;
  });
};
/** The projects head (add-project spec 2026-11-04 §2, as redrawn), once over each fleet screen's list: named "Projects"
 *  over the shared cards, the New project door alone over Instrument's table. Its button's class list is `Button`'s. */
const PROJECTS_HEAD = /<div class="fleet-projects-head [^"]*">(?:<h2 class="[^"]*">Projects<\/h2>)?<button type="button" class="[^"]*"><svg[^>]*>[\s\S]*?<\/svg>New project<\/button><\/div>/g;

describe('an older server: no delegation frame, the base\'s fleet (delegation broker wave 4)', () => {
  it('W4-U27: origin/main\'s frame sequence renders unavailable, the base\'s markup, and no delegation word', () => {
    expect(baseline.source).toBe(PR2_BASE);
    const world = readFileSync(join(import.meta.dirname, 'olderServerWorld.tsx'));
    expect(createHash('sha256').update(world).digest('hex'), `${baseline.world} is the world the baseline was captured from`)
      .toBe(baseline.worldSha256);
    expect(Object.keys(baseline.views)).toEqual([...WORLD_VIEWS]);
    // The cards' views hold one fleet list each, so the mark below is never vacuous; Instrument's table holds none.
    expect(WORLD_VIEWS.map((v) => count(baseline.views[v], LIST))).toEqual([1, 1, 1, 0]);
    const today = renderOlderServerWorld();
    for (const view of WORLD_VIEWS) {
      const html = today[view];
      expect(count(html, MARKED), `${view}: each fleet list reads unavailable`).toBe(count(baseline.views[view], LIST));
      expect(count(html, BACKUP_SLOT), `${view}: the backup slot, empty, once per disk slot`).toBe(count(baseline.views[view], DISK_SLOT));
      // The base drew the three head doors wherever it drew a fleet head; today's head draws none of them.
      const headDoors = baseline.views[view].match(HEAD_DOORS)?.length ?? 0;
      expect(headDoors, `${view}: the base's head doors`).toBe(view === WORLD_VIEWS[3] ? 0 : 3);
      expect(html.match(HEAD_DOORS), `${view}: today's head draws no door to a bar place`).toBeNull();
      // Each box's title is a door today, round the very span the base drew.
      expect(html.match(TITLE_DOOR)?.length ?? 0, `${view}: one title door per box`).toBe(baseline.views[view].split('class="pg-title"').length - 1);
      // The Instrument view renders the skin's table alone, outside `FleetScreen`, so it draws no head.
      expect((html.match(PROJECTS_HEAD) ?? []).length, `${view}: one projects head per fleet screen`).toBe(view === 'instrument' ? 0 : 1);
      const old = html.split(MARKED).join(LIST).split(BACKUP_SLOT).join('').replace(TITLE_DOOR, '$1').replace(PROJECTS_HEAD, '');
      expect(old, `${view}: no other delegation attribute`).not.toContain('data-delegation');
      for (const word of ['inferred', 'Unowned work', 'Offline coordinator', 'delegated']) {
        expect(html, `${view}: no "${word}"`).not.toContain(word);
      }
      expect(renumberIds(old), `${view}: the base's markup, byte for byte, less its three head doors and the phone's strip placeholder`)
        .toBe(renumberIds(baseline.views[view].replace(HEAD_DOORS, '').replace(STRIP_PLACEHOLDER, '')));
    }
  });
});
