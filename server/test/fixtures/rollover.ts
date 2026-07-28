// One definition of the rollover cases, consumed by BOTH readers of
// ~/.cc-limits: limits.test.ts (TypeScript) and ccd-limits.test.ts (bash).
// Expressed as a function of `now` because the two cannot share a clock —
// readLimits takes an injectable now, ccd's _limit_field calls `date +%s`.
export interface RolloverCase {
  file: string;
  /** The literal bytes of the file, not an object. Both readers parse text, and
   *  the differences that actually broke the fleet live in the text: `null`
   *  values, an absent key, and the space Python's json.dump puts after every
   *  colon. Serialising an object here would have made those cases unsayable —
   *  which is exactly why the spaced gpt.json went unnoticed. */
  content: string;
  expect: { five: number | null; seven: number | null;
            fiveRolledOver: boolean; sevenRolledOver: boolean };
  why: string;
}

/** Compact, the way statusline-command.sh's printf writes the Anthropic accounts. */
const compact = (o: Record<string, number | null>): string => JSON.stringify(o);

/** Spaced, the way Python's json.dump writes gpt.json (default separators are
 *  `', '` and `': '`) — infra/handoff/ccgpt-usage. */
const spaced = (o: Record<string, number | null>): string =>
  `{${Object.entries(o).map(([k, v]) => `"${k}": ${v}`).join(', ')}}`;

export function rolloverCases(now: number): RolloverCase[] {
  return [
    {
      file: 'rolled-seven.json',
      // The live claude.json shape on 2026-07-27: a 20h-old sample whose 7d
      // window reset 14h ago. Without the rule this reads 98 and excludes the
      // account from the entire fleet for six more days.
      content: compact({ five: 10, seven: 98, ts: now - 72000, fiveResetAt: now - 72000, sevenResetAt: now - 50000 }),
      expect: { five: 0, seven: 0, fiveRolledOver: true, sevenRolledOver: true },
      why: 'both windows reset before now',
    },
    {
      file: 'rolled-five-only.json',
      content: compact({ five: 87, seven: 40, ts: now - 15000, fiveResetAt: now - 100, sevenResetAt: now + 200000 }),
      expect: { five: 0, seven: 40, fiveRolledOver: true, sevenRolledOver: false },
      why: '5h reset, 7d still running',
    },
    {
      file: 'fresh.json',
      content: compact({ five: 42, seven: 61, ts: now - 60, fiveResetAt: now + 3600, sevenResetAt: now + 86400 }),
      expect: { five: 42, seven: 61, fiveRolledOver: false, sevenRolledOver: false },
      why: 'nothing has reset — values stand',
    },
    {
      file: 'no-reset-fields.json',
      // The gpt 429 exclusion shape (ccd:204). No resetAt, sample is recent, so
      // the age rule does not fire either: it must keep reading 100.
      content: compact({ five: 100, seven: 0, ts: now - 60 }),
      expect: { five: 100, seven: 0, fiveRolledOver: false, sevenRolledOver: false },
      why: '429 exclusion must survive — no resetAt, recent sample',
    },
    {
      file: 'no-reset-fields-old.json',
      // No resetAt and older than its own 5h window: the EXISTING age rule
      // still has to fire.
      content: compact({ five: 99, seven: 80, ts: now - 20000 }),
      expect: { five: 0, seven: 80, fiveRolledOver: false, sevenRolledOver: false },
      why: 'age rule still applies when resetAt is absent',
    },
    {
      file: 'gpt-spaced.json',
      // Byte-for-byte the live gpt.json shape. Codex Pro is weekly-only, so
      // `five` is null, and every colon is followed by a space. ccd's greps used
      // to demand a digit straight after the colon, which read this whole file —
      // the one account NOT written by statusline-command.sh — as unknown.
      content: spaced({ five: null, seven: 0, ts: now - 600, fiveResetAt: null, sevenResetAt: now + 604000 }),
      expect: { five: null, seven: 0, fiveRolledOver: false, sevenRolledOver: false },
      why: 'python-spaced json with a null five parses like any other file',
    },
    {
      file: 'gpt-spaced-rolled.json',
      // Same writer, weekly window already reset: the rollover rule has to fire
      // on the spaced shape too, or gpt is the one account it can never help.
      content: spaced({ five: null, seven: 96, ts: now - 90000, fiveResetAt: null, sevenResetAt: now - 3600 }),
      expect: { five: null, seven: 0, fiveRolledOver: false, sevenRolledOver: true },
      why: 'the rollover rule fires on python-spaced json',
    },
    {
      file: 'five-absent.json',
      // No `five` key at all and a lapsed fiveResetAt. Unknown is not zero: a
      // reset timestamp for a window nobody measured tells us nothing about the
      // value, so it stays unknown and carries no flag.
      content: compact({ seven: 50, ts: now - 60, fiveResetAt: now - 100, sevenResetAt: now + 100 }),
      expect: { five: null, seven: 50, fiveRolledOver: false, sevenRolledOver: false },
      why: 'a lapsed resetAt over an absent value stays unknown, not 0',
    },
    {
      file: 'five-absent-old.json',
      // Same, for the age rule: an old sample that never carried a five cannot
      // decay one into existence.
      content: compact({ seven: 50, ts: now - 20000 }),
      expect: { five: null, seven: 50, fiveRolledOver: false, sevenRolledOver: false },
      why: 'the age rule cannot decay an absent value into 0',
    },
  ];
}
