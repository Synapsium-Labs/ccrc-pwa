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
// (hard-require), "box-token machine lanes" (including the dual-credential GETs
// — five when this note was written in 2026-09, six once the ask lane added
// `GET /api/asks`, and seven once feed joined them — and `/api/notify`), and
// `requireMailToken` call sites alone. A scanner
// demanding one word from all three would be wrong twice. So this file derives
// ONE set — every route handler that CONSULTS the box token, by either
// mechanism, across the three files that register one — and the prose was rewritten
// to speak that set rather than the scanner widened to tolerate three
// vocabularies.
//
// HOW TO ADD A SITE — and the next one is now done. Wave 8 corrected
// `ccd/ccrc-api`'s deliberately-absent block, which stated the ungated set as
// two against the four in `UNGATED` (D-1168), and put it under a scanner. It
// landed in `coord-pause-route.test.ts`'s `enumerations()` rather than here, and
// the reason is the same one that sent D-1223 to `auth-gate.test.ts`: the
// stronger home is the file that already derives the thing being checked.
// `enumerations()` feeds BOTH the count test and the lists-ALL test, so that
// block must now name every door as well as state the count; the recipe this
// note used to prescribe (slice with `passage()`, compare `numeralsIn()` against
// `word(<the derived size>)`) reads number words and nothing else. The rule the
// sites share is unchanged: the number is derived where it is derivable, and the
// prose beside it is checked against that.
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
// on. NOT `graphify-out/`, a generated artefact. NOT `ccd/`, which was out of
// scope in wave 6 and is on the coordinator's agent-first deploy lane — its one
// census site, `ccd/ccrc-api`'s deliberately-absent block, was corrected in wave
// 8 and is now scanned by `coord-pause-route.test.ts`'s `enumerations()`, which
// reads the door names and the CAPS cardinal together (D-1168, closed).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');

const COORD_SRC = read('server/src/coord/routes.ts');
const SERVER_SRC = read('server/src/server.ts');
/** The THIRD file that registers routes (update-management W2, design 2026-09-20
 *  §12 census step (a)). Without it, "the update routes are absent from every
 *  box-token lane" would be a measured zero over an empty set — this file is
 *  where a box-token call on the update surface would BE, so it is read like
 *  the two above. */
const UPDATE_SRC = read('server/src/update/routes.ts');
const GATE_SRC = read('server/src/auth/gate.ts');
const README = read('README.md');
const CLAUDE_MD = read('CLAUDE.md');
const AUTH_GATE_TEST = read('server/test/auth-gate.test.ts');
const CCD_SRC = read('ccd/ccd');

/** The two mechanisms that count as "this handler consulted the box token" —
 *  the same pair `coord-pause-route.test.ts` and `auth-gate.test.ts` already
 *  use. Both, never one: `POST /api/mail` and its ack route gate INLINE rather
 *  than through the shared helper, and a scanner crediting only the helper
 *  reports them ungated, which is false. Arriving at eleven instead of eighteen
 *  by counting `requireMailToken` alone is exactly how D-1156's own ledger entry
 *  had to add a prose caveat about the mail pair. */
