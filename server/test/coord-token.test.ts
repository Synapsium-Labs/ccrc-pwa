// Fix-round finding: everything outside `checkMailToken` was unpinned —
// `mailTokenPath` (covered separately in `config.test.ts`), `readMailToken`
// itself, and `deploy/notify.sh`'s half of the same contract. `checkMailToken`
// already has five cases driving it through `notify-token.test.ts`'s route
// tests; nothing here duplicates those.
import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMailToken } from '../src/coord/token.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const tokenPathIn = (home: string): string => path.join(home, '.ccrc', 'mail.token');

describe('readMailToken', () => {
  it('answers null when the file is ABSENT — the one configuration state the spec grants', () => {
    // spec:150-155 grants exactly this fail-open: a box that has never been
    // given a token keeps working, unauthenticated. Nothing else is entitled
    // to the same answer — see the two cases below.
    expect(readMailToken(tokenPathIn(mkTmp('ccrc-token-')))).toBeNull();
  });

  it('reads and trims the token when the file is present', () => {
    const home = mkTmp('ccrc-token-');
    const p = tokenPathIn(home);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, `${'f'.repeat(64)}\n`);
    expect(readMailToken(p)).toBe('f'.repeat(64));
  });

  it('answers null for a present-but-empty file — nothing to check against', () => {
    const home = mkTmp('ccrc-token-');
    const p = tokenPathIn(home);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, '');
    expect(readMailToken(p)).toBeNull();
  });

  // The `chmod 000` case does not discriminate when the suite runs as root
  // (CI does not; the fleet host does not) — root reads through any mode bit.
  // Guarded rather than silently passing for the wrong reason, same as
  // `coord-prhistory.test.ts`'s identical guard.
  it.skipIf(process.getuid?.() === 0)(
    'THROWS when the file is present and unreadable — unreadable is not "unconfigured"', () => {
      const home = mkTmp('ccrc-token-');
      const p = tokenPathIn(home);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, `${'f'.repeat(64)}\n`);
      chmodSync(p, 0o000);
      try {
        // A `chmod 000` file answering `null` here is the fail-open the
        // fix-round finding named: `checkMailToken(null, presented)` returns
        // `'ok'` for ANY presented value, so a token this box cannot read
        // would otherwise disarm the whole gate rather than refuse to boot.
        expect(() => readMailToken(p)).toThrow();
      } finally {
        chmodSync(p, 0o600); // restore — afterAll's recursive rm needs to read/unlink it
      }
    });
});

describe('deploy/notify.sh carries the token the way the server expects it', () => {
  const notifySh = readFileSync(path.join(repoRoot, 'deploy', 'notify.sh'), 'utf8');

  it('still sends the header conditionally on a non-empty token', () => {
    // Fix-round finding 4(c): deleting this one line is a mutant that stays
    // green in every suite today — the server accepts the tokenless POST as
    // `legacy`, so the defect surfaces one deploy later, as a silent total
    // loss of swap notices, the moment the tolerance is removed.
    expect(notifySh).toContain('${tok:+-H "x-ccrc-mail-token: $tok"}');
  });

  it('strips ALL whitespace from the token file, not just CR/LF', () => {
    // `coord/token.ts`'s `readMailToken` normalises with `.trim()` — leading
    // and trailing whitespace of any kind, not only line endings. A shell
    // side that only deleted `\r\n` left a trailing space or tab mismatched
    // between the two boxes' copies of the SAME committed file: a length
    // mismatch `checkMailToken` calls `'bad'`, permanently and silently (no
    // log survives either box's `>/dev/null 2>&1`). This pins the aligned
    // rule and would fail if the tokenizer regressed to the narrower one.
    expect(notifySh).toContain('tok="$(tr -d \'[:space:]\' < "$TOKEN_FILE")"');
  });
});
