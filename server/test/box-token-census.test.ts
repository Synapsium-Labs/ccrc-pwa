// D-1156: the box-token surface, DERIVED from its own call sites, and every
// prose site that states a count about it checked against that derivation.
//
// WHY THIS EXISTS. Three sites in the tree stated a surface nothing checked.
// Wave 5 corrected the CLAUDE.md one and then MEASURED that nothing held the
// correction: it restored the false sentence and the suite stayed green. It
// deliberately did not write this scanner, because a scanner asserting the truth
// of all three claims reds the build until every site is corrected — so the
// mechanism and the corrections have to land together, in the wave that changes
// the count anyway. This is that wave: it adds `/api/coord/caps`.
//
// THE SET IS NAMED, and that is the whole design (D-1162). The three sites were
// each counting a DIFFERENT thing — "box-token-gated coordination routes"
// (hard-require), "box-token machine lanes" (including the five dual-credential
// GETs and `/api/notify`), and `requireMailToken` call sites alone. A scanner
// demanding one word from all three would be wrong twice. So this file derives
// ONE set — every route handler that CONSULTS the box token, by either
// mechanism, across both files that register one — and the prose was rewritten
// to speak that set rather than the scanner widened to tolerate three
// vocabularies.
//
// HOW TO ADD A SITE, because the next one is already known. Wave 8 inherits
// `ccd/ccrc-api:32-38`, which states the ungated set as TWO against the four in
// `UNGATED` (D-1168) — out of scope here because `ccd/` is on the coordinator's
// agent-first deploy lane. Pointing this mechanism at it is meant to be a few
// lines, not a redesign: read the file, slice the passage with `passage()`, and
// compare `numeralsIn()` against `word(<the derived size>)` — the same
// set-naming, one more site. Nothing about the derivation needs to change.
//
// THAT NOTE HAS NOW BEEN EXERCISED ONCE, which is the only way to know it is
// true. `auth-gate.test.ts` stated "all 55 HTTP routes" and "the 15 exempt ones"
// where the tree derives 68 and 24 (D-1223) — the same defect family, and it
// took one describe block. It landed THERE rather than here for a reason worth
// copying: that file already derives its count at runtime from the route table,
// and a census scanning it from here would have had to rebuild that table to
// have anything to compare against. The rule the two sites share is "the number
// is derived where it is derivable, and the prose beside it is checked against
// that"; where the derivation already lives decides which file holds the pin.
// That site reads DIGITS, this one reads number words, and each says so.
//
// CORPUS SCOPING, stated so it cannot creep. Repo-root docs plus the source that
// states a census. NOT `docs/superpowers/{plans,specs,programs}`, whose archived
// generations say TWO doors, THREE doors and "all six coordinator write routes"
// BY DESIGN — correcting them would falsify the history the D-N ledger depends
// on. NOT `graphify-out/`, a generated artefact. NOT `ccd/`, which is out of
// scope this wave and on the coordinator's agent-first deploy lane (D-1168:
// `ccd/ccrc-api` states the ungated set as TWO and is reported, not fixed).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');

const COORD_SRC = read('server/src/coord/routes.ts');
const SERVER_SRC = read('server/src/server.ts');
const GATE_SRC = read('server/src/auth/gate.ts');
const README = read('README.md');
const CLAUDE_MD = read('CLAUDE.md');
const AUTH_GATE_TEST = read('server/test/auth-gate.test.ts');

/** The two mechanisms that count as "this handler consulted the box token" —
 *  the same pair `coord-pause-route.test.ts` and `auth-gate.test.ts` already
 *  use. Both, never one: `POST /api/mail` and its ack route gate INLINE rather
 *  than through the shared helper, and a scanner crediting only the helper
 *  reports them ungated, which is false. Arriving at eleven instead of eighteen
 *  by counting `requireMailToken` alone is exactly how D-1156's own ledger entry
 *  had to add a prose caveat about the mail pair. */
