// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { PROVIDER_IDS } from '../../../shared/providers.js';
import { DEFAULT_TEST_ROSTER } from '../helpers.js';
import { ALL, BASH, ROOTS, ccrcRoot, codeLines, here, holdersOf, prose, rel, sources } from './helpers.js';


// Increment 1a (docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md):
// "an account" / "a wrapper" was the one domain concept in this system with no
// type and no home, enumerated by hand in eight places across three languages.
// That was closed by deriving every list from one `ACCOUNTS` literal in
// `shared/api.ts`.
//
// Stage 2a then deleted that literal (Task 6): the roster is DATA now —
// `~/.ccrc/accounts.json`, parsed by `shared/roster.ts`, carried on
// `CcrcConfig.roster`, projected to bash as `~/.ccrc/accounts.sh`. So the rule
// this describe enforces has GROWN, not shrunk. Before, a second copy was
// caught by the compiler if it disagreed with `Record<Wrapper, AccountDef>`;
// now `Wrapper` is `string`, the compiler has nothing to say about a hand-typed
// account list, and a text scan is the only mechanism left. The bar is
// unchanged — "a reasonable person adding a copy in the ordinary way is stopped
// before review", not "unforgeable".
describe('the account roster — runtime data, no compile-time copies', () => {
  // The names to hunt for now come from `DEFAULT_TEST_ROSTER`
  // (server/test/helpers/roster.ts, re-exported from helpers.ts), NOT from a shipped source file — because after
  // Task 6 the roster is not defined in one. The single copy still under the
  // scanned roots (`pwa/src/lib/accounts.ts`'s transitional `PRODUCTION_ROSTER`,
  // deleted in Task 7) is the very thing this hunts for, so drawing the hunt
  // list from it would make the scanner blind to itself. `server/test/` is not
  // one of the four scanned ROOTS, so the list cannot trip its own scan either;
  // and it is still a real list of the five production ids, so a restatement of
  // two of them anywhere under the roots scores a hit exactly as it did before.
  //
  // Hand-typing the names HERE instead would make the scanner that exists to
  // prevent hand-typed copies one itself: a 6th account (say `claude-lab1`)
  // added to the production roster and then restated as
  // `['claude-lab1', 'claude9']` under some root must score a hit, and a
  // scanner frozen at five names would stay green while that drift reopened.
  const WRAPPER_NAMES = DEFAULT_TEST_ROSTER.accounts.map((a) => a.id);

  it('the name list this scans is real, and is the roster', () => {
    // A scan for names nothing spells is a scan that passes everything — the
    // same reasoning as `the roots this scans` at the top of this file. If the
    // test roster is ever emptied or renamed out from under this, THIS goes red
    // rather than the scans below going quietly vacuous.
    expect(WRAPPER_NAMES.length).toBeGreaterThanOrEqual(2);
    expect(WRAPPER_NAMES).toContain('claude');
  });

  // The fingerprint every historical copy shared: two or more wrapper names
  // quoted inside the SAME `[...]` array literal — fleet.ts's old
  // `idHomeWrapper` prefix list, server.ts's old `ACCOUNT_ORDER`, pwa's old
  // `KNOWN_WRAPPERS`, shared/api.ts's own old `HOME_ABLE_WRAPPERS`.
  const enumeratesAsArray = (src: string): boolean => {
    for (const m of src.matchAll(/\[[^\]]*\]/gs)) {
      const hits = WRAPPER_NAMES.filter((w) => new RegExp(`['"]${w}['"]`).test(m[0]));
      if (hits.length >= 2) return true;
    }
    return false;
  };

  it('no source file under the four roots restates the roster as an array literal', () => {
    const holders = ALL.filter((f) => enumeratesAsArray(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual([]);
  });

  // The rule the deleted `ACCOUNTS` test used to enforce ("defined in exactly
  // one file"), restated for a world where the answer is "in no file at all".
  // Each name below was a real export of `shared/api.ts` until Task 6; a
  // re-appearance means someone rebuilt the compile-time roster rather than
  // reading `cfg.roster`.
  it('the roster and its derived lists survive in NO shipped source file', () => {
    const RESURRECTED =
      /^\s*(?:export\s+)?const\s+(ACCOUNTS|ALL_WRAPPERS|ACCOUNT_ORDER|KNOWN_WRAPPERS|HOME_ABLE_WRAPPERS|PRODUCTION_ROSTER)\b/m;
    const holders = ALL.filter((f) => RESURRECTED.test(readFileSync(f, 'utf8'))).map(rel);
    // Task 7 of the stage-2a plan deleted the last copy site:
    // `pwa/src/lib/accounts.ts`'s `PRODUCTION_ROSTER` — a hand-typed,
    // synchronous, five-account transitional literal Task 6 left behind on
    // purpose, because `accountLabel`/`accountColorVar`/`KNOWN_WRAPPERS` were
    // called during render by eight component modules and could not read a
    // roster that arrives over the wire until the store threading this same
    // task does landed. `accountLabel`/`accountHue`/`homeAbleLabelList` are
    // now pure projections over a `RosterWire[]` every caller threads in
    // (`stores/fleet.ts`'s `roster` field, or a screen's own `/api/accounts`
    // poll) — nothing left under the four scanned roots holds a compile-time
    // copy of the roster, so `toEqual([])`, not "does not contain the deleted
    // name": the assertion tightened rather than merely surviving the
    // deletion it was written to notice.
    expect(holders).toEqual([]);
  });

  it('shared/api.ts holds the concept and shared/roster.ts holds the data', () => {
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    // The alias survives, widened — and its docstring is the roster concept's
    // only architectural record now that the literal is gone.
    expect(api).toMatch(/export type Wrapper = string;/);
    // ...and the guard that widening made meaningless is gone with it: a
    // `v is Wrapper` predicate over `string` narrows nothing while reading like
    // a check the compiler enforces. The DEFINITION is what must be absent —
    // the docstring above still names it, because why it was deleted is worth
    // more than the four lines it occupied.
    expect(api).not.toMatch(/^\s*export function isWrapper\b/m);
    // The wire contract is named once (server handler, PWA fetch, route test).
    expect(api).toMatch(/export interface AccountsResponse\b/);

    const roster = readFileSync(path.join(ccrcRoot, 'shared/roster.ts'), 'utf8');
    expect(roster).toMatch(/export function parseRoster\(/);
    expect(roster).toMatch(/export function inRoster\(/);
  });

  it('every former copy site now reads the roster it is given, not one it builds', () => {
    const srcOf = (f: string): string => readFileSync(path.join(ccrcRoot, f), 'utf8');
    // fleet.ts's old `BY_ID_PREFIX_LENGTH_DESC` — a module-level const sorted
    // at import time, which runtime roster data cannot be — is now
    // `roster.byIdLengthDesc`, precomputed once by `parseRoster`.
    expect(srcOf('server/src/fleet.ts')).toMatch(/roster\.byIdLengthDesc/);
    // Again the definition, not the mention: `idHomeWrapper`'s docstring names
    // the const it replaced and says why that shape could not survive.
    expect(srcOf('server/src/fleet.ts')).not.toMatch(/^\s*const BY_ID_PREFIX_LENGTH_DESC\b/m);
    // limits.ts's old `isKnownWrapper`, a module-scope const built from
    // `ACCOUNT_ORDER` at import time.
    expect(srcOf('server/src/limits.ts')).toMatch(/inRoster\(cfg\.roster/);
    // server.ts's `rank()`, rebuilt per request from the config's roster.
    expect(srcOf('server/src/server.ts')).toMatch(/deps\.cfg\.roster\.accounts/);
    // ...with the unknown-wrapper fallback intact: a wrapper the roster does
    // not have sorts LAST rather than vanishing off the accounts screen. Ranked
    // `order.length`, not a magic 99 — a bound that was safe only while the
    // roster was a five-member union (see the handler's own comment).
    expect(srcOf('server/src/server.ts')).toMatch(/i < 0 \? order\.length/);
  });
});


// The provider table, §4.2. This describe is the `.tsx?` half; the other half —
// the one that can see a copy in a `.mjs` — is `server/test/providers.test.ts`,
// because `sources()` above (:40-57) filters `/\.tsx?$/` at :54 and has never
// seen a `.mjs`, a `.d.mts` or a bash script (D-76, and `source-bytes.test.ts`
// records the incident that fact caused). Both halves ship in the same commit
// as the promise: a single-definition claim whose scanner cannot reach the file
// a copy would land in is a comment, not a mechanism (D-1860).
describe('the provider table — one table, one home', () => {
  // The positive control, the shape this file already uses for its own hunt
  // lists (`the name list this scans is real, and is the roster`, :846-853): a
  // scan for a name nothing spells passes everything.
  const IDS = PROVIDER_IDS;
  it('the id list this scans is real, and is the table', () => {
    expect(IDS.length).toBeGreaterThanOrEqual(2);
    expect(IDS).toContain('anthropic');
  });

  it('PROVIDERS is declared in exactly one file under the four roots', () => {
    const RE = /^\s*(?:export\s+)?const\s+PROVIDERS\b/m;
    const holders = ALL.filter((f) => RE.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/providers.ts']);
  });

  it('the derived lists are derived, not restated', () => {
    const src = readFileSync(path.join(ccrcRoot, 'shared/providers.ts'), 'utf8');
    expect(src).toMatch(/PROVIDER_IDS: readonly ProviderId\[\] = Object\.keys\(PROVIDERS\)/);
    expect(src).toMatch(/GENERATABLE: readonly ProviderId\[\] =\s*\n?\s*PROVIDER_IDS\.filter/);
    // …and the union is the table's keys, so the type cannot name a fifth
    // provider the table does not describe.
    expect(src).toMatch(/export type ProviderId = keyof typeof PROVIDERS;/);
  });

  it('no source file under the four roots restates the provider ids as an array literal', () => {
    // `enumeratesAsArray`'s rule (:859-865), over the provider ids: two or more
    // of them quoted inside one `[...]`. `providers.ts` itself is exempt only
    // in the sense that it holds no such literal — the ids appear as KEYS, and
    // that is the point of the table shape.
    //
    // ONE EXEMPTION, BY NAME, AND IT IS A DIFFERENT VOCABULARY (D-2603).
    // `shared/models.ts`
    // declares `PROBE_KINDS = ['codex', 'openrouter', 'compatible']`, two of whose
    // three words are also provider ids. It is not a restatement of this table:
    // that constant names which CATALOGUE PROBE a lane runs, and its own comment
    // draws the line — "It names the DISCOVERY mechanism, not the
    // account-connections `provider` (auth and connection): round-2 ruling 10 keys
    // probes here and nowhere else." The two lists overlap by two tokens and
    // neither derives from the other; `codex` is a probe and not a provider, and
    // `anthropic` is a provider with no probe. Collapsing them would be the real
    // defect, so the exemption is the declaration LINE, not the file.
    const EXEMPT = /^export const PROBE_KINDS = /;
    const scannable = (src: string): string =>
      src.split('\n').filter((l) => !EXEMPT.test(l)).join('\n');
    const enumerates = (src: string): boolean => {
      for (const m of src.matchAll(/\[[^\]]*\]/gs)) {
        const hits = IDS.filter((p) => new RegExp(`['"]${p}['"]`).test(m[0]));
        if (hits.length >= 2) return true;
      }
      return false;
    };
    // THE EXEMPTION IS LIVE, checked rather than assumed: if `PROBE_KINDS` is
    // renamed, moved or loses its overlap, this filter starts exempting nothing
    // and would go on passing while protecting a line that no longer exists.
    const models = readFileSync(path.join(ccrcRoot, 'shared/models.ts'), 'utf8');
    expect(enumerates(models),
      'PROBE_KINDS no longer trips this scan — delete the exemption below it')
      .toBe(true);
    expect(enumerates(scannable(models)),
      'shared/models.ts enumerates provider ids somewhere OTHER than PROBE_KINDS')
      .toBe(false);
    const holders = ALL.filter((f) => enumerates(scannable(readFileSync(f, 'utf8')))).map(rel);
    expect(holders).toEqual([]);
  });

  it('BASE_URL_OK is declared in exactly one file, and it is not the table', () => {
    const RE = /^\s*(?:export\s+)?const\s+BASE_URL_OK\b/m;
    const holders = ALL.filter((f) => RE.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/base-url.ts']);
    // The loopback SET — the three hosts written as one closed list — is the
    // other value a second copy would be spelled from, and a caller that
    // re-spells it has re-decided the exception rather than reused it.
    //
    // WHY THE SET SPELLING AND NOT THE BARE LITERAL. A scan for
    // /['"]127\.0\.0\.1['"]/ is RED on this tree, and not because anything is
    // wrong: four shipped files legitimately quote that host as a BIND ADDRESS
    // or a loopback test, and none of them is a copy of this decision —
    // measured 2026-09-07 over the four ROOTS: `server/src/config.ts`
    // (`host: env.CCRC_HOST || '127.0.0.1'`), `server/src/auth/webauthn.ts`
    // (`url.hostname === '127.0.0.1'`), `agent/src/index.ts` and
    // `agent/src/server.ts` (`rawOpts.host ?? '127.0.0.1'`). Pinning the
    // ordered three-element spelling catches the copy this task is about and
    // leaves those four alone. Measured before writing it: the set spelling has
    // ZERO holders under the four roots today, so this goes from `[]` to
    // `['shared/base-url.ts']` and never through a red.
    const LOOP_SET = /\['127\.0\.0\.1', '\[::1\]', 'localhost'\]/;
    const loopHolders = ALL.filter((f) => LOOP_SET.test(readFileSync(f, 'utf8'))).map(rel);
    expect(loopHolders).toEqual(['shared/base-url.ts']);
  });
});


describe('the account roster — config dir is data, joined in one place', () => {
  it('no source file under the four roots indexes cfg.wrappers[...] directly', () => {
    // `configDirFor` (server/src/config.ts) is the one place a wrapper
    // becomes a directory, and it maps straight from `cfg.roster.byId` +
    // `home` rather than through `cfg.wrappers` at all — a field that no
    // longer exists on `CcrcConfig` at all, since Task 5 replaced it with the
    // parsed roster. The rule ("no
    // cfg.wrappers[x] indexing outside configDirFor", architecture doc,
    // cross-cutting (a)) is therefore satisfied by there being no such
    // indexing anywhere, not by confining it to one function. Nine call sites did
    // this before fleet.ts (x2), server.ts, commands.ts, watch.ts (x4) and
    // sessionws.ts all switched to `configDirFor(cfg, wrapper)`.
    const holders = ALL.filter((f) => /\.wrappers\[/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual([]);
  });

  it('configDirFor is what those nine former call sites use now', () => {
    for (const f of ['server/src/fleet.ts', 'server/src/server.ts', 'server/src/commands.ts',
      'server/src/watch.ts', 'server/src/sessionws.ts']) {
      const src = readFileSync(path.join(ccrcRoot, f), 'utf8');
      expect(src, f).toMatch(/configDirFor\(/);
    }
  });
});


describe('the program ledger is parsed by nothing', () => {
  // Spec §7 says the ledger is "for humans and parsed by nothing," and D-4
  // records the historical server-only claim, "no file under server/src
  // mentions docs/superpowers/programs." The live guard scans all four source
  // roots, narrowed only as far as the shipped tree forces: ten mentions exist
  // today, and every one but three is a comment
  // explaining the convention (coord/db.ts's own migration-rule docstring,
  // coord/fingerprint.ts, coord/store.ts, coord/routes.ts's docstrings,
  // shared/api.ts, watch.ts's own build4-dogfood citation). The three
  // non-comment mentions are STRING VALUES the
  // running system emits or throws — never a value it reads back off disk —
  // and are named below, exactly, rather than pattern-matched: a
  // `readFile(Sync)?(` check on the same line catches only the single-line
  // literal form and waves through the ordinary two-line one
  //   const p = path.join(root, 'docs/superpowers/programs', slug + '.md');
  //   return readFileSync(p, 'utf8');
  // which is how a real ledger parser gets written. This guard instead
  // allows comment lines plus this exact 3-line allowlist and fails on any
  // OTHER non-comment mention, on any number of lines — the actual signal,
  // and not one a split read can dodge.
  const ALLOWED_NON_COMMENT = [
    // coord/db.ts — the 0-byte-file refusal and the migration-failure
    // refusal, the same sentence told to the operator twice. Each throws a
    // message; neither reads a byte off either path.
    "'(docs/superpowers/programs/<slug>.md) plus the registry and .prhistory (spec:82-85), or ' +",
    "'from the markdown ledger (docs/superpowers/programs/<slug>.md) plus the registry and ' +",
    // shared/api.ts's `ledgerPath` — the same category as the entry above,
    // one ring down: it NAMES the path the operator is expected to have
    // committed, before `POST /api/runs` is ever composed, and never opens it.
    // It lived in `pwa/src/fleet/StartProgramSheet.tsx` while the browser was
    // its only speaker — and a browser has no filesystem to read one off of in
    // the first place, which is still why naming it is safe. Wave 4 (D-1043)
    // gave it a second speaker, `server/src/coord/kickoff.ts`, which builds the
    // kickoff BODY from it and likewise never opens it; the `export` keyword
    // below is the whole diff, and this entry matches on line TEXT, so the move
    // cost nothing and the rename cost exactly this line.
    'export const ledgerPath = (slug: string): string => `docs/superpowers/programs/${slug}.md`;',
  ];

  const isCommentLine = (line: string): boolean => {
    const t = line.trim();
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
  };

  it('no shipped source reads the program ledger off disk', () => {
    const violations: string[] = [];
    for (const f of ALL) {
      if (rel(f).startsWith('server/test/')) continue;
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('docs/superpowers/programs')) return;
        if (isCommentLine(line)) return;
        if (ALLOWED_NON_COMMENT.some((allowed) => line.trim() === allowed)) return;
        violations.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(violations).toEqual([]);
  });
});


// Fix round 4 (task 14 follow-up, Minor #4): `parseCcdCaps`'s own docstring
// claimed this exact mechanism existed before it did — a scanner that was
// asserted in prose, not built. Corrected by building it: the fingerprint is
// the caps-line regex itself, `/^[a-z][a-z0-9-]*$/`, used the way both real
// readers use it (inside a `.filter(...)` call) — narrow enough that this
// file's OWN prose about the regex (this comment, `parseCcdCaps`'s
// docstring) does not itself score a hit, since neither writes the pattern
// inside a `.filter(`.
describe('one parseCcdCaps — the ccd-caps-line filter', () => {
  const FILTERS_WITH_IT = /\.filter\(\s*\(?\w*\)?\s*=>\s*\/\^\[a-z\]\[a-z0-9-\]\*\$\/\.test\(/;

  it('is defined in exactly one file, and that file is shared/agent-protocol.ts', () => {
    const holders = ALL.filter((f) => FILTERS_WITH_IT.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/agent-protocol.ts']);
  });

  it('is what both real readers (the agent and the local-mode probe) call, not re-derive', () => {
    for (const f of ['agent/src/server.ts', 'server/src/localcaps.ts']) {
      const src = readFileSync(path.join(ccrcRoot, f), 'utf8');
      expect(src, f).toContain('parseCcdCaps');
      expect(src, f).toMatch(/import\s*\{[^}]*\bparseCcdCaps\b[^}]*\}\s*from\s*'[^']*shared\/agent-protocol(\.js)?'/);
    }
  });
});


// — Stage 2b, Task 2: one build stamp, validated one way —
describe('one BuildInfo — the stamp shape and its field checks', () => {
  // Two boxes read a `~/.ccrc/build.json` now: the server its own at boot
  // (`/health`), the fleet host's agent its own on every `ready` frame
  // (`AgentReady.build`), so the server can compare the two SHAS. That
  // comparison is only meaningful if both sides agree on what a well-formed
  // stamp IS — a second copy of the field checks that drifted by one field
  // would have one box omitting a stamp the other happily forwards, and the
  // skew report would then be reporting on its own validators.
  //
  // The validation was written in `server/src/buildinfo.ts` and moved to
  // `shared/` when the agent needed it (the agent cannot import from
  // `server/src`). The FILESYSTEM read stays per package — `shared/` imports
  // nothing, not even `node:*`, because it bundles into the PWA — so what is
  // shared is exactly the shape and the checks.
  //
  // The fingerprint is the check on `sha` — the load-bearing field — in every
  // spelling this repo has actually used for it: the bare `typeof` form the
  // validation was born as (and the form a re-copy would be written in, since
  // it is what `git log` shows), the `nonEmptyString` form it is in today, and
  // the hand-rolled length test someone would reach for instead. Narrow enough
  // that the prose about it (this comment, the docstrings in both readers,
  // which discuss a `sha: undefined` rather than a check) does not score a hit
  // on itself.
  const CHECKS_THE_SHA = /typeof\s+\w+\.sha\s*!==\s*'string'|nonEmptyString\(\s*\w+\.sha\s*\)|\w+\.sha\.length\s*(?:===|!==|>|<)/;

  it('the field checks live in exactly one file, and that file is shared/buildinfo.ts', () => {
    const holders = ALL.filter((f) => CHECKS_THE_SHA.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/buildinfo.ts']);
  });

  it('the type is declared in exactly one file, and that file is shared/buildinfo.ts', () => {
    // `server/src/buildinfo.ts` RE-EXPORTS the type (`export type
    // { BuildInfo }`) so its own importers were untouched by the move — a
    // re-export is one declaration reachable by two names, which is the
    // opposite of a copy, and this regex matches a DECLARATION only.
    //
    // BOTH SPELLINGS. An `interface`-only fingerprint waves through
    // `export type BuildInfo = { … }`, which is not an exotic way to write it
    // here — the sibling block below fingerprints `MarkerState` as
    // `/export type MarkerState\s*=/`, so a reader of this very file has just
    // been shown the form that would slip past. The `=` is what keeps this off
    // the re-export (`export type { BuildInfo };`), which has no `=` and is
    // the one spelling that must stay legal.
    const DECLARES = /^\s*export (interface BuildInfo\b|type BuildInfo\s*=)/m;
    const holders = ALL.filter((f) => DECLARES.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/buildinfo.ts']);
  });

  it('is what both real readers call, not re-derive', () => {
    // Not merely "the copy is gone" — deleting either reader satisfies that.
    // Each must still reach the shared parser, and each still owns its own
    // `readFileSync`, which is the half that could not move.
    for (const f of ['server/src/buildinfo.ts', 'agent/src/server.ts']) {
      const src = readFileSync(path.join(ccrcRoot, f), 'utf8');
      expect(src, f).toContain('parseBuildInfo');
      expect(src, f).toMatch(/import\s*\{[^}]*\bparseBuildInfo\b[^}]*\}\s*from\s*'[^']*shared\/buildinfo(\.js)?'/);
      expect(src, f).toContain('readFileSync');
    }
  });
});


// — Stage 2b, Task 8: the build stamp's BASH side —
describe('one bash reader of ~/.ccrc/build.json', () => {
  // The TypeScript half is the describe above. This is the other language the
  // same file is read in: `ccd version` and `ccrc version`/`ccrc status` all
  // answer "what does this box run?" off `~/.ccrc/build.json`, in bash, on the
  // box itself — and a deployed box is exactly where two readers disagreeing
  // is least visible, because nothing there runs a test suite.
  //
  // `ccd/ccrc`'s own header states the rule this pins ("`_box_build_fields` is
  // the ONLY reader of ~/.ccrc/build.json in this file, and `version` and
  // `status` both call it") and names this task as the place the rule stops
  // being prose.
  it('actually found the bash tools — a scan over an empty list passes everything', () => {
    for (const f of ['ccd/ccd', 'ccd/ccrc', 'ccd/ccrc-adopt', 'ccd/ccrc-doctor-checks',
      'ccd/session-hook.sh', 'deploy/deploy.sh', 'deploy/verify-service.sh',
      'install.sh']) {
      expect(BASH.map(rel)).toContain(f);
    }
  });

  it('is read from exactly two places, and the second is named here BY NAME', () => {
    // THE EXCLUSION IS WRITTEN DOWN, not a scanner quietly narrowed — the
    // `'mail-disabled'` idiom this file already uses.
    //
    // `ccd/ccd`'s `cmd_version` carries a reader of its own, in a python3
    // heredoc, and it is a genuine second copy of one fact: two tools, two
    // languages, one stamp. Stage 2e Task 5 gave that reader the SAME
    // condition split `_box_build_fields` makes below (missing dependency /
    // wrong shape / parse failure / permission / a field that does not
    // type-check, each its own sentence) — split IN PLACE (Option A), not
    // delegated to `ccrc version` (Option B): a delegation was measured to
    // break the vitest harness and a dev checkout, and it would print the
    // wrong tool's name in every refusal. So the second copy of the fact
    // stays, deliberately, now equally careful rather than equally collapsed
    // — this is still the list to shorten if a later task ever proves
    // delegation safe.
    expect(holdersOf('$HOME/.ccrc/build.json')).toEqual([
      'ccd/ccd',     // cmd_version's python3 heredoc — a deliberate second reader, see above
      'ccd/ccrc',    // BOX_STAMP_FILE, read only by _box_build_fields
    ]);
  });

  it('the ccrc CLI spells the path once and parses it once', () => {
    // Two spellings is how `version` and `status` would come to read two
    // different files; two parses is how they would come to disagree about
    // what "dirty" means in the same one.
    const src = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc'), 'utf8');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('#'));
    expect(code.filter((l) => l.includes('$HOME/.ccrc/build.json'))).toEqual([
      'BOX_STAMP_FILE="$HOME/.ccrc/build.json"',
    ]);
    // The same idiom as the assertion just above, over the VARIABLE rather
    // than the literal: every non-comment line naming `BOX_STAMP_FILE`,
    // trimmed (several sit inside indented function bodies), as one exact
    // list. This is what turns "a jq parse of the stamp planted anywhere" red
    // — a new parse of the stamp has to name the file somehow, whether through
    // `BOX_STAMP_FILE` itself or through the one local it defaults from
    // (`local stamp="${1:-$BOX_STAMP_FILE}"`, already row 2 below), and either
    // shape adds a line — single- or multi-line — to this set. Re-derived from
    // the file at HEAD, not copied from a plan: a rename of the variable would
    // have to turn this red too, which is the point.
    expect(code.filter((l) => l.includes('BOX_STAMP_FILE')).map((l) => l.trim())).toEqual([
      'BOX_STAMP_FILE="$HOME/.ccrc/build.json"',
      'local stamp="${1:-$BOX_STAMP_FILE}"',
      '3) echo "$PROG unstamped (no $BOX_STAMP_FILE — this box has no build stamp yet)"',
      '4) _ccrc_die "build stamp unreadable: $BOX_STAMP_FILE (not a regular file)" ;;',
      '*) _ccrc_die "build stamp unreadable: $BOX_STAMP_FILE" ;;',
      '3) printf \'build:     unstamped (no %s — no deploy has ever stamped this box)\\n\' "$BOX_STAMP_FILE" ;;',
      '4) printf \'build:     unreadable (%s is not a regular file)\\n\' "$BOX_STAMP_FILE" ;;',
      '5) printf \'build:     unreadable (jq is not on PATH, so %s cannot be parsed)\\n\' "$BOX_STAMP_FILE" ;;',
      '*) printf \'build:     unreadable (%s does not parse as a build stamp)\\n\' "$BOX_STAMP_FILE" ;;',
      // W6 Task 2: `_ver_keep_state` copies the stamp into the version
      // directory it describes — a reader, through one local.
      'local from_stamp="$BOX_STAMP_FILE"',
      // D-3465 (d), review 179 I1: `_inst_stamp_unname` removes the box's stamp
      // after a refused kept-stamp fallback on a run that moved `~/ccrc` onto a
      // version the stamp does not name (re-review N1) — a writer, through one
      // local (`_inst_stamp`'s `dest=` idiom below).
      'local krc="${1:-}" dest="$BOX_STAMP_FILE" what="it could not be read, so it cannot be shown to name a version this box is on" sname=""',
      'mkdir -p "${BOX_STAMP_FILE%/*}" || _ccrc_die "cannot create ${BOX_STAMP_FILE%/*}"',
      '_inst_atomic "$shipped" "$BOX_STAMP_FILE" 644',
      'local src sha ref dirty version vfield tmp why rc=0 dest="$BOX_STAMP_FILE"',
      // W6 Task 4: `_ver_flip_back` restores a kept version's stamp over the
      // box's, through a local — `_inst_stamp`'s `dest=` idiom above.
      'local stamp="$BOX_STAMP_FILE"',
    ]);
    // Scoped to `_box_build_fields`'s OWN body, not the whole file: the
    // `ccrc models` verbs carry their own `jq -r` parses of catalogues and
    // registries — eleven, measured 2026-09-08 (twelve non-comment `jq -r`
    // lines file-wide, one of them this function's own) — none of them the
    // stamp, and a file-wide count conflates "a second parse of THIS stamp"
    // with "this file now parses other JSON too". The needle inside the
    // function cannot be "a jq -r line that also names $BOX_STAMP_FILE" — the
    // function reads a local `stamp` (defaulting from `$BOX_STAMP_FILE`, so a
    // shipped stamp handed to it by `_inst_stamp`'s validate arm can be
    // checked with the same parser), so the literal `$BOX_STAMP_FILE` never
    // appears on the parse line itself; the function body is what the file's
    // own structure makes exact. (The assertion above catches a parse planted
    // OUTSIDE this function that names `$BOX_STAMP_FILE` directly — this one
    // catches a second parse planted INSIDE it, which the outside one cannot
    // see if it is written against the local `stamp` variable instead.)
    const body = /_box_build_fields\(\) \{([\s\S]*?)\n\}/.exec(src);
    expect(body, 'ccd/ccrc has no _box_build_fields').toBeTruthy();
    const bodyCode = body![1]!.split('\n').filter((l) => !l.trim().startsWith('#'));
    expect(bodyCode.filter((l) => l.includes('jq -r')).length,
      'a second jq parse of the stamp has appeared inside _box_build_fields').toBe(1);
  });

  it('both verbs reach the stamp through that one reader, not around it', () => {
    // Not merely "no second copy" — deleting a verb satisfies that. Each must
    // still call `_box_build_fields`, and neither may name the file itself.
    const src = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc'), 'utf8');
    for (const verb of ['cmd_version', 'cmd_status']) {
      const body = new RegExp(`${verb}\\(\\) \\{([\\s\\S]*?)\\n\\}`).exec(src);
      expect(body, `ccd/ccrc has no ${verb}`).toBeTruthy();
      expect(body![1]!, `${verb} does not read the stamp through _box_build_fields`)
        .toContain('_box_build_fields');
      expect(body![1]!, `${verb} names the stamp file itself instead of using BOX_STAMP_FILE`)
        .not.toContain('.ccrc/build.json"');
    }
  });

  it('deploy.sh is the only writer that SPELLS the path, and it writes through install_atomic', () => {
    // The other half of "one stamp": a second writer that named the file
    // ITSELF is how a box would carry a stamp neither tool stands behind.
    // deploy.sh spells the destination HOME-relative (`install_atomic`'s own
    // contract), which is why it does not appear in the reader list above.
    //
    // THERE IS NOW A SECOND WRITER, AND IT IS DELIBERATE (stage 2d Task 7):
    // `ccrc install`'s `_inst_stamp` stamps a box that installed itself, which
    // until then reported "unstamped" for ever. It does not widen either list,
    // because it writes through `BOX_STAMP_FILE` — the one line this file
    // already pins — and that is exactly the property these assertions are
    // for. `server/test/ccrc-install-units.test.ts` ("writes the stamp through
    // BOX_STAMP_FILE") holds the other half: that the new writer really goes
    // through that variable rather than merely not duplicating the literal.
    expect(holdersOf('.ccrc/build.json')).toEqual([
      'ccd/ccd', 'ccd/ccrc', 'deploy/deploy.sh',
    ]);
    const deploySh = readFileSync(path.join(ccrcRoot, 'deploy', 'deploy.sh'), 'utf8');
    expect(deploySh.split('\n').filter((l) => !l.trim().startsWith('#') && l.includes('.ccrc/build.json')))
      .toEqual(['  install_atomic "$stamp" .ccrc/build.json 644']);
  });
});


// — The completed-install record's BASH side (release/rollout design §5) —
describe('one bash spelling of ~/.ccrc/installed', () => {
  // The SIBLING of the stamp rows above, and it wants the rule for the same
  // reason with one more edge: this file is not merely read in two places,
  // it is WRITTEN by the install spine's last step, REMOVED by uninstall and
  // COMPARED by the update gate and `--check`. Four sites, one path. A second
  // literal is how `cmd_uninstall` would come to remove a file `_upd_converged`
  // still reads, leaving a box that answers "already installed" for ever —
  // and unlike the stamp, nothing else on a box would notice: the record has
  // no `jq`, no shape, no second reader in another language to disagree with.
  //
  // Text-scanned in the shape the two describes above use: prose may discuss
  // the path anywhere, a LINE OF SHELL that names it may exist once.
  it('exactly one holder file, and it is ccd/ccrc', () => {
    // Narrower than the stamp's list ON PURPOSE. `deploy.sh` is NOT here and
    // must not be: a deploy writes no completed-install record, which is
    // precisely the distinction `ccrc version` reports as `install:
    // incomplete` on a deploy.sh box, and `ccrc update --check` reports as
    // `incomplete`/`unversioned`. A `deploy/deploy.sh` entry appearing in
    // this list would mean that distinction had been erased.
    expect(holdersOf('$HOME/.ccrc/installed')).toEqual(['ccd/ccrc']);
  });

  it('the ccrc CLI spells the path once, and every other site goes through BOX_INSTALLED_FILE', () => {
    const src = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc'), 'utf8');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('#'));
    expect(code.filter((l) => l.includes('.ccrc/installed'))).toEqual([
      'BOX_INSTALLED_FILE="$HOME/.ccrc/installed"',
    ]);
    // The variable's own call sites, as one exact list — the idiom the stamp
    // rows above use. This is what makes a NEW reader or writer of the record
    // visible: it has to name the file somehow, and through the variable is
    // the only spelling the assertion above leaves it. Re-derived from the
    // file at HEAD, so a rename of the variable reds here too.
    expect(code.filter((l) => l.includes('BOX_INSTALLED_FILE')).map((l) => l.trim())).toEqual([
      'BOX_INSTALLED_FILE="$HOME/.ccrc/installed"',
      'if [[ -f "$BOX_INSTALLED_FILE" ]]; then',
      // Task 10 (design §5): line 2 of the record now carries the
      // unsigned/verified marker, so `cmd_version` reads both lines in one
      // redirect rather than the record's first line alone.
      '{ IFS= read -r rec || rec=""; IFS= read -r prov || prov=""; } < "$BOX_INSTALLED_FILE"',
      // W6 Task 2: `_ver_keep_state` copies the record into the version
      // directory it describes, as that version's completeness mark.
      'local from_record="$BOX_INSTALLED_FILE"',
      'local rc=0 tmp dest="$BOX_INSTALLED_FILE"',
      'if [ -f "$BOX_INSTALLED_FILE" ] && IFS= read -r rec < "$BOX_INSTALLED_FILE" && [ "$rec" = "$sha" ]; then',
      // cmd_update (review fix round 1 I4): whether the OLD (running) build
      // was itself a COMPLETED install of its own tag, captured before this
      // run's spine clears the record — arm 2's same-tag skip narrows to
      // this, so a same-tag rerun over a HALF-installed tree still lets arm
      // 2 restore `previous` instead of falling straight to arm 3.
      'if [ -f "$BOX_INSTALLED_FILE" ] && [ -r "$BOX_INSTALLED_FILE" ]; then',
      'IFS= read -r old_rec < "$BOX_INSTALLED_FILE" 2>/dev/null || old_rec=""',
      // cmd_update (D-3462): the record's whole body, held before the run clears
      // it, so a death that replaced nothing can put it back (`_upd_unwind`).
      'if [ "$old_completed" -eq 1 ] && [ -f "$BOX_INSTALLED_FILE" ] && [ -r "$BOX_INSTALLED_FILE" ]; then',
      'IFS= read -r -d \'\' old_rec_body < "$BOX_INSTALLED_FILE" 2>/dev/null; old_rec_kept=1',
      // cmd_update (D-3114): cleared right before the staged install, so its
      // presence afterwards means this run's spine completed — the one fact
      // that tells "moved, unhealthy" (exit 3) from "died" (exit 1).
      'rm -f "$BOX_INSTALLED_FILE"',
      'if [ -f "$BOX_INSTALLED_FILE" ]; then',
      // `_rollback_killed_flip_state` (D-3466), condition (2): nothing at all is
      // at the record's path — `[ ! -e ] && [ ! -L ]`, so a dangling link or a
      // FIFO counts as something. One of six conditions, and the only reader of
      // the record's ABSENCE for a rollback; the record has five removers, so
      // absence alone proves nothing (the entry names them).
      '{ [ ! -e "$BOX_INSTALLED_FILE" ] && [ ! -L "$BOX_INSTALLED_FILE" ]; } || return 1',
      // cmd_rollback (D-3285, final review B3(i), then a re-review clause):
      // a read-only convergence check — the running stamp's version and sha
      // against the completed-install record — before any network call or
      // lock, so a HAND-TYPED rollback (`--from cli`) already converged on
      // its target prints a runnable remedy instead of falling into
      // `cmd_update`'s own `--force`-to-reinstall no-op. Gated to `--from
      // cli` only: every other caller (pwa, watchdog, …) must reach
      // `cmd_update`'s converged path instead, which writes the terminal
      // `done` report this early return does not. The guarded read (the
      // same shape `cmd_update`'s own `old_completed` capture above uses,
      // review fix round 1 I4) so an absent record prints no stray bash
      // error.
      '&& { [ -f "$BOX_INSTALLED_FILE" ] && IFS= read -r rb_rec < "$BOX_INSTALLED_FILE"; } 2>/dev/null \\',
      // W6 Task 4, `cmd_rollback`: a box already on the kept tag has nothing
      // to do only when its record IS the kept version's (D-3264's rerun).
      'if [ "$VER_CURRENT" = "$to" ] && [ "$now" = "$to" ] && cmp -s -- "$BOX_INSTALLED_FILE" "$BOX_VERSIONS_ROOT/$to/$VER_RECORD_COPY"; then',
      // W4a Task 9: `cmd_watchdog`'s re-measure reads the record's line 1 on
      // ONE line; its failed-detail sentence names no path (the assertion
      // above). Measured (not the brief's claimed anchor, which put this
      // above `_upd_converged`'s lines): `cmd_watchdog` sits between
      // `cmd_update` (whose own read is the line above) and
      // `_upd_marker_unsigned` (whose reads are the two lines below) in
      // `ccd/ccrc`'s FILE ORDER, so its entry goes here — controller ruling
      // C3, "let single-definition.test.ts decide".
      '[ -f "$BOX_INSTALLED_FILE" ] && { IFS= read -r rec < "$BOX_INSTALLED_FILE"; } 2>/dev/null || true',
      // _upd_marker_unsigned (wave 4, Task 6): the ONE read of the record's
      // line 2 for an update — cmd_update's arm-2 precondition and
      // cmd_rollback's --allow-unsigned both call it, so neither caller
      // names the record here.
      '[ -f "$BOX_INSTALLED_FILE" ] && [ -r "$BOX_INSTALLED_FILE" ] || return 1',
      '{ IFS= read -r m1; IFS= read -r m2; } < "$BOX_INSTALLED_FILE" || :',
      '[ -f "$BOX_INSTALLED_FILE" ] || return 1',
      'IFS= read -r rec < "$BOX_INSTALLED_FILE" || return 1',
      // W4 Task 4 (D-3254): `_upd_write_previous`
      // asks whether the record is ABSENT before `cmd_update` removes it — a stamp
      // with no record is not a completed baseline. Plain `if` (review fix
      // round 1 I2): the same-tag arm above now `return`s unconditionally,
      // so this is no longer its `elif`.
      'if [ ! -e "$BOX_INSTALLED_FILE" ]; then',
      // `_upd_unwind` (D-3462): rewrites the record cmd_update cleared, tmp + one rename.
      'tmp="$BOX_INSTALLED_FILE.tmp.$$"',
      'if printf \'%s\' "$rec_body" > "$tmp" 2>/dev/null && chmod 644 "$tmp" && _plat_mv_notdir "$tmp" "$BOX_INSTALLED_FILE" 2>/dev/null; then',
      // _upd_restore_arm3 (wave 4, Task 6, D-3260):
      // removes the record a completed spine wrote before its gate failed.
      'if rm -f -- "$BOX_INSTALLED_FILE" 2>/dev/null; then',
      // W6 Task 4, `_ver_flip_back`: the record, cleared before the kept
      // version's own spine so its presence afterwards means that spine wrote it.
      'local rec="$BOX_INSTALLED_FILE"',
      // W6 Task 4, `_upd_restore_arm1`: a failed arm 1 clears the record, so
      // arm 2's child cannot read the box as already on the previous tag.
      'if ! rm -f -- "$BOX_INSTALLED_FILE" 2>/dev/null; then',
      'rm -f -- "$BOX_INSTALLED_FILE" \\',
      '|| _ccrc_die "removing $BOX_INSTALLED_FILE failed"',
    ]);
  });
});


// — The model-class registry (spec §4.1, §4.2, §6.1, §6.4, §7) —
describe('the model files, and who reads each one', () => {
  // SIX paths — five measured 2026-09-08 by counting this describe's own
  // writer/reader rows below (the models directory, the catalogue, the
  // registry, the LiteLLM config, the ownership whitelist), and the sixth, the
  // lane's `<id>.windows.json` — each with a writer and a set of readers, and
  // the whole reason to register them here is that most cross LANGUAGES: the
  // catalogue is written by bash-and-python and read by TypeScript; the TSV is
  // written by node and read (from Plan 2) by bash; the effort map is written
  // by node and read by python in another repository. None of those pairs can
  // share a constant, so agreement has to be a red suite instead.
  //
  // THIS DESCRIBE BUILDS ITS OWN CORPUS, and that is load-bearing. `ALL` comes
  // from `sources()`, which filters `/\.tsx?$/` — so `shared/models.mjs` and
  // `shared/modelenv.mjs` are invisible to it — and `deploy/` is not one of the
  // bash roots, so `deploy/models-op.mjs` is invisible to `BASH` too. A rule
  // about "who writes this file" run over either corpus alone would pass by
  // looking at nothing at all, which is this suite's own oldest lesson.
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      if (e.startsWith('__') || e === 'node_modules') continue;
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) { out.push(...walk(p)); continue; }
      if (/\.(tsx?|mjs|mts)$/.test(p)) out.push(p);
    }
    return out;
  };
  const MODELS_CORPUS = [...new Set([
    ...ALL, ...BASH,
    ...walk(path.join(ccrcRoot, 'shared')),
    ...walk(path.join(ccrcRoot, 'deploy')),
  ])];
  /** Comments stripped for bash, kept otherwise — `codeLines`' own rule, and
   *  the reason the probe (which says in a COMMENT that it never touches the
   *  registry) is not a holder of that path. */
  const codeOf = (f: string): string =>
    (BASH.includes(f) ? codeLines(f).join('\n') : readFileSync(f, 'utf8'));
  const spell = (needle: string): string[] =>
    MODELS_CORPUS.filter((f) => codeOf(f).includes(needle)).map(rel).sort();

  it('the corpus is real: it holds the four files this design added', () => {
    // Guards every row below: a corpus that had gone empty would make each of
    // them pass over nothing.
    const names = MODELS_CORPUS.map(rel);
    for (const f of ['shared/models.mjs', 'shared/modelenv.mjs',
      'deploy/models-op.mjs', 'ccd/ccrc-models-probe']) {
      expect(names, `${f} is outside the corpus this describe scans`).toContain(f);
    }
  });

  // THIS LIST STILL GROWS WITH PLAN 2, deliberately and BY NAME — that plan
  // has a step that edits the row below by hand:
  //   Plan 2 adds `'ccd/ccd'`               (the class carry's reader of the
  //     TSV's third column and of the catalogue), beside its agreement test.
  // `'ccd/ccrc-doctor-checks'` (Part C's per-lane freshness check, a READER of
  // both the catalogue and the registry file) has already landed as the
  // second row below — measured against HEAD, not predicted ahead of it. So
  // the settled end state of the first assertion is the four-row list
  //   ['ccd/ccd', 'ccd/ccrc', 'ccd/ccrc-doctor-checks', 'ccd/ccrc-models-probe']
  // in `holdersOf`'s own sort order. It is left at THREE rows here on purpose:
  // an exact match that is widened by the plan that widens the code is the
  // guard; a list written ahead of the code is a list nobody measured. Turning
  // any row into a pattern would retire the guard outright.

  it('the models directory is spelled by exactly these bash tools', () => {
    expect(holdersOf('.ccrc/models')).toEqual([
      'ccd/ccrc',                 // cmd_models and its helpers — the verbs
      'ccd/ccrc-doctor-checks',   // Part C's freshness check — a READER only, see below
      'ccd/ccrc-models-probe',    // the catalogue's writer
    ]);
  });

  it('the probe is the ONLY thing that writes a catalogue', () => {
    // A second writer is how a box would carry a catalogue no probe stands
    // behind — and `deriveModels` retires every model a catalogue omits, so a
    // wrong catalogue is a warning on every surface about models that answer
    // fine.
    //
    // `_probe_mv_notdir`, not a bare `mv -f`: the probe cannot source ccd's
    // platform block (it ships as its own executable), so it cannot spell
    // GNU's `mv -fT` either — `macos-platform.test.ts`'s GNU-only scan
    // forbids that flag at any call site outside the block. The local helper
    // carries the same refusal (`$OUT` a directory -> refuse, rather than
    // "succeeding" by dropping the file inside it), so a bare
    // `mv -f "$NORM" "$OUT"` is still no longer a substring of the file.
    const probe = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc-models-probe'), 'utf8');
    // An exact COUNT of the call sites, not `toContain`: a `toContain` is
    // satisfied by any one of the three (the catalogue rename, the
    // stale-mark rewrite, the `--endpoints` answer) and stays green if a
    // fourth staged write is added without going through the helper, or if
    // one of the three loses it back to a bare `mv`. Measured 2026-09-08
    // against HEAD (`grep -Fc '_probe_mv_notdir "$NORM" "$OUT"'
    // ccd/ccrc-models-probe`): 3.
    expect((probe.match(/_probe_mv_notdir "\$NORM" "\$OUT"/g) ?? []).length).toBe(3);
    // A write is `mv`/`cp`/`tee` — or this repo's other two spellings of an
    // atomic install, `install_atomic` (deploy.sh's helper) and
    // `_inst_atomic` (ccrc's own, `_` is a word character so `\b` still
    // anchors it) — naming the CATALOGUE path (`<id>.json`, not
    // `<id>.classes.json`, the REGISTRY's own row below, and not
    // `<id>.effort.json`, the materialiser's file, §6.4 — neither is a second
    // catalogue writer), or a `>`/`>>` redirect whose TARGET is the catalogue
    // path — not merely a line that contains both a `>` and the path
    // anywhere in it. Without the target anchor this false-positives on
    // Task 9's own read, already in `ccd/ccrc` today: `jq '.models | length'
    // "$HOME/.ccrc/models/$id.json" 2>/dev/null` — a stderr redirect that
    // shares the line with the path it is reading, not writing.
    const CATALOGUE_PATH = /\.ccrc\/models\/[^ ]*(?<!\.classes)(?<!\.effort)\.json/;
    const writesDirectly = (l: string): boolean => {
      if (!CATALOGUE_PATH.test(l)) return false;
      if (/\b(?:mv|cp|tee|install|install_atomic|_inst_atomic)\b/.test(l)) return true;
      if (/\b(?:writeFileSync|renameSync)\b/.test(l)) return true;
      return /(?<![0-9&])>{1,2}\s*"?[^"'\s]*\.ccrc\/models\/[^"'\s]*(?<!\.classes)(?<!\.effort)\.json/.test(l);
    };
    // Plan 2 adds `ccd/ccd` as a reader of the models directory — the
    // `.classes.tsv` projection (spec §7), not the catalogue — when it lands,
    // extend BOTH this write-scan's file list AND the readers' list in the
    // `it()` just above, not just one; a reader that never writes belongs
    // only in the second.
    for (const f of ['ccd/ccrc', 'deploy/deploy.sh']) {
      const code = codeLines(path.join(ccrcRoot, f));
      expect(code.filter(writesDirectly),
        `${f} writes a catalogue directly instead of running the probe`).toEqual([]);
    }
  });

  it('the REGISTRY file is named by exactly four files, and edited by one of them', () => {
    // `<id>.classes.json` is the operator's own file (§4.1), edited only
    // through the verbs — so the verbs' node half is the one program that
    // writes it, and every write passes the validator. `shared/models.ts`
    // names the path in its header because that is where the type is
    // defined. `shared/models.mjs` names it a second time, in `parseRegistry`'s
    // own docstring — measured 2026-09-08: the single-source ruling moved the
    // validator ITSELF into this file, so the sentence describing what the
    // validator validates moved with it. Neither file holds an fs call (both
    // are L0 and import nothing).
    //
    // `ccd/ccrc-doctor-checks` is a fourth holder, added by Part C: it tests
    // `[ -f "$dir/$id.classes.json" ]` to build its population — a READER,
    // not an editor. A bash holder that only ever TESTS or READS the path is
    // not the "second, unvalidated EDITOR" this test's older comment warned
    // against; that warning is about a bash WRITE of the same bytes, which is
    // exactly what the assertion just below this one now forbids by name, so
    // admitting a reader here does not reopen the door the comment was
    // guarding.
    expect(spell('classes.json')).toEqual([
      'ccd/ccrc-doctor-checks', 'deploy/models-op.mjs', 'shared/models.mjs', 'shared/models.ts',
    ]);
  });

  it('the WINDOWS file is named by exactly two files, and only models-op can write it (codex-bridge spec §2.7)', () => {
    // `<id>.windows.json`, the lane's measured context windows.
    // `deploy/models-op.mjs` builds its path (`windowsPath`) and is its one
    // writer; `shared/models.mjs` names it in `parseWindows`' docstring and
    // holds no fs call (it imports nothing). A bash tool or a server module
    // spelling it would be a second, unvalidated reader or editor.
    expect(spell('.windows.json')).toEqual(['deploy/models-op.mjs', 'shared/models.mjs']);
  });

  it('the doctor\'s models check reads the registry file but never writes it', () => {
    // The other half of the ruling just above: admitting a reader is only
    // honest if that reader really never edits the same bytes. Same shape as
    // "the probe is the ONLY thing that writes a catalogue" above, aimed at
    // `.classes.json` instead of the catalogue's own `.json` — a `>`/`>>`
    // redirect TARGETING the registry path, or an `mv`/`cp`/`tee`/
    // `install`/`install_atomic`/`_inst_atomic`/`writeFileSync`/`renameSync`
    // naming it, would be a second, unvalidated editor of the operator's own
    // file.
    //
    // R2 (fix round 2): the first cut of this guard anchored on the full
    // literal `.ccrc/models/…classes.json`, which requires that substring on
    // the SAME line as the write. `_check_models` never spells it that way —
    // it binds `local dir="$HOME/.ccrc/models"` once and then writes every
    // touch as `"$dir/$id.classes.json"`, so the population line and every
    // future write in that same idiom sailed straight past the old regex
    // (measured: `echo "{}" > "$dir/$id.classes.json"` and
    // `mv /tmp/seed.json "$dir/$id.classes.json"` both stayed GREEN; only the
    // full-path spelling, which the file never uses, went red). Anchoring on
    // the FILENAME alone puts `"$dir/$id.classes.json"` in scope regardless
    // of how the directory half is spelled.
    const REGISTRY_FILENAME = /\.classes\.json/;
    const writesRegistryDirectly = (l: string): boolean => {
      if (!REGISTRY_FILENAME.test(l)) return false;
      if (/\b(?:mv|cp|tee|install|install_atomic|_inst_atomic|writeFileSync|renameSync)\b/.test(l)) return true;
      // Excluding any preceding word character (not just digit/&) matters
      // here specifically: this file's own prose spells the id placeholder
      // as `<id>.classes.json` in a user-facing message, and `<id>`'s own
      // closing `>` sits directly in front of the filename — an unguarded
      // lookbehind reads that as a redirect target. A real redirect's `>` is
      // preceded by whitespace, a quote, or nothing; never a bare letter.
      return /(?<![0-9A-Za-z_&])>{1,2}\s*"?[^"'\s]*\.classes\.json/.test(l);
    };
    const code = codeLines(path.join(ccrcRoot, 'ccd', 'ccrc-doctor-checks'));
    expect(code.filter(writesRegistryDirectly),
      'ccd/ccrc-doctor-checks writes a registry directly instead of only reading it').toEqual([]);
    // Pin the exact COUNT of lines that touch `.classes.json` at all, the
    // same strength "the probe is the ONLY thing that writes a catalogue"
    // above gets from its exact-count pin on `_probe_mv_notdir`: a write
    // detector's own vocabulary can always miss a future spelling, but an
    // exact count forces a human to look at any new touch, write or not.
    // Measured against HEAD: 2 — the population test (`[ -f
    // "$dir/$id.classes.json" ]`) and the empty-population SKIP message that
    // names the path in its own text.
    expect(code.filter((l) => REGISTRY_FILENAME.test(l)).length).toBe(2);
  });

  it('no bash code line spells the retired box-global LiteLLM config path or its override (Plan 4)', () => {
    // Plan 4 Task C1: the external LiteLLM arm rendered the other repository's
    // box-global config, honouring that repository's own `CCGPT_CONFIG`
    // override, and it left with that repository's lane. A lane's config is
    // its own `~/.ccrc/codex/<id>/litellm.yaml` (`_codex_litellm_yaml`), so no
    // line of shell in any tool here reads or writes the old path again.
    expect(holdersOf('.handoff/litellm-config.yaml')).toEqual([]);
    expect(holdersOf('CCGPT_CONFIG')).toEqual([]);
  });

  it('ccrc never runs the other repository\'s launcher (Plan 4)', () => {
    // A bare `ccgpt stop` stops units by name, and those names are ccrc's own
    // tiers (`ccgpt-<id>-{litellm,shim}.service`). The external arm was the
    // last code line that ran it, or sent an operator to it.
    const code = codeLines(path.join(ccrcRoot, 'ccd', 'ccrc'));
    expect(code.filter((l) => /\bccgpt (stop|start|login)\b|command -v ccgpt\b/.test(l))).toEqual([]);
  });

  it('the ownership whitelist is read by exactly one thing in this repo', () => {
    // `handoff-proxy` and `claude-alt1` read it too — in the monorepo, which
    // this scan cannot see. Within this repo it must stay one reader, because
    // a second one would be a second opinion about which providers may serve.
    expect(spell('providers-whitelist.json')).toEqual(['deploy/models-op.mjs']);
  });

  it('a lane file\'s type-tested read is DEFINED once, in shared/modelenv.mjs, and deploy/models-op.mjs imports it (Plan 3b A-6)', () => {
    // A definition, not a mention: `shared/modelenv.d.mts` declares it
    // (`export declare function …`) and every reader calls it, and neither is
    // a second opinion about what "a lane file's read" means. Two copies were
    // what Plan 3a's MF-2 left (one per module), and ruling A-6 makes it one.
    const defines = MODELS_CORPUS
      .filter((f) => /^(?:export\s+)?function\s+readRegular\s*\(/m.test(codeOf(f)))
      .map(rel).sort();
    expect(defines).toEqual(['shared/modelenv.mjs']);
    expect(readFileSync(path.join(ccrcRoot, 'deploy', 'models-op.mjs'), 'utf8'))
      .toMatch(/import\s*\{[^}]*\breadRegular\b[^}]*\}\s*from\s*'\.\.\/shared\/modelenv\.mjs'/);
  });

  it('the four class names are enumerated only where a walk needs the sequence', () => {
    // A file may list all four ONLY if it walks them in order. SEVEN print,
    // and SIX of them walk it: the TypeScript source, its bare-`node` twin,
    // the materialiser, the verbs' node half, `ccd/ccrc` (whose bash walk
    // is what answers a class typo at exit 2), and — since the routing
    // record (routing spec 2026-09-14 §5.1) — `ccd/ccd`, which holds the four
    // names ONCE, in `ROUTE_CLASSES` (`fable opus sonnet haiku default`), and
    // WALKS them through `_route_word_in`'s `for x in $2` loop to answer the
    // `class` field's vocabulary question. The `degraded` arm walks the same
    // sequence minus `default` — a session cannot degrade TO "no override" —
    // and DERIVES it (`${ROUTE_CLASSES% default}`, controller ruling S1-R3)
    // rather than re-typing it three lines below the first.
    //
    // THE RULE IS THE WALK, NOT THE LANGUAGE. An earlier version of this
    // rationale said a shape check run in bash needs the vocabulary "in bash,
    // not just in the TypeScript definition" — which routing slice 1's Task 1
    // falsified in this very file's neighbourhood: `SUBAGENT_CLASSES` is read
    // in bash by the same `_route_word_in` loop and is NOT spelled in bash at
    // all, because `ccrc install` PROJECTS it into `$HOME/.ccrc/accounts.sh`
    // (`single-definition` pins that list at exactly two languages for that
    // reason). A projection is available to every holder listed here, so
    // "bash needs its own copy" is not the argument that admits any of them.
    // What admits a file is that it walks the sequence in order.
    //
    // The seventh, `pwa/src/lib/models.ts`, is NOT an accidental, unrelated
    // file — the spec names it three times as the CURRENT hardcoded picker
    // this design will eventually replace: §1 calls it out by path and line
    // range ("The PWA picker is a hardcoded table keyed on the wrapper
    // string"), §8 describes what it becomes ("Session picker … becomes
    // data: rows are the four classes …", Plan 3a), and §13.4's migration
    // step 4 is "`pwa/src/lib/models.ts`'s table is deleted, not kept as a
    // fallback." So it is a real, spec-acknowledged holder TODAY, and
    // Plan 3a is the task that removes it — when that lands, this row comes
    // OUT of the list below rather than staying as a permanent exception.
    //
    // Until then it matches through the QUOTED-literal arm — its `/model
    // <alias>` rows quote the same four words as Claude Code CLI
    // slash-command aliases (`row('Opus 5.5', 'opus', 'opus')` literally
    // contains `'opus'`), not as a classification walk — so tightening the
    // bare-word arm (the fix for a match found in PROSE) cannot exclude it
    // without also excluding the other real holders, which reach the quoted
    // arm the same way. Named here rather than carved out of the corpus, per
    // the same rule this file's header states for every other scan: the list
    // is what the scan actually finds, honestly reconciled, not narrowed to
    // fit a prediction written before the code existed.
    const enumerates = (src: string): boolean =>
      ['haiku', 'sonnet', 'opus', 'fable'].every((c) =>
        new RegExp(`(?:'${c}'|"${c}"|(?<![\\w'-])${c}\\s*:|(?<![\\w-])${c}(?![\\w-]))`).test(src));
    const holders = MODELS_CORPUS.filter((f) => enumerates(codeOf(f))).map(rel).sort();
    expect(holders).toEqual([
      'ccd/ccd',                // ROUTE_CLASSES and _route_valid's degraded arm — routing spec §5.1
      'ccd/ccrc',               // MODELS_CLASSES — the usage-error gate
      'ccd/session-hook.sh',    // the Fable arm's deny reason and prefilter name the classes in prose (D-6792) — no walk
      'deploy/models-op.mjs',   // CLASSES — the mutation walk
      'pwa/src/lib/models.ts',  // the picker's aliases — spec §1/§8/§13.4, deleted by Plan 3a
      'shared/modelenv.mjs',    // the env block's key order and the TSV's
      'shared/models.mjs',      // the twin's mirrored list
      'shared/models.ts',       // CLASSES — the definition, and FAMILY_TOKENS
    ]);
  });

  it('and the scan is looking at something — the four really are in the definition', () => {
    // Guards the guard: an `enumerates` that had gone vacuous would turn the
    // list above into every source in the tree.
    const src = readFileSync(path.join(ccrcRoot, 'shared/models.ts'), 'utf8');
    expect(src).toContain("export const CLASSES = ['haiku', 'sonnet', 'opus', 'fable'] as const;");
  });

  it('ANTHROPIC_SMALL_FAST_MODEL never reaches `fable`, pinned in source (fix round 2A, N4)', () => {
    // `modelenv.test.ts`'s own guard for this chain used to be a REGISTRY
    // (haiku and sonnet both null, opus and fable both set) that reached this
    // exact line, so a `?? fable` added to it would red. Fix round 1, v2
    // (2026-09-09) narrowed `subagent` to haiku/sonnet, and the registry that
    // test built also named `subagent: 'opus'` to stay otherwise legal — a
    // shape `parseRegistry`'s own gate refused BEFORE `modelEnvBlock` ever
    // reached this line, so the commit correctly retired that case rather
    // than ship a registry `parseRegistry` would refuse. Nothing else took
    // its place: measured 2026-09-10, mutating this line to
    // `haiku ?? sonnet ?? fable ?? sentinel('haiku')` and running the four
    // model test files (models, modelenv, models-op, ccrc-models) reds
    // NOTHING — `Test Files 4 passed (4)`. A source pin is the only guard
    // left, the same
    // shape `modelenv.test.ts`'s own static pin further down that file uses
    // for `ANTHROPIC_MODEL`'s chain.
    const src = readFileSync(path.join(ccrcRoot, 'shared', 'modelenv.mjs'), 'utf8');
    expect(src).toContain("ANTHROPIC_SMALL_FAST_MODEL: haiku ?? sonnet ?? sentinel('haiku'),");
  });

  it('SUBAGENT_CLASSES is one list spelled in two languages — shared/models.mjs and ccd/ccrc\'s MODELS_SUBAGENT_CLASSES (round 3, NEW-4)', () => {
    // `MODELS_CLASSES` (the four) is covered by the enumeration scan above.
    // Nothing pinned its narrower sibling — the two classes `set-subagent`
    // accepts — before this: a divergence between the node list and the bash
    // copy is message-text only (it cannot misroute a write), but it can
    // still promise a class the other half refuses, or refuse one the other
    // half still offers.
    const models = readFileSync(path.join(ccrcRoot, 'shared', 'models.mjs'), 'utf8');
    expect(models).toContain("export const SUBAGENT_CLASSES = Object.freeze(['haiku', 'sonnet']);");
    const ccrc = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc'), 'utf8');
    expect(ccrc).toContain('MODELS_SUBAGENT_CLASSES="haiku sonnet"');
  });
});


// — Stage 2e, Task 2: the per-box remote-control flag —
describe('one ~/.ccrc/remote-control, spelled once per tool and equal across all four', () => {
  // The flag `ccd`'s `_rc_enabled` reads on EVERY spawn to decide whether a
  // session comes up with `--remote-control` (D-99). Four bash files touch it
  // and none of them can share a variable with any other:
  //
  //   - `ccd` is the READER and the authority on what the bytes mean. It
  //     sources only `~/.ccrc/accounts.sh` and nothing in this repository.
  //   - `ccrc` (`_inst_rc`) is the single-box WRITER, seeding `off`.
  //   - `ccrc-doctor-checks` (`_dr_rc_state`) re-measures it for the operator.
  //     It is sourced under `set -u` by things that are not `ccrc`
  //     (`ccrc-doctorFixture.ts`'s `tableNames()` does exactly that), so a
  //     top-level reference to another tool's variable would make sourcing it
  //     FAIL, and a `${…:-…}` fallback is the second spelling with a branch in
  //     front of it. That is D-92's trade for `CCRC_UNIT_DIR`, unchanged.
  //   - `deploy.sh` writes it over ssh, in the BOX's shell, where no variable
  //     of ours exists at all — hence `~` rather than `$HOME`.
  //
  // So the agreement cannot be structural, and this is the mechanism that
  // holds it instead: a drift in any one of the four spellings would mean a
  // box whose installer seeds one file, whose supervisor reads another, and
  // whose doctor reports on a third.
  const NEEDLE = '.ccrc/remote-control';
  /** Every spelling normalised to the same box-relative form, so `$HOME/x` and
   *  `~/x` — which are the same file and MUST be — compare equal. */
  const boxPath = (s: string): string => s.replace(/^\$HOME\//, '~/');

  it('is touched by exactly those four files, and each is named here BY NAME', () => {
    expect(holdersOf(NEEDLE)).toEqual([
      'ccd/ccd',                  // CCRC_RC_FILE + _rc_enabled — the reader, and the authority
      'ccd/ccrc',                 // _inst_rc — the single-box seed (off)
      'ccd/ccrc-doctor-checks',   // _dr_rc_state — the operator-facing re-measurement
      'deploy/deploy.sh',         // the fleet lane's seed (on), before the ccd that reads it
    ]);
  });

  it('every one of the four resolves to the same file', () => {
    const src = (f: string): string => readFileSync(path.join(ccrcRoot, f), 'utf8');

    const reader = /^CCRC_RC_FILE="([^"]+)"$/m.exec(src('ccd/ccd'));
    expect(reader, 'ccd/ccd declares no CCRC_RC_FILE').toBeTruthy();

    const doctor = /^CCRC_RC_FILE="([^"]+)"$/m.exec(src('ccd/ccrc-doctor-checks'));
    expect(doctor, 'ccd/ccrc-doctor-checks declares no CCRC_RC_FILE').toBeTruthy();

    // The installer's is a `local`, not a top-level constant, and deliberately:
    // `ccrc`'s top-level block exists for files this tool both READS and
    // writes, and it only writes this one. So it is located inside the step.
    const instRc = /_inst_rc\(\)[\s\S]*?\n\}/.exec(src('ccd/ccrc'));
    expect(instRc, 'ccd/ccrc has no _inst_rc').toBeTruthy();
    const seedLocal = /local dest="([^"]+)"/.exec(instRc![0]);
    expect(seedLocal, '_inst_rc does not name its destination').toBeTruthy();

    // deploy's is inside the ssh payload, in the box's own shell.
    const deploySeed = readFileSync(path.join(ccrcRoot, 'deploy', 'deploy.sh'), 'utf8')
      .split('\n').find((l) => l.includes('"${SSH[@]}"') && l.includes(NEEDLE));
    expect(deploySeed, 'deploy.sh never seeds the flag').toBeTruthy();
    const deployPaths = [...deploySeed!.matchAll(/~\/\.ccrc\/remote-control/g)].map((m) => m[0]);
    expect(deployPaths.length, 'the deploy seed names the flag file nowhere').toBeGreaterThan(0);

    const spellings = new Set([
      boxPath(reader![1]!), boxPath(doctor![1]!), boxPath(seedLocal![1]!), ...deployPaths,
    ]);
    expect([...spellings]).toEqual(['~/.ccrc/remote-control']);
  });

  it('each tool spells it once — no file holds two lines of shell naming it', () => {
    // Prose may discuss the path anywhere (all four files do, at length);
    // only a LINE OF SHELL is a toucher. `ccd/ccrc` is the one exception and
    // it is named: `_inst_rc`'s transcript line quotes the path AT the
    // operator, which is a message rather than a second access to the file.
    for (const [f, want] of [
      ['ccd/ccd', 1],
      ['ccd/ccrc-doctor-checks', 1],
      ['deploy/deploy.sh', 1],   // one ssh — its guard, its write and its transcript line are one line
      ['ccd/ccrc', 2],           // `local dest=…`, and the line an operator is told to edit
    ] as const) {
      const lines = codeLines(path.join(ccrcRoot, f)).filter((l) => l.includes(NEEDLE));
      expect(lines.length, `${f} names ${NEEDLE} on ${lines.length} lines of shell:\n${lines.join('\n')}`)
        .toBe(want);
    }
  });
});


