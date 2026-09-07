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
    const hold = src.indexOf('CCD_ARGV.wsHold');
    const clear = src.indexOf("'/clear'");
    expect(hold, 'no CCD_ARGV.wsHold call site found').toBeGreaterThan(-1);
    expect(clear, "no '/clear' sendPrompt found").toBeGreaterThan(-1);
    expect(hold, 'the hold must be placed before the pane is cleared, so the ' +
      'SessionStart the /clear fires can read this wave\'s bytes').toBeLessThan(clear);
  });
});
