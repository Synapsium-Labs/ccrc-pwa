// Worker stall watch, wave 1 (spec §4.1): the mail gate's turn-idle decision.
// It is pure, so every rule is a table row here. The golden fixtures are the
// measured timestamps from spec §1:
// - S3 and run 129's mail 2407, both held at `shell` behind an orphaned
//   background wait loop;
// - 09-28's five coordinator rulings, held at `busy`, which wave 1 does NOT
//   release.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAIL_GATE_STRICT_MARKER, mailTurnIdle, mailTurnModeOf, type MailTurnMode, type TurnLive,
} from '../src/turnidle.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
// watch.ts's two quiet windows, mirrored (they are private there). The pure
// function takes the window as an argument, so these only name the cases.
const MAIL_QUIET_MS = 60_000;
const COORD_QUIET_MS = 15_000;
const T = 1_800_000_000_000;
const live = (status: string, statusUpdatedAt: number | null = T): TurnLive => ({ status, statusUpdatedAt });
const MODES: readonly MailTurnMode[] = ['shell', 'strict'];

describe('mailTurnModeOf: the mode, from the registry listing sweepMail already takes', () => {
  it('the marker is named mail-gate-strict', () => {
    expect(MAIL_GATE_STRICT_MARKER).toBe('mail-gate-strict');
  });

  it('shell by default: an empty listing, or one without the marker', () => {
    expect(mailTurnModeOf([])).toBe('shell');
    expect(mailTurnModeOf(['demo-quiet-mesa.wrapper', 'mail-disabled', 'coordinator-paused'])).toBe('shell');
  });

  it('strict while $REG/mail-gate-strict is listed', () => {
    expect(mailTurnModeOf(['demo-quiet-mesa.wrapper', MAIL_GATE_STRICT_MARKER])).toBe('strict');
  });

  it('an exact name, not a substring: a near-miss file is not the marker', () => {
    expect(mailTurnModeOf(['mail-gate-strict.bak', 'mail-gate-strictly', 'x.mail-gate-strict'])).toBe('shell');
  });
});

describe('mailTurnIdle: which live words deliver', () => {
  it('no live read is not-idle under every mode: an unreadable answer is never idle', () => {
    for (const mode of MODES) {
      expect(mailTurnIdle(null, T + HOUR, MAIL_QUIET_MS, mode), mode).toEqual({ deliver: false, gate: 'not-idle' });
    }
  });

  it('idle delivers under every mode, via idle, since statusUpdatedAt', () => {
    for (const mode of MODES) {
      expect(mailTurnIdle(live('idle'), T + MAIL_QUIET_MS, MAIL_QUIET_MS, mode), mode)
        .toEqual({ deliver: true, since: T, via: 'idle' });
    }
  });

  it('shell delivers under the default mode, via shell (the caller arms the pane guard on it)', () => {
    expect(mailTurnIdle(live('shell'), T + MAIL_QUIET_MS, MAIL_QUIET_MS, 'shell'))
      .toEqual({ deliver: true, since: T, via: 'shell' });
  });

  it('shell is not-idle under strict: the old rule, restored by hand', () => {
    expect(mailTurnIdle(live('shell'), T + 100 * HOUR, MAIL_QUIET_MS, 'strict'))
      .toEqual({ deliver: false, gate: 'not-idle' });
  });

  it('busy, waiting, the empty word and any other word are not-idle under every mode (exact match only)', () => {
    for (const word of ['busy', 'waiting', '', 'Idle', 'idle ', 'shell\n', 'compacting']) {
      for (const mode of MODES) {
        expect(mailTurnIdle(live(word), T + 100 * HOUR, MAIL_QUIET_MS, mode), `${JSON.stringify(word)} under ${mode}`)
          .toEqual({ deliver: false, gate: 'not-idle' });
      }
    }
  });
});

describe('mailTurnIdle: the quiet rule, the same for idle and shell', () => {
  for (const word of ['idle', 'shell'] as const) {
    it(`${word}: a null statusUpdatedAt is not-quiet (no moment means no quiet)`, () => {
      expect(mailTurnIdle(live(word, null), T + 100 * HOUR, MAIL_QUIET_MS, 'shell'))
        .toEqual({ deliver: false, gate: 'not-quiet' });
    });

    it(`${word}: one millisecond short of the window is not-quiet; the window itself delivers`, () => {
      expect(mailTurnIdle(live(word), T + MAIL_QUIET_MS - 1, MAIL_QUIET_MS, 'shell'))
        .toEqual({ deliver: false, gate: 'not-quiet' });
      expect(mailTurnIdle(live(word), T + MAIL_QUIET_MS, MAIL_QUIET_MS, 'shell'))
        .toEqual({ deliver: true, since: T, via: word });
    });

    it(`${word}: the caller owns the window, so a coordinator's 15 s delivers where a worker's 60 s does not`, () => {
      const now = T + COORD_QUIET_MS;
      expect(mailTurnIdle(live(word), now, COORD_QUIET_MS, 'shell')).toEqual({ deliver: true, since: T, via: word });
      expect(mailTurnIdle(live(word), now, MAIL_QUIET_MS, 'shell')).toEqual({ deliver: false, gate: 'not-quiet' });
    });
  }

  it('a statusUpdatedAt ahead of now (fleet-box clock ahead, spec §9.13) is not-quiet, never a delivery', () => {
    expect(mailTurnIdle(live('idle', T + MIN), T, MAIL_QUIET_MS, 'shell')).toEqual({ deliver: false, gate: 'not-quiet' });
  });

  it('the word is judged BEFORE the quiet rule: strict shell with no moment is not-idle, never not-quiet', () => {
    expect(mailTurnIdle(live('shell', null), T, MAIL_QUIET_MS, 'strict')).toEqual({ deliver: false, gate: 'not-idle' });
    expect(mailTurnIdle(live('busy', null), T, MAIL_QUIET_MS, 'shell')).toEqual({ deliver: false, gate: 'not-idle' });
  });
});