// — Stage 3b, Task 1: the exposure seam —
describe('one ~/.ccrc/exposure.env, spelled once in bash through CCRC_EXPOSURE_FILE', () => {
  // Spec D3: exposure config (CCRC_ORIGIN, CCRC_RP_ID, the DuckDNS trio) lives
  // in its OWN file, written by the post-install verb `ccrc expose` — never in
  // the seed-once `ccrc.env` (`_inst_env` writes that once and never again,
  // D-88). The server unit reads it as a SECOND, optional `EnvironmentFile=`
  // line, which the ccrc-install suite pins ("reads ccrc.env then
  // exposure.env"); THIS block pins the bash side the way `CCRC_RC_FILE`'s
  // does above: one declaration, and no second spelling of the literal path
  // for a later writer/reader to drift from. The path also appears in unit
  // TEMPLATES (`deploy/ccrc.service`, and Task 3's ccrc-ddns.service) as
  // `%h/.ccrc/exposure.env` — systemd's own dialect, not bash, outside this
  // corpus, and the install suite holds those bytes instead. Later 3b tasks
  // that add a bash toucher (doctor's `exposure` check is the known one)
  // extend the holder list HERE, by name, like the remote-control block's.
  //
  // D-169 added the second holder, and it is a genuine exception rather than
  // a drift: `deploy/deploy.sh` runs on a WORKSTATION and reads this file on
  // the box, over ssh, before the box has been given the build that could
  // answer for itself — so it cannot reach `CCRC_EXPOSURE_FILE`, and there is
  // no verb to ask. What the exception costs is a second parser of one file,
  // which is the thing this rule exists to prevent, so that cost is paid
  // explicitly: deploy-env-guard.test.ts feeds BOTH readers the same awkward
  // lines (leading tab, trailing CR, quotes, duplicate keys, `export KEY=`)
  // and fails if they disagree on any of them.
  const NEEDLE = '.ccrc/exposure.env';

  it('is touched by exactly two bash files, and both are named', () => {
    expect(holdersOf(NEEDLE)).toEqual([
      'ccd/ccrc',         // CCRC_EXPOSURE_FILE — the declaration `cmd_expose` writes through
      'deploy/deploy.sh', // derive_health_urls — reads it ON THE BOX, over ssh (D-169)
    ]);
  });

  it('ccrc spells the path once — the declaration is the only line of shell naming it', () => {
    const code = codeLines(path.join(ccrcRoot, 'ccd', 'ccrc'));
    expect(code.filter((l) => l.includes(NEEDLE))).toEqual([
      'CCRC_EXPOSURE_FILE="$HOME/.ccrc/exposure.env"',
    ]);
  });
});


