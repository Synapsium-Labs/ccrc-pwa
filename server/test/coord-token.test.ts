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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BoxTokenHolder, TOKEN_SLOTS, checkMailToken, extractToken, matchDigestSlots,
  MailTokenFileUnusable, MailTokenPlaceholderUnedited, PLACEHOLDER_TOKEN, readMailToken,
} from '../src/coord/token.js';
import { PENDING_HARD_CAP } from '../src/token/policy.js';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

describe('checkMailToken', () => {
  const TOKEN = 'f'.repeat(64);

  it('answers \'unconfigured\' — never \'ok\' — when the server has no expected token, for ANY presented value', () => {
    // Fix-round finding 3 / D-39: before this split, `expected === null`
    // returned `'ok'` unconditionally — indistinguishable from a caller that
    // actually presented the right secret. `/api/mail`/`/api/mail/:id/ack`
    // read anything but `'ok'` as a refusal (`routes.ts`), so this split is
    // what lets them fail shut on an unconfigured server (`/api/notify` did
    // not, until the box-token lifecycle made it refuse the same three verdicts).
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
    //
    // R16 (centralised-update wave 13): the header now rides curl's STDIN as a
    // `-K -` config line, never argv, so the pin is on the guarded config line
    // and the `-K -` beside the curl it feeds. `notify-addr.test.ts` RUNS the
    // script and pins the same thing by what curl was handed.
    expect(notifySh).toContain(`{ [ -n "$tok" ] && printf 'header = "x-ccrc-mail-token: %s"\\n' "$tok"; } |\n`
      + 'curl -fsS -m 5 -X POST "$BASE/api/notify" -K - \\\n');
    expect(notifySh, 'the token is back on curl\'s argv').not.toMatch(/-H\s+"x-ccrc-mail-token/);
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
    // re-typed snippet could. Bounded between the `TOKEN_FILE=` assignment and
    // the start of ADDRESS resolution.
    //
    // The end marker used to be `curl -fsS`, which silently included whatever
    // sat between the two blocks. When D-199 put `[ -n "$ADDR" ] || exit 0`
    // there, the snippet began exiting before it could print — every case in
    // this describe went red for a reason that had nothing to do with tokens.
    // Ending at the address block says what the slice is actually for, and the
    // curl is still never reached (this suite must never dial anything).
    const start = notifySh.indexOf('TOKEN_FILE=');
    const end = notifySh.indexOf('ADDR="${CCRC_ADDR:-}"');
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

// ── the accept-set (box-token lifecycle, spec 4.3) ───────────────────────────
//
// checkMailToken keeps its four words and its literal-string arm; a
// BoxTokenHolder widens what `ok` means to a small FIXED set of slots, every one
// compared on every call. The values below are fixture strings, not tokens.
const sha = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();
const CUR = 'a'.repeat(64);
const P0 = 'b'.repeat(64);
const P1 = 'c'.repeat(64);
const PREV = 'd'.repeat(64);
const RETIRED = 'e'.repeat(64);
const P2 = 'f'.repeat(64);
const G0 = '0'.repeat(16);
const G1 = '1'.repeat(16);
const G2 = '2'.repeat(16);

const fullHolder = (now: () => number = () => 1_000,
  compare?: (a: Buffer, b: Buffer) => boolean): BoxTokenHolder => {
  const h = new BoxTokenHolder({ now, ...(compare ? { compare } : {}) });
  h.setSlots({ current: CUR, pending: [{ id: G0, value: P0 }, { id: G1, value: P1 }],
    previous: { value: PREV, until: 2_000 } });
  return h;
};

const threePendingHolder = (compare?: (a: Buffer, b: Buffer) => boolean): BoxTokenHolder => {
  const h = new BoxTokenHolder({ now: () => 1_000, ...(compare ? { compare } : {}) });
  h.setSlots({ current: CUR, pending: [{ id: G0, value: P0 }, { id: G1, value: P1 }, { id: G2, value: P2 }],
    previous: { value: PREV, until: 2_000 } });
  return h;
};

describe('BoxTokenHolder: current, up to three pending and previous, one check', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('accepts every filled slot and names which one matched', () => {
    const h = fullHolder();
    expect(h.match(CUR)).toBe('current');
    expect(h.match(P0)).toBe('pending0');
    expect(h.match(P1)).toBe('pending1');
    expect(h.match(PREV)).toBe('previous');
    expect(h.match('f'.repeat(64))).toBeNull();
    for (const v of [CUR, P0, P1, PREV]) expect(checkMailToken(h, v)).toBe('ok');
    expect(h.counters().matched).toEqual({ current: 2, pending0: 2, pending1: 2, pending2: 0, previous: 2 });
  });

  it('accepts a third pending value (the cap exit, D-4413) and names its slot', () => {
    const h = threePendingHolder();
    for (const [v, slot] of [[CUR, 'current'], [P0, 'pending0'], [P1, 'pending1'], [P2, 'pending2'], [PREV, 'previous']] as const) {
      expect(h.match(v)).toBe(slot);
      expect(checkMailToken(h, v)).toBe('ok');
    }
    expect(h.pendingValue(G2)).toBe(P2);
    expect(h.counters().matched).toEqual({ current: 2, pending0: 2, pending1: 2, pending2: 2, previous: 2 });
  });

  it('the pending slots are exactly the policy cap: three, and TOKEN_SLOTS says so', () => {
    expect(TOKEN_SLOTS.filter((s) => s.startsWith('pending'))).toHaveLength(PENDING_HARD_CAP);
    expect(TOKEN_SLOTS).toEqual(['current', 'pending0', 'pending1', 'pending2', 'previous']);
  });

  it('refuses the previous value at and after its hard deadline', () => {
    let t = 1_999;
    const h = fullHolder(() => t);
    expect(h.match(PREV)).toBe('previous');
    t = 2_000;
    expect(h.match(PREV)).toBeNull();
    expect(checkMailToken(h, PREV)).toBe('bad');
    expect(h.match(CUR)).toBe('current');
  });

  it('an empty slot holds a random dummy, never the digest of an empty or absent value', () => {
    const h = new BoxTokenHolder();
    h.setSlots({ current: CUR, pending: [], previous: null });
    expect(h.match('')).toBeNull();
    expect(h.match(P0)).toBeNull();
    expect(h.match(CUR)).toBe('current');
  });

  it('keeps the four words: no current is unconfigured, absent is legacy, wrong or non-string is bad', () => {
    const empty = new BoxTokenHolder();
    expect(empty.hasCurrent()).toBe(false);
    expect(checkMailToken(empty, CUR)).toBe('unconfigured');
    expect(checkMailToken(empty, undefined)).toBe('unconfigured');
    const h = fullHolder();
    expect(h.hasCurrent()).toBe(true);
    expect(checkMailToken(h, undefined)).toBe('legacy');
    expect(checkMailToken(h, '')).toBe('legacy');
    expect(checkMailToken(h, null)).toBe('legacy');
    expect(checkMailToken(h, 'wrong')).toBe('bad');
    expect(checkMailToken(h, 123)).toBe('bad');
    expect(checkMailToken(h, [CUR, CUR])).toBe('bad');     // a repeated header arrives as an array
  });

  it('serves the pending and current values from memory, and refuses a fourth pending generation', () => {
    const h = fullHolder();
    expect(h.pendingValue(G0)).toBe(P0);
    expect(h.pendingValue(G1)).toBe(P1);
    expect(h.pendingValue('9'.repeat(16))).toBeNull();
    expect(h.currentValue()).toBe(CUR);
    expect(() => h.setSlots({ current: CUR, previous: null, pending: [
      { id: G0, value: P0 }, { id: G1, value: P1 }, { id: G2, value: P2 }, { id: '3'.repeat(16), value: RETIRED }] }))
      .toThrow(RangeError);
  });

  it('a retired value is bad, counted per lane, and warned at most once a minute without the value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let t = 10_000;
    const h = fullHolder(() => t);
    expect(() => h.setRetired(['ab'])).toThrow(RangeError);
    expect(() => h.setRetired([sha(RETIRED).toString('hex').toUpperCase()])).toThrow(RangeError);
    h.setRetired([sha(RETIRED).toString('hex')]);
    expect(h.isRetired(RETIRED)).toBe(true);
    expect(h.isRetired(CUR)).toBe(false);
    expect(checkMailToken(h, RETIRED, 'GET /api/ledger')).toBe('bad');
    expect(checkMailToken(h, RETIRED, 'GET /api/ledger')).toBe('bad');
    expect(checkMailToken(h, RETIRED, 'POST /api/mail')).toBe('bad');
    expect(checkMailToken(h, RETIRED)).toBe('bad');
    // A wrong value that was never issued is bad too, and counts nothing.
    expect(checkMailToken(h, 'f'.repeat(64), 'GET /api/ledger')).toBe('bad');
    expect(h.counters().retired).toBe(4);
    expect(h.counters().retiredByLane).toEqual({ 'GET /api/ledger': 2, 'POST /api/mail': 1, unnamed: 1 });
    // One warning inside the minute, naming the lane; a second once the minute has passed.
    expect(warn).toHaveBeenCalledTimes(1);
    const first = String(warn.mock.calls[0]![0]);
    expect(first).toMatch(/^ccrc-server: box token: a retired value was presented/);
    expect(first).toContain('GET /api/ledger');
    t += 60_000;
    checkMailToken(h, RETIRED, 'POST /api/mail');
    expect(warn).toHaveBeenCalledTimes(2);
    const all = warn.mock.calls.flat().join('\n');
    expect(all).not.toContain(RETIRED);
    expect(all).not.toContain(sha(RETIRED).toString('hex'));
  });

  it('a literal string still works exactly as before, and ignores the lane', () => {
    expect(checkMailToken(CUR, CUR, 'POST /api/mail')).toBe('ok');
    expect(checkMailToken(CUR, 'wrong', 'POST /api/mail')).toBe('bad');
    expect(checkMailToken(CUR, undefined, 'POST /api/mail')).toBe('legacy');
    expect(checkMailToken(null, CUR, 'POST /api/mail')).toBe('unconfigured');
  });

  it('extractToken is exported with its rule unchanged', () => {
    expect(extractToken('# c\n\n  ab cd \nnext\n')).toBe('abcd');
    expect(extractToken('# only\n')).toBeNull();
  });
});

describe('matchDigestSlots: every slot compared, every time', () => {
  const counting = (): { calls: () => number; compare: (a: Buffer, b: Buffer) => boolean } => {
    let n = 0;
    return { calls: () => n, compare: (a, b) => { n++; return timingSafeEqual(a, b); } };
  };

  it('calls the comparator once per slot whether the first, the last or no slot matches', () => {
    const slots = [sha('x'), sha('y'), sha('z')];
    for (const [presented, want] of [[sha('x'), 0], [sha('z'), 2], [sha('w'), -1]] as const) {
      const c = counting();
      expect(matchDigestSlots(presented, slots, c.compare)).toBe(want);
      expect(c.calls()).toBe(slots.length);
    }
  });

  it('answers the FIRST matching index when two slots hold the same digest', () => {
    expect(matchDigestSlots(sha('x'), [sha('y'), sha('x'), sha('x')])).toBe(1);
    expect(matchDigestSlots(sha('x'), [])).toBe(-1);
  });

  it('the holder compares all five slots (current, three pending, previous) on every match, however many are filled', () => {
    expect(TOKEN_SLOTS).toHaveLength(5);                              // D-4413: the fixed-slot compare grew by exactly one
    for (const fill of ['all', 'two-pending', 'current-only'] as const) {
      const c = counting();
      const h = new BoxTokenHolder({ compare: c.compare });
      h.setSlots(fill === 'all'
        ? { current: CUR, pending: [{ id: G0, value: P0 }, { id: G1, value: P1 }, { id: G2, value: P2 }], previous: { value: PREV, until: Infinity } }
        : fill === 'two-pending'
          ? { current: CUR, pending: [{ id: G0, value: P0 }, { id: G1, value: P1 }], previous: { value: PREV, until: Infinity } }
          : { current: CUR, pending: [], previous: null });
      for (const v of [CUR, PREV, P2, 'a1'.repeat(32)]) {
        const before = c.calls();
        h.match(v);
        expect(c.calls() - before, `${fill}: ${v.slice(0, 1)}`).toBe(5);
      }
    }
  });

  it('the combine carries no short-circuit, ternary, early exit, some or find (source scan)', () => {
    const src = readFileSync(path.join(repoRoot, 'server', 'src', 'coord', 'token.ts'), 'utf8');
    const begin = src.split('// combine:' + 'begin').length - 1;
    const end = src.split('// combine:' + 'end').length - 1;
    expect([begin, end], 'exactly one combine region').toEqual([1, 1]);
    const body = src.slice(src.indexOf('// combine:' + 'begin'), src.indexOf('// combine:' + 'end'));
    expect(body).toContain('|=');
    for (const banned of [/\|\|/, /&&/, /\?/, /\breturn\b/, /\bbreak\b/, /\bcontinue\b/, /\.some\(/, /\.find\(/]) {
      expect(body, `the combine carries ${banned}`).not.toMatch(banned);
    }
  });
});

describe('every box-token lane names itself to the check', () => {
  // The 14 call sites (server.ts 2, coord/routes.ts 11, update/routes.ts 1) each
  // pass their route key, so a retired presentation is counted per lane. The
  // one call before the first registration is requireMailToken's own, which
  // passes the `route` its 14 callers name.
  const CALL = /checkMailToken\(deps\.mailToken \?\? null, req\.headers\[MAIL_TOKEN_HEADER\](?:, ([^)]+))?\)/g;
  const sites = (rel: string): { lane: string | null; route: string | null }[] => {
    const src = readFileSync(path.join(repoRoot, 'server', 'src', rel), 'utf8');
    const regs = [...src.matchAll(/app\.(get|post)\('([^']+)'/g)]
      .map((m) => ({ key: `${m[1]!.toUpperCase()} ${m[2]!}`, at: m.index! }));
    return [...src.matchAll(CALL)].map((m) => {
      const owner = regs.filter((r) => r.at < m.index!).pop();
      return { lane: m[1] ?? null, route: owner?.key ?? null };
    });
  };

  it('all fourteen pass a lane, and a literal lane is its own route key', () => {
    const all = ['server.ts', 'coord/routes.ts', 'update/routes.ts'].flatMap(sites);
    expect(all).toHaveLength(14);
    for (const s of all) {
      expect(s.lane, `a call inside ${s.route ?? 'the helper'} names no lane`).not.toBeNull();
      if (s.route === null) expect(s.lane).toBe('route');
      else expect(s.lane).toBe(`'${s.route}'`);
    }
  });

  it('a route counts a retired value against its own lane', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = new BoxTokenHolder();
    h.setSlots({ current: CUR, pending: [], previous: null });
    h.setRetired([sha(RETIRED).toString('hex')]);
    const home = mkTmp('ccrc-token-lane-');
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const app = await buildServer({ ...testDeps(home), mailToken: h, coord });
    try {
      const ledger = (tok: string) => app.inject({ method: 'GET', url: '/api/ledger', headers: { 'x-ccrc-mail-token': tok } });
      expect((await ledger(RETIRED)).statusCode).toBe(401);
      expect((await ledger(CUR)).statusCode).not.toBe(401);
      const notify = await app.inject({ method: 'POST', url: '/api/notify',
        headers: { 'x-ccrc-mail-token': RETIRED }, payload: { message: 'x' } });
      expect(notify.statusCode).toBe(401);
      expect(h.counters().retiredByLane).toEqual({ 'GET /api/ledger': 1, 'POST /api/notify': 1 });
    } finally { await app.close(); vi.restoreAllMocks(); }
  });
});
