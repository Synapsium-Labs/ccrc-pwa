// Prose that must stay TRUE about account pools: README's placement and pools
// sections, CLAUDE.md's invariant bullet, and the non-README sentences the
// design measured as false (D-1685, D-1686, D-1687, D-1688/D-2827).
//
// The shape is `readme-holds.test.ts`'s, for its reason as much as its form:
// slice the passage by its OWN markers and check it against the SOURCE it
// describes, never against a fixed sentence a future edit could silently
// falsify. Four times before this file existed, prose in this tree overclaimed
// and no assertion held it.
//
// Terminators are DISTINCTIVE literals, never `'\n### '` or `'\n- **'` —
// `ledger-instruction.test.ts`'s D-1443 lesson: `indexOf` stops at the FIRST
// closing anchor after the opener, so a generic terminator is matched by any new
// heading or bullet written INSIDE the region; the passage silently truncates,
// the length check is a lower bound a truncated passage still clears, and every
// negative assertion then passes over text that was cut away.
//
// HISTORY, BECAUSE IT DECIDES THE SHAPE BELOW. The rounds are numbered off the
// commits, not off memory: `git log --oneline -- server/test/pools-prose.test.ts`.
//
// The file as fix round 1 FOUND it (created at faf0f8f7, last touched before the
// round at 26413403, 25 tests) pinned claims as free-floating substrings —
// `toMatch(/never places/)` at two sites with no subject bound to either. A full
// inversion of BOTH documents stayed 25/25 green.
//
// FIX ROUND 1 (7bac1727) answered with guards that PARSED THE ENGLISH: a subject
// bound to a closed verb list, a negator required between the two, a fold
// vocabulary. FIX ROUND 2 (43b7e931) widened them and added a fourth, the
// override vocabulary.
//
// They caught the literal inversions the reviewers ran — not every inversion:
// one-word inversions survived them by falling outside a vocabulary (`FOLD` had
// no "folds into", so flipping CLAUDE.md's only fold sentence was green 27/27),
// and a true negator anywhere in a two-clause sentence licensed a false second
// clause. What they DID do reliably was red seven TRUE sentences, among them
// "the server decides nothing.", the shortest true statement of this feature's
// central claim, each with a message telling its author the truth was the defect.
//
// FIX ROUND 3 (this file) deleted all of them. A guard that calls a true sentence
// false misinforms with the repo's authority, which is worse than a claim nobody
// holds — and the oscillation between the two failures is not a tuning problem.
// It is what happens when a regex is asked to decide whether a sentence is true.
//
// WHAT THIS FILE HOLDS, AND WHAT IT DOES NOT — read this before trusting a green.
//
// THREE kinds of assertion live here and they prove different things.
//
//   1. DERIVED. Read a value out of the SOURCE, then check the prose against it:
//      `ACCOUNT_KEYS`, the symbols `generate.mjs` emits, the two cooldown
//      constants, the codes `refusePool` sends, the README line count. Move the
//      number or name in the code and the prose goes red on the thing that
//      moved. These hold a CLAIM. Three more assert over the SOURCE alone, with
//      no prose on the other side: the write-call scan across `server/src` and
//      `agent/src` and the uninstall surface are negatives, and the single
//      `cross-pool` writer in `swap.log` is an exact count (`toBe(1)`) — a
//      second writer reds it. `readerWords` is a RATCHET, not a follower: it
//      EXTRACTS the reader's four words and compares them to a literal here, so
//      renaming a word in ccd AND in the prose together still reds and asks a
//      human. Each states its own reach in its own docstring; read that list,
//      not this one.
//
//   2. QUOTED, via `unchanged()`. The canonical sentence, asserted to be still
//      present word for word. These hold that the sentence has not silently
//      CHANGED. They cannot tell whether whatever replaced it is true: a rewrite
//      that is false reds exactly as loudly as a rewrite that is better, so that
//      red is a REQUEST to go and read the source, never a verdict on the new
//      wording.
//
//   3. FORBIDDEN SPELLINGS. FIVE phrases across seven sites, each a `not.toMatch`
//      over one exact spelling, recording a decision the prose must not walk
//      back: `bypasses the gate entirely` (both sections), `$REG/<project>.`
//      inside the rule sentence (twice), `pools` anywhere in the uninstall
//      surface, `ships the same accounts.json to both boxes`, and one that runs
//      only on the other arm — `NOTHING scans for|no pool class`, once
//      `topology-clean` grows a pool class. THESE CAN STILL RED ON A TRUE
//      SENTENCE: one that quotes the forbidden phrase in order to DENY it
//      ("never at `$REG/<project>.pool`") reds, measured. The exposure is narrow
//      and the remedy is cheap — say it another way, or change the guard in the
//      same commit. It is named here rather than fixed because a phrase nobody
//      may write is the one thing a literal CAN hold, and the message stays
//      inside what it measured: it reports that the string is present, which it
//      is, and why the string is forbidden, which is true whatever the sentence
//      around it says. Losing them would leave the rejected homes unguarded.
//
// THE SEMANTIC CLAIMS IN THESE PASSAGES ARE NOT MECHANICALLY HELD. Whether "the
// server never writes the marker" is true of this tree is settled by reading
// `ccd` and `server/src`, not by running this file. A claim is mechanically
// holdable only where the prose names something the CODE also names — a
// constant, a count, a state list, a path, a number. Everything that is neither
// derived nor a forbidden spelling is QUOTED, and is quoted precisely so that
// changing it cannot be quiet.
//
// So: a green here is evidence about EDITS, never proof about TRUTH. When one of
// these sentences changes, read the source it describes — do not let the suite
// read it for you.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The path to the ccd script is spelled in exactly ONE file in this tree and
// `single-definition.test.ts` enforces it — import the constant, never re-spell
// it here (`readme-holds.test.ts` records the same rule).
import { CCD } from './ccdWsHelpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');
const readme = (): string => read('README.md');
const ccd = (): string => readFileSync(CCD, 'utf8');

/** A passage sliced by its own markers. Both anchors must exist and the slice
 *  must be long enough to BE the passage: an anchor that stopped matching would
 *  otherwise yield '' and satisfy every negative assertion below it. */