// — Stage 3b, Task 2: the Caddyfile the expose verb regenerates —
describe('one ~/.ccrc/Caddyfile, spelled once in bash through CCRC_CADDYFILE', () => {
  // Spec D2: `ccrc expose` generates the COMPLETE Caddyfile into `~/.ccrc` —
  // ccrc-owned, regenerated every run — and the OPERATOR, never ccrc, links or
  // copies it into /etc/caddy in the printed root ceremony (ccrc has never run
  // sudo and does not start here). The path is spelled once, for
  // `CCRC_EXPOSURE_FILE`'s reason above: `cmd_expose` WRITES through the
  // variable and the ceremony lines PRINT the path at the operator through the
  // same variable, so a literal anywhere else is a path the verb does not
  // actually write. `/etc/caddy/Caddyfile` in the printed remedy is a
  // DIFFERENT path — caddy's own, on the root side of the boundary — and is
  // deliberately not this needle.
  const NEEDLE = '.ccrc/Caddyfile';

  it('is touched by exactly one bash file, and that file is ccd/ccrc', () => {
    expect(holdersOf(NEEDLE)).toEqual([
      'ccd/ccrc',   // CCRC_CADDYFILE — the declaration cmd_expose writes through
    ]);
  });

  it('ccrc spells the path once — the declaration is the only line of shell naming it', () => {
    const code = codeLines(path.join(ccrcRoot, 'ccd', 'ccrc'));
    expect(code.filter((l) => l.includes(NEEDLE))).toEqual([
      'CCRC_CADDYFILE="$HOME/.ccrc/Caddyfile"',
    ]);
  });
});


