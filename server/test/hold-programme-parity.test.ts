// server/test/hold-programme-parity.test.ts
//
// THE PROGRAMME-HOLD GRAMMAR HAS ONE SPELLING PER LANGUAGE, AND THE TWO AGREE (D-6091, fleet capacity W1-1).
//
// A `.hold` guards a workspace. The run-done policy lets a finished child SLEEP through one kind of hold only: the
// programme hold a coordinator's run wrote (`program:<slug> wave:<n>[/<m>][ run:<id>]`). The server reads that grammar
// through `programmeHoldOf` (`server/src/coord/rundefs.ts`, over `HOLD_REASON_PATTERN`, the pattern
// `holdReasonVerdict` validates with); ccd re-checks it at the act through `_hold_is_programme` (`cmd_hibernate
// --hold-ok`). Any text outside the grammar is an operator's own hold and keeps holding sleep on both sides. This
// file crosses the two readers over ONE fixture list, run through the real `ccd/ccd` in a fixture HOME, so a
// widening on either side is red here. Neutral fixtures (public repository).
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { programmeHoldOf } from '../src/coord/rundefs.js';
import { HOLD_REASON_MAX_CHARS } from '../../shared/api.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

/** [text, is it a programme hold]. Every row is within the hold cap, so the two readers must agree on all of them. */
const FIXTURES: readonly (readonly [string, boolean])[] = [
  ['program:programme-a wave:3', true],
  ['program:programme-a wave:2 run:7', true],
  ['program:programme-a wave:2/4', true],
  ['program:programme-a wave:2/4 run:7', true],
  ['program:p.a_b-c wave:10 run:123', true],
  ['keep: debugging', false],
  ['', false],
  ['wave 3', false],
  ['program:programme-a', false],
  ['program: wave:3', false],
  ['program:programme-a wave:', false],
  ['program:programme-a wave:x', false],
  ['program:programme-a wave:3 run:', false],
  ['program:programme-a wave:3 run:7 extra', false],
  ['program:programme-a  wave:3', false],
  [' program:programme-a wave:3', false],
  ['program:programme-a wave:3 ', false],
  ['program:programme-a wave:3\n', false],
  ['program:programme-a wave:3\nkeep: debugging', false],
  ['program:programme a wave:3', false],
  ['program:programme-ä wave:3', false],
  ['program:programme-a wave:3 note:7', false],
  ['Program:programme-a wave:3', false],
  ['program:programme-a wave:3/', false],
];

let h: CcdHarness;
beforeAll(() => { h = makeCcdHarness('ccrc-hold-parity-'); });
afterAll(() => { h.cleanup(); });

/** `_hold_is_programme`'s answer for each fixture, from one shell: the texts travel base64-encoded so no quoting or
 *  newline in a fixture can change what the helper is asked. */
function ccdAnswers(texts: readonly string[]): boolean[] {
  const lines = texts.map((t, i) => {
    const b64 = Buffer.from(t, 'utf8').toString('base64');
    return `t=$(printf '%s' '${b64}' | base64 --decode; printf x); t=\${t%x}; if _hold_is_programme "$t"; then echo "${i}=1"; else echo "${i}=0"; fi`;
  });
  const out = h.sh(lines.join('\n'));
  return texts.map((_t, i) => new RegExp(`^${i}=1$`, 'm').test(out));
}

describe('the programme-hold grammar, server and ccd (D-6091)', () => {
  it('programmeHoldOf reads every fixture as its row says', () => {
    for (const [text, ok] of FIXTURES) expect(programmeHoldOf(text) !== null, JSON.stringify(text)).toBe(ok);
  });

  it('_hold_is_programme agrees with HOLD_REASON_PATTERN on every fixture', () => {
    const ccd = ccdAnswers(FIXTURES.map(([t]) => t));
    FIXTURES.forEach(([text, ok], i) => { expect(ccd[i], JSON.stringify(text)).toBe(ok); });
  });

  it('programmeHoldOf names the programme, the wave and the run', () => {
    expect(programmeHoldOf('program:programme-a wave:3')).toEqual({ program: 'programme-a', wave: 3, runId: null });
    expect(programmeHoldOf('program:programme-a wave:2/4 run:7')).toEqual({ program: 'programme-a', wave: 2, runId: 7 });
  });

  it('an oversize text is not a programme hold (the hold cap), however well-formed', () => {
    const slug = 'a'.repeat(HOLD_REASON_MAX_CHARS);
    expect(programmeHoldOf(`program:${slug} wave:3`)).toBeNull();
  });

  it('a run id past the safe-integer range is not a programme hold (fail closed: it keeps holding)', () => {
    expect(programmeHoldOf('program:programme-a wave:3 run:99999999999999999999')).toBeNull();
  });
});