const passage = (name: string, text: string, from: string, to: string, min = 200): string => {
  const a = text.indexOf(from);
  expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a + from.length);
  expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
  const out = text.slice(a, b);
  expect(out.length, `${name} is too short to be the passage`).toBeGreaterThan(min);
  return out;
};

/** Whitespace-flattened. EVERY multi-word assertion in this file runs over a
 *  flattened passage, because README and CLAUDE.md are hard-wrapped prose: the
 *  phrase a check looks for routinely spans a line break, and a raw
 *  `toContain`/`toMatch` would then miss it. On a NEGATIVE assertion that is a
 *  false GREEN — the exact failure mode that gets a scanner deleted — and on a
 *  positive one it is a red for the wrong reason. Line-anchored checks (the
 *  numbered rollout steps, the bullet's line count) use the raw slice. */
const flat = (text: string): string => text.replace(/\s+/g, ' ');

/** Sentence-split, not whole-section matching: an absolute word used correctly
 *  three paragraphs away must not trip a check aimed at one claim. Splits on
 *  `.`/`:` followed by whitespace — coarse, but it keeps each claim in its own
 *  window (`readme-holds.test.ts`'s helper, copied). Always fed a FLATTENED
 *  passage, so a sentence is one line by the time it is matched. */
const sentencesOf = (text: string): string[] => text.split(/(?<=[.:])\s+/);

/** A LITERAL PIN — a CHANGE-detector, not a TRUTH-detector.
 *
 *  Round 2 asked regexes to decide whether a sentence was true and they reddened
 *  seven true ones. This asserts only that the canonical sentence is still there,
 *  word for word, and its message says exactly that much. `source` names the file
 *  a human has to read to re-decide the claim when the sentence has moved on.
 *  Always fed a FLATTENED passage, so a hard-wrapped sentence is one line by the
 *  time it is matched. */
const unchanged = (where: string, text: string, literal: string, source: string): void => {
  expect(text,
    `${where}: this sentence is no longer present as written. It is pinned as a LITERAL, so this `
    + 'red says the sentence CHANGED — it does NOT say the new wording is wrong, and it cannot: '
    + `nothing here reads English. Re-verify the claim against ${source}, then update this literal `
    + `in the same commit. Expected: "${literal}"`)
    .toContain(literal);
};

const placementSection = (): string =>
  // Terminated at the pools section, not at `### Login screens`: the pools
  // section sits BETWEEN the two, so the old terminator made this passage a
  // superset of `poolsSection()` and reds planted in the pools section were
  // reported against the disabled-marker section 180 lines away.
  passage('README, the disabled-marker section', readme(),
    '### Placement honors the disabled marker', '\n### Account pools: tagging a project');

const poolsSection = (): string =>
  passage('README, the account-pools section', readme(),
    '### Account pools: tagging a project to a set of accounts',
    '\n### Login screens get no keystrokes');

/** Every .ts under a root, recursively — the shape `single-definition.test.ts`
 *  uses to scan a whole surface rather than one module. */
const tsFilesUnder = (rel: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`);
      else if (e.name.endsWith('.ts')) out.push(`${dir}/${e.name}`);
    }
  };
  walk(rel);
  return out;
};

/** TS source with its comments removed, so a scan below measures CODE. Round 2
 *  measured the cost of skipping this: a comment reading "Unrelated to
 *  ~/.cc-sessions/pools/, which this process never touches", placed beside an
 *  unrelated `mkdirSync`, reddened three tests with a message asserting the
 *  server writes the marker — a guard naming a cause its own evidence denies. */
const codeOf = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** THE NEVER-WRITES CLAIM, GROUNDED OVER BOTH PROCESSES THAT COULD BREAK IT.
 *
 *  Round 1 scanned `server/src/pools.ts` alone — a READER module — so a write in
 *  `server.ts` was green. Round 2 found two more holes in the widened version and
 *  both are closed here:
 *    - the 200-char window matched a NEIGHBOURHOOD, so a comment or an
 *      identifier like `poolsWire` counted as a write. It now has to be a PATH:
 *      the shipped `POOLS_DIR_NAME` constant, or `pools` inside a string or
 *      template literal. That also CLOSES the natural spelling the old scan
 *      missed — `path.join(registryDir, POOLS_DIR_NAME, project)`.
 *    - README says "the agent's write root is unchanged" in the same breath, and
 *      nothing read `agent/src`. The agent is the process that actually holds a
 *      write root on the fleet box, so it is the half a coder would break first.
 *
 *  WHAT IT STILL CANNOT SEE, kept here because the header used to carry it and
 *  a limit that loses its home stops being measured: the window runs FORWARD
 *  200 characters from the write call, so it cannot follow a variable. The
 *  inline spelling `writeFileSync(path.join(reg, POOLS_DIR_NAME, p), x)` is
 *  caught; the same write split over two lines — the path built first, or
 *  passed in as an argument — is not. */
const POOL_WRITE_ROOTS = ['server/src', 'agent/src'] as const;
const poolWritesInSource = (): string[] => {
  const hits: string[] = [];
  for (const rootRel of POOL_WRITE_ROOTS) {
    for (const rel of tsFilesUnder(rootRel)) {
      const text = codeOf(read(rel));
      for (const m of text.matchAll(
        /\b(writeFileSync|writeFile|appendFileSync|appendFile|unlinkSync|rmSync|renameSync|mkdirSync)\b/g)) {
        const window = text.slice(m.index!, m.index! + 200);
        if (/POOLS_DIR_NAME|['"`][^'"`]*pools[^'"`]*['"`]/i.test(window)) {
          hits.push(`${rel}: ${m[1]!} … ${window.split('\n')[0]!.trim()}`);
        }
      }
    }
  }
  return hits;
};

/** Bash with its comments removed. A `#` opens a comment only when it is
 *  unquoted AND at the start of a line or preceded by whitespace, so `${v#pat}`
 *  and `"a # b"` survive. Round 3 measured why the line-leading strip it
 *  replaces was not enough: `local reg="$HOME/.cc-sessions"   # never touches
 *  pools/` is the trailing style the region already uses, and it reddened the
 *  uninstall scan with a message saying uninstall names pools/. What this still
 *  cannot see is a heredoc body or a `$'...'` string; neither appears in the
 *  scanned region, and a future one would have to be argued here. */
const bashCode = (text: string): string => text.split('\n').map((line) => {
  let sq = false;
  let dq = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    if (c === '\\' && dq) { i += 1; continue; }
    if (c === "'" && !dq) sq = !sq;
    else if (c === '"' && !sq) dq = !dq;
    else if (c === '#' && !sq && !dq && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i);
  }
  return line;
}).join('\n');

