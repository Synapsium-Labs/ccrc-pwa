// Delegation broker wave 4, PR2 Task 2.7 (W4-U27, spec §5.13), as fix round 1 of review 1029 (F1) rebuilt it: an older
// server sends no `delegation` frame, and the screen then claims nothing about delegated work. What it draws is what
// PR2's base drew for the same world, rendered by the base's own code (`fixtures/older-server/render-7dc486b97.json`,
// whose `capture` says how) and compared byte for byte. The one declared difference is each fleet list's
// `data-delegation="unavailable"`; nothing else is removed or rewritten. The file renders the world ONCE: React's
// `useId` counter is per module graph, so a second render, or a case before this one, numbers Instrument's tab ids
// differently from the capture's single render.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORLD_VIEWS, renderOlderServerWorld, type WorldView } from './olderServerWorld';

const PR2_BASE = '7dc486b975741a88aaecb9fb98929b44de2d681a';
const baseline = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'older-server', 'render-7dc486b97.json'), 'utf8')) as {
  source: string; world: string; worldSha256: string; views: Record<WorldView, string>;
};
const LIST = 'class="fleet-list"';
const MARKED = `${LIST} data-delegation="unavailable"`;
const count = (html: string, token: string): number => html.split(token).length - 1;

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
      const old = html.split(MARKED).join(LIST);
      expect(old, `${view}: no other delegation attribute`).not.toContain('data-delegation');
      for (const word of ['inferred', 'Unowned work', 'Offline coordinator', 'delegated']) {
        expect(html, `${view}: no "${word}"`).not.toContain(word);
      }
      expect(old, `${view}: the base's markup, byte for byte`).toBe(baseline.views[view]);
    }
  });
});
