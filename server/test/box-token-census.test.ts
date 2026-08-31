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

// A CONSTRAINT ON PROSE INSIDE THE SCANNED PASSAGES, stated because it is easy
// to trip and the failure reads like a false alarm until you know: within a
// scanned passage, ANY number word from `two` upward is read as a claim about
// this surface and must equal the derived count. That is deliberate — it is what
// makes a SECOND stale number impossible to leave behind beside a corrected one
// — but it means an unrelated number in one of these paragraphs has to be spelled
// as a word the scan does not read (`both`, `either`, `one`) or moved out of the
// passage. Measured while writing this file: a correction to `gate.ts` that said
// "in TWO directions" reddened its own scanner.

const word = (n: number): string => {
  expect(WORDS[n], `the surface outgrew the word list at ${n}`).toBeDefined();
  return WORDS[n]!;
};
const numeralsIn = (text: string): Set<string> =>
  new Set([...text.matchAll(SCAN_RE)].map((m) => m[0]!.toLowerCase()));

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
    expect(numeralsIn(p), 'README\'s auth paragraph states a count this tree does not have')
      .toEqual(new Set([word(ALL_LANES.length), word(COORD_LANES.length)]));
  });

  it('README names every gated run route, and the ungated doors AS exceptions', () => {
    const p = passage('README, the mail-bus paragraph', README,
      '`/api/mail` (and its ack route)', 'Minting the token file matters');
    for (const key of COORD_LANES.filter((k) => k.startsWith('POST /api/runs'))) {
      // The paragraph names the sub-routes in the shorthand prose actually uses
      // (`/:id/dispatch`), so the needle is the key with the shared prefix
      // stripped — and the bare `POST /api/runs` keeps its whole path.
      const needle = key.replace('POST /api/runs', '') || '/api/runs';
      expect(p, `the mail-bus paragraph omits the gated ${key}`).toContain(needle);
    }
    for (const door of UNGATED_DOORS.filter((d) => d.startsWith('/api/runs'))) {
      expect(p, `the mail-bus paragraph does not name ${door} as an exception`).toContain(door);
    }
    // …and it states no COUNT at all any more: it enumerates instead, so there
    // is no second number to go stale beside the enumeration.
    expect(numeralsIn(p), 'the mail-bus paragraph grew a hand-kept count again').toEqual(new Set());
  });

  it('auth/gate.ts states the derived lane counts wherever it states one', () => {
    for (const [name, from, to] of [
      ['gate.ts, EXEMPT reason 2', '  2. The ', '  3. `POST /api/auth/login`'],
      ['gate.ts, the CSRF/origin note', ' * EXEMPT ROUTES ARE SKIPPED', 'their real guard is'],
    ] as const) {
      const p = passage(name, GATE_SRC, from, to);
      expect(numeralsIn(p), `${name} states a count this tree does not have`)
        .toEqual(new Set([word(ALL_LANES.length), word(COORD_LANES.length)]));
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
      .toEqual(new Set([word(ALL_LANES.length), word(COORD_LANES.length)]));
  });

  it("CLAUDE.md's box-token bullet is TRUE, not merely present", () => {
    // THE PIN D-1156 ASKED FOR. Wave 5 corrected this bullet and measured that
    // nothing held it — the false sentence went back in and the suite stayed
    // green. Each claim is now checked against the source it describes.
    const bullet = passage('CLAUDE.md, the box-token bullet', CLAUDE_MD,
      '- **Box token gates every coordination WRITE**', '\n- **');
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
      expect(bullet,
        `the bullet promises to name every requireMailToken lane outside the two prefixes, ` +
        `and does not name ${key} — the surface grew and the sentence did not`).toContain(key);
      expect(COORD_LANES, `${key} is named as a box-token lane and is not one`).toContain(key);
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