/** THE UNINSTALL SURFACE: `cmd_uninstall` PLUS every `_uninst_*` helper it
 *  delegates to, the helper names DERIVED from the body rather than listed.
 *
 *  Round 1 narrowed a whole-file negative over an ~11,900-line CLI down to
 *  `cmd_uninstall`'s own body — and round 2 measured that this traded a false
 *  RED for a structural false GREEN: that body is PURE DELEGATION, eight calls
 *  and no removal code at all, so the claim it grounds could never be falsified
 *  inside it. Every registry removal lives in `_uninst_cc_sessions`, defined
 *  outside the old slice.
 *
 *  The terminator is `case "$VERB" in`, the file's single dispatch opener and a
 *  DISTINCTIVE literal — not the `'\n}'` the first fix used, which is exactly
 *  the generic terminator this file's own header forbids: one column-0 brace
 *  inside an embedded awk or node program (this file has several) truncates the
 *  slice, and every negative below it then passes over text that was cut away.
 *  `cmd_uninstall` is the last `cmd_` in the file, so opener → dispatch covers
 *  the verb and all eight helpers and excludes the verb table itself.
 *
 *  Bash comments are dropped first, through `bashCode`, the way `codeOf` drops
 *  the TypeScript ones: round 3 measured a comment DOCUMENTING this very claim
 *  ("uninstall never names `pools/`") reddening the assertion with a message
 *  saying uninstall names pools/, both line-leading and trailing. The scan is
 *  about CODE — a comment cannot delete a directory. */
const uninstallSurface = (): string => {
  const ccrc = read('ccd/ccrc');
  const raw = passage('ccrc, the uninstall surface', ccrc,
    'cmd_uninstall() {', '\ncase "$VERB" in', 1000);
  const region = bashCode(raw);
  const called = [...new Set([...region.matchAll(/\b_uninst_[a-z_]+\b/g)].map((m) => m[0]))];
  expect(called.length, 'cmd_uninstall no longer delegates — re-decide what this scan covers')
    .toBeGreaterThanOrEqual(5);
  // The scope is only honest if every helper the verb calls is DEFINED in the
  // region being scanned. If one moves out, this says so instead of going quiet.
  for (const h of called) {
    expect(region, `${h} is called by cmd_uninstall but defined outside the scanned region`)
      .toContain(`${h}() {`);
  }
  return region;
};

/** Every symbol the generator actually writes into `accounts.sh`, read off its
 *  own template rather than listed here — the same derivation discipline the
 *  roster itself is under (`single-definition.test.ts`). */
