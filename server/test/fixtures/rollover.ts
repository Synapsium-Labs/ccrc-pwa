// One definition of the rollover cases, consumed by BOTH readers of
// ~/.cc-limits: limits.test.ts (TypeScript) and ccd-limits.test.ts (bash).
// Expressed as a function of `now` because the two cannot share a clock —
// readLimits takes an injectable now, ccd's _limit_field calls `date +%s`.
export interface RolloverCase {
  file: string;
  json: Record<string, number>;
  expect: { five: number | null; seven: number | null;
            fiveRolledOver: boolean; sevenRolledOver: boolean };
  why: string;
}

export function rolloverCases(now: number): RolloverCase[] {
  return [
    {
      file: 'rolled-seven.json',
      // The live claude.json shape on 2026-07-27: a 20h-old sample whose 7d
      // window reset 14h ago. Without the rule this reads 98 and excludes the
      // account from the entire fleet for six more days.
      json: { five: 10, seven: 98, ts: now - 72000, fiveResetAt: now - 72000, sevenResetAt: now - 50000 },
      expect: { five: 0, seven: 0, fiveRolledOver: true, sevenRolledOver: true },
      why: 'both windows reset before now',
    },
    {
      file: 'rolled-five-only.json',
      json: { five: 87, seven: 40, ts: now - 15000, fiveResetAt: now - 100, sevenResetAt: now + 200000 },
      expect: { five: 0, seven: 40, fiveRolledOver: true, sevenRolledOver: false },
      why: '5h reset, 7d still running',
    },
    {
      file: 'fresh.json',
      json: { five: 42, seven: 61, ts: now - 60, fiveResetAt: now + 3600, sevenResetAt: now + 86400 },
      expect: { five: 42, seven: 61, fiveRolledOver: false, sevenRolledOver: false },
      why: 'nothing has reset — values stand',
    },
    {
      file: 'no-reset-fields.json',
      // The gpt 429 exclusion shape (ccd:204). No resetAt, sample is recent, so
      // the age rule does not fire either: it must keep reading 100.
      json: { five: 100, seven: 0, ts: now - 60 },
      expect: { five: 100, seven: 0, fiveRolledOver: false, sevenRolledOver: false },
      why: '429 exclusion must survive — no resetAt, recent sample',
    },
    {
      file: 'no-reset-fields-old.json',
      // No resetAt and older than its own 5h window: the EXISTING age rule
      // still has to fire.
      json: { five: 99, seven: 80, ts: now - 20000 },
      expect: { five: 0, seven: 80, fiveRolledOver: false, sevenRolledOver: false },
      why: 'age rule still applies when resetAt is absent',
    },
  ];
}
