// Delegation broker wave 4, PR2 Task 2.7 (W4-U27, spec §5.13), as fix round 1 of review 1029 (F1) rebuilt it: an older
// server sends no `delegation` frame, and the screen then claims nothing about delegated work. What it draws is what
// PR2's base drew for the same world, rendered by the base's own code (`fixtures/older-server/render-3ce530dad.json`,
// whose `capture` says how) and compared byte for byte. The one declared difference is each fleet list's
// `data-delegation="unavailable"`, the backup banner's empty slot (D-7860), which the base predates, and the fleet
// header's Account door, whose name now leads with the word it shows (label in name, D-7897), and the Add project row at
// the foot of each fleet list (add-project spec 2026-11-04 §2), which the base predates; nothing else is
// removed or rewritten. The file renders the world ONCE: React's
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
/** The Account door's name as the base drew it, and as it reads today (D-7897). */
const DOOR_BASE = 'aria-label="Your sign-in and accounts"';
const DOOR_NOW = 'aria-label="Account — your sign-in and accounts"';
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
/** The Add project row (add-project spec 2026-11-04 §2), once under each fleet list; its class list is `BareRow`'s. */
const ADD_PROJECT_ROW = /<button type="button" class="[^"]*\bfleet-add-project-row"><span aria-hidden="true">\+ <\/span>Add project<\/button>/g;

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
      expect(count(html, DOOR_NOW), `${view}: the Account door reads its word first`).toBe(count(baseline.views[view], DOOR_BASE));
      expect((html.match(ADD_PROJECT_ROW) ?? []).length, `${view}: one Add project row per fleet list`).toBe(count(baseline.views[view], LIST));
      const old = html.split(MARKED).join(LIST).split(BACKUP_SLOT).join('').split(DOOR_NOW).join(DOOR_BASE).replace(ADD_PROJECT_ROW, '');
      expect(old, `${view}: no other delegation attribute`).not.toContain('data-delegation');
      for (const word of ['inferred', 'Unowned work', 'Offline coordinator', 'delegated']) {
        expect(html, `${view}: no "${word}"`).not.toContain(word);
      }
      expect(renumberIds(old), `${view}: the base's markup, byte for byte`).toBe(renumberIds(baseline.views[view]));
    }
  });
});
