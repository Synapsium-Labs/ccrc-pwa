// Fix-round finding: everything outside `checkMailToken` was unpinned —
// `mailTokenPath` (covered separately in `config.test.ts`), `readMailToken`
// itself, and `deploy/notify.sh`'s half of the same contract. `checkMailToken`
// already has cases driving it through `notify-token.test.ts`'s and
// `mail-routes.test.ts`'s route tests; the direct unit block below (fix-round
// finding 3 / D-39) covers only the ONE distinction those route tests cannot
// see from the outside: `'ok'` vs `'unconfigured'` are two different return
// VALUES of the same function, and a route test can only observe that both
// currently lead a particular route to the same HTTP status — it cannot see
// that `/api/notify` and `/api/mail` are reading the SAME verdict two
// different ways on purpose.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkMailToken, MailTokenFileUnusable, MailTokenPlaceholderUnedited, PLACEHOLDER_TOKEN, readMailToken,
} from '../src/coord/token.js';
import { mkTmp } from './tmpHelpers.js';

describe('checkMailToken', () => {
  const TOKEN = 'f'.repeat(64);

  it('answers \'unconfigured\' — never \'ok\' — when the server has no expected token, for ANY presented value', () => {
    // Fix-round finding 3 / D-39: before this split, `expected === null`
    // returned `'ok'` unconditionally — indistinguishable from a caller that
    // actually presented the right secret. `/api/mail`/`/api/mail/:id/ack`
    // read anything but `'ok'` as a refusal (`routes.ts`), so this split is
    // what lets them fail shut on an unconfigured server while `/api/notify`
    // (which still treats `'unconfigured'` as a pass-through) is unaffected.
    expect(checkMailToken(null, undefined)).toBe('unconfigured');
    expect(checkMailToken(null, '')).toBe('unconfigured');
    expect(checkMailToken(null, TOKEN)).toBe('unconfigured');       // even the "right-shaped" guess
    expect(checkMailToken(null, 'literally anything')).toBe('unconfigured');
  });

  it('still answers \'ok\'/\'legacy\'/\'bad\' exactly as before once a token IS configured', () => {
    expect(checkMailToken(TOKEN, TOKEN)).toBe('ok');
    expect(checkMailToken(TOKEN, undefined)).toBe('legacy');
    expect(checkMailToken(TOKEN, '')).toBe('legacy');
    expect(checkMailToken(TOKEN, 'wrong')).toBe('bad');
    expect(checkMailToken(TOKEN, 123)).toBe('bad');                 // non-string presented value
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const tokenPathIn = (home: string): string => path.join(home, '.ccrc', 'mail.token');

describe('readMailToken', () => {
  it('answers null when the file is ABSENT — the one configuration state the spec grants', () => {
    // spec:150-155 grants exactly this fail-open: a box that has never been
    // given a token keeps working, unauthenticated. Nothing else is entitled
    // to the same answer — see the cases below.
    expect(readMailToken(tokenPathIn(mkTmp('ccrc-token-')))).toBeNull();
  });

  it('reads and trims the token when the file is present', () => {
    const home = mkTmp('ccrc-token-');
    const p = tokenPathIn(home);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, `${'f'.repeat(64)}\n`);
    expect(readMailToken(p)).toBe('f'.repeat(64));
  });

  // Fix-round finding 4: a PRESENT file with no extractable value used to
  // collapse into the same `null` as "never configured" — the one state the
  // function's own ENOENT-vs-throw split (below) says must NOT collapse that
  // way, because `checkMailToken(null, …)` accepts every presented value.
  // Three shapes produce "present but unusable": 0 bytes, whitespace only,
  // and every line a `#`-comment (a value line deleted, or a botched copy of
  // `ccrc-mail.token.example` with nothing appended) — all three now THROW.
  it.each([
    ['a 0-byte file', ''],
    ['a whitespace-only file', '  \n\t\n  '],
    ['a file that is only #-comments — no value line at all', '# just a comment\n# and another\n'],
  ])('THROWS MailTokenFileUnusable for %s — present-but-empty is not "unconfigured"', (_name, content) => {
    const home = mkTmp('ccrc-token-');
    const p = tokenPathIn(home);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
    // A present-but-empty file answering `null` here is the fail-open the
    // fix-round finding named: `checkMailToken(null, presented)` returns
    // `'ok'` for ANY presented value, so a token this box shipped empty (a
    // truncated `openssl rand -hex 32 > …` redirect) would otherwise disarm
    // the whole gate rather than refuse to boot.
    expect(() => readMailToken(p)).toThrow(MailTokenFileUnusable);
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

// Review finding 13: the placeholder extracts cleanly (that is the whole
// defect) — so `deploy/ccrc-mail.token.example`'s own unedited content is the
// realistic fixture, not a hand-typed constant that could drift from it.
describe('readMailToken THROWS on the unedited placeholder (review finding 13)', () => {
  const EXAMPLE = readFileSync(path.join(repoRoot, 'deploy', 'ccrc-mail.token.example'), 'utf8');

  it('refuses a token file that is exactly deploy/ccrc-mail.token.example, copied and never edited', () => {
    const home = mkTmp('ccrc-token-');
    const p = tokenPathIn(home);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, EXAMPLE);   // `cp ccrc-mail.token.example ccrc-mail.token`, no further edit
    expect(() => readMailToken(p)).toThrow(MailTokenPlaceholderUnedited);
  });

  it('the placeholder constant IS the example file\'s one value line', () => {
    // Ties `PLACEHOLDER_TOKEN` to the shipped file rather than letting the
    // two drift: `extractToken`'s own rule (first non-blank, non-#-comment
    // line) is what a real deploy applies too.
    const lines = EXAMPLE.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
    expect(lines).toEqual([PLACEHOLDER_TOKEN]);
  });

  it('accepts a value once the placeholder line is actually replaced', () => {
    const home = mkTmp('ccrc-token-');
    const p = tokenPathIn(home);
    mkdirSync(path.dirname(p), { recursive: true });
    const edited = `${EXAMPLE.split('\n').slice(0, -2).join('\n')}\n${'f'.repeat(64)}\n`;
    writeFileSync(p, edited);
    expect(readMailToken(p)).toBe('f'.repeat(64));
  });
});

describe('deploy/notify.sh carries the token the way the server expects it', () => {
  const notifyShPath = path.join(repoRoot, 'deploy', 'notify.sh');
  const notifySh = readFileSync(notifyShPath, 'utf8');

  it('still sends the header conditionally on a non-empty token', () => {
    // Fix-round finding 4(c): deleting this one line is a mutant that stays
    // green in every suite today — the server accepts the tokenless POST as
    // `legacy`, so the defect surfaces one deploy later, as a silent total
    // loss of swap notices, the moment the tolerance is removed.
    expect(notifySh).toContain('${tok:+-H "x-ccrc-mail-token: $tok"}');
  });

  it('skips blank and #-comment lines, then strips ALL whitespace from the value line', () => {
    // The shape `readMailToken`/`extractToken` (coord/token.ts) also runs:
    // first non-blank, non-`#`-comment line, whitespace stripped everywhere
    // in it — not just the edges. This pins the shell half of that shared
    // rule and would fail if either clause regressed to a narrower one.
    expect(notifySh).toContain("grep -v '^[[:space:]]*#'");
    expect(notifySh).toContain("grep -v '^[[:space:]]*$'");
    expect(notifySh).toContain('head -n1');
    expect(notifySh).toContain("tr -d '[:space:]'");
  });

  // Fix-round finding 1: the server used to normalise with `.trim()` (edges
  // only) while this script normalised with `tr -d '[:space:]'` (everywhere)
  // — same character CLASS, different SCOPE, so any file content with
  // INTERIOR whitespace (the shipped `.example`'s `#`-comment preamble is
  // exactly that) produced two different secrets from one committed file.
  // This runs BOTH normalisers over the SAME bytes and asserts they agree —
  // the coverage gap the finding named `coord-token.test.ts:76-85` (the
  // string-`toContain` assertions above) as unable to catch on its own.
  describe('and extracts the IDENTICAL token `readMailToken` does, from the same bytes', () => {
    // Sliced straight out of the shipped script — never a hand-copied
    // duplicate of the shell logic, so this test cannot drift the way a
    // re-typed snippet could. Bounded between the `TOKEN_FILE=` assignment
    // and the `curl` invocation, which this suite must NEVER run (it would
    // dial the real fleet host's address).
    const start = notifySh.indexOf('TOKEN_FILE=');
    const end = notifySh.indexOf('curl -fsS');
    if (start === -1 || end === -1) {
      throw new Error('notify.sh token-extraction snippet not found — its shape changed under this test');
    }
    const snippet = notifySh.slice(start, end);

    const shellExtract = (tokenFile: string): string =>
      execFileSync('bash', ['-c', `${snippet}\nprintf '%s' "$tok"`],
        { env: { ...process.env, CCRC_MAIL_TOKEN_FILE: tokenFile } }).toString();

    const HEX = 'f'.repeat(64);
    const EXAMPLE = readFileSync(path.join(repoRoot, 'deploy', 'ccrc-mail.token.example'), 'utf8');

    it.each([
      ['bare hex', HEX],
      ['hex + trailing newline', `${HEX}\n`],
      ['hex + trailing space', `${HEX} `],
      ['CRLF', `${HEX}\r\n`],
      // Interior whitespace, not just the edges — the exact fixture that
      // discriminates "strip everywhere" (both sides, post-fix) from "strip
      // the edges only" (the server's pre-fix `.trim()`): an edges-only
      // reader would keep the embedded space and disagree with the shell
      // side's `tr -d '[:space:]'` on both length and bytes.
      ['a value line with an embedded space (adversarial: real tokens never have one)',
        `${'a'.repeat(32)} ${'b'.repeat(32)}\n`],
      // NOT the shipped .example unedited — `readMailToken` now THROWS on
      // that content (`MailTokenPlaceholderUnedited`, review finding 13,
      // pinned in its own describe block below), so it has no "identical
      // token" to agree with `shellExtract` on any more.
      ['the shipped .example with the placeholder line replaced by a real value',
        `${EXAMPLE.split('\n').slice(0, -2).join('\n')}\n${HEX}\n`],
    ])('%s', (_name, content) => {
      const home = mkTmp('ccrc-token-agree-');
      const p = tokenPathIn(home);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, content);
      expect(shellExtract(p)).toBe(readMailToken(p));
    });
  });
});