// — the system Caddyfile: caddy's own path, on the root side of the boundary —
describe('one /etc/caddy/Caddyfile, spelled once through CCRC_CADDY_SYSTEM_FILE', () => {
  // The block above pins `~/.ccrc/Caddyfile` — the file ccrc WRITES. This
  // pins the other end of the ceremony: the file caddy READS, which ccrc
  // never writes and only ever names. It became a constant for a measured
  // reason (D-166): doctor's `caddyfile` check MEASURES that path while the
  // expose landing block and the caddy remedy PRINT it, and three literals
  // are three chances for a remedy to send an operator to a file the check is
  // not looking at. It is also the only way the suite can test the check at
  // all — no test may create /etc/caddy, and none should ever need root to.
  const NEEDLE = '/etc/caddy/Caddyfile';

  it('is touched by exactly one bash file, and that file is ccd/ccrc', () => {
    expect(holdersOf(NEEDLE)).toEqual([
      'ccd/ccrc',   // CCRC_CADDY_SYSTEM_FILE — the declaration everything else reads
    ]);
  });

  it('ccrc spells the path once — the declaration is the only line of shell naming it', () => {
    const code = codeLines(path.join(ccrcRoot, 'ccd', 'ccrc'));
    expect(code.filter((l) => l.includes(NEEDLE))).toEqual([
      'CCRC_CADDY_SYSTEM_FILE="${CCRC_CADDY_SYSTEM_FILE:-/etc/caddy/Caddyfile}"',
    ]);
  });
});


