// ARCH-50 (#785): the one word-to-Turn reading and the four named policies over it (consolidation spec K4). The
// policies keep each caller's safety direction: the table below is the divergence on purpose, row by row.
import { describe, it, expect } from 'vitest';
import { turnSays, turnWordOf, TURN_POLICIES, type Turn, type TurnPolicy } from '../src/sessionReading.js';

const WORDS: readonly Turn[] = ['idle', 'busy', 'shell', 'unknown'];

describe('turnWordOf: an exact allowlist over Claude Code\'s three words', () => {
  it('names idle, busy and shell; every other raw word, and no word, is unknown', () => {
    expect(['idle', 'busy', 'shell', 'waiting', '', 'Idle', 'idle '].map(turnWordOf))
      .toEqual(['idle', 'busy', 'shell', 'unknown', 'unknown', 'unknown', 'unknown']);
    expect(turnWordOf(null)).toBe('unknown');
  });
});

describe('the four named policies', () => {
  it('are mail-gate, keystroke, sleep and stall', () => {
    expect([...TURN_POLICIES]).toEqual(['mail-gate', 'keystroke', 'sleep', 'stall-watch']);
  });

  const TABLE: Record<TurnPolicy, Record<Turn, 'rest' | 'work' | 'doubt'>> = {
    // hold unless idle; a shell is an idle main loop over a background task, so mail may go (the mode still gates it)
    'mail-gate': { idle: 'rest', shell: 'rest', busy: 'work', unknown: 'work' },
    // refuse unless idle, unknown is busy: a false busy is the safe error where the act types a key or ends a turn
    keystroke: { idle: 'rest', shell: 'work', busy: 'work', unknown: 'work' },
    // require idle: a shell holds the sleep, an unknown holds it
    sleep: { idle: 'rest', shell: 'work', busy: 'work', unknown: 'work' },
    // a shell is at rest; an unknown that persists is the signal, so it is doubt and not work
    'stall-watch': { idle: 'rest', shell: 'rest', busy: 'work', unknown: 'doubt' },
  };

  for (const p of TURN_POLICIES) {
    it(`${p}: ${WORDS.map((w) => `${w} -> ${TABLE[p][w]}`).join(', ')}`, () => {
      expect(WORDS.map((w) => turnSays(p, w))).toEqual(WORDS.map((w) => TABLE[p][w]));
    });
  }
});
