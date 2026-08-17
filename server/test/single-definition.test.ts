// Structural guards for the "one definition, imported everywhere" findings.
//
// Both of these started life as a COMMENT asking the next reader not to copy
// something, and both were copied anyway — `UNCHECKED_PR`'s own docstring said
// "a second copy would drift" and by the time the integration review ran there
// were three. So the guard is a test that reads the sources, in the suite that
// already reaches outside its own package (`module-format.test.ts` walks
// `shared/`, the ccd tests execute `../../ccrc-portability/ccd`). A
// comment is a request; a red suite is a mechanism.
//
// These scan TEXT, deliberately, and that is a limitation worth stating: they
// catch the copy that looks like the original, which is the copy people
// actually write. A determined author can evade either one (build the object
// field-by-field, spell the union across a type alias in another file). The
// bar is "a reasonable person adding a fourth copy in the ordinary way is
// stopped before review", not "unforgeable".
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PR_REASONS, isPrReason } from '../../shared/api.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');

/** Every source root any of the three definitions could be copied into. The
 *  pwa is in this list because that is where the ORIGINAL lived and where the
 *  drift began; the agent because it is the third consumer of `shared/`. */
const ROOTS = [
  path.join(ccrcRoot, 'shared'),
  path.join(ccrcRoot, 'server', 'src'),
  path.join(ccrcRoot, 'pwa', 'src'),
  path.join(ccrcRoot, 'agent', 'src'),
];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    // `__`-prefixed entries are TRANSIENT mutants written by a parallel suite
    // (`boot.test.ts` writes `server/src/__boot_control_mutant__.ts` for ~15s).
    // Two failure modes, not one: `statSync`/`readFileSync` ENOENT on a file
    // that vanished mid-walk, and — while it exists — it is a verbatim copy of
    // `index.ts`, so a value this suite pins as appearing ONCE momentarily
    // appears twice, i.e. a false "second copy" in the very test whose job is
    // to fail the build on a second copy. Same guard, same reason, as
    // `run-routes.test.ts`'s `sourcesUnder`.
    if (e.startsWith('__')) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...sources(p)); continue; }
    if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const ALL = ROOTS.flatMap(sources);
const rel = (p: string): string => path.relative(ccrcRoot, p);

describe('the roots this scans', () => {
  it('actually found the four source trees, and the files the findings name', () => {
    // A scan over an empty list passes everything. This is the assertion that
    // the two tests below are looking at anything at all — a moved package or
    // a renamed directory must turn THIS red rather than silently disarm them.
    for (const r of ROOTS) expect(sources(r).length, rel(r)).toBeGreaterThan(0);
    for (const f of ['shared/api.ts', 'server/src/watch.ts', 'server/src/prstate.ts',
      'pwa/src/session/PrKeycap.tsx']) {
      expect(ALL.map(rel)).toContain(f);
    }
  });
});

