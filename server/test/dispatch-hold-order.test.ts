// The card R7 emits quotes `$REG/<id>.hold`. dispatch's `/clear` fires a
// SessionStart, so a hold written AFTER it means the card quotes the PREVIOUS
// wave's bytes — wave 1 sees none at all. This pins the order.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../src/coord/dispatch.ts');

describe('dispatch places the hold before it clears the pane', () => {
  it('the ws-hold call site precedes the /clear sendPrompt', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    // THE CALL SITE, NOT THE COMMENT ABOVE IT. A bare `CCD_ARGV.wsHold` match
    // finds the R7 comment that explains the ordering, which sits ~3 lines
    // ahead of the call it explains — so the guard passed on the comment's
    // position and only worked because the comment happens to travel with the
    // block. Matching the assignment makes the measured thing the shipped
    // thing: `unattended-actor.test.ts` already pins this file to exactly one
    // `CCD_ARGV.wsHold` occurrence, so this spelling cannot become ambiguous.
    const hold = src.indexOf('const holdArgv = CCD_ARGV.wsHold(');
    const clear = src.indexOf("'/clear'");
    expect(hold, 'no CCD_ARGV.wsHold call site found').toBeGreaterThan(-1);
    expect(clear, "no '/clear' sendPrompt found").toBeGreaterThan(-1);
    expect(hold, 'the hold must be placed before the pane is cleared, so the ' +
      'SessionStart the /clear fires can read this wave\'s bytes').toBeLessThan(clear);
  });
});