const GATE_PATTERNS = [/requireMailToken\(req/, /checkMailToken\(/];

/** Every `app.get`/`app.post` handler in one source file whose body consults the
 *  box token, keyed `VERB /path`. Bodies run from a route's own registration to
 *  the next one, the same slice `auth-gate.test.ts:405-413` takes. */
const lanesIn = (src: string): string[] => {
  const starts = [...src.matchAll(/app\.(get|post)\('([^']+)'/g)]
    .map((m) => ({ key: `${m[1]!.toUpperCase()} ${m[2]!}`, at: m.index! }));
  return starts
    .filter(({ at }, i) => {
      const body = src.slice(at, starts[i + 1]?.at ?? src.length);
      return GATE_PATTERNS.some((re) => re.test(body));
    })
    .map((s) => s.key);
};

const COORD_LANES = lanesIn(COORD_SRC);
const ALL_LANES = [...COORD_LANES, ...lanesIn(SERVER_SRC)];

/** The four doors, read from the file that decides them rather than retyped —
 *  the same literal `coordinator-skill.test.ts` already harvests. */
const UNGATED_DOORS = ((): string[] => {
  const m = /UNGATED = new Set\(\[([^\]]*)\]\)/.exec(read('server/test/coord-pause-route.test.ts'));
  expect(m, 'the UNGATED literal moved — this scan is over nothing').not.toBeNull();
  return [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
})();

/** Number words, index-addressed. Starts the SCAN at `two` for the same reason
 *  `coord-pause-route.test.ts`'s `CARD_RE` does: `one` and `zero` are ordinary
 *  prose — README's own auth paragraph says "for one deploy generation" about
 *  something else entirely — and a scanner that read them would fire on
 *  sentences making no claim about this surface at all. */
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four',
  'twenty-five', 'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine', 'thirty'];
const SCAN_RE = new RegExp(`\\b(${WORDS.slice(2).join('|')})\\b`, 'gi');

// A LIMIT OF THAT REGEX, recorded because it is silent and dated. Leftmost-first
// alternation plus `\b` means a hyphenated word matches only its first half:
// `twenty-one` scans as `twenty`, `twenty-five` as `{twenty, five}`. Harmless
// while the surface is nineteen lanes — no scanned passage can legitimately hold
// a number above twenty today — but the day the count passes twenty this scanner
// reds on CORRECT prose, and the fix is to match the hyphenated forms first
// rather than to widen `word()`.

// A CONSTRAINT ON PROSE INSIDE THE SCANNED PASSAGES, stated because it is easy
// to trip and the failure reads like a false alarm until you know: within a
// scanned passage, ANY number word from `two` upward is read as a claim about
// this surface, and the passage's numbers must appear in the exact ORDER its
// assertion states. That is deliberate — it is what makes a SECOND stale number
// impossible to leave behind beside a corrected one — but it means an unrelated
// number in one of these paragraphs has to be spelled as a word the scan does
// not read (`both`, `either`, `one`) or moved out of the passage. Measured while
// writing this file: a correction to `gate.ts` that said "in TWO directions"
// reddened its own scanner.
//
// WHAT IT DOES NOT HOLD, corrected after the coordinator's review said the
// earlier version of this note overstated it (D-1214). Order is a proxy for
// attachment, not attachment itself. Rewriting a passage so that the CLAIMS swap
// places along with their numbers leaves the sequence unchanged — and correctly
// so, because that prose is still true. What the sequence does hold is the case
// that was measured green before it: two numbers exchanged while their sentences
// stay put.

const word = (n: number): string => {
  expect(WORDS[n], `the surface outgrew the word list at ${n}`).toBeDefined();
  return WORDS[n]!;
};

/** Every number word in a passage, IN TEXT ORDER and with repeats kept.
 *
 *  ORDERED, not a set (D-1214). The first version answered a `Set`, so the
 *  assertions below checked MEMBERSHIP only — and the coordinator's review
 *  measured what that lets through: transposing `eighteen` and `nineteen`
 *  between the two claims in `gate.ts` (":75" says how many box-token machine
 *  lanes there are, ":77" says how many things check the token) was GREEN across
 *  all five suites that read those words. D-1161's original defect was "wrong in
 *  KIND as well as in number", and a set catches the number half only.
 *
 *  A sequence is not full attachment-checking, and this file does not claim it
 *  is: it holds that each claim in a passage carries the count its POSITION says
 *  it should. That is exactly enough to red a transposition, which is the
 *  measured hole, and it stays derived — the alternative, anchoring each numeral
 *  to a hand-written neighbouring phrase, re-introduces the hand-kept prose this
 *  whole file exists to delete. */
const numeralsIn = (text: string): string[] =>
  [...text.matchAll(SCAN_RE)].map((m) => m[0]!.toLowerCase());

/** Slice a named passage between two literal anchors, failing LOUDLY on either
 *  — `coord-pause-route.test.ts:343-357`'s helper, copied for its reason as much
 *  as its shape: an anchor that stopped matching yields `''`, and `''` satisfies
 *  every negative assertion below it. This tree has been bitten by that twice. */
const line = (name: string, text: string, needle: string): string => {
  const hit = text.split('\n').filter((l) => l.includes(needle));
  expect(hit.length, `${name}: expected exactly one line containing ${needle}`).toBe(1);
  return hit[0]!;
};

const passage = (name: string, text: string, from: string, to: string): string => {
  const a = text.indexOf(from);
  expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a + from.length);
  expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
  const out = text.slice(a, b);
  expect(out.length, `${name} is too short to be the passage`).toBeGreaterThan(120);
  return out;
};

describe('the box-token surface is derived, and no prose site under-claims it', () => {
  it('the scan finds what it claims to scan', () => {
    // ANTI-VACUITY FIRST: every assertion below is satisfied by an empty set.
    // A floor, two named members that must be there, and the arithmetic that
    // says `server.ts` contributed exactly the one lane it has.
    expect(COORD_LANES.length, 'the coord scan collapsed').toBeGreaterThan(10);
    expect(COORD_LANES, 'the inline-gated mail route is missing — the scanner narrowed')
      .toContain('POST /api/mail');
    expect(COORD_LANES).toContain('GET /api/runs');
    expect(ALL_LANES, 'the server.ts lane is missing').toContain('POST /api/notify');
    expect(ALL_LANES.length).toBe(COORD_LANES.length + 1);
    expect(UNGATED_DOORS.length, 'the door list collapsed').toBeGreaterThan(3);
  });

  it('a route with NO box-token check is not counted as a lane', () => {
    // The direction the scan could not fail in on its own. `POST
    // /api/sessions/:id/kickoff` is a coordination WRITE registered in
    // `server.ts` that consults no token at all, and CLAUDE.md says so in prose
    // — so it is the natural probe for a scanner that had started matching
    // everything.
    expect(ALL_LANES).not.toContain('POST /api/sessions/:id/kickoff');
    for (const door of UNGATED_DOORS) expect(ALL_LANES).not.toContain(`POST ${door}`);
  });

  it('README states the DERIVED lane counts', () => {
    const p = passage('README, the auth paragraph', README,
      'What is gated, and what is not:', 'Enrolling a passkey');
    // ORDER IS PART OF THE CLAIM: this paragraph says the TOTAL first ("the
    // nineteen machine lanes") and then breaks it down ("eighteen
    // box-token-consulting coordination routes plus `/api/notify`"). gate.ts
    // says the same two facts the other way round, and both spellings are
    // correct where they stand — which is why each site states its own sequence
    // rather than sharing one expectation.
    expect(numeralsIn(p), 'README\'s auth paragraph states a count this tree does not have')
      .toEqual([word(ALL_LANES.length), word(COORD_LANES.length)]);
  });

  it('README names every gated run route, and the ungated doors AS exceptions', () => {
    const p = passage('README, the mail-bus paragraph', README,
      '`/api/mail` (and its ack route)', 'Minting the token file matters');
    // ANTI-VACUITY FOR BOTH LOOPS BELOW (D-1226). Each iterates a FILTERED
    // derivation, and a filter that stops matching turns its loop into a pass
    // over nothing — the failure mode this file's own header calls out and then
    // walked into twice.
    const runLanes = COORD_LANES.filter((k) => k.startsWith('POST /api/runs'));
    const runDoors = UNGATED_DOORS.filter((d) => d.startsWith('/api/runs'));
    expect(runLanes.length, 'no gated run routes found — this loop is over nothing')
      .toBeGreaterThan(3);
    expect(runDoors.length, 'no ungated run doors found — this loop is over nothing')
      .toBeGreaterThan(1);
    for (const key of runLanes) {
      // The paragraph names the sub-routes in the shorthand prose actually uses
      // (`/:id/dispatch`), so the needle is the key with the shared prefix
      // stripped. The BARE `POST /api/runs` has no suffix to strip, and the
      // degraded needle `/api/runs` would be satisfied by any of its own
      // siblings — a structurally vacuous check (self-review). It is matched on
      // its full backticked spelling instead, which nothing else can satisfy.
      const needle = key === 'POST /api/runs'
        ? '`POST /api/runs`'
        : key.replace('POST /api/runs', '');
      expect(needle.length, `no usable needle for ${key}`).toBeGreaterThan(2);
      expect(p, `the mail-bus paragraph omits the gated ${key}`).toContain(needle);
    }
    for (const door of runDoors) {
      expect(p, `the mail-bus paragraph does not name ${door} as an exception`).toContain(door);
    }
    // …and it states no COUNT at all any more: it enumerates instead, so there
    // is no second number to go stale beside the enumeration.
    expect(numeralsIn(p), 'the mail-bus paragraph grew a hand-kept count again').toEqual([]);
  });

  it('README\'s caps paragraph ENUMERATES the ungated doors instead of counting them', () => {
    // D-1216. This paragraph carried "unlike the four operator doors below" — a
    // hand-kept cardinal about `UNGATED.size`, in the one wave built to delete
    // that class, about the very number that has already gone two → three →
    // four and left `ccd/ccrc-api` stuck at "two". It sat outside both scanned
    // passages, which is the only reason it survived; its own neighbour thirty
    // lines up gets it right by naming the doors.
    //
    // So the paragraph is now scanned too, and it must state NO count at all —
    // and name every door, derived, so a fifth one reds this rather than
    // silently falsifying a sentence.
    const p = passage('README, the caps paragraph', README,
      '**Caps and pause.**', 'Pause is a');
    expect(numeralsIn(p), 'the caps paragraph grew a hand-kept count').toEqual([]);
    for (const door of UNGATED_DOORS) {
      expect(p, `the caps paragraph no longer names the ungated ${door}`).toContain(door);
    }
  });

  it('auth/gate.ts states the derived lane counts wherever it states one', () => {
    // Both passages name the box-token lanes FIRST and the total second — the
    // opposite order to README's, and the transposition the review measured as
    // green is precisely the swap of these two.
    for (const [name, from, to] of [
      ['gate.ts, EXEMPT reason 2', '  2. The ', '  3. `POST /api/auth/login`'],
      ['gate.ts, the CSRF/origin note', ' * EXEMPT ROUTES ARE SKIPPED', 'their real guard is'],
    ] as const) {
      const p = passage(name, GATE_SRC, from, to);
      expect(numeralsIn(p), `${name} states a count this tree does not have`)
        .toEqual([word(COORD_LANES.length), word(ALL_LANES.length)]);
    }
  });

  it("auth-gate.test.ts's own census title states the derived count", () => {
    // The TITLE LINE alone, not the block around it. The comment beneath that
    // test is HISTORY — "EIGHTEEN since GET /api/runs/:id/items joined,
    // SEVENTEEN before that" — and a count claim about the tree NOW is a
    // different kind of sentence from a record of what the count used to be.
    // Scoping to one line is what keeps this scanner from demanding that the
    // history be falsified. (`coord-pause-route.test.ts` draws the same line
    // with its CAPS convention; this corpus has no CAPS to key on.)
    const t = line("auth-gate.test.ts's census title", AUTH_GATE_TEST, 'box-token lanes in EXEMPT');
    expect(numeralsIn(t), 'the census test titles a count the tree does not have')
      .toEqual([word(COORD_LANES.length), word(ALL_LANES.length)]);
  });

  it("CLAUDE.md's box-token bullet is TRUE, not merely present", () => {
    // THE PIN D-1156 ASKED FOR. Wave 5 corrected this bullet and measured that
    // nothing held it — the false sentence went back in and the suite stayed
    // green. Each claim is now checked against the source it describes.
    const raw = passage('CLAUDE.md, the box-token bullet', CLAUDE_MD,
      '- **Box token gates every coordination WRITE**', '\n- **');
    // FLATTENED before matching, the same way `resume-reclaim-l0.test.ts`
    // flattens its corpus and for the same reason: this bullet is hard-wrapped
    // prose, so a backticked route name routinely spans a newline
    // (`\`POST\n  /api/claims\``) and a literal containment check would miss it
    // — a false RED, which is the failure mode that gets a scanner deleted.
    const bullet = raw.replace(/\s+/g, ' ');
    // THE UNDER-CLAIM PIN, DERIVED — not a hand-kept list of four names.
    //
    // The bullet's claim is precise and worth reading exactly: the two prefixes
    // `/api/mail*` and `/api/runs*` are "the bulk of the box-token surface, not
    // the whole of it", and it then NAMES the `requireMailToken` lanes that sit
    // outside both. So the property to hold is not "does it say the right
    // number" but "does it name every lane its own sentence promises to name" —
    // which is derivable, and stays derivable when a route is added.
    //
    // Scoped to `requireMailToken` because that is what the sentence says. The
    // dual-credential GETs (`/api/lifecycle`, `/api/peers`, `/api/claims`) also
    // sit outside the prefixes and consult the token, but through an inline
    // `checkMailToken` as a cookie-OR-token fallback, and the bullet does not
    // claim them.
    const requireSites = ((): string[] => {
      const starts = [...COORD_SRC.matchAll(/app\.(get|post)\('([^']+)'/g)]
        .map((m) => ({ key: `${m[1]!.toUpperCase()} ${m[2]!}`, path: m[2]!, at: m.index! }));
      return starts
        .filter(({ at }, i) => /requireMailToken\(req/
          .test(COORD_SRC.slice(at, starts[i + 1]?.at ?? COORD_SRC.length)))
        .filter((r) => !r.path.startsWith('/api/mail') && !r.path.startsWith('/api/runs'))
        .map((r) => r.key);
    })();
    expect(requireSites.length, 'the outside-the-prefixes scan collapsed').toBeGreaterThan(2);
    for (const key of requireSites) {
      // `toContain` on a bare key would let a LONGER sibling satisfy a shorter
      // one — `POST /api/claims` is a substring of `POST /api/claims/:id/release`
      // (self-review) — so the match is anchored on the backticked spelling the
      // bullet actually uses, which ends the path.
      expect(bullet,
        `the bullet promises to name every requireMailToken lane outside the two prefixes, ` +
        `and does not name ${key} — the surface grew and the sentence did not`)
        .toContain(`\`${key}\``);
    }
    // THE OVER-CLAIM DIRECTION, and it is a different assertion from the one
    // that used to stand here (D-1215). That one read
    // `expect(COORD_LANES).toContain(key)` over the DERIVED `requireSites`,
    // which is a subset of `COORD_LANES` by construction — a tautology whose
    // failure message promised a check it could not perform. (It meant
    // something in the draft, where the list it iterated was hand-written;
    // deriving the list is what emptied it.) Measured by the coordinator's
    // review: adding `POST /api/coord/caps` to the bullet as a requireMailToken
    // lane stayed green, while deleting `GET /api/ledger` reddened correctly —
    // one direction held, the other did not.
    //
    // So the check now runs over what the BULLET says rather than over what the
    // source says: every route it names must be a box-token lane, unless it is
    // one of the routes the bullet's own sentences declare NOT to be one — the
    // ungated doors (derived) and the kickoff route (named, and pinned as a
    // non-lane directly below).
    const NOT_LANES = new Set([...UNGATED_DOORS.map((d) => `POST ${d}`),
      'POST /api/sessions/:id/kickoff']);
    const named = [...new Set([...bullet.matchAll(/`(GET|POST) (\/api\/[A-Za-z0-9/:_-]+)`/g)]
      .map((m) => `${m[1]!} ${m[2]!}`))];
    expect(named.length, 'the bullet names no routes at all — this scan is over nothing')
      .toBeGreaterThan(6);
    for (const key of named.filter((k) => !NOT_LANES.has(k))) {
      expect(ALL_LANES,
        `the bullet names ${key} as a box-token lane and it consults no box token — ` +
        `the sentence claims more than the source does`).toContain(key);
    }
    // …and the route it names as carrying NO box token really carries none.
    expect(bullet).toContain('POST /api/sessions/:id/kickoff');
    expect(ALL_LANES, 'the kickoff route acquired a box-token gate — the bullet is now false')
      .not.toContain('POST /api/sessions/:id/kickoff');
    // …and every door it lists as ungated really is one.
    for (const door of UNGATED_DOORS) {
      expect(bullet, `the bullet no longer names the ungated ${door}`).toContain(door);
    }
  });
});