const emittedNames = (): string[] => {
  const gen = read('shared/generate.mjs');
  const names = [
    ...[...gen.matchAll(/^(CCRC_[A-Z_]+)=/gm)].map((m) => m[1]!),
    ...[...gen.matchAll(/^(_ccrc_[a-z_]+)\(\) \{/gm)].map((m) => m[1]!),
  ];
  expect(names.length, 'the accounts.sh template moved — this derivation is over nothing')
    .toBeGreaterThan(6);
  return names;
};

/** The four words `_project_pool_state` answers, EXTRACTED from its own body and
 *  then RATCHETED against a literal — and the docstring says both halves on
 *  purpose, because round 2 caught the earlier one claiming more than the code
 *  does. The extraction is what the prose is checked against; the literal is a
 *  tripwire, so renaming a token in ccd AND in README together still reds and
 *  asks a human to re-decide. It does NOT silently follow the source. Comment
 *  lines are dropped first: one contains `echo pool-a > pools/demo` as an
 *  example, and an extraction that swallowed it would be over the wrong set. */
const readerWords = (): string[] => {
  const body = passage('ccd, _project_pool_state', ccd(),
    '_project_pool_state() {', '\n# An account is a legal AUTOMATIC destination', 400);
  const code = body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const words = [...new Set([...code.matchAll(/\becho\s+"?([a-z]+)/g)].map((m) => m[1]!))];
  expect(words.sort(),
    'the four-word reader changed its vocabulary. This literal is a RATCHET, not a follower: ' +
    're-decide the prose that quotes it, then update this list in the same commit')
    .toEqual(['malformed', 'named', 'unreadable', 'untagged']);
  return words;
};

/** The two refusal codes, read off the route that sends them. They were three
 *  bare literals in the prose and three bare literals here, so a route that
 *  moved 409 → 422 would leave README false and this suite green. */
const refusalCodes = (): { mismatch: string; unreadable: string } => {
  const p = passage('server.ts, refusePool', read('server/src/server.ts'),
    'const refusePool = (', '\n  const runCcdOr502', 150);
  const m = /'pool-mismatch'\s*\?\s*reply\.code\((\d+)\)/.exec(p);
  const u = /reply\.code\((\d+)\)\.send\(\{ ok: false, error: 'pool-unreadable'/.exec(p);
  expect(m, 'refusePool no longer answers pool-mismatch with a literal code').not.toBeNull();
  expect(u, 'refusePool no longer answers pool-unreadable with a literal code').not.toBeNull();
  return { mismatch: m![1]!, unreadable: u![1]! };
};

/** The four groundings both the README describe and the CLAUDE.md describe make.
 *  They were written out twice, verbatim — and `single-definition.test.ts`
 *  cannot see the duplication, because `server/test` is deliberately not one of
 *  its four ROOTS, so nothing would ever have flagged a third copy. */
const groundedInShippedMechanism = (): void => {
  expect(ccd(), 'ccd relocated its pools directory — the prose names a path that is gone')
    .toMatch(/POOLS_DIR="\$REG\/pools"/);
  expect(ccd(), 'the four-word reader is gone').toMatch(/_project_pool_state\(\)/);
  expect(read('server/src/pools.ts'), 'the server no longer spells the directory once')
    .toMatch(/POOLS_DIR_NAME = 'pools'/);
  expect(poolWritesInSource(),
    'a write whose path names the pools directory appeared in server/src or agent/src — the prose ' +
    'says the server never writes the marker and the agent\'s write root is unchanged')
    .toEqual([]);
};

describe('README: manual placement is not a blanket override (spec §11 row 52)', () => {
  it('no longer says the manual verbs bypass the gate entirely', () => {
    // Over BOTH sections. Narrowing `placementSection()` to fix its attribution
    // (M-3) also narrowed this literal's reach: the sentence planted in the
    // pools section was red before that change and green after it.
    expect(flat(placementSection())).not.toMatch(/bypasses the gate entirely/);
    expect(flat(poolsSection())).not.toMatch(/bypasses the gate entirely/);
  });

  it('quotes the sentence that qualifies the override', () => {
    // This was `noUnqualifiedOverride`, a per-sentence scan for an overriding
    // word beside a manual verb that demanded `--cross-pool` in the same
    // sentence. Round 3 measured what that costs: "`ccd swap` never overrides
    // the pool rule." — true, and the plainest statement of the rule — reddened,
    // with a message telling its author to name what it does not override.
    // Same shape as the four the ruling deleted, so it goes the same way.
    unchanged('README, the disabled-marker section', flat(placementSection()),
      'Manual placement (`ccd start`, `ccd swap`, `ccd prefer`) overrides the **disabled** gate — '
      + 'naming a wrapper by hand is an operator override by construction — but it is not a blanket '
      + 'override of every placement rule, because all three verbs refuse a target whose pool '
      + 'disagrees with the project\'s unless you pass `--cross-pool`',
      'ccd/ccd — `cmd_start`, `cmd_swap` and `cmd_prefer` all take `--cross-pool`');
  });

  it('names the flag a crossing actually takes, and ccd actually has it', () => {
    expect(flat(placementSection())).toMatch(/--cross-pool/);
    // Grounded in the shipped script, not merely asserted in prose: the flag
    // exists and the refusal it overrides has its own die prefix.
    expect(ccd(), 'ccd has no --cross-pool flag — the README now describes a flag that is gone')
      .toMatch(/--cross-pool/);
    expect(ccd(), 'ccd no longer refuses a pool mismatch — re-decide this paragraph')
      .toMatch(/pool-mismatch: /);
  });
});

describe('README: the roster-side account facts (D-1686, D-2828)', () => {
  const entrySentence = (): string =>
    flat(passage('README, the account-entry sentence', readme(),
      'An account entry is', '**Getting the file onto a box.**'));
  const projectionParagraph = (): string =>
    flat(passage('README, the projection paragraph', readme(),
      '`accounts.sh` is a pure projection', 'Nothing hand-edits it'));

  it('names EXACTLY the keys parseRoster accepts — derived from ACCOUNT_KEYS, not remembered', () => {
    const m = /const ACCOUNT_KEYS: ReadonlySet<string> = new Set\(\s*\[([^\]]*)\]/
      .exec(read('shared/roster.ts'));
    expect(m, 'the ACCOUNT_KEYS literal moved — this derivation is over nothing').not.toBeNull();
    const keys = [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
    expect(keys.length, 'the ACCOUNT_KEYS literal came out empty').toBeGreaterThan(5);
    // The brace group, not the paragraph: `toContain('id')` would be satisfied
    // by the word "considered", so a per-word scan here proves almost nothing.
    const g = /An account entry is `\{([^}]*)\}`/.exec(entrySentence());
    expect(g, "the account-entry sentence no longer opens with a `{…}` key list").not.toBeNull();
    const listed = g![1]!.split(/,\s*/).map((k) => k.trim()).filter(Boolean);
    expect([...listed].sort(),
      'the README key list and ACCOUNT_KEYS disagree — one of them grew and the other did not')
      .toEqual([...keys].sort());
  });

  it('names EXACTLY the symbols the generator emits — set equality, both directions', () => {
    // Was one-way (README ⊇ emitted), so deleting an emission left README
    // naming a symbol nothing emits, green. The paragraph's own claim is
    // "the whole emitted surface", which is an equality.
    const listed = [...projectionParagraph().matchAll(/`(CCRC_[A-Z_]+|_ccrc_[a-z_]+)`/g)]
      .map((m) => m[1]!);
    expect([...new Set(listed)].sort(),
      'the projection paragraph and the generator disagree — it claims "the whole emitted surface", '
      + 'so a symbol on either side alone is a false claim')
      .toEqual([...new Set(emittedNames())].sort());
  });

  it('states which side of the roster digest each optional key falls on', () => {
    const p = flat(passage('README, the two-boxes bullet', readme(),
      'It compares the **projections**', '- **Limit telemetry is roster-driven too**'));
    expect(p, 'the digest paragraph does not say where `pool` falls').toMatch(/`pool`/);
    expect(p, 'the digest paragraph does not say where `hidden` falls').toMatch(/`hidden`/);
    // Grounded, both ways round: the generator emits pools and emits nothing
    // named for `hidden` — which is the entire content of the claim.
    expect(emittedNames().filter((n) => /pool/i.test(n)),
      'accounts.sh carries no pool emission — the README claim that pools are inside the digest is false')
      .not.toEqual([]);
    expect(emittedNames().filter((n) => /hidden/i.test(n)),
      'accounts.sh now carries hidden — the README claim that it is outside the digest is false')
      .toEqual([]);
  });
});

describe('README: where the project tag lives (spec §4, §5.4.1)', () => {
  const stateParagraph = (): string =>
    flat(passage('README, the four-word state paragraph', readme(),
      'The file holds one token', '**Why the tag lives there.**'));

  it('states the rule and that untagged means unconstrained', () => {
    const s = flat(poolsSection());
    expect(s, 'the section never states the rule itself').toMatch(/either side is untagged or/i);
    expect(s, 'ruling 3 is the one thing every operator must read here').toMatch(/unconstrained/);
    expect(s).toMatch(/tagging only ever tightens/i);
  });

  it('pins the marker path in the SENTENCE that states the rule, not just somewhere', () => {
    // Was a section-wide `toContain`, which the bash fence satisfied on its own:
    // the rule sentence could be rewritten to `$REG/<project>.pool` — the home
    // this section REJECTS, and the namespace footgun CLAUDE.md calls
    // non-negotiable — and the suite stayed green.
    const s = flat(poolsSection());
    const all = sentencesOf(s);
    const at = all.findIndex((x) => /a project is tagged by/.test(x));
    expect(at, 'the rule sentence ("a project is tagged by …") is gone').toBeGreaterThan(-1);
    // The WINDOW is the rule sentence plus the one after it. Round 2 measured the
    // false red this closes: splitting the rule across two true sentences — "…a
    // one-token file on the fleet host. That file is `~/.cc-sessions/pools/…`." —
    // reddened, with a message about a wrong home in text that named no home.
    const window = all.slice(at, at + 2).join(' ');
    // And the two failures are told apart, because they send an editor to
    // different places: naming the REJECTED home is a defect, naming none is a
    // reflow that moved the path more than one sentence away.
    expect(window,
      'the rule names the REJECTED home. The tag lives at ~/.cc-sessions/pools/<project>; '
      + '$REG/<project>.<x> collides with session `<wrapper>-<project>`')
      .not.toMatch(/\$REG\/<project>\./);
    expect(window,
      'the rule sentence and the one after it name no home at all — say where the tag lives '
      + 'within one sentence of stating the rule (~/.cc-sessions/pools/<project>)')
      .toContain('~/.cc-sessions/pools/<project>');
    for (const sentence of sentencesOf(s)) {
      if (/\btagged by\b|\bthe tag lives\b/.test(sentence)) {
        expect(sentence,
          'the tag is described as living at $REG/<project>.<x> — the home this section rejects, '
          + `because session ids ARE <wrapper>-<project>. Sentence: "${sentence.trim()}"`)
          .not.toMatch(/\$REG\/<project>\./);
      }
    }
    expect(s).toContain('ccd project-pool');
    groundedInShippedMechanism();
  });

  it('names all four reader words, derived from the reader, in the paragraph that states them', () => {
    // Three defects in the old version: three hardcoded words for a four-word
    // reader; presence checked over the WHOLE section, so `unreadable` three
    // paragraphs away in the rejected-homes argument satisfied it; and the only
    // grounding was that the function EXISTS, never what it returns.
    const p = stateParagraph();
    for (const w of readerWords()) {
      expect(p, `the state paragraph never names the reader's \`${w}\` answer`).toContain(w);
    }
    // The no-overloaded-null half of the paragraph is QUOTED, not parsed: round 2
    // tried to hold it with a fold vocabulary and reddened "A malformed tag reads
    // as `malformed`, never as untagged." The mechanical half is above — the four
    // words come off the reader itself.
    unchanged('README, the state paragraph', p,
      '**neither is ever quietly downgraded to untagged**',
      'ccd/ccd, `_project_pool_state` — what it echoes on an undecidable tag');
  });

  it('quotes the authority split, and grounds it in the source that decides placement', () => {
    // The load-bearing claim of the whole feature, and the one a coder reads
    // before deciding where to put a write. It is QUOTED. Round 2 bound the
    // subject to a closed verb list instead and reddened "the server decides
    // nothing." — the shortest true statement of this very sentence.
    const s = flat(poolsSection());
    unchanged('README, the account-pools section', s,
      '**`ccd` decides; the server refuses and forecasts.**',
      'ccd/ccd (every placement site) and server/src/server.ts (`refusePool`)');
    unchanged('README, the account-pools section', s,
      'It never places a session and it never writes the marker itself',
      'ccd/ccd (every placement site) and server/src/server.ts (`refusePool`)');
    // And the half that IS mechanical: no write in `server/src` or `agent/src`
    // names the pools directory. That one is not a quote — it reads the code.
    groundedInShippedMechanism();
  });

  it('says the tag outlives every workspace and survives an uninstall', () => {
    const s = flat(poolsSection());
    for (const verb of ['ws-rm', 'ws-reap', 'ws-gc', 'forget']) {
      expect(s, `the section does not name \`${verb}\` among the verbs that leave the tag alone`)
        .toContain(verb);
    }
    expect(s).toContain('ccrc uninstall');
    expect(s, 'the section does not say the tag is outside the backup set').toMatch(/not backed up/i);
    // Grounded in the VERB the claim is about. Was a whole-file negative over an
    // ~11,800-line multi-verb CLI, so a comment above `cmd_doctor` naming
    // `pools/` reddened it with a message blaming the uninstaller — and README
    // rollout step 3 promises a doctor `pools` check, so that collision is
    // scheduled rather than hypothetical.
    expect(uninstallSurface(),
      'ccrc uninstall now names pools/ — the README claim that it leaves the tag standing is false')
      .not.toMatch(/pools/);
  });
});

describe('README: what a retag does, and when (spec §5.5.4, §5.8, §5.7, §5.11, §15)', () => {
  /** Both gate figures, read off ccd rather than remembered — the bash-floor
   *  idiom in `ccrc-update.test.ts`: a bumped constant must move the prose. */
  const cooldowns = (): { swap: string; block: string } => {
    const s = /^SWAP_COOLDOWN=(\d+)/m.exec(ccd());
    const b = /^SWAPBLOCK_COOLDOWN=(\d+)/m.exec(ccd());
    expect(s, 'ccd no longer spells SWAP_COOLDOWN — this derivation is over nothing').not.toBeNull();
    expect(b, 'ccd no longer spells SWAPBLOCK_COOLDOWN — this derivation is over nothing').not.toBeNull();
    return { swap: s![1]!, block: b![1]! };
  };

  it('states the two gates a retag waits on, with the numbers ccd actually enforces', () => {
    const s = flat(poolsSection());
    const { swap, block } = cooldowns();
    // Each figure must sit BESIDE ITS OWN NAME. A bare `toContain(swap)` let
    // SWAP_COOLDOWN move 900 → 1800 and stay green, because 1800 was already in
    // the prose as SWAPBLOCK's figure — the two checks covered for each other.
    expect(s, `the prose does not state ${swap} s beside \`SWAP_COOLDOWN\` — ccd now enforces ${swap}`)
      .toMatch(new RegExp('`SWAP_COOLDOWN`,?\\s*' + swap + '\\s*s\\b'));
    expect(s, `the prose does not state ${block} s beside \`SWAPBLOCK_COOLDOWN\` — ccd now enforces ${block}`)
      .toMatch(new RegExp('`SWAPBLOCK_COOLDOWN`,?\\s*' + block + '\\s*s\\b'));
    // The three exceptions to "it waits", each named.
    expect(s, 'hard-blocked sessions do not wait; the paragraph must say so').toMatch(/hard-blocked/);
    expect(s, 'a hold defers a retag; the paragraph must say so').toMatch(/held|hold/);
    expect(s, 'the visible waiting state is the one an operator can act on').toContain('data-offpool');
    // Grounded in the PWA cell that renders it.
    expect(read('pwa/src/fleet/SessionLine.tsx'),
      'the PWA no longer marks an off-pool row — the README describes a cell that is gone')
      .toContain('data-offpool');
  });

  it('describes the strand with the vocabulary ccd actually writes, and three remedies', () => {
    const s = flat(poolsSection());
    expect(s).toContain('cc swap STRANDED');
    expect(s).toContain('stranded');
    expect(s).toContain('unstranded');
    // The three remedies of ruling 6, each identifiable.
    expect(s, 'remedy 1 (enable a lane) is missing').toMatch(/-disabled/);
    expect(s, 'remedy 2 (tag another account into the pool) is missing')
      .toMatch(/tag another account/i);
    expect(s, 'remedy 3 (untag the project) is missing').toMatch(/--clear|untag the project/);
    // Grounded: the marker, the clear and the banner text all exist.
    expect(ccd()).toMatch(/_strand_mark/);
    expect(ccd()).toMatch(/_strand_clear/);
    expect(ccd(), 'the notify banner text changed — the README quotes a sentence nobody sends')
      .toContain('cc swap STRANDED: ');
  });

  it('keeps --cross-pool and --force distinct, and states which one sticks', () => {
    const s = flat(poolsSection());
    expect(s).toContain('--cross-pool');
    expect(s).toContain('--force');
    // QUOTED, both halves. Round 2's override vocabulary reddened "`--force`
    // overrides the prompt, never the pool rule." with a message quoting a span
    // that contained the word "never" while asserting nothing negated it.
    unchanged('README, the account-pools section', s,
      '**Crossing on purpose: `--cross-pool`, which is not `--force`.**',
      'ccd/ccd — `--force` and `--cross-pool` are separate flags that compose');
    unchanged('README, the account-pools section', s,
      '`--force` means one thing and still means only that — accept the transcript loss a swap costs.',
      'ccd/ccd — `--force` and `--cross-pool` are separate flags that compose');
    expect(s, 'the swap/prefer split (spec §14 O1) is the thing operators get wrong')
      .toMatch(/prefer --cross-pool/);
    expect(s, 'automatic moves never cross — the sentence that keeps ruling 8 honest')
      .toMatch(/never cross/i);
    // Grounded: the marker and its end-of-life log verb.
    expect(ccd()).toMatch(/crosspool/);
    expect(ccd(), 'the crossing no longer ends with a logged reason').toMatch(/crosspool-ended/);
    // WHICH VERB WRITES THE LOG LINE. This seam has minted a falsehood twice —
    // first "every crossing writes a `cross-pool` line" (true of one verb of
    // four), then a repair whose "while" put the journal act on prefer's side
    // when swap writes one too. Two pins, and they do different jobs.
    //
    // DERIVED: exactly one place in ccd writes that line. If a second appears,
    // the partition below is stale no matter how it is worded.
    const logWriters = [...ccd().matchAll(/^\s*echo .*cross-pool \$id.*swap\.log/gm)];
    expect(logWriters.length,
      'ccd no longer has exactly one `cross-pool` swap.log writer — re-decide which verbs the '
      + 'README says write that line')
      .toBe(1);
    // QUOTED: the partition itself, which no regex can check. Round 2's
    // clause-scoped negative reddened the true sentence "`prefer --cross-pool`
    // writes the journal act and no `swap.log` line" — the exact claim it existed
    // to protect.
    unchanged('README, the account-pools section', s,
      '`swap --cross-pool` writes BOTH a `cross-pool` line in `swap.log` and a `dec.crosspool` act '
      + 'in the lifecycle journal; `prefer --cross-pool` writes the journal act and no log line; '
      + '`start --cross-pool` writes the marker alone.',
      'ccd/ccd — `cmd_swap`, `cmd_prefer` and `cmd_start`');
  });

  it('names the skew states an operator can see, and the six rollout steps', () => {
    const s = flat(poolsSection());
    // The two refusal codes are DERIVED from the route that sends them; 501 and
    // 502 stay literals because they are ccd-cap and ccd-failure answers this
    // section attributes to no single line.
    const { mismatch, unreadable } = refusalCodes();
    // BESIDE ITS OWN NAME, for the reason the cooldowns two describes up carry
    // the same rule: a bare `toContain` let the two codes cover for each other,
    // so moving the mismatch arm 409 -> 503 stayed green on the 503 already in
    // the prose while README went on calling a mismatch 409.
    expect(s, `the prose does not say ${mismatch} beside \`pool-mismatch\` — that is what refusePool answers`)
      .toMatch(new RegExp(mismatch + '[^.]{0,20}pool-mismatch'));
    expect(s, `the prose does not say ${unreadable} beside the unreadable-tag case — that is what refusePool answers`)
      .toMatch(new RegExp(unreadable + '[^.]{0,40}(tag cannot be read|unreadable)'));
    for (const code of ['501', '502']) {
      expect(s, `the skew table never mentions ${code}`).toContain(code);
    }
    expect(s, 'the transient the two lanes produce is the one that gets reported as a fault')
      .toContain('divergent');
    expect(s, 'the agent lane goes first — the ordering rule this whole feature rides on')
      .toMatch(/deploy\.sh agent/);
    // Six steps, numbered — over the RAW slice, because this one is anchored to
    // the start of a line and flattening would destroy the anchor.
    const raw = poolsSection();
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(raw, `rollout step ${n} is missing`).toMatch(new RegExp(`^${n}\\. `, 'm'));
    }
  });
});

describe('server/src/config.ts: the roster is SEEDED once per box (D-1687)', () => {
  /** The docstring, flattened out of its ` * ` prefixes — a hard-wrapped claim
   *  routinely spans a line break, and a literal containment check would miss
   *  it: a false GREEN on a negative assertion, which is worse than a false
   *  red. */
  const doc = (): string =>
    flat(passage('config.ts, the loadRoster docstring', read('server/src/config.ts'),
      'Reads and validates `accountsPath`', 'function loadRoster')
      .replace(/\n\s*\*\s?/g, ' '));

  it('no longer claims deploy ships the same accounts.json to both boxes', () => {
    expect(doc()).not.toMatch(/ships? the same `accounts\.json` to both boxes/);
    // The sentence that replaced it is QUOTED. The scan that stood here demanded
    // a fixed vocabulary of any sentence pairing `deploy` with `both boxes`, so
    // "The deploy never puts one `accounts.json` on both boxes." — true, and a
    // denial of the very claim — reddened for not using one of three words.
    unchanged('config.ts, the loadRoster docstring', doc(),
      'It is NOT that the two boxes hold one file: `ship_roster` (`deploy/deploy.sh`) seeds '
      + '`~/.ccrc/accounts.json` only when the box has none and never overwrites it afterwards, so '
      + 'each box\'s copy is hand-owned and the two can differ',
      'deploy/deploy.sh — `ship_roster`\'s create-if-missing guard');
  });

  it('names the seed that actually ships it, and deploy.sh still behaves that way', () => {
    expect(doc()).toMatch(/ship_roster/);
    const deploy = read('deploy/deploy.sh');
    // The create-if-missing guard IS the fact the docstring now states.
    expect(deploy, 'ship_roster no longer seeds create-if-missing — the docstring is false again')
      .toMatch(/ship_roster\(\) \{[\s\S]{0,400}?\[ -f ~\/\.ccrc\/accounts\.json \]/);
  });
});

// D-1688 AS FOUND, NOT AS PLANNED (D-2827). The plan's Task 6 rewrote this
// comment to say the telemetry gap was still open and only its stated CAUSE was
// wrong. Between the plan (at 2b15144e) and this wave, the account wave CLOSED
// the gap: `_ws_least_loaded` now calls `_account_measured`, and the comment was
// rewritten in the same change to record it, citing D-2596. So the finding is
// discharged and writing the plan's prescribed text would REGRESS an accurate
// comment into a false one. The pin is therefore inverted: it holds the CLOSURE
// rather than the gap, and it holds the correction against being re-asserted as
// a live claim.
describe('ccd: accounts.sh carries telemetry and the consumer LANDED (D-1688, D-2827)', () => {
  const header = (): string =>
    flat(passage('ccd, the _ws_least_loaded header comment', ccd(),
      '_ws_least_loaded() {', 'local best=""').replace(/^\s*#\s?/gm, ''));
  const body = (): string =>
    passage('ccd, the _ws_least_loaded body', ccd(), 'local best="" bs=1000', '\n}', 80);

  it('never asserts, as a LIVE claim, that the generated file carries no telemetry', () => {
    // The false sentence is allowed to survive as a QUOTE of what this comment
    // used to say — that is how the correction explains itself. What is
    // forbidden is asserting it. The marker must come BEFORE the stale wording:
    // a re-asserted live claim that happens to carry "no longer" about something
    // else LATER in the same sentence used to pass.
    for (const s of sentencesOf(header())) {
      const m = /no telemetry field at all|nothing to consult/.exec(s);
      if (!m) continue;
      const before = s.slice(0, m.index);
      expect(before,
        'the stale telemetry claim is being ASSERTED, not quoted. accounts.sh has carried '
        + 'CCRC_MEASURED since stage 2a; mark the old wording as historical (or quote it) before '
        + `stating it. Sentence: "${s.trim()}"`)
        .toMatch(/used to|has been false|no longer|stale|earlier version/i);
    }
  });

  it('names the array that carries it, and the generator still emits that array', () => {
    expect(header(), 'the comment does not name the array bash can actually read')
      .toMatch(/CCRC_MEASURED/);
    expect(emittedNames(), 'the generator stopped emitting CCRC_MEASURED — rewrite this comment again')
      .toContain('CCRC_MEASURED');
  });

  it('the gap the comment declares CLOSED is still closed — this loop consumes the roster answer', () => {
    // Two-sided, the same way the plan's version was, but pointing the other
    // way. The comment now says the consumer LANDED. If a future change removes
    // it, this reds — and it should: the comment would then be describing a
    // closure that has reopened, which is exactly how it went wrong the first
    // time. Rewrite the comment in the same commit that reopens it.
    expect(body(), 'the loop no longer consults the roster on telemetry — the comment above it is stale again')
      .toMatch(/_account_measured/);
    expect(ccd(), 'ccd has no _account_measured — the comment names a helper that is gone')
      .toMatch(/_account_measured\(\) \{/);
  });
});

describe('deploy.sh + README: the divergent banner between the two lanes is EXPECTED', () => {
  it('the agent lane prints the note beside the fingerprint it explains', () => {
    const lane = passage('deploy.sh, the agent lane roster block', read('deploy/deploy.sh'),
      'if [ "$TARGET" = "agent" ]; then', 'THE SECOND SEED-ONCE FACT');
    expect(lane, 'the fingerprint line moved out of the agent lane').toMatch(/roster fingerprint on \$BOX/);
    expect(lane, 'the agent lane never mentions the divergence its own run produces')
      .toMatch(/divergent/);
    // It names the remedy — the OTHER lane — so the note is actionable rather
    // than merely reassuring.
    expect(lane, 'the note does not name the second lane that clears it')
      .toMatch(/deploy\/deploy\.sh/);
    // The sentence that says what the server lane does NOT do is QUOTED. The
    // negative that stood here fired on the phrase however it was used, so
    // writing the guard's own explanation into the comment reddened it. The
    // `#` prefixes come off first, the way the config.ts docstring drops its
    // ` * ` — otherwise the literal would have to carry comment punctuation.
    unchanged('deploy.sh, the agent lane roster block', flat(lane.replace(/^\s*#\s?/gm, '')),
      'The server lane clears it by restarting the server on this build against this box\'s own '
      + 'accounts.json — it never OVERWRITES a roster',
      'deploy/deploy.sh — `ship_roster` and the server lane below it');
  });

  it('README says the same thing where it states the ordering rule', () => {
    const p = flat(passage('README, the deploy ordering paragraph', readme(),
      '**Ordering between the two targets.**', '**Restore** (manual, from the target box'));
    expect(p, 'the ordering paragraph does not mention pools').toMatch(/pool/i);
    expect(p, 'the ordering paragraph does not name the transient the two lanes produce')
      .toMatch(/divergent/);
    // What differs between the lanes is the PROJECTION, not the two
    // `accounts.json` files. QUOTED, because the negative that stood here reds
    // on the clearest true statement of that distinction — one that denies the
    // forbidden phrase in the same sentence.
    unchanged('README, the deploy ordering paragraph', p,
      'between the two lanes the two boxes PROJECT different `accounts.sh` — the fleet host\'s is '
      + 'regenerated by the new emitter while this server still runs the old one',
      'server/src/fleetstate.ts — `rosterAgreement` compares the PROJECTIONS');
  });
});

describe('CLAUDE.md: the account-pools bullet is GROUNDED where it can be, QUOTED where it cannot', () => {
  const RAW_BULLET: [string, string] = ['- **Account pools', '\n## Coordination (Build 7) invariants'];
  const bullet = (): string =>
    flat(passage('CLAUDE.md, the account-pools bullet', read('CLAUDE.md'), ...RAW_BULLET));

  it('states the rule, the authority, and the namespace fact', () => {
    const b = bullet();
    expect(b, 'ruling 3 in five words').toMatch(/untagged = unconstrained/i);
    expect(b, 'tagging only tightens — the other half of ruling 3').toMatch(/only tighten/i);
    expect(b, 'the marker path a coder must not relocate').toContain('~/.cc-sessions/pools/<project>');
    expect(b, 'the rejected spelling has to be named to be forbidden').toContain('$REG/<project>');
    expect(b, 'the four-word reader is the only reader').toMatch(/_project_pool_state/);
    expect(b, 'the three per-id fields purge with the row').toMatch(/purge with the row/i);
    expect(b, 'fixture pool names, so nobody types a real one').toMatch(/pool-a/);
    // The three claims this bullet exists for are QUOTED, for the same reason the
    // README pins above are: each was reddened in its TRUE form by a regex asked
    // to decide whether it was true.
    unchanged('CLAUDE.md, the account-pools bullet', b,
      'the server REFUSES (409/503), FORECASTS and composes the wire, and '
      + '**never places a session or writes the marker**',
      'ccd/ccd (every placement site) and server/src/server.ts (`refusePool`)');
    unchanged('CLAUDE.md, the account-pools bullet', b,
      'an undecidable tag never folds into `untagged`',
      'ccd/ccd, `_project_pool_state` — what it echoes on an undecidable tag');
    unchanged('CLAUDE.md, the account-pools bullet', b,
      '`--cross-pool` is NOT `--force` (transcript loss)',
      'ccd/ccd — `--force` and `--cross-pool` are separate flags that compose');
  });

  it('does not attribute the pool-name rule to a scanner that has no pool class', () => {
    // `topology-clean` has SEVEN forbidden classes and not one of them is a pool
    // name (`grep -c pool` over that suite is 0). In this file's idiom a trailing
    // `(suite)` names the mechanism holding the sentence, so citing it here
    // asserted a guard that does not exist — in a repo bound for public release,
    // against this tree's own "a comment is a request; a red suite is a
    // mechanism". The bullet must say the check is by hand for as long as that
    // is true, and this reds the day someone adds the class and forgets to.
    // Comment-stripped, for the reason `uninstallSurface` is: a COMMENT in
    // topology-clean saying "pool names are deliberately NOT a class here" is the
    // most likely way that word ever appears, and on the raw text it flips this
    // to the else arm — which then reds the bullet for saying the true thing.
    const scans = /\bpool\b/i.test(codeOf(read('server/test/topology-clean.test.ts')));
    const b = bullet();
    if (!scans) {
      expect(b,
        'the bullet implies a ratchet holds real pool names out of the tree. topology-clean has no '
        + 'pool class, so nothing scans for them — say so, or add the class and change this sentence.')
        .toMatch(/NOTHING scans for|no pool class|by hand/i);
    } else {
      // THE OTHER ARM, and it is the point. Without it this guard goes VACUOUS
      // the day somebody adds the class — the comment above promised it would
      // red then, and a one-armed `if` cannot. That is the guard-names-a-cause-
      // it-cannot-detect defect sitting inside the fix for that very defect.
      expect(b,
        'topology-clean now HAS a pool class, so the bullet must stop saying nothing scans for pool '
        + 'names and cite the suite that does')
        .toMatch(/topology-clean/);
      expect(b,
        'topology-clean now HAS a pool class — the bullet still says nothing scans for pool names')
        .not.toMatch(/NOTHING scans for|no pool class/i);
    }
  });

  it('is short enough to be the non-obvious rules rather than the README', () => {
    const raw = passage('CLAUDE.md, the account-pools bullet (raw)', read('CLAUDE.md'), ...RAW_BULLET);
    expect(raw.split('\n').filter((l) => l.trim() !== '').length,
      'CLAUDE.md says README is canonical — this bullet is over 12 lines').toBeLessThanOrEqual(12);
  });

  it("keeps CLAUDE.md's README size claim within 100 lines of the real file", () => {
    // This wave had to hand-bump this figure on EVERY round — the fix round and
    // the main merge each moved README again — which is the evidence it goes
    // stale, and why the ratchet lives beside the prose that moves it. No number
    // is quoted here on purpose: a comment naming the very figure this assertion
    // exists to keep honest went stale within one commit the first time.
    // `oss-metadata` allows 10%; this is the tighter, closer ratchet.
    const claimed = /README\.md` \(~?([0-9,]+) lines\)/.exec(read('CLAUDE.md'));
    expect(claimed, 'CLAUDE.md no longer states the README size').not.toBeNull();
    const said = Number(claimed![1]!.replace(/,/g, ''));
    const real = readme().split('\n').length - 1;
    expect(Math.abs(said - real),
      `CLAUDE.md says ${said} lines, README.md is ${real} — re-measure it in this commit`)
      .toBeLessThanOrEqual(100);
  });

  it('is grounded in the shipped mechanism it describes', () => {
    groundedInShippedMechanism();
  });
});