// — Stage 3b, Task 3: the ddns unit pair's name —
describe('one ccrc-ddns unit name, spelled once in bash through CCRC_DDNS_UNIT', () => {
  // Spec D4: the duckdns arm installs `ccrc-ddns.service` + `ccrc-ddns.timer`
  // and enables the timer — so the name is an INSTALL destination, an enable
  // argument and (degraded) a printed remedy, and a drift between any two is a
  // box whose timer was installed under one name and enabled under another.
  // The unit FILES never carry the name (a .timer with no `Unit=` starts the
  // same-named .service — systemd's own default is the single source there),
  // and the template FILENAMES under deploy/systemd are reached through the
  // variable. Later 3b tasks that add a bash toucher (Task 4's `name` check
  // remedy, "check ccrc-ddns.timer", is the known one) extend the holder list
  // HERE, by name, like the remote-control block's.
  const NEEDLE = 'ccrc-ddns';

  it('is touched by exactly one bash file, and that file is ccd/ccrc', () => {
    expect(holdersOf(NEEDLE)).toEqual([
      'ccd/ccrc',   // CCRC_DDNS_UNIT — the declaration `_exp_ddns_units` installs and enables through
    ]);
  });

  it('ccrc spells the name once — the declaration is the only line of shell naming it', () => {
    const code = codeLines(path.join(ccrcRoot, 'ccd', 'ccrc'));
    expect(code.filter((l) => l.includes(NEEDLE))).toEqual([
      'CCRC_DDNS_UNIT="ccrc-ddns"',
    ]);
  });
});


