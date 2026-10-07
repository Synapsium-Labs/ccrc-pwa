/**
 * STALL WATCH SETTINGS, the README's Settings paragraph (design 2026-10-05, §18 W2). The paragraph that tours
 * `/settings` gains its third section, and these rows pin what that sentence states to the values the build ships:
 * the section's title, its route, the Follow choice and the six level labels in the ladder's order, the quiet time's
 * built-in value, bounds and step, and the counts' window. A renamed level, a moved bound or a new window reds here
 * instead of leaving the README telling an old story. The labels come from L0 and the numbers from L1, so this file
 * copies no text but its anchor words.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STALL_CONFIRM_TEXT, STALL_FOLLOW_LABEL, STALL_LEVELS, STALL_LEVEL_TEXT, STALL_SECTION_TEXT } from '../../shared/api.js';
import { STALL_NOTICE_WINDOW_MS, STALL_QUIET_MAX_MS, STALL_QUIET_MIN_MS, STALL_QUIET_STEP_MS } from '../src/coord/stallsettings.js';
import { STALL_QUIET_MS } from '../src/coord/stall.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const README = readFileSync(path.resolve(here, '..', '..', 'README.md'), 'utf8');

/** The Settings paragraph, its wrapped lines joined with single spaces, from its bold lead to the blank line. */
function settingsParagraph(): string {
  const start = README.indexOf('**Settings, the update banner and release pushes');
  expect(start, 'the README has no Settings paragraph').toBeGreaterThan(-1);
  const end = README.indexOf('\n\n', start);
  return README.slice(start, end === -1 ? undefined : end).replace(/\s+/g, ' ');
}

const SECOND = 'Settings has a second section, **Notifications**';
const THIRD = `Settings has a third section, **${STALL_SECTION_TEXT.title}**`;

/** The third section's sentences: from its lead to the paragraph's next topic, the fleet screen's `BuildLine`. */
function stallSentences(): string {
  const p = settingsParagraph();
  const start = p.indexOf(THIRD);
  expect(start, 'the Settings paragraph names no third section').toBeGreaterThan(-1);
  const end = p.indexOf('In remote mode', start);
  expect(end, 'the third section runs to the end of the paragraph').toBeGreaterThan(start);
  return p.slice(start, end);
}

/** The device words the PWA's own P6 scan refuses (`pwa/test/settings-screen.test.tsx`, its `DEVICE_WORD`), the same
 *  list spelled again here: a server test cannot import a PWA test file. */
const DEVICE_WORD = /\b(phones?|mobiles?|desktops?|tablets?|laptops?|iphones?|ipads?|android|touchscreens?|handsets?)\b/i;

/** A duration the way the section writes one: "30 min", "2 h", "1 h 30 min". */
function duration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return [h > 0 ? `${h} h` : '', m > 0 ? `${m} min` : ''].filter((s) => s !== '').join(' ');
}

describe("README's Settings paragraph names the Stall watch section (design 2026-10-05, §18 W2)", () => {
  it('names a third section, once, after the Notifications section', () => {
    const p = settingsParagraph();
    expect(p.indexOf(SECOND)).toBeGreaterThan(-1);
    expect(p.indexOf(THIRD)).toBeGreaterThan(p.indexOf(SECOND));
    expect(README.replace(/\s+/g, ' ').split(THIRD).length - 1).toBe(1);
  });

  it('names the route the section reads and writes', () => {
    expect(stallSentences()).toContain('`/api/coord/stall-watch`');
  });

  it("names the Follow choice and the six levels by their shipped labels, in the ladder's order", () => {
    const s = stallSentences();
    expect(s).toContain(`\`${STALL_FOLLOW_LABEL}\``);
    expect(STALL_LEVELS).toHaveLength(6);
    expect(s).toContain(STALL_LEVELS.map((l) => `\`${STALL_LEVEL_TEXT[l].label}\``).join(', '));
  });

  it("states the quiet time's built-in value, bounds and step, and the counts' window, as the build ships them", () => {
    const s = stallSentences();
    expect(s).toContain(`built-in ${duration(STALL_QUIET_MS)}`);
    expect(s).toContain(`${duration(STALL_QUIET_MIN_MS)} to ${duration(STALL_QUIET_MAX_MS)} in ${duration(STALL_QUIET_STEP_MS)} steps`);
    expect(s).toContain(`last ${duration(STALL_NOTICE_WINDOW_MS)}`);
  });

  it("names the section's two controls and the confirm button by their shipped labels", () => {
    const s = stallSentences();
    expect(s, 'the level control label').toContain(`**${STALL_SECTION_TEXT.level}**`);
    expect(s, 'the quiet time control label').toContain(`**${STALL_SECTION_TEXT.quiet}**`);
    expect(s, 'the confirm sheet button label').toContain(`**${STALL_CONFIRM_TEXT.confirm}**`);
  });

  it('the Settings paragraph names no device, as the section itself names none (§2, 2026-10-05)', () => {
    expect(settingsParagraph()).not.toMatch(DEVICE_WORD);
  });
});