describe('integration finding 6 — one UNCHECKED_PR', () => {
  // The literal's fingerprint: an object literal whose first field is the
  // phase. All three copies opened exactly this way, and so does the surviving
  // definition — which is why the assertion is "in one file", not "nowhere".
  const OPENING = /\bphase:\s*'unchecked'/;

  it('is defined in exactly one file, and that file is shared/api.ts', () => {
    const holders = ALL.filter((f) => OPENING.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it('is what the three former copy sites now use', () => {
    // Not just "the copies are gone" — that is satisfied by deleting the
    // feature. Each site must still reach the shared object.
    for (const f of ['server/src/watch.ts', 'server/src/prstate.ts',
      'pwa/src/session/PrKeycap.tsx']) {
      const src = readFileSync(path.join(ccrcRoot, f), 'utf8');
      expect(src, f).toContain('UNCHECKED_PR');
      expect(src, f).toMatch(/import .*UNCHECKED_PR.*from '\.\.[^']*shared\/api(\.js)?'/);
    }
  });
});

describe('integration finding 7 — one reason vocabulary', () => {
  // The compile-time half of this finding cannot be asserted from a test at
  // all: `Record<PrReason, true>` and `Record<PrReason, string>` fail in `tsc`,
  // which is a gate, not a case. What a test CAN do is the two things tsc
  // cannot — check that the derived list really is derived and complete at
  // runtime, and check that nobody has restated the vocabulary somewhere the
  // compiler is not watching.

  it('derives the runtime list from the union rather than restating it', () => {
    // Nine, and every one of them recognised by the predicate that both
    // validators now use. If `PR_REASONS` were ever hand-written back into an
    // array this still passes — which is why the source scan below exists —
    // but a DERIVED list that has gone out of step with the union is
    // impossible to construct, and that is the point being recorded.
    expect(PR_REASONS).toHaveLength(9);
    expect(new Set(PR_REASONS).size).toBe(PR_REASONS.length);
    for (const r of PR_REASONS) expect(isPrReason(r), r).toBe(true);
    expect(isPrReason('not-a-reason')).toBe(false);
    // Cast the constant, never the input — the predicate takes `unknown`, so a
    // non-string is answered rather than smuggled through.
    expect(isPrReason(null)).toBe(false);
    expect(isPrReason(7)).toBe(false);
  });

  it('is enumerated only where the compiler enforces exhaustiveness', () => {
    // The rule, stated as the assertion: a file may list the whole vocabulary
    // ONLY if a `Record<PrReason, …>` over it makes a missing member a compile
    // error. Two files qualify — `shared/api.ts` (the union, and
    // `PR_REASON_MAP`) and `PrKeycap.tsx` (`REASON_TEXT`, the sentences a human
    // reads). `prstate.ts`'s `Set` and `shared/api.ts`'s second `readonly
    // string[]` were the two that did not, and both are gone.
    //
    // Membership is tested per token in ANY form, quoted or as an object key,
    // because `REASON_TEXT` writes five of the nine unquoted — a
    // quoted-literals-only scan would exclude it by accident rather than by
    // rule, and would then miss a real copy written the same way.
    const enumerates = (src: string): boolean =>
      PR_REASONS.every((r) => new RegExp(`(?:'${r}'|(?<![\\w'-])${r}\\s*:)`).test(src));
    const holders = ALL.filter((f) => enumerates(readFileSync(f, 'utf8'))).map(rel).sort();
    expect(holders).toEqual(['pwa/src/session/PrKeycap.tsx', 'shared/api.ts']);
  });

  it('routes both validators through the shared predicate', () => {
    // Not just "the copies are gone": each former copy site must still be
    // validating, and validating against the derived list.
    for (const f of ['server/src/prstate.ts', 'shared/api.ts']) {
      expect(readFileSync(path.join(ccrcRoot, f), 'utf8'), f).toContain('isPrReason');
    }
    // And the map that carries the human sentences is typed over the union, so
    // a tenth reason cannot ship without one.
    expect(readFileSync(path.join(ccrcRoot, 'pwa/src/session/PrKeycap.tsx'), 'utf8'))
      .toContain('Record<PrReason, string>');
  });
});

describe('extraction finding — one path to the ccd script', () => {
  // Seven files each spelled this path, and the extraction has to repoint it.
  // One definition means one line changes and every other file in the moved
  // tree must be byte-identical to its origin — which is what makes the
  // extraction verifiable by checksum instead of by review.
  //
  // Scans server/test AND server/test-e2e, which the ROOTS above deliberately
  // do not cover. test-e2e is a real sibling TypeScript tree (helpers.ts,
  // session.e2e.test.ts) that talks about ccd and holds no copy today — but
  // an unscanned sibling directory is exactly the "clean and unchecked becomes
  // dirty and unchecked with nothing saying so" shape that
  // test/tsconfig.tests.json already closed for the typechecker by enumerating
  // its sibling directories rather than naming one; this scan does the same.
  const testDir = path.join(ccrcRoot, 'server', 'test');
  const testDirs = [testDir, path.join(ccrcRoot, 'server', 'test-e2e')];
  const testFiles = testDirs.flatMap(sources);

  // Matches any literal naming the script: the `../../../ccrc-portability/ccd`
  // form, the path.join(..., `ccrc-portability`, `ccd`) form that
  // wsaudit.test.ts used, the `../../ccd/ccd` form it becomes after the move,
  // and the parts form an author could just as easily reach for post-move —
  // two adjacent path.join arguments that both spell the four-letter script
  // name, the same split style wsaudit.test.ts (one of the original seven)
  // already used pre-move. That last shape needs its own case: relying on the
  // pre-move `ccrc-portability` alternative alone would miss it, since
  // that string stops existing the instant the extraction lands. All four
  // shapes must be caught, or the guard stops working the moment the
  // extraction lands.
  //
  // Anchored to these exact shapes rather than a bare 'ccrc-portability'
  // or a bare quoted 'ccd' — this file's server/test tree also legitimately
  // says "ccrc-portability" (extraction-manifest.test.ts's fixtures,
  // ccd-ccclip.test.ts's OTHER script) and legitimately quotes 'ccd' for
  // unrelated reasons (ccd-pr-state.test.ts's assertion label, remote-connect
  // and remote-runner stubbing a binary literally named ccd). A looser regex
  // over-matches this file's own comment too, describing the very literal it
  // hunts for. Backticks above, not quotes, keep this comment from being a
  // false positive of its own making — and this paragraph deliberately never
  // writes the two script-name arguments themselves, quoted and adjacent, for
  // the same reason.
  const NAMES_CCD = /['"]\.\.\/\.\.\/\.\.\/ccrc-portability\/ccd['"]|'ccrc-portability',\s*'ccd'|['"]\.\.\/\.\.\/ccd\/ccd['"]|['"]ccd['"]\s*,\s*['"]ccd['"]/;

  it('found the test tree it is scanning', () => {
    // A scan over an empty list passes everything. Each directory is checked
    // separately so a moved or renamed sibling turns this red on its own,
    // rather than the other directory's file count silently covering for it.
    for (const d of testDirs) expect(sources(d).length, rel(d)).toBeGreaterThan(0);
    expect(testFiles.length).toBeGreaterThan(40);
    expect(testFiles.map(rel)).toContain('server/test/ccdWsHelpers.ts');
    expect(testFiles.map(rel)).toContain('server/test-e2e/helpers.ts');
  });

  it('is spelled in exactly one file, and that file is ccdWsHelpers.ts', () => {
    const holders = testFiles
      .filter((f) => NAMES_CCD.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(holders).toEqual(['server/test/ccdWsHelpers.ts']);
  });

  it('is what the six former copy sites now import', () => {
    // Not merely "the copies are gone" — deleting the tests would satisfy that.
    // Each site must still reach the shared constant.
    for (const f of ['ccd-clip.test.ts', 'projected-home.test.ts',
      'ccd-limits.test.ts', 'ccd-ws-reap.test.ts', 'ccd-ws-audit.test.ts',
      'wsaudit.test.ts']) {
      const src = readFileSync(path.join(testDir, f), 'utf8');
      expect(src, f).toMatch(/import\s*\{[^}]*\bCCD\b[^}]*\}\s*from\s*'\.\/ccdWsHelpers\.js'/);
    }
  });
});

describe('one KeyedQueue for the process', () => {
  // The seam the naming sweep needs. `buildServer` used to construct its own
  // KeyedQueue inline (`server.ts:321` on origin/main, the tree this diverged
  // from), which FleetWatcher — built two lines EARLIER in index.ts (`:61` vs
  // `:63` on that same tree; `:68` vs `:70` on this one, now that the queue
  // itself hoisted one level further to `index.ts:37`) — had no way to reach.
  // A watcher that built its own would serialise its rename against nothing,
  // and `POST /workspace/reap` (`server.ts:718`) is exactly the write it must
  // not race. An optional Deps field with a `?? new KeyedQueue()` fallback is
  // the same bug with a green suite, which is why this scans for the
  // CONSTRUCTOR rather than for the field.
  const CONSTRUCTS = /\bnew KeyedQueue\s*\(/;

  it('is constructed in exactly one file under server/src, and that file is the composition root', () => {
    const holders = ALL.filter((f) => f.includes(`${path.sep}server${path.sep}src${path.sep}`))
      .filter((f) => CONSTRUCTS.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['server/src/index.ts']);
  });

  it('both consumers take it from Deps rather than making their own', () => {
    for (const f of ['server/src/server.ts', 'server/src/watch.ts']) {
      const src = readFileSync(path.join(ccrcRoot, f), 'utf8');
      expect(src, f).not.toMatch(CONSTRUCTS);
    }
    expect(readFileSync(path.join(ccrcRoot, 'server/src/server.ts'), 'utf8'))
      .toContain('queue: deps.queue');
  });
});

describe('one sessionLabel', () => {
  // `pwa/src/fleet/sessionLabel.ts`'s whole docstring is "what to call a
  // session, everywhere" — and by the time smart branch naming landed there
  // were two: the sheet's title (`SessionActionsSheet.tsx:203`) had grown a
  // verbatim copy of the chain. Same class as UNCHECKED_PR above, same fix, and
  // this is the mechanism rather than another comment asking nicely.
  const CHAIN = /session\.name \?\? session\.branch/;

  it('is defined in exactly one file, and that file is sessionLabel.ts', () => {
    const holders = ALL.filter((f) => CHAIN.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['pwa/src/fleet/sessionLabel.ts']);
  });

  it('is what the former copy site now uses', () => {
    const src = readFileSync(path.join(ccrcRoot, 'pwa/src/fleet/SessionActionsSheet.tsx'), 'utf8');
    expect(src).toContain('sessionLabel');
    expect(src).toMatch(/import \{ sessionLabel \} from '\.\/sessionLabel'/);
  });
});

describe('Build 7 nouns', () => {
  it('defines RunState exactly once, in shared/', () => {
    const hits = ALL.filter((f) => /^\s*export type RunState\b/m.test(readFileSync(f, 'utf8')));
    expect(hits.map(rel)).toEqual(['shared/api.ts']);
  });

  it('defines MAIL_REJECT_CODES exactly once, in shared/', () => {
    const hits = ALL.filter((f) => /^\s*export const MAIL_REJECT_CODES\b/m.test(readFileSync(f, 'utf8')));
    expect(hits.map(rel)).toEqual(['shared/api.ts']);
  });

  // D-7: `tasks` is Claude Code's TodoWrite vocabulary and belongs to it. A
  // coordination type that spells itself Task is the collision spec:40-44
  // exists to prevent, and it would land in the same union, the same store and
  // the same strip.
  it('does not grow a second Task* noun for work items', () => {
    for (const f of ALL) {
      const src = readFileSync(f, 'utf8');
      expect(/\b(?:interface|type)\s+(?:RunTask|ProgramTask|CoordTask)\b/.test(src),
        `${rel(f)} names a work item a Task — see the plan's D-7`).toBe(false);
    }
  });

  // ── Build 4, Task 5 ──────────────────────────────────────────────────────

  it('defines WORK_ITEM_TITLE_MAX and WORK_ITEM_MAX exactly once, in shared/', () => {
    for (const name of ['WORK_ITEM_TITLE_MAX', 'WORK_ITEM_MAX']) {
      const hits = ALL.filter((f) =>
        new RegExp(`^\\s*export const ${name}\\b`, 'm').test(readFileSync(f, 'utf8')));
      expect(hits.map(rel), name).toEqual(['shared/api.ts']);
    }
  });

  it('spells the terminal trio ONCE — TERMINAL_ITEM_STATES, and no hand-written SQL literal', () => {
    // The invariant has one home (`architecture:145-147`), so the LIST it is
    // built from must have one too: `setWorkItemState`'s `WHERE` literal is
    // produced by `TERMINAL_ITEM_STATES.join(...)` and `settleItems`' pre-pass
    // reads the same array, so a second spelling anywhere is a second
    // definition of terminality that nothing forces to agree.
    //
    // The fingerprint is the three names as ONE WHOLE list — anchored on the
    // brackets at both ends, which is exactly how a copy gets written, and
    // what tells a terminality claim apart from the VOCABULARY that merely
    // contains these three among its six (`WORK_ITEM_STATES`, `shared/api.ts`:
    // `['pending', 'claimed', 'done', 'failed', 'abandoned', 'unknown']` — a
    // list of every state there is, not a list of the terminal ones, and not a
    // copy of anything). The shipped SQL is BUILT by `join`, so this scanner
    // sees no literal at all in it; a hand-written `('done','failed',
    // 'abandoned')` scores a hit on both this and the SQL check below.
    const TRIO = /[[(]\s*['"`]done['"`],\s*['"`]failed['"`],\s*['"`]abandoned['"`]\s*[\])]/;
    const holders = ALL.filter((f) => TRIO.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['server/src/coord/store.ts']);
    // …and in that one file it is the constant, not a literal in a query.
    const store = readFileSync(path.join(ccrcRoot, 'server/src/coord/store.ts'), 'utf8');
    expect(store).toMatch(/export const TERMINAL_ITEM_STATES = \['done', 'failed', 'abandoned'\]/);
    for (const f of ALL) {
      const src = readFileSync(f, 'utf8');
      expect(/\(\s*['"]done['"]\s*,\s*['"]failed['"]\s*,\s*['"]abandoned['"]\s*\)/.test(src),
        `${rel(f)} hand-writes the terminal trio as an SQL literal`).toBe(false);
    }
  });

  // D-B4-16: no L1 file holds a database handle. `architecture:78-81` puts
  // `store.ts`/`coord/db.ts` at L3 and allows L1 to import L2 as TYPES only,
  // with "no `node:sqlite`" — so every multi-row all-or-nothing commit in this
  // build (`dispatchRun`, `settleItems`, `closeRun`) lands as a `CoordStore`
  // method, and this is the scanner that says so.
  describe('the coord ring — only store.ts, rundefs.ts and routes.ts hold the handle', () => {
    const coordDir = path.join(ccrcRoot, 'server/src/coord');
    const HANDLE_HOLDERS = new Set(['store.ts', 'rundefs.ts', 'routes.ts', 'db.ts', 'schema.ts']);
    const coordFiles = sources(coordDir);

    it('visits the whole directory — a moved directory must turn this red, not disarm it', () => {
      // Scanner-coverage pin (`architecture:104-105`): a scan over an empty or
      // truncated list passes everything.
      expect(coordFiles.length).toBeGreaterThanOrEqual(6);
      for (const f of ['items.ts', 'dispatch.ts', 'close.ts', 'store.ts']) {
        expect(coordFiles.map((p) => path.basename(p))).toContain(f);
      }
    });

    it('imports neither ./db.js nor node:sqlite outside the three that own the handle', () => {
      for (const f of coordFiles) {
        if (HANDLE_HOLDERS.has(path.basename(f))) continue;
        const src = readFileSync(f, 'utf8');
        expect(/from\s+'\.\/db\.js'/.test(src), `${rel(f)} imports ./db.js`).toBe(false);
        expect(/from\s+'node:sqlite'/.test(src), `${rel(f)} imports node:sqlite`).toBe(false);
      }
    });

    it('never reaches around the store for its handle — no `coord.db`/`store.db` receiver', () => {
      // Anchored on what a USE looks like — `tx(coord.db, …)`,
      // `coord.db.prepare(…)`, `(coord.db)` — rather than on the two words,
      // because `coord.db` is also the DATABASE FILE's name and several
      // docstrings in this directory legitimately mention it as prose
      // (`token.ts`'s own `CoordDbUnmigratable` paragraph, for one).
      const REACH = /\b(?:coord|store)\.db\s*[.,)]/;
      for (const f of coordFiles) {
        if (HANDLE_HOLDERS.has(path.basename(f))) continue;
        const src = readFileSync(f, 'utf8');
        expect(REACH.test(src),
          `${rel(f)} names a database handle on a coord/store receiver`).toBe(false);
      }
    });
  });
});

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
  // (server/test/helpers.ts), NOT from a shipped source file — because after
  // Task 6 the roster is not defined in one. The single copy still under the
  // scanned roots (`pwa/src/lib/accounts.ts`'s transitional `PRODUCTION_ROSTER`,
  // deleted in Task 7) is the very thing this hunts for, so drawing the hunt
  // list from it would make the scanner blind to itself. `server/test/` is not
  // one of the four scanned ROOTS, so the list cannot trip its own scan either;
  // and it is still a real list of the five production ids, so a restatement of
  // two of them anywhere under the roots scores a hit exactly as it did before.
  //
  // Hand-typing the names HERE instead would make the scanner that exists to
  // prevent hand-typed copies one itself: a 6th account (say `claude-dev1`)
  // added to the production roster and then restated as
  // `['claude-dev1', 'claude2']` under some root must score a hit, and a
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
  // Spec §7 says the ledger is "for humans and parsed by nothing," and D-4's
  // actual mechanism is "no file under server/src mentions
  // docs/superpowers/programs" — narrowed only as far as the shipped tree
  // forces: nine mentions exist today, and every one but three is a comment
  // explaining the convention (coord/db.ts's own migration-rule docstring,
  // coord/fingerprint.ts, coord/store.ts, coord/routes.ts's docstrings,
  // shared/api.ts). The three non-comment mentions are STRING VALUES the
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
    // coord/db.ts:144 and :221 — the 0-byte-file refusal and the
    // migration-failure refusal, the same sentence told to the operator
    // twice. Each throws a message; neither reads a byte off either path.
    "'program history from the markdown ledger (docs/superpowers/programs/<slug>.md) plus the ' +",
    "'(docs/superpowers/programs/<slug>.md) plus the registry and .prhistory (spec:82-85), or ' +",
    // coord/routes.ts:692 — POST /api/runs's response names where a
    // coordinator should commit the ledger; the route never opens it.
    'ledgerPath: `docs/superpowers/programs/${program}.md`,',
    // pwa/src/fleet/StartProgramSheet.tsx:55 — the same category as the
    // entry above, one layer client-side: the sheet NAMES the path the
    // operator is expected to have committed, before `POST /api/runs` is
    // ever composed, and never opens it — a browser has no filesystem to
    // read one off of in the first place.
    'const ledgerPath = (slug: string): string => `docs/superpowers/programs/${slug}.md`;',
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
// the caps-line regex itself, `/^[a-z][a-z-]*$/`, used the way both real
// readers use it (inside a `.filter(...)` call) — narrow enough that this
// file's OWN prose about the regex (this comment, `parseCcdCaps`'s
// docstring) does not itself score a hit, since neither writes the pattern
// inside a `.filter(`.
describe('one parseCcdCaps — the ccd-caps-line filter', () => {
  const FILTERS_WITH_IT = /\.filter\(\s*\(?\w*\)?\s*=>\s*\/\^\[a-z\]\[a-z-\]\*\$\/\.test\(/;

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
  const bashRoots = [path.join(ccrcRoot, 'ccd'), path.join(ccrcRoot, 'deploy')];
  const isBash = (p: string): boolean => {
    if (/\.(sh|bash)$/.test(p)) return true;
    if (/\.[A-Za-z0-9]+$/.test(p)) return false;   // .mjs/.service/.json/.conf …
    return /^#!.*\b(ba)?sh\b/.test(readFileSync(p, 'utf8').split('\n')[0] ?? '');
  };
  const bashFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) { out.push(...bashFiles(p)); continue; }
      if (isBash(p)) out.push(p);
    }
    return out;
  };
  const BASH = bashRoots.flatMap(bashFiles);
  /** A bash line that is not a comment. The stamp's path is discussed in prose
   *  all over both tools; only an actual line of shell is a reader. */
  const codeLines = (f: string): string[] =>
    readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('#'));
  const holdersOf = (needle: string): string[] =>
    BASH.filter((f) => codeLines(f).some((l) => l.includes(needle))).map(rel).sort();

  it('actually found the bash tools — a scan over an empty list passes everything', () => {
    for (const f of ['ccd/ccd', 'ccd/ccrc', 'ccd/ccrc-adopt', 'ccd/ccrc-doctor-checks',
      'ccd/session-hook.sh', 'deploy/deploy.sh', 'deploy/verify-service.sh']) {
      expect(BASH.map(rel)).toContain(f);
    }
  });

  it('is read from exactly two places, and the second is named here BY NAME', () => {
    // THE EXCLUSION IS WRITTEN DOWN, not a scanner quietly narrowed — the
    // `'mail-disabled'` idiom this file already uses.
    //
    // `ccd/ccd`'s `cmd_version` carries a reader of its own, in a python3
    // heredoc, and it is a genuine second copy of one fact: two tools, two
    // languages, one stamp. It stays for now because `ccd` is the tool this
    // task must not edit (its own `|| die` runs on every invocation on a live
    // fleet host, and a rewrite of its version verb belongs with the work that
    // can prove it there). Whoever next has a reason to touch `cmd_version`
    // should make it call `ccrc version` — or delete it in favour of it — and
    // shorten this list to `ccd/ccrc` alone.
    expect(holdersOf('$HOME/.ccrc/build.json')).toEqual([
      'ccd/ccd',     // cmd_version's python3 heredoc — the named gap, see above
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
    expect(code.filter((l) => l.includes('jq -r')).length,
      'a second jq parse of the stamp has appeared in ccrc').toBe(1);
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

  it('deploy.sh is the only WRITER, and it writes through install_atomic', () => {
    // The other half of "one stamp": a second writer is how a box would carry
    // a stamp no deploy stands behind. deploy.sh spells the destination
    // HOME-relative (`install_atomic`'s own contract), which is why it does
    // not appear in the reader list above.
    expect(holdersOf('.ccrc/build.json')).toEqual([
      'ccd/ccd', 'ccd/ccrc', 'deploy/deploy.sh',
    ]);
    const deploySh = readFileSync(path.join(ccrcRoot, 'deploy', 'deploy.sh'), 'utf8');
    expect(deploySh.split('\n').filter((l) => !l.trim().startsWith('#') && l.includes('.ccrc/build.json')))
      .toEqual(['  install_atomic "$stamp" .ccrc/build.json 644']);
  });
});

// — Build 4, Task 10: the wave's own two definitions —
describe('Build 4 — one MarkerState, one coordinator-paused literal', () => {
  // The type's fingerprint: the union as it is declared, not every mention.
  const DECLARES = /export type MarkerState\s*=/;

  it('MarkerState is declared in exactly one file, and that file is shared/api.ts', () => {
    const holders = ALL.filter((f) => DECLARES.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it("'coordinator-paused' is a literal in exactly one source file", () => {
    // `COORDINATOR_PAUSE_MARKER` (`server/src/coord/rundefs.ts`) is the ONE
    // definition; `dispatch.ts` and `watch.ts` both import it. A second literal
    // is how the pause banner and the dispatch gate would come to disagree
    // about what "paused" means — one of them reading a name the other never
    // writes.
    const holders = ALL.filter((f) => readFileSync(f, 'utf8').includes("'coordinator-paused'")).map(rel);
    expect(holders).toEqual(['server/src/coord/rundefs.ts']);
  });

  it("'mail-disabled' is deliberately NOT held to one literal, and this says so BY NAME", () => {
    // THE EXCLUSION IS WRITTEN DOWN, not a scanner quietly narrowed — the
    // `MAIL_REJECT_CODES`-excludes-`undeliverable` idiom. `watch.ts:184` holds
    // a second literal ON PURPOSE (`sweepMail` uses it; importing the
    // `rundefs.ts` copy into that scope as well would be a redeclaration,
    // TS2451), and `rundefs.ts`'s own docstring carries the argument for the
    // split. So the expected shape here is a NAMED LIST rather than one file —
    // and any new holder still fails.
    //
    // Two of the four are not marker literals at all: `'mail-disabled'` is also
    // a `RunRefuseCode` member, so `shared/api.ts` (the vocabulary) and
    // `coord/dispatch.ts` (the refusal that uses it) spell the same characters
    // for a different reason. Listing them here is the honest shape — a scan
    // that pretended they were copies would be describing the tree wrongly.
    const holders = ALL.filter((f) => readFileSync(f, 'utf8').includes("'mail-disabled'")).map(rel).sort();
    expect(holders).toEqual([
      'server/src/coord/dispatch.ts',   // the refusal CODE
      'server/src/coord/rundefs.ts',    // the marker literal (definition)
      'server/src/watch.ts',            // the marker literal (module-local, on purpose)
      'shared/api.ts',                  // the refusal-code vocabulary
    ]);
  });

  it('watch.ts reaches the pause marker through the shared constant, never a copy', () => {
    // Not just "no second literal" — that is satisfied by deleting the emitter.
    const src = readFileSync(path.join(ccrcRoot, 'server', 'src', 'watch.ts'), 'utf8');
    expect(src).toContain('COORDINATOR_PAUSE_MARKER');
    expect(src).toMatch(/import \{ COORDINATOR_PAUSE_MARKER \} from '\.\/coord\/rundefs\.js'/);
  });
});

// — Build 4, Task 15: one envelope grammar —
describe('Build 4 — one ccrc-mail fence', () => {
  // The GRAMMAR is minted server-side (`renderEnvelope`) and parsed back
  // (`parseMailEnvelope`); a second spelling of the info string is how those
  // two would come to disagree about what opens an envelope — the renderer
  // emitting a fence the parser does not recognise, and every delivered mail
  // silently falling back to an ordinary bubble.
  it('MAIL_ENVELOPE_FENCE is declared in exactly one file, and that file is shared/api.ts', () => {
    const DECLARES = /export const MAIL_ENVELOPE_FENCE\s*=/;
    const holders = ALL.filter((f) => DECLARES.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it('envelope.ts reaches the fence through the shared constant, never a literal', () => {
    // Not just "no second literal" — that is satisfied by deleting the
    // renderer. The emitter must still reach the shared constant.
    const src = readFileSync(path.join(ccrcRoot, 'server', 'src', 'coord', 'envelope.ts'), 'utf8');
    expect(src).toContain('MAIL_ENVELOPE_FENCE');
    expect(src).toMatch(/import \{ MAIL_ENVELOPE_FENCE, type MailKind \} from '\.\.\/\.\.\/\.\.\/shared\/api\.js'/);
    expect(src).toContain('${fence}${MAIL_ENVELOPE_FENCE}');
  });

  it('the fence spelling survives in ONE other file, named here BY NAME', () => {
    // THE EXCLUSION IS WRITTEN DOWN, not a scanner quietly narrowed — the
    // `MAIL_REJECT_CODES`-excludes-`undeliverable` idiom this file already
    // uses for `'mail-disabled'` one describe up.
    //
    // `inject/send.ts` (`isMailResidue`) tests a DRAFT for a stranded envelope
    // opener and spells the info string itself. It is a genuine second copy of
    // one fact and it is recorded as a gap rather than fixed here: Build 4's
    // wave-4 brief forbids touching `inject/send.ts` by name (it is the
    // hardened send path, and this wave has no business inside it). Whoever
    // next has a reason to edit that file should import `MAIL_ENVELOPE_FENCE`
    // and shorten this list to `shared/api.ts` alone.
    //
    // ANY QUOTING, NOT JUST `'…'` (Task 19 mutation sweep, and the reason this
    // test was rewritten): the first draft scanned for the single-quoted
    // literal only, and the realistic regression — re-inlining the fence into
    // `renderEnvelope`'s own template literal, ``${fence}ccrc-mail\n`` — is
    // spelled with no quotes at all. That mutant was applied and left this
    // assertion GREEN while only the sibling test above caught it. The scan is
    // now over the bare token in comment-stripped source, so the copy people
    // would actually write is the copy it sees.
    //
    // Three non-fence spellings share these characters and are excluded by the
    // character that follows them, not by a file name: `ccrc-mail.token` (the
    // secret's filename), `x-ccrc-mail-token` (the header) and the nudge's own
    // `ccrc-mail: you have new mail` sentence. None of them is the info
    // string, and none of them would drift with it.
    const noComments = (t: string): string =>
      t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const FENCE_SPELLING = /ccrc-mail(?![.\-:])/;
    const holders = ALL.filter((f) => FENCE_SPELLING.test(noComments(readFileSync(f, 'utf8'))))
      .map(rel).sort();
    expect(holders).toEqual([
      'server/src/inject/send.ts',   // isMailResidue's draft probe — named gap, see above
      'shared/api.ts',               // MAIL_ENVELOPE_FENCE (the definition)
    ]);
  });
});

// §1.6b. Neither new vocabulary gets this protection for free, and neither did
// the one PR #50 shipped. "A new fleet mutation is not done until its interrupted
// state is either impossible or named" is only a doctrine if a SECOND copy of the
// naming is a red suite.
describe('Build 8 vocabularies — one definition each, all derived from their map', () => {
  const oneDefinition = (decl: RegExp, name: string) => {
    const hits = ALL.filter((f) => decl.test(readFileSync(f, 'utf8')));
    expect(hits.map(rel), name).toEqual(['shared/api.ts']);
  };

  it('defines SpawnVerdict and SPAWN_VERDICTS exactly once, in shared/', () => {
    oneDefinition(/^\s*export type SpawnVerdict\b/m, 'SpawnVerdict');
    oneDefinition(/^\s*export const SPAWN_VERDICTS\b/m, 'SPAWN_VERDICTS');
  });

  it('DERIVES SPAWN_VERDICTS from its map — never a hand-written array beside the type', () => {
    // The technique `PR_REASONS` and `SESSION_LIFECYCLES` already use: a member
    // added to the union with no key in the map is TS2739 here, and a key the
    // union does not have is TS2353. A literal array is a list that nothing forces
    // to agree with the type it claims to enumerate.
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).toMatch(
      /export const SPAWN_VERDICTS: readonly SpawnVerdict\[\] =\s*\n?\s*Object\.keys\(SPAWN_VERDICT_MAP\)/);
    expect(api).not.toMatch(/SPAWN_VERDICTS[^=]*=\s*\[/);
  });

  it('spells the spawn members nowhere else — no second table of the same six words', () => {
    // `SessionLine.tsx`'s `SPAWN_WORD` is a PRESENTATIONAL map keyed BY the type
    // (`Record<SpawnVerdict, string | null>`, which the compiler keeps total), not
    // a second enumeration — so it holds the member names as KEYS and is exempt by
    // being typed. What this forbids is a free-standing list.
    const LIST = /\[\s*'ready',\s*'login',\s*'vanished',\s*'expired',\s*'blocked',\s*'unrecognised'\s*\]/;
    expect(ALL.filter((f) => LIST.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });

  it('defines DivergenceKind and DIVERGENCE_KINDS exactly once, in shared/', () => {
    oneDefinition(/^\s*export type DivergenceKind\b/m, 'DivergenceKind');
    oneDefinition(/^\s*export const DIVERGENCE_KINDS\b/m, 'DIVERGENCE_KINDS');
  });

  it('DERIVES DIVERGENCE_KINDS from its map', () => {
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).toMatch(
      /export const DIVERGENCE_KINDS: readonly DivergenceKind\[\] =\s*\n?\s*Object\.keys\(DIVERGENCE_KIND_MAP\)/);
    expect(api).not.toMatch(/DIVERGENCE_KINDS[^=]*=\s*\[/);
  });

  it('has exactly ONE census producer — the frame is emitted from one file', () => {
    // Splitting `DIVERGENCE_KINDS` (L0) from `divergences()` (L1) is defensible
    // ONLY if the census has one producer. `reviveFleetSession` must never become
    // a second, which is why the census rides a FRAME and not a `FleetSession`
    // field.
    const emitters = ALL.filter((f) => /bus\.emit\(\s*'divergence'/.test(readFileSync(f, 'utf8')));
    expect(emitters.map(rel)).toEqual(['server/src/watch.ts']);
    const callers = ALL.filter((f) => /\bdivergences\s*\(/.test(readFileSync(f, 'utf8')));
    expect(callers.map(rel).sort()).toEqual(['server/src/divergence.ts', 'server/src/watch.ts']);
  });

  it('defines SESSION_LIFECYCLES exactly once — THE GAP PR #50 SHIPPED WITH', () => {
    // Not a new rule: the same rule, applied to the vocabulary this build is
    // extending. It had no describe at all, which is how a second copy would have
    // arrived unnoticed in exactly the wave that adds a member to it.
    oneDefinition(/^\s*export type SessionLifecycle\b/m, 'SessionLifecycle');
    oneDefinition(/^\s*export const SESSION_LIFECYCLES\b/m, 'SESSION_LIFECYCLES');
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).toMatch(
      /export const SESSION_LIFECYCLES: readonly SessionLifecycle\[\] =\s*\n?\s*Object\.keys\(SESSION_LIFECYCLE_MAP\)/);
    expect(api).not.toMatch(/SESSION_LIFECYCLES[^=]*=\s*\[/);
  });

  it('mints NO `spawnstate` FIELD anywhere — the shipped registry field is `spawn`', () => {
    // Every occurrence of the word in the spec is a stale draft artifact. A
    // word-only field would destroy the timestamp `_supervised_start` compares
    // `at >= since` against.
    //
    // THE REGEX MATCHES A FIELD, NOT THE WORD, AND THAT IS NOT A WEAKENING — it
    // is the difference between this scan and a spell-checker. Task 101's
    // `SpawnVerdict` docstring and Task 109's `run_events` comment both FORBID
    // the field in prose, inside `shared/api.ts` and `server/src/coord/dispatch.ts`
    // — two files inside ROOTS. A bare `\bspawnstate\b` would red on the very
    // sentences that exist to prevent it, which is a guard eating its own
    // documentation. So: a property access, a quoted key, or a
    // declaration/assignment — every shape an actual field can take.
    //
    // THE BACKTICK IS NOT IN THE QUOTE CLASS, and that correction was forced by
    // measurement rather than taste: both forbidding comments spell the word
    // `spawnstate` in MARKDOWN backticks, so a class of ['"`] red on
    // `shared/api.ts` the moment this describe was written — the guard eating its
    // own documentation, exactly the failure the paragraph above names. A
    // backtick cannot quote an object key in TypeScript anyway (only a computed
    // one), so nothing a real field could look like is lost; a template-string
    // access is still caught by the `\.spawnstate` alternative.
    const FIELD = /\.spawnstate\b|['"]spawnstate['"]|\bspawnstate\s*[:=]/;
    for (const f of ALL) {
      expect(FIELD.test(readFileSync(f, 'utf8')),
        `${rel(f)} names a spawnstate field`).toBe(false);
    }
  });

  it('and the two prose FORBIDDINGS still pass — the guard does not eat its own docs', () => {
    // The positive case, so nobody "fixes" the regex above back into \b…\b and
    // discovers the breakage only when Task 101 lands.
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    const dispatch = readFileSync(path.join(ccrcRoot, 'server/src/coord/dispatch.ts'), 'utf8');
    expect(api).toContain('spawnstate');       // in the SpawnVerdict docstring
    expect(dispatch).toContain('spawnstate');  // in the run_events detail comment
  });
});