// — the upstream OAuth fallback convention —
describe('one upstream .cc-secrets/<id>-oauth.env fallback, in exactly five bash files', () => {
  // `exec.secretsFile` can declare a credential path for an upstream lane, and
  // every reader must prefer it. This convention is only its legacy fallback
  // when the upstream declares none; it is NEVER a filename guessed for every
  // telemetry-Anthropic lane. The five tools that spell the fallback CANNOT
  // share a constant: `ccd-account-health` and `ccd-telemetry-keepalive` are
  // each installed alone into $HOME/.local/bin with no library beside them, and
  // `ccrc-doctor-checks` is loaded by `ccrc` through ${BASH_SOURCE[0]} on a box
  // that may not have either of them at all.
  // So the agreement is MEASURED, the way `.ccrc/remote-control`'s four
  // spellings are: an exact holder list, and a value comparison.
  //
  // THE THIRD HOLDER IS A WIDENING, and it is written down rather than waved
  // through. `ccd-telemetry-keepalive` sources the file it names — it does not
  // merely test for it — because the account it is about to spend a turn on
  // must carry its own credential and the roster structurally cannot say where
  // that lives for the upstream account. It is therefore the same convention,
  // used by a third consumer, and the value comparison below covers it exactly
  // as it covers the other two. A FOURTH holder should have to argue again.
  //
  // THE FOURTH ARGUES, AND IT IS THE WRITER (D-2602). `ccd-account-auth` does
  // not read
  // this path — it CREATES it: `_auth_write_secret` writes a 0600 temp file
  // beside the target and renames it into place, which is the act that makes
  // the other three holders' reads mean anything. Every earlier holder was a
  // consumer of a convention nobody in this tree established; the account wave
  // added the producer, so the convention now has one writer and three readers
  // rather than three readers and an absent author. It cannot share a constant
  // with them for the reason already stated above — it too is installed alone
  // into $HOME/.local/bin with no library beside it — so it is measured here
  // on exactly the same terms, and the value comparison below covers it.
  // A FIFTH holder should still have to argue.
  //
  // THE FIFTH ARGUES, AND IT NEVER READS THE FILE (D-3524). `ccd/ccd`'s
  // `_authdead_cred_src` names the upstream's credential file so the auth-dead
  // marker can expire once the credential it condemned is replaced: it STATS the
  // file for its ctime and never opens it. The upstream is exactly the account
  // the roster may give no `secretsFile`, and the file the probe measured dead is
  // this one — so ccd must build the same path, and it cannot share a constant
  // for the reason above: ccd is installed as a lone COPY into $HOME/.local/bin.
  // A declared `exec.secretsFile` wins over it (`_ccrc_secrets_file`, generated);
  // the convention is the fallback for the upstream alone, never a guess for any
  // other id. Measured below on the same terms as the other four. A SIXTH
  // holder should still have to argue.
  const NEEDLE = '-oauth.env';

  it('is spelled by exactly those five files, each named here BY NAME', () => {
    expect(holdersOf(NEEDLE)).toEqual([
      'ccd/ccd',                      // _authdead_cred_src — stats the upstream's file, never opens it (D-3524)
      'ccd/ccd-account-auth',         // _auth_write_secret — the WRITER; the other four read what it renames into place
      'ccd/ccd-account-health',       // _ah_subjects — selects this fallback only for undeclared upstream credentials
      'ccd/ccd-telemetry-keepalive',  // _ka_turn — the keepalive sources it into the turn
      'ccd/ccrc-doctor-checks',       // _check_credentials — the operator-facing re-measurement
    ]);
  });

  it('and all five build the same fallback path from an id', () => {
    // NARROWED TO THE CONSTRUCTING LINE, deliberately. `codeLines` drops only
    // lines whose trimmed start is `#`, and each file can name the fallback in
    // an operator-facing message as well as its executable construction. A bare
    // `.includes(NEEDLE)` therefore cannot distinguish a path that is built from
    // a historical explanation. The filters name the construction in its native
    // language instead: shell, jq, or the contained Node reader.
    const probe = codeLines(path.join(ccrcRoot, 'ccd', 'ccd-account-health'))
      .filter((l) => l.includes('.cc-secrets/\\($id)-oauth.env'));
    const doctor = codeLines(path.join(ccrcRoot, 'ccd', 'ccrc-doctor-checks'))
      .filter((l) => l.includes('.cc-secrets/${a.id}-oauth.env'));
    // The keepalive's constructing line is its readability TEST — `[ -r "…" ]
    // && . "…"` — which names the path twice on ONE line. That is deliberate
    // there (the guard and the source must not be able to disagree about which
    // file they mean), so the filter counts LINES and `shape` reads the first
    // quoted path on the line, which is the one the guard tests.
    const keepalive = codeLines(path.join(ccrcRoot, 'ccd', 'ccd-telemetry-keepalive'))
      .filter((l) => l.includes(NEEDLE) && l.includes('[ -r '));
    // The WRITER's constructing line is the RENAME, not the temp path beside it:
    // `_auth_write_secret` writes `.<id>-oauth.env.$$.tmp` first, so the file is
    // never half-written at the name the readers watch. Both lines carry the
    // needle; only the `mv` names the path this convention is about.
    const writer = codeLines(path.join(ccrcRoot, 'ccd', 'ccd-account-auth'))
      .filter((l) => l.includes(NEEDLE) && l.includes('mv -f --'));
    expect(probe.length, `the probe builds its upstream fallback on ${probe.length} lines`).toBe(1);
    expect(doctor.length, `the doctor builds its upstream fallback on ${doctor.length} lines`).toBe(1);
    expect(keepalive.length, `the keepalive builds it on ${keepalive.length} lines`).toBe(1);
    expect(writer.length, `the writer renames onto it on ${writer.length} lines`).toBe(1);
    // ccd's constructing line is the upstream arm of `_authdead_cred_src`. Found
    // through `BASH` by its relative name, never by joining the script's path
    // here: that spelling belongs to `ccdWsHelpers.ts` alone (the extraction
    // finding above).
    const ccdFile = BASH.find((f) => rel(f) === 'ccd/ccd');
    expect(ccdFile, 'ccd/ccd is in the bash corpus').toBeDefined();
    const ccdSrc = codeLines(ccdFile!)
      .filter((l) => l.includes(NEEDLE) && l.includes('f="$HOME/.cc-secrets/'));
    expect(ccdSrc.length, `ccd builds it on ${ccdSrc.length} lines`).toBe(1);
    // A REAL comparison, not a tautology. Each line is reduced to the path it
    // BUILDS, with the five files' different spellings of "the secrets dir" and
    // "the account id" normalised away — including jq's `\($id)` and the
    // contained Node reader's `${a.id}`. A `shape` that returned a constant for
    // anything matching the filter (the first draft of this pin did) could
    // never fail, which is the failure mode this whole file exists to catch.
    const shape = (l: string): string => {
      const m = /['"`]([^'"`]*-oauth\.env)['"`]/.exec(l);
      expect(m, `no quoted -oauth.env path on: ${l.trim()}`).not.toBeNull();
      return m![1]!.replace('%s/%s', '<dir>/<id>').replace('$HOME/.cc-secrets/$id', '<dir>/<id>')
        .replace('.cc-secrets/\\($id)', '<dir>/<id>')
        .replace('.cc-secrets/${a.id}', '<dir>/<id>')
        .replace('$SECRETS_DIR/$acct', '<dir>/<id>')
        .replace('$SECRETS_DIR/$AUTH_ID', '<dir>/<id>')
        .replace('$HOME/.cc-secrets/$w', '<dir>/<id>');
    };
    expect(shape(probe[0]!), 'the probe builds a path the doctor does not').toBe('<dir>/<id>-oauth.env');
    expect(shape(doctor[0]!), 'the doctor builds a path the probe does not').toBe('<dir>/<id>-oauth.env');
    expect(shape(keepalive[0]!), 'the keepalive builds a path the other two do not')
      .toBe('<dir>/<id>-oauth.env');
    expect(shape(writer[0]!), 'the writer creates a path its readers do not watch')
      .toBe('<dir>/<id>-oauth.env');
    expect(shape(ccdSrc[0]!), 'ccd stats a path the writer does not create')
      .toBe('<dir>/<id>-oauth.env');
  });
});