const GATE_PATTERNS = [/requireMailToken\(req/, /checkMailToken\(/];

/** Every fastify registration VERB this scan credits — not just `get`/`post`.
 *  F14: the two callers below (`lanesIn` and the update-surface `REGISTERED`)
 *  used to match only `get|post`, so a route registered with any other verb —
 *  or through `app.route({...})` — was invisible to both: not counted as a
 *  lane, not counted as a door, and "no route can join or leave without the
 *  literal moving" was false for exactly that shape. Measured (fix round 1,
 *  scratch copy of `update/routes.ts`): a planted `app.delete(...)` and a
 *  planted `app.route({ method: 'PUT', ... })` were both absent from
 *  `REGISTERED` before this fix, so "UPDATE_DOORS is exactly the rest" stayed
 *  GREEN over a door it never saw. */
const ALL_VERBS = 'get|post|put|patch|delete|head|options|all';

/** `app.route({ method, url, ... })` calls, brace-counted rather than regexed
 *  end to end — the handler nested inside the object routinely contains its
 *  own `{`/`}` pairs, so a naive `[\s\S]*?\}\)` would close on the FIRST inner
 *  brace followed by a `)` and silently mis-read the object's extent. `method`
 *  may be a single-quoted/double-quoted string or an array of them; each
 *  method the call registers is emitted as its own entry sharing the call's
 *  `at`, so a `body.slice(at, next.at)` still spans the whole registration. */
const routeCallsIn = (src: string): { key: string; at: number }[] => {
  const out: { key: string; at: number }[] = [];
  const re = /app\.route\(\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const openBrace = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = openBrace; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close === -1) continue;
    const body = src.slice(openBrace + 1, close);
    const methodMatch = /method:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/.exec(body);
    const urlMatch = /url:\s*'([^']+)'|url:\s*"([^"]+)"/.exec(body);
    if (!methodMatch || !urlMatch) continue;
    const url = urlMatch[1] ?? urlMatch[2]!;
    const methods = methodMatch[1]!.startsWith('[')
      ? [...methodMatch[1]!.matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => (x[1] ?? x[2])!.toUpperCase())
      : [methodMatch[1]!.replace(/['"]/g, '').toUpperCase()];
    for (const method of methods) out.push({ key: `${method} ${url}`, at: m.index });
  }
  return out;
};

/** Every registration in one source file — every `app.<verb>('/path', ...)` for
 *  every fastify verb, plus every `app.route({...})` — keyed `VERB /path`, in
 *  source order. The shared extraction `lanesIn` and `REGISTERED` both build on,
 *  so a verb or shape invisible to one is invisible to the other. */
const registrationsIn = (src: string): { key: string; at: number }[] => {
  const verbRe = new RegExp(`app\\.(${ALL_VERBS})\\('([^']+)'`, 'g');
  const verbHits = [...src.matchAll(verbRe)]
    .map((mm) => ({ key: `${mm[1]!.toUpperCase()} ${mm[2]!}`, at: mm.index! }));
  return [...verbHits, ...routeCallsIn(src)].sort((a, b) => a.at - b.at);
};

/** Every handler in one source file whose body consults the box token, keyed
 *  `VERB /path`. Bodies run from a route's own registration to the next one,
 *  the same slice `auth-gate.test.ts:432-440` takes. */
const lanesIn = (src: string): string[] => {
  const starts = registrationsIn(src);
  return starts
    .filter(({ at }, i) => {
      const body = src.slice(at, starts[i + 1]?.at ?? src.length);
      return GATE_PATTERNS.some((re) => re.test(body));
    })
    .map((s) => s.key);
};

const COORD_LANES = lanesIn(COORD_SRC);
const UPDATE_LANES = lanesIn(UPDATE_SRC);
const ALL_LANES = [...COORD_LANES, ...lanesIn(SERVER_SRC), ...UPDATE_LANES];

/** A named `new Set([...])` literal in `coord-pause-route.test.ts`, read from the
 *  file that decides it rather than retyped — the same literal
 *  `coordinator-skill.test.ts` already harvests. */
const harvestSet = (name: string): string[] => {
  const src = read('server/test/coord-pause-route.test.ts');
  const m = new RegExp(`${name} = new Set\\(\\[([^\\]]*)\\]\\)`).exec(src);
  expect(m, `the ${name} literal moved — this scan is over nothing`).not.toBeNull();
  return [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
};

/** The four release valves (D-282). */
const UNGATED_DOORS = harvestSet('UNGATED');

/** The coordination writes that are session-gated ONLY — no box token, and not a
 *  release valve either. Derived for the same reason as the doors above: this
 *  wave's own `POST /api/coord/caps` joined the class, and the census hard-coded
 *  the OTHER member instead of reading the set (D-1231). */
const SESSION_ONLY_DOORS = harvestSet('SESSION_ONLY');

/** The one session-only write that cannot be harvested, with the reason stated so
 *  it is a recorded exception rather than a retyped list. `SESSION_ONLY` lives in
 *  a file that scans `coord/routes.ts` alone, and this route is registered in
 *  `server.ts`, so it is ABSENT there BY MEASUREMENT rather than by oversight —
 *  that file's own docstring says so. If the scan there widens to `server.ts`,
 *  this literal comes out and the harvest covers it. */
const KICKOFF = '/api/sessions/:id/kickoff';

/** Every coordination write the bullet must describe as carrying no box token. */
/** The update control plane's session-only routes (design 2026-09-20 §12 census
 *  step (b): the FOUR the W2 wave registers of §12's six). Registered from `server/src/update/routes.ts`,
 *  which `coord-pause-route.test.ts`'s `SESSION_ONLY` harvest cannot see for the
 *  kickoff route's reason. Hand-kept for the NAMES only: the update-surface
 *  describe below derives the same set from the file and compares in both
 *  directions, so a route there cannot join or leave without this literal
 *  moving. Programme wave 5 (spec W4 part B) appends `/api/updates/apply` and
 *  `/api/updates/rollback` with their routes. */
const UPDATE_DOORS = ['/api/updates', '/api/updates/intent', '/api/updates/refresh', '/api/updates/ack'];

/** Every session-only route the bullet must describe as carrying no box token. */
const SESSION_ONLY_ALL = [...SESSION_ONLY_DOORS, KICKOFF, ...UPDATE_DOORS];

/** Number words, index-addressed. Starts the SCAN at `two` for the same reason
 *  `coord-pause-route.test.ts`'s `CARD_RE` does: `one` and `zero` are ordinary
 *  prose — README's own auth paragraph says "for one deploy generation" about
 *  something else entirely — and a scanner that read them would fire on
 *  sentences making no claim about this surface at all. */
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four',
  'twenty-five', 'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine', 'thirty'];
// D-2168: LONGEST FIRST, not numeric order. A JS alternation is leftmost-first,
// so with `twenty` ahead of `twenty-one` the shorter branch wins and `\b` ends
// the match at the hyphen — `twenty-one` scanned as `twenty`, and `twenty-two`
// as two tokens. Sorting by descending length makes every hyphenated form try
// before the bare word it starts with. `word()` is untouched, deliberately:
// widening it would change what a count MEANS rather than how it is read.
const SCAN_RE = new RegExp(
  `\\b(${[...WORDS.slice(2)].sort((a, b) => b.length - a.length).join('|')})\\b`, 'gi');

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
 *  all five suites that read those words. D-1242's original defect was "wrong in
 *  KIND as well as in number", and a set catches the number half only.
 *
 *  A sequence is not full attachment-checking, and this file does not claim it
 *  is: it holds that each claim in a passage carries the count its POSITION says
 *  it should. That is exactly enough to red a transposition, which is the
 *  measured hole, and it stays derived — the alternative, anchoring each numeral
 *  to a hand-written neighbouring phrase, re-introduces the hand-kept prose this
 *  whole file exists to delete.
 *
 *  THE COST, stated because the first version of this docstring stated the
 *  opposite and was measured wrong (D-1233). It said a rewrite that moves the
 *  CLAIMS along with their numbers "leaves the sequence unchanged — and correctly
 *  so". Backwards: when the claims move, their numbers move with them, the
 *  sequence changes, and a perfectly true rewrite REDS. Measured — rewriting
 *  README's auth paragraph breakdown-first ("the eighteen … coordination routes
 *  … plus `/api/notify` — nineteen machine lanes in all") fails here. So a
 *  scanned passage's sentence ORDER is pinned until the expectation moves with
 *  it, and every scanned passage now carries a marker saying so beside the prose,
 *  where the person rewriting it will actually look. The two assertions are split
 *  for the same reason: "you state a count this tree does not have" and "the
 *  counts are right and attached the wrong way round" are different repairs, and
 *  one message for both sends the second reader hunting for a number that is
 *  correct. */
const numeralsIn = (text: string): string[] =>
  [...text.matchAll(SCAN_RE)].map((m) => m[0]!.toLowerCase());

  // D-2168: leftmost-first alternation in ascending order made `twenty-one`
  // scan as `twenty`, so a correct sentence about a 21-lane surface read as a
  // sentence about a 20-lane one. Landed while the surface was still 18/19,
  // where it is provably a no-op — this test is the whole evidence of the fix.
  it('reads a hyphenated number word as one token', () => {
    expect(numeralsIn('the twenty-one box-token machine lanes')).toEqual(['twenty-one']);
    expect(numeralsIn('all twenty-two of them')).toEqual(['twenty-two']);
    expect(numeralsIn('the nineteen lanes')).toEqual(['nineteen']);
    expect(numeralsIn('twenty lanes, then twenty-five')).toEqual(['twenty', 'twenty-five']);
  });

/** Assert a passage's counts, in two steps with two different repairs (D-1233).
 *  WHICH numbers first, then in WHAT ORDER — a passage that has the right counts
 *  attached the wrong way round is a different fault from one stating a number
 *  the tree does not have, and it is fixed differently. */
const expectNumerals = (name: string, text: string, expected: string[]): void => {
  const seq = numeralsIn(text);
  expect([...seq].sort(), `${name} states a count this tree does not have`)
    .toEqual([...expected].sort());
  expect(seq, `${name}: the counts are right but attached the wrong way round — if you ` +
    'reordered the sentences, reorder this expectation in the same change ' +
    '(this passage is ORDER-PINNED)').toEqual(expected);
};

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
    // A floor, three named members that must be there, and the arithmetic
    // that says `server.ts` contributed exactly the two lanes it has.
    //
    // TWO, not one, since account-pool-membership wave 1 task 7 added
    // `GET /api/pools/epoch` (dual-credential, the `GET /api/feed` shape)
    // beside the long-standing `POST /api/notify` — the route's sibling,
    // `POST /api/pools/accounts/:id`, consults NO box token at all (same
    // stance as `POST /api/projects/:project/pool`), so it does not join
    // this set.
    expect(COORD_LANES.length, 'the coord scan collapsed').toBeGreaterThan(10);
    expect(COORD_LANES, 'the inline-gated mail route is missing — the scanner narrowed')
      .toContain('POST /api/mail');
    expect(COORD_LANES).toContain('GET /api/runs');
    expect(ALL_LANES, 'the server.ts lane is missing').toContain('POST /api/notify');
    expect(ALL_LANES, 'the new server.ts lane is missing').toContain('GET /api/pools/epoch');
    expect(ALL_LANES, 'the update projection read is missing — update/routes.ts is not being read')
      .toContain('GET /api/updates/intent/:nodeId');
    // THREE since update-management W2: `server.ts`'s pair plus the update
    // projection read, the one handler in `update/routes.ts` that consults the
    // box token (design 2026-09-20 §12, decision 15).
    expect(ALL_LANES.length).toBe(COORD_LANES.length + 3);
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

  /** The EXEMPT entries whose stated reason is D-149's exempt-but-authenticated
   *  argument, derived from `gate.ts`'s own table (D-1234). Sliced entry by entry
   *  the same way `lanesIn` slices handlers, so a reason paragraph belongs to the
   *  key above it. */
  const EXEMPT_BUT_AUTHENTICATED = ((): string[] => {
    const starts = [...GATE_SRC.matchAll(/^ {2}\['(GET|POST) ([^']+)',/gm)]
      .map((m) => ({ path: m[2]!, at: m.index! }));
    expect(starts.length, "the EXEMPT table's entries are no longer readable")
      .toBeGreaterThan(10);
    return starts
      .filter(({ at }, i) =>
        GATE_SRC.slice(at, starts[i + 1]?.at ?? GATE_SRC.length)
          .includes('EXEMPT-BUT-AUTHENTICATED'))
      .map((e) => e.path);
  })();

  it('README names every exempt-but-authenticated GET, derived from the EXEMPT table', () => {
    // D-1234. D-1216's fix replaced a false sentence ("none of them has a cookie
    // jar") with a hand-typed list of five route names that nothing checked — a
    // third copy of a set that already exists twice, inside a passage this file
    // slices and reads only the number words of. Measured: deleting two of the
    // five left the paragraph false and the suite green, while the caps paragraph
    // thirty lines away reds when a door name goes missing. Same treatment.
    expect(EXEMPT_BUT_AUTHENTICATED.length, 'the derived set collapsed — this loop proves nothing')
      .toBeGreaterThan(3);
    const p = passage('README, the auth paragraph', README,
      'What is gated, and what is not:', 'Enrolling a passkey');
    for (const routePath of EXEMPT_BUT_AUTHENTICATED) {
      expect(p, `the auth paragraph does not name the exempt-but-authenticated ${routePath} — ` +
        'the class grew and the sentence did not').toContain(`\`${routePath}\``);
    }
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
    expectNumerals("README's auth paragraph", p,
      [word(ALL_LANES.length), word(COORD_LANES.length)]);
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
      expectNumerals(name, p, [word(COORD_LANES.length), word(ALL_LANES.length)]);
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
    expectNumerals("auth-gate.test.ts's census title", t,
      [word(COORD_LANES.length), word(ALL_LANES.length)]);
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
    // dual-credential GETs also consult the token, but through an inline
    // `checkMailToken` as a cookie-OR-token fallback, and the bullet does not
    // claim them. There are SEVEN of them now — `/api/runs`, `/api/runs/:id/items`,
    // `/api/feed`, `/api/lifecycle`, `/api/peers`, `/api/claims` and `/api/asks`
    // (the ask pre-emption lane) — of which the first two are inside the
    // `/api/runs*` prefix and the last five sit outside it. This note named three, and had
    // named three since before either of the two additions; corrected by the
    // whole-branch review (M5 of that pass). It is a NOTE, not an assertion —
    // the loop below derives its own set, and this sentence only says which
    // lanes that set deliberately leaves out. What IS derived for this family
    // is `EXEMPT_BUT_AUTHENTICATED` above, and it is NOT a superset of these
    // seven: it is derived by filtering the EXEMPT table for the
    // `EXEMPT-BUT-AUTHENTICATED` marker, and `POST /api/runs` carries no such
    // marker — its EXEMPT reason reads "the coordinator opens a run — box-token
    // gated". So that route is exempt from the SESSION gate while hard-requiring
    // the box token, which is a different arrangement from the dual-credential
    // reads this set collects, and it is absent from the set rather than an
    // extra member of it. The README sentence the set feeds is where a route
    // added to the dual-credential class without a mention reds the build.
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
    // THE ROUTES THE BULLET DECLARES NOT TO BE LANES, derived rather than typed
    // (D-1231). The first version hard-coded the kickoff route as the only
    // session-only write — one line below a comment calling the hand-kept
    // cardinal the thing this file exists to delete — and wave 6 had already
    // added a second, `POST /api/coord/caps`. The consequence was not a missed
    // check but an inverted one: correcting the bullet to name both reddened
    // this scan, with a message asserting the opposite of the truth.
    // SCOPED TO THE CLAUSE THAT MAKES THE CLAIM, not to the whole bullet. The
    // bullet holds TWO lists with opposite meanings — "these call
    // `requireMailToken`" and "these carry no box token at all" — and a single
    // bag of excused names lets a route excused by the second escape a false
    // claim in the first. Measured: with one `NOT_LANE_PATHS` over the whole
    // bullet, adding a verb-less `/api/coord/caps` to the requireMailToken list
    // stayed GREEN, because caps is a legitimate member of the other list.
    //
    // The four ungated doors ARE excused inside the lanes clause: that clause
    // names them as its own exceptions ("except FOUR deliberately ungated
    // operator doors").
    const split = bullet.indexOf('What does need saying here');
    expect(split, 'the bullet\'s two clauses can no longer be told apart — the anchor moved')
      .toBeGreaterThan(0);
    const lanesClause = bullet.slice(0, split);
    const NOT_LANE_PATHS = new Set(UNGATED_DOORS);

    // EVERY BACKTICKED ROUTE THE BULLET NAMES, verb or no verb (D-1232). The
    // first version required `\`VERB /path\`` inside one span, and the bullet's
    // own house style is mixed — it names `/api/mail*` and `/api/runs*` bare, and
    // README's neighbouring paragraph names all four doors bare. Measured: a
    // route added to the requireMailToken list WITHOUT its verb was invisible to
    // the whole check, and so was one hard-wrapped mid-path (the bullet is
    // flattened first, so `\`POST /api/coord/\n  caps\`` becomes a path with a
    // space in it). Both escaped green.
    //
    // So the shape is asserted FIRST: every backticked span naming an `/api/`
    // path must be in a form this scan can read. A span it cannot parse is a
    // failure, never a skip — "I did not understand it" and "it is fine" are the
    // two conditions a scanner must never collapse.
    const spans = [...lanesClause.matchAll(/`([^`]*\/api\/[^`]*)`/g)].map((m) => m[1]!);
    expect(spans.length, 'the bullet names no routes at all — this scan is over nothing')
      .toBeGreaterThan(6);
    const ROUTE_SPAN = /^(?:(GET|POST) )?(\/api\/[A-Za-z0-9/:_-]+\*?)$/;
    const named = spans.map((span) => {
      const m = ROUTE_SPAN.exec(span);
      expect(m, `the bullet names \`${span}\`, which this scan cannot read as a route — ` +
        'a name it cannot parse is a name it cannot check (hard-wrapped mid-path?)')
        .not.toBeNull();
      return { verb: m![1] ?? null, path: m![2]! };
    });

    // The two PREFIX globs are the bullet's own shorthand for the two families,
    // not routes; they are the one span shape that is deliberately not a route.
    const lanePaths = new Set(ALL_LANES.map((k) => k.slice(k.indexOf(' ') + 1)));
    for (const { verb, path: routePath } of named) {
      if (routePath.endsWith('*')) continue;
      if (NOT_LANE_PATHS.has(routePath)) continue;
      if (verb === null) {
        expect([...lanePaths],
          `the bullet names ${routePath} among the box-token lanes and it consults no ` +
          'box token — the sentence claims more than the source does').toContain(routePath);
      } else {
        expect(ALL_LANES,
          `the bullet names ${verb} ${routePath} as a box-token lane and it consults no ` +
          'box token — the sentence claims more than the source does')
          .toContain(`${verb} ${routePath}`);
      }
    }
    // …and the routes it names as carrying NO box token really carry none, and it
    // names EVERY one of them (D-1231, the under-claim direction — the half that
    // was missing, and the half that made correcting the prose a red).
    expect(SESSION_ONLY_ALL.length, 'the session-only set collapsed — this loop proves nothing')
      .toBeGreaterThan(1);
    for (const routePath of SESSION_ONLY_ALL) {
      expect(bullet,
        `the bullet promises to name the coordination writes that carry no box token, ` +
        `and does not name ${routePath} — the class grew and the sentence did not`)
        .toContain(routePath);
      expect([...new Set(ALL_LANES.map((k) => k.slice(k.indexOf(' ') + 1)))],
        `${routePath} acquired a box-token gate — the bullet is now false`)
        .not.toContain(routePath);
    }
    // …and every door it lists as ungated really is one.
    for (const door of UNGATED_DOORS) {
      expect(bullet, `the bullet no longer names the ungated ${door}`).toContain(door);
    }
  });
});

// ── the update surface (update-management W2, design 2026-09-20 §12) ─────────
//
// `server/src/update/routes.ts` is the THIRD file that registers routes and the
// first whose routes neither harvest above can see. So the census is run over it
// by construction: which of its handlers consult the box token (exactly one, the
// projection read), which do not (the rest, and `UPDATE_DOORS` must name exactly
// them), whether a box-token call planted there would be SEEN (the control that
// makes the first two assertions mean something), and whether CLAUDE.md's bullet
// names every one of them.
describe('the update surface: one dual-credential read, every other route session-only (decision 15)', () => {
  const REGISTERED = registrationsIn(UPDATE_SRC).map((r) => r.key);

  it('update/routes.ts registers what the checks below reason over', () => {
    // Anti-vacuity: every loop below is over REGISTERED or a filter of it.
    expect(REGISTERED.length, 'the update scan collapsed — this describe is over nothing')
      .toBeGreaterThan(UPDATE_DOORS.length);
    expect(new Set(REGISTERED).size, 'a route is registered twice').toBe(REGISTERED.length);
  });

  it('exactly one handler there consults the box token — the projection read (§18 "no write route takes the box token")', () => {
    expect(UPDATE_LANES).toEqual(['GET /api/updates/intent/:nodeId']);
  });

  it('UPDATE_DOORS is exactly the rest of what the file registers, in both directions', () => {
    const rest = REGISTERED.filter((k) => !UPDATE_LANES.includes(k)).map((k) => k.slice(k.indexOf(' ') + 1));
    expect([...rest].sort(),
      'update/routes.ts and UPDATE_DOORS disagree — a route was added or removed on one side only')
      .toEqual([...UPDATE_DOORS].sort());
  });

  it('a box-token call planted in update/routes.ts is SEEN — the lane source is live, not decorative', () => {
    // The control for the two cases above: they would pass just as green over a
    // scanner that could not see this file at all.
    const anchor = "app.post('/api/updates/ack', async (req, reply) => {";
    expect(UPDATE_SRC, 'the ack registration line moved — re-point this control at it').toContain(anchor);
    for (const call of ['requireMailToken(req, reply);', 'checkMailToken(deps.mailToken ?? null, undefined);']) {
      const planted = UPDATE_SRC.replace(anchor, `${anchor}\n    ${call}`);
      expect(lanesIn(planted), `a planted ${call} went unseen`).toContain('POST /api/updates/ack');
    }
    expect(lanesIn(UPDATE_SRC)).not.toContain('POST /api/updates/ack');
  });

  it('a route registered with a non-get/post verb, or through app.route(), is SEEN by REGISTERED (F14)', () => {
    // The control for "UPDATE_DOORS is exactly the rest": before this fix,
    // `REGISTERED`'s extraction matched only `get|post`, so a route added with
    // any other verb — or via `app.route({...})` — never appeared in
    // `REGISTERED` at all, and "the rest" stayed equal to `UPDATE_DOORS`
    // whether or not the new door was named. Measured (scratch copy): both
    // plants below were invisible pre-fix, so this describe's assertions
    // stayed green over an uncensused door.
    const anchor = "app.post('/api/updates/ack', async (req, reply) => {";
    expect(UPDATE_SRC, 'the ack registration line moved — re-point this control at it').toContain(anchor);

    const plantedDelete = UPDATE_SRC.replace(anchor,
      `app.delete('/api/updates/x', async (req, reply) => { reply.code(200).send({ ok: true }); });\n\n  ${anchor}`);
    expect(registrationsIn(plantedDelete).map((r) => r.key), 'a planted app.delete went unseen')
      .toContain('DELETE /api/updates/x');

    const plantedRoute = UPDATE_SRC.replace(anchor,
      `app.route({ method: 'PUT', url: '/api/updates/y', handler: async (req, reply) => { if (req) { reply.code(200).send({ ok: true }); } } });\n\n  ${anchor}`);
    expect(registrationsIn(plantedRoute).map((r) => r.key), 'a planted app.route({ method, url }) went unseen')
      .toContain('PUT /api/updates/y');

    expect(registrationsIn(UPDATE_SRC).map((r) => r.key)).not.toContain('DELETE /api/updates/x');
    expect(registrationsIn(UPDATE_SRC).map((r) => r.key)).not.toContain('PUT /api/updates/y');
  });

  it("CLAUDE.md's box-token bullet names every update route by its backticked verb and path", () => {
    // Anchored on the backticked VERB + path, because a bare `/api/updates` is a
    // substring of every sibling and would be satisfied by any of them.
    const bullet = passage('CLAUDE.md, the box-token bullet', CLAUDE_MD,
      '- **Box token gates every coordination WRITE**', '\n- **').replace(/\s+/g, ' ');
    for (const key of REGISTERED) {
      expect(bullet, `the bullet does not name \`${key}\` — the update surface grew and the sentence did not`)
        .toContain(`\`${key}\``);
    }
  });
});

// Task 10 (account-pool-membership wave 1): the account side's freshness
// dependency, named in CLAUDE.md's Account-pools bullet per spec §8 ("named,
// not discovered") and pinned here against `_acct_pool_state`'s own body —
// copying this file's `passage()` mechanism onto a different corpus, per the
// task brief, rather than growing `pools-prose.test.ts`'s already-large
// CLAUDE.md describe block with a mechanism it did not need until now.
//
// BOTH DIRECTIONS, for the reason this file's own header gives for
// `EXEMPT_BUT_AUTHENTICATED` and `SESSION_ONLY_ALL` above: a prose pin that
// only checks presence agrees with itself while both lie. Under-claim: every
// word `_acct_pool_state` can actually answer must be named in the bullet.
// Over-claim: every pool-freshness state word the bullet names must be one
// `_acct_pool_state` can actually answer — checked against that reader's own
// REAL vocabulary, derived fresh each run, not a second hand-kept list next
// to the first.
describe("CLAUDE.md: the account-pool freshness dependency is named, not discovered (task 10)", () => {
  /** `_acct_pool_state`'s own body, comment-stripped, then every `echo`
   *  target it can reach — the same extraction `pools-prose.test.ts`'s
   *  `readerWords()` runs over `_project_pool_state`, copied here for the
   *  account-side sibling because that helper is unexported and file-local. */
  const ACCT_STATE_WORDS = (): string[] => {
    const body = passage('ccd, _acct_pool_state', CCD_SRC,
      '_acct_pool_state() {', '\n# THE RULE, spelled once in this language');
    const code = body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const words = [...new Set([...code.matchAll(/\becho\s+"?([a-z]+)/g)].map((m) => m[1]!))];
    expect(words.length, 'the account-side reader vocabulary collapsed — this derivation is over nothing')
      .toBeGreaterThan(3);
    return words;
  };

  const bullet = (): string =>
    passage('CLAUDE.md, the account-pools bullet', CLAUDE_MD,
      '- **Account pools', '\n## Coordination (Build 7) invariants').replace(/\s+/g, ' ');

  it('_acct_pool_state answers the five-word vocabulary the checks below assume (a ratchet, not a follower)', () => {
    // If ccd grows or drops a word, THIS reds first, naming the drift, rather
    // than the under/over-claim checks below silently widening or narrowing
    // what they accept.
    expect(ACCT_STATE_WORDS().sort()).toEqual(['malformed', 'named', 'stale', 'unreadable', 'untagged']);
  });

  it('names every word _acct_pool_state can emit (under-claim direction)', () => {
    const b = bullet();
    for (const w of ACCT_STATE_WORDS()) {
      expect(b, `the bullet under-claims: _acct_pool_state can answer "${w}" and the bullet never says so`)
        .toMatch(new RegExp(`\\b${w}\\b`));
    }
  });

  it('names no pool-freshness state word _acct_pool_state cannot emit (over-claim direction)', () => {
    // The candidate list is a FIXED snapshot of the known pool-freshness
    // vocabulary (today identical to `ACCT_STATE_WORDS()`'s own answer,
    // deliberately not read FROM that derivation) — so a future edit that
    // narrows what `_acct_pool_state` can answer, while the bullet keeps
    // claiming the word it lost, reds here instead of the check quietly
    // comparing a live derivation against itself.
    const CANDIDATE_STATE_WORDS = ['malformed', 'named', 'stale', 'unreadable', 'untagged'];
    const legal = new Set(ACCT_STATE_WORDS());
    const b = bullet();
    for (const w of CANDIDATE_STATE_WORDS) {
      if (new RegExp(`\\b${w}\\b`).test(b)) {
        expect(legal.has(w),
          `the bullet states pool-freshness state word "${w}", which _acct_pool_state cannot emit`)
          .toBe(true);
      }
    }
  });

  it('names the freshness dependency itself, not merely its vocabulary', () => {
    const b = bullet();
    expect(b, 'the "freshness dependency" sentence is missing — spec §8 requires it named, not discovered')
      .toMatch(/freshness dependency/);
    expect(b, 'the bullet no longer says the absent-file meanings differ between the two readers')
      .toMatch(/have not synced/);
    expect(b, 'the bullet no longer says the server does not nudge convergence')
      .toMatch(/never nudges/);
    expect(b, 'the bullet no longer names the timer that pulls the projection')
      .toContain('ccd-pool-sync.timer');
    expect(b, 'the bullet no longer names the resolved-pool document')
      .toContain('/api/pools/epoch');
  });
});