describe('mailTurnIdle: the measured silences (spec §1)', () => {
  // S3, run 67. The worker's turn ended 09-26 13:03:15 UTC. An orphaned
  // background wait loop then held the live word at `shell` for 48.9 h, and the
  // coordinator's mails 2443/2445 were gated not-idle the whole time. The file
  // is rewritten only on a change (§3.1), so the relabel's moment is the turn end.
  const S3_TURN_END = Date.UTC(2026, 8, 26, 13, 3, 15);
  // Run 129. Mail 2407 was queued 09-25 02:28 UTC and gated not-idle for 83.5 h
  // behind a subagent's `pgrep` wait loop that held `shell`. The census does not
  // record when the relabel happened, so the queue minute is used: it is the
  // latest the relabel can be.
  const RUN129_QUEUED = Date.UTC(2026, 8, 25, 2, 28, 0);

  it('S3: the coordinator mails deliver a minute after the turn ended, not 48.9 h later', () => {
    const s3 = live('shell', S3_TURN_END);
    expect(mailTurnIdle(s3, S3_TURN_END + 30_000, MAIL_QUIET_MS, 'shell')).toEqual({ deliver: false, gate: 'not-quiet' });
    expect(mailTurnIdle(s3, S3_TURN_END + MAIL_QUIET_MS, MAIL_QUIET_MS, 'shell'))
      .toEqual({ deliver: true, since: S3_TURN_END, via: 'shell' });
    // …and strict is exactly the rule that held them.
    expect(mailTurnIdle(s3, S3_TURN_END + 48.9 * HOUR, MAIL_QUIET_MS, 'strict')).toEqual({ deliver: false, gate: 'not-idle' });
  });

  it('run 129: mail 2407 delivers a minute after it was queued, not 83.5 h later', () => {
    const r129 = live('shell', RUN129_QUEUED);
    expect(mailTurnIdle(r129, RUN129_QUEUED + MAIL_QUIET_MS, MAIL_QUIET_MS, 'shell'))
      .toEqual({ deliver: true, since: RUN129_QUEUED, via: 'shell' });
    expect(mailTurnIdle(r129, RUN129_QUEUED + 83.5 * HOUR, MAIL_QUIET_MS, 'strict')).toEqual({ deliver: false, gate: 'not-idle' });
  });

  it("09-28's five coordinator rulings, held at busy while the worker's subagents ran, stay held in wave 1", () => {
    // 14:02 to about 19:40 UTC. `busy` is ambiguous (a turn, or a main loop
    // idling over background agents). Telling the two apart is wave 2's marker.
    const since = Date.UTC(2026, 8, 28, 14, 2, 0);
    const until = Date.UTC(2026, 8, 28, 19, 40, 0);
    for (const mode of MODES) {
      expect(mailTurnIdle(live('busy', since), until, MAIL_QUIET_MS, mode), mode).toEqual({ deliver: false, gate: 'not-idle' });
    }
  });
});

describe('turnidle.ts is the pure module its docstring says it is', () => {
  const SRC = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'turnidle.ts'),
    'utf8');

  /** Comments blanked, positions preserved (coord-caps-policy.test.ts's helper).
   *  The docstring NAMES the things the code must not use. */
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  it('the scan is over real code, not an empty string', () => {
    expect(code()).toContain('export function mailTurnIdle');
    expect(code()).toContain('export function mailTurnModeOf');
    expect(code().replace(/\s/g, '').length).toBeGreaterThan(400);
  });

  it('imports nothing: not a type, not a value, not a re-export, not a dynamic import', () => {
    expect(code(), 'turnidle.ts has an import line').not.toMatch(/^\s*import\b/m);
    expect(code(), 'turnidle.ts re-exports from another module').not.toMatch(/\bfrom\s+['"`]/);
    expect(code(), 'turnidle.ts has a dynamic import or a require').not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
  });

  it('has no clock: now is an argument', () => {
    expect(code(), 'turnidle.ts names Date').not.toMatch(/\bDate\b/);
    expect(code(), 'turnidle.ts reads a clock').not.toMatch(/performance\s*\.\s*now|process\s*\.\s*hrtime/);
  });

  it('has no node builtin, no fs, no process', () => {
    expect(code(), 'turnidle.ts names a node builtin').not.toMatch(/node:/);
    expect(code(), 'turnidle.ts reaches fs or process').not.toMatch(/\bfs\b|\bprocess\s*\./);
  });
});
