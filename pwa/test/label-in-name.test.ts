// The label-in-name rule (WCAG 2.5.3, D-7897), and the key table held to it.
import { describe, expect, it } from 'vitest';
import { KEY_CAP } from '../src/session/keyBar';
import { labelInName, labelWords } from './labelInName';

describe('labelInName, the rule axe-core 4.14 applies', () => {
  it('splits on anything that is not a letter or a digit, and drops a parenthetical', () => {
    expect(labelWords('lane-a — 5h 22% used')).toEqual(['lane', 'a', '5h', '22', 'used']);
    expect(labelWords('PgUp (Page up)')).toEqual(['pgup']);
    expect(labelWords('↻ ⏎ ·')).toEqual([]);
  });

  it('wants the label\'s words as one unbroken run of the name\'s', () => {
    expect(labelInName('Settings', 'Settings — updates and notifications')).toBe(true);
    expect(labelInName('^C', 'Control C')).toBe(true);
    expect(labelInName('⇧tab', 'Shift Tab')).toBe(true);
    expect(labelInName('↑', 'Arrow up')).toBe(true);
    // A shortened word is a different word.
    expect(labelInName('esc', 'Escape')).toBe(false);
    expect(labelInName('Account', 'Your sign-in and accounts')).toBe(false);
    // Two spans with nothing between them read as one word.
    expect(labelInName('Working2', 'Working 2 total')).toBe(false);
    // In order and unbroken.
    expect(labelInName('lead coordinator', 'lead, coordinator, project-a')).toBe(true);
    expect(labelInName('lead project-a', 'lead, coordinator, project-a')).toBe(false);
  });
});

describe('the terminal key table', () => {
  it('every key\'s name holds its legend, so a voice user can say the cap they see', () => {
    for (const [k, cap] of Object.entries(KEY_CAP)) {
      expect(labelInName(cap.legend, cap.label), `${k}: "${cap.legend}" in "${cap.label}"`).toBe(true);
    }
  });

  it('a shortened legend leads its name, and the name still spells the key out', () => {
    expect(KEY_CAP.esc.label).toBe('Esc (Escape)');
    expect(KEY_CAP.pgUp.label).toBe('PgUp (Page up)');
    expect(KEY_CAP.pgDn.label).toBe('PgDn (Page down)');
  });
});
